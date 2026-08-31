/**
 * フッター（出典・注釈）機能の設計根拠を実出力から取り直す道具。
 *
 * notes/footer-design.md の「実測で確定した事実」の表は、この出力から書いた。
 * 推測で設計しないための道具であって、機能の検査ではない（機能は未実装）。
 *
 *   node scripts/dump-footer.mjs
 *
 * 見るもの:
 *   1. pandoc 既定テンプレートのフッター帯（master / layout / 出力スライド）
 *   2. `::: footer` 記法が pptx / docx / html で実際に何になるか
 *   3. デッキ全体フッターの注入（表紙以外の全スライドへ textbox）が
 *      整形式・スキーマ妥当・パーサ往復に耐えるか
 *
 * @ooxml-tools/validate があればスキーマ検証まで行う（devDependency ではない。
 * `npm install --no-save @ooxml-tools/validate` で入る）。
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { convert } from '../node_modules/pandoc-wasm/src/index.node.js';

const EMU_W = 9144000;
const EMU_H = 5143500;
const pct = (v, total) => ((v / total) * 100).toFixed(2) + '%';
const pt = (emu) => (emu / 12700).toFixed(1) + 'pt';

/* ブリッジの parsePptx をそのまま借りる（check-deck.mjs と同じ手口） */
const src = readFileSync(new URL('../src/converter/bridgeHtml.ts', import.meta.url), 'utf8');
const decl = src.indexOf('export const BRIDGE_HTML');
const open = src.indexOf('`', decl);
const html = new Function('return `' + src.slice(open + 1, src.lastIndexOf('`')) + '`')();
const mod = /<script type="module">([\s\S]*?)<\/script>/.exec(html)[1]
  .replace(/^\s*import\s[^\n]*\n/gm, '');
const win = { __rn: () => {} };
runInContext(mod, createContext({
  window: win, fetch: () => new Promise(() => {}),
  unzipSync, zipSync, strToU8, performance, TextDecoder, WebAssembly, console, Promise,
}));

let validate = null;
try {
  /* 名前つき export は無く default が本体（README の 2 引数シグネチャも古い） */
  validate = (await import('@ooxml-tools/validate')).default;
} catch {
  console.log('※ @ooxml-tools/validate が無いのでスキーマ検証は飛ばす');
  console.log('   npm install --no-save @ooxml-tools/validate\n');
}
const schemaErrors = async (bytes) => {
  if (!validate) return null;
  const r = await validate(bytes, 'pptx', 'Microsoft365');
  return (Array.isArray(r) ? r : (r.errors ?? [])).length;
};

const toPptx = (md, opts = {}) =>
  convert({ from: 'markdown-yaml_metadata_block', to: 'pptx', 'output-file': 'o.pptx', ...opts }, md, {});

/* ---------- 1. pandoc 既定テンプレートのフッター帯 ---------- */

console.log('='.repeat(72));
console.log('1. pandoc 既定テンプレートのフッター帯');
console.log('='.repeat(72));

const base = new Uint8Array(await (await toPptx('# 見出し\n\n- 本文\n')).files['o.pptx'].arrayBuffer());
const zip = unzipSync(base);

const spsOf = (part) => [...strFromU8(zip[part]).matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((m) => m[0]);
const describe = (sp) => {
  const ph = /<p:ph[^>]*>/.exec(sp)?.[0] ?? '(ph なし)';
  const off = /<a:off\s+x="(-?\d+)"\s+y="(-?\d+)"/.exec(sp);
  const ext = /<a:ext\s+cx="(\d+)"\s+cy="(\d+)"/.exec(sp);
  return {
    type: /type="([a-zA-Z]+)"/.exec(ph)?.[1] ?? null,
    idx: /idx="(\d+)"/.exec(ph)?.[1] ?? null,
    off: off && { x: +off[1], y: +off[2] },
    ext: ext && { cx: +ext[1], cy: +ext[2] },
    sz: /<a:defRPr[^>]*\bsz="(\d+)"/.exec(sp)?.[1] ?? null,
    algn: /<a:lvl1pPr[^>]*\balgn="([a-z]+)"/.exec(sp)?.[1] ?? null,
    anchor: /<a:bodyPr[^>]*\banchor="([a-z]+)"/.exec(sp)?.[1] ?? null,
  };
};

console.log(`スライド寸法 ${EMU_W} x ${EMU_H} EMU（${(EMU_W / 914400).toFixed(3)} x ${(EMU_H / 914400).toFixed(3)} in）\n`);
console.log('slideMaster1.xml:');
for (const d of spsOf('ppt/slideMasters/slideMaster1.xml').map(describe)) {
  console.log(
    `  ${String(d.type ?? '-').padEnd(8)} idx=${String(d.idx ?? '-').padEnd(3)}`,
    d.off ? `off=(${d.off.x},${d.off.y}) y=${pct(d.off.y, EMU_H)}` : 'off=なし',
    d.ext ? `ext=(${d.ext.cx},${d.ext.cy}) ${pt(d.ext.cx)}x${pt(d.ext.cy)}` : 'ext=なし',
    d.sz ? `sz=${d.sz}` : '', d.algn ? `algn=${d.algn}` : '', d.anchor ? `anchor=${d.anchor}` : '',
  );
}

const layouts = Object.keys(zip)
  .filter((n) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(n))
  .sort((a, b) => Number(/(\d+)/.exec(a)[1]) - Number(/(\d+)/.exec(b)[1]));
const ftrInLayouts = layouts.map((n) => {
  const sp = spsOf(n).find((s) => /type="ftr"/.test(s));
  return { n, has: !!sp, geom: sp ? describe(sp) : null };
});
console.log(`\nレイアウト ${layouts.length} 枚のうち ftr を持つもの: ${ftrInLayouts.filter((f) => f.has).length} 枚`);
console.log(`  そのうち座標を持つもの: ${ftrInLayouts.filter((f) => f.geom?.off).length} 枚`
  + '  ← レイアウトは空の <p:spPr/> でマスターへ継承する');

const slideNames = Object.keys(zip).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
const ftrInSlides = slideNames.filter((n) => /type="ftr"/.test(strFromU8(zip[n]))).length;
console.log(`\npandoc が出力したスライド ${slideNames.length} 枚のうち ftr の sp を持つもの: ${ftrInSlides} 枚`);
console.log('  ← 枠は用意されているが中身は空。フッターは変換のたびに注入する必要がある');

/* ---------- 2. `::: footer` 記法が各形式で何になるか ---------- */

console.log('\n' + '='.repeat(72));
console.log('2. `::: footer` 記法が各形式で何になるか');
console.log('='.repeat(72));

const MD = '# 見出し\n\n本文の段落。\n\n::: footer\nN Engl J Med 2024;390:1234-45\n:::\n';

const p = unzipSync(new Uint8Array(await (await toPptx(MD)).files['o.pptx'].arrayBuffer()));
const slide1 = strFromU8(p['ppt/slides/slide1.xml']);
const paras = [...slide1.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)].map((m) => m[0]);
console.log('pptx: 本文プレースホルダの段落');
for (const par of paras) {
  const t = [...par.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => m[1]).join('');
  if (t) console.log(`  ${JSON.stringify(t)}  pPr=${/<a:pPr[^>]*>/.exec(par)?.[0] ?? 'なし'}`);
}
console.log('  ← 出典段落は本文段落と 1 バイトも変わらない。クラス名は出力に残らない');

const d = unzipSync(new Uint8Array(await (await convert(
  { from: 'markdown-yaml_metadata_block', to: 'docx', 'output-file': 'o.docx' }, MD, {},
)).files['o.docx'].arrayBuffer()));
console.log('\ndocx: 段落スタイル');
for (const m of strFromU8(d['word/document.xml']).matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) {
  const t = [...m[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((x) => x[1]).join('');
  if (t) console.log(`  pStyle=${/<w:pStyle w:val="([^"]+)"/.exec(m[0])?.[1] ?? '-'} :: ${t}`);
}
console.log(`  word/footer*.xml は ${Object.keys(d).filter((n) => /footer/.test(n)).length} 個`
  + '  ← docx には受け皿が最初から無い');

const h = (await convert(
  { from: 'markdown-yaml_metadata_block', to: 'html', 'output-file': 'o.html', standalone: true }, MD, {},
)).files['o.html'];
const htmlOut = await h.text();
console.log('\nhtml:', /<div class="footer">[\s\S]*?<\/div>/.exec(htmlOut)?.[0].replace(/\n/g, ' ') ?? '(見つからない)');
console.log(`  既定 CSS に .footer 規則があるか: ${/\.footer\s*\{/.test(htmlOut)}`
  + '  ← 無いので </head> 直前注入で衝突なく足せる');

/* ---------- 3. デッキ全体フッターの注入 ---------- */

console.log('\n' + '='.repeat(72));
console.log('3. デッキ全体フッターの注入（表紙以外の全スライドへ textbox）');
console.log('='.repeat(72));

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 帯の EMU。テンプレートが ftr を持てばその y/h を借り、幅だけ全幅へ広げる */
function footerBand(master) {
  const sp = [...strFromU8(master).matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)]
    .map((m) => m[0]).find((s) => /type="ftr"/.test(s));
  const g = sp && describe(sp);
  const margin = Math.round(EMU_W * 0.05);
  if (g?.off && g?.ext) return { x: margin, y: g.off.y, w: EMU_W - margin * 2, h: g.ext.cy, from: 'テンプレートの ftr 帯' };
  return { x: margin, y: Math.round(EMU_H * 0.9268), w: EMU_W - margin * 2, h: Math.round(EMU_H * 0.0532), from: '比率の既定値' };
}

/* ECMA-376 の子要素順: nvSpPr(cNvPr → cNvSpPr → nvPr) → spPr → txBody */
function footerSp(id, text, band, { sz = 900, algn = 'r' } = {}) {
  return '<p:sp><p:nvSpPr>'
    + `<p:cNvPr id="${id}" name="MorphoFooter"/>`
    + '<p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'
    + `<p:spPr><a:xfrm><a:off x="${band.x}" y="${band.y}"/><a:ext cx="${band.w}" cy="${band.h}"/></a:xfrm>`
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>'
    + '<p:txBody><a:bodyPr anchor="ctr" wrap="square"/><a:lstStyle/>'
    + `<a:p><a:pPr marL="0" indent="0" algn="${algn}"><a:buNone/></a:pPr>`
    + `<a:r><a:rPr lang="ja-JP" sz="${sz}"><a:solidFill><a:srgbClr val="7F7F7F"/></a:solidFill></a:rPr>`
    + `<a:t>${esc(text)}</a:t></a:r></a:p></p:txBody></p:sp>`;
}

function injectDeckFooter(bytes, text, { onCover = false } = {}) {
  const z = unzipSync(bytes);
  const band = footerBand(z['ppt/slideMasters/slideMaster1.xml']);
  let injected = 0;
  for (const name of Object.keys(z).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))) {
    const xml = strFromU8(z[name]);
    /* 表紙は ctrTitle を持つスライドで判定する（レイアウト名は配線盤が書き換えるため） */
    if (!onCover && /type="ctrTitle"/.test(xml)) continue;
    if (/name="MorphoFooter"/.test(xml)) continue; /* 冪等性は注入側で担保する */
    let maxId = 0;
    for (const m of xml.matchAll(/\bid="(\d+)"/g)) maxId = Math.max(maxId, +m[1]);
    const at = xml.indexOf('</p:spTree>');
    z[name] = strToU8(xml.slice(0, at) + footerSp(maxId + 1, text, band) + xml.slice(at));
    injected++;
  }
  return { bytes: zipSync(z), injected, band };
}

const DECK = '---\ntitle: 抄読会\nauthor: 研修医\n---\n\n' + Array.from({ length: 5 },
  (_, i) => `# ${i + 1} 枚目\n\n本文${i + 1}。\n`).join('\n');
const { metadata, body } = (() => {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(DECK);
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { metadata: meta, body: DECK.slice(m[0].length) };
})();

const deckBytes = new Uint8Array(await (await toPptx(body, { metadata })).files['o.pptx'].arrayBuffer());
const before = win.__morphoParsePptx(deckBytes);
const CITE = 'Smith & Jones <2024> N Engl J Med 2024;390:1234-45';
const out = injectDeckFooter(deckBytes, CITE);
const after = win.__morphoParsePptx(out.bytes);

console.log(`帯の出どころ: ${out.band.from}`);
console.log(`帯: x=${out.band.x} y=${out.band.y} w=${out.band.w} h=${out.band.h}`
  + `  (y=${pct(out.band.y, EMU_H)} h=${pct(out.band.h, EMU_H)} 幅 ${pt(out.band.w)})`);
console.log(`スライド ${before.slideCount} 枚 → 注入 ${out.injected} 枚（表紙は除外）`);
console.log(`注入後のスライド数: ${after.slideCount}  変化なし: ${before.slideCount === after.slideCount}`);

const last = after.slides[after.slides.length - 1];
const fs = last.shapes.find((s) => s.paragraphs.some((q) => q.runs.some((r) => r.text.includes('N Engl'))));
console.log('パーサが読み戻した図形:', JSON.stringify({
  placeholder: fs?.placeholder, frame: fs?.frame, bullet: fs?.paragraphs[0].bullet,
  algn: fs?.paragraphs[0].algn, text: fs?.paragraphs[0].runs[0].text,
}));
console.log(`  文言が往復したか: ${fs?.paragraphs[0].runs[0].text === CITE}`
  + '  ← & < > は 1 度だけエスケープする（抽出した文字列は再エスケープしない）');

const errs = await schemaErrors(out.bytes);
if (errs !== null) {
  /* 較正: わざと ECMA-376 違反（spPr と txBody の順を入れ替え）を作って検証器が鳴るか見る */
  const bad = (() => {
    const z = unzipSync(deckBytes);
    const n = 'ppt/slides/slide2.xml';
    const xml = strFromU8(z[n]);
    const sp = footerSp(99, CITE, out.band)
      .replace(/(<p:spPr>[\s\S]*?<\/p:spPr>)(<p:txBody>[\s\S]*?<\/p:txBody>)/, '$2$1');
    z[n] = strToU8(xml.replace('</p:spTree>', sp + '</p:spTree>'));
    return zipSync(z);
  })();
  console.log(`\n@ooxml-tools/validate: 素の pandoc 出力 ${await schemaErrors(deckBytes)} 件`
    + ` / フッター注入後 ${errs} 件 / 較正（子要素順を壊した版）${await schemaErrors(bad)} 件`);
  console.log('  ← 較正が 0 件だと検証器が何も見ていないことになる。必ず一緒に測る');
}
