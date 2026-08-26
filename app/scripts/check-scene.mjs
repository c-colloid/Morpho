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

console.log(`\n${n} 件すべて通過`);
