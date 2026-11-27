/**
 * The Cartesian stage pipeline in Node for the N4 tests: options → frame → view → layout → scene → lookup →
 * reader, with the device pixel ratio, zoom and container size of a real chart. Mirrors the pipeline helper of
 * c4-3-cartesian.test.ts (the composition's own stages, called in the controller's order).
 */
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
import type { AxisContext } from '../../src/core/axes';
import type { AlignedView, Layout } from '../../src/core/contracts';

export const measurer = { width: (text: string) => text.length * 7 };
export const style = { font: '12px sans-serif', letterSpacing: 0, wordSpacing: 0, lineHeight: 16 };

export interface PipelineOptions {
  readonly width?: number;
  readonly height?: number;
  readonly dpr?: number;
  readonly zoom?: readonly [number, number] | null;
  /** Replaces the committed view before layout (for slot states the public options cannot express). */
  readonly edit?: (view: AlignedView) => AlignedView;
}

export function prepare(input: Record<string, unknown>, zoom: readonly [number, number] | null = null) {
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
  const resolved = resolveOptions('line', cleanOpts, sink);
  const frame = normalizeCartesian(stateRef, 'line', resolved, { timeZone: 'UTC' }, sink, { epoch: 1, revision: 1 });
  const view = buildCartesianView(stateRef, frame, {
    kind: 'line', hidden: new Set(), zoom: zoom as never, xField: resolved.x, xDomain: resolved.x.domain,
    valueDomain: null, valueField: resolved.values[0]?.field, references: [],
    previous: null, stacked: false, horizontal: false, compact: false,
  }, sink);
  const ctx: AxisContext = { resolved, locale: 'en-US', compact: false, xLabelGiven: true, valueTitle: 'Value' };
  const formatters = createFormatters({
    series: frame.series.map(s => {
      const axis = s.axisId ? stateRef.meta.axisById.get(s.axisId) : undefined;
      return { field: s.field, unit: s.unit, scale: s.valueScale, format: axis?.format ?? null };
    }),
    x: { field: resolved.x.field, kind: frame.x.kind, unit: resolved.x.unit, timeZone: frame.x.timeZone, dateUnit: frame.x.dateUnit, categories: frame.x.categories },
    locale: 'en-US',
    messages: defaultMessages,
  }, { locale: 'en-US', timeZone: 'UTC' });
  return { stateRef, sink, frame, view, ctx, formatters, layoutStage: createCartesianLayoutStage(stateRef) };
}

export function run(input: Record<string, unknown>, opts: PipelineOptions = {}) {
  const { width = 960, height = 400, dpr = 1, zoom = null, edit } = opts;
  const base = prepare(input, zoom);
  const view = edit ? edit(base.view) : base.view;
  return finish({ ...base, view }, width, height, dpr);
}

export function finish(base: ReturnType<typeof prepare>, width: number, height: number, dpr = 1) {
  const { stateRef, sink, view, ctx, formatters, layoutStage } = base;
  const layout: Layout = layoutStage.compute(view, { width, height }, { measurer, style }, ctx);
  const layoutDiagnostics = layoutStage.layoutDiagnostics?.(view, ctx, layout) ?? [];
  const scene = buildCartesianScene(stateRef, view, layout, dpr);
  const lookup = createCartesianLookup(stateRef, view, layout, formatters, defaultMessages);
  const reader = readerWith(createCartesianReader(stateRef), {
    view, formatters, messages: defaultMessages, type: 'Line', title: 'N4',
    disclosure: readerDisclosure(sink.inputs()), locale: 'en-US',
  });
  return { ...base, view, layout, layoutDiagnostics, scene, lookup, reader, diagnostics: sink.inputs() };
}

/** Deterministic noise (mulberry32), so fixtures are the same in every run. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Number of drawn vertices of a path (pen lifts excluded). */
export function vertexCount(xy: Float32Array): number {
  let n = 0;
  for (let i = 0; i < xy.length; i += 2) if (!Number.isNaN(xy[i]!)) n++;
  return n;
}

/** Number of pen lifts (NaN pairs) of a path. */
export function liftCount(xy: Float32Array): number {
  let n = 0;
  for (let i = 0; i < xy.length; i += 2) if (Number.isNaN(xy[i]!)) n++;
  return n;
}
