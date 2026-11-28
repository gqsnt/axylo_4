/**
 * N9a repair (review sol-6.2-medium__20261127T202902Z, findings 4–5): array-like payloads, omission reporting on the
 * right field and rows, n / bandwidth checks, explicit undefined fields, the layer signature, and picking and
 * anchoring on what the plot actually shows.
 *
 * Geometry (violin.ts): a violin's half width at grid value k is 1.5 box half widths × density[k] / (the layer's
 * largest density); the box half width is 0.3 × the smallest slot spacing, held to [3, 24] px.
 */
import { describe, expect, it } from 'vitest';
import { readViolin } from '../../src/cartesian/violin';
import { boxHalfWidth, type OptionIssue } from '../../src/cartesian/boxplot';
import type { AreaMark, Lookup } from '../../src/core/contracts';
import { readerDisclosure } from '../../src/diagnostics/collector';
import { position } from '../../src/scene/geometry';
import { marksOf, n5run, plotOf, xPixel, yScaleOf, type N5Run } from './n5-pipeline';

type Row = Record<string, unknown>;
const five = (lo: number, hi: number) => {
  const d = hi - lo;
  return { min: lo, q1: lo + d / 4, median: lo + d / 2, q3: lo + (3 * d) / 4, max: hi };
};
const halfOf = (run: N5Run) => {
  const p = plotOf(run.layout).projection;
  if (p.kind === 'ring') throw new Error('ring');
  return 1.5 * boxHalfWidth(p, run.view.frame.x.values, run.view.visibleSlots);
};
const nonHint = (run: N5Run) => run.diagnostics.filter(d => d.level !== 'hint');
const primaryAt = (run: N5Run, x: number, y: number) => {
  const target = run.lookup.pick(x, y);
  const ref = target && run.lookup.primary(target);
  return ref && ref.kind === 'aligned' ? [ref.seriesKey, ref.x] as const : null;
};
const candidatesOf = (lookup: Lookup) => (lookup as Lookup & { lastPickCandidates?: number }).lastPickCandidates ?? -1;

describe('N9a repair: payload types and diagnostics (finding 4)', () => {
  it('honours plain array-like columns and cells', () => {
    const like = <T>(...items: T[]): ArrayLike<T> => Object.assign(Object.create(null) as object, { length: items.length }, { ...items }) as ArrayLike<T>;
    const columns = {
      x: ['A', 'B'], min: [1, 1], q1: [1.5, 1.5], median: [2, 2], q3: [2.5, 2.5], max: [3, 3],
      grid: like(like(1, 2, 3), [1, 2, 3]),
      density: like(Float64Array.of(0, 1, 0), like(0, 2, 0)),
    };
    const run = n5run({ data: { columns }, x: 'x', axes: { v: { position: 'left' } }, layers: [{ type: 'violin', yAxis: 'v' }] });
    expect(nonHint(run)).toEqual([]);
    const [area] = marksOf(run, 'area', 0) as AreaMark[];
    expect(Array.from(area!.runs)).toEqual([0, 3, 0, 3, 3, 3, 3, 3]);
    // Shared width scale: B's peak (2) is the layer's, so A's widest is half of it.
    const half = halfOf(run), px = xPixel(run.layout, run.view, 0);
    expect(area!.upper[2]! - px).toBeCloseTo(half / 2, 3);
  });

  it('reports a payload absent altogether on both fields, for every source row, as an omission the reader counts', () => {
    for (const data of [
      { columns: { x: ['A', 'B', 'C'], ...Object.fromEntries(Object.entries(five(1, 3)).map(([k, v]) => [k, [v, v, v]])) } },
      ['A', 'B', 'C'].map(x => ({ x, ...five(1, 3) })),
    ]) {
      const run = n5run({ data, x: 'x', axes: { v: { position: 'left' } }, layers: [{ type: 'violin', yAxis: 'v' }] });
      const found = run.diagnostics.filter(d => d.code === 'AX102');
      expect(found.map(d => [d.field, d.rows, d.effect])).toEqual([['grid', [0, 1, 2], 'omitted'], ['density', [0, 1, 2], 'omitted']]);
      expect(readerDisclosure(run.diagnostics).omitted).toBe(6);
      expect(marksOf(run, 'area', 0)).toEqual([]);
    }
  });

  it('attributes a malformed cell to its own field and source row, with the omission effect', () => {
    const rows: Row[] = [
      { x: 'A', ...five(1, 3), grid: [1, 2, 3], density: [0, 1, 0] },
      { x: 'B', ...five(1, 3), grid: [1, 'two', 3], density: [0, 1, 0] },
      { x: 'C', ...five(1, 3), grid: [1, 2, 3], density: [0, Infinity, 0] },
      { x: 'D', ...five(1, 3), grid: 'grid', density: [0, 1, 0] },
      { x: 'E', ...five(1, 3), grid: [1, 2, 3] },
    ];
    const run = n5run({ data: rows, x: 'x', axes: { v: { position: 'left' } }, layers: [{ type: 'violin', yAxis: 'v', grid: 'grid', density: 'density' }] });
    const got = nonHint(run).map(d => [d.code, d.field, d.rows, d.effect]);
    expect(got).toEqual(expect.arrayContaining([
      ['AX106', 'grid', [1, 3], 'omitted'], ['AX103', 'density', [2], 'omitted'], ['AX102', 'density', [4], 'omitted'],
    ]));
    expect(got.length).toBe(3);
    const [area] = marksOf(run, 'area', 0) as AreaMark[];
    expect(Array.from(area!.runs)).toEqual([0, 3, 0, 3]);
  });

  it('checks n (a positive integer) and bandwidth (finite, > 0) when given; absent cells and an empty group stay silent', () => {
    const rows: Row[] = [
      { x: 'A', ...five(1, 3), grid: [1, 2, 3], density: [0, 1, 0], n: -2.5, bandwidth: 0 },
      { x: 'B', ...five(1, 3), grid: [1, 2, 3], density: [0, 1, 0], n: 3, bandwidth: 0.5 },
      { x: 'C', ...five(1, 3), grid: [1, 2, 3], density: [0, 1, 0], n: '4', bandwidth: Infinity },
      { x: 'D', ...five(1, 3), grid: [1, 2, 3], density: [0, 1, 0], n: null },
      { x: 'E', min: null, q1: null, median: null, q3: null, max: null, grid: [], density: [], n: 0, bandwidth: NaN },
      { x: 'F', ...five(1, 3), grid: [1, 2, 3], density: [0, 1, 0], n: 0, bandwidth: NaN },
    ];
    const run = n5run({ data: rows, x: 'x', axes: { v: { position: 'left' } }, layers: [{ type: 'violin', yAxis: 'v' }] });
    const got = nonHint(run).map(d => [d.code, d.field, d.rows, d.effect]);
    expect(got).toEqual(expect.arrayContaining([
      ['AX106', 'n', [0, 2, 5], 'omitted'], ['AX106', 'bandwidth', [0], 'omitted'], ['AX103', 'bandwidth', [2, 5], 'omitted'],
    ]));
    expect(got.length, JSON.stringify(got)).toBe(3);
    const table = run.reader.table!;
    const header = table.headers;
    const nAt = header.findIndex(h => /\bn$/.test(h)), bwAt = header.findIndex(h => /bandwidth/.test(h));
    expect(table.row(1)![nAt]).toBe('3');
    expect(table.row(1)![bwAt]).toBe('0.5');
    const missing = table.row(3)![nAt];
    for (const r of [0, 2]) expect(table.row(r)![nAt]).toBe(missing);
    expect(table.row(0)![bwAt]).toBe(missing);
  });

  it('applies the default field names when a field is given as undefined', () => {
    const rows: Row[] = [{ x: 'A', ...five(1, 3), grid: [1, 2, 3], density: [0, 1, 0] }];
    const plain = n5run({ data: rows, x: 'x', axes: { v: { position: 'left' } }, layers: [{ type: 'violin', yAxis: 'v' }] });
    const given = n5run({
      data: rows, x: 'x', axes: { v: { position: 'left' } },
      layers: [{ type: 'violin', yAxis: 'v', min: undefined, q1: undefined, median: undefined, q3: undefined, max: undefined, grid: undefined, density: undefined, n: undefined, bandwidth: undefined }],
    });
    expect(nonHint(given)).toEqual([]);
    expect(Array.from((marksOf(given, 'area', 0)[0] as AreaMark).upper)).toEqual(Array.from((marksOf(plain, 'area', 0)[0] as AreaMark).upper));
  });

  it('keeps the layer signature apart for field names that contain separators', () => {
    const issues: OptionIssue[] = [];
    const a = readViolin([], 'x', ['a,b', 'c', 'n', 'bandwidth'], true, issues);
    const b = readViolin([], 'x', ['a', 'b,c', 'n', 'bandwidth'], true, issues);
    const c = readViolin([], 'x', ['a', 'b,c', 'n', 'bandwidth:true'], false, issues);
    const d = readViolin([], 'x', ['a', 'b,c', 'n', 'bandwidth'], true, issues);
    expect(new Set([a.key, b.key, c.key]).size).toBe(3);
    expect(d.key).toBe(b.key);
  });
});

describe('N9a repair: pick and anchor follow the shown geometry (finding 5)', () => {
  it('an outline past a pinned y domain neither takes the pick nor anchors at the plot edge', () => {
    // A scatter layer first: a miss falls back to the first visible series, so a violin hit is told apart.
    const rows: Row[] = [{ x: 'A', ...five(5.01, 5.02), grid: [5.01, 5.015, 5.02], density: [0.5, 1, 0.5], mark: NaN }];
    for (const inner of ['box', 'none'] as const) {
      const run = n5run({
        data: rows, x: 'x', axes: { v: { position: 'left', domain: [0, 5] } },
        layers: [{ type: 'scatter', y: 'mark', yAxis: 'v' }, { type: 'violin', yAxis: 'v', inner }],
      });
      const key = run.view.frame.series[1]!.key;
      expect(primaryAt(run, xPixel(run.layout, run.view, 0), position(yScaleOf(run.layout, 0), 5.015))).toBeNull();
      const y = yScaleOf(run.layout, 0), px = xPixel(run.layout, run.view, 0);
      expect(position(y, 5)).toBeCloseTo(plotOf(run.layout).plot.y, 6);
      expect(primaryAt(run, px, position(y, 4.99))?.[0]).toBe(run.view.frame.series[0]!.key);
      const anchor = run.lookup.anchor({ kind: 'aligned', seriesKey: key, x: 0 });
      // Nothing of it is shown: no box anchor (a point fallback, if any, is not a 1 px box at the edge).
      expect(anchor === null || !(anchor.height === 1 && anchor.y === plotOf(run.layout).plot.y)).toBe(true);
    }
  });

  it('an outline crossing the pinned top is picked and anchored only where it is shown', () => {
    const rows: Row[] = [{ x: 'A', ...five(3, 4), grid: [3, 4.5, 6], density: [1, 1, 1] }];
    const run = n5run({ data: rows, x: 'x', axes: { v: { position: 'left', domain: [0, 5] } }, layers: [{ type: 'violin', yAxis: 'v', inner: 'none' }] });
    const key = run.view.frame.series[0]!.key, plot = plotOf(run.layout).plot;
    const y = yScaleOf(run.layout, 0), px = xPixel(run.layout, run.view, 0), half = halfOf(run);
    expect(primaryAt(run, px, position(y, 4.9))?.[0]).toBe(key);
    const anchor = run.lookup.anchor({ kind: 'aligned', seriesKey: key, x: 0 })!;
    expect(anchor.y).toBeCloseTo(plot.y, 6);
    expect(anchor.y + anchor.height).toBeCloseTo(position(y, 3), 3);
    expect(anchor.width).toBeCloseTo(2 * half, 3);
  });

  it('finds an overlapping violin of an irregular x three slots away instead of the scatter fallback', () => {
    // x = 0, 50, 50.1, 50.2, 100 at 640 px: slots 1–3 are ~0.6 px apart, so the box half width is held at 3 px and
    // each violin is up to 4.5 px wide each side; the one at 50.2 reaches past slot 1's left side (the review's
    // [0, 0.1, 0.2, 100] case, moved off the plot's left edge so the pointer stays inside the plot).
    const rows: Row[] = [0, 50, 50.1, 50.2, 100].map((x, i) => i === 3
      ? { x, ...five(1, 3), grid: [0, 1, 2, 3, 4], density: [0, 1, 2, 1, 0], mark: NaN }
      : { x, ...five(11, 19), grid: [10, 15, 20], density: [0.01, 0.01, 0.01], mark: i === 4 ? 30 : NaN });
    const run = n5run({
      data: rows, x: 'x', axes: { v: { position: 'left' } },
      layers: [{ type: 'scatter', y: 'mark', yAxis: 'v', label: 'Marker' }, { type: 'violin', yAxis: 'v', label: 'Spread', inner: 'none' }],
    }, { width: 640 });
    const vKey = run.view.frame.series[1]!.key, y = yScaleOf(run.layout, 0);
    // Numeric x is laid out on a regular slot grid (step 0.1 here, ~0.58 px), so the rows sit ~10 empty slots apart.
    const slotOf = (x: number) => run.lookup.slot({ kind: 'aligned', seriesKey: vKey, x });
    const half = halfOf(run), at50 = xPixel(run.layout, run.view, slotOf(50)), at502 = xPixel(run.layout, run.view, slotOf(50.2));
    expect(half).toBeCloseTo(4.5, 9);
    const qx = at502 - 0.8 * half;
    // Left of x = 50's slot and several slots from x = 50.2's, yet inside the outline of x = 50.2 at its widest.
    expect(qx).toBeLessThan(at50);
    expect(at502 - qx).toBeGreaterThan(3 * (at502 - xPixel(run.layout, run.view, slotOf(50.2) - 1)));
    expect(primaryAt(run, qx, position(y, 2))).toEqual([vKey, 50.2]);
  });

  it('visits only the violins near the pointer, not every slot', () => {
    const rowsOf = (count: number): Row[] => Array.from({ length: count }, (_, x) => ({ x, ...five(1, 3), grid: [0, 2, 4], density: [0, 1, 0] }));
    for (const count of [40, 4000]) {
      const run = n5run({ data: rowsOf(count), x: 'x', axes: { v: { position: 'left' } }, layers: [{ type: 'violin', yAxis: 'v', inner: 'none' }] });
      const y = yScaleOf(run.layout, 0), slot = Math.floor(count / 2), px = xPixel(run.layout, run.view, slot);
      expect(primaryAt(run, px, position(y, 2))?.[0]).toBe(run.view.frame.series[0]!.key);
      // Slots within (4.5 + 3) px of the pointer at ≥ 0.22 px spacing: at most ~70 of 4000.
      expect(candidatesOf(run.lookup)).toBeGreaterThan(0);
      expect(candidatesOf(run.lookup)).toBeLessThan(count === 40 ? 4 : 80);
    }
  });
});
