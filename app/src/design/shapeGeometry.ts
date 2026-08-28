/**
 * 多角形図形の外形（プレビュー描画用）。
 *
 * OOXML の presetGeometry の既定 adj 値を近似した頂点列を返す。
 * 座標系は図形ローカル（0,0〜w,h）。単位は呼び出し側の自由
 * （EMU を渡せば EMU、px を渡せば px で返る）。
 * PowerPoint の正確なジオメトリとの一致は保証しない（実寸プレビューの
 * 「行の折り返しは近似」と同じ扱いの、意図的な近似）。
 */
import type { DecorationShape } from '../converter/types';

/** 多角形でない図形（rect / roundRect / ellipse）は null */
export function shapePoints(
  shape: DecorationShape,
  w: number,
  h: number,
): Array<[number, number]> | null {
  switch (shape) {
    case 'triangle':
      return [[w / 2, 0], [w, h], [0, h]];
    case 'diamond':
      return [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]];
    case 'hexagon': {
      /* 既定 adj=25000 → 水平の切り込み = 短辺の 25% */
      const inset = Math.min(w, h) * 0.25;
      return [
        [inset, 0], [w - inset, 0], [w, h / 2],
        [w - inset, h], [inset, h], [0, h / 2],
      ];
    }
    case 'star5': {
      /* 既定 adj=19098 → 内径 = 外径の約 38.2% */
      const cx = w / 2;
      const cy = h / 2;
      const inner = 0.38196;
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < 10; i++) {
        const angle = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 === 0 ? 1 : inner;
        pts.push([cx + cx * r * Math.cos(angle), cy + cy * r * Math.sin(angle)]);
      }
      return pts;
    }
    case 'rightArrow': {
      /* 既定 adj1=50000（軸の太さ = 高さの 50%）・adj2=50000（頭の長さ = 短辺の 50%） */
      const head = Math.min(w, h) * 0.5;
      const top = h * 0.25;
      const bottom = h * 0.75;
      return [
        [0, top], [w - head, top], [w - head, 0],
        [w, h / 2],
        [w - head, h], [w - head, bottom], [0, bottom],
      ];
    }
    default:
      return null;
  }
}
