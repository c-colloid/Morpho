/**
 * 段組みの記法（`+++` の列区切り）。
 *
 * 内容層の語彙であって、pandoc の語彙ではない。
 * ここは「原稿のどこが列の区切りか」だけを答える純関数で、
 * それを fenced div へ実現するのは変換器（bridgeHtml.ts）の仕事。
 * 自前 writer（MIT）に差し替えても、このファイルはそのまま生き残る。
 *
 * 設計と実測の根拠は ../../../notes/column-input.md。
 * 要点だけ:
 *   - pandoc ネイティブの `::: {.columns}` は 8 行・半角記号 4 種で、
 *     日本語入力面のまま打てる構造文字が 0。62 通り試して 34 通りが失敗し、
 *     うち 32 件は完全に無警告だった
 *   - `+++` は pandoc の markdown ではただの段落として素通りする（実測）。
 *     素の pandoc / Obsidian では `+++` の行が見えるだけで本文は全部読める
 *   - 全角 `＋＋＋` と空白入り `+ + +` も受ける。前者は IME で普通に起き、
 *     後者は pandoc が痕跡なく消す（実測）ので、救わないと最悪の沈黙になる
 *
 * **この正規表現は bridgeHtml.ts にも同じものがある**（ブリッジは WebView 用の
 * 文字列なので import できない）。食い違うと原稿とプレビューで列の切れ目が
 * ずれるので、scripts/check-columns.mjs が両者の一致を常時検証している。
 */

/** 列区切りの行。`+` か `＋` が 3 個以上、間の空白は許す */
export const COLUMN_SEPARATOR = /^[ \t]*[+＋]([ \t]*[+＋]){2,}[ \t]*$/;

/** UI が原稿へ挿入する形（半角 3 個） */
export const COLUMN_SEPARATOR_TEXT = '+++';

export function isColumnSeparator(line: string): boolean {
  return COLUMN_SEPARATOR.test(line);
}

/** コードフェンスの開始/終了行 */
const CODE_FENCE = /^ {0,3}(```|~~~)/;
/** `::: notes` の開き柵。中の `+++` は区切りにしない */
const NOTES_OPEN = /^[ \t]*(?:>[ \t]*)*:::+[ \t]*(?:\{[^}]*\.notes[^}]*\}|notes\b)/;
/** 閉じ柵（コロンだけの行） */
const DIV_CLOSE = /^[ \t]*(?:>[ \t]*)*:::+[ \t]*$/;

/**
 * 本文中の列区切り行の位置（0 始まりの行番号）。
 * コードフェンスの中と `::: notes` の中は数えない。
 */
export function separatorLines(body: string): number[] {
  const out: number[] = [];
  let inCode = false;
  let notesDepth = 0;
  body.split('\n').forEach((line, i) => {
    if (CODE_FENCE.test(line)) {
      inCode = !inCode;
      return;
    }
    if (inCode) return;
    if (NOTES_OPEN.test(line)) {
      notesDepth += 1;
      return;
    }
    if (notesDepth > 0) {
      if (DIV_CLOSE.test(line)) notesDepth -= 1;
      return;
    }
    if (COLUMN_SEPARATOR.test(line)) out.push(i);
  });
  return out;
}

/**
 * カーソル位置が属する「列」の範囲（body 内のオフセット）。
 * 区切りが無ければ null。挿入 UI が「いまいる列の末尾へ置く」ために使う。
 */
export function columnRangeAt(
  body: string,
  cursor: number,
): { start: number; end: number } | null {
  const seps = separatorLines(body);
  if (!seps.length) return null;
  const lines = body.split('\n');
  /* 行頭オフセットの表 */
  const starts: number[] = [];
  let off = 0;
  for (const line of lines) {
    starts.push(off);
    off += line.length + 1;
  }
  let start = 0;
  let end = body.length;
  for (const li of seps) {
    const sepStart = starts[li];
    const sepEnd = sepStart + lines[li].length;
    if (sepEnd < cursor) start = sepEnd + 1;
    else if (sepStart > cursor) {
      end = sepStart;
      break;
    } else {
      /* カーソルが区切り行の上にある。列の外なので範囲は持たない */
      return null;
    }
  }
  return { start, end: Math.max(start, end) };
}
