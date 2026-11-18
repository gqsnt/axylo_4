import type { ScatterView } from '../core/contracts';
import { contains, type PlotLayout } from './geometry';

const CELL = 24;
const RADIUS2 = CELL * CELL;
const COINCIDENT2 = 0.5 ** 2;
export const POINT_LIMIT = 8;

export function scatterGrid(view: ScatterView, layout: PlotLayout & { projection: Extract<PlotLayout['projection'], { kind: 'xy' }> }, count: number) {
  const { plot, projection } = layout;
  const columns = Math.floor(plot.width / CELL) + 1;
  const rows = Math.floor(plot.height / CELL) + 1;
  const heads = new Map<number, number>();
  const next = new Int32Array(count);
  const series = new Uint32Array(count);
  const points = new Uint32Array(count);
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  let length = 0;
  let examined = 0;

  const column = (x: number) => Math.floor((x - plot.x) / CELL);
  const row = (y: number) => Math.floor((y - plot.y) / CELL);
  view.frame.series.forEach((data, s) => {
    if (!view.visible[s] || !data.drawable) return;
    const { start, end } = view.visiblePoints[s]!;
    for (let i = start; i < end; i++) {
      const x = projection.x.map(data.x[i]!);
      const y = projection.y.map(data.y[i]!);
      if (!contains(plot, x, y)) continue;
      const cell = column(x) + columns * row(y);
      const at = length++;
      next[at] = heads.get(cell) ?? -1;
      heads.set(cell, at);
      xs[at] = x;
      ys[at] = y;
      series[at] = s;
      points[at] = i;
    }
  });

  function visit(x: number, y: number, radius: number, examine: (at: number, distance: number) => void): void {
    const left = Math.max(0, column(x - radius));
    const right = Math.min(columns - 1, column(x + radius));
    const top = Math.max(0, row(y - radius));
    const bottom = Math.min(rows - 1, row(y + radius));
    for (let cy = top; cy <= bottom; cy++) {
      for (let cx = left; cx <= right; cx++) {
        for (let at = heads.get(cx + cy * columns) ?? -1; at >= 0; at = next[at]!) {
          examined++;
          examine(at, (xs[at]! - x) ** 2 + (ys[at]! - y) ** 2);
        }
      }
    }
  }

  function sourceRow(at: number): number {
    const i = points[at]!;
    return view.frame.series[series[at]!]!.row?.[i] ?? i;
  }

  return {
    series, points,
    get examined() { return examined; },
    pick(x: number, y: number) {
      examined = 0;
      if (!contains(plot, x, y)) return null;
      let nearest = -1;
      let bestDistance = RADIUS2;
      visit(x, y, CELL, (at, distance) => {
        if (distance < bestDistance || distance === bestDistance && (nearest < 0 || sourceRow(at) > sourceRow(nearest))) {
          nearest = at;
          bestDistance = distance;
        }
      });
      if (nearest < 0) return null;
      const hits = [nearest];
      let count = 1;
      visit(xs[nearest]!, ys[nearest]!, 0.5, (at, distance) => {
        if (at === nearest || distance > COINCIDENT2) return;
        count++;
        if (hits.length < POINT_LIMIT) hits.push(at);
      });
      return { hits, count };
    },
  };
}
