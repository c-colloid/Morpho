# v0.14 壊れない土台 — 設計と検証

段組み（`::: {.columns}`）は今日すでに原稿に書ける。pandoc が受け付けるので、
アプリは何も止めていない。**書くと崩れ、編集すると原稿が壊れる。**
その 6 件を 1 つの版として設計し、**6 件を同時に当てた状態で測り直した**記録。

技術事実は pandoc-wasm 1.1.0（= **pandoc 3.10**）を Node から回した実測。
**実機 iPad・PowerPoint での見え方はすべて未検証**で、そこは個別に明記する。
前提は `status-and-plan.md`（A-1〜A-6 の棚卸し）と `columns-and-images.md`（段組みの設計）。

---

## 何を直すか

| # | 症状 | 原因 | 修正 | 検証 |
|---|---|---|---|---|
| A-1 | 右の列だけ文字が縦中央に寄る | `findInherited` の idx 照合がレイアウトからマスターへ越境し、マスターの**日付枠**（`idx="2" type="dt" anchor="ctr"`）を拾う | 照合に「この phList はスライドの idx と同じ名前空間か」を渡し、idx はレイアウト内に閉じる | 実測。右列 anchor `'ctr'` → `null` |
| A-2 | Comparison で左右の見出しが重なる | 同関数が type を idx より先に見るため、`type="body"` が 2 つあるレイアウトで先頭勝ち | 段 1 で idx 照合、外れたら type へ | 実測。右見出し x=457200 → **4645026** |
| A-3 | 列の中で長押し → 改行確定で `:::` が本文に溶け段組みが消える | `locateEditable` の行種別に fenced div が無い | 行種別 `'div'` を足す。あわせて**インライン記法の内側に改行を置かせない** | 実測。柵が保たれ、画像・ルビ・傍点も壊れない |
| A-4 | 画像挿入がフェンス行を 3 行に割る | カーソル位置へ直接 splice（`patchBody` を通らない） | 位置決めを純関数 `insertBlock` に切り出し `patchBody` へ統一。着地は**カーソルのいるスライド区間の末尾** | 実測。66 カーソル位置で健全 **7 → 66**、回帰 0 |
| A-5 | 表のある列が丸ごと空白 | `parseShapes` は `<p:sp>` しか見ない | `parseTables`（`p:graphicFrame`）を足し、枠と行数・列幅だけ描く | 実測。ベンチマークの表 13 個すべてが枠として出る |
| A-6 | 段組みの本文が 14% 大きい / 画像付きスライドのタイトルが 2.2 倍 | レイアウト固有の `lstStyle` を読まない | `parseLvlStyle` で階層別・プロパティ別に解決し、A-1/A-2 と**同じ照合器**に乗せる | 実測。Two Content 本文 2400 → 2100、Content with Caption タイトル 3300 → 1500 |
| 追加 | ガードの層取り違え（表を 1 つ入れると装飾まで止まる） | `contentIndexOf` を装飾も通していた | 装飾だけ外す。Alert の文面と案内先を作り直す | 実測。原因の名指しは件数が合うときだけ |

**A-1 は段組み専用の問題ではない。** `Content with Caption`（本文 → 画像の並び）の本文枠も
`<p:ph idx="2">` なので同じ経路でマスターの日付枠を拾う。画像を使えば段組みを書かなくても出る。
`fixtures/pptx-benchmark.md` も**現状で既に発症している**（Two Content 2 枚 + Content with Caption 1 枚）。

---

## 検証のしかた

`bridgeHtml.ts` の生ソースへ文字列パッチを当ててから vm で評価し、
本物の `pandoc.wasm` が作った pptx を `__morphoParsePptx` に食わせて
**「現状」と「修正後」を同じ入力で並べる**ハーネスを作った。

- 純 TS（`lineBreakEdit.ts` / `blockInsert.ts` / `cursorSlide.ts`）は
  `node --experimental-strip-types` で本物を import する（`scripts/check-linebreak.mjs` と同じ作法）
- RN のコンポーネント（`SlideSurface.tsx` / `EditorScreen.tsx`）は node で動かないので、
  **対象のロジックを逐語で写して**実行した。写して確かめたものは本文でそう明記する
- パッチを当てた `app/` の複製で `npm run check` を通した

この方式でないと「設計しただけ」から抜けられない。**本文の数値はすべてこの実行結果**で、
実機で見た値ではない。

---

## 修正 1: 継承照合（A-1 / A-2）

### 再現

段組み原稿 1 本（非 INFO 警告 0）:

| ph | idx | x | 現状 anchor | 期待 |
|---|---|---|---|---|
| body | 1 | 457200 | null | null |
| body | 2 | 4648200 | **'ctr'** | null |

`SlideSurface.tsx:251` は `anchor` が `'ctr'` か `'b'` のときだけ縦位置を寄せるので、
右列だけ縦中央に描かれる。

列に画像を入れると pandoc は Comparison を選ぶ。そのとき（非 INFO 警告 0）:

| ph | idx | 現状 x | 期待 x |
|---|---|---|---|
| body | 1 | 457200 | 457200 |
| body | 3 | **457200** | **4645026** |

左右の見出しが完全に同じ矩形になり、文字が重なる。

### 原因

**マスターとレイアウトで `idx` の名前空間が別物**。実測:

```
slideMaster1   title(anchor=ctr) / idx=1 type=body(anchor なし)
               idx=2 sz=half type=dt anchor=ctr / idx=3 ftr / idx=4 sldNum
Two Content    idx=1 sz=half x=457200 cx=4038600 / idx=2 sz=half x=4648200 cx=4038600
               （どちらも anchor なし）/ idx=10 dt / idx=11 ftr / idx=12 sldNum
Comparison     idx=1 type=body x=457200 anchor=b   ← type="body" が 2 つ
               idx=3 type=body sz=quarter x=4645026 anchor=b
```

レイアウトの日付枠は idx=10、マスターは idx=2。
スライドの `<p:ph idx="2">`（右の列）がマスターの日付枠に当たる。

### 設計

`findInherited` に第 5 引数 `same` を足し、**呼び出し側が階層を宣言する**
（レイアウト = true / マスター = false）。規則は 4 段で、最初に値を返せた段で確定する。

```js
/* 日付・フッタ・スライド番号・ヘッダ・ノートのスライド画像。
   本文ではないので「レイアウト内では」body へ落とさない
   （落とすと Comparison の左見出し枠を拾う）。配列で持つのは
   オブジェクトだと type="constructor" 等がプロトタイプ由来で真になるため */
var PH_FURNITURE = ['dt', 'ftr', 'sldNum', 'hdr', 'sldImg'];
function isFurniture(t) { return PH_FURNITURE.indexOf(t) >= 0; }

function findInherited(phList, type, idx, key, same) {
  var wants = type === 'ctrTitle' ? ['ctrTitle', 'title'] : [type];
  var want = wants[wants.length - 1];
  /* 1. idx 優先。レイアウト内に閉じる */
  if (same && idx !== null) {
    var seen = false;
    for (var i = 0; i < phList.length; i++) {
      if (phList[i].idx !== idx) continue;
      seen = true;
      if (phList[i][key]) return phList[i][key];
    }
    /* その idx の枠は在るが値を持たない → 兄弟の枠ではなく上位階層へ */
    if (seen) return null;
  }
  /* 2. type 照合 */
  for (var w = 0; w < wants.length; w++) {
    for (var j = 0; j < phList.length; j++) {
      if (phList[j][key] && phList[j].type === wants[w]) return phList[j][key];
    }
  }
  /* 3. subTitle 等の本文系は body に落とす。レイアウト照合のときだけ
     装飾枠を除く（マスターでも除くと、日付枠を持たないテンプレートで
     frame が null になり図形がプレビューから消える。実測） */
  if (want !== 'title' && !(same && isFurniture(want))) {
    for (var k = 0; k < phList.length; k++) {
      if (phList[k][key] && phList[k].type === 'body') return phList[k][key];
    }
  }
  /* 4. 最後の手段の idx 照合。type を書かないマスター（<p:ph idx="1"/>）向けの保険。
     pandoc 既定テンプレートでは一度も通らない（実測） */
  if (idx !== null && !isFurniture(want)) {
    for (var m = 0; m < phList.length; m++) {
      if (phList[m][key] && phList[m].idx === idx && !isFurniture(phList[m].type)) {
        return phList[m][key];
      }
    }
  }
  return null;
}
```

呼び出し側は `findFrame(layoutPh, …, true) || findFrame(deck.masterPh, …, false)`。

**「枠はあるが値が無い」を素通しする**のがこの設計の要。段 1 で `seen` を立てて
`null` を返すことで、兄弟の枠を誤って拾わず上位階層へ渡せる。

### 検証結果

- 段組み: 右列 anchor `'ctr'` → `null`、x=4648200 は不変
- Comparison: 右見出し 457200 → **4645026**、幅 4040188 → 4041775
- ベンチマーク 64 枚・図形 99 個: **frame が null の図形は前後とも 0**。
  変わったのは 3 個だけ（Two Content 右列 anchor ×2、Content with Caption 本文 anchor ×1）
- 装飾（`placeholder === null`）は自前 xfrm を持つので影響なし

### 境界条件

- 段 4 は pandoc 既定テンプレートでは一度も通らない（実測で no-op）。
  型を書かないマスターへの保険として残すが、「今日は誰も踏まないコード」と明記する
- **`Comparison` は idx=2/4 も使う。** 列に何を書くかで ph の集合が変わるので、
  「idx 1/3 だけ」を前提にしないこと
- 列プレースホルダが `<a:xfrm>` を持たないテンプレートでは、右列がマスターの全幅本文枠へ
  落ちて左列を覆う（OOXML どおりの挙動。**警告ゼロ**）。検査は `check-template` へ

---

## 修正 2: レイアウト固有の lstStyle（A-6）

### 実測した真値

```
master        titleStyle lvl1 = 3300 / bodyStyle lvl1 = 2400
Two Content            body idx1/idx2 = 2100      （マスターより -14%）
Comparison             body idx1..4  = 1800       （-25%）
Content with Caption   title = 1500 / body#2 = 1050（タイトルはマスターの 45%）
Picture with Caption   title = 1500
Section Header         title = 3000 / body#1 = 1500
Title and Content      なし（DeckInfo の既定へ）
```

### 設計

`parseLvlStyle` が `<a:lstStyle>` の `lvlNpPr`（対・自己閉じの両方）から
`sz / marL / indent / algn / buNone` を**疎な配列**で拾い、**何も拾えなければ null** を返す。
解決は `findInherited(..., 'lvlStyle', true)`（レイアウト）に図形自身を重ねる。
マスターは `DeckInfo` が持っているので混ぜない。

```js
function parseLvlStyle(spXml) {
  var lst = /<a:lstStyle>([\s\S]*?)<\/a:lstStyle>/.exec(spXml);
  if (!lst) return null;
  var out = null;
  /* 対と自己閉じの両方を拾う（PowerPoint 製の reference-doc は
     <a:lvl1pPr marL="0" indent="0"/> のように自己閉じで書くことがある） */
  var re = /<a:lvl(\d)pPr\b([^>]*?)(\/>|>([\s\S]*?)<\/a:lvl\1pPr>)/g;
  var m;
  while ((m = re.exec(lst[1])) !== null) {
    var i = Number(m[1]) - 1;
    if (i < 0 || i > 8) continue;
    var attrs = m[2], body = m[4] || '', ent = null;
    var sz = /<a:defRPr[^>]*\bsz="(\d+)"/.exec(body);
    if (sz) { ent = ent || {}; ent.sz = Number(sz[1]); }
    var ml = /\bmarL="(-?\d+)"/.exec(attrs);
    if (ml) { ent = ent || {}; ent.marL = Number(ml[1]); }
    var ind = /\bindent="(-?\d+)"/.exec(attrs);
    if (ind) { ent = ent || {}; ent.indent = Number(ind[1]); }
    var al = /\balgn="(\w+)"/.exec(attrs);
    if (al) { ent = ent || {}; ent.algn = al[1]; }
    if (/<a:buNone(\s*\/>|>[\s\S]*?<\/a:buNone>)/.test(body)) { ent = ent || {}; ent.bullet = 'none'; }
    if (ent) { out = out || []; out[i] = ent; }
  }
  return out;
}
```

（`bridgeHtml.ts` はテンプレートリテラルなので、実際のソースでは後方参照 `\1` を
`\\1` と二重に書く。単一だと八進エスケープ扱いで構文エラーになる。
`applyTextSizes` の `lvlNpPr` 置換と同じ作法。）

### 「配列を常に返す」は成立しない

当初案の「同じ照合器に載せればそのまま解ける」は**取り下げた**。
配列を常に返す実装だと「配列は必ず truthy」なので段 2 で確定してしまい、
`sz` を持たない Comparison のタイトルがマスターの 3300 に届かない。
**「拾えなければ null」＋ 描画側のプロパティ単位フォールバック**の組で初めて成立する。

### A-1/A-2 との依存（この版の核心）

`same=true` を渡さないと `lvlStyle` だけが古い意味論（type 先勝ち）で解決される。
持ち込みテンプレートで実測:

| Comparison の見出し枠 | 真値 | A-6 だけ | A-6 + A-1/A-2 |
|---|---|---|---|
| idx=1 | 3200 | 3200 | 3200 |
| idx=3 | 1000 | **3200（誤り）** | **1000** |

さらに悪いことに、**A-6 だけを当てると純粋な後退になる**ケースがある。
Comparison の `idx=2`（type 属性なし）に箇条書きが入る原稿では、
A-6 単独だと `sz` は 1800 に近づく一方で `marL=0 indent=0` を拾って
**行頭記号が消えぶら下げが潰れる**（現状は marL も記号も正しい）。

→ **A-6 を A-1/A-2 より先に出すのは禁止。同じ版に入れる。**

### 境界条件

- シーン JSON は**その図形が実際に使う階層まで**で切る。切らないと段組み 30 枚で +37.3%、
  切って +10.7%（ベンチマークは +9.4%）。`parsePptx` の中央値は 3.22 → 3.67 ms
- `dt` / `ftr` / `sldNum` の真値はマスター側の lstStyle（日付 9pt）にあり、**v0.14 では読まない**。
  日付枠を 24pt で描く嘘は残る
- 引用ブロックと脚注は**ラン単位の `sz`**（2000 / 1800）を持つ。`lvlStyle` は階層の器なので表現できない
- 表紙の文字サイズ設定（`applyTextSizes`）はスライド側 `lstStyle` へ注入するので、
  `SlideSurface` の優先順位を **表紙の設定 > プレースホルダ固有 > デッキ既定** にして一致させる
  （写して実行・7 ケース一致）

---

## 修正 3: 表の枠（A-5）

`p:graphicFrame` は必ず自前の `<p:xfrm>` を持つ（reference-doc を与えても pandoc が絶対値で書く）。
継承は不要。

```js
function parseTables(slideXml) {
  var out = [];
  var re = /<p:graphicFrame\b[^>]*>([\s\S]*?)<\/p:graphicFrame>/g;
  var m;
  while ((m = re.exec(slideXml)) !== null) {
    var gf = m[1];
    /* 表以外の graphicFrame（グラフ・OLE・図表）は落とす */
    if (!/<a:tbl\b/.test(gf)) continue;
    var xf = /<p:xfrm\b[^>]*>([\s\S]*?)<\/p:xfrm>/.exec(gf);
    var frame = xf ? parseXfrm(xf[1]) : null;
    if (!frame) continue;
    var cols = [];
    var cre = /<a:gridCol\b[^>]*\sw="(\d+)"/g;
    var cm;
    while ((cm = cre.exec(gf)) !== null) cols.push(Number(cm[1]));
    out.push({ x: frame.x, y: frame.y, w: frame.w, h: frame.h,
      rowCount: (gf.match(/<a:tr\b/g) || []).length, colWidths: cols });
  }
  return out;
}
```

描画は**破線の枠 + 列の区切り + 「表 N行 × M列」**。行の横線は引かない
（行高は `h="0"` で出力に無く、罫線と塗りは組み込みスタイル参照）。
`phIdx` は載せない（左右どちらの表も `idx="1"` を書くため）。

### 検証で分かったこと

- **「列幅の合計 = 枠幅」は誤り**。1pt 刻みの丸めで、実測は 5 列 −38100 / 7 列 −50800 /
  11 列 −127000 / 13 列 −139700 EMU。区切り線は枠内へクランプすること
- `SlideSurface` はスライドショーと発表者ビューでも使われる。**ラベルは編集面だけ**に出す
- 引用・箇条書き・`::: notes` の中の表は pandoc が変換段階で落とす（INFO 1 件のみ）。
  A-5 は「pandoc が描いた表」しか救えない
- 1 枚に表が 2 つ出ると `p:cNvPr/@id` が重複する（シーンは正しい。**PowerPoint が拒むかは未検証**）

---

## 修正 4: 改行編集と fenced div（A-3）

### 柵の行種別

```ts
/* fenced div の柵（`::: {.columns}` / `::: notes` / `:::` / `::::::::`）。
   属性つき・素の1語・空白なし・3個以上の任意長・字下げ・引用符号つきを含む上位集合。
   拾いすぎは「特定できない」で止まるだけ、取りこぼしは原稿の破壊になるので、
   意図して上位集合を取っている */
const DIV_FENCE = /^[ \t]*(?:>[ \t]*)*:::+/;
/* 開き柵のうち notes のもの。中身は専用シートで編集するので候補から外す */
const NOTES_FENCE = /^[ \t]*(?:>[ \t]*)*:::+[ \t]*(?:\{[^}]*\.notes[^}]*\}|notes\b)/;
```

柵は 1 行で独立した境界（`kind: 'div'`、編集対象にはしない）。中身は従来どおり編集できる。
`notesDepth` を数えて `::: notes` の中は候補にしない（本文と同じ文がノートにもあると、
本文を長押ししてノートが書き換わる）。

### 反証で見つかった、より深い問題

**改行位置がインライン記法の内側に落ちると、画像・リンク・ルビ・傍点・強調が無警告で失われる。**
これは A-3 以前からある経路で、段組みとは無関係に今日も踏める。列の段落が編集できるようになると
露出が上がるので、同じ版で塞ぐ。

| 入力 | 現状の結果 |
|---|---|
| `![断面図の説明](yoko.png)` の途中で改行 | 画像が消え、本文に生の `![...]` が出る（警告 0） |
| 同・パスの内側で改行 | **pandoc が出力を一切生成しない**（`File 'yoko.p\ ng' not found`。落とし穴 3 の致命クラス。構造化警告は空） |
| `{漢字|かんじ}` の途中 | ルビが消え `{漢字|かんじ}` が生のまま出る（0.12.0 の機能が無警告で失われる） |
| `《《とても大事》》` の途中 | 傍点が消え、生の `《` が出る |
| `**とても大事な語**` の途中 | 生の `**` が出る |

```ts
/**
 * 改行を置けない区間（インライン記法の内側）。
 * ここへ `\` 改行を入れると記法が 2 行に割れて無警告で失われる（実測）。
 * 記法の外側（境界そのもの）は置けるので、区間は開区間として扱う。
 */
const INLINE_ATOMS: RegExp[] = [
  /!?\[[^\]\n]*\]\([^)\n]*\)/g,  /* 画像とリンク */
  /\{[^{}|\n]+\|[^{}|\n]+\}/g,   /* ルビ */
  /《《[^》\n]+》》/g,              /* 傍点 */
  /`[^`\n]+`/g,                  /* コードスパン */
  /\*\*[^*\n]+\*\*/g,            /* 太字 */
];

export function canBreakAt(plain: string, offset: number): boolean {
  for (const re of INLINE_ATOMS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(plain)) !== null) {
      if (offset > m.index && offset < m.index + m[0].length) return false;
    }
  }
  return true;
}
```

`applyBreaksAtOffsets` の `filter` に `canBreakAt` を足す。

**意図した縮退**（検査に固定する）: pandoc が 1 段落として正しく描く原稿でも、
行頭が `:::` の行を含むと改行編集ができなくなる（**破壊はしない**）。
禁止区間に落ちたタップも無反応になる。どちらも v0.15 でシートの刻みから外して見えるようにする。

---

## 修正 5: 画像挿入の統一（A-4）

位置決めを純関数 `app/src/text/blockInsert.ts` に切り出し、`patchBody` で書き戻す。
着地の規則はすべて実測から出ている。

- 行の途中には入れない。前後に空行を確保して独立段落にする
- カーソルが列の中なら**その列の中身の末尾**。列の外でも段組みがあれば**最後の列の中**
- 3 列目以降は着地点にしない（pandoc が無警告で捨てる）
- それ以外は**カーソルのいるスライド区間の末尾**（末尾の `***`・空行・`::: notes` は越えない）
- コードフェンスは**種類と長さ**で閉じる（```` ````markdown ```` の中の ``` でトグルを反転させない）
- 判定のときだけ行末 `\r` を落とす（CRLF）。本文は書き換えない

### なぜ「ブロックの直後」ではなく「区間の末尾」か

反証が出した反例そのもの。`# 見出し` の直後に画像が入ると「画像 → 本文」の順になり、
pandoc が**2 枚に割る**（実測）。割れると `contentIndexOf` が **文書全体で** null を返し、
ノート編集・改行編集・装飾パネルが全部止まる。
区間末尾なら「本文 → 画像」＝ Content with Caption で 1 枚に収まる。

普通の 1 スライド（`# 見出し` + 段落 3 つ）でも、**カーソルが最後のブロック以外にあると
画像を 1 枚入れただけで枚数が合わなくなる**。最初の設計はここを踏んでいた。

### なぜ `.columns` の直下に置かないか

| 置き場所 | 結果 |
|---|---|
| `.columns` の直下・先頭 | 画像が消え、**段組みごと消える**（Two Content → Title and Content）。警告ゼロ |
| `.columns` の中・最後の列の後 | 画像だけが無警告で消える（INFO 1 件） |
| 列の中 | 画像が残り、Comparison が選ばれる |

### 検証結果

front matter + 見出し + 複数段落 + 段組み + `::: notes` + 入れ子フェンスを含む原稿の
**全カーソル位置 66 箇所**で:

| | 健全（枚数一致 かつ 画像が出力に残る） | 画像消失 | 枚数不一致 |
|---|---|---|---|
| 現状 | 7 | 46 | 20 |
| 修正後 | **66** | **0** | **0** |

現状 OK → 修正後 NG の回帰は **0 件**。10 種の意地悪な原稿（3 列 / 空の列 / CRLF /
入れ子フェンス / 末尾 `***` / 箇条書き / 引用）でも、元の行が割れた位置は 1 つも無い。

**救えないもの（実測）**: 表だけ・画像だけの区間はどこへ入れても pandoc が 2 枚に割る。
これは pandoc の分割規則であって挿入位置の問題ではない。v0.15 の `***` 隔離の担当。

### あわせて直す 2 件

- `onChangeSource` の先頭で `sourceRef.current` を進める
  （直後の `await flushSave()` が古い値を保存して「保存済み」と表示する経路がある）
- `patchBody` の第 2 引数でカーソルを復元する（`handleSelectSlide` と同じく focus してから 1 フレーム置く）

---

## 修正 6: ガードの層分け

`contentIndexOf` を通していた 3 箇所のうち、**装飾（`handleEditDecor`）だけを外す**。
`contentIndex` は「出力スライド番号 − titleOffset」そのもので、描画も注入も同じ式で戻すため、
原稿の区間数とは無関係。原稿へ書く 2 箇所（ノート編集・改行編集）はガードを維持する。

Alert は「どこが・なぜ」を出し、`***` を入れる位置を推定して案内する。
**推定は書き込み先に一切関与しない。**

### 反証で落とした 2 案

**(1) 「タイトルのあるスライドの区間は `#` で始まる」という追加の veto は入れない。**
実測で、アプリ同梱の SAMPLE（front matter → 空行 → `# 見出し`）と `***` 区切りの文書を
止めてしまう。原因は `splitFrontMatter` が閉じ `---` の改行までしか食わないので body が
空行で始まること、および hr で切った区間が hr 行そのものから始まること。
`***` をどこへ入れても解除できない。捕まる実害は setext 見出しの 1 例だけで割に合わない。

**(2) 全スライドへコピーの `total` を `slideCount - titleOffset` に差し替えるだけ、では新しい
データ消失経路ができる。** 原稿が変換より先行している状態（デバウンス中・末尾に `***` を
打った直後・変換エラーで `result` が凍結）では `total` が実際より小さくなり、範囲外の装飾が消える。

```ts
/* totalSlides は「いま変換できているスライド数」なので、原稿が先行して
   いる（デバウンス中・末尾に *** を打った直後など）と実際より小さくなる。
   範囲外の装飾まで消すと復元できないので、作り直す範囲の外は保持する */
const keepCover = (ci: number) =>
  ci === fromCi || (ci === 0 && fromCi !== 0) || ci > totalSlides;
```

`total` は「出力枚数と区間数の大きいほう」にしたうえで、この 1 項を足す。

### 犯人の名指しは件数が合うときだけ

| 原稿 | 不足枚数 | 推定件数 | 文面 |
|---|---|---|---|
| 導入 + 段組み | 1 | 1 | 「1 番目の『A』… 段組みの前後に別の内容が」 |
| 表 + 後続 | 1 | 1 | 具体的 |
| ベンチマーク（真因は `##` の slide level） | 55 | 4 | **汎用の文面**（誤った場所へ案内しない） |

ワンタップの `***` 挿入は v0.14 では出さない（`patchBody` は Undo を切る。v0.15 の 1 段 Undo とセット）。

---

## 型の差分

`src/converter/types.ts` は**追加のみ**。既存フィールドの型も意味も変えていない。
pandoc 固有の語彙は 1 つも増えていない（EMU・lvl・placeholder はすでにこの境界の共通語）。

```ts
/**
 * プレースホルダ固有の階層別既定（OOXML の lstStyle 1 階層ぶん）。
 * 値の無いプロパティは DeckInfo（＝マスター由来の既定）へ落とす。
 * sz は 1/100pt、marL / indent は EMU。
 */
export interface LevelStyle {
  sz?: number;
  marL?: number;
  indent?: number;
  algn?: string;
  /** 行頭記号を出さない（Paragraph.bullet と同じ語彙の部分集合） */
  bullet?: 'none';
}

export interface SlideShape {
  // 既存: placeholder / phIdx / frame / anchor / paragraphs
  /**
   * この図形の継承元プレースホルダが持つ階層別既定（疎配列）。
   * 添字は段落の level。穴と null は DeckInfo の既定へ落とす。
   * 何も持たないレイアウト（Title and Content 等）では null。
   * 実際に使う階層までで切ってある
   */
  lvlStyle?: Array<LevelStyle | null> | null;
}

/**
 * スライド上の表。出力に書かれているのは枠の矩形と列幅・行数だけで、
 * 行高は h="0"（中身任せ）、罫線と塗りは組み込みの表スタイル参照
 * （pandoc 既定テンプレートでは実体がパッケージに無い。いずれも実測）。
 * v0.14 は「消えないこと」の保証だけを目的にする。
 */
export interface SlideTable {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 行数（ヘッダ行を含む） */
  rowCount: number;
  /**
   * 列幅（EMU、左→右）。長さが列数。
   * 合計は w と一致しないことがある（pandoc は 1pt 刻みに丸める。
   * 実測: 13 列で 139700 EMU 不足）。描画は枠内へクランプすること
   */
  colWidths: number[];
}

export interface SlideOutline {
  // 既存: index / layout / shapes / images / notes
  tables: SlideTable[];
}
```

`DeckInfo` は**変更なし**。マスター由来の既定は従来どおりデッキ 1 組で持ち、
レイアウト固有の値だけを `SlideShape.lvlStyle` が運ぶ。
`SlideTable.rows` は予約もしない（形が決まっていないため。セル解析の版で
`DocBlock.rows` と同じ形にする）。`order`（spTree の文書順）も入れない。

後方互換の確認: `tables` を必須にしても `tsc --noEmit` が通る
（`SlideOutline` のオブジェクトリテラルは TS 側にも `scripts/*.mjs` にも 0 件）。
描画側は古いブリッジのシーンでも落ちないよう `slide.tables ?? []` / `lvlStyle?.[lvl]` で読む。

---

## 相互作用と適用順

同じ関数・同じ型を触るのは 3 組。

| 組 | 触る場所 | 結果 |
|---|---|---|
| A-1/A-2 と A-6 | `findInherited` | **依存する。** A-6 は `same=true` で同じ照合器に乗る。単独では誤る（上表 3200/1000）し、行頭記号を失う後退もある |
| A-5 と A-6 | `SlideOutline` / `SlideShape` | 追加位置が別。衝突なし |
| A-3 と A-4 | 柵の判定 | 実装は別（片方は候補列挙、片方はブロック走査）。v0.15 で `listBlocks()` に寄せる |

**6 件を同時に当てて測り直した結果**

- ベンチマーク 64 枚: 図形 99・表 13・**frame null 0**・変化した図形 3・`lvlStyle` を持つ図形 14
- 段組み / Comparison / 表 / 列の中の表 / 本文→画像 の 5 本で非 INFO 警告 0
- 装飾を注入した pptx で、装飾は自前 frame を保ち `lvlStyle` は付かない
- **`npm run check`（tsc + 12 本）が全部緑**。check-deck は 46 件すべて通過
- 新しい A-2 の検査は**現状のコードに対して赤**（457200 ≠ 4645026）＝ 退行を捕まえられる

### 版割り

変更量は原稿側 524 行 / パーサ側 350 行。1 版 ≒ 500 行の粒度に照らして **2 版に割る**。

| 版 | 中身 | 触るファイル |
|---|---|---|
| **v0.14 原稿を守る** | A-3 / A-4 / ガード層分け | `lineBreakEdit.ts` `EditorScreen.tsx` `groups.ts` + 新規 `blockInsert.ts` `slideSync.ts` |
| **v0.14.1 プレビューの嘘を消す** | A-1 / A-2 / A-5 / A-6 | `bridgeHtml.ts` `types.ts` `SlideSurface.tsx` |

順序の根拠は 3 つ。**(1)** 戻せないのは原稿だけで、プレビューの嘘は次の版で直せる。
**(2)** 2 つの版の**ファイル集合が交わらない**（重なり 0）ので、順序を入れ替えても衝突しない。
**(3)** `types.ts` を触るのは後半だけなので、変換器の境界の変更を 1 つの版に閉じられる。

**この順で 1 版ぶん残る劣化**: v0.14 で列に画像を入れると pandoc が Two Content →
**Comparison** に切り替える。A-2 が入るまでのあいだ、プレビューでは左右の見出しが重なって見える。
**出力も原稿も正しい**（見え方だけの劣化）。許せないなら 2 版を同じ週に出すか、1 版にまとめる。

---

## 検査に足すもの

| ファイル | 足すケース |
|---|---|
| `check-scene.mjs`（27 → 33） | A-1「レイアウトの idx はレイアウト内で閉じる」／ A-2「`type="body"` が 2 つあるレイアウトは idx で選ぶ」／「装飾枠はレイアウトでは body へ落とさない・マスターでは落とす」／ A-6「階層別 lstStyle」「`sz` を持たない `lvl1pPr` は null」／ A-5「表は枠と行数・列幅として読める」。あわせて `__morphoFindAnchor` / `__morphoParseLvlStyle` / `__morphoParseTables` を露出 |
| `check-linebreak.mjs`（23 → 27） | 柵の中の段落だけを掴む／柵の行は編集対象にしない／`::: notes` の中は候補にしない／**意図した縮退**（行頭 `:::` を含む段落は not-found）／インライン記法の内側では改行を置かない |
| `check-image-insert.mjs`（**新規** 11 件） | 4 種の原稿の全カーソル位置で「元の行が割れない」「独立段落になる」「cursor が画像行の末尾」／列の中・列の外・3 列目・コードフェンス・末尾 notes・front matter 側の着地点 |
| `check-deck.mjs`（41 → 46） | 段組み原稿 1 本を本物の pandoc で回して、非 INFO 警告 0・1 枚・左右の x が別・右列が縦中央に寄らない・列の中の表が枠として残る・列の本文に 1800 が載る・**全図形の frame が非 null** |
| `package.json` | `check` に `check-image-insert.mjs` を追加（12 本になる） |

**設計のみ・未実装**: `check-template.mjs` に「`Two Content` / `Comparison` の列プレースホルダに
`<a:xfrm>` があるか」。無いテンプレートでは右列がマスターの全幅本文枠へ落ちて左列を覆う（警告ゼロ）。

---

## v0.14 に入れないもの

| 項目 | 理由 | 切ると何が残るか |
|---|---|---|
| 表のセル解析と描画 | セルの字サイズも行高も出力に無い。書くと 2 つ同時に発明することになる | 表は破線の枠のまま。中身は読めない |
| 文字サイズ設定の倍率化 | 「寸法の所有者は誰か」はテーマ層（v0.16）の問題。先に別の答えを出すと二重になる | Section Header / 段組み / Content with Caption では設定のノブが無反応。**プレビューでも出力でも効かない**ので嘘は無い |
| `dt` / `ftr` / `sldNum` とマスター ph の `lstStyle` | `DeckInfo` に届く経路が無い | 日付枠を 24pt で描く嘘が残る（真値 9pt） |
| ラン単位の `sz`（引用 20pt・脚注 18pt） | `lvlStyle` は階層の器で表現できない。`parseRuns` と描画の見直しが要る | 引用ブロックが本文と同じ大きさで描かれる |
| ワンタップの `***` 挿入 | `patchBody` が Undo を切る。1 段 Undo とセットで v0.15 | Alert は「その場所へ移動」まで |
| `contentIndexOf` の veto（区間の見出し照合） | 実測で同梱 SAMPLE を止める。捕まる実害は setext 1 例 | 枚数が合ったまま境界がずれる setext 文書では誤った区間へ書く |
| 3 列超過・`width=` 無効・Comparison の Diagnostic | 警告分類の変更は v0.15 の 3 本と一緒に | 3 列目が消えても「その他の情報」に埋もれる |
| `order`（重なり順）・`SlideTable.rows`・`Placement` | 使わないフィールドを境界に足さない | v0.18 まで画像は自由配置できない |

---

## リスクと未検証

- **実機（iPad）は一切見ていない。** 破線 `borderStyle: 'dashed'` の出方、
  `patchBody` 後の `focus()` → `setSelection` が効くか、Alert のボタン、
  段組みスライドの実描画はすべて未検証。`status-and-plan.md` の実機周回の受け入れ条件に
  「画像を挿入した直後にカーソルが画像行の末尾にある」「表のある列に破線の枠が出る」を足す
- **PowerPoint / Word での見え方**も未検証。1 枚に表が 2 つあると `p:cNvPr/@id` が重複する
  （落とし穴 9 と同じく「検証器は通すが PowerPoint だけ拒む」型の候補）
- **PowerPoint 製の実テンプレート（reference-doc）では未検証。** pandoc 自身の出力を
  再投入する経路でしか試せていない（リポジトリに .pptx を置かないのは MIT を保つための
  意図的な判断なので、検査に .pptx を足すならライセンス判断が要る）
- `title: "   "`（空白のみ）で `titleOffset` が 1 になるのに pandoc は表紙を作らない。
  装飾層はガードを外したので、この文書では 1 枚ずれた座標系で動く。**未修正・実測済み**
- 犯人推定の規則は画像まわりで外れる場合がある（33 ケース中 25 一致）。
  文面と案内先にしか使わないので原稿は壊れない
- 改行編集の禁止区間は正規表現 5 本の近似。入れ子（リンクの中の強調など）は外側だけを守る。
  **タップが無反応になることをユーザーに伝える手段がまだ無い**
- シーンの増加（+9〜11%）と `parsePptx`（3.2 → 3.7 ms）は node での測定。
  **端から端までの遅延は 0.13.0 時点でも一度も測っていない**
