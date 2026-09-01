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

/* ---------- ノートの中の入れ子 div（0.16.1 の段組み修正と同じ族） ----------
   遅延一致の正規表現は最初のコロンだけの行で止まるので、読むと続きが欠け、
   書き戻すと続きと外側の閉じ柵が本文に取り残されていた（実測）。
   範囲は columns.ts の scanFences（柵の深さ追跡）で決める */

const nested = `# H

本文

::: notes
ノート

::: warning
注意
:::

続き
:::
`;

t('入れ子の div を含むノートは外側の閉じ柵まで丸ごと読む', () => {
  assert.equal(getNotes(nested, 1), 'ノート\n\n::: warning\n注意\n:::\n\n続き');
});
t('入れ子の div を含むノートの書き戻しは外側の閉じ柵までを 1 ブロックとして置き換える', () => {
  assert.equal(setNotes(nested, 1, '書き換え'), '# H\n\n本文\n\n::: notes\n書き換え\n:::\n');
});
t('入れ子の div を含むノートを空保存すると、続きも外側の柵も本文に残らない', () => {
  const next = setNotes(nested, 1, '');
  assert.equal(next, '# H\n\n本文\n\n');
  assert.equal(getNotes(next, 1), null);
});
t('ノートの中の +++ はノートの一部として読み、本文へ漏れない', () => {
  const d = nested.replace('続き', '+++\n続き');
  assert.equal(getNotes(d, 1), 'ノート\n\n::: warning\n注意\n:::\n\n+++\n続き');
  const next = setNotes(d, 1, 'X');
  assert.equal(next, '# H\n\n本文\n\n::: notes\nX\n:::\n');
  assert.equal(getNotes(next, 1), 'X');
});
t('入れ子ありのノートと 2 つ目のノートが並んでいても両方読み、上書きで 1 つに統合される', () => {
  const d = nested + '\n::: notes\n二つ目。\n:::\n';
  assert.equal(getNotes(d, 1), 'ノート\n\n::: warning\n注意\n:::\n\n続き\n二つ目。');
  const next = setNotes(d, 1, '統合後');
  assert.equal(getNotes(next, 1), '統合後');
  assert.equal((next.match(/:::/g) || []).length, 2);
  assert.ok(!next.includes('続き') && !next.includes('二つ目。') && !next.includes('warning'));
});
t('属性形（::: {.notes}）も NOTES_OPEN と同じ規則で読み書きする', () => {
  const d = doc.replace('::: notes', '::: {.notes}');
  assert.equal(getNotes(d, 1), '最初のノート。');
  const next = setNotes(d, 1, '書き換え');
  assert.equal(getNotes(next, 1), '書き換え');
  assert.ok(!next.includes('最初のノート。'));
  assert.equal((next.match(/:::/g) || []).length, 2);
});
t('閉じていないノートは対象にしない（読むと null。scanFences の notesBlocks と同じ）', () => {
  const d = '# H\n\n本文\n\n::: notes\n::: warning\n注意\n:::\n続き\n';
  assert.equal(getNotes(d, 1), null);
});
t('保存を繰り返しても空行が増えない', () => {
  const once = setNotes(doc, 1, 'A');
  const twice = setNotes(once, 1, 'A');
  assert.equal(twice, once);
  assert.ok(once.includes(':::\n\n***'), '閉じ柵の後ろの空行は元のまま 1 つ');
});
t('CRLF 原稿でも入れ子を含むノートを読める（判定は \\r を外し、本文に \\r は混ぜない）', () => {
  const d = nested.replace(/\n/g, '\r\n');
  assert.equal(getNotes(d, 1), 'ノート\n\n::: warning\n注意\n:::\n\n続き');
  const next = setNotes(d, 1, '書き換え');
  assert.equal(getNotes(next, 1), '書き換え');
  assert.ok(!next.includes('続き') && !next.includes('warning'));
  assert.ok(next.startsWith('# H\r\n\r\n本文\r\n\r\n::: notes\n書き換え\n:::\r\n'));
});

console.log(`\n${n} 件すべて通過`);
