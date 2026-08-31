# 現在地と残りの計画（2026-08-31 / v0.13.0 時点）

企画検証から 13 版を重ねた時点で、**何ができていて・何が壊れていて・何が残っているか**を
一枚に集めた。ロードマップ（`roadmap-pptx.md`）が「これから何を作るか」、
`findings.md` が「pandoc をどう扱うか」を持つのに対し、この文書は**現在地**を持つ。

この文書の記述は、実際にコードを読むか pandoc.wasm 1.1.0 を回して確かめたものだけを載せている。
確かめていないものは「未検証」と書く。

---

## 1. 現在地 — 0.13.0 で動くもの

| 領域 | できること | 実装 |
|---|---|---|
| 編集 | 複数文書・アプリ内保存・外部ファイルのその場編集（open in place）・bookmark 自動再接続・競合時の行 Diff | `store/documents.ts`, `modules/doc-bookmark` |
| 変換 | 不可視 WebView の pandoc.wasm で pptx / docx / html を生成。単一 FIFO・最新だけ残すキュー | `converter/bridgeHtml.ts`, `converter/latestOnly.ts` |
| プレビュー | **スライド / 文書 / Web** の3形式。実出力（pptx / docx / html）を解析して実寸描画 | `ui/SlideSurface.tsx`, `ui/DocumentSurface.tsx` |
| 書き戻し | 発表者ノート編集、改行位置編集（語 / 字の粒度） | `preview/notesEdit.ts`, `preview/lineBreakEdit.ts` |
| 飾る | 装飾プリセット・直接ドラッグ / リサイズ・グループ・番号バッジ・文字サイズ（表紙 / 見出し / 本文 / 表紙サブタイトル） | `design/*`, `ui/DecorSheet.tsx`, `ui/DecorEditLayer.tsx` |
| テンプレート | 自作 .pptx の取り込み、和名レイアウトの自動結線と配線盤 UI（原本は書き換えない） | `design/template.ts` |
| 日本語 | ルビ `{漢字|かんじ}` と傍点 `《《ここ》》`（docx は本物の w:ruby / 圏点、Web は `<ruby>`、pptx は近似） | `bridgeHtml.ts` の `RUBY_LUA` |
| 画像 | 取り込み → `![](名前)` 挿入 → すべての形式へ埋め込み。見つからない参照は文字に置換して変換を生かす | `store/assets.ts`, `wireAssets` |
| 書き出し | pptx / docx / md / Obsidian へ送る | `ui/ExportMenu.tsx`, `store/exportShare.ts` |
| 検査 | `npm run check` に 12 本（型・純関数・本物の pandoc を回す統合検査 `check-deck`） | `app/scripts/check-*.mjs` |
| 配布 | GitHub Actions で署名なし ipa をビルドし Releases へ公開（AltStore / SideStore で再署名） | `.github/workflows/build-ipa.yml` |

---

## 2. ドキュメントが実装に追いついていない箇所

外側（試用者が読むもの）ほど古い。**次に触るときに直す。**

| 場所 | 何が古いか |
|---|---|
| `app/DEVELOPMENT.md`「まだやっていないこと」 | テンプレート配線盤（0.11.0）と文書プレビュー（0.10.0）が**実装済みなのに未着手として残っている** |
| `app/DEVELOPMENT.md`「構成」ツリー | `src/design/` `src/text/` と `DocumentSurface` / `DecorSheet` / `DecorEditLayer` / `ConflictSheet` / `store/designs.ts` / `store/assets.ts` が載っていない |
| `app/README.md` | open in place を2箇所で「未対応」と書いている（0.8.0 で実装・実機確認済み）。テンプレート機能の記述が無い。プレビューを「スライド / Web」の2つと書いている（実際は3つ） |
| `README.md`（トップ） | 同じくプレビューが2つのまま |
| `notes/preview-formats.md` | `PreviewFormat` のコード断片が `'slides' \| 'web'` のまま（実装は `'doc'` を含む） |
| `notes/roadmap-pptx.md` / `README.md` | 日本語記法を「青空文庫式（｜親文字《ルビ》）」と書いているが、実装はでんでんマークダウン式（`{漢字|かんじ}` / `《《ここ》》`）。**どちらを採るかの判断ごと残っている** |
| `app/DEVELOPMENT.md`「逃げ道」 | 案内している `sdk-54` ブランチが origin に存在しない |
| `app/DEVELOPMENT.md` 冒頭の実測値 | v0.1 時点のまま（起動 595 ms / 4枚 76 ms）。以後7版ぶん未再計測 |

---

## 3. いま抱えている課題

### 3.1 実測で確定した不具合（コードを叩いて再現した）

| # | 症状 | 原因 | 場所 |
|---|---|---|---|
| A | **2段組みの右の段だけ縦中央揃えになる**（左は上揃え。実出力と食い違う） | `findInherited` が type 一致で見つからないと **idx だけで**照合するため、右の段（body idx=2）が pandoc 既定マスターの日付枠 `<p:ph idx="2" type="dt">` の `anchor="ctr"` を拾う | `converter/bridgeHtml.ts:414-431`, `:585-591` |
| B | **改行位置編集が `::: columns` ブロックを1行に潰す** | `locateEditable` の候補分類に fenced div が無く、連続する非空行を1段落として吸う。`rebuildBlock` がそれを1行へ畳む。実測: ブロック全体が `"::: colu\\\nmns ::: column左…::: :::"` になる | `preview/lineBreakEdit.ts:150`, `:197-211` |
| C | 同じ照合順により、**座標を持たないレイアウトのテンプレートでは左右の段が同じ枠に重なる**（type='body' 一致が idx より先に返る） | A と同根 | `converter/bridgeHtml.ts:414-423` |
| D | `::: notes` の**中に** fenced div を書くと、内側の `:::` で切れて途中までしか読めない | 閉じ判定が `:::` の種類を見ない | `preview/notesEdit.ts:9` |
| E | **画像の重ね順がプレビューと実出力で逆**。実出力の spTree は `sp → sp → pic` で画像が最前面だが、プレビューは 装飾 → **画像** → 図形 の順に描くので画像が本文の背面になる | 今は pandoc が画像を本文枠の外に置くので誰も気づいていない。画像を本文に重ねられるようにした瞬間に露見する | `ui/SlideSurface.tsx:194-215` |
| F | **警告の表示テキストが JSON 生のまま出る**。`warnText` は `w.message \|\| w.msg` を見るが、pandoc-wasm 1.1.0 の警告オブジェクトのキーは `type / verbosity / contents / pretty` で、どちらも存在しない | `pretty` を使えば直る | `converter/bridgeHtml.ts:610-613` |
| G | **同じラベルの警告は最初の1件しか本文が残らない**（`count` だけ増える）。画像を含む原稿では先に来る `LoadedResource`（正常ログ）が「その他の警告」のバケットを占有し、**3段目が捨てられた事実が画面から消える** | 分類規則が3件しかなく `BlockNotRendered` の規則が無いことと重なっている | `converter/bridgeHtml.ts:153-161`, `:622-634` |

A と C は**多段組を製品機能にする前に直す**。B は多段組を入れた瞬間にデータを壊すので同時に直す。
E は画像配置を触れるようにする前に直す。F と G は §3.2 のデータロスを使い手に見せるための前提なので、
**機能を足すより先に直す**（`pretty` を使い、規則を1つ足すだけで大半が解決する）。

### 3.1.1 多段組の本当の壁は座標ではなく字サイズ

Two Content の列枠は 4038600 × 3394472 EMU ＝ **318 × 267.3pt**。
左右インセット 7.2pt を引くと本文に使える幅は 303.6pt。
pandoc 既定の本文は 24pt、プレビューの行送りは `fontSize × 1.25` なので、
**1段に入るのは全角 12.6 文字 × 8.9 行 ≒ 112 文字**しかない。

段組みを実用にするには本文を 14〜16pt へ落とす必要があるが、
`TextSizes` は**文書全体のスカラー**（`design/textSizes.ts`）でスライド単位の上書きが無く、
`normAutofit`（PowerPoint の自動縮小）はパーサにも描画にも入口が無い。
**記法だけ足すと「2段にしたら文字が溢れて、直す手段が無い」になる。**

あわせて、プレビューの折り返しは RN の `Text` 任せで PowerPoint のフォントメトリクスと一致しない
（`ui/SlideSurface.tsx:24-27` に明記）。この誤差は枠幅に対する相対量なので、
**枠が半分になる段組みでは相対誤差が倍になる**。
「左右の段の下端が揃っているか」という段組み固有の判断がプレビューでできなくなる。

### 3.2 pandoc 由来の無警告データロス（今回の実測で新たに判明）

`CLAUDE.md` の「落とし穴」に追記済み。いずれも **warnings に出ないか INFO 止まり**で、
使い手からは「書いたのに消えた」としか見えない。

- 文中のインライン画像 / 箇条書きの項目内の画像は消える
- 同じ段落に画像を2枚並べると片方が消える
- 段の中は「本文 → 画像1枚」までしか残らず、**画像より後ろの本文が消える**
- `.columns` の3段目以降は捨てられる（INFO の `BlockNotRendered` のみ）
- キャプション付き画像を2つ書くと、スライドが分割されず**同じ位置に重なる**
- 画像 / 表 / 段組みの前後に本文があると**タイトルなしのスライドに分割される**

最後の1点は既知の落とし穴5と同じ形で、`EditorScreen.tsx:1031-1047` の
`contentIndexOf`（スライド数と原稿の区間数の一致チェック）に引っかかり、
**ノート編集・改行編集・装飾編集がまとめて Alert で止まる**。
つまりデータロスだけでなく、編集機能全体の可用性の問題でもある。

### 3.3 既知の落とし穴のうち、今回確認できたもの

| 落とし穴 | 結論 |
|---|---|
| 5. 表の後ろにコンテンツがあるとスライドが分割される | **pandoc.wasm 1.1.0 でも未解消**（実測）。「3.9 で直っているかも」の保留を解除してよい |
| 6. 脚注が末尾の "Notes" スライドに集約される | **未解消**（実測）。無警告のデータロスなので lint 対象 |
| 「reference-doc は wasm でも効くか」 | 効く（`check-template.mjs` が常時検証） |
| 「`to: 'pdf'` は wasm で可能か」（`preview-formats.md` の宿題） | **不可能**。出力ファイルが1つも生成されず、`stderr` に `createDirectory: does not exist` のみ。`warnings` は空なので**呼び出し側からは無言の失敗に見える**。仮に一時ディレクトリを用意しても、その先に「PDF エンジンを別プロセスで起動する」原理的な壁がある |

### 3.4 検査の穴

- **`npm run check` が CI で一度も回っていない。** ワークフローは `build-ipa.yml` の1本だけで、
  型検査も 12 本の検査もステップに無い。CI が保証しているのは「ipa がビルドできる」ことだけ
- UI 全 4,874 行に振る舞い検査が無い（型検査のみ）
- `SlideOutline.layout` を assert する検査がゼロ。**レイアウト選択の回帰が無検出**
- 段組み・表を含むデッキ・脚注を含むデッキの検査ケースが無い（3.1 の A も 3.2 も既存検査を素通りする）
- ブリッジの変換パス（`doConvert` / `doExport` / `wireXxx` / `READER` 定数）は検査を通らない。
  `check-deck` は pandoc を外側から直接呼び、オプションを手で組み直している
- `fixtures/pptx-benchmark.md` はどの検査からも参照されていない（基準出力との回帰比較が無い）

### 3.5 実機で確かめていないこと

- **0.9.0 の bookmark 自動再接続**（完全終了 → 再起動 → 外部ファイルの編集が降りてくるか）
- Intl.Segmenter の Hermes 対応（改行編集の文節境界。フォールバックがあるのでどちらが動いているか不明）
- 0.1.0 以降の性能（起動時間・ヒープ・変換時間）
- pandoc.wasm 55.9MB の**再取得コスト**。ローカルに永続化していないので、
  OS がプロセスを落とすと取り直しになる。オフライン起動は不可能

### 3.6 出荷まわりの積み残し

| 項目 | 状況 |
|---|---|
| **`ios.infoPlist` が空** | `app.json` の `ios` は `supportsTablet` と `bundleIdentifier` だけ。`LSSupportsOpeningDocumentsInPlace` / `UIFileSharingEnabled` / `CFBundleDocumentTypes` がリポジトリ全体で0件。**open in place を実装したのに、Files.app や他アプリから「Morpho で開く」導線が存在しない**。`ios/` は prebuild 生成で .gitignore なので、書ける場所は `app.json` しかない |
| MIT の成立根拠 | `CLAUDE.md` は「pandoc 由来のコードがリポジトリに一切含まれない」ことを根拠にしているが、`pandoc-wasm`（GPL-2.0-or-later・55.9MB）は既に `app/package.json` の devDependency で、CI の `npm ci` でも入る。**配布物には入らないので結論は変わらないが、根拠の書き方は精密にしておく** |
| Releases のタグ運用 | タグは `app.json` の version から作られ、既存タグには `--clobber` で上書きする。**version を上げ忘れた push は同じ v0.13.0 の ipa を黙って差し替える** |
| `template.ts` のレイアウト名解析 | `/<p:cSld name="([^"]*)"/` 固定で、`name` が最初の属性であることを前提にしている。`name` が無いレイアウトは捨てる。`docs/index.html` の同じ機能は属性順に非依存で、無ければ挿入する（**検証ハーネスのほうが実装が強い**） |
| 書き出しの一時ファイル | `exportShare` は `cacheDirectory` に書いて共有シートへ渡すが、渡したあと消さない。書き出すたびに積み上がる |

---

## 4. 残っている計画

### 4.1 ロードマップに書かれていて未着手のもの

| 項目 | 状況 |
|---|---|
| **テーマ層（三層分離の第2層）** | 未着手。共有・Git 可能なスタイル定義ファイルが無く、実体は「文書ごとの pptx テンプレート＋アプリ内 JSON」。段組みの幅比率は**テーマ層で解けることが実測で分かった**（§5）ので、ここが次の背骨になる |
| **装飾のアンカー**（見出しへの `{#s-xxxx}` 自動付与、または見出しハッシュ照合） | 未着手。装飾はスライドの序数（`contentIndex`）に結ばれているため、スライドの分割・挿入・並べ替えで装飾が別スライドへ移る |
| **インスペクタ v1**（要素タップ → テーマ配色 → `[テキスト]{.accent}` の意味クラス挿入） | 未着手。roadmap v0.4 で唯一の積み残し |
| **表のプレビュー描画**（`<p:graphicFrame>` の解析） | 未着手。解析器が知っているのは `<p:sp>` と `<p:pic>` の2つだけ |
| **カーソル同期の「見出し区間」への一般化** | 未着手。文書・Web プレビューは同期なし |
| **pandoc.wasm の同梱** | 未着手（今は unpkg から取得）。**GPL の判断とセット**。オフライン初回起動が不可能なのもこれが理由 |
| 縦書き | 未着手 |
| ハードウェアキーボードのショートカット | 未着手（`CLAUDE.md`「妥協できない点」に挙がっている） |
| 画像のフォルダ単位連携（Obsidian 保管庫の隣の画像） | 未着手（iOS のアクセス権がファイル単位のため） |

### 4.2 いま安く取れるカード

- **epub 書き出し。** `to: 'epub'` は pandoc.wasm でそのまま通る（実測）。
  画像も `EPUB/media/` に同梱され、nav.xhtml・stylesheet・content.opf まで揃う。
  `ExportFormat` は今 `'pptx' | 'docx'` の2つだけなので、**「書籍」の刷り分けが一番安い**
- **Web(HTML) 書き出し。** プレビューは既にあるのに書き出し経路が無い。`embed-resources` で自己完結 HTML にできる
- **`npm run check` を CI に載せる。** ワークフローに1ステップ足すだけ
- **`SlideOutline.layout` の assert を `check-deck` に1件足す。** レイアウト選択の回帰を止められる
- **警告表示を `pretty` に変える（§3.1 F）。** 1行の変更で、警告が読める文になる
- サンプル文書にルビ・傍点・画像・段組みの例を入れる（今は `::: notes` と行末 `\` のみ）
- **`app.json` に `ios.infoPlist` を足す（§3.6）。** 「Morpho で開く」の入口ができる

### 4.3 新しく設計を起こしたもの

**文章の段落分け（多段組）と、画像がある場合の配置デザイン** —
→ [`columns-and-images.md`](columns-and-images.md)

どちらも 0.13.0 時点で「pandoc 任せ」であり、
段組みは記法を書けば既に描けるが幅も段数も選べず、
画像は位置もサイズもアプリから一切触れない。
実測で分かった重要な非対称は次の1点:

- **段の幅比率はテンプレート（reference-doc）だけで変えられる**（後処理不要）
- **画像の配置はテンプレートでは動かせない**（レイアウト座標にもスライド寸法にも追従しないハードコード）

---

## 5. この文書を作るときに測った事実

実験台と生ログは残していないが、再現手順は次のとおり（`app/` で `npm install` 済みの状態）:

```bash
node scripts/dump-pptx.mjs foo.md      # pptx の実出力を見る
node scripts/dump-docx.mjs             # docx の実出力を見る
```

多段組・画像・出力形式について測った内容は
[`columns-and-images.md`](columns-and-images.md) の「実測」節にまとめてある。
