# フッター（出典・注釈）— 設計と検証

抄読会のスライドに「N Engl J Med 2024;390:1234-45」のような出典を小さく載せる。
デッキ全体で同じ出典を出す場合と、スライドごとに違う注釈を出す場合の両方を扱う。

**まだ実装していない。** ここに書いた数値はすべて pandoc-wasm 1.1.0（pandoc 3.10 相当）の
実出力から取った。再現には `node scripts/dump-footer.mjs`（`app/` で実行）を使う。
実機（PowerPoint / Word / iPad）で見たものは一つも無い — 「未検証」の節に列挙した。

---

## 決定事項

| 論点 | 決定 | 根拠 |
|---|---|---|
| 文言の住処 | **content.md**（front matter の `footer:` と `::: footer`） | 出典は装飾ではなく原稿の事実。Obsidian へ持ち出しても残る必要がある |
| 体裁の住処 | **テーマ層**（当面は文書ごとの設定。将来テーマファイルへ引っ越す） | 記法だけでは絶対に小さくならない。pptx では本文段落と 1 バイトも変わらない XML になる（実測） |
| 記法 | `::: footer`（フェンスド div）＋ front matter `footer:` | Quarto（pandoc ベース）と Marp が同じ語彙。新発明ではない。既存の `::: notes` とも揃う |
| pptx への出し方 | **明示 xfrm のテキストボックスを OOXML 後処理で注入** | ftr プレースホルダは継承フォールバックの罠・idx 不定・既定が中央揃え 9pt / 幅 228pt（後述） |
| 帯の座標 | テンプレートの ftr 帯の y/h を借り、幅だけ全幅へ広げる。ftr が無ければ比率の既定値 | テンプレート追従と、データを形式非依存に保つことの両立 |
| スライドの宛先 | **目印（sentinel）方式**。pandoc が実際に置いた場所を読む | `contentIndex + titleOffset` は普通の原稿で壊れる。benchmark で JS 9 枚 対 実 64 枚（実測） |
| 表紙 | **既定で出さない**（オプションで出せる） | 表紙の日付（dt）とまったく同じ帯にいる。表紙の有無自体が metadata 4 キーのどれかで変わる |
| docx | デッキ全体はページフッター、個別注釈は小さい段落 | docx には footer の受け皿が最初から無い（パートもスタイルも 0 個） |
| Web | `</head>` 直前への CSS 注入。デッキ全体は末尾に 1 回 | 既定 CSS に `.footer` 規則が無いので衝突しない |
| プレビュー | 文言は実出力から、体裁はテーマから（既存の二系統合成と同じ） | `parseRuns` は `sz` を読まない。zip を作り直すと +23ms |
| 最初の版の範囲 | **front matter のデッキ全体フッターだけ** | Lua ゼロ・目印ゼロ・番号の対応付けゼロ。主用途の大半をここで満たせて、最も壊れにくい |

---

## 実測で確定した事実

### 1. pptx には空のフッター枠が最初から用意されている

pandoc 既定 reference の `slideMaster1.xml`:

| プレースホルダ | 位置（EMU） | 大きさ | 書式 |
|---|---|---|---|
| `dt`（日付） | 457200, 4767263 | 168.0 × 21.6 pt | sz=900 algn=l anchor=ctr |
| `ftr`（フッター） | 3124200, 4767263 | 228.0 × 21.6 pt | sz=900 **algn=ctr** anchor=ctr |
| `sldNum`（ページ番号） | 6553200, 4767263 | 168.0 × 21.6 pt | sz=900 algn=r anchor=ctr |

3 つとも同じ帯（y = 92.69%、高さ 5.32%、スライド下端まで 8.1pt）に横並び。色は `schemeClr tx1` の tint 75%。

- **11 レイアウトすべてが ftr / dt / sldNum を持つが、座標を持つものは 0 枚。**
  レイアウト側は空の `<p:spPr/>` で、継承は必ずマスターへ落ちる
- **pandoc が出力する slideN.xml には ftr の `<p:sp>` が 1 枚も無い。**
  枠はあるが中身は空 — フッターは変換のたびに注入する
- `<p:hf>` 要素はマスターにもレイアウトにも無い

#### それでも ftr プレースホルダは使わない

`<p:ph type="ftr" idx="11"/>` を注入する経路は動く（スキーマ検証 0 件、`parsePptx` が
マスターから frame を継承解決するところまで実測）。使わない理由は 4 つで、いずれも実測:

1. **ftr を持たないテンプレートで本文全面に化ける。** `findInherited` は
   type 一致 → idx 一致 → **body** の順に落ちるので、座標なしの ftr 図形が
   本文プレースホルダの枠（8229600 × 3394472）を継承する。警告はゼロ
2. **idx は正規化されない。** テンプレートの ftr が idx=4 なら出力も idx=4 のまま通る。
   11 決め打ちは書けない
3. **既定が中央揃え 9pt・幅 228pt。** 日本の抄読会の出典は右下か左下が普通で、
   111 字の出典は内寸 213.6 × 14.4pt（autofit 指定なし・9pt で 1 行）に構造的に入らない
4. **`<p:hf ftr="0"/>` を持つテンプレートを警告なしに受け入れる**（reference-doc を素通りする）

代わりに、テンプレートの ftr 帯を「その原稿がフッターを置きたい場所」の宣言として**読む**。
座標は借りるが、注入するのは自前 xfrm を持つ普通のテキストボックスにする。
ftr が無いテンプレートでは比率の既定値へ落ちる。

### 2. 記法は 3 形式すべてで内容を失わないが、見た目は一切付かない

`::: footer` を含む原稿を 3 形式へ変換した実出力:

| 形式 | 結果 |
|---|---|
| pptx | 本文プレースホルダに追加の `<a:p>` として入る。**pPr も rPr も本文段落と完全に同一**。クラス名は出力に残らない |
| docx | `w:pStyle=BodyText`。本文と見分けがつかない。`word/footer*.xml` は **0 個** |
| html | `<div class="footer">` としてクラスがそのまま残る。既定 CSS（3595 bytes）に `.footer` 規則は無い |

つまり**記法の層だけでは「小さく書く」は原理的に満たせない**。体裁は必ず変換層が付ける。
これが「文言は内容・体裁はテーマ」という二層構成が設計上の選択肢ではなく必須である理由。

検討して捨てた記法:

- **見出し属性 `# 見出し {footer="…"}`** — pptx でも docx でも**無警告で消える**（html だけ `data-footer` に残る）。
  データロスなので主記法にはできない。Lua からは読めるので、将来アンカーとしてなら使える
- **front matter だけ** — `metadata.footer` は pptx / docx で `docProps/custom.xml` にしか落ちない。
  「どこにも見えないが消えてもいない」という気づきにくい状態になる
- **bracketed span `[…]{.footer}`** — 同等に安全だが、段落を丸ごと注釈にする用途には div が自然

日本語のクラス名（`::: 出典`）も通り、Lua の `classes:includes('出典')` で一致する。エイリアスにできる。

### 3. スライドの宛先は数えてはいけない

`contentIndex + titleOffset`（装飾が使っている対応付け）をフッターに流用すると壊れる。

- **`fixtures/pptx-benchmark.md`: `cursorSlide.ts` は 9 枚と数え、pandoc は 64 枚出す。**
  主因は表の分割ではなく **pandoc の slide level 自動判定** — `#` の直下に `##` を置くと
  slide level が 2 になり `##` がスライドを作る。抄読会の原稿はまさにこの形
- 15 行程度の典型的な抄読会原稿（front matter + `# 背景` の下に `## 疫学` `## 治療`）でも
  pandoc 6 枚 対 `slideSegments` 2 で一致しない

**目印（sentinel）方式**が答えになる。Lua で footer div を私用領域文字（U+E001 / U+E002）で
挟んだ文字列に置き換え、OOXML 後処理で slideN.xml を走査して見つける。

- U+E000 系の私用領域文字は pptx の `<a:t>`・docx の `<w:t>`・html に**生バイトのまま残る**。
  数値文字参照へのエスケープも欠落も起きない
- ただし**目印を本文の Para として置くのは駄目**。benchmark で 7 件中 3 件が隣のスライドへずれ、
  さらにデッキが 64 → 65 枚に増えた（落とし穴 5 の巻き添え）
- **目印を直前の見出しの inline 末尾へ巻き上げる**と、benchmark で 7/7 正解し、
  **スライド数もレイアウト内訳も 1 バイトも変わらない**（`{"Title Slide":1,"Section Header":7,"Title and Content":53,"Two Content":2,"Content with Caption":1}` が完全一致）。
  除去後は PUA 残留ゼロ・スキーマ検証 0 件
- 巻き上げ先は slide level 以下の見出しに限ること。`###` へ巻き上げると本文に落ちる
- 巻き上げた目印は**タイトルと同じ `<a:t>` に融合する**。除去はラン単位ではなく部分文字列で、
  1 スライドに複数あり得るのでループで行う

### 4. デッキ全体フッターは pandoc を一切通さずに済む

全 slideN.xml へテキストボックスを注入するだけ。番号の対応付けもフィルタも要らない。
`scripts/dump-footer.mjs` の実測:

```
帯の出どころ: テンプレートの ftr 帯
帯: x=457200 y=4767263 w=8229600 h=273844  (y=92.69% h=5.32% 幅 648.0pt)
スライド 6 枚 → 注入 5 枚（表紙は除外）
注入後のスライド数: 6  変化なし: true
@ooxml-tools/validate: 素の pandoc 出力 0 件 / フッター注入後 0 件 / 較正（子要素順を壊した版）1 件
```

benchmark（64 枚）でも 63 枚へ注入して検証 0 件。
表紙の判定は**レイアウト名ではなく `ctrTitle` プレースホルダの有無**で行う
（レイアウト名は配線盤の `applyAssignments` が書き換えるため）。

### 5. docx にはフッターの受け皿が無い

pptx とは事情が正反対だった。

- `word/footer*.xml` も `header*.xml` も**存在しない**。`w:sectPr` は文末に 1 個だけで、
  中身は `w:footnotePr` のみ（`w:footerReference` も `w:pgSz` も無い）
- 既定 reference.docx に `Footer` / `Header` スタイルは**無い**
- 本文（12pt）より小さい段落スタイルは `Abstract` / `AbstractTitle`（10pt）の **2 つだけ**。
  `FootnoteText` も `Caption` も `SourceCode` も sz 指定が無く 12pt を継承する
- したがって `::: {custom-style="X"}` だけでは**必ず本文と同じ 12pt になる**
  （照合に外れた custom-style は `basedOn=BodyText`・サイズ指定なしで自動生成される）
- **custom-style の照合キーは styleId ではなく表示名 `<w:name>`**（大文字小文字は無視）。
  styleId で書くと同じ styleId の 2 つ目の `w:style` が生成される
- reference-doc に仕込んだ `word/footer1.xml` は rels・`[Content_Types]`・`sectPr` の
  `footerReference` ごと**バイト一致で出力へ運ばれる**
- `RawBlock('openxml', …)` なら reference-doc もスタイル定義も要らずに `sz` / `color` / `jc` を直接書ける

意味論としては、デッキ全体の出典＝ページフッター（紙で配るハンドアウトのどのページを切り取っても
出典が付く）、スライド個別の注釈＝その場の小さい段落、という写像を採る。
Word のフッターはセクション単位で pandoc は `sectPr` を 1 個しか出さないので、
「スライドごとに違うフッター」を docx のページフッターにする経路は存在しない。

### 6. Web は CSS を数行足すだけ

既定 CSS に `.footer` 規則が無いことを確認済み。既存の `decorateWebHtml`（`</head>` 直前注入）は
pandoc の `<style>` より後ろに入るので後勝ちで効く。上書きすることになるのは
`p{margin:1em 0}` と `a{color:#1a1a1a}` / `a:visited` の 3 つだけ。

デッキ全体フッターは **`variables: {'include-after': …}`** で `</body>` 直前に 1 回だけ出す
（`metadata` 経由は HTML エスケープされて使えない。Lua で末尾に足す案は `section-divs` 下で
最後の section に閉じ込められる）。HTML は「1 枚ごとに同じ出典を刷る」媒体ではないため。

epub3 は `<div class="footer">` を警告ゼロで各章に通すが、epub 既定スタイルシートにも
`.footer` 規則は無い（ついでに `::: notes` も epub 本文に見えたまま残っている）。

### 7. プレビューは字サイズを実出力から読んでいない

- 装飾も文字サイズ設定も**パース結果を通らない**。`doConvert` は `applyDecorations` も
  `applyTextSizes` も呼ばず、プレビューはデザインデータから直接描いている（既存の二系統合成）
- **`parseRuns` は `sz` を読まない。** 実出力に `sz="1000"` と書いても、プレビューは
  placeholder 分類経由で `deck.bodySz[0]` = 24pt で描く。フッターの要件の中心を直撃する
- `<a:buNone/>` を書かずに注入すると行頭記号「•」が描かれる
- `SlideSurface` の `ShapeBox` は frame があれば placeholder を問わず描く。
  新しい種別は「無視される」のではなく**本文として誤描画される**
- 注入した段落も長押し可能になり、原稿に無い文字列を探して
  「原稿内で段落を特定できませんでした」に落ちる
- 後処理をプレビュー経路へ足すコスト: bytes → bytes だと **+23ms**（`zipSync` が 18ms で支配的）。
  `parsePptx` を展開済み zip 受け取りに変えれば **+0.7ms**

したがってプレビューは「**文言は実出力の目印から、体裁はテーマから**」で描く。
実出力の pptx を読み戻して見た目まで再現する経路は、`TextRun.sz` の追加・`parseRuns` の改修・
`parsePptx` の署名変更・長押し除外が連鎖するうえ、`schemeClr` を読まない時点で
忠実性の主張自体が崩れる。

### 8. 妥当性検証は較正とセットで

`@ooxml-tools/validate` 0.4.6 は `npm install --no-save` で入り、ECMA-376 の子要素順まで見る。
**default export が本体**（README の 2 引数シグネチャは古く、format 引数が要る）。

較正が要る: 素の pandoc 出力 0 件 / フッター注入後 0 件 / 子要素順をわざと壊した版 1 件。
較正ケースが無いと「検証器が何も見ていない」ことに気づけない
（実際 `xmldom` の整形式性チェックは較正して初めて信号ゼロと分かった）。

---

## 設計

### 三層のどこに何が住むか

```
content.md          front matter の footer:（デッキ全体）
                    ::: footer（スライドごと）              ← 文言。可搬・Git・他アプリ
テーマ              FooterStyle（揃え・pt・色・帯の比率）    ← 体裁。形式ごとにコンパイル
文書デザインデータ    （フッターは持たない）
```

文言はすべて .md にある。デザインデータには何も置かない — `.morphodesign` を捨てても出典は残る。

### 境界（`app/src/converter/types.ts`）に足すもの

```ts
/** テーマ配色の参照（DeckInfo.colors のキー）または直接指定 */
export interface ThemeColor {
  scheme?: 'dk1' | 'lt1' | 'accent1' | 'accent2' | 'accent3' | 'accent4' | 'accent5' | 'accent6';
  hex?: string;
  /** 参照色を地色へ寄せる度合い（%）。既定 0 */
  tintPct?: number;
}

/** 出典・注釈の体裁。文言も座標も持たない */
export interface FooterStyle {
  align: 'l' | 'ctr' | 'r';
  /** 字サイズ（pt）。未指定はテンプレートの ftr 既定（9pt）から導く */
  sizePt?: number;
  color?: ThemeColor;
  /** 帯の位置はスライド寸法に対する比率。テンプレートに ftr があればそちらを優先する */
  band?: { yPct: number; hPct: number; marginPct: number };
  /** 表紙にも出す。既定 false */
  onCover?: boolean;
  /** 1 枚に複数あるときの連結。既定 ' / ' */
  separator?: string;
}

export interface ConvertOptions {
  /** デッキ全体の既定文言（front matter 由来）と体裁 */
  footer?: { deckText?: string; style?: FooterStyle };
}

export interface SlideOutline {
  /** そのスライドに出る文言。体裁は含まない */
  footer?: TextRun[];
}
```

`DocBlock['style']` のユニオンに `'source'` を足す。

**pandoc 固有語彙の点検**: `ph` / `ftr` / `idx` / `custom-style` / `Lua` / 目印文字 /
`include-after` はいずれも境界に出ていない。すべて `bridgeHtml.ts` の内側で閉じる。
`'l' | 'ctr' | 'r'` は既存 `Paragraph.algn` と同じ語彙（OOXML 由来だが既に境界にある既存語）。
`FooterStyle` は EMU を持たないので、テンプレートを差し替えても自前 writer に替えても意味を保つ。
`ConvertOptions.footer` はプレビューと書き出しで**同じ値**を渡す — 両者の一致を構造的に保証する。

### 変換経路

```
原稿 ──splitFrontMatter──▶ footer: を metadata から取り出す
                            │
     ::: footer ──FOOTER_LUA（FORMAT 分岐）──┬─ pptx : 直前の見出しへ目印を巻き上げ
                                             ├─ docx : RawBlock('openxml') で小さい段落
                                             └─ html : <div class="footer"> のまま
                            │
     pandoc ────────────────┘
                            │
     pptx ──applyFooters──▶ 目印を切り出し、テキストボックスへ移す
                            デッキ既定を表紙以外の全スライドへ注入
```

`FOOTER_LUA` は `filters` の **`ruby.lua` より前**に置き、`pandoc.utils.stringify` ではなく
`blocks_to_inlines` を使う（`stringify` は `RawInline` を無警告で捨てるため、
`ruby.lua` が先に走った docx でフッター内のルビ・傍点が消える。pptx では再現しない）。
現状 `filters` の組み立ては 3 箇所で代入・3 箇所で concat になっていて順序を 1 箇所で決められないので、
`var filters = []` への小さなリファクタを先に入れる。

目印の切り出しは**タグを落として文字列にするのではなく、区間の生 XML をそのまま新しい
`<a:p>` へ移す**。文字列に潰すと `[NEJM](https://doi.org/…)` の `hlinkClick` が失われ、
`slide1.xml.rels` に孤児リレーションが残る（スキーマ検証は 0 件で通してしまう）。
太字・等幅・`<a:br/>` も同時に生き残る。文字列に潰すのはプレビューへ渡す表示用テキストだけ。

---

## 実装計画

現在 0.13.0。

### 0.14.0 — デッキ全体の出典（pptx とライブプレビュー）

記法ゼロ・Lua ゼロ・目印ゼロ・番号の対応付けゼロ。主用途の大半がここで満たされる。

1. **文書全体設定の導線を `contentIndexOf` から外す**（下記「既存の不具合 1」。これが先）
2. `types.ts` に `ThemeColor` / `FooterStyle` / `ConvertOptions.footer` / `SlideOutline.footer`
3. `src/design/footer.ts`: 既定値と検証（`designFile.ts` の sanitize 群に倣う）
4. `bridgeHtml.ts` に `applyFooters`（`applyDecorations` の隣）。`doExport` の pptx 経路へ配線
5. `splitFrontMatter` の `footer:` を `ConvertOptions.footer.deckText` へ。
   値が `|` `>` `|-` `>-` 単体のときと、キー直後にインデント継続行があるときは診断（design）を出す
6. UI: 文書全体設定に「デッキ全体の出典」1 行入力と、揃え・サイズ・表紙に出すかのノブ。
   入力は front matter の `footer:` 行**だけ**を追加 / 更新 / 削除する純関数で書き戻す
   （他の行・整形・コメントに触れない。無ければ文書先頭に作る）
7. プレビュー: `SlideOutline.footer` と `FooterStyle` から `SlideSurface` が描く（装飾と同じ流儀）

### 0.14.1 — 文書（docx）と Web

1. `WEB_CSS` に `.footer` 規則を追加。デッキ全体は `variables['include-after']`
2. docx: 出力後に `word/footer1.xml` + rels + `[Content_Types]` + `sectPr` の
   `footerReference` を後付け。文書プレビューは末尾に「ページフッター」として 1 回だけ出す
   （フロー表示にページは無いので毎ページ繰り返すのは嘘になる）

### 0.15.0 — スライドごとの注釈（記法の層）

1. `filters` 組み立てを 1 箇所へ寄せるリファクタ
2. `FOOTER_LUA`（FORMAT 分岐必須）。`notes` クラスの Div の内側は走査から除外する
3. `sanitizeForXml` に U+E001 / U+E002 の 1 文字 → 1 文字（空白）置換
4. `applyFooters` に目印の切り出しと生 XML 移送。タイトル無しの続きスライドへ伝播

### 0.15.1 — 縁のケース（実機で使ってから決める）

`***` 領域、最初の見出しより前の footer、1 枚に複数、長い出典の 2 行帯、
`.morphodesign` との関係、スライドショーと発表者ビューへの配線。

---

## 検査（`scripts/check-footer.mjs` 新設）

pptx だけを見るテストでは絶対に捕まらないものが多いので、3 形式すべてを見る。

| 検査 | 捕まえるもの |
|---|---|
| footer 入りと対照でスライド数とレイアウト内訳が完全一致 | 巻き上げの失敗、落とし穴 5 の巻き添え |
| `@ooxml-tools/validate` 0 件 ＋ **較正ケース 1 件以上** | 子要素順の崩れ。較正が無いと検証器の沈黙に気づけない |
| docx の `word/document.xml` に U+E001 / U+E002 が 0 個 | FORMAT ガード落ち |
| html に U+E001 / U+E002 が 0 個 | 同上（プレビュー経路にも入る） |
| `word/document.xml` に `<p:sp` が 0 個 | pptx の raw XML が docx へ漏れる事故 |
| リンク付き footer の移送後もスライドが `rId` を参照し続ける | 孤児リレーションと DOI リンクの消失 |
| `::: notes` の中の footer がスライド本体に出ず notesSlide に残る | 発表者ノートの情報漏洩 |
| `filters` 配列で `footer.lua` の添字が `ruby.lua` より小さい／`stripHtmlComments: true` でも残る | 配線の退行 |
| `footer: |` `footer: >` 複数行 で診断が出る | front matter の無警告破損 |
| `sanitizeForXml` が目印文字を落とし、かつ**長さを保つ** | 本文オフセット（カーソル → スライド対応）の前提 |

---

## CLAUDE.md へ追記すべき落とし穴

1. **落とし穴 5 は pandoc 3.10 でも未解消。** 「3.9 で解消されている可能性がある。要確認」と
   書いてあるが、pandoc-wasm 1.1.0 で健在だった。表の直後に段落を 1 つ置くだけでスライドが 1 枚増える。
   落とし穴 6（脚注が末尾の Notes スライドに集約）も同様に健在
2. **`::: footer` のようなクラスは pptx / docx の出力に痕跡を残さない。**
   見出し属性 `{footer="…"}` は両形式で無警告で消える
3. **pandoc の pptx ライターは raw openxml を素通しする。** `RawBlock` は spTree 直下、
   `RawInline` は `<a:p>` の run。**FORMAT ガードを外すと docx の `word/document.xml` へ
   pptx の `<p:sp>` が無警告で注入される**（html は INFO 警告で捨てるだけ）
4. **`custom-style` の照合キーは styleId ではなく表示名 `<w:name>`。**
   styleId で書くと同じ styleId の 2 つ目の `w:style` が生成される
5. **未知の metadata キーは `docProps/custom.xml` に落ちる。** 見えないが消えてもいない
6. **`pandoc.utils.stringify` は `RawInline` を空文字として捨てる。**
   `ruby.lua` の後にフィルタを置くと docx でルビ・傍点が無警告で消える。pptx では再現しない
7. **`PANDOC_WRITER_OPTIONS.slide_level` は nil。** Lua から実効スライドレベルを読めない

---

## この検証で見つかった既存の不具合（フッターとは別）

フッター機能とは独立に、今日すでに壊れているものが 4 件見つかった。**未修正。**

1. **文書全体の設定（文字サイズ・テンプレート配線盤）が典型的な原稿で開けない。**
   `DecorSheet` の唯一の入口は `EditorScreen.tsx` の `handleEditDecor` → `contentIndexOf` で、
   `slideCount - titleOffset !== slideSegments(body).length` のとき Alert を出して null を返す。
   `#` の下に `##` を置く普通の階層構造 — 抄読会スライドそのものの形 — では必ず発火する
   （15 行の原稿で 6 対 2、benchmark で 63 対 8）。**フッターの設定 UI をここに置くと同じ壁に当たる**
2. **`designFile.ts` の `sanitizeDecorText` が 3 つ同時に壊れている。**
   U+FFFE を素通しする（実測: 注入した pptx がスキーマ検証 1 件になる）、
   XML 1.0 で合法な U+007F を落とす、20 字で切る。
   `frontMatter.ts` の `XML_INVALID_RE` を共通定数に切り出して共有するのが正しい
3. **`titleOffset = metadata.title ? 1 : 0` が誤り。** 表紙スライドは `author` / `subtitle` / `date`
   のどれか単独でも生える（実測: いずれも 3 枚）。title だけを見ているので 1 枚ずれる
4. **表紙の日付が 24pt で描かれている。** `dt` は `isTitle` / `isCover` / `isSub` の
   どれにも当たらないので `deck.bodySz[0]` = 24pt になるが、枠の高さは 21.6pt。
   `slide1.xml` の `dt` の rPr に `sz` は無いので、実出力を読むだけでは直らない —
   `DeckInfo` に `ftr` / `dt` / `sldNum` の既定サイズ（実測でいずれも 900）を持たせる必要がある

---

## リスクと未検証

### 実機を一度も見ていない

**すべて Node 上の pandoc-wasm 1.1.0 での実測。** 担保はスキーマ検証 0 件までで、
CLAUDE.md 落とし穴 9 のとおり「Open XML SDK を通っても PowerPoint が拒む」事例が
この製品には実在する。ship 前に必ず 1 回、実機で開いて見ること。

- PowerPoint / Word / Keynote / iPad の PowerPoint での実描画
- iPad での変換時間の増分（Node では pandoc 変換が中央値 560ms で、iPad 実測 47ms の 12 倍。
  fflate が同じ比率でスケールするかは分からない。+23ms が iPad で何 ms になるかは言えない）
- LibreOffice でも確認できていない（このコンテナの soffice には Impress フィルタが無く、
  素の pandoc 出力すら開けない）

### 設計上まだ決まっていないこと

- **`***`（hr）領域に表があると、目印の巻き上げがどちらの戦略でも無警告で壊れる。**
  「hr 直後へ Para 挿入」ではレイアウト内訳が変わり（`Title and Content` → `Content with Caption`）、
  「その場に残す」ではスライドが 1 枚増える。hr 領域が本文・リスト・コードだけなら無害。
  当面は hr 領域の個別フッターを非対応と明言して lint で知らせるのが安全
- **`::: footer` の中の画像は無警告で消え、脚注はデッキを 1 枚増やす。** 診断で知らせる
- **フッターの帯と装飾プリセット「下の帯」が既定同士で 75% 重なる。**
  `bandBottom` は y=94% h=6%（4834890..5143500）、ftr 帯は 4767263..5041107。
  z 順は装飾 → title → body → footer でフッターが前面なので、
  accent1 の濃い帯の上に灰色 9pt が乗る。既定値を確定する前に実機で 1 回見ること
- **表紙の `dt` とフッターが同じ帯にいる。** `onCover` を既定オフにする理由の一つ
- 1 枚に `::: footer` が複数あるときの既定（連結か、最後の 1 つか）
- 空の `::: footer` の意味（そのスライドだけ抑止、と読ませる案がある）
- **縦書き。** CLAUDE.md が差別化として挙げているのに `FooterStyle` の語彙は横書き前提
- デッキ全体フッターは脚注が生む自動生成の "Notes" スライドにも載る
- epub は `.footer` の CSS も `drop-notes` も届いていない（フッター以前の既存の穴）
