/**
 * front matter の切り出しの検査。
 * CLAUDE.md 落とし穴 1 の回避が壊れていないことを確かめる。
 */
import assert from 'node:assert/strict';

/* Node 22 の型ストリップで .ts をそのまま読む（ビルド不要） */
const { sanitizeForXml, splitFrontMatter, setFrontMatterValue, frontMatterIssues } =
  await import('../src/converter/frontMatter.ts');
const { referencedImages, sanitizeAssetName } = await import('../src/text/assetNames.ts');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok   ' + name); };

t('front matter を metadata と body に分ける', () => {
  const r = splitFrontMatter('---\ntitle: "Morpho"\nauthor: フテイケイ\n---\n\n# 見出し\n');
  assert.deepEqual(r.metadata, { title: 'Morpho', author: 'フテイケイ' });
  assert.equal(r.body, '\n# 見出し\n');
});

t('front matter が無ければ本文をそのまま返す', () => {
  const r = splitFrontMatter('# 見出し\n\n本文\n');
  assert.deepEqual(r.metadata, {});
  assert.equal(r.body, '# 見出し\n\n本文\n');
});

t('本文中の --- は front matter として拾わない', () => {
  const src = '# 見出し\n\n---\n\n次のスライド\n';
  const r = splitFrontMatter(src);
  assert.deepEqual(r.metadata, {});
  assert.equal(r.body, src);
});

t('YAML が壊す入力を本文へ落とさない（落とし穴 1 の再現）', () => {
  // *強調 で始まる行は YAML ならエイリアスとして解釈されて変換ごと落ちる。
  // front matter を剥がしたあとの本文に残っていても、リーダーを固定してあれば安全。
  const r = splitFrontMatter('---\ntitle: "t"\n---\n\n*強調* から始まる行\n\n---\n\n& も含む\n');
  assert.deepEqual(r.metadata, { title: 't' });
  assert.ok(r.body.includes('*強調*'));
  assert.ok(r.body.includes('& も含む'));
});

t('空値とコメント行は落とす', () => {
  const r = splitFrontMatter('---\n# コメント\ntitle:\nauthor: A\n---\n本文');
  assert.deepEqual(r.metadata, { author: 'A' });
});

t('CRLF でも切り出せる', () => {
  const r = splitFrontMatter('---\r\ntitle: T\r\n---\r\n本文');
  assert.deepEqual(r.metadata, { title: 'T' });
  assert.equal(r.body, '本文');
});

t('sanitizeForXml: XML 非対応の制御文字を空白へ置換（PowerPoint がファイルを開けなくなる実例あり）', () => {
  // 実例: NEJM の著者行コピペに U+000B（垂直タブ）が混入し、pandoc が
  // slide XML へ素通しして PowerPoint がファイルごと拒否した
  const vt = String.fromCharCode(0x0b);
  const r = sanitizeForXml(splitFrontMatter('---\ntitle: T\nauthor: A' + vt + 'B\n---\n本文' + vt + '末尾\n'));
  assert.equal(r.metadata.author, 'A B');
  assert.equal(r.body, '本文 末尾\n');
});

t('sanitizeForXml: 置換は 1 文字 → 1 文字（本文オフセットが崩れない）', () => {
  const vt = String.fromCharCode(0x0b);
  const src = '# 見出し\n\n段落' + vt + '続き\n';
  const r = sanitizeForXml(splitFrontMatter(src));
  assert.equal(r.body.length, src.length);
  assert.equal(r.body.indexOf('続き'), src.indexOf('続き'));
});

t('sanitizeForXml: タブと改行は残す。splitFrontMatter 単体は原稿に忠実', () => {
  const vt = String.fromCharCode(0x0b);
  assert.equal(sanitizeForXml(splitFrontMatter('a\tb\nc\n')).body, 'a\tb\nc\n');
  // 書き戻し経路（ノート編集等）が原稿を書き換えないよう、split 自体は触らない
  assert.equal(splitFrontMatter('x' + vt + 'y\n').body, 'x' + vt + 'y\n');
});

t('sanitizeAssetName: パスと危険な文字を落としてフラット名にする', () => {
  assert.equal(sanitizeAssetName('sub/dir/写真 1 (2).png'), '写真_1__2_.png');
  assert.equal(sanitizeAssetName("C:\\a'b`c.png"), "a_b_c.png");
  assert.equal(sanitizeAssetName('///'), 'image');
});

t('referencedImages: フラット名だけ拾い、URL とパス付きは除外する', () => {
  const md = '![a](one.png) ![b](sub/two.png) ![c](https://x/y.png) ![d](one.png) ![e](three.jpg "t")';
  assert.deepEqual(referencedImages(md).sort(), ['one.png', 'three.jpg']);
});

/* ---------- front matter の 1 行書き換え（フッターの入力欄が使う） ---------- */

t('setFrontMatterValue: 既存のキーだけを差し替え、他の行に触れない', () => {
  const src = '---\ntitle: 抄読会\nfooter: 旧\nauthor: 研修医\n---\n\n# 見出し\n';
  const out = setFrontMatterValue(src, 'footer', 'NEJM 2024;390:1234-45');
  assert.equal(out, '---\ntitle: 抄読会\nfooter: "NEJM 2024;390:1234-45"\nauthor: 研修医\n---\n\n# 見出し\n');
  assert.equal(splitFrontMatter(out).body, '\n# 見出し\n', '本文は無傷');
});

t('setFrontMatterValue: 無いキーは末尾へ足す', () => {
  const out = setFrontMatterValue('---\ntitle: 抄読会\n---\n\n本文\n', 'footer', 'NEJM');
  assert.equal(splitFrontMatter(out).metadata.footer, 'NEJM');
  assert.equal(splitFrontMatter(out).metadata.title, '抄読会');
});

t('setFrontMatterValue: front matter が無ければ先頭に作る', () => {
  const out = setFrontMatterValue('# 見出し\n', 'footer', 'NEJM');
  assert.equal(out, '---\nfooter: "NEJM"\n---\n\n# 見出し\n');
  assert.equal(splitFrontMatter(out).body, '\n# 見出し\n');
});

t('setFrontMatterValue: 空文字で消す。継続行も一緒に落とす', () => {
  const src = '---\ntitle: T\nfooter: |\n  一行目\n  二行目\nauthor: A\n---\n\n本文\n';
  const out = setFrontMatterValue(src, 'footer', '');
  assert.equal(out, '---\ntitle: T\nauthor: A\n---\n\n本文\n');
});

t('setFrontMatterValue: 最後の 1 行を消したら front matter ごと畳み、原稿が元へ戻る', () => {
  const src = '# 見出し\n\n本文。\n';
  const added = setFrontMatterValue(src, 'footer', 'NEJM');
  assert.equal(setFrontMatterValue(added, 'footer', ''), src, '往復して元どおり');
  /* 空行を持たない書き方でも本文に触れない */
  assert.equal(setFrontMatterValue('---\nfooter: X\n---\n本文\n', 'footer', ''), '本文\n');
});

t('setFrontMatterValue: 引用符とバックスラッシュを escape する', () => {
  const out = setFrontMatterValue('# H\n', 'footer', 'A "B" \\C');
  assert.equal(splitFrontMatter(out).metadata.footer, 'A "B" \\C');
});

t('setFrontMatterValue: front matter が無く値も空なら何もしない', () => {
  assert.equal(setFrontMatterValue('# H\n', 'footer', ''), '# H\n');
});

t('frontMatterIssues: ブロックスカラーと配列を診断にする（どちらも無警告で壊れる）', () => {
  const block = frontMatterIssues('---\nfooter: |\n  A\n  B\n---\n\n本文\n');
  assert.equal(block.length, 1);
  assert.equal(block[0].kind, 'design');
  /* splitFrontMatter は "|" の 1 文字を値として拾ってしまう */
  assert.equal(splitFrontMatter('---\nfooter: |\n  A\n---\n\n本文\n').metadata.footer, '|');

  const nested = frontMatterIssues('---\nfooter:\n  - A\n  - B\n---\n\n本文\n');
  assert.equal(nested.length, 1);
  /* こちらはキーごと消える */
  assert.equal(splitFrontMatter('---\nfooter:\n  - A\n---\n\n本文\n').metadata.footer, undefined);
});

t('frontMatterIssues: 普通の front matter では何も出さない', () => {
  assert.deepEqual(frontMatterIssues('---\ntitle: T\nfooter: "A / B"\n---\n\n本文\n'), []);
  assert.deepEqual(frontMatterIssues('# 見出しだけ\n'), []);
});

console.log(`\n${n} 件すべて通過`);
