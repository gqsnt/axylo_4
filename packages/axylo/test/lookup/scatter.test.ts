import fc from 'fast-check';
import { expect, it } from 'vitest';
import type { DatumRef } from '../../src/core/contracts';
import { buildLookup } from '../../src/lookup';
import { scatterLookup } from '../../src/lookup/scatter';
import { defaultMessages } from '../../src/messages';
import { linearScale } from '../../src/scale';
import { formatter, frame, plot, scatter } from './fixtures';

const point = (seriesKey: string, row: number): DatumRef => ({ kind: 'point', seriesKey, row });
const layout = plot({ kind: 'xy', x: linearScale([0, 100], [0, 100]), y: linearScale([0, 100], [0, 100]) });

it('picks the nearest point within 24 px and breaks a tie by later source row', () => {
  const data = frame('scatter', { data: [{ x: 60, y: 50 }, { x: 40, y: 50 }], x: 'x', y: 'y' });
  const model = buildLookup(scatter(data), layout, formatter(data), defaultMessages);
  const tie = model.pick(50, 50)!;
  expect(tie).toEqual({ kind: 'point', refs: [point('y', 1)], count: 1 });
  expect(model.primary(tie)).toEqual(point('y', 1));
  expect(model.tooltip(tie)).toMatchObject({ title: '40', count: 1, total: null, rows: [{ seriesLabel: 'y', x: '40', value: '50', row: 1 }] });
  expect(model.anchor(point('y', 1))).toEqual({ x: 40, y: 50, width: 0, height: 0 });
  expect(model.pick(16, 50)).toEqual({ kind: 'point', refs: [point('y', 1)], count: 1 });
  expect(model.pick(15.99, 50)).toBeNull();
  expect(model.pick(58, 50)).toEqual({ kind: 'point', refs: [point('y', 0)], count: 1 });
});

it('finds coincident points across a cell boundary and retains the full count after truncation', () => {
  const points = Array.from({ length: 10 }, (_, i) => ({ x: i % 2 ? 24.1 : 23.9, y: 50, series: `S${i}` }));
  const input = { x: 'x', y: 'y', series: 'series' };
  const small = frame('scatter', { ...input, data: points.slice(0, 3) });
  const all = buildLookup(scatter(small), layout, formatter(small), defaultMessages).pick(23.9, 50)!;
  expect(all.kind).toBe('point');
  if (all.kind !== 'point') throw new Error('Expected scatter target');
  expect(all.count).toBe(3);
  expect(all.refs[0]).toEqual(point('S2', 2));
  expect(all.refs).toEqual(expect.arrayContaining([point('S0', 0), point('S1', 1), point('S2', 2)]));

  const data = frame('scatter', { ...input, data: [...points, { x: 24.7, y: 50, series: 'Different' }] });
  const model = buildLookup(scatter(data), layout, formatter(data), defaultMessages);
  const target = model.pick(24.1, 50)!;
  expect(target).toMatchObject({ kind: 'point', count: 10 });
  expect(model.primary(target)).toEqual(point('S9', 9));
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
  expect(model.step(point('A', 0), 'next')).toEqual(point('B', 2));
  expect(model.step(point('A', 0), 'series-next')).toEqual(point('B', 3));
  expect(model.step(point('B', 3), 'series-previous')).toEqual(point('A', 0));
});

it('examines only nearby cells on a 200,000-point pick', () => {
  const size = 200_000;
  const x = Float64Array.from({ length: size }, (_, i) => i);
  const y = Float64Array.from(x, i => i % 521);
  const data = frame('scatter', { data: { columns: { x, y } }, x: 'x', y: 'y' });
  const projection = { kind: 'xy', x: linearScale([0, size - 1], [0, 1200]), y: linearScale([0, 520], [520, 0]) } as const;
  const model = scatterLookup(scatter(data), plot(projection, 1200, 520), formatter(data));
  const i = 98_765;
  expect(model.primary(model.pick(projection.x.map(i), 520 - (i % 521))!)).toEqual(point('y', i));
  expect(model.lastPickCandidates).toBeGreaterThan(0);
  expect(model.lastPickCandidates).toBeLessThan(5_000);
});

it('walks a multi-series scatter in fixture x and y order with consistent ranks and refs', () => {
  fc.assert(fc.property(fc.array(fc.array(fc.integer({ min: 0, max: 6 }), { minLength: 1, maxLength: 17 }),
    { minLength: 1, maxLength: 6 }), lists => {
    const rows = lists.flatMap((ys, s) => ys.map((y, x) => ({ x, y, series: `S${s}` })));
    const data = frame('scatter', { data: rows, x: 'x', y: 'y', series: 'series' });
    const model = buildLookup(scatter(data), layout, formatter(data), defaultMessages);
    const expected = rows.map((row, i) => ({ ...row, i })).sort((a, b) => a.x - b.x || a.y - b.y || a.i - b.i);
    expect(model.count).toBe(expected.length);
    let next = model.step(null, 'next');
    for (const [i, row] of expected.entries()) {
      expect(next).toEqual(point(row.series, row.i));
      expect(model.ordinal(next!)).toBe(i);
      expect(model.datum(next!)?.value).toBe(String(row.y));
      expect(model.resolve(next!)).toBe(next);
      next = model.step(next, 'next');
    }
    expect(next).toBeNull();
  }), { numRuns: 60 });
});
