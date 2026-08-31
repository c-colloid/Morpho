/**
 * 原稿へ「1 個の独立したブロック」（いまは画像参照）を差し込む位置決め。
 *
 * カーソル位置へ素朴に splice すると、フェンス行が `::: {.col` / `![](x.png)` /
 * `umns}` の 3 行に割れる（0.13.0 までの実挙動）。ここは純関数で位置だけを決め、
 * 書き戻しは EditorScreen の patchBody が担う。
 *
 * 着地の規則（すべて pandoc 3.10 の実測から）:
 *  - 行の途中には絶対に入れない。前後に空行を確保して独立した段落にする
 *  - カーソルが列（`::: {.column}`）の中にあれば、その列の中身の末尾へ
 *  - 列の外なら、その区間に段組みがあれば最後の列の中へ。
 *    段組みの直下（どの列にも属さない位置）へ置くと、pandoc は
 *    画像もテキストも無警告で捨て、しかも段組み自体が消えることがある（実測）
 *  - それ以外はカーソルのあるスライド区間の末尾へ。
 *    「本文 → 画像」は Content with Caption になって 1 枚に収まるが、
 *    「画像 → 本文」は 2 枚に割れる（実測）ので、必ず既存本文の後ろへ送る
 *  - `::: notes` の中とコードフェンスの中には入れない
 */
import { slideSegments } from '../preview/cursorSlide.ts';
import { COLUMN_SEPARATOR } from './columns.ts';

export type InsertMove = null | 'block' | 'column' | 'notes' | 'code' | 'front-matter';

export interface BlockInsertResult {
  /** 差し替え後の本文 */
  body: string;
  /** 挿入したブロックの末尾（body 内オフセット）。カーソルをここへ戻す */
  cursor: number;
  /** カーソル位置から動かした理由。v0.15 の Diagnostic 用 */
  moved: InsertMove;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const DIV = /^ {0,3}(:{3,})[ \t]*(.*)$/;

interface Line {
  at: number;
  text: string;
  /** コードフェンスの中（開始行・終了行を含む） */
  code: boolean;
  /** div の開き / 閉じ。閉じは「コロンだけの行」 */
  open: string[] | null;
  close: boolean;
}

function classesOf(spec: string): string[] {
  if (spec === '') return [];
  const brace = /^\{(.*)\}$/.exec(spec.trim());
  const inner = brace ? brace[1] : spec.trim();
  const out: string[] = [];
  for (const t of inner.split(/[\s,]+/)) {
    if (t.startsWith('.')) out.push(t.slice(1));
    else if (!t.startsWith('#') && !t.includes('=') && t !== '') out.push(t);
  }
  return out;
}

function scan(text: string, base: number): Line[] {
  const out: Line[] = [];
  let off = base;
  /* フェンスは「同種で開始以上の長さ」でだけ閉じる。
     ````markdown の中の ``` でトグルが反転しないようにする */
  let fence: string | null = null;
  for (const raw of text.split('\n')) {
    const at = off;
    off += raw.length + 1;
    /* 判定のときだけ行末の \r を落とす（CRLF 原稿。本文は書き換えない） */
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const f = FENCE.exec(line);
    if (fence !== null) {
      const closing = f && f[1][0] === fence[0] && f[1].length >= fence.length;
      out.push({ at, text: line, code: true, open: null, close: false });
      if (closing) fence = null;
      continue;
    }
    if (f) {
      fence = f[1];
      out.push({ at, text: line, code: true, open: null, close: false });
      continue;
    }
    const d = DIV.exec(line);
    if (d) {
      const spec = d[2].replace(/:+$/, '').trim();
      if (spec === '') out.push({ at, text: line, code: false, open: null, close: true });
      else out.push({ at, text: line, code: false, open: classesOf(spec), close: false });
      continue;
    }
    out.push({ at, text: line, code: false, open: null, close: false });
  }
  return out;
}

/** i 行目の直前で開いている div のクラス列（外→内） */
function stackAt(lines: Line[], i: number): string[][] {
  const st: string[][] = [];
  for (let k = 0; k < i; k++) {
    if (lines[k].open) st.push(lines[k].open as string[]);
    else if (lines[k].close) st.pop();
  }
  return st;
}

/** open 行 i に対応する閉じ行の番号。見つからなければ lines.length */
function closeOf(lines: Line[], i: number): number {
  let depth = 0;
  for (let k = i; k < lines.length; k++) {
    if (lines[k].open) depth++;
    else if (lines[k].close) {
      depth--;
      if (depth === 0) return k;
    }
  }
  return lines.length;
}

/** j 行目から遡って空行を飛ばした「中身の末尾の次の行」 */
function trimBack(lines: Line[], from: number, to: number): number {
  let k = to;
  while (k > from && lines[k - 1].text.trim() === '') k--;
  return k;
}

export function insertBlock(body: string, cursor: number, block: string): BlockInsertResult {
  if (body.trim() === '') {
    const b = block + '\n';
    return { body: b, cursor: block.length, moved: null };
  }
  const c = Math.max(0, Math.min(cursor, body.length));
  const segs = slideSegments(body);
  let si = segs.length - 1;
  for (let k = 0; k < segs.length; k++) {
    if (c >= segs[k].start && c < segs[k].end) { si = k; break; }
  }
  const seg = segs[si];
  const lines = scan(body.slice(seg.start, seg.end), seg.start);
  let li = lines.length - 1;
  for (let k = 0; k < lines.length; k++) {
    if (c >= lines[k].at && c <= lines[k].at + lines[k].text.length) { li = k; break; }
  }

  let moved: InsertMove = cursor <= 0 ? 'front-matter' : null;
  if (cursor <= 0 && seg.start > 0) moved = 'front-matter';
  else if (cursor <= 0) moved = null;

  /* 0. `+++`（列区切り）がある区間では、カーソルのいる列の末尾へ置く。
     区間の末尾へ送ると最後の列に入ってしまい、書き手の意図と食い違う。
     最後の列にいるときは下の「区間の末尾」の規則へ落ちる（notes と *** を越えない） */
  const sepLines: number[] = [];
  for (let k = 0; k < lines.length; k++) {
    if (!lines[k].code && COLUMN_SEPARATOR.test(lines[k].text)) sepLines.push(k);
  }
  if (sepLines.length) {
    const next = sepLines.find((k) => k > li);
    if (next !== undefined) {
      const end = trimBack(lines, 0, next);
      return place(body, end < lines.length ? lines[end].at : seg.end, block, 'column');
    }
  }

  /* 1. カーソルのいる列（無ければ区間の最後の列） */
  let colOpen = -1;
  const st = stackAt(lines, li);
  if (st.some((cl) => cl.includes('column') && !cl.includes('columns'))) {
    for (let k = li; k >= 0; k--) {
      const cl = lines[k].open;
      if (cl && cl.includes('column') && !cl.includes('columns') && closeOf(lines, k) >= li) {
        /* この列が段組みの何番目か。3 列目以降なら捨てられるので採らない */
        let nth = 0;
        for (let j = 0; j <= k; j++) {
          const c2 = lines[j].open;
          if (!c2) continue;
          if (c2.includes('columns')) nth = 0;
          if (c2.includes('column') && !c2.includes('columns')) nth++;
        }
        if (nth <= 2) colOpen = k;
        break;
      }
    }
    if (colOpen >= 0) moved = moved ?? 'column';
  }
  if (colOpen < 0) {
    /* 3 列目以降は pandoc が無警告で捨てる（落とし穴 11）ので、
       同じ段組みの中では先頭 2 列までしか着地点にしない */
    let nth = 0;
    for (let k = 0; k < lines.length; k++) {
      const cl = lines[k].open;
      if (!cl) continue;
      if (cl.includes('columns')) nth = 0;
      if (cl.includes('column') && !cl.includes('columns')) {
        nth++;
        if (nth <= 2) colOpen = k;
      }
    }
    if (colOpen >= 0) moved = 'column';
  }

  let at: number;
  if (colOpen >= 0) {
    const end = closeOf(lines, colOpen);
    const k = trimBack(lines, colOpen + 1, Math.min(end, lines.length));
    at = k < lines.length ? lines[k].at : body.length;
  } else {
    /* 2. 区間の末尾。末尾の空行・水平線・`::: notes` ブロックは越えない */
    let end = trimBack(lines, 0, lines.length);
    for (;;) {
      if (end > 0 && /^ {0,3}([*_-])(?:[ \t]*\1){2,}[ \t]*$/.test(lines[end - 1].text)) {
        end = trimBack(lines, 0, end - 1);
        continue;
      }
      /* 末尾が最上位の notes div ならその手前へ */
      let openLine = -1;
      for (let k = 0; k < end; k++) {
        if (lines[k].open && stackAt(lines, k).length === 0) {
          if (closeOf(lines, k) === end - 1 && (lines[k].open as string[]).includes('notes')) openLine = k;
        }
      }
      if (openLine >= 0) { end = trimBack(lines, 0, openLine); moved = 'notes'; continue; }
      break;
    }
    if (moved === null && end - 1 !== li) moved = lines[li].code ? 'code' : 'block';
    at = end < lines.length ? lines[end].at : seg.end;
    if (end >= lines.length) at = seg.end;
  }
  return place(body, at, block, moved);
}

/** 着地点へ独立した段落として置く。前後に空行を確保し、元の行は決して割らない */
function place(body: string, atRaw: number, block: string, moved: InsertMove): BlockInsertResult {
  const at = Math.max(0, Math.min(atRaw, body.length));
  const prev = body.slice(0, at);
  const rest = body.slice(at);
  const lead = prev === '' ? '' : prev.endsWith('\n\n') ? '' : prev.endsWith('\n') ? '\n' : '\n\n';
  const tail = rest === '' ? '\n' : rest.startsWith('\n') ? '\n' : '\n\n';
  return {
    body: prev + lead + block + tail + rest,
    cursor: at + lead.length + block.length,
    moved,
  };
}
