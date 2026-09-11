/**
 * 画像リンクの書き方の吸収（純関数）。
 *
 * Morpho が pandoc に渡す標準形は `![alt](名前.png "title")` の 1 つだけで、
 * 名前は取り込み時のフラット名（sanitizeAssetName）。書き手は他のエディタから
 * 原稿を持ち込むので、次の書き方も**変換直前に**標準形へ寄せる（原稿は書き換えない）:
 *
 *   ![[写真.png]] / ![[写真.png|説明]] / ![[写真.png|300]] / ![[写真.png|300x200]]
 *                                   … Obsidian / Logseq / Foam の埋め込み
 *   <img src="写真.png" alt="説明" width="300">   … HTML（pptx は raw HTML を無警告で捨てる）
 *   ![説明][id] と [id]: 写真.png     … 参照形式（pandoc はそのまま読む。名前だけ拾う）
 *   ![説明](<写真 1.png>)             … 空白入りの名前（CommonMark の <>）
 *   ![説明](attachments/写真.png)     … フォルダ付き（pandoc.wasm はフォルダを解決しない。実測）
 *
 * 規則は 1 つ: どの書き方でも、名前は取り込み時と同じ規則（sanitizeAssetName）で
 * フラット名に落として照合する。URL（scheme 付き）は触らない。
 * 書き換えは行の中だけで完結させ**行数を変えない**（スライド境界と行番号を保つ）。
 * コードフェンスとインラインコードの中は触らない。
 */
import { sanitizeAssetName } from './assetNames.ts';

/** 画像として扱う拡張子（Obsidian の `![[note]]` はノート埋め込みなので対象外） */
export const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif|tiff?|avif)$/i;

const URL_RE = /^[a-z][a-z0-9+.-]*:/i;
const CODE_FENCE = /^ {0,3}(```|~~~)/;

/** 参照名をフラット名へ。URL はそのまま。`%20` 等は解いてから落とす */
export function flattenImageRef(ref: string): string {
  const t = ref.trim();
  if (!t || URL_RE.test(t)) return t;
  let decoded = t;
  try { decoded = decodeURIComponent(t); } catch { /* 壊れた % はそのまま */ }
  return sanitizeAssetName(decoded);
}

/** Obsidian の `|` 以降: 数字なら幅、幅x高さ、それ以外は alt */
function wikiTail(tail: string | undefined): { alt: string; attr: string } {
  const s = (tail ?? '').trim();
  if (!s) return { alt: '', attr: '' };
  let m = /^(\d+)x(\d+)$/.exec(s);
  if (m) return { alt: '', attr: `{width=${m[1]}px height=${m[2]}px}` };
  m = /^(\d+)$/.exec(s);
  if (m) return { alt: '', attr: `{width=${m[1]}px}` };
  return { alt: s.replace(/[[\]]/g, ''), attr: '' };
}

const escAlt = (s: string): string => s.replace(/[[\]]/g, '');

/** HTML の属性値（"…" / '…' / 裸） */
function htmlAttr(tag: string, name: string): string | null {
  const m = new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>"\']+))', 'i').exec(tag);
  if (!m) return null;
  return m[1] ?? m[2] ?? m[3] ?? '';
}

/** インラインコード（`…`）の外だけに fn を当てる */
function outsideCode(line: string, fn: (s: string) => string): string {
  return line.split(/(`+[^`]*`+)/).map((part, i) => (i % 2 === 1 ? part : fn(part))).join('');
}

function normalizeLine(line: string): string {
  return outsideCode(line, normalizeText);
}

function normalizeText(line: string): string {
  let out = line;
  /* 1. Obsidian の埋め込み。画像拡張子のものだけ */
  out = out.replace(/!\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/g, (whole, target: string, tail?: string) => {
    if (!IMAGE_EXT_RE.test(target.trim())) return whole;
    const { alt, attr } = wikiTail(tail);
    return `![${alt}](${flattenImageRef(target)})${attr}`;
  });
  /* 2. HTML の <img> */
  out = out.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = htmlAttr(tag, 'src');
    if (!src) return tag;
    const alt = escAlt(htmlAttr(tag, 'alt') ?? '');
    const w = htmlAttr(tag, 'width');
    const h = htmlAttr(tag, 'height');
    const dims: string[] = [];
    if (w && /^\d+$/.test(w)) dims.push(`width=${w}px`);
    if (h && /^\d+$/.test(h)) dims.push(`height=${h}px`);
    return `![${alt}](${flattenImageRef(src)})${dims.length ? '{' + dims.join(' ') + '}' : ''}`;
  });
  /* 3. 標準形（<> 付き・フォルダ付き・%20）。title と後続の属性はそのまま */
  out = out.replace(/!\[([^\]]*)\]\(\s*(?:<([^>]*)>|([^)\s]+))((?:\s+"(?:[^"\\]|\\.)*")?\s*)\)/g,
    (whole, alt: string, angled: string | undefined, bare: string | undefined, rest: string) => {
      const target = angled ?? bare ?? '';
      if (URL_RE.test(target.trim())) return whole;
      return `![${alt}](${flattenImageRef(target)}${rest.replace(/\s+$/, '')})`;
    });
  /* 4. 参照定義。画像拡張子のものだけ名前を落とす（.md 等へのリンクは触らない） */
  out = out.replace(/^( {0,3}\[[^\]]+\]:\s*)(?:<([^>]*)>|(\S+))(.*)$/, (whole, head: string, angled: string | undefined, bare: string | undefined, rest: string) => {
    const target = angled ?? bare ?? '';
    if (URL_RE.test(target) || !IMAGE_EXT_RE.test(target.replace(/[?#].*$/, ''))) return whole;
    return head + flattenImageRef(target) + rest;
  });
  return out;
}

/**
 * 原稿の画像リンクを標準形へ寄せる。行数は変えない。
 * 変換（pandoc へ渡す）直前と、参照する画像の走査に使う。
 */
export function normalizeImageLinks(body: string): string {
  const lines = body.split('\n');
  let inCode = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const cr = raw.endsWith('\r');
    const line = cr ? raw.slice(0, -1) : raw;
    if (CODE_FENCE.test(line)) { inCode = !inCode; continue; }
    if (inCode) continue;
    if (!/!\[|<img\b|^ {0,3}\[[^\]]+\]:/i.test(line)) continue;
    const next = normalizeLine(line);
    if (next !== line) lines[i] = cr ? next + '\r' : next;
  }
  return lines.join('\n');
}

/** その行が（どの書き方でも）画像 1 つだけか。スライド分割の推定に使う */
export function isImageOnlyLine(line: string): boolean {
  const l = normalizeLine(line.replace(/\r$/, ''));
  return /^ {0,3}!\[[^\]]*\]\([^)]*\)(\{[^}]*\})?\s*$/.test(l);
}

/** 原稿が参照する画像名（どの書き方でも。URL は除外） */
export function imageRefsOf(body: string): string[] {
  const out = new Set<string>();
  const norm = normalizeImageLinks(body);
  const inline = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"(?:[^"\\]|\\.)*")?\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = inline.exec(norm)) !== null) {
    if (!URL_RE.test(m[1])) out.add(m[1]);
  }
  const def = /^ {0,3}\[[^\]]+\]:\s*(\S+)/gm;
  while ((m = def.exec(norm)) !== null) {
    if (!URL_RE.test(m[1]) && IMAGE_EXT_RE.test(m[1])) out.add(m[1]);
  }
  return [...out];
}
