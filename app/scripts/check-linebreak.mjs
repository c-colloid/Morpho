/** 改行編集の検査（offsets 方式の新 API） */
import assert from 'node:assert/strict';
const {
  normalizeParagraph,
  segmentWords,
  segmentChars,
  applyBreaksAtOffsets,
  locateEditable,
  rebuildBlock,
} = await import('../src/preview/lineBreakEdit.ts');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok   ' + name); };

/* ---------- normalizeParagraph ---------- */

t('和文の軟改行は直結、英文は空白で繋ぐ', () => {
  assert.equal(normalizeParagraph('折り\n返し').plain, '折り返し');
  assert.equal(normalizeParagraph('Hello\nWorld').plain, 'Hello World');
});
t('明示改行（\\ と 行末スペース2つ）は breakOffsets に残る', () => {
  const a = normalizeParagraph('一行目\\\n二行目');
  assert.equal(a.plain, '一行目二行目');
  assert.deepEqual([...a.breakOffsets], [3]);
  const b = normalizeParagraph('first  \nsecond');
  assert.equal(b.plain, 'first second');
  assert.deepEqual([...b.breakOffsets], [5]);
});
t('継続行の字下げは食われる', () => {
  assert.equal(normalizeParagraph('一行目\\\n  二行目').plain, '一行目二行目');
});

/* ---------- segmentWords / segmentChars ---------- */

t('分割して結合すると元に戻る（不変条件）', () => {
  for (const s of [
    '一つの原稿から、スライド・書籍・PDF・Web を刷り分ける。',
    'これは箇条書きではない普通の段落です。',
    'Hello world, this is a test.',
  ]) {
    assert.equal(segmentWords(s).join(''), s);
    assert.equal(segmentChars(s).join(''), s);
  }
});
t('句読点・閉じ括弧は前の塊に付く', () => {
  for (const c of segmentWords('青い蝶（モルフォ）が、飛ぶ。')) {
    assert.ok(!/^[、。）]/.test(c), `「${c}」が約物で始まっている`);
  }
});
t('語の粒度は字の粒度より粗い', () => {
  const s = '構造色のモルフォ蝶';
  assert.ok(segmentWords(s).length < segmentChars(s).length);
});

/* ---------- applyBreaksAtOffsets ---------- */

t('オフセット位置に \\ 改行が入る', () => {
  assert.equal(applyBreaksAtOffsets('青い蝶が、飛ぶ。', new Set([5])), '青い蝶が、\\\n飛ぶ。');
});
t('範囲外のオフセット（0 と末尾）は無視する', () => {
  assert.equal(applyBreaksAtOffsets('ABC', new Set([0, 3])), 'ABC');
});
t('英文の結合空白は改行に置き換わる（行頭・行末に空白を残さない）', () => {
  assert.equal(applyBreaksAtOffsets('Hello World', new Set([6])), 'Hello\\\nWorld');
  assert.equal(applyBreaksAtOffsets('Hello World', new Set([5])), 'Hello\\\nWorld');
});
t('継続行の indent が付く', () => {
  assert.equal(applyBreaksAtOffsets('一行目二行目', new Set([3]), '  '), '一行目\\\n  二行目');
});
t('normalize → apply の往復で明示改行が保存される', () => {
  const raw = '一行目\\\n二行目';
  const { plain, breakOffsets } = normalizeParagraph(raw);
  assert.equal(applyBreaksAtOffsets(plain, breakOffsets), raw);
});

/* ---------- locateEditable ---------- */

const doc = `# 一枚目

これは**太字**を含む段落です。

- 箇条書きの項目
- 長い項目は\\
  ここに続く

***

# 二枚目

| a | b |
|---|---|
| 1 | 2 |

二枚目の段落。同じ文面。

***

# 三枚目

二枚目の段落。同じ文面。
`;

t('普通の段落が見つかる（強調記号は照合から除外）', () => {
  const loc = locateEditable(doc, 1, 'これは太字を含む段落です。');
  assert.ok(loc.ok);
  assert.equal(loc.block.raw, 'これは**太字**を含む段落です。');
  assert.equal(loc.block.prefix, '');
});
t('箇条書きの1項目が prefix 付きで見つかる', () => {
  const loc = locateEditable(doc, 1, '箇条書きの項目');
  assert.ok(loc.ok);
  assert.equal(loc.block.prefix, '- ');
  assert.equal(loc.block.plain, '箇条書きの項目');
});
t('継続行を含む項目は1行に正規化され、明示改行が offsets に残る', () => {
  const loc = locateEditable(doc, 1, '長い項目は');
  assert.ok(loc.ok);
  assert.equal(loc.block.plain, '長い項目はここに続く');
  assert.deepEqual([...loc.block.breakOffsets], [5]);
});
t('入れ子の箇条書きも項目単位で見つかる', () => {
  const nested = '# 見出し\n\n- 親項目\n  - 子の項目\n';
  const loc = locateEditable(nested, 1, '子の項目');
  assert.ok(loc.ok);
  assert.equal(loc.block.prefix, '  - ');
  assert.equal(loc.block.plain, '子の項目');
});
t('見出しは reason: heading で断る', () => {
  const loc = locateEditable(doc, 1, '一枚目');
  assert.deepEqual(loc, { ok: false, reason: 'heading' });
});
t('表は reason: table で断る', () => {
  const loc = locateEditable(doc, 2, '| 1 | 2 |'.replace(/[|\s]/g, '') || '1');
  // 表のセル由来の needle は行儀が悪いので、セルテキストで直接引く
  const loc2 = locateEditable('# t\n\n| a | b |\n|---|---|\n| 找我 | x |\n', 1, '找我');
  assert.deepEqual(loc2, { ok: false, reason: 'table' });
});
t('同じ文面でもスライド区間の中だけを探す', () => {
  const loc = locateEditable(doc, 3, '二枚目の段落。同じ文面。');
  assert.ok(loc.ok);
  assert.ok(loc.block.start > doc.indexOf('# 三枚目'));
});
t('見つからなければ reason: not-found', () => {
  assert.deepEqual(locateEditable(doc, 1, '存在しない文'), { ok: false, reason: 'not-found' });
});

/* ---------- rebuildBlock ---------- */

t('段落: オフセットどおりに \\ 改行が入る', () => {
  const loc = locateEditable('# t\n\n蝶が飛ぶ。\n', 1, '蝶が飛ぶ。');
  assert.ok(loc.ok);
  assert.equal(rebuildBlock(loc.block, new Set([2])), '蝶が\\\n飛ぶ。');
});
t('箇条書き: prefix が戻り、継続行は同じ幅で字下げされる', () => {
  const loc = locateEditable('# t\n\n- 長い項目を折り返す\n', 1, '長い項目を折り返す');
  assert.ok(loc.ok);
  assert.equal(rebuildBlock(loc.block, new Set([5])), '- 長い項目を\\\n  折り返す');
});
t('オフセットを空にすると1行に戻る（改行の解除）', () => {
  const loc = locateEditable('# t\n\n- 長い項目は\\\n  ここに続く\n', 1, '長い項目は');
  assert.ok(loc.ok);
  assert.equal(rebuildBlock(loc.block, new Set()), '- 長い項目はここに続く');
});
t('locate → rebuild を原稿に書き戻しても他の行を壊さない', () => {
  const body = doc;
  const loc = locateEditable(body, 1, '箇条書きの項目');
  assert.ok(loc.ok);
  const rebuilt = rebuildBlock(loc.block, new Set([5]));
  const next = body.slice(0, loc.block.start) + rebuilt + body.slice(loc.block.end);
  assert.ok(next.includes('- 箇条書きの\\\n  項目'));
  assert.ok(next.includes('これは**太字**を含む段落です。'));
  assert.ok(next.includes('# 二枚目'));
});


/* ---------- v0.14: fenced div（段組み・ノート） ---------- */

const COLS = [
  '# 二つの案',
  '',
  '::: {.columns}',
  '::: {.column}',
  '案 A は pandoc をそのまま使う方法です。',
  ':::',
  '::: {.column}',
  '案 B は自前 writer に差し替える方法です。',
  ':::',
  ':::',
  '',
].join('\n');

t('柵の中の段落だけを掴み、柵を巻き込まない', () => {
  const loc = locateEditable(COLS, 1, '案 A は pandoc をそのまま使う方法です。');
  assert.ok(loc.ok);
  assert.equal(loc.block.raw, '案 A は pandoc をそのまま使う方法です。');
  const next = COLS.slice(0, loc.block.start) + rebuildBlock(loc.block, new Set([4])) + COLS.slice(loc.block.end);
  /* 行頭 ::: の本数が保たれる = 段組みが壊れていない */
  assert.equal((next.match(/^ {0,3}:::/gm) || []).length, 6);
  assert.match(next, /案 A[^\n]*\\\n[^\n]*方法です。/);
});

t('柵の行そのものは編集対象にしない', () => {
  assert.equal(locateEditable(COLS, 1, '::: {.columns}').ok, false);
});

t('::: notes の中は候補にしない（本文と同じ文がノートにあっても誤爆しない）', () => {
  const doc = '# t\n\n::: notes\n本文の段落です。についての補足。\n:::\n\n本文の段落です。\n';
  const loc = locateEditable(doc, 1, '本文の段落です。');
  assert.ok(loc.ok);
  assert.equal(loc.block.raw, '本文の段落です。');
  const next = doc.slice(0, loc.block.start) + rebuildBlock(loc.block, new Set([3])) + doc.slice(loc.block.end);
  assert.equal((next.match(/^ {0,3}:::/gm) || []).length, 2, 'ノートの柵が消えた:\n' + next);
});

t('意図した縮退: 行頭 ::: を含む段落は編集できない（壊さずに止まる）', () => {
  const doc = '# t\n\nThis is a paragraph.\n::: and this continues.\nMore text here.\n';
  const loc = locateEditable(doc, 1, 'This is a paragraph. ::: and this continues. More text here.');
  assert.equal(loc.ok, false);
  assert.equal(loc.reason, 'not-found');
});

/* ---------- CRLF（Windows 由来の原稿） ----------
   判定のときだけ行末の \r を外す（src/text/lineEnding.ts）。外さないと +++\r が
   段落へ溶け、:::\r の閉じ柵が読めずノートの後ろの段落が見つからない（修正前に実測）。
   書き戻しは末尾行の \r\n を壊さず、\ 改行も \r\n で入れる（改行コードを混在させない） */
const crlf = (s) => s.replace(/\n/g, '\r\n');

t('CRLF: 段落が見つかり、末尾行の \\r はブロックの外に置かれる', () => {
  const d = crlf(doc);
  const loc = locateEditable(d, 1, 'これは太字を含む段落です。');
  assert.ok(loc.ok);
  assert.equal(loc.block.raw, 'これは**太字**を含む段落です。');
  assert.equal(d.slice(loc.block.start, loc.block.end), loc.block.raw);
  assert.equal(d[loc.block.end], '\r');
  assert.equal(loc.block.newline, '\r\n');
});
t('CRLF: 継続行を含む項目は plain に \\r が混ざらず、明示改行と prefix が LF 版と同じ', () => {
  const lf = locateEditable(doc, 1, '長い項目は');
  const cr = locateEditable(crlf(doc), 1, '長い項目は');
  assert.ok(lf.ok && cr.ok);
  assert.equal(cr.block.plain, lf.block.plain);
  assert.deepEqual([...cr.block.breakOffsets], [...lf.block.breakOffsets]);
  assert.equal(cr.block.prefix, lf.block.prefix);
});
t('CRLF: 段落の直後に空行なしで置いた +++ を段落へ飲み込まない', () => {
  const d = crlf('# 一\n\n左の文\n+++\n右の文\n');
  const loc = locateEditable(d, 1, '左の文');
  assert.ok(loc.ok);
  assert.equal(loc.block.raw, '左の文');
});
t('スライドごとのフッター（///）は段落へ飲み込まず、その行自体も編集対象にしない', () => {
  for (const d of ['# 一\n\n本文の文\n/// 出典: NEJM\n次の文\n', crlf('# 一\n\n本文の文\n/// 出典: NEJM\n次の文\n')]) {
    const loc = locateEditable(d, 1, '本文の文');
    assert.ok(loc.ok);
    assert.equal(loc.block.raw, '本文の文');
    assert.equal(locateEditable(d, 1, '出典: NEJM').ok, false);
  }
});
t('CRLF: ::: notes の閉じ柵が読め、ノートの後ろの段落が見つかる', () => {
  const d = crlf('# t\n\n::: notes\n本文の段落です。についての補足。\n:::\n\n本文の段落です。\n');
  const loc = locateEditable(d, 1, '本文の段落です。');
  assert.ok(loc.ok);
  assert.equal(loc.block.raw, '本文の段落です。');
  assert.ok(loc.block.start > d.indexOf(':::\r\n\r\n'), 'ノートの中を掴んでいる');
});
t('CRLF: 柵の行そのものは編集対象にしない', () => {
  assert.equal(locateEditable(crlf(COLS), 1, '::: {.columns}').ok, false);
});
t('CRLF: 書き戻しは \\ 改行を \\r\\n で入れ、原稿の改行コードを混在させない', () => {
  const d = crlf(doc);
  const loc = locateEditable(d, 1, '箇条書きの項目');
  assert.ok(loc.ok);
  const rebuilt = rebuildBlock(loc.block, new Set([5]));
  assert.equal(rebuilt, '- 箇条書きの\\\r\n  項目');
  const next = d.slice(0, loc.block.start) + rebuilt + d.slice(loc.block.end);
  assert.ok(!/(^|[^\r])\n/.test(next), 'LF 単独の改行が混ざった');
  /* LF 版で同じ編集をした結果と、改行コード以外で一致する */
  const lfLoc = locateEditable(doc, 1, '箇条書きの項目');
  const lfNext = doc.slice(0, lfLoc.block.start) + rebuildBlock(lfLoc.block, new Set([5])) + doc.slice(lfLoc.block.end);
  assert.equal(next, crlf(lfNext));
});
t('CRLF: 改行の解除も \\r\\n を保つ', () => {
  const d = crlf('# t\n\n- 長い項目は\\\n  ここに続く\n');
  const loc = locateEditable(d, 1, '長い項目は');
  assert.ok(loc.ok);
  const next = d.slice(0, loc.block.start) + rebuildBlock(loc.block, new Set()) + d.slice(loc.block.end);
  assert.equal(next, crlf('# t\n\n- 長い項目はここに続く\n'));
});
t('LF 原稿の書き戻しは従来どおり \\n', () => {
  const loc = locateEditable(doc, 1, '箇条書きの項目');
  assert.ok(loc.ok);
  assert.equal(loc.block.newline, '\n');
  assert.equal(rebuildBlock(loc.block, new Set([5])), '- 箇条書きの\\\n  項目');
});

console.log(`\n${n} 件すべて通過`);
