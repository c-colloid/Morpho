import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LatestOnly } from '../converter/latestOnly';
import { splitFrontMatter } from '../converter/frontMatter';
import { usePandocConverter } from '../converter/usePandocConverter';
import type {
  BootStatus,
  ConvertResult,
  Diagnostic,
  Paragraph,
  SlideOutline,
  SlideShape,
  TextRun,
} from '../converter/types';

/** CLAUDE.md 性能設計: デッキ全体の変換は手が止まって 1.5 秒後 */
const IDLE_MS = 1500;

const SAMPLE = `---
title: "Morpho"
author: "フテイケイ"
---

# 単一ソース出版

一つの原稿から、スライド・書籍・PDF・Web を刷り分ける。

## 日本語の段落

これは箇条書きではない普通の段落です。**太字**と*斜体*と\`コード\`を含みます。

欧文では *italic* と **bold** がこう出ます。
和文の斜体は iOS の日本語書体に斜体字形が無いため傾きません。

<!-- これは HTML コメント。既定では RawBlock 警告が出ます -->

***

# 二枚目

- 箇条書き
- 入れ子を試す
  - 二階層目

1. 番号付き
2. ふたつめ

\`\`\`js
const x = 1;
\`\`\`
`;

export default function EditorScreen() {
  const { element, converter, status } = usePandocConverter();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // iPad の縦向きは 820〜834pt。900 では縦で二画面にならず、狭い縦積みになる
  const wide = width >= 700;

  const [source, setSource] = useState(SAMPLE);
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 位置ずれの切り分け用。ペイン領域が実際に何ptで置かれたかを見る
  const [panesBox, setPanesBox] = useState<{ y: number; h: number } | null>(null);

  const runner = useMemo(
    () =>
      new LatestOnly<string, ConvertResult>(
        (md) => {
          // CLAUDE.md 落とし穴 1: front matter は自前で剥がして metadata で渡す
          const { metadata, body } = splitFrontMatter(md);
          return converter.convert(body, { metadata, stripHtmlComments: true });
        },
        (r, e) => {
          setBusy(false);
          if (e) {
            setError(e.message);
          } else if (r) {
            setError(null);
            setResult(r);
          }
        },
      ),
    [converter],
  );

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (status.phase !== 'ready') return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setBusy(true);
      runner.submit(source);
    }, IDLE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [source, status.phase, runner]);

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
    >
      {element}

      <HeaderBar
        status={status}
        busy={busy}
        result={result}
        width={width}
        height={height}
        insets={insets}
        wide={wide}
        panesBox={panesBox}
      />

      <View
        style={[styles.panes, wide && styles.panesWide]}
        onLayout={(e) =>
          setPanesBox({ y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height })
        }
      >
        <View style={[styles.pane, styles.editorPane]}>
          <Text style={styles.paneLabel}>原稿</Text>
          <TextInput
            value={source}
            onChangeText={setSource}
            multiline
            autoCorrect={false}
            autoCapitalize="none"
            spellCheck={false}
            style={styles.editor}
            textAlignVertical="top"
          />
        </View>

        <View style={[styles.pane, styles.previewPane, wide && styles.previewPaneWide]}>
          <Text style={styles.paneLabel}>
            プレビュー{result ? ` · ${result.slideCount} 枚` : ''}
          </Text>
          <ScrollView contentContainerStyle={styles.previewBody}>
          {error && (
            <View style={[styles.diag, styles.critical]}>
              <Text style={styles.diagLabel}>変換に失敗しました</Text>
              <Text style={styles.diagText}>{error}</Text>
            </View>
          )}
          {result?.diagnostics.map((d, i) => (
            <DiagnosticRow key={i} diagnostic={d} />
          ))}
            {result?.slides.map((s) => <SlideCard key={s.index} slide={s} />)}
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

const TITLE_PLACEHOLDERS = ['title', 'ctrTitle'];

function SlideCard({ slide }: { slide: SlideOutline }) {
  return (
    <View style={styles.slide}>
      <View style={styles.slideHead}>
        <Text style={styles.slideNum}>{slide.index}</Text>
        <Text style={styles.slideLayout}>{slide.layout ?? 'レイアウト不明'}</Text>
      </View>
      {slide.shapes.length === 0 ? (
        <Text style={styles.slideEmpty}>（テキストなし）</Text>
      ) : (
        slide.shapes.map((shape, si) => (
          <ShapeBlock key={si} shape={shape} first={si === 0} />
        ))
      )}
    </View>
  );
}

function ShapeBlock({ shape, first }: { shape: SlideShape; first: boolean }) {
  const isTitle = !!shape.placeholder && TITLE_PLACEHOLDERS.includes(shape.placeholder);

  // 番号付きリストは連番を振り直す。番号でない段落を挟んだら 1 に戻す
  let counter = 0;
  const numbers = shape.paragraphs.map((p) => (p.bullet === 'number' ? ++counter : (counter = 0)));

  return (
    <View style={first ? undefined : styles.shapeGap}>
      {shape.paragraphs.map((p, pi) => (
        <ParagraphRow key={pi} paragraph={p} isTitle={isTitle} ordinal={numbers[pi]} />
      ))}
    </View>
  );
}

function bulletGlyph(p: Paragraph, ordinal: number): string | null {
  if (p.bullet === 'none') return null;
  if (p.bullet === 'number') return ordinal + '.';
  return p.level > 0 ? '◦' : '•';
}

function ParagraphRow({
  paragraph,
  isTitle,
  ordinal,
}: {
  paragraph: Paragraph;
  isTitle: boolean;
  ordinal: number;
}) {
  // タイトルプレースホルダには行頭記号を出さない
  const glyph = isTitle ? null : bulletGlyph(paragraph, ordinal);
  return (
    <View style={[styles.para, { paddingLeft: paragraph.level * 18 }]}>
      {glyph !== null && <Text style={styles.bullet}>{glyph}</Text>}
      <Text style={[styles.paraText, isTitle && styles.titleText]}>
        {paragraph.runs.map((run, ri) => (
          <Text key={ri} style={runStyle(run)}>
            {run.text}
          </Text>
        ))}
      </Text>
    </View>
  );
}

function runStyle(run: TextRun): StyleProp<TextStyle> {
  return [
    run.bold && styles.bold,
    run.italic && styles.italic,
    run.underline && styles.underline,
    run.mono && styles.mono,
  ];
}

const VERSION = Constants.expoConfig?.version ?? '?';

interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

function HeaderBar({
  status,
  busy,
  result,
  width,
  height,
  insets,
  wide,
  panesBox,
}: {
  status: BootStatus;
  busy: boolean;
  result: ConvertResult | null;
  width: number;
  height: number;
  insets: Insets;
  wide: boolean;
  panesBox: { y: number; h: number } | null;
}) {
  let text: string;
  switch (status.phase) {
    case 'idle':
      text = '起動中';
      break;
    case 'loading': {
      const mb = (status.loadedBytes / 1048576).toFixed(1);
      const total = status.totalBytes ? ' / ' + (status.totalBytes / 1048576).toFixed(1) : '';
      text = 'pandoc.wasm 取得中 ' + mb + total + ' MB';
      break;
    }
    case 'instantiating':
      text = 'インスタンス化中';
      break;
    case 'ready':
      text = '起動 ' + status.bootMs + ' ms / ヒープ ' + status.heapMB + ' MB';
      break;
    case 'error':
      text = '起動に失敗: ' + status.message;
      break;
  }

  return (
    <View style={[styles.header, status.phase === 'error' && styles.headerError]}>
      <Text style={styles.wordmark}>Morpho</Text>
      {/* 実機でしか出ない位置ずれの切り分け用。数値をそのまま出す */}
      <Text style={styles.version}>
        {VERSION} · {Math.round(width)}×{Math.round(height)} ·{' '}
        {wide ? '二画面' : '一画面'} · 余白 {Math.round(insets.top)}/
        {Math.round(insets.bottom)}/{Math.round(insets.left)}/{Math.round(insets.right)}
        {panesBox ? ` · 本体 y${Math.round(panesBox.y)} h${Math.round(panesBox.h)}` : ''}
      </Text>
      <Text style={styles.statusText} numberOfLines={1}>
        {text}
      </Text>
      {busy && <ActivityIndicator size="small" />}
      {result && !busy && (
        <Text style={styles.statusMetric}>
          {result.ms} ms · {(result.bytes / 1024).toFixed(0)} KB
        </Text>
      )}
    </View>
  );
}

function DiagnosticRow({ diagnostic }: { diagnostic: Diagnostic }) {
  const tone =
    diagnostic.kind === 'critical'
      ? styles.critical
      : diagnostic.kind === 'design'
        ? styles.design
        : styles.info;
  return (
    <View style={[styles.diag, tone]}>
      <Text style={styles.diagLabel}>
        {diagnostic.label}
        {diagnostic.count > 1 ? ' ×' + diagnostic.count : ''}
      </Text>
      <Text style={styles.diagHint}>{diagnostic.hint}</Text>
      <Text style={styles.diagText} numberOfLines={3}>
        {diagnostic.text}
      </Text>
    </View>
  );
}

const RULE = '#BFC4CD';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#E6E8EC' },
  panes: { flex: 1 },
  panesWide: { flexDirection: 'row' },
  pane: { flex: 1 },
  editorPane: { backgroundColor: '#F7F8FA' },
  previewPane: { borderTopWidth: 1, borderTopColor: RULE },
  previewPaneWide: { borderTopWidth: 0, borderLeftWidth: 1, borderLeftColor: RULE },

  paneLabel: {
    fontSize: 11,
    letterSpacing: 0.6,
    color: '#666C78',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 6,
  },

  editor: {
    flex: 1,
    paddingHorizontal: 20,
    paddingBottom: 20,
    fontSize: 17,
    lineHeight: 27,
    color: '#14161B',
    fontFamily: 'Menlo',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: RULE,
    backgroundColor: '#F7F8FA',
  },
  headerError: { backgroundColor: '#F6E4E8' },
  wordmark: { fontSize: 16, fontWeight: '700', color: '#14161B', letterSpacing: 0.2 },
  version: { fontSize: 11, color: '#666C78', fontVariant: ['tabular-nums'] },
  statusText: { flex: 1, fontSize: 13, color: '#666C78' },
  statusMetric: { fontSize: 13, color: '#1B3FE0', fontVariant: ['tabular-nums'] },

  previewBody: { paddingHorizontal: 20, paddingBottom: 24, gap: 12 },

  diag: { padding: 12, borderRadius: 8, borderLeftWidth: 4, backgroundColor: '#F7F8FA' },
  critical: { borderLeftColor: '#B01030' },
  design: { borderLeftColor: '#A8730A' },
  info: { borderLeftColor: '#BFC4CD' },
  diagLabel: { fontSize: 13, fontWeight: '600', color: '#14161B' },
  diagHint: { fontSize: 12, color: '#666C78', marginTop: 2 },
  diagText: { fontSize: 11, color: '#666C78', marginTop: 6, fontFamily: 'Menlo' },

  slide: {
    padding: 16,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: RULE,
  },
  slideHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  slideNum: { fontSize: 11, color: '#FFFFFF', backgroundColor: '#1B3FE0', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, overflow: 'hidden' },
  slideLayout: { fontSize: 11, color: '#666C78' },
  slideEmpty: { fontSize: 12, color: '#666C78', fontStyle: 'italic' },

  shapeGap: { marginTop: 8 },
  para: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 3 },
  bullet: { fontSize: 15, lineHeight: 24, color: '#666C78', width: 18 },
  paraText: { flex: 1, fontSize: 15, lineHeight: 24, color: '#14161B' },
  titleText: { fontSize: 19, fontWeight: '600', lineHeight: 28 },

  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  underline: { textDecorationLine: 'underline' },
  mono: { fontFamily: 'Menlo', fontSize: 14, backgroundColor: '#E6E8EC' },
});
