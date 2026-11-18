import type { IndexRange, PointSeries } from '../core/contracts';
import { lowerBound } from './search';

export interface PointIndex {
  readonly series: number;
  readonly index: number;
}

/** A sorted view of several already sorted columns, without a merged array of points. */
export function pointOrder(series: readonly PointSeries[], ranges: readonly IndexRange[]) {
  const active: number[] = [];
  let count = 0;
  ranges.forEach(({ start, end }, s) => {
    if (start < end) active.push(s);
    count += end - start;
  });

  function compare(s: number, i: number, t: number, j: number): number {
    return series[s]!.x[i]! - series[t]!.x[j]!
      || series[s]!.y[i]! - series[t]!.y[j]! || s - t || i - j;
  }

  function at(ordinal: number): PointIndex | null {
    if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= count) return null;
    const remaining = active.slice();
    const starts = remaining.map(s => ranges[s]!.start);
    while (remaining.length > 1) {
      // The smallest sampled point has at most `stride - 1` predecessors in each list.
      // Discarding its prefix removes no more than `ordinal` points before the target.
      const stride = Math.max(1, Math.floor(ordinal / remaining.length));
      let chosen = 0;
      let sampled = Math.min(starts[0]! + stride, ranges[remaining[0]!]!.end) - 1;
      for (let k = 1; k < remaining.length; k++) {
        const s = remaining[k]!;
        const i = Math.min(starts[k]! + stride, ranges[s]!.end) - 1;
        if (compare(s, i, remaining[chosen]!, sampled) < 0) {
          chosen = k;
          sampled = i;
        }
      }
      if (ordinal === 0) return { series: remaining[chosen]!, index: sampled };
      ordinal -= sampled + 1 - starts[chosen]!;
      starts[chosen] = sampled + 1;
      if (starts[chosen] === ranges[remaining[chosen]!]!.end) {
        starts.splice(chosen, 1);
        remaining.splice(chosen, 1);
      }
    }
    return { series: remaining[0]!, index: starts[0]! + ordinal };
  }

  function ordinal(s: number, i: number): number {
    const range = ranges[s];
    if (!range || i < range.start || i >= range.end) return -1;
    let before = 0;
    for (const t of active) {
      let { start, end } = ranges[t]!;
      const first = start;
      while (start < end) {
        const mid = start + Math.floor((end - start) / 2);
        if (compare(t, mid, s, i) < 0) start = mid + 1;
        else end = mid;
      }
      before += start - first;
    }
    return before;
  }

  function beforeX(x: number): number {
    let before = 0;
    for (const s of active) {
      const { start, end } = ranges[s]!;
      before += lowerBound(series[s]!.x, x, start, end) - start;
    }
    return before;
  }

  return { at, ordinal, beforeX, count };
}
