/**
 * W3 integration seal, repair round: the five blockers of the cross-provider review of the sealed candidate.
 * Expected values come from the spec (F11: repeated scatter x are ordinary data; 3.5 diagnostics) and the fixture
 * rows, never from a run of the implementation.
 */
import { describe, expect, it } from 'vitest';
import type { AlignedView, DatumRef, Lookup, PickTarget, Rect } from '../../src/core/contracts';
import { alignedRows, datumReading, targetBox, valueText } from '../../src/core/focus';
import { hasData } from '../../src/core/controller-helpers';
import { controllerFor } from '../../src/core/controller';
import type { Composition } from '../../src/core/composition';
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
import { createTimeReadout } from '../../src/format/time';
import { defaultMessages } from '../../src/messages';
import { svgArea, svgBand, svgPath, svgPoints, svgRects, svgRule } from '../../src/render/svg';
import { position } from '../../src/scene/geometry';
import { markBox, pinnedModel, placementBox } from '../../src/dom/interaction-nav';
import { repeatsOf } from '../../src/cartesian/repeats';
import type { Committed } from '../../src/dom/interaction-types';
import { record } from '../finance/host';
import { marksOf, n5run, plotOf, xPixel, yScaleOf } from './n5-pipeline';

function chart(input: Record<string, unknown>) {
  const rec = record({ width: 720, height: 420 });
  const parsed = parseCartesianInput(input);
  const stateRef: CartesianStateRef = { meta: parsed.meta };
  const composition = {
    kind: 'line',
    resolve: createCartesianResolver(stateRef, { list: parsed.issues }),
    normalize: ((k, r, e, s, v) => normalizeCartesian(stateRef, k, r, e, s, v)) as Composition['normalize'],
    view: ((f, st, s) => buildCartesianView(stateRef, f as never, st as never, s)) as Composition['view'],
    layout: createCartesianLayoutStage(stateRef),
    timeReadout: createTimeReadout,
    scene: (v, l, d) => buildCartesianScene(stateRef, v, l, d),
    lookup: (v, l, f, m) => createCartesianLookup(stateRef, v, l, f, m),
    reader: createCartesianReader(stateRef),
    interaction: { overlay: createCartesianOverlay(stateRef), swatch: createMarkSwatch(stateRef), stepInSeries: null, sliceList: null },
    svg: { area: svgArea, band: svgBand, path: svgPath, points: svgPoints, rects: svgRects, rule: svgRule },
  } as Composition;
  const controller = controllerFor(composition, parsed.translated, rec.host);
  rec.frames();
  return { rec, controller, handle: controller.handle };
}

const pointsOf = (xy: Float32Array) => Array.from({ length: xy.length / 2 }, (_, i) => [xy[2 * i]!, xy[2 * i + 1]!]);
const centre = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const nodesOf = (l: Lookup) => (l as unknown as { lastPickNodes: number }).lastPickNodes;
const candidatesOf = (l: Lookup) => (l as unknown as { lastPickCandidates: number }).lastPickCandidates;
// The winning mark's box as dom/interaction.ts #present reads it for an x target: the anchor of the primary.
const leadOf = (l: Lookup, t: PickTarget) => { const r = t.kind === 'x' ? l.primary(t) : null; return r ? l.anchor(r) : null; };

describe('W3 repair 1: the pointer\'s tooltip is placed at the mark that won the pick', () => {
  // The packed Chrome fixture's #layer chart: a line b and a scatter a share every x.
  const layered = {
    data: [{ x: 1, b: 10, a: 80 }, { x: 2, b: 20, a: 80 }, { x: 3, b: 30, a: 80 }], x: 'x',
    axes: { v: { position: 'left', domain: [0, 100] } },
    layers: [{ type: 'line', y: 'b', yAxis: 'v' }, { type: 'scatter', y: 'a', yAxis: 'v', label: 'Points' }],
  };

  it('moves the placement box from the scatter point to the line vertex at one x, and keeps the union otherwise', () => {
    const run = n5run(layered);
    const d = { lookup: run.lookup, view: run.view, layout: run.layout } as unknown as Committed;
    const scale = yScaleOf(run.layout, 0), px = xPixel(run.layout, run.view, 1), yA = position(scale, 80), yB = position(scale, 20);
    const target: PickTarget = { kind: 'x', x: 2 };

    expect(run.lookup.pick(px, yA)).toEqual(target);
    expect(run.lookup.primary(target)).toEqual({ kind: 'aligned', seriesKey: 'a', x: 2 });
    const union = markBox(d, target);
    const atA = placementBox(d, leadOf(run.lookup, target), union, true)!;
    expect(centre(atA).x).toBeCloseTo(px, 4);
    expect(centre(atA).y).toBeCloseTo(yA, 4);

    expect(run.lookup.pick(px, yB)).toEqual(target);
    expect(run.lookup.primary(target)).toEqual({ kind: 'aligned', seriesKey: 'b', x: 2 });
    const atB = placementBox(d, leadOf(run.lookup, target), markBox(d, target), true)!;
    expect(centre(atB).y).toBeCloseTo(yB, 4);
    // 60 value units apart on a 0–100 axis: the placement really moves.
    expect(Math.abs(centre(atB).y - centre(atA).y)).toBeCloseTo(Math.abs(yB - yA), 4);

    // The union of both marks is what the anchor (and a held tooltip's comparison) still uses, and it spans both.
    const both = markBox(d, target)!;
    expect(both.y).toBeLessThanOrEqual(Math.min(yA, yB));
    expect(both.y + both.height).toBeGreaterThanOrEqual(Math.max(yA, yB));
    expect(markBox(d, target)).toEqual(union);
    // A keyboard, pinned or peer target (pointer false) keeps the union placement.
    expect(placementBox(d, leadOf(run.lookup, target), union, false)).toBe(union);
  });

  it('keeps the union placement for a lookup whose primary does not follow the pick (the root aligned lookup)', () => {
    const run = n5run(layered);
    const plain: Lookup = { ...run.lookup, primary: run.lookup.primary, anchor: run.lookup.anchor };
    delete (plain as { pointValue?: unknown }).pointValue;
    const d = { lookup: plain, view: run.view, layout: run.layout } as unknown as Committed;
    const target: PickTarget = { kind: 'x', x: 2 };
    const union = targetBox(run.view, plain, target, null);
    expect(leadOf(plain, target)).not.toBeNull();
    expect(placementBox(d, leadOf(plain, target), union, true)).toBe(union);
  });
});

describe('W3 repair 2: repeated rows count for readiness and for automatic log domains', () => {
  it('is ready and draws both valid repeats when the first row at each x is null', () => {
    const rows = [{ x: 1, y: null }, { x: 1, y: 2 }, { x: 2, y: null }, { x: 2, y: 4 }];
    // A title, so the controller raises no AX140 (spec A1) and the list below is the data's own.
    const options = { title: 'Gaps', data: rows, x: 'x', axes: { v: { position: 'left', domain: [0, 5] } }, layers: [{ type: 'scatter', y: 'y', yAxis: 'v' }] };
    const { rec, handle } = chart(options);
    const d = rec.committed!;
    expect(d.ready).toBe(true);
    expect(hasData(d.view, true)).toBe(true);
    expect(hasData(d.view)).toBe(true);
    // A null is a gap, not a diagnostic (spec 3.5), and repeated x on a scatter is ordinary data (F11): no AX108.
    expect(handle.diagnostics.map(x => x.code)).toEqual([]);
    // Two points: (1, 2) and (2, 4), at their own pixels.
    const run = n5run(options);
    const scale = yScaleOf(run.layout, 0);
    const [points] = marksOf(run, 'points', 0);
    expect(pointsOf(points!.xy).map(([x, y]) => [Math.round(x!), Math.round(y!)])).toEqual([
      [Math.round(xPixel(run.layout, run.view, 0)), Math.round(position(scale, 2))],
      [Math.round(xPixel(run.layout, run.view, 1)), Math.round(position(scale, 4))],
    ]);
    // The pick-to-event path of a repeated row whose x's first row is null.
    const hovers: unknown[] = [];
    handle.on('hover', p => { hovers.push(p); });
    const t = d.lookup.pick(xPixel(d.layout as never, d.view as AlignedView, 1), position(yScaleOf(d.layout, 0), 4));
    expect(t).toEqual({ kind: 'point', refs: [{ kind: 'point', seriesKey: 'y', row: 3, x: 2 }], count: 1 });
    handle.destroy();
  });

  it('is empty when every row is null, as before', () => {
    const { rec, handle } = chart({
      data: [{ x: 1, y: null }, { x: 1, y: null }], x: 'x',
      axes: { v: { position: 'left', domain: [0, 5] } }, layers: [{ type: 'scatter', y: 'y', yAxis: 'v' }],
    });
    expect(rec.committed?.ready ?? false).toBe(false);
    handle.destroy();
  });

  it('fits an automatic log axis to the positive repeats when every first row is nonpositive', () => {
    const rows = [{ x: 1, y: -2 }, { x: 1, y: 3 }, { x: 2, y: -4 }, { x: 2, y: 5 }];
    const options = { title: 'Log', data: rows, x: 'x', axes: { v: { position: 'left', scale: 'log' } }, layers: [{ type: 'scatter', y: 'y', yAxis: 'v' }] };
    const { rec, handle } = chart(options);
    const d = rec.committed!;
    expect(d.ready).toBe(true);
    const diags = handle.diagnostics;
    // No AX172 (there are positive values), no AX108 (F11): only the nonpositive note.
    expect(diags.map(x => x.code)).toEqual(['AX171']);
    // -2 and -4 are not drawn on a log axis (spec 3.5, AX171 'omitted'), counted once each.
    const omitted = diags.filter(x => x.code === 'AX171');
    expect(omitted).toHaveLength(1);
    expect(omitted[0]).toMatchObject({ field: 'y', count: 2, rows: [0, 2] });
    const run = n5run(options);
    const [lo, hi] = run.view.yDomain;
    expect(lo).toBeGreaterThan(0);
    expect(lo).toBeLessThanOrEqual(3);
    expect(hi).toBeGreaterThanOrEqual(5);
    const scale = yScaleOf(run.layout, 0);
    const [points] = marksOf(run, 'points', 0);
    const drawn = pointsOf(points!.xy);
    expect(drawn).toHaveLength(2);
    expect(drawn[0]![1]).toBeCloseTo(position(scale, 3), 3);
    expect(drawn[1]![1]).toBeCloseTo(position(scale, 5), 3);
    handle.destroy();
  });
});

describe('W3 repair 3: post-pick work in a dense repeated x is bounded and source rows are exact', () => {
  it('formats one value for a picked point at a 20,000-row x', () => {
    const n = 20_000;
    const x = new Float64Array(n + 1).fill(1), y = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) y[i] = 1 + (i % 50);
    x[n] = 2; y[n] = 25;
    let calls = 0;
    const run = n5run({
      data: { columns: { x, y } }, x: 'x',
      axes: { v: { position: 'left', domain: [0, 60], format: (v: number) => { calls++; return `v${v}`; } } },
      layers: [{ type: 'scatter', y: 'y', yAxis: 'v' }],
    });
    const scale = yScaleOf(run.layout, 0), px = xPixel(run.layout, run.view, 0);
    const t = run.lookup.pick(px, position(scale, 37))!;
    expect(t.kind).toBe('point');
    const ref = (t as Extract<PickTarget, { kind: 'point' }>).refs[0]!;
    calls = 0;
    const model = run.lookup.tooltip(t);
    expect(model.rows).toHaveLength(1);
    expect(model.rows[0]!.value).toBe('v37');
    expect(calls).toBeLessThanOrEqual(2);
    calls = 0;
    expect(run.lookup.datum(ref)!.value).toBe('v37');
    expect(calls).toBeLessThanOrEqual(2);
    // The source row is found by bisection over the x's 19,999 repeated rows, not by a scan: count its reads.
    const col = repeatsOf(run.view.frame.series[0])!;
    let reads = 0;
    const rows = col.row;
    (col as { row: Int32Array }).row = new Proxy(rows, {
      get(target, key) { if (typeof key === 'string' && /^\d+$/.test(key)) reads++; return Reflect.get(target, key, target); },
    });
    try {
      expect(run.lookup.resolve(ref)).toEqual(ref);
      expect(run.lookup.datum(ref)!.row).toBe((ref as { row: number }).row);
    } finally {
      (col as { row: Int32Array }).row = rows;
    }
    // Two lookups of ceil(log2(19,999)) + 1 = 16 reads each, at most.
    expect(reads).toBeGreaterThan(0);
    expect(reads).toBeLessThanOrEqual(2 * 16);
  });

  it('anchors a size-12 repeated marker centred 3 px above the plot, as it picks it', () => {
    const run = n5run({
      data: [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 1 }], x: 'x',
      axes: { v: { position: 'left', domain: [0, 1] } },
      layers: [{ type: 'scatter', y: 'y', yAxis: 'v', size: 12 }],
    });
    // The same axis and ticks give the same plot: a value 3 / height above 1 is centred 3 px above its top.
    const plot = plotOf(run.layout).plot;
    const above = n5run({
      data: [{ x: 1, y: 0.5 }, { x: 1, y: 1 + 3 / (plot.height) }, { x: 2, y: 0.5 }], x: 'x',
      axes: { v: { position: 'left', domain: [0, 1] } },
      layers: [{ type: 'scatter', y: 'y', yAxis: 'v', size: 12 }],
    });
    const p2 = plotOf(above.layout).plot, s2 = yScaleOf(above.layout, 0), cy = position(s2, 1 + 3 / plot.height);
    expect(cy).toBeLessThan(p2.y);
    expect(cy).toBeGreaterThan(p2.y - 6);
    // The marker's lower half (6 px) reaches into the plot: the pointer just inside the top edge picks it.
    const t = above.lookup.pick(xPixel(above.layout, above.view, 0), p2.y + 1)!;
    expect(t).toEqual({ kind: 'point', refs: [{ kind: 'point', seriesKey: 'y', row: 1, x: 1 }], count: 1 });
    const ref = (t as Extract<PickTarget, { kind: 'point' }>).refs[0]!;
    const a = above.lookup.anchor(ref);
    expect(a).not.toBeNull();
    expect(centre(a!).y).toBeCloseTo(cy, 4);
    // The pick-to-tooltip path: the tooltip's box is that anchor, and the tooltip reads the row.
    const d = { lookup: above.lookup, view: above.view, layout: above.layout } as unknown as Committed;
    expect(markBox(d, t)).toEqual(a);
    expect(above.lookup.tooltip(t).rows.map(r => r.row)).toEqual([1]);
  });

  it('keeps each point\'s source row and value on sorted and unsorted rows', () => {
    // Unsorted: source rows 0..5 with x 2, 1, 2, 1, 1, 2.
    const unsorted = [{ x: 2, y: 10 }, { x: 1, y: 11 }, { x: 2, y: 12 }, { x: 1, y: 13 }, { x: 1, y: 14 }, { x: 2, y: 15 }];
    const sorted = [{ x: 1, y: 11 }, { x: 1, y: 13 }, { x: 1, y: 14 }, { x: 2, y: 10 }, { x: 2, y: 12 }, { x: 2, y: 15 }];
    for (const data of [unsorted, sorted]) {
      const { rec, controller, handle } = chart({
        data, x: 'x', axes: { v: { position: 'left', domain: [0, 20] } }, layers: [{ type: 'scatter', y: 'y', yAxis: 'v' }],
      });
      const d = rec.committed!;
      const hovers: { y: number | null; index: number; row: unknown }[] = [];
      handle.on('hover', p => { if (p) hovers.push(p as never); });
      const scale = yScaleOf(d.layout, 0);
      for (let row = 0; row < data.length; row++) {
        const { x, y } = data[row]!;
        const t = d.lookup.pick(xPixel(d.layout, d.view as AlignedView, x - 1), position(scale, y))!;
        expect(t, `row ${row}`).toEqual({ kind: 'point', refs: [{ kind: 'point', seriesKey: 'y', row, x }], count: 1 });
        const ref = (t as Extract<PickTarget, { kind: 'point' }>).refs[0]!;
        expect(d.lookup.datum(ref)).toMatchObject({ value: String(y), row });
        expect(d.lookup.resolve(ref)).toEqual(ref);
        controller.actions.hover(ref);
      }
      expect(hovers).toEqual(data.map((r, i) => ({ series: 'y', x: r.x, y: r.y, row: r, index: i })));
      // A row that is not at this x resolves to nothing of its own.
      expect(d.lookup.datum({ kind: 'point', seriesKey: 'y', row: data.findIndex(r => r.x === 2), x: 1 })).toBeNull();
      handle.destroy();
    }
  });
});

describe('W3 repair 4: a ninth-or-later error bar with a missing centre keeps its interval', () => {
  const lines = Array.from({ length: 8 }, (_, i) => `l${i + 1}`);
  const input = {
    data: [1, 2, 3].map(x => ({
      x, ...Object.fromEntries(lines.map((f, i) => [f, x + i])), m: x === 2 ? null : 50, lo: 20, hi: 80,
      p: x === 2 ? null : 5, a1: x === 2 ? null : 5, a2: 6,
    })), x: 'x',
    axes: { v: { position: 'left', domain: [0, 100] } },
    layers: [
      ...lines.map(f => ({ type: 'line', y: f, yAxis: 'v' })),
      { type: 'errorBar', y: 'm', low: 'lo', high: 'hi', yAxis: 'v', label: 'Err' },
      { type: 'line', y: 'p', yAxis: 'v', label: 'Plain' },
      { type: 'area', y: ['a1', 'a2'], yAxis: 'v', stacked: true },
    ],
  };

  it('reads the lookup\'s "No data (20 – 80)" in pinned pagination', () => {
    const r = n5run(input);
    const target: PickTarget = { kind: 'x', x: 2 };
    const own = r.lookup.datum({ kind: 'aligned', seriesKey: 'm', x: 2 })!;
    // The lookup's own reading of the error bar: missing centre, both bounds.
    expect(own.value).toBe(`${defaultMessages.noData} (20 – 80)`);
    const committed = { lookup: r.lookup, view: r.view, formatters: r.formatters } as unknown as Committed;
    const page = pinnedModel(committed, target, 8);
    const err = page.rows.find(x => x.seriesLabel === 'Err');
    expect(err?.value).toBe(`${defaultMessages.noData} (20 – 80)`);
  });

  it('reads it by keyboard, and leaves plain and stacked missing rows as they were', () => {
    const r = n5run(input);
    const focus: DatumRef = { kind: 'aligned', seriesKey: 'l1', x: 2 };
    const spoken = valueText(r.view, r.lookup as Lookup, focus, 'all', r.formatters, defaultMessages)!;
    expect(spoken).toContain(`Err ${defaultMessages.noData} (20 – 80)`);
    expect(datumReading(r.view, r.lookup, focus, 'all', r.formatters, defaultMessages)).toContain(`${defaultMessages.noData} (20 – 80)`);
    // A plain line and a stacked series missing at x = 2 keep the frame's own missing word (no interval, and no
    // "incomplete" on a tooltip row: the total says that).
    const rows = alignedRows(r.view, r.formatters, 2, r.lookup.tooltip({ kind: 'x', x: 2 }), r.lookup);
    const plain = rows.find(x => x.ref.kind === 'aligned' && x.ref.seriesKey === 'p')!;
    expect(plain.value).toBe(defaultMessages.noData);
    const stacked = rows.find(x => x.ref.kind === 'aligned' && x.ref.seriesKey === 'a1')!;
    expect(stacked.value).toBe(defaultMessages.noData);
    expect(rows.find(x => x.ref.kind === 'aligned' && x.ref.seriesKey === 'a2')!.value).toBe('6');
  });
});

describe('W3 repair 5: coincident circular centres prune on exact ties', () => {
  it('visits a bounded part of 100,000 coincident circular error-bar centres on a diagonal pick and keeps the lowest slot', () => {
    const n = 100_000;
    const x = new Float64Array(n), lo = new Float64Array(n).fill(10), hi = new Float64Array(n).fill(30), y = new Float64Array(n).fill(20);
    // The coincident-whisker test's x: slots 1 … n - 2 project to one pixel.
    x[0] = -50;
    for (let i = 1; i < n - 1; i++) x[i] = 1e-6 + i * 1e-20;
    x[n - 1] = 200;
    const run = n5run({
      data: { columns: { x, y, lo, hi } }, x: 'x',
      axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [{ type: 'errorBar', y: 'y', low: 'lo', high: 'hi', yAxis: 'v', capWidth: 0 }],
    });
    expect(run.view.cues[0]!.marker).toBe('circle');
    const p = plotOf(run.layout).projection;
    if (p.kind !== 'xy') throw new Error('xy');
    const cx = p.x.map(x[1]!), cy = position(yScaleOf(run.layout, 0), 20);
    expect(p.x.map(x[n - 2]!)).toBe(cx);
    // 1 px outside the circles (radius 2.25) on the up-right diagonal; the whiskers' right edge (0.75 px from the
    // centre line) is 3.25 / sqrt(2) - 0.75 = 1.55 px away, so the circles win, all alike.
    const d = 3.25 / Math.SQRT2;
    const target = run.lookup.pick(cx + d, cy - d);
    expect(target).toEqual({ kind: 'x', x: x[1]! });
    expect(run.lookup.primary(target!)).toEqual({ kind: 'aligned', seriesKey: 'y', x: x[1]! });
    expect(nodesOf(run.lookup)).toBeGreaterThanOrEqual(1);
    expect(nodesOf(run.lookup)).toBeLessThanOrEqual(128);
    expect(candidatesOf(run.lookup)).toBeGreaterThanOrEqual(1);
    expect(candidatesOf(run.lookup)).toBeLessThanOrEqual(64);
  });
});
