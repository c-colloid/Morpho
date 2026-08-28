import React, { useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';

import type { DeckInfo, SlideDecoration } from '../converter/types';
import { moveTo, resizeTo } from '../design/presets';

const EMU_PER_PT = 12700;
const HANDLE = 18;

/**
 * 装飾の直接操作レイヤー。
 *
 * 装飾パネルを開いている間だけ SlideSurface の上に重ね、装飾そのものを
 * タップで選択・ドラッグで移動・右下ハンドルでリサイズできるようにする。
 *
 * このレイヤーが描くのは**操作用の透明な当たり判定と選択枠・ハンドルだけ**。
 * 塗りは常に SlideSurface が本文の背面に描く（z 順が書き出しと一致し続ける）。
 * ドラッグ中の見た目は onLive で親へ流し、親が SlideSurface の装飾を
 * 差し替えて動かす。確定（保存）は指を離したときの onCommit のみ。
 */
export function DecorEditLayer({
  decorations,
  deck,
  width,
  selectedId,
  onSelect,
  onLive,
  onCommit,
}: {
  decorations: SlideDecoration[];
  deck: DeckInfo;
  width: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** ドラッグ中の一時値（null = ドラッグ終了）。保存はしない */
  onLive: (d: SlideDecoration | null) => void;
  onCommit: (d: SlideDecoration) => void;
}) {
  const scale = width / (deck.w / EMU_PER_PT);
  const pxOf = (emu: number) => (emu / EMU_PER_PT) * scale;
  const emuOf = (px: number) => (px / scale) * EMU_PER_PT;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {decorations.map((d) => (
        <EditableDecor
          key={d.id}
          d={d}
          deck={deck}
          pxOf={pxOf}
          emuOf={emuOf}
          selected={selectedId === d.id}
          onSelect={onSelect}
          onLive={onLive}
          onCommit={onCommit}
        />
      ))}
    </View>
  );
}

function EditableDecor({
  d,
  deck,
  pxOf,
  emuOf,
  selected,
  onSelect,
  onLive,
  onCommit,
}: {
  d: SlideDecoration;
  deck: DeckInfo;
  pxOf: (emu: number) => number;
  emuOf: (px: number) => number;
  selected: boolean;
  onSelect: (id: string | null) => void;
  onLive: (d: SlideDecoration | null) => void;
  onCommit: (d: SlideDecoration) => void;
}) {
  /* ドラッグ中のプレビュー値。null なら確定値（d）に当たり判定を置く */
  const [live, setLive] = useState<SlideDecoration | null>(null);
  const liveRef = useRef<SlideDecoration | null>(null);
  const setLiveBoth = (v: SlideDecoration | null) => {
    liveRef.current = v;
    setLive(v);
    onLive(v);
  };

  /* 最新の props をレスポンダのクロージャから読む */
  const dRef = useRef(d);
  dRef.current = d;
  const emuOfRef = useRef(emuOf);
  emuOfRef.current = emuOf;

  const start = useRef(d);
  const moved = useRef(false);

  const finish = () => {
    const v = liveRef.current;
    setLiveBoth(null);
    if (moved.current && v) onCommit(v);
    else onSelect(dRef.current.id); /* 動かさなかった＝タップ＝選択 */
  };

  const bodyResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      /* 外側の ScrollView に責任を奪わせない（縦ドラッグがスクロールに化けるのを防ぐ） */
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        start.current = dRef.current;
        moved.current = false;
      },
      onPanResponderMove: (_e, g) => {
        if (Math.abs(g.dx) + Math.abs(g.dy) > 3) moved.current = true;
        if (!moved.current) return;
        const next = moveTo(
          start.current,
          start.current.x + emuOfRef.current(g.dx),
          start.current.y + emuOfRef.current(g.dy),
          deck.w,
          deck.h,
        );
        const prev = liveRef.current;
        if (!prev || prev.x !== next.x || prev.y !== next.y) setLiveBoth(next);
      },
      onPanResponderRelease: finish,
      onPanResponderTerminate: () => setLiveBoth(null),
    }),
  ).current;

  const handleResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        start.current = dRef.current;
        moved.current = false;
      },
      onPanResponderMove: (_e, g) => {
        if (Math.abs(g.dx) + Math.abs(g.dy) > 3) moved.current = true;
        if (!moved.current) return;
        const next = resizeTo(
          start.current,
          start.current.w + emuOfRef.current(g.dx),
          start.current.h + emuOfRef.current(g.dy),
          deck.w,
          deck.h,
        );
        const prev = liveRef.current;
        if (!prev || prev.w !== next.w || prev.h !== next.h) setLiveBoth(next);
      },
      onPanResponderRelease: () => {
        const v = liveRef.current;
        setLiveBoth(null);
        if (moved.current && v) onCommit(v);
      },
      onPanResponderTerminate: () => setLiveBoth(null),
    }),
  ).current;

  const cur = live ?? d;

  return (
    <View
      style={{
        position: 'absolute',
        left: pxOf(cur.x),
        top: pxOf(cur.y),
        width: pxOf(cur.w),
        height: pxOf(cur.h),
      }}
      {...bodyResponder.panHandlers}
    >
      {selected && (
        <>
          <View pointerEvents="none" style={styles.selection} />
          <View
            style={styles.handle}
            hitSlop={{ top: 12, left: 12, bottom: 12, right: 12 }}
            {...handleResponder.panHandlers}
          >
            <Text style={styles.handleGlyph}>⤡</Text>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  selection: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderWidth: 2,
    borderColor: '#1B3FE0',
    borderRadius: 2,
  },
  handle: {
    position: 'absolute',
    right: -HANDLE / 2,
    bottom: -HANDLE / 2,
    width: HANDLE,
    height: HANDLE,
    borderRadius: 4,
    backgroundColor: '#1B3FE0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleGlyph: { color: '#FFFFFF', fontSize: 10, lineHeight: 12 },
});
