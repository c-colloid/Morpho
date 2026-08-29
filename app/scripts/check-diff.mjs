/** 行 diff（競合ダイアログの表示用）の検査 */
import assert from 'node:assert/strict';
const { diffLines, collapseSame } = await import('../src/text/diffLines.ts');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok   ' + name); };

const kinds = (ls) => ls.map((l) => l.kind).join(',');

t('同一テキストは全行 same', () => {
  const out = diffLines('a\nb\nc', 'a\nb\nc');
  assert.equal(kinds(out), 'same,same,same');
});

t('中間の1行変更: 前後は same、変更は app + file の対で出る', () => {
  const out = diffLines('見出し\n古い行\n末尾', '見出し\n新しい行\n末尾');
  assert.equal(kinds(out), 'same,app,file,same');
  assert.equal(out[1].text, '古い行');
  assert.equal(out[2].text, '新しい行');
});

t('追加だけ・削除だけ', () => {
  assert.equal(kinds(diffLines('a\nb', 'a\nx\nb')), 'same,file,same');
  assert.equal(kinds(diffLines('a\nx\nb', 'a\nb')), 'same,app,same');
});

t('末尾の追加と空文字', () => {
  assert.equal(kinds(diffLines('a', 'a\nb')), 'same,file');
  const out = diffLines('', 'a');
  assert.equal(kinds(out), 'app,file');
});

t('LCS: 離れた複数の変更が個別に出る', () => {
  const a = ['1', '2', '3', '4', '5', '6'].join('\n');
  const b = ['1', 'X', '3', '4', 'Y', '6'].join('\n');
  const out = diffLines(a, b);
  assert.equal(out.filter((l) => l.kind === 'app').map((l) => l.text).join(','), '2,5');
  assert.equal(out.filter((l) => l.kind === 'file').map((l) => l.text).join(','), 'X,Y');
  assert.equal(out.filter((l) => l.kind === 'same').length, 4);
});

t('巨大な中間部は塊にフォールバックする（順序: app 全部 → file 全部）', () => {
  const big = (c) => Array.from({ length: 1600 }, (_v, i) => c + i).join('\n');
  const out = diffLines('head\n' + big('a'), 'head\n' + big('b'));
  assert.equal(out[0].kind, 'same');
  const rest = out.slice(1);
  assert.equal(rest.length, 3200);
  assert.ok(rest.slice(0, 1600).every((l) => l.kind === 'app'));
  assert.ok(rest.slice(1600).every((l) => l.kind === 'file'));
});

t('collapseSame: 変更の前後 2 行を残して畳む', () => {
  const lines = diffLines(
    ['0', '1', '2', '3', '4', '5', '6', '7', '8'].join('\n'),
    ['0', '1', '2', '3', 'X', '5', '6', '7', '8'].join('\n'),
  );
  const rows = collapseSame(lines);
  /* 先頭 0,1 が skip(2) に畳まれ、2,3, −4, +X, 5,6 が残り、7,8 が skip(2) */
  assert.equal(rows[0].kind, 'skip');
  assert.equal(rows[0].count, 2);
  assert.equal(rows[rows.length - 1].kind, 'skip');
  assert.equal(rows[rows.length - 1].count, 2);
  assert.equal(rows.filter((r) => r.kind === 'app').length, 1);
  assert.equal(rows.filter((r) => r.kind === 'file').length, 1);
});

console.log(`\n${n} 件すべて通過`);
