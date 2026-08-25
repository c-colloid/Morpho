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

**このブランチは SDK 54 に固定してある。**
App Store の Expo Go が SDK 54 で凍結されており、SDK 55 以降は承認されていないため、
54 に留まっているかぎり **App Store の Expo Go をそのまま使える**。
Apple ID も Developer Program も、署名の入れ直しも要らない。

main は SDK 57。実機に入れる経路が確保できたらそちらへ戻す。

| 経路 | 費用 | Mac | 保守 | SDK |
|---|---|---|---|---|
| **App Store の Expo Go**（このブランチ） | 無料 | 不要 | 不要 | 54 まで |
| sign.expo.dev | 無料 | 不要 | 約7日ごとに再署名 | 57 可 |
| `npx eas-cli@latest go` | $99/年 | 不要 | 1年 | 57 可 |

ネイティブモジュールを足す段階（iCloud 連携など）になると
どの道 development build が必要になり、そこで初めて Developer Program が要る。

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
