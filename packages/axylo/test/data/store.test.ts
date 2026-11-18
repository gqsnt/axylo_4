import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { SLOT_GAP, SLOT_NULL, SLOT_VALUE } from '../../src/core/contracts';
import { AlignedStore } from '../../src/data';
import { DiagnosticCollector } from '../../src/diagnostics';
import { aligned, contents, utc, version } from './helpers';

function store(options: unknown, sink?: DiagnosticCollector): AlignedStore {
  return new AlignedStore('line', aligned(options).resolved, utc, version, sink);
}

describe('streaming', () => {
  it('extends owned buffers with views and preserves older revisions', () => {
    const data = [{ x: 0, y: 100 }, { x: 1, y: 101 }, { x: 2, y: 102 }];
    const stream = store({ data, x: 'x', y: 'y' });
    const before = stream.frame;
    const appended = { x: 3, y: 103 };
    const after = stream.append([appended]);
    expect(after.x.values.buffer).toBe(before.x.values.buffer);
    expect(after.series[0]!.y.buffer).toBe(before.series[0]!.y.buffer);
    expect(after.series[0]!.slot.buffer).toBe(before.series[0]!.slot.buffer);
    expect(after.series[0]!.row?.buffer).toBe(before.series[0]!.row?.buffer);
    expect([...before.x.values]).toEqual([0, 1, 2]);
    expect([...before.series[0]!.y]).toEqual([100, 101, 102]);
    expect([...after.x.values]).toEqual([0, 1, 2, 3]);
    expect([...after.series[0]!.y]).toEqual([100, 101, 102, 103]);
    expect([...after.series[0]!.row!]).toEqual([0, 1, 2, 3]);
    expect(after.epoch).toBe(before.epoch);
    expect(after.revision).toBe(before.revision + 1);
    expect(before.source.rowAt(3)).toBeNull();
    expect(after.source.rowAt(3)).toBe(appended);
  });

  it('streams from borrowed columns and uses the row meaning of NaN for appends', () => {
    const data = { columns: { x: Float64Array.of(0, 1, 2), y: Float32Array.of(6, NaN, 8) } };
    const stream = store({ data, x: 'x', y: 'y' });
    const added = { x: 3, y: NaN };
    const next = stream.append([added]);
    expect([...next.series[0]!.y]).toEqual([6, NaN, 8, NaN]);
    expect(next.series[0]!.slot[1]).toBe(SLOT_NULL);
    expect(next.source.rowAt(1)).toEqual({ x: 1, y: NaN });
    expect(next.source.rowAt(3)).toBe(added);
    expect(stream.diagnostics).toMatchObject([{ code: 'AX103', rows: [3], count: 1 }]);
    const earlier = { x: -1, y: 5 };
    const fallback = stream.append([earlier]);
    expect([...fallback.x.values]).toEqual([-1, 0, 1, 2, 3]);
    expect([...fallback.series[0]!.row!]).toEqual([4, 0, 1, 2, 3]);
    expect(fallback.series[0]!.slot[2]).toBe(SLOT_NULL);
    expect(fallback.source.rowAt(4)).toBe(earlier);
    expect(stream.diagnostics).toMatchObject([{ code: 'AX103', rows: [3] }, { code: 'AX151', rows: [4] }]);
    expect([...data.columns.y]).toEqual([6, NaN, 8]);
  });

  it('streams multiple wide fields and a growing long series set', () => {
    const prior = [{ x: 1, a: 1, b: null }, { x: 2, a: 2, b: 20 }];
    const wide = store({ data: prior, x: 'x', y: ['a', 'b'] });
    const more = [{ x: 3, a: 3, b: 30 }];
    const wideNext = wide.append(more);
    expect(wideNext.series.map(s => [...s.y])).toEqual([[1, 2, 3], [NaN, 20, 30]]);
    expect(contents(wideNext)).toEqual(contents(aligned({ data: [...prior, ...more], x: 'x', y: ['a', 'b'] }).frame));

    const initial = [{ x: 1, y: 1, name: 'A' }];
    const additions = [{ x: 1, y: 7, name: 'B' }, { x: 2, y: 2, name: 'A' }, { x: 3, y: 5, name: 'C' }];
    const long = store({ data: initial, x: 'x', y: 'y', series: 'name' });
    const before = long.frame;
    for (const row of additions) long.append([row]);
    expect(contents(long.frame)).toEqual(contents(aligned({
      data: [...initial, ...additions], x: 'x', y: 'y', series: 'name',
    }).frame));
    expect(before.series).toHaveLength(1);
    expect([...before.series[0]!.y]).toEqual([1]);
    expect(long.diagnostics).toEqual([]);
  });

  it('extends an established grid with a new gap without copying previous slots', () => {
    const data = [0, 1, 2].map(x => ({ x, y: x }));
    const stream = store({ data, x: 'x', y: 'y' });
    const before = stream.frame;
    const after = stream.append([{ x: 4, y: 4 }]);
    expect(after.x.values.buffer).toBe(before.x.values.buffer);
    expect([...after.x.values]).toEqual([0, 1, 2, 3, 4]);
    expect([...after.series[0]!.slot]).toEqual([SLOT_VALUE, SLOT_VALUE, SLOT_VALUE, SLOT_GAP, SLOT_VALUE]);
    expect([...after.series[0]!.row!]).toEqual([0, 1, 2, -1, 3]);
    expect(stream.diagnostics).toMatchObject([{ code: 'AX105', count: 1 }]);
  });

  it('removes inferred gaps when more observations invalidate the old cadence', () => {
    const data = [0, 1, 2, 4].map(x => ({ x, y: x }));
    const stream = store({ data, x: 'x', y: 'y' });
    const before = stream.frame;
    const after = stream.append([{ x: 4.5, y: 10 }]);
    expect([...before.x.values]).toEqual([0, 1, 2, 3, 4]);
    expect([...after.x.values]).toEqual([0, 1, 2, 4, 4.5]);
    expect(stream.diagnostics).toEqual([]);
  });

  it('retains the latest observed positions along with interior gaps and evicts original source rows', () => {
    const data = [0, 1, 2, 4].map(x => ({ x, y: x }));
    const stream = store({ data, x: 'x', y: 'y' });
    const newest = { x: 5, y: 5 };
    const frame = stream.append([newest], { keep: 3 });
    expect([...frame.x.values]).toEqual([2, 3, 4, 5]);
    expect([...frame.series[0]!.row!]).toEqual([2, -1, 3, 4]);
    expect(frame.source.rowAt(0)).toBeNull();
    expect(frame.source.rowAt(1)).toBeNull();
    expect(frame.source.rowAt(2)).toBe(data[2]);
    expect(frame.source.rowAt(4)).toBe(newest);
    const older = { x: 1, y: 20 };
    const outOfOrder = stream.append([older], { keep: 2 });
    expect([...outOfOrder.x.values]).toEqual([4, 5]);
    expect([...outOfOrder.series[0]!.row!]).toEqual([3, 4]);
    expect(outOfOrder.source.rowAt(5)).toBeNull();
  });

  it('keeps category identities stable across eviction and keeps old category views immutable', () => {
    const data = [{ x: 'Monday', y: 1 }, { x: 'Tuesday', y: 2 }];
    const stream = store({ data, x: 'x', y: 'y' });
    const before = stream.frame;
    const after = stream.append([{ x: 'Wednesday', y: 3 }], { keep: 2 });
    expect(before.x.categories).toEqual(['Monday', 'Tuesday']);
    expect(after.x.categories).toEqual(['Monday', 'Tuesday', 'Wednesday']);
    expect([...after.x.values]).toEqual([1, 2]);
    expect([...after.series[0]!.row!]).toEqual([1, 2]);
  });

  it('leaves the frame and category state untouched if a diagnostic sink rejects an append', () => {
    const stream = store({ data: [{ x: 'Mon', y: 1 }], x: 'x', y: 'y' });
    const initial = stream.frame;
    expect(() => stream.append([{ x: 'Tue', y: Infinity }], {}, {
      add(diagnostic) { if (diagnostic.level === 'warning') throw new Error(diagnostic.code); },
    })).toThrow('AX103');
    expect(stream.frame).toBe(initial);
    const next = stream.append([{ x: 'Wed', y: 3 }]);
    expect(next.x.categories).toEqual(['Mon', 'Wed']);
    expect([...next.series[0]!.row!]).toEqual([0, 1]);
  });

  it('revalidates earlier decimal strings when a later row makes the column mixed', () => {
    const stream = store({ data: [{ x: 0, y: '1' }], x: 'x', y: 'y' });
    expect(stream.frame.series[0]!.y[0]).toBe(1);
    const frame = stream.append([{ x: 1, y: 2 }]);
    expect([...frame.series[0]!.y]).toEqual([NaN, 2]);
    expect(stream.diagnostics).toMatchObject([{ code: 'AX106', rows: [0], count: 1 }]);
  });
});

describe('streaming invariants', () => {
  const data = fc.array(fc.record({
    x: fc.integer({ min: -24, max: 24 }),
    y: fc.oneof(fc.integer(), fc.constant(null), fc.constant(undefined), fc.constant(NaN), fc.constant('5')),
  }), { maxLength: 35 });

  it('matches full normalization when adding the same rows one by one', () => {
    fc.assert(fc.property(data, fc.boolean(), (rows, shuffle) => {
      const input = shuffle ? rows : [...rows].sort((a, b) => a.x - b.x);
      const options = { data: input, x: 'x', y: 'y' };
      const stream = store({ ...options, data: [] });
      for (const row of input) stream.append([row]);
      const whole = aligned(options).frame;
      expect(contents(stream.frame)).toEqual(contents(whole));
    }), { numRuns: 150 });
  });

  it('never keeps more than k distinct observed positions and always keeps the latest ones', () => {
    fc.assert(fc.property(data, fc.integer({ min: 0, max: 10 }), (rows, keep) => {
      const stream = store({ data: [], x: 'x', y: 'y' });
      const seen = new Set<number>();
      for (const row of rows) {
        const frame = stream.append([row], { keep });
        seen.add(row.x);
        const expected = keep === 0 ? [] : [...seen].sort((a, b) => a - b).slice(-keep);
        const observed = [...frame.x.values].filter((_, i) => frame.series.some(series => series.row![i]! >= 0));
        expect(observed).toEqual(expected);
        expect(observed.length).toBeLessThanOrEqual(keep);
      }
    }), { numRuns: 150 });
  });
});

describe('diagnostics in a retained window', () => {
  it('discards diagnostics with their rows and lets a series draw after its duplicate x leaves', () => {
    const data = [{ x: 0, y: 1 }, { x: 1, y: NaN }];
    const stream = store({ data, x: 'x', y: 'y' });
    const first = stream.frame;
    const duplicate = stream.append([{ x: 1, y: 9 }]);
    expect(duplicate.x.values.buffer).toBe(first.x.values.buffer);
    expect(duplicate.series[0]!.y.buffer).toBe(first.series[0]!.y.buffer);
    expect(first.series[0]!.drawable).toBe(true);
    expect(duplicate.series[0]!.drawable).toBe(false);
    expect(stream.diagnostics.map(d => [d.code, d.rows])).toEqual([['AX103', [1]], ['AX108', [2]]]);
    const latest = stream.append([{ x: 2, y: 2 }, { x: 3, y: 3 }], { keep: 2 });
    expect(latest.series[0]!.drawable).toBe(true);
    expect(stream.diagnostics).toEqual([]);
    expect(latest.source.rowAt(1)).toBeNull();
    expect(latest.source.rowAt(2)).toBeNull();
  });

  it('retains only examples and counts within the active window after the original examples are evicted', () => {
    const data = Array.from({ length: 15 }, (_, i) => ({ x: i, y: NaN }));
    const stream = store({ data, x: 'x', y: 'y' });
    stream.append([{ x: 15, y: NaN }], { keep: 4 });
    expect(stream.diagnostics).toMatchObject([{ code: 'AX103', count: 4, rows: [12, 13, 14, 15] }]);
  });

  it('recovers the daily-calendar hint when eviction removes a non-daily interval', () => {
    const x = { field: 'x', type: 'time' };
    const days = [Date.UTC(2026, 2, 7), Date.UTC(2026, 2, 8), Date.UTC(2026, 2, 9), Date.UTC(2026, 2, 10)];
    const data = [{ x: days[0]! - 3600_000, y: 4 }, ...days.slice(0, 3).map(x => ({ x, y: 5 }))];
    const stream = store({ data, x, y: 'y' });
    expect(stream.diagnostics.map(d => d.code)).not.toContain('AX111');
    stream.append([{ x: days[3], y: 6 }], { keep: 3 });
    expect(stream.diagnostics).toMatchObject([{ code: 'AX111', count: 3, rows: [2, 3, 4] }]);
    stream.append([], { keep: 1 });
    expect(stream.diagnostics).toEqual([]);
  });
});

it('matches full long-form normalization when series arrive one row at a time at shared x positions', () => {
  fc.assert(fc.property(fc.array(fc.record({
    x: fc.integer({ min: 0, max: 20 }),
    y: fc.oneof(fc.integer(), fc.constant(null)),
    series: fc.constantFrom('a', 'b', 'c'),
  }), { maxLength: 40 }), rows => {
    const data = [...rows].sort((a, b) => a.x - b.x);
    const options = { data, x: 'x', y: 'y', series: 'series' };
    const stream = store({ ...options, data: [] });
    for (const row of data) stream.append([row]);
    expect(contents(stream.frame)).toEqual(contents(aligned(options).frame));
  }));
});
