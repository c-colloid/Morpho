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

/* 日本語組版: {親文字|よみ} → ルビ、《《文字》》 → 傍点（でんでんマークダウン互換）。
   docx は w:ruby / w:em（本物の組版・XSD 準拠は実測済み）、HTML は <ruby> と
   text-emphasis、pptx にはルビ・傍点の概念が無いため 親文字（よみ）と太字で近似する。
   findings 6: Lua の否定文字クラスはバイト単位で壊れるので遅延量指定子を使う */
var RUBY_LUA = [
  'local function esc(s)',
  "  return s:gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;')",
  'end',
  'local function rubyInline(base, rt)',
  "  if FORMAT == 'docx' then",
  "    return pandoc.RawInline('openxml',",
  '      \\'<w:r><w:ruby><w:rubyPr><w:rubyAlign w:val="distributeSpace" />\\' ..',
  '      \\'<w:hps w:val="12" /><w:hpsRaise w:val="22" /><w:hpsBaseText w:val="24" />\\' ..',
  '      \\'<w:lid w:val="ja-JP" /></w:rubyPr>\\' ..',
  '      \\'<w:rt><w:r><w:rPr><w:sz w:val="12" /></w:rPr><w:t>\\' .. esc(rt) .. \\'</w:t></w:r></w:rt>\\' ..',
  '      \\'<w:rubyBase><w:r><w:t>\\' .. esc(base) .. \\'</w:t></w:r></w:rubyBase>\\' ..',
  "      '</w:ruby></w:r>')",
  "  elseif FORMAT == 'html' or FORMAT == 'html5' or FORMAT:find('^epub') then",
  "    return pandoc.RawInline('html', '<ruby>' .. esc(base) .. '<rt>' .. esc(rt) .. '</rt></ruby>')",
  '  end',
  "  return pandoc.Str(base .. '（' .. rt .. '）')",
  'end',
  'local function botenInline(text)',
  "  if FORMAT == 'docx' then",
  "    return pandoc.RawInline('openxml',",
  '      \\'<w:r><w:rPr><w:em w:val="dot" /></w:rPr><w:t xml:space="preserve">\\' .. esc(text) .. \\'</w:t></w:r>\\')',
  "  elseif FORMAT == 'html' or FORMAT == 'html5' or FORMAT:find('^epub') then",
  "    return pandoc.RawInline('html',",
  '      \\'<span style="text-emphasis:filled dot;-webkit-text-emphasis:filled dot;">\\' .. esc(text) .. \\'</span>\\')',
  '  end',
  '  return pandoc.Strong({ pandoc.Str(text) })',
  'end',
  'function Str(el)',
  '  local s = el.text',
  "  if not (s:find('{', 1, true) or s:find('《《', 1, true)) then return nil end",
  '  local out = {}',
  '  local pos = 1',
  '  local changed = false',
  '  while pos <= #s do',
  "    -- 波かっこ1組の中だけで照合する（手前の literal な { に食い込まない）",
  "    local rs, re, base, rt = s:find('{([^{}|]-)|([^{}|]-)}', pos)",
  "    local bs, be, btext = s:find('《《(.-)》》', pos)",
  "    if rs and (not bs or rs <= bs) and base ~= '' and rt ~= '' then",
  '      if rs > pos then table.insert(out, pandoc.Str(s:sub(pos, rs - 1))) end',
  '      table.insert(out, rubyInline(base, rt))',
  '      pos = re + 1',
  '      changed = true',
  "    elseif bs and btext ~= '' then",
  '      if bs > pos then table.insert(out, pandoc.Str(s:sub(pos, bs - 1))) end',
  '      table.insert(out, botenInline(btext))',
  '      pos = be + 1',
  '      changed = true',
  '    else',
  '      table.insert(out, pandoc.Str(s:sub(pos)))',
  '      break',
  '    end',
  '  end',
  '  if not changed then return nil end',
  '  return out',
  'end',
  ''
].join('\\n');
window.__morphoRubyLua = RUBY_LUA;

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
    /* ラン単位の文字色（pandoc はコードの構文色を srgbClr で出す。実測） */
    var clr = /<a:solidFill>\\s*<a:srgbClr\\s+val="([0-9A-Fa-f]{6})"/.exec(r);
    if (clr) run.color = '#' + clr[1].toUpperCase();
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
    var algn = null;
    var pPr = /<a:pPr\\b([^>]*)/.exec(body);
    if (pPr) {
      var lvl = /\\blvl="(\\d+)"/.exec(pPr[1]);
      if (lvl) level = Number(lvl[1]);
      var ml = /\\bmarL="(-?\\d+)"/.exec(pPr[1]);
      if (ml) marL = Number(ml[1]);
      var ind = /\\bindent="(-?\\d+)"/.exec(pPr[1]);
      if (ind) indent = Number(ind[1]);
      var al = /\\balgn="(\\w+)"/.exec(pPr[1]);
      if (al) algn = al[1];
    }
    /* pandoc は箇条書きでない段落に buNone を明示する。
       箇条書きは何も書かずレイアウトの既定（行頭記号）に任せるので、
       「buNone が無い＝箇条書き」で判定する。 */
    var bullet = 'bullet';
    if (/<a:buNone\\s*\\/>/.test(body)) bullet = 'none';
    else if (/<a:buAutoNum\\b/.test(body)) bullet = 'number';
    var runs = parseRuns(body);
    if (runs.length) out.push({ runs: runs, level: level, bullet: bullet, marL: marL, indent: indent, algn: algn });
  }
  return out;
}

/* スライド上の画像（p:pic）。name は取り込み時の元ファイル名
   （cNvPr descr に残る。実測）。プレビューはこれでアセット保存庫の
   ファイルを直接描く — シーンに画像バイナリを載せない */
function parsePics(slideXml) {
  var out = [];
  var re = /<p:pic>[\\s\\S]*?<\\/p:pic>/g;
  var m;
  while ((m = re.exec(slideXml)) !== null) {
    var pic = m[0];
    var d = /<p:cNvPr [^>]*descr="([^"]*)"/.exec(pic);
    var off = /<a:off x="(-?\\d+)" y="(-?\\d+)"/.exec(pic);
    var ext = /<a:ext cx="(\\d+)" cy="(\\d+)"/.exec(pic);
    if (!d || !off || !ext) continue;
    out.push({
      name: decodeXml(d[1]),
      x: Number(off[1]),
      y: Number(off[2]),
      w: Number(ext[1]),
      h: Number(ext[2])
    });
  }
  return out;
}

/* 表（p:graphicFrame の a:tbl）。枠は自前の <p:xfrm> に必ず入っていて
   プレースホルダ継承は要らない（実測。reference-doc を与えた場合も
   レイアウト枠を解決した絶対値がスライドへ書かれる）。
   v0.14 は枠と行数・列幅だけ。セルの中身は後の版 */
function parseTables(slideXml) {
  var out = [];
  var re = /<p:graphicFrame\\b[^>]*>([\\s\\S]*?)<\\/p:graphicFrame>/g;
  var m;
  while ((m = re.exec(slideXml)) !== null) {
    var gf = m[1];
    /* 表以外の graphicFrame（グラフ・OLE・図表）は落とす */
    if (!/<a:tbl\\b/.test(gf)) continue;
    var xf = /<p:xfrm\\b[^>]*>([\\s\\S]*?)<\\/p:xfrm>/.exec(gf);
    var frame = xf ? parseXfrm(xf[1]) : null;
    if (!frame) continue;
    var cols = [];
    var cre = /<a:gridCol\\b[^>]*\\sw="(\\d+)"/g;
    var cm;
    while ((cm = cre.exec(gf)) !== null) cols.push(Number(cm[1]));
    out.push({
      x: frame.x,
      y: frame.y,
      w: frame.w,
      h: frame.h,
      rowCount: (gf.match(/<a:tr\\b/g) || []).length,
      colWidths: cols
    });
  }
  return out;
}
/* パーサだけ検査できるように外へ出す（scripts/check-scene.mjs が使う） */
window.__morphoParseTables = parseTables;
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
    /* 垂直アンカー。無ければ null（レイアウト → マスターから継承する） */
    var anchor = null;
    var bp = /<a:bodyPr\\b([^>]*)/.exec(sp);
    if (bp) {
      var an = /\\banchor="(\\w+)"/.exec(bp[1]);
      if (an) anchor = an[1];
    }
    shapes.push({
      placeholder: placeholder,
      phIdx: phIdx,
      frame: parseXfrm(sp),
      anchor: anchor,
      lvlStyle: parseLvlStyle(sp),
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

/* <a:lstStyle> の lvl1..lvl9 を読む。プレースホルダ固有の既定は
   スライド自身 → レイアウト の順に上書きされる（マスターは DeckInfo が持つ）。
   ここが読めていないと Two Content の本文を 2400 で描いて実際は 2100、
   Content with Caption のタイトルを 3300 で描いて実際は 1500 になる（実測）。
   何も拾えないレイアウト（Title and Content 等）では null を返し、
   DeckInfo の既定へそのまま落とす。階層ごと・プロパティごとの疎な配列なので、
   sz だけ持つ階層は marL を DeckInfo から継ぐ。
   正規表現の後方参照はソースに二重バックスラッシュで書くこと
   （単一だと八進エスケープ扱いでテンプレートリテラルが構文エラーになる。
   applyTextSizes の lvlNpPr 置換と同じ作法） */
function parseLvlStyle(spXml) {
  var lst = /<a:lstStyle>([\\s\\S]*?)<\\/a:lstStyle>/.exec(spXml);
  if (!lst) return null;
  var out = null;
  /* 対と自己閉じの両方を拾う（PowerPoint 製の reference-doc は
     <a:lvl1pPr marL="0" indent="0"/> のように自己閉じで書くことがある） */
  var re = /<a:lvl(\\d)pPr\\b([^>]*?)(\\/>|>([\\s\\S]*?)<\\/a:lvl\\1pPr>)/g;
  var m;
  while ((m = re.exec(lst[1])) !== null) {
    var i = Number(m[1]) - 1;
    if (i < 0 || i > 8) continue;
    var attrs = m[2];
    var body = m[4] || '';
    var ent = null;
    var sz = /<a:defRPr[^>]*\\bsz="(\\d+)"/.exec(body);
    if (sz) { ent = ent || {}; ent.sz = Number(sz[1]); }
    var ml = /\\bmarL="(-?\\d+)"/.exec(attrs);
    if (ml) { ent = ent || {}; ent.marL = Number(ml[1]); }
    var ind = /\\bindent="(-?\\d+)"/.exec(attrs);
    if (ind) { ent = ent || {}; ent.indent = Number(ind[1]); }
    var al = /\\balgn="(\\w+)"/.exec(attrs);
    if (al) { ent = ent || {}; ent.algn = al[1]; }
    if (/<a:buNone(\\s*\\/>|>[\\s\\S]*?<\\/a:buNone>)/.test(body)) { ent = ent || {}; ent.bullet = 'none'; }
    if (ent) { out = out || []; out[i] = ent; }
  }
  return out;
}
window.__morphoParseLvlStyle = parseLvlStyle;

/* 二つの階層既定を重ねる（over が勝つ）。両方 null なら null */
function mergeLvlStyle(base, over) {
  if (!base) return over || null;
  if (!over) return base;
  var out = [];
  for (var i = 0; i < 9; i++) {
    var b = base[i], o = over[i];
    if (!b && !o) continue;
    var e = {};
    if (b) for (var k in b) e[k] = b[k];
    if (o) for (var k2 in o) e[k2] = o[k2];
    out[i] = e;
  }
  return out.length ? out : null;
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
    var anchor = null;
    var bp = /<a:bodyPr\\b([^>]*)/.exec(m[1]);
    if (bp) {
      var an = /\\banchor="(\\w+)"/.exec(bp[1]);
      if (an) anchor = an[1];
    }
    out.push({
      type: type ? type[1] : null,
      idx: idx ? Number(idx[1]) : null,
      frame: parseXfrm(m[1]),
      anchor: anchor,
      lvlStyle: parseLvlStyle(m[1])
    });
  }
  return out;
}
window.__morphoParsePlaceholderFrames = parsePlaceholderFrames;

/* 日付・フッタ・スライド番号・ヘッダ・ノートのスライド画像。
   本文ではないので「レイアウト内では」body へ落とさない
   （落とすと Comparison の左見出し枠を拾う）。配列で持つのは
   オブジェクトだと type="constructor" 等がプロトタイプ由来で真になるため */
var PH_FURNITURE = ['dt', 'ftr', 'sldNum', 'hdr', 'sldImg'];
function isFurniture(t) { return PH_FURNITURE.indexOf(t) >= 0; }

/* プレースホルダの継承照合。
   スライドの <p:ph idx> が指すのは「そのスライドのレイアウト」の枠なので、
   idx はレイアウト内でだけ意味を持つ（same=true）。マスターは idx の名前空間が
   別物（実測: レイアウトの dt は idx=10 / マスターの dt は idx=2）なので
   type だけで照合する。ctrTitle（Title Slide）はレイアウトにしか無いので
   マスターへ落ちるときだけ title に読み替える。
   key（frame / anchor / lvlStyle）が入っている要素だけを答えにするが、
   「枠はあるが値が無い」場合は type 照合へ流さず素通しして次の階層へ渡す */
function findInherited(phList, type, idx, key, same) {
  var wants = type === 'ctrTitle' ? ['ctrTitle', 'title'] : [type];
  var want = wants[wants.length - 1];
  /* 1. idx 優先。レイアウト内に閉じる */
  if (same && idx !== null) {
    var seen = false;
    for (var i = 0; i < phList.length; i++) {
      if (phList[i].idx !== idx) continue;
      seen = true;
      if (phList[i][key]) return phList[i][key];
    }
    /* その idx の枠は在るが値を持たない → 兄弟の枠ではなく上位階層へ */
    if (seen) return null;
  }
  /* 2. type 照合 */
  for (var w = 0; w < wants.length; w++) {
    for (var j = 0; j < phList.length; j++) {
      if (phList[j][key] && phList[j].type === wants[w]) return phList[j][key];
    }
  }
  /* 3. subTitle 等の本文系は body に落とす。レイアウト照合のときだけ
     日付・フッタ等の装飾枠を除く（マスターでも除くと、日付枠を持たない
     テンプレートで frame が null になり図形がプレビューから消える。実測） */
  if (want !== 'title' && !(same && isFurniture(want))) {
    for (var k = 0; k < phList.length; k++) {
      if (phList[k][key] && phList[k].type === 'body') return phList[k][key];
    }
  }
  /* 4. 最後の手段の idx 照合。type を書かないマスター（<p:ph idx="1"/>）向けの保険。
     pandoc 既定テンプレートでは一度も通らない（実測）。
     日付・フッタ等の装飾枠は除く — これを許すとマスターの idx=2（日付枠）を拾う */
  if (idx !== null && !isFurniture(want)) {
    for (var m = 0; m < phList.length; m++) {
      if (phList[m][key] && phList[m].idx === idx && !isFurniture(phList[m].type)) {
        return phList[m][key];
      }
    }
  }
  return null;
}
function findFrame(phList, type, idx, same) { return findInherited(phList, type, idx, 'frame', same); }
function findAnchor(phList, type, idx, same) { return findInherited(phList, type, idx, 'anchor', same); }
window.__morphoFindFrame = findFrame;
window.__morphoFindAnchor = findAnchor;

/* デッキ情報: 寸法・配色・既定の文字サイズ */
function parseDeck(zip, dec) {
  var deck = { w: 9144000, h: 5143500, colors: {}, ftrBand: null, titleSz: 3300, bodySz: [2400, 2100, 1800, 1500, 1500], bodyMarL: [], bodyIndent: [], titleAlgn: null, bodyAlgn: [], bodySpcBef: [], bodySpcBefPts: [], bodyBuChar: [] };
  /* 既定はマスターの実測値: marL=342900*(n+1), indent=-342900（27pt 刻みのぶら下げ） */
  for (var di = 0; di < 9; di++) {
    deck.bodyMarL.push(342900 * (di + 1));
    deck.bodyIndent.push(-342900);
    deck.bodyAlgn.push(null);
    /* spcBef は spcPct の 1/1000 %（20000 = 20%）。OOXML 既定は 0 */
    deck.bodySpcBef.push(0);
    /* 絶対値指定（spcPts、1/100 pt）の場合はこちらに入る */
    deck.bodySpcBefPts.push(0);
    /* 行頭記号はマスターの buChar（pandoc 既定は • – • – … の交互） */
    deck.bodyBuChar.push(null);
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
      /* pandoc 既定マスターのタイトルは algn="ctr"（実測） */
      var tal = /<a:lvl1pPr[^>]*\\balgn="(\\w+)"/.exec(ts[0]);
      if (tal) deck.titleAlgn = tal[1];
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
        var al2 = /\\balgn="(\\w+)"/.exec(pm[2]);
        if (al2) deck.bodyAlgn[lv] = al2[1];
      }
      /* 段落前間隔。pandoc 既定は spcPct（行高の %）だが、PowerPoint 製の
         reference-doc は spcPts（1/100 pt の絶対値）で書くことがあるので両対応 */
      var bre = /<a:lvl(\\d)pPr[^>]*>([\\s\\S]*?)<\\/a:lvl\\1pPr>/g;
      var bm;
      while ((bm = bre.exec(bs[0])) !== null) {
        var blv = Number(bm[1]) - 1;
        var sp2 = /<a:spcBef>\\s*<a:spcPct\\s+val="(\\d+)"/.exec(bm[2]);
        if (sp2) deck.bodySpcBef[blv] = Number(sp2[1]);
        var sp3 = /<a:spcBef>\\s*<a:spcPts\\s+val="(\\d+)"/.exec(bm[2]);
        if (sp3) deck.bodySpcBefPts[blv] = Number(sp3[1]);
        var bu = /<a:buChar\\s+char="([^"]*)"/.exec(bm[2]);
        if (bu) deck.bodyBuChar[blv] = decodeXml(bu[1]);
      }
    }
    deck.masterPh = parsePlaceholderFrames(master);
    /* テンプレートが「フッターを置く場所」として持つ帯。pandoc 既定はマスターだけが
       座標を持ち、11 レイアウトの ftr は空の <p:spPr/>（実測）。レイアウト側に
       座標を持つテンプレートも実在するので、見つからなければそちらも見る。
       どこにも無ければ null のままにして、アプリ側の比率の既定値へ落とす */
    deck.ftrBand = findFtrBand(deck.masterPh);
    if (!deck.ftrBand) {
      var layoutNames = Object.keys(zip).filter(function (n) {
        return /^ppt\\/slideLayouts\\/slideLayout\\d+\\.xml$/.test(n);
      });
      for (var fi = 0; fi < layoutNames.length && !deck.ftrBand; fi++) {
        deck.ftrBand = findFtrBand(parsePlaceholderFrames(dec.decode(zip[layoutNames[fi]])));
      }
    }
  } catch (e) { deck.masterPh = []; }
  return deck;
}

function findFtrBand(phList) {
  for (var i = 0; i < (phList || []).length; i++) {
    if (phList[i].type === 'ftr' && phList[i].frame) return phList[i].frame;
  }
  return null;
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
    var xml = dec.decode(zip[n]);
    var shapes = parseShapes(xml);
    var layoutPh = layoutPhOf(n);
    for (var si = 0; si < shapes.length; si++) {
      var sh = shapes[si];
      if (!sh.frame) {
        /* 自前の座標が無ければ レイアウト → マスター の順で継承（実測どおり） */
        sh.frame =
          findFrame(layoutPh, sh.placeholder, sh.phIdx, true) ||
          findFrame(deck.masterPh, sh.placeholder, sh.phIdx, false);
      }
      /* プレースホルダ固有の階層既定: レイアウト → スライド自身の順に重ねる。
         マスターは DeckInfo（titleSz / bodySz / bodyMarL …）が持つので
         ここでは混ぜず、null のまま UI 側の既定へ落とす。
         第 5 引数 true は「この phList はスライドの idx と同じ名前空間」の宣言で、
         frame / anchor と同じ照合器に乗る（A-1/A-2 の修正がそのまま効く） */
      sh.lvlStyle = mergeLvlStyle(
        sh.placeholder
          ? findInherited(layoutPh, sh.placeholder, sh.phIdx, 'lvlStyle', true)
          : null,
        sh.lvlStyle);
      if (sh.lvlStyle) {
        /* この図形が実際に使う階層までで切る（シーンは postMessage で
           RN へ渡るので、使わない 9 階層ぶんを毎回運ばない） */
        var mx = 0;
        for (var pi = 0; pi < sh.paragraphs.length; pi++) {
          if (sh.paragraphs[pi].level > mx) mx = sh.paragraphs[pi].level;
        }
        sh.lvlStyle = sh.lvlStyle.slice(0, Math.min(mx, 8) + 1);
        var any = false;
        for (var qi = 0; qi < sh.lvlStyle.length; qi++) if (sh.lvlStyle[qi]) any = true;
        if (!any) sh.lvlStyle = null;
      }
      if (!sh.anchor) {
        /* 垂直アンカーも同じ継承。pandoc 既定ではタイトルがマスターの
           anchor="ctr" を継承する（実測） */
        sh.anchor =
          findAnchor(layoutPh, sh.placeholder, sh.phIdx, true) ||
          findAnchor(deck.masterPh, sh.placeholder, sh.phIdx, false);
      }
    }
    return {
      index: i + 1,
      layout: layoutName(n),
      shapes: shapes,
      images: parsePics(xml),
      tables: parseTables(xml),
      notes: notesFor(n)
    };
  });

  return {
    slideCount: slides.length,
    slides: slides,
    deck: { w: deck.w, h: deck.h, colors: deck.colors, ftrBand: deck.ftrBand, titleSz: deck.titleSz, bodySz: deck.bodySz, bodyMarL: deck.bodyMarL, bodyIndent: deck.bodyIndent, titleAlgn: deck.titleAlgn, bodyAlgn: deck.bodyAlgn, bodySpcBef: deck.bodySpcBef, bodySpcBefPts: deck.bodySpcBefPts, bodyBuChar: deck.bodyBuChar }
  };
}
window.__morphoParsePptx = parsePptx;

function warnText(w) {
  if (typeof w === 'string') return w;
  return (w && (w.message || w.msg)) || JSON.stringify(w);
}

/* extra は Morpho 自身が原稿から出した診断（段組みなど）。
   pandoc は段組みの失敗にほとんど警告を出さない（62 通り中 32 通りが完全に無警告。
   notes/column-input.md）ので、変換器の警告分類だけに頼っていては永久に届かない */
function classify(warnings, stderr, extra) {
  var all = (warnings || []).map(warnText);
  if (stderr) {
    stderr.split(/\\r?\\n/).forEach(function (l) { if (l.trim()) all.push(l); });
  }
  var buckets = [];
  var byLabel = {};
  (extra || []).forEach(function (d) {
    if (byLabel[d.label]) { byLabel[d.label].count += 1; return; }
    byLabel[d.label] = d;
    buckets.push(d);
  });
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

function escapeXmlText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* DecorationShape は OOXML の presetGeometry 名と一致させている（types.ts） */
var DECOR_PRSTS = ['rect', 'roundRect', 'ellipse', 'triangle', 'diamond', 'hexagon', 'star5', 'rightArrow'];

function buildDecorSp(d, cNvPrId) {
  var prst = DECOR_PRSTS.indexOf(d.shape) >= 0 ? d.shape : 'rect';
  var opacity = d.opacity == null ? 100 : d.opacity;
  var fill = d.noFill ? '<a:noFill/>' : decorFillXml(d.color, opacity);
  var ln = d.line && d.line.widthPt > 0
    ? '<a:ln w="' + Math.round(d.line.widthPt * 12700) + '">' +
      decorFillXml(d.line.color, 100) + '</a:ln>'
    : '<a:ln><a:noFill/></a:ln>';
  var txBody;
  if (d.text != null && d.text !== '') {
    /* 番号バッジ等。白・太字・中央揃えで、字サイズは図形高さの 45%
       （sz は 1/100 pt 単位。プレビュー SlideSurface と同じ比率） */
    var sz = Math.max(600, Math.round((d.h / 12700) * 0.45 * 100));
    txBody = '<p:txBody>' +
      /* wrap="none": 折り返しを止め、プレビュー（1行表示）と一致させる。
         anchorCtr="1": 行の箱ごとテキスト矩形の水平中央へ */
      '<a:bodyPr wrap="none" anchor="ctr" anchorCtr="1" lIns="0" tIns="0" rIns="0" bIns="0"/><a:lstStyle/>' +
      '<a:p><a:pPr algn="ctr"/>' +
      '<a:r><a:rPr lang="ja-JP" sz="' + sz + '" b="1">' +
      '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>' +
      '</a:rPr><a:t>' + escapeXmlText(d.text) + '</a:t></a:r>' +
      '</a:p></p:txBody>';
  } else {
    txBody = '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody>';
  }
  return '<p:sp><p:nvSpPr>' +
    '<p:cNvPr id="' + cNvPrId + '" name="MorphoDecor ' + d.id + '"/>' +
    '<p:cNvSpPr/><p:nvPr/></p:nvSpPr>' +
    '<p:spPr><a:xfrm>' +
    '<a:off x="' + Math.round(d.x) + '" y="' + Math.round(d.y) + '"/>' +
    '<a:ext cx="' + Math.round(d.w) + '" cy="' + Math.round(d.h) + '"/>' +
    '</a:xfrm>' +
    '<a:prstGeom prst="' + prst + '"><a:avLst/></a:prstGeom>' +
    fill +
    ln +
    '</p:spPr>' +
    txBody +
    '</p:sp>';
}
window.__morphoBuildDecorSp = buildDecorSp;

/* グループの p:grpSp を組み立てる。子座標系（chOff/chExt）を外形と同一に
   すると、子の座標をスライド絶対値のまま使える */
function buildGroupSp(group, ds, firstId) {
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  ds.forEach(function (d) {
    minX = Math.min(minX, d.x); minY = Math.min(minY, d.y);
    maxX = Math.max(maxX, d.x + d.w); maxY = Math.max(maxY, d.y + d.h);
  });
  var children = ds.map(function (d, i) { return buildDecorSp(d, firstId + 1 + i); }).join('');
  return '<p:grpSp><p:nvGrpSpPr>' +
    '<p:cNvPr id="' + firstId + '" name="MorphoGroup ' + group.id + '"/>' +
    '<p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm>' +
    '<a:off x="' + Math.round(minX) + '" y="' + Math.round(minY) + '"/>' +
    '<a:ext cx="' + Math.round(maxX - minX) + '" cy="' + Math.round(maxY - minY) + '"/>' +
    '<a:chOff x="' + Math.round(minX) + '" y="' + Math.round(minY) + '"/>' +
    '<a:chExt cx="' + Math.round(maxX - minX) + '" cy="' + Math.round(maxY - minY) + '"/>' +
    '</a:xfrm></p:grpSpPr>' +
    children + '</p:grpSp>';
}

/* zip 内の slideN.xml へ装飾を注入して zip を作り直す。
   contentIndex はタイトルスライドを含まない 1 始まり。titleOffset で実スライドへ写す。
   groups のメンバーは p:grpSp に包む（z 順は先頭メンバーの位置） */
function applyDecorations(bytes, decorations, titleOffset, groups) {
  if (!decorations || !decorations.length) return bytes;
  var zip = unzipSync(bytes);
  var dec2 = new TextDecoder();
  var bySlide = {};
  decorations.forEach(function (d) {
    var n = d.contentIndex + titleOffset;
    (bySlide[n] = bySlide[n] || []).push(d);
  });
  var groupOf = {};
  (groups || []).forEach(function (g) {
    g.memberIds.forEach(function (m) { groupOf[m] = g; });
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
    /* グループのメンバーは先頭メンバーの位置でまとめて grpSp に包む */
    var units = [];
    var unitByGroup = {};
    bySlide[n].forEach(function (d) {
      var g = groupOf[d.id];
      if (!g) { units.push({ ds: [d], group: null }); return; }
      if (unitByGroup[g.id]) { unitByGroup[g.id].ds.push(d); return; }
      var u = { ds: [d], group: g };
      unitByGroup[g.id] = u;
      units.push(u);
    });
    var nextId = maxId + 1;
    var sps = units.map(function (u) {
      if (u.group && u.ds.length >= 2) {
        var x = buildGroupSp(u.group, u.ds, nextId);
        nextId += 1 + u.ds.length;
        return x;
      }
      return u.ds.map(function (d) { return buildDecorSp(d, nextId++); }).join('');
    }).join('');
    var marker = '</p:grpSpPr>';
    var at = xml.indexOf(marker);
    if (at < 0) return;
    at += marker.length;
    zip[name] = strToU8(xml.slice(0, at) + sps + xml.slice(at));
  });
  return zipSync(zip);
}
window.__morphoApplyDecorations = applyDecorations;

/* ---- フッター（出典・注釈）の OOXML 後処理（notes/footer-design.md） ----
   ftr プレースホルダには載せない。座標を持たないテンプレートでは parsePptx の
   継承解決が本文の枠へ落ちてフッターが本文全面に化けるため（実測・警告ゼロ）。
   座標を明示したただのテキストボックスを spTree の末尾（＝最前面）へ入れる。
   座標・字サイズ・揃え・色はアプリ側（src/design/footer.ts）で解決済みの値を
   そのまま書く — プレビューと書き出しが同じ 1 つの関数から導かれる。 */

function footerColorXml(color) {
  var tint = color && color.tint != null && color.tint < 100000
    ? '<a:tint val="' + Math.round(color.tint) + '"/>'
    : '';
  if (color && color.scheme) {
    return '<a:solidFill><a:schemeClr val="' + color.scheme + '">' + tint +
      '</a:schemeClr></a:solidFill>';
  }
  var hex = ((color && color.hex) || '7F7F7F').replace('#', '').toUpperCase();
  return '<a:solidFill><a:srgbClr val="' + hex + '">' + tint + '</a:srgbClr></a:solidFill>';
}

/* ECMA-376 の子要素順は nvSpPr(cNvPr → cNvSpPr → nvPr) → spPr → txBody。
   順を崩すと Open XML SDK の検証が鳴る（較正で確認済み）。
   <a:buNone/> を省くとパーサが「箇条書き」と読んで行頭記号を描く（実測） */
function buildFooterSp(f, cNvPrId) {
  return '<p:sp><p:nvSpPr>' +
    '<p:cNvPr id="' + cNvPrId + '" name="MorphoFooter"/>' +
    '<p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>' +
    '<p:spPr><a:xfrm>' +
    '<a:off x="' + Math.round(f.x) + '" y="' + Math.round(f.y) + '"/>' +
    '<a:ext cx="' + Math.round(f.w) + '" cy="' + Math.round(f.h) + '"/>' +
    '</a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>' +
    '<p:txBody><a:bodyPr anchor="ctr" wrap="square"/><a:lstStyle/>' +
    '<a:p><a:pPr marL="0" indent="0" algn="' + (f.algn || 'r') + '"><a:buNone/></a:pPr>' +
    '<a:r><a:rPr lang="ja-JP" sz="' + Math.round(f.sz) + '">' + footerColorXml(f.color) +
    '</a:rPr><a:t>' + escapeXmlText(f.text) + '</a:t></a:r>' +
    '</a:p></p:txBody></p:sp>';
}
window.__morphoBuildFooterSp = buildFooterSp;

function applyFooters(bytes, footer) {
  if (!footer || !footer.text) return bytes;
  var zip = unzipSync(bytes);
  var dec2 = new TextDecoder();
  var names = Object.keys(zip).filter(function (n) {
    return /^ppt\\/slides\\/slide\\d+\\.xml$/.test(n);
  });
  names.forEach(function (name) {
    var xml = dec2.decode(zip[name]);
    /* 表紙は ctrTitle の有無で判定する。レイアウト名は配線盤（applyAssignments）が
       書き換えるので名前では判定できない */
    if (!footer.onCover && xml.indexOf('type="ctrTitle"') >= 0) return;
    /* 二重注入の防止。同じ sp が 2 つ並んでも検証器は 0 件で通す（実測）ので、
       冪等性は注入側で担保するしかない */
    if (xml.indexOf('name="MorphoFooter"') >= 0) return;
    var at = xml.indexOf('</p:spTree>');
    if (at < 0) return;
    var maxId = 0;
    var idRe = /\\bid="(\\d+)"/g;
    var im;
    while ((im = idRe.exec(xml)) !== null) {
      if (Number(im[1]) > maxId) maxId = Number(im[1]);
    }
    zip[name] = strToU8(xml.slice(0, at) + buildFooterSp(footer, maxId + 1) + xml.slice(at));
  });
  return zipSync(zip);
}
window.__morphoApplyFooters = applyFooters;

/* 文字サイズの上書き（文書の設定）。
   titleSz / bodySz はマスターの titleStyle / bodyStyle の defRPr sz を書き換える
   （スライド側は sz を持たず継承する。実測）。coverTitleSz は表紙スライドの
   ctrTitle 図形の空 lstStyle にサイズ入り lvl1pPr を注入する（ctrTitle は
   titleStyle を継承するため、見出しと独立に変えるにはここしかない。実測） */
function applyTextSizes(bytes, sizes) {
  if (!sizes || (sizes.titleSz == null && sizes.coverTitleSz == null && sizes.coverSubSz == null && !sizes.bodySz)) {
    return bytes;
  }
  var zip = unzipSync(bytes);
  var dec2 = new TextDecoder();
  var masterName = Object.keys(zip).filter(function (n) {
    return /^ppt\\/slideMasters\\/slideMaster\\d+\\.xml$/.test(n);
  })[0];
  if (masterName && (sizes.titleSz != null || sizes.bodySz)) {
    var xml = dec2.decode(zip[masterName]);
    if (sizes.titleSz != null) {
      /* 置換は必ずブロック内に限定する（sz を持たないテンプレートで
         隣のスタイルへ食い込まないように）。sz が無ければ何もしない */
      var tsB = /<p:titleStyle>[\\s\\S]*?<\\/p:titleStyle>/.exec(xml);
      if (tsB) {
        var tBlock = tsB[0].replace(/(<a:defRPr[^>]*\\bsz=")\\d+/, '$1' + Math.round(sizes.titleSz));
        xml = xml.slice(0, tsB.index) + tBlock + xml.slice(tsB.index + tsB[0].length);
      }
    }
    if (sizes.bodySz) {
      var bs = /<p:bodyStyle>[\\s\\S]*?<\\/p:bodyStyle>/.exec(xml);
      if (bs) {
        /* 各 lvlNpPr ブロックの中でだけ sz を書き換える */
        var block = bs[0].replace(
          /<a:lvl(\\d)pPr[\\s\\S]*?<\\/a:lvl\\1pPr>/g,
          function (lvlBlock, num) {
            var v = sizes.bodySz[Number(num) - 1];
            if (v == null) return lvlBlock;
            return lvlBlock.replace(/(<a:defRPr[^>]*\\bsz=")\\d+/, '$1' + Math.round(v));
          },
        );
        xml = xml.slice(0, bs.index) + block + xml.slice(bs.index + bs[0].length);
      }
    }
    zip[masterName] = strToU8(xml);
  }
  if (sizes.coverTitleSz != null || sizes.coverSubSz != null) {
    var lstOf = function (sz) {
      return '<a:lstStyle><a:lvl1pPr><a:defRPr sz="' + Math.round(sz) + '"/></a:lvl1pPr></a:lstStyle>';
    };
    Object.keys(zip).forEach(function (n) {
      if (!/^ppt\\/slides\\/slide\\d+\\.xml$/.test(n)) return;
      var sx = dec2.decode(zip[n]);
      if (sx.indexOf('type="ctrTitle"') < 0) return;
      var out = sx.replace(/<p:sp>[\\s\\S]*?<\\/p:sp>/g, function (sp) {
        if (sizes.coverTitleSz != null && sp.indexOf('type="ctrTitle"') >= 0) {
          return sp.replace(/<a:lstStyle\\s*\\/>/, lstOf(sizes.coverTitleSz));
        }
        /* サブタイトル（著者・日付も subTitle の段落）。サイズはマスターの
           bodyStyle を継承しているため、独立に変えるにはここへ注入する（実測） */
        if (sizes.coverSubSz != null && sp.indexOf('type="subTitle"') >= 0) {
          return sp.replace(/<a:lstStyle\\s*\\/>/, lstOf(sizes.coverSubSz));
        }
        return sp;
      });
      zip[n] = strToU8(out);
    });
  }
  return zipSync(zip);
}
window.__morphoApplyTextSizes = applyTextSizes;

async function convert(id, md, opts, format) {
  return serialized(async function () { await doConvert(id, md, opts, format); });
}

/* Web プレビュー用: pandoc の standalone HTML に、日本語フォント指定と
   .notes の非表示（発表者ノートはクラスを残したまま隠す）を注入する。
   pandoc の既定 CSS は <style> で head に入るので、</head> 直前に置けば上書きが効く */
var WEB_CSS = '<style>' +
  'body{font-family:-apple-system,"Hiragino Sans","Hiragino Kaku Gothic ProN",sans-serif;}' +
  '.notes{display:none}' +
  /* フッター（出典・注釈）。pandoc 既定 CSS に .footer 規則は無い（実測）ので衝突しない */
  '.footer{font-size:.8em;color:#595959}' +
  '.morpho-deck-footer{margin-top:2em;padding-top:.5em;border-top:1px solid #D9DCE2}' +
  '</style>';
function escapeHtmlText(s) {
  return escapeXmlText(s).replace(/"/g, '&quot;');
}
/* デッキ全体のフッターは本文末尾に 1 回だけ（0.16.4・notes/footer-design.md 実測 6）。
   HTML は「1 枚ごとに同じ出典を刷る」媒体ではない。metadata 経由は HTML エスケープされ、
   Lua で末尾に足す案は section-divs 下で最後の section に閉じ込められるため、後処理で置く */
function deckFooterHtml(f) {
  if (!f || !f.text) return '';
  var align = f.algn === 'l' ? 'left' : f.algn === 'ctr' ? 'center' : 'right';
  var size = f.sizePt ? ';font-size:' + (Math.round(f.sizePt * 100) / 100) + 'pt' : '';
  return '<div class="footer morpho-deck-footer" style="text-align:' + align + size + '">' +
    escapeHtmlText(f.text) + '</div>';
}
function decorateWebHtml(html, docFooter) {
  var i = html.indexOf('</head>');
  var out = i < 0 ? WEB_CSS + html : html.slice(0, i) + WEB_CSS + html.slice(i);
  var f = deckFooterHtml(docFooter);
  if (f) {
    var j = out.lastIndexOf('</body>');
    out = j < 0 ? out + f : out.slice(0, j) + f + out.slice(j);
  }
  return out;
}
window.__morphoDecorateWebHtml = decorateWebHtml;
window.__morphoDropNotesLua = DROP_NOTES_LUA;

async function doConvertWeb(id, md, opts) {
  /* 内容層の記法を pandoc の語彙へ実現する（原稿は書き換えない） */
  var col = expandColumns(md);
  md = col.md;
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
  wireRuby(options, files);
  wireAssets(options, files, true, md);

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
      html: decorateWebHtml(html, opts.docFooter),
      diagnostics: classify(res.warnings, res.stderr, col.diags),
      ms: ms,
      bytes: new Blob([html]).size
    }
  });
}

/* ---------- 文書（docx）プレビュー ---------- */

/* styles.xml: styleId ごとの文字書式を basedOn 連鎖ごと解決する。
   見出しレベルは pStyle の styleId でのみ確実に取れる（実測。字サイズからの
   逆算は Heading4 以降で破綻する）。ランの書式はここで解決して TextRun へ
   焼き込む — 描画側にスタイル表を持ち込まない */
function parseDocxStyles(xml) {
  var raw = {};
  var re = /<w:style [^>]*w:styleId="([^"]+)"[^>]*>([\\s\\S]*?)<\\/w:style>/g;
  var m;
  while ((m = re.exec(xml)) !== null) {
    var body = m[2];
    /* 段落スタイルの pPr 内の rPr に反応しないよう、pPr を除いてから拾う */
    var cleaned = body.replace(/<w:pPr>[\\s\\S]*?<\\/w:pPr>/g, '');
    var rpr = /<w:rPr>([\\s\\S]*?)<\\/w:rPr>/.exec(cleaned);
    var rb = rpr ? rpr[1] : '';
    var e = { basedOn: null, b: false, i: false, color: null, mono: false, szHalf: null };
    var bo = /<w:basedOn w:val="([^"]+)"/.exec(body);
    if (bo) e.basedOn = bo[1];
    if (/<w:b\\s*\\/>/.test(rb)) e.b = true;
    if (/<w:i\\s*\\/>/.test(rb)) e.i = true;
    var c = /<w:color w:val="([0-9A-Fa-f]{6})"/.exec(rb);
    if (c) e.color = '#' + c[1].toUpperCase();
    var f = /<w:rFonts[^>]*w:ascii="([^"]+)"/.exec(rb);
    if (f && /Consolas|Courier|Mono/i.test(f[1])) e.mono = true;
    var sz = /<w:sz w:val="(\\d+)"/.exec(rb);
    if (sz) e.szHalf = Number(sz[1]);
    raw[m[1]] = e;
  }
  /* 既定サイズは docDefaults ブロックの中だけから読む（無ければ 24 半 pt = 12pt） */
  var ddB = /<w:docDefaults>[\\s\\S]*?<\\/w:docDefaults>/.exec(xml);
  var dd = ddB ? /<w:sz w:val="(\\d+)"/.exec(ddB[0]) : null;
  var baseHalf = dd ? Number(dd[1]) : 24;
  var cache = {};
  function resolve(id) {
    if (!id || !raw[id]) return null;
    if (cache[id]) return cache[id];
    var chain = [];
    var cur = id;
    var guard = 0;
    while (cur && raw[cur] && guard++ < 16) {
      chain.push(raw[cur]);
      cur = raw[cur].basedOn;
    }
    var out = { b: false, i: false, color: null, mono: false, szHalf: null };
    for (var k = chain.length - 1; k >= 0; k--) {
      var st = chain[k];
      if (st.b) out.b = true;
      if (st.i) out.i = true;
      if (st.color) out.color = st.color;
      if (st.mono) out.mono = true;
      if (st.szHalf != null) out.szHalf = st.szHalf;
    }
    cache[id] = out;
    return out;
  }
  return { resolve: resolve, baseHalf: baseHalf };
}

/* numbering.xml: numId + ilvl → 行頭記号の種別。
   リスト構造は numId の変化では判定できない（入れ子のたびに新 numId。実測）。
   ツリーは ilvl から復元し、numbering.xml は種別判定にだけ使う。
   - lvlText が空白の bullet はリスト項目の続き段落（記号を出さない。実測）
   - w:num 内の startOverride は「4) 」等の開始番号（実測） */
function parseDocxNumbering(xml) {
  var fmts = {};
  var re = /<w:abstractNum w:abstractNumId="(\\d+)">([\\s\\S]*?)<\\/w:abstractNum>/g;
  var m;
  while ((m = re.exec(xml)) !== null) {
    var byLvl = {};
    var lr = /<w:lvl w:ilvl="(\\d+)">([\\s\\S]*?)<\\/w:lvl>/g;
    var lm;
    while ((lm = lr.exec(m[2])) !== null) {
      var fm = /<w:numFmt w:val="([^"]+)"/.exec(lm[2]);
      var lt = /<w:lvlText w:val="([^"]*)"/.exec(lm[2]);
      byLvl[lm[1]] = {
        fmt: fm ? fm[1] : null,
        blank: lt != null && lt[1].replace(/\\s/g, '') === ''
      };
    }
    fmts[m[1]] = byLvl;
  }
  var map = {};
  var starts = {};
  var nr = /<w:num w:numId="(\\d+)">([\\s\\S]*?)<\\/w:num>/g;
  while ((m = nr.exec(xml)) !== null) {
    var ab = /<w:abstractNumId w:val="(\\d+)"/.exec(m[2]);
    if (ab) map[m[1]] = ab[1];
    var so = /<w:startOverride w:val="(\\d+)"/.exec(m[2]);
    if (so) starts[m[1]] = Number(so[1]);
  }
  return function (numId, ilvl) {
    var byLvl = fmts[map[numId]] || {};
    var lv = byLvl[String(ilvl)] || byLvl['0'] || {};
    var ordered = lv.fmt != null && lv.fmt !== 'bullet';
    return {
      ordered: ordered,
      plain: !ordered && lv.blank === true,
      start: starts[numId] || 1
    };
  };
}

/* w:p の中身 → TextRun[]。行内改行（w:br。同一 w:p 内。実測）は
   \\n として同じランの流れに埋め込む。脚注参照（footnoteReference。
   w:t を持たない）は fnMap に出現順で番号を採り、[n] のテキストにする */
function parseDocxRuns(pXml, styles, fnMap) {
  /* w:ruby は w:r の中に w:r が入れ子になる唯一の形。ランの走査前に
     「親文字（よみ）」の平文ランへ潰す（RN にルビ描画は無いため近似。
     出力そのものには本物の w:ruby が入っている） */
  pXml = pXml.replace(/<w:r><w:ruby>[\\s\\S]*?<\\/w:ruby><\\/w:r>/g, function (rb) {
    var rt = /<w:rt>([\\s\\S]*?)<\\/w:rt>/.exec(rb);
    var base = /<w:rubyBase>([\\s\\S]*?)<\\/w:rubyBase>/.exec(rb);
    var pick = function (xml) {
      var out = '';
      var tr = /<w:t[^>]*>([\\s\\S]*?)<\\/w:t>/g;
      var tm;
      while ((tm = tr.exec(xml || '')) !== null) out += tm[1];
      return out;
    };
    var baseT = pick(base && base[1]);
    var rtT = pick(rt && rt[1]);
    if (!baseT) return '';
    return '<w:r><w:t>' + baseT + (rtT ? '（' + rtT + '）' : '') + '</w:t></w:r>';
  });
  var runs = [];
  var re = /<w:r>([\\s\\S]*?)<\\/w:r>/g;
  var m;
  while ((m = re.exec(pXml)) !== null) {
    var body = m[1];
    if (fnMap) {
      var fr = /<w:footnoteReference w:id="(\\d+)"/.exec(body);
      if (fr) {
        if (!(fr[1] in fnMap.ord)) {
          fnMap.ids.push(fr[1]);
          fnMap.ord[fr[1]] = fnMap.ids.length;
        }
        runs.push({ text: '[' + fnMap.ord[fr[1]] + ']' });
        continue;
      }
    }
    var rpr = /<w:rPr>([\\s\\S]*?)<\\/w:rPr>/.exec(body);
    var rb = rpr ? rpr[1] : '';
    var st = /<w:rStyle w:val="([^"]+)"/.exec(rb);
    var base = st ? styles.resolve(st[1]) : null;
    var text = '';
    var tr = /<w:t[^>]*>([\\s\\S]*?)<\\/w:t>|<w:br\\s*\\/>/g;
    var tm;
    while ((tm = tr.exec(body)) !== null) {
      text += tm[1] != null ? decodeXml(tm[1]) : '\\n';
    }
    if (!text) continue;
    var run = { text: text };
    if ((base && base.b) || /<w:b\\s*\\/>/.test(rb)) run.bold = true;
    if ((base && base.i) || /<w:i\\s*\\/>/.test(rb)) run.italic = true;
    if (/<w:u /.test(rb)) run.underline = true;
    if (/<w:strike\\s*\\/>/.test(rb)) run.strike = true;
    /* 傍点（w:em）。RN に圏点描画は無いため太字で近似（出力には本物が入る） */
    if (/<w:em /.test(rb)) run.bold = true;
    if (base && base.mono) run.mono = true;
    if (base && base.color) run.color = base.color;
    runs.push(run);
  }
  return runs;
}

/* document.xml → DocBlock[]。本文の w:p / w:tbl を出現順に読む。
   表は丸ごと1ブロックで先に食う（中の w:p を二重に拾わない）。
   連続する SourceCode 段落は 1 つのコードブロック（1段落 = 1行。実測） */
function parseDocxBlocks(xml, styles, markerOf, fnMap) {
  var bodyM = /<w:body>([\\s\\S]*?)<\\/w:body>/.exec(xml);
  var body = bodyM ? bodyM[1] : xml;
  var blocks = [];
  var re = /<w:tbl>[\\s\\S]*?<\\/w:tbl>|<w:p>[\\s\\S]*?<\\/w:p>/g;
  var m;
  while ((m = re.exec(body)) !== null) {
    var chunk = m[0];
    if (chunk.charAt(3) === 't') {
      var rows = [];
      var trR = /<w:tr>([\\s\\S]*?)<\\/w:tr>/g;
      var trM;
      while ((trM = trR.exec(chunk)) !== null) {
        var cells = [];
        var tcR = /<w:tc>([\\s\\S]*?)<\\/w:tc>/g;
        var tcM;
        while ((tcM = tcR.exec(trM[1])) !== null) {
          cells.push(parseDocxRuns(tcM[1], styles, fnMap));
        }
        rows.push({ header: /<w:tblHeader/.test(trM[1]), cells: cells });
      }
      blocks.push({ kind: 'table', rows: rows });
      continue;
    }
    if (/o:hr="t"/.test(chunk)) {
      blocks.push({ kind: 'hr' });
      continue;
    }
    /* 画像。名前は cNvPr descr（取り込み時の元ファイル名。実測）、
       寸法は wp:extent（EMU）。文中の画像は本文の段落を残したまま
       直後に画像ブロックを足す（本文を黙って落とさない） */
    var pendingImage = null;
    if (chunk.indexOf('<w:drawing>') >= 0) {
      var pd = /<pic:cNvPr [^>]*descr="([^"]*)"/.exec(chunk);
      var pe = /<wp:extent cx="(\\d+)" cy="(\\d+)"/.exec(chunk);
      if (pd) {
        pendingImage = {
          kind: 'image',
          name: decodeXml(pd[1]),
          wEmu: pe ? Number(pe[1]) : 0,
          hEmu: pe ? Number(pe[2]) : 0
        };
      }
    }
    var ps = /<w:pStyle w:val="([^"]+)"/.exec(chunk);
    var sid = ps ? ps[1] : '';
    var np = /<w:numPr>[\\s\\S]*?<w:ilvl w:val="(\\d+)"[\\s\\S]*?<w:numId w:val="(\\d+)"/.exec(chunk);
    var runs = parseDocxRuns(chunk, styles, fnMap);
    var hm = /^Heading(\\d)$/.exec(sid);
    if (np) {
      var mk = markerOf(np[2], Number(np[1]));
      var item = { kind: 'listItem', level: Number(np[1]), ordered: mk.ordered, runs: runs };
      if (mk.plain) item.plain = true;
      if (mk.ordered && mk.start !== 1) item.start = mk.start;
      blocks.push(item);
    } else if (hm) {
      blocks.push({ kind: 'heading', level: Number(hm[1]), runs: runs });
    } else if (sid === 'SourceCode') {
      var last = blocks[blocks.length - 1];
      if (last && last.kind === 'code') last.lines.push(runs);
      else blocks.push({ kind: 'code', lines: [runs] });
    } else if (sid === 'Title' || sid === 'Author' || sid === 'Date') {
      blocks.push({ kind: 'para', style: sid.toLowerCase(), runs: runs });
    } else if (sid === 'BlockText') {
      blocks.push({ kind: 'para', style: 'quote', runs: runs });
    } else if (runs.length) {
      blocks.push({ kind: 'para', style: 'body', runs: runs });
    }
    if (pendingImage) blocks.push(pendingImage);
  }
  return blocks;
}

function docStyleInfo(styles) {
  var heads = [];
  for (var i = 1; i <= 9; i++) {
    var st = styles.resolve('Heading' + i);
    heads.push(st && st.szHalf != null ? st.szHalf / 2 : styles.baseHalf / 2);
  }
  var t = styles.resolve('Title');
  var a = styles.resolve('Author');
  return {
    basePt: styles.baseHalf / 2,
    headingPt: heads,
    titlePt: t && t.szHalf != null ? t.szHalf / 2 : styles.baseHalf / 2,
    authorPt: a && a.szHalf != null ? a.szHalf / 2 : styles.baseHalf / 2
  };
}

function parseDocx(u8) {
  var zip = unzipSync(u8);
  var dec = new TextDecoder();
  var empty = new Uint8Array();
  var styles = parseDocxStyles(dec.decode(zip['word/styles.xml'] || empty));
  var markerOf = parseDocxNumbering(dec.decode(zip['word/numbering.xml'] || empty));
  /* 脚注参照の出現順 → 表示番号（Word の見た目と同じ採番。実測） */
  var fnMap = { ids: [], ord: {} };
  var blocks = parseDocxBlocks(
    dec.decode(zip['word/document.xml'] || empty), styles, markerOf, fnMap);
  /* 脚注本文は footnotes.xml に隔離される（実測）。フロー表示では
     文末に [n] 付きで並べる（消えると無警告のデータロスになる） */
  if (fnMap.ids.length && zip['word/footnotes.xml']) {
    var fx = dec.decode(zip['word/footnotes.xml']);
    blocks.push({ kind: 'hr' });
    for (var fi = 0; fi < fnMap.ids.length; fi++) {
      var fb = new RegExp('<w:footnote w:id="' + fnMap.ids[fi] + '">([\\\\s\\\\S]*?)</w:footnote>').exec(fx);
      if (!fb) continue;
      var fruns = parseDocxRuns(fb[1], styles, null);
      /* footnotes.xml は footnoteRef の直後に区切りの空白ランを持つ（実測）。
         番号だけ足せば「[n] 本文」になる */
      fruns.unshift({ text: '[' + (fi + 1) + ']' });
      blocks.push({ kind: 'para', style: 'footnote', runs: fruns });
    }
  }
  /* ページフッター（0.16.4 で後付けした word/footer1.xml、または reference-doc 由来）。
     フロー表示にページは無いので末尾に 1 回だけ出す — 毎ページ繰り返すのは嘘になる */
  var docXml = dec.decode(zip['word/document.xml'] || empty);
  var fref = /<w:footerReference [^>]*r:id="([^"]+)"/.exec(docXml);
  if (fref) {
    var relsXml = dec.decode(zip['word/_rels/document.xml.rels'] || empty);
    var rel = new RegExp('<Relationship [^>]*Id="' + fref[1] + '"[^>]*Target="([^"]+)"').exec(relsXml) ||
      new RegExp('<Relationship [^>]*Target="([^"]+)"[^>]*Id="' + fref[1] + '"').exec(relsXml);
    var part = rel && zip['word/' + rel[1].replace(/^\\/?(?:word\\/)?/, '')];
    if (part) {
      var pm = /<w:p[ >][\\s\\S]*?<\\/w:p>/.exec(dec.decode(part));
      if (pm) {
        var jcm = /<w:jc w:val="([^"]+)"/.exec(pm[0]);
        var jc = jcm ? jcm[1] : 'left';
        var fr = parseDocxRuns(pm[0], styles, null);
        if (fr.length) {
          blocks.push({
            kind: 'para', style: 'footer', runs: fr,
            align: jc === 'center' ? 'ctr' : (jc === 'right' || jc === 'end') ? 'r' : 'l'
          });
        }
      }
    }
  }
  return { blocks: blocks, styles: docStyleInfo(styles) };
}
window.__morphoParseDocx = parseDocx;

/* ---- docx のページフッター（0.16.4・notes/footer-design.md 実測 5） ----
   pandoc の docx には footer パートも Footer スタイルも無く、w:sectPr は文末に 1 個で
   中身は footnotePr だけ。footer1.xml + rels + [Content_Types] + footerReference を
   後付けする。footerReference は sectPr の**先頭**（ECMA-376 の子要素順:
   headerReference / footerReference → footnotePr → …）。
   意味論: デッキ全体の出典 = ページフッター（紙で配るハンドアウトのどのページを
   切り取っても出典が付く）。スライド個別の注釈は 0.17.0 で「その場の小さい段落」になる */
var DOCX_FOOTER_PART = 'word/footer1.xml';
function buildDocxFooterXml(f) {
  var jc = f.algn === 'l' ? 'left' : f.algn === 'ctr' ? 'center' : 'right';
  var half = Math.round(f.sizePt * 2);
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<w:p><w:pPr><w:jc w:val="' + jc + '"/></w:pPr>' +
    /* rPr の子要素順は color → sz → szCs。逆順は検証が鳴る（較正で確認） */
    '<w:r><w:rPr><w:color w:val="595959"/><w:sz w:val="' + half + '"/><w:szCs w:val="' + half + '"/></w:rPr>' +
    '<w:t xml:space="preserve">' + escapeXmlText(f.text) + '</w:t></w:r></w:p></w:ftr>';
}
window.__morphoBuildDocxFooterXml = buildDocxFooterXml;

function applyDocxFooter(bytes, f) {
  if (!f || !f.text) return bytes;
  var zip = unzipSync(bytes);
  var dec = new TextDecoder();
  var empty = new Uint8Array();
  /* 冪等。reference-doc が自前のフッターを運んできた場合もそれを尊重する */
  if (zip[DOCX_FOOTER_PART]) return bytes;
  var doc = dec.decode(zip['word/document.xml'] || empty);
  var rels = dec.decode(zip['word/_rels/document.xml.rels'] || empty);
  var ct = dec.decode(zip['[Content_Types].xml'] || empty);
  var sect = /<w:sectPr(?=[\\s/>])/.exec(doc);
  var relEnd = rels.lastIndexOf('</Relationships>');
  var ctEnd = ct.lastIndexOf('</Types>');
  if (!sect || relEnd < 0 || ctEnd < 0 || doc.indexOf('<w:footerReference') >= 0) return bytes;
  var close = doc.indexOf('>', sect.index);
  var maxId = 0;
  var idRe = /Id="rId(\\d+)"/g;
  var m;
  while ((m = idRe.exec(rels)) !== null) {
    if (Number(m[1]) > maxId) maxId = Number(m[1]);
  }
  var rId = 'rId' + (maxId + 1);
  var ref = '<w:footerReference w:type="default" r:id="' + rId + '"/>';
  if (doc.charAt(close - 1) === '/') {
    /* <w:sectPr/> の形。pandoc は出さないが、reference-doc 由来ならありうる */
    doc = doc.slice(0, close - 1) + '>' + ref + '</w:sectPr>' + doc.slice(close + 1);
  } else {
    doc = doc.slice(0, close + 1) + ref + doc.slice(close + 1);
  }
  zip['word/document.xml'] = strToU8(doc);
  zip['word/_rels/document.xml.rels'] = strToU8(rels.slice(0, relEnd) +
    '<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" ' +
    'Id="' + rId + '" Target="footer1.xml"/>' + rels.slice(relEnd));
  zip['[Content_Types].xml'] = strToU8(ct.slice(0, ctEnd) +
    '<Override PartName="/word/footer1.xml" ' +
    'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
    ct.slice(ctEnd));
  zip[DOCX_FOOTER_PART] = strToU8(buildDocxFooterXml(f));
  return zipSync(zip);
}
window.__morphoApplyDocxFooter = applyDocxFooter;

/* 文書プレビュー: 実際の docx を作って解析する（「実際の出力そのもの」原則）。
   CLAUDE.md 落とし穴 8: notes は docx へ無警告で溶けるため、書き出しと同じ
   Lua フィルタで除去してから解析する — プレビューと書き出しを一致させる */
async function doConvertDoc(id, md, opts) {
  /* 内容層の記法を pandoc の語彙へ実現する（原稿は書き換えない） */
  var col = expandColumns(md);
  md = col.md;
  var options = { from: READER, to: 'docx', 'output-file': 'out.docx' };
  if (opts.metadata && Object.keys(opts.metadata).length) options.metadata = opts.metadata;
  var files = {};
  var filters = [];
  if (opts.stripHtmlComments) {
    files['strip.lua'] = STRIP_LUA;
    filters.push('strip.lua');
  }
  files['drop-notes.lua'] = DROP_NOTES_LUA;
  filters.push('drop-notes.lua');
  options.filters = filters;
  wireRuby(options, files);
  wireAssets(options, files, false, md);

  var t0 = performance.now();
  var res = await pandoc.convert(options, md, files);
  var ms = Math.round(performance.now() - t0);

  var out = res.files && res.files['out.docx'];
  if (!out) throw new Error('pandoc produced no out.docx');
  var buf = new Uint8Array(await out.arrayBuffer());
  /* デッキ全体の出典はページフッターとして後付けし、その実出力を解析する
     （プレビューと書き出しを同じ 1 つの関数から導く） */
  if (opts.docFooter) buf = applyDocxFooter(buf, opts.docFooter);
  var parsed = parseDocx(buf);

  RN({
    id: id,
    type: 'ok',
    result: {
      kind: 'doc',
      blocks: parsed.blocks,
      styles: parsed.styles,
      diagnostics: classify(res.warnings, res.stderr, col.diags),
      ms: ms,
      bytes: buf.length
    }
  });
}

/* ---------- テンプレート（reference-doc） ---------- */

/* テンプレート本体はここに 1 度だけ預かる（変換のたびに base64 を
   postMessage / injectJavaScript で運ぶと重いため）。
   reference-doc が pandoc.wasm でも効くことは実測済み（check-template.mjs） */
var TEMPLATE_BLOB = null;

function b64ToBlob(b64) {
  var bin = atob(b64);
  var u = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u]);
}

window.__morphoSetTemplate = function (b64) {
  try {
    TEMPLATE_BLOB = b64 ? b64ToBlob(b64) : null;
  } catch (e) {
    TEMPLATE_BLOB = null;
    RN({ type: 'boot-error', message: 'template decode failed: ' + String((e && e.message) || e) });
  }
};

/* ---------- 段組み（+++ の列区切り） ----------
   内容層の記法。原稿は書き換えず、pandoc へ渡す文字列だけを作る。
   設計と実測は ../../../notes/column-input.md。

   規則: スライド区間の中に区切りが 1 つでもあれば、その区間の本文まるごとを
   列に割る（見出しと末尾の ::: notes は列の外）。「段組みの外に本文がある」
   状態が原理的に作れないので、pandoc の「無警告で消える / スライドが割れる」を
   構造的に回避する（実測）。

   COL_SEP は src/text/columns.ts と同じ正規表現。ブリッジは WebView 用の
   文字列なので import できず、二重に持っている。食い違うと原稿とプレビューで
   列の切れ目がずれるので、scripts/check-columns.mjs が一致を検証している。 */
var COL_SEP = /^[ \\t]*[+＋]([ \\t]*[+＋]){2,}[ \\t]*$/;
var COL_H1 = /^#[ \\t]/;
var COL_HR = /^ {0,3}([*_-])(?:[ \\t]*\\1){2,}[ \\t]*$/;
var COL_CODE = /^ {0,3}(\`\`\`|~~~)/;
var COL_NOTES_OPEN = /^[ \\t]*(?:>[ \\t]*)*:::+[ \\t]*(?:\\{[^}]*\\.notes[^}]*\\}|notes\\b)/;
var COL_DIV_CLOSE = /^[ \\t]*(?:>[ \\t]*)*:::+[ \\t]*$/;
var COL_DIV_ANY = /^[ \\t]*(?:>[ \\t]*)*:::+/;
/* 段落 1 つぶんの画像 / パイプ表の先頭行 */
var COL_IMAGE = /^[ \\t]*!\\[[^\\]]*\\]\\([^)]*\\)[ \\t]*$/;
var COL_TABLE = /^[ \\t]*\\|/;

/* 列の先頭ブロックの種別と、その後ろにブロックが続くか。
   CLAUDE.md 落とし穴 13: 列の先頭が画像か表だと後続ブロックが全部消える */
function colHead(colLines) {
  var i = 0;
  while (i < colLines.length && colLines[i].trim() === '') i++;
  if (i >= colLines.length) return { kind: 'empty', more: false };
  var kind = COL_IMAGE.test(colLines[i]) ? 'image'
    : COL_TABLE.test(colLines[i]) ? 'table' : 'other';
  var j = i;
  while (j < colLines.length && colLines[j].trim() !== '') j++;
  var more = false;
  for (var k = j; k < colLines.length; k++) {
    if (colLines[k].trim() !== '') { more = true; break; }
  }
  return { kind: kind, more: more };
}

function expandColumns(md) {
  /* CRLF 原稿（Windows 由来の .md）では各行末に \\r が残り、COL_SEP / COL_HR /
     COL_DIV_CLOSE が一致せず、段組みが無警告で 1 段のまま出ていた（実測:
     scripts/check-deck.mjs）。ここは変換器へ渡す派生テキストしか作らないので、
     行末の \\r を丸ごと落として LF に正規化する。pandoc は CRLF でも LF と同じ
     出力を返す（実測）ので結果は変わらない。原稿側のオフセット系
     （splitFrontMatter / cursorSlide.ts）には適用しない — 長さが変わる。
     src/text/lineEnding.ts と同じ規約（ブリッジは import できないので自前） */
  var lines = md.split('\\n');
  for (var n = 0; n < lines.length; n++) {
    if (lines[n].slice(-1) === '\\r') lines[n] = lines[n].slice(0, -1);
  }
  var diags = [];
  var segs = [];
  var start = 0;
  var inCode = false;
  for (var i = 0; i < lines.length; i++) {
    if (COL_CODE.test(lines[i])) { inCode = !inCode; continue; }
    if (inCode) continue;
    if (i > start && (COL_H1.test(lines[i]) || COL_HR.test(lines[i]))) {
      segs.push([start, i]);
      start = i;
    }
  }
  segs.push([start, lines.length]);

  var out = [];
  for (var s = 0; s < segs.length; s++) {
    var seg = lines.slice(segs[s][0], segs[s][1]);
    var sepIdx = [];
    var f = false;
    var notes = 0;
    for (var j = 0; j < seg.length; j++) {
      if (COL_CODE.test(seg[j])) { f = !f; continue; }
      if (f) continue;
      if (COL_NOTES_OPEN.test(seg[j])) { notes++; continue; }
      if (notes > 0) { if (COL_DIV_CLOSE.test(seg[j])) notes--; continue; }
      if (COL_SEP.test(seg[j])) sepIdx.push(j);
    }
    if (!sepIdx.length) { out = out.concat(seg); continue; }

    var head = 0;
    while (head < seg.length &&
      (seg[head].trim() === '' || COL_H1.test(seg[head]) || COL_HR.test(seg[head]))) head++;
    /* 末尾の ::: notes ブロックは列の外へ出す。閉じ柵から遡って開き柵を探す
       （中身の行で止まらないこと。別の柵に当たったら notes ではないので諦める） */
    var tail = seg.length;
    var e = seg.length - 1;
    while (e >= 0 && seg[e].trim() === '') e--;
    if (e >= 0 && COL_DIV_CLOSE.test(seg[e])) {
      for (var t = e - 1; t >= 0; t--) {
        if (COL_NOTES_OPEN.test(seg[t])) { tail = t; break; }
        if (COL_DIV_ANY.test(seg[t])) break;
      }
    }
    var body = seg.slice(head, tail);
    var rel = [];
    for (var r = 0; r < sepIdx.length; r++) {
      var v = sepIdx[r] - head;
      if (v >= 0 && v < body.length) rel.push(v);
    }
    if (!rel.length) { out = out.concat(seg); continue; }

    var cols = [];
    var prev = 0;
    for (var c = 0; c < rel.length; c++) { cols.push(body.slice(prev, rel[c])); prev = rel[c] + 1; }
    cols.push(body.slice(prev));

    /* 展開してはいけない形。展開すると後続が無警告で消えるので、
       そのまま（1 段のまま）渡して診断を出す。内容の順序は変えない */
    var unsafe = null;
    for (var u = 0; u < cols.length; u++) {
      var h = colHead(cols[u]);
      if ((h.kind === 'image' || h.kind === 'table') && h.more) { unsafe = h.kind; break; }
    }
    if (unsafe) {
      var what = unsafe === 'image' ? '画像' : '表';
      diags.push({
        kind: 'design',
        label: what + 'の後ろの内容が消えるため段組みにしませんでした',
        hint: what + 'を列の最後に置くか、*** で別のスライドにしてください',
        text: '列の先頭が' + what + 'で、その後ろに内容が続いています',
        count: 1
      });
      /* 段組みにはしないが、区切りは内容ではなく記法なので消費する。
         残すと本文に生の +++ が出る（実測）。空行に置き換えて段落の切れ目は保つ */
      for (var y = 0; y < seg.length; y++) if (COL_SEP.test(seg[y])) seg[y] = '';
      out = out.concat(seg);
      continue;
    }

    if (cols.length > 2) {
      diags.push({
        kind: 'design',
        label: '3 列目以降はスライドに出ません',
        hint: 'スライドは 2 列までです（Web 書き出しでは ' + cols.length + ' 列とも出ます）',
        text: cols.length + ' 列の段組みがあります',
        count: 1
      });
    }

    out = out.concat(seg.slice(0, head));
    out.push('::: {.columns}');
    for (var q = 0; q < cols.length; q++) {
      out.push('::: {.column}');
      var inner = cols[q].join('\\n').replace(/^\\n+|\\n+$/g, '');
      if (inner) out = out.concat(inner.split('\\n'));
      out.push(':::');
    }
    out.push(':::');
    out = out.concat(seg.slice(tail));
  }
  return { md: out.join('\\n'), diags: diags };
}
window.__morphoExpandColumns = expandColumns;

/* ルビ・傍点フィルタを配線する（全形式で常時有効。出し分けはフィルタ内の FORMAT） */
function wireRuby(options, files) {
  files['ruby.lua'] = RUBY_LUA;
  options.filters = (options.filters || []).concat(['ruby.lua']);
}

/* ---------- 画像アセット ---------- */

/* 原稿が参照する画像はここに預かる（テンプレートと同じ 2 段構え）。
   CLAUDE.md 落とし穴 3: 見つからない画像は警告ではなく致命的エラーで
   出力が一切生成されない。預かっていない参照は Lua ガードで
   プレースホルダ文字列に置き換え、変換全体は生かす */
var ASSETS = {};

/* 差分更新（1枚だけの追加・削除）。全置き換えは __morphoSetAssets */
window.__morphoSetAsset = function (name, b64) {
  if (b64 == null) {
    delete ASSETS[name];
    return;
  }
  try {
    ASSETS[name] = b64ToBlob(b64);
  } catch (e) {
    /* 壊れた1枚のために全体を落とさない */
  }
};

window.__morphoSetAssets = function (map) {
  ASSETS = {};
  if (!map) return;
  var names = Object.keys(map);
  for (var i = 0; i < names.length; i++) {
    try {
      ASSETS[names[i]] = b64ToBlob(map[names[i]]);
    } catch (e) {
      /* 壊れた1枚のために全体を落とさない */
    }
  }
};

function luaQuote(sName) {
  return "'" + String(sName).replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'") + "'";
}

/* 見つからない画像参照をプレースホルダへ置き換えるガード（名前一覧から生成） */
function buildImageGuardLua(names) {
  var lua = 'local ok = {';
  for (var k = 0; k < names.length; k++) {
    lua += '[' + luaQuote(names[k]) + '] = true,';
  }
  lua += '}\\n' +
    'function Image(el)\\n' +
    '  if not ok[el.src] then\\n' +
    "    return pandoc.Str('[画像なし: ' .. el.src .. ']')\\n" +
    '  end\\n' +
    'end\\n';
  return lua;
}
window.__morphoImageGuardLua = buildImageGuardLua;

/* 預かっている画像を files に載せ、無い参照を置き換えるガードを配線する。
   画像記法の無い原稿ではフィルタごと省く（ライブプレビューの hot path） */
function wireAssets(options, files, isHtml, md) {
  var names = Object.keys(ASSETS);
  if (!names.length && String(md).indexOf('![') < 0) return;
  for (var i = 0; i < names.length; i++) files[names[i]] = ASSETS[names[i]];
  if (isHtml && names.length) options['embed-resources'] = true;
  files['image-guard.lua'] = buildImageGuardLua(names);
  options.filters = (options.filters || []).concat(['image-guard.lua']);
}

/* pptx 系の変換オプションへ reference-doc を配線する */
function wireTemplate(opts, options, files) {
  if (opts.useTemplate && TEMPLATE_BLOB) {
    options['reference-doc'] = 'ref.pptx';
    files['ref.pptx'] = TEMPLATE_BLOB;
  }
}

async function doConvert(id, md, opts, format) {
  try {
    if (!pandoc) throw new Error('converter is not ready yet');
    opts = opts || {};
    if (format === 'web') { await doConvertWeb(id, md, opts); return; }
    if (format === 'doc') { await doConvertDoc(id, md, opts); return; }
    /* 内容層の記法を pandoc の語彙へ実現する（原稿は書き換えない） */
    var col = expandColumns(md);
    md = col.md;
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
    wireRuby(options, files);
    wireAssets(options, files, false, md);
    wireTemplate(opts, options, files);

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
        diagnostics: classify(res.warnings, res.stderr, col.diags),
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
    /* 内容層の記法を pandoc の語彙へ実現する（原稿は書き換えない） */
    var col = expandColumns(md);
    md = col.md;
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
    wireRuby(options, files);
    wireAssets(options, files, format === 'html', md);
    if (format === 'pptx') wireTemplate(opts, options, files);

    var t0 = performance.now();
    var res = await pandoc.convert(options, md, files);
    var ms = Math.round(performance.now() - t0);

    var out = res.files && res.files[name];
    if (!out) throw new Error('pandoc produced no ' + name);

    /* 文字サイズの上書きは pptx にだけ効く */
    if (format === 'pptx' && opts.textSizes) {
      out = new Blob([
        applyTextSizes(new Uint8Array(await out.arrayBuffer()), opts.textSizes),
      ]);
    }

    /* 装飾は pptx にだけ OOXML 後処理で焼き込む */
    if (format === 'pptx' && opts.decorations && opts.decorations.length) {
      var titleOffset = opts.metadata && opts.metadata.title ? 1 : 0;
      var processed = applyDecorations(
        new Uint8Array(await out.arrayBuffer()), opts.decorations, titleOffset, opts.groups);
      out = new Blob([processed]);
    }

    /* フッターは装飾より後 = 最前面。帯の上に置いた装飾に隠されないようにする */
    if (format === 'pptx' && opts.footer) {
      out = new Blob([applyFooters(new Uint8Array(await out.arrayBuffer()), opts.footer)]);
    }
    /* docx はページフッター、html は本文末尾に 1 回（0.16.4） */
    if (format === 'docx' && opts.docFooter) {
      out = new Blob([applyDocxFooter(new Uint8Array(await out.arrayBuffer()), opts.docFooter)]);
    }
    if (format === 'html') {
      out = new Blob([decorateWebHtml(await out.text(), opts.docFooter)], { type: 'text/html' });
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
        diagnostics: classify(res.warnings, res.stderr, col.diags)
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
