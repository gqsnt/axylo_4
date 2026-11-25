/**
 * `createChart`: the browser host of the controller (controller.ts). It resolves the target, builds the
 * figure, the mark and text renderers and the interaction layer, and connects the page's observers to the
 * controller. Every setup step registers its own cleanup as soon as it succeeded, so a failure part-way
 * through creation, or `destroy()`, leaves the target as it was (including the custom properties the theme
 * wrote on it).
 *
 * Document-level listeners (theme and environment watchers, the interaction layer's keyboard and pointer
 * listeners on the document) are released when the target leaves the document without `destroy()`, so a
 * forgotten chart does not stay reachable from the page, and are attached again if the target comes back.
 * Detachment is noticed by the observers the chart already has (the resize observer reports a zero box),
 * not by polling.
 */
import { svgRendererWith } from '../render/svg';
import { createTextLayer, type TextLayer } from '../render/text';
import { ensureStyles, resolveTheme, watchTheme } from '../theme';
import {
  applyTheme, createThemeBatch, finalizeTheme, prepareTheme, probeTheme,
  type PreparedTheme, type ThemeBatch,
} from '../theme/resolve';
import { createFigure, type Figure, type FigureModel } from '../dom/figure';
import { shadowRootOf } from '../dom/attributes';
import { createInteraction, type Interaction } from '../dom/interaction';
import { mappingOf } from '../dom/mapping';
import type { DeliveryConsole } from './delivery';
import { createMeasurer, noteFontLoad, pageLanguage, readTextStyle, resolveLocale, viewerTimeZone, watchEnvironment, watchLanguage } from './environment';
import { controllerFor, type ChartHandle, type Controller, type ControllerActions, type FrameRun } from './controller';
import type { Composition } from './composition';

export type { BenchHook, ChartHandle, ChartKind, DevHook, Stage } from './controller';

export interface ChartEnvironmentOverrides {
  readonly console?: DeliveryConsole | null;
}

/** Per-document active theme batch during multi-chart rAF Phase 1. */
const activeThemeBatches = new WeakMap<Document, ThemeBatch>();

interface ScheduledEntry {
  readonly get: () => Controller | null;
  readonly cb: (time?: number) => void;
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
  let sched = schedulers.get(win);
  if (!sched) schedulers.set(win, sched = { pending: new Map(), rafId: 0 });
  const handle = ++nextFrameHandle;
  sched.pending.set(handle, { get, cb });
  if (!sched.rafId) {
    const active = sched;
    active.rafId = win.requestAnimationFrame(time => {
      active.rafId = 0;
      if (schedulers.get(win) === active) schedulers.delete(win);
      if (active.pending.size === 1) {
        const entry = active.pending.values().next().value!;
        active.pending.clear();
        entry.cb(time);
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
  let themeBatch: ThemeBatch;
  try { themeBatch = createThemeBatch(win); }
  catch { for (const item of batch) item.cb(time); return; }
  const runs: FrameRun[] = [];
  activeThemeBatches.set(doc, themeBatch);
  try {
    // Phase 1: Initial reads & pure prep across all pending charts (zero DOM writes, zero probeColors).
    for (const item of batch) {
      const c = item.get();
      if (!c) { item.cb(time); continue; }
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

function runAll(fns: (() => void)[]): void {
  for (let fn = fns.pop(); fn; fn = fns.pop()) {
    try { fn(); } catch { /* keep releasing */ }
  }
}

export function createChart(composition: Composition, target: unknown, input: unknown, overrides: ChartEnvironmentOverrides = {}): ChartHandle {
  const root = resolveTarget(target);
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  if (win === null) throw new Error('Axylo: the target element is not in a document with a window.');

  // Cleanup in reverse order of setup; each step adds its own once it succeeded.
  const cleanup: (() => void)[] = [];
  const release = () => runAll(cleanup);

  let controller: Controller | null = null;
  try {
    const styleRoot = (): Document | ShadowRoot => shadowRootOf(root) ?? doc;
    let tree = styleRoot();
    const id = allocateId(doc, tree);

    const initialCompact = Boolean(input && typeof input === 'object' && (input as { compact?: unknown }).compact === true);
    const isDonut = composition.kind === 'donut';
    const eagerText = !initialCompact && !isDonut;

    const renderer = svgRendererWith(composition.svg, doc);
    cleanup.push(() => renderer.destroy());
    let textLayer: TextLayer | null = eagerText ? createTextLayer(doc) : null;
    let textMounted = eagerText, textHidden = false;
    cleanup.push(() => { textLayer?.destroy(); textLayer = null; });
    const figure: Figure = createFigure(root, id, { marks: renderer.element, text: textLayer?.element ?? null }, { compact: initialCompact });
    cleanup.push(() => figure.destroy());

    // Compact charts never need the interaction layer unless updated to full mode; defer its closures and state.
    let interactionAttached = false;
    let realInteraction: Interaction | null = null;
    const makeActions = (): ControllerActions => ({
      zoom: w => controller?.actions.zoom(w),
      toggle: k => controller?.actions.toggle(k),
      pause: p => controller?.actions.pause(p),
      select: r => controller?.actions.select(r),
      hover: r => controller?.actions.hover(r),
    });
    const ensureInteraction = (): Interaction => {
      if (!realInteraction) {
        realInteraction = createInteraction(composition.interaction, figure, renderer, makeActions());
        if (!interactionAttached) realInteraction.detach();
      }
      return realInteraction;
    };
    const interaction: Interaction = initialCompact ? {
      prepare: s => !s.interactive && !realInteraction ? false : ensureInteraction().prepare(s),
      commit(s) { if ((s && s.interactive) || realInteraction) ensureInteraction().commit(s); },
      clear: () => realInteraction?.clear(),
      attach() { interactionAttached = true; realInteraction?.attach(); },
      detach() { interactionAttached = false; realInteraction?.detach(); },
      destroy() { realInteraction?.destroy(); realInteraction = null; },
    } : createInteraction(composition.interaction, figure, renderer, makeActions());
    cleanup.push(() => interaction.destroy());
    const measurer = createMeasurer(doc);

    // Watchers that the document holds; released while the target is out of the document.
    let watching: (() => void) | null = null;
    let watchedBefore = false;
    const unwatch = (): void => { watching?.(); watching = null; };
    const watch = (): void => {
      if (!controller) return;
      const current = styleRoot();
      if (watching && current === tree) return;
      unwatch();
      tree = current;
      // A detached chart's stylesheet may have been removed before its first attachment.
      ensureStyles(tree);
      const c = controller;
      if (watchedBefore) { noteFontLoad(doc); c.invalidate.page(); }
      watchedBefore = true;
      const stops: (() => void)[] = [];
      watching = () => runAll(stops);
      try {
        stops.push(watchTheme(root, () => c.invalidate.theme()));
        stops.push(watchEnvironment(win, {
          pixelRatio: () => c.invalidate.pixelRatio(),
          motion() {},
          fonts() { noteFontLoad(doc); c.invalidate.fonts(); },
        }));
        stops.push(watchLanguage(root, () => c.invalidate.language()));
        interaction.attach();
        stops.push(() => interaction.detach());
      } catch (error) {
        unwatch();
        throw error;
      }
    };
    cleanup.push(unwatch);

    // Deferred font-load probe until first non-empty text render so compact/donut charts skip it.
    let fontProbe: HTMLDivElement | null = null;
    let fontObserver: ResizeObserver | null = null;
    let probeSize: string | null = null;
    let disposed = false;
    cleanup.push(() => { disposed = true; fontObserver?.disconnect(); fontObserver = null; });

    const mountText = (withProbe = true): TextLayer => {
      if (!textLayer) {
        textLayer = createTextLayer(doc);
        if (textHidden) textLayer.element.style.visibility = 'hidden';
      }
      if (!textMounted) {
        textMounted = true;
        figure.plot.insertBefore(textLayer.element, renderer.element.nextSibling);
      }
      if (withProbe && !fontProbe && !disposed) {
        const probe = fontProbe = doc.createElement('div');
        probe.className = 'axylo-font-probe';
        textLayer.element.appendChild(probe);
        (fontObserver = new win.ResizeObserver(entries => {
          const box = entries?.[0]?.contentRect ?? probe.getBoundingClientRect();
          const size = `${box.width}x${box.height}`;
          if (probeSize !== null && size !== probeSize && controller && root.isConnected) {
            noteFontLoad(doc);
            controller.invalidate.fonts();
          }
          probeSize = size;
        })).observe(probe);
      }
      return textLayer;
    };

    const unmountText = (): void => {
      fontObserver?.disconnect();
      fontProbe?.remove();
      fontObserver = fontProbe = probeSize = null;
      if (textMounted) { textLayer?.destroy(); textLayer = null; textMounted = false; }
    };

    const stripProbeMount = () => {
      const holder = doc.createElement('div');
      holder.className = 'axylo-readout-mode';
      holder.style.cssText = 'position:absolute;left:0;top:0;width:100px;visibility:hidden;pointer-events:none';
      const strip = doc.createElement('div');
      strip.className = 'axylo-readout';
      holder.appendChild(strip);
      figure.figure.appendChild(holder);
      return { holder, strip };
    };
    const stripProbeRead = (probe: unknown): number => {
      const h = parseFloat(win.getComputedStyle((probe as { strip: HTMLDivElement }).strip).height);
      return Number.isFinite(h) ? h : NaN;
    };
    const stripProbeRemove = (probe: unknown): void => (probe as { holder: HTMLDivElement }).holder.remove();

    const resizeObserver = new win.ResizeObserver(() => {
      if (!controller) return;
      if (!root.isConnected) { unwatch(); return; }
      watch();
      controller.invalidate.resize();
    });
    cleanup.push(() => resizeObserver.disconnect());

    const getController = (): Controller | null => controller;

    controller = controllerFor(composition, input, {
      id,
      targetId: root.id || null,
      console: overrides.console === undefined ? (win.console as DeliveryConsole) : overrides.console,
      page: doc,
      get timeZone() { return viewerTimeZone(); },
      renderer,
      text: {
        render(texts) {
          if (texts.length) mountText().render(texts);
          else textLayer?.render(texts);
        },
      },
      figure: isDonut ? figure : {
        update(model: FigureModel) {
          if (model.compact) { if (textMounted || fontProbe) unmountText(); }
          else mountText();
          return figure.update(model);
        },
        announce: (text, lang) => figure.announce(text, lang),
      },
      interaction,
      measurer,
      requestFrame: cb => scheduleFrame(win, doc, getController, cb),
      cancelFrame: handle => cancelScheduledFrame(win, handle),
      scheduleMicrotask: cb => typeof win.queueMicrotask === 'function' ? win.queueMicrotask(cb) : queueMicrotask(cb),
      locale: option => resolveLocale(option, doc, pageLanguage(root) ?? doc.documentElement.lang),
      pageLang: () => pageLanguage(root),
      labelText: own => styleRoot().getElementById(own)?.textContent ?? null,
      textStyle() {
        if (!isDonut && !textMounted) mountText(false);
        return readTextStyle(textMounted && textLayer ? textLayer.element : figure.plot);
      },
      measure() {
        if (!root.isConnected) return null;
        const box = figure.figure.getBoundingClientRect();
        if (box.width <= 0 || box.height <= 0) return null;
        const plot = figure.plot.getBoundingClientRect();
        const { kx, ky } = mappingOf(figure.plot, plot);
        const overflow = plot.height < 1 ? Math.max(0, figure.figure.scrollHeight - figure.figure.clientHeight) : 0;
        const stage = figure.stage.getBoundingClientRect();
        return { width: plot.width / kx, height: plot.height / ky - overflow, room: { width: stage.width / kx, height: stage.height / ky } };
      },
      stripHeight() {
        const probe = stripProbeMount();
        try { return stripProbeRead(probe); } finally { stripProbeRemove(probe); }
      },
      stripProbeMount, stripProbeRead, stripProbeRemove,
      devicePixelRatio: () => win.devicePixelRatio || 1,
      theme: (keys, colors) => resolveTheme(figure.figure, keys, colors),
      themePrepare: (keys, colors) => prepareTheme(figure.figure, keys, colors, activeThemeBatches.get(doc)),
      themeApply: prepared => applyTheme(prepared as PreparedTheme),
      themeFinish: (prepared, deferProbe) => finalizeTheme(prepared as PreparedTheme, deferProbe),
      themeProbe(prepared, layoutChanged) {
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
      },
      surfaces(visible) {
        textHidden = !visible;
        const v = visible ? '' : 'hidden';
        renderer.element.style.visibility = v;
        if (textLayer) textLayer.element.style.visibility = v;
      },
      dispose: release,
    });
    resizeObserver.observe(figure.plot);
    resizeObserver.observe(figure.figure);
    if (root.isConnected) watch();
    else ensureStyles(styleRoot());
    return controller.handle;
  } catch (error) {
    const created = controller as Controller | null;
    controller = null;
    try { created?.handle.destroy(); } catch { /* releasing the rest matters more */ }
    release();
    throw error;
  }
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
