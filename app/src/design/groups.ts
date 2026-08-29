/**
 * 装飾グループの操作（すべて純関数）。
 *
 * グループは「同一スライド内のメンバー ID の配列」。編集時の一括移動のための
 * 概念で、書き出しはフラットなまま（p:grpSp 化は将来の拡張）。
 */
import type { SlideDecoration } from '../converter/types';
import type { DecorGroup, DesignData } from '../store/designs';

const SNAP_DIV = 200;

/** その装飾が属するグループ。無ければ null */
export function groupContaining(groups: DecorGroup[], decorId: string): DecorGroup | null {
  return groups.find((g) => g.memberIds.includes(decorId)) ?? null;
}

/** ドラッグで一緒に動くメンバー（自分を含む）。グループ外なら自分だけ */
export function dragMembersOf(groups: DecorGroup[], decorId: string): string[] {
  const g = groupContaining(groups, decorId);
  return g ? [...g.memberIds] : [decorId];
}

/**
 * グループを作る。メンバーは2つ以上・全員同じスライド・既存グループ未所属のこと。
 * 満たさなければ null（呼び出し側が UI で防ぐ前提の防波堤）。
 */
export function makeGroup(
  groups: DecorGroup[],
  decorations: SlideDecoration[],
  memberIds: string[],
  id: string,
): DecorGroup[] | null {
  if (memberIds.length < 2) return null;
  const members = memberIds.map((mid) => decorations.find((d) => d.id === mid));
  if (members.some((m) => m === undefined)) return null;
  const ci = members[0]!.contentIndex;
  if (members.some((m) => m!.contentIndex !== ci)) return null;
  if (memberIds.some((mid) => groupContaining(groups, mid))) return null;
  return [...groups, { id, contentIndex: ci, memberIds: [...memberIds] }];
}

export function dissolveGroup(groups: DecorGroup[], groupId: string): DecorGroup[] {
  return groups.filter((g) => g.id !== groupId);
}

/** 消えた装飾をメンバーから外し、1人以下になったグループは解散する */
export function pruneGroups(groups: DecorGroup[], decorations: SlideDecoration[]): DecorGroup[] {
  const alive = new Set(decorations.map((d) => d.id));
  return groups
    .map((g) => ({ ...g, memberIds: g.memberIds.filter((mid) => alive.has(mid)) }))
    .filter((g) => g.memberIds.length >= 2);
}

/**
 * メンバー全員を同じ量だけ動かす。移動量は 0.5% グリッドへスナップし、
 * **全員がスライド内に収まる範囲**へクランプする（形が崩れない）。
 */
export function moveMembersBy(
  decorations: SlideDecoration[],
  memberIds: string[],
  dx: number,
  dy: number,
  slideW: number,
  slideH: number,
): SlideDecoration[] {
  const members = decorations.filter((d) => memberIds.includes(d.id));
  if (members.length === 0) return decorations;
  const unitX = slideW / SNAP_DIV;
  const unitY = slideH / SNAP_DIV;
  let sx = Math.round(Math.round(dx / unitX) * unitX);
  let sy = Math.round(Math.round(dy / unitY) * unitY);
  const minDx = Math.max(...members.map((m) => -m.x));
  const maxDx = Math.min(...members.map((m) => slideW - (m.x + m.w)));
  const minDy = Math.max(...members.map((m) => -m.y));
  const maxDy = Math.min(...members.map((m) => slideH - (m.y + m.h)));
  sx = Math.max(minDx, Math.min(maxDx, sx));
  sy = Math.max(minDy, Math.min(maxDy, sy));
  if (sx === 0 && sy === 0) return decorations;
  return decorations.map((d) =>
    memberIds.includes(d.id)
      ? { ...d, x: Math.round(d.x + sx), y: Math.round(d.y + sy) }
      : d,
  );
}

/**
 * あるスライドの装飾**とグループ**をコンテンツスライド（1..total）へ
 * 複製する（置き換え方式）。元スライドはそのまま。表紙（ci=0）の装飾は
 * 元でない限り保持し、それ以外のスライドの既存装飾・グループは捨てる。
 */
export function copyDesignToAllSlides(
  design: DesignData,
  fromCi: number,
  totalSlides: number,
  genId: () => string,
): DesignData {
  const srcDecors = design.decorations.filter((d) => d.contentIndex === fromCi);
  const srcGroups = design.groups.filter((g) => g.contentIndex === fromCi);
  /* 置き換えの対象はコンテンツスライド（1..total）。表紙（ci=0）の装飾は
     元スライドでない限り保持する */
  const keepCover = (ci: number) => ci === fromCi || (ci === 0 && fromCi !== 0);
  const decorations: SlideDecoration[] = design.decorations.filter((d) =>
    keepCover(d.contentIndex),
  );
  const groups: DecorGroup[] = design.groups.filter((g) => keepCover(g.contentIndex));
  for (let ci = 1; ci <= totalSlides; ci++) {
    if (ci === fromCi) continue;
    const idMap = new Map<string, string>();
    for (const d of srcDecors) {
      const nid = genId();
      idMap.set(d.id, nid);
      decorations.push({ ...d, id: nid, contentIndex: ci });
    }
    for (const g of srcGroups) {
      groups.push({
        id: genId(),
        contentIndex: ci,
        memberIds: g.memberIds.map((mid) => idMap.get(mid)!),
      });
    }
  }
  return { ...design, decorations, groups };
}
