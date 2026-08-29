import ExpoModulesCore

/*
 * セキュリティスコープ付き bookmark の解決。
 *
 * @react-native-documents/picker の open モード（requestLongTermAccess: true）が
 * 返す base64 の bookmark を、アプリ再起動後にファイル URL へ戻す。
 * ピッカー側は bookmark の「生成」だけで「解決」の API を持たないため、
 * 同梱 viewer パッケージの実装（URLByResolvingBookmarkData +
 * startAccessingSecurityScopedResource）をそのまま踏襲した最小モジュール。
 *
 * stale（ファイル移動などで作り直しが必要）の場合は、解決できた URL から
 * 新しい bookmark を作って返す（呼び出し側が保存し直す）。
 */
public class DocBookmarkModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DocBookmark")

    AsyncFunction("resolve") { (bookmarkBase64: String) -> [String: Any?] in
      guard let data = Data(base64Encoded: bookmarkBase64) else {
        throw InvalidBookmarkException()
      }
      var stale = false
      let url = try URL(
        resolvingBookmarkData: data,
        options: [.withoutUI],
        relativeTo: nil,
        bookmarkDataIsStale: &stale
      )
      /* アクセス権はプロセス終了まで持ち続ける（現行の open モードと同じ寿命）。
         対で stop する API は今は不要 */
      let granted = url.startAccessingSecurityScopedResource()
      var refreshed: String? = nil
      if stale {
        refreshed = (try? url.bookmarkData(
          options: .minimalBookmark,
          includingResourceValuesForKeys: nil,
          relativeTo: nil
        ))?.base64EncodedString()
      }
      return [
        "uri": url.absoluteString,
        "stale": stale,
        "accessGranted": granted,
        "bookmark": refreshed,
      ]
    }
  }
}

internal final class InvalidBookmarkException: Exception {
  override var reason: String {
    "bookmark is not valid base64"
  }
}
