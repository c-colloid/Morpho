/**
 * テンプレート配線盤の検査。
 * 前半は純関数（listLayoutNames / autoAssign / applyAssignments）。
 * 後半は実 pandoc で reference-doc が効くことの常時検証
 * （CLAUDE.md の旧・未検証項目。テーマ色の引き継ぎと、日本語名 → 英語名の
 *   書き換えでレイアウト警告が消えることを実出力で確かめる）。
 */
import assert from 'node:assert/strict';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { convert } from '../node_modules/pandoc-wasm/src/index.node.js';

const { listLayoutNames, autoAssign, applyAssignments, PANDOC_LAYOUTS } = await import(
  '../src/design/template.ts'
);

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok   ' + name); };
const ta = async (name, fn) => { await fn(); n++; console.log('  ok   ' + name); };

/* ---------- 実 pandoc の既定出力を素材にする ---------- */

const md = '# 見出し\n\n- 本文\n';
const opts = { from: 'markdown', to: 'pptx', 'output-file': 'o.pptx', metadata: { title: 'T' } };
const base = new Uint8Array(await (await convert(opts, md, {})).files['o.pptx'].arrayBuffer());

/* 日本語版 PowerPoint を模したテンプレート: テーマ色を変え、名前を和名へ */
const JP = {
  'Title Slide': 'タイトル スライド',
  'Title and Content': 'タイトルとコンテンツ',
  'Section Header': 'セクション見出し',
  'Two Content': '2 つのコンテンツ',
  Comparison: '比較',
  'Content with Caption': 'タイトル付きのコンテンツ',
  Blank: '白紙',
};
const jpTemplate = (() => {
  const zip = unzipSync(base);
  for (const name of Object.keys(zip)) {
    if (name === 'ppt/theme/theme1.xml') {
      zip[name] = strToU8(
        strFromU8(zip[name]).replace(
          /(<a:accent1>\s*<a:srgbClr val=")[0-9A-Fa-f]{6}/,
          '$1FF0000',
        ),
      );
    }
    if (/^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(name)) {
      zip[name] = strToU8(
        strFromU8(zip[name]).replace(
          /(<p:cSld name=")([^"]+)(")/,
          (_m, a, nm, c) => a + (JP[nm] ?? nm) + c,
        ),
      );
    }
  }
  return zipSync(zip);
})();

t('listLayoutNames: 和名テンプレートの名前が番号順に取れる', () => {
  const names = listLayoutNames(jpTemplate);
  assert.ok(names.includes('タイトル スライド'));
  assert.ok(names.includes('比較'));
  assert.ok(!names.includes('Title Slide'));
});

t('autoAssign: 日本語既定名は 7 枠すべて自動で結ばれる', () => {
  const a = autoAssign(listLayoutNames(jpTemplate));
  for (const en of PANDOC_LAYOUTS) assert.equal(typeof a[en], 'string', en);
  assert.equal(a['Title Slide'], 'タイトル スライド');
  assert.equal(a.Comparison, '比較');
});

t('autoAssign: 英語名はそのまま結ばれる', () => {
  const a = autoAssign(listLayoutNames(base));
  assert.equal(a['Title Slide'], 'Title Slide');
});

t('applyAssignments: 割り当てた名前が英語へ書き換わり、元 bytes は不変', () => {
  const before = jpTemplate.length;
  const fixed = applyAssignments(jpTemplate, autoAssign(listLayoutNames(jpTemplate)));
  assert.equal(jpTemplate.length, before);
  const names = listLayoutNames(fixed);
  for (const en of PANDOC_LAYOUTS) assert.ok(names.includes(en), en);
  assert.ok(!names.includes('タイトル スライド'));
});

t('applyAssignments: 未割り当てなのに英語名を名乗るレイアウトは退避される', () => {
  /* 「タイトル スライド」を Title Slide に割り当てつつ、元から Title Slide を
     名乗る別レイアウトがいる状況 → 同名2枚の衝突を避ける */
  const zip = unzipSync(jpTemplate);
  /* 「白紙」を名乗るレイアウトを衝突役に（タイトル スライドとは別のファイル） */
  const one = Object.keys(zip).find(
    (f) => /slideLayout\d+\.xml$/.test(f) && strFromU8(zip[f]).includes('name="白紙"'),
  );
  zip[one] = strToU8(
    strFromU8(zip[one]).replace(/<p:cSld name="[^"]*"/, '<p:cSld name="Title Slide"'),
  );
  const conflicted = zipSync(zip);
  const fixed = applyAssignments(conflicted, { 'Title Slide': 'タイトル スライド' });
  const names = listLayoutNames(fixed);
  assert.equal(names.filter((x) => x === 'Title Slide').length, 1);
  assert.ok(names.includes('Title Slide (template)'));
});

/* ---------- 実 pandoc で reference-doc の効果を検証 ---------- */

async function convertWithRef(tpl) {
  const res = await convert(
    { ...opts, 'reference-doc': 'ref.pptx' },
    md,
    { 'ref.pptx': new Blob([tpl]) },
  );
  const bytes = new Uint8Array(await res.files['o.pptx'].arrayBuffer());
  const zip = unzipSync(bytes);
  const accent = /<a:accent1>\s*<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(
    strFromU8(zip['ppt/theme/theme1.xml']),
  );
  const layoutWarnings = (res.warnings ?? []).filter(
    (w) => w.type === 'PowerpointTemplateWarning',
  );
  return { accent1: accent?.[1], layoutWarnings };
}

await ta('reference-doc: テーマ色が出力へ引き継がれる（旧・未検証項目）', async () => {
  const r = await convertWithRef(jpTemplate);
  assert.equal(r.accent1, 'FF0000');
});

await ta('reference-doc: 和名のままはレイアウト警告、書き換え後は警告ゼロ', async () => {
  const before = await convertWithRef(jpTemplate);
  assert.ok(before.layoutWarnings.length > 0, '和名で警告が出るはず');
  const fixed = applyAssignments(jpTemplate, autoAssign(listLayoutNames(jpTemplate)));
  const after = await convertWithRef(fixed);
  assert.equal(after.layoutWarnings.length, 0);
});

console.log(`\n${n} 件すべて通過`);
