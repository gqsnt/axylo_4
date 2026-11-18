import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { SLOT_GAP, SLOT_NO_ROW, SLOT_NULL, SLOT_VALUE } from '../../src/core/contracts';
import { AlignedStore, validateOptions } from '../../src/data';
import { FrameBuffers } from '../../src/data/store-buffers';
import { DiagnosticCollector, readerDisclosure } from '../../src/diagnostics';
import { aligned, check, utc, version } from './helpers';

function stream(options: unknown) {
  return new AlignedStore('line', aligned(options).resolved, utc, version);
}

describe('data review regressions', () => {
  it('keeps data independent of the lookup module', () => {
    const data = new URL('../../src/data/', import.meta.url);
    for (const name of readdirSync(data).filter(name => name.endsWith('.ts'))) {
      expect(readFileSync(new URL(name, data), 'utf8'), name).not.toMatch(/['"]\.\.\/lookup(?:\/|['"])/);
    }
  });

  it('reports a sparse regular series without allocating slots across the x range', () => {
    const opts = { data: [0, 1, 2, 4].map(x => ({ x, y: x })), x: 'x', y: 'y' };
    const extra = { x: 10_000, y: 5 };
    const full = aligned({ ...opts, data: [...opts.data, extra] });
    const store = stream(opts);
    const before = store.frame;
    const after = store.append([extra], { keep: 5 });
    for (const [frame, diagnostics] of [[full.frame, full.diagnostics.inputs()], [after, store.diagnostics]] as const) {
      expect([...frame.x.values]).toEqual([0, 1, 2, 4, 10_000]);
      expect(diagnostics).toContainEqual(expect.objectContaining({
        code: 'AX105', level: 'hint', effect: 'none', count: 9996,
        message: expect.stringMatching(/series "y".*too sparse/i),
      }));
    }
    expect([...before.x.values]).toEqual([0, 1, 2, 3, 4]);
    const other = aligned({
      data: [...opts.data, extra].map(row => ({ ...row, s: 'sparse' })).concat({ x: 3, y: 3, s: 'other' }),
      x: 'x', y: 'y', series: 's',
    });
    expect(other.frame.series[0]!.slot[3]).toBe(SLOT_NO_ROW);
  });

  it('allows exactly 1,000 absent steps even with few observations', () => {
    const { frame, diagnostics } = aligned({ data: [0, 1, 2, 1003].map(x => ({ x, y: x })), x: 'x', y: 'y' });
    expect(frame.length).toBe(1004);
    expect(frame.series[0]!.slot[3]).toBe(SLOT_GAP);
    expect(diagnostics.inputs()).toMatchObject([{ code: 'AX105', count: 1000 }]);
  });

  it.each([
    ['offset strings', ['2024-02-29T00:15:00+05:30', '2024-02-29T23:40:00-08:00']],
    ['Date objects', [new Date('2024-02-28T21:00:00Z'), new Date('2024-03-01T01:30:00Z')]],
    ['epoch milliseconds', [Date.UTC(2024, 1, 28, 23), Date.UTC(2024, 2, 1, 1)]],
  ])('maps explicit calendar dates from %s to the UTC day', (_name, xs) => {
    for (const timeZone of ['UTC', 'America/Los_Angeles', 'Asia/Kolkata']) {
      const { frame, diagnostics } = aligned({
        data: xs.map(x => ({ x, y: 1 })), x: { field: 'x', type: 'date' }, y: 'y',
      }, { timeZone });
      expect(frame.x).toMatchObject({ kind: 'date', dateUnit: 'day', timeZone: null });
      expect([...frame.x.values]).toEqual([Date.UTC(2024, 1, 28), Date.UTC(2024, 2, 1)]);
      expect(diagnostics.inputs()).toEqual([]);
    }
  });

  it.each([
    ['date', ['2026-03-02', '2026-03-01']], ['date', ['2026-03', '2026-02']],
    ['time', ['2026-03-02T00:00Z', '2026-03-01T00:00Z']], ['number', [2, 1]],
  ])('infers %s despite first-row junk', (kind, xs) => {
    for (const x of [['n/a', ...xs], [...xs, 'n/a']]) {
      const { frame, diagnostics } = aligned({ data: x.map(x => ({ x, y: 1 })), x: 'x', y: 'y' });
      expect(frame.x.kind).toBe(kind);
      expect(frame.length).toBe(2);
      expect(diagnostics.inputs()).toContainEqual(expect.objectContaining({ code: 'AX107', rows: [x.indexOf('n/a')] }));
    }
  });

  it('chooses category when half the non-missing values have no recognized kind', () => {
    const data = [{ x: '2026-03-02', y: 1 }, { x: 'label', y: 2 }, { x: null, y: 3 }];
    const { frame } = aligned({ data, x: 'x', y: 'y' });
    expect(frame.x).toMatchObject({ kind: 'category', categories: ['label'] });
  });

  it.each([['', 'wall'], ['Z', 'time']])('accepts a space separator with suffix "%s"', (suffix, kind) => {
    const data = ['2026-03-02 10:00:00', '2026-03-01 10:00:00'].map(x => ({ x: x + suffix, y: 1 }));
    const { frame } = aligned({ data, x: 'x', y: 'y' });
    expect(frame.x.kind).toBe(kind);
    expect([...frame.x.values]).toEqual([Date.UTC(2026, 2, 1, 10), Date.UTC(2026, 2, 2, 10)]);
  });

  it('materializes an absent wall-clock hour with plain UTC arithmetic', () => {
    const data = [0, 1, 2, 4, 5].map(hour => ({ x: '2026-03-08T0' + hour + ':00:00', y: hour }));
    const { frame, diagnostics } = aligned({ data, x: 'x', y: 'y' }, { timeZone: 'America/Los_Angeles' });
    expect(frame.x.values[3]).toBe(Date.UTC(2026, 2, 8, 3));
    expect(frame.series[0]!.slot[3]).toBe(SLOT_GAP);
    expect(diagnostics.inputs()).toContainEqual(expect.objectContaining({ code: 'AX105' }));
  });

  it('reports invalid time zones without throwing and canonicalizes valid names', () => {
    const data = [1, 2, 4, 5].map(day => ({ x: Date.UTC(2026, 2, day), y: 1 }));
    const options = { data, x: { field: 'x', type: 'time', timeZone: 'Mars/Olympus' }, y: 'y' };
    const { frame, diagnostics } = aligned(options, { timeZone: 'Europe/Paris' });
    expect(frame.x.timeZone).toBe('Europe/Paris');
    expect(diagnostics.inputs()[0]).toMatchObject({ code: 'AX152', level: 'warning', effect: 'none', field: 'x.timeZone' });
    for (const timeZone of ['Mars/Olympus', Symbol('zone')]) {
      expect(validateOptions('line', { ...options, x: { ...options.x, timeZone } }).map(d => d.code)).toContain('AX152');
    }
    expect(aligned({ ...options, x: { ...options.x, timeZone: 'utc' } }).frame.x.timeZone).toBe('UTC');
  });

  it('reports invalid option literals and uses the defaults', () => {
    const { frame, resolved, diagnostics } = aligned({
      data: [{ x: 1, y: null }, { x: 2, y: 2 }],
      x: { field: 'x', type: 'Time' }, y: { field: 'y', scale: 'pct', missing: 'zeros', parse: 'numeric' },
    });
    expect(resolved.x.type).toBeNull();
    expect(resolved.values[0]).toMatchObject({ scale: null, missing: 'gap', parse: null });
    expect(frame.x.kind).toBe('number');
    expect(frame.series[0]!.slot[0]).toBe(SLOT_NULL);
    expect(diagnostics.inputs().map(({ code, field }) => [code, field])).toEqual([
      ['AX150', 'x.type'], ['AX150', 'y.scale'], ['AX150', 'y.missing'], ['AX150', 'y.parse'],
    ]);
    expect(diagnostics.inputs().map(d => d.message)).toEqual(['time', 'percent', 'zero', 'number']
      .map(value => expect.stringContaining('"' + value + '"')));
  });

  it('evicts unplaceable rows, their diagnostics, and long series with no retained observation', () => {
    const store = stream({ data: [{ x: 0, y: 1, s: 'old' }, { x: null, y: 1, s: 'old' }], x: 'x', y: 'y', series: 's' });
    const before = store.frame;
    for (let i = 1; i <= 30; i++) {
      store.append([{ x: i, y: i, s: 's' + i }, { x: null, y: i, s: 's' + i }, { x: i, y: i, s: null }], { keep: 2 });
    }
    expect(store.frame.source.rowAt(1)).toBeNull();
    expect(store.frame.series.map(s => s.key)).toEqual(['s29', 's30']);
    expect(store.diagnostics.map(d => [d.code, d.field, d.count, d.rows])).toEqual([
      ['AX107', 'x', 2, [87, 90]], ['AX107', 's', 2, [88, 91]],
    ]);
    expect([...before.series[0]!.y]).toEqual([1]);
    expect(before.source.rowAt(0)).toEqual({ x: 0, y: 1, s: 'old' });
    store.retire(before.revision);
    expect(before.source.rowAt(0)).toBeNull();
  });

  it('bounds the unplaceable queue even without any observed x', () => {
    const store = stream({ data: [], x: 'x', y: 'y' });
    for (let i = 0; i < 30; i++) store.append([{ x: null, y: i }], { keep: 2 });
    expect(store.frame.source.rowAt(0)).toBeNull();
    expect(store.diagnostics).toMatchObject([{ code: 'AX107', count: 2, rows: [28, 29] }]);
  });

  it('does not copy the window on shared-x single-row appends', () => {
    const data = Array.from({ length: 64 }, (_, x) => [{ x, y: x, s: 'A' }, { x, y: x, s: 'B' }]).flat();
    const store = stream({ data, x: 'x', y: 'y', series: 's' });
    const copy = vi.spyOn(FrameBuffers.prototype, 'copySeries');
    try {
      const before = store.append([{ x: 64, y: 64, s: 'A' }]);
      const after = store.append([{ x: 64, y: 4, s: 'B' }]);
      expect(copy).not.toHaveBeenCalled();
      expect(before.series[1]!.y[64]).toBeNaN();
      expect(before.series[1]!.slot[64]).toBe(SLOT_NO_ROW);
      expect(before.series[1]!.row?.[64]).toBe(-1);
      expect(after.series[1]!.y[64]).toBe(4);
      expect(after.series[1]!.slot[64]).toBe(SLOT_VALUE);
      expect(after.series[1]!.row?.[64]).toBe(129);
    } finally {
      copy.mockRestore();
    }
  });

  it('checks named fields on empty-start and later all-missing append batches', () => {
    const store = stream({ data: [], x: 'x', y: 'vlaue' });
    const sink = new DiagnosticCollector();
    expect(store.append([{ x: 0, value: 1 }], {}, sink).length).toBe(0);
    expect(sink.inputs()).toMatchObject([{ code: 'AX101', field: 'vlaue', message: expect.stringContaining('"value"') }]);
    expect(store.append([{ x: 1, vlaue: 2 }]).series[0]!.y[0]).toBe(2);
    const later = new DiagnosticCollector();
    store.append([{ x: 2, value: 3 }], {}, later);
    expect(later.inputs()).toMatchObject([{ code: 'AX101', field: 'vlaue' }]);
  });

  it('rejects a dense frame above 20 million aligned slots', () => {
    const size = 4473;
    const data = Array.from({ length: size }, (_, x) => ({ x, y: x, s: String(x) }));
    const { frame, diagnostics } = aligned({ data, x: 'x', y: 'y', series: 's' });
    expect(frame.length).toBe(0);
    expect(frame.series).toEqual([]);
    expect(diagnostics.inputs()).toMatchObject([{
      code: 'AX134', level: 'error', effect: 'chart-error',
      message: expect.stringMatching(/4473 series.*4473 x positions.*scatter/i),
    }]);
  });

  it('accepts public showSeries and hideSeries message overrides', () => {
    expect(validateOptions('line', { data: [], x: 'x', y: 'y', messages: { showSeries: 'Show', hideSeries: 'Hide', category: 'Category', typeBar: 'Bars' } })).toEqual([]);
  });

  it('counts each omitted slot once and skips value checks when the row cannot be placed', () => {
    const wide = aligned({
      data: [{ x: 0, a: 1, b: 2, c: 3 }, { x: null, a: NaN, b: 8 }], x: 'x', y: ['a', 'b', 'c'],
    });
    expect(wide.diagnostics.inputs()).toMatchObject([{ code: 'AX107', count: 3, rows: [1] }]);
    expect(readerDisclosure(wide.diagnostics.inputs())).toEqual({ omitted: 3, changed: 0 });
    const long = aligned({
      data: [{ x: 0, y: '42', s: 'A' }, { x: null, y: 99, s: 'A' }, { x: 1, y: NaN, s: null }],
      x: 'x', y: 'y', series: 's',
    });
    expect(long.frame.series[0]!.y[0]).toBe(42);
    expect(readerDisclosure(long.diagnostics.inputs())).toEqual({ omitted: 2, changed: 0 });
    const donut = check('donut', { data: [{ name: 'A', y: 2 }, { name: null, y: -1 }], label: 'name', value: 'y' });
    expect(donut.diagnostics.inputs()).toMatchObject([{ code: 'AX107', field: 'name', count: 1 }]);
  });

  it('uses one canonical position for two fractional series missing the same step', () => {
    const data = [
      ...[0.1, 0.2, 0.3, 0.5, 0.6].map(x => ({ x, y: x, s: 'A' })),
      ...[-2, -1.2, 1.2, 2, 2.8].map(x => ({ x, y: x, s: 'B' })),
    ];
    const { frame } = aligned({ data, x: 'x', y: 'y', series: 's' });
    expect([...frame.x.values]).toEqual([-2, -1.2, -0.4, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 1.2, 2, 2.8]);
    expect(frame.series.map(s => s.slot[6])).toEqual([SLOT_GAP, SLOT_GAP]);
  });

  it('imputes null and absent donut values as zeros without row provenance', () => {
    const { frame, diagnostics } = check('donut', {
      data: [{ name: 'A', y: 2 }, { name: 'B', y: null }, { name: 'C' }],
      label: 'name', value: { field: 'y', missing: 'zero' },
    });
    if (frame.shape !== 'donut') throw new Error('Expected donut');
    expect([...frame.values]).toEqual([2, 0, 0]);
    expect([...frame.slot]).toEqual([SLOT_VALUE, SLOT_VALUE, SLOT_VALUE]);
    expect([...frame.row!]).toEqual([0, -1, -1]);
    expect(readerDisclosure(diagnostics.inputs())).toEqual({ omitted: 0, changed: 1 });
  });

  it('keeps scatter points sharing x or both coordinates, ordered by x then y', () => {
    const data = [{ x: 2, y: 1 }, { x: 1, y: 3 }, { x: 1, y: 1 }, { x: 1, y: 1 }];
    const { frame, diagnostics } = check('scatter', { data, x: 'x', y: 'y' });
    if (frame.shape !== 'points') throw new Error('Expected scatter');
    expect(frame.series[0]).toMatchObject({
      drawable: true, x: Float64Array.of(1, 1, 1, 2), y: Float64Array.of(1, 1, 3, 1), row: Int32Array.of(2, 3, 1, 0),
    });
    expect(diagnostics.inputs()).toEqual([]);
  });
});

it.each([
  ['America/Los_Angeles', ['2026-03-06T00:00-08:00', '2026-03-07T00:00-08:00', '2026-03-09T00:00-07:00', '2026-03-10T00:00-07:00'], Date.UTC(2026, 2, 8, 8)],
  ['Europe/Paris', ['2026-03-27T00:00+01:00', '2026-03-28T00:00+01:00', '2026-03-30T00:00+02:00', '2026-03-31T00:00+02:00'], Date.UTC(2026, 2, 28, 23)],
  ['+05:30', ['2026-03-06T00:00+05:30', '2026-03-07T00:00+05:30', '2026-03-09T00:00+05:30', '2026-03-10T00:00+05:30'], Date.UTC(2026, 2, 7, 18, 30)],
] as const)('places a missing midnight in %s and reports AX111', (timeZone, xs, gap) => {
  const { frame, diagnostics } = aligned({ data: xs.map(x => ({ x, y: 1 })), x: { field: 'x', timeZone }, y: 'y' });
  expect(frame.x.values[2]).toBe(gap);
  expect(frame.series[0]!.slot[2]).toBe(SLOT_GAP);
  expect(diagnostics.inputs().map(d => d.code)).toEqual(['AX111', 'AX105']);
});

it.each([
  ['2026-03-01T01:00Z'],
  ['2026-03-01T01:00Z', '2026-03-01T02:00Z'],
  ['2026-03-01T01:00Z', '2026-03-08T01:30Z', '2026-03-15T01:00Z'],
])('does not report AX111 for non-aligned clock times or one instant (%j)', (...xs) => {
  const options = { data: xs.map(x => ({ x, y: 1 })), x: 'x', y: 'y' };
  expect(aligned(options).diagnostics.inputs().map(d => d.code)).not.toContain('AX111');
  const streaming = stream({ ...options, data: [] });
  for (const row of options.data) streaming.append([row]);
  expect(streaming.diagnostics.map(d => d.code)).not.toContain('AX111');
});

it('applies the alignment budget before growing streaming series buffers', () => {
  const store = stream({ data: [], x: 'x', y: 'y', series: 's' });
  const size = 4473;
  const rows = Array.from({ length: size }, (_, x) => ({ x, y: x, s: String(x) }));
  expect(store.append(rows)).toMatchObject({ length: 0, series: [] });
  expect(store.diagnostics).toMatchObject([{ code: 'AX134', level: 'error', effect: 'chart-error' }]);
  expect(store.append([{ x: 1, y: 5, s: 'recovered' }]).series[0]!.y[0]).toBe(5);
});

it('allows more than 1,000 regular gaps when they are no more than twice the observations', () => {
  const data = Array.from({ length: 600 }, (_, x) => ({ x, y: x }));
  const store = stream({ data, x: 'x', y: 'y' });
  const frame = store.append([{ x: 1700, y: 1 }]);
  expect(frame.length).toBe(1701);
  expect(frame.series[0]!.slot[1200]).toBe(SLOT_GAP);
  expect(store.diagnostics).toMatchObject([{ code: 'AX105', count: 1100, effect: 'none' }]);
  const trimmed = store.append([], { keep: 5 });
  expect([...trimmed.x.values]).toEqual([596, 597, 598, 599, 1700]);
  expect(store.diagnostics).toMatchObject([{ code: 'AX105', count: 1100, message: expect.stringContaining('too sparse') }]);
});

it('drops sparse-gap diagnostics once the stretch is outside the retained observations', () => {
  const data = [0, 1, 2, 10_000].map(x => ({ x, y: x }));
  const store = stream({ data, x: 'x', y: 'y' });
  store.append([10_001, 10_002, 10_003].map(x => ({ x, y: x })), { keep: 4 });
  expect([...store.frame.x.values]).toEqual([10_000, 10_001, 10_002, 10_003]);
  expect(store.diagnostics).toEqual([]);
});

it('drops categories under repeated eviction and accepts a returning category at the tail', () => {
  const store = stream({ data: [{ x: 'first', y: 1 }], x: 'x', y: 'y' });
  const before = store.frame;
  for (let i = 0; i < 100; i++) store.append([{ x: 'category ' + i, y: i }], { keep: 2 });
  const after = store.append([{ x: 'first', y: 2 }], { keep: 2 });
  expect([...after.x.values]).toEqual([0, 1]);
  expect(after.x.categories).toEqual(['category 99', 'first']);
  expect(before.x.categories).toEqual(['first']);
});

it('uses retained value modes and excludes invalid rows during streaming', () => {
  const store = stream({ data: [{ x: 0, y: 42 }], x: 'x', y: 'y' });
  store.append([{ x: null, y: 123 }, { x: 1, y: '7' }, { x: 2, y: '8' }], { keep: 2 });
  expect([...store.frame.series[0]!.y]).toEqual([7, 8]);
  expect(store.diagnostics).toMatchObject([{ code: 'AX104', rows: [2, 3], count: 2 }]);
});

it('revises streaming x inference when the whole column favors a different kind', () => {
  const store = stream({ data: [], x: 'x', y: 'y' });
  store.append([{ x: 'n/a', y: 1 }]);
  store.append([{ x: '2026-03-02', y: 2 }]);
  expect(store.frame.x.kind).toBe('category');
  const frame = store.append([{ x: '2026-03-01', y: 3 }]);
  expect(frame.x.kind).toBe('date');
  expect([...frame.x.values]).toEqual([Date.UTC(2026, 2, 1), Date.UTC(2026, 2, 2)]);
  expect(store.diagnostics).toMatchObject([{ code: 'AX107', rows: [0], count: 1 }]);
});

it('reports malformed typed columns without throwing from validateOptions', () => {
  expect(validateOptions('line', { data: { columns: { x: { length: -1 }, y: [] } }, x: 'x', y: 'y' }))
    .toMatchObject([{ code: 'AX100', level: 'error' }]);
});

it('applies keep before rejecting a dense streaming batch', () => {
  const store = stream({ data: [], x: 'x', y: 'y', series: 's' });
  const data = Array.from({ length: 4473 }, (_, x) => ({ x, y: x, s: String(x) }));
  const frame = store.append(data, { keep: 2 });
  expect([...frame.x.values]).toEqual([4471, 4472]);
  expect(frame.series.map(s => s.key)).toEqual(['4471', '4472']);
  expect(frame.source.rowAt(0)).toBeNull();
  expect(frame.source.rowAt(4472)).toBe(data[4472]);
  expect(store.diagnostics).toEqual([]);
});

it('infers date precision from the retained observations', () => {
  const data = ['2026-02-25', '2026-03', '2026-04', '2026-06', '2026-07'].map(x => ({ x, y: 1 }));
  const store = stream({ data, x: 'x', y: 'y' });
  expect(store.frame.x.dateUnit).toBe('day');
  const frame = store.append([], { keep: 4 });
  expect(frame.x.dateUnit).toBe('month');
  expect([...frame.x.values]).toEqual([2, 3, 4, 5, 6].map(month => Date.UTC(2026, month, 1)));
  expect(frame.series[0]!.slot[2]).toBe(SLOT_GAP);
  expect(store.diagnostics).toMatchObject([{ code: 'AX105', count: 1, message: expect.stringContaining('2026-05') }]);
});

it('uses the same fractional grid when a later append slightly changes the raw step', () => {
  const data = [
    { x: 0.2, y: 1, s: 'A' }, { x: 0.5, y: 1, s: 'B' }, { x: 0.5, y: 1, s: 'C' },
    { x: 0.7, y: 1, s: 'A' }, { x: 1, y: 1, s: 'B' }, { x: 1.1, y: 1, s: 'B' },
    { x: 1.2, y: 1, s: 'B' }, { x: 1.3, y: 1, s: 'C' },
  ];
  const options = { data, x: 'x', y: 'y', series: 's' };
  const store = stream({ ...options, data: [] });
  for (const row of data) store.append([row]);
  const expected = [0.2, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3];
  expect([...aligned(options).frame.x.values]).toEqual(expected);
  expect([...store.frame.x.values]).toEqual(expected);
});
