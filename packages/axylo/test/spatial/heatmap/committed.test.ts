/**
 * Regressions for the three blockers of cross-provider review sol-6.2-medium__20261127T170351Z:
 *
 * 1. The color bar is one continuous gradient of live CSS stops, independent of the plot's bin count, with a
 *    gradient id of its own per chart, kept across repaints (DOM double; the Chrome test checks the paint).
 * 2. A matrix with cells but no finite value is ready and interactive (hatches, focus, arrows, readings, table),
 *    while genuinely empty data keeps the empty state; typed-column NaN is missing (SLOT_NULL), a row's NaN and
 *    infinities are invalid.
 * 3. The export hooks answer for the revision the controller last drew, under its presentation options.
 *
 * Expected values come from the fixtures and the rules in chart.ts / legend.ts / core.ts, not from a run.
 */
import { describe, expect, it } from 'vitest';
import { SLOT_INVALID, SLOT_NULL, type AlignedView } from '../../../src/core/contracts';
import { StrictError } from '../../../src/core/delivery';
import type { Committed } from '../../../src/dom/interaction';
import { colorAt } from '../../../src/spatial/color-scale';
import { heatmapInternals } from '../../../src/spatial/heatmap/chart';
import { matrixOf } from '../../../src/spatial/heatmap/core';
import { LEGEND_STOPS, legendModel } from '../../../src/spatial/heatmap/legend';
import { cellTagOf } from '../../../src/spatial/heatmap/render';
import type { TestElement } from '../../core/n3-dom';
import { formattersFor, grid, stage } from './fixtures';
import { openRecorded } from './host';
import { interactive } from './interactive';

const BASE = { title: 'Load', x: 'c', y: 'r', value: 'v' };
const matrix = (c: Committed) => matrixOf((c.view as AlignedView).frame)!;
const tagsOf = (c: { scene?: { marks: readonly unknown[] } } | undefined) =>
  (c?.scene?.marks ?? []).map(m => cellTagOf(m as never)?.kind);

describe('blocker 1: one continuous color bar', () => {
  it('the model is a gradient of live CSS stops over the whole scale, the same for 2 bins as for 64', () => {
    for (const scheme of ['sequential', 'diverging'] as const) {
      const two = legendModel(stage({ data: grid(2, 3, (r, c) => r * 3 + c - 2), color: { scheme, bins: 2 } }).m, formattersFor(), { noData: 'No data' })!;
      const many = legendModel(stage({ data: grid(2, 3, (r, c) => r * 3 + c - 2), color: { scheme, bins: 64 } }).m, formattersFor(), { noData: 'No data' })!;
      expect(two.bins).toBe(2);
      expect(two.stops).toHaveLength(LEGEND_STOPS);
      expect(two.stops).toEqual(many.stops);
      two.stops.forEach((s, i) => {
        expect(s.offset).toBe(i / (LEGEND_STOPS - 1));
        expect(s.color).toBe(colorAt(scheme, s.offset));
        // Forced colors replaces every stop by the system color.
        expect(s.color.startsWith('var(--axylo-forced-series, ')).toBe(true);
      });
      // Interior stops are mixes of two anchors, not a copy of either end.
      expect(two.stops[2]!.color).toMatch(/color-mix\(in oklab, /);
      expect(two.stops[2]!.color).not.toBe(two.stops[0]!.color);
    }
  });

  it('a degenerate domain (one distinct value) is one solid color, not a scale the cells do not use', () => {
    const m = legendModel(stage({ data: grid(1, 2, () => 5) }).m, formattersFor(), { noData: 'No data' })!;
    expect(m.stops).toHaveLength(2);
    expect(m.stops[0]!.color).toBe(m.stops[1]!.color);
    expect(m.ticks.map(t => [t.label, t.at])).toEqual([['5', 0.5]]);
  });

  it('renders one gradient-filled rect per chart, CSSOM only, with ids unique per chart and kept on repaint', () => {
    const a = openRecorded({ ...BASE, data: grid(2, 2, (r, c) => r * 2 + c), color: { bins: 2 } });
    const b = openRecorded({ ...BASE, data: grid(2, 2, (r, c) => -(r * 2 + c)), color: { scheme: 'diverging', bins: 2 } });
    const ta = interactive(a.rec, a.composition), tb = interactive(b.rec, b.composition);
    const barOf = (t: ReturnType<typeof interactive>) => {
      const list = t.legend()!;
      const gradients = list.querySelectorAll('linearGradient');
      const fills = list.querySelectorAll('.axylo-heatmap-bar-fill');
      expect(gradients).toHaveLength(1);
      expect(fills).toHaveLength(1);
      const id = gradients[0]!.getAttribute('id')!;
      expect(fills[0]!.style.fill).toBe(`url("#${id}")`);
      const stops = list.querySelectorAll('.axylo-heatmap-stop');
      return { id, stops: stops.map(s => [Number(s.getAttribute('offset')), s.style['stop-color']]) };
    };
    const first = barOf(ta), other = barOf(tb);
    expect(first.id).not.toBe(other.id);
    expect(first.stops).toEqual(heatmapInternals(a.handle)!.legend()!.stops.map(s => [s.offset, s.color]));
    expect(other.stops).toEqual(heatmapInternals(b.handle)!.legend()!.stops.map(s => [s.offset, s.color]));
    // No stylesheet and no style attribute strings anywhere in the bar (CSP).
    const all = (el: TestElement): TestElement[] => [el, ...el.children.flatMap(all)];
    for (const el of all(ta.legend()!)) {
      expect(el.tagName).not.toBe('STYLE');
      expect(el.getAttribute('style')).toBeNull();
      expect(el.getAttribute('stop-color')).toBeNull();
    }
    // A repaint (new range, a missing cell) keeps the chart's id and replaces the old gradient.
    a.handle.update({ data: grid(2, 2, (r, c) => (r && c ? null : (r * 2 + c) * 10)) });
    a.rec.frames();
    ta.show(a.rec.committed!);
    expect(ta.ticks()).toEqual(['0', '10', '20']);
    expect(barOf(ta).id).toBe(first.id);
    expect(ta.root.querySelectorAll('linearGradient')).toHaveLength(1);
    // The outline that keeps the bar's extent in forced colors is still there.
    expect(ta.legend()!.querySelectorAll('.axylo-heatmap-bar-outline')).toHaveLength(1);
    ta.interaction.destroy(); tb.interaction.destroy();
  });
});

describe('blocker 2: a populated matrix with no finite cell is ready', () => {
  const cases = [
    ['all missing', grid(2, 3, () => null), { missing: 6, invalid: 0 }, ['missing'], 'No data'],
    ['all invalid', grid(2, 3, () => 'n/a'), { missing: 0, invalid: 6 }, ['invalid'], 'Invalid value ("n/a")'],
    ['missing and invalid', grid(2, 3, (_r, c) => (c === 1 ? 'n/a' : null)), { missing: 4, invalid: 2 }, ['missing', 'invalid'], 'No data'],
  ] as const;
  for (const [name, data, counts, tags, firstText] of cases) {
    it(`${name}: hatched, focusable, arrows move, readings, tooltip and table`, () => {
      const { rec, handle, composition } = openRecorded({ ...BASE, data });
      const c = rec.committed!;
      expect(c.ready).toBe(true);
      const m = matrix(c);
      expect([m.valueCount, m.missingCount, m.invalidCount]).toEqual([0, counts.missing, counts.invalid]);
      // The frame keeps its states and NaN values; only the view's kind says "draw every cell".
      expect(c.view.kind).toBe('bar');
      const series = (c.view as AlignedView).frame.series[0]!;
      expect(series.slot).toBe(m.state);
      expect([...series.slot].every(s => s === SLOT_NULL || s === SLOT_INVALID)).toBe(true);
      expect([...m.values].every(v => Number.isNaN(v))).toBe(true);
      expect(tagsOf(rec.commits.at(-1))).toEqual(tags);
      // Named as a heatmap, never a bar chart; the summary is truthful about the values.
      expect(c.reader.name).not.toMatch(/bar/i);
      expect(c.reader.summary).toMatch(/No cell has a value\./);
      expect(c.reader.summary).not.toMatch(/Colors (run|diverge)/);
      const t = interactive(rec, composition);
      t.focus();
      expect(t.reading()).toBe(`r r0 (row 1 of 2), c c0 (column 1 of 3), ${firstText}. Cell 1 of 6.`);
      t.key('ArrowRight');
      expect(t.reading()).toMatch(/^r r0 \(row 1 of 2\), c c1 \(column 2 of 3\), .*\. Cell 2 of 6\.$/);
      t.key('ArrowDown');
      expect(t.reading()).toMatch(/^r r1 \(row 2 of 2\), c c1 \(column 2 of 3\), .*\. Cell 5 of 6\.$/);
      t.key('ArrowDown');
      expect(t.reading()).toMatch(/Cell 5 of 6\.$/);
      const layout = rec.committed!.layout;
      if (layout.kind !== 'plot') throw new Error('no plot');
      t.hover(layout.plot.x + layout.plot.width / 6, layout.plot.y + layout.plot.height / 4);
      expect(t.tooltip()).toBe(`r0, c0 | v ${firstText}`);
      // The bar has no scale to show, only the swatches.
      expect(t.legend()!.querySelectorAll('.axylo-heatmap-bar-fill')).toHaveLength(0);
      expect(t.legend()!.querySelectorAll('.axylo-heatmap-swatch-label').map(e => e.textContent))
        .toEqual([...(counts.missing ? ['No data'] : []), ...(counts.invalid ? ['Invalid value'] : [])]);
      const table = heatmapInternals(handle)!.table()!;
      expect(table.headers).toEqual(['r', 'c0', 'c1', 'c2']);
      expect(table.row(0)![1]).toBe(firstText);
      expect(heatmapInternals(handle)!.legend()!.stops).toEqual([]);
      t.interaction.destroy();
    });
  }

  it('empty data stays in its fallback; it becomes ready with missing-only cells and goes back', () => {
    const { rec, handle, composition } = openRecorded({ ...BASE, data: [] });
    expect(rec.committed?.ready ?? false).toBe(false);
    expect(heatmapInternals(handle)!.legend()).toBeNull();
    const t = interactive(rec, composition);
    // The slot is kept while the legend option is on; not ready, it is not seen (and takes no room).
    expect(t.shownLegend()).toBeNull();
    handle.update({ data: grid(1, 2, () => null) });
    rec.frames();
    t.show(rec.committed!);
    expect(rec.committed!.ready).toBe(true);
    expect(rec.committed!.view.kind).toBe('bar');
    expect(t.shownLegend()?.querySelectorAll('.axylo-heatmap-swatch-label').map(e => e.textContent)).toEqual(['No data']);
    t.focus();
    expect(t.reading()).toBe('r r0 (row 1 of 1), c c0 (column 1 of 2), No data. Cell 1 of 2.');
    expect(heatmapInternals(handle)!.legend()!.missing).toBe('No data');
    // A first value makes it an ordinary (line-kind) heatmap again.
    handle.update({ data: grid(1, 2, (_r, c) => (c ? 3 : null)) });
    rec.frames();
    t.show(rec.committed!);
    expect(rec.committed!.view.kind).toBe('line');
    expect(rec.committed!.ready).toBe(true);
    handle.update({ data: [] });
    rec.frames();
    t.show(rec.committed!);
    expect(rec.committed!.ready).toBe(false);
    expect(t.shownLegend()).toBeNull();
    expect(heatmapInternals(handle)!.legend()).toBeNull();
    t.interaction.destroy();
  });

  it('typed-column NaN is missing (SLOT_NULL); a row\'s NaN and infinities are invalid', () => {
    const typed = openRecorded({ ...BASE, data: { columns: { r: ['a', 'a', 'a'], c: ['x', 'y', 'z'], v: new Float64Array([NaN, Infinity, -Infinity]) } } });
    const tm = matrix(typed.rec.committed!);
    expect([...tm.state]).toEqual([SLOT_NULL, SLOT_INVALID, SLOT_INVALID]);
    expect(typed.rec.committed!.ready).toBe(true);
    const rows = openRecorded({ ...BASE, data: [{ r: 'a', c: 'x', v: NaN }, { r: 'a', c: 'y', v: null }] });
    expect([...matrix(rows.rec.committed!).state]).toEqual([SLOT_INVALID, SLOT_NULL]);
    expect(rows.rec.committed!.ready).toBe(true);
  });
});

describe('summary claims follow what the chart offers', () => {
  it('names no hue, and drops the table and focus claims when they are unavailable', () => {
    for (const scheme of ['sequential', 'diverging'] as const) {
      const { rec, handle } = openRecorded({ ...BASE, data: grid(2, 2, (r, c) => r * 2 + c - 1), color: { scheme } });
      const summary = () => rec.committed!.reader.summary;
      expect(summary()).not.toMatch(/blue|red|dark|light|green|yellow|purple/i);
      expect(summary()).toMatch(/read when it is focused, and every value is in the table\./);
      handle.update({ table: false });
      rec.frames();
      expect(summary()).toMatch(/Color shows an approximate range only: each cell's exact value is read when it is focused\./);
      expect(summary()).not.toMatch(/table/);
    }
  });
});

describe('blocker 3: export hooks follow the last drawn revision', () => {
  it('table() is the committed reader\'s table and follows table: false / true; legend() follows legend: false / on', () => {
    const { rec, handle, composition } = openRecorded({ ...BASE, data: grid(2, 2, (r, c) => r * 2 + c) });
    const x = heatmapInternals(handle)!;
    const t = interactive(rec, composition);
    expect(x.table()).toBe(rec.committed!.reader.table);
    handle.update({ table: false });
    rec.frames();
    expect(rec.committed!.reader.table).toBeNull();
    expect(x.table()).toBeNull();
    handle.update({ table: true, data: grid(2, 2, () => 7) });
    rec.frames();
    expect(x.table()).toBe(rec.committed!.reader.table);
    expect(x.table()!.row(0)).toEqual(['r0', '7', '7']);
    t.show(rec.committed!);
    // Visible bar and export agree.
    expect(t.ticks()).toEqual(x.legend()!.ticks.map(k => k.label));
    handle.update({ legend: false });
    rec.frames();
    t.show(rec.committed!);
    expect(t.legend()).toBeNull();
    expect(x.legend()).toBeNull();
    handle.update({ legend: 'top', data: grid(2, 2, (r, c) => r * 2 + c) });
    rec.frames();
    t.show(rec.committed!);
    expect(x.legend()!.ticks.map(k => k.label)).toEqual(['0', '1.5', '3']);
    expect(t.ticks()).toEqual(['0', '1.5', '3']);
    t.interaction.destroy();
  });

  it('an update not yet drawn, a strict rejection and a loading state never leak into export', () => {
    const { rec, handle } = openRecorded({ ...BASE, strict: true, data: grid(1, 2, (_r, c) => c) });
    const x = heatmapInternals(handle)!;
    const table = x.table(), legend = x.legend();
    handle.update({ data: grid(1, 2, (_r, c) => c * 100) });
    // Accepted but not drawn yet: export still answers for the revision on the page.
    expect(x.table()).toBe(table);
    expect(x.legend()).toBe(legend);
    rec.frames();
    expect(x.table()!.row(0)).toEqual(['r0', '0', '100']);
    const drawn = x.table();
    expect(() => handle.update({ data: grid(1, 2, () => Infinity) })).toThrow(StrictError);
    rec.frames();
    expect(x.table()).toBe(drawn);
    handle.update({ state: 'loading' });
    rec.frames();
    expect(rec.committed!.ready).toBe(false);
    expect(x.legend()).toBeNull();
    handle.update({ state: undefined });
    rec.frames();
    expect(x.legend()!.ticks.map(k => k.label)).toEqual(['0', '50', '100']);
  });

  it('after destroy both hooks answer null and keep nothing of the chart', () => {
    const { handle } = openRecorded({ ...BASE, data: grid(1, 2, (_r, c) => c) });
    const x = heatmapInternals(handle)!;
    expect(x.table()).not.toBeNull();
    expect(x.legend()).not.toBeNull();
    handle.destroy();
    expect(x.table()).toBeNull();
    expect(x.legend()).toBeNull();
  });

  it('a value formatter that replaces the chart\'s data while it formats: export follows the revision drawn last', () => {
    let replaced = false;
    let handleRef: ReturnType<typeof openRecorded>['handle'] | null = null;
    const format = (v: number) => {
      if (!replaced && handleRef) {
        replaced = true;
        handleRef.update({ data: grid(1, 2, (_r, c) => c * 10 + 1) });
      }
      return `${v} u`;
    };
    const { rec, handle, composition } = openRecorded({ ...BASE, data: grid(1, 2, (_r, c) => c), value: { field: 'v', format } });
    handleRef = handle;
    const x = heatmapInternals(handle)!;
    const t = interactive(rec, composition);
    // The first reading formats; the formatter supersedes the frame it is formatting.
    x.table()!.row(0);
    t.focus();
    rec.frames();
    t.show(rec.committed!);
    expect(replaced).toBe(true);
    expect(x.table()).toBe(rec.committed!.reader.table);
    expect(x.table()!.row(0)).toEqual(['r0', '1 u', '11 u']);
    expect(x.legend()!.ticks.map(k => k.label)).toEqual(['1 u', '6 u', '11 u']);
    expect(t.ticks()).toEqual(['1 u', '6 u', '11 u']);
    t.interaction.destroy();
  });
});

describe('the bar view of a value-less matrix has no bar findings', () => {
  it('a dense all-missing matrix (more cells than plot pixels) reports no AX132, to the handle or onDiagnostic', () => {
    const seen: string[] = [];
    const { rec, handle } = openRecorded({ ...BASE, data: grid(30, 40, () => null), onDiagnostic: (d: { code: string }) => { seen.push(d.code); } });
    expect(rec.committed!.ready).toBe(true);
    const layout = rec.committed!.layout;
    if (layout.kind !== 'plot') throw new Error('no plot');
    // The controller's AX132 condition holds (1200 cells > plot width): only the wrapper keeps it out.
    expect(30 * 40).toBeGreaterThan(layout.plot.width);
    rec.frames();
    expect(handle.diagnostics.map(d => d.code)).not.toContain('AX132');
    expect(seen).not.toContain('AX132');
  });
});

describe('summary without table and without focus readings', () => {
  it('claims neither when neither is offered (a compact chart has no focus readings)', async () => {
    const { heatmapSummary } = await import('../../../src/spatial/heatmap/reader');
    const s = stage({ data: grid(1, 2, (_r, c) => c) });
    expect(heatmapSummary(s.m, s.formatters, false, false).at(-1)).toBe('Color shows an approximate range only.');
    expect(heatmapSummary(s.m, s.formatters, true, false).at(-1)).toBe('Color shows an approximate range only: every value is in the table.');
    expect(heatmapSummary(s.m, s.formatters, false, true).at(-1)).toBe('Color shows an approximate range only: each cell\'s exact value is read when it is focused.');
  });
});
