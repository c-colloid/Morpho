import React from 'react';
import { Image, ScrollView, StyleSheet, Text, View, type TextStyle } from 'react-native';

import type { DocResult, TextRun } from '../converter/types';

/**
 * 文書（docx）プレビュー。フロー表示（リーダー風）— ページ組はしない。
 * document.xml にページ境界情報が無いため、ページ組は Word の組版エンジンの
 * 再発明 = 嘘になる（notes/preview-formats.md の決定）。
 *
 * 字サイズは styles.xml の実測値（DocStyleInfo）を pt → px 換算で使う。
 * ランの書式（太字・色・等幅）はパーサが TextRun へ焼き込み済み。
 */

/** pt → 画面 px。本文 12pt ≒ 16px の読みやすい倍率 */
const PX = 4 / 3;

function runStyle(r: TextRun): TextStyle {
  const s: TextStyle = {};
  if (r.bold) s.fontWeight = '700';
  if (r.italic) s.fontStyle = 'italic';
  if (r.underline && r.strike) s.textDecorationLine = 'underline line-through';
  else if (r.underline) s.textDecorationLine = 'underline';
  else if (r.strike) s.textDecorationLine = 'line-through';
  if (r.mono) s.fontFamily = 'Menlo';
  if (r.color) s.color = r.color;
  return s;
}

function Runs({ runs, base }: { runs: TextRun[]; base: TextStyle }) {
  return (
    <Text style={base}>
      {runs.map((r, i) => (
        <Text key={i} style={runStyle(r)}>
          {r.text}
        </Text>
      ))}
    </Text>
  );
}

/** 箇条書きの行頭記号（pandoc 既定 numbering.xml の Symbol / o / Wingdings 相当） */
const BULLETS = ['•', '◦', '▪'];

export function DocumentSurface({
  result,
  imageUriOf,
}: {
  result: DocResult;
  /** 画像名 → 描画用 URI（アセット保存庫）。未指定なら画像は枠だけ描く */
  imageUriOf?: (name: string) => string;
}) {
  const st = result.styles;
  const bodyPx = st.basePt * PX;

  /* 番号付きリストの連番。同じ深さの連続だけ数え、浅い段や別ブロックでリセット。
     項目の続き段落（plain）はカウンタに触らない */
  const counters: Array<number | undefined> = [];

  const rendered = result.blocks.map((b, i) => {
    if (b.kind !== 'listItem') counters.length = 0;
    let node: React.ReactElement | null = null;

    if (b.kind === 'heading') {
      const pt = st.headingPt[(b.level ?? 1) - 1] ?? st.basePt;
      node = (
        <View style={styles.headingWrap}>
          <Runs runs={b.runs ?? []} base={{ fontSize: pt * PX, lineHeight: pt * PX * 1.35, color: '#14161B' }} />
        </View>
      );
    } else if (b.kind === 'para') {
      const style = b.style ?? 'body';
      if (style === 'title' || style === 'author' || style === 'date') {
        const pt = style === 'title' ? st.titlePt : st.authorPt;
        node = (
          <View style={styles.titleWrap}>
            <Runs runs={b.runs ?? []} base={{ fontSize: pt * PX, lineHeight: pt * PX * 1.4, color: '#14161B' }} />
          </View>
        );
      } else if (style === 'footnote') {
        node = (
          <View style={styles.footnote}>
            <Runs
              runs={b.runs ?? []}
              base={{ fontSize: bodyPx * 0.85, lineHeight: bodyPx * 1.35, color: '#3D434E' }}
            />
          </View>
        );
      } else if (style === 'footer') {
        /* ページフッター。フロー表示にページは無いので末尾に 1 回だけ、
           「ページごとに付く」ことをラベルで示す */
        node = (
          <View style={styles.footer}>
            <Text style={styles.footerLabel}>ページフッター</Text>
            <Runs
              runs={b.runs ?? []}
              base={{
                fontSize: bodyPx * 0.75,
                lineHeight: bodyPx * 1.3,
                color: '#595959',
                textAlign: b.align === 'ctr' ? 'center' : b.align === 'r' ? 'right' : 'left',
              }}
            />
          </View>
        );
      } else if (style === 'quote') {
        node = (
          <View style={styles.quote}>
            <Runs runs={b.runs ?? []} base={{ fontSize: bodyPx, lineHeight: bodyPx * 1.6, color: '#3D434E' }} />
          </View>
        );
      } else {
        node = (
          <View style={styles.para}>
            <Runs runs={b.runs ?? []} base={{ fontSize: bodyPx, lineHeight: bodyPx * 1.6, color: '#14161B' }} />
          </View>
        );
      }
    } else if (b.kind === 'listItem') {
      const lvl = b.level ?? 0;
      let glyph = '';
      if (b.plain) {
        /* 項目の続き段落。記号なし・連番も進めない（Word の見た目と同じ） */
      } else if (b.ordered) {
        counters.length = lvl + 1;
        counters[lvl] = (counters[lvl] ?? (b.start ?? 1) - 1) + 1;
        glyph = String(counters[lvl]) + '.';
      } else {
        counters.length = lvl + 1;
        counters[lvl] = undefined;
        glyph = BULLETS[lvl % BULLETS.length];
      }
      node = (
        <View style={[styles.listRow, { paddingLeft: 8 + lvl * 22 }]}>
          <Text style={[styles.listGlyph, { fontSize: bodyPx, lineHeight: bodyPx * 1.6 }]}>{glyph}</Text>
          <View style={styles.listBody}>
            <Runs runs={b.runs ?? []} base={{ fontSize: bodyPx, lineHeight: bodyPx * 1.6, color: '#14161B' }} />
          </View>
        </View>
      );
    } else if (b.kind === 'code') {
      node = (
        <View style={styles.code}>
          {(b.lines ?? []).map((line, li) => (
            <Text key={li} style={[styles.codeLine, { fontSize: bodyPx * 0.85 }]}>
              {line.length === 0 ? ' ' : null}
              {line.map((r, ri) => (
                <Text key={ri} style={runStyle(r)}>
                  {r.text}
                </Text>
              ))}
            </Text>
          ))}
        </View>
      );
    } else if (b.kind === 'table') {
      node = (
        <View style={styles.table}>
          {(b.rows ?? []).map((row, ri) => (
            <View key={ri} style={[styles.tr, row.header && styles.trHeader]}>
              {row.cells.map((cell, ci) => (
                <View key={ci} style={styles.td}>
                  <Runs
                    runs={cell}
                    base={{
                      fontSize: bodyPx * 0.92,
                      lineHeight: bodyPx * 1.4,
                      color: '#14161B',
                      fontWeight: row.header ? '600' : '400',
                    }}
                  />
                </View>
              ))}
            </View>
          ))}
        </View>
      );
    } else if (b.kind === 'image') {
      /* 実寸（EMU → pt → px）。枠幅を超えるなら縦横比を保って収める */
      const wPx = (b.wEmu ?? 0) / 12700 * (4 / 3);
      const hPx = (b.hEmu ?? 0) / 12700 * (4 / 3);
      const ratio = wPx > 0 && hPx > 0 ? hPx / wPx : 0.75;
      node = imageUriOf && b.name ? (
        <Image
          source={{ uri: imageUriOf(b.name) }}
          style={[styles.image, { width: wPx || 240, aspectRatio: 1 / ratio }]}
          resizeMode="contain"
        />
      ) : (
        <View style={[styles.image, styles.imageFallback, { width: wPx || 240, height: hPx || 180 }]} />
      );
    } else if (b.kind === 'hr') {
      node = <View style={styles.hr} />;
    }

    return <React.Fragment key={i}>{node}</React.Fragment>;
  });

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      {rendered}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 10 },
  content: {
    paddingHorizontal: 24,
    paddingVertical: 20,
    maxWidth: 720,
    alignSelf: 'center',
    width: '100%',
  },
  titleWrap: { marginTop: 2, marginBottom: 6 },
  headingWrap: { marginTop: 18, marginBottom: 6 },
  para: { marginVertical: 6 },
  quote: {
    marginVertical: 6,
    paddingLeft: 12,
    paddingRight: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#C6CBD4',
  },
  listRow: { flexDirection: 'row', marginVertical: 2 },
  listGlyph: { width: 22, color: '#3D434E' },
  listBody: { flex: 1 },
  code: {
    marginVertical: 8,
    borderRadius: 8,
    backgroundColor: '#F4F5F7',
    borderWidth: 1,
    borderColor: '#E3E6EB',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  codeLine: { fontFamily: 'Menlo', color: '#14161B', lineHeight: 18 },
  table: {
    marginVertical: 8,
    borderWidth: 1,
    borderColor: '#C6CBD4',
    borderRadius: 6,
    overflow: 'hidden',
  },
  tr: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#E3E6EB' },
  trHeader: { backgroundColor: '#F0F2F5', borderTopWidth: 0 },
  td: { flex: 1, paddingHorizontal: 8, paddingVertical: 6 },
  hr: { height: 1, backgroundColor: '#C6CBD4', marginVertical: 14 },
  footnote: { marginVertical: 2, paddingLeft: 4 },
  footer: { marginTop: 24, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#D9DCE2' },
  footerLabel: { fontSize: 10, color: '#9AA0AC', marginBottom: 2 },
  image: { marginVertical: 8, maxWidth: '100%' },
  imageFallback: { backgroundColor: '#E7EAEF', borderWidth: 1, borderColor: '#C6CBD4' },
});
