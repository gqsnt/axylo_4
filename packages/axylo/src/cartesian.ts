/**
 * Opt-in multi-scale & log-scale Cartesian entry point (`axylo/cartesian`, RFC C4.1).
 * Supports 1 or 2 y-axes (`'left'` and `'right'`) with stable string IDs, `'linear'` and `'log'`
 * value scales, and mixed `bar` / `area` / `line` layers sharing one `AlignedFrame` with 0 B tax
 * on legacy root (`axylo`), `axylo/static`, and `axylo/stream` consumers.
 */
import type { CommonOptions, Diagnostic, Target, ValueField, XField, XValue } from './public.js';
import type { StaticChart } from './static.js';
import { createStaticChart } from './core/chart';
import type { Composition } from './core/composition';
import { createTimeReadout } from './format/time';
import { lineSwatch } from './dom/swatch';
import { svgArea, svgBand, svgPath, svgPoints, svgRects, svgRule } from './render/svg';
import { DiagnosticCollector } from './diagnostics/collector';
import { toPublic, namingDiagnostics } from './core/stages';
import { resolveOptions } from './data/options';
import { reportCartesian } from './cartesian/diagnostics';
import { createCartesianLayoutStage } from './cartesian/layout';
import { createCartesianLookup } from './cartesian/lookup';
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

export type CartesianLayerOptions<Row, Axes extends AxesRecord> =
  | { readonly type: 'line'; readonly y: ValueField<Row> | readonly ValueField<Row>[]; readonly yAxis: AnyAxisId<Axes> }
  | { readonly type: 'bar' | 'area'; readonly y: ValueField<Row> | readonly ValueField<Row>[]; readonly yAxis: LinearAxisId<Axes>; readonly stacked?: boolean };

export interface CartesianOptions<Row, Axes extends AxesRecord> extends CommonOptions<Row> {
  readonly x: XField<Row>;
  readonly axes: Axes;
  readonly layers: readonly [CartesianLayerOptions<Row, NoInfer<Axes>>, ...CartesianLayerOptions<Row, NoInfer<Axes>>[]];
  readonly reference?: readonly CartesianReference<NoInfer<Axes>>[];
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
    interaction: { overlay, swatch: lineSwatch, stepInSeries: null, sliceList: null },
    svg: { area: svgArea, band: svgBand, path: svgPath, points: svgPoints, rects: svgRects, rule: svgRule },
  };
}

/** Create a static multi-scale Cartesian chart (line + bar + area, 1–2 y-axes, linear or log). */
export function cartesian<Row, const Axes extends AxesRecord>(
  target: Target,
  options: CartesianOptions<Row, Axes>,
): StaticCartesianChart<Row, Axes> {
  let currentRaw: Record<string, unknown> = options && typeof options === 'object' ? { ...options } : {};
  const parsed = parseCartesianInput(currentRaw);
  const stateRef: CartesianStateRef = { meta: parsed.meta };
  const pendingIssues = { list: parsed.issues };
  const composition = createCartesianComposition(stateRef, pendingIssues);
  const inner = createStaticChart(composition, target, parsed.translated);

  const handle: StaticCartesianChart<Row, Axes> = {
    update(patch) {
      if (patch && typeof patch === 'object') {
        currentRaw = { ...currentRaw, ...patch };
      }
      const next = parseCartesianInput(currentRaw, stateRef.meta);
      stateRef.meta = next.meta;
      pendingIssues.list = next.issues;
      inner.update(next.translated);
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
