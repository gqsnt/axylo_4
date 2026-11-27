/**
 * N4 repair regressions (cross-provider review sol-6.2-medium__20261127T054720Z, blockers 2 and 3).
 *
 * - Spec F5 / simplify/index.ts: a drawing is simplified only when it holds more drawable values than four per
 *   device-pixel column. Slots with no row, gaps and (on a log axis) nonpositive values are not drawable, so six
 *   line values aligned with 10,000 bar slots are all drawn, at every zoom and on a log axis.
 * - Spec F10: a stacked area's edge lies on its own band. With a lower component of 9 and an upper one going
 *   from +3 to -4, the upper component's band is 9..12 then 9..9 above zero and 0..0 then 0..-4 below it; its
 *   edge follows those boundaries (12 → 9 and 0 → -4), never the segment 12 → -4 between the bands. Focus anchor
 *   and hover dot sit on the cumulative boundary (+12, -4); the readout keeps the raw value (+3, -4). A missing
 *   value is never bridged.
 */
import { describe, expect, it } from 'vitest';
import type { PathMark, PointMark, Mark } from '../../src/core/contracts';
import { axisScaleOf } from '../../src/cartesian/scale-ref';
import { createCartesianOverlay } from '../../src/cartesian/overlay';
import { run, vertexCount } from './n4-pipeline';

const SLOTS = 10_000;
const VALID = [100, 101, 102, 103, 104, 105];
const LINE_VALUES = [5, 50, 8, 80, 2, 20];

/** 10,000 bar rows; the line field is present on six consecutive rows only (absent elsewhere: no row). */
function sparseInput(log: boolean) {
  const data: Record<string, number>[] = [];
  for (let i = 0; i < SLOTS; i++) {
    const row: Record<string, number> = { x: i, bars: 1 + (i % 7) };
    const k = VALID.indexOf(i);
    if (k >= 0) row.line = LINE_VALUES[k]!;
    data.push(row);
  }
  return {
    title: 'Sparse', data, x: 'x',
    axes: { left: { position: 'left' }, right: { position: 'right', scale: log ? 'log' : 'linear' } },
    layers: [{ type: 'bar', y: 'bars', yAxis: 'left' }, { type: 'line', y: 'line', yAxis: 'right' }],
  };
}

const pathOf = (marks: readonly Mark[], series: number) =>
  marks.find((m): m is PathMark => m.type === 'path' && (m as PathMark).series === series);

describe('N4 repair: density counts drawable values, not aligned slots', () => {
  for (const log of [false, true]) {
    for (const zoom of [null, [0, 6000] as const, [50, 9000] as const]) {
      for (const dpr of [1, 2]) {
        it(`draws all six line values beside 10,000 bar slots (${log ? 'log' : 'linear'}, zoom ${zoom ? zoom.join('–') : 'none'}, dpr ${dpr})`, () => {
          const res = run(sparseInput(log), { width: 960, dpr, zoom });
          if (res.layout.kind !== 'plot') throw new Error('expected a plot');
          const s = res.view.frame.series.findIndex(series => series.field === 'line');
          const path = pathOf(res.scene.marks, s);
          expect(path).toBeDefined();
          expect(vertexCount(path!.xy)).toBe(6);
          const y = axisScaleOf(res.layout.projection, res.view.frame.series[s]!.axisIndex ?? 0);
          const ys = Array.from({ length: path!.xy.length / 2 }, (_, j) => path!.xy[2 * j + 1]!).filter(v => !Number.isNaN(v));
          expect(ys).toEqual(LINE_VALUES.map(v => Math.fround(y.map(v))));
        });
      }
    }
  }

  it('still simplifies a line whose drawable values exceed four per column', () => {
    const data = Array.from({ length: SLOTS }, (_, i) => ({ x: i, bars: 1, line: 1 + ((i * 37) % 101) }));
    const res = run({
      title: 'Dense', data, x: 'x', axes: { left: { position: 'left' }, right: { position: 'right' } },
      layers: [{ type: 'bar', y: 'bars', yAxis: 'left' }, { type: 'line', y: 'line', yAxis: 'right' }],
    }, { width: 960 });
    const s = res.view.frame.series.findIndex(series => series.field === 'line');
    expect(vertexCount(pathOf(res.scene.marks, s)!.xy)).toBeLessThan(SLOTS);
  });
});

describe('N4 repair: a stacked area that changes sign stays on its signed boundaries', () => {
  const input = (b: readonly (number | null)[]) => ({
    title: 'Signs', x: 'x', axes: { v: { position: 'left' } },
    data: b.map((value, i) => ({ x: i + 1, a: 9, b: value })),
    layers: [{ type: 'area', y: ['a', 'b'], yAxis: 'v', stacked: true }],
  });

  it('draws the edge 12 → 9 above zero and 0 → -4 below it, never 12 → -4', () => {
    const res = run(input([3, -4, 3]));
    if (res.layout.kind !== 'plot') throw new Error('expected a plot');
    const y = axisScaleOf(res.layout.projection, 0);
    const xs = [1, 2, 3].map(x => res.layout.kind === 'plot' && res.layout.projection.kind === 'xy' ? res.layout.projection.x.map(x) : NaN);
    const P = (v: number) => Math.fround(y.map(v));
    const X = (k: number) => Math.fround(xs[k]!);
    const edge = pathOf(res.scene.marks, 1)!;
    expect(Array.from(edge.xy)).toEqual([
      X(0), P(12), X(1), P(9), X(2), P(12), NaN, NaN,
      X(0), P(0), X(1), P(-4), X(2), P(0),
    ]);
    // No segment joins the positive boundary (12) to the negative one (-4).
    for (let j = 2; j < edge.xy.length; j += 2) {
      const pair = [edge.xy[j - 1]!, edge.xy[j + 1]!];
      expect(pair.includes(P(12)) && pair.includes(P(-4))).toBe(false);
    }
  });

  it('anchors focus and the hover dot on the cumulative boundary while the readout stays raw', () => {
    const res = run(input([3, -4, 3]));
    if (res.layout.kind !== 'plot') throw new Error('expected a plot');
    const y = axisScaleOf(res.layout.projection, 0);
    const key = res.view.frame.series[1]!.key;
    const overlay = createCartesianOverlay(res.stateRef);
    for (const [x, drawn, raw] of [[1, 12, '3'], [2, -4, '-4']] as const) {
      const box = res.lookup.anchor({ kind: 'aligned', seriesKey: key, x })!;
      expect(box.y + box.height / 2).toBeCloseTo(y.map(drawn), 3);
      const marks: Mark[] = [];
      overlay({ view: res.view, layout: res.layout, lookup: res.lookup, target: { kind: 'x', x }, ring: null, only: null }, res.layout.plot, marks, []);
      const dot = marks.find((m): m is PointMark => m.type === 'points' && (m as PointMark).series === 1)!;
      expect(dot.xy[1]).toBeCloseTo(y.map(drawn), 3);
      const text = res.lookup.datum({ kind: 'aligned', seriesKey: key, x })!;
      const tooltipRow = res.lookup.tooltip({ kind: 'x', x }).rows[1]!;
      const normalized = JSON.stringify(text).replace(/−/g, '-');
      expect(normalized).toContain(raw);
      expect(normalized).not.toContain(String(drawn === 12 ? 12 : -13));
      expect(JSON.stringify(tooltipRow)).toBe(JSON.stringify(text));
    }
  });

  it('never bridges a missing value', () => {
    const res = run(input([3, 3, null, 3, 3]));
    const edge = pathOf(res.scene.marks, 1)!;
    const runs: number[][] = [[]];
    for (let j = 0; j < edge.xy.length; j += 2) {
      if (Number.isNaN(edge.xy[j]!)) runs.push([]);
      else runs[runs.length - 1]!.push(edge.xy[j]!);
    }
    expect(runs.map(r => r.length)).toEqual([2, 2]);
  });
});
