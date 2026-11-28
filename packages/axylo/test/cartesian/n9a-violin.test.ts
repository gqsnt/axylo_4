/**
 * N9a: the native `violin` layer of `axylo/cartesian`, fed by `violinData()` of `axylo/stats`.
 * Hand-computed summaries (R-7) of the groups below:
 *   A = 1, 2, 3, 4, 5:        n 5, min 1, Q1 2, median 3, Q3 4, max 5; Silverman h = 0.9 · (2 / 1.34) · 5^(-1/5)
 *   B = 2, 4, 4, 6, 10, 12:   n 6, min 2, Q1 4, median 5, Q3 9, max 12
 *   C = 7, 7, 7:              n 3, a constant sample: h = 0.9 · 7 · 3^(-1/5) (fallback to |x|)
 * Layer geometry (documented in cartesian.ts / violin.ts): each violin is mirrored about its slot, its half width
 * at grid value k is 1.5 box half widths × density[k] / (the layer's largest density); the inner box spans Q1–Q3.
 */
import { describe, expect, it } from 'vitest';
import { violinData } from '../../src/stats';
import { validateCartesian } from '../../src/cartesian';
import { createCartesianResolver, parseCartesianInput } from '../../src/cartesian/options';
import { normalizeCartesian } from '../../src/cartesian/normalize';
import { buildCartesianView } from '../../src/cartesian/view';
import { createCartesianLayoutStage } from '../../src/cartesian/layout';
import { buildCartesianScene } from '../../src/cartesian/scene';
import { createCartesianLookup } from '../../src/cartesian/lookup';
import { createCartesianReader } from '../../src/cartesian/reader';
import { createCartesianOverlay } from '../../src/cartesian/overlay';
import { createMarkSwatch } from '../../src/cartesian/mark-swatch';
import { boxHalfWidth } from '../../src/cartesian/boxplot';
import type { CartesianStateRef } from '../../src/cartesian/meta';
import type { Composition } from '../../src/core/composition';
import type { AreaMark } from '../../src/core/contracts';
import { controllerFor } from '../../src/core/controller';
import { strictViolations } from '../../src/core/delivery';
import { createTimeReadout } from '../../src/format/time';
import { areaData, pathData, svgArea, svgBand, svgPath, svgPoints, svgRects, svgRule } from '../../src/render/svg';
import { position, token } from '../../src/scene/geometry';
import { record } from '../finance/host';
import { marksOf, n5run, plotOf, xPixel, yScaleOf, type N5Run } from './n5-pipeline';

const samples: Record<string, number[]> = { A: [1, 2, 3, 4, 5], B: [2, 4, 4, 6, 10, 12], C: [7, 7, 7] };
const rows = Object.entries(samples).flatMap(([g, values]) => values.map(v => ({ g, v })));
const result = violinData(rows, { group: 'g', value: 'v' });
// The box layer of the mixed chart needs its own fields: each source field binds to one layer.
const c = result.data.columns;
const columns = { ...c, mark: Float64Array.of(3, NaN, 7), bmin: c.min, bq1: c.q1, bmed: c.median, bq3: c.q3, bmax: c.max };
const base = { title: 'Violins', data: { columns }, x: 'x', axes: { v: { position: 'left' } } };
const lone = { ...base, layers: [{ type: 'violin', yAxis: 'v', label: 'Spread' }] };
const mixed = {
  ...base,
  layers: [
    { type: 'scatter', y: 'mark', yAxis: 'v', label: 'Marker' },
    { type: 'violin', yAxis: 'v', label: 'Spread' },
    { type: 'boxplot', min: 'bmin', q1: 'bq1', median: 'bmed', q3: 'bq3', max: 'bmax', yAxis: 'v', label: 'Box' },
  ],
};
const nonHint = (run: N5Run) => run.diagnostics.filter(d => d.level !== 'hint').map(d => `${d.code}:${d.field ?? ''}`);
const halfOf = (run: N5Run) => {
  const p = plotOf(run.layout).projection;
  if (p.kind === 'ring') throw new Error('ring');
  return 1.5 * boxHalfWidth(p, run.view.frame.x.values, run.view.visibleSlots);
};

describe('N9a violin layer: payload and published series', () => {
  it('reads violinData() as it is: one published series, five borrowed carriers, no diagnostics', () => {
    expect([...result.data.columns.median]).toEqual([3, 5, 7]);
    expect([...result.data.columns.q1]).toEqual([2, 4, 7]);
    expect([...result.data.columns.q3]).toEqual([4, 9, 7]);
    const run = n5run(lone);
    expect(run.view.frame.series.map(s => s.label)).toEqual(['Spread']);
    expect(run.frame.series.find(s => s.field === 'q1')!.y).toBe(result.data.columns.q1);
    expect(nonHint(run)).toEqual([]);
    expect(validateCartesian(lone as never).filter(d => d.level !== 'hint')).toEqual([]);
  });

  it('draws one mirrored outline per group from the payload grid, sharing one width scale', () => {
    const run = n5run(lone);
    const y = yScaleOf(run.layout, 0);
    const [area] = marksOf(run, 'area', 0) as AreaMark[];
    expect(area).toBeDefined();
    expect(Array.from(area!.runs)).toEqual([0, 128, 0, 128, 128, 128, 128, 128, 256, 128, 256, 128]);
    const half = halfOf(run);
    const peak = Math.max(...result.data.columns.density.flatMap(d => [...d]));
    // As SVG: three closed polygons, and an outline stroke of three closed subpaths (NaN breaks between them).
    expect(areaData(area!).match(/Z/g)).toHaveLength(3);
    const outline = marksOf(run, 'path', 0).find(p => p.xy.length > 100)!;
    expect(pathData(outline.xy).match(/M/g)).toHaveLength(3);
    for (let g = 0; g < 3; g++) {
      const px = xPixel(run.layout, run.view, g), grid = result.data.columns.grid[g]!, density = result.data.columns.density[g]!;
      for (let k = 0; k < 128; k++) {
        const o = 2 * (128 * g + k);
        expect(area!.upper[o + 1]!).toBeCloseTo(position(y, grid[k]!), 3);
        expect(area!.lower[o + 1]).toBe(area!.upper[o + 1]);
        expect(area!.upper[o]! - px).toBeCloseTo(half * (density[k]! / peak), 3);
        expect(px - area!.lower[o]!).toBeCloseTo(half * (density[k]! / peak), 3);
      }
    }
  });

  it('draws the inner Q1–Q3 box, the min–max line and a background median bar; inner: none drops them', () => {
    const run = n5run(lone);
    const y = yScaleOf(run.layout, 0);
    const [rects] = marksOf(run, 'rects', 0);
    const q1 = [2, 4, 7], q3 = [4, 9, 7], median = [3, 5, 7], lo = [1, 2, 7], hi = [5, 12, 7];
    for (let g = 0; g < 3; g++) {
      const px = xPixel(run.layout, run.view, g), xywh = rects!.xywh;
      expect(xywh[4 * g]! + xywh[4 * g + 2]! / 2).toBeCloseTo(px, 3);
      expect(xywh[4 * g + 1]!).toBeCloseTo(position(y, q3[g]!), 3);
      expect(xywh[4 * g + 3]!).toBeCloseTo(Math.max(1, position(y, q1[g]!) - position(y, q3[g]!)), 3);
    }
    const paths = marksOf(run, 'path', 0);
    const whisker = paths.find(p => p.strokeWidth === 1.5 && p.xy.length === 18)!;
    const medianBar = paths.find(p => p.strokeWidth === 2)!;
    expect(medianBar.stroke).toEqual(token('background'));
    for (let g = 0; g < 3; g++) {
      expect(whisker.xy[6 * g + 1]!).toBeCloseTo(position(y, hi[g]!), 3);
      expect(whisker.xy[6 * g + 3]!).toBeCloseTo(position(y, lo[g]!), 3);
      expect(medianBar.xy[6 * g + 1]!).toBeCloseTo(position(y, median[g]!), 3);
    }
    const bare = n5run({ ...lone, layers: [{ type: 'violin', yAxis: 'v', inner: 'none' }] });
    expect(marksOf(bare, 'rects')).toEqual([]);
    expect(marksOf(bare, 'area')).toHaveLength(1);
  });

  it('draws and fits only the zoomed window', () => {
    const numeric = violinData(rows.map(r => ({ g: { A: 1, B: 2, C: 3 }[r.g]!, v: r.v })), { group: 'g', value: 'v' });
    const run = n5run({ ...lone, data: numeric.data }, { zoom: [1.5, 3] });
    expect(run.view.visibleSlots).toEqual({ start: 1, end: 3 });
    const [area] = marksOf(run, 'area', 0) as AreaMark[];
    expect(Array.from(area!.runs)).toEqual([0, 128, 0, 128, 128, 128, 128, 128]);
    const shown = numeric.data.columns.grid.slice(1).flatMap(g => [g[0]!, g[g.length - 1]!]);
    const [d0, d1] = run.view.yDomains![0]!;
    expect(d0).toBeLessThanOrEqual(Math.min(...shown));
    expect(d1).toBeGreaterThanOrEqual(Math.max(...shown));
    expect(run.reader.table!.rowCount).toBe(2);
  });

  it("fits its axis to the drawn grid tails, and a hidden violin's tails no longer widen it", () => {
    const all = result.data.columns.grid.flatMap(g => [g[0]!, g[g.length - 1]!]);
    const run = n5run(lone);
    const [d0, d1] = run.view.yDomains![0]!;
    expect(d0).toBeLessThanOrEqual(Math.min(...all));
    expect(d1).toBeGreaterThanOrEqual(Math.max(...all));
    const hidden = n5run(mixed, { hidden: [n5run(mixed).view.frame.series[1]!.key] });
    expect(marksOf(hidden, 'area')).toEqual([]);
    expect(hidden.view.yDomains![0]![1]).toBeLessThan(Math.max(...all));
  });
});

describe('N9a violin layer: legend, pointer, keyboard and table', () => {
  it('has its own swatch, and one legend entry even as the only layer', () => {
    const run = n5run(lone);
    expect(run.swatch.key!(0, run.view)).toBe('0:violin');
    expect(run.swatch.legendForOne!(run.view)).toBe(true);
    const box = n5run({ ...base, layers: [mixed.layers[2]!] });
    expect(box.swatch.legendForOne!(box.view)).toBe(false);
    const both = n5run(mixed);
    expect(both.view.frame.series.map(s => s.label)).toEqual(['Marker', 'Spread', 'Box']);
    expect([0, 1, 2].map(i => both.swatch.key!(i, both.view))).toEqual(['0:point', '1:violin', '2:boxplot']);
    expect(nonHint(both)).toEqual([]);
    // Each layer draws its own marks: scatter points (none at B), the violins, and the boxes.
    expect(marksOf(both, 'points', 0)[0]!.xy.length).toBe(4);
    expect(marksOf(both, 'area', 1)).toHaveLength(1);
    expect(marksOf(both, 'rects', 2)[0]!.xywh.length).toBe(12);
    expect(both.reader.table!.headers.slice(1, 3)).toEqual(['Marker', 'Spread median']);
  });

  it('reads n, median, IQR, min, max and bandwidth through one path in tooltip, keyboard and table', () => {
    const run = n5run(lone);
    const { formatters } = run;
    const h = 0.9 * (2 / 1.34) * 5 ** -0.2;
    const expected = `median 3 (n 5, IQR 2 – 4, min 1, max 5, bandwidth ${formatters.value(0, h)})`;
    expect(result.data.columns.bandwidth[0]).toBeCloseTo(h, 14);
    expect(run.lookup.tooltip({ kind: 'x', x: 0 }).rows[0]!.value).toBe(expected);
    const key = run.view.frame.series[0]!.key;
    expect(run.lookup.datum({ kind: 'aligned', seriesKey: key, x: 0 })!.value).toBe(expected);
    const table = run.reader.table!;
    expect(table.headers).toEqual(['x', 'Spread median', 'Spread n', 'Spread IQR', 'Spread min', 'Spread max', 'Spread bandwidth']);
    const row = table.row(0)!;
    expect(row).toEqual(['A', '3', '5', '2 – 4', '1', '5', formatters.value(0, h)]);
    expect(`median ${row[1]} (n ${row[2]}, IQR ${row[3]}, min ${row[4]}, max ${row[5]}, bandwidth ${row[6]})`).toBe(expected);
    // The constant group's fallback bandwidth is read out as computed.
    expect(table.row(2)![6]).toBe(formatters.value(0, 0.9 * 7 * 3 ** -0.2));
    // Keyboard steps reach every violin in x order.
    const next = run.lookup.step({ kind: 'aligned', seriesKey: key, x: 0 }, 'next')!;
    expect(run.lookup.datum(next)!.value).toMatch(/^median 5 \(n 6, IQR 4 – 9, min 2, max 12, /);
    expect(run.reader.summary).toContain('median 7');
  });

  it('picks the violin by its painted outline: inside or within 3 px, not beyond', () => {
    // Beside a scatter layer (a boxplot drawn over the same slot would take the pick inside its own box).
    const run = n5run({ ...base, layers: mixed.layers.slice(0, 2) });
    const y = yScaleOf(run.layout, 0), half = halfOf(run);
    const vKey = run.view.frame.series[1]!.key;
    const grid = result.data.columns.grid[1]!, density = result.data.columns.density[1]!;
    const peak = Math.max(...result.data.columns.density.flatMap(d => [...d]));
    let mode = 0;
    for (let k = 1; k < 128; k++) if (density[k]! > density[mode]!) mode = k;
    const px = xPixel(run.layout, run.view, 1), py = position(y, grid[mode]!), w = half * (density[mode]! / peak);
    const primaryAt = (x: number) => {
      const target = run.lookup.pick(x, py);
      const ref = target && run.lookup.primary(target);
      return ref && ref.kind !== 'slice' ? ref.seriesKey : null;
    };
    expect(primaryAt(px + w - 1)).toBe(vKey);
    expect(primaryAt(px - w + 1)).toBe(vKey);
    expect(primaryAt(px + w + 2)).toBe(vKey);
    // Outside the slack the pick falls back to the first visible series (the scatter, which has no point here).
    expect(primaryAt(px + w + 6)).toBe(run.view.frame.series[0]!.key);
    const anchor = run.lookup.anchor({ kind: 'aligned', seriesKey: vKey, x: 1 })!;
    expect(anchor.x).toBeCloseTo(px - half * (Math.max(...density) / peak), 3);
    expect(anchor.width).toBeCloseTo(2 * half * (Math.max(...density) / peak), 3);
  });
});

describe('N9a violin layer: row mapping, payload checks and updates', () => {
  it('follows each group through x sorting via the source row', () => {
    const numeric = violinData([{ g: 30, v: 1 }, { g: 30, v: 3 }, { g: 10, v: 100 }, { g: 10, v: 104 }, { g: 20, v: 50 }], { group: 'g', value: 'v' });
    const run = n5run({ data: numeric.data, x: 'x', axes: { v: { position: 'left' } }, layers: [{ type: 'violin', yAxis: 'v' }] });
    expect([...run.view.frame.x.values]).toEqual([10, 20, 30]);
    const y = yScaleOf(run.layout, 0);
    const [area] = marksOf(run, 'area', 0) as AreaMark[];
    // Slot 0 is x = 10, the second source row.
    expect(area!.upper[1]!).toBeCloseTo(position(y, numeric.data.columns.grid[1]![0]!), 3);
    expect(run.lookup.tooltip({ kind: 'x', x: 10 }).rows[0]!.value).toMatch(/^median 102 \(n 2,/);
  });

  it('reports malformed rows and draws the rest: AX102 absent, AX103 non-finite, AX106 malformed', () => {
    const grid = [...result.data.columns.grid], density = [...result.data.columns.density];
    const bad = (g: unknown[], d: unknown[]) => n5run({ ...lone, data: { columns: { ...result.data.columns, grid: g, density: d } } });
    // Each issue is reported on the field at fault (review sol-6.2-medium__20261127T202902Z finding 4).
    const cases: [unknown[], unknown[], string, string][] = [
      [[grid[0], null, grid[2]], density, 'AX102', 'grid'],
      [grid, [density[0], Float64Array.of(...density[1]!.slice(0, 127), NaN), density[2]], 'AX103', 'density'],
      [grid, [density[0], density[1]!.subarray(1), density[2]], 'AX106', 'density'],
      [[grid[0], Float64Array.from(grid[1]!).reverse(), grid[2]], density, 'AX106', 'grid'],
      [grid, [density[0], density[1]!.map((v, k) => (k === 5 ? -v : v)), density[2]], 'AX106', 'density'],
      [grid, [density[0], 'dense', density[2]], 'AX106', 'density'],
    ];
    for (const [g, d, code, field] of cases) {
      const run = bad(g, d);
      const found = run.diagnostics.filter(x => x.code === code);
      expect(found.map(x => [x.field, x.rows])).toEqual([[field, [1]]]);
      expect(found[0]!.message).toContain('not drawn');
      const [area] = marksOf(run, 'area', 0) as AreaMark[];
      expect(Array.from(area!.runs)).toEqual([0, 128, 0, 128, 128, 128, 128, 128]);
      expect(run.reader.table!.row(1)![1]).toBe('5');
    }
    // An empty pair is an empty group's estimate: its NaN summary is silent no data, not a payload error.
    const empty = violinData([{ g: 'A', v: 1 }, { g: 'A', v: 2 }, { g: 'B', v: null }], { group: 'g', value: 'v' });
    const run = n5run({ ...lone, data: empty.data });
    expect(nonHint(run)).toEqual([]);
    expect(run.lookup.tooltip({ kind: 'x', x: 1 }).rows[0]!.value).toBe('No data');
  });

  it('reports unordered five numbers (AX176) and an unknown inner option (AX150)', () => {
    const swapped = n5run({ ...lone, data: { columns: { ...result.data.columns, q1: result.data.columns.q3, q3: result.data.columns.q1 } } });
    const ax176 = swapped.diagnostics.filter(d => d.code === 'AX176');
    expect(ax176.map(d => [d.field, d.rows])).toEqual([['Spread', [0, 1]]]);
    const inner = n5run({ ...lone, layers: [{ type: 'violin', yAxis: 'v', inner: 'dots' }] });
    expect(nonHint(inner)).toContain('AX150:layers[0].inner');
    expect(marksOf(inner, 'rects')).toHaveLength(1);
  });

  it('rejects a payload option that does not name a field (AX174)', () => {
    const run = n5run({ ...lone, layers: [{ type: 'violin', yAxis: 'v', density: { field: 'density' } }] });
    expect(nonHint(run)).toContain('AX174:layers[0].density');
  });

  it('is a linear-axis layer: a log axis is AX173', () => {
    const run = n5run({ ...base, axes: { v: { position: 'left', scale: 'log' } }, layers: [{ type: 'violin', yAxis: 'v' }] });
    expect(nonHint(run)).toContain('AX173:v');
  });

  it('reads the payload again on every update and rolls back a rejected strict update', () => {
    const local = violinData(rows, { group: 'g', value: 'v' });
    const initial = { ...lone, data: { columns: { ...local.data.columns } }, strict: true, title: 'Violins' };
    const rec = record({ width: 640, height: 360 });
    const parsed = parseCartesianInput(initial);
    const stateRef: CartesianStateRef = { meta: parsed.meta };
    const pending = { list: parsed.issues };
    const composition = {
      kind: 'line',
      resolve: createCartesianResolver(stateRef, pending),
      normalize: ((kind, resolved, env, sink, version) => normalizeCartesian(stateRef, kind, resolved, env, sink, version)) as Composition['normalize'],
      view: ((frame, state, sink) => buildCartesianView(stateRef, frame as never, state as never, sink)) as Composition['view'],
      layout: createCartesianLayoutStage(stateRef),
      timeReadout: createTimeReadout,
      scene: (view, lay, dpr) => buildCartesianScene(stateRef, view, lay, dpr),
      lookup: (view, lay, formatters, messages) => createCartesianLookup(stateRef, view, lay, formatters, messages),
      reader: createCartesianReader(stateRef),
      interaction: { overlay: createCartesianOverlay(stateRef), swatch: createMarkSwatch(stateRef), stepInSeries: null, sliceList: null },
      svg: { area: svgArea, band: svgBand, path: svgPath, points: svgPoints, rects: svgRects, rule: svgRule },
    } as Composition;
    const handle = controllerFor(composition, parsed.translated, rec.host).handle as { update(p: unknown): void; destroy(): void };
    let currentRaw: Record<string, unknown> = { ...initial };
    // Mirrors packages/axylo/src/cartesian.ts update() and its rollback.
    const update = (patch: Record<string, unknown>) => {
      const prevRaw = currentRaw, prevMeta = stateRef.meta, prevIssues = pending.list;
      currentRaw = { ...currentRaw, ...patch };
      const next = parseCartesianInput(currentRaw, prevMeta);
      stateRef.meta = next.meta;
      pending.list = next.issues;
      try { handle.update(next.translated); } catch (err) {
        currentRaw = prevRaw; stateRef.meta = prevMeta; pending.list = prevIssues;
        throw err;
      }
      rec.frames();
    };
    const areaOf = () => rec.draws[rec.draws.length - 1]!.marks.find((m): m is AreaMark => m.type === 'area')!;
    rec.frames();
    const before = Float32Array.from(areaOf().upper);

    // A strict update that brings a malformed density (AX106, a warning) is rejected and changes nothing.
    const broken = { columns: { ...local.data.columns, density: [local.data.columns.density[0], 'x', local.data.columns.density[2]] } };
    const accepted = stateRef.meta;
    expect(() => update({ data: broken })).toThrow();
    expect(strictViolations(n5run({ ...lone, data: broken }).diagnostics).map(d => d.code)).toContain('AX106');
    expect(stateRef.meta).toBe(accepted);
    rec.frames();
    expect(Array.from(areaOf().upper)).toEqual(Array.from(before));

    // So is an empty outline on a row whose median the frame holds (the AX106 normalizeCartesian reports): n 0
    // leaves only the median to say the row had data.
    const hollow = { columns: { ...local.data.columns, grid: [[], ...local.data.columns.grid.slice(1)], density: [[], ...local.data.columns.density.slice(1)], n: Float64Array.of(0, 6, 3) } };
    expect(strictViolations(n5run({ ...lone, data: hollow }).diagnostics).map(d => `${d.code}:${d.field}`)).toContain('AX106:grid');
    expect(() => update({ data: hollow })).toThrow();
    expect(stateRef.meta).toBe(accepted);
    rec.frames();
    expect(Array.from(areaOf().upper)).toEqual(Array.from(before));

    // Only the density column replaced (the other columns are the same borrowed arrays): the core sees a new
    // column and re-reads the data, and the violin layer reads its payload again, so no outline is stale.
    // (Arrays mutated in place under the same column identity are not a change for any layer: the core keeps
    // the accepted frame, as its borrowed-column contract says.)
    const sameData = currentRaw.data as { columns: Record<string, unknown> & { density: Float64Array[] } };
    const drawsBefore = rec.draws.length;
    // Halve a group that does not hold the layer's peak: its outline narrows by half, the others stay.
    const peaks = sameData.columns.density.map(d => Math.max(...d));
    const g = peaks[0] === Math.max(...peaks) ? 1 : 0;
    const centre = (k: number) => (before[2 * k]! + areaOf().lower[2 * k]!) / 2;
    const widthsBefore = Array.from({ length: 384 }, (_, k) => before[2 * k]! - centre(k));
    update({ data: { columns: { ...sameData.columns, density: sameData.columns.density.map((d, i) => i === g ? Float64Array.from(d, v => v / 2) : d) } } });
    expect(rec.draws.length).toBeGreaterThan(drawsBefore);
    const changed = areaOf();
    for (let k = 0; k < 384; k++) {
      const w = changed.upper[2 * k]! - (changed.upper[2 * k]! + changed.lower[2 * k]!) / 2;
      expect(w).toBeCloseTo(Math.floor(k / 128) === g ? widthsBefore[k]! / 2 : widthsBefore[k]!, 3);
    }

    // New groups on an accepted update replace the outlines and the readout: nothing stale is kept.
    const next = violinData([{ g: 'A', v: 10 }, { g: 'A', v: 20 }, { g: 'B', v: 15 }], { group: 'g', value: 'v' });
    update({ data: next.data });
    const after = areaOf();
    expect(Array.from(after.runs)).toEqual([0, 128, 0, 128, 128, 128, 128, 128]);
    expect(rec.committed!.reader.table!.row(0)!.slice(1, 3)).toEqual(['15', '2']);
    expect(rec.committed!.reader.table!.rowCount).toBe(2);
    handle.destroy();
  });
});
