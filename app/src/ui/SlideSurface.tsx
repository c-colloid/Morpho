import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import type {
  DeckInfo,
  LevelStyle,
  Paragraph,
  SlideDecoration,
  SlideOutline,
  SlideShape,
  SlideTable,
  TextRun,
} from '../converter/types';
import Svg, { Polygon } from 'react-native-svg';

import { decorationColorHex } from '../design/presets';
import { shapePoints, textRect } from '../design/shapeGeometry';

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
 * - 表は枠と列幅だけを描く。行高と罫線は出力に無い（実測）
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
      {d.text != null &&
        (() => {
          /* 書き出しと同じ配置: 図形固有のテキスト矩形（textRect）の中心に、
             折り返しなし（bodyPr wrap="none" anchorCtr="1" 相当）で置く。
             幅の広い箱を矩形中心に重ねることで折り返しを起こさない */
          const tr = textRect(d.shape, w, h);
          const wide = Math.max(w, h) * 4;
          return (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: tr.x + tr.w / 2 - wide / 2,
                top: tr.y,
                width: wide,
                height: tr.h,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
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
            </View>
          );
        })()}
    </View>
  );
}

export function SlideSurface({
  slide,
  deck,
  width,
  decorations,
  imageUriOf,
  onParagraphPress,
  onParagraphLongPress,
}: {
  slide: SlideOutline;
  deck: DeckInfo;
  width: number;
  /** このスライドの装飾。本文の背面に実寸で描く（書き出しと同じ z 順） */
  decorations?: SlideDecoration[];
  /** 画像名 → 描画用 URI（アセット保存庫）。未指定なら画像は枠だけ描く */
  imageUriOf?: (name: string) => string;
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
      {(slide.images ?? []).map((im, i) => {
        /* 実出力の xfrm どおりの位置と大きさ。stretch = a:stretch/fillRect と同じ */
        const box = {
          position: 'absolute' as const,
          left: px(im.x),
          top: px(im.y),
          width: px(im.w),
          height: px(im.h),
        };
        return imageUriOf ? (
          <Image key={'im' + i} source={{ uri: imageUriOf(im.name) }} style={box} resizeMode="stretch" />
        ) : (
          <View key={'im' + i} style={[box, styles.imageFallback]} />
        );
      })}
      {(slide.tables ?? []).map((t, i) => (
        <TableBox
          key={'tb' + i}
          table={t}
          scale={scale}
          color={deck.colors.dk1 ?? '#000000'}
          annotate={!!onParagraphLongPress}
        />
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

/**
 * 表の枠。
 *
 * 実出力に入っているのは枠の矩形・列幅・行数だけで、行高は h="0"（中身任せ）、
 * 罫線と塗りは組み込みの表スタイル参照（pandoc 既定テンプレートでは実体が
 * パッケージに無い。いずれも実測）。中身を描けるふりをせず、破線の枠と
 * 列の区切り、行×列のラベルで「ここに表がある」ことだけを示す。
 * 枠は本文プレースホルダぶんの予約で、中身の量には一切追随しない（実測）。
 */
function TableBox({
  table,
  scale,
  color,
  annotate,
}: {
  table: SlideTable;
  scale: number;
  color: string;
  /** 編集面でだけラベルを出す。スライドショーには編集用の注記を出さない */
  annotate: boolean;
}) {
  const px = (emu: number) => (emu / EMU_PER_PT) * scale;
  const line = Math.max(1, scale);
  const fontSize = Math.max(7, 12 * scale);
  /* 列の区切り位置（左端からの累積）。pandoc の列幅は 1pt 刻みに丸められ、
     合計が枠幅と一致しないことがあるので枠内へクランプする（実測） */
  const dividers: number[] = [];
  let acc = 0;
  for (let i = 0; i < table.colWidths.length - 1; i++) {
    acc += table.colWidths[i];
    dividers.push(Math.min(acc, table.w));
  }
  const label =
    table.colWidths.length > 0
      ? '表 ' + table.rowCount + '行 × ' + table.colWidths.length + '列'
      : '表 ' + table.rowCount + '行';
  const wide = px(table.w) > fontSize * (label.length + 1);
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: px(table.x),
        top: px(table.y),
        width: px(table.w),
        height: px(table.h),
        borderWidth: line,
        borderStyle: 'dashed',
        borderColor: withAlpha(color, 0.35),
      }}
    >
      {dividers.map((d, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: px(d) - line,
            top: 0,
            bottom: 0,
            width: line,
            backgroundColor: withAlpha(color, 0.18),
          }}
        />
      ))}
      {annotate && wide && (
        <Text
          numberOfLines={1}
          style={{
            margin: fontSize * 0.4,
            fontSize,
            lineHeight: fontSize * 1.25,
            color: withAlpha(color, 0.55),
          }}
        >
          {label}
        </Text>
      )}
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
  const isCover = shape.placeholder === 'ctrTitle';
  const isSub = shape.placeholder === 'subTitle';
  const color = deck.colors.dk1 ?? '#000000';

  let counter = 0;
  const numbers = shape.paragraphs.map((p) => (p.bullet === 'number' ? ++counter : (counter = 0)));

  /* 垂直アンカーは実出力の bodyPr から継承解決済み
     （pandoc 既定: タイトル=ctr、本文=無指定=上）。無指定の既定は上揃え */
  const anchored = shape.anchor === 'ctr' || shape.anchor === 'b';
  const boxH = (f.h / EMU_PER_PT) * scale;
  return (
    <View
      style={{
        position: 'absolute',
        left: (f.x / EMU_PER_PT) * scale,
        top: (f.y / EMU_PER_PT) * scale,
        width: (f.w / EMU_PER_PT) * scale,
        /* PowerPoint は枠に収まらないテキストを切らずにあふれさせるので、
           プレビューも枠では切らない（スライド端では surface が切る）。
           上揃えの枠は height でなく minHeight で伸ばす — iOS のタッチ判定は
           親の枠内に限られるため、あふれた段落も長押しできるようにする */
        ...(anchored ? { height: boxH, overflow: 'visible' as const } : { minHeight: boxH }),
        paddingHorizontal: INSET_X_PT * scale,
        paddingVertical: INSET_Y_PT * scale,
        justifyContent:
          shape.anchor === 'ctr'
            ? 'center'
            : shape.anchor === 'b'
              ? 'flex-end'
              : 'flex-start',
      }}
    >
      {shape.paragraphs.map((p, pi) =>
        onParagraphLongPress ? (
          <Pressable key={pi} onPress={onParagraphPress} onLongPress={() => onParagraphLongPress(p)}>
            <SurfaceParagraph
              paragraph={p}
              isTitle={isTitle}
              isCover={isCover}
              isSub={isSub}
              ordinal={numbers[pi]}
              lvlStyle={shape.lvlStyle}
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
            isCover={isCover}
            isSub={isSub}
            ordinal={numbers[pi]}
            lvlStyle={shape.lvlStyle}
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
  isCover,
  isSub,
  ordinal,
  lvlStyle,
  deck,
  scale,
  color,
}: {
  paragraph: Paragraph;
  isTitle: boolean;
  /** 表紙タイトル（ctrTitle）。文字サイズ設定で見出しと独立に変えられる */
  isCover: boolean;
  /** 表紙サブタイトル（subTitle）。既定は本文サイズを継承（実測） */
  isSub: boolean;
  ordinal: number;
  /** 継承元プレースホルダの階層別既定。DeckInfo より優先し、段落の明示指定には負ける */
  lvlStyle?: Array<LevelStyle | null> | null;
  deck: DeckInfo;
  scale: number;
  color: string;
}) {
  /* プレースホルダ固有の既定（レイアウトの lstStyle）。lvl は 0..8 に丸める */
  const ps = lvlStyle?.[Math.min(paragraph.level, 8)] ?? null;
  /* sz は 1/100pt。優先順位は 表紙の文字サイズ設定 > プレースホルダ固有 > デッキ既定。
     表紙の 2 つは applyTextSizes がスライド側の lstStyle へ注入するので
     出力でもこの順に勝つ（実測）。lvl の範囲外は最後の値に丸める */
  const szHundredths = isTitle
    ? isCover && deck.ctrTitleSz != null
      ? deck.ctrTitleSz
      : ps?.sz ?? deck.titleSz
    : isSub && deck.subTitleSz != null
      ? deck.subTitleSz
      : ps?.sz ?? deck.bodySz[Math.min(paragraph.level, deck.bodySz.length - 1)] ?? 1800;
  const fontSize = (szHundredths / 100) * scale;
  /* 字下げは実出力の marL / indent から。段落の上書きが無ければマスターの
     lvl 既定を継承する（pandoc 既定は marL=342900*(n+1), indent=-342900）。
     行頭記号の位置 = marL + indent なので、行の左端はその和 */
  const lvl = Math.min(paragraph.level, deck.bodyMarL.length - 1);
  const marL = paragraph.marL ?? ps?.marL ?? deck.bodyMarL[lvl] ?? 0;
  const hang = paragraph.indent ?? ps?.indent ?? deck.bodyIndent[lvl] ?? 0;
  const indentPt = Math.max(0, (marL + hang) / EMU_PER_PT);

  /* 水平揃え: 段落の上書き → スタイル既定（タイトルは titleStyle、本文は
     bodyStyle の lvl 既定）。pandoc 既定マスターのタイトルは中央揃え（実測） */
  const algn =
    paragraph.algn ??
    ps?.algn ??
    (isTitle ? deck.titleAlgn : isSub ? 'ctr' : deck.bodyAlgn?.[lvl]) ??
    'l';
  const textAlign =
    algn === 'ctr' ? ('center' as const)
    : algn === 'r' ? ('right' as const)
    : algn === 'just' ? ('justify' as const)
    : ('left' as const);

  /* 段落前間隔: spcPct（行高の %）と spcPts（1/100 pt の絶対値）の両対応。
     タイトルは 0（実測） */
  const spcBefPct = isTitle ? 0 : (deck.bodySpcBef?.[lvl] ?? 0);
  const spcBefPts = isTitle ? 0 : (deck.bodySpcBefPts?.[lvl] ?? 0);

  /* 行頭記号は実出力（マスターの buChar）から。pandoc 既定は • – • – … の交互 */
  const glyph =
    isTitle || paragraph.bullet === 'none'
      ? null
      : paragraph.bullet === 'number'
        ? ordinal + '.'
        : ps?.bullet === 'none'
          ? null
          : (deck.bodyBuChar?.[lvl] ?? (paragraph.level > 0 ? '◦' : '•'));

  return (
    <View
      style={[
        styles.para,
        {
          paddingLeft: indentPt * scale,
          marginTop: fontSize * 1.25 * (spcBefPct / 100000) + (spcBefPts / 100) * scale,
        },
      ]}
    >
      {glyph !== null && (
        <Text style={{ fontSize, lineHeight: fontSize * 1.25, color, width: fontSize * 1.1 }}>
          {glyph}
        </Text>
      )}
      <Text style={{ flex: 1, fontSize, lineHeight: fontSize * 1.25, color, textAlign }}>
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
    /* 構文ハイライト等のラン単位の色（実出力の srgbClr をそのまま使う） */
    run.color != null && { color: run.color },
  ];
}

const styles = StyleSheet.create({
  imageFallback: { backgroundColor: '#E7EAEF', borderWidth: 1, borderColor: '#C6CBD4' },
  surface: { borderRadius: 4, overflow: 'hidden' },
  para: { flexDirection: 'row', alignItems: 'flex-start' },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  underline: { textDecorationLine: 'underline' },
});
