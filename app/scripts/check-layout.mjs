/** 画面の形 → レイアウト様式・キーボードの重なり・カード幅の検査 */
import assert from 'node:assert/strict';
const { layoutFor, keyboardOverlap, cardWidthFor } = await import('../src/ui/layout.ts');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok   ' + name); };

t('iPad 横（1180×820）は二画面', () => {
  const l = layoutFor(1180, 820);
  assert.equal(l.mode, 'split');
  assert.equal(l.orientation, 'landscape');
  assert.equal(l.compact, false);
});
t('iPad 縦（820×1180）も二画面（0.17 までと同じ）', () => {
  assert.equal(layoutFor(820, 1180).mode, 'split');
});
t('iPad mini 縦（744×1133）も二画面', () => {
  assert.equal(layoutFor(744, 1133).mode, 'split');
});
t('iPhone 縦（390×844）は一画面・既定は原稿・詰める', () => {
  const l = layoutFor(390, 844);
  assert.equal(l.mode, 'single');
  assert.equal(l.orientation, 'portrait');
  assert.equal(l.defaultPane, 'editor');
  assert.equal(l.compact, true);
});
t('iPhone 横（844×390）は幅があっても高さで一画面に落ち、既定はプレビュー', () => {
  const l = layoutFor(844, 390);
  assert.equal(l.mode, 'single');
  assert.equal(l.orientation, 'landscape');
  assert.equal(l.defaultPane, 'preview');
});
t('iPhone Pro Max 横（956×440）も同じ', () => {
  assert.equal(layoutFor(956, 440).defaultPane, 'preview');
});
t('Slide Over（320×1100）は一画面・詰める', () => {
  const l = layoutFor(320, 1100);
  assert.equal(l.mode, 'single');
  assert.equal(l.compact, true);
});
t('Split View の半分（590×820）は一画面だが詰めない', () => {
  const l = layoutFor(590, 820);
  assert.equal(l.mode, 'single');
  assert.equal(l.defaultPane, 'editor');
  assert.equal(l.compact, false);
});

const win = { width: 390, height: 844 };
t('キーボード: 画面下に貼り付いた高さぶん重なる', () => {
  assert.equal(keyboardOverlap({ screenY: 844 - 336, height: 336, width: 390 }, win), 336);
});
t('キーボード: 閉じる（screenY が画面の高さ）と 0', () => {
  assert.equal(keyboardOverlap({ screenY: 844, height: 336, width: 390 }, win), 0);
});
t('キーボード: iPad のフローティング（幅が画面より狭い）は 0', () => {
  assert.equal(keyboardOverlap({ screenY: 500, height: 260, width: 320 }, { width: 1180, height: 820 }), 0);
});
t('キーボード: 物理キーボード時の短いバーは、そのぶんだけ', () => {
  assert.equal(keyboardOverlap({ screenY: 820 - 55, height: 55, width: 1180 }, { width: 1180, height: 820 }), 55);
});
t('キーボード: 変な値でも負にならない', () => {
  assert.equal(keyboardOverlap({ screenY: 900, height: 300, width: 390 }, win), 0);
  assert.equal(keyboardOverlap({ screenY: NaN, height: 300, width: 390 }, win), 0);
});

t('カード幅: 二画面・縦持ちは幅いっぱい（余白を引く）', () => {
  assert.equal(cardWidthFor(500, 800, 9 / 16, { horizontalPadding: 66, chrome: 90, fitHeight: false }), 434);
});
t('カード幅: 横持ちは 1 枚がひと画面に収まる幅まで', () => {
  const w = cardWidthFor(844, 330, 9 / 16, { horizontalPadding: 66, chrome: 90, fitHeight: true });
  assert.equal(w, Math.floor((330 - 90) / (9 / 16)));
  assert.ok(w < 844 - 66);
});
t('カード幅: 高さが未計測（0）なら幅で決める', () => {
  assert.equal(cardWidthFor(844, 0, 9 / 16, { horizontalPadding: 66, chrome: 90, fitHeight: true }), 778);
});

console.log(`check-layout: ${n} 件 OK`);
