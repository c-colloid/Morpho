/**
 * テーマ層（第2層）の検査。本物の pandoc.wasm で pptx / docx / html を作り、
 *   - 意味クラス [語]{.accent} が pptx で schemeClr のラン、docx で w:color、html でクラス + CSS になること
 *   - クラスの中のルビ（RawInline）が消えないこと（CLAUDE.md 落とし穴 16 を踏まない）
 *   - 列比（applyColumnRatioZip）が出力 pptx の Two Content / Comparison 枠を書き換え、
 *     ブリッジの parsePptx がその枠を読むこと（プレビュー = 書き出し）
 *   - 1:1 は無変更、枠の無いテンプレートでは skipped になること
 * を確かめる。アプリ側のコンパイラ（src/theme/theme.ts）の単体検査も含む。
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import assert from 'node:assert/strict';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { convert } from '../node_modules/pandoc-wasm/src/index.node.js';
import {
  BUILTIN_THEMES,
  RATIO_PRESETS,
  compileTheme,
  resolveTheme,
  sanitizeThemeChoice,
} from '../src/theme/theme.ts';

const src = readFileSync(new URL('../src/converter/bridgeHtml.ts', import.meta.url), 'utf8');
const decl = src.indexOf('export const BRIDGE_HTML');
const open = src.indexOf('`', decl);
const html = new Function('return `' + src.slice(open + 1, src.lastIndexOf('`')) + '`')();
const mod = /<script type="module">([\s\S]*?)<\/script>/.exec(html)[1]
  .replace(/^\s*import\s[^\n]*\n/gm, '');

const win = { __rn: () => {} };
const ctx = createContext({
  window: win,
  fetch: () => new Promise(() => {}),
  unzipSync, zipSync, strToU8,
  performance, TextDecoder, TextEncoder, WebAssembly, console, Promise,
});
runInContext(mod, ctx);

const READER = 'markdown-yaml_metadata_block+east_asian_line_breaks';
const dec = new TextDecoder();
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok   ' + name); };
const ta = async (name, fn) => { await fn(); n++; console.log('  ok   ' + name); };

/* ---------- アプリ側のコンパイラ ---------- */

const COLORS = { accent1: '#4F81BD', accent2: '#C0504D', dk1: '#000000', lt1: '#FFFFFF' };

t('組み込みテーマは id が一意で、既定は 1:1', () => {
  const ids = new Set(BUILTIN_THEMES.map((th) => th.id));
  assert.equal(ids.size, BUILTIN_THEMES.length);
  assert.deepEqual(resolveTheme(undefined).columns.ratio, [1, 1]);
});

t('文書側の上書き（列比）がテーマに重なる', () => {
  const th = resolveTheme({ id: 'plain', columns: { ratio: [2, 1] } });
  assert.deepEqual(th.columns.ratio, [2, 1]);
  assert.equal(th.id, 'plain');
});

t('未知の id は既定テーマに落ちる', () => {
  assert.equal(resolveTheme({ id: 'no-such' }).id, BUILTIN_THEMES[0].id);
});

t('compileTheme はクラスを hex + scheme に解決し、1:1 なら columnRatio を出さない', () => {
  const spec = compileTheme(resolveTheme(undefined), COLORS);
  assert.equal(spec.columnRatio, undefined);
  const accent = spec.classes.find((c) => c.name === 'accent');
  assert.ok(accent, 'accent クラスがある');
  assert.equal(accent.scheme, 'accent1');
  assert.equal(accent.hex, '#4F81BD');
  assert.equal(accent.bold, true);
});

t('deck の配色が無いときは pandoc 既定テーマの色に落ちる（#7F7F7F にならない）', () => {
  const spec = compileTheme(resolveTheme(undefined), {});
  const accent = spec.classes.find((c) => c.name === 'accent');
  assert.match(accent.hex, /^#[0-9A-F]{6}$/);
  assert.notEqual(accent.hex, '#7F7F7F');
});

t('sanitizeThemeChoice は壊れた値を捨てる', () => {
  assert.equal(sanitizeThemeChoice(null), null);
  assert.equal(sanitizeThemeChoice({ id: 5 }), null);
  assert.deepEqual(sanitizeThemeChoice({ id: 'plain' }), { id: 'plain' });
  assert.deepEqual(sanitizeThemeChoice({ columns: { ratio: [3, 2] } }), { columns: { ratio: [3, 2] } });
  assert.equal(sanitizeThemeChoice({ columns: { ratio: [0, 2] } }), null);
  assert.equal(sanitizeThemeChoice({ columns: { ratio: [1, 2, 3] } }), null);
  assert.ok(RATIO_PRESETS.length >= 3);
});

await ta('.morphodesign にテーマの選択が往復する', async () => {
  const { serializeDesign, parseDesignFile } = await import('../src/design/designFile.ts');
  const design = { version: 1, decorations: [], groups: [], theme: { id: 'focus', columns: { ratio: [3, 2] } } };
  const back = parseDesignFile(serializeDesign(design));
  assert.deepEqual(back.theme, { id: 'focus', columns: { ratio: [3, 2] } });
  const broken = parseDesignFile(JSON.stringify({ ...JSON.parse(serializeDesign(design)), theme: { id: 'X Y' } }));
  assert.equal(broken.theme, undefined, '壊れた id は捨てる');
});

/* ---------- 意味クラス ---------- */

const spec = compileTheme(resolveTheme(undefined), COLORS);
const themeLua = win.__morphoBuildThemeLua(spec.classes);

const mdClass = `# 見出し

これは[強調する語]{.accent}と[控えめな語]{.muted}。ルビ入り[{漢字|かんじ}を含む]{.accent}。
`;

async function run(to, outName, extraFilters, extraFiles) {
  const options = { from: READER, to, ...(outName ? { 'output-file': outName } : { standalone: true }) };
  const files = { 'ruby.lua': win.__morphoRubyLua, 'theme.lua': themeLua, ...(extraFiles || {}) };
  options.filters = ['ruby.lua', 'theme.lua'].concat(extraFilters || []);
  const res = await convert(options, mdClass, files);
  return res;
}

await ta('pptx: 意味クラスが schemeClr の太字ランになり、ルビは親（よみ）で残る', async () => {
  const res = await run('pptx', 'o.pptx');
  const zip = unzipSync(new Uint8Array(await res.files['o.pptx'].arrayBuffer()));
  const slide = dec.decode(zip['ppt/slides/slide1.xml']);
  assert.match(slide, /<a:r><a:rPr lang="ja-JP" b="1"><a:solidFill><a:schemeClr val="accent1"\/><\/a:solidFill><\/a:rPr><a:t>強調する語<\/a:t><\/a:r>/);
  /* tint 付きの参照は解決済みの srgbClr で出す（compileTheme の決まり） */
  assert.match(slide, /<a:srgbClr val="666666"\/><\/a:solidFill><\/a:rPr><a:t>控えめな語<\/a:t>/);
  assert.match(slide, /漢字（かんじ）を含む/);
  const parsed = win.__morphoParsePptx(new Uint8Array(await res.files['o.pptx'].arrayBuffer()));
  const runs = parsed.slides[0].shapes.flatMap((s) => s.paragraphs).flatMap((p) => p.runs);
  const hit = runs.find((r) => r.text === '強調する語');
  assert.ok(hit, 'プレビューに強調のランがある');
  assert.equal(hit.bold, true);
  assert.equal(hit.color, parsed.deck.colors.accent1, 'schemeClr が deck の配色で解決される');
  assert.equal(hit.colorScheme, undefined, '解決後の内部フィールドは残さない');
  const nonInfo = (res.warnings || []).filter((w) => w.verbosity !== 'INFO');
  assert.equal(nonInfo.length, 0, 'INFO 以外の警告なし: ' + JSON.stringify(nonInfo));
});

await ta('docx: w:color（themeColor 併記）のランになり、クラスの中のルビが w:ruby で残る', async () => {
  const res = await run('docx', 'o.docx');
  const zip = unzipSync(new Uint8Array(await res.files['o.docx'].arrayBuffer()));
  const doc = dec.decode(zip['word/document.xml']);
  assert.match(doc, /<w:r><w:rPr><w:b\/><w:color w:val="4F81BD" w:themeColor="accent1"\/><\/w:rPr><w:t xml:space="preserve">強調する語<\/w:t><\/w:r>/);
  assert.match(doc, /<w:ruby>[\s\S]*?かんじ[\s\S]*?<\/w:ruby>/, 'ルビが本物のまま');
  const rubyAt = doc.indexOf('<w:ruby>');
  const after = doc.slice(rubyAt);
  assert.match(after, /を含む/, 'ルビの後ろの文字が続く');
});

await ta('html: span のクラスが残り、テーマ CSS が WEB_CSS の後ろに入る', async () => {
  const res = await run('html', null);
  assert.match(res.stdout, /<span class="accent">強調する語<\/span>/);
  const css = win.__morphoThemeCss(spec);
  assert.match(css, /\.accent\{color:#4F81BD;font-weight:bold\}/);
  const out = win.__morphoDecorateWebHtml(res.stdout, null, css);
  assert.ok(out.indexOf('.notes{display:none}') < out.indexOf('.accent{'), 'テーマ CSS が後');
  const css21 = win.__morphoThemeCss({ columnRatio: [2, 1], classes: [] });
  assert.match(css21, /nth-child\(1\)\{flex:2 1 0\}/);
  assert.match(css21, /nth-child\(2\)\{flex:1 1 0\}/);
  assert.equal(win.__morphoThemeCss(null), '');
});

/* ---------- 列比 ---------- */

const mdCols = `# 二つの案

::: {.columns}
::: {.column}
左の列
:::
::: {.column}
右の列
:::
:::
`;

const resCols = await convert({ from: READER, to: 'pptx', 'output-file': 'c.pptx' }, mdCols, {});
const colBytes = new Uint8Array(await resCols.files['c.pptx'].arrayBuffer());

function bodyFrames(bytes) {
  const parsed = win.__morphoParsePptx(bytes);
  const slide = parsed.slides[0];
  assert.equal(slide.layout, 'Two Content');
  const bodies = slide.shapes.filter((s) => s.placeholder === 'body' && s.frame).map((s) => s.frame)
    .sort((a, b) => a.x - b.x);
  assert.equal(bodies.length, 2, '列の枠が 2 つ');
  return bodies;
}

const base = bodyFrames(colBytes);

t('1:1 は無変更（applied 0）', () => {
  const zip = unzipSync(colBytes);
  const r = win.__morphoApplyColumnRatioZip(zip, [1, 1]);
  /* vm 側のオブジェクトはレルムが違うので個別に比べる */
  assert.equal(r.applied, 0);
  assert.equal(r.skipped, 0);
});

t('2:1 で Two Content と Comparison の枠が書き換わり、プレビューが同じ枠を読む', () => {
  const zip = unzipSync(colBytes);
  const r = win.__morphoApplyColumnRatioZip(zip, [2, 1]);
  assert.equal(r.applied, 2, 'Two Content と Comparison の 2 レイアウト');
  assert.equal(r.skipped, 0);
  const frames = bodyFrames(zipSync(zip));
  const gap = base[1].x - (base[0].x + base[0].w);
  assert.equal(frames[0].x, base[0].x, '左端は動かない');
  assert.equal(frames[1].x + frames[1].w, base[1].x + base[1].w, '右端は動かない');
  assert.equal(frames[1].x - (frames[0].x + frames[0].w), gap, '段間は保つ');
  assert.ok(Math.abs(frames[0].w / frames[1].w - 2) < 0.01, '幅の比が 2:1: ' + frames[0].w + ':' + frames[1].w);
  assert.equal(frames[0].y, base[0].y);
  assert.equal(frames[0].h, base[0].h);
});

t('1:2 で左右が入れ替わった比になる', () => {
  const zip = unzipSync(colBytes);
  win.__morphoApplyColumnRatioZip(zip, [1, 2]);
  const frames = bodyFrames(zipSync(zip));
  assert.ok(Math.abs(frames[1].w / frames[0].w - 2) < 0.01);
});

t('Comparison の見出し枠と本文枠が同じ x / cx に揃う', () => {
  const zip = unzipSync(colBytes);
  win.__morphoApplyColumnRatioZip(zip, [3, 2]);
  const name = Object.keys(zip).find((k) => /slideLayout\d+\.xml$/.test(k) && dec.decode(zip[k]).includes('name="Comparison"'));
  const xml = dec.decode(zip[name]);
  const offs = [...xml.matchAll(/<a:off x="(\d+)"/g)].map((m) => Number(m[1]));
  const xs = new Set(offs);
  /* タイトル枠 + 左 2 + 右 2。x の種類は 3 以下（タイトルは左と同じ x のことが多い） */
  assert.ok(xs.size <= 3, 'x の種類: ' + [...xs].join(','));
});

t('枠を持たないレイアウトは skipped', () => {
  const zip = unzipSync(colBytes);
  for (const k of Object.keys(zip)) {
    if (!/slideLayout\d+\.xml$/.test(k)) continue;
    const xml = dec.decode(zip[k]);
    if (!/name="Two Content"|name="Comparison"/.test(xml)) continue;
    zip[k] = strToU8(xml.replace(/<a:xfrm>[\s\S]*?<\/a:xfrm>/g, ''));
  }
  const r = win.__morphoApplyColumnRatioZip(zip, [2, 1]);
  assert.equal(r.applied, 0);
  assert.equal(r.skipped, 2);
});

t('書き換えた slideLayout は整形式のまま（タグの対応が崩れない）', () => {
  const zip = unzipSync(colBytes);
  win.__morphoApplyColumnRatioZip(zip, [2, 1]);
  for (const k of Object.keys(zip)) {
    if (!/slideLayout\d+\.xml$/.test(k)) continue;
    const xml = dec.decode(zip[k]);
    const opens = (xml.match(/<p:sp>/g) || []).length;
    const closes = (xml.match(/<\/p:sp>/g) || []).length;
    assert.equal(opens, closes, k);
    assert.ok(!/<a:off x="\d+"[^>]*x="/.test(xml), '属性の重複なし');
  }
});

console.log(`theme: ${n} ok`);
console.log('  pandoc 既定テーマの配色:', JSON.stringify(win.__morphoParsePptx(colBytes).deck.colors));
