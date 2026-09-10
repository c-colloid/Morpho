/**
 * 起動前の見張り（classic script）。module script が読めなかった場合や
 * 起動前の例外も RN に届くようにする。実機でしか出ない事故を黙らせないため。
 * この冒頭コメントは束ねるときに落とされる（build-bridge.mjs）。
 */
/* 起動前の失敗も RN に届くようにしておく。実機でしか出ない事故を黙らせないため */
window.__rn = function (m) {
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(m));
};
window.addEventListener('error', function (e) {
  window.__rn({ type: 'boot-error', message: 'onerror: ' + (e.message || String(e.error || e)) });
});
window.addEventListener('unhandledrejection', function (e) {
  var r = e.reason;
  window.__rn({ type: 'boot-error', message: 'rejection: ' + String((r && r.message) || r) });
});
/* モジュールスクリプト自体が読めなかった場合の見張り */
window.__booted = false;
setTimeout(function () {
  if (!window.__booted) {
    window.__rn({ type: 'boot-error', message: 'module script did not start within 20s (importmap or CDN unreachable?)' });
  }
}, 20000);
