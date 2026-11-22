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
import { createFigure, type Figure } from '../dom/figure';
import { createInteraction, type Interaction } from '../dom/interaction';
import { mappingOf } from '../dom/mapping';
import type { DeliveryConsole } from './delivery';
import { createMeasurer, noteFontLoad, readTextStyle, resolveLocale, viewerTimeZone, watchEnvironment, watchLanguage } from './environment';
import { controllerFor, type ChartHandle, type Controller, type ControllerActions } from './controller';
import type { Composition } from './composition';

export type { BenchHook, ChartHandle, ChartKind, DevHook, Stage } from './controller';

export interface ChartEnvironmentOverrides {
  readonly console?: DeliveryConsole | null;
}

/** Suffixes of the ids a chart gives its elements (figure, interaction, table). */
const ID_SUFFIXES = ['', '-t', '-st', '-s', '-m', '-n', '-i', '-proxy', '-table', '-table-caption', '-table-jump', '-table-jump-error'];
let instances = 0;

/** An id prefix none of whose element ids exist in the page yet (spec A1: ids unique per chart). */
function allocateId(doc: Document): string {
  for (;;) {
    const id = `axylo-${++instances}`;
    if (ID_SUFFIXES.every(suffix => doc.getElementById(id + suffix) === null)) return id;
  }
}

export function createChart(composition: Composition, target: unknown, input: unknown, overrides: ChartEnvironmentOverrides = {}): ChartHandle {
  const root = resolveTarget(target);
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  if (win === null) throw new Error('Axylo: the target element is not in a document with a window.');

  // Cleanup in reverse order of setup; each step adds its own once it succeeded.
  const cleanup: (() => void)[] = [];
  const release = (): void => {
    for (let fn = cleanup.pop(); fn; fn = cleanup.pop()) {
      try {
        fn();
      } catch {
        // Keep releasing the rest.
      }
    }
  };

  let controller: Controller | null = null;
  try {
    const id = allocateId(doc);

    const renderer = svgRendererWith(composition.svg, doc);
    cleanup.push(() => renderer.destroy());
    const textLayer: TextLayer = createTextLayer(doc);
    cleanup.push(() => textLayer.destroy());
    const figure: Figure = createFigure(root, id, { marks: renderer.element, text: textLayer.element });
    cleanup.push(() => figure.destroy());

    // The interaction layer is built before the controller that answers it, so its actions forward late.
    const actions: ControllerActions = {
      zoom: w => controller?.actions.zoom(w),
      toggle: k => controller?.actions.toggle(k),
      pause: p => controller?.actions.pause(p),
      select: r => controller?.actions.select(r),
      hover: r => controller?.actions.hover(r),
    };
    const interaction: Interaction = createInteraction(composition.interaction, figure, renderer, actions);
    cleanup.push(() => interaction.destroy());
    const measurer = createMeasurer(doc);
    ensureStyles(doc);

    // Watchers that the document holds; released while the target is out of the document.
    let watching: (() => void) | null = null;
    let watchedBefore = false;
    const watch = (): void => {
      if (watching || controller === null) return;
      const c = controller;
      if (watchedBefore) {
        // Back in the document: fonts may have changed while it was out, and measurements made with the old
        // ones must not be reused (final review, finding 14).
        noteFontLoad(doc);
        c.invalidate.page();
      }
      watchedBefore = true;
      // Each watcher's release is registered as soon as it exists, so one that fails part-way leaves no
      // other behind (final review, finding 14).
      const stops: (() => void)[] = [];
      watching = () => {
        for (let stop = stops.pop(); stop; stop = stops.pop()) {
          try { stop(); } catch { /* keep releasing */ }
        }
      };
      try {
        stops.push(watchTheme(root, () => c.invalidate.theme()));
        stops.push(watchEnvironment(win, {
          pixelRatio: () => c.invalidate.pixelRatio(),
          motion() {
            // Nothing is animated yet (spec I5), so there is nothing to change.
          },
          fonts() {
            noteFontLoad(doc);
            c.invalidate.fonts();
          },
        }));
        stops.push(watchLanguage(root, () => c.invalidate.language()));
        interaction.attach();
        stops.push(() => interaction.detach());
      } catch (error) {
        // This attempt's subscriptions are released and the chart is not watching: the next resize
        // notification tries again, instead of finding `watching` set and skipping setup (verification,
        // defect 11).
        unwatch();
        throw error;
      }
    };
    const unwatch = (): void => {
      watching?.();
      watching = null;
    };
    cleanup.push(unwatch);

    // A font can arrive without a 'loadingdone' (a FontFace loaded first and then added to document.fonts):
    // a probe set like the labels changes size whenever their font does, and that is a font load (L1).
    const fontProbe = doc.createElement('div');
    fontProbe.className = 'axylo-font-probe';
    textLayer.element.appendChild(fontProbe);
    let probeSize: string | null = null;
    const fontObserver = new win.ResizeObserver(() => {
      const box = fontProbe.getBoundingClientRect();
      const size = `${box.width}x${box.height}`;
      if (probeSize !== null && size !== probeSize && controller !== null && root.isConnected) {
        noteFontLoad(doc);
        controller.invalidate.fonts();
      }
      probeSize = size;
    });
    fontObserver.observe(fontProbe);
    cleanup.push(() => fontObserver.disconnect());

    const resizeObserver = new win.ResizeObserver(() => {
      if (controller === null) return;
      // A target taken out of the document reports a zero box: let go of the document until it returns.
      if (!root.isConnected) {
        unwatch();
        return;
      }
      watch();
      controller.invalidate.resize();
    });
    cleanup.push(() => resizeObserver.disconnect());

    const timeZone = viewerTimeZone();
    controller = controllerFor(composition, input, {
      id,
      // The author's own id names an untitled chart in diagnostics; the allocated one stays for the DOM.
      targetId: root.id || null,
      console: overrides.console === undefined ? (win.console as DeliveryConsole) : overrides.console,
      page: doc,
      timeZone,
      renderer,
      text: textLayer,
      figure,
      interaction,
      measurer,
      requestFrame: callback => win.requestAnimationFrame(callback),
      cancelFrame: handle => win.cancelAnimationFrame(handle),
      locale: option => resolveLocale(option, doc),
      pageLang() {
        const lang = root.closest('[lang]')?.getAttribute('lang')?.trim();
        return lang ? lang : null;
      },
      labelText(own) {
        const el = doc.getElementById(own);
        return el === null ? null : el.textContent ?? '';
      },
      textStyle: () => readTextStyle(textLayer.element),
      measure() {
        if (!root.isConnected) return null;
        const box = figure.figure.getBoundingClientRect();
        if (box.width <= 0 && box.height <= 0) return null;
        const plot = figure.plot.getBoundingClientRect();
        // Layout pixels, which the marks, the text and picking use: a CSS transform on an ancestor scales the
        // bounding rect, not the layout. The scale is the interaction layer's own mapping (decision 0004
        // revision 3, rule 10): bounding rect over the fractional computed size, exactly 1 only within the
        // computed size's serialization (1e-5), so a scale of 1.015 or 0.99 is not taken for 1 (it laid the
        // scene out 9 px too wide on a 600 px plot), and an unscaled sub-pixel width stays exactly 1.
        const mapping = mappingOf(figure.plot);
        const sx = mapping.kx;
        const sy = mapping.ky;
        // When the plot is squeezed to nothing, how far the rest overflows the figure is how much room is
        // missing; that keeps the L8 decision continuous below zero.
        const overflow = plot.height < 1 ? Math.max(0, figure.figure.scrollHeight - figure.figure.clientHeight) : 0;
        const stage = figure.stage.getBoundingClientRect();
        return { width: plot.width / sx, height: plot.height / sy - overflow, room: { width: stage.width / sx, height: stage.height / sy } };
      },
      stripHeight() {
        // The strip as the stylesheet would reserve it, in this figure's own font: a hidden copy is measured
        // (decision 0004 rule 5: two line heights of the strip's own text, whatever the page's size).
        const holder = doc.createElement('div');
        holder.className = 'axylo-readout-mode';
        holder.style.cssText = 'position: absolute; left: 0; top: 0; width: 100px; visibility: hidden; pointer-events: none;';
        const strip = doc.createElement('div');
        strip.className = 'axylo-readout';
        holder.appendChild(strip);
        figure.figure.appendChild(holder);
        const height = parseFloat(win.getComputedStyle(strip).height);
        holder.remove();
        return Number.isFinite(height) ? height : NaN;
      },
      devicePixelRatio: () => win.devicePixelRatio || 1,
      // Scoped to this chart's own figure: properties and the scheme go with it (finding 10).
      theme: (keys, colors) => resolveTheme(figure.figure, keys, colors),
      surfaces(visible) {
        // Hidden without drawing: the error revision does not depend on the methods that may have failed.
        for (const el of [renderer.element, textLayer.element]) el.style.visibility = visible ? '' : 'hidden';
      },
      dispose: release,
    });
    resizeObserver.observe(figure.plot);
    resizeObserver.observe(figure.figure);
    if (root.isConnected) watch();
    return controller.handle;
  } catch (error) {
    // A rejected strict create, or a failure part-way through: nothing stays behind, a controller that was
    // already created (its first frame queued) included (review 3, finding 9).
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
