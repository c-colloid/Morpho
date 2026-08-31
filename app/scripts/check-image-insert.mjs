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

console.log(`\n${n} 件すべて通過`);
