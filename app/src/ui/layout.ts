/**
 * 画面の形からレイアウトの様式を決める（純関数）。
 *
 * 0.17 までは「幅 700pt 以上なら二画面、未満なら縦積み」の 1 軸だけで、
 * iPad を物理キーボードで使う前提の設計だった。0.18 で次の 3 つを区別する。
 *
 *   split     原稿とプレビューを左右に並べる（iPad の縦横・幅の広い Split View）
 *   single    原稿かプレビューのどちらか一方を全面に出し、ヘッダのセグメントで切り替える
 *             （iPhone・Slide Over・幅の狭い Split View）
 *
 * single のときは向きで既定の面が変わる:
 *   縦持ち → 原稿（Markdown を打つ）
 *   横持ち → プレビュー（スライドを確かめる）
 * 「縦で書いて、横に倒して確認する」を回転だけでできるようにするため。
 *
 * 判定は寸法だけで行う（Platform.isPad を見ない）。Expo Go が iPad で iPhone 幅に
 * なる件や Split View は寸法でしか分からないので、機種で分けると嘘をつく。
 */

export type LayoutMode = 'split' | 'single';
export type Orientation = 'portrait' | 'landscape';
export type Pane = 'editor' | 'preview';

export interface Layout {
  mode: LayoutMode;
  orientation: Orientation;
  /** single のときの既定の面 */
  defaultPane: Pane;
  /** 余白・ヘッダを詰める（iPhone 級の幅） */
  compact: boolean;
}

/** 二画面にする最小の幅。iPad の縦向き（768〜834pt）が入り、iPhone の横向きは高さで落ちる */
export const SPLIT_MIN_WIDTH = 700;
/** 二画面にする最小の高さ。iPhone の横向き（375〜440pt）を single に落とす */
export const SPLIT_MIN_HEIGHT = 500;
/** ヘッダや余白を詰める幅。iPhone の縦向き（375〜440pt）と Slide Over（320pt） */
export const COMPACT_MAX_WIDTH = 500;

export function layoutFor(width: number, height: number): Layout {
  const orientation: Orientation = width > height ? 'landscape' : 'portrait';
  if (width >= SPLIT_MIN_WIDTH && height >= SPLIT_MIN_HEIGHT) {
    return { mode: 'split', orientation, defaultPane: 'editor', compact: false };
  }
  return {
    mode: 'single',
    orientation,
    defaultPane: orientation === 'landscape' ? 'preview' : 'editor',
    compact: width < COMPACT_MAX_WIDTH,
  };
}

/**
 * ソフトキーボードが画面の下からどれだけ重なっているか（pt）。
 *
 * iOS の keyboardWillChangeFrame は `endCoordinates` に画面座標の矩形を返す。
 * 下端からの重なりは `window.height − screenY`。閉じるときは screenY が画面の
 * 高さ以上になるので 0 に落ちる。
 *
 * iPad の**フローティングキーボード**（小さく浮かせた状態）は幅が画面より
 * 狭い矩形で来る。画面の下に貼り付いていないので重なりは 0 として扱う
 * （縦に詰めると、浮いているキーボードの下に空白が空くだけになる）。
 */
export function keyboardOverlap(
  frame: { screenY: number; height: number; width: number },
  window: { width: number; height: number },
): number {
  if (frame.width > 0 && frame.width < window.width - 1) return 0;
  const overlap = window.height - frame.screenY;
  if (!Number.isFinite(overlap)) return 0;
  return Math.max(0, Math.min(frame.height, overlap));
}

/**
 * 横持ちの single でカードの幅を決める。縦に並ぶカードは 1 枚がひと画面に
 * 収まる幅まで（スライドの縦横比から逆算）。それより広い幅は使わない。
 *  - paneW: プレビュー領域の幅（余白込み）
 *  - paneH: プレビュー領域の高さ
 *  - ratio: deck.h / deck.w
 *  - chrome: カードの枠・見出し行・上下余白ぶんの高さ
 */
export function cardWidthFor(
  paneW: number,
  paneH: number,
  ratio: number,
  opts: { horizontalPadding: number; chrome: number; fitHeight: boolean },
): number {
  const byWidth = Math.max(0, paneW - opts.horizontalPadding);
  if (!opts.fitHeight || paneH <= 0 || ratio <= 0) return byWidth;
  const byHeight = Math.max(0, (paneH - opts.chrome) / ratio);
  return Math.floor(Math.min(byWidth, byHeight));
}
