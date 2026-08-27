/**
 * 統合検査: 本物の pandoc.wasm で pptx を作り、ブリッジの parsePptx を
 * vm で丸ごと動かして、座標・配色・字サイズ・ノートが解決されることを確かめる。
 * パーサ単体の検査 (check-scene) が通っても、継承解決の配線ミスはここでしか捕まらない。
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { convert } from '../node_modules/pandoc-wasm/src/index.node.js';

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
  unzipSync,             // ブリッジ内の自由変数として注入
  performance, TextDecoder, WebAssembly, console, Promise,
});
runInContext(mod, ctx);

/* アプリと同じ経路: front matter は剥がして metadata で渡す（落とし穴1） */
const md = `# 一枚目

本文と**太字**。

- 箇条書き
  - 二階層

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
t('ノートが該当スライドに載る', () => {
  const withNotes = parsed.slides.find((s) => s.notes.length > 0);
  assert.ok(withNotes);
  assert.equal(withNotes.notes[0].runs.map((r) => r.text).join(''), 'ノート本文。');
});

console.log(`\n${n} 件すべて通過`);
