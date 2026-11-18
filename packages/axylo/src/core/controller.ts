/**
 * The chart controller: one implementation behind `line`, `area`, `bar`, `scatter` and `donut`, written
 * against a `Host` that supplies everything the page provides (animation frames, the figure, the mark and
 * text renderers, the interaction layer, measurement, theme resolution). The browser host is built in
 * chart.ts; Node tests supply recording substitutes and a manual frame queue.
 *
 * Two phases (plan 1.5). A call (create, update, append, zoom) resolves options, normalizes or prepares
 * what changed and builds the view synchronously, so `diagnostics` is current when it returns and a `strict`
 * chart throws from it before anything is accepted: data changes are prepared in the store and committed
 * only after the candidate view validated. Everything that needs the page runs in the next animation frame,
 * from the accepted state only, and switches together: no frame mixes two revisions. A revision's rows are
 * retired only after the frame that replaced it has been drawn, so hover, tooltip, events and `Point.row`
 * always come from the displayed revision.
 *
 * Each frame stage is cached and reruns only when its inputs change (plan 2.2). In development builds the
 * handle exposes a counter per stage (`__dev.stages()`) so tests can assert what reran.
 */
import {
  SLOT_NO_ROW, SLOT_VALUE,
  type DatumRef, type DiagnosticInput, type Formatters, type Frame, type Layout, type Lookup, type MarkRenderer,
  type PlacedText, type ReaderModel, type ResolvedTheme, type PaintBindings, type Scene, type TextMeasurer,
  type TextStyle, type View,
} from './contracts';
import type { Chart, ChartEvents, Diagnostic, Messages, Point, Title, XValue } from '../public';
import {
  AlignedStore, DonutStore, normalize, PointStore, resolveOptions,
  type AlignedChartType, type ChartType, type PreparedFrame, type ResolvedOptions,
} from '../data';
import { createDiagnostic, DiagnosticCollector, readerDisclosure, type DiagnosticCode } from '../diagnostics';
import { createFormatters, type FormatSpec } from '../format';
import { buildView } from '../view';
import { computeLayout } from '../layout';
import { buildScene } from '../scene';
import { drawing } from '../scene/lines';
import { simplifyLine } from '../simplify';
import { buildLookup } from '../lookup';
import { buildReader } from '../reader';
import { resolveMessages } from '../messages';
import { lowContrastSeries, type ThemeResolution } from '../theme';
import { OptionsStore, sameValue, type OptionRecord } from './options';
import { Delivery, diagnosticKey, StrictError, strictViolations, type DeliveryConsole } from './delivery';
import { layoutInput, layoutKey, sameKey, type AxisContext } from './axes';
import { zoomApplies } from './focus';
import {
  completeViewDiagnostics, dedupe, encodingChanged, isCompact, namingDiagnostics, object, publicOptions, stringOption,
  titleOf, toPublic, viewKeyFor, viewStateFor, type Span,
} from './stages';
import type { FigureModel } from '../dom/figure';
import type { Committed, ControlsState } from '../dom/interaction';

export type ChartKind = ChartType;

const STAGES = ['options', 'normalize', 'append', 'view', 'frame', 'theme', 'formatters', 'layout', 'scene', 'lookup',
  'reader', 'draw', 'text', 'figure'] as const;
export type Stage = typeof STAGES[number];

const KIND_NAMES: Record<ChartKind, string> = { line: 'Line', area: 'Area', bar: 'Bar', scatter: 'Scatter', donut: 'Donut' };
const KIND_MESSAGES = { line: 'typeLine', area: 'typeArea', bar: 'typeBar', scatter: 'typeScatter', donut: 'typeDonut' } as const;
/** Option resolution reports these about the data; they belong to the call that set the data. */
const DATA_CODES = new Set(['AX100', 'AX101']);

/** What the benchmark harness reads (bench/README.md): readiness and what the committed frame shows. */
export interface BenchHook {
  readonly revision: number;
  ready(): Promise<void>;
  describe(): {
    xDomain: Span | null;
    yDomain: Span | null;
    series: {
      key: string; points: number; oldestX: number; newestX: number; missing: number;
      /**
       * Line charts: the caller's row indexes of the samples the simplified drawing kept, in drawing order (spec
       * F5), so drawn gaps and extremes can be checked index-exactly. Absent for other chart types.
       */
      kept?: number[];
    }[];
    /** The mark renderer drawing this chart. */
    renderer: 'canvas' | 'svg';
  };
}

export interface DevHook {
  stages(): Record<Stage, number>;
  /** Makes the named stage throw, to test the internal-error state; null stops it. */
  fail(stage: Stage | null): void;
  readonly renderer: 'canvas' | 'svg';
  /** Rows the streaming store still holds for revisions not yet retired (0 for a static chart). */
  retainedRows(): number;
}

export type ChartHandle = Chart<unknown, Record<string, unknown>> & { __bench?: BenchHook; __dev?: DevHook };

export interface Size { readonly width: number; readonly height: number }

/** Everything the controller needs from the page. */
export interface Host {
  readonly id: string;
  readonly console: DeliveryConsole | null;
  /** The page the once-per-code printing rule applies to. */
  readonly page: object;
  readonly timeZone: string;
  readonly renderer: Pick<MarkRenderer, 'kind' | 'draw'>;
  readonly text: { render(texts: readonly PlacedText[]): void };
  readonly figure: { update(model: FigureModel): boolean; announce(text: string, lang?: string | null): void };
  readonly interaction: { prepare(state: ControlsState): boolean; commit(state: Committed | null): void; clear(): void };
  readonly measurer: TextMeasurer;
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
  locale(option: unknown): string;
  pageLang(): string | null;
  /** Text of the page element with this id, or null when there is none. */
  labelText(id: string): string | null;
  textStyle(): TextStyle;
  /**
   * The plot container's size as the figure lays it out, with what the rest of the figure overflows by
   * subtracted from its height (so it can be negative); null when the figure is not laid out at all (hidden
   * or detached), which is not the same as a visible figure whose caption left no room.
   */
  measure(): Size | null;
  devicePixelRatio(): number;
  theme(seriesKeys: readonly string[], colors: Record<string, string>): ThemeResolution;
  /** Called once by destroy, after the controller released its own state. */
  dispose(): void;
}

/** What the page tells the controller (observers, watchers). */
export interface Invalidate {
  resize(): void;
  /** The chart came back into the document: anything about the page may have changed meanwhile. */
  page(): void;
  theme(): void;
  fonts(): void;
  pixelRatio(): void;
}

/** What the interaction layer may ask for; everything goes through the public paths. */
export interface ControllerActions {
  zoom(window: Span | null): void;
  toggle(seriesKey: string): void;
  pause(paused: boolean): void;
  select(ref: DatumRef): void;
  hover(ref: DatumRef | null): void;
}

export interface Controller {
  readonly handle: ChartHandle;
  readonly actions: ControllerActions;
  readonly invalidate: Invalidate;
  /** Runs the pending frame now (tests, and theme changes that arrive inside a frame). */
  flush(): void;
}

type Store = AlignedStore | PointStore | DonutStore;

/** The state a call produced. Only accepted states are drawn. */
interface Accepted {
  readonly options: OptionRecord;
  /** Options resolved for the latest call (domains, formats, labels). */
  readonly resolved: ResolvedOptions;
  /** The resolution the current data was normalized with (on the static path it holds the borrowed table). */
  readonly source: ResolvedOptions;
  /** null until the first append: a static chart keeps the normalized frame over the caller's data. */
  readonly store: Store | null;
  /** The frame shown (while paused, the store may hold a newer one). */
  readonly frame: Frame;
  readonly dataDiagnostics: readonly DiagnosticInput[];
  /** AX100 and AX101 from the call that set the data; kept while the data and fields stay. */
  readonly dataOptions: readonly DiagnosticInput[];
  readonly optionDiagnostics: readonly DiagnosticInput[];
  readonly viewDiagnostics: readonly DiagnosticInput[];
  readonly naming: readonly DiagnosticInput[];
  readonly view: View;
  readonly viewKey: readonly unknown[];
  readonly zoom: Span<XValue> | null;
  /** Zoomed to the latest edge: the window follows appended data (plan 1.5). */
  readonly follow: boolean;
  readonly revision: number;
  readonly messages: Messages;
  readonly name: string;
  /** Series the reader hid with the legend, by key (the view's hidden set). */
  readonly hidden: ReadonlySet<string>;
}

type Display =
  | { readonly kind: 'ready' }
  | {
    readonly kind: 'loading' | 'error' | 'empty' | 'internal'; readonly text: string;
    /** The built-in message shown, or null when the author wrote the text. */
    readonly message: keyof Messages | null;
  };

/** Presentation diagnostics by the stage that found them (spec 3.5: reported when found, never thrown). */
type PresentationStage = 'theme' | 'layout' | 'fit' | 'format' | 'naming' | 'internal';

/** An x position as the value the author would write, so a zoom window can be moved by positions. */
export function positionValue(frame: Frame, position: number): XValue {
  if (frame.shape === 'donut') return position;
  const kind = frame.shape === 'points' ? frame.xKind : frame.x.kind;
  if (kind === 'time') return new Date(position);
  if (kind === 'wall') return new Date(position).toISOString().slice(0, 23);
  if (kind === 'category' && frame.shape === 'aligned') return frame.x.categories?.[position] ?? position;
  return position;
}

function latestX(frame: Frame): number {
  if (frame.shape === 'aligned') return frame.x.values.length ? frame.x.values[frame.x.values.length - 1]! : NaN;
  if (frame.shape === 'points') {
    let latest = -Infinity;
    for (const s of frame.series) if (s.x.length) latest = Math.max(latest, s.x[s.x.length - 1]!);
    return latest;
  }
  return NaN;
}

/** A window that ends at the latest x and does not show everything follows the data (plan 1.5). */
function followsLatest(view: View, zoom: Span<XValue> | null): boolean {
  if (zoom === null || view.kind === 'donut') return false;
  return view.xDomain[1] >= view.xFull[1] && view.xDomain[0] > view.xFull[0];
}

/** What a destroyed controller holds instead of its host, so a handle kept by the page retains no DOM. */
function deadHost(from: Host): Host {
  const none = (): null => null;
  const empty = { width: 0, height: 0 };
  return {
    id: from.id, console: null, page: {}, timeZone: from.timeZone,
    renderer: { kind: from.renderer.kind, draw() {} }, text: { render() {} },
    figure: { update: () => false, announce() {} }, interaction: { prepare: () => false, commit() {}, clear() {} },
    measurer: { width: () => 0 }, requestFrame: () => 0, cancelFrame() {}, locale: () => 'en', pageLang: none,
    labelText: none, textStyle: () => ({ font: '', letterSpacing: 0, wordSpacing: 0, lineHeight: 0 }), measure: () => empty,
    devicePixelRatio: () => 1,
    theme: () => { throw new Error('Axylo: the chart was destroyed.'); },
    dispose() {},
  };
}

export function createController(kind: ChartKind, input: unknown, page: Host): Controller {
  let host = page;
  const counts = Object.fromEntries(STAGES.map(s => [s, 0])) as Record<Stage, number>;
  let failing: Stage | null = null;
  const stage = (name: Stage): void => {
    counts[name]++;
    if (failing === name) throw new Error(`Axylo test hook: forced failure in the ${name} stage.`);
  };
  let delivery = new Delivery({ console: host.console, development: __DEV__, page: host.page });
  const timeZone = host.timeZone;
  const environment = { timeZone };

  // ── synchronous phase ──────────────────────────────────────────────────────────────────────────

  let options = new OptionsStore(input);
  let accepted: Accepted | null = null;
  const presentation = new Map<PresentationStage, readonly DiagnosticInput[]>();
  /** Keys of the current diagnostics already printed and handed to `onDiagnostic`. */
  let deliveredKeys = new Set<string>();
  /** Increases with every delivery pass; a pass started inside author code supersedes the outer one. */
  let deliveryPass = 0;
  let destroyed = false;
  let internalError: unknown = null;
  /** `append` was called at least once: the pause control is offered (spec I6). */
  let streaming = false;
  let paused = false;
  /** While paused: the store's newest frame and its findings, accepted but not shown. */
  let held: { frame: Frame; dataDiagnostics: readonly DiagnosticInput[] } | null = null;
  /**
   * While paused: the caller's rows of the frame on screen, kept here so the store can retire every revision
   * older than its newest as rows arrive; `keep` then bounds what a paused stream holds (review 2, finding 5).
   */
  let frozen: { frame: Frame; rows: Map<number, unknown> } | null = null;
  let epochs = 0;
  let frameRevision = 0;
  let commits = 0;
  let listeners = new Map<keyof ChartEvents<unknown>, Set<(payload: never) => void>>();
  /** True while a frame runs: findings are delivered at its end, not from inside a stage. */
  let inFrame = false;

  function chartName(o: OptionRecord): string {
    return titleOf(o)?.text ?? host.id;
  }

  function presentationList(): DiagnosticInput[] {
    const out: DiagnosticInput[] = [];
    for (const list of presentation.values()) out.push(...list);
    return out;
  }

  function stateDiagnostics(a: Accepted): DiagnosticInput[] {
    return [...a.optionDiagnostics, ...a.dataDiagnostics, ...a.viewDiagnostics, ...a.naming];
  }

  function currentDiagnostics(): Diagnostic[] {
    if (!accepted) return [];
    return toPublic([...stateDiagnostics(accepted), ...presentationList()], accepted.name);
  }

  /** Replaces what a presentation stage found; outside a frame the change is delivered at once. */
  function setPresentation(where: PresentationStage, list: readonly DiagnosticInput[]): void {
    const before = presentation.get(where) ?? [];
    if (before.length === 0 && list.length === 0) return;
    if (before.length === list.length && before.every((d, i) => diagnosticKey(d) === diagnosticKey(list[i]!))) return;
    if (list.length) presentation.set(where, list);
    else presentation.delete(where);
    if (!inFrame && !destroyed) {
      deliverChanges();
      // The reader's note may change with it (spec F12).
      schedule();
    }
  }

  function addPresentation(where: PresentationStage, d: DiagnosticInput): void {
    const list = presentation.get(where) ?? [];
    if (list.some(o => o.code === d.code && o.field === d.field)) return;
    setPresentation(where, [...list, d]);
  }

  function formatterFailed(field: string): void {
    addPresentation('format', createDiagnostic('AX160', 'changed', { field }, 'presentation'));
  }

  function alive(pass: number): boolean {
    return !destroyed && pass === deliveryPass;
  }

  /**
   * Prints and hands to `onDiagnostic` what is new. Each finding is marked delivered before the author's
   * handler runs, so a handler that calls `update` cannot be given it twice; a handler that destroys the
   * chart or starts a newer pass ends this one.
   */
  function deliverChanges(): void {
    if (destroyed) return;
    const pass = ++deliveryPass;
    const now = currentDiagnostics();
    const keys = new Set(now.map(diagnosticKey));
    for (const k of [...deliveredKeys]) if (!keys.has(k)) deliveredKeys.delete(k);
    const handler = accepted?.options.onDiagnostic;
    for (const d of now) {
      if (!alive(pass)) return;
      const key = diagnosticKey(d);
      if (deliveredKeys.has(key)) continue;
      deliveredKeys.add(key);
      delivery.print(d);
      if (typeof handler === 'function') delivery.notify(handler as (d: Diagnostic) => void, d);
    }
  }

  /** A rejected or ignored call's findings: printed and given to `onDiagnostic`, never part of `diagnostics`. */
  function deliverRejected(found: readonly DiagnosticInput[], name: string, handler: unknown): void {
    const pass = ++deliveryPass;
    for (const d of toPublic(found, name)) {
      if (!alive(pass)) return;
      if (deliveredKeys.has(diagnosticKey(d))) continue;
      delivery.print(d);
      if (typeof handler === 'function') delivery.notify(handler as (d: Diagnostic) => void, d);
    }
  }

  interface Candidate {
    readonly options: OptionRecord;
    readonly resolved: ResolvedOptions;
    readonly source: ResolvedOptions;
    readonly store: Store | null;
    readonly frame: Frame;
    readonly dataDiagnostics: readonly DiagnosticInput[];
    readonly dataOptions: readonly DiagnosticInput[];
    readonly optionDiagnostics: readonly DiagnosticInput[];
    readonly zoom: Span<XValue> | null;
    readonly hidden: ReadonlySet<string>;
    readonly messages: Messages;
  }

  interface Viewed {
    readonly view: View;
    readonly viewKey: readonly unknown[];
    readonly viewDiagnostics: readonly DiagnosticInput[];
    /** What this build found that the previous view did not have. */
    readonly found: readonly DiagnosticInput[];
  }

  function viewFor(c: Candidate, previous: Accepted | null): Viewed {
    const key = viewKeyFor(kind, c.options, c.resolved, c.frame, c.zoom, c.hidden, c.messages);
    if (previous && sameValue(previous.viewKey, key)) {
      return { view: previous.view, viewKey: previous.viewKey, viewDiagnostics: previous.viewDiagnostics, found: [] };
    }
    stage('view');
    const sink = new DiagnosticCollector();
    const state = viewStateFor(kind, c.options, c.resolved, c.zoom, previous?.view ?? null, c.hidden, c.messages);
    const view = buildView(c.frame as never, state as never, sink) as View;
    const found = sink.inputs();
    const before = previous?.viewDiagnostics ?? [];
    const viewDiagnostics = completeViewDiagnostics(kind, found, before, view, state);
    const known = new Set(before.map(diagnosticKey));
    return { view, viewKey: key, viewDiagnostics, found: found.filter(d => !known.has(diagnosticKey(d))) };
  }

  function messagesFor(next: OptionRecord, previous: Accepted | null): Messages {
    return previous && sameValue(previous.options.messages, next.messages) ? previous.messages : resolveMessages(object(next.messages));
  }

  /**
   * Accepts a validated candidate: the store commits first (so the frame on screen and the store agree),
   * then the options, then the state. Nothing before this changes the chart.
   */
  function accept(c: Candidate, viewed: Viewed, follow: boolean, commit: (() => void) | null): void {
    commit?.();
    options.commit(c.options);
    if (frozen && frozen.frame !== c.frame) frozen = null;
    frameRevision = Math.max(frameRevision, c.frame.revision);
    accepted = {
      options: c.options, resolved: c.resolved, source: c.source, store: c.store, frame: c.frame,
      dataDiagnostics: c.dataDiagnostics, dataOptions: c.dataOptions, optionDiagnostics: c.optionDiagnostics,
      viewDiagnostics: viewed.viewDiagnostics, naming: namingDiagnostics(c.options), view: viewed.view,
      viewKey: viewed.viewKey, zoom: c.zoom, follow, revision: ++commits, messages: c.messages,
      name: chartName(c.options), hidden: c.hidden,
    };
    if (internalError !== null) {
      internalError = null;
      setPresentationQuiet('internal', []);
    }
    deliverChanges();
    schedule();
  }

  function setPresentationQuiet(where: PresentationStage, list: readonly DiagnosticInput[]): void {
    if (list.length) presentation.set(where, list);
    else presentation.delete(where);
  }

  /** A strict chart rejects a create, update or append whose own findings include an error or warning. */
  function rejectIfStrict(strict: boolean, found: readonly DiagnosticInput[], name: string, handler: unknown): void {
    if (!strict || strictViolations(found).length === 0) return;
    deliverRejected(found, name, handler);
    throw new StrictError(name, toPublic(found, name));
  }

  /** Runs a call. A strict rejection propagates; anything else that throws becomes the internal-error state. */
  function guarded(run: () => void): void {
    if (destroyed) return;
    try {
      run();
    } catch (error) {
      if (error instanceof StrictError) throw error;
      raiseInternal(error);
      // A create that failed has nothing to draw from: show the error state now (never a blank box).
      if (accepted === null) showInternal(resolveMessages(object(options.current.messages)), chartName(options.current), options.current);
      schedule();
    }
  }

  function nextVersion(): { epoch: number; revision: number } {
    return { epoch: ++epochs, revision: ++frameRevision };
  }

  function update(patch: unknown): void {
    guarded(() => {
      stage('options');
      const { next, changed } = options.preview(patch);
      const previous = accepted;
      const supplied = patch !== null && typeof patch === 'object' && Object.hasOwn(patch, 'data');
      const optionSink = new DiagnosticCollector();
      const messages = messagesFor(next, previous);
      let c: Candidate;
      let commit: (() => void) | null = null;
      const replace = previous === null || changed.has('data') || (supplied && previous.store !== null);
      const reencode = !replace && encodingChanged(previous!.options, next);
      if (replace || (reencode && previous!.store === null)) {
        // New data, or new fields over the caller's own data: normalized from the options, borrowing typed
        // columns (plan 1.2). A stream this replaces is dropped with everything it held.
        stage('normalize');
        const resolved = resolveOptions(kind, publicOptions(next), optionSink);
        const dataSink = new DiagnosticCollector();
        const frame = normalize(kind, resolved, environment, dataSink, nextVersion());
        const data = dataSink.inputs();
        const opts = optionSink.inputs();
        c = {
          options: next, resolved, source: resolved, store: null, frame, dataDiagnostics: data,
          dataOptions: opts.filter(d => DATA_CODES.has(d.code)), optionDiagnostics: dedupe(opts, data),
          zoom: previous?.zoom ?? null, hidden: previous?.hidden ?? new Set(), messages,
        };
      } else if (reencode) {
        // New fields after streaming: the retained rows are read again (a new epoch, plan 1.5).
        stage('normalize');
        const store = previous!.store!;
        const resolved = store.resolveEncoding(publicOptions(next), optionSink);
        const prepared: PreparedFrame<Frame> = store.prepareReencode(resolved, nextVersion());
        commit = prepared.commit;
        const opts = optionSink.inputs();
        c = {
          options: next, resolved, source: resolved, store, frame: prepared.frame, dataDiagnostics: prepared.diagnostics,
          dataOptions: [], optionDiagnostics: dedupe(opts, prepared.diagnostics),
          zoom: previous!.zoom, hidden: previous!.hidden, messages,
        };
      } else {
        // Presentation only (title, domains, references, colors, …): the frame stays.
        const p = previous!;
        const resolved = p.store
          ? p.store.resolveEncoding(publicOptions(next), optionSink)
          : resolveOptions(kind, publicOptions(next), optionSink, p.source.table);
        const opts = optionSink.inputs().filter(d => !DATA_CODES.has(d.code));
        c = {
          options: next, resolved, source: p.source, store: p.store, frame: p.frame, dataDiagnostics: p.dataDiagnostics,
          dataOptions: p.dataOptions, optionDiagnostics: dedupe([...p.dataOptions, ...opts], p.dataDiagnostics),
          zoom: p.zoom, hidden: p.hidden, messages,
        };
      }
      const viewed = viewFor(c, previous);
      const found = [...c.optionDiagnostics, ...c.dataDiagnostics, ...viewed.viewDiagnostics, ...namingDiagnostics(next)];
      rejectIfStrict(next.strict === true, found, chartName(next), next.onDiagnostic);
      // Data replaced or bounds changed: a window that no longer ends at the latest x stops following.
      const follow = followsLatest(viewed.view, c.zoom);
      if (c.frame !== previous?.frame) held = null;
      accept(c, viewed, follow, commit);
    });
  }

  function openStore(a: Accepted): Store {
    const version = { epoch: a.frame.epoch, revision: a.frame.revision };
    if (a.frame.shape === 'aligned') {
      return AlignedStore.fromFrame(a.frame, a.source, a.options.data, environment, kind as AlignedChartType);
    }
    return a.frame.shape === 'points' ? new PointStore(a.source, environment, version) : new DonutStore(a.source, environment, version);
  }

  function append(rows: unknown, appendOptions?: { keep?: number }): void {
    guarded(() => {
      const previous = accepted;
      if (!previous) return;
      if (!streaming) {
        streaming = true;
        // The pause control appears (spec I6).
        schedule();
      }
      if (!Array.isArray(rows) || rows.length === 0) return;
      stage('append');
      const keep = appendOptions?.keep;
      const store = previous.store ?? openStore(previous);
      const prepared = (store.prepareAppend as (r: readonly unknown[], o: { keep?: number }) => PreparedFrame<Frame>)(
        rows, keep === undefined ? {} : { keep });
      // While paused the view does not move (spec I6), but the rows are validated now, with the window shown.
      const base = held ? { ...previous, frame: held.frame } : previous;
      let zoom = previous.zoom;
      if (!paused && previous.follow && zoom) zoom = followLatest(prepared.frame, previous.view) ?? zoom;
      const c: Candidate = {
        options: previous.options, resolved: previous.resolved, source: previous.source, store, frame: prepared.frame,
        dataDiagnostics: prepared.diagnostics, dataOptions: previous.dataOptions,
        optionDiagnostics: previous.optionDiagnostics, zoom, hidden: previous.hidden, messages: previous.messages,
      };
      const viewed = viewFor(c, base);
      const found = [...prepared.callDiagnostics, ...viewed.found];
      rejectIfStrict(previous.options.strict === true, found, previous.name, previous.options.onDiagnostic);
      if (paused) {
        if (!frozen || frozen.frame !== previous.frame) frozen = freeze(previous.frame);
        prepared.commit();
        store.retire(prepared.frame.revision - 1);
        frameRevision = Math.max(frameRevision, prepared.frame.revision);
        held = { frame: prepared.frame, dataDiagnostics: prepared.diagnostics };
        accepted = { ...previous, store, dataDiagnostics: prepared.diagnostics };
        deliverChanges();
        return;
      }
      accept(c, viewed, previous.follow && zoom !== null, prepared.commit);
    });
  }

  /** The caller's rows every slot of `frame` refers to, read once, so the frame stays addressable on its own. */
  function freeze(frame: Frame): { frame: Frame; rows: Map<number, unknown> } {
    const rows = new Map<number, unknown>();
    const keep = (row: number) => { if (row >= 0 && !rows.has(row)) rows.set(row, frame.source.rowAt(row)); };
    const each = (index: Int32Array | null, length: number) => {
      for (let i = 0; i < length; i++) keep(index ? index[i]! : i);
    };
    if (frame.shape === 'aligned') for (const s of frame.series) each(s.row, frame.length);
    else if (frame.shape === 'points') for (const s of frame.series) each(s.row, s.x.length);
    else each(frame.row, frame.labels.length);
    return { frame, rows };
  }

  /** The window moved to end at the new latest x, keeping its width; null when it cannot follow. */
  function followLatest(frame: Frame, before: View): Span<XValue> | null {
    if (before.kind === 'donut' || frame.shape === 'donut') return null;
    if (frame.shape === 'aligned' && frame.x.kind === 'category') return null;
    const span = before.xDomain[1] - before.xDomain[0];
    const latest = latestX(frame);
    if (!Number.isFinite(latest) || !Number.isFinite(span)) return null;
    return [positionValue(frame, latest - span), positionValue(frame, latest)];
  }

  /** Candidate for a call that changes only the view (zoom, legend, resume): same options, same data. */
  function viewCandidate(a: Accepted, change: Partial<Pick<Candidate, 'zoom' | 'hidden' | 'frame' | 'dataDiagnostics'>>): Candidate {
    return {
      options: a.options, resolved: a.resolved, source: a.source, store: a.store, frame: a.frame,
      dataDiagnostics: a.dataDiagnostics, dataOptions: a.dataOptions, optionDiagnostics: a.optionDiagnostics,
      zoom: a.zoom, hidden: a.hidden, messages: a.messages, ...change,
    };
  }

  function zoom(domain: unknown): void {
    guarded(() => {
      const previous = accepted;
      if (!previous) return;
      const pair = Array.isArray(domain) && domain.length === 2 ? [domain[0], domain[1]] as unknown as Span<XValue> : null;
      const c = viewCandidate(previous, { zoom: pair });
      const viewed = viewFor(c, previous);
      // A window that cannot be read is reported and ignored; zoom never throws (spec 3.5).
      const bad = viewed.found.filter(d => d.field === 'zoom');
      if (bad.length) {
        deliverRejected(bad, previous.name, previous.options.onDiagnostic);
        return;
      }
      accept(c, viewed, followsLatest(viewed.view, pair), null);
      const now = accepted;
      if (destroyed || now === null) return;
      const view = now.view;
      const before = previous.view;
      if (view.kind !== 'donut' && before.kind !== 'donut' &&
        (view.xDomain[0] !== before.xDomain[0] || view.xDomain[1] !== before.xDomain[1] || (previous.zoom === null) !== (pair === null))) {
        emit('zoom', zoomPayload(now));
      }
    });
  }

  /** The window shown, as the author would write it; null when the whole range is shown. */
  function zoomPayload(a: Accepted): readonly [XValue, XValue] | null {
    const view = a.view;
    if (a.zoom === null || view.kind === 'donut') return null;
    return [positionValue(a.frame, view.xDomain[0]), positionValue(a.frame, view.xDomain[1])];
  }

  /** A legend toggle: the series joins or leaves the view's hidden set (spec I2). */
  function toggleSeries(key: string): void {
    guarded(() => {
      const previous = accepted;
      if (!previous) return;
      const hidden = new Set(previous.hidden);
      if (!hidden.delete(key)) hidden.add(key);
      const c = viewCandidate(previous, { hidden });
      accept(c, viewFor(c, previous), previous.follow, null);
    });
  }

  /** Pause and resume (spec I6). Resume shows the newest held frame. */
  function setPaused(next: boolean): void {
    if (destroyed || next === paused) return;
    paused = next;
    if (!next && held) {
      const frame = held;
      held = null;
      guarded(() => {
        const previous = accepted;
        if (!previous) return;
        let zoomed = previous.zoom;
        if (previous.follow && zoomed) zoomed = followLatest(frame.frame, previous.view) ?? zoomed;
        const c = viewCandidate(previous, { frame: frame.frame, dataDiagnostics: frame.dataDiagnostics, zoom: zoomed });
        accept(c, viewFor(c, previous), previous.follow && zoomed !== null, null);
      });
    }
    schedule();
  }

  // ── frame phase ────────────────────────────────────────────────────────────────────────────────

  let frameRequest = 0;
  let frameScheduled = false;
  let size: Size | null = null;
  let sizeDirty = true;
  /** L8 fallback: what the fallback's own DOM adds to the plot size, measured when it was entered. */
  let fallback: { width: number; height: number } | null = null;
  let textStyle: TextStyle | null = null;
  let textStyleDirty = true;
  let fontEpoch = 0;
  let pixelRatio = host.devicePixelRatio();
  let themeDirty = true;
  let themeKey: readonly unknown[] | null = null;
  let theme: { bindings: PaintBindings; theme: ResolvedTheme } | null = null;
  let themeRevision = 0;
  /** The display state last shown, for announcing changes once (spec L7). */
  let announced: Display['kind'] | null = null;
  /** The accepted revision the page last settled on (drawn, or its error shown). */
  let settledRevision = 0;
  /** The frame revision whose formatter findings the 'format' bucket holds. */
  let formatRevision = -1;

  interface Drawn {
    accepted: Accepted;
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
  }
  let drawn: Drawn | null = null;
  /** The last layout computed, also at a size that was only an estimate (the L8 fallback). */
  let lastLayout: { layout: Layout; key: readonly unknown[] } | null = null;
  let retiredFor: Frame | null = null;
  let waiters: { revision: number; resolve: () => void }[] = [];

  function schedule(): void {
    if (destroyed || frameScheduled) return;
    frameScheduled = true;
    frameRequest = host.requestFrame(() => {
      frameRequest = 0;
      frameScheduled = false;
      flush();
    });
  }

  /** Theme bindings per palette slot: series by index; donut slices by their colorIndex (DX6). */
  function themeKeys(view: View): string[] {
    if (view.kind !== 'donut') return view.frame.series.map(s => s.key);
    const keys: string[] = [];
    for (const slice of view.slices) if (slice.colorIndex !== null) keys[slice.colorIndex] = slice.label;
    for (let i = 0; i < keys.length; i++) keys[i] ??= '';
    return keys;
  }

  function display(a: Accepted): Display {
    const m = a.messages;
    if (internalError !== null) return { kind: 'internal', text: m.internalError, message: 'internalError' };
    const state = a.options.state;
    if (state === 'loading') return { kind: 'loading', text: m.loading, message: 'loading' };
    if (state && typeof state === 'object') {
      const s = state as { error?: unknown; empty?: unknown };
      if ('error' in s) {
        const own = typeof s.error === 'string' && s.error !== '';
        return { kind: 'error', text: own ? s.error as string : m.error, message: own ? null : 'error' };
      }
      if ('empty' in s) {
        const own = typeof s.empty === 'string' && s.empty !== '';
        return { kind: 'empty', text: own ? s.empty as string : m.empty, message: own ? null : 'empty' };
      }
    }
    if (stateDiagnostics(a).some(d => d.effect === 'chart-error')) return { kind: 'error', text: m.error, message: 'error' };
    // Series the reader hid are still data: the chart stays ready, so the legend can show them again.
    if (!hasData(a.view, true)) return { kind: 'empty', text: m.empty, message: 'empty' };
    return { kind: 'ready' };
  }

  /**
   * `lang` for an element showing the built-in text of `key`: 'en' when the page is in another language and
   * the author has not replaced that text (spec A10), else null.
   */
  function englishFor(a: Accepted, lang: string | null): (key: keyof Messages) => string | null {
    const foreign = lang !== null && !/^en(?:-|$)/i.test(lang);
    const overrides = object(a.options.messages);
    return key => foreign && typeof overrides[key] !== 'string' ? 'en' : null;
  }

  /** AX199 (spec 3.5): Axylo itself failed. Given to onDiagnostic and printed, beside the error state. */
  function raiseInternal(error: unknown): void {
    const first = internalError === null;
    internalError = error;
    if (first) delivery.internal(accepted?.name ?? host.id, error);
    setPresentationQuiet('internal', [createDiagnostic('AX199', 'chart-error', {}, 'presentation')]);
    if (!inFrame) deliverChanges();
  }

  function formatSpec(a: Accepted): FormatSpec {
    const { frame, resolved } = a;
    const onFormatterError = (field: string) => formatterFailed(field);
    const valueFor = (field: string) => resolved.values.find(v => v.field === field) ?? resolved.values[0];
    const locale = host.locale(a.options.locale);
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

  function formattersKey(spec: FormatSpec, valueCount: number): unknown[] {
    return [spec.locale, spec.x.kind, spec.x.timeZone, spec.x.dateUnit, spec.x.categories, spec.x.format, spec.x.unit,
      spec.messages.noData, spec.messages.noObservation, timeZone,
      spec.series.map(s => `${s.field}\u0001${s.unit}\u0001${s.scale}`).join('\u0002'), ...spec.series.map(s => s.format), valueCount];
  }

  function flush(): void {
    if (frameRequest !== 0) host.cancelFrame(frameRequest);
    frameRequest = 0;
    frameScheduled = false;
    const a = accepted;
    if (destroyed || !a) return;
    inFrame = true;
    try {
      frame(a);
    } catch (error) {
      failSafe(a, error);
    } finally {
      inFrame = false;
    }
    // Author code last: the frame is complete before any handler runs.
    deliverChanges();
  }

  /** Whether a frame may go on after author code ran (a formatter): the chart is alive and on the same state. */
  function current(a: Accepted): boolean {
    return !destroyed && accepted === a;
  }

  function frame(a: Accepted): void {
    stage('frame');
    if (textStyleDirty) {
      const next = host.textStyle();
      if (!textStyle || !sameStyle(textStyle, next)) textStyle = next;
      textStyleDirty = false;
    }
    const style = textStyle!;
    const view = a.view;
    const compact = isCompact(kind, a.options);
    const locale = host.locale(a.options.locale);
    const shown = display(a);
    const lang = host.pageLang();

    // Theme: resolved when the page may have changed, or the series or their colors did.
    const keys = themeKeys(view);
    const nextThemeKey = [keys.join('\u0000'), a.options.colors];
    if (themeDirty || !theme || !sameKey(themeKey, nextThemeKey)) {
      stage('theme');
      const resolution = host.theme(keys, object(a.options.colors) as Record<string, string>);
      theme = resolution;
      themeKey = nextThemeKey;
      // A detached chart gets the light defaults; it resolves again in the next frame that draws.
      themeDirty = resolution.resolved === false;
      themeRevision++;
      // When the backdrop could not be determined the background is a guess, so contrast is not judged.
      const low = resolution.backdropKnown === false ? [] : lowContrastSeries(resolution.theme).filter(i => i < keys.length);
      setPresentation('theme', low.length ? [createDiagnostic('AX141', 'none', { count: low.length }, 'presentation')] : []);
    }

    // Formatters. What a formatter threw on belongs to the formatters and the revision it formatted.
    const spec = formatSpec(a);
    const fKey = formattersKey(spec, a.resolved.values.length);
    let formatters = drawn?.formatters;
    if (!formatters || !drawn || !sameKey(drawn.formattersKey, fKey)) {
      stage('formatters');
      formatters = createFormatters(spec, { locale, timeZone });
      setPresentation('format', []);
    } else if (formatRevision !== view.frame.revision) {
      setPresentation('format', []);
    }
    formatRevision = view.frame.revision;

    // Naming (spec A1): a labelledBy that names nothing falls back to the title or a generated name.
    const by = stringOption(a.options, 'labelledBy');
    const byText = by ? host.labelText(by) : null;
    const named = by !== null && byText !== null;
    const title = titleOf(a.options);
    setPresentation('naming', by !== null && !named && title === null
      ? [createDiagnostic('AX140', 'none', { detail: `No element has the id "${by}".` }, 'presentation')] : []);
    const caption = named ? byText.trim() || undefined : undefined;

    const english = englishFor(a, lang);
    // The note is English only when every sentence it shows is the built-in one (spec A10).
    const noteLangFor = (labelsHidden: number, disclosure: { omitted: number; changed: number }): string | null => {
      const shownKeys = [disclosure.omitted > 0 ? 'valuesNotShown' : null, disclosure.changed > 0 ? 'valuesChanged' : null,
        labelsHidden > 0 ? 'labelsHidden' : null].filter((k): k is 'valuesNotShown' | 'valuesChanged' | 'labelsHidden' => k !== null);
      return shownKeys.length > 0 && shownKeys.every(k => english(k)) ? 'en' : null;
    };
    const hiddenIn = (l: Layout | undefined) => l?.kind === 'plot' ? l.fit.x.hidden + l.fit.y.hidden : 0;
    const disclosureNow = () => readerDisclosure([...stateDiagnostics(a), ...presentationList()]);
    let lastReader: { reader: ReaderModel; inputs: readonly unknown[] } | null = null;
    const readerFor = (labelsHidden: number, disclosure: { omitted: number; changed: number }): { reader: ReaderModel; inputs: readonly unknown[] } => {
      const inputs = [view, formatters, a.messages, a.options.title, named ? by : null, a.options.subtitle,
        a.options.description, disclosure.omitted, disclosure.changed, labelsHidden, a.options.table, compact, locale, caption];
      if (drawn && sameKey(drawn.readerInputs, inputs)) return { reader: drawn.reader, inputs: drawn.readerInputs };
      if (lastReader && sameKey(lastReader.inputs, inputs)) return lastReader;
      stage('reader');
      const t = a.options.title;
      const reader = buildReader({
        view, formatters: formatters!, messages: a.messages, type: a.messages[KIND_MESSAGES[kind]] || KIND_NAMES[kind],
        title: typeof t === 'string' || (t && typeof t === 'object') ? t as string | Title : undefined,
        labelledBy: named ? by! : undefined, caption,
        subtitle: stringOption(a.options, 'subtitle') ?? undefined,
        description: stringOption(a.options, 'description') ?? undefined,
        disclosure, labelsHidden, table: a.options.table !== false, compact, locale,
      });
      return lastReader = { reader, inputs };
    };
    /** Builds the reader; when building it found new omissions (a formatter threw), once more with them. */
    let currentHidden = 0;
    const settleReader = (labelsHidden: number) => {
      currentHidden = labelsHidden;
      let disclosure = disclosureNow();
      let built = readerFor(labelsHidden, disclosure);
      const after = disclosureNow();
      if (after.omitted !== disclosure.omitted || after.changed !== disclosure.changed) {
        disclosure = after;
        built = readerFor(labelsHidden, disclosure);
      }
      return built;
    };

    // The note stays when every value was left out (F12, C5): it explains the empty state.
    const noteShown = shown.kind === 'ready' || shown.kind === 'empty' || shown.kind === 'error';
    const modelFor = (reader: ReaderModel, tooSmall: boolean): FigureModel => {
      const message = shown.kind === 'ready' ? null : shown.text;
      // A compact chart is one image: its description says what state it is in (C1).
      const summary = compact && message !== null
        ? (shown.kind === 'empty' ? `${message} ${reader.summary}` : message) : reader.summary;
      return {
        compact, title: named ? null : title, labelledBy: named ? by : null, name: reader.name || a.name,
        subtitle: stringOption(a.options, 'subtitle'), summary,
        summaryVisible: tooSmall, note: noteShown ? reader.note : null, message,
        messageLang: message !== null && shown.kind !== 'ready' && shown.message ? english(shown.message) : null,
        noteLang: noteLangFor(currentHidden, disclosureNow()),
      };
    };
    const zoomOn = zoomApplies(view, a.options.zoom) ? (a.options.zoom === 'touch' ? 'touch' as const : true) : false;
    const zoomed = view.kind !== 'donut' && a.zoom !== null && (view.xDomain[0] > view.xFull[0] || view.xDomain[1] < view.xFull[1]);
    const legend = a.options.legend === false ? false : (['top', 'right', 'bottom'] as const).find(p => p === a.options.legend) ?? 'bottom';
    const controlsFor = (reader: ReaderModel, tooSmall: boolean): ControlsState => ({
      kind, view, formatters: formatters!, messages: a.messages, reader, tooSmall,
      ready: shown.kind === 'ready', interactive: !compact, tooltip: a.options.tooltip !== false, legend,
      inspectable: shown.kind === 'empty' && (reader.table?.rowCount ?? 0) > 0,
      zoom: zoomOn, zoomed, streaming, paused, epoch: a.frame.epoch, english, pageLang: lang,
    });

    let { reader, inputs: readerInputs } = settleReader(hiddenIn(drawn?.layout));
    if (!current(a)) return;
    // The fallback is only for a plot; a state message is shown in whatever room there is.
    if (shown.kind !== 'ready' || compact) fallback = null;
    let tooSmall = fallback !== null;
    let arranged: { reader: ReaderModel; small: boolean } | null = null;
    /** Puts the caption and the controls in place for one mode, and says whether anything moved. */
    const arrange = (small: boolean): boolean => {
      if (arranged && arranged.reader === reader && arranged.small === small) return false;
      arranged = { reader, small };
      stage('figure');
      const moved = host.figure.update(modelFor(reader, small));
      // The legend and toolbar are in place before the plot is measured: they take their share now.
      return host.interaction.prepare(controlsFor(reader, small)) || moved;
    };
    if (arrange(tooSmall) || sizeDirty || size === null) {
      size = host.measure();
      sizeDirty = false;
    }

    // Layout.
    const axisContext: AxisContext = {
      resolved: a.resolved, locale, compact,
      onFormatterError: field => addPresentation('layout', createDiagnostic('AX160', 'changed', { field }, 'presentation')),
      xLabelGiven: typeof object(a.options.x).label === 'string',
      valueTitle: a.messages.value,
    };
    let layout: Layout;
    let lKey: readonly unknown[] | null = null;
    const plotLayout = (at: Size): { layout: Layout; key: readonly unknown[] } => {
      // A visible figure that leaves the plot no room is too small (L8), not unmeasured.
      if (!compact && (at.width <= 0 || at.height <= 0)) {
        return { layout: { kind: 'too-small', width: Math.max(0, at.width), height: Math.max(0, at.height) }, key: ['too-small', at.width, at.height] };
      }
      const key = layoutKey(view, at, style, fontEpoch, axisContext);
      if (drawn && drawn.layoutKey && sameKey(drawn.layoutKey, key) && drawn.layout.kind !== 'unmeasured') return { layout: drawn.layout, key: drawn.layoutKey };
      if (lastLayout && sameKey(lastLayout.key, key)) return lastLayout;
      stage('layout');
      setPresentation('layout', []);
      const result = { layout: computeLayout(layoutInput(view, at, { measurer: host.measurer, style }, axisContext)), key };
      lastLayout = result;
      return result;
    };
    if (size === null || size.width <= 0) {
      layout = { kind: 'unmeasured', width: size?.width ?? 0, height: size?.height ?? 0 };
    } else if (shown.kind !== 'ready') {
      const h = Math.max(0, size.height);
      layout = { kind: 'unmeasured', width: size.width, height: h };
      lKey = ['message', size.width, h];
    } else {
      /*
       * Spec L8, decided on the room a normal plot gets, which the fallback cannot change: in the fallback
       * the plot's size is read back as it would be without the fallback's own DOM (`fallback` is what that
       * DOM adds, measured when it was entered). Within the frame the figure is settled first: a plot whose
       * layout hides labels gets the note under it, and is measured again with it, so the size a mode is
       * judged on is the size that mode really has. Each mode is then self-consistent, and stepping the
       * container through the boundary switches once, at the same size in both directions.
       */
      let result = plotLayout(fallback ? { width: size.width - fallback.width, height: size.height - fallback.height } : size);
      for (let pass = 0; pass < 4; pass++) {
        const small = result.layout.kind === 'too-small';
        if (small && !tooSmall) {
          const normal = size;
          tooSmall = true;
          ({ reader, inputs: readerInputs } = settleReader(0));
          arrange(true);
          size = host.measure() ?? normal;
          fallback = { width: size.width - normal.width, height: size.height - normal.height };
          break;
        }
        if (!small && tooSmall) {
          tooSmall = false;
          fallback = null;
        }
        if (tooSmall) break;
        // Normal: the note says what this layout hides; if that moves the figure, judge the new size.
        ({ reader, inputs: readerInputs } = settleReader(hiddenIn(result.layout)));
        if (!arrange(false)) break;
        const now = host.measure();
        if (now === null || (now.width === size.width && now.height === size.height)) break;
        size = now;
        result = plotLayout(size);
      }
      layout = result.layout;
      lKey = result.key;
      if (!current(a)) return;
    }

    // Findings that follow from the layout shown, recomputed every frame (cheap): L8, L1, the bar hint.
    const fit: DiagnosticInput[] = [];
    if (tooSmall || layout.kind === 'too-small') fit.push(createDiagnostic('AX142', 'none', {}, 'presentation'));
    const hidden = hiddenIn(layout);
    if (hidden > 0) fit.push(createDiagnostic('AX143', 'none', { field: a.resolved.x.field, count: hidden }, 'presentation'));
    if (view.kind === 'bar' && layout.kind === 'plot') {
      const along = view.horizontal ? layout.plot.height : layout.plot.width;
      const bars = view.visibleSlots.end - view.visibleSlots.start;
      if (bars > along) fit.push(createDiagnostic('AX132', 'none', { field: a.resolved.x.field }, 'presentation'));
    }
    setPresentation('fit', fit);
    const measured = layout.kind !== 'unmeasured' || (shown.kind !== 'ready' && size !== null && size.width > 0 && size.height > 0);
    ({ reader, inputs: readerInputs } = settleReader(hidden));
    if (!current(a)) return;

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
      host.renderer.draw(scene, theme!.bindings, theme!.theme, pixelRatio);
    }
    if (!drawn || drawn.layout !== layout || (drawn.layout.kind === 'plot') !== (layout.kind === 'plot')) {
      stage('text');
      host.text.render(layout.kind === 'plot' ? layout.texts : []);
    }

    stage('figure');
    host.figure.update(modelFor(reader, tooSmall));

    // A change of state is said once, politely (spec L7). The first state is not announced: it is what
    // the page shows on load, and 24 charts saying "Loading" at once is noise.
    if (announced !== null && announced !== shown.kind) {
      host.figure.announce(shown.kind === 'ready' ? readyText(a, reader, byText) : shown.text,
        shown.kind !== 'ready' && shown.message ? english(shown.message) : null);
    }
    if (measured || announced !== null) announced = shown.kind;

    drawn = {
      accepted: a, formatters, formattersKey: fKey, layout, layoutKey: lKey, scene, sceneInputs,
      lookup, lookupInputs, reader, readerInputs, paintInputs,
    };
    // The frame on screen is now this revision: rows only older revisions could address can go.
    retire(a);
    host.interaction.commit({
      ...controlsFor(reader, tooSmall), layout, lookup, bindings: theme!.bindings, theme: theme!.theme, pixelRatio,
    });
    if (!current(a)) return;
    if (measured) settle(a.revision);
  }

  /** Retires, in the store, every revision older than the frame now on screen. */
  function retire(a: Accepted): void {
    if (retiredFor === a.frame) return;
    retiredFor = a.frame;
    const store = a.store;
    if (store && a.frame.revision > 0) store.retire(a.frame.revision - 1);
  }

  function readyText(a: Accepted, reader: ReaderModel, byText: string | null): string {
    if (reader.name) return reader.name;
    return byText?.trim() || a.name;
  }

  /**
   * An exception in our own pipeline: a complete error revision. The interaction layer is cleared (no old
   * lookup answers the pointer), every output the error state cleared is invalidated so recovery redraws
   * it all, and readiness settles on this revision.
   */
  function failSafe(a: Accepted, error: unknown): void {
    raiseInternal(error);
    showInternal(a.messages, a.name, a.options);
    drawn = null;
    lastLayout = null;
    themeDirty = true;
    sizeDirty = true;
    settle(a.revision);
  }

  function showInternal(m: Messages, name: string, o: OptionRecord): void {
    try {
      host.text.render([]);
      host.interaction.clear();
      host.figure.update({
        compact: isCompact(kind, o), title: titleOf(o), labelledBy: null, name,
        subtitle: null, summary: m.internalError, summaryVisible: false, note: null, message: m.internalError,
      });
      if (announced !== null && announced !== 'internal') host.figure.announce(m.internalError);
      announced = 'internal';
      if (size && size.width > 0 && size.height > 0 && theme) {
        host.renderer.draw({ width: size.width, height: size.height, clip: { x: 0, y: 0, width: size.width, height: size.height }, marks: [] }, theme.bindings, theme.theme, pixelRatio);
      }
    } catch {
      // Nothing more can be shown safely.
    }
  }

  function settle(revision: number): void {
    settledRevision = Math.max(settledRevision, revision);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i]!.revision <= revision) waiters.splice(i, 1)[0]!.resolve();
    }
  }

  // ── events ─────────────────────────────────────────────────────────────────────────────────────

  /** The public description of a datum, for `hover` and `select`, from the displayed revision. */
  function pointFor(d: Drawn, ref: DatumRef): Point<unknown> | null {
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
    const rowAt = frozen && frozen.frame === frame ? (row: number) => frozen!.rows.get(row) ?? null : (row: number) => frame.source.rowAt(row);
    return { series: ref.kind === 'slice' ? ref.sliceKey : ref.seriesKey, x, y, row: text.row >= 0 ? rowAt(text.row) : null, index: text.row };
  }

  /** Calls the listeners with a snapshot taken before any runs; stops when one destroys or changes the chart. */
  function emit<E extends keyof ChartEvents<unknown>>(event: E, payload: ChartEvents<unknown>[E] | null): void {
    const set = listeners.get(event);
    if (!set || set.size === 0) return;
    const state = accepted;
    for (const listener of [...set]) {
      if (destroyed || accepted !== state) return;
      try {
        (listener as (p: unknown) => void)(payload);
      } catch (error) {
        host.console?.error('[axylo] event listener threw:', error);
      }
    }
  }

  const actions: ControllerActions = {
    zoom(window) {
      const a = accepted;
      if (!a || destroyed) return;
      zoom(window === null ? null : [positionValue(a.frame, window[0]), positionValue(a.frame, window[1])]);
    },
    toggle: key => toggleSeries(key),
    pause: next => setPaused(next),
    select(ref) {
      const d = drawn;
      const point = d && !destroyed ? pointFor(d, ref) : null;
      if (point) emit('select', point);
    },
    hover(ref) {
      const d = drawn;
      if (destroyed) return;
      emit('hover', d && ref ? pointFor(d, ref) : null);
    },
  };

  // ── watchers ───────────────────────────────────────────────────────────────────────────────────

  const invalidate: Invalidate = {
    resize() {
      if (destroyed) return;
      sizeDirty = true;
      // Responsive CSS can change the font or spacing with the size (plan 2.2).
      textStyleDirty = true;
      schedule();
    },
    page() {
      if (destroyed) return;
      themeDirty = true;
      textStyleDirty = true;
      sizeDirty = true;
      schedule();
    },
    theme() {
      if (destroyed) return;
      themeDirty = true;
      textStyleDirty = true;
      // The theme watcher calls back inside an animation frame: draw now, so the repaint lands in this frame.
      flush();
    },
    fonts() {
      if (destroyed) return;
      fontEpoch++;
      textStyleDirty = true;
      schedule();
    },
    pixelRatio() {
      if (destroyed) return;
      pixelRatio = host.devicePixelRatio();
      textStyleDirty = true;
      schedule();
    },
  };

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    if (frameRequest !== 0) host.cancelFrame(frameRequest);
    frameRequest = 0;
    const pending = waiters;
    waiters = [];
    // Nothing the handle still references keeps the data, the options or the drawing alive.
    accepted = null;
    drawn = null;
    held = null;
    lastLayout = null;
    retiredFor = null;
    frozen = null;
    theme = null;
    listeners = new Map();
    presentation.clear();
    deliveredKeys = new Set();
    options = new OptionsStore({});
    const owner = host;
    host = deadHost(owner);
    delivery = new Delivery({ console: null, development: __DEV__, page: null });
    try {
      owner.dispose();
    } finally {
      for (const w of pending) w.resolve();
    }
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
    append: (rows, appendOptions) => append(rows, appendOptions),
    zoom: domain => zoom(domain),
    on(event, listener) {
      if (destroyed) return () => {};
      let set = listeners.get(event);
      if (!set) listeners.set(event, set = new Set());
      const own = set;
      own.add(listener as (payload: never) => void);
      return () => { own.delete(listener as (payload: never) => void); };
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
        if (destroyed || (settledRevision >= revision && !frameScheduled)) return Promise.resolve();
        return new Promise<void>(resolve => waiters.push({ revision, resolve }));
      },
      describe() {
        const d = drawn;
        const renderer = host.renderer.kind;
        if (!d) return { xDomain: null, yDomain: null, series: [], renderer };
        const out = { ...describe(d.accepted.view), renderer };
        const view = d.accepted.view;
        if (view.kind === 'line' && d.layout.kind === 'plot' && d.layout.projection.kind === 'xy') {
          // The same selection the scene made (scene/index.ts): the frame's x, the plot, the pixel ratio.
          const draw = drawing(view.frame.x.values, d.layout.projection, d.layout.plot, pixelRatio > 0 ? pixelRatio : 1);
          out.series = out.series.map((s, i) => {
            const series = view.frame.series[i]!;
            if (!view.visible[i]) return { ...s, kept: [] };
            const runs = simplifyLine({ ...draw, range: view.drawSlots[i]!, slot: series.slot, y: series.y });
            return { ...s, kept: Array.from(runs.indexes, slot => series.row ? series.row[slot]! : slot) };
          });
        }
        return out;
      },
    };
  }
  if (__DEV__) {
    handle.__dev = {
      stages: () => ({ ...counts }),
      fail(name) {
        failing = name;
      },
      renderer: host.renderer.kind,
      retainedRows: () => accepted?.store?.retainedRowCount ?? 0,
    };
  }
  return { handle, actions, invalidate, flush };
}

function sameStyle(a: TextStyle, b: TextStyle): boolean {
  return a.font === b.font && a.letterSpacing === b.letterSpacing && a.wordSpacing === b.wordSpacing && a.lineHeight === b.lineHeight;
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

/**
 * Whether the view has something to draw, from what the marks use: per series its draw range (a segment
 * that crosses a zoomed window counts), per scatter series its visible points. With `hidden`, series the
 * reader hid count too.
 */
export function hasData(view: View, hidden = false): boolean {
  if (view.kind === 'donut') return view.slices.some(s => s.angles !== null);
  const shown = (i: number) => view.visible[i] || (hidden && view.frame.series[i]!.drawable);
  if (view.kind === 'scatter') {
    return view.frame.series.some((_, i) => shown(i) && view.visiblePoints[i]!.end > view.visiblePoints[i]!.start);
  }
  return view.frame.series.some((s, i) => {
    if (!shown(i)) return false;
    const { start, end } = view.drawSlots[i] ?? view.visibleSlots;
    for (let j = start; j < end; j++) if (s.slot[j] === SLOT_VALUE) return true;
    return false;
  });
}

function describe(view: View): Omit<ReturnType<BenchHook['describe']>, 'renderer'> {
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

export type { DiagnosticCode };
