# Morpho — 一つの原稿から、スライド・書籍・PDF・Web へ

## このファイルについて

企画検証フェーズで実測した結果と、そこから確定した設計判断を記録している。
**推測ではなく実際に動かして確認した内容**なので、ここに書いてあることを再検証する必要はない。
未確認の項目は「未検証」と明記してある。

---

## プロジェクトの目的

**Morpho** — iPad 上で動く、単一ソース出版のためのエディタ。

一つの Markdown 原稿から、スライド（pptx）・書籍（docx / epub）・PDF・Web を刷り分ける。
変換エンジンは pandoc の WebAssembly ビルド。
**製品の主役はエディタ**であり、変換器は差し替え可能なバックエンドとして扱う。

日本語圏を主戦場とし、ルビ・傍点・縦書きといった日本語組版を最初から持つことを差別化とする。

名前の由来は「多形（polymorphism）」とモルフォ蝶。
一つのものが複数の形をとること、さなぎから姿を変えて現れること、
そして見る角度で色が変わる構造色 — いずれも製品のコンセプトを指している。

### 名称に関する注意

日本に **株式会社モルフォ**（画像処理ミドルウェア、`Morpho Effect Library®` の登録商標保有）が存在する。
分野もユーザー層も重ならないため実害は低いと判断しているが、
**「Morpho」単体での商標登録は狙わない**方針。App Store では表示名 Morpho + 領域を示すサブタイトルで運用する。

---

## 確定した技術判断

| 判断 | 根拠 |
|---|---|
| 変換エンジンは pandoc.wasm | iOS はプロセス生成不可のため、pandoc バイナリの実行は原理的に不可能。WASM が唯一の手段 |
| 実行環境は WKWebView | iOS で JIT が許可される唯一の場所。`JSContext` は Apple が WebAssembly を無効化しており使えない |
| WasmKit は採用しない | インタプリタで低速。WKWebView で実測「体感ゼロ」だったため検討不要になった |
| エディタはネイティブのテキスト入力を使う | iPad の日本語 IME 対応。同時に pandoc がスレッドを止める問題も解決する（webview は別プロセス）。Mac が無いため実装は React Native（`TextInput` の実体は `UITextView`）|
| WKWebView は不可視の計算エンジンとして使う | Markdown を渡すと描画用の JSON を返す。描画はネイティブ側 |
| wasm の配信は `WKURLSchemeHandler` | `file://` + `instantiateStreaming` は CORS で失敗する。localhost サーバは不要 |
| pandoc のバージョンは固定して同梱 | 3.1.3 → 3.9 で同一入力のスライド数が 64 → 52 に変化した。差し替えると過去の資料の構成が変わる |
| **配布形態はネイティブアプリ。PWA は採用しない** | **製品の主役はエディタ。Safari は File System Access API 非対応（OPFS のみ）で iCloud Drive の .md を開いて上書き保存できず、日本語 IME も web の textarea では実用に耐えない。この2点がエディタの中心を直撃する** |
| **変換器は差し替え可能なプロトコルの裏に置く** | **pandoc は主役ではなくバックエンド。GPL の結論次第で MIT の自前 writer に交換する余地を残す** |

---

## 実測値

| 項目 | 値 |
|---|---|
| pandoc.wasm サイズ | 58,580,800 bytes（55.9 MB）/ 圧縮時 琦16 MB |
| npm パッケージ展開時 | 55.9 MB |
| 変換時間（64枚 / デスクトップ pandoc 3.1.3 ネイティブ） | 216 ms |
| 変換時間（50枚 / **iPad** / pandoc.wasm） | **47 ms**（中央値・100回） |
| 変換時間（50枚 / Windows デスクトップ / pandoc.wasm） | 169 ms（中央値・100回） |
| JIT ウォームアップ（iPad） | 初回 236 ms → 定常 47 ms |
| WASM ヒープ定常値（200回連続変換で頭打ち） | 約 115 MB |
| ライセンス | GPL-2.0-or-later |

### CDN

- ❌ jsdelivr — 50MB 制限で 403（`File size exceeded the configured limit of 50 MB`）
- ✅ `https://unpkg.com/pandoc-wasm@1.1.0/src/pandoc.wasm` — CORS 可、バージョン固定
- ✅ `https://pandoc.github.io/pandoc-wasm/pandoc.wasm` — CORS 可
- ❌ `https://pandoc.org/app/pandoc.wasm` — CORS ヘッダなし。**かつ npm 1.1.0 と別ビルド**（59,075,382 bytes）

---

## API

```js
import { createPandocInstance } from "pandoc-wasm/src/core.js";

const pandoc = await createPandocInstance(arrayBuffer);
const result = await pandoc.convert(options, stdin, files);
// result = { stdout, stderr, warnings, files, mediaFiles }
```

- `options` は pandoc の defaults ファイル形式のオブジェクト（`{ from, to, "output-file", "reference-doc", filters }`）
- `files` はファイル名 → String | Blob のマップ。テキストは String、バイナリは Blob
- 出力は `result.files["out.pptx"]` に Blob で返る
- `warnings` は構造化された JSON 配列
- `core.js` は `@bjorn3/browser_wasi_shim` を bare specifier で import するので、importmap かバンドラが必要
- **インスタンスは公開されない**。メモリ観測には `WebAssembly.instantiate` を一時的に横取りする（`docs/index.html` の `instantiateWithCapture` 参照）

---

## pandoc の落とし穴（すべて実証済み）

### 1. `---` をスライド区切りに使うと YAML として解釈される

空行に続く `---` は YAML メタデータブロックの開始とみなされ、次の `---` が終了デリミタとして拾われる。
間に `*` や `&` で始まる行があると、YAML がエイリアス/アンカーとして解釈して以下のエラーになる。

```
YAML parse exception at line N, column 1, while scanning an alias:
did not find expected alphabetic or numeric character
```

閉じ側の `---` が無ければ水平線にフォールバックするため、**`---` が偶数個あるときだけ発症する**。

**対処:** リーダーを `markdown-yaml_metadata_block` に固定し、front matter はアプリ側で自前パースして
`options.metadata` として渡す。明示的なスライド区切りは `***` を使わせる。

### 2. 入力フォーマットの Auto 検出は使わない

pandoc.org/app の Auto は拡張子ベースの検出で、貼り付けテキストには効かない。
`from` は必ず明示的に指定する。Auto という選択肢を UI に出さない。

### 3. 存在しない画像は警告ではなく致命的エラー

```
File not-found.png not found in resource path
```

出力ファイルが一切生成されない。**変換前に Markdown 中の画像参照を全部走査し、
実ファイルを解決して `files` に Blob で載せる前処理が必須。**

### 4. レイアウトは英語名で照合される

pandoc が探す名前は以下の7つで固定：

```
Title Slide / Title and Content / Section Header / Two Content
Comparison / Content with Caption / Blank
```

日本語版 PowerPoint のテンプレート（「タイトル スライド」等）は一致せず、
警告を出して pandoc 標準レイアウトに差し替わる。**エラーにはならない。**

実測した結果：

| 項目 | 結果 |
|---|---|
| テーマ（配色・フォント） | 引き継がれる |
| レイアウト（プレースホルダ位置） | pandoc 標準に差し替わる |
| 出力内のレイアウト | 英語名と日本語名が混在する |

つまり「色は合っているのに配置が違う」という気づきにくい壊れ方をする。

**対処:** テンプレート取り込み時に `ppt/slideLayouts/slideLayoutN.xml` の
`<p:cSld name="...">` を英語名に書き換える。これは製品の核となる機能で、
マッチしないレイアウトはユーザーに手動割り当てさせる UI にする（`docs/index.html` に実装済み）。

### 5. 表の後ろにコンテンツがあるとスライドが分割される（pandoc 3.1.3）

表がコンテンツプレースホルダを占有するため、後続ブロックがタイトルなしの独立スライドになる。
**pandoc 3.9 では解消されている可能性がある**（同一入力で 64枚 → 52枚）。要確認。

### 6. 脚注は末尾の "Notes" スライドに集約される（pandoc 3.1.3）

pandoc 3.9 では消滅している可能性がある。**無警告のデータロスなら要 lint。** 未検証。

### 7. HTML コメントが RawBlock 警告を出す

```
Not rendering RawBlock (Format "html") "<!--...-->"
```

Markdown で最も一般的なメモ書き手段なので、実文書には普通に入っている。
放置すると本当に見るべき警告が埋もれる。Lua フィルタで除去する（`docs/index.html` の `STRIP_LUA`）。

---

## 警告の重要度分類

| パターン | 重要度 | 意味 |
|---|---|---|
| `not found in resource path` | 致命的 | 変換が停止し出力が生成されない |
| `Couldn't find layout named` | 要対応 | デザインが崩れる |
| `Not rendering RawBlock` | 情報 | 多くは HTML コメント。無視してよい |

---

## ライブプレビューの設計方針

### 何を映すか

pandoc に pptx を描画する機能はないので自作する。

- ❌ pandoc → HTML(reveal.js) — 別ライターなので嘘をつく。テンプレートもレイアウトも反映されない
- ✅ pandoc → pptx → OOXML を解析して描画 — 実際の出力そのもの
- テンプレート pptx にプレースホルダ座標が EMU 単位で入っている（`<a:off x= y=>` / `<a:ext cx= cy=>`、914400 EMU = 1 inch）
- スライドサイズは `ppt/presentation.xml` の `<p:sldSz cx= cy=>`
- 配色とフォントは `ppt/theme/theme1.xml`

### 性能設計

- **カーソルのあるスライドだけ変換する。** スライド境界は Markdown 側で判定できるので、
  その1枚を切り出して単体変換すれば入力遅延が文書長に依存しなくなる。
  ただし iPad 実測（下記）で 50枚の全体変換が 47 ms と判明したため、
  **これは長い文書のための最適化であって初期実装の必須要件ではない**。
  単層で作り、文書長が効いてきてから切り出しを足す
- デッキ全体の変換は手が止まって 1.5 秒後、または書き出し時のみ
- **キューは「最新だけ残す」。** pandoc.wasm は走り出したら中断できないので、
  待機枠を1件だけ保持して上書きする。溜めると破綻する
- 起動時にダミー変換を1回走らせて JIT を温める。
  実機では初回 236 ms → 定常 47 ms（5倍）と効果が大きい。
  **長いアイドルの後も復帰コストが出る**（温まった状態でも初回 83 ms）ので、
  放置後の最初の入力の前にも1回挟むとよい
- **インスタンスは1つ作って使い回す。** ヒープは約 115 MB で頭打ちになるため、
  再生成も閾値監視も要らない（下記）

### 連続変換時のヒープ増加 — 決着。リークではない

**結論: 単一インスタンスを永久に使い回してよい。再生成の機構は要らない。**

`docs/index.html` の「100回連続変換」を 50枚デッキで実行:

| | 初回 | 中央値 | 直近5回 | ヒープ | 増分 | 1回あたり |
|---|---|---|---|---|---|---|
| Windows デスクトップ | 243 ms | 169 ms | 167 ms | 114 MB | +7.6 MB | 78 KB |
| iPad（1回目） | 236 ms | **47 ms** | 46 ms | 114 MB | +76.8 MB | 0.77 MB |
| iPad（2回目・リロードなし） | 83 ms | 46 ms | 46 ms | 115 MB | **+0.6 MB** | **6.4 KB** |

#### 増加は立ち上がりだった

iPad で続けて2回目を回したところ、増分が **76.8 MB → 0.6 MB（約 120 分の1）** に落ちた。
1回あたりのヒープ増加は漏れではなく、**GHC ランタイムがこのワークロードで必要とする
作業領域（約 114 MB）へ向かう立ち上がり**だった。

これは2機種の着地点が一致していたことからの推測どおり:

| | 開始 | 100回後 | 200回後 |
|---|---|---|---|
| デスクトップ | 約 106 MB | 114 MB | — |
| iPad | 約 37 MB | 114 MB | 115 MB |

増加率が 10 倍違う2機種が同じ値に着地し、そこから先は伸びない。
デスクトップの 78 KB/回 が小さく見えていたのは、
ソーク開始前の手動変換で既に頭打ちに近かったから。

残る 6.4 KB/回 は WASM のページ粒度（64 KiB）で見ると 100回で約10ページぶんで、
漸近の裾か測定のゆらぎの範囲。仮にこれが定常的な漏れだとしても余裕は十分ある:

| 上限 | 残り変換回数 |
|---|---|
| 512 MB | 約 63,000 回 |
| 1 GB | 約 145,000 回 |

毎秒2回変換し続けても 512 MB に届くまで約 8.8 時間かかる。
**どちらに解釈しても設計判断は変わらないので、これ以上の測定は不要。**

#### 設計判断

- **インスタンスは1つ作って使い回す。閾値監視も控えの暖機も差し替えも要らない**
- 変換時間は 200 回回しても劣化しない（iPad 中央値 46〜47 ms で一定）
- 定常状態のリニアメモリは **約 115 MB** として見積もる

#### 副産物: Share Extension が不可能なことの数値的裏付け

App Extension のメモリ上限は約 120 MB（後述）。
**pandoc.wasm のリニアメモリだけで 115 MB に達する**ため、
55.9 MB のモジュール本体や JS ヒープを数える前に上限を使い切る。
「変換は必ず本体プロセスで行う」という判断は、これで実測に裏打ちされた。

#### アイドル後の初回は遅い

2回目のソークは JIT が温まった状態で始めたのに、初回だけ 83 ms（中央値 46 ms の約2倍）かかった。
ウォームアップは起動時の1回で終わりではなく、**放置後の最初の変換にも復帰コストがある**。
ライブプレビューの体感に効くので、長いアイドルの後は裏でダミー変換を1回挟むとよい。

#### まだ分かっていないこと

- **測ったのは 50枚デッキの全体変換。** 1枚だけの変換での挙動は未検証。
  もっとも全体変換が 47 ms で足りている以上、当面は測る必要がない
- **入力から画が出るまでの端から端までの遅延。** 47 ms は pandoc の変換時間のみで、
  pptx の展開・OOXML 解析・描画を含まない

---

## その他の未検証項目

（WASM 上の Lua フィルタは検証済み → `notes/findings.md` 6。
日本語の gsub も動くが、否定文字クラスはバイト単位で壊れるので遅延量指定子を使う）

- pandoc 3.9 で「表の後ろのスライド分割」が解消されているか
- pandoc 3.9 で脚注がどこへ行くか（本文 / ノート / 消滅）
- Typst 経由の日本語 PDF（CJK フォントを WASM FS に配置する必要がある）— 優先度低
- 自作テンプレートで reference-doc が実際に効くか

---

## 開発環境（重要）

**開発マシンは Windows / Linux。Mac は無い。**

### Mac が必須なもの（3点のみ）

- Xcode 本体（macOS 専用。Windows 版は存在しない）
- iOS Simulator（Xcode に同梱されるため macOS 専用）
- codesign / 証明書管理（macOS Keychain 依存）

### Mac 無しで出荷できる経路

クロスプラットフォーム SDK（React Native / Flutter / .NET MAUI）は Windows で動作する。
**クラウドビルド**（Expo EAS Build / Codemagic）が、触らない Mac 上でコンパイルと署名を代行する。
これが Mac を所有せずに App Store へ到達する唯一の現実的な経路。

### フレームワーク選定 — 日本語 IME が決め手

| | テキスト入力の実体 | 日本語 IME |
|---|---|---|
| **React Native**（推奨） | `TextInput` = ネイティブ `UITextView` | 問題なし |
| Flutter | Skia で自前描画 | 変換候補の挙動がネイティブと異なる |
| Capacitor / Ionic | WebView | **却下**（textarea の IME 問題に逆戻り） |

React Native の `TextInput` は中身が本物の `UITextView` なので、
変換候補・確定前の下線・選択挙動が OS そのまま。この一点で RN を選ぶ。

### 開発フロー

- JS 側の変更 → Expo dev client 経由で**実機 iPad に即反映**（高速反復可能）
- ネイティブモジュールの追加・変更 → クラウドビルド（数分）
- **ネイティブモジュールは Windows で書けてもデバッグできない。**
  エディタは RN の `TextInput` で実現できる範囲に設計を寄せること

### 諦めるもの

TextKit 2 のレイアウトマネージャに手を入れる系の細かい制御。
シンタックスハイライト、ルビ挿入 UI、入力アクセサリ程度は RN の射程内。

### この制約と無関係に進められること

日本語記法レイヤ（Lua フィルタ）、変換器の実装と評価、テンプレートのレイアウト解析、
シーン JSON の仕様、検証ハーネス。すべてプラットフォーム非依存で無駄にならない。

**Claude Code へ: Mac が用意されたと明示されるまで、Xcode プロジェクトの
スキャフォルドや純 SwiftUI 実装を前提にしないこと。RN + Expo を既定とする。**

## 制約とリスク

### ライセンス

pandoc および `pandoc-wasm` は **GPL-2.0-or-later**。
GPL と App Store 利用規約（デバイス数制限・DRM）の非互換は既知の論点で、
実際に App Store から削除された事例がある。

**GPL の義務は「配布」で発動し、「使用」では発動しない。**
開発中に pandoc.wasm を使うことに制約はない。判断が必要になるのは App Store に出す瞬間だけなので、
エディタの実装着手をこの判断で止めないこと。

### ship 時の選択肢

1. jgm 氏に App Store 配布のための追加許諾を打診する（pandoc の WASM ビルドは公式プロジェクトなので、筋の悪い相談ではない）
2. アプリ全体を GPL で公開する
3. **変換器を MIT の自前実装に差し替える**（下記）
4. PWA で出す（エディタが主役である以上、製品としては非推奨）

### 自前 writer という選択肢

エディタが製品である以上、pandoc は交換可能なバックエンドである。
スライド生成に限れば `markdown-it`（MIT）+ 自前 OOXML writer で置き換え可能で、
テンプレートのレイアウト解析手法は既に判明している（`<p:cSld name>` / `<a:off>` / `<a:ext>`）。

| | pandoc.wasm | 自前 writer |
|---|---|---|
| ライセンス | GPL-2.0+ | MIT |
| サイズ | 55.9 MB | 数百 KB |
| 既知の落とし穴 | 7件を回避する必要がある | 最初から持たない |
| docx / epub 等 | 無料で付いてくる | 別途実装 |
| 実装量 | ほぼゼロ | 数ヶ月 |

自前なら英語名でのレイアウト照合という制約自体が存在しないため、この一点では pandoc より良いものになる。
捨てるのは「汎用変換への拡張」だが、それ自体は差別化要素ではない（pandoc.org/app が無料で存在する）。

**結論: エディタから作る。変換器は後で決める。**
そのため pandoc の落とし穴に対する lint は作り込みすぎないこと。差し替えたら不要になる。

### App Extension のメモリ上限

Share Extension は約 120MB。pandoc.wasm は展開 55.9MB + GHC ランタイムヒープで確実に落ちる。
実測でリニアメモリの定常値が **約 115 MB** と判明したため（上記）、
モジュール本体を数える前に上限に達する。推測ではなく確定した制約。
**変換は必ず本体プロセスで行う。**

### wasm32 のメモリ上限

4GB。通常の文書では問題にならないが、大量画像を含む場合は注意。

---

## アーキテクチャ

```
[RN エディタ] ──md──▶ [変換器] ──JSONシーン──▶ [RN プレビュー]
                        │                        └──▶ pptx Blob（書き出し時）
              ここが差し替え可能な境界
```

`Converter` インターフェースを定義し、`PandocConverter`（不可視 WebView + pandoc.wasm）を最初の実装とする。
WebView は「Markdown を渡すと描画用 JSON を返す計算機」に徹する。
この境界があるため、中身を自前 writer に差し替えてもエディタ側は変更不要。

### エディタで妥協できない点

| 要素 | 実装 | 理由 |
|---|---|---|
| ネイティブテキスト入力 | RN `TextInput` | 日本語 IME。変換候補、確定前の下線、選択とカーソル操作、Undo |
| ファイルの居場所 | expo-document-picker ＋ 必要ならネイティブモジュール | iCloud Drive の .md を開いて上書き保存する |
| ライブプレビュー | — | カーソル位置のスライドだけ変換する二層構造 |
| テンプレート適用 | — | 配線盤 UI。他にない機能 |
| ハードウェアキーボード | — | Magic Keyboard 前提のショートカット |

**注意:** DocumentGroup / UIDocumentBrowser は純ネイティブ API。RN からは直接使えないため、
「iCloud の .md を開いて上書き保存」をどこまで実現するかは早期に検証すること。
ここが妥協できないなら、Mac の調達が現実的な選択肢に戻る。

## リポジトリ構成

```
app/                                 アプリ本体（React Native + Expo）
docs/index.html                      GitHub Pages で公開する検証ハーネス
fixtures/pptx-benchmark.md           50枚規模のテストデッキ（自己診断型）
notes/findings.md                    検証の経緯
scripts/init.sh                      Pages 有効化と基準出力の再生成
```

`app/` の中身と現在地は `app/README.md` を参照。
`src/converter/types.ts` がアーキテクチャ図の「差し替え可能な境界」にあたる。

比較用の基準出力（pandoc 3.1.3 で 64 枚）はリポジトリに含めていない。次で再生成する:

```bash
pandoc fixtures/pptx-benchmark.md -o fixtures/pptx-benchmark-reference.pptx
```

`docs/index.html` は将来 WKWebView に載せるブリッジのプロトタイプでもある。
`fetchWasm()` をバンドル同梱ファイルの読み込みに差し替えれば、そのまま流用できる。

---

## 開発時の注意

- **fixtures/pptx-benchmark.md を書き換えない。** ベンチマークの基準値が変わる
- 新しい pandoc の挙動を見つけたら、このファイルの「落とし穴」に追記する
- 実測していないことを断定で書かない。「未検証」と明記する
