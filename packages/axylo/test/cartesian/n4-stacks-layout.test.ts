/**
 * N4 hardening of `axylo/cartesian` stacks, picking and the dual-axis layout.
 *
 * - Spec F10: mixed signs stack on their own sides of zero and the axis covers both totals; the readout total
 *   is the sum, or the positive and the negative total when signs are mixed; a missing component (null, or no
 *   row at that x) has zero height and marks the stack "incomplete" in the tooltip, the keyboard reading and the
 *   table; a stacked area's edge is not joined across a missing slot.
 * - RFC C4.1 §5.2: exact bar containment outranks a padded hit; hover, keyboard and table read the same datum.
 * - Spec L9 (with L8): the right axis collapses below 360 px of fitted plot width, with AX175 and a summary
 *   sentence, and comes back when the chart is wide again.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { SLOT_NO_ROW, type AlignedView, type AreaMark, type PathMark, type RectMark } from '../../src/core/contracts';
import { axisScaleOf } from '../../src/cartesian/scale-ref';
import { cartesianStacks } from '../../src/cartesian/stacks';
import { DUAL_AXIS_MIN_WIDTH } from '../../src/cartesian/layout';
import { finish, liftCount, prepare, run } from './n4-pipeline';

const rects = (scene: { marks: readonly { type: string }[] }, series: number) =>
  scene.marks.filter((m): m is RectMark => m.type === 'rects' && (m as RectMark).series === series);
const areas = (scene: { marks: readonly { type: string }[] }) => scene.marks.filter((m): m is AreaMark => m.type === 'area');

/** The view with series `s`' slot `i` turned into SLOT_NO_ROW (a series with no row at that x). */
function noRow(s: number, i: number) {
  return (view: AlignedView): AlignedView => ({
    ...view,
    frame: {
      ...view.frame,
      series: view.frame.series.map((series, k) => {
        if (k !== s) return series;
        const slot = series.slot.slice();
        const y = series.y.slice();
        slot[i] = SLOT_NO_ROW;
        y[i] = NaN;
        return { ...series, slot, y };
      }),
    },
  });
}

const stackedBars = (rows: readonly Record<string, number | null>[]) => ({
  title: 'Stack', data: rows, x: 'x', axes: { v: { position: 'left' } },
  layers: [{ type: 'bar', y: ['a', 'b'], yAxis: 'v', stacked: true }],
});

describe('N4 F10 stacked bars', () => {
  it('places mixed signs on their own sides of zero, covers both totals and reads them as two ends', () => {
    const res = run(stackedBars([{ x: 1, a: 10, b: -3 }, { x: 2, a: -5, b: 6 }, { x: 3, a: 4, b: 2 }]));
    if (res.layout.kind !== 'plot') throw new Error('expected a plot');
    const [lo, hi] = res.view.yDomains![0]!;
    expect(lo).toBeLessThanOrEqual(-5);
    expect(hi).toBeGreaterThanOrEqual(10);
    const y = axisScaleOf(res.layout.projection, 0);
    const zero = y.map(0);
    const [a] = rects(res.scene, 0);
    const [b] = rects(res.scene, 1);
    // x = 1: a goes up from zero to 10, b down from zero to -3 (not from a's top).
    expect(a!.xywh[1]! + a!.xywh[3]!).toBeCloseTo(zero, 3);
    expect(a!.xywh[1]).toBeCloseTo(y.map(10), 3);
    expect(b!.xywh[1]).toBeCloseTo(zero, 3);
    expect(b!.xywh[1]! + b!.xywh[3]!).toBeCloseTo(y.map(-3), 3);
    // x = 2: a is negative, so b starts at zero on the positive side.
    expect(b!.xywh[5]! + b!.xywh[7]!).toBeCloseTo(zero, 3);
    const f = res.formatters;
    expect(res.lookup.tooltip({ kind: 'x', x: 1 }).total).toBe(`${f.value(0, 10)} and ${f.value(0, -3)}`);
    expect(res.lookup.tooltip({ kind: 'x', x: 3 }).total).toBe(f.value(0, 6));
  });

  it('draws a null component with zero height and marks the stack incomplete in tooltip, keyboard reading and table', () => {
    const res = run(stackedBars([{ x: 1, a: 5, b: 3 }, { x: 2, a: null, b: 4 }, { x: 3, a: 2, b: 1 }]));
    if (res.layout.kind !== 'plot') throw new Error('expected a plot');
    // a has no rectangle at x = 2; b's rectangle there starts at zero.
    expect(rects(res.scene, 0)[0]!.xywh.length).toBe(8);
    const y = axisScaleOf(res.layout.projection, 0);
    const b = rects(res.scene, 1)[0]!;
    expect(b.xywh[5]! + b.xywh[7]!).toBeCloseTo(y.map(0), 3);
    const tip = res.lookup.tooltip({ kind: 'x', x: 2 });
    expect(tip.total).toBe(`${res.formatters.value(0, 4)} (incomplete)`);
    expect(res.lookup.datum({ kind: 'aligned', seriesKey: res.frame.series[0]!.key, x: 2 })!.value).toContain('(incomplete)');
    // The value that is there is not qualified.
    expect(res.lookup.datum({ kind: 'aligned', seriesKey: res.frame.series[1]!.key, x: 2 })!.value).not.toContain('incomplete');
    expect(res.reader.table!.row(1)![0]).toContain('(incomplete)');
    expect(res.reader.table!.row(0)![0]).not.toContain('incomplete');
    expect(res.lookup.tooltip({ kind: 'x', x: 1 }).total).toBe(res.formatters.value(0, 8));
  });

  it('treats a slot with no row as a missing component too (owner decision 2026-11-18)', () => {
    const res = run(stackedBars([{ x: 1, a: 5, b: 3 }, { x: 2, a: 1, b: 4 }, { x: 3, a: 2, b: 1 }]), { edit: noRow(1, 2) });
    expect(res.lookup.tooltip({ kind: 'x', x: 3 }).total).toBe(`${res.formatters.value(0, 2)} (incomplete)`);
    expect(res.reader.table!.row(2)![0]).toContain('(incomplete)');
    expect(rects(res.scene, 1)[0]!.xywh.length).toBe(8);
  });

  it('property: for any signed stacks the stack totals are the per-side sums and the incomplete flags are the missing slots', () => {
    const cell = fc.oneof(fc.integer({ min: -50, max: 50 }), fc.constant(null));
    fc.assert(fc.property(fc.array(fc.tuple(cell, cell, cell), { minLength: 1, maxLength: 30 }), cells => {
      const rows = cells.map(([a, b, c], i) => ({ x: i + 1, a, b, c }));
      const res = run({
        title: 'P', data: rows, x: 'x', axes: { v: { position: 'left' } },
        layers: [{ type: 'bar', y: ['a', 'b', 'c'], yAxis: 'v', stacked: true }],
      });
      const stacks = cartesianStacks(res.view, res.stateRef.meta);
      const group = stacks.groups[0]!;
      rows.forEach((row, i) => {
        const values = [row.a, row.b, row.c];
        const pos = values.reduce<number>((s, v) => s + (v !== null && v >= 0 ? v : 0), 0);
        const neg = values.reduce<number>((s, v) => s + (v !== null && v < 0 ? v : 0), 0);
        expect(group.positive[2]![i]).toBe(pos);
        expect(group.negative[2]![i]).toBe(neg);
        expect(Boolean(stacks.incomplete?.[i])).toBe(values.some(v => v === null));
      });
      if (res.layout.kind === 'plot') {
        const [lo, hi] = res.view.yDomains![0]!;
        for (let i = 0; i < rows.length; i++) {
          expect(lo).toBeLessThanOrEqual(group.negative[2]![i]!);
          expect(hi).toBeGreaterThanOrEqual(group.positive[2]![i]!);
        }
      }
    }), { numRuns: 60 });
  });
});

describe('N4 F10 stacked areas', () => {
  it('draws each side of zero as its own band, so a mixed-sign stack never crosses zero', () => {
    const res = run({
      title: 'Areas', data: [{ x: 1, a: 5, b: 2 }, { x: 2, a: -4, b: 3 }, { x: 3, a: 3, b: -1 }], x: 'x',
      axes: { v: { position: 'left' } }, layers: [{ type: 'area', y: ['a', 'b'], yAxis: 'v', stacked: true }],
    });
    if (res.layout.kind !== 'plot') throw new Error('expected a plot');
    const zero = Math.fround(axisScaleOf(res.layout.projection, 0).map(0));
    const bands = areas(res.scene);
    expect(bands.length).toBe(4);
    for (const band of bands) {
      const ys = Array.from({ length: band.upper.length / 2 }, (_, j) => band.upper[2 * j + 1]!);
      const above = ys.every(v => v <= zero + 1e-3);
      const below = ys.every(v => v >= zero - 1e-3);
      expect(above || below).toBe(true);
    }
  });

  it('gives a missing component zero height and breaks its edge there', () => {
    const res = run({
      title: 'Areas', x: 'x', axes: { v: { position: 'left' } },
      data: [{ x: 1, a: 5, b: 2 }, { x: 2, a: 6, b: 2 }, { x: 3, a: null, b: 2 }, { x: 4, a: 3, b: 2 }, { x: 5, a: 4, b: 2 }],
      layers: [{ type: 'area', y: ['a', 'b'], yAxis: 'v', stacked: true }],
    });
    const band = areas(res.scene).find(m => m.series === 0)!;
    // Vertex of x = 3 (every vertex kept at this size; the range starts at slot 0).
    expect(band.upper[2 * 2 + 1]).toBe(band.lower[2 * 2 + 1]);
    const edge = res.scene.marks.find((m): m is PathMark => m.type === 'path' && (m as PathMark).series === 0)!;
    expect(liftCount(edge.xy)).toBe(1);
    expect(res.lookup.tooltip({ kind: 'x', x: 3 }).total).toContain('(incomplete)');
  });
});

describe('N4 grouped bars + line on two axes: one projection for drawing and picking', () => {
  const input = {
    title: 'Combo', x: 'x',
    data: [{ x: 1, orders: 40, returns: 10, ms: 20 }, { x: 2, orders: 60, returns: 55, ms: 400 }, { x: 3, orders: 50, returns: 20, ms: 90 }],
    axes: { count: { position: 'left' }, ms: { position: 'right', scale: 'log' } },
    layers: [{ type: 'bar', y: ['orders', 'returns'], yAxis: 'count' }, { type: 'line', y: 'ms', yAxis: 'ms' }],
  };

  it('prefers exact bar containment over an earlier padded hit, and anchors the datum on the drawn rectangle', () => {
    const res = run(input);
    if (res.layout.kind !== 'plot') throw new Error('expected a plot');
    const orders = rects(res.scene, 0)[0]!;
    // Slot x = 2 is the second rectangle of each series.
    const [ox, oy, ow, oh] = Array.from(orders.xywh.subarray(4, 8));
    // Inside orders, half a pixel from its right edge: within returns' 1 px pad, which is tested first.
    const px = ox! + ow! - 0.5;
    const py = oy! + oh! - 2;
    const lineY = axisScaleOf(res.layout.projection, 1).map(400);
    expect(Math.abs(lineY - py)).toBeGreaterThan(12);
    const target = res.lookup.pick(px, py)!;
    expect(target).toEqual({ kind: 'x', x: 2 });
    const primary = res.lookup.primary(target)!;
    expect(primary).toEqual({ kind: 'aligned', seriesKey: res.frame.series[0]!.key, x: 2 });
    const anchor = res.lookup.anchor(primary)!;
    expect(anchor.x).toBeCloseTo(ox!, 3);
    expect(anchor.y).toBeCloseTo(oy!, 3);
    expect(anchor.width).toBeCloseTo(ow!, 3);
    expect(anchor.height).toBeCloseTo(oh!, 3);
  });

  it('reads the same values for the same datum in hover, keyboard and table', () => {
    const res = run(input);
    const tip = res.lookup.tooltip({ kind: 'x', x: 2 });
    const row = res.reader.table!.row(1)!;
    tip.rows.forEach(r => {
      const datum = res.lookup.datum(r.ref)!;
      expect(datum.value).toBe(r.value);
      expect(row[r.seriesIndex + 1]).toBe(r.value);
    });
    // The line's anchor is its drawn vertex.
    if (res.layout.kind !== 'plot') throw new Error('expected a plot');
    const line = res.scene.marks.find((m): m is PathMark => m.type === 'path' && (m as PathMark).series === 2)!;
    const anchor = res.lookup.anchor({ kind: 'aligned', seriesKey: res.frame.series[2]!.key, x: 2 })!;
    expect(anchor.x + anchor.width / 2).toBeCloseTo(line.xy[2]!, 3);
    expect(anchor.y + anchor.height / 2).toBeCloseTo(line.xy[3]!, 3);
  });
});

describe('N4 L9 right-axis collapse and restore', () => {
  const dual = (rightLabel = 'Latency') => ({
    title: 'Dual', x: 'x',
    data: Array.from({ length: 24 }, (_, i) => ({ x: i, orders: 100 + i * 10, ms: 5 + i * 3 })),
    axes: { orders: { position: 'left', label: 'Orders' }, ms: { position: 'right', scale: 'log', label: rightLabel, unit: 'ms' } },
    layers: [{ type: 'bar', y: 'orders', yAxis: 'orders' }, { type: 'line', y: 'ms', yAxis: 'ms' }],
  });
  const codes = (d: readonly { code: string }[]) => d.map(x => x.code);

  it('collapses at 320 px and restores at 960 px, with AX175 and the summary sentence following', () => {
    const base = prepare(dual());
    const wide = finish(base, 960, 400);
    if (wide.layout.kind !== 'plot') throw new Error('expected a plot');
    expect(wide.layout.yTicksRight).toBeDefined();
    expect(codes(wide.layoutDiagnostics)).not.toContain('AX175');
    expect(wide.reader.summary).not.toContain('Secondary right axis');
    const narrow = finish(base, 320, 400);
    if (narrow.layout.kind !== 'plot') throw new Error('expected a plot');
    expect(narrow.layout.yTicksRight).toBeUndefined();
    expect(codes(narrow.layoutDiagnostics)).toContain('AX175');
    expect(narrow.reader.summary).toContain('Secondary right axis (Latency (ms))');
    const again = finish(base, 960, 400);
    if (again.layout.kind !== 'plot') throw new Error('expected a plot');
    expect(again.layout.yTicksRight).toBeDefined();
    expect(codes(again.layoutDiagnostics)).not.toContain('AX175');
    expect(again.reader.summary).not.toContain('Secondary right axis');
    expect(again.layout.plot).toEqual(wide.layout.plot);
  });

  it('near the threshold: the right axis is shown only when the fitted plot is at least 360 px wide, and stays shown above', () => {
    const base = prepare(dual());
    let shownAt = Infinity;
    for (let width = 360; width <= 560; width += 4) {
      const res = finish(base, width, 300);
      if (res.layout.kind !== 'plot') throw new Error(`expected a plot at ${width}`);
      const shown = res.layout.yTicksRight !== undefined;
      if (shown) {
        expect(res.layout.plot.width).toBeGreaterThanOrEqual(DUAL_AXIS_MIN_WIDTH);
        shownAt = Math.min(shownAt, width);
      } else {
        expect(width).toBeLessThan(shownAt);
        expect(codes(res.layoutDiagnostics)).toContain('AX175');
      }
    }
    expect(shownAt).toBeLessThan(560);
  });

  it('collapses the right axis instead of falling back to too-small when only its title cannot fit (L9 before L8)', () => {
    // A short plot wraps a many-word right title into many lines: its gutter alone would leave no readable plot.
    const res = run(dual('Latency of the slowest request '.repeat(12).trim()), { width: 420, height: 150 });
    expect(res.layout.kind).toBe('plot');
    if (res.layout.kind !== 'plot') return;
    expect(res.layout.yTicksRight).toBeUndefined();
    expect(codes(res.layoutDiagnostics)).toContain('AX175');
  });

  it('recovers from too-small to the full dual-axis plot, and keeps right tick labels clear of each other and of the plot', () => {
    const base = prepare(dual());
    expect(finish(base, 100, 60).layout.kind).toBe('too-small');
    const res = finish(base, 960, 400);
    if (res.layout.kind !== 'plot') throw new Error('expected a plot');
    const right = res.layout.texts.filter(t => t.role === 'tick-y' && t.anchor === 'start');
    expect(right.length).toBeGreaterThan(1);
    for (const t of right) expect(t.box.x).toBeGreaterThanOrEqual(res.layout.plot.x + res.layout.plot.width);
    for (let i = 0; i < right.length; i++) {
      for (let j = i + 1; j < right.length; j++) {
        const a = right[i]!.box, b = right[j]!.box;
        expect(a.y + a.height <= b.y + 1e-6 || b.y + b.height <= a.y + 1e-6).toBe(true);
      }
    }
  });
});
