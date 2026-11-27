/**
 * N5 repair round 2 (cross-provider review of the bundle-cutter candidate, findings 2 and 3, plus view reuse).
 * Expected values are derived by hand from the fixtures and the spec: a range is painted between its sorted bounds
 * (scene hiAt/loAt) and bridged across SLOT_NO_ROW like a line (contracts.ts SLOT_NO_ROW); 3.6 picks a point within
 * 24 px; a glyph the plot clips away entirely is not on screen. Nothing here was pasted from a run.
 */
import { describe, expect, it } from 'vitest';
import { SLOT_NO_ROW, type AlignedView, type DatumRef, type Lookup } from '../../src/core/contracts';
import { strictViolations } from '../../src/core/delivery';
import { position } from '../../src/scene/geometry';
import { physicalOf } from '../../src/cartesian/boxplot';
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
