/**
 * 文書デザインデータの保存（notes/roadmap-pptx.md の三層分離の第3層）。
 *
 * 装飾は Markdown には書かず、文書ごとの JSON（design-<id>.json）に持つ。
 * 保存先は documents.ts と同じサンドボックス。壊れていれば空として扱う
 * （原稿と違い、装飾は失われても内容は無傷という設計）。
 * 将来 .morphodesign として書き出し可能にする（Git 再現用・任意）。
 */
import * as FileSystem from 'expo-file-system/legacy';

import type { SlideDecoration } from '../converter/types';

export interface DesignData {
  version: 1;
  decorations: SlideDecoration[];
}

export const EMPTY_DESIGN: DesignData = { version: 1, decorations: [] };

const DIR = FileSystem.documentDirectory + 'morpho/';
const pathOf = (docId: string) => DIR + 'design-' + docId + '.json';

export function newDecorationId(): string {
  return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export async function loadDesign(docId: string): Promise<DesignData> {
  try {
    const raw = await FileSystem.readAsStringAsync(pathOf(docId));
    const parsed = JSON.parse(raw) as Partial<DesignData>;
    if (parsed.version === 1 && Array.isArray(parsed.decorations)) {
      return { version: 1, decorations: parsed.decorations };
    }
  } catch {
    // 無い・壊れている → 空
  }
  return EMPTY_DESIGN;
}

export async function saveDesign(docId: string, data: DesignData): Promise<void> {
  if (!FileSystem.documentDirectory) throw new Error('この環境ではファイル保存を使えません');
  await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
  await FileSystem.writeAsStringAsync(pathOf(docId), JSON.stringify(data));
}

export async function deleteDesign(docId: string): Promise<void> {
  await FileSystem.deleteAsync(pathOf(docId), { idempotent: true }).catch(() => {});
}
