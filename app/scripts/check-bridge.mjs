/**
 * ブリッジ（不可視 WebView の中身）の検査。
 *
 * 中身が実際に走るのは実機の WebView の中だけなので、手元で落とせるものは落とす:
 *   1. 構文       — boot.js / main.mjs に node --check を直接かける
 *   2. 同一性     — bridge/ を束ねた結果が、コミット済みの bridgeHtml.ts とバイト単位で等しい
 *                   （生成物の更新忘れを CI で止める。直すには npm run build:bridge）
 *   3. 往復       — 生成物のテンプレートリテラルを評価すると束ねた HTML に戻る
 *                   （エスケープの取りこぼしがあればここで分かる）
 *   4. importmap  — JSON として妥当で、必要な指定子が揃っている
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { assembleHtml, buildBridgeTs, BRIDGE_TS, SOURCES } from './build-bridge.mjs';

let failed = false;
const fail = (msg) => {
  failed = true;
  console.error('  FAIL ' + msg);
};

/* 1. 構文 */
for (const key of ['boot', 'main']) {
  const file = fileURLToPath(SOURCES[key]);
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    console.log(`  ok   構文 ${key} (${readFileSync(file).length} bytes)`);
  } catch (e) {
    fail(`構文 ${key}:\n${e.stderr?.toString() ?? e.message}`);
  }
}

/* 2. 同一性 */
const built = buildBridgeTs();
const committed = readFileSync(BRIDGE_TS, 'utf8');
if (built === committed) {
  console.log(`  ok   bridgeHtml.ts は bridge/ と一致 (${committed.length} bytes)`);
} else {
  fail('bridgeHtml.ts が bridge/ と食い違っている。npm run build:bridge を実行してコミットすること');
}

/* 3. 往復 */
const html = assembleHtml();
const decl = committed.indexOf('export const BRIDGE_HTML');
const open = decl < 0 ? -1 : committed.indexOf('`', decl);
const close = committed.lastIndexOf('`');
if (open < 0 || close <= open) {
  fail('BRIDGE_HTML のテンプレートリテラルが見つからない');
} else {
  const evaluated = new Function('return `' + committed.slice(open + 1, close) + '`')();
  if (evaluated === html) console.log(`  ok   テンプレートリテラルの往復 (${html.length} bytes)`);
  else fail('生成物を評価しても束ねた HTML に戻らない（エスケープの取りこぼし）');
}

/* 4. importmap */
const im = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html);
if (!im) {
  fail('importmap が見つからない');
} else {
  try {
    const map = JSON.parse(im[1]);
    for (const spec of ['@bjorn3/browser_wasi_shim', 'fflate']) {
      if (!map.imports?.[spec]) fail(`importmap に ${spec} が無い`);
    }
    if (!failed) console.log('  ok   importmap');
  } catch (e) {
    fail('importmap が JSON として不正: ' + e.message);
  }
}

if (failed) process.exit(1);
console.log('bridge: all ok');
