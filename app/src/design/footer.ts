/**
 * フッター（出典・注釈）の体裁。
 *
 * `notes/footer-design.md` の三層分離: **文言は原稿（front matter の `footer:`）、
 * 体裁だけがここ**。だから FooterStyle は文字列を持たない。
 *
 * 座標は EMU を持たず、比率とテンプレートの帯（DeckInfo.ftrBand）から
 * 変換のたびに解決する。テンプレートを差し替えると帯もそれに追従する。
 * 解決はこの 1 箇所だけで行い、プレビュー（SlideSurface）と
 * 書き出し（bridge の applyFooters）は同じ値を使う — textSizes.ts の
 * toExportSizes / adjustDeck が両者を一致させているのと同じ形。
 */
import type { ConvertOptions, DeckInfo, Frame, ThemeColor } from '../converter/types';

export interface FooterStyle {
  align: 'l' | 'ctr' | 'r';
  /** 字サイズ（pt） */
  sizePt: number;
  color: ThemeColor;
  /**
   * テンプレートが帯を持たないときに使う比率。
   * yPct/hPct はスライド高さ、marginPct は左右の余白（スライド幅）に対する %
   */
  band: { yPct: number; hPct: number; marginPct: number };
  /** 表紙（ctrTitle を持つスライド）にも出す */
  onCover: boolean;
}

/**
 * 既定値。
 * - 揃えは右（日本の抄読会の出典は右下か左下が普通。テンプレートの ftr 既定は
 *   中央だが、そこは踏襲しない）
 * - 9pt と tx1 の tint 75% は pandoc 既定マスターの ftr の実測値
 * - 帯の比率はテンプレートに ftr が無いときだけ使う（実測の 92.69% / 5.32%）
 */
export const DEFAULT_FOOTER_STYLE: FooterStyle = {
  align: 'r',
  sizePt: 9,
  color: { scheme: 'dk1', tint: 75000 },
  band: { yPct: 92.69, hPct: 5.32, marginPct: 5 },
  onCover: false,
};

export const MIN_FOOTER_PT = 6;
export const MAX_FOOTER_PT = 24;

export const clampFooterPt = (v: number): number =>
  Math.min(MAX_FOOTER_PT, Math.max(MIN_FOOTER_PT, Math.round(v)));

/** 保存された部分設定を既定へ重ねる。UI もこれを通した値だけを見る */
export function withFooterDefaults(s: Partial<FooterStyle> | undefined): FooterStyle {
  if (!s) return DEFAULT_FOOTER_STYLE;
  return {
    align: s.align ?? DEFAULT_FOOTER_STYLE.align,
    sizePt: typeof s.sizePt === 'number' && Number.isFinite(s.sizePt)
      ? clampFooterPt(s.sizePt)
      : DEFAULT_FOOTER_STYLE.sizePt,
    color: s.color ?? DEFAULT_FOOTER_STYLE.color,
    band: s.band ?? DEFAULT_FOOTER_STYLE.band,
    onCover: s.onCover ?? DEFAULT_FOOTER_STYLE.onCover,
  };
}

/**
 * 帯の EMU を解決する。
 *
 * テンプレートが ftr 帯を持っていればその y と高さを借り、**幅だけ全幅へ広げる** —
 * pandoc 既定の ftr は幅 228pt しかなく、出典 1 行が構造的に入らないため（実測）。
 * 持っていなければ比率の既定値へ落とす。
 */
export function resolveFooterBand(style: FooterStyle, deck: DeckInfo): Frame {
  const margin = Math.round((deck.w * style.band.marginPct) / 100);
  const w = Math.max(1, deck.w - margin * 2);
  const b = deck.ftrBand;
  if (b && b.h > 0) return { x: margin, y: b.y, w, h: b.h };
  return {
    x: margin,
    y: Math.round((deck.h * style.band.yPct) / 100),
    w,
    h: Math.max(1, Math.round((deck.h * style.band.hPct) / 100)),
  };
}

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

/**
 * 表示用の実色。テーマ参照はデッキの配色で解決し、tint は白へ寄せる。
 *
 * OOXML の `a:tint` は「元の色を val% 残して地色へ寄せる」で、書き出し側は
 * `<a:tint>` をそのまま XML に書く。ここはその見た目の近似。
 */
export function footerColorHex(color: ThemeColor, themeColors: Record<string, string>): string {
  const base = color.scheme ? themeColors[color.scheme] : color.hex;
  const m = /^#([0-9A-Fa-f]{6})$/.exec(base ?? '');
  if (!m) return '#7F7F7F';
  if (color.tint == null || color.tint >= 100000) return '#' + m[1].toUpperCase();
  const k = Math.max(0, color.tint) / 100000;
  const n = parseInt(m[1], 16);
  const mix = (c: number) => c * k + 255 * (1 - k);
  return (
    '#' +
    (hex2(mix((n >> 16) & 255)) + hex2(mix((n >> 8) & 255)) + hex2(mix(n & 255))).toUpperCase()
  );
}

/**
 * 文言の浄化。XML 1.0 で書けない制御文字を空白へ置換する（CLAUDE.md 落とし穴 9）。
 * designFile.ts の sanitizeDecorText は 20 字で切るので出典には使えない。
 * 置換は 1 文字 → 1 文字にして長さを保つ（原稿の書き戻しに使うため）。
 */
// eslint-disable-next-line no-control-regex
const XML_INVALID_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

export const MAX_FOOTER_TEXT = 200;

export function sanitizeFooterText(text: string): string {
  return text.replace(XML_INVALID_RE, ' ').replace(/[\r\n]/g, ' ').slice(0, MAX_FOOTER_TEXT);
}

/**
 * 書き出し・プレビュー共通の解決結果。文言が空なら undefined（何も出さない）。
 * プレビューは band / sizePt / align を、書き出しは同じ値を OOXML へ書く。
 */
export function toExportFooter(
  text: string | undefined,
  style: Partial<FooterStyle> | undefined,
  deck: DeckInfo | null | undefined,
): ConvertOptions['footer'] | undefined {
  const t = sanitizeFooterText(text ?? '').trim();
  if (!t || !deck) return undefined;
  const st = withFooterDefaults(style);
  const band = resolveFooterBand(st, deck);
  return {
    text: t,
    x: band.x,
    y: band.y,
    w: band.w,
    h: band.h,
    sz: clampFooterPt(st.sizePt) * 100,
    algn: st.align,
    color: st.color,
    onCover: st.onCover,
  };
}

/**
 * docx / Web 向けのデッキ全体フッター（0.16.4）。座標は無い —
 * docx はページフッター、Web は本文末尾に 1 回、と媒体ごとに置き場所が決まっている。
 * pptx（toExportFooter）と同じ文言・揃え・字サイズを使うので、形式を切り替えても
 * 出典の見え方が食い違わない。文言が空なら undefined（何も出さない）。
 * デッキ（スライドの解析結果）を要求しないので、スライドを一度も
 * プレビューしていなくても docx / Web に出典が載る。
 */
export function toDocFooter(
  text: string | undefined,
  style: Partial<FooterStyle> | undefined,
): ConvertOptions['docFooter'] | undefined {
  const t = sanitizeFooterText(text ?? '').trim();
  if (!t) return undefined;
  const st = withFooterDefaults(style);
  return { text: t, algn: st.align, sizePt: clampFooterPt(st.sizePt) };
}

const SCHEMES = ['dk1', 'lt1', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];

/** 保存ファイル（design-*.json / .morphodesign）からの読み込み。壊れた値は捨てる */
export function sanitizeFooterStyle(v: unknown): Partial<FooterStyle> | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const out: Partial<FooterStyle> = {};
  if (o.align === 'l' || o.align === 'ctr' || o.align === 'r') out.align = o.align;
  if (typeof o.sizePt === 'number' && Number.isFinite(o.sizePt)) out.sizePt = clampFooterPt(o.sizePt);
  if (typeof o.onCover === 'boolean') out.onCover = o.onCover;
  if (typeof o.color === 'object' && o.color !== null) {
    const c = o.color as Record<string, unknown>;
    const color: ThemeColor = {};
    if (SCHEMES.includes(c.scheme as string)) color.scheme = c.scheme as ThemeColor['scheme'];
    if (typeof c.hex === 'string' && /^#[0-9A-Fa-f]{6}$/.test(c.hex)) color.hex = c.hex;
    if (typeof c.tint === 'number' && Number.isFinite(c.tint)) {
      color.tint = Math.max(0, Math.min(100000, Math.round(c.tint)));
    }
    if (color.scheme || color.hex) out.color = color;
  }
  if (typeof o.band === 'object' && o.band !== null) {
    const b = o.band as Record<string, unknown>;
    const num = (x: unknown, lo: number, hi: number): number | null =>
      typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : null;
    const yPct = num(b.yPct, 0, 100);
    const hPct = num(b.hPct, 0.5, 50);
    const marginPct = num(b.marginPct, 0, 40);
    if (yPct !== null && hPct !== null && marginPct !== null) out.band = { yPct, hPct, marginPct };
  }
  return Object.keys(out).length ? out : null;
}
