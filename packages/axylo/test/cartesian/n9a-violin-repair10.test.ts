/**
 * N9a repair round 10 (review sol-6.2-medium__20261127T222130Z): a field that one violin layer reads as its grid and
 * another as its density, n or bandwidth gets one AX106 report, over the union of the source rows every role found
 * at fault: `count` is the number of distinct rows, `rows` the first ten ascending (spec 3.5).
 *
 * Fixtures: numeric x descending with the source row (slot order is the reverse of source order); layer A reads
 * grid 'shared' and density 'density', layer B grid 'grid2' and density 'shared', each with its own five numbers
 * (admitted median 2). Expected rows are the source rows the fixtures put the faults at.
 *
 * Repair 11 (review sol-6.2-medium__20261127T222826Z): that one report's outcome follows the roles that faulted. A
 * grid list read as n or bandwidth is never a number, so every row loses that reading while the outlines still draw
 * (scalar only: the unaliased "Those rows' <field> is not read out."); outline faults keep the outline sentence; a
 * field at fault in both roles counts each role's rows. Messages are the registry's AX106 text plus that outcome.
 */
import { describe, expect, it } from 'vitest';
import { validateCartesian } from '../../src/cartesian';
import { createCartesianResolver, parseCartesianInput } from '../../src/cartesian/options';
import { normalizeCartesian } from '../../src/cartesian/normalize';
import { logicalOf } from '../../src/cartesian/boxplot';
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
import { marksOf, n5run, type N5Run } from './n5-pipeline';
import type { AreaMark } from '../../src/core/contracts';
import { defaultMessages } from '../../src/messages';

type Row = Record<string, unknown>;
type Found = { code: string; field?: string; count?: number; rows?: readonly number[] };
const box = { min: 1, q1: 1, q3: 4, max: 4, median: 2, min2: 1, q12: 1, q32: 4, max2: 4, median2: 2 };
const at = (r: number, cells: Row): Row => ({ x: 100 - r, ...box, density: [1, 1], shared: [0, 1], grid2: [0, 1], ...cells });
const A = { type: 'violin', yAxis: 'v', grid: 'shared' };
const B = { type: 'violin', yAxis: 'v', grid: 'grid2', density: 'shared', min: 'min2', q1: 'q12', median: 'median2', q3: 'q32', max: 'max2' };
const options = (data: unknown, layers: unknown[] = [A, B]) => ({ data, x: 'x', axes: { v: { position: 'left' } }, layers }) as never;
const on = (found: readonly Found[], field: string) => found.filter(d => d.field === field).map(d => [d.code, d.count, d.rows]);
/** Both the live pipeline and validateCartesian, each run twice: the parse's pool must not be consumed or grown. */
const both = (opts: never, field: string) => {
  const runs = [n5run(opts).diagnostics, n5run(opts).diagnostics, validateCartesian(opts), validateCartesian(opts)].map(f => on(f as readonly Found[], field));
  for (const r of runs.slice(1)) expect(r).toEqual(runs[0]);
  return runs[0];
};
const ten = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
type Said = Found & { message?: string; effect?: string };
/** Like `both`, with each report's full message; the live pipeline's reports also keep effect 'omitted'. */
const said = (opts: never, field: string) => {
  const live = (n5run(opts).diagnostics as readonly Said[]).filter(d => d.field === field);
  for (const d of live) expect(d.effect).toBe('omitted');
  const runs = [live, n5run(opts).diagnostics, validateCartesian(opts), validateCartesian(opts)]
    .map(f => (f as readonly Said[]).filter(d => d.field === field).map(d => [d.code, d.count, d.rows, d.message]));
  for (const r of runs.slice(1)) expect(r).toEqual(runs[0]);
  return runs[0];
};
/** The registry's AX106 text for `count` values at `rows` (spec 3.5), then the given outcome. */
const ax106 = (field: string, count: number, rows: readonly number[], outcome: string) =>
  `Field "${field}" has ${count} ${count === 1 ? 'value that cannot be plotted as a number' : 'values that cannot be plotted as numbers'} at ${rows.length === 1 ? 'row' : 'rows'} ${rows.join(', ')}. ` +
  `Convert values to numbers where the data is produced. ${outcome}`;
const OUTLINES = "Those rows' density outlines are not drawn; their summaries stay in tooltip and table.";
const READOUT = (field: string) => `Those rows' ${field} is not read out.`;
const MIXED = (field: string, outline: number, scalar: number) =>
  `Density outlines are not drawn for ${outline} of those rows and ${field} is not read out for ${scalar}; their summaries stay in tooltip and table.`;
/** Violins each layer draws: one area per layer, two grid points per outline, two coordinates per point. */
const drawn = (run: N5Run) => [0, 1].map(series => (marksOf(run, 'area', series) as AreaMark[]).reduce((sum, m) => sum + m.upper.length / 4, 0));
/** Layer B's readout at source row r (x = 100 - r); n and bandwidth read out as missing where omitted. */
const readoutB = (run: N5Run, r: number) => run.lookup.tooltip({ kind: 'x', x: 100 - r }).rows[1]!.value;

describe('N9a repair 10: one AX106 per field across violin roles and layers', () => {
  it('a row at fault as A grid and as B density is counted once', () => {
    const rows = [at(0, { shared: [2, 1], grid2: [0, 1, 2] }), at(1, {}), at(2, {})];
    expect(both(options(rows), 'shared')).toEqual([['AX106', 1, [0]]]);
    expect(said(options(rows), 'shared')).toEqual([['AX106', 1, [0], ax106('shared', 1, [0], OUTLINES)]]);
    // The parse alone leaves that field to normalization: no option-stage AX106 on it.
    expect(logicalOf(parseCartesianInput(options(rows)).meta).optionIssues.filter(i => i.field === 'shared')).toEqual([]);
  });

  it('density fault on row 0 and grid fault on row 1 are one report over both rows', () => {
    const rows = [at(0, { grid2: [0, 1, 2] }), at(1, { shared: [1, 0] }), at(2, {})];
    expect(both(options(rows), 'shared')).toEqual([['AX106', 2, [0, 1]]]);
    // Layer order does not matter.
    expect(both(options(rows, [B, A]), 'shared')).toEqual([['AX106', 2, [0, 1]]]);
    // Outline-only: the outline sentence; A loses row 1 (grid not increasing), B row 0 (lengths differ).
    for (const layers of [[A, B], [B, A]]) expect(said(options(rows, layers), 'shared')).toEqual([['AX106', 2, [0, 1], ax106('shared', 2, [0, 1], OUTLINES)]]);
    expect(drawn(n5run(options(rows)))).toEqual([2, 2]);
  });

  it('admitted empty grids, other-layer density faults and more than ten rows', () => {
    const rows = [
      // 0..5: an empty pair for A (admitted median) and a length mismatch for B, on the same rows.
      ...Array.from({ length: 6 }, (_, k) => at(k, { shared: [], density: [] })),
      // 6..11: only B's density.
      ...Array.from({ length: 6 }, (_, k) => at(6 + k, { grid2: [0, 1, 2] })),
      // 12, 13: only A's empty pair (B's own pair is empty too, which is reported on grid2).
      at(12, { shared: [], density: [], grid2: [] }),
      at(13, { shared: [], density: [], grid2: [] }),
      at(14, {}),
    ];
    expect(both(options(rows), 'shared')).toEqual([['AX106', 14, ten]]);
    expect(both(options(rows), 'grid2')).toEqual([['AX106', 2, [12, 13]]]);
    // Column form gives the same.
    const columns = Object.fromEntries(Object.keys(rows[0]!).map(k => [k, rows.map(row => row[k])]));
    expect(both(options({ columns }), 'shared')).toEqual([['AX106', 14, ten]]);
    expect(said(options(rows), 'shared')).toEqual([['AX106', 14, ten, ax106('shared', 14, ten, OUTLINES)]]);
  });

  it('n and bandwidth aliased to another layer\'s grid join the same report; unaliased fields keep theirs', () => {
    const rows = [at(0, {}), at(1, { shared: [1, 0] }), at(2, {})];
    // B's n and bandwidth read A's grid lists on every row; A's grid is also bad on row 1.
    const alias = { ...B, density: 'density', n: 'shared', bandwidth: 'shared' };
    expect(both(options(rows, [A, alias]), 'shared')).toEqual([['AX106', 3, [0, 1, 2]]]);
    // Mixed roles: one row lost A's outline, all three lost B's n and bandwidth.
    expect(said(options(rows, [A, alias]), 'shared')).toEqual([['AX106', 3, [0, 1, 2], ax106('shared', 3, [0, 1, 2], MIXED('shared', 1, 3))]]);
    // An n that is no grid stays an option-stage report of its own, and AX102 / AX103 on the grid keep their codes.
    const plain = [at(0, { n: 'x' }), at(1, { shared: null }), at(2, { shared: [0, Infinity] }), at(3, {})];
    const found = n5run(options(plain, [A])).diagnostics as readonly Found[];
    expect(on(found, 'n')).toEqual([['AX106', 1, [0]]]);
    expect(on(found, 'shared')).toEqual(expect.arrayContaining([['AX102', 1, [1]], ['AX103', 1, [2]]]));
    expect(on(found, 'shared')).toHaveLength(2);
  });

  it('a strict update whose only fault is B density on A grid field is rejected and rolled back', () => {
    const good = [at(0, {}), at(1, {})];
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
    expect(() => update({ data: [at(0, {}), at(1, { grid2: [0, 1, 2] })] })).toThrow(/AX106/);
    expect(stateRef.meta).toBe(accepted);
    expect(handle.diagnostics.filter(d => d.field === 'shared')).toEqual([]);
    update({ data: [at(0, {}), at(1, { shared: [0, 2] })] });
    expect(handle.diagnostics.filter(d => d.field === 'shared')).toEqual([]);
    handle.destroy();
  });
});

describe('N9a repair 11: the aliased AX106 outcome follows the roles that faulted', () => {
  const noData = defaultMessages.noData;
  const good = [at(0, {}), at(1, {}), at(2, {})];
  const readouts = {
    n: `median 2 (n ${noData}, IQR 1 – 4, min 1, max 4)`,
    bandwidth: `median 2 (IQR 1 – 4, min 1, max 4, bandwidth ${noData})`,
  };

  for (const role of ['n', 'bandwidth'] as const) {
    const alias = { ...B, density: 'density', [role]: 'shared' };

    it(`scalar only (${role}): both layers draw every outline; the report says the reading is not read out`, () => {
      expect(said(options(good, [A, alias]), 'shared')).toEqual([['AX106', 3, [0, 1, 2], ax106('shared', 3, [0, 1, 2], READOUT('shared'))]]);
      expect(said(options(good, [alias, A]), 'shared')).toEqual([['AX106', 3, [0, 1, 2], ax106('shared', 3, [0, 1, 2], READOUT('shared'))]]);
      const run = n5run(options(good, [A, alias]));
      expect(drawn(run)).toEqual([3, 3]);
      for (const r of [0, 1, 2]) expect(readoutB(run, r)).toBe(readouts[role]);
      // The outline sentence never appears for it.
      expect(run.diagnostics.some(d => d.message.includes('outlines are not drawn'))).toBe(false);
    });

    it(`mixed roles (${role}): per-role counts; A loses its outline only where its grid is bad`, () => {
      const rows = [at(0, {}), at(1, { shared: [1, 0] }), at(2, { shared: [1, 1] }), at(3, {})];
      const rowsAt = [0, 1, 2, 3];
      expect(said(options(rows, [A, alias]), 'shared')).toEqual([['AX106', 4, rowsAt, ax106('shared', 4, rowsAt, MIXED('shared', 2, 4))]]);
      const run = n5run(options(rows, [A, alias]));
      expect(drawn(run)).toEqual([2, 4]);
      for (const r of rowsAt) expect(readoutB(run, r)).toBe(readouts[role]);
    });
  }

  it('n and bandwidth on one grid field: still one scalar-only report over the union of rows', () => {
    const alias = { ...B, density: 'density', n: 'shared', bandwidth: 'shared' };
    expect(said(options(good, [A, alias]), 'shared')).toEqual([['AX106', 3, [0, 1, 2], ax106('shared', 3, [0, 1, 2], READOUT('shared'))]]);
    const run = n5run(options(good, [A, alias]));
    expect(drawn(run)).toEqual([3, 3]);
    expect(readoutB(run, 0)).toBe(`median 2 (n ${noData}, IQR 1 – 4, min 1, max 4, bandwidth ${noData})`);
  });

  it('more than ten rows: the counts are over all rows, the sample the first ten', () => {
    const rows = Array.from({ length: 12 }, (_, r) => at(r, r === 11 ? { shared: [1, 1] } : {}));
    const alias = { ...B, density: 'density', n: 'shared' };
    expect(said(options(rows, [A, alias]), 'shared')).toEqual([['AX106', 12, ten, ax106('shared', 12, ten, MIXED('shared', 1, 12))]]);
    expect(said(options(rows.slice(0, 11), [A, alias]), 'shared')).toEqual([['AX106', 11, ten, ax106('shared', 11, ten, READOUT('shared'))]]);
  });

  it('a non-grid field read as one layer\'s density and another\'s n gives the mixed outcome at the option stage too', () => {
    // A draws with density 'density'; B has its own density 'd2' and reads 'density' as its n.
    const rows = [at(0, { d2: [1, 1] }), at(1, { d2: [1, 1], density: [1, -1] }), at(2, { d2: [1, 1] })];
    const alias = { ...B, density: 'd2', n: 'density' };
    expect(said(options(rows, [A, alias]), 'density')).toEqual([['AX106', 3, [0, 1, 2], ax106('density', 3, [0, 1, 2], MIXED('density', 1, 3))]]);
    expect(said(options(rows.map(r => ({ ...r, density: [1, 1] })), [A, alias]), 'density'))
      .toEqual([['AX106', 3, [0, 1, 2], ax106('density', 3, [0, 1, 2], READOUT('density'))]]);
    expect(logicalOf(parseCartesianInput(options(rows, [A, alias])).meta).optionIssues.filter(i => i.field === 'density').map(i => i.outcome))
      .toEqual([MIXED('density', 1, 3)]);
    const run = n5run(options(rows, [A, alias]));
    expect(drawn(run)).toEqual([2, 3]);
  });
});
