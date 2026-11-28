/**
 * N9a repair round 4 (review sol-6.2-medium__20261127T211253Z, findings 3–4): an empty density pair on a row that has
 * a summary is reported, while violinData()'s own no-data groups stay silent; and the scene draws the same cut
 * outline that pick and anchor read.
 *
 * Geometry (violin.ts): the half width at grid value k is half × density[k] / (the layer's largest density), and the
 * outline between two grid values is the straight segment between their pixels.
 */
import { describe, expect, it } from 'vitest';
import { boxHalfWidth } from '../../src/cartesian/boxplot';
import type { AreaMark } from '../../src/core/contracts';
import { position } from '../../src/scene/geometry';
import { violinData } from '../../src/stats';
import { marksOf, n5run, plotOf, xPixel, yScaleOf, type N5Run } from './n5-pipeline';

type Row = Record<string, unknown>;
const five = (lo: number, hi: number) => {
  const d = hi - lo;
  return { min: lo, q1: lo + d / 4, median: lo + d / 2, q3: lo + (3 * d) / 4, max: hi };
};
const halfOf = (run: N5Run) => {
  const p = plotOf(run.layout).projection;
  if (p.kind === 'ring') throw new Error('ring');
  return 1.5 * boxHalfWidth(p, run.view.frame.x.values, run.view.visibleSlots);
};
// Issues on the payload fields (a NaN summary cell in a row object is reported on its own carrier field).
const payloadIssues = (run: N5Run) => run.diagnostics.filter(d => d.field === 'grid' || d.field === 'density');

describe('N9a repair 4: an empty density pair (finding 3)', () => {
  it('is reported on a row with a finite median or a positive n, with its source rows, as an omission', () => {
    const rows: Row[] = [
      { x: 'A', ...five(1, 3), n: 5, grid: [], density: [] },
      { x: 'B', ...five(1, 3), grid: [1, 2, 3], density: [0, 1, 0] },
      { x: 'C', ...five(1, 3), grid: [], density: [] },
      { x: 'D', min: NaN, q1: NaN, median: NaN, q3: NaN, max: NaN, n: 4, grid: [], density: [] },
    ];
    const run = n5run({ data: rows, x: 'x', axes: { v: { position: 'left' } }, layers: [{ type: 'violin', yAxis: 'v' }] });
    expect(payloadIssues(run).map(d => [d.code, d.field, d.rows, d.effect])).toEqual([['AX106', 'grid', [0, 2, 3], 'omitted']]);
    // Only B is drawn.
    expect(Array.from((marksOf(run, 'area', 0)[0] as AreaMark).runs)).toEqual([0, 3, 0, 3]);
  });

  it("stays silent for violinData()'s group with no finite value (n 0, NaN median), next to a drawn group", () => {
    const { data } = violinData([{ g: 'a', v: 1 }, { g: 'a', v: 2 }, { g: 'a', v: 4 }, { g: 'b', v: null }], { group: 'g', value: 'v' });
    expect(Array.from(data.columns.n)).toEqual([3, 0]);
    const run = n5run({ data, x: 'x', axes: { v: { position: 'left' } }, layers: [{ type: 'violin', yAxis: 'v' }] });
    expect(payloadIssues(run)).toEqual([]);
    expect(marksOf(run, 'area', 0)).toHaveLength(1);
  });
});

describe('N9a repair 4: scene, pick and anchor share one cut outline (finding 4)', () => {
  it('a segment far past both ends of a pinned domain is drawn as narrow as pick and anchor read it', () => {
    // From half width 0 at −1e6 to the full half width at 1e9: inside [0, 5] the true half width is about 1e-3 of it.
    const rows: Row[] = [{ x: 'A', ...five(1, 4), grid: [-1e6, 1e9], density: [0, 1], mark: NaN }];
    const run = n5run({
      data: rows, x: 'x', axes: { v: { position: 'left', domain: [0, 5] } },
      layers: [{ type: 'scatter', y: 'mark', yAxis: 'v' }, { type: 'violin', yAxis: 'v', inner: 'none' }],
    });
    const plot = plotOf(run.layout).plot, y = yScaleOf(run.layout, 0), px = xPixel(run.layout, run.view, 0), half = halfOf(run);
    const trueHalf = (value: number) => half * ((value + 1e6) / (1e9 + 1e6));
    const [area] = marksOf(run, 'area', 1) as AreaMark[];
    // The drawn right edge, interpolated in pixels at a pixel row (its vertices are in increasing grid order).
    const drawnAt = (py: number) => {
      const u = area!.upper;
      for (let k = 2; k < u.length; k += 2) {
        const [x0, y0, x1, y1] = [u[k - 2]!, u[k - 1]!, u[k]!, u[k + 1]!];
        if ((y0 - py) * (y1 - py) <= 0 && y0 !== y1) return x0 + ((py - y0) / (y1 - y0)) * (x1 - x0) - px;
      }
      return NaN;
    };
    const mid = position(y, 2.5);
    expect(drawnAt(mid)).toBeCloseTo(trueHalf(2.5), 2);
    expect(drawnAt(plot.y)).toBeCloseTo(trueHalf(5), 2);
    expect(trueHalf(5)).toBeLessThan(0.05);
    // Every drawn vertex stays within FAR (1e6 px) of the plot.
    for (let k = 1; k < area!.upper.length; k += 2) expect(Math.abs(area!.upper[k]! - mid)).toBeLessThan(1e6 + plot.height);
    // 10 px off centre is outside the (≈ 0.02 px wide) violin: the miss falls back to the scatter series.
    const target = run.lookup.pick(px + 10, mid), ref = target && run.lookup.primary(target);
    expect(ref && ref.kind === 'aligned' ? ref.seriesKey : null).toBe(run.view.frame.series[0]!.key);
    const anchor = run.lookup.anchor({ kind: 'aligned', seriesKey: run.view.frame.series[1]!.key, x: 0 })!;
    expect(anchor.width / 2).toBeCloseTo(trueHalf(5), 2);
    expect(anchor.width / 2).toBeCloseTo(drawnAt(plot.y), 2);
  });

  it('an ordinary outline crossing the pinned top keeps its exact shape and cuts its end off the plot', () => {
    const rows: Row[] = [{ x: 'A', ...five(3, 4), grid: [3, 4.5, 6], density: [1, 1, 1] }];
    const run = n5run({ data: rows, x: 'x', axes: { v: { position: 'left', domain: [0, 5] } }, layers: [{ type: 'violin', yAxis: 'v', inner: 'none' }] });
    const y = yScaleOf(run.layout, 0), px = xPixel(run.layout, run.view, 0), half = halfOf(run);
    const [area] = marksOf(run, 'area', 0) as AreaMark[];
    const pixels = Array.from(area!.upper);
    // Three grid values, all within 1e6 px of the plot: drawn as given (no cut vertex), full width at each.
    expect(pixels.length).toBe(6);
    for (const [k, value] of [3, 4.5, 6].entries()) {
      expect(pixels[2 * k]! - px).toBeCloseTo(half, 3);
      expect(pixels[2 * k + 1]!).toBeCloseTo(position(y, value), 3);
    }
  });
});
