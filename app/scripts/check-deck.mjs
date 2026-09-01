/**
 * 統合検査: 本物の pandoc.wasm で pptx を作り、ブリッジの parsePptx を
 * vm で丸ごと動かして、座標・配色・字サイズ・ノートが解決されることを確かめる。
 * パーサ単体の検査 (check-scene) が通っても、継承解決の配線ミスはここでしか捕まらない。
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import assert from 'node:assert/strict';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { convert } from '../node_modules/pandoc-wasm/src/index.node.js';
import { slideSegments } from '../src/preview/cursorSlide.ts';

const src = readFileSync(new URL('../src/converter/bridgeHtml.ts', import.meta.url), 'utf8');
const decl = src.indexOf('export const BRIDGE_HTML');
const open = src.indexOf('`', decl);
const html = new Function('return `' + src.slice(open + 1, src.lastIndexOf('`')) + '`')();
const mod = /<script type="module">([\s\S]*?)<\/script>/.exec(html)[1]
  .replace(/^\s*import\s[^\n]*\n/gm, '');

const win = { __rn: () => {} };
const ctx = createContext({
  window: win,
  fetch: () => new Promise(() => {}),
  unzipSync, zipSync, strToU8,   // ブリッジ内の自由変数として注入
  performance, TextDecoder, WebAssembly, console, Promise,
});
runInContext(mod, ctx);

/* アプリと同じ経路: front matter は剥がして metadata で渡す（落とし穴1） */
const md = `# 一枚目

本文と**太字**。

- 箇条書き
  - 二階層

改行位置を\\
固定した段落。

::: notes
ノート本文。
:::
`;
const res = await convert(
  {
    from: 'markdown-yaml_metadata_block+east_asian_line_breaks',
    to: 'pptx',
    'output-file': 'o.pptx',
    metadata: { title: '統合', author: '検査' },
  },
  md, {},
);
const bytes = new Uint8Array(await res.files['o.pptx'].arrayBuffer());
const parsed = win.__morphoParsePptx(bytes);

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok   ' + name); };

t('デッキ寸法が 16:9 の実測値', () => {
  assert.equal(parsed.deck.w, 9144000);
  assert.equal(parsed.deck.h, 5143500);
});
t('テーマ配色が入る', () => {
  assert.equal(parsed.deck.colors.dk1, '#000000');
  assert.equal(parsed.deck.colors.lt1, '#FFFFFF');
  assert.match(parsed.deck.colors.accent1, /^#[0-9A-Fa-f]{6}$/);
});
t('字サイズ既定（タイトル33pt・本文24pt）', () => {
  assert.equal(parsed.deck.titleSz, 3300);
  assert.equal(parsed.deck.bodySz[0], 2400);
});
t('マスターの字下げ（marL / indent）が取れる', () => {
  assert.equal(parsed.deck.bodyMarL[0], 342900);
  assert.equal(parsed.deck.bodyMarL[1], 685800);
  assert.equal(parsed.deck.bodyIndent[0], -342900);
});
t('段落の字下げ上書き: 普通の段落は 0/0 明示、箇条書きは継承', () => {
  const body = parsed.slides[1].shapes.find((s) => s.placeholder === 'body');
  const plain = body.paragraphs.find((p) => p.bullet === 'none');
  assert.equal(plain.marL, 0);
  assert.equal(plain.indent, 0);
  const nested = body.paragraphs.find((p) => p.level === 1);
  assert.equal(nested.marL, null);
  assert.equal(nested.indent, null);
});
t('全図形の frame がマスター継承で解決される', () => {
  for (const slide of parsed.slides) {
    for (const sh of slide.shapes) {
      assert.ok(sh.frame, `slide${slide.index} の ${sh.placeholder} が未解決`);
      assert.ok(sh.frame.w > 0 && sh.frame.h > 0);
    }
  }
});
t('タイトルスライドの ctrTitle も座標を持つ', () => {
  const s1 = parsed.slides[0];
  const title = s1.shapes.find((s) => s.placeholder === 'ctrTitle' || s.placeholder === 'title');
  assert.ok(title && title.frame);
});
t('行末バックスラッシュの改行が端から端まで残る', () => {
  const body = parsed.slides[1].shapes.find((s) => s.placeholder === 'body');
  const withBreak = body.paragraphs.find((p) =>
    p.runs.map((r) => r.text).join('').includes('\n'),
  );
  assert.ok(withBreak, '<a:br/> がプレビューの段落に反映されていない');
  assert.equal(withBreak.runs.map((r) => r.text).join(''), '改行位置を\n固定した段落。');
});

t('ノートが該当スライドに載る', () => {
  const withNotes = parsed.slides.find((s) => s.notes.length > 0);
  assert.ok(withNotes);
  assert.equal(withNotes.notes[0].runs.map((r) => r.text).join(''), 'ノート本文。');
});

/* ---------- Web プレビュー（to: html）の統合検査 ---------- */

const webRes = await convert(
  {
    from: 'markdown-yaml_metadata_block+east_asian_line_breaks',
    to: 'html',
    standalone: true,
    metadata: { title: '統合', author: '検査' },
  },
  md, {},
);
const webHtml = win.__morphoDecorateWebHtml(webRes.stdout);

t('web: standalone HTML が出て CSS 注入される', () => {
  assert.ok(webHtml.includes('<!DOCTYPE html'));
  assert.ok(webHtml.includes('.notes{display:none}'));
  assert.ok(webHtml.indexOf('.notes{display:none}') < webHtml.indexOf('</head>'));
});
t('web: 見出しと行内改行が実出力に残る', () => {
  assert.match(webHtml, /<h1[^>]*>一枚目<\/h1>/);
  assert.ok(webHtml.includes('改行位置を<br />'));
});
t('web: notes は div class="notes" で残る（CSS で隠す方針の前提）', () => {
  assert.ok(webHtml.includes('class="notes"'));
  assert.ok(webHtml.includes('ノート本文。'));
});

/* ---------- docx 書き出しのノート除去（落とし穴 8）の統合検査 ---------- */

const docxRes = await convert(
  {
    from: 'markdown-yaml_metadata_block+east_asian_line_breaks',
    to: 'docx',
    'output-file': 'o.docx',
    metadata: { title: '統合', author: '検査' },
    filters: ['drop-notes.lua'],
  },
  md,
  { 'drop-notes.lua': win.__morphoDropNotesLua },
);
const docxZip = unzipSync(new Uint8Array(await docxRes.files['o.docx'].arrayBuffer()));
const documentXml = new TextDecoder().decode(docxZip['word/document.xml']);

t('docx: ::: notes ::: が本文から除去される（落とし穴 8）', () => {
  assert.ok(!documentXml.includes('ノート本文。'), 'ノートが docx 本文に漏れている');
});
t('docx: ノート以外の本文は残る', () => {
  assert.ok(documentXml.includes('一枚目'));
  assert.ok(documentXml.includes('箇条書き'));
});

t('テキスト位置の系統値: タイトルは中央（アンカー・揃え）、本文は spcBef 20%', () => {
  /* pandoc 既定マスターの実測値。プレビューの位置合わせの土台 */
  assert.equal(parsed.deck.titleAlgn, 'ctr');
  assert.equal(parsed.deck.bodyAlgn[0], 'l');
  assert.equal(parsed.deck.bodySpcBef[0], 20000);
  assert.equal(parsed.deck.bodySpcBef[1], 20000);
  const title = parsed.slides[1].shapes.find((s) => s.placeholder === 'title');
  assert.equal(title.anchor, 'ctr', 'タイトルの垂直アンカーがマスターから継承されていない');
  const body = parsed.slides[1].shapes.find((s) => s.placeholder === 'body');
  assert.equal(body.anchor ?? null, null, '本文は無指定（上揃え）のはず');
  /* 行頭記号: pandoc 既定マスターは • と –（ダッシュ）の交互 */
  assert.equal(parsed.deck.bodyBuChar[0], '•');
  assert.equal(parsed.deck.bodyBuChar[1], '–');
  assert.equal(parsed.deck.bodyBuChar[2], '•');
  /* タイトルスライドの ctrTitle も title のアンカーに落ちる */
  const ctr = parsed.slides[0].shapes.find((s) => s.placeholder === 'ctrTitle');
  assert.equal(ctr.anchor, 'ctr');
});

t('文字サイズの後処理: マスターの titleStyle/bodyStyle と表紙の ctrTitle に効く', () => {
  const sized = win.__morphoApplyTextSizes(bytes, {
    titleSz: 2000,
    coverTitleSz: 1600,
    coverSubSz: 1400,
    bodySz: [1200, 1050, 900, 800, 800],
  });
  const reparsed = win.__morphoParsePptx(new Uint8Array(sized));
  assert.equal(reparsed.deck.titleSz, 2000);
  /* vm 越しの配列はプロトタイプが別物なので Array.from で包む */
  assert.deepEqual(Array.from(reparsed.deck.bodySz), [1200, 1050, 900, 800, 800]);
  /* 表紙（slide1・ctrTitle）に lstStyle が注入される */
  const szip = unzipSync(new Uint8Array(sized));
  const s1 = strFromU8(szip['ppt/slides/slide1.xml']);
  assert.ok(
    s1.includes('<a:lstStyle><a:lvl1pPr><a:defRPr sz="1600"/></a:lvl1pPr></a:lstStyle>'),
    '表紙の ctrTitle にサイズが注入されていない',
  );
  /* サブタイトル（著者等）は独立のサイズになる */
  const subSp = s1.match(/<p:sp>[\s\S]*?type="subTitle"[\s\S]*?<\/p:sp>/);
  assert.ok(subSp && subSp[0].includes('<a:defRPr sz="1400"/>'),
    '表紙の subTitle にサイズが注入されていない');
  /* 本文スライド（slide2）は触られない */
  const s2b = strFromU8(szip['ppt/slides/slide2.xml']);
  assert.ok(!s2b.includes('sz="1600"'), '表紙以外に注入された');
  /* 未設定なら何もしない（同じバイト列） */
  assert.equal(win.__morphoApplyTextSizes(bytes, undefined), bytes);
});

/* ---------- 装飾の OOXML 後処理（飾る力）の統合検査 ---------- */

const DECORS = [
  {
    id: 'dtest1',
    contentIndex: 1,
    shape: 'rect',
    x: 0, y: 0, w: 9144000, h: 300000,
    color: { scheme: 'accent1' },
    opacity: 100,
  },
  {
    id: 'dtest2',
    contentIndex: 1,
    shape: 'roundRect',
    x: 457200, y: 1000000, w: 8229600, h: 3000000,
    color: { hex: '#12AB34' },
    opacity: 15,
  },
  {
    id: 'dtest3',
    contentIndex: 1,
    shape: 'ellipse',
    x: 457200, y: 360045, w: 617220, h: 617220,
    color: { scheme: 'accent2' },
    opacity: 100,
    text: '3 <&>',
  },
  {
    id: 'dtest4',
    contentIndex: 1,
    shape: 'star5',
    x: 2000000, y: 2000000, w: 1000000, h: 1000000,
    color: { scheme: 'accent3' },
    opacity: 100,
    noFill: true,
    line: { color: { hex: '#AB12CD' }, widthPt: 1.5 },
  },
];

/* dtest1 と dtest2 をグループに（bbox は dtest1 が x/y、dtest2 が右下を決める） */
const GROUPS = [{ id: 'gtest1', contentIndex: 1, memberIds: ['dtest1', 'dtest2'] }];

/* metadata.title あり → タイトルスライドが1枚 → contentIndex 1 は slide2.xml */
const decorated = win.__morphoApplyDecorations(bytes, DECORS, 1, GROUPS);
const dzip = unzipSync(new Uint8Array(decorated));
const slide2 = strFromU8(dzip['ppt/slides/slide2.xml']);

t('装飾: 対象スライドに MorphoDecor の sp が注入される', () => {
  assert.ok(slide2.includes('MorphoDecor dtest1'));
  assert.ok(slide2.includes('MorphoDecor dtest2'));
  const s1 = strFromU8(dzip['ppt/slides/slide1.xml']);
  assert.ok(!s1.includes('MorphoDecor'), 'タイトルスライドに注入されている');
});
t('装飾: 既存図形の前（本文の背面）に入り、cNvPr id が重複しない', () => {
  assert.ok(slide2.indexOf('MorphoDecor') < slide2.indexOf('<p:ph'), '既存図形より後ろにある');
  const ids = [...slide2.matchAll(/<p:cNvPr id="(\d+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, `id が重複: ${ids.join(',')}`);
});
t('装飾: テーマ参照色・不透明度・直接指定色が XML に出る', () => {
  assert.ok(slide2.includes('<a:schemeClr val="accent1">'));
  assert.ok(slide2.includes('<a:srgbClr val="12AB34"><a:alpha val="15000"/>'));
  assert.ok(slide2.includes('prst="roundRect"'));
});
t('装飾: 番号バッジは ellipse + 中央揃えの白文字で、テキストはエスケープされる', () => {
  assert.ok(slide2.includes('prst="ellipse"'));
  /* 字サイズ = 高さの 45%（617220 EMU = 48.6pt → 2187 = 21.87pt） */
  const m = slide2.match(/<a:rPr lang="ja-JP" sz="(\d+)" b="1">/);
  assert.ok(m, 'バッジの rPr が無い');
  assert.equal(m[1], String(Math.round((617220 / 12700) * 0.45 * 100)));
  assert.ok(slide2.includes('<a:bodyPr wrap="none" anchor="ctr" anchorCtr="1"'));
  assert.ok(slide2.includes('<a:t>3 &lt;&amp;&gt;</a:t>'), 'XML エスケープされていない');
  assert.ok(
    slide2.match(/b="1">\s*<a:solidFill><a:srgbClr val="FFFFFF"\/>/),
    '文字色が白でない',
  );
});

t('装飾: 枠線と塗りなしが XML に出る', () => {
  assert.ok(slide2.includes('prst="star5"'));
  /* noFill: spPr の塗りが <a:noFill/>（枠線の noFill とは別に存在する） */
  const star = slide2.slice(slide2.indexOf('MorphoDecor dtest4'));
  const noFillAt = star.indexOf('<a:noFill/>');
  assert.ok(noFillAt >= 0 && noFillAt < star.indexOf('<a:ln'), '塗りなしになっていない');
  /* 1.5pt = 19050 EMU */
  assert.ok(star.includes('<a:ln w="19050"><a:solidFill><a:srgbClr val="AB12CD">'),
    '枠線の太さ・色が出ていない');
});

t('装飾: グループが p:grpSp に包まれ、外形が bbox・子座標系は恒等', () => {
  assert.ok(slide2.includes('MorphoGroup gtest1'));
  const g = slide2.slice(slide2.indexOf('<p:grpSp>'), slide2.indexOf('</p:grpSp>'));
  assert.ok(g.includes('MorphoDecor dtest1') && g.includes('MorphoDecor dtest2'),
    'メンバーがグループの中にいない');
  assert.ok(!g.includes('MorphoDecor dtest3'), '非メンバーが混入');
  /* bbox: 左上 (0,0) は dtest1、右端 9144000 も dtest1（全幅）、下端 4000000 は dtest2 */
  assert.ok(g.includes('<a:off x="0" y="0"/>'));
  assert.ok(g.includes('<a:ext cx="9144000" cy="4000000"/>'));
  assert.ok(g.includes('<a:chOff x="0" y="0"/>'));
  assert.ok(g.includes('<a:chExt cx="9144000" cy="4000000"/>'));
});

t('装飾: 注入後も zip は壊れず、既存の解析結果が変わらない', () => {
  /* 無地の注入図形はテキストを持たないので、テキスト中心の自前パーサには
     写らないのが正しい（プレビューの装飾はデザインデータから直接描く）。
     バッジはテキストを持つため非プレースホルダ図形として写る。
     ここで確かめるのは「既存の図形とノートを壊していないこと」 */
  const reparsed = win.__morphoParsePptx(new Uint8Array(decorated));
  assert.equal(reparsed.slideCount, parsed.slideCount);
  const phOf = (slide) => slide.shapes.filter((s) => s.placeholder).map((s) => s.placeholder);
  assert.deepEqual(phOf(reparsed.slides[1]), phOf(parsed.slides[1]));
  const extra = reparsed.slides[1].shapes.filter((s) => !s.placeholder);
  assert.equal(extra.length, 1, 'バッジ以外の注入図形が写っている');
  assert.equal(
    extra[0].paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join(''),
    '3 <&>',
    'バッジのテキストが往復で壊れた',
  );
  assert.equal(
    reparsed.slides[1].notes.map((p) => p.runs.map((r) => r.text).join('')).join(''),
    'ノート本文。',
  );
});

/* ---------- 文書（docx）プレビューのパーサ ---------- */

const DOC_MD = `# 見出しA

最初の段落と**太字**と~~打ち消し~~。

改行を\\
固定した行。

> 引用の段落。

- 箇条書き
  - 二階層
1. 番号一

   続きの段落
1. 番号二

4) 四から

脚注あり[^1]。

[^1]: 脚注の**中身**。

\`\`\`js
const x = 1;
\`\`\`

| 列A | 列B |
|---|---|
| 1 | 2 |

{漢字|かんじ}にルビ、《《ここ》》に傍点。

::: notes
ノートは文書に出さない。
:::

***

## 見出しB
`;

const DROP_NOTES = [
  'function Div(el)',
  "  if el.classes:includes('notes') then return {} end",
  'end',
  '',
].join('\n');

const docRes = await convert(
  {
    from: 'markdown-yaml_metadata_block+east_asian_line_breaks',
    to: 'docx',
    'output-file': 'o.docx',
    metadata: { title: '文書検査', author: '検査' },
    filters: ['drop.lua', 'ruby.lua'],
  },
  DOC_MD,
  { 'drop.lua': DROP_NOTES, 'ruby.lua': win.__morphoRubyLua },
);
const docBytes = new Uint8Array(await docRes.files['o.docx'].arrayBuffer());
/* vm レルムの配列は deepEqual でプロトタイプ不一致になるので JSON で正規化 */
const doc = JSON.parse(JSON.stringify(win.__morphoParseDocx(docBytes)));
const textOf = (runs) => runs.map((r) => r.text).join('');

t('docx: 実測の字サイズ（本文12pt・Heading1=20pt・Title=28pt）', () => {
  assert.equal(doc.styles.basePt, 12);
  assert.equal(doc.styles.headingPt[0], 20);
  assert.equal(doc.styles.titlePt, 28);
});

t('docx: metadata の Title / Author が段落として出る', () => {
  const title = doc.blocks.find((b) => b.kind === 'para' && b.style === 'title');
  const author = doc.blocks.find((b) => b.kind === 'para' && b.style === 'author');
  assert.equal(textOf(title.runs), '文書検査');
  assert.equal(textOf(author.runs), '検査');
});

t('docx: 見出しレベルは pStyle から取れる', () => {
  const heads = doc.blocks.filter((b) => b.kind === 'heading');
  assert.deepEqual(heads.map((h) => [h.level, textOf(h.runs)]), [[1, '見出しA'], [2, '見出しB']]);
});

t('docx: 段落のラン書式（太字・打ち消し）と行内改行の \\n', () => {
  const paras = doc.blocks.filter((b) => b.kind === 'para' && b.style === 'body');
  const first = paras[0];
  assert.ok(first.runs.some((r) => r.bold && r.text === '太字'));
  assert.ok(first.runs.some((r) => r.strike && r.text === '打ち消し'));
  const br = paras.find((b) => textOf(b.runs).includes('\n'));
  assert.equal(textOf(br.runs), '改行を\n固定した行。');
});

t('docx: 引用は quote スタイル', () => {
  const q = doc.blocks.find((b) => b.kind === 'para' && b.style === 'quote');
  assert.equal(textOf(q.runs), '引用の段落。');
});

t('docx: リストは ilvl の入れ子と numbering.xml の種別・続き段落・開始番号が写る', () => {
  const items = doc.blocks.filter((b) => b.kind === 'listItem');
  assert.deepEqual(
    items.map((b) => [b.level, b.ordered, b.plain === true, b.start ?? 1, textOf(b.runs)]),
    [
      [0, false, false, 1, '箇条書き'],
      [1, false, false, 1, '二階層'],
      [0, true, false, 1, '番号一'],
      [0, false, true, 1, '続きの段落'],
      [0, true, false, 1, '番号二'],
      [0, true, false, 4, '四から'],
    ],
  );
});

t('docx: 脚注が [n] の参照と文末の本文として写る（無警告ロスの回避）', () => {
  const withRef = doc.blocks.find(
    (b) => b.runs && textOf(b.runs).startsWith('脚注あり'),
  );
  assert.equal(textOf(withRef.runs), '脚注あり[1]。');
  const fn = doc.blocks.filter((b) => b.kind === 'para' && b.style === 'footnote');
  assert.equal(fn.length, 1);
  assert.equal(textOf(fn[0].runs), '[1] 脚注の中身。');
  assert.ok(fn[0].runs.some((r) => r.bold && r.text === '中身'));
});

t('docx: コードは1段落=1行で束ね、構文色が付く', () => {
  const code = doc.blocks.find((b) => b.kind === 'code');
  assert.equal(code.lines.length, 1);
  assert.equal(textOf(code.lines[0]), 'const x = 1;');
  assert.ok(code.lines[0].some((r) => r.color));
  assert.ok(code.lines[0].every((r) => r.mono === true));
});

t('docx: 表はヘッダ行が区別される', () => {
  const table = doc.blocks.find((b) => b.kind === 'table');
  assert.equal(table.rows.length, 2);
  assert.equal(table.rows[0].header, true);
  assert.equal(table.rows[1].header, false);
  assert.deepEqual(table.rows[0].cells.map(textOf), ['列A', '列B']);
});

t('docx: ルビは本物の w:ruby が出力に入り、プレビューは 親文字（よみ）で写る', () => {
  const xml = new TextDecoder().decode(unzipSync(docBytes)['word/document.xml']);
  assert.ok(xml.includes('<w:ruby>'));
  assert.ok(xml.includes('<w:em w:val="dot" />'));
  const para = doc.blocks.find((b) => b.runs && textOf(b.runs).includes('ルビ'));
  assert.equal(textOf(para.runs), '漢字（かんじ）にルビ、ここに傍点。');
  assert.ok(para.runs.some((r) => r.bold && r.text === 'ここ'), '傍点は太字で近似');
});


t('docx: *** は hr、notes は Lua フィルタで消える', () => {
  assert.ok(doc.blocks.some((b) => b.kind === 'hr'));
  const all = doc.blocks
    .flatMap((b) => (b.runs ? [textOf(b.runs)] : []))
    .join('');
  assert.ok(!all.includes('ノートは文書に出さない'));
});

{
  const r = await convert(
    {
      from: 'markdown-yaml_metadata_block+east_asian_line_breaks',
      to: 'pptx',
      'output-file': 'r.pptx',
      filters: ['ruby.lua'],
    },
    '# T\n\n{漢字|かんじ}と《《傍点》》。\n\n単独 {語|ご} も変換。\n\n{x}と{文|ぶん}。\n',
    { 'ruby.lua': win.__morphoRubyLua },
  );
  const sc = win.__morphoParsePptx(new Uint8Array(await r.files['r.pptx'].arrayBuffer()));
  const texts = sc.slides[0].shapes.flatMap((sh) =>
    sh.paragraphs.flatMap((pp) => pp.runs.map((x) => [x.text, !!x.bold])),
  );
  const joined = texts.map(([tx]) => tx).join('');
  t('pptx 実出力: 漢字（かんじ）と太字の傍点', () => {
    assert.ok(joined.includes('漢字（かんじ）'), joined);
    assert.ok(texts.some(([tx, b]) => tx === '傍点' && b));
  });
  t('pptx 実出力: 単独トークンも変換され、literal な { に食い込まない', () => {
    assert.ok(joined.includes('語（ご）'), joined);
    assert.ok(!joined.includes('{語|ご}'), joined);
    /* {x} は照合外のまま残り、後続の {文|ぶん} だけがルビになる */
    assert.ok(joined.includes('{x}と文（ぶん）。'), joined);
  });
}
/* ---------- 画像（アセット解決・ガード・シーンへの写り） ---------- */

{
  /* 1x1 PNG */
  const PNG = Uint8Array.from(
    atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
    (c) => c.charCodeAt(0),
  );
  const guard = win.__morphoImageGuardLua(['photo.png']);
  const imd = '# 画像\n\n![図の説明](photo.png)\n\n![](missing.png)\n\n文中の![図](photo.png)も本文が残る。\n';
  const res = await convert(
    {
      from: 'markdown-yaml_metadata_block+east_asian_line_breaks',
      to: 'pptx',
      'output-file': 'i.pptx',
      filters: ['guard.lua'],
    },
    imd,
    { 'guard.lua': guard, 'photo.png': new Blob([PNG]) },
  );
  t('画像: 預けた画像で変換が通り、無い参照はプレースホルダになる（落とし穴3の回避）', () => {
    assert.ok(res.files['i.pptx'], 'stderr: ' + (res.stderr || ''));
  });
  const iscene = win.__morphoParsePptx(new Uint8Array(await res.files['i.pptx'].arrayBuffer()));
  t('画像: シーンに元ファイル名と実配置（xfrm）が写る', () => {
    const ims = iscene.slides[0].images;
    assert.equal(ims.length, 1);
    assert.equal(ims[0].name, 'photo.png');
    assert.ok(ims[0].w > 0 && ims[0].h > 0);
    assert.ok(ims[0].x >= 0 && ims[0].y >= 0);
  });
  t('画像: 無い参照は本文に [画像なし: ...] の文字列で残る', () => {
    const texts = iscene.slides[0].shapes
      .flatMap((sh) => sh.paragraphs.flatMap((pp) => pp.runs.map((r) => r.text)))
      .join('');
    assert.ok(texts.includes('[画像なし: missing.png]'), texts);
  });

  const dres = await convert(
    {
      from: 'markdown-yaml_metadata_block+east_asian_line_breaks',
      to: 'docx',
      'output-file': 'i.docx',
      filters: ['guard.lua'],
    },
    imd,
    { 'guard.lua': guard, 'photo.png': new Blob([PNG]) },
  );
  const idoc = JSON.parse(
    JSON.stringify(win.__morphoParseDocx(new Uint8Array(await dres.files['i.docx'].arrayBuffer()))),
  );
  t('画像: 文書プレビューにも image ブロックが写る', () => {
    const im = idoc.blocks.find((b) => b.kind === 'image');
    assert.equal(im.name, 'photo.png');
    assert.ok(im.wEmu > 0);
  });
  t('画像: 文中の画像でも本文の段落は落ちない', () => {
    const para = idoc.blocks.find(
      (b) => b.runs && b.runs.map((r) => r.text).join('').includes('本文が残る'),
    );
    assert.ok(para, '文中画像の段落テキストが消えた');
    /* alt テキストは本文に出ない（descr に入る。Word の見た目と同じ） */
    assert.equal(para.runs.map((r) => r.text).join(''), '文中のも本文が残る。');
    const images = idoc.blocks.filter((b) => b.kind === 'image');
    assert.ok(images.length >= 2);
  });
}


/* ---------- v0.14: 段組みの実出力（A-1 / A-2 / A-5 / A-6） ---------- */
{
  const cmd = `# 見出し

::: {.columns}
::: {.column}
左の列。

| a | b |
|---|---|
| 1 | 2 |
:::
::: {.column}
右の列。
:::
:::
`;
  const r = await convert(
    { from: 'markdown-yaml_metadata_block+east_asian_line_breaks', to: 'pptx', 'output-file': 'c.pptx' },
    cmd, {},
  );
  const nonInfo = r.warnings.filter((w) => w.verbosity !== 'INFO');
  const sc = win.__morphoParsePptx(new Uint8Array(await r.files['c.pptx'].arrayBuffer()));
  const s1 = sc.slides[0];
  const bodies = s1.shapes.filter((x) => x.placeholder === 'body');

  t('段組み: 非 INFO の警告なしで 1 枚に収まる', () => {
    assert.equal(nonInfo.length, 0, JSON.stringify(nonInfo));
    assert.equal(sc.slideCount, 1);
    /* 列に表があると pandoc は Comparison を選ぶ（実測。type="body" が 2 つ） */
    assert.equal(s1.layout, 'Comparison');
  });
  t('段組み: 左右の列が別の x に解決され、右列が縦中央に寄らない（A-1 / A-2）', () => {
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].frame.x, 457200);
    assert.equal(bodies[1].frame.x, 4645026, '右列が左列と重なっている（A-2）');
    /* Comparison の見出し枠はレイアウトが anchor="b" を持つ。
       'ctr' ならマスターの日付枠を拾っている（A-1） */
    for (const b of bodies) assert.equal(b.anchor, 'b');
  });
  t('段組み: 列の中の表が枠として残る（A-5）', () => {
    const tables = s1.tables ?? [];
    assert.equal(tables.length, 1);
    assert.equal(tables[0].x, 457200);
    assert.equal(tables[0].rowCount, 2);
    assert.equal(Array.from(tables[0].colWidths).length, 2);
  });
  t('段組み: 列の本文にレイアウト固有の字サイズが載る（A-6）', () => {
    for (const b of bodies) {
      assert.ok(b.lvlStyle, '列の lvlStyle が null');
      assert.equal(b.lvlStyle[0].sz, 1800, 'Comparison の lvl1 は 1800（マスターは 2400）');
    }
    /* Comparison のタイトルは lvl1pPr を持つが sz が無い → null で DeckInfo（3300）へ落ちる */
    const title = s1.shapes.find((x) => x.placeholder === 'title');
    assert.equal(title.lvlStyle, null);
  });
  t('段組み: 全図形の frame が解決される（プレビューから消えない）', () => {
    for (const sl of sc.slides) for (const sh of sl.shapes) assert.ok(sh.frame, JSON.stringify(sh));
  });
}

/* ---------- +++（列区切り）を本物の pandoc に通す ---------- */
{
  const expand = win.__morphoExpandColumns;
  const PNG = Uint8Array.from(
    atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
    (c) => c.charCodeAt(0),
  );
  const segs = (md) => slideSegments(md).length;
  const run = async (md) => {
    const e = expand(md);
    const r = await convert(
      { from: 'markdown-yaml_metadata_block+east_asian_line_breaks', to: 'pptx', 'output-file': 'p.pptx' },
      e.md, { 'z.png': new Blob([PNG]) },
    );
    const sc2 = win.__morphoParsePptx(new Uint8Array(await r.files['p.pptx'].arrayBuffer()));
    return {
      sc: sc2,
      nonInfo: r.warnings.filter((w) => w.verbosity !== 'INFO'),
      diags: Array.from(e.diags).map((d) => d.label),
    };
  };

  const basic = '# 見出し\n\n左のテキスト\n\n+++\n\n右のテキスト\n';
  const b = await run(basic);
  t('+++: 1 枚の Two Content になり、非 INFO 警告が出ない', () => {
    assert.equal(b.nonInfo.length, 0, JSON.stringify(b.nonInfo));
    assert.equal(b.sc.slideCount, 1);
    assert.equal(b.sc.slides[0].layout, 'Two Content');
    const bodies = b.sc.slides[0].shapes.filter((x) => x.placeholder === 'body');
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].frame.x, 457200);
    assert.equal(bodies[1].frame.x, 4648200);
  });
  t('+++: スライド数と原稿の区間数が一致する（contentIndexOf が死なない）', () => {
    assert.equal(b.sc.slideCount, segs(basic));
  });

  const intro = '# 見出し\n\n導入の文。\n\n左\n\n+++\n\n右\n';
  const i = await run(intro);
  t('+++: 導入があってもスライドが割れない（pandoc 記法なら 2 枚に割れる形）', () => {
    assert.equal(i.sc.slideCount, 1);
    assert.equal(i.sc.slideCount, segs(intro));
    assert.equal(i.sc.slides[0].layout, 'Two Content');
  });

  const three = '# 見出し\n\nA\n\n+++\n\nB\n\n+++\n\nC\n';
  const th = await run(three);
  t('+++: 3 列は 2 列に落ち、自前の診断が出る（pandoc は INFO しか出さない）', () => {
    assert.equal(th.sc.slideCount, 1);
    assert.equal(th.nonInfo.length, 0);
    assert.deepEqual(th.diags, ['3 列目以降はスライドに出ません']);
  });

  const unsafe = '# 実験\n\n![](z.png)\n\n図1: 装置\n\n+++\n\n右の説明\n';
  const u = await run(unsafe);
  t('+++: 列の先頭が画像で後続があるときは展開せず、内容を保つ（落とし穴 13）', () => {
    assert.deepEqual(u.diags, ['画像の後ろの内容が消えるため段組みにしませんでした']);
    const texts = u.sc.slides.flatMap((sl) =>
      sl.shapes.flatMap((sh) => sh.paragraphs.map((pp) => pp.runs.map((rr) => rr.text).join(''))));
    assert.ok(texts.some((x) => x.includes('図1')), 'キャプションが消えている');
    assert.ok(texts.some((x) => x.includes('右の説明')), '右の内容が消えている');
    assert.ok(!texts.some((x) => /\+\+\+/.test(x)), '本文に生の +++ が出ている');
    assert.equal(u.sc.slides.reduce((a, sl) => a + sl.images.length, 0), 1, '画像が消えている');
  });

  /* CRLF（Windows 由来の原稿。iPad でも iCloud Drive 経由で開く）。
     行末の \r で COL_SEP / COL_HR が外れ、段組みが無警告で 1 段のままになっていた
     （再現: Title and Content・本文枠 1 つ・本文に生の +++・警告も診断もゼロ）。
     pandoc 自身は CRLF でも LF と同じ slide XML を返す（実測）ので、
     LF 版とシーンが一致すれば塞げている */
  const crlf = (s) => s.replace(/\n/g, '\r\n');
  const bc = await run(crlf(basic));
  t('+++: CRLF 原稿でも LF 版と同じ Two Content になる（沈黙の失敗を塞ぐ）', () => {
    assert.equal(bc.nonInfo.length, 0, JSON.stringify(bc.nonInfo));
    assert.equal(bc.sc.slideCount, 1);
    assert.equal(bc.sc.slides[0].layout, 'Two Content');
    assert.deepEqual(bc.sc.slides, b.sc.slides, 'CRLF と LF でシーンが違う');
    assert.deepEqual(bc.diags, b.diags);
    assert.equal(bc.sc.slideCount, segs(crlf(basic)), 'CRLF で区間数がずれる');
  });

  const hrLf = '# A\n\n本文\n\n***\n\n左\n\n+++\n\n右\n\n::: notes\nノート\n:::\n';
  const hl = await run(hrLf);
  const hc = await run(crlf(hrLf));
  t('+++: CRLF でも *** の区間と末尾の ::: notes が LF 版と同じに扱われる', () => {
    assert.equal(hl.sc.slideCount, 2);
    assert.equal(hl.sc.slides[1].layout, 'Two Content');
    assert.deepEqual(hc.sc.slides, hl.sc.slides, 'CRLF と LF でシーンが違う');
    assert.deepEqual(hc.diags, hl.diags);
    assert.equal(hc.sc.slideCount, segs(crlf(hrLf)));
    const notes = hc.sc.slides[1].notes.map((p) => p.runs.map((r) => r.text).join('')).join('');
    assert.equal(notes, 'ノート');
  });
}

console.log(`\n${n} 件すべて通過`);
