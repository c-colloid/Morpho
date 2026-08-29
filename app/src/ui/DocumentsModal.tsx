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
  onOpenExternal,
  onRelink,
  onDelete,
  onClose,
}: {
  visible: boolean;
  docs: DocMeta[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onImport: () => void;
  /** 外部ファイル（Obsidian 保管庫等）をその場で開く（open in place） */
  onOpenExternal: () => void;
  /** 外部ファイルへの再接続（アクセス切れ時にファイルを選び直す） */
  onRelink: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const confirmDelete = (doc: DocMeta) => {
    const extra = doc.external ? '外部ファイル自体は削除されません。' : '';
    Alert.alert('削除しますか？', `「${doc.title}」を削除します。取り消せません。${extra}`, [
      { text: 'キャンセル', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: () => onDelete(doc.id) },
    ]);
  };

  const askRelink = (doc: DocMeta) => {
    Alert.alert(
      '外部ファイルと連携中',
      `「${doc.external?.fileName ?? ''}」へその場で上書き保存します。アプリを再起動した後は、ここからファイルを選び直すと再接続できます。`,
      [
        { text: '閉じる', style: 'cancel' },
        { text: 'ファイルを選び直す', onPress: () => onRelink(doc.id) },
      ],
    );
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
            <Pressable style={styles.headBtn} onPress={onOpenExternal}>
              <Text style={styles.headBtnText}>その場で開く</Text>
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
                  <View style={styles.rowTitleLine}>
                    {item.external && (
                      <Pressable hitSlop={6} onPress={() => askRelink(item)}>
                        <Text style={styles.extBadge}>外部</Text>
                      </Pressable>
                    )}
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                  </View>
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
            書類はこの端末のアプリ内に保存されます。「その場で開く」は Files /
            Obsidian 保管庫の .md に直接上書き保存します（アプリの再起動後は
            「外部」バッジから再接続）。バックアップは「書き出し」から。
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
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  extBadge: {
    fontSize: 11,
    color: '#1B3FE0',
    borderWidth: 1,
    borderColor: '#1B3FE0',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  rowTitle: { flexShrink: 1, fontSize: 16, color: '#14161B', fontWeight: '600' },
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
