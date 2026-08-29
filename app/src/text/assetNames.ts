/**
 * 画像アセットの名前と参照の走査（純関数）。
 * 保存やファイル IO は store/assets.ts が持つ。ここは node の検査から
 * そのまま読める形に保つ。
 */

/**
 * 取り込み時のファイル名を保存庫用に整える。
 * パス区切りと、Lua / Markdown / XML で困る文字を _ に落としてフラット名にする。
 * （サブディレクトリ付きの参照は pandoc.wasm の pptx で解決されない。実測）
 */
export function sanitizeAssetName(name: string): string {
  const base = name.split('/').pop()!.split('\\').pop()!;
  const cleaned = base.replace(/[()[\]'"`|<>:*?#\s-]/g, '_').trim();
  return cleaned || 'image';
}

/** 原稿が参照する画像名（`![...](name)` のフラット名だけ拾う） */
export function referencedImages(source: string): string[] {
  const out = new Set<string>();
  const re = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const ref = m[1];
    if (/^[a-z]+:/i.test(ref)) continue; /* URL は対象外（wasm から取得できない） */
    if (ref.includes('/')) continue; /* パス付きは解決不能（実測） */
    out.add(ref);
  }
  return [...out];
}
