import type { ThemeColor } from '../converter/types.ts';
import { footerColorHex } from '../design/footer.ts';

/**
 * テーマ層（三層分離の第2層。notes/roadmap-pptx.md / notes/theme-layer.md）。
 *
 * 内容（原稿）と一回性のデザインデータ（第3層）の間に置く「見た目の定義」。
 * 文書間で再利用でき、将来は .morphotheme として共有する（v0.22）。
 *
 * 決まりごと（notes/columns-and-images.md「テーマの不変条件」）:
 *   - テーマが触ってよいのは寸法・色・レイアウト選択まで。ブロックの順序には触らない
 *   - pandoc 固有の制約（2 列上限・layout / slide の経路）はテーマに書かない。
 *     コンパイラ（compileTheme とブリッジ）の実装詳細に閉じる
 *   - 組み込みテーマはテーマファイルのみ（reference-doc を同梱しない。MIT を保つ）
 */

export type ColumnRatio = [number, number];

export interface ThemeClass {
  /** テーマ配色の参照（テンプレートの配色に追従）か直接指定 */
  color?: ThemeColor;
  bold?: boolean;
}

export interface Theme {
  version: 1;
  id: string;
  name: string;
  description?: string;
  /** 段組みの列比（左:右）。pptx はレイアウト枠、html は flex に落ちる。docx は流す */
  columns: { ratio: ColumnRatio };
  /** 意味クラス。原稿には [語]{.accent} のようにクラス名だけを書く */
  classes: Record<string, ThemeClass>;
  /**
   * 席だけ（notes/theme-layer.md）。'vertical' は 3 形式とも後処理 / CSS で届くが、
   * プレビューの実寸描画に縦組みの実装が要るので v0.19 では読まない
   */
  writingMode?: 'horizontal' | 'vertical';
}

/**
 * 文書側の選択と上書き（第3層に置く。DesignData.theme）。
 * id は組み込みテーマ、columns は列比の上書き。両方省略 = 既定テーマ
 */
export interface ThemeChoice {
  id?: string;
  columns?: { ratio: ColumnRatio };
}

const CLASSES_COMMON: Record<string, ThemeClass> = {
  /** 強調。テンプレートの accent1 に追従する太字 */
  accent: { color: { scheme: 'accent1' }, bold: true },
  /** 控えめ（補足・注記）。本文色を地色へ 60% 寄せる */
  muted: { color: { scheme: 'dk1', tint: 60000 } },
  /** 注意（数値の悪化・警告） */
  warn: { color: { scheme: 'accent2' }, bold: true },
};

export const BUILTIN_THEMES: Theme[] = [
  {
    version: 1,
    id: 'plain',
    name: '標準',
    description: 'テンプレートの配色に従う。段組みは 1:1',
    columns: { ratio: [1, 1] },
    classes: CLASSES_COMMON,
  },
  {
    version: 1,
    id: 'focus',
    name: '左を広く',
    description: '段組みの左を主、右を従にする（2:1）。図を右に添える原稿向け',
    columns: { ratio: [2, 1] },
    classes: CLASSES_COMMON,
  },
];

/** 列比の選択肢（UI）。テーマの値を文書側で上書きするときに使う */
export const RATIO_PRESETS: Array<{ label: string; ratio: ColumnRatio }> = [
  { label: '1 : 1', ratio: [1, 1] },
  { label: '2 : 1', ratio: [2, 1] },
  { label: '1 : 2', ratio: [1, 2] },
  { label: '3 : 2', ratio: [3, 2] },
  { label: '2 : 3', ratio: [2, 3] },
];

export function sameRatio(a: ColumnRatio | undefined, b: ColumnRatio | undefined): boolean {
  if (!a || !b) return a === b;
  return a[0] === b[0] && a[1] === b[1];
}

/** 文書の選択を組み込みテーマに重ねる。未知の id は既定テーマ */
export function resolveTheme(choice: ThemeChoice | undefined): Theme {
  const base = BUILTIN_THEMES.find((th) => th.id === choice?.id) ?? BUILTIN_THEMES[0];
  if (!choice?.columns) return base;
  return { ...base, columns: { ratio: choice.columns.ratio } };
}

/**
 * pandoc 既定テンプレートの配色（実測: theme1.xml の clrScheme）。
 * まだ 1 度も変換していない（deck が無い）ときの解決先。テンプレートを持つ文書は
 * 最初の変換後に deck.colors で解決し直される
 */
export const PANDOC_DEFAULT_COLORS: Record<string, string> = {
  dk1: '#000000',
  lt1: '#FFFFFF',
  dk2: '#1F497D',
  lt2: '#EEECE1',
  accent1: '#4F81BD',
  accent2: '#C0504D',
  accent3: '#9BBB59',
  accent4: '#8064A2',
  accent5: '#4BACC6',
  accent6: '#F79646',
};

/** 変換器へ渡す、解決済みのテーマ（ConvertOptions.theme） */
export interface ThemeSpec {
  /** 1:1 のときは省く（無変更） */
  columnRatio?: ColumnRatio;
  classes: Array<{ name: string; hex: string; scheme?: string; bold: boolean }>;
}

/**
 * テーマを変換器の語彙へコンパイルする。色は hex に解決し（docx の w:color と
 * html の CSS はこれを使う）、配色参照は scheme として併記する（pptx の schemeClr と
 * docx の w:themeColor はこちら。テンプレートの配色に追従する）
 */
export function compileTheme(theme: Theme, deckColors: Record<string, string>): ThemeSpec {
  const colors = Object.keys(deckColors).length ? deckColors : PANDOC_DEFAULT_COLORS;
  const classes = Object.keys(theme.classes)
    .filter((name) => /^[A-Za-z][A-Za-z0-9]*$/.test(name))
    .map((name) => {
      const c = theme.classes[name];
      const color = c.color ?? { scheme: 'dk1' as const };
      const hex = footerColorHex(color, colors);
      /* tint 付きの参照は pptx の schemeClr では表現しない（run の tint は
         PowerPoint の描画と自前描画で差が出る）。解決済みの hex で出す */
      const scheme = color.scheme && (color.tint == null || color.tint >= 100000) ? color.scheme : undefined;
      return { name, hex, scheme, bold: !!c.bold };
    });
  const r = theme.columns.ratio;
  const columnRatio = r[0] > 0 && r[1] > 0 && r[0] !== r[1] ? ([r[0], r[1]] as ColumnRatio) : undefined;
  return { columnRatio, classes };
}

/** 保存データ・.morphodesign の検証。壊れた値は捨てる */
export function sanitizeThemeChoice(v: unknown): ThemeChoice | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const out: ThemeChoice = {};
  if (o.id !== undefined) {
    if (typeof o.id !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(o.id)) return null;
    out.id = o.id;
  }
  if (o.columns !== undefined) {
    const c = o.columns as { ratio?: unknown } | null;
    const r = c && typeof c === 'object' ? c.ratio : undefined;
    if (
      !Array.isArray(r) ||
      r.length !== 2 ||
      !r.every((x) => typeof x === 'number' && Number.isFinite(x) && x > 0 && x <= 99)
    ) {
      return null;
    }
    out.columns = { ratio: [r[0], r[1]] };
  }
  return Object.keys(out).length ? out : null;
}
