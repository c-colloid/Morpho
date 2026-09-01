/**
 * フッター（出典・注釈）の検査。
 *
 * 前半は純関数（src/design/footer.ts の帯の解決・色・浄化）。
 * 後半は本物の pandoc.wasm で pptx を作り、ブリッジの applyFooters を
 * vm で直接叩いて、注入した帯が実出力として妥当かを確かめる。
 *
 * notes/footer-design.md の「検査」の表に対応する。
 * pptx だけを見ても捕まらないものが多いので docx / html も見る。
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import assert from 'node:assert/strict';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { convert } from '../node_modules/pandoc-wasm/src/index.node.js';

const {
  DEFAULT_FOOTER_STYLE, withFooterDefaults, resolveFooterBand,
  footerColorHex, sanitizeFooterText, toExportFooter, sanitizeFooterStyle,
} = await import('../src/design/footer.ts');
const { adjustDeck } = await import('../src/design/textSizes.ts');
const { splitFrontMatter, setFrontMatterValue } = await import('../src/converter/frontMatter.ts');

/* vm の中で作られたオブジェクトは prototype が違い deepStrictEqual に落ちるので、
   素のオブジェクトへ写してから比べる */
const plain = (o) => (o == null ? o : { x: o.x, y: o.y, w: o.w, h: o.h });

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok   ' + name); };
const ta = async (name, fn) => { await fn(); n++; console.log('  ok   ' + name); };

/* ---------- 純関数 ---------- */

const DECK = {
  w: 9144000, h: 5143500, colors: { dk1: '#000000', lt1: '#FFFFFF', accent1: '#4472C4' },
  titleSz: 3300, bodySz: [2400], bodyMarL: [], bodyIndent: [],
};

t('既定はテンプレートの ftr 帯を借り、幅だけ全幅へ広げる', () => {
  const deck = { ...DECK, ftrBand: { x: 3124200, y: 4767263, w: 2895600, h: 273844 } };
  const b = resolveFooterBand(DEFAULT_FOOTER_STYLE, deck);
  /* y と高さはテンプレート由来。幅は左右 5% を除いた全幅 */
  assert.equal(b.y, 4767263);
  assert.equal(b.h, 273844);
  assert.equal(b.x, Math.round(9144000 * 0.05));
  assert.equal(b.w, 9144000 - Math.round(9144000 * 0.05) * 2);
  assert.ok(b.w > 2895600, '既定の ftr 幅 228pt より広いこと');
});

t('ftr を持たないテンプレートでは比率の既定値へ落ちる', () => {
  const b = resolveFooterBand(DEFAULT_FOOTER_STYLE, { ...DECK, ftrBand: null });
  assert.equal(b.y, Math.round(5143500 * 0.9269));
  assert.equal(b.h, Math.round(5143500 * 0.0532));
  /* 実測の ftr 帯（4767263 / 273844）とほぼ同じ位置に来ること */
  assert.ok(Math.abs(b.y - 4767263) < 5000, '既定比率が実測の帯とずれていない');
});

t('帯はスライド内に収まる', () => {
  for (const ftrBand of [null, { x: 0, y: 4767263, w: 100, h: 273844 }]) {
    const b = resolveFooterBand(DEFAULT_FOOTER_STYLE, { ...DECK, ftrBand });
    assert.ok(b.y + b.h <= DECK.h, '下端がスライドを越えない');
    assert.ok(b.x + b.w <= DECK.w, '右端がスライドを越えない');
  }
});

t('色: テーマ参照 + tint を白へ寄せて解決する', () => {
  /* dk1(黒) の tint 75% は「黒を 75% 残す」= 濃い灰。マスターの実測値と同じ意図 */
  assert.equal(footerColorHex({ scheme: 'dk1', tint: 75000 }, DECK.colors), '#404040');
  assert.equal(footerColorHex({ scheme: 'dk1' }, DECK.colors), '#000000');
  assert.equal(footerColorHex({ hex: '#4472C4' }, DECK.colors), '#4472C4');
  /* 解決できない参照でも落ちない */
  assert.equal(footerColorHex({ scheme: 'accent6' }, DECK.colors), '#7F7F7F');
});

t('浄化: XML で書けない制御文字を空白へ 1 文字 → 1 文字で置換する', () => {
  const raw = 'NEJM\u000B2024\uFFFE;390';
  const out = sanitizeFooterText(raw);
  assert.equal(out.length, raw.length, '長さを保つ');
  assert.equal(out, 'NEJM 2024 ;390');
  /* 改行は帯に入らないので空白にする */
  assert.equal(sanitizeFooterText('A\nB'), 'A B');
  /* U+007F は XML 1.0 で合法なので落とさない（sanitizeDecorText はここが違う） */
  assert.ok(sanitizeFooterText('A\u007FB').includes('\u007F'));
});

t('toExportFooter: 空文言・デッキ未取得では何も出さない', () => {
  assert.equal(toExportFooter('', undefined, DECK), undefined);
  assert.equal(toExportFooter('   ', undefined, DECK), undefined);
  assert.equal(toExportFooter('NEJM', undefined, null), undefined);
});

t('toExportFooter: 既定は右揃え 9pt・表紙には出さない', () => {
  const f = toExportFooter('NEJM 2024', undefined, DECK);
  assert.equal(f.algn, 'r');
  assert.equal(f.sz, 900);
  assert.equal(f.onCover, false);
  assert.equal(f.text, 'NEJM 2024');
});

t('sanitizeFooterStyle: 壊れた値は捨て、範囲外は丸める', () => {
  assert.equal(sanitizeFooterStyle(null), null);
  assert.equal(sanitizeFooterStyle({ align: 'middle' }), null);
  assert.deepEqual(sanitizeFooterStyle({ sizePt: 999 }), { sizePt: 24 });
  assert.deepEqual(sanitizeFooterStyle({ sizePt: 1 }), { sizePt: 6 });
  assert.deepEqual(sanitizeFooterStyle({ color: { scheme: 'accent1', tint: 50000 } }),
    { color: { scheme: 'accent1', tint: 50000 } });
  /* scheme も hex も無い色は色ごと捨てる */
  assert.equal(sanitizeFooterStyle({ color: { tint: 5 } }), null);
});

t('withFooterDefaults: 部分設定を既定へ重ねる', () => {
  const s = withFooterDefaults({ align: 'l' });
  assert.equal(s.align, 'l');
  assert.equal(s.sizePt, DEFAULT_FOOTER_STYLE.sizePt);
});

/* ---------- ブリッジ（実出力） ---------- */

const src = readFileSync(new URL('../src/converter/bridgeHtml.ts', import.meta.url), 'utf8');
const decl = src.indexOf('export const BRIDGE_HTML');
const open = src.indexOf('`', decl);
const html = new Function('return `' + src.slice(open + 1, src.lastIndexOf('`')) + '`')();
const mod = /<script type="module">([\s\S]*?)<\/script>/.exec(html)[1]
  .replace(/^\s*import\s[^\n]*\n/gm, '');
const win = { __rn: () => {} };
runInContext(mod, createContext({
  window: win, fetch: () => new Promise(() => {}),
  unzipSync, zipSync, strToU8, performance, TextDecoder, WebAssembly, console, Promise,
}));

const toPptx = (md, meta) => convert(
  { from: 'markdown-yaml_metadata_block', to: 'pptx', 'output-file': 'o.pptx', ...(meta ? { metadata: meta } : {}) },
  md, {},
);
const bytesOf = async (r) => new Uint8Array(await r.files['o.pptx'].arrayBuffer());

const MD = '# 一枚目\n\n本文。\n\n# 二枚目\n\n本文2。\n';
const deckBytes = await bytesOf(await toPptx(MD, { title: '抄読会', author: '研修医' }));
const parsedBefore = win.__morphoParsePptx(deckBytes);

await ta('パーサがテンプレートのフッター帯を実出力から取る', () => {
  /* pandoc 既定マスターの ftr（実測値）。座標を持つのはマスターだけ */
  assert.deepEqual(plain(parsedBefore.deck.ftrBand), { x: 3124200, y: 4767263, w: 2895600, h: 273844 });
});

const FOOTER = toExportFooter('Smith & Jones <2024> N Engl J Med 2024;390:1234-45',
  undefined, parsedBefore.deck);
const injected = win.__morphoApplyFooters(deckBytes, FOOTER);
const parsedAfter = win.__morphoParsePptx(injected);

const slideXmls = (bytes) => {
  const z = unzipSync(bytes);
  return Object.keys(z).filter((x) => /^ppt\/slides\/slide\d+\.xml$/.test(x))
    .sort((a, b) => Number(/(\d+)/.exec(a)[1]) - Number(/(\d+)/.exec(b)[1]))
    .map((x) => strFromU8(z[x]));
};

t('注入してもスライド数は変わらない', () => {
  assert.equal(parsedAfter.slideCount, parsedBefore.slideCount);
});

t('表紙には出さない（ctrTitle の有無で判定する）', () => {
  const xs = slideXmls(injected);
  assert.ok(xs[0].includes('type="ctrTitle"'), '1 枚目が表紙であること');
  assert.ok(!xs[0].includes('MorphoFooter'), '表紙には入らない');
  assert.ok(xs.slice(1).every((x) => x.includes('MorphoFooter')), '残りの全スライドに入る');
});

t('onCover を立てると表紙にも出る', () => {
  const xs = slideXmls(win.__morphoApplyFooters(deckBytes, { ...FOOTER, onCover: true }));
  assert.ok(xs[0].includes('MorphoFooter'));
});

t('冪等: 2 回注入しても sp は 1 つ', () => {
  const twice = win.__morphoApplyFooters(win.__morphoApplyFooters(deckBytes, FOOTER), FOOTER);
  for (const x of slideXmls(twice)) {
    assert.ok((x.match(/MorphoFooter/g) || []).length <= 1);
  }
});

t('パーサが読み戻す: 帯の座標・右揃え・行頭記号なし・文言の往復', () => {
  const last = parsedAfter.slides[parsedAfter.slides.length - 1];
  const sp = last.shapes.find((s) => s.paragraphs.some((p) => p.runs.some((r) => r.text.includes('N Engl'))));
  assert.ok(sp, 'フッター図形が読める');
  assert.deepEqual(plain(sp.frame), { x: FOOTER.x, y: FOOTER.y, w: FOOTER.w, h: FOOTER.h });
  assert.equal(sp.paragraphs[0].algn, 'r');
  /* buNone を書かないとパーサが「箇条書き」と読んで行頭記号を描く */
  assert.equal(sp.paragraphs[0].bullet, 'none');
  /* & < > は 1 度だけエスケープする。二重エスケープしていないこと */
  assert.equal(sp.paragraphs[0].runs[0].text, FOOTER.text);
  /* プレースホルダにはしない（ftr が無いテンプレートで本文の枠へ落ちるため） */
  assert.equal(sp.placeholder, null);
});

t('文言が空なら何も注入しない', () => {
  assert.equal(win.__morphoApplyFooters(deckBytes, undefined), deckBytes);
  assert.equal(win.__morphoApplyFooters(deckBytes, { ...FOOTER, text: '' }), deckBytes);
});

await ta('ftr を持たないテンプレートでも帯が本文の枠へ化けない', async () => {
  /* master と全レイアウトから ftr の sp を落としたテンプレート相当の出力を作る */
  const z = unzipSync(deckBytes);
  for (const name of Object.keys(z)) {
    if (!/^ppt\/(slideMasters|slideLayouts)\//.test(name) || !/\.xml$/.test(name)) continue;
    z[name] = strToU8(strFromU8(z[name]).replace(/<p:sp>(?:(?!<p:sp>)[\s\S])*?type="ftr"[\s\S]*?<\/p:sp>/g, ''));
  }
  const noFtr = zipSync(z);
  const deck = win.__morphoParsePptx(noFtr).deck;
  assert.equal(deck.ftrBand, null, 'ftr が無いことを検出する');

  const f = toExportFooter('NEJM 2024', undefined, deck);
  const out = win.__morphoParsePptx(win.__morphoApplyFooters(noFtr, f));
  const sp = out.slides[out.slides.length - 1].shapes
    .find((s) => s.paragraphs.some((p) => p.runs.some((r) => r.text.includes('NEJM'))));
  /* 本文プレースホルダの枠（高さ 3394472）へ落ちていないこと */
  assert.ok(sp.frame.h < 500000, '本文の枠へ化けていない: ' + JSON.stringify(sp.frame));
  assert.equal(sp.frame.y, Math.round(deck.h * 0.9269));
});

await ta('装飾と併存しても cNvPr id が重複せず、フッターが最前面に来る', async () => {
  const withDecor = win.__morphoApplyDecorations(
    deckBytes,
    [{ id: 'x1', contentIndex: 1, shape: 'rect', x: 0, y: 4800000, w: 9144000, h: 343500,
       color: { scheme: 'accent1' }, opacity: 100 }],
    1, [],
  );
  const out = win.__morphoApplyFooters(withDecor, FOOTER);
  const xml = slideXmls(out)[1];
  const ids = [...xml.matchAll(/<p:cNvPr id="(\d+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'id が重複しない: ' + ids.join(','));
  assert.ok(xml.indexOf('MorphoDecor') < xml.indexOf('MorphoFooter'), 'フッターが装飾より後 = 前面');
});

/* ---------- スキーマ検証（@ooxml-tools/validate があるときだけ） ---------- */

let validate = null;
try {
  validate = (await import('@ooxml-tools/validate')).default;
} catch {
  console.log('  skip 妥当性検証（npm install --no-save @ooxml-tools/validate で有効になる）');
}
if (validate) {
  const errs = async (b) => (await validate(b, 'pptx', 'Microsoft365')).length;
  await ta('Open XML の妥当性: 素の出力もフッター注入後も 0 件、較正は 1 件以上', async () => {
    assert.equal(await errs(deckBytes), 0, '素の pandoc 出力');
    assert.equal(await errs(injected), 0, 'フッター注入後');
    /* 較正: 子要素順を ECMA-376 違反にすると検証器が鳴ること。
       これが 0 件だと「検証器が何も見ていない」ことに気づけない */
    const z = unzipSync(deckBytes);
    const name = 'ppt/slides/slide2.xml';
    const bad = win.__morphoBuildFooterSp(FOOTER, 99)
      .replace(/(<p:spPr>[\s\S]*?<\/p:spPr>)(<p:txBody>[\s\S]*?<\/p:txBody>)/, '$2$1');
    z[name] = strToU8(strFromU8(z[name]).replace('</p:spTree>', bad + '</p:spTree>'));
    assert.ok(await errs(zipSync(z)) > 0, '較正ケースが検出されること');
  });
}

/* ---------- プレビューと書き出しが同じ値を使うこと ---------- */

t('文字サイズ設定を重ねてもフッターの帯は動かない（プレビュー = 書き出し）', () => {
  /* プレビューは adjustDeck を通したデッキを使い、書き出しは素のデッキを使う。
     両者で帯が変わると「プレビューでは合っているのに出力が違う」が起きる */
  const raw = parsedBefore.deck;
  const adjusted = adjustDeck(raw, { titlePt: 40, bodyPt: 18, coverTitlePt: 44 });
  assert.deepEqual(plain(adjusted.ftrBand), plain(raw.ftrBand));
  assert.deepEqual(toExportFooter('NEJM', undefined, adjusted), toExportFooter('NEJM', undefined, raw));
});

t('原稿 → front matter → 解決 の一巡が通る（アプリと同じ経路）', () => {
  const src0 = '# 見出し\n\n本文。\n';
  const src1 = setFrontMatterValue(src0, 'footer', 'N Engl J Med 2024;390:1234-45');
  const meta = splitFrontMatter(src1).metadata;
  assert.equal(meta.footer, 'N Engl J Med 2024;390:1234-45');
  const f = toExportFooter(meta.footer, undefined, parsedBefore.deck);
  assert.equal(f.text, 'N Engl J Med 2024;390:1234-45');
  /* 消したら何も出さない状態へ戻る */
  const src2 = setFrontMatterValue(src1, 'footer', '');
  assert.equal(toExportFooter(splitFrontMatter(src2).metadata.footer, undefined, parsedBefore.deck), undefined);
  assert.equal(src2, src0, '原稿が元どおりに戻る');
});

/* ---------- docx / Web のデッキ全体フッター（0.16.1） ---------- */

const { toDocFooter, toFooterSpec } = await import('../src/design/footer.ts');
const READER = 'markdown-yaml_metadata_block+east_asian_line_breaks';
const toDocx = (md, meta) => convert(
  { from: READER, to: 'docx', 'output-file': 'o.docx', ...(meta ? { metadata: meta } : {}) },
  md, {},
);
const docxBytesOf = async (r) => new Uint8Array(await r.files['o.docx'].arrayBuffer());
const partOf = (bytes, name) => { const z = unzipSync(bytes); return z[name] ? strFromU8(z[name]) : null; };

t('toDocFooter: 文言・揃え・字サイズだけ。デッキを要求しない', () => {
  assert.equal(toDocFooter('', undefined), undefined);
  assert.deepEqual(toDocFooter(' NEJM 2024 ', undefined), { text: 'NEJM 2024', algn: 'r', sizePt: 9 });
  assert.deepEqual(toDocFooter('X', { align: 'ctr', sizePt: 8 }), { text: 'X', algn: 'ctr', sizePt: 8 });
  /* pptx 側と同じ解決結果になること（形式を切り替えても出典の見え方が食い違わない） */
  const pf = toExportFooter('X', { align: 'ctr', sizePt: 8 }, DECK);
  assert.equal(pf.algn, 'ctr');
  assert.equal(pf.sz, 800);
});

const docBytes = await docxBytesOf(await toDocx('# 見出し\n\n本文。[^1]\n\n[^1]: 脚注\n', { title: '抄読会' }));
const DF = toDocFooter('Smith & Jones <2024> N Engl J Med 2024;390:1234-45', { align: 'ctr', sizePt: 8 });
const docOut = win.__morphoApplyDocxFooter(docBytes, DF);

t('docx: 素の pandoc 出力にはフッターの受け皿が無い（実測 5 の前提）', () => {
  assert.equal(partOf(docBytes, 'word/footer1.xml'), null);
  assert.ok(!partOf(docBytes, 'word/document.xml').includes('footerReference'));
});

t('docx: footer1.xml・rels・[Content_Types]・sectPr の footerReference が揃う', () => {
  const ftr = partOf(docOut, 'word/footer1.xml');
  assert.ok(ftr, 'footer パートがある');
  assert.ok(ftr.includes('Smith &amp; Jones &lt;2024&gt;'), '1 度だけエスケープ');
  assert.ok(ftr.includes('<w:jc w:val="center"/>'));
  assert.ok(ftr.includes('<w:sz w:val="16"/>'), '8pt = sz 16');
  const doc = partOf(docOut, 'word/document.xml');
  const sect = /<w:sectPr>([\s\S]*?)<\/w:sectPr>/.exec(doc);
  assert.ok(sect, 'sectPr がある');
  assert.ok(sect[1].trimStart().startsWith('<w:footerReference w:type="default" r:id="rId'), 'footerReference が sectPr の先頭');
  const rId = /r:id="(rId\d+)"/.exec(sect[1])[1];
  const rels = partOf(docOut, 'word/_rels/document.xml.rels');
  assert.ok(new RegExp('Id="' + rId + '" Target="footer1.xml"').test(rels), 'rels が同じ rId で footer1.xml を指す');
  assert.equal((rels.match(new RegExp('Id="' + rId + '"', 'g')) || []).length, 1, 'rId が重複しない');
  assert.ok(partOf(docOut, '[Content_Types].xml').includes('PartName="/word/footer1.xml"'));
});

t('docx: 冪等 — 2 回目は何もしない。文言が空なら何もしない', () => {
  assert.equal(win.__morphoApplyDocxFooter(docOut, DF), docOut);
  assert.equal(win.__morphoApplyDocxFooter(docBytes, undefined), docBytes);
  assert.equal(win.__morphoApplyDocxFooter(docBytes, { ...DF, text: '' }), docBytes);
});

t('docx: 文書プレビューがページフッターを末尾に 1 回だけ出す（脚注より後）', () => {
  const blocks = win.__morphoParseDocx(docOut).blocks;
  const footers = blocks.filter((b) => b.style === 'footer');
  assert.equal(footers.length, 1);
  const last = blocks[blocks.length - 1];
  assert.equal(last.style, 'footer');
  assert.equal(last.align, 'ctr');
  assert.equal(last.runs.map((r) => r.text).join(''), DF.text, '& < > が往復する');
  assert.ok(blocks.some((b) => b.style === 'footnote'), '脚注も残っている');
  assert.ok(blocks.findIndex((b) => b.style === 'footnote') < blocks.length - 1, '脚注はフッターより前');
  /* 素の出力にはフッターのブロックが無い */
  assert.equal(win.__morphoParseDocx(docBytes).blocks.filter((b) => b.style === 'footer').length, 0);
});

if (validate) {
  const derrs = async (b) => (await validate(b, 'docx', 'Microsoft365')).length;
  await ta('docx の妥当性: 素の出力もフッター後付け後も 0 件、較正は 1 件以上', async () => {
    assert.equal(await derrs(docBytes), 0, '素の pandoc 出力');
    assert.equal(await derrs(docOut), 0, 'フッター後付け後');
    /* 較正: rPr の子要素順を sz → color に入れ替えると検証器が鳴ること（実測で 1 件） */
    const z = unzipSync(docOut);
    z['word/footer1.xml'] = strToU8(strFromU8(z['word/footer1.xml'])
      .replace(/(<w:color w:val="[^"]+"\/>)(<w:sz w:val="\d+"\/>)/, '$2$1'));
    assert.ok(await derrs(zipSync(z)) > 0, '較正ケースが検出されること');
  });
}

t('Web: .footer の CSS と、本文末尾に 1 回だけのデッキフッター', () => {
  const html = '<html><head><style>p{margin:1em 0}</style></head><body><p>本文</p></body></html>';
  const out = win.__morphoDecorateWebHtml(html, DF);
  assert.equal((out.match(/\.footer\{/g) || []).length, 1, '.footer 規則が 1 つ');
  assert.ok(out.indexOf('.footer{') < out.indexOf('</head>'), 'CSS は head の中');
  assert.equal((out.match(/class="footer morpho-deck-footer"/g) || []).length, 1, 'デッキフッターは 1 回だけ');
  assert.ok(out.includes('Smith &amp; Jones &lt;2024&gt;'), '1 度だけエスケープ');
  assert.ok(out.includes('text-align:center') && out.includes('font-size:8pt'));
  const div = out.indexOf('<div class="footer morpho-deck-footer"');
  assert.ok(div > out.indexOf('<p>本文</p>') && div < out.lastIndexOf('</body>'), '本文の後・</body> の前');
  /* 文言が無ければ CSS だけ入れて div は足さない */
  const bare = win.__morphoDecorateWebHtml(html, undefined);
  assert.ok(bare.includes('.footer{') && !bare.includes('class="footer morpho-deck-footer"'));
});

/* ---------- スライドごとのフッター（0.17.0） ---------- */

const { FOOTER_LINE, FOOTER_FENCE_OPEN, FOOTER_LINE_TEXT, isFooterLine, isFooterFenceOpen } =
  await import('../src/text/footerBlocks.ts');
const OPEN = '';
const CLOSE = '';
const extract = (md, fmt = 'pptx', o = { hasDeckFooter: true }) => win.__morphoExtractFooters(md, fmt, o);
const PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
/* アプリと同じ経路: フッター抽出 → 段組み展開 → pandoc（実 READER）→ 取り出し（再 zip しない） */
const full = async (md, meta, files) => {
  const e = extract(md);
  const c = win.__morphoExpandColumns(e.md);
  const r = await convert(
    { from: READER, to: 'pptx', 'output-file': 'o.pptx', ...(meta ? { metadata: meta } : {}) }, c.md, files ?? {});
  const bytes = new Uint8Array(await r.files['o.pptx'].arrayBuffer());
  const zip = unzipSync(bytes);
  const hv = win.__morphoHarvestFooters(zip);
  const names = Object.keys(zip).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((x, y) => Number(/(\d+)/.exec(x)[1]) - Number(/(\d+)/.exec(y)[1]));
  const texts = names.map((k) => [...strFromU8(zip[k]).matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => m[1]).join('␣'));
  /* vm 由来の配列は prototype が違い deepEqual に落ちるので、素の値へ写す */
  const landed = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(hv.slides).map(([k, v]) =>
    [k, v.suppress ? null : v.parts.map((p) => win.__morphoFooterJoin([p.frag.replace(/<[^>]*>/g, '')]))]))));
  return { e, c, bytes, zip, hv, names, texts, landed, warns: (r.warnings ?? []).filter((w) => w.verbosity !== 'INFO') };
};
const control = async (md, meta, files) => full(md.replace(/^ {0,3}[/／]{3,}.*\n?/gm, ''), meta, files);

t('記法の正規表現が footerBlocks.ts とブリッジで一致する', () => {
  const grab = (name) => {
    const m = new RegExp('var ' + name + ' = (/.*/[a-z]*);').exec(mod);
    assert.ok(m, name + ' がブリッジに無い');
    return new Function('return ' + m[1])();
  };
  assert.equal(grab('FT_LINE').source, FOOTER_LINE.source);
  assert.equal(grab('FT_FENCE').source, FOOTER_FENCE_OPEN.source);
  assert.equal(grab('FT_FENCE').flags, FOOTER_FENCE_OPEN.flags);
});

t('1 行形: 3 個以上・全角・空白なし。空白入り・字下げ 4・タブは記法にしない', () => {
  assert.ok(isFooterLine('/// 出典'));
  assert.ok(isFooterLine('///出典'));
  assert.ok(isFooterLine('／／／ 出典'));
  assert.ok(isFooterLine('//// 出典'));
  assert.ok(isFooterLine('   /// 出典'));
  assert.ok(isFooterLine('/// 出典\r'), 'CRLF');
  assert.ok(!isFooterLine('/ / / 出典'), '空白入りは pandoc で見える失敗なので救わない');
  assert.ok(!isFooterLine('    /// コード'), '4 スペースはインデントコード');
  assert.ok(!isFooterLine('\t/// コード'));
  assert.ok(!isFooterLine('// 2 個'));
  for (const l of ['https://example.com', '//example.com/a', '日付は 2024/03/01', '分数は 1/2/3', 'and/or の話', '出典：厚労省']) {
    assert.ok(!isFooterLine(l), '一般文を踏まない: ' + l);
  }
  assert.equal(FOOTER_LINE_TEXT, '/// ');
});

t('柵形: 別名と正規化。JS の \\b では死ぬ「::: 出典」が一致し、「::: 出典追記」は一致しない', () => {
  for (const l of ['::: footer', ':::footer', '::: {.footer}', '::: {.footer .small}', '::: 出典', '::: 注釈',
    '::: Footer', '：：： footer', '::: {footer}', '::: ｛.footer｝', ':::: footer', '::: footer 文言']) {
    assert.ok(isFooterFenceOpen(l), l);
  }
  for (const l of ['::: footers', '::: 出典追記', '::: notes', ':: footer', '::: fotter']) {
    assert.ok(!isFooterFenceOpen(l), '一致しない: ' + l);
  }
});

t('抽出: 直前の文字の行の末尾に目印が付き、記法の行は消える', () => {
  const e = extract('# 結果\n\n本文。\n\n/// 出典: NEJM 2024\n');
  assert.equal(e.count, 1);
  assert.equal(e.md, '# 結果\n\n本文。' + OPEN + '出典: NEJM 2024' + CLOSE + '\n\n');
  assert.equal(extract('# 結果\n\n本文。\n\n/ / / 出典\n').count, 0);
  assert.equal(extract('# 結果\n\n    /// コード\n\n続き。\n').count, 0, 'インデントコードを吸わない');
  /* CRLF は LF と同じ派生テキストになる */
  assert.equal(extract('# 結果\r\n\r\n本文。\r\n\r\n/// 出典\r\n').md, extract('# 結果\n\n本文。\n\n/// 出典\n').md);
});

t('抽出: 空の /// は抑止の目印（空）になり、デッキ既定があるときだけ情報診断', () => {
  const e = extract('# 結果\n\n本文。\n\n///\n');
  assert.equal(e.md, '# 結果\n\n本文。' + OPEN + CLOSE + '\n\n');
  assert.ok(e.diags.some((d) => d.kind === 'info' && /空のフッター/.test(d.label)));
  assert.ok(!extract('# 結果\n\n本文。\n\n///\n', 'pptx', { hasDeckFooter: false }).diags.length);
});

t('抽出: 柵形の正規化・別名・開き柵 1 行書き・複数行の EAW 連結', () => {
  const e = extract('# 結果\n\n本文。\n\n：：： 出典\nこれは長い出典で\n複数行に書いた\n：：：\n');
  assert.ok(e.md.includes(OPEN + 'これは長い出典で複数行に書いた' + CLOSE), '和文の継ぎ目に空白を入れない');
  assert.ok(e.diags.some((d) => /正規化/.test(d.label)));
  const e2 = extract('# 結果\n\n本文。\n\n::: footer 出典X\n:::\n');
  assert.ok(e2.md.includes(OPEN + '出典X' + CLOSE), '開き柵と同じ行の文言を捨てない');
  assert.ok(e2.diags.some((d) => d.kind === 'info' && /開き柵/.test(d.label)));
  assert.equal(win.__morphoFooterJoin(['詳細は NEJM', '2023 を参照']), '詳細は NEJM 2023 を参照');
  assert.equal(win.__morphoFooterJoin(['重要な', '**追記**あり']), '重要な**追記**あり', '装飾を透過して幅を見る');
  assert.equal(win.__morphoFooterJoin(['出典は', '[医学書院](u)の本']), '出典は[医学書院](u)の本');
});

t('抽出: 閉じ忘れは境界（任意レベルの見出し・水平線・+++・柵・EOF）で閉じて要対応診断', () => {
  const cases = [
    ['# A\n\n本文A。\n\n::: footer\n出典A\n\n# B\n\n本文B。\n', /閉じていません/, '# B'],
    ['# 章\n\n## 節1\n\n本文1\n\n::: footer\n出典A\n\n## 節2\n\n本文2\n', /閉じていません/, '## 節2'],
    ['# A\n\n本文。\n\n::: footer\n出典A\n\n***\n\n本文B。\n', /水平線/, '***'],
    ['# A\n\n左\n\n::: footer\n出典A\n\n+++\n\n右\n', /\+\+\+/, '+++'],
    ['# A\n\n本文。\n\n::: footer\n出典A\n\n| a |\n|---|\n| 1 |\n', /表/, '| a |'],
    ['# A\n\n本文。\n\n::: footer\n出典A\n\n::: notes\nメモ\n:::\n', /閉じていません/, '::: notes'],
    ['# A\n\n本文。\n\n::: footer\n出典A\n', /閉じていません/, null],
  ];
  for (const [md, re, rest] of cases) {
    const e = extract(md);
    assert.ok(e.diags.some((d) => d.kind === 'design' && re.test(d.label)), md);
    assert.ok(e.md.includes(OPEN + '出典A' + CLOSE), '文言は取り出す: ' + md);
    if (rest) assert.ok(e.md.includes(rest), '後続は本文に残る: ' + rest);
    assert.ok(!/:::/.test(e.md.replace(/::: notes[\s\S]*?:::/, '')) || rest === '::: notes', '柵の残骸を出さない');
  }
});

t('抽出: ノートの中（入れ子 div の後ろでも）は触らない', () => {
  const e = extract('# 結果\n\n本文。\n\n::: notes\n::: 重要\nx\n:::\n/// 非公開\n:::\n');
  assert.equal(e.count, 0);
  assert.ok(e.md.includes('/// 非公開'));
});

await ta('付け先: 段落の途中に書いても和文に半角スペースが混入しない（ブロック末尾へ進める）', async () => {
  const r = await full('# 結果\n\n本文一。\n/// 出典\n本文二。\n');
  const c = await full('# 結果\n\n本文一。\n本文二。\n');
  assert.deepEqual(r.landed, { 1: ['出典'] });
  assert.deepEqual(r.texts, c.texts, '本文が対照とバイト一致（EALB が効いたまま）');
  assert.equal(r.texts[0], '結果␣本文一。本文二。');
});

await ta('付け先: 行末の \\ の前に入れる（<a:br/> が消えない）・{#id} は属性のまま・$$ 数式は避ける', async () => {
  const r = await full('# 結果\n\n本文一。\\\n本文二。\n\n/// 出典\n');
  assert.ok(strFromU8(r.zip[r.names[0]]).includes('<a:br'), 'ハードブレイクが残る');
  assert.deepEqual(r.landed, { 1: ['出典'] });
  const h = await full('# 結果 {#sec1}\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n/// 出典\n');
  assert.equal(h.texts[0], '結果␣a␣b␣1␣2', '属性が生で出ない');
  assert.deepEqual(h.landed, { 1: ['出典'] });
  const m = await full('# 結果\n\n$$\nx^2\n$$\n\n/// 出典\n');
  assert.deepEqual(m.landed, { 1: ['出典'] });
  /* 文言の末尾の \\ は閉じ目印をエスケープして飲むので、リテラルへ逃がす */
  const bs = await full('# 結果\n\n本文。\n\n/// 末尾 \\\n');
  assert.deepEqual(bs.landed, { 1: ['末尾 \\'] });
});

await ta('付け先: リンク参照定義・脚注定義・コメント行には付けない（rels への漏れ・幽霊スライドを作らない）', async () => {
  const a = await full('# 結果\n\n[1]: https://doi.org/x\n\n/// 出典\n');
  assert.deepEqual(a.landed, { 1: ['出典'] });
  assert.ok(!Object.keys(a.zip).some((k) => /\.rels$/.test(k) && strFromU8(a.zip[k]).includes('出典')), 'rels に文言が漏れない');
  const b = await full('# 結果\n\n| a |\n|---|\n| 1 |\n\n<!-- メモ -->\n\n/// 出典\n');
  const c = await control('# 結果\n\n| a |\n|---|\n| 1 |\n\n<!-- メモ -->\n\n/// 出典\n');
  assert.equal(b.names.length, c.names.length, 'コメント行を段落化してスライドを割らない');
  assert.deepEqual(b.landed, { 1: ['出典'] });
});

await ta('フォールバック: 表のセル（| をエスケープ）・コード行・画像の title（奇数個の " と Barrett\'s）', async () => {
  /* 文字の行が 1 つも無いスライド（*** だけで作る）でだけフォールバックへ落ちる */
  const TB = '# 前\n\n本文。\n\n***\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n/// PMID 111 | DOI x\n';
  assert.ok(extract(TB).md.includes('| 2\u{E001}PMID 111 \\| DOI x\u{E002} |'), '最後のセルへ | をエスケープして埋める: ' + extract(TB).md);
  const tb = await full(TB);
  assert.deepEqual(tb.landed, { 2: ['PMID 111 | DOI x'] });
  const tc = await control(TB);
  assert.equal((strFromU8(tb.zip[tb.names[1]]).match(/<a:gridCol/g) || []).length,
    (strFromU8(tc.zip[tc.names[1]]).match(/<a:gridCol/g) || []).length, '列数が変わらない');
  assert.deepEqual(tb.texts, tc.texts);
  const CD = '# 前\n\n本文。\n\n***\n\n```\ncode1\ncode2\n```\n\n/// 出典\n';
  assert.ok(extract(CD).md.includes('code2\u{E001}出典\u{E002}\n```'), 'コードの最後の行へ');
  const cd = await full(CD);
  assert.deepEqual(cd.landed, { 2: ['出典'] });
  assert.equal(cd.texts[1], 'code1\ncode2');
  const files = { 'pix.png': new Blob([PNG]) };
  for (const text of ['出典 "X 2014', "Barrett's esophagus 2014", '末尾 \\']) {
    const IM = '# 前\n\n本文。\n\n***\n\n![](pix.png)\n\n/// ' + text + '\n';
    assert.ok(extract(IM).md.includes('![](pix.png "\u{E001}'), '画像の title へ: ' + extract(IM).md);
    const im = await full(IM, null, files);
    const xml = strFromU8(im.zip[im.names[1]]);
    assert.equal((xml.match(/<p:pic>/g) || []).length, 1, '画像が消えない: ' + text);
    assert.ok(/descr="pix\.png"/.test(xml), 'descr が元のファイル名へ戻る: ' + /descr="[^"]*"/.exec(xml));
    assert.equal(im.landed[2].length, 1);
    /* pandoc の smart typography が " と ' を曲げる（本文と同じ挙動）ので、そこは戻して比べる */
    const plain = im.landed[2][0].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
    assert.equal(plain, text, '文言が往復する');
  }
});

await ta('取り出し: 書式で始まり素で終わる断片・リンク・別の行の複数、いずれも整形式で移送できる', async () => {
  const md = '# 一枚目\n\n本文。\n\n/// **NEJM 2024** より引用\n\n次の段落。\n\n/// [NEJM](https://doi.org/10.1056/x) 2024\n\n# 二枚目\n\n本文2。\n';
  const r = await full(md, { title: '抄読会' });
  assert.deepEqual(r.landed, { 2: ['NEJM 2024 より引用', 'NEJM 2024'] });
  const spec = toFooterSpec('デッキ既定', undefined, win.__morphoParsePptxZip(r.zip).deck);
  const out = zipSync(win.__morphoApplyFootersZip(r.zip, spec, r.hv.slides));
  const xs = slideXmls(out);
  const sp = /<p:sp><p:nvSpPr><p:cNvPr id="\d+" name="MorphoFooter"\/>[\s\S]*?<\/p:sp>/.exec(xs[1])[0];
  assert.equal((sp.match(/<a:p>/g) || []).length, 1, '複数のフッターは 1 段落に並ぶ');
  assert.ok(sp.includes('<a:t> / </a:t>'), '区切りのラン');
  assert.ok(/b="1"[^>]*sz="900"/.test(sp) || /sz="900"[^>]*b="1"/.test(sp), '太字が残り、字サイズが帯のもの');
  assert.ok(/<a:hlinkClick r:id="rId\d+"/.test(sp), 'リンクが生 XML のまま移る');
  assert.ok(!xs[1].includes(OPEN) && !xs[1].includes(CLOSE));
  /* solidFill は latin / hlinkClick より前（ECMA-376 の順） */
  for (const rPr of sp.match(/<a:rPr\b[^>]*>[\s\S]*?<\/a:rPr>/g) || []) {
    const fill = rPr.indexOf('<a:solidFill>');
    const latin = rPr.indexOf('<a:latin');
    const link = rPr.indexOf('<a:hlinkClick');
    assert.ok(fill >= 0 && (latin < 0 || fill < latin) && (link < 0 || fill < link), rPr);
  }
  /* デッキ既定は個別フッターの無いスライドだけ（表紙は除外） */
  assert.ok(!xs[0].includes('MorphoFooter'), '表紙');
  assert.ok(xs[2].includes('デッキ既定'));
  assert.ok(!xs[1].includes('デッキ既定'));
  if (validate) {
    const errs2 = async (b) => (await validate(b, 'pptx', 'Microsoft365')).length;
    assert.equal(await errs2(out), 0, '移送後の妥当性');
  }
});

await ta('抑止: 空の /// のスライドにはデッキ既定も出ない。取り出せなかった目印は出力から掃除する', async () => {
  const r = await full('# 一枚目\n\n本文。\n\n///\n\n# 二枚目\n\n本文2。\n');
  assert.deepEqual(r.landed, { 1: null });
  const spec = toFooterSpec('デッキ既定', undefined, win.__morphoParsePptxZip(r.zip).deck);
  const xs = slideXmls(zipSync(win.__morphoApplyFootersZip(r.zip, spec, r.hv.slides)));
  assert.ok(!xs[0].includes('MorphoFooter') && xs[1].includes('デッキ既定'));
  /* 目印の片割れが残る XML を作って掃除を確かめる */
  const z = unzipSync(r.bytes);
  z['ppt/slides/_rels/slide1.xml.rels'] = strToU8(strFromU8(z['ppt/slides/_rels/slide1.xml.rels']).replace('Target="', 'Target="' + OPEN));
  const hv2 = win.__morphoHarvestFooters(z);
  assert.ok(hv2.diags.length >= 1, '漏れを診断する');
  assert.ok(!Object.keys(z).some((k) => strFromU8(z[k]).includes(OPEN)), '出荷物に目印が残らない');
});

await ta('プレビュー: 取り出した断片がシーンのラン（太字つき）として載る', async () => {
  const r = await full('# 結果\n\n本文。\n\n/// **NEJM** 2024\n\n///\n');
  const parsed = win.__morphoParsePptxZip(r.zip);
  win.__morphoAttachSlideFooters(parsed.slides, r.hv.slides);
  const f = parsed.slides[0].footer;
  assert.ok(f && f.runs.some((x) => x.bold && x.text === 'NEJM'));
  assert.equal(f.text, 'NEJM 2024');
  assert.ok(!parsed.slides[0].suppressFooter, '文言ありと空が同居したら文言が勝つ');
});

await ta('docx / html: 目印を埋めず、元の位置に小さい段落 / div.footer として実現する', async () => {
  const md = '# 見出し\n\n本文。\n\n/// 出典: NEJM 2024\n\n次の段落。\n';
  const d = extract(md, 'docx');
  assert.ok(!d.md.includes(OPEN) && d.md.includes('::: {custom-style="Abstract"}'));
  const rd = await convert({ from: READER, to: 'docx', 'output-file': 'o.docx' }, d.md, {});
  const docXml = partOf(new Uint8Array(await rd.files['o.docx'].arrayBuffer()), 'word/document.xml');
  assert.equal((docXml.match(/w:pStyle w:val="Abstract"/g) || []).length, 1);
  /* 段落ごとの文字列（ランは分かれうる）で順序を見る */
  const paras = [...docXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)]
    .map((m) => [...m[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((x) => x[1]).join(''));
  const at = (s) => paras.findIndex((p) => p.includes(s));
  assert.ok(at('本文。') >= 0 && at('本文。') < at('出典: NEJM 2024') && at('出典: NEJM 2024') < at('次の段落。'), '元の位置: ' + JSON.stringify(paras));
  assert.ok(!docXml.includes(OPEN) && !docXml.includes(CLOSE));
  const h = extract(md, 'html');
  assert.ok(h.md.includes('::: {.footer}'));
  const rh = await convert({ from: READER, to: 'html', standalone: true }, h.md, {});
  assert.ok(/<div class="footer">/.test(rh.stdout), 'div.footer');
  assert.ok(!rh.stdout.includes(OPEN));
});

await ta('benchmark 64 枚に /// を 7 か所差しても構成が一致し、7/7 着地・残留ゼロ・本文の XML がバイト一致', async () => {
  const bench = readFileSync(new URL('../../fixtures/pptx-benchmark.md', import.meta.url), 'utf8');
  const { metadata, body } = splitFrontMatter(bench);
  const lines = body.split('\n');
  const withF = [];
  let put = 0;
  for (const line of lines) {
    withF.push(line);
    if (/^##[ \t]/.test(line) && put < 7) withF.push('', '/// 出典F' + (++put));
  }
  const r = await full(withF.join('\n'), metadata);
  const c = await full(body, metadata);
  assert.equal(r.names.length, c.names.length, '枚数');
  assert.equal(r.names.length, 64);
  const layouts = (z, names) => names.map((k) => /slideLayout\d+\.xml/.exec(strFromU8(z[k.replace('slides/', 'slides/_rels/') + '.rels']))[0]);
  assert.deepEqual(layouts(r.zip, r.names), layouts(c.zip, c.names), 'レイアウト列');
  assert.equal(Object.keys(r.landed).length, 7, '7/7 着地');
  assert.ok(!Object.keys(r.zip).some((k) => /\.(xml|rels)$/.test(k) && strFromU8(r.zip[k]).includes(OPEN)), '残留ゼロ');
  let same = 0;
  for (const k of r.names) if (strFromU8(r.zip[k]) === strFromU8(c.zip[k])) same++;
  assert.equal(same, 64, '取り出し後の slideN.xml が対照とバイト一致');
  assert.equal(r.warns.length, c.warns.length);
});

console.log('\n' + n + ' 件すべて通過');
