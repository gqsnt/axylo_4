/**
 * Everything a reader uses to explore a full chart (decision 0001; spec I1–I6, A2–A4, A7): one piece of
 * state, "what the reader is on", driven by pointer, touch and keyboard alike, and what is derived from it:
 * the tooltip, the overlay (drawn with `renderer.drawOverlay`, never by redrawing the scene), the keyboard
 * proxy's value text and the `hover` event. Plus the toolbar (legend, zoom, pause, table), the table view and
 * the zoom gestures.
 *
 * The controller calls `commit` after every frame it draws, with the state that frame shows; this module
 * never reads a newer state than the marks show. It changes the chart only through `actions`, which go
 * through the public paths (zoom, the view's hidden set, pause), so every change follows the commit contract.
 *
 * Nothing here speaks when data arrives (spec A7): the proxy's value text is rewritten only when the reader
 * moved or when the datum it described is gone, and no live region is touched by a commit.
 */
import type {
  DatumRef, DatumText, Formatters, Layout, Lookup, MarkRenderer, Overlay, PaintBindings, PickTarget, ReaderModel,
  ResolvedTheme, StepDirection, View,
} from '../core/contracts';
import type { Messages } from '../public';
import { fill } from '../messages';
import {
  buildOverlay, minimumWidth, panWindow, positionAt, refsAt, sameRef, scaleWindow, stepAcross, targetBox, targetOf,
  valueText, PAN_SHARE, ZOOM_FACTOR, type Mode,
} from '../core/focus';
import type { Figure } from './figure';
import { sameTarget } from './pointer';
import { createTableView, type TableView } from './table';
import { createToolbar, type Toolbar, type ToolbarItem } from './toolbar';
import { createTooltip, type TooltipContent } from './tooltip';
import { createSwatch, type SwatchSpec } from './swatch';
import { sliceText } from '../lookup/text';

type Span = readonly [number, number];

/**
 * What the controls under the plot need. Known before layout, so they are in place when the plot is
 * measured and their arrival never makes the plot relayout.
 */
export interface ControlsState {
  readonly kind: 'line' | 'area' | 'bar' | 'scatter' | 'donut';
  readonly view: View;
  readonly formatters: Formatters;
  readonly messages: Messages;
  readonly reader: ReaderModel;
  /** The last layout was too small for a plot (spec L8): only the table control is offered. */
  readonly tooSmall: boolean;
  /** The chart shows data (not loading, empty or error). */
  readonly ready: boolean;
  /** A full chart; false for the compact variant, which is a static image (spec C1). */
  readonly interactive: boolean;
  readonly tooltip: boolean;
  /** Where the legend part of the toolbar goes (plan 1.4, `legend`), or false for none. */
  readonly legend: false | 'top' | 'right' | 'bottom';
  /** Zoom applies to this chart (spec 3.6) and is not switched off; 'touch' also captures pinch. */
  readonly zoom: false | true | 'touch';
  readonly zoomed: boolean;
  /** `append` has been called at least once (spec I6). */
  readonly streaming: boolean;
  readonly paused: boolean;
  readonly epoch: number;
  /** `lang` for an element that shows the built-in text of `key`: 'en' on a page in another language. */
  english(key: keyof Messages): string | null;
  /** The page's own language, for author text inside an element marked 'en'. */
  readonly pageLang: string | null;
}

/** What one drawn frame shows, as the interaction layer needs it. */
export interface Committed extends ControlsState {
  readonly layout: Layout;
  readonly lookup: Lookup;
  readonly bindings: PaintBindings;
  readonly theme: ResolvedTheme;
  readonly pixelRatio: number;
}

export interface Actions {
  /** A window in x positions, or null for everything. Goes through the public `zoom` path. */
  zoom(window: Span | null): void;
  toggle(seriesKey: string): void;
  pause(paused: boolean): void;
  select(ref: DatumRef): void;
  hover(ref: DatumRef | null): void;
}

export interface Interaction {
  /**
   * Before the plot is measured: the legend, toolbar and table for the state about to be drawn. Returns
   * true when that changed what sits under the plot, so the plot's size must be read again.
   */
  prepare(state: ControlsState): boolean;
  commit(state: Committed | null): void;
  /** Internal failure or destroy: everything goes, nothing is left focusable. */
  clear(): void;
  /**
   * The chart is in the document: listeners on the document itself (Escape, a tap outside a pinned
   * tooltip) may be held. `detach` lets go of them while the chart is out of the document.
   */
  attach(): void;
  detach(): void;
  destroy(): void;
}

/** Bar series past the eighth carry a pattern (spec F9); the same rule as the scene's bars. */
const PATTERNS = ['diagonal', 'cross', 'dots'] as const;
export function seriesPattern(index: number): SwatchSpec['pattern'] {
  const group = Math.floor(index / 8);
  return group ? PATTERNS[(group - 1) % PATTERNS.length]! : null;
}

/** How a series is drawn, repeated in its legend and tooltip swatch (spec A5). */
export function seriesSwatch(kind: ControlsState['kind'], index: number, cue: SwatchSpec['cue'], hollow: boolean): SwatchSpec {
  if (kind === 'bar' || kind === 'area') {
    return { color: index, cue, line: false, hollow, fill: true, pattern: kind === 'bar' ? seriesPattern(index) : null };
  }
  return { color: index, cue, line: kind === 'line', hollow };
}

const NAVIGATION: Readonly<Record<string, StepDirection>> = {
  ArrowRight: 'next', ArrowLeft: 'previous', Home: 'first', End: 'last', PageUp: 'page-next', PageDown: 'page-previous',
};
const DRAG_THRESHOLD = 4;
const TAP_DISTANCE = 10;
const TAP_TIME = 500;

function setAttr(el: Element, name: string, value: string | null): void {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) {
    el.setAttribute(name, value);
  }
}

function sameWindow(a: Span | null, b: Span | null): boolean {
  return a === b || (a !== null && b !== null && a[0] === b[0] && a[1] === b[1]);
}

export function createInteraction(figure: Figure, renderer: MarkRenderer, actions: Actions): Interaction {
  const doc = figure.figure.ownerDocument;
  const plot = figure.plot;
  const tooltip = createTooltip(figure.tooltip, figure.readout, figure.figure, plot);

  let c: Committed | null = null;
  /** The newest controls state (prepared or committed), for the toolbar's actions. */
  let cs: ControlsState | null = null;
  let focus: DatumRef | null = null;
  let mode: Mode = 'all';
  /** Which input last chose what is shown. */
  let source: 'pointer' | 'keyboard' | null = null;
  let pointer: { x: number; y: number } | null = null;
  let pointerTarget: PickTarget | null = null;
  let pinned = false;
  /** Escape closed the tooltip for this target; it stays closed until the target changes. */
  let dismissed: PickTarget | null = null;
  let proxyFocused = false;
  let clickFocus = false;
  /** The proxy got focus from a click and no key has been pressed since: the pointer still leads. */
  let fromClick = false;
  let intent: StepDirection | null = null;
  let shownOrdinal = 0;
  let shownRef: DatumRef | null = null;
  let shownMode: Mode = 'all';
  let lastHover: DatumRef | null = null;
  let presented = '';
  let dirty = true;
  /** A zoom requested but not committed yet, so quick repeats (wheel, key repeat) build on each other. */
  let pendingWindow: Span | null | undefined;
  let tableView: TableView | null = null;
  let tableModel: unknown = null;
  let down: { id: number; x: number; y: number; dragging: boolean } | null = null;
  const touches = new Map<number, { x: number; y: number; x0: number; y0: number; t0: number }>();
  let pinch: { distance: number; window: Span; center: number } | null = null;
  let pinchFrame = 0;
  let pinchWindow: Span | null | undefined;
  let destroyed = false;
  /** The chart is in the document, so the document's own listeners may be held. */
  let attached = true;

  // ── elements (built for full charts only) ──────────────────────────────────────────────────────

  let proxy: HTMLInputElement | null = null;
  let ring: HTMLElement | null = null;
  let selection: HTMLElement | null = null;
  let legendList: HTMLUListElement | null = null;
  let toolbar: Toolbar | null = null;

  function build(): void {
    if (proxy) return;
    proxy = doc.createElement('input');
    proxy.type = 'range';
    proxy.className = 'axylo-proxy';
    proxy.id = `${figure.id}-proxy`;
    proxy.min = '0';
    proxy.step = '1';
    proxy.addEventListener('keydown', onProxyKey);
    proxy.addEventListener('input', onProxyInput);
    proxy.addEventListener('focus', onProxyFocus);
    proxy.addEventListener('blur', onProxyBlur);
    ring = doc.createElement('div');
    ring.className = 'axylo-focus-ring';
    ring.setAttribute('aria-hidden', 'true');
    selection = doc.createElement('div');
    selection.className = 'axylo-selection';
    selection.setAttribute('aria-hidden', 'true');
    selection.hidden = true;
    plot.append(proxy, ring, selection);
    toolbar = createToolbar(doc);
    plot.addEventListener('pointermove', onPointerMove);
    plot.addEventListener('pointerleave', onPointerLeave);
    plot.addEventListener('pointerdown', onPointerDown);
    plot.addEventListener('pointerup', onPointerUp);
    plot.addEventListener('pointercancel', onPointerCancel);
    plot.addEventListener('wheel', onWheel, { passive: false });
    figure.tooltip.addEventListener('pointerleave', onTooltipLeave);
    if (attached) doc.addEventListener('keydown', onDocumentKey);
  }

  function unbuild(): void {
    if (!proxy) return;
    closeTable();
    proxy.remove();
    ring?.remove();
    selection?.remove();
    legendList?.remove();
    toolbar?.destroy();
    proxy = ring = selection = legendList = null;
    toolbar = null;
    plot.removeEventListener('pointermove', onPointerMove);
    plot.removeEventListener('pointerleave', onPointerLeave);
    plot.removeEventListener('pointerdown', onPointerDown);
    plot.removeEventListener('pointerup', onPointerUp);
    plot.removeEventListener('pointercancel', onPointerCancel);
    plot.removeEventListener('wheel', onWheel);
    figure.tooltip.removeEventListener('pointerleave', onTooltipLeave);
    doc.removeEventListener('keydown', onDocumentKey);
    doc.removeEventListener('pointerdown', onDocumentDown, true);
    for (const host of [figure.controls, figure.top, figure.side]) {
      host.hidden = true;
      host.replaceChildren();
    }
    plot.classList.remove('axylo-touch-zoom', 'axylo-zoomable');
  }

  // ── what the reader is on ──────────────────────────────────────────────────────────────────────

  function aligned(view: View): view is Extract<View, { kind: 'line' | 'area' | 'bar' }> {
    return view.kind === 'line' || view.kind === 'area' || view.kind === 'bar';
  }

  function plotReady(d: Committed | null): d is Committed {
    return d !== null && d.ready && d.layout.kind === 'plot';
  }

  /** The datum to start from when the keyboard arrives: the pointer's, else the first. */
  function initialFocus(d: Committed): DatumRef | null {
    if (source === 'pointer' && pointerTarget) {
      const p = d.lookup.primary(pointerTarget);
      if (p) return p;
    }
    if (aligned(d.view)) {
      const x = stepAcross(d.view, null, 'first');
      return x === null ? null : d.lookup.primary({ kind: 'x', x });
    }
    return d.lookup.step(null, 'first');
  }

  /** The keyboard takes over from a pointer target (contracts: Lookup.primary). */
  function takeover(d: Committed): void {
    if (source !== 'pointer' || !pointerTarget) {
      focus ??= initialFocus(d);
      return;
    }
    if (mode === 'single' && focus?.kind === 'aligned' && pointerTarget.kind === 'x') {
      focus = d.lookup.resolve({ kind: 'aligned', seriesKey: focus.seriesKey, x: pointerTarget.x }) ?? d.lookup.primary(pointerTarget);
    } else {
      focus = d.lookup.primary(pointerTarget) ?? focus ?? initialFocus(d);
    }
  }

  function current(): PickTarget | null {
    if (source === 'keyboard') return proxyFocused && focus ? targetOf(focus) : null;
    return pointerTarget;
  }

  function swatchFor(d: Committed): (row: DatumText) => SwatchSpec | null {
    const view = d.view;
    return row => {
      if (view.kind === 'donut') return { color: view.slices[row.seriesIndex]?.colorIndex ?? null, cue: null, line: false, hollow: false };
      return seriesSwatch(view.kind, row.seriesIndex, view.cues[row.seriesIndex] ?? null, false);
    };
  }

  /** Draws the overlay and the tooltip for the current target, and fires `hover` when the datum changes. */
  function present(): void {
    const d = c;
    if (!plotReady(d) || !proxy) {
      if (presented !== '') {
        if (d) renderer.drawOverlay(null, d.bindings, d.theme, d.pixelRatio);
        tooltip.hide();
        presented = '';
      }
      hover(null);
      return;
    }
    const target = current();
    const visibleRing = proxyFocused && proxy.matches(':focus-visible') ? focus : null;
    const only = mode === 'single' && source === 'keyboard' ? focus : null;
    const showTip = d.tooltip && target !== null && !(dismissed !== null && sameTarget(dismissed, target));
    const key = JSON.stringify([target, visibleRing, only, showTip, source === 'pointer' && pointer ? Math.round(pointer.y / 24) : null]);
    if (!dirty && key === presented) return;
    presented = key;
    dirty = false;
    const overlay: Overlay | null = buildOverlay({ view: d.view, layout: d.layout, lookup: d.lookup, target, ring: visibleRing, only });
    renderer.drawOverlay(overlay, d.bindings, d.theme, d.pixelRatio);
    if (!showTip || target === null) {
      tooltip.hide();
    } else {
      const model = d.lookup.tooltip(target);
      if (model.rows.length === 0) {
        tooltip.hide();
      } else {
        const content: TooltipContent = {
          model, swatch: swatchFor(d), moreRows: count => fill(d.messages.moreRows, { count: d.formatters.count(count) }),
          totalLabel: d.messages.total,
        };
        const box = plot.getBoundingClientRect();
        const local = targetBox(d.view, d.lookup, target, only) ??
          (pointer ? { x: pointer.x, y: pointer.y, width: 0, height: 0 } : null);
        const anchor = local ? { x: box.left + local.x, y: box.top + local.y, width: local.width, height: local.height }
          : { x: box.left + box.width / 2, y: box.top + box.height / 2, width: 0, height: 0 };
        const focusY = source === 'pointer' && pointer ? box.top + pointer.y : null;
        if (!tooltip.show(content, anchor, focusY)) tooltip.readout(content);
      }
    }
    hover(target === null ? null : source === 'keyboard' ? focus : d.lookup.primary(target));
  }

  function hover(ref: DatumRef | null): void {
    if (sameRef(ref, lastHover)) return;
    lastHover = ref;
    actions.hover(ref);
  }

  // ── the keyboard proxy ─────────────────────────────────────────────────────────────────────────

  /**
   * Writes the proxy's value and value text. While the reader is on it, only a move of theirs (`force`) or
   * the loss of the datum it describes rewrites it, so streaming data never makes a screen reader speak.
   */
  function writeProxy(force: boolean): void {
    const d = c;
    if (!proxy || !d) return;
    const ref = focus ?? (plotReady(d) ? initialFocus(d) : null);
    if (!force && proxyFocused && sameRef(ref, shownRef) && shownMode === mode) return;
    const max = Math.max(0, d.lookup.count - 1);
    const ordinal = ref ? Math.max(0, d.lookup.ordinal(ref)) : 0;
    const text = ref ? valueText(d.view, d.lookup, ref, mode, d.formatters, d.messages) : null;
    proxy.max = String(max);
    proxy.value = String(ordinal);
    setAttr(proxy, 'aria-valuetext', text ?? d.messages.noData);
    shownOrdinal = ordinal;
    shownRef = ref;
    shownMode = mode;
  }

  /** Before a native key moves the range, its value and bounds match the datum the reader is on. */
  function syncNative(d: Committed): void {
    if (!proxy) return;
    const max = String(Math.max(0, d.lookup.count - 1));
    if (proxy.max !== max) proxy.max = max;
    const ordinal = focus ? Math.max(0, d.lookup.ordinal(focus)) : 0;
    if (proxy.value !== String(ordinal)) proxy.value = String(ordinal);
    shownOrdinal = ordinal;
  }

  function move(direction: StepDirection): void {
    const d = c;
    if (!plotReady(d)) return;
    takeover(d);
    if (focus) {
      let next: DatumRef | null;
      if (mode === 'all' && focus.kind === 'aligned' && aligned(d.view)) {
        const x = stepAcross(d.view, focus.x, direction);
        next = x === null ? null : d.lookup.primary({ kind: 'x', x });
      } else {
        next = d.lookup.step(focus, direction);
      }
      if (next) focus = next;
    }
    source = 'keyboard';
    writeProxy(true);
    present();
  }

  function moveSeries(delta: 1 | -1): void {
    const d = c;
    if (!plotReady(d)) return;
    takeover(d);
    if (!focus) return;
    if (focus.kind === 'aligned' && aligned(d.view)) {
      if (mode === 'all') {
        const refs = refsAt(d.view, focus.x);
        const ref = delta > 0 ? refs[0] : refs.at(-1);
        if (ref) {
          focus = ref;
          mode = 'single';
        }
      } else {
        focus = d.lookup.step(focus, delta > 0 ? 'series-next' : 'series-previous') ?? focus;
      }
    } else if (focus.kind === 'point') {
      focus = d.lookup.step(focus, delta > 0 ? 'series-next' : 'series-previous') ?? focus;
    }
    source = 'keyboard';
    writeProxy(true);
    present();
  }

  function onProxyKey(event: KeyboardEvent): void {
    const d = c;
    if (!plotReady(d) || event.altKey || event.ctrlKey || event.metaKey) return;
    fromClick = false;
    const { key } = event;
    const consume = () => { event.preventDefault(); event.stopPropagation(); };
    if (d.zoom && (key === '+' || key === '=')) { consume(); zoomBy(1 / ZOOM_FACTOR); return; }
    if (d.zoom && (key === '-' || key === '_')) { consume(); zoomBy(ZOOM_FACTOR); return; }
    if (d.zoom && key === '0') { consume(); requestZoom(null); return; }
    if (event.shiftKey && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      // Shift+arrows pan; they never move the range natively in Chrome, but other engines might.
      event.preventDefault();
      if (d.zoom) pan(key === 'ArrowRight' ? PAN_SHARE : -PAN_SHARE);
      return;
    }
    if ((key === 'ArrowUp' || key === 'ArrowDown') && d.view.kind !== 'donut') {
      event.preventDefault();
      moveSeries(key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      takeover(d);
      if (focus) actions.select(focus);
      return;
    }
    if (key === 'Escape') {
      // Decision 0001: the tooltip first, then single-series mode; otherwise Escape is left to the page.
      const target = current();
      if (tooltip.visible && target) {
        consume();
        dismissed = target;
        dirty = true;
        present();
      } else if (mode === 'single') {
        consume();
        mode = 'all';
        if (focus?.kind === 'aligned') focus = d.lookup.primary({ kind: 'x', x: focus.x }) ?? focus;
        writeProxy(true);
        present();
      }
      return;
    }
    const direction = NAVIGATION[key] ?? (d.view.kind === 'donut' ? ({ ArrowUp: 'next', ArrowDown: 'previous' } as Record<string, StepDirection>)[key] : undefined);
    if (direction) {
      // Native behaviour is kept: the range moves itself, and `input` maps the move through lookup.step.
      takeover(d);
      source = 'keyboard';
      intent = direction;
      syncNative(d);
    }
  }

  function onProxyInput(): void {
    const d = c;
    if (!proxy || !d) return;
    const value = Number(proxy.value);
    const max = Number(proxy.max);
    let direction = intent;
    intent = null;
    if (direction === null) {
      // A move without a key (a touch screen reader's swipe, an assistive increment).
      const delta = value - shownOrdinal;
      direction = value === 0 ? 'first' : value === max ? 'last' : delta === 1 ? 'next' : delta === -1 ? 'previous'
        : delta > 0 ? 'page-next' : 'page-previous';
    }
    move(direction);
  }

  function onProxyFocus(): void {
    const d = c;
    proxyFocused = true;
    if (!plotReady(d)) return;
    fromClick = clickFocus;
    if (!clickFocus) source = 'keyboard';
    takeover(d);
    writeProxy(true);
    dirty = true;
    present();
  }

  function onProxyBlur(): void {
    proxyFocused = false;
    fromClick = false;
    intent = null;
    if (source === 'keyboard') source = pointer ? 'pointer' : null;
    dirty = true;
    present();
  }

  // ── zoom ───────────────────────────────────────────────────────────────────────────────────────

  function currentWindow(d: Committed): Span | null {
    if (d.view.kind === 'donut') return null;
    if (pendingWindow !== undefined) return pendingWindow ?? d.view.xFull;
    return d.view.xDomain;
  }

  function requestZoom(window: Span | null): void {
    const d = c;
    if (!d || d.view.kind === 'donut') return;
    const before = pendingWindow !== undefined ? pendingWindow : d.zoomed ? d.view.xDomain : null;
    if (sameWindow(before, window)) return;
    pendingWindow = window;
    actions.zoom(window);
  }

  function zoomBy(factor: number, center?: number): void {
    const d = c;
    if (!d || d.view.kind === 'donut' || !d.zoom) return;
    const now = currentWindow(d)!;
    const at = center ?? (now[0] + now[1]) / 2;
    const next = scaleWindow(d.view.xFull, now, factor, at, minimumWidth(d.view));
    if (next && Math.abs(next[1] - next[0] - (now[1] - now[0])) < 1e-9 * Math.abs(now[1] - now[0]) && next[0] === now[0]) return;
    requestZoom(next);
  }

  function pan(share: number): void {
    const d = c;
    if (!d || d.view.kind === 'donut' || !d.zoom) return;
    const now = currentWindow(d)!;
    const next = panWindow(d.view.xFull, now, share);
    if (next) requestZoom(next);
  }

  function onWheel(event: WheelEvent): void {
    const d = c;
    // Spec I3: only while the plot has focus, and never with Ctrl or Meta (browser zoom, page scroll).
    if (!plotReady(d) || !d.zoom || !proxy || doc.activeElement !== proxy || event.ctrlKey || event.metaKey) return;
    if (event.deltaY === 0) return;
    event.preventDefault();
    const box = plot.getBoundingClientRect();
    const at = positionAt(d.layout, event.clientX - box.left, event.clientY - box.top);
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
    const factor = Math.min(4, Math.max(0.25, Math.exp(event.deltaY * unit * 0.002)));
    zoomBy(factor, at ?? undefined);
  }

  // ── pointer, touch, drag ───────────────────────────────────────────────────────────────────────

  function local(event: PointerEvent): { x: number; y: number } {
    const box = plot.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  function pointAt(at: { x: number; y: number }): void {
    const d = c;
    if (!plotReady(d)) return;
    pointer = at;
    const target = d.lookup.pick(at.x, at.y);
    if (!sameTarget(target, pointerTarget)) {
      pointerTarget = target;
      if (target !== null && dismissed !== null && !sameTarget(dismissed, target)) dismissed = null;
    }
    source = 'pointer';
    present();
  }

  function onPointerMove(event: PointerEvent): void {
    if (event.pointerType === 'touch') {
      const t = touches.get(event.pointerId);
      if (t) {
        const at = local(event);
        t.x = at.x;
        t.y = at.y;
        if (pinch && touches.size === 2) pinchMove();
      }
      return;
    }
    const at = local(event);
    if (down && down.id === event.pointerId) {
      if (!down.dragging && c?.zoom && Math.hypot(at.x - down.x, at.y - down.y) > DRAG_THRESHOLD) {
        down.dragging = true;
        tooltip.hide();
        presented = '';
      }
      if (down.dragging) {
        drawSelection(down, at);
        return;
      }
    }
    pointAt(at);
  }

  function leave(): void {
    pointer = null;
    if (!pinned) pointerTarget = null;
    if (source === 'pointer' && !pinned) source = proxyFocused && !fromClick ? 'keyboard' : null;
    present();
  }

  function onPointerLeave(event: PointerEvent): void {
    if (event.pointerType === 'touch' || down?.dragging) return;
    // The tooltip can be hovered without closing (spec I1).
    if (event.relatedTarget instanceof Node && figure.tooltip.contains(event.relatedTarget)) return;
    leave();
  }

  function onTooltipLeave(event: PointerEvent): void {
    if (event.relatedTarget instanceof Node && plot.contains(event.relatedTarget)) return;
    leave();
  }

  function horizontalBars(d: Committed): boolean {
    return d.layout.kind === 'plot' && d.layout.projection.kind === 'bands' && d.layout.projection.horizontal;
  }

  function drawSelection(from: { x: number; y: number }, to: { x: number; y: number }): void {
    const d = c;
    if (!selection || !d || d.layout.kind !== 'plot') return;
    const p = d.layout.plot;
    const clampX = (v: number) => Math.max(p.x, Math.min(p.x + p.width, v));
    const clampY = (v: number) => Math.max(p.y, Math.min(p.y + p.height, v));
    const box = horizontalBars(d)
      ? { x: p.x, width: p.width, y: Math.min(clampY(from.y), clampY(to.y)), height: Math.abs(clampY(to.y) - clampY(from.y)) }
      : { y: p.y, height: p.height, x: Math.min(clampX(from.x), clampX(to.x)), width: Math.abs(clampX(to.x) - clampX(from.x)) };
    Object.assign(selection.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` });
    selection.hidden = false;
  }

  function endDrag(): void {
    if (selection) selection.hidden = true;
    down = null;
  }

  function onPointerDown(event: PointerEvent): void {
    const d = c;
    if (!plotReady(d)) return;
    const at = local(event);
    if (event.pointerType === 'touch') {
      touches.set(event.pointerId, { ...at, x0: at.x, y0: at.y, t0: event.timeStamp });
      if (touches.size === 2 && d.zoom === 'touch' && d.view.kind !== 'donut') startPinch(d);
      return;
    }
    if (event.button !== 0) return;
    down = { id: event.pointerId, x: at.x, y: at.y, dragging: false };
    if (d.zoom) {
      try { plot.setPointerCapture(event.pointerId); } catch { /* the pointer is already gone */ }
    }
  }

  function onPointerUp(event: PointerEvent): void {
    const d = c;
    if (event.pointerType === 'touch') {
      const t = touches.get(event.pointerId);
      touches.delete(event.pointerId);
      if (pinch) {
        if (touches.size < 2) pinch = null;
        return;
      }
      if (t && plotReady(d) && Math.hypot(t.x - t.x0, t.y - t.y0) < TAP_DISTANCE && event.timeStamp - t.t0 < TAP_TIME) tap(d, t);
      return;
    }
    if (!down || down.id !== event.pointerId) return;
    const was = down;
    endDrag();
    if (plot.hasPointerCapture?.(event.pointerId)) plot.releasePointerCapture(event.pointerId);
    if (!plotReady(d)) return;
    const at = local(event);
    if (was.dragging) {
      const horizontal = horizontalBars(d);
      const a = positionAt(d.layout, was.x, was.y);
      const b = positionAt(d.layout, at.x, at.y);
      if (a === null || b === null || d.view.kind === 'donut') return;
      const full = d.view.xFull;
      const lo = Math.max(full[0], Math.min(a, b));
      const hi = Math.min(full[1], Math.max(a, b));
      if (hi - lo >= minimumWidth(d.view) / 2 && Math.abs(horizontal ? at.y - was.y : at.x - was.x) > DRAG_THRESHOLD) {
        requestZoom(hi - lo >= full[1] - full[0] ? null : [lo, hi]);
      }
      pointAt(at);
      return;
    }
    // A click: the keyboard continues from here, the wheel may zoom, and the datum is selected.
    pointAt(at);
    if (!pointerTarget || !proxy) return;
    clickFocus = true;
    try {
      proxy.focus({ preventScroll: true });
    } finally {
      clickFocus = false;
    }
    const ref = d.lookup.primary(pointerTarget);
    if (ref) {
      focus = mode === 'single' && focus?.kind === 'aligned' && pointerTarget.kind === 'x'
        ? d.lookup.resolve({ kind: 'aligned', seriesKey: focus.seriesKey, x: pointerTarget.x }) ?? ref : ref;
      writeProxy(true);
      actions.select(focus);
    }
  }

  function onPointerCancel(event: PointerEvent): void {
    if (event.pointerType === 'touch') {
      // The page took the gesture (a one-finger drag scrolls, spec I4).
      touches.delete(event.pointerId);
      if (touches.size < 2) pinch = null;
      return;
    }
    endDrag();
    leave();
  }

  function tap(d: Committed, at: { x: number; y: number }): void {
    const target = d.lookup.pick(at.x, at.y);
    pointer = null;
    if (target === null) {
      unpin();
      return;
    }
    pointerTarget = target;
    pinned = true;
    dismissed = null;
    source = 'pointer';
    if (attached) doc.addEventListener('pointerdown', onDocumentDown, true);
    dirty = true;
    present();
  }

  function unpin(): void {
    if (!pinned) return;
    pinned = false;
    pointerTarget = null;
    doc.removeEventListener('pointerdown', onDocumentDown, true);
    if (source === 'pointer') source = proxyFocused ? 'keyboard' : null;
    present();
  }

  function onDocumentDown(event: PointerEvent): void {
    const inside = event.target instanceof Node && (plot.contains(event.target) || figure.tooltip.contains(event.target) || figure.readout.contains(event.target));
    if (!inside) unpin();
  }

  function startPinch(d: Committed): void {
    const [a, b] = [...touches.values()];
    if (!a || !b || d.view.kind === 'donut') return;
    const window = currentWindow(d)!;
    const center = positionAt(d.layout, (a.x + b.x) / 2, (a.y + b.y) / 2) ?? (window[0] + window[1]) / 2;
    pinch = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), window, center };
    tooltip.hide();
    presented = '';
  }

  function pinchMove(): void {
    const d = c;
    const [a, b] = [...touches.values()];
    if (!pinch || !a || !b || !plotReady(d) || d.view.kind === 'donut' || d.layout.kind !== 'plot') return;
    const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const { window, center } = pinch;
    const width = Math.max(minimumWidth(d.view), (window[1] - window[0]) * pinch.distance / distance);
    const p = d.layout.plot;
    const horizontal = horizontalBars(d);
    const share = horizontal ? ((a.y + b.y) / 2 - p.y) / p.height : ((a.x + b.x) / 2 - p.x) / p.width;
    // The position that was under the fingers stays under them: zoom and two-finger pan in one.
    const full = d.view.xFull;
    const start = Math.max(full[0], Math.min(center - share * width, full[1] - width));
    pinchWindow = width >= full[1] - full[0] ? null : [start, start + width];
    if (pinchFrame === 0) {
      pinchFrame = doc.defaultView!.requestAnimationFrame(() => {
        pinchFrame = 0;
        if (pinchWindow !== undefined) requestZoom(pinchWindow);
        pinchWindow = undefined;
      });
    }
  }

  function onDocumentKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (down?.dragging) {
      endDrag();
      return;
    }
    // The pointer's tooltip closes on Escape wherever focus is; the key is not consumed (decision 0001).
    if (source === 'pointer' && tooltip.visible && pointerTarget) {
      dismissed = pointerTarget;
      dirty = true;
      present();
    }
  }

  // ── controls ───────────────────────────────────────────────────────────────────────────────────

  function tableOpen(): boolean {
    return tableView !== null;
  }

  function openTable(): void {
    const d = cs;
    if (!d?.reader.table || tableView) return;
    const xKind = d.view.kind === 'donut' ? 'category' : d.view.kind === 'scatter' ? d.view.frame.xKind : d.view.frame.x.kind;
    tableView = createTableView(doc, figure.id, text => {
      if (text === '') return null;
      if (xKind === 'number') {
        const n = Number(text.replace(/\s/g, ''));
        return Number.isFinite(n) ? n : null;
      }
      return text;
    });
    // The plot keeps its size while the table is open, so the table never squeezes it.
    const height = figure.body.getBoundingClientRect().height;
    figure.body.style.flex = 'none';
    figure.body.style.height = `${height}px`;
    figure.figure.classList.add('axylo-table-open');
    tableModel = null;
    renderTable(d);
  }

  function closeTable(): void {
    if (!tableView) return;
    tableView.destroy();
    tableView = null;
    tableModel = null;
    figure.body.style.flex = '';
    figure.body.style.height = '';
    figure.figure.classList.remove('axylo-table-open');
  }

  function renderTable(d: ControlsState): void {
    const model = d.reader.table;
    if (!tableView || !model) return;
    if (model !== tableModel) {
      tableModel = model;
      const m = d.messages;
      tableView.update(model, {
        previousPage: m.previousPage, nextPage: m.nextPage,
        pageOf: (page, count) => fill(m.pageOf, { page: d.formatters.count(page), count: d.formatters.count(count) }),
        jump: fill(m.jumpToX, { x: model.headers[0] ?? '' }),
        lang: key => d.english(key),
      }, Math.max(160, plot.getBoundingClientRect().height));
    }
    if (!tableView.element.isConnected) figure.controls.appendChild(tableView.element);
  }

  function legendItems(d: ControlsState): ToolbarItem[] {
    const view = d.view;
    if (!d.legend || view.kind === 'donut' || d.tooSmall) return [];
    const series = view.frame.series;
    if (series.length < 2) return [];
    const hiddenLang = d.english('controlsLabel') ? d.pageLang : null;
    return series.map((s, i) => {
      const shown = view.visible[i] === true;
      return {
        key: `series:${s.key}`, label: s.label, pressed: shown, lang: hiddenLang, className: 'axylo-control axylo-legend-entry',
        struck: !shown, swatch: seriesSwatch(view.kind, i, view.cues[i] ?? null, !shown),
        activate: () => actions.toggle(s.key),
      };
    });
  }

  function controlItems(d: ControlsState): ToolbarItem[] {
    const m = d.messages;
    const items: ToolbarItem[] = [];
    if (d.ready) items.push(...legendItems(d));
    // Inside a toolbar marked English, a replaced label is marked with the page's language again.
    const inherited = d.english('controlsLabel') ? d.pageLang : null;
    const button = (key: keyof Messages, activate: () => void): ToolbarItem =>
      ({ key, label: m[key], lang: d.english(key) ?? inherited, className: 'axylo-control', activate });
    if (d.ready && d.zoom && !d.tooSmall) {
      items.push(button('zoomIn', () => zoomBy(1 / ZOOM_FACTOR)), button('zoomOut', () => zoomBy(ZOOM_FACTOR)));
      if (d.zoomed) items.push(button('resetZoom', () => requestZoom(null)));
    } else if (d.zoom && d.zoomed && !d.tooSmall) {
      // A window with nothing in it shows the empty state; the way back to everything stays.
      items.push(button('resetZoom', () => requestZoom(null)));
    }
    if (d.streaming && d.ready) {
      const key = d.paused ? 'resume' : 'pause';
      items.push({ ...button(key, () => actions.pause(!d.paused)), key: 'pause' });
    }
    if (d.reader.table && d.ready) {
      const open = tableOpen();
      const key = open ? 'hideTable' : 'viewAsTable';
      items.push({
        ...button(key, () => {
          if (tableOpen()) closeTable();
          else openTable();
          if (cs) renderControls(cs);
        }),
        key: 'table',
        expanded: open, controls: `${figure.id}-table`,
      });
    }
    return items;
  }

  function renderDonutLegend(d: ControlsState): void {
    const view = d.view;
    if (view.kind !== 'donut' || !d.legend || !d.ready) {
      legendList?.remove();
      legendList = null;
      return;
    }
    legendList ??= doc.createElement('ul');
    legendList.className = 'axylo-legend-list';
    const entries = view.slices.map(slice => {
      const datum = sliceText(view, slice, d.formatters);
      const li = doc.createElement('li');
      li.appendChild(createSwatch(doc, { color: slice.colorIndex, cue: null, line: false, hollow: slice.angles === null }));
      const name = doc.createElement('span');
      name.className = 'axylo-legend-name';
      name.textContent = slice.label;
      const value = doc.createElement('span');
      value.className = 'axylo-legend-value';
      const percent = datum?.percent;
      value.textContent = datum ? (percent && percent !== datum.value ? `${datum.value} (${percent})` : datum.value) : '';
      li.append(name, value);
      return li;
    });
    const signature = entries.map(e => e.textContent).join('\u0000') + view.slices.map(s => s.colorIndex).join();
    if (legendList.dataset.signature !== signature) {
      legendList.replaceChildren(...entries);
      legendList.dataset.signature = signature;
    }
  }

  /** Puts exactly `wanted`, in order, into `host`, moving rather than rebuilding (focus stays). */
  function place(host: HTMLElement, wanted: readonly Element[]): void {
    let at: ChildNode | null = host.firstChild;
    for (const el of wanted) {
      if (at !== el) host.insertBefore(el, at);
      at = el.nextSibling;
    }
    while (at) {
      const next: ChildNode | null = at.nextSibling;
      at.remove();
      at = next;
    }
    host.hidden = wanted.length === 0;
  }

  function renderControls(d: ControlsState): void {
    if (!toolbar) return;
    cs = d;
    renderDonutLegend(d);
    const items = controlItems(d);
    toolbar.render(items, d.messages.controlsLabel, d.english('controlsLabel'));
    // The legend, and the toolbar it is part of (one tab stop, spec A2), go where `legend` says; the table
    // always opens under the plot.
    const legend: Element[] = [];
    if (legendList) legend.push(legendList);
    if (items.length) legend.push(toolbar.element);
    const where = d.legend === 'top' ? figure.top : d.legend === 'right' ? figure.side : figure.controls;
    const bottom: Element[] = where === figure.controls ? [...legend] : [];
    if (tableView && d.reader.table && d.ready) {
      renderTable(d);
      bottom.push(tableView.element);
    } else if (tableView) {
      closeTable();
    }
    if (where !== figure.controls) place(where, legend);
    for (const other of [figure.top, figure.side]) if (other !== where) place(other, []);
    place(figure.controls, bottom);
  }

  // ── commit ─────────────────────────────────────────────────────────────────────────────────────

  function placeProxy(d: Committed): void {
    if (!proxy || !ring) return;
    const usable = plotReady(d);
    proxy.hidden = !usable;
    ring.hidden = !usable;
    if (!usable || d.layout.kind !== 'plot') return;
    const p = d.layout.plot;
    const style = `left: ${p.x}px; top: ${p.y}px; width: ${p.width}px; height: ${p.height}px;`;
    if (proxy.style.cssText !== style) {
      proxy.style.cssText = style;
      ring.style.cssText = style;
    }
    setAttr(proxy, 'aria-label', d.messages.plotLabel);
    const type = { line: 'typeLine', area: 'typeArea', bar: 'typeBar', scatter: 'typeScatter', donut: 'typeDonut' } as const;
    setAttr(proxy, 'aria-roledescription', fill(d.messages.plotRole, { type: d.messages[type[d.kind]] }));
    plot.classList.toggle('axylo-touch-zoom', d.zoom === 'touch');
    plot.classList.toggle('axylo-zoomable', d.zoom !== false);
  }

  function commit(next: Committed | null): void {
    if (destroyed) return;
    const previous = c;
    c = next;
    pendingWindow = undefined;
    dirty = true;
    if (!next || !next.interactive) {
      clear();
      return;
    }
    build();
    if (previous && previous.epoch !== next.epoch) {
      // A DatumRef means nothing across a data replacement.
      focus = null;
      mode = 'all';
      dismissed = null;
      unpin();
    }
    if (focus) {
      // Spec A7: focus follows its datum, and never points at something that is gone.
      const resolved = next.lookup.resolve(focus);
      focus = resolved;
      if (resolved === null) mode = 'all';
      else if (mode === 'all' && resolved.kind === 'aligned') focus = next.lookup.primary({ kind: 'x', x: resolved.x }) ?? resolved;
    }
    if (!plotReady(next)) {
      pointerTarget = null;
      if (pinned) unpin();
    } else if (pointer && !down?.dragging) {
      pointerTarget = next.lookup.pick(pointer.x, pointer.y);
    } else if (pinned && pointerTarget && next.lookup.tooltip(pointerTarget).rows.length === 0) {
      unpin();
    }
    placeProxy(next);
    writeProxy(false);
    renderControls(next);
    present();
  }

  function prepare(state: ControlsState): boolean {
    if (destroyed) return false;
    const before = layoutSignature();
    if (!state.interactive) {
      c = null;
      cs = null;
      clear();
    } else {
      build();
      renderControls(state);
    }
    return layoutSignature() !== before;
  }

  /** What around the plot can change its size: which controls exist, where, and their labels. */
  function layoutSignature(): string {
    return [figure.top, figure.side, figure.controls].map(host => host.hidden ? '' : host.textContent ?? '').join('\u0000');
  }

  function clear(): void {
    const d = c;
    if (presented !== '' && d) renderer.drawOverlay(null, d.bindings, d.theme, d.pixelRatio);
    presented = '';
    tooltip.hide();
    unbuild();
    focus = null;
    pointerTarget = null;
    pinned = false;
    hover(null);
  }

  return {
    prepare,
    commit,
    clear() {
      c = null;
      cs = null;
      clear();
    },
    attach() {
      if (attached || destroyed) return;
      attached = true;
      if (proxy) doc.addEventListener('keydown', onDocumentKey);
    },
    detach() {
      if (!attached) return;
      attached = false;
      doc.removeEventListener('keydown', onDocumentKey);
      unpin();
      doc.removeEventListener('pointerdown', onDocumentDown, true);
    },
    destroy() {
      if (destroyed) return;
      clear();
      destroyed = true;
      if (pinchFrame !== 0) doc.defaultView?.cancelAnimationFrame(pinchFrame);
    },
  };
}
