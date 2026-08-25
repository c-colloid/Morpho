import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import { LatestOnly } from '../converter/latestOnly';
import { splitFrontMatter } from '../converter/frontMatter';
import { usePandocConverter } from '../converter/usePandocConverter';
import type { BootStatus, ConvertResult, Diagnostic } from '../converter/types';

/** CLAUDE.md 性能設計: デッキ全体の変換は手が止まって 1.5 秒後 */
const IDLE_MS = 1500;

const SAMPLE = `---
title: "Morpho"
author: "フテイケイ"
---

# 単一ソース出版

一つの原稿から、スライド・書籍・PDF・Web を刷り分ける。

## 日本語の段落

約物（、。「」）と英数字の混植を確認します。
pandoc 3.9 の WebAssembly ビルドは wasm32-wasi をターゲットにしています。

<!-- これは HTML コメント。既定では RawBlock 警告が出ます -->

***

# 二枚目

- 箇条書き
- **太字** と *斜体*
`;

export default function EditorScreen() {
  const { element, converter, status } = usePandocConverter();
  const { width } = useWindowDimensions();
  const wide = width >= 900;

  const [source, setSource] = useState(SAMPLE);
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    <View style={[styles.root, wide && styles.rootWide]}>
      {element}

      <View style={[styles.pane, styles.editorPane]}>
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
        <StatusBar status={status} busy={busy} result={result} />
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
          {result?.slides.map((s) => (
            <View key={s.index} style={styles.slide}>
              <View style={styles.slideHead}>
                <Text style={styles.slideNum}>{s.index}</Text>
                <Text style={styles.slideLayout}>{s.layout ?? 'レイアウト不明'}</Text>
              </View>
              {s.lines.length === 0 ? (
                <Text style={styles.slideEmpty}>（テキストなし）</Text>
              ) : (
                s.lines.map((line, i) => (
                  <Text key={i} style={i === 0 ? styles.slideTitle : styles.slideLine}>
                    {line}
                  </Text>
                ))
              )}
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

function StatusBar({
  status,
  busy,
  result,
}: {
  status: BootStatus;
  busy: boolean;
  result: ConvertResult | null;
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
    <View style={[styles.statusBar, status.phase === 'error' && styles.statusBarError]}>
      <Text style={styles.statusText} numberOfLines={2}>
        {text}
      </Text>
      {busy && <ActivityIndicator size="small" />}
      {result && !busy && (
        <Text style={styles.statusMetric}>
          {result.slideCount} 枚 / {result.ms} ms / {(result.bytes / 1024).toFixed(0)} KB
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
  rootWide: { flexDirection: 'row' },
  pane: { flex: 1 },
  editorPane: { backgroundColor: '#F7F8FA' },
  previewPane: { borderTopWidth: 1, borderTopColor: RULE },
  previewPaneWide: { borderTopWidth: 0, borderLeftWidth: 1, borderLeftColor: RULE },

  editor: {
    flex: 1,
    padding: 16,
    fontSize: 15,
    lineHeight: 23,
    color: '#14161B',
    fontFamily: 'Menlo',
  },

  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: RULE,
    backgroundColor: '#F7F8FA',
  },
  statusBarError: { backgroundColor: '#F6E4E8' },
  statusText: { flex: 1, fontSize: 12, color: '#666C78' },
  statusMetric: { fontSize: 12, color: '#1B3FE0', fontVariant: ['tabular-nums'] },

  previewBody: { padding: 14, gap: 10 },

  diag: { padding: 12, borderRadius: 8, borderLeftWidth: 4, backgroundColor: '#F7F8FA' },
  critical: { borderLeftColor: '#B01030' },
  design: { borderLeftColor: '#A8730A' },
  info: { borderLeftColor: '#BFC4CD' },
  diagLabel: { fontSize: 13, fontWeight: '600', color: '#14161B' },
  diagHint: { fontSize: 12, color: '#666C78', marginTop: 2 },
  diagText: { fontSize: 11, color: '#666C78', marginTop: 6, fontFamily: 'Menlo' },

  slide: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: RULE,
  },
  slideHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  slideNum: { fontSize: 11, color: '#FFFFFF', backgroundColor: '#1B3FE0', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, overflow: 'hidden' },
  slideLayout: { fontSize: 11, color: '#666C78' },
  slideTitle: { fontSize: 15, fontWeight: '600', color: '#14161B' },
  slideLine: { fontSize: 13, color: '#14161B', marginTop: 2 },
  slideEmpty: { fontSize: 12, color: '#666C78', fontStyle: 'italic' },
});
