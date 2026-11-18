import fc from 'fast-check';
import { expect, it } from 'vitest';
import type { DatumRef, PointFrame } from '../../src/core/contracts';
import { buildLookup } from '../../src/lookup';
import { scatterLookup } from '../../src/lookup/scatter';
import { defaultMessages } from '../../src/messages';
import { linearScale } from '../../src/scale';
import { formatter, frame, plot, scatter } from './fixtures';

const point = (seriesKey: string, row: number, x: number): DatumRef => ({ kind: 'point', seriesKey, row, x });

function points(lists: readonly (readonly (readonly [number, number])[])[]): PointFrame {
  let row = 0;
  return {
    shape: 'points', epoch: 1, revision: 1, source: { rowAt: () => null },
    xKind: 'number', timeZone: null, xLabel: 'x', yLabel: 'y', xUnit: null, yUnit: null,
    series: lists.map((list, s) => {
      const sorted = list.map(([x, y]) => ({ x, y, row: row++ })).sort((a, b) => a.x - b.x || a.y - b.y || a.row - b.row);
      return {
        key: `S${s}`, label: `S${s}`, drawable: true, x: Float64Array.from(sorted, p => p.x),
        y: Float64Array.from(sorted, p => p.y), row: Int32Array.from(sorted, p => p.row),
      };
    }),
  };
}
const layout = plot({ kind: 'xy', x: linearScale([0, 100], [0, 100]), y: linearScale([0, 100], [0, 100]) });

it('picks the nearest point within 24 px and breaks a tie by later source row', () => {
  const data = frame('scatter', { data: [{ x: 60, y: 50 }, { x: 40, y: 50 }], x: 'x', y: 'y' });
  const model = buildLookup(scatter(data), layout, formatter(data), defaultMessages);
  const tie = model.pick(50, 50)!;
  expect(tie).toEqual({ kind: 'point', refs: [point('y', 1, 40)], count: 1 });
  expect(model.primary(tie)).toEqual(point('y', 1, 40));
  expect(model.tooltip(tie)).toMatchObject({ title: '40', count: 1, total: null, rows: [{ seriesLabel: 'y', x: '40', value: '50', row: 1 }] });
  expect(model.anchor(point('y', 1, 40))).toEqual({ x: 40, y: 50, width: 0, height: 0 });
  expect(model.pick(16, 50)).toEqual({ kind: 'point', refs: [point('y', 1, 40)], count: 1 });
  expect(model.pick(15.99, 50)).toBeNull();
  expect(model.pick(58, 50)).toEqual({ kind: 'point', refs: [point('y', 0, 60)], count: 1 });
});

it('finds coincident points across a cell boundary and retains the full count after truncation', () => {
  const points = Array.from({ length: 10 }, (_, i) => ({ x: i % 2 ? 24.1 : 23.9, y: 50, series: `S${i}` }));
  const input = { x: 'x', y: 'y', series: 'series' };
  const small = frame('scatter', { ...input, data: points.slice(0, 3) });
  const all = buildLookup(scatter(small), layout, formatter(small), defaultMessages).pick(23.9, 50)!;
  expect(all.kind).toBe('point');
  if (all.kind !== 'point') throw new Error('Expected scatter target');
  expect(all.count).toBe(3);
  expect(all.refs[0]).toEqual(point('S2', 2, 23.9));
  expect(all.refs).toEqual(expect.arrayContaining([point('S0', 0, 23.9), point('S1', 1, 24.1), point('S2', 2, 23.9)]));

  const data = frame('scatter', { ...input, data: [...points, { x: 24.7, y: 50, series: 'Different' }] });
  const model = buildLookup(scatter(data), layout, formatter(data), defaultMessages);
  const target = model.pick(24.1, 50)!;
  expect(target).toMatchObject({ kind: 'point', count: 10 });
  expect(model.primary(target)).toEqual(point('S9', 9, 24.1));
  expect(model.tooltip(target).rows).toHaveLength(8);
  expect(model.tooltip(target).count).toBe(10);
  expect(model.tooltip(target).rows.some(row => row.seriesLabel === 'Different')).toBe(false);
});

it('uses screen distance when moving to the neighbouring visible series', () => {
  const data = frame('scatter', { x: 'x', y: 'y', series: 'series', data: [
    { x: 10, y: 30, series: 'A' }, { x: 11, y: 31, series: 'Hidden' },
    { x: 10, y: 80, series: 'B' }, { x: 12, y: 31, series: 'B' },
  ] });
  const model = buildLookup(scatter(data, { visible: [true, false, true] }), layout, formatter(data), defaultMessages);
  expect(model.count).toBe(3);
  expect(model.step(point('A', 0, 10), 'next')).toEqual(point('B', 2, 10));
  expect(model.step(point('A', 0, 10), 'series-next')).toEqual(point('B', 3, 12));
  expect(model.step(point('B', 3, 12), 'series-previous')).toEqual(point('A', 0, 10));
});

it('examines only nearby cells on a 200,000-point pick', () => {
  const size = 200_000;
  const x = Float64Array.from({ length: size }, (_, i) => i);
  const y = Float64Array.from(x, i => i % 521);
  const data = frame('scatter', { data: { columns: { x, y } }, x: 'x', y: 'y' });
  const projection = { kind: 'xy', x: linearScale([0, size - 1], [0, 1200]), y: linearScale([0, 520], [520, 0]) } as const;
  const model = scatterLookup(scatter(data), plot(projection, 1200, 520), formatter(data));
  const i = 98_765;
  expect(model.primary(model.pick(projection.x.map(i), 520 - (i % 521))!)).toEqual(point('y', i, i));
  expect(model.lastPickCandidates).toBeGreaterThan(0);
  expect(model.lastPickCandidates).toBeLessThan(5_000);
});

it('resolves hidden and zoomed-out scatter refs and steps from the replacement', () => {
  const data = points([[[0, 5], [2, 3], [4, 8], [6, 1]], [[2, 99]], [[2, 4], [4, 1]]]);
  const view = scatter(data, {
    visible: [true, false, true], xDomain: [2, 4],
    visiblePoints: [{ start: 1, end: 3 }, { start: 0, end: 1 }, { start: 0, end: 2 }],
  });
  const model = buildLookup(view, layout, formatter(data), defaultMessages);
  expect(model.resolve(point('S1', 4, 2))).toEqual(point('S0', 1, 2));
  expect(model.step(point('S1', 4, 2), 'next')).toEqual(point('S2', 5, 2));
  expect(model.resolve(point('S0', 0, 0))).toEqual(point('S0', 1, 2));
  expect(model.resolve(point('S0', 3, 6))).toEqual(point('S0', 2, 4));
  expect(model.resolve(point('S0', 99, 2))).toEqual(point('S0', 2, 4));
  expect(model.step(point('S0', 0, 0), 'next')).toEqual(point('S2', 5, 2));
  expect(model.step(point('S0', 3, 6), 'previous')).toEqual(point('S2', 6, 4));
  expect(model.step(point('S0', 2, 4), 'page-next')).toBeNull();
  expect(model.step(point('S0', 1, 2), 'page-previous')).toBeNull();
});

it('bounds a pick in a cell of 200,000 coincident points and reports the full count', () => {
  const size = 200_000;
  const base = points([[]]);
  const data = { ...base, series: [{
    ...base.series[0]!, x: new Float64Array(size).fill(23.9), y: new Float64Array(size).fill(50), row: null,
  }] };
  const model = scatterLookup(scatter(data), layout, formatter(data));
  const target = model.pick(24.1, 50);
  expect(target).toMatchObject({ kind: 'point', count: size });
  expect(model.primary(target!)).toEqual(point('S0', size - 1, 23.9));
  expect(model.tooltip(target!).rows).toHaveLength(8);
  expect(model.lastPickCandidates).toBeLessThan(3_000);
});

it('visits the binary-search window when switching series and locates recreated refs by x', () => {
  const n = 80_000;
  const data = points([Array.from({ length: n }, (_, x) => [n - x, 20] as const),
    Array.from({ length: n }, (_, x) => [x, 20] as const)]);
  const work = { locations: 0, seriesCandidates: 0, orderComparisons: 0 };
  const scale = linearScale([0, n], [0, 100]);
  let maps = 0;
  const projection = { kind: 'xy' as const, x: { ...scale, map(x: number) { maps++; return scale.map(x); } }, y: scale };
  const model = scatterLookup(scatter(data), plot(projection), formatter(data), work);
  maps = 0;
  expect(model.step(point('S0', 40_000, 40_000), 'series-next')).toEqual(point('S1', 120_000, 40_000));
  expect(maps).toBeLessThan(20);
  expect(work.locations).toBeGreaterThan(0);
  expect(work.locations).toBeLessThan(20);
  expect(work.seriesCandidates).toBeGreaterThan(0);
  expect(work.seriesCandidates).toBeLessThan(20);
});

it('walks partial ranges with hidden series and duplicate x and y in fixture order', () => {
  const pair = fc.tuple(fc.nat(5), fc.nat(4));
  fc.assert(fc.property(fc.array(fc.array(pair, { minLength: 2, maxLength: 17 }),
    { minLength: 3, maxLength: 6 }), fc.boolean(), (lists, trim) => {
    const data = points(lists);
    const visible = lists.map((_, s) => s !== 1);
    const visiblePoints = data.series.map(({ x }) => ({ start: trim ? 1 : 0, end: x.length }));
    const model = buildLookup(scatter(data, { visible, visiblePoints }), layout, formatter(data), defaultMessages);
    const expected = data.series.flatMap((series, s) => visible[s] ? Array.from(series.x).flatMap((x, i) => i >= visiblePoints[s]!.start
      ? [{ x, y: series.y[i]!, row: series.row![i]!, s, i }] : []) : [])
      .sort((a, b) => a.x - b.x || a.y - b.y || a.s - b.s || a.i - b.i);
    expect(model.count).toBe(expected.length);
    let next = model.step(null, 'next');
    for (const [i, row] of expected.entries()) {
      expect(next).toEqual(point(`S${row.s}`, row.row, row.x));
      expect(model.ordinal(next!)).toBe(i);
      expect(model.datum(next!)?.value).toBe(String(row.y));
      expect(model.step(next, 'previous')).toEqual(i === 0 ? null
        : point(`S${expected[i - 1]!.s}`, expected[i - 1]!.row, expected[i - 1]!.x));
      const distance = Math.max(1, Math.floor(expected.length / 10));
      const page = expected[Math.min(expected.length - 1, i + distance)]!;
      expect(model.step(next, 'page-next')).toEqual(i === expected.length - 1 ? null : point(`S${page.s}`, page.row, page.x));
      next = model.step(next, 'next');
    }
    expect(next).toBeNull();
  }), { numRuns: 60 });
});

it('uses one set of grid cells for a dense noncoincident pick and its neighbours', () => {
  const width = 500;
  const size = width * 400;
  const base = points([[]]);
  const data = { ...base, series: [{
    ...base.series[0]!,
    x: Float64Array.from({ length: size }, (_, i) => 20 + Math.floor(i / 400) / 100),
    y: Float64Array.from({ length: size }, (_, i) => 48 + (i % 400) / 100),
    row: null,
  }] };
  const scale = linearScale([0, 128], [0, 128]);
  const model = scatterLookup(scatter(data), plot({ kind: 'xy', x: scale, y: scale }), formatter(data));
  const x = 24, y = 50;
  const { x: xs, y: ys } = data.series[0]!;
  let expected = 0;
  for (let i = 0; i < size; i++) {
    if ((xs[i]! - x) ** 2 + (ys[i]! - y) ** 2 <= 0.5 ** 2) expected++;
  }
  const target = model.pick(x, y);
  expect(target).toMatchObject({ kind: 'point', count: expected });
  expect(model.primary(target!)).toEqual(point('S0', 400 * 400 + 200, x));
  expect(model.lastPickCells).toBeLessThanOrEqual(16);
  expect(model.lastPickCandidates).toBeLessThan(3_000);
});

it('finds next and previous by one binary successor search per series', () => {
  const seriesCount = 500;
  const rows = 400;
  const base = points([[]]);
  const data = { ...base, series: Array.from({ length: seriesCount }, (_, s) => ({
    key: `S${s}`, label: `S${s}`, drawable: true,
    x: Float64Array.from({ length: rows }, (_, i) => i), y: new Float64Array(rows).fill(s), row: null,
  })) };
  const work = { locations: 0, seriesCandidates: 0, orderComparisons: 0 };
  const model = scatterLookup(scatter(data), null, formatter(data), work);
  const from = point('S250', 398, 398);
  expect(model.step(from, 'next')).toEqual(point('S251', 398, 398));
  expect(work.orderComparisons).toBeGreaterThan(0);
  expect(work.orderComparisons).toBeLessThanOrEqual(seriesCount * 10);
  work.orderComparisons = 0;
  expect(model.step(from, 'previous')).toEqual(point('S249', 398, 398));
  expect(work.orderComparisons).toBeGreaterThan(0);
  expect(work.orderComparisons).toBeLessThanOrEqual(seriesCount * 10);
});
