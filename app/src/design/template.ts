/**
 * テンプレート（自作 pptx）の取り込みと配線盤（純関数）。
 *
 * CLAUDE.md 落とし穴 4: pandoc はレイアウトを英語名で照合する。
 * 日本語版 PowerPoint のテンプレートは「タイトル スライド」等の名前を
 * 持つため一致せず、警告つきで pandoc 既定レイアウトに差し替わる
 * （テーマ色だけ引き継がれる、気づきにくい壊れ方）。
 * 対処はテンプレート側 slideLayoutN.xml の <p:cSld name> を英語名へ
 * 書き換えること。原本は書き換えずに保存し、変換へ渡す直前に
 * 割り当て（英語名 → 元の名前）を適用する — 割り当てはいつでもやり直せる。
 *
 * reference-doc が pandoc.wasm でも効くこと・名前の書き換えで警告が
 * 消えることは実測済み（scripts/check-template.mjs で常時検証）。
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

/** pandoc が照合する 7 つの英語レイアウト名（固定。実測） */
export const PANDOC_LAYOUTS = [
  'Title Slide',
  'Title and Content',
  'Section Header',
  'Two Content',
  'Comparison',
  'Content with Caption',
  'Blank',
] as const;
export type PandocLayout = (typeof PANDOC_LAYOUTS)[number];

/** ユーザー向けの説明（配線盤の行ラベル） */
export const LAYOUT_LABELS: Record<PandocLayout, string> = {
  'Title Slide': '表紙',
  'Title and Content': '見出しと本文',
  'Section Header': 'セクション見出し',
  'Two Content': '2 つのコンテンツ',
  Comparison: '比較',
  'Content with Caption': 'キャプション付き',
  Blank: '白紙',
};

/** 日本語版 PowerPoint の既定レイアウト名 → 英語名（自動割り当て用） */
const JA_NAMES: Record<string, PandocLayout> = {
  'タイトル スライド': 'Title Slide',
  'タイトルスライド': 'Title Slide',
  'タイトルとコンテンツ': 'Title and Content',
  'セクション見出し': 'Section Header',
  '2 つのコンテンツ': 'Two Content',
  '2つのコンテンツ': 'Two Content',
  比較: 'Comparison',
  'タイトル付きのコンテンツ': 'Content with Caption',
  白紙: 'Blank',
};

/** 英語名 → テンプレート内の元レイアウト名 */
export type LayoutAssignments = Partial<Record<PandocLayout, string>>;

const LAYOUT_FILE = /^ppt\/slideLayouts\/slideLayout(\d+)\.xml$/;

const ENT: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
const decodeEnt = (s: string): string => s.replace(/&(?:amp|lt|gt|quot|apos);/g, (m) => ENT[m] ?? m);
const encodeEnt = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** テンプレート内の全レイアウト名（slideLayoutN の番号順） */
export function listLayoutNames(bytes: Uint8Array): string[] {
  const zip = unzipSync(bytes);
  const files = Object.keys(zip)
    .filter((n) => LAYOUT_FILE.test(n))
    .sort((a, b) => Number(LAYOUT_FILE.exec(a)![1]) - Number(LAYOUT_FILE.exec(b)![1]));
  return files
    .map((f) => {
      const m = /<p:cSld name="([^"]*)"/.exec(strFromU8(zip[f]));
      return m ? decodeEnt(m[1]) : '';
    })
    /* 名前の無いレイアウトは配線盤の候補にしても割り当てが効かない（照合できない） */
    .filter((n) => n !== '');
}

/** 英語名そのまま → 同名レイアウト、日本語既定名 → 対応する英語名 を自動で結ぶ */
export function autoAssign(names: string[]): LayoutAssignments {
  const out: LayoutAssignments = {};
  for (const en of PANDOC_LAYOUTS) {
    if (names.includes(en)) out[en] = en;
  }
  for (const n of names) {
    const en = JA_NAMES[n];
    if (en && out[en] === undefined) out[en] = n;
  }
  return out;
}

/**
 * 割り当てを適用した複製を返す（元 bytes は変えない）。
 * - 割り当てられた元名のレイアウト → 英語名に書き換え
 * - 割り当てに使われていないのに英語名を名乗るレイアウト → 退避名を付けて
 *   衝突（同名 2 枚で pandoc がどちらを拾うか不定）を避ける
 */
export function applyAssignments(bytes: Uint8Array, a: LayoutAssignments): Uint8Array {
  const zip = unzipSync(bytes);
  const targetOf: Record<string, string> = {};
  for (const en of PANDOC_LAYOUTS) {
    const orig = a[en];
    if (orig !== undefined) targetOf[orig] = en;
  }
  for (const file of Object.keys(zip)) {
    if (!LAYOUT_FILE.test(file)) continue;
    const xml = strFromU8(zip[file]);
    const m = /<p:cSld name="([^"]*)"/.exec(xml);
    if (!m) continue;
    const name = decodeEnt(m[1]);
    let next: string | null = null;
    if (targetOf[name] !== undefined) {
      next = targetOf[name];
      delete targetOf[name]; /* 同名レイアウトが複数あっても書き換えは1枚だけ */
    } else if ((PANDOC_LAYOUTS as readonly string[]).includes(name) && a[name as PandocLayout] !== name) {
      next = name + ' (template)';
    }
    if (next === null || next === name) continue;
    zip[file] = strToU8(
      xml.replace(/<p:cSld name="[^"]*"/, '<p:cSld name="' + encodeEnt(next) + '"'),
    );
  }
  return zipSync(zip);
}

/* ---------- base64 ⇄ bytes（RN の Hermes / ブラウザ / node に共通の atob/btoa） ---------- */

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

export function bytesToB64(u8: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000; /* fromCharCode の引数上限を踏まないよう分割 */
  for (let i = 0; i < u8.length; i += CHUNK) {
    bin += String.fromCharCode(...u8.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
