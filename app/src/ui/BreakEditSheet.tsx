import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { applyBreaks } from '../preview/lineBreakEdit.ts';

/**
 * 改行位置の編集シート。
 * 段落を文節相当の塊で表示し、塊をタップすると「その後ろで改行」を切り替える。
 * IME を壊さないため、本編集の TextInput には一切触れない。
 */
export function BreakEditSheet({
  visible,
  chunks,
  initialBreaks,
  onApply,
  onClose,
}: {
  visible: boolean;
  chunks: string[];
  initialBreaks: Set<number>;
  onApply: (text: string) => void;
  onClose: () => void;
}) {
  const [breaks, setBreaks] = useState<Set<number>>(initialBreaks);

  // visible になるたびに初期状態へ戻す
  const [lastVisible, setLastVisible] = useState(false);
  if (visible !== lastVisible) {
    setLastVisible(visible);
    if (visible) setBreaks(new Set(initialBreaks));
  }

  const toggle = (i: number) => {
    setBreaks((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  /* 改行で行に割った表示。行ごとに塊のピルを並べる */
  const lines = useMemo(() => {
    const out: Array<Array<{ text: string; index: number }>> = [[]];
    chunks.forEach((c, i) => {
      out[out.length - 1].push({ text: c, index: i });
      if (breaks.has(i) && i < chunks.length - 1) out.push([]);
    });
    return out;
  }, [chunks, breaks]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.title}>改行位置の編集</Text>
          <Text style={styles.hint}>
            言葉のまとまりをタップすると、その後ろで改行します。もう一度タップで解除。
          </Text>
          <ScrollView style={styles.body}>
            {lines.map((line, li) => (
              <View key={li} style={styles.line}>
                {line.map(({ text, index }) => {
                  const isBreak = breaks.has(index) && index < chunks.length - 1;
                  return (
                    <Pressable
                      key={index}
                      onPress={() => toggle(index)}
                      style={({ pressed }) => [
                        styles.chunk,
                        isBreak && styles.chunkBreak,
                        pressed && styles.chunkPressed,
                      ]}
                    >
                      <Text style={styles.chunkText}>
                        {text}
                        {isBreak ? ' ⏎' : ''}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </ScrollView>
          <View style={styles.actions}>
            <Pressable style={styles.btn} onPress={onClose}>
              <Text style={styles.btnText}>キャンセル</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, styles.btnPrimary]}
              onPress={() => onApply(applyBreaks(chunks, breaks))}
            >
              <Text style={[styles.btnText, styles.btnPrimaryText]}>適用</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const RULE = '#BFC4CD';
const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(20,22,27,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  sheet: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '80%',
    borderRadius: 14,
    backgroundColor: '#F7F8FA',
    borderWidth: 1,
    borderColor: RULE,
    padding: 16,
  },
  title: { fontSize: 15, fontWeight: '600', color: '#14161B' },
  hint: { fontSize: 12, color: '#666C78', marginTop: 4, marginBottom: 12 },
  body: { flexGrow: 0 },
  line: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 },
  chunk: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    margin: 2,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: RULE,
  },
  chunkBreak: { borderColor: '#1B3FE0', backgroundColor: '#E9EDFB' },
  chunkPressed: { opacity: 0.6 },
  chunkText: { fontSize: 15, color: '#14161B' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 14 },
  btn: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: RULE,
  },
  btnPrimary: { backgroundColor: '#1B3FE0', borderColor: '#1B3FE0' },
  btnText: { fontSize: 14, color: '#14161B' },
  btnPrimaryText: { color: '#FFFFFF', fontWeight: '600' },
});
