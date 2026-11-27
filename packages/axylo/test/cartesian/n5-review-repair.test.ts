/**
 * N5 repair round (cross-provider review findings 2, 3, 4 and 6). Expected values come from the fixtures below and
 * the spec (F13: a log axis draws only values above zero; 3.6: a point is picked within 24 px, a line vertex within
 * 12 px), not from a run.
 */
import { describe, expect, it } from 'vitest';
import { validateCartesian } from '../../src/cartesian';
import { parseCartesianInput } from '../../src/cartesian/options';
import { encodingChanged } from '../../src/core/stages';
import { position } from '../../src/scene/geometry';
import { marksOf, n5run, xPixel, yScaleOf } from './n5-pipeline';
import { controllerFor } from '../../src/core/controller';
import type { Composition } from '../../src/core/composition';
import type { Mark, Scene } from '../../src/core/contracts';
import { createTimeReadout } from '../../src/format/time';
import { svgArea, svgBand, svgPath, svgPoints, svgRects, svgRule } from '../../src/render/svg';
import { createCartesianResolver } from '../../src/cartesian/options';
import { normalizeCartesian } from '../../src/cartesian/normalize';
import { buildCartesianView } from '../../src/cartesian/view';
import { createCartesianLayoutStage } from '../../src/cartesian/layout';
import { buildCartesianScene } from '../../src/cartesian/scene';
import { createCartesianLookup } from '../../src/cartesian/lookup';
import { createCartesianReader } from '../../src/cartesian/reader';
import { createCartesianOverlay } from '../../src/cartesian/overlay';
import { createMarkSwatch } from '../../src/cartesian/mark-swatch';
import type { CartesianStateRef } from '../../src/cartesian/meta';
import { record } from '../finance/host';

/**
 * The real chart controller over the Cartesian stages, wired as `src/cartesian.ts` wires them (its composition
 * factory is not exported, so it is repeated here), with the wrapper's update: parse, swap the meta, update.
 */
function openCartesian(input: Record<string, unknown>) {
  const rec = record({ width: 720, height: 420 });
  const parsed = parseCartesianInput(input);
  const stateRef: CartesianStateRef = { meta: parsed.meta };
  const pending = { list: parsed.issues };
  const composition: Composition = {
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
  const handle = controllerFor(composition, parsed.translated, rec.host).handle as { update(p: unknown): void; destroy(): void };
  let raw = { ...input };
  rec.frames();
  return {
    rec,
    last: (): Scene => rec.draws[rec.draws.length - 1]!,
    update(patch: Record<string, unknown>) {
      raw = { ...raw, ...patch };
      const next = parseCartesianInput(raw, stateRef.meta);
      stateRef.meta = next.meta;
      pending.list = next.issues;
      handle.update(next.translated);
      rec.frames();
    },
    destroy: () => handle.destroy(),
  };
}

const ofSeries = <T extends Mark['type']>(scene: Scene, type: T, series: number) =>
  scene.marks.filter((m): m is Extract<Mark, { type: T }> => m.type === type && (m as { series?: number }).series === series);

const translated = (input: Record<string, unknown>) => parseCartesianInput(input).translated;

describe('N5 repair: layer-only updates are encoding changes (finding 4)', () => {
  const data = [{ x: 1, a: 1, b: 2, c: 3, d: 4, e: 5, o: [9] }, { x: 2, a: 1, b: 2, c: 3, d: 4, e: 5, o: [] }];
  const base = { data, x: 'x', axes: { v: { position: 'left' } } };
  const box = (extra: Record<string, unknown> = {}) => ({
    ...base, layers: [{ type: 'boxplot', min: 'a', q1: 'b', median: 'c', q3: 'd', max: 'e', yAxis: 'v', ...extra }],
  });

  it('sees a same-field line to scatter change, a scatter size, a cap width and an outlier field', () => {
    const line = translated({ ...base, layers: [{ type: 'line', y: 'a', yAxis: 'v' }] });
    const scatter = translated({ ...base, layers: [{ type: 'scatter', y: 'a', yAxis: 'v' }] });
    const bigger = translated({ ...base, layers: [{ type: 'scatter', y: 'a', yAxis: 'v', size: 9 }] });
    expect(encodingChanged(line, scatter)).toBe(true);
    expect(encodingChanged(scatter, bigger)).toBe(true);
    expect(encodingChanged(translated(box()), translated(box({ capWidth: 2 })))).toBe(true);
    expect(encodingChanged(translated(box()), translated(box({ outliers: 'o' })))).toBe(true);
    // The same layers again are not a change: the view, scene and readers are reused.
    expect(encodingChanged(translated(box({ outliers: 'o' })), translated(box({ outliers: 'o' })))).toBe(false);
  });

  it('redraws and rereads through the real controller after layer-only updates', () => {
    const chart = openCartesian({ ...base, layers: [{ type: 'line', y: 'a', yAxis: 'v' }] });
    expect(ofSeries(chart.last(), 'path', 0)).toHaveLength(1);
    chart.update({ layers: [{ type: 'scatter', y: 'a', yAxis: 'v', size: 9 }] });
    expect(ofSeries(chart.last(), 'path', 0)).toHaveLength(0);
    expect(ofSeries(chart.last(), 'points', 0)[0]!.size).toBe(9);
    chart.update({ layers: [{ type: 'scatter', y: 'a', yAxis: 'v', size: 5 }] });
    expect(ofSeries(chart.last(), 'points', 0)[0]!.size).toBe(5);
    // Box: no cap, then 10 px caps (each box gains two cap segments of 6 floats), then its outliers appear.
    chart.update({ layers: [{ type: 'boxplot', min: 'a', q1: 'b', median: 'c', q3: 'd', max: 'e', yAxis: 'v', capWidth: 0 }] });
    const whiskers = () => ofSeries(chart.last(), 'path', 0).find(m => m.stroke.kind === 'series')!.xy.length;
    expect(whiskers()).toBe(2 * 2 * 6);
    chart.update({ layers: [{ type: 'boxplot', min: 'a', q1: 'b', median: 'c', q3: 'd', max: 'e', yAxis: 'v', capWidth: 10 }] });
    expect(whiskers()).toBe(2 * 4 * 6);
    expect(ofSeries(chart.last(), 'points', 0)).toHaveLength(0);
    expect(chart.rec.committed!.reader.table!.row(0)!.at(-1)).toBe('none');
    chart.update({ layers: [{ type: 'boxplot', min: 'a', q1: 'b', median: 'c', q3: 'd', max: 'e', yAxis: 'v', capWidth: 10, outliers: 'o' }] });
    expect(ofSeries(chart.last(), 'points', 0)[0]!.xy.length).toBe(2);
    expect(chart.rec.committed!.reader.table!.row(0)!.at(-1)).toBe('9');
    chart.destroy();
  });

  it('draws the new layer configuration after the update', () => {
    const before = n5run({ ...base, layers: [{ type: 'line', y: 'a', yAxis: 'v' }] });
    const after = n5run({ ...base, layers: [{ type: 'scatter', y: 'a', yAxis: 'v', size: 9 }] });
    expect(marksOf(before, 'path', 0)).toHaveLength(1);
    expect(marksOf(after, 'path', 0)).toHaveLength(0);
    expect(marksOf(after, 'points', 0)[0]!.size).toBe(9);
  });
});

describe('N5 repair: compound domain fit and outlier eligibility (finding 2)', () => {
  it('fits a hidden interval-only log axis from the rows its mark can draw', () => {
    const options = {
      data: [
        { x: 1, v: 5, lo: 100, hi: 1000 }, { x: 2, v: 6, lo: 0, hi: 1e6 }, { x: 3, v: 7, lo: null, hi: 1e5 },
      ],
      x: 'x',
      axes: { l: { position: 'left' }, r: { position: 'right', scale: 'log' } },
      layers: [{ type: 'line', y: 'v', yAxis: 'l' }, { type: 'range', low: 'lo', high: 'hi', yAxis: 'r', label: 'Span' }],
    };
    const shown = n5run(options);
    // Only row 0 can draw the range (row 1's low is 0 on a log axis, row 2 has no low): [100, 1000].
    expect(shown.view.yDomains![1]).toEqual([100, 1000]);
    const hidden = n5run(options, { hidden: ['lo'] });
    // All marks on the axis hidden: the full-data positive domain of its bound series (RFC C4.1 §4.4), still
    // from drawable rows only, so neither 1e5 nor 1e6 reaches it.
    expect(hidden.view.yDomains![1]).toEqual([100, 1000]);
    expect(hidden.lookup.tooltip({ kind: 'x', x: 1 }).rows.map(r => r.seriesLabel)).toEqual(['v']);
  });

  it('counts, fits, draws and picks the same outliers: only those of a drawable box', () => {
    const options = {
      data: [
        { x: 1, mn: 1, q1: 2, md: 3, q3: 4, mx: 5, out: [9] },
        // q1 missing: no box is drawn here, so its outlier 51 is neither drawn nor fitted.
        { x: 2, mn: 1, q1: null, md: 3, q3: 4, mx: 5, out: [51] },
      ],
      x: 'x',
      axes: { v: { position: 'left' } },
      layers: [{ type: 'boxplot', min: 'mn', q1: 'q1', median: 'md', q3: 'q3', max: 'mx', outliers: 'out', yAxis: 'v' }],
    };
    const run = n5run(options);
    expect(run.view.yDomain[1]).toBeLessThan(51);
    expect(run.view.yDomain[1]).toBeGreaterThanOrEqual(9);
    const points = marksOf(run, 'points', 0);
    expect(points).toHaveLength(1);
    expect(points[0]!.xy.length).toBe(2);
    const y = yScaleOf(run.layout, 0);
    expect(points[0]!.xy[1]).toBeCloseTo(position(y, 9), 3);
    expect(marksOf(run, 'rects', 0)[0]!.xywh.length).toBe(4);
  });

  it('reports nonpositive outliers of a log box once for the field and draws the positive ones', () => {
    const run = n5run({
      data: [{ x: 1, mn: 2, q1: 3, md: 4, q3: 5, mx: 6, out: [-1, 0, 50] }, { x: 2, mn: 2, q1: 3, md: 4, q3: 5, mx: 6, out: [] }],
      x: 'x',
      axes: { v: { position: 'left', scale: 'log' } },
      layers: [{ type: 'boxplot', min: 'mn', q1: 'q1', median: 'md', q3: 'q3', max: 'mx', outliers: 'out', yAxis: 'v' }],
    });
    const ax171 = run.diagnostics.filter(d => d.code === 'AX171');
    expect(ax171.map(d => [d.field, d.count])).toEqual([['out', 2]]);
    const points = marksOf(run, 'points', 0);
    expect(points[0]!.xy.length).toBe(2);
    expect(run.view.yDomain[1]).toBeGreaterThanOrEqual(50);
    // The readouts keep them, marked as any value the log axis does not plot.
    expect(run.reader.table!.row(0)![6]).toBe('-1 (not plotted — log), 0 (not plotted — log), 50');
    expect(run.lookup.tooltip({ kind: 'x', x: 1 }).rows[0]!.value).toBe('median 4 (min 2, Q1 3, Q3 5, max 6; outliers -1 (not plotted), 0 (not plotted), 50)');
  });
});

describe('N5 repair: picking follows the painted geometry (finding 3)', () => {
  const key = (run: ReturnType<typeof n5run>, x: number, y: number) => {
    const target = run.lookup.pick(x, y);
    const primary = target ? run.lookup.primary(target) : null;
    return primary?.kind === 'aligned' ? [primary.seriesKey, primary.x] : null;
  };

  it('picks a scatter point at the neighbouring x within 24 px over a line at the nearest x', () => {
    const data = Array.from({ length: 100 }, (_, i) => ({ x: i, l: 0, s: i === 51 ? 50 : null }));
    const run = n5run({
      data, x: 'x', axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [{ type: 'line', y: 'l', yAxis: 'v' }, { type: 'scatter', y: 's', yAxis: 'v' }],
    });
    const y = yScaleOf(run.layout, 0);
    const px50 = xPixel(run.layout, run.view, 50), px51 = xPixel(run.layout, run.view, 51);
    expect(px51 - px50).toBeLessThan(24);
    // The pointer is on slot 50, level with the scatter point of slot 51: the point is the nearer mark.
    expect(key(run, px50, position(y, 50))).toEqual(['s', 51]);
    expect(run.lookup.anchor({ kind: 'aligned', seriesKey: 's', x: 51 })!.x + 5).toBeCloseTo(px51, 3);
  });

  it('picks a range inside its band between slots, and not the empty space beside a whisker', () => {
    const run = n5run({
      data: [
        { x: 1, lo: 10, hi: 20, elo: 60, ehi: 80, m: 70, l: 95 },
        { x: 2, lo: 30, hi: 40, elo: 60, ehi: 80, m: 70, l: 95 },
      ],
      x: 'x', axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [
        { type: 'line', y: 'l', yAxis: 'v' },
        { type: 'range', low: 'lo', high: 'hi', yAxis: 'v', label: 'Band' },
        { type: 'errorBar', y: 'm', low: 'elo', high: 'ehi', yAxis: 'v', capWidth: 6, label: 'Err' },
      ],
    });
    const y = yScaleOf(run.layout, 0);
    const p0 = xPixel(run.layout, run.view, 0), p1 = xPixel(run.layout, run.view, 1);
    // A quarter of the way from slot 0 to 1 the band spans 15 to 25; 20 is inside it.
    expect(key(run, p0 + (p1 - p0) / 4, position(y, 20))).toEqual(['lo', 1]);
    // On the whisker of slot 0 at 65 (between the centre 70 and the low 60, more than 4.5 + 3 px from the centre).
    expect(key(run, p0, position(y, 62))).toEqual(['m', 1]);
    // 20 px beside that whisker is empty: the error bar is not picked there (the first series is the fallback).
    expect(key(run, p0 + 20, position(y, 62))).toEqual(['l', 1]);
  });

  it('picks a box by its rectangle and its whisker, and its outlier as a point', () => {
    const run = n5run({
      data: [{ x: 1, mn: 10, q1: 30, md: 40, q3: 50, mx: 70, out: [90], l: 5 }, { x: 2, mn: 10, q1: 30, md: 40, q3: 50, mx: 70, out: [], l: 5 }],
      x: 'x', axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [
        { type: 'line', y: 'l', yAxis: 'v' },
        { type: 'boxplot', min: 'mn', q1: 'q1', median: 'md', q3: 'q3', max: 'mx', outliers: 'out', yAxis: 'v', label: 'Box' },
      ],
    });
    const y = yScaleOf(run.layout, 0);
    const p0 = xPixel(run.layout, run.view, 0);
    expect(key(run, p0 + 2, position(y, 45))).toEqual(['md', 1]);
    expect(key(run, p0, position(y, 60))).toEqual(['md', 1]);
    expect(key(run, p0 + 4, position(y, 90))).toEqual(['md', 1]);
    expect(run.lookup.anchor({ kind: 'aligned', seriesKey: 'md', x: 1 })!.y + 5).toBeCloseTo(position(y, 90), 3);
  });
});

describe('N5 repair: annotations a log axis cannot place (finding 6)', () => {
  it('reports a y annotation at or below zero on a log axis and leaves it out', () => {
    const options = {
      data: [{ x: 1, v: 10 }, { x: 2, v: 100 }], x: 'x',
      axes: { v: { position: 'left', scale: 'log' } },
      layers: [{ type: 'line', y: 'v', yAxis: 'v' }],
      annotations: [
        { type: 'threshold', axis: 'y', value: 0, label: 'Zero' },
        { type: 'threshold', axis: 'y', value: 50, label: 'Fifty' },
      ],
    };
    const diagnostics = validateCartesian(options as never);
    const ax171 = diagnostics.filter(d => d.code === 'AX171');
    expect(ax171.map(d => d.field)).toEqual(['annotations[0].value']);
    expect(ax171[0]!.level).toBe('warning');
    const parsed = parseCartesianInput(options);
    expect(parsed.meta.annotations.map(a => a.label)).toEqual(['Fifty']);
    // The finding is part of the options signature, so a strict update is judged on it.
    expect(encodingChanged(translated({ ...options, annotations: [options.annotations[1]] }), parsed.translated)).toBe(true);
  });
});
