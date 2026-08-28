/**
 * 装飾プリセット（補助機能）。
 *
 * 「座標を手で打たなくても様になる」初期配置を、スライド寸法の割合から
 * EMU で組み立てる。色はテーマ参照（accent1〜6）で持ち、テンプレートを
 * 差し替えても追従する（notes/roadmap-pptx.md の三層分離）。
 */
import type { DecorationColor, SlideDecoration } from '../converter/types';

export type PresetKind =
  | 'bandTop' | 'bandBottom' | 'accentLine' | 'card' | 'badge'
  | 'triangle' | 'diamond' | 'hexagon' | 'star5' | 'rightArrow';

export const PRESETS: Array<{ kind: PresetKind; label: string; hint: string }> = [
  { kind: 'bandTop', label: '上の帯', hint: 'スライド上端の色帯' },
  { kind: 'bandBottom', label: '下の帯', hint: 'スライド下端の色帯' },
  { kind: 'accentLine', label: 'アクセント線', hint: 'タイトル下の短い線' },
  { kind: 'card', label: '角丸カード', hint: '本文の背面に薄い角丸面' },
  { kind: 'badge', label: '番号バッジ', hint: '番号入りの丸バッジ' },
];

/** 基本図形（中央に置く。用途を決めないプリセット） */
export const SHAPE_PRESETS: Array<{ kind: PresetKind; label: string }> = [
  { kind: 'triangle', label: '▲' },
  { kind: 'diamond', label: '◆' },
  { kind: 'hexagon', label: '⬡' },
  { kind: 'star5', label: '★' },
  { kind: 'rightArrow', label: '➜' },
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
    case 'badge': {
      /* 真円にするため寸法は高さ基準の EMU で揃える（% だと縦横比で歪む） */
      const size = pct(slideH, 12);
      return {
        id, contentIndex, shape: 'ellipse',
        x: pct(slideW, 5), y: pct(slideH, 7), w: size, h: size,
        color: { scheme: 'accent2' }, opacity: 100,
        text: '1',
      };
    }
    case 'rightArrow':
      return {
        id, contentIndex, shape: 'rightArrow',
        x: pct(slideW, 38), y: pct(slideH, 44), w: pct(slideW, 24), h: pct(slideH, 12),
        color: { scheme: 'accent1' }, opacity: 100,
      };
    case 'triangle':
    case 'diamond':
    case 'hexagon':
    case 'star5': {
      /* 基本図形は縦横同寸（EMU）で中央に置く */
      const size = pct(slideH, 20);
      return {
        id, contentIndex, shape: kind,
        x: Math.round((slideW - size) / 2), y: Math.round((slideH - size) / 2),
        w: size, h: size,
        color: { scheme: 'accent1' }, opacity: 100,
      };
    }
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

/**
 * 同じスライド内での重なり順の入れ替え（配列順 = 背面から前面）。
 * 端では何もしない。他のスライドの装飾の位置は動かさない。
 */
export function moveDecoration(
  decorations: SlideDecoration[],
  id: string,
  dir: 'back' | 'front',
): SlideDecoration[] {
  const target = decorations.find((d) => d.id === id);
  if (!target) return decorations;
  const siblings = decorations.filter((d) => d.contentIndex === target.contentIndex);
  const at = siblings.findIndex((d) => d.id === id);
  const to = dir === 'back' ? at - 1 : at + 1;
  if (to < 0 || to >= siblings.length) return decorations;
  const reordered = [...siblings];
  [reordered[at], reordered[to]] = [reordered[to], reordered[at]];
  let i = 0;
  return decorations.map((d) => (d.contentIndex === target.contentIndex ? reordered[i++] : d));
}

/** 直接操作のスナップ幅 = スライド寸法の 0.5%（ステッパーの 1% の半分） */
const SNAP_DIV = 200;

const snap = (v: number, unit: number) => Math.round(Math.round(v / unit) * unit);

/**
 * ドラッグ移動の確定値。0.5% グリッドへスナップし、スライド内にクランプする。
 */
export function moveTo(
  d: SlideDecoration,
  x: number,
  y: number,
  slideW: number,
  slideH: number,
): SlideDecoration {
  const sx = snap(x, slideW / SNAP_DIV);
  const sy = snap(y, slideH / SNAP_DIV);
  return {
    ...d,
    x: Math.max(0, Math.min(slideW - d.w, sx)),
    y: Math.max(0, Math.min(slideH - d.h, sy)),
  };
}

/**
 * リサイズの確定値（右下ハンドル想定・位置は固定）。
 * 0.5% グリッドへスナップし、最小 1%・スライド内にクランプする。
 */
export function resizeTo(
  d: SlideDecoration,
  w: number,
  h: number,
  slideW: number,
  slideH: number,
): SlideDecoration {
  const sw = snap(w, slideW / SNAP_DIV);
  const sh = snap(h, slideH / SNAP_DIV);
  return {
    ...d,
    w: Math.max(Math.round(slideW / 100), Math.min(slideW - d.x, sw)),
    h: Math.max(Math.round(slideH / 100), Math.min(slideH - d.y, sh)),
  };
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
