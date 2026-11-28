/**
 * N9a repair round 9 (review sol-6.2-medium__20261127T221205Z): every AX106 on a violin grid field (a malformed
 * grid, and an empty pair the chart has data for) is one report per field: `count` is the number of distinct source
 * rows and `rows` the first ten of them, ascending (spec 3.5), whichever check found each row, however the frame
 * sorts the slots, and however many violin layers read that grid field.
 *
 * Fixtures: numeric x descending with the source row, so slot order is the reverse of source order; every row has
 * min 1, Q1 1, Q3 4, max 4 and an admitted median 2 unless stated. Expected rows are the source row indexes the
 * fixtures put the faults at.
 */
import { describe, expect, it } from 'vitest';
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
import type { CartesianStateRef } from '../../src/cartesian/meta';
import type { Composition } from '../../src/core/composition';
import { controllerFor } from '../../src/core/controller';
import { createTimeReadout } from '../../src/format/time';
import { svgArea, svgBand, svgPath, svgPoints, svgRects, svgRule } from '../../src/render/svg';
import { record } from '../finance/host';
import { n5run, type N5Run } from './n5-pipeline';

type Row = Record<string, unknown>;
const box = { min: 1, q1: 1, q3: 4, max: 4, median: 2 };
const twin = { min2: 1, q12: 1, q32: 4, max2: 4, median2: 2 };
const outline = { grid: [0, 1], density: [1, 1] };
const empty = { grid: [], density: [] };
/** Row r of a fixture: x descends with r, so the frame's slots run in the reverse of source order. */
const at = (r: number, cells: Row): Row => ({ x: 100 - r, ...box, ...twin, ...cells });
const violin = { type: 'violin', yAxis: 'v' };
const second = { type: 'violin', yAxis: 'v', min: 'min2', q1: 'q12', median: 'median2', q3: 'q32', max: 'max2' };
const options = (data: unknown, layers: unknown[] = [violin]) => ({ data, x: 'x', axes: { v: { position: 'left' } }, layers }) as never;
const gridReports = (r: N5Run) => r.diagnostics.filter(d => d.field === 'grid').map(d => [d.code, d.effect, d.count, d.rows]);
const ten = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

describe('N9a repair 9: one AX106 per violin grid field, full count and first ten ascending source rows', () => {
  it('a one-point grid on row 0 and 12 admitted empty pairs after it', () => {
    const rows = [at(0, { grid: [0], density: [1] }), ...Array.from({ length: 12 }, (_, k) => at(k + 1, empty)), at(13, outline)];
    expect(gridReports(n5run(options(rows)))).toEqual([['AX106', 'omitted', 13, ten]]);
    expect(validateCartesian(options(rows)).filter(d => d.field === 'grid').map(d => [d.code, d.count, d.rows])).toEqual([['AX106', 13, ten]]);
  });

  it('admitted empty pairs first, then malformed grids of every kind (non-list, one point, not increasing, non-number)', () => {
    const bad = [{ grid: 'g', density: [1] }, { grid: [0], density: [1] }, { grid: [1, 0], density: [1, 1] }, { grid: [0, '1'], density: [1, 1] }];
    const rows = [...Array.from({ length: 8 }, (_, k) => at(k, empty)), ...bad.map((cells, k) => at(8 + k, cells)), at(12, outline)];
    expect(gridReports(n5run(options(rows)))).toEqual([['AX106', 'omitted', 12, ten]]);
  });

  it('the same in column form, with an n-positive empty pair counted once', () => {
    const rows = [at(0, { grid: [0], density: [1] }), ...Array.from({ length: 11 }, (_, k) => at(k + 1, { ...empty, median: k % 2 ? 2 : null, n: k % 2 ? 0 : 3 })), at(12, outline)];
    const columns = Object.fromEntries(Object.keys(rows[0]!).concat('n').map(k => [k, rows.map(row => row[k] ?? null)]));
    expect(gridReports(n5run(options({ columns })))).toEqual([['AX106', 'omitted', 12, ten]]);
  });

  it('two violin layers reading one grid field give one report over the union of their rows', () => {
    // Row 11's own median is missing and row 12's second median is: each is counted once, through the layer that reads it.
    const rows = [
      at(0, { grid: [0], density: [1] }),
      ...Array.from({ length: 10 }, (_, k) => at(k + 1, empty)),
      at(11, { ...empty, median: null }),
      at(12, { ...empty, median2: null }),
      at(13, { ...empty, median: null, median2: null }),
      at(14, outline),
    ];
    const r = n5run(options(rows, [violin, second]));
    expect(gridReports(r)).toEqual([['AX106', 'omitted', 13, ten]]);
    // A second layer with a density of its own still shares the grid's single report.
    const own = rows.map(row => ({ ...row, density2: row.density }));
    expect(gridReports(n5run(options(own, [violin, { ...second, density: 'density2' }])))).toEqual([['AX106', 'omitted', 13, ten]]);
  });

  it('two layers sharing other payload fields report each faulty row once, ascending over the layers', () => {
    // Shared grid, density and n: one fault each, read by both layers.
    const shared = [at(0, { grid: [0, 1], density: [1], n: -1 }), at(1, { grid: null, density: [1, 1] }), at(2, outline)];
    const both = n5run(options(shared, [violin, second])).diagnostics.filter(d => d.level !== 'hint').map(d => [d.code, d.field, d.count, d.rows]);
    expect(both).toEqual(expect.arrayContaining([['AX106', 'density', 1, [0]], ['AX102', 'grid', 1, [1]], ['AX106', 'n', 1, [0]]]));
    expect(both).toHaveLength(3);
    // Shared density with grids of their own: the first layer's density mismatch is on row 3, the second's on row 1.
    const rows = [0, 1, 2, 3].map(r => at(r, { ...outline, grid2: r === 1 ? [0, 1, 2] : [0, 1], grid: r === 3 ? [0, 1, 2] : [0, 1] }));
    const density = n5run(options(rows, [violin, { ...second, grid: 'grid2' }])).diagnostics.filter(d => d.field === 'density');
    expect(density.map(d => [d.code, d.count, d.rows])).toEqual([['AX106', 2, [1, 3]]]);
  });

  it('keeps the other violin fields and codes as they were: AX102 and AX103 on grid, AX106 on density', () => {
    const rows = [at(0, { grid: null, density: [1, 1] }), at(1, { grid: [0, Infinity], density: [1, 1] }), at(2, { grid: [0, 1], density: [1] }), at(3, { grid: [0], density: [1] }), at(4, outline)];
    const found = n5run(options(rows)).diagnostics.filter(d => d.field === 'grid' || d.field === 'density').map(d => [d.code, d.field, d.count, d.rows]);
    expect(found).toEqual(expect.arrayContaining([['AX102', 'grid', 1, [0]], ['AX103', 'grid', 1, [1]], ['AX106', 'density', 1, [2]], ['AX106', 'grid', 1, [3]]]));
    expect(found).toHaveLength(4);
  });

  it('a strict update with a malformed grid is rejected, and an accepted update keeps no stale report', () => {
    const good = [at(0, outline), at(1, outline)];
    const initial = { ...(options(good) as Row), strict: true, title: 'Violins' };
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
    const handle = controllerFor(composition, parsed.translated, rec.host).handle as { update(p: unknown): void; destroy(): void; readonly diagnostics: readonly { code: string; field?: string }[] };
    let currentRaw: Row = initial;
    // Mirrors packages/axylo/src/cartesian.ts update() and its rollback.
    const update = (patch: Row) => {
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
    rec.frames();
    const accepted = stateRef.meta;
    expect(() => update({ data: [at(0, { grid: [0], density: [1] }), at(1, outline)] })).toThrow(/AX106/);
    expect(stateRef.meta).toBe(accepted);
    expect(handle.diagnostics.filter(d => d.field === 'grid')).toEqual([]);
    update({ data: [at(0, outline), at(1, { ...outline, grid: [0, 2] })] });
    expect(handle.diagnostics.filter(d => d.field === 'grid')).toEqual([]);
    handle.destroy();
  });
});
