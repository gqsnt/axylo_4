import type { IndexRange } from '../core/contracts';
import type { Span } from './references';

function spacing(values: Float64Array, i: number, j: number, fraction: number): number {
  const a = values[i]!;
  const b = values[j]!;
  const difference = b - a;
  return Number.isFinite(difference) ? difference * fraction : b * fraction - a * fraction;
}

export function barHalfWidth(values: Float64Array, i: number): number {
  if (values.length === 1) return 0.4;
  return Math.min(
    i > 0 ? spacing(values, i - 1, i, 0.4) : Infinity,
    i + 1 < values.length ? spacing(values, i, i + 1, 0.4) : Infinity,
  );
}

export function barExtent(values: Float64Array): Span {
  const last = values.length - 1;
  if (last < 0) return [Infinity, -Infinity];
  const firstHalf = last === 0 ? 0.5 : spacing(values, 0, 1, 0.5);
  const lastHalf = last === 0 ? 0.5 : spacing(values, last - 1, last, 0.5);
  return [
    Math.max(-Number.MAX_VALUE, values[0]! - firstHalf),
    Math.min(Number.MAX_VALUE, values[last]! + lastHalf),
  ];
}

export function barRange(values: Float64Array, range: IndexRange, domain: Span): IndexRange {
  let { start, end } = range;
  // A band's width is smaller than its neighbour spacing, so only adjacent slots can cross an edge.
  if (start > 0 && domain[0] - values[start - 1]! < barHalfWidth(values, start - 1)) start--;
  if (end < values.length && values[end]! - domain[1] < barHalfWidth(values, end)) end++;
  return start === range.start && end === range.end ? range : { start, end };
}
