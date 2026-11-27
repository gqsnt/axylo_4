/**
 * C5.1 & C5.2 unit tests for `axylo/cartesian` range bands, error bars (ordered, missing, reversed -> AX176),
 * and opt-in annotations (point, threshold, shaded range, collision avoidance, accessible summary,
 * unchanged exact datum lookup & legacy Reference parity).
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
import { DiagnosticCollector } from '../../src/diagnostics/collector';
import { resolveOptions } from '../../src/data/options';
import { createFormatters } from '../../src/format';
import { defaultMessages } from '../../src/messages';
import { readerWith } from '../../src/reader';
import type { TextMeasurer, TextStyle } from '../../src/core/contracts';
import type { AxisContext } from '../../src/core/axes';

const measurer: TextMeasurer = { width: text => text.length * 7 };
const style: TextStyle = { font: '12px sans-serif', letterSpacing: 0, wordSpacing: 0, lineHeight: 16 };

function runPipeline(options: Record<string, unknown>, size = { width: 640, height: 320 }) {
  const parsed = parseCartesianInput(options);
  const stateRef = { meta: parsed.meta };
  const sink = new DiagnosticCollector();
  const clean = { ...parsed.translated };
  const stripY = (item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(item)) if (!k.startsWith('__')) out[k] = v;
    return out;
  };
  clean.y = Array.isArray(clean.y) ? clean.y.map(stripY) : stripY(clean.y);
  const resolved = resolveOptions('line', clean, sink);
  const frame = normalizeCartesian(stateRef, 'line', resolved, { timeZone: 'UTC' }, sink, { epoch: 1, revision: 1 });
  const view = buildCartesianView(stateRef, frame, {
    kind: 'line', hidden: new Set(), zoom: null, xField: resolved.x, xDomain: resolved.x.domain,
    valueDomain: null, valueField: resolved.values[0]?.field, references: Array.isArray(clean.reference) ? clean.reference as never : [],
    previous: null, stacked: false, horizontal: false, compact: false,
  }, sink);
  const ctx: AxisContext = { resolved, locale: 'en-US', compact: false, xLabelGiven: true, valueTitle: 'Value' };
  const layoutStage = createCartesianLayoutStage(stateRef);
  const layout = layoutStage.compute(view, size, { measurer, style }, ctx);
  const scene = buildCartesianScene(stateRef, view, layout, 1);
  const formatters = createFormatters({
    series: frame.series.map(s => ({ field: s.field, unit: s.unit, scale: s.valueScale, format: null })),
    x: { field: resolved.x.field, kind: frame.x.kind, unit: resolved.x.unit, scale: resolved.x.scale, format: null, timeZone: frame.x.timeZone, dateUnit: frame.x.dateUnit, categories: frame.x.categories },
    locale: 'en-US',
    messages: { noData: defaultMessages.noData, noObservation: defaultMessages.noObservation },
  }, { locale: 'en-US', timeZone: 'UTC' });
  const lookup = createCartesianLookup(stateRef, view, layout, formatters, defaultMessages);
  const reader = readerWith(createCartesianReader(stateRef), {
    view, formatters, messages: defaultMessages, type: 'Line', title: String(options.title ?? 'Chart'), locale: 'en-US',
  });
  return { stateRef, frame, view, layout, scene, lookup, reader, diags: sink.inputs() };
}

describe('C5.1 range bands & error bars in axylo/cartesian', () => {
  it('renders range band + errorBar whiskers + center points with zero borrowed column copy and reports AX176 on reversed bounds', () => {
    const lowCol = new Float64Array([10, 40, NaN, 25]);
    const highCol = new Float64Array([30, 20, 50, 45]); // row 1 reversed (40 > 20), row 2 missing low
    const midCol = new Float64Array([20, 30, 35, 35]);
    const lowCopy = Float64Array.from(lowCol);

    const opts = {
      title: 'Confidence Band',
      data: { columns: { step: [1, 2, 3, 4], low: lowCol, high: highCol, mid: midCol } },
      x: 'step',
      axes: { v: { position: 'left', unit: 'ms' } },
      layers: [
        { type: 'range' as const, low: 'low', high: 'high', yAxis: 'v' as const, label: '95% CI' },
        { type: 'line' as const, y: 'mid', yAxis: 'v' as const },
      ],
    };

    const { frame, scene, diags, reader } = runPipeline(opts);
    // Borrowed column preserved unmodified
    expect([...lowCol]).toEqual([...lowCopy]);
    expect(frame.series[0]!.y).toBe(lowCol);

    // Reversed interval diagnostic AX176 emitted with exact row index 1
    const ax176 = diags.filter(d => d.code === 'AX176');
    expect(ax176).toHaveLength(1);
    expect(ax176[0]!.rows).toEqual([1]);
    expect(ax176[0]!.count).toBe(1);

    // Area band rendered (run covers rows 0..1; row 2 missing breaks run cleanly!)
    const areas = scene.marks.filter(m => m.type === 'area');
    expect(areas).toHaveLength(1);
    // Exact raw values preserved in table (row 1 keeps raw low=40 ms, high=20 ms), in the range's one column (N5)
    expect(reader.table!.headers).toEqual(['step', '95% CI (ms)', 'mid (ms)']);
    expect(reader.table!.row(1)).toEqual(['2', '40 ms – 20 ms', '30 ms']);

    // validateCartesian reports AX176 in Node too
    const nodeDiags = validateCartesian(opts as never);
    expect(nodeDiags.some(d => d.code === 'AX176')).toBe(true);
  });

  it('batches errorBar whiskers and caps into a single typed PathMark and renders singleton range intervals', () => {
    const { scene, diags } = runPipeline({
      title: 'Error Bars',
      data: [
        { cat: 'A', low: 10, mid: 15, high: 20 },
        { cat: 'B', low: 18, mid: 24, high: 30 },
      ],
      x: 'cat',
      axes: { y: { position: 'left' } },
      layers: [{ type: 'errorBar', y: 'mid', low: 'low', high: 'high', yAxis: 'y', capWidth: 10 }],
    });
    expect(diags).toEqual([]);
    // Batched into 1 PathMark containing 2 slots * (vertical whisker + 2 end caps) = 36 floats
    const paths = scene.marks.filter(m => m.type === 'path');
    expect(paths).toHaveLength(1);
    if (paths[0]!.type === 'path') expect(paths[0]!.xy.length).toBe(36);
    const pts = scene.marks.filter(m => m.type === 'points');
    expect(pts).toHaveLength(1);

    // Singleton valid range slot still emits a visible span PathMark
    const single = runPipeline({
      title: 'Singleton Range',
      data: [{ x: 1, lo: 10, hi: 30 }],
      x: 'x',
      axes: { y: { position: 'left' } },
      layers: [{ type: 'range', low: 'lo', high: 'hi', yAxis: 'y' }],
    });
    expect(single.scene.marks.filter(m => m.type === 'path')).toHaveLength(1);
  });
});

describe('C5.2 opt-in annotations in axylo/cartesian', () => {
  it('places point, threshold, and shaded range annotations clipped to plot, avoids label overlaps, writes accessible summary, and preserves datum lookup', () => {
    const { layout, scene, lookup, reader } = runPipeline({
      title: 'Deployments & SLA',
      data: [
        { x: 1, ms: 40 },
        { x: 2, ms: 90 },
        { x: 3, ms: 160 },
        { x: 4, ms: 70 },
      ],
      x: 'x',
      axes: { ms: { position: 'left', unit: 'ms' } },
      layers: [{ type: 'line', y: 'ms', yAxis: 'ms' }],
      reference: [{ y: 120, axisId: 'ms', label: 'Legacy Ref' }],
      annotations: [
        { type: 'point', x: 3, y: 160, axisId: 'ms', label: 'v4.2 Deploy', description: 'Latency spike after rollout' },
        { type: 'threshold', axis: 'y', value: 100, axisId: 'ms', label: 'SLA 100ms' },
        { type: 'range', axis: 'x', from: 2, to: 3, label: 'Incident Window' },
        // Out-of-bounds point should be clipped out of visual marks/labels cleanly
        { type: 'point', x: 99, y: 50, axisId: 'ms', label: 'Out of window' },
      ],
    });
    expect(layout.kind).toBe('plot');
    if (layout.kind !== 'plot') return;

    // Annotation marks: 1 band (Incident Window), threshold rule + legacy ref rule, point diamond + leader
    const bands = scene.marks.filter(m => m.type === 'band');
    expect(bands).toHaveLength(1);
    const refLabels = layout.texts.filter(t => t.role === 'reference').map(t => t.full);
    expect(refLabels).toContain('Legacy Ref');
    expect(refLabels).toContain('v4.2 Deploy');
    expect(refLabels).toContain('SLA 100ms');
    expect(refLabels).toContain('Incident Window');
    expect(refLabels).not.toContain('Out of window');

    // Summary contains full accessible annotation text including descriptions
    expect(reader.summary).toContain('Annotation v4.2 Deploy at 3, 160 ms — Latency spike after rollout.');
    expect(reader.summary).toContain('Threshold SLA 100ms at y = 100 ms.');
    expect(reader.summary).toContain('Range Incident Window from 2 to 3.');

    // Exact datum lookup unaffected by annotations
    const target = lookup.pick(layout.plot.x + layout.plot.width * 0.66, layout.plot.y + layout.plot.height * 0.5);
    expect(target?.kind).toBe('x');
    if (target?.kind === 'x') {
      const tip = lookup.tooltip(target);
      expect(tip.rows[0]!.value).toMatch(/ms$/);
    }
  });

  it('tracks hidden annotation labels via fit.y.hidden when labels collide in a tight plot (zero silent loss)', () => {
    const { layout, reader } = runPipeline({
      title: 'Crowded Annotations',
      data: [{ x: 1, y: 10 }, { x: 2, y: 20 }],
      x: 'x',
      axes: { y: { position: 'left' } },
      layers: [{ type: 'line', y: 'y', yAxis: 'y' }],
      annotations: Array.from({ length: 10 }, (_, i) => ({
        type: 'point' as const, x: 1, y: 10, label: `Event Label #${i + 1} Long Title`,
      })),
    }, { width: 280, height: 180 });
    expect(layout.kind).toBe('plot');
    if (layout.kind !== 'plot') return;
    expect(layout.fit.y.hidden).toBeGreaterThan(0);
    // All 10 remain present in the accessible summary
    expect(reader.summary).toContain('Event Label #10 Long Title');
  });
});
