/**
 * ブリッジの pptx パーサの検査。
 *
 * 図形 / 段落 / ラン の三層を正規表現で読んでいる一番壊れやすい箇所なので、
 * 実機に送る前にここで落とす。
 * ブリッジは WebView 用の文字列なので、モジュールブロックを取り出し
 * import を落として vm で評価し、window に生えた関数を叩く。
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../src/converter/bridgeHtml.ts', import.meta.url), 'utf8');
const decl = src.indexOf('export const BRIDGE_HTML');
const open = src.indexOf('`', decl);
const close = src.lastIndexOf('`');
const html = new Function('return `' + src.slice(open + 1, close) + '`')();

const mod = /<script type="module">([\s\S]*?)<\/script>/.exec(html);
if (!mod) { console.error('module ブロックが見つかりません'); process.exit(1); }

// import は落とす。参照は関数本体の中だけなので評価時には触られない
const body = mod[1].replace(/^\s*import\s[^\n]*\n/gm, '');

const win = { __rn: () => {} };
const ctx = createContext({
  window: win,
  // boot() を走らせないための止め具。永久に解決しない
  fetch: () => new Promise(() => {}),
  performance, TextDecoder, WebAssembly, console,
});
runInContext(body, ctx);

// vm 側の配列はレルムが違うので、比較の前に Array.from でこちらへ写すこと
const parse = win.__morphoParseShapes;
const parseFrames = win.__morphoParsePlaceholderFrames;
const findFrame = win.__morphoFindFrame;
const findAnchor = win.__morphoFindAnchor;
const parseLvlStyle = win.__morphoParseLvlStyle;
const parseTables = win.__morphoParseTables;
assert.equal(typeof parse, 'function', '__morphoParseShapes が生えていない');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok   ' + name); };

const sp = (nvPr, txBody) =>
  '<p:sp><p:nvSpPr><p:nvPr>' + nvPr + '</p:nvPr></p:nvSpPr>' +
  '<p:txBody>' + txBody + '</p:txBody></p:sp>';

t('タイトルプレースホルダを見分ける', () => {
  const xml = sp('<p:ph type="title"/>', '<a:p><a:r><a:rPr lang="ja-JP"/><a:t>見出し</a:t></a:r></a:p>');
  const [shape] = parse(xml);
  assert.equal(shape.placeholder, 'title');
  assert.equal(shape.paragraphs[0].runs[0].text, '見出し');
});

t('Web プレビュー: CSS 注入は </head> 直前・.notes 非表示・和文フォント指定', () => {
  const decorate = win.__morphoDecorateWebHtml;
  assert.equal(typeof decorate, 'function');
  const out = decorate('<html><head><style>a{}</style></head><body>x</body></html>');
  const inject = out.indexOf('.notes{display:none}');
  assert.ok(inject > 0, '.notes 非表示が入っていない');
  assert.ok(inject < out.indexOf('</head>'), '注入が </head> より後ろにある');
  assert.ok(out.includes('Hiragino Sans'), '和文フォント指定が無い');
  assert.equal(out.indexOf('<style>a{}</style>') > 0, true, '既存の CSS を壊した');
});

t('Web プレビュー: </head> が無い断片 HTML には先頭に注入する', () => {
  const out = win.__morphoDecorateWebHtml('<p>断片</p>');
  assert.ok(out.startsWith('<style>'));
  assert.ok(out.endsWith('<p>断片</p>'));
});

t('行内改行 <a:br/> を \\n として拾う（原稿の行末バックスラッシュ由来）', () => {
  const xml = sp('<p:ph idx="1"/>',
    '<a:p><a:r><a:t>一行目は</a:t></a:r><a:br /><a:r><a:t>二行目に続く</a:t></a:r></a:p>');
  const runs = parse(xml)[0].paragraphs[0].runs;
  assert.equal(runs.map((r) => r.text).join(''), '一行目は\n二行目に続く');
});

t('type 省略のプレースホルダは body 扱い', () => {
  const xml = sp('<p:ph idx="1"/>', '<a:p><a:r><a:t>本文</a:t></a:r></a:p>');
  assert.equal(parse(xml)[0].placeholder, 'body');
});

t('プレースホルダでない図形は null', () => {
  const xml = sp('', '<a:p><a:r><a:t>ただの図形</a:t></a:r></a:p>');
  assert.equal(parse(xml)[0].placeholder, null);
});

t('太字・斜体・下線を拾う', () => {
  const xml = sp('<p:ph idx="1"/>',
    '<a:p>' +
    '<a:r><a:rPr b="1"/><a:t>太字</a:t></a:r>' +
    '<a:r><a:rPr/><a:t>素</a:t></a:r>' +
    '<a:r><a:rPr i="1"/><a:t>斜体</a:t></a:r>' +
    '<a:r><a:rPr u="sng"/><a:t>下線</a:t></a:r>' +
    '</a:p>');
  const runs = parse(xml)[0].paragraphs[0].runs;
  assert.equal(runs.length, 4);
  assert.equal(runs[0].bold, true);
  assert.equal(runs[1].bold, undefined);
  assert.equal(runs[1].italic, undefined);
  assert.equal(runs[2].italic, true);
  assert.equal(runs[3].underline, true);
});

t('等幅書体をコードとして拾う', () => {
  const xml = sp('<p:ph idx="1"/>',
    '<a:p><a:r><a:rPr><a:latin typeface="Courier New"/></a:rPr><a:t>code()</a:t></a:r></a:p>');
  assert.equal(parse(xml)[0].paragraphs[0].runs[0].mono, true);
});

t('本文書体はコード扱いしない', () => {
  const xml = sp('<p:ph idx="1"/>',
    '<a:p><a:r><a:rPr><a:latin typeface="Hiragino Sans"/></a:rPr><a:t>本文</a:t></a:r></a:p>');
  assert.equal(parse(xml)[0].paragraphs[0].runs[0].mono, undefined);
});

t('箇条書きの階層を拾う', () => {
  const xml = sp('<p:ph idx="1"/>',
    '<a:p><a:pPr lvl="0"/><a:r><a:t>親</a:t></a:r></a:p>' +
    '<a:p><a:pPr lvl="2"/><a:r><a:t>孫</a:t></a:r></a:p>' +
    '<a:p><a:r><a:t>既定</a:t></a:r></a:p>');
  const ps = parse(xml)[0].paragraphs;
  assert.deepEqual(Array.from(ps, (p) => p.level), [0, 2, 0]);
});

// ここから下は scripts/dump-pptx.mjs で実際の pandoc 出力を見て書いた。
// pandoc は「箇条書きでない段落」に buNone を明示し、
// 箇条書きは何も書かずレイアウトの既定に任せる。
t('buNone のある段落は行頭記号なし', () => {
  const xml = sp('<p:ph idx="1"/>',
    '<a:p><a:pPr lvl="0" indent="0" marL="0"><a:buNone/></a:pPr>' +
    '<a:r><a:rPr/><a:t>これは普通の段落です。</a:t></a:r></a:p>');
  assert.equal(parse(xml)[0].paragraphs[0].bullet, 'none');
});

t('buNone の無い段落は箇条書き', () => {
  const xml = sp('<p:ph idx="1"/>',
    '<a:p><a:pPr lvl="0"/><a:r><a:rPr/><a:t>箇条書き1</a:t></a:r></a:p>');
  assert.equal(parse(xml)[0].paragraphs[0].bullet, 'bullet');
});

t('buAutoNum は番号付き', () => {
  const xml = sp('<p:ph idx="1"/>',
    '<a:p><a:pPr lvl="0" indent="-342900" marL="342900">' +
    '<a:buAutoNum type="arabicPeriod"/></a:pPr>' +
    '<a:r><a:rPr/><a:t>番号付き</a:t></a:r></a:p>');
  assert.equal(parse(xml)[0].paragraphs[0].bullet, 'number');
});

t('見出しは buNone つきで来る（行頭記号を出さない）', () => {
  const xml = sp('<p:ph type="title"/>',
    '<a:p><a:pPr lvl="0" indent="0" marL="0"><a:buNone/></a:pPr>' +
    '<a:r><a:rPr/><a:t>見出し</a:t></a:r></a:p>');
  const shape = parse(xml)[0];
  assert.equal(shape.placeholder, 'title');
  assert.equal(shape.paragraphs[0].bullet, 'none');
});

t('コードブロックは Courier かつ buNone', () => {
  const xml = sp('<p:ph idx="1"/>',
    '<a:p><a:pPr lvl="0" indent="0"><a:buNone/></a:pPr>' +
    '<a:r><a:rPr b="1"><a:latin typeface="Courier"/></a:rPr><a:t>const</a:t></a:r>' +
    '<a:r><a:rPr><a:latin typeface="Courier"/></a:rPr><a:t> x = 1;</a:t></a:r></a:p>');
  const p0 = parse(xml)[0].paragraphs[0];
  assert.equal(p0.bullet, 'none');
  assert.equal(p0.runs[0].mono, true);
  assert.equal(p0.runs[0].bold, true);
  assert.equal(p0.runs[1].mono, true);
});

t('ラン単位の文字色（構文ハイライト）を拾う', () => {
  /* pandoc の実出力: <a:rPr b="1"><a:solidFill><a:srgbClr val="007020"/></a:solidFill>
     <a:latin typeface="Courier"/></a:rPr> */
  const xml = sp('<p:ph idx="1"/>',
    '<a:p><a:pPr lvl="0" indent="0"><a:buNone/></a:pPr>' +
    '<a:r><a:rPr b="1"><a:solidFill><a:srgbClr val="007020"/></a:solidFill>' +
    '<a:latin typeface="Courier"/></a:rPr><a:t>const</a:t></a:r>' +
    '<a:r><a:rPr><a:latin typeface="Courier"/></a:rPr><a:t> x</a:t></a:r></a:p>');
  const runs = parse(xml)[0].paragraphs[0].runs;
  assert.equal(runs[0].color, '#007020');
  assert.equal(runs[0].mono, true);
  assert.equal(runs[1].color, undefined, '色の無いランに色が付いた');
});

t('斜体は i="1" で来る（pandoc の実出力）', () => {
  const xml = sp('<p:ph idx="1"/>',
    '<a:p><a:pPr lvl="0" indent="0" marL="0"><a:buNone/></a:pPr>' +
    '<a:r><a:rPr i="1"/><a:t>斜体</a:t></a:r></a:p>');
  assert.equal(parse(xml)[0].paragraphs[0].runs[0].italic, true);
});

t('空の段落は落とす', () => {
  const xml = sp('<p:ph idx="1"/>',
    '<a:p><a:pPr lvl="0"/></a:p><a:p><a:r><a:t>中身</a:t></a:r></a:p>');
  assert.equal(parse(xml)[0].paragraphs.length, 1);
});

t('テキストの無い図形は出さない', () => {
  const xml = sp('<p:ph idx="1"/>', '<a:p></a:p>') +
              sp('<p:ph type="title"/>', '<a:p><a:r><a:t>残る</a:t></a:r></a:p>');
  const shapes = parse(xml);
  assert.equal(shapes.length, 1);
  assert.equal(shapes[0].placeholder, 'title');
});

t('XML 実体参照を戻す', () => {
  const xml = sp('<p:ph idx="1"/>', '<a:p><a:r><a:t>A &amp; B &lt;C&gt;</a:t></a:r></a:p>');
  assert.equal(parse(xml)[0].paragraphs[0].runs[0].text, 'A & B <C>');
});

t('複数の図形を順に返す', () => {
  const xml = sp('<p:ph type="title"/>', '<a:p><a:r><a:t>題</a:t></a:r></a:p>') +
              sp('<p:ph idx="1"/>', '<a:p><a:r><a:t>体</a:t></a:r></a:p>');
  const shapes = parse(xml);
  assert.deepEqual(Array.from(shapes, (s) => s.placeholder), ['title', 'body']);
});

// 実際の notesSlide1.xml の構造（scripts/dump-pptx.mjs で確認）を模した検査。
// ノート抽出は「placeholder === 'body' の図形だけを拾う」に依存する
t('notesSlide の sldImg / body / sldNum を見分ける', () => {
  const xml =
    '<p:sp><p:nvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>' +
    sp('<p:ph type="body" idx="1"/>',
      '<a:p><a:pPr lvl="0" indent="0" marL="0"/><a:r><a:rPr/><a:t>ノート一行目。</a:t></a:r></a:p>' +
      '<a:p><a:r><a:rPr b="1"/><a:t>太字</a:t></a:r></a:p>') +
    sp('<p:ph type="sldNum" sz="quarter" idx="10"/>',
      '<a:p><a:r><a:rPr lang="en-US"/><a:t>1</a:t></a:r></a:p>');
  const shapes = parse(xml);
  const body = shapes.filter((s) => s.placeholder === 'body');
  assert.equal(body.length, 1);
  assert.equal(body[0].paragraphs.length, 2);
  assert.equal(body[0].paragraphs[0].runs[0].text, 'ノート一行目。');
  assert.equal(body[0].paragraphs[1].runs[0].bold, true);
  // sldNum の "1" が body に混ざらない
  const others = shapes.filter((s) => s.placeholder === 'sldNum');
  assert.equal(others.length, 1);
});

// ---- 幾何（実測した master の構造を模す） ----
const MASTER =
  '<p:sp><p:nvSpPr><p:nvPr><p:ph type="title" /></p:nvPr></p:nvSpPr>' +
  '<p:spPr><a:xfrm><a:off x="457200" y="205979" /><a:ext cx="8229600" cy="857250" /></a:xfrm></p:spPr>' +
  '<p:txBody><a:p><a:r><a:t>t</a:t></a:r></a:p></p:txBody></p:sp>' +
  '<p:sp><p:nvSpPr><p:nvPr><p:ph idx="1" type="body" /></p:nvPr></p:nvSpPr>' +
  '<p:spPr><a:xfrm><a:off x="457200" y="1200151" /><a:ext cx="8229600" cy="3394472" /></a:xfrm></p:spPr>' +
  '<p:txBody><a:p><a:r><a:t>b</a:t></a:r></a:p></p:txBody></p:sp>';

t('マスターのプレースホルダ座標を読む', () => {
  const phs = parseFrames(MASTER);
  assert.equal(phs.length, 2);
  assert.equal(phs[0].type, 'title');
  assert.deepEqual({ ...phs[0].frame }, { x: 457200, y: 205979, w: 8229600, h: 857250 });
  assert.equal(phs[1].idx, 1);
});

t('type で照合し、ctrTitle は title に落ちる', () => {
  const phs = parseFrames(MASTER);
  assert.equal(findFrame(phs, 'title', null).y, 205979);
  assert.equal(findFrame(phs, 'ctrTitle', null).y, 205979);
});

t('type が無ければ idx で照合する', () => {
  const phs = parseFrames(MASTER);
  assert.equal(findFrame(phs, 'body', 1).y, 1200151);
  assert.equal(findFrame(phs, null, 1).y, 1200151);
});

t('subTitle は body に落ちる', () => {
  const phs = parseFrames(MASTER);
  assert.equal(findFrame(phs, 'subTitle', 99).y, 1200151);
});

t('座標なしのレイアウト（pandoc 既定）は素通りする', () => {
  const layout =
    '<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/>' +
    '<p:txBody><a:p><a:r><a:t>x</a:t></a:r></a:p></p:txBody></p:sp>';
  const phs = parseFrames(layout);
  assert.equal(phs[0].frame, null);
  assert.equal(findFrame(phs, 'title', null), null);
});


/* ---- v0.14: 段組みで露出する継承の 3 ケース（A-1 / A-2 / A-6） ---- */

/* pandoc 既定テンプレートの実測値から起こした最小の板 */
const L_TWO =
  '<p:sp><p:nvSpPr><p:nvPr><p:ph idx="1" /></p:nvPr></p:nvSpPr>' +
  '<p:spPr><a:xfrm><a:off x="457200" y="1600200" /><a:ext cx="4038600" cy="3600450" /></a:xfrm></p:spPr>' +
  '<p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr><a:defRPr sz="2100"/></a:lvl1pPr>' +
  '<a:lvl2pPr><a:defRPr sz="1800"/></a:lvl2pPr></a:lstStyle></p:txBody></p:sp>' +
  '<p:sp><p:nvSpPr><p:nvPr><p:ph idx="2" /></p:nvPr></p:nvSpPr>' +
  '<p:spPr><a:xfrm><a:off x="4648200" y="1600200" /><a:ext cx="4038600" cy="3600450" /></a:xfrm></p:spPr>' +
  '<p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr><a:defRPr sz="2100"/></a:lvl1pPr></a:lstStyle></p:txBody></p:sp>' +
  '<p:sp><p:nvSpPr><p:nvPr><p:ph idx="10" sz="half" type="dt" /></p:nvPr></p:nvSpPr><p:spPr/>' +
  '<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/></p:txBody></p:sp>';

const L_CMP =
  '<p:sp><p:nvSpPr><p:nvPr><p:ph idx="1" type="body" /></p:nvPr></p:nvSpPr>' +
  '<p:spPr><a:xfrm><a:off x="457200" y="1151335" /><a:ext cx="4040188" cy="597756" /></a:xfrm></p:spPr>' +
  '<p:txBody><a:bodyPr anchor="b"/><a:lstStyle><a:lvl1pPr marL="0" indent="0"><a:buNone/>' +
  '<a:defRPr sz="1800" b="1"/></a:lvl1pPr></a:lstStyle></p:txBody></p:sp>' +
  '<p:sp><p:nvSpPr><p:nvPr><p:ph idx="3" type="body" /></p:nvPr></p:nvSpPr>' +
  '<p:spPr><a:xfrm><a:off x="4645026" y="1151335" /><a:ext cx="4041775" cy="597756" /></a:xfrm></p:spPr>' +
  '<p:txBody><a:bodyPr anchor="b"/><a:lstStyle><a:lvl1pPr marL="0" indent="0"><a:buNone/>' +
  '<a:defRPr sz="1000" b="1"/></a:lvl1pPr></a:lstStyle></p:txBody></p:sp>';

/* マスターは idx の名前空間が別（dt が idx=2）。ここが A-1 の発症源 */
const MASTER_DT =
  MASTER +
  '<p:sp><p:nvSpPr><p:nvPr><p:ph idx="2" sz="half" type="dt" /></p:nvPr></p:nvSpPr>' +
  '<p:spPr><a:xfrm><a:off x="457200" y="4767263" /><a:ext cx="2133600" cy="365125" /></a:xfrm></p:spPr>' +
  '<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/></p:txBody></p:sp>';

t('A-1 レイアウトの idx はレイアウト内で閉じる（マスターの日付枠を拾わない）', () => {
  const lay = parseFrames(L_TWO);
  const mas = parseFrames(MASTER_DT);
  /* 右の列（idx=2）。レイアウトにもマスターにも anchor は無いのが真値 */
  assert.equal(findAnchor(lay, 'body', 2, true) ?? findAnchor(mas, 'body', 2, false) ?? null, null);
  /* 枠はレイアウトの右列 */
  assert.equal((findFrame(lay, 'body', 2, true) || findFrame(mas, 'body', 2, false)).x, 4648200);
});

t('A-2 type="body" が 2 つあるレイアウトは idx で選ぶ', () => {
  const lay = parseFrames(L_CMP);
  assert.equal(findFrame(lay, 'body', 1, true).x, 457200);
  assert.equal(findFrame(lay, 'body', 3, true).x, 4645026);
});

t('装飾枠はレイアウトでは body へ落とさない／マスターでは落とす', () => {
  const lay = parseFrames(L_CMP);
  const mas = parseFrames(MASTER); /* 日付枠を持たないマスター */
  /* レイアウト内で dt を body（左見出し枠）へ落とすと重なるので落とさない */
  assert.equal(findFrame(lay, 'dt', 10, true), null);
  /* マスターでは従来どおり落ちる。落とさないと図形がプレビューから消える */
  assert.equal(findFrame(mas, 'dt', 10, false).y, 1200151);
});

t('A-6 レイアウト固有 lstStyle を階層別に読む', () => {
  const lay = parseFrames(L_TWO);
  const sz = findInheritedSz(lay, 'body', 1);
  assert.equal(sz[0].sz, 2100);
  assert.equal(sz[1].sz, 1800);
  /* 2 列目は lvl1 しか持たない。lvl2 以降は穴のまま DeckInfo へ落ちる */
  const sz2 = findInheritedSz(lay, 'body', 2);
  assert.equal(sz2[0].sz, 2100);
  assert.equal(sz2[1], undefined);
});

function findInheritedSz(phList, type, idx) {
  const hit = phList.filter((p) => p.idx === idx)[0];
  assert.ok(hit, 'idx=' + idx + ' の枠が無い');
  return Array.from(hit.lvlStyle);
}

t('A-6 sz を持たない lvl1pPr は null（マスターの既定へ落とす）', () => {
  const only = parseLvlStyle('<p:txBody><a:lstStyle><a:lvl1pPr><a:defRPr/></a:lvl1pPr></a:lstStyle></p:txBody>');
  assert.equal(only, null);
  /* 自己閉じ・対書きの buNone をどちらも拾う */
  const a = parseLvlStyle('<a:lstStyle><a:lvl1pPr marL="0"><a:buNone/></a:lvl1pPr></a:lstStyle>');
  const b = parseLvlStyle('<a:lstStyle><a:lvl1pPr marL="0"><a:buNone></a:buNone></a:lvl1pPr></a:lstStyle>');
  assert.equal(a[0].bullet, 'none');
  assert.equal(b[0].bullet, 'none');
});

t('A-5 表は枠と行数・列幅として読める', () => {
  const gf =
    '<p:graphicFrame><p:nvGraphicFramePr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvGraphicFramePr>' +
    '<p:xfrm><a:off x="457200" y="1193800"/><a:ext cx="8229600" cy="3390900"/></p:xfrm>' +
    '<a:graphic><a:graphicData><a:tbl><a:tblGrid><a:gridCol w="4114800" /><a:gridCol w="4114800" /></a:tblGrid>' +
    '<a:tr h="0"><a:tc/></a:tr><a:tr h="0"><a:tc/></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>';
  const tb = parseTables(gf);
  assert.equal(tb.length, 1);
  assert.deepEqual({ ...tb[0], colWidths: Array.from(tb[0].colWidths) },
    { x: 457200, y: 1193800, w: 8229600, h: 3390900, rowCount: 2, colWidths: [4114800, 4114800] });
  /* 表でない graphicFrame（グラフ・OLE）は落とす。trPr を行と数えない */
  assert.equal(parseTables('<p:graphicFrame><p:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></p:xfrm>' +
    '<a:graphic><a:graphicData><a:chart/></a:graphicData></a:graphic></p:graphicFrame>').length, 0);
});

console.log(`\n${n} 件すべて通過`);
