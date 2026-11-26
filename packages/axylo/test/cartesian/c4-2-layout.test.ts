/**
 * C4.2 per-axis domain calculation, dual-axis responsive layout (spec L9), and single projection
 * authority (`axisScaleOf`) unit tests.
 */
import { describe, expect, it } from 'vitest';
import {
  SLOT_VALUE, type AlignedFrame, type AlignedView, type TextMeasurer, type TextStyle,
} from '../../src/core/contracts';
import type { AxisContext } from '../../src/core/axes';
import { DiagnosticCollector } from '../../src/diagnostics/collector';
import { axisScaleOf } from '../../src/cartesian/scale-ref';
import { computeAxisDomain } from '../../src/cartesian/axes';
import { createCartesianLayoutStage, DUAL_AXIS_MIN_WIDTH } from '../../src/cartesian/layout';
import type { CartesianAxisSpec, CartesianMeta, CartesianSeriesSpec, CartesianStateRef } from '../../src/cartesian/meta';

const measurer: TextMeasurer = { width: text => text.length * 7 };
const style: TextStyle = { font: '12px sans-serif', letterSpacing: 0, wordSpacing: 0, lineHeight: 16 };

function makeFixture(opts: {
  leftScale?: 'linear' | 'log';
  rightScale?: 'linear' | 'log';
  leftValues?: number[];
  rightValues?: number[];
  leftDomain?: [number, number] | null;
  rightDomain?: [number, number] | null;
  rightBase?: unknown;
  leftMark?: 'bar' | 'line';
  singleAxis?: boolean;
} = {}) {
  const leftValues = opts.leftValues ?? [100, 250, 400];
  const rightValues = opts.rightValues ?? [1, 10, 100];
  const n = leftValues.length;
  const leftAxis: CartesianAxisSpec = {
    id: 'orders', index: 0, position: 'left', scale: opts.leftScale ?? 'linear', base: 10,
    domain: opts.leftDomain ?? null, rawDomain: opts.leftDomain ?? undefined,
    label: 'Orders', unit: null, format: null, tickFormat: null,
  };
  const rightAxis: CartesianAxisSpec | null = opts.singleAxis ? null : {
    id: 'latency', index: 1, position: 'right', scale: opts.rightScale ?? 'log', base: 10,
    rawBase: opts.rightBase,
    domain: opts.rightDomain ?? null, rawDomain: opts.rightDomain ?? undefined,
    label: 'p99 Latency', unit: 'ms', format: null, tickFormat: null,
  };
  const axes = rightAxis ? [leftAxis, rightAxis] : [leftAxis];
  const seriesSpecs: CartesianSeriesSpec[] = [
    { field: 'orders', label: 'Orders', mark: opts.leftMark ?? 'bar', stacked: false, axisId: 'orders', axisIndex: 0, layerIndex: 0 },
    ...(rightAxis ? [{ field: 'latency', label: 'p99 Latency', mark: 'line' as const, stacked: false, axisId: 'latency', axisIndex: 1 as const, layerIndex: 1 }] : []),
  ];
  const meta: CartesianMeta = {
    axes,
    axisById: new Map(axes.map(a => [a.id, a])),
    leftAxisId: 'orders',
    rightAxisId: rightAxis ? 'latency' : null,
    series: seriesSpecs,
    seriesByField: new Map(seriesSpecs.map(s => [s.field, s])),
    references: [],
    invalid: false,
    fullPositiveDomains: new Map(),
  };
  const frame: AlignedFrame = {
    shape: 'aligned', revision: 1, epoch: 1,
    source: { rowAt: i => ({ x: i, orders: leftValues[i], latency: rightValues[i] }) },
    x: { kind: 'number', values: Float64Array.from(leftValues.map((_, i) => i)), categories: null, timeZone: null, dateUnit: null, ordered: false },
    series: [
      {
        key: 'orders', label: 'Orders', field: 'orders', unit: null, valueScale: null, drawable: true,
        y: Float64Array.from(leftValues), slot: new Uint8Array(n).fill(SLOT_VALUE), row: null,
        axisId: 'orders', axisIndex: 0,
      },
      ...(rightAxis ? [{
        key: 'latency', label: 'p99 Latency', field: 'latency', unit: 'ms', valueScale: null, drawable: true,
        y: Float64Array.from(rightValues), slot: new Uint8Array(n).fill(SLOT_VALUE), row: null,
        axisId: 'latency', axisIndex: 1,
      }] : []),
    ],
    length: n, xLabel: 'x', yLabel: 'Orders',
  };
  const ctx: AxisContext = {
    resolved: {
      name: 'Dual', table: { rows: [], columns: null, length: n, kind: 'rows' } as never,
      x: { field: 'x', label: 'x', unit: null, type: 'number', ordered: false, timeZone: null, format: null, tickFormat: null, domain: null },
      values: [
        { field: 'orders', label: 'Orders', unit: null, scale: null, format: null, tickFormat: null, missing: 'gap', domain: null, parse: null },
      ],
      series: null, label: null, value: null,
    } as never,
    locale: 'en-US',
    compact: false,
    xLabelGiven: true,
    valueTitle: 'Value',
  };
  return { meta, stateRef: { meta } as CartesianStateRef, frame, ctx };
}

describe('C4.2 per-axis domains & diagnostics', () => {
  it('enforces zero baseline on linear bar axis while computing positive log domain on secondary axis', () => {
    const { meta, frame } = makeFixture({ leftValues: [80, 95, 110], rightValues: [5, 50, 500] });
    const sink = new DiagnosticCollector();
    const left = computeAxisDomain(frame, [true, true], { start: 0, end: 3 }, meta.axes[0]!, [], meta, sink);
    const right = computeAxisDomain(frame, [true, true], { start: 0, end: 3 }, meta.axes[1]!, [], meta, sink);
    expect(left.domain[0]).toBe(0);
    expect(left.domain[1]).toBeGreaterThanOrEqual(110);
    expect(right.domain).toEqual([1, 1000]);
    expect(sink.inputs()).toEqual([]);
  });

  it('emits AX170 for invalid log domain or unsupported base, and AX172 when all values are nonpositive', () => {
    const f1 = makeFixture({ rightScale: 'log', rightDomain: [0, 100] });
    const s1 = new DiagnosticCollector();
    const r1 = computeAxisDomain(f1.frame, [true, true], { start: 0, end: 3 }, f1.meta.axes[1]!, [], f1.meta, s1);
    expect(r1.error).toBe(true);
    expect(s1.inputs().map(d => d.code)).toEqual(['AX170']);

    const f2 = makeFixture({ rightScale: 'log', rightBase: 5 });
    const s2 = new DiagnosticCollector();
    const r2 = computeAxisDomain(f2.frame, [true, true], { start: 0, end: 3 }, f2.meta.axes[1]!, [], f2.meta, s2);
    expect(r2.error).toBe(true);
    expect(s2.inputs().map(d => d.code)).toEqual(['AX170']);

    const f3 = makeFixture({ rightScale: 'log', rightValues: [0, -5, -10] });
    const s3 = new DiagnosticCollector();
    const r3 = computeAxisDomain(f3.frame, [true, true], { start: 0, end: 3 }, f3.meta.axes[1]!, [], f3.meta, s3);
    expect(r3.error).toBe(true);
    expect(s3.inputs().map(d => d.code)).toEqual(['AX172']);
  });

  it('falls back cleanly to full-data positive domain when zoomed into an all-nonpositive log window', () => {
    const { meta, frame } = makeFixture({ leftValues: [10, 20, 30], rightValues: [-5, 0, 50] });
    const sink = new DiagnosticCollector();
    // Zoomed onto slots [0, 2) where rightValues are [-5, 0] (zero positives in window, 50 outside window)
    const zoomed = computeAxisDomain(frame, [true, true], { start: 0, end: 2 }, meta.axes[1]!, [], meta, sink);
    expect(zoomed.error).toBe(false);
    expect(zoomed.domain[0]).toBeGreaterThan(0);
    expect(zoomed.domain[0]).toBeLessThan(zoomed.domain[1]);
    expect(sink.inputs()).toEqual([]);
  });
});

describe('C4.2 dual-axis responsive layout & single projection authority', () => {
  it('renders both left and right y-axes at >= 360 px with one shared yAxes projection', () => {
    const { stateRef, frame, ctx } = makeFixture();
    const stage = createCartesianLayoutStage(stateRef);
    const view: AlignedView = {
      kind: 'line', revision: 1, frame, horizontal: false, compact: false,
      visible: [true, true], cues: [{ marker: 'circle', dash: { normal: null, contrast: null } }, { marker: 'square', dash: { normal: null, contrast: null } }],
      xFull: [0, 2], xDomain: [0, 2], yDomain: [0, 400], yDomains: [[0, 400], [1, 100]], yAxisIds: ['orders', 'latency'],
      visibleSlots: { start: 0, end: 3 }, drawSlots: [{ start: 0, end: 3 }, { start: 0, end: 3 }], stack: null, references: [],
    };
    const layout = stage.compute(view, { width: 640, height: 320 }, { measurer, style }, ctx);
    expect(layout.kind).toBe('plot');
    if (layout.kind !== 'plot') return;
    expect(layout.projection.kind).toBe('xy');
    if (layout.projection.kind !== 'xy') return;
    expect(layout.projection.yAxes).toHaveLength(2);
    expect(layout.projection.y).toBe(layout.projection.yAxes![0]);
    expect(axisScaleOf(layout.projection, 0).type).toBe('linear');
    expect(axisScaleOf(layout.projection, 1).type).toBe('log');
    expect(layout.yTicks.length).toBeGreaterThanOrEqual(2);
    expect(layout.yTicksRight!.length).toBeGreaterThanOrEqual(2);
    // Right ticks sit to the right of the plot area with anchor 'start'
    const rightTicks = layout.texts.filter(t => t.role === 'tick-y' && t.anchor === 'start');
    expect(rightTicks.length).toBe(layout.yTicksRight!.length);
    for (const rt of rightTicks) expect(rt.x).toBeGreaterThan(layout.plot.x + layout.plot.width);
    expect(stage.layoutDiagnostics!(view, ctx, layout)).toEqual([]);
  });

  it('collapses right axis below 360 px with AX175 and clears AX175 upon resize back to >= 360 px (spec L9)', () => {
    const { stateRef, frame, ctx } = makeFixture();
    const stage = createCartesianLayoutStage(stateRef);
    const view: AlignedView = {
      kind: 'line', revision: 1, frame, horizontal: false, compact: false,
      visible: [true, true], cues: [{ marker: 'circle', dash: { normal: null, contrast: null } }, { marker: 'square', dash: { normal: null, contrast: null } }],
      xFull: [0, 2], xDomain: [0, 2], yDomain: [0, 400], yDomains: [[0, 400], [1, 100]], yAxisIds: ['orders', 'latency'],
      visibleSlots: { start: 0, end: 3 }, drawSlots: [{ start: 0, end: 3 }, { start: 0, end: 3 }], stack: null, references: [],
    };
    const narrow = stage.compute(view, { width: DUAL_AXIS_MIN_WIDTH - 20, height: 240 }, { measurer, style }, ctx);
    expect(narrow.kind).toBe('plot');
    if (narrow.kind !== 'plot') return;
    expect(narrow.yTicksRight).toBeUndefined();
    // Both scales still exist in projection.yAxes so marks stay accurately projected & pickable!
    expect(axisScaleOf(narrow.projection, 1).type).toBe('log');
    const diagsNarrow = stage.layoutDiagnostics!(view, ctx, narrow);
    expect(diagsNarrow.map(d => d.code)).toEqual(['AX175']);
    expect(diagsNarrow[0]!.origin).toBe('presentation');

    // Resize back to >= 360 px -> right axis returns and AX175 clears!
    const wide = stage.compute(view, { width: DUAL_AXIS_MIN_WIDTH + 40, height: 240 }, { measurer, style }, ctx);
    expect(wide.kind).toBe('plot');
    if (wide.kind !== 'plot') return;
    expect(wide.yTicksRight!.length).toBeGreaterThanOrEqual(2);
    expect(stage.layoutDiagnostics!(view, ctx, wide)).toEqual([]);
  });
});
