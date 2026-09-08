/**
 * ソフトキーボード用ツールバーの編集操作（純関数）。
 *
 * 日本語のソフトキーボードでは Markdown の構造文字（`#` `-` `\` `*` 半角空白 2 つ）が
 * 打ちにくい。`\` は `¥` になり（README「原稿の書き方」）、字下げは全角空白で
 * 箇条書きごと壊れる（実測）。ここは「今の原稿と選択範囲」から「次の原稿と選択範囲」を
 * 返すだけで、ネイティブへの反映は EditorScreen が担う。
 *
 * すべての操作は選択範囲の外の文字を 1 文字も変えない（原稿への忠実性）。
 * 改行コードは触らない — 行頭の判定は `\n` で行い、CRLF 原稿でも行の途中に
 * `\r` を残さないよう、行の走査は `\n` 区切り・判定時だけ `\r` を外す。
 */
import { stripCr } from './lineEnding.ts';

export interface Selection {
  start: number;
  end: number;
}

export interface EditResult {
  text: string;
  selection: Selection;
}

/** 行頭に付けるマーク。同じマークが既にあれば外す（トグル） */
export type LinePrefix = '# ' | '## ' | '- ' | '1. ' | '> ';

function clampSel(text: string, sel: Selection): Selection {
  const s = Math.max(0, Math.min(sel.start, text.length));
  const e = Math.max(s, Math.min(sel.end, text.length));
  return { start: s, end: e };
}

/** 位置 at を含む行の先頭オフセット */
export function lineStartAt(text: string, at: number): number {
  const i = text.lastIndexOf('\n', Math.max(0, at - 1));
  return i < 0 ? 0 : i + 1;
}

/** 位置 at を含む行の末尾（`\n` の手前・CRLF なら `\r` の手前） */
export function lineEndAt(text: string, at: number): number {
  const i = text.indexOf('\n', at);
  const end = i < 0 ? text.length : i;
  return end > 0 && text[end - 1] === '\r' && (i >= 0 || text.endsWith('\r')) ? end - 1 : end;
}

interface LineEdit {
  /** 元の原稿でのオフセット */
  at: number;
  /** 増減した文字数 */
  delta: number;
}

/**
 * 元の原稿の位置 p を、行ごとの編集を通した後の位置へ写す。
 * 足したときは境界上の位置も後ろへ（行頭の選択は付けたマークの後ろから始まる・
 * キャレットは `- ` の後ろへ来て続けて打てる）。外したときは境界上は動かさない。
 */
function mapPos(p: number, edits: LineEdit[]): number {
  let out = p;
  for (const e of edits) {
    if (e.delta > 0) {
      if (p >= e.at) out += e.delta;
    } else if (p > e.at) {
      /* 外したマークの中にいた位置は、マークのあった場所へ寄せる */
      out += Math.max(e.delta, e.at - p);
    }
  }
  return Math.max(0, out);
}

/** 選択範囲にかかる行の範囲（from = 先頭行の行頭・to = 末尾行の行末） */
function lineSpan(text: string, sel: Selection): { from: number; to: number } {
  const from = lineStartAt(text, sel.start);
  /* 選択の末尾が行頭ちょうどなら、その行は含めない（下の行に飛び火しない） */
  const lastAt = sel.end > sel.start && text[sel.end - 1] === '\n' ? sel.end - 1 : sel.end;
  return { from, to: lineEndAt(text, lastAt) };
}

function applyLineEdits(
  text: string,
  sel: Selection,
  edit: (line: string, i: number, all: string[]) => { next: string; at: number; delta: number } | null,
): EditResult {
  const { from, to } = lineSpan(text, sel);
  const lines = text.slice(from, to).split('\n');
  const edits: LineEdit[] = [];
  const out: string[] = [];
  let off = from;
  lines.forEach((line, i) => {
    const r = edit(line, i, lines);
    if (r && r.delta !== 0) edits.push({ at: off + r.at, delta: r.delta });
    out.push(r ? r.next : line);
    off += line.length + 1;
  });
  const nextText = text.slice(0, from) + out.join('\n') + text.slice(to);
  return {
    text: nextText,
    selection: clampSel(nextText, { start: mapPos(sel.start, edits), end: mapPos(sel.end, edits) }),
  };
}

/**
 * 選択範囲にかかる各行の先頭でマークをトグルする。
 * 行頭の空白（字下げ）は保ち、その後ろへ付ける。番号付き（`1. `）は
 * 「数字 + `. `」なら既にあるとみなして外す。
 * すべての行に既にあれば外し、1 行でも無ければ全行へ付ける（エディタの慣例）。
 */
export function toggleLinePrefix(text: string, selIn: Selection, prefix: LinePrefix): EditResult {
  const sel = clampSel(text, selIn);
  const has = (line: string): { at: number; len: number } | null => {
    const body = stripCr(line);
    const indent = /^[ \t]*/.exec(body)![0].length;
    const rest = body.slice(indent);
    if (prefix === '1. ') {
      const m = /^\d+\.[ \t]/.exec(rest);
      return m ? { at: indent, len: m[0].length } : null;
    }
    return rest.startsWith(prefix) ? { at: indent, len: prefix.length } : null;
  };
  let allHave = true;
  return applyLineEdits(text, sel, (line, i, all) => {
    if (i === 0) allHave = all.every((l) => has(l) !== null);
    const h = has(line);
    if (allHave && h) {
      return { next: line.slice(0, h.at) + line.slice(h.at + h.len), at: h.at, delta: -h.len };
    }
    if (!allHave && !h) {
      const indent = /^[ \t]*/.exec(stripCr(line))![0].length;
      const p = prefix === '1. ' ? `${i + 1}. ` : prefix;
      return { next: line.slice(0, indent) + p + line.slice(indent), at: indent, delta: p.length };
    }
    return null;
  });
}

/**
 * 選択範囲にかかる各行を半角空白 2 つで字下げ（delta=+1）／字下げ戻し（−1）。
 * 戻すときは行頭の空白 2 つ、またはタブ 1 つ・空白 1 つを外す。
 */
export function indentLines(text: string, selIn: Selection, delta: 1 | -1): EditResult {
  const sel = clampSel(text, selIn);
  return applyLineEdits(text, sel, (line) => {
    if (delta > 0) return { next: '  ' + line, at: 0, delta: 2 };
    if (line.startsWith('  ')) return { next: line.slice(2), at: 0, delta: -2 };
    if (line.startsWith('\t') || line.startsWith(' ')) return { next: line.slice(1), at: 0, delta: -1 };
    return null;
  });
}

/**
 * 選択範囲を marker で囲む（太字 `**` など）。選択が無ければ marker を 2 つ入れて
 * 間にキャレットを置く。既に囲まれていれば外す。
 */
export function wrapSelection(text: string, selIn: Selection, marker: string): EditResult {
  const sel = clampSel(text, selIn);
  const m = marker.length;
  const inner = text.slice(sel.start, sel.end);
  /* 選択の内側が marker で囲まれている（`**太字**` を丸ごと選んだ） */
  if (inner.length >= 2 * m && inner.startsWith(marker) && inner.endsWith(marker)) {
    const stripped = inner.slice(m, inner.length - m);
    const next = text.slice(0, sel.start) + stripped + text.slice(sel.end);
    return { text: next, selection: { start: sel.start, end: sel.start + stripped.length } };
  }
  /* 選択の外側が marker で囲まれている（`**` の間の「太字」だけを選んだ） */
  if (
    sel.start >= m &&
    text.slice(sel.start - m, sel.start) === marker &&
    text.slice(sel.end, sel.end + m) === marker
  ) {
    const next = text.slice(0, sel.start - m) + inner + text.slice(sel.end + m);
    return { text: next, selection: { start: sel.start - m, end: sel.end - m } };
  }
  const next = text.slice(0, sel.start) + marker + inner + marker + text.slice(sel.end);
  return { text: next, selection: { start: sel.start + m, end: sel.end + m } };
}

/** 選択範囲を insert で置き換え、キャレットを insert の末尾（caretBack ぶん手前）へ */
export function replaceSelection(
  text: string,
  selIn: Selection,
  insert: string,
  caretBack = 0,
): EditResult {
  const sel = clampSel(text, selIn);
  const next = text.slice(0, sel.start) + insert + text.slice(sel.end);
  const at = sel.start + insert.length - Math.max(0, Math.min(caretBack, insert.length));
  return { text: next, selection: { start: at, end: at } };
}

/**
 * スライド上の改行を固定する `\` + 改行をキャレット位置に入れる。
 * 行末なら `\⏎`、行の途中ならそこで行を割る（「ここで折り返す」の意味そのまま）。
 * 既に `\` の直後（`\|`）なら改行だけ足す（二重に付けない）。
 * CRLF 原稿では原稿の改行コードに合わせる。
 */
export function insertHardBreak(text: string, selIn: Selection, newline: '\n' | '\r\n' = '\n'): EditResult {
  const sel = clampSel(text, selIn);
  const before = text.slice(0, sel.start);
  /* キャレットの手前が空白なら詰める（`文 \` は pandoc で `文\` と同じだが見た目が揃う） */
  const trimmed = before.replace(/[ \t]+$/, '');
  const mark = trimmed.endsWith('\\') ? '' : '\\';
  const insert = mark + newline;
  const next = trimmed + insert + text.slice(sel.end);
  const at = trimmed.length + insert.length;
  return { text: next, selection: { start: at, end: at } };
}
