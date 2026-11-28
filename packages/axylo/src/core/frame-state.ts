import type { DiagnosticInput, Formatters, Layout, ReaderModel, TextStyle, View } from './contracts';
import type { Messages } from '../public';
import type { ControlsState } from '../dom/interaction';
import type { AxisContext } from './axes';
import type { titleOf } from './stages';
import type { Accepted, Disclosure, Display, FrameRun, PlotLayout, ReaderEntry, Size } from './controller-types';

/** What a frame's steps reach in their controller: made once per chart. */
export interface FrameDriver {
  frameStep(f: FrameState, id: number): boolean;
  removeStripProbe(f: FrameState): void;
  finishFrame(f: FrameState): void;
  afterFrame(f: FrameState): void;
}

/** Shared neutral text style used for compact charts, which never lay out text labels. */
export const COMPACT_TEXT_STYLE: TextStyle = { font: '', letterSpacing: 0, wordSpacing: 0, lineHeight: 0 };
/** Shared empty collections and singletons to avoid per-chart and per-frame allocations on clean/compact charts. */
export const EMPTY_DIAGNOSTICS: readonly DiagnosticInput[] = [];
export const EMPTY_DISCLOSURE: Disclosure = { omitted: 0, changed: 0 };
export const INHERIT_LANGUAGE = (): null => null;

export const READY: Display = { kind: 'ready' };

/** A state shown in a built-in message. */
export const builtIn = (kind: Exclude<Display['kind'], 'ready'>, m: Messages, message: 'internalError' | 'loading' | 'error' | 'empty'): Display =>
  ({ kind, text: m[message], message });

export function sameLayoutSize(layout: PlotLayout | null | undefined, width: number, height: number, strip: number | null): layout is PlotLayout {
  return !!layout && Object.is(layout.width, width) && Object.is(layout.height, height) && layout.strip === strip;
}

/** Steps of a frame, dispatched by the controller's one step function (no closure per step or per frame). */
export const STEP_PHASE1 = 0;
export const STEP_PHASE2 = 1;
export const STEP_THEME = 2;
export const STEP_MEASURE = 3;
export const STEP_PROBE = 4;
export const STEP_LAYOUT_CHECK = 5;
export const STEP_STRIP_MOUNT = 6;
export const STEP_STRIP_READ = 7;
export const STEP_READOUT = 8;
export const STEP_STRIP_WRITE = 9;
export const STEP_STRIP_MEASURE = 10;
export const STEP_INIT = 11;
export const STEP_PASS_WRITE = 12;
export const STEP_PASS_MEASURE = 13;
export const STEP_PUBLISH = 14;

/** How many inputs the reader model is keyed by (readerFor). */
export const READER_INPUTS = 15;
export const EMPTY_KEY: readonly unknown[] = [];
/** On a page in another language with no message overrides, mark every built-in text as English. */
export const ALL_ENGLISH = (): string => 'en';

/** The hidden tick labels of a plot layout (x and y), 0 for anything else. */
export function hiddenIn(l: Layout | undefined): number {
  return l?.kind === 'plot' ? l.fit.x.hidden + l.fit.y.hidden : 0;
}

export function sameDisclosure(a: Disclosure, b: Disclosure): boolean {
  return a.omitted === b.omitted && a.changed === b.changed;
}

/** One position of sameKey's rule: the same value, or arrays with the same entries. */
export function sameEntry(x: unknown, y: unknown): boolean {
  if (Object.is(x, y)) return true;
  return Array.isArray(x) && Array.isArray(y) && x.length === y.length && x.every((v, k) => v === y[k]);
}

/** The strip reserved under the plot at this size, null when no strip is reserved. */
export function reservedStrip(at: Size, strip: boolean): number | null {
  return strip ? (at.room ? Math.max(0, at.room.height - at.height) : 0) : null;
}

/** The readout steps of a single-chart frame, in the order the batch runs them across charts. */
export function readoutSteps(run: FrameState): void {
  if (run.compact && !run.needMeasure) {
    run.phase4Init();
    return;
  }
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
 * Both the private flush and the external batch run these steps. A batch owns a single-use handle:
 * detach its private reference before returning the state to the pool or delivering author callbacks.
 */
export class FrameHandle implements FrameRun {
  #state: FrameState | null;
  constructor(state: FrameState | null) {
    // A private flush runs the state itself. Only an external handle is detached on completion.
    this.#state = state ?? (this instanceof FrameState ? this : null);
  }
  phase1(): void { const f = this.#state; f?.driver?.frameStep(f, STEP_PHASE1); }
  phase2(): void { const f = this.#state; f?.driver?.frameStep(f, STEP_PHASE2); }
  phase3Theme(): void {
    const f = this.#state;
    if (f && f.preparedTheme !== null) f.driver?.frameStep(f, STEP_THEME);
  }
  phase3Measure(): void {
    const f = this.#state;
    if (f && f.needMeasure) f.driver?.frameStep(f, STEP_MEASURE);
  }
  phase3Probe(): void {
    const f = this.#state;
    if (f && f.needsThemeProbe) f.driver?.frameStep(f, STEP_PROBE);
  }
  phase3LayoutCheck(): boolean {
    const f = this.#state;
    return !!f && (!f.compact || f.needMeasure) && (f.driver?.frameStep(f, STEP_LAYOUT_CHECK) ?? false);
  }
  phase3StripMount(): void {
    const f = this.#state;
    if (f && f.needsStripProbe) f.driver?.frameStep(f, STEP_STRIP_MOUNT);
  }
  phase3StripRead(): void {
    const f = this.#state;
    if (f && f.needsStripProbe) f.driver?.frameStep(f, STEP_STRIP_READ);
  }
  phase3ReadoutDecide(): void {
    const f = this.#state;
    if (f && f.withoutLayout) f.driver?.frameStep(f, STEP_READOUT);
  }
  phase4StripWrite(): void {
    const f = this.#state;
    if (f && f.stripAction) f.driver?.frameStep(f, STEP_STRIP_WRITE);
  }
  phase4StripMeasure(): void {
    const f = this.#state;
    if (f && f.stripAction) f.driver?.frameStep(f, STEP_STRIP_MEASURE);
  }
  phase4Init(): void {
    const f = this.#state;
    if (f && f.readoutPending) f.driver?.frameStep(f, STEP_INIT);
  }
  phase4PassWrite(): boolean {
    const f = this.#state;
    return !!f && !f.layoutDone && (f.driver?.frameStep(f, STEP_PASS_WRITE) ?? false);
  }
  phase4PassMeasure(): boolean {
    const f = this.#state;
    return !!f && f.passAction !== null && (f.driver?.frameStep(f, STEP_PASS_MEASURE) ?? false);
  }
  phase3StripRemove(): void { const f = this.#state; f?.driver?.removeStripProbe(f); }
  phase5(): void { const f = this.#state; f?.driver?.finishFrame(f); }
  after(): void {
    const f = this.#state;
    this.#state = null;
    f?.driver?.afterFrame(f);
  }
}

/**
 * One frame's state and its phased handle. Finished states go back to a small pool shared by every chart
 * (acquireFrame, releaseFrame), so a steady stream of frames allocates no closures and no scope, and a chart
 * that is not drawing keeps none; the fields are what each frame started from before (see `begin`). Every
 * field is set in the constructor, so the shape never changes.
 */
export class FrameState extends FrameHandle {
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
  keys: string[] | null = null;
  preparedTheme: unknown = null;
  needsThemeProbe = false;
  tooSmall = false;
  arrangedReader: ReaderModel | null = null;
  arrangedSmall = false;
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
  discVer = -1;
  discCache: Disclosure = EMPTY_DISCLOSURE;
  lastReader: ReaderEntry | null = null;
  currentHidden = 0;
  settled: ReaderEntry | null = null;
  readerVersion = -1;

  constructor(driver: FrameDriver) {
    super(null);
    this.driver = driver;
  }

  /** References are already clear, both on a new state and on one returned to the pool. */
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
  }

  /** A fresh state already has these defaults. Only one borrowed back from the pool needs them reset. */
  reuse(driver: FrameDriver): void {
    this.driver = driver;
    this.mutated = false;
    this.layoutEpoch = 0;
    this.noteShown = false;
    this.named = false;
    this.foreignPage = false;
    this.needsThemeProbe = false;
    this.tooSmall = false;
    this.arrangedSmall = false;
    this.arrangedStrip = undefined;
    this.needMeasure = false;
    this.readoutPending = true;
    this.narrowPlotHeight = null;
    this.needsStripProbe = false;
    this.stripAction = null;
    this.layoutDone = true;
    this.passAction = null;
    this.discVer = -1;
    this.currentHidden = 0;
    this.readerVersion = -1;
  }

  /** Lets go of everything the finished frame referenced: a pooled state holds no controller, revision, view or reader. */
  clear(): void {
    this.idle = true;
    this.driver = null;
    this.stripProbe = null;
    this.locale = '';
    this.lang = null;
    this.byText = null;
    this.by = null;
    this.caption = undefined;
    this.arrangedDisclosure = EMPTY_DISCLOSURE;
    this.discCache = EMPTY_DISCLOSURE;
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
    this.keys = null;
    this.preparedTheme = null;
    this.arrangedReader = null;
    this.withoutLayout = null;
    this.result = null;
    this.normalSize = null;
    this.lastReader = null;
    this.settled = null;
  }

  // A private flush keeps its own handle and drops the controller in clear().
  override after(): void { this.driver?.afterFrame(this); }
}

/**
 * Idle frame states shared by every chart. Frames run synchronously (flush, or one phased batch that ends
 * every frame it began), so a single chart or a batch of up to this many reuses states and allocates none,
 * while a page of static charts retains at most this many in all rather than one per chart.
 */
const FRAME_POOL_SIZE = 4;
/** Made on the first release, so importing the module allocates nothing. */
let framePool: FrameState[] | null = null;

export function acquireFrame(driver: FrameDriver): FrameState {
  const f = framePool?.pop();
  if (!f) return new FrameState(driver);
  f.reuse(driver);
  return f;
}

/** Clears the finished state and keeps it if the pool has room; nothing else may use the state afterwards. */
export function releaseFrame(f: FrameState): void {
  f.clear();
  const pool = framePool ??= [];
  if (pool.length < FRAME_POOL_SIZE) pool.push(f);
}
