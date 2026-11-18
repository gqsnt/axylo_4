/**
 * Everything a reader uses to explore a full chart (decision 0001; spec I1–I6, A2–A4, A7): one piece of
 * state, "what the reader is on", driven by pointer, touch and keyboard alike, and what is derived from it:
 * the tooltip, the overlay (drawn with `renderer.drawOverlay`, never by redrawing the scene), the keyboard
 * proxy's range and value text and the `hover` event. Plus the toolbar (legend, zoom, pause, table), the
 * table view and the zoom gestures.
 *
 * The controller calls `commit` after every frame it draws, with the state that frame shows; this module
 * never reads a newer state than the marks show. It changes the chart only through `actions`, which go
 * through the public paths (zoom, the view's hidden set, pause), so every change follows the commit contract.
 *
 * The proxy's range always matches the frame on screen: its bounds, value and text are compared with what
 * the lookup says now and rewritten where they differ (review 2, finding 4). A datum keeps its identity across
 * commits: on a sliding category axis a reference is moved to the same category's new place, and a datum
 * that left the window resolves by the lookup's rule (finding 2). No live region is touched by a commit.
 *
 * Every listener on the chart's own elements is registered with one abort signal per build, so clearing the
 * layer or destroying the chart removes them all.
 */
import type {
  DatumRef, DatumText, Formatters, Layout, Lookup, MarkRenderer, Overlay, PaintBindings, PickTarget, ReaderModel,
  Rect, ResolvedTheme, StepDirection, View, XValue,
} from '../core/contracts';
import type { Messages } from '../public';
import { fill } from '../messages';
import {
  buildOverlay, OUTLINE_REACH, RING_REACH, canZoomIn, minimumWidth, panWindow, positionAt, positionText, refsAt, sameRef, stepAcross, stepInSeries, zoomStep,
  targetBox, targetOf, valueText, PAN_SHARE, ZOOM_FACTOR, type Mode,
} from '../core/focus';
import type { Figure } from './figure';
import { sameTarget } from './pointer';
import { createTableView, type TableView } from './table';
import { createToolbar, type Toolbar, type ToolbarItem } from './toolbar';
import { createTooltip, cssScale, type Placement, type TooltipContent } from './tooltip';
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
  /**
   * The data can be inspected although nothing is drawn (an empty window, an all-zero donut): the table and
   * the donut's slice list stay (spec F8, A4, L7).
   */
  readonly inspectable?: boolean;
  /** The chart shows its empty state (not loading or error): a zoomed window with nothing in it can recover. */
  readonly empty?: boolean;
  /** The state's message while not ready ("Loading chart."), which the plot reads instead of data. */
  readonly message?: string | null;
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
  /**
   * Readout mode (decision 0004 revision 2, rule 5), decided by layout: the plot is narrower than 240 or
   * shorter than 140 CSS px. A strip of two lines is reserved under the plot and there is no floating tooltip.
   */
  readonly readout?: boolean;
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
   * tooltip, scrolling) may be held. `detach` lets go of them while the chart is out of the document.
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
  if (kind === 'bar') return { color: index, cue, line: false, hollow, fill: true, pattern: seriesPattern(index) };
  if (kind === 'area') return { color: index, cue, line: false, hollow, fill: true, marker: true, pattern: null };
  return { color: index, cue, line: kind === 'line', hollow };
}

const NAVIGATION: Readonly<Record<string, StepDirection>> = {
  ArrowRight: 'next', ArrowLeft: 'previous', Home: 'first', End: 'last', PageUp: 'page-next', PageDown: 'page-previous',
};
const DRAG_THRESHOLD = 4;
/** Decision 0004 rule 3b: a pointer that stays within 2 CSS px for 250 ms has come to rest on its datum. */
const REST_DISTANCE = 2;
const REST_TIME = 250;
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

function categoriesOf(view: View): readonly string[] | null {
  return view.kind !== 'donut' && view.kind !== 'scatter' && view.frame.x.kind === 'category' ? view.frame.x.categories : null;
}

export function createInteraction(figure: Figure, renderer: MarkRenderer, actions: Actions): Interaction {
  const doc = figure.figure.ownerDocument;
  const plot = figure.plot;
  const tooltip = createTooltip(figure.tooltip, figure.readout, figure.figure);

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
  let shownOrdinal = 0;
  /** What the value text was last written about (decision 0004, part 2). */
  let shownText: { ref: DatumRef | null; mode: Mode; reading: string | null } | null = null;
  /** The pointer's datum and the rectangle its floating tooltip took (decision 0004 r2, rule 3). */
  let heldTip: { target: PickTarget; rect: Rect; across: boolean } | null = null;
  /** Rule 3b: where the pointer last came to rest (plot pixels) and since when (event time, ms). */
  let rest: { at: { x: number; y: number }; time: number } | null = null;
  /** Rule 3b: the datum held along the corridor from its resting position (viewport) to its tooltip. */
  let corridor: { from: { x: number; y: number }; rect: Rect; target: PickTarget } | null = null;
  let lastHover: DatumRef | null = null;
  let presented = '';
  let dirty = true;
  /** A zoom requested but not committed yet, so quick repeats (wheel, key repeat) build on each other. */
  let pendingWindow: Span | null | undefined;
  let tableView: TableView | null = null;
  let tableModel: unknown = null;
  /** The one pointer that owns a press or drag (review 2, finding 10); others are ignored until it ends. */
  let down: { id: number; x: number; y: number; dragging: boolean } | null = null;
  const touches = new Map<number, { x: number; y: number; x0: number; y0: number; t0: number }>();
  /** The two fingers a pinch started with (`ids`): a third finger does not take it over (new item 10). */
  let pinch: { ids: readonly [number, number]; distance: number; window: Span; center: number } | null = null;
  /** A pinch happened since the last time no finger was down: the lifting fingers are not a tap. */
  let pinched = false;
  let pinchFrame = 0;
  let pinchWindow: Span | null | undefined;
  let destroyed = false;
  /** The chart is in the document, so the document's own listeners may be held. */
  let attached = true;
  let built: AbortController | null = null;
  let documentListeners: AbortController | null = null;

  // ── elements (built for full charts only) ──────────────────────────────────────────────────────

  let proxy: HTMLInputElement | null = null;
  let ring: HTMLElement | null = null;
  let instructions: HTMLElement | null = null;
  let selection: HTMLElement | null = null;
  let legendList: HTMLUListElement | null = null;
  let toolbar: Toolbar | null = null;

  function listenDocument(): void {
    if (documentListeners || !attached || !proxy) return;
    documentListeners = new AbortController();
    const signal = documentListeners.signal;
    // Capture: a drag cancelled with Escape consumes the key before a containing dialog sees it.
    doc.addEventListener('keydown', onDocumentKey, { capture: true, signal });
    doc.addEventListener('scroll', onScroll, { capture: true, passive: true, signal });
    doc.defaultView?.addEventListener('blur', onWindowBlur, { signal });
    if (pinned) doc.addEventListener('pointerdown', onDocumentDown, { capture: true, signal });
  }

  function unlistenDocument(): void {
    documentListeners?.abort();
    documentListeners = null;
  }

  function build(): void {
    if (proxy) return;
    built = new AbortController();
    const signal = built.signal;
    proxy = doc.createElement('input');
    proxy.type = 'range';
    proxy.className = 'axylo-proxy';
    proxy.id = `${figure.id}-proxy`;
    proxy.min = '0';
    proxy.step = '1';
    proxy.addEventListener('keydown', onProxyKey, { signal });
    proxy.addEventListener('input', onProxyInput, { signal });
    proxy.addEventListener('change', onProxyInput, { signal });
    proxy.addEventListener('focus', onProxyFocus, { signal });
    proxy.addEventListener('blur', onProxyBlur, { signal });
    ring = doc.createElement('div');
    ring.className = 'axylo-focus-ring';
    ring.setAttribute('aria-hidden', 'true');
    instructions = doc.createElement('span');
    instructions.className = 'axylo-visually-hidden';
    instructions.id = `${figure.id}-i`;
    selection = doc.createElement('div');
    selection.className = 'axylo-selection';
    selection.setAttribute('aria-hidden', 'true');
    selection.hidden = true;
    plot.append(proxy, ring, selection, instructions);
    toolbar = createToolbar(doc);
    plot.addEventListener('pointermove', onPointerMove, { signal });
    plot.addEventListener('pointerleave', onPointerLeave, { signal });
    plot.addEventListener('pointerdown', onPointerDown, { signal });
    plot.addEventListener('pointerup', onPointerUp, { signal });
    plot.addEventListener('pointercancel', onPointerCancel, { signal });
    plot.addEventListener('lostpointercapture', onLostCapture, { signal });
    plot.addEventListener('wheel', onWheel, { passive: false, signal });
    figure.tooltip.addEventListener('pointerleave', onTooltipLeave, { signal });
    figure.readout.addEventListener('pointerleave', onTooltipLeave, { signal });
    figure.stage.addEventListener('pointerleave', onStageLeave, { signal });
    listenDocument();
  }

  /**
   * The plot is about to stop being focusable (too small, compact, failure) while it has focus: focus goes to
   * the table control when there is one, else to the figure itself, which takes focus from script only, so no
   * tab stop is added (WCAG 2.4.3; interaction review, new item 6).
   */
  function handOff(toolbarStays = true): void {
    if (!proxy || doc.activeElement !== proxy) return;
    if (toolbarStays && toolbar?.focus('table')) return;
    const root = figure.figure;
    if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');
    root.focus({ preventScroll: true });
  }

  /** Gesture work that has not reached the chart yet is dropped: cancel, blur, detach, rebuild (new item 10). */
  function cancelGestures(): void {
    endDrag();
    touches.clear();
    pinch = null;
    pinched = false;
    if (pinchFrame !== 0) doc.defaultView?.cancelAnimationFrame(pinchFrame);
    pinchFrame = 0;
    pinchWindow = undefined;
  }

  /** A pinch that ends normally (a finger lifts) keeps its last move: the queued window is applied now. */
  function endPinch(): void {
    pinch = null;
    if (pinchFrame !== 0) doc.defaultView?.cancelAnimationFrame(pinchFrame);
    pinchFrame = 0;
    const last = pinchWindow;
    pinchWindow = undefined;
    if (last !== undefined) requestZoom(last);
  }

  function unbuild(): void {
    if (!proxy) return;
    handOff(false);
    cancelGestures();
    closeTable();
    unlistenDocument();
    built?.abort();
    built = null;
    proxy.remove();
    instructions?.remove();
    instructions = null;
    ring?.remove();
    selection?.remove();
    legendList?.remove();
    toolbar?.destroy();
    proxy = ring = selection = legendList = null;
    toolbar = null;
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

  // The guards name a subtype, so a failed check narrows only away from null, never to `never`.
  function plotReady(d: Committed | null): d is Committed & { readonly ready: true } {
    return d !== null && d.ready && d.layout.kind === 'plot';
  }

  /** A zoomed window with nothing in it: the plot keeps its focus and its zoom keys, so the reader can go back. */
  function recoverable<T extends ControlsState>(d: T | null): d is T & { readonly zoomed: true } {
    // Loading and error are not an empty window: zooming out would not bring anything back (new item 8).
    return d !== null && !d.ready && d.empty === true && d.zoom !== false && d.zoomed && !d.tooSmall;
  }

  /** Some series is shown: with every one hidden by the legend there is nothing to read (new item 8). */
  function readable(d: Committed): boolean {
    return d.view.kind === 'donut' || d.view.visible.some(Boolean);
  }

  function initialFocusFor(d: Committed): DatumRef | null {
    if (aligned(d.view)) {
      const x = stepAcross(d.view, null, 'first');
      return x === null ? null : d.lookup.primary({ kind: 'x', x });
    }
    return d.lookup.step(null, 'first');
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

  /** What the keyboard's datum shows, as a pointer would see it there: coincident scatter points included. */
  function keyboardTarget(d: Committed, ref: DatumRef): PickTarget {
    if (ref.kind === 'point' && d.view.kind === 'scatter') {
      const box = d.lookup.anchor(ref);
      const picked = box ? d.lookup.pick(box.x + box.width / 2, box.y + box.height / 2) : null;
      if (picked?.kind === 'point' && picked.refs.some(r => sameRef(r, ref))) return picked;
      // The focused point is one of more coincident points than the eight shown: it is shown first, and the
      // full count stays (review 2 item 7); focus and selection keep the ref itself (`focus`).
      if (picked?.kind === 'point' && picked.count > picked.refs.length) {
        return { kind: 'point', refs: [ref, ...picked.refs.slice(0, picked.refs.length - 1)], count: picked.count };
      }
    }
    return targetOf(ref);
  }

  function current(): PickTarget | null {
    if (source === 'keyboard') return proxyFocused && focus && c ? keyboardTarget(c, focus) : null;
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
      markLegend(null);
      return;
    }
    const target = current();
    const visibleRing = proxyFocused && proxy.matches(':focus-visible') ? focus : null;
    const only = mode === 'single' && source === 'keyboard' ? focus : null;
    const showTip = d.tooltip && target !== null && !(dismissed !== null && sameTarget(dismissed, target));
    // The pointer's own position is not part of it: the tooltip depends on the datum only (decision 0004 r2).
    const key = JSON.stringify([target, visibleRing, only, showTip, pinned]);
    markLegend(proxyFocused && focus?.kind === 'slice' ? focus.sliceKey : null);
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
          // A pinned row selects its series, so one that is not the primary can be chosen without a keyboard
          // (WCAG 2.5.1); a hovered tooltip is text (decision 0004 revision 2, rule 4).
          select: row => actions.select(row.ref),
        };
        if (figure.figure.classList.contains('axylo-readout-mode')) tooltip.strip(content, pinned);
        else {
          const placement = placementFor(d, target, only);
          tooltip.show(content, placement, pinned);
          // Where the pointer's datum showed its tooltip: on scatter and donut the datum is held there (rule 3),
          // and whether it went across the reading axis or beside the datum (rule 3b).
          if (source === 'pointer') {
            const rect = tooltip.rect()!;
            heldTip = { target, rect, across: acrossReadingAxis(d, rect, placement.box) };
          }
        }
      }
    }
    hover(target === null ? null : source === 'keyboard' ? focus : d.lookup.primary(target));
  }

  /**
   * Decision 0004 revision 2, rules 1 and 2: where the tooltip may go, from the datum only. The box is the
   * datum's active marks enlarged by the focus ring; the plot is the marks' rectangle inset by the plot's
   * outline; every control of the figure is avoided. All in viewport pixels.
   */
  function placementFor(d: Committed, target: PickTarget, only: DatumRef | null): Placement {
    const box = plot.getBoundingClientRect();
    const k = cssScale(plot);
    const toPage = (r: Rect): Rect => ({ x: box.left + r.x * k.x, y: box.top + r.y * k.y, width: r.width * k.x, height: r.height * k.y });
    const area = d.layout.kind === 'plot' ? d.layout.plot : { x: 0, y: 0, width: d.layout.width, height: d.layout.height };
    const marks = targetBox(d.view, d.lookup, target, only) ?? { x: area.x + area.width / 2, y: area.y + area.height / 2, width: 0, height: 0 };
    const ring = RING_REACH;
    const datum = { x: marks.x - ring, y: marks.y - ring, width: marks.width + 2 * ring, height: marks.height + 2 * ring };
    const inset = OUTLINE_REACH;
    const plotRect = { x: area.x + inset, y: area.y + inset, width: Math.max(0, area.width - 2 * inset), height: Math.max(0, area.height - 2 * inset) };
    let hole: Rect | null = null;
    if (d.layout.kind === 'plot' && d.layout.projection.kind === 'ring' && d.layout.projection.r0 > 0) {
      // The largest square inside the hole.
      const { cx, cy, r0 } = d.layout.projection;
      const half = r0 / Math.SQRT2 - 2;
      if (half > 0) hole = { x: cx - half, y: cy - half, width: 2 * half, height: 2 * half };
    }
    const controls: Rect[] = [];
    for (const el of figure.figure.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]')) {
      if (el === proxy || figure.tooltip.contains(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) controls.push({ x: r.left, y: r.top, width: r.width, height: r.height });
    }
    return {
      box: toPage(datum), plot: toPage(plotRect), order: horizontalBars(d) ? 'horizontal' : 'vertical',
      hole: hole ? toPage(hole) : null, controls,
    };
  }

  function hover(ref: DatumRef | null): void {
    if (sameRef(ref, lastHover)) return;
    lastHover = ref;
    actions.hover(ref);
  }

  /** The donut slice the keyboard is on is marked in the slice list too, which shows arcless slices (review 2, finding 14). */
  function markLegend(sliceKey: string | null): void {
    if (!legendList) return;
    for (const li of legendList.children) li.classList.toggle('axylo-legend-current', sliceKey !== null && (li as HTMLElement).dataset.key === sliceKey);
  }

  // ── the keyboard proxy ─────────────────────────────────────────────────────────────────────────

  /**
   * Makes the range match the frame on screen: bounds, value and text are compared with the lookup's and
   * written where they differ (review 2, finding 4). A datum that did not change keeps the same text, so a
   * commit alone never changes what a reader hears unless what it describes changed.
   */
  /**
   * Decision 0004, part 2: bounds and the numeric value always match the displayed frame, silently. The value
   * text is rewritten when the reader acted (`acted`), when the focused datum is another one than the text
   * describes (it left the frame and focus moved by the lookup's rule), or when that datum's own reading
   * changed; never because only the count or its place changed.
   */
  function writeProxy(acted: boolean): void {
    const d = c;
    if (!proxy || !d) return;
    if (!plotReady(d) || !readable(d)) {
      if (proxy.max !== '0') proxy.max = '0';
      if (proxy.value !== '0') proxy.value = '0';
      shownOrdinal = 0;
      setAttr(proxy, 'aria-valuetext', recoverable(d) || plotReady(d) ? d.messages.empty : d.message ?? d.messages.noData);
      return;
    }
    const ref = focus ?? initialFocus(d);
    const max = String(Math.max(0, d.lookup.count - 1));
    const ordinal = ref ? Math.max(0, d.lookup.ordinal(ref)) : 0;
    const text = ref ? valueText(d.view, d.lookup, ref, mode, d.formatters, d.messages) : null;
    if (proxy.max !== max) proxy.max = max;
    if (proxy.value !== String(ordinal)) proxy.value = String(ordinal);
    // What the text says about the datum itself, without its place in the range.
    const reading = text === null ? null : text.replace(positionText(d.messages, d.formatters, ordinal, d.lookup.count), '');
    const same = shownText !== null && sameRef(ref, shownText.ref) && mode === shownText.mode && reading === shownText.reading;
    if (acted || !same || !proxy.hasAttribute('aria-valuetext')) {
      setAttr(proxy, 'aria-valuetext', text ?? d.messages.noData);
      shownText = { ref, mode, reading };
    }
    shownOrdinal = ordinal;
  }

  function stepFrom(d: Committed, from: DatumRef, direction: StepDirection): DatumRef | null {
    if (mode === 'all' && from.kind === 'aligned' && aligned(d.view)) {
      const x = stepAcross(d.view, from.x, direction);
      return x === null ? null : d.lookup.primary({ kind: 'x', x });
    }
    if (mode === 'single' && from.kind === 'point' && d.view.kind === 'scatter') return stepInSeries(d.view, from, direction);
    return d.lookup.step(from, direction);
  }

  /** A keyboard move changed what is shown: a tooltip closed with Escape for another datum may show again. */
  function keyboardMoved(d: Committed): void {
    if (dismissed !== null && focus && !sameTarget(dismissed, keyboardTarget(d, focus))) dismissed = null;
    // The reader moved on: a tooltip pinned by a click belongs to the datum that was clicked.
    if (pinned) unpin();
  }

  function move(direction: StepDirection): void {
    const d = c;
    if (!plotReady(d)) return;
    takeover(d);
    if (focus) {
      const next = stepFrom(d, focus, direction);
      if (next) focus = next;
    }
    source = 'keyboard';
    keyboardMoved(d);
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
      // Right and Left now stay in the series the reader chose (review 2, finding 7).
      mode = 'single';
    }
    source = 'keyboard';
    keyboardMoved(d);
    writeProxy(true);
    present();
  }

  /** The datum at a place in the range, for an assistive technology that sets the value directly. */
  function atOrdinal(d: Committed, ordinal: number): DatumRef | null {
    if (aligned(d.view)) {
      const { start, end } = d.view.visibleSlots;
      const i = start + Math.max(0, Math.min(end - start - 1, ordinal));
      const x = d.view.frame.x.values[i];
      if (x === undefined) return null;
      if (mode === 'single' && focus?.kind === 'aligned') return d.lookup.resolve({ kind: 'aligned', seriesKey: focus.seriesKey, x });
      return d.lookup.primary({ kind: 'x', x });
    }
    // Scatter and donut: the place is resolved in the range's own (global) order, with the lookup's global
    // steps only, never series-local ones, and at most `count` steps, so it always ends (review 3, blocker 1).
    let ref = d.lookup.step(null, 'first');
    for (let i = 0; ref && i < ordinal && i < d.lookup.count; i++) {
      const next = d.lookup.step(ref, 'next');
      if (!next) break;
      ref = next;
    }
    // Narrowed mode holds while the place is in the chosen series; another series' point leaves it.
    if (ref && mode === 'single' && focus && 'seriesKey' in focus && 'seriesKey' in ref && ref.seriesKey !== focus.seriesKey) mode = 'all';
    return ref;
  }

  function onProxyKey(event: KeyboardEvent): void {
    const d = c;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const { key } = event;
    const consume = () => { event.preventDefault(); event.stopPropagation(); };
    if (recoverable(d)) {
      // Nothing is drawn in this window: the zoom keys still work, so the reader can go back (finding 3).
      if (key === '-' || key === '_') { consume(); zoomBy(ZOOM_FACTOR); }
      else if (key === '0') { consume(); requestZoom(null); }
      else if (event.shiftKey && (key === 'ArrowLeft' || key === 'ArrowRight')) { consume(); pan(key === 'ArrowRight' ? PAN_SHARE : -PAN_SHARE); }
      else if (key in NAVIGATION || key === 'ArrowUp' || key === 'ArrowDown') event.preventDefault();
      return;
    }
    if (!plotReady(d)) return;
    fromClick = false;
    if (d.zoom && (key === '+' || key === '=')) { consume(); zoomBy(1 / ZOOM_FACTOR); return; }
    if (d.zoom && (key === '-' || key === '_')) { consume(); zoomBy(ZOOM_FACTOR); return; }
    if (d.zoom && key === '0') { consume(); requestZoom(null); return; }
    if (event.shiftKey && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      event.preventDefault();
      if (d.zoom) pan(key === 'ArrowRight' ? PAN_SHARE : -PAN_SHARE);
      return;
    }
    // Every series hidden: there is no datum to move to or select; the range stays on its one place.
    if (!readable(d)) {
      if (key in NAVIGATION || key === 'ArrowUp' || key === 'ArrowDown' || key === 'Enter' || key === ' ') event.preventDefault();
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
      // The keys move by the lookup's rule, not the range's own arithmetic, so no key leaves an intent behind
      // for a later assistive action to misread (review 2, finding 6).
      event.preventDefault();
      move(direction);
    }
  }

  /** An assistive technology set the range's value: go to that place, once, whichever event said so. */
  function onProxyInput(): void {
    const d = c;
    if (!proxy || !plotReady(d)) return;
    if (!readable(d)) { writeProxy(false); return; }
    const ordinal = Number(proxy.value);
    if (!Number.isFinite(ordinal) || ordinal === shownOrdinal) return;
    takeover(d);
    focus = atOrdinal(d, ordinal) ?? focus;
    source = 'keyboard';
    keyboardMoved(d);
    writeProxy(true);
    present();
  }

  function onProxyFocus(): void {
    const d = c;
    proxyFocused = true;
    if (!plotReady(d)) {
      writeProxy(true);
      return;
    }
    fromClick = clickFocus;
    // The pointer's datum is taken over before the keyboard leads (review 2, finding 6).
    takeover(d);
    if (!clickFocus) source = 'keyboard';
    writeProxy(true);
    dirty = true;
    present();
  }

  function onProxyBlur(): void {
    proxyFocused = false;
    fromClick = false;
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

  /** Where a zoom button scales around: the datum the reader is on when it is in the window, else the middle. */
  function zoomCenter(d: Committed, now: Span): number {
    const x = focus?.kind === 'aligned' || focus?.kind === 'point' ? focus.x : NaN;
    return Number.isFinite(x) && x >= now[0] && x <= now[1] ? x : (now[0] + now[1]) / 2;
  }

  /** The window one scaling step would give, or undefined when it would not change. */
  function scaled(d: Committed, factor: number, center?: number): Span | null | undefined {
    if (d.view.kind === 'donut' || !d.zoom) return undefined;
    const now = currentWindow(d)!;
    const at = center ?? zoomCenter(d, now);
    // Zoom in never widens and zoom out never narrows, for the keys and the wheel as for the buttons.
    return zoomStep(d.view.xFull, now, factor, at, minimumWidth(d.view));
  }

  function zoomBy(factor: number, center?: number): boolean {
    const d = c;
    if (!d) return false;
    const next = scaled(d, factor, center);
    if (next === undefined) return false;
    requestZoom(next);
    return true;
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
    const p = local(event);
    const at = positionAt(d.layout, p.x, p.y);
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
    const factor = Math.min(4, Math.max(0.25, Math.exp(event.deltaY * unit * 0.002)));
    // The page keeps the wheel when the chart cannot zoom any further that way (review 2, finding 9).
    if (zoomBy(factor, at ?? undefined)) event.preventDefault();
  }

  // ── pointer, touch, drag ───────────────────────────────────────────────────────────────────────

  function local(event: MouseEvent): { x: number; y: number } {
    // In the plot's layout pixels, which picking and the layout use, also under a CSS transform.
    const box = plot.getBoundingClientRect();
    const k = cssScale(plot);
    return { x: (event.clientX - box.left) / k.x, y: (event.clientY - box.top) / k.y };
  }

  function pointAt(at: { x: number; y: number }, time = doc.defaultView?.performance.now() ?? 0): void {
    const d = c;
    if (!plotReady(d)) return;
    pointer = at;
    // A pinned tooltip stays until Escape, a click elsewhere, or its datum leaves (decision 0004 rule 4).
    if (pinned) return;
    // Rule 3b: a move of more than 2 px ends a rest; a rest of 250 ms on a datum whose tooltip is not across
    // the reading axis opens the corridor to that tooltip, which holds the datum until the pointer leaves it.
    // The corridor opens on the first move after the rest, also one of 2 px or less (a datum at a band's
    // edge would otherwise change on it).
    if (rest && time - rest.time >= REST_TIME && !corridor && pointerTarget && heldTip && !heldTip.across &&
      sameTarget(heldTip.target, pointerTarget) && tooltip.where === 'floating') {
      corridor = { from: toPage(rest.at), rect: heldTip.rect, target: pointerTarget };
    }
    if (!rest || Math.hypot(at.x - rest.at.x, at.y - rest.at.y) > REST_DISTANCE) rest = { at, time };
    if (corridor) {
      if (insideHull(corridor.from, corridor.rect, toPage(at))) {
        pointerTarget = corridor.target;
        source = 'pointer';
        present();
        return;
      }
      corridor = null;
    }
    let target = d.lookup.pick(at.x, at.y);
    // Scatter and donut have no reading axis: while the pointer is inside the tooltip's rectangle the datum
    // is held, computed here from coordinates (the tooltip itself takes no events, rule 3).
    // The rectangle is the one the tooltip had for its datum, also when the way there crossed no datum (the
    // gap between a slice and a tooltip in the hole) and the tooltip was hidden meanwhile.
    if ((d.view.kind === 'scatter' || d.view.kind === 'donut') && heldTip && insideRect(heldTip.rect, at) &&
      (target === null || !sameTarget(target, heldTip.target))) target = heldTip.target;
    // In readout mode the way down to the strip crosses the axis labels under the plot: the datum stays.
    if (target === null && pointerTarget !== null && figure.figure.classList.contains('axylo-readout-mode') &&
      d.layout.kind === 'plot' && at.y > d.layout.plot.y + d.layout.plot.height) target = pointerTarget;
    if (!sameTarget(target, pointerTarget)) {
      pointerTarget = target;
      if (target !== null && dismissed !== null && !sameTarget(dismissed, target)) dismissed = null;
    }
    source = 'pointer';
    present();
  }

  /** A point in plot pixels, in viewport pixels. */
  function toPage(at: { x: number; y: number }): { x: number; y: number } {
    const box = plot.getBoundingClientRect();
    const k = cssScale(plot);
    return { x: box.left + at.x * k.x, y: box.top + at.y * k.y };
  }

  /**
   * Whether the tooltip went across the reading axis (above or below for a horizontal position axis, right or
   * left for horizontal bars), where a straight approach does not change the datum and rule 3b does not apply.
   * Scatter and donut have no reading axis: their tooltips are never across it.
   */
  function acrossReadingAxis(d: Committed, rect: Rect, box: Rect): boolean {
    if (d.view.kind === 'scatter' || d.view.kind === 'donut') return false;
    if (horizontalBars(d)) return rect.x >= box.x + box.width - 0.5 || rect.x + rect.width <= box.x + 0.5;
    return rect.y >= box.y + box.height - 0.5 || rect.y + rect.height <= box.y + 0.5;
  }

  /** Whether a point is inside the convex hull of `from` and the rectangle (all in viewport pixels). */
  function insideHull(from: { x: number; y: number }, r: Rect, p: { x: number; y: number }): boolean {
    const points = [from, { x: r.x, y: r.y }, { x: r.x + r.width, y: r.y }, { x: r.x + r.width, y: r.y + r.height }, { x: r.x, y: r.y + r.height }]
      .sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
      (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    // Andrew's monotone chain: the hull counter-clockwise.
    const lower: { x: number; y: number }[] = [];
    for (const q of points) {
      while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
      lower.push(q);
    }
    const upper: { x: number; y: number }[] = [];
    for (const q of [...points].reverse()) {
      while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
      upper.push(q);
    }
    const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
    if (hull.length < 3) return false;
    // Inside (or on the edge of) a counter-clockwise convex polygon: never to the right of an edge.
    for (let i = 0; i < hull.length; i++) if (cross(hull[i]!, hull[(i + 1) % hull.length]!, p) < -1e-6) return false;
    return true;
  }

  /** Whether a point in plot pixels is inside a rectangle in viewport pixels. */
  function insideRect(r: Rect, at: { x: number; y: number }): boolean {
    const box = plot.getBoundingClientRect();
    const k = cssScale(plot);
    const x = box.left + at.x * k.x;
    const y = box.top + at.y * k.y;
    return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
  }

  function onPointerMove(event: PointerEvent): void {
    if (event.pointerType === 'touch') {
      const t = touches.get(event.pointerId);
      if (t) {
        const at = local(event);
        t.x = at.x;
        t.y = at.y;
        if (pinch && pinch.ids.includes(event.pointerId)) pinchMove();
      }
      return;
    }
    if (down && down.id !== event.pointerId) return;
    const at = local(event);
    if (down) {
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
    pointAt(at, event.timeStamp);
  }

  function leave(): void {
    pointer = null;
    heldTip = null;
    corridor = null;
    rest = null;
    if (!pinned) pointerTarget = null;
    if (source === 'pointer' && !pinned) source = proxyFocused && !fromClick ? 'keyboard' : null;
    present();
  }

  /** The tooltip and the readout can be hovered without closing (spec I1, WCAG 1.4.13). */
  function intoTip(related: EventTarget | null): boolean {
    return related instanceof Node && (figure.tooltip.contains(related) || figure.readout.contains(related));
  }

  function onPointerLeave(event: PointerEvent): void {
    if (event.pointerType === 'touch' || down?.dragging) return;
    if (intoTip(event.relatedTarget)) return;
    // In readout mode the strip under the plot is part of what can be hovered (WCAG 1.4.13): leaving the
    // plot into the plot's column keeps the readout until the column itself is left.
    if (figure.figure.classList.contains('axylo-readout-mode') && event.relatedTarget instanceof Node && figure.stage.contains(event.relatedTarget)) return;
    leave();
  }

  function onStageLeave(event: PointerEvent): void {
    if (event.pointerType === 'touch' || down?.dragging || !figure.figure.classList.contains('axylo-readout-mode')) return;
    if (event.relatedTarget instanceof Node && (figure.stage.contains(event.relatedTarget) || intoTip(event.relatedTarget))) return;
    leave();
  }

  function onTooltipLeave(event: PointerEvent): void {
    if (event.relatedTarget instanceof Node && (plot.contains(event.relatedTarget) || intoTip(event.relatedTarget))) return;
    if (figure.figure.classList.contains('axylo-readout-mode') && event.relatedTarget instanceof Node && figure.stage.contains(event.relatedTarget)) return;
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

  /** Ends a press or drag on every way out: release, cancel, lost capture, Escape, the window losing focus. */
  function endDrag(): void {
    if (selection) selection.hidden = true;
    const was = down;
    down = null;
    if (was && plot.hasPointerCapture?.(was.id)) {
      try { plot.releasePointerCapture(was.id); } catch { /* already released */ }
    }
  }

  function onPointerDown(event: PointerEvent): void {
    const d = c;
    if (!plotReady(d)) return;
    const at = local(event);
    if (event.pointerType === 'touch') {
      touches.set(event.pointerId, { ...at, x0: at.x, y0: at.y, t0: event.timeStamp });
      if (touches.size === 2 && d.zoom === 'touch' && d.view.kind !== 'donut') startPinch(d);
      if (touches.size > 1) pinched = true;
      return;
    }
    // One pointer owns a press at a time; a second one does not take the drag over.
    if (event.button !== 0 || down) return;
    down = { id: event.pointerId, x: at.x, y: at.y, dragging: false };
    // Captured whether or not the chart zooms, so a release outside the plot still ends the press (new item 10).
    try { plot.setPointerCapture(event.pointerId); } catch { /* the pointer is already gone */ }
  }

  function onPointerUp(event: PointerEvent): void {
    const d = c;
    if (event.pointerType === 'touch') {
      const t = touches.get(event.pointerId);
      touches.delete(event.pointerId);
      // A pinch belongs to its two fingers: either lifting ends it, with its last move kept.
      if (pinch && pinch.ids.includes(event.pointerId)) endPinch();
      const wasPinch = pinched;
      if (touches.size === 0) pinched = false;
      // The fingers lifting after a pinch are not a tap.
      if (wasPinch) return;
      if (t && plotReady(d) && Math.hypot(t.x - t.x0, t.y - t.y0) < TAP_DISTANCE && event.timeStamp - t.t0 < TAP_TIME) tap(d, t);
      return;
    }
    if (!down || down.id !== event.pointerId) return;
    const was = down;
    endDrag();
    if (!plotReady(d)) return;
    const at = local(event);
    if (was.dragging) {
      const a = positionAt(d.layout, was.x, was.y);
      const b = positionAt(d.layout, at.x, at.y);
      if (a === null || b === null || d.view.kind === 'donut') return;
      const full = d.view.xFull;
      const lo = Math.max(full[0], Math.min(a, b));
      const hi = Math.min(full[1], Math.max(a, b));
      // The same smallest window as the buttons and keys (review 2, finding 9).
      if (hi - lo >= minimumWidth(d.view) && hi > lo) requestZoom(hi - lo >= full[1] - full[0] ? null : [lo, hi]);
      pointAt(at);
      return;
    }
    // A click: the datum under the pointer is pinned (decision 0004 rule 4), the keyboard continues from
    // here, the wheel may zoom, and the datum is selected.
    if (pinned) { pinned = false; doc.removeEventListener('pointerdown', onDocumentDown, true); }
    pointAt(at);
    if (!pointerTarget || !proxy) return;
    pin();
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
    source = 'pointer';
    present();
  }

  function onPointerCancel(event: PointerEvent): void {
    if (event.pointerType === 'touch') {
      // The page took the gesture (a one-finger drag scrolls, spec I4): what it had not applied is dropped.
      touches.delete(event.pointerId);
      if (pinch && pinch.ids.includes(event.pointerId)) {
        pinch = null;
        if (pinchFrame !== 0) doc.defaultView?.cancelAnimationFrame(pinchFrame);
        pinchFrame = 0;
        pinchWindow = undefined;
      }
      if (touches.size === 0) pinched = false;
      return;
    }
    if (down && down.id !== event.pointerId) return;
    endDrag();
    leave();
  }

  function onLostCapture(event: PointerEvent): void {
    if (down && down.id === event.pointerId) endDrag();
  }

  function onWindowBlur(): void {
    cancelGestures();
  }

  function tap(d: Committed, at: { x: number; y: number }): void {
    const target = d.lookup.pick(at.x, at.y);
    pointer = null;
    if (target === null) {
      unpin();
      return;
    }
    pointerTarget = target;
    pin();
    present();
    // A tap selects, as a click and Enter do (WCAG 2.5.1).
    const ref = d.lookup.primary(target);
    if (ref) actions.select(ref);
  }

  /** Pins the pointer's datum: its tooltip takes events and its rows become buttons. */
  function pin(): void {
    pinned = true;
    dismissed = null;
    source = 'pointer';
    if (attached && documentListeners) doc.addEventListener('pointerdown', onDocumentDown, { capture: true, signal: documentListeners.signal });
    dirty = true;
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
    const [ia, ib] = [...touches.keys()];
    const a = ia === undefined ? undefined : touches.get(ia);
    const b = ib === undefined ? undefined : touches.get(ib);
    if (ia === undefined || ib === undefined || !a || !b || d.view.kind === 'donut') return;
    const window = currentWindow(d)!;
    const center = positionAt(d.layout, (a.x + b.x) / 2, (a.y + b.y) / 2) ?? (window[0] + window[1]) / 2;
    pinch = { ids: [ia, ib], distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), window, center };
    tooltip.hide();
    presented = '';
  }

  function pinchMove(): void {
    const d = c;
    const a = pinch ? touches.get(pinch.ids[0]) : undefined;
    const b = pinch ? touches.get(pinch.ids[1]) : undefined;
    if (!pinch || !a || !b || !plotReady(d) || d.view.kind === 'donut' || d.layout.kind !== 'plot') return;
    const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const { window, center } = pinch;
    const width = Math.max(minimumWidth(d.view), (window[1] - window[0]) * pinch.distance / distance);
    const p = d.layout.plot;
    // The share of the window below the fingers, in the direction the scale increases: rightwards, or upwards
    // on horizontal bars, whose positions grow from the bottom (review 2, finding 10).
    const share = horizontalBars(d) ? (p.y + p.height - (a.y + b.y) / 2) / p.height : ((a.x + b.x) / 2 - p.x) / p.width;
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
      // Escape cancels the drag and is spent on it: a containing dialog does not close as well.
      event.preventDefault();
      event.stopPropagation();
      endDrag();
      return;
    }
    // The pointer's tooltip, hovered or pinned, closes on Escape wherever focus is, until the pointer reaches
    // another datum; the key is not consumed (decision 0001; decision 0004 rule 7).
    if (source === 'pointer' && tooltip.visible && pointerTarget) {
      dismissed = pointerTarget;
      if (pinned) {
        pinned = false;
        doc.removeEventListener('pointerdown', onDocumentDown, true);
      }
      dirty = true;
      present();
    }
  }

  /** A tooltip that stays put (pinned, or the keyboard's) is placed again when the page scrolls under it. */
  function onScroll(): void {
    if (!tooltip.visible || !(pinned || source === 'keyboard')) return;
    dirty = true;
    present();
  }

  // ── controls ───────────────────────────────────────────────────────────────────────────────────

  function tableOpen(): boolean {
    return tableView !== null;
  }

  /**
   * What the reader typed as an x value: numbers as the table writes them in its locale (grouping, decimal
   * mark, a trailing unit), with well-formed grouping only ("1,,2" is not 12); categories exactly as typed.
   */
  function parseJump(raw: string): string | number | null {
    const d = cs;
    if (!d || raw.trim() === '') return null;
    const xKind = d.view.kind === 'donut' ? 'category' : d.view.kind === 'scatter' ? d.view.frame.xKind : d.view.frame.x.kind;
    if (xKind === 'category') return raw;
    const text = raw.trim();
    if (xKind !== 'number') return text;
    const sample = d.formatters.count(1234.5);
    const group = d.formatters.count(1000).replace(/\d/g, '');
    const decimal = sample.replace(/\d/g, '').replace(group, '').charAt(0) || '.';
    const spaces = /^\s$/u.test(group) || group === '\u202f' || group === '\u00a0';
    // Without its unit ("1 234,5 ms"): the number is what comes before the first letter after a digit.
    const number = text.replace(/(\d)\s*[^\d\s.,'\u00a0\u202f-].*$/u, '$1');
    const g = spaces ? '[\\s\\u00a0\\u202f]' : group.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const d0 = decimal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^-?(?:\\d{1,3}(?:${g || 'x'}\\d{3})+|\\d+)(?:${d0}\\d+)?$`, 'u');
    if (!pattern.test(number)) return null;
    const plain = number.replace(new RegExp(g || 'x', 'gu'), '').replace(decimal, '.');
    const value = Number(plain);
    return Number.isFinite(value) ? value : null;
  }

  function jumpTarget(text: string): XValue | null {
    const value = parseJump(text);
    const d = cs;
    if (value === null || !d?.reader.table) return null;
    if (d.reader.table.pageForX(value) !== null || typeof value === 'number') return value;
    const xKind = d.view.kind === 'donut' ? 'category' : d.view.kind === 'scatter' ? d.view.frame.xKind : d.view.frame.x.kind;
    if (xKind === 'date' || xKind === 'time' || xKind === 'wall') {
      // The dates the table shows ("May 31, 2026", "May 31, 2026, 12:00 AM UTC") are accepted as well.
      const parsed = Date.parse(text.replace(/,?\s*(?:UTC|GMT)$/, ' UTC'));
      if (Number.isFinite(parsed)) {
        if (xKind === 'time') return new Date(parsed);
        const day = new Date(parsed);
        const local = Date.parse(text);
        const date = Number.isFinite(local) ? new Date(local) : day;
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      }
    }
    return value;
  }

  function openTable(): void {
    const d = cs;
    if (!d?.reader.table || tableView) return;
    tableView = createTableView(doc, figure.id, text => jumpTarget(text));
    // The table covers the plot's column only, at whatever size the plot has (it stays in the flow, inert,
    // under the table): opening it moves nothing on the page, and the controls beside or under the plot stay
    // reachable (spec A4; review 3, interaction blocker 2). A pinned tooltip belongs to the covered plot.
    figure.figure.classList.add('axylo-table-open');
    plot.inert = true;
    if (pinned) unpin();
    tooltip.hide();
    presented = '';
    tableModel = null;
    renderTable(d);
    // Focus goes into the region that opened, so the next Tab does not leave the chart.
    tableView.focus();
  }

  function closeTable(): void {
    if (!tableView) return;
    // Focus inside the table goes to its disclosure before the table goes (review 2, finding 17).
    const focusInside = tableView.element.contains(doc.activeElement);
    tableView.destroy();
    tableView = null;
    tableModel = null;
    figure.figure.classList.remove('axylo-table-open');
    plot.inert = false;
    if (focusInside) toolbar?.focus('table') || proxy?.focus({ preventScroll: true });
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
        // Shown under the field when nothing matches, with a value the table really has (WCAG 3.3.1, 3.3.3).
        notFound: (text: string) => fill(m.jumpNotFound, { x: text, example: model.row(0)?.[0] ?? '' }),
        lang: key => d.english(key),
      }, 0);
    }
    if (tableView.element.parentNode !== figure.stage) figure.stage.appendChild(tableView.element);
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

  /** Each control is offered for the action it can perform, whatever the display state (review 2, finding 3). */
  function controlItems(d: ControlsState): ToolbarItem[] {
    const m = d.messages;
    const items: ToolbarItem[] = [];
    if (d.ready) items.push(...legendItems(d));
    // Inside a toolbar marked English, a replaced label is marked with the page's language again.
    const inherited = d.english('controlsLabel') ? d.pageLang : null;
    const button = (key: keyof Messages, activate: () => void, disabled = false): ToolbarItem =>
      ({ key, label: m[key], lang: d.english(key) ?? inherited, className: 'axylo-control', activate, disabled });
    if (d.zoom && !d.tooSmall && d.view.kind !== 'donut' && (d.ready || recoverable(d))) {
      const window = d.zoomed ? d.view.xDomain : d.view.xFull;
      if (d.ready) items.push(button('zoomIn', () => zoomBy(1 / ZOOM_FACTOR), !canZoomIn(d.view, window)));
      // Zoom out stays in place at full view, marked as unable to act, so the toolbar does not reflow.
      if (d.ready || d.zoomed) items.push(button('zoomOut', () => zoomBy(ZOOM_FACTOR), !d.zoomed));
      if (d.zoomed) {
        // Single-click pan (WCAG 2.5.7): half a window each way, unavailable at an end.
        const now = d.view.xDomain;
        const full = d.view.xFull;
        items.push(
          button('panLeft', () => pan(-0.5), !(now[0] > full[0])),
          button('panRight', () => pan(0.5), !(now[1] < full[1])),
          button('resetZoom', () => requestZoom(null)),
        );
      }
    }
    if (d.streaming) {
      const key = d.paused ? 'resume' : 'pause';
      items.push({ ...button(key, () => actions.pause(!d.paused)), key: 'pause' });
    }
    if (d.reader.table && (d.ready || d.inspectable)) {
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
    // The slice list is part of the full chart; the too-small state shows only title, summary and table (L8).
    if (view.kind !== 'donut' || !d.legend || d.tooSmall || !(d.ready || d.inspectable || (view.slices.length > 0 && view.total === 0))) {
      legendList?.remove();
      legendList = null;
      return;
    }
    legendList ??= doc.createElement('ul');
    legendList.className = 'axylo-legend-list';
    const entries = view.slices.map(slice => {
      const datum = sliceText(view, slice, d.formatters);
      const li = doc.createElement('li');
      li.dataset.key = slice.key;
      const swatch = createSwatch(doc, { color: slice.colorIndex, cue: null, line: false, hollow: slice.angles === null });
      const name = doc.createElement('span');
      name.className = 'axylo-legend-name';
      name.textContent = slice.label;
      const value = doc.createElement('span');
      value.className = 'axylo-legend-value';
      const percent = datum?.percent;
      value.textContent = datum ? (percent && percent !== datum.value ? `${datum.value} (${percent})` : datum.value) : '';
      // Every slice, a zero or null one included, can be chosen by pointer as by keyboard: a button named by
      // the entry's text, 24 px tall, outside the tab order (new item 9).
      const choose = doc.createElement('button');
      choose.type = 'button';
      choose.tabIndex = -1;
      choose.className = 'axylo-legend-choice';
      choose.append(swatch, name, value);
      choose.addEventListener('mousedown', event => event.preventDefault());
      choose.addEventListener('click', () => actions.select({ kind: 'slice', sliceKey: slice.key }));
      li.append(choose);
      return li;
    });
    const signature = entries.map(e => e.textContent).join('\u0000') + view.slices.map(s => s.colorIndex).join();
    if (legendList.dataset.signature !== signature) {
      legendList.replaceChildren(...entries);
      legendList.dataset.signature = signature;
    }
  }

  /** Puts exactly `wanted`, in order, into `host`, moving rather than rebuilding. */
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
    const active = doc.activeElement;
    toolbar.render(items, d.messages.controlsLabel, d.english('controlsLabel'));
    // The legend, and the toolbar it is part of (one tab stop, spec A2), go where `legend` says.
    const legend: Element[] = [];
    if (legendList) legend.push(legendList);
    if (items.length) legend.push(toolbar.element);
    const where = d.legend === 'top' ? figure.top : d.legend === 'right' ? figure.side : figure.controls;
    if (tableView && !(d.reader.table && (d.ready || d.inspectable))) closeTable();
    else if (tableView) renderTable(d);
    place(where, legend);
    for (const other of [figure.top, figure.side, figure.controls]) if (other !== where) place(other, []);
    // Moving an element can take focus with it; the control the reader was on keeps it (review 2, finding 17).
    if (active instanceof HTMLElement && active !== doc.activeElement && active.isConnected) active.focus({ preventScroll: true });
  }

  // ── commit ─────────────────────────────────────────────────────────────────────────────────────

  function placeProxy(d: Committed): void {
    if (!proxy || !ring) return;
    const ready = plotReady(d);
    const usable = ready || recoverable(d);
    if (!usable) handOff();
    proxy.hidden = !usable;
    ring.hidden = !usable;
    if (!usable) return;
    const p = d.layout.kind === 'plot' ? d.layout.plot : { x: 0, y: 0, width: d.layout.width, height: d.layout.height };
    const style = `left: ${p.x}px; top: ${p.y}px; width: ${p.width}px; height: ${p.height}px;`;
    if (proxy.style.cssText !== style) {
      proxy.style.cssText = style;
      ring.style.cssText = style;
    }
    setAttr(proxy, 'aria-label', d.messages.plotLabel);
    // How to move in the plot, as its description (the plotInstructions message).
    if (instructions) {
      if (instructions.textContent !== d.messages.plotInstructions) instructions.textContent = d.messages.plotInstructions;
      setAttr(instructions, 'lang', d.english('plotInstructions'));
      setAttr(proxy, 'aria-describedby', instructions.id);
    }
    const type = { line: 'typeLine', area: 'typeArea', bar: 'typeBar', scatter: 'typeScatter', donut: 'typeDonut' } as const;
    setAttr(proxy, 'aria-roledescription', fill(d.messages.plotRole, { type: d.messages[type[d.kind]] }));
    // Built-in English on a page in another language is marked as English (spec A10).
    setAttr(proxy, 'lang', d.english('plotLabel') && d.english('plotRole') ? 'en' : null);
    plot.classList.toggle('axylo-touch-zoom', d.zoom === 'touch');
    plot.classList.toggle('axylo-zoomable', d.zoom !== false);
  }

  /**
   * A reference to an aligned datum holds its x position. On a category axis a position is an index, and a
   * sliding window renumbers them, so a reference is moved to its category's new index; a category the window
   * dropped maps to the next one that is still there (the lookup's "after it" rule), else to none.
   */
  /**
   * Category positions across a change of categories. Keyboard focus moves on to the next surviving category
   * (A7); with `exact`, a pin or a dismissal follows only its own category and ends with it (interaction
   * review, part 1 item 2): the reader never pinned or dismissed the successor.
   */
  function remapper(before: View, after: View, exact = false): ((ref: DatumRef | null) => DatumRef | null) | null {
    const from = categoriesOf(before);
    const to = categoriesOf(after);
    if (!from || !to || (from.length === to.length && from.every((name, i) => to[i] === name))) return null;
    const index = new Map(to.map((name, i) => [name, i]));
    const move = (x: number): number | null => {
      for (let i = x; i < from.length; i++) {
        const at = index.get(from[i]!);
        if (at !== undefined) return at;
        if (exact) return null;
      }
      return null;
    };
    return ref => {
      if (ref === null || ref.kind !== 'aligned') return ref;
      const x = move(ref.x);
      return x === null ? null : { ...ref, x };
    };
  }

  function remapTarget(target: PickTarget | null, map: (ref: DatumRef | null) => DatumRef | null): PickTarget | null {
    if (target === null || target.kind !== 'x') return target;
    const moved = map({ kind: 'aligned', seriesKey: '', x: target.x });
    return moved && moved.kind === 'aligned' ? { kind: 'x', x: moved.x } : null;
  }

  /** A pinned target is kept only while it is still in the displayed revision, rebuilt for it (finding 11). */
  function stillPinned(next: Committed, target: PickTarget): PickTarget | null {
    if (target.kind === 'point') {
      // A graphical pin needs its point drawn: no anchor (outside the y domain, say) ends it, and the group is
      // rebuilt from that position, so neighbours that arrived since are counted (part 1 item 11).
      const ref = target.refs.find(r => next.lookup.ordinal(r) >= 0);
      const box = ref ? next.lookup.anchor(ref) : null;
      if (!ref || !box) return null;
      const picked = next.lookup.pick(box.x + box.width / 2, box.y + box.height / 2);
      return picked?.kind === 'point' ? picked : null;
    }
    return next.lookup.tooltip(target).rows.length ? target : null;
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
      // A DatumRef means nothing across a data replacement: one effective focus for the new data is chosen
      // before anything is written, so the text, the ring and the tooltip agree, and the next hover is new
      // (review 3, interaction finding 5).
      mode = 'all';
      dismissed = null;
      unpin();
      heldTip = null;
      corridor = null;
      lastHover = null;
      shownText = null;
      focus = proxyFocused && plotReady(next) ? initialFocusFor(next) : null;
    } else if (previous) {
      const map = remapper(previous.view, next.view);
      if (map) {
        focus = map(focus);
        // The text describes a category, not a position: it is remapped with it, so a sliding window does
        // not rewrite the text of an unchanged datum (decision 0004 part 2; A7).
        if (shownText) shownText = { ...shownText, ref: map(shownText.ref) };
        if (focus === null) mode = 'all';
        lastHover = map(lastHover);
        const same = remapper(previous.view, next.view, true)!;
        dismissed = remapTarget(dismissed, same);
        pointerTarget = remapTarget(pointerTarget, pinned ? same : map);
        if (pinned && pointerTarget === null) unpin();
      }
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
    } else if (pointer && !down?.dragging && !pinned) {
      pointerTarget = next.lookup.pick(pointer.x, pointer.y);
    } else if (pinned && pointerTarget) {
      const kept = stillPinned(next, pointerTarget);
      if (kept === null) unpin();
      else pointerTarget = kept;
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
      // The overlay is cleared while the frame that drew it is still known (new item 6).
      clear();
      c = null;
      cs = null;
    } else {
      build();
      renderControls(state);
    }
    // The strip is reserved before the plot is measured, so the plot's size is the one it really has.
    const strip = state.interactive && state.tooltip && state.readout === true && !state.tooSmall;
    if (figure.figure.classList.contains('axylo-readout-mode') !== strip) {
      figure.figure.classList.toggle('axylo-readout-mode', strip);
      tooltip.hide();
      presented = '';
    }
    return layoutSignature() !== before;
  }

  /** What around the plot can change its size: which controls exist, where, and their labels. */
  function layoutSignature(): string {
    return [figure.top, figure.side, figure.controls].map(host => host.hidden ? '' : host.textContent ?? '').join('\u0000') +
      (figure.figure.classList.contains('axylo-readout-mode') ? '\u0000readout' : '');
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
    // A later full build starts from no input at all (new item 6).
    mode = 'all';
    source = null;
    pointer = null;
    dismissed = null;
    proxyFocused = false;
    fromClick = false;
    hover(null);
  }

  return {
    prepare,
    commit,
    clear() {
      clear();
      c = null;
      cs = null;
    },
    attach() {
      if (attached || destroyed) return;
      attached = true;
      listenDocument();
    },
    detach() {
      if (!attached) return;
      attached = false;
      cancelGestures();
      unpin();
      unlistenDocument();
    },
    destroy() {
      if (destroyed) return;
      clear();
      tooltip.destroy();
      destroyed = true;
      if (pinchFrame !== 0) doc.defaultView?.cancelAnimationFrame(pinchFrame);
    },
  };
}
