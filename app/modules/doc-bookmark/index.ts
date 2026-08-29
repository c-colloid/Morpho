/**
 * bookmark 解決モジュールの JS 側。
 *
 * ネイティブモジュールが無い環境（Expo Go・web バンドル検査など）でも
 * 落ちないよう requireOptionalNativeModule で読み、無ければ null を返して
 * 呼び出し側が再接続 UI（手動でファイルを選び直す）へフォールバックする。
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

export interface ResolvedBookmark {
  /** アクセス可能になったファイル URL */
  uri: string;
  /** bookmark が古く、作り直しが必要だったか */
  stale: boolean;
  /** startAccessingSecurityScopedResource が成功したか */
  accessGranted: boolean;
  /** stale だった場合の新しい bookmark（保存し直す）。それ以外は null */
  bookmark: string | null;
}

interface DocBookmarkNative {
  resolve(bookmarkBase64: string): Promise<ResolvedBookmark>;
}

/** 解決できなければ null（モジュール不在・bookmark 無効・アクセス拒否とも） */
export async function resolveBookmark(bookmarkBase64: string): Promise<ResolvedBookmark | null> {
  const native = requireOptionalNativeModule<DocBookmarkNative>('DocBookmark');
  if (!native) return null;
  try {
    const r = await native.resolve(bookmarkBase64);
    return r && r.uri ? r : null;
  } catch {
    return null;
  }
}
