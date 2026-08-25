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
