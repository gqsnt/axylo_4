import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  SLOT_ABSENT_FIELD, SLOT_GAP, SLOT_INVALID, SLOT_NO_ROW, SLOT_NULL, SLOT_VALUE, type Series,
} from '../../src/core/contracts';
import { readerDisclosure } from '../../src/diagnostics';
import { aligned, check, contents } from './helpers';

const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const dirty = [10, 20, null, NaN, '40', undefined, 70];
const input = (values: readonly unknown[]) => ({
  data: values.map((value, row) => ({ day: weekdays[row], value })), x: 'day', y: 'value',
});
const day = 86_400_000;

function runs(series: Series): number[][] {
  const result: number[][] = [];
  let previous = -1;
  for (let index = 0; index < series.slot.length; index++) {
    if (series.slot[index] === SLOT_VALUE) {
      if (previous < 0) result.push([]);
      result.at(-1)!.push(index);
      previous = index;
    } else if (series.slot[index] !== SLOT_NO_ROW) {
      previous = -1;
    }
  }
  return result;
}

describe('F2 and F3 slot states', () => {
  it('preserves the combined dirty fixture, Mon–Tue segment, and isolated Sun point', () => {
    const { frame, diagnostics } = aligned(input(dirty));
    const series = frame.series[0]!;
    expect([...series.slot]).toEqual([SLOT_VALUE, SLOT_VALUE, SLOT_NULL, SLOT_INVALID, SLOT_INVALID, SLOT_ABSENT_FIELD, SLOT_VALUE]);
    expect([...series.y]).toEqual([10, 20, NaN, NaN, NaN, NaN, 70]);
    expect([...series.row!]).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(runs(series)).toEqual([[0, 1], [6]]);
    expect(diagnostics.inputs().map(d => [d.code, d.rows, d.count])).toEqual([
      ['AX103', [3], 1], ['AX106', [4], 1], ['AX102', [5], 1],
    ]);
    expect(readerDisclosure(diagnostics.inputs())).toEqual({ omitted: 3, changed: 0 });
  });

  it.each([
    { name: 'null', value: null, slot: SLOT_NULL, row: 2, codes: [] },
    { name: 'NaN', value: NaN, slot: SLOT_INVALID, row: 3, codes: ['AX103'] },
    { name: 'string', value: '40', slot: SLOT_INVALID, row: 4, codes: ['AX106'] },
    { name: 'undefined', value: undefined, slot: SLOT_ABSENT_FIELD, row: 5, codes: ['AX102'] },
  ])('keeps the dirty-$name fixture as a single gap', ({ value, slot, row, codes }) => {
    const data = [10, 20, 30, 40, 50, 60, 70] as unknown[];
    data[row] = value;
    const { frame, diagnostics } = aligned(input(data));
    expect([...frame.series[0]!.slot]).toEqual(data.map((_, i) => i === row ? slot : SLOT_VALUE));
    expect(diagnostics.inputs().map(d => d.code)).toEqual(codes);
    expect(runs(frame.series[0]!)).toEqual([[...Array(row).keys()], [...Array(data.length - row - 1).keys()].map(i => i + row + 1)]);
  });

  it('parses whole columns of decimal strings, with an opt-in to silence AX104', () => {
    const data = input(['40', '-1.5', '+3e2', '', null, '3.25E-1']);
    const implicit = aligned(data);
    const explicit = aligned({ ...data, y: { field: 'value', parse: 'number' } });
    expect([...implicit.frame.series[0]!.y]).toEqual([40, -1.5, 300, NaN, NaN, 0.325]);
    expect([...implicit.frame.series[0]!.slot]).toEqual([SLOT_VALUE, SLOT_VALUE, SLOT_VALUE, SLOT_NULL, SLOT_NULL, SLOT_VALUE]);
    expect(implicit.diagnostics.inputs()).toMatchObject([{ code: 'AX104', rows: [0, 1, 2, 5], count: 4 }]);
    expect(contents(explicit.frame)).toEqual(contents(implicit.frame));
    expect(explicit.diagnostics.inputs()).toEqual([]);
    const invalid = aligned(input(['1,234', '9', 'n/a']));
    expect(invalid.diagnostics.inputs()).toMatchObject([{ code: 'AX106', rows: [0, 1, 2], count: 3 }]);
    expect([...invalid.frame.series[0]!.slot]).toEqual([SLOT_INVALID, SLOT_INVALID, SLOT_INVALID]);
  });

  it('represents seven explicit nulls and seven deleted daily rows with the same disallowed joins', () => {
    const missing = new Set([2, 3, 4, 8, 11, 16, 17]);
    const full = Array.from({ length: 21 }, (_, i) => ({
      date: '2026-04-' + String(i + 1).padStart(2, '0'), value: missing.has(i) ? null : i + 1,
    }));
    const explicit = aligned({ data: full, x: 'date', y: 'value' });
    const deleted = aligned({ data: full.filter((_, i) => !missing.has(i)), x: 'date', y: 'value' });
    expect([...deleted.frame.x.values]).toEqual(full.map((_, i) => Date.UTC(2026, 3, i + 1)));
    expect([...explicit.frame.series[0]!.slot]).toEqual(full.map((_, i) => missing.has(i) ? SLOT_NULL : SLOT_VALUE));
    expect([...deleted.frame.series[0]!.slot]).toEqual(full.map((_, i) => missing.has(i) ? SLOT_GAP : SLOT_VALUE));
    expect(explicit.diagnostics.inputs()).toEqual([]);
    expect(deleted.diagnostics.inputs()).toMatchObject([{ code: 'AX105', count: 7 }]);
    expect(runs(explicit.frame.series[0]!)).toEqual([[0, 1], [5, 6, 7], [9, 10], [12, 13, 14, 15], [18, 19, 20]]);
    expect(runs(deleted.frame.series[0]!)).toEqual(runs(explicit.frame.series[0]!));
  });

  it('uses independent grids and lets weekly lines bridge daily-only slots', () => {
    const daily = Array.from({ length: 15 }, (_, i) => ({ x: i, y: i, series: 'daily' }));
    const weekly = [0, 7, 14].map(x => ({ x, y: x, series: 'weekly' }));
    const { frame, diagnostics } = aligned({ data: [...daily, ...weekly], x: 'x', y: 'y', series: 'series' });
    expect([...frame.series[1]!.slot]).toEqual(daily.map(({ x }) => x % 7 === 0 ? SLOT_VALUE : SLOT_NO_ROW));
    expect(runs(frame.series[1]!)).toEqual([[0, 7, 14]]);
    expect(diagnostics.inputs()).toEqual([]);
  });

  it('marks expected gaps that already have another series observation', () => {
    const data = [{ x: 3, y: 10, series: 'B' }, ...[1, 2, 4, 5].map(x => ({ x, y: x, series: 'A' }))];
    const { frame, diagnostics } = aligned({ data, x: 'x', y: 'y', series: 'series' });
    expect([...frame.x.values]).toEqual([1, 2, 3, 4, 5]);
    expect([...frame.series[1]!.slot]).toEqual([SLOT_VALUE, SLOT_VALUE, SLOT_GAP, SLOT_VALUE, SLOT_VALUE]);
    expect(diagnostics.inputs()).toMatchObject([{ code: 'AX105', count: 1 }]);
  });

  it('imputes zero for absent fields, nulls, gaps, and no row, with no invented provenance', () => {
    const data = [
      { x: 0, y: null, group: 'A' }, { x: 1, y: undefined, group: 'A' },
      { x: 3, y: Infinity, group: 'A' }, { x: 4, y: 7, group: 'A' },
      { x: 5, y: 5, group: 'B' },
    ];
    const { frame, diagnostics } = aligned({ data, x: 'x', y: { field: 'y', missing: 'zero' }, series: 'group' });
    expect([...frame.series[0]!.slot]).toEqual([SLOT_VALUE, SLOT_VALUE, SLOT_VALUE, SLOT_INVALID, SLOT_VALUE, SLOT_VALUE]);
    expect([...frame.series[0]!.y]).toEqual([0, 0, 0, NaN, 7, 0]);
    expect([...frame.series[0]!.row!]).toEqual([-1, -1, -1, 2, 3, -1]);
    expect(readerDisclosure(diagnostics.inputs())).toEqual({ omitted: 1, changed: 1 });
  });
});

describe('F4 x kinds', () => {
  const dates = ['2024-02-28', '2024-02-29', '2024-03-01'];
  const millis = [Date.UTC(2024, 1, 28), Date.UTC(2024, 1, 29), Date.UTC(2024, 2, 1)];

  it.each(['UTC', 'America/Los_Angeles', 'Asia/Kolkata'])('keeps date positions and resolves instant zones for %s', timeZone => {
    const variants = [
      { x: 'x', values: dates },
      { x: 'x', values: dates.map(text => text + 'T00:00:00Z') },
      { x: { field: 'x', type: 'time', timeZone: 'local' }, values: millis },
      { x: 'x', values: millis.map(value => new Date(value)) },
    ];
    for (const [variant, { x, values }] of variants.entries()) {
      const { frame, diagnostics } = aligned({ data: values.map(x => ({ x, y: 5 })), x, y: 'y' }, { timeZone });
      expect([...frame.x.values]).toEqual(millis);
      expect(frame.x).toMatchObject(variant === 0
        ? { kind: 'date', dateUnit: 'day', timeZone: null }
        : { kind: 'time', dateUnit: null, timeZone: Intl.DateTimeFormat('en', { timeZone }).resolvedOptions().timeZone });
      expect(diagnostics.inputs().map(d => d.code)).toEqual(variant === 0 ? [] : ['AX111']);
    }
  });

  it('preserves precision and infers missing calendar months without assuming equal millisecond lengths', () => {
    const data = ['2026-01', '2026-02', '2026-04', '2026-05'].map(x => ({ x, y: 1 }));
    const monthly = aligned({ data, x: 'x', y: 'y' });
    expect(monthly.frame.x.dateUnit).toBe('month');
    expect([...monthly.frame.x.values]).toEqual([0, 1, 2, 3, 4].map(i => Date.UTC(2026, i, 1)));
    expect([...monthly.frame.series[0]!.slot]).toEqual([SLOT_VALUE, SLOT_VALUE, SLOT_GAP, SLOT_VALUE, SLOT_VALUE]);
    const yearly = aligned({ data: [{ x: '2026', y: 1 }], x: 'x', y: 'y' });
    expect(yearly.frame.x.dateUnit).toBe('year');
    expect(yearly.frame.x.values[0]).toBe(Date.UTC(2026, 0, 1));
    const mixed = aligned({ data: ['2024', '2024-02', '2024-02-29'].map(x => ({ x, y: 1 })), x: 'x', y: 'y' });
    expect(mixed.frame.x.dateUnit).toBe('day');
    expect([...mixed.frame.x.values]).toEqual([Date.UTC(2024, 0, 1), Date.UTC(2024, 1, 1), Date.UTC(2024, 1, 29)]);
  });

  it('handles wall-clock text and explicit offsets without using the viewer zone for parsing', () => {
    const wall = aligned({ data: [{ x: '2026-02-24T02:15:00', y: 4 }], x: 'x', y: 'y' }, { timeZone: 'Asia/Kolkata' });
    expect(wall.frame.x).toMatchObject({ kind: 'wall', timeZone: null });
    expect(wall.frame.x.values[0]).toBe(Date.UTC(2026, 1, 24, 2, 15));
    expect(wall.diagnostics.inputs().map(d => d.code)).toEqual(['AX112']);
    const zoned = aligned({
      data: [{ x: '2026-02-24T02:15:00+05:30', y: 4 }],
      x: { field: 'x', timeZone: 'UTC' }, y: 'y',
    }, { timeZone: 'Asia/Kolkata' });
    expect(zoned.frame.x).toMatchObject({ kind: 'time', timeZone: 'UTC' });
    expect(zoned.frame.x.values[0]).toBe(Date.UTC(2026, 1, 23, 20, 45));
  });

  it.each([
    { name: 'March', dates: ['2026-03-07T00:00:00-08:00', '2026-03-08T00:00:00-08:00', '2026-03-09T00:00:00-07:00', '2026-03-10T00:00:00-07:00'], change: 23 },
    { name: 'November', dates: ['2026-10-31T00:00:00-07:00', '2026-11-01T00:00:00-07:00', '2026-11-02T00:00:00-08:00', '2026-11-03T00:00:00-08:00'], change: 25 },
  ])('keeps the $name DST transition on the daily grid', ({ dates, change }) => {
    const { frame, diagnostics } = aligned({ data: dates.map(x => ({ x, y: 1 })), x: 'x', y: 'y' }, { timeZone: 'America/Los_Angeles' });
    expect(frame.x.values[2]! - frame.x.values[1]!).toBe(change * day / 24);
    expect([...frame.series[0]!.slot]).toEqual([SLOT_VALUE, SLOT_VALUE, SLOT_VALUE, SLOT_VALUE]);
    expect(diagnostics.inputs().map(d => d.code)).toEqual(['AX111']);
  });

  it('does not silently mix temporal kinds and honors a declared category', () => {
    const data = ['2026-02-28', '2026-03-01T00:00:00Z', '2026-03-02T00:00:00'].map(x => ({ x, y: 1 }));
    const inferred = aligned({ data, x: 'x', y: 'y' });
    expect(inferred.frame.x.kind).toBe('date');
    expect(inferred.diagnostics.inputs()).toMatchObject([{ code: 'AX107', rows: [1, 2], count: 2 }]);
    const categories = aligned({ data, x: { field: 'x', type: 'category', ordered: true }, y: 'y' });
    expect(categories.frame.x).toMatchObject({ kind: 'category', ordered: true, categories: data.map(row => row.x) });
    expect(categories.diagnostics.inputs()).toEqual([]);
  });
});

describe('F8, F11 and DX2 frame shapes', () => {
  it('sorts shuffled input and preserves original row indexes', () => {
    const data = [{ x: 0, y: 3 }, { x: 1, y: 1 }, { x: 2, y: 2 }];
    const opts = { data, x: 'x', y: 'y' };
    const sorted = aligned(opts).frame;
    const shuffled = aligned({ ...opts, data: [data[2], data[0], data[1]] }).frame;
    expect([...shuffled.x.values]).toEqual([...sorted.x.values]);
    expect([...shuffled.series[0]!.y]).toEqual([3, 1, 2]);
    expect([...shuffled.series[0]!.row!]).toEqual([1, 2, 0]);
    expect(shuffled.source.rowAt(0)).toBe(data[2]);
  });

  it('preserves the first row and disables every affected wide series for duplicate x', () => {
    const data = [{ x: 2, a: 2, b: 22 }, { x: 1, a: 1, b: 11 }, { x: 2, a: 99, b: 99 }, { x: 3, a: 3, b: 33 }];
    const { frame, diagnostics } = aligned({ data, x: 'x', y: ['a', 'b'] });
    expect(frame.series.map(s => s.drawable)).toEqual([false, false]);
    expect(frame.series.map(s => [...s.y])).toEqual([[1, 2, 3], [11, 22, 33]]);
    expect(diagnostics.inputs()).toMatchObject([{ code: 'AX108', count: 2, rows: [2] }]);
  });

  it('produces equal aligned values and slots from long, wide and typed inputs', () => {
    const wide = [
      { x: 2, a: 20, b: 200 }, { x: 0, a: 0, b: 100 }, { x: 1, a: null, b: 120 },
    ];
    const long = wide.flatMap(({ x, a, b }) => [{ x, group: 'a', y: a }, { x, group: 'b', y: b }]);
    const typed = { columns: { x: Float64Array.of(2, 0, 1), a: Float32Array.of(20, 0, NaN), b: Float64Array.of(200, 100, 120) } };
    for (const opts of [{ data: wide, y: ['a', 'b'] }, { data: long, y: 'y', series: 'group' }, { data: typed, y: ['a', 'b'] }]) {
      const { frame, diagnostics } = aligned({ ...opts, x: 'x' });
      expect([...frame.x.values]).toEqual([0, 1, 2]);
      expect(frame.series.map(s => [...s.y])).toEqual([[0, NaN, 20], [100, 120, 200]]);
      expect(frame.series.map(s => [...s.slot])).toEqual([[SLOT_VALUE, SLOT_NULL, SLOT_VALUE], [SLOT_VALUE, SLOT_VALUE, SLOT_VALUE]]);
      expect(diagnostics.inputs()).toEqual([]);
    }
    const testWide = aligned({ data: [{ x: 0, a: 1, b: 2 }, { x: 1, a: Infinity, b: 4 }], x: 'x', y: ['a', 'b'] });
    const testLong = aligned({ data: [{ x: 0, group: 'a', y: 1 }, { x: 0, group: 'b', y: 2 },
      { x: 1, group: 'a', y: Infinity }, { x: 1, group: 'b', y: 4 }], x: 'x', y: 'y', series: 'group' });
    const testTyped = aligned({ data: { columns: { x: [0, 1], a: Float32Array.of(1, Infinity), b: [2, 4] } }, x: 'x', y: ['a', 'b'] });
    expect(testWide.diagnostics.inputs()).toMatchObject([{ code: 'AX103', field: 'a', rows: [1] }]);
    expect(testLong.diagnostics.inputs()).toMatchObject([{ code: 'AX103', field: 'y', rows: [2] }]);
    expect(testTyped.diagnostics.inputs()).toMatchObject([{ code: 'AX103', field: 'a', rows: [1] }]);
    expect(testTyped.frame.source.rowAt(1)).toEqual({ x: 1, a: Infinity, b: 4 });
    expect(testTyped.frame.series[0]!.y[1]).toBeNaN();
  });

  it('sorts scatter points by x then y and retains provenance while omitting invalid points', () => {
    const data = [
      { x: 2, y: 8, group: 'A' }, { x: 1, y: 5, group: 'A' }, { x: 1, y: 3, group: 'A' },
      { x: 0, y: 7, group: 'B' }, { x: undefined, y: 3, group: 'B' }, { x: 4, y: null, group: 'B' },
      { x: 5, y: NaN, group: 'B' },
    ];
    const { frame, diagnostics } = check('scatter', { data, x: { field: 'x', label: 'Hours', unit: 'h' }, y: { field: 'y', unit: 'kg' }, series: 'group' });
    if (frame.shape !== 'points') throw new Error('Expected a point frame');
    expect(frame).toMatchObject({ xLabel: 'Hours', xUnit: 'h', yUnit: 'kg', xKind: 'number' });
    expect(frame.series.map(s => [[...s.x], [...s.y], [...s.row!], s.drawable])).toEqual([
      [[1, 1, 2], [3, 5, 8], [2, 1, 0], true], [[0], [7], [3], true],
    ]);
    expect(frame.source.rowAt(2)).toBe(data[2]);
    expect(diagnostics.inputs()).toMatchObject([
      { code: 'AX102', field: 'x', rows: [4] }, { code: 'AX103', field: 'y', rows: [6] },
    ]);
  });

  it.each(['gap', 'zero'] as const)('normalizes scatter observations with missing y in %s mode', missing => {
    const data = [
      { x: 8, y: null, group: 'B' }, { x: 4, group: 'A' }, { x: 2, y: null, group: 'A' },
      { x: 4, y: null, group: 'A' }, { x: 4, y: -2, group: 'A' }, { x: 1, y: 0, group: 'B' },
      { group: 'A' }, { x: 5, y: NaN, group: 'B' }, { x: 6, y: 'bad', group: 'B' },
    ];
    const { frame, diagnostics } = check('scatter', { data, x: 'x', y: { field: 'y', missing }, series: 'group' });
    if (frame.shape !== 'points') throw new Error('Expected a point frame');
    expect(frame.series.map(s => [s.key, [...s.x], [...s.y], [...s.row!], [...(s.missingX ?? [])]])).toEqual(missing === 'gap' ? [
      ['B', [1], [0], [5], [5, 6, 8]], ['A', [4], [-2], [4], [2, 4, 4]],
    ] : [
      ['B', [1, 8], [0, 0], [5, 0], [5, 6]], ['A', [2, 4, 4, 4], [0, -2, 0, 0], [2, 4, 1, 3], []],
    ]);
    const issues = diagnostics.inputs();
    expect(issues.map(({ code, field, effect, count, rows }) => [code, field, effect, count, rows])).toEqual([
      ['AX102', 'x', 'omitted', 1, [6]],
      ['AX102', 'y', missing === 'zero' ? 'changed' : 'omitted', 1, [1]],
      ['AX103', 'y', 'omitted', 1, [7]],
      ['AX106', 'y', 'omitted', 1, [8]],
    ]);
    expect(issues[1]!.message).toContain(missing === 'zero' ? 'Shown as zeros.' : 'The affected points are not drawn.');
  });

  it('uses typed-column NaN as missing y and leaves the caller columns intact', () => {
    const data = { columns: { x: Float64Array.of(1, 2, 3), y: Float64Array.of(5, NaN, 0) } };
    const gap = check('scatter', { data, x: 'x', y: 'y' });
    const zero = check('scatter', { data, x: 'x', y: { field: 'y', missing: 'zero' } });
    if (gap.frame.shape !== 'points' || zero.frame.shape !== 'points') throw new Error('Expected point frames');
    expect(gap.frame.series[0]!.missingX).toEqual(Float64Array.of(2));
    expect(zero.frame.series[0]!.x).toBe(data.columns.x);
    expect(zero.frame.series[0]!.y).toEqual(Float64Array.of(5, 0, 0));
    expect(zero.frame.source.rowAt(1)).toEqual({ x: 2, y: NaN });
    expect(gap.diagnostics.inputs()).toEqual([]);
    expect(zero.diagnostics.inputs()).toEqual([]);
  });

  it('keeps donut labels, values, zeros and nulls in caller order', () => {
    const data = [{ label: 'East', count: 0 }, { label: 'West', count: null }, { label: 'North', count: 15 }];
    const { frame, diagnostics } = check('donut', { data, label: 'label', value: { field: 'count', label: 'Count', unit: 'people' } });
    if (frame.shape !== 'donut') throw new Error('Expected a donut frame');
    expect(frame.labels).toEqual(['East', 'West', 'North']);
    expect([...frame.values]).toEqual([0, NaN, 15]);
    expect([...frame.slot]).toEqual([SLOT_VALUE, SLOT_NULL, SLOT_VALUE]);
    expect([...frame.row!]).toEqual([0, 1, 2]);
    expect(frame.source.rowAt(1)).toBe(data[1]);
    expect(frame).toMatchObject({ valueLabel: 'Count', unit: 'people', valueScale: null });
    expect(diagnostics.inputs()).toEqual([]);
  });

  it('borrows one million ascending typed values with a warmed median under 100 ms', () => {
    const length = 1_000_000;
    const x = new Float64Array(length);
    const y = new Float32Array(length);
    for (let i = 0; i < length; i++) x[i] = i;
    y[4] = NaN;
    y[length - 1] = 123;
    const options = { data: { columns: { x, y } }, x: 'x', y: 'y' };
    for (let i = 0; i < 3; i++) aligned(options);
    const timings: number[] = [];
    let result = aligned(options);
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      result = aligned(options);
      timings.push(performance.now() - start);
    }
    expect(timings.sort((a, b) => a - b)[2]).toBeLessThan(100);
    const { frame, diagnostics } = result;
    expect(frame.length).toBe(length);
    expect(frame.x.values).toBe(x);
    const series = frame.series[0]!;
    expect(series.y).toBe(y);
    expect(series.y.buffer).toBe(y.buffer);
    expect(series.slot[4]).toBe(SLOT_NULL);
    expect(series.slot[length - 1]).toBe(SLOT_VALUE);
    expect(series.row).toBeNull();
    expect(frame.source.rowAt(length - 1)).toEqual({ x: length - 1, y: 123 });
    expect(diagnostics.inputs()).toEqual([]);
  });
});

describe('normalization invariants', () => {
  it('is deterministic with ascending positions, valid provenance, and NaN exactly where slots are not values', () => {
    fc.assert(fc.property(fc.array(fc.record({
      x: fc.integer({ min: -30, max: 30 }),
      y: fc.oneof(fc.integer(), fc.constant(null), fc.constant(undefined), fc.constant(NaN), fc.constant('bad')),
      group: fc.constantFrom('a', 'b', 'c'),
    }), { maxLength: 60 }), data => {
      const input = { data, x: 'x', y: 'y', series: 'group' };
      const a = aligned(input);
      const b = aligned(input);
      expect(contents(a.frame)).toEqual(contents(b.frame));
      expect(a.diagnostics.inputs()).toEqual(b.diagnostics.inputs());
      const { frame } = a;
      for (let i = 1; i < frame.x.values.length; i++) expect(frame.x.values[i]).toBeGreaterThan(frame.x.values[i - 1]!);
      for (const series of frame.series) {
        for (let i = 0; i < frame.length; i++) {
          expect(Number.isNaN(series.y[i])).toBe(series.slot[i] !== SLOT_VALUE);
          const row = series.row![i]!;
          if (series.slot[i] === SLOT_NO_ROW || series.slot[i] === SLOT_GAP) expect(row).toBe(-1);
          else {
            expect(row).toBeGreaterThanOrEqual(0);
            expect(row).toBeLessThan(data.length);
            expect(frame.source.rowAt(row)).toBe(data[row]);
            expect(data[row]!.x).toBe(frame.x.values[i]);
          }
        }
      }
    }));
  });
});

it('matches a generated fractional gap to an existing observation within rounding error', () => {
  const data = [
    ...[0, 0.1, 0.2, 0.4, 0.5].map(x => ({ x, y: x, series: 'A' })),
    { x: 0.3, y: 10, series: 'B' },
  ];
  const { frame, diagnostics } = aligned({ data, x: 'x', y: 'y', series: 'series' });
  expect([...frame.x.values]).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5]);
  expect(frame.series[0]?.slot[3]).toBe(SLOT_GAP);
  expect(frame.series[1]?.slot[3]).toBe(SLOT_VALUE);
  expect(diagnostics.inputs()).toMatchObject([{ code: 'AX105', count: 1 }]);
});

it('resolves the long and wide field descriptions with explicit formatting defaults', () => {
  const data = [{ day: '2026-01-01', a: 1, b: 2, name: 'First' }];
  const { resolved } = aligned({
    data,
    x: { field: 'day', type: 'date', label: 'Day', timeZone: 'UTC' },
    y: [{ field: 'a', unit: 'people', missing: 'zero', scale: 'percent' }, 'b'],
  });
  expect(resolved).toMatchObject({
    form: 'wide', series: null,
    x: { field: 'day', type: 'date', label: 'Day', timeZone: 'UTC', ordered: false, unit: null, domain: null },
    values: [
      { field: 'a', label: 'a', unit: 'people', missing: 'zero', scale: 'percent', parse: null },
      { field: 'b', label: 'b', unit: null, missing: 'gap', scale: null, parse: null },
    ],
  });
  expect(aligned({ data, x: 'day', y: 'a', series: 'name' }).resolved).toMatchObject({ form: 'long', series: 'name' });
});

it('preserves aligned slot and provenance invariants across x kinds and data forms', () => {
  const axes = {
    number: { kind: 'number', raw: (i: number) => i / 10, position: (i: number) => i / 10 },
    day: {
      kind: 'date', raw: (i: number) => new Date(Date.UTC(2026, 2, 1 + i)).toISOString().slice(0, 10),
      position: (i: number) => Date.UTC(2026, 2, 1 + i),
    },
    month: { kind: 'date', raw: (i: number) => '2026-' + String(i + 1).padStart(2, '0'), position: (i: number) => Date.UTC(2026, i, 1) },
    year: { kind: 'date', raw: (i: number) => String(2026 + i), position: (i: number) => Date.UTC(2026 + i, 0, 1) },
    time: { kind: 'time', raw: (i: number) => new Date(Date.UTC(2026, 2, 1, i)), position: (i: number) => Date.UTC(2026, 2, 1, i) },
    wall: {
      kind: 'wall', raw: (i: number) => '2026-03-01 0' + i + ':00', position: (i: number) => Date.UTC(2026, 2, 1, i),
    },
    category: { kind: 'category', raw: (i: number) => 'place ' + i, position: () => NaN },
  } as const;
  const value = fc.oneof(fc.integer(), fc.constant(null), fc.constant(undefined), fc.constant(NaN), fc.constant('9'), fc.constant('bad'));
  const records = fc.array(fc.record({ index: fc.integer({ min: 0, max: 9 }), a: value, b: value, s: fc.constantFrom('a', 'b') }), {
    minLength: 1, maxLength: 25,
  });
  fc.assert(fc.property(fc.constantFrom(...Object.keys(axes) as (keyof typeof axes)[]),
    fc.constantFrom('wide', 'long', 'columns'), records, fc.boolean(), (kind, form, data, zero) => {
      const axis = axes[kind];
      const rows = data.map(({ index, ...row }) => ({ ...row, x: axis.raw(index) }));
      const missing = zero ? 'zero' : 'gap';
      const fields = ['a', 'b'].map(field => ({ field, missing }));
      const options = form === 'long'
        ? { data: rows, x: 'x', y: fields[0], series: 's' }
        : { data: form === 'wide' ? rows : { columns: { x: rows.map(row => row.x), a: Float64Array.from(rows, row => typeof row.a === 'number' ? row.a : NaN),
          b: Float64Array.from(rows, row => typeof row.b === 'number' ? row.b : NaN) } }, x: 'x', y: fields };
      const { frame, diagnostics } = aligned(options);
      const repeat = aligned(options);
      expect(contents(frame)).toEqual(contents(repeat.frame));
      expect(diagnostics.inputs()).toEqual(repeat.diagnostics.inputs());
      expect(frame.x.kind).toBe(axis.kind);
      for (let i = 1; i < frame.length; i++) expect(frame.x.values[i]).toBeGreaterThan(frame.x.values[i - 1]!);
      for (const series of frame.series) {
        for (let i = 0; i < frame.length; i++) {
          expect(Number.isNaN(series.y[i])).toBe(series.slot[i] !== SLOT_VALUE);
          const row = series.row?.[i] ?? i;
          if (row === -1) {
            if (zero) expect(series.y[i]).toBe(0);
            else expect([SLOT_NO_ROW, SLOT_GAP]).toContain(series.slot[i]);
            continue;
          }
          expect(row).toBeLessThan(data.length);
          expect(frame.source.rowAt(row)).toMatchObject({ x: rows[row]!.x });
          if (kind === 'category') expect(frame.x.categories?.[frame.x.values[i]!]).toBe(rows[row]!.x);
          else expect(frame.x.values[i]).toBe(axis.position(data[row]!.index));
        }
      }
    }), { numRuns: 160 });
});
