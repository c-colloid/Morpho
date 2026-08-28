import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { DeckInfo, SlideDecoration } from '../converter/types';
import { PRESETS, decorationColorHex, nudge, type PresetKind } from '../design/presets';

const SCHEMES = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'] as const;

const PANEL_W = 336;

/**
 * 装飾の編集パネル（補助機能）。
 *
 * モーダルではなく**動かせるフローティングパネル**。プレビューを覆わないので、
 * 背面のスライドを見ながら微調整できる。タイトルバーをドラッグで移動。
 * プリセットから追加し、テーマ配色のスウォッチと 1% 刻みの微調整で整える。
 * 生の座標や色コードをユーザーに触らせない。
 */
export function DecorSheet({
  visible,
  contentIndex,
  decorations,
  deck,
  selectedId,
  onSelectItem,
  onAdd,
  onUpdate,
  onRemove,
  onDuplicate,
  onReorder,
  onCopyToAll,
  onClose,
}: {
  visible: boolean;
  /** 対象のコンテンツスライド番号（1 始まり） */
  contentIndex: number;
  /** そのスライドの装飾（配列順 = 背面から前面） */
  decorations: SlideDecoration[];
  deck: DeckInfo | null;
  /** 選択はプレビュー上の直接操作と共有（親が持つ） */
  selectedId: string | null;
  onSelectItem: (id: string | null) => void;
  onAdd: (kind: PresetKind) => void;
  onUpdate: (d: SlideDecoration) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  onReorder: (id: string, dir: 'back' | 'front') => void;
  onCopyToAll: () => void;
  onClose: () => void;
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  /* パネル位置。座標系は EditorScreen のルート View（セーフエリア内）なので、
     クランプは window からインセットを引いた有効領域で行う。
     ドラッグ中は Animated 値だけを動かして再描画を起こさない。
     位置は開き直しても前回の場所を保つ */
  const availRef = useRef({ w: winW, h: winH });
  availRef.current = {
    w: winW - insets.left - insets.right,
    h: winH - insets.top - insets.bottom,
  };
  const clamp = (p: { x: number; y: number }) => ({
    x: Math.max(0, Math.min(availRef.current.w - PANEL_W, p.x)),
    y: Math.max(0, Math.min(availRef.current.h - 120, p.y)),
  });
  const posRef = useRef({ x: 16, y: 96 });
  const pan = useRef(new Animated.ValueXY(posRef.current)).current;
  /* ScrollView の高さ計算用。ドラッグ確定時にだけ state へ反映する */
  const [committedY, setCommittedY] = useState(posRef.current.y);
  const dragStart = useRef({ x: 0, y: 0 });
  const commit = () => setCommittedY(posRef.current.y);
  const responder = useRef(
    PanResponder.create({
      /* タップは子（✕ 等）に渡し、数 px 動いてからドラッグ扱いにする */
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) + Math.abs(g.dy) > 4,
      onPanResponderGrant: () => {
        dragStart.current = posRef.current;
      },
      onPanResponderMove: (_e, g) => {
        const p = clamp({
          x: dragStart.current.x + g.dx,
          y: dragStart.current.y + g.dy,
        });
        posRef.current = p;
        pan.setValue(p);
      },
      onPanResponderRelease: commit,
      onPanResponderTerminate: commit,
    }),
  ).current;

  /* 画面回転などでパネルが画面外に残らないようにする */
  useEffect(() => {
    const p = clamp(posRef.current);
    posRef.current = p;
    pan.setValue(p);
    setCommittedY(p.y);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winW, winH, insets.left, insets.right, insets.top, insets.bottom]);

  if (!visible) return null;

  const colors = deck?.colors ?? {};
  const slideW = deck?.w ?? 9144000;
  const slideH = deck?.h ?? 5143500;
  const selected = decorations.find((d) => d.id === selectedId) ?? null;

  const label = (d: SlideDecoration, i: number) =>
    `${i + 1}. ${d.shape === 'roundRect' ? '角丸' : '矩形'} · ` +
    `${Math.round((d.w / slideW) * 100)}×${Math.round((d.h / slideH) * 100)}%`;

  return (
    <Animated.View
      style={[styles.panel, { transform: [{ translateX: pan.x }, { translateY: pan.y }] }]}
      pointerEvents="box-none"
    >
      <View style={styles.panelBody}>
        <View style={styles.titleBar} {...responder.panHandlers}>
          <Text style={styles.grip}>⠿</Text>
          <Text style={styles.title}>スライド {contentIndex} の装飾</Text>
          <Pressable hitSlop={10} onPress={onClose}>
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>

        <ScrollView
          style={[
            styles.scroll,
            { maxHeight: Math.max(160, availRef.current.h - committedY - 64) },
          ]}
          contentContainerStyle={styles.scrollBody}
        >
          <Text style={styles.section}>追加（プリセット）</Text>
          <View style={styles.presetRow}>
            {PRESETS.map((p) => (
              <Pressable key={p.kind} style={styles.presetBtn} onPress={() => onAdd(p.kind)}>
                <Text style={styles.presetLabel}>{p.label}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.section}>
            配置済み{decorations.length ? `（${decorations.length}・下ほど前面）` : '（なし）'}
          </Text>
          {decorations.map((d, i) => (
            <View key={d.id} style={styles.item}>
              <Pressable
                style={styles.itemHead}
                onPress={() => onSelectItem(selectedId === d.id ? null : d.id)}
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
                <Pressable hitSlop={6} onPress={() => onReorder(d.id, 'back')}>
                  <Text style={styles.itemTool}>↑</Text>
                </Pressable>
                <Pressable hitSlop={6} onPress={() => onReorder(d.id, 'front')}>
                  <Text style={styles.itemTool}>↓</Text>
                </Pressable>
                <Pressable hitSlop={6} onPress={() => onDuplicate(d.id)}>
                  <Text style={styles.itemTool}>⧉</Text>
                </Pressable>
                <Text style={styles.itemToggle}>{selectedId === d.id ? '▾' : '▸'}</Text>
              </Pressable>

              {selected?.id === d.id && (
                <View style={styles.controls}>
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

          {decorations.length > 0 && (
            <Pressable style={styles.copyAllBtn} onPress={onCopyToAll}>
              <Text style={styles.copyAllText}>このスライドの装飾を全スライドへコピー</Text>
            </Pressable>
          )}
        </ScrollView>
      </View>
    </Animated.View>
  );
}

/** 長押しで連続変化するステッパー（350ms 後から 90ms 間隔） */
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
      <RepeatButton text="−" onStep={onDec} />
      <RepeatButton text="＋" onStep={onInc} />
    </View>
  );
}

function RepeatButton({ text, onStep }: { text: string; onStep: () => void }) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  /* onStep は毎レンダーで変わり得るので ref で最新を持つ（連打中も最新の状態に効かせる） */
  const stepRef = useRef(onStep);
  stepRef.current = onStep;

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);

  return (
    <Pressable
      style={styles.stepBtn}
      onPress={() => stepRef.current()}
      onLongPress={() => {
        timer.current = setInterval(() => stepRef.current(), 90);
      }}
      onPressOut={stop}
      delayLongPress={350}
    >
      <Text style={styles.stepText}>{text}</Text>
    </Pressable>
  );
}

const RULE = '#BFC4CD';
const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: PANEL_W,
    zIndex: 40,
  },
  panelBody: {
    borderRadius: 12,
    backgroundColor: '#F7F8FA',
    borderWidth: 1,
    borderColor: RULE,
    overflow: 'hidden',
    /* 浮いて見えるように */
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  titleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#ECEEF2',
    borderBottomWidth: 1,
    borderBottomColor: RULE,
  },
  grip: { fontSize: 14, color: '#666C78' },
  title: { flex: 1, fontSize: 14, fontWeight: '600', color: '#14161B' },
  close: { fontSize: 15, color: '#666C78', paddingHorizontal: 2 },

  scroll: { flexGrow: 0 },
  scrollBody: { padding: 12, paddingTop: 4 },
  section: { fontSize: 11, letterSpacing: 0.6, color: '#666C78', marginTop: 10, marginBottom: 6 },

  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  presetBtn: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: RULE,
    backgroundColor: '#FFFFFF',
  },
  presetLabel: { fontSize: 13, color: '#14161B' },

  item: {
    borderWidth: 1,
    borderColor: RULE,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    marginBottom: 6,
  },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8 },
  chip: { width: 24, height: 16, borderWidth: 1, borderColor: 'rgba(0,0,0,0.15)' },
  itemLabel: { flex: 1, fontSize: 12, color: '#14161B' },
  itemTool: { fontSize: 14, color: '#666C78', paddingHorizontal: 3 },
  itemToggle: { fontSize: 12, color: '#666C78', marginLeft: 2 },

  controls: { borderTopWidth: 1, borderTopColor: RULE, padding: 8, gap: 7 },
  swatchRow: { flexDirection: 'row', gap: 7 },
  swatch: { width: 28, height: 28, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(0,0,0,0.15)' },
  swatchOn: { borderWidth: 3, borderColor: '#14161B' },

  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepperLabel: { flex: 1, fontSize: 12, color: '#14161B' },
  stepBtn: {
    width: 38,
    height: 30,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: RULE,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { fontSize: 16, color: '#14161B' },

  removeBtn: { alignSelf: 'flex-start', marginTop: 2 },
  removeText: { fontSize: 12, color: '#B01030', fontWeight: '600' },

  copyAllBtn: {
    marginTop: 6,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1B3FE0',
    backgroundColor: '#E9EDFB',
    alignItems: 'center',
  },
  copyAllText: { fontSize: 13, color: '#1B3FE0', fontWeight: '600' },
});
