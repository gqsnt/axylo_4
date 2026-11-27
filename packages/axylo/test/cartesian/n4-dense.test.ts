/**
 * N4 dense drawing of `axylo/cartesian` lines and areas (spec F5, A5; RFC C4.1 §4.4, §8 hot-path invariant).
 *
 * Expected values come from the spec and the fixtures: F5's guarantee per device-pixel column and contiguous run
 * (first, last, minimum, maximum kept; breaks kept; no-row slots bridged outside stacks), the four-samples-per-
 * column threshold under which every sample is drawn, and A5's marker on the last visible point. Column
 * membership is computed by the test from the committed projection (`floor(pixel × dpr)`), independently of the
 * implementation's loop.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { SLOT_GAP, SLOT_NO_ROW, SLOT_VALUE, type PathMark, type PointMark } from '../../src/core/contracts';
import { columnLimit, keep } from '../../src/cartesian/dense';
import { axisScaleOf } from '../../src/cartesian/scale-ref';
import { liftCount, rng, run, vertexCount } from './n4-pipeline';

const N = 100_000;

function dense(points = N, seed = 1) {
  const r = rng(seed);
  const x = new Float64Array(points);
  const y = new Float64Array(points);
  let v = 500;
  for (let i = 0; i < points; i++) {
    x[i] = i;
    v += (r() - 0.5) * 4;
    y[i] = Math.round(v * 100) / 100;
  }
  return { x, y };
}

const paths = (scene: { marks: readonly { type: string }[] }, series: number) =>
  scene.marks.filter((m): m is PathMark => m.type === 'path' && (m as PathMark).series === series);
const pointsOf = (scene: { marks: readonly { type: string }[] }, series: number) =>
  scene.marks.filter((m): m is PointMark => m.type === 'points' && (m as PointMark).series === series);

/** Oracle for F5 on one column of values: what each (column, run) must keep, from the definition alone. */
function f5Required(y: ArrayLike<number>, slot: ArrayLike<number> | null, start: number, end: number,
  pixel: (i: number) => number, ratio: number, bridge: boolean) {
  const required: number[][] = [];
  let run: number[] = [];
  const close = () => { if (run.length) required.push(run); run = []; };
  let column = NaN;
  let group: number[] = [];
  const closeGroup = () => {
    if (!group.length) return;
    let min = group[0]!, max = group[0]!;
    for (const i of group) {
      if (y[i]! < y[min]!) min = i;
      if (y[i]! > y[max]!) max = i;
    }
    run.push(group[0]!, group[group.length - 1]!, min, max);
    group = [];
  };
  for (let i = start; i < end; i++) {
    const st = slot ? slot[i]! : SLOT_VALUE;
    if (st !== SLOT_VALUE) {
      if (bridge && st === SLOT_NO_ROW) continue;
      closeGroup(); close(); column = NaN;
      continue;
    }
    const c = Math.floor(pixel(i) * ratio);
    if (c !== column) { closeGroup(); column = c; }
    group.push(i);
  }
  closeGroup(); close();
  return required;
}

describe('N4 F5 dense line drawing', () => {
  it('draws a continuous 100,000-point linear line at 960 px with O(plot width × dpr) vertices that keep every column extreme', () => {
    const { x, y } = dense();
    // One outlier in the middle: F5's "one outlier in 1,000,000" in this fixture's size.
    y[54_321] = 10_000;
    const res = run({ title: 'Dense', data: { columns: { x, v: y } }, x: 'x', axes: { v: { position: 'left' } }, layers: [{ type: 'line', y: 'v', yAxis: 'v' }] }, { width: 960 });
    expect(res.layout.kind).toBe('plot');
    if (res.layout.kind !== 'plot') return;
    const [path] = paths(res.scene, 0);
    expect(path).toBeDefined();
    const vertices = vertexCount(path!.xy);
    const limit = columnLimit(res.layout.plot, 1);
    // At most four kept samples per device-pixel column of the plot (plus the overscan neighbours' columns).
    expect(vertices).toBeLessThanOrEqual(limit + 8);
    expect(vertices).toBeLessThan(4_000);
    expect(liftCount(path!.xy)).toBe(0);
    // The outlier is drawn at its own pixel.
    const yScale = axisScaleOf(res.layout.projection, 0);
    const spike = Math.fround(yScale.map(10_000));
    let found = false;
    for (let i = 1; i < path!.xy.length; i += 2) if (path!.xy[i] === spike) found = true;
    expect(found).toBe(true);
  });

  it('keeps, for every device-pixel column and contiguous run, the first, last, minimum and maximum sample (dpr 1 and 2, several zooms)', () => {
    const { x, y } = dense(N, 7);
    for (const dpr of [1, 2]) {
      for (const zoom of [null, [10_000, 60_000], [20_000, 20_900]] as const) {
        const res = run({ title: 'Dense', data: { columns: { x, v: y } }, x: 'x', axes: { v: { position: 'left' } }, layers: [{ type: 'line', y: 'v', yAxis: 'v' }] }, { width: 960, dpr, zoom });
        if (res.layout.kind !== 'plot') throw new Error('expected a plot');
        const projection = res.layout.projection;
        if (projection.kind !== 'xy') throw new Error('expected an xy projection');
        const xScale = projection.x;
        const pixel = (i: number) => xScale.map(x[i]!);
        const range = res.view.drawSlots[0]!;
        const limit = columnLimit(res.layout.plot, dpr);
        const kept = keep(y, null, range, pixel, dpr, limit, true);
        const keptSet = new Set(kept.indexes);
        if (range.end - range.start <= limit) {
          // Sparse or zoomed in: every sample is drawn, exactly.
          expect(kept.indexes.length).toBe(range.end - range.start);
        } else {
          for (const runReq of f5Required(y, null, range.start, range.end, pixel, dpr, true)) {
            for (const i of runReq) expect(keptSet.has(i)).toBe(true);
          }
          expect(kept.indexes.length).toBeLessThanOrEqual(limit + 8);
        }
        // The scene draws exactly the kept samples.
        expect(vertexCount(paths(res.scene, 0)[0]!.xy)).toBe(kept.indexes.length);
      }
    }
  });

  it('on a 100,000-point log axis, omits nonpositive values before projection, keeps every break, and stays bounded', () => {
    const { x, y } = dense(N, 3);
    for (let i = 0; i < N; i++) y[i] = Math.abs(y[i]!) + 1;
    // Nonpositive stretches: each is a break in the line (RFC §4.4), and none is ever projected.
    const holes = [1_000, 25_000, 50_000, 75_000];
    for (const h of holes) { y[h] = 0; y[h + 1] = -5; }
    const res = run({
      title: 'Log', data: { columns: { x, v: y } }, x: 'x',
      axes: { v: { position: 'left', scale: 'log' } }, layers: [{ type: 'line', y: 'v', yAxis: 'v' }],
    }, { width: 960 });
    if (res.layout.kind !== 'plot') throw new Error('expected a plot');
    expect(res.diagnostics.map(d => d.code)).toContain('AX171');
    const path = paths(res.scene, 0)[0]!;
    expect(liftCount(path.xy)).toBe(holes.length);
    for (let i = 0; i < path.xy.length; i++) if (!Number.isNaN(path.xy[i]!)) expect(Number.isFinite(path.xy[i]!)).toBe(true);
    expect(vertexCount(path.xy)).toBeLessThan(4_000 + 4 * 2 * holes.length);
    // The table still holds the raw nonpositive value.
    const table = res.reader.table!;
    const row = table.row(holes[0]!)!;
    expect(row.join(' ')).toContain('(not plotted — log)');
  });

  it('bridges no-row slots outside stacks, breaks at gaps, and marks isolated values (F2/F5/L5)', () => {
    const rows = [
      { x: 1, v: 10 }, { x: 2, v: 12 }, { x: 3, v: null }, { x: 4, v: 9 }, { x: 5, v: null }, { x: 6, v: 11 }, { x: 7, v: 13 },
    ];
    const res = run({ title: 'Gaps', data: rows, x: 'x', axes: { v: { position: 'left' } }, layers: [{ type: 'line', y: 'v', yAxis: 'v' }] });
    const path = paths(res.scene, 0)[0]!;
    // Runs [1,2] and [6,7] are drawn with one pen lift between them; 4 is isolated.
    expect(vertexCount(path.xy)).toBe(4);
    expect(liftCount(path.xy)).toBe(1);
    const markers = pointsOf(res.scene, 0)[0]!;
    // Isolated value at x = 4 plus the A5 marker at the last visible value (x = 7).
    expect(markers.xy.length / 2).toBe(2);
  });

  it('puts the A5 marker on the last visible value, not on the overscan neighbour nor past trailing gaps', () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ x: i, v: i >= 26 && i <= 30 ? null : 100 + i }));
    const res = run({ title: 'A5', data: rows, x: 'x', axes: { v: { position: 'left' } }, layers: [{ type: 'line', y: 'v', yAxis: 'v' }] }, { zoom: [5, 30] });
    if (res.layout.kind !== 'plot') throw new Error('expected a plot');
    const projection = res.layout.projection;
        if (projection.kind !== 'xy') throw new Error('expected an xy projection');
        const xScale = projection.x;
    const markers = pointsOf(res.scene, 0)[0]!;
    const xs = Array.from({ length: markers.xy.length / 2 }, (_, k) => markers.xy[2 * k]!);
    // The last value inside [5, 30] is x = 25 (26–30 are null); x = 31 is outside the window.
    expect(xs).toContain(Math.fround(xScale.map(25)));
    expect(xs).not.toContain(Math.fround(xScale.map(31)));
  });

  it('keeps sparse data exact: a 120-point line draws every sample', () => {
    const { x, y } = dense(120, 5);
    const res = run({ title: 'Sparse', data: { columns: { x, v: y } }, x: 'x', axes: { v: { position: 'left' } }, layers: [{ type: 'line', y: 'v', yAxis: 'v' }] });
    expect(vertexCount(paths(res.scene, 0)[0]!.xy)).toBe(120);
  });
});

describe('N4 F5 property: the kept samples of any column of values', () => {
  it('for any values, states, width and dpr: every (column, run) keeps first/last/min/max, nothing else beyond four, breaks kept, singles isolated', () => {
    const states = fc.constantFrom(SLOT_VALUE, SLOT_VALUE, SLOT_VALUE, SLOT_VALUE, SLOT_GAP, SLOT_NO_ROW);
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 2500 }), fc.integer({ min: 4, max: 300 }), fc.constantFrom(1, 1.5, 2),
      fc.integer({ min: 0, max: 2 ** 31 - 1 }), fc.array(states, { minLength: 1, maxLength: 64 }), fc.boolean(),
      (n, width, ratio, seed, pattern, bridge) => {
        const r = rng(seed);
        const y = new Float64Array(n);
        const slot = new Uint8Array(n);
        for (let i = 0; i < n; i++) {
          // Repeated values exercise ties: the earliest extreme wins.
          y[i] = Math.round(r() * 20);
          slot[i] = pattern[i % pattern.length]!;
          if (slot[i] !== SLOT_VALUE) y[i] = NaN;
        }
        const plot = { x: 10, y: 0, width, height: 100 };
        const pixel = (i: number) => plot.x + (i / Math.max(1, n - 1)) * width;
        const limit = columnLimit(plot, ratio);
        const kept = keep(y, slot, { start: 0, end: n }, pixel, ratio, limit, bridge);
        const required = f5Required(y, slot, 0, n, pixel, ratio, bridge);
        const keptSet = new Set(kept.indexes);
        // Kept samples are values, in source order.
        for (let j = 0; j < kept.indexes.length; j++) {
          expect(slot[kept.indexes[j]!]).toBe(SLOT_VALUE);
          if (j > 0) expect(kept.indexes[j]!).toBeGreaterThan(kept.indexes[j - 1]!);
        }
        // Runs: one per contiguous run of two or more values; a run of one value is an isolated point.
        const multi = required.filter(run => new Set(run).size > 1);
        const singles = required.filter(run => new Set(run).size === 1).map(run => run[0]!);
        expect(kept.ends.length).toBe(multi.length);
        expect(Array.from(kept.isolated)).toEqual(singles);
        for (const s of singles) expect(keptSet.has(s)).toBe(false);
        const values = required.reduce((sum, run) => sum + run.length / 4, 0);
        if (n <= limit) {
          // Below the threshold every value of a multi-sample run is drawn.
          let expected = 0;
          for (let i = 0; i < n; i++) if (slot[i] === SLOT_VALUE) expected++;
          expect(kept.indexes.length + kept.isolated.length).toBe(expected);
        } else {
          for (const run of multi) for (const i of run) expect(keptSet.has(i)).toBe(true);
          // Never more than four samples per (column, run).
          expect(kept.indexes.length).toBeLessThanOrEqual(4 * values);
        }
      },
    ), { numRuns: 200 });
  });
});

describe('N4 F5 areas', () => {
  it('simplifies a 100,000-point unstacked area like its line, over the zero baseline', () => {
    const { x, y } = dense(N, 11);
    for (let i = 0; i < N; i++) y[i] = Math.abs(y[i]!);
    const res = run({ title: 'Area', data: { columns: { x, v: y } }, x: 'x', axes: { v: { position: 'left' } }, layers: [{ type: 'area', y: 'v', yAxis: 'v' }] }, { width: 960 });
    if (res.layout.kind !== 'plot') throw new Error('expected a plot');
    const area = res.scene.marks.find(m => m.type === 'area')!;
    if (area.type !== 'area') throw new Error('expected an area');
    expect(area.upper.length / 2).toBeLessThan(4_000);
    const zero = Math.fround(axisScaleOf(res.layout.projection, 0).map(0));
    for (let i = 1; i < area.lower.length; i += 2) expect(area.lower[i]).toBe(zero);
    expect(Array.from(area.runs)).toEqual([0, area.upper.length / 2, 0, area.upper.length / 2]);
  });

  it('simplifies 2 × 100,000 stacked areas on common vertices kept on every cumulative boundary', () => {
    const a = dense(N, 13);
    const b = dense(N, 17);
    for (let i = 0; i < N; i++) { a.y[i] = Math.abs(a.y[i]!); b.y[i] = Math.abs(b.y[i]!); }
    const res = run({
      title: 'Stacked', data: { columns: { x: a.x, a: a.y, b: b.y } }, x: 'x',
      axes: { v: { position: 'left' } }, layers: [{ type: 'area', y: ['a', 'b'], yAxis: 'v', stacked: true }],
    }, { width: 960 });
    const areas = res.scene.marks.filter(m => m.type === 'area');
    expect(areas.length).toBe(2);
    const [first, second] = areas as Extract<(typeof areas)[number], { type: 'area' }>[];
    // Shared edge: the second band's lower boundary is the first band's upper boundary, vertex for vertex.
    expect(Array.from(second!.lower)).toEqual(Array.from(first!.upper));
    // Common x for every boundary, bounded by the columns of the plot times the boundaries.
    for (let i = 0; i < first!.upper.length; i += 2) expect(second!.upper[i]).toBe(first!.upper[i]);
    expect(first!.upper.length / 2).toBeLessThan(2 * 4_000);
  });
});
