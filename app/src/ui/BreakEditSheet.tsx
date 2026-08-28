import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { segmentChars, segmentWords } from '../preview/lineBreakEdit.ts';

/**
 * 改行位置の編集シート。
 *
 * データは「改行を置く文字オフセットの集合」。表示粒度（語 / 字）は
 * タップできる継ぎ目の細かさを変えるだけで、粒度を切り替えても
 * 設定済みの改行は失われない。
 */
export function BreakEditSheet({
  visible,
  plain,
  initialOffsets,
  onApply,
  onClose,
}: {
  visible: boolean;
  plain: string;
  initialOffsets: Set<number>;
  onApply: (offsets: Set<number>) => void;
  onClose: () => void;
}) {
  const [offsets, setOffsets] = useState<Set<number>>(initialOffsets);
  const [fine, setFine] = useState(false);

  const [lastVisible, setLastVisible] = useState(false);
  if (visible !== lastVisible) {
    setLastVisible(visible);
    if (visible) {
      setOffsets(new Set(initialOffsets));
      setFine(false);
    }
  }

  /* 現在の粒度の塊と、それぞれの末尾オフセット */
  const chunks = useMemo(
    () => (fine ? segmentChars(plain) : segmentWords(plain)),
    [plain, fine],
  );
  const chunkEnds = useMemo(() => {
    const ends: number[] = [];
    let acc = 0;
    for (const c of chunks) {
      acc += c.length;
      ends.push(acc);
    }
    return ends;
  }, [chunks]);

  const toggleAt = (offset: number) => {
    setOffsets((prev) => {
      const next = new Set(prev);
      if (next.has(offset)) next.delete(offset);
      else next.add(offset);
      return next;
    });
  };

  /* 改行で行に割った表示。塊が行をまたぐことはない（オフセットは塊の継ぎ目のみ…
     とは限らない: 粗い粒度で開いた既存の改行が塊の途中に来ることがあるので、
     行分割はオフセット優先で行い、塊はその中で刻む */
  const lines = useMemo(() => {
    const sorted = [...offsets].filter((o) => o > 0 && o < plain.length).sort((a, b) => a - b);
    const rows: Array<Array<{ text: string; end: number; isBreak: boolean }>> = [[]];
    let chunkStart = 0;
    chunks.forEach((c, i) => {
      const end = chunkEnds[i];
      // この塊の内部にある改行位置で塊を割る
      const inner = sorted.filter((o) => o > chunkStart && o < end);
      let s = chunkStart;
      for (const o of inner) {
        rows[rows.length - 1].push({ text: plain.slice(s, o), end: o, isBreak: true });
        rows.push([]);
        s = o;
      }
      const isBreak = offsets.has(end) && end < plain.length;
      rows[rows.length - 1].push({ text: plain.slice(s, end), end, isBreak });
      if (isBreak) rows.push([]);
      chunkStart = end;
    });
    return rows.filter((r) => r.length > 0);
  }, [chunks, chunkEnds, offsets, plain]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.head}>
            <Text style={styles.title}>改行位置の編集</Text>
            <View style={styles.granularity}>
              <Pressable
                style={[styles.granBtn, !fine && styles.granBtnOn]}
                onPress={() => setFine(false)}
              >
                <Text style={[styles.granText, !fine && styles.granTextOn]}>語</Text>
              </Pressable>
              <Pressable
                style={[styles.granBtn, fine && styles.granBtnOn]}
                onPress={() => setFine(true)}
              >
                <Text style={[styles.granText, fine && styles.granTextOn]}>字</Text>
              </Pressable>
            </View>
          </View>
          <Text style={styles.hint}>
            まとまりをタップすると、その後ろで改行します。「字」でどこでも置けます。
          </Text>
          <ScrollView style={styles.body}>
            {lines.map((line, li) => (
              <View key={li} style={styles.line}>
                {line.map((piece, pi) => (
                  <Pressable
                    key={pi}
                    onPress={() => toggleAt(piece.end)}
                    style={({ pressed }) => [
                      styles.chunk,
                      fine && styles.chunkFine,
                      piece.isBreak && styles.chunkBreak,
                      pressed && styles.chunkPressed,
                    ]}
                  >
                    <Text style={styles.chunkText}>
                      {piece.text}
                      {piece.isBreak ? ' ⏎' : ''}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ))}
          </ScrollView>
          <View style={styles.actions}>
            <Pressable style={styles.btn} onPress={onClose}>
              <Text style={styles.btnText}>キャンセル</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.btnPrimary]} onPress={() => onApply(offsets)}>
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
    maxWidth: 620,
    maxHeight: '80%',
    borderRadius: 14,
    backgroundColor: '#F7F8FA',
    borderWidth: 1,
    borderColor: RULE,
    padding: 16,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 15, fontWeight: '600', color: '#14161B' },
  granularity: { flexDirection: 'row', borderRadius: 8, borderWidth: 1, borderColor: RULE, overflow: 'hidden' },
  granBtn: { paddingHorizontal: 14, paddingVertical: 5, backgroundColor: '#FFFFFF' },
  granBtnOn: { backgroundColor: '#1B3FE0' },
  granText: { fontSize: 13, color: '#14161B' },
  granTextOn: { color: '#FFFFFF', fontWeight: '600' },
  hint: { fontSize: 12, color: '#666C78', marginTop: 6, marginBottom: 12 },
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
  chunkFine: { paddingHorizontal: 5, margin: 1 },
  chunkBreak: { borderColor: '#1B3FE0', backgroundColor: '#E9EDFB' },
  chunkPressed: { opacity: 0.6 },
  chunkText: { fontSize: 15, color: '#14161B' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 14 },
  btn: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 8, borderWidth: 1, borderColor: RULE },
  btnPrimary: { backgroundColor: '#1B3FE0', borderColor: '#1B3FE0' },
  btnText: { fontSize: 14, color: '#14161B' },
  btnPrimaryText: { color: '#FFFFFF', fontWeight: '600' },
});
