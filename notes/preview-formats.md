# プレビューの出力形式切り替え — 設計と実装計画

一つの原稿から複数の形式へ「刷り分ける」体験をプレビューに持ち込む。
スライド（pptx）だけだったプレビューを、形式を切り替えられる構造にする。

検討の材料はすべて実測（pandoc.wasm 3.10 の実出力を node で確認。
docx は `app/scripts/dump-docx.mjs`、詳細は本文中に記載）。

## 決定事項

| 論点 | 決定 | 根拠 |
|---|---|---|
| 実装順 | **① 切り替え土台 + Web → ② 飾る力（v0.6 に改番） → ③ 文書（docx）プレビュー** | 土台は今なら1バージョンで通る。後回しにするとスライド前提コードが増えて高くつく。文書プレビューは docx 三層パーサ（pptx と同規模）が要るので装飾モデル確定後 |
| Web プレビューの方式 | pandoc の `to: html`（standalone）を**可視 WebView にそのまま表示** | 「実際の出力そのもの」原則に合致。reveal.js 案の却下理由（別ライターが嘘をつく）は、Web という形式自体を見るときには当たらない |
| 文書プレビューの方式（将来） | **フロー表示（リーダー風）**。ページ組はしない | document.xml にページ境界情報は存在しない（`w:pgSz` すら無いことを実測）。ページ組は Word の組版エンジンの再発明＝嘘になる |
| PDF | **対象外**。着手前に `to: 'pdf'` が wasm で原理的に可能かを1回の実験で確定させる | pandoc の PDF は外部エンジン（pdflatex / typst）のサブプロセス起動が通常経路。CLAUDE.md 未検証項目のまま席だけ用意しない |
| 切り替え UI | プレビューペインのヘッダ行に**セグメント**（スライド / Web、将来 + 文書） | 2〜5個・常時可視・排他選択は HIG のセグメント適用ケース。既存の paneLabelRow がそのまま置き場になる |
| 変換の走らせ方 | **アクティブな形式だけ**変換。切り替え時はその形式を即時変換 | ブリッジは単一 FIFO 直列（中断不可）。全形式を毎回投げると、見ていない形式の変換の後ろに見ている形式が並ぶ |
| 編集系（ノート・改行編集） | **スライド形式のみ**。他形式にはハンドラ自体を渡さない | 対応表がスライド区間前提。将来は見出し区間に一般化して文書/Web にも拡張可能（下記） |
| `::: notes :::` | **docx 書き出しでは Lua フィルタで除去（今回実装）**。Web プレビューは CSS 非表示 | docx では無警告で本文に混入する（新発見・実測）。HTML は `<div class="notes">` でクラスが残るので CSS で隠し、将来「付記」として見せる余地を残す |

## Converter 境界の拡張（types.ts）

pandoc 固有の語彙を漏らさない原則は維持。既存のスライド型は一切変えない。

```ts
export type PreviewFormat = 'slides' | 'web';   // 文書プレビュー実装時に 'doc' を足す

interface ConvertResultBase { diagnostics; ms; bytes; }
export interface SlideResult extends ConvertResultBase {
  kind: 'slides'; slideCount; slides; deck;     // 旧 ConvertResult と同一フィールド
}
export interface WebResult extends ConvertResultBase {
  kind: 'web'; html: string;                    // 完成 HTML。WebView でそのまま描画
}
export type ConvertResult = SlideResult | WebResult;
```

`Converter.convert` はオーバーロードで format を受ける
（省略時は 'slides' → 既存呼び出しは無改修で型が通る）。
`ExportFormat`（コンテナ形式）と `PreviewFormat`（シーンの形）は別概念として分離。

## 実測で確定した事実（設計の根拠）

### HTML（Web プレビュー用）

- standalone 出力は viewport meta・約7.3KB の既定 CSS 込み。今回のサンプルで 8.3KB
- `\` 改行は `<br />`、`***` は `<hr />`。east_asian_line_breaks も効く
- **見出し id はスラグ化される**（記号除去・重複は連番）。id を独自予測するとズレる。
  同期に使うなら出力 HTML から実際の id を読むこと
- front matter を剥がさず渡すと本文に1列テーブルとして混入（落とし穴1は HTML でも同じ）。
  既存の splitFrontMatter 経路を必ず通す
- 画像は embed-resources を付けない限り相対パスのまま。画像対応時は
  pptx 用の画像解決前処理を共有し `embed-resources: true` で自己完結 HTML にする
- 既定 CSS は body の font-family 未指定・ライト固定。日本語フォント指定を
  `</head>` 直前に注入して上書きする

### docx（将来の文書プレビュー用パーサの設計材料）

- 見出しレベルは `w:pStyle` の styleId（Heading1〜9）でのみ確実に取れる。
  字サイズからの逆算は Heading4 以降で破綻（サイズが変わらない）
- リスト構造は **numId の変化では判定できない**（入れ子のたびに新 numId、
  別リストも別 numId、兄弟は子を挟んでも同 numId）。ilvl の増減でツリーを復元し、
  numId → numbering.xml → `w:numFmt` は bullet / decimal の種別判定にのみ使う
- 表のヘッダ書式は document.xml 単体では決まらない
  （styles.xml の firstRow 条件付き書式 × w:tblLook の突き合わせが要る）
- 行内改行は同一 `w:p` 内の `<w:br/>`（pptx と同型）。`***` は VML の `o:hr="t"`
- 見出し直後の段落は FirstParagraph、以降は BodyText、リスト・表セルは Compact
- `::: notes :::` は**痕跡ゼロで本文に溶ける**（下記）

### 新しい落とし穴（CLAUDE.md にも追記）

1. **`::: notes :::` は docx 出力で無警告のまま本文に混入する**。
   pptx がノートスライドに隔離するのと対照的に、docx には発表者ノートの
   概念自体が無い。対処: docx 書き出し時に Lua フィルタ
   `function Div(el) if el.classes:includes('notes') then return {} end end`
   で除去（除去できることを実測済み）。pptx は除去しない（ノート欄に入るのが正）
2. **YAML front matter と options.metadata を両方渡すと Title と
   生テーブルが重複出力される**（docx で実測）。既存方針
   「front matter は剥がして metadata で渡す」の根拠がさらに強まった

## 実装計画

### v0.5.0 — 刷り分けの土台 + Web プレビュー（今回）

1. types.ts: 上記ユニオン化と convert のオーバーロード
2. bridge: doConvert に形式分岐。web は `to:'html'` + standalone + metadata、
   `</head>` 直前に `.notes{display:none}` と日本語フォントの CSS を注入。
   docx 書き出し（doExport）に notes 除去 Lua フィルタを追加
3. UI: プレビューヘッダにセグメント（スライド / Web）。web は可視 WebView、
   ナビゲーションは初回ロード以外ブロック。編集系・▶再生はスライドのみ
4. 検査: CSS 注入の純関数検査（check-scene）、docx から notes が消える
   統合検査と web の HTML 構造検査（check-deck）
5. ロードマップ改番: 飾る力 v0.5 → v0.6

### v0.6 — 飾る力（次）

roadmap-pptx.md のとおり。装飾記法・テーマ分離・グループ・インスペクタ。
装飾モデルを pptx で確立してから他形式へ展開する。

### v0.7 以降 — 文書（docx）プレビュー

- `dump-docx.mjs` の実測パターンで document.xml / styles.xml / numbering.xml の
  三層パーサを bridge に実装（DocBlock シーン: heading / paragraph / list / code / table）
- フロー表示の DocumentSurface（ネイティブ描画）
- カーソル同期は「見出し区間」への一般化（slideSegments の headingSegments 版）で
  スライド・文書・Web に共通化する
