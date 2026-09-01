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

const { toDocFooter } = await import('../src/design/footer.ts');
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

console.log('\n' + n + ' 件すべて通過');
