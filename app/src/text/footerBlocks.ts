/**
 * スライドごとのフッター（出典・注釈）の記法。
 *
 * 内容層の語彙であって、pandoc の語彙ではない。ここは「原稿のどの行がフッターの
 * 記法か」だけを答える純関数で、形式ごとの実現（pptx は目印を埋めて実出力から取り出す・
 * docx は小さい段落・html は div.footer）は変換器（bridgeHtml.ts）の仕事。
 *
 * 設計と実測の根拠は ../../../notes/footer-design.md（「多視点監査と仕様の改訂（0.17.0 v2）」）。
 * 要点だけ:
 *   - 主入力は 1 行の `/// 文言`。閉じが無いので閉じ忘れが起こせない
 *   - `/` は 3 個以上・全角 `／／／` 可。**間の空白は不可**（`/ / /` は pandoc で本文に
 *     残る見える失敗で、`+ + +` を救った「痕跡なく消える」根拠が `/` には無い）。
 *     行頭タブ不可・字下げは半角 3 まで（4 以上はインデントコードブロック）
 *   - 文言が空なら「そのスライドだけデッキ全体の出典を出さない」
 *   - 可搬形として `::: footer` 〜 `:::`（`::: {.footer}` / `::: 出典` / `::: 注釈` も）を受ける
 *   - 行頭キーワード（`出典:` / `※`）は採らない — 一般文で踏む（実測）
 *
 * **この正規表現は bridgeHtml.ts にも同じものがある**（ブリッジは WebView 用の
 * 文字列なので import できない）。scripts/check-footer.mjs が両者の一致を常時検証している。
 */
import { stripCr } from './lineEnding.ts';

/** 1 行形。`(.*)` が文言 */
export const FOOTER_LINE = /^ {0,3}[/／]{3,}[ \t]*(.*)$/;

/** UI が原稿へ挿入する形。キャレットは末尾（空白の後）に置く */
export const FOOTER_LINE_TEXT = '/// ';

/**
 * 柵形の開き（全角を正規化した行に対して照合）。JS の `\b` は CJK 直後で成立しないので
 * 明示の境界を使う（`::: 出典追記` は一致しない）
 */
export const FOOTER_FENCE_OPEN =
  /^ {0,3}:::+[ \t]*(?:\{[ \t]*\.?(?:footer|出典|注釈)(?:[ \t][^}]*)?\}|(?:footer|出典|注釈)(?=[ \t]|$))[ \t]*(.*)$/i;

/** 柵の行の全角記号を半角に寄せる（日本語 IME で普通に起きる） */
export function normalizeFenceLine(line: string): string {
  return line.replace(/：/g, ':').replace(/　/g, ' ').replace(/｛/g, '{').replace(/｝/g, '}');
}

export function isFooterLine(line: string): boolean {
  return FOOTER_LINE.test(stripCr(line));
}

export function isFooterFenceOpen(line: string): boolean {
  return FOOTER_FENCE_OPEN.test(normalizeFenceLine(stripCr(line)));
}
