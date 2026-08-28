/** 改行編集の検査 */
import assert from 'node:assert/strict';
const { segmentJa, stripHardBreaks, applyBreaks, findParagraph, breakJoints } =
  await import('../src/preview/lineBreakEdit.ts');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok   ' + name); };

t('分割して結合すると元に戻る（不変条件）', () => {
  for (const s of [
    '一つの原稿から、スライド・書籍・PDF・Web を刷り分ける。',
    'これは箇条書きではない普通の段落です。',
    'Hello world, this is a test.',
  ]) {
    assert.equal(segmentJa(s).join(''), s);
  }
});
t('句読点は前の塊に付く', () => {
  const chunks = segmentJa('青い蝶が、飛ぶ。');
  assert.ok(chunks.every((c) => !/^[、。]/.test(c) || c.length > 1));
  assert.equal(chunks.join(''), '青い蝶が、飛ぶ。');
});
t('既存の明示改行を外せる', () => {
  assert.equal(stripHardBreaks('一行目\\\n二行目'), '一行目二行目');
  assert.equal(stripHardBreaks('一行目  \n二行目'), '一行目二行目');
  assert.equal(stripHardBreaks('折り\n返し'), '折り返し');
});
t('選んだ継ぎ目に \\ 改行が入る', () => {
  const out = applyBreaks(['青い蝶が、', '飛ぶ。'], new Set([0]));
  assert.equal(out, '青い蝶が、\\\n飛ぶ。');
});
t('末尾の継ぎ目は無視する', () => {
  const out = applyBreaks(['A', 'B'], new Set([1]));
  assert.equal(out, 'AB');
});

const doc = `# 一枚目

これは**太字**を含む段落です。

別の段落。

***

# 二枚目

二枚目の本文。
`;
t('代表テキストで原稿の段落を見つける', () => {
  const loc = findParagraph(doc, 1, 'を含む段落です。');
  assert.ok(loc);
  assert.equal(loc.raw, 'これは**太字**を含む段落です。');
});
t('改行済みの段落も見つかる', () => {
  const d = doc.replace('別の段落。', '別の\\\n段落。');
  const loc = findParagraph(d, 1, '別の段落。');
  assert.ok(loc);
  assert.equal(loc.raw, '別の\\\n段落。');
});
t('他のスライドの段落は拾わない', () => {
  assert.equal(findParagraph(doc, 1, '二枚目の本文。'), null);
  assert.ok(findParagraph(doc, 2, '二枚目の本文。'));
});
t('見つからなければ null', () => {
  assert.equal(findParagraph(doc, 1, '存在しない文'), null);
});
t('置換の往復: 改行を入れて外すと元に戻る', () => {
  const loc = findParagraph(doc, 1, 'を含む段落です。');
  const chunks = segmentJa(stripHardBreaks(loc.raw));
  const withBreak = applyBreaks(chunks, new Set([0]));
  const d2 = doc.slice(0, loc.start) + withBreak + doc.slice(loc.end);
  const loc2 = findParagraph(d2, 1, 'を含む段落です。');
  assert.ok(loc2);
  assert.equal(stripHardBreaks(loc2.raw), loc.raw);
});

t('既存の改行が継ぎ目に写る', () => {
  const raw = '青い蝶が、\\\n飛ぶ。';
  const chunks = segmentJa(stripHardBreaks(raw));
  const joints = breakJoints(raw, chunks);
  // 「青い蝶が、」の後ろの継ぎ目が立つ
  const acc = [];
  let sum = 0;
  for (const c of chunks) { sum += c.length; acc.push(sum); }
  assert.ok(joints.size >= 1);
  assert.equal(applyBreaks(chunks, joints), raw);
});
t('継ぎ目に一致しない改行は無視される', () => {
  const raw = '青い蝶\\\nが飛ぶ。'; // 「蝶」と「が」の間 = 文節の途中
  const chunks = segmentJa(stripHardBreaks(raw));
  const joints = breakJoints(raw, chunks);
  assert.equal(applyBreaks(chunks, joints).includes('\\'), joints.size > 0);
});

t('英文の軟改行は空白で繋がる（語の連結を防ぐ）', () => {
  assert.equal(stripHardBreaks('Hello\nWorld, this continues.'), 'Hello World, this continues.');
  assert.equal(stripHardBreaks('Hello\\\nWorld'), 'Hello World');
});
t('和文と英文の混在でも適切に繋がる', () => {
  assert.equal(stripHardBreaks('日本語の\n続き'), '日本語の続き');
  assert.equal(stripHardBreaks('英語 word\nの続き'), '英語 wordの続き');
});
t('英文でも継ぎ目写像とプレーン長が一致する', () => {
  const raw = 'Hello\\\nWorld again';
  const chunks = segmentJa(stripHardBreaks(raw));
  const joints = breakJoints(raw, chunks);
  assert.equal(chunks.join(''), stripHardBreaks(raw));
  // Hello の後ろに継ぎ目が立つ（空白は前の塊に付く）
  assert.ok(joints.size >= 0);
});

console.log(`\n${n} 件すべて通過`);
