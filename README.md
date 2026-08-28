# Morpho

一つの Markdown 原稿から、スライド・書籍・PDF・Web を刷り分ける iPad 向けエディタ。
変換エンジンに [pandoc](https://pandoc.org/) の WebAssembly ビルドを使う。

名前は「多形（polymorphism）」とモルフォ蝶から。

## 現在地

企画検証を終え、**アプリ本体（`app/`）を実装中**。現在 **v0.4.1**。

エディタ・実寸プレビュー・スライドショー・発表者ビュー・pptx / docx 書き出し・
複数文書管理・プレビューからのノート / 改行位置編集までが iPad 実機で動く。
使い方と開発手順は [`app/README.md`](app/README.md)、
版ごとの変更は [`app/CHANGELOG.md`](app/CHANGELOG.md) を参照。

設計判断と実測結果は [`CLAUDE.md`](CLAUDE.md) にまとまっている。
ここに書いてあることは実際に動かして確認した内容で、再検証は不要。

## リポジトリ構成

| 場所 | 内容 |
|---|---|
| `app/` | アプリ本体（React Native + Expo） |
| `docs/index.html` | GitHub Pages で公開する検証ハーネス |
| `fixtures/pptx-benchmark.md` | 50枚規模のテストデッキ（自己診断型・**書き換えない**） |
| `notes/` | 検証の経緯と機能ロードマップ |
| `scripts/init.sh` | GitHub Pages 有効化と基準出力の再生成 |

## 検証ハーネス

**https://c-colloid.github.io/Morpho/**

ブラウザ内で完結する pandoc 3.9 の動作確認ツール。サーバーには何も送信しない。

- PowerPoint テンプレート（`.pptx`）のレイアウト名が pandoc の要求と一致するか検査する
- 一致しないレイアウトを手動で割り当て、変換前に名前を書き換える
- Markdown を pptx に変換し、スライド数・変換時間・出力サイズを測る
- 警告を重要度別に分類して表示する
- 連続変換で WASM ヒープが増え続けないかを測る（ライブプレビュー可否の判定用）

iPad の Safari で開き、テンプレートを選んで「pptx に変換」。
初回は pandoc.wasm（55.9 MB）のダウンロードが入る。

## セットアップ

GitHub Pages の有効化と、fixtures の基準出力（pandoc 3.1.3 で 64 枚、3.9 では
52 枚になる）の再生成は `scripts/init.sh` が両方やる:

```bash
scripts/init.sh
```

## ライセンス

このリポジトリのコードは MIT。
実行時に読み込む pandoc.wasm は **GPL-2.0-or-later**。
配布形態の判断は `CLAUDE.md` の「制約とリスク」を参照。
