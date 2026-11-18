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
  type PlacedText, type PointSeries, type ReaderModel, type ResolvedTheme, type PaintBindings, type Scene, type TextMeasurer,
  type TextStyle, type View,
} from './contracts';
import type { ChartEvents, Diagnostic, Messages, Point, Title, XValue } from '../public';
import type { PreparedFrame } from '../data';
import { resolveOptions, withoutTable, type ChartType, type ResolvedOptions } from '../data/options';
import { createDiagnostic, DiagnosticCollector, readerDisclosure, type DiagnosticCode } from '../diagnostics';
import { createFormatters, type FormatSpec } from '../format';
import { dateUnitOf } from '../data/x';
import { rowsTable, type Table } from '../data/table';
import { computeLayout } from '../layout';
import { readerWith, seriesNotDrawnSentence } from '../reader';
import { fill, resolveMessages } from '../messages';
import { lowContrastSeries, type ThemeResolution } from '../theme';
import { OptionsStore, sameValue, type OptionRecord } from './options';
import { Delivery, diagnosticKey, StrictError, strictViolations, type DeliveryConsole } from './delivery';
import { layoutInput, layoutKey, sameKey, tickFormatFailures, type AxisContext } from './axes';
import { zoomApplies } from './focus';
import { lowerBound, upperBound } from '../lookup/search';
import {
  completeViewDiagnostics, dedupe, encodingChanged, isCompact, namesOnlyChanged, namingDiagnostics, object, publicOptions, stringOption,
  titleOf, toPublic, viewKeyFor, viewStateFor, type Span,
} from './stages';
import type { FigureModel } from '../dom/figure';
import type { Committed, ControlsState } from '../dom/interaction';
import type { Composition, Store } from './composition';
import { attachHooks, StageCounter, type ChartHandle, type Stage } from './instrument';
import { COMPOSITIONS } from '../kinds';

export type ChartKind = ChartType;

/** Thrown inside a frame to stop it before anything was written (see `frame`). */
const ABORT = Symbol('axylo frame superseded');

export type { BenchHook, ChartHandle, DevHook, Stage } from './instrument';

const KIND_NAMES: Record<ChartKind, string> = { line: 'Line', area: 'Area', bar: 'Bar', scatter: 'Scatter', donut: 'Donut' };
const KIND_MESSAGES = { line: 'typeLine', area: 'typeArea', bar: 'typeBar', scatter: 'typeScatter', donut: 'typeDonut' } as const;
/** Option resolution reports these about the data; they belong to the call that set the data. */
const DATA_CODES = new Set(['AX100', 'AX101']);
/** Rows a store may hold beyond twice what was on screen before the frames that pin it copy their rows. */
const RETENTION_SLACK = 8;
/**
 * Positions of the reader's inputs the summary does not read: the title, the labelledBy id and the caption
 * name the chart, and the count of hidden labels is said by the note only (reader/index.ts).
 */
const NAMING_INPUTS = new Set([3, 4, 9, 13]);

export interface Size {
  readonly width: number;
  readonly height: number;
  /**
   * The plot's column (the plot and, in readout mode, the strip under it): the same in both modes, so the
   * mode decided from it does not flip with its own strip. Absent: the plot's size.
   */
  readonly room?: { readonly width: number; readonly height: number };
}

/** Decision 0004 revision 2, rule 5: a plot narrower or shorter than this is in readout mode. */
const READOUT_WIDTH = 240;
const READOUT_HEIGHT = 140;
/** Where a pointed datum's values go: a floating tooltip, the reserved strip, or nowhere (rule 5). */
type ReadoutMode = 'floating' | 'strip' | 'none';
/** Spec L8: the smallest plot height drawn. */
const MIN_PLOT_HEIGHT = 80;

/** Everything the controller needs from the page. */
export interface Host {
  /** Allocated, for the DOM relationships (aria-describedby, the table's id). */
  readonly id: string;
  /** The target element's own `id`, when it has one: an untitled chart is named by it in diagnostics. */
  readonly targetId?: string | null;
  readonly console: DeliveryConsole | null;
  /** The page the once-per-code printing rule applies to. */
  readonly page: object;
  readonly timeZone: string;
  readonly renderer: Pick<MarkRenderer, 'kind' | 'draw'>;
  readonly text: { render(texts: readonly PlacedText[]): void };
  readonly figure: { update(model: FigureModel): boolean; announce(text: string, lang?: string | null): void };
  readonly interaction: { prepare(state: ControlsState): boolean; commit(state: Committed | null): void; clear(): void };
  readonly measurer: TextMeasurer;
  /** The callback gets the animation frame's time when the host has one. */
  requestFrame(callback: (time?: number) => void): number;
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
  /**
   * The readout strip's height as it would be reserved: two line heights of the strip's own text, measured
   * in the page (decision 0004 rule 5). Absent: estimated from the chart's text style.
   */
  stripHeight?(): number;
  devicePixelRatio(): number;
  theme(seriesKeys: readonly string[], colors: Record<string, string>): ThemeResolution;
  /** Shows or hides the mark and text surfaces without drawing (the error revision hides them). */
  surfaces?(visible: boolean): void;
  /** Called once by destroy, after the controller released its own state. */
  dispose(): void;
}

/** What the page tells the controller (observers, watchers). */
export interface Invalidate {
  resize(): void;
  /** The chart came back into the document: anything about the page may have changed meanwhile. */
  page(): void;
  theme(): void;
  /** The page's language changed: locale and English marking are read again in the next frame. */
  language(): void;
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

/**
 * An x position in the form `zoom()` and the data read it, so an event's window or `Point.x` can be passed
 * to another chart unchanged (documentation finding 2): a Date for an instant, 'YYYY-MM-DD' for a date, an
 * ISO date-time without offset for a wall-clock time, the category's name, else the number.
 */
export function positionValue(frame: Frame, position: number): XValue {
  if (frame.shape === 'donut') return position;
  const kind = frame.shape === 'points' ? frame.xKind : frame.x.kind;
  // A Date holds whole milliseconds: a position between them is given as the number zoom() reads the same
  // way, so an event's window can be passed on unchanged (final review, finding 12).
  if (kind === 'time') return Number.isInteger(position) ? new Date(position) : position;
  if ((kind === 'date' || kind === 'wall') && Number.isFinite(position)) {
    if (!Number.isInteger(position)) return position;
    const iso = new Date(position).toISOString();
    // Only four-digit years read back as written; others stay positions.
    if (iso.length !== 24) return position;
    // A date is written as one; a position between dates (the padded end of a bar axis) stays a number,
    // which zoom() reads as the same position.
    if (kind === 'date') return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : position;
    // The shortest wall-clock form that keeps the time: seconds and milliseconds only when not zero.
    return iso.endsWith(':00.000Z') ? iso.slice(0, 16) : iso.endsWith('.000Z') ? iso.slice(0, 19) : iso.slice(0, 23);
  }
  if (kind === 'category' && frame.shape === 'aligned') return frame.x.categories?.[position] ?? position;
  return position;
}

/** Whether a window can be set on this frame's x axis: time, date and number axes only in 1.0 (spec I3). */
function zoomable(frame: Frame): boolean {
  return frame.shape === 'points' || (frame.shape === 'aligned' && frame.x.kind !== 'category');
}

function isWall(frame: Frame): boolean {
  return frame.shape === 'aligned' ? frame.x.kind === 'wall' : frame.shape === 'points' && frame.xKind === 'wall';
}

function latestX(frame: Frame): number {
  if (frame.shape === 'aligned') return frame.x.values.length ? frame.x.values[frame.x.values.length - 1]! : NaN;
  if (frame.shape === 'points') {
    let latest = -Infinity;
    for (const s of frame.series) {
      if (s.x.length) latest = Math.max(latest, s.x[s.x.length - 1]!);
      // An observation with no y still marks how far the data reaches.
      if (s.missingX) for (let i = 0; i < s.missingX.length; i++) if (Number.isFinite(s.missingX[i]!)) latest = Math.max(latest, s.missingX[i]!);
    }
    return latest;
  }
  return NaN;
}

/** A window that ends at the latest x and does not show everything follows the data (plan 1.5). */
function followsLatest(view: View, zoom: Span<XValue> | null): boolean {
  if (zoom === null || view.kind === 'donut') return false;
  // The data's own latest position, not the niced or padded edge of the axis (finding 16).
  const latest = latestX(view.frame);
  return Number.isFinite(latest) && view.xDomain[1] >= latest && view.xDomain[0] > view.xFull[0];
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

/** The controller for a kind given by name (tests and Node hosts); the chart functions pass their composition. */
export function createController(kind: ChartKind, input: unknown, page: Host): Controller {
  return controllerFor(COMPOSITIONS[kind], input, page);
}

/** The controller for one chart kind: every stage that differs between kinds comes from its composition. */
export function controllerFor(composition: Composition, input: unknown, page: Host): Controller {
  const kind = composition.kind;
  let host = page;
  // Instrumentation (core/instrument.ts): only in development and benchmark builds; the guard folds to false in
  // the shipped production files, which then carry neither the counters nor the hooks.
  const stages = __DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__) ? new StageCounter() : null;
  const stage = (name: Stage): void => {
    if (__DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__)) stages!.ran(name);
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
  let destroyed = false;
  let internalError: unknown = null;
  /** `append` was called at least once: the pause control is offered (spec I6). */
  let streaming = false;
  let paused = false;
  /** While paused: the store's newest frame and its findings, accepted but not shown. */
  let held: { frame: Frame; dataDiagnostics: readonly DiagnosticInput[]; viewDiagnostics: readonly DiagnosticInput[] } | null = null;
  /**
   * The displayed snapshot's row ownership: what the marks on screen came from (see the invariants at the top
   * of this file). `frozen` holds the caller's rows of that frame once the store had to let go of its revision.
   */
  let onScreen: { frame: Frame; store: Store | null; frozen: Map<number, unknown> | null } | null = null;
  /** Frames a store produced (their rows live in that store's revisions). */
  const storeFrames = new WeakSet<Frame>();
  /**
   * Rows copied out of the store for a frame that still needs them after the store moved on: the displayed
   * frame, the pending (accepted, not yet drawn) one and the one being published each own theirs, so none of
   * them pins the store's history (final review, finding 2).
   */
  let frozenRows = new WeakMap<Frame, Map<number, unknown>>();
  /** The rows of `frame` by source index: its copy when it has one, else its source. */
  const rowOf = (frame: Frame, row: number): unknown => {
    const own = frozenRows.get(frame);
    return own ? own.get(row) ?? null : frame.source.rowAt(row);
  };
  /**
   * One past the last source index each store frame can address: a store numbers rows in arrival order (the
   * opening data first), so a frame's raw window can be read back without the store (re-encoding while paused).
   */
  const rowEnds = new WeakMap<Frame, number>();
  /** Rows of a store below this source index came from the caller's typed columns (its opening data). */
  const columnRows = new WeakMap<Store, number>();
  /** `frame` addresses the rows `from` did, and `added` more. */
  const ends = (frame: Frame, from: Frame, added = 0): void => {
    const end = rowEnds.get(from);
    if (end !== undefined) rowEnds.set(frame, end + added);
  };
  /** What the store held right after the last release with a frame on screen: the bound's baseline. */
  let retainedBaseline = 0;
  let epochs = 0;
  let frameRevision = 0;
  let commits = 0;
  let listeners = new Map<keyof ChartEvents<unknown>, Set<(payload: never) => void>>();
  /** True while a frame runs: findings are delivered at its end, not from inside a stage. */
  let inFrame = false;
  /** The accepted state a running frame publishes: its rows are kept until it is on screen. */
  let inflight: Accepted | null = null;

  function chartName(o: OptionRecord): string {
    return titleOf(o)?.text ?? (host.targetId || host.id);
  }

  /** Every presentation finding once: the same code and field found by two stages (ticks and readouts) is one. */
  function presentationList(): DiagnosticInput[] {
    const out: DiagnosticInput[] = [];
    const seen = new Set<string>();
    for (const list of presentation.values()) {
      for (const d of list) {
        const key = `${d.code}\u0000${d.field ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(d);
      }
    }
    return out;
  }

  function stateDiagnostics(a: Accepted): DiagnosticInput[] {
    return [...a.optionDiagnostics, ...a.dataDiagnostics, ...a.viewDiagnostics, ...a.naming];
  }

  function currentDiagnostics(): Diagnostic[] {
    // Before anything was accepted (a create that failed): what the failure raised (finding 14).
    if (!accepted) return toPublic(presentationList(), chartName(options.current));
    // While paused, `diagnostics` describes everything accepted, the held rows included (finding 6).
    const a = held ? { ...accepted, dataDiagnostics: held.dataDiagnostics, viewDiagnostics: held.viewDiagnostics } : accepted;
    return toPublic([...stateDiagnostics(a), ...presentationList()], accepted.name);
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
    // A frame a formatter's own call superseded is not drawn: what its formatters threw on is not reported.
    if (inFrame && inflight !== null && inflight !== accepted) return;
    addPresentation('format', createDiagnostic('AX160', 'changed', { field }, 'presentation'));
  }

  /**
   * Notifications to author code (onDiagnostic, the console, event listeners) in call order: each delivery
   * is a snapshot taken when it is made and is drained in full, and one made by author code during a drain
   * waits behind it. Only destruction stops a drain (review 3, finding 7).
   */
  const notifications: (() => void)[] = [];
  let draining = false;

  function enqueue(work: () => void): void {
    notifications.push(work);
    // During a frame nothing reaches author code: hover, select and zoom that the interaction layer raises
    // while it is being committed are delivered once the frame has finished publishing (final review, 1).
    if (draining || inFrame) return;
    drain();
  }

  function drain(): void {
    if (draining || notifications.length === 0) return;
    draining = true;
    try {
      while (notifications.length && !destroyed) notifications.shift()!();
    } finally {
      draining = false;
      if (destroyed) notifications.length = 0;
    }
  }

  /**
   * Prints and hands to `onDiagnostic` what is new. The set to deliver is fixed and marked delivered when the
   * delivery is made, so a handler that updates the chart cannot be given a finding twice.
   */
  function deliverChanges(): void {
    if (destroyed) return;
    const now = currentDiagnostics();
    const keys = new Set(now.map(diagnosticKey));
    for (const k of [...deliveredKeys]) if (!keys.has(k)) deliveredKeys.delete(k);
    const fresh = now.filter(d => !deliveredKeys.has(diagnosticKey(d)));
    if (!fresh.length) return;
    for (const d of fresh) deliveredKeys.add(diagnosticKey(d));
    const handler = (accepted?.options ?? options.current).onDiagnostic;
    enqueue(() => {
      for (const d of fresh) {
        if (destroyed) return;
        delivery.print(d);
        if (typeof handler === 'function') delivery.notify(handler as (d: Diagnostic) => void, d);
      }
    });
  }

  /** A rejected or ignored call's findings: printed and given to `onDiagnostic`, never part of `diagnostics`. */
  function deliverRejected(found: readonly DiagnosticInput[], name: string, handler: unknown): void {
    const list = toPublic(found, name).filter(d => !deliveredKeys.has(diagnosticKey(d)));
    if (!list.length) return;
    enqueue(() => {
      for (const d of list) {
        if (destroyed) return;
        delivery.print(d);
        if (typeof handler === 'function') delivery.notify(handler as (d: Diagnostic) => void, d);
      }
    });
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
    // A window kept across a data change does not reach an axis it does not apply to.
    const zoom = zoomable(c.frame) ? c.zoom : null;
    const key = viewKeyFor(kind, c.options, c.resolved, c.frame, zoom, c.hidden, c.messages);
    if (previous && sameValue(previous.viewKey, key)) {
      return { view: previous.view, viewKey: previous.viewKey, viewDiagnostics: previous.viewDiagnostics, found: [] };
    }
    stage('view');
    const sink = new DiagnosticCollector();
    const state = viewStateFor(kind, c.options, c.resolved, zoom, previous?.view ?? null, c.hidden, c.messages);
    const view = composition.view(c.frame, state, sink);
    // A wall-clock window on a wall-clock axis is what the axis reads: the column's own AX112 already says
    // the values have no offset, and the window is not news (documentation finding 2).
    const found = sink.inputs().filter(d => !(d.code === 'AX112' && d.field === 'zoom' && isWall(c.frame)));
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
    // Liveness before acceptance: a chart destroyed by author code during the call takes nothing (defect 6).
    if (destroyed) return;
    commit?.();
    if (commit && c.store && c.store.frame === c.frame) storeFrames.add(c.frame);
    if (held && c.frame === held.frame) held = null;
    options.commit(c.options);
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
    release();
    deliverChanges();
    schedule();
  }

  function setPresentationQuiet(where: PresentationStage, list: readonly DiagnosticInput[]): void {
    if (list.length) presentation.set(where, list);
    else presentation.delete(where);
  }

  /**
   * The call being prepared: what it found so far, for a failure before it is accepted (finding 7). One per
   * call, so a nested call made by author code (a getter) cannot end the outer call's strict check (defect 6).
   */
  interface Preparation {
    sink: DiagnosticCollector | null;
    strict: boolean;
    name: string;
    handler: unknown;
    /** AX140 of a create: validate() lists it after AX199. */
    naming: readonly DiagnosticInput[];
  }

  /** A strict chart rejects a create, update or append whose own findings include an error or warning. */
  function rejectIfStrict(strict: boolean, found: readonly DiagnosticInput[], name: string, handler: unknown): void {
    if (!strict || strictViolations(found).length === 0) return;
    deliverRejected(found, name, handler);
    throw new StrictError(name, toPublic(found, name));
  }

  /** Runs a call. A strict rejection propagates; anything else that throws becomes the internal-error state. */
  function guarded(run: (call: Preparation) => void): void {
    if (destroyed) return;
    const call: Preparation = { sink: null, strict: false, name: '', handler: undefined, naming: [] };
    try {
      run(call);
    } catch (error) {
      if (error instanceof StrictError) throw error;
      // Author code destroyed the chart during the call: nothing is reported on a handle that is gone.
      if (destroyed) return;
      // A failure while a call was prepared (a row getter that throws): what the call had found until then is
      // kept, with AX199 after it, as validate() reports it; under strict that is a rejection, before the
      // accepted chart changes (final review, finding 7).
      const before = call.sink?.inputs() ?? [];
      const after = accepted === null ? call.naming : [];
      if (call.strict) {
        const found = [...before, createDiagnostic('AX199', 'chart-error', {}, 'presentation'), ...after];
        deliverRejected(found, call.name, call.handler);
        throw new StrictError(call.name, toPublic(found, call.name));
      }
      raiseInternal(error, before, after);
      // A create that failed has nothing to draw from: show the error state now (never a blank box).
      if (accepted === null) showInternal(resolveMessages(object(options.current.messages)), chartName(options.current), options.current);
      schedule();
    }
  }

  function nextVersion(): { epoch: number; revision: number } {
    return { epoch: ++epochs, revision: ++frameRevision };
  }

  function update(patch: unknown): void {
    guarded(call => {
      stage('options');
      const { next, changed } = options.preview(patch);
      const previous = accepted;
      const supplied = patch !== null && typeof patch === 'object' && Object.hasOwn(patch, 'data');
      const optionSink = new DiagnosticCollector();
      Object.assign(call, {
        sink: optionSink, strict: next.strict === true, name: chartName(next), handler: next.onDiagnostic,
        naming: previous === null ? namingDiagnostics(next) : [],
      });
      const messages = messagesFor(next, previous);
      let c: Candidate;
      let commit: (() => void) | null = null;
      let heldAfter: typeof held = null;
      const replace = previous === null || changed.has('data') || (supplied && previous.store !== null);
      const reencode = !replace && encodingChanged(previous!.options, next);
      if (!replace && reencode && previous!.store === null && namesOnlyChanged(previous!.options, next)) {
        // Labels or units only, over the caller's own data: the same columns with new names (finding 12).
        const resolved = resolveOptions(kind, publicOptions(next), optionSink, previous!.source.table);
        const p = previous!;
        const opts = optionSink.inputs().filter(d => !DATA_CODES.has(d.code));
        c = {
          options: next, resolved, source: resolved, store: null, frame: renamed(p.frame, resolved, frameRevision += 1),
          dataDiagnostics: p.dataDiagnostics, dataOptions: p.dataOptions,
          optionDiagnostics: dedupe([...p.dataOptions, ...opts], p.dataDiagnostics), zoom: p.zoom, hidden: p.hidden, messages,
        };
      } else if (replace || (reencode && previous!.store === null)) {
        // New data, or new fields over the caller's own data: normalized from the options, borrowing typed
        // columns (plan 1.2). A stream this replaces is dropped with everything it held.
        stage('normalize');
        const resolved = resolveOptions(kind, publicOptions(next), optionSink);
        const dataSink = new DiagnosticCollector();
        const frame = composition.normalize(kind, resolved, environment, dataSink, nextVersion());
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
        ends(prepared.frame, store.frame);
        commit = prepared.commit;
        const opts = optionSink.inputs();
        if (paused && held) {
          // Paused: the rows on screen are read again with the new fields on their own, and the arrivals stay
          // held, re-encoded in the store, until Resume (review 3, finding 5). The rows on screen are the
          // displayed revision's raw window, typed-column rows marked as such (verification, defect 4).
          const table = displayedTable(previous!.frame, store);
          const shownResolved = resolveOptions(kind, publicOptions(next), new DiagnosticCollector(), table);
          const shownSink = new DiagnosticCollector();
          const shown = composition.normalize(kind, shownResolved, environment, shownSink, nextVersion());
          // Both views are built and validated before either is accepted: the held one keeps its findings
          // (AX130 of a held ninth series), which count for strict and for `diagnostics` (defect 4).
          const heldView = viewFor({
            options: next, resolved, source: resolved, store, frame: prepared.frame, dataDiagnostics: prepared.diagnostics,
            dataOptions: [], optionDiagnostics: [], zoom: previous!.zoom, hidden: previous!.hidden, messages,
          }, null);
          heldAfter = { frame: prepared.frame, dataDiagnostics: prepared.diagnostics, viewDiagnostics: heldView.viewDiagnostics };
          c = {
            options: next, resolved, source: shownResolved, store, frame: shown, dataDiagnostics: shownSink.inputs(),
            dataOptions: [], optionDiagnostics: dedupe(opts, prepared.diagnostics),
            zoom: previous!.zoom, hidden: previous!.hidden, messages,
          };
        } else {
          c = {
            options: next, resolved, source: resolved, store, frame: prepared.frame, dataDiagnostics: prepared.diagnostics,
            dataOptions: [], optionDiagnostics: dedupe(opts, prepared.diagnostics),
            zoom: previous!.zoom, hidden: previous!.hidden, messages,
          };
        }
      } else {
        // Presentation only (title, domains, references, colors, …): the frame stays. Rows held by a Resume
        // that failed are shown by the next accepted call (finding 5).
        const p = resumable(previous!);
        // The fields are unchanged, so what the retained rows said about them still holds: a stream is checked
        // against no rows (a title update must not walk them, finding 11) unless they were found wanting.
        const resolved = p.store
          ? p.resolved.valid ? resolveOptions(kind, publicOptions(next), optionSink, rowsTable([]))
            : p.store.resolveEncoding(publicOptions(next), optionSink)
          : resolveOptions(kind, publicOptions(next), optionSink, p.source.table);
        const opts = optionSink.inputs().filter(d => !DATA_CODES.has(d.code));
        c = {
          options: next, resolved, source: p.source, store: p.store, frame: p.frame, dataDiagnostics: p.dataDiagnostics,
          dataOptions: p.dataOptions, optionDiagnostics: dedupe([...p.dataOptions, ...opts], p.dataDiagnostics),
          zoom: p.zoom, hidden: p.hidden, messages,
        };
      }
      const viewed = viewFor(c, previous);
      // Author code (a getter) destroyed the chart while the call was prepared: nothing is accepted.
      if (destroyed) return;
      const found = [...c.optionDiagnostics, ...c.dataDiagnostics, ...viewed.viewDiagnostics, ...namingDiagnostics(next)];
      // While paused the held window is part of the chart: its findings count for strict too (finding 6).
      const keptHeld = heldAfter ?? (c.frame === previous?.frame ? held : null);
      if (paused && keptHeld) found.push(...keptHeld.dataDiagnostics, ...keptHeld.viewDiagnostics);
      rejectIfStrict(next.strict === true, found, chartName(next), next.onDiagnostic);
      // Data replaced or bounds changed: a window that no longer ends at the latest x stops following.
      const follow = followsLatest(viewed.view, c.zoom);
      if (c.frame !== previous?.frame) held = null;
      // The held arrivals are in place before anything is delivered: a handler that resumes from inside
      // this call finds them, and no arrival stays held on a running chart (final review, finding 6).
      if (heldAfter) held = heldAfter;
      accept(c, viewed, follow, commit);
    });
  }

  function openStore(a: Accepted): Store {
    const store = composition.openStore(a.frame, a.source, a.options.data, environment, kind);
    const table = a.source.table;
    if (table) {
      rowEnds.set(store.frame, table.length);
      columnRows.set(store, table.columns ? table.length : 0);
    }
    return store;
  }

  function append(rows: unknown, appendOptions?: { keep?: number }): void {
    guarded(call => {
      const previous = accepted;
      if (!previous) return;
      // A row getter that throws is a failure of this call: under strict, a rejection (defect 6).
      Object.assign(call, { strict: previous.options.strict === true, name: previous.name, handler: previous.options.onDiagnostic });
      // The pause control appears (spec I6) once an append was accepted, not before it validated.
      if (!Array.isArray(rows) || rows.length === 0) {
        if (!streaming) { streaming = true; schedule(); }
        return;
      }
      stage('append');
      const keep = appendOptions?.keep;
      const store = previous.store ?? openStore(previous);
      const prepared = (store.prepareAppend as (r: readonly unknown[], o: { keep?: number }) => PreparedFrame<Frame>)(
        rows, keep === undefined ? {} : { keep });
      ends(prepared.frame, store.frame, rows.length);
      // While paused the view does not move (spec I6), but the rows are validated now, with the window shown.
      const base = held ? { ...previous, frame: held.frame } : previous;
      let zoom = previous.zoom;
      if (!paused && previous.follow && zoom) zoom = followLatest(prepared.frame, previous.view) ?? zoom;
      let c: Candidate = {
        // Once the stream has its store the caller's opening data is no longer read: options and source keep no
        // reference to it, so it can be collected once no displayed frame needs it (data agent's report).
        options: streamOptions(previous.options), resolved: withoutTable(previous.resolved), source: withoutTable(previous.source), store, frame: prepared.frame,
        dataDiagnostics: prepared.diagnostics, dataOptions: previous.dataOptions,
        optionDiagnostics: previous.optionDiagnostics, zoom, hidden: previous.hidden, messages: previous.messages,
      };
      let commitAppend: (() => void) | null = prepared.commit;
      if (!paused && previous.dataOptions.some(d => d.code === 'AX101') && previous.options.strict !== true) {
        // A field the earlier data did not have: once the retained rows have it, the frame is read again with
        // the fields as given and AX101 goes (review 3, finding 8).
        prepared.commit();
        storeFrames.add(prepared.frame);
        frameRevision = Math.max(frameRevision, prepared.frame.revision);
        commitAppend = null;
        const check = new DiagnosticCollector();
        const resolved = store.resolveEncoding(publicOptions(previous.options), check);
        if (!check.inputs().some(d => d.code === 'AX101')) {
          const again: PreparedFrame<Frame> = store.prepareReencode(resolved, nextVersion());
          ends(again.frame, prepared.frame);
          commitAppend = again.commit;
          c = {
            ...c, resolved, source: resolved, frame: again.frame, dataDiagnostics: again.diagnostics, dataOptions: [],
            optionDiagnostics: previous.optionDiagnostics.filter(d => !DATA_CODES.has(d.code)),
          };
        }
      }
      const viewed = viewFor(c, base);
      if (destroyed) return;
      const found = [...prepared.callDiagnostics, ...viewed.found];
      rejectIfStrict(previous.options.strict === true, found, previous.name, previous.options.onDiagnostic);
      if (paused) {
        prepared.commit();
        storeFrames.add(prepared.frame);
        frameRevision = Math.max(frameRevision, prepared.frame.revision);
        // The store is the accepted state's now; rows no displayed or pending frame needs go (finding 4).
        accepted = {
          ...previous, store, options: streamOptions(previous.options),
          resolved: withoutTable(previous.resolved), source: withoutTable(previous.source),
        };
        options.commit(accepted.options);
        release();
        // The held state: complete findings for the data accepted so far, kept apart from what is drawn, so a
        // display effect (an error state) never reaches the ring on screen before Resume (finding 6).
        held = { frame: prepared.frame, dataDiagnostics: prepared.diagnostics, viewDiagnostics: viewed.viewDiagnostics };
        streaming = true;
        deliverChanges();
        schedule();
        return;
      }
      streaming = true;
      // The new frame is made from the store's head, which already has every held arrival: a revision held by
      // a Resume that failed is superseded here, in the same step (final review, finding 3).
      held = null;
      accept(c, viewed, previous.follow && zoom !== null, commitAppend);
    });
  }

  /**
   * The caller's rows of a displayed frame as a table, in source order and with their own source indexes, so
   * they can be normalized again on their own (re-encoding what is on screen while paused). A frame over the
   * caller's own table is read from it; a store frame from its raw window, with the rows that came from typed
   * columns marked as such (a NaN there is "no data", not an unplottable value; verification, defect 4).
   */
  function displayedTable(frame: Frame, store: Store | null): Table {
    const own = frozenRows.get(frame);
    if (!own && !storeFrames.has(frame) && isTable(frame.source)) return frame.source;
    const rows = own ?? freeze(frame).rows;
    const indexes = [...rows.keys()].sort((p, q) => p - q);
    const columns = store ? columnRows.get(store) ?? 0 : 0;
    // Positions read the rows in order; provenance and events read them by their own source index.
    return {
      ...rowsTable(indexes.map(i => rows.get(i))), isColumnRow: i => indexes[i]! < columns,
      rowIndex: i => indexes[i]!, rowAt: index => rows.get(index) ?? null,
    };
  }

  /**
   * The caller's rows of `frame`'s revision, read once, so the frame stays addressable on its own: every row
   * a slot refers to, and the raw window around them (rows with no usable x, which re-encoding to another
   * field can make points; verification, defect 4). The window is the retained rows from the lowest one a
   * slot refers to up to the end of the revision, and the retained rows just below it.
   */
  function freeze(frame: Frame): { frame: Frame; rows: Map<number, unknown> } {
    const rows = new Map<number, unknown>();
    let lowest = Infinity;
    const keep = (row: number) => {
      if (row < 0 || rows.has(row)) return;
      rows.set(row, frame.source.rowAt(row));
      if (row < lowest) lowest = row;
    };
    const each = (index: Int32Array | null, length: number) => {
      for (let i = 0; i < length; i++) keep(index ? index[i]! : i);
    };
    if (frame.shape === 'aligned') for (const s of frame.series) each(s.row, frame.length);
    else if (frame.shape === 'points') {
      for (const s of frame.series) {
        each(s.row, s.x.length);
        // Observations with no plottable y are rows too: re-encoding to another field can make them points
        // (final review, finding 6).
        if (s.missingRow) for (const row of s.missingRow) keep(row);
      }
    }
    else each(frame.row, frame.labels.length);
    const end = rowEnds.get(frame);
    if (end !== undefined) {
      const from = Math.min(lowest, end);
      for (let i = from; i < end; i++) {
        if (rows.has(i)) continue;
        const row = frame.source.rowAt(i);
        if (row !== null) rows.set(i, row);
      }
      for (let i = from - 1; i >= 0; i--) {
        const row = frame.source.rowAt(i);
        if (row === null) break;
        rows.set(i, row);
      }
    }
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
  /** The accepted state with the held frame in it, when Resume was asked for but did not complete. */
  function resumable(a: Accepted): Accepted {
    return !paused && held ? { ...a, frame: held.frame, dataDiagnostics: held.dataDiagnostics } : a;
  }

  function viewCandidate(given: Accepted, change: Partial<Pick<Candidate, 'zoom' | 'hidden' | 'frame' | 'dataDiagnostics'>>): Candidate {
    const a = resumable(given);
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
      if (!zoomable(previous.frame)) {
        // 1.0 zooms time, date and number x axes only (spec I3): a window on a donut or a category axis is an
        // option that does not apply to the chart (DX3), reported and ignored. Clearing a zoom is no request.
        if (domain !== null && domain !== undefined) {
          deliverRejected([createDiagnostic('AX150', 'none', {
            field: 'zoom', detail: 'Zoom applies to time, date and number x axes only.',
          }, 'call')], previous.name, previous.options.onDiagnostic);
        }
        return;
      }
      if (isCompact(kind, previous.options)) {
        // A compact chart has no zoom (spec 3.7): a window is reported and nothing is kept for later, so turning
        // compact off does not apply it (final review, finding 13).
        if (domain !== null && domain !== undefined) {
          deliverRejected([createDiagnostic('AX150', 'none', {
            field: 'zoom', detail: 'A compact chart does not zoom.',
          }, 'call')], previous.name, previous.options.onDiagnostic);
        }
        return;
      }
      // The window is kept as given at the call: a Date the caller mutates later does not move it (finding 12).
      const own = (v: unknown) => v instanceof Date ? new Date(v.getTime()) : v;
      const pair = Array.isArray(domain) && domain.length === 2 ? [own(domain[0]), own(domain[1])] as unknown as Span<XValue> : null;
      const c = viewCandidate(previous, { zoom: pair });
      const viewed = viewFor(c, previous);
      // A window that cannot be read is reported and ignored; zoom never throws (spec 3.5).
      // A hint (AX112: a wall-clock window on a wall-clock axis) does not make the window unreadable.
      const bad = viewed.found.filter(d => d.field === 'zoom' && d.level !== 'hint');
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

  /** The window shown, in the form `zoom()` reads (positionValue); null when the whole range is shown. */
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
      guarded(() => {
        const previous = accepted;
        if (!previous) return;
        let zoomed = previous.zoom;
        if (previous.follow && zoomed) zoomed = followLatest(frame.frame, previous.view) ?? zoomed;
        let c = viewCandidate(previous, { frame: frame.frame, dataDiagnostics: frame.dataDiagnostics, zoom: zoomed });
        let commit: (() => void) | null = null;
        const store = previous.store;
        if (store && previous.dataOptions.some(d => d.code === 'AX101') && previous.options.strict !== true) {
          // A field the earlier data did not have, which the held arrivals bring: the frame is read again with
          // the fields as given, and AX101 goes, as for a running append (final review, finding 6).
          const check = new DiagnosticCollector();
          const resolved = store.resolveEncoding(publicOptions(previous.options), check);
          if (!check.inputs().some(d => d.code === 'AX101')) {
            const again: PreparedFrame<Frame> = store.prepareReencode(resolved, nextVersion());
            ends(again.frame, store.frame);
            commit = again.commit;
            c = {
              ...c, resolved, source: resolved, frame: again.frame, dataDiagnostics: again.diagnostics, dataOptions: [],
              optionDiagnostics: previous.optionDiagnostics.filter(d => !DATA_CODES.has(d.code)),
            };
          }
        }
        const viewed = viewFor(c, previous);
        // The held frame is let go only once its replacement is accepted (review 3, finding 5).
        held = null;
        accept(c, viewed, previous.follow && zoomed !== null, commit);
      });
    }
    schedule();
  }

  // ── frame phase ────────────────────────────────────────────────────────────────────────────────

  let frameRequest = 0;
  let frameScheduled = false;
  let size: Size | null = null;
  let sizeDirty = true;
  /** The readout strip is reserved under the plot (decision 0004 revision 2, rule 5). */
  let readoutMode = false;
  /** The strip's height as last measured (two 24 px lines until then). */
  let stripHeight = 0;
  /** The text style the strip's height was measured for. */
  let stripStyle: TextStyle | null = null;
  /** Decision 0004 revision 3, rule 5: how a datum's values are shown when pointed at. */
  let readoutKind: ReadoutMode = 'floating';
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
  /** Marks were drawn at some point (cleared marks after a failure count): a later empty frame must clear them. */
  let hadMarks = false;
  /** The host hid the mark and text surfaces for an error revision; the next drawn frame shows them again. */
  let surfacesHidden = false;
  let waiters: { revision: number; resolve: () => void }[] = [];

  function schedule(): void {
    if (destroyed || frameScheduled) return;
    frameScheduled = true;
    frameRequest = host.requestFrame(time => {
      frameRequest = 0;
      frameScheduled = false;
      void time;
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
    if (!hasData(a.view, true)) {
      // Nothing drawn because series could not be (AX108: series disabled) is not an empty chart: the figure
      // says which, as the summary does (spec 3.5).
      const undrawn = a.view.kind === 'donut' ? [] : a.view.frame.series.filter(s => !s.drawable);
      if (undrawn.length) {
        const table = a.options.table !== false && !isCompact(kind, a.options);
        const text = undrawn.map(s => seriesNotDrawnSentence(m, s.label, table)).join(' ');
        return { kind: 'error', text, message: 'seriesNotDrawn' };
      }
      return { kind: 'empty', text: m.empty, message: 'empty' };
    }
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
  function raiseInternal(error: unknown, before: readonly DiagnosticInput[] = [], after: readonly DiagnosticInput[] = []): void {
    const first = internalError === null;
    internalError = error;
    if (first) delivery.internal(accepted?.name ?? (host.targetId || host.id), error);
    setPresentationQuiet('internal', [...before, createDiagnostic('AX199', 'chart-error', {}, 'presentation'), ...after]);
    if (!inFrame) deliverChanges();
  }

  function formatSpec(a: Accepted): FormatSpec {
    const { frame, resolved } = a;
    // `onFormatterError` is made once, outside: a closure made here would share this scope with `valueFor`,
    // and so keep `resolved` and its borrowed table alive as long as the formatters are reused (data agent).
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
      : { kind: frame.xKind, timeZone: frame.timeZone, dateUnit: pointDateUnit(frame, resolved.x.field, rowOf), categories: null };
    const series = frame.shape === 'aligned'
      ? frame.series.map(s => ({ field: s.field, unit: s.unit, scale: s.valueScale, format: valueFor(s.field)?.format ?? null }))
      : frame.series.map(() => ({ field: resolved.values[0]?.field ?? 'y', unit: frame.yUnit, scale: resolved.values[0]?.scale ?? null, format: resolved.values[0]?.format ?? null }));
    return {
      series, x: { field: resolved.x.field, unit: resolved.x.unit, format: resolved.x.format as never, ...x },
      locale, messages, onFormatterError,
    };
  }

  /** What a formatter's failure reaches: the chart, not the options it was made from. */
  const onFormatterError = (field: string): void => formatterFailed(field);

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
    // The frame's own rows are kept while it publishes, whatever its author code accepts meanwhile (an append
    // with keep from a callback can no longer retire them; final review, finding 1).
    inflight = a;
    try {
      frame(a);
    } catch (error) {
      // A frame that a newer call superseded, or a destroyed chart, does not publish an error state: the newer
      // state is drawn by the next frame (final review, finding 1).
      if (error !== ABORT && !destroyed && accepted === a) failSafe(a, error);
    } finally {
      inFrame = false;
      inflight = null;
      if (!destroyed) release();
    }
    // A call made by author code during the frame is drawn by the next one.
    if (!destroyed && accepted !== a) schedule();
    // Author code last: the frame is complete before any handler runs.
    deliverChanges();
    drain();
  }

  /** Whether a frame may go on after author code ran (a formatter): the chart is alive and on the same state. */
  function current(a: Accepted): boolean {
    return !destroyed && accepted === a;
  }

  function frame(a: Accepted): void {
    stage('frame');
    /**
     * Every host mutation of this frame comes from `a`. Author code (formatters, the lazy summary) runs
     * before the first one; if it changed or destroyed the chart, the frame stops with nothing written and
     * the next frame draws the newer state. Once writing has started the frame completes for `a`, so no layer
     * is left on another revision (invariant 3; review 3, controller blocker 1).
     */
    let mutated = false;
    const mutate = (): void => {
      if (destroyed) throw ABORT;
      if (!mutated) {
        if (accepted !== a) throw ABORT;
        mutated = true;
      }
    };
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

    // Formatters. What a formatter threw on belongs to the formatters and the revision it formatted.
    const spec = formatSpec(a);
    const fKey = formattersKey(spec, a.resolved.values.length);
    let formatters = drawn?.formatters;
    if (!formatters || !drawn || !sameKey(drawn.formattersKey, fKey)) {
      stage('formatters');
      // The bucket belongs to the formatters: emptied before they are built, so what their construction
      // reports (an invalid Intl option) stays, and kept while they stay, as their fallback goes on (finding 13).
      setPresentation('format', []);
      formatters = createFormatters(spec, { locale, timeZone });
    }

    // Naming (spec A1): a labelledBy that names nothing falls back to the title or a generated name.
    const by = stringOption(a.options, 'labelledBy');
    const byText = by ? host.labelText(by) : null;
    const named = by !== null && byText !== null;
    const title = titleOf(a.options);
    setPresentation('naming', by !== null && !named && title === null
      ? [createDiagnostic('AX140', 'none', { detail: `No element has the id "${by}".` }, 'presentation')] : []);
    const caption = named ? byText.trim() || undefined : undefined;

    const english = englishFor(a, lang);
    // The note is English only when every template it shows is the built-in one, "See table." included when
    // it is in them (spec A10). READER CALL SITE (review modules-codex, finding 5): until the reader gives
    // each note segment its language, the whole note is one segment and is tagged only when all of it is
    // built-in; a sentence mixing an override with a built-in "See table." stays untagged.
    const noteLangFor = (labelsHidden: number, disclosure: { omitted: number; changed: number }): string | null => {
      const shownKeys = [disclosure.omitted > 0 ? 'valuesNotShown' : null, disclosure.changed > 0 ? 'valuesChanged' : null,
        labelsHidden > 0 ? 'labelsHidden' : null].filter((k): k is 'valuesNotShown' | 'valuesChanged' | 'labelsHidden' => k !== null);
      const withTable = a.options.table !== false && !compact && shownKeys.some(k => a.messages[k].includes('{seeTable}'));
      const keys: (keyof Messages)[] = withTable ? [...shownKeys, 'seeTable'] : shownKeys;
      return shownKeys.length > 0 && keys.every(k => english(k)) ? 'en' : null;
    };
    const foreignPage = lang !== null && !/^en(?:-|$)/i.test(lang);
    const noteRuns = (reader: ReaderModel): { text: string; lang: string | null }[] => {
      const runs = (reader as ReaderModel & { noteSegments?: readonly { text: string; lang: 'en' | null }[] | null }).noteSegments;
      if (!runs) return [{ text: reader.note ?? '', lang: noteLangFor(currentHidden, disclosureNow()) }];
      return runs.map(run => ({ text: run.text, lang: run.lang === 'en' && foreignPage ? 'en' : null }));
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
      // The summary reads the view, not the name: when only the naming inputs changed, the statistics already
      // written are kept rather than scanned again (finding 11).
      const before = lastReader ?? (drawn ? { reader: drawn.reader, inputs: drawn.readerInputs } : null);
      const kept = before && sameKey(before.inputs.filter((_, i) => !NAMING_INPUTS.has(i)), inputs.filter((_, i) => !NAMING_INPUTS.has(i)))
        ? before.reader : null;
      const t = a.options.title;
      const reader = readerWith(composition.reader, {
        view, formatters: formatters!, messages: a.messages, type: a.messages[KIND_MESSAGES[kind]] || KIND_NAMES[kind],
        title: typeof t === 'string' || (t && typeof t === 'object') ? t as string | Title : undefined,
        labelledBy: named ? by! : undefined, caption,
        // The x column header carries the x unit (spec A4).
        labels: { xUnit: a.resolved.x.unit ?? undefined },
        subtitle: stringOption(a.options, 'subtitle') ?? undefined,
        description: stringOption(a.options, 'description') ?? undefined,
        disclosure, labelsHidden, table: a.options.table !== false, compact, locale,
      });
      if (kept) {
        const summary = kept.summary;
        const renamed: ReaderModel & { noteSegments: typeof reader.noteSegments } = {
          name: reader.name, note: reader.note, table: reader.table, noteSegments: reader.noteSegments, get summary() { return summary; },
        };
        return lastReader = { reader: renamed, inputs };
      }
      return lastReader = { reader, inputs };
    };
    /** Builds the reader; when building it found new omissions (a formatter threw), once more with them. */
    let currentHidden = 0;
    const settleReader = (labelsHidden: number) => {
      currentHidden = labelsHidden;
      let disclosure = disclosureNow();
      let built = readerFor(labelsHidden, disclosure);
      // The summary runs author formatters lazily: it is made here, so what they threw on is in the
      // disclosure this settles on, and no reader is built again once writing has started (verification,
      // claims: a throwing value formatter ran again during the figure's write).
      void built.reader.summary;
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
      // Loading and error are not empty (documentation findings 1 and 3): their description is the state, not
      // a reading of data the plot does not show.
      const summary = message === null ? reader.summary
        : shown.kind === 'empty' ? (compact ? `${message} ${reader.summary}` : reader.summary) : message;
      return {
        compact, title: named ? null : title, labelledBy: named ? by : null, name: reader.name || a.name,
        subtitle: stringOption(a.options, 'subtitle'), summary,
        summaryVisible: tooSmall, note: noteShown ? reader.note : null, message,
        messageLang: message !== null && shown.kind !== 'ready' && shown.message ? english(shown.message) : null,
        noteLang: noteLangFor(currentHidden, disclosureNow()),
        // The reader's runs, each in its own language (reader review, finding 5); English is marked only on a
        // page in another language (A10).
        noteSegments: noteShown && reader.note !== null ? noteRuns(reader) : null,
        // The generated summary's sentences are the built-in templates; the names in them do not change that.
        summaryLang: message !== null && shown.kind !== 'ready' && shown.kind !== 'empty'
          ? (shown.message && english(shown.message) ? 'en' : null)
          : english('chartSummary') && english('seriesSummary') ? 'en' : null,
      };
    };
    const zoomOn = zoomApplies(view, a.options.zoom) ? (a.options.zoom === 'touch' ? 'touch' as const : true) : false;
    const zoomed = view.kind !== 'donut' && a.zoom !== null && (view.xDomain[0] > view.xFull[0] || view.xDomain[1] < view.xFull[1]);
    const legend = a.options.legend === false ? false : (['top', 'right', 'bottom'] as const).find(p => p === a.options.legend) ?? 'bottom';
    const controlsFor = (reader: ReaderModel, tooSmall: boolean): ControlsState => ({
      kind, view, formatters: formatters!, messages: a.messages, reader, tooSmall,
      ready: shown.kind === 'ready', interactive: !compact, tooltip: a.options.tooltip !== false, legend,
      // Series that could not be drawn are still rows: the table their sentence points to is offered.
      inspectable: (shown.kind === 'empty' || (shown.kind === 'error' && shown.message === 'seriesNotDrawn')) &&
        (reader.table?.rowCount ?? 0) > 0,
      empty: shown.kind === 'empty', message: shown.kind === 'ready' ? null : shown.text,
      zoom: zoomOn, zoomed, streaming, paused, epoch: a.frame.epoch, english, pageLang: lang, readout: readoutMode,
      // Decision 0004 revision 3, rule 5, for the interaction layer: 'floating', 'strip' or 'none'.
      readoutMode: readoutKind,
    });

    // Tick labels are made now, before anything is written: an author tick formatter runs here, never during
    // publication (final review, finding 1), and what it reported belongs to every layout made from them,
    // cached ones included (finding 11).
    const axisContext: AxisContext = {
      resolved: a.resolved, locale, compact,
      onFormatterError: () => {},
      xLabelGiven: typeof object(a.options.x).label === 'string',
      valueTitle: a.messages.value,
    };
    const tickFailures = shown.kind === 'ready' && !compact ? tickFormatFailures(view, axisContext) : [];
    // A formatter that changed the chart made findings about a revision that is not drawn (defect 3).
    if (!current(a)) throw ABORT;
    setPresentation('layout', tickFailures.map(field => createDiagnostic('AX160', 'changed', { field }, 'presentation')));

    let { reader, inputs: readerInputs } = settleReader(hiddenIn(drawn?.layout));
    // The lazy parts of the reader model run author formatters: materialized here, before anything is written.
    void reader.summary;
    void reader.note;
    if (!current(a)) throw ABORT;

    // Theme: resolved when the page may have changed, or the series or their colors did.
    const keys = themeKeys(view);
    const nextThemeKey = [keys.join('\u0000'), a.options.colors];
    if (themeDirty || !theme || !sameKey(themeKey, nextThemeKey)) {
      mutate();
      resolveTheme(keys, a.options.colors, nextThemeKey);
    }


    // The fallback is only for a plot; a state message is shown in whatever room there is.
    if (shown.kind !== 'ready' || compact) fallback = null;
    let tooSmall = fallback !== null;
    let arranged: { reader: ReaderModel; small: boolean; strip: boolean } | null = null;
    /** Puts the caption and the controls in place for one mode, and says whether anything moved. */
    const arrange = (small: boolean): boolean => {
      if (arranged && arranged.reader === reader && arranged.small === small && arranged.strip === readoutMode) return false;
      arranged = { reader, small, strip: readoutMode };
      stage('figure');
      const model = modelFor(reader, small);
      mutate();
      const moved = host.figure.update(model);
      // The legend and toolbar are in place before the plot is measured: they take their share now.
      return host.interaction.prepare(controlsFor(reader, small)) || moved;
    };
    if (arrange(tooSmall) || sizeDirty || size === null) {
      size = host.measure();
      sizeDirty = false;
    }

    // Layout.
    let layout: Layout;
    let lKey: readonly unknown[] | null = null;
    const plotLayout = (at: Size, strip = 0): { layout: Layout; key: readonly unknown[] } => {
      // A visible figure that leaves the plot no room is too small (L8), not unmeasured.
      if (!compact && (at.width <= 0 || at.height <= 0)) {
        return { layout: { kind: 'too-small', width: Math.max(0, at.width), height: Math.max(0, at.height) }, key: ['too-small', at.width, at.height] };
      }
      const key = [...layoutKey(view, at, style, fontEpoch, axisContext), strip];
      if (drawn && drawn.layoutKey && sameKey(drawn.layoutKey, key) && drawn.layout.kind !== 'unmeasured') return { layout: drawn.layout, key: drawn.layoutKey };
      if (lastLayout && sameKey(lastLayout.key, key)) return lastLayout;
      stage('layout');
      const input = layoutInput(view, at, { measurer: host.measurer, style }, axisContext);
      const result = { layout: computeLayout(input), key };
      lastLayout = result;
      return result;
    };
    // Readout mode, decided by layout (rule 5): the plot's rectangle as it is without the strip, laid out in
    // the plot's whole column, is narrower than 240 or shorter than 140 CSS px. The strip is then reserved and
    // the plot measured again; the decision does not depend on the strip, so it cannot flip with it. Held
    // while the plot is too small (L8): that state has no strip.
    let withoutStrip: Layout['kind'] | null = null;
    if (size !== null && size.width > 0 && shown.kind === 'ready' && !compact && !tooSmall) {
      const room = size.room ?? size;
      // The strip is two line heights of its own text, measured by the host the way other text is (its own
      // font, whatever the page's size), once per text style; when reserved, what it really took.
      if (stripStyle !== style) {
        stripStyle = style;
        const measured = host.stripHeight?.();
        stripHeight = measured !== undefined && Number.isFinite(measured) && measured > 0 ? measured : 2 * Math.max(24, style.lineHeight);
      }
      if (readoutMode && size.room && size.room.height - size.height > 0) stripHeight = size.room.height - size.height;
      const without = plotLayout({ width: room.width, height: room.height }).layout;
      withoutStrip = without.kind;
      // Decision 0004 revision 3, rule 5: a plot that, laid out without a strip, is under 240 × 140 has the
      // strip; if the strip would leave it under the L8 minimum of 80 px, there is no strip and no floating
      // tooltip either ('none': pointing highlights the datum; its values are in the keyboard reading and the
      // table). Never floating below the limit (final review, finding 9).
      const small = without.kind === 'plot' && (without.plot.width < READOUT_WIDTH || without.plot.height < READOUT_HEIGHT);
      const next: ReadoutMode = a.options.tooltip === false || !small ? 'floating'
        : without.kind === 'plot' && without.plot.height - stripHeight >= MIN_PLOT_HEIGHT ? 'strip' : 'none';
      if (next !== readoutKind) {
        readoutKind = next;
        const wantStrip = next === 'strip';
        if (wantStrip !== readoutMode) {
          readoutMode = wantStrip;
          // Reserving or giving back the strip always changes the plot: it is measured again.
          arrange(tooSmall);
          size = host.measure() ?? size;
        } else {
          arranged = null;
          arrange(tooSmall);
        }
      }
    }
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
      const strip = readoutMode && size.room ? Math.max(0, size.room.height - size.height) : 0;
      let result = plotLayout(fallback ? { width: size.width - fallback.width, height: size.height - fallback.height } : size, strip);
      for (let pass = 0; pass < 4; pass++) {
        const small = result.layout.kind === 'too-small';
        if (small && readoutMode && withoutStrip === 'plot') {
          // Too small only because of the strip (its real height was more than expected): no strip and no
          // tooltip, and the readable plot stays (rule 5). The measured height keeps the next frame there.
          if (size.room) stripHeight = Math.max(stripHeight, size.room.height - size.height);
          readoutMode = false;
          readoutKind = 'none';
          arrange(tooSmall);
          size = host.measure() ?? size;
          result = plotLayout(size);
          continue;
        }
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
        result = plotLayout(size, readoutMode && size.room ? Math.max(0, size.room.height - size.height) : 0);
      }
      layout = result.layout;
      lKey = result.key;
      if (destroyed) throw ABORT;
    }

    // Findings that follow from the layout shown, recomputed every frame (cheap): L8, L1, the bar hint.
    const fit: DiagnosticInput[] = [];
    if (tooSmall || layout.kind === 'too-small') fit.push(createDiagnostic('AX142', 'none', {}, 'presentation'));
    const hidden = hiddenIn(layout);
    if (hidden > 0) {
      // The registry suggests horizontal bars only for vertical bars on category labels.
      const xKind = view.kind === 'donut' ? undefined : view.kind === 'scatter' ? view.frame.xKind : view.frame.x.kind;
      fit.push(createDiagnostic('AX143', 'none', {
        field: a.resolved.x.field, count: hidden, chartType: view.kind, xKind, horizontal: view.kind === 'bar' ? view.horizontal : undefined,
      }, 'presentation'));
    }
    if (view.kind === 'bar' && layout.kind === 'plot') {
      const along = view.horizontal ? layout.plot.height : layout.plot.width;
      const bars = view.visibleSlots.end - view.visibleSlots.start;
      if (bars > along) fit.push(createDiagnostic('AX132', 'none', { field: a.resolved.x.field }, 'presentation'));
    }
    setPresentation('fit', fit);
    const measured = layout.kind !== 'unmeasured' || (shown.kind !== 'ready' && size !== null && size.width > 0 && size.height > 0);
    ({ reader, inputs: readerInputs } = settleReader(hidden));
    if (destroyed) throw ABORT;

    // Scene.
    const sceneInputs = [view, layout, pixelRatio];
    let scene = drawn?.scene;
    if (!scene || !drawn || !sameKey(drawn.sceneInputs, sceneInputs)) {
      stage('scene');
      scene = composition.scene(view, layout, pixelRatio);
    }

    // Lookup reads the frame through the view; it switches with the marks.
    // Scatter ties are decided within half a device pixel: the ratio is part of what the lookup depends on.
    const lookupInputs = [view, layout, formatters, a.messages, locale, view.kind === 'scatter' ? pixelRatio : 1];
    let lookup = drawn?.lookup;
    if (!lookup || !drawn || !sameKey(drawn.lookupInputs, lookupInputs)) {
      stage('lookup');
      lookup = composition.lookup(view, layout, formatters, a.messages, locale, pixelRatio);
    }

    // Marks: drawn again for a new scene, a new theme or a new pixel ratio, never rebuilt for a theme alone.
    // A frame that cannot draw (no size) clears what an earlier frame drew, so no marks outlive their rows.
    mutate();
    if (surfacesHidden) {
      host.surfaces?.(true);
      surfacesHidden = false;
    }
    const paintInputs = measured ? [scene, themeRevision, pixelRatio] : [];
    // Nothing drawn yet and nothing to draw: no call at all (a hidden container stays untouched, L3).
    const drewBefore = drawn !== null && drawn.paintInputs.length > 0;
    if (measured ? !drawn || !sameKey(drawn.paintInputs, paintInputs) : drewBefore || (drawn === null && hadMarks)) {
      stage('draw');
      host.renderer.draw(measured ? scene : emptyScene(), theme!.bindings, theme!.theme, pixelRatio);
      hadMarks = measured;
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
    host.interaction.commit({
      ...controlsFor(reader, tooSmall), layout, lookup, bindings: theme!.bindings, theme: theme!.theme, pixelRatio,
    });
    // The displayed snapshot is now this revision (or nothing, when nothing could be drawn): older rows go.
    showing(measured ? a : null);
    if (measured) settle(a.revision);
  }

  function emptyScene(): Scene {
    const width = Math.max(0, size?.width ?? 0);
    const height = Math.max(0, size?.height ?? 0);
    return { width, height, clip: { x: 0, y: 0, width, height }, marks: [] };
  }

  /**
   * Lets the store release every revision no frame needs: the displayed snapshot keeps its own (a store can
   * only retire "everything up to a revision", so a displayed frame older than revisions that were accepted
   * since takes a copy of its rows once the store has grown past twice its last size), and a pending frame
   * that has not been drawn yet keeps its own. Runs after every accepted call and every published frame,
   * whether or not frames run (review 3, controller blockers 2 and 4).
   */
  function release(): void {
    const store = accepted?.store;
    if (!store) return;
    const needed: Frame[] = [];
    const owners = new Set<Frame>();
    if (onScreen && onScreen.store === store) owners.add(onScreen.frame);
    // The pending frame (accepted, not drawn yet) and the frame being published keep their rows too.
    owners.add(accepted!.frame);
    if (inflight && inflight.store === store) owners.add(inflight.frame);
    if (held) owners.add(held.frame);
    for (const f of owners) {
      if (f === store.frame || !storeFrames.has(f) || frozenRows.has(f)) continue;
      needed.push(f);
    }
    // Once the store holds more than twice what was on screen (plus a few rows), every frame that still pins
    // its history takes a copy of its own rows instead: one copy per frame, so the cost is amortized over the
    // rows that arrived, and `keep` bounds retention while paused too.
    if (needed.length && store.retainedRowCount > 2 * retainedBaseline + RETENTION_SLACK) {
      for (const f of needed) frozenRows.set(f, freeze(f).rows);
      needed.length = 0;
    }
    const floor = needed.length ? Math.min(...needed.map(f => f.revision)) : store.frame.revision;
    if (floor > 0) store.retire(floor - 1);
  }

  /** The displayed snapshot is now `frame` (or nothing): its rows are owned until the next one is drawn. */
  function showing(a: Accepted | null): void {
    if (destroyed) return;
    const frame = a?.frame ?? null;
    // Nothing on screen is one state, however often a hidden chart's frames say so (verification, defect 2).
    const changed = (onScreen?.frame ?? null) !== frame;
    onScreen = frame === null ? null : { frame, store: a!.store, frozen: null };
    release();
    // The baseline moves only when other data comes on screen: redrawing the same paused frame, or a frame
    // that could not be measured, does not let the store grow further (final review, finding 2).
    if (changed && frame !== null) retainedBaseline = accepted?.store?.retainedRowCount ?? 0;
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
    // Nothing on screen needs rows any more: the error revision has none.
    showing(null);
    lastLayout = null;
    themeDirty = true;
    sizeDirty = true;
    settle(a.revision);
  }

  /** Resolves the theme for these series keys and writes it (custom properties, scheme) on the figure. */
  function resolveTheme(keys: readonly string[], colors: unknown, key: readonly unknown[]): void {
    stage('theme');
    const resolution = host.theme(keys, object(colors) as Record<string, string>);
    theme = resolution;
    themeKey = key;
    // A detached chart gets the light defaults; it resolves again in the next frame that draws.
    themeDirty = resolution.resolved === false;
    themeRevision++;
    // When the backdrop could not be determined the background is a guess, so contrast is not judged.
    const low = resolution.backdropKnown === false ? [] : lowContrastSeries(resolution.theme).filter(i => i < keys.length);
    setPresentation('theme', low.length ? [createDiagnostic('AX141', 'none', { count: low.length }, 'presentation')] : []);
  }

  /**
   * The error revision on every layer, each step on its own (one that throws does not stop the others):
   * interaction off first, so no old lookup answers the pointer; then the message; then the mark and text
   * surfaces hidden by the host independently of their draw methods, which may be what failed; then their
   * contents cleared (review 3, controller blocker 3).
   */
  function showInternal(m: Messages, name: string, o: OptionRecord): void {
    const attempt = (step: () => void) => {
      try { step(); } catch { /* the next step still runs */ }
    };
    attempt(() => host.interaction.clear());
    attempt(() => host.figure.update({
      compact: isCompact(kind, o), title: titleOf(o), labelledBy: null, name,
      subtitle: null, summary: m.internalError, summaryVisible: false, note: null, message: m.internalError,
    }));
    attempt(() => {
      if (announced !== null && announced !== 'internal') host.figure.announce(m.internalError);
      announced = 'internal';
    });
    attempt(() => {
      host.surfaces?.(false);
      surfacesHidden = true;
    });
    attempt(() => host.text.render([]));
    attempt(() => { if (theme) host.renderer.draw(emptyScene(), theme.bindings, theme.theme, pixelRatio); hadMarks = false; });
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
        const i = pointIndex(series, ref, rowOf(frame, ref.row), d.accepted.resolved.values[0]?.field);
        if (i >= 0) y = series.y[i]!;
      }
    } else if (ref.kind === 'slice' && frame.shape === 'donut') {
      x = text.seriesLabel;
      const i = frame.labels.indexOf(text.seriesLabel);
      if (i >= 0 && frame.slot[i] === SLOT_VALUE) y = frame.values[i]!;
    }
    const rowAt = (row: number) => rowOf(frame, row);
    return { series: ref.kind === 'slice' ? ref.sliceKey : ref.seriesKey, x, y, row: text.row >= 0 ? rowAt(text.row) : null, index: text.row };
  }

  /** Calls the listeners with a snapshot taken before any runs; stops when one destroys or changes the chart. */
  /** Every listener subscribed when the event happened gets it, in order; nested events follow (finding 7). */
  function emit<E extends keyof ChartEvents<unknown>>(event: E, payload: ChartEvents<unknown>[E] | null): void {
    const set = listeners.get(event);
    if (!set || set.size === 0) return;
    const snapshot = [...set];
    enqueue(() => {
      for (const listener of snapshot) {
        if (destroyed) return;
        try {
          (listener as (p: unknown) => void)(payload);
        } catch (error) {
          host.console?.error('[axylo] event listener threw:', error);
        }
      }
    });
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
      // Nothing is built for a pointer move nobody listens to.
      if (!listeners.get('hover')?.size) return;
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
      // Back in the document: anything the page could have changed meanwhile is read again, the pixel ratio
      // and web fonts included (review 3, finding 19).
      themeDirty = true;
      textStyleDirty = true;
      sizeDirty = true;
      pixelRatio = host.devicePixelRatio();
      fontEpoch++;
      schedule();
    },
    theme() {
      if (destroyed) return;
      themeDirty = true;
      textStyleDirty = true;
      // The colours are resolved and written now, in the observer's callback, so the marks show the new
      // scheme in the first frame after the change (L4): their paint refers to the custom properties written
      // here. What is drawn as pixels (canvas) is repainted by the next frame, once, through the scheduler
      // (one draw per animation frame; review 3, finding 19). On a prefers-color-scheme change the SVG marks
      // switch in CSS in the frame of the change (light-dark() defaults), while the canvas renderer, which
      // paints concrete colours, is one frame behind: it repaints when the media query's change event
      // arrives, and AX141 is judged then. Only when what is on screen is also what is
      // accepted, so the colours written belong to the marks shown.
      const a = accepted;
      if (!inFrame && a && drawn && theme && drawn.accepted.view === a.view) {
        try {
          const keys = themeKeys(a.view);
          resolveTheme(keys, a.options.colors, [keys.join('\u0000'), a.options.colors]);
          if (!themeDirty) deliverChanges();
        } catch {
          themeDirty = true;
        }
      }
      schedule();
    },
    language() {
      if (destroyed) return;
      schedule();
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
    onScreen = null;
    frozenRows = new WeakMap();
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
      set.add(listener as (payload: never) => void);
      // Resolved through the chart's map, which destroy empties: a kept unsubscribe holds no one else.
      return () => { listeners.get(event)?.delete(listener as (payload: never) => void); };
    },
    get diagnostics() {
      return currentDiagnostics();
    },
    destroy,
  };

  if (__DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__)) {
    attachHooks(handle, {
      stages: stages!,
      revision: () => accepted?.revision ?? 0,
      ready() {
        const revision = accepted?.revision ?? 0;
        if (destroyed || (settledRevision >= revision && !frameScheduled)) return Promise.resolve();
        return new Promise<void>(resolve => waiters.push({ revision, resolve }));
      },
      shown: () => drawn && {
        view: drawn.accepted.view, layout: drawn.layout, pixelRatio, scene: drawn.scene,
        streaming: drawn.accepted.store !== null, table: drawn.accepted.source.table,
      },
      renderer: () => host.renderer.kind,
      retainedRows: () => accepted?.store?.retainedRowCount ?? 0,
      store: () => accepted?.store ?? null,
      frames() {
        const live = new Set<Frame>();
        for (const f of [onScreen?.frame, drawn?.accepted.frame, accepted?.frame, held?.frame, inflight?.frame]) if (f) live.add(f);
        return [...live];
      },
    });
  }
  return { handle, actions, invalidate, flush };
}

/** Options of a chart that streams from its own store: without the caller's opening data. */
function streamOptions(o: OptionRecord): OptionRecord {
  if (o.data === undefined) return o;
  const { data: _data, ...rest } = o;
  void _data;
  return rest;
}

/** The same frame with the names and units the resolved fields now give (no value is read again). */
function renamed(frame: Frame, resolved: ResolvedOptions, revision: number): Frame {
  const value = resolved.values[0];
  if (frame.shape === 'donut') return { ...frame, revision, valueLabel: value?.label ?? frame.valueLabel, unit: value?.unit ?? null };
  if (frame.shape === 'points') {
    return { ...frame, revision, xLabel: resolved.x.label, yLabel: value?.label ?? frame.yLabel, xUnit: resolved.x.unit, yUnit: value?.unit ?? null };
  }
  const byField = new Map(resolved.values.map(v => [v.field, v]));
  return {
    ...frame, revision, xLabel: resolved.x.label, yLabel: resolved.values.length === 1 ? value!.label : null,
    series: frame.series.map(s => {
      const v = byField.get(s.field) ?? value;
      if (!v) return s;
      // Named by its field (wide form, or one series without a series field), else by its series value.
      return { ...s, unit: v.unit, label: resolved.form === 'wide' || resolved.series === null ? v.label : s.label };
    }),
  };
}

const pointDateUnits = new WeakMap<Frame, 'day' | 'month' | 'year'>();

/**
 * The precision calendar dates were written in on a scatter frame, the finest if mixed ("2024-02" is a month;
 * spec F4). The point frame has no field for it (contracts: only the aligned x column does), so it is read
 * from the caller's rows of the frame, once per frame, through the accessor hover uses (`rowOf`): a frame
 * that kept its own copy after the store moved on reads that copy (verification, defect 5).
 */
function pointDateUnit(
  frame: Extract<Frame, { shape: 'points' }>, field: string, rowAt: (frame: Frame, row: number) => unknown,
): 'day' | 'month' | 'year' | null {
  if (frame.xKind !== 'date') return null;
  const known = pointDateUnits.get(frame);
  if (known) return known;
  let unit: 'day' | 'month' | 'year' = 'year';
  outer: for (const s of frame.series) {
    for (let i = 0; i < s.x.length; i++) {
      const row = rowAt(frame, s.row ? s.row[i]! : i);
      const raw = row !== null && typeof row === 'object' ? (row as Record<string, unknown>)[field] : undefined;
      const u = dateUnitOf(raw);
      if (u === 'day') { unit = 'day'; break outer; }
      if (u === 'month') unit = 'month';
    }
  }
  pointDateUnits.set(frame, unit);
  return unit;
}

function sameStyle(a: TextStyle, b: TextStyle): boolean {
  return a.font === b.font && a.letterSpacing === b.letterSpacing && a.wordSpacing === b.wordSpacing && a.lineHeight === b.lineHeight;
}

/**
 * Where a point datum is in its series. Points are sorted by x, then y: the caller's own row says which y to
 * look for, so the datum is found by two binary searches and a check of its row, without reading the rows of
 * every point that shares its x (verification, defect 7). The row only guides the search: when it does not
 * lead to the datum (a value the frame read differently), the points at that x are walked.
 */
function pointIndex(series: PointSeries, ref: Extract<DatumRef, { kind: 'point' }>, row: unknown, field: string | undefined): number {
  const rows = series.row;
  const n = series.x.length;
  if (!rows) return ref.row >= 0 && ref.row < n ? ref.row : -1;
  const start = lowerBound(series.x, ref.x);
  const end = upperBound(series.x, ref.x, start);
  const raw = field !== undefined && row !== null && typeof row === 'object' ? (row as Record<string, unknown>)[field] : undefined;
  // A null or absent value is a point only when imputed as zero (missing: 'zero').
  const guess = typeof raw === 'number' ? raw : raw === null || raw === undefined ? 0 : NaN;
  if (!Number.isNaN(guess)) {
    for (let i = lowerBound(series.y, guess, start, end); i < end && series.y[i] === guess; i++) if (rows[i] === ref.row) return i;
  }
  for (let i = start; i < end; i++) if (rows[i] === ref.row) return i;
  return -1;
}

/** A frame's source that is a whole table (a static frame over the caller's data). */
function isTable(source: unknown): source is Table {
  const t = source as Partial<Table>;
  return typeof t.isColumnRow === 'function' && typeof t.rowIndex === 'function' && typeof t.length === 'number';
}

/** The index of `x` in sorted `values`, or -1. */
function indexOf(values: Float64Array, x: number): number {
  const at = lowerBound(values, x);
  return values[at] === x ? at : -1;
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
  // A bar with no value is still drawn: its "no data" glyph at the baseline (spec F2; finding 18).
  const drawable = (state: number) => state === SLOT_VALUE || (view.kind === 'bar' && state !== SLOT_NO_ROW);
  return view.frame.series.some((s, i) => {
    if (!shown(i)) return false;
    const { start, end } = view.drawSlots[i] ?? view.visibleSlots;
    for (let j = start; j < end; j++) if (drawable(s.slot[j]!)) return true;
    return false;
  });
}

export type { DiagnosticCode };
