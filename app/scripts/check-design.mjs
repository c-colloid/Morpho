/** 装飾プリセット・微調整・色解決の検査 */
import assert from 'node:assert/strict';
const { PRESETS, makePreset, nudge, decorationColorHex } =
  await import('../src/design/presets.ts');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok   ' + name); };

const W = 9144000;
const H = 5143500;

t('全プリセットがスライド内に収まり、正の寸法を持つ', () => {
  for (const p of PRESETS) {
    const d = makePreset(p.kind, 1, 'id1', W, H);
    assert.ok(d.w > 0 && d.h > 0, p.kind);
    assert.ok(d.x >= 0 && d.y >= 0, p.kind);
    assert.ok(d.x + d.w <= W && d.y + d.h <= H, `${p.kind} がスライドをはみ出す`);
    assert.equal(d.contentIndex, 1);
    assert.ok(d.opacity >= 5 && d.opacity <= 100);
    assert.ok(d.color.scheme, 'プリセットはテーマ参照色を使う');
  }
});

t('帯は全幅・カードは角丸', () => {
  assert.equal(makePreset('bandTop', 1, 'a', W, H).w, W);
  assert.equal(makePreset('bandBottom', 1, 'a', W, H).w, W);
  assert.equal(makePreset('card', 1, 'a', W, H).shape, 'roundRect');
});

t('nudge: 1ステップ = 寸法の1%、サイズは1%未満にならない', () => {
  const d = makePreset('accentLine', 1, 'a', W, H);
  assert.equal(nudge(d, 'x', 1, W, H).x, d.x + Math.round(W / 100));
  assert.equal(nudge(d, 'y', -2, W, H).y, d.y - Math.round(H / 100) * 2);
  let shrunk = d;
  for (let i = 0; i < 200; i++) shrunk = nudge(shrunk, 'h', -1, W, H);
  assert.ok(shrunk.h >= Math.round(H / 100) - 1 && shrunk.h > 0);
});

t('色解決: テーマ参照 → 実色、未知は灰色、hex はそのまま', () => {
  const colors = { accent1: '#4472C4' };
  assert.equal(decorationColorHex({ scheme: 'accent1' }, colors), '#4472C4');
  assert.equal(decorationColorHex({ scheme: 'accent2' }, colors), '#888888');
  assert.equal(decorationColorHex({ hex: '#12AB34' }, colors), '#12AB34');
});

console.log(`\n${n} 件すべて通過`);
