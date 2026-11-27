/**
 * The heatmap on the real controller (recording host) and the real interaction layer (createInteraction on the
 * N3 DOM double): strict call-time rejection with rollback of the frame and everything drawn from it, the color
 * bar's repaint after accepted data / domain / format / legend changes and its release on destroy, AX185 at
 * render time, and the keyboard path from first focus through all arrow keys with exact row/column readings.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { StrictError } from '../../../src/core/delivery';
import type { AlignedView } from '../../../src/core/contracts';
import type { Committed } from '../../../src/dom/interaction';
import { matrixOf } from '../../../src/spatial/heatmap/core';
import { heatmapInternals } from '../../../src/spatial/heatmap/chart';
import { LEGEND_STOPS } from '../../../src/spatial/heatmap/legend';
import { grid } from './fixtures';
import { interactive } from './interactive';
import { openRecorded } from './host';

const BASE = { title: 'Load', x: 'c', y: 'r', value: 'v' };
const matrix = (c: Committed) => matrixOf((c.view as AlignedView).frame)!;

describe('strict call-time rejection rolls everything back', () => {
  it('keeps the accepted frame, view, lookup, table and legend when a strict update has a duplicate cell (AX182)', () => {
    const { rec, handle } = openRecorded({ ...BASE, data: grid(3, 4, (r, c) => r * 4 + c) });
    const before = rec.committed!;
    const internals = heatmapInternals(handle)!;
    const tableBefore = internals.table()!;
    const legendBefore = internals.legend();
    const rowBefore = tableBefore.row(1);
    const dup = { columns: { r: ['r0', 'r0', 'r1'], c: ['c0', 'c0', 'c0'], v: [9, 10, 11] } };
    let thrown: unknown;
    try { handle.update({ strict: true, data: dup }); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(StrictError);
    expect((thrown as StrictError).diagnostics.map(d => d.code)).toContain('AX182');
    rec.frames();
    const after = rec.committed!;
    expect(after.view).toBe(before.view);
    expect(matrix(after)).toBe(matrix(before));
    expect(after.lookup.count).toBe(12);
    expect(internals.table()!.row(1)).toEqual(rowBefore);
    expect(internals.legend()).toEqual(legendBefore);
    expect(handle.diagnostics.map(d => d.code)).not.toContain('AX182');
    // The rejected option (strict) is not kept either: a later non-strict duplicate is accepted with AX182.
    handle.update({ data: dup });
    rec.frames();
    expect(handle.diagnostics.map(d => d.code)).toContain('AX182');
    expect(matrix(rec.committed!).rows).toBe(2);
    // The left-out row counts in the reader's note (F12), which sends the reader to the table that names it.
    expect(rec.committed!.reader.note).toBe('Values not shown: 1. See table.');
    expect(heatmapInternals(handle)!.table()!.row(0)![1]).toBe('9 (duplicate rows not drawn: 10)');
  });

  it('rolls back a strict color-domain change (AX184) and keeps the accepted domain and bins', () => {
    const { rec, handle } = openRecorded({ ...BASE, strict: true, data: grid(2, 2, (r, c) => r + c), color: { domain: [0, 4], bins: 8 } });
    const m = matrix(rec.committed!);
    expect(() => handle.update({ color: { domain: [4, 0], bins: 16 } })).toThrow(StrictError);
    rec.frames();
    expect(matrix(rec.committed!)).toBe(m);
    expect(m.domain).toMatchObject({ lo: 0, hi: 4, bins: 8 });
    // An accepted color change rebuilds the frame (the heatmap's options shape it) and its bins.
    handle.update({ color: { domain: [0, 4], bins: 16 } });
    rec.frames();
    expect(matrix(rec.committed!).domain!.bins).toBe(16);
  });

  it('a strict invalid value (AX183) on create throws; non-strict it is drawn crossed out and disclosed', () => {
    expect(() => openRecorded({ ...BASE, strict: true, data: grid(1, 2, (_r, c) => (c ? Infinity : 1)) })).toThrow(StrictError);
    const { rec, handle } = openRecorded({ ...BASE, data: grid(1, 2, (_r, c) => (c ? Infinity : 1)) });
    expect(handle.diagnostics.find(d => d.code === 'AX183')?.count).toBe(1);
    // Omitted values reach the reader's note (spec F12).
    expect(rec.committed!.reader.note).toMatch(/1/);
  });
});

describe('value unit and format reach every reading', () => {
  it('the controller\'s formatters carry the value field\'s unit and format to the keyboard, tooltip and table', () => {
    const { rec, handle } = openRecorded({ ...BASE, data: grid(1, 2, (_r, c) => [1.5, 20][c]), value: { field: 'v', label: 'Load', unit: 'ms' } });
    const lookup = rec.committed!.lookup;
    const ref = lookup.step(null, 'first')!;
    const withUnit = rec.committed!.formatters.value(0, 1.5);
    expect(withUnit).toMatch(/ms/);
    expect(lookup.datum(ref)!.value).toBe(withUnit);
    expect(heatmapInternals(handle)!.table()!.row(0)![1]).toBe(withUnit);
    handle.update({ value: { field: 'v', label: 'Load', format: { style: 'percent' } } });
    rec.frames();
    expect(rec.committed!.lookup.datum(rec.committed!.lookup.step(null, 'first')!)!.value).toBe('150%');
  });
});

describe('events', () => {
  it('select hands the author the caller\'s own row and its index for the chosen cell', () => {
    const rows = [{ r: 'a', c: 'x', v: 1 }, { r: 'a', c: 'y', v: 2 }, { r: 'b', c: 'x', v: 3 }];
    const { rec, handle, controller } = openRecorded({ ...BASE, data: rows });
    const got: unknown[] = [];
    handle.on('select', p => { got.push(p); });
    const lookup = rec.committed!.lookup;
    const ref = lookup.step(lookup.step(null, 'first')!, 'series-next')!;
    controller.actions.select(ref);
    rec.frames();
    expect(got).toHaveLength(1);
    // x / y of the event are not the cell's column and value (core pointForDatum knows aligned and point frames
    // only; recorded as a contract limitation in the ledger): the row object and index identify the cell.
    expect(got[0]).toMatchObject({ row: rows[2], index: 2, series: 'v' });
  });
});

describe('option findings under strict', () => {
  it('an unknown heatmap option (AX150, warning) rejects a strict update and keeps the accepted frame', () => {
    const { rec, handle } = openRecorded({ ...BASE, strict: true, data: grid(2, 2, () => 1) });
    const m = matrix(rec.committed!);
    let thrown: unknown;
    try { handle.update({ shade: 'dark', color: { bins: 8 } }); } catch (e) { thrown = e; }
    expect((thrown as StrictError).diagnostics.map(d => [d.code, d.field])).toContainEqual(['AX150', 'shade']);
    rec.frames();
    expect(matrix(rec.committed!)).toBe(m);
    expect(m.domain!.bins).toBe(32);
  });
});

describe('strict rollback (property)', () => {
  it('for any accepted grid and any rejected strict patch, the frame, table rows and color bar stay the accepted ones', () => {
    const bad = fc.constantFrom(
      { data: { columns: { r: ['a', 'a'], c: ['x', 'x'], v: [1, 2] } } },          // AX182
      { data: { columns: { r: ['a'], c: ['x'], v: [Infinity] } } },               // AX183
      { color: { domain: [3, 3] } },                                              // AX184
      { color: { scheme: 'diverging', mid: Number.NaN } },                        // AX184
      { color: { bins: 999 } },                                                   // AX150
      { colour: 'red' },                                                          // AX150
    );
    fc.assert(fc.property(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 1, max: 30 }), fc.integer({ min: -1e6, max: 1e6 }), bad, (rows, cols, offset, patch) => {
      const { rec, handle } = openRecorded({ ...BASE, strict: true, data: grid(rows, cols, (r, c) => offset + r * cols + c) });
      const internals = heatmapInternals(handle)!;
      const m = matrix(rec.committed!);
      const legend = internals.legend();
      const firstRow = internals.table()!.row(0);
      expect(() => handle.update(patch)).toThrow(StrictError);
      rec.frames();
      expect(matrix(rec.committed!)).toBe(m);
      expect(internals.legend()).toEqual(legend);
      expect(internals.table()!.row(0)).toEqual(firstRow);
      // And the chart still accepts a valid update afterwards.
      handle.update({ color: { bins: 8 } });
      rec.frames();
      expect(matrix(rec.committed!).domain!.bins).toBe(8);
      handle.destroy();
    }), { numRuns: 30 });
  });
});

describe('render-time AX185', () => {
  it('is reported (never thrown) when cells fall under 1 CSS px, and cleared when they fit again', () => {
    const { rec, handle } = openRecorded({ ...BASE, strict: true, data: grid(400, 10, () => 1) }, { width: 400, height: 300 });
    expect(handle.diagnostics.find(d => d.code === 'AX185')?.level).toBe('hint');
    handle.update({ data: grid(40, 10, () => 1) });
    rec.frames();
    expect(handle.diagnostics.map(d => d.code)).not.toContain('AX185');
  });
});

describe('keyboard through the real interaction layer', () => {
  it('starts at the top-left cell and moves along rows and columns with exact row/column readings', () => {
    const { rec, composition } = openRecorded({ ...BASE, data: grid(3, 4, (r, c) => (r === 1 && c === 2 ? null : r * 10 + c + 0.5)) });
    const t = interactive(rec, composition);
    t.focus();
    expect(t.reading()).toBe('r r0 (row 1 of 3), c c0 (column 1 of 4), 0.5. Cell 1 of 12.');
    t.key('ArrowRight');
    expect(t.reading()).toBe('r r0 (row 1 of 3), c c1 (column 2 of 4), 1.5. Cell 2 of 12.');
    t.key('ArrowDown');
    expect(t.reading()).toBe('r r1 (row 2 of 3), c c1 (column 2 of 4), 11.5. Cell 6 of 12.');
    t.key('ArrowRight');
    // The missing cell is focusable and reads "No data" (never 0).
    expect(t.reading()).toBe('r r1 (row 2 of 3), c c2 (column 3 of 4), No data. Cell 7 of 12.');
    t.key('End');
    expect(t.reading()).toMatch(/^r r1 \(row 2 of 3\), c c3 \(column 4 of 4\), 13\.5\. Cell 8 of 12\.$/);
    // Non-wrapping: ArrowRight at the row's end stays.
    t.key('ArrowRight');
    expect(t.reading()).toMatch(/Cell 8 of 12\.$/);
    t.key('Home');
    expect(t.reading()).toMatch(/c c0 \(column 1 of 4\), 10\.5\. Cell 5 of 12\.$/);
    t.key('ArrowUp');
    t.key('ArrowUp');
    expect(t.reading()).toMatch(/^r r0 .*Cell 1 of 12\.$/);
    t.key('ArrowLeft');
    expect(t.reading()).toMatch(/Cell 1 of 12\.$/);
    t.key('PageDown');
    expect(t.reading()).toMatch(/^r r2 \(row 3 of 3\).*Cell 9 of 12\.$/);
    t.key('PageUp');
    expect(t.reading()).toMatch(/^r r0 .*Cell 1 of 12\.$/);
    t.interaction.destroy();
  });
});

describe('pointer through the real interaction layer', () => {
  it('hovering a cell picks it (O(1)) and its tooltip model has row, column and the exact value; a missing cell reads No data', () => {
    const { rec, composition } = openRecorded({ ...BASE, data: grid(3, 4, (r, c) => (r === 2 && c === 0 ? null : r * 10 + c + 0.125)) });
    const t = interactive(rec, composition);
    const layout = rec.committed!.layout;
    if (layout.kind !== 'plot') throw new Error('no plot');
    const { plot } = layout;
    const at = (r: number, c: number) => t.hover(plot.x + (c + 0.5) * plot.width / 4, plot.y + (r + 0.5) * plot.height / 3);
    at(1, 3);
    expect(t.tooltip()).toBe('r1, c3 | v 13.125');
    at(2, 0);
    expect(t.tooltip()).toBe('r2, c0 | v No data');
    t.interaction.destroy();
  });
});

describe('the color bar', () => {
  it('is mounted, follows accepted data, domain and format changes, hides with legend: false, and is released on destroy', () => {
    const { rec, handle, composition } = openRecorded({ ...BASE, data: grid(2, 2, (r, c) => r * 2 + c) });
    const t = interactive(rec, composition);
    expect(t.legend()).not.toBeNull();
    expect(t.ticks()).toEqual(['0', '1.5', '3']);
    // One continuous bar (N8a review blocker 1): the same stops whatever the plot's bin count.
    expect(t.legend()!.querySelectorAll('.axylo-heatmap-bar-fill')).toHaveLength(1);
    expect(t.legend()!.querySelectorAll('.axylo-heatmap-stop')).toHaveLength(LEGEND_STOPS);
    // Data with a missing cell and a new range.
    handle.update({ data: grid(2, 2, (r, c) => (r === 1 && c === 1 ? null : (r * 2 + c) * 10)) });
    rec.frames();
    t.show(rec.committed!);
    expect(t.ticks()).toEqual(['0', '10', '20']);
    expect(t.legend()!.querySelector('.axylo-heatmap-missing')?.textContent).toBe('No data');
    // An explicit domain and fewer bins.
    handle.update({ color: { domain: [-100, 100], bins: 4 } });
    rec.frames();
    t.show(rec.committed!);
    expect(t.ticks()).toEqual(['-100', '0', '100']);
    expect(t.legend()!.querySelectorAll('.axylo-heatmap-bar-fill')).toHaveLength(1);
    expect(t.legend()!.querySelectorAll('.axylo-heatmap-stop')).toHaveLength(LEGEND_STOPS);
    // A value format.
    handle.update({ value: { field: 'v', format: { style: 'percent' } } });
    rec.frames();
    t.show(rec.committed!);
    expect(t.ticks()).toEqual(['-10,000%', '0%', '10,000%']);
    // Turned off, then on again.
    handle.update({ legend: false });
    rec.frames();
    t.show(rec.committed!);
    expect(t.legend()).toBeNull();
    handle.update({ legend: 'bottom' });
    rec.frames();
    t.show(rec.committed!);
    expect(t.legend()).not.toBeNull();
    t.interaction.destroy();
    expect(t.legend()).toBeNull();
  });

  it('a rejected strict update leaves the bar as it was', () => {
    const { rec, handle, composition } = openRecorded({ ...BASE, strict: true, data: grid(2, 2, (r, c) => r * 2 + c) });
    const t = interactive(rec, composition);
    expect(() => handle.update({ data: grid(2, 2, () => Infinity) })).toThrow(StrictError);
    rec.frames();
    t.show(rec.committed!);
    expect(t.ticks()).toEqual(['0', '1.5', '3']);
    t.interaction.destroy();
  });
});
