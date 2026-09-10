# テーマ層（第2層）に向けた組版要件の一覧

`roadmap-pptx.md` の第2層（テーマ）を設計する前に、「日本語の書き手が要るもの」を
出力形式ごとに **pandoc（3.10・wasm）で届くか** で仕分ける。テーマのスキーマを
段組みの列比だけで切らないための材料（`development-plan-2026-09.md` 3-E）。

各行の「今」は実装済みの経路（`app/src/converter/bridge/main.mjs` の Lua と OOXML 後処理、
CLAUDE.md の落とし穴）から引いた事実。「経路」は次の 3 つのどれで吸収するか:

| 記号 | 経路 | 意味 |
|---|---|---|
| **T** | テーマ層で吸収 | reference-doc（レイアウト枠・スタイル）/ Lua（意味クラス → 属性）/ OOXML 後処理。pandoc を差し替えなくてよい |
| **W** | writer の差し替えが要る | pandoc の writer が構造を落とす・順序を変える・出力の表現力が上限になる。自前 writer（MIT）に替えて初めて届く |
| **E** | 第 2 のエンジン | pandoc の外に別のエンジン（Typst の WASM 等）を足す |

「未検証」は実測していない項目。実装前に 1 回ずつ実験で確定させる。

---

## 1. 文字レベル（インライン）

| 要件 | pptx | docx | html | 経路 | 今 |
|---|---|---|---|---|---|
| ルビ（親文字＋よみ） | **近似**（親文字（よみ）） | 本物（`w:ruby`） | 本物（`<ruby>`） | pptx は **W**（`a:r` にルビの概念が無い。OOXML 自体が持たない） | `ruby.lua`。青空文庫式 ｜親《よみ》 と でんでん式 {親\|よみ} |
| 傍点（圏点） | **近似**（太字） | 本物（`w:em`） | 本物（`text-emphasis`） | pptx は **T**（後処理で親文字の上に `•` を置く図形を注入する案。未検証） | 同上 |
| 圏点の種類（ゴマ・白ゴマ・蛇の目） | — | `w:em w:val=dot/comma/circle` | `text-emphasis-style` | **T**（Lua の属性） | 未実装。`《《》》` は 1 種だけ |
| ルビの揃え（中付き・肩付き・均等） | — | `w:rubyAlign` | `ruby-align` | **T** | `distributeSpace` 固定 |
| 縦中横（縦書き内の 2 桁数字を横に） | 未検証 | `w:eastAsianLayout w:combine` | `text-combine-upright` | **T**（Lua）。縦書きとセット | 未実装 |
| 強調（`**`）の見た目（太字か・ゴシックか） | `b="1"` | `w:b` | `<strong>` | **T**（reference-doc のスタイル / CSS） | pandoc 既定 |
| 意味クラス（`[語]{.accent}` → テーマ色） | Lua で `a:rPr` に色 | `custom-style`（表示名照合・落とし穴 15） | class | **T** | **0.19.0**（`accent` / `muted` / `warn`。下の「実装」の節）。インスペクタ v1（UI からの挿入）は未 |

## 2. 段落・ブロック

| 要件 | pptx | docx | html | 経路 | 今 |
|---|---|---|---|---|---|
| 字下げ（段落頭 1 字） | `a:pPr indent` | `w:ind w:firstLineChars` | `text-indent: 1em` | **T** | 未実装 |
| 禁則（行頭の 」。、を出さない） | PowerPoint 側 | Word 側（`w:kinsoku`） | ブラウザ側 | **T**（reference-doc の設定・CSS `line-break`）。**アプリのプレビューは近似**（実寸描画の折り返しは自前） | 未実装。プレビューの折り返しに禁則が無い |
| 行内の折り返しで半角スペースが混入しない | `+east_asian_line_breaks` | 同左 | 同左 | 済 | READER に固定（実測） |
| 行頭記号のぶら下げ（箇条書き） | レイアウトの `lstStyle` | スタイル | CSS | **T** | 0.14 でレイアウト固有の `lstStyle` を読む |
| 段組み（2 列）の列比 | **レイアウト枠が決める。原稿の `width=` は無視**（落とし穴 12） | **痕跡ゼロ**（落とし穴 12） | `width` が効く | pptx は **T**（Two Content の枠を reference-doc で動かす）。docx は **W**（`w:cols` を出す writer が無い）か **T**（後処理で `w:sectPr` を差す。未検証） | `+++` の入力と展開（0.15）。**列比は 0.19.0**（出力 pptx のレイアウト枠を後処理で書き換える第三の経路。docx は流す） |
| 段組みの 3 列以上 | **消える**（落とし穴 11） | — | 出る | **W** | 診断で止める（0.15） |
| 列の先頭が画像・表 → 後続が消える | **消える**（落とし穴 13） | — | — | **W** | 診断で止める（0.15）。順序を変えてはいけない（三層分離） |
| 表の後ろの本文がスライドを割る | **割れる**（落とし穴 5） | — | — | **W** | フッターの巻き上げで回避（`footer-design.md`） |
| 脚注 | 末尾 "Notes" スライドに集約（落とし穴 6） | `footnotes.xml` | 本物 | pptx は **W** | 文書プレビューは実装済み |
| 画像の大きさ・位置 | **原稿の指定は無視**（落とし穴 12） | 効く | 効く | pptx は **T**（後処理で `<p:pic>` の xfrm を書く。v0.21 の設計） | 未実装 |
| Content with Caption のタイトルが小さくなる | 落とし穴 20 | — | — | **T**（`applyTitleFitZip`・帯モード） | 0.17.2 / 0.17.3 で済 |

## 3. ページ・スライド単位

| 要件 | pptx | docx | html | 経路 | 今 |
|---|---|---|---|---|---|
| 縦書き（本文） | `a:bodyPr vert="eaVert"`（**未検証**: pandoc の出力へ後処理で入れて PowerPoint が縦に組むか） | `w:textDirection w:val="tbRlV"` を `w:sectPr` に（**未検証**） | `writing-mode: vertical-rl` | **T**（後処理 / reference-doc / CSS）。**プレビューの実寸描画は自前なので縦組みの描画を書く必要がある**（RN の `Text` は縦書き不可 → 1 字ずつ置く） | 未実装。テーマ層の席 |
| 縦書きでの句読点・長音の向き | フォント依存 | フォント依存 | `text-orientation` | **T**（縦書き用グリフを持つフォントの指定） | 未実装 |
| 段落先頭の見出しに帯・アクセント線 | 装飾（第3層）または後処理 | `w:pBdr` | CSS | **T**（セレクタ規則「h1 下にアクセント線」） | 装飾プリセットとして実装済み。**テーマの規則としては未実装** |
| フッター（出典・注釈） | 後処理で `<p:sp>` | `footer1.xml` | CSS | 済 | 0.17.0 |
| ページ番号 | レイアウトの `sldNum` 枠 | `w:fldSimple PAGE` | — | **T**（reference-doc） | pandoc 既定に従う |
| レイアウトの和名 → 英語名 | 落とし穴 4 | — | — | **T**（配線盤） | 0.11.0 |
| 表紙・章扉の見た目 | Title Slide / Section Header のレイアウト | 見出しスタイル | CSS | **T** | 文字サイズ設定のみ |

## 4. 形式そのもの

| 要件 | 経路 | 今 |
|---|---|---|
| PDF | **E**。pandoc.wasm は PDF エンジンをサブプロセスで起動するため **原理的に出せない**（`foundation-2026-09.md` D。`runInteractiveProcess: unsupported operation` を実測）。`to: 'typst'` は動くので、Typst の WASM ビルドを第 2 のエンジンとして同じ WebView に載せる。CJK フォントを WASM FS に置く | 未着手。v0.20 以降 |
| epub | pandoc の `to: 'epub'`（**未検証**: wasm で zip を組めるか。docx / pptx が組めているので原理的には通る見込み） | 未着手 |
| 縦書き epub（`page-progression-direction: rtl`・`writing-mode`） | **T**（CSS と OPF のメタデータ。pandoc の epub writer が `page-progression-direction` を出せるかは**未検証**） | 未着手 |

---

## 読み方

- **W が付くのは pptx に集中している。** pptx writer は「表現力が OOXML ではなく writer の構造判断で決まる」
  （段組みの 2 列上限・列頭の画像・表のスライド分割・脚注の集約）。これらは reference-doc でも
  Lua でも届かない。**自作 writer への切り替えトリガーは、この W の行のどれかを製品として
  外せなくなったとき**（`development-plan-2026-09.md` 2 の「切り替えトリガー」）
- **docx / html は T でほぼ届く。** 書籍・Web の日本語組版は pandoc の上で完結できる見込み
- **縦書きは 3 形式とも T** だが、**アプリのプレビュー（自前の実寸描画）が最大の実装量**。
  変換器ではなく描画側の仕事なので、テーマのスキーマに `writingMode` の席を空けるだけでよく、
  描画の実装は v0.19 の後半以降に回せる
- **PDF だけが E。** テーマ層の設計とは独立に、第 2 エンジンの同梱として `Converter` の中に閉じる

## テーマのスキーマに席が要るもの（この一覧から）

`roadmap-pptx.md` の「CSS 風の語彙の YAML」に、少なくとも次の席を置く:

| 席 | 値の例 | 消費先 |
|---|---|---|
| `writingMode` | `horizontal` / `vertical` | 3 形式 + プレビュー描画 |
| `fonts.{heading,body,ruby}` | フォント名（縦書きグリフの有無を含む） | reference-doc / CSS |
| `emphasis.dotStyle` | `dot` / `comma` / `circle` | `w:em` / `text-emphasis-style` |
| `ruby.align` | `center` / `start` / `distribute` | `w:rubyAlign` / `ruby-align` |
| `paragraph.firstLineIndent` | `1em` | `w:ind` / `text-indent` / `a:pPr` |
| `columns.ratio` | `[1, 1]` / `[2, 3]` | Two Content の枠（pptx）/ `width`（html） |
| `rules[]`（セレクタ規則） | `{ match: 'h1', decor: 'accent-line' }` | 装飾プリセット（第3層）をテーマ側から生成 |
| `classes.{name}` | `{ color: 'accent1', weight: 'bold' }` | Lua（`a:rPr` / `custom-style` / class） |

未検証の行（縦書きの OOXML 後処理・縦中横・docx の `w:cols`・epub）は、
v0.19 の着手時に 1 回ずつ Node で実験して確定させる。

---

## 実装（0.19.0）

上の一覧のうち、**T の中で今すぐ届く 2 つ**（列比・意味クラス）と、テーマの置き場を作った。
設計の判断と実測は次のとおり（すべて `app/scripts/check-theme.mjs` が常時検証）。

| 項目 | 決めたこと | 根拠 |
|---|---|---|
| テーマの置き場 | `app/src/theme/theme.ts`。組み込みテーマ（`plain` 1:1 / `focus` 2:1）はコードに持つ。文書側の選択と列比の上書きは `DesignData.theme`（第3層・`.morphodesign` に入る） | 組み込みテーマはテーマファイルのみ（reference-doc を同梱しない） |
| 列比の pptx 経路 | **出力 pptx の `slideLayout*.xml`（Two Content / Comparison）の列枠を後処理で書き換える**（`applyColumnRatioZip`）。`columns-and-images.md` が未検証としていた「第三の経路」 | 実測: pandoc 既定テンプレートで applied=2、左端・右端・段間は不変、幅の比が指定どおり。スライド側は空の `<p:spPr/>` でレイアウトを継承するので枠だけで本文が付いてくる。reference-doc が無くても効き、変換は 1 回のまま |
| 適用点 | `doConvert` と `doExport` の両方、**他の後処理より先**（解析前） | プレビューが書き出しと同じ枠を読む（columns-and-images.md「適用順を 1 箇所で決める」） |
| 枠の無いテンプレート | 触らず `skipped` を返し、情報診断「列比を適用できませんでした」 | 自作テンプレートの Two Content に `a:xfrm` が無いことがある |
| 意味クラスの pptx | Lua で `Span` を RawInline openxml のラン（`a:solidFill`/`a:schemeClr` + `b="1"`）へ | 落とし穴 14（pptx ライターは raw openxml を素通し）。schemeClr なのでテンプレートの配色に追従する。プレビューは `parseRuns` が schemeClr を拾い `deck.colors` で解決 |
| 意味クラスの docx | `w:color w:val="hex" w:themeColor="accent1"` | Word は themeColor があればテーマに追従、無ければ hex。文書プレビューは hex を読む |
| 意味クラスの html | Span はそのまま（クラスが残る）。テーマ CSS を `WEB_CSS` の**後**に注入 | cascade でテーマを勝たせる（columns-and-images.md の未決事項を決めた） |
| tint 付きの参照（muted） | pptx でも解決済みの srgbClr で出す | ランの `a:tint` は PowerPoint と自前描画で差が出る |
| Span の中身 | `pandoc.utils.stringify` を使わず自前で歩く。RawInline（ルビ・傍点）は素通し | 落とし穴 16。実測: docx でクラスの中のルビが `w:ruby` のまま残る |
| フィルタの順 | ruby.lua → theme.lua | pptx ではルビが Str に落ちてからクラスのランに入る |
| 再変換の引き金 | テーマの変更は文字サイズ・帯モードと同じ効果（300 ms 後） | `usePreviewSync` |

**やっていないこと（一覧の残り）:** 1 枚だけの列比の上書き（slide 経路）、docx の「並置を保つ」、
縦書き、字下げ・禁則・ルビの揃え・圏点の種類、セレクタ規則（`rules[]`）、テーマファイルの
書き出し・読み込み・編集 UI（v0.22）。スキーマの席（`writingMode`）は型にだけある。
**実機未検証**（3-C の周回に含める）: 装飾パネルの「テーマ」で列比を替えて 2 段のスライドの
幅が変わること／`[語]{.accent}` が PowerPoint・Word・ブラウザで色付きになること。
