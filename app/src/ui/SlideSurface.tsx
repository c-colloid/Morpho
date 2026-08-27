import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { DeckInfo, Paragraph, SlideOutline, SlideShape, TextRun } from '../converter/types';

/**
 * 実寸プレビュー。
 *
 * pandoc が吐いた pptx の座標（EMU）・テーマ配色・マスター既定の字サイズを
 * そのまま縮尺して描く。reveal.js などの別ライターに逃げず
 * 「実際の出力そのもの」を読むという CLAUDE.md の方針の実装。
 *
 * 限界（意図的な近似）:
 * - 行の折り返しは PowerPoint のフォントメトリクスと完全一致しない
 * - 和文フォントは OS 既定（テーマの ea は空だった）
 */

const EMU_PER_PT = 12700;
/* PowerPoint 既定のテキスト枠内余白（left/right 91440, top/bottom 45720 EMU） */
const INSET_X_PT = 7.2;
const INSET_Y_PT = 3.6;

const TITLE_KINDS = ['title', 'ctrTitle'];

export function SlideSurface({
  slide,
  deck,
  width,
}: {
  slide: SlideOutline;
  deck: DeckInfo;
  width: number;
}) {
  const slideWpt = deck.w / EMU_PER_PT;
  const slideHpt = deck.h / EMU_PER_PT;
  const scale = width / slideWpt;
  const bg = deck.colors.lt1 ?? '#FFFFFF';

  return (
    <View
      style={[
        styles.surface,
        { width, height: slideHpt * scale, backgroundColor: bg },
      ]}
    >
      {slide.shapes.map((shape, i) => (
        <ShapeBox key={i} shape={shape} deck={deck} scale={scale} />
      ))}
    </View>
  );
}

function ShapeBox({
  shape,
  deck,
  scale,
}: {
  shape: SlideShape;
  deck: DeckInfo;
  scale: number;
}) {
  if (!shape.frame) return null;
  const f = shape.frame;
  const isTitle = !!shape.placeholder && TITLE_KINDS.includes(shape.placeholder);
  const color = deck.colors.dk1 ?? '#000000';

  let counter = 0;
  const numbers = shape.paragraphs.map((p) => (p.bullet === 'number' ? ++counter : (counter = 0)));

  return (
    <View
      style={{
        position: 'absolute',
        left: (f.x / EMU_PER_PT) * scale,
        top: (f.y / EMU_PER_PT) * scale,
        width: (f.w / EMU_PER_PT) * scale,
        height: (f.h / EMU_PER_PT) * scale,
        paddingHorizontal: INSET_X_PT * scale,
        paddingVertical: INSET_Y_PT * scale,
        overflow: 'hidden',
        /* タイトルは下揃え・本文は上揃えが PowerPoint 既定に近い */
        justifyContent: isTitle ? 'flex-end' : 'flex-start',
      }}
    >
      {shape.paragraphs.map((p, pi) => (
        <SurfaceParagraph
          key={pi}
          paragraph={p}
          isTitle={isTitle}
          ordinal={numbers[pi]}
          deck={deck}
          scale={scale}
          color={color}
        />
      ))}
    </View>
  );
}

function SurfaceParagraph({
  paragraph,
  isTitle,
  ordinal,
  deck,
  scale,
  color,
}: {
  paragraph: Paragraph;
  isTitle: boolean;
  ordinal: number;
  deck: DeckInfo;
  scale: number;
  color: string;
}) {
  /* sz は 1/100pt。lvl の範囲外は最後の値に丸める */
  const szHundredths = isTitle
    ? deck.titleSz
    : deck.bodySz[Math.min(paragraph.level, deck.bodySz.length - 1)] ?? 1800;
  const fontSize = (szHundredths / 100) * scale;
  const indentPt = 18 * paragraph.level;

  const glyph =
    isTitle || paragraph.bullet === 'none'
      ? null
      : paragraph.bullet === 'number'
        ? ordinal + '.'
        : paragraph.level > 0
          ? '◦'
          : '•';

  return (
    <View style={[styles.para, { paddingLeft: indentPt * scale }]}>
      {glyph !== null && (
        <Text style={{ fontSize, lineHeight: fontSize * 1.25, color, width: fontSize * 1.1 }}>
          {glyph}
        </Text>
      )}
      <Text style={{ flex: 1, fontSize, lineHeight: fontSize * 1.25, color }}>
        {paragraph.runs.map((run, ri) => (
          <Text key={ri} style={surfaceRunStyle(run, fontSize)}>
            {run.text}
          </Text>
        ))}
      </Text>
    </View>
  );
}

function surfaceRunStyle(run: TextRun, fontSize: number) {
  return [
    run.bold && styles.bold,
    run.italic && styles.italic,
    run.underline && styles.underline,
    run.mono && { fontFamily: 'Menlo' as const, fontSize: fontSize * 0.92 },
  ];
}

const styles = StyleSheet.create({
  surface: { borderRadius: 4, overflow: 'hidden' },
  para: { flexDirection: 'row', alignItems: 'flex-start' },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  underline: { textDecorationLine: 'underline' },
});
