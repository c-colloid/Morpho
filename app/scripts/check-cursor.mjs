/** カーソル→スライド対応の検査 */
import assert from 'node:assert/strict';
const { slideIndexAtCursor, slideSegments } = await import('../src/preview/cursorSlide.ts');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok   ' + name); };

const doc = [
  '# 一枚目',       // 0..
  '',
  '本文です。',
  '',
  '***',
  '',
  '# 二枚目',
  '',
  '- 箇条書き',
].join('\n');
const at = (needle) => doc.indexOf(needle);

t('先頭の h1 は1枚目', () => {
  assert.equal(slideIndexAtCursor(doc, at('一枚目'), false), 1);
});
t('1枚目の本文は1枚目', () => {
  assert.equal(slideIndexAtCursor(doc, at('本文です'), false), 1);
});
t('hr を越えると2枚目', () => {
  assert.equal(slideIndexAtCursor(doc, at('二枚目'), false), 2);
});
t('2枚目の本文は2枚目', () => {
  assert.equal(slideIndexAtCursor(doc, at('箇条書き'), false), 2);
});
t('タイトルスライドがあると1つずれる', () => {
  assert.equal(slideIndexAtCursor(doc, at('本文です'), true), 2);
  assert.equal(slideIndexAtCursor(doc, at('箇条書き'), true), 3);
});
t('h1 より前のテキストは1枚目に丸める', () => {
  assert.equal(slideIndexAtCursor('前置き\n\n# 見出し', 2, false), 1);
});
t('## はスライド境界ではない', () => {
  const d = '# 親\n\n## 子\n\n本文';
  assert.equal(slideIndexAtCursor(d, d.indexOf('本文'), false), 1);
});
t('カーソルが範囲外でも落ちない', () => {
  assert.equal(slideIndexAtCursor(doc, 99999, false), 2);
  assert.equal(slideIndexAtCursor(doc, -5, false), 1);
});
t('境界行を書いている途中でも数える', () => {
  const d = '# 一\n\n**';   // hr を打ちかけ（2文字ではまだ hr でない）
  assert.equal(slideIndexAtCursor(d, d.length, false), 1);
  const d2 = '# 一\n\n***'; // 3文字目で hr 成立
  assert.equal(slideIndexAtCursor(d2, d2.length, false), 2);
});

t('コードフェンス内の # と *** は境界にしない', () => {
  const d = '# 一\n\n```\n# コメント\n***\n```\n\n本文';
  assert.equal(slideIndexAtCursor(d, d.indexOf('本文'), false), 1);
});
t('フェンスを閉じた後の境界は効く', () => {
  const d = '# 一\n\n```\ncode\n```\n\n***\n\n# 二\n本文2';
  assert.equal(slideIndexAtCursor(d, d.indexOf('本文2'), false), 2);
});

/* ---------- CRLF（Windows 由来の原稿） ----------
   `***\r` が HR に一致せず、hr 単独の境界が消えていた（再現済み。h1 が続く
   形は h1 側で救われるので見えにくい）。判定だけ \r を外し、オフセットは
   \r 込みで数える（src/text/lineEnding.ts） */
const crlf = (s) => s.replace(/\n/g, '\r\n');
t('CRLF: *** 単独の境界が効く（h1 が続かない形）', () => {
  const d = crlf('# 一\n\n本文\n\n***\n\n続き\n');
  assert.equal(slideIndexAtCursor(d, d.indexOf('続き'), false), 2);
  assert.equal(slideSegments(d).length, 2);
});
t('CRLF: スライド番号と区間が LF 版と一致し、区間を切り出すと元の行に戻る', () => {
  const d = crlf(doc);
  for (const needle of ['一枚目', '本文です', '二枚目', '箇条書き']) {
    assert.equal(
      slideIndexAtCursor(d, d.indexOf(needle), false),
      slideIndexAtCursor(doc, doc.indexOf(needle), false),
      needle,
    );
  }
  const texts = (b) => slideSegments(b).map((s) => b.slice(s.start, s.end));
  assert.deepEqual(texts(d).map((s) => s.replace(/\r\n/g, '\n')), texts(doc));
  assert.equal(slideSegments(d)[slideSegments(d).length - 1].end, d.length);
});
t('CRLF: コードフェンス内の *** は境界にしない', () => {
  const d = crlf('# 一\n\n```\n***\n```\n\n本文');
  assert.equal(slideIndexAtCursor(d, d.indexOf('本文'), false), 1);
});

console.log(`\n${n} 件すべて通過`);
