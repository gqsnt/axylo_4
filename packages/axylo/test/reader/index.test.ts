import { expect, it, vi } from 'vitest';
import { buildTable } from '../../src/reader/table';
import { DiagnosticCollector } from '../../src/diagnostics';
import { defaultMessages, resolveMessages } from '../../src/messages';
import { buildReader, type ReaderInput } from '../../src/reader';
import { aligned, donut, formatter, frame, scatter } from '../lookup/fixtures';

function read(view: ReaderInput['view'], input: Partial<ReaderInput> = {}) {
  return buildReader({ view, formatters: formatter(view.frame), messages: defaultMessages, type: 'Line', locale: 'en-US', ...input });
}

const trend = aligned(frame('line', {
  x: { field: 'day', label: 'Day' }, y: { field: 'sessions', label: 'Sessions' }, series: 'channel', data: [
    { day: 0, sessions: 90, channel: 'Direct' }, { day: 0, sessions: 90, channel: 'Search' }, { day: 0, sessions: 90, channel: 'Referral' },
    { day: 1, sessions: 10, channel: 'Direct' }, { day: 1, sessions: 20, channel: 'Search' }, { day: 1, sessions: 7, channel: 'Referral' },
    { day: 2, sessions: 30, channel: 'Direct' }, { day: 2, sessions: 12, channel: 'Search' }, { day: 2, sessions: 5, channel: 'Referral' },
    { day: 3, sessions: 20, channel: 'Direct' }, { day: 3, sessions: null, channel: 'Search' }, { day: 3, sessions: 8, channel: 'Referral' },
  ],
}), { visibleSlots: { start: 1, end: 4 }, references: [{ axis: 'y', from: 20, to: 20, label: 'Target' }] });

it('summarizes three visible series within the shown range and includes the reference position in the summary and caption', () => {
  const model = read(trend, { title: { text: 'Daily sessions', visible: false }, subtitle: 'Acquisition channels' });
  expect(model.name).toBe('Daily sessions');
  expect(model.summary).toBe('Line chart with 3 series. Day from 1 to 3. Sessions from 5 to 30. '
    + 'Direct: minimum 10, maximum 30, last 20. Search: minimum 12, maximum 20, last 12. '
    + 'Referral: minimum 5, maximum 8, last 8. Reference line Target at 20. Acquisition channels');
  expect(model.note).toBeNull();
  expect(model.table?.caption).toBe('Daily sessions Reference line Target at 20.');
});

it('adds the zone for instants and leaves it out for calendar dates', () => {
  function byDay(start: string, end: string) {
    return aligned(frame('line', { data: [{ day: start, value: 1 }, { day: end, value: 5 }],
      x: { field: 'day', timeZone: 'America/Los_Angeles' }, y: 'value' }));
  }
  const time = read(byDay('2026-02-24T12:00:00Z', '2026-02-25T13:00:00Z'));
  const dates = read(byDay('2026-02-24', '2026-02-25'));
  expect(time.summary).toContain('Times are shown in America/Los_Angeles.');
  expect(time.table?.pageForX(new Date('2026-02-25T12:00:00Z'))).toBe(0);
  expect(dates.summary).not.toContain('Times are shown');
  expect(dates.table?.pageForX('2026-02-25')).toBe(0);
  expect(dates.table?.pageForX('2026-02-30')).toBeNull();
});

it('keeps disclosures before the author description and joins both visible notes', () => {
  const input = { description: 'The reporting period was revised.', disclosure: { omitted: 2, changed: 1 }, labelsHidden: 4 };
  const model = read(trend, input);
  expect(model.summary).toMatch(/Values not shown: 2\. See table\. Values shown differently from the data: 1\. See table\. The reporting period was revised\.$/);
  expect(model.note).toBe('Values not shown: 2. See table. Values shown differently from the data: 1. See table. Some labels hidden. See table.');
  const custom = read(trend, {
    ...input,
    formatters: { ...formatter(trend.frame), count: n => `count(${n})` },
    messages: resolveMessages({ valuesNotShown: 'Omitted {count}.', valuesChanged: 'Changed {count}.' }),
  });
  expect(custom.note).toBe('Omitted count(2). Changed count(1). Some labels hidden. See table.');
  expect(custom.summary).toContain('Line chart with count(3) series.');
  expect(read(trend, { disclosure: { omitted: 0, changed: 1 }, compact: true }).summary)
    .toContain('Values shown differently from the data: 1. See table.');
});

it('uses the external heading when supplied, otherwise generates and reports a missing name', () => {
  const diagnostics = new DiagnosticCollector();
  const labelled = read(trend, { labelledBy: 'heading', caption: 'Outside heading', diagnostics });
  expect(labelled.name).toBe('');
  expect(labelled.table?.caption).toBe('Outside heading Reference line Target at 20.');
  expect(read(trend, { labelledBy: 'heading' }).table?.caption)
    .toBe('Line chart of Sessions by Day Reference line Target at 20.');
  expect(diagnostics.inputs()).toEqual([]);
  expect(read(trend, { diagnostics }).name).toBe('Line chart of Sessions by Day');
  expect(diagnostics.inputs()).toMatchObject([{ code: 'AX140', effect: 'none' }]);
  expect(read(trend, { messages: resolveMessages({ chartName: '{x} and {y} ({type})' }) }).name).toBe('Day and Sessions (Line)');
});

it('formats one requested row of a million-row table and finds its page by x', () => {
  const size = 1_000_000;
  const x = Float64Array.from({ length: size }, (_, i) => i * 2);
  const duration = Float64Array.from(x, v => v / 2 + 0.5);
  const hidden = Float64Array.from(x, v => v / 2 + 2);
  const data = frame('line', { data: { columns: { x, duration, hidden } }, x: { field: 'x', label: 'Index' },
    y: [{ field: 'duration', label: 'Duration', unit: 'ms' }, { field: 'hidden', label: 'Bytes', unit: 'B' }] });
  expect(data.x.values).toBe(x);
  const formatters = formatter(data);
  const formatX = vi.fn(formatters.x);
  const formatValue = vi.fn(formatters.value);
  const view = aligned(data, { visible: [true, false] });
  const start = performance.now();
  const model = read(view, { title: 'Timing', formatters: { ...formatters, x: formatX, value: formatValue } });
  expect(formatX).not.toHaveBeenCalled();
  expect(formatValue).not.toHaveBeenCalled();
  const table = model.table!;
  expect(table.headers).toEqual(['Index', 'Duration (ms)', 'Bytes (B)']);
  expect(table.rowCount).toBe(size);
  expect(table.pageSize).toBe(100);
  expect(table.row(900_000)).toEqual(['1,800,000', '900,000.5 ms', '900,002 B']);
  expect(table.pageForX(1_799_999)).toBe(9000);
  expect(table.pageForX(1_800_000)).toBe(9000);
  expect(table.pageForX(2_000_000)).toBeNull();
  expect(table.row(size)).toBeNull();
  expect(formatX).toHaveBeenCalledTimes(1);
  expect(formatValue).toHaveBeenCalledTimes(2);
  expect(performance.now() - start).toBeLessThan(500);
});

it('limits the table to the current x range and omits it when disabled or compact', () => {
  const table = read(trend).table!;
  expect(table.rowCount).toBe(3);
  expect(table.row(2)).toEqual(['3', '20', 'No data', '8']);
  expect(table.pageForX(0)).toBe(0);
  expect(table.pageForX(4)).toBeNull();
  expect(read(trend, { compact: true }).table).toBeNull();
  expect(read({ ...trend, compact: true }).table).toBeNull();
  expect(read(trend, { table: false }).table).toBeNull();
});

it('marks an incomplete stack in its row header without changing the series cells', () => {
  const data = frame('area', { data: [{ x: 0, a: 2, b: null }, { x: 1, a: 3, b: -1 }], x: 'x', y: ['a', 'b'] });
  const table = read(aligned(data, { kind: 'area', stack: {
    order: [0, 1], incomplete: Uint8Array.of(1, 0),
    positive: [Float64Array.of(2, 3), Float64Array.of(2, 3)],
    negative: [Float64Array.of(0, 0), Float64Array.of(0, -1)],
  } })).table!;
  expect(table.row(0)).toEqual(['0 (incomplete)', '2', 'No data']);
  expect(table.row(1)).toEqual(['1', '3', '-1']);
});

it('presents grouped donut categories separately in the table and together in the summary', () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 64];
  const data = frame('donut', { data: values.map((value, i) => ({ category: `C${i}`, value })), label: 'category',
    value: { field: 'value', label: 'Count', unit: 'sessions' } });
  const base = donut(data);
  const model = read({ ...base, slices: [...base.slices.slice(2), {
    key: 'other', label: 'Other (2)', colorIndex: 7, members: [0, 1], value: 3, ratio: 0.03, angles: [0.97 * 2 * Math.PI, 2 * Math.PI],
  }] }, { type: 'Donut' });
  const table = model.table!;
  expect(table.headers).toEqual(['Category', 'Count (sessions)', 'Percentage']);
  expect(table.rowCount).toBe(9);
  expect(table.row(0)).toEqual(['C0', '1 sessions', '1%']);
  expect(table.row(1)).toEqual(['C1', '2 sessions', '2%']);
  expect(table.row(8)).toEqual(['C8', '64 sessions', '64%']);
  expect(table.pageForX('C8')).toBe(0);
  expect(model.summary).toBe('Donut chart with 8 slices. Total 100 sessions. '
    + 'C2: 3 sessions (3%). C3: 4 sessions (4%). C4: 5 sessions (5%). C5: 6 sessions (6%). '
    + 'C6: 7 sessions (7%). C7: 8 sessions (8%). C8: 64 sessions (64%). Other (2): 3 sessions (3%).');
  expect(model.summary).not.toContain('C0:');
});

it('merges scatter rows in x then y order including hidden series', () => {
  const data = frame('scatter', { x: { field: 'x', label: 'Distance', unit: 'km' }, y: { field: 'y', label: 'Speed', unit: 'km/h' }, series: 'group', data: [
    { x: 3, y: 5, group: 'A' }, { x: 1, y: 3, group: 'B' }, { x: 0, y: 6, group: 'A' },
    { x: 3, y: 2, group: 'B' }, { x: 9, y: 2, group: 'B' },
  ] });
  const view = scatter(data, { xDomain: [0, 3], visible: [true, false], visiblePoints: [{ start: 0, end: 2 }, { start: 0, end: 2 }] });
  const model = read(view, { type: 'Scatter' });
  const table = model.table!;
  expect(table.headers).toEqual(['Distance (km)', 'Series', 'Speed (km/h)']);
  expect(table.rowCount).toBe(4);
  expect([0, 1, 2, 3].map(i => table.row(i))).toEqual([
    ['0 km', 'A', '6 km/h'], ['1 km', 'B', '3 km/h'], ['3 km', 'B', '2 km/h'], ['3 km', 'A', '5 km/h'],
  ]);
  expect(table.pageForX(3)).toBe(0);
  expect(table.pageForX(9)).toBeNull();
  expect(model.summary).toContain('A: minimum 5 km/h, maximum 6 km/h, last 5 km/h.');
  expect(model.summary).not.toContain('B:');
});

it('uses message overrides for chart types and table headers and uses a field name for the absent y label', () => {
  const messages = resolveMessages({
    category: 'Kategorie', percentage: 'Anteil', series: 'Reihe', value: 'Wert',
    typeLine: 'Linie', typeDonut: 'Ring', typeScatter: 'Streuung',
  });
  const line = aligned(frame('line', { data: [{ x: 1, hits: 2 }], x: 'x', y: ['hits'] }));
  const data = donut(frame('donut', { data: [{ cat: 'A', hits: 2 }], label: 'cat', value: 'hits' }));
  const plot = scatter(frame('scatter', { data: [{ x: 1, y: 2 }], x: 'x', y: 'y' }));
  expect(read(line, { messages }).name).toBe('Linie chart of hits by x');
  expect(read(data, { messages }).table?.headers).toEqual(['Kategorie', 'hits', 'Anteil']);
  expect(read(data, { messages }).name).toBe('Ring chart of hits by Kategorie');
  expect(read(plot, { messages }).table?.headers).toEqual(['x', 'Reihe', 'y']);
  expect(read(plot, { messages }).name).toBe('Streuung chart of y by x');
});

it('uses one no-data sentence per empty series, omits an unavailable value range, and stops at an empty view', () => {
  const data = frame('line', { data: [{ x: 5, a: null, b: null }, { x: 6, a: 2, b: null }], x: 'x', y: ['a', 'b'] });
  expect(read(aligned(data)).summary).toBe('Line chart with 2 series. x from 5 to 6. a from 2 to 2. '
    + 'a: minimum 2, maximum 2, last 2. b: no data.');
  expect(read(aligned(data, { visibleSlots: { start: 0, end: 1 } })).summary)
    .toBe('Line chart with 2 series. x from 5 to 5. a: no data. b: no data.');
  expect(read(aligned(data, { visibleSlots: { start: 1, end: 1 } })).summary).toBe('No data to show.');
});

it('identifies an undrawable duplicate-x series even when absent from the visibility mask', () => {
  const data = frame('line', { data: [{ x: 0, y: 1, group: 'A' }, { x: 1, y: 2, group: 'A' },
    { x: 0, y: 3, group: 'B' }, { x: 0, y: 4, group: 'B' }], x: 'x', y: 'y', series: 'group' });
  expect(read(aligned(data)).summary).toContain('B could not be drawn. See table.');
});

it('formats reference lines and bands on their own axes and leaves the deprecated alias unused', () => {
  const formatters = { ...formatter(trend.frame), x: (x: number) => `x=${x}`, value: (_s: number, y: number) => `y=${y}` };
  const view = { ...trend, references: [{ axis: 'y', from: 20, to: 20, label: 'Goal' },
    { axis: 'x', from: 1, to: 3, label: 'Period' }] } as const;
  const messages = resolveMessages({ referenceSummary: 'Deprecated' });
  const model = read(view, { title: 'Daily sessions', messages, formatters });
  const references = 'Reference line Goal at y=20. Reference band Period from x=1 to x=3.';
  expect(model.summary.endsWith(references)).toBe(true);
  expect(model.table?.caption).toBe(`Daily sessions ${references}`);
});

it('reports only drawn donut slices and uses the supplied percent and count formatters', () => {
  const data = donut(frame('donut', { data: [{ cat: 'A', hits: 2 }, { cat: 'Zero', hits: 0 }, { cat: 'Missing', hits: null }],
    label: 'cat', value: 'hits' }));
  const formatters = { ...formatter(data.frame), count: (n: number) => `count(${n})`, percent: (n: number) => `share(${n})` };
  const model = read(data, { formatters });
  expect(model.summary).toBe('Donut chart with count(1) slices. Total 2. A: 2 (share(1)).');
  expect(model.table?.row(0)).toEqual(['A', '2', 'share(1)']);
  expect(model.table?.row(1)).toEqual(['Zero', '0', 'share(0)']);
});

it('advances distant scatter table pages by one merge step per row', () => {
  const seriesCount = 500;
  const rows = 400;
  const base = frame('scatter', { x: 'x', y: 'y', data: [] });
  const data = { ...base, series: Array.from({ length: seriesCount }, (_, s) => ({
    key: String(s), label: `S${s}`, drawable: true,
    x: Float64Array.from({ length: rows }, (_, i) => i * 2), y: new Float64Array(rows).fill(s), row: null,
  })) };
  const work = { seeks: 0, steps: 0, comparisons: 0 };
  const table = buildTable(scatter(data), 'Points', formatter(data), defaultMessages, defaultMessages, 'en-US', work);
  expect(work).toEqual({ seeks: 0, steps: 0, comparisons: 0 });
  const start = table.rowCount - 200;
  expect(table.pageForX(798)).toBe(1995);
  for (let i = 0; i < 100; i++) {
    expect(table.row(start + i)).toEqual(['798', `S${300 + i}`, String(300 + i)]);
  }
  expect(work.seeks).toBe(1);
  expect(work.steps).toBe(100);
  expect(work.comparisons).toBeGreaterThan(0);
  expect(work.comparisons).toBeLessThan(60_000);
  expect(table.row(0)).toEqual(['0', 'S0', '0']);
  expect(table.row(table.rowCount - 1)).toEqual(['798', 'S499', '499']);
  expect(work.seeks).toBe(3);
});

it('jumps to wall-clock and calendar values using the data parser', () => {
  const wall = frame('line', { x: 'x', y: 'y', data: [
    { x: '2026-03-28T12:45:00', y: 1 }, { x: '2026-03-30T12:45:00', y: 2 },
  ] });
  const wallTable = read(aligned(wall)).table!;
  expect(wallTable.pageForX('2026-03-30T12:45:00')).toBe(0);
  expect(wallTable.pageForX('2026-03-30T12:45:00Z')).toBeNull();
  expect(wallTable.pageForX('2026-03-30T12:45:01')).toBeNull();

  const month = frame('line', { x: 'x', y: 'y', data: [{ x: '2026-02', y: 1 }, { x: '2026-03', y: 2 }] });
  const dateTable = read(aligned(month)).table!;
  expect(dateTable.pageForX('2026-02-28')).toBe(0);
  expect(dateTable.pageForX('2026-02-29')).toBeNull();
});
