import React, { useRef } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';

import type { DeckInfo, SlideDecoration } from '../converter/types';
import { resizeTo } from '../design/presets';
import { moveMembersBy } from '../design/groups';

const EMU_PER_PT = 12700;
const HANDLE = 18;
/** リサイズ当たり判定の、角からの張り出し幅（外側は常にこの値。内側は要素の半分まで） */
const PAD_REACH = 18;

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
  live,
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
  /** ドラッグ中の一時値（親が保持）。当たり判定とハンドルの追従に使う */
  live: SlideDecoration[] | null;
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

  /* 選択中の要素は兄弟の最後に描く = ヒット判定の最優先。
     重なりの中でも「選んだものを動かす」が必ず通る。
     （塗りの重なり順は SlideSurface が確定値で描くので変わらない） */
  const ordered = selectedId
    ? [
        ...decorations.filter((d) => d.id !== selectedId),
        ...decorations.filter((d) => d.id === selectedId),
      ]
    : decorations;

  /* 表示位置はドラッグ中の一時値を優先（群移動では全メンバーが追従する） */
  const curOf = (d: SlideDecoration) => live?.find((x) => x.id === d.id) ?? d;
  const sel = selectedId ? decorations.find((d) => d.id === selectedId) : undefined;

  /* ハンドルの張り出し部分へのタップを飲み込まず、その位置に見えている
     装飾の選択として扱う（ヒット順は描画順 = ordered の後ろが最前面） */
  const selectAt = (x: number, y: number) => {
    for (let i = ordered.length - 1; i >= 0; i--) {
      /* 画面に見えている位置（ドラッグ中の一時値を含む）で判定する */
      const d = curOf(ordered[i]);
      const slop = d.id === selectedId ? 8 : 0;
      if (
        x >= pxOf(d.x) - slop && x <= pxOf(d.x) + pxOf(d.w) + slop &&
        y >= pxOf(d.y) - slop && y <= pxOf(d.y) + pxOf(d.h) + slop
      ) {
        onSelect(d.id);
        return;
      }
    }
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {ordered.map((d) => (
        <EditableDecor
          key={d.id}
          d={d}
          cur={curOf(d)}
          pxOf={pxOf}
          emuOf={emuOf}
          selected={selectedId === d.id}
          computeMove={computeMove}
          onSelect={onSelect}
          onLive={onLive}
          onCommit={onCommit}
        />
      ))}
      {sel && (
        <ResizeHandle
          sel={sel}
          cur={curOf(sel)}
          deck={deck}
          pxOf={pxOf}
          emuOf={emuOf}
          onLive={onLive}
          onCommit={onCommit}
          onTapAt={selectAt}
        />
      )}
    </View>
  );
}

function EditableDecor({
  d,
  cur,
  pxOf,
  emuOf,
  selected,
  computeMove,
  onSelect,
  onLive,
  onCommit,
}: {
  d: SlideDecoration;
  /** 表示・当たり判定の現在値（ドラッグ中は一時値） */
  cur: SlideDecoration;
  pxOf: (emu: number) => number;
  emuOf: (px: number) => number;
  selected: boolean;
  computeMove: (id: string, dxEmu: number, dyEmu: number) => SlideDecoration[];
  onSelect: (id: string | null) => void;
  onLive: (ds: SlideDecoration[] | null) => void;
  onCommit: (ds: SlideDecoration[]) => void;
}) {
  /* ドラッグ中の一時値は親（SlideCard）が持つ。ここは確定用に最新値だけ覚える */
  const liveRef = useRef<SlideDecoration[] | null>(null);

  /* 最新の props をレスポンダのクロージャから読む */
  const dRef = useRef(d);
  dRef.current = d;
  const emuOfRef = useRef(emuOf);
  emuOfRef.current = emuOf;
  const computeMoveRef = useRef(computeMove);
  computeMoveRef.current = computeMove;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onLiveRef = useRef(onLive);
  onLiveRef.current = onLive;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  const moved = useRef(false);

  const push = (v: SlideDecoration[] | null) => {
    liveRef.current = v;
    onLiveRef.current(v);
  };

  const bodyResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      /* 外側の ScrollView に責任を奪わせない（縦ドラッグがスクロールに化けるのを防ぐ） */
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
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
        if (!prev || !self || prev.x !== self.x || prev.y !== self.y) push(next);
      },
      onPanResponderRelease: () => {
        const v = liveRef.current;
        push(null);
        if (moved.current && v) onCommitRef.current(v);
        else onSelectRef.current(dRef.current.id); /* 動かさなかった＝タップ＝選択 */
      },
      onPanResponderTerminate: () => push(null),
    }),
  ).current;

  return (
    <View
      style={{
        position: 'absolute',
        left: pxOf(cur.x),
        top: pxOf(cur.y),
        width: pxOf(cur.w),
        height: pxOf(cur.h),
      }}
      hitSlop={selected ? { top: 8, left: 8, bottom: 8, right: 8 } : undefined}
      {...bodyResponder.panHandlers}
    >
      {selected && <View pointerEvents="none" style={styles.selection} />}
    </View>
  );
}

/**
 * リサイズハンドル。選択中の要素の右下角に置く。
 *
 * 要素の**子ではなくレイヤー直下の最後の兄弟**として描く。
 * - iOS は親 View の外側のタッチを子へ渡さないため、要素の子に置くと
 *   角からはみ出した部分が反応しない（実測）。レイヤー直下ならスライド
 *   全域が親なので、角の外側にも当たり判定を張れる
 * - 最後の兄弟 = ヒット判定の最前面。重なった他の要素に負けない
 *
 * 当たり判定は角を中心に外側へ PAD_REACH、内側へは**要素の半分まで**。
 * 小さくした要素でも本体ドラッグ（移動）の余地が必ず残る。
 */
function ResizeHandle({
  sel,
  cur,
  deck,
  pxOf,
  emuOf,
  onLive,
  onCommit,
  onTapAt,
}: {
  /** 確定値（ドラッグの基準） */
  sel: SlideDecoration;
  /** 表示位置の現在値（ドラッグ中は一時値に追従） */
  cur: SlideDecoration;
  deck: DeckInfo;
  pxOf: (emu: number) => number;
  emuOf: (px: number) => number;
  onLive: (ds: SlideDecoration[] | null) => void;
  onCommit: (ds: SlideDecoration[]) => void;
  /** 動かさなかったタップの素通し。レイヤー座標を渡す */
  onTapAt: (x: number, y: number) => void;
}) {
  const selRef = useRef(sel);
  selRef.current = sel;
  const deckRef = useRef(deck);
  deckRef.current = deck;
  const emuOfRef = useRef(emuOf);
  emuOfRef.current = emuOf;
  const onLiveRef = useRef(onLive);
  onLiveRef.current = onLive;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const onTapAtRef = useRef(onTapAt);
  onTapAtRef.current = onTapAt;

  const start = useRef(sel);
  const moved = useRef(false);
  const grantLoc = useRef({ x: 0, y: 0 });
  /* タップの素通しでレイヤー座標へ戻すために、パッドの位置を覚えておく */
  const padPos = useRef({ left: 0, top: 0 });
  const liveRef = useRef<SlideDecoration[] | null>(null);
  const push = (v: SlideDecoration[] | null) => {
    liveRef.current = v;
    onLiveRef.current(v);
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        start.current = selRef.current;
        moved.current = false;
        grantLoc.current = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY };
      },
      onPanResponderMove: (_e, g) => {
        if (Math.abs(g.dx) + Math.abs(g.dy) > 3) moved.current = true;
        if (!moved.current) return;
        const next = resizeTo(
          start.current,
          start.current.w + emuOfRef.current(g.dx),
          start.current.h + emuOfRef.current(g.dy),
          deckRef.current.w,
          deckRef.current.h,
        );
        const prev = liveRef.current?.[0];
        if (!prev || prev.w !== next.w || prev.h !== next.h) push([next]);
      },
      onPanResponderRelease: () => {
        const v = liveRef.current;
        push(null);
        if (moved.current && v) onCommitRef.current(v);
        else {
          /* 当たり判定の張り出しがタップを飲み込まないよう、
             その位置に見えている装飾の選択へ落とす */
          onTapAtRef.current(
            padPos.current.left + grantLoc.current.x,
            padPos.current.top + grantLoc.current.y,
          );
        }
      },
      onPanResponderTerminate: () => push(null),
    }),
  ).current;

  const w = pxOf(cur.w);
  const h = pxOf(cur.h);
  const inX = Math.min(PAD_REACH, w / 2);
  const inY = Math.min(PAD_REACH, h / 2);
  const cornerX = pxOf(cur.x) + w;
  const cornerY = pxOf(cur.y) + h;

  padPos.current = { left: cornerX - inX, top: cornerY - inY };

  return (
    <View
      style={{
        position: 'absolute',
        left: cornerX - inX,
        top: cornerY - inY,
        width: inX + PAD_REACH,
        height: inY + PAD_REACH,
      }}
      {...responder.panHandlers}
    >
      {/* 見た目は角中心が基本。パッドから出ると押せない場所ができるので、
          小さい要素では外側へ寄せてパッド内に収める */}
      <View
        pointerEvents="none"
        style={[
          styles.handle,
          { left: Math.max(inX - HANDLE / 2, 0), top: Math.max(inY - HANDLE / 2, 0) },
        ]}
      >
        <Text style={styles.handleGlyph}>⤡</Text>
      </View>
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
  /* 見た目のハンドル。角に中心が来るよう ResizeHandle が left/top を渡す */
  handle: {
    position: 'absolute',
    width: HANDLE,
    height: HANDLE,
    borderRadius: 4,
    backgroundColor: '#1B3FE0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleGlyph: { color: '#FFFFFF', fontSize: 10, lineHeight: 12 },
});
