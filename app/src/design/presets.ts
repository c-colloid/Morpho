/**
 * 装飾プリセット（補助機能）。
 *
 * 「座標を手で打たなくても様になる」初期配置を、スライド寸法の割合から
 * EMU で組み立てる。色はテーマ参照（accent1〜6）で持ち、テンプレートを
 * 差し替えても追従する（notes/roadmap-pptx.md の三層分離）。
 */
import type { DecorationColor, SlideDecoration } from '../converter/types';

export type PresetKind = 'bandTop' | 'bandBottom' | 'accentLine' | 'card';

export const PRESETS: Array<{ kind: PresetKind; label: string; hint: string }> = [
  { kind: 'bandTop', label: '上の帯', hint: 'スライド上端の色帯' },
  { kind: 'bandBottom', label: '下の帯', hint: 'スライド下端の色帯' },
  { kind: 'accentLine', label: 'アクセント線', hint: 'タイトル下の短い線' },
  { kind: 'card', label: '角丸カード', hint: '本文の背面に薄い角丸面' },
];

export function makePreset(
  kind: PresetKind,
  contentIndex: number,
  id: string,
  slideW: number,
  slideH: number,
): SlideDecoration {
  const pct = (w: number, p: number) => Math.round((w * p) / 100);
  switch (kind) {
    case 'bandTop':
      return {
        id, contentIndex, shape: 'rect',
        x: 0, y: 0, w: slideW, h: pct(slideH, 6),
        color: { scheme: 'accent1' }, opacity: 100,
      };
    case 'bandBottom':
      return {
        id, contentIndex, shape: 'rect',
        x: 0, y: pct(slideH, 94), w: slideW, h: pct(slideH, 6),
        color: { scheme: 'accent1' }, opacity: 100,
      };
    case 'accentLine':
      return {
        id, contentIndex, shape: 'rect',
        x: pct(slideW, 5), y: pct(slideH, 17), w: pct(slideW, 30), h: pct(slideH, 1),
        color: { scheme: 'accent2' }, opacity: 100,
      };
    case 'card':
      return {
        id, contentIndex, shape: 'roundRect',
        x: pct(slideW, 4), y: pct(slideH, 22), w: pct(slideW, 92), h: pct(slideH, 72),
        color: { scheme: 'accent1' }, opacity: 12,
      };
  }
}

/** 表示用の実色。テーマ参照はデッキの配色で解決し、無ければ灰色 */
export function decorationColorHex(
  color: DecorationColor,
  themeColors: Record<string, string>,
): string {
  if (color.scheme) return themeColors[color.scheme] ?? '#888888';
  return color.hex ?? '#888888';
}

/** 位置・サイズの微調整。1ステップ = スライド寸法の 1%。負のサイズは作らない */
export function nudge(
  d: SlideDecoration,
  field: 'x' | 'y' | 'w' | 'h',
  steps: number,
  slideW: number,
  slideH: number,
): SlideDecoration {
  const unit = field === 'x' || field === 'w' ? slideW / 100 : slideH / 100;
  const next = { ...d, [field]: Math.round(d[field] + unit * steps) };
  if (field === 'w' || field === 'h') next[field] = Math.max(Math.round(unit), next[field]);
  return next;
}
