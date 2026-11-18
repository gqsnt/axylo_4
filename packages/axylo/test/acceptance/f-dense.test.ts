import fc from 'fast-check';
import { expect, it } from 'vitest';
import { at, axes, chart, codes, committed, date, expectCompact, lastModel, marks, message, plot, pathRuns, points, reading, refAt, rows } from './model';

type Sample = number | null;

function observedRuns(values: readonly Sample[]) {
  const result: number[][] = [];
  let run: number[] = [];
  values.forEach((value, index) => {
    if (value !== null) run.push(index);
    else if (run.length) {
      result.push(run);
      run = [];
    }
  });
  if (run.length) result.push(run);
  return result;
}

function extrema(indexes: readonly number[], column: (i: number) => number, values: readonly Sample[]) {
  const result = new Map<number, [number, number]>();
  for (const i of indexes) {
    const key = column(i);
    const value = values[i]!;
    const bounds = result.get(key);
    result.set(key, bounds ? [Math.min(bounds[0], value), Math.max(bounds[1], value)] : [value, value]);
  }
  return [...result];
}

function checkExtrema(r: ReturnType<typeof chart>, xy: readonly [number, number][][], values: readonly Sample[], ratio: number, from = 0, to = values.length - 1) {
  const { x, y } = axes(r);
  if (x.type === 'band') throw new Error('Expected a numeric projection');
  const column = (i: number) => Math.floor(x.map(i) * ratio);
  const expectedRuns = observedRuns(values.slice(from, to + 1)).filter(run => run.length > 1).map(run => run.map(i => i + from));
  expect(xy).toHaveLength(expectedRuns.length);
  let largestError = 0;
  xy.forEach((run, i) => {
    const actual = run.map(([px, py]) => {
      const index = Math.round(x.invert(px));
      largestError = Math.max(largestError, Math.abs(py - y.map(values[index]!)));
      return index;
    }).filter(index => index >= from && index <= to);
    expect(extrema(actual, column, values)).toEqual(extrema(expectedRuns[i]!, column, values));
  });
  expect(largestError).toBeLessThan(0.001);
}

const denseSize = 6_001;
const denseHost = { container: { width: 200, height: 220 }, console: false };
type DensePattern = { background: number[]; start: number; shift: number; peak: number; dip: number };
const densePattern: fc.Arbitrary<DensePattern> = fc.record({
  background: fc.array(fc.integer({ min: 4, max: 25 }), { minLength: 3, maxLength: 12 }),
  start: fc.integer({ min: 1_000, max: 3_600 }),
  shift: fc.integer({ min: 0, max: 8 }),
  peak: fc.integer({ min: 51, max: 100 }),
  dip: fc.integer({ min: 1, max: 3 }),
});

function denseValues({ background, start, shift, peak, dip }: DensePattern) {
  const values: Sample[] = Array.from({ length: denseSize }, (_, i) => background[i % background.length]!);
  const base = Float64Array.from({ length: denseSize }, (_, i) => 35 - values[i]!);
  const clusters = Array.from({ length: 24 }, (_, i) => start + shift + i * 11 + i % 5);
  for (const at of clusters) {
    values[at] = dip;
    values[at + 1] = peak;
    values[at + 3] = null;
    values[at + 4] = peak + 1;
    values[at + 5] = dip;
  }
  return { values, base, clusters };
}

function checkDense(type: 'line' | 'area' | 'compact', kind: 'line' | 'area', pattern: DensePattern,
  ratio: number, window: readonly [number, number], verifyReadout = false) {
  const { values, base, clusters } = denseValues(pattern);
  const stacked = kind === 'area';
  const [from, to] = window;
  const r = chart(type, { columns: {
    x: Float64Array.from({ length: denseSize }, (_, i) => i),
    y: Float64Array.from(values, value => value ?? NaN),
    base,
  } }, { x: { field: 'x', domain: type === 'compact' ? window : [0, denseSize - 1] }, y: stacked ? ['base', 'y'] : 'y', stacked: stacked || undefined }, denseHost, kind);
  r.host.devicePixelRatio = () => ratio;
  r.controller.invalidate.pixelRatio();
  if (type !== 'compact') r.controller.handle.zoom(window);
  r.frames();
  expect(committed(r).pixelRatio).toBe(ratio);
  const { x } = axes(r);
  if (x.type === 'band') throw new Error('Expected continuous x');
  const columns = Math.ceil((plot(r).plot.x + plot(r).plot.width) * ratio) - Math.floor(plot(r).plot.x * ratio);
  const supplied = values.slice(from, to + 1).filter(value => value !== null).length;
  expect(supplied).toBeGreaterThanOrEqual(10 * columns);
  const stroke = marks(r, 'path').find(mark => mark.series === Number(stacked) && mark.stroke.kind === 'series')!;
  const runs = pathRuns(stroke.xy);
  expect(runs.reduce((count, run) => count + run.length, 0), 'the drawing must actually simplify').toBeLessThan(supplied);
  const column = (slot: number) => Math.floor(x.map(slot) * ratio);
  expect(clusters.some(i => column(i - 1) === column(i + 6))).toBe(true);
  const upper = values.map((value, i) => (value ?? 0) + base[i]!);
  checkExtrema(r, runs, stacked ? upper.map((value, i) => values[i] === null ? null : value) : values, ratio, from, to);
  if (stacked) {
    const band = marks(r, 'area').find(mark => mark.series === 1)!;
    checkExtrema(r, [points(band.upper)], upper, ratio, from, to);
    checkExtrema(r, [points(band.lower)], Array.from(base), ratio, from, to);
  }
  if (type === 'compact') expectCompact(r);
  else {
    expect(at(r, clusters[0]! + 3).rows.at(-1)?.value).toBe('No data');
    expect(at(r, clusters[0]! + 1).rows.at(-1)?.value).toBe(String(pattern.peak));
    if (verifyReadout) {
      const kept = new Set(runs.flatMap(run => run.map(([px]) => Math.round(x.invert(px)))));
      let dropped = from + 1;
      while (kept.has(dropped)) dropped++;
      expect(dropped).toBeLessThan(clusters[0]!);
      const ref = { ...refAt(r, dropped), seriesKey: 'y' };
      const previous = { ...refAt(r, dropped - 1), seriesKey: 'y' };
      const { lookup } = committed(r);
      expect(lookup.step(previous, 'next')).toEqual(ref);
      expect(committed(r).reader.table?.row(dropped - from)?.at(-1)).toBe(String(values[dropped]));
      expect(reading(r, ref, 'single')).toContain(String(values[dropped]));
    }
  }
}

const windows = [[0, 6_000], [400, 5_800], [800, 6_000]] as const;
for (const [type, kind] of [['line', 'line'], ['area', 'area'], ['compact', 'line'], ['compact', 'area']] as const) {
  it(`F5 ${type}: for every generated dense ${kind} dataset the drawing keeps each run’s column extrema and its breaks`, () => {
    fc.assert(fc.property(densePattern, fc.constantFrom(1, 2), fc.constantFrom(...windows), (pattern, ratio, window) => {
      checkDense(type, kind, pattern, ratio, window);
    }), { numRuns: 1_000 });
  }, 40_000);
}

function expectValuesAt(r: ReturnType<typeof chart>, index: number, expected: string, total: string | null) {
  const tooltip = at(r, index);
  expect(tooltip.rows.at(-1)?.value).toBe(expected);
  expect(tooltip.total).toBe(total);
  expect(committed(r).reader.table?.row(index)?.at(-1)).toBe(expected);
  expect(reading(r, refAt(r, index))).toContain(expected);
}

it('F5 line: one outlier in one million stays drawn at DPR 1 and 2 and a dropped sample stays reachable by keyboard and table', () => {
  const count = 1_000_000;
  const outlier = 500_123;
  const dip = 500_124;
  const r = chart('line', { columns: {
    x: Float64Array.from({ length: count }, (_, i) => i),
    y: Float64Array.from({ length: count }, (_, i) => i === outlier ? 999 : i === dip ? -999 : 5),
  } });
  let ratio = 1;
  r.host.devicePixelRatio = () => ratio;
  r.frames();
  for (const next of [1, 2]) {
    ratio = next;
    r.controller.invalidate.pixelRatio();
    r.frames();
    expect(committed(r).pixelRatio).toBe(next);
    const { x, y } = axes(r);
    if (x.type === 'band') throw new Error('Expected continuous x');
    const vertices = points(marks(r, 'path')[0]!.xy);
    const kept = new Set(vertices.map(([px]) => Math.round(x.invert(px))));
    expect(vertices.length).toBeLessThan(4_000);
    expect(kept.has(outlier)).toBe(true);
    expect(kept.has(dip)).toBe(true);
    expect(Math.min(...vertices.map(p => p[1]))).toBeCloseTo(y.map(999), 3);
    expect(Math.max(...vertices.map(p => p[1]))).toBeCloseTo(y.map(-999), 3);
    let dropped = 1;
    while (kept.has(dropped)) dropped++;
    const { lookup } = committed(r);
    expect(lookup.step(refAt(r, dropped - 1), 'next')).toEqual(refAt(r, dropped));
    expectValuesAt(r, dropped, '5', null);
  }
  expect(lastModel(r).summary).toContain(message('seriesSummary', { series: 'y', min: '-999', max: '999', last: '5' }));
});

it('F5 line: alternating null and valid slots produce isolated markers and no false segments', () => {
  const r = chart('line', Array.from({ length: 800 }, (_, x) => ({ x, y: x % 2 === 0 ? 1 : null })));
  r.frames();
  expect(marks(r, 'path')).toEqual([]);
  expect(marks(r, 'points')[0]?.xy).toHaveLength(800);
  expect(at(r, 41).rows[0]?.value).toBe('No data');
  expect(committed(r).reader.table?.row(41)?.[1]).toBe('No data');
});

it('F5 line: weekly observations connect across daily observations without inventing weekly rows', () => {
  const data = Array.from({ length: 15 }, (_, i) => ({ x: date(i), y: 10, s: 'Daily' }));
  data.push({ x: date(0), y: 2, s: 'Weekly' }, { x: date(7), y: 4, s: 'Weekly' }, { x: date(14), y: 3, s: 'Weekly' });
  const r = chart('line', data, { x: { field: 'x', type: 'time' }, series: 's' });
  r.frames();
  const weekly = marks(r, 'path').find(mark => mark.series === 1)!;
  expect(pathRuns(weekly.xy).map(run => run.length)).toEqual([3]);
  expect(at(r, date(3)).rows.map(row => row.value)).toEqual(['10', 'No observation']);
  expect(rows(r)[3]?.[2]).toBe('No observation');
});

for (const type of ['line', 'area'] as const) {
  it(`T-dense-${type} ${type}: two peaks and their gap survive at two zoom levels and two device-pixel ratios`, () => {
    for (const window of windows) for (const ratio of [1, 2]) {
      checkDense(type, type, { background: [18, 20, 18, 18], start: 1_300, shift: 3, peak: 67, dip: 2 }, ratio, window, true);
    }
  });
}

it('T-dense-bar bar: more bars than pixels raises AX132 and every rectangle is still drawn', () => {
  const r = chart('bar', Array.from({ length: 375 }, (_, i) => ({ x: 'Band ' + i, y: 1 })), {}, { container: { width: 240, height: 240 } });
  r.frames();
  expect(codes(r)).toContain('AX132');
  expect(marks(r, 'rects')[0]?.xywh).toHaveLength(375 * 4);
  expect(committed(r).reader.table?.rowCount).toBe(375);
});

it('T-dense-donut donut: eight small positive slices retain all eight arcs', () => {
  const r = chart('donut', Array.from({ length: 8 }, (_, i) => ({ x: 'Band ' + i, y: i === 0 ? 100_000 : 1 })));
  r.frames();
  expect(codes(r)).toEqual([]);
  expect(marks(r, 'arcs')[0]?.angles).toHaveLength(16);
  expect(committed(r).reader.table?.rowCount).toBe(8);
});

it('T-dense-scatter scatter: the hint starts above 50,000 points and none are simplified away', () => {
  for (const length of [50_000, 50_001]) {
    const r = chart('scatter', { columns: { x: Float64Array.from({ length }, (_, i) => i), y: new Float32Array(length).fill(4) } });
    r.frames();
    expect(codes(r)).toEqual(length > 50_000 ? ['AX133'] : []);
    expect(marks(r, 'points')[0]?.xy).toHaveLength(length * 2);
    expect(committed(r).reader.table?.rowCount).toBe(length);
  }
});

it('F5 line: two peaks separated by a null in one device column remain in separate drawn runs', () => {
  checkDense('line', 'line', { background: [5, 5, 5], start: 1_100, shift: 2, peak: 67, dip: 1 }, 1, windows[0]);
});
