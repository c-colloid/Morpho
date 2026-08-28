/**
 * 変換結果をファイルに書いて共有シートへ渡す。
 *
 * 書き出しは Files アプリ（iCloud Drive 含む）への保存・他アプリへの
 * 受け渡しを共有シート経由で行う。サンドボックス保存しかできない
 * 現状では、これが唯一のバックアップ手段でもある。
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

export type ShareKind = 'pptx' | 'docx' | 'md' | 'morphodesign';

const MIME: Record<ShareKind, string> = {
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  md: 'text/markdown',
  /* .morphodesign の中身は JSON */
  morphodesign: 'application/json',
};

/* iOS の共有シートは UTI で挙動が決まる */
const UTI: Record<ShareKind, string> = {
  pptx: 'org.openxmlformats.presentationml.presentation',
  docx: 'org.openxmlformats.wordprocessingml.document',
  md: 'net.daringfireball.markdown',
  morphodesign: 'public.json',
};

/** ファイル名に使えない文字を落とす。日本語はそのまま通す */
export function sanitizeFileName(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 60);
  return cleaned || 'morpho';
}

export async function shareExport(
  fileName: string,
  kind: ShareKind,
  content: { base64?: string; text?: string },
): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('この端末では共有シートを使えません');
  }
  const uri = FileSystem.cacheDirectory + fileName;
  if (content.base64 !== undefined) {
    await FileSystem.writeAsStringAsync(uri, content.base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } else {
    await FileSystem.writeAsStringAsync(uri, content.text ?? '');
  }
  await Sharing.shareAsync(uri, {
    mimeType: MIME[kind],
    UTI: UTI[kind],
    dialogTitle: fileName,
  });
}
