/**
 * 行単位の差分（純関数）。
 *
 * 外部ファイル連携の競合ダイアログで「どちらを使うか」を見て決めるための表示用。
 * Markdown は行指向なので行 diff と相性が良い。
 * 共通の前後を先に刈り取り、中間だけ LCS で並べる。中間が大きすぎる場合は
 * 塊（アプリ側全部 → ファイル側全部）として示す（表示用途なので十分）。
 */

export interface DiffLine {
  /** same = 両方 / app = アプリ側のみ / file = ファイル側のみ */
  kind: 'same' | 'app' | 'file';
  text: string;
}

/** LCS にかける中間部の上限（行数）。超えたら塊表示に落とす */
const LCS_CAP = 1500;

export function diffLines(appText: string, fileText: string): DiffLine[] {
  const a = appText.split('\n');
  const b = fileText.split('\n');
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let endA = a.length;
  let endB = b.length;
  while (endA > pre && endB > pre && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const out: DiffLine[] = a.slice(0, pre).map((text) => ({ kind: 'same' as const, text }));
  const midA = a.slice(pre, endA);
  const midB = b.slice(pre, endB);
  if (midA.length > LCS_CAP || midB.length > LCS_CAP) {
    for (const text of midA) out.push({ kind: 'app', text });
    for (const text of midB) out.push({ kind: 'file', text });
  } else if (midA.length || midB.length) {
    const n = midA.length;
    const m = midB.length;
    const w = m + 1;
    const dp = new Uint16Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] =
          midA[i] === midB[j]
            ? dp[(i + 1) * w + j + 1] + 1
            : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        out.push({ kind: 'same', text: midA[i] });
        i++;
        j++;
      } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
        out.push({ kind: 'app', text: midA[i] });
        i++;
      } else {
        out.push({ kind: 'file', text: midB[j] });
        j++;
      }
    }
    while (i < n) out.push({ kind: 'app', text: midA[i++] });
    while (j < m) out.push({ kind: 'file', text: midB[j++] });
  }
  for (const text of a.slice(endA)) out.push({ kind: 'same', text });
  return out;
}

export type DiffRow = DiffLine | { kind: 'skip'; count: number };

/** 表示用: 変更の前後 context 行だけ残し、続く同一行を「… n 行」に畳む */
export function collapseSame(lines: DiffLine[], context = 2): DiffRow[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].kind === 'same') continue;
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) {
      keep[k] = true;
    }
  }
  const out: DiffRow[] = [];
  let skipped = 0;
  const flush = () => {
    if (skipped > 0) {
      out.push({ kind: 'skip', count: skipped });
      skipped = 0;
    }
  };
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].kind === 'same' && !keep[i]) {
      skipped++;
      continue;
    }
    flush();
    out.push(lines[i]);
  }
  flush();
  return out;
}
