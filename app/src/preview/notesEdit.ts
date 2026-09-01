/**
 * 発表者ノート（::: notes ::: ブロック）の読み書き。
 *
 * プレビューのノート欄から編集した内容を、該当スライドの原稿区間へ書き戻す。
 * 「プレビューで編集し、確定は原稿へ書く」一方向フローの最初の実装。
 */
import { slideSegments } from './cursorSlide.ts';
import { detectNewline } from '../text/lineEnding.ts';

/* 閉じ柵の `$` は複数行モードなので `\r` の手前にも一致し、CRLF 原稿でも
   ブロックを読める（実測）。inner には `\r\n` と末尾の `\r` が残るので下で外す */
const NOTES_BLOCK = /^[ \t]*:::+[ \t]*notes[ \t]*\r?\n([\s\S]*?)^[ \t]*:::+[ \t]*$/gm;

/** 区間内の notes ブロックをすべて列挙する（pandoc は複数あっても全部ノートにする） */
function findBlocks(segment: string): Array<{ index: number; length: number; inner: string }> {
  const out: Array<{ index: number; length: number; inner: string }> = [];
  NOTES_BLOCK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NOTES_BLOCK.exec(segment)) !== null) {
    /* シートへ渡す文字列は LF に揃える（原稿は触らない。書き戻しで原稿の改行コードに戻す） */
    out.push({ index: m.index, length: m[0].length, inner: m[1].replace(/\s+$/, '').replace(/\r\n/g, '\n') });
  }
  return out;
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
