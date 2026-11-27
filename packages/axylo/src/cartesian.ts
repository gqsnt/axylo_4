/**
 * Opt-in multi-scale & log-scale Cartesian entry point (`axylo/cartesian`, RFC C4.1).
 * Supports 1 or 2 y-axes (`'left'` and `'right'`) with stable string IDs, `'linear'` and `'log'`
 * value scales, and mixed `bar` / `area` / `line` layers sharing one `AlignedFrame` with 0 B tax
 * on legacy root (`axylo`), `axylo/static`, and `axylo/stream` consumers.
 */
import type { CommonOptions, Diagnostic, Target, ValueField, XField, XValue } from './public.js';
import type { StaticChart } from './static.js';
import { createStaticChart } from './core/chart';
import { forwardSync } from './core/peer';
import type { Composition } from './core/composition';
import type { Layout } from './core/contracts';
import { createTimeReadout } from './format/time';
import { svgArea, svgBand, svgPath, svgPoints, svgRects, svgRule } from './render/svg';
import { DiagnosticCollector } from './diagnostics/collector';
import { toPublic, namingDiagnostics } from './core/stages';
import { resolveOptions } from './data/options';
import { reportCartesian } from './cartesian/diagnostics';
import { createCartesianLayoutStage } from './cartesian/layout';
import { createCartesianLookup } from './cartesian/lookup';
import { createMarkSwatch } from './cartesian/mark-swatch';
import type { CartesianStateRef } from './cartesian/meta';
import { normalizeCartesian } from './cartesian/normalize';
import { createCartesianResolver, parseCartesianInput } from './cartesian/options';
import { createCartesianOverlay } from './cartesian/overlay';
import { createCartesianReader } from './cartesian/reader';
import { buildCartesianScene } from './cartesian/scene';
import { buildCartesianView } from './cartesian/view';

export interface LinearAxisOptions {
  readonly position: 'left' | 'right';
  readonly scale?: 'linear';
  readonly domain?: readonly [number, number];
  readonly label?: string;
  readonly unit?: string;
  readonly format?: Intl.NumberFormatOptions | ((value: number) => string);
  readonly tickFormat?: Intl.NumberFormatOptions | ((value: number) => string);
}

export interface LogAxisOptions {
  readonly position: 'left' | 'right';
  readonly scale: 'log';
  readonly base?: 10 | 2;
  /** Strictly positive finite bounds validated at runtime (`AX170`). */
  readonly domain?: readonly [number, number];
  readonly label?: string;
  readonly unit?: string;
  readonly format?: Intl.NumberFormatOptions | ((value: number) => string);
  readonly tickFormat?: Intl.NumberFormatOptions | ((value: number) => string);
}

export type CartesianAxisOptions = LinearAxisOptions | LogAxisOptions;
export type AxesRecord = Readonly<Record<string, CartesianAxisOptions>>;

/**
 * Axis IDs provably constrained to `LinearAxisOptions` (rejects `'log'`, widened `'linear' | 'log'`,
 * and generic `AxesRecord`, while accepting both explicit `scale: 'linear'` and omitted `scale`).
 */
export type LinearAxisId<Axes extends AxesRecord> = {
  [K in Extract<keyof Axes, string>]: [Axes[K]] extends [LinearAxisOptions] ? K : never;
}[Extract<keyof Axes, string>];

export type AnyAxisId<Axes extends AxesRecord> = Extract<keyof Axes, string>;

export type CartesianReference<Axes extends AxesRecord> =
  | { readonly x: XValue | readonly [XValue, XValue]; readonly y?: never; readonly axisId?: never; readonly label: string }
  | { readonly y: number | readonly [number, number]; readonly x?: never; readonly axisId?: AnyAxisId<Axes>; readonly label: string };

export type CartesianAnnotation<Axes extends AxesRecord> =
  | { readonly type: 'point'; readonly x: XValue; readonly y: number; readonly axisId?: AnyAxisId<Axes>; readonly label: string; readonly description?: string }
  | { readonly type: 'threshold'; readonly axis: 'x'; readonly value: XValue; readonly axisId?: never; readonly label: string; readonly description?: string }
  | { readonly type: 'threshold'; readonly axis: 'y'; readonly value: number; readonly axisId?: AnyAxisId<Axes>; readonly label: string; readonly description?: string }
  | { readonly type: 'range'; readonly axis: 'x'; readonly from: XValue; readonly to: XValue; readonly axisId?: never; readonly label: string; readonly description?: string }
  | { readonly type: 'range'; readonly axis: 'y'; readonly from: number; readonly to: number; readonly axisId?: AnyAxisId<Axes>; readonly label: string; readonly description?: string };

export type CartesianLayerOptions<Row, Axes extends AxesRecord> =
  | { readonly type: 'line'; readonly y: ValueField<Row> | readonly ValueField<Row>[]; readonly yAxis: AnyAxisId<Axes> }
  | { readonly type: 'bar' | 'area'; readonly y: ValueField<Row> | readonly ValueField<Row>[]; readonly yAxis: LinearAxisId<Axes>; readonly stacked?: boolean }
  | { readonly type: 'range'; readonly low: ValueField<Row>; readonly high: ValueField<Row>; readonly yAxis: AnyAxisId<Axes>; readonly label?: string }
  | { readonly type: 'errorBar'; readonly y?: ValueField<Row>; readonly low: ValueField<Row>; readonly high: ValueField<Row>; readonly yAxis: AnyAxisId<Axes>; readonly label?: string; readonly capWidth?: number }
  | ScatterLayerOptions<Row, Axes>
  | BoxplotLayerOptions<Row, Axes>;

/** Points at their own y; rows that share an x are separate points (spec F11). Omitted `yAxis` is the left axis. */
export interface ScatterLayerOptions<Row, Axes extends AxesRecord> {
  readonly type: 'scatter';
  readonly y: ValueField<Row> | readonly ValueField<Row>[];
  readonly yAxis?: AnyAxisId<Axes> | 'left' | 'right';
  readonly label?: string;
  /** Marker size in CSS px (default 4, at most 24). */
  readonly size?: number;
}

/** A field whose values are lists of numbers (a box's outliers). */
export type NumberListKey<Row> = {
  [K in Extract<keyof Row, string>]: [Row[K]] extends [ArrayLike<number> | null | undefined] ? K : never;
}[Extract<keyof Row, string>];

/** A box per x from five precomputed numbers (`axylo/stats` boxplot() gives them). */
export interface BoxplotLayerOptions<Row, Axes extends AxesRecord> {
  readonly type: 'boxplot';
  readonly min: ValueField<Row>;
  readonly q1: ValueField<Row>;
  readonly median: ValueField<Row>;
  readonly q3: ValueField<Row>;
  readonly max: ValueField<Row>;
  readonly yAxis: AnyAxisId<Axes>;
  readonly label?: string;
  /** Whisker cap width in CSS px; omitted, the caps are as wide as the box. */
  readonly capWidth?: number;
  /** Outlier marker size in CSS px (default 3.5, at most 24). */
  readonly size?: number;
  readonly outliers?: NumberListKey<Row>;
}

export interface CartesianOptions<Row, Axes extends AxesRecord> extends CommonOptions<Row> {
  readonly x: XField<Row>;
  readonly axes: Axes;
  readonly layers: readonly [CartesianLayerOptions<Row, NoInfer<Axes>>, ...CartesianLayerOptions<Row, NoInfer<Axes>>[]];
  readonly reference?: readonly CartesianReference<NoInfer<Axes>>[];
  readonly annotations?: readonly CartesianAnnotation<NoInfer<Axes>>[];
  readonly zoom?: boolean | 'touch';
}

/** Widens editable axis fields (`label`, `unit`, `domain`, `base`, `format`, `tickFormat`) for `chart.update(...)` while preserving axis IDs and linear-vs-log classification. */
export type WidenAxis<A extends CartesianAxisOptions> = [A] extends [LogAxisOptions]
  ? LogAxisOptions
  : [A] extends [LinearAxisOptions]
    ? LinearAxisOptions
    : CartesianAxisOptions;

export type WidenAxes<Axes extends AxesRecord> = {
  readonly [K in keyof Axes]: WidenAxis<Axes[K]>;
};

export type StaticCartesianChart<Row, Axes extends AxesRecord> = StaticChart<Row, CartesianOptions<Row, WidenAxes<Axes>>>;

function createCartesianComposition(
  stateRef: CartesianStateRef,
  pendingIssues: { list: readonly { readonly code: 'AX170' | 'AX173' | 'AX174'; readonly field?: string; readonly detail: string }[] },
): Composition {
  const layout = createCartesianLayoutStage(stateRef);
  const reader = createCartesianReader(stateRef);
  const overlay = createCartesianOverlay(stateRef);
  return {
    kind: 'line',
    resolve: createCartesianResolver(stateRef, pendingIssues),
    normalize: ((kind, resolved, env, sink, version) => normalizeCartesian(stateRef, kind, resolved, env, sink, version)) as Composition['normalize'],
    view: ((frame, state, sink) => buildCartesianView(stateRef, frame as never, state as never, sink)) as Composition['view'],
    layout,
    timeReadout: createTimeReadout,
    scene: (view, lay, dpr) => buildCartesianScene(stateRef, view, lay, dpr),
    lookup: (view, lay, formatters, messages) => createCartesianLookup(stateRef, view, lay, formatters, messages),
    reader,
    interaction: { overlay, swatch: createMarkSwatch(stateRef), stepInSeries: null, sliceList: null },
    svg: { area: svgArea, band: svgBand, path: svgPath, points: svgPoints, rects: svgRects, rule: svgRule },
  };
}

interface DrawnYAxis { readonly type: string; readonly domain: readonly [number, number]; readonly range: readonly [number, number] }

/** The y axes a layout projects onto, copied for the benchmark hook (called only in instrumented builds). */
function drawnYAxes(lay: Layout): DrawnYAxis[] | null {
  const p = lay.kind === 'plot' || lay.kind === 'compact' ? lay.projection : null;
  if (!p || p.kind === 'ring') return null;
  const axes = p.yAxes ?? [p.kind === 'xy' ? p.y : p.value];
  return axes.map(a => ({ type: a.type, domain: [a.domain[0], a.domain[1]], range: [a.range[0], a.range[1]] }));
}

/** Create a static multi-scale Cartesian chart (line, bar, area, range, errorBar, scatter and boxplot layers; 1–2 y-axes, linear or log). */
export function cartesian<Row, const Axes extends AxesRecord>(
  target: Target,
  options: CartesianOptions<Row, Axes>,
): StaticCartesianChart<Row, Axes> {
  let currentRaw: Record<string, unknown> = options && typeof options === 'object' ? { ...options } : {};
  const parsed = parseCartesianInput(currentRaw);
  const stateRef: CartesianStateRef = { meta: parsed.meta };
  const pendingIssues = { list: parsed.issues };
  const composition: Composition & { benchYAxes?: DrawnYAxis[] | null } = createCartesianComposition(stateRef, pendingIssues);
  // Benchmark/test only: the y axes the last scene was drawn on. The shared root hook reports the left axis
  // alone, and bar admission needs the right axis's committed domain. A production build drops all of it.
  if (__DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__)) {
    const scene = composition.scene;
    (composition as { scene: Composition['scene'] }).scene = (view, lay, dpr) => {
      composition.benchYAxes = drawnYAxes(lay);
      return scene(view, lay, dpr);
    };
  }
  const inner = createStaticChart(composition, target, parsed.translated);

  const handle: StaticCartesianChart<Row, Axes> = {
    update(patch) {
      const prevRaw = currentRaw;
      const prevMeta = stateRef.meta;
      const prevIssues = pendingIssues.list;
      if (patch && typeof patch === 'object') {
        currentRaw = { ...currentRaw, ...patch };
      }
      const next = parseCartesianInput(currentRaw, prevMeta);
      stateRef.meta = next.meta;
      pendingIssues.list = next.issues;
      try {
        inner.update(next.translated);
      } catch (err) {
        // Transactional rollback on strict rejection: preserve previously accepted state.
        currentRaw = prevRaw;
        stateRef.meta = prevMeta;
        pendingIssues.list = prevIssues;
        throw err;
      }
    },
    zoom(range) {
      inner.zoom(range as never);
    },
    on(event, listener) {
      return inner.on(event as never, listener as never);
    },
    get diagnostics() {
      return inner.diagnostics;
    },
    destroy() {
      inner.destroy();
    },
  };
  // axylo/sync reaches the chart through the inner handle's seam (core/peer.ts).
  forwardSync(handle, inner);
  // The benchmark and test hook (core/instrument.ts) lives on the inner handle; a production build drops this.
  if (__DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__)) {
    const hook = (inner as { __bench?: { describe?: () => unknown } }).__bench;
    if (hook) {
      // Same hook (ready, revision, memory …) with describe() extended by the drawn y axes.
      const base = hook.describe;
      const extended = Object.create(hook, {
        describe: { value: () => ({ ...(base ? base.call(hook) as object : {}), yAxes: composition.benchYAxes ?? null }), enumerable: true },
      }) as object;
      Object.defineProperty(handle, '__bench', { value: extended, configurable: true, enumerable: false });
    }
  }
  return handle;
}

/** Validate `axylo/cartesian` options and data without a DOM (Node/SSR safe). */
export function validateCartesian<Row, const Axes extends AxesRecord>(
  options: CartesianOptions<Row, Axes>,
): readonly Diagnostic[] {
  const parsed = parseCartesianInput(options);
  const stateRef: CartesianStateRef = { meta: parsed.meta };
  const sink = new DiagnosticCollector();
  for (const issue of parsed.issues) {
    reportCartesian(sink, issue.code, 'chart-error', { field: issue.field, detail: issue.detail });
  }
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
  buildCartesianView(stateRef, frame, {
    kind: 'line', hidden: new Set(), zoom: null, xField: resolved.x, xDomain: resolved.x.domain,
    valueDomain: null, valueField: resolved.values[0]?.field, references: Array.isArray(cleanOpts.reference) ? cleanOpts.reference as never : [],
    previous: null, stacked: false, horizontal: false, compact: cleanOpts.compact === true,
  }, sink);
  const naming = namingDiagnostics(cleanOpts);
  for (const d of naming) sink.add(d);
  return toPublic(sink.inputs(), resolved.name);
}

export type { Diagnostic, Target, ValueField, XField, XValue, CommonOptions } from './public.js';
export type { StaticChart } from './static.js';
