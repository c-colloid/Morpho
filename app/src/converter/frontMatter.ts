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
    return t.slice(1, -1);
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
