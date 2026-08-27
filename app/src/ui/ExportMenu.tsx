import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

export type ExportChoice = 'pptx' | 'docx' | 'md' | 'obsidian';

const ITEMS: Array<{ key: ExportChoice; label: string; note: string }> = [
  { key: 'pptx', label: 'スライド (.pptx)', note: 'PowerPoint / Keynote で開ける' },
  { key: 'docx', label: '文書 (.docx)', note: 'Word / Pages で開ける（実験的）' },
  { key: 'md', label: '原稿そのもの (.md)', note: 'Files / iCloud へ。バックアップにも使う' },
  { key: 'obsidian', label: 'Obsidian へ送る', note: '最後に開いた保管庫に新規ノートを作る（実験的）' },
];

export function ExportMenu({
  visible,
  busy,
  onSelect,
  onClose,
}: {
  visible: boolean;
  busy: ExportChoice | null;
  onSelect: (choice: ExportChoice) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={busy ? undefined : onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.title}>書き出し</Text>
          {ITEMS.map((item) => (
            <Pressable
              key={item.key}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              disabled={busy !== null}
              onPress={() => onSelect(item.key)}
            >
              <View style={styles.rowBody}>
                <Text style={styles.rowLabel}>{item.label}</Text>
                <Text style={styles.rowNote}>{item.note}</Text>
              </View>
              {busy === item.key && <Text style={styles.rowBusy}>変換中…</Text>}
            </Pressable>
          ))}
          <Pressable style={styles.cancel} disabled={busy !== null} onPress={onClose}>
            <Text style={styles.cancelText}>閉じる</Text>
          </Pressable>
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
    maxWidth: 420,
    borderRadius: 14,
    backgroundColor: '#F7F8FA',
    padding: 8,
    borderWidth: 1,
    borderColor: RULE,
  },
  title: { fontSize: 13, color: '#666C78', paddingHorizontal: 12, paddingVertical: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: RULE,
  },
  rowPressed: { backgroundColor: '#E6E8EC' },
  rowBody: { flex: 1 },
  rowLabel: { fontSize: 16, color: '#14161B', fontWeight: '600' },
  rowNote: { fontSize: 12, color: '#666C78', marginTop: 2 },
  rowBusy: { fontSize: 13, color: '#1B3FE0' },
  cancel: { alignItems: 'center', paddingVertical: 12, borderTopWidth: 1, borderTopColor: RULE },
  cancelText: { fontSize: 15, color: '#1B3FE0' },
});
