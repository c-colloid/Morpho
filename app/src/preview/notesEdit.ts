/**
 * 発表者ノート（::: notes ::: ブロック）の読み書き。
 *
 * プレビューのノート欄から編集した内容を、該当スライドの原稿区間へ書き戻す。
 * 「プレビューで編集し、確定は原稿へ書く」一方向フローの最初の実装。
 *
 * ブロックの範囲は columns.ts の scanFences（柵の深さ追跡）で決める。
 * 以前は「`::: notes` から最初のコロンだけの行まで」の遅延一致だったので、
 * ノートの中に入れ子の div（`::: warning` 等。Quarto 系のコピペで現実に入る）が
 * あると内側の閉じで止まり、読むとノートの続きが欠け、書き戻すと続きと外側の
 * 閉じ柵が本文へ取り残された（実測。0.16.1 で段組み側を直したのと同じ族）。
 * 判定規則を二重に持たない（notes/column-input.md の「必ず守ること」）。
 *
 * CRLF 原稿は判定のときだけ行末の `\r` を落として読み（シートへ渡す文字列は LF）、
 * 書き戻しは原稿の改行コードを保つ（lineEnding.ts の規約・0.16.3）。
 */
import { slideSegments } from './cursorSlide.ts';
import { scanFences } from '../text/columns.ts';
import { stripCr, detectNewline } from '../text/lineEnding.ts';

interface NotesBlock {
  /** 区間内オフセット。開き柵の行頭 */
  index: number;
  /** 開き柵の行頭から閉じ柵の行末まで（閉じ柵の後ろの改行は含めない） */
  length: number;
  /** 柵の間の本文。末尾の空白は落とす */
  inner: string;
}

/**
 * 区間内の notes ブロックをすべて列挙する（pandoc は複数あっても全部ノートにする）。
 * 深さ 0 で開いて閉じたものだけ（scanFences の notesBlocks）。閉じていないものは
 * 対象にしない。開き柵の形（`::: notes` / `::: {.notes}` / 引用の中）は NOTES_OPEN に従う。
 */
function findBlocks(segment: string): NotesBlock[] {
  const raw = segment.split('\n');
  /* 判定のときだけ行末の \r を落とす（CRLF 原稿）。オフセットは raw の長さで数える */
  const lines = raw.map(stripCr);
  const starts: number[] = [];
  let off = 0;
  for (const l of raw) {
    starts.push(off);
    off += l.length + 1;
  }
  return scanFences(lines).notesBlocks.map(([open, close]) => {
    const index = starts[open];
    const end = starts[close] + lines[close].length;
    const inner = lines.slice(open + 1, close).join('\n').replace(/\s+$/, '');
    return { index, length: end - index, inner };
  });
}

/** contentIndex は 1 始まりのコンテンツスライド番号（タイトルスライドを含まない） */
export function getNotes(body: string, contentIndex: number): string | null {
  const segs = slideSegments(body);
  const seg = segs[contentIndex - 1];
  if (!seg) return null;
  const blocks = findBlocks(body.slice(seg.start, seg.end));
  if (blocks.length === 0) return null;
  return blocks.map((b) => b.inner).join('\n');
}

/**
 * ノートを置き換えた新しい本文を返す。
 * ブロックが無ければ区間の末尾に作り、text が空ならブロックごと取り除く。
 * 対象区間が無ければ null（呼び出し側でエラー表示する）。
 */
export function setNotes(body: string, contentIndex: number, text: string): string | null {
  const segs = slideSegments(body);
  const seg = segs[contentIndex - 1];
  if (!seg) return null;

  const segment = body.slice(seg.start, seg.end);
  /* 原稿の改行コードで書く（CRLF 原稿に LF で書くと改行コードが混在する）。
     シートから来る text は LF なので、中の改行も揃える */
  const nl = detectNewline(body);
  const trimmed = text.replace(/\s+$/, '').replace(/\r?\n/g, nl);
  const blocks = findBlocks(segment);
  const block = '::: notes' + nl + trimmed + nl + ':::' + nl;

  let nextSegment: string;
  if (blocks.length > 0) {
    // 複数あれば全部消して、最初の位置に1つだけ置き直す
    let rebuilt = '';
    let cursor = 0;
    blocks.forEach((b, i) => {
      rebuilt += segment.slice(cursor, b.index);
      if (i === 0 && trimmed !== '') rebuilt += block;
      cursor = b.index + b.length;
      /* 元のブロック直後の改行を 1 つ畳む。置き直すブロックは自分の改行を末尾に持つので、
         畳まないと保存のたびに空行が 1 つ増える（実測。以前は置き直すときだけ畳んでいなかった） */
      if (segment.startsWith(nl, cursor)) cursor += nl.length;
    });
    rebuilt += segment.slice(cursor);
    nextSegment = rebuilt;
  } else {
    if (trimmed === '') return body;
    // 区間末尾の空行の並びの前に置くときれいに収まる
    const tail = /(?:\r?\n)*$/.exec(segment)!;
    const bodyPart = segment.slice(0, tail.index);
    nextSegment = bodyPart + nl + nl + block + tail[0].replace(/^\r?\n/, '');
  }
  return body.slice(0, seg.start) + nextSegment + body.slice(seg.end);
}
