/**
 * pandoc が docx で実際に何を吐くかを見るための道具。
 * dump-pptx.mjs と同じ要領。docx プレビュー用パーサの設計材料集め。
 *
 *   node scripts/dump-docx.mjs
 */
import { writeFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { convert } from '../node_modules/pandoc-wasm/src/index.node.js';

const SAMPLE = `---
title: "検証"
author: "検査"
---

# 一枚目

本文と**太字**と*斜体*と\`コード\`。

改行位置を\\
固定した段落。

- 箇条書き
  - 二階層
    - 三階層

1. 番号付き
2. ふたつめ

\`\`\`js
const x = 1;
\`\`\`

| 列A | 列B |
|---|---|
| 1 | 2 |

::: notes
発表者ノート。
:::

***

# 二枚目

次の内容。
`;

const res = await convert(
  {
    from: 'markdown-yaml_metadata_block+east_asian_line_breaks',
    to: 'docx',
    'output-file': 'o.docx',
    metadata: { title: '検証', author: '検査' },
  },
  SAMPLE,
  {},
);

console.log('--- stderr/warnings ---');
console.log(res.stderr);
console.log(JSON.stringify(res.warnings, null, 2));

const blob = res.files['o.docx'];
if (!blob) {
  console.log('files keys:', Object.keys(res.files));
  throw new Error('o.docx が生成されなかった');
}
const bytes = new Uint8Array(await blob.arrayBuffer());
writeFileSync('/tmp/out.docx', bytes);
console.log(`\n出力: ${bytes.length} bytes -> /tmp/out.docx\n`);

const zip = unzipSync(bytes);
console.log('--- zip内エントリ一覧 ---');
for (const name of Object.keys(zip).sort()) {
  console.log(`${name}  (${zip[name].length} bytes)`);
}

function dump(name, { collapse = true } = {}) {
  console.log('\n' + '='.repeat(70));
  console.log(name);
  console.log('='.repeat(70));
  if (!zip[name]) {
    console.log('(存在しない)');
    return;
  }
  const xml = strFromU8(zip[name]);
  writeFileSync(`/tmp/dump-${name.replace(/\//g, '_')}`, xml);
  if (collapse) {
    console.log(xml.replace(/></g, '>\n<'));
  } else {
    console.log(xml);
  }
}

dump('word/document.xml');
dump('word/styles.xml');
dump('word/numbering.xml');
