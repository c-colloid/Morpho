/**
 * 文書の保存。
 *
 * 保存先はアプリのサンドボックス（documentDirectory/morpho/）。
 * expo-document-picker はキャッシュへのコピーしか返さないため、
 * iCloud 上の .md への上書き保存は Expo Go では原理的に不可能。
 * ここは dev build + ネイティブ対応までの既知の制約（README 参照）。
 *
 * expo-file-system は legacy API に固定する。SDK 54+ の既定 import は
 * 新 API（File/Directory/Paths）で documentDirectory を持たない。混ぜない。
 *
 * index.json は壊れても良い設計にする: 読めなければ *.md を走査して再構築。
 */
import * as FileSystem from 'expo-file-system/legacy';

export interface DocMeta {
  id: string;
  title: string;
  /** epoch ms */
  updatedAt: number;
}

const DIR = FileSystem.documentDirectory + 'morpho/';
const INDEX = DIR + 'index.json';

const pathOf = (id: string) => DIR + id + '.md';

const two = (n: number) => String(n).padStart(2, '0');

/** front matter の title → 最初の h1 → 日付ベースの仮題 */
export function titleOf(source: string, updatedAt: number): string {
  const fm = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (fm) {
    const t = /^title\s*:\s*(.+)$/m.exec(fm[1]);
    if (t) {
      const v = t[1].trim().replace(/^["']|["']$/g, '');
      if (v) return v;
    }
  }
  const h1 = /^#[ \t]+(.+)$/m.exec(source);
  if (h1) return h1[1].trim();
  const d = new Date(updatedAt);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${two(d.getHours())}:${two(d.getMinutes())} の原稿`;
}

async function ensureDir(): Promise<void> {
  if (!FileSystem.documentDirectory) {
    // web など。null + 'morpho/' が 'nullmorpho/' に化けて黙って迷子になるのを防ぐ
    throw new Error('この環境ではファイル保存を使えません');
  }
  await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
}

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function writeIndex(docs: DocMeta[]): Promise<void> {
  await FileSystem.writeAsStringAsync(INDEX, JSON.stringify({ docs }));
}

/** index.json が読めなければ *.md を走査して作り直す */
export async function listDocs(): Promise<DocMeta[]> {
  await ensureDir();
  try {
    const raw = await FileSystem.readAsStringAsync(INDEX);
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.docs)) {
      return [...parsed.docs].sort((a, b) => b.updatedAt - a.updatedAt);
    }
  } catch {
    // 下の再構築へ
  }
  const names = await FileSystem.readDirectoryAsync(DIR).catch(() => [] as string[]);
  const docs: DocMeta[] = [];
  for (const name of names) {
    if (!name.endsWith('.md')) continue;
    const id = name.slice(0, -3);
    const source = await FileSystem.readAsStringAsync(DIR + name).catch(() => null);
    if (source === null) continue;
    const info = await FileSystem.getInfoAsync(DIR + name);
    const updatedAt =
      info.exists && info.modificationTime ? Math.round(info.modificationTime * 1000) : Date.now();
    docs.push({ id, title: titleOf(source, updatedAt), updatedAt });
  }
  docs.sort((a, b) => b.updatedAt - a.updatedAt);
  await writeIndex(docs);
  return docs;
}

export async function loadDoc(id: string): Promise<string | null> {
  return FileSystem.readAsStringAsync(pathOf(id)).catch(() => null);
}

/** 本文を書き、index を更新して新しい一覧を返す */
export async function saveDoc(id: string, source: string): Promise<DocMeta[]> {
  await ensureDir();
  await FileSystem.writeAsStringAsync(pathOf(id), source);
  const now = Date.now();
  const docs = (await listDocs()).filter((d) => d.id !== id);
  docs.unshift({ id, title: titleOf(source, now), updatedAt: now });
  await writeIndex(docs);
  return docs;
}

export async function createDoc(initial: string): Promise<{ id: string; docs: DocMeta[] }> {
  const id = newId();
  const docs = await saveDoc(id, initial);
  return { id, docs };
}

export async function deleteDoc(id: string): Promise<DocMeta[]> {
  await ensureDir();
  await FileSystem.deleteAsync(pathOf(id), { idempotent: true });
  const docs = (await listDocs()).filter((d) => d.id !== id);
  await writeIndex(docs);
  return docs;
}
