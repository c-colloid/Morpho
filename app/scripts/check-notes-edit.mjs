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

/* ---------- CRLF（Windows 由来の原稿） ----------
   読み取りは閉じ柵の $ が \r の手前にも一致するので元から動く。壊れていたのは書き戻しで、
   LF で書くので改行コードが混在し、ブロック直後の改行の畳み込みも \r\n を 1 つとして
   見ていなかった（修正前に実測）。原稿の改行コードは detectNewline（src/text/lineEnding.ts）。
   不変条件: CRLF 原稿への操作の結果 = LF 原稿への同じ操作の結果を CRLF にしたもの */
const crlf = (s) => s.replace(/\n/g, '\r\n');
const noLoneLf = (s) => !/(^|[^\r])\n/.test(s);

t('CRLF: 複数行のノートも LF に揃えて読める', () => {
  const multi = doc.replace('最初のノート。', '1 行目\n2 行目');
  assert.equal(getNotes(crlf(multi), 1), '1 行目\n2 行目');
  assert.equal(getNotes(crlf(doc), 1), '最初のノート。');
});
t('CRLF: 上書き・新規作成・削除・統合の結果が LF 版と改行コード以外で一致する', () => {
  const two = doc.replace('本文1。', '本文1。\n\n::: notes\n二つ目。\n:::');
  const cases = [
    [doc, 1, '書き換えた。\n二行目。'],
    [doc, 2, '新しいノート'],
    [doc, 1, ''],
    [two, 1, '統合後'],
    [two, 1, ''],
  ];
  for (const [d, i, text] of cases) {
    const next = setNotes(crlf(d), i, text);
    assert.equal(next, crlf(setNotes(d, i, text)), JSON.stringify([i, text]));
    assert.ok(noLoneLf(next), 'LF 単独の改行が混ざった: ' + JSON.stringify([i, text]));
  }
});
t('CRLF: 書いてから読むと一致する（往復）', () => {
  let d = crlf(doc);
  d = setNotes(d, 1, 'A\nB');
  d = setNotes(d, 2, 'C');
  assert.equal(getNotes(d, 1), 'A\nB');
  assert.equal(getNotes(d, 2), 'C');
  assert.ok(noLoneLf(d));
});
t('上書きを繰り返しても空行が増えない（LF / CRLF）', () => {
  for (const d of [doc, crlf(doc)]) {
    const once = setNotes(d, 1, 'X');
    assert.equal(setNotes(once, 1, 'X'), once);
    assert.equal(once.length, d.length - '最初のノート。'.length + 'X'.length, '文言以外の長さが変わった');
  }
});

console.log(`\n${n} 件すべて通過`);
