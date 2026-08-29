import React, { useMemo } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { collapseSame, diffLines, type DiffRow } from '../text/diffLines';

/**
 * 外部ファイルとアプリ内コピーの競合ダイアログ（Diff つき）。
 *
 * 行単位の差分を見せてから「どちらを使うか」を選ばせる。
 * 赤 = アプリ側にだけある行、緑 = ファイル側にだけある行。
 */
export function ConflictSheet({
  visible,
  fileName,
  appText,
  fileText,
  onUseFile,
  onUseApp,
  onClose,
}: {
  visible: boolean;
  fileName: string;
  appText: string;
  fileText: string;
  onUseFile: () => void;
  onUseApp: () => void;
  onClose: () => void;
}) {
  const rows = useMemo<DiffRow[]>(
    () => (visible ? collapseSame(diffLines(appText, fileText)) : []),
    [visible, appText, fileText],
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>内容が食い違っています</Text>
          <Text style={styles.sub} numberOfLines={1}>
            「{fileName}」とアプリ内のコピーの差分:
          </Text>
          <View style={styles.legend}>
            <Text style={[styles.legendItem, styles.appText]}>■ アプリ側のみ</Text>
            <Text style={[styles.legendItem, styles.fileText]}>■ ファイル側のみ</Text>
          </View>

          <FlatList
            style={styles.diff}
            data={rows}
            keyExtractor={(_r, i) => String(i)}
            renderItem={({ item }) =>
              item.kind === 'skip' ? (
                <Text style={styles.skip}>… 同じ内容 {item.count} 行 …</Text>
              ) : (
                <Text
                  style={[
                    styles.line,
                    item.kind === 'app' && styles.appLine,
                    item.kind === 'file' && styles.fileLine,
                  ]}
                >
                  {item.kind === 'app' ? '− ' : item.kind === 'file' ? '+ ' : '  '}
                  {item.text === '' ? ' ' : item.text}
                </Text>
              )
            }
          />

          <Pressable style={[styles.btn, styles.btnFile]} onPress={onUseFile}>
            <Text style={styles.btnFileText}>ファイル側を読み込む（緑を採用）</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.btnApp]} onPress={onUseApp}>
            <Text style={styles.btnAppText}>アプリ側でファイルを上書き（赤を採用）</Text>
          </Pressable>
          <Pressable style={styles.cancel} onPress={onClose}>
            <Text style={styles.cancelText}>あとで決める</Text>
          </Pressable>
          <Text style={styles.note}>
            あとで決めた場合、この文書を開き直したとき・アプリへ戻ったときに再度この画面が出ます。アプリ側で編集して保存した場合はファイルへ上書きされます。
          </Text>
        </View>
      </View>
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
    maxHeight: '85%',
    borderRadius: 14,
    backgroundColor: '#F7F8FA',
    borderWidth: 1,
    borderColor: RULE,
    overflow: 'hidden',
    padding: 14,
  },
  title: { fontSize: 16, fontWeight: '700', color: '#14161B' },
  sub: { fontSize: 12, color: '#666C78', marginTop: 4 },
  legend: { flexDirection: 'row', gap: 14, marginTop: 8, marginBottom: 6 },
  legendItem: { fontSize: 12 },
  appText: { color: '#B01030' },
  fileText: { color: '#0A7A3D' },

  diff: {
    flexGrow: 0,
    /* RN の既定は flexShrink 0。長い diff がボタンを押し出さないように縮める */
    flexShrink: 1,
    borderWidth: 1,
    borderColor: RULE,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    paddingVertical: 4,
  },
  line: {
    fontSize: 12,
    lineHeight: 17,
    color: '#14161B',
    paddingHorizontal: 8,
    fontVariant: ['tabular-nums'],
  },
  appLine: { backgroundColor: '#FCE8EC', color: '#8A0C26' },
  fileLine: { backgroundColor: '#E4F5EA', color: '#0A5C30' },
  skip: {
    fontSize: 11,
    color: '#9AA0AC',
    textAlign: 'center',
    paddingVertical: 3,
  },

  btn: {
    marginTop: 8,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
  },
  btnFile: { backgroundColor: '#E4F5EA', borderColor: '#0A7A3D' },
  btnFileText: { fontSize: 14, color: '#0A5C30', fontWeight: '600' },
  btnApp: { backgroundColor: '#FCE8EC', borderColor: '#B01030' },
  btnAppText: { fontSize: 14, color: '#8A0C26', fontWeight: '600' },
  cancel: { alignItems: 'center', paddingVertical: 10 },
  cancelText: { fontSize: 14, color: '#1B3FE0' },
  note: { fontSize: 11, color: '#666C78', lineHeight: 16 },
});
