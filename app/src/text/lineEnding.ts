/**
 * 改行コード（CRLF）の扱い。
 *
 * Windows 由来の .md は CRLF で、iPad でも iCloud Drive 経由で普通に開く。
 * `split('\n')` した各行の末尾には `\r` が残り、`[ \t]*$` で終わる行判定の
 * 正規表現（`+++` / `***` / `:::`）が一致しない。症状は「段組みが無警告で
 * 1 段のまま」= 沈黙の失敗（実測: scripts/check-columns.mjs / check-deck.mjs）。
 * pandoc 自身は CRLF でも LF と同じ出力を返す（実測）ので、壊すのは
 * Morpho 側の行判定だけ。
 *
 * 規約（notes/v014-foundation.md の blockInsert と同じ）:
 *   **判定のときだけ行末の `\r` を落とす。本文とオフセットは書き換えない。**
 * 行頭オフセットは元の行の長さ（`\r` 込み）で数える。sanitizeForXml の
 * 「1 文字 → 1 文字」と違い `\r` の除去は長さを変えるので、原稿側
 * （splitFrontMatter の入力・cursorSlide のオフセット）には適用しない。
 * 変換器へ渡す派生テキストだけは丸ごと落としてよい（bridgeHtml.ts の
 * expandColumns。ブリッジは WebView 用の文字列なのでここを import できず、
 * 同じ規約を自前で持っている）。
 */
export function stripCr(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/**
 * 原稿の改行コード。書き戻しで改行を**入れる**ときはこれに合わせる
 * （CRLF 原稿に LF で書くと、原稿の中で改行コードが混在する）。
 * 1 つでも `\r\n` があれば CRLF とみなす。区間ではなく原稿全体で見る
 * （見出し 1 行だけの短い区間には改行が無いことがある）。
 */
export function detectNewline(text: string): '\n' | '\r\n' {
  return text.includes('\r\n') ? '\r\n' : '\n';
}
