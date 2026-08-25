/**
 * 不可視 WebView の中身。
 *
 * CLAUDE.md:「WKWebView は不可視の計算エンジンとして使う。
 * Markdown を渡すと描画用の JSON を返す。描画はネイティブ側」。
 * ここは計算機に徹する。DOM も UI も持たない。
 *
 * 中身は docs/index.html の検証ハーネスから実証済みの経路だけを抜き出したもの。
 * ハーネス側で確認済みの前提:
 *   - jsdelivr は 50MB 制限で wasm 本体を配れない。unpkg に固定する
 *   - core.js は bare specifier で wasi shim を import するので importmap が要る
 *   - RN 側とは injectJavaScript（下り）と postMessage（上り）でやり取りする
 *
 * 注意: このファイルはテンプレートリテラルなので、
 * 中で ` と ${ を使わないこと（意図せず TS 側の展開に食われる）。
 */
export const BRIDGE_HTML = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>morpho bridge</title>
<script type="importmap">
{
  "imports": {
    "@bjorn3/browser_wasi_shim": "https://cdn.jsdelivr.net/npm/@bjorn3/browser_wasi_shim@0.4.2/+esm",
    "fflate": "https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js"
  }
}
</script>
<script>
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
</script>
</head>
<body>
<script type="module">
import { createPandocInstance } from 'https://cdn.jsdelivr.net/npm/pandoc-wasm@1.1.0/src/core.js';
import { unzipSync } from 'fflate';

window.__booted = true;
var RN = window.__rn;

/* CLAUDE.md 実測: jsdelivr は 50MB 制限で 403。pandoc.org/app は CORS ヘッダなし */
var WASM_URLS = [
  'https://unpkg.com/pandoc-wasm@1.1.0/src/pandoc.wasm',
  'https://pandoc.github.io/pandoc-wasm/pandoc.wasm'
];

/* CLAUDE.md 落とし穴 7: HTML コメントの RawBlock 警告で本当の警告が埋もれる */
var STRIP_LUA = [
  'function RawBlock(el)',
  "  if el.format == 'html' and el.text:match('^%s*<!%-%-') then return {} end",
  'end',
  'function RawInline(el)',
  "  if el.format == 'html' and el.text:match('^%s*<!%-%-') then return {} end",
  'end',
  ''
].join('\\n');

/* CLAUDE.md「警告の重要度分類」 */
var RULES = [
  { re: /not found in resource path/i, kind: 'critical',
    label: '変換が停止します', hint: '画像を files に載せてください' },
  { re: /Couldn't find layout named/i, kind: 'design',
    label: 'レイアウト未検出', hint: '配線盤で対応させると解消します' },
  { re: /Not rendering RawBlock/i, kind: 'info',
    label: '生ブロックを無視', hint: '多くは HTML コメントです' }
];

var pandoc = null;
var wasmInstance = null;

/* インスタンスは公開されないので instantiate を一時的に横取りして掴む */
async function instantiateWithCapture(bin) {
  var orig = WebAssembly.instantiate;
  WebAssembly.instantiate = function () {
    return orig.apply(this, arguments).then(function (r) {
      wasmInstance = r.instance || r;
      return r;
    });
  };
  try {
    return await createPandocInstance(bin.buffer);
  } finally {
    WebAssembly.instantiate = orig;
  }
}

var heapBytes = function () {
  return wasmInstance ? wasmInstance.exports.memory.buffer.byteLength : 0;
};

async function fetchWasm() {
  var lastErr = null;
  for (var i = 0; i < WASM_URLS.length; i++) {
    try {
      var res = await fetch(WASM_URLS[i]);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var total = Number(res.headers.get('content-length')) || 0;
      var chunks = [];
      var got = 0;
      var reader = res.body.getReader();
      for (;;) {
        var step = await reader.read();
        if (step.done) break;
        chunks.push(step.value);
        got += step.value.length;
        RN({ type: 'boot-progress', loadedBytes: got, totalBytes: total });
      }
      var bin = new Uint8Array(got);
      var off = 0;
      for (var c = 0; c < chunks.length; c++) { bin.set(chunks[c], off); off += chunks[c].length; }
      return bin;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('no wasm source reachable');
}

var ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeXml(s) {
  return s.replace(/&(amp|lt|gt|quot|apos|#\\d+);/g, function (m, g) {
    if (g.charAt(0) === '#') return String.fromCharCode(Number(g.slice(1)));
    return ENT[g] || m;
  });
}

function slideNum(name) {
  var m = /slide(\\d+)\\.xml$/.exec(name);
  return m ? Number(m[1]) : 0;
}

/* 出力そのものを読む。reveal.js に逃げると嘘をつくので pptx を直接開く */
function parsePptx(u8) {
  var zip = unzipSync(u8);
  var dec = new TextDecoder();
  var names = Object.keys(zip).filter(function (n) {
    return /^ppt\\/slides\\/slide\\d+\\.xml$/.test(n);
  }).sort(function (a, b) { return slideNum(a) - slideNum(b); });

  /* レイアウト名は theme ではなく slideLayout の p:cSld@name に入っている */
  var layoutName = function (slidePath) {
    try {
      var relPath = slidePath.replace(/^ppt\\/slides\\//, 'ppt/slides/_rels/') + '.rels';
      if (!zip[relPath]) return null;
      var rels = dec.decode(zip[relPath]);
      var hit = /Target="([^"]*slideLayout\\d+\\.xml)"/.exec(rels);
      if (!hit) return null;
      var target = hit[1].replace(/^\\.\\.\\//, 'ppt/');
      if (!zip[target]) return null;
      var xml = dec.decode(zip[target]);
      var cSld = /<p:cSld\\b[^>]*\\sname="([^"]*)"/.exec(xml);
      return cSld ? decodeXml(cSld[1]) : null;
    } catch (e) { return null; }
  };

  var slides = names.map(function (n, i) {
    var xml = dec.decode(zip[n]);
    var lines = [];
    var re = /<a:t>([^<]*)<\\/a:t>/g;
    var m;
    while ((m = re.exec(xml)) !== null) {
      var t = decodeXml(m[1]).trim();
      if (t) lines.push(t);
    }
    return { index: i + 1, layout: layoutName(n), lines: lines };
  });

  return { slideCount: slides.length, slides: slides };
}

function warnText(w) {
  if (typeof w === 'string') return w;
  return (w && (w.message || w.msg)) || JSON.stringify(w);
}

function classify(warnings, stderr) {
  var all = (warnings || []).map(warnText);
  if (stderr) {
    stderr.split(/\\r?\\n/).forEach(function (l) { if (l.trim()) all.push(l); });
  }
  var buckets = [];
  var byLabel = {};
  all.forEach(function (text) {
    var rule = null;
    for (var i = 0; i < RULES.length; i++) {
      if (RULES[i].re.test(text)) { rule = RULES[i]; break; }
    }
    var kind = rule ? rule.kind : 'info';
    var label = rule ? rule.label : 'その他の警告';
    var hint = rule ? rule.hint : '分類前の警告です';
    if (byLabel[label]) { byLabel[label].count += 1; return; }
    var d = { kind: kind, label: label, hint: hint, text: text, count: 1 };
    byLabel[label] = d;
    buckets.push(d);
  });
  var order = { critical: 0, design: 1, info: 2 };
  buckets.sort(function (a, b) { return order[a.kind] - order[b.kind]; });
  return buckets;
}

async function convert(id, md, opts) {
  try {
    if (!pandoc) throw new Error('converter is not ready yet');
    opts = opts || {};
    var options = {
      /* CLAUDE.md 落とし穴 1・2: リーダーは固定し、Auto 検出には頼らない */
      from: 'markdown-yaml_metadata_block',
      to: 'pptx',
      'output-file': 'out.pptx'
    };
    if (opts.metadata && Object.keys(opts.metadata).length) options.metadata = opts.metadata;
    var files = {};
    if (opts.stripHtmlComments) {
      files['strip.lua'] = STRIP_LUA;
      options.filters = ['strip.lua'];
    }

    var t0 = performance.now();
    var res = await pandoc.convert(options, md, files);
    var ms = Math.round(performance.now() - t0);

    var out = res.files && res.files['out.pptx'];
    if (!out) throw new Error('pandoc produced no out.pptx');
    var buf = new Uint8Array(await out.arrayBuffer());
    var parsed = parsePptx(buf);

    RN({
      id: id,
      type: 'ok',
      result: {
        slideCount: parsed.slideCount,
        slides: parsed.slides,
        diagnostics: classify(res.warnings, res.stderr),
        ms: ms,
        bytes: buf.length
      }
    });
  } catch (e) {
    RN({ id: id, type: 'error', message: String((e && e.message) || e) });
  }
}

window.__morphoConvert = function (id, md, opts) { convert(id, md, opts); };

(async function boot() {
  var t0 = performance.now();
  try {
    var bin = await fetchWasm();
    RN({ type: 'boot-instantiating' });
    pandoc = await instantiateWithCapture(bin);
    /* CLAUDE.md 性能設計: 起動時にダミー変換で JIT を温める。実機で 236ms -> 47ms */
    try { await pandoc.convert({ from: 'markdown', to: 'pptx', 'output-file': 'warm.pptx' }, '# warm', {}); } catch (e) {}
    RN({
      type: 'ready',
      bootMs: Math.round(performance.now() - t0),
      heapMB: Math.round(heapBytes() / 1048576)
    });
  } catch (e) {
    RN({ type: 'boot-error', message: String((e && e.message) || e) });
  }
})();
</script>
</body>
</html>`;
