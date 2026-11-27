/**
 * N5: the native `boxplot` layer, fed by `boxplot()` of `axylo/stats` (R-7 quartiles, Tukey whiskers). Expected
 * values are the hand-computed summaries of the groups below:
 *   A = 1..9, 30: Q1 = 3.25, median = 5.5, Q3 = 7.75, IQR 4.5, fences [-3.5, 14.5] → whiskers 1 and 9, outlier 30
 *   B = 10..14:   Q1 = 11, median = 12, Q3 = 13, fences [8, 16] → whiskers 10 and 14, no outliers
 *   C = -20, 2, 4, 6, 8: Q1 = 2, median = 4, Q3 = 6, fences [-4, 12] → whiskers 2 and 8, outlier -20
 */
import { describe, expect, it } from 'vitest';
import { boxplot } from '../../src/stats';
import { validateCartesian } from '../../src/cartesian';
import { position } from '../../src/scene/geometry';
import { marksOf, n5run, xPixel, yScaleOf } from './n5-pipeline';

const samples: Record<string, number[]> = {
  A: [1, 2, 3, 4, 5, 6, 7, 8, 9, 30], B: [10, 11, 12, 13, 14], C: [-20, 2, 4, 6, 8],
};
const rows = Object.entries(samples).flatMap(([g, values]) => values.map(v => ({ g, v })));
const result = boxplot(rows, { x: 'g', y: 'v' });

// The stats result is used as it is: its columns, plus the grouped outliers as one column of arrays.
const columns = { ...result.data.columns, outliers: result.groups.map(g => g.summary.outliers) };
const options = (layers?: unknown[]) => ({
  data: { columns }, x: 'x',
  axes: { v: { position: 'left' } },
  layers: layers ?? [
    { type: 'boxplot', min: 'whiskerLow', q1: 'q1', median: 'median', q3: 'q3', max: 'whiskerHigh', outliers: 'outliers', yAxis: 'v', label: 'Spread' },
    { type: 'scatter', y: 'mean', yAxis: 'v', label: 'Mean' },
  ],
});

describe('N5 native boxplot layer', () => {
  it('consumes the stats result without changing it', () => {
    expect(Array.from(result.data.columns.q1)).toEqual([3.25, 11, 2]);
    expect(Array.from(result.data.columns.median)).toEqual([5.5, 12, 4]);
    expect(Array.from(result.data.columns.q3)).toEqual([7.75, 13, 6]);
    expect(Array.from(result.data.columns.whiskerLow)).toEqual([1, 10, 2]);
    expect(Array.from(result.data.columns.whiskerHigh)).toEqual([9, 14, 8]);
    const run = n5run(options());
    expect(run.view.frame.series.map(s => s.label)).toEqual(['Spread', 'Mean']);
    // The borrowed numeric columns are the frame's columns, not copies.
    expect(run.frame.series.find(s => s.field === 'q1')!.y).toBe(result.data.columns.q1);
    expect(run.diagnostics.filter(d => d.level !== 'hint').map(d => d.code)).toEqual([]);
  });

  it('draws discrete Q1–Q3 boxes, medians, capped whiskers and outlier points from one geometry', () => {
    const run = n5run(options());
    const y = yScaleOf(run.layout, 0);
    const boxes = marksOf(run, 'rects', 0);
    expect(boxes).toHaveLength(1);
    const xywh = boxes[0]!.xywh;
    expect(xywh.length).toBe(12);
    const q1 = [3.25, 11, 2], q3 = [7.75, 13, 6], median = [5.5, 12, 4], lo = [1, 10, 2], hi = [9, 14, 8];
    for (let g = 0; g < 3; g++) {
      const px = xPixel(run.layout, run.view, g);
      const w = xywh[4 * g + 2]!;
      expect(xywh[4 * g]! + w / 2).toBeCloseTo(px, 3);
      expect(xywh[4 * g + 1]!).toBeCloseTo(position(y, q3[g]!), 3);
      expect(xywh[4 * g + 3]!).toBeCloseTo(position(y, q1[g]!) - position(y, q3[g]!), 3);
    }
    const paths = marksOf(run, 'path', 0);
    const medianPath = paths.find(p => p.stroke.kind === 'token')!;
    const whiskers = paths.find(p => p.stroke.kind === 'series')!;
    expect(medianPath.xy.length).toBe(18);
    for (let g = 0; g < 3; g++) expect(medianPath.xy[6 * g + 1]!).toBeCloseTo(position(y, median[g]!), 3);
    // Per box: upper whisker, lower whisker, upper cap, lower cap.
    expect(whiskers.xy.length).toBe(3 * 24);
    for (let g = 0; g < 3; g++) {
      expect(whiskers.xy[24 * g + 3]!).toBeCloseTo(position(y, hi[g]!), 3);
      expect(whiskers.xy[24 * g + 9]!).toBeCloseTo(position(y, lo[g]!), 3);
    }
    const outliers = marksOf(run, 'points', 0);
    expect(outliers).toHaveLength(1);
    expect(Array.from(outliers[0]!.xy)).toEqual([
      xPixel(run.layout, run.view, 0), position(y, 30), xPixel(run.layout, run.view, 2), position(y, -20),
    ].map(v => Math.fround(v)));
    // No continuous band: a box plot draws no area mark.
    expect(marksOf(run, 'area')).toEqual([]);
    // The domain holds the outliers (spec F7: the automatic domain contains all drawn data).
    expect(run.view.yDomain[0]).toBeLessThanOrEqual(-20);
    expect(run.view.yDomain[1]).toBeGreaterThanOrEqual(30);
  });

  it('reads one box as one tooltip row and keyboard reading, and as six table columns', () => {
    const run = n5run(options());
    expect(run.lookup.tooltip({ kind: 'x', x: 0 }).rows.map(r => [r.seriesLabel, r.value])).toEqual([
      ['Spread', 'median 5.5 (min 1, Q1 3.25, Q3 7.75, max 9; outliers 30)'], ['Mean', '7.5'],
    ]);
    expect(run.lookup.datum({ kind: 'aligned', seriesKey: 'median', x: 1 })!.value)
      .toBe('median 12 (min 10, Q1 11, Q3 13, max 14; no outliers)');
    const table = run.reader.table!;
    expect(table.headers).toEqual(['x', 'Spread min', 'Spread Q1', 'Spread median', 'Spread Q3', 'Spread max', 'Spread outliers', 'Mean']);
    expect(table.row(0)).toEqual(['A', '1', '3.25', '5.5', '7.75', '9', '30', '7.5']);
    expect(table.row(1)).toEqual(['B', '10', '11', '12', '13', '14', 'none', '12']);
    expect(table.row(2)).toEqual(['C', '2', '2', '4', '6', '8', '-20', '0']);
  });

  it('summarizes a box from its whiskers and outliers', () => {
    const run = n5run(options());
    expect(run.reader.summary).toContain('Spread: minimum -20, maximum 30, last median 4.');
    expect(run.reader.summary).toContain('from -20 to 30.');
  });

  it('picks the box under the pointer, its outliers, and a scatter point first', () => {
    const run = n5run(options());
    const y = yScaleOf(run.layout, 0);
    const keyAt = (px: number, py: number) => {
      const t = run.lookup.pick(px, py);
      const ref = t && run.lookup.primary(t);
      return ref && ref.kind === 'aligned' ? ref.seriesKey : null;
    };
    const xA = xPixel(run.layout, run.view, 0);
    // Mean of A is 7.5, inside the box; 4 is inside the box and more than 24 px from the mean in a 400 px plot?
    const far = Math.abs(position(y, 4) - position(y, 7.5)) > 24;
    if (far) expect(keyAt(xA, position(y, 4))).toBe('median');
    expect(keyAt(xA, position(y, 30))).toBe('median');
    expect(keyAt(xA, position(y, 7.5))).toBe('mean');
    const anchor = run.lookup.anchor({ kind: 'aligned', seriesKey: 'median', x: 0 })!;
    expect(anchor.y).toBeCloseTo(position(y, 9), 3);
    expect(anchor.y + anchor.height).toBeCloseTo(position(y, 1), 3);
  });

  it('hides the whole box with its one toggle, outliers and domain included', () => {
    const run = n5run(options(), { hidden: ['median'] });
    expect(run.scene.marks.filter(m => 'series' in m && m.series === 0)).toEqual([]);
    expect(run.view.yDomain[1]).toBeLessThan(30);
    expect(run.lookup.tooltip({ kind: 'x', x: 0 }).rows.map(r => r.seriesLabel)).toEqual(['Mean']);
    const swatch = run.swatch(0, run.view.cues[0]!, true, run.view);
    expect([swatch.color, swatch.hollow, swatch.shape?.key]).toEqual([0, true, 'boxplot']);
  });

  it('reports boxes whose five numbers are out of order (AX176) and reads them raw', () => {
    const bad = {
      data: [{ x: 1, a: 1, b: 2, c: 3, d: 4, e: 5 }, { x: 2, a: 1, b: 4, c: 3, d: 2, e: 5 }], x: 'x',
      axes: { v: { position: 'left' } },
      layers: [{ type: 'boxplot', min: 'a', q1: 'b', median: 'c', q3: 'd', max: 'e', yAxis: 'v', label: 'Box' }],
    };
    const run = n5run(bad);
    const ax176 = run.diagnostics.filter(d => d.code === 'AX176');
    expect(ax176.map(d => [d.field, d.count, d.rows])).toEqual([['Box', 1, [1]]]);
    expect(run.lookup.datum({ kind: 'aligned', seriesKey: 'c', x: 2 })!.value).toBe('median 3 (min 1, Q1 4, Q3 2, max 5; no outliers)');
    expect(validateCartesian(bad as never).some(d => d.code === 'AX176')).toBe(true);
  });

  it('draws degenerate boxes, honours capWidth 0, and clips boxes to a pinned domain', () => {
    const flat = {
      data: [{ x: 1, a: 5, b: 5, c: 5, d: 5, e: 5 }, { x: 2, a: 1, b: 2, c: 3, d: 13, e: 20 }], x: 'x',
      axes: { v: { position: 'left', domain: [0, 10] } },
      layers: [{ type: 'boxplot', min: 'a', q1: 'b', median: 'c', q3: 'd', max: 'e', yAxis: 'v', capWidth: 0, label: 'Box' }],
    };
    const run = n5run(flat);
    const plot = run.layout.kind === 'plot' ? run.layout.plot : null;
    const rects = marksOf(run, 'rects', 0)[0]!.xywh;
    // A box with Q1 = Q3 is still a visible 1 px box at its value.
    expect(rects[3]).toBe(1);
    expect(rects[1]).toBeCloseTo(position(yScaleOf(run.layout, 0), 5), 3);
    // Q3 = 13 is above the pinned domain: the box stops at the plot's top edge.
    expect(rects[5]).toBeCloseTo(plot!.y, 3);
    // capWidth 0: two whisker segments per box, no caps.
    const whiskers = marksOf(run, 'path', 0).find(p => p.stroke.kind === 'series')!;
    expect(whiskers.xy.length).toBe(2 * 12);
  });

  it('draws a single box when zoomed onto one slot, picked and anchored on it', () => {
    // Category x does not zoom (spec 3.6), so this box plot is on a numeric x.
    const numeric = {
      data: [1, 2, 3].map(x => ({ x, a: x, b: x + 1, c: x + 2, d: x + 3, e: x + 4 })), x: 'x',
      axes: { v: { position: 'left' } },
      layers: [{ type: 'boxplot', min: 'a', q1: 'b', median: 'c', q3: 'd', max: 'e', yAxis: 'v', label: 'Box' }],
    };
    const run = n5run(numeric, { zoom: [1.5, 2.5] as const });
    expect(run.view.visibleSlots.end - run.view.visibleSlots.start).toBe(1);
    const rects = marksOf(run, 'rects', 0)[0]!.xywh;
    expect(rects.length).toBe(4);
    // One slot in view: no neighbour gap, so the half width is a quarter of the x range's 30%, kept to 3–24 px.
    expect(rects[2]).toBeGreaterThanOrEqual(6);
    expect(rects[2]).toBeLessThanOrEqual(48);
    expect(run.lookup.anchor({ kind: 'aligned', seriesKey: 'c', x: 2 })).not.toBeNull();
  });

  it('rejects a boxplot layer without its five distinct fields (AX174)', () => {
    const diagnostics = validateCartesian({
      data: [{ x: 1, a: 1 }], x: 'x', axes: { v: { position: 'left' } },
      layers: [{ type: 'boxplot', min: 'a', q1: 'a', median: 'a', q3: 'a', max: 'a', yAxis: 'v' }],
    } as never);
    expect(diagnostics.filter(d => d.code === 'AX174')).toHaveLength(1);
  });

  it('preserves empty, absent-per-row and typed-array outliers cleanly while diagnosing non-finite and malformed outlier cells', () => {
    // Normal empty, absent-per-row (undefined / null), and stats Float64Array outliers emit zero warnings/errors.
    const clean = {
      title: 'Clean outliers',
      data: [
        { x: 1, a: 1, b: 2, c: 3, d: 4, e: 5, o: new Float64Array([12]) },
        { x: 2, a: 1, b: 2, c: 3, d: 4, e: 5, o: [] },
        { x: 3, a: 1, b: 2, c: 3, d: 4, e: 5, o: null },
        { x: 4, a: 1, b: 2, c: 3, d: 4, e: 5 },
      ],
      x: 'x', axes: { v: { position: 'left' } },
      layers: [{ type: 'boxplot', min: 'a', q1: 'b', median: 'c', q3: 'd', max: 'e', outliers: 'o', yAxis: 'v' }],
    };
    const cleanRun = n5run(clean);
    expect(cleanRun.diagnostics.filter(d => d.level !== 'hint')).toEqual([]);
    expect(validateCartesian(clean as never).filter(d => d.level !== 'hint')).toEqual([]);
    expect(marksOf(cleanRun, 'points', 0)[0]!.xy.length).toBe(2);

    // Non-finite (NaN / Infinity) emits AX103; non-numeric elements and malformed cells emit AX106; valid outliers still draw.
    const malformed = {
      data: [
        { x: 1, a: 1, b: 2, c: 3, d: 4, e: 5, o: [12, NaN, Infinity] },
        { x: 2, a: 1, b: 2, c: 3, d: 4, e: 5, o: [15, 'bad'] },
        { x: 3, a: 1, b: 2, c: 3, d: 4, e: 5, o: 'not-a-list' },
      ],
      x: 'x', axes: { v: { position: 'left' } },
      layers: [{ type: 'boxplot', min: 'a', q1: 'b', median: 'c', q3: 'd', max: 'e', outliers: 'o', yAxis: 'v' }],
    };
    const badRun = n5run(malformed);
    const ax103 = badRun.diagnostics.filter(d => d.code === 'AX103');
    const ax106 = badRun.diagnostics.filter(d => d.code === 'AX106');
    expect(ax103.map(d => [d.field, d.count, d.rows])).toEqual([['o', 2, [0]]]);
    expect(ax106.map(d => [d.field, d.count, d.rows])).toEqual([['o', 2, [1, 2]]]);
    // Valid outliers 12 (row 0) and 15 (row 1) are still drawn and read in the table.
    expect(marksOf(badRun, 'points', 0)[0]!.xy.length).toBe(4);
    expect(badRun.reader.table!.row(0)!.at(-1)).toBe('12');
    expect(badRun.reader.table!.row(1)!.at(-1)).toBe('15');
    expect(badRun.reader.table!.row(2)!.at(-1)).toBe('none');

    // validateCartesian reports the same AX103 and AX106 warnings.
    const vDiags = validateCartesian(malformed as never);
    expect(vDiags.some(d => d.code === 'AX103' && d.field === 'o' && d.count === 2)).toBe(true);
    expect(vDiags.some(d => d.code === 'AX106' && d.field === 'o' && d.count === 2)).toBe(true);
  });

  it('accepts object-backed ArrayLike outlier columns alongside borrowed typed-array peer columns and rejects invalid column shapes', () => {
    const x = new Float64Array([1, 2]);
    const mn = new Float64Array([1, 1]);
    const q1 = new Float64Array([2, 2]);
    const md = new Float64Array([3, 3]);
    const q3 = new Float64Array([4, 4]);
    const mx = new Float64Array([5, 5]);
    const outlierCol: ArrayLike<ArrayLike<number>> = { 0: new Float64Array([12]), 1: [15], length: 2 };
    const spec = {
      title: 'ArrayLike outliers',
      data: { columns: { x, mn, q1, md, q3, mx, o: outlierCol } },
      x: 'x', axes: { v: { position: 'left' } },
      layers: [{ type: 'boxplot', min: 'mn', q1: 'q1', median: 'md', q3: 'q3', max: 'mx', outliers: 'o', yAxis: 'v', label: 'Box' }],
    };
    const run = n5run(spec);
    expect(run.diagnostics.filter(d => d.level !== 'hint')).toEqual([]);
    expect(validateCartesian(spec as never).filter(d => d.level !== 'hint')).toEqual([]);
    // Peer numeric columns remain borrowed without copying.
    expect(run.frame.series.find(s => s.field === 'q1')!.y).toBe(q1);
    expect(run.frame.series.find(s => s.field === 'md')!.y).toBe(md);
    // Both outliers render as points and appear in the accessible table.
    expect(marksOf(run, 'points', 0)[0]!.xy.length).toBe(4);
    expect(run.reader.table!.row(0)!.at(-1)).toBe('12');
    expect(run.reader.table!.row(1)!.at(-1)).toBe('15');

    // Invalid column shapes still emit AX106: missing length, negative, non-integer, out-of-range, non-object.
    for (const badCol of [{ a: 1 }, { length: -1 }, { length: 1.5 }, { length: 0x80000000 }, 'not-a-col', new DataView(new ArrayBuffer(8))]) {
      const badDiags = validateCartesian({
        ...spec,
        data: { columns: { x, mn, q1, md, q3, mx, o: badCol } },
      } as never);
      expect(badDiags.some(d => d.code === 'AX106' && d.field === 'o')).toBe(true);
    }
  });
});
