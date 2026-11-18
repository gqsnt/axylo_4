import type { Layout, Rect } from '../core/contracts';

export type PlotLayout = Extract<Layout, { kind: 'plot' | 'compact' }>;

export function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
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
