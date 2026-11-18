import type { Paint, PaintToken, RuleMark, XScale } from '../core/contracts';

const LIMIT = 2 ** 120;

export const token = (name: PaintToken): Paint => ({ kind: 'token', name });
export const seriesPaint = (index: number): Paint => ({ kind: 'series', index });

export function position(scale: XScale, value: number): number {
  if (scale.type === 'band') return scale.center(value);
  const pixel = scale.map(value);
  // Far outside an author domain, extrapolation can overflow the packed Float32 geometry.
  if (Number.isNaN(pixel)) {
    const [start, end] = scale.range;
    if (start === end) return start;
    return (value < scale.domain[0]) === (start < end) ? -LIMIT : LIMIT;
  }
  return clamp(pixel, -LIMIT, LIMIT);
}

export function clamp(value: number, from: number, to: number): number {
  return Math.max(from, Math.min(to, value));
}

export function rule(
  role: RuleMark['role'], paint: Paint, x1: number, y1: number, x2: number, y2: number,
): RuleMark {
  return { type: 'rule', role, x1, y1, x2, y2, stroke: paint, strokeWidth: 1, dash: null };
}
