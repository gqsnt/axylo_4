/**
 * A weekly series stacked with a daily one (the matrix re-merge's question, decided by the owner on 2026-11-18).
 *
 * The rows (docs/02-product-spec.md):
 * - F10: "A component is missing whenever its series has no value at that x, whatever the reason: a null, an
 *   absent step, or a series that simply has no row there (a weekly series stacked with a daily one is
 *   incomplete on the days between its rows)". A missing component "is drawn with zero height and the stack is
 *   marked incomplete in tooltip, table and announcements". "A stacked series' line follows its band, so
 *   inside a stack it is not joined across such a slot."
 * - F5: a slot a series merely has no row for "does not break its line, except inside a stack (F10)".
 * - F2: "A missing bar shows a 'no data' mark at the baseline, distinct from a zero bar; a slot a series merely
 *   has no row for gets no bar and no mark." Tooltip, table and announcements say "No data" for a missing
 *   value; a series with no row there reads "No observation".
 */
import { describe, expect, it } from 'vitest';
import { SLOT_NO_ROW, SLOT_NULL, type Layout, type Mark, type Projection, type RectMark, type View } from '../../src/core/contracts';
import { buildScene } from '../../src/scene';
import { buildLookup } from '../../src/lookup';
import { buildReader } from '../../src/reader';
import { defaultMessages } from '../../src/messages';
import { createFormatters } from '../../src/format';
import { linearScale } from '../../src/scale';
import { aligned } from './fixtures';

// Days 0 to 14; the daily series D is 10 + day, the weekly series W is 100 on days 0, 7 and 14. Day 7 of D is
// an explicit null (W has its value there), the control case.
const days = Array.from({ length: 15 }, (_, day) => day);
const rows = [
  ...days.filter(day => day % 7 === 0).map(day => ({ day, s: 'W', v: 100 })),
  ...days.map(day => ({ day, s: 'D', v: day === 7 ? null : 10 + day })),
];
const plot = { x: 0, y: 0, width: 280, height: 200 };

function layoutFor(view: View): Layout {
  const fit = { remedies: [], hidden: 0 } as const;
  const value = linearScale((view as { yDomain: readonly [number, number] }).yDomain, [plot.height, 0]);
  const projection: Projection = view.kind === 'bar'
    ? { kind: 'bands', horizontal: false, band: linearScale([-0.5, 14.5], [0, plot.width]), value }
    : { kind: 'xy', x: linearScale([0, 14], [0, plot.width]), y: value };
  return { kind: 'plot', width: plot.width, height: plot.height, plot, projection, xTicks: [], yTicks: [], texts: [], fit: { x: fit, y: fit } };
}

function build(kind: 'area' | 'bar') {
  const { view } = aligned({ data: rows, x: { field: 'day', type: 'number' }, y: 'v', series: 's' }, { kind, stacked: true });
  const layout = layoutFor(view);
  const formatters = createFormatters({
    series: view.frame.series.map(s => ({ field: s.field, unit: s.unit, scale: s.valueScale })),
    x: { field: 'day', kind: 'number', unit: null, timeZone: null, dateUnit: null, categories: null },
    messages: defaultMessages,
  }, { locale: 'en-US', timeZone: 'UTC' });
  const lookup = buildLookup(view, layout, formatters, defaultMessages);
  const reader = buildReader({ view, formatters, messages: defaultMessages, type: kind, locale: 'en-US' });
  return { view, layout, scene: buildScene(view, layout, 1), lookup, reader };
}

const slotOf = (day: number) => day; // x positions are the days, one slot each
const weekly = (view: ReturnType<typeof build>['view']) => view.frame.series.findIndex(s => s.key === 'W');
const daily = (view: ReturnType<typeof build>['view']) => view.frame.series.findIndex(s => s.key === 'D');

describe.each(['area', 'bar'] as const)('stacked %s: a weekly series beside a daily one', kind => {
  it('the frame says what each slot is: no row for W on the days between, an explicit null for D on day 7', () => {
    const { view } = build(kind);
    expect(view.frame.series[weekly(view)]!.slot[slotOf(3)]).toBe(SLOT_NO_ROW);
    expect(view.frame.series[daily(view)]!.slot[slotOf(7)]).toBe(SLOT_NULL);
  });

  it('a day W has no row for is an incomplete stack; the total is of what is there, qualified (F10)', () => {
    const { view, lookup, reader } = build(kind);
    for (const day of [3, 10]) {
      expect(view.stack?.incomplete?.[slotOf(day)], `day ${day}`).toBe(1);
      const tooltip = lookup.tooltip({ kind: 'x', x: day });
      expect(tooltip.total, `day ${day}`).toBe(`${10 + day} (incomplete)`);
      expect(tooltip.rows.find(row => row.seriesLabel === 'W')?.value).toBe('No observation');
      expect(reader.table!.row(day)![0]).toBe(`${day} (incomplete)`);
    }
    // Where both have values the stack is whole: day 14, 100 + 24.
    expect(view.stack?.incomplete?.[slotOf(14)]).toBe(0);
    expect(lookup.tooltip({ kind: 'x', x: 14 }).total).toBe('124');
  });

  it('an explicit null stays a missing component: the stack is incomplete there', () => {
    const { view, lookup, reader } = build(kind);
    expect(view.stack?.incomplete?.[slotOf(7)]).toBe(1);
    // Day 7: W is 100 and D is null, so the total is W's alone, qualified.
    expect(lookup.tooltip({ kind: 'x', x: 7 }).total).toBe('100 (incomplete)');
    expect(reader.table!.row(7)![0]).toBe('7 (incomplete)');
  });
});

const marks = <T extends Mark['type']>(scene: { marks: readonly Mark[] }, type: T, series: number) =>
  scene.marks.filter((mark): mark is Extract<Mark, { type: T }> => mark.type === type && 'series' in mark && mark.series === series);

describe('stacked area geometry at the days the weekly series has no row', () => {
  // A polyline's y at x, or NaN where it has no segment over x (a pen lift is a NaN pair).
  function at(xy: Float32Array, x: number): number {
    for (let i = 0; i + 3 < xy.length; i += 2) {
      const [x0, y0, x1, y1] = [xy[i]!, xy[i + 1]!, xy[i + 2]!, xy[i + 3]!];
      if ([x0, y0, x1, y1].some(Number.isNaN)) continue;
      if (x >= Math.min(x0, x1) - 1e-3 && x <= Math.max(x0, x1) + 1e-3) return x1 === x0 ? Math.min(y0, y1) : y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
    return NaN;
  }

  it('the weekly band has zero height between its rows, and its line follows the band: not joined there', () => {
    const { view, layout, scene } = build('area');
    if (layout.kind !== 'plot' || layout.projection.kind !== 'xy') throw new Error('Expected an xy plot');
    const { x, y } = layout.projection;
    const w = weekly(view);
    // W is the bottom of the stack (series order puts it first), 100 on days 0, 7 and 14.
    expect(view.stack!.order[0]).toBe(w);
    const band = marks(scene, 'area', w)[0]!;
    const lines = marks(scene, 'path', w).filter(path => path.dash === view.cues[w]!.dash && path.strokeWidth === 2);
    for (const day of [1, 3, 6, 8, 12]) {
      // Zero height: the band's top is its bottom, the baseline (F10).
      expect(at(band.upper, x.map(day)), `fill, day ${day}`).toBeCloseTo(y.map(0), 3);
      // The line is not drawn across the day at its value (F5 inside a stack, F10).
      for (const line of lines) expect(at(line.xy, x.map(day)), `line, day ${day}`).not.toBeCloseTo(y.map(100), 3);
    }
    // Days 0, 7 and 14 are each a value between two missing components: visible points (F2).
    const shown = marks(scene, 'points', w).flatMap(mark => Array.from({ length: mark.xy.length / 2 }, (_, i) => Math.round(mark.xy[2 * i]!)));
    for (const day of [0, 7, 14]) expect(shown).toContain(Math.round(x.map(day)));
  });
});

describe('a bar for a slot its series has no row for (F2)', () => {
  it.each([true, false])('stacked %s: no bar and no "no data" mark where W has no row; the mark stays for D\'s null', stacked => {
    const { view } = aligned({ data: rows, x: { field: 'day', type: 'number' }, y: 'v', series: 's' }, { kind: 'bar', stacked });
    const scene = buildScene(view, layoutFor(view), 1);
    const count = (list: RectMark[]) => list.reduce((n, mark) => n + mark.xywh.length / 4, 0);
    const w = weekly(view);
    const d = daily(view);
    const variant = (series: number, kind: RectMark['variant']) => count(marks(scene, 'rects', series).filter(mark => mark.variant === kind));
    // W: three bars (days 0, 7, 14), nothing on the twelve days between.
    expect(variant(w, 'bar')).toBe(3);
    expect(variant(w, 'missing')).toBe(0);
    // D: fourteen bars and the "no data" mark for its null on day 7.
    expect(variant(d, 'bar')).toBe(14);
    expect(variant(d, 'missing')).toBe(1);
  });
});

describe('outside a stack, a no-row slot still joins (F5)', () => {
  it.each(['line', 'area'] as const)('unstacked %s: the weekly line is one segment from day 0 to day 7 at its value', kind => {
    const { view } = aligned({ data: rows, x: { field: 'day', type: 'number' }, y: 'v', series: 's' }, { kind });
    const layout = layoutFor(view);
    if (layout.kind !== 'plot' || layout.projection.kind !== 'xy') throw new Error('Expected an xy plot');
    const { x, y } = layout.projection;
    const w = weekly(view);
    const line = marks(buildScene(view, layout, 1), 'path', w).find(path => path.strokeWidth === 2)!;
    expect(Array.from(line.xy).some(Number.isNaN)).toBe(false);
    expect(Array.from(line.xy)).toEqual([0, 7, 14].flatMap(day => [Math.fround(x.map(day)), Math.fround(y.map(100))]));
  });
});
