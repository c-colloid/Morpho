/**
 * 変換器の境界。
 *
 * CLAUDE.md のアーキテクチャでいう「ここが差し替え可能な境界」。
 * pandoc.wasm を MIT の自前 writer に差し替えても、
 * この型より上（エディタ・プレビュー）は変更不要でなければならない。
 * 実装を足すときは pandoc 固有の語彙をこのファイルに漏らさないこと。
 */

/** CLAUDE.md「警告の重要度分類」に対応する */
export type DiagnosticKind = 'critical' | 'design' | 'info';

export interface Diagnostic {
  kind: DiagnosticKind;
  /** 人間向けの短い見出し */
  label: string;
  /** どうすれば直るか */
  hint: string;
  /** 変換器が吐いた原文（1件ぶん） */
  text: string;
  /** 同じ規則にまとまった件数 */
  count: number;
}

/** 書式のかかった連続した文字列。pptx の <a:r> にあたる */
export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** 等幅書体。コードスパン / コードブロックの判定に使う */
  mono?: boolean;
}

/**
 * 行頭記号の種別。
 * pandoc は箇条書きでない段落に <a:buNone/> を明示し、
 * 箇条書きは何も書かずレイアウトの既定に任せる。
 * 番号付きは <a:buAutoNum/> を書く。
 */
export type BulletKind = 'none' | 'bullet' | 'number';

/** 段落。pptx の <a:p> にあたる */
export interface Paragraph {
  runs: TextRun[];
  /** 箇条書きの階層。0 が最上位 */
  level: number;
  bullet: BulletKind;
  /**
   * 段落自身の字下げ上書き（EMU）。null はマスターの lvl 既定を継承。
   * pandoc は普通の段落に marL="0" indent="0" を明示し、箇条書きは継承に任せる
   */
  marL?: number | null;
  indent?: number | null;
}

/** スライド上の図形ひとつ。pptx の <p:sp> にあたる */
/** EMU（914400 = 1 inch / 12700 = 1 pt） */
export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SlideShape {
  /**
   * プレースホルダの種別（title / ctrTitle / subTitle / body など）。
   * プレースホルダでない図形は null。
   */
  placeholder: string | null;
  /** <p:ph idx=""> の値。継承照合に使う */
  phIdx: number | null;
  /** スライド上の位置。自前 → レイアウト → マスター の順で解決済み。不明なら null */
  frame: Frame | null;
  paragraphs: Paragraph[];
}

export interface SlideOutline {
  /** 1 始まり */
  index: number;
  /** 出力側で実際に割り当たったレイアウト名。取れなければ null */
  layout: string | null;
  shapes: SlideShape[];
  /** 発表者ノート（::: notes ::: 由来）。無ければ空配列 */
  notes: Paragraph[];
}

/** テンプレート由来のデッキ情報。字サイズは 1/100 pt（3300 = 33pt） */
export interface DeckInfo {
  /** スライド寸法（EMU） */
  w: number;
  h: number;
  /** theme1.xml の配色（#RRGGBB）。dk1 / lt1 / accent1..6 など */
  colors: Record<string, string>;
  titleSz: number;
  /** 箇条書き階層 lvl1..lvl5 の字サイズ */
  bodySz: number[];
  /** 箇条書き階層ごとの左余白（EMU）。テキストの左端 */
  bodyMarL: number[];
  /** 同・先頭行のぶら下げ（EMU、通常は負）。行頭記号の位置 = marL + indent */
  bodyIndent: number[];
}

/**
 * プレビューの形式。スライド（pptx を解析したシーン）と Web（完成 HTML）。
 * 文書（docx を解析したブロック列）はプレビュー実装時に足す。
 * ExportFormat（書き出すコンテナ形式）とは別レイヤーの概念。
 */
export type PreviewFormat = 'slides' | 'web';

interface ConvertResultBase {
  diagnostics: Diagnostic[];
  /** 変換だけにかかった時間 */
  ms: number;
  /** 出力ファイルのバイト数 */
  bytes: number;
}

/** スライドプレビュー: 実際の pptx を解析したシーン */
export interface SlideResult extends ConvertResultBase {
  kind: 'slides';
  slideCount: number;
  slides: SlideOutline[];
  deck: DeckInfo;
}

/** Web プレビュー: 変換器が返す完成 HTML。WebView 等でそのまま描画する */
export interface WebResult extends ConvertResultBase {
  kind: 'web';
  html: string;
}

export type ConvertResult = SlideResult | WebResult;

/**
 * スライド上の装飾ひとつ（notes/roadmap-pptx.md「飾る力」）。
 * データは EMU 座標とテーマ参照色で持ち、変換器を自前 writer に
 * 差し替えても生き残る形にする。pandoc 固有の語彙は含めない。
 */
export type DecorationShape = 'rect' | 'roundRect' | 'ellipse';

export interface DecorationColor {
  /** テーマ配色の参照（accent1〜accent6）。テンプレート差し替えに追従する */
  scheme?: 'accent1' | 'accent2' | 'accent3' | 'accent4' | 'accent5' | 'accent6';
  /** 直接指定（#RRGGBB）。scheme が無いときに使う */
  hex?: string;
}

export interface SlideDecoration {
  /** 文書内で一意。グループ化（将来）のメンバー参照にも使う */
  id: string;
  /** コンテンツスライド番号（1 始まり・タイトルスライドを含まない） */
  contentIndex: number;
  shape: DecorationShape;
  /** スライド座標系の EMU（914400 = 1 inch） */
  x: number;
  y: number;
  w: number;
  h: number;
  color: DecorationColor;
  /** 0〜100（%） */
  opacity: number;
  /**
   * 図形内に表示する短いテキスト（番号バッジ等）。白・太字・中央揃えで描く。
   * 未指定なら無地の図形
   */
  text?: string;
}

export interface ConvertOptions {
  /** HTML コメントを Lua フィルタで落とす（CLAUDE.md 落とし穴 7） */
  stripHtmlComments?: boolean;
  /** front matter を自前パースして渡す（CLAUDE.md 落とし穴 1） */
  metadata?: Record<string, string>;
  /**
   * 書き出しに適用する装飾。pptx のみ（OOXML 後処理で spTree に注入）。
   * 他形式では無視される
   */
  decorations?: SlideDecoration[];
}

/** 変換器が生成できる出力形式。md はエディタの内容そのものなので含めない */
export type ExportFormat = 'pptx' | 'docx';

export interface ExportResult {
  /** 出力ファイルの base64 */
  base64: string;
  bytes: number;
  ms: number;
  diagnostics: Diagnostic[];
}

export interface Converter {
  readonly name: string;
  /** format 省略時は 'slides'。既存の呼び出しはそのまま SlideResult に絞り込まれる */
  convert(
    markdown: string,
    options?: ConvertOptions & { format?: 'slides' },
  ): Promise<SlideResult>;
  convert(
    markdown: string,
    options: ConvertOptions & { format: 'web' },
  ): Promise<WebResult>;
  convert(
    markdown: string,
    options: ConvertOptions & { format: PreviewFormat },
  ): Promise<ConvertResult>;
  exportFile(
    markdown: string,
    format: ExportFormat,
    options?: ConvertOptions,
  ): Promise<ExportResult>;
}

export type BootStatus =
  | { phase: 'idle' }
  | { phase: 'loading'; loadedBytes: number; totalBytes: number }
  | { phase: 'instantiating' }
  | { phase: 'ready'; bootMs: number; heapMB: number }
  | { phase: 'error'; message: string };
