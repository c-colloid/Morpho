/**
 * 文字サイズ設定（文書ごと・デザインデータの一部）。
 *
 * 長いタイトル（論文名・出典など）が枠からあふれる問題への手当て。
 * 表紙タイトル（ctrTitle）は OOXML 上マスターの titleStyle を継承するため、
 * 見出しと独立に調整できるよう3つのノブに分ける（原典確認済み）。
 * 値は pt。未指定はテンプレート既定のまま。
 */
import type { DeckInfo } from '../converter/types';

export interface TextSizes {
  /** 表紙タイトル（ctrTitle）。未指定なら見出しと同じ */
  coverTitlePt?: number;
  /** 表紙サブタイトル（subTitle。サブタイトル・著者・日付）。未指定なら本文と同じ */
  coverSubPt?: number;
  /** 見出し（各スライドのタイトル） */
  titlePt?: number;
  /** 本文（箇条書き lvl1）。下位階層は既定との比率で追従する */
  bodyPt?: number;
}

export const MIN_PT = 8;
export const MAX_PT = 80;

export const clampPt = (v: number): number =>
  Math.min(MAX_PT, Math.max(MIN_PT, Math.round(v)));

const finite = (v: number | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/**
 * 書き出し用: OOXML 後処理（bridge の applyTextSizes）へ渡す 1/100pt 値。
 * 未設定・非有限のノブは undefined のまま（出力に触れない）。
 * 本文は lvl1 の比率で全階層を揃えて縮尺する（階層のコントラストを保つ）。
 * プレビュー（adjustDeck）もここから導くので、両者は常に一致する。
 */
export function toExportSizes(
  t: TextSizes | undefined,
  bodyDefaults: number[],
): { titleSz?: number; coverTitleSz?: number; coverSubSz?: number; bodySz?: number[] } | undefined {
  if (!t) return undefined;
  const out: {
    titleSz?: number;
    coverTitleSz?: number;
    coverSubSz?: number;
    bodySz?: number[];
  } = {};
  if (finite(t.titlePt)) out.titleSz = clampPt(t.titlePt) * 100;
  if (finite(t.coverTitlePt)) out.coverTitleSz = clampPt(t.coverTitlePt) * 100;
  if (finite(t.coverSubPt)) out.coverSubSz = clampPt(t.coverSubPt) * 100;
  if (finite(t.bodyPt) && bodyDefaults.length) {
    const ratio = (clampPt(t.bodyPt) * 100) / bodyDefaults[0];
    out.bodySz = bodyDefaults.map((s) => Math.max(MIN_PT * 100, Math.round(s * ratio)));
  }
  return Object.keys(out).length ? out : undefined;
}

/** プレビュー用: デッキの既定サイズへ設定を重ねる（toExportSizes と同値） */
export function adjustDeck(deck: DeckInfo, t?: TextSizes): DeckInfo {
  const sizes = toExportSizes(t, deck.bodySz);
  if (!sizes) return deck;
  const out: DeckInfo = { ...deck };
  if (sizes.titleSz != null) out.titleSz = sizes.titleSz;
  if (sizes.coverTitleSz != null) out.ctrTitleSz = sizes.coverTitleSz;
  if (sizes.coverSubSz != null) out.subTitleSz = sizes.coverSubSz;
  if (sizes.bodySz) out.bodySz = sizes.bodySz;
  return out;
}
