import React from 'react';
import { Alert, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { DocMeta } from '../store/documents';

const two = (n: number) => String(n).padStart(2, '0');
const stamp = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}/${two(d.getMonth() + 1)}/${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
};

export function DocumentsModal({
  visible,
  docs,
  activeId,
  onSelect,
  onCreate,
  onImport,
  onDelete,
  onClose,
}: {
  visible: boolean;
  docs: DocMeta[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onImport: () => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const confirmDelete = (doc: DocMeta) => {
    Alert.alert('削除しますか？', `「${doc.title}」を削除します。取り消せません。`, [
      { text: 'キャンセル', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: () => onDelete(doc.id) },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.head}>
            <Text style={styles.title}>書類</Text>
            <Pressable style={styles.headBtn} onPress={onImport}>
              <Text style={styles.headBtnText}>読み込み</Text>
            </Pressable>
            <Pressable style={[styles.headBtn, styles.headBtnPrimary]} onPress={onCreate}>
              <Text style={[styles.headBtnText, styles.headBtnPrimaryText]}>新規</Text>
            </Pressable>
          </View>

          <FlatList
            data={docs}
            keyExtractor={(d) => d.id}
            style={styles.list}
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [
                  styles.row,
                  item.id === activeId && styles.rowActive,
                  pressed && styles.rowPressed,
                ]}
                onPress={() => onSelect(item.id)}
              >
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.rowDate}>{stamp(item.updatedAt)}</Text>
                </View>
                <Pressable hitSlop={8} onPress={() => confirmDelete(item)}>
                  <Text style={styles.rowDelete}>削除</Text>
                </Pressable>
              </Pressable>
            )}
            ListEmptyComponent={<Text style={styles.empty}>書類はまだありません</Text>}
          />

          <Text style={styles.note}>
            書類はこの端末のアプリ内に保存されます。バックアップは「書き出し」から
            .md を Files / iCloud へ保存してください。
          </Text>
          <Pressable style={styles.cancel} onPress={onClose}>
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
    maxWidth: 480,
    maxHeight: '80%',
    borderRadius: 14,
    backgroundColor: '#F7F8FA',
    borderWidth: 1,
    borderColor: RULE,
    overflow: 'hidden',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  title: { flex: 1, fontSize: 13, color: '#666C78' },
  headBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: RULE,
  },
  headBtnPrimary: { backgroundColor: '#1B3FE0', borderColor: '#1B3FE0' },
  headBtnText: { fontSize: 14, color: '#14161B' },
  headBtnPrimaryText: { color: '#FFFFFF', fontWeight: '600' },
  list: { flexGrow: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: RULE,
  },
  rowActive: { backgroundColor: '#E9EDFB' },
  rowPressed: { backgroundColor: '#E6E8EC' },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 16, color: '#14161B', fontWeight: '600' },
  rowDate: { fontSize: 12, color: '#666C78', marginTop: 2, fontVariant: ['tabular-nums'] },
  rowDelete: { fontSize: 13, color: '#B01030' },
  empty: { padding: 20, fontSize: 14, color: '#666C78', textAlign: 'center' },
  note: {
    fontSize: 12,
    color: '#666C78',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: RULE,
    lineHeight: 18,
  },
  cancel: { alignItems: 'center', paddingVertical: 12, borderTopWidth: 1, borderTopColor: RULE },
  cancelText: { fontSize: 15, color: '#1B3FE0' },
});
