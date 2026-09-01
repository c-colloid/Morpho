/**
 * フッターの記法を決めるために測ったものを取り直す道具。
 *
 * `notes/footer-design.md` の「記法の選定（あとから測り直した）」の表はこの出力から書いた。
 * 機能の検査ではない（`dump-footer.mjs` / `dump-footer-slides.mjs` と同じ位置づけ）。
 *
 *   node scripts/dump-footer-notation.mjs
 *
 * 測るもの:
 *   1. 候補記号を素の pandoc に通したときに何が残るか（記号が黙って減る候補を落とす）
 *   2. `::: footer` の打ち間違い 20 通り（データロスと枚数変化が出るか）
 *   3. 柵の閉じ忘れが後続スライドを飲むか
 *   4. 一般文で踏むか（記号 / 行頭キーワード / ※）
 *   5. `///` の挙動（全角・コードフェンス・notes・段組み・表のあと）
 */
import { unzipSync, strFromU8 } from 'fflate';
import { convert } from '../node_modules/pandoc-wasm/src/index.node.js';

const CITE = '出典: N Engl J Med 2024;390:1234-45';

/* アプリの実 READER に揃える（EALB あり・なしで本スクリプトの全出力が一致することは
   v2 監査 T01 で実測済み — 61 変換 × 2 READER で本体 md5 一致） */
const toPptx = async (md) => {
  const r = await convert(
    { from: 'markdown-yaml_metadata_block+east_asian_line_breaks', to: 'pptx', 'output-file': 'o.pptx' },
    md,
    {},
  );
  return {
    bytes: new Uint8Array(await r.files['o.pptx'].arrayBuffer()),
    warns: (r.warnings ?? []).filter((w) => w.verbosity !== 'INFO'),
  };
};

/** 枚数・レイアウト内訳・文字。枚数だけ見ると落とし穴 4 型の壊れ方を見逃す */
function shape(bytes) {
  const z = unzipSync(bytes);
  const names = Object.keys(z)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  const lay = names.map((n) => {
    const rel = strFromU8(z[n.replace('slides/', 'slides/_rels/') + '.rels']);
    const m = /slideLayout(\d+)\.xml/.exec(rel);
    return m ? m[1] : '?';
  });
  const text = names.map((n) =>
    [...strFromU8(z[n]).matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => m[1]).join('␣'),
  );
  return { n: names.length, lay: lay.join(','), text };
}

/* ---------------- 1. 候補記号 ---------------- */
console.log('=== 1. 候補記号を素の pandoc に通す（前置き形 `MARK 出典: …`）===');
console.log('   記号が黙って減る／別の約物へ変わるものは記法に使えない\n');
const MARKS = ['///', '^^^', '~~~', '...', '--', '%%%', '@@@', ',,,', '!!!', '???', '===', '___', '>>>', '|||', '+++', '***', '※'];
for (const m of MARKS) {
  const { bytes, warns } = await toPptx(`# 結果\n\n本文。\n\n${m} ${CITE}\n`);
  const s = shape(bytes);
  const shown = s.text.join(' | ').replace(/^結果␣本文。␣/, '');
  const kept = shown.startsWith(m.replace(/&/g, '&amp;'));
  console.log(`   ${m.padEnd(4)} ${s.n}枚 警告${warns.length} ${kept ? '記号は残る' : '★記号が変わる'}  ${shown}`);
}

/* ---------------- 2. 打ち間違い 20 通り ---------------- */
const V = [
  ['正解', '::: footer', ':::'],
  ['空白なし', ':::footer', ':::'],
  ['波括弧つき', '::: {.footer}', ':::'],
  ['日本語別名', '::: 出典', ':::'],
  ['全角コロン', '：：： footer', '：：：'],
  ['全角スペース', '::: 　footer', ':::'],
  ['大文字', '::: Footer', ':::'],
  ['複数形タイポ', '::: footers', ':::'],
  ['綴りタイポ', '::: fotter', ':::'],
  ['コロン 2 個', ':: footer', '::'],
  ['コロン 4 個', ':::: footer', '::::'],
  ['閉じ忘れ', '::: footer', null],
  ['閉じが全角', '::: footer', '：：：'],
  ['字下げ', '  ::: footer', '  :::'],
  ['ドット忘れ', '::: {footer}', ':::'],
  ['クラス 2 つ', '::: {.footer .small}', ':::'],
  ['閉じに空白', '::: footer', '::: '],
  ['和名クラス', '::: {.フッター}', ':::'],
  ['波括弧が全角', '::: ｛.footer｝', ':::'],
  ['2 語', '::: footer small', ':::'],
];
console.log('\n=== 2. `::: footer` の打ち間違い 20 通り ===');
let loss = 0;
let split = 0;
for (const [name, open, close] of V) {
  const md = `# 結果\n\n本文。\n\n${open}\n${CITE}\n${close === null ? '' : close + '\n'}`;
  const { bytes, warns } = await toPptx(md);
  const s = shape(bytes);
  const all = s.text.join(' | ');
  const kept = all.includes('N Engl J Med');
  const raw = /:{2,}|：：/.test(all);
  if (!kept) loss++;
  if (s.n !== 1) split++;
  console.log(
    `   ${name.padEnd(7)} \`${open.replace(/　/g, '□')}\` → ${s.n}枚 警告${warns.length} ` +
      `出典:${kept ? '残る' : '★消える'} ${raw ? '生の柵が出る' : ''}`,
  );
}
console.log(`   → データロス ${loss} / 20、枚数が変わった ${split} / 20`);

/* ---------------- 3. 閉じ忘れ + 後続スライド ---------------- */
console.log('\n=== 3. 柵の閉じ忘れは後続スライドを飲む（2 の掃き出しでは後続が無くて見えなかった）===');
{
  const md = `# 結果A\n\n本文A。\n\n::: footer\n出典A\n\n# 結果B\n\n本文B。\n`;
  const ctrl = md.replace('::: footer\n出典A\n\n', '');
  const a = await toPptx(md);
  const b = await toPptx(ctrl);
  console.log(`   閉じ忘れ: ${shape(a.bytes).n}枚 警告${a.warns.length}  対照(フッター無し): ${shape(b.bytes).n}枚`);
  console.log(`   ${JSON.stringify(shape(a.bytes).text)}`);
}

/* ---------------- 4. 一般文で踏むか ---------------- */
const normalize = (l) => l.replace(/：/g, ':').replace(/　/g, ' ').replace(/｛/g, '{').replace(/｝/g, '}');
const FENCE = (l) =>
  /^[ \t]*:::+[ \t]*(?:\{[ \t]*\.?(?:footer|出典|注釈)[^}]*\}|(?:footer|出典|注釈))/i.test(
    normalize(l).replace(/^([ \t]*:::+)(?=[^ \t:])/, '$1 '),
  );
const SLASH = /^[ \t]*[/／]([ \t]*[/／]){2,}[ \t]*(.*)$/;
const KEY = /^[ \t]*(?:出典|出所|注|注釈)[:：]/;
const KOME = /^[ \t]*※/;
const PROSE = [
  '出典：厚生労働省の統計による',
  '出典が明記されていない図は使わない',
  '※ 用量は添付文書を確認すること',
  '※本試験は単施設である',
  '注：per-protocol 解析',
  '::: footer',
  '::: notes',
  '一次評価項目は死亡率だった',
  '- 出典: 各群の内訳は表2',
  '  ※ 補足',
  '出典 なし',
  'この薬の出典：不明',
];
console.log('\n=== 4. 一般文で踏むか（柵 / `///` / 行頭キーワード / ※）===');
for (const l of PROSE) {
  console.log(
    `   ${FENCE(l) ? '●' : '－'} ${SLASH.test(l) ? '●' : '－'} ${KEY.test(l) ? '●' : '－'} ${KOME.test(l) ? '●' : '－'}  ${l}`,
  );
}
const cnt = (f) => PROSE.filter((l) => f(l)).length;
console.log(
  `   誤爆: 柵 ${cnt(FENCE) - 1}（1 件は本物の記法）/ /// ${cnt((l) => SLASH.test(l))} / ` +
    `キーワード ${cnt((l) => KEY.test(l))} / ※ ${cnt((l) => KOME.test(l))}`,
);
console.log('   URL・日付・分数:');
for (const l of ['https://example.com', '//example.com/a', '日付は 2024/03/01', '分数は 1/2/3', 'and/or の話']) {
  console.log(`   ${SLASH.test(l) ? '●踏む' : '－'}  ${l}`);
}

/* ---------------- 5. `///` の挙動 ---------------- */
const FENCE_TOGGLE = /^[ \t]*(```|~~~)/;
function stripSlash(md) {
  const out = [];
  const got = [];
  let inCode = false;
  for (const l of md.split('\n')) {
    if (FENCE_TOGGLE.test(l)) {
      inCode = !inCode;
      out.push(l);
      continue;
    }
    const m = !inCode && SLASH.exec(l);
    if (m) {
      got.push(m[2].trim());
      continue;
    }
    out.push(l);
  }
  return { md: out.join('\n'), got };
}
const CASES = [
  ['基本', `# 結果\n\n本文。\n\n/// ${CITE}\n`],
  ['全角 ／／／', `# 結果\n\n本文。\n\n／／／ 出典\n`],
  ['空白なし', `# 結果\n\n本文。\n\n///出典\n`],
  ['4 個 ////', `# 結果\n\n本文。\n\n//// 出典\n`],
  ['複数', `# 結果\n\n本文。\n\n/// 出典A\n/// 出典B\n`],
  ['*** のスライド', `# A\n\n本文A。\n\n***\n\n本文B。\n\n/// 出典B\n`],
  ['段組みと同居', `# 結果\n\n左\n\n+++\n\n右\n\n/// 出典\n`],
  ['表のあと', `# 結果\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n/// 出典\n`],
  ['コードフェンス内', `# 結果\n\n\`\`\`\n/// これは本文\n\`\`\`\n\n/// 出典\n`],
  ['行内コード', `# 結果\n\n\`/// 出典\` は記法です。\n`],
  ['URL の行', `# 結果\n\nhttps://example.com/a\n\n/// 出典\n`],
];
console.log('\n=== 5. `///` の挙動（素の原稿 → Morpho が行ごと外したあと）===');
for (const [n, md] of CASES) {
  const s = stripSlash(md);
  const a = shape((await toPptx(md)).bytes);
  const b = shape((await toPptx(s.md)).bytes);
  console.log(
    `   ${n.padEnd(9)} 素:${a.n}枚/L${a.lay} → 外した後:${b.n}枚/L${b.lay}  取り出し=${JSON.stringify(s.got)}`,
  );
}
