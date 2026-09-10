import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

/**
 * ソフトキーボードの上に出す Markdown ツールバー。
 *
 * 日本語のソフトキーボードで打ちにくい構造文字を 1 タップで入れる。
 * `\` は `¥` になり（README「原稿の書き方」）、字下げの半角空白 2 つは
 * 全角空白になって箇条書きごと壊れる（実測）— どちらもここで解決する。
 *
 * 見た目だけの部品。何をどう入れるかは EditorScreen（text/editActions.ts）が決める。
 * 原稿ペインの下端に置き、ルートの下余白（useKeyboardInset）でキーボードの上に載せる
 * （iOS の InputAccessoryView は使わない。EditorScreen の説明を参照）。
 */
export type ToolbarAction =
  | 'heading'
  | 'bullet'
  | 'numbered'
  | 'indent'
  | 'outdent'
  | 'bold'
  | 'hardBreak'
  | 'slideBreak'
  | 'columns'
  | 'footer'
  | 'notes'
  | 'image';

const ITEMS: Array<{ action: ToolbarAction; glyph: string; label: string }> = [
  { action: 'heading', glyph: '#', label: '見出し' },
  { action: 'bullet', glyph: '-', label: '箇条' },
  { action: 'numbered', glyph: '1.', label: '番号' },
  { action: 'indent', glyph: '⇥', label: '字下げ' },
  { action: 'outdent', glyph: '⇤', label: '戻す' },
  { action: 'bold', glyph: '**', label: '太字' },
  { action: 'hardBreak', glyph: '\\', label: '改行' },
  { action: 'slideBreak', glyph: '***', label: '区切り' },
  { action: 'columns', glyph: '+++', label: '段組み' },
  { action: 'footer', glyph: '///', label: '出典' },
  { action: 'notes', glyph: ':::', label: 'ノート' },
  { action: 'image', glyph: '▣', label: '画像' },
];

export function MarkdownToolbar({
  onAction,
  onDismiss,
}: {
  onAction: (action: ToolbarAction) => void;
  /** キーボードを閉じる。ソフトキーボードが無い環境では渡さない */
  onDismiss?: () => void;
}) {
  return (
    <View style={styles.bar}>
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="always"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.items}
      >
        {ITEMS.map((it) => (
          <Pressable
            key={it.action}
            style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
            onPress={() => onAction(it.action)}
            accessibilityLabel={it.label}
          >
            <Text style={styles.glyph}>{it.glyph}</Text>
            <Text style={styles.label}>{it.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {onDismiss && (
        <Pressable
          style={({ pressed }) => [styles.dismiss, pressed && styles.btnPressed]}
          onPress={onDismiss}
          accessibilityLabel="キーボードを閉じる"
        >
          <Text style={styles.dismissGlyph}>⌄</Text>
        </Pressable>
      )}
    </View>
  );
}

const RULE = '#BFC4CD';
const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: '#ECEEF2',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RULE,
  },
  items: { paddingHorizontal: 6, gap: 2 },
  btn: {
    minWidth: 48,
    paddingHorizontal: 6,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  btnPressed: { backgroundColor: '#D9DDE5' },
  glyph: { fontSize: 15, lineHeight: 18, color: '#14161B', fontFamily: 'Menlo' },
  label: { fontSize: 9, lineHeight: 11, color: '#666C78', marginTop: 1 },
  dismiss: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: RULE,
  },
  dismissGlyph: { fontSize: 20, lineHeight: 22, color: '#14161B', marginTop: -6 },
});
