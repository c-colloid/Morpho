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
}

/** スライド上の図形ひとつ。pptx の <p:sp> にあたる */
export interface SlideShape {
  /**
   * プレースホルダの種別（title / ctrTitle / subTitle / body など）。
   * プレースホルダでない図形は null。
   */
  placeholder: string | null;
  paragraphs: Paragraph[];
}

export interface SlideOutline {
  /** 1 始まり */
  index: number;
  /** 出力側で実際に割り当たったレイアウト名。取れなければ null */
  layout: string | null;
  shapes: SlideShape[];
}

export interface ConvertResult {
  slideCount: number;
  slides: SlideOutline[];
  diagnostics: Diagnostic[];
  /** 変換だけにかかった時間 */
  ms: number;
  /** 出力ファイルのバイト数 */
  bytes: number;
}

export interface ConvertOptions {
  /** HTML コメントを Lua フィルタで落とす（CLAUDE.md 落とし穴 7） */
  stripHtmlComments?: boolean;
  /** front matter を自前パースして渡す（CLAUDE.md 落とし穴 1） */
  metadata?: Record<string, string>;
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
  convert(markdown: string, options?: ConvertOptions): Promise<ConvertResult>;
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
