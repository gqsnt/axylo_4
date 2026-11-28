import { FrameSteps } from './frame-phases';
import type { DiagnosticInput, Formatters, Layout, ReaderModel, TextStyle } from './contracts';
import type { Messages } from '../public';
import type { ControlsState } from '../dom/interaction';
import type { AxisContext } from './axes';
import type { titleOf } from './stages';
import type { Accepted, Disclosure, Display, FrameRun, PlotLayout, ReaderEntry, Size } from './controller-types';

export const enum PassAction { None, DropStrip, EnterFallback, LeaveFallback, NoteMoved }
export const enum StripAction { None, Arrange, Prepare }

/** What a frame's steps reach in their controller: made once per chart. */
export interface FrameDriver {
  afterFrame(f: FrameState): void;
  removeStripProbe(f: FrameState): void;
  frameStep(f: FrameState, phase: Exclude<keyof FrameRun, 'after' | 'phase3StripRemove'>): boolean;
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

/** The strip reserved under the plot at this size, null when no strip is reserved. */
export function reservedStrip(at: Size, strip: boolean): number | null {
  return strip ? (at.room ? Math.max(0, at.room.height - at.height) : 0) : null;
}

/**
 * One frame's state. Finished states go back to a small pool shared by every chart
 * (acquireFrame, releaseFrame), so a steady stream of frames allocates no closures and no scope, and a chart
 * that is not drawing keeps none; its accepted revision stays fixed until publication. Every
 * field is set in the constructor, so the shape never changes.
 */
export class FrameState extends FrameSteps {
  protected get state() { return this; }
  after(): void { this.driver!.afterFrame(this); }

  /** The controller running this frame; null once the state is back in the pool, so a stale handle does nothing. */
  declare driver: FrameDriver | null;
  declare closed: boolean;
  declare a: Accepted | null;
  get view() { return this.a!.view; }
  declare compact: boolean;
  declare stateDiag: readonly DiagnosticInput[];
  declare zoomOn: ControlsState['zoom'];
  declare zoomed: boolean;
  declare legend: ControlsState['legend'];
  /** The strip-height probe while it is in the figure (mounted early or after the measure). */
  declare stripProbe: unknown;
  declare mutated: boolean;
  declare style: TextStyle;
  declare layoutEpoch: number;
  declare locale: string;
  declare shown: Display;
  declare lang: string | null;
  declare fKey: readonly unknown[];
  declare formatters: Formatters;
  declare by: string | null;
  declare title: ReturnType<typeof titleOf>;
  declare caption: string | undefined;
  declare english: (key: keyof Messages) => string | null;
  declare axisContext: AxisContext;
  declare keys: string[] | null;
  declare preparedTheme: unknown;
  declare needsThemeProbe: boolean;
  declare tooSmall: boolean;
  declare arrangedReader: ReaderModel | null;
  declare arrangedSmall: boolean;
  declare arrangedDisclosure: Disclosure;
  declare arrangedStrip: boolean | undefined;
  declare needMeasure: boolean;
  declare withoutLayout: PlotLayout | null;
  declare readoutPending: boolean;
  declare narrowPlotHeight: number | null;
  declare needsStripProbe: boolean;
  declare stripAction: StripAction;
  declare result: PlotLayout | null;
  declare layoutDone: boolean;
  declare passAction: PassAction;
  declare normalSize: Size | null;
  declare discVer: number;
  declare discCache: Disclosure;
  declare lastReader: ReaderEntry | null;
  declare currentHidden: number;
  declare settled: ReaderEntry | null;
  declare readerVersion: number;

  constructor() { super(); this.clear(); }

  /** The pool keeps no controller, revision, view or reader and always hands back the same initial state. */
  clear(): void {
    this.mutated = false;
    this.layoutEpoch = 0;
    this.needsThemeProbe = false;
    this.tooSmall = false;
    this.arrangedSmall = false;
    this.arrangedStrip = undefined;
    this.needMeasure = false;
    this.readoutPending = true;
    this.narrowPlotHeight = null;
    this.needsStripProbe = false;
    this.stripAction = StripAction.None;
    this.layoutDone = true;
    this.passAction = PassAction.None;
    this.discVer = -1;
    this.currentHidden = 0;
    this.readerVersion = -1;
    this.closed = true;
    this.driver = null;
    this.stripProbe = null;
    this.locale = '';
    this.lang = null;
    this.by = null;
    this.caption = undefined;
    this.arrangedDisclosure = EMPTY_DISCLOSURE;
    this.discCache = EMPTY_DISCLOSURE;
    this.a = null;
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
}

/**
 * Idle frame states shared by every chart. Frames run synchronously (flush, or one phased batch that ends
 * every frame it began), so a single chart or a batch of up to this many reuses states and allocates none,
 * while a page of static charts retains at most this many in all rather than one per chart.
 */
const FRAME_POOL_SIZE = 4;
/** Made on the first release, so importing the module allocates nothing. */
let framePool: FrameState[] | null = null;

export function acquireFrame(driver: FrameDriver, accepted: Accepted): FrameState {
  const f = framePool?.pop() ?? new FrameState();
  f.driver = driver;
  f.closed = false;
  f.a = accepted;
  return f;
}

/** Clears the finished state and keeps it if the pool has room; nothing else may use the state afterwards. */
export function releaseFrame(f: FrameState): void {
  const pool = framePool ??= [];
  if (pool.length < FRAME_POOL_SIZE) {
    f.clear();
    pool.push(f);
  }
}
