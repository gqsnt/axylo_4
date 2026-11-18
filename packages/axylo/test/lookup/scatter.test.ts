import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { DatumRef, PickTarget, PointFrame, Rect } from '../../src/core/contracts';
import { buildLookup } from '../../src/lookup';
import { scatterLookup } from '../../src/lookup/scatter';
import { defaultMessages } from '../../src/messages';
import { linearScale } from '../../src/scale';
import { LATENCY } from '../browser/acceptance/fixtures';
import { formatter, frame, plot, scatter } from './fixtures';

const point = (seriesKey: string, row: number, x: number): Extract<DatumRef, { kind: 'point' }> =>
  ({ kind: 'point', seriesKey, row, x });

function points(lists: readonly (readonly (readonly [number, number])[])[], sourceRows?: readonly number[]): PointFrame {
  let row = 0;
  return {
    shape: 'points', epoch: 1, revision: 1, source: { rowAt: () => null },
    xKind: 'number', timeZone: null, xLabel: 'x', yLabel: 'y', xUnit: null, yUnit: null,
    series: lists.map((list, s) => {
      const sorted = list.map(([x, y]) => {
        const i = row++;
        return { x, y, row: sourceRows?.[i] ?? i };
      }).sort((a, b) => a.x - b.x || a.y - b.y || a.row - b.row);
      return {
        key: `S${s}`, label: `S${s}`, drawable: true, x: Float64Array.from(sorted, p => p.x),
        y: Float64Array.from(sorted, p => p.y), row: Int32Array.from(sorted, p => p.row),
      };
    }),
  };
}
const layout = plot({ kind: 'xy', x: linearScale([0, 100], [0, 100]), y: linearScale([0, 100], [0, 100]) });
// For these fixtures, half a device pixel at this ratio is below the smallest nonzero distance difference.
const exactRatio = 2 ** 52;

function scatterLayout(rect: Rect, xDomain: readonly [number, number], yDomain: readonly [number, number]) {
  const projection = {
    kind: 'xy', x: linearScale(xDomain, [rect.x, rect.x + rect.width]),
    y: linearScale(yDomain, [rect.y + rect.height, rect.y]),
  } as const;
  return { ...plot(projection, rect.x + rect.width + 4, rect.y + rect.height + 4), plot: rect, projection };
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

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

it('breaks the rounded SVG midpoint tie in both orders of the browser long-form fixture', () => {
  // Node layout of the 720 × 400 host with the caption, toolbar and axis lanes reserved.
  const rect = { x: 46.814453125, y: 11.5, width: 669.185546875, height: 278.53125 };
  const layout = scatterLayout(rect, [0, 40], [0, 10]);
  const { x, y } = layout.projection;
  const svg = (pixel: number) => Math.round(Math.fround(pixel) * 100) / 100;
  const px = (svg(x.map(20)) + svg(x.map(21))) / 2;
  const py = svg(y.map(5));
  const first = { x: 20, y: 5, s: 'first' };
  const second = { x: 21, y: 5, s: 'second' };
  expect(Math.abs(x.map(21) - px)).toBeLessThan(Math.abs(x.map(20) - px));
  for (const [a, b] of [[first, second], [second, first]] as const) {
    const data = frame('scatter', {
      data: [{ x: 0, y: 0, s: 'far' }, a, b, { x: 40, y: 9, s: 'far' }], x: 'x', y: 'y', series: 's',
    });
    expect(data.series.find(s => s.key === a.s)?.row).toEqual(Int32Array.of(1));
    expect(data.series.find(s => s.key === b.s)?.row).toEqual(Int32Array.of(2));
    const model = buildLookup(scatter(data), layout, formatter(data), defaultMessages);
    for (const at of [px, Math.round(px)]) {
      expect(model.pick(at, py)).toEqual({ kind: 'point', refs: [point(b.s, 2, b.x)], count: 1 });
    }
  }
});

it('limits scatter ties to half a device pixel from the closest point and to the pick radius', () => {
  const data = points([[[10, 50]], [[30.375, 50]], [[30.75, 50]], [[30.5, 50]]]);
  const view = scatter(data);
  for (const [ratio, winner] of [[1, point('S1', 1, 30.375)], [2, point('S0', 0, 10)]] as const) {
    const model = buildLookup(view, layout, formatter(data), defaultMessages, undefined, ratio);
    expect(model.primary(model.pick(20, 50)!)).toEqual(winner);
  }

  const edge = points([[[23.875, 50]], [[24, 50]], [[24.125, 50]]]);
  const model = buildLookup(scatter(edge), layout, formatter(edge), defaultMessages);
  expect(model.primary(model.pick(0, 50)!)).toEqual(point('S1', 1, 24));
});

it.each([
  { x: 68.4, y: 12.4, width: 827.6, height: 674.35 },
  { x: 68.375, y: 12.375, width: 647.625, height: 340 },
])('picks the latency fixture on each edge and corner of a $width × $height plot', rect => {
  const corners = [
    { size: 10, latency: 140, region: 'NW' }, { size: 35, latency: 140, region: 'NE' },
    { size: 10, latency: 90, region: 'SW' }, { size: 35, latency: 90, region: 'SE' },
  ];
  const data = frame('scatter', { data: [...LATENCY.points, ...corners], x: 'size', y: 'latency', series: 'region' });
  const view = scatter(data, { xDomain: [10, 35], yDomain: [90, 140] });
  const model = buildLookup(view, scatterLayout(rect, view.xDomain, view.yDomain), formatter(data), defaultMessages);
  const { x: left, y: top, width, height } = rect;
  const right = left + width;
  const bottom = top + height;
  const probes = [
    [point('EU', 1, 20), left + (10 / 25) * width, top],
    [point('US', 3, 15), left + (5 / 25) * width, bottom],
    [point('EU', 0, 10), left, top + (20 / 50) * height],
    [point('US', 5, 35), right, top + (45 / 50) * height],
    [point('NW', 6, 10), left, top], [point('NE', 7, 35), right, top],
    [point('SW', 8, 10), left, bottom], [point('SE', 9, 35), right, bottom],
  ] as const;
  for (const [ref, x, y] of probes) {
    for (const [dx, dy] of [[0, 0], [10, 0], [-10, 0], [0, 12], [0, -12], [10, 12], [-10, -12]] as const) {
      const target = model.pick(clamp(x + dx, left, right), clamp(y + dy, top, bottom));
      expect(target, JSON.stringify({ ref, dx, dy })).toEqual({ kind: 'point', refs: [ref], count: 1 });
    }
    expect(model.anchor(ref)).toMatchObject({ x: expect.closeTo(x, 10), y: expect.closeTo(y, 10) });
  }
  // Decision 0004 (clarifications): up to 1 CSS px outside picks as on the edge; further out, nothing.
  expect(model.pick(left - 1, top)).toEqual(model.pick(left, top));
  expect(model.pick(left - 1.01, top)).toBeNull();
});

it('indexes the rounded right and bottom edges in the same cells it searches', () => {
  const extent = 192 - 2 ** -45;
  const rect = { x: 72, y: 72, width: extent, height: extent };
  const data = points([[[0, 0], [1, 0.5], [0.5, 0.5], [0.5, 0]]]);
  const model = buildLookup(scatter(data), scatterLayout(rect, [0, 1], [0, 1]), formatter(data), defaultMessages);
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  for (const [x, y, ref] of [
    [right, rect.y + 96, point('S0', 1, 1)],
    [rect.x + 96, bottom, point('S0', 3, 0.5)],
    [right - 10, rect.y + 96, point('S0', 1, 1)],
    [rect.x + 96, bottom - 10, point('S0', 3, 0.5)],
  ] as const) {
    expect(model.pick(x, y)).toEqual({ kind: 'point', refs: [ref], count: 1 });
  }
});

it('agrees with a brute-force scatter pick anywhere within radius of a drawn point', () => {
  const fraction = fc.oneof(fc.constant(0), fc.constant(1), fc.integer({ min: 0, max: 1024 }).map(n => n / 1024));
  const fractions = fc.array(fc.tuple(fraction, fraction), { minLength: 1, maxLength: 42 });
  const extent = fc.oneof(fc.constant(192 - 2 ** -45), fc.integer({ min: 80, max: 1200 }).map(n => n / 2));
  const offset = fc.tuple(fc.integer({ min: -24, max: 24 }), fc.integer({ min: -24, max: 24 }))
    .filter(([x, y]) => x * x + y * y <= 24 ** 2);
  fc.assert(fc.property(
    fc.tuple(fc.integer({ min: -120, max: 128 }), fc.integer({ min: -120, max: 128 }), extent, extent),
    fractions, fractions, fc.nat(), offset, fc.constantFrom(1, 1.25, 2, 3),
    ([left, top, width, height], a, b, seed, [dx, dy], ratio) => {
      const right = left + width;
      const bottom = top + height;
      const rect = { x: left, y: top, width, height };
      const layout = scatterLayout(rect, [-2, 2], [-2, 2]);
      const project = ([x, y]: readonly [number, number]) => [x * 4 - 2, 2 - y * 4] as const;
      const shared = a[0]!;
      const inputs = [a.map(project), [shared, ...b].map(project)];
      const length = inputs[0]!.length + inputs[1]!.length;
      const sourceRows = Array.from({ length }, (_, i) => i);
      let random = seed;
      for (let i = length - 1; i > 0; i--) {
        random = (Math.imul(1664525, random) + 1013904223) >>> 0;
        const j = random % (i + 1);
        [sourceRows[i], sourceRows[j]] = [sourceRows[j]!, sourceRows[i]!];
      }
      let row = 0;
      const drawn = inputs.flatMap((list, s) => list.map(([x, y]) => ({
        x: clamp(layout.projection.x.map(x), left, right), y: clamp(layout.projection.y.map(y), top, bottom),
        ref: point(`S${s}`, sourceRows[row++]!, x),
      })));
      const data = points(inputs, sourceRows);
      const witness = drawn[seed % drawn.length]!;
      const px = clamp(witness.x + dx, left, right);
      const py = clamp(witness.y + dy, top, bottom);
      const ranked = drawn.map(d => ({ ...d, distance: (d.x - px) ** 2 + (d.y - py) ** 2 }))
        .sort((a, b) => a.distance - b.distance || b.ref.row - a.ref.row);
      const nearest = ranked[0]!;
      fc.pre(nearest.distance <= 24 ** 2);
      const tied = ranked.filter(d => d.distance <= 24 ** 2 && Math.sqrt(d.distance) - Math.sqrt(nearest.distance) < 0.5 / ratio)
        .reduce((latest, d) => d.ref.row > latest.ref.row ? d : latest, nearest);
      for (const [dpr, winner] of [[exactRatio, nearest], [ratio, tied]] as const) {
        const coincident = drawn.filter(d => (d.x - winner.x) ** 2 + (d.y - winner.y) ** 2 <= 0.5 ** 2);
        const model = buildLookup(scatter(data), layout, formatter(data), defaultMessages, undefined, dpr);
        const target = model.pick(px, py);
        if (target?.kind !== 'point') throw new Error('Expected scatter target within 24 px');
        expect(target.refs[0]).toEqual(winner.ref);
        expect(target.count).toBe(coincident.length);
        expect(target.refs).toHaveLength(Math.min(8, coincident.length));
        expect(new Set(target.refs.map(ref => ref.kind === 'point' && ref.row)).size).toBe(target.refs.length);
        expect(coincident.map(d => d.ref)).toEqual(expect.arrayContaining([...target.refs]));
      }
    },
  ), { numRuns: 1_500 });
});

it.each([10, 8])('picks the later row from the first series when the second series is at x=%s', x => {
  const data = points([[[10, 10]], [[x, 10]]], [5, 2]);
  const model = buildLookup(scatter(data), layout, formatter(data), defaultMessages);
  const refs = x === 10 ? [point('S0', 5, 10), point('S1', 2, x)] : [point('S0', 5, 10)];
  expect(model.pick((10 + x) / 2, 10)).toEqual({ kind: 'point', refs, count: refs.length });
});

it('cannot pick a point outside the y domain from inside the plot', () => {
  const data = points([[[25, 102]]]);
  const model = buildLookup(scatter(data), layout, formatter(data), defaultMessages);
  expect(model.pick(25, 99)).toBeNull();
});

it('picks an in-domain point that rounds beyond the top edge of a reversed scale', () => {
  const rect = { x: 0, y: 1 / 17, width: 100, height: 15 / 7 };
  const yDomain = [-1e6, 1.16e-10] as const;
  const y = yDomain[1] - 2 ** -86;
  const data = points([[[25, y]]]);
  const layout = scatterLayout(rect, [0, 100], yDomain);
  expect(y).toBeLessThan(yDomain[1]);
  expect(layout.projection.y.map(y)).toBeLessThan(rect.y);
  const model = buildLookup(scatter(data), layout, formatter(data), defaultMessages);
  expect(model.pick(25, rect.y)).toMatchObject({ kind: 'point', refs: [point('S0', 0, 25)] });
  expect(model.anchor(point('S0', 0, 25))?.y).toBe(rect.y);
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

it('keeps the earliest of ten coincident rows addressable when a pointer pick omits it', () => {
  const data = frame('scatter', { x: 'x', y: 'y', series: 's',
    data: Array.from({ length: 10 }, (_, i) => ({ x: 20, y: 40, s: `S${i}` })),
  });
  const model = buildLookup(scatter(data), layout, formatter(data), defaultMessages);
  const earliest = point('S0', 0, 20);
  expect(model.step(null, 'first')).toEqual(earliest);
  expect(model.resolve(earliest)).toBe(earliest);
  expect(model.ordinal(earliest)).toBe(0);
  expect(model.datum(earliest)).toMatchObject({ ref: earliest, seriesLabel: 'S0', x: '20', value: '40', row: 0 });
  expect(model.anchor(earliest)).toEqual({ x: 20, y: 40, width: 0, height: 0 });
  const picked = model.pick(20, 40);
  if (picked?.kind !== 'point') throw new Error('Expected scatter target');
  expect(picked.count).toBe(10);
  expect(picked.refs).toHaveLength(8);
  expect(picked.refs).not.toContainEqual(earliest);
  expect(model.tooltip(picked)).toMatchObject({ count: 10 });
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

it('bounds the points visited for 10,000 identical marks mixed with 190,000 other points in one cell', () => {
  const size = 200_000;
  const copies = 10_000;
  const base = points([[]]);
  const data = { ...base, series: [{
    ...base.series[0]!,
    x: new Float64Array(size).fill(50, 0, copies),
    y: new Float64Array(size).fill(50, 0, copies + 1),
    row: null,
  }] };
  const { x: xs, y: ys } = data.series[0]!;
  // The boundary point is exactly 0.5 px away and the rest fill the same cell beyond its own radius.
  xs[copies] = 50.5;
  for (let i = copies + 1; i < size; i++) {
    const j = i - copies - 1;
    xs[i] = 51.01 + Math.floor(j / 400) / 1000;
    ys[i] = 50.01 + (j % 400) / 1000;
  }
  const axis = linearScale([0, 128], [0, 128]);
  const model = scatterLookup(scatter(data), plot({ kind: 'xy', x: axis, y: axis }, 128, 128), formatter(data));
  for (const [x, row] of [[50, copies - 1], [50.5, copies]] as const) {
    const target = model.pick(x, 50);
    expect(target).toMatchObject({ kind: 'point', count: copies + 1 });
    expect(model.primary(target!)).toEqual(point('S0', row, x));
    expect(model.tooltip(target!).rows).toHaveLength(8);
    expect(model.lastPickCandidates).toBeLessThanOrEqual(12);
  }
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
  const layout = plot({ kind: 'xy', x: scale, y: scale });
  const x = 24, y = 50;
  const { x: xs, y: ys } = data.series[0]!;
  let latestTie = 400 * 400 + 200;
  for (let i = 0; i < size; i++) {
    if (Math.hypot(xs[i]! - x, ys[i]! - y) < 0.5) latestTie = i;
  }
  for (const [ratio, row] of [[exactRatio, 400 * 400 + 200], [1, latestTie]] as const) {
    const model = scatterLookup(scatter(data), layout, formatter(data), undefined, ratio);
    let expected = 0;
    for (let i = 0; i < size; i++) {
      if ((xs[i]! - xs[row]!) ** 2 + (ys[i]! - ys[row]!) ** 2 <= 0.5 ** 2) expected++;
    }
    const target = model.pick(x, y);
    expect(target).toMatchObject({ kind: 'point', count: expected });
    expect(model.primary(target!)).toEqual(point('S0', row, xs[row]!));
    expect(model.lastPickCells).toBeLessThanOrEqual(16);
    expect(model.lastPickCandidates).toBeLessThan(3_000);
  }
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

// The lattice rule of `Lookup.pick`: every drawn point is compared at its position rounded to the nearest
// device pixel; the closest within 24 px wins, compared points within half a device pixel of that distance
// tie and the latest source row wins, and the count is every point whose rounded position is within 0.5 px
// of the winner's.
interface Drawn { readonly x: number; readonly y: number; readonly ref: Extract<DatumRef, { kind: 'point' }> }
function latticeOracle(drawn: readonly Drawn[], px: number, py: number, ratio: number) {
  const snapped = drawn.map(d => ({ ...d, x: Math.round(d.x * ratio) / ratio, y: Math.round(d.y * ratio) / ratio }))
    .map(d => ({ ...d, distance: (d.x - px) ** 2 + (d.y - py) ** 2 }));
  let nearest = snapped[0]!;
  for (const d of snapped) if (d.distance < nearest.distance) nearest = d;
  if (nearest.distance > 24 ** 2) return null;
  let winner = nearest;
  for (const d of snapped) {
    const tied = d.distance <= 24 ** 2 && Math.sqrt(d.distance) - Math.sqrt(nearest.distance) < 0.5 / ratio;
    if (tied && d.ref.row > winner.ref.row) winner = d;
  }
  const coincident = snapped.filter(d => (d.x - winner.x) ** 2 + (d.y - winner.y) ** 2 <= 0.5 ** 2);
  return { winner: winner.ref, coincident: coincident.map(d => d.ref) };
}

function cloud(positions: readonly (readonly [number, number])[], sourceRows?: readonly number[]): { data: PointFrame; drawn: Drawn[] } {
  const data = points([positions], sourceRows);
  const s = data.series[0]!;
  const drawn = Array.from(s.x, (x, i) => ({ x, y: s.y[i]!, ref: point('S0', s.row![i]!, x) }));
  return { data, drawn };
}

function expectLattice(target: ReturnType<ReturnType<typeof scatterLookup>['pick']>, expected: ReturnType<typeof latticeOracle>) {
  if (!expected) return expect(target).toBeNull();
  if (target?.kind !== 'point') throw new Error('Expected a scatter target');
  expect(target.refs[0]).toEqual(expected.winner);
  expect(target.count).toBe(expected.coincident.length);
  expect(target.refs).toHaveLength(Math.min(8, expected.coincident.length));
  expect(new Set(target.refs.map(ref => ref.kind === 'point' && ref.row)).size).toBe(target.refs.length);
  expect(expected.coincident).toEqual(expect.arrayContaining([...target.refs]));
}

it('agrees with a brute-force pick under the device-pixel lattice rule', () => {
  const axis = linearScale([0, 64], [0, 64]);
  const layout = plot({ kind: 'xy', x: axis, y: axis }, 64, 64);
  // Positions on a 1/16 px grid in a 12 px square crowd several points into each device pixel.
  const position = fc.tuple(fc.integer({ min: 0, max: 192 }), fc.integer({ min: 0, max: 192 }))
    .map(([x, y]) => [26 + x / 16, 26 + y / 16] as const);
  fc.assert(fc.property(
    fc.array(position, { minLength: 1, maxLength: 120 }), fc.nat(), fc.constantFrom(1, 1.25, 1.5, 2, 3),
    fc.tuple(fc.integer({ min: -400, max: 400 }), fc.integer({ min: -400, max: 400 })),
    (positions, seed, ratio, [dx, dy]) => {
      const rows = Array.from(positions, (_, i) => i);
      let random = seed;
      for (let i = rows.length - 1; i > 0; i--) {
        random = (Math.imul(1664525, random) + 1013904223) >>> 0;
        const j = random % (i + 1);
        [rows[i], rows[j]] = [rows[j]!, rows[i]!];
      }
      const { data, drawn } = cloud(positions, rows);
      const witness = drawn[seed % drawn.length]!;
      const px = clamp(witness.x + dx / 16, 0, 64);
      const py = clamp(witness.y + dy / 16, 0, 64);
      const model = scatterLookup(scatter(data), layout, formatter(data), undefined, ratio, { exactBudget: 0 });
      expectLattice(model.pick(px, py), latticeOracle(drawn, px, py, ratio));
      expect(model.lastPickLattice).toBe(true);
    },
  ), { numRuns: 1_500 });
});

describe('a pick visits a number of index entries bounded by the radius and the pixel ratio', () => {
  const axis = linearScale([0, 200], [0, 200]);
  const layout = plot({ kind: 'xy', x: axis, y: axis }, 200, 200);
  // The exact attempt may spend the lattice points of the 49 px pick square; the lattice pick visits at most
  // the occupied lattice points near the pointer.
  const bound = (ratio: number) => 2 * (Math.ceil(49 * ratio) + 1) ** 2;

  it.each([[32_000, 1], [32_000, 2], [200_000, 1], [200_000, 2]])('%i points on a 20 px ring around the pointer at ratio %i', (size, ratio) => {
    const positions = Array.from({ length: size }, (_, i) =>
      [100 + 20 * Math.cos(2 * Math.PI * i / size), 100 + 20 * Math.sin(2 * Math.PI * i / size)] as const);
    const { data, drawn } = cloud(positions);
    const model = scatterLookup(scatter(data), layout, formatter(data), undefined, ratio);
    const target = model.pick(100, 100);
    expect(model.lastPickLattice).toBe(true);
    expect(model.lastPickCandidates).toBeLessThanOrEqual(bound(ratio));
    expectLattice(target, latticeOracle(drawn, 100, 100, ratio));
    // A second pick reuses the lattice index and does the same bounded work.
    const visits = model.lastPickCandidates;
    model.pick(100, 100);
    expect(model.lastPickCandidates).toBe(visits);
  });

  it.each([1, 2, 3])('200,000 points in a dense 40 px cluster at ratio %i, exact and on the lattice', ratio => {
    let random = 7;
    const next = () => (random = (Math.imul(1664525, random) + 1013904223) >>> 0) / 2 ** 32;
    const positions = Array.from({ length: 200_000 }, () => [80 + 40 * next(), 80 + 40 * next()] as const);
    const { data, drawn } = cloud(positions);
    for (const exactBudget of [undefined, 0]) {
      const model = scatterLookup(scatter(data), layout, formatter(data), undefined, ratio, { exactBudget });
      const target = model.pick(100.3, 100.2);
      expect(target).not.toBeNull();
      expect(model.lastPickCandidates).toBeLessThanOrEqual(exactBudget === 0 ? bound(ratio) / 2 : bound(ratio));
      if (model.lastPickLattice) expectLattice(target, latticeOracle(drawn, 100.3, 100.2, ratio));
    }
  });
});

describe('a pointer up to 1 CSS px outside the plot picks as on its edge (decision 0004, clarifications)', () => {
  // The type-matrix case: a point drawn on the top edge at y 82.267, the pointer reported at y 82.
  const rect = { x: 65.6, y: 82.267, width: 300.4, height: 150.3 };
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const layout = scatterLayout(rect, [0, 10], [0, 10]);
  const onEdges = [[0, 0], [10, 0], [0, 10], [10, 10], [5, 0], [5, 10], [0, 5], [10, 5]] as const;
  const data = points([onEdges]);
  const { x: px, y: py } = layout.projection;
  // Outward direction of each edge point (corners go out diagonally).
  const outward = onEdges.map(([x, y]) => [x === 0 ? -1 : x === 10 ? 1 : 0, y === 0 ? 1 : y === 10 ? -1 : 0] as const);
  const settings = [[1, undefined], [2, undefined], [1, 0], [2, 0], [exactRatio, undefined]] as const;
  const clamp2 = (x: number, y: number) => [clamp(x, rect.x, right), clamp(y, rect.y, bottom)] as const;

  it.each(settings)('at ratio %s (exact budget %s): 0.27, 0.99 and 1 px outside pick what the edge picks; 1.01 px nothing', (ratio, exactBudget) => {
    const model = scatterLookup(scatter(data), layout, formatter(data), undefined, ratio, { exactBudget });
    onEdges.forEach(([x, y], i) => {
      const ex = px.map(x);
      const ey = py.map(y);
      const [dx, dy] = outward[i]!;
      const edge = model.pick(ex, ey);
      expect(edge).toMatchObject({ kind: 'point', refs: [point('S0', i, x)] });
      for (const distance of [0.27, 0.99, 1]) {
        // Along one axis, and (for a corner) along both.
        if (dx) expect(model.pick(ex + dx * distance, ey)).toEqual(edge);
        if (dy) expect(model.pick(ex, ey + dy * distance)).toEqual(edge);
        expect(model.pick(ex + dx * distance, ey + dy * distance)).toEqual(edge);
      }
      if (dx) expect(model.pick(ex + dx * 1.01, ey)).toBeNull();
      if (dy) expect(model.pick(ex, ey + dy * 1.01)).toBeNull();
    });
  });

  it('for any data and any position within 1 px outside, the pick is the pick at the position moved onto the rectangle', () => {
    const coordinate = fc.oneof(fc.constant(0), fc.constant(10), fc.integer({ min: 0, max: 1000 }).map(n => n / 100));
    const unit = fc.oneof(fc.double({ min: 0, max: 1, noNaN: true }), fc.constantFrom(0, 1));
    fc.assert(fc.property(fc.array(fc.tuple(coordinate, coordinate), { minLength: 1, maxLength: 40 }), unit, unit,
      fc.constantFrom(...settings), (list, u, v, [ratio, exactBudget]) => {
        const cloud = points([list]);
        const model = scatterLookup(scatter(cloud), layout, formatter(cloud), undefined, ratio, { exactBudget });
        const x = rect.x - 1 + u * (rect.width + 2);
        const y = rect.y - 1 + v * (rect.height + 2);
        expect(model.pick(x, y)).toEqual(model.pick(...clamp2(x, y)));
      }), { numRuns: 1_000 });
  });
});

describe('a pointer move does no data-sized work (final review, finding 8; verification, finding 7)', () => {
  // Typed-array bytes allocated while `action` runs: an index built for the data would show here.
  function allocated(action: () => void): number {
    let bytes = 0;
    const restore: (() => void)[] = [];
    for (const name of ['Float64Array', 'Float32Array', 'Int32Array', 'Uint32Array', 'Uint8Array'] as const) {
      const original = globalThis[name];
      const counted = new Proxy(original, {
        construct(target, args, newTarget) {
          const result = Reflect.construct(target, args, newTarget) as InstanceType<typeof original>;
          if (!(args[0] instanceof ArrayBuffer)) bytes += result.byteLength;
          return result;
        },
      });
      Object.defineProperty(globalThis, name, { value: counted });
      Object.defineProperty(original.prototype, 'constructor', { value: counted });
      restore.push(() => {
        Object.defineProperty(original.prototype, 'constructor', { value: original });
        Object.defineProperty(globalThis, name, { value: original });
      });
    }
    try {
      action();
    } finally {
      restore.forEach(undo => undo());
    }
    return bytes;
  }

  it.each([1, 2])('the first pick at the centre of a 32,000-point ring at ratio %i', ratio => {
    const size = 32_000;
    const axis = linearScale([0, 200], [0, 200]);
    const layout = plot({ kind: 'xy', x: axis, y: axis }, 200, 200);
    const data = points([Array.from({ length: size }, (_, i) =>
      [100 + 20 * Math.cos(2 * Math.PI * i / size), 100 + 20 * Math.sin(2 * Math.PI * i / size)] as const)]);
    const model = scatterLookup(scatter(data), layout, formatter(data), undefined, ratio);
    let target: ReturnType<typeof model.pick> = null;
    // One position per point would be 256,000 bytes; the pick may allocate only what is near the pointer.
    expect(allocated(() => { target = model.pick(100, 100); })).toBeLessThan(16 * 1_024);
    expect(target).not.toBeNull();
    expect(model.lastPickLattice).toBe(true);
  });
});

describe('the lookup answers what a point group is: members, has and slot (round 3)', () => {
  const settings = [[1, undefined], [2, undefined], [1, 0], [2, 0], [exactRatio, undefined]] as const;
  type Model = ReturnType<typeof scatterLookup>;
  const key = (ref: DatumRef) => JSON.stringify(ref);

  function checkGroup(model: Model, target: Extract<PickTarget, { kind: 'point' }>, candidates: readonly DatumRef[]) {
    const all = model.members(target, 0, target.count);
    // Every member once, the first ref first, `count` of them; the tooltip's eight are the first eight.
    expect(all).toHaveLength(target.count);
    expect(new Set(all.map(key)).size).toBe(all.length);
    expect(all[0]).toEqual(target.refs[0]);
    expect(model.members(target, 0, 8)).toEqual(target.refs);
    expect(model.tooltip(target).rows.map(row => row.ref)).toEqual(model.members(target, 0, 8));
    // Paging in threes gives the same list; past the end gives nothing.
    const paged = Array.from({ length: Math.ceil(target.count / 3) }, (_, page) => model.members(target, 3 * page, 3)).flat();
    expect(paged).toEqual(all);
    expect(model.members(target, target.count, 8)).toEqual([]);
    // has agrees with members for every ref, a member rebuilt by the caller included.
    const members = new Set(all.map(key));
    for (const ref of candidates) expect(model.has(target, ref), key(ref)).toBe(members.has(key(ref)));
    for (const ref of all) expect(model.has(target, { ...ref })).toBe(true);
  }

  it('for interleaved near-coincident points of two series, exact and on the lattice', () => {
    const near = fc.tuple(fc.integer({ min: 0, max: 12 }), fc.integer({ min: 0, max: 12 })).map(([x, y]) => [40 + x / 16, 40 + y / 16] as const);
    fc.assert(fc.property(fc.array(near, { minLength: 1, maxLength: 30 }), fc.array(near, { maxLength: 30 }), fc.nat(),
      fc.constantFrom(...settings), fc.tuple(fc.integer({ min: -8, max: 8 }), fc.integer({ min: -8, max: 8 })),
      (a, b, seed, [ratio, exactBudget], [dx, dy]) => {
        const length = a.length + b.length;
        const rows = Array.from({ length }, (_, i) => i);
        let random = seed;
        for (let i = length - 1; i > 0; i--) {
          random = (Math.imul(1664525, random) + 1013904223) >>> 0;
          const j = random % (i + 1);
          [rows[i], rows[j]] = [rows[j]!, rows[i]!];
        }
        const data = points([a, b], rows);
        const model = scatterLookup(scatter(data), layout, formatter(data), undefined, ratio, { exactBudget });
        const target = model.pick(40.4 + dx / 16, 40.4 + dy / 16);
        if (target?.kind !== 'point') throw new Error('Expected a point target');
        expect(target.rule ?? 'exact').toBe(model.lastPickLattice ? 'lattice' : 'exact');
        const candidates = data.series.flatMap(series => Array.from(series.x, (x, i) => point(series.key, series.row![i]!, x)));
        checkGroup(model, target, candidates);
        for (const ref of candidates) {
          const s = data.series.findIndex(series => series.key === (ref as { seriesKey: string }).seriesKey);
          expect(model.slot(ref)).toBe(Array.from(data.series[s]!.row!).indexOf((ref as { row: number }).row));
        }
      }), { numRuns: 800 });
  });

  it('a point clipped by the y domain beside drawn ones is not a member (I8)', () => {
    // y 100 is drawn on the plot's edge at 100 px; y 100.004 is outside the domain, a fraction of a pixel past it.
    const data = points([[[50, 100], [50, 100.004]], [[50, 100]]]);
    for (const [ratio, exactBudget] of settings) {
      const model = scatterLookup(scatter(data, { yDomain: [0, 100] }), layout, formatter(data), undefined, ratio, { exactBudget });
      const target = model.pick(50, 100);
      if (target?.kind !== 'point') throw new Error('Expected a point target');
      expect(target.count).toBe(2);
      const clipped = point('S0', 1, 50);
      expect(model.has(target, clipped)).toBe(false);
      expect(model.members(target, 0, 8)).not.toContainEqual(clipped);
      checkGroup(model, target, [point('S0', 0, 50), clipped, point('S1', 2, 50)]);
      expect(model.slot(clipped)).toBe(1);
    }
  });

  it('the 32,000-point ring at ratio 1: the winning lattice group\'s page two is its other members (R3)', () => {
    const size = 32_000;
    const axis = linearScale([0, 200], [0, 200]);
    const ring = points([Array.from({ length: size }, (_, i) =>
      [100 + 20 * Math.cos(2 * Math.PI * i / size), 100 + 20 * Math.sin(2 * Math.PI * i / size)] as const)]);
    const model = scatterLookup(scatter(ring), plot({ kind: 'xy', x: axis, y: axis }, 200, 200), formatter(ring), undefined, 1);
    const target = model.pick(100, 100);
    if (target?.kind !== 'point') throw new Error('Expected a point target');
    expect(target.rule).toBe('lattice');
    expect(target.count).toBe(14);
    const two = model.members(target, 8, 8);
    expect(two).toHaveLength(6);
    const one = new Set(target.refs.map(key));
    expect(two.some(ref => one.has(key(ref)))).toBe(false);
    for (const ref of two) expect(model.has(target, ref)).toBe(true);
    checkGroup(model, target, model.members(target, 0, 14));
  });

  it('has does not walk a group of 50,000 coincident points; a second page reads about 16 entries (R5)', () => {
    const size = 50_000;
    const base = points([[]]);
    const data = { ...base, series: [{
      ...base.series[0]!, x: new Float64Array(size).fill(30), y: new Float64Array(size).fill(30),
      row: Int32Array.from({ length: size }, (_, i) => size - 1 - i),
    }] };
    const work = { locations: 0, seriesCandidates: 0, orderComparisons: 0 };
    const model = scatterLookup(scatter(data), layout, formatter(data), work);
    const target = model.pick(30, 30);
    if (target?.kind !== 'point') throw new Error('Expected a point target');
    expect(target.count).toBe(size);
    work.locations = 0;
    // Refs rebuilt by the caller, as a held selection would be.
    expect(model.has(target, point('S0', 12_345, 30))).toBe(true);
    expect(model.has(target, point('S0', size, 30))).toBe(false);
    expect(model.has({ ...target, refs: [point('S0', 7, 30)] }, point('S0', 49_000, 30))).toBe(true);
    expect(work.locations).toBe(0);
    const page = model.members(target, 8, 8);
    expect(page).toHaveLength(8);
    expect(model.lastMembersRead).toBeLessThanOrEqual(2 * 16);
    expect(model.members(target, 49_992, 8)).toHaveLength(8);
  });
});

it('aligned and donut lookups answer members, has and slot from the tooltip\'s own rows', async () => {
  const { aligned: alignedView, donut: donutView, frame: frameOf } = await import('./fixtures');
  const data = frameOf('line', { data: [0, 1, 2].map(x => ({ x, a: x, b: x + 1, c: null })), x: 'x', y: ['a', 'b', 'c'] });
  const view = alignedView(data, { visible: [true, false, true] });
  const model = buildLookup(view, plot({ kind: 'xy', x: linearScale([0, 2], [0, 100]), y: linearScale([0, 3], [100, 0]) }), formatter(data), defaultMessages);
  const target = { kind: 'x', x: 1 } as const;
  expect(model.members(target, 0, 8)).toEqual(model.tooltip(target).rows.map(row => row.ref));
  expect(model.members(target, 0, 8)).toEqual([{ kind: 'aligned', seriesKey: 'a', x: 1 }, { kind: 'aligned', seriesKey: 'c', x: 1 }]);
  expect(model.members(target, 1, 8)).toEqual([{ kind: 'aligned', seriesKey: 'c', x: 1 }]);
  expect(model.has(target, { kind: 'aligned', seriesKey: 'a', x: 1 })).toBe(true);
  expect(model.has(target, { kind: 'aligned', seriesKey: 'b', x: 1 })).toBe(false);
  expect(model.has(target, { kind: 'aligned', seriesKey: 'a', x: 2 })).toBe(false);
  expect(model.slot({ kind: 'aligned', seriesKey: 'b', x: 2 })).toBe(2);
  expect(model.slot({ kind: 'aligned', seriesKey: 'b', x: 7 })).toBe(-1);
  expect(model.slot({ kind: 'aligned', seriesKey: 'z', x: 2 })).toBe(-1);

  const slices = frameOf('donut', { data: [{ k: 'A', v: 2 }, { k: 'B', v: 3 }], label: 'k', value: 'v' });
  const ring = buildLookup(donutView(slices), plot({ kind: 'ring', cx: 50, cy: 50, r0: 20, r1: 40 }), formatter(slices), defaultMessages);
  const slice = { kind: 'slice', sliceKey: 'B' } as const;
  expect(ring.members(slice, 0, 8)).toEqual(ring.tooltip(slice).rows.map(row => row.ref));
  expect(ring.members(slice, 1, 8)).toEqual([]);
  expect(ring.has(slice, slice)).toBe(true);
  expect(ring.has(slice, { kind: 'slice', sliceKey: 'A' })).toBe(false);
  expect(ring.slot(slice)).toBe(1);
  expect(ring.slot({ kind: 'slice', sliceKey: 'Z' })).toBe(-1);
});

describe('a narrow view of a large scatter frame builds its lookup from what it shows (final check, item 6)', () => {
  // A multi-month frame: 1,000 dates with 50 measurements each, explicit source rows; the view shows one date.
  const dates = 1_000;
  const perDate = 50;
  const size = dates * perDate;
  const base = points([[]]);
  const data = { ...base, series: [{
    ...base.series[0]!,
    x: Float64Array.from({ length: size }, (_, i) => Math.floor(i / perDate)),
    y: Float64Array.from({ length: size }, (_, i) => i % perDate),
    row: Int32Array.from({ length: size }, (_, i) => i),
  }] };
  const layoutFor = (day: number) => plot({ kind: 'xy', x: linearScale([day - 0.5, day + 0.5], [0, 100]), y: linearScale([0, perDate], [100, 0]) });
  const viewOf = (day: number) => scatter(data, { xDomain: [day - 0.5, day + 0.5], visiblePoints: [{ start: day * perDate, end: (day + 1) * perDate }] });

  // Typed-array bytes and Map entries made while `action` runs.
  function work(action: () => void): { bytes: number; entries: number } {
    let bytes = 0;
    const restore: (() => void)[] = [];
    for (const name of ['Float64Array', 'Int32Array', 'Uint32Array', 'Uint8Array'] as const) {
      const original = globalThis[name];
      const counted = new Proxy(original, {
        construct(target, args, newTarget) {
          const result = Reflect.construct(target, args, newTarget) as InstanceType<typeof original>;
          if (!(args[0] instanceof ArrayBuffer)) bytes += result.byteLength;
          return result;
        },
      });
      Object.defineProperty(globalThis, name, { value: counted });
      Object.defineProperty(original.prototype, 'constructor', { value: counted });
      restore.push(() => {
        Object.defineProperty(original.prototype, 'constructor', { value: original });
        Object.defineProperty(globalThis, name, { value: original });
      });
    }
    let entries = 0;
    const set = Map.prototype.set;
    Map.prototype.set = function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
      entries++;
      return set.call(this, key, value);
    };
    try {
      action();
    } finally {
      Map.prototype.set = set;
      restore.forEach(undo => undo());
    }
    return { bytes, entries };
  }

  it('zooming and panning to one date: the work does not grow with the 49,950 points outside the view', () => {
    // The first view of the frame may index its source rows once; every later view reuses that.
    scatterLookup(viewOf(10), layoutFor(10), formatter(data));
    for (const day of [500, 501, 999]) {
      let model: ReturnType<typeof scatterLookup> | null = null;
      const spent = work(() => { model = scatterLookup(viewOf(day), layoutFor(day), formatter(data)); });
      // One shown date is 50 points: about 50 × 8-byte entries per column, never 50,000.
      expect(spent.bytes).toBeLessThan(64 * perDate * 8);
      expect(spent.entries).toBeLessThan(10 * perDate);
      // A ref rebuilt by the caller is still found without walking the 50 points at its date.
      const ref = point('S0', day * perDate + 37, day);
      expect(model!.slot({ ...ref })).toBe(day * perDate + 37);
      expect(model!.has(model!.pick(50, 100 - 37 * 2)! as Extract<PickTarget, { kind: 'point' }>, ref)).toBe(true);
    }
  });
});
