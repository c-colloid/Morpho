/**
 * 文書ごとの画像アセット保存庫。
 *
 * CLAUDE.md 落とし穴 3: 存在しない画像参照は警告ではなく致命的エラーで
 * 出力が一切生成されない。そこで画像は必ずアプリの保存庫へ取り込み、
 * 原稿からはファイル名だけで参照させる（`![](photo.png)`）。
 * サブディレクトリ付きのパスは pptx で解決されない（実測）ため、名前は
 * 常にフラット。変換前に参照を走査して base64 で変換器へ預ける。
 *
 * 外部（Obsidian 保管庫）の隣接画像は、iOS のアクセス権がファイル単位の
 * ため読めない — フォルダ単位のアクセスは次段（未実装）。
 */
import * as FileSystem from 'expo-file-system/legacy';

import { sanitizeAssetName } from '../text/assetNames';

export { referencedImages, sanitizeAssetName } from '../text/assetNames';

const DIR = FileSystem.documentDirectory + 'morpho/';
const dirOf = (docId: string) => DIR + 'assets-' + docId + '/';


export async function saveAsset(docId: string, name: string, base64: string): Promise<string> {
  if (!FileSystem.documentDirectory) throw new Error('この環境ではファイル保存を使えません');
  await FileSystem.makeDirectoryAsync(dirOf(docId), { intermediates: true }).catch(() => {});
  let final = sanitizeAssetName(name);
  /* 同名は上書きせず連番を挟む（既存の参照を黙って別画像にしない） */
  const existing = await listAssets(docId);
  if (existing.includes(final)) {
    const dot = final.lastIndexOf('.');
    const stem = dot > 0 ? final.slice(0, dot) : final;
    const ext = dot > 0 ? final.slice(dot) : '';
    let i = 2;
    while (existing.includes(stem + '-' + i + ext)) i++;
    final = stem + '-' + i + ext;
  }
  await FileSystem.writeAsStringAsync(dirOf(docId) + final, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return final;
}

export async function listAssets(docId: string): Promise<string[]> {
  return FileSystem.readDirectoryAsync(dirOf(docId)).catch(() => [] as string[]);
}

export async function loadAssetB64(docId: string, name: string): Promise<string | null> {
  return FileSystem.readAsStringAsync(dirOf(docId) + name, {
    encoding: FileSystem.EncodingType.Base64,
  }).catch(() => null);
}

/** プレビューが RN の Image で直接読む URI */
export function assetUri(docId: string, name: string): string {
  return dirOf(docId) + encodeURIComponent(name);
}

export async function deleteAssets(docId: string): Promise<void> {
  await FileSystem.deleteAsync(dirOf(docId), { idempotent: true }).catch(() => {});
}

