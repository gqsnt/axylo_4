import type { IndexRange, PointSeries } from '../core/contracts';
import { lowerBound } from './search';

export interface PointIndex {
  readonly series: number;
  readonly index: number;
}

export interface PointOrderWork {
  comparisons: number;
  seeks?: number;
  steps?: number;
}

export function rangeSummary(ranges: readonly IndexRange[]) {
  const active: number[] = [];
  let count = 0;
  for (let s = 0; s < ranges.length; s++) {
    const { start, end } = ranges[s]!;
    if (start < end) active.push(s);
    count += end - start;
  }
  return { active, count };
}

/** A sorted view of several already sorted columns, without a merged array of points. */
export function pointOrder(series: readonly { readonly x: PointSeries['x']; readonly y: PointSeries['y'] | null }[], ranges: readonly IndexRange[], work?: PointOrderWork) {
  const trackWork = __DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__);
  const { active, count } = rangeSummary(ranges);

  function compare(s: number, i: number, t: number, j: number): number {
    if (trackWork && work) work.comparisons++;
    const a = series[s]!;
    const b = series[t]!;
    // Missing rows follow every point at the same x. Tied rows then stay in series and source order.
    return a.x[i]! - b.x[j]! || (a.y?.[i] ?? Infinity) - (b.y?.[j] ?? Infinity) || s - t || i - j;
  }

  function bound(s: number, t: number, j: number, start: number, end: number, after = false): number {
    while (start < end) {
      const mid = start + Math.floor((end - start) / 2);
      const difference = compare(s, mid, t, j);
      if (difference < 0 || after && difference === 0) start = mid + 1;
      else end = mid;
    }
    return start;
  }

  function edge(direction: 1 | -1, from?: PointIndex): PointIndex | null {
    let found = -1;
    let index = -1;
    for (const s of active) {
      const { start, end } = ranges[s]!;
      const i = !from ? direction === 1 ? start : end - 1
        : bound(s, from.series, from.index, start, end, direction === 1) + (direction === 1 ? 0 : -1);
      if (i < start || i >= end) continue;
      if (found < 0 || direction * compare(s, i, found, index) < 0) {
        found = s;
        index = i;
      }
    }
    return found < 0 ? null : { series: found, index };
  }

  function seek(ordinal: number) {
    let starts = Uint32Array.from(ranges, range => range.start);
    if (ordinal === 0) return { starts, point: edge(1)! };
    if (active.length === 1) {
      const s = active[0]!;
      starts[s] = starts[s]! + ordinal;
      return { starts, point: { series: s, index: starts[s]! } };
    }

    let ends = Uint32Array.from(ranges, range => range.end);
    const mids = new Uint32Array(ranges.length);
    let remaining = active;
    let size = count;
    while (true) {
      for (const s of remaining) mids[s] = starts[s]! + Math.floor((ends[s]! - starts[s]! - 1) / 2);
      const byMiddle = remaining.slice().sort((a, b) => compare(a, mids[a]!, b, mids[b]!));
      // A weighted median of list midpoints discards a fixed fraction of the remaining points each round.
      let pivot = byMiddle[0]!;
      let weight = 0;
      for (const s of byMiddle) {
        pivot = s;
        weight += ends[s]! - starts[s]!;
        if (weight * 2 >= size) break;
      }
      const index = mids[pivot]!;
      const cuts = starts.slice();
      let before = 0;
      for (const s of remaining) {
        cuts[s] = s === pivot ? index : bound(s, pivot, index, starts[s]!, ends[s]!);
        before += cuts[s]! - starts[s]!;
      }
      if (ordinal === before) return { starts: cuts, point: { series: pivot, index } };
      if (ordinal < before) {
        ends = cuts;
        size = before;
      } else {
        cuts[pivot] = index + 1;
        starts = cuts;
        ordinal -= before + 1;
        size -= before + 1;
      }
      remaining = remaining.filter(s => starts[s]! < ends[s]!);
    }
  }

  function valid(ordinal: number): boolean {
    return Number.isInteger(ordinal) && ordinal >= 0 && ordinal < count;
  }

  function at(ordinal: number): PointIndex | null {
    if (!valid(ordinal)) return null;
    if (ordinal === count - 1) return edge(-1);
    return seek(ordinal).point;
  }

  function ordinal(s: number, i: number): number {
    const range = ranges[s];
    if (!range || i < range.start || i >= range.end) return -1;
    let before = 0;
    for (const t of active) {
      const { start, end } = ranges[t]!;
      before += bound(t, s, i, start, end) - start;
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

  function cursor(ordinal: number): (() => PointIndex | null) | null {
    if (!valid(ordinal)) return null;
    if (trackWork && work?.seeks !== undefined) work.seeks++;
    const { starts } = seek(ordinal);
    const heap = active.filter(s => starts[s]! < ranges[s]!.end);
    const precedes = (s: number, t: number) => compare(s, starts[s]!, t, starts[t]!) < 0;

    function sift(at: number): void {
      const s = heap[at]!;
      while (2 * at + 1 < heap.length) {
        let child = 2 * at + 1;
        if (child + 1 < heap.length && precedes(heap[child + 1]!, heap[child]!)) child++;
        if (!precedes(heap[child]!, s)) break;
        heap[at] = heap[child]!;
        at = child;
      }
      heap[at] = s;
    }

    for (let i = Math.floor(heap.length / 2) - 1; i >= 0; i--) sift(i);
    return () => {
      const series = heap[0];
      if (series === undefined) return null;
      if (trackWork && work?.steps !== undefined) work.steps++;
      const index = starts[series]!;
      starts[series] = index + 1;
      if (starts[series] === ranges[series]!.end) {
        const last = heap.pop()!;
        if (!heap.length) return { series, index };
        heap[0] = last;
      }
      sift(0);
      return { series, index };
    };
  }

  return { at, edge, cursor, ordinal, beforeX, count };
}
