/**
 * The chart controller: one implementation behind `line`, `area`, `bar`, `scatter` and `donut`.
 *
 * Two phases (plan 1.5). A call (create, update, append, zoom) resolves options, normalizes what changed and
 * builds the view synchronously, so `diagnostics` is current when it returns and a `strict` chart can throw
 * from it before anything is accepted. Everything that needs the page (layout, scene, lookup, reader model,
 * marks, text, the figure's DOM) runs in the next animation frame, from the accepted state only, and switches
 * together: no frame mixes two revisions.
 *
 * Each frame stage is cached and reruns only when its inputs change (plan 2.2). In development builds the
 * handle exposes a counter per stage (`__dev.stages()`) so tests can assert what reran.
 */
import {
  SLOT_NO_ROW, SLOT_VALUE,
  type DiagnosticInput, type Formatters, type Frame, type Layout, type Lookup, type MarkRenderer, type PickTarget,
  type ReaderModel, type ResolvedTheme, type PaintBindings, type Scene, type TextStyle, type View,
} from './contracts';
import type { Chart, ChartEvents, Diagnostic, Messages, Point, Title, XValue } from '../public';
import { AlignedStore, normalize, resolveOptions, type ChartType, type ResolvedOptions } from '../data';
import { createDiagnostic, DiagnosticCollector, readerDisclosure, report, type DiagnosticCode } from '../diagnostics';
import { createFormatters, type FormatSpec } from '../format';
import { buildView, type ViewState } from '../view';
import { computeLayout } from '../layout';
import { buildScene } from '../scene';
import { buildLookup } from '../lookup';
import { buildReader } from '../reader';
import { fill, resolveMessages } from '../messages';
import { createCanvasRenderer, createSvgRenderer, createTextLayer, type TextLayer } from '../render';
import { ensureStyles, lowContrastSeries, resolveTheme, watchTheme } from '../theme';
import { OptionsStore, sameValue, type OptionRecord } from './options';
import { Delivery, StrictError, strictViolations, type DeliveryConsole } from './delivery';
import { createMeasurer, readTextStyle, resolveLocale, sameTextStyle, viewerTimeZone, watchEnvironment } from './environment';
import { layoutInput, layoutKey, sameKey, type AxisContext } from './axes';
import { createFigure, type Figure, type FigureModel } from '../dom/figure';
import { createTooltip, type TooltipView } from '../dom/tooltip';
import { sameTarget, watchPointer } from '../dom/pointer';

export type ChartKind = ChartType;

type Span<T = number> = readonly [T, T];

/** Option keys that change what normalization reads. */
const ENCODING_KEYS = ['x', 'y', 'series', 'label', 'value'] as const;
const STAGES = ['options', 'normalize', 'append', 'view', 'frame', 'theme', 'formatters', 'layout', 'scene', 'lookup',
  'reader', 'draw', 'text', 'figure'] as const;
export type Stage = typeof STAGES[number];

const KIND_NAMES: Record<ChartKind, string> = { line: 'Line', area: 'Area', bar: 'Bar', scatter: 'Scatter', donut: 'Donut' };
const KIND_MESSAGES = { line: 'typeLine', area: 'typeArea', bar: 'typeBar', scatter: 'typeScatter', donut: 'typeDonut' } as const;

let instances = 0;

/** What the benchmark harness reads (bench/README.md): readiness and what the committed frame shows. */
export interface BenchHook {
  readonly revision: number;
  ready(): Promise<void>;
  describe(): {
    xDomain: Span | null;
    yDomain: Span | null;
    series: { key: string; points: number; oldestX: number; newestX: number; missing: number }[];
  };
}

export interface DevHook {
  stages(): Record<Stage, number>;
  /** Makes the named stage throw, to test the internal-error state; null stops it. */
  fail(stage: Stage | null): void;
  readonly renderer: 'canvas' | 'svg';
}

export type ChartHandle = Chart<unknown, Record<string, unknown>> & { __bench?: BenchHook; __dev?: DevHook };

/** The state a call produced. Only accepted states are drawn. */
interface Accepted {
  readonly options: OptionRecord;
  readonly resolved: ResolvedOptions;
  readonly store: AlignedStore | null;
  readonly frame: Frame;
  readonly dataDiagnostics: readonly DiagnosticInput[];
  readonly optionDiagnostics: readonly DiagnosticInput[];
  readonly viewDiagnostics: readonly DiagnosticInput[];
  readonly view: View;
  readonly viewKey: readonly unknown[];
  readonly zoom: Span<XValue> | null;
  /** Zoomed to the latest edge: the window follows appended data (plan 1.5). */
  readonly follow: boolean;
  readonly epoch: number;
  readonly revision: number;
  readonly messages: Messages;
  readonly name: string;
}

type Display =
  | { readonly kind: 'ready' }
  | { readonly kind: 'loading' | 'error' | 'empty' | 'internal'; readonly text: string };

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function titleOf(options: OptionRecord): { text: string; level: number; visible: boolean } | null {
  const raw = options.title;
  if (typeof raw === 'string') return raw ? { text: raw, level: 3, visible: true } : null;
  const t = object(raw) as Partial<Title>;
  if (typeof t.text !== 'string' || t.text === '') return null;
  const level = typeof t.level === 'number' && t.level >= 2 && t.level <= 6 ? Math.floor(t.level) : 3;
  return { text: t.text, level, visible: t.visible !== false };
}

function stringOption(options: OptionRecord, key: string): string | null {
  const v = options[key];
  return typeof v === 'string' && v !== '' ? v : null;
}

function isCompact(kind: ChartKind, options: OptionRecord): boolean {
  return (kind === 'line' || kind === 'area' || kind === 'bar') && options.compact === true;
}

function toPublic(inputs: readonly DiagnosticInput[], chart: string): Diagnostic[] {
  return inputs.map(({ effect: _e, origin: _o, ...d }) => ({ ...d, chart }));
}

/** An x position as the value the author would write, so a zoom window can be moved by positions. */
function positionValue(frame: Frame, position: number): XValue {
  if (frame.shape === 'donut') return position;
  const kind = frame.shape === 'points' ? frame.xKind : frame.x.kind;
  if (kind === 'time') return new Date(position);
  if (kind === 'wall') return new Date(position).toISOString().slice(0, 23);
  if (kind === 'category' && frame.shape === 'aligned') return frame.x.categories?.[position] ?? position;
  return position;
}

function tail(values: Float64Array, limit: number): number {
  return values.length ? values[values.length - 1]! : limit;
}

export interface ChartEnvironmentOverrides {
  readonly console?: DeliveryConsole | null;
}

export function createChart(kind: ChartKind, target: unknown, input: unknown, overrides: ChartEnvironmentOverrides = {}): ChartHandle {
  const root = resolveTarget(target);
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  if (win === null) throw new Error('Axylo: the target element is not in a document with a window.');
  const id = `axylo-${++instances}`;
  const counts = Object.fromEntries(STAGES.map(s => [s, 0])) as Record<Stage, number>;
  let failing: Stage | null = null;
  const stage = (name: Stage): void => {
    counts[name]++;
    if (failing === name) throw new Error(`Axylo test hook: forced failure in the ${name} stage.`);
  };

  const delivery = new Delivery({
    console: overrides.console === undefined ? (win.console as DeliveryConsole) : overrides.console,
    development: __DEV__, page: doc,
  });
  const timeZone = viewerTimeZone();
  const requestedRenderer = object(input).__renderer === 'svg' ? 'svg' : 'canvas';

  // ── synchronous phase ──────────────────────────────────────────────────────────────────────────

  const store = new OptionsStore(input);
  let accepted: Accepted | null = null;
  let presentation = new Map<string, DiagnosticInput>();
  let delivered: readonly Diagnostic[] = [];
  let destroyed = false;
  let internalError: unknown = null;
  let epochs = 0;
  let commits = 0;
  const listeners = new Map<keyof ChartEvents<unknown>, Set<(payload: never) => void>>();

  function chartName(options: OptionRecord): string {
    return titleOf(options)?.text ?? (root.id || id);
  }

  function currentDiagnostics(): Diagnostic[] {
    if (!accepted) return [];
    const all = [...accepted.optionDiagnostics, ...accepted.dataDiagnostics, ...accepted.viewDiagnostics, ...presentation.values()];
    return toPublic(all, accepted.name);
  }

  function viewStateFor(options: OptionRecord, resolved: ResolvedOptions, zoom: Span<XValue> | null, previous: View | null): ViewState {
    if (kind === 'donut') {
      const messages = resolveMessages(object(options.messages));
      return { kind, otherLabel: count => fill(messages.otherSlices, { count }), previous };
    }
    const value = resolved.values[0];
    const common = {
      zoom, xField: resolved.x, xDomain: resolved.x.domain, valueDomain: value?.domain ?? null,
      valueField: value?.field, references: Array.isArray(options.reference) ? options.reference as never : [], previous,
    };
    if (kind === 'scatter') return { ...common, kind };
    return {
      ...common, kind,
      stacked: kind === 'area' ? options.stacked === true : kind === 'bar' ? options.layout === 'stacked' : false,
      horizontal: kind === 'bar' && options.horizontal === true,
      compact: isCompact(kind, options),
    };
  }

  function viewKeyFor(options: OptionRecord, resolved: ResolvedOptions, frame: Frame, zoom: Span<XValue> | null): unknown[] {
    return [frame, zoom, resolved.x.domain, resolved.values[0]?.domain, options.reference, options.stacked, options.layout,
      options.horizontal, options.compact, kind === 'donut' ? object(options.messages).otherSlices : null];
  }

  interface Draft {
    readonly options: OptionRecord;
    readonly resolved: ResolvedOptions;
    readonly found: DiagnosticInput[];
    optionDiagnostics: readonly DiagnosticInput[];
    store: AlignedStore | null;
    frame: Frame;
    dataDiagnostics: readonly DiagnosticInput[];
    epoch: number;
    zoom: Span<XValue> | null;
    follow: boolean;
  }

  function buildViewFor(draft: Draft, previous: Accepted | null): Pick<Accepted, 'view' | 'viewKey' | 'viewDiagnostics'> {
    const key = viewKeyFor(draft.options, draft.resolved, draft.frame, draft.zoom);
    if (previous && sameValue(previous.viewKey, key)) {
      return { view: previous.view, viewKey: previous.viewKey, viewDiagnostics: previous.viewDiagnostics };
    }
    stage('view');
    const sink = new DiagnosticCollector();
    const view = buildView(draft.frame as never, viewStateFor(draft.options, draft.resolved, draft.zoom, previous?.view ?? null) as never, sink) as View;
    const viewDiagnostics = sink.inputs();
    draft.found.push(...viewDiagnostics);
    return { view, viewKey: key, viewDiagnostics };
  }

  function namingDiagnostics(options: OptionRecord): DiagnosticInput[] {
    if (titleOf(options) !== null || stringOption(options, 'labelledBy') !== null) return [];
    const sink = new DiagnosticCollector();
    report(sink, 'AX140', 'none');
    return [...sink.inputs()];
  }

  function normalizeInto(draft: Draft): void {
    stage('normalize');
    const sink = new DiagnosticCollector();
    const version = { epoch: draft.epoch, revision: (accepted?.frame.revision ?? 0) + 1 };
    if (kind === 'line' || kind === 'area' || kind === 'bar') {
      const s = new AlignedStore(kind, draft.resolved, { timeZone }, version, sink);
      draft.store = s;
      draft.frame = s.frame;
      draft.dataDiagnostics = s.diagnostics;
    } else {
      draft.store = null;
      draft.frame = normalize(kind, draft.resolved, { timeZone }, sink, version);
      draft.dataDiagnostics = sink.inputs();
    }
    draft.found.push(...sink.inputs());
  }

  /** Validates, then either throws (strict) or accepts. Nothing before `accept` changes the chart. */
  function finish(draft: Draft): void {
    const previous = accepted;
    const viewed = buildViewFor(draft, previous);
    const naming = namingDiagnostics(draft.options);
    draft.found.push(...naming);
    const name = chartName(draft.options);
    if (draft.options.strict === true) {
      const violations = strictViolations(draft.found);
      if (violations.length) throw new StrictError(name, toPublic(draft.found, name));
    }
    store.commit(draft.options);
    accepted = {
      options: draft.options, resolved: draft.resolved, store: draft.store, frame: draft.frame,
      dataDiagnostics: draft.dataDiagnostics, optionDiagnostics: [...dedupe(draft.optionDiagnostics, draft.dataDiagnostics), ...naming],
      ...viewed, zoom: draft.zoom, follow: draft.follow, epoch: draft.epoch, revision: ++commits,
      messages: resolveMessages(object(draft.options.messages)), name,
    };
    internalError = null;
    deliverChanges();
    schedule();
  }

  /** resolveOptions reports AX100 and AX101; normalization may report them again. Keep one copy. */
  function dedupe(options: readonly DiagnosticInput[], data: readonly DiagnosticInput[]): DiagnosticInput[] {
    return options.filter(o => !data.some(d => d.code === o.code && d.field === o.field));
  }

  function deliverChanges(): void {
    const now = currentDiagnostics();
    const handler = accepted?.options.onDiagnostic;
    delivery.deliver(now, delivered, typeof handler === 'function' ? handler as (d: Diagnostic) => void : null);
    delivered = now;
  }

  /** Runs a call. A strict rejection propagates; anything else that throws becomes the internal-error state. */
  function guarded(run: () => void): void {
    if (destroyed) return;
    try {
      run();
    } catch (error) {
      if (error instanceof StrictError) throw error;
      internalError = error;
      delivery.internal(accepted?.name ?? id, error);
      schedule();
    }
  }

  function update(patch: unknown): void {
    guarded(() => {
      stage('options');
      const { next, changed } = store.preview(patch);
      const sink = new DiagnosticCollector();
      const resolved = resolveOptions(kind, next, sink);
      const found = [...sink.inputs()];
      const previous = accepted;
      const draft: Draft = {
        options: next, resolved, found, optionDiagnostics: sink.inputs(), store: previous?.store ?? null, frame: previous?.frame as Frame,
        dataDiagnostics: previous?.dataDiagnostics ?? [], epoch: previous?.epoch ?? 0,
        zoom: previous?.zoom ?? null, follow: previous?.follow ?? false,
      };
      const encodingChanged = !previous || changed.has('data') ||
        ENCODING_KEYS.some(key => changed.has(key) && !sameValue(previous.options[key], next[key]));
      if (encodingChanged) {
        if (!previous || changed.has('data')) draft.epoch = ++epochs;
        normalizeInto(draft);
      }
      finish(draft);
    });
  }

  function append(rows: unknown, options?: { keep?: number }): void {
    guarded(() => {
      const previous = accepted;
      if (!previous || !Array.isArray(rows) || rows.length === 0) return;
      stage('append');
      const keep = options?.keep;
      const draft: Draft = {
        options: previous.options, resolved: previous.resolved, found: [], optionDiagnostics: withoutNaming(previous),
        store: previous.store, frame: previous.frame,
        dataDiagnostics: previous.dataDiagnostics, epoch: previous.epoch, zoom: previous.zoom, follow: previous.follow,
      };
      if (previous.store) {
        const strict = previous.options.strict === true;
        const collected = new DiagnosticCollector();
        // Under strict the store must not take rows whose diagnostics reject the call; it is built so that a
        // throwing sink leaves it unchanged.
        const sink = {
          add(d: DiagnosticInput) {
            collected.add(d);
            if (strict && strictViolations([d]).length) throw new StrictError(previous.name, toPublic(collected.inputs(), previous.name));
          },
        };
        draft.frame = previous.store.append(rows, keep === undefined ? {} : { keep }, sink);
        draft.dataDiagnostics = previous.store.diagnostics;
        draft.found.push(...collected.inputs());
      } else {
        // Scatter and donut have no streaming store: the rows join the data and the frame is rebuilt.
        const data = appendRows(previous.options.data, rows, previous.resolved.x.field, keep);
        const next = { ...previous.options, data };
        const sink = new DiagnosticCollector();
        const resolved = resolveOptions(kind, next, sink);
        Object.assign(draft, { options: next, resolved, optionDiagnostics: sink.inputs() });
        draft.found.push(...sink.inputs());
        normalizeInto(draft);
      }
      if (draft.follow && draft.zoom && draft.frame.shape !== 'donut') followLatest(draft);
      finish(draft);
    });
  }

  /** Moves a window that sat at the latest edge so it ends at the new latest x, keeping its width. */
  function followLatest(draft: Draft): void {
    const before = accepted!.view;
    if (before.kind === 'donut') return;
    const span = before.xDomain[1] - before.xDomain[0];
    const frame = draft.frame;
    const latest = frame.shape === 'aligned' ? tail(frame.x.values, before.xFull[1])
      : frame.shape === 'points' ? Math.max(...frame.series.map(s => tail(s.x, before.xFull[1]))) : NaN;
    if (!Number.isFinite(latest) || !Number.isFinite(span) || frame.shape === 'donut') return;
    if (frame.shape === 'aligned' && frame.x.kind === 'category') return;
    draft.zoom = [positionValue(frame, latest - span), positionValue(frame, latest)];
  }

  function withoutNaming(a: Accepted): readonly DiagnosticInput[] {
    return a.optionDiagnostics.filter(d => d.code !== 'AX140');
  }

  function zoom(domain: unknown): void {
    guarded(() => {
      const previous = accepted;
      if (!previous) return;
      const pair = Array.isArray(domain) && domain.length === 2 ? [domain[0], domain[1]] as unknown as Span<XValue> : null;
      const draft: Draft = {
        options: previous.options, resolved: previous.resolved, found: [], optionDiagnostics: withoutNaming(previous),
        store: previous.store, frame: previous.frame,
        dataDiagnostics: previous.dataDiagnostics, epoch: previous.epoch, zoom: pair, follow: false,
      };
      finish(draft);
      const view = accepted!.view;
      // Zoomed to the latest edge: later appends move the window with the data.
      if (pair && view.kind !== 'donut') {
        accepted = { ...accepted!, follow: view.xDomain[1] >= view.xFull[1] && view.xDomain[0] > view.xFull[0] };
      }
    });
  }

  // ── frame phase ────────────────────────────────────────────────────────────────────────────────

  const renderer: MarkRenderer = requestedRenderer === 'svg' ? createSvgRenderer(doc) : createCanvasRenderer(doc);
  const textLayer: TextLayer = createTextLayer(doc);
  const figure: Figure = createFigure(root, id, { marks: renderer.element, text: textLayer.element });
  const tooltip: TooltipView = createTooltip(figure.tooltip, figure.figure);
  const measurer = createMeasurer(doc);
  ensureStyles(doc);
  const hadScheme = root.hasAttribute('data-axylo-scheme');

  let frameRequest = 0;
  let size: { width: number; height: number } | null = null;
  let textStyle: TextStyle | null = null;
  let textStyleDirty = true;
  let fontEpoch = 0;
  let pixelRatio = win.devicePixelRatio || 1;
  let themeDirty = true;
  let themeKey: readonly unknown[] | null = null;
  let theme: { bindings: PaintBindings; theme: ResolvedTheme } | null = null;
  let themeRevision = 0;

  interface Drawn {
    accepted: Accepted;
    display: Display;
    formatters: Formatters;
    formattersKey: readonly unknown[];
    layout: Layout;
    layoutKey: readonly unknown[] | null;
    scene: Scene;
    sceneInputs: readonly unknown[];
    lookup: Lookup;
    lookupInputs: readonly unknown[];
    reader: ReaderModel;
    readerInputs: readonly unknown[];
    paintInputs: readonly unknown[];
    /** The display state already shown, for announcing changes once. */
    announced: Display['kind'] | null;
    drawnRevision: number;
  }
  let drawn: Drawn | null = null;
  const waiters: { revision: number; resolve: () => void }[] = [];

  function schedule(): void {
    if (destroyed || frameRequest !== 0) return;
    frameRequest = win!.requestAnimationFrame(() => {
      frameRequest = 0;
      flush();
    });
  }

  function addPresentation(code: DiagnosticCode, field: string | undefined, details: Parameters<typeof createDiagnostic>[2], effect: DiagnosticInput['effect'] = 'none'): void {
    const key = `${code}:${field ?? ''}`;
    if (presentation.has(key)) return;
    const next = new Map(presentation);
    next.set(key, createDiagnostic(code, effect, details, 'presentation'));
    presentation = next;
  }

  function clearPresentation(code: DiagnosticCode): void {
    let changed = false;
    const next = new Map(presentation);
    for (const key of presentation.keys()) if (key.startsWith(code + ':')) { next.delete(key); changed = true; }
    if (changed) presentation = next;
  }

  function seriesKeys(view: View): string[] {
    return view.kind === 'donut' ? view.slices.map(s => s.key) : view.frame.series.map(s => s.key);
  }

  function display(a: Accepted): Display {
    const m = a.messages;
    if (internalError !== null) return { kind: 'internal', text: m.internalError };
    const state = a.options.state;
    if (state === 'loading') return { kind: 'loading', text: m.loading };
    if (state && typeof state === 'object') {
      const s = state as { error?: unknown; empty?: unknown };
      if ('error' in s) return { kind: 'error', text: typeof s.error === 'string' && s.error ? s.error : m.error };
      if ('empty' in s) return { kind: 'empty', text: typeof s.empty === 'string' && s.empty ? s.empty : m.empty };
    }
    const all = [...a.optionDiagnostics, ...a.dataDiagnostics, ...a.viewDiagnostics];
    if (all.some(d => d.effect === 'chart-error')) return { kind: 'error', text: m.error };
    if (!hasData(a.view)) return { kind: 'empty', text: m.empty };
    return { kind: 'ready' };
  }

  function formatSpec(a: Accepted): FormatSpec {
    const { frame, resolved } = a;
    const onFormatterError = (field: string) => addPresentation('AX160', field, { field }, 'changed');
    const valueFor = (field: string) => resolved.values.find(v => v.field === field) ?? resolved.values[0];
    const locale = resolveLocale(a.options.locale, doc);
    const messages = { noData: a.messages.noData, noObservation: a.messages.noObservation };
    if (frame.shape === 'donut') {
      const v = resolved.values[0];
      return {
        series: [{ field: v?.field ?? 'value', unit: frame.unit, scale: frame.valueScale, format: v?.format ?? null }],
        x: { field: resolved.x.field, kind: 'category', unit: null, timeZone: null, dateUnit: null, categories: frame.labels },
        locale, messages, onFormatterError,
      };
    }
    const x = frame.shape === 'aligned'
      ? { kind: frame.x.kind, timeZone: frame.x.timeZone, dateUnit: frame.x.dateUnit, categories: frame.x.categories }
      : { kind: frame.xKind, timeZone: frame.timeZone, dateUnit: null, categories: null };
    const series = frame.shape === 'aligned'
      ? frame.series.map(s => ({ field: s.field, unit: s.unit, scale: s.valueScale, format: valueFor(s.field)?.format ?? null }))
      : frame.series.map(() => ({ field: resolved.values[0]?.field ?? 'y', unit: frame.yUnit, scale: resolved.values[0]?.scale ?? null, format: resolved.values[0]?.format ?? null }));
    return {
      series, x: { field: resolved.x.field, unit: resolved.x.unit, format: resolved.x.format as never, ...x },
      locale, messages, onFormatterError,
    };
  }

  function formattersKey(a: Accepted, spec: FormatSpec): unknown[] {
    return [spec.locale, spec.x.kind, spec.x.timeZone, spec.x.dateUnit, spec.x.categories, spec.x.format, spec.x.unit,
      spec.messages.noData, spec.messages.noObservation, timeZone,
      spec.series.map(s => `${s.field}\u0001${s.unit}\u0001${s.scale}`).join('\u0002'), ...spec.series.map(s => s.format), a.resolved.values.length];
  }

  function measure(): { width: number; height: number } {
    const box = figure.plot.getBoundingClientRect();
    return { width: box.width, height: box.height };
  }

  function flush(): void {
    if (frameRequest !== 0) {
      win!.cancelAnimationFrame(frameRequest);
      frameRequest = 0;
    }
    const a = accepted;
    if (destroyed || !a) return;
    try {
      stage('frame');
      if (textStyleDirty) {
        const next = readTextStyle(textLayer.element);
        if (!sameTextStyle(textStyle, next)) textStyle = next;
        textStyleDirty = false;
      }
      const style = textStyle!;
      const view = a.view;
      const compact = isCompact(kind, a.options);
      const locale = resolveLocale(a.options.locale, doc);
      const shown = display(a);

      // Theme: resolved when the page may have changed, or the series or their colors did.
      const keys = seriesKeys(view);
      const nextThemeKey = [keys.join('\u0000'), a.options.colors];
      if (themeDirty || !theme || !sameKey(themeKey, nextThemeKey)) {
        stage('theme');
        const resolution = resolveTheme(root, keys, object(a.options.colors) as Record<string, string>);
        theme = resolution;
        themeKey = nextThemeKey;
        // A detached chart gets the light defaults; it resolves again in the next frame that draws.
        themeDirty = resolution.resolved === false;
        themeRevision++;
        // When the backdrop could not be determined the background is a guess, so contrast is not judged.
        const low = resolution.backdropKnown === false ? [] : lowContrastSeries(theme.theme).filter(i => i < keys.length);
        if (low.length) addPresentation('AX141', undefined, { count: low.length });
        else clearPresentation('AX141');
      }

      // Formatters.
      const spec = formatSpec(a);
      const fKey = formattersKey(a, spec);
      let formatters = drawn?.formatters;
      if (!formatters || !drawn || !sameKey(drawn.formattersKey, fKey)) {
        stage('formatters');
        formatters = createFormatters(spec, { locale, timeZone });
      }

      // Reader model and caption first: the caption's height decides what is left for the plot, so it is
      // final before the plot is measured. Hidden labels are only known after layout; if their count
      // changes, the reader model is built again below.
      const all = [...a.optionDiagnostics, ...a.dataDiagnostics, ...a.viewDiagnostics, ...presentation.values()];
      const disclosure = readerDisclosure(all);
      const hiddenIn = (l: Layout | undefined) => l?.kind === 'plot' ? l.fit.x.hidden + l.fit.y.hidden : 0;
      const readerFor = (labelsHidden: number): { reader: ReaderModel; inputs: readonly unknown[] } => {
        const inputs = [view, formatters, a.messages, a.options.title, a.options.labelledBy, a.options.subtitle,
          a.options.description, disclosure.omitted, disclosure.changed, labelsHidden, a.options.table, compact, locale];
        if (drawn && sameKey(drawn.readerInputs, inputs)) return { reader: drawn.reader, inputs: drawn.readerInputs };
        stage('reader');
        const title = a.options.title;
        const reader = buildReader({
          view, formatters: formatters!, messages: a.messages, type: a.messages[KIND_MESSAGES[kind]] || KIND_NAMES[kind],
          title: typeof title === 'string' || (title && typeof title === 'object') ? title as string | Title : undefined,
          labelledBy: stringOption(a.options, 'labelledBy') ?? undefined,
          subtitle: stringOption(a.options, 'subtitle') ?? undefined,
          description: stringOption(a.options, 'description') ?? undefined,
          disclosure, labelsHidden, table: a.options.table !== false, compact, locale,
        });
        return { reader, inputs };
      };
      const modelFor = (reader: ReaderModel, tooSmall: boolean): FigureModel => ({
        compact, title: titleOf(a.options), labelledBy: stringOption(a.options, 'labelledBy'), name: reader.name || a.name,
        subtitle: stringOption(a.options, 'subtitle'), summary: reader.summary,
        summaryVisible: tooSmall, note: shown.kind === 'ready' ? reader.note : null,
        message: shown.kind === 'ready' ? null : shown.text,
      });
      let { reader, inputs: readerInputs } = readerFor(hiddenIn(drawn?.layout));
      stage('figure');
      figure.update(modelFor(reader, drawn?.layout.kind === 'too-small'));
      size ??= measure();

      // Layout.
      const axisContext: AxisContext = {
        resolved: a.resolved, locale, compact,
        onFormatterError: field => addPresentation('AX160', field, { field }, 'changed'),
      };
      let layout: Layout;
      let lKey: readonly unknown[] | null = null;
      if (size.width <= 0 || size.height <= 0) {
        layout = { kind: 'unmeasured', width: size.width, height: size.height };
      } else if (shown.kind !== 'ready') {
        layout = { kind: 'unmeasured', width: size.width, height: size.height };
        lKey = ['message', size.width, size.height];
      } else {
        lKey = layoutKey(view, size, style, fontEpoch, axisContext);
        if (drawn && drawn.layoutKey && sameKey(drawn.layoutKey, lKey) && drawn.layout.kind !== 'unmeasured') {
          layout = drawn.layout;
        } else {
          stage('layout');
          layout = computeLayout(layoutInput(view, size, { measurer, style }, axisContext));
          if (layout.kind === 'too-small') addPresentation('AX142', undefined, {});
          else clearPresentation('AX142');
          const hidden = hiddenIn(layout);
          if (hidden > 0) addPresentation('AX143', a.resolved.x.field, { field: a.resolved.x.field, count: hidden });
          else clearPresentation('AX143');
          if (view.kind === 'bar' && layout.kind === 'plot') {
            const along = view.horizontal ? layout.plot.height : layout.plot.width;
            const bars = view.visibleSlots.end - view.visibleSlots.start;
            if (bars > along) addPresentation('AX132', a.resolved.x.field, { field: a.resolved.x.field });
            else clearPresentation('AX132');
          }
        }
      }
      const measured = layout.kind !== 'unmeasured' || (shown.kind !== 'ready' && size.width > 0 && size.height > 0);
      if (hiddenIn(layout) !== hiddenIn(drawn?.layout)) ({ reader, inputs: readerInputs } = readerFor(hiddenIn(layout)));

      // Scene.
      const sceneInputs = [view, layout, pixelRatio];
      let scene = drawn?.scene;
      if (!scene || !drawn || !sameKey(drawn.sceneInputs, sceneInputs)) {
        stage('scene');
        scene = buildScene(view, layout, pixelRatio);
      }

      // Lookup reads the frame through the view; it switches with the marks.
      const lookupInputs = [view, layout, formatters, a.messages, locale];
      let lookup = drawn?.lookup;
      if (!lookup || !drawn || !sameKey(drawn.lookupInputs, lookupInputs)) {
        stage('lookup');
        lookup = buildLookup(view, layout, formatters, a.messages, locale);
      }

      // Marks: drawn again for a new scene, a new theme or a new pixel ratio, never rebuilt for a theme alone.
      const paintInputs = [scene, themeRevision, pixelRatio];
      if (measured && (!drawn || !sameKey(drawn.paintInputs, paintInputs))) {
        stage('draw');
        renderer.draw(scene, theme!.bindings, theme!.theme, pixelRatio);
      }
      const texts = layout.kind === 'plot' ? layout.texts : [];
      if (!drawn || drawn.layout !== layout || (drawn.layout.kind === 'plot') !== (layout.kind === 'plot')) {
        stage('text');
        textLayer.render(texts);
      }

      figure.update(modelFor(reader, layout.kind === 'too-small'));

      // A change of state is said once, politely (spec L7). The first state is not announced: it is what
      // the page shows on load, and 24 charts saying "Loading" at once is noise.
      const previousState = drawn?.announced ?? null;
      if (previousState !== null && previousState !== shown.kind) {
        figure.announce(shown.kind === 'ready' ? readyText(a, reader) : shown.text);
      }

      drawn = {
        accepted: a, display: shown, formatters, formattersKey: fKey, layout, layoutKey: lKey, scene, sceneInputs,
        lookup, lookupInputs, reader, readerInputs, paintInputs, announced: measured || previousState !== null ? shown.kind : null,
        drawnRevision: measured ? a.revision : drawn?.drawnRevision ?? 0,
      };
      deliverChanges();
      if (measured) {
        refreshTooltip();
        settle(a.revision);
      }
    } catch (error) {
      failSafe(error);
    }
  }

  function readyText(a: Accepted, reader: ReaderModel): string {
    if (reader.name) return reader.name;
    const by = stringOption(a.options, 'labelledBy');
    return (by ? doc.getElementById(by)?.textContent?.trim() : null) || a.name;
  }

  /** An exception in our own pipeline: show the internal-error state and say why, never a blank box. */
  function failSafe(error: unknown): void {
    const first = internalError === null;
    internalError = error;
    if (first) delivery.internal(accepted?.name ?? id, error);
    try {
      textLayer.render([]);
      tooltip.hide();
      const m = accepted?.messages ?? resolveMessages(null);
      figure.update({
        compact: accepted ? isCompact(kind, accepted.options) : false, title: accepted ? titleOf(accepted.options) : null,
        labelledBy: accepted ? stringOption(accepted.options, 'labelledBy') : null, name: accepted?.name ?? id,
        subtitle: null, summary: m.internalError, summaryVisible: false, note: null, message: m.internalError,
      });
      if (drawn && drawn.announced !== 'internal') figure.announce(m.internalError);
      if (size && size.width > 0 && size.height > 0 && theme) {
        renderer.draw({ width: size.width, height: size.height, clip: { x: 0, y: 0, width: size.width, height: size.height }, marks: [] }, theme.bindings, theme.theme, pixelRatio);
      }
      if (drawn) drawn = { ...drawn, announced: 'internal', paintInputs: [] };
    } catch {
      // Nothing more can be shown safely.
    }
    if (accepted) settle(accepted.revision);
  }

  function settle(revision: number): void {
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i]!.revision <= revision) waiters.splice(i, 1)[0]!.resolve();
    }
  }

  // ── pointer and tooltip ────────────────────────────────────────────────────────────────────────

  let pointer: { x: number; y: number } | null = null;
  let active: PickTarget | null = null;

  function present(): void {
    const d = drawn;
    if (!d || !pointer || d.display.kind !== 'ready' || isCompact(kind, d.accepted.options) || d.accepted.options.tooltip === false) {
      if (active !== null) emit('hover', null);
      active = null;
      tooltip.hide();
      return;
    }
    const target = d.lookup.pick(pointer.x, pointer.y);
    if (target === null) {
      if (active !== null) emit('hover', null);
      active = null;
      tooltip.hide();
      return;
    }
    const changed = !sameTarget(active, target);
    active = target;
    const model = d.lookup.tooltip(target);
    if (model.rows.length === 0) {
      tooltip.hide();
      return;
    }
    const box = figure.plot.getBoundingClientRect();
    const outer = figure.figure.getBoundingClientRect();
    tooltip.show(model, pointer.x + box.left - outer.left, pointer.y + box.top - outer.top,
      count => fill(d.accepted.messages.moreRows, { count }));
    if (changed) emit('hover', pointOf(d, target));
  }

  function refreshTooltip(): void {
    if (pointer) present();
  }

  function pointOf(d: Drawn, target: PickTarget): Point<unknown> | null {
    const ref = d.lookup.primary(target);
    if (!ref) return null;
    const text = d.lookup.datum(ref);
    if (!text) return null;
    const frame = d.accepted.frame;
    let x: XValue = 0;
    let y: number | null = null;
    if (ref.kind === 'aligned' && frame.shape === 'aligned') {
      x = positionValue(frame, ref.x);
      const series = frame.series[text.seriesIndex];
      const i = indexOf(frame.x.values, ref.x);
      if (series && i >= 0 && series.slot[i] === SLOT_VALUE) y = series.y[i]!;
    } else if (ref.kind === 'point' && frame.shape === 'points') {
      x = positionValue(frame, ref.x);
      const series = frame.series[text.seriesIndex];
      if (series) {
        const rows = series.row;
        for (let i = 0; i < series.x.length; i++) {
          if ((rows ? rows[i] : i) === ref.row) { y = series.y[i]!; break; }
        }
      }
    } else if (ref.kind === 'slice' && frame.shape === 'donut') {
      x = text.seriesLabel;
      const i = frame.labels.indexOf(text.seriesLabel);
      if (i >= 0 && frame.slot[i] === SLOT_VALUE) y = frame.values[i]!;
    }
    return { series: ref.kind === 'slice' ? ref.sliceKey : ref.seriesKey, x, y, row: text.row >= 0 ? frame.source.rowAt(text.row) : null, index: text.row };
  }

  function emit<E extends keyof ChartEvents<unknown>>(event: E, payload: ChartEvents<unknown>[E] | null): void {
    const set = listeners.get(event);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        (listener as (p: unknown) => void)(payload);
      } catch (error) {
        win!.console.error('[axylo] event listener threw:', error);
      }
    }
  }

  // ── watchers ───────────────────────────────────────────────────────────────────────────────────

  const resizeObserver = new win.ResizeObserver(entries => {
    const entry = entries[entries.length - 1];
    if (!entry || destroyed) return;
    const next = { width: entry.contentRect.width, height: entry.contentRect.height };
    if (size && Math.abs(size.width - next.width) < 0.01 && Math.abs(size.height - next.height) < 0.01) return;
    size = next;
    // Drawn in the next frame: drawing here could change the figure's height (the note) inside the
    // observer's own delivery and trip its loop limit.
    schedule();
  });
  resizeObserver.observe(figure.plot);
  const stopTheme = watchTheme(root, () => {
    themeDirty = true;
    textStyleDirty = true;
    // watchTheme calls back inside an animation frame: draw now, so the repaint lands in this frame.
    flush();
  });
  const stopEnvironment = watchEnvironment(win, {
    pixelRatio() {
      pixelRatio = win.devicePixelRatio || 1;
      textStyleDirty = true;
      schedule();
    },
    motion() {
      // Nothing is animated yet (spec I5), so there is nothing to change.
    },
    fonts() {
      fontEpoch++;
      textStyleDirty = true;
      schedule();
    },
  });
  const stopPointer = watchPointer(figure.plot, {
    move(x, y) {
      pointer = { x, y };
      present();
    },
    leave() {
      pointer = null;
      present();
    },
  });

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    if (frameRequest !== 0) win!.cancelAnimationFrame(frameRequest);
    frameRequest = 0;
    resizeObserver.disconnect();
    stopTheme();
    stopEnvironment();
    stopPointer();
    tooltip.hide();
    renderer.destroy();
    textLayer.destroy();
    figure.destroy();
    if (!hadScheme) root.removeAttribute('data-axylo-scheme');
    listeners.clear();
    for (const w of waiters.splice(0)) w.resolve();
    drawn = null;
  }

  // ── create ─────────────────────────────────────────────────────────────────────────────────────

  try {
    update(input);
  } catch (error) {
    // A strict create that is rejected leaves nothing behind.
    destroy();
    throw error;
  }

  const handle: ChartHandle = {
    update: patch => update(patch),
    append: (rows, options) => append(rows, options),
    zoom: domain => zoom(domain),
    on(event, listener) {
      if (destroyed) return () => {};
      let set = listeners.get(event);
      if (!set) listeners.set(event, set = new Set());
      set.add(listener as (payload: never) => void);
      return () => { set!.delete(listener as (payload: never) => void); };
    },
    get diagnostics() {
      return currentDiagnostics();
    },
    destroy,
  };

  const bench = (globalThis as { __AXYLO_BENCH__?: unknown }).__AXYLO_BENCH__ === true;
  if (__DEV__ || bench) {
    handle.__bench = {
      get revision() {
        return accepted?.revision ?? 0;
      },
      ready() {
        const revision = accepted?.revision ?? 0;
        if (destroyed || (drawn && drawn.drawnRevision >= revision && frameRequest === 0)) return Promise.resolve();
        return new Promise<void>(resolve => waiters.push({ revision, resolve }));
      },
      describe() {
        const d = drawn;
        if (!d) return { xDomain: null, yDomain: null, series: [] };
        return describe(d.accepted.view);
      },
    };
  }
  if (__DEV__) {
    handle.__dev = {
      stages: () => ({ ...counts }),
      fail(name) {
        failing = name;
      },
      renderer: renderer.kind,
    };
  }
  return handle;
}

function indexOf(values: Float64Array, x: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return values[lo] === x ? lo : -1;
}

function hasData(view: View): boolean {
  if (view.kind === 'donut') return view.slices.some(s => s.angles !== null);
  if (view.kind === 'scatter') return view.frame.series.some((s, i) => view.visible[i] && s.x.length > 0);
  const { start, end } = view.visibleSlots;
  return view.frame.series.some((s, i) => {
    if (!view.visible[i]) return false;
    for (let j = start; j < end; j++) if (s.slot[j] === SLOT_VALUE) return true;
    return false;
  });
}

function describe(view: View): ReturnType<BenchHook['describe']> {
  if (view.kind === 'donut') {
    return { xDomain: null, yDomain: null, series: [] };
  }
  if (view.kind === 'scatter') {
    return {
      xDomain: view.xDomain, yDomain: view.yDomain,
      series: view.frame.series.map(s => ({
        key: s.key, points: s.x.length, oldestX: s.x[0] ?? NaN, newestX: s.x[s.x.length - 1] ?? NaN, missing: 0,
      })),
    };
  }
  const { frame } = view;
  return {
    xDomain: view.xDomain, yDomain: view.yDomain,
    series: frame.series.map(s => {
      let points = 0;
      let missing = 0;
      let first = -1;
      let last = -1;
      for (let i = 0; i < frame.length; i++) {
        const state = s.slot[i];
        if (state === SLOT_NO_ROW) continue;
        points++;
        if (first < 0) first = i;
        last = i;
        if (state !== SLOT_VALUE) missing++;
      }
      return {
        key: s.key, points, missing,
        oldestX: first < 0 ? NaN : frame.x.values[first]!, newestX: last < 0 ? NaN : frame.x.values[last]!,
      };
    }),
  };
}

function resolveTarget(target: unknown): HTMLElement {
  if (typeof target === 'string') {
    const doc = (globalThis as { document?: Document }).document;
    if (!doc) throw new Error(`Axylo: no document to find the target ${JSON.stringify(target)} in.`);
    let found: Element | null = null;
    try {
      found = doc.querySelector(target);
    } catch {
      throw new Error(`Axylo: the target selector ${JSON.stringify(target)} is not a valid CSS selector.`);
    }
    if (!found) throw new Error(`Axylo: the target selector ${JSON.stringify(target)} matches no element.`);
    return found as HTMLElement;
  }
  if (target !== null && typeof target === 'object' && (target as Node).nodeType === 1) return target as HTMLElement;
  throw new Error('Axylo: the target must be a CSS selector or an element.');
}

/** For scatter and donut, which have no streaming store: the rows join the data, keeping `keep` distinct x. */
function appendRows(data: unknown, rows: readonly unknown[], xField: string, keep: number | undefined): unknown[] {
  let existing: unknown[];
  if (Array.isArray(data)) existing = data;
  else {
    const columns = object(object(data).columns) as Record<string, ArrayLike<unknown>>;
    const names = Object.keys(columns);
    const length = columns[names[0] ?? '']?.length ?? 0;
    existing = Array.from({ length }, (_, i) => Object.fromEntries(names.map(n => [n, columns[n]![i]])));
  }
  const all = existing.concat(rows);
  if (keep === undefined || !Number.isFinite(keep)) return all;
  const limit = Math.max(0, Math.floor(keep));
  const seen = new Set<unknown>();
  let start = all.length;
  for (let i = all.length - 1; i >= 0; i--) {
    const raw = object(all[i])[xField];
    const key = raw instanceof Date ? raw.getTime() : raw;
    if (!seen.has(key)) {
      if (seen.size === limit) break;
      seen.add(key);
    }
    start = i;
  }
  return all.slice(start);
}
