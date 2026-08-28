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
import { unzipSync, zipSync, strToU8 } from 'fflate';

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

/* CLAUDE.md 落とし穴 8: ::: notes ::: は docx で無警告のまま本文に混入する */
var DROP_NOTES_LUA = [
  'function Div(el)',
  "  if el.classes:includes('notes') then return {} end",
  'end',
  ''
].join('\\n');

/* CLAUDE.md 落とし穴 1・2: リーダーは固定し、Auto 検出には頼らない。
   east_asian_line_breaks: 和文の行内折り返しが半角スペースにならない（実測済み） */
var READER = 'markdown-yaml_metadata_block+east_asian_line_breaks';

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

/* pandoc.wasm は走り出したら中断できず、同時再入の挙動も未検証。
   プレビュー・書き出し・暖機のどこから来ても、ここで必ず直列化する */
var chain = Promise.resolve();
function serialized(fn) {
  var next = chain.then(fn, fn);
  chain = next.catch(function () {});
  return next;
}

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

/* ---- pptx の本文を図形 / 段落 / ラン の三層で読む ----
   <a:t> だけを拾うと太字・箇条書き・コードが全部同じ見た目になる。
   書式は <a:rPr b= i= u=> と <a:latin typeface=>、階層は <a:pPr lvl=> にある。 */

var MONO_FACE = /courier|consolas|monaco|menlo|mono/i;

function parseRuns(paragraphXml) {
  var runs = [];
  /* <a:r> だけでなく、行内改行 <a:br/>（原稿の行末 \\ / スペース2つ由来）も
     出現順に拾う。落とすとプレビューだけ改行が消える */
  var re = /<a:r>([\\s\\S]*?)<\\/a:r>|<a:br\\s*\\/>/g;
  var m;
  while ((m = re.exec(paragraphXml)) !== null) {
    if (m[1] === undefined) {
      /* <a:br/>: 直前のランに改行を継ぎ足す（RN の Text は \\n で改行する） */
      if (runs.length) runs[runs.length - 1].text += '\\n';
      else runs.push({ text: '\\n' });
      continue;
    }
    var r = m[1];
    var t = /<a:t>([\\s\\S]*?)<\\/a:t>/.exec(r);
    if (!t) continue;
    var rPr = /<a:rPr\\b([^>]*)>/.exec(r);
    var attrs = rPr ? rPr[1] : '';
    var latin = /<a:latin\\b[^>]*\\btypeface="([^"]*)"/.exec(r);
    var run = { text: decodeXml(t[1]) };
    if (/\\bb="(1|true)"/.test(attrs)) run.bold = true;
    if (/\\bi="(1|true)"/.test(attrs)) run.italic = true;
    if (/\\bu="(sng|dbl)"/.test(attrs)) run.underline = true;
    if (latin && MONO_FACE.test(latin[1])) run.mono = true;
    runs.push(run);
  }
  return runs;
}

function parseParagraphs(txBodyXml) {
  var out = [];
  var re = /<a:p>([\\s\\S]*?)<\\/a:p>/g;
  var m;
  while ((m = re.exec(txBodyXml)) !== null) {
    var body = m[1];
    var level = 0;
    /* pandoc は普通の段落に marL="0" indent="0" を明示し、箇条書きは
       マスターの lvl 既定（marL=342900*(n+1), indent=-342900）に任せる。
       字下げの実寸を出すため、上書きの有無ごと持ち帰る（null = 継承） */
    var marL = null;
    var indent = null;
    var pPr = /<a:pPr\\b([^>]*)/.exec(body);
    if (pPr) {
      var lvl = /\\blvl="(\\d+)"/.exec(pPr[1]);
      if (lvl) level = Number(lvl[1]);
      var ml = /\\bmarL="(-?\\d+)"/.exec(pPr[1]);
      if (ml) marL = Number(ml[1]);
      var ind = /\\bindent="(-?\\d+)"/.exec(pPr[1]);
      if (ind) indent = Number(ind[1]);
    }
    /* pandoc は箇条書きでない段落に buNone を明示する。
       箇条書きは何も書かずレイアウトの既定（行頭記号）に任せるので、
       「buNone が無い＝箇条書き」で判定する。 */
    var bullet = 'bullet';
    if (/<a:buNone\\s*\\/>/.test(body)) bullet = 'none';
    else if (/<a:buAutoNum\\b/.test(body)) bullet = 'number';
    var runs = parseRuns(body);
    if (runs.length) out.push({ runs: runs, level: level, bullet: bullet, marL: marL, indent: indent });
  }
  return out;
}

function parseShapes(slideXml) {
  var shapes = [];
  var re = /<p:sp>([\\s\\S]*?)<\\/p:sp>/g;
  var m;
  while ((m = re.exec(slideXml)) !== null) {
    var sp = m[1];
    var txBody = /<p:txBody>([\\s\\S]*?)<\\/p:txBody>/.exec(sp);
    if (!txBody) continue;
    var paragraphs = parseParagraphs(txBody[1]);
    if (!paragraphs.length) continue;

    /* <p:ph type="title"/> のように種別が入る。type 省略時は body 扱い */
    var placeholder = null;
    var phIdx = null;
    var ph = /<p:ph\\b([^>]*)/.exec(sp);
    if (ph) {
      var type = /\\btype="([^"]*)"/.exec(ph[1]);
      placeholder = type ? type[1] : 'body';
      var idx = /\\bidx="(\\d+)"/.exec(ph[1]);
      if (idx) phIdx = Number(idx[1]);
    }
    shapes.push({
      placeholder: placeholder,
      phIdx: phIdx,
      frame: parseXfrm(sp),
      paragraphs: paragraphs
    });
  }
  return shapes;
}

/* パーサだけ検査できるように外へ出す（scripts/check-scene.mjs が使う） */
window.__morphoParseShapes = parseShapes;

/* <a:xfrm><a:off x= y=/><a:ext cx= cy=/></a:xfrm> を読む。無ければ null */
function parseXfrm(xml) {
  var off = /<a:off\\s+x="(-?\\d+)"\\s+y="(-?\\d+)"/.exec(xml);
  var ext = /<a:ext\\s+cx="(\\d+)"\\s+cy="(\\d+)"/.exec(xml);
  if (!off || !ext) return null;
  return { x: Number(off[1]), y: Number(off[2]), w: Number(ext[1]), h: Number(ext[2]) };
}

/* レイアウト / マスターのプレースホルダ一覧（type, idx, frame）。
   pandoc 既定テンプレートでは座標はマスターだけが持つ（実測）。
   reference-doc ではレイアウトが持ち得るので両方読む */
function parsePlaceholderFrames(xml) {
  var out = [];
  var re = /<p:sp>([\\s\\S]*?)<\\/p:sp>/g;
  var m;
  while ((m = re.exec(xml)) !== null) {
    var ph = /<p:ph\\b([^>]*)/.exec(m[1]);
    if (!ph) continue;
    var type = /\\btype="([^"]*)"/.exec(ph[1]);
    var idx = /\\bidx="(\\d+)"/.exec(ph[1]);
    out.push({
      type: type ? type[1] : null,
      idx: idx ? Number(idx[1]) : null,
      frame: parseXfrm(m[1])
    });
  }
  return out;
}
window.__morphoParsePlaceholderFrames = parsePlaceholderFrames;

/* タイトルは type で、本文は type か idx で照合する。
   ctrTitle（Title Slide）の座標はマスターに無いので title に落とす */
function findFrame(phList, type, idx) {
  var want = type === 'ctrTitle' ? 'title' : type;
  for (var i = 0; i < phList.length; i++) {
    if (phList[i].frame && phList[i].type === want) return phList[i].frame;
  }
  if (idx !== null) {
    for (var j = 0; j < phList.length; j++) {
      if (phList[j].frame && phList[j].idx === idx) return phList[j].frame;
    }
  }
  /* subTitle 等: type でも idx でも一致しなければ body に落とす */
  if (want !== 'title') {
    for (var k = 0; k < phList.length; k++) {
      if (phList[k].frame && phList[k].type === 'body') return phList[k].frame;
    }
  }
  return null;
}
window.__morphoFindFrame = findFrame;

/* デッキ情報: 寸法・配色・既定の文字サイズ */
function parseDeck(zip, dec) {
  var deck = { w: 9144000, h: 5143500, colors: {}, titleSz: 3300, bodySz: [2400, 2100, 1800, 1500, 1500], bodyMarL: [], bodyIndent: [] };
  /* 既定はマスターの実測値: marL=342900*(n+1), indent=-342900（27pt 刻みのぶら下げ） */
  for (var di = 0; di < 9; di++) {
    deck.bodyMarL.push(342900 * (di + 1));
    deck.bodyIndent.push(-342900);
  }
  try {
    var pres = dec.decode(zip['ppt/presentation.xml']);
    var sz = /<p:sldSz\\s+cx="(\\d+)"\\s+cy="(\\d+)"/.exec(pres);
    if (sz) { deck.w = Number(sz[1]); deck.h = Number(sz[2]); }
  } catch (e) {}
  try {
    var theme = dec.decode(zip['ppt/theme/theme1.xml']);
    var clr = /<a:clrScheme[\\s\\S]*?<\\/a:clrScheme>/.exec(theme);
    if (clr) {
      var re = /<a:(dk1|lt1|dk2|lt2|accent[1-6]|hlink|folHlink)>[\\s\\S]*?(?:val|lastClr)="([0-9A-Fa-f]{6})"/g;
      var m;
      while ((m = re.exec(clr[0])) !== null) deck.colors[m[1]] = '#' + m[2];
    }
  } catch (e) {}
  try {
    var masterName = Object.keys(zip).filter(function (n) {
      return /^ppt\\/slideMasters\\/slideMaster\\d+\\.xml$/.test(n);
    })[0];
    var master = dec.decode(zip[masterName]);
    var ts = /<p:titleStyle>[\\s\\S]*?<\\/p:titleStyle>/.exec(master);
    if (ts) {
      var tsz = /sz="(\\d+)"/.exec(ts[0]);
      if (tsz) deck.titleSz = Number(tsz[1]);
    }
    var bs = /<p:bodyStyle>[\\s\\S]*?<\\/p:bodyStyle>/.exec(master);
    if (bs) {
      var sizes = [];
      var lre = /<a:lvl(\\d)pPr[\\s\\S]*?sz="(\\d+)"/g;
      var lm;
      while ((lm = lre.exec(bs[0])) !== null) sizes[Number(lm[1]) - 1] = Number(lm[2]);
      for (var i2 = 0; i2 < 5; i2++) if (!sizes[i2]) sizes[i2] = deck.bodySz[i2];
      deck.bodySz = sizes.slice(0, 5);
      /* テンプレートごとの字下げ幅。lvlNpPr の属性から marL / indent を拾う */
      var pre = /<a:lvl(\\d)pPr([^>]*)>/g;
      var pm;
      while ((pm = pre.exec(bs[0])) !== null) {
        var lv = Number(pm[1]) - 1;
        var ml2 = /\\bmarL="(-?\\d+)"/.exec(pm[2]);
        if (ml2) deck.bodyMarL[lv] = Number(ml2[1]);
        var in2 = /\\bindent="(-?\\d+)"/.exec(pm[2]);
        if (in2) deck.bodyIndent[lv] = Number(in2[1]);
      }
    }
    deck.masterPh = parsePlaceholderFrames(master);
  } catch (e) { deck.masterPh = []; }
  return deck;
}

/* 出力そのものを読む。reveal.js に逃げると嘘をつくので pptx を直接開く */
function parsePptx(u8) {
  var zip = unzipSync(u8);
  var dec = new TextDecoder();
  var names = Object.keys(zip).filter(function (n) {
    return /^ppt\\/slides\\/slide\\d+\\.xml$/.test(n);
  }).sort(function (a, b) { return slideNum(a) - slideNum(b); });

  var deck = parseDeck(zip, dec);
  var layoutPhCache = {};
  var layoutPhOf = function (slidePath) {
    var hit = /Target="([^"]*slideLayout\\d+\\.xml)"/.exec(relsOf(slidePath));
    if (!hit) return [];
    var target = hit[1].replace(/^\\.\\.\\//, 'ppt/');
    if (!(target in layoutPhCache)) {
      layoutPhCache[target] = zip[target]
        ? parsePlaceholderFrames(dec.decode(zip[target]))
        : [];
    }
    return layoutPhCache[target];
  };

  var relsOf = function (slidePath) {
    var relPath = slidePath.replace(/^ppt\\/slides\\//, 'ppt/slides/_rels/') + '.rels';
    return zip[relPath] ? dec.decode(zip[relPath]) : '';
  };

  /* レイアウト名は theme ではなく slideLayout の p:cSld@name に入っている */
  var layoutName = function (slidePath) {
    try {
      var hit = /Target="([^"]*slideLayout\\d+\\.xml)"/.exec(relsOf(slidePath));
      if (!hit) return null;
      var target = hit[1].replace(/^\\.\\.\\//, 'ppt/');
      if (!zip[target]) return null;
      var cSld = /<p:cSld\\b[^>]*\\sname="([^"]*)"/.exec(dec.decode(zip[target]));
      return cSld ? decodeXml(cSld[1]) : null;
    } catch (e) { return null; }
  };

  /* 発表者ノート。スライドとの対応は番号一致ではなく rels 経由（実測で確認）。
     notesSlide の本文は type="body"。sldImg / sldNum は除外する */
  var notesFor = function (slidePath) {
    try {
      var hit = /Target="([^"]*notesSlide\\d+\\.xml)"/.exec(relsOf(slidePath));
      if (!hit) return [];
      var target = hit[1].replace(/^\\.\\.\\//, 'ppt/');
      if (!zip[target]) return [];
      var shapes = parseShapes(dec.decode(zip[target]));
      var out = [];
      for (var i = 0; i < shapes.length; i++) {
        if (shapes[i].placeholder === 'body') out = out.concat(shapes[i].paragraphs);
      }
      return out;
    } catch (e) { return []; }
  };

  var slides = names.map(function (n, i) {
    var shapes = parseShapes(dec.decode(zip[n]));
    var layoutPh = layoutPhOf(n);
    for (var si = 0; si < shapes.length; si++) {
      var sh = shapes[si];
      if (!sh.frame) {
        /* 自前の座標が無ければ レイアウト → マスター の順で継承（実測どおり） */
        sh.frame =
          findFrame(layoutPh, sh.placeholder, sh.phIdx) ||
          findFrame(deck.masterPh, sh.placeholder, sh.phIdx);
      }
    }
    return {
      index: i + 1,
      layout: layoutName(n),
      shapes: shapes,
      notes: notesFor(n)
    };
  });

  return {
    slideCount: slides.length,
    slides: slides,
    deck: { w: deck.w, h: deck.h, colors: deck.colors, titleSz: deck.titleSz, bodySz: deck.bodySz, bodyMarL: deck.bodyMarL, bodyIndent: deck.bodyIndent }
  };
}
window.__morphoParsePptx = parsePptx;

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

/* ---- 装飾の OOXML 後処理（notes/roadmap-pptx.md「飾る力」） ----
   pandoc が吐いた pptx の spTree に <p:sp> を注入する。
   既存の図形より前（grpSpPr の直後）に置くと本文の背面に描かれる。
   レイアウト名の書き換え（配線盤）と同じ技術で、pandoc 本体は差し替えない。 */

function decorFillXml(color, opacity) {
  var alpha = opacity < 100 ? '<a:alpha val="' + Math.round(opacity * 1000) + '"/>' : '';
  if (color && color.scheme) {
    return '<a:solidFill><a:schemeClr val="' + color.scheme + '">' + alpha +
      '</a:schemeClr></a:solidFill>';
  }
  var hex = ((color && color.hex) || '888888').replace('#', '').toUpperCase();
  return '<a:solidFill><a:srgbClr val="' + hex + '">' + alpha + '</a:srgbClr></a:solidFill>';
}

function buildDecorSp(d, cNvPrId) {
  var prst = d.shape === 'roundRect' ? 'roundRect' : 'rect';
  var opacity = d.opacity == null ? 100 : d.opacity;
  return '<p:sp><p:nvSpPr>' +
    '<p:cNvPr id="' + cNvPrId + '" name="MorphoDecor ' + d.id + '"/>' +
    '<p:cNvSpPr/><p:nvPr/></p:nvSpPr>' +
    '<p:spPr><a:xfrm>' +
    '<a:off x="' + Math.round(d.x) + '" y="' + Math.round(d.y) + '"/>' +
    '<a:ext cx="' + Math.round(d.w) + '" cy="' + Math.round(d.h) + '"/>' +
    '</a:xfrm>' +
    '<a:prstGeom prst="' + prst + '"><a:avLst/></a:prstGeom>' +
    decorFillXml(d.color, opacity) +
    '<a:ln><a:noFill/></a:ln>' +
    '</p:spPr>' +
    '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody>' +
    '</p:sp>';
}
window.__morphoBuildDecorSp = buildDecorSp;

/* zip 内の slideN.xml へ装飾を注入して zip を作り直す。
   contentIndex はタイトルスライドを含まない 1 始まり。titleOffset で実スライドへ写す */
function applyDecorations(bytes, decorations, titleOffset) {
  if (!decorations || !decorations.length) return bytes;
  var zip = unzipSync(bytes);
  var dec2 = new TextDecoder();
  var bySlide = {};
  decorations.forEach(function (d) {
    var n = d.contentIndex + titleOffset;
    (bySlide[n] = bySlide[n] || []).push(d);
  });
  Object.keys(bySlide).forEach(function (n) {
    var name = 'ppt/slides/slide' + n + '.xml';
    if (!zip[name]) return; /* スライド数がずれていたら安全側（注入しない） */
    var xml = dec2.decode(zip[name]);
    /* cNvPr id はスライド内で一意。既存の最大値の続きから振る */
    var maxId = 0;
    var idRe = /\\bid="(\\d+)"/g;
    var im;
    while ((im = idRe.exec(xml)) !== null) {
      if (Number(im[1]) > maxId) maxId = Number(im[1]);
    }
    var sps = bySlide[n]
      .map(function (d, i) { return buildDecorSp(d, maxId + 1 + i); })
      .join('');
    var marker = '</p:grpSpPr>';
    var at = xml.indexOf(marker);
    if (at < 0) return;
    at += marker.length;
    zip[name] = strToU8(xml.slice(0, at) + sps + xml.slice(at));
  });
  return zipSync(zip);
}
window.__morphoApplyDecorations = applyDecorations;

async function convert(id, md, opts, format) {
  return serialized(async function () { await doConvert(id, md, opts, format); });
}

/* Web プレビュー用: pandoc の standalone HTML に、日本語フォント指定と
   .notes の非表示（発表者ノートはクラスを残したまま隠す）を注入する。
   pandoc の既定 CSS は <style> で head に入るので、</head> 直前に置けば上書きが効く */
var WEB_CSS = '<style>' +
  'body{font-family:-apple-system,"Hiragino Sans","Hiragino Kaku Gothic ProN",sans-serif;}' +
  '.notes{display:none}' +
  '</style>';
function decorateWebHtml(html) {
  var i = html.indexOf('</head>');
  if (i < 0) return WEB_CSS + html;
  return html.slice(0, i) + WEB_CSS + html.slice(i);
}
window.__morphoDecorateWebHtml = decorateWebHtml;
window.__morphoDropNotesLua = DROP_NOTES_LUA;

async function doConvertWeb(id, md, opts) {
  var options = {
    from: READER,
    to: 'html',
    standalone: true
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

  var html = res.stdout || '';
  if (!html) throw new Error('pandoc produced no html');

  RN({
    id: id,
    type: 'ok',
    result: {
      kind: 'web',
      html: decorateWebHtml(html),
      diagnostics: classify(res.warnings, res.stderr),
      ms: ms,
      bytes: new Blob([html]).size
    }
  });
}

async function doConvert(id, md, opts, format) {
  try {
    if (!pandoc) throw new Error('converter is not ready yet');
    opts = opts || {};
    if (format === 'web') { await doConvertWeb(id, md, opts); return; }
    var options = {
      from: READER,
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
        kind: 'slides',
        slideCount: parsed.slideCount,
        slides: parsed.slides,
        deck: parsed.deck,
        diagnostics: classify(res.warnings, res.stderr),
        ms: ms,
        bytes: buf.length
      }
    });
  } catch (e) {
    RN({ id: id, type: 'error', message: String((e && e.message) || e) });
  }
}

window.__morphoConvert = function (id, md, opts, format) { convert(id, md, opts, format); };

/* 書き出し。プレビューと同じ経路で変換し、出力ファイルを base64 で返す。
   FileReader.readAsDataURL は WKWebView で使える。btoa の 64KB 制限も踏まない */
async function exportFile(id, md, opts, format) {
  return serialized(async function () { await doExport(id, md, opts, format); });
}

async function doExport(id, md, opts, format) {
  try {
    if (!pandoc) throw new Error('converter is not ready yet');
    opts = opts || {};
    var name = 'out.' + format;
    var options = {
      from: READER,
      to: format,
      'output-file': name
    };
    if (opts.metadata && Object.keys(opts.metadata).length) options.metadata = opts.metadata;
    var files = {};
    if (opts.stripHtmlComments) {
      files['strip.lua'] = STRIP_LUA;
      options.filters = ['strip.lua'];
    }
    if (format === 'docx') {
      /* CLAUDE.md 落とし穴 8: notes が無警告のまま本文に混入するため除去する。
         pptx では除去しない（ノート欄に隔離されるのが正しい挙動） */
      files['drop-notes.lua'] = DROP_NOTES_LUA;
      options.filters = (options.filters || []).concat(['drop-notes.lua']);
    }

    var t0 = performance.now();
    var res = await pandoc.convert(options, md, files);
    var ms = Math.round(performance.now() - t0);

    var out = res.files && res.files[name];
    if (!out) throw new Error('pandoc produced no ' + name);

    /* 装飾は pptx にだけ OOXML 後処理で焼き込む */
    if (format === 'pptx' && opts.decorations && opts.decorations.length) {
      var titleOffset = opts.metadata && opts.metadata.title ? 1 : 0;
      var processed = applyDecorations(
        new Uint8Array(await out.arrayBuffer()), opts.decorations, titleOffset);
      out = new Blob([processed]);
    }

    var reader = new FileReader();
    var base64 = await new Promise(function (resolve, reject) {
      reader.onerror = function () { reject(new Error('FileReader failed')); };
      reader.onload = function () {
        /* data:...;base64,XXXX の頭を落とす */
        var s = String(reader.result);
        resolve(s.slice(s.indexOf(',') + 1));
      };
      reader.readAsDataURL(out);
    });

    RN({
      id: id,
      type: 'ok',
      result: {
        base64: base64,
        bytes: out.size,
        ms: ms,
        diagnostics: classify(res.warnings, res.stderr)
      }
    });
  } catch (e) {
    RN({ id: id, type: 'error', message: String((e && e.message) || e) });
  }
}
window.__morphoExport = function (id, md, opts, format) { exportFile(id, md, opts, format); };

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
