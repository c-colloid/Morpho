# 足場の整理（2026-09）— 設計と検証

`development-plan-2026-09.md` の 3-B / 3-D（PDF）/ 3-E を、この環境（iPad なし・Node あり）で
進められる範囲に切り出して設計した。実機周回（3-C）と実機でしか測れない計測（遅延・ヒープ・
オフライン）は含まない。**動作を変えない**ことが全体の制約で、`npm run check` が前後で緑であること、
ブリッジの配信文字列がバイト単位で変わらないことを機械で確かめる。

「事実」はこの環境で実際に動かして確認したもの。推測には「未検証」を付ける。

---

## 0. 前提として確認した事実

| 事実 | 確認方法 |
|---|---|
| `npm run check` はネットワークなしで緑（`npm ci` 後） | この環境で実行。検査は pandoc.wasm を `node_modules/pandoc-wasm` から読む（CDN を叩くのは実機のブリッジだけ） |
| `check` の内訳: `tsc --noEmit` + 検査 16 本・396 件 ok | 同上 |
| Node 22.22 で `--experimental-strip-types` が動く | 同上 |
| CI（`build-ipa.yml`）は `check` を回していない | ワークフローを読んだ |
| ブリッジの配信 HTML は 108,350 bytes。バッククォート 47 個・バックスラッシュ 714 個・`${` は 0 個 | `bridgeHtml.ts` のテンプレートリテラルを評価して数えた |
| ブリッジの `<script>` は 3 つ: importmap（JSON）・起動前の見張り（classic）・本体（module） | 同上 |
| 検査 5 本（`check-bridge` / `check-scene` / `check-deck` / `check-columns` / `check-footer`）と dump 2 本が `bridgeHtml.ts` を読んで、`export const BRIDGE_HTML` の後ろのバッククォートから最後のバッククォートまでを `new Function` で評価している | スクリプトを読んだ |
| **pandoc.wasm は PDF を出せない**（下記 D） | この環境で実行 |

---

## A. CI に `check` ジョブを足す

### 設計

- 新規ワークフロー `.github/workflows/check.yml`。`build-ipa.yml` には触らない
  （あちらは macOS runner・60 分・main のみ。用途が違う）
- トリガー: `pull_request`（全ブランチ）と `push`（全ブランチ）。paths は `app/**` と
  ワークフロー自身。文書だけの変更では走らない（ipa と同じ除外）
- `ubuntu-latest` / Node 22 / `npm ci` / `npm run check`。npm キャッシュは `actions/setup-node` の
  `cache: npm` に任せる（`app/package-lock.json` をキー）
- ネットワークは `npm ci` にだけ要る。検査自体は node_modules の wasm を使うので
  actions/cache に wasm を載せる必要はない（前提 0 で確認）

### 検証

- ローカルで同じ手順（`npm ci && npm run check`）が緑であること（確認済み）
- push 後に Actions で緑になること（**この環境からは見られない。push 後に確認**）

---

## B. ブリッジをテンプレートリテラルから実ファイルへ分ける

### 目的

`bridgeHtml.ts` は 2,914 行のテンプレートリテラルで、中の JS は tsc も lint も
エディタの構文強調も効かない。加えて「`` ` `` と `${` を使うな」「正規表現の `\` は `\\` と書け」という
二重エスケープの制約があり、書き間違えると実機でしか分からない。
**配信される文字列は 1 バイトも変えずに**、中身を普通の `.js` / `.mjs` / `.html` として置く。

### 設計

```
app/src/converter/bridge/
  shell.html     外枠。importmap と <script> の位置に /*@boot*/ /*@main*/ の目印
  boot.js        起動前の見張り（classic script。window.__rn と boot-error）
  main.mjs       本体（ES module。pandoc の起動・変換・OOXML 解析・後処理・書き出し）
app/scripts/build-bridge.mjs
  上の 3 つを束ねて app/src/converter/bridgeHtml.ts を生成する
```

- **生成物 `bridgeHtml.ts` はコミットする。** Expo の dev client にはビルド前フックが無く、
  Metro は import されたファイルしか見ないため、TS から読める形の生成物が要る
- 生成は `npm run build:bridge`。`npm start` の `prestart` からも呼ぶ（手動の忘れを減らす）
- 生成側のエスケープは機械的に 3 種類だけ: `\` → `\\`、`` ` `` → `` \` ``、`${` → `\${`。
  評価すれば元の文字列に戻るので、**既存の検査スクリプト 5 本と dump 2 本は無改修**
  （`export const BRIDGE_HTML` の後ろから最後のバッククォートまでを評価する経路はそのまま）
- `.mjs` / `.html` は import されないので Metro のバンドルに入らない。`tsconfig` は
  `allowJs` を持たないので tsc も見ない。**型検査を効かせるのは次の段階**（`// @ts-check` を
  main.mjs の先頭に足して直していく。今回はやらない — 動作を変えない縛りの外）
- 元ファイル冒頭の解説コメント（CDN の制約・importmap・postMessage の経路）は `main.mjs` の
  先頭へ移す。`bridgeHtml.ts` の先頭は「生成物。編集は bridge/ で」の 3 行だけ

### 一度きりの移行

現在の `bridgeHtml.ts` を評価して得た HTML を 3 ファイルに割る。割り方は `<script>` タグの
位置（前提 0 で確認した 3 箇所）で機械的に決める。手で写さない。

### 検証（`check-bridge.mjs` を書き換える）

1. **同一性:** `build-bridge.mjs` がメモリ上で束ねた文字列と、コミット済み `bridgeHtml.ts` の
   中身が**バイト単位で等しい**こと。違えば「`npm run build:bridge` を実行せよ」で赤。
   これが「生成物の更新忘れ」を CI で止める仕掛け
2. **移行の同一性（一度きり）:** 移行前の `bridgeHtml.ts` を評価した HTML と、
   移行後に生成した `bridgeHtml.ts` を評価した HTML の sha256 が一致すること。
   移行コミットの前にこの環境で確認し、結果を本ファイルに記す
3. **構文:** `node --check` を `boot.js` と `main.mjs` に直接かける（従来は一時ファイルへ
   書き出していた。もう要らない）
4. importmap の JSON 妥当性（従来どおり）
5. `npm run check` 全体が緑

---

## C. EditorScreen からプレビュー同期を hook に出す

### 目的

`EditorScreen.tsx`（2,729 行）のうち、変換の投入・結果の保持・形式の切り替え・
再変換の引き金を `usePreviewSync` に集める。テーマ層（v0.19）が触るのはこの部分
（変換オプションにテーマを渡す・テーマ変更で再変換する）なので、先に一箇所にしておく。
全面分割はしない。

### 切り出す範囲（EditorScreen の該当行を読んで決めた）

| いま EditorScreen にあるもの | hook へ |
|---|---|
| `result` / `webResult` / `docResult` / `error` / `busy` の state | 移す |
| `previewFormat` と `previewFormatRef` | 移す |
| `resultRef`（他の処理が deck を読む） | 移して返す |
| `runner`（`LatestOnly`。front matter 剥がし → `converter.convert` → 結果の振り分け） | 移す |
| `convTimer`（手が止まって `IDLE_MS` 後の変換） | 移す |
| `textSizesKey` の効果（文字サイズ・帯モードが変わったら 300 ms 後に再変換） | 移す |
| `handleFormatChange`（形式切替で即時変換・デバウンス解除） | 移す（`setFormat`） |
| テンプレート預け・画像預け・フッター変更・文書切替からの「今すぐ変換」 | `refresh(md?, { quiet? })` を呼ぶ形に置き換える |
| `resetPreviewFor` のうち結果の破棄 | `reset(text)` を呼ぶ。カード座標や強調位置の破棄は EditorScreen に残す |

hook の入力は `converter` / `ready`（`status.phase === 'ready'`）/ `activeId` / `source` /
`designRef`（変換オプションに文字サイズ・帯モード・フッターを渡す）/ `design.text` と
`design.captionTitle`（再変換の引き金）。

### 動作を変えないための決まり

- 変換オプションの組み立て（`sanitizeForXml(splitFrontMatter())`・`toExportSizes`・
  `toDocFooter`・`useTemplate`）は**関数ごと移す**。書き換えない
- `refresh` は従来どおり `setBusy(true)` してから投げる。フッター変更の経路だけ従来
  `setBusy` を呼んでいないので、`{ quiet: true }` で同じにする
- Web の結果は HTML が同一なら state を差し替えない（WebView の再ロード抑止）— そのまま移す
- 形式切替時にデバウンスを解除する順序もそのまま

### 検証

- `tsc --noEmit` が緑（EditorScreen は検査スクリプトの対象外なので、型と目視が頼り）
- `npm run check` が緑
- 差分の読み合わせ: 移した各効果について「依存配列」「ref 経由の読み取り」が元と同じことを
  一つずつ確認する（本ファイル末尾のチェックリスト）
- **実機の確認は 3-C の周回に含める**（`status-and-plan.md` の受け入れ条件 4「書き戻しでキャレットが
  飛ばない」と同じ周で、形式切替・テンプレート変更・画像挿入後にプレビューが取り直されること）

---

## D. PDF の実験（決着）

`pandoc-wasm` 1.1.0（pandoc 3.10）を Node から回した実測:

| 指定 | 結果 |
|---|---|
| `to: 'pdf'`（既定エンジン） | 出力なし。`ERROR: /tmp/media-…: createDirectory: does not exist` |
| `to: 'pdf', 'pdf-engine': 'typst'` | 出力なし。**`ERROR: typst: runInteractiveProcess: unsupported operation`** |
| `to: 'typst'` | **動く**。Typst のマークアップが stdout に出る（`= 見出し` …） |

**結論: pandoc.wasm は PDF を生成できない。** PDF エンジンはサブプロセスとして起動する設計で、
WASI にプロセス生成が無い（iOS と同じ理由）。これは原理的な制約で、版が上がっても変わらない。

**PDF を出すなら経路は 1 つ:** pandoc → Typst マークアップ → **Typst 自体の WASM ビルド**
（`typst.ts` 等。Apache-2.0）を同じ WebView に載せて PDF を組む。CJK フォントを WASM FS に
置く必要がある（CLAUDE.md 既記の「優先度低」の項目）。pandoc 側の仕事は `to: 'typst'` で
済んでいるので、残りは第 2 のエンジンの同梱とフォントの手当てで、変換器の境界（`Converter`）の
中に閉じる。**着手は v0.20（刷り分け）以降。** README の「PDF / epub」の行は
「pandoc では出せない。Typst の WASM を足す設計」に書き換える。

---

## E. テーマ層に向けた「pandoc では実現できない組版要件」の一覧

`theme-layer.md` に置く。各項目に「テーマ層（reference-doc / Lua / OOXML 後処理）で
吸収できるか」「writer の差し替えが要るか」を付ける。CLAUDE.md の落とし穴と
`columns-and-images.md` / `column-input.md` / `footer-design.md` の実測から引く。
これはテーマのスキーマを列比だけで切らないための材料（`roadmap-pptx.md` の注意）。

---

## 版と記録

- 版は **0.18.1**（`app.json` / `package.json`。CHANGELOG の規則「push のたびに上げる」に従う）。
  中身は内部の整理と CI で、画面の動作は変えない。`development-plan-2026-09.md` の
  「0.18.x は周回の patch」に「足場の整理も混ざる」と注記する
- CLAUDE.md: 「未検証項目」から PDF を外し、落とし穴ではなく実測値として D を書く。
  リポジトリ構成に `bridge/` と `check.yml` を足す
- DEVELOPMENT.md: 構成ツリーと検査表を更新する

## 検証の記録（2026-09-10・この環境で実施）

- [x] **B-2 移行の同一性:** 移行前後とも `sha256 = e6b0a61219ea7d1eb0385b28ffa45da9f7695f50429f00819828d7bad87a93f2`
  （108,350 bytes）。`bridgeHtml.ts` の差分は先頭コメントの 20 行だけ
- [x] **`npm run check`:** B の後・C の後の 2 回とも緑（`tsc` + 検査 16 本。ok 396 件 + check-bridge の 5 件）
- [x] **C のチェックリスト**（移した効果と元の対応）:

  | 移したもの | 依存配列 / ref | 元との差 |
  |---|---|---|
  | `runner`（LatestOnly） | `[converter, designRef]`（designRef は安定した ref） | なし。オプションの組み立ては関数ごと移した |
  | デバウンス変換 | `[source, ready, runner, activeId]` | 元は `status.phase` で、ready 以外の相の変化でも効果が走って早期 return していた。`ready` の真偽値にしたので走る回数が減るだけで結果は同じ |
  | 文字サイズ・帯モードの再変換 | `[textSizesKey, activeId]` | なし。`readyRef` で読む（元は `statusRef`） |
  | `handleFormatChange` | `[]` | なし。デバウンス解除 → 即時変換の順もそのまま |
  | `refreshPreview` | `[]`。`readyRef` / `sourceRef` / `previewFormatRef` / `runnerRef` を ref で読む | 元の 4 箇所（テンプレート・画像・フッター・文書切替）は `statusRef.current === 'ready'` を見てから `setBusy(true)` → `submit` していた。フッターの経路だけ `setBusy` を呼んでいなかったので `{ quiet: true }` で同じにした |
  | `resetPreviewFor` | `[resetPreview]`（安定） | 結果の破棄と即時変換を hook 側へ。カード座標・強調位置の破棄は EditorScreen に残した |
  | `statusRef` | 削除 | hook 化で読み手がいなくなった |

- [ ] **Actions の `check` が緑** — push 後に確認する（この環境からは見られない）
