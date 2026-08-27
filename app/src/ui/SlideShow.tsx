import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import type { ConvertResult } from '../converter/types';
import { SlideSurface } from './SlideSurface';

const two = (n: number) => String(n).padStart(2, '0');

/**
 * 全画面スライドショー。
 * 横スワイプ（ページング）と左右端タップで送る。Keynote の操作語彙。
 * 発表者ビューはボトムシートで、ノート・次スライド・経過時間を出す。
 */
export function SlideShow({
  visible,
  result,
  initialIndex,
  onClose,
}: {
  visible: boolean;
  result: ConvertResult | null;
  initialIndex: number;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const [presenter, setPresenter] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const pagerRef = useRef<ScrollView>(null);

  /* 開いたときに現在のスライドから始め、タイマーを起こす */
  useEffect(() => {
    if (!visible) return;
    const idx = Math.max(0, Math.min(initialIndex - 1, (result?.slideCount ?? 1) - 1));
    setPage(idx);
    setStartedAt(Date.now());
    setNow(Date.now());
    requestAnimationFrame(() => pagerRef.current?.scrollTo({ x: idx * width, animated: false }));
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [visible, initialIndex, result?.slideCount, width]);

  if (!result) return null;
  const slides = result.slides;

  /* 発表者ビューぶんの高さを引いた残りにスライドを収める（16:9 レターボックス） */
  const stageH = presenter ? height * 0.62 : height;
  const ratio = result.deck.h / result.deck.w;
  const surfaceW = Math.min(width - 24, (stageH - 72) / ratio);

  const goTo = (idx: number) => {
    const clamped = Math.max(0, Math.min(idx, slides.length - 1));
    pagerRef.current?.scrollTo({ x: clamped * width, animated: true });
  };

  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  const current = slides[page];
  const next = slides[page + 1] ?? null;

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={[styles.stage, { height: stageH }]}>
          <ScrollView
            ref={pagerRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) =>
              setPage(Math.round(e.nativeEvent.contentOffset.x / width))
            }
          >
            {slides.map((s) => (
              <View key={s.index} style={[styles.pageBox, { width, height: stageH }]}>
                <SlideSurface slide={s} deck={result.deck} width={surfaceW} />
              </View>
            ))}
          </ScrollView>

          {/* 左右端タップで送る。中央は何もしない（誤送り防止） */}
          <Pressable style={[styles.tapZone, styles.tapLeft]} onPress={() => goTo(page - 1)} />
          <Pressable style={[styles.tapZone, styles.tapRight]} onPress={() => goTo(page + 1)} />

          <View style={styles.topBar}>
            <Text style={styles.pageLabel}>
              {page + 1} / {slides.length}
            </Text>
            <View style={styles.topSpace} />
            <Pressable hitSlop={10} onPress={() => setPresenter((v) => !v)}>
              <Text style={[styles.topBtn, presenter && styles.topBtnOn]}>発表者</Text>
            </Pressable>
            <Pressable hitSlop={10} onPress={onClose}>
              <Text style={styles.topBtn}>閉じる</Text>
            </Pressable>
          </View>
        </View>

        {presenter && (
          <View style={styles.presenter}>
            <View style={styles.presenterNotes}>
              <Text style={styles.presenterLabel}>ノート</Text>
              <ScrollView>
                {current.notes.length === 0 ? (
                  <Text style={styles.noteEmpty}>（このスライドにノートはありません）</Text>
                ) : (
                  current.notes.map((p, i) => (
                    <Text key={i} style={styles.noteText}>
                      {p.runs.map((r) => r.text).join('')}
                    </Text>
                  ))
                )}
              </ScrollView>
            </View>
            <View style={styles.presenterSide}>
              <Text style={styles.timer}>
                {two(Math.floor(elapsed / 60))}:{two(elapsed % 60)}
              </Text>
              <Text style={styles.presenterLabel}>次のスライド</Text>
              {next ? (
                <SlideSurface slide={next} deck={result.deck} width={200} />
              ) : (
                <Text style={styles.noteEmpty}>（最後のスライドです）</Text>
              )}
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0C0F' },
  stage: { position: 'relative' },
  pageBox: { alignItems: 'center', justifyContent: 'center' },
  tapZone: { position: 'absolute', top: 64, bottom: 0, width: '22%' },
  tapLeft: { left: 0 },
  tapRight: { right: 0 },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  pageLabel: { color: '#9AA0AC', fontSize: 14, fontVariant: ['tabular-nums'] },
  topSpace: { flex: 1 },
  topBtn: { color: '#9AA0AC', fontSize: 15 },
  topBtnOn: { color: '#FFFFFF', fontWeight: '600' },

  presenter: {
    flex: 1,
    flexDirection: 'row',
    gap: 16,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#22252C',
  },
  presenterNotes: { flex: 1 },
  presenterSide: { width: 220, gap: 8 },
  presenterLabel: { color: '#666C78', fontSize: 12, marginBottom: 6, letterSpacing: 0.6 },
  noteText: { color: '#E6E8EC', fontSize: 17, lineHeight: 27, marginBottom: 6 },
  noteEmpty: { color: '#666C78', fontSize: 14, fontStyle: 'italic' },
  timer: {
    color: '#FFFFFF',
    fontSize: 32,
    fontVariant: ['tabular-nums'],
    fontWeight: '600',
    marginBottom: 8,
  },
});
