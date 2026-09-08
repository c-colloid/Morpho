import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

/**
 * 発表者ノートの編集シート。
 * TextInput は本物の UITextView なので IME はそのまま使える
 * （本編集エリアとは別インスタンス）。空で保存するとブロックごと消える。
 * 画面中央のシートなので、ソフトキーボードが出たら KeyboardAvoidingView で
 * 上へ逃がす（iPhone では入力欄がキーボードの下に隠れる）。
 */
export function NotesEditSheet({
  visible,
  initialText,
  onSave,
  onClose,
}: {
  visible: boolean;
  initialText: string;
  onSave: (text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initialText);
  const [lastVisible, setLastVisible] = useState(false);
  if (visible !== lastVisible) {
    setLastVisible(visible);
    if (visible) setText(initialText);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.avoid}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.title}>発表者ノート</Text>
            <Text style={styles.hint}>スライドには表示されません。空で保存すると削除します。</Text>
            <TextInput
              value={text}
              onChangeText={setText}
              multiline
              autoCorrect={false}
              style={styles.input}
              textAlignVertical="top"
              placeholder="ここで話すこと"
            />
            <View style={styles.actions}>
              <Pressable style={styles.btn} onPress={onClose}>
                <Text style={styles.btnText}>キャンセル</Text>
              </Pressable>
              <Pressable style={[styles.btn, styles.btnPrimary]} onPress={() => onSave(text)}>
                <Text style={[styles.btnText, styles.btnPrimaryText]}>保存</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const RULE = '#BFC4CD';
const styles = StyleSheet.create({
  avoid: { flex: 1 },
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
    borderRadius: 14,
    backgroundColor: '#F7F8FA',
    borderWidth: 1,
    borderColor: RULE,
    padding: 16,
  },
  title: { fontSize: 15, fontWeight: '600', color: '#14161B' },
  hint: { fontSize: 12, color: '#666C78', marginTop: 4, marginBottom: 10 },
  input: {
    minHeight: 120,
    maxHeight: 240,
    borderWidth: 1,
    borderColor: RULE,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    padding: 12,
    fontSize: 15,
    lineHeight: 23,
    color: '#14161B',
  },
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
