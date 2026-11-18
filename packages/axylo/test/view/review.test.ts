import { expect, it } from 'vitest';
import { SLOT_NO_ROW } from '../../src/core/contracts';
import { DiagnosticCollector } from '../../src/diagnostics';
import { buildView } from '../../src/view';
import { aligned, scatter } from './fixtures';

const line = { x: 'x', y: 'y', data: [50, 60, 70, 80].map((y, x) => ({ x, y })) };

it('fits interpolated line endpoints even when two successive zooms contain no slots', () => {
  const { frame, view } = aligned(line, { kind: 'line', zoom: [1.2, 1.8] });
  expect(view.visibleSlots).toEqual({ start: 2, end: 2 });
  expect(view.drawSlots[0]).toEqual({ start: 1, end: 3 });
  expect(view.yDomain).toEqual([62, 68]);
  const zoomed = buildView(frame, { kind: 'line', zoom: [1.4, 1.6], previous: view }, new DiagnosticCollector());
  expect(zoomed.visibleSlots).toBe(view.visibleSlots);
  expect(zoomed.yDomain).toEqual([64, 66]);
});

it('fits a monthly area between observations with the zero baseline', () => {
  const { view } = aligned({
    x: 'x', y: 'y', data: [1200, 1250, 1300, 1350].map((y, i) => ({ x: '2026-0' + (i + 1), y })),
  }, { kind: 'area', zoom: ['2026-02-05', '2026-02-20'] });
  expect(view.visibleSlots).toEqual({ start: 2, end: 2 });
  // The upper edge rises from 1250 to 1300 over the 28 days of February.
  expect(view.yDomain).toEqual([0, 1500]);
});

it('fits a series whose segment crosses NO_ROW slots for the entire zoom', () => {
  const data = Array.from({ length: 7 }, (_, x) => ({ x, y: 1, s: 'dense' }));
  data.push({ x: 0, y: 9, s: 'weekly' }, { x: 6, y: 9, s: 'weekly' });
  const { frame, view } = aligned({ x: 'x', y: 'y', series: 's', data }, { kind: 'line', zoom: [2, 4] });
  expect(frame.series[1]!.slot.slice(2, 5)).toEqual(Uint8Array.of(SLOT_NO_ROW, SLOT_NO_ROW, SLOT_NO_ROW));
  expect(view.yDomain).toEqual([0, 10]);
});

it('fits both interpolated stack totals between slots', () => {
  const { view } = aligned({
    x: 'x', y: ['a', 'b', 'c'], data: [{ x: 0, a: 8, b: 20, c: -8 }, { x: 2, a: 12, b: 24, c: -12 }],
  }, { kind: 'area', stacked: true, zoom: [0.5, 1.5] });
  // The positive total crosses the edges at 30 and 34, and the negative total at -9 and -11.
  expect(view.yDomain).toEqual([-20, 40]);
});

it.each([
  [[-3, -2], [0, 1]], [[4, 5], [2, 3]], [[10, 20], [0, 3]],
  [[-1, 2], [0, 3]], [[2, 2], [0, 3]], [[2.5, 1.5], [0, 3]],
] as const)('fits zoom %j into its full domain without collapsing it', (zoom, domain) => {
  expect(aligned(line, { kind: 'line', zoom }).view.xDomain).toEqual(domain);
  expect(scatter(line, { zoom }).view.xDomain).toEqual(domain);
});

it.each([
  ['time', ['2026-02-01T00:00:00Z', '2026-02-02T00:00:00Z']],
  ['date', ['2026-02-01', '2026-02-02']],
  ['wall', ['2026-02-01T00:00:00', '2026-02-02T00:00:00']],
] as const)('accepts numeric axis positions for %s zoom and author bounds', (kind, dates) => {
  const position = (hour: number) => Date.UTC(2026, 1, 1, hour);
  const options = { x: 'x', y: 'y', data: dates.map((x, y) => ({ x, y })) };
  const { view, diagnostics } = aligned(options, {
    kind: 'line', xDomain: [position(2), position(22)], zoom: [position(4), position(8)],
  });
  expect(view.frame.x.kind).toBe(kind);
  expect(view.xFull).toEqual([position(2), position(22)]);
  expect(view.xDomain).toEqual([position(4), position(8)]);
  expect(diagnostics.inputs().filter(d => d.code === 'AX107')).toEqual([]);
});

it('keeps numbers on category axes as category names', () => {
  const { view } = aligned({
    x: { field: 'x', type: 'category' }, y: 'y', data: [10, 20, 30].map(x => ({ x, y: x })),
  }, { kind: 'line', zoom: [20, 30] });
  expect(view.xDomain).toEqual([1, 2]);
});

it('includes x lines and bands in the automatic extent, including on scatter', () => {
  const references = [{ x: 8, label: 'Future' }, { x: [-3, -1] as const, label: 'Past' }];
  expect(aligned(line, { kind: 'line', references }).view.xFull).toEqual([-3, 8]);
  expect(scatter(line, { references }).view.xFull).toEqual([-3, 8]);
});

it('uses a narrower author x domain over the data and references', () => {
  const references = [{ x: 8, label: 'Future' }];
  const { view } = aligned({ ...line, x: { field: 'x', domain: [0.5, 2.5] } },
    { kind: 'line', zoom: [4, 5], references });
  expect(view.xFull).toEqual([0.5, 2.5]);
  expect(view.xDomain).toEqual([1.5, 2.5]);
  expect(view.visibleSlots).toEqual({ start: 2, end: 3 });
  expect(scatter(line, { xDomain: [0.5, 2.5], zoom: [4, 5], references }).view.xDomain).toEqual([1.5, 2.5]);
});

it('cycles eight qualitatively distinct contrast dashes with a different marker each cycle', () => {
  const y = Array.from({ length: 24 }, (_, i) => 'value' + i);
  const { view } = aligned({
    x: 'x', y, data: [{ x: 1, ...Object.fromEntries(y.map(name => [name, 1])) }],
  }, { kind: 'line' });
  const contrasts = view.cues.map(cue => cue.dash.contrast);
  expect(contrasts[0]).toBeNull();
  expect(contrasts[1]![0]).toBeGreaterThan(contrasts[2]![0]!);
  expect(contrasts[3]![0]).toBeLessThan(contrasts[2]![0]!);
  expect(contrasts.slice(4, 8).map(dash => dash!.length)).toEqual([4, 6, 4, 2]);
  expect(contrasts.slice(8, 16)).toEqual(contrasts.slice(0, 8));
  expect(contrasts.slice(16, 24)).toEqual(contrasts.slice(0, 8));
  expect(new Set(view.cues.map(cue => JSON.stringify([cue.dash.contrast, cue.marker]))).size).toBe(24);
});

it('forwards parser diagnostics for individual references, domains and zoom', () => {
  const { frame } = aligned({
    x: 'x', y: 'y', data: ['2026-02-01T00:00', '2026-02-02T00:00'].map((x, y) => ({ x, y })),
  }, { kind: 'line' });
  const sink = new DiagnosticCollector();
  const refs = [{ x: '2026-02-01T15:00', label: 'Wall' }, { x: 'invalid', label: 'Invalid' }];
  buildView(frame, {
    kind: 'line', references: refs, xDomain: ['2026-02-01T01:00', '2026-02-02T01:00'],
    zoom: ['2026-02-01T10:00', '2026-02-01T20:00'],
  }, sink);
  expect(sink.inputs()).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'AX112', field: 'reference[0].x', count: 1 }),
    expect.objectContaining({ code: 'AX112', field: 'x.domain', count: 2 }),
    expect.objectContaining({ code: 'AX112', field: 'zoom', count: 2 }),
    expect.objectContaining({ code: 'AX107', field: 'reference[1].x', count: 1 }),
  ]));
  expect(sink.inputs().every(d => !d.rows?.length)).toBe(true);
});

it('forwards AX109 for a reference parsed as declared time', () => {
  const { diagnostics } = aligned({
    x: { field: 'x', type: 'time' }, y: 'y', data: [{ x: 1_750_000_000_000, y: 5 }],
  }, { kind: 'line', references: [{ x: 1_750_000_000, label: 'Looks like seconds' }] });
  expect(diagnostics.inputs()).toEqual([
    expect.objectContaining({ code: 'AX109', field: 'reference[0].x', count: 1 }),
  ]);
});

it('reports AX130, AX131 and AX110 only when their conditions newly apply', () => {
  const y = Array.from({ length: 9 }, (_, i) => 'value' + i);
  const { frame } = aligned({
    x: 'x', y, data: [0, 1, 2].map(x => ({ x, ...Object.fromEntries(y.map(name => [name, 3])) })),
  }, { kind: 'area' });
  const counts = (sink: DiagnosticCollector) => Object.fromEntries(sink.inputs().map(d => [d.code, d.count ?? 1]));
  const sink = new DiagnosticCollector();
  const previous = buildView(frame, { kind: 'area' }, sink);
  const state = { kind: 'area', compact: true, valueDomain: [1, 8] } as const;
  const view = buildView(frame, { ...state, previous }, sink);
  expect(buildView(frame, { ...state, previous: view }, sink)).toBe(view);
  const zoomed = buildView(frame, { ...state, compact: false, zoom: [0.25, 1.75], previous: view }, sink);
  expect(counts(sink)).toEqual({ AX130: 1, AX131: 1, AX110: 1 });
  const cleared = buildView(frame, { kind: 'area', previous: zoomed }, sink);
  buildView(frame, { ...state, previous: cleared }, sink);
  expect(counts(sink)).toEqual({ AX130: 1, AX131: 2, AX110: 2 });

  const fewer = aligned({ ...line, y: 'y' }, { kind: 'area' }).frame;
  const narrow = buildView(fewer, { kind: 'area', previous: cleared }, sink);
  buildView(frame, { ...state, previous: narrow }, sink);
  expect(counts(sink)).toEqual({ AX130: 2, AX131: 3, AX110: 3 });
});
