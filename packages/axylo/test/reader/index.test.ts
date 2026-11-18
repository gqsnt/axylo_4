import { expect, it, vi } from 'vitest';
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

it('summarizes three visible series within the shown range and names the reference', () => {
  const model = read(trend, { title: { text: 'Daily sessions', visible: false }, subtitle: 'Acquisition channels' });
  expect(model.name).toBe('Daily sessions');
  expect(model.summary).toBe('Line chart with 3 series. Day from 1 to 3. Sessions from 5 to 30. '
    + 'Direct: minimum 10, maximum 30, last 20. Search: minimum 12, maximum 20, last 12. '
    + 'Referral: minimum 5, maximum 8, last 8. Reference: Target. Acquisition channels');
  expect(model.note).toBeNull();
  expect(model.table?.caption).toBe('Daily sessions');
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
  expect(model.summary).toMatch(/3 values not shown\. See table\. The reporting period was revised\.$/);
  expect(model.note).toBe('3 values not shown. See table. Some labels hidden. See table.');
  const custom = read(trend, { ...input, messages: resolveMessages({ valuesNotShown: 'Omitted {omitted}, changed {changed}.' }) });
  expect(custom.note).toBe('Omitted 2, changed 1. Some labels hidden. See table.');
  expect(read(trend, { disclosure: { omitted: 0, changed: 1 }, compact: true }).summary).toContain('1 values not shown. See table.');
});

it('uses the external heading when supplied, otherwise generates and reports a missing name', () => {
  const diagnostics = new DiagnosticCollector();
  expect(read(trend, { labelledBy: 'heading', diagnostics }).name).toBe('');
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
    key: 'other', label: 'Other (2)', members: [0, 1], value: 3, ratio: 0.03, angles: null,
  }] }, { type: 'Donut' });
  const table = model.table!;
  expect(table.headers).toEqual(['Category', 'Count (sessions)', 'Percentage']);
  expect(table.rowCount).toBe(9);
  expect(table.row(0)).toEqual(['C0', '1 sessions', '1%']);
  expect(table.row(1)).toEqual(['C1', '2 sessions', '2%']);
  expect(table.row(8)).toEqual(['C8', '64 sessions', '64%']);
  expect(table.pageForX('C8')).toBe(0);
  expect(model.summary).toContain('Other (2): 3 sessions (3%).');
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
