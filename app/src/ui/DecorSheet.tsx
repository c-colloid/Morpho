import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { DeckInfo, SlideDecoration } from '../converter/types';
import { PRESETS, decorationColorHex, nudge, type PresetKind } from '../design/presets';

const SCHEMES = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'] as const;

/**
 * 装飾の編集シート（補助機能）。
 *
 * プリセットから追加し、テーマ配色のスウォッチと 1% 刻みの微調整で整える。
 * 生の座標や色コードをユーザーに触らせない。データは呼び出し側が持ち、
 * ここは「確定済み状態の編集」だけを行う。
 */
export function DecorSheet({
  visible,
  contentIndex,
  decorations,
  deck,
  onAdd,
  onUpdate,
  onRemove,
  onClose,
}: {
  visible: boolean;
  /** 対象のコンテンツスライド番号（1 始まり） */
  contentIndex: number;
  /** そのスライドの装飾（表示順 = 背面から） */
  decorations: SlideDecoration[];
  deck: DeckInfo | null;
  onAdd: (kind: PresetKind) => void;
  onUpdate: (d: SlideDecoration) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const colors = deck?.colors ?? {};
  const slideW = deck?.w ?? 9144000;
  const slideH = deck?.h ?? 5143500;

  const selected = decorations.find((d) => d.id === selectedId) ?? null;

  const label = (d: SlideDecoration, i: number) =>
    `${i + 1}. ${d.shape === 'roundRect' ? '角丸' : '矩形'} · ` +
    `${Math.round((d.w / slideW) * 100)}×${Math.round((d.h / slideH) * 100)}%`;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.title}>スライド {contentIndex} の装飾</Text>

          <Text style={styles.section}>追加（プリセット）</Text>
          <View style={styles.presetRow}>
            {PRESETS.map((p) => (
              <Pressable key={p.kind} style={styles.presetBtn} onPress={() => onAdd(p.kind)}>
                <Text style={styles.presetLabel}>{p.label}</Text>
                <Text style={styles.presetHint}>{p.hint}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.section}>
            配置済み{decorations.length ? `（${decorations.length}）` : '（なし）'}
          </Text>
          <ScrollView style={styles.list}>
            {decorations.map((d, i) => (
              <View key={d.id} style={styles.item}>
                <Pressable
                  style={styles.itemHead}
                  onPress={() => setSelectedId(selectedId === d.id ? null : d.id)}
                >
                  <View
                    style={[
                      styles.chip,
                      {
                        backgroundColor: decorationColorHex(d.color, colors),
                        opacity: Math.max(0.15, d.opacity / 100),
                        borderRadius: d.shape === 'roundRect' ? 6 : 2,
                      },
                    ]}
                  />
                  <Text style={styles.itemLabel}>{label(d, i)}</Text>
                  <Text style={styles.itemToggle}>{selectedId === d.id ? '▾' : '▸'}</Text>
                </Pressable>

                {selected?.id === d.id && (
                  <View style={styles.controls}>
                    <Text style={styles.controlLabel}>色（テーマ配色）</Text>
                    <View style={styles.swatchRow}>
                      {SCHEMES.map((s) => (
                        <Pressable
                          key={s}
                          style={[
                            styles.swatch,
                            { backgroundColor: colors[s] ?? '#888888' },
                            d.color.scheme === s && styles.swatchOn,
                          ]}
                          onPress={() => onUpdate({ ...d, color: { scheme: s } })}
                        />
                      ))}
                    </View>

                    <Stepper
                      label={`不透明度 ${d.opacity}%`}
                      onDec={() => onUpdate({ ...d, opacity: Math.max(5, d.opacity - 5) })}
                      onInc={() => onUpdate({ ...d, opacity: Math.min(100, d.opacity + 5) })}
                    />
                    <Stepper
                      label="位置 左右"
                      onDec={() => onUpdate(nudge(d, 'x', -1, slideW, slideH))}
                      onInc={() => onUpdate(nudge(d, 'x', 1, slideW, slideH))}
                    />
                    <Stepper
                      label="位置 上下"
                      onDec={() => onUpdate(nudge(d, 'y', -1, slideW, slideH))}
                      onInc={() => onUpdate(nudge(d, 'y', 1, slideW, slideH))}
                    />
                    <Stepper
                      label="幅"
                      onDec={() => onUpdate(nudge(d, 'w', -1, slideW, slideH))}
                      onInc={() => onUpdate(nudge(d, 'w', 1, slideW, slideH))}
                    />
                    <Stepper
                      label="高さ"
                      onDec={() => onUpdate(nudge(d, 'h', -1, slideW, slideH))}
                      onInc={() => onUpdate(nudge(d, 'h', 1, slideW, slideH))}
                    />

                    <Pressable style={styles.removeBtn} onPress={() => onRemove(d.id)}>
                      <Text style={styles.removeText}>この装飾を削除</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            ))}
          </ScrollView>

          <View style={styles.actions}>
            <Pressable style={styles.btn} onPress={onClose}>
              <Text style={styles.btnText}>閉じる</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Stepper({
  label,
  onDec,
  onInc,
}: {
  label: string;
  onDec: () => void;
  onInc: () => void;
}) {
  return (
    <View style={styles.stepperRow}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <Pressable style={styles.stepBtn} onPress={onDec}>
        <Text style={styles.stepText}>−</Text>
      </Pressable>
      <Pressable style={styles.stepBtn} onPress={onInc}>
        <Text style={styles.stepText}>＋</Text>
      </Pressable>
    </View>
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
    padding: 16,
  },
  title: { fontSize: 15, fontWeight: '600', color: '#14161B' },
  section: { fontSize: 11, letterSpacing: 0.6, color: '#666C78', marginTop: 14, marginBottom: 6 },

  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  presetBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: RULE,
    backgroundColor: '#FFFFFF',
  },
  presetLabel: { fontSize: 13, fontWeight: '600', color: '#14161B' },
  presetHint: { fontSize: 11, color: '#666C78', marginTop: 1 },

  list: { flexGrow: 0 },
  item: {
    borderWidth: 1,
    borderColor: RULE,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    marginBottom: 8,
  },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10 },
  chip: { width: 28, height: 18, borderWidth: 1, borderColor: 'rgba(0,0,0,0.15)' },
  itemLabel: { flex: 1, fontSize: 13, color: '#14161B' },
  itemToggle: { fontSize: 13, color: '#666C78' },

  controls: { borderTopWidth: 1, borderTopColor: RULE, padding: 10, gap: 8 },
  controlLabel: { fontSize: 11, color: '#666C78' },
  swatchRow: { flexDirection: 'row', gap: 8 },
  swatch: { width: 30, height: 30, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(0,0,0,0.15)' },
  swatchOn: { borderWidth: 3, borderColor: '#14161B' },

  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepperLabel: { flex: 1, fontSize: 13, color: '#14161B' },
  stepBtn: {
    width: 40,
    height: 32,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: RULE,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { fontSize: 17, color: '#14161B' },

  removeBtn: { alignSelf: 'flex-start', marginTop: 4 },
  removeText: { fontSize: 13, color: '#B01030', fontWeight: '600' },

  actions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 },
  btn: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: RULE,
    backgroundColor: '#FFFFFF',
  },
  btnText: { fontSize: 14, color: '#14161B' },
});
