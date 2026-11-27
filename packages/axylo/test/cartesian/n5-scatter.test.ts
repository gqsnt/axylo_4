/**
 * N5: the `scatter` layer of `axylo/cartesian` — markers without a joining line on the layer's own axis (linear or
 * log, left or right; an omitted `yAxis` is the left axis), nonpositive values left out on log axes (spec F13,
 * AX171) yet read raw, picked within 24 px of the point (spec 3.6), and one point swatch. A scatter layer shares
 * the chart's aligned x; rows that repeat an x are kept as points of their own (spec F11, w3-integration.test.ts).
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
import { controllerFor } from '../../src/core/controller';
import type { Composition } from '../../src/core/composition';
import { createTimeReadout } from '../../src/format/time';
import { svgArea, svgBand, svgPath, svgPoints, svgRects, svgRule } from '../../src/render/svg';
import { position } from '../../src/scene/geometry';
import { record } from '../finance/host';
import { marksOf, n5run, xPixel, yScaleOf } from './n5-pipeline';

const data = [
  { x: 1, a: 1, b: 10, c: 3 }, { x: 2, a: 2, b: 20, c: 3 }, { x: 3, a: -1, b: 30, c: 3 },
  { x: 4, a: 4, b: 40, c: 3 }, { x: 5, a: 8, b: 50, c: 3 },
];

const options = {
  data, x: 'x',
  axes: { l: { position: 'left' }, r: { position: 'right', scale: 'log' } },
  layers: [
    { type: 'line', y: 'b', yAxis: 'l' },
    { type: 'scatter', y: 'a', yAxis: 'r', size: 6, label: 'Points' },
  ],
};

describe('N5 scatter layer', () => {
  it('draws one marker per positive value on its log axis, at the axis scale, with no line', () => {
    const run = n5run(options);
    expect(run.view.frame.series.map(s => s.label)).toEqual(['b', 'Points']);
    const points = marksOf(run, 'points', 1);
    expect(points).toHaveLength(1);
    expect(marksOf(run, 'path', 1)).toEqual([]);
    expect(points[0]!.size).toBe(6);
    const y = yScaleOf(run.layout, 1);
    expect(y.type).toBe('log');
    const expected = [0, 1, 3, 4].flatMap(i => [xPixel(run.layout, run.view, i), position(y, data[i]!.a)]);
    expect(Array.from(points[0]!.xy)).toEqual(expected.map(v => Math.fround(v)));
    const ax171 = run.diagnostics.filter(d => d.code === 'AX171');
    expect(ax171.map(d => [d.field, d.count])).toEqual([['a', 1]]);
  });

  it('reads the raw value, also where the log axis does not plot it', () => {
    const run = n5run(options);
    const rows = run.lookup.tooltip({ kind: 'x', x: 3 }).rows;
    expect(rows.map(r => [r.seriesLabel, r.value])).toEqual([['b', '30'], ['Points', '-1 (not plotted)']]);
    expect(run.reader.table!.row(2)).toEqual(['3', '30', '-1 (not plotted — log)']);
  });

  it('picks the point within 24 px, before the shared x slot falls back to the first series', () => {
    const run = n5run(options);
    const px = xPixel(run.layout, run.view, 3);
    const py = position(yScaleOf(run.layout, 1), 4);
    const lineY = position(yScaleOf(run.layout, 0), 40);
    expect(Math.abs(lineY - (py + 10))).toBeGreaterThan(12);
    const target = run.lookup.pick(px + 6, py + 10)!;
    expect(run.lookup.primary(target)).toEqual({ kind: 'aligned', seriesKey: 'a', x: 4 });
    const anchor = run.lookup.anchor({ kind: 'aligned', seriesKey: 'a', x: 4 })!;
    expect(anchor.x + anchor.width / 2).toBeCloseTo(px, 3);
    expect(anchor.y + anchor.height / 2).toBeCloseTo(py, 3);
  });

  it('defaults an omitted yAxis to the left axis and swatches as a point', () => {
    const run = n5run({ ...options, layers: [...options.layers, { type: 'scatter', y: 'c' }] });
    expect(run.view.frame.series[2]!.axisId).toBe('l');
    const spec = run.swatch(1, run.view.cues[1]!, false, run.view);
    expect(spec).toEqual({ color: 1, cue: run.view.cues[1], line: false, hollow: false });
    expect(run.swatch.key!(1, run.view)).not.toBe(run.swatch.key!(0, run.view));
  });

  it('hides with its toggle: no markers, no right-axis fit from it', () => {
    const run = n5run(options, { hidden: ['a'] });
    expect(marksOf(run, 'points', 1)).toEqual([]);
    expect(run.lookup.tooltip({ kind: 'x', x: 1 }).rows.map(r => r.seriesLabel)).toEqual(['b']);
  });

  // W3 integration: spec F11 says points sharing an x are ordinary data on a scatter, so a repeated x is no
  // longer AX108 for a scatter layer (it was, while the layer kept one value per x); aligned layers keep AX108.
  it('keeps rows that share an x as points (spec F11), and AX108 for an aligned layer', () => {
    const diagnostics = validateCartesian({
      data: [{ x: 1, a: 1 }, { x: 1, a: 2 }], x: 'x', axes: { l: { position: 'left' } }, layers: [{ type: 'scatter', y: 'a' }],
    } as never);
    expect(diagnostics.some(d => d.code === 'AX108')).toBe(false);
    const aligned = validateCartesian({
      data: [{ x: 1, a: 1 }, { x: 1, a: 2 }], x: 'x', axes: { l: { position: 'left' } }, layers: [{ type: 'line', y: 'a', yAxis: 'l' }],
    } as never);
    expect(aligned.some(d => d.code === 'AX108')).toBe(true);
  });

  it('accepts yAxis left/right position aliases for custom axis IDs, prioritizes explicit IDs, and diagnoses absent right axis', () => {
    const aliased = {
      data, x: 'x',
      axes: { price: { position: 'left' }, vol: { position: 'right', scale: 'log' } },
      layers: [
        { type: 'scatter', y: 'b', yAxis: 'left', label: 'LeftPts' },
        { type: 'point', y: 'a', yAxis: 'right', size: 6, label: 'RightPts' },
      ],
    };
    const run = n5run(aliased);
    expect(run.view.frame.series.map(s => [s.label, s.axisId, s.axisIndex])).toEqual([
      ['LeftPts', 'price', 0], ['RightPts', 'vol', 1],
    ]);
    // Log filtering on the resolved right log axis ('vol') still drops a = -1 and emits AX171.
    expect(marksOf(run, 'points', 1)[0]!.xy.length).toBe(8);
    expect(run.diagnostics.filter(d => d.code === 'AX171').map(d => [d.field, d.count])).toEqual([['a', 1]]);
    expect(validateCartesian(aliased as never).filter(d => d.level === 'error')).toEqual([]);

    // Explicit axis IDs take priority over position aliases when IDs collide with 'left' / 'right'.
    const swapped = n5run({
      data, x: 'x',
      axes: { right: { position: 'left' }, left: { position: 'right', scale: 'log' } },
      layers: [
        { type: 'scatter', y: 'b', yAxis: 'right' },
        { type: 'scatter', y: 'a', yAxis: 'left' },
      ],
    });
    expect(swapped.view.frame.series.map(s => [s.field, s.axisId, s.axisIndex])).toEqual([
      ['b', 'right', 0], ['a', 'left', 1],
    ]);

    // Absent right axis is still diagnosed as AX174.
    const noRight = validateCartesian({
      data, x: 'x', axes: { price: { position: 'left' } },
      layers: [{ type: 'scatter', y: 'a', yAxis: 'right' }],
    } as never);
    expect(noRight.some(d => d.code === 'AX174' && d.field === 'right')).toBe(true);

    // Real ChartController runtime commits and draws aliased scatter/point layers cleanly.
    const rec = record({ width: 720, height: 420 });
    const parsed = parseCartesianInput(aliased);
    const stateRef: CartesianStateRef = { meta: parsed.meta };
    const pending = { list: parsed.issues };
    const composition: Composition = {
      kind: 'line',
      resolve: createCartesianResolver(stateRef, pending),
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
    const handle = controllerFor(composition, parsed.translated, rec.host).handle;
    rec.frames();
    const lastScene = rec.draws[rec.draws.length - 1]!;
    const pointMarks = lastScene.marks.filter(m => m.type === 'points');
    expect(pointMarks.map(m => [m.series, m.xy.length])).toEqual([[0, 10], [1, 8]]);
    expect(rec.committed!.reader.table!.row(2)).toEqual(['3', '30', '-1 (not plotted — log)']);
    handle.destroy();
  });
});
