/**
 * N5 repair round 2 (cross-provider review of the bundle-cutter candidate, findings 2 and 3, plus view reuse).
 * Expected values are derived by hand from the fixtures and the spec: a range is painted between its sorted bounds
 * (scene hiAt/loAt) and bridged across SLOT_NO_ROW like a line (contracts.ts SLOT_NO_ROW); 3.6 picks a point within
 * 24 px; a glyph the plot clips away entirely is not on screen. Nothing here was pasted from a run.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { SLOT_NO_ROW, SLOT_VALUE, type AlignedView, type DatumRef, type Lookup } from '../../src/core/contracts';
import { strictViolations } from '../../src/core/delivery';
import { position } from '../../src/scene/geometry';
import {
  MEDIAN_WIDTH, WHISKER_WIDTH, boxHalfWidth, markOf, physicalOf, projectCompound, type CompoundSink,
} from '../../src/cartesian/boxplot';
import { axisScaleOf } from '../../src/cartesian/scale-ref';
import { xSlotPixel } from '../../src/cartesian/bar-geom';
import { createCartesianLookup } from '../../src/cartesian/lookup';
import { buildCartesianScene } from '../../src/cartesian/scene';
import { buildCartesianView } from '../../src/cartesian/view';
import { DiagnosticCollector } from '../../src/diagnostics/collector';
import { defaultMessages } from '../../src/messages';
import { marksOf, n5run, plotOf, xPixel, yScaleOf } from './n5-pipeline';

const crossing = (extra: Record<string, unknown>[] = []) => ({
  data: [
    { x: 1, lo: 10, hi: 90, l: 300 },
    { x: 2, lo: 90, hi: 10, l: 300 },
    { x: 3, lo: 40, hi: 60, l: 300 },
    ...extra,
  ],
  x: 'x',
  axes: { v: { position: 'left', domain: [0, 320] } },
  layers: [{ type: 'line', y: 'l', yAxis: 'v' }, { type: 'range', low: 'lo', high: 'hi', yAxis: 'v', label: 'Band' }],
});

const keyOf = (ref: DatumRef | null | undefined) => ref?.kind === 'aligned' ? ref.seriesKey : null;
const pickedKey = (run: { lookup: Lookup }, x: number, y: number) => {
  const target = run.lookup.pick(x, y);
  return target ? keyOf(run.lookup.primary(target)) : null;
};

describe('N5 repair 2: range picking follows the painted band', () => {
  it('picks a band whose bounds swap between slots, inside the painted sorted span', () => {
    const run = n5run(crossing());
    const scale = yScaleOf(run.layout, 0);
    const x0 = xPixel(run.layout, run.view, 0), x1 = xPixel(run.layout, run.view, 1);
    // 45 % of the way from x = 1 to x = 2. Painted: top 90 → 90, bottom 10 → 10, so y = 25 is inside.
    // Interpolating the raw fields would give low 46 and high 54 there, and y = 25 would miss the band.
    const px = x0 + 0.45 * (x1 - x0);
    expect(pickedKey(run, px, position(scale, 25))).toBe('lo');
    // Above the painted top (90) and far from the line (300): no mark wins; the slot falls back to the first series.
    expect(pickedKey(run, px, position(scale, 150))).toBe('l');
  });

  it('bridges a slot with no row, as the scene does, and reads the nearer drawn row', () => {
    const run = n5run(crossing());
    // No data fixture yields SLOT_NO_ROW for one layer of a single table, so the published row mask is edited as
    // n4-f10-reader.test.ts edits slot states. The scene and the lookup both read this mask.
    const rows = physicalOf(run.view).rows![1]!;
    rows[1] = SLOT_NO_ROW;
    const scene = buildCartesianScene(run.stateRef, run.view, run.layout, 1);
    const band = scene.marks.find(m => m.type === 'area' && m.series === 1);
    expect(band && band.type === 'area' ? Array.from(band.runs) : null).toEqual([0, 2, 0, 2]);
    const lookup = createCartesianLookup(run.stateRef, run.view, run.layout, run.formatters, defaultMessages);
    const scale = yScaleOf(run.layout, 0);
    const x0 = xPixel(run.layout, run.view, 0), x1 = xPixel(run.layout, run.view, 1), x2 = xPixel(run.layout, run.view, 2);
    // Just right of x = 2: 55 % of the way from x = 1 (10–90) to x = 3 (40–60): bounds 26.5–73.5.
    const px = x1 + 0.1 * (x2 - x1), t = (px - x0) / (x2 - x0);
    const lo = 10 + t * 30, hi = 90 - t * 30;
    const mid = position(scale, (lo + hi) / 2);
    const target = lookup.pick(px, mid);
    expect(target).toEqual({ kind: 'x', x: 3 });
    expect(keyOf(lookup.primary(target!))).toBe('lo');
    expect(lookup.tooltip(target!).rows.find(r => r.seriesLabel === 'Band')?.value).toBe('40 – 60');
    // Outside the bridged band (below its bottom) the range is not picked.
    expect(pickedKey({ lookup }, px, position(scale, lo - 8))).toBe('l');
  });
});

describe('N5 repair 2: fully clipped glyphs never win a pick', () => {
  const clipped = (y: number) => ({
    data: [{ x: 1, s: y, l: 10 }, { x: 2, s: 50, l: 10 }, { x: 3, s: 50, l: 10 }], x: 'x',
    axes: { v: { position: 'left', domain: [0, 100] } },
    layers: [{ type: 'line', y: 'l', yAxis: 'v' }, { type: 'scatter', y: 's', yAxis: 'v', size: 4, label: 'Points' }],
  });

  it('rejects a size-4 point drawn wholly above a pinned domain, keeps one that still shows', () => {
    const probe = n5run(clipped(50));
    const plot = plotOf(probe.layout).plot, scale = yScaleOf(probe.layout, 0);
    const perPx = (scale.domain[1] - scale.domain[0]) / plot.height;
    const px = xPixel(probe.layout, probe.view, 0);
    // Centre 4 px above the top: the 4 px glyph (radius 2) is wholly clipped, yet only 5 px from the pointer.
    const hidden = n5run(clipped(scale.domain[1] + 4 * perPx));
    expect(position(yScaleOf(hidden.layout, 0), scale.domain[1] + 4 * perPx)).toBeCloseTo(plot.y - 4, 6);
    expect(pickedKey(hidden, px, plot.y + 1)).toBe('l');
    // Centre 1 px above the top still paints the lower half of its glyph: it stays pickable.
    const shown = n5run(clipped(scale.domain[1] + perPx));
    expect(pickedKey(shown, px, plot.y + 1)).toBe('s');
  });
});

describe('N5 repair 2: compound summaries read drawn rows only', () => {
  const band = (data: Record<string, unknown>[], scale = 'linear') => ({
    data, x: 'x', axes: { v: { position: 'left', scale } },
    layers: [{ type: 'range', low: 'lo', high: { field: 'hi', format: { minimumFractionDigits: 1 } }, yAxis: 'v', label: 'Band' }],
  });

  it('ignores an unpaired low bound for extrema and the latest reading, and keeps it in the table', () => {
    const run = n5run(band([{ x: 1, lo: 10, hi: 20 }, { x: 2, lo: 100 }]));
    expect(run.reader.summary).toContain('Band: minimum 10, maximum 20.0, last 10 – 20.0.');
    expect(run.reader.summary).not.toContain('100');
    expect(run.reader.table!.row(1)).toEqual(['2', '100 – No data']);
  });

  it('ignores a range row a log axis rejects, and keeps its raw value marked in the table', () => {
    const run = n5run(band([{ x: 1, lo: 10, hi: 100 }, { x: 2, lo: 0, hi: 100 }], 'log'));
    expect(run.reader.summary).toContain('Band: minimum 10, maximum 100.0, last 10 – 100.0.');
    expect(run.reader.table!.row(1)).toEqual(['2', '0 (not plotted — log) – 100.0']);
  });

  it('reads box outliers only at drawn rows', () => {
    const run = n5run({
      data: [
        { x: 1, mn: 1, q1: 2, md: 3, q3: 4, mx: 5, out: [9] },
        { x: 2, mn: 1, q1: 2, md: null, q3: 4, mx: 5, out: [50] },
      ],
      x: 'x', axes: { v: { position: 'left' } },
      layers: [{ type: 'boxplot', min: 'mn', q1: 'q1', median: 'md', q3: 'q3', max: 'mx', outliers: 'out', yAxis: 'v', label: 'Box' }],
    });
    // Row 2 has no median, so its box and its outlier 50 are not drawn: the maximum is row 1's outlier 9.
    expect(run.reader.summary).toContain('Box: minimum 1, maximum 9, last median 3.');
  });
});

describe('N5 repair 2: annotation fields', () => {
  const base = {
    data: [{ x: 1, y: 1 }, { x: 2, y: 4 }, { x: 3, y: 9 }], x: 'x',
    axes: { v: { position: 'left' }, w: { position: 'right' } },
    layers: [{ type: 'line', y: 'y', yAxis: 'v' }],
  };
  const valid = { type: 'point', x: 2, y: 4, label: 'Peak' };

  it('reports a non-string label, axisId or description by its indexed path and draws nothing for it', () => {
    const run = n5run({ ...base, annotations: [
      valid,
      { type: 'point', x: 2, y: 4, label: 5 },
      { type: 'threshold', axis: 'y', value: 3, label: 'Wrong axis', axisId: 1 },
      { type: 'point', x: 3, y: 9, label: 'Described', description: { text: 'x' } },
    ] });
    const fields = strictViolations(run.diagnostics).map(d => d.field);
    expect(fields).toEqual(expect.arrayContaining(['annotations[1].label', 'annotations[2].axisId', 'annotations[3].description']));
    expect(run.stateRef.meta.annotations).toHaveLength(1);
    expect(run.reader.summary).toContain('Annotation Peak');
    expect(run.reader.summary).not.toContain('Wrong axis');
    expect(run.reader.summary).not.toContain('Described');
    // The lenient call is clean once the fields are corrected (strict rollback has nothing to reject).
    expect(strictViolations(n5run({ ...base, annotations: [valid] }).diagnostics)).toEqual([]);
  });

  it('names the indexed x field it cannot place and leaves that annotation out of the summary', () => {
    const run = n5run({ ...base, annotations: [
      { type: 'point', x: 'soon', y: 4, label: 'Bad x' },
      valid,
      { type: 'range', axis: 'x', from: 1, to: 'later', label: 'Bad end' },
    ] });
    const fields = strictViolations(run.diagnostics).map(d => d.field);
    expect(fields).toEqual(expect.arrayContaining(['annotations[0].x', 'annotations[2].to']));
    expect(fields).not.toContain('annotations');
    expect(run.reader.summary).toContain('Annotation Peak');
    expect(run.reader.summary).not.toContain('Bad x');
    expect(run.reader.summary).not.toContain('Bad end');
  });
});

describe('N5 repair 2: same-frame view reuse', () => {
  const input = {
    data: [{ x: 1, a: 1, lo: 1, hi: 3 }, { x: 2, a: 2, lo: 2, hi: 4 }, { x: 3, a: 3, lo: 3, hi: 5 }], x: 'x',
    axes: { v: { position: 'left' } },
    layers: [{ type: 'line', y: 'a', yAxis: 'v' }, { type: 'range', low: 'lo', high: 'hi', yAxis: 'v', label: 'Band' }],
  };
  const again = (run: ReturnType<typeof n5run>, previous: AlignedView, hidden: string[], zoom: [number, number] | null = null) =>
    buildCartesianView(run.stateRef, run.frame, {
      kind: 'line', hidden: new Set(hidden), zoom: zoom as never, xField: undefined as never, xDomain: undefined as never,
      valueDomain: null, valueField: undefined, references: [], previous, stacked: false, horizontal: false, compact: false,
    }, new DiagnosticCollector());

  it('keeps xFull, the visible window and the draw windows by identity on a legend toggle', () => {
    const run = n5run(input);
    const first = again(run, run.view, []);
    const toggled = again(run, first, ['lo']);
    expect(toggled.xFull).toBe(first.xFull);
    expect(toggled.xDomain).toBe(first.xDomain);
    expect(toggled.visibleSlots).toBe(first.visibleSlots);
    expect(toggled.drawSlots).toBe(first.drawSlots);
    expect(toggled.visible).toEqual([true, false]);
    // A zoom changes the window: new slot ranges, same full span.
    const zoomed = again(run, toggled, ['lo'], [2, 3]);
    expect(zoomed.xFull).toBe(first.xFull);
    expect(zoomed.visibleSlots).not.toBe(first.visibleSlots);
    expect(zoomed.visibleSlots).toEqual({ start: 1, end: 3 });
    // A new frame is never mistaken for the old one.
    const fresh = n5run(input, { previous: toggled });
    expect(fresh.view.drawSlots).not.toBe(first.drawSlots);
  });
});

describe('N5 repair 2: summary formatters beside a stacked percent bar', () => {
  it('formats a stacked percent bar with its own formatter and a log range from its drawn rows only', () => {
    const run = n5run({
      data: [
        { x: 1, a: 0.25, b: 0.5, lo: 10, hi: 100 },
        { x: 2, a: 0.5, b: 0.25, lo: 0, hi: 1000 },
      ],
      x: 'x',
      axes: { share: { position: 'left' }, ms: { position: 'right', scale: 'log' } },
      layers: [
        { type: 'bar', y: [{ field: 'a', format: { style: 'percent' } }, { field: 'b', format: { style: 'percent' } }], stacked: true, yAxis: 'share' },
        { type: 'range', low: 'lo', high: 'hi', yAxis: 'ms', label: 'Band' },
      ],
    });
    // Each bar series is summarized from its own raw values (25 %, 50 %), not its stacked top.
    expect(run.reader.summary).toContain('a: minimum 25%, maximum 50%, last 50%.');
    expect(run.reader.summary).toContain('b: minimum 25%, maximum 50%, last 25%.');
    // Row 2's low bound is 0, which the log axis rejects, so the band reads row 1 only; 1000 is not announced.
    expect(run.reader.summary).toContain('Band: minimum 10, maximum 100, last 10 – 100.');
    expect(run.reader.summary).not.toContain('1,000');
    expect(run.reader.table!.row(1)).toEqual(['2', '50%', '25%', '0 (not plotted — log) – 1,000']);
  });
});

describe('N5 repair 3: cap-crossing picks, clipped error-bar centres, same-x transitions, and annotation validation', () => {
  it('picks a 100 px error-bar cap across an ~82.5 px slot boundary and aligns x, readout, and anchor', () => {
    // 7 slots in a 600 px chart (~495 px plot -> ~82.5 px between slots), capWidth = 100 (half = 50 px > 41.25 px).
    const run = n5run({
      data: [
        { x: 1, lo: 20, hi: 30, l: 95 },
        { x: 2, lo: 60, hi: 70, l: 95 },
        { x: 3, lo: 60, hi: 70, l: 95 },
        { x: 4, lo: 60, hi: 70, l: 95 },
        { x: 5, lo: 60, hi: 70, l: 95 },
        { x: 6, lo: 60, hi: 70, l: 95 },
        { x: 7, lo: 60, hi: 70, l: 95 },
      ],
      x: 'x',
      axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [
        { type: 'line', y: 'l', yAxis: 'v' },
        { type: 'errorBar', low: 'lo', high: 'hi', yAxis: 'v', label: 'Err', capWidth: 100 },
      ],
    }, { width: 550 });
    const x0 = xPixel(run.layout, run.view, 0), x1 = xPixel(run.layout, run.view, 1);
    expect(x1 - x0).toBeLessThan(95);
    const scale = yScaleOf(run.layout, 0);
    // Point visibly on slot 0's upper cap (y = 30), past the midpoint toward slot 1 (closer to x = 2 than x = 1).
    const px = x0 + 46;
    expect(px).toBeGreaterThan((x0 + x1) / 2);
    expect(px).toBeLessThan(x0 + 50);
    const target = run.lookup.pick(px, position(scale, 30));
    expect(target).toEqual({ kind: 'x', x: 1 });
    const primary = run.lookup.primary(target!);
    expect(primary).toEqual({ kind: 'aligned', seriesKey: 'lo', x: 1 });
    expect(run.lookup.datum(primary!)?.value).toBe('20 – 30');
    expect(run.lookup.tooltip(target!).rows.find(r => r.seriesLabel === 'Err')?.value).toBe('20 – 30');
    const anchor = run.lookup.anchor(primary!);
    expect(anchor).not.toBeNull();
    expect(anchor!.x + anchor!.width / 2).toBeCloseTo(x0, 4);
  });

  it('picks a 100 px boxplot cap across a slot boundary and aligns x, readout, and anchor', () => {
    const run = n5run({
      data: [
        { x: 1, mn: 10, q1: 15, md: 20, q3: 25, mx: 30, l: 95 },
        { x: 2, mn: 50, q1: 55, md: 60, q3: 65, mx: 70, l: 95 },
        { x: 3, mn: 50, q1: 55, md: 60, q3: 65, mx: 70, l: 95 },
        { x: 4, mn: 50, q1: 55, md: 60, q3: 65, mx: 70, l: 95 },
        { x: 5, mn: 50, q1: 55, md: 60, q3: 65, mx: 70, l: 95 },
        { x: 6, mn: 50, q1: 55, md: 60, q3: 65, mx: 70, l: 95 },
        { x: 7, mn: 50, q1: 55, md: 60, q3: 65, mx: 70, l: 95 },
      ],
      x: 'x',
      axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [
        { type: 'line', y: 'l', yAxis: 'v' },
        { type: 'boxplot', min: 'mn', q1: 'q1', median: 'md', q3: 'q3', max: 'mx', yAxis: 'v', label: 'Box', capWidth: 100 },
      ],
    }, { width: 550 });
    const x0 = xPixel(run.layout, run.view, 0), x1 = xPixel(run.layout, run.view, 1);
    const scale = yScaleOf(run.layout, 0);
    const px = x0 + 46;
    expect(px).toBeGreaterThan((x0 + x1) / 2);
    const target = run.lookup.pick(px, position(scale, 30));
    expect(target).toEqual({ kind: 'x', x: 1 });
    const primary = run.lookup.primary(target!);
    expect(primary).toEqual({ kind: 'aligned', seriesKey: 'md', x: 1 });
    expect(run.lookup.datum(primary!)?.value).toContain('median 20');
    const anchor = run.lookup.anchor(primary!);
    expect(anchor).not.toBeNull();
    expect(anchor!.x + anchor!.width / 2).toBeCloseTo(x0, 4);
  });

  it('clips an error-bar centre by its actual rendered marker half-extent (2.25 px)', () => {
    const mk = (c: number) => ({
      data: [
        { x: 1, c, lo: 10, hi: 20, l: 50 },
        { x: 2, c: 50, lo: 40, hi: 60, l: 50 },
        { x: 3, c: 50, lo: 40, hi: 60, l: 50 },
      ],
      x: 'x',
      axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [
        { type: 'line', y: 'l', yAxis: 'v' },
        { type: 'errorBar', y: 'c', low: 'lo', high: 'hi', yAxis: 'v', label: 'Err', capWidth: 8 },
      ],
    });
    const probe = n5run(mk(50));
    const plot = plotOf(probe.layout).plot, scale = yScaleOf(probe.layout, 0);
    const perPx = (scale.domain[1] - scale.domain[0]) / plot.height;
    const px = xPixel(probe.layout, probe.view, 0);
    // Centre 4 px above plot top: rendered half-extent is 2.25 px so it is wholly clipped, even though 5 px from plot.y + 1.
    const clipped4 = n5run(mk(scale.domain[1] + 4 * perPx));
    expect(pickedKey(clipped4, px, plot.y + 1)).toBe('l');
    // Centre 7 px above plot top: wholly clipped (previously won within size + slack = 7.5 px).
    const clipped7 = n5run(mk(scale.domain[1] + 7 * perPx));
    expect(pickedKey(clipped7, px, plot.y)).toBe('l');
    // Centre 1 px above plot top: lower half is still painted on screen, so it remains pickable.
    const partial = n5run(mk(scale.domain[1] + 1 * perPx));
    expect(pickedKey(partial, px, plot.y + 1)).toBe('c');
  });

  it('switches winning primary and anchor between marks at the exact same x in lookup', () => {
    const run = n5run({
      data: [
        { x: 1, b: 10, a: 80 },
        { x: 2, b: 20, a: 80 },
        { x: 3, b: 30, a: 80 },
      ],
      x: 'x',
      axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [
        { type: 'line', y: 'b', yAxis: 'v' },
        { type: 'scatter', y: 'a', yAxis: 'v', label: 'Points' },
      ],
    });
    const px = xPixel(run.layout, run.view, 1), scale = yScaleOf(run.layout, 0);
    const pyScatter = position(scale, 80), pyLine = position(scale, 20);
    const t1 = run.lookup.pick(px, pyScatter);
    expect(t1).toEqual({ kind: 'x', x: 2 });
    const p1 = run.lookup.primary(t1!);
    expect(p1).toEqual({ kind: 'aligned', seriesKey: 'a', x: 2 });
    expect(run.lookup.anchor(p1!)!.y + 5).toBeCloseTo(pyScatter, 4);

    // Move vertically at the exact same x = 2 to the line vertex: primary and anchor switch cleanly.
    const t2 = run.lookup.pick(px, pyLine);
    expect(t2).toEqual({ kind: 'x', x: 2 });
    const p2 = run.lookup.primary(t2!);
    expect(p2).toEqual({ kind: 'aligned', seriesKey: 'b', x: 2 });
    expect(run.lookup.anchor(p2!)!.y + 5).toBeCloseTo(pyLine, 4);
  });

  it('formats annotation x in summaries from the resolved axis coordinate (timezone-aware ISO strings)', () => {
    const iso = '2026-05-06T15:00:00Z';
    const run = n5run({
      data: [
        { t: '2026-05-06T14:00:00Z', y: 10 },
        { t: iso, y: 20 },
        { t: '2026-05-06T16:00:00Z', y: 15 },
      ],
      x: { field: 't', timeZone: 'America/New_York' },
      axes: { v: { position: 'left' } },
      layers: [{ type: 'line', y: 'y', yAxis: 'v' }],
      annotations: [
        { type: 'point', x: iso, y: 20, label: 'Event' },
        { type: 'threshold', axis: 'x', value: iso, label: 'Cut' },
      ],
    });
    const expectedX = run.formatters.x(Date.parse(iso));
    expect(expectedX).not.toBe(iso);
    expect(run.reader.summary).toContain(`Annotation Event at ${expectedX}, 20.`);
    expect(run.reader.summary).toContain(`Threshold Cut at x = ${expectedX}.`);
    expect(run.reader.summary).not.toContain(iso);
  });

  it('rejects axisId on x-only annotations and reports annotations[i].axisId for unknown y-axes (strict-clean)', () => {
    const base = {
      data: [{ x: 1, y: 1 }, { x: 2, y: 4 }], x: 'x',
      axes: { v: { position: 'left' } },
      layers: [{ type: 'line', y: 'y', yAxis: 'v' }],
    };
    const xWithAxis = n5run({
      ...base,
      annotations: [
        { type: 'threshold', axis: 'x', value: 2, axisId: 'v', label: 'BadX' },
        { type: 'range', axis: 'x', from: 1, to: 2, axisId: 'v', label: 'BadRange' },
        { type: 'point', x: 2, y: 4, label: 'Good' },
      ],
    });
    const xViols = strictViolations(xWithAxis.diagnostics);
    expect(xViols.map(d => `${d.code}:${d.field}`)).toEqual(
      expect.arrayContaining(['AX150:annotations[0].axisId', 'AX150:annotations[1].axisId']),
    );
    expect(xWithAxis.stateRef.meta.annotations).toHaveLength(1);
    expect(xWithAxis.reader.summary).toContain('Annotation Good');
    expect(xWithAxis.reader.summary).not.toContain('BadX');
    expect(xWithAxis.reader.summary).not.toContain('BadRange');

    const unknownY = n5run({
      ...base,
      annotations: [
        { type: 'point', x: 2, y: 4, label: 'Good' },
        { type: 'threshold', axis: 'y', value: 3, axisId: 'ghost', label: 'GhostY' },
      ],
    });
    const yViols = strictViolations(unknownY.diagnostics);
    expect(yViols.map(d => `${d.code}:${d.field}`)).toContain('AX174:annotations[1].axisId');
    expect(yViols.map(d => d.field)).not.toContain('ghost');
  });
});

describe('N5 repair 4: clipped/degenerate compound geometry, direct-hit ranking, and required annotation label', () => {
  it('rejects a wholly clipped error-bar cap above plot top and a zero-length capWidth-0 error bar', () => {
    const probe = n5run({
      data: [{ x: 1, lo: 10, hi: 20, l: 50 }, { x: 2, lo: 40, hi: 60, l: 50 }],
      x: 'x', axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [{ type: 'line', y: 'l', yAxis: 'v' }, { type: 'errorBar', low: 'lo', high: 'hi', yAxis: 'v', capWidth: 16 }],
    });
    const plot = plotOf(probe.layout).plot, scale = yScaleOf(probe.layout, 0);
    const perPx = (scale.domain[1] - scale.domain[0]) / plot.height;
    const px0 = xPixel(probe.layout, probe.view, 0);
    // Cap at plot.y - 2 (strokeWidth 1.5 -> [plot.y - 2.75, plot.y - 1.25], wholly above plot.y): must not win at plot.y.
    const clippedCap = n5run({
      data: [
        { x: 1, lo: scale.domain[1] + 2 * perPx, hi: scale.domain[1] + 10 * perPx, l: 50 },
        { x: 2, lo: 40, hi: 60, l: 50 },
      ],
      x: 'x', axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [{ type: 'line', y: 'l', yAxis: 'v' }, { type: 'errorBar', low: 'lo', high: 'hi', yAxis: 'v', capWidth: 16 }],
    });
    expect(pickedKey(clippedCap, px0, plot.y)).toBe('l');

    // Equal bounds + capWidth: 0 + no centre paints a zero-length butt-capped path (nothing visible): must not win.
    const zeroLen = n5run({
      data: [{ x: 1, lo: 25, hi: 25, l: 80 }, { x: 2, lo: 40, hi: 60, l: 80 }],
      x: 'x', axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [{ type: 'line', y: 'l', yAxis: 'v' }, { type: 'errorBar', low: 'lo', high: 'hi', yAxis: 'v', capWidth: 0 }],
    });
    expect(pickedKey(zeroLen, px0, position(yScaleOf(zeroLen.layout, 0), 25))).toBe('l');
  });

  it('ranks a cap directly under the pointer ahead of a nearer-slot cap 2 px away', () => {
    const probe = n5run({
      data: Array.from({ length: 7 }, (_, i) => ({ x: i + 1, lo: 20, hi: 30, l: 95 })),
      x: 'x', axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [{ type: 'line', y: 'l', yAxis: 'v' }, { type: 'errorBar', low: 'lo', high: 'hi', yAxis: 'v', capWidth: 100 }],
    }, { width: 550 });
    const plot = plotOf(probe.layout).plot, scale = yScaleOf(probe.layout, 0);
    const perPx = (scale.domain[1] - scale.domain[0]) / plot.height;
    // Slot 0 upper cap at y = 30; slot 1 upper cap 2 px lower in screen space (still within HIT_SLACK = 3).
    const run = n5run({
      data: [
        { x: 1, lo: 10, hi: 30, l: 95 },
        { x: 2, lo: 10, hi: 30 - 2 * perPx, l: 95 },
        { x: 3, lo: 60, hi: 70, l: 95 },
        { x: 4, lo: 60, hi: 70, l: 95 },
        { x: 5, lo: 60, hi: 70, l: 95 },
        { x: 6, lo: 60, hi: 70, l: 95 },
        { x: 7, lo: 60, hi: 70, l: 95 },
      ],
      x: 'x', axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [{ type: 'line', y: 'l', yAxis: 'v' }, { type: 'errorBar', low: 'lo', high: 'hi', yAxis: 'v', capWidth: 100 }],
    }, { width: 550 });
    const x0 = xPixel(run.layout, run.view, 0), x1 = xPixel(run.layout, run.view, 1);
    const px = x0 + 46; // closer to x1 than x0, yet still on slot 0's 50 px half-cap
    expect(px).toBeGreaterThan((x0 + x1) / 2);
    const target = run.lookup.pick(px, position(yScaleOf(run.layout, 0), 30));
    expect(target).toEqual({ kind: 'x', x: 1 });
  });

  it('omits wholly out-of-domain box rects and keeps genuine in-domain degenerate boxes painted and pickable', () => {
    const outOfDomain = n5run({
      data: [
        { x: 1, mn: 120, q1: 130, md: 140, q3: 150, mx: 160, l: 20 },
        { x: 2, mn: 40, q1: 50, md: 50, q3: 50, mx: 60, l: 20 },
      ],
      x: 'x', axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [
        { type: 'line', y: 'l', yAxis: 'v' },
        { type: 'boxplot', min: 'mn', q1: 'q1', median: 'md', q3: 'q3', max: 'mx', yAxis: 'v', label: 'Box' },
      ],
    });
    // Only slot 1 (in-domain degenerate q1 = q3 = 50) emits a rect; slot 0 (wholly above 100) emits no fake edge strip.
    const rects = marksOf(outOfDomain, 'rects', 1);
    expect(rects).toHaveLength(1);
    expect(rects[0]!.xywh.length).toBe(4);
    const plot = plotOf(outOfDomain.layout).plot, scale = yScaleOf(outOfDomain.layout, 0);
    const x0 = xPixel(outOfDomain.layout, outOfDomain.view, 0), x1 = xPixel(outOfDomain.layout, outOfDomain.view, 1);
    expect(pickedKey(outOfDomain, x0, plot.y)).toBe('l');
    expect(pickedKey(outOfDomain, x1, position(scale, 50))).toBe('md');
  });

  it('requires a string annotation label with indexed AX150 and strict rollback', () => {
    const run = n5run({
      data: [{ x: 1, y: 10 }, { x: 2, y: 20 }], x: 'x',
      axes: { v: { position: 'left' } },
      layers: [{ type: 'line', y: 'y', yAxis: 'v' }],
      annotations: [
        { type: 'point', x: 1, y: 20 },
        { type: 'point', x: 2, y: 20, label: 'Kept' },
      ],
    });
    const viols = strictViolations(run.diagnostics);
    expect(viols.map(d => `${d.code}:${d.field}`)).toContain('AX150:annotations[0].label');
    expect(run.stateRef.meta.annotations.map(a => a.label)).toEqual(['Kept']);
    expect(run.reader.summary).toContain('Annotation Kept at 2, 20.');
    expect(run.reader.summary).not.toContain('Annotation  at 1, 20.');
  });

  it('picks a range at its final painted band endpoint without bridging an explicit gap', () => {
    const run = n5run({
      data: [
        { x: 1, lo: 10, hi: 90, l: 300 },
        { x: 2, lo: 40, hi: 60, l: 300 },
        { x: 3, lo: null, hi: null, l: 300 },
        { x: 4, lo: 20, hi: 80, l: 300 },
        { x: 5, lo: 30, hi: 70, l: 300 },
      ],
      x: 'x',
      axes: { v: { position: 'left', domain: [0, 320] } },
      layers: [
        { type: 'line', y: 'l', yAxis: 'v' },
        { type: 'range', low: 'lo', high: 'hi', yAxis: 'v', label: 'Band' },
      ],
    });
    const band = run.scene.marks.find(m => m.type === 'area' && m.series === 1);
    // Two contiguous painted band runs of 2 vertices each (offset 0 len 2, offset 2 len 2), split by the gap at x = 3.
    expect(band && band.type === 'area' ? Array.from(band.runs) : null).toEqual([0, 2, 0, 2, 2, 2, 2, 2]);
    const scale = yScaleOf(run.layout, 0);
    const x1 = xPixel(run.layout, run.view, 1);
    const x2 = xPixel(run.layout, run.view, 2);
    const x4 = xPixel(run.layout, run.view, 4);
    // Exact final endpoint of the last painted segment (x = 5, span 30–70): must pick the range, not fall back to line 'l'.
    expect(pickedKey(run, x4, position(scale, 50))).toBe('lo');
    // Exact right endpoint of the first segment immediately before the explicit gap (x = 2, span 40–60): must pick the range.
    expect(pickedKey(run, x1, position(scale, 50))).toBe('lo');
    // Explicit gap at x = 3 (and midpoint into the gap between x = 2 and x = 3): must NOT bridge; falls back to line 'l'.
    expect(pickedKey(run, x2, position(scale, 50))).toBe('l');
    expect(pickedKey(run, (x1 + x2) / 2, position(scale, 50))).toBe('l');
  });
});

describe('N5 repair 5: bounded Cartesian picking for ordinary views and dense point marks', () => {
  const candidatesOf = (lookup: Lookup) => (lookup as Lookup & { lastPickCandidates?: number }).lastPickCandidates ?? -1;

  it('keeps line-only and bar-only picking O(log N) with zero neighbor-slot or boxHalfWidth scans on 50,000 clustered slots', () => {
    const n = 50_000;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    x[0] = 0; y[0] = 10;
    for (let i = 1; i < n - 1; i++) { x[i] = 100 + i * 1e-6; y[i] = 50; }
    x[n - 1] = 200; y[n - 1] = 90;

    for (const mark of ['line', 'bar'] as const) {
      const run = n5run({
        data: { columns: { x, y } },
        x: 'x',
        axes: { v: { position: 'left', domain: [0, 100] } },
        layers: [{ type: mark, y: 'y', yAxis: 'v' }],
      });
      const plotLayout = plotOf(run.layout);
      if (plotLayout.projection.kind !== 'xy') throw new Error('expected xy');
      const origX = plotLayout.projection.x;
      const origY = yScaleOf(run.layout, 0);
      let xMaps = 0, yMaps = 0;
      const spiedLayout = {
        ...plotLayout,
        projection: {
          ...plotLayout.projection,
          x: { ...origX, map(v: number) { xMaps++; return origX.map(v); } },
          y: { ...origY, map(v: number) { yMaps++; return origY.map(v); } },
          yAxes: [{ ...origY, map(v: number) { yMaps++; return origY.map(v); } }],
        },
      };
      const lookup = createCartesianLookup(run.stateRef, run.view, spiedLayout, run.formatters, defaultMessages);
      // Construction on line-only views does not run boxHalfWidth across the 50,000 slots.
      if (mark === 'line') expect(xMaps).toBe(0);
      expect(yMaps).toBe(0);
      xMaps = 0; yMaps = 0;

      const px = origX.map(x[25_000]!);
      const py = origY.map(50);
      xMaps = 0;
      const target = lookup.pick(px, py);
      expect(target).not.toBeNull();
      expect(keyOf(lookup.primary(target!))).toBe('y');
      expect(xMaps).toBeLessThanOrEqual(45);
      expect(yMaps).toBeLessThanOrEqual(2);
      expect(candidatesOf(lookup)).toBeLessThanOrEqual(1);
    }
  });

  it('bounds dense scatter picks without dropping a clearly better visible point', () => {
    const n = 50_000;
    const x = new Float64Array(n);
    const s = new Float64Array(n);
    x[0] = 0; s[0] = 0;
    x[1] = 99.5; s[1] = 54; // clearly better visible point at slot 1, before the 50,000-point cluster
    for (let i = 2; i < n - 1; i++) {
      x[i] = 100 + (i - 1) * 1e-6;
      s[i] = 50 + ((i % 100) - 50) * 1e-3;
    }
    x[n - 1] = 200; s[n - 1] = 100;

    const run = n5run({
      data: { columns: { x, s } },
      x: 'x',
      axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [{ type: 'scatter', y: 's', yAxis: 'v', label: 'Pts' }],
    });
    expect(run.diagnostics.filter(d => d.level === 'error')).toEqual([]);
    const pxBetter = xPixel(run.layout, run.view, 1);
    const yScale = yScaleOf(run.layout, 0);
    const pyBetter = position(yScale, 54);
    const hitBetter = run.lookup.pick(pxBetter, pyBetter);
    expect(hitBetter).toEqual({ kind: 'x', x: 99.5 });
    expect(run.lookup.primary(hitBetter!)).toEqual({ kind: 'aligned', seriesKey: 's', x: 99.5 });
    expect(candidatesOf(run.lookup)).toBeLessThan(3_000);

    // Picking inside the 50,000-point cluster stays bounded and returns a cluster slot.
    const clusterTarget = run.lookup.pick(xPixel(run.layout, run.view, 25_000), position(yScale, 50));
    expect(clusterTarget).not.toBeNull();
    expect((clusterTarget as { x: number }).x).toBeGreaterThanOrEqual(100);
    expect((clusterTarget as { x: number }).x).toBeLessThan(100.1);
    expect(candidatesOf(run.lookup)).toBeLessThan(3_000);
  });

  it('bounds dense boxplot outlier picking while finding a distinct outlier', () => {
    const many = Float64Array.from({ length: 50_000 }, (_, i) => 70 + (i % 100) * 0.005);
    many[0] = 92;
    const run = n5run({
      data: [
        { x: 1, mn: 10, q1: 20, md: 30, q3: 40, mx: 50, out: many },
        { x: 2, mn: 10, q1: 20, md: 30, q3: 40, mx: 50, out: [] },
      ],
      x: 'x',
      axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [{ type: 'boxplot', min: 'mn', q1: 'q1', median: 'md', q3: 'q3', max: 'mx', outliers: 'out', yAxis: 'v', label: 'Box' }],
    });
    const px = xPixel(run.layout, run.view, 0);
    const yScale = yScaleOf(run.layout, 0);
    const target = run.lookup.pick(px, position(yScale, 92));
    expect(target).toEqual({ kind: 'x', x: 1 });
    expect(run.lookup.primary(target!)).toEqual({ kind: 'aligned', seriesKey: 'md', x: 1 });
    expect(candidatesOf(run.lookup)).toBeLessThan(3_000);
  });

  it('preserves line vs scatter tie priority and category BandScale scatter picking', () => {
    // Line declared before scatter at identical point -> scatter wins on dist=0 tie.
    const lineFirst = n5run({
      data: [{ x: 1, a: 50, b: 50 }, { x: 2, a: 20, b: 80 }],
      x: 'x', axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [{ type: 'line', y: 'a', yAxis: 'v' }, { type: 'scatter', y: 'b', yAxis: 'v' }],
    });
    const p0 = xPixel(lineFirst.layout, lineFirst.view, 0);
    const py0 = position(yScaleOf(lineFirst.layout, 0), 50);
    expect(pickedKey(lineFirst, p0, py0)).toBe('b');

    // Scatter declared before line at identical point -> line wins on dist=0 tie.
    const scatterFirst = n5run({
      data: [{ x: 1, a: 50, b: 50 }, { x: 2, a: 20, b: 80 }],
      x: 'x', axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [{ type: 'scatter', y: 'b', yAxis: 'v' }, { type: 'line', y: 'a', yAxis: 'v' }],
    });
    expect(pickedKey(scatterFirst, xPixel(scatterFirst.layout, scatterFirst.view, 0), position(yScaleOf(scatterFirst.layout, 0), 50))).toBe('a');

    // Category BandScale x-axis with scatter + line picks scatter across neighbouring slots.
    const bandRun = n5run({
      data: Array.from({ length: 60 }, (_, i) => ({ cat: `C${i}`, l: 10, s: i === 30 ? 80 : null })),
      x: 'cat', axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [{ type: 'line', y: 'l', yAxis: 'v' }, { type: 'scatter', y: 's', yAxis: 'v' }],
    });
    const px29 = xPixel(bandRun.layout, bandRun.view, 29), px30 = xPixel(bandRun.layout, bandRun.view, 30);
    expect(px30 - px29).toBeLessThan(24);
    const hit = bandRun.lookup.pick(px29, position(yScaleOf(bandRun.layout, 0), 80));
    expect(bandRun.lookup.primary(hit!)).toEqual({ kind: 'aligned', seriesKey: 's', x: 30 });
  });
});

describe('N5 lookup exact spatial index: 23.8/24.2 threshold, direct hits, exact ties, and cold vs warm work', () => {
  const candidatesOf = (lookup: Lookup) => (lookup as Lookup & { lastPickCandidates?: number }).lastPickCandidates ?? -1;

  it('preserves 23.8 vs 24.2 px eligibility and direct hits across 2,500+ candidates for scatter', () => {
    const probe = n5run({
      data: [{ x: 0, s: 50, l: 0 }, { x: 200, s: 50, l: 0 }],
      x: 'x', axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [{ type: 'line', y: 'l', yAxis: 'v' }, { type: 'scatter', y: 's', yAxis: 'v' }],
    });
    const proj = plotOf(probe.layout).projection;
    if (proj.kind !== 'xy' || proj.x.type === 'band') throw new Error('expected continuous xy');
    const xScale = proj.x;
    const yScale = yScaleOf(probe.layout, 0);
    const pxPerX = (xScale.range[1] - xScale.range[0]) / (xScale.domain[1] - xScale.domain[0]);
    const pyPerY = (yScale.range[1] - yScale.range[0]) / (yScale.domain[1] - yScale.domain[0]); // negative

    const ptrXVal = 100;
    const ptrYVal = 50;
    const ptrPx = xScale.map(ptrXVal);
    const ptrPy = yScale.map(ptrYVal);

    // Place the eligible point 23.8 px right of pointer, and N dense cluster points 24.2 px right (same 16x16 cell!).
    const xEligible = ptrXVal + 23.8 / pxPerX;
    const makeRun = (denseCount: number) => {
      const n = denseCount + 3;
      const x = new Float64Array(n);
      const s = new Float64Array(n);
      const l = new Float64Array(n);
      x[0] = 0; s[0] = 0; l[0] = 0;
      x[1] = xEligible; s[1] = ptrYVal; l[1] = 0;
      for (let i = 0; i < denseCount; i++) {
        // Strictly ascending x clustered 24.2..24.25 px right of pointer, slightly jittered in y inside the same cell
        x[2 + i] = ptrXVal + (24.2 + (i / denseCount) * 0.05) / pxPerX;
        s[2 + i] = ptrYVal + ((i % 20) - 10) * 0.02 / Math.abs(pyPerY);
        l[2 + i] = 0;
      }
      x[n - 1] = 200; s[n - 1] = 100; l[n - 1] = 0;
      return n5run({
        data: { columns: { x, s, l } }, x: 'x',
        axes: { v: { position: 'left', domain: [0, 100] } },
        layers: [{ type: 'line', y: 'l', yAxis: 'v' }, { type: 'scatter', y: 's', yAxis: 'v' }],
      });
    };

    for (const denseCount of [2_500, 2_501, 4_000]) {
      const run = makeRun(denseCount);
      const target = run.lookup.pick(ptrPx, ptrPy);
      expect(target).toEqual({ kind: 'x', x: xEligible });
      expect(run.lookup.primary(target!)).toEqual({ kind: 'aligned', seriesKey: 's', x: xEligible });

      // Direct hit on the 23.8 px point must also select it, never a farther cluster point.
      const direct = run.lookup.pick(xPixel(run.layout, run.view, 1), position(yScaleOf(run.layout, 0), ptrYVal));
      expect(direct).toEqual({ kind: 'x', x: xEligible });
      expect(run.lookup.primary(direct!)).toEqual({ kind: 'aligned', seriesKey: 's', x: xEligible });
    }
  });

  it('preserves 23.8 vs 24.2 px eligibility and direct hits across 2,500+ candidates for boxplot outliers', () => {
    const probe = n5run({
      data: [
        { x: 0, mn: 1, q1: 2, md: 3, q3: 4, mx: 5, out: [], l: 0 },
        { x: 100, mn: 1, q1: 2, md: 3, q3: 4, mx: 5, out: [], l: 0 },
        { x: 200, mn: 1, q1: 2, md: 3, q3: 4, mx: 5, out: [], l: 0 },
      ],
      x: 'x', axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [
        { type: 'line', y: 'l', yAxis: 'v' },
        { type: 'boxplot', min: 'mn', q1: 'q1', median: 'md', q3: 'q3', max: 'mx', outliers: 'out', yAxis: 'v' },
      ],
    });
    const plot = plotOf(probe.layout).plot;
    const proj = plotOf(probe.layout).projection;
    if (proj.kind !== 'xy' || proj.x.type === 'band') throw new Error('expected continuous xy');
    const xScale = proj.x;
    const yScale = yScaleOf(probe.layout, 0);
    const pxPerX = (xScale.range[1] - xScale.range[0]) / (xScale.domain[1] - xScale.domain[0]);
    const pyPerY = Math.abs((yScale.range[1] - yScale.range[0]) / (yScale.domain[1] - yScale.domain[0]));

    // Slot 1 at x = 100 has the 23.8 px outlier; slot 2 at x = 100 + 0.4 px has dense 24.2 px outliers in the same cell.
    const x1 = 100, x2 = 100 + 0.4 / pxPerX;
    const ptrPx = xScale.map(x1) - 23.8;
    const ptrPy = position(yScale, 60);
    expect(ptrPx).toBeGreaterThan(plot.x);

    const makeBoxRun = (denseCount: number) => {
      const denseOutliers = Float64Array.from({ length: denseCount }, (_, i) => 60 + ((i % 20) - 10) * 0.01 / pyPerY);
      return n5run({
        data: [
          { x: 0, mn: 1, q1: 2, md: 3, q3: 4, mx: 5, out: [], l: 0 },
          { x: x1, mn: 1, q1: 2, md: 3, q3: 4, mx: 5, out: [60], l: 0 },
          { x: x2, mn: 1, q1: 2, md: 3, q3: 4, mx: 5, out: denseOutliers, l: 0 },
          { x: 200, mn: 1, q1: 2, md: 3, q3: 4, mx: 5, out: [], l: 0 },
        ],
        x: 'x', axes: { v: { position: 'left', domain: [0, 100] } },
        layers: [
          { type: 'line', y: 'l', yAxis: 'v' },
          { type: 'boxplot', min: 'mn', q1: 'q1', median: 'md', q3: 'q3', max: 'mx', outliers: 'out', yAxis: 'v' },
        ],
      });
    };

    for (const denseCount of [2_500, 2_501, 4_000]) {
      const run = makeBoxRun(denseCount);
      const target = run.lookup.pick(ptrPx, ptrPy);
      expect(target).toEqual({ kind: 'x', x: x1 });
      expect(run.lookup.primary(target!)).toEqual({ kind: 'aligned', seriesKey: 'md', x: x1 });

      // Direct hit on slot 1's outlier selects x1, not slot 2's dense outlier cluster.
      const direct = run.lookup.pick(xPixel(run.layout, run.view, 1), ptrPy);
      expect(direct).toEqual({ kind: 'x', x: x1 });
      expect(run.lookup.primary(direct!)).toEqual({ kind: 'aligned', seriesKey: 'md', x: x1 });
    }
  });

  it('preserves exact-distance ties across the 2,500 cutoff for both distinct and identical projected coordinates', () => {
    // 1. Symmetric distinct coordinates: x = 97 and x = 103 equidistant from pointer at x = 100, plus dense cluster > 2,500.
    const makeSymScatter = (denseCount: number) => {
      const n = denseCount + 5;
      const x = new Float64Array(n);
      const s = new Float64Array(n);
      x[0] = 0; s[0] = 0;
      x[1] = 97; s[1] = 50;
      for (let i = 0; i < denseCount; i++) {
        x[2 + i] = 100 + (i + 1) * 1e-6;
        s[2 + i] = 35; // 15 px away vertically in the plot (farther than 3 px horizontally, inside 24 px neighborhood)
      }
      x[2 + denseCount] = 103; s[2 + denseCount] = 50;
      x[n - 2] = 105; s[n - 2] = 0;
      x[n - 1] = 200; s[n - 1] = 100;
      return n5run({
        data: { columns: { x, s } }, x: 'x',
        axes: { v: { position: 'left', domain: [0, 100] } },
        layers: [{ type: 'scatter', y: 's', yAxis: 'v' }],
      });
    };

    for (const denseCount of [100, 2_600]) {
      const run = makeSymScatter(denseCount);
      const p = plotOf(run.layout).projection;
      if (p.kind !== 'xy') throw new Error('expected xy');
      const pxMid = (p.x.map(97) + p.x.map(103)) / 2; // exact x = 100 pixel, before cluster slots (> 100)
      const py = p.y.map(50);
      // At x = 100, slot(100) is slot 2 (100.000001) or slot 1 (97); use x = 99.5 where nearestSlot is slot 1 (97)?
      // Test exact slot=100 by placing slot 100 explicitly at x=100 (s=0):
      expect(run.lookup.pick(pxMid, py)).not.toBeNull();
    }

    // Explicit anchor slot at xMid (~97..100), exact IEEE-754 equidistant ties at xLeft (~97) and xRight (~103)
    const tieProbe = n5run({
      data: [{ x: 0, s: 0 }, { x: 97, s: 50 }, { x: 100, s: 0 }, { x: 103, s: 50 }, { x: 200, s: 100 }],
      x: 'x', axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [{ type: 'scatter', y: 's', yAxis: 'v' }],
    });
    const tieProj = plotOf(tieProbe.layout).projection;
    if (tieProj.kind !== 'xy' || tieProj.x.type === 'band') throw new Error('expected xy');
    const findExactX = (px: number, approx: number) => {
      let lo = approx - 5, hi = approx + 5;
      for (let i = 0; i < 64; i++) {
        const m = (lo + hi) / 2;
        if (tieProj.x.map(m) < px) lo = m;
        else hi = m;
      }
      return Math.abs(tieProj.x.map(lo) - px) <= Math.abs(tieProj.x.map(hi) - px) ? lo : hi;
    };
    const pxAnchor = Math.round(tieProj.x.map(100)) - 16;
    const xLeft = findExactX(pxAnchor - 12, 97);
    const xMid = findExactX(pxAnchor, 100);
    const xRight = findExactX(pxAnchor + 12, 103);
    expect(Math.hypot(tieProj.x.map(xLeft) - tieProj.x.map(xMid), 0))
      .toBe(Math.hypot(tieProj.x.map(xRight) - tieProj.x.map(xMid), 0));

    const makeAnchoredTie = (denseCount: number) => {
      const n = denseCount + 6;
      const x = new Float64Array(n);
      const s = new Float64Array(n);
      x[0] = 0; s[0] = 0;
      x[1] = xLeft; s[1] = 50;
      x[2] = xMid; s[2] = 0; // pointer sits at (xMid, 50) (dist 50 from (xMid, 0) -> outside 24 px)
      for (let i = 0; i < denseCount; i++) {
        x[3 + i] = xMid + 0.1 + i * 1e-6;
        s[3 + i] = 35; // farther than 12 px
      }
      x[3 + denseCount] = xRight; s[3 + denseCount] = 50;
      x[n - 2] = 105; s[n - 2] = 0;
      x[n - 1] = 200; s[n - 1] = 100;
      return n5run({
        data: { columns: { x, s } }, x: 'x',
        axes: { v: { position: 'left', domain: [0, 100] } },
        layers: [{ type: 'scatter', y: 's', yAxis: 'v' }],
      });
    };

    for (const denseCount of [100, 2_600]) {
      const run = makeAnchoredTie(denseCount);
      const p = plotOf(run.layout).projection;
      if (p.kind !== 'xy') throw new Error('expected xy');
      const pxMid = p.x.map(xMid);
      const py50 = p.y.map(50);
      // Confirm exact IEEE-754 equidistant in pixel space
      expect(Math.hypot(p.x.map(xLeft) - pxMid, 0)).toBe(Math.hypot(p.x.map(xRight) - pxMid, 0));
      // Nearest slot is xMid; xRight (group 2) beats xLeft (group 1) consistently below & above 2,500
      expect(run.lookup.pick(pxMid, py50)).toEqual({ kind: 'x', x: xRight });
    }

    // 2. Identical projected (px, py) coordinates across > 2,500 cluster: pointer-dependent tie priority!
    const xAsc = new Float64Array(2_606);
    const sAsc = new Float64Array(2_606);
    xAsc[0] = 0; sAsc[0] = 0;
    xAsc[1] = 0.9; sAsc[1] = 0; // slot 1 (before identical-px pair)
    xAsc[2] = 1; sAsc[2] = 50;
    xAsc[3] = 1 + 2 ** -51; sAsc[3] = 50; // 2 ULPs at x=1 -> identical projected pixel on [0, 1000]
    for (let i = 0; i < 2_600; i++) {
      xAsc[4 + i] = 1.001 + i * 1e-6;
      sAsc[4 + i] = 35; // > 2,500 dense neighbors in the same cell
    }
    xAsc[2_604] = 2; sAsc[2_604] = 0; // slot 2604 (after identical-px pair)
    xAsc[2_605] = 1000; sAsc[2_605] = 100;
    const identRun = n5run({
      data: { columns: { x: xAsc, s: sAsc } }, x: 'x',
      axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [{ type: 'scatter', y: 's', yAxis: 'v' }],
    });
    const pI = plotOf(identRun.layout).projection;
    if (pI.kind !== 'xy') throw new Error('expected xy');
    expect(pI.x.map(xAsc[2]!)).toBe(pI.x.map(xAsc[3]!));
    const py50I = pI.y.map(50);
    // Pointer at xAsc[1] (nearestSlot = 1 < 2, 3): both in Group 2 -> larger slot (3) wins!
    expect(identRun.lookup.pick(pI.x.map(xAsc[1]!), py50I)).toEqual({ kind: 'x', x: xAsc[3]! });
    // Pointer at xAsc[2604] (nearestSlot = 2604 > 2, 3): both in Group 1 -> smaller slot (2) wins!
    expect(identRun.lookup.pick(pI.x.map(xAsc[2_604]!), py50I)).toEqual({ kind: 'x', x: xAsc[2]! });

    // 3. Boxplot outliers: equidistant & identical-coordinate ties across > 2,500 outliers in the same cell
    const boxTieRun = n5run({
      data: [
        { x: 0, mn: 1, q1: 2, md: 3, q3: 4, mx: 5, out: [] },
        { x: xLeft, mn: 1, q1: 2, md: 3, q3: 4, mx: 5, out: [50] },
        { x: xMid, mn: 1, q1: 2, md: 3, q3: 4, mx: 5, out: Float64Array.from({ length: 2_600 }, () => 35) },
        { x: xRight, mn: 1, q1: 2, md: 3, q3: 4, mx: 5, out: [50] },
        { x: 200, mn: 1, q1: 2, md: 3, q3: 4, mx: 5, out: [] },
      ],
      x: 'x', axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [{ type: 'boxplot', min: 'mn', q1: 'q1', median: 'md', q3: 'q3', max: 'mx', outliers: 'out', yAxis: 'v' }],
    });
    const pB = plotOf(boxTieRun.layout).projection;
    if (pB.kind !== 'xy') throw new Error('expected xy');
    expect(boxTieRun.lookup.pick(pB.x.map(xMid), pB.y.map(50))).toEqual({ kind: 'x', x: xRight });

    // 4. Boxplot outliers with identical projected (px, py) across > 2,500 identical outliers + pointer-dependent tie
    const boxIdent = n5run({
      data: [
        { x: 0, mn: 1, q1: 2, md: 3, q3: 4, mx: 5, out: [] },
        { x: 0.9, mn: 1, q1: 2, md: 3, q3: 4, mx: 5, out: [] },
        { x: 1, mn: 1, q1: 2, md: 3, q3: 4, mx: 5, out: Float64Array.from({ length: 2_600 }, () => 50) },
        { x: 1 + 2 ** -51, mn: 1, q1: 2, md: 3, q3: 4, mx: 5, out: [50] },
        { x: 2, mn: 1, q1: 2, md: 3, q3: 4, mx: 5, out: [] },
        { x: 1000, mn: 1, q1: 2, md: 3, q3: 4, mx: 5, out: [] },
      ],
      x: 'x', axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [{ type: 'boxplot', min: 'mn', q1: 'q1', median: 'md', q3: 'q3', max: 'mx', outliers: 'out', yAxis: 'v' }],
    });
    const pBI = plotOf(boxIdent.layout).projection;
    if (pBI.kind !== 'xy') throw new Error('expected xy');
    expect(pBI.x.map(1)).toBe(pBI.x.map(1 + 2 ** -51));
    expect(boxIdent.lookup.pick(pBI.x.map(0.9), pBI.y.map(50))).toEqual({ kind: 'x', x: 1 + 2 ** -51 });
    expect(boxIdent.lookup.pick(pBI.x.map(2), pBI.y.map(50))).toEqual({ kind: 'x', x: 1 });
  });

  it('constructs point and compound indexes upfront (0 for ordinary views) and keeps cold misses and first dense-cell visits bounded', () => {
    // 1a. Ordinary line + range view without scatter/boxplot/errorBar skips both point and compound indexing completely on 50,000 slots
    const nOrd = 50_000;
    const ox = Float64Array.from({ length: nOrd }, (_, i) => i);
    const oy = Float64Array.from({ length: nOrd }, () => 30);
    const olo = Float64Array.from({ length: nOrd }, () => 10);
    const ohi = Float64Array.from({ length: nOrd }, () => 50);
    const ordRun = n5run({
      data: { columns: { x: ox, y: oy, lo: olo, hi: ohi } }, x: 'x',
      axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [{ type: 'line', y: 'y', yAxis: 'v' }, { type: 'range', low: 'lo', high: 'hi', yAxis: 'v' }],
    });
    const ordPlotLay = plotOf(ordRun.layout);
    if (ordPlotLay.projection.kind !== 'xy') throw new Error('expected xy');
    let ordYMaps = 0;
    const origOrdY = yScaleOf(ordRun.layout, 0);
    const spiedOrdLay = {
      ...ordPlotLay,
      projection: {
        ...ordPlotLay.projection,
        y: { ...origOrdY, map(v: number) { ordYMaps++; return origOrdY.map(v); } },
        yAxes: [{ ...origOrdY, map(v: number) { ordYMaps++; return origOrdY.map(v); } }],
      },
    };
    const ordLookup = createCartesianLookup(ordRun.stateRef, ordRun.view, spiedOrdLay, ordRun.formatters, defaultMessages);
    expect(ordYMaps).toBe(0);
    ordLookup.pick(ordPlotLay.projection.x.map(25_000), origOrdY.map(80));
    expect(candidatesOf(ordLookup)).toBeLessThanOrEqual(2);

    // 1b. Outlier-free boxplot skips point indexing while pruning misses and bounding compound visits via upfront bounds
    const nBox = 50_000;
    const bx = Float64Array.from({ length: nBox }, (_, i) => i);
    const mn = Float64Array.from({ length: nBox }, () => 10);
    const q1 = Float64Array.from({ length: nBox }, () => 20);
    const md = Float64Array.from({ length: nBox }, () => 30);
    const q3 = Float64Array.from({ length: nBox }, () => 40);
    const mx = Float64Array.from({ length: nBox }, () => 50);
    const boxRun = n5run({
      data: { columns: { x: bx, mn, q1, md, q3, mx } }, x: 'x',
      axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [{ type: 'boxplot', min: 'mn', q1: 'q1', median: 'md', q3: 'q3', max: 'mx', yAxis: 'v' }],
    });
    const boxPlotLay = plotOf(boxRun.layout);
    if (boxPlotLay.projection.kind !== 'xy') throw new Error('expected xy');
    let boxYMaps = 0;
    const origBoxY = yScaleOf(boxRun.layout, 0);
    const spiedBoxLay = {
      ...boxPlotLay,
      projection: {
        ...boxPlotLay.projection,
        y: { ...origBoxY, map(v: number) { boxYMaps++; return origBoxY.map(v); } },
        yAxes: [{ ...origBoxY, map(v: number) { boxYMaps++; return origBoxY.map(v); } }],
      },
    };
    const boxLookup = createCartesianLookup(boxRun.stateRef, boxRun.view, spiedBoxLay, boxRun.formatters, defaultMessages);
    expect(boxYMaps).toBeGreaterThanOrEqual(nBox);
    boxYMaps = 0;
    boxLookup.pick(boxPlotLay.projection.x.map(25_000), origBoxY.map(90));
    expect(boxYMaps).toBe(0);
    expect(candidatesOf(boxLookup)).toBe(0);
    boxLookup.pick(boxPlotLay.projection.x.map(25_000), origBoxY.map(30));
    expect(boxYMaps).toBeLessThanOrEqual(10);
    expect(candidatesOf(boxLookup)).toBeGreaterThanOrEqual(1);
    expect(candidatesOf(boxLookup)).toBeLessThanOrEqual(4);

    // 2. Dense scatter with two separated dense cells (25,000 points each) + empty mid region
    const n = 50_000;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    x[0] = 0; y[0] = 0;
    for (let i = 1; i < 25_000; i++) { x[i] = 100 + i * 1e-6; y[i] = 80 + (i % 50) * 1e-3; }
    for (let i = 25_000; i < n - 1; i++) { x[i] = 300 + (i - 25_000) * 1e-6; y[i] = 20 + (i % 50) * 1e-3; }
    x[n - 1] = 400; y[n - 1] = 100;

    const run = n5run({
      data: { columns: { x, y } }, x: 'x',
      axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [{ type: 'scatter', y: 'y', yAxis: 'v' }],
    });
    const plotLay = plotOf(run.layout);
    if (plotLay.projection.kind !== 'xy') throw new Error('expected xy');
    const origX = plotLay.projection.x, origY = yScaleOf(run.layout, 0);
    let xMaps = 0, yMaps = 0;
    const spiedLay = {
      ...plotLay,
      projection: {
        ...plotLay.projection,
        x: { ...origX, map(v: number) { xMaps++; return origX.map(v); } },
        y: { ...origY, map(v: number) { yMaps++; return origY.map(v); } },
        yAxes: [{ ...origY, map(v: number) { yMaps++; return origY.map(v); } }],
      },
    };
    const lookup = createCartesianLookup(run.stateRef, run.view, spiedLay, run.formatters, defaultMessages);
    // Construction indexes all visible points upfront.
    expect(xMaps).toBeGreaterThanOrEqual(n);
    expect(yMaps).toBeGreaterThanOrEqual(n);
    xMaps = 0; yMaps = 0;

    // Cold miss far from data: 0 candidates examined, 0 yMaps, O(log N) xMaps
    const miss = lookup.pick(origX.map(200), origY.map(50));
    expect(miss).toEqual({ kind: 'x', x: x[24_999]! });
    expect(candidatesOf(lookup)).toBe(0);
    expect(yMaps).toBe(0);
    expect(xMaps).toBeLessThanOrEqual(45);

    // Cold vs warm first visit to dense cell 1 (x = 100.01, y = 80.025)
    xMaps = 0; yMaps = 0;
    const p1x = origX.map(100.01), p1y = origY.map(80.025);
    xMaps = 0;
    const h1Cold = lookup.pick(p1x, p1y);
    const c1Cold = candidatesOf(lookup);
    expect(h1Cold).not.toBeNull();
    expect(yMaps).toBe(0);
    expect(xMaps).toBeLessThanOrEqual(45);
    expect(c1Cold).toBeLessThan(100);
    const h1Warm = lookup.pick(p1x, p1y);
    expect(h1Warm).toEqual(h1Cold);
    expect(candidatesOf(lookup)).toBe(c1Cold);

    // Cold vs warm first visit to dense cell 2 (x = 300.01, y = 20.025)
    xMaps = 0; yMaps = 0;
    const p2x = origX.map(300.01), p2y = origY.map(20.025);
    xMaps = 0;
    const h2Cold = lookup.pick(p2x, p2y);
    const c2Cold = candidatesOf(lookup);
    expect(h2Cold).not.toBeNull();
    expect(yMaps).toBe(0);
    expect(xMaps).toBeLessThanOrEqual(45);
    expect(c2Cold).toBeLessThan(100);
    const h2Warm = lookup.pick(p2x, p2y);
    expect(h2Warm).toEqual(h2Cold);
    expect(candidatesOf(lookup)).toBe(c2Cold);

    // 3. Dense boxplot outliers across two separated cells: cold vs warm visits do zero index work during pick
    const out1 = Float64Array.from({ length: 20_000 }, (_, i) => 70 + (i % 80) * 0.005);
    const out2 = Float64Array.from({ length: 20_000 }, (_, i) => 85 + (i % 80) * 0.005);
    const boxOutRun = n5run({
      data: [
        { x: 1, mn: 10, q1: 20, md: 30, q3: 40, mx: 50, out: out1 },
        { x: 2, mn: 10, q1: 20, md: 30, q3: 40, mx: 50, out: out2 },
      ],
      x: 'x', axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [{ type: 'boxplot', min: 'mn', q1: 'q1', median: 'md', q3: 'q3', max: 'mx', outliers: 'out', yAxis: 'v' }],
    });
    const boLay = plotOf(boxOutRun.layout);
    if (boLay.projection.kind !== 'xy') throw new Error('expected xy');
    const origBoY = yScaleOf(boxOutRun.layout, 0);
    let boYMaps = 0;
    const spiedBoLay = {
      ...boLay,
      projection: {
        ...boLay.projection,
        y: { ...origBoY, map(v: number) { boYMaps++; return origBoY.map(v); } },
        yAxes: [{ ...origBoY, map(v: number) { boYMaps++; return origBoY.map(v); } }],
      },
    };
    const boLookup = createCartesianLookup(boxOutRun.stateRef, boxOutRun.view, spiedBoLay, boxOutRun.formatters, defaultMessages);
    expect(boYMaps).toBeGreaterThanOrEqual(40_000);
    boYMaps = 0;
    const boC1 = boLookup.pick(boLay.projection.x.map(1), origBoY.map(70.2));
    const boCand1 = candidatesOf(boLookup);
    expect(boC1).toEqual({ kind: 'x', x: 1 });
    expect(boYMaps).toBe(0);
    expect(boCand1).toBeLessThan(100);
    expect(boLookup.pick(boLay.projection.x.map(1), origBoY.map(70.2))).toEqual(boC1);
    expect(candidatesOf(boLookup)).toBe(boCand1);
    const boC2 = boLookup.pick(boLay.projection.x.map(2), origBoY.map(85.2));
    const boCand2 = candidatesOf(boLookup);
    expect(boC2).toEqual({ kind: 'x', x: 2 });
    expect(boYMaps).toBe(0);
    expect(boCand2).toBeLessThan(100);
    expect(boLookup.pick(boLay.projection.x.map(2), origBoY.map(85.2))).toEqual(boC2);
    expect(candidatesOf(boLookup)).toBe(boCand2);
  });

  it('matches an exact brute-force scan oracle across random mixed dense clusters, ties, and outliers', () => {
    fc.assert(fc.property(
      fc.array(fc.record({
        dx: fc.integer({ min: 0, max: 40 }),
        ls: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
        sc: fc.option(fc.integer({ min: 0, max: 105 }), { nil: null }),
        o1: fc.option(fc.integer({ min: 40, max: 105 }), { nil: null }),
        o2: fc.option(fc.integer({ min: 40, max: 105 }), { nil: null }),
      }), { minLength: 20, maxLength: 60 }),
      fc.integer({ min: 0, max: 100 }),
      fc.integer({ min: 0, max: 100 }),
      (rawRows, ptrXFrac, ptrYFrac) => {
        // Build strictly ascending x with tight clustering to trigger dense cells & exact ties.
        let curX = 0;
        const data = rawRows.map((r, i) => {
          curX += i === 0 ? 0 : (r.dx === 0 ? 1e-13 : r.dx * 0.05);
          const outs = [r.o1, r.o2].filter((v): v is number => v !== null);
          return { x: curX, l: r.ls, s: r.sc, mn: 10, q1: 15, md: 20, q3: 25, mx: 30, out: outs };
        });
        const run = n5run({
          data, x: 'x',
          axes: { v: { position: 'left', domain: [0, 100] } },
          layers: [
            { type: 'line', y: 'l', yAxis: 'v' },
            { type: 'scatter', y: 's', yAxis: 'v', size: 6 },
            { type: 'boxplot', min: 'mn', q1: 'q1', median: 'md', q3: 'q3', max: 'mx', outliers: 'out', yAxis: 'v' },
          ],
        });
        const plot = plotOf(run.layout).plot;
        const proj = plotOf(run.layout).projection;
        if (proj.kind !== 'xy') return;
        const xPx = plot.x + (ptrXFrac / 100) * plot.width;
        const yPx = plot.y + (ptrYFrac / 100) * plot.height;

        // Naive exact brute-force oracle mirroring slotIndex -> step -1 -> step +1, visible order, CSR outlier order.
        const vals = run.view.frame.x.values;
        const { start, end } = run.view.visibleSlots;
        let nearestSlot = start;
        let minDx = Infinity;
        for (let i = start; i < end; i++) {
          const d = Math.abs(xSlotPixel(proj.x, vals, i) - xPx);
          if (d < minDx) { minDx = d; nearestSlot = i; }
        }
        const inPlot = (px: number, py: number, half: number) =>
          px + half >= plot.x && px - half <= plot.x + plot.width && py + half >= plot.y && py - half <= plot.y + plot.height;

        let bestDist = Infinity;
        let bestSeries = -1;
        let bestSlot = nearestSlot;
        const yScale = axisScaleOf(proj, 0);
        // Check line at nearestSlot
        const lineS = run.view.frame.series[0]!;
        if (lineS.slot[nearestSlot] === SLOT_VALUE) {
          const lx = xSlotPixel(proj.x, vals, nearestSlot);
          const ly = position(yScale, lineS.y[nearestSlot]!);
          if (inPlot(lx, ly, 2)) {
            const d = Math.abs(ly - yPx);
            if (d <= 12 + 1e-6 && d <= bestDist) { bestDist = d; bestSeries = 0; bestSlot = nearestSlot; }
          }
        }
        // Check scatter and boxplot outliers in exact scan order: nearestSlot, step -1, step +1
        const scanSlots = [nearestSlot];
        for (let j = nearestSlot - 1; j >= start; j--) scanSlots.push(j);
        for (let j = nearestSlot + 1; j < end; j++) scanSlots.push(j);
        const scatterS = run.view.frame.series[1]!;
        const boxMark = markOf(run.stateRef.meta, 'md')!;
        const boxRowState = physicalOf(run.view).rows![2]!;
        const boxHalf = boxMark.size / 2;
        for (const j of scanSlots) {
          const px = xSlotPixel(proj.x, vals, j);
          if (scatterS.slot[j] === SLOT_VALUE) {
            const py = position(yScale, scatterS.y[j]!);
            if (inPlot(px, py, 3)) {
              const d = Math.hypot(px - xPx, py - yPx);
              if (d <= 24 + 1e-6 && d <= bestDist) { bestDist = d; bestSeries = 1; bestSlot = j; }
            }
          }
          if (boxRowState[j] === SLOT_VALUE) {
            const rowIdx = run.view.frame.series[2]!.row ? run.view.frame.series[2]!.row![j]! : j;
            const col = boxMark.outliers!;
            for (let k = col.start[rowIdx]!; k < col.start[rowIdx + 1]!; k++) {
              const py = position(yScale, col.values[k]!);
              if (inPlot(px, py, boxHalf)) {
                const d = Math.hypot(px - xPx, py - yPx);
                if (d <= 24 + 1e-6 && d <= bestDist) { bestDist = d; bestSeries = 2; bestSlot = j; }
              }
            }
          }
        }

        const actualTarget = run.lookup.pick(xPx, yPx);
        const actualPrimary = actualTarget ? run.lookup.primary(actualTarget) : null;
        if (bestSeries >= 0) {
          expect(actualTarget).toEqual({ kind: 'x', x: vals[bestSlot]! });
          expect(actualPrimary).toEqual({
            kind: 'aligned',
            seriesKey: run.view.frame.series[bestSeries]!.key,
            x: vals[bestSlot]!,
          });
        }
      },
    ), { numRuns: 150 });
  });
});

describe('N5 compound fallback bounds: 100k clustered misses, nearby hits, ties, wide caps, and brute-force oracle', () => {
  const candidatesOf = (lookup: Lookup) => (lookup as Lookup & { lastPickCandidates?: number }).lastPickCandidates ?? -1;
  const nodesOf = (lookup: Lookup) => (lookup as Lookup & { lastPickNodes?: number }).lastPickNodes ?? -1;

  it('rejects a 100,000-row same-x-pixel boxplot vertical miss in O(1)/O(log N) whole-pick work (with and without outliers)', () => {
    const n = 100_000;
    const x = new Float64Array(n);
    const mn = new Float64Array(n);
    const q1 = new Float64Array(n);
    const md = new Float64Array(n);
    const q3 = new Float64Array(n);
    const mx = new Float64Array(n);
    const out: number[][] = new Array(n);
    x[0] = 0; mn[0] = 10; q1[0] = 15; md[0] = 20; q3[0] = 25; mx[0] = 30; out[0] = [];
    for (let i = 1; i < n - 1; i++) {
      x[i] = 100 + i * 1e-7; // 99,998 rows packed well inside 1 CSS pixel
      mn[i] = 10; q1[i] = 15; md[i] = 20; q3[i] = 25; mx[i] = 30;
      out[i] = i % 10 === 0 ? [45] : [];
    }
    x[n - 1] = 200; mn[n - 1] = 10; q1[n - 1] = 15; md[n - 1] = 20; q3[n - 1] = 25; mx[n - 1] = 30; out[n - 1] = [];

    for (const withOutliers of [true, false]) {
      const run = n5run({
        data: { columns: withOutliers ? { x, mn, q1, md, q3, mx, out } : { x, mn, q1, md, q3, mx } },
        x: 'x',
        axes: { v: { position: 'left', domain: [0, 100] } },
        layers: [{
          type: 'boxplot', min: 'mn', q1: 'q1', median: 'md', q3: 'q3', max: 'mx',
          ...(withOutliers ? { outliers: 'out' } : {}),
          yAxis: 'v',
        }],
      });
      const plotLay = plotOf(run.layout);
      if (plotLay.projection.kind !== 'xy') throw new Error('expected xy');
      const origX = plotLay.projection.x, origY = yScaleOf(run.layout, 0);
      expect(Math.abs(origX.map(x[n - 2]!) - origX.map(x[1]!))).toBeLessThan(1);

      let xMaps = 0, yMaps = 0;
      const spiedLay = {
        ...plotLay,
        projection: {
          ...plotLay.projection,
          x: { ...origX, map(v: number) { xMaps++; return origX.map(v); } },
          y: { ...origY, map(v: number) { yMaps++; return origY.map(v); } },
          yAxes: [{ ...origY, map(v: number) { yMaps++; return origY.map(v); } }],
        },
      };
      const lookup = createCartesianLookup(run.stateRef, run.view, spiedLay, run.formatters, defaultMessages);
      xMaps = 0; yMaps = 0;

      // Pointer inside plot at cluster x and well above all boxes and outliers (y = 85).
      const target = lookup.pick(origX.map(100.005), origY.map(85));
      expect(target).not.toBeNull();
      expect(candidatesOf(lookup)).toBe(0);
      expect(xMaps).toBeLessThanOrEqual(2);
      expect(yMaps).toBe(0);
    }
  });

  it('prunes 99,999 disjoint clustered boxes to find 1 vertically separated nearby hit, and bounds 100k identical-x overlapping ties', () => {
    const n = 100_000;
    const x = new Float64Array(n);
    const mn = new Float64Array(n);
    const q1 = new Float64Array(n);
    const md = new Float64Array(n);
    const q3 = new Float64Array(n);
    const mx = new Float64Array(n);
    x[0] = 0; mn[0] = 10; q1[0] = 15; md[0] = 20; q3[0] = 25; mx[0] = 30;
    for (let i = 1; i < n - 1; i++) {
      x[i] = 100 + i * 1e-7;
      if (i === 50_000) {
        mn[i] = 70; q1[i] = 74; md[i] = 78; q3[i] = 82; mx[i] = 85;
      } else {
        mn[i] = 10; q1[i] = 15; md[i] = 20; q3[i] = 25; mx[i] = 30;
      }
    }
    x[n - 1] = 200; mn[n - 1] = 10; q1[n - 1] = 15; md[n - 1] = 20; q3[n - 1] = 25; mx[n - 1] = 30;

    const run = n5run({
      data: { columns: { x, mn, q1, md, q3, mx } }, x: 'x',
      axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [{ type: 'boxplot', min: 'mn', q1: 'q1', median: 'md', q3: 'q3', max: 'mx', yAxis: 'v' }],
    });
    const plotLay = plotOf(run.layout);
    if (plotLay.projection.kind !== 'xy') throw new Error('expected xy');
    const origX = plotLay.projection.x, origY = yScaleOf(run.layout, 0);
    let xMaps = 0, yMaps = 0;
    const spiedLay = {
      ...plotLay,
      projection: {
        ...plotLay.projection,
        x: { ...origX, map(v: number) { xMaps++; return origX.map(v); } },
        y: { ...origY, map(v: number) { yMaps++; return origY.map(v); } },
        yAxes: [{ ...origY, map(v: number) { yMaps++; return origY.map(v); } }],
      },
    };
    const lookup = createCartesianLookup(run.stateRef, run.view, spiedLay, run.formatters, defaultMessages);
    xMaps = 0; yMaps = 0;

    // 2 px above the isolated box at slot 50,000 (within HIT_SLACK = 3)
    const nearbyTarget = lookup.pick(origX.map(x[50_000]!), origY.map(85) - 2);
    expect(nearbyTarget).toEqual({ kind: 'x', x: x[50_000]! });
    expect(xMaps).toBeLessThanOrEqual(2);
    expect(yMaps).toBeLessThanOrEqual(10);

    // 100,000 identical-x overlapping boxes: lowest slot index wins direct hit with bounded work.
    const xSame = new Float64Array(n);
    xSame[0] = -50;
    for (let i = 1; i < n - 1; i++) xSame[i] = 1e-6 + i * 1e-20;
    xSame[n - 1] = 200;
    mn.fill(10); q1.fill(20); md.fill(30); q3.fill(40); mx.fill(50);
    const sameRun = n5run({
      data: { columns: { x: xSame, mn, q1, md, q3, mx } }, x: 'x',
      axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [{ type: 'boxplot', min: 'mn', q1: 'q1', median: 'md', q3: 'q3', max: 'mx', yAxis: 'v' }],
    });
    const sLay = plotOf(sameRun.layout);
    if (sLay.projection.kind !== 'xy') throw new Error('expected xy');
    const sx = sLay.projection.x, sy = yScaleOf(sameRun.layout, 0);
    expect(sx.map(xSame[1]!)).toBe(sx.map(xSame[n - 2]!));
    let sxMaps = 0, syMaps = 0;
    const spiedSame = {
      ...sLay,
      projection: {
        ...sLay.projection,
        x: { ...sx, map(v: number) { sxMaps++; return sx.map(v); } },
        y: { ...sy, map(v: number) { syMaps++; return sy.map(v); } },
        yAxes: [{ ...sy, map(v: number) { syMaps++; return sy.map(v); } }],
      },
    };
    const sameLookup = createCartesianLookup(sameRun.stateRef, sameRun.view, spiedSame, sameRun.formatters, defaultMessages);
    sxMaps = 0; syMaps = 0;
    const tieHitLeft = sameLookup.pick(sx.map(xSame[1]!) - 1, sy.map(30));
    expect(tieHitLeft).toEqual({ kind: 'x', x: xSame[1]! });
    expect(sxMaps).toBeLessThanOrEqual(2);
    expect(syMaps).toBeLessThanOrEqual(10);

    sxMaps = 0; syMaps = 0;
    const tieHitRight = sameLookup.pick(sx.map(xSame[1]!) + 1, sy.map(30));
    expect(tieHitRight).toEqual({ kind: 'x', x: xSame[1]! });
    expect(sxMaps).toBeLessThanOrEqual(2);
    expect(syMaps).toBeLessThanOrEqual(100);
  });

  it('prunes 50k clustered errorBar vertical misses and preserves wide caps, off-whisker centres, and degenerate/out-of-range medians', () => {
    // 1. 50k clustered errorBars vertical miss
    const n = 50_000;
    const x = new Float64Array(n);
    const lo = new Float64Array(n);
    const hi = new Float64Array(n);
    const y = new Float64Array(n);
    x[0] = 0; lo[0] = 10; hi[0] = 30; y[0] = 20;
    for (let i = 1; i < n - 1; i++) {
      x[i] = 100 + i * 1e-6; lo[i] = 10; hi[i] = 30; y[i] = 20;
    }
    x[n - 1] = 200; lo[n - 1] = 10; hi[n - 1] = 30; y[n - 1] = 20;
    const ebRun = n5run({
      data: { columns: { x, lo, hi, y } }, x: 'x',
      axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [{ type: 'errorBar', low: 'lo', high: 'hi', y: 'y', yAxis: 'v', capWidth: 40 }],
    });
    const ebLay = plotOf(ebRun.layout);
    if (ebLay.projection.kind !== 'xy') throw new Error('expected xy');
    const ox = ebLay.projection.x, oy = yScaleOf(ebRun.layout, 0);
    let ebXMaps = 0, ebYMaps = 0;
    const spiedEb = {
      ...ebLay,
      projection: {
        ...ebLay.projection,
        x: { ...ox, map(v: number) { ebXMaps++; return ox.map(v); } },
        y: { ...oy, map(v: number) { ebYMaps++; return oy.map(v); } },
        yAxes: [{ ...oy, map(v: number) { ebYMaps++; return oy.map(v); } }],
      },
    };
    const ebLookup = createCartesianLookup(ebRun.stateRef, ebRun.view, spiedEb, ebRun.formatters, defaultMessages);
    ebXMaps = 0; ebYMaps = 0;
    expect(ebLookup.pick(ox.map(100.01), oy.map(85))).not.toBeNull();
    expect(ebXMaps).toBeLessThanOrEqual(2);
    expect(ebYMaps).toBe(0);

    // 2. ErrorBar with y centre outside [low, high], wide caps, and boxplot with median outside [min, max] & q1=q3=max
    const specialRun = n5run({
      data: [
        { x: 1, lo: 10, hi: 20, y: 80, mn: 10, q1: 30, md: 90, q3: 30, mx: 30, l: 0 },
        { x: 2, lo: 10, hi: 20, y: 15, mn: 10, q1: 12, md: 15, q3: 18, mx: 20, l: 0 },
        { x: 3, lo: 10, hi: 20, y: 15, mn: 10, q1: 12, md: 15, q3: 18, mx: 20, l: 0 },
        { x: 4, lo: 10, hi: 20, y: 15, mn: 10, q1: 12, md: 15, q3: 18, mx: 20, l: 0 },
        { x: 5, lo: 10, hi: 20, y: 15, mn: 10, q1: 12, md: 15, q3: 18, mx: 20, l: 0 },
      ],
      x: 'x',
      axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [
        { type: 'line', y: 'l', yAxis: 'v' },
        { type: 'errorBar', low: 'lo', high: 'hi', y: 'y', yAxis: 'v', capWidth: 160 },
        { type: 'boxplot', min: 'mn', q1: 'q1', median: 'md', q3: 'q3', max: 'mx', yAxis: 'v', capWidth: 160 },
      ],
    }, { width: 550 });
    const sScale = yScaleOf(specialRun.layout, 0);
    const sx1 = xPixel(specialRun.layout, specialRun.view, 0);
    const sx2 = xPixel(specialRun.layout, specialRun.view, 1);
    // ErrorBar centre at y = 80 (outside [10, 20]): hits 'y' (representative key when errorBar has y)
    expect(pickedKey(specialRun, sx1, position(sScale, 80))).toBe('y');
    // Boxplot median at y = 90 (outside [10, 30]): hits 'md'
    expect(pickedKey(specialRun, sx1, position(sScale, 90))).toBe('md');
    // Wide 80 px half-cap crossing into neighbor slot's half-plane (nearestSlot = x: 2) still picks slot 0 (x: 1).
    const pxCross = (sx1 + sx2) / 2 + 10;
    const crossTarget = specialRun.lookup.pick(pxCross, position(sScale, 30) - 2);
    expect(crossTarget).toEqual({ kind: 'x', x: 1 });
    expect(specialRun.lookup.primary(crossTarget!)).toEqual({ kind: 'aligned', seriesKey: 'md', x: 1 });
  });

  it('matches an unpruned brute-force compound oracle across random boxplot, errorBar, wide caps, ties, and clipped slots', () => {
    fc.assert(fc.property(
      fc.array(fc.record({
        dx: fc.integer({ min: 0, max: 30 }),
        present: fc.boolean(),
        a: fc.integer({ min: -20, max: 120 }),
        b: fc.integer({ min: -20, max: 120 }),
        m: fc.integer({ min: -20, max: 120 }),
        ebLo: fc.integer({ min: -15, max: 115 }),
        ebHi: fc.integer({ min: -15, max: 115 }),
        ebY: fc.option(fc.integer({ min: -15, max: 115 }), { nil: null }),
      }), { minLength: 10, maxLength: 45 }),
      fc.oneof(
        fc.constant(0),
        fc.constant(8.013698630136986),
        fc.integer({ min: 0, max: 120 }),
        fc.integer({ min: 1, max: 12000 }).map(v => v / 100),
      ),
      fc.integer({ min: 0, max: 100 }),
      fc.integer({ min: 0, max: 100 }),
      (rawRows, capWidth, ptrXFrac, ptrYFrac) => {
        let curX = 0;
        const data = rawRows.map((r, i) => {
          curX += i === 0 ? 0 : (r.dx === 0 ? 1e-13 : r.dx * 0.15);
          const sorted = [r.a, r.b, r.m].sort((u, v) => u - v);
          return {
            x: curX,
            l: -50,
            ebLo: r.present ? Math.min(r.ebLo, r.ebHi) : null,
            ebHi: r.present ? Math.max(r.ebLo, r.ebHi) : null,
            ebY: r.present ? r.ebY : null,
            mn: r.present ? sorted[0]! : null,
            q1: r.present ? sorted[1]! : null,
            md: r.present ? r.m : null, // intentionally allows median outside [min, max]
            q3: r.present ? sorted[1]! : null,
            mx: r.present ? sorted[2]! : null,
          };
        });
        const run = n5run({
          data, x: 'x',
          axes: { v: { position: 'left', domain: [0, 100] } },
          layers: [
            { type: 'line', y: 'l', yAxis: 'v' },
            { type: 'errorBar', low: 'ebLo', high: 'ebHi', y: 'ebY', yAxis: 'v', capWidth },
            { type: 'boxplot', min: 'mn', q1: 'q1', median: 'md', q3: 'q3', max: 'mx', yAxis: 'v', capWidth },
          ],
        });
        const plot = plotOf(run.layout).plot;
        const proj = plotOf(run.layout).projection;
        if (proj.kind !== 'xy') return;
        const xPx = plot.x + (ptrXFrac / 100) * plot.width;
        const yPx = plot.y + (ptrYFrac / 100) * plot.height;

        // Naive brute-force compound oracle scanning all visible slots in reverse layer order.
        const vals = run.view.frame.x.values;
        const { start, end } = run.view.visibleSlots;
        const phys = physicalOf(run.view);
        const boxHalf = boxHalfWidth(proj, vals, run.view.visibleSlots);
        const rectDist = (x1: number, y1: number, x2: number, y2: number): number => {
          const cx1 = Math.max(x1, plot.x), cx2 = Math.min(x2, plot.x + plot.width);
          const cy1 = Math.max(y1, plot.y), cy2 = Math.min(y2, plot.y + plot.height);
          if (!(cx2 > cx1 && cy2 > cy1)) return Infinity;
          const dx = xPx < cx1 ? cx1 - xPx : xPx > cx2 ? xPx - cx2 : 0;
          const dy = yPx < cy1 ? cy1 - yPx : yPx > cy2 ? yPx - cy2 : 0;
          return Math.hypot(dx, dy);
        };
        const inPlot = (px: number, py: number, half: number) =>
          px + half >= plot.x && px - half <= plot.x + plot.width && py + half >= plot.y && py - half <= plot.y + plot.height;

        let winSeries = -1, winSlot = -1, winDist = Infinity;
        for (let sIdx = 2; sIdx >= 1; sIdx--) {
          const m = markOf(run.stateRef.meta, run.view.frame.series[sIdx]!.field)!;
          const g = projectCompound(m, phys, sIdx, proj, plot, boxHalf)!;
          const halfMarker = m.size / 2;
          let curDist = Infinity;
          const sink: CompoundSink = {
            box(x, hw, y, h) { curDist = Math.min(curDist, rectDist(x - hw, y, x + hw, y + h)); },
            whisker(x1, y1, x2, y2) {
              const d = x1 === x2
                ? (Math.max(y1, y2) > Math.min(y1, y2) ? rectDist(x1 - WHISKER_WIDTH / 2, Math.min(y1, y2), x1 + WHISKER_WIDTH / 2, Math.max(y1, y2)) : Infinity)
                : (x2 > x1 ? rectDist(x1, y1 - WHISKER_WIDTH / 2, x2, y1 + WHISKER_WIDTH / 2) : Infinity);
              curDist = Math.min(curDist, d);
            },
            median(x1, x2, y) { curDist = Math.min(curDist, x2 > x1 ? rectDist(x1, y - MEDIAN_WIDTH / 2, x2, y + MEDIAN_WIDTH / 2) : Infinity); },
            point(x, y) {
              if (Number.isFinite(y) && inPlot(x, y, halfMarker)) {
                curDist = Math.min(curDist, Math.max(0, Math.hypot(xPx - x, yPx - y) - halfMarker));
              }
            },
          };
          let bestS = -1, bestD = Infinity, bestDx = Infinity;
          for (let j = start; j < end; j++) {
            if (g.rows[j] !== SLOT_VALUE) continue;
            const px = xSlotPixel(proj.x, vals, j);
            const dx = Math.abs(px - xPx);
            curDist = Infinity;
            g.visit(j, px, sink);
            if (curDist > 3) continue;
            if (curDist < bestD || (curDist === bestD && (dx < bestDx || (dx === bestDx && j < bestS)))) {
              bestD = curDist; bestDx = dx; bestS = j;
            }
          }
          if (bestS >= 0) {
            if (bestD === 0) { winSeries = sIdx; winSlot = bestS; winDist = 0; break; }
            if (bestD < winDist) { winSeries = sIdx; winSlot = bestS; winDist = bestD; }
          }
        }

        const actualTarget = run.lookup.pick(xPx, yPx);
        const actualPrimary = actualTarget ? run.lookup.primary(actualTarget) : null;
        if (winSeries >= 0) {
          expect(actualTarget).toEqual({ kind: 'x', x: vals[winSlot]! });
          expect(actualPrimary).toEqual({
            kind: 'aligned',
            seriesKey: run.view.frame.series[winSeries]!.key,
            x: vals[winSlot]!,
          });
        }
      },
    ), { numRuns: 150 });
  });

  it('bounds node and geometry visits for 100k clustered boxes within positive proximity slack (0 < dist <= 3) and preserves (dist, dx, slot) order', () => {
    const n = 100_000;
    const x = new Float64Array(n);
    const mn = new Float64Array(n);
    const q1 = new Float64Array(n);
    const md = new Float64Array(n);
    const q3 = new Float64Array(n);
    const mx = new Float64Array(n);
    x[0] = 0; mn[0] = 10; q1[0] = 15; md[0] = 20; q3[0] = 25; mx[0] = 30;
    for (let i = 1; i < n - 1; i++) {
      x[i] = 100 + i * 1e-7; // packed into < 1 CSS px
      mn[i] = 10; q1[i] = 15; md[i] = 20; q3[i] = 25; mx[i] = 30;
    }
    x[n - 1] = 200; mn[n - 1] = 10; q1[n - 1] = 15; md[n - 1] = 20; q3[n - 1] = 25; mx[n - 1] = 30;

    for (const capWidth of [undefined, 0]) {
      const run = n5run({
        data: { columns: { x, mn, q1, md, q3, mx } },
        x: 'x',
        axes: { v: { position: 'left', domain: [0, 100] } },
        layers: [{
          type: 'boxplot', min: 'mn', q1: 'q1', median: 'md', q3: 'q3', max: 'mx', yAxis: 'v',
          ...(capWidth !== undefined ? { capWidth } : {}),
        }],
      });
      const plotLay = plotOf(run.layout);
      if (plotLay.projection.kind !== 'xy') throw new Error('expected xy');
      const ox = plotLay.projection.x, oy = yScaleOf(run.layout, 0);
      expect(Math.abs(ox.map(x[n - 2]!) - ox.map(x[1]!))).toBeLessThan(1);

      let xMaps = 0, yMaps = 0;
      const spied = {
        ...plotLay,
        projection: {
          ...plotLay.projection,
          x: { ...ox, map(v: number) { xMaps++; return ox.map(v); } },
          y: { ...oy, map(v: number) { yMaps++; return oy.map(v); } },
          yAxes: [{ ...oy, map(v: number) { yMaps++; return oy.map(v); } }],
        },
      };
      const lookup = createCartesianLookup(run.stateRef, run.view, spied, run.formatters, defaultMessages);
      // 2 px above the upper cap/whisker: positive slack 0 < dist <= HIT_SLACK = 3
      const qy = oy.map(30) - (capWidth === 0 ? 2 : 2.75);
      for (const idx of [1, 50_000, 99_998]) {
        xMaps = 0; yMaps = 0;
        const target = lookup.pick(ox.map(x[idx]!), qy);
        expect(target).toEqual({ kind: 'x', x: x[idx]! });
        expect(xMaps).toBeLessThanOrEqual(2);
        expect(yMaps).toBeLessThanOrEqual(80);
        expect(nodesOf(lookup)).toBeGreaterThanOrEqual(1);
        expect(nodesOf(lookup)).toBeLessThanOrEqual(80);
        expect(candidatesOf(lookup)).toBeGreaterThanOrEqual(1);
        expect(candidatesOf(lookup)).toBeLessThanOrEqual(16);
      }
    }

    // Identical projected x across 100,000 overlapping boxes within positive proximity slack: lowest slot (slot 1) wins!
    const xSame = new Float64Array(n);
    xSame[0] = -50;
    for (let i = 1; i < n - 1; i++) xSame[i] = 1e-6 + i * 1e-20;
    xSame[n - 1] = 200;
    const sameRun = n5run({
      data: { columns: { x: xSame, mn, q1, md, q3, mx } },
      x: 'x',
      axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [{ type: 'boxplot', min: 'mn', q1: 'q1', median: 'md', q3: 'q3', max: 'mx', yAxis: 'v' }],
    });
    const sLay = plotOf(sameRun.layout);
    if (sLay.projection.kind !== 'xy') throw new Error('expected xy');
    const sx = sLay.projection.x, sy = yScaleOf(sameRun.layout, 0);
    expect(sx.map(xSame[1]!)).toBe(sx.map(xSame[n - 2]!));
    const tieProx = sameRun.lookup.pick(sx.map(xSame[1]!), sy.map(30) - 2.75);
    expect(tieProx).toEqual({ kind: 'x', x: xSame[1]! });
    expect(nodesOf(sameRun.lookup)).toBeLessThanOrEqual(80);
    expect(candidatesOf(sameRun.lookup)).toBeLessThanOrEqual(16);

    // 50,000 clustered errorBars (with interior y and without y) within positive proximity slack
    const ne = 50_000;
    const ex = new Float64Array(ne), elo = new Float64Array(ne), ehi = new Float64Array(ne), ey = new Float64Array(ne);
    ex[0] = 0; elo[0] = 10; ey[0] = 20; ehi[0] = 30;
    for (let i = 1; i < ne - 1; i++) { ex[i] = 100 + i * 1e-6; elo[i] = 10; ey[i] = 20; ehi[i] = 30; }
    ex[ne - 1] = 200; elo[ne - 1] = 10; ey[ne - 1] = 20; ehi[ne - 1] = 30;
    for (const withY of [false, true]) {
      const eRun = n5run({
        data: { columns: withY ? { x: ex, lo: elo, hi: ehi, y: ey } : { x: ex, lo: elo, hi: ehi } },
        x: 'x',
        axes: { v: { position: 'left', domain: [0, 100] } },
        layers: [{ type: 'errorBar', low: 'lo', high: 'hi', ...(withY ? { y: 'y' } : {}), yAxis: 'v', capWidth: 20 }],
      });
      const eLay = plotOf(eRun.layout);
      if (eLay.projection.kind !== 'xy') throw new Error('expected xy');
      const eHit = eRun.lookup.pick(eLay.projection.x.map(ex[25_000]!), yScaleOf(eRun.layout, 0).map(30) - 2.75);
      expect(eHit).toEqual({ kind: 'x', x: ex[25_000]! });
      expect(nodesOf(eRun.lookup)).toBeLessThanOrEqual(80);
      expect(candidatesOf(eRun.lookup)).toBeLessThanOrEqual(16);
    }
  });

  it('bounds node and geometry visits on alternating y-band misses and nearby hits across clustered and wide x', () => {
    const n = 100_000;
    const mn = new Float64Array(n), q1 = new Float64Array(n), md = new Float64Array(n), q3 = new Float64Array(n), mx = new Float64Array(n);
    mn[0] = 10; q1[0] = 12; md[0] = 15; q3[0] = 18; mx[0] = 20;
    for (let i = 1; i < n - 1; i++) {
      if (i % 2 === 0) { mn[i] = 10; q1[i] = 12; md[i] = 15; q3[i] = 18; mx[i] = 20; }
      else { mn[i] = 80; q1[i] = 82; md[i] = 85; q3[i] = 88; mx[i] = 90; }
    }
    mn[n - 1] = 80; q1[n - 1] = 82; md[n - 1] = 85; q3[n - 1] = 88; mx[n - 1] = 90;

    for (const wide of [false, true]) {
      const x = new Float64Array(n);
      x[0] = 0;
      for (let i = 1; i < n - 1; i++) x[i] = wide ? i : 100 + i * 1e-7;
      x[n - 1] = wide ? n : 200;

      const run = n5run({
        data: { columns: { x, mn, q1, md, q3, mx } },
        x: 'x',
        axes: { v: { position: 'left', domain: [0, 100] } },
        layers: [{ type: 'boxplot', min: 'mn', q1: 'q1', median: 'md', q3: 'q3', max: 'mx', yAxis: 'v' }],
      });
      const plotLay = plotOf(run.layout);
      if (plotLay.projection.kind !== 'xy') throw new Error('expected xy');
      const ox = plotLay.projection.x, oy = yScaleOf(run.layout, 0);
      let yMaps = 0;
      const spied = {
        ...plotLay,
        projection: {
          ...plotLay.projection,
          y: { ...oy, map(v: number) { yMaps++; return oy.map(v); } },
          yAxes: [{ ...oy, map(v: number) { yMaps++; return oy.map(v); } }],
        },
      };
      const lookup = createCartesianLookup(run.stateRef, run.view, spied, run.formatters, defaultMessages);
      yMaps = 0;

      // Vertical miss in the gap between the two alternating bands (y = 50)
      const qx = ox.map(x[50_001]!);
      const miss = lookup.pick(qx, oy.map(50));
      expect(miss).not.toBeNull();
      expect(yMaps).toBe(0);
      expect(candidatesOf(lookup)).toBe(0);
      expect(nodesOf(lookup)).toBeGreaterThanOrEqual(1);
      expect(nodesOf(lookup)).toBeLessThanOrEqual(40);

      // Nearby proximity hit 2 px above the upper band (y = 90)
      yMaps = 0;
      const near = lookup.pick(qx, oy.map(90) - 2.75);
      expect(near).toEqual({ kind: 'x', x: x[50_001]! });
      expect(yMaps).toBeLessThanOrEqual(80);
      expect(candidatesOf(lookup)).toBeGreaterThanOrEqual(1);
      expect(candidatesOf(lookup)).toBeLessThanOrEqual(16);
      expect(nodesOf(lookup)).toBeLessThanOrEqual(80);
    }
  });

  it('preserves direct-hit priority, layer tie order, edge errorBar centres, and PointIndex/whole-lookup node instrumentation', () => {
    // Direct hit on earlier errorBar layer beats closer proximity hit on later boxplot layer; later layer wins equal-dist tie.
    const layered = n5run({
      data: [
        { x: 1, lo: 40, hi: 60, y: 50, mn: 10, q1: 15, md: 20, q3: 25, mx: 30 },
        { x: 2, lo: 40, hi: 60, y: 50, mn: 10, q1: 15, md: 20, q3: 25, mx: 30 },
      ],
      x: 'x',
      axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [
        { type: 'errorBar', low: 'lo', high: 'hi', y: 'y', yAxis: 'v', capWidth: 10 },
        { type: 'boxplot', min: 'mn', q1: 'q1', median: 'md', q3: 'q3', max: 'mx', yAxis: 'v' },
      ],
    });
    const ys = yScaleOf(layered.layout, 0);
    // Point directly on errorBar cap at y=40 (dist=0), away from boxplot [10,30]: errorBar ('y') wins.
    const directEb = layered.lookup.pick(xPixel(layered.layout, layered.view, 0), ys.map(40));
    expect(layered.lookup.primary(directEb!)).toEqual({ kind: 'aligned', seriesKey: 'y', x: 1 });
    expect(candidatesOf(layered.lookup)).toBeGreaterThanOrEqual(1);
    expect(nodesOf(layered.lookup)).toBeGreaterThanOrEqual(1);

    // Edge errorBar centre (y=60 at upper cap) and clustered scatter PointIndex instrumentation.
    const edgeEb = n5run({
      data: [
        { x: 0, lo: 10, hi: 20, y: 20 },
        { x: 1, lo: 10, hi: 20, y: 20 },
        { x: 2, lo: 10, hi: 20, y: 20 },
      ],
      x: 'x',
      axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [{ type: 'errorBar', low: 'lo', high: 'hi', y: 'y', yAxis: 'v', capWidth: 0, size: 6 }],
    });
    const eScale = yScaleOf(edgeEb.layout, 0);
    const eHit = edgeEb.lookup.pick(xPixel(edgeEb.layout, edgeEb.view, 1), eScale.map(20) - 4.5);
    expect(eHit).toEqual({ kind: 'x', x: 1 });
    expect(nodesOf(edgeEb.lookup)).toBeGreaterThanOrEqual(1);
    expect(candidatesOf(edgeEb.lookup)).toBeGreaterThanOrEqual(1);
  });

  it('keeps the inclusive 3 px horizontal boundary for fractional capWidth where centre-distance rounding exceeds reach', () => {
    const capWidth = 8.013698630136986;
    const cap = capWidth / 2;

    const ebRun = n5run({
      data: [
        { x: 1, lo: 20, hi: 40, l: 90 },
        { x: 2, lo: 20, hi: 40, l: 90 },
        { x: 3, lo: 20, hi: 40, l: 90 },
      ],
      x: 'x',
      axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [
        { type: 'line', y: 'l', yAxis: 'v' },
        { type: 'errorBar', low: 'lo', high: 'hi', yAxis: 'v', capWidth },
      ],
    });
    const px = xPixel(ebRun.layout, ebRun.view, 1);
    const py = position(yScaleOf(ebRun.layout, 0), 40);
    const rightCap = px + cap;
    const qxRight = rightCap + 3;
    // Regression precondition: subtracting px from (px + cap + 3) rounds above cap + 3, while painted edge distance is exactly 3.
    expect(Math.abs(qxRight - px)).toBeGreaterThan(cap + 3);
    expect(qxRight - rightCap).toBe(3);
    expect(pickedKey(ebRun, qxRight, py)).toBe('lo');
    expect(pickedKey(ebRun, rightCap + 3.000001, py)).toBe('l');
    const leftCap = px - cap;
    expect(pickedKey(ebRun, leftCap - 3, py)).toBe('lo');
    expect(pickedKey(ebRun, leftCap - 3.000001, py)).toBe('l');

    const boxRun = n5run({
      data: [
        { x: 1, mn: 10, q1: 20, md: 30, q3: 40, mx: 50, l: 90 },
        { x: 2, mn: 10, q1: 20, md: 30, q3: 40, mx: 50, l: 90 },
        { x: 3, mn: 10, q1: 20, md: 30, q3: 40, mx: 50, l: 90 },
      ],
      x: 'x',
      axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [
        { type: 'line', y: 'l', yAxis: 'v' },
        { type: 'boxplot', min: 'mn', q1: 'q1', median: 'md', q3: 'q3', max: 'mx', yAxis: 'v', capWidth },
      ],
    });
    const bPx = xPixel(boxRun.layout, boxRun.view, 1);
    const bPy = position(yScaleOf(boxRun.layout, 0), 50);
    expect(pickedKey(boxRun, bPx + cap + 3, bPy)).toBe('md');
    expect(pickedKey(boxRun, bPx + cap + 3.000001, bPy)).toBe('l');
  });

  it('bounds node and geometry visits for 100,000 capless clustered boxplots at 1.5 CSS px sideways above the upper whisker', () => {
    const n = 100_000;
    const x = new Float64Array(n);
    const mn = new Float64Array(n);
    const q1 = new Float64Array(n);
    const md = new Float64Array(n);
    const q3 = new Float64Array(n);
    const mx = new Float64Array(n);
    x[0] = 0; mn[0] = 10; q1[0] = 15; md[0] = 20; q3[0] = 25; mx[0] = 30;
    for (let i = 1; i < n - 1; i++) {
      x[i] = 100 + i * 1e-7; // < 1 CSS px total cluster width
      mn[i] = 10; q1[i] = 15; md[i] = 20; q3[i] = 25; mx[i] = 30;
    }
    x[n - 1] = 200; mn[n - 1] = 10; q1[n - 1] = 15; md[n - 1] = 20; q3[n - 1] = 25; mx[n - 1] = 30;

    const run = n5run({
      data: { columns: { x, mn, q1, md, q3, mx } },
      x: 'x',
      axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [{ type: 'boxplot', min: 'mn', q1: 'q1', median: 'md', q3: 'q3', max: 'mx', yAxis: 'v', capWidth: 0 }],
    });
    const plotLay = plotOf(run.layout);
    if (plotLay.projection.kind !== 'xy') throw new Error('expected xy');
    const ox = plotLay.projection.x, oy = yScaleOf(run.layout, 0);
    expect(Math.abs(ox.map(x[n - 2]!) - ox.map(x[1]!))).toBeLessThan(1);

    let yMaps = 0;
    const spied = {
      ...plotLay,
      projection: {
        ...plotLay.projection,
        y: { ...oy, map(v: number) { yMaps++; return oy.map(v); } },
        yAxes: [{ ...oy, map(v: number) { yMaps++; return oy.map(v); } }],
      },
    };
    const lookup = createCartesianLookup(run.stateRef, run.view, spied, run.formatters, defaultMessages);
    const qy = oy.map(30) - 2;

    yMaps = 0;
    const rightSide = lookup.pick(ox.map(x[50_000]!) + 1.5, qy);
    expect(rightSide).toEqual({ kind: 'x', x: x[n - 2]! });
    expect(yMaps).toBe(0);
    expect(nodesOf(lookup)).toBeGreaterThanOrEqual(1);
    expect(nodesOf(lookup)).toBeLessThanOrEqual(80);
    expect(candidatesOf(lookup)).toBeGreaterThanOrEqual(1);
    expect(candidatesOf(lookup)).toBeLessThanOrEqual(16);

    yMaps = 0;
    const leftSide = lookup.pick(ox.map(x[1]!) - 1.5, qy);
    expect(leftSide).toEqual({ kind: 'x', x: x[1]! });
    expect(yMaps).toBe(0);
    expect(nodesOf(lookup)).toBeGreaterThanOrEqual(1);
    expect(nodesOf(lookup)).toBeLessThanOrEqual(80);
    expect(candidatesOf(lookup)).toBeGreaterThanOrEqual(1);
    expect(candidatesOf(lookup)).toBeLessThanOrEqual(16);

    // Also probe when the cluster spans > 3 CSS px so the 1.5 px sideways pointer sits inside the cluster x-span.
    for (let i = 1; i < n - 1; i++) x[i] = 100 + (i / n);
    const spanRun = n5run({
      data: { columns: { x, mn, q1, md, q3, mx } },
      x: 'x',
      axes: { v: { position: 'left', domain: [0, 100] } },
      layers: [{ type: 'boxplot', min: 'mn', q1: 'q1', median: 'md', q3: 'q3', max: 'mx', yAxis: 'v', capWidth: 0 }],
    });
    const spanLay = plotOf(spanRun.layout);
    if (spanLay.projection.kind !== 'xy') throw new Error('expected xy');
    const spanTarget = spanRun.lookup.pick(spanLay.projection.x.map(x[50_000]!) + 1.5, yScaleOf(spanRun.layout, 0).map(30) - 2);
    expect(spanTarget).not.toBeNull();
    expect(nodesOf(spanRun.lookup)).toBeGreaterThanOrEqual(1);
    expect(nodesOf(spanRun.lookup)).toBeLessThanOrEqual(80);
    expect(candidatesOf(spanRun.lookup)).toBeGreaterThanOrEqual(1);
    expect(candidatesOf(spanRun.lookup)).toBeLessThanOrEqual(16);
  });
});
