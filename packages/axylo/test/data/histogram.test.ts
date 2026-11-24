import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { validate } from '../../src';
import { normalize, resolveOptions } from '../../src/data';
import { openHistogramStore } from '../../src/data/histogram';
import { DiagnosticCollector, readerDisclosure } from '../../src/diagnostics';
import { buildAlignedView } from '../../src/view';
import { barScene } from '../../src/scene';
import { record } from '../core/host';
import { utc, version } from './helpers';

function distribution(data: unknown, options: Record<string, unknown> = {}) {
  const sink = new DiagnosticCollector();
  const resolved = resolveOptions('histogram', { data, x: 'v', ...options }, sink);
  const frame = normalize('histogram', resolved, utc, sink, version);
  return { frame, resolved, sink, y: [...frame.series[0]!.y], edges: [...frame.binEdges!] };
}
const rows = (values: readonly unknown[]) => values.map(v => ({ v }));
const sum = (numbers: readonly number[]) => numbers.reduce((a, b) => a + b, 0);

describe('histogram bins', () => {
  it('assigns internal boundaries to the right and the final boundary to the final bin', () => {
    const { y, edges, frame } = distribution(rows([0, 1, 1, 4, 5]), { bins: [0, 1, 3, 4, 5] });
    expect(edges).toEqual([0, 1, 3, 4, 5]);
    expect(y).toEqual([1, 2, 0, 2]);
    expect([...frame.x.values]).toEqual([0.5, 2, 3.5, 4.5]);
    expect(frame.yLabel).toBe('Count');
  });

  it('conserves counts under reordering, probability mass and density area for uneven bins', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: -50, max: 100 }), { minLength: 1 }), values => {
      const bins = [-50, -11, 0, 1, 100];
      const data = rows(values);
      const count = distribution(data, { bins });
      expect(sum(count.y)).toBe(values.length);
      const reversed = [...data].reverse();
      expect(distribution(reversed, { bins }).y).toEqual(count.y);
      const auto = distribution(data);
      const reverseAuto = distribution(reversed);
      expect(reverseAuto.edges).toEqual(auto.edges);
      expect(reverseAuto.y).toEqual(auto.y);
      expect(sum(auto.y)).toBe(values.length);
      expect(auto.edges.length).toBeLessThanOrEqual(101);
      const probabilities = distribution(data, { bins, normalize: 'probability' });
      expect(sum(probabilities.y)).toBeCloseTo(1, 12);
      expect(probabilities.frame.series[0]!.valueScale).toBe('ratio');
      const density = distribution(data, { bins, normalize: 'density' }).y;
      expect(sum(density.map((d, i) => d * (bins[i + 1]! - bins[i]!)))).toBeCloseTo(1, 12);
    }), { numRuns: 1000 });
  });

  it('uses interpolated quartiles, Sturges for zero IQR, and equal widths for integer bins', () => {
    // IQR = 3.5, n = 8, h = 3.5. Two intervals become nice multiples of five.
    expect(distribution(rows([0, 1, 2, 3, 4, 5, 6, 7])).edges).toEqual([0, 5, 10]);
    // Sturges gives four intervals spanning 0..8, exactly width two.
    expect(distribution(rows([0, 0, 0, 0, 0, 0, 0, 8])).edges).toEqual([0, 2, 4, 6, 8]);
    expect(distribution(rows([-6, 0, 6]), { bins: 3 }).edges).toEqual([-6, -2, 2, 6]);
  });

  it('handles empty, missing, constant, singleton and extreme samples', () => {
    for (const data of [[], rows([null, null]), { columns: { v: Float32Array.of(NaN) } }, rows([Infinity])]) {
      expect(distribution(data, { bins: [0, 1] })).toMatchObject({ edges: [], y: [], frame: { length: 0 } });
    }
    expect(distribution(rows([0])).edges).toEqual([-0.5, 0.5]);
    expect(distribution(rows([-100, -100]), { bins: 50 })).toMatchObject({ edges: [-105, -95], y: [2] });
    const max = Number.MAX_VALUE;
    for (const samples of [[max], [-max], [-max, max], [1, 1 + Number.EPSILON]]) {
      const { edges, y } = distribution(rows(samples));
      expect(edges.every((e, i) => Number.isFinite(e) && (!i || e > edges[i - 1]!))).toBe(true);
      expect(sum(y)).toBe(samples.length);
    }
  });

  it('preserves borrowed sample order and distinguishes missing, invalid and out-of-range rows', () => {
    const v = Float64Array.of(5, NaN, 0, 1);
    distribution({ columns: { v } });
    expect([...v]).toEqual([5, NaN, 0, 1]);
    const data = [{ v: null }, {}, ...rows([NaN, Infinity, 'bad', -1, 0, 5])];
    const { sink, y } = distribution(data, { bins: [0, 4] });
    expect(y).toEqual([1]);
    expect(sink.inputs()).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'AX102', rows: [1] }),
      expect.objectContaining({ code: 'AX103', rows: [2, 3] }),
      expect.objectContaining({ code: 'AX106', rows: [4, 5, 7], effect: 'omitted' }),
    ]));
    expect(readerDisclosure(sink.inputs()).omitted).toBe(6);
    expect(distribution(rows([-1, 10]), { bins: [0, 2] }).frame.length).toBe(0);
  });

  it('validates the numeric field and options without a document', () => {
    expect(validate('histogram', { title: 'Samples', data: [{ n: '1' }], x: { field: 'n', parse: 'number' } })).toEqual([]);
    expect(distribution(rows(['1', '2'])).sink.inputs()).toMatchObject([{ code: 'AX104', effect: 'none' }]);
    for (const bins of [0, 101, 1.5, [], [0], [1, 1], [0, -1], [0, NaN], [1, Infinity], Array(3)]) {
      expect(distribution(rows([1]), { bins }).sink.inputs()).toMatchObject([{ code: 'AX150', field: 'bins' }]);
    }
    expect(distribution(rows([0]), { normalize: 'share' }).sink.inputs()).toMatchObject([{ code: 'AX150', field: 'normalize' }]);
    expect(distribution([{ other: 2 }]).sink.inputs()).toMatchObject([{ code: 'AX101' }]);
    expect(distribution({ columns: { v: [0, 1], other: [2] } }).sink.inputs()).toMatchObject([{ code: 'AX100' }]);
  });
});

describe('histogram stages together', () => {
  it('fits y to overlapping bins, includes zero and leaves sample counts intact across zoom', () => {
    const { frame, sink } = distribution(rows([1, 1, 1, 3, 10]), { bins: [0, 2, 8, 12] });
    const state = { kind: 'histogram', references: [{ x: 14, label: 'Limit' }], valueDomain: [1, 4] } as const;
    const full = buildAlignedView(frame, state, sink);
    expect(full.xFull).toEqual([0, 14]);
    expect(full.yDomain).toEqual([0, 4]);
    expect(sink.inputs()).toMatchObject([{ code: 'AX110' }]);
    const clipped = buildAlignedView(frame, { ...state, zoom: [2, 2.5], previous: full }, sink);
    expect(clipped.visibleSlots).toEqual({ start: 1, end: 2 });
    expect(clipped.drawSlots).toEqual([clipped.visibleSlots]);
    expect(clipped.frame).toBe(frame);
    expect([...clipped.frame.series[0]!.y]).toEqual([3, 1, 1]);
  });

  it('picks the full interval including an empty bin and jumps to the containing table page', () => {
    const bins = [0, 10, ...Array.from({ length: 100 }, (_, i) => 11 + i)];
    const r = record('histogram', { title: 'Samples', data: rows([0, 110]), bins, x: 'v' });
    r.frames();
    const { lookup, layout, reader } = r.committed!;
    if (layout.kind !== 'plot' || layout.projection.kind !== 'bands') throw Error('Expected a bar plot');
    const { band } = layout.projection;
    for (const [value, midpoint, title] of [[9.9, 5, '0–10'], [10.25, 10.5, '10–11'], [110, 109.5, '109–110']] as const) {
      const target = lookup.pick(band.map(value), layout.plot.y)!;
      expect(target).toEqual({ kind: 'x', x: midpoint });
      expect(lookup.tooltip(target).title).toBe(title);
    }
    expect(reader.table!.row(1)).toEqual(['10–11', '0']);
    expect(reader.table!.pageForX(108.99)).toBe(0);
    expect(reader.table!.pageForX(109)).toBe(1);
    expect(reader.table!.pageForX(110)).toBe(1);
    expect(reader.table!.pageForX(-1)).toBeNull();
    expect(reader.table!.pageForX(111)).toBeNull();
    expect(reader.summary).toContain('v from 0 to 110');
  });

  it('keeps source rows, re-encodes the retained window, and rejects dirty strict appends atomically', () => {
    const chart = record('histogram', { title: 'Samples', strict: true, x: 'v', bins: [0, 2, 10], data: rows([1, 5]) });
    const handle = chart.controller.handle;
    handle.append(rows([4, null, 1]), { keep: 3 });
    chart.frames();
    const table = () => chart.committed!.reader.table!;
    expect([table().row(0), table().row(1)]).toEqual([['0–2', '1'], ['2–10', '1']]);
    expect(() => handle.append(rows([-1, 10]), { keep: 1 })).toThrow(/AX106/);
    handle.update({ bins: [0, 5, 10], normalize: 'probability' });
    chart.frames();
    expect([table().row(0), table().row(1)]).toEqual([['0–5', '100%'], ['5–10', '0%']]);
    handle.append(rows([10]), { keep: 2 });
    chart.frames();
    expect([table().row(0), table().row(1)]).toEqual([['0–5', '50%'], ['5–10', '50%']]);
  });

  it('reports stream errors at original indexes and drops their disclosures on eviction', () => {
    const seed = distribution(rows([2, 2]), { bins: [0, 5] });
    const store = openHistogramStore(seed.frame, seed.resolved, null, utc);
    const bad = store.prepareAppend(rows([NaN, 9]), { keep: 2 });
    expect(bad.diagnostics).toMatchObject([{ code: 'AX103', rows: [2] }, { code: 'AX106', rows: [3] }]);
    const clean = store.prepareAppend(rows([4]), { keep: 1 });
    clean.commit();
    expect(() => bad.commit()).toThrow(/superseded/);
    expect(store.diagnostics).toEqual([]);
    expect([...store.frame.series[0]!.y]).toEqual([1]);
  });

  it('honors x.missing = zero on create and append and clips huge zoomed bins in double precision', () => {
    const chart = record('histogram', {
      title: 'Imputed',
      x: { field: 'v', missing: 'zero' },
      bins: [-0.5, 0.5, 1.5],
      data: rows([null, 1]),
    });
    chart.frames();
    expect(chart.committed!.reader.table!.row(0)).toEqual(['-0.5–0.5', '1']);
    expect(chart.committed!.reader.table!.row(1)).toEqual(['0.5–1.5', '1']);
    chart.controller.handle.append(rows([null]));
    chart.frames();
    expect(chart.committed!.reader.table!.row(0)).toEqual(['-0.5–0.5', '2']);

    const huge = record('histogram', {
      title: 'Clipped huge bin',
      x: 'v',
      bins: [-1e12, 1, 2],
      data: rows([-5e11, 1.5]),
    });
    huge.controller.handle.zoom([0, 2]);
    huge.frames();
    const { view, layout } = huge.committed!;
    if (layout.kind !== 'plot') throw Error('Expected plot layout');
    const scene = barScene(view, layout, 1);
    const rects = scene.marks.filter((m): m is Extract<typeof m, { type: 'rects' }> => m.type === 'rects' && m.variant === 'bar');
    expect(rects).toHaveLength(1);
    const xywh = rects[0]!.xywh;
    // First bin [-1e12, 1] clipped to [0, 2] fills the left half of the plot (minus 1px separator).
    expect(xywh[0]).toBeCloseTo(layout.plot.x, 1);
    expect(xywh[2]).toBeGreaterThan(layout.plot.width * 0.45);
    expect(xywh[2]).toBeLessThan(layout.plot.width * 0.52);
  });
});
