/**
 * 文書の保存。
 *
 * 保存先はアプリのサンドボックス（documentDirectory/morpho/）。
 *
 * 外部ファイル（Obsidian 保管庫・Files の .md）は open in place で結べる:
 * @react-native-documents/picker の open モードが返す security-scoped URL へ
 * 直接読み書きする。アクセスは同一起動中のみ有効で、アプリの完全終了後は
 * modules/doc-bookmark（ローカル Expo モジュール）が bookmark を解決して
 * 自動で繋ぎ直す（reconnectExternal）。解決に失敗した場合のみ
 * 選び直し（再接続 UI）へ落とす。
 * 常にサンドボックスへミラーも書くので、接続が切れても内容は失われない。
 *
 * expo-file-system は legacy API に固定する。SDK 54+ の既定 import は
 * 新 API（File/Directory/Paths）で documentDirectory を持たない。混ぜない。
 *
 * index.json は壊れても良い設計にする: 読めなければ *.md を走査して再構築。
 */
import * as FileSystem from 'expo-file-system/legacy';

import { resolveBookmark } from '../../modules/doc-bookmark';

/** 外部ファイル（open in place）への参照 */
export interface ExternalRef {
  /** security-scoped URL。アプリの完全終了でアクセス権が切れる */
  uri: string;
  /** 完全終了後の自動再接続に使う（modules/doc-bookmark が解決する） */
  bookmark?: string;
  fileName: string;
}

export interface DocMeta {
  id: string;
  title: string;
  /** epoch ms */
  updatedAt: number;
  /** 外部ファイルと結ばれた文書。保存はミラーと外部の両方へ書く */
  external?: ExternalRef;
}

const DIR = FileSystem.documentDirectory + 'morpho/';
const INDEX = DIR + 'index.json';
/* 外部参照の控え。index.json が壊れて再構築されても連携が切れないように */
const EXTERNALS = DIR + 'externals.json';

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
  const map: Record<string, ExternalRef> = {};
  for (const d of docs) if (d.external) map[d.id] = d.external;
  await FileSystem.writeAsStringAsync(EXTERNALS, JSON.stringify(map)).catch(() => {});
}

async function readExternalsBackup(): Promise<Record<string, ExternalRef>> {
  try {
    const raw = await FileSystem.readAsStringAsync(EXTERNALS);
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
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
  const externals = await readExternalsBackup();
  const docs: DocMeta[] = [];
  for (const name of names) {
    if (!name.endsWith('.md')) continue;
    const id = name.slice(0, -3);
    const source = await FileSystem.readAsStringAsync(DIR + name).catch(() => null);
    if (source === null) continue;
    const info = await FileSystem.getInfoAsync(DIR + name);
    const updatedAt =
      info.exists && info.modificationTime ? Math.round(info.modificationTime * 1000) : Date.now();
    const meta: DocMeta = { id, title: titleOf(source, updatedAt), updatedAt };
    if (externals[id]) meta.external = externals[id];
    docs.push(meta);
  }
  docs.sort((a, b) => b.updatedAt - a.updatedAt);
  await writeIndex(docs);
  return docs;
}

export async function loadDoc(id: string): Promise<string | null> {
  return FileSystem.readAsStringAsync(pathOf(id)).catch(() => null);
}

/** 本文を書き、index を更新して新しい一覧を返す。external は引き継ぐ */
export async function saveDoc(id: string, source: string): Promise<DocMeta[]> {
  await ensureDir();
  await FileSystem.writeAsStringAsync(pathOf(id), source);
  const now = Date.now();
  const all = await listDocs();
  const prev = all.find((d) => d.id === id);
  const docs = all.filter((d) => d.id !== id);
  const meta: DocMeta = { id, title: titleOf(source, now), updatedAt: now };
  if (prev?.external) meta.external = prev.external;
  docs.unshift(meta);
  await writeIndex(docs);
  return docs;
}

/** 外部ファイルと結ばれた文書を作る（ミラーを書き、参照を index に持つ） */
export async function createExternalDoc(
  source: string,
  external: ExternalRef,
): Promise<{ id: string; docs: DocMeta[] }> {
  await ensureDir();
  const id = newId();
  await FileSystem.writeAsStringAsync(pathOf(id), source);
  const now = Date.now();
  const docs = (await listDocs()).filter((d) => d.id !== id);
  docs.unshift({ id, title: titleOf(source, now), updatedAt: now, external });
  await writeIndex(docs);
  return { id, docs };
}

/** 外部参照の付け替え（再接続）。undefined でアプリ内文書に戻す */
export async function setDocExternal(
  id: string,
  external: ExternalRef | undefined,
): Promise<DocMeta[]> {
  const docs = await listDocs();
  for (const d of docs) {
    if (d.id !== id) continue;
    if (external) d.external = external;
    else delete d.external;
  }
  await writeIndex(docs);
  return docs;
}

/** 外部ファイルを読む。アクセス切れ・不在なら null */
export async function readExternal(ref: ExternalRef): Promise<string | null> {
  return FileSystem.readAsStringAsync(ref.uri).catch(() => null);
}

/** 再接続の結果。text は検証読みの内容、docs は参照更新後の一覧 */
export interface ReconnectedExternal {
  ref: ExternalRef;
  text: string;
  docs: DocMeta[];
}

/**
 * アクセス切れの外部参照を bookmark から自動で繋ぎ直す。
 * 読めることを確かめてから新しい参照を保存し、検証読みの内容と
 * 更新後の一覧ごと返す（呼び出し側の読み直し・listDocs を省く）。
 * 失敗（モジュール不在・bookmark 無効・ファイル削除等）なら null —
 * 呼び出し側が再接続 UI へ落とす。
 * stale だった場合は返ってきた新しい bookmark で置き換える。
 */
export async function reconnectExternal(
  id: string,
  ref: ExternalRef,
): Promise<ReconnectedExternal | null> {
  if (!ref.bookmark) return null;
  const r = await resolveBookmark(ref.bookmark);
  if (!r) return null;
  const next: ExternalRef = {
    uri: r.uri,
    bookmark: r.bookmark ?? ref.bookmark,
    fileName: ref.fileName,
  };
  /* 読めることを確かめてから保存する（開けない URI で参照を潰さない） */
  const text = await readExternal(next);
  if (text === null) return null;
  const docs = await setDocExternal(id, next);
  return { ref: next, text, docs };
}

/**
 * 読み取り + 失敗時は bookmark で自動再接続する。
 * docs は再接続で参照が変わったときだけ入る（呼び出し側が一覧を更新する）。
 */
export async function readExternalReconnecting(
  id: string,
  ref: ExternalRef,
): Promise<{ text: string; ref: ExternalRef; docs?: DocMeta[] } | null> {
  const direct = await readExternal(ref);
  if (direct !== null) return { text: direct, ref };
  return reconnectExternal(id, ref);
}

/** 外部ファイルへ上書きする。アクセス切れなら例外 */
export async function writeExternal(ref: ExternalRef, source: string): Promise<void> {
  await FileSystem.writeAsStringAsync(ref.uri, source);
}

/**
 * 上書き + 失敗時は bookmark で自動再接続して書き直す。
 * docs は再接続で参照が変わったときだけ入る。ok=false なら再接続 UI へ。
 */
export async function writeExternalReconnecting(
  id: string,
  ref: ExternalRef,
  source: string,
): Promise<{ ok: boolean; docs?: DocMeta[] }> {
  try {
    await writeExternal(ref, source);
    return { ok: true };
  } catch {
    /* 下の再接続へ */
  }
  const re = await reconnectExternal(id, ref);
  if (!re) return { ok: false };
  try {
    await writeExternal(re.ref, source);
    return { ok: true, docs: re.docs };
  } catch {
    return { ok: false, docs: re.docs };
  }
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
