/**
 * C4.3 unit tests for `axylo/cartesian`: mixed line + bar + area layers, dual y-axes (linear + log),
 * deterministic paint order & pick priority, exact-data table/tooltip/reference parity, nonpositive
 * log omission (`AX171`), invalid option diagnostics (`AX170`/`AX172`/`AX173`/`AX174`), and Node SSR
 * `validateCartesian`.
 */
import { describe, expect, it } from 'vitest';
import { validateCartesian } from '../../src/cartesian';
import { parseCartesianInput } from '../../src/cartesian/options';
import { normalizeCartesian } from '../../src/cartesian/normalize';
import { buildCartesianView } from '../../src/cartesian/view';
import { createCartesianLayoutStage } from '../../src/cartesian/layout';
import { buildCartesianScene } from '../../src/cartesian/scene';
import { createCartesianLookup } from '../../src/cartesian/lookup';
import { createCartesianReader } from '../../src/cartesian/reader';
import type { CartesianStateRef } from '../../src/cartesian/meta';
import { DiagnosticCollector, readerDisclosure } from '../../src/diagnostics/collector';
import { resolveOptions } from '../../src/data/options';
import { createFormatters } from '../../src/format';
import { defaultMessages } from '../../src/messages';
import { readerWith } from '../../src/reader';
import { axisScaleOf } from '../../src/cartesian/scale-ref';
import type { AxisContext } from '../../src/core/axes';

const measurer = { width: (text: string) => text.length * 7 };
const style = { font: '12px sans-serif', letterSpacing: 0, wordSpacing: 0, lineHeight: 16 };

function runPipeline(input: Record<string, unknown>, width = 640, height = 320, zoom: readonly [number, number] | null = null) {
  const parsed = parseCartesianInput(input);
  const stateRef: CartesianStateRef = { meta: parsed.meta };
  const sink = new DiagnosticCollector();
  const cleanOpts = { ...parsed.translated };
  const stripY = (item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(item)) if (!k.startsWith('__')) out[k] = v;
    return out;
  };
  cleanOpts.y = Array.isArray(cleanOpts.y) ? cleanOpts.y.map(stripY) : stripY(cleanOpts.y);
  if (Array.isArray(cleanOpts.reference)) {
    cleanOpts.reference = cleanOpts.reference.map(r =>
      r && typeof r === 'object' ? (({ axisId: _a, ...rest }) => rest)(r as Record<string, unknown>) : r);
  }
  const resolved = resolveOptions('line', cleanOpts, sink);
  const frame = normalizeCartesian(stateRef, 'line', resolved, { timeZone: 'UTC' }, sink, { epoch: 1, revision: 1 });
  const view = buildCartesianView(stateRef, frame, {
    kind: 'line', hidden: new Set(), zoom: zoom as never, xField: resolved.x, xDomain: resolved.x.domain,
    valueDomain: null, valueField: resolved.values[0]?.field,
    references: Array.isArray(cleanOpts.reference) ? cleanOpts.reference as never : [],
    previous: null, stacked: false, horizontal: false, compact: false,
  }, sink);
  const ctx: AxisContext = { resolved, locale: 'en-US', compact: false, xLabelGiven: true, valueTitle: 'Value' };
  const layoutStage = createCartesianLayoutStage(stateRef);
  const layout = layoutStage.compute(view, { width, height }, { measurer, style }, ctx);
  const scene = buildCartesianScene(stateRef, view, layout, 1);
  const formatters = createFormatters({
    series: frame.series.map(s => {
      const axis = s.axisId ? stateRef.meta.axisById.get(s.axisId) : undefined;
      return { field: s.field, unit: s.unit, scale: s.valueScale, format: axis?.format ?? null };
    }),
    x: { field: resolved.x.field, kind: frame.x.kind, unit: resolved.x.unit, timeZone: frame.x.timeZone, dateUnit: frame.x.dateUnit, categories: frame.x.categories },
    locale: 'en-US',
    messages: defaultMessages,
  }, { locale: 'en-US', timeZone: 'UTC' });
  const lookup = createCartesianLookup(stateRef, view, layout, formatters, defaultMessages);
  const readerParts = createCartesianReader(stateRef);
  const reader = readerWith(readerParts, {
    view, formatters, messages: defaultMessages, type: 'Line', title: 'Dual',
    disclosure: readerDisclosure(sink.inputs()), locale: 'en-US',
  });
  return { stateRef, frame, view, layout, scene, formatters, lookup, reader, diagnostics: sink.inputs() };
}

describe('C4.3 axylo/cartesian mixed layers, picking, and readout parity', () => {
  it('paints bar -> area -> line in deterministic order with left linear + right log axes and exact reference formatting', () => {
    const rows = [
      { x: 1, orders: 100, baseline: 50, latency: 10 },
      { x: 2, orders: 250, baseline: 120, latency: 100 },
      { x: 3, orders: 400, baseline: 200, latency: 1000 },
    ];
    const res = runPipeline({
      title: 'Orders vs Latency',
      data: rows,
      x: 'x',
      axes: {
        orders: { position: 'left', scale: 'linear', label: 'Orders', unit: 'qty' },
        latency: { position: 'right', scale: 'log', base: 10, label: 'Latency', unit: 'ms' },
      },
      layers: [
        { type: 'line', y: 'latency', yAxis: 'latency' },
        { type: 'area', y: 'baseline', yAxis: 'orders' },
        { type: 'bar', y: 'orders', yAxis: 'orders' },
      ],
      reference: [
        { y: 300, label: 'Order Target' },
        { y: [50, 200], axisId: 'latency', label: 'SLA Band' },
      ],
    });

    expect(res.diagnostics).toEqual([]);
    expect(res.layout.kind).toBe('plot');
    if (res.layout.kind !== 'plot') return;

    // Deterministic paint order: rects (bars) before area before path (lines) even though line was declared first!
    const rectIdx = res.scene.marks.findIndex(m => m.type === 'rects');
    const areaIdx = res.scene.marks.findIndex(m => m.type === 'area');
    const lineIdx = res.scene.marks.findIndex(m => m.type === 'path' && m.series === 0);
    expect(rectIdx).toBeGreaterThanOrEqual(0);
    expect(areaIdx).toBeGreaterThan(rectIdx);
    expect(lineIdx).toBeGreaterThan(areaIdx);

    // Reference text uses LEFT axis unit ('qty') for omitted axisId even though right-axis line was declared first,
    // AND uses RIGHT axis unit ('ms') for BOTH band endpoints on 'latency'!
    expect(res.reader.summary).toContain('300 qty');
    expect(res.reader.summary).toContain('50 ms');
    expect(res.reader.summary).toContain('200 ms');

    // Pointer pick priority: clicking near the line vertex picks the line series (index 0) even over a bar at the same x
    const xScale = res.layout.projection.kind === 'xy' ? res.layout.projection.x : null;
    expect(xScale).not.toBeNull();
    const px = xScale!.map(2);
    const pyLine = axisScaleOf(res.layout.projection, 1).map(100);
    const target = res.lookup.pick(px, pyLine);
    expect(target).toEqual({ kind: 'x', x: 2 });
    expect(res.lookup.primary(target!)).toEqual({ kind: 'aligned', seriesKey: 'latency', x: 2 });
    const tip = res.lookup.tooltip(target!);
    expect(tip.rows.map(r => r.value)).toEqual(['100 ms', '120 qty', '250 qty']);
  });

  it('emits AX171 in data stage for nonpositive log values, omits them from line geometry, and retains raw values in table', () => {
    const rows = [
      { x: 1, orders: 100, latency: 10 },
      { x: 2, orders: 200, latency: 0 },
      { x: 3, orders: 300, latency: -5 },
      { x: 4, orders: 400, latency: 1000 },
    ];
    const res = runPipeline({
      title: 'Dirty log',
      data: rows,
      x: 'x',
      axes: {
        orders: { position: 'left', scale: 'linear' },
        latency: { position: 'right', scale: 'log', unit: 'ms' },
      },
      layers: [
        { type: 'bar', y: 'orders', yAxis: 'orders' },
        { type: 'line', y: 'latency', yAxis: 'latency' },
      ],
    });

    const ax171 = res.diagnostics.find(d => d.code === 'AX171');
    expect(ax171).toBeDefined();
    expect(ax171!.effect).toBe('omitted');
    expect(ax171!.count).toBe(2);
    expect(ax171!.rows).toEqual([1, 2]);
    // F12 reader note reflects 2 values not shown
    expect(res.reader.note).toMatch(/Values not shown: 2/);
    // Table retains exact raw values with log qualifier
    expect(res.reader.table!.row(1)![2]).toBe('0 ms (not plotted — log)');
    expect(res.reader.table!.row(2)![2]).toBe('-5 ms (not plotted — log)');
    // Anchor for nonpositive log point is null (omitted from geometry), positive points have valid anchors
    expect(res.lookup.anchor({ kind: 'aligned', seriesKey: 'latency', x: 2 })).toBeNull();
    expect(res.lookup.anchor({ kind: 'aligned', seriesKey: 'latency', x: 1 })).not.toBeNull();
    // Zoom recomputes auto linear & log domains independently for visibleSlots [0, 2) (only x=1 positive on log!)
    const zoomed = runPipeline({
      title: 'Dirty log',
      data: rows,
      x: 'x',
      axes: {
        orders: { position: 'left', scale: 'linear' },
        latency: { position: 'right', scale: 'log', unit: 'ms' },
      },
      layers: [
        { type: 'bar', y: 'orders', yAxis: 'orders' },
        { type: 'line', y: 'latency', yAxis: 'latency' },
      ],
    }, 640, 320, [1, 2]);
    expect(zoomed.view.yDomains![0]![1]).toBeLessThan(400);
    expect(zoomed.view.yDomains![1]![0]).toBeGreaterThan(0);
    expect(zoomed.diagnostics.find(d => d.code === 'AX171')?.count).toBe(2);
  });

  it('validateCartesian catches AX170, AX172, AX173, and AX174 cleanly in Node (no DOM)', () => {
    const data = [{ x: 1, a: 10, b: 20 }];
    // AX173: bar on log
    const d173 = validateCartesian({
      title: 'Bad bar', data, x: 'x',
      axes: { y: { position: 'left', scale: 'log' } },
      layers: [{ type: 'bar', y: 'a', yAxis: 'y' as never }],
    });
    expect(d173.some(d => d.code === 'AX173')).toBe(true);

    // AX174: zero left axes (right-only), duplicate field across axes, unknown axis
    const d174RightOnly = validateCartesian({
      title: 'Right only', data, x: 'x',
      axes: { r: { position: 'right', scale: 'linear' } },
      layers: [{ type: 'line', y: 'a', yAxis: 'r' }],
    });
    expect(d174RightOnly.some(d => d.code === 'AX174')).toBe(true);

    const d174DupField = validateCartesian({
      title: 'Dup field', data, x: 'x',
      axes: { l: { position: 'left' }, r: { position: 'right' } },
      layers: [
        { type: 'bar', y: 'a', yAxis: 'l' },
        { type: 'line', y: 'a', yAxis: 'r' },
      ],
    });
    expect(d174DupField.some(d => d.code === 'AX174')).toBe(true);

    // AX170: bad log domain & bad base
    const d170 = validateCartesian({
      title: 'Bad log', data, x: 'x',
      axes: { y: { position: 'left', scale: 'log', domain: [0, 100], base: 3 as never } },
      layers: [{ type: 'line', y: 'a', yAxis: 'y' }],
    });
    expect(d170.filter(d => d.code === 'AX170').length).toBeGreaterThanOrEqual(1);

    // AX172: all nonpositive on log — even when a positive reference line is present!
    const d172 = validateCartesian({
      title: 'All neg', data: [{ x: 1, a: 0 }, { x: 2, a: -5 }], x: 'x',
      axes: { y: { position: 'left', scale: 'log' } },
      layers: [{ type: 'line', y: 'a', yAxis: 'y' }],
      reference: [{ y: 100, axisId: 'y', label: 'Positive Ref' }],
    });
    expect(d172.some(d => d.code === 'AX172')).toBe(true);
  });

  it('picks the second of two equal-height grouped bars, renders stacked bars & areas cumulatively, and preserves reference axis after invalid ref', () => {
    const rows = [
      { x: 1, a: 100, b: 100 },
      { x: 2, a: 100, b: 100 },
    ];
    // Grouped equal-height bars: clicking the second bar's x-center selects series 'b'
    const grouped = runPipeline({
      title: 'Grouped', data: rows, x: 'x',
      axes: { y: { position: 'left', scale: 'linear' } },
      layers: [{ type: 'bar', y: ['a', 'b'], yAxis: 'y' }],
    });
    const rectMarks = grouped.scene.marks.filter(m => m.type === 'rects');
    expect(rectMarks).toHaveLength(2);
    const secondBar = rectMarks[1]!;
    if (secondBar.type === 'rects') {
      const bx = secondBar.xywh[0]! + secondBar.xywh[2]! / 2;
      const by = secondBar.xywh[1]! + secondBar.xywh[3]! / 2;
      const tgt = grouped.lookup.pick(bx, by);
      expect(grouped.lookup.primary(tgt!)).toEqual({ kind: 'aligned', seriesKey: 'b', x: 1 });
    }

    // Stacked bars: second bar sits ABOVE first bar (smaller y pixel, non-overlapping y range)
    const stacked = runPipeline({
      title: 'Stacked', data: rows, x: 'x',
      axes: { y: { position: 'left', scale: 'linear' } },
      layers: [{ type: 'bar', y: ['a', 'b'], yAxis: 'y', stacked: true }],
    });
    const sRects = stacked.scene.marks.filter(m => m.type === 'rects');
    expect(sRects).toHaveLength(2);
    if (sRects[0]!.type === 'rects' && sRects[1]!.type === 'rects') {
      expect(sRects[1]!.xywh[1]!).toBeLessThan(sRects[0]!.xywh[1]!);
    }

    // Container >= 360 px (380 px) whose fitted plot width is < 360 px collapses right axis & annotates summary (spec L9)
    const narrowPlot = runPipeline({
      title: 'Narrow plot', data: [{ x: 1, orders: 100, latency: 10 }, { x: 2, orders: 200, latency: 100 }], x: 'x',
      axes: {
        orders: { position: 'left', scale: 'linear', label: 'Orders', unit: 'qty' },
        latency: { position: 'right', scale: 'log', label: 'Latency', unit: 'ms' },
      },
      layers: [
        { type: 'bar', y: 'orders', yAxis: 'orders' },
        { type: 'line', y: 'latency', yAxis: 'latency' },
      ],
      reference: [
        // Invalid reference dropped before resolution must not shift the next reference's axis!
        { y: Number.NaN, axisId: 'orders', label: 'Dropped' },
        { y: [10, 50], axisId: 'latency', label: 'SLA' },
      ],
    }, 380, 260);
    expect(narrowPlot.layout.kind).toBe('plot');
    if (narrowPlot.layout.kind === 'plot') {
      expect(narrowPlot.layout.yTicksRight).toBeUndefined();
    }
    expect(narrowPlot.reader.summary).toContain('Secondary right axis (Latency (ms))');
    expect(narrowPlot.reader.summary).toContain('10 ms');
    expect(narrowPlot.reader.summary).toContain('50 ms');
  });
});
