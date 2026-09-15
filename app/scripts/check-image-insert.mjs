/**
 * 画像などの「1 ブロック挿入」の位置決めの検査（app/src/text/blockInsert.ts）。
 *
 * 見ているのは 3 つの不変条件だけ:
 *   1. 元の行が 1 本も割れず、並びも変わらない（原稿を壊さない）
 *   2. 挿入したブロックは前後が空行か文書端の独立した段落になる
 *   3. フェンス行（``` / :::）とその中身、front matter には割り込まない
 * pandoc を回す不変条件（枚数と区間数の一致・画像が出力に残る）は check-deck。
 */
import assert from 'node:assert/strict';
import { insertBlock } from '../src/text/blockInsert.ts';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok   ' + name); };
const B = '![](x.png)';

/** 全カーソル位置で 1 と 2 を確かめる */
function sweep(body) {
  for (let c = 0; c <= body.length; c++) {
    const r = insertBlock(body, c, B);
    const orig = body.split('\n').filter((x) => x.trim() !== '');
    const now = r.body.split('\n').filter((x) => x.trim() !== '');
    let k = 0;
    for (const l of now) if (k < orig.length && l === orig[k]) k++;
    assert.equal(k, orig.length, 'cursor=' + c + ' で元の行が壊れた:\n' + r.body);
    assert.equal(now.length, orig.length + 1, 'cursor=' + c + ' で行が増減した');
    const i = r.body.indexOf('\n' + B + '\n');
    assert.ok(r.body.startsWith(B + '\n') || i >= 0, 'cursor=' + c + ' で独立行になっていない');
    assert.equal(r.body.slice(r.cursor - B.length, r.cursor), B, 'cursor が画像行の末尾でない');
  }
}

const COLS = '# 見出し\n\n::: {.columns}\n::: {.column}\n左\n:::\n::: {.column}\n右\n:::\n:::\n';
const NOTES = COLS + '\n::: notes\nメモ。\n:::\n';
const CODE = '# コード\n\n````markdown\n```js\nconst a = 1;\n```\n````\n\n本文。\n';
const CRLF = COLS.replace(/\n/g, '\r\n');

t('段組み原稿: 全カーソル位置で行が割れない', () => sweep(COLS));
t('notes 付き: 全カーソル位置で行が割れない', () => sweep(NOTES));
t('入れ子フェンス: 全カーソル位置で行が割れない', () => sweep(CODE));
t('CRLF: 全カーソル位置で行が割れない', () => sweep(CRLF));
t('空の原稿・末尾に改行が無い原稿', () => {
  assert.equal(insertBlock('', 0, B).body, B + '\n');
  assert.equal(insertBlock('本文', 2, B).body, '本文\n\n' + B + '\n');
});

t('列の中にカーソルがあれば、その段落の直後（列の中）へ', () => {
  const r = insertBlock(COLS, COLS.indexOf('左'), B);
  assert.match(r.body, /::: \{\.column\}\n左\n\n!\[\]\(x\.png\)\n\n:::/);
});

t('列の外にカーソルがあっても、段組みがあれば列の中へ（直下は無警告で消える）', () => {
  const r = insertBlock(COLS, COLS.indexOf('見出し'), B);
  assert.match(r.body, /::: \{\.column\}\n左\n\n!\[\]\(x\.png\)\n\n:::/);
  assert.equal(r.moved, 'column');
});

/* ---- カーソルのある段落の直後へ置く（0.19.8）。区間の末尾へは送らない ---- */
const LONG = '# 見出し\n\n一つ目の段落。\n\n二つ目の段落。\n\n* 箇条書き A\n* 箇条書き B\n\n三つ目の段落。\n';

t('段落の途中にカーソル → その段落の直後（区間の末尾ではない）', () => {
  const r = insertBlock(LONG, LONG.indexOf('目の段落') , B);
  assert.equal(r.body, '# 見出し\n\n一つ目の段落。\n\n' + B + '\n\n二つ目の段落。\n\n* 箇条書き A\n* 箇条書き B\n\n三つ目の段落。\n');
  assert.equal(r.moved, 'block');
});

t('見出しの上にカーソル → 見出しの直後', () => {
  const r = insertBlock(LONG, LONG.indexOf('見出し'), B);
  assert.ok(r.body.startsWith('# 見出し\n\n' + B + '\n\n一つ目'), r.body);
});

t('箇条書きの項目にカーソル → 箇条書きの塊の直後（項目の間に割り込まない。落とし穴 21）', () => {
  const r = insertBlock(LONG, LONG.indexOf('箇条書き A'), B);
  assert.match(r.body, /\* 箇条書き B\n\n!\[\]\(x\.png\)\n\n三つ目/);
});

t('空行の上にカーソル → その空行の位置', () => {
  const at = LONG.indexOf('\n\n二つ目') + 1;
  const r = insertBlock(LONG, at, B);
  assert.match(r.body, /一つ目の段落。\n\n!\[\]\(x\.png\)\n\n二つ目/);
});

t('+++ の行にカーソル → その直後（次の列の先頭）', () => {
  const doc = '# 見出し\n\n左\n\n+++\n\n右\n';
  const r = insertBlock(doc, doc.indexOf('+++') + 1, B);
  assert.equal(r.body, '# 見出し\n\n左\n\n+++\n\n' + B + '\n\n右\n');
});

t('*** の行にカーソル → その直後（新しいスライドの先頭）', () => {
  const doc = '# A\n\n本文。\n\n***\n\n次。\n';
  const r = insertBlock(doc, doc.indexOf('***') + 1, B);
  assert.equal(r.body, '# A\n\n本文。\n\n***\n\n' + B + '\n\n次。\n');
});

t('区間の途中に置いても、あとの内容は動かない（表の前でも）', () => {
  const doc = '# 見出し\n\n本文です。\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n下の文。\n';
  const r = insertBlock(doc, doc.indexOf('本文'), B);
  assert.equal(r.body, '# 見出し\n\n本文です。\n\n' + B + '\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n下の文。\n');
});

t('3 列目には入れない（pandoc が無警告で捨てる）', () => {
  const three = '# 三つ\n\n::: {.columns}\n::: {.column}\n左\n:::\n::: {.column}\n中\n:::\n::: {.column}\n右\n:::\n:::\n';
  const r = insertBlock(three, three.indexOf('右'), B);
  assert.match(r.body, /中\n\n!\[\]\(x\.png\)/);
});

t('コードフェンスの中にカーソルがあっても中身は変わらない', () => {
  const r = insertBlock(CODE, CODE.indexOf('const'), B);
  assert.ok(r.body.includes('```js\nconst a = 1;\n```'), '写しがずれた:\n' + r.body);
});

t('末尾の ::: notes より前に置く（ノートに埋もれない）', () => {
  const doc = '# 見出し\n\n本文。\n\n::: notes\nメモ。\n:::\n';
  const r = insertBlock(doc, doc.indexOf('本文'), B);
  assert.ok(r.body.indexOf(B) < r.body.indexOf('::: notes'));
});

t('::: notes の柵の行や中にカーソルがあっても、ノートの手前へ', () => {
  const doc = '# 見出し\n\n本文。\n\n::: notes\nメモ。\n:::\n';
  for (const at of [doc.indexOf('::: notes') + 2, doc.indexOf('メモ'), doc.lastIndexOf(':::') + 1]) {
    const r = insertBlock(doc, at, B);
    assert.equal(r.body, '# 見出し\n\n本文。\n\n' + B + '\n\n::: notes\nメモ。\n:::\n', 'cursor=' + at);
    assert.equal(r.moved, 'notes');
  }
});

t('front matter 側（body 座標で負）なら本文の最初の見出しの直後へ', () => {
  const doc = '\n# 見出し\n\n本文A。\n\n本文B。\n';
  const r = insertBlock(doc, -12, B);
  assert.equal(r.body, '\n# 見出し\n\n' + B + '\n\n本文A。\n\n本文B。\n');
  assert.equal(r.moved, 'front-matter');
});

/* ---- 占有ブロックの置き場（beside。0.19.7） ----
 * 横に並べるかどうかは書き手が `+++` で決める。挿入 UI は列を作らず素直に置き、
 * 割れたスライドは変換器が 1 枚へ積み直す（check-deck の「縦積み」）。
 * ここで見るのは「置くと壊れる場所」だけ — 列の中で占有ブロックを重ねると
 * 段組みごと壊れて割れ、3 列目は無警告で消える（実測）。 */

t('beside: 画像のある区間へ 2 つ目でも列は作らない（縦に並ぶのは変換器の仕事）', () => {
  const doc = '# 見出し\n\n![](a.png)\n';
  const r = insertBlock(doc, doc.length, B, { beside: true });
  assert.ok(!r.body.includes('+++'), '勝手に列を作った:\n' + r.body);
  assert.match(r.body, /!\[\]\(a\.png\)\n\n!\[\]\(x\.png\)\n/);
});

t('beside: 本文・表のある区間でも素直にカーソルの段落の直後へ置く', () => {
  const doc = '# 見出し\n\n本文です。\n\n| A | B |\n|---|---|\n| 1 | 2 |\n';
  const r = insertBlock(doc, doc.indexOf('本文'), B, { beside: true });
  assert.ok(!r.body.includes('+++'), '勝手に列を作った:\n' + r.body);
  assert.match(r.body, /本文です。\n\n!\[\]\(x\.png\)\n\n\| A \| B \|/);
});

t('beside: 列が埋まっていれば 3 列目を作らず *** で新しいスライドへ', () => {
  const doc = '# 見出し\n\n![](a.png)\n\n+++\n\n![](b.png)\n';
  const r = insertBlock(doc, doc.indexOf('b.png'), B, { beside: true });
  assert.equal(r.moved, 'new-slide');
  assert.match(r.body, /!\[\]\(b\.png\)\n\n\*\*\*\n\n!\[\]\(x\.png\)\n/);
  assert.equal((r.body.match(/\+\+\+/g) || []).length, 1, '3 列目ができた:\n' + r.body);
});

t('beside: 空いている列があればそこへ入れる（新しいスライドは作らない）', () => {
  const doc = '# 見出し\n\n![](a.png)\n\n+++\n\n右の文章。\n';
  const r = insertBlock(doc, doc.indexOf('右の文章'), B, { beside: true });
  assert.notEqual(r.moved, 'new-slide');
  assert.match(r.body, /右の文章。\n\n!\[\]\(x\.png\)\n/);
});

t('beside: ネイティブ記法の列が埋まっていても新しいスライドへ', () => {
  const doc = '# 見出し\n\n::: {.columns}\n::: {.column}\n![](a.png)\n:::\n::: {.column}\n![](b.png)\n:::\n:::\n';
  const r = insertBlock(doc, doc.indexOf('b.png'), B, { beside: true });
  assert.equal(r.moved, 'new-slide');
  assert.ok(r.body.indexOf('***') > r.body.indexOf('b.png'), '新しいスライドになっていない:\n' + r.body);
});

t('beside: 列の中の notes とコードフェンスの画像は占有ブロックに数えない', () => {
  const doc = '# 見出し\n\n左\n\n+++\n\n```md\n![](code.png)\n```\n\n::: notes\n![](note.png)\n:::\n';
  const r = insertBlock(doc, doc.indexOf('code.png'), B, { beside: true });
  assert.notEqual(r.moved, 'new-slide', '数えてはいけない画像を数えた:\n' + r.body);
  assert.ok(!r.body.includes('***'), r.body);
});

t('beside: 新しいスライドは ::: notes の後ろへ起こす', () => {
  const doc = '# 見出し\n\n![](a.png)\n\n+++\n\n![](b.png)\n\n::: notes\nメモ。\n:::\n';
  const r = insertBlock(doc, doc.indexOf('b.png'), B, { beside: true });
  assert.equal(r.moved, 'new-slide');
  assert.ok(r.body.indexOf('メモ。') < r.body.indexOf('***'), 'ノートが新しいスライドへ移った:\n' + r.body);
});

t('beside を立てない挿入（+++ / *** / ///）は従来のまま', () => {
  const doc = '# 見出し\n\n![](a.png)\n';
  assert.equal(insertBlock(doc, doc.length, '+++').body, '# 見出し\n\n![](a.png)\n\n+++\n');
  assert.equal(insertBlock(doc, doc.length, '***').body, '# 見出し\n\n![](a.png)\n\n***\n');
});

console.log(`\n${n} 件すべて通過`);
