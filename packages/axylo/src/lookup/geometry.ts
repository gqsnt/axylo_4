import type { Layout, Rect, XScale } from '../core/contracts';

export type PlotLayout = Extract<Layout, { kind: 'plot' | 'compact' }>;

export function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

export function scatterPosition(scale: XScale, value: number): number {
  const pixel = scale.map(value);
  if (scale.type === 'band') return pixel;
  const [d0, d1] = scale.domain;
  if (value < Math.min(d0, d1) || value > Math.max(d0, d1)) return pixel;
  // Only repair rounding at the range edges for a value inside the domain. Points
  // excluded by an author's domain must still be clipped by the plot.
  const [r0, r1] = scale.range;
  const low = Math.min(r0, r1);
  const high = Math.max(r0, r1);
  const tolerance = (high - low) * 1e-9;
  if (pixel < low && low - pixel <= tolerance) return low;
  if (pixel > high && pixel - high <= tolerance) return high;
  return pixel;
}

export function pointBox(x: number, y: number): Rect {
  return { x, y, width: 0, height: 0 };
}

export function clipBox(box: Rect, plot: Rect): Rect | null {
  const x = Math.max(box.x, plot.x);
  const y = Math.max(box.y, plot.y);
  const right = Math.min(box.x + box.width, plot.x + plot.width);
  const bottom = Math.min(box.y + box.height, plot.y + plot.height);
  return x <= right && y <= bottom ? { x, y, width: right - x, height: bottom - y } : null;
}
