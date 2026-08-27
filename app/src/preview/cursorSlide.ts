/**
 * カーソル位置からスライド番号を推定する。
 *
 * pandoc のスライド分割規則の完全な再現ではなく、プレビュー強調のための
 * ヒューリスティック。境界とみなすのは次の2つ:
 *   - 行頭の h1（`# `）
 *   - 水平線（* - _ のいずれかが3つ以上の行。pandoc は hr をスライド区切りにする）
 * `##` 以下は「スライド内のコンテンツ見出し」として扱う（実機の実測と一致）。
 * 外れても害は強調位置がずれるだけなので、正確さより単純さを取る。
 */

const H1 = /^#[ \t]/;
const HR = /^ {0,3}([*_-])(?:[ \t]*\1){2,}[ \t]*$/;
const FENCE = /^ {0,3}(```|~~~)/;

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
  for (const line of upto.split('\n')) {
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
