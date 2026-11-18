import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SLOT_GAP, SLOT_NO_ROW, SLOT_NULL, SLOT_VALUE } from '../../src/core/contracts';
import { DiagnosticCollector } from '../../src/diagnostics';
import { buildView } from '../../src/view';
import { aligned, donut, scatter } from './fixtures';

describe('view domains and visibility', () => {
  it('uses the author x extent and keeps the zoom width on either side', () => {
    const options = { x: { field: 'x', domain: [-3, 8] }, y: 'y', data: [{ x: 0, y: 1 }, { x: 5, y: 3 }] };
    const { view } = aligned(options, { kind: 'line', zoom: [-10, -4] });
    expect(view.xFull).toEqual([-3, 8]);
    expect(view.xDomain).toEqual([-3, 3]);
    expect(view.visibleSlots).toEqual({ start: 0, end: 1 });
    expect(aligned(options, { kind: 'line', zoom: [10, 12] }).view.xDomain).toEqual([6, 8]);
    expect(aligned({ ...options, x: 'x' }, { kind: 'line', zoom: [-10, 20] }).view.xDomain).toEqual([0, 5]);
    expect(aligned(options, { kind: 'line', xDomain: null }).view.xFull).toEqual([0, 5]);
  });

  it('keeps category bars and compact charts on their full x ranges', () => {
    const data = [{ x: 'North', y: 8 }, { x: 'East', y: 5 }, { x: 'South', y: 3 }];
    const options = { x: 'x', y: 'y', data };
    expect(aligned(options, { kind: 'bar', zoom: ['East', 'South'] }).view.xDomain).toEqual([0, 2]);
    expect(aligned(options, { kind: 'line', compact: true, zoom: ['East', 'South'] }).view.xDomain).toEqual([0, 2]);
  });

  it('widens draw slots to the nearest joinable values and spans a view between observations', () => {
    const data = Array.from({ length: 9 }, (_, x) => ({ x, y: 2, s: 'dense' }));
    for (const x of [0, 2, 4, 5, 8]) data.push({ x, y: 10, s: 'sparse' });
    const { frame, view } = aligned({ x: 'x', y: 'y', series: 's', data }, { kind: 'line', zoom: [3, 5] });
    expect(frame.series[1]!.slot[3]).toBe(SLOT_NO_ROW);
    expect(view.visibleSlots).toEqual({ start: 3, end: 6 });
    expect(view.drawSlots).toEqual([{ start: 2, end: 7 }, { start: 2, end: 9 }]);
    const between = buildView(frame, { kind: 'line', zoom: [6, 7] }, new DiagnosticCollector());
    expect(between.visibleSlots).toEqual({ start: 6, end: 8 });
    expect(between.drawSlots[1]).toEqual({ start: 5, end: 9 });
  });

  it('stops draw ranges at an explicit null or an expected step', () => {
    const { frame, view } = aligned({
      x: { field: 'x', type: 'date' }, y: 'y',
      data: [1, 2, 3, 5, 6, 7].map(day => ({ x: '2026-03-0' + day, y: day === 6 ? null : day })),
    }, { kind: 'line', zoom: [Date.UTC(2026, 2, 5), Date.UTC(2026, 2, 5, 12)] });
    expect(frame.series[0]!.slot[3]).toBe(SLOT_GAP);
    expect(frame.series[0]!.slot[5]).toBe(SLOT_NULL);
    expect(view.visibleSlots).toEqual({ start: 4, end: 5 });
    expect(view.drawSlots).toEqual([{ start: 4, end: 5 }]);
    const empty = buildView(frame, { kind: 'line', zoom: [Date.UTC(2026, 2, 4), Date.UTC(2026, 2, 4, 12)] }, new DiagnosticCollector());
    expect(empty.drawSlots).toEqual([{ start: 3, end: 4 }]);
  });

  it('ignores hidden, non-drawable and out-of-zoom values when fitting the y axis', () => {
    const data = [
      { x: 0, y: 99, s: 'valid' }, { x: 1, y: 1, s: 'valid' }, { x: 2, y: 3, s: 'valid' },
      { x: 1, y: 100, s: 'hidden' }, { x: 1, y: 400, s: 'duplicate' }, { x: 1, y: 600, s: 'duplicate' },
    ];
    const { frame, view } = aligned({ x: 'x', y: 'y', series: 's', data },
      { kind: 'line', hidden: new Set(['hidden']), zoom: [1, 2] });
    expect(frame.series[2]!.drawable).toBe(false);
    expect(view.visible).toEqual([true, false, false]);
    expect(view.yDomain).toEqual([1, 3]);
  });

  it.each(['bar', 'area'] as const)('widens %s author domains to zero and reports AX110', kind => {
    const options = { x: 'x', y: 'y', data: [{ x: 1, y: 82 }, { x: 2, y: 97 }] };
    const { view, diagnostics } = aligned(options, { kind, valueDomain: [80, 100] });
    expect(view.yDomain).toEqual([0, 100]);
    expect(diagnostics.inputs()).toEqual([
      expect.objectContaining({ code: 'AX110', field: 'y', level: 'warning', origin: 'call' }),
    ]);
    expect(aligned({
      ...options, data: [{ x: 1, y: -9 }, { x: 2, y: -8 }],
    }, { kind, valueDomain: [-10, -5] }).view.yDomain).toEqual([-10, 0]);
  });

  it('rounds a small maximum normally and includes full scale only above the percent threshold', () => {
    const options = (a: number, b: number) => ({
      x: 'x', y: { field: 'y', scale: 'percent' }, data: [{ x: 1, y: a }, { x: 2, y: b }],
    });
    expect(aligned(options(2, 4), { kind: 'bar' }).view.yDomain).toEqual([0, 4]);
    expect(aligned(options(82, 94), { kind: 'bar' }).view.yDomain).toEqual([0, 100]);
  });

  it('resolves references against the frame kind and includes value bands and lines in the domain', () => {
    const { view, diagnostics } = aligned({
      x: 'x', y: 'y', data: [{ x: '2026-02', y: 2 }, { x: '2026-03', y: 5 }],
    }, { kind: 'line', references: [
      { x: ['2026-03', '2026-02'], y: [-5, -10], label: 'Range' },
      { y: 20, label: 'Goal' },
      { x: '2026-02-30', label: 'Invalid' },
    ] });
    expect(view.references).toEqual([
      { axis: 'x', from: Date.UTC(2026, 1, 1), to: Date.UTC(2026, 2, 1), label: 'Range' },
      { axis: 'y', from: -10, to: -5, label: 'Range' },
      { axis: 'y', from: 20, to: 20, label: 'Goal' },
    ]);
    expect(view.yDomain).toEqual([-10, 20]);
    expect(diagnostics.inputs()).toEqual([expect.objectContaining({ code: 'AX107', field: 'reference[2].x' })]);
  });

  it.each(['line', 'area', 'bar'] as const)('keeps compact %s domains independent of references', kind => {
    const { frame, view } = aligned({ x: 'x', y: 'y', data: [{ x: 1, y: 2 }, { x: 2, y: 4 }] }, { kind });
    expect(view.yDomain).toEqual(kind === 'line' ? [2, 4] : [0, 4]);
    const value = fc.integer({ min: 100, max: 10_000 });
    fc.assert(fc.property(value, value, (x, y) => {
      const sink = new DiagnosticCollector();
      const references = [{ x: [x, x + 1] as const, y, label: 'Target' }, { y: Infinity, label: 'Invalid' }];
      const compact = buildView(frame, { kind, compact: true, references, previous: view }, sink);
      expect(compact.xDomain).toEqual(view.xDomain);
      expect(compact.yDomain).toEqual(view.yDomain);
      expect(compact.references).toEqual([]);
      expect(sink.inputs()).toEqual([]);
    }));
  });

  it('matches the normalization rules for instants, wall times and category names', () => {
    const instant = aligned({
      x: { field: 'x', type: 'time' }, y: 'y', data: [{ x: '2026-02-24T05:00:00-05:00', y: 3 }],
    }, { kind: 'line', references: [{ x: new Date('2026-02-24T10:00:00Z'), label: 'Instant' }] }).view;
    expect(instant.references[0]!.from).toBe(instant.frame.x.values[0]);
    const wall = aligned({
      x: 'x', y: 'y', data: [{ x: '2026-02-24T05:00:00', y: 3 }],
    }, { kind: 'line', references: [{ x: '2026-02-24T05:00:00', label: 'Wall time' }] }).view;
    expect(wall.references[0]!.from).toBe(Date.UTC(2026, 1, 24, 5));
    const category = aligned({
      x: 'x', y: 'y', data: [{ x: 'North', y: 3 }, { x: 'South', y: 4 }],
    }, { kind: 'line', references: [{ x: 'South', label: 'Region' }] }).view;
    expect(category.references[0]!.from).toBe(1);
  });

  it('resolves equal reference bounds to a line without a diagnostic', () => {
    const { view, diagnostics } = aligned({ x: 'x', y: 'y', data: [{ x: 1, y: 4 }] }, {
      kind: 'line', references: [{ x: [1, 1], label: 'Band' }, { x: 1, label: 'Line' }],
    });
    expect(view.references).toEqual([
      { axis: 'x', from: 1, to: 1, label: 'Band' }, { axis: 'x', from: 1, to: 1, label: 'Line' },
    ]);
    expect(diagnostics.inputs()).toEqual([]);
  });

  it('keeps scatter ranges per series and uses only the points inside zoom for the value domain', () => {
    const { view } = scatter({ x: 'x', y: 'y', series: 's', data: [
      { x: 3, y: 100, s: 'a' }, { x: 1, y: 2, s: 'a' }, { x: 0, y: 6, s: 'b' }, { x: 2, y: 4, s: 'b' },
      { x: 2, y: 1000, s: 'hidden' },
    ] }, { hidden: new Set(['hidden']), zoom: [1, 2] });
    expect(view.xFull).toEqual([0, 3]);
    expect(view.visible).toEqual([true, true, false]);
    expect(view.visiblePoints).toEqual([{ start: 0, end: 1 }, { start: 1, end: 2 }, { start: 0, end: 1 }]);
    expect(view.yDomain).toEqual([2, 4]);
  });

  it('rounds numeric scatter x outward without forcing zero or changing an author domain', () => {
    const points = { x: 'x', y: 'y', data: [{ x: 10, y: 10 }, { x: 998, y: 998 }] };
    const { view } = scatter(points);
    expect(view.xFull).toEqual([0, 1000]);
    expect(view.xDomain).toBe(view.xFull);
    expect(view.yDomain).toEqual(view.xFull);

    const positive = scatter({ ...points, data: [{ x: 521, y: 1 }, { x: 609, y: 2 }] }).view;
    expect(positive.xFull).toEqual([520, 620]);
    const zoomed = scatter(points, { zoom: [20, 30] }).view;
    expect(zoomed.xFull).toEqual([0, 1000]);
    expect(zoomed.xDomain).toEqual([20, 30]);
    expect(scatter(points, { xDomain: [12, 997] }).view.xFull).toEqual([12, 997]);

    const dates = scatter({ ...points, data: [{ x: '2026-03-03', y: 1 }, { x: '2026-03-08', y: 2 }] }).view;
    expect(dates.frame.xKind).toBe('date');
    expect(dates.xFull).toEqual([Date.UTC(2026, 2, 3), Date.UTC(2026, 2, 8)]);
  });
});

describe('stacks and series cues', () => {
  it('accumulates on separate sides in series order and marks an incomplete stack', () => {
    const { view } = aligned({
      x: 'x', y: ['a', 'hidden', 'b', 'c'], data: [
        { x: 0, a: 3, hidden: 800, b: -2, c: 1 },
        { x: 1, a: -5, hidden: 800, b: 3, c: -1 },
        { x: 2, a: null, hidden: 800, b: -3, c: 0 },
      ],
    }, { kind: 'area', stacked: true, hidden: new Set(['hidden']) });
    expect(view.stack).toEqual({
      order: [0, 2, 3],
      positive: [Float64Array.of(3, 0, 0), Float64Array.of(3, 3, 0), Float64Array.of(4, 3, 0)],
      negative: [Float64Array.of(0, -5, 0), Float64Array.of(-2, -5, -3), Float64Array.of(-2, -6, -3)],
      incomplete: Uint8Array.of(0, 0, 1),
    });
    expect(view.yDomain).toEqual([-6, 4]);
  });

  it('reuses a view for identical inputs and its unchanged stack and cues across zooms', () => {
    const { frame, view } = aligned({
      x: 'x', y: ['a', 'b'], data: [{ x: 0, a: 3, b: -2 }, { x: 1, a: 2, b: -4 }],
    }, { kind: 'area', stacked: true });
    const sink = new DiagnosticCollector();
    const same = buildView(frame, { kind: 'area', stacked: true, previous: view }, sink);
    const zoomed = buildView(frame, { kind: 'area', stacked: true, zoom: [0.5, 1], previous: same }, sink);
    expect(same).toBe(view);
    expect(zoomed.frame).toBe(frame);
    expect(zoomed.stack).toBe(view.stack);
    expect(zoomed.cues).toBe(view.cues);
    expect(zoomed.visibleSlots).toEqual({ start: 1, end: 2 });
    expect(view.stack!.incomplete).toBeNull();
  });

  it('assigns a unique normal color/dash pair to each of 12 series and warns once', () => {
    const y = Array.from({ length: 12 }, (_, i) => 'value' + i);
    const { view, diagnostics } = aligned({
      x: 'x', y, data: [{ x: 1, ...Object.fromEntries(y.map((name, i) => [name, i])) }],
    }, { kind: 'line' });
    expect(view.cues.slice(0, 8).map(cue => cue.marker)).toEqual([
      'circle', 'square', 'triangle', 'diamond', 'cross', 'plus', 'triangle-down', 'star',
    ]);
    expect(view.cues.slice(0, 8).every(cue => cue.dash.normal === null)).toBe(true);
    const identities = view.cues.map((cue, i) => JSON.stringify([i % 8, cue.dash.normal]));
    expect(new Set(identities).size).toBe(12);
    expect(new Set(view.cues.map(cue => JSON.stringify([cue.marker, cue.dash.contrast]))).size).toBe(12);
    expect(diagnostics.inputs()).toEqual([expect.objectContaining({ code: 'AX130', level: 'warning' })]);
  });

  it('gives compact series distinct normal dashes and raises AX131', () => {
    const { view, diagnostics } = aligned({
      x: 'x', y: ['a', 'b'], data: [{ x: 1, a: 4, b: 8 }],
    }, { kind: 'line', compact: true });
    expect(view.cues[0]!.dash.normal).toBeNull();
    expect(view.cues[1]!.dash.normal).not.toBeNull();
    expect(diagnostics.inputs()).toEqual([expect.objectContaining({ code: 'AX131', level: 'hint' })]);
  });

  it('matches visible components of generated long-form stacks, including gaps and absent rows', () => {
    const value = fc.option(fc.integer({ min: -300, max: 300 }), { nil: null });
    const rows = fc.array(fc.tuple(value, value, value), { minLength: 8, maxLength: 30 });
    fc.assert(fc.property(rows, fc.boolean(), fc.boolean(), fc.boolean(), (rows, hide, zoom, author) => {
      const data = rows.flatMap(([a, b, c], x) => [
        ...(x === 3 ? [] : [{ x, s: 'a', y: a }]),
        ...(x % 2 ? [] : [{ x, s: 'b', y: b }]),
        { x, s: 'c', y: c },
      ]);
      const { frame, view } = aligned({ x: 'x', y: 'y', series: 's', data }, {
        kind: 'bar', stacked: true, hidden: hide ? new Set(['b']) : undefined,
        zoom: zoom ? [1.2, 5.9] : null, xDomain: author ? [1, 6] : null,
      });
      const stack = view.stack!;
      expect(frame.series[0]!.slot[3]).toBe(SLOT_GAP);
      expect(frame.series[1]!.slot[3]).toBe(SLOT_NO_ROW);
      expect(stack.order).toEqual(hide ? [0, 2] : [0, 1, 2]);
      if (author) expect(view.xFull).toEqual([1, 6]);
      for (let i = 0; i < rows.length; i++) {
        const [a, b, c] = rows[i]!;
        const components = hide ? [i === 3 ? null : a, c] : [i === 3 ? null : a, i % 2 ? null : b, c];
        expect(stack.incomplete?.[i] ?? 0).toBe(Number(components.includes(null)));
        let positive = 0;
        let negative = 0;
        for (let k = 0; k < components.length; k++) {
          const component = components[k] ?? 0;
          positive += Math.max(0, component);
          negative += Math.min(0, component);
          expect(stack.positive[k]![i]).toBe(positive);
          expect(stack.negative[k]![i]).toBe(negative);
          expect(frame.series[stack.order[k]!]!.slot[i] === SLOT_VALUE).toBe(components[k] !== null);
        }
        if (i >= view.visibleSlots.start && i < view.visibleSlots.end) {
          expect(view.yDomain[0]).toBeLessThanOrEqual(negative);
          expect(view.yDomain[1]).toBeGreaterThanOrEqual(positive);
        }
      }
    }), { numRuns: 1000 });
  });
});

describe('donut slices', () => {
  it('places the parts fixture clockwise in its given order from twelve o’clock', () => {
    const labels = ['Chrome', 'Safari', 'Edge', 'Firefox', 'Samsung Internet', 'Other'];
    const values = [46.2, 27.5, 14.1, 8.9, 2.1, 1.2];
    const endpoints = [0, 46.2, 73.7, 87.8, 96.7, 98.8, 100];
    const { view } = donut(labels.map((label, i) => ({ label, value: values[i]! })));
    expect(view.slices.map(slice => slice.label)).toEqual(labels);
    expect(view.total).toBeCloseTo(100);
    for (let i = 0; i < labels.length; i++) {
      const slice = view.slices[i]!;
      expect(slice.members).toEqual([i]);
      expect(slice.ratio).toBeCloseTo(values[i]! / 100, 12);
      expect(slice.angles![0]).toBeCloseTo(endpoints[i]! * Math.PI / 50, 12);
      expect(slice.angles![1]).toBeCloseTo(endpoints[i + 1]! * Math.PI / 50, 12);
    }
  });

  it('lists zero and null entries with no arcs and leaves an all-zero ring empty', () => {
    const entries = [{ label: 'Zero', value: 0 }, { label: 'Missing', value: null }, { label: 'Positive', value: 5 }];
    const { view } = donut(entries);
    expect(view.slices).toEqual([
      { key: 'Zero', label: 'Zero', members: [0], value: 0, ratio: 0, angles: null, colorIndex: 1 },
      { key: 'Missing', label: 'Missing', members: [1], value: null, ratio: null, angles: null, colorIndex: 2 },
      { key: 'Positive', label: 'Positive', members: [2], value: 5, ratio: 1, angles: [0, 2 * Math.PI], colorIndex: 0 },
    ]);
    const empty = donut(entries.slice(0, 2)).view;
    expect(empty.total).toBe(0);
    expect(empty.slices.every(slice => slice.angles === null)).toBe(true);
  });

  it('keeps the seven largest in original order, favoring the first tie at the cutoff', () => {
    const values = [2, 10, 6, 8, 4, 4, 1, 9, 5, 7];
    const { view, diagnostics } = donut(values.map((value, i) => ({ label: 'Category ' + i, value })),
      { otherLabel: count => count + ' remaining' });
    expect(view.total).toBe(56);
    expect(view.slices.map(slice => slice.members)).toEqual([[1], [2], [3], [4], [7], [8], [9], [0, 5, 6]]);
    expect(view.slices[7]).toEqual({
      key: '__other__', label: '3 remaining', members: [0, 5, 6], value: 7, ratio: 1 / 8, colorIndex: null,
      angles: [expect.closeTo(7 * Math.PI / 4, 12), 2 * Math.PI],
    });
    expect(diagnostics.inputs()).toEqual([expect.objectContaining({ code: 'AX121', level: 'warning', count: 3 })]);
  });

  it('counts positive entries for grouping and does not render a partially negative ring', () => {
    const data = Array.from({ length: 10 }, (_, i) => ({ label: 'Part ' + i, value: i === 0 ? null : i - 1 }));
    const valid = donut(data);
    expect(valid.view.slices).toHaveLength(10);
    expect(valid.diagnostics.inputs()).toEqual([]);
    const invalid = donut([...data, { label: 'Negative', value: -1 }]);
    expect(invalid.view.slices).toEqual([]);
    expect(invalid.diagnostics.inputs()).toEqual([expect.objectContaining({ code: 'AX120', level: 'error' })]);
  });

  it('reserves the grouped slice key even if a category has that name', () => {
    const { view } = donut(Array.from({ length: 9 }, (_, i) => ({ label: i === 0 ? '__other__' : 'Part ' + i, value: 1 })));
    expect(view.slices[0]!.label).toBe('__other__');
    expect(new Set(view.slices.map(slice => slice.key)).size).toBe(8);
    expect(view.slices.at(-1)!.key).toBe('__other__');
  });
});
