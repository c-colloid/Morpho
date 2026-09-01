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
  /** 打ち消し線（docx の w:strike。文書プレビューが使う） */
  strike?: boolean;
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

/**
 * プレースホルダ固有の階層別既定（OOXML の lstStyle 1 階層ぶん）。
 * レイアウトが持つ既定を段落へ流し込むための器で、値の無いプロパティは
 * DeckInfo（＝マスター由来の既定）へ落とす。sz は 1/100pt、marL / indent は EMU。
 */
export interface LevelStyle {
  sz?: number;
  marL?: number;
  indent?: number;
  algn?: string;
  /** 行頭記号を出さない（Paragraph.bullet と同じ語彙の部分集合） */
  bullet?: 'none';
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
  /**
   * この図形の継承元プレースホルダが持つ階層別既定（lvl1..lvl9 の疎配列）。
   * 添字は段落の level。穴と null は DeckInfo の既定へ落とす。
   * 何も持たないレイアウト（Title and Content 等）では null
   */
  lvlStyle?: Array<LevelStyle | null> | null;
  paragraphs: Paragraph[];
}

/** スライド上の画像（p:pic）。実配置は出力の xfrm。
 * name は取り込み時の元ファイル名（cNvPr descr に残る。実測）で、
 * プレビューはこれでアセット保存庫のファイルを直接描く — 画像バイナリを
 * シーンに載せない */
export interface SlideImage {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * スライド上の表。
 *
 * 出力に書かれているのは枠の矩形と列幅・行数だけで、罫線と塗りは
 * 組み込みの表スタイル参照になっている（pandoc 既定テンプレートでは
 * その実体がパッケージに無い。reference-doc の tableStyles.xml は
 * そのまま出力へ運ばれる。いずれも実測）。
 * v0.14 は「消えないこと」の保証だけを目的に、枠と行列数を持つ。
 * セルの中身は後の版で DocBlock.rows と同じ形で足す。
 */
export interface SlideTable {
  /** スライド座標系の EMU。継承ではなく出力に書かれた実座標（実測） */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 行数（ヘッダ行を含む） */
  rowCount: number;
  /**
   * 列幅（EMU、左→右）。長さが列数。
   * 合計は w と一致しないことがある（pandoc は列幅を 1pt 刻みに丸める。
   * 実測: 13 列で 139700 EMU 不足）。描画は枠内へクランプすること
   */
  colWidths: number[];
}

export interface SlideOutline {
  /** 1 始まり */
  index: number;
  /** 出力側で実際に割り当たったレイアウト名。取れなければ null */
  layout: string | null;
  shapes: SlideShape[];
  /** 画像（p:pic）。無ければ空配列 */
  images: SlideImage[];
  /** 表（p:graphicFrame の a:tbl）。無ければ空配列 */
  tables: SlideTable[];
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
  /**
   * 表紙サブタイトル（subTitle）のサイズ上書き（1/100pt）。
   * 未指定は本文と同じ（bodyStyle lvl1 を継承する。実測）
   */
  subTitleSz?: number;
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
  /**
   * テンプレートが「フッターを置く場所」として持っている帯（EMU）。
   * pandoc 既定テンプレートはマスターに 1 本持つ（y=92.69% / 高さ 5.32%・実測）。
   * 持たないテンプレートでは null になり、比率の既定値へ落とす
   */
  ftrBand?: Frame | null;
}

/**
 * プレビューの形式。スライド（pptx を解析したシーン）・Web（完成 HTML）・
 * 文書（docx を解析したブロック列。フロー表示 — ページ組はしない。
 * document.xml にページ境界情報が無いため、ページ組は嘘になる。実測）。
 * ExportFormat（書き出すコンテナ形式）とは別レイヤーの概念。
 */
export type PreviewFormat = 'slides' | 'web' | 'doc';

/**
 * 文書プレビューのブロック。実際の docx 出力（document.xml）を解析した結果。
 * ランの書式（太字・色・等幅）は styles.xml の文字スタイルを解決して
 * TextRun へ焼き込み済み — 描画側はスタイル表を持たない。
 */
export interface DocBlock {
  kind: 'heading' | 'para' | 'listItem' | 'code' | 'table' | 'hr' | 'image';
  /** heading: 1..9。listItem: 0 始まりの入れ子段 */
  level?: number;
  /**
   * para の段落スタイル。title/author/date は front matter 由来、
   * quote は引用（BlockText）、footnote は文末に並べる脚注本文、
   * footer はページフッター（word/footer1.xml。フロー表示にページは無いので末尾に 1 回）
   */
  style?: 'title' | 'author' | 'date' | 'body' | 'quote' | 'footnote' | 'footer';
  /** para: 段落の揃え（w:jc）。footer で使う */
  align?: 'l' | 'ctr' | 'r';
  /** heading / para / listItem の中身。行内改行は text 中の \n */
  runs?: TextRun[];
  /** listItem: 番号付きか（numbering.xml の numFmt で判定） */
  ordered?: boolean;
  /** listItem: 項目の続き段落（行頭記号を出さない。lvlText 空白の実測） */
  plain?: boolean;
  /** listItem: 開始番号が 1 以外のとき（startOverride の実測） */
  start?: number;
  /** image: 取り込み時の元ファイル名（cNvPr descr）と実寸（EMU） */
  name?: string;
  wEmu?: number;
  hEmu?: number;
  /** code: 1 行 = 1 要素（SourceCode 段落 1 つが 1 行。実測） */
  lines?: TextRun[][];
  /** table: 行 → セル → ラン。header は tblHeader の行 */
  rows?: Array<{ header: boolean; cells: TextRun[][] }>;
}

/** 文書プレビューが使う実測の字サイズ（pt）。styles.xml から解決する */
export interface DocStyleInfo {
  /** 本文の既定（docDefaults）。pandoc 既定テンプレートは 12pt */
  basePt: number;
  /** Heading1..9 の順。スタイルに sz が無い段は basePt */
  headingPt: number[];
  titlePt: number;
  authorPt: number;
}

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

/** 文書プレビュー: 実際の docx を解析したブロック列（フロー表示用） */
export interface DocResult extends ConvertResultBase {
  kind: 'doc';
  blocks: DocBlock[];
  styles: DocStyleInfo;
}

export type ConvertResult = SlideResult | WebResult | DocResult;

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

/**
 * テーマ配色の参照（DeckInfo.colors のキー）または直接指定。
 * DecorationColor より広い（dk1 / lt1 と tint を持つ）。既存の .morphodesign
 * 互換のため DecorationColor は変更しない
 */
export interface ThemeColor {
  scheme?: 'dk1' | 'lt1' | 'accent1' | 'accent2' | 'accent3' | 'accent4' | 'accent5' | 'accent6';
  /** scheme が無いときに使う（#RRGGBB） */
  hex?: string;
  /** 参照色を地色へ寄せる度合い。OOXML の a:tint と同じ 1/1000 %（75000 = 75%） */
  tint?: number;
}

export interface DecorationColor {
  /** テーマ配色の参照（accent1〜accent6）。テンプレート差し替えに追従する */
  scheme?: 'accent1' | 'accent2' | 'accent3' | 'accent4' | 'accent5' | 'accent6';
  /** 直接指定（#RRGGBB）。scheme が無いときに使う */
  hex?: string;
}

export interface SlideDecoration {
  /** 文書内で一意。グループ化（将来）のメンバー参照にも使う */
  id: string;
  /** コンテンツスライド番号（1 始まり）。0 はタイトルスライド（表紙） */
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
  textSizes?: { titleSz?: number; coverTitleSz?: number; coverSubSz?: number; bodySz?: number[] };
  /**
   * デッキ全体のフッター（出典・注釈）。pptx のみ。他形式では無視される。
   * 座標は解決済みの EMU で渡す（装飾と同じ流儀 — テンプレートの帯を読むのも
   * 比率の既定値へ落とすのもアプリ側の仕事で、変換器は書くだけ）。
   * 表紙（ctrTitle を持つスライド）は onCover が真のときだけ載せる
   */
  footer?: {
    text: string;
    x: number;
    y: number;
    w: number;
    h: number;
    /** 1/100pt（DeckInfo.titleSz と同じ単位） */
    sz: number;
    algn: 'l' | 'ctr' | 'r';
    color: ThemeColor;
    onCover?: boolean;
  };
  /**
   * デッキ全体のフッターの docx / Web 向け（0.16.4）。pptx では無視される。
   * docx はページフッター（word/footer1.xml）として全ページに、
   * Web は本文末尾に 1 回だけ出す（HTML は「1 枚ごとに同じ出典を刷る」媒体ではない）。
   * 座標は持たない。文言・揃え・字サイズは pptx の footer と同じ解決結果から作る
   */
  docFooter?: {
    text: string;
    algn: 'l' | 'ctr' | 'r';
    sizePt: number;
  };
  /**
   * setReferenceDoc で預けたテンプレートを reference-doc として使う。
   * pptx（スライドプレビューと書き出し）のみ。バイナリを毎回運ばないための
   * 2 段構え — テンプレートは文書切替時に 1 度だけ預ける
   */
  useTemplate?: boolean;
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
    options: ConvertOptions & { format: 'doc' },
  ): Promise<DocResult>;
  convert(
    markdown: string,
    options: ConvertOptions & { format: PreviewFormat },
  ): Promise<ConvertResult>;
  exportFile(
    markdown: string,
    format: ExportFormat,
    options?: ConvertOptions,
  ): Promise<ExportResult>;
  /**
   * テンプレート（reference-doc・pptx バイナリの base64）を変換器へ預ける。
   * null で解除。以後 useTemplate: true の変換が使う
   */
  setReferenceDoc(base64: string | null): void;
  /**
   * 原稿が参照する画像（ファイル名 → base64）を変換器へ預ける。
   * null で解除。以後のすべての変換で pandoc の files に載る。
   * 預けていない参照はプレースホルダ文字列になる（変換全体は止めない）
   */
  setAssets(assets: Record<string, string> | null): void;
}

export type BootStatus =
  | { phase: 'idle' }
  | { phase: 'loading'; loadedBytes: number; totalBytes: number }
  | { phase: 'instantiating' }
  | { phase: 'ready'; bootMs: number; heapMB: number }
  | { phase: 'error'; message: string };
