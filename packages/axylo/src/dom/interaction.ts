/**
 * Everything a reader uses to explore a full chart (decision 0001; spec I1–I6, A2–A4, A7): pointer, touch,
 * keyboard, tooltip, overlay, toolbar, table and zoom gestures.
 */
import type {
  DatumRef, DatumText, Formatters, Mark, MarkRenderer, Overlay, PickTarget, Rect, StepDirection, TooltipModel, View,
} from '../core/contracts';
import { sameKey } from '../core/composition';
import { chartTypeName, fill } from '../messages';
import {
  overlayWith, OUTLINE_REACH, RING_REACH, RING_STROKE, alignedTargetMarks, canZoomIn, datumReading, minimumWidth, panWindow, pinchWidth,
  pixelOf, positionAt, rangeWindow, refsAt, ringRect, sameRef, stepAcross, zoomStep, valueText, PAN_SHARE, ZOOM_FACTOR, positionText,
  type Mode, type OverlayInput,
} from '../core/focus';
import type { Figure } from './figure';
import { createTableView, type TableView } from './table';
import { createToolbar, type Toolbar } from './toolbar';
import { createTooltip, type Presentation, type TooltipContent, type TooltipView } from './tooltip';
import type { SwatchSpec } from './swatch';
import type { AlignedHoverLookup, AlignedHoverModel } from '../lookup/aligned';
import { firstSlotReading } from '../lookup/text';
import { clamp } from '../scene/geometry';
import { activeElementOf, focusContainer, focusQuiet, isElement, isFocusable, setAttr, make, hideFromAT, shadowRootOf, shadowRootsOf } from './attributes';
import { Listeners, listenOutside, mappingOf, rectToViewport, toLocal, toViewport, visibleRegion, type Mapping, type Point } from './mapping';
import { insideCorridor, intersect, type PlacementInput } from './placement';
import { identityOf, matchesIdentity, sameTarget, type Identity } from './pointer';
import type { Actions, Committed, ControlsState, Interaction, InteractionParts, Span } from './interaction-types';
import {
  INSPECT, presentationFor, collectControlInputs, buildControlItems, offersZoom, recoverable, canZoom, missingLang,
} from './interaction-controls';
import {
  isAligned, plotReady, readable, plotBox, horizontalBars, categoriesOf, firstDatum, keyboardTarget, zoomBounds, markBox, pinnedModel,
  remapTarget, stillPinned, categoryRemapper,
} from './interaction-nav';
import {
  instructionSeries, descriptionFor, renderInstructions, focusedFigure, registerFigure, unregisterFigure, noteShowing, releaseShowing,
  isLastShowing, readingLangFor,
} from './interaction-a11y';
import { resolveJumpTarget } from './table-jump';

export type { Actions, Committed, ControlsState, Interaction, InteractionParts, ReadoutMode, SeriesSwatch, SliceList } from './interaction-types';
export { readoutOf } from './interaction-controls';
export { plotDescription } from './interaction-a11y';
export { parseNumberAs } from './table-jump';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type MutablePlacement = Omit<Mutable<PlacementInput>, 'box'> & { box: Mutable<Rect> };
const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
function setClass(el: Element, cls: string, on: boolean): boolean {
  if (el.classList.contains(cls) === on) return false;
  el.classList.toggle(cls, on);
  return true;
}
function consumeKey(e: KeyboardEvent, immediate = false): void {
  e.preventDefault();
  if (immediate) e.stopImmediatePropagation();
  else e.stopPropagation();
}
function setRangeInput(el: HTMLInputElement, max: string, value: string): void {
  if (el.max !== max) el.max = max;
  if (el.value !== value) el.value = value;
}
function selectionSpan(a: number, b: number, lo: number, extent: number): [number, number] {
  const u = clamp(a, lo, lo + extent), v = clamp(b, lo, lo + extent);
  return [Math.min(u, v), Math.abs(v - u)];
}
const padRect = (x: number, y: number, w: number, h: number, ox: number, oy = ox): Rect =>
  ({ x: x - ox, y: y - oy, width: Math.max(0, w + 2 * ox), height: Math.max(0, h + 2 * oy) });
function plotCoordinate(value: number, offset: number, scale: number, start: number, extent: number): number {
  const pixel = (value - offset) / scale, edge = offset + start * scale;
  return value >= edge - 1 && value <= edge + extent * scale + 1 ? clamp(pixel, start, start + extent) : pixel;
}
const boxStyle = (r: Rect) => `left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px`;

const NAVIGATION: Readonly<Record<string, StepDirection>> = {
  ArrowRight: 'next', ArrowLeft: 'previous', Home: 'first', End: 'last', PageUp: 'page-next', PageDown: 'page-previous',
};
const DRAG_THRESHOLD = 4, REST_DISTANCE = 2, REST_TIME = 250, TAP_DISTANCE = 10, TAP_TIME = 1000, FOCUS_OUTLINE = 3, HOLE_CLEARANCE = 5;

const S_NONE = 0, S_KEY = 1, S_HOVER = 2, S_HELD = 3, S_PIN = 4;
type Shown =
  | { readonly k: 0 | 1 }
  | { readonly k: 2; readonly t: PickTarget | null }
  | { readonly k: 3; readonly t: PickTarget; readonly f: Point; readonly b: Rect; readonly a: Rect | null; readonly p: Presentation }
  | { readonly k: 4; readonly r: DatumRef; readonly t: PickTarget };

interface Content { readonly t: PickTarget; readonly b: Rect; readonly a: Rect | null; readonly p: Presentation; readonly pin: boolean; readonly pg: number }

const NONE: Shown = { k: S_NONE }, KEY: Shown = { k: S_KEY }, NO_HOVER: Shown = { k: S_HOVER, t: null };
const NO_RINGS: readonly Rect[] = [];
// The aligned mark builder only adds unclipped target marks for bands.
const NO_UNCLIPPED_MARKS: Mark[] = [];
const CONTROL_SLOTS = ['top', 'side', 'controls'] as const;
const NO_CONTROLS: readonly Element[] = [];
const SCROLL_OPTIONS = { capture: true, passive: true };
const FOCUS_LISTENERS = 1, DOWN_LISTENERS = 2, MOVE_LISTENERS = 4;
let controlScratch: unknown[] | undefined;

const sameWindow = (a: Span | null, b: Span | null) => a === b || (a !== null && b !== null && a[0] === b[0] && a[1] === b[1]);
const sameRect = (a: Rect | null, b: Rect | null) => a === null || b === null ? a === b
  : Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.width - b.width) < 0.01 && Math.abs(a.height - b.height) < 0.01;
const clientPoint = (e: MouseEvent): Point => ({ x: e.clientX, y: e.clientY });

class DomInteraction implements Interaction {
  readonly #root: HTMLElement;
  readonly #doc: Document;
  readonly #plot: HTMLElement;
  #tooltip: TooltipView | null = null;
  #tooltipContent: Mutable<TooltipContent> | null = null;
  #hoverModel: AlignedHoverModel | null = null;
  #overlayInput: Mutable<OverlayInput> | null = null;

  // Cached per-frame/scroll/resize geometry (Stage 2/3 invariant).
  #geoPlot: Mapping | null = null;
  #geoFigure: Mapping | null = null;
  #geoVisible: Rect | null = null;
  #geoReadout: Rect | null = null;
  #geoControls: readonly Rect[] | null = null;
  #controlNodes: readonly HTMLElement[] | null = null;
  #geoPlacement: MutablePlacement | null = null;
  #committed: Committed | null = null;
  #controlsState: ControlsState | null = null;
  #lastControls: unknown[] | null = null;
  #focus: DatumRef | null = null;
  #handoffSliceKey: string | null = null;
  #single = false;
  #shown: Shown = NONE;
  #pointer: Mutable<Point> | null = null;
  #hoverState: { k: 2; t: PickTarget | null } | null = null;
  #rest: { x: number; y: number; t: number; g: PickTarget | null } | null = null;
  #content: Content | null = null;
  #dismissed: Identity[] | null = null;
  #pinPage = 0;
  #range: { s: number | null } | null = null;
  #proxyFocused = false;
  #keyed = false;
  #clickFocus = false;
  #fromClick = false;
  #shownOrdinal = 0;
  #shownText: { r: DatumRef; s: boolean; d: string | null } | null = null;
  #lastHover: DatumRef | null = null;
  #lastPres: [PickTarget | null, DatumRef | null, DatumRef | null, number, number] | null = null;
  #dirty = true;
  #overlayVisible = false;
  #pendingWindow: Span | null | undefined;
  #tableView: TableView | null = null;
  #tableModel: unknown = null;
  #down: { id: number; x: number; y: number; d: boolean } | null = null;
  #touches: Map<number, { x: number; y: number; x0: number; y0: number; t0: number }> | null = null;
  #pinch: { ids: readonly [number, number]; d: number; w: Span; c: number } | null = null;
  #pinched = false;
  #pinchFrame = 0;
  #pinchWindow: Span | null | undefined;
  #destroyed = false;
  #attached = true;
  #listenStage: HTMLElement | null = null;
  #startupListener: EventListener | null = null;
  #pointerMoveListener: EventListener | null = null;
  #built: Listeners | null = null;
  #docListeners: Listeners | null = null;
  #pinListeners: Listeners | null = null;
  #shadowScrollListeners: Listeners | null = null;
  #interacted = false;
  #listenerFlags = 0;
  #proxy: HTMLInputElement | null = null;
  #ring: HTMLElement | null = null;
  #proxyRect: Rect | null = null;
  #instructions: HTMLElement | null = null;
  #selection: HTMLElement | null = null;
  #legendList: HTMLUListElement | null = null;
  #toolbar: Toolbar | null = null;
  #legendMarked: HTMLElement | null = null;
  #proxyUsable: boolean | null = null;
  #proxyInstructionState: Committed | null = null;
  #proxyInstructionCount = 0;
  #proxyInstructionLang: string | null = null;
  #plotInstructionLang: string | null = null;
  #seriesInstructionLang: string | null = null;
  #donutInstructionLang: string | null = null;
  #zoomInstructionLang: string | null = null;
  #idleProxyState: Committed | null = null;
  #idleHasData = false;
  #idleEmpty = '';
  #proxyLang: string | null | undefined;
  #idleCount: number | undefined;
  #idlePosition = '';
  #idleMax = '';
  #countFormatter: Formatters['count'] | undefined;
  #positionTemplate: string | undefined;
  #zoomCheckView: View | null = null;
  #zoomCheckWindow: Span | null = null;
  #zoomCheckResult = false;
  #swatches: SwatchSpec[] | null = null;

  readonly #parts: InteractionParts;
  readonly #figure: Figure;
  readonly #renderer: MarkRenderer;
  readonly #actions: Actions;

  constructor(
    parts: InteractionParts,
    figure: Figure,
    renderer: MarkRenderer,
    actions: Actions,
  ) {
    this.#parts = parts;
    this.#figure = figure;
    this.#renderer = renderer;
    this.#actions = actions;
    this.#root = figure.figure;
    this.#doc = this.#root.ownerDocument;
    this.#plot = figure.plot;
    registerFigure(this.#doc, this.#root);
  }

  #win(): Window | null { return this.#doc.defaultView; }

  #activeElement(): Element | null { return activeElementOf(this.#doc, this.#root); }

  #getTooltip(): TooltipView {
    return this.#tooltip ??= createTooltip(this.#figure.tooltip, this.#figure.readout, this.#root, this.#restorePlotFocus.bind(this));
  }

  #clearGeo() { this.#geoPlot = this.#geoFigure = this.#geoVisible = this.#geoReadout = this.#geoControls = this.#geoPlacement = null; }

  #mode(): Mode { return this.#single ? 'single' : 'all'; }

  #focusFigure() { return focusContainer(this.#root); }

  #restorePlotFocus(verify?: boolean): void {
    const proxy = this.#proxy;
    if (proxy && !proxy.hidden) {
      focusQuiet(proxy);
      if (!verify || (this.#proxy && !this.#proxy.hidden && this.#activeElement() === this.#proxy)) return;
    }
    this.#focusFigure();
  }

  #pointerTarget(): PickTarget | null { return 't' in this.#shown ? this.#shown.t : null; }

  #idle(): Shown { return this.#proxyFocused && !this.#fromClick ? KEY : NONE; }

  #draw(d: Committed, o: Overlay | null) {
    if (!o && !this.#overlayVisible) return;
    this.#overlayVisible = o !== null;
    this.#renderer.drawOverlay(o, d.bindings, d.theme, d.pixelRatio);
  }

  #listenDocument(): void {
    if (this.#docListeners || !this.#attached || !this.#proxy) return;
    const l = this.#docListeners = new Listeners(), w = this.#win();
    const clearRects = this.#clearControlRects.bind(this);
    l.on(w, 'keydown', this.#onEscape.bind(this), true);
    l.on(this.#doc, 'scroll', this.#onScroll.bind(this), SCROLL_OPTIONS);
    l.on(w, 'resize', this.#clearGeo.bind(this), { passive: true });
    l.on(w, 'blur', this.#cancelGestures.bind(this));
    l.on(this.#root, 'focusin', clearRects);
    l.on(this.#root, 'focusout', clearRects);
  }

  #listenShadowScroll(): void {
    if (this.#shadowScrollListeners || !this.#attached || !this.#proxy) return;
    const shadow = shadowRootOf(this.#root);
    if (!shadow) return;
    // Scroll events inside a shadow tree do not reach the document listener.
    const l = this.#shadowScrollListeners = new Listeners();
    const scroll = this.#onScroll.bind(this);
    for (let current: ShadowRoot | null = shadow; current; current = shadowRootOf(current.host)) {
      l.on(current, 'scroll', scroll, SCROLL_OPTIONS);
    }
  }

  #clearControlRects(): void { this.#geoControls = null; }

  #startInteraction(): void {
    if (this.#interacted) return;
    this.#interacted = true;
    this.#clearGeo();
    this.#listenDocument();
  }

  #unlistenAttached(): void {
    this.#docListeners?.clear();
    this.#shadowScrollListeners?.clear();
    this.#docListeners = this.#shadowScrollListeners = null;
  }

  #unlistenPin() { this.#pinListeners?.clear(); this.#pinListeners = null; }

  #listenPin(): void {
    if (this.#pinListeners || !this.#attached) return;
    const l = this.#pinListeners = new Listeners();
    listenOutside(this.#doc, shadowRootsOf(this.#root), 'pointerdown', [this.#plot, this.#figure.tooltip, this.#figure.readout], this.#dismissPin.bind(this), l);
  }

  #onStartup(event: Event): void {
    if (event.type === 'focus') this.#onProxyFocus();
    else if (event.type === 'pointerdown') this.#onPointerDown(event as PointerEvent);
    else this.#onProxyInput();
  }

  #bindStartup(method: 'addEventListener' | 'removeEventListener'): void {
    const proxy = this.#proxy!, listener = this.#startupListener!;
    proxy[method]('focus', listener);
    proxy[method]('input', listener);
    proxy[method]('change', listener);
    this.#plot[method]('pointerdown', listener);
    this.#listenStage![method]('pointermove', this.#pointerMoveListener!);
  }

  #build(): void {
    if (this.#proxy) return;
    const proxy = this.#proxy = make(this.#doc, 'input', 'axylo-proxy');
    proxy.type = 'range'; proxy.id = `${this.#figure.id}-proxy`; proxy.min = '0'; proxy.step = '1';
    this.#ring = make(this.#doc, 'div', 'axylo-focus-ring');
    hideFromAT(this.#ring);
    this.#instructions = make(this.#doc, 'span', 'axylo-visually-hidden');
    this.#instructions.id = `${this.#figure.id}-i`;
    this.#plot.append(proxy, this.#ring, this.#instructions);
    // Untouched charts need only the fixed listeners that bootstrap the lazy groups.
    this.#listenStage = this.#figure.stage;
    this.#startupListener = this.#onStartup.bind(this);
    this.#pointerMoveListener = this.#onPointerMove.bind(this);
    this.#bindStartup('addEventListener');
    this.#listenShadowScroll();
  }

  #stopPinch(apply = false): void {
    this.#pinch = null;
    if (this.#pinchFrame) { this.#win()?.cancelAnimationFrame(this.#pinchFrame); this.#pinchFrame = 0; }
    const w = this.#pinchWindow; this.#pinchWindow = undefined;
    if (apply && w !== undefined) this.#requestZoom(w);
  }

  #cancelGestures(): void { this.#endDrag(); this.#touches?.clear(); this.#pinched = false; this.#stopPinch(); }

  #focusOwned() { const a = this.#activeElement(); return isElement(a) && a !== this.#root && this.#root.contains(a); }

  #unbuild(ownedBefore = false): void {
    if (!this.#proxy) return;
    const owned = ownedBefore || this.#focusOwned();
    this.#cancelGestures(); this.#closeTable(false); this.#unlistenAttached();
    this.#built?.clear(); this.#built = null;
    this.#bindStartup('removeEventListener');
    this.#listenStage = this.#startupListener = this.#pointerMoveListener = null;
    this.#interacted = false;
    this.#listenerFlags = 0;
    for (const n of [this.#proxy, this.#instructions, this.#ring, this.#selection]) n?.remove();
    this.#removeLegend(); this.#toolbar?.destroy();
    this.#proxy = this.#instructions = this.#ring = this.#selection = this.#legendList = this.#legendMarked = this.#proxyRect = this.#toolbar = this.#lastControls = this.#controlNodes = null;
    this.#proxyUsable = this.#proxyInstructionState = this.#idleProxyState = this.#zoomCheckView = this.#zoomCheckWindow = null;
    this.#proxyInstructionLang = this.#plotInstructionLang = this.#seriesInstructionLang = this.#donutInstructionLang = this.#zoomInstructionLang = null;
    this.#idlePosition = this.#idleMax = this.#idleEmpty = '';
    this.#proxyLang = this.#idleCount = this.#countFormatter = this.#positionTemplate = undefined;
    this.#clearGeo(); this.#figure.clearControls();
    this.#plot.classList.remove('axylo-touch-zoom', 'axylo-zoomable');
    const after = this.#activeElement();
    if (owned && (!after || after === this.#doc.body || !this.#root.contains(after))) this.#focusFigure();
  }

  #resolveAligned(d: Committed, target: PickTarget, primary?: DatumRef): DatumRef | null {
    if (this.#single && this.#focus?.kind === 'aligned' && target.kind === 'x') {
      const ref = d.lookup.resolve({ kind: 'aligned', seriesKey: this.#focus.seriesKey, x: target.x });
      if (ref) return ref;
    }
    return primary ?? d.lookup.primary(target);
  }

  #takeover(d: Committed): void {
    const t = this.#pointerTarget();
    if (!t) { this.#focus ??= firstDatum(d); return; }
    if (this.#shown.k === S_PIN) this.#focus = this.#shown.r;
    else if (this.#single && this.#focus?.kind === 'aligned' && t.kind === 'x') this.#focus = this.#resolveAligned(d, t);
    else this.#focus = d.lookup.primary(t) ?? this.#focus ?? firstDatum(d);
  }

  #shownTarget(): PickTarget | null { return this.#shown.k === S_KEY ? (this.#proxyFocused && this.#focus && this.#committed ? keyboardTarget(this.#committed, this.#focus) : null) : this.#pointerTarget(); }

  #swatchFor(row: DatumText): SwatchSpec {
    const { view } = this.#committed!, i = row.seriesIndex;
    const swatches = this.#swatches ??= [];
    return swatches[i] ??= view.kind === 'donut'
      ? { color: view.slices[i]?.colorIndex ?? null, cue: null, line: false, hollow: false }
      : this.#parts.swatch(i, view.cues[i] ?? null, false);
  }

  #plotMapping() { return this.#geoPlot ??= mappingOf(this.#plot); }

  #figureMapping() { return this.#geoFigure ??= mappingOf(this.#root); }

  #visiblePlot() { return this.#geoVisible ??= visibleRegion(this.#plot, true, this.#figure.tooltip); }

  #visibleReadout() { return this.#geoReadout ??= visibleRegion(this.#figure.readout, false); }

  #controlRects(m: Mapping): readonly Rect[] {
    if (this.#geoControls) return this.#geoControls;
    const out: Rect[] = [], w = this.#win();
    this.#controlNodes ??= Array.from(this.#root.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex],.axylo-legend-list>li'))
      .filter(el => el !== this.#proxy && el !== this.#root && !this.#figure.tooltip.contains(el) && !this.#figure.readout.contains(el));
    for (const el of this.#controlNodes) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const st = w?.getComputedStyle?.(el);
      const painted = st && st.outlineStyle !== 'none' ? (parseFloat(st.outlineWidth) || 0) + Math.max(0, parseFloat(st.outlineOffset) || 0) : 0;
      const reach = Math.max(FOCUS_OUTLINE, painted);
      out.push(padRect(r.left, r.top, r.width, r.height, reach * m.kx, reach * m.ky));
    }
    return this.#geoControls = out;
  }

  #pick(d: Committed, at: Point): PickTarget | null {
    if (d.layout.kind !== 'plot') return null;
    const m = this.#plotMapping(), b = d.layout.plot;
    return d.lookup.pick(plotCoordinate(at.x, m.left, m.kx, b.x, b.width), plotCoordinate(at.y, m.top, m.ky, b.y, b.height));
  }

  #anchorOf(d: Committed, t: PickTarget) { const b = markBox(d, t); return b ? rectToViewport(this.#plotMapping(), b) : null; }

  #clock() { return this.#win()?.performance.now() ?? 0; }

  #hideTooltip() { this.#tooltip?.hide(); releaseShowing(this.#doc, this.#root); }

  #dropView(hide = true) { if (hide) { this.#unlistenPin(); this.#hideTooltip(); } this.#content = this.#lastPres = null; }

  #redraw(rec: 0 | 1 | 2 = 0) { this.#dirty = true; this.#present(rec); }

  #present(rec: 0 | 1 | 2 = 0): void {
    const d = this.#committed;
    if (!plotReady(d) || !this.#proxy || (this.#shown.k === S_NONE && !this.#proxyFocused)) {
      if (d) this.#draw(d, null);
      this.#dropView();
      this.#hover(null); return;
    }
    const { view, layout, lookup } = d;
    const target = this.#shownTarget(), visibleRing = this.#proxyFocused && (this.#keyed || this.#proxy.matches(':focus-visible')) ? this.#focus : null;
    const only = this.#single && this.#shown.k === S_KEY ? this.#focus : null, pres = presentationFor(d), pinned = this.#shown.k === S_PIN;
    const showTip = pres !== 'none' && target !== null && !this.#isDismissed(target), page = pinned ? this.#pinPage : 0;
    const flags = (showTip ? 1 : 0) | (pinned ? 2 : 0) | (pres === 'strip' ? 4 : pres === 'floating' ? 8 : 0);
    const last = this.#lastPres;
    if (!this.#dirty && last && sameTarget(target, last[0]) && sameRef(visibleRing, last[1]) &&
      sameRef(only, last[2]) && flags === last[3] && page === last[4]) return;
    if (!last) this.#lastPres = [target, visibleRing, only, flags, page];
    else { last[0] = target; last[1] = visibleRing; last[2] = only; last[3] = flags; last[4] = page; }
    this.#dirty = false;
    if (pinned) this.#listenPin(); else this.#unlistenPin();
    const prev = this.#content; this.#content = null;
    if (pinned && !showTip) { this.#dismissPin(); return; }
    const readHover = showTip && this.#shown.k === S_HOVER && pres === 'floating' && target.kind === 'x'
      ? (lookup as AlignedHoverLookup).alignedHover : undefined;
    let model: TooltipModel | null;
    if (readHover && target?.kind === 'x') {
      model = this.#hoverModel = readHover.call(lookup, target, this.#hoverModel);
    } else {
      model = showTip ? (pinned ? pinnedModel(d, target, this.#pinPage) : lookup.tooltip(target)) : null;
    }
    const soleRef = target?.kind === 'x' && model?.count === 1 ? model.rows[0]?.ref : undefined;
    const input = this.#overlayInput ??= { view, layout, lookup, target, ring: visibleRing, only };
    input.target = target; input.ring = visibleRing; input.only = only;
    let overlay: Overlay | null;
    if (readHover && soleRef && !visibleRing && layout.kind === 'plot' && layout.projection.kind === 'xy' &&
        this.#parts.overlay === alignedTargetMarks) {
      // Reuse the tooltip's ref for the cursor and hover event. The renderer still gets a snapshot.
      const clipped: Mark[] = [];
      input.only = soleRef;
      alignedTargetMarks(input, layout.plot, clipped, NO_UNCLIPPED_MARKS);
      overlay = clipped.length ? { clip: layout.plot, clipped, unclipped: NO_UNCLIPPED_MARKS } : null;
    } else {
      overlay = overlayWith(this.#parts.overlay, input);
    }
    if (model?.rows.length && target && pres !== 'none') {
      const tc = this.#tooltipContent ??= {
        model, swatch: this.#swatchFor.bind(this),
        moreRows: n => fill(this.#committed!.messages.moreRows, { count: this.#committed!.formatters.count(n) }),
        valueLang: t => missingLang(this.#committed!, t) ?? null,
        select: row => this.#actions.select(row.ref),
        more: n => {
          if (this.#shown.k !== S_PIN) return;
          const next = this.#pinPage + Math.max(1, n);
          this.#pinPage = next >= this.#tooltipContent!.model.count ? 0 : next;
          this.#redraw();
        },
      };
      tc.model = model;
      if (model.total !== null) {
        tc.totalLabel = d.messages.total;
        tc.totalLang = d.english('total');
      }
      if (model.count > 1) tc.moreLang = d.english('moreRows');
      const marks = markBox(d, target, soleRef), map = this.#plotMapping(), anchor = marks ? rectToViewport(map, marks) : null;
      const bounds = pres === 'strip' ? this.#visibleReadout() : this.#placementFor(d, marks, visibleRing, map);
      const figureMap = pres === 'strip' ? undefined : this.#figureMapping();
      // When the tooltip needs a layout read, measure after both sets of writes.
      this.#draw(d, overlay);
      const tip = this.#getTooltip();
      const placed = 'box' in bounds ? tip.show(tc, bounds, pinned, figureMap) : tip.strip(tc, pinned, bounds);
      const rect = placed ? tip.rect() : null;
      if (rect) {
        noteShowing(this.#doc, this.#root, rec === 2 || (rec === 0 && (!prev || !sameTarget(prev.t, target) || prev.pin !== pinned || prev.pg !== page)));
        this.#content = { t: target, b: rect, a: anchor, p: pres, pin: pinned, pg: page };
      } else releaseShowing(this.#doc, this.#root);
    } else {
      this.#hideTooltip();
      this.#draw(d, overlay);
    }
    if (pinned && !this.#content) { this.#dismissPin(); return; }
    this.#hover(!target ? null : this.#shown.k === S_KEY ? this.#focus : this.#shown.k === S_PIN ? this.#shown.r : soleRef ?? lookup.primary(target));
  }

  #placementFor(d: Committed, box: Rect | null, keyboardRing: DatumRef | null, m: Mapping): PlacementInput {
    const { layout, lookup } = d, area = plotBox(d);
    // The padded datum box in viewport pixels, as rectToViewport(m, padRect(...)) computes it, in one object.
    const bx = box ? box.x : area.x + area.width / 2, by = box ? box.y : area.y + area.height / 2;
    const controls = this.#controlRects(m);
    const rb = keyboardRing ? ringRect(layout, lookup, keyboardRing) : null;
    const rings = rb ? [rectToViewport(m, rb)] : NO_RINGS;
    const x = m.left + (bx - RING_REACH) * m.kx, y = m.top + (by - RING_REACH) * m.ky;
    const width = Math.max(0, (box ? box.width : 0) + 2 * RING_REACH) * m.kx;
    const height = Math.max(0, (box ? box.height : 0) + 2 * RING_REACH) * m.ky;
    if (!this.#geoPlacement) {
      const pr = padRect(area.x, area.y, area.width, area.height, -OUTLINE_REACH);
      let hole: PlacementInput['hole'] = null;
      if (layout.kind === 'plot' && layout.projection.kind === 'ring' && layout.projection.r0 > HOLE_CLEARANCE) {
        const { cx, cy, r0 } = layout.projection, ctr = toViewport(m, { x: cx, y: cy });
        hole = { cx: ctr.x, cy: ctr.y, rx: (r0 - HOLE_CLEARANCE) * m.kx, ry: (r0 - HOLE_CLEARANCE) * m.ky };
      }
      return this.#geoPlacement = {
        box: { x, y, width, height }, visible: intersect(rectToViewport(m, pr), this.#visiblePlot()),
        order: horizontalBars(d) ? 'horizontal' : 'vertical', hole, controls, rings, ringStroke: RING_STROKE * Math.max(m.kx, m.ky),
      };
    }
    const datumBox = this.#geoPlacement.box;
    datumBox.x = x; datumBox.y = y; datumBox.width = width; datumBox.height = height;
    this.#geoPlacement.controls = controls; this.#geoPlacement.rings = rings;
    return this.#geoPlacement;
  }

  #hover(ref: DatumRef | null): void { if (!sameRef(ref, this.#lastHover)) { this.#lastHover = ref; this.#actions.hover(ref); } }

  #markLegend(sliceKey: string | null): void {
    if (this.#legendMarked) {
      if (this.#legendMarked.dataset.key === sliceKey && this.#legendMarked.parentNode === this.#legendList) return;
      this.#legendMarked.classList.remove('axylo-legend-current');
      this.#legendMarked = this.#geoControls = null;
    }
    if (sliceKey !== null && this.#legendList) {
      for (const child of this.#legendList.children) {
        const li = child as HTMLElement;
        if (li.dataset.key !== sliceKey) continue;
        li.classList.add('axylo-legend-current');
        this.#legendMarked = li; this.#geoControls = null;
        break;
      }
    }
  }

  #markFocusedSlice(d: Committed | null): void {
    this.#markLegend(plotReady(d) && this.#proxyFocused && this.#focus?.kind === 'slice' ? this.#focus.sliceKey : null);
  }

  #prepareIdleAligned(d: Committed): void {
    const { lookup, messages, formatters } = d;
    const count = lookup.count;
    if (this.#idleCount !== count || this.#countFormatter !== formatters.count || this.#positionTemplate !== messages.position) {
      this.#idleCount = count; this.#countFormatter = formatters.count; this.#positionTemplate = messages.position;
      this.#idlePosition = positionText(messages, formatters, 0, count);
      this.#idleMax = String(count - 1);
    }
  }

  #writeProxy(acted: boolean, readyData?: boolean): void {
    const d = this.#committed;
    if (!this.#proxy || !d) return;
    const { view, lookup, formatters, messages } = d;
    if (view.kind === 'donut' || this.#legendMarked) this.#markFocusedSlice(d);
    const hasData = readyData ?? (plotReady(d) && readable(d)), lang = readingLangFor(d, hasData, this.#single);
    const empty = hasData ? messages.noData : recoverable(d) || plotReady(d) ? messages.empty : d.message ?? messages.noData;
    const inactive = !acted && !this.#proxyFocused && !this.#focus;
    if (inactive) {
      const previous = this.#idleProxyState;
      this.#idleProxyState = d;
      if (previous && this.#idleHasData === hasData && (!hasData || (previous.lookup === lookup && previous.view === view)) &&
          previous.formatters === formatters && previous.messages === messages && this.#proxyLang === lang && this.#idleEmpty === empty) return;
      this.#idleHasData = hasData;
      this.#idleEmpty = empty;
    } else this.#idleProxyState = null;
    if (this.#proxyLang !== lang) { setAttr(this.#proxy, 'lang', lang); this.#proxyLang = lang; }
    const idleAligned = inactive && hasData && !this.#single && lookup.count > 0 && (lookup as AlignedHoverLookup).alignedHover && isAligned(view);
    const ref = hasData && !idleAligned ? this.#focus ?? firstDatum(d) : null;
    if (!ref) {
      if (idleAligned) this.#prepareIdleAligned(d);
      setRangeInput(this.#proxy, idleAligned ? this.#idleMax : '0', '0');
      const text = idleAligned ? firstSlotReading(view, formatters, messages, this.#idlePosition) : empty;
      setAttr(this.#proxy, 'aria-valuetext', text);
      this.#shownOrdinal = 0;
      this.#shownText = null;
      return;
    }
    const max = String(Math.max(0, lookup.count - 1)), ord = Math.max(0, lookup.ordinal(ref));
    setRangeInput(this.#proxy, max, String(ord));
    // An unfocused range needs no announcement suppression.
    const reading = inactive ? null : datumReading(view, lookup, ref, this.#mode(), formatters, messages);
    const previous = this.#shownText;
    if (inactive || acted || !previous || !sameRef(ref, previous.r) || this.#single !== previous.s ||
        reading !== previous.d || !this.#proxy.hasAttribute('aria-valuetext')) {
      setAttr(this.#proxy, 'aria-valuetext', valueText(view, lookup, ref, this.#mode(), formatters, messages) ?? messages.noData);
      this.#shownText = inactive ? null : { r: ref, s: this.#single, d: reading };
    }
    this.#shownOrdinal = ord;
  }

  #stepFrom(d: Committed, from: DatumRef, dir: StepDirection): DatumRef | null {
    if (!this.#single && from.kind === 'aligned' && isAligned(d.view)) {
      const x = stepAcross(d.view, from.x, dir);
      return x === null ? null : d.lookup.primary({ kind: 'x', x });
    }
    if (this.#single && from.kind === 'point' && d.view.kind === 'scatter' && this.#parts.stepInSeries) return this.#parts.stepInSeries(d.view, from, dir);
    return d.lookup.step(from, dir);
  }

  #keyboardLeads(d: Committed): void { this.#shown = KEY; this.#pinPage = 0; this.#rest = null; if (this.#focus) this.#reached(keyboardTarget(d, this.#focus)); }

  #presentKeyboard(d: Committed, acted: boolean): void {
    this.#keyboardLeads(d);
    this.#writeProxy(acted);
    this.#present();
  }

  #move(d: Committed, dir: StepDirection): void {
    this.#takeover(d);
    const from = this.#focus;
    const series = dir === 'series-next' || dir === 'series-previous';
    if (series) {
      if (!from) return;
      if (from.kind === 'aligned' && isAligned(d.view) && !this.#single) {
        const refs = refsAt(d.view, from.x), ref = dir === 'series-next' ? refs[0] : refs.at(-1);
        if (ref) { this.#focus = ref; this.#single = true; }
      } else if (from.kind === 'point' || (from.kind === 'aligned' && isAligned(d.view))) {
        this.#focus = d.lookup.step(from, dir) ?? from;
        if (from.kind === 'point') this.#single = true;
      }
    } else if (from) this.#focus = this.#stepFrom(d, from, dir) ?? from;
    const moved = series || !sameRef(from, this.#focus);
    if (moved || this.#shown.k !== S_PIN) this.#presentKeyboard(d, moved);
  }

  #atOrdinal(d: Committed, ord: number): DatumRef | null {
    const { view, lookup } = d;
    if (isAligned(view)) {
      const { start, end } = view.visibleSlots, x = view.frame.x.values[start + clamp(ord, 0, Math.max(0, end - start - 1))];
      if (x === undefined) return null;
      return this.#single && this.#focus?.kind === 'aligned' ? lookup.resolve({ kind: 'aligned', seriesKey: this.#focus.seriesKey, x }) : lookup.primary({ kind: 'x', x });
    }
    let ref = lookup.step(null, 'first');
    for (let i = 0; ref && i < ord && i < lookup.count; i++) { const next = lookup.step(ref, 'next'); if (!next) break; ref = next; }
    if (ref && this.#single && this.#focus && 'seriesKey' in this.#focus && 'seriesKey' in ref && ref.seriesKey !== this.#focus.seriesKey) this.#single = false;
    return ref;
  }

  #onProxyKey(e: KeyboardEvent): void {
    const d = this.#committed;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const { key } = e, rec = recoverable(d);
    if (!rec && !plotReady(d)) return;
    if (!rec) this.#fromClick = false;
    if (d!.zoom) {
      const action = !rec && (key === '+' || key === '=') ? 'zoomIn'
        : key === '-' || key === '_' ? 'zoomOut' : key === '0' ? 'resetZoom' : null;
      if (action) { consumeKey(e); this.activateControl(action); return; }
    }
    if (e.shiftKey && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      if (rec) consumeKey(e); else e.preventDefault();
      if (d!.zoom) this.#pan(key === 'ArrowRight' ? PAN_SHARE : -PAN_SHARE);
      return;
    }
    const upDown = key === 'ArrowUp' || key === 'ArrowDown';
    if (rec || !readable(d!)) { if (key in NAVIGATION || upDown || (!rec && (key === 'Enter' || key === ' '))) e.preventDefault(); return; }
    const ready = d as Committed & { readonly ready: true };
    if (key === 'Enter' || key === ' ') { e.preventDefault(); this.#focus ??= firstDatum(ready); if (this.#focus) this.#actions.select(this.#focus); return; }
    if (key === 'Escape') {
      if (this.#single) {
        consumeKey(e); this.#single = false;
        if (this.#focus?.kind === 'aligned') this.#focus = ready.lookup.primary({ kind: 'x', x: this.#focus.x }) ?? this.#focus;
        this.#writeProxy(true); this.#present();
      }
      return;
    }
    const dir = upDown
      ? ready.view.kind === 'donut' ? (key === 'ArrowUp' ? 'next' : 'previous') : (key === 'ArrowDown' ? 'series-next' : 'series-previous')
      : NAVIGATION[key];
    if (dir) { e.preventDefault(); this.#move(ready, dir); }
  }

  #onProxyInput(): void {
    this.#startInteraction();
    const d = this.#committed;
    if (!this.#proxy || !plotReady(d)) return;
    if (!readable(d)) { this.#writeProxy(false); return; }
    const ord = Number(this.#proxy.value);
    if (!Number.isFinite(ord) || ord === this.#shownOrdinal) return;
    this.#takeover(d);
    this.#focus = this.#atOrdinal(d, ord) ?? this.#focus;
    this.#presentKeyboard(d, true);
  }

  #onProxyFocus(): void {
    this.#startInteraction();
    if (!(this.#listenerFlags & FOCUS_LISTENERS) && this.#proxy) {
      this.#listenerFlags |= FOCUS_LISTENERS;
      const l = this.#built ??= new Listeners();
      l.on(this.#proxy, 'keydown', ev => { this.#onProxyKey(ev); if (ev.defaultPrevented && !this.#keyed) this.#setKeyed(true); });
      l.on(this.#proxy, 'blur', this.#onProxyBlur.bind(this));
      l.on(this.#plot, 'wheel', this.#onWheel.bind(this), { passive: false });
    }
    const d = this.#committed; this.#proxyFocused = true;
    if (!plotReady(d)) { this.#writeProxy(true); return; }
    this.#fromClick = this.#clickFocus; this.#takeover(d);
    if (!this.#clickFocus) this.#keyboardLeads(d);
    this.#writeProxy(true); this.#redraw();
  }

  #setKeyed(on: boolean) { this.#keyed = on; this.#proxy?.classList.toggle('axylo-keyed', on); this.#redraw(); }

  #onProxyBlur(): void {
    this.#proxyFocused = this.#fromClick = this.#keyed = false;
    this.#proxy?.classList.remove('axylo-keyed');
    this.#markLegend(null);
    if (this.#shown.k === S_KEY) {
      if (this.#pointer && this.#committed) this.#showHover(this.#underPointer());
      else this.#shown = NONE;
    }
    this.#redraw(1);
  }

  #currentWindow(d: Committed): Span | null { return d.view.kind === 'donut' ? null : this.#pendingWindow !== undefined ? (this.#pendingWindow ?? zoomBounds(d)) : d.zoomed ? d.view.xDomain : zoomBounds(d); }

  #requestZoom(w: Span | null): void {
    const d = this.#committed;
    if (!d || d.view.kind === 'donut') return;
    if (sameWindow(this.#pendingWindow !== undefined ? this.#pendingWindow : d.zoomed ? d.view.xDomain : null, w)) return;
    this.#pendingWindow = w; this.#actions.zoom(w);
  }

  #zoomBy(factor: number, center?: number): boolean {
    const d = this.#committed;
    if (!d || d.view.kind === 'donut' || !d.zoom) return false;
    const now = this.#currentWindow(d)!, x = this.#focus?.kind === 'aligned' || this.#focus?.kind === 'point' ? this.#focus.x : NaN;
    const next = zoomStep(zoomBounds(d), now, factor, center ?? (Number.isFinite(x) && x >= now[0] && x <= now[1] ? x : (now[0] + now[1]) / 2), minimumWidth(d.view));
    if (next === undefined) return false;
    this.#requestZoom(next); return true;
  }

  #pan(share: number): void {
    const d = this.#committed;
    if (!d || d.view.kind === 'donut' || !d.zoom) return;
    const next = panWindow(zoomBounds(d), this.#currentWindow(d)!, share);
    if (next) this.#requestZoom(next);
  }

  #onWheel(e: WheelEvent): void {
    const d = this.#committed;
    if (!plotReady(d) || !d.zoom || !this.#proxy || this.#activeElement() !== this.#proxy || e.ctrlKey || e.metaKey || !e.deltaY) return;
    const p = this.#local(e), unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    if (this.#zoomBy(clamp(Math.exp(e.deltaY * unit * 0.002), 0.25, 4), positionAt(d.layout, p.x, p.y) ?? undefined)) e.preventDefault();
  }

  #local(e: MouseEvent) { return toLocal(this.#plotMapping(), clientPoint(e)); }

  #dismissedBy(id: Identity, t: PickTarget) { return matchesIdentity(id, t) || (id.kind === 'point' && t.kind === 'point' && this.#committed !== null && this.#committed.lookup.has(t, id.ref)); }

  #isDismissed(t: PickTarget) { return this.#dismissed !== null && this.#dismissed.some(id => this.#dismissedBy(id, t)); }

  #reached(t: PickTarget | null): void { if (t && this.#dismissed) { const kept = this.#dismissed.filter(id => this.#dismissedBy(id, t)); this.#dismissed = kept.length ? kept : null; } }

  #underPointer(): PickTarget | null {
    return this.#pointer && plotReady(this.#committed) ? this.#pick(this.#committed, this.#pointer) : null;
  }

  #showHover(t: PickTarget | null): void {
    const state = this.#hoverState ??= { k: S_HOVER, t };
    state.t = t;
    this.#shown = state;
  }

  #pointTo(t: PickTarget | null): PickTarget | null {
    this.#reached(t);
    this.#showHover(t);
    return t;
  }

  #pointerAt(x: number, y: number, time: number): void {
    const d = this.#committed;
    if (!plotReady(d)) return;
    const at = this.#pointer ??= { x, y };
    at.x = x; at.y = y;
    let shown = this.#shown;
    if (shown.k === S_PIN) return;
    const rest = this.#rest, content = this.#content;
    const still = rest !== null && dist(x, y, rest.x, rest.y) <= REST_DISTANCE;
    if (shown.k === S_HOVER && shown.t && rest?.g && time - rest.t >= REST_TIME &&
        sameTarget(rest.g, shown.t) && content && sameTarget(content.t, shown.t)) {
      shown = this.#shown = { k: S_HELD, t: shown.t, f: { x: rest.x, y: rest.y }, b: content.b, a: content.a, p: content.p };
    }
    if (shown.k === S_HELD) {
      if (insideCorridor(shown.f, shown.b, at)) { if (!still) this.#rest = { x, y, t: time, g: shown.t }; this.#present(); return; }
      this.#shown = NO_HOVER;
    }
    const target = this.#pick(d, at);
    this.#pointTo(target);
    const latest = this.#rest;
    if (!latest) this.#rest = { x, y, t: time, g: target };
    else if (!still || !sameTarget(latest.g, target)) { latest.x = x; latest.y = y; latest.t = time; latest.g = target; }
    this.#present();
  }

  #onPointerMove(event: Event): void {
    const e = event as PointerEvent;
    this.#startInteraction();
    if (!(this.#listenerFlags & MOVE_LISTENERS) && this.#proxy) {
      this.#listenerFlags |= MOVE_LISTENERS;
      (this.#built ??= new Listeners()).on(this.#figure.stage, 'pointerleave', this.#onStageLeave.bind(this));
    }
    if (e.pointerType === 'touch') {
      const t = this.#touches?.get(e.pointerId);
      if (t) { const at = this.#local(e); t.x = at.x; t.y = at.y; if (this.#pinch?.ids.includes(e.pointerId)) this.#pinchMove(); }
      return;
    }
    if ((this.#down && this.#down.id !== e.pointerId) || this.#tableView) return;
    if (this.#down) {
      const at = this.#local(e);
      if (!this.#down.d && this.#committed?.zoom && dist(at.x, at.y, this.#down.x, this.#down.y) > DRAG_THRESHOLD) {
        this.#down.d = true;
        if (this.#shown.k === S_PIN) { this.#shown = NO_HOVER; this.#pinPage = 0; }
        this.#dropView();
      }
      if (this.#down.d) { this.#drawSelection(this.#down, at); return; }
    }
    this.#pointerAt(e.clientX, e.clientY, e.timeStamp);
  }

  #leave(): void { this.#pointer = this.#rest = null; if (this.#shown.k === S_HOVER || this.#shown.k === S_HELD) this.#shown = this.#idle(); this.#present(); }

  #onStageLeave(e: PointerEvent): void { if (e.pointerType !== 'touch' && !this.#down?.d) { this.#clearGeo(); this.#leave(); } }

  #drawSelection(from: Point, to: Point): void {
    const d = this.#committed;
    if (d?.layout.kind !== 'plot') return;
    if (!this.#selection) { this.#selection = make(this.#doc, 'div', 'axylo-selection'); hideFromAT(this.#selection); this.#plot.appendChild(this.#selection); }
    const p = d.layout.plot, horizontal = horizontalBars(d);
    const [x, width] = horizontal ? [p.x, p.width] : selectionSpan(from.x, to.x, p.x, p.width);
    const [y, height] = horizontal ? selectionSpan(from.y, to.y, p.y, p.height) : [p.y, p.height];
    this.#selection.style.cssText = boxStyle({ x, y, width, height });
    this.#selection.hidden = false;
  }

  #markRange(d: Committed): void {
    const px = this.#range?.s == null ? null : pixelOf(d.layout, this.#range.s);
    if (px === null) { this.#hideRange(); return; }
    const at = horizontalBars(d) ? { x: 0, y: px } : { x: px, y: 0 };
    this.#drawSelection({ x: at.x - 1, y: at.y - 1 }, { x: at.x + 1, y: at.y + 1 });
  }

  #hideRange(): void {
    if (this.#selection && !this.#down?.d) this.#selection.hidden = true;
  }

  #endRange(): void {
    if (!this.#range) return;
    this.#range = null;
    this.#hideRange();
    this.#refreshControls();
  }

  #endDrag(): void {
    if (this.#selection) this.#selection.hidden = true;
    if (this.#range && this.#committed) this.#markRange(this.#committed);
    const was = this.#down; this.#down = null;
    if (was && this.#plot.hasPointerCapture?.(was.id)) { try { this.#plot.releasePointerCapture(was.id); } catch { /* released */ } }
  }

  #applyRange(d: Committed, a: number, b: number): void {
    const next = rangeWindow(zoomBounds(d), a, b, minimumWidth(d.view));
    this.#endRange();
    if (next !== undefined) this.#requestZoom(next);
  }

  #endTouch(id: number, apply: boolean): boolean {
    this.#touches?.delete(id);
    if (this.#pinch?.ids.includes(id)) this.#stopPinch(apply);
    const wasPinch = this.#pinched;
    if (!this.#touches?.size) this.#pinched = false;
    return wasPinch;
  }

  #onPointerDown(e: PointerEvent): void {
    this.#startInteraction();
    if (!(this.#listenerFlags & DOWN_LISTENERS) && this.#proxy) {
      this.#listenerFlags |= DOWN_LISTENERS;
      const l = this.#built ??= new Listeners();
      const end = this.#onPointerEnd.bind(this);
      l.on(this.#plot, 'pointerup', end);
      l.on(this.#plot, 'pointercancel', end);
      l.on(this.#plot, 'lostpointercapture', ev => { if (this.#down?.id === ev.pointerId) this.#endDrag(); });
    }
    const d = this.#committed;
    if (!plotReady(d)) return;
    if (this.#keyed) this.#setKeyed(false);
    const at = this.#local(e);
    if (e.pointerType === 'touch') {
      const map = this.#touches ??= new Map();
      map.set(e.pointerId, { x: at.x, y: at.y, x0: at.x, y0: at.y, t0: e.timeStamp });
      if (map.size === 2 && d.zoom === 'touch' && d.view.kind !== 'donut') this.#startPinch(d);
      if (map.size > 1) this.#pinched = true;
      return;
    }
    if (e.button !== 0 || this.#down) return;
    this.#down = { id: e.pointerId, x: at.x, y: at.y, d: false };
    try { this.#plot.setPointerCapture(e.pointerId); } catch { /* gone */ }
  }

  #onPointerEnd(e: PointerEvent): void {
    const d = this.#committed, cancelled = e.type === 'pointercancel';
    if (e.pointerType === 'touch') {
      const t = this.#touches?.get(e.pointerId);
      if (this.#endTouch(e.pointerId, !cancelled) || cancelled) return;
      const up = this.#local(e);
      if (t && plotReady(d) && dist(up.x, up.y, t.x0, t.y0) < TAP_DISTANCE && e.timeStamp - t.t0 < TAP_TIME) this.#activate(d, clientPoint(e), false);
      return;
    }
    const was = this.#down;
    if (was ? was.id !== e.pointerId : !cancelled) return;
    this.#endDrag();
    if (cancelled) { this.#leave(); return; }
    if (!was || !plotReady(d)) return;
    if (was.d) {
      const at = this.#local(e), a = positionAt(d.layout, was.x, was.y), b = positionAt(d.layout, at.x, at.y);
      if (a === null || b === null || d.view.kind === 'donut') return;
      this.#applyRange(d, a, b);
      this.#pointerAt(e.clientX, e.clientY, e.timeStamp);
      return;
    }
    this.#activate(d, clientPoint(e), true);
  }

  #activate(d: Committed & { readonly ready: true }, at: Point, mouse: boolean): void {
    if (this.#range && d.view.kind !== 'donut' && d.layout.kind === 'plot') {
      const m = this.#plotMapping(), pr = d.layout.plot;
      const p = { x: plotCoordinate(at.x, m.left, m.kx, pr.x, pr.width), y: plotCoordinate(at.y, m.top, m.ky, pr.y, pr.height) };
      const x = positionAt(d.layout, p.x, p.y);
      if (x === null || p.x < pr.x || p.x > pr.x + pr.width || p.y < pr.y || p.y > pr.y + pr.height) return;
      if (this.#range.s === null) { this.#range.s = x; this.#markRange(d); return; }
      this.#applyRange(d, this.#range.s, x); return;
    }
    const target = this.#pick(d, at);
    this.#pointer = mouse ? at : null; this.#rest = null; this.#pinPage = 0;
    if (!target) { this.#shown = mouse ? NO_HOVER : this.#idle(); this.#redraw(); return; }
    const primary = d.lookup.primary(target);
    const ref = primary && this.#resolveAligned(d, target, primary);
    // A touch screen has no Escape key and a full-width chart no outside to tap: tapping the pinned datum again unpins it.
    if (!mouse && ref && this.#shown.k === S_PIN && sameRef(ref, this.#shown.r)) { this.#dismissPin(); return; }
    this.#dismissed = null;
    if (ref && presentationFor(d) !== 'none') {
      this.#shown = { k: S_PIN, r: ref, t: target };
      this.#listenPin();
    } else this.#showHover(target);
    if (mouse && this.#proxy) { this.#clickFocus = true; try { focusQuiet(this.#proxy); } finally { this.#clickFocus = false; } }
    if (ref) { this.#focus = ref; this.#writeProxy(true); this.#actions.select(ref); }
    this.#redraw(2);
  }

  #dismissPin(): void { this.#endPin(); this.#redraw(); }

  #endPin(): void {
    if (this.#shown.k !== S_PIN) return;
    this.#pinPage = 0;
    if (this.#pointer && plotReady(this.#committed)) this.#showHover(this.#underPointer());
    else this.#shown = this.#idle();
  }

  #startPinch(d: Committed): void {
    if (!this.#touches || d.view.kind === 'donut') return;
    const [[ia, a] = [], [ib, b] = []] = this.#touches;
    if (ia === undefined || ib === undefined || !a || !b) return;
    const w = this.#currentWindow(d)!;
    this.#pinch = { ids: [ia, ib], d: Math.max(1, dist(a.x, a.y, b.x, b.y)), w, c: positionAt(d.layout, (a.x + b.x) / 2, (a.y + b.y) / 2) ?? (w[0] + w[1]) / 2 };
    if (this.#shown.k === S_PIN) { this.#shown = this.#idle(); this.#pinPage = 0; }
    this.#dropView();
    this.#draw(d, null);
  }

  #pinchMove(): void {
    const d = this.#committed, a = this.#pinch && this.#touches?.get(this.#pinch.ids[0]), b = this.#pinch && this.#touches?.get(this.#pinch.ids[1]);
    if (!this.#pinch || !a || !b || !plotReady(d) || d.view.kind === 'donut' || d.layout.kind !== 'plot') return;
    const width = pinchWidth(this.#pinch.w[1] - this.#pinch.w[0], this.#pinch.d / Math.max(1, dist(a.x, a.y, b.x, b.y)), minimumWidth(d.view));
    const p = d.layout.plot, full = zoomBounds(d);
    const share = horizontalBars(d) ? (p.y + p.height - (a.y + b.y) / 2) / p.height : ((a.x + b.x) / 2 - p.x) / p.width;
    const start = clamp(this.#pinch.c - share * width, full[0], full[1] - width);
    this.#pinchWindow = width >= full[1] - full[0] ? null : [start, start + width];
    if (!this.#pinchFrame) this.#pinchFrame = this.#win()!.requestAnimationFrame(() => { this.#pinchFrame = 0; if (this.#pinchWindow !== undefined) this.#requestZoom(this.#pinchWindow); this.#pinchWindow = undefined; });
  }

  #onEscape(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const inChart = focusedFigure(this.#doc, this.#root);
    if (inChart !== this.#root && (inChart !== null || (!isLastShowing(this.#doc, this.#root) && !this.#down?.d))) return;
    if (this.#down?.d) { consumeKey(e, true); this.#endDrag(); return; }
    if (this.#range) { consumeKey(e, true); this.#endRange(); return; }
    const target = this.#shownTarget();
    if (!target || (!this.#tooltip?.visible && this.#shown.k !== S_PIN)) return;
    consumeKey(e, true);
    this.#dismissed = [identityOf(target, this.#shown.k === S_PIN ? this.#shown.r : this.#shown.k === S_KEY ? this.#focus : this.#committed?.lookup.primary(target) ?? null)];
    this.#pinPage = 0;
    if (this.#shown.k === S_HELD) {
      const under = this.#underPointer();
      if (under) this.#dismissed.push(identityOf(under, this.#committed!.lookup.primary(under)));
      this.#showHover(under);
    } else if (this.#shown.k === S_PIN) {
      if (this.#pointer) this.#showHover(target);
      else this.#shown = this.#idle();
    }
    this.#rest = null; this.#redraw();
  }

  #onScroll(): void {
    this.#clearGeo();
    const d = this.#committed;
    if (!plotReady(d)) return;
    if ((this.#shown.k === S_HOVER || this.#shown.k === S_HELD) && this.#pointer) { this.#rest = null; this.#pointTo(this.#pick(d, this.#pointer)); }
    else if (!this.#tooltip?.visible) return;
    this.#redraw();
  }

  #openTable(): void {
    const d = this.#controlsState;
    if (!d?.reader.table || this.#tableView) return;
    this.#tableView = createTableView(this.#doc, this.#figure.id, (raw: string) => resolveJumpTarget(this.#controlsState, raw));
    this.#root.classList.add('axylo-table-open'); this.#plot.inert = true;
    this.#pointer = this.#rest = this.#tableModel = null; this.#pinPage = 0; this.#shown = NONE;
    this.#dropView(); this.#clearGeo(); this.#renderTable(d); this.#tableView.focus();
  }

  #closeTable(restore = true): void {
    if (!this.#tableView) return;
    const inside = this.#tableView.element.contains(this.#activeElement());
    this.#tableView.destroy(); this.#tableView = this.#tableModel = null; this.#clearGeo();
    this.#root.classList.remove('axylo-table-open'); this.#plot.inert = false;
    if (inside && restore && !this.#toolbar?.focus('table')) this.#restorePlotFocus(true);
  }

  #renderTable(d: ControlsState): void {
    const model = d.reader.table;
    if (!this.#tableView || !model) return;
    if (model !== this.#tableModel) {
      this.#tableModel = model;
      const { messages: m, formatters: f } = d, qual = ` (${fill(m.incompleteStack, {})})`, qualLang = d.english('incompleteStack');
      this.#tableView.update(model, {
        previousPage: m.previousPage, nextPage: m.nextPage,
        pageOf: (page, count) => fill(m.pageOf, { page: f.count(page), count: f.count(count) }),
        jump: fill(m.jumpToX, { x: model.headers[0] ?? '' }),
        notFound: t => fill(m.jumpNotFound, { x: t, example: model.row(0)?.[0] ?? '' }),
        notFoundLang: d.english('jumpNotFound'), lang: k => d.english(k),
        cell: t => {
          const l = missingLang(d, t);
          if (l !== undefined) return [{ text: t, lang: l }];
          return qualLang && t.endsWith(qual) ? [{ text: t.slice(0, -qual.length), lang: null }, { text: qual, lang: qualLang }] : [{ text: t, lang: null }];
        },
      }, 0);
    }
    if (this.#tableView.element.parentNode !== this.#figure.stage) this.#figure.stage.appendChild(this.#tableView.element);
  }

  activateControl(action: string): void {
    switch (action) {
      case 'zoomIn': this.#zoomBy(1 / ZOOM_FACTOR); break;
      case 'zoomOut': this.#zoomBy(ZOOM_FACTOR); break;
      case 'panLeft': this.#pan(-0.5); break;
      case 'panRight': this.#pan(0.5); break;
      case 'resetZoom': this.#requestZoom(null); break;
      case 'selectRange':
        if (this.#range) this.#endRange();
        else { this.#startInteraction(); this.#range = { s: null }; this.#refreshControls(); }
        break;
      case 'pause':
      case 'resume': this.#actions.pause(action === 'pause'); break;
      case 'table':
        if (this.#tableView) this.#closeTable(); else this.#openTable();
        this.#refreshControls();
        break;
      default: if (action.startsWith('series:')) this.#actions.toggle(action.slice('series:'.length));
    }
  }

  #removeLegend(): void {
    if (!this.#legendList) return;
    this.#markLegend(null);
    // The list's owner releases its listeners and detaches it.
    this.#parts.sliceList?.(this.#doc, null, this.#actions, this.#legendList);
  }

  #canZoomCloser(view: View, window: Span): boolean {
    if (this.#zoomCheckView !== view || this.#zoomCheckWindow !== window) {
      this.#zoomCheckView = view; this.#zoomCheckWindow = window;
      this.#zoomCheckResult = canZoomIn(view, window);
    }
    return this.#zoomCheckResult;
  }

  #controlInputs(d: ControlsState, out: unknown[]): number {
    const zoomable = canZoom(d) && d.ready;
    const closer = canZoom(d) && d.ready && this.#canZoomCloser(d.view, d.zoomed ? d.view.xDomain : d.view.xFull);
    if (!zoomable) this.#zoomCheckView = this.#zoomCheckWindow = null;
    return collectControlInputs(d, out, this.#tableView !== null, this.#range !== null, closer);
  }

  #renderControls(d: ControlsState, measure = false): boolean {
    this.#controlsState = d;
    // Localized messages may reenter rendering. Borrow the scratch until the comparison completes.
    const inputs = controlScratch ?? [];
    controlScratch = undefined;
    let spare: unknown[] | null = inputs;
    let controls: number;
    try {
      controls = this.#controlInputs(d, inputs);
      if (sameKey(this.#lastControls, inputs)) return false;
      spare = this.#lastControls;
      this.#lastControls = inputs;
    } finally {
      if (spare) {
        spare.length = 0;
        controlScratch ??= spare;
      }
    }
    const before = measure ? this.#figure.controlsSignature() : '';
    this.#controlNodes = null; this.#clearGeo();

    const prevAct = this.#activeElement();
    const inLegend = this.#legendList !== null && this.#legendList.contains(prevAct);
    const sliceKey = inLegend ? (prevAct as HTMLElement).parentElement?.dataset.key ?? null : null;
    const nextList = this.#parts.sliceList?.(this.#doc, d, this.#actions, this.#legendList) ?? null;
    if (!nextList && this.#legendList) this.#removeLegend();
    this.#legendList = nextList;
    if (inLegend && (!this.#legendList || !this.#legendList.contains(this.#activeElement()))) {
      this.#handoffSliceKey = d.ready ? sliceKey : null;
      this.#focusFigure();
    }

    const items = buildControlItems(d, controls, this.#parts.swatch, this.#range !== null, this.#tableView?.element.id ?? null);
    const inToolbar = this.#toolbar?.element.contains(this.#activeElement());
    if (items.length || this.#toolbar) (this.#toolbar ??= createToolbar(this.#doc, this)).render(items, d.messages.controlsLabel, d.english('controlsLabel'));
    const legend: Element[] = [];
    if (this.#legendList) legend.push(this.#legendList);
    if (items.length && this.#toolbar) legend.push(this.#toolbar.element);
    const slot = d.legend === 'top' ? 'top' : d.legend === 'right' ? 'side' : 'controls';
    if (this.#tableView) { if (controls & INSPECT) this.#renderTable(d); else this.#closeTable(); }
    const act = this.#activeElement();
    this.#figure.placeControls(slot, legend);
    for (const s of CONTROL_SLOTS) if (s !== slot) this.#figure.placeControls(s, NO_CONTROLS);
    this.#markFocusedSlice(this.#committed);
    if (isFocusable(act) && act !== this.#activeElement() && act.isConnected) focusQuiet(act);
    else if (inToolbar && !items.length) this.#focusFigure();
    return measure && this.#figure.controlsSignature() !== before;
  }

  #leaveSlices(d: Committed): void {
    const handoff = this.#handoffSliceKey;
    this.#handoffSliceKey = null;
    const list = this.#legendList, act = this.#activeElement();
    const key = list?.dataset.roving === 'false' && list.contains(act)
      ? (act as HTMLElement).parentElement?.dataset.key
      : handoff !== null && act === this.#root ? handoff : undefined;
    if (key === undefined || !plotReady(d)) return;
    // A ready donut's slices are no longer a tab stop (A2): focus moves on, still on the slice it was on.
    const ref: DatumRef = { kind: 'slice', sliceKey: key };
    this.#focus = d.lookup.resolve(ref) ?? firstDatum(d);
    if (this.#tableView) this.#tableView.focus(); else this.#restorePlotFocus(true);
  }

  #refreshControls(): void {
    if (this.#controlsState) this.#renderControls(this.#controlsState);
  }

  #placeProxy(d: Committed, hasData: boolean): void {
    if (!this.#proxy || !this.#ring) return;
    const ready = plotReady(d), usable = ready || recoverable(d);
    if (usable !== this.#proxyUsable) {
      this.#proxyUsable = usable;
      if (!usable && this.#activeElement() === this.#proxy && !this.#toolbar?.focus('table')) this.#focusFigure();
      if (this.#proxy.hidden === usable) this.#proxy.hidden = !usable;
      if (this.#ring.hidden === usable) this.#ring.hidden = !usable;
      if (this.#instructions && this.#instructions.hidden === usable) this.#instructions.hidden = !usable;
    }
    if (!usable) { this.#proxyInstructionState = null; return; }
    const p = plotBox(d);
    if (!this.#proxyRect || this.#proxyRect.x !== p.x || this.#proxyRect.y !== p.y || this.#proxyRect.width !== p.width || this.#proxyRect.height !== p.height) {
      this.#proxy.style.cssText = this.#ring.style.cssText = boxStyle(p);
    }
    this.#proxyRect = p;
    const count = instructionSeries(d, hasData), lang = readingLangFor(d, hasData, this.#single);
    const zoomInstructions = ready && offersZoom(d), donut = d.view.kind === 'donut';
    const plotLang = count ? d.english('plotInstructions') : null;
    const seriesLang = count > 1 ? d.english('seriesInstructions') : null;
    const donutLang = count && donut ? d.english('donutInstructions') : null;
    const zoomLang = zoomInstructions ? d.english('zoomInstructions') : null;
    const previous = this.#proxyInstructionState;
    this.#proxyInstructionState = d;
    if (previous && previous.kind === d.kind && previous.messages === d.messages && previous.zoom === d.zoom &&
        plotReady(previous) === ready && (ready && offersZoom(previous)) === zoomInstructions && previous.pageLang === d.pageLang &&
        this.#proxyInstructionCount === count && this.#proxyInstructionLang === lang &&
        this.#plotInstructionLang === plotLang && this.#seriesInstructionLang === seriesLang &&
        this.#donutInstructionLang === donutLang && this.#zoomInstructionLang === zoomLang) return;
    this.#proxyInstructionCount = count;
    this.#proxyInstructionLang = lang;
    this.#plotInstructionLang = plotLang;
    this.#seriesInstructionLang = seriesLang;
    this.#donutInstructionLang = donutLang;
    this.#zoomInstructionLang = zoomLang;
    setAttr(this.#proxy, 'aria-label', d.messages.plotLabel);
    if (this.#instructions) {
      const desc = descriptionFor(d, count);
      renderInstructions(this.#doc, this.#instructions, desc, lang, d.pageLang);
      setAttr(this.#proxy, 'aria-describedby', desc.length ? this.#instructions.id : null);
    }
    setAttr(this.#proxy, 'aria-roledescription', fill(d.messages.plotRole, { type: chartTypeName(d.messages, d.kind) }));
    setClass(this.#plot, 'axylo-touch-zoom', d.zoom === 'touch');
    setClass(this.#plot, 'axylo-zoomable', d.zoom !== false);
  }

  #dropHold(d: Committed, allowPick = true) { this.#rest = null; if (allowPick && this.#pointer) this.#pointTo(this.#pick(d, this.#pointer)); else this.#shown = this.#idle(); }

  #resetCore() { this.#single = false; this.#dismissed = this.#shownText = this.#focus = this.#handoffSliceKey = this.#rest = null; this.#pinPage = 0; }

  #reconcile(previous: Committed | null, next: Committed): void {
    const { lookup } = next;
    if (previous && previous.epoch !== next.epoch) {
      this.#resetCore(); this.#lastHover = null;
      this.#shown = this.#shown.k === S_KEY ? this.#shown : this.#pointer ? NO_HOVER : this.#idle();
    } else if (previous) {
      const map = categoryRemapper(previous.view, next.view);
      if (map) {
        this.#focus = map(this.#focus);
        if (this.#shownText) { const moved = map(this.#shownText.r, true); this.#shownText = moved ? { ...this.#shownText, r: moved } : null; }
        if (!this.#focus) this.#single = false;
        this.#lastHover = map(this.#lastHover);
        if (this.#dismissed) { const kept = this.#dismissed.flatMap(id => remapTarget(id, map) ?? []); this.#dismissed = kept.length ? kept : null; }
        if (this.#shown.k === S_PIN) { const t = remapTarget(this.#shown.t, map), r = map(this.#shown.r, true); this.#shown = t && r ? { k: S_PIN, r, t } : NO_HOVER; }
        else if (this.#shown.k === S_HELD) { const t = remapTarget(this.#shown.t, map); this.#shown = t ? { ...this.#shown, t } : NO_HOVER; }
      }
    }
    if (this.#focus) {
      const res = lookup.resolve(this.#focus); this.#focus = res;
      if (!res) this.#single = false; else if (!this.#single && res.kind === 'aligned') this.#focus = lookup.primary({ kind: 'x', x: res.x }) ?? res;
    }
    if (!this.#focus && this.#proxyFocused && plotReady(next) && readable(next)) this.#focus = firstDatum(next);

    const pres = presentationFor(next);
    if (!plotReady(next)) { if (this.#shown.k !== S_KEY) this.#shown = this.#pointer ? NO_HOVER : this.#idle(); this.#pinPage = 0; return; }
    if (this.#shown.k === S_PIN) {
      const kept = pres === 'none' ? null : stillPinned(next, this.#shown.r, this.#shown.t);
      if (kept) this.#shown = { k: S_PIN, ...kept };
      else { this.#endPin(); if ((this.#shown as Shown).k === S_HOVER && this.#pointer) this.#pointTo(this.#pick(next, this.#pointer)); }
    } else if (this.#shown.k === S_HELD) {
      if (pres !== this.#shown.p || !sameRect(this.#anchorOf(next, this.#shown.t), this.#shown.a) || !lookup.tooltip(this.#shown.t).rows.length) this.#dropHold(next, !this.#down?.d);
    } else if (this.#shown.k === S_HOVER && this.#pointer && !this.#down?.d) {
      const before = this.#shown.t, now = this.#pointTo(this.#pick(next, this.#pointer));
      const moved = now !== null && this.#content !== null && sameTarget(this.#content.t, now) && !sameRect(this.#anchorOf(next, now), this.#content.a);
      if (!sameTarget(before, now) || moved) this.#rest = { x: this.#pointer.x, y: this.#pointer.y, t: this.#clock(), g: now };
    }
  }

  commit(next: Committed | null): void {
    if (this.#destroyed) return;
    this.#clearGeo();
    const prev = this.#committed;
    this.#pendingWindow = undefined;
    if (!next?.interactive) { this.#reset(); this.#committed = next; return; }
    if (prev?.layout !== next.layout || prev.theme !== next.theme) this.#tooltip?.invalidateSize();
    if (this.#swatches && prev?.view !== next.view) this.#swatches.length = 0;
    this.#overlayInput = null;
    this.#committed = next; this.#dirty = true;
    this.#build();
    if (this.#range && !(plotReady(next) && next.zoom && next.view.kind !== 'donut')) { this.#range = null; this.#hideRange(); }
    else if (this.#range && !this.#down?.d) this.#markRange(next);
    // An untouched chart has no datum identity to carry across frame revisions.
    if (this.#shown.k !== S_NONE || this.#proxyFocused || this.#focus || this.#pointer || this.#dismissed) this.#reconcile(prev, next);
    const hasData = plotReady(next) && readable(next);
    this.#placeProxy(next, hasData); this.#writeProxy(false, hasData); this.#renderControls(next); this.#leaveSlices(next);
    if (this.#shown.k !== S_NONE || this.#proxyFocused || this.#lastPres || this.#lastHover || this.#overlayVisible || this.#pinListeners) this.#present();
    if (this.#shown.k === S_HELD && (!this.#content || !sameRect(this.#content.b, this.#shown.b)) && plotReady(next)) { this.#dropHold(next); this.#redraw(); }
  }

  prepare(state: ControlsState): boolean {
    if (this.#destroyed) return false;
    this.#clearGeo();
    const nextPres = presentationFor(state), strip = nextPres === 'strip', readoutChanged = this.#root.classList.contains('axylo-readout-mode') !== strip;
    if (!state.interactive && !this.#proxy && !this.#committed && !this.#controlsState && !readoutChanged) return false;
    let controlsChanged: boolean;
    if (!state.interactive) {
      const before = this.#figure.controlsSignature(); this.#reset(); this.#committed = this.#controlsState = null;
      controlsChanged = this.#figure.controlsSignature() !== before;
    } else { this.#build(); controlsChanged = this.#renderControls(state, true); }
    if (readoutChanged) {
      this.#root.classList.toggle('axylo-readout-mode', strip);
      this.#dropView(this.#shown.k !== S_PIN || nextPres === 'none');
      if (this.#shown.k === S_HELD) this.#shown = this.#pointer ? NO_HOVER : this.#idle();
      this.#rest = this.#pointer ? { x: this.#pointer.x, y: this.#pointer.y, t: this.#clock(), g: this.#pointerTarget() } : null;
    }
    return readoutChanged || controlsChanged;
  }

  #reset(): void {
    this.#clearGeo();
    this.#swatches = this.#hoverState = this.#hoverModel = this.#overlayInput = null;
    this.#unlistenPin();
    if (this.#committed) this.#draw(this.#committed, null);
    if (!this.#lastPres && !this.#proxy && !this.#tooltip?.visible && !this.#legendList && !this.#tableView && !this.#lastHover) return;
    this.#lastPres = null;
    const owned = this.#focusOwned();
    this.#hideTooltip(); this.#unbuild(owned); this.#resetCore();
    this.#tooltipContent = this.#touches = null;
    this.#shown = NONE; this.#content = this.#range = this.#pointer = null; this.#proxyFocused = this.#fromClick = this.#keyed = false;
    this.#hover(null);
  }

  clear(): void { this.#reset(); this.#committed = this.#controlsState = null; }

  attach(): void {
    if (this.#attached || this.#destroyed) return;
    this.#attached = true; this.#clearGeo(); registerFigure(this.#doc, this.#root);
    this.#listenShadowScroll();
    if (this.#interacted) this.#listenDocument();
  }

  detach(): void { if (!this.#attached) return; this.#attached = false; this.#clearGeo(); this.#cancelGestures(); this.#endPin(); this.#dropView(); unregisterFigure(this.#doc, this.#root); this.#unlistenAttached(); }

  destroy(): void {
    if (this.#destroyed) return;
    this.#reset(); unregisterFigure(this.#doc, this.#root); this.#tooltip?.destroy();
    this.#tooltip = this.#tooltipContent = this.#committed = this.#controlsState = null;
    this.#destroyed = true; this.#stopPinch();
  }
}

export function createInteraction(parts: InteractionParts, figure: Figure, renderer: MarkRenderer, actions: Actions): Interaction {
  return new DomInteraction(parts, figure, renderer, actions);
}
