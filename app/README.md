# Morpho アプリ本体

React Native + Expo。設計判断の根拠はリポジトリ直下の `CLAUDE.md`、
版ごとの変更は [`CHANGELOG.md`](CHANGELOG.md) にある。

## 現在地

現在 **0.4.1**。**iPad 実機で動作確認済み**
（v0.1 時点の計測: 起動 595 ms / ヒープ 104 MB / 4枚 76 ms。以後未再計測）。

エディタに Markdown を打つと、手が止まって 1.5 秒後に不可視 WebView の
pandoc.wasm が pptx を作り、その pptx（実際の出力そのもの）を解析して描画する。

**書く**
- ネイティブ TextInput（日本語 IME 安全）。自動保存は手が止まって 1 秒後 +
  background 遷移で即時フラッシュ。保存状態と文字数をペイン見出しに表示
- 複数文書の管理（新規・切替・削除）と Files からの .md 読み込み

**見る**
- 実寸プレビュー: pptx の座標（EMU）・テーマ配色・マスター既定の字サイズと
  字下げ（marL / indent）を読んで 16:9 をそのまま縮尺描画
- カーソル同期: カーソル位置のスライドを強調して自動スクロール
- スライドショー（全画面・スワイプ / 端タップ送り・カーソル位置のスライドから
  始まる）と発表者ビュー（ノート・次のスライド・経過時間）
- 警告の色分け表示（致命的 / デザイン崩れ / 情報）

**整える**（プレビューから原稿へ書き戻す）
- 発表者ノートの編集（`::: notes :::` へ書き戻し）
- 改行位置の編集（段落・箇条書きの長押し。語 / 字の粒度切り替え）
- スライドカードのタップで原稿の該当位置へジャンプ

**出す**
- pptx / docx の書き出し → 共有シート（Files / iCloud へ保存可）
- .md の共有と Obsidian への送信（obsidian://new・実験的）

既知の制約:
- 表は `<p:graphicFrame>` になるためプレビューにまだ描画されない（書き出しには入る）
- 行の折り返し位置は PowerPoint のフォントメトリクスと完全には一致しない
- 元ファイルへのその場の上書き保存は不可（→「外部アプリ連携」）

## 使い方（原稿の書き方）

pandoc の Markdown が基本。アプリが特別に扱うものだけ挙げる。

| 書き方 | 意味 |
|---|---|
| `# 見出し` | 新しいスライド（`##` 以下はスライド内の見出し） |
| `***` | 明示的なスライド区切り（**`---` は使わない**。front matter と衝突する） |
| 冒頭の `---` `title:` `---` | front matter。title があるとタイトルスライドが1枚できる |
| 行末の `\`（または スペース2つ） | その位置でスライド上の改行を固定 |
| `- 項目` / `1. 項目` | 箇条書き / 番号付き |
| 半角スペース**2つ**（またはタブ）で字下げ | 箇条書きの入れ子。**半角1つでは入れ子にならず、全角スペースだと箇条書き自体が壊れる**（実測） |
| `::: notes` 〜 `:::` | 発表者ノート。スライドには出ず、pptx のノート欄に入る |
| `**太字**` `*斜体*` `` `コード` `` | 書式。和文の斜体は iOS の日本語書体に斜体字形が無いため傾かない |

和文の一文を原稿内で複数行に折り返して書いても、半角スペースは混入しない
（リーダーに `+east_asian_line_breaks` を指定してある）。

プレビュー側の操作:

- スライドカードを**タップ** → 原稿のその区間の先頭へカーソルが移動
- 段落を**長押し** → 改行位置の編集シート（「語 / 字」で粒度を切り替え、
  塊をタップした位置で改行。適用で原稿に行末 `\` が入る）
- カード右上の「ノート追加 / ノート ▸ / 編集」 → 発表者ノートの確認と編集
- ヘッダの「▶ 再生」 → スライドショー（下部の「発表者」で発表者ビュー）
- ヘッダの「書き出し」 → pptx / docx / md / Obsidian

## 動かす

```bash
npm install
npm start
```

iPad の Expo Go でスキャンする。初回は pandoc.wasm（55.9 MB）の取得が入る。

iPad と開発機が同じ Wi-Fi にいない場合は `npm run start:tunnel` を使う。

**QR が読めない / カメラから Expo Go が開かないとき**は、Expo Go を直接起動して
*Enter URL manually* にターミナルの `exp://192.168.x.x:8081` を入力する。
AltStore で署名し直した Expo Go は bundle ID が変わっていることがあり、
その場合カメラからのディープリンクが効かない。

**Expo アカウントは不要。** sign.expo.dev の手順2も飛ばせるし、
CLI もログアウトのまま動く。Expo Go がホーム画面でログインを促すのは
プロジェクト一覧を出すための導線で、開発サーバへの接続には URL だけあればよい。

アカウントを作れば（無料・メールとパスワードのみ）CLI と Expo Go の
両方にログインした状態で開発サーバが自動で一覧に並ぶので、毎回 URL を打たずに済む。

### iPad に Expo Go を入れる（確定手順）

App Store の Expo Go は **SDK 54 で凍結**されていて、SDK 55 以降は承認されていない。
このプロジェクトは SDK 57 なので、実機に入れるには自分で署名する必要がある。

**Windows から通った唯一の経路が以下。** 費用ゼロ、Mac 不要。

1. [sign.expo.dev](https://sign.expo.dev/) で **`.ipa` を取得するだけ**
   - Version で SDK 57 を選ぶ
   - **Device の手順は UDID を手入力する**（後述）
   - Install の手順で **`.ipa`** を選んでダウンロード
2. **AltStore / AltServer には別の無料 Apple ID でサインインする**（後述）
3. AltServer → *Sideload .ipa* → ダウンロードした .ipa を選ぶ
4. iPad で 設定 → 一般 → **VPNとデバイス管理** → 開発者を信頼

以降、AltServer は同じ Wi-Fi にいれば **7日ごとに自動で再署名する。**
sign.expo.dev の USB 経路だと毎週手動で入れ直しになるので、この点でも AltStore が優る。

#### 落とし穴1: Device の手順は UDID を手入力する

自動のデバイス検出が失敗すると `Your Apple ID session expired, sign in again.` が
出続けて先へ進めない。**エラー文言と実際の失敗箇所が対応していない。**
Apple ID の認証自体は通っているので、何度サインインし直しても解決しない。
UDID を手で貼れば通る。UDID は端末ごとに変わらないので次回も同じ値が使える。

#### 落とし穴2: AltStore には別の Apple ID を使う

sign.expo.dev は Apple ID に**開発証明書を作る**。同じ Apple ID で AltServer を動かすと、
AltServer はその証明書を見つけるが秘密鍵を持っていないため
**Import Signing Certificate**（.p12 をよこせ）を要求する。
sign.expo.dev は秘密鍵を渡さないので Skip するしかなく、署名手段がないまま Failed になる。

**AltStore 用に無料 Apple ID をもう一つ作れば、この衝突は原理的に起きない。**
既存の証明書を Revoke する道もあるが、破棄するとアカウントが
14日間のクールダウンに入るという報告がある（Apple の公式文書では未確認）。
別 ID のほうが安全。

#### 通らなかった経路（再挑戦しないこと）

| 経路 | 結果 |
|---|---|
| sign.expo.dev の USB | ✗ WebUSB の排他確保と Apple ドライバの結合が両立しない板挟み。`active config: 1; usbmux in config(s): 3,4` が出る。Zadig で「Apple Mobile Device USB Device」インターフェースのみ WinUSB に差し替えれば抜けられるが、複合親デバイスに当てると同期・バックアップごと壊れる |
| Expo Orbit | ✗ iOS 実機の管理に `xcrun` を使うため **macOS 専用** |
| QR コード | ✗ トップページに "over USB or QR code" とあるが、実際の Install の手順には出ない |
| iTunes へドラッグ | ✗ Apps セクションは iTunes 12.7 で削除済み |

#### 名前が紛らわしいので注意

Apple 側に似た名前のものが2つあり、必要なのは無料のほう。

| | 費用 | 範囲 |
|---|---|---|
| Apple Developer **Agreement**（契約） | **無料** | 自分の端末での実機テスト。7日ごとに更新、端末3台まで |
| Apple Developer **Program**（プログラム） | $99/年 | App Store 配布、TestFlight、App Store Connect |

developer.apple.com では**サインインするだけ**にする。
「Enroll」は $99 の課金導線なので押さない。
`eas go` が有料なのは TestFlight 配布が有料側の機能だから。

ネイティブモジュールを足す段階（iCloud 連携など）になると
自前の development build が必要になり、そこで初めて Developer Program が要る。

#### 逃げ道

`sdk-54` ブランチは SDK 54 に固定してあり、App Store の Expo Go がそのまま使える。
署名も .ipa も7日ごとの入れ直しも発生しない。`src/` は main と同一。

## スタンドアロン版を iPad に入れる（CI ビルドの ipa）

GitHub Actions が**署名なしの ipa** を作る（`.github/workflows/build-ipa.yml`）。
AltStore / SideStore は ipa を無料 Apple ID で署名し直してインストールするため、
CI 側の署名も Apple Developer Program も不要。**検証済み・成果物 約 8.6 MB**。

手順（iPad だけで完結する）:

1. GitHub の **Actions タブ → Build IPA → Run workflow**
2. 完了（約5分）後、**[Releases](https://github.com/c-colloid/Morpho/releases) に
   `Morpho-x.y.z.ipa` が公開される**。Safari でそのままダウンロードできる
   （ログイン・zip 展開は不要）
3. **AltStore**（＋ボタン → ipa を選択。同一 LAN に AltServer が必要）か
   **SideStore**（初回ペアリング後は完全に iPad 単体）で開く

リリースノートは `CHANGELOG.md` の該当版の節が自動で入る。
同じバージョンで再ビルドすると Releases のアセットは差し替えられる。
Actions の Artifacts（Morpho-ipa・14日で消える）にも同じものが残る。

Expo Go 版との違い:

| | Expo Go + Metro | スタンドアロン ipa |
|---|---|---|
| 反映速度 | 保存で即時 | ビルド約5分 + 入れ直し |
| iPad 最適化 | Expo Go の制約で iPhone 幅 | **ネイティブに iPad 対応** |
| ネイティブモジュール追加 | 不可 | **可能**（Share Extension / open-in-place への道） |
| 文書の保存先 | Expo Go のサンドボックス | **別サンドボックス**（文書は共有されない） |

日常の開発は Metro、節目の確認と「素の Morpho」の検証はこの ipa、という使い分け。
無料 Apple ID のサイドロード枠は 3 アプリまで（AltStore 自身が 1 枠使う）。

ハマりどころ（CI 構築時に実際に踏んだもの）:
- **Xcode 26 が必須**。SDK 57 の ExpoModulesJSI は swift-tools-version 6.2 を
  要求し、Xcode 16.x だと SPM が詳細空の
  `Could not resolve package dependencies:` で落ちる → `runs-on: macos-26`
- `xcodebuild | xcbeautify` は **xcbeautify の exit 0 が失敗を隠す**。
  `set -o pipefail` を忘れると空の ipa が「成功」になる
- 成果物の検算（実行バイナリの存在・サイズ下限）を必ず入れる

## 外部アプリ連携（Files / Obsidian）の現在地

**結論: 読み込みと書き出しは今できる。その場での上書き編集（open in place）は
Expo Go では原理的に不可能で、development build が必要。**

| やりたいこと | 今（Expo Go） | 手段 |
|---|---|---|
| Files / Obsidian 保管庫の .md を取り込む | ○ | 書類 →「読み込み」（expo-document-picker。キャッシュへのコピー） |
| .md / .pptx / .docx を Files（iCloud 含む）へ保存 | ○ | 書き出し → 共有シート →「"ファイル"に保存」。同名なら置き換え |
| Obsidian にノートとして送る | ○（実験的） | 書き出し →「Obsidian へ送る」。公式 URI（obsidian://new）で最後に開いた保管庫へ。本文約2万字まで |
| 元ファイルへのその場の上書き保存 | **✗** | picker はコピーしか返さない。security-scoped bookmark が要る |

Obsidian 保管庫との往復は「読み込み → 編集 → .md 書き出しで同じ場所に置き換え」で
手動なら回る。ファイル名は文書タイトルから付くので、タイトルを変えなければ
置き換え先も揃う。

**open in place を実現する条件**（次の段階）:
development build + ネイティブ側の UIDocumentPicker（asCopy: false）と
security-scoped bookmark。@react-native-documents/picker の open モードが
この用途に合う。development build は EAS のクラウドビルドで作れるが、
実機に入れる署名で結局 Apple Developer Program（$99/年）が要る
（AltStore の再署名で dev build が動くかは未検証）。
iCloud 連携を本気で満たすのはこのタイミングになる。

## 構成

```
src/converter/  ── 変換。ここより上は pandoc を知らない
  types.ts               差し替え可能な境界。pandoc 固有の語彙を漏らさない
  bridgeHtml.ts          不可視 WebView の中身。pandoc.wasm の起動・変換・書き出し・
                         pptx の OOXML 解析（図形 / 段落 / ラン・座標継承・ノート）
  usePandocConverter.tsx 不可視 WebView をマウントして Converter 実装を提供する hook
  frontMatter.ts         front matter を自前で剥がす（CLAUDE.md 落とし穴 1 の回避）
  latestOnly.ts          待機枠を1件だけ持つ変換キュー

src/preview/    ── 原稿とスライドの対応（純関数）
  cursorSlide.ts         スライド境界の判定。カーソル位置 → スライド番号、区間一覧
                         （コードフェンス内の # や *** は境界として無視する）
  notesEdit.ts           発表者ノート（::: notes :::）の読み取りと書き戻し
  lineBreakEdit.ts       改行位置編集。正規化・語 / 字分割・オフセット適用・対象特定

src/store/      ── 永続化と共有
  documents.ts           複数文書のアプリ内保存（一覧・作成・保存・削除）
  exportShare.ts         書き出しファイルを iOS 共有シートへ渡す

src/ui/
  EditorScreen.tsx       メイン画面。原稿とプレビューの二画面、全体の配線
  SlideSurface.tsx       EMU 座標・配色・字サイズ・字下げを使った実寸スライド描画
  SlideShow.tsx          全画面スライドショーと発表者ビュー
  BreakEditSheet.tsx     改行位置の編集シート（語 / 字の粒度切り替え）
  NotesEditSheet.tsx     発表者ノートの編集シート
  DocumentsModal.tsx     文書一覧（切替・新規・読み込み・削除）
  ExportMenu.tsx         書き出し形式の選択（pptx / docx / md / Obsidian）
```

`Converter` インターフェースより上は変換器の実装を知らない。
GPL の結論次第で MIT の自前 writer に差し替えても、エディタ側は変更不要。

## 検査

```bash
npm run check
```

| 検査 | 内容 |
|---|---|
| `tsc --noEmit` | 型チェック |
| `check-bridge.mjs` | ブリッジに埋めた JavaScript の構文チェック（実機でしか走らないコードなので手元で落とす） |
| `check-frontmatter.mjs` | front matter の切り出し |
| `check-scene.mjs` | pptx パーサ単体（ブリッジを vm で評価して直接叩く） |
| `check-cursor.mjs` | カーソル位置 → スライド番号の対応 |
| `check-notes-edit.mjs` | 発表者ノートの読み取りと書き戻し |
| `check-linebreak.mjs` | 改行位置編集（正規化・分割・オフセット適用・対象特定） |
| `check-deck.mjs` | **統合検査**: 本物の pandoc.wasm で pptx を作り、座標・配色・字サイズ・字下げ・ノートの継承解決までを確認 |

### pandoc の実出力を見る

```bash
node scripts/dump-pptx.mjs [file.md]
```

**パーサを推測で書かないこと。** 実際に pandoc を回して XML を見る。
これを怠って「箇条書きでない段落にも行頭記号が付く」不具合を出した。

出力の pptx は図形・段落・ランの三層で読む。`<a:t>` だけを拾うと全部同じ
見た目になるので、書式は `<a:rPr>` と `<a:latin typeface>`、階層は
`<a:pPr lvl>` から取る。分かっている pandoc の書き方:

| Markdown | pptx |
|---|---|
| 普通の段落・見出し・コードブロック | `<a:pPr><a:buNone/></a:pPr>` |
| 箇条書き | `<a:pPr lvl="n"/>` のみ（記号はレイアウト継承） |
| 番号付き | `<a:buAutoNum type="arabicPeriod"/>` |
| 太字 / 斜体 / 下線 | `<a:rPr b="1" i="1" u="sng"/>` |
| コード | `<a:latin typeface="Courier"/>` |
| 段落の字下げ | 普通の段落は `marL="0" indent="0"` 明示、箇条書きはマスターの lvl 既定（`marL=342900×(n+1)`, `indent=-342900`）を継承 |

`pandoc-wasm` は devDependency に入れてある（55.9 MB あるので `npm install` が重い）。

## ハマった点: react-native-webview の style は外側に効かない

不可視 WebView を `style={{position:'absolute', width:1, height:1}}` で
隠したつもりが、**`style` は中の WebView にしか効かない**。
本体は `flex:1` のコンテナ View で包まれており（`WebView.styles.ts`）、
そのコンテナが縦の flex レイアウトに参加して**画面の半分を取っていた**
（v0.1.0〜0.1.1 の「画面が下半分にしか出ない」の正体）。
外側は **`containerStyle`** で潰す。両方に同じ hidden スタイルを渡すこと。

原因の特定はヘッダの実測値で行った。
`1032 − 余白52 − ヘッダ44 ≒ 936` の半分 `468` が「本体 h468」と一致し、
flex:1 の兄弟がもう1人いることが算術で確定した。

## バージョン

`app.json` の `version` を上げて、画面上部のヘッダに出している。
実機で見ているものがどの版か分かるようにするため、変更を push するたびに上げる。
ヘッダには版のほかに画面幅と一画面／二画面の別も出る（不具合の切り分け用）。

現在 **0.4.1**。企画検証を抜けて実装が始まった時点で 0.1.0 とした。
版ごとの変更は [`CHANGELOG.md`](CHANGELOG.md)。

## まだやっていないこと

- テンプレート取り込みとレイアウト名の書き換え（配線盤 UI）
- 表のプレビュー描画（`<p:graphicFrame>` の解析）
- iCloud Drive の .md を開いて上書き保存する経路（→「外部アプリ連携」の
  open in place。development build と Developer Program の課金判断が要る）
- pandoc.wasm の同梱（今は unpkg から取得。バージョンは 1.1.0 に固定済み）

機能の中期計画は `notes/roadmap-pptx.md`（内容 / テーマ / デザインデータの三層分離）。
