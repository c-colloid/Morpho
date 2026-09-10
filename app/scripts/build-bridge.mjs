/**
 * ブリッジ（不可視 WebView の中身）を束ねて src/converter/bridgeHtml.ts を生成する。
 *
 *   src/converter/bridge/shell.html   外枠。/*@boot*​/ と /*@main*​/ の目印を持つ
 *   src/converter/bridge/boot.js      起動前の見張り（classic script）
 *   src/converter/bridge/main.mjs     本体（ES module）
 *
 * 生成物はコミットする（Expo の dev client にビルド前フックが無く、Metro は
 * import されたファイルしか見ないため）。更新忘れは check-bridge.mjs が
 * 「束ねた結果とコミット済みの生成物がバイト単位で等しいこと」で止める。
 *
 * エスケープは機械的に 3 種類だけ（\ → \\、` → \`、${ → \${）。テンプレートリテラルとして
 * 評価すれば元の文字列に戻るので、bridgeHtml.ts を評価して中身を叩く検査は無改修で動く。
 *
 * ファイル冒頭の /** … *​/ 解説コメントは束ねるときに落とす（配信量を増やさない・
 * 移行前の配信文字列と 1 バイトも変えない）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => new URL(p, import.meta.url);

export const BRIDGE_DIR = here('../src/converter/bridge/');
export const BRIDGE_TS = here('../src/converter/bridgeHtml.ts');
export const SOURCES = {
  shell: new URL('shell.html', BRIDGE_DIR),
  boot: new URL('boot.js', BRIDGE_DIR),
  main: new URL('main.mjs', BRIDGE_DIR),
};

/** 先頭の /** … *​/ 解説コメント（と直後の空行）を落とす */
function stripHeader(text) {
  if (!text.startsWith('/**')) return text;
  const end = text.indexOf('*/');
  if (end < 0) return text;
  return text.slice(end + 2).replace(/^\r?\n+/, '');
}

/** 末尾の改行 1 つを落とす（shell 側の目印の前後に改行があるため） */
function trimTrailingNewline(text) {
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}

export function assembleHtml() {
  const shell = readFileSync(SOURCES.shell, 'utf8');
  const boot = trimTrailingNewline(stripHeader(readFileSync(SOURCES.boot, 'utf8')));
  const main = trimTrailingNewline(stripHeader(readFileSync(SOURCES.main, 'utf8')));
  for (const mark of ['/*@boot*/', '/*@main*/']) {
    if (shell.split(mark).length !== 2) throw new Error(`shell.html に ${mark} が 1 つだけ必要`);
  }
  return shell.replace('/*@boot*/', () => boot).replace('/*@main*/', () => main);
}

export function escapeForTemplate(html) {
  return html.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

export function renderTs(html) {
  return [
    '/**',
    ' * 生成物。編集しないこと。',
    ' *',
    ' * 元は src/converter/bridge/（shell.html / boot.js / main.mjs）。',
    ' * `npm run build:bridge` で束ね直す。check-bridge.mjs が同一性を検査する。',
    ' */',
    'export const BRIDGE_HTML = `' + escapeForTemplate(html) + '`;',
    '',
  ].join('\n');
}

export function buildBridgeTs() {
  return renderTs(assembleHtml());
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ts = buildBridgeTs();
  writeFileSync(BRIDGE_TS, ts);
  console.log(`bridgeHtml.ts を生成しました (${ts.length} bytes)`);
}
