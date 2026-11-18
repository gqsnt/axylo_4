import fc from 'fast-check';
import { expect, it } from 'vitest';
import { at, axes, chart, codes, committed, date, expectCompact, lastModel, marks, pathRuns, points, reading, refAt, rows } from './model';

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
  xy.forEach((run, i) => {
    const actual = run.map(([px, py]) => {
      const index = Math.round(x.invert(px));
      expect(py).toBeCloseTo(y.map(values[index]!), 3);
      return index;
    }).filter(index => index >= from && index <= to);
    expect(extrema(actual, column, values)).toEqual(extrema(expectedRuns[i]!, column, values));
  });
}

for (const [type, kind] of [['line', 'line'], ['area', 'area'], ['compact', 'line'], ['compact', 'area']] as const) {
  it(`F5 ${type}: for every generated dense ${kind} dataset the drawing keeps each run’s column extrema and its breaks`, () => {
    const patterns = fc.array(fc.integer({ min: 1, max: 30 }), { minLength: 4, maxLength: 12 });
    fc.assert(fc.property(patterns, fc.constantFrom(1, 2), (pattern, ratio) => {
      const high = [9, 23, 29];
      const values = Array.from({ length: 580 }, (_, i) => i === 262 ? null : high.includes(i) ? 67 : pattern[i % pattern.length]!);
      const stacked = kind === 'area';
      const base = 11;
      const data = values.map((y, x) => ({ x, y, base }));
      const r = chart(type, data, {
        x: { field: 'x', domain: [0, 700] }, y: stacked ? ['base', 'y'] : 'y', stacked: stacked || undefined,
      }, { container: { width: 245, height: 220 }, console: false }, kind);
      r.host.devicePixelRatio = () => ratio;
      r.frames();
      if (stacked) {
        const expected = values.map(value => base + (value ?? 0));
        const band = marks(r, 'area').find(mark => mark.series === 1)!;
        checkExtrema(r, [points(band.upper)], expected, ratio);
      }
      const boundary = stacked ? values.map(value => value === null ? null : base + value) : values;
      const stroke = marks(r, 'path').find(mark => mark.series === Number(stacked) && mark.stroke.kind === 'series')!;
      checkExtrema(r, pathRuns(stroke.xy), boundary, ratio);
      if (type === 'compact') expectCompact(r);
      else {
        expectValuesAt(r, 23, '67', stacked ? '78' : null);
        expect(lastModel(r).summary).toContain('maximum 67');
      }
    }), { numRuns: 1_000 });
  });
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
  const r = chart('line', { columns: {
    x: Float64Array.from({ length: count }, (_, i) => i),
    y: Float64Array.from({ length: count }, (_, i) => i === outlier ? 999 : 5),
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
    expect(Math.min(...vertices.map(p => p[1]))).toBeCloseTo(y.map(999), 3);
    let dropped = 1;
    while (kept.has(dropped)) dropped++;
    const { lookup } = committed(r);
    expect(lookup.step(refAt(r, dropped - 1), 'next')).toEqual(refAt(r, dropped));
    expectValuesAt(r, dropped, '5', null);
  }
  expect(lastModel(r).summary).toContain('maximum 999');
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
    const values = Array.from({ length: 900 }, (_, i) => i === 250 ? null : i === 249 ? 29 : i === 251 ? 31 : 3);
    const r = chart(type, values.map((y, x) => ({ x, y })), {}, { container: { width: 245, height: 220 } });
    let ratio = 1;
    r.host.devicePixelRatio = () => ratio;
    r.frames();
    for (const [from, to, dpr] of [[0, 899, 1], [110, 760, 2]] as const) {
      ratio = dpr;
      r.controller.invalidate.pixelRatio();
      r.controller.handle.zoom([from, to]);
      r.frames();
      checkExtrema(r, pathRuns(marks(r, 'path')[0]!.xy), values, ratio, from, to);
      expect(at(r, 250).rows[0]?.value).toBe('No data');
      expect(at(r, 249).rows[0]?.value).toBe('29');
      expect(at(r, 251).rows[0]?.value).toBe('31');
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
  const values = Array.from({ length: 700 }, (_, i) => i === 250 ? null : i === 249 ? 29 : i === 251 ? 31 : 3);
  const r = chart('line', values.map((y, x) => ({ x, y })), { x: { field: 'x', domain: [0, 500_000] } });
  r.frames();
  const { x } = axes(r);
  if (x.type === 'band') throw new Error('Expected continuous x');
  const columns = [249, 250, 251].map(sample => Math.floor(x.map(sample)));
  expect(new Set(columns).size).toBe(1);
  const runs = pathRuns(marks(r, 'path')[0]!.xy);
  checkExtrema(r, runs, values, 1);
  expect(runs.map(run => Math.round(x.invert(run[0]![0])))).toEqual([0, 251]);
  expect(runs.map(run => Math.round(x.invert(run.at(-1)![0])))).toEqual([249, 699]);
  expectValuesAt(r, 249, '29', null);
  expectValuesAt(r, 251, '31', null);
});
