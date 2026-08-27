/**
 * ブリッジ HTML に埋めた JavaScript の構文チェック。
 *
 * 中身が実際に走るのは実機の WebView の中だけなので、
 * 構文エラーだけでも手元で落とせるようにしておく。
 * node --check 相当を vm.SourceTextModule なしで行うため、
 * 一度ファイルに書き出して動的 import ではなくパースだけ試す。
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const src = readFileSync(new URL('../src/converter/bridgeHtml.ts', import.meta.url), 'utf8');

// 冒頭の解説コメントにもバッククォートが出るので、宣言の後ろから探す
const decl = src.indexOf('export const BRIDGE_HTML');
const open = decl < 0 ? -1 : src.indexOf('`', decl);
const close = src.lastIndexOf('`');
if (open < 0 || close <= open) {
  console.error('BRIDGE_HTML のテンプレートリテラルが見つかりません');
  process.exit(1);
}
const raw = src.slice(open + 1, close);

if (raw.includes('${')) {
  console.error('BRIDGE_HTML に ${ が混ざっています（TS 側の展開に食われます）');
  process.exit(1);
}

/* raw はソースそのままなので \\d などが未解決。
   テンプレートリテラルとして評価して、実際に配信される文字列にする */
const html = new Function('return `' + raw + '`')();

const blocks = [...html.matchAll(/<script(?:\s+type="module")?\s*>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1])
  .filter((body) => !body.includes('"imports"'));

if (blocks.length < 2) {
  console.error(`script ブロックが ${blocks.length} 個しか見つかりません（2 個以上を期待）`);
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'morpho-bridge-'));
let failed = false;

blocks.forEach((body, i) => {
  const isModule = body.includes('import ');
  const file = join(dir, `block-${i}.${isModule ? 'mjs' : 'js'}`);
  writeFileSync(file, body);
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    console.log(`  ok   block ${i} (${isModule ? 'module' : 'classic'}, ${body.length} bytes)`);
  } catch (e) {
    failed = true;
    console.error(`  FAIL block ${i}:\n${e.stderr?.toString() ?? e.message}`);
  }
});

// importmap が JSON として妥当か
const mapMatch = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html);
if (!mapMatch) {
  console.error('importmap が見つかりません');
  failed = true;
} else {
  try {
    const map = JSON.parse(mapMatch[1]);
    const keys = Object.keys(map.imports ?? {});
    console.log(`  ok   importmap (${keys.join(', ')})`);
  } catch (e) {
    console.error(`  FAIL importmap は JSON として不正: ${e.message}`);
    failed = true;
  }
}

// 上りの窓口が実在するか
for (const needle of ['window.__morphoConvert', 'window.__morphoExport', 'ReactNativeWebView.postMessage']) {
  if (!html.includes(needle)) {
    console.error(`  FAIL ${needle} が見つかりません`);
    failed = true;
  } else {
    console.log(`  ok   ${needle}`);
  }
}

process.exit(failed ? 1 : 0);
