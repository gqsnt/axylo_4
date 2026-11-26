import type { DiagnosticInput, Formatters, Layout, ReaderModel, TextStyle, View } from './contracts';
import type { Messages } from '../public';
import type { ControlsState } from '../dom/interaction';
import type { AxisContext } from './axes';
import type { titleOf } from './stages';
import type { Accepted, Disclosure, Display, FrameDriver, FrameRun, PlotLayout, ReaderEntry, Size } from './controller-types';

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
export const READER_INPUTS = 14;
export const EMPTY_KEY: readonly unknown[] = [];
/** Not global and not sticky, so `test` keeps no state between pages. */
export const ENGLISH_TAG = /^en(?:-|$)/i;
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
export function readoutSteps(run: FrameRun): void {
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
export class FrameState implements FrameRun {
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
  phase1(): void { runStep(this, STEP_PHASE1); }
  phase2(): void { runStep(this, STEP_PHASE2); }
  phase3Theme(): void { runStep(this, STEP_THEME); }
  phase3Measure(): void { runStep(this, STEP_MEASURE); }
  phase3Probe(): void { runStep(this, STEP_PROBE); }
  phase3LayoutCheck(): boolean { return runStep(this, STEP_LAYOUT_CHECK); }
  phase3StripMount(): void { runStep(this, STEP_STRIP_MOUNT); }
  phase3StripRead(): void { runStep(this, STEP_STRIP_READ); }
  /** Unconditional, even on error or after the frame closed. */
  phase3StripRemove(): void { this.driver?.removeStripProbe(this); }
  phase3ReadoutDecide(): void { runStep(this, STEP_READOUT); }
  phase4StripWrite(): void { runStep(this, STEP_STRIP_WRITE); }
  phase4StripMeasure(): void { runStep(this, STEP_STRIP_MEASURE); }
  phase4Init(): void { runStep(this, STEP_INIT); }
  phase4PassWrite(): boolean { return runStep(this, STEP_PASS_WRITE); }
  phase4PassMeasure(): boolean { return runStep(this, STEP_PASS_MEASURE); }
  phase5(): void { this.driver?.finishFrame(this); }
  after(): void { this.driver?.afterFrame(this); }
}

/** Module-level step helper avoids adding a V8 private-brand slot to pooled FrameState instances. */
function runStep(frame: FrameState, step: number): boolean {
  return frame.driver?.frameStep(frame, step) ?? false;
}

/**
 * Single-use handle around a pooled FrameState for external phased callers (`beginFrame()`).
 * Becomes permanently inert once `after()` returns the backing state to the pool, so a stale
 * handle can never reach another chart that later acquires the same FrameState.
 */
export class FrameHandle implements FrameRun {
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

export function acquireFrame(driver: FrameDriver): FrameState {
  const f = framePool?.pop() ?? new FrameState(driver);
  f.driver = driver;
  return f;
}

/** Clears the finished state and keeps it if the pool has room; nothing else may use the state afterwards. */
export function releaseFrame(f: FrameState): void {
  f.clear();
  const pool = framePool ??= [];
  if (pool.length < FRAME_POOL_SIZE) pool.push(f);
}
