/**
 * 更新チェック。GitHub Releases の最新タグと自分の版を比べる。
 *
 * 認証不要の公開 API（レート制限は IP あたり 60 回/時。起動時に1回なので届かない）。
 * iOS はアプリが自分自身を置き換えられないため、ここでは「気づかせる」だけ。
 * 実際の入れ替えは AltStore / SideStore（ソース登録済みならワンタップ）で行う。
 */

const LATEST_API = 'https://api.github.com/repos/c-colloid/Morpho/releases/latest';

/** 'v0.5.1' → '0.5.1'。v 無しはそのまま */
export function parseTag(tag: string): string {
  return tag.replace(/^v/, '').trim();
}

/** 数値の節ごとに比較。長さが違えば足りない節は 0 扱い（0.5 < 0.5.1） */
export function isNewer(remote: string, local: string): boolean {
  const r = remote.split('.').map((s) => Number.parseInt(s, 10) || 0);
  const l = local.split('.').map((s) => Number.parseInt(s, 10) || 0);
  const len = Math.max(r.length, l.length);
  for (let i = 0; i < len; i++) {
    const a = r[i] ?? 0;
    const b = l[i] ?? 0;
    if (a !== b) return a > b;
  }
  return false;
}

export interface UpdateInfo {
  version: string;
  /** リリースページ（人が読む） */
  url: string;
}

/** 新しい版があれば返す。オフライン・API 失敗・同版以下なら null（例外は投げない） */
export async function checkForUpdate(localVersion: string): Promise<UpdateInfo | null> {
  if (!localVersion || localVersion === '?') return null;
  try {
    const res = await fetch(LATEST_API, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    const tag = (json as { tag_name?: unknown }).tag_name;
    const url = (json as { html_url?: unknown }).html_url;
    if (typeof tag !== 'string' || typeof url !== 'string') return null;
    const remote = parseTag(tag);
    return isNewer(remote, localVersion) ? { version: remote, url } : null;
  } catch {
    return null;
  }
}
