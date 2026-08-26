/**
 * pandoc が実際に何を吐くかを見るための道具。
 *
 * プレビューのパーサは pptx の XML を正規表現で読んでいるが、
 * 「pandoc がどう書くか」を推測で決めるとまず外す。
 * ここで本物を作って中身を確かめる。
 *
 *   node scripts/dump-pptx.mjs            # 既定のサンプル
 *   node scripts/dump-pptx.mjs foo.md     # 任意の Markdown
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { convert } from '../node_modules/pandoc-wasm/src/index.node.js';

const SAMPLE = `# 見出し

これは普通の段落です。**太字**と*斜体*と\`コード\`を含みます。

- 箇条書き1
- 箇条書き2
  - 入れ子

1. 番号付き
2. ふたつめ

\`\`\`js
const x = 1;
\`\`\`
`;

const md = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : SAMPLE;

const res = await convert(
  { from: 'markdown-yaml_metadata_block', to: 'pptx', 'output-file': 'out.pptx' },
  md,
  {},
);

const blob = res.files['out.pptx'];
const bytes = new Uint8Array(await blob.arrayBuffer());
writeFileSync('/tmp/out.pptx', bytes);

const zip = unzipSync(bytes);
const slides = Object.keys(zip)
  .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
  .sort((a, b) => Number(/(\d+)/.exec(a)[1]) - Number(/(\d+)/.exec(b)[1]));

console.log(`スライド ${slides.length} 枚 / ${bytes.length} bytes\n`);

for (const name of slides) {
  console.log('='.repeat(70));
  console.log(name);
  console.log('='.repeat(70));
  // 段落ごとに改行を入れて読めるようにする
  console.log(
    strFromU8(zip[name])
      .replace(/></g, '>\n<')
      .split('\n')
      .filter((l) => /<a:(p|pPr|r|rPr|t|bu|latin)|<p:(sp|ph|txBody)/.test(l))
      .join('\n'),
  );
  console.log();
}
