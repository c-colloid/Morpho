/**
 * 「pandoc のスライド数」と「原稿の区間数」が食い違ったとき、
 * どの区間が原因かを推定して Alert の文面と案内先を作る。
 *
 * 推定であって予測ではない。ここが外れても書き込み先は 1 バイトも動かない
 * （書き込み先を決めるのは slideSegments と contentIndexOf だけ）。
 * pandoc の分割規則（CLAUDE.md 落とし穴 5・10）を字面で近似している。
 */
import { slideSegments } from './cursorSlide.ts';
import { stripCr } from '../text/lineEnding.ts';

export type SplitCause = 'columns' | 'table' | 'image' | 'unknown';

export interface SplitSuspect {
  segment: number;          // 1 始まりの区間番号
  heading: string | null;   // 区間の `# ` 見出し（無ければ null）
  cause: SplitCause;
  insertAt: number;         // body 内オフセット。ここの行頭に `***` を入れると割れ目に一致する
}

const HR = /^ {0,3}([*_-])(?:[ \t]*\1){2,}[ \t]*$/;

type Kind = 'blank' | 'heading' | 'table' | 'image' | 'columns' | 'notes' | 'fenceEnd' | 'text';

/** 区間を「占有ブロック（表・単独画像・段組み）」と「非占有（段落・箇条書き等）」に粗く分ける。
 *  Alert の文面と `***` の位置決めにだけ使う。外れても書き込み先には影響しない */
function blocksOf(seg: string): Array<{ kind: Kind; at: number; text: string }> {
  const out: Array<{ kind: Kind; at: number; text: string }> = [];
  let off = 0, inCode = false, divDepth = 0, divKind: Kind | null = null, divAt = 0;
  /* 直前の text 行の終端（raw のオフセット）。段落の続きかどうかはこれで見る
     （text の長さで数えると CRLF で 1 文字ずれる） */
  let lastTextEnd = -1;
  for (const raw of seg.split('\n')) {
    const at = off; off += raw.length + 1;
    const line = stripCr(raw);   /* 判定は行末の \r を外して（CRLF 原稿）。at は raw で数える */
    if (/^ {0,3}(```|~~~)/.test(line)) { inCode = !inCode; if (!inCode) continue; out.push({ kind: 'text', at, text: line }); continue; }
    if (inCode) continue;
    if (/^ {0,3}:::+/.test(line)) {
      const open = /^ {0,3}:::+\s*(\{[^}]*\}|\S+)?/.exec(line);
      const spec = open?.[1] ?? '';
      const isClose = spec === '' || /^:::+$/.test(line.trim());
      if (isClose && divDepth > 0) {
        divDepth--;
        if (divDepth === 0 && divKind) { out.push({ kind: divKind, at: divAt, text: '' }); divKind = null; }
        continue;
      }
      if (divDepth === 0) {
        divKind = /notes/.test(spec) ? 'notes' : /columns/.test(spec) ? 'columns' : 'text';
        divAt = at;
      }
      divDepth++;
      continue;
    }
    if (divDepth > 0) continue;
    if (line.trim() === '') continue;
    if (HR.test(line)) continue;   /* 水平線は区間の境界。ブロックとしては数えない */
    if (/^ {0,3}#/.test(line)) { out.push({ kind: 'heading', at, text: line.replace(/^ {0,3}#+\s*/, '') }); continue; }
    if (/^ {0,3}\|/.test(line)) { if (out[out.length-1]?.kind !== 'table') out.push({ kind: 'table', at, text: line }); continue; }
    if (/^ {0,3}!\[[^\]]*\]\([^)]*\)\s*$/.test(line)) { out.push({ kind: 'image', at, text: line }); continue; }
    if (out[out.length-1]?.kind !== 'text' || lastTextEnd !== at) {
      out.push({ kind: 'text', at, text: line });
    } else { out[out.length-1].text += '\n' + line; }
    lastTextEnd = off;
  }
  return out;
}

const EXCLUSIVE = new Set<Kind>(['table', 'image', 'columns']);

/** 割れる原因になっている最初の区間を返す。原因が分からなければ null */
export function findSplitSuspects(body: string): SplitSuspect[] {
  const out: SplitSuspect[] = [];
  slideSegments(body).forEach((s, i) => {
    const seg = body.slice(s.start, s.end);
    let bs = blocksOf(seg);
    const heading = bs[0]?.kind === 'heading' ? bs[0].text : null;
    if (bs[0]?.kind === 'heading') bs = bs.slice(1);
    while (bs.length && bs[bs.length - 1].kind === 'notes') bs.pop();   // 末尾の notes は割らない（実測）
    if (!bs.length) return;
    for (let k = 0; k < bs.length; k++) {
      if (!EXCLUSIVE.has(bs[k].kind)) continue;
      const before = bs.slice(0, k);
      const after = bs.slice(k + 1);
      // 実測: 表 / 画像 は「直前の非占有ブロック列」を吸収して Content with Caption になる。
      //       段組みは吸収しない。占有ブロックの後ろに何かあれば必ず割れる。
      const absorbsBefore = bs[k].kind !== 'columns';
      const brokenBefore = before.length > 0 && !(absorbsBefore && before.every((b) => !EXCLUSIVE.has(b.kind)));
      if (brokenBefore) {
        out.push({ segment: i + 1, heading, cause: bs[k].kind as SplitCause, insertAt: s.start + bs[k].at });
        return;
      }
      if (after.length > 0) {
        out.push({ segment: i + 1, heading, cause: bs[k].kind as SplitCause, insertAt: s.start + after[0].at });
        return;
      }
    }
  });
  return out;
}
