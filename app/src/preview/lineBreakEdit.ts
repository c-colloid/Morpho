/**
 * 改行位置の編集。
 *
 * 目的は「単語・語句の途中で折り返されるのを直す」こと。
 * 段落や箇条書き項目を1行に正規化した plain テキストに対し、
 * 改行位置を「文字オフセットの集合」として編集する。
 * 表示粒度（語 / 字）は UI 側の見せ方であって、データはオフセットのみ。
 */
import { slideSegments } from './cursorSlide.ts';

/* 改行を外して繋ぐとき、両側が ASCII の語なら空白を挟む。
   和文は east_asian_line_breaks と同じく直結する */
const ASCII_WORD = /[A-Za-z0-9)\]}"',.;:!?]/;
const needsSpace = (left: string, right: string): boolean =>
  left !== '' && right !== '' && ASCII_WORD.test(left) && ASCII_WORD.test(right);

export interface NormalizedParagraph {
  plain: string;
  /** plain 内で、明示改行（\ / 行末スペース2つ）が入っていた位置 */
  breakOffsets: Set<number>;
}

/** 段落を1行に正規化する唯一の歩行器 */
export function normalizeParagraph(raw: string): NormalizedParagraph {
  let plain = '';
  const breakOffsets = new Set<number>();
  let i = 0;
  while (i < raw.length) {
    const rest = raw.slice(i);
    let m: RegExpMatchArray | null;
    if ((m = rest.match(/^\\\r?\n[ \t]*/))) {
      breakOffsets.add(plain.length);
      i += m[0].length;
      if (needsSpace(plain.slice(-1), raw[i] ?? '')) plain += ' ';
      continue;
    }
    if ((m = rest.match(/^ {2,}\r?\n[ \t]*/))) {
      breakOffsets.add(plain.length);
      i += m[0].length;
      if (needsSpace(plain.slice(-1), raw[i] ?? '')) plain += ' ';
      continue;
    }
    if ((m = rest.match(/^\r?\n[ \t]*/))) {
      i += m[0].length;
      if (needsSpace(plain.slice(-1), raw[i] ?? '')) plain += ' ';
      continue;
    }
    plain += raw[i];
    i++;
  }
  return { plain, breakOffsets };
}

/* ---------- 分割（表示粒度） ---------- */

/** 前の塊に取り込む: 約物・閉じ括弧・空白のみ。助詞は独立させる（語の粒度を保つ） */
const ATTACH_TO_PREV = /^[、。！？」』）\]｝〉》・…‥,.;:!?)\s]/;

/** 語の単位で分割する。Segmenter が無ければ文字種の連続で近似する */
export function segmentWords(text: string): string[] {
  let words: string[] | null = null;
  try {
    const seg = new (Intl as any).Segmenter('ja', { granularity: 'word' });
    words = Array.from(seg.segment(text), (s: any) => s.segment);
  } catch {
    words = text.match(/[一-龯々〆ヵヶ]+|[ぁ-んー]+|[ァ-ヶー]+|[A-Za-z0-9]+|\s+|./g) ?? [text];
  }
  const chunks: string[] = [];
  for (const w of words) {
    if (chunks.length > 0 && (ATTACH_TO_PREV.test(w) || w.trim() === '')) {
      chunks[chunks.length - 1] += w;
    } else {
      chunks.push(w);
    }
  }
  return chunks.filter((c) => c.length > 0);
}

/** 書記素の単位で分割する（字の粒度 = どこでも改行を置ける） */
export function segmentChars(text: string): string[] {
  try {
    const seg = new (Intl as any).Segmenter('ja', { granularity: 'grapheme' });
    return Array.from(seg.segment(text), (s: any) => s.segment);
  } catch {
    return Array.from(text);
  }
}

/** 指定オフセットに \ 改行を入れて組み立てる。継続行には indent を付ける */
export function applyBreaksAtOffsets(
  plain: string,
  offsets: Set<number>,
  indent: string = '',
): string {
  const sorted = [...offsets].filter((o) => o > 0 && o < plain.length).sort((a, b) => a - b);
  let out = '';
  let prev = 0;
  for (const o of sorted) {
    out += plain.slice(prev, o).replace(/[ \t]+$/, '') + '\\\n' + indent;
    // 行頭に軟結合用の空白が来ないよう食う
    prev = o;
    while (plain[prev] === ' ') prev++;
  }
  out += plain.slice(prev);
  return out;
}

/* ---------- 原稿内の編集対象の特定 ---------- */

export interface EditableBlock {
  /** body 内の置換範囲（ブロック全体） */
  start: number;
  end: number;
  /** 照合用: 開いた時点のブロック原文 */
  raw: string;
  /** 箇条書きなら "- " や "  - " などの接頭辞。段落なら '' */
  prefix: string;
  /** 正規化した1行テキスト */
  plain: string;
  /** 既存の明示改行のオフセット */
  breakOffsets: Set<number>;
}

export type LocateResult =
  | { ok: true; block: EditableBlock }
  | { ok: false; reason: 'not-found' | 'heading' | 'table' };

const LIST_ITEM = /^([ \t]*)([-*+]|\d+[.)])([ \t]+)/;

/**
 * スライド区間の中から、プレビューの段落に対応する編集対象を探す。
 * 段落（空行区切り）と箇条書きの「1項目」（継続行含む）の両方を扱う。
 */
export function locateEditable(
  body: string,
  contentIndex: number,
  needle: string,
): LocateResult {
  const trimmedNeedle = needle.trim();
  if (trimmedNeedle === '') return { ok: false, reason: 'not-found' };
  const seg = slideSegments(body)[contentIndex - 1];
  if (!seg) return { ok: false, reason: 'not-found' };

  const segment = body.slice(seg.start, seg.end);
  const lines = segment.split('\n');

  interface Cand {
    startLine: number;
    endLine: number;
    kind: 'para' | 'item' | 'heading' | 'table' | 'fence';
    prefix: string;
  }
  const cands: Cand[] = [];
  let inFence = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^ {0,3}(```|~~~)/.test(line)) {
      inFence = !inFence;
      cands.push({ startLine: i, endLine: i, kind: 'fence', prefix: '' });
      i++;
      continue;
    }
    if (inFence || line.trim() === '') {
      i++;
      continue;
    }
    if (/^[ \t]*#/.test(line)) {
      cands.push({ startLine: i, endLine: i, kind: 'heading', prefix: '' });
      i++;
      continue;
    }
    if (/^[ \t]*\|/.test(line)) {
      let j = i;
      while (j < lines.length && /^[ \t]*\|/.test(lines[j])) j++;
      cands.push({ startLine: i, endLine: j - 1, kind: 'table', prefix: '' });
      i = j;
      continue;
    }
    const li = LIST_ITEM.exec(line);
    if (li) {
      const prefix = li[0];
      // 継続行: 空行でも新項目でもない、接頭辞以上に字下げされた行
      let j = i + 1;
      while (
        j < lines.length &&
        lines[j].trim() !== '' &&
        !LIST_ITEM.test(lines[j]) &&
        /^[ \t]/.test(lines[j])
      ) {
        j++;
      }
      cands.push({ startLine: i, endLine: j - 1, kind: 'item', prefix });
      i = j;
      continue;
    }
    // 通常の段落: 空行・箇条書き・見出し・表・フェンスの手前まで
    let j = i + 1;
    while (
      j < lines.length &&
      lines[j].trim() !== '' &&
      !LIST_ITEM.test(lines[j]) &&
      !/^[ \t]*#/.test(lines[j]) &&
      !/^[ \t]*\|/.test(lines[j]) &&
      !/^ {0,3}(```|~~~)/.test(lines[j])
    ) {
      j++;
    }
    cands.push({ startLine: i, endLine: j - 1, kind: 'para', prefix: '' });
    i = j;
  }

  const lineOffset = (n: number): number => {
    let off = 0;
    for (let k = 0; k < n; k++) off += lines[k].length + 1;
    return off;
  };

  for (const c of cands) {
    if (c.kind === 'fence') continue;
    const raw = lines.slice(c.startLine, c.endLine + 1).join('\n');
    // 箇条書きは接頭辞と継続行の字下げを外してから正規化する
    const deprefixed =
      c.kind === 'item'
        ? raw.slice(c.prefix.length).replace(/\n[ \t]+/g, '\n')
        : raw;
    const { plain, breakOffsets } = normalizeParagraph(deprefixed);
    const matchable = plain.replace(/[*_`]/g, '');
    if (!matchable.includes(trimmedNeedle)) continue;
    if (c.kind === 'heading') return { ok: false, reason: 'heading' };
    if (c.kind === 'table') return { ok: false, reason: 'table' };
    const start = seg.start + lineOffset(c.startLine);
    const end = start + raw.length;
    return {
      ok: true,
      block: { start, end, raw, prefix: c.prefix, plain, breakOffsets },
    };
  }
  return { ok: false, reason: 'not-found' };
}

/** 編集結果からブロック原文を組み立て直す */
export function rebuildBlock(block: EditableBlock, offsets: Set<number>): string {
  const indent = ' '.repeat(block.prefix.length);
  const text = applyBreaksAtOffsets(block.plain, offsets, block.prefix ? indent : '');
  return block.prefix + text;
}
