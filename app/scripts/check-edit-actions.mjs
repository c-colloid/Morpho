/** ソフトキーボード用ツールバーの編集操作の検査 */
import assert from 'node:assert/strict';
const {
  toggleLinePrefix, indentLines, wrapSelection, replaceSelection, insertHardBreak,
  lineStartAt, lineEndAt,
} = await import('../src/text/editActions.ts');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok   ' + name); };
const sel = (start, end = start) => ({ start, end });

t('行頭・行末', () => {
  const s = 'ab\ncd\r\nef';
  assert.equal(lineStartAt(s, 0), 0);
  assert.equal(lineStartAt(s, 4), 3);
  assert.equal(lineEndAt(s, 3), 5);   /* CRLF の \r の手前 */
  assert.equal(lineEndAt(s, 8), 9);
});

t('見出し: キャレット行の行頭に # を付け、キャレットはその後ろへ', () => {
  const r = toggleLinePrefix('本文\n二行目', sel(1), '# ');
  assert.equal(r.text, '# 本文\n二行目');
  assert.deepEqual(r.selection, sel(3));
});
t('見出し: 既にあれば外す（トグル）', () => {
  const r = toggleLinePrefix('# 本文', sel(4), '# ');
  assert.equal(r.text, '本文');
  assert.deepEqual(r.selection, sel(2));
});
t('見出し: 外すときマークの中にいたキャレットはマーク位置へ', () => {
  const r = toggleLinePrefix('# 本文', sel(1), '# ');
  assert.equal(r.text, '本文');
  assert.deepEqual(r.selection, sel(0));
});
t('箇条書き: 複数行の選択は全行に付き、選択範囲が追随する', () => {
  const src = 'a\nb\nc';
  const r = toggleLinePrefix(src, sel(0, 5), '- ');
  assert.equal(r.text, '- a\n- b\n- c');
  assert.deepEqual(r.selection, sel(2, 11));
});
t('箇条書き: 選択の末尾が行頭ちょうどなら次の行に飛び火しない', () => {
  const r = toggleLinePrefix('a\nb\nc', sel(0, 4), '- ');
  assert.equal(r.text, '- a\n- b\nc');
});
t('箇条書き: 字下げは保って後ろに付ける', () => {
  const r = toggleLinePrefix('  子', sel(3), '- ');
  assert.equal(r.text, '  - 子');
  assert.deepEqual(r.selection, sel(5));
});
t('箇条書き: 一部の行に無ければ全行へ付ける（既にある行は触らない）', () => {
  const r = toggleLinePrefix('- a\nb', sel(0, 5), '- ');
  assert.equal(r.text, '- a\n- b');
});
t('番号付き: 連番で付き、数字+ピリオドを既存とみなして外す', () => {
  const r = toggleLinePrefix('a\nb', sel(0, 3), '1. ');
  assert.equal(r.text, '1. a\n2. b');
  const back = toggleLinePrefix(r.text, sel(0, r.text.length), '1. ');
  assert.equal(back.text, 'a\nb');
});
t('CRLF 原稿でも \\r を行の途中に残さない', () => {
  const r = toggleLinePrefix('a\r\nb\r\n', sel(0, 4), '- ');
  assert.equal(r.text, '- a\r\n- b\r\n');
});
t('原稿の末尾（改行なし）でも動く', () => {
  const r = toggleLinePrefix('a', sel(1), '## ');
  assert.equal(r.text, '## a');
  assert.deepEqual(r.selection, sel(4));
});

t('字下げ: 半角空白 2 つを行頭へ', () => {
  const r = indentLines('- 親\n- 子', sel(6), 1);
  assert.equal(r.text, '- 親\n  - 子');
  assert.deepEqual(r.selection, sel(8));
});
t('字下げ戻し: 空白 2 つ・タブ 1 つ・空白 1 つを外す。無ければ何もしない', () => {
  assert.equal(indentLines('  a', sel(3), -1).text, 'a');
  assert.equal(indentLines('\ta', sel(2), -1).text, 'a');
  assert.equal(indentLines(' a', sel(2), -1).text, 'a');
  assert.equal(indentLines('a', sel(1), -1).text, 'a');
});
t('字下げ戻し: 行頭の空白の中にいたキャレットは行頭へ', () => {
  const r = indentLines('  a', sel(1), -1);
  assert.deepEqual(r.selection, sel(0));
});

t('太字: 選択なしなら **** を入れて間にキャレット', () => {
  const r = wrapSelection('ab', sel(1), '**');
  assert.equal(r.text, 'a****b');
  assert.deepEqual(r.selection, sel(3));
});
t('太字: 選択を囲み、選択は中身のまま', () => {
  const r = wrapSelection('太字です', sel(0, 2), '**');
  assert.equal(r.text, '**太字**です');
  assert.deepEqual(r.selection, sel(2, 4));
});
t('太字: 囲まれた中身を選んでもう一度押すと外れる', () => {
  const r = wrapSelection('**太字**です', sel(2, 4), '**');
  assert.equal(r.text, '太字です');
  assert.deepEqual(r.selection, sel(0, 2));
});
t('太字: マークごと選んで押しても外れる', () => {
  const r = wrapSelection('**太字**です', sel(0, 6), '**');
  assert.equal(r.text, '太字です');
  assert.deepEqual(r.selection, sel(0, 2));
});

t('置換: 選択範囲を差し替え、caretBack でキャレットを手前へ', () => {
  const r = replaceSelection('a[x]b', sel(1, 4), '::: notes\n\n:::', 4);
  assert.equal(r.text, 'a::: notes\n\n:::b');
  assert.deepEqual(r.selection, sel(11));
});

t('改行固定: 行末に \\ + 改行', () => {
  const r = insertHardBreak('一行目', sel(3));
  assert.equal(r.text, '一行目\\\n');
  assert.deepEqual(r.selection, sel(5));
});
t('改行固定: 行の途中ならそこで割る・手前の空白は詰める', () => {
  const r = insertHardBreak('前 後', sel(2));
  assert.equal(r.text, '前\\\n後');
  assert.deepEqual(r.selection, sel(3));
});
t('改行固定: 既に \\ の直後なら二重に付けない', () => {
  const r = insertHardBreak('前\\', sel(2));
  assert.equal(r.text, '前\\\n');
});
t('改行固定: CRLF 原稿は CRLF で', () => {
  const r = insertHardBreak('a\r\nb', sel(4), '\r\n');
  assert.equal(r.text, 'a\r\nb\\\r\n');
});
t('選択範囲が原稿の外でも落ちない', () => {
  const r = toggleLinePrefix('a', sel(99, 120), '- ');
  assert.equal(r.text, '- a');
  const w = wrapSelection('', sel(-1, 5), '**');
  assert.equal(w.text, '****');
  assert.deepEqual(w.selection, sel(2));
});

console.log(`check-edit-actions: ${n} 件 OK`);
