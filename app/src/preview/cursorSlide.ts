/**
 * カーソル位置からスライド番号を推定する。
 *
 * pandoc のスライド分割規則の完全な再現ではなく、プレビュー強調のための
 * ヒューリスティック。境界とみなすのは次の2つ:
 *   - 行頭の h1（`# `）
 *   - 水平線（* - _ のいずれかが3つ以上の行。pandoc は hr をスライド区切りにする）
 * `##` 以下は「スライド内のコンテンツ見出し」として扱う（実機の実測と一致）。
 * 外れても害は強調位置がずれるだけなので、正確さより単純さを取る。
 *
 * CRLF 原稿では行末の `\r` を外してから判定する（lineEnding.ts の規約）。
 * `***\r` が水平線に一致せず境界が消えていた（実測: scripts/check-cursor.mjs）。
 * オフセットは元の行の長さ（`\r` 込み）で数えるので、本文の対応は変わらない。
 */
import { stripCr } from '../text/lineEnding.ts';

const H1 = /^#[ \t]/;
const HR = /^ {0,3}([*_-])(?:[ \t]*\1){2,}[ \t]*$/;
const FENCE = /^ {0,3}(```|~~~)/;

/** 本文をコンテンツスライドごとの区間に切る。start/end は body 内のオフセット */
export interface SlideSegment {
  start: number;
  end: number;
}

/**
 * スライド区切り位置で本文を分割する。
 * slideIndexAtCursor と同じ境界規則（h1 / hr、連続境界の合体、フェンス無視）。
 * n 番目の区間 = n 番目のコンテンツスライド（タイトルスライドは含まない）。
 */
export function slideSegments(body: string): SlideSegment[] {
  const segments: SlideSegment[] = [];
  let segStart = 0;
  let hasContent = false;
  let inFence = false;
  let offset = 0;
  for (const raw of body.split('\n')) {
    const lineStart = offset;
    offset += raw.length + 1;
    const line = stripCr(raw);
    if (FENCE.test(line)) {
      inFence = !inFence;
      hasContent = true;
      continue;
    }
    if (inFence) {
      if (line.trim() !== '') hasContent = true;
      continue;
    }
    if (H1.test(line)) {
      if (hasContent) {
        segments.push({ start: segStart, end: lineStart });
        segStart = lineStart;
      }
      hasContent = true;
    } else if (HR.test(line)) {
      if (hasContent) {
        segments.push({ start: segStart, end: lineStart });
        segStart = lineStart;
      }
      hasContent = false;
    } else if (line.trim() !== '') {
      hasContent = true;
    }
  }
  segments.push({ start: segStart, end: body.length });
  return segments;
}

/**
 * @param body   front matter を取り除いた本文
 * @param cursor body 内のカーソル位置（文字オフセット）
 * @param hasTitleSlide front matter の title でタイトルスライドが1枚できるか
 * @returns 1 始まりのスライド番号
 */
export function slideIndexAtCursor(
  body: string,
  cursor: number,
  hasTitleSlide: boolean,
): number {
  const upto = body.slice(0, Math.max(0, Math.min(cursor, body.length)));

  /* 境界は「直前の境界以降に中身があるときだけ」新しいスライドを開く。
     hr の直後に h1 が来る書き方（*** → # 見出し）は1つの区切りに合体する。
     これは実機の実測（*** + h1 で3枚）と一致する。
     h1 はそれ自体がスライドの中身（タイトル）になるので、通過後は中身あり扱い。 */
  let slide = 1;
  let hasContent = false;
  let inFence = false;
  for (const raw of upto.split('\n')) {
    const line = stripCr(raw);
    // コードフェンス内の # や *** は境界ではない
    if (FENCE.test(line)) {
      inFence = !inFence;
      hasContent = true;
      continue;
    }
    if (inFence) {
      if (line.trim() !== '') hasContent = true;
      continue;
    }
    if (H1.test(line)) {
      if (hasContent) slide++;
      hasContent = true;
    } else if (HR.test(line)) {
      if (hasContent) slide++;
      hasContent = false;
    } else if (line.trim() !== '') {
      hasContent = true;
    }
  }
  return slide + (hasTitleSlide ? 1 : 0);
}
