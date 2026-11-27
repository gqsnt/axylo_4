/**
 * N8b size validation, strict rollback, recovery and keyboard reach (repair after cross-provider review).
 *
 * Rules under test (stated, not read off a run):
 *  - a NaN size is an AX187 omission whether it comes from a row or a typed column, and its row stays in the
 *    table;
 *  - the size setting is required: absent, reset, not a field name, or naming a field no row has is AX150 for
 *    `size` with the chart-error outcome, raised by the call that set it (so strict rejects it synchronously),
 *    cleared by the call that fixes it, never a retained AX101; validateBubble says the same as a created chart;
 *  - the keyboard visits drawn bubbles only, never strands focus, and the table keeps every source row.
 */
import { describe, expect, it } from 'vitest';
import { controllerFor, type Controller } from '../../../src/core/controller';
import type { Composition } from '../../../src/core/composition';
import type { ControllerCore } from '../../../src/core/controller-types';
import type { DatumRef, PointFrame, Scene, ScatterView } from '../../../src/core/contracts';
import { StrictError } from '../../../src/core/delivery';
import type { Committed } from '../../../src/dom/interaction';
import { openBubbleChart, validateBubble } from '../../../src/spatial/bubble';
import type { BubbleMark } from '../../../src/spatial/bubble/composition';
import { sizeChannel } from '../../../src/spatial/bubble/geometry';
import { bubbleInternals } from '../../../src/spatial/bubble';
import { record } from '../../finance/host';

const CHART_ERROR = 'The chart shows its error state.';

function open(options: Record<string, unknown>) {
  const rec = record({ width: 720, height: 420 });
  let controller: Controller | null = null;
  let composition: Composition | null = null;
  const chart = openBubbleChart({ title: 'Bubbles', ...options }, (c, input) => {
    composition = c;
    controller = controllerFor(c, input, rec.host, null);
    return controller.handle;
  });
  rec.frames();
  return { rec, chart, controller: () => controller!, composition: () => composition! };
}
const accepted = (c: Controller) => (c as unknown as Pick<ControllerCore, 'accepted'>).accepted;
const last = (rec: ReturnType<typeof record>): Committed => rec.committed!;
const lastScene = (rec: ReturnType<typeof record>): Scene => rec.draws[rec.draws.length - 1]!;
const drawnCount = (scene: Scene) => {
  const mark = scene.marks.find((m): m is BubbleMark => m.type === 'points' && 'bubble' in m);
  return mark ? mark.bubble.geometry.count : 0;
};
const sizeFindings = (list: readonly { code: string; field?: string; message: string }[]) =>
  list.filter(d => d.field === 'size').map(d => `${d.code}${d.message.endsWith(CHART_ERROR) ? ':chart-error' : ''}`);
const rowsOf = (refs: (DatumRef | null)[]) => refs.map(r => (r && r.kind === 'point' ? r.row : null));

const rows = [{ x: 1, y: 1, s: 4, t: 2 }, { x: 2, y: 2, s: 16, t: 8 }, { x: 3, y: 3, s: 1, t: 1 }];

describe('typed-column NaN is an AX187 omission', () => {
  it('non-strict: counted with its source row, not drawn, kept in the table and the export table', () => {
    const columns = { x: Float64Array.of(1, 2, 3, 4), y: Float64Array.of(1, 2, 3, 4), s: Float64Array.of(1, NaN, 3, NaN) };
    const found = validateBubble({ title: 't', data: { columns }, x: 'x', y: 'y', size: 's' } as never);
    expect(found.filter(d => d.code === 'AX187')).toMatchObject([{ level: 'warning', count: 2, rows: [1, 3], field: 's' }]);
    const { rec, chart } = open({ data: { columns }, x: 'x', y: 'y', size: 's' });
    expect(chart.diagnostics.filter(d => d.code === 'AX187')).toMatchObject([{ count: 2, rows: [1, 3] }]);
    expect(drawnCount(lastScene(rec))).toBe(2);
    const table = last(rec).reader.table!;
    expect(table.rowCount).toBe(4);
    expect(table.row(1)![0]).toBe('2');
    expect(bubbleInternals(chart)!.table!.rowCount).toBe(4);
    expect(last(rec).reader.note).not.toBeNull();
  });

  it('strict: a create with a NaN typed size is rejected; an update to one is rejected and keeps the committed state', () => {
    const bad = { x: Float64Array.of(1, 2, 3), y: Float64Array.of(1, 2, 3), s: Float64Array.of(1, NaN, 3) };
    expect(() => open({ data: { columns: bad }, x: 'x', y: 'y', size: 's', strict: true })).toThrow(StrictError);
    const good = { x: Float64Array.of(1, 2, 3), y: Float64Array.of(1, 2, 3), s: Float64Array.of(1, 2, 3), n: Float64Array.of(1, NaN, 3) };
    const { rec, chart, controller } = open({ data: { columns: good }, x: 'x', y: 'y', size: 's', strict: true });
    const committed = accepted(controller());
    let error: unknown;
    try { chart.update({ size: 'n' } as never); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(StrictError);
    expect((error as StrictError).diagnostics.filter(d => d.code === 'AX187')).toMatchObject([{ count: 1, rows: [1] }]);
    expect(accepted(controller())).toBe(committed);
    rec.frames();
    expect(drawnCount(lastScene(rec))).toBe(3);
    expect(chart.diagnostics.filter(d => d.code === 'AX187')).toEqual([]);
  });
});

describe('the required size setting', () => {
  const variants: [string, Record<string, unknown>][] = [
    ['absent', {}],
    ['null', { size: null }],
    ['a number', { size: 42 }],
    ['an object without field', { size: { label: 'Size' } }],
    ['an empty name', { size: '' }],
    ['a field no row has', { size: 'nope' }],
    ['a field no typed column has', { size: 'nope', data: { columns: { x: Float64Array.of(1), y: Float64Array.of(1), s: Float64Array.of(1) } } }],
  ];
  for (const [name, patch] of variants) {
    it(`${name}: one AX150 for size with the chart-error outcome, the same from validateBubble and a created chart`, () => {
      const options = { title: 'Bubbles', data: rows, x: 'x', y: 'y', ...patch };
      const validated = validateBubble(options as never);
      expect(sizeFindings(validated)).toEqual(['AX150:chart-error']);
      expect(validated.filter(d => d.code === 'AX101' || d.code === 'AX102')).toEqual([]);
      const { rec, chart } = open(options);
      expect(chart.diagnostics.map(d => [d.code, d.level, d.field, d.message])).toEqual(validated.map(d => [d.code, d.level, d.field, d.message]));
      expect(last(rec).ready).toBe(false);
      expect(() => open({ ...options, strict: true })).toThrow(StrictError);
    });
  }

  it('strict: a reset, an invalid value or a missing field is rejected synchronously; a correct setting is then accepted', () => {
    const { rec, chart, controller } = open({ data: rows, x: 'x', y: 'y', size: 's', strict: true });
    const committed = accepted(controller());
    for (const patch of [{ size: undefined }, { size: null }, { size: 42 }, { size: 'nope' }, { size: { field: 'nope' } }]) {
      let error: unknown;
      try { chart.update(patch as never); } catch (e) { error = e; }
      expect(error, JSON.stringify(patch)).toBeInstanceOf(StrictError);
      expect(sizeFindings((error as StrictError).diagnostics)).toEqual(['AX150:chart-error']);
      expect(accepted(controller())).toBe(committed);
      expect(sizeFindings(chart.diagnostics)).toEqual([]);
    }
    rec.frames();
    expect(drawnCount(lastScene(rec))).toBe(3);
    chart.update({ size: 't' } as never);
    rec.frames();
    expect(accepted(controller())).not.toBe(committed);
    expect(chart.diagnostics).toEqual([]);
    expect(last(rec).reader.table!.headers.at(-1)).toBe('t');
  });

  it('non-strict: a reset shows the error state; the fix recovers drawing, zoom and the table, with no AX101 left behind', () => {
    const { rec, chart } = open({ data: rows, x: 'x', y: 'y', size: 's' });
    chart.update({ size: undefined } as never);
    rec.frames();
    expect(sizeFindings(chart.diagnostics)).toEqual(['AX150:chart-error']);
    expect(last(rec).ready).toBe(false);
    // A data call while the setting is wrong: still the one finding.
    chart.update({ data: [...rows, { x: 4, y: 4, s: 9, t: 3 }] } as never);
    rec.frames();
    expect(sizeFindings(chart.diagnostics)).toEqual(['AX150:chart-error']);
    chart.update({ size: 's' } as never);
    rec.frames();
    expect(chart.diagnostics).toEqual([]);
    expect(last(rec).ready).toBe(true);
    expect(drawnCount(lastScene(rec))).toBe(4);
    chart.zoom([0, 2.5]);
    rec.frames();
    // Zoom works again: the bubbles drawn are the points of the window, fewer than all four.
    const zoomed = last(rec).view as ScatterView;
    const inWindow = zoomed.visiblePoints.reduce((n, r) => n + r.end - r.start, 0);
    expect(last(rec).zoomed).toBe(true);
    expect(inWindow).toBeLessThan(4);
    expect(drawnCount(lastScene(rec))).toBe(inWindow);
    // The table follows the zoom window, as scatter's does; with the zoom reset it holds every row again.
    expect(last(rec).reader.table!.rowCount).toBe(inWindow);
    chart.zoom(null);
    rec.frames();
    const table = last(rec).reader.table!;
    expect(table.rowCount).toBe(4);
    expect(table.headers.at(-1)).toBe('s');
    expect(table.row(3)!.at(-1)).toBe('9');
  });
});

describe('keyboard reach over undrawn sizes', () => {
  // x order: rows 0..5. Sizes: drawn, negative (AX187), null, drawn, NaN (AX187), drawn.
  const data = [
    { x: 1, y: 1, s: 4 }, { x: 2, y: 1, s: -1 }, { x: 3, y: 1, s: null }, { x: 4, y: 1, s: 9 }, { x: 5, y: 1, s: NaN }, { x: 6, y: 1, s: 1 },
  ];

  it('steps, edges, pages, count and ordinals visit drawn bubbles only; the table keeps all six rows', () => {
    const { rec } = open({ data, x: 'x', y: 'y', size: 's' });
    const { lookup } = last(rec);
    const first = lookup.step(null, 'next');
    const second = lookup.step(first, 'next');
    const third = lookup.step(second, 'next');
    expect(rowsOf([first, second, third, lookup.step(third, 'next')])).toEqual([0, 3, 5, null]);
    expect(rowsOf([lookup.step(third, 'previous'), lookup.step(first, 'previous')])).toEqual([3, null]);
    expect(rowsOf([lookup.step(first, 'last'), lookup.step(third, 'first'), lookup.step(third, 'last')])).toEqual([5, 0, null]);
    expect(lookup.count).toBe(3);
    expect([first, second, third].map(r => lookup.ordinal(r!))).toEqual([0, 1, 2]);
    expect(last(rec).reader.table!.rowCount).toBe(6);
  });

  it('focus on a point that has no bubble (or loses it) resolves to the nearest drawn one, never nothing', () => {
    const { rec, chart } = open({ data, x: 'x', y: 'y', size: 's' });
    const { lookup } = last(rec);
    const undrawn = (row: number): DatumRef => ({ kind: 'point', seriesKey: 'y', row, x: data[row]!.x });
    expect(rowsOf([lookup.resolve(undrawn(1)), lookup.resolve(undrawn(2)), lookup.resolve(undrawn(4))])).toEqual([3, 3, 5]);
    expect(rowsOf([lookup.step(undrawn(1), 'next'), lookup.step(undrawn(4), 'previous')])).toEqual([5, 3]);
    // Every size of the later rows becomes undrawn: focus there moves back to the last drawn bubble.
    chart.update({ data: data.map((r, i) => (i >= 3 ? { ...r, s: -1 } : r)) } as never);
    rec.frames();
    const after = last(rec).lookup;
    expect(rowsOf([after.resolve(undrawn(5)), after.step(undrawn(5), 'next'), after.step(null, 'next')])).toEqual([0, null, 0]);
    // No drawn bubble at all: nothing to focus, and stepping says so instead of landing on an undrawn point.
    chart.update({ data: data.map(r => ({ ...r, s: -1 })) } as never);
    rec.frames();
    const none = last(rec).lookup;
    expect(rowsOf([none.step(null, 'next'), none.resolve(undrawn(0))])).toEqual([null, null]);
    expect(last(rec).reader.table!.rowCount).toBe(6);
  });

  it('single-series stepping (the interaction part) skips undrawn sizes the same way', () => {
    const { rec, composition } = open({ data, x: 'x', y: 'y', size: 's' });
    const step = composition().interaction.stepInSeries!;
    const view = last(rec).view as ScatterView;
    const at = (row: number): DatumRef => ({ kind: 'point', seriesKey: 'y', row, x: data[row]!.x });
    expect(rowsOf([step(view, at(0), 'next'), step(view, at(3), 'next'), step(view, at(5), 'next')])).toEqual([3, 5, null]);
    expect(rowsOf([step(view, at(5), 'previous'), step(view, at(0), 'last'), step(view, at(5), 'first')])).toEqual([3, 5, 0]);
  });
});

describe('size channel keyed by the PointFrame', () => {
  it('a shared-series clone of the frame aliases the same channel; another frame gets its own', () => {
    const { controller, chart } = open({ data: rows, x: 'x', y: 'y', size: 's' });
    const frame = accepted(controller())!.frame as PointFrame;
    const meta = bubbleInternals(chart)!.meta!;
    const channel = sizeChannel(frame, meta.sizes);
    expect(sizeChannel(frame, meta.sizes)).toBe(channel);
    const clone = { ...frame };
    expect(sizeChannel(clone, meta.sizes)).toBe(channel);
    const other = { ...frame, series: frame.series.map(s => ({ ...s })) };
    expect(sizeChannel(other, meta.sizes)).not.toBe(channel);
    expect(Array.from(sizeChannel(other, meta.sizes).values[0]!)).toEqual(Array.from(channel.values[0]!));
  });
});
