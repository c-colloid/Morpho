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

/**
 * 図形のテキスト矩形（PowerPoint が文字を配置する内接領域）。
 *
 * OOXML の presetShapeDefinitions.xml の <rect> を既定 adj で評価した値。
 * プレビューの文字はこの矩形の中心に置くことで、書き出した pptx と
 * 文字位置が一致する（三角形は下半分・星はやや下・矢印は軸の範囲、など
 * 外接矩形の中心と一致しない図形がある — 実測ではなく原典から導出）。
 */
export function textRect(
  shape: DecorationShape,
  w: number,
  h: number,
): { x: number; y: number; w: number; h: number } {
  const ss = Math.min(w, h);
  switch (shape) {
    case 'roundRect': {
      /* il = ss*adj/100000*(1-1/√2), adj=16667 → 0.048815*ss の四辺内側 */
      const i = 0.048815 * ss;
      return { x: i, y: i, w: w - i * 2, h: h - i * 2 };
    }
    case 'ellipse': {
      /* (1-1/√2)/2 = 0.146447 を各軸に */
      const ix = 0.146447 * w;
      const iy = 0.146447 * h;
      return { x: ix, y: iy, w: w - ix * 2, h: h - iy * 2 };
    }
    case 'triangle':
      /* rect=(x1,vc)-(x3,b)。adj=50000 → 下半分の中央 */
      return { x: w / 4, y: h / 2, w: w / 2, h: h / 2 };
    case 'diamond':
      return { x: w / 4, y: h / 4, w: w / 2, h: h / 2 };
    case 'hexagon': {
      /* q8 = 2 + 2*ss/w（既定 adj=25000 では q2≤0 の分岐に落ちる） */
      const q8 = 2 + (2 * ss) / w;
      const ix = (w * q8) / 24;
      const iy = (h * q8) / 24;
      return { x: ix, y: iy, w: w - ix * 2, h: h - iy * 2 };
    }
    case 'star5':
      /* hf=105146, vf=110557, adj=19098 から定数化（svc が中心より下） */
      return {
        x: 0.309017 * w,
        y: 0.381952 * h,
        w: (0.690983 - 0.309017) * w,
        h: (0.763948 - 0.381952) * h,
      };
    case 'rightArrow':
      /* rect=(l,y1)-(x2,y2)。x2 = w - ss/4（頭の途中まで） */
      return { x: 0, y: h / 4, w: w - ss / 4, h: h / 2 };
    default:
      return { x: 0, y: 0, w, h };
  }
}
