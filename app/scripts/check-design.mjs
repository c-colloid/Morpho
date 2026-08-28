/** 装飾プリセット・微調整・色解決の検査 */
import assert from 'node:assert/strict';
const {
  PRESETS, SHAPE_PRESETS, makePreset, nudge, decorationColorHex, moveDecoration, moveTo, resizeTo,
} = await import('../src/design/presets.ts');
const { shapePoints, textRect } = await import('../src/design/shapeGeometry.ts');
const {
  makeGroup, dissolveGroup, pruneGroups, dragMembersOf, moveMembersBy, copyDesignToAllSlides,
} = await import('../src/design/groups.ts');
const { serializeDesign, parseDesignFile } = await import('../src/design/designFile.ts');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok   ' + name); };

const W = 9144000;
const H = 5143500;

t('全プリセットがスライド内に収まり、正の寸法を持つ', () => {
  for (const p of [...PRESETS, ...SHAPE_PRESETS]) {
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

t('番号バッジ: 正円（w=h）・テキスト付き', () => {
  const b = makePreset('badge', 1, 'a', W, H);
  assert.equal(b.shape, 'ellipse');
  assert.equal(b.w, b.h, 'EMU で正方形でないと円にならない');
  assert.equal(b.text, '1');
});

t('図形の外形: 頂点数が正しく、すべて図形の枠内に収まる', () => {
  const counts = { triangle: 3, diamond: 4, hexagon: 6, star5: 10, rightArrow: 7 };
  for (const [shape, count] of Object.entries(counts)) {
    const pts = shapePoints(shape, 400, 300);
    assert.equal(pts.length, count, shape);
    for (const [x, y] of pts) {
      assert.ok(x >= -0.001 && x <= 400.001 && y >= -0.001 && y <= 300.001,
        `${shape} の頂点 (${x},${y}) が枠外`);
    }
  }
  assert.equal(shapePoints('rect', 400, 300), null);
  assert.equal(shapePoints('roundRect', 400, 300), null);
  assert.equal(shapePoints('ellipse', 400, 300), null);
  /* 基本図形プリセットは正方形（星・多角形が歪まない） */
  for (const kind of ['triangle', 'diamond', 'hexagon', 'star5']) {
    const d = makePreset(kind, 1, 'a', W, H);
    assert.equal(d.w, d.h, kind);
    assert.equal(d.shape, kind);
  }
});

t('テキスト矩形: presetShapeDefinitions の既定 adj 評価値と一致する', () => {
  /* 期待値は OOXML の presetShapeDefinitions.xml を 400×300 で評価した値 */
  const near = (a, b, label) => assert.ok(Math.abs(a - b) < 0.5, `${label}: ${a} != ${b}`);
  const cases = {
    rect: [0, 0, 400, 300],
    roundRect: [14.64, 14.64, 400 - 29.29, 300 - 29.29],
    ellipse: [58.58, 43.93, 400 - 117.16, 300 - 87.87],
    triangle: [100, 150, 200, 150],
    diamond: [100, 75, 200, 150],
    hexagon: [58.33, 43.75, 400 - 116.67, 300 - 87.5],
    star5: [123.61, 114.59, 152.79, 114.6],
    rightArrow: [0, 75, 325, 150],
  };
  for (const [shape, [x, y, w, h]] of Object.entries(cases)) {
    const tr = textRect(shape, 400, 300);
    near(tr.x, x, `${shape}.x`);
    near(tr.y, y, `${shape}.y`);
    near(tr.w, w, `${shape}.w`);
    near(tr.h, h, `${shape}.h`);
  }
  /* 三角形は下半分・星はやや下・矢印は左寄り = 外接中心と一致しない図形がある */
  const tri = textRect('triangle', 400, 300);
  assert.ok(tri.y + tri.h / 2 > 150, '三角形の文字中心が下がっていない');
});

t('.morphodesign: 枠線・塗りなしの検証（不正は捨て、不可視は塗りに戻す）', () => {
  const a = makePreset('bandTop', 1, 'a', W, H);
  const parse = (list) => parseDesignFile(JSON.stringify({
    kind: 'morphodesign', version: 1, decorations: list,
  }));
  const ok = parse([{
    ...a, id: 'ok', noFill: true,
    line: { color: { scheme: 'accent3' }, widthPt: 2 },
  }]).decorations[0];
  assert.equal(ok.noFill, true);
  assert.deepEqual(ok.line, { color: { scheme: 'accent3' }, widthPt: 2 });
  const bads = parse([
    { ...a, id: 'b1', line: { color: { scheme: 'accent9' }, widthPt: 2 } },
    { ...a, id: 'b2', line: { color: { scheme: 'accent1' }, widthPt: 0 } },
    { ...a, id: 'b3', noFill: true } /* 枠が無いのに塗りなし → 塗りに戻す */,
    { ...a, id: 'b4', line: { color: { scheme: 'accent1' }, widthPt: 99 } },
  ]).decorations;
  assert.equal(bads[0].line, undefined, '不正な枠色が通った');
  assert.equal(bads[1].line, undefined, '太さ0が通った');
  assert.equal(bads[2].noFill, undefined, '不可視の図形が通った');
  assert.equal(bads[3].line.widthPt, 12, '太さがクランプされていない');
});

t('.morphodesign: 直列化 → パースの往復で同値', () => {
  const a = makePreset('bandTop', 1, 'a', W, H);
  const b = { ...makePreset('badge', 2, 'b', W, H), text: '7' };
  const c = makePreset('card', 2, 'c', W, H);
  const design = {
    version: 1,
    decorations: [a, b, c],
    groups: [{ id: 'g1', contentIndex: 2, memberIds: ['b', 'c'] }],
  };
  const back = parseDesignFile(serializeDesign(design));
  assert.deepEqual(back, design);
});

t('.morphodesign: 別物・壊れた要素は拒否または除外する', () => {
  assert.equal(parseDesignFile('not json'), null);
  assert.equal(parseDesignFile('{"foo":1}'), null);
  assert.equal(parseDesignFile('{"kind":"morphodesign","version":2,"decorations":[]}'), null);
  const a = makePreset('bandTop', 1, 'a', W, H);
  const mixed = JSON.stringify({
    kind: 'morphodesign',
    version: 1,
    decorations: [
      a,
      { ...a, id: 'bad-shape', shape: 'pentagon' },
      { ...a, id: 'bad-size', w: 0 },
      { ...a, id: 'bad-color', color: { scheme: 'accent9' } },
      { ...a, id: 'ok-hex', color: { hex: '#12AB34' } },
      { ...a, id: 'a' } /* id 重複は最初の1件だけ */,
      'garbage',
    ],
    groups: [
      { id: 'g1', contentIndex: 1, memberIds: ['a', 'ok-hex'] },
      { id: 'g2', contentIndex: 1, memberIds: ['a', 'bad-shape'] } /* 1人になるので捨てる */,
      { id: 'g3', contentIndex: 9, memberIds: ['a', 'ok-hex'] } /* 別スライド参照 */,
    ],
  });
  const out = parseDesignFile(mixed);
  assert.deepEqual(out.decorations.map((d) => d.id).sort(), ['a', 'ok-hex']);
  assert.deepEqual(out.groups.map((g) => g.id), ['g1']);
});

t('.morphodesign: XML を壊せる id・制御文字入りテキストを通さない', () => {
  const a = makePreset('bandTop', 1, 'a', W, H);
  const out = parseDesignFile(JSON.stringify({
    kind: 'morphodesign',
    version: 1,
    decorations: [
      { ...a, id: 'evil"><p:bad' } /* cNvPr name 属性を壊せる id */,
      { ...makePreset('badge', 1, 'b1', W, H), text: '1\u0000\u0008' },
      { ...makePreset('badge', 1, 'b2', W, H), text: '\u0007' } /* 除去後に空 → text 無し */,
    ],
  }));
  assert.deepEqual(out.decorations.map((d) => d.id), ['b1', 'b2']);
  assert.equal(out.decorations[0].text, '1', '制御文字が残っている');
  assert.equal(out.decorations[1].text, undefined);
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

t('全スライドへコピー（design 版）: 元は保持・他は置き換え・グループも複製される', () => {
  let seq = 0;
  const gen = () => `g${seq++}`;
  const a = makePreset('bandTop', 2, 'a', W, H);
  const b = makePreset('accentLine', 2, 'b', W, H);
  const old1 = makePreset('card', 1, 'old1', W, H);
  const design = {
    version: 1,
    decorations: [a, b, old1],
    groups: [{ id: 'grp', contentIndex: 2, memberIds: ['a', 'b'] }],
  };
  const out = copyDesignToAllSlides(design, 2, 3, gen);
  assert.equal(out.decorations.filter((d) => d.contentIndex === 2).length, 2);
  assert.ok(!out.decorations.some((d) => d.id === 'old1'), '他スライドの旧装飾が残っている');
  for (const ci of [1, 3]) {
    const s = out.decorations.filter((d) => d.contentIndex === ci);
    assert.equal(s.length, 2, `ci=${ci}`);
    const g = out.groups.find((x) => x.contentIndex === ci);
    assert.ok(g, `ci=${ci} のグループが複製されていない`);
    assert.deepEqual([...g.memberIds].sort(), s.map((d) => d.id).sort());
  }
  assert.ok(out.groups.some((g) => g.id === 'grp'), '元のグループが消えた');
  const ids = out.decorations.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length, 'id が重複');
});

t('グループ: 作成の妥当性検査と解散・整理', () => {
  const a = makePreset('bandTop', 1, 'a', W, H);
  const b = makePreset('card', 1, 'b', W, H);
  const c = makePreset('card', 2, 'c', W, H);
  assert.equal(makeGroup([], [a, b, c], ['a'], 'g1'), null, '1件では作れない');
  assert.equal(makeGroup([], [a, b, c], ['a', 'c'], 'g1'), null, '別スライド混在は不可');
  const groups = makeGroup([], [a, b, c], ['a', 'b'], 'g1');
  assert.ok(groups && groups.length === 1);
  assert.equal(makeGroup(groups, [a, b, c], ['a', 'c'], 'g2'), null, '既所属メンバーは不可');
  assert.deepEqual(dragMembersOf(groups, 'a').sort(), ['a', 'b']);
  assert.deepEqual(dragMembersOf(groups, 'c'), ['c']);
  assert.equal(dissolveGroup(groups, 'g1').length, 0);
  /* a が消えたら 1人になるので解散 */
  assert.equal(pruneGroups(groups, [b, c]).length, 0);
});

t('グループ: 全員一括移動は 0.5% スナップ・全員が収まる範囲でクランプ', () => {
  const a = { ...makePreset('accentLine', 1, 'a', W, H), x: 0, y: 0 };
  const b = { ...makePreset('accentLine', 1, 'b', W, H), x: Math.round(W * 0.5), y: 0 };
  const list = [a, b, makePreset('card', 2, 'c', W, H)];
  const moved = moveMembersBy(list, ['a', 'b'], W, H, W, H);
  const ma = moved.find((d) => d.id === 'a');
  const mb = moved.find((d) => d.id === 'b');
  /* 右端の制約は b が決める（形は崩れない） */
  assert.equal(mb.x + mb.w, W);
  assert.equal(mb.x - b.x, ma.x - a.x, '移動量が揃っていない');
  assert.equal(moved.find((d) => d.id === 'c').x, list[2].x, '他スライドが動いた');
  assert.equal(moveMembersBy(list, ['a', 'b'], 0, 0, W, H), list, '0移動で新配列を作らない');
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
