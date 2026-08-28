/**
 * 統合検査: 本物の pandoc.wasm で pptx を作り、ブリッジの parsePptx を
 * vm で丸ごと動かして、座標・配色・字サイズ・ノートが解決されることを確かめる。
 * パーサ単体の検査 (check-scene) が通っても、継承解決の配線ミスはここでしか捕まらない。
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import assert from 'node:assert/strict';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { convert } from '../node_modules/pandoc-wasm/src/index.node.js';

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
  unzipSync, zipSync, strToU8,   // ブリッジ内の自由変数として注入
  performance, TextDecoder, WebAssembly, console, Promise,
});
runInContext(mod, ctx);

/* アプリと同じ経路: front matter は剥がして metadata で渡す（落とし穴1） */
const md = `# 一枚目

本文と**太字**。

- 箇条書き
  - 二階層

改行位置を\\
固定した段落。

::: notes
ノート本文。
:::
`;
const res = await convert(
  {
    from: 'markdown-yaml_metadata_block+east_asian_line_breaks',
    to: 'pptx',
    'output-file': 'o.pptx',
    metadata: { title: '統合', author: '検査' },
  },
  md, {},
);
const bytes = new Uint8Array(await res.files['o.pptx'].arrayBuffer());
const parsed = win.__morphoParsePptx(bytes);

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok   ' + name); };

t('デッキ寸法が 16:9 の実測値', () => {
  assert.equal(parsed.deck.w, 9144000);
  assert.equal(parsed.deck.h, 5143500);
});
t('テーマ配色が入る', () => {
  assert.equal(parsed.deck.colors.dk1, '#000000');
  assert.equal(parsed.deck.colors.lt1, '#FFFFFF');
  assert.match(parsed.deck.colors.accent1, /^#[0-9A-Fa-f]{6}$/);
});
t('字サイズ既定（タイトル33pt・本文24pt）', () => {
  assert.equal(parsed.deck.titleSz, 3300);
  assert.equal(parsed.deck.bodySz[0], 2400);
});
t('マスターの字下げ（marL / indent）が取れる', () => {
  assert.equal(parsed.deck.bodyMarL[0], 342900);
  assert.equal(parsed.deck.bodyMarL[1], 685800);
  assert.equal(parsed.deck.bodyIndent[0], -342900);
});
t('段落の字下げ上書き: 普通の段落は 0/0 明示、箇条書きは継承', () => {
  const body = parsed.slides[1].shapes.find((s) => s.placeholder === 'body');
  const plain = body.paragraphs.find((p) => p.bullet === 'none');
  assert.equal(plain.marL, 0);
  assert.equal(plain.indent, 0);
  const nested = body.paragraphs.find((p) => p.level === 1);
  assert.equal(nested.marL, null);
  assert.equal(nested.indent, null);
});
t('全図形の frame がマスター継承で解決される', () => {
  for (const slide of parsed.slides) {
    for (const sh of slide.shapes) {
      assert.ok(sh.frame, `slide${slide.index} の ${sh.placeholder} が未解決`);
      assert.ok(sh.frame.w > 0 && sh.frame.h > 0);
    }
  }
});
t('タイトルスライドの ctrTitle も座標を持つ', () => {
  const s1 = parsed.slides[0];
  const title = s1.shapes.find((s) => s.placeholder === 'ctrTitle' || s.placeholder === 'title');
  assert.ok(title && title.frame);
});
t('行末バックスラッシュの改行が端から端まで残る', () => {
  const body = parsed.slides[1].shapes.find((s) => s.placeholder === 'body');
  const withBreak = body.paragraphs.find((p) =>
    p.runs.map((r) => r.text).join('').includes('\n'),
  );
  assert.ok(withBreak, '<a:br/> がプレビューの段落に反映されていない');
  assert.equal(withBreak.runs.map((r) => r.text).join(''), '改行位置を\n固定した段落。');
});

t('ノートが該当スライドに載る', () => {
  const withNotes = parsed.slides.find((s) => s.notes.length > 0);
  assert.ok(withNotes);
  assert.equal(withNotes.notes[0].runs.map((r) => r.text).join(''), 'ノート本文。');
});

/* ---------- Web プレビュー（to: html）の統合検査 ---------- */

const webRes = await convert(
  {
    from: 'markdown-yaml_metadata_block+east_asian_line_breaks',
    to: 'html',
    standalone: true,
    metadata: { title: '統合', author: '検査' },
  },
  md, {},
);
const webHtml = win.__morphoDecorateWebHtml(webRes.stdout);

t('web: standalone HTML が出て CSS 注入される', () => {
  assert.ok(webHtml.includes('<!DOCTYPE html'));
  assert.ok(webHtml.includes('.notes{display:none}'));
  assert.ok(webHtml.indexOf('.notes{display:none}') < webHtml.indexOf('</head>'));
});
t('web: 見出しと行内改行が実出力に残る', () => {
  assert.match(webHtml, /<h1[^>]*>一枚目<\/h1>/);
  assert.ok(webHtml.includes('改行位置を<br />'));
});
t('web: notes は div class="notes" で残る（CSS で隠す方針の前提）', () => {
  assert.ok(webHtml.includes('class="notes"'));
  assert.ok(webHtml.includes('ノート本文。'));
});

/* ---------- docx 書き出しのノート除去（落とし穴 8）の統合検査 ---------- */

const docxRes = await convert(
  {
    from: 'markdown-yaml_metadata_block+east_asian_line_breaks',
    to: 'docx',
    'output-file': 'o.docx',
    metadata: { title: '統合', author: '検査' },
    filters: ['drop-notes.lua'],
  },
  md,
  { 'drop-notes.lua': win.__morphoDropNotesLua },
);
const docxZip = unzipSync(new Uint8Array(await docxRes.files['o.docx'].arrayBuffer()));
const documentXml = new TextDecoder().decode(docxZip['word/document.xml']);

t('docx: ::: notes ::: が本文から除去される（落とし穴 8）', () => {
  assert.ok(!documentXml.includes('ノート本文。'), 'ノートが docx 本文に漏れている');
});
t('docx: ノート以外の本文は残る', () => {
  assert.ok(documentXml.includes('一枚目'));
  assert.ok(documentXml.includes('箇条書き'));
});

/* ---------- 装飾の OOXML 後処理（飾る力）の統合検査 ---------- */

const DECORS = [
  {
    id: 'dtest1',
    contentIndex: 1,
    shape: 'rect',
    x: 0, y: 0, w: 9144000, h: 300000,
    color: { scheme: 'accent1' },
    opacity: 100,
  },
  {
    id: 'dtest2',
    contentIndex: 1,
    shape: 'roundRect',
    x: 457200, y: 1000000, w: 8229600, h: 3000000,
    color: { hex: '#12AB34' },
    opacity: 15,
  },
  {
    id: 'dtest3',
    contentIndex: 1,
    shape: 'ellipse',
    x: 457200, y: 360045, w: 617220, h: 617220,
    color: { scheme: 'accent2' },
    opacity: 100,
    text: '3 <&>',
  },
  {
    id: 'dtest4',
    contentIndex: 1,
    shape: 'star5',
    x: 2000000, y: 2000000, w: 1000000, h: 1000000,
    color: { scheme: 'accent3' },
    opacity: 100,
    noFill: true,
    line: { color: { hex: '#AB12CD' }, widthPt: 1.5 },
  },
];

/* dtest1 と dtest2 をグループに（bbox は dtest1 が x/y、dtest2 が右下を決める） */
const GROUPS = [{ id: 'gtest1', contentIndex: 1, memberIds: ['dtest1', 'dtest2'] }];

/* metadata.title あり → タイトルスライドが1枚 → contentIndex 1 は slide2.xml */
const decorated = win.__morphoApplyDecorations(bytes, DECORS, 1, GROUPS);
const dzip = unzipSync(new Uint8Array(decorated));
const slide2 = strFromU8(dzip['ppt/slides/slide2.xml']);

t('装飾: 対象スライドに MorphoDecor の sp が注入される', () => {
  assert.ok(slide2.includes('MorphoDecor dtest1'));
  assert.ok(slide2.includes('MorphoDecor dtest2'));
  const s1 = strFromU8(dzip['ppt/slides/slide1.xml']);
  assert.ok(!s1.includes('MorphoDecor'), 'タイトルスライドに注入されている');
});
t('装飾: 既存図形の前（本文の背面）に入り、cNvPr id が重複しない', () => {
  assert.ok(slide2.indexOf('MorphoDecor') < slide2.indexOf('<p:ph'), '既存図形より後ろにある');
  const ids = [...slide2.matchAll(/<p:cNvPr id="(\d+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, `id が重複: ${ids.join(',')}`);
});
t('装飾: テーマ参照色・不透明度・直接指定色が XML に出る', () => {
  assert.ok(slide2.includes('<a:schemeClr val="accent1">'));
  assert.ok(slide2.includes('<a:srgbClr val="12AB34"><a:alpha val="15000"/>'));
  assert.ok(slide2.includes('prst="roundRect"'));
});
t('装飾: 番号バッジは ellipse + 中央揃えの白文字で、テキストはエスケープされる', () => {
  assert.ok(slide2.includes('prst="ellipse"'));
  /* 字サイズ = 高さの 45%（617220 EMU = 48.6pt → 2187 = 21.87pt） */
  const m = slide2.match(/<a:rPr lang="ja-JP" sz="(\d+)" b="1">/);
  assert.ok(m, 'バッジの rPr が無い');
  assert.equal(m[1], String(Math.round((617220 / 12700) * 0.45 * 100)));
  assert.ok(slide2.includes('<a:bodyPr anchor="ctr"'));
  assert.ok(slide2.includes('<a:t>3 &lt;&amp;&gt;</a:t>'), 'XML エスケープされていない');
  assert.ok(
    slide2.match(/b="1">\s*<a:solidFill><a:srgbClr val="FFFFFF"\/>/),
    '文字色が白でない',
  );
});

t('装飾: 枠線と塗りなしが XML に出る', () => {
  assert.ok(slide2.includes('prst="star5"'));
  /* noFill: spPr の塗りが <a:noFill/>（枠線の noFill とは別に存在する） */
  const star = slide2.slice(slide2.indexOf('MorphoDecor dtest4'));
  const noFillAt = star.indexOf('<a:noFill/>');
  assert.ok(noFillAt >= 0 && noFillAt < star.indexOf('<a:ln'), '塗りなしになっていない');
  /* 1.5pt = 19050 EMU */
  assert.ok(star.includes('<a:ln w="19050"><a:solidFill><a:srgbClr val="AB12CD">'),
    '枠線の太さ・色が出ていない');
});

t('装飾: グループが p:grpSp に包まれ、外形が bbox・子座標系は恒等', () => {
  assert.ok(slide2.includes('MorphoGroup gtest1'));
  const g = slide2.slice(slide2.indexOf('<p:grpSp>'), slide2.indexOf('</p:grpSp>'));
  assert.ok(g.includes('MorphoDecor dtest1') && g.includes('MorphoDecor dtest2'),
    'メンバーがグループの中にいない');
  assert.ok(!g.includes('MorphoDecor dtest3'), '非メンバーが混入');
  /* bbox: 左上 (0,0) は dtest1、右端 9144000 も dtest1（全幅）、下端 4000000 は dtest2 */
  assert.ok(g.includes('<a:off x="0" y="0"/>'));
  assert.ok(g.includes('<a:ext cx="9144000" cy="4000000"/>'));
  assert.ok(g.includes('<a:chOff x="0" y="0"/>'));
  assert.ok(g.includes('<a:chExt cx="9144000" cy="4000000"/>'));
});

t('装飾: 注入後も zip は壊れず、既存の解析結果が変わらない', () => {
  /* 無地の注入図形はテキストを持たないので、テキスト中心の自前パーサには
     写らないのが正しい（プレビューの装飾はデザインデータから直接描く）。
     バッジはテキストを持つため非プレースホルダ図形として写る。
     ここで確かめるのは「既存の図形とノートを壊していないこと」 */
  const reparsed = win.__morphoParsePptx(new Uint8Array(decorated));
  assert.equal(reparsed.slideCount, parsed.slideCount);
  const phOf = (slide) => slide.shapes.filter((s) => s.placeholder).map((s) => s.placeholder);
  assert.deepEqual(phOf(reparsed.slides[1]), phOf(parsed.slides[1]));
  const extra = reparsed.slides[1].shapes.filter((s) => !s.placeholder);
  assert.equal(extra.length, 1, 'バッジ以外の注入図形が写っている');
  assert.equal(
    extra[0].paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join(''),
    '3 <&>',
    'バッジのテキストが往復で壊れた',
  );
  assert.equal(
    reparsed.slides[1].notes.map((p) => p.runs.map((r) => r.text).join('')).join(''),
    'ノート本文。',
  );
});

console.log(`\n${n} 件すべて通過`);
