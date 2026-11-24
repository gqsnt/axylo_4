import type { StepDirection } from '../core/contracts';

// One binary search for both layers: the data layer must not import the lookup.
export { lowerBound } from '../data/search';

export function upperBound(values: ArrayLike<number>, value: number, start = 0, end = values.length): number {
  while (start < end) {
    const mid = start + Math.floor((end - start) / 2);
    if (values[mid]! <= value) start = mid + 1;
    else end = mid;
  }
  return start;
}

export function pageDistance(count: number): number {
  return Math.max(1, Math.floor(count / 10));
}

/** The neighboring index within a contiguous visible range, or null at its boundary. */
export function stepIndex(direction: StepDirection, at: number, start: number, end: number): number | null {
  let to: number;
  switch (direction) {
    case 'next': to = at + 1; break;
    case 'previous': to = at - 1; break;
    case 'first': to = start; break;
    case 'last': to = end - 1; break;
    case 'page-next': to = Math.min(end - 1, at + pageDistance(end - start)); break;
    case 'page-previous': to = Math.max(start, at - pageDistance(end - start)); break;
    default: return null;
  }
  return to === at || to < start || to >= end ? null : to;
}
