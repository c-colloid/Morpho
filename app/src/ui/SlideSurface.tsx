import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type {
  DeckInfo,
  Paragraph,
  SlideDecoration,
  SlideOutline,
  SlideShape,
  TextRun,
} from '../converter/types';
import Svg, { Polygon } from 'react-native-svg';

import { decorationColorHex } from '../design/presets';
import { shapePoints } from '../design/shapeGeometry';

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

/** '#RRGGBB' を透過つきの rgba() へ。想定外の書式なら素通し */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9A-Fa-f]{6})$/.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/**
 * 装飾ひとつの描画。
 *
 * - 不透明度は塗りにだけ掛ける。書き出し（a:alpha は塗りのみ、
 *   バッジ文字は不透過の白）と見た目を一致させる
 * - rect / roundRect / ellipse は View、多角形は SVG（外形は
 *   shapeGeometry の OOXML 既定 adj 近似）
 * - 枠線は中心線引き（SVG）。View 側は内側に引かれる近似
 */
function DecorBox({
  d,
  deck,
  px,
  scale,
}: {
  d: SlideDecoration;
  deck: DeckInfo;
  px: (emu: number) => number;
  scale: number;
}) {
  const w = px(d.w);
  const h = px(d.h);
  const fill = d.noFill
    ? 'transparent'
    : withAlpha(decorationColorHex(d.color, deck.colors), d.opacity / 100);
  const lineW = d.line && d.line.widthPt > 0 ? d.line.widthPt * scale : 0;
  const lineColor = d.line ? decorationColorHex(d.line.color, deck.colors) : 'transparent';
  const pts = shapePoints(d.shape, w, h);
  /* SVG は枠線の中心引きで外へはみ出すぶんだけ広げて描く */
  const pad = lineW / 2 + 1;
  return (
    <View
      style={{
        position: 'absolute',
        left: px(d.x),
        top: px(d.y),
        width: w,
        height: h,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {pts ? (
        <Svg
          pointerEvents="none"
          style={{ position: 'absolute', left: -pad, top: -pad }}
          width={w + pad * 2}
          height={h + pad * 2}
          viewBox={`${-pad} ${-pad} ${w + pad * 2} ${h + pad * 2}`}
        >
          <Polygon
            points={pts.map((p) => `${p[0]},${p[1]}`).join(' ')}
            fill={fill}
            stroke={lineW > 0 ? lineColor : 'none'}
            strokeWidth={lineW}
            strokeLinejoin="round"
          />
        </Svg>
      ) : (
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
            backgroundColor: fill,
            /* roundRect の既定半径 = 短辺の 16.67%（PowerPoint の adj 既定）。
               ellipse は短辺の半分（バッジは正円なので実質円） */
            borderRadius:
              d.shape === 'roundRect'
                ? Math.min(w, h) * 0.1667
                : d.shape === 'ellipse'
                  ? Math.min(w, h) / 2
                  : 0,
            borderWidth: lineW > 0 ? lineW : undefined,
            borderColor: lineW > 0 ? lineColor : undefined,
          }}
        />
      )}
      {d.text != null && (
        /* 書き出し（buildDecorSp）と同じ扱い: 白・太字・中央・高さの 45% */
        <Text
          style={{
            color: '#FFFFFF',
            fontWeight: '700',
            fontSize: h * 0.45,
            lineHeight: h * 0.55,
          }}
          numberOfLines={1}
        >
          {d.text}
        </Text>
      )}
    </View>
  );
}

export function SlideSurface({
  slide,
  deck,
  width,
  decorations,
  onParagraphPress,
  onParagraphLongPress,
}: {
  slide: SlideOutline;
  deck: DeckInfo;
  width: number;
  /** このスライドの装飾。本文の背面に実寸で描く（書き出しと同じ z 順） */
  decorations?: SlideDecoration[];
  /** 段落のタップ。段落は Pressable がタップを吸うので、親のタップ処理へ流すために使う */
  onParagraphPress?: () => void;
  /** 段落の長押し（改行編集の入口）。未指定なら操作なしの表示専用 */
  onParagraphLongPress?: (paragraph: Paragraph) => void;
}) {
  const slideWpt = deck.w / EMU_PER_PT;
  const slideHpt = deck.h / EMU_PER_PT;
  const scale = width / slideWpt;
  const bg = deck.colors.lt1 ?? '#FFFFFF';
  const px = (emu: number) => (emu / EMU_PER_PT) * scale;

  return (
    <View
      style={[
        styles.surface,
        { width, height: slideHpt * scale, backgroundColor: bg },
      ]}
    >
      {decorations?.map((d) => (
        <DecorBox key={d.id} d={d} deck={deck} px={px} scale={scale} />
      ))}
      {slide.shapes.map((shape, i) => (
        <ShapeBox
          key={i}
          shape={shape}
          deck={deck}
          scale={scale}
          onParagraphPress={onParagraphPress}
          onParagraphLongPress={onParagraphLongPress}
        />
      ))}
    </View>
  );
}

function ShapeBox({
  shape,
  deck,
  scale,
  onParagraphPress,
  onParagraphLongPress,
}: {
  shape: SlideShape;
  deck: DeckInfo;
  scale: number;
  onParagraphPress?: () => void;
  onParagraphLongPress?: (paragraph: Paragraph) => void;
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
      {shape.paragraphs.map((p, pi) =>
        onParagraphLongPress ? (
          <Pressable key={pi} onPress={onParagraphPress} onLongPress={() => onParagraphLongPress(p)}>
            <SurfaceParagraph
              paragraph={p}
              isTitle={isTitle}
              ordinal={numbers[pi]}
              deck={deck}
              scale={scale}
              color={color}
            />
          </Pressable>
        ) : (
          <SurfaceParagraph
            key={pi}
            paragraph={p}
            isTitle={isTitle}
            ordinal={numbers[pi]}
            deck={deck}
            scale={scale}
            color={color}
          />
        ),
      )}
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
  /* 字下げは実出力の marL / indent から。段落の上書きが無ければマスターの
     lvl 既定を継承する（pandoc 既定は marL=342900*(n+1), indent=-342900）。
     行頭記号の位置 = marL + indent なので、行の左端はその和 */
  const lvl = Math.min(paragraph.level, deck.bodyMarL.length - 1);
  const marL = paragraph.marL ?? deck.bodyMarL[lvl] ?? 0;
  const hang = paragraph.indent ?? deck.bodyIndent[lvl] ?? 0;
  const indentPt = Math.max(0, (marL + hang) / EMU_PER_PT);

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
