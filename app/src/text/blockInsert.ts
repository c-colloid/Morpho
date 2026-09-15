/**
 * 原稿へ「1 個の独立したブロック」（いまは画像参照）を差し込む位置決め。
 *
 * カーソル位置へ素朴に splice すると、フェンス行が `::: {.col` / `![](x.png)` /
 * `umns}` の 3 行に割れる（0.13.0 までの実挙動）。ここは純関数で位置だけを決め、
 * 書き戻しは EditorScreen の patchBody が担う。
 *
 * 着地の規則（すべて pandoc 3.10 の実測から）:
 *  - 行の途中には絶対に入れない。前後に空行を確保して独立した段落にする
 *  - **カーソルのある段落（空行で区切られた塊）の直後へ置く**（0.19.8）。
 *    0.19.7 までは区間の末尾へ送っていた（「画像 → 本文」が 2 枚に割れるのを
 *    避けるため）が、割れたスライドは変換器が 1 枚へ積み直す（`stackSegmentSlides`）
 *    ようになったので、書き手の居る場所へ素直に置く。長いスライドで「一番下に
 *    入る」と見えていたのはこの規則だった（実機フィードバック）
 *  - 空行の上ならそこへ。見出し・`+++`・`***` の行の上なら、その直後へ
 *  - `::: notes` の中とコードフェンスの中には入れない（ノートの手前・フェンスの後ろへ）
 *  - pandoc ネイティブ記法の段組み（`::: {.columns}`）で列の外に着地するときは
 *    列の中へ寄せる。段組みの直下（どの列にも属さない位置）へ置くと、pandoc は
 *    画像もテキストも無警告で捨て、しかも段組み自体が消えることがある（実測）
 *
 * 占有ブロック（`beside` を立てたときだけ。0.19.7）:
 *  **横に並べるのは `+++` を書いた人の意思**で、挿入 UI が勝手に列を作ることはしない。
 *  素直に縦へ置けば、割れたスライドは変換器が 1 枚へ積み直す（`stackSegmentSlides`）。
 *  ここで見るのは「置くと壊れる場所」だけ:
 *  - 着地する列に占有ブロック（単独画像・表）が既にあるとき。列の中で重ねると
 *    段組みごと壊れて 3 枚に割れ、3 列目を作れば無警告で消える（実測）。
 *    この 2 つは積み直しでも直せないので、`***` で新しいスライドを起こして逃がす
 *
 * | 原稿 | pandoc | 積み直し後 |
 * |---|---|---|
 * | 画像 → 画像（素直に縦へ） | 2 枚 | **1 枚**（縦に並ぶ） |
 * | 本文 → 表 → 本文 | 2 枚 | **1 枚**（原稿の順序のまま） |
 * | 画像 `+++` 画像 | **1 枚**（Two Content・横に並ぶ） | そのまま |
 * | 画像 `+++` 画像 `+++` 画像 | 1 枚 | **3 つ目が消える**（INFO 1 件だけ） |
 * | 列の中で 画像 → 画像 | 3 枚 | 段組みが壊れているので積み直しも効かない |
 */
import { slideSegments } from '../preview/cursorSlide.ts';
import { COLUMN_SEPARATOR } from './columns.ts';
import { isImageOnlyLine } from './imageLinks.ts';

export type InsertMove =
  | null
  | 'block'
  | 'column'
  | 'notes'
  | 'code'
  | 'front-matter'
  /** 置く先の列が占有ブロックで埋まっていたので `***` で新しいスライドを起こした */
  | 'new-slide';

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

/** li 行目を含む最も外側の `::: notes` の開き行。ノートの外なら -1 */
function notesOpenAt(lines: Line[], li: number): number {
  const open: number[] = [];
  for (let k = 0; k <= li; k++) {
    if (lines[k].open) open.push(k);
    else if (lines[k].close && k < li) open.pop();
  }
  for (const o of open) {
    if ((lines[o].open as string[]).includes('notes')) return o;
  }
  return -1;
}

/** j 行目から遡って空行を飛ばした「中身の末尾の次の行」 */
function trimBack(lines: Line[], from: number, to: number): number {
  let k = to;
  while (k > from && lines[k - 1].text.trim() === '') k--;
  return k;
}

/**
 * 行 from..to（to は含まない）の中身。
 *
 * `occupied` は占有ブロック（単独画像・表）の数。pptx のコンテンツ枠を独り占めするので、
 * 列の中で 2 つ目を重ねると段組みごと壊れる（落とし穴 5・13）。
 *
 * from の時点で開いている div は数に入れない前提で、ここから開く div の中
 * （`::: notes` や列の入れ子）とコードフェンスの中は数えない。
 */
function contentOf(lines: Line[], from: number, to: number): { occupied: number } {
  let depth = 0;
  let inTable = false;
  let occupied = 0;
  for (let k = from; k < Math.min(to, lines.length); k++) {
    const ln = lines[k];
    if (ln.open) { depth++; inTable = false; continue; }
    if (ln.close) { if (depth > 0) depth--; inTable = false; continue; }
    if (ln.code || depth > 0) { inTable = false; continue; }
    const text = ln.text.trim();
    if (text === '') { inTable = false; continue; }
    /* 表は連続する `|` 行でひとかたまり。区切り行だけの `|---|` も同じ塊 */
    if (/^ {0,3}\|/.test(text)) { if (!inTable) occupied++; inTable = true; continue; }
    inTable = false;
    if (isImageOnlyLine(ln.text)) occupied++;
  }
  return { occupied };
}

export function insertBlock(
  body: string,
  cursor: number,
  block: string,
  opts?: {
    /**
     * 占有ブロック（画像・表）として置く。着地する列が既に占有ブロックで
     * 埋まっているときだけ `***` で新しいスライドを起こす（列の中で重ねると
     * 段組みごと壊れるため）。画像の挿入だけが立てる。
     * 横に並べるかどうかは書き手が `+++` で決める — ここでは列を作らない
     */
    beside?: boolean;
  },
): BlockInsertResult {
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
  let moved: InsertMove = null;
  if (cursor < 0) {
    /* front matter の中にカーソルがある。本文の最初の行（見出し）の直後へ */
    moved = 'front-matter';
    for (let k = 0; k < lines.length; k++) {
      if (lines[k].text.trim() !== '') { li = k; break; }
    }
  }
  const beside = opts?.beside === true;
  /* 並べる先が埋まっているときの逃げ場。区間の末尾（`::: notes` の後ろ）へ
     `***` ごと送って新しいスライドを起こす。3 列目は無警告で消え、
     列の中で占有ブロックを重ねると段組みごと壊れて割れる（実測） */
  const toNewSlide = (): BlockInsertResult =>
    place(body, seg.end, '***\n\n' + block, 'new-slide');

  /* 着地行 end（この行の手前に置く。lines.length なら区間の末尾）。
     カーソルのある段落（空行で区切られた塊）の直後が基本 */
  let end: number;
  const notesOpen = notesOpenAt(lines, li);
  if (lines[li].code) {
    /* コードフェンスの中 → 閉じフェンスの次の行 */
    let k = li;
    while (k < lines.length && lines[k].code) k++;
    end = k;
    moved = moved ?? 'code';
  } else if (notesOpen >= 0) {
    /* `::: notes` の中（柵の行を含む）→ 最も外側のノートの開き柵の手前（ノートに埋もれない） */
    end = trimBack(lines, 0, notesOpen);
    moved = moved ?? 'notes';
  } else if (lines[li].text.trim() === '') {
    /* 空行の上ならそこへ */
    end = li;
  } else if (lines[li].open) {
    /* 開き柵（`::: {.column}` 等）の上なら、その中の先頭へ */
    end = li + 1;
  } else if (lines[li].close) {
    /* 閉じ柵の上なら、その手前（中身の末尾） */
    end = trimBack(lines, 0, li);
  } else {
    /* 段落の末尾。空行・柵・コードフェンスで止まる */
    let k = li + 1;
    while (
      k < lines.length &&
      lines[k].text.trim() !== '' &&
      !lines[k].open && !lines[k].close && !lines[k].code
    ) k++;
    end = k;
  }

  /* pandoc ネイティブ記法の段組み（`::: {.columns}`）: 列の外へ置くと無警告で
     消えることがあるので、列の中へ寄せる。着地点より前に開いた列があればその列、
     無ければ最初の列。3 列目以降は pandoc が捨てる（落とし穴 11）ので 2 列まで */
  let colOpen = -1;
  {
    let nth = 0;
    let first = -1;
    let before = -1;
    let inColumns = false;
    for (let k = 0; k < lines.length; k++) {
      const cl = lines[k].open;
      if (!cl) { if (lines[k].close && stackAt(lines, k).length === 1) inColumns = false; continue; }
      if (cl.includes('columns')) { nth = 0; inColumns = true; continue; }
      if (cl.includes('column') && inColumns) {
        nth++;
        if (nth > 2) continue;
        if (first < 0) first = k;
        if (k < end) before = k;
      }
    }
    if (first >= 0) {
      const inside = stackAt(lines, Math.min(end, lines.length - 1))
        .some((cl) => cl.includes('column') && !cl.includes('columns'));
      const onLine = end < lines.length && lines[end].close &&
        stackAt(lines, end).some((cl) => cl.includes('column') && !cl.includes('columns'));
      if (!inside && !onLine) colOpen = before >= 0 ? before : first;
      else if (inside || onLine) {
        /* 3 列目以降の中なら 2 列目の末尾へ */
        let n2 = 0;
        for (let k = 0; k < end; k++) {
          const cl = lines[k].open;
          if (!cl) continue;
          if (cl.includes('columns')) n2 = 0;
          else if (cl.includes('column')) n2++;
        }
        if (n2 > 2) colOpen = before;
      }
    }
  }
  if (colOpen >= 0) {
    const close = closeOf(lines, colOpen);
    end = trimBack(lines, colOpen + 1, Math.min(close, lines.length));
    moved = moved ?? 'column';
  }

  if (beside) {
    /* 着地する列（`+++` の列・ネイティブの列）が占有ブロックで埋まっていれば新しいスライドへ。
       列の無い区間は見ない（縦に並ぶぶんは変換器が積み直す） */
    let from = -1;
    let to = lines.length;
    const colStack = stackAt(lines, Math.min(end, lines.length - 1));
    if (colStack.some((cl) => cl.includes('column') && !cl.includes('columns'))) {
      for (let k = Math.min(end, lines.length) - 1; k >= 0; k--) {
        const cl = lines[k].open;
        if (cl && cl.includes('column') && !cl.includes('columns') && closeOf(lines, k) >= end) {
          from = k + 1;
          to = closeOf(lines, k);
          break;
        }
      }
    } else {
      let seps = 0;
      for (let k = 0; k < lines.length; k++) {
        if (lines[k].code || !COLUMN_SEPARATOR.test(lines[k].text)) continue;
        seps++;
        if (k < end) from = k + 1;
        else { to = k; break; }
      }
      if (seps > 0 && from < 0) from = 0;
    }
    if (from >= 0 && contentOf(lines, from, to).occupied > 0) return toNewSlide();
  }

  /* 行の途中から段落の直後へ動かしたときだけ 'block'（空行の上ならその場） */
  if (moved === null && lines[li].text.trim() !== '') moved = 'block';
  const at = end < lines.length ? lines[end].at : seg.end;
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
