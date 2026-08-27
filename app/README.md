# Morpho アプリ本体

React Native + Expo。設計判断の根拠はリポジトリ直下の `CLAUDE.md` にある。

## 現在地

**第一マイルストーン: 変換経路が実機で通るかの確認。**

エディタに Markdown を打つと、手が止まって 1.5 秒後に pandoc.wasm が pptx を作り、
その pptx を解析してスライド枚数・レイアウト名・本文・警告を返す。
`docs/index.html` の検証ハーネスで実証済みの経路だけを使っている。

**iPad 実機で動作を確認済み**（起動 595 ms / ヒープ 104 MB / 4枚 76 ms）。

### v0.2.1 で入ったもの

- **和文の行内折り返しが安全に**: リーダーに `+east_asian_line_breaks`。
  一文を複数行に折り返して書いても半角スペースが混入しない
- **発表者ノート**: `::: notes 〜 :::` がプレビューカードの「ノート」から
  確認できる。書き出した pptx でも PowerPoint のノート欄に入る
- **改行位置の制御**: 行末バックスラッシュ（または行末スペース2つ）で
  スライド上の改行位置を固定できる。サンプルに使い方を記載

### v0.2.0 で入ったもの

- **書き出し**: pptx / docx を pandoc で生成して共有シートへ（Files / iCloud へ保存可）。
  .md はそのまま共有。Obsidian へは公式 URI（obsidian://new）で送れる（実験的）
- **複数文書**: アプリ内保存（自動保存 1 秒 + background 遷移で即時フラッシュ）。
  文書一覧から新規・切替・削除・.md 読み込み。保存状態と文字数をペイン見出しに表示
- **カーソル同期**: カーソル位置のスライドをプレビューで強調して自動スクロール。
  推定は純関数（`src/preview/cursorSlide.ts`）でコードフェンス内の # や *** は無視

出力の pptx は図形・段落・ランの三層で読む。
太字・斜体・下線・等幅（コード）・箇条書きの階層・タイトルプレースホルダを
それぞれ反映する。`<a:t>` だけを拾うと全部同じ見た目になるので、
書式は `<a:rPr>` と `<a:latin typeface>`、階層は `<a:pPr lvl>` から取る。

プレビューはまだ OOXML の座標（EMU）を使った実寸描画をしていない。
テンプレート適用の配線盤 UI も未実装。

## 構成

```
src/converter/types.ts               差し替え可能な境界。ここに pandoc 固有の語彙を漏らさない
src/converter/bridgeHtml.ts          不可視 WebView の中身。計算機に徹する
src/converter/usePandocConverter.tsx Converter の pandoc.wasm 実装
src/converter/frontMatter.ts         落とし穴 1 の回避。front matter を自前で剥がす
src/converter/latestOnly.ts          待機枠を1件だけ持つキュー
src/ui/EditorScreen.tsx              TextInput と結果表示
```

`Converter` インターフェースより上は変換器の実装を知らない。
GPL の結論次第で MIT の自前 writer に差し替えても、エディタ側は変更不要。

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

現在 **0.2.1**。企画検証を抜けて実装が始まった時点で 0.1.0 とした。

## 検査

```bash
npm run check
```

- `tsc --noEmit`
- ブリッジに埋めた JavaScript の構文チェック（実機でしか走らないコードなので手元で落とす）
- front matter 切り出しのテスト
- pptx パーサのテスト（ブリッジを vm で評価して直接叩く）

### pandoc の実出力を見る

```bash
node scripts/dump-pptx.mjs [file.md]
```

**パーサを推測で書かないこと。** 実際に pandoc を回して XML を見る。
これを怠って「箇条書きでない段落にも行頭記号が付く」不具合を出した。

分かっている pandoc の書き方:

| Markdown | pptx |
|---|---|
| 普通の段落・見出し・コードブロック | `<a:pPr><a:buNone/></a:pPr>` |
| 箇条書き | `<a:pPr lvl="n"/>` のみ（記号はレイアウト継承） |
| 番号付き | `<a:buAutoNum type="arabicPeriod"/>` |
| 太字 / 斜体 / 下線 | `<a:rPr b="1" i="1" u="sng"/>` |
| コード | `<a:latin typeface="Courier"/>` |

`pandoc-wasm` は devDependency に入れてある（55.9 MB あるので `npm install` が重い）。

## まだやっていないこと

- pptx の座標（EMU）を読んだ実際の描画
- テンプレート取り込みとレイアウト名の書き換え（配線盤 UI）
- iCloud Drive の .md を開いて上書き保存する経路の検証 — **ここは早期に確認が要る**
- pandoc.wasm の同梱（今は unpkg から取得。バージョンは 1.1.0 に固定済み）
