/**
 * AltStore / SideStore の「ソース」JSON を生成する（CI 用）。
 *
 * 固定 URL https://github.com/c-colloid/Morpho/releases/latest/download/source.json
 * で配れるよう、毎リリースの成果物として source.json を添付する。
 * ソースを一度登録すれば、以後はストア側が更新を検出してワンタップで入れ替えられる。
 *
 *   node scripts/make-source.mjs <version> <ipa path> <notes path> [out path]
 *
 * フォーマットの根拠: faq.altstore.io/developers/make-a-source（実測 2026-08）。
 * 必須: name / apps / news、アプリ側: bundleIdentifier・developerName・iconURL・
 * localizedDescription・versions[{version, date, downloadURL, size}]。
 */
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const REPO = 'https://github.com/c-colloid/Morpho';

export function buildSource({ version, size, date, notes }) {
  return {
    name: 'Morpho',
    identifier: 'com.ccolloid.morpho.source',
    apps: [
      {
        name: 'Morpho',
        bundleIdentifier: 'com.ccolloid.morpho',
        developerName: 'c-colloid',
        subtitle: 'Markdown からスライドを作る',
        localizedDescription:
          '一つの Markdown 原稿から PowerPoint スライドを作る iPad エディタ。' +
          '実寸ライブプレビュー・スライドショー・発表者ビュー・pptx / docx 書き出し。',
        iconURL: 'https://raw.githubusercontent.com/c-colloid/Morpho/main/app/assets/icon.png',
        versions: [
          {
            version,
            date,
            localizedDescription: notes,
            downloadURL: `${REPO}/releases/download/v${version}/Morpho-${version}.ipa`,
            size,
            minOSVersion: '15.1',
          },
        ],
      },
    ],
    news: [],
  };
}

/* 検査から import できるよう、CLI 実行は直接起動のときだけ */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [version, ipaPath, notesPath, outPath = 'source.json'] = process.argv.slice(2);
  if (!version || !ipaPath || !notesPath) {
    console.error('usage: node scripts/make-source.mjs <version> <ipa> <notes.md> [out]');
    process.exit(1);
  }
  const size = statSync(ipaPath).size;
  const date = new Date().toISOString().slice(0, 10);
  const notes = readFileSync(notesPath, 'utf8').trim();
  writeFileSync(outPath, JSON.stringify(buildSource({ version, size, date, notes }), null, 2) + '\n');
  console.log(`${outPath}: v${version} / ${size} bytes / ${date}`);
}
