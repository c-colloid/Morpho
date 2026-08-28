/** 装飾プリセット・微調整・色解決の検査 */
import assert from 'node:assert/strict';
const {
  PRESETS, makePreset, nudge, decorationColorHex, copyToAllSlides, moveDecoration,
  moveTo, resizeTo,
} = await import('../src/design/presets.ts');

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

t('全スライドへコピー: 元は保持・他は置き換え・id は新規で一意', () => {
  let seq = 0;
  const gen = () => `g${seq++}`;
  const decorations = [
    makePreset('bandTop', 2, 'src1', W, H),
    makePreset('accentLine', 2, 'src2', W, H),
    makePreset('card', 1, 'old1', W, H),
    makePreset('card', 3, 'old3', W, H),
  ];
  const out = copyToAllSlides(decorations, 2, 4, gen);
  assert.equal(out.filter((d) => d.contentIndex === 2).length, 2);
  assert.ok(out.some((d) => d.id === 'src1') && out.some((d) => d.id === 'src2'));
  assert.ok(!out.some((d) => d.id === 'old1') && !out.some((d) => d.id === 'old3'));
  for (const ci of [1, 3, 4]) {
    const s = out.filter((d) => d.contentIndex === ci);
    assert.equal(s.length, 2, `ci=${ci}`);
    assert.equal(s[0].shape, 'rect');
  }
  const ids = out.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length, 'id が重複');
});

t('重なり順の入れ替え: 同一スライド内でだけ動き、端では何もしない', () => {
  const a = makePreset('bandTop', 1, 'a', W, H);
  const b = makePreset('card', 1, 'b', W, H);
  const x = makePreset('card', 2, 'x', W, H);
  const list = [a, x, b];
  const moved = moveDecoration(list, 'b', 'back');
  assert.deepEqual(moved.map((d) => d.id), ['b', 'x', 'a'], 'スライド1内で入れ替わる');
  assert.equal(moved[1].id, 'x', '他スライドの位置は不変');
  assert.deepEqual(moveDecoration(list, 'a', 'back').map((d) => d.id), ['a', 'x', 'b']);
  assert.deepEqual(moveDecoration(list, 'b', 'front').map((d) => d.id), ['a', 'x', 'b']);
  assert.deepEqual(moveDecoration(list, 'zzz', 'back').map((d) => d.id), ['a', 'x', 'b']);
});

t('直接操作 moveTo: 0.5% スナップとスライド内クランプ', () => {
  const d = makePreset('accentLine', 1, 'a', W, H);
  const unitX = W / 200;
  const m = moveTo(d, d.x + unitX * 3.4, d.y, W, H);
  assert.equal(m.x % Math.round(unitX), 0, 'スナップされていない');
  assert.equal(moveTo(d, -99999, -99999, W, H).x, 0);
  assert.equal(moveTo(d, -99999, -99999, W, H).y, 0);
  const far = moveTo(d, W * 2, H * 2, W, H);
  assert.equal(far.x, W - d.w);
  assert.equal(far.y, H - d.h);
  assert.equal(m.w, d.w, '移動でサイズが変わった');
});

t('直接操作 resizeTo: 最小 1%・右下方向のクランプ・位置は不変', () => {
  const d = makePreset('card', 1, 'a', W, H);
  const r = resizeTo(d, 0, 0, W, H);
  assert.equal(r.w, Math.round(W / 100));
  assert.equal(r.h, Math.round(H / 100));
  const big = resizeTo(d, W * 9, H * 9, W, H);
  assert.equal(big.w, W - d.x);
  assert.equal(big.h, H - d.y);
  assert.equal(big.x, d.x);
  assert.equal(big.y, d.y);
});

console.log(`\n${n} 件すべて通過`);
