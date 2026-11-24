import type { Paint, PaintToken, Projection, Rect, ResolvedReference, RuleMark, XScale } from '../core/contracts';

/** 2¹²⁰, as a literal so the module does no work at import time. */
export const COORDINATE_LIMIT = 1.329227995784916e+36;

export const token = (name: PaintToken): Paint => ({ kind: 'token', name });
export const seriesPaint = (index: number): Paint => ({ kind: 'series', index });

export function position(scale: XScale, value: number): number {
  if (scale.type === 'band') return scale.center(value);
  const pixel = scale.map(value);
  // Far outside an author domain, extrapolation can overflow the packed Float32 geometry.
  if (Number.isNaN(pixel)) {
    const [start, end] = scale.range;
    if (start === end) return start;
    return (value < scale.domain[0]) === (start < end) ? -COORDINATE_LIMIT : COORDINATE_LIMIT;
  }
  return clamp(pixel, -COORDINATE_LIMIT, COORDINATE_LIMIT);
}

export function clamp(value: number, from: number, to: number): number {
  return Math.max(from, Math.min(to, value));
}

const EPSILON = 1e-7; // Same pixel tolerance as layout/labels.

export function boundaryPixel(pixel: number, start: number, end: number): number | null {
  return pixel >= start - EPSILON && pixel <= end + EPSILON ? clamp(pixel, start, end) : null;
}

/** Use the same visible edges for reference marks and their labels. */
export function projectReference(
  reference: ResolvedReference, projection: Exclude<Projection, { kind: 'ring' }>, plot: Rect,
  xDomain?: readonly [number, number],
) {
  const { axis, from, to } = reference;
  const xAxis = axis === 'x';
  const vertical = xAxis !== (projection.kind === 'bands' && projection.horizontal);
  const scale = projection.kind === 'xy' ? projection[axis] : xAxis ? projection.band : projection.value;
  const start = vertical ? plot.x : plot.y;
  const end = start + (vertical ? plot.width : plot.height);
  const domain: readonly [number, number] = xAxis && xDomain ? xDomain : scale.type === 'band' ? [0, scale.count - 1] : scale.domain;
  if (to < domain[0] || from > domain[1]) return null;
  const a = position(scale, Math.max(from, domain[0]));
  if (from === to) {
    const pixel = boundaryPixel(a, start, end);
    return pixel === null ? null : { vertical, low: pixel, high: pixel };
  }

  const b = position(scale, Math.min(to, domain[1]));
  const low = clamp(Math.min(a, b), start, end);
  const high = clamp(Math.max(a, b), start, end);
  return low < high ? { vertical, low, high } : null;
}

export function rule(
  role: RuleMark['role'], paint: Paint, x1: number, y1: number, x2: number, y2: number,
): RuleMark {
  return { type: 'rule', role, x1, y1, x2, y2, stroke: paint, strokeWidth: 1, dash: null };
}
