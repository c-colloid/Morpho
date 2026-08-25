# Morpho アプリ本体

React Native + Expo。設計判断の根拠はリポジトリ直下の `CLAUDE.md` にある。

## 現在地

**第一マイルストーン: 変換経路が実機で通るかの確認。**

エディタに Markdown を打つと、手が止まって 1.5 秒後に pandoc.wasm が pptx を作り、
その pptx を解析してスライド枚数・レイアウト名・本文・警告を返す。
`docs/index.html` の検証ハーネスで実証済みの経路だけを使っている。

プレビューはまだ OOXML の座標を使った描画をしていない（テキストの一覧まで）。
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

### iPad に Expo Go を入れる

App Store の Expo Go は **SDK 54 で凍結**されていて、SDK 55 以降は承認されていない。
このプロジェクトは SDK 57 なので、実機に入れる経路は次の3つ。

| 経路 | 費用 | Mac | 保守 |
|---|---|---|---|
| **sign.expo.dev** | 無料 | 不要 | 約7日ごとに再署名 |
| `npx eas-cli@latest go` | $99/年 | 不要 | 1年 |
| App Store の Expo Go | 無料 | 不要 | 不要（ただし SDK 54 まで） |

[sign.expo.dev](https://sign.expo.dev/) は **無料 Apple ID の開発者プロビジョニング**を使って
Expo Go に署名し、USB か QR コードで端末に入れる Expo 公式のサービス。
有料の Apple Developer Program は要らない。
証明書の有効期間は約7日で、切れたら同じ手順で入れ直す。

#### Windows から入れる場合の現実

Install の手順で選べるのは **USB / Expo Orbit / .ipa** の3つ。QR コードは出ない
（トップページには "over USB or QR code" とあるが、実際の手順には無い）。

| 選択肢 | Windows で使えるか |
|---|---|
| USB | ✗ 事実上詰まる（下記） |
| Expo Orbit | ✗ iOS 実機の管理に `xcrun` を使うため **macOS 専用** |
| .ipa | ○ 別途インストーラが要る |

**USB が詰まる理由。** WebUSB はインターフェースを排他的に掴む必要があるが、
Apple のドライバ（iTunes / Apple Devices 同梱）が結合していると横取りできない。
かといってドライバが無いと iPad が usbmux を持たない構成のまま
（エラーに `active config: 1; usbmux in config(s): 3,4` と出る）。
どちらに転んでも通らない板挟みで、抜けるには Zadig で
「Apple Mobile Device USB Device」インターフェースのみ WinUSB に差し替えるしかない。
複合親デバイスに当てると同期・バックアップごと壊れるので注意。

**.ipa が現実解。** sign.expo.dev が出す .ipa は既に開発証明書で署名済みなので、
Windows のインストーラ（Sideloadly / iMazing / 3uTools など）で端末へ流し込む。
いずれもネイティブアプリなので WebUSB の排他問題を踏まない。
iTunes 同梱の Apple ドライバは必要。

**そもそも SDK 54 に留まれば全部要らない。** `sdk-54` ブランチなら
App Store の Expo Go がそのまま使え、署名も USB も7日ごとの入れ直しも発生しない。

#### 詰まったところ: Device の手順で UDID を手入力する

**自動のデバイス検出が失敗すると `Your Apple ID session expired, sign in again.` が
出続けて先に進めなくなる。エラー文言と実際の失敗箇所が対応していない。**
Apple ID の認証は通っているので、いくら入れ直しても解決しない。

Device の手順で **UDID を手で貼り付ければ通る。**
UDID は端末ごとに変わらないので、証明書が切れて入れ直すときも同じ値を使える。

#### 名前が紛らわしいので注意

Apple 側に似た名前のものが2つあり、必要なのは無料のほう。

| | 費用 | 範囲 |
|---|---|---|
| Apple Developer **Agreement**（契約） | **無料** | 自分の端末での実機テスト。7日ごとに更新、端末3台まで |
| Apple Developer **Program**（プログラム） | $99/年 | App Store 配布、TestFlight、App Store Connect |

developer.apple.com では**サインインするだけ**にする。
「Enroll」は $99 の課金導線なので押さない。
sign.expo.dev が使うのは無料側の free provisioning。
`eas go` が有料なのは TestFlight 配布が有料側の機能だから。

ネイティブモジュールを足す段階（iCloud 連携など）になると
自前の development build が必要になり、そこで初めて Developer Program が要る。

## 検査

```bash
npm run check
```

- `tsc --noEmit`
- ブリッジに埋めた JavaScript の構文チェック（実機でしか走らないコードなので手元で落とす）
- front matter 切り出しのテスト

## まだやっていないこと

- pptx の座標（EMU）を読んだ実際の描画
- テンプレート取り込みとレイアウト名の書き換え（配線盤 UI）
- iCloud Drive の .md を開いて上書き保存する経路の検証 — **ここは早期に確認が要る**
- pandoc.wasm の同梱（今は unpkg から取得。バージョンは 1.1.0 に固定済み）
