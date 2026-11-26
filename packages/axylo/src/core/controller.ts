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
  type TextStyle, type TooltipModel, type View, type XKind,
} from './contracts';
import type { ChartEvents, Diagnostic, Messages, Point, Title, XValue } from '../public';
import type { PreparedFrame } from '../data';
import { resolveFields, withoutTable, type ChartType, type ResolvedOptions } from '../data/options';
import { createDiagnostic, DiagnosticCollector, readerDisclosure, type DiagnosticCode } from '../diagnostics';
import { createFormattersWith, type FormatSpec } from '../format';
import { dateUnitOf } from '../data/x';
import { rowsTable, type Table } from '../data/table';
import { readerWith, seriesNotDrawnSentence } from '../reader';
import { chartTypeName, fill, resolveMessages } from '../messages';
import { lowContrastSeries, type ThemeResolution } from '../theme';
import { OptionsStore, sameValue, type OptionRecord } from './options';
import { Delivery, diagnosticKey, StrictError, strictViolations, type DeliveryConsole } from './delivery';
import type { AxisContext } from './axes';
import { zoomApplies } from './focus';
import {
  completeViewDiagnostics, dedupe, encodingChanged, isCompact, namesOnlyChanged, namingDiagnostics, object, publicOptions, stringOption,
  titleOf, toPublic, viewKeyFor, viewStateFor, type Span,
} from './stages';
import type { FigureModel } from '../dom/figure';
import type { Committed, ControlsState } from '../dom/interaction';
import { sameKey, type Composition, type Store } from './composition';
import { sameTextStyle } from './environment';
import { attachHooks, StageCounter, type ChartHandle, type Probe, type Stage } from './instrument';
import { COMPOSITIONS } from '../kinds';
import { reviseSeries, seriesSlots, slotState } from '../data/store-statistics';

export type ChartKind = ChartType;

/** Thrown inside a frame to stop it before anything was written (see `frame`). */
const ABORT = Symbol('axylo frame superseded');

export type { BenchHook, ChartHandle, DevHook, Stage } from './instrument';

/** Option resolution reports these about the data; they belong to the call that set the data. */
const DATA_CODES = new Set(['AX100', 'AX101']);
/** Rows a store may hold beyond twice what was on screen before the frames that pin it copy their rows. */
const RETENTION_SLACK = 8;
/**
 * Positions of the reader's inputs the summary does not read: the title, the labelledBy id and the caption
 * name the chart, and the count of hidden labels is said by the note only (reader/index.ts).
 */
const NAMING_INPUTS = new Set([3, 4, 9, 13]);

/**
 * Reader inputs equal apart from the naming ones (sameKey's rule, without filtered copies). The view comes
 * first: a streaming frame has a new one, and the comparison ends there.
 */
function sameReading(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length || !Object.is(a[0], b[0])) return false;
  for (let i = 1; i < a.length; i++) {
    if (NAMING_INPUTS.has(i)) continue;
    const x = a[i];
    const y = b[i];
    if (Object.is(x, y)) continue;
    if (Array.isArray(x) && Array.isArray(y) && x.length === y.length && x.every((v, k) => v === y[k])) continue;
    return false;
  }
  return true;
}

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
/** Shared neutral text style used for compact charts, which never lay out text labels. */
const COMPACT_TEXT_STYLE: TextStyle = { font: '', letterSpacing: 0, wordSpacing: 0, lineHeight: 0 };
/** Shared empty collections and singletons to avoid per-chart and per-frame allocations on clean/compact charts. */
const EMPTY_DIAGNOSTICS: readonly DiagnosticInput[] = [];
const EMPTY_HIDDEN: ReadonlySet<string> = new Set();
const EMPTY_DISCLOSURE: { readonly omitted: number; readonly changed: number } = { omitted: 0, changed: 0 };
const EMPTY_APPEND_OPTIONS: { keep?: number } = {};
const EMPTY_REFS: readonly DatumRef[] = [];
const EMPTY_TOOLTIP: TooltipModel = { title: '', rows: [], count: 0, total: null };
const INHERIT_LANGUAGE = (): null => null;
const EMPTY_LOOKUP: Lookup = {
  count: 0,
  pick: () => null,
  members: () => EMPTY_REFS,
  has: () => false,
  slot: () => -1,
  tooltip: () => EMPTY_TOOLTIP,
  primary: () => null,
  datum: () => null,
  anchor: () => null,
  ordinal: () => 0,
  step: () => null,
  resolve: () => null,
};

function lazyLookup(
  composition: Composition, view: View, layout: Layout, formatters: Formatters, messages: Messages,
  locale: string, pixelRatio: number,
): () => Lookup {
  let lookup: Lookup | null = null;
  return () => lookup ??= composition.lookup(view, layout, formatters, messages, locale, pixelRatio);
}

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
  /** Optional microtask scheduler (browser host only) for 1-frame zoom flushes. */
  scheduleMicrotask?(callback: () => void): void;
  /**
   * `pageLang`, when given, is what `pageLang()` just returned for this frame: the host need not read the
   * page's language a second time to resolve the locale from it.
   */
  locale(option: unknown, pageLang?: string | null): string;
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
  /** Optional phased strip-height probe hooks used during multi-chart rAF batching. */
  stripProbeMount?(): unknown;
  stripProbeRead?(probe: unknown): number;
  stripProbeRemove?(probe: unknown): void;
  devicePixelRatio(): number;
  theme(seriesKeys: readonly string[], colors: Record<string, string>): ThemeResolution;
  /** Optional phased theme resolution hooks used during multi-chart rAF batching. */
  themePrepare?(seriesKeys: readonly string[], colors: Record<string, string>): unknown;
  themeApply?(prepared: unknown): void;
  themeFinish?(prepared: unknown, deferProbe?: boolean): ThemeResolution | null;
  /** Report whether a late probe changed live theme properties. Hosts that omit the report are remeasured. */
  themeProbe?(prepared: unknown, layoutChanged: (changed: boolean) => void): ThemeResolution;
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

/** Phased execution handle for one frame, allowing a browser host to batch reads and writes across charts. */
export interface FrameRun {
  phase1(): void;
  phase2(): void;
  phase3Theme(): void;
  phase3Measure(): void;
  phase3Probe(): void;
  phase3LayoutCheck(): boolean;
  phase3StripMount(): void;
  phase3StripRead(): void;
  phase3StripRemove(): void;
  phase3ReadoutDecide(): void;
  phase4StripWrite(): void;
  phase4StripMeasure(): void;
  phase4Init(): void;
  phase4PassWrite(): boolean;
  /** Returns true when a chart restored from fallback needs the readout check again. */
  phase4PassMeasure(): boolean | void;
  phase5(): void;
  after(): void;
}

export interface Controller {
  readonly handle: ChartHandle;
  readonly actions: ControllerActions;
  readonly invalidate: Invalidate;
  /** Runs the pending frame now (tests, and theme changes that arrive inside a frame). */
  flush(): void;
  /** Starts a phased frame for multi-chart batching; null when nothing can run. */
  beginFrame(): FrameRun | null;
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

const READY: Display = { kind: 'ready' };

interface PlotLayout {
  readonly layout: Layout;
  readonly key: readonly unknown[] | null;
  readonly width: number;
  readonly height: number;
  /** A reserved strip can leave the size unchanged (for example on an auto-height tile). */
  readonly strip: number | null;
}

function sameLayoutSize(layout: PlotLayout | null | undefined, width: number, height: number, strip: number | null): layout is PlotLayout {
  return !!layout && Object.is(layout.width, width) && Object.is(layout.height, height) && layout.strip === strip;
}

type Disclosure = { readonly omitted: number; readonly changed: number };
interface ReaderEntry { readonly reader: ReaderModel; readonly inputs: readonly unknown[] }

/** Steps of a frame, dispatched by the controller's one step function (no closure per step or per frame). */
const STEP_PHASE1 = 0;
const STEP_PHASE2 = 1;
const STEP_THEME = 2;
const STEP_MEASURE = 3;
const STEP_PROBE = 4;
const STEP_LAYOUT_CHECK = 5;
const STEP_STRIP_MOUNT = 6;
const STEP_STRIP_READ = 7;
const STEP_READOUT = 8;
const STEP_STRIP_WRITE = 9;
const STEP_STRIP_MEASURE = 10;
const STEP_INIT = 11;
const STEP_PASS_WRITE = 12;
const STEP_PASS_MEASURE = 13;
const STEP_PUBLISH = 14;

/** How many inputs the reader model is keyed by (readerFor). */
const READER_INPUTS = 14;
const EMPTY_KEY: readonly unknown[] = [];
/** Not global and not sticky, so `test` keeps no state between pages. */
const ENGLISH_TAG = /^en(?:-|$)/i;
/** englishFor on a page in another language with no message overrides: every built-in text is English. */
const ALL_ENGLISH = (): string => 'en';

/** What a frame's steps reach in their controller: made once per chart. */
interface FrameDriver {
  frameStep(f: FrameState, id: number): boolean;
  removeStripProbe(f: FrameState): void;
  finishFrame(f: FrameState): void;
  afterFrame(f: FrameState): void;
}

/** The hidden tick labels of a plot layout (x and y), 0 for anything else. */
function hiddenIn(l: Layout | undefined): number {
  return l?.kind === 'plot' ? l.fit.x.hidden + l.fit.y.hidden : 0;
}

function sameDisclosure(a: Disclosure, b: Disclosure): boolean {
  return a.omitted === b.omitted && a.changed === b.changed;
}

/** One position of sameKey's rule: the same value, or arrays with the same entries. */
function sameEntry(x: unknown, y: unknown): boolean {
  if (Object.is(x, y)) return true;
  return Array.isArray(x) && Array.isArray(y) && x.length === y.length && x.every((v, k) => v === y[k]);
}

/** The strip reserved under the plot at this size, null when no strip is reserved. */
function reservedStrip(at: Size, strip: boolean): number | null {
  return strip ? (at.room ? Math.max(0, at.room.height - at.height) : 0) : null;
}

/** The readout steps of a single-chart frame, in the order the batch runs them across charts. */
function readoutSteps(run: FrameRun): void {
  if (run.phase3LayoutCheck()) {
    run.phase3StripMount();
    try {
      run.phase3StripRead();
    } finally {
      run.phase3StripRemove();
    }
  }
  run.phase3ReadoutDecide();
  run.phase4StripWrite();
  run.phase4StripMeasure();
  run.phase4Init();
}

/**
 * One frame's state and its phased handle. Finished states go back to a small pool shared by every chart
 * (acquireFrame, releaseFrame), so a steady stream of frames allocates no closures and no scope, and a chart
 * that is not drawing keeps none; the fields are what each frame started from before (see `begin`). Every
 * field is set in the constructor, so the shape never changes.
 */
class FrameState implements FrameRun {
  /** The controller running this frame; null once the state is back in the pool, so a stale handle does nothing. */
  driver: FrameDriver | null;
  /** True until a frame begins and again once its `after` step has run: only an idle state is reused. */
  idle = true;
  closed = true;
  a: Accepted | null = null;
  view: View = null!;
  compact = false;
  stateDiag: readonly DiagnosticInput[] = EMPTY_DIAGNOSTICS;
  zoomOn: ControlsState['zoom'] = false;
  zoomed = false;
  legend: ControlsState['legend'] = 'bottom';
  /** The strip-height probe while it is in the figure (mounted early or after the measure). */
  stripProbe: unknown = null;
  mutated = false;
  style: TextStyle = COMPACT_TEXT_STYLE;
  layoutEpoch = 0;
  locale = '';
  shown: Display = READY;
  noteShown = false;
  lang: string | null = null;
  fKey: readonly unknown[] = EMPTY_KEY;
  formatters: Formatters = null!;
  byText: string | null = null;
  named = false;
  by: string | null = null;
  title: ReturnType<typeof titleOf> = null;
  caption: string | undefined = undefined;
  english: (key: keyof Messages) => string | null = INHERIT_LANGUAGE;
  foreignPage = false;
  axisContext: AxisContext = null!;
  reader: ReaderModel = null!;
  readerInputs: readonly unknown[] = EMPTY_KEY;
  keys: string[] | null = null;
  needsTheme = false;
  preparedTheme: unknown = null;
  needsThemeProbe = false;
  tooSmall = false;
  arrangedReader: ReaderModel | null = null;
  arrangedSmall = false;
  arrangedHidden = 0;
  arrangedDisclosure: Disclosure = EMPTY_DISCLOSURE;
  arrangedStrip: boolean | undefined = undefined;
  needMeasure = false;
  withoutLayout: PlotLayout | null = null;
  readoutPending = true;
  narrowPlotHeight: number | null = null;
  needsStripProbe = false;
  stripAction: 'strip-arrange' | 'prepare-only' | null = null;
  result: PlotLayout | null = null;
  layoutDone = true;
  passAction: 'drop-strip' | 'enter-fallback' | 'leave-fallback' | 'note-moved' | null = null;
  normalSize: Size | null = null;
  /** Phase 2 found a ready compact plot: no readout strip and no L8 fallback. */
  noReadout = false;
  discVer = -1;
  discCache: Disclosure = EMPTY_DISCLOSURE;
  lastReader: ReaderEntry | null = null;
  currentHidden = 0;
  settled: ReaderEntry | null = null;
  settledHidden = 0;
  settledDisclosure: Disclosure = EMPTY_DISCLOSURE;

  constructor(driver: FrameDriver) {
    this.driver = driver;
  }

  /** Starts a frame for `a`: every field as a new frame starts it. */
  begin(
    a: Accepted, compact: boolean, stateDiag: readonly DiagnosticInput[], zoomOn: ControlsState['zoom'], zoomed: boolean,
    legend: ControlsState['legend'],
  ): void {
    this.idle = false;
    this.closed = false;
    this.a = a;
    this.view = a.view;
    this.compact = compact;
    this.stateDiag = stateDiag;
    this.zoomOn = zoomOn;
    this.zoomed = zoomed;
    this.legend = legend;
    this.stripProbe = null;
    this.mutated = false;
    this.style = COMPACT_TEXT_STYLE;
    this.layoutEpoch = 0;
    this.locale = '';
    this.shown = READY;
    this.noteShown = false;
    this.lang = null;
    this.fKey = EMPTY_KEY;
    this.formatters = null!;
    this.byText = null;
    this.named = false;
    this.by = null;
    this.title = null;
    this.caption = undefined;
    this.english = INHERIT_LANGUAGE;
    this.foreignPage = false;
    this.axisContext = null!;
    this.reader = null!;
    this.readerInputs = EMPTY_KEY;
    this.keys = null;
    this.needsTheme = false;
    this.preparedTheme = null;
    this.needsThemeProbe = false;
    this.tooSmall = false;
    this.arrangedReader = null;
    this.arrangedSmall = false;
    this.arrangedHidden = 0;
    this.arrangedDisclosure = EMPTY_DISCLOSURE;
    this.arrangedStrip = undefined;
    this.needMeasure = false;
    this.withoutLayout = null;
    this.readoutPending = true;
    this.narrowPlotHeight = null;
    this.needsStripProbe = false;
    this.stripAction = null;
    this.result = null;
    this.layoutDone = true;
    this.passAction = null;
    this.normalSize = null;
    this.noReadout = false;
    this.discVer = -1;
    this.discCache = EMPTY_DISCLOSURE;
    this.lastReader = null;
    this.currentHidden = 0;
    this.settled = null;
    this.settledHidden = 0;
    this.settledDisclosure = EMPTY_DISCLOSURE;
  }

  /** Lets go of everything the finished frame referenced: a pooled state holds no controller, revision, view or reader. */
  clear(): void {
    this.idle = true;
    this.driver = null;
    this.a = null;
    this.view = null!;
    this.stateDiag = EMPTY_DIAGNOSTICS;
    this.style = COMPACT_TEXT_STYLE;
    this.shown = READY;
    this.fKey = EMPTY_KEY;
    this.formatters = null!;
    this.title = null;
    this.english = INHERIT_LANGUAGE;
    this.axisContext = null!;
    this.reader = null!;
    this.readerInputs = EMPTY_KEY;
    this.keys = null;
    this.preparedTheme = null;
    this.arrangedReader = null;
    this.withoutLayout = null;
    this.result = null;
    this.normalSize = null;
    this.lastReader = null;
    this.settled = null;
  }

  /** Only once phase 2 completed for this frame (a failure closes the frame, and the skipped steps would have done nothing either way). */
  stripless(): boolean { return this.noReadout && !this.closed; }
  phase1(): void { this.driver?.frameStep(this, STEP_PHASE1); }
  phase2(): void { this.driver?.frameStep(this, STEP_PHASE2); }
  phase3Theme(): void { this.driver?.frameStep(this, STEP_THEME); }
  phase3Measure(): void { this.driver?.frameStep(this, STEP_MEASURE); }
  phase3Probe(): void { this.driver?.frameStep(this, STEP_PROBE); }
  phase3LayoutCheck(): boolean { return this.driver?.frameStep(this, STEP_LAYOUT_CHECK) ?? false; }
  phase3StripMount(): void { this.driver?.frameStep(this, STEP_STRIP_MOUNT); }
  phase3StripRead(): void { this.driver?.frameStep(this, STEP_STRIP_READ); }
  /** Unconditional, even on error or after the frame closed. */
  phase3StripRemove(): void { this.driver?.removeStripProbe(this); }
  phase3ReadoutDecide(): void { this.driver?.frameStep(this, STEP_READOUT); }
  phase4StripWrite(): void { this.driver?.frameStep(this, STEP_STRIP_WRITE); }
  phase4StripMeasure(): void { this.driver?.frameStep(this, STEP_STRIP_MEASURE); }
  phase4Init(): void { this.driver?.frameStep(this, STEP_INIT); }
  phase4PassWrite(): boolean { return this.driver?.frameStep(this, STEP_PASS_WRITE) ?? false; }
  phase4PassMeasure(): boolean { return this.driver?.frameStep(this, STEP_PASS_MEASURE) ?? false; }
  phase5(): void { this.driver?.finishFrame(this); }
  after(): void { this.driver?.afterFrame(this); }
}

/**
 * Single-use handle around a pooled FrameState for external phased callers (`beginFrame()`).
 * Becomes permanently inert once `after()` returns the backing state to the pool, so a stale
 * handle can never reach another chart that later acquires the same FrameState.
 */
class FrameHandle implements FrameRun {
  #state: FrameState | null;
  constructor(state: FrameState) { this.#state = state; }
  phase1(): void { this.#state?.phase1(); }
  phase2(): void { this.#state?.phase2(); }
  phase3Theme(): void { this.#state?.phase3Theme(); }
  phase3Measure(): void { this.#state?.phase3Measure(); }
  phase3Probe(): void { this.#state?.phase3Probe(); }
  phase3LayoutCheck(): boolean { return this.#state?.phase3LayoutCheck() ?? false; }
  phase3StripMount(): void { this.#state?.phase3StripMount(); }
  phase3StripRead(): void { this.#state?.phase3StripRead(); }
  phase3StripRemove(): void { this.#state?.phase3StripRemove(); }
  phase3ReadoutDecide(): void { this.#state?.phase3ReadoutDecide(); }
  phase4StripWrite(): void { this.#state?.phase4StripWrite(); }
  phase4StripMeasure(): void { this.#state?.phase4StripMeasure(); }
  phase4Init(): void { this.#state?.phase4Init(); }
  phase4PassWrite(): boolean { return this.#state?.phase4PassWrite() ?? false; }
  phase4PassMeasure(): boolean { return this.#state?.phase4PassMeasure() ?? false; }
  phase5(): void { this.#state?.phase5(); }
  after(): void {
    const s = this.#state;
    if (!s) return;
    this.#state = null;
    s.after();
  }
}

/**
 * Idle frame states shared by every chart. Frames run synchronously (flush, or one phased batch that ends
 * every frame it began), so a single chart or a batch of up to this many reuses states and allocates none,
 * while a page of static charts retains at most this many in all rather than one per chart.
 */
const FRAME_POOL_SIZE = 4;
/** Made on the first release, so importing the module allocates nothing. */
let framePool: FrameState[] | null = null;

function acquireFrame(driver: FrameDriver): FrameState {
  const f = framePool?.pop() ?? new FrameState(driver);
  f.driver = driver;
  return f;
}

/** Clears the finished state and keeps it if the pool has room; nothing else may use the state afterwards. */
function releaseFrame(f: FrameState): void {
  f.clear();
  const pool = framePool ??= [];
  if (pool.length < FRAME_POOL_SIZE) pool.push(f);
}

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
function joinedDiagnostics(a: readonly DiagnosticInput[], b: readonly DiagnosticInput[]): readonly DiagnosticInput[] {
  return a.length === 0 ? b : b.length === 0 ? a : [...a, ...b];
}

/**
 * What a destroyed controller holds instead of its host, so a handle kept by the page retains no DOM. One
 * object per destroyed chart: it is its own renderer, text layer, figure, interaction layer and measurer.
 */
class DeadHost implements Host {
  readonly console = null;
  readonly timeZone = 'UTC';
  constructor(readonly id: string, readonly kind: Host['renderer']['kind']) {}
  get page(): object { return this; }
  get renderer(): Host['renderer'] { return this; }
  get text(): Host['text'] { return this; }
  get figure(): Host['figure'] { return this; }
  get interaction(): Host['interaction'] { return this; }
  get measurer(): TextMeasurer { return this; }
  draw(): void {}
  render(): void {}
  update(): boolean { return false; }
  announce(): void {}
  prepare(): boolean { return false; }
  commit(): void {}
  clear(): void {}
  width(): number { return 0; }
  requestFrame(): number { return 0; }
  cancelFrame(): void {}
  locale(): string { return 'en'; }
  pageLang(): null { return null; }
  labelText(): null { return null; }
  textStyle(): TextStyle { return { font: '', letterSpacing: 0, wordSpacing: 0, lineHeight: 0 }; }
  measure(): Size { return { width: 0, height: 0 }; }
  devicePixelRatio(): number { return 1; }
  theme(): ThemeResolution { throw new Error('Axylo: the chart was destroyed.'); }
  dispose(): void {}
}

/** The built-in texts, resolved once for every chart that overrides none: resolved messages are only read. */
let builtInMessages: Messages | null = null;

function messagesOf(option: unknown): Messages {
  if (option === null || typeof option !== 'object') return builtInMessages ??= resolveMessages(null);
  return resolveMessages(option as Partial<Messages>);
}

/** The controller for a kind given by name (tests and Node hosts); the chart functions pass their composition. */
export function createController(kind: ChartKind, input: unknown, page: Host): Controller {
  return controllerFor(COMPOSITIONS[kind], input, page);
}

/** The controller for one chart kind: every stage that differs between kinds comes from its composition. */
export function controllerFor(composition: Composition, input: unknown, page: Host): Controller {
  return new ChartController(composition, input, page);
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

/** While paused: the store's newest frame and its findings, accepted but not shown. */
type Held = { frame: Frame; dataDiagnostics: readonly DiagnosticInput[]; viewDiagnostics: readonly DiagnosticInput[] } | null;

interface Drawn {
  accepted: Accepted;
  formatters: Formatters;
  formattersKey: readonly unknown[];
  locale: string;
  style: TextStyle;
  fontEpoch: number;
  pixelRatio: number;
  layout: Layout;
  plotLayout: PlotLayout | null;
  scene: Scene;
  lookup: Lookup;
  reader: ReaderModel;
  readerInputs: readonly unknown[];
  paintedTheme: number | null;
}

/**
 * One chart's controller. Its state is fields and its stages are methods, shared by every chart through the
 * prototype: a page of charts holds one small object per chart rather than a scope and a function per stage
 * each. Every field is set in the constructor, in one order, so all charts share one shape.
 */
class ChartController implements Controller, FrameDriver {
  readonly #composition: Composition;
  readonly #kind: ChartType;
  host: Host;
  // Instrumentation (core/instrument.ts): only in development and benchmark builds; the guard folds to false in
  // the shipped production files, which then carry neither the counters nor the hooks.
  readonly stages: StageCounter | null;
  /** Printing and author notification: made when the chart first has something to deliver (most never do). */
  #deliveryMade: Delivery | null;
  // Preserve a stable viewer zone once needed, without asking Intl for charts with an explicit zone.
  #viewerZone: string | undefined;
  // ── synchronous phase ──────────────────────────────────────────────────────────────────────────
  #options: OptionsStore;
  #accepted: Accepted | null;
  // Read through getters by the same-file wrappers below, so the many uses inside the class stay private (mangled).
  get accepted(): Accepted | null { return this.#accepted; }
  #presentation: Map<PresentationStage, readonly DiagnosticInput[]> | null;
  /** Keys of the current diagnostics already printed and handed to `onDiagnostic`. */
  #deliveredKeys: Set<string> | null;
  /** The finding list whose keys `deliveredKeys` holds after the last full delivery pass (see deliverChanges). */
  #settledInputs: readonly DiagnosticInput[] | null;
  /** Increases with every delivery pass; a pass started inside author code supersedes the outer one. */
  #destroyed: boolean;
  get destroyed(): boolean { return this.#destroyed; }
  #internalError: unknown;
  /** `append` was called at least once: the pause control is offered (spec I6). */
  #streaming: boolean;
  #paused: boolean;
  /** While paused: the store's newest frame and its findings, accepted but not shown. */
  held: Held;
  /**
   * The displayed snapshot's row ownership: what the marks on screen came from (see the invariants at the top
   * of this file). `frozen` holds the caller's rows of that frame once the store had to let go of its revision.
   */
  onScreen: { frame: Frame; store: Store | null; frozen: Map<number, unknown> | null } | null;
  /** Frames a store produced (their rows live in that store's revisions). Lazily allocated when streaming starts. */
  #storeFrames: WeakSet<Frame> | null;
  /**
   * Rows copied out of the store for a frame that still needs them after the store moved on: the displayed
   * frame, the pending (accepted, not yet drawn) one and the one being published each own theirs, so none of
   * them pins the store's history (final review, finding 2).
   */
  #frozenRows: WeakMap<Frame, Map<number, unknown>> | null;
  /**
   * One past the last source index each store frame can address: a store numbers rows in arrival order (the
   * opening data first), so a frame's raw window can be read back without the store (re-encoding while paused).
   */
  #rowEnds: WeakMap<Frame, number> | null;
  /** Rows of a store below this source index came from the caller's typed columns (its opening data). */
  #columnRows: WeakMap<Store, number> | null;
  /** The wider x domain the layout drew a scatter's automatic domain on, with the domain it widened. */
  #widenedX: { epoch: number; drawn: readonly [number, number] } | null;
  /** What the store held right after the last release with a frame on screen: the bound's baseline. */
  #retainedBaseline: number;
  /** The revision on screen when the baseline was taken (a number: a hidden chart keeps no frame alive). */
  #baselineRevision: number;
  #epochs: number;
  #frameRevision: number;
  #commits: number;
  listeners: Map<keyof ChartEvents<unknown>, Set<(payload: never) => void>> | null;
  /** True while a frame runs: findings are delivered at its end, not from inside a stage. */
  inFrame: boolean;
  /** The accepted state a running frame publishes: its rows are kept until it is on screen. */
  inflight: Accepted | null;
  /**
   * Notifications to author code (onDiagnostic, the console, event listeners) in call order: each delivery
   * is a snapshot taken when it is made and is drained in full, and one made by author code during a drain
   * waits behind it. Only destruction stops a drain (review 3, finding 7).
   */
  #notifications: (() => void)[] | null;
  #draining: boolean;
  #presentationVersion: number;
  /** Resolutions this chart already let go of the caller's table: a later append keeps them as they are. */
  #tableless: WeakSet<ResolvedOptions> | null;
  // ── frame phase ────────────────────────────────────────────────────────────────────────────────
  #frameRequest: number;
  #frameScheduled: boolean;
  get frameScheduled(): boolean { return this.#frameScheduled; }
  #microtaskToken: number;
  #size: Size | null;
  sizeDirty: boolean;
  /** The readout strip is reserved under the plot (decision 0004 revision 2, rule 5). */
  #readoutMode: boolean;
  /** The strip's height as last measured (two 24 px lines until then). */
  #stripHeight: number;
  /** The text style the strip's height was measured for; null after resize or font changes. */
  #stripStyle: TextStyle | null;
  #stripFontEpoch: number;
  /** Decision 0004 revision 3, rule 5: how a datum's values are shown when pointed at. */
  #readoutKind: ReadoutMode;
  /** L8 fallback: what the fallback's own DOM adds to the plot size, measured when it was entered. */
  #fallback: { width: number; height: number } | null;
  #textStyle: TextStyle | null;
  textStyleDirty: boolean;
  fontEpoch: number;
  pixelRatio: number;
  themeDirty: boolean;
  #themeSeries: readonly string[] | null;
  #themeColors: unknown;
  theme: { bindings: PaintBindings; theme: ResolvedTheme } | null;
  #themeRevision: number;
  /** The display state last shown, for announcing changes once (spec L7). */
  #announced: Display['kind'] | null;
  /** The accepted revision the page last settled on (drawn, or its error shown). */
  settledRevision: number;
  drawn: Drawn | null;
  #fitKey: {
    small: boolean; dense: boolean; hidden: number; field: string;
    xKind: XKind | undefined; horizontal: boolean | undefined; kind: View['kind'];
  } | null;
  /** The last layout computed, also at a size that was only an estimate (the L8 fallback). */
  #lastLayout: PlotLayout | null;
  /** Marks were drawn at some point (cleared marks after a failure count): a later empty frame must clear them. */
  #hadMarks: boolean;
  /** The host hid the mark and text surfaces for an error revision; the next drawn frame shows them again. */
  #surfacesHidden: boolean;
  waiters: { revision: number; resolve: () => void }[] | null;
  /** The axis context of the last frame: kept while what it holds is unchanged. */
  #lastAxisContext: AxisContext | null;
  /** The English marking of the last frame on a page in another language, by the messages option it read. */
  #englishMemo: { readonly source: unknown; readonly english: (key: keyof Messages) => string | null } | null;
  /** What the late theme probe reported, written by one callback made once per chart. */
  #probeWrote: boolean;
  /** The interaction layer's and the page watchers' ways in, made when first asked for (a sparkline has no interaction layer). */
  #actionsMade: ChartActions | null;
  #invalidateMade: ChartInvalidate | null;
  /** Callbacks the host keeps (the frame request, the formatters' error report, the late theme probe), each made once when first needed. */
  #frameCallback: ((time?: number) => void) | null;
  #formatterError: ((field: string) => void) | null;
  #probeReport: ((wrote: boolean) => void) | null;
  readonly handle: ChartHandle;

  constructor(composition: Composition, input: unknown, page: Host) {
    this.#composition = composition;
    this.#kind = composition.kind;
    this.host = page;
    this.stages = __DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__) ? new StageCounter() : null;
    // Development and benchmark builds make it now: making one installs their delivery hook.
    this.#deliveryMade = __DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__) ? this.#newDelivery() : null;
    this.#options = new OptionsStore(input);
    this.#accepted = null;
    this.#presentation = null;
    this.#deliveredKeys = null;
    this.#settledInputs = null;
    this.#destroyed = false;
    this.#internalError = null;
    this.#streaming = false;
    this.#paused = false;
    this.held = null;
    this.onScreen = null;
    this.#storeFrames = null;
    this.#frozenRows = null;
    this.#rowEnds = null;
    this.#columnRows = null;
    this.#widenedX = null;
    this.#retainedBaseline = 0;
    this.#baselineRevision = -1;
    this.#epochs = 0;
    this.#frameRevision = 0;
    this.#commits = 0;
    this.listeners = null;
    this.inFrame = false;
    this.inflight = null;
    this.#notifications = null;
    this.#draining = false;
    this.#presentationVersion = 0;
    this.#tableless = null;
    this.#frameRequest = 0;
    this.#frameScheduled = false;
    this.#microtaskToken = 0;
    this.#size = null;
    this.sizeDirty = true;
    this.#readoutMode = false;
    this.#stripHeight = 0;
    this.#stripStyle = null;
    this.#stripFontEpoch = -1;
    this.#readoutKind = 'floating';
    this.#fallback = null;
    this.#textStyle = null;
    this.textStyleDirty = true;
    this.fontEpoch = 0;
    this.pixelRatio = this.host.devicePixelRatio();
    this.themeDirty = true;
    this.#themeSeries = null;
    this.theme = null;
    this.#themeRevision = 0;
    this.#announced = null;
    this.settledRevision = 0;
    this.drawn = null;
    this.#fitKey = null;
    this.#lastLayout = null;
    this.#hadMarks = false;
    this.#surfacesHidden = false;
    this.waiters = null;
    this.#lastAxisContext = null;
    this.#englishMemo = null;
    this.#probeWrote = true;
    this.#actionsMade = null;
    this.#invalidateMade = null;
    this.#frameCallback = null;
    this.#formatterError = null;
    this.#probeReport = null;
    // ── create ─────────────────────────────────────────────────────────────────────────────────────
    try {
      this.update(input);
    } catch (error) {
      // A strict create that is rejected leaves nothing behind.
      this.destroy();
      throw error;
    }
    this.handle = new Handle(this);
    if (__DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__)) attachHooks(this.handle, new ControllerProbe(this));
  }

  /** After destroy the host is the dead one, whose console is null: a delivery made then prints nothing. */
  get #delivery(): Delivery {
    return this.#deliveryMade ??= this.#newDelivery();
  }

  #newDelivery(): Delivery {
    const host = this.host;
    return new Delivery({ console: host.console, development: __DEV__, page: host.page });
  }

  get actions(): ControllerActions {
    return this.#actionsMade ??= new ChartActions(this);
  }

  get invalidate(): Invalidate {
    return this.#invalidateMade ??= new ChartInvalidate(this);
  }

  /** The data environment the stages read the viewer's zone from: asked of the host once, when first needed. */
  get timeZone(): string {
    return this.#viewerZone ??= this.host.timeZone;
  }

  #stage(name: Stage): void {
    if (__DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__)) this.stages!.ran(name);
  }

  /** The rows of `frame` by source index: its copy when it has one, else its source. */
  rowOf(frame: Frame, row: number): unknown {
    const own = this.#frozenRows?.get(frame);
    return own ? own.get(row) ?? null : frame.source.rowAt(row);
  }

  /** `frame` addresses the rows `from` did, and `added` more. */
  #ends(frame: Frame, from: Frame, added = 0): void {
    const end = this.#rowEnds?.get(from);
    if (end !== undefined) this.#rowEnds!.set(frame, end + added);
  }

  #chartName(o: OptionRecord): string {
    return titleOf(o)?.text ?? (this.host.targetId || this.host.id);
  }

  /**
   * Every presentation finding once: the same code and field found by two stages (ticks and readouts) is one,
   * the one with an effect on the figure if either has one (a value shown differently keeps its note).
   */
  #presentationList(): readonly DiagnosticInput[] {
    if (!this.#presentation || this.#presentation.size === 0) return EMPTY_DIAGNOSTICS;
    if (this.#presentation.size === 1) {
      const only = this.#presentation.values().next().value!;
      if (only.length <= 1) return only.length === 0 ? EMPTY_DIAGNOSTICS : only;
    }
    const seen = new Map<string, DiagnosticInput>();
    for (const list of this.#presentation.values()) {
      for (const d of list) {
        const key = `${d.code}\u0000${d.field ?? ''}`;
        const previous = seen.get(key);
        if (!previous || previous.effect === 'none') seen.set(key, d);
      }
    }
    return [...seen.values()];
  }

  #stateDiagnostics(a: Accepted, pending: Held = null): readonly DiagnosticInput[] {
    const o = a.optionDiagnostics, d = pending?.dataDiagnostics ?? a.dataDiagnostics;
    const v = pending?.viewDiagnostics ?? a.viewDiagnostics, n = a.naming;
    const total = o.length + d.length + v.length + n.length;
    if (total === 0) return EMPTY_DIAGNOSTICS;
    if (o.length === total) return o;
    if (d.length === total) return d;
    if (v.length === total) return v;
    if (n.length === total) return n;
    return [...o, ...d, ...v, ...n];
  }

  diagnosticInputs(): readonly DiagnosticInput[] {
    const pres = this.#presentationList();
    const a = this.#accepted;
    return a ? joinedDiagnostics(this.#stateDiagnostics(a, this.held), pres) : pres;
  }

  publicDiagnostics(inputs: readonly DiagnosticInput[]): Diagnostic[] {
    return inputs.length ? toPublic(inputs, this.#accepted?.name ?? this.#chartName(this.#options.current)) : [];
  }

  /** Replaces what a presentation stage found; outside a frame the change is delivered at once. */
  #setPresentation(where: PresentationStage, list: readonly DiagnosticInput[]): void {
    const before = this.#presentation?.get(where);
    const beforeLen = before ? before.length : 0;
    if (beforeLen === 0 && list.length === 0) return;
    if (before && beforeLen === list.length && before.every((d, i) => diagnosticKey(d) === diagnosticKey(list[i]!))) return;
    this.#setPresentationQuiet(where, list);
    if (!this.inFrame && !this.#destroyed) {
      this.deliverChanges();
      // The reader's note may change with it (spec F12).
      this.schedule();
    }
  }

  #addPresentation(where: PresentationStage, d: DiagnosticInput): void {
    const list = this.#presentation?.get(where);
    if (list && list.some(o => o.code === d.code && o.field === d.field)) return;
    this.#setPresentation(where, list ? [...list, d] : [d]);
  }

  #formatterFailed(field: string): void {
    // A frame a formatter's own call superseded is not drawn: what its formatters threw on is not reported.
    if (this.inFrame && this.inflight !== null && this.inflight !== this.#accepted) return;
    this.#addPresentation('format', createDiagnostic('AX160', 'changed', { field }, 'presentation'));
  }

  #enqueue(work: () => void): void {
    (this.#notifications ??= []).push(work);
    // During a frame nothing reaches author code: hover, select and zoom that the interaction layer raises
    // while it is being committed are delivered once the frame has finished publishing (final review, 1).
    if (this.#draining || this.inFrame) return;
    this.#drain();
  }

  #drain(): void {
    if (this.#draining || !this.#notifications || this.#notifications.length === 0) return;
    this.#draining = true;
    try {
      while (this.#notifications && this.#notifications.length && !this.#destroyed) this.#notifications.shift()!();
    } finally {
      this.#draining = false;
      if (this.#destroyed && this.#notifications) {
        this.#notifications.length = 0;
        this.#notifications = null;
      }
    }
  }

  /**
   * Prints and hands to `onDiagnostic` what is new. The set to deliver is fixed and marked delivered when the
   * delivery is made, so a handler that updates the chart cannot be given a finding twice.
   */
  deliverChanges(): void {
    if (this.#destroyed) return;
    const inputs = this.diagnosticInputs();
    if (!inputs.length) {
      this.#deliveredKeys?.clear();
      this.#settledInputs = null;
      return;
    }
    // Finding lists are replaced, never changed in place, and a key depends on the finding alone (not the chart
    // name): the list a full pass last settled holds nothing new, and the delivered set already equals its keys.
    // Charts with a standing finding (a hint on their data) then skip the copies and key sets on every frame.
    if (inputs === this.#settledInputs) return;
    const now = this.publicDiagnostics(inputs);
    if (this.#deliveredKeys && this.#deliveredKeys.size > 0) {
      const keys = new Set(now.map(diagnosticKey));
      for (const k of [...this.#deliveredKeys]) if (!keys.has(k)) this.#deliveredKeys.delete(k);
    }
    const fresh = this.#undelivered(now);
    // Settled before any handler runs: a delivery that author code starts from the handler settles its own list.
    this.#settledInputs = inputs;
    if (!fresh.length) return;
    const delivered = this.#deliveredKeys ??= new Set();
    for (const d of fresh) delivered.add(diagnosticKey(d));
    const handler = (this.#accepted?.options ?? this.#options.current).onDiagnostic;
    this.#notifyDiagnostics(fresh, handler);
  }

  /** A rejected or ignored call's findings: printed and given to `onDiagnostic`, never part of `diagnostics`. */
  #deliverRejected(found: readonly DiagnosticInput[], name: string, handler: unknown): void {
    this.#notifyDiagnostics(this.#undelivered(toPublic(found, name)), handler);
  }

  #undelivered(list: Diagnostic[]): Diagnostic[] {
    return this.#deliveredKeys?.size ? list.filter(d => !this.#deliveredKeys!.has(diagnosticKey(d))) : list;
  }

  #notifyDiagnostics(list: readonly Diagnostic[], handler: unknown): void {
    if (!list.length) return;
    this.#enqueue(() => {
      for (const d of list) {
        if (this.#destroyed) return;
        this.#delivery.print(d);
        if (typeof handler === 'function') this.#delivery.notify(handler as (d: Diagnostic) => void, d);
      }
    });
  }

  #viewFor(c: Candidate, previous: Accepted | null): Viewed {
    // A window kept across a data change does not reach an axis it does not apply to.
    const zoom = zoomable(c.frame) ? c.zoom : null;
    const key = viewKeyFor(this.#kind, c.options, c.resolved, c.frame, zoom, c.hidden, c.messages);
    // Frames of different revisions are never equal (a revision is part of the frame), so a new frame is a
    // new view without comparing the rest of the key, or the frames, field by field.
    const viewed = previous?.viewKey[0] as Frame | undefined;
    if (previous && (viewed === c.frame || viewed?.revision === c.frame.revision) && sameValue(previous.viewKey, key)) {
      return { view: previous.view, viewKey: previous.viewKey, viewDiagnostics: previous.viewDiagnostics, found: [] };
    }
    this.#stage('view');
    let sink = new DiagnosticCollector();
    let state = viewStateFor(this.#kind, c.options, c.resolved, zoom, previous?.view ?? null, c.hidden, c.messages);
    let view = this.#composition.view(c.frame, state, sink);
    // A window is read against the domain that is drawn: when the layout drew this data on a wider automatic
    // domain (a narrow scatter's coarser one, F7), that domain is the full range a window may take, for
    // zoom() and for the gestures reading `xFull` (re-check, R8).
    const wide = this.#widenedX;
    // The drawn bounds stay for the zoom on the same data, appends included, and grow with the data
    // (closing pass, item 3).
    if (zoom && view.kind === 'scatter' && wide && !c.resolved.x.domain && wide.epoch === c.frame.epoch) {
      const full = view.xFull;
      sink = new DiagnosticCollector();
      state = { ...state as Exclude<typeof state, { kind: 'donut' }>, xDomain: [Math.min(wide.drawn[0], full[0]), Math.max(wide.drawn[1], full[1])] };
      view = this.#composition.view(c.frame, state, sink);
    }
    // A wall-clock window on a wall-clock axis is what the axis reads: the column's own AX112 already says
    // the values have no offset, and the window is not news (documentation finding 2).
    const rawFound = sink.inputs();
    const found = rawFound.length === 0
      ? EMPTY_DIAGNOSTICS
      : rawFound.filter(d => !(d.code === 'AX112' && d.field === 'zoom' && isWall(c.frame)));
    const before = previous?.viewDiagnostics ?? EMPTY_DIAGNOSTICS;
    const viewDiagnostics = found.length === 0 && before.length === 0
      ? EMPTY_DIAGNOSTICS
      : completeViewDiagnostics(this.#kind, found, before, view, state);
    let newFound: readonly DiagnosticInput[];
    if (found.length === 0) newFound = EMPTY_DIAGNOSTICS;
    else if (before.length === 0) newFound = found;
    else {
      const known = new Set(before.map(diagnosticKey));
      newFound = found.filter(d => !known.has(diagnosticKey(d)));
    }
    return { view, viewKey: key, viewDiagnostics, found: newFound };
  }

  #messagesFor(next: OptionRecord, previous: Accepted | null): Messages {
    return previous && sameValue(previous.options.messages, next.messages) ? previous.messages : messagesOf(next.messages);
  }

  /**
   * Accepts a validated candidate: the store commits first (so the frame on screen and the store agree),
   * then the options, then the state. Nothing before this changes the chart.
   */
  #accept(c: Candidate, viewed: Viewed, follow: boolean, commit: (() => void) | null, microtask = false): void {
    // Liveness before acceptance: a chart destroyed by author code during the call takes nothing (defect 6).
    if (this.#destroyed) return;
    commit?.();
    if (commit && c.store && c.store.frame === c.frame) (this.#storeFrames ??= new WeakSet()).add(c.frame);
    if (this.held && c.frame === this.held.frame) this.held = null;
    this.#options.commit(c.options);
    this.#frameRevision = Math.max(this.#frameRevision, c.frame.revision);
    // Naming and the chart's name come from the options alone: a stream's appends keep the same options object,
    // so they keep the same naming list too (and the delivery pass can see that nothing changed).
    const before = this.#accepted;
    const sameOptions = before !== null && before.options === c.options;
    this.#accepted = {
      ...c, viewDiagnostics: viewed.viewDiagnostics, naming: sameOptions ? before.naming : namingDiagnostics(c.options), view: viewed.view,
      viewKey: viewed.viewKey, follow, revision: ++this.#commits, name: sameOptions ? before.name : this.#chartName(c.options),
    };
    if (this.#internalError !== null) {
      this.#internalError = null;
      this.#setPresentationQuiet('internal', EMPTY_DIAGNOSTICS);
    }
    this.#release();
    this.deliverChanges();
    if (microtask) this.#scheduleMicrotask();
    else this.schedule();
  }

  #setPresentationQuiet(where: PresentationStage, list: readonly DiagnosticInput[]): void {
    this.#presentationVersion++;
    if (list.length) (this.#presentation ??= new Map()).set(where, list);
    else this.#presentation?.delete(where);
  }

  /** A strict chart rejects a create, update or append whose own findings include an error or warning. */
  #rejectIfStrict(strict: boolean, found: readonly DiagnosticInput[], name: string, handler: unknown): void {
    if (!strict || strictViolations(found).length === 0) return;
    this.#deliverRejected(found, name, handler);
    throw new StrictError(name, toPublic(found, name));
  }

  /** Runs a call. A strict rejection propagates; anything else that throws becomes the internal-error state. */
  #guarded(run: (call: Preparation) => void): void {
    if (this.#destroyed) return;
    const call: Preparation = { sink: null, strict: false, name: '', handler: undefined, naming: [] };
    try {
      run(call);
    } catch (error) {
      if (error instanceof StrictError) throw error;
      // Author code destroyed the chart during the call: nothing is reported on a handle that is gone.
      if (this.#destroyed) return;
      // A failure while a call was prepared (a row getter that throws): what the call had found until then is
      // kept, with AX199 after it, as validate() reports it; under strict that is a rejection, before the
      // accepted chart changes (final review, finding 7).
      const before = call.sink?.inputs() ?? [];
      const after = this.#accepted === null ? call.naming : [];
      if (call.strict) {
        const found = [...before, createDiagnostic('AX199', 'chart-error', {}, 'presentation'), ...after];
        this.#deliverRejected(found, call.name, call.handler);
        throw new StrictError(call.name, toPublic(found, call.name));
      }
      this.#raiseInternal(error, before, after);
      // A create that failed has nothing to draw from: show the error state now (never a blank box).
      if (this.#accepted === null) this.#showInternal(messagesOf(this.#options.current.messages), this.#chartName(this.#options.current), this.#options.current);
      this.schedule();
    }
  }

  #nextVersion(): { epoch: number; revision: number } {
    return { epoch: ++this.#epochs, revision: ++this.#frameRevision };
  }

  update(patch: unknown): void {
    this.#guarded(call => {
      this.#stage('options');
      // Reading the patch runs author getters: until it has been read, the chart is as strict as it is now
      // (re-check, C6).
      const now = this.#options.current;
      Object.assign(call, { strict: now.strict === true, name: this.#chartName(now), handler: now.onDiagnostic });
      const { next, changed } = this.#options.preview(patch);
      const previous = this.#accepted;
      const supplied = patch !== null && typeof patch === 'object' && Object.hasOwn(patch, 'data');
      const optionSink = new DiagnosticCollector();
      Object.assign(call, {
        sink: optionSink, strict: next.strict === true, name: this.#chartName(next), handler: next.onDiagnostic,
        naming: previous === null ? namingDiagnostics(next) : [],
      });
      const messages = this.#messagesFor(next, previous);
      const common = { options: next, messages, zoom: previous?.zoom ?? null, hidden: previous?.hidden ?? EMPTY_HIDDEN };
      const resolve = (table?: Table) => (this.#composition.resolve ?? resolveFields)(this.#kind, publicOptions(next), optionSink, table);
      let c: Candidate;
      let commit: (() => void) | null = null;
      let heldAfter: Held = null;
      const replace = previous === null || changed.has('data') || (supplied && previous.store !== null);
      const reencode = !replace && encodingChanged(previous!.options, next);
      if (!replace && reencode && previous!.store === null && namesOnlyChanged(previous!.options, next)) {
        // Labels or units only, over the caller's own data: the same columns with new names (finding 12).
        const resolved = resolve(previous!.source.table);
        const p = previous!;
        const opts = optionSink.inputs().filter(d => !DATA_CODES.has(d.code));
        c = {
          ...common, resolved, source: resolved, store: null, frame: renamed(p.frame, resolved, this.#frameRevision += 1),
          dataDiagnostics: p.dataDiagnostics, dataOptions: p.dataOptions,
          optionDiagnostics: dedupe([...p.dataOptions, ...opts], p.dataDiagnostics),
        };
      } else if (replace || (reencode && previous!.store === null)) {
        // New data, or new fields over the caller's own data: normalized from the options, borrowing typed
        // columns (plan 1.2). A stream this replaces is dropped with everything it held.
        this.#stage('normalize');
        const resolved = resolve();
        const dataSink = new DiagnosticCollector();
        const frame = this.#composition.normalize(this.#kind, resolved, this, dataSink, this.#nextVersion());
        const data = dataSink.inputs();
        const opts = optionSink.inputs();
        c = {
          ...common, resolved, source: resolved, store: null, frame, dataDiagnostics: data,
          dataOptions: opts.filter(d => DATA_CODES.has(d.code)), optionDiagnostics: dedupe(opts, data),
        };
      } else if (reencode) {
        // New fields after streaming: the retained rows are read again (a new epoch, plan 1.5).
        this.#stage('normalize');
        const store = previous!.store!;
        const resolved = store.resolveEncoding(publicOptions(next), optionSink);
        const prepared: PreparedFrame<Frame> = store.prepareReencode(resolved, this.#nextVersion());
        this.#ends(prepared.frame, store.frame);
        commit = prepared.commit;
        const opts = optionSink.inputs();
        c = { ...common, resolved, source: resolved, store, frame: prepared.frame,
          dataDiagnostics: prepared.diagnostics, dataOptions: [], optionDiagnostics: [] };
        if (this.#paused && this.held) {
          // Paused: the rows on screen are read again with the new fields on their own, and the arrivals stay
          // held, re-encoded in the store, until Resume (review 3, finding 5). The rows on screen are the
          // displayed revision's raw window, typed-column rows marked as such (verification, defect 4).
          const table = this.#displayedTable(previous!.frame, store);
          // What the fields say about the rows on screen counts too: a field only the held rows have leaves
          // the plot shown without values (AX101), which strict rejects (re-check, C4).
          const shownOptions = new DiagnosticCollector();
          const shownResolved = (this.#composition.resolve ?? resolveFields)(this.#kind, publicOptions(next), shownOptions, table);
          const shownData = shownOptions.inputs().filter(d => DATA_CODES.has(d.code));
          const shownSink = new DiagnosticCollector();
          const shown = this.#composition.normalize(this.#kind, shownResolved, this, shownSink, this.#nextVersion());
          // Both views are built and validated before either is accepted: the held one keeps its findings
          // (AX130 of a held ninth series), which count for strict and for `diagnostics` (defect 4).
          const heldView = this.#viewFor(c, null);
          heldAfter = { frame: prepared.frame, dataDiagnostics: prepared.diagnostics, viewDiagnostics: heldView.viewDiagnostics };
          c = {
            ...c, source: shownResolved, frame: shown, dataDiagnostics: shownSink.inputs(),
            dataOptions: shownData, optionDiagnostics: dedupe([...dedupe(shownData, opts), ...opts], prepared.diagnostics),
          };
        } else {
          c = { ...c, optionDiagnostics: dedupe(opts, prepared.diagnostics) };
        }
      } else {
        // Presentation only (title, domains, references, colors, …): the frame stays. Rows held by a Resume
        // that failed are shown by the next accepted call (finding 5).
        const p = this.#resumable(previous!);
        // The fields are unchanged, so what the retained rows said about them still holds: a stream is checked
        // against no rows (a title update must not walk them, finding 11) unless they were found wanting.
        const resolved = p.store
          ? p.resolved.valid ? resolve(rowsTable([]))
            : p.store.resolveEncoding(publicOptions(next), optionSink)
          : resolve(p.source.table);
        const opts = optionSink.inputs().filter(d => !DATA_CODES.has(d.code));
        c = {
          ...p, ...common, resolved, optionDiagnostics: dedupe([...p.dataOptions, ...opts], p.dataDiagnostics),
        };
      }
      const viewed = this.#viewFor(c, previous);
      // Author code (a getter) destroyed the chart while the call was prepared: nothing is accepted.
      if (this.#destroyed) return;
      const found = [...c.optionDiagnostics, ...c.dataDiagnostics, ...viewed.viewDiagnostics, ...namingDiagnostics(next)];
      // While paused the held window is part of the chart: its findings count for strict too (finding 6).
      const keptHeld = heldAfter ?? (c.frame === previous?.frame ? this.held : null);
      if (this.#paused && keptHeld) found.push(...keptHeld.dataDiagnostics, ...keptHeld.viewDiagnostics);
      this.#rejectIfStrict(next.strict === true, found, this.#chartName(next), next.onDiagnostic);
      // Data replaced or bounds changed: a window that no longer ends at the latest x stops following.
      const follow = followsLatest(viewed.view, c.zoom);
      if (c.frame !== previous?.frame) this.held = null;
      // The held arrivals are in place before anything is delivered: a handler that resumes from inside
      // this call finds them, and no arrival stays held on a running chart (final review, finding 6).
      if (heldAfter) this.held = heldAfter;
      this.#accept(c, viewed, follow, commit);
    });
  }

  #openStore(a: Accepted): Store {
    const store = this.#composition.openStore(a.frame, a.source, a.options.data, this, this.#kind);
    const table = a.source.table;
    if (table) {
      (this.#rowEnds ??= new WeakMap()).set(store.frame, table.length);
      (this.#columnRows ??= new WeakMap()).set(store, table.columns ? table.length : 0);
    }
    return store;
  }

  #recoverFields(previous: Accepted, store: Store, c: Candidate, before: Frame) {
    const check = new DiagnosticCollector();
    const resolved = store.resolveEncoding(publicOptions(previous.options), check);
    if (check.inputs().some(d => d.code === 'AX101')) return null;
    const again = store.prepareReencode(resolved, this.#nextVersion());
    this.#ends(again.frame, before);
    const candidate = {
      ...c, resolved, source: resolved, frame: again.frame, dataDiagnostics: again.diagnostics, dataOptions: [],
      optionDiagnostics: previous.optionDiagnostics.filter(d => !DATA_CODES.has(d.code)),
    };
    return { candidate, commit: again.commit };
  }

  /**
   * `resolved` without the caller's opening table. One that has none already is kept, so a stream does not make
   * two resolutions and two empty tables per append (they would be equal to the ones they replace).
   */
  #dropTable(resolved: ResolvedOptions): ResolvedOptions {
    if (this.#tableless?.has(resolved)) return resolved;
    const own = withoutTable(resolved);
    (this.#tableless ??= new WeakSet()).add(own);
    return own;
  }

  #commitRetained(prepared: PreparedFrame<Frame>): void {
    prepared.commit();
    (this.#storeFrames ??= new WeakSet()).add(prepared.frame);
    this.#frameRevision = Math.max(this.#frameRevision, prepared.frame.revision);
  }

  append(rows: unknown, appendOptions?: { keep?: number }): void {
    this.#guarded(call => {
      const previous = this.#accepted;
      if (!previous) return;
      // A row getter that throws is a failure of this call: under strict, a rejection (defect 6).
      call.strict = previous.options.strict === true;
      call.name = previous.name;
      call.handler = previous.options.onDiagnostic;
      // The pause control appears (spec I6) once an append was accepted, not before it validated.
      if (!Array.isArray(rows) || rows.length === 0) {
        if (!this.#streaming) { this.#streaming = true; this.schedule(); }
        return;
      }
      this.#stage('append');
      const keep = appendOptions?.keep;
      const store = previous.store ?? this.#openStore(previous);
      const prepared = (store.prepareAppend as (r: readonly unknown[], o: { keep?: number }) => PreparedFrame<Frame>)(
        rows, keep === undefined ? EMPTY_APPEND_OPTIONS : { keep });
      this.#ends(prepared.frame, store.frame, rows.length);
      // While paused the view does not move (spec I6), but the rows are validated now, with the window shown.
      const base = this.held ? { ...previous, frame: this.held.frame } : previous;
      const zoom = this.#paused ? previous.zoom : this.#followingZoom(previous, prepared.frame);
      const nextOptions = streamOptions(previous.options);
      const resolved = this.#dropTable(previous.resolved);
      const source = this.#dropTable(previous.source);
      let c: Candidate = {
        // Once the stream has its store the caller's opening data is no longer read: options and source keep no
        // reference to it, so it can be collected once no displayed frame needs it (data agent's report).
        ...previous, options: nextOptions, resolved, source, store, frame: prepared.frame, dataDiagnostics: prepared.diagnostics, zoom,
      };
      let commitAppend: (() => void) | null = prepared.commit;
      if (!this.#paused && this.#canRecoverFields(previous)) {
        // A field the earlier data did not have: once the retained rows have it, the frame is read again with
        // the fields as given and AX101 goes (review 3, finding 8).
        this.#commitRetained(prepared);
        commitAppend = null;
        const repaired = this.#recoverFields(previous, store, c, prepared.frame);
        if (repaired) {
          c = repaired.candidate;
          commitAppend = repaired.commit;
        }
      }
      const viewed = this.#viewFor(c, base);
      if (this.#destroyed) return;
      if (previous.options.strict === true) {
        const found = joinedDiagnostics(prepared.callDiagnostics, viewed.found);
        this.#rejectIfStrict(true, found, previous.name, previous.options.onDiagnostic);
      }
      if (this.#paused) {
        this.#commitRetained(prepared);
        // The store is the accepted state's now; rows no displayed or pending frame needs go (finding 4).
        this.#accepted = { ...previous, options: nextOptions, resolved, source, store };
        this.#options.commit(this.#accepted.options);
        this.#release();
        // The held state: complete findings for the data accepted so far, kept apart from what is drawn, so a
        // display effect (an error state) never reaches the ring on screen before Resume (finding 6).
        this.held = { frame: prepared.frame, dataDiagnostics: prepared.diagnostics, viewDiagnostics: viewed.viewDiagnostics };
        this.#streaming = true;
        this.deliverChanges();
        this.schedule();
        return;
      }
      this.#streaming = true;
      // The new frame is made from the store's head, which already has every held arrival: a revision held by
      // a Resume that failed is superseded here, in the same step (final review, finding 3).
      this.held = null;
      this.#accept(c, viewed, previous.follow && zoom !== null, commitAppend);
    });
  }

  /**
   * The caller's rows of a displayed frame as a table, in source order and with their own source indexes, so
   * they can be normalized again on their own (re-encoding what is on screen while paused). A frame over the
   * caller's own table is read from it; a store frame from its raw window, with the rows that came from typed
   * columns marked as such (a NaN there is "no data", not an unplottable value; verification, defect 4).
   */
  #displayedTable(frame: Frame, store: Store | null): Table {
    const own = this.#frozenRows?.get(frame);
    if (!own && !this.#storeFrames?.has(frame) && isTable(frame.source)) return frame.source;
    const rows = own ?? this.#freeze(frame);
    const indexes = [...rows.keys()].sort((p, q) => p - q);
    const columns = store ? this.#columnRows?.get(store) ?? 0 : 0;
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
  #freeze(frame: Frame): Map<number, unknown> {
    const rows = new Map<number, unknown>();
    // The store knows which source rows a revision still addresses: read exactly those (re-check, C4 and R7).
    const retained = (this.#onScreenStore(frame) as { retainedRows?(frame: Frame): ArrayLike<number> | null } | null)?.retainedRows?.(frame);
    if (retained) {
      for (let i = 0; i < retained.length; i++) rows.set(retained[i]!, frame.source.rowAt(retained[i]!));
      return rows;
    }
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
    const end = this.#rowEnds?.get(frame);
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
    return rows;
  }

  /** The store a frame's rows live in: the accepted chart's, when the frame came from it. */
  #onScreenStore(frame: Frame): Store | null {
    const store = this.#accepted?.store ?? null;
    return store && this.#storeFrames?.has(frame) ? store : null;
  }

  /** The window moved to end at the new latest x, keeping its width; null when it cannot follow. */
  #followLatest(frame: Frame, before: View): Span<XValue> | null {
    if (before.kind === 'donut' || frame.shape === 'donut') return null;
    if (frame.shape === 'aligned' && frame.x.kind === 'category') return null;
    const span = before.xDomain[1] - before.xDomain[0];
    const latest = latestX(frame);
    if (!Number.isFinite(latest) || !Number.isFinite(span)) return null;
    return [positionValue(frame, latest - span), positionValue(frame, latest)];
  }

  /** Candidate for a call that changes only the view (zoom, legend, resume): same options, same data. */
  /** The accepted state with the held frame in it, when Resume was asked for but did not complete. */
  #followingZoom(a: Accepted, frame: Frame): Span<XValue> | null {
    return a.follow && a.zoom ? this.#followLatest(frame, a.view) ?? a.zoom : a.zoom;
  }

  #canRecoverFields(a: Accepted): boolean {
    return a.options.strict !== true && a.dataOptions.some(d => d.code === 'AX101');
  }

  #resumable(a: Accepted): Accepted {
    return !this.#paused && this.held ? { ...a, frame: this.held.frame, dataDiagnostics: this.held.dataDiagnostics } : a;
  }

  #viewCandidate(given: Accepted, change: Partial<Pick<Candidate, 'zoom' | 'hidden' | 'frame' | 'dataDiagnostics'>>): Candidate {
    return { ...this.#resumable(given), ...change };
  }

  zoom(domain: unknown): void {
    this.#guarded(() => {
      const previous = this.#accepted;
      if (!previous) return;
      const applicable = zoomable(previous.frame);
      if (!applicable || isCompact(this.#kind, previous.options)) {
        if (domain !== null && domain !== undefined) {
          const detail = applicable ? 'A compact chart does not zoom.' : 'Zoom applies to time, date and number x axes only.';
          this.#deliverRejected([createDiagnostic('AX150', 'none', { field: 'zoom', detail }, 'call')], previous.name, previous.options.onDiagnostic);
        }
        return;
      }
      // The window is kept as given at the call: a Date the caller mutates later does not move it (finding 12).
      const own = (v: unknown) => v instanceof Date ? new Date(v.getTime()) : v;
      const pair = Array.isArray(domain) && domain.length === 2 ? [own(domain[0]), own(domain[1])] as unknown as Span<XValue> : null;
      const c = this.#viewCandidate(previous, { zoom: pair });
      const viewed = this.#viewFor(c, previous);
      // A window that cannot be read is reported and ignored; zoom never throws (spec 3.5).
      // A hint (AX112: a wall-clock window on a wall-clock axis) does not make the window unreadable.
      const bad = viewed.found.filter(d => d.field === 'zoom' && d.level !== 'hint');
      if (bad.length) {
        this.#deliverRejected(bad, previous.name, previous.options.onDiagnostic);
        return;
      }
      this.#accept(c, viewed, followsLatest(viewed.view, pair), null, true);
      const now = this.#accepted;
      if (this.#destroyed || now === null) return;
      const view = now.view;
      const before = previous.view;
      if (view.kind !== 'donut' && before.kind !== 'donut' &&
        (view.xDomain[0] !== before.xDomain[0] || view.xDomain[1] !== before.xDomain[1] || (previous.zoom === null) !== (pair === null))) {
        this.emit('zoom', this.#zoomPayload(now));
      }
    });
  }

  /** The window shown, in the form `zoom()` reads (positionValue); null when the whole range is shown. */
  #zoomPayload(a: Accepted): readonly [XValue, XValue] | null {
    const view = a.view;
    if (a.zoom === null || view.kind === 'donut') return null;
    return [positionValue(a.frame, view.xDomain[0]), positionValue(a.frame, view.xDomain[1])];
  }

  /** A legend toggle: the series joins or leaves the view's hidden set (spec I2). */
  toggleSeries(key: string): void {
    this.#guarded(() => {
      const previous = this.#accepted;
      if (!previous) return;
      const hidden = new Set(previous.hidden);
      if (!hidden.delete(key)) hidden.add(key);
      const c = this.#viewCandidate(previous, { hidden });
      this.#accept(c, this.#viewFor(c, previous), previous.follow, null);
    });
  }

  /** Pause and resume (spec I6). Resume shows the newest held frame. */
  setPaused(next: boolean): void {
    if (this.#destroyed || next === this.#paused) return;
    this.#paused = next;
    if (!next && this.held) {
      const frame = this.held;
      this.#guarded(() => {
        const previous = this.#accepted;
        if (!previous) return;
        const zoomed = this.#followingZoom(previous, frame.frame);
        let c = this.#viewCandidate(previous, { frame: frame.frame, dataDiagnostics: frame.dataDiagnostics, zoom: zoomed });
        let commit: (() => void) | null = null;
        const store = previous.store;
        if (store && this.#canRecoverFields(previous)) {
          // A field the earlier data did not have, which the held arrivals bring: the frame is read again with
          // the fields as given, and AX101 goes, as for a running append (final review, finding 6).
          const repaired = this.#recoverFields(previous, store, c, store.frame);
          if (repaired) {
            c = repaired.candidate;
            commit = repaired.commit;
          }
        }
        const viewed = this.#viewFor(c, previous);
        // The held frame is let go only once its replacement is accepted (review 3, finding 5).
        this.held = null;
        this.#accept(c, viewed, previous.follow && zoomed !== null, commit);
      });
    }
    this.schedule();
  }

  schedule(): void {
    if (this.#destroyed || this.#frameScheduled) return;
    this.#frameScheduled = true;
    this.#frameRequest = this.host.requestFrame(this.#frameCallback ??= this.#frameCallbackFor());
  }

  /** The one callback this chart gives the host's frame requests, made on its first request. */
  #frameCallbackFor(): (time?: number) => void {
    return () => this.#runScheduledFrame();
  }

  #runScheduledFrame(): void {
    this.#frameRequest = 0;
    this.#frameScheduled = false;
    this.flush();
  }

  #scheduleMicrotask(): void {
    if (this.#destroyed || this.#frameScheduled) return;
    if (!this.inFrame && this.drawn !== null && this.host.scheduleMicrotask) {
      this.#frameScheduled = true;
      const token = ++this.#microtaskToken;
      this.host.scheduleMicrotask(() => {
        if (this.#destroyed || !this.#frameScheduled || token !== this.#microtaskToken) return;
        this.#frameScheduled = false;
        this.flush();
      });
      return;
    }
    this.schedule();
  }

  /** Theme bindings per palette slot: series by index; donut slices by their colorIndex (DX6). */
  themeKeys(view: View): string[] {
    if (view.kind !== 'donut') return view.frame.series.map(s => s.key);
    const keys: string[] = [];
    for (const slice of view.slices) if (slice.colorIndex !== null) keys[slice.colorIndex] = slice.label;
    for (let i = 0; i < keys.length; i++) keys[i] ??= '';
    return keys;
  }

  #sameSeriesKeys(view: Exclude<View, { kind: 'donut' }>, keys: readonly string[]): boolean {
    const series = view.frame.series;
    if (series.length !== keys.length) return false;
    for (let i = 0; i < keys.length; i++) if (series[i]!.key !== keys[i]) return false;
    return true;
  }

  #reportFit(a: Accepted, layout: Layout, tooSmall: boolean, hidden: number): void {
    const view = a.view;
    const small = tooSmall || layout.kind === 'too-small';
    const dense = view.kind === 'bar' && layout.kind === 'plot' &&
      view.visibleSlots.end - view.visibleSlots.start > (view.horizontal ? layout.plot.height : layout.plot.width);
    if (!small && !dense && hidden === 0) {
      if (this.#fitKey !== null) {
        this.#fitKey = null;
        this.#setPresentation('fit', EMPTY_DIAGNOSTICS);
      }
      return;
    }
    const field = a.resolved.x.field;
    // AX143 suggests horizontal bars only for vertical bars on category labels.
    const xKind = view.kind === 'donut' ? undefined : view.kind === 'scatter' ? view.frame.xKind : view.frame.x.kind;
    const horizontal = view.kind === 'bar' ? view.horizontal : undefined;
    if (this.#fitKey && this.#fitKey.small === small && this.#fitKey.dense === dense && this.#fitKey.hidden === hidden && this.#fitKey.field === field &&
        this.#fitKey.xKind === xKind && this.#fitKey.horizontal === horizontal && this.#fitKey.kind === view.kind) return;
    this.#fitKey = { small, dense, hidden, field, xKind, horizontal, kind: view.kind };
    const fit: DiagnosticInput[] = [];
    if (small) fit.push(createDiagnostic('AX142', 'none', {}, 'presentation'));
    if (hidden > 0) fit.push(createDiagnostic('AX143', 'none', {
      field, count: hidden, chartType: view.kind, xKind, horizontal,
    }, 'presentation'));
    if (dense) fit.push(createDiagnostic('AX132', 'none', { field }, 'presentation'));
    this.#setPresentation('fit', fit);
  }

  #display(a: Accepted, diagnostics: readonly DiagnosticInput[]): Display {
    const m = a.messages;
    if (this.#internalError !== null) return { kind: 'internal', text: m.internalError, message: 'internalError' };
    const state = a.options.state;
    if (state === 'loading') return { kind: 'loading', text: m.loading, message: 'loading' };
    if (state && typeof state === 'object') {
      const s = state as { error?: unknown; empty?: unknown };
      for (const kind of ['error', 'empty'] as const) {
        if (!(kind in s)) continue;
        const text = s[kind];
        if (typeof text === 'string' && text !== '') return { kind, text, message: null };
        return { kind, text: m[kind], message: kind };
      }
    }
    // A loop rather than `some`: every frame asks, and most have nothing to scan.
    for (let i = 0; i < diagnostics.length; i++) {
      if (diagnostics[i]!.effect === 'chart-error') return { kind: 'error', text: m.error, message: 'error' };
    }
    // Series the reader hid are still data: the chart stays ready, so the legend can show them again.
    if (!hasData(a.view, true)) {
      // Nothing drawn because series could not be (AX108: series disabled) is not an empty chart: the figure
      // says which, as the summary does (spec 3.5).
      const undrawn = a.view.kind === 'donut' ? [] : a.view.frame.series.filter(s => !s.drawable);
      if (undrawn.length) {
        const table = a.options.table !== false && !isCompact(this.#kind, a.options);
        const text = undrawn.map(s => seriesNotDrawnSentence(m, s.label, table)).join(' ');
        return { kind: 'error', text, message: 'seriesNotDrawn' };
      }
      return { kind: 'empty', text: m.empty, message: 'empty' };
    }
    return READY;
  }

  /**
   * `lang` for an element showing the built-in text of `key`: 'en' when the page is in another language and
   * the author has not replaced that text (spec A10), else null.
   */
  #englishFor(a: Accepted, foreign: boolean): (key: keyof Messages) => string | null {
    if (!foreign) return INHERIT_LANGUAGE;
    const overrides = object(a.options.messages);
    return key => typeof overrides[key] !== 'string' ? 'en' : null;
  }

  /** AX199 (spec 3.5): Axylo itself failed. Given to onDiagnostic and printed, beside the error state. */
  #raiseInternal(error: unknown, before: readonly DiagnosticInput[] = [], after: readonly DiagnosticInput[] = []): void {
    const first = this.#internalError === null;
    this.#internalError = error;
    if (first) this.#delivery.internal(this.#accepted?.name ?? (this.host.targetId || this.host.id), error);
    this.#setPresentationQuiet('internal', [...before, createDiagnostic('AX199', 'chart-error', {}, 'presentation'), ...after]);
    if (!this.inFrame) this.deliverChanges();
  }

  #formatSpec(a: Accepted, locale: string): FormatSpec {
    const { frame, resolved } = a;
    // The error callback is made once, in its own method: a closure made here would share this scope with
    // `valueFor`, and so keep `resolved` and its borrowed table alive as long as the formatters are reused (data agent).
    const onFormatterError = this.#formatterError ??= this.#formatterErrorCallback();
    const valueFor = (field: string) => resolved.values.find(v => v.field === field) ?? resolved.values[0];
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
      : { kind: frame.xKind, timeZone: frame.timeZone, dateUnit: pointDateUnit(frame, resolved.x.field, this), categories: null };
    const series = frame.shape === 'aligned'
      ? frame.series.map(s => ({ field: s.field, unit: s.unit, scale: s.valueScale, format: valueFor(s.field)?.format ?? null }))
      : frame.series.map(() => ({ field: resolved.values[0]?.field ?? 'y', unit: frame.yUnit, scale: resolved.values[0]?.scale ?? null, format: resolved.values[0]?.format ?? null }));
    return {
      series, x: { field: resolved.x.field, unit: resolved.x.unit, scale: resolved.x.scale, format: resolved.x.format as never, ...x },
      locale, messages, onFormatterError,
    };
  }

  /** What a formatter's failure reaches: the chart, not the options it was made from. */
  #formatterErrorCallback(): (field: string) => void {
    return field => this.#formatterFailed(field);
  }

  #formattersKey(spec: FormatSpec, valueCount: number): unknown[] {
    return [spec.locale, spec.x.kind, spec.x.timeZone, spec.x.dateUnit, spec.x.categories, spec.x.format, spec.x.unit, spec.x.scale,
      spec.messages.noData, spec.messages.noObservation,
      spec.series.map(s => `${s.field}\u0001${s.unit}\u0001${s.scale}`).join('\u0002'), ...spec.series.map(s => s.format), valueCount];
  }

  #sameFormatInputs(before: Accepted, after: Accepted): boolean {
    if (before.resolved.x !== after.resolved.x || before.resolved.values !== after.resolved.values ||
        before.messages.noData !== after.messages.noData || before.messages.noObservation !== after.messages.noObservation) return false;
    const a = before.frame, b = after.frame;
    if (a === b) return true;
    if (a.shape === 'aligned' && b.shape === 'aligned') {
      if (a.x.kind !== b.x.kind || a.x.timeZone !== b.x.timeZone || a.x.dateUnit !== b.x.dateUnit ||
          a.x.categories !== b.x.categories || a.series.length !== b.series.length) return false;
      for (let i = 0; i < a.series.length; i++) {
        const x = a.series[i]!, y = b.series[i]!;
        if (x.field !== y.field || x.unit !== y.unit || x.valueScale !== y.valueScale) return false;
      }
      return true;
    }
    if (a.shape === 'points' && b.shape === 'points') {
      return a.xKind === b.xKind && a.timeZone === b.timeZone && a.yUnit === b.yUnit &&
        a.series.length === b.series.length &&
        pointDateUnit(a, before.resolved.x.field, this) === pointDateUnit(b, after.resolved.x.field, this);
    }
    return a.shape === 'donut' && b.shape === 'donut' &&
      a.labels === b.labels && a.unit === b.unit && a.valueScale === b.valueScale;
  }

  flush(): void {
    const run = this.#startFrame();
    if (!run) return;
    // A ready compact plot has no readout strip and no L8 fallback: its readout steps would all pass.
    run.phase1();
    run.phase2();
    // The measure's layout brings style up to date, so the theme's reads after it start no style pass of their
    // own; a late theme probe that moved the figure has it measured again (the second call does nothing else).
    run.phase3Measure();
    run.phase3Theme();
    run.phase3Probe();
    run.phase3Measure();
    if (run.stripless()) run.phase4Init();
    else readoutSteps(run);
    for (let pass = 0; pass < 4; pass++) {
      if (!run.phase4PassWrite()) break;
      if (run.phase4PassMeasure()) readoutSteps(run);
    }
    run.phase5();
    run.after();
  }

  /** Whether a frame may go on after author code ran (a formatter): the chart is alive and on the same state. */
  #current(a: Accepted): boolean {
    return !this.#destroyed && this.#accepted === a;
  }

  #cancelFrameRequest(): void {
    this.#microtaskToken++;
    if (this.#frameRequest !== 0) this.host.cancelFrame(this.#frameRequest);
    this.#frameRequest = 0;
    this.#frameScheduled = false;
  }

  /** The late theme probe's report: one callback per chart, made when a chart first needs the probe. */
  #probeReportCallback(): (wrote: boolean) => void {
    return wrote => { this.#probeWrote = wrote; };
  }

  #startFrame(): FrameState | null {
    this.#cancelFrameRequest();
    const a = this.#accepted;
    if (this.#destroyed || !a) return null;
    this.inFrame = true;
    // The frame's own rows are kept while it publishes, whatever its author code accepts meanwhile (an append
    // with keep from a callback can no longer retire them; final review, finding 1).
    this.inflight = a;
    const f = acquireFrame(this);
    const view = a.view;
    const zoomOn = zoomApplies(view, a.options.zoom) ? (a.options.zoom === 'touch' ? 'touch' as const : true) : false;
    const zoomed = view.kind !== 'donut' && a.zoom !== null && (view.xDomain[0] > view.xFull[0] || view.xDomain[1] < view.xFull[1]);
    const placement = a.options.legend;
    const legend = placement === false || placement === 'top' || placement === 'right' ? placement : 'bottom';
    f.begin(a, isCompact(this.#kind, a.options), this.#stateDiagnostics(a), zoomOn, zoomed, legend);
    return f;
  }

  /**
   * Runs one step of a frame. A step that throws ends the frame: a superseded frame (ABORT, or a newer
   * accepted state) leaves error handling to the revision that will be drawn; any other failure is this
   * revision's error state. A closed or destroyed frame does nothing more.
   */
  frameStep(f: FrameState, id: number): boolean {
    if (f.closed) return false;
    if (!this.#destroyed) {
      try {
        switch (id) {
          case STEP_PHASE1: this.#phase1(f); return false;
          case STEP_PHASE2: this.#phase2(f); return false;
          case STEP_THEME: this.#finishTheme(f); return false;
          case STEP_MEASURE: this.#measurePending(f); return false;
          case STEP_PROBE: this.#probeTheme(f); return false;
          case STEP_LAYOUT_CHECK: return this.#layoutCheck(f);
          case STEP_STRIP_MOUNT: this.#stripMount(f); return false;
          case STEP_STRIP_READ: this.#stripRead(f); return false;
          case STEP_READOUT: this.#readoutDecide(f); return false;
          case STEP_STRIP_WRITE: this.#stripWrite(f); return false;
          case STEP_STRIP_MEASURE: this.#stripMeasure(f); return false;
          case STEP_INIT: this.#layoutInit(f); return false;
          case STEP_PASS_WRITE: return this.#passWrite(f);
          case STEP_PASS_MEASURE: return this.#passMeasure(f);
          default: this.#publish(f); return false;
        }
      } catch (error) {
        const a = f.a!;
        if (error !== ABORT && this.#current(a)) this.#failSafe(a, error);
      }
    }
    this.#closeFrame(f);
    return false;
  }

  /** Removes the strip-height probe if it is in the figure; runs even on a closed frame. */
  removeStripProbe(f: FrameState): void {
    if (f.stripProbe === null) return;
    const probe = f.stripProbe;
    f.stripProbe = null;
    try { this.host.stripProbeRemove?.(probe); } catch { /* ignore cleanup error */ }
  }

  #closeFrame(f: FrameState): void {
    if (f.closed) return;
    f.closed = true;
    this.inFrame = false;
    this.inflight = null;
    // A frame that stopped between mounting the probe and the step that removes it leaves no probe behind.
    this.removeStripProbe(f);
    if (!this.#destroyed) this.#release();
  }

  // Phase 5: Final diagnostics, scene, lookup, draw, text, figure, commit & close out frame.
  finishFrame(f: FrameState): void {
    this.frameStep(f, STEP_PUBLISH);
    this.#closeFrame(f);
  }

  // Post-frame: re-schedule if superseded, deliver diagnostics, and drain notifications.
  afterFrame(f: FrameState): void {
    this.#closeFrame(f);
    if (f.idle) {
      // Already finished: only what author code queued since is left to deliver.
      this.deliverChanges();
      this.#drain();
      return;
    }
    const a = f.a;
    // The frame's references go now, and the state back to the pool: a pooled state holds nothing of this
    // chart. A frame author code starts from here (below) may take it again; this one is done with it.
    releaseFrame(f);
    // A call made by author code during the frame is drawn by the next one.
    if (!this.#destroyed && this.#accepted !== a) this.schedule();
    // Author code last: the frame is complete before any handler runs.
    this.deliverChanges();
    this.#drain();
  }

  /**
   * Every host mutation of this frame comes from `a`. Author code (formatters, the lazy summary) runs
   * before the first one; if it changed or destroyed the chart, the frame stops with nothing written and
   * the next frame draws the newer state. Once writing has started the frame completes for `a`, so no layer
   * is left on another revision (invariant 3; review 3, controller blocker 1).
   */
  #mutate(f: FrameState): void {
    if (this.#destroyed) throw ABORT;
    if (!f.mutated) {
      if (this.#accepted !== f.a) throw ABORT;
      f.mutated = true;
    }
  }

  #disclosureNow(f: FrameState): Disclosure {
    if (f.discVer !== this.#presentationVersion) {
      f.discVer = this.#presentationVersion;
      const pres = this.#presentationList();
      const known = f.stateDiag;
      f.discCache = known.length === 0 && pres.length === 0 ? EMPTY_DISCLOSURE : readerDisclosure(joinedDiagnostics(known, pres));
    }
    return f.discCache;
  }

  #noteLangFor(f: FrameState, labelsHidden: number, disclosure: Disclosure): string | null {
    if (disclosure.omitted === 0 && disclosure.changed === 0 && labelsHidden === 0) return null;
    const a = f.a!;
    const english = f.english;
    const shownKeys = [disclosure.omitted > 0 ? 'valuesNotShown' : null, disclosure.changed > 0 ? 'valuesChanged' : null,
      labelsHidden > 0 ? 'labelsHidden' : null].filter((k): k is 'valuesNotShown' | 'valuesChanged' | 'labelsHidden' => k !== null);
    const withTable = a.options.table !== false && !f.compact && shownKeys.some(k => a.messages[k].includes('{seeTable}'));
    const keysList: (keyof Messages)[] = withTable ? [...shownKeys, 'seeTable'] : shownKeys;
    return shownKeys.length > 0 && keysList.every(k => english(k)) ? 'en' : null;
  }

  #noteRuns(f: FrameState, r: ReaderModel): { text: string; lang: string | null }[] {
    const runs = (r as ReaderModel & { noteSegments?: readonly { text: string; lang: 'en' | null }[] | null }).noteSegments;
    if (!runs) return [{ text: r.note ?? '', lang: this.#noteLangFor(f, f.currentHidden, this.#disclosureNow(f)) }];
    const out = new Array<{ text: string; lang: string | null }>(runs.length);
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i]!;
      out[i] = { text: run.text, lang: run.lang === 'en' && f.foreignPage ? 'en' : null };
    }
    return out;
  }

  /** The reader's inputs equal `k` (sameKey's rule), without making the array to compare. */
  #readerInputsMatch(k: readonly unknown[], f: FrameState, labelsHidden: number, disclosure: Disclosure): boolean {
    const a = f.a!;
    const o = a.options;
    return k.length === READER_INPUTS && sameEntry(k[0], f.view) && sameEntry(k[1], f.formatters) &&
      sameEntry(k[2], a.messages) && sameEntry(k[3], o.title) && sameEntry(k[4], f.named ? f.by : null) &&
      sameEntry(k[5], o.subtitle) && sameEntry(k[6], o.description) && sameEntry(k[7], disclosure.omitted) &&
      sameEntry(k[8], disclosure.changed) && sameEntry(k[9], labelsHidden) && sameEntry(k[10], o.table) &&
      sameEntry(k[11], f.compact) && sameEntry(k[12], f.locale) && sameEntry(k[13], f.caption);
  }

  #readerFor(f: FrameState, labelsHidden: number, disclosure: Disclosure): ReaderEntry {
    const a = f.a!;
    const shownBefore = this.drawn;
    if (shownBefore && this.#readerInputsMatch(shownBefore.readerInputs, f, labelsHidden, disclosure)) {
      return { reader: shownBefore.reader, inputs: shownBefore.readerInputs };
    }
    const lastReader = f.lastReader;
    if (lastReader && this.#readerInputsMatch(lastReader.inputs, f, labelsHidden, disclosure)) return lastReader;
    const view = f.view, formatters = f.formatters, named = f.named, by = f.by, compact = f.compact, locale = f.locale, caption = f.caption;
    const inputs = [view, formatters, a.messages, a.options.title, named ? by : null, a.options.subtitle,
      a.options.description, disclosure.omitted, disclosure.changed, labelsHidden, a.options.table, compact, locale, caption];
    this.#stage('reader');
    // The summary reads the view, not the name: when only the naming inputs changed, the statistics already
    // written are kept rather than scanned again (finding 11).
    const before = lastReader ?? (shownBefore ? { reader: shownBefore.reader, inputs: shownBefore.readerInputs } : null);
    const kept = before && sameReading(before.inputs, inputs) ? before.reader : null;
    const t = a.options.title;
    const built = readerWith(this.#composition.reader, {
      view, formatters, messages: a.messages, type: chartTypeName(a.messages, this.#kind),
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
      const renamedModel: ReaderModel & { noteSegments: typeof built.noteSegments } = {
        name: built.name, note: built.note, table: built.table, noteSegments: built.noteSegments, get summary() { return summary; },
      };
      return f.lastReader = { reader: renamedModel, inputs };
    }
    return f.lastReader = { reader: built, inputs };
  }

  #settleReader(f: FrameState, labelsHidden: number): ReaderEntry {
    f.currentHidden = labelsHidden;
    const disclosure = this.#disclosureNow(f);
    const settled = f.settled;
    if (settled && f.settledHidden === labelsHidden && sameDisclosure(f.settledDisclosure, disclosure)) return settled;
    let built = this.#readerFor(f, labelsHidden, disclosure);
    // The summary runs author formatters lazily: it is made here, so what they threw on is in the
    // disclosure this settles on, and no reader is built again once writing has started (verification,
    // claims: a throwing value formatter ran again during the figure's write).
    void built.reader.summary;
    const after = this.#disclosureNow(f);
    if (!sameDisclosure(after, disclosure)) {
      built = this.#readerFor(f, labelsHidden, after);
    }
    f.settledHidden = labelsHidden;
    f.settledDisclosure = after;
    return f.settled = built;
  }

  #settleFigureReader(f: FrameState, hidden: number): void {
    const settled = this.#settleReader(f, hidden);
    f.reader = settled.reader;
    f.readerInputs = settled.inputs;
  }

  #modelFor(f: FrameState, r: ReaderModel, small: boolean): FigureModel {
    const a = f.a!;
    const shown = f.shown;
    const compact = f.compact;
    const named = f.named;
    const english = f.english;
    const message = shown.kind === 'ready' ? null : shown.text;
    // A compact chart is one image: its description says what state it is in (C1).
    // Loading and error are not empty (documentation findings 1 and 3): their description is the state, not
    // a reading of data the plot does not show.
    const summary = message === null ? r.summary
      : shown.kind === 'empty' ? (compact ? `${message} ${r.summary}` : r.summary) : message;
    return {
      compact, title: named ? null : f.title, labelledBy: named ? f.by : null, name: r.name || a.name,
      subtitle: stringOption(a.options, 'subtitle'), summary,
      summaryVisible: small, note: f.noteShown ? r.note : null, message,
      messageLang: message !== null && shown.kind !== 'ready' && shown.message ? english(shown.message) : null,
      noteLang: this.#noteLangFor(f, f.currentHidden, this.#disclosureNow(f)),
      // The reader's runs, each in its own language (reader review, finding 5); English is marked only on a
      // page in another language (A10).
      noteSegments: f.noteShown && r.note !== null ? this.#noteRuns(f, r) : null,
      // The generated summary's sentences are the built-in templates; the names in them do not change that.
      summaryLang: message !== null && shown.kind !== 'ready' && shown.kind !== 'empty'
        ? (shown.message && english(shown.message) ? 'en' : null)
        : english('chartSummary') && english('seriesSummary') ? 'en' : null,
    };
  }

  #controlsFor(f: FrameState, r: ReaderModel, small: boolean): ControlsState {
    const a = f.a!;
    const shown = f.shown;
    return {
      kind: this.#kind, view: f.view, formatters: f.formatters, messages: a.messages, reader: r, tooSmall: small,
      ready: shown.kind === 'ready', interactive: !f.compact, tooltip: a.options.tooltip !== false, legend: f.legend,
      // Series that could not be drawn are still rows: the table their sentence points to is offered.
      inspectable: (shown.kind === 'empty' || (shown.kind === 'error' && shown.message === 'seriesNotDrawn')) &&
        (r.table?.rowCount ?? 0) > 0,
      empty: shown.kind === 'empty', message: shown.kind === 'ready' ? null : shown.text,
      zoom: f.zoomOn, zoomed: f.zoomed, streaming: this.#streaming, paused: this.#paused, epoch: a.frame.epoch, english: f.english, pageLang: f.lang, readout: this.#readoutMode,
      // Decision 0004 revision 3, rule 5, for the interaction layer: 'floating', 'strip' or 'none'.
      readoutMode: this.#readoutKind,
    };
  }

  /** The controls state with what the frame drew, in one object (the controls' keys first, as before). */
  #committedFor(f: FrameState, r: ReaderModel, small: boolean, layout: Layout, lookup: Lookup, ratio: number): Committed {
    const a = f.a!;
    const shown = f.shown;
    const painted = this.theme!;
    return {
      kind: this.#kind, view: f.view, formatters: f.formatters, messages: a.messages, reader: r, tooSmall: small,
      ready: shown.kind === 'ready', interactive: !f.compact, tooltip: a.options.tooltip !== false, legend: f.legend,
      inspectable: (shown.kind === 'empty' || (shown.kind === 'error' && shown.message === 'seriesNotDrawn')) &&
        (r.table?.rowCount ?? 0) > 0,
      empty: shown.kind === 'empty', message: shown.kind === 'ready' ? null : shown.text,
      zoom: f.zoomOn, zoomed: f.zoomed, streaming: this.#streaming, paused: this.#paused, epoch: a.frame.epoch, english: f.english, pageLang: f.lang, readout: this.#readoutMode,
      readoutMode: this.#readoutKind,
      layout, lookup, bindings: painted.bindings, theme: painted.theme, pixelRatio: ratio,
    };
  }

  #measurePending(f: FrameState): void {
    if (f.needMeasure) {
      f.needMeasure = false;
      this.sizeDirty = false;
      this.#size = this.host.measure();
    }
  }

  #arrangedFor(f: FrameState, small: boolean): boolean {
    return f.arrangedReader === f.reader && f.arrangedSmall === small && f.arrangedHidden === f.currentHidden &&
      sameDisclosure(f.arrangedDisclosure, this.#disclosureNow(f));
  }

  #arrange(f: FrameState, small: boolean): boolean {
    if (this.#arrangedFor(f, small) && f.arrangedStrip === this.#readoutMode) return false;
    const reader = f.reader;
    f.arrangedReader = reader;
    f.arrangedSmall = small;
    f.arrangedHidden = f.currentHidden;
    f.arrangedDisclosure = this.#disclosureNow(f);
    f.arrangedStrip = this.#readoutMode;
    this.#stage('figure');
    const model = this.#modelFor(f, reader, small);
    this.#mutate(f);
    const moved = this.host.figure.update(model);
    // The legend and toolbar are in place before the plot is measured: they take their share now.
    return this.host.interaction.prepare(this.#controlsFor(f, reader, small)) || moved;
  }

  #plotLayout(f: FrameState, width: number, height: number, strip: number | null): PlotLayout {
    const without = f.withoutLayout;
    if (sameLayoutSize(without, width, height, strip)) return without;
    const result = f.result;
    if (sameLayoutSize(result, width, height, strip)) return result;
    const compact = f.compact;
    // A visible figure that leaves the plot no room is too small (L8), not unmeasured.
    if (!compact && (width <= 0 || height <= 0)) {
      return { layout: { kind: 'too-small', width: Math.max(0, width), height: Math.max(0, height) },
        key: null, width, height, strip };
    }
    const a = f.a!;
    const view = f.view;
    const style = f.style;
    const layoutEpoch = f.layoutEpoch;
    const previous = this.drawn;
    const previousLayout = previous?.plotLayout;
    const sameSize = sameLayoutSize(previousLayout, width, height, strip) && previousLayout.layout.kind !== 'unmeasured';
    if (sameSize && previous && previous.accepted.view === view && previous.accepted.resolved === a.resolved &&
        previous.accepted.options.x === a.options.x && previous.accepted.messages.value === a.messages.value &&
        isCompact(this.#kind, previous.accepted.options) === compact && previous.locale === f.locale &&
        previous.style === style && previous.fontEpoch === layoutEpoch) return previousLayout;
    const at = { width, height };
    const key = this.#composition.layout.layoutKey(view, at, style, layoutEpoch, f.axisContext);
    if (sameSize && sameKey(previousLayout.key, key)) return previousLayout;
    if (sameLayoutSize(this.#lastLayout, width, height, strip) && sameKey(this.#lastLayout.key, key)) return this.#lastLayout;
    this.#stage('layout');
    const computed = { layout: this.#composition.layout.compute(view, at, { measurer: this.host.measurer, style }, f.axisContext), key, width, height, strip };
    this.#lastLayout = computed;
    return computed;
  }

  #layoutForSize(f: FrameState): PlotLayout | null {
    return this.#size === null || this.#size.width <= 0 || f.shown.kind !== 'ready' ? null
      : this.#plotLayout(f, this.#size.width - (this.#fallback?.width ?? 0), this.#size.height - (this.#fallback?.height ?? 0), reservedStrip(this.#size, this.#readoutMode));
  }

  /** The axis context for this frame: the last one while what it holds is the same. */
  #axisContextFor(a: Accepted, locale: string, compact: boolean): AxisContext {
    const xLabelGiven = typeof object(a.options.x).label === 'string';
    const valueTitle = a.messages.value;
    const last = this.#lastAxisContext;
    if (last !== null && last.resolved === a.resolved && last.locale === locale && last.compact === compact &&
        last.xLabelGiven === xLabelGiven && last.valueTitle === valueTitle) return last;
    return this.#lastAxisContext = { resolved: a.resolved, locale, compact, xLabelGiven, valueTitle };
  }

  /** englishFor, made once per messages option rather than once per frame. */
  #englishOf(a: Accepted, foreign: boolean): (key: keyof Messages) => string | null {
    if (!foreign) return INHERIT_LANGUAGE;
    const source = a.options.messages;
    // Only an object is read live by the marking; anything else overrides nothing, so every text is English.
    if (source === null || typeof source !== 'object') return ALL_ENGLISH;
    const memo = this.#englishMemo;
    if (memo !== null && memo.source === source) return memo.english;
    const english = this.#englishFor(a, true);
    this.#englishMemo = { source, english };
    return english;
  }

  // Phase 1: Initial reads & pure CPU prep (zero DOM writes, zero probeColors).
  #phase1(f: FrameState): void {
    const a = f.a!;
    const view = f.view;
    const compact = f.compact;
    this.#stage('frame');
    const shown = f.shown = this.#display(a, f.stateDiag);
    f.noteShown = shown.kind === 'ready' || shown.kind === 'empty' || shown.kind === 'error';
    if (compact) {
      f.style = COMPACT_TEXT_STYLE;
      // Compact charts do not mount the text layer; keep dirty so an upgrade to full reads the real text style.
      this.textStyleDirty = true;
    } else {
      if (this.textStyleDirty) {
        const next = this.host.textStyle();
        if (!sameTextStyle(this.#textStyle, next)) this.#textStyle = next;
        this.textStyleDirty = false;
      }
      f.style = this.#textStyle!;
    }
    f.layoutEpoch = this.fontEpoch;
    // The inherited language is read once and serves the locale and the English marking alike.
    const lang = f.lang = this.host.pageLang();
    const locale = f.locale = this.host.locale(a.options.locale, lang);

    // Formatters. What a formatter threw on belongs to the formatters and the revision it formatted.
    const previous = this.drawn;
    if (previous?.locale === locale && this.#sameFormatInputs(previous.accepted, a)) {
      f.fKey = previous.formattersKey;
      f.formatters = previous.formatters;
    } else {
      const spec = this.#formatSpec(a, locale);
      const fKey = f.fKey = this.#formattersKey(spec, a.resolved.values.length);
      if (previous && sameKey(previous.formattersKey, fKey)) {
        f.formatters = previous.formatters;
      } else {
        this.#stage('formatters');
        // The bucket belongs to the formatters, including any fallback they reported on construction.
        this.#setPresentation('format', EMPTY_DIAGNOSTICS);
        f.formatters = createFormattersWith(spec, new FormatterEnvironment(locale, this), this.#composition.timeReadout);
      }
    }

    // Naming (spec A1): a labelledBy that names nothing falls back to the title or a generated name.
    const by = f.by = stringOption(a.options, 'labelledBy');
    const byText = f.byText = by ? this.host.labelText(by) : null;
    const named = f.named = by !== null && byText !== null;
    const title = f.title = titleOf(a.options);
    this.#setPresentation('naming', by !== null && !named && title === null
      ? [createDiagnostic('AX140', 'none', { detail: `No element has the id "${by}".` }, 'presentation')] : EMPTY_DIAGNOSTICS);
    f.caption = named ? byText!.trim() || undefined : undefined;

    const foreignPage = f.foreignPage = lang !== null && !ENGLISH_TAG.test(lang);
    f.english = this.#englishOf(a, foreignPage);

    // Tick labels are made now, before anything is written: an author tick formatter runs here, never during
    // publication (final review, finding 1), and what it reported belongs to every layout made from them,
    // cached ones included (finding 11).
    const axisContext = f.axisContext = this.#axisContextFor(a, locale, compact);
    if (shown.kind === 'ready' && !compact) this.#composition.layout.prepareTicks?.(view, axisContext);
    // A formatter that changed the chart made findings about a revision that is not drawn (defect 3); what
    // the formatters threw on is reported with the layout, from the ticks it draws (re-check, R12).
    if (!this.#current(a)) throw ABORT;

    this.#settleFigureReader(f, hiddenIn(this.drawn?.layout));
    // The lazy parts of the reader model run author formatters: materialized here, before anything is written.
    void f.reader.summary;
    void f.reader.note;
    if (!this.#current(a)) throw ABORT;

    // Theme check: read-only preparation when the host supports phased theme resolution.
    let needsTheme = this.themeDirty || !this.theme || this.#themeSeries === null || this.#themeColors !== a.options.colors;
    if (needsTheme || view.kind === 'donut') {
      const keys = f.keys = this.themeKeys(view);
      needsTheme ||= !sameKey(this.#themeSeries, keys);
    } else if (!this.#sameSeriesKeys(view, this.#themeSeries!)) {
      f.keys = this.themeKeys(view);
      needsTheme = true;
    }
    f.needsTheme = needsTheme;
    if (needsTheme && this.host.themePrepare) {
      f.preparedTheme = this.host.themePrepare(f.keys!, object(a.options.colors) as Record<string, string>);
    }

    // The fallback is only for a plot; a state message is shown in whatever room there is.
    if (shown.kind !== 'ready' || compact) this.#fallback = null;
    f.tooSmall = this.#fallback !== null;
  }

  // Phase 2: Theme writes + initial arrange.
  #phase2(f: FrameState): void {
    const a = f.a!;
    if (f.needsTheme) {
      this.#mutate(f);
      if (f.preparedTheme !== null && this.host.themeApply) {
        this.#stage('theme');
        this.host.themeApply(f.preparedTheme);
      } else {
        this.resolveTheme(f.keys!, a.options.colors);
      }
    }
    const hadStrip = this.#readoutMode;
    const shown = f.shown;
    if (shown.kind !== 'ready' || f.compact || f.tooSmall || a.options.tooltip === false) {
      this.#readoutMode = false;
      this.#readoutKind = 'floating';
    }
    f.needMeasure = this.#arrange(f, f.tooSmall) || hadStrip !== this.#readoutMode || this.sizeDirty || this.#size === null;
    f.noReadout = shown.kind === 'ready' && f.compact && !f.tooSmall && !this.#readoutMode;
  }

  // Phase 3a (part 1): Verify standard theme declarations after Phase 2 writes (reads only).
  #finishTheme(f: FrameState): void {
    if (f.needsTheme && f.preparedTheme !== null && this.host.themeFinish) {
      const res = this.host.themeFinish(f.preparedTheme, true);
      if (res !== null) this.#applyThemeResolution(res, f.keys!, f.a!.options.colors);
      else f.needsThemeProbe = true;
    }
  }

  // Phase 3a (part 3): Non-standard theme probes (only when a chart uses custom CSS tokens/colors).
  #probeTheme(f: FrameState): void {
    if (f.needsThemeProbe && f.preparedTheme !== null && this.host.themeProbe) {
      this.#probeWrote = true;
      const res = this.host.themeProbe(f.preparedTheme, this.#probeReport ??= this.#probeReportCallback());
      f.needMeasure ||= this.#probeWrote;
      this.#applyThemeResolution(res, f.keys!, f.a!.options.colors);
      f.needsThemeProbe = false;
    }
  }

  // Phase 3b (part 1): Pure layout check; returns true if this chart needs a strip-height probe.
  #layoutCheck(f: FrameState): boolean {
    if (!f.readoutPending) return false;
    this.#measurePending(f);
    f.needsStripProbe = false;
    // Readout mode, decided by layout (rule 5): the plot's rectangle as it is without the strip, laid out in
    // the plot's whole column, is narrower than 240 or shorter than 140 CSS px. The strip is then reserved and
    // the plot measured again; the decision does not depend on the strip, so it cannot flip with it. Held
    // while the plot is too small (L8): that state has no strip.
    f.withoutLayout = null;
    f.narrowPlotHeight = null;
    f.stripAction = null;
    if (this.#size !== null && this.#size.width > 0 && f.shown.kind === 'ready' && !f.compact && !f.tooSmall && f.a!.options.tooltip !== false) {
      const room = this.#size.room ?? this.#size;
      const withoutLayout = f.withoutLayout = this.#plotLayout(f, room.width, room.height, null);
      const without = withoutLayout.layout;
      if (without.kind === 'plot' && (without.plot.width < READOUT_WIDTH || without.plot.height < READOUT_HEIGHT)) {
        f.narrowPlotHeight = without.plot.height;
        // Measure the strip only when it might use space, and re-measure on style or fontEpoch changes.
        if (this.#stripStyle !== f.style || this.#stripFontEpoch !== f.layoutEpoch) {
          f.needsStripProbe = true;
        }
      }
    }
    return f.needsStripProbe;
  }

  // Phase 3b (part 2A): Mount hidden strip-height probe div (write pass, batched across charts).
  #stripMount(f: FrameState): void {
    if (f.needsStripProbe && f.stripProbe === null && this.host.stripProbeMount) {
      f.stripProbe = this.host.stripProbeMount();
    }
  }

  // Phase 3b (part 2B): Read strip-height computed style (read pass, 1 layout across all charts).
  #stripRead(f: FrameState): void {
    if (!f.needsStripProbe) return;
    const style = f.style;
    this.#stripStyle = style;
    this.#stripFontEpoch = f.layoutEpoch;
    const measured = f.stripProbe !== null && this.host.stripProbeRead
      ? this.host.stripProbeRead(f.stripProbe)
      : this.host.stripHeight?.();
    this.#stripHeight = measured !== undefined && Number.isFinite(measured) && measured > 0
      ? measured : 2 * Math.max(24, style.lineHeight);
    f.needsStripProbe = false;
  }

  // Phase 3b (part 3): Pure readout mode decision using measured stripHeight.
  #readoutDecide(f: FrameState): void {
    if (f.readoutPending && this.#size !== null && f.withoutLayout !== null) {
      // Decision 0004 revision 3, rule 5: a plot that, laid out without a strip, is under 240 × 140 has the
      // strip; if the strip would leave it under the L8 minimum of 80 px, there is no strip and no floating
      // tooltip either ('none': pointing highlights the datum; its values are in the keyboard reading and the
      // table). Never floating below the limit (final review, finding 9).
      let next: ReadoutMode = 'floating';
      const narrow = f.narrowPlotHeight;
      if (narrow !== null) {
        if (this.#readoutMode && this.#size.room && this.#size.room.height - this.#size.height > 0) this.#stripHeight = this.#size.room.height - this.#size.height;
        next = narrow - this.#stripHeight >= MIN_PLOT_HEIGHT ? 'strip' : 'none';
      }
      if (next !== this.#readoutKind) {
        this.#readoutKind = next;
        const wantStrip = next === 'strip';
        if (wantStrip !== this.#readoutMode) {
          this.#readoutMode = wantStrip;
          f.stripAction = 'strip-arrange';
        } else {
          f.stripAction = 'prepare-only';
        }
      }
    }
  }

  // Phase 4.0 (writes): Reserve/release readout strip or update floating/none controls.
  #stripWrite(f: FrameState): void {
    if (f.stripAction === 'strip-arrange') {
      // Reserving or giving back the strip always changes the plot: it is measured again.
      this.#arrange(f, f.tooSmall);
    } else if (f.stripAction === 'prepare-only') {
      // Readout switched between 'floating' and 'none' without reserving a strip: only the controls state changes.
      this.#mutate(f);
      this.host.interaction.prepare(this.#controlsFor(f, f.reader, f.tooSmall));
    }
  }

  // Phase 4.0 (reads): Batched re-measure after strip reservation.
  #stripMeasure(f: FrameState): void {
    if (f.stripAction === 'strip-arrange') {
      this.#size = this.host.measure();
    }
    f.stripAction = null;
  }

  // Phase 4.1 (init): Initial layout computation for L8 / hidden-label note convergence loop.
  #layoutInit(f: FrameState): void {
    if (!f.readoutPending) return;
    f.readoutPending = false;
    f.passAction = null;
    // Subtract the fallback's own effect on the plot size so L8 uses the normal plot's room.
    const result = f.result = this.#layoutForSize(f);
    f.layoutDone = result === null;
  }

  // Phase 4.1 (per-pass writes): Drop strip, enter L8 fallback, or arrange hidden-label note.
  #passWrite(f: FrameState): boolean {
    f.passAction = null;
    const result = f.result;
    if (f.layoutDone || result === null || this.#size === null) return false;
    const small = result.layout.kind === 'too-small';
    if (small && this.#readoutMode && f.withoutLayout?.layout.kind === 'plot') {
      // Too small only because of the strip (its real height was more than expected): no strip and no
      // tooltip, and the readable plot stays (rule 5). The measured height keeps the next frame there.
      if (this.#size.room) this.#stripHeight = Math.max(this.#stripHeight, this.#size.room.height - this.#size.height);
      this.#readoutMode = false;
      this.#readoutKind = 'none';
      this.#arrange(f, f.tooSmall);
      f.passAction = 'drop-strip';
      return true;
    }
    if (small && !f.tooSmall) {
      f.normalSize = this.#size;
      f.tooSmall = true;
      this.#readoutMode = false;
      this.#readoutKind = 'floating';
      this.#settleFigureReader(f, 0);
      this.#arrange(f, true);
      f.passAction = 'enter-fallback';
      return true;
    }
    if (!small && f.tooSmall) {
      f.tooSmall = false;
      this.#fallback = null;
      this.#settleFigureReader(f, hiddenIn(result.layout));
      this.#arrange(f, false);
      f.passAction = 'leave-fallback';
      return true;
    }
    if (f.tooSmall) {
      f.layoutDone = true;
      return false;
    }
    // Normal: the note says what this layout hides; if that moves the figure, judge the new size.
    this.#settleFigureReader(f, hiddenIn(result.layout));
    if (!this.#arrange(f, false)) {
      f.layoutDone = true;
      return false;
    }
    f.passAction = 'note-moved';
    return true;
  }

  // Phase 4.1 (per-pass reads): Batched re-measure after pass writes.
  #passMeasure(f: FrameState): boolean {
    const action = f.passAction;
    f.passAction = null;
    if (action === null || this.#size === null) return false;
    if (action === 'drop-strip') {
      this.#size = this.host.measure();
      const result = f.result = this.#layoutForSize(f);
      f.layoutDone = result === null;
    } else if (action === 'enter-fallback') {
      const normal = f.normalSize!;
      this.#size = this.host.measure();
      this.#fallback = { width: (this.#size?.width ?? normal.width) - normal.width, height: (this.#size?.height ?? normal.height) - normal.height };
      if (this.#size === null || this.#size.width <= 0) f.result = null;
      f.layoutDone = true;
    } else if (action === 'leave-fallback') {
      // The estimate let us leave fallback. Only the restored plot's measured room can decide readout.
      this.#size = this.host.measure();
      f.readoutPending = true;
      return true;
    } else if (action === 'note-moved') {
      this.#size = this.host.measure();
      const next = this.#layoutForSize(f);
      f.layoutDone = next === null || f.result === next;
      f.result = next;
    }
    return false;
  }

  #publish(f: FrameState): void {
    const a = f.a!;
    const view = f.view;
    const shown = f.shown;
    const compact = f.compact;
    const result = f.result;
    const layout: Layout = result?.layout ?? {
      kind: 'unmeasured', width: this.#size?.width ?? 0,
      height: this.#size && this.#size.width > 0 && shown.kind !== 'ready' ? Math.max(0, this.#size.height) : this.#size?.height ?? 0,
    };
    if (result !== null) {
      if (view.kind === 'scatter' && a.zoom === null) {
        const x = layout.kind === 'plot' && layout.projection.kind === 'xy' ? layout.projection.x : null;
        if (x && x.type !== 'band' && (x.domain[0] !== view.xFull[0] || x.domain[1] !== view.xFull[1])) {
          if (this.#widenedX?.epoch !== view.frame.epoch || this.#widenedX.drawn !== x.domain) {
            this.#widenedX = { epoch: view.frame.epoch, drawn: x.domain };
          }
        } else {
          this.#widenedX = null;
        }
      }
      if (this.#destroyed) throw ABORT;
    }

    const hidden = hiddenIn(layout);
    this.#reportFit(a, layout, f.tooSmall, hidden);
    // A tick label in the default format is not a value shown differently (F12): its AX160 has no effect on
    // the figure, so the note it would add cannot take room from the ticks and bring the label back (closing
    // pass, item 2).
    const failed = shown.kind === 'ready' && !compact ? this.#composition.layout.tickFormatFailures?.(view, f.axisContext, layout) : undefined;
    this.#setPresentation('layout', failed?.length
      ? failed.map(field => createDiagnostic('AX160', 'none', { field }, 'presentation')) : EMPTY_DIAGNOSTICS);
    const measured = layout.kind !== 'unmeasured' || (shown.kind !== 'ready' && this.#size !== null && this.#size.width > 0 && this.#size.height > 0);
    this.#settleFigureReader(f, hidden);
    if (this.#destroyed) throw ABORT;
    const reader = f.reader;
    const formatters = f.formatters;
    const locale = f.locale;

    // Scene.
    const ratio = this.pixelRatio;
    const previous = this.drawn;
    const sameGeometry = previous?.accepted.view === view && previous.layout === layout;
    let scene: Scene;
    if (sameGeometry && Object.is(previous.pixelRatio, ratio)) scene = previous.scene;
    else {
      this.#stage('scene');
      scene = this.#composition.scene(view, layout, ratio);
    }

    // Lookup reads the frame through the view; it switches with the marks.
    // Scatter ties are decided within half a device pixel: the ratio is part of what the lookup depends on.
    // Compact charts have no interaction, so skip building a lookup until promoted to full.
    let lookup: Lookup;
    if (compact) {
      lookup = EMPTY_LOOKUP;
    } else if (sameGeometry && previous.lookup !== EMPTY_LOOKUP && previous.formatters === formatters &&
        previous.accepted.messages === a.messages && previous.locale === locale &&
        (view.kind !== 'scatter' || Object.is(previous.pixelRatio, ratio))) {
      lookup = previous.lookup;
    } else {
      this.#stage('lookup');
      lookup = this.#composition.lookup(view, layout, formatters, a.messages, locale, ratio);
    }

    // Marks: drawn again for a new scene, a new theme or a new pixel ratio, never rebuilt for a theme alone.
    // A frame that cannot draw (no size) clears what an earlier frame drew, so no marks outlive their rows.
    this.#mutate(f);
    if (this.#surfacesHidden) {
      this.host.surfaces?.(true);
      this.#surfacesHidden = false;
    }
    // Nothing drawn yet and nothing to draw: no call at all (a hidden container stays untouched, L3).
    const paintedTheme = measured ? this.#themeRevision : null;
    const drewBefore = previous ? previous.paintedTheme !== null : this.#hadMarks;
    if (measured ? previous?.paintedTheme !== paintedTheme || previous.scene !== scene || !Object.is(previous.pixelRatio, ratio) : drewBefore) {
      this.#stage('draw');
      this.host.renderer.draw(measured ? scene : this.#emptyScene(), this.theme!.bindings, this.theme!.theme, ratio);
      this.#hadMarks = measured;
    }
    if (this.drawn?.layout !== layout) {
      this.#stage('text');
      this.host.text.render(layout.kind === 'plot' ? layout.texts : []);
    }

    if (!this.#arrangedFor(f, f.tooSmall)) {
      this.#stage('figure');
      this.host.figure.update(this.#modelFor(f, reader, f.tooSmall));
    }

    // A change of state is said once, politely (spec L7). The first state is not announced: it is what
    // the page shows on load, and 24 charts saying "Loading" at once is noise.
    if (this.#announced !== null && this.#announced !== shown.kind) {
      this.host.figure.announce(shown.kind === 'ready' ? this.#readyText(a, reader, f.byText) : shown.text,
        shown.kind !== 'ready' && shown.message ? f.english(shown.message) : null);
    }
    if (measured || this.#announced !== null) this.#announced = shown.kind;

    this.drawn = {
      accepted: a, formatters, formattersKey: f.fKey, locale, style: f.style, fontEpoch: f.layoutEpoch, pixelRatio: ratio,
      layout, plotLayout: result, scene, lookup, reader, readerInputs: f.readerInputs, paintedTheme,
    };
    const committed = this.#committedFor(f, reader, f.tooSmall, layout, lookup, ratio);
    if (__DEV__ && compact) {
      // Dev/test hosts (acceptance tests) may inspect committed.lookup on compact charts; materialize
      // lazily on first access while keeping browser compact charts completely free of lookup allocations.
      Object.defineProperty(committed, 'lookup', {
        enumerable: true,
        configurable: true,
        get: lazyLookup(this.#composition, view, layout, formatters, a.messages, locale, ratio),
      });
    }
    this.host.interaction.commit(committed);
    // The displayed snapshot is now this revision (or nothing, when nothing could be drawn): older rows go.
    this.#showing(measured ? a : null);
    if (this.stages && measured) this.#settle(a.revision);
  }

  #emptyScene(): Scene {
    const width = Math.max(0, this.#size?.width ?? 0);
    const height = Math.max(0, this.#size?.height ?? 0);
    return { width, height, clip: { x: 0, y: 0, width, height }, marks: [] };
  }

  /**
   * Lets the store release every revision no frame needs: the displayed snapshot keeps its own (a store can
   * only retire "everything up to a revision", so a displayed frame older than revisions that were accepted
   * since takes a copy of its rows once the store has grown past twice its last size), and a pending frame
   * that has not been drawn yet keeps its own. Runs after every accepted call and every published frame,
   * whether or not frames run (review 3, controller blockers 2 and 4).
   */
  #release(): void {
    const store = this.#accepted?.store;
    if (!store) return;
    const head = store.frame;
    const screen = this.onScreen?.store === store ? this.onScreen.frame : null;
    const pending = this.#accepted!.frame;
    const running = this.inflight?.store === store ? this.inflight.frame : null;
    const pausedFrame = this.held?.frame;
    let floor = Math.min(this.#pinnedRevision(screen, head), this.#pinnedRevision(pending, head), this.#pinnedRevision(running, head),
      this.#pinnedRevision(pausedFrame, head));
    // Copy only once the store has grown beyond the retention bound, so copying is amortized over arrivals.
    const bound = 2 * this.#retainedBaseline + RETENTION_SLACK;
    if (head.revision - floor > bound || store.retainedRowCount > bound &&
        (this.#pinned(screen, head) || this.#pinned(pending, head) || this.#pinned(running, head) || this.#pinned(pausedFrame, head))) {
      // In this order, each after the copies before it: a frame copied once is not pinned the second time.
      this.#freezePinned(screen, head);
      this.#freezePinned(pending, head);
      this.#freezePinned(running, head);
      this.#freezePinned(pausedFrame, head);
      floor = head.revision;
    }
    if (floor > 0) store.retire(floor - 1);
  }

  /** A frame of the store other than its head whose rows still live only in the store's revisions. */
  #pinned(frame: Frame | null | undefined, head: Frame): frame is Frame {
    return !!frame && frame !== head && !!this.#storeFrames?.has(frame) && !this.#frozenRows?.has(frame);
  }

  #pinnedRevision(frame: Frame | null | undefined, head: Frame): number {
    return this.#pinned(frame, head) ? frame.revision : head.revision;
  }

  #freezePinned(frame: Frame | null | undefined, head: Frame): void {
    if (this.#pinned(frame, head)) (this.#frozenRows ??= new WeakMap()).set(frame, this.#freeze(frame));
  }

  /** The displayed snapshot is now `frame` (or nothing): its rows are owned until the next one is drawn. */
  #showing(a: Accepted | null): void {
    if (this.#destroyed) return;
    const frame = a?.frame ?? null;
    const screen = this.onScreen;
    const store = a?.store ?? null;
    this.onScreen = frame === null ? null : screen !== null && screen.frame === frame && screen.store === store ? screen
      : { frame, store, frozen: null };
    this.#release();
    // The baseline moves only when other data comes on screen: redrawing the same paused frame, a frame that
    // could not be measured, or showing again the frame shown before the chart was hidden does not let the
    // store grow further (final review, finding 2; re-check, C2).
    if (frame !== null && frame.revision !== this.#baselineRevision) {
      this.#baselineRevision = frame.revision;
      this.#retainedBaseline = this.#accepted?.store?.retainedRowCount ?? 0;
    }
  }

  #readyText(a: Accepted, reader: ReaderModel, byText: string | null): string {
    if (reader.name) return reader.name;
    return byText?.trim() || a.name;
  }

  /**
   * An exception in our own pipeline: a complete error revision. The interaction layer is cleared (no old
   * lookup answers the pointer), every output the error state cleared is invalidated so recovery redraws
   * it all, and readiness settles on this revision.
   */
  #failSafe(a: Accepted, error: unknown): void {
    this.#raiseInternal(error);
    this.#showInternal(a.messages, a.name, a.options);
    this.drawn = null;
    // Nothing on screen needs rows any more: the error revision has none.
    this.#showing(null);
    this.#lastLayout = null;
    // The error revision keeps nothing of the options it failed on.
    this.#lastAxisContext = null;
    this.themeDirty = true;
    this.sizeDirty = true;
    if (this.stages) this.#settle(a.revision);
  }

  /** Records a resolved theme and its AX141 presentation finding. */
  #applyThemeResolution(resolution: ThemeResolution, keys: readonly string[], colors: unknown): void {
    this.theme = resolution;
    this.#themeSeries = keys;
    this.#themeColors = colors;
    // A detached chart gets the light defaults; it resolves again in the next frame that draws.
    this.themeDirty = resolution.resolved === false;
    this.#themeRevision++;
    // When the backdrop could not be determined the background is a guess, so contrast is not judged.
    const low = resolution.backdropKnown === false ? [] : lowContrastSeries(resolution.theme).filter(i => i < keys.length);
    this.#setPresentation('theme', low.length ? [createDiagnostic('AX141', 'none', { count: low.length }, 'presentation')] : EMPTY_DIAGNOSTICS);
  }

  /** Resolves the theme for these series keys and writes it (custom properties, scheme) on the figure. */
  resolveTheme(keys: readonly string[], colors: unknown): void {
    this.#stage('theme');
    this.#applyThemeResolution(this.host.theme(keys, object(colors) as Record<string, string>), keys, colors);
  }

  /**
   * The error revision on every layer, each step on its own (one that throws does not stop the others):
   * interaction off first, so no old lookup answers the pointer; then the message; then the mark and text
   * surfaces hidden by the host independently of their draw methods, which may be what failed; then their
   * contents cleared (review 3, controller blocker 3).
   */
  #showInternal(m: Messages, name: string, o: OptionRecord): void {
    const attempt = (step: () => void) => {
      try { step(); } catch { /* the next step still runs */ }
    };
    attempt(() => this.host.interaction.clear());
    attempt(() => this.host.figure.update({
      compact: isCompact(this.#kind, o), title: titleOf(o), labelledBy: null, name,
      subtitle: null, summary: m.internalError, summaryVisible: false, note: null, message: m.internalError,
    }));
    attempt(() => {
      if (this.#announced !== null && this.#announced !== 'internal') this.host.figure.announce(m.internalError);
      this.#announced = 'internal';
    });
    attempt(() => {
      this.host.surfaces?.(false);
      this.#surfacesHidden = true;
    });
    attempt(() => this.host.text.render([]));
    attempt(() => { if (this.theme) this.host.renderer.draw(this.#emptyScene(), this.theme.bindings, this.theme.theme, this.pixelRatio); this.#hadMarks = false; });
  }

  #settle(revision: number): void {
    this.settledRevision = Math.max(this.settledRevision, revision);
    if (!this.waiters || this.waiters.length === 0) return;
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      if (this.waiters[i]!.revision <= revision) this.waiters.splice(i, 1)[0]!.resolve();
    }
  }

  // ── events ─────────────────────────────────────────────────────────────────────────────────────
  /** The public description of a datum, for `hover` and `select`, from the displayed revision. */
  pointFor(d: Drawn, ref: DatumRef): Point<unknown> | null {
    const text = d.lookup.datum(ref);
    if (!text) return null;
    const frame = d.accepted.frame;
    // Where the datum is in its columns, as the lookup located it: values come from the frame, with no search
    // and no second read of the caller's row (re-check, C7 and R6).
    const i = d.lookup.slot(ref);
    let x: XValue = 0;
    let y: number | null = null;
    if (ref.kind === 'aligned' && frame.shape === 'aligned') {
      x = positionValue(frame, ref.x);
      const series = frame.series[text.seriesIndex];
      if (series && i >= 0 && slotState(series, i) === SLOT_VALUE) y = series.y[i]!;
    } else if (ref.kind === 'point' && frame.shape === 'points') {
      const series = frame.series[text.seriesIndex];
      x = positionValue(frame, series && i >= 0 ? series.x[i]! : ref.x);
      if (series && i >= 0) y = series.y[i]!;
    } else if (ref.kind === 'slice' && frame.shape === 'donut') {
      x = text.seriesLabel;
      const at = frame.labels.indexOf(text.seriesLabel);
      if (at >= 0 && frame.slot[at] === SLOT_VALUE) y = frame.values[at]!;
    }
    // The caller's row object, where the event promises it: taken once, through the owned-row accessor. A
    // source that fails now (a row materialized on demand) gives none rather than failing the event.
    let row: unknown = null;
    if (text.row >= 0) {
      try { row = this.rowOf(frame, text.row); } catch { row = null; }
    }
    return { series: ref.kind === 'slice' ? ref.sliceKey : ref.seriesKey, x, y, row, index: text.row };
  }

  /** Calls the listeners with a snapshot taken before any runs; stops when one destroys or changes the chart. */
  /** Every listener subscribed when the event happened gets it, in order; nested events follow (finding 7). */
  emit<E extends keyof ChartEvents<unknown>>(event: E, payload: ChartEvents<unknown>[E] | null): void {
    const set = this.listeners?.get(event);
    if (!set || set.size === 0) return;
    const snapshot = [...set];
    this.#enqueue(() => {
      for (const listener of snapshot) {
        if (this.#destroyed) return;
        try {
          (listener as (p: unknown) => void)(payload);
        } catch (error) {
          this.host.console?.error('[axylo] event listener threw:', error);
        }
      }
    });
  }

  // ── watchers ───────────────────────────────────────────────────────────────────────────────────
  dirtyTextAndStrip(): void {
    this.textStyleDirty = true;
    this.#stripStyle = null;
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#cancelFrameRequest();
    const pending = this.waiters;
    this.waiters = null;
    // Nothing the handle still references keeps the data, the options or the drawing alive.
    this.#accepted = null;
    this.drawn = null;
    this.held = null;
    this.#lastLayout = null;
    this.#lastAxisContext = null;
    this.#textStyle = null;
    this.#stripStyle = null;
    this.#englishMemo = null;
    this.onScreen = null;
    this.#storeFrames = null;
    this.#frozenRows = null;
    this.#rowEnds = null;
    this.#columnRows = null;
    this.theme = null;
    this.#themeSeries = null;
    this.#themeColors = undefined;
    if (this.listeners) { this.listeners.clear(); this.listeners = null; }
    if (this.#presentation) { this.#presentation.clear(); this.#presentation = null; }
    if (this.#deliveredKeys) { this.#deliveredKeys.clear(); this.#deliveredKeys = null; }
    this.#settledInputs = null;
    if (this.#notifications) { this.#notifications.length = 0; this.#notifications = null; }
    this.#options = new OptionsStore({});
    const owner = this.host;
    this.host = new DeadHost(owner.id, owner.renderer.kind);
    this.#deliveryMade = null;
    try {
      owner.dispose();
    } finally {
      if (pending) for (const w of pending) w.resolve();
    }
  }

  /** A phased frame for a multi-chart batch, behind a single-use handle (see FrameHandle). */
  beginFrame(): FrameRun | null {
    const f = this.#startFrame();
    return f ? new FrameHandle(f) : null;
  }
}

/**
 * The handle the page holds. Prototype getters lazily bind and memoize each public method on first access,
 * keeping static charts allocation-free while preserving receiver-independent destructured/callback calls.
 */
class Handle implements ChartHandle {
  readonly #c: ChartController;
  constructor(c: ChartController) { this.#c = c; }
  get update(): (patch: unknown) => void {
    const c = this.#c;
    const fn = (patch: unknown): void => { c.update(patch); };
    Object.defineProperty(this, 'update', { value: fn, enumerable: true, configurable: true });
    return fn;
  }
  get append(): (rows: unknown, options?: { keep?: number }) => void {
    const c = this.#c;
    const fn = (rows: unknown, options?: { keep?: number }): void => { c.append(rows, options); };
    Object.defineProperty(this, 'append', { value: fn, enumerable: true, configurable: true });
    return fn;
  }
  get zoom(): (domain: unknown) => void {
    const c = this.#c;
    const fn = (domain: unknown): void => { c.zoom(domain); };
    Object.defineProperty(this, 'zoom', { value: fn, enumerable: true, configurable: true });
    return fn;
  }
  get on(): <E extends keyof ChartEvents<unknown>>(event: E, listener: (payload: ChartEvents<unknown>[E]) => void) => () => void {
    const c = this.#c;
    const fn = <E extends keyof ChartEvents<unknown>>(event: E, listener: (payload: ChartEvents<unknown>[E]) => void): () => void => {
      if (c.destroyed) return () => {};
      const map = c.listeners ??= new Map();
      let set = map.get(event);
      if (!set) map.set(event, set = new Set());
      set.add(listener as (payload: never) => void);
      // Resolved through the chart's map, which destroy clears and nulls: a kept unsubscribe holds no one else.
      return () => { c.listeners?.get(event)?.delete(listener as (payload: never) => void); };
    };
    Object.defineProperty(this, 'on', { value: fn, enumerable: true, configurable: true });
    return fn;
  }
  get diagnostics(): Diagnostic[] {
    const c = this.#c;
    return c.publicDiagnostics(c.diagnosticInputs());
  }
  get destroy(): () => void {
    const c = this.#c;
    const fn = (): void => { c.destroy(); };
    Object.defineProperty(this, 'destroy', { value: fn, enumerable: true, configurable: true });
    return fn;
  }
}

/** What the interaction layer may ask of one chart; everything goes through the public paths. */
class ChartActions implements ControllerActions {
  constructor(private readonly c: ChartController) {}
  zoom(window: Span | null): void {
    const c = this.c;
    const a = c.accepted;
    if (!a || c.destroyed) return;
    c.zoom(window === null ? null : [positionValue(a.frame, window[0]), positionValue(a.frame, window[1])]);
  }
  toggle(seriesKey: string): void { this.c.toggleSeries(seriesKey); }
  pause(paused: boolean): void { this.c.setPaused(paused); }
  select(ref: DatumRef): void {
    const c = this.c;
    const d = c.drawn;
    const point = d && !c.destroyed ? c.pointFor(d, ref) : null;
    if (point) c.emit('select', point);
  }
  hover(ref: DatumRef | null): void {
    const c = this.c;
    const d = c.drawn;
    if (c.destroyed) return;
    // Nothing is built for a pointer move nobody listens to.
    if (!c.listeners?.get('hover')?.size) return;
    c.emit('hover', d && ref ? c.pointFor(d, ref) : null);
  }
}

/** What the page tells one chart (observers, watchers). */
class ChartInvalidate implements Invalidate {
  constructor(private readonly c: ChartController) {}
  resize(): void {
    const c = this.c;
    if (c.destroyed) return;
    c.sizeDirty = true;
    // Responsive CSS can change the font or spacing with the size (plan 2.2), and the strip's height (R11).
    c.dirtyTextAndStrip();
    c.schedule();
  }
  page(): void {
    const c = this.c;
    if (c.destroyed) return;
    // Back in the document: anything the page could have changed meanwhile is read again, the pixel ratio
    // and web fonts included (review 3, finding 19).
    c.themeDirty = true;
    c.dirtyTextAndStrip();
    c.sizeDirty = true;
    c.pixelRatio = c.host.devicePixelRatio();
    c.fontEpoch++;
    c.schedule();
  }
  theme(): void {
    const c = this.c;
    if (c.destroyed) return;
    c.themeDirty = true;
    c.dirtyTextAndStrip();
    // The colours are resolved and written now, in the observer's callback, so the marks show the new
    // scheme in the first frame after the change (L4): their paint refers to the custom properties written
    // here. The light-dark() defaults follow prefers-color-scheme in CSS. Resolve AX141 when the
    // media query's change event arrives. Only when what is on screen is also what is
    // accepted, so the colours written belong to the marks shown.
    const a = c.accepted;
    const drawn = c.drawn;
    if (!c.inFrame && a && drawn && c.theme && drawn.accepted.view === a.view) {
      try {
        const keys = c.themeKeys(a.view);
        c.resolveTheme(keys, a.options.colors);
        if (!c.themeDirty) c.deliverChanges();
      } catch {
        c.themeDirty = true;
      }
    }
    c.schedule();
  }
  language(): void { this.c.schedule(); }
  fonts(): void {
    const c = this.c;
    if (c.destroyed) return;
    c.fontEpoch++;
    c.dirtyTextAndStrip();
    c.sizeDirty = true;
    c.schedule();
  }
  pixelRatio(): void {
    const c = this.c;
    if (c.destroyed) return;
    c.pixelRatio = c.host.devicePixelRatio();
    c.textStyleDirty = true;
    c.schedule();
  }
}

/** What the instrumentation reads of one chart (development and benchmark builds only). */
class ControllerProbe implements Probe {
  readonly stages: StageCounter;
  constructor(private readonly c: ChartController) { this.stages = c.stages!; }
  revision(): number { return this.c.accepted?.revision ?? 0; }
  ready(): Promise<void> {
    const c = this.c;
    const revision = c.accepted?.revision ?? 0;
    if (c.destroyed || (c.settledRevision >= revision && !c.frameScheduled)) return Promise.resolve();
    return new Promise<void>(resolve => (c.waiters ??= []).push({ revision, resolve }));
  }
  shown(): ReturnType<Probe['shown']> {
    const c = this.c;
    const drawn = c.drawn;
    return drawn && {
      view: drawn.accepted.view, layout: drawn.layout, pixelRatio: c.pixelRatio, scene: drawn.scene,
      streaming: drawn.accepted.store !== null, table: drawn.accepted.source.table,
    };
  }
  renderer(): 'canvas' | 'svg' { return this.c.host.renderer.kind; }
  retainedRows(): number { return this.c.accepted?.store?.retainedRowCount ?? 0; }
  store(): ReturnType<Probe['store']> { return this.c.accepted?.store ?? null; }
  frames(): readonly Frame[] {
    const c = this.c;
    const live = new Set<Frame>();
    for (const f of [c.onScreen?.frame, c.drawn?.accepted.frame, c.accepted?.frame, c.held?.frame, c.inflight?.frame]) if (f) live.add(f);
    return [...live];
  }
}

/** The formatters' environment: their locale, and the viewer's zone read through the chart when first needed. */
class FormatterEnvironment {
  constructor(readonly locale: string, private readonly zone: { readonly timeZone: string }) {}
  get timeZone(): string { return this.zone.timeZone; }
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
  if (frame.binEdges) return { ...frame, revision, xLabel: resolved.x.label };
  const byField = new Map(resolved.values.map(v => [v.field, v]));
  return {
    ...frame, revision, xLabel: resolved.x.label, yLabel: resolved.values.length === 1 ? value!.label : null,
    series: frame.series.map(s => {
      const v = byField.get(s.field) ?? value;
      if (!v) return s;
      // Named by its field (wide form, or one series without a series field), else by its series value.
      return reviseSeries(s, { unit: v.unit, label: resolved.form === 'wide' || resolved.series === null ? v.label : s.label });
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
  frame: Extract<Frame, { shape: 'points' }>, field: string, rows: { rowOf(frame: Frame, row: number): unknown },
): 'day' | 'month' | 'year' | null {
  if (frame.xKind !== 'date') return null;
  const known = pointDateUnits.get(frame);
  if (known) return known;
  let unit: 'day' | 'month' | 'year' = 'year';
  outer: for (const s of frame.series) {
    for (let i = 0; i < s.x.length; i++) {
      const row = rows.rowOf(frame, s.row ? s.row[i]! : i);
      const raw = row !== null && typeof row === 'object' ? (row as Record<string, unknown>)[field] : undefined;
      const u = dateUnitOf(raw);
      if (u === 'day') { unit = 'day'; break outer; }
      if (u === 'month') unit = 'month';
    }
  }
  pointDateUnits.set(frame, unit);
  return unit;
}

/** A frame's source that is a whole table (a static frame over the caller's data). */
function isTable(source: unknown): source is Table {
  const t = source as Partial<Table>;
  return typeof t.isColumnRow === 'function' && typeof t.rowIndex === 'function' && typeof t.length === 'number';
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
    const slots = seriesSlots(s);
    if (!slots) return end > start;
    for (let j = start; j < end; j++) if (drawable(slots[j]!)) return true;
    return false;
  });
}

export type { DiagnosticCode };
