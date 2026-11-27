/**
 * Wave 3 integration seal: the cross-boundary findings between `axylo/cartesian` and the shared interaction,
 * focus and event code. Expected values come from the fixtures and the spec, worked out by hand:
 * - F11: on a scatter, rows that share an x are ordinary data; on line, area and bar they are AX108.
 * - The event payload of spec 3.6 / I3 names the caller's row (`index`) and its raw x and y.
 * - A range reads "low – high" wherever its value is read (c5-ranges-annotations.test.ts wording).
 * - A legend entry toggles a series; a lone range or error bar is one series the reader may hide.
 */
import { describe, expect, it } from 'vitest';
import type { AlignedView, DatumRef, Lookup, PickTarget } from '../../src/core/contracts';
import { alignedRows, datumReading, valueText } from '../../src/core/focus';
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
import { validateCartesian } from '../../src/cartesian';
import { createTimeReadout } from '../../src/format/time';
import { defaultMessages } from '../../src/messages';
import { svgArea, svgBand, svgPath, svgPoints, svgRects, svgRule } from '../../src/render/svg';
import { position } from '../../src/scene/geometry';
import { SERIES, buildControlItems, collectControlInputs } from '../../src/dom/interaction-controls';
import { pinnedModel } from '../../src/dom/interaction-nav';
import type { Committed, ControlsState } from '../../src/dom/interaction-types';
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
  return { rec, controller, handle: controller.handle, swatch: composition.interaction!.swatch };
}

const pointsOf = (xy: Float32Array) => Array.from({ length: xy.length / 2 }, (_, i) => [xy[2 * i]!, xy[2 * i + 1]!]);

describe('W3 finding 4: scatter rows that repeat an x are separate points (spec F11)', () => {
  const rows = [{ x: 1, y: 2 }, { x: 1, y: 3 }, { x: 2, y: 4 }];
  const options = {
    data: rows, x: 'x',
    axes: { v: { position: 'left', domain: [0, 5] } },
    layers: [{ type: 'scatter', y: 'y', yAxis: 'v', label: 'Pts' }],
  };

  it('draws all three points (1, 2), (1, 3), (2, 4) and reports no AX108', () => {
    const run = n5run(options);
    expect(run.diagnostics.map(d => d.code)).not.toContain('AX108');
    expect(validateCartesian(options as never).map(d => d.code)).not.toContain('AX108');
    expect(run.view.frame.series[0]!.drawable).toBe(true);
    const scale = yScaleOf(run.layout, 0), x1 = xPixel(run.layout, run.view, 0), x2 = xPixel(run.layout, run.view, 1);
    const [points] = marksOf(run, 'points', 0);
    const drawn = pointsOf(points!.xy);
    const expected = [[x1, position(scale, 2)], [x1, position(scale, 3)], [x2, position(scale, 4)]];
    expect(drawn).toHaveLength(3);
    drawn.forEach(([px, py], i) => { expect(px).toBeCloseTo(expected[i]![0]!, 3); expect(py).toBeCloseTo(expected[i]![1]!, 3); });
  });

  it('picks each point by its own row, reads its own value and anchors on it', () => {
    const run = n5run(options);
    const scale = yScaleOf(run.layout, 0), x1 = xPixel(run.layout, run.view, 0), x2 = xPixel(run.layout, run.view, 1);
    const at = (px: number, v: number) => run.lookup.pick(px, position(scale, v));
    const first = at(x1, 2), second = at(x1, 3), third = at(x2, 4);
    expect(first).toEqual({ kind: 'point', refs: [{ kind: 'point', seriesKey: 'y', row: 0, x: 1 }], count: 1 });
    expect(second).toEqual({ kind: 'point', refs: [{ kind: 'point', seriesKey: 'y', row: 1, x: 1 }], count: 1 });
    // A point alone at its x keeps the aligned target every other Cartesian mark uses.
    expect(third).toEqual({ kind: 'x', x: 2 });
    expect(run.lookup.primary(third!)).toEqual({ kind: 'aligned', seriesKey: 'y', x: 2 });

    const refA = first!.kind === 'point' ? first!.refs[0]! : null, refB = second!.kind === 'point' ? second!.refs[0]! : null;
    expect(run.lookup.datum(refA!)).toMatchObject({ value: '2', row: 0, seriesLabel: 'Pts', x: '1' });
    expect(run.lookup.datum(refB!)).toMatchObject({ value: '3', row: 1, seriesLabel: 'Pts', x: '1' });
    expect(run.lookup.tooltip(second!)).toMatchObject({ title: '1', count: 1, rows: [{ value: '3', row: 1 }] });
    expect(run.lookup.members(second!, 0, 8)).toEqual([refB]);
    expect(run.lookup.has(second!, refB!)).toBe(true);
    expect(run.lookup.has(second!, refA!)).toBe(false);
    expect(run.lookup.primary(second!)).toEqual(refB);
    expect(run.lookup.slot(refB!)).toBe(0);
    expect(run.lookup.ordinal(refB!)).toBe(0);
    expect(run.lookup.resolve(refB!)).toEqual(refB);
    const anchor = run.lookup.anchor(refB!)!;
    expect(anchor.x + anchor.width / 2).toBeCloseTo(x1, 4);
    expect(anchor.y + anchor.height / 2).toBeCloseTo(position(scale, 3), 4);
    // The x read as a whole (keyboard, aligned tooltip) lists both rows there.
    expect(run.lookup.datum({ kind: 'aligned', seriesKey: 'y', x: 1 })!.value).toBe('2, 3');
    // A row that is not there is no datum.
    expect(run.lookup.datum({ kind: 'point', seriesKey: 'y', row: 2, x: 1 })).toBeNull();
    // The keyboard steps on from a point by x.
    expect(run.lookup.step(refB!, 'next')).toEqual({ kind: 'aligned', seriesKey: 'y', x: 2 });
  });

  it('lists every row in the table and the summary, and fits the axis to the repeated rows', () => {
    const run = n5run(options);
    const table = run.reader.table!;
    expect(table.rowCount).toBe(2);
    expect(table.row(0)).toEqual(['1', '2, 3']);
    expect(table.row(1)).toEqual(['2', '4']);
    const auto = n5run({ ...options, data: [{ x: 1, y: 2 }, { x: 1, y: 30 }, { x: 2, y: 4 }], axes: { v: { position: 'left' } } });
    expect(auto.view.yDomain[1]).toBeGreaterThanOrEqual(30);
    // The summary's range runs to the repeated row's value.
    expect(auto.reader.summary).toContain('30');
  });

  it('raises hover and select with the raw x, y, source row and index of each point', () => {
    const { rec, controller, handle } = chart(options);
    const hovers: unknown[] = [], selects: unknown[] = [];
    handle.on('hover', p => { hovers.push(p); });
    handle.on('select', p => { selects.push(p); });
    const d = rec.committed!;
    const plot = plotOf(d.layout).plot;
    const proj = plotOf(d.layout).projection;
    if (proj.kind !== 'xy') throw new Error('xy');
    const view = d.view as AlignedView;
    const scale = proj.yAxes?.[0] ?? proj.y;
    const px = (slot: number) => proj.x.map(view.frame.x.values[slot]!);
    for (const [slot, v] of [[0, 2], [0, 3], [1, 4]] as const) {
      const target = d.lookup.pick(px(slot), position(scale, v));
      expect(target, `pick ${v}`).not.toBeNull();
      const ref = d.lookup.primary(target!)!;
      controller.actions.hover(ref);
      controller.actions.select(ref);
    }
    expect(plot.width).toBeGreaterThan(0);
    const expected = [
      { series: 'y', x: 1, y: 2, row: rows[0], index: 0 },
      { series: 'y', x: 1, y: 3, row: rows[1], index: 1 },
      { series: 'y', x: 2, y: 4, row: rows[2], index: 2 },
    ];
    expect(hovers).toEqual(expected);
    expect(selects).toEqual(expected);
    expect(handle.diagnostics.map(x => x.code)).not.toContain('AX108');
    handle.destroy();
  });

  it('keeps AX108 for an aligned layer at the repeated x while the scatter beside it draws', () => {
    const mixed = n5run({
      data: [{ x: 1, y: 2, l: 5 }, { x: 1, y: 3, l: 6 }, { x: 2, y: 4, l: 7 }], x: 'x',
      axes: { v: { position: 'left', domain: [0, 10] } },
      layers: [{ type: 'line', y: 'l', yAxis: 'v' }, { type: 'scatter', y: 'y', yAxis: 'v' }],
    });
    expect(mixed.diagnostics.filter(d => d.code === 'AX108')).toHaveLength(1);
    expect(mixed.view.frame.series.map(s => [s.key, s.drawable])).toEqual([['l', false], ['y', true]]);
    expect(pointsOf(marksOf(mixed, 'points', 1)[0]!.xy)).toHaveLength(3);
    const lineOnly = n5run({
      data: [{ x: 1, l: 5 }, { x: 1, l: 6 }], x: 'x', axes: { v: { position: 'left' } }, layers: [{ type: 'line', y: 'l', yAxis: 'v' }],
    });
    expect(lineOnly.diagnostics.map(d => d.code)).toContain('AX108');
    const range = n5run({
      data: [{ x: 1, lo: 1, hi: 2 }, { x: 1, lo: 2, hi: 3 }], x: 'x', axes: { v: { position: 'left' } },
      layers: [{ type: 'range', low: 'lo', high: 'hi', yAxis: 'v' }],
    });
    expect(range.diagnostics.map(d => d.code)).toContain('AX108');
  });

  it('parses category and calendar-date x with the same parser, and leaves borrowed columns as given', () => {
    const cat = n5run({ ...options, data: [{ x: 'a', y: 2 }, { x: 'a', y: 3 }, { x: 'b', y: 4 }] });
    expect(cat.view.frame.x.kind).toBe('category');
    expect(cat.view.frame.x.categories).toEqual(['a', 'b']);
    expect(pointsOf(marksOf(cat, 'points', 0)[0]!.xy)).toHaveLength(3);
    expect(cat.diagnostics.map(d => d.code)).not.toContain('AX108');

    const dated = n5run({ ...options, data: [{ x: '2026-01-01', y: 2 }, { x: '2026-01-01', y: 3 }, { x: '2026-01-02', y: 4 }] });
    expect(dated.view.frame.x.kind).toBe('date');
    expect(Array.from(dated.view.frame.x.values)).toEqual([Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 2)]);
    expect(pointsOf(marksOf(dated, 'points', 0)[0]!.xy)).toHaveLength(3);
    const day = dated.lookup.pick(xPixel(dated.layout, dated.view, 0), position(yScaleOf(dated.layout, 0), 3));
    expect(day).toEqual({ kind: 'point', refs: [{ kind: 'point', seriesKey: 'y', row: 1, x: Date.UTC(2026, 0, 1) }], count: 1 });

    const x = Float64Array.of(1, 1, 2), y = Float64Array.of(2, 3, 4);
    const typed = n5run({ ...options, data: { columns: { x, y } } });
    expect(Array.from(x)).toEqual([1, 1, 2]);
    expect(Array.from(y)).toEqual([2, 3, 4]);
    expect(pointsOf(marksOf(typed, 'points', 0)[0]!.xy)).toHaveLength(3);
    expect(typed.reader.table!.row(0)).toEqual(['1', '2, 3']);
  });

  it('counts a nonpositive repeated row on a log axis as AX171 and does not draw it', () => {
    const log = n5run({
      ...options, data: [{ x: 1, y: 2 }, { x: 1, y: -3 }, { x: 2, y: 4 }],
      axes: { v: { position: 'left', scale: 'log' } },
    });
    const ax171 = log.diagnostics.find(d => d.code === 'AX171');
    expect(ax171?.count).toBe(1);
    expect(ax171?.rows).toEqual([1]);
    expect(pointsOf(marksOf(log, 'points', 0)[0]!.xy)).toHaveLength(2);
  });

  it('draws and picks nothing of a hidden scatter', () => {
    const run = n5run(options, { hidden: ['y'] });
    expect(marksOf(run, 'points', 0)).toEqual([]);
    const target = run.lookup.pick(xPixel(run.layout, run.view, 0), position(yScaleOf(run.layout, 0), 3));
    expect(target?.kind).not.toBe('point');
  });
});

/** The controls state the interaction layer would get for a committed chart (fields collectControlInputs reads). */
function controlsOf(committed: Committed): ControlsState {
  return { ...committed, legend: 'bottom', ready: true, tooSmall: false, zoom: false };
}

describe('W3 finding 2: a lone range or error bar keeps its legend toggle', () => {
  const lone = (layer: Record<string, unknown>) => ({
    data: [{ x: 1, lo: 10, hi: 30, m: 20, v: 5 }, { x: 2, lo: 20, hi: 40, m: 30, v: 6 }], x: 'x',
    axes: { v: { position: 'left' } }, layers: [layer],
  });

  it('offers one toggle for a lone range and a lone error bar, none for a lone line or bar', () => {
    const cases: [Record<string, unknown>, boolean][] = [
      [{ type: 'range', low: 'lo', high: 'hi', yAxis: 'v', label: 'Band' }, true],
      [{ type: 'errorBar', y: 'm', low: 'lo', high: 'hi', yAxis: 'v', label: 'Err' }, true],
      [{ type: 'line', y: 'v', yAxis: 'v' }, false],
      [{ type: 'bar', y: 'v', yAxis: 'v' }, false],
    ];
    for (const [layer, offered] of cases) {
      const { rec, swatch, handle } = chart(lone(layer));
      const d = controlsOf(rec.committed!);
      const controls = collectControlInputs(d, [], false, false, false, swatch);
      expect((controls & SERIES) !== 0, String(layer.type)).toBe(offered);
      const items = buildControlItems(d, controls, swatch, false, null).filter(i => i.key.startsWith('series:'));
      expect(items.map(i => [i.label, i.pressed]), String(layer.type)).toEqual(offered ? [[String(layer.label), true]] : []);
      handle.destroy();
    }
  });

  it('hides the lone interval and restores it from the same toggle, the chart staying ready', () => {
    for (const layer of [
      { type: 'range', low: 'lo', high: 'hi', yAxis: 'v', label: 'Band' },
      { type: 'errorBar', y: 'm', low: 'lo', high: 'hi', yAxis: 'v', label: 'Err' },
    ]) {
      const { rec, controller, swatch, handle } = chart(lone(layer));
      const key = rec.committed!.view.kind === 'donut' ? '' : (rec.committed!.view as AlignedView).frame.series[0]!.key;
      const shapes = () => rec.draws[rec.draws.length - 1]!.marks.filter(m => (m as { series?: number }).series === 0).length;
      expect(shapes()).toBeGreaterThan(0);
      controller.actions.toggle(key);
      rec.frames();
      const hidden = rec.committed!;
      expect(hidden.ready).toBe(true);
      expect((hidden.view as AlignedView).visible).toEqual([false]);
      expect(shapes()).toBe(0);
      const d = controlsOf(hidden);
      const controls = collectControlInputs(d, [], false, false, false, swatch);
      expect(controls & SERIES).toBe(SERIES);
      expect(buildControlItems(d, controls, swatch, false, null).filter(i => i.key === `series:${key}`).map(i => [i.pressed, i.struck]))
        .toEqual([[false, true]]);
      controller.actions.toggle(key);
      rec.frames();
      expect((rec.committed!.view as AlignedView).visible).toEqual([true]);
      expect(shapes()).toBeGreaterThan(0);
      handle.destroy();
    }
  });
});

describe('W3 finding 5: a range read past the tooltip\'s eight rows keeps its interval', () => {
  const lines = Array.from({ length: 8 }, (_, i) => `l${i + 1}`);
  const run = () => n5run({
    data: [1, 2, 3].map(x => ({ x, ...Object.fromEntries(lines.map((f, i) => [f, x + i])), lo: 20, hi: 80 })), x: 'x',
    axes: { v: { position: 'left', domain: [0, 100] } },
    layers: [...lines.map(f => ({ type: 'line', y: f, yAxis: 'v' })), { type: 'range', low: 'lo', high: 'hi', yAxis: 'v', label: 'Band' }],
  });

  it('reads 20 – 80 for the ninth series in pinned pagination and keyboard reading', () => {
    const r = run();
    const target: PickTarget = { kind: 'x', x: 1 };
    const model = r.lookup.tooltip(target);
    expect(model.count).toBe(9);
    expect(model.rows).toHaveLength(8);
    const rows = alignedRows(r.view, r.formatters, 1, model, r.lookup);
    expect(rows[8]).toMatchObject({ seriesLabel: 'Band', value: '20 – 80' });
    const committed = { lookup: r.lookup, view: r.view, formatters: r.formatters } as unknown as Committed;
    const page = pinnedModel(committed, target, 8);
    expect(page.rows.map(x => [x.seriesLabel, x.value])).toEqual([['Band', '20 – 80']]);
    const focus: DatumRef = { kind: 'aligned', seriesKey: 'l1', x: 1 };
    const spoken = valueText(r.view, r.lookup as Lookup, focus, 'all', r.formatters, defaultMessages)!;
    expect(spoken).toContain('Band 20 – 80');
    expect(datumReading(r.view, r.lookup, focus, 'all', r.formatters, defaultMessages)).toContain('20 – 80');
  });
});
