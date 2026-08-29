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
  /** ラン単位の文字色（#RRGGBB）。pandoc の構文ハイライトが使う */
  color?: string;
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
  /** 段落の水平揃え上書き（l / ctr / r / just）。null はスタイル既定を継承 */
  algn?: string | null;
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
  /**
   * 垂直アンカー（t / ctr / b）。自前 → レイアウト → マスター の順で解決済み。
   * null は既定（上揃え）。pandoc 既定マスターのタイトルは ctr（実測）
   */
  anchor?: string | null;
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
  /**
   * 表紙タイトル（ctrTitle）のサイズ上書き（1/100pt）。
   * 文書の文字サイズ設定（adjustDeck）だけが入れる。未指定は titleSz
   */
  ctrTitleSz?: number;
  /** 箇条書き階層 lvl1..lvl5 の字サイズ */
  bodySz: number[];
  /** 箇条書き階層ごとの左余白（EMU）。テキストの左端 */
  bodyMarL: number[];
  /** 同・先頭行のぶら下げ（EMU、通常は負）。行頭記号の位置 = marL + indent */
  bodyIndent: number[];
  /** タイトルの水平揃え（titleStyle lvl1 の algn）。pandoc 既定は ctr */
  titleAlgn?: string | null;
  /** 箇条書き階層ごとの水平揃え。null は左 */
  bodyAlgn?: Array<string | null>;
  /** 段落前間隔（spcPct の 1/1000 %。pandoc 既定は 20000 = 行高の 20%） */
  bodySpcBef?: number[];
  /** 段落前間隔の絶対値指定（spcPts、1/100 pt）。reference-doc で使われ得る */
  bodySpcBefPts?: number[];
  /** 階層ごとの行頭記号（buChar）。pandoc 既定は • – • – … の交互。null は既定 */
  bodyBuChar?: Array<string | null>;
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
/** OOXML の presetGeometry 名と一致させる（自前 writer でもそのまま使える語彙） */
export type DecorationShape =
  | 'rect'
  | 'roundRect'
  | 'ellipse'
  | 'triangle'
  | 'diamond'
  | 'hexagon'
  | 'star5'
  | 'rightArrow';

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
  /** 枠線。未指定なら枠なし */
  line?: { color: DecorationColor; widthPt: number };
  /** 塗りなし（枠線だけの図形用）。既定 false */
  noFill?: boolean;
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
  /**
   * 装飾のグループ。メンバーは pptx 書き出しで p:grpSp に包まれ、
   * PowerPoint 上でもまとめて選択・移動できる
   */
  groups?: Array<{ id: string; contentIndex: number; memberIds: string[] }>;
  /**
   * 文字サイズの上書き（1/100pt）。pptx のみ。
   * titleSz / bodySz はマスターの titleStyle / bodyStyle を書き換え、
   * coverTitleSz は表紙スライドの ctrTitle に lstStyle を注入する
   */
  textSizes?: { titleSz?: number; coverTitleSz?: number; bodySz?: number[] };
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
