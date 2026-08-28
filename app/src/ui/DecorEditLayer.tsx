import React, { useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';

import type { DeckInfo, SlideDecoration } from '../converter/types';
import { resizeTo } from '../design/presets';
import { moveMembersBy } from '../design/groups';

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
  dragMembers,
  onSelect,
  onLive,
  onCommit,
}: {
  decorations: SlideDecoration[];
  deck: DeckInfo;
  width: number;
  selectedId: string | null;
  /** その装飾とともに動くメンバー ID（グループ。自分を含む） */
  dragMembers: (id: string) => string[];
  onSelect: (id: string | null) => void;
  /** ドラッグ中の一時値（null = ドラッグ終了）。保存はしない */
  onLive: (ds: SlideDecoration[] | null) => void;
  onCommit: (ds: SlideDecoration[]) => void;
}) {
  const scale = width / (deck.w / EMU_PER_PT);
  const pxOf = (emu: number) => (emu / EMU_PER_PT) * scale;
  const emuOf = (px: number) => (px / scale) * EMU_PER_PT;

  /* 群移動の計算。ドラッグ中も基準は確定値（decorations）なので ref で最新を読む */
  const decorationsRef = useRef(decorations);
  decorationsRef.current = decorations;
  const dragMembersRef = useRef(dragMembers);
  dragMembersRef.current = dragMembers;
  const computeMove = (id: string, dxEmu: number, dyEmu: number): SlideDecoration[] => {
    const members = dragMembersRef.current(id);
    const moved = moveMembersBy(
      decorationsRef.current, members, dxEmu, dyEmu, deck.w, deck.h,
    );
    return moved.filter((x) => members.includes(x.id));
  };

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
          computeMove={computeMove}
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
  computeMove,
  onSelect,
  onLive,
  onCommit,
}: {
  d: SlideDecoration;
  deck: DeckInfo;
  pxOf: (emu: number) => number;
  emuOf: (px: number) => number;
  selected: boolean;
  computeMove: (id: string, dxEmu: number, dyEmu: number) => SlideDecoration[];
  onSelect: (id: string | null) => void;
  onLive: (ds: SlideDecoration[] | null) => void;
  onCommit: (ds: SlideDecoration[]) => void;
}) {
  /* ドラッグ中のプレビュー値（群全員分）。null なら確定値（d）に当たり判定を置く */
  const [live, setLive] = useState<SlideDecoration[] | null>(null);
  const liveRef = useRef<SlideDecoration[] | null>(null);
  const setLiveBoth = (v: SlideDecoration[] | null) => {
    liveRef.current = v;
    setLive(v);
    onLive(v);
  };

  /* 最新の props をレスポンダのクロージャから読む */
  const dRef = useRef(d);
  dRef.current = d;
  const emuOfRef = useRef(emuOf);
  emuOfRef.current = emuOf;
  const computeMoveRef = useRef(computeMove);
  computeMoveRef.current = computeMove;

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
        /* グループなら全員分。基準は常に確定値なので累積誤差が出ない */
        const next = computeMoveRef.current(
          dRef.current.id,
          emuOfRef.current(g.dx),
          emuOfRef.current(g.dy),
        );
        const prev = liveRef.current?.find((x) => x.id === dRef.current.id);
        const self = next.find((x) => x.id === dRef.current.id);
        if (!prev || !self || prev.x !== self.x || prev.y !== self.y) setLiveBoth(next);
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
        const prev = liveRef.current?.[0];
        if (!prev || prev.w !== next.w || prev.h !== next.h) setLiveBoth([next]);
      },
      onPanResponderRelease: () => {
        const v = liveRef.current;
        setLiveBoth(null);
        if (moved.current && v) onCommit(v);
      },
      onPanResponderTerminate: () => setLiveBoth(null),
    }),
  ).current;

  const cur = live?.find((x) => x.id === d.id) ?? d;

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
