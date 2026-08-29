/**
 * front matter の切り出しの検査。
 * CLAUDE.md 落とし穴 1 の回避が壊れていないことを確かめる。
 */
import assert from 'node:assert/strict';

/* Node 22 の型ストリップで .ts をそのまま読む（ビルド不要） */
const { sanitizeForXml, splitFrontMatter } = await import('../src/converter/frontMatter.ts');

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

console.log(`\n${n} 件すべて通過`);
