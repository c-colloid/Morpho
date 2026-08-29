import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { DecorationShape, DeckInfo, SlideDecoration } from '../converter/types';
import type { DecorGroup } from '../store/designs';
import {
  PRESETS, SHAPE_PRESETS, decorationColorHex, nudge, type PresetKind,
} from '../design/presets';
import { sanitizeDecorText } from '../design/designFile';
import { clampPt, type TextSizes } from '../design/textSizes';

const SCHEMES = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'] as const;

/** 図形切り替え行の表示（DecorationShape 全種） */
const SHAPE_GLYPHS: Array<{ shape: DecorationShape; glyph: string }> = [
  { shape: 'rect', glyph: '▬' },
  { shape: 'roundRect', glyph: '▢' },
  { shape: 'ellipse', glyph: '●' },
  { shape: 'triangle', glyph: '▲' },
  { shape: 'diamond', glyph: '◆' },
  { shape: 'hexagon', glyph: '⬡' },
  { shape: 'star5', glyph: '★' },
  { shape: 'rightArrow', glyph: '➜' },
];

const SHAPE_NAMES: Record<DecorationShape, string> = {
  rect: '矩形',
  roundRect: '角丸',
  ellipse: '丸',
  triangle: '三角',
  diamond: 'ひし形',
  hexagon: '六角形',
  star5: '星',
  rightArrow: '矢印',
};

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
  markedIds,
  onToggleMark,
  groups,
  onGroupMarked,
  onUngroup,
  onAdd,
  onUpdate,
  onRemove,
  onDuplicate,
  onReorder,
  onCopyToAll,
  textSizes,
  onUpdateTextSizes,
  onExportDesign,
  onImportDesign,
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
  /** グループ化のための複数マーク */
  markedIds: Set<string>;
  onToggleMark: (id: string) => void;
  /** このスライドのグループ */
  groups: DecorGroup[];
  onGroupMarked: () => void;
  onUngroup: (groupId: string) => void;
  onAdd: (kind: PresetKind) => void;
  onUpdate: (d: SlideDecoration) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  onReorder: (id: string, dir: 'back' | 'front') => void;
  onCopyToAll: () => void;
  /** 文書全体の文字サイズ設定（pt）。undefined = テンプレート既定 */
  textSizes: TextSizes | undefined;
  onUpdateTextSizes: (t: TextSizes | undefined) => void;
  /** 文書全体のデザインを .morphodesign として共有シートへ */
  onExportDesign: () => void;
  /** .morphodesign を読み込んで文書全体のデザインを置き換える */
  onImportDesign: () => void;
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
    `${i + 1}. ${SHAPE_NAMES[d.shape] ?? d.shape}${d.text ? `「${d.text}」` : ''} · ` +
    `${Math.round((d.w / slideW) * 100)}×${Math.round((d.h / slideH) * 100)}%`;

  return (
    <Animated.View
      style={[styles.panel, { transform: [{ translateX: pan.x }, { translateY: pan.y }] }]}
      pointerEvents="box-none"
    >
      <View style={styles.panelBody}>
        <View style={styles.titleBar} {...responder.panHandlers}>
          <Text style={styles.grip}>⠿</Text>
          <Text style={styles.title}>
            {contentIndex === 0 ? '表紙' : `スライド ${contentIndex}`} の装飾
          </Text>
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
            {SHAPE_PRESETS.map((p) => (
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
                <Pressable hitSlop={6} onPress={() => onToggleMark(d.id)}>
                  <Text style={[styles.mark, markedIds.has(d.id) && styles.markOn]}>
                    {markedIds.has(d.id) ? '●' : '○'}
                  </Text>
                </Pressable>
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
                <Text style={styles.itemLabel}>
                  {label(d, i)}
                  {(() => {
                    const gi = groups.findIndex((g) => g.memberIds.includes(d.id));
                    return gi >= 0 ? `  G${gi + 1}` : '';
                  })()}
                </Text>
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
                  <View style={styles.swatchLine}>
                    <Text style={styles.swatchLabel}>形</Text>
                    {SHAPE_GLYPHS.map((s) => (
                      <Pressable
                        key={s.shape}
                        style={[styles.shapeBtn, d.shape === s.shape && styles.shapeOn]}
                        onPress={() => onUpdate({ ...d, shape: s.shape })}
                      >
                        <Text style={styles.shapeGlyph}>{s.glyph}</Text>
                      </Pressable>
                    ))}
                  </View>

                  <View style={styles.swatchLine}>
                    <Text style={styles.swatchLabel}>塗り</Text>
                    {SCHEMES.map((s) => (
                      <Pressable
                        key={s}
                        style={[
                          styles.swatch,
                          { backgroundColor: colors[s] ?? '#888888' },
                          !d.noFill && d.color.scheme === s && styles.swatchOn,
                        ]}
                        onPress={() => {
                          const { noFill: _n, ...rest } = d;
                          onUpdate({ ...rest, color: { scheme: s } });
                        }}
                      />
                    ))}
                    <Pressable
                      style={[styles.noFillChip, d.noFill && styles.swatchOn]}
                      onPress={() => {
                        if (d.noFill) {
                          const { noFill: _n, ...rest } = d;
                          onUpdate(rest);
                        } else {
                          /* 塗りも枠も無いと見えなくなるので、枠線を伴わせる */
                          onUpdate({
                            ...d,
                            noFill: true,
                            line: d.line ?? { color: d.color, widthPt: 1 },
                          });
                        }
                      }}
                    >
                      <Text style={styles.noFillText}>なし</Text>
                    </Pressable>
                  </View>

                  {d.text != null ? (
                    <View style={styles.textRow}>
                      <Text style={styles.stepperLabel}>テキスト</Text>
                      <TextInput
                        key={d.id}
                        style={styles.textInput}
                        defaultValue={d.text}
                        maxLength={20}
                        onChangeText={(t) => onUpdate({ ...d, text: sanitizeDecorText(t) })}
                        placeholder="1"
                      />
                      <Pressable
                        hitSlop={6}
                        onPress={() => {
                          const { text: _t, ...rest } = d;
                          onUpdate(rest);
                        }}
                      >
                        <Text style={styles.itemTool}>✕</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable
                      style={styles.removeBtn}
                      onPress={() => onUpdate({ ...d, text: '' })}
                    >
                      <Text style={styles.ungroupText}>テキストを追加</Text>
                    </Pressable>
                  )}

                  <Stepper
                    label={`不透明度 ${d.opacity}%`}
                    onDec={() => onUpdate({ ...d, opacity: Math.max(5, d.opacity - 5) })}
                    onInc={() => onUpdate({ ...d, opacity: Math.min(100, d.opacity + 5) })}
                  />
                  <Stepper
                    label={`枠線 ${d.line ? `${d.line.widthPt}pt` : 'なし'}`}
                    onDec={() => {
                      if (!d.line) return;
                      const w = Math.round((d.line.widthPt - 0.5) * 2) / 2;
                      if (w <= 0) {
                        /* 枠を消すとき、塗りなしのままだと見えなくなるので塗りも戻す */
                        const { line: _l, noFill: _n, ...rest } = d;
                        onUpdate(rest);
                      } else {
                        onUpdate({ ...d, line: { ...d.line, widthPt: w } });
                      }
                    }}
                    onInc={() => {
                      const w = Math.min(12, Math.round(((d.line?.widthPt ?? 0) + 0.5) * 2) / 2);
                      onUpdate({ ...d, line: { color: d.line?.color ?? d.color, widthPt: w } });
                    }}
                  />
                  {d.line && (
                    <View style={styles.swatchLine}>
                      <Text style={styles.swatchLabel}>枠色</Text>
                      {SCHEMES.map((s) => (
                        <Pressable
                          key={s}
                          style={[
                            styles.swatch,
                            { backgroundColor: colors[s] ?? '#888888' },
                            d.line?.color.scheme === s && styles.swatchOn,
                          ]}
                          onPress={() =>
                            onUpdate({ ...d, line: { ...d.line!, color: { scheme: s } } })
                          }
                        />
                      ))}
                    </View>
                  )}
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

                  {(() => {
                    const g = groups.find((x) => x.memberIds.includes(d.id));
                    return g ? (
                      <Pressable style={styles.removeBtn} onPress={() => onUngroup(g.id)}>
                        <Text style={styles.ungroupText}>グループ解除</Text>
                      </Pressable>
                    ) : null;
                  })()}
                  <Pressable style={styles.removeBtn} onPress={() => onRemove(d.id)}>
                    <Text style={styles.removeText}>この装飾を削除</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ))}

          {markedIds.size >= 2 && (
            <Pressable style={styles.groupBtn} onPress={onGroupMarked}>
              <Text style={styles.groupText}>
                マークした {markedIds.size} 件をグループ化（一緒に動く）
              </Text>
            </Pressable>
          )}

          {decorations.length > 0 && (
            <Pressable style={styles.copyAllBtn} onPress={onCopyToAll}>
              <Text style={styles.copyAllText}>このスライドの装飾を全スライドへコピー</Text>
            </Pressable>
          )}

          <Text style={styles.section}>文字サイズ（文書全体・pt）</Text>
          {(() => {
            const defTitle = Math.round((deck?.titleSz ?? 3300) / 100);
            const defBody = Math.round((deck?.bodySz?.[0] ?? 2400) / 100);
            const title = textSizes?.titlePt ?? defTitle;
            /* 表紙は未設定なら見出しに、サブタイトルは本文に追従（OOXML の継承と同じ） */
            const cover = textSizes?.coverTitlePt ?? title;
            const body = textSizes?.bodyPt ?? defBody;
            const coverSub = textSizes?.coverSubPt ?? body;
            const upd = (patch: Partial<TextSizes>) => {
              const next: TextSizes = { ...textSizes, ...patch };
              onUpdateTextSizes(Object.keys(next).length ? next : undefined);
            };
            return (
              <>
                <Stepper
                  label={`表紙タイトル ${cover}pt`}
                  onDec={() => upd({ coverTitlePt: clampPt(cover - 1) })}
                  onInc={() => upd({ coverTitlePt: clampPt(cover + 1) })}
                />
                <Stepper
                  label={`表紙サブタイトル ${coverSub}pt`}
                  onDec={() => upd({ coverSubPt: clampPt(coverSub - 1) })}
                  onInc={() => upd({ coverSubPt: clampPt(coverSub + 1) })}
                />
                <Stepper
                  label={`見出し ${title}pt`}
                  onDec={() => upd({ titlePt: clampPt(title - 1) })}
                  onInc={() => upd({ titlePt: clampPt(title + 1) })}
                />
                <Stepper
                  label={`本文 ${body}pt`}
                  onDec={() => upd({ bodyPt: clampPt(body - 1) })}
                  onInc={() => upd({ bodyPt: clampPt(body + 1) })}
                />
                {textSizes && (
                  <Pressable
                    style={styles.removeBtn}
                    onPress={() => onUpdateTextSizes(undefined)}
                  >
                    <Text style={styles.ungroupText}>文字サイズを既定に戻す</Text>
                  </Pressable>
                )}
              </>
            );
          })()}

          <View style={styles.fileRow}>
            <Pressable style={styles.fileBtn} onPress={onExportDesign}>
              <Text style={styles.fileText}>デザインを書き出す</Text>
            </Pressable>
            <Pressable style={styles.fileBtn} onPress={onImportDesign}>
              <Text style={styles.fileText}>読み込む</Text>
            </Pressable>
          </View>
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

  swatchLine: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  swatchLabel: { width: 30, fontSize: 11, color: '#666C78' },
  shapeBtn: {
    width: 29,
    height: 29,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: RULE,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shapeOn: { borderWidth: 2, borderColor: '#1B3FE0', backgroundColor: '#E9EDFB' },
  shapeGlyph: { fontSize: 14, color: '#14161B' },
  noFillChip: {
    paddingHorizontal: 7,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: RULE,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  noFillText: { fontSize: 11, color: '#14161B' },

  textRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  textInput: {
    flex: 1,
    height: 32,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: RULE,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 8,
    fontSize: 13,
    color: '#14161B',
  },

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
  ungroupText: { fontSize: 12, color: '#1B3FE0', fontWeight: '600' },

  mark: { fontSize: 14, color: '#9AA0AC', paddingHorizontal: 1 },
  markOn: { color: '#1B3FE0' },

  groupBtn: {
    marginTop: 6,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1B3FE0',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
  },
  groupText: { fontSize: 13, color: '#1B3FE0', fontWeight: '600' },

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

  fileRow: { flexDirection: 'row', gap: 6, marginTop: 10 },
  fileBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: RULE,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
  },
  fileText: { fontSize: 12, color: '#14161B' },
});
