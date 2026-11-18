import type { Layout, Rect, XScale } from '../core/contracts';

export type PlotLayout = Extract<Layout, { kind: 'plot' | 'compact' }>;

export function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

export function scatterPosition(scale: XScale, value: number): number {
  if (scale.type !== 'band' && scale.domain[0] !== scale.domain[1]) {
    // Interpolation can round a domain endpoint outside the plot, especially on a reversed axis.
    if (value === scale.domain[0]) return scale.range[0];
    if (value === scale.domain[1]) return scale.range[1];
  }
  return scale.map(value);
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
