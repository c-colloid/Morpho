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
 *
 * CRLF 原稿では行末の `\r` を落としてから判定する（lineEnding.ts の規約。
 * 本文とオフセットは触らない）。ブリッジ側も同じ規約を自前で持つ。
 */
import { stripCr } from './lineEnding.ts';

/** 列区切りの行。`+` か `＋` が 3 個以上、間の空白は許す */
export const COLUMN_SEPARATOR = /^[ \t]*[+＋]([ \t]*[+＋]){2,}[ \t]*$/;

/** UI が原稿へ挿入する形（半角 3 個） */
export const COLUMN_SEPARATOR_TEXT = '+++';

export function isColumnSeparator(line: string): boolean {
  return COLUMN_SEPARATOR.test(stripCr(line));
}

/* ---- 柵の追跡（規則の原本はここ。bridgeHtml.ts は同じ本文を写している） ----
 *
 * pandoc の fenced div は、開き柵（`:::` + 属性）と閉じ柵（コロンだけの行）が
 * **直近の開きと対**になる。だから `::: notes` の中に `::: warning` などが
 * 入れ子になっていても（Quarto 系からのコピペで現実に入る）、ノートが終わるのは
 * 深さがノートの外へ戻ったときだけ。pandoc 自身はこれを正しく解釈する（実測）。
 *
 * 「`::: notes` で +1・任意の `:::` で -1」という浅い追跡は、入れ子の最初の
 * 閉じでノートを終わらせ、ノートの中身（観客に見せない情報）を本文側の処理へ
 * 渡してしまう。実測では notes 内の `+++` が列区切りとして拾われ、ノートの
 * 続きがスライド本体へ漏れた（notes/footer-design.md の既存の不具合 6・7）。
 *
 * 開き柵は lineBreakEdit.ts と同じ上位集合を取る（`::: 二語` も柵として拾う）。
 * 拾いすぎは「区切りを見逃す」側に倒れて本文に `+++` が見えるだけだが、
 * 取りこぼしはノートが本文へ漏れる側に倒れるので、安全な方を選んでいる。
 *
 * **scanFences の本文と 4 つの正規表現は bridgeHtml.ts にも同じものがある**
 * （ブリッジは WebView 用の文字列なので import できない）。判定規則を二重に
 * 持たないよう、scripts/check-columns.mjs が両者の**本文の一致**と挙動の一致を
 * 常時検証している。片方だけ直すと検査が落ちる。 */

/** コードフェンスの開始/終了行 */
export const CODE_FENCE = /^ {0,3}(```|~~~)/;
/** 柵の行（開き・閉じの両方。閉じかどうかは DIV_CLOSE で先に見る） */
export const DIV_FENCE = /^[ \t]*(?:>[ \t]*)*:::+/;
/** 閉じ柵（コロンだけの行） */
export const DIV_CLOSE = /^[ \t]*(?:>[ \t]*)*:::+[ \t]*$/;
/** `::: notes` の開き柵。中の `+++` は区切りにしない */
export const NOTES_OPEN = /^[ \t]*(?:>[ \t]*)*:::+[ \t]*(?:\{[^}]*\.notes[^}]*\}|notes\b)/;

export interface FenceScan {
  /** その行がコードフェンスの中か（柵の行自身を含む） */
  code: boolean[];
  /** その行が `::: notes` の中か（柵の行自身と、入れ子の div の中も含む） */
  notes: boolean[];
  /** 深さ 0 で開いて閉じた `::: notes` ブロックの [開き行, 閉じ行]。閉じていないものは含めない */
  notesBlocks: number[][];
}

/**
 * 行ごとに柵の深さを追い、コードフェンスの中・`::: notes` の中を印す。
 * 入れ子の div を含むノートでも、閉じ柵は開いた柵と対で数える。
 * lines は行末の `\r` を落としたもの（stripCr 済み）を渡す。CRLF のままだと
 * `[ \t]*$` で終わる柵の判定が一致しない（lineEnding.ts の規約）。
 */
export function scanFences(lines: string[]): FenceScan {
  const code = [];
  const notes = [];
  const notesBlocks = [];
  let inCode = false;
  let depth = 0;
  /* 最も外側の notes が開いたときの深さ。0 ならノートの外 */
  let notesAt = 0;
  let notesOpen = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = CODE_FENCE.test(line);
    if (fence) inCode = !inCode;
    if (fence || inCode) {
      code.push(true);
      notes.push(notesAt > 0);
      continue;
    }
    code.push(false);
    if (DIV_CLOSE.test(line)) {
      /* 閉じ柵は直近の開き柵と対。ノートが終わるのは深さがノートの外へ戻ったとき */
      if (depth > 0) depth--;
      notes.push(notesAt > 0);
      if (notesAt > 0 && depth < notesAt) {
        if (notesAt === 1) notesBlocks.push([notesOpen, i]);
        notesAt = 0;
      }
      continue;
    }
    if (DIV_FENCE.test(line)) {
      depth++;
      if (notesAt === 0 && NOTES_OPEN.test(line)) {
        notesAt = depth;
        notesOpen = i;
      }
    }
    notes.push(notesAt > 0);
  }
  return { code: code, notes: notes, notesBlocks: notesBlocks };
}

/**
 * 本文中の列区切り行の位置（0 始まりの行番号）。
 * コードフェンスの中と `::: notes` の中（入れ子の div を含む）は数えない。
 */
export function separatorLines(body: string): number[] {
  /* 判定のときだけ行末の \r を落とす（CRLF 原稿）。行番号とオフセットは raw のまま */
  const lines = body.split('\n').map(stripCr);
  const scan = scanFences(lines);
  const out: number[] = [];
  lines.forEach((line, i) => {
    if (!scan.code[i] && !scan.notes[i] && COLUMN_SEPARATOR.test(line)) out.push(i);
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
