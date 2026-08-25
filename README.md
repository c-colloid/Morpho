# Morpho

一つの Markdown 原稿から、スライド・書籍・PDF・Web を刷り分ける iPad 向けエディタ。
変換エンジンに [pandoc](https://pandoc.org/) の WebAssembly ビルドを使う。

名前は「多形（polymorphism）」とモルフォ蝶から。

現在は**企画検証フェーズ**。設計判断と実測結果は [`CLAUDE.md`](CLAUDE.md) にまとまっている。

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

このファイルは将来 WKWebView に載せるブリッジのプロトタイプでもある。

## fixtures

| ファイル | 内容 |
|---|---|
| `pptx-benchmark.md` | 50枚規模のテストデッキ。各スライドに「何を検証しているか」が書いてある |

比較用の基準出力は次で再生成する（pandoc 3.1.3 では 64 枚、3.9 では 52 枚になる）:

```bash
pandoc fixtures/pptx-benchmark.md -o fixtures/pptx-benchmark-reference.pptx
```

## セットアップ

GitHub Pages を有効化する:

```bash
gh api repos/c-colloid/Morpho/pages -X POST \
  -f 'source[branch]=main' -f 'source[path]=/docs'
```

Settings → Pages で Source を `main` / `/docs` に設定しても同じ。

## ライセンス

このリポジトリのコードは MIT。
実行時に読み込む pandoc.wasm は **GPL-2.0-or-later**。
配布形態の判断は `CLAUDE.md` の「制約とリスク」を参照。
