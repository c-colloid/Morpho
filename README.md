# Morpho

**一つの Markdown 原稿から、スライド・書籍・PDF・Web へ。**

Morpho は iPad で動く単一ソース出版エディタです。
Markdown で内容を書けば、PowerPoint スライドや Word 文書に刷り分けられます
（PDF・Web 書き出しは今後の予定）。
内容は Markdown に、見た目はテーマとデザインデータに——という分離を軸に、
ルビ・傍点・縦書きといった日本語組版を最初から視野に入れて開発しています。

![Morpho の編集画面。左に Markdown 原稿、右にスライドの実寸プレビュー。カーソル位置のスライドが強調されている](assets/screenshot.png)

## 特徴

- **日本語入力が壊れない** — エディタは iPad ネイティブのテキスト入力。
  変換候補・確定前の下線・カーソル操作が OS そのまま
- **実寸ライブプレビュー** — 変換結果の pptx（実際の出力そのもの）を解析し、
  座標・配色・字サイズまで 16:9 の実寸で描画。手が止まると自動で更新。
  プレビューはスライド / 文書（docx 出力）/ Web（HTML 出力）で切り替え可能
- **スライドショーと発表者ビュー** — 全画面再生、ノート・次スライド・経過時間の表示
- **プレビューから原稿を整える** — スライドをタップして該当箇所へジャンプ、
  段落を長押しして改行位置を語 / 字の単位で調整（単語の途中で折り返される
  のを直す）、発表者ノートもその場で編集
- **書き出しと連携** — pptx / docx / md を Files（iCloud）へ。Obsidian への送信にも対応
- **原稿は端末の外に出ない** — 変換はすべて端末内（pandoc の WebAssembly ビルド）で
  行われ、原稿が外部サーバーへ送られることはありません。
  初回起動時のみ、変換エンジン（55.9 MB）の取得にネット接続が必要です

## ステータス

開発中です。現在 **v0.13.0**（[変更履歴](app/CHANGELOG.md)）。
上記の特徴はすべて iPad 実機で動作しています。

実装済みの主なもの: 実寸ライブプレビュー（スライド / 文書 / Web）・スライドショーと発表者ビュー・
装飾とグループ・**テンプレート配線盤**（0.11.0）・**ルビと傍点**（0.12.0）・**画像**（0.13.0）・
外部ファイルのその場編集。

これから作るもの:

| 予定している主なもの | 内容 |
|---|---|
| 段組みと画像配置 | 横 2 段のレイアウトと、画像の大きさ・位置の指定 |
| テーマ | 見た目の定義を原稿から切り離し、文書間で使い回せるようにする |
| 日本語組版の続き | ルビ・傍点の先にある縦書き |
| PDF / epub 書き出し | 日本語 PDF（Typst 経由を検討）と電子書籍 |

現在地と残りの計画は [`notes/status-and-plan.md`](notes/status-and-plan.md)、
段組みと画像配置の設計は [`notes/columns-and-images.md`](notes/columns-and-images.md)、
三層分離（内容 / テーマ / デザインデータ）の中期計画は
[`notes/roadmap-pptx.md`](notes/roadmap-pptx.md)。

## 試す

App Store 未公開のため、現状はサイドロードが必要です（iPadOS 15.1 以降）。

- 試す: [Releases](https://github.com/c-colloid/Morpho/releases) の ipa を
  AltStore / SideStore で入れる。手順と使い方は [`app/README.md`](app/README.md)
- 開発する: Expo Go + 開発サーバ。手順は [`app/DEVELOPMENT.md`](app/DEVELOPMENT.md)

## 仕組み

```
[エディタ (React Native)] ─ Markdown ─▶ [変換器] ─ 解析結果 ─▶ [プレビュー]
                                          │
                                          └─▶ pptx / docx（書き出し）
```

変換器は不可視 WebView 上の [pandoc](https://pandoc.org/) WebAssembly ビルドです。
エディタと変換器の間には差し替え可能な境界（`Converter` インターフェース）があり、
エディタ側は変換器の実装を知りません。

設計判断とその根拠（すべて実測に基づく）は [`CLAUDE.md`](CLAUDE.md)、
検証の経緯は [`notes/findings.md`](notes/findings.md) にあります。

## ライセンス

このリポジトリのコードと文書は [MIT ライセンス](LICENSE)です。

変換エンジンとして利用している pandoc（WebAssembly ビルド）は
**GPL-2.0-or-later** で、このリポジトリには含まれません（アプリが実行時に取得します）。
pandoc.wasm を**同梱して配布**する場合は、その配布物が GPL の条件に従う必要があります。
配布形態の検討は `CLAUDE.md` の「制約とリスク」を参照してください。
