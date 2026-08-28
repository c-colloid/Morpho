/**
 * .morphodesign（デザインデータの書き出しファイル）の直列化とパース。
 *
 * roadmap の三層分離: デザインは .md に書かず、任意で JSON として
 * 書き出せる（Git 再現用）。中身は保存形式（DesignData）と同じで、
 * 判別用の kind を持つだけ。読み込み側は外部ファイルを信用せず、
 * 形の合わない要素は黙って捨てる（原稿と違い、装飾は失われても
 * 内容は無傷という設計に合わせる）。
 */
import type { DecorationShape, SlideDecoration } from '../converter/types';
import type { DecorGroup, DesignData } from '../store/designs';

export const DESIGN_FILE_KIND = 'morphodesign';

const SHAPES: DecorationShape[] = [
  'rect', 'roundRect', 'ellipse', 'triangle', 'diamond', 'hexagon', 'star5', 'rightArrow',
];
const SCHEMES = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];

export function serializeDesign(design: DesignData): string {
  return JSON.stringify(
    {
      kind: DESIGN_FILE_KIND,
      version: 1,
      decorations: design.decorations,
      groups: design.groups,
    },
    null,
    2,
  );
}

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function sanitizeColor(v: unknown): SlideDecoration['color'] | null {
  const color = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  if (SCHEMES.includes(color.scheme as string)) {
    return { scheme: color.scheme as SlideDecoration['color']['scheme'] };
  }
  if (typeof color.hex === 'string' && /^#[0-9A-Fa-f]{6}$/.test(color.hex)) {
    return { hex: color.hex };
  }
  return null;
}

/* id は XML 属性（cNvPr name）へ素で入るので、生成器と同等の文字種に限る */
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
/* XML 1.0 ではエスケープしても書けない制御文字 */
// eslint-disable-next-line no-control-regex
const XML_INVALID_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * 図形テキストの浄化（アプリ内入力・.morphodesign 読み込みの共通経路）。
 * 制御文字は pptx の <a:t> に入ると XML として不正になるため除去する
 */
export function sanitizeDecorText(text: string): string {
  return text.replace(XML_INVALID_RE, '').slice(0, 20);
}

function sanitizeDecoration(v: unknown): SlideDecoration | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || !ID_RE.test(o.id)) return null;
  if (!isFiniteNum(o.contentIndex) || o.contentIndex < 1) return null;
  if (!SHAPES.includes(o.shape as DecorationShape)) return null;
  if (!isFiniteNum(o.x) || !isFiniteNum(o.y) || !isFiniteNum(o.w) || !isFiniteNum(o.h)) return null;
  if (o.w <= 0 || o.h <= 0) return null;
  const fillColor = sanitizeColor(o.color);
  if (!fillColor) return null;
  const d: SlideDecoration = {
    id: o.id,
    contentIndex: Math.round(o.contentIndex),
    shape: o.shape as DecorationShape,
    x: Math.round(o.x),
    y: Math.round(o.y),
    w: Math.round(o.w),
    h: Math.round(o.h),
    color: fillColor,
    opacity: isFiniteNum(o.opacity) ? Math.max(5, Math.min(100, Math.round(o.opacity))) : 100,
  };
  if (typeof o.text === 'string') {
    const text = sanitizeDecorText(o.text);
    if (text.length > 0) d.text = text;
  }
  if (o.noFill === true) d.noFill = true;
  if (typeof o.line === 'object' && o.line !== null) {
    const l = o.line as Record<string, unknown>;
    const lineColor = sanitizeColor(l.color);
    if (lineColor && isFiniteNum(l.widthPt) && l.widthPt > 0) {
      d.line = { color: lineColor, widthPt: Math.min(12, Math.max(0.25, l.widthPt)) };
    }
  }
  /* 塗りも枠も無い図形は見えないので、塗りに戻す */
  if (d.noFill && !d.line) delete d.noFill;
  return d;
}

function sanitizeGroup(v: unknown, decorations: SlideDecoration[]): DecorGroup | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || !ID_RE.test(o.id)) return null;
  if (!isFiniteNum(o.contentIndex)) return null;
  if (!Array.isArray(o.memberIds)) return null;
  const ci = Math.round(o.contentIndex);
  /* メンバーは実在し、同一スライドに居るものだけ残す */
  const memberIds = o.memberIds.filter(
    (m): m is string =>
      typeof m === 'string' &&
      decorations.some((d) => d.id === m && d.contentIndex === ci),
  );
  if (memberIds.length < 2) return null;
  return { id: o.id, contentIndex: ci, memberIds };
}

/**
 * .morphodesign のテキストを DesignData へ。形が違えば null。
 * 個々の装飾・グループは検証し、壊れたものだけ黙って捨てる。
 */
export function parseDesignFile(text: string): DesignData | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (o.kind !== DESIGN_FILE_KIND || o.version !== 1) return null;
  if (!Array.isArray(o.decorations)) return null;
  const decorations: SlideDecoration[] = [];
  const seen = new Set<string>();
  for (const v of o.decorations) {
    const d = sanitizeDecoration(v);
    if (d && !seen.has(d.id)) {
      seen.add(d.id);
      decorations.push(d);
    }
  }
  const groups: DecorGroup[] = [];
  if (Array.isArray(o.groups)) {
    const gSeen = new Set<string>();
    for (const v of o.groups) {
      const g = sanitizeGroup(v, decorations);
      if (g && !gSeen.has(g.id)) {
        gSeen.add(g.id);
        groups.push(g);
      }
    }
  }
  return { version: 1, decorations, groups };
}
