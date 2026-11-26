import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import type { AlignedFrame, DatumRef, PointFrame } from '../../src/core/contracts';
import { StrictError } from '../../src/core/delivery';
import type { Diagnostic, Point } from '../../src/public';
import { check } from '../data/helpers';
import { record, type Recording } from './host';

const initialRows = () => [{ x: 1, y: 10 }, { x: 2, y: 20 }];
const lineOptions = () => ({ title: 'Readings', x: 'x', y: 'y', data: initialRows() });
const codes = (diagnostics: readonly Diagnostic[]) => diagnostics.map(d => d.code);
const alignedRef = (x: number): DatumRef => ({ kind: 'aligned', seriesKey: 'y', x });

function shownCartesian(r: Recording) {
  const view = r.committed?.view;
  if (!view || view.kind === 'donut') throw new Error('Expected a committed Cartesian view');
  return view;
}

function alignedFrame(r: Recording): AlignedFrame {
  const { frame } = shownCartesian(r);
  if (frame.shape !== 'aligned') throw new Error('Expected an aligned frame');
  return frame;
}

function hover(r: Recording, ref: DatumRef): Point<unknown> | null | undefined {
  let seen: Point<unknown> | null | undefined;
  const off = r.controller.handle.on('hover', point => { seen = point; });
  try {
    r.controller.actions.hover(ref);
    return seen;
  } finally {
    off();
  }
}

function rejectStrict(call: () => void): StrictError {
  try {
    call();
  } catch (error) {
    if (error instanceof StrictError) return error;
    throw error;
  }
  throw new Error('Expected the call to throw StrictError synchronously');
}

function frameBytes(frame: AlignedFrame | PointFrame) {
  // Copy just the occupied byte ranges so shared buffers cannot hide in-place writes.
  const bytes = (array: ArrayBufferView | null | undefined) => array == null ? null
    : new Uint8Array(array.buffer, array.byteOffset, array.byteLength).slice();
  if (frame.shape === 'aligned') {
    return { x: bytes(frame.x.values), edges: bytes(frame.binEdges), series: frame.series.map(s => ({
      y: bytes(s.y), slot: bytes(s.slot), row: bytes(s.row),
    })) };
  }
  return { series: frame.series.map(s => ({
    x: bytes(s.x), y: bytes(s.y), row: bytes(s.row), missingX: bytes(s.missingX), missingRow: bytes(s.missingRow),
  })) };
}

function stateOf(r: Recording) {
  const chart = r.controller.handle;
  const { frame } = shownCartesian(r);
  return {
    revision: chart.__bench!.revision,
    diagnostics: structuredClone(chart.diagnostics),
    description: chart.__bench!.describe(),
    drawnRevision: frame.revision,
    epoch: frame.epoch,
    columns: frameBytes(frame),
    retainedRows: chart.__dev!.retainedRows(),
    pending: r.pending,
    draws: r.draws.length,
  };
}

describe('reentrant diagnostic delivery', () => {
  it('appends to the accepted update when AX103 is delivered', () => {
    const seen: string[] = [];
    const r = record('line', {
      ...lineOptions(),
      onDiagnostic(d: Diagnostic) {
        seen.push(d.code);
        if (d.code === 'AX103' && seen.length === 1) chart.append([{ x: 3, y: 30 }]);
      },
    });
    const chart = r.controller.handle;
    r.frames();
    try {
      chart.update({ data: [{ x: 1, y: 10 }, { x: 2, y: NaN }] });
      r.frames();

      expect(seen).toEqual(['AX103']);
      expect(r.pending).toBe(0);
      const frame = alignedFrame(r);
      expect([...frame.x.values]).toEqual([1, 2, 3]);
      expect([...frame.series[0]!.y]).toEqual([10, NaN, 30]);
      expect(hover(r, alignedRef(3))?.row).toEqual({ x: 3, y: 30 });
    } finally {
      chart.destroy();
    }
  });

  it.each([false, true])('continues delivery when a listener throws (strict: %s)', strict => {
    const seen: string[] = [];
    const boom = new Error('boom');
    let armed = false;
    const r = record('line', {
      ...lineOptions(), strict,
      ...(strict ? { data: [{ x: 1, y: '10' }, { x: 2, y: '20' }] } : {}),
      onDiagnostic(d: Diagnostic) {
        seen.push(d.code);
        if (armed && seen.length === 1) throw boom;
      },
    });
    const chart = r.controller.handle;
    const consoleError = vi.spyOn(r.host.console!, 'error');
    r.frames();
    try {
      expect(codes(chart.diagnostics)).toEqual(strict ? ['AX104'] : []);
      seen.length = 0;
      armed = true;
      const dirtyUpdate = () => chart.update({
        title: 'Replacement', data: [{ x: 1, y: 10 }, { x: 2, y: NaN }, { x: 3, y: 'bad' }],
      });
      const before = stateOf(r);
      if (strict) {
        expect(codes(rejectStrict(dirtyUpdate).diagnostics)).toEqual(['AX103', 'AX106']);
        expect(stateOf(r)).toEqual(before);
        expect(r.frames()).toBe(0);
        expect(stateOf(r)).toEqual(before);
      } else {
        expect(dirtyUpdate).not.toThrow();
        expect(codes(chart.diagnostics)).toEqual(['AX103', 'AX106']);
      }
      expect(seen).toEqual(['AX103', 'AX106']);
      expect(consoleError).toHaveBeenCalledExactlyOnceWith('[axylo] onDiagnostic threw:', boom);

      if (!strict) {
        chart.update({ data: initialRows() });
        expect(chart.diagnostics).toEqual([]);
        chart.update({ data: [{ x: 1, y: Infinity }, { x: 2, y: 20 }] });
        expect(seen).toEqual(['AX103', 'AX106', 'AX103']);
        r.frames();
        expect([...alignedFrame(r).series[0]!.y]).toEqual([NaN, 20]);
        expect(consoleError).toHaveBeenCalledTimes(1);
      }
    } finally {
      consoleError.mockRestore();
      chart.destroy();
    }
  });

  it('stops delivering findings when a rejected strict append destroys the chart', () => {
    const seen: string[] = [];
    const r = record('line', {
      ...lineOptions(), data: [{ x: 1, y: 10 }], strict: true,
      onDiagnostic(d: Diagnostic) {
        seen.push(d.code);
        if (seen.length === 1) chart.destroy();
      },
    });
    const chart = r.controller.handle;
    chart.append([{ x: 2, y: 20 }]);
    r.frames();
    expect(chart.__dev!.retainedRows()).toBe(2);

    const error = rejectStrict(() => chart.append([{ x: 3, y: NaN }, { x: 4, y: 'bad' }]));
    expect(codes(error.diagnostics)).toEqual(['AX103', 'AX106']);
    expect(seen).toEqual(['AX103']);
    expect(r.disposed).toBe(1);
    expect(chart.__dev!.retainedRows()).toBe(0);
    const draws = r.draws.length;
    const printed = [...r.printed];

    expect(() => chart.update({ data: [{ x: 1, y: NaN }] })).not.toThrow();
    expect(() => chart.append([{ x: 5, y: 'bad' }])).not.toThrow();
    expect(() => chart.zoom([1, 2])).not.toThrow();
    expect(r.frames()).toBe(0);
    expect(seen).toEqual(['AX103']);
    expect(r.printed).toEqual(printed);
    expect(r.draws).toHaveLength(draws);
    expect(r.disposed).toBe(1);
    expect(r.writesAfterDispose).toBe(0);
  });
});

it('cancels a queued microtask zoom flush and settles readiness on destroy', async () => {
  const r = record('line', { ...lineOptions(), data: [...initialRows(), { x: 3, y: 30 }] });
  const chart = r.controller.handle;
  const microtasks: (() => void)[] = [];
  r.host.scheduleMicrotask = callback => microtasks.push(callback);
  r.frames();
  const draws = chart.__dev!.stages().draw;
  expect(draws).toBeGreaterThan(0);

  chart.zoom([1, 2]);
  const readyBeforeDestroy = chart.__bench!.ready();
  chart.destroy();
  expect(microtasks).toHaveLength(1);
  for (const task of microtasks.splice(0)) task();
  expect(r.frames()).toBe(0);

  expect(r.disposed).toBe(1);
  expect(r.writesAfterDispose).toBe(0);
  expect(chart.__dev!.stages().draw).toBe(draws);
  await expect(readyBeforeDestroy).resolves.toBeUndefined();
  await expect(chart.__bench!.ready()).resolves.toBeUndefined();
});

const finiteFloat = fc.float({ noNaN: true, noDefaultInfinity: true });
const edgesArbitrary = fc.uniqueArray(finiteFloat, { minLength: 2, maxLength: 16, comparator: 'SameValueZero' })
  .map(edges => [...edges].sort((a, b) => a - b));
const countArbitrary = fc.integer({ min: 1, max: 20 });
const batchesArbitrary = fc.array(fc.array(finiteFloat, { minLength: 1, maxLength: 20 }), { minLength: 2, maxLength: 3 });
const keepArbitrary = fc.integer({ min: 1, max: 15 });
const modes = ['count', 'probability', 'density'] as const;
type HistogramMode = typeof modes[number];
type Bins = number | readonly number[];

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const samplesOf = (values: readonly number[]) => values.map(v => ({ v }));

function histogram(values: readonly number[], bins: Bins, normalize: HistogramMode): AlignedFrame {
  const { frame } = check('histogram', { x: 'v', bins, normalize, data: samplesOf(values) });
  if (frame.shape !== 'aligned') throw new Error('Expected histogram bins in an aligned frame');
  return frame;
}

function checkHistogram(values: readonly number[], bins: Bins) {
  const count = histogram(values, bins, 'count');
  const edges = [...count.binEdges!];
  const counts = [...count.series[0]!.y];
  const low = typeof bins === 'number' ? Math.min(...values) : bins[0]!;
  const high = typeof bins === 'number' ? Math.max(...values) : bins.at(-1)!;
  const inRangeCount = values.filter(value => value >= low && value <= high).length;

  expect(sum(counts)).toBe(inRangeCount);
  if (inRangeCount === 0) {
    expect(edges).toEqual([]);
    expect(counts).toEqual([]);
  } else {
    if (typeof bins !== 'number') expect(edges).toEqual(bins);
    else if (low < high) {
      expect(edges).toHaveLength(bins + 1);
      expect(edges[0]).toBe(low);
      expect(edges.at(-1)).toBe(high);
    }
    expect(counts).toHaveLength(edges.length - 1);
    expect(edges.length).toBeGreaterThanOrEqual(2);
    expect(edges.every(Number.isFinite)).toBe(true);
    for (let i = 1; i < edges.length; i++) expect(edges[i]).toBeGreaterThan(edges[i - 1]!);
    const expectedCounts = edges.slice(0, -1).map((left, i) => {
      const right = edges[i + 1]!;
      return values.filter(value => value >= left && (value < right || (i === edges.length - 2 && value === right))).length;
    });
    expect(counts).toEqual(expectedCounts);
  }

  const probability = histogram(values, bins, 'probability');
  const density = histogram(values, bins, 'density');
  const mass = [...probability.series[0]!.y];
  const area = [...density.series[0]!.y].map((y, i) => y * (edges[i + 1]! - edges[i]!));
  const total = inRangeCount === 0 ? 0 : 1;
  expect([...probability.binEdges!]).toEqual(edges);
  expect([...density.binEdges!]).toEqual(edges);
  expect(mass).toHaveLength(counts.length);
  expect(area).toHaveLength(counts.length);
  expect(Math.abs(sum(mass) - total)).toBeLessThanOrEqual(1e-11);
  expect(Math.abs(sum(area) - total)).toBeLessThanOrEqual(1e-11);
  for (let i = 0; i < counts.length; i++) {
    const expectedShare = counts[i]! / inRangeCount;
    expect(Math.abs(mass[i]! - expectedShare)).toBeLessThanOrEqual(1e-11);
    expect(Math.abs(area[i]! - expectedShare)).toBeLessThanOrEqual(1e-11);
  }
  return { count, probability, density };
}

describe('histogram conservation and sample windows', () => {
  // The midpoint seeds reproduce rounding failures independently of the other histogram properties.
  for (const [name, binsArbitrary, midpointSeed] of [
    ['explicit', edgesArbitrary, 1930573020],
    ['integer', countArbitrary, -1165616199],
  ] as const) {
    it(`conserves counts, mass and area through sample eviction (${name} bins)`, () => {
      fc.assert(fc.property(binsArbitrary, batchesArbitrary, keepArbitrary, (bins, [seed, ...batches], keep) => {
        // Exact endpoints, shared bin boundaries and duplicate samples must be counted too.
        const first = typeof bins === 'number' ? seed! : [...seed!, ...bins, bins[0]!];
        checkHistogram([...first, ...batches.flat()], bins);
        let retained = first;
        const appends = batches.map(batch => {
          retained = [...retained, ...batch].slice(-keep);
          return { rows: samplesOf(batch), fresh: checkHistogram(retained, bins) };
        });

        for (const normalize of modes) {
          const r = record('histogram', { title: 'Samples', x: 'v', bins, normalize, data: samplesOf(first) });
          const chart = r.controller.handle;
          try {
            r.frames();
            for (const { rows, fresh } of appends) {
              chart.append(rows, { keep });
              r.frames();
              expect(frameBytes(alignedFrame(r))).toEqual(frameBytes(fresh[normalize]));
            }
          } finally {
            chart.destroy();
          }
        }
      }), { numRuns: 150 });
    });

    it(`plots the arithmetic center of each interval (${name} bins)`, () => {
      fc.assert(fc.property(binsArbitrary, batchesArbitrary, (bins, batches) => {
        const values = typeof bins === 'number' ? batches.flat() : [...batches.flat(), ...bins];
        const frame = histogram(values, bins, 'count');
        const edges = [...frame.binEdges!];
        expect([...frame.x.values]).toEqual(edges.slice(0, -1).map((left, i) => (left + edges[i + 1]!) / 2));
      }), { numRuns: 150, seed: midpointSeed });
    });
  }

  it('keeps midpoints finite and strictly increasing at float64 overflow and adjacent-ULP boundaries', () => {
    const huge = histogram([1e308, 1.5e308], [1e308, 1.25e308, 1.5e308], 'count');
    expect([...huge.x.values]).toEqual([1.125e308, 1.375e308]);
    const eps = Number.EPSILON;
    const ulp = histogram([1, 1 + eps, 1 + 2 * eps], [1, 1 + eps, 1 + 2 * eps], 'count');
    const xs = [...ulp.x.values];
    expect(xs).toHaveLength(2);
    expect(xs.every(Number.isFinite)).toBe(true);
    expect(xs[1]!).toBeGreaterThan(xs[0]!);
  });
});

const zoomData = fc.array(fc.integer({ min: -100, max: 100 }), { minLength: 6, maxLength: 30 }).chain(ys => fc.record({
  ys: fc.constant(ys),
  start: fc.integer({ min: -500, max: 500 }),
  step: fc.integer({ min: 1, max: 20 }),
  indexes: fc.uniqueArray(fc.integer({ min: 1, max: ys.length - 2 }), { minLength: 4, maxLength: 4 }),
}));

describe('controller zoom domains', () => {
  it.each(['line', 'scatter', 'histogram'] as const)('%s zooms inward, preserves the frame and resets once', kind => {
    fc.assert(fc.property(zoomData, ({ ys, start, step, indexes }) => {
      const data = ys.map((y, i) => ({ x: start + i * step, y }));
      const xs = data.map(row => row.x);
      const full = [xs[0]!, xs.at(-1)!] as const;
      const [left, innerLeft, innerRight, right] = [...indexes].sort((a, b) => a - b).map(i => xs[i]!);
      const outer = [left!, right!] as const;
      const inner = [innerLeft!, innerRight!] as const;
      const r = record(kind, kind === 'histogram'
        ? { title: 'Zoom', x: 'x', bins: xs, data }
        : { title: 'Zoom', x: 'x', y: 'y', data });
      const chart = r.controller.handle;
      const zooms: unknown[] = [];
      chart.on('zoom', domain => zooms.push(domain));
      try {
        r.frames();
        const initial = shownCartesian(r);
        const initialX = [...initial.xFull];
        const initialY = [...initial.yDomain];
        const originalBytes = frameBytes(initial.frame);
        expect(initial.xDomain).toEqual(initialX);
        if (kind === 'scatter') {
          expect(initialX[0]).toBeLessThanOrEqual(full[0]);
          expect(initialX[1]).toBeGreaterThanOrEqual(full[1]);
        } else expect(initialX).toEqual(full);

        let previous = initialX;
        for (const window of [outer, inner]) {
          chart.zoom(window);
          r.frames();
          const current = shownCartesian(r);
          expect(current.xFull).toEqual(initialX);
          expect(current.xDomain).toEqual(window);
          const [leftEdge, rightEdge] = current.xDomain;
          expect(leftEdge).toBeGreaterThanOrEqual(previous[0]!);
          expect(rightEdge).toBeLessThanOrEqual(previous[1]!);
          expect(leftEdge).toBeLessThan(rightEdge);
          expect(frameBytes(current.frame)).toEqual(originalBytes);
          previous = [...current.xDomain];
        }

        chart.zoom(null);
        r.frames();
        expect(zooms).toEqual([outer, inner, null]);
        const reset = shownCartesian(r);
        expect(reset.xDomain).toEqual(initialX);
        expect(reset.yDomain).toEqual(initialY);
        expect(frameBytes(reset.frame)).toEqual(originalBytes);

        chart.zoom(null);
        r.frames();
        expect(zooms).toEqual([outer, inner, null]);
        const repeated = shownCartesian(r);
        expect(repeated.xDomain).toEqual(initialX);
        expect(repeated.yDomain).toEqual(initialY);
        expect(frameBytes(repeated.frame)).toEqual(originalBytes);
      } finally {
        chart.destroy();
      }
    }), { numRuns: 150 });
  });
});

type StreamRow = { x: number; y: number | null };
type SourceRow = { row: StreamRow; index: number };
type StreamKind = 'line' | 'scatter';

const streamY = fc.integer({ min: -10, max: 10 });
const appendOp = fc.record({
  op: fc.constant('append' as const), keep: keepArbitrary, lastY: streamY,
  entries: fc.array(fc.record({ y: fc.option(streamY, { nil: null }), advance: fc.integer({ min: 0, max: 3 }) }), { maxLength: 5 }),
});
const dirtyOp = fc.record({
  op: fc.constant('reject' as const),
  via: fc.constantFrom('append', 'update'),
  value: fc.constantFrom(NaN, 'bad'),
  keep: keepArbitrary,
});
const streamOp = fc.oneof(appendOp, dirtyOp, ...(['pause', 'resume', 'frame', 'ninth series', 'out of order'] as const)
  .map(op => fc.constant({ op })));

function expectHover(r: Recording, ref: DatumRef, { row, index }: SourceRow) {
  const point = hover(r, ref);
  expect(point).toEqual({ series: 'y', x: row.x, y: row.y, row, index });
  expect(point?.row).toBe(row);
}

function expectStream(r: Recording, kind: StreamKind, visible: readonly SourceRow[]) {
  const view = shownCartesian(r);
  expect(view.kind).toBe(kind);
  expect(view.frame.series).toHaveLength(1);
  const ordered = [...visible].sort((a, b) => a.row.x - b.row.x);
  if (view.kind === 'scatter') {
    const points = ordered.filter(({ row }) => row.y !== null)
      .sort((a, b) => a.row.x - b.row.x || a.row.y! - b.row.y!);
    const missing = ordered.filter(({ row }) => row.y === null);
    const series = view.frame.series[0]!;
    expect([...series.x]).toEqual(points.map(({ row }) => row.x));
    expect([...series.y]).toEqual(points.map(({ row }) => row.y));
    expect([...(series.missingX ?? [])]).toEqual(missing.map(({ row }) => row.x));
    expect([...(series.missingRow ?? [])]).toEqual(missing.map(({ index }) => index));
    for (const entry of points) {
      expectHover(r, { kind: 'point', seriesKey: 'y', x: entry.row.x, row: entry.index }, entry);
    }
  } else {
    expect([...view.frame.x.values]).toEqual(ordered.map(({ row }) => row.x));
    expect([...view.frame.series[0]!.y]).toEqual(ordered.map(({ row }) => row.y ?? NaN));
    for (const entry of ordered) expectHover(r, alignedRef(entry.row.x), entry);
  }
}

describe('strict streaming through Pause and Resume', () => {
  it.each(['line', 'scatter'] as const)('%s displays exactly the accepted retained rows', kind => {
    fc.assert(fc.property(fc.boolean(), appendOp, appendOp, dirtyOp, fc.array(streamOp, { minLength: 4, maxLength: 26 }),
      (shuffle, firstAppend, pausedAppend, firstRejection, ops) => {
        const seed: StreamRow[] = [{ x: 0, y: 0 }, { x: 1, y: null }, { x: 2, y: 20 }];
        if (kind === 'scatter') {
          seed.push({ x: 2, y: 20 });
          if (shuffle) seed.reverse();
        }
        const r = record(kind, { ...lineOptions(), strict: true, data: seed });
        const chart = r.controller.handle;
        let retained = seed.map((row, index): SourceRow => ({ row, index }));
        let nextIndex = retained.length;
        let newest = 2;
        let paused = false;
        let pending = retained;
        let drawn = retained;
        const frame = () => {
          r.frames();
          drawn = pending;
          expectStream(r, kind, drawn);
        };
        const reject = (call: () => void, code: string) => {
          const before = stateOf(r);
          expect(codes(rejectStrict(call).diagnostics)).toContain(code);
          expect(stateOf(r)).toEqual(before);
          expectStream(r, kind, drawn);
        };

        try {
          frame();
          // Every run validates a frozen frame while updates and a rejection are pending.
          const sequence = [firstAppend, { op: 'frame' }, { op: 'pause' }, pausedAppend, firstRejection,
            { op: 'frame' }, { op: 'resume' }, { op: 'frame' }, ...ops, { op: 'resume' }, { op: 'frame' }] as const;
          for (const step of sequence) {
            switch (step.op) {
              case 'append': {
                const appended = step.entries.map(({ y, advance }) => {
                  newest += kind === 'line' ? 1 : advance;
                  return { x: newest, y };
                });
                appended.push({ x: ++newest, y: step.lastY });
                if (kind === 'scatter') appended.push({ x: newest, y: step.lastY });
                chart.append(appended, { keep: step.keep });
                const all = [...retained, ...appended.map(row => ({ row, index: nextIndex++ }))];
                const retainedX = [...new Set(all.map(({ row }) => row.x))].sort((a, b) => a - b).slice(-step.keep);
                retained = all.filter(({ row }) => retainedX.includes(row.x));
                if (!paused) pending = retained;
                break;
              }
              case 'pause':
                r.controller.actions.pause(true);
                paused = true;
                break;
              case 'resume':
                r.controller.actions.pause(false);
                paused = false;
                pending = retained;
                break;
              case 'frame':
                frame();
                break;
              case 'reject': {
                const dirty = [{ x: newest + 1, y: 1 }, { x: newest + 2, y: step.value }];
                const call = step.via === 'append'
                  ? () => chart.append(dirty, { keep: step.keep })
                  : () => chart.update({ title: 'Rejected', data: dirty });
                reject(call, step.value === 'bad' ? 'AX106' : 'AX103');
                break;
              }
              case 'ninth series': {
                const data = Array.from({ length: 9 }, (_, i) => ({ x: i, y: i, group: `Series ${i + 1}` }));
                reject(() => chart.update({ data, series: 'group' }), 'AX130');
                break;
              }
              case 'out of order': {
                const older = Math.min(...retained.map(({ row }) => row.x)) - 1;
                reject(() => chart.append([{ x: older, y: 10 }], { keep: 1 }), 'AX151');
                break;
              }
            }
          }
        } finally {
          chart.destroy();
        }
      }), { numRuns: 120 });
  });
});
