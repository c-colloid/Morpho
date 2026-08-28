/** 更新チェック（版比較）と AltStore ソース生成の検査 */
import assert from 'node:assert/strict';
const { parseTag, isNewer } = await import('../src/store/updateCheck.ts');
const { buildSource } = await import('./make-source.mjs');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok   ' + name); };

t('タグの v 接頭辞を剥がす', () => {
  assert.equal(parseTag('v0.5.1'), '0.5.1');
  assert.equal(parseTag('0.5.1'), '0.5.1');
});

t('版比較: 新しい・同じ・古い', () => {
  assert.equal(isNewer('0.5.1', '0.5.0'), true);
  assert.equal(isNewer('0.5.0', '0.5.0'), false);
  assert.equal(isNewer('0.4.9', '0.5.0'), false);
  assert.equal(isNewer('1.0.0', '0.9.9'), true);
});

t('版比較: 節の数が違っても数値で比べる（0.5 < 0.5.1, 0.10 > 0.9）', () => {
  assert.equal(isNewer('0.5.1', '0.5'), true);
  assert.equal(isNewer('0.5', '0.5.1'), false);
  assert.equal(isNewer('0.10.0', '0.9.9'), true);
});

t('壊れた入力では新しい扱いにしない', () => {
  assert.equal(isNewer('abc', '0.5.0'), false);
  assert.equal(isNewer('', '0.5.0'), false);
});

t('source.json: 必須フィールドが揃い downloadURL が版と一致する', () => {
  const s = buildSource({ version: '0.5.1', size: 8700000, date: '2026-08-28', notes: '変更点' });
  assert.equal(typeof s.name, 'string');
  assert.ok(Array.isArray(s.apps) && Array.isArray(s.news));
  const app = s.apps[0];
  assert.equal(app.bundleIdentifier, 'com.ccolloid.morpho');
  assert.ok(app.iconURL.startsWith('https://'));
  const v = app.versions[0];
  assert.equal(v.version, '0.5.1');
  assert.equal(v.size, 8700000);
  assert.equal(
    v.downloadURL,
    'https://github.com/c-colloid/Morpho/releases/download/v0.5.1/Morpho-0.5.1.ipa',
  );
  assert.equal(v.minOSVersion, '15.1');
  /* JSON として往復できる（undefined 等が混じっていない） */
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
});

console.log(`\n${n} 件すべて通過`);
