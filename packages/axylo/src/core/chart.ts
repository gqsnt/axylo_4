/**
 * `createChart`: the browser host of the controller (controller.ts). It resolves the target, builds the
 * figure, the mark and text renderers and the interaction layer, and connects the page's observers to the
 * controller. Every setup step counts as done as soon as it succeeded, and release undoes the steps done in
 * reverse order, so a failure part-way through creation, or `destroy()`, leaves the target as it was
 * (including the custom properties the theme wrote on it).
 *
 * The host is one object per chart (BrowserHost) whose methods are shared through its prototype: a page of
 * sparklines makes no closure per chart for the host's callbacks. It is its own text layer, figure proxy,
 * frame entry, geometry and font-probe listener; the observers and watchers it joins hold it by identity.
 *
 * Document-level listeners (theme and environment watchers, the interaction layer's keyboard and pointer
 * listeners on the document) are released when the target leaves the document without `destroy()`, so a
 * forgotten chart does not stay reachable from the page, and are attached again if the target comes back.
 * Detachment is noticed by the observers the chart already has (the resize observer reports a zero box),
 * not by polling.
 */
import type { DatumRef, MarkRenderer, PlacedText, TextMeasurer, TextStyle } from './contracts';
import { svgRendererWith } from '../render/svg';
import { createTextLayer, type TextLayer } from '../render/text';
import { ensureStyles, resolveTheme, watchTheme, type ThemeResolution } from '../theme';
import { themeMedia } from '../theme/watch';
import {
  applyTheme, createThemeBatch, finalizeTheme, prepareTheme, probeTheme,
  type PreparedTheme, type ThemeBatch,
} from '../theme/resolve';
import { createFigure, type Figure, type FigureModel } from '../dom/figure';
import { shadowRootOf } from '../dom/attributes';
import { createInteraction, type Committed, type ControlsState, type Interaction } from '../dom/interaction';
import { mappingOf } from '../dom/mapping';
import type { DeliveryConsole } from './delivery';
import {
  createMeasurer, joinEnvironment, LanguageWatch, leaveEnvironment, noteFontLoad, observeFontProbe, observeGeometry, pageLanguage,
  readTextStyle, resolveLocale, viewerTimeZone,
  type EnvSubscriber, type FontProbeListener, type GeometryListener, type GeometryRegistration, type ProbeRegistration,
} from './environment';
import {
  controllerFor, type ChartHandle, type Controller, type ControllerActions, type FrameRun, type Host, type Size,
} from './controller';
import type { Composition } from './composition';
import type { Span } from './stages';

export type { BenchHook, ChartHandle, ChartKind, DevHook, Stage } from './controller';

export interface ChartEnvironmentOverrides {
  readonly console?: DeliveryConsole | null;
}

/**
 * Per-document theme batch of a multi-chart rAF Phase 1, made when the first chart of the batch prepares its
 * theme: most frames of a dashboard (a stream, a resize) prepare none, and then read no media query at all.
 * `batch` is undefined until made and null when making it failed (each chart then resolves on its own).
 */
interface LazyThemeBatch {
  readonly win: Window;
  batch: ThemeBatch | null | undefined;
}
const activeThemeBatches = new WeakMap<Document, LazyThemeBatch>();

function themeBatchFor(doc: Document): ThemeBatch | undefined {
  const lazy = activeThemeBatches.get(doc);
  if (!lazy) return undefined;
  if (lazy.batch === undefined) {
    try { lazy.batch = createThemeBatch(lazy.win, themeMedia(lazy.win)); }
    catch { lazy.batch = null; }
  }
  return lazy.batch ?? undefined;
}

/** A chart waiting for the next animation frame: its controller for a phased batch, and what runs it alone. */
interface ScheduledEntry {
  entryController(): Controller | null;
  runEntry(time?: number): void;
}

/** scheduleFrame's entry for a caller that gives functions. */
class CallbackEntry implements ScheduledEntry {
  constructor(private readonly get: () => Controller | null, private readonly cb: (time?: number) => void) {}
  entryController(): Controller | null { return this.get(); }
  runEntry(time?: number): void { this.cb(time); }
}

interface FrameScheduler {
  readonly pending: Map<number, ScheduledEntry>;
  rafId: number;
}

/** Globally monotonic frame handle counter so handles never collide across successive rAF batches. */
let nextFrameHandle = 0;

/** Shared per-window rAF scheduler: runs single charts directly, and phases reads/writes across multi-chart batches. */
const schedulers = new WeakMap<Window, FrameScheduler>();

export function scheduleFrame(win: Window, doc: Document, get: () => Controller | null, cb: (time?: number) => void): number {
  return scheduleEntry(win, doc, new CallbackEntry(get, cb));
}

/** scheduleFrame with an entry the caller keeps: a chart makes its one entry once rather than one per frame. */
function scheduleEntry(win: Window, doc: Document, entry: ScheduledEntry): number {
  let sched = schedulers.get(win);
  if (!sched) schedulers.set(win, sched = { pending: new Map(), rafId: 0 });
  const handle = ++nextFrameHandle;
  sched.pending.set(handle, entry);
  if (!sched.rafId) {
    const active = sched;
    active.rafId = win.requestAnimationFrame(time => {
      active.rafId = 0;
      if (schedulers.get(win) === active) schedulers.delete(win);
      if (active.pending.size === 1) {
        const entry = active.pending.values().next().value!;
        active.pending.clear();
        entry.runEntry(time);
        return;
      }
      const batch = [...active.pending.values()];
      active.pending.clear();
      if (batch.length) runPhasedBatch(win, doc, batch, time);
    });
  }
  return handle;
}

export function cancelScheduledFrame(win: Window, handle: number): void {
  const sched = schedulers.get(win);
  if (!sched) return;
  sched.pending.delete(handle);
  if (!sched.pending.size) {
    if (sched.rafId) { win.cancelAnimationFrame(sched.rafId); sched.rafId = 0; }
    schedulers.delete(win);
  }
}

function runPhasedBatch(win: Window, doc: Document, batch: readonly ScheduledEntry[], time: number): void {
  const themeBatch: LazyThemeBatch = { win, batch: undefined };
  const runs: FrameRun[] = [];
  activeThemeBatches.set(doc, themeBatch);
  try {
    // Phase 1: Initial reads & pure prep across all pending charts (zero DOM writes, zero probeColors).
    for (const item of batch) {
      const c = item.entryController();
      if (!c) { item.runEntry(time); continue; }
      const run = c.beginFrame();
      if (run) { runs.push(run); run.phase1(); }
    }
  } finally {
    if (activeThemeBatches.get(doc) === themeBatch) activeThemeBatches.delete(doc);
  }
  const each = (fn: keyof FrameRun): void => {
    for (const run of runs) run[fn]();
  };
  const any = (fn: 'phase3LayoutCheck' | 'phase4PassWrite' | 'phase4PassMeasure'): boolean => {
    let hit = false;
    for (const run of runs) if (run[fn]()) hit = true;
    return hit;
  };
  const readout = (): void => {
    if (any('phase3LayoutCheck')) {
      each('phase3StripMount');
      try { each('phase3StripRead'); } finally { each('phase3StripRemove'); }
    }
    each('phase3ReadoutDecide');
    each('phase4StripWrite');
    each('phase4StripMeasure');
    each('phase4Init');
  };
  each('phase2');
  // Measured first: that layout brings style up to date for the theme's reads, which then start no style pass
  // of their own. A late theme probe that moved a figure has it measured again; the others measure nothing.
  each('phase3Measure');
  each('phase3Theme');
  each('phase3Probe');
  each('phase3Measure');
  readout();
  for (let pass = 0; pass < 4 && any('phase4PassWrite'); pass++) {
    if (any('phase4PassMeasure')) readout();
  }
  each('phase5');
  each('after');
}

/** Suffixes of the ids a chart gives its elements (figure, interaction, table). */
const ID_SUFFIXES = ['', '-t', '-st', '-s', '-m', '-n', '-i', '-proxy', '-table', '-table-caption', '-table-jump', '-table-jump-error'];
let instances = 0;

/** An id prefix none of whose element ids exist in the page yet (spec A1: ids unique per chart). */
function allocateId(doc: Document, tree: Document | ShadowRoot): string {
  const shadow = tree === doc ? null : tree;
  next: for (;;) {
    const id = `axylo-${++instances}`;
    for (const suffix of ID_SUFFIXES) {
      const candidate = id + suffix;
      if (doc.getElementById(candidate) || shadow?.getElementById(candidate)) continue next;
    }
    return id;
  }
}

/** Setup steps, in order; release undoes the ones done, from the last. */
const STEP_RENDERER = 1;
const STEP_TEXT = 2;
const STEP_FIGURE = 3;
const STEP_INTERACTION = 4;
const STEP_WATCHERS = 5;
const STEP_PROBE = 6;
const STEP_GEOMETRY = 7;

/** The interaction layer's way into the chart, made before the controller exists. */
class HostActions implements ControllerActions {
  constructor(private readonly host: BrowserHost) {}
  zoom(window: Span | null): void { this.host.controller?.actions.zoom(window); }
  toggle(seriesKey: string): void { this.host.controller?.actions.toggle(seriesKey); }
  pause(paused: boolean): void { this.host.controller?.actions.pause(paused); }
  select(ref: DatumRef): void { this.host.controller?.actions.select(ref); }
  hover(ref: DatumRef | null): void { this.host.controller?.actions.hover(ref); }
}

/** A compact chart's interaction layer: made only if the chart is updated to full mode. */
class LazyInteraction implements Interaction {
  #real: Interaction | null = null;
  private attached = false;
  constructor(private readonly host: BrowserHost) {}
  #ensure(): Interaction {
    let real = this.#real;
    if (!real) {
      real = this.#real = this.host.makeInteraction();
      if (!this.attached) real.detach();
    }
    return real;
  }
  prepare(state: ControlsState): boolean { return !state.interactive && !this.#real ? false : this.#ensure().prepare(state); }
  commit(state: Committed | null): void { if ((state && state.interactive) || this.#real) this.#ensure().commit(state); }
  clear(): void { this.#real?.clear(); }
  attach(): void { this.attached = true; this.#real?.attach(); }
  detach(): void { this.attached = false; this.#real?.detach(); }
  destroy(): void { this.#real?.destroy(); this.#real = null; }
}

/** One per chart: everything the controller needs from the page, and the page's observers of the chart. */
class BrowserHost implements Host, ScheduledEntry, GeometryListener, FontProbeListener {
  readonly id: string;
  readonly targetId: string | null;
  readonly console: DeliveryConsole | null;
  readonly page: Document;
  readonly renderer: MarkRenderer;
  readonly text: Host['text'];
  readonly figure: Host['figure'];
  readonly interaction: Interaction;
  readonly measurer: TextMeasurer;

  controller: Controller | null;
  readonly #composition: Composition;
  readonly #root: HTMLElement;
  readonly #win: Window & typeof globalThis;
  readonly #isDonut: boolean;
  readonly #parts: Figure;
  /** The plot and the figure: what the size observers watch. */
  readonly #geometryTargets: readonly Element[];
  /** How many setup steps succeeded (STEP_*). */
  #built: number;
  #disposed: boolean;
  #tree: Document | ShadowRoot;

  #textLayer: TextLayer | null;
  #textMounted: boolean;
  #textHidden: boolean;

  /** Watchers that the document holds; released while the target is out of the document. */
  #watching: boolean;
  #watchedBefore: boolean;
  #stopTheme: (() => void) | null;
  #environment: EnvSubscriber | null;
  #language: LanguageWatch | null;
  #interactionAttached: boolean;

  /**
   * Deferred font-load probe until first non-empty text render so compact/donut charts skip it. The probe
   * stays in this chart's text layer (it inherits the chart's font and spacing); the observer is the
   * document's shared one.
   */
  #fontProbe: HTMLDivElement | null;
  #probeRegistration: ProbeRegistration | null;
  /** One strip-height probe per chart, made when first asked for: it is mounted for a read and taken out again. */
  #stripHolder: HTMLDivElement | null;

  /**
   * Size and attachment. While the target is in the document its figure and plot are observed on the
   * document's shared ResizeObserver; while it is out, on a chart-local one, so a forgotten chart is not
   * reachable from the page and its return is still noticed. Observers are never started from inside a
   * ResizeObserver delivery (that would be reported as a resize loop): the switch waits for the next frame.
   */
  #geometry: GeometryRegistration | null;
  #detachedObserver: ResizeObserver | null;
  #switchFrame: number;
  /** The next shared delivery is the first since the targets were observed there. */
  #firstDelivery: boolean;
  /**
   * The border boxes the last measure() read, in layout pixels (what a ResizeObserver reports); `comparable`
   * only while they are known to be that: the plot's mapping is the identity (no scale on it or above it) and
   * the figure's box agrees with its integer layout size, so no transform makes a viewport size pass for a
   * layout one. Otherwise every delivery is a resize.
   */
  #comparable: boolean;
  #figureWidth: number;
  #figureHeight: number;
  #plotWidth: number;
  #plotHeight: number;
  /** A frame or a zoom microtask the controller asked for and that has not run yet. */
  #framePending: number;
  #microtasksPending: number;
  /** The controller keeps at most one frame request; tracked so a resize delivery can tell it is still due. */
  #frameCallback: ((time?: number) => void) | null;

  constructor(
    composition: Composition, root: HTMLElement, doc: Document, win: Window & typeof globalThis, input: unknown,
    overrides: ChartEnvironmentOverrides,
  ) {
    this.#composition = composition;
    this.#root = root;
    this.page = doc;
    this.#win = win;
    this.controller = null;
    this.#built = 0;
    this.#disposed = false;
    this.#textLayer = null;
    this.#textMounted = false;
    this.#textHidden = false;
    this.#watching = false;
    this.#watchedBefore = false;
    this.#stopTheme = null;
    this.#environment = null;
    this.#language = null;
    this.#interactionAttached = false;
    this.#fontProbe = null;
    this.#probeRegistration = null;
    this.#stripHolder = null;
    this.#geometry = null;
    this.#detachedObserver = null;
    this.#switchFrame = 0;
    this.#firstDelivery = false;
    this.#comparable = false;
    this.#figureWidth = 0;
    this.#figureHeight = 0;
    this.#plotWidth = 0;
    this.#plotHeight = 0;
    this.#framePending = 0;
    this.#microtasksPending = 0;
    this.#frameCallback = null;
    this.targetId = root.id || null;
    this.console = overrides.console === undefined ? (win.console as DeliveryConsole) : overrides.console;
    this.#isDonut = composition.kind === 'donut';
    const tree = this.#tree = this.#styleRoot();
    this.id = allocateId(doc, tree);
    try {
      const initialCompact = Boolean(input && typeof input === 'object' && (input as { compact?: unknown }).compact === true);
      const eagerText = !initialCompact && !this.#isDonut;

      const renderer = this.renderer = svgRendererWith(composition.svg, doc);
      this.#built = STEP_RENDERER;
      const textLayer = this.#textLayer = eagerText ? createTextLayer(doc) : null;
      this.#textMounted = eagerText;
      this.#built = STEP_TEXT;
      const parts = this.#parts = createFigure(root, this.id, { marks: renderer.element, text: textLayer?.element ?? null }, { compact: initialCompact });
      this.#built = STEP_FIGURE;
      this.figure = this.#isDonut ? parts : this;
      this.text = this;
      // Compact charts never need the interaction layer unless updated to full mode; defer its closures and state.
      this.interaction = initialCompact ? new LazyInteraction(this) : this.makeInteraction();
      this.#built = STEP_INTERACTION;
      this.measurer = createMeasurer(doc);
      this.#geometryTargets = [parts.plot, parts.figure];
      this.#built = STEP_GEOMETRY;

      this.controller = controllerFor(composition, input, this);
      if (root.isConnected) {
        this.#joinShared();
        this.#watch();
      } else {
        this.#startDetached();
        ensureStyles(this.#styleRoot());
      }
    } catch (error) {
      const created = this.controller as Controller | null;
      this.controller = null;
      try { created?.handle.destroy(); } catch { /* releasing the rest matters more */ }
      this.#release();
      throw error;
    }
  }

  makeInteraction(): Interaction {
    return createInteraction(this.#composition.interaction, this.#parts, this.renderer, new HostActions(this));
  }

  #styleRoot(): Document | ShadowRoot {
    return shadowRootOf(this.#root) ?? this.page;
  }

  /** Undoes every setup step done, from the last; one that throws does not stop the others. Idempotent. */
  #release(): void {
    for (let step = this.#built; step > 0; step = this.#built) {
      this.#built = step - 1;
      try { this.#undo(step); } catch { /* keep releasing */ }
    }
  }

  #undo(step: number): void {
    switch (step) {
      case STEP_GEOMETRY: {
        this.#disposed = true;
        if (this.#switchFrame !== 0) { const frame = this.#switchFrame; this.#switchFrame = 0; this.#win.cancelAnimationFrame(frame); }
        this.#stopDetached();
        this.#leaveShared();
        return;
      }
      case STEP_PROBE: this.#disposed = true; this.#stopProbe(); return;
      case STEP_WATCHERS: this.#unwatch(); return;
      case STEP_INTERACTION: this.interaction.destroy(); return;
      case STEP_FIGURE: this.#parts.destroy(); return;
      case STEP_TEXT: this.#textLayer?.destroy(); this.#textLayer = null; return;
      case STEP_RENDERER: this.renderer.destroy(); return;
    }
  }

  // ── watchers ──────────────────────────────────────────────────────────────────────────────────

  #watch(): void {
    const c = this.controller;
    if (!c) return;
    const current = this.#styleRoot();
    if (this.#watching && current === this.#tree) return;
    this.#unwatch();
    this.#tree = current;
    // A detached chart's stylesheet may have been removed before its first attachment.
    ensureStyles(current);
    if (this.#watchedBefore) { noteFontLoad(this.page); c.invalidate.page(); }
    this.#watchedBefore = true;
    this.#watching = true;
    try {
      const invalidate = c.invalidate;
      this.#stopTheme = watchTheme(this.#root, () => invalidate.theme());
      joinEnvironment(this.#win, invalidate);
      this.#environment = invalidate;
      const language = new LanguageWatch(this.#root, invalidate);
      language.start();
      this.#language = language;
      this.interaction.attach();
      this.#interactionAttached = true;
    } catch (error) {
      this.#unwatch();
      throw error;
    }
  }

  /** Stops the watchers in reverse order of starting; one that throws does not stop the others. */
  #unwatch(): void {
    if (!this.#watching) return;
    this.#watching = false;
    if (this.#interactionAttached) {
      this.#interactionAttached = false;
      try { this.interaction.detach(); } catch { /* keep releasing */ }
    }
    const language = this.#language;
    this.#language = null;
    if (language) try { language.stop(); } catch { /* keep releasing */ }
    const environment = this.#environment;
    this.#environment = null;
    if (environment) try { leaveEnvironment(this.#win, environment); } catch { /* keep releasing */ }
    const theme = this.#stopTheme;
    this.#stopTheme = null;
    if (theme) try { theme(); } catch { /* keep releasing */ }
  }

  // ── font probe ────────────────────────────────────────────────────────────────────────────────

  #stopProbe(): void {
    const registration = this.#probeRegistration;
    this.#probeRegistration = null;
    registration?.release();
  }

  fontProbeReady(): boolean {
    return this.controller !== null && this.#root.isConnected;
  }

  fontProbeChanged(): void {
    this.controller?.invalidate.fonts();
  }

  /**
   * Observed only while the target is in the document (the shared observer would keep a forgotten chart
   * reachable); a probe that is observed again starts from a new baseline.
   */
  #observeProbe(): void {
    if (this.#fontProbe && !this.#probeRegistration && !this.#disposed && this.#root.isConnected) {
      this.#probeRegistration = observeFontProbe(this.#win, this.page, this.#fontProbe, this);
    }
  }

  #mountText(withProbe = true): TextLayer {
    let textLayer = this.#textLayer;
    if (!textLayer) {
      textLayer = this.#textLayer = createTextLayer(this.page);
      if (this.#textHidden) textLayer.element.style.visibility = 'hidden';
    }
    if (!this.#textMounted) {
      this.#textMounted = true;
      this.#parts.plot.insertBefore(textLayer.element, this.renderer.element.nextSibling);
    }
    if (withProbe && !this.#disposed) {
      if (!this.#fontProbe) {
        const probe = this.#fontProbe = this.page.createElement('div');
        probe.className = 'axylo-font-probe';
        textLayer.element.appendChild(probe);
      }
      // Again on later renders if observing it failed or waited for the target to come back.
      this.#observeProbe();
    }
    return textLayer;
  }

  #unmountText(): void {
    this.#stopProbe();
    this.#fontProbe?.remove();
    this.#fontProbe = null;
    if (this.#textMounted) { this.#textLayer?.destroy(); this.#textLayer = null; this.#textMounted = false; }
  }

  // ── size and attachment ───────────────────────────────────────────────────────────────────────

  /**
   * The first delivery after observing reports the size the chart already drew at when nothing moved since
   * its frame measured it: same border boxes, still attached under the same root, watchers live and no
   * frame pending. Anything else (a hidden chart becoming visible, a resize between the frame and the
   * delivery) is a resize.
   */
  #alreadyMeasured(entries: readonly ResizeObserverEntry[]): boolean {
    if (!this.#comparable || this.#framePending !== 0 || this.#microtasksPending !== 0 || !this.#watching || this.#styleRoot() !== this.#tree) return false;
    const plot = this.#geometryTargets[0], figure = this.#geometryTargets[1];
    let seen = false;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      const target = entry.target;
      const isPlot = target === plot;
      if (!isPlot && target !== figure) continue;
      const box = entry.borderBoxSize?.[0];
      if (!box) return false;
      if (box.inlineSize !== (isPlot ? this.#plotWidth : this.#figureWidth) || box.blockSize !== (isPlot ? this.#plotHeight : this.#figureHeight)) return false;
      seen = true;
    }
    return seen;
  }

  /** A delivery of the document's shared observer. */
  geometryChanged(entries: readonly ResizeObserverEntry[]): void {
    const controller = this.controller;
    if (!controller) return;
    if (!this.#root.isConnected) {
      this.#unwatch();
      this.#leaveShared();
      this.#stopProbe();
      this.#scheduleSwitch();
      return;
    }
    const first = this.#firstDelivery;
    this.#firstDelivery = false;
    if (first && this.#alreadyMeasured(entries)) return;
    this.#watch();
    controller.invalidate.resize();
  }

  #joinShared(): void {
    if (this.#geometry || this.#disposed) return;
    this.#geometry = observeGeometry(this.#win, this.page, this.#geometryTargets, this);
    this.#firstDelivery = true;
  }

  #leaveShared(): void {
    const geometry = this.#geometry;
    this.#geometry = null;
    geometry?.release();
  }

  #onDetachedResize(): void {
    const controller = this.controller;
    if (!controller || !this.#root.isConnected) return;
    // Back in the document: drawn again now, and observed on the shared observer from the next frame. The
    // local observer stays until the watchers and the shared registration are both in place: a watcher that
    // throws here leaves it to report the next resize, which tries again.
    this.#watch();
    controller.invalidate.resize();
    this.#scheduleSwitch();
  }

  /** Only charts out of the document have this observer and its callback. */
  #startDetached(): void {
    if (this.#detachedObserver || this.#disposed) return;
    const observer = this.#detachedObserver = new this.#win.ResizeObserver(() => this.#onDetachedResize());
    for (const target of this.#geometryTargets) observer.observe(target);
  }

  #stopDetached(): void {
    const observer = this.#detachedObserver;
    this.#detachedObserver = null;
    observer?.disconnect();
  }

  #settleSwitch(): void {
    this.#switchFrame = 0;
    if (this.#disposed || !this.controller) return;
    if (this.#root.isConnected) {
      // Not watching yet (a watcher threw when the chart came back): the local observer's next delivery
      // sets the watchers up first.
      if (this.#detachedObserver && !this.#watching) return;
      // A shared registration that fails leaves the local observer in place.
      this.#joinShared();
      this.#stopDetached();
      this.#observeProbe();
    } else {
      // Out again since the last delivery: nothing of the document may keep holding the chart.
      this.#unwatch();
      this.#leaveShared();
      this.#stopProbe();
      this.#startDetached();
    }
  }

  /** Attachment changes are rare: the frame callback is made for each switch. */
  #scheduleSwitch(): void {
    if (this.#switchFrame === 0 && !this.#disposed) this.#switchFrame = this.#win.requestAnimationFrame(() => this.#settleSwitch());
  }

  // ── frames ────────────────────────────────────────────────────────────────────────────────────

  entryController(): Controller | null {
    return this.controller;
  }

  runEntry(time?: number): void {
    this.#framePending = 0;
    const cb = this.#frameCallback;
    this.#frameCallback = null;
    cb?.(time);
  }

  requestFrame(cb: (time?: number) => void): number {
    this.#frameCallback = cb;
    return this.#framePending = scheduleEntry(this.#win, this.page, this);
  }

  cancelFrame(handle: number): void {
    if (handle === this.#framePending) { this.#framePending = 0; this.#frameCallback = null; }
    cancelScheduledFrame(this.#win, handle);
  }

  scheduleMicrotask(cb: () => void): void {
    this.#microtasksPending++;
    const run = (): void => { this.#microtasksPending--; cb(); };
    const win = this.#win;
    if (typeof win.queueMicrotask === 'function') win.queueMicrotask(run);
    else queueMicrotask(run);
  }

  // ── the controller's host ─────────────────────────────────────────────────────────────────────

  get timeZone(): string {
    return viewerTimeZone();
  }

  /** The text layer (Host['text']). */
  render(texts: readonly PlacedText[]): void {
    if (texts.length) this.#mountText().render(texts);
    else this.#textLayer?.render(texts);
  }

  /** The figure (Host['figure']) of a chart with text: the text layer follows compact mode. */
  update(model: FigureModel): boolean {
    if (model.compact) { if (this.#textMounted || this.#fontProbe) this.#unmountText(); }
    else this.#mountText();
    return this.#parts.update(model);
  }

  announce(text: string, lang?: string | null): void {
    this.#parts.announce(text, lang);
  }

  locale(option: unknown, lang?: string | null): string {
    const doc = this.page;
    return resolveLocale(option, doc, (lang === undefined ? pageLanguage(this.#root) : lang) ?? doc.documentElement.lang);
  }

  pageLang(): string | null {
    return pageLanguage(this.#root);
  }

  labelText(own: string): string | null {
    return this.#styleRoot().getElementById(own)?.textContent ?? null;
  }

  textStyle(): TextStyle {
    if (!this.#isDonut && !this.#textMounted) this.#mountText(false);
    return readTextStyle(this.#textMounted && this.#textLayer ? this.#textLayer.element : this.#parts.plot);
  }

  measure(): Size | null {
    this.#comparable = false;
    if (!this.#root.isConnected) return null;
    const parts = this.#parts;
    const figureElement = parts.figure;
    const box = figureElement.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return null;
    const plotElement = parts.plot;
    const plot = plotElement.getBoundingClientRect();
    const { kx, ky } = mappingOf(plotElement, plot);
    const overflow = plot.height < 1 ? Math.max(0, figureElement.scrollHeight - figureElement.clientHeight) : 0;
    // A compact chart's plot is its stage column: one read of the same box.
    const stageElement = parts.stage;
    const stage = stageElement === plotElement ? plot : stageElement.getBoundingClientRect();
    if (kx === 1 && ky === 1 && Math.abs(box.width - figureElement.offsetWidth) < 1 &&
        Math.abs(box.height - figureElement.offsetHeight) < 1) {
      this.#figureWidth = box.width;
      this.#figureHeight = box.height;
      this.#plotWidth = plot.width;
      this.#plotHeight = plot.height;
      this.#comparable = true;
    }
    return { width: plot.width / kx, height: plot.height / ky - overflow, room: { width: stage.width / kx, height: stage.height / ky } };
  }

  stripHeight(): number {
    const probe = this.stripProbeMount();
    try { return this.stripProbeRead(probe); } finally { this.stripProbeRemove(probe); }
  }

  stripProbeMount(): HTMLDivElement {
    let holder = this.#stripHolder;
    if (!holder) {
      const doc = this.page;
      holder = this.#stripHolder = doc.createElement('div');
      holder.className = 'axylo-readout-mode';
      holder.style.cssText = 'position:absolute;left:0;top:0;width:100px;visibility:hidden;pointer-events:none';
      const strip = doc.createElement('div');
      strip.className = 'axylo-readout';
      holder.appendChild(strip);
    }
    this.#parts.figure.appendChild(holder);
    return holder;
  }

  stripProbeRead(probe: unknown): number {
    const strip = (probe as HTMLDivElement).firstElementChild as HTMLDivElement;
    const h = parseFloat(this.#win.getComputedStyle(strip).height);
    return Number.isFinite(h) ? h : NaN;
  }

  stripProbeRemove(probe: unknown): void {
    (probe as HTMLDivElement).remove();
  }

  devicePixelRatio(): number {
    return this.#win.devicePixelRatio || 1;
  }

  theme(keys: readonly string[], colors: Record<string, string>): ThemeResolution {
    return resolveTheme(this.#parts.figure, keys, colors);
  }

  themePrepare(keys: readonly string[], colors: Record<string, string>): unknown {
    return prepareTheme(this.#parts.figure, keys, colors, themeBatchFor(this.page));
  }

  themeApply(prepared: unknown): void {
    applyTheme(prepared as PreparedTheme);
  }

  themeFinish(prepared: unknown, deferProbe?: boolean): ThemeResolution | null {
    return finalizeTheme(prepared as PreparedTheme, deferProbe);
  }

  themeProbe(prepared: unknown, layoutChanged: (changed: boolean) => void): ThemeResolution {
    const pending = prepared as PreparedTheme;
    if (pending.later === null) {
      layoutChanged(false);
      return probeTheme(pending);
    }
    const element = pending.el;
    const backdrop = element.style.getPropertyValue('--axylo-backdrop');
    const scheme = element.getAttribute('data-axylo-scheme');
    const resolution = probeTheme(pending);
    layoutChanged(backdrop !== element.style.getPropertyValue('--axylo-backdrop') ||
      scheme !== element.getAttribute('data-axylo-scheme'));
    return resolution;
  }

  surfaces(visible: boolean): void {
    this.#textHidden = !visible;
    const v = visible ? '' : 'hidden';
    this.renderer.element.style.visibility = v;
    if (this.#textLayer) this.#textLayer.element.style.visibility = v;
  }

  dispose(): void {
    this.#release();
  }
}

export function createChart(composition: Composition, target: unknown, input: unknown, overrides: ChartEnvironmentOverrides = {}): ChartHandle {
  const root = resolveTarget(target);
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  if (win === null) throw new Error('Axylo: the target element is not in a document with a window.');
  return new BrowserHost(composition, root, doc, win, input, overrides).controller!.handle;
}

function resolveTarget(target: unknown): HTMLElement {
  if (typeof target === 'string') {
    const doc = (globalThis as { document?: Document }).document;
    const q = JSON.stringify(target);
    if (!doc) throw new Error(`Axylo: no document to find the target ${q} in.`);
    let found: Element | null;
    try { found = doc.querySelector(target); }
    catch { throw new Error(`Axylo: the target selector ${q} is not a valid CSS selector.`); }
    if (!found) throw new Error(`Axylo: the target selector ${q} matches no element.`);
    return found as HTMLElement;
  }
  if (target !== null && typeof target === 'object' && (target as Node).nodeType === 1) return target as HTMLElement;
  throw new Error('Axylo: the target must be a CSS selector or an element.');
}
