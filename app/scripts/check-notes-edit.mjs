/** ノート書き戻しの検査 */
import assert from 'node:assert/strict';
const { getNotes, setNotes } = await import('../src/preview/notesEdit.ts');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok   ' + name); };

const doc = `# 一枚目

本文1。

::: notes
最初のノート。
:::

***

# 二枚目

本文2。
`;

t('既存ノートを読む', () => {
  assert.equal(getNotes(doc, 1), '最初のノート。');
});
t('ノートの無いスライドは null', () => {
  assert.equal(getNotes(doc, 2), null);
});
t('範囲外は null', () => {
  assert.equal(getNotes(doc, 5), null);
});
t('既存ノートを書き換える', () => {
  const next = setNotes(doc, 1, '書き換えた。\n二行目。');
  assert.ok(next.includes('::: notes\n書き換えた。\n二行目。\n:::'));
  assert.ok(!next.includes('最初のノート。'));
  // 他のスライドは無傷
  assert.ok(next.includes('# 二枚目\n\n本文2。'));
});
t('無いスライドに新規作成する', () => {
  const next = setNotes(doc, 2, '新しいノート');
  assert.equal(getNotes(next, 2), '新しいノート');
  assert.equal(getNotes(next, 1), '最初のノート。');
});
t('空文字でブロックを取り除く', () => {
  const next = setNotes(doc, 1, '');
  assert.equal(getNotes(next, 1), null);
  assert.ok(!next.includes('::: notes'));
  assert.ok(next.includes('本文1。'));
});
t('書いてから読むと一致する（往復）', () => {
  let d = doc;
  d = setNotes(d, 1, 'A');
  d = setNotes(d, 2, 'B');
  d = setNotes(d, 1, 'C');
  assert.equal(getNotes(d, 1), 'C');
  assert.equal(getNotes(d, 2), 'B');
});
t('スライド区切りは壊れない（往復後も2区間）', () => {
  const d = setNotes(setNotes(doc, 2, 'B'), 1, 'A');
  const again = setNotes(d, 2, 'B2');
  assert.equal(getNotes(again, 2), 'B2');
  assert.equal(getNotes(again, 1), 'A');
});

t('同一区間に2つの notes ブロックがあっても両方読める', () => {
  const d = doc.replace('本文1。', '本文1。\n\n::: notes\n二つ目。\n:::');
  assert.equal(getNotes(d, 1), '二つ目。\n最初のノート。');
});
t('2ブロックあるとき空保存で両方消える', () => {
  const d = doc.replace('本文1。', '本文1。\n\n::: notes\n二つ目。\n:::');
  const next = setNotes(d, 1, '');
  assert.equal(getNotes(next, 1), null);
  assert.ok(!next.includes('::: notes'));
});
t('2ブロックあるとき上書きで1つに統合される', () => {
  const d = doc.replace('本文1。', '本文1。\n\n::: notes\n二つ目。\n:::');
  const next = setNotes(d, 1, '統合後');
  assert.equal(getNotes(next, 1), '統合後');
  assert.equal((next.match(/::: notes/g) || []).length, 1);
});

console.log(`\n${n} 件すべて通過`);
