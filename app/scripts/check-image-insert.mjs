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

t('列の中にカーソルがあれば、その列の中身の末尾へ', () => {
  const r = insertBlock(COLS, COLS.indexOf('左'), B);
  assert.match(r.body, /::: \{\.column\}\n左\n\n!\[\]\(x\.png\)\n\n:::/);
  assert.equal(r.moved, 'column');
});

t('列の外にカーソルがあっても、段組みがあれば列の中へ（直下は無警告で消える）', () => {
  const r = insertBlock(COLS, COLS.indexOf('見出し'), B);
  assert.match(r.body, /::: \{\.column\}\n右\n\n!\[\]\(x\.png\)\n\n:::/);
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
  assert.equal(r.moved, 'notes');
});

t('front matter 側（body 座標で負）でも本文の区間末尾へ落ちる', () => {
  const doc = '\n# 見出し\n\n本文A。\n\n本文B。\n';
  const r = insertBlock(doc, -12, B);
  assert.ok(r.body.indexOf(B) > r.body.indexOf('本文B。'), '本文より前に入った:\n' + r.body);
});

/* ---- 占有ブロックを横へ並べる（beside。0.19.6） ----
 * pptx はコンテンツ枠を 1 枚に 1 つしか持てない。2 つ目を素直に足すと
 * pandoc が無警告でスライドを割り、区間数と枚数が食い違う。
 * pandoc 側の実測は blockInsert.ts の表、往復は check-deck。 */

t('beside: 画像のある区間へ 2 つ目 → +++ で横へ並べる', () => {
  const doc = '# 見出し\n\n![](a.png)\n';
  const r = insertBlock(doc, doc.length, B, { beside: true });
  assert.equal(r.moved, 'beside');
  assert.match(r.body, /!\[\]\(a\.png\)\n\n\+\+\+\n\n!\[\]\(x\.png\)\n/);
  assert.equal(r.body.slice(r.cursor - B.length, r.cursor), B);
});

t('beside: 本文 + 画像の区間でも、本文は左の列に残したまま並べる', () => {
  const doc = '# 見出し\n\n本文です。\n\n![](a.png)\n';
  const r = insertBlock(doc, doc.indexOf('本文'), B, { beside: true });
  assert.equal(r.moved, 'beside');
  assert.ok(r.body.indexOf('本文です。') < r.body.indexOf('+++'), '本文が列の外へ出た:\n' + r.body);
});

t('beside: 表のある区間へ画像 → +++ で横へ並べる', () => {
  const doc = '# 見出し\n\n| A | B |\n|---|---|\n| 1 | 2 |\n';
  const r = insertBlock(doc, doc.length, B, { beside: true });
  assert.equal(r.moved, 'beside');
  assert.match(r.body, /\| 1 \| 2 \|\n\n\+\+\+\n\n!\[\]\(x\.png\)\n/);
});

t('beside: 占有ブロックが無ければ従来どおり区間の末尾（+++ は足さない）', () => {
  const doc = '# 見出し\n\n本文です。\n';
  const r = insertBlock(doc, doc.indexOf('本文'), B, { beside: true });
  assert.ok(!r.body.includes('+++'), '要らない +++ が入った:\n' + r.body);
  assert.match(r.body, /本文です。\n\n!\[\]\(x\.png\)\n/);
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

t('beside: notes とコードフェンスの中の画像は占有ブロックに数えない', () => {
  const doc = '# 見出し\n\n本文。\n\n```md\n![](code.png)\n```\n\n::: notes\n![](note.png)\n:::\n';
  const r = insertBlock(doc, doc.indexOf('本文'), B, { beside: true });
  assert.ok(!r.body.includes('+++'), '数えてはいけない画像を数えた:\n' + r.body);
  assert.equal(r.moved, 'notes');
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
