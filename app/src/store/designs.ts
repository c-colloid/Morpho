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
import type { TextSizes } from '../design/textSizes';
import { sanitizeTextSizes } from '../design/designFile';

/** 装飾のグループ（roadmap: データはメンバー ID の配列）。同一スライド内のみ */
export interface DecorGroup {
  id: string;
  contentIndex: number;
  memberIds: string[];
}

export interface DesignData {
  version: 1;
  decorations: SlideDecoration[];
  groups: DecorGroup[];
  /** 文字サイズの上書き（pt）。未指定はテンプレート既定 */
  text?: TextSizes;
}

export const EMPTY_DESIGN: DesignData = { version: 1, decorations: [], groups: [] };

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
      const out: DesignData = {
        version: 1,
        decorations: parsed.decorations,
        /* 0.6.2 以前のファイルには groups が無い */
        groups: Array.isArray(parsed.groups) ? parsed.groups : [],
      };
      /* 壊れた・手で編集されたファイルでも NaN 等をプレビューへ流さない */
      const text = sanitizeTextSizes(parsed.text);
      if (text) out.text = text;
      return out;
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
