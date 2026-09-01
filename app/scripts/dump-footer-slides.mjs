/**
 * スライドごとのフッター（`::: footer`）の設計根拠を実出力から取り直す道具。
 *
 * `notes/footer-design.md` の「スライドごとのフッター（0.17.0 の設計）」の
 * 実測表はこの出力から書いた。機能はまだ実装していないので検査ではない
 * （`dump-footer.mjs` と同じ位置づけ）。
 *
 *   node scripts/dump-footer-slides.mjs
 *
 * 方式: Lua フィルタを使わず、JS のテキスト変換で
 *   `::: footer` を外す → その直前にある「文字の行」の末尾へ ␁文言␂ を付ける
 *   → 既存の expandColumns → pandoc → 出力から ␁…␂ を切り出す
 * 「どのスライドか」は数えずに pandoc に決めさせる。
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { convert } from '../node_modules/pandoc-wasm/src/index.node.js';

/* ブリッジの expandColumns / parsePptx をそのまま借りる（check-deck.mjs と同じ手口） */
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
  validate = (await import('@ooxml-tools/validate')).default;
} catch {
  console.log('※ @ooxml-tools/validate が無いので妥当性検証は飛ばす');
  console.log('   npm install --no-save @ooxml-tools/validate\n');
}
const errs = async (b) => (validate ? (await validate(b, 'pptx', 'Microsoft365')).length : 'skip');

/* ---------- 目印（私用領域の対）。原稿にも書けてしまうので変換境界で潰す前提 ---------- */
const OPEN = '\u{E001}';
const CLOSE = '\u{E002}';

const H_ANY = /^#{1,6}[ \t]/;
const HR = /^ {0,3}([*_-])(?:[ \t]*\1){2,}[ \t]*$/;
const CODE = /^ {0,3}(```|~~~)/;
const NOTES_OPEN = /^[ \t]*:::+[ \t]*(?:\{[^}]*\.notes[^}]*\}|notes\b)/;
const FOOTER_OPEN = /^[ \t]*:::+[ \t]*(?:\{[^}]*\.footer[^}]*\}|footer\b|出典\b)/;
const DIV_CLOSE = /^[ \t]*:::+[ \t]*$/;
/* ATX の閉じ `#` だけを外す。`/[ \t]*#*[ \t]*$/` だと `# C#` が `# C` になる */
const ATX_CLOSE = /[ \t]+#+[ \t]*$/;
const COL_SEP = /^[ \t]*[+＋]([ \t]*[+＋]){2,}[ \t]*$/;
const DIV_ANY = /^[ \t]*:::+/;
const TABLE = /^[ \t]*\|/;
const IMAGE_ONLY = /^[ \t]*!\[[^\]]*\]\([^)]*\)[ \t]*$/;

/**
 * 印を置ける「文字の行」か。
 * 表の行はセルの中身が変わり、画像だけの行は段落が画像に置き換わり、
 * コードフェンス・`+++`・`:::` は記法そのものなので、いずれも避ける。
 */
function isTextLine(line) {
  const t = line.trim();
  if (!t) return false;
  if (HR.test(line) || COL_SEP.test(line) || DIV_ANY.test(line) || CODE.test(line)) return false;
  if (TABLE.test(line) || IMAGE_ONLY.test(line)) return false;
  return true;
}

/**
 * `::: footer` を取り出して、**その直前にある「文字の行」**の末尾へ目印つきで付ける。
 * 段落・箇条書きの項目・見出しのどれでもよい。無ければその区間の見出しへ落とす。
 * 水平線で両方をリセットする（`***` は新しいスライドを開くため）。
 *
 * mode（対照用）:
 *   'text'        既定。直近の文字の行 → 無ければ見出し
 *   'headingOnly' 見出しにしか付けない（`***` のスライドに置けなくなる）
 *   'segment'     区間の最後の見出しへまとめて付ける（slide level 2 で壊れる）
 */
function extractFooters(md, mode = 'text') {
  const lines = md.split('\n');
  const diags = [];
  const kept = [];
  const pending = new Map();
  let textAt = -1;
  let headingAt = -1;
  let code = false;
  let notes = 0;
  let inFooter = false;
  let buf = [];
  const attach = (text) => {
    const at = mode === 'text' && textAt >= 0 ? textAt : headingAt;
    if (at < 0) {
      diags.push({ kind: 'design', label: 'このスライドには文字の行が無いので出典を置けません', count: 1 });
      return;
    }
    const arr = pending.get(at) ?? [];
    arr.push(text);
    pending.set(at, arr);
  };
  for (const line of lines) {
    if (CODE.test(line)) { code = !code; kept.push(line); continue; }
    if (code) { kept.push(line); continue; }
    /* ノートの中は触らない。発表者にだけ見せる内容が表に出ないようにする */
    if (notes > 0) { kept.push(line); if (DIV_CLOSE.test(line)) notes -= 1; continue; }
    if (NOTES_OPEN.test(line)) { notes += 1; kept.push(line); continue; }
    if (inFooter) {
      if (DIV_CLOSE.test(line)) { inFooter = false; attach(buf.join(' ').trim()); buf = []; }
      else buf.push(line.trim());
      continue;
    }
    if (FOOTER_OPEN.test(line)) { inFooter = true; continue; }
    if (HR.test(line)) { textAt = -1; headingAt = -1; }
    else if (H_ANY.test(line)) { headingAt = kept.length; textAt = -1; }
    else if (isTextLine(line)) textAt = kept.length;
    kept.push(line);
  }
  if (mode === 'segment') {
    const all = [...pending.values()].flat();
    pending.clear();
    let last = -1;
    for (let i = 0; i < kept.length; i++) if (H_ANY.test(kept[i])) last = i;
    if (all.length && last >= 0) pending.set(last, all);
  }
  for (const [i, arr] of pending) {
    const joined = arr.filter((x) => x !== '').join(' / ');
    kept[i] = H_ANY.test(kept[i])
      ? kept[i].replace(ATX_CLOSE, '') + OPEN + joined + CLOSE
      : kept[i] + OPEN + joined + CLOSE;
  }
  return { md: kept.join('\n'), diags };
}

/** 出力から目印区間を切り出し、XML を原状復帰させる。返すのは断片の**生 XML** */
function harvestFooters(zip) {
  const dec = new TextDecoder();
  const found = {};
  const re = new RegExp(OPEN + '([\\s\\S]*?)' + CLOSE, 'g');
  for (const name of Object.keys(zip)) {
    const m = /^ppt\/slides\/slide(\d+)\.xml$/.exec(name);
    if (!m) continue;
    let xml = dec.decode(zip[name]);
    if (xml.indexOf(OPEN) < 0) continue;
    const parts = [];
    xml = xml.replace(re, (_s, t) => { parts.push(t); return ''; });
    zip[name] = strToU8(xml);
    found[Number(m[1])] = parts.join(' / ');
  }
  return found;
}

const toPptx = async (md, meta, files) => {
  const r = await convert({
    from: 'markdown-yaml_metadata_block+east_asian_line_breaks',
    to: 'pptx', 'output-file': 'o.pptx', ...(meta ? { metadata: meta } : {}),
  }, md, files ?? {});
  return new Uint8Array(await r.files['o.pptx'].arrayBuffer());
};

/** 枚数とレイアウト内訳。枚数だけ見ると落とし穴 4 型の壊れ方を見逃す */
function shape(bytes) {
  const z = unzipSync(bytes);
  const names = Object.keys(z).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  const dist = {};
  for (const n of names) {
    const rels = strFromU8(z[n.replace('slides/', 'slides/_rels/') + '.rels']);
    const lay = /slideLayouts\/(slideLayout\d+\.xml)/.exec(rels)?.[1];
    const nm = lay ? /<p:cSld name="([^"]*)"/.exec(strFromU8(z['ppt/slideLayouts/' + lay]))?.[1] : '?';
    dist[nm] = (dist[nm] || 0) + 1;
  }
  return `${names.length}枚 ${JSON.stringify(dist)}`;
}

/** アプリと同じ順: フッター抽出 → 段組み展開 → 変換 → 目印の取り出し */
async function run(md, { meta, files, mode } = {}) {
  const f = extractFooters(md, mode);
  const c = win.__morphoExpandColumns(f.md);
  const bytes = await toPptx(c.md, meta, files);
  const zip = unzipSync(bytes);
  const found = harvestFooters(zip);
  return { bytes, zip, found, diags: [...f.diags, ...c.diags], hoisted: f.md };
}
const stripFooters = (md) => md.replace(/:::[ \t]*(?:footer|出典)[\s\S]*?\n:::[ \t]*\n/g, '');
const titleOf = (zip, n) =>
  /<p:ph type="title"[\s\S]*?<a:t>([\s\S]*?)<\/a:t>/.exec(strFromU8(zip['ppt/slides/slide' + n + '.xml']))?.[1] ?? null;

/* ---------- 1. どのスライドへ着地するか ---------- */

console.log('='.repeat(72));
console.log('1. 目印の付け先 — slide level 1 / 2');
console.log('='.repeat(72));

const L1 = '# 一枚目\n\n本文1。\n\n::: footer\n出典A\n:::\n\n# 二枚目\n\n本文2。\n\n::: footer\n出典B\n:::\n';
const L2 = '# 章\n\n## 節1\n\n本文1。\n\n::: footer\n出典A\n:::\n\n## 節2\n\n本文2。\n\n::: footer\n出典B\n:::\n';
for (const [name, md] of [['slide level 1（# の下は本文）', L1], ['slide level 2（# の下に ##）', L2]]) {
  const ctrl = shape(await toPptx(win.__morphoExpandColumns(stripFooters(md)).md));
  const ok = await run(md);
  const ng = await run(md, { mode: 'segment' });
  console.log(`${name}`);
  console.log(`  対照            ${ctrl}`);
  console.log(`  直前の文字の行へ    ${shape(ok.bytes).padEnd(46)} 着地 ${JSON.stringify(ok.found)}`);
  console.log(`  区間の最後の見出しへ ${shape(ng.bytes).padEnd(46)} 着地 ${JSON.stringify(ng.found)}`);
}
console.log('  ← 「区間の最後」だと slide level 2 で 1 枚に寄る。だから「直前」でなければならない');

/* ---------- 2. 他の記法との相互作用 ---------- */

console.log('\n' + '='.repeat(72));
console.log('2. 段組み（+++）・ノート・水平線・表との相互作用');
console.log('='.repeat(72));

const PIX = new Uint8Array([
  0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0x0d,0x49,0x48,0x44,0x52,
  0,0,0,1,0,0,0,1,8,6,0,0,0,0x1f,0x15,0xc4,0x89,0,0,0,0x0a,0x49,0x44,0x41,
  0x54,0x78,0x9c,0x63,0,1,0,0,5,0,1,0x0d,0x0a,0x2d,0xb4,0,0,0,0,0x49,0x45,
  0x4e,0x44,0xae,0x42,0x60,0x82,
]);
const files = { 'pix.png': new Blob([PIX]) };
for (const [name, md] of Object.entries({
  '段組みと同じ区間': '# 三つの案\n\n案A\n\n+++\n\n案B\n\n::: footer\n出典C\n:::\n',
  'フッターが段組みより前': '# 三つの案\n\n::: footer\n出典C\n:::\n\n案A\n\n+++\n\n案B\n',
  'ノートの中の footer': '# 見出し\n\n本文。\n\n::: notes\n発表者メモ\n::: footer\nノート内の出典\n:::\n:::\n',
  '*** + 本文': '# H\n\n本文1。\n\n***\n\n本文2。\n\n::: footer\n出典D\n:::\n',
  '*** + 箇条書き': '# H\n\n本文1。\n\n***\n\n- 項目A\n- 項目B\n\n::: footer\n出典D\n:::\n',
  '*** + 表だけ': '# H\n\n本文1。\n\n***\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n::: footer\n出典D\n:::\n',
  '見出し + 表だけ': '# 表のスライド\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n::: footer\n出典T\n:::\n',
  '表の後ろの段落で割れる': '# 結果\n\n導入。\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n表の下の注釈。\n\n::: footer\n出典S\n:::\n',
  '最初の見出しより前': '::: footer\n出典E\n:::\n\n# H\n\n本文。\n',
  '表のあるスライド': '# 表\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n::: footer\n出典F\n:::\n',
  'フッターに画像': '# H\n\n本文。\n\n::: footer\n![](pix.png) 出典\n:::\n',
})) {
  const ctrl = shape(await toPptx(win.__morphoExpandColumns(stripFooters(md)).md, null, files));
  const r = await run(md, { files });
  const h = await run(md, { files, mode: 'headingOnly' });
  const got = shape(r.bytes);
  const pics = Object.keys(r.zip).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .reduce((a, n) => a + (strFromU8(r.zip[n]).match(/<p:pic>/g) || []).length, 0);
  console.log(`${name.padEnd(20)} ${got === ctrl ? '構成そのまま' : '★構成が変わる'} ${got}`);
  console.log(`${' '.repeat(20)} 着地 ${JSON.stringify(r.found)}`
    + ` 画像 ${pics}`
    + (r.diags.length ? ` 診断「${r.diags[0].label}」` : ''));
  if (JSON.stringify(h.found) !== JSON.stringify(r.found)) {
    console.log(`${' '.repeat(20)} （見出しだけ版なら ${JSON.stringify(h.found)}`
      + (h.diags.length ? ` 診断「${h.diags[0].label}」` : '') + '）');
  }
}
console.log('  ← ノートの中の footer はスライド本体に出ない（発表者にだけ見せる内容が漏れない）');
console.log('  ← 見出しだけに付ける版だと *** のスライドに置けない。文字の行に付ければ置ける');

/* ---------- 3. benchmark で端から端まで ---------- */

console.log('\n' + '='.repeat(72));
console.log('3. fixtures/pptx-benchmark.md に 7 か所差す');
console.log('='.repeat(72));

const bench = readFileSync(new URL('../../fixtures/pptx-benchmark.md', import.meta.url), 'utf8');
const fm = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(bench);
const meta = {};
if (fm) {
  for (const l of fm[1].split('\n')) {
    const kv = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(l);
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
}
const body = fm ? bench.slice(fm[0].length) : bench;
const ctrlBench = shape(await toPptx(win.__morphoExpandColumns(body).md, meta));
let put = 0;
const withFooters = [];
for (const line of body.split('\n')) {
  withFooters.push(line);
  if (/^##[ \t]/.test(line) && put < 7) withFooters.push('', '::: footer', `出典F${++put}`, ':::');
}
const rb = await run(withFooters.join('\n'), { meta });
console.log(`対照        ${ctrlBench}`);
console.log(`フッター入り   ${shape(rb.bytes)}`);
console.log(`構成が変わらないか: ${shape(rb.bytes) === ctrlBench}`);
console.log(`着地 ${JSON.stringify(rb.found)}（差した数 ${put}）`);
console.log(`目印の残留: ${Object.keys(rb.zip).some((n) => /slide\d+\.xml$/.test(n) && strFromU8(rb.zip[n]).includes(OPEN))}`);

/* ---------- 4. 断片の移送（リンクを保つ） ---------- */

console.log('\n' + '='.repeat(72));
console.log('4. 目印区間の生 XML を新しい図形へ移す');
console.log('='.repeat(72));

const BAND = { x: 457200, y: 4767263, w: 8229600, h: 273844 };
const footerSp = (runsXml, id) =>
  '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="MorphoFooter"/>'
  + '<p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'
  + '<p:spPr><a:xfrm><a:off x="' + BAND.x + '" y="' + BAND.y + '"/>'
  + '<a:ext cx="' + BAND.w + '" cy="' + BAND.h + '"/></a:xfrm>'
  + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>'
  + '<p:txBody><a:bodyPr anchor="ctr" wrap="square"/><a:lstStyle/>'
  + '<a:p><a:pPr marL="0" indent="0" algn="r"><a:buNone/></a:pPr>' + runsXml + '</a:p></p:txBody></p:sp>';

const MD_LINK = '# 見出し\n\n本文。\n\n::: footer\n[NEJM](https://doi.org/10.1056/x) **2024**\n:::\n';
const rl = await run(MD_LINK);
const frag = rl.found[1];
console.log('取り出した断片:', JSON.stringify(frag).slice(0, 150) + '…');
console.log('タイトルが元へ戻ったか:', JSON.stringify(titleOf(rl.zip, 1)));
console.log('切り出したままだとスライドが rId を参照しないか（孤児 rel になる）:',
  !/r:id="rId\d+"/.test(strFromU8(rl.zip['ppt/slides/slide1.xml'])));

/* 断片は「</a:t></a:r> … <a:r><a:rPr/><a:t>」の形で取れるので、両端を補って段落にする */
const runs = frag.startsWith('</a:t></a:r>')
  ? frag.replace(/^<\/a:t><\/a:r>/, '').replace(/<a:r><a:rPr \/><a:t>$/, '')
  : '<a:r><a:rPr/><a:t>' + frag + '</a:t></a:r>';
const zl = rl.zip;
let xml = strFromU8(zl['ppt/slides/slide1.xml']);
let maxId = 0;
for (const m of xml.matchAll(/\bid="(\d+)"/g)) maxId = Math.max(maxId, +m[1]);
zl['ppt/slides/slide1.xml'] = strToU8(xml.replace('</p:spTree>', footerSp(runs, maxId + 1) + '</p:spTree>'));
const moved = zipSync(zl);
console.log('移送後の検証:', await errs(moved), '件');
console.log('リンクが図形に残ったか:',
  /name="MorphoFooter"[\s\S]*?hlinkClick/.test(strFromU8(unzipSync(moved)['ppt/slides/slide1.xml'])));
const parsed = win.__morphoParsePptx(moved);
const fsp = parsed.slides[0].shapes.find((s) =>
  s.paragraphs.some((p) => p.runs.some((r) => r.text.includes('NEJM'))));
console.log('パーサが読むラン:', JSON.stringify(fsp?.paragraphs[0].runs));

/* ---------- 5. a:rPr の子要素順 ---------- */

console.log('\n' + '='.repeat(72));
console.log('5. a:rPr の子要素順（色は hlinkClick より前でなければならない）');
console.log('='.repeat(72));
const FILL = '<a:solidFill><a:srgbClr val="7F7F7F"/></a:solidFill>';
const LINK = '<a:hlinkClick r:id="rId2"/>';
for (const [name, inner] of [['色 → リンク（規格順）', FILL + LINK], ['リンク → 色（逆順）', LINK + FILL]]) {
  const z = unzipSync(rl.bytes);
  let x = strFromU8(z['ppt/slides/slide1.xml']).replace(new RegExp(OPEN + '[\\s\\S]*?' + CLOSE, 'g'), '');
  let mi = 0;
  for (const m of x.matchAll(/\bid="(\d+)"/g)) mi = Math.max(mi, +m[1]);
  const r = '<a:r><a:rPr lang="ja-JP" sz="900">' + inner + '</a:rPr><a:t>NEJM</a:t></a:r>';
  z['ppt/slides/slide1.xml'] = strToU8(x.replace('</p:spTree>', footerSp(r, mi + 1) + '</p:spTree>'));
  console.log(`${name.padEnd(22)} 検証 ${await errs(zipSync(z))} 件`);
}

/* ---------- 6. 取り出しのコスト ---------- */

console.log('\n' + '='.repeat(72));
console.log('6. 取り出しのコスト（プレビューは zip を作り直さない）');
console.log('='.repeat(72));
const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
const tHarvest = [];
const tRezip = [];
for (let i = 0; i < 10; i++) {
  let s0 = performance.now();
  harvestFooters(unzipSync(rb.bytes));
  tHarvest.push(performance.now() - s0);
  s0 = performance.now();
  const z = unzipSync(rb.bytes);
  harvestFooters(z);
  zipSync(z);
  tRezip.push(performance.now() - s0);
}
console.log(`unzip + 取り出し          : ${med(tHarvest).toFixed(1)}ms   ← プレビューはここまで`);
console.log(`unzip + 取り出し + 再 zip : ${med(tRezip).toFixed(1)}ms   ← 書き出しだけ`);
console.log('  ← 差のほとんどは zipSync。プレビュー経路で再 zip しないために');
console.log('     parsePptx を展開済み zip 受け取りへ変える必要がある');
