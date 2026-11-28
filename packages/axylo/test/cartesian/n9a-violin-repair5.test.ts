/**
 * N9a repair round 5: an outline far past a small pinned y domain (grid values near ±Number.MAX_VALUE) is cut on
 * data values, so the scene, pick and anchor stay finite and agree.
 *
 * Geometry (violin.ts): the half width at grid value k is half × density[k] / (the layer's largest density), and the
 * outline between two grid values is the straight segment between them; with grid [−MAX, MAX] and density [0, 1]
 * the true half width at value v is half × (v + MAX) / (2 · MAX), which is half / 2 to double precision on [0, 5].
 */
import { describe, expect, it } from 'vitest';
import { boxHalfWidth } from '../../src/cartesian/boxplot';
import type { AreaMark, PathMark } from '../../src/core/contracts';
import { position } from '../../src/scene/geometry';
import { marksOf, n5run, plotOf, xPixel, yScaleOf, type N5Run } from './n5-pipeline';

const MAX = Number.MAX_VALUE;
const halfOf = (run: N5Run) => {
  const p = plotOf(run.layout).projection;
  if (p.kind === 'ring') throw new Error('ring');
  return 1.5 * boxHalfWidth(p, run.view.frame.x.values, run.view.visibleSlots);
};

describe('N9a repair 5: an outline spanning ±Number.MAX_VALUE over a pinned [0, 5]', () => {
  for (const grid of [[-MAX, MAX], [-MAX, 0, MAX]]) {
    it(`grid ${grid.length} values: finite cut at half / 2, and scene, pick and anchor agree`, () => {
      const density = grid.length === 2 ? [0, 1] : [0, 0.5, 1];
      const rows = [{ x: 'A', min: 1, q1: 2, median: 2.5, q3: 3, max: 4, grid, density, mark: NaN }];
      const run = n5run({
        data: rows, x: 'x', axes: { v: { position: 'left', domain: [0, 5] } },
        layers: [{ type: 'scatter', y: 'mark', yAxis: 'v' }, { type: 'violin', yAxis: 'v', inner: 'none' }],
      });
      const plot = plotOf(run.layout).plot, y = yScaleOf(run.layout, 0), px = xPixel(run.layout, run.view, 0), half = halfOf(run);
      const [area] = marksOf(run, 'area', 1) as AreaMark[];
      const [path] = marksOf(run, 'path', 1) as PathMark[];
      expect(area).toBeDefined();
      for (const value of [...area!.upper, ...area!.lower]) expect(Number.isFinite(value)).toBe(true);
      // The stroke's only NaNs are the breaks after each outline (one violin: none left after the trailing cut).
      for (const value of path!.xy) expect(Number.isFinite(value)).toBe(true);
      // Every drawn half width is half / 2 (the outline is that straight line on the shown span and FAR past it).
      for (let k = 0; k < area!.upper.length; k += 2) expect(area!.upper[k]! - px).toBeCloseTo(half / 2, 3);
      const mid = position(y, 2.5);
      // Inside the half width the violin takes the pick; a pixel past it falls back to the scatter series.
      const inside = run.lookup.pick(px + half / 4, mid), inRef = inside && run.lookup.primary(inside);
      expect(inRef && inRef.kind === 'aligned' ? inRef.seriesKey : null).toBe(run.view.frame.series[1]!.key);
      const anchor = run.lookup.anchor({ kind: 'aligned', seriesKey: run.view.frame.series[1]!.key, x: 0 })!;
      for (const value of [anchor.x, anchor.y, anchor.width, anchor.height]) expect(Number.isFinite(value)).toBe(true);
      expect(anchor.width / 2).toBeCloseTo(half / 2, 3);
      expect(anchor.y).toBeCloseTo(plot.y, 3);
      expect(anchor.y + anchor.height).toBeCloseTo(plot.y + plot.height, 3);
    });
  }
});
