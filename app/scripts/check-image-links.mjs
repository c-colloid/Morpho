/**
 * 画像リンクの書き方の吸収の検査（app/src/text/imageLinks.ts）。
 *
 * 見ているのは 4 つ:
 *   1. Obsidian `![[…]]`・HTML `<img>`・参照形式・<> 付き・フォルダ付きが標準形になる
 *   2. 行数が変わらない（スライド境界と行番号を保つ）。CRLF でも
 *   3. 触ってはいけないもの（URL・コードフェンス内・ノート埋め込み・.md へのリンク）は無傷
 *   4. referencedImages が全形式から取り込み時のフラット名を拾う
 */
import assert from 'node:assert/strict';
import { normalizeImageLinks, isImageOnlyLine, imageRefsOf, flattenImageRef } from '../src/text/imageLinks.ts';
import { referencedImages, sanitizeAssetName } from '../src/text/assetNames.ts';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok   ' + name); };
const N = (s) => normalizeImageLinks(s);

t('Obsidian: ![[名前.png]] → ![](名前.png)', () => {
  assert.equal(N('![[shot.png]]'), '![](shot.png)');
  assert.equal(N('前 ![[shot.png]] 後'), '前 ![](shot.png) 後');
});
t('Obsidian: | の後ろは alt / 幅 / 幅x高さ', () => {
  assert.equal(N('![[shot.png|説明]]'), '![説明](shot.png)');
  assert.equal(N('![[shot.png|300]]'), '![](shot.png){width=300px}');
  assert.equal(N('![[shot.png|300x200]]'), '![](shot.png){width=300px height=200px}');
});
t('Obsidian: フォルダ付き・空白入りは取り込み時のフラット名へ', () => {
  assert.equal(N('![[attachments/写真 1.png]]'), '![](' + sanitizeAssetName('写真 1.png') + ')');
  assert.equal(N('![[Pasted image 20240101.png]]'), '![](Pasted_image_20240101.png)');
});
t('Obsidian: ノート埋め込み（画像拡張子でない）は触らない', () => {
  assert.equal(N('![[メモ]]'), '![[メモ]]');
  assert.equal(N('![[paper.pdf]]'), '![[paper.pdf]]');
  assert.equal(N('[[shot.png]]'), '[[shot.png]]', '! の無い wikilink はリンクなので触らない');
});
t('HTML: <img> は alt / width / height を引き継ぐ', () => {
  assert.equal(N('<img src="a.png">'), '![](a.png)');
  assert.equal(N("<img alt='説明' src='dir/a.png' width='200' height='100' />"), '![説明](a.png){width=200px height=100px}');
  assert.equal(N('<img src="a.png" width="50%">'), '![](a.png)', '% 幅は pandoc の px に直せないので落とす');
  assert.equal(N('<img src="https://x/y.png">'), '![](https://x/y.png)', 'URL はそのまま（取得はできない）');
  assert.equal(N('<image src="a.png">'), '<image src="a.png">', '<img 以外は触らない');
});
t('標準形: <> 付き・フォルダ付き・%20 は名前だけに落とす。title は残る', () => {
  assert.equal(N('![c](<my shot.png>)'), '![c](my_shot.png)');
  assert.equal(N('![d](img/d%20e.png "t")'), '![d](d_e.png "t")');
  assert.equal(N('![e](./e.png){width=50%}'), '![e](e.png){width=50%}');
  assert.equal(N('![f](f.png)'), '![f](f.png)', 'フラット名はそのまま');
});
t('参照形式: 定義の名前を落とす。.md へのリンク定義は触らない', () => {
  assert.equal(N('[r]: img/r.png "t"'), '[r]: r.png "t"');
  assert.equal(N('[r]: <img/r 1.png>'), '[r]: r_1.png');
  assert.equal(N('[doc]: docs/guide.md'), '[doc]: docs/guide.md');
  assert.equal(N('[u]: https://x/y.png'), '[u]: https://x/y.png');
});
t('URL は全形式で触らない', () => {
  assert.equal(N('![u](https://x/y.png)'), '![u](https://x/y.png)');
  assert.equal(N('![[https://x/y.png]]'), '![](https://x/y.png)');
});
t('コードフェンスの中は触らない（インラインコードは次の項）', () => {
  const src = '```\n![[in.png]]\n<img src="a.png">\n```\n![[out.png]]\n';
  assert.equal(N(src), '```\n![[in.png]]\n<img src="a.png">\n```\n![](out.png)\n');
});
t('行数は変わらない（CRLF でも。\\r は行末に残る）', () => {
  const src = '# 見出し\r\n\r\n![[a.png|300]]\r\n<img src="b.png">\r\n\r\n***\r\n';
  const out = N(src);
  assert.equal(out.split('\n').length, src.split('\n').length);
  assert.equal(out, '# 見出し\r\n\r\n![](a.png){width=300px}\r\n![](b.png)\r\n\r\n***\r\n');
});
t('画像の無い原稿は 1 バイトも変わらない', () => {
  const src = '---\ntitle: x\n---\n\n# a\n\n本文 [link](docs/x.md) と `code ![[x.png]]`\n\n- 項目\n';
  assert.equal(N(src), src, 'インラインコードの中も触らない');
});
t('isImageOnlyLine: どの書き方でも画像 1 つだけの行を見分ける', () => {
  assert.equal(isImageOnlyLine('  ![[a.png|20]]'), true);
  assert.equal(isImageOnlyLine('<img src="a.png">'), true);
  assert.equal(isImageOnlyLine('![x](a.png){width=1in}'), true);
  assert.equal(isImageOnlyLine('本文 ![[a.png]]'), false);
  assert.equal(isImageOnlyLine('![[note]]'), false);
});
t('referencedImages: 全形式からフラット名を拾う（URL・ノート埋め込み・.md は除外）', () => {
  const md = [
    '![[写真 1.png|300]]', '![[note]]', '<img src="a/b.png">', '![c](<my shot.png>)',
    '![d](attachments/d%20e.png "t")', '![r][ref]', '[ref]: img/r.png', '[doc]: docs/x.md',
    '![u](https://x/y.png)', '```', '![[in.png]]', '```',
  ].join('\n');
  assert.deepEqual(referencedImages(md).sort(), ['b.png', 'd_e.png', 'my_shot.png', 'r.png', '写真_1.png']);
  assert.deepEqual(imageRefsOf(md).sort(), referencedImages(md).sort());
});
t('flattenImageRef: 取り込み時の規則（sanitizeAssetName）と一致する', () => {
  assert.equal(flattenImageRef('sub/写真 (1).png'), sanitizeAssetName('写真 (1).png'));
  assert.equal(flattenImageRef('https://x/y.png'), 'https://x/y.png');
  assert.equal(flattenImageRef('a%zz.png'), sanitizeAssetName('a%zz.png'), '壊れた % はそのまま');
});

console.log(`check-image-links: ${n} ok`);
