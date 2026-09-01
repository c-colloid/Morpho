/**
 * 段組みの記法（`+++` の列区切り）の検査。
 *
 * 記法は内容層のものなので純関数（src/text/columns.ts）で走査し、
 * pandoc の語彙への実現（fenced div への展開）はブリッジが持つ。
 * その二つが**同じ規則で動いていること**をここで担保する。
 *
 * とくに COLUMN_SEPARATOR は 2 箇所に書かれている（ブリッジは WebView 用の
 * 文字列なので import できない）。食い違うと原稿とプレビューで列の切れ目が
 * ずれるので、まず一致を検査する。
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import assert from 'node:assert/strict';
import {
  COLUMN_SEPARATOR,
  COLUMN_SEPARATOR_TEXT,
  isColumnSeparator,
  separatorLines,
  columnRangeAt,
} from '../src/text/columns.ts';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok   ' + name); };

/* ---------- ブリッジを vm で評価して expandColumns を取り出す ---------- */
const src = readFileSync(new URL('../src/converter/bridgeHtml.ts', import.meta.url), 'utf8');
const decl = src.indexOf('export const BRIDGE_HTML');
const open = src.indexOf('`', decl);
const close = src.lastIndexOf('`');
const html = new Function('return `' + src.slice(open + 1, close) + '`')();
const mod = /<script type="module">([\s\S]*?)<\/script>/.exec(html);
const body = mod[1].replace(/^\s*import\s[^\n]*\n/gm, '');
const win = { __rn: () => {} };
runInContext(body, createContext({
  window: win,
  unzipSync: () => ({}), zipSync: () => new Uint8Array(), strToU8: () => new Uint8Array(),
  fetch: () => new Promise(() => {}),
  performance, TextDecoder, WebAssembly, console,
}));
const expand = win.__morphoExpandColumns;
assert.equal(typeof expand, 'function', '__morphoExpandColumns が生えていない');

t('区切りの正規表現が columns.ts とブリッジで一致する', () => {
  const inBridge = /var COL_SEP = (\/.*\/);/.exec(mod[1]);
  assert.ok(inBridge, 'ブリッジに COL_SEP が無い');
  assert.equal(
    inBridge[1],
    COLUMN_SEPARATOR.toString(),
    'columns.ts とブリッジで列区切りの規則が食い違っている',
  );
});

/* ---------- 記法の判定 ---------- */

t('区切りとして受ける形', () => {
  for (const s of ['+++', '++++', '+++++', '＋＋＋', '+ + +', '  +++  ', '＋ ＋ ＋', '+＋+']) {
    assert.ok(isColumnSeparator(s), '受けるべき: ' + JSON.stringify(s));
  }
});

t('区切りとして受けない形', () => {
  for (const s of ['++', '+', '++ +x', '+++ 左', 'a+++', '- 項目', '***', '---', '']) {
    assert.ok(!isColumnSeparator(s), '受けるべきでない: ' + JSON.stringify(s));
  }
});

t('UI が挿入するのは半角 3 個', () => {
  assert.equal(COLUMN_SEPARATOR_TEXT, '+++');
  assert.ok(isColumnSeparator(COLUMN_SEPARATOR_TEXT));
});

t('コードフェンスの中の区切りは数えない', () => {
  assert.deepEqual(separatorLines('左\n\n```\n+++\n```\n\n右\n'), []);
  assert.deepEqual(separatorLines('左\n\n+++\n\n右\n'), [2]);
});

t('::: notes の中の区切りは数えない', () => {
  assert.deepEqual(separatorLines('左\n\n::: notes\n+++\n:::\n\n右\n'), []);
});

t('列の範囲: カーソルのいる列を返す', () => {
  const body = '左の文\n\n+++\n\n右の文\n';
  const left = columnRangeAt(body, 1);
  assert.equal(body.slice(left.start, left.end).trim(), '左の文');
  const right = columnRangeAt(body, body.indexOf('右'));
  assert.equal(body.slice(right.start, right.end).trim(), '右の文');
  assert.equal(columnRangeAt('区切りなし\n', 0), null);
});

/* ---------- 展開 ---------- */

const cols = (md) => (expand(md).md.match(/^::: \{\.column\}$/gm) || []).length;
const labels = (md) => Array.from(expand(md).diags).map((d) => d.label);

t('区切りが無ければ 1 バイトも変えない', () => {
  const md = '# 見出し\n\n本文\n\n- 項目\n';
  assert.equal(expand(md).md, md);
  assert.deepEqual(labels(md), []);
});

t('区間の本文まるごとを列に割る（導入があっても割れない）', () => {
  assert.equal(cols('# T\n\n左\n\n+++\n\n右\n'), 2);
  const out = expand('# T\n\n導入。\n\n左\n\n+++\n\n右\n').md;
  assert.equal((out.match(/^::: \{\.column\}$/gm) || []).length, 2);
  /* 導入は左の列の中（段組みの外に本文を残さない） */
  const first = out.indexOf('::: {.column}');
  const second = out.indexOf('::: {.column}', first + 1);
  assert.ok(out.slice(first, second).includes('導入。'), '導入が左列に入っていない');
});

t('見出しと末尾の ::: notes は列の外に残る', () => {
  const out = expand('# T\n\n左\n\n+++\n\n右\n\n::: notes\nノート\n:::\n').md;
  assert.ok(out.indexOf('# T') < out.indexOf('::: {.columns}'), '見出しが列の中にある');
  const ls = out.split('\n');
  const notesAt = ls.findIndex((l) => l.startsWith('::: notes'));
  assert.ok(notesAt > 0, '::: notes が無い');
  /* ノートより前の閉じ柵は「各列の閉じ 2 + 段組みの閉じ 1」= 3 本 */
  const closes = ls.slice(0, notesAt).filter((l) => /^:::$/.test(l)).length;
  assert.equal(closes, 3, 'ノートが列の中にある（閉じ柵 ' + closes + ' 本）');
});

t('全角と空白入りも展開される', () => {
  assert.equal(cols('# T\n\n左\n\n＋＋＋\n\n右\n'), 2);
  assert.equal(cols('# T\n\n左\n\n+ + +\n\n右\n'), 2);
});

t('n 個の区切りで n+1 列', () => {
  assert.equal(cols('# T\n\nA\n\n+++\n\nB\n\n+++\n\nC\n'), 3);
});

t('3 列以上は診断を出す（スライドは 2 列まで）', () => {
  assert.deepEqual(labels('# T\n\nA\n\n+++\n\nB\n\n+++\n\nC\n'), ['3 列目以降はスライドに出ません']);
  assert.deepEqual(labels('# T\n\nA\n\n+++\n\nB\n'), []);
});

t('列の先頭が画像で後続があるときは展開しない（落とし穴 13）', () => {
  const md = '# 実験\n\n![](z.png)\n\n図1: 装置\n\n+++\n\n右\n';
  assert.equal(cols(md), 0, '展開してはいけない');
  assert.deepEqual(labels(md), ['画像の後ろの内容が消えるため段組みにしませんでした']);
});

t('列の先頭が表で後続があるときも展開しない', () => {
  const md = '# 結果\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n※ 速報値\n\n+++\n\n右\n';
  assert.equal(cols(md), 0);
  assert.deepEqual(labels(md), ['表の後ろの内容が消えるため段組みにしませんでした']);
});

t('展開しないときも区切りは消費する（本文に生の +++ を出さない）', () => {
  const out = expand('# 実験\n\n![](z.png)\n\n図1: 装置\n\n+++\n\n右\n').md;
  assert.ok(!/^\s*\+\+\+\s*$/m.test(out), '生の +++ が残っている');
  assert.ok(out.includes('図1: 装置') && out.includes('右'), '内容が失われている');
});

t('画像や表が列の唯一のブロックなら展開してよい', () => {
  assert.equal(cols('# 実験\n\n![](z.png)\n\n+++\n\n右の説明\n'), 2);
  assert.equal(cols('# 実験\n\n右の説明\n\n+++\n\n![](z.png)\n'), 2);
});

t('コードフェンスの中の区切りでは展開しない', () => {
  const md = '# T\n\n```\n+++\n```\n\n本文\n';
  assert.equal(expand(md).md, md);
});

t('複数スライドで、区切りのある区間だけが展開される', () => {
  const out = expand('# A\n\n左\n\n+++\n\n右\n\n# B\n\n本文\n').md;
  assert.equal((out.match(/^::: \{\.columns\}$/gm) || []).length, 1);
  assert.ok(out.includes('# B\n\n本文'), '区切りの無い区間が変わっている');
});

t('*** で作った区間にも効く', () => {
  assert.equal(cols('# A\n\n本文\n\n***\n\n左\n\n+++\n\n右\n'), 2);
});

/* ---------- CRLF（Windows 由来の原稿） ----------
   行末の \r が残ると COL_SEP / COL_HR / COL_DIV_CLOSE が一致せず、段組みが
   無警告で 1 段のままになっていた（再現済み）。判定のときだけ \r を外す規約
   （src/text/lineEnding.ts）が両側で守られていることを見る */
const crlf = (s) => s.replace(/\n/g, '\r\n');

t('CRLF: 判定は行末の \\r を無視する', () => {
  assert.ok(isColumnSeparator('+++\r'));
  assert.ok(isColumnSeparator('＋ ＋ ＋\r'));
  assert.ok(!isColumnSeparator('***\r'));
  assert.ok(!isColumnSeparator('+++ 左\r'));
});

t('CRLF: 区切り行の位置と列の範囲が LF と同じ（オフセットは \\r 込みで数える）', () => {
  const lf = '左の文\n\n+++\n\n右の文\n';
  const cr = crlf(lf);
  assert.deepEqual(separatorLines(cr), separatorLines(lf));
  assert.deepEqual(separatorLines(crlf('左\n\n::: notes\n+++\n:::\n\n右\n')), []);
  assert.deepEqual(separatorLines(crlf('左\n\n```\n+++\n```\n\n右\n')), []);
  const left = columnRangeAt(cr, 1);
  assert.equal(cr.slice(left.start, left.end).trim(), '左の文');
  const right = columnRangeAt(cr, cr.indexOf('右'));
  assert.equal(cr.slice(right.start, right.end).trim(), '右の文');
  assert.equal(columnRangeAt(cr, cr.indexOf('+++')), null);
});

t('CRLF: 展開結果と診断が LF 版と一致する（派生テキストは LF に正規化される）', () => {
  for (const lf of [
    '# T\n\n左\n\n+++\n\n右\n',
    '# A\n\n本文\n\n***\n\n左\n\n+++\n\n右\n',
    '# T\n\n左\n\n+++\n\n右\n\n::: notes\nノート\n:::\n',
    '# T\n\nA\n\n+++\n\nB\n\n+++\n\nC\n',
    '# 実験\n\n![](z.png)\n\n図1: 装置\n\n+++\n\n右\n',
    '# T\n\n```\n+++\n```\n\n本文\n',
    '# 見出し\n\n本文\n\n- 項目\n',
  ]) {
    assert.equal(expand(crlf(lf)).md, expand(lf).md, JSON.stringify(lf));
    assert.deepEqual(labels(crlf(lf)), labels(lf), JSON.stringify(lf));
  }
  assert.equal(cols(crlf('# T\n\n左\n\n+++\n\n右\n')), 2);
  assert.ok(!/\r/.test(expand(crlf('# T\n\n左\n\n+++\n\n右\n')).md), '派生テキストに \\r が残っている');
});

console.log('\n' + n + ' 件すべて通過');
