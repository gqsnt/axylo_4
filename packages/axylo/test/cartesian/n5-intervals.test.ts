/**
 * N5: a `range` or `errorBar` layer is one series for the reader (spec I1, I2, A3, A4, A5; RFC C4.1 §5): one
 * published series, legend entry, toggle and swatch; one tooltip row, keyboard reading and table column that
 * show the bounds as given (AX176 keeps reversed bounds raw); hidden, it is left out of the drawing, the domain
 * fit and the readouts. Expected values come from the fixture below and the spec, not from a run.
 */
import { describe, expect, it } from 'vitest';
import { validateCartesian } from '../../src/cartesian';
import { position } from '../../src/scene/geometry';
import { marksOf, n5run, xPixel, yScaleOf } from './n5-pipeline';

const rows = [
  { x: 1, lo: 10, hi: 30, m: 60, elo: 55, ehi: 65, l: 200 },
  { x: 2, lo: 40, hi: 20, m: 70, elo: 65, ehi: 75, l: 210 },
  { x: 3, lo: null, hi: 500, m: 80, elo: 75, ehi: 85, l: 220 },
  { x: 4, lo: 25, hi: 45, m: 90, elo: 85, ehi: 95, l: 230 },
];

const options = (extra: Record<string, unknown> = {}) => ({
  data: rows, x: 'x',
  axes: { v: { position: 'left', unit: 'ms' } },
  layers: [
    // A field-level format on the high bound only: the readouts must use each field's own formatter.
    { type: 'range', low: 'lo', high: { field: 'hi', format: { minimumFractionDigits: 1 } }, yAxis: 'v', label: 'Band' },
    { type: 'errorBar', y: 'm', low: 'elo', high: 'ehi', yAxis: 'v', label: 'Err', capWidth: 6 },
    { type: 'line', y: 'l', yAxis: 'v' },
  ],
  ...extra,
});

describe('N5 single-identity intervals', () => {
  it('publishes one series per interval layer, keeping every field as a carrier column', () => {
    const run = n5run(options());
    expect(run.view.frame.series.map(s => s.label)).toEqual(['Band', 'Err', 'l']);
    expect(run.view.frame.series.map(s => s.key)).toEqual(['lo', 'm', 'l']);
    expect(run.view.visible).toEqual([true, true, true]);
    expect(run.view.cues).toHaveLength(3);
    expect(run.view.drawSlots).toHaveLength(3);
    // The carriers are all in the normalized frame, representatives first (the formatters are made for this order).
    expect(run.frame.series.map(s => s.field)).toEqual(['lo', 'm', 'l', 'hi', 'elo', 'ehi']);
  });

  it('reads each interval as one tooltip row with its bounds as given, each in its own field format', () => {
    const run = n5run(options());
    const t1 = run.lookup.tooltip({ kind: 'x', x: 1 });
    expect(t1.rows.map(r => [r.seriesLabel, r.value])).toEqual([
      ['Band', '10 ms – 30.0 ms'], ['Err', '60 ms (55 ms – 65 ms)'], ['l', '200 ms'],
    ]);
    expect(t1.count).toBe(3);
    // Row 1 is reversed (low 40 > high 20): read raw, AX176 says so.
    expect(run.lookup.tooltip({ kind: 'x', x: 2 }).rows[0]!.value).toBe('40 ms – 20.0 ms');
    // Row 2 has no low value: "No data" for that bound (spec F2), the high bound stays.
    const t3 = run.lookup.tooltip({ kind: 'x', x: 3 }).rows[0]!;
    expect(t3.value).toBe('No data – 500.0 ms');
    expect(t3.state).not.toBe(0);
    const ax176 = run.diagnostics.filter(d => d.code === 'AX176');
    expect(ax176).toHaveLength(1);
    expect(ax176[0]!.rows).toEqual([1]);
    // The keyboard reading of one datum is the same text.
    const datum = run.lookup.datum({ kind: 'aligned', seriesKey: 'm', x: 4 })!;
    expect([datum.seriesLabel, datum.value]).toEqual(['Err', '90 ms (85 ms – 95 ms)']);
  });

  it('gives each interval one table column with the raw bounds', () => {
    const run = n5run(options());
    const table = run.reader.table!;
    expect(table.headers).toEqual(['x', 'Band (ms)', 'Err (ms)', 'l (ms)']);
    expect(table.row(0)).toEqual(['1', '10 ms – 30.0 ms', '60 ms (55 ms – 65 ms)', '200 ms']);
    expect(table.row(1)).toEqual(['2', '40 ms – 20.0 ms', '70 ms (65 ms – 75 ms)', '210 ms']);
    expect(table.row(2)).toEqual(['3', 'No data – 500.0 ms', '80 ms (75 ms – 85 ms)', '220 ms']);
  });

  it('summarizes each interval from all its bounds', () => {
    const run = n5run(options());
    // Row 2 (high 500, no low) is not drawn (cross-provider review, N5 repair 2): the summary reads drawn rows 0, 1, 3
    // only (10–30, 40–20, 25–45), so the maximum is 45; the table keeps the raw 500 (see the table test above).
    expect(run.reader.summary).toContain('Band: minimum 10 ms, maximum 45.0 ms, last 25 ms – 45.0 ms.');
    expect(run.reader.summary).toContain('Err: minimum 55 ms, maximum 95 ms, last 90 ms (85 ms – 95 ms).');
    expect(run.reader.summary).toContain('from 10 ms to 230 ms.');
    // Hidden, the band is not summarized and does not widen the range.
    const hidden = n5run(options(), { hidden: ['lo'] });
    expect(hidden.reader.summary).not.toContain('Band:');
    // The error bar's lowest bound (elo = 55 at x = 1) is the minimum of what is shown.
    expect(hidden.reader.summary).toContain('Err and l from 55 ms to 230 ms.');
  });

  it('hides the whole interval with its one toggle: no marks, no domain, no readout', () => {
    const shown = n5run(options());
    const hidden = n5run(options(), { hidden: ['lo'] });
    expect(hidden.view.visible).toEqual([false, true, true]);
    expect(marksOf(shown, 'area', 0)).toHaveLength(1);
    expect(hidden.scene.marks.filter(m => 'series' in m && m.series === 0)).toEqual([]);
    // 10 (the band's low at x = 1) is in the domain only while the band is shown; without it the lowest shown value
    // is the error bar's 55. 500 (the band's high at x = 3, whose low is missing) draws no band, so it widens the
    // axis in neither case (review finding 2: the fit reads the rows the mark is drawn from).
    expect(shown.view.yDomain[0]).toBeLessThanOrEqual(10);
    expect(hidden.view.yDomain[0]).toBeGreaterThan(10);
    expect(shown.view.yDomain[1]).toBeLessThan(500);
    expect(hidden.view.yDomain[1]).toBeLessThan(500);
    expect(hidden.view.yDomain[1]).toBeGreaterThanOrEqual(230);
    const t = hidden.lookup.tooltip({ kind: 'x', x: 1 });
    expect(t.rows.map(r => r.seriesLabel)).toEqual(['Err', 'l']);
    expect(t.count).toBe(2);
    expect(hidden.lookup.resolve({ kind: 'aligned', seriesKey: 'lo', x: 1 })).toBeNull();
    // Hiding the error bar removes its whiskers and its centre points together.
    const noErr = n5run(options(), { hidden: ['m'] });
    expect(noErr.scene.marks.filter(m => 'series' in m && m.series === 1)).toEqual([]);
    expect(marksOf(shown, 'path', 1).length + marksOf(shown, 'points', 1).length).toBe(2);
  });

  it('rebuilds visibility and keeps cues when the previous view is the published one (toggle, then show again)', () => {
    const first = n5run(options());
    const toggled = n5run(options(), { previous: first.view, hidden: ['lo'] });
    expect(toggled.view.visible).toEqual([false, true, true]);
    expect(toggled.view.cues).toEqual(first.view.cues);
    const back = n5run(options(), { previous: toggled.view });
    expect(back.view.visible).toEqual([true, true, true]);
    expect(marksOf(back, 'area', 0)).toHaveLength(1);
    // A hidden key that is now a non-representative carrier (the layer was redeclared) hides nothing on its own.
    const stale = n5run(options(), { hidden: ['hi'] });
    expect(stale.view.visible).toEqual([true, true, true]);
    expect(marksOf(stale, 'area', 0)).toHaveLength(1);
  });

  it('picks an interval where it is drawn, from the scene geometry', () => {
    const run = n5run(options());
    const y = yScaleOf(run.layout, 0);
    const x0 = xPixel(run.layout, run.view, 0);
    const pickAt = (px: number, py: number) => {
      const target = run.lookup.pick(px, py);
      return target ? run.lookup.primary(target)?.kind === 'aligned' ? (run.lookup.primary(target) as { seriesKey: string }).seriesKey : null : null;
    };
    expect(pickAt(x0, position(y, 20))).toBe('lo');
    expect(pickAt(x0, position(y, 60))).toBe('m');
    expect(pickAt(x0, position(y, 200))).toBe('l');
    // The error bar's whiskers in the scene are at the bounds' pixels (one batch for the layer).
    const whisker = marksOf(run, 'path', 1)[0]!;
    expect(whisker.xy[0]).toBeCloseTo(x0, 3);
    expect(whisker.xy[1]).toBeCloseTo(position(y, 65), 3);
    expect(whisker.xy[3]).toBeCloseTo(position(y, 55), 3);
    // Anchor of the band at x = 1 spans its bounds.
    const anchor = run.lookup.anchor({ kind: 'aligned', seriesKey: 'lo', x: 1 })!;
    expect(anchor.y).toBeCloseTo(position(y, 30), 3);
    expect(anchor.y + anchor.height).toBeCloseTo(position(y, 10), 3);
  });

  it('draws one swatch per interval, painted with its own series index', () => {
    const run = n5run(options());
    const cue = run.view.cues[0]!;
    const band = run.swatch(0, cue, false, run.view);
    const err = run.swatch(1, run.view.cues[1]!, false, run.view);
    expect(band.color).toBe(0);
    expect(band.shape?.key).toBe('range');
    expect(err.color).toBe(1);
    expect(err.shape?.key).toBe(`errorBar:true:${run.view.cues[1]!.marker}`);
    // Every mark of a layer is painted with its series index (the legend swatch's colour).
    for (const m of run.scene.marks) {
      if ((m.type === 'area' || m.type === 'path' || m.type === 'points') && m.series <= 1 && 'fill' in m && m.fill.kind === 'series') expect(m.fill.index).toBe(m.series);
    }
  });

  it('keeps a hidden log interval out of the fit while a visible series on the axis supplies it', () => {
    const logOptions = {
      data: [
        { x: 1, lo: 1, hi: 10, c: 5 }, { x: 2, lo: 0, hi: 5000, c: 5 }, { x: 3, lo: 10, hi: 1000, c: 5 },
      ],
      x: 'x',
      axes: { l: { position: 'left' }, r: { position: 'right', scale: 'log' } },
      layers: [
        { type: 'range', low: 'lo', high: 'hi', yAxis: 'r', label: 'Span' },
        { type: 'line', y: 'c', yAxis: 'r' },
      ],
    };
    const shown = n5run(logOptions);
    const hidden = n5run(logOptions, { hidden: ['lo'] });
    expect(shown.view.yDomains![1]![1]).toBeGreaterThanOrEqual(1000);
    // Row 1 (low 0) cannot be drawn on the log axis, so its high 5000 is not fitted (review finding 2).
    expect(shown.view.yDomains![1]![1]).toBeLessThan(5000);
    expect(hidden.view.yDomains![1]![1]).toBeLessThan(1000);
    expect(hidden.view.yDomains![1]![0]).toBeLessThanOrEqual(5);
    expect(hidden.view.yDomains![1]![1]).toBeGreaterThanOrEqual(5);
    // The nonpositive low of row 1 is counted for the reader (AX171) and not drawn; the readout keeps it raw.
    expect(shown.diagnostics.filter(d => d.code === 'AX171').map(d => d.field)).toEqual(['lo']);
    expect(shown.lookup.tooltip({ kind: 'x', x: 2 }).rows[0]!.value).toBe('0 (not plotted) – 5,000');
    expect(shown.reader.table!.row(1)![1]).toBe('0 (not plotted — log) – 5,000');
    // A nonpositive high bound (a carrier after the published series) is marked the same way.
    const highZero = n5run({ ...logOptions, data: [{ x: 1, lo: 1, hi: 10, c: 5 }, { x: 2, lo: 2, hi: -3, c: 5 }] });
    expect(highZero.lookup.tooltip({ kind: 'x', x: 2 }).rows[0]!.value).toBe('2 – -3 (not plotted)');
    expect(highZero.diagnostics.filter(d => d.code === 'AX171').map(d => d.field)).toEqual(['hi']);
  });

  it('reports a centre field a layer cannot read instead of dropping it silently (AX150)', () => {
    const withY = (layer: Record<string, unknown>) => validateCartesian({
      data: rows, x: 'x', axes: { v: { position: 'left' } }, layers: [layer],
    } as never).filter(d => d.code === 'AX150').map(d => [d.field, d.level]);
    expect(withY({ type: 'range', y: 'm', low: 'lo', high: 'hi', yAxis: 'v' })).toEqual([['layers[0].y', 'warning']]);
    expect(withY({ type: 'errorBar', y: 42, low: 'elo', high: 'ehi', yAxis: 'v' })).toEqual([['layers[0].y', 'warning']]);
    expect(withY({ type: 'errorBar', y: 'm', low: 'elo', high: 'ehi', yAxis: 'v' })).toEqual([]);
  });

  it('counts logical series for AX130 (more than eight series)', () => {
    const many = (n: number) => ({
      data: [{ x: 1, ...Object.fromEntries(Array.from({ length: 3 * n }, (_, i) => [`f${i}`, i + 1])) }],
      x: 'x', axes: { v: { position: 'left' } },
      layers: Array.from({ length: n }, (_, i) => ({ type: 'errorBar', y: `f${3 * i}`, low: `f${3 * i + 1}`, high: `f${3 * i + 2}`, yAxis: 'v' })),
    });
    // 8 error bars are 24 carriers and 8 series: no AX130. 9 are 9 series: AX130.
    expect(n5run(many(8)).diagnostics.some(d => d.code === 'AX130')).toBe(false);
    expect(n5run(many(9)).diagnostics.some(d => d.code === 'AX130')).toBe(true);
    expect(validateCartesian(many(8) as never).some(d => d.code === 'AX130')).toBe(false);
  });
});
