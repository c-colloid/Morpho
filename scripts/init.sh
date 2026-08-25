#!/usr/bin/env bash
# Morpho — 初期セットアップ
set -euo pipefail
REPO="${1:-c-colloid/Morpho}"

echo "GitHub Pages を有効化します..."
gh api "repos/$REPO/pages" -X POST \
  -f 'source[branch]=main' -f 'source[path]=/docs' 2>/dev/null \
  || gh api "repos/$REPO/pages" -X PUT \
       -f 'source[branch]=main' -f 'source[path]=/docs'

if command -v pandoc >/dev/null; then
  echo "基準出力を再生成します..."
  pandoc fixtures/pptx-benchmark.md -o fixtures/pptx-benchmark-reference.pptx
  echo "  → $(pandoc --version | head -1) で生成しました"
else
  echo "pandoc が見つかりません。基準出力の再生成はスキップします"
fi

echo
echo "完了: https://${REPO%%/*}.github.io/${REPO##*/}/"
