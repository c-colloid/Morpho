# 文章の段落分け（多段組）— 設計

「横に並べる」をどこに書くかを決める。
結論は **原稿には構造だけ・幾何はテンプレート（将来のテーマ層）** で、
pptx は reference-doc のレイアウトを書き換えるだけで解く。OOXML 後処理は使わない。

技術事実はすべて pandoc.wasm 1.1.0 を Node で回して確かめた。
既存の実測は `CLAUDE.md` 落とし穴 10 と `notes/status.md` §3.1 にある。
**測っていないことは「未検証」と明記する。**

---

## 1. 決定事項

| 論点 | 決定 | 根拠 |
|---|---|---|
| 記法 | **pandoc ネイティブの `::: columns` / `::: column` だけ。独自発明も独自クラスもしない** | fenced div は pandoc / Quarto / markdown-it-container が同じ意味で読む。アプリは既に `::: notes` を使わせている（`preview/notesEdit.ts:9`） |
| 原稿に幅を書かせるか | **書かせない。`width="60%"` は原稿に出さない** | 実測: pptx は完全に無視（出力バイト数まで同一）、docx は段ごと無視、html だけ効く。三形式で意味が食い違う値を単一ソースの原稿に残すのは嘘になる |
| 幅比率をどこで持つか | **reference-doc の Two Content レイアウトの `<a:off>/<a:ext>`** | 実測: 既定テンプレートの `slideLayout4.xml` を 60:40 に書き換えて渡すと出力もその比率になる。スライド側 `<p:spPr />` は空のままで、**pandoc は何も知らずに従い、警告も出ない** |
| 段の本文サイズをどこで持つか | **同じくレイアウトの `<a:lstStyle>`** | pandoc 既定テンプレートは Two Content の列枠に `lvl1 sz="2100"`（21pt）を持つ。マスター bodyStyle の 24pt ではない（`status.md` §3.1.1・不具合 H として既知） |
| OOXML 後処理を使うか | **使わない**（段組みに関して） | 上の2つで足りる。`applyDecorations`（`bridgeHtml.ts:727`）の経路に段組みを持ち込まない。**bridge は pptx について1行も変えない** |
| 約束する段数 | **2段まで。3段以上は出さないと明言する** | 実測: レイアウトに `<p:ph sz="half" idx="3"/>` を xfrm つきで足しても pandoc は `idx="1"/"2"` しか使わず、3段目は `BlockNotRendered`(INFO) で捨てる。**テンプレート層では解けない** |
| 3段目の切り捨てを拾えるか | **拾える。`res.warnings` に来る** | 実測: `{type:"BlockNotRendered", verbosity:"INFO", contents, pretty}` の1件（`stderr` は空）。今は `warnText`（`bridgeHtml.ts:610-613`）が `message/msg` を見るので JSON 生で出て、`RULES`（`:154`）に規則が無いため「その他の警告」に埋もれる |
| 段ごとの個別比率（この段だけ 6:4） | **v1 では持たない。比率は文書ごと1つ** | `contentIndex` は段組みが起こす分割でずれ、ブロック通番は挿入でずれる。pptx 側もレイアウトが1枚しかないので変種を出せない |
| docx の段組み | **無視して上から順に流す。これを「正しい落としどころ」として宣言する** | 実測: `::: columns` は完全に無視され `w:cols` は出ない。スライドの横並びは、書籍では順に読む文章になるべき |
| docx の部分2段（continuous sectPr 注入） | **やらない** | 後処理であり、新聞段は原稿の段Aと段Bの対応を保証しない。Word 実機も未確認（`status.md` §3.5） |
| Web | **同じ値から CSS を作って `</head>` 直前へ注入する。段数も比率も畳みも効く** | 実測: 注入位置 `</head>`(3874) は pandoc 既定 `</style>`(3865) より後。既定 CSS は `div.columns{display:flex;gap:min(4vw,1.5em)}`。同じ詳細度の後出しなので `display:grid` が勝つ |
| 原稿の正規化（`***` の自動挿入） | **やらない** | 原稿と変換入力が別物になり、1文字→1文字でないのでオフセットが動く（`CLAUDE.md` 落とし穴 9 が守っている不変条件を破る）。`SlideDecoration.contentIndex` も丸ごとずれる。代わりに lint がワンタップで**原稿を実際に書き換える** |
| カーソル同期 | **fenced div の中を境界判定から除外する。合わないときは黙らず「合っていない」と見せる** | 実測: 段の中の `#` は pptx でスライドを割らない（太字段落）が、`cursorSlide.ts:12` の `H1` は割る。ずれると `contentIndexOf`（`EditorScreen.tsx:1031-1047`）がノート編集・改行編集・装飾編集をまとめて止める |
| 最小の第一歩 | **0.13.1 は既存のバグ修正だけ。記法も UI も足さない** | 今の 0.13.0 は、段組みを書くと改行編集が原稿を壊し（`status.md` §3.1 B）、右の段が縦中央にずれ（同 A）、段の字サイズが 3pt 大きく描かれる（同 H）。**直して初めて「2段組みは使える」と言える** |

---

## 2. 原稿に書くもの / 書かないもの

| 層 | 段組みについて持つもの |
|---|---|
| 内容（`.md`） | **`::: columns` / `::: column` の構造だけ。**「この塊とこの塊を並べたい」という意図。幅・段間・字サイズ・色は1バイトも持たない |
| テンプレート（reference-doc の pptx） | **幾何とサイズ。** Two Content レイアウトの `<a:off>/<a:ext>`（比率と段間）と `<a:lstStyle>`（段の本文サイズ） |
| 文書デザインデータ（`design-<id>.json` / `.morphodesign`） | **テンプレートへ渡す値**（比率・段間 pt・段の本文 pt・Web で畳む幅） |

**注意**: これは三層分離の「テーマ層」**ではない**。テーマ層は文書間で再利用・共有できるファイルのことで、
`status.md` §4.1 のとおり未着手。v1 の `ColumnStyle` は文書ごとのデザインデータに置き、
**テーマ層ができたらそのまま移せる形**にしておく。
「一つのテーマから刷り分ける」を名乗れるのはその後。

### 原稿に書く形

アプリが挿入するのはこの形ひとつだけ（外側4コロン・内側3コロン）。

```markdown
# 見出し

:::: columns
::: column
左の本文。
:::
::: column
右の本文。
:::
::::
```

- コロンの数違い・入れ子の深さ違いでも結果は同じ（実測）。**教える形を1つに絞る**ためにこの形にする
- **段組みブロックは、見出しの直後に単独で置く。** これが唯一のルール。
  実測: 見出し＋段組みだけなら **1枚**（Two Content・warnings 0）。前後に本文があると
  3枚に割れ、後ろ2枚にタイトルが付かない
- **発表者ノートは段組みの後ろに置く。** 実測: 後ろ → 1枚のまま・ノートは notesSlide へ隔離
  （warnings 0）。**前に置くと2枚に割れ、2枚目にタイトルが付かない**（warnings 0）。
  既存の `setNotes`（`notesEdit.ts:37`）は区間末尾に足すので**書き戻し経路は安全側**

### 書かせないもの

| 書かせない | 理由（すべて実測） |
|---|---|
| `width="60%"` 等の幅属性 | pptx 無視・docx 無視・html だけ効く。他ツール由来の原稿にあれば lint が「Web でしか効きません」と言い、文書の比率として取り込むか尋ねる |
| 段数の視覚指定・段間・揃え・罫・段の背景 | テンプレート層と装飾層の担当 |
| 意味クラス（`::: {.columns .図と本文}`） | **v1 では出さない。** クラス・id を足しても pptx は壊れない（実測: Two Content・warnings 0、HTML には class がそのまま出る）が、pptx は `Two Content` レイアウトを1枚しか見ないので**変種ごとに比率を変えられない**。Web だけ効く機能を原稿の語彙にすると刷り分けが嘘になる |

---

## 3. 形式ごとの意味

### pptx — 2段・比率はテンプレート・後処理ゼロ

pandoc は `::: columns` を **Two Content レイアウト**に落とし、
`<p:ph idx="1" sz="half"/>` と `idx="2"` の2枠を出す。スライド側の
`<p:spPr />` は空で、**座標も字サイズもレイアウトから継承する**。

既定テンプレート `slideLayout4.xml` の実測値:

| | 左（idx=1） | 右（idx=2） |
|---|---|---|
| off | 457200, 1200151 | 4648200, 1200151 |
| ext | 4038600 × 3394472 | 同じ |
| lstStyle | lvl1 `sz="2100"` / lvl2 1800 / lvl3 1500 / lvl4 以下 1350 | 同じ |

- **段間はここから導ける**: 左は 457200+4038600 = 4495800 で終わり、右は 4648200 で始まる →
  **152400 EMU = 12pt**。これを既定値にすれば、比率を変えても見た目の詰まりが動かない
- 60:40 の実測値（出力に反映されることを確認）: 左 `457200 / 4846320`、右 `5455920 / 3230880`
- **段の中の画像と表も列枠に追従する**（実測。60:40 にすると段内の pic も graphicFrame も
  同じ比率で動く）。`CLAUDE.md` 落とし穴 11 の「画像は枠が決める」の一例で、
  **後処理ゼロが段の中身まで成立する根拠**

**段の容量（21pt での算定）**: 列幅 4038600 EMU = 318pt、左右インセット 7.2pt ずつ（計 14.4pt）を
引いて 303.6pt。高さ 3394472 EMU = 267.3pt から上下 3.6pt ずつ（計 7.2pt）を引いて 260.1pt。
行送りを `fontSize × 1.25`（`SlideSurface.tsx:379`）で見ると **全角 14.4 字 × 9.9 行 ≒ 143 字**。
狭いので、**段の本文サイズを下げるノブ**が要る（§4）。

やらないこと:

- **3段以上**。レイアウトに3枠目を用意しても pandoc は使わない（実測）。
  段ごとの単体変換＋`<p:sp>` 注入でしか作れず、それは後処理なので採らない
  （作れること自体は実証済み — `@ooxml-tools/validate` エラー0）。
  案内は「2段に収める / 3列の表にする / **Web 形式で見せる**」
- **段ごとの比率変更**。レイアウトは1枚しかない
- **段の中の複数ブロックの救済**（画像より後ろの本文が消える等）。lint で見せるだけ

### docx — 段にしない。それを規則として宣言する

`::: columns` は完全に無視され、段の中身が順に BodyText として並ぶ（実測。`w:cols` は出ない）。
これを「pandoc の限界」ではなく**刷り分けの正しい振る舞い**として採る。
文書プレビュー（`DocumentSurface.tsx`）は実出力どおり縦に流しているので**修正不要**。

**文書全体の2段組**は reference.docx の `w:sectPr` に `<w:cols w:num="2"/>` を入れれば
出力へ引き継がれる（実測）。ただし docx には reference-doc の配線がまだ無い
（`bridgeHtml.ts:1413` は pptx のときだけ `wireTemplate`）。
段組みのためだけには割に合わないので**後回し**。
UI の言葉は分ける — スライドは「横に並べる」、docx は「版面の段数」。

### Web — 同じ値がそのまま効く唯一の形式

出力は `<div class="columns"><div class="column">`。
`WEB_CSS`（`bridgeHtml.ts:856-859`）を定数から**値を引数に取る関数**へ変える。

```css
div.columns{display:grid;grid-template-columns:3fr 2fr;gap:12pt}
div.column{min-width:0}
@media (max-width:40em){div.columns{grid-template-columns:1fr}}
```

- **狭い画面で1段に畳む**のは既定で入れる（既定 40em）。iPad で和文の段が潰れるのは致命的
- 境界へは CSS 文字列ではなく**形式中立の値**を渡す（`ConvertOptions.columns`）。
  CSS へのコンパイルは web 経路の中だけで行う
- **これはプレビューにしか出ない。** HTML / epub の書き出し経路は存在しない
  （`ExportFormat = 'pptx' | 'docx'`）。`status.md` §4.2 のカードを取るまで、
  Web の段組みは「見えるが持ち出せない」

---

## 4. データモデル

### 型（`converter/types.ts`）

`SlideDecoration` と同じ流儀 — pandoc 固有の語彙を出さない。`Two Content` を型名に入れない。

```ts
/** 文書ごとの段組みの決めごと */
export interface ColumnStyle {
  /** 段の幅の比。整数比。v1 は2段固定なので長さ2。既定 [1, 1] */
  ratio: [number, number];
  /** 段間（pt）。既定 12（pandoc 既定テンプレートの実測値と同値） */
  gapPt: number;
  /** 段の本文サイズ（pt）。未指定はテンプレート既定（pandoc 既定は 21pt・実測） */
  bodyPt?: number;
  /** Web で1段へ畳む画面幅（em）。既定 40 */
  webCollapseEm: number;
}
```

境界に足すのは `ConvertOptions.columns?: ColumnStyle` と、**バックエンドの申告**。

```ts
/** バックエンドが自分の既知の癖を申告する。lint はこの集合で有効化される */
export type QuirkId =
  | 'columns-max-2'              // 3段目以降が捨てられる
  | 'block-after-image-dropped'  // 段の中で画像より後ろの本文が消える
  | 'second-image-dropped'       // 段の中の2枚目の画像が消える
  | 'split-around-block'         // ブロックの前後に本文があるとスライドが割れる
  | 'notes-before-block-splits'; // ノートをブロックの前に置くと割れる

export interface Converter {
  readonly quirks: readonly QuirkId[];
  /* …既存 */
}
```

**能力の3スカラー（段数・比率・字サイズ）では lint を救えない。**
6本の規則のうち3スカラーから導けるのは「3段目」だけで、残りは pandoc 実装の癖であり、
自前 writer では**存在しないうえに誤報になる**。癖の集合として申告すれば、
自前 writer は空配列を返すだけで規則がまとめて黙る。
**これが `CLAUDE.md`「lint を作り込みすぎないこと」への回答。**

### 保存（`store/designs.ts:33`）

```ts
export interface DesignData {
  version: 1;
  decorations: SlideDecoration[];
  groups: DecorGroup[];
  text?: TextSizes;
  template?: TemplateMeta;
  columns?: ColumnStyle;    // ← 追加
}
```

- **`version` は 1 のまま。** `parseDesignFile`（`designFile.ts`）は
  `o.version !== 1` で**ファイル全体を null にする**ので、2 に上げると旧版で
  装飾もグループも文字サイズも失われる。`groups` を足したときも版を上げずに
  任意フィールドにした前例がある（`designs.ts:60-61`）
- 直す場所は**書き出しと読み込みの両方**（`serializeDesign` の spread、
  `parseDesignFile` の sanitize、`loadDesign` の sanitize）。片方だけだと往復で消える

### 純関数（`design/columns.ts` — 新規）

```ts
export function columnFrames(left: Frame, right: Frame, s: ColumnStyle): [Frame, Frame];
/** 変換直前の複製へ適用する。原本は書き換えない（template.ts と同じ作法） */
export function applyColumns(bytes: Uint8Array, s: ColumnStyle | undefined): Uint8Array;
/** プレビューのドラッグ中だけシーンの frame を差し替える（adjustDeck と同型） */
export function withColumnFrames(slide: SlideOutline, s: ColumnStyle): SlideOutline;
```

`applyColumns` は `applyAssignments`（`design/template.ts:97-123`）の**後**に走る。
ただし **`<p:cSld name="Two Content">` は無条件には見つからない** —
配線盤で Two Content を割り当てていないテンプレートでは、
`template.ts` が英語名レイアウトを `"Two Content (template)"` へ退避させる。
**見つからなければ黙って無効にし、その旨を指摘として1件出す**（黙って何もしない、はやらない）。

### テンプレートの配線は一般化が要る

「`templateKeyRef` のキーに混ぜるだけ」では**動かない**。
`EditorScreen.tsx:312-347` は `design.template` が undefined だと分岐ごと素通りして
`setReferenceDoc(null)` になり、依存配列にも `design.columns` が無い。
`useTemplate` も2箇所とも `design.template !== undefined` で門番されている（`:895`・`:1454`）。

したがって 0.15.0 は「テンプレート配線を**文書のテンプレート or 既定テンプレート**の
2系統に一般化する」ことから始まる。既定テンプレートの実体は、比率を初めて触ったときに
`exportFile('# x', 'pptx', {})` を1回走らせた出力を端末ごとにキャッシュして得る
（**pandoc 既定テンプレートをアプリに同梱はしない** — GPL の成果物が配布物に入る）。

---

## 5. UI

新しいジェスチャは足さない。既存の3か所に乗せる。

### 挿入 — 原稿ペインのラベル行

`EditorScreen.tsx:1518` の `paneLabelRow`、「画像」ボタン（`:1520-1522`）の隣に「段組み」。

- **選択範囲を `::: columns` で包む。** 選択範囲の中の空行をそのまま段の境界に使う。
  選択が無ければカーソルのある段落と次の段落を包む
- そのために `cursorRef`（`:964`・いまは `number`）を `{ start, end }` へ広げる**1行の変更**が要る。
  `onSelectionChange` は `selection.start` しか読んでいない。
  **読むだけなら IME は壊れない**（危険なのは `setSelection` の書き戻し）
- 書き戻しは `handleInsertImage`（`:475-508`）と同一経路。
  **前後を必ず空行で挟む**（§6 の L7 と同じ理由）
- 差し込み位置がスライドの途中なら、その場で2択:
  「段組みだけのスライドにする（`***` を入れる）／このまま入れる」

### 比率 — プレビューの仕切りをドラッグ

`ColumnEditLayer`（新規）を `SlideSurface` の上に重ねる。構造は
`DecorEditLayer.tsx:21-46` の「透明な当たり判定だけを描き、塗りは常に SlideSurface が描く」を踏襲。

- ヒット領域は幅 44pt、50:50 / 60:40 / 40:60 / 70:30 に ±2% で吸着
- **ドラッグ中は `onLive`、指を離して `onCommit`。** `withColumnFrames` で
  frame だけ差し替えた slide を SlideSurface へ渡す
- **追従するのはテキストだけ。** 段の中の画像・表は pandoc が明示 xfrm を
  スライドへ焼くので、ドラッグ中は動かず、指を離して再変換した瞬間に飛ぶ。
  ドラッグ中は画像・表を半透明にして「確定後に揃う」ことを示す
- ドラッグ中のスクロールロックは `decorDragging`（`:1134`）をそのまま使う

**段の増減はここには置かない。** 段数は原稿の話なので原稿ペイン側の操作にする。

### 数値と一括 — DecorSheet

`DecorSheet.tsx:440`「文字サイズ」と `:487`「テンプレート」の間に「段組み（文書全体）」節。
比率プリセット / 段間 pt / **段の本文サイズ pt** / Web で畳む幅。
**段組みが1つも無い文書では節ごと出さない。**

### 形式ごとの落としどころ帯

段組みを含む原稿でだけ、プレビュー先頭に1行:

```
スライド  2段 6:4 ／ 本文 18pt      文書  上から順に流れます      Web  2段（狭い画面で1段）
```

---

## 6. リント

置き場は `preview/columns.ts`（純関数）。出力は原稿内オフセットつき。
**規則は `Converter.quirks` で有効化し、段組みを1つも書いていない原稿では1件も出さない。**
重要度は `Diagnostic` の語彙を借りず独自の3段階（`loss` / `layout` / `note`）にする —
境界の `DiagnosticKind` は「変換器が吐いた警告の分類」であって「原稿の書き方の指摘」ではない。

| # | 重要度 | 何を見せるか | 根拠 |
|---|---|---|---|
| 1 | loss | **3つ目以降の段は出ません** | `::: column` が3つ以上。実測: `BlockNotRendered`(INFO) で捨てられ出力に痕跡なし。**Web プレビューを見ているときは出さない**（web では出るので嘘になる） |
| 2 | loss | **段の中で、画像より後ろに書いた本文が消えます** | 実測。warnings 0件。逆順（本文→画像）なら両方残る |
| 3 | loss | **段の中の2枚目以降の画像が消えます** | 実測。media も1件しか出ない |
| 4 | layout | **段組みの前後に本文があるとスライドが3枚に割れ、後ろ2枚にタイトルが付きません** | 実測。`fix: 'split-before' / 'split-after'` を持つ。押すと `patchBody`（`EditorScreen.tsx:1014-1022`）で `***` を入れる |
| 5 | layout | **発表者ノートは段組みの後ろに置いてください** | 実測: 前に置くと2枚に割れ2枚目にタイトルが付かない（warnings 0） |
| 6 | note | **幅指定は Web でしか効きません** | `width=` 属性つきの段。`fix: 'take-width'` で文書の比率に取り込み、原稿から属性を消す |
| 7 | layout | **画像や段組みの直後に空行なしで見出し／水平線があります** | 実測: `![](a.png)\n# 二枚目` は2枚目のタイトルが消え、本文に `# 二枚目` という文字列が出る。`***` でも同様。**枚数は一致するので `contentIndexOf` は素通りする** |

**フェンスの中は見ない。** `cursorSlide.ts:14` が `FENCE` を持っているのと同じ理由で、
Markdown の書き方を説明する原稿（このプロジェクト自身の原稿が該当する）で誤発火する。

行タップで原稿の該当位置へ飛ばす。オフセットは **front matter 長を足す**
（`handleSelectSlide` は `fmOffset + seg.start` を使っている・`EditorScreen.tsx:999`）。

### 変換器の警告も直す（lint の前提）

- `warnText`（`bridgeHtml.ts:610-613`）の `message` / `msg` は pandoc-wasm 1.1.0 に存在しない。
  キーは `type / verbosity / contents / pretty`（実測）。**`pretty` を使う**
- **同時に `LoadedResource` を捨てる規則を入れる。** 実測: reference-doc で1件、
  画像2枚の段組みで**7件**出る。いまは JSON 生なので誰も読まないが、`pretty` にした瞬間
  読める文で常駐し、`CLAUDE.md` 落とし穴 7（本当に見るべき警告が埋もれる）の再演になる
- `RULES`（`:154-161`）に `BlockNotRendered` を1行足す

---

## 7. プレビューとの一致

### 追加の描画実装は要らない

`::: columns` の2段は、今のプレビューがすでに Two Content として正しく描ける
（`layout: "Two Content"`、左 `{457200,1200151,4038600,3394472}` / 右 `{4648200,…}` を継承解決済み）。
`applyColumns` は reference-doc を書き換えるだけなので、
**プレビューが解析する pptx には既に新しい座標が入っている。**

ただし継承解決に穴があり、**段組みを製品機能にする前に潰す。**

**(A) 右の段だけ縦中央揃えになる。** `findInherited`（`bridgeHtml.ts:414-431`）は
type 一致で見つからないと idx だけで照合する。既定テンプレートの実測:

| | layout4 | master |
|---|---|---|
| 段の枠 | `<p:ph sz="half" idx="1"/>` `idx="2"` — **`type` 属性を持たない**。anchor なし | — |
| idx=2 | — | `<p:ph idx="2" sz="half" type="dt"/>` — **`anchor="ctr"` を持つ** |

修正は idx フォールバックから `dt` / `ftr` / `sldNum` を外すこと
（idx の番号空間がコンテンツ枠と別なので照合してはいけない）。

**(C) 座標を持たないレイアウトのテンプレートでは左右の段が同じ枠に重なる。**
これは A と同じ関数の**別の経路**で、idx 照合が空振りしたあと
最後の `type === 'body'` フォールバック（`:425-429`）へ落ちることによる。
**A の修正だけでは直らない。** 照合順を
「type 完全一致 → idx（dt/ftr/sldNum 除外）→ **同じ idx がどのレベルにも無いときだけ** body」
に変え、`sz="half"` / `sz="quarter"` を持つ枠は body フォールバックの対象から外す。

**(H) 段の字サイズが 3pt 大きく描かれる。** `SlideSurface.tsx:333` は全スライドで
`deck.bodySz`（マスター bodyStyle = 24pt）を使うが、実出力の段はレイアウトの
`<a:lstStyle>` の 21pt で描かれる。同じ穴が Section Header・Content with Caption・Comparison にもある。

修正は `parsePlaceholderFrames`（`:385`）が `lstStyle` の `lvl1..9 defRPr sz` も拾い、
`findInherited` の3つ目の key として解決すること。ただし**そのまま `SlideShape` の値を
`deck.bodySz` より優先すると、文書全体の文字サイズ設定が段組みスライドで効かなくなる** —
プレビューの文字サイズは `adjustDeck`（`design/textSizes.ts:59`）が `deck.bodySz` を
差し替えて実現しているため。`adjustDeck` に shape 側の sz も同率で縮尺させること。

同じ理由で **`ColumnStyle.bodyPt` と `TextSizes.bodyPt` は二重適用になりうる**
（`applyColumns` が lstStyle に 18pt を書き、`applyTextSizes` がそれをマスター 24pt 基準の
比率でもう一度縮める → 18 × 16/24 = 12pt）。優先順位を決めて 0.15.0 の完了条件に入れる。

**(B) 改行編集が段組みを1行に潰す。** `lineBreakEdit.ts:150` の `kind` に div が無く、
`:197-211` が連続する非空行を1段落として吸うため、書き戻すと
`"::: colu\\\nmns ::: column左…::: :::"` になる（実測）。
`:::` 行を段落の切れ目にし、div 自体は編集対象にしない。

**(D) `::: notes` の中に段組みを書くと途中で切れる。** `NOTES_BLOCK`（`notesEdit.ts:9`）は
単一の正規表現で、**入れ子の深さは非貪欲マッチでは数えられない**。
`findBlocks` を行スキャナへ置き換える（`cursorSlide` の FENCE 判定と同じ流儀）。

### カーソル同期

**pandoc の分割規則を `cursorSlide.ts` に教え込むことはしない**
（自前 writer に差し替えた瞬間に嘘になる知識だから）。やるのは2つだけ。

1. **fenced div の中を境界判定から除外する。** 実測で「段の中の `#` はスライドを割らない」が
   確定しているので、これは推測ではなく**実出力に合わせる修正**。あわせて
   `slideSegments` と `slideIndexAtCursor` の二重実装を、前者から後者を導く形に一本化する
2. **合っていないことを見せる。** `slideCount - titleOffset === slideSegments(body).length` を
   `synced` として持ち、`false` のとき自動スクロールを止め、ハイライトを点線にし、
   Alert ではなく常設の指摘で理由を名指しする

---

## 8. 実装の刻み

### 0.13.1 — 既存の壊れを直す（記法も UI も足さない）

**ここで初めて「2段組みは使える」と言える状態になる。**

1. `findInherited` の照合順（A と **C の両方**）
2. レイアウトの `<a:lstStyle>` の字サイズを継承解決に足し、`adjustDeck` を同率で追従させる（H）
3. `lineBreakEdit` の段落候補から `:::` 行を除外（B）
4. `notesEdit` の `findBlocks` を行スキャナへ（D）
5. `warnText` を `pretty` へ、`RULES` に `BlockNotRendered` を足し **`LoadedResource` を捨てる**
6. **`npm run check` を CI に載せる**（1ステップ。以降の検査が守られない状態を先に解消する）
7. 検査: `check-scene.mjs` に段組みの回帰（レイアウト名・左右の frame・**両方の anchor が同じ**・
   段の字サイズが 2100）、`check-linebreak.mjs` / `check-notes-edit.mjs` に段組み入りのケース、
   `check-deck.mjs` に `SlideOutline.layout === 'Two Content'` の assert

### 0.14.0 — 正直に伝える（原稿もテンプレートも触らない）

`preview/columns.ts`（7本の lint・純関数・オフセットつき）と `check-columns.mjs`、
`Converter.quirks`、プレビュー先頭の指摘行＋タップで原稿へジャンプ、
形式ごとの落としどころ帯、`cursorSlide.ts` の fenced div 除外と `synced` 状態。

**リントが先、入力補助は後。** まず「今書いてある原稿の壊れ方」が見えることの価値が大きい。

### 0.15.0 — 比率・段間・段の本文サイズ

`ColumnStyle` / `DesignData.columns`（version は 1 のまま）/ `design/columns.ts` /
**テンプレート配線の2系統化**と既定テンプレートのキャッシュ / `DecorSheet` の「段組み」節 /
`check-columns.mjs` に TS の EMU 計算と実変換の一致、`check-template.mjs` に
60:40 を書いたテンプレートで本物の pandoc がその比率を出すことの常時検証。

**bridge は1行も変えない。** これがこの設計の要点。

### 0.15.1 — 触れるようにする

`ColumnEditLayer`（仕切りドラッグ・吸着・`onLive`/`onCommit`）、原稿ペインの「段組み」挿入ボタン。
見本は新しい fixtures に置く（**`fixtures/pptx-benchmark.md` は書き換えない**）。

### 0.16.0 — Web プレビューへ波及

`WEB_CSS` を関数化し `ConvertOptions.columns` から CSS を作る。
**持ち出せるようにするには HTML / epub の書き出し経路が要る**（`status.md` §4.2）。

### 後回し — 文書全体の2段組

docx への reference-doc 配線と `w:cols` 入りテンプレート。
フォント・見出しスタイルの持ち込みと同時に来るので、その要求が立ったときに一緒に入れる。

### やらないと明記するもの

スライドの3段以上／原稿からの幅比率指定／段ごとの個別比率／
docx の部分2段（continuous sectPr の注入）／段の中の複数ブロックの救済／
段組みのための OOXML 後処理。

---

## 9. 未検証事項（測り方つき）

| # | 何が未検証か | どう測るか |
|---|---|---|
| 1 | **自作テンプレートの Two Content 枠に `<a:off>/<a:ext>` が無い場合**に比率を書けるか。既定テンプレートは持っている（実測）が、自作は分からない | `check-template.mjs` に「列枠に xfrm を持たない和名テンプレート」を1ケース足す。無ければマスターの body 枠を基準に xfrm を**挿入する**実装にし、その出力を assert する |
| 2 | **レイアウトの `lstStyle` を書き換えた pptx を PowerPoint 実機がその字サイズで描くか** | 書き出し → Files → 実機の PowerPoint。0.15.0 の完了条件 |
| 3 | **`ColumnStyle.bodyPt` と `TextSizes.bodyPt` の二重適用の実際の値** | `check-deck.mjs` に「段 18pt・本文 16pt」を設定した原稿の実サイズを assert する1件 |
| 4 | **文書全体の文字サイズ設定が、レイアウト `lstStyle` を持つスライドに効いていない**範囲 | 同上。0.13.1 で直すが、直った証拠を検査に残す |
| 5 | **iPad 実機での端から端の時間**（比率変更 → zip 再構築 → 再変換 → 解析 → 描画） | 既存の `templateKeyRef` の 400ms デバウンスに乗るので体感は守れる見込み。実機で計測 |
| 6 | **`.morphodesign` に `columns` を足したファイルを旧版が読んだときの実挙動** | 0.13.0 のビルドに 0.15.0 が書いたファイルを読ませる |
| 7 | **段組みを含む原稿の epub 出力。** `to: 'epub'` が通ることは実測済みだが、`::: columns` の出力と CSS 注入経路は未検証 | epub を1本出して `EPUB/text/*.xhtml` を見る |
| 8 | **docx の reference-doc 経路そのもの**（未配線）と、`w:cols` 入り文書の **Word 実機**での見え方 | 着手時の前提。`@ooxml-tools/validate` のエラー0は「壊れていない」までしか言わない |
| 9 | **段が狭いときの和文折り返しの誤差。** 誤差は枠幅に対する相対量なので、枠が半分になる段組みでは相対誤差が倍になる | 実機で「左右の段の下端が揃っているか」が判断できるかを見る |

### 今回の設計中に測って決着したこと（再検証不要）

- 見出し＋段組みだけなら **1枚**（Two Content・warnings 0）
- **発表者ノートは段組みの後ろなら安全、前だと2枚に割れる**（どちらも warnings 0）
- 段の中の `#` は **pptx でスライドを割らず太字段落**、**docx では Heading1**
- **3段目の切り捨ては `res.warnings` に来る**（`BlockNotRendered` / INFO・`stderr` は空）
- **テンプレートに3枠目を足しても pandoc は使わない**（`idx="1"/"2"` のみ）
- **60:40 はテンプレートのレイアウト書き換えだけで出る**（スライド側 `<p:spPr />` は空のまま）
- **段の中の画像と表も列枠の比率に追従する**
- **pandoc 既定テンプレートは列枠に `sz="2100"` を持っている**（マスターの 24pt ではない）
- **`</style>`(3865) < `</head>`(3874)** — 注入 CSS は既定 CSS より後に置かれ、同詳細度で勝つ
