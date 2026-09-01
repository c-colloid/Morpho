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
  CODE_FENCE,
  DIV_FENCE,
  DIV_CLOSE,
  NOTES_OPEN,
  isColumnSeparator,
  scanFences,
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

/* 判定規則の原本は columns.ts。ブリッジは WebView 用の文字列なので import できず
   写しを持つ。正規表現は toString で、scanFences は関数本文をそのまま突き合わせて、
   規則が二重に（別々に）実装されていないことを担保する */
const bridgeRegex = (name) => {
  const m = new RegExp('^var ' + name + ' = (/.*/);$', 'm').exec(mod[1]);
  assert.ok(m, 'ブリッジに ' + name + ' が無い');
  return m[1];
};

t('区切りの正規表現が columns.ts とブリッジで一致する', () => {
  assert.equal(
    bridgeRegex('COL_SEP'),
    COLUMN_SEPARATOR.toString(),
    'columns.ts とブリッジで列区切りの規則が食い違っている',
  );
});

t('柵の正規表現（コード・div・閉じ・notes）が columns.ts とブリッジで一致する', () => {
  const pairs = [
    ['CODE_FENCE', CODE_FENCE],
    ['DIV_FENCE', DIV_FENCE],
    ['DIV_CLOSE', DIV_CLOSE],
    ['NOTES_OPEN', NOTES_OPEN],
  ];
  for (const [name, re] of pairs) {
    assert.equal(bridgeRegex(name), re.toString(), name + ' が columns.ts とブリッジで食い違っている');
  }
});

/* 関数本文（最初の { から対応する } まで）を切り出す */
const fnBody = (text, signature, label) => {
  const at = text.indexOf(signature);
  assert.ok(at >= 0, label + ' に「' + signature + '」が無い');
  const open = text.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(open, i + 1);
  }
  assert.fail(label + ' の scanFences が閉じていない');
};

t('scanFences の本文が columns.ts とブリッジで一致する（規則を二重に持たない）', () => {
  const tsSrc = readFileSync(new URL('../src/text/columns.ts', import.meta.url), 'utf8');
  const original = fnBody(tsSrc, 'export function scanFences(lines: string[]): FenceScan ', 'columns.ts');
  const mirror = fnBody(mod[1], 'function scanFences(lines) ', 'ブリッジ');
  assert.equal(
    mirror,
    original,
    'scanFences の本文が食い違っている。columns.ts を直したらブリッジにも同じ本文を写すこと',
  );
});

const bridgeScan = win.__morphoScanFences;
assert.equal(typeof bridgeScan, 'function', '__morphoScanFences が生えていない');
/* vm レルムの配列は deepEqual でプロトタイプ不一致になるので JSON で正規化 */
const plain = (v) => JSON.parse(JSON.stringify(v));

/* ---------- 柵の追跡（入れ子の div） ---------- */

t('入れ子の div を含むノートは、外側の閉じ柵までノートの中', () => {
  const lines = [
    '# H', '', '::: notes', 'ノート', '', '::: warning', '注意', ':::', '',
    '+++', '', '続き', ':::', '', '+++',
  ];
  const s = scanFences(lines);
  assert.deepEqual(
    s.notes,
    [false, false, true, true, true, true, true, true, true, true, true, true, true, false, false],
  );
  assert.deepEqual(s.notesBlocks, [[2, 12]]);
  /* ノートの中の +++ は数えず、ノートが閉じた後の +++ は数える */
  assert.deepEqual(separatorLines(lines.join('\n')), [14]);
});

t('属性つきの柵・3 段の入れ子・4 個以上のコロンでも深さが合う', () => {
  const lines = [
    '::: {.notes}', ':::: {.callout-warning}', '::: inner', 'X', ':::', '+++', '::::', '+++', ':::',
    '+++',
  ];
  const s = scanFences(lines);
  assert.deepEqual(s.notes, [true, true, true, true, true, true, true, true, true, false]);
  assert.deepEqual(s.notesBlocks, [[0, 8]]);
  assert.deepEqual(separatorLines(lines.join('\n')), [9]);
});

t('閉じていないノートは末尾までノートの中（区切りにしない）', () => {
  const lines = ['::: notes', '::: warning', 'X', ':::', '+++', '続き'];
  const s = scanFences(lines);
  assert.deepEqual(s.notes, [true, true, true, true, true, true]);
  assert.deepEqual(s.notesBlocks, []);
  assert.deepEqual(separatorLines(lines.join('\n')), []);
});

t('開きのない :::（迷子の閉じ柵）は深さを負にしない', () => {
  const lines = ['+++', ':::', '+++', '::: notes', '+++', ':::', '+++'];
  const s = scanFences(lines);
  assert.deepEqual(s.notes, [false, false, false, true, true, true, false]);
  assert.deepEqual(separatorLines(lines.join('\n')), [0, 2, 6]);
});

t('別の div の中にあるノートも中身は数えないが、末尾ブロックの候補にはしない', () => {
  const lines = ['::: warning', '::: notes', '+++', ':::', '+++', ':::', '+++'];
  const s = scanFences(lines);
  assert.deepEqual(s.notes, [false, true, true, true, false, false, false]);
  assert.deepEqual(s.notesBlocks, []);
  assert.deepEqual(separatorLines(lines.join('\n')), [4, 6]);
});

t('ノートの中のコードフェンスにある ::: はノートを閉じない', () => {
  const lines = ['::: notes', '```', ':::', '+++', '```', '+++', ':::', '+++'];
  const s = scanFences(lines);
  assert.deepEqual(s.code, [false, true, true, true, true, false, false, false]);
  assert.deepEqual(s.notes, [true, true, true, true, true, true, true, false]);
  assert.deepEqual(s.notesBlocks, [[0, 6]]);
  assert.deepEqual(separatorLines(lines.join('\n')), [7]);
});

t('引用の中の柵（> ::: notes）も同じ規則で追う', () => {
  const lines = ['> ::: notes', '> ::: warning', '> +++', '> :::', '> +++', '> :::', '+++'];
  const s = scanFences(lines);
  assert.deepEqual(s.notes, [true, true, true, true, true, true, false]);
  assert.deepEqual(s.notesBlocks, [[0, 5]]);
});

t('ブリッジの scanFences が columns.ts と同じ結果を返す（固定の corpus）', () => {
  const corpus = [
    ['# H', '左', '+++', '右', '::: notes', 'ノート', '::: warning', '注意', ':::', '続き', ':::'],
    ['::: notes', '```', ':::', '```', '+++', ':::'],
    ['::: warning', '::: notes', '+++', ':::', ':::', '+++'],
    [':::', '+++', '::: {.notes}', '::::', '+++'],
    ['> ::: notes', '> +++', '> :::', '+++'],
    [],
    [''],
  ];
  for (const lines of corpus) {
    assert.deepEqual(plain(bridgeScan(lines)), plain(scanFences(lines)), JSON.stringify(lines));
  }
});

t('ブリッジの scanFences が columns.ts と同じ結果を返す（乱数の柵列 500 本）', () => {
  /* 決定的な乱数。落ちたら JSON の行列をそのまま固定ケースへ足す */
  let seed = 20260901;
  const rnd = (k) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % k;
  };
  const ALPHA = [
    '::: notes', '::: {.notes}', '::: warning', '::: {.callout-tip}', ':::', '::::', ':::: notes',
    '+++', '＋＋＋', '+ + +', '本文', '', '```', '~~~', '> ::: notes', '> :::', '# H', '***',
    '::: columns compare', '  :::', ':::notes',
  ];
  for (let k = 0; k < 500; k++) {
    const len = 1 + rnd(14);
    const lines = [];
    for (let j = 0; j < len; j++) lines.push(ALPHA[rnd(ALPHA.length)]);
    assert.deepEqual(plain(bridgeScan(lines)), plain(scanFences(lines)), JSON.stringify(lines));
  }
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

/* ---------- ノートの中の入れ子 div（footer-design.md の既存の不具合 6・7） ---------- */

/* 出力の骨組み: 柵と見出しの行だけを抜く */
const skeleton = (md) => expand(md).md.split('\n').filter((l) => /^(:::|#)/.test(l));

t('ノートに入れ子の div があっても、ノートは列の外に残る（入れ子なしと同じ骨組み）', () => {
  const flat = '# T\n\n左\n\n+++\n\n右\n\n::: notes\nノート\n:::\n';
  const nested = '# T\n\n左\n\n+++\n\n右\n\n::: notes\nノート\n\n::: warning\n注意\n:::\n\n続き\n:::\n';
  assert.equal(cols(nested), 2);
  assert.deepEqual(labels(nested), []);
  /* ノートより前の骨組みは入れ子なしと同じ（列 2 本 + 段組みの閉じ = 閉じ柵 3 本） */
  const flatSk = skeleton(flat);
  const nestedSk = skeleton(nested);
  const notesAt = nestedSk.indexOf('::: notes');
  assert.ok(notesAt > 0, '::: notes が無い');
  assert.deepEqual(nestedSk.slice(0, notesAt), flatSk.slice(0, flatSk.indexOf('::: notes')));
  assert.equal(nestedSk.slice(0, notesAt).filter((l) => l === ':::').length, 3, 'ノートが列の中にある');
  /* ノートブロックは 1 バイトも変えずに通す */
  assert.ok(expand(nested).md.endsWith('::: notes\nノート\n\n::: warning\n注意\n:::\n\n続き\n:::\n'));
});

t('入れ子 div を含むノートの中の +++ は区切りにならず、ノートの中に残る', () => {
  const md = '# T\n\n左\n\n+++\n\n右\n\n::: notes\nノート\n\n::: warning\n注意\n:::\n\n+++\n\n続き\n:::\n';
  assert.equal(cols(md), 2, 'ノートの中の +++ で列が増えている');
  assert.deepEqual(labels(md), []);
  const out = expand(md).md;
  assert.ok(out.endsWith('::: notes\nノート\n\n::: warning\n注意\n:::\n\n+++\n\n続き\n:::\n'),
    'ノートの中身が変わっている（続きが本文へ漏れる形）');
});

t('入れ子が末尾にあるノート・属性つきの柵でも列の外に残る', () => {
  for (const md of [
    '# T\n\n左\n\n+++\n\n右\n\n::: notes\nノート\n\n::: warning\n注意\n:::\n:::\n',
    '# T\n\n左\n\n+++\n\n右\n\n::: {.notes}\n::: {.callout-warning}\n注意\n:::\n\nノート\n:::\n',
    '# T\n\n左\n\n+++\n\n右\n\n:::: notes\n::: a\n::: b\nX\n:::\n:::\n::::\n',
  ]) {
    assert.equal(cols(md), 2, md);
    const sk = skeleton(md);
    const notesAt = sk.findIndex((l) => /notes/.test(l));
    assert.equal(sk.slice(0, notesAt).filter((l) => /^:::+$/.test(l)).length, 3, 'ノートが列の中にある: ' + md);
  }
});

t('末尾にノートが 2 つ並んでいれば両方とも列の外に残る', () => {
  const md = '# T\n\n左\n\n+++\n\n右\n\n::: notes\nA\n:::\n\n::: notes\nB\n:::\n';
  assert.equal(cols(md), 2);
  const sk = skeleton(md);
  const first = sk.indexOf('::: notes');
  assert.equal(sk.slice(0, first).filter((l) => l === ':::').length, 3, '最初のノートが列の中にある');
  assert.ok(expand(md).md.endsWith('::: notes\nA\n:::\n\n::: notes\nB\n:::\n'));
});

t('展開しないときに消費するのは区切りとして数えた行だけ（コードとノートの中は触らない）', () => {
  const md = '# 実験\n\n![](z.png)\n\n図1: 装置\n\n+++\n\n右\n\n```\n+++\n```\n\n::: notes\n+++\n:::\n';
  const out = expand(md).md;
  assert.equal(cols(md), 0);
  assert.ok(out.includes('```\n+++\n```'), 'コードフェンスの中の +++ が消えた');
  assert.ok(out.includes('::: notes\n+++\n:::'), 'ノートの中の +++ が消えた');
  assert.ok(!out.includes('図1: 装置\n\n+++'), '本文の区切りが残っている');
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
