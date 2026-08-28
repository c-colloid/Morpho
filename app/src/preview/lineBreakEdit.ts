/**
 * 改行位置の編集。
 *
 * プレビューで選んだ段落を文節相当の粒度に割り、選んだ継ぎ目に
 * pandoc の明示改行（行末バックスラッシュ）を入れた原稿を作る。
 * 分割は Intl.Segmenter('ja') が使えればそれを、無ければ
 * 句読点ベースの粗い分割に落とす（Hermes の対応状況が未確認のため）。
 */
import { slideSegments } from './cursorSlide.ts';

/** 助詞・助動詞などを前の語に取り込むための簡易判定 */
const ATTACH_TO_PREV =
  /^(は|が|を|に|へ|と|で|や|の|も|か|ね|よ|な|ぞ|さ|から|まで|より|など|だけ|ほど|しか|でも|には|とは|では|への|うえ|こと|もの|です|ます|でした|ました|だ|た|て|し|れ|られ|せ|させ|ない|ん|う|よう|そう|らしい|、|。|！|？|」|』|）|］|・|…|,|\.|!|\?|\)|\])/;

export function segmentJa(text: string): string[] {
  let words: string[] | null = null;
  try {
    // Hermes に Segmenter が無い環境では throw する
    const seg = new (Intl as any).Segmenter('ja', { granularity: 'word' });
    words = Array.from(seg.segment(text), (s: any) => s.segment);
  } catch {
    words = null;
  }
  if (!words) {
    // フォールバック: 句読点・括弧閉じの後ろで切るだけの粗い分割
    words = text.split(/(?<=[、。！？」』）\]…])/);
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

/* 改行を外して繋ぐとき、両側が ASCII の語なら空白を挟む。
   和文は east_asian_line_breaks と同じく直結する */
const ASCII_WORD = /[A-Za-z0-9)\]\}"',.;:!?]/;
const needsSpace = (left: string, right: string): boolean =>
  left !== '' && right !== '' && ASCII_WORD.test(left) && ASCII_WORD.test(right);

interface NormalizedParagraph {
  /** 改行を外した1行のテキスト */
  plain: string;
  /** plain 内で、明示改行（\\ / 行末スペース2つ）が入っていた位置 */
  breakOffsets: Set<number>;
}

/**
 * 段落を1行に正規化する唯一の歩行器。
 * stripHardBreaks と breakJoints はこれを共有する（オフセットのずれ防止）。
 */
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
      const next = raw[i] ?? '';
      if (needsSpace(plain.slice(-1), next)) plain += ' ';
      continue;
    }
    if ((m = rest.match(/^ {2,}\r?\n[ \t]*/))) {
      breakOffsets.add(plain.length);
      i += m[0].length;
      const next = raw[i] ?? '';
      if (needsSpace(plain.slice(-1), next)) plain += ' ';
      continue;
    }
    if ((m = rest.match(/^\r?\n[ \t]*/))) {
      // 軟改行。英文は空白で、和文は直結で繋ぐ
      i += m[0].length;
      const next = raw[i] ?? '';
      if (needsSpace(plain.slice(-1), next)) plain += ' ';
      continue;
    }
    plain += raw[i];
    i++;
  }
  return { plain, breakOffsets };
}

/** 段落から改行（明示・軟とも）を外して1行に戻す */
export function stripHardBreaks(paragraph: string): string {
  return normalizeParagraph(paragraph).plain;
}

/** 指定した継ぎ目（チャンク番号の後ろ）に \ 改行を入れて組み立てる */
export function applyBreaks(chunks: string[], breakAfter: Set<number>): string {
  let out = '';
  chunks.forEach((c, i) => {
    out += c;
    if (breakAfter.has(i) && i < chunks.length - 1) out += '\\\n';
  });
  return out;
}

/**
 * 原稿の段落に既に入っている明示改行を、チャンクの継ぎ目番号に写す。
 * 継ぎ目に一致しない位置の改行は表現できないので無視される。
 */
export function breakJoints(raw: string, chunks: string[]): Set<number> {
  const { breakOffsets } = normalizeParagraph(raw);
  const joints = new Set<number>();
  let acc = 0;
  chunks.forEach((c, i) => {
    acc += c.length;
    if (breakOffsets.has(acc)) joints.add(i);
  });
  return joints;
}

export interface ParagraphLoc {
  /** body 内の開始・終了オフセット */
  start: number;
  end: number;
  /** 原稿そのままの段落テキスト（複数行を含み得る） */
  raw: string;
}

/**
 * スライド区間の中から、プレビューの段落に対応する原稿の段落ブロックを探す。
 * needle はその段落の代表テキスト（いちばん長いラン）。
 * 空行区切りのブロック単位で照合し、見つからなければ null。
 */
export function findParagraph(
  body: string,
  contentIndex: number,
  needle: string,
): ParagraphLoc | null {
  const trimmedNeedle = needle.trim();
  if (trimmedNeedle === '') return null;
  const seg = slideSegments(body)[contentIndex - 1];
  if (!seg) return null;

  const segment = body.slice(seg.start, seg.end);
  const blockRe = /[^\n][\s\S]*?(?=\n\s*\n|$)/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(segment)) !== null) {
    const raw = m[0];
    // 改行・強調記号を除いた素のテキストで照合する
    const plain = stripHardBreaks(raw).replace(/[*_`]/g, '');
    if (plain.includes(trimmedNeedle)) {
      return { start: seg.start + m.index, end: seg.start + m.index + raw.length, raw };
    }
  }
  return null;
}

