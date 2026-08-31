/**
 * front matter を自前で切り出す。
 *
 * CLAUDE.md 落とし穴 1: 空行に続く `---` を pandoc の YAML リーダーに渡すと、
 * 本文中の `---` を終端デリミタとして拾い、`*` や `&` で始まる行を
 * エイリアス/アンカーと解釈して変換ごと落ちる。
 * リーダーは markdown-yaml_metadata_block で固定し、
 * front matter はここで剥がして options.metadata として渡す。
 *
 * 完全な YAML は要らない。スカラーの key: value だけ拾えば足りる。
 */

import type { Diagnostic } from './types';

export interface SplitDocument {
  metadata: Record<string, string>;
  /** front matter を取り除いた本文 */
  body: string;
}

/* XML 1.0 で使えない制御文字。web からのコピペで混入する（実例: NEJM の
   著者行の U+000B）。pandoc は素通しするため slide XML に入り、PowerPoint が
   ファイルごと開けなくなる（LibreOffice 等は黙って通すので気づきにくい） */
const XML_INVALID_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

const stripXmlInvalid = (s: string): string => s.replace(XML_INVALID_RE, ' ');

/**
 * 変換（pandoc へ渡す）直前にだけ適用する。splitFrontMatter 自体は原稿に
 * 忠実なまま返す — 本文の書き戻し（ノート編集・改行編集）が原稿を
 * 書き換えないようにするため。
 * 置換は 1文字 → 1文字なので、本文オフセット（カーソル→スライド対応）は
 * 未適用の body とも互換のまま。
 */
export function sanitizeForXml(doc: SplitDocument): SplitDocument {
  const metadata: Record<string, string> = {};
  for (const k of Object.keys(doc.metadata)) metadata[k] = stripXmlInvalid(doc.metadata[k]);
  return { metadata, body: stripXmlInvalid(doc.body) };
}

const unquote = (v: string): string => {
  const t = v.trim();
  if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0]) {
    const inner = t.slice(1, -1);
    /* YAML のクォート規則ぶんだけ解く。二重引用符は \\ と \"、
       単引用符は '' が 1 つの ' を表す。setFrontMatterValue の書き戻しと対になる */
    return t[0] === '"'
      ? inner.replace(/\\(["\\])/g, '$1')
      : inner.replace(/''/g, "'");
  }
  return t;
};

export function splitFrontMatter(source: string): SplitDocument {
  // 先頭が --- で始まる場合のみ front matter とみなす
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
  if (!m) return { metadata: {}, body: source };

  const metadata: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    // ネストや配列は今は扱わない。インデント行は無視する
    if (/^\s/.test(line)) continue;
    const kv = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const value = unquote(kv[2]);
    if (value) metadata[kv[1]] = value;
  }
  return { metadata, body: source.slice(m[0].length) };
}

/* ---------- front matter の 1 行だけを書き換える ---------- */

const FM_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
/* 値が空・インデント継続行つき・ブロックスカラー（| > |- >-）の見出し */
const BLOCK_SCALAR_RE = /^[|>][-+]?\d*$/;

const quote = (v: string): string => '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

/**
 * front matter の `key: value` を 1 行だけ追加 / 更新 / 削除する。
 *
 * 原稿はユーザーのものなので、**他の行・整形・コメント・本文には触れない**。
 * value が空文字なら該当行（とそのインデント継続行）を消す。
 * front matter が無ければ文書の先頭に作る。値は常に単一行・二重引用符つきで書く
 * （複数行の YAML は splitFrontMatter が読めないため。frontMatterIssues を参照）。
 */
export function setFrontMatterValue(source: string, key: string, value: string): string {
  const v = value.trim();
  const m = FM_RE.exec(source);
  if (!m) {
    if (!v) return source;
    return '---\n' + key + ': ' + quote(v) + '\n---\n\n' + source;
  }
  const nl = m[0].includes('\r\n') ? '\r\n' : '\n';
  const lines = m[1].split(/\r?\n/);
  const keyRe = new RegExp('^' + key + '\\s*:');
  const out: string[] = [];
  let replaced = false;
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s/.test(lines[i]) && keyRe.test(lines[i])) {
      /* この行に属するインデント継続行（ブロックスカラー・配列）ごと差し替える */
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) i++;
      if (v) out.push(key + ': ' + quote(v));
      replaced = true;
      continue;
    }
    out.push(lines[i]);
  }
  if (!replaced && v) out.push(key + ': ' + quote(v));
  const body = source.slice(m[0].length);
  if (out.every((l) => l.trim() === '')) {
    /* 中身が空になったら front matter ごと畳む。作るときに入れた空行も一緒に
       落として、「最初から無かった原稿」へ戻す */
    return body.replace(/^\r?\n/, '');
  }
  return '---' + nl + out.join(nl) + nl + '---' + nl + body;
}

/**
 * front matter のうち splitFrontMatter が読めない書き方を診断にする。
 *
 * スカラーの 1 行しか読まないので、ブロックスカラー（`footer: |`）は値が
 * "|" の 1 文字に、配列やネストはキーごと消える。どちらも**無警告**で
 * 起きるため（実測）、気づけるようにここで拾う。
 */
export function frontMatterIssues(source: string): Diagnostic[] {
  const m = FM_RE.exec(source);
  if (!m) return [];
  const lines = m[1].split(/\r?\n/);
  const block: string[] = [];
  const nested: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s/.test(line) || !line.trim() || line.trimStart().startsWith('#')) continue;
    const kv = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const value = kv[2].trim();
    if (BLOCK_SCALAR_RE.test(value)) block.push(kv[1]);
    else if (!value && i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) nested.push(kv[1]);
  }
  const out: Diagnostic[] = [];
  if (block.length) {
    out.push({
      kind: 'design',
      label: 'front matter の複数行の値は読めません',
      hint: '1 行で書いてください（例: footer: "NEJM 2024;390:1234-45 / Lancet 2023;402:1-10"）',
      text: block.map((k) => k + ': | または >').join(', '),
      count: block.length,
    });
  }
  if (nested.length) {
    out.push({
      kind: 'design',
      label: 'front matter の配列・入れ子は読めません',
      hint: 'この項目は無視されます。1 行のスカラーで書いてください',
      text: nested.join(', '),
      count: nested.length,
    });
  }
  return out;
}
