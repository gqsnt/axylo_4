import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { AlignedFrame } from '../../src/core/contracts';
import { AlignedStore, createXParser, DonutStore, PointStore, resolveOptions } from '../../src/data';
import { DiagnosticCollector } from '../../src/diagnostics';
import { aligned, check, contents, utc, version } from './helpers';

const quiet = { add() {} };
const numbers = { x: { field: 'x', type: 'number' }, y: 'y' };
const resolve = (options: unknown) => resolveOptions('line', options, quiet);
const stream = (data: readonly unknown[] = []) => new AlignedStore('line', resolve({ data, ...numbers }), utc, version);
const indexes = (frame: AlignedFrame) => [...frame.series[0]?.row ?? []].filter(i => i >= 0);
const revised = (frame: AlignedFrame) => ({ epoch: frame.epoch + 1, revision: frame.revision + 1 });

function bytes(frame: AlignedFrame) {
  return [frame.x.values, ...frame.series.flatMap(s => [s.y, s.slot, s.row!])].map(
    a => [...new Uint8Array(a.buffer, a.byteOffset, a.byteLength)],
  );
}

function backingBytes(frame: AlignedFrame) {
  return [frame.x.values, ...frame.series.flatMap(s => [s.y, s.slot, s.row!])].map(a => [...new Uint8Array(a.buffer)]);
}

describe('prepared appends', () => {
  it('leaves the store and backing bytes unchanged when the transaction is abandoned', () => {
    const rows = fc.array(fc.record({
      x: fc.integer({ min: -10, max: 10 }),
      y: fc.oneof(fc.integer(), fc.constant(NaN), fc.constant('2'), fc.constant(null)),
    }), { maxLength: 20 });
    fc.assert(fc.property(rows, rows, rows, fc.option(fc.nat(8), { nil: undefined }), (initial, rejected, accepted, keep) => {
      const a = stream(initial);
      const b = stream(initial);
      const previous = a.frame;
      const before = backingBytes(previous);
      const discarded = a.prepareAppend(rejected, { keep });
      const expectedCandidate = stream(initial);
      expect(contents(discarded.frame)).toEqual(contents(expectedCandidate.append(rejected, { keep })));
      expect(discarded.diagnostics).toEqual(expectedCandidate.diagnostics);
      expect(a.frame).toBe(previous);
      expect(backingBytes(previous)).toEqual(before);
      expect(a.diagnostics).toEqual(b.diagnostics);
      const actual = a.append(accepted, { keep });
      const expected = b.append(accepted, { keep });
      expect({ ...contents(actual), revision: actual.revision }).toEqual({ ...contents(expected), revision: expected.revision });
      expect(bytes(actual)).toEqual(bytes(expected));
      expect(a.diagnostics).toEqual(b.diagnostics);
      for (const i of indexes(expected)) expect(actual.source.rowAt(i)).toBe(expected.source.rowAt(i));
    }));
  });

  it('publishes the inspected frame on commit and rejects stale transactions', () => {
    const s = stream([{ x: 1, y: 2 }]);
    const pending = s.prepareAppend([{ x: 2, y: 3 }]);
    const obsolete = s.prepareAppend([{ x: 4, y: 5 }]);
    const frame = pending.frame;
    expect(frame.source.rowAt(1)).toEqual({ x: 2, y: 3 });
    pending.commit();
    expect(s.frame).toBe(frame);
    pending.commit();
    expect(() => obsolete.commit()).toThrow();
    expect(s.frame).toBe(frame);
  });
});

describe('re-encoding', () => {
  it('matches full normalization of the retained rows with their original provenance', () => {
    const rows = fc.array(fc.record({
      advance: fc.integer({ min: 1, max: 3 }), other: fc.integer({ min: -10, max: 10 }),
      group: fc.constantFrom('a', 'b'), z: fc.oneof(fc.integer(), fc.constant(NaN)),
    }), { minLength: 1, maxLength: 35 });
    fc.assert(fc.property(rows, fc.nat(35), fc.nat(10), (input, split, keep) => {
      let x = 0;
      const data = input.map(r => ({ x: x += r.advance, y: r.other, ...r }));
      const s = stream(data.slice(0, split));
      const before = s.append(data.slice(split), { keep });
      const retained = keep ? data.slice(-keep) : [];
      const encoding = { x: 'other', y: 'z', series: 'group' };
      const full = aligned({ data: retained, ...encoding });
      const after = s.reencode(resolve({ data: data.slice(0, split), ...encoding }), revised(before));
      const offset = data.length - retained.length;
      const expected = contents(full.frame);
      expect(contents(after)).toEqual({
        ...expected, series: expected.series.map(series => ({
          ...series, row: series.row.map(row => row < 0 ? row : row + offset),
        })),
      });
      expect(s.diagnostics.map(d => [d.code, d.count, d.rows])).toEqual(
        full.diagnostics.inputs().map(d => [d.code, d.count, d.rows?.map(row => row + offset)]),
      );
      expect(after.epoch).toBe(before.epoch + 1);
      for (const row of indexes(before)) expect(before.source.rowAt(row)).toBe(data[row]);
      for (let i = 0; i < data.length; i++) expect(after.source.rowAt(i)).toBe(i < offset ? null : data[i]);
    }));
  });

  it('revalidates a new field against appended rows and replaces the stream even with the initial data', () => {
    const data = [{ x: 1, y: 5 }];
    const s = stream(data);
    const before = s.append([{ x: 2, y: 6, z: NaN }], { keep: 1 });
    const newEncoding = resolve({ data, x: 'x', y: 'z' });
    expect(newEncoding.valid).toBe(false);
    const findings = new DiagnosticCollector();
    expect(s.resolveEncoding({ data, x: 'x', y: 'z' }, findings).valid).toBe(true);
    expect(findings.inputs()).toEqual([]);
    const change = s.prepareReencode(newEncoding, revised(before));
    expect(s.frame).toBe(before);
    expect(change.diagnostics).toMatchObject([{ code: 'AX103', rows: [1] }]);
    change.commit();
    expect(s.frame.series[0]?.row?.[0]).toBe(1);
    const replacement = s.replace(data, resolve({ data, ...numbers }), revised(s.frame));
    expect([...replacement.x.values]).toEqual([1]);
    expect(indexes(replacement)).toEqual([0]);
    expect(replacement.source.rowAt(0)).toBe(data[0]);
    expect(before.source.rowAt(1)).toEqual({ x: 2, y: 6, z: NaN });
    expect(replacement.source.rowAt(1)).toBeNull();
    s.retire(before.revision);
    expect(before.source.rowAt(1)).toBeNull();
    expect(replacement.source.rowAt(0)).toBe(data[0]);
  });

  it('keeps typed missingness and source indexes after retaining only a small column range', () => {
    const x = Float64Array.from({ length: 512 }, (_, i) => i);
    const z = Float32Array.from(x, i => i === 511 ? NaN : -i);
    const data = { columns: { x, y: x, z } };
    const s = new AlignedStore('line', resolve({ data, ...numbers }), utc, version);
    const before = s.append([{ x: 512, y: 1, z: Infinity }], { keep: 3 });
    s.retire(before.revision - 1);
    const after = s.reencode(resolve({ data, x: 'x', y: 'z' }), revised(before));
    expect(indexes(after)).toEqual([510, 511, 512]);
    expect([...after.series[0]!.y]).toEqual([-510, NaN, NaN]);
    expect(s.diagnostics).toMatchObject([{ code: 'AX103', rows: [512] }]);
    expect(after.source.rowAt(511)).toEqual({ x: 511, y: 511, z: NaN });
    expect(after.source.rowAt(509)).toBeNull();
  });
});

describe('revision leases', () => {
  it('keeps the previous frame readable through an eviction until it is retired', () => {
    const data = [{ x: 0, y: 1 }, { x: 1, y: 2 }];
    const s = stream(data);
    const a = s.frame;
    const last = { x: 2, y: 3 };
    const b = s.append([last], { keep: 1 });
    indexes(a).forEach(i => expect(a.source.rowAt(i)).toBe(data[i]));
    expect(s.retainedRowCount).toBe(3);
    s.retire(a.revision);
    indexes(a).forEach(i => expect(a.source.rowAt(i)).toBeNull());
    expect(s.retainedRowCount).toBe(1);
    expect(b.source.rowAt(2)).toBe(last);
  });

  it('stores exactly the union of the live windows during random retirement', () => {
    const operations = fc.array(fc.record({
      x: fc.integer({ min: -15, max: 15 }), keep: fc.nat(7), retire: fc.nat(10), preview: fc.boolean(),
    }), { maxLength: 45 });
    fc.assert(fc.property(operations, ops => {
      const s = stream();
      const frames: { frame: AlignedFrame; window: Set<number> }[] = [];
      const rows = ops.map(({ x }, y) => ({ x, y }));
      let retained = new Set<number>();
      let retired = version.revision - 1;
      ops.forEach(({ keep, retire, preview }, i) => {
        const seen = new Set(retained).add(i);
        const xs = [...new Set([...seen].map(index => rows[index]!.x))].sort((a, b) => a - b);
        const keys = new Set(keep === 0 ? [] : xs.slice(-keep));
        retained = new Set([...seen].filter(index => keys.has(rows[index]!.x)));
        const pending = preview ? s.prepareAppend([rows[i]!], { keep }) : null;
        pending?.commit();
        const frame = pending?.frame ?? s.append([rows[i]!], { keep });
        frames.push({ frame, window: retained });
        if (retire < 5) {
          retired = Math.max(retired, frame.revision - retire - 1);
          s.retire(retired);
        }
        const union = new Set<number>();
        for (const old of frames) {
          const active = old.frame.revision > retired;
          for (let index = 0; index <= i; index++) {
            const addressed = active && old.window.has(index);
            if (addressed) union.add(index);
            expect(old.frame.source.rowAt(index)).toBe(addressed ? rows[index] : null);
          }
        }
        expect(s.retainedRowCount).toBe(union.size);
      });
    }));
  });
});

describe('static handoff', () => {
  it('borrows typed columns until it creates an aligned store', () => {
    const x = Float64Array.of(1, 2);
    const y = Float64Array.of(3, 4);
    const data = { columns: { x, y } };
    const initial = aligned({ data, ...numbers });
    expect(initial.frame.x.values.buffer).toBe(x.buffer);
    expect(initial.frame.series[0]!.y.buffer).toBe(y.buffer);
    const s = AlignedStore.fromFrame(initial.frame, initial.resolved, data, utc);
    expect(s.frame.x.values.buffer).not.toBe(x.buffer);
    expect(s.frame.series[0]!.y.buffer).not.toBe(y.buffer);
    expect(contents(s.frame)).toEqual(contents(initial.frame));
    expect([...s.append([{ x: 3, y: 5 }]).series[0]!.y]).toEqual([3, 4, 5]);
    expect([...y]).toEqual([3, 4]);
  });

  it('can take over a normalized ascending frame without rereading its fields', () => {
    let reads = 0;
    const data = [1, 2, 3].map(n => ({
      get x() { reads++; return n; },
      get y() { reads++; return n * 2; },
    }));
    const initial = aligned({ data, ...numbers });
    const atNormalize = reads;
    const domainOnly = resolve({ data, ...numbers, x: { ...numbers.x, domain: [0, 10] } });
    const s = AlignedStore.fromFrame(initial.frame, domainOnly, data, utc);
    const frame = s.append([{ x: 4, y: 8 }]);
    expect(reads).toBe(atNormalize);
    expect([...frame.series[0]!.y]).toEqual([2, 4, 6, 8]);
  });
});

const scatterOptions = { ...numbers };
const donutOptions = { label: 'label', value: 'y' };

describe('scatter and donut stores', () => {
  it('does not reread existing fields when extending ordered points and distinct labels', () => {
    let reads = 0;
    const data = [1, 2, 3].map(n => ({
      get x() { reads++; return n; },
      get label() { reads++; return String(n); },
      get y() { reads++; return n * 2; },
    }));
    const p = new PointStore(resolveOptions('scatter', { data, ...scatterOptions }, quiet), utc, version);
    const d = new DonutStore(resolveOptions('donut', { data, ...donutOptions }, quiet), utc, version);
    const atStart = reads;
    const row = { x: 4, label: '4', y: 8 };
    expect([...p.append([row], { keep: 2 }).series[0]!.y]).toEqual([6, 8]);
    expect(d.append([row], { keep: 2 }).labels).toEqual(['3', '4']);
    expect(reads).toBe(atStart);
  });

  it('keeps positions, reports out-of-order rows even if evicted, and keeps typed NaN silent', () => {
    const data = { columns: { x: Float64Array.of(NaN, 10, 20), y: Float64Array.of(1, NaN, 2) } };
    const s = new PointStore(resolveOptions('scatter', { data, ...scatterOptions }, quiet), utc, version);
    expect(s.diagnostics).toEqual([]);
    const prepare = s.prepareAppend([{ x: 5, y: 1 }, { x: 20, y: 3 }], { keep: 2 });
    expect(prepare.diagnostics).toMatchObject([{ code: 'AX151', rows: [3] }]);
    expect([...prepare.frame.series[0]!.x]).toEqual([20, 20]);
    expect([...prepare.frame.series[0]!.row!]).toEqual([2, 4]);
    expect(s.frame.source.rowAt(4)).toBeNull();
    prepare.commit();
    expect(s.frame.source.rowAt(1)).toEqual({ x: 10, y: NaN });
    expect(s.frame.source.rowAt(3)).toBeNull();
    expect(s.diagnostics.map(d => d.code)).toEqual(['AX151']);
  });

  it('still applies keep when removing rows changes the inferred scatter x kind', () => {
    const options = resolveOptions('scatter', {
      data: [1, 2, 3].map(x => ({ x, y: x })), x: 'x', y: 'y',
    }, quiet);
    const s = new PointStore(options, utc, version);
    const next = s.append([{ x: '2026-01-01', y: 5 }, { x: '2026-01-02', y: 6 }], { keep: 1 });
    expect(next.xKind).toBe('date');
    expect([...next.series[0]!.x]).toEqual([Date.UTC(2026, 0, 2)]);
    expect([...next.series[0]!.row!]).toEqual([4]);
  });

  it('validates duplicate labels before eviction and keeps typed NaN silent', () => {
    const data = { columns: { label: ['A', 'B'], y: Float64Array.of(NaN, 2) } };
    const s = new DonutStore(resolveOptions('donut', { data, ...donutOptions }, quiet), utc, version);
    const first = s.frame;
    const prepared = s.prepareAppend([{ label: 'A', y: 1 }, { label: 'C', y: 3 }], { keep: 2 });
    expect(prepared.callDiagnostics).toMatchObject([{ code: 'AX108', rows: [2] }]);
    expect(prepared.frame.labels).toEqual(['B', 'C']);
    expect(prepared.diagnostics).toEqual([]);
    prepared.commit();
    expect(first.source.rowAt(0)).toEqual({ label: 'A', y: NaN });
    s.retire(first.revision);
    expect(first.source.rowAt(0)).toBeNull();
    expect(s.frame.source.rowAt(1)).toEqual({ label: 'B', y: 2 });
  });

  it('agrees with one scatter normalization of the retained rows at every step', () => {
    const points = fc.array(fc.record({ x: fc.integer({ min: -6, max: 6 }), y: fc.oneof(fc.integer(), fc.constant(null)) }), { maxLength: 28 });
    fc.assert(fc.property(points, fc.nat(10), (input, keep) => {
      const s = new PointStore(resolveOptions('scatter', { data: [], ...scatterOptions }, quiet), utc, version);
      let retained: number[] = [];
      input.forEach((row, i) => {
        const f = s.append([row], { keep });
        retained.push(i);
        const xs = [...new Set(retained.map(i => input[i]!.x))].sort((a, b) => a - b);
        const keys = new Set(keep === 0 ? [] : xs.slice(-keep));
        retained = retained.filter(i => keys.has(input[i]!.x));
        const normalized = check('scatter', { data: retained.map(i => input[i]), ...scatterOptions }).frame;
        if (normalized.shape !== 'points') throw new Error('Expected a point frame');
        expect(f.series).toEqual(normalized.series.map(s => ({
          ...s, row: Int32Array.from(s.row ?? s.x.keys(), index => retained[index]!),
        })));
        for (const i of retained) expect(f.source.rowAt(i)).toBe(input[i]);
      });
    }));
  });

  it('agrees with one donut normalization of the retained labels at every step', () => {
    const slices = fc.array(fc.record({ label: fc.constantFrom('A', 'B', 'C', 'D'), y: fc.oneof(fc.integer(), fc.constant(null)) }), { maxLength: 28 });
    fc.assert(fc.property(slices, fc.nat(5), (input, keep) => {
      const s = new DonutStore(resolveOptions('donut', { data: [], ...donutOptions }, quiet), utc, version);
      let retained: number[] = [];
      input.forEach((row, i) => {
        const f = s.append([row], { keep });
        retained.push(i);
        const labels = [...new Set(retained.map(i => input[i]!.label))];
        const keys = new Set(keep === 0 ? [] : labels.slice(-keep));
        retained = retained.filter(i => keys.has(input[i]!.label));
        const normalized = check('donut', { data: retained.map(i => input[i]), ...donutOptions }).frame;
        if (normalized.shape !== 'donut') throw new Error('Expected a donut frame');
        expect(f.labels).toEqual(normalized.labels);
        expect(f.values).toEqual(normalized.values);
        expect(f.slot).toEqual(normalized.slot);
        expect(f.row).toEqual(Int32Array.from(normalized.row ?? normalized.values.keys(), index => retained[index]!));
      });
    }));
  });

  it('re-encodes and replaces point and donut data independently of old revisions', () => {
    const data = [{ x: 1, y: 1, label: 'A', alternative: 3 }];
    const row = { x: 2, y: 2, label: 'B', alternative: 4 };
    const p = new PointStore(resolveOptions('scatter', { data, ...scatterOptions }, quiet), utc, version);
    const d = new DonutStore(resolveOptions('donut', { data, ...donutOptions }, quiet), utc, version);
    const pf = p.append([row], { keep: 1 });
    const df = d.append([row], { keep: 1 });
    const second = { epoch: 5, revision: 10 };
    expect([...p.reencode(resolveOptions('scatter', { data, ...scatterOptions, y: 'alternative' }, quiet), second).series[0]!.y]).toEqual([4]);
    expect([...d.reencode(resolveOptions('donut', { data, ...donutOptions, value: 'alternative' }, quiet), second).values]).toEqual([4]);
    const third = { epoch: 6, revision: 11 };
    expect([...p.replace(data, resolveOptions('scatter', { data, ...scatterOptions }, quiet), third).series[0]!.x]).toEqual([1]);
    expect(d.replace(data, resolveOptions('donut', { data, ...donutOptions }, quiet), third).labels).toEqual(['A']);
    expect(pf.source.rowAt(1)).toBe(row);
    expect(df.source.rowAt(1)).toBe(row);
    p.retire(second.revision);
    d.retire(second.revision);
    expect(pf.source.rowAt(1)).toBeNull();
    expect(df.source.rowAt(1)).toBeNull();
    expect(p.retainedRowCount).toBe(1);
    expect(d.retainedRowCount).toBe(1);
  });
});

it('parses numeric, category, calendar, instant and wall x values without normalizing a frame', () => {
  const parser = (kind: 'number' | 'category' | 'date' | 'time' | 'wall', categories: readonly string[] | null = null) =>
    createXParser({ kind, categories, timeZone: 'UTC' }, utc);
  const numeric = parser('number');
  expect(numeric.position(40)).toBe(40);
  expect(numeric.position('40')).toBeNull();
  expect(numeric.reports).toMatchObject([{ code: 'AX107', rows: [] }]);
  const category = parser('category', ['one', '2']);
  expect(category.position('one')).toBe(0);
  expect(category.position('missing')).toBeNull();
  expect(category.position(2)).toBe(1);
  const date = parser('date');
  expect(date.position('2024-02-29')).toBe(Date.UTC(2024, 1, 29));
  expect(date.position('2025-02-29')).toBeNull();
  expect(parser('time').position('2026-11-18T12:00:00+02:00')).toBe(Date.UTC(2026, 10, 18, 10));
  const wall = parser('wall');
  expect(wall.position('2026-11-18 12:00:00')).toBe(Date.UTC(2026, 10, 18, 12));
  expect(wall.reports).toMatchObject([{ code: 'AX112', rows: [] }]);
  expect(wall.position('2026-11-18T12:00:00Z')).toBeNull();
});
