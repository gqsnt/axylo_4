/**
 * Everything a reader uses to explore a full chart (decision 0001; spec I1–I6, A2–A4, A7): pointer, touch,
 * keyboard, tooltip, overlay, toolbar, table and zoom gestures.
 */
import type {
  DatumRef,
  DatumText,
  Formatters,
  Mark,
  MarkRenderer,
  Overlay,
  PickTarget,
  Rect,
  StepDirection,
  TooltipModel,
  View,
} from "../core/contracts";
import type { SyncResolve } from "../core/peer";
import { sameKey } from "../core/composition";
import { chartTypeName, ENGLISH_TAG, fill } from "../messages";
import {
  overlayWith,
  OUTLINE_REACH,
  RING_REACH,
  RING_STROKE,
  alignedTargetMarks,
  canZoomIn,
  datumReading,
  minimumWidth,
  panWindow,
  pinchWidth,
  pixelOf,
  positionAt,
  rangeWindow,
  refsAt,
  ringRect,
  sameRef,
  stepAcross,
  zoomStep,
  valueText,
  PAN_SHARE,
  ZOOM_FACTOR,
  positionText,
  type Mode,
  type OverlayInput,
} from "../core/focus";
import type { Figure } from "./figure";
import { createTableView, type TableView } from "./table";
import { createToolbar, type Toolbar } from "./toolbar";
import { createTooltip, type Presentation, type TooltipContent, type TooltipView } from "./tooltip";
import type { SwatchSpec } from "./swatch";
import type { AlignedHoverLookup, AlignedHoverModel } from "../lookup/aligned";
import { firstSlotReading } from "../lookup/text";
import { clamp } from "../scene/geometry";
import {
  activeElementOf,
  focusContainer,
  focusQuiet,
  isElement,
  isFocusable,
  setAttr,
  make,
  hideFromAT,
  setLanguageText,
  shadowRootOf,
  shadowRootsOf,
} from "./attributes";
import {
  Listeners,
  listenOutside,
  mappingOf,
  rectToViewport,
  toLocal,
  toViewport,
  visibleRegion,
  type Mapping,
  type Point,
} from "./mapping";
import { insideCorridor, intersect, type PlacementInput } from "./placement";
import { identityOf, matchesIdentity, sameTarget, type Identity } from "./pointer";
import type {
  Actions,
  Committed,
  ControlsState,
  Interaction,
  InteractionParts,
  Span,
} from "./interaction-types";
import {
  INSPECT,
  presentationFor,
  collectControlInputs,
  buildControlItems,
  offersZoom,
  recoverable,
  canZoom,
  missingLang,
} from "./interaction-controls";
import {
  isAligned,
  plotReady,
  readable,
  plotBox,
  horizontalBars,
  firstDatum,
  keyboardTarget,
  zoomBounds,
  markBox,
  pinnedModel,
  remapTarget,
  stillPinned,
  categoryRemapper,
  placementBox,
} from "./interaction-nav";
import {
  instructionSeries,
  descriptionFor,
  renderInstructions,
  focusedFigure,
  registerFigure,
  unregisterFigure,
  noteShowing,
  releaseShowing,
  isLastShowing,
  readingLangFor,
} from "./interaction-a11y";
import { resolveJumpTarget } from "./table-jump";

export type {
  Actions,
  Committed,
  ControlsState,
  Interaction,
  InteractionParts,
  ReadoutMode,
  SeriesSwatch,
  SliceList,
} from "./interaction-types";
export { readoutOf } from "./interaction-controls";
export { plotDescription } from "./interaction-a11y";
export { parseNumberAs } from "./table-jump";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type MutablePlacement = Omit<Mutable<PlacementInput>, "box"> & { box: Mutable<Rect> };

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
const consumeKey = (e: KeyboardEvent, immediate = false) => {
  e.preventDefault();
  immediate ? e.stopImmediatePropagation() : e.stopPropagation();
};
const setRange = (el: HTMLInputElement, max: string, value: string) => {
  if (el.max !== max) el.max = max;
  if (el.value !== value) el.value = value;
};
const padRect = (x: number, y: number, w: number, h: number, ox: number, oy = ox): Rect => ({
  x: x - ox,
  y: y - oy,
  width: Math.max(0, w + 2 * ox),
  height: Math.max(0, h + 2 * oy),
});
const plotCoord = (val: number, off: number, k: number, start: number, ext: number) => {
  const px = (val - off) / k,
    edge = off + start * k;
  return val >= edge - 1 && val <= edge + ext * k + 1 ? clamp(px, start, start + ext) : px;
};
const boxStyle = (x: number, y: number, w: number, h: number) =>
  `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;

const NAVIGATION: Readonly<Record<string, StepDirection>> = {
  ArrowRight: "next",
  ArrowLeft: "previous",
  Home: "first",
  End: "last",
  PageUp: "page-next",
  PageDown: "page-previous",
};
const DRAG_THRESHOLD = 4,
  REST_DISTANCE = 2,
  REST_TIME = 250,
  TAP_DISTANCE = 10,
  TAP_TIME = 1000,
  FOCUS_OUTLINE = 3,
  HOLE_CLEARANCE = 5;

const S_NONE = 0,
  S_KEY = 1,
  S_HOVER = 2,
  S_HELD = 3,
  S_PIN = 4,
  S_SYNC = 5;
type Shown =
  | { readonly k: 0 | 1 }
  | { readonly k: 2; readonly t: PickTarget | null }
  | {
      readonly k: 3;
      readonly t: PickTarget;
      readonly f: Point;
      readonly b: Rect;
      readonly a: Rect | null;
      readonly p: Presentation;
      readonly q: Point;
    }
  | { readonly k: 4; readonly r: DatumRef; readonly t: PickTarget }
  | { readonly k: 5; s: PickTarget | null; readonly f: SyncResolve; readonly o: object };

interface Content {
  readonly t: PickTarget;
  readonly b: Rect;
  readonly a: Rect | null;
  readonly p: Presentation;
  readonly pin: boolean;
  readonly pg: number;
}

const NONE: Shown = { k: S_NONE },
  KEY: Shown = { k: S_KEY },
  NO_HOVER: Shown = { k: S_HOVER, t: null };
const NO_UNCLIPPED_MARKS: Mark[] = [];
const NO_RINGS: readonly Rect[] = [],
  NO_CONTROLS: readonly Element[] = [];
const CONTROL_SLOTS = ["top", "side", "controls"] as const;
const FOCUS_LISTENERS = 1,
  DOWN_LISTENERS = 2,
  MOVE_LISTENERS = 4;
const SCROLL_OPTIONS = { capture: true, passive: true };
let controlScratch: unknown[] | undefined;

const hasZoomAxis = (d: Committed): d is Committed & { view: Exclude<View, { kind: "donut" }> } =>
  d.view.kind !== "donut";
const sameWindow = (a: Span | null, b: Span | null) =>
  a === b || (a !== null && b !== null && a[0] === b[0] && a[1] === b[1]);
const sameRect = (a: Rect | null, b: Rect | null) =>
  a === null || b === null
    ? a === b
    : Math.abs(a.x - b.x) < 0.01 &&
      Math.abs(a.y - b.y) < 0.01 &&
      Math.abs(a.width - b.width) < 0.01 &&
      Math.abs(a.height - b.height) < 0.01;
const clientPoint = (e: MouseEvent): Point => ({ x: e.clientX, y: e.clientY });

class DomInteraction implements Interaction {
  readonly #root: HTMLElement;
  readonly #doc: Document;
  readonly #plot: HTMLElement;
  readonly #parts: InteractionParts;
  readonly #figure: Figure;
  readonly #renderer: MarkRenderer;
  readonly #actions: Actions;

  #tooltip: TooltipView | null = null;
  #tooltipContent: Mutable<TooltipContent> | null = null;
  #hoverModel: AlignedHoverModel | null = null;
  #overlayInput: Mutable<OverlayInput> | null = null;

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
  #lastPres:
    | [
        PickTarget | null,
        DatumRef | null,
        DatumRef | null,
        number,
        number,
        DatumRef | null,
        Rect | null,
      ]
    | null = null;
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
  #label: HTMLElement | null = null;
  #selection: HTMLElement | null = null;
  #legendList: HTMLUListElement | null = null;
  #toolbar: Toolbar | null = null;
  #legendMarked: HTMLElement | null = null;
  #proxyUsable: boolean | null = null;
  #proxyKey: unknown[] | null = null;
  #idleProxyState: Committed | null = null;
  #idleHasData = false;
  #idleEmpty = "";
  #proxyLang: string | null | undefined;
  #idleCount: number | undefined;
  #idlePosition = "";
  #idleMax = "";
  #countFormatter: Formatters["count"] | undefined;
  #positionTemplate: string | undefined;
  #zoomCheckView: View | null = null;
  #zoomCheckWindow: Span | null = null;
  #zoomCheckResult = false;
  #swatches: SwatchSpec[] | null = null;

  constructor(parts: InteractionParts, figure: Figure, renderer: MarkRenderer, actions: Actions) {
    this.#parts = parts;
    this.#figure = figure;
    this.#renderer = renderer;
    this.#actions = actions;
    this.#root = figure.figure;
    this.#doc = this.#root.ownerDocument;
    this.#plot = figure.plot;
    registerFigure(this.#doc, this.#root);
  }

  #win() {
    return this.#doc.defaultView;
  }
  #active() {
    return activeElementOf(this.#doc, this.#root);
  }
  #clearGeo() {
    this.#geoPlot =
      this.#geoFigure =
      this.#geoVisible =
      this.#geoReadout =
      this.#geoControls =
      this.#geoPlacement =
        null;
  }
  #focusFigure() {
    focusContainer(this.#root);
  }

  #restorePlotFocus(verify?: boolean): void {
    const p = this.#proxy;
    if (p && !p.hidden) {
      focusQuiet(p);
      if (!verify || (this.#proxy && !this.#proxy.hidden && this.#active() === this.#proxy)) return;
    }
    this.#focusFigure();
  }

  #pointerTarget(): PickTarget | null {
    return "t" in this.#shown ? this.#shown.t : null;
  }
  #idle(): Shown {
    return this.#proxyFocused && !this.#fromClick ? KEY : NONE;
  }

  #draw(d: Committed, o: Overlay | null): void {
    if (!o && !this.#overlayVisible) return;
    this.#overlayVisible = o !== null;
    this.#renderer.drawOverlay(o, d.bindings, d.theme, d.pixelRatio);
  }

  #listenDocument(): void {
    if (this.#docListeners || !this.#attached || !this.#proxy) return;
    const l = (this.#docListeners = new Listeners()),
      w = this.#win();
    const clearRects = () => {
      this.#geoControls = null;
    };
    l.on(
      w,
      "keydown",
      (e: KeyboardEvent) => {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        const inChart = focusedFigure(this.#doc, this.#root);
        if (
          inChart !== this.#root &&
          (inChart !== null || (!isLastShowing(this.#doc, this.#root) && !this.#down?.d))
        )
          return;
        if (this.#down?.d) {
          consumeKey(e, true);
          this.#endDrag();
          return;
        }
        if (this.#range) {
          consumeKey(e, true);
          this.#endRange();
          return;
        }
        const s = this.#shown;
        if (s.k === S_SYNC) return;
        const target = this.#shownTarget();
        if (!target || (!this.#tooltip?.visible && s.k !== S_PIN)) return;
        consumeKey(e, true);
        if (this.#lastHover) this.#actions.hover(null);
        this.#dismissed = [
          identityOf(
            target,
            s.k === S_PIN
              ? s.r
              : s.k === S_KEY
                ? this.#focus
                : (this.#committed?.lookup.primary(target) ?? null),
          ),
        ];
        this.#pinPage = 0;
        if (s.k === S_HELD) {
          const under = this.#underPointer();
          if (under)
            this.#dismissed.push(identityOf(under, this.#committed!.lookup.primary(under)));
          this.#showHover(under);
        } else if (s.k === S_PIN) {
          if (this.#pointer) this.#showHover(target);
          else this.#shown = this.#idle();
        }
        this.#rest = null;
        this.#redraw();
      },
      true,
    );
    l.on(this.#doc, "scroll", this.#onScroll.bind(this), SCROLL_OPTIONS);
    l.on(
      w,
      "resize",
      () => {
        this.#clearGeo();
      },
      { passive: true },
    );
    l.on(w, "blur", () => {
      this.#cancelGestures();
    });
    l.on(this.#root, "focusin", clearRects);
    l.on(this.#root, "focusout", clearRects);
  }

  #joinTree(fresh = false): void {
    const label = this.#label;
    if (!label) return;
    let id = `${this.#figure.id}-l`;
    if (!fresh) label.id = "";
    const tree = this.#root.getRootNode() as Document | ShadowRoot;
    while (tree.getElementById?.(id)) id += 0;
    setAttr(this.#proxy!, "aria-labelledby", (label.id = id), fresh);
    if (this.#shadowScrollListeners || !this.#attached || tree.nodeType !== 11 || !("host" in tree))
      return;
    const l = (this.#shadowScrollListeners = new Listeners()),
      scroll = this.#onScroll.bind(this);
    for (let current: ShadowRoot | null = tree; current; current = shadowRootOf(current.host))
      l.on(current, "scroll", scroll, SCROLL_OPTIONS);
  }

  #startInteraction(group = 0): Listeners | undefined {
    if (!this.#interacted) {
      this.#interacted = true;
      this.#clearGeo();
      this.#listenDocument();
    }
    if (!group || this.#listenerFlags & group || !this.#proxy) return;
    this.#listenerFlags |= group;
    return (this.#built ??= new Listeners());
  }

  #unlistenAttached(): void {
    this.#docListeners?.clear();
    this.#shadowScrollListeners?.clear();
    this.#docListeners = this.#shadowScrollListeners = null;
  }

  #unlistenPin() {
    this.#pinListeners?.clear();
    this.#pinListeners = null;
  }

  #listenPin(): void {
    if (this.#pinListeners || !this.#attached) return;
    const l = (this.#pinListeners = new Listeners());
    listenOutside(
      this.#doc,
      shadowRootsOf(this.#root),
      "pointerdown",
      [this.#plot, this.#figure.tooltip, this.#figure.readout],
      () => this.#dismissPin(),
      l,
    );
  }

  #bindStartup(method: "addEventListener" | "removeEventListener"): void {
    const proxy = this.#proxy!,
      listener = this.#startupListener!;
    proxy[method]("focus", listener);
    proxy[method]("input", listener);
    proxy[method]("change", listener);
    this.#plot[method]("pointerdown", listener);
    this.#listenStage![method]("pointermove", this.#pointerMoveListener!);
  }

  #build(): void {
    if (this.#proxy) return;
    const proxy = (this.#proxy = make(this.#doc, "input", "axylo-proxy"));
    proxy.type = "range";
    proxy.id = `${this.#figure.id}-proxy`;
    proxy.min = "0";
    proxy.step = "1";
    this.#ring = make(this.#doc, "div", "axylo-focus-ring");
    hideFromAT(this.#ring);
    this.#instructions = make(this.#doc, "span", "axylo-visually-hidden");
    this.#instructions.id = `${this.#figure.id}-i`;
    // Hidden from browsing (the proxy's name already says it) but still read as the name it is referenced for.
    hideFromAT((this.#label = make(this.#doc, "span", "axylo-visually-hidden")));
    this.#plot.append(proxy, this.#ring, this.#instructions, this.#label);
    // Untouched charts need only the fixed listeners that bootstrap the lazy groups.
    this.#listenStage = this.#figure.stage;
    this.#startupListener = (ev) => {
      if (ev.type === "focus") this.#onProxyFocus();
      else if (ev.type === "pointerdown") this.#onPointerDown(ev as PointerEvent);
      else this.#onProxyInput();
    };
    this.#pointerMoveListener = this.#onPointerMove.bind(this);
    this.#bindStartup("addEventListener");
    this.#joinTree(true);
  }

  #stopPinch(apply = false): void {
    this.#pinch = null;
    if (this.#pinchFrame) {
      this.#win()?.cancelAnimationFrame(this.#pinchFrame);
      this.#pinchFrame = 0;
    }
    const w = this.#pinchWindow;
    this.#pinchWindow = undefined;
    if (apply && w !== undefined) this.#requestZoom(w);
  }

  #cancelGestures(): void {
    this.#endDrag();
    this.#touches?.clear();
    this.#pinched = false;
    this.#stopPinch();
  }

  #resolveAligned(d: Committed, target: PickTarget, primary?: DatumRef): DatumRef | null {
    if (this.#single && this.#focus?.kind === "aligned" && target.kind === "x") {
      const ref = d.lookup.resolve({
        kind: "aligned",
        seriesKey: this.#focus.seriesKey,
        x: target.x,
      });
      if (ref) return ref;
    }
    return primary ?? d.lookup.primary(target);
  }

  #takeover(d: Committed): void {
    const t = this.#pointerTarget();
    if (!t) {
      this.#focus ??= firstDatum(d);
      return;
    }
    if (this.#shown.k === S_PIN) this.#focus = this.#shown.r;
    else if (this.#single && this.#focus?.kind === "aligned" && t.kind === "x")
      this.#focus = this.#resolveAligned(d, t);
    else this.#focus = d.lookup.primary(t) ?? this.#focus ?? firstDatum(d);
  }

  #shownTarget(): PickTarget | null {
    const s = this.#shown;
    return s.k === S_SYNC
      ? s.s
      : s.k === S_KEY
        ? this.#proxyFocused && this.#focus && this.#committed
          ? keyboardTarget(this.#committed, this.#focus)
          : null
        : this.#pointerTarget();
  }

  #swatchFor(row: DatumText): SwatchSpec {
    const { view } = this.#committed!,
      i = row.seriesIndex;
    return ((this.#swatches ??= [])[i] ??=
      view.kind === "donut"
        ? { color: view.slices[i]?.colorIndex ?? null, cue: null, line: false, hollow: false }
        : this.#parts.swatch(i, view.cues[i] ?? null, false, view));
  }

  #plotMapping() {
    return (this.#geoPlot ??= mappingOf(this.#plot));
  }

  #controlRects(m: Mapping): readonly Rect[] {
    if (this.#geoControls) return this.#geoControls;
    const out: Rect[] = [],
      w = this.#win();
    this.#controlNodes ??= Array.from(
      this.#root.querySelectorAll<HTMLElement>(
        "button,input,select,textarea,a[href],[tabindex],.axylo-legend-list>li",
      ),
    ).filter(
      (el) =>
        el !== this.#proxy &&
        el !== this.#root &&
        !this.#figure.tooltip.contains(el) &&
        !this.#figure.readout.contains(el),
    );
    for (const el of this.#controlNodes) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const st = w?.getComputedStyle?.(el);
      const reach = Math.max(
        FOCUS_OUTLINE,
        st && st.outlineStyle !== "none"
          ? (parseFloat(st.outlineWidth) || 0) + Math.max(0, parseFloat(st.outlineOffset) || 0)
          : 0,
      );
      out.push(padRect(r.left, r.top, r.width, r.height, reach * m.kx, reach * m.ky));
    }
    return (this.#geoControls = out);
  }

  #plotPoint(d: Committed & { readonly layout: { readonly kind: "plot" } }, at: Point): Point {
    const m = this.#plotMapping(),
      b = d.layout.plot;
    return {
      x: plotCoord(at.x, m.left, m.kx, b.x, b.width),
      y: plotCoord(at.y, m.top, m.ky, b.y, b.height),
    };
  }

  #pick(d: Committed, at: Point): PickTarget | null {
    if (d.layout.kind !== "plot") return null;
    const p = this.#plotPoint(d as Committed & { readonly layout: { readonly kind: "plot" } }, at);
    return d.lookup.pick(p.x, p.y);
  }

  #anchorOf(d: Committed, t: PickTarget) {
    const b = markBox(d, t);
    return b ? rectToViewport(this.#plotMapping(), b) : null;
  }
  #hideTooltip() {
    this.#tooltip?.hide();
    releaseShowing(this.#doc, this.#root);
  }
  #dropView(hide = true) {
    if (hide) {
      this.#unlistenPin();
      this.#hideTooltip();
    }
    this.#content = this.#lastPres = null;
  }
  #redraw(rec: 0 | 1 | 2 = 0) {
    this.#dirty = true;
    this.#present(rec);
  }

  #present(rec: 0 | 1 | 2 | 3 = 0): void {
    const d = this.#committed,
      shown = this.#shown,
      remote = shown.k === S_SYNC,
      target = this.#shownTarget();
    setAttr(this.#root, "data-axylo-sync", remote && target ? "" : null);
    if (!plotReady(d) || !this.#proxy || (shown.k === S_NONE && !this.#proxyFocused)) {
      if (d) this.#draw(d, null);
      this.#dropView();
      if (!remote && rec < 3 && this.#shown === shown) this.#hover(null);
      return;
    }
    const { view, layout, lookup } = d;
    const visibleRing =
      this.#proxyFocused && (this.#keyed || this.#proxy.matches(":focus-visible"))
        ? this.#focus
        : null;
    const only = this.#single && shown.k === S_KEY ? this.#focus : null,
      pres = presentationFor(d),
      pinned = shown.k === S_PIN;
    const showTip =
        pres !== "none" &&
        target !== null &&
        !this.#dismissed?.some((id) => this.#dismissedBy(id, target)),
      page = pinned ? this.#pinPage : 0;
    const flags =
      +showTip |
      (+pinned * 2) |
      (pres === "strip" ? 4 : pres === "floating" ? 8 : 0) |
      (+remote * 16);
    const last = this.#lastPres;
    const lead = target?.kind === "x" ? lookup.primary(target) : null,
      leadAt = lead ? lookup.anchor(lead) : null;
    if (
      !this.#dirty &&
      last &&
      sameTarget(target, last[0]) &&
      sameRef(visibleRing, last[1]) &&
      sameRef(only, last[2]) &&
      flags === last[3] &&
      page === last[4] &&
      sameRef(lead, last[5]) &&
      sameRect(leadAt, last[6])
    )
      return;
    this.#lastPres = [target, visibleRing, only, flags, page, lead, leadAt];
    this.#dirty = false;
    if (pinned) this.#listenPin();
    else this.#unlistenPin();
    const prev = this.#content;
    this.#content = null;
    if (pinned && !showTip) {
      this.#dismissPin();
      return;
    }
    const readHover =
      showTip && (shown.k === S_HOVER || remote) && pres === "floating" && target.kind === "x"
        ? (lookup as AlignedHoverLookup).alignedHover
        : undefined;
    const model: TooltipModel | null = readHover
      ? (this.#hoverModel = readHover.call(
          lookup,
          target as Extract<PickTarget, { kind: "x" }>,
          this.#hoverModel,
        ))
      : showTip
        ? pinned
          ? pinnedModel(d, target, this.#pinPage)
          : lookup.tooltip(target)
        : null;
    if (this.#shown !== shown) return;
    const soleRef = target?.kind === "x" && model?.count === 1 ? model.rows[0]?.ref : undefined;
    const input = (this.#overlayInput ??= {
      view,
      layout,
      lookup,
      target,
      ring: visibleRing,
      only,
    });
    input.target = target;
    input.ring = visibleRing;
    input.only = only;
    let overlay: Overlay | null;
    if (
      readHover &&
      soleRef &&
      !visibleRing &&
      layout.kind === "plot" &&
      layout.projection.kind === "xy" &&
      this.#parts.overlay === alignedTargetMarks
    ) {
      // Reuse the tooltip's ref for the cursor and hover event. The renderer still gets a snapshot.
      const clipped: Mark[] = [];
      input.only = soleRef;
      alignedTargetMarks(input, layout.plot, clipped, NO_UNCLIPPED_MARKS);
      overlay = clipped.length
        ? { clip: layout.plot, clipped, unclipped: NO_UNCLIPPED_MARKS }
        : null;
    } else {
      overlay = overlayWith(this.#parts.overlay, input);
      if (remote && overlay && target?.kind === "point" && layout.kind === "plot") {
        const r = target.refs[0],
          at = r?.kind === "point" ? pixelOf(layout, r.x) : null,
          p = layout.plot;
        if (at !== null)
          (overlay.clipped as Mark[]).unshift({
            type: "rule",
            x1: at,
            y1: p.y,
            x2: at,
            y2: p.y + p.height,
            stroke: { kind: "token", name: "axis" },
            strokeWidth: 1,
            dash: null,
            role: "cursor",
          });
      }
    }
    if (model?.rows.length && target && pres !== "none") {
      const tc = (this.#tooltipContent ??= {
        model,
        swatch: this.#swatchFor.bind(this),
        moreRows: (n) =>
          fill(this.#committed!.messages.moreRows, { count: this.#committed!.formatters.count(n) }),
        valueLang: (tx) => missingLang(this.#committed!, tx) ?? null,
        select: (row) => this.#actions.select(row.ref),
        more: (n) => {
          if (this.#shown.k !== S_PIN) return;
          const next = this.#pinPage + Math.max(1, n);
          this.#pinPage = next >= this.#tooltipContent!.model.count ? 0 : next;
          this.#redraw();
        },
      });
      tc.model = model;
      if (model.total !== null) {
        tc.totalLabel = d.messages.total;
        tc.totalLang = d.english("total");
      }
      if (model.count > 1) tc.moreLang = d.english("moreRows");
      const marks = markBox(d, target, soleRef),
        map = this.#plotMapping(),
        anchor = marks ? rectToViewport(map, marks) : null;
      const bounds =
        pres === "strip"
          ? (this.#geoReadout ??= visibleRegion(this.#figure.readout, false))
          : this.#placementFor(
              d,
              placementBox(d, leadAt, marks, (shown.k | 1) === S_HELD),
              visibleRing,
              map,
            );
      const figureMap = pres === "strip" ? undefined : (this.#geoFigure ??= mappingOf(this.#root));
      this.#draw(d, overlay);
      if (this.#shown !== shown) return;
      const tip = (this.#tooltip ??= createTooltip(
        this.#figure.tooltip,
        this.#figure.readout,
        this.#root,
        this.#restorePlotFocus.bind(this),
      ));
      const placed =
        "box" in bounds ? tip.show(tc, bounds, pinned, figureMap) : tip.strip(tc, pinned, bounds);
      if (this.#shown !== shown) {
        this.#hideTooltip();
        return;
      }
      const rect = placed ? tip.rect() : null;
      if (rect) {
        if (!remote)
          noteShowing(
            this.#doc,
            this.#root,
            rec === 2 ||
              (rec === 0 &&
                (!prev || !sameTarget(prev.t, target) || prev.pin !== pinned || prev.pg !== page)),
          );
        this.#content = { t: target, b: rect, a: anchor, p: pres, pin: pinned, pg: page };
      } else releaseShowing(this.#doc, this.#root);
    } else {
      this.#hideTooltip();
      this.#draw(d, overlay);
      if (this.#shown !== shown) return;
    }
    if (pinned && !this.#content) {
      this.#dismissPin();
      return;
    }
    if (!remote)
      this.#hover(
        !target
          ? null
          : shown.k === S_KEY
            ? this.#focus
            : shown.k === S_PIN
              ? shown.r
              : (soleRef ?? lookup.primary(target)),
      );
  }

  #placementFor(
    d: Committed,
    box: Rect | null,
    keyboardRing: DatumRef | null,
    m: Mapping,
  ): PlacementInput {
    const { layout, lookup } = d,
      area = plotBox(d);
    const bx = box ? box.x : area.x + area.width / 2,
      by = box ? box.y : area.y + area.height / 2;
    const controls = this.#controlRects(m),
      rb = keyboardRing ? ringRect(layout, lookup, keyboardRing) : null;
    const rings = rb ? [rectToViewport(m, rb)] : NO_RINGS;
    if (!this.#geoPlacement) {
      let hole: PlacementInput["hole"] = null;
      if (
        layout.kind === "plot" &&
        layout.projection.kind === "ring" &&
        layout.projection.r0 > HOLE_CLEARANCE
      ) {
        const { cx, cy, r0 } = layout.projection,
          ctr = toViewport(m, { x: cx, y: cy });
        hole = {
          cx: ctr.x,
          cy: ctr.y,
          rx: (r0 - HOLE_CLEARANCE) * m.kx,
          ry: (r0 - HOLE_CLEARANCE) * m.ky,
        };
      }
      this.#geoPlacement = {
        box: { x: 0, y: 0, width: 0, height: 0 },
        visible: intersect(
          rectToViewport(m, padRect(area.x, area.y, area.width, area.height, -OUTLINE_REACH)),
          (this.#geoVisible ??= visibleRegion(this.#plot, true, this.#figure.tooltip)),
        ),
        order: horizontalBars(d) ? "horizontal" : "vertical",
        hole,
        controls,
        rings,
        ringStroke: RING_STROKE * Math.max(m.kx, m.ky),
      };
    }
    const db = this.#geoPlacement.box;
    db.x = m.left + (bx - RING_REACH) * m.kx;
    db.y = m.top + (by - RING_REACH) * m.ky;
    db.width = Math.max(0, (box?.width ?? 0) + 2 * RING_REACH) * m.kx;
    db.height = Math.max(0, (box?.height ?? 0) + 2 * RING_REACH) * m.ky;
    this.#geoPlacement.controls = controls;
    this.#geoPlacement.rings = rings;
    return this.#geoPlacement;
  }

  #hover(ref: DatumRef | null): void {
    if (!sameRef(ref, this.#lastHover)) {
      this.#lastHover = ref;
      this.#actions.hover(ref);
    }
  }

  #focusedSlice(): string | null {
    return this.#proxyFocused && this.#focus?.kind === "slice" && plotReady(this.#committed)
      ? this.#focus.sliceKey
      : null;
  }

  #markLegend(sliceKey: string | null): void {
    if (this.#legendMarked) {
      if (
        this.#legendMarked.dataset.key === sliceKey &&
        this.#legendMarked.parentNode === this.#legendList
      )
        return;
      this.#legendMarked.classList.remove("axylo-legend-current");
      this.#legendMarked = this.#geoControls = null;
    }
    if (sliceKey !== null && this.#legendList) {
      for (const child of this.#legendList.children) {
        const li = child as HTMLElement;
        if (li.dataset.key !== sliceKey) continue;
        li.classList.add("axylo-legend-current");
        this.#legendMarked = li;
        this.#geoControls = null;
        break;
      }
    }
  }

  #writeProxy(acted: boolean, readyData?: boolean): void {
    const d = this.#committed;
    if (!this.#proxy || !d) return;
    const { view, lookup, formatters, messages } = d;
    if (view.kind === "donut" || this.#legendMarked) this.#markLegend(this.#focusedSlice());
    const hasData = readyData ?? (plotReady(d) && readable(d)),
      lang = readingLangFor(d, hasData, this.#single);
    const empty = hasData
      ? messages.noData
      : recoverable(d) || plotReady(d)
        ? messages.empty
        : (d.message ?? messages.noData);
    const inactive = !acted && !this.#proxyFocused && !this.#focus;
    if (inactive) {
      const prev = this.#idleProxyState;
      this.#idleProxyState = d;
      if (
        prev &&
        this.#idleHasData === hasData &&
        (!hasData || (prev.lookup === lookup && prev.view === view)) &&
        prev.formatters === formatters &&
        prev.messages === messages &&
        this.#proxyLang === lang &&
        this.#idleEmpty === empty
      )
        return;
      this.#idleHasData = hasData;
      this.#idleEmpty = empty;
    } else this.#idleProxyState = null;
    if (this.#proxyLang !== lang) {
      setAttr(this.#proxy, "lang", lang);
      this.#proxyLang = lang;
    }
    const idleAligned =
      inactive &&
      hasData &&
      !this.#single &&
      lookup.count > 0 &&
      (lookup as AlignedHoverLookup).alignedHover &&
      isAligned(view);
    const ref = hasData && !idleAligned ? (this.#focus ?? firstDatum(d)) : null;
    if (!ref) {
      if (idleAligned) {
        const count = lookup.count;
        if (
          this.#idleCount !== count ||
          this.#countFormatter !== formatters.count ||
          this.#positionTemplate !== messages.position
        ) {
          this.#idleCount = count;
          this.#countFormatter = formatters.count;
          this.#positionTemplate = messages.position;
          this.#idlePosition = positionText(messages, formatters, 0, count);
          this.#idleMax = String(count - 1);
        }
      }
      setRange(this.#proxy, idleAligned ? this.#idleMax : "0", "0");
      setAttr(
        this.#proxy,
        "aria-valuetext",
        idleAligned ? firstSlotReading(view, formatters, messages, this.#idlePosition) : empty,
      );
      this.#shownOrdinal = 0;
      this.#shownText = null;
      return;
    }
    const ord = Math.max(0, lookup.ordinal(ref));
    setRange(this.#proxy, String(Math.max(0, lookup.count - 1)), String(ord));
    const mode: Mode = this.#single ? "single" : "all";
    const reading = inactive ? null : datumReading(view, lookup, ref, mode, formatters, messages);
    const prev = this.#shownText;
    if (
      inactive ||
      acted ||
      !prev ||
      !sameRef(ref, prev.r) ||
      this.#single !== prev.s ||
      reading !== prev.d ||
      !this.#proxy.hasAttribute("aria-valuetext")
    ) {
      setAttr(
        this.#proxy,
        "aria-valuetext",
        valueText(view, lookup, ref, mode, formatters, messages) ?? messages.noData,
      );
      this.#shownText = inactive ? null : { r: ref, s: this.#single, d: reading };
    }
    this.#shownOrdinal = ord;
  }

  #keyboardLeads(d: Committed): void {
    this.#shown = KEY;
    this.#pinPage = 0;
    this.#rest = null;
    if (this.#focus) this.#reached(keyboardTarget(d, this.#focus));
  }
  #presentKeyboard(d: Committed, acted: boolean): void {
    this.#keyboardLeads(d);
    this.#writeProxy(acted);
    this.#present();
  }

  #onProxyKey(e: KeyboardEvent): void {
    const d = this.#committed;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const { key } = e,
      rec = recoverable(d);
    if (!rec && !plotReady(d)) return;
    if (!rec) this.#fromClick = false;
    if (d!.zoom) {
      const action =
        !rec && (key === "+" || key === "=")
          ? "zoomIn"
          : key === "-" || key === "_"
            ? "zoomOut"
            : key === "0"
              ? "resetZoom"
              : null;
      if (action) {
        consumeKey(e);
        this.activateControl(action);
        return;
      }
    }
    if (e.shiftKey && (key === "ArrowLeft" || key === "ArrowRight")) {
      if (rec) consumeKey(e);
      else e.preventDefault();
      if (d!.zoom) this.#changeWindow(key === "ArrowRight" ? PAN_SHARE : -PAN_SHARE, true);
      return;
    }
    const upDown = key === "ArrowUp" || key === "ArrowDown";
    if (rec || !readable(d!)) {
      if (key in NAVIGATION || upDown || (!rec && (key === "Enter" || key === " ")))
        e.preventDefault();
      return;
    }
    const ready = d as Committed & { readonly ready: true };
    if (key === "Enter" || key === " ") {
      e.preventDefault();
      this.#focus ??= firstDatum(ready);
      if (this.#focus) this.#actions.select(this.#focus);
      return;
    }
    if (key === "Escape") {
      if (this.#single) {
        consumeKey(e);
        this.#single = false;
        if (this.#focus?.kind === "aligned")
          this.#focus = ready.lookup.primary({ kind: "x", x: this.#focus.x }) ?? this.#focus;
        this.#writeProxy(true);
        this.#present();
      }
      return;
    }
    const dir = upDown
      ? ready.view.kind === "donut"
        ? key === "ArrowUp"
          ? "next"
          : "previous"
        : key === "ArrowDown"
          ? "series-next"
          : "series-previous"
      : NAVIGATION[key];
    if (!dir) return;
    e.preventDefault();
    this.#takeover(ready);
    const from = this.#focus,
      series = dir === "series-next" || dir === "series-previous";
    if (series) {
      if (!from) return;
      if (from.kind === "aligned" && isAligned(ready.view) && !this.#single) {
        const refs = refsAt(ready.view, from.x),
          ref = dir === "series-next" ? refs[0] : refs.at(-1);
        if (ref) {
          this.#focus = ref;
          this.#single = true;
        }
      } else if (from.kind === "point" || (from.kind === "aligned" && isAligned(ready.view))) {
        this.#focus = ready.lookup.step(from, dir) ?? from;
        if (from.kind === "point") this.#single = true;
      }
    } else if (from) {
      let next: DatumRef | null;
      if (!this.#single && from.kind === "aligned" && isAligned(ready.view)) {
        const x = stepAcross(ready.view, from.x, dir);
        next = x === null ? null : ready.lookup.primary({ kind: "x", x });
      } else if (
        this.#single &&
        from.kind === "point" &&
        ready.view.kind === "scatter" &&
        this.#parts.stepInSeries
      ) {
        next = this.#parts.stepInSeries(ready.view, from, dir);
      } else next = ready.lookup.step(from, dir);
      this.#focus = next ?? from;
    }
    const moved = series || !sameRef(from, this.#focus);
    if (moved || this.#shown.k !== S_PIN) this.#presentKeyboard(ready, moved);
  }

  #onProxyInput(): void {
    this.#startInteraction();
    const d = this.#committed;
    if (!this.#proxy || !plotReady(d)) return;
    if (!readable(d)) {
      this.#writeProxy(false);
      return;
    }
    const ord = Number(this.#proxy.value);
    if (!Number.isFinite(ord) || ord === this.#shownOrdinal) return;
    this.#takeover(d);
    const { view, lookup } = d;
    let ref: DatumRef | null;
    if (isAligned(view)) {
      const { start, end } = view.visibleSlots,
        x = view.frame.x.values[start + clamp(ord, 0, Math.max(0, end - start - 1))];
      ref =
        x === undefined
          ? null
          : this.#single && this.#focus?.kind === "aligned"
            ? lookup.resolve({ kind: "aligned", seriesKey: this.#focus.seriesKey, x })
            : lookup.primary({ kind: "x", x });
    } else {
      ref = lookup.step(null, "first");
      for (let i = 0; ref && i < ord && i < lookup.count; i++) {
        const next = lookup.step(ref, "next");
        if (!next) break;
        ref = next;
      }
      if (
        ref &&
        this.#single &&
        this.#focus &&
        "seriesKey" in this.#focus &&
        "seriesKey" in ref &&
        ref.seriesKey !== this.#focus.seriesKey
      )
        this.#single = false;
    }
    this.#focus = ref ?? this.#focus;
    this.#presentKeyboard(d, true);
  }

  #onProxyFocus(): void {
    const d = this.#committed;
    const listeners = this.#startInteraction(FOCUS_LISTENERS);
    if (listeners) {
      listeners.on(this.#proxy!, "keydown", (ev) => {
        this.#onProxyKey(ev);
        if (ev.defaultPrevented && !this.#keyed) {
          this.#keyed = true;
          this.#proxy?.classList.toggle("axylo-keyed", true);
          this.#redraw();
        }
      });
      listeners.on(this.#proxy!, "blur", () => {
        this.#proxyFocused = this.#fromClick = this.#keyed = false;
        this.#proxy?.classList.remove("axylo-keyed");
        this.#markLegend(null);
        if (this.#shown.k === S_KEY) {
          if (this.#pointer && this.#committed) this.#showHover(this.#underPointer());
          else this.#shown = NONE;
        }
        this.#redraw(1);
      });
      listeners.on(
        this.#plot,
        "wheel",
        (e: WheelEvent) => {
          const d = this.#committed;
          if (
            !plotReady(d) ||
            !d.zoom ||
            !this.#proxy ||
            this.#active() !== this.#proxy ||
            e.ctrlKey ||
            e.metaKey ||
            !e.deltaY
          )
            return;
          const p = this.#local(e),
            unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
          if (
            this.#changeWindow(
              clamp(Math.exp(e.deltaY * unit * 0.002), 0.25, 4),
              false,
              positionAt(d.layout, p.x, p.y) ?? undefined,
            )
          )
            e.preventDefault();
        },
        { passive: false },
      );
    }
    this.#proxyFocused = true;
    if (!plotReady(d)) {
      this.#writeProxy(true);
      return;
    }
    this.#fromClick = this.#clickFocus;
    this.#takeover(d);
    if (!this.#clickFocus) this.#keyboardLeads(d);
    this.#writeProxy(true);
    this.#redraw();
  }

  #zoomWindow(d: Committed & { view: Exclude<View, { kind: "donut" }> }): Span | null {
    return this.#pendingWindow !== undefined
      ? this.#pendingWindow
      : d.zoomed
        ? d.view.xDomain
        : null;
  }

  #requestZoom(w: Span | null): void {
    const d = this.#committed;
    if (!d || !hasZoomAxis(d) || sameWindow(this.#zoomWindow(d), w)) return;
    this.#pendingWindow = w;
    this.#actions.zoom(w);
  }

  #changeWindow(amount: number, pan: boolean, center?: number): boolean {
    const d = this.#committed;
    if (!d?.zoom || !hasZoomAxis(d)) return false;
    const full = zoomBounds(d),
      now = this.#zoomWindow(d) ?? full;
    let next: Span | null | undefined;
    if (pan) {
      next = panWindow(full, now, amount);
      if (!next) return false;
    } else {
      const ref = this.#focus,
        x = ref && ref.kind !== "slice" ? ref.x : NaN;
      next = zoomStep(
        full,
        now,
        amount,
        center ?? (Number.isFinite(x) && x >= now[0] && x <= now[1] ? x : (now[0] + now[1]) / 2),
        minimumWidth(d.view),
      );
      if (next === undefined) return false;
    }
    this.#requestZoom(next);
    return true;
  }

  #local(e: MouseEvent) {
    return toLocal(this.#plotMapping(), clientPoint(e));
  }
  #dismissedBy(id: Identity, t: PickTarget) {
    return (
      matchesIdentity(id, t) ||
      (id.kind === "point" && t.kind === "point" && this.#committed?.lookup.has(t, id.ref))
    );
  }
  #reached(t: PickTarget | null) {
    if (t && this.#dismissed) {
      const kept = this.#dismissed.filter((id) => this.#dismissedBy(id, t));
      this.#dismissed = kept.length ? kept : null;
    }
  }
  #underPointer() {
    return this.#pointer && plotReady(this.#committed)
      ? this.#pick(this.#committed, this.#pointer)
      : null;
  }
  #showHover(t: PickTarget | null) {
    const s = (this.#hoverState ??= { k: S_HOVER, t });
    s.t = t;
    this.#shown = s;
  }
  #pointTo(t: PickTarget | null) {
    this.#reached(t);
    this.#showHover(t);
    return t;
  }

  #pointerAt(x: number, y: number, time: number): void {
    const d = this.#committed;
    if (!plotReady(d)) return;
    const at = (this.#pointer ??= { x, y });
    let shown = this.#shown;
    const rest = this.#rest,
      content = this.#content;
    const still = rest !== null && dist(x, y, rest.x, rest.y) <= REST_DISTANCE;
    if (
      shown.k === S_HOVER &&
      shown.t &&
      rest?.g &&
      time - rest.t >= REST_TIME &&
      sameTarget(rest.g, shown.t) &&
      content &&
      sameTarget(content.t, shown.t)
    ) {
      shown = this.#shown = { ...content, k: S_HELD, f: { ...rest }, q: { ...at } };
    }
    at.x = x;
    at.y = y;
    if (shown.k === S_PIN) return;
    if (shown.k === S_HELD) {
      if (insideCorridor(shown.f, shown.b, at)) {
        if (!still) this.#rest = { x, y, t: time, g: shown.t };
        this.#present();
        return;
      }
      this.#shown = NO_HOVER;
    }
    const target = this.#pointTo(this.#pick(d, at)),
      latest = this.#rest;
    if (!latest) this.#rest = { x, y, t: time, g: target };
    else if (!still || !sameTarget(latest.g, target)) {
      latest.x = x;
      latest.y = y;
      latest.t = time;
      latest.g = target;
    }
    this.#present();
  }

  #onPointerMove(event: Event): void {
    const e = event as PointerEvent;
    const listeners = this.#startInteraction(MOVE_LISTENERS);
    if (listeners) {
      listeners.on(this.#figure.stage, "pointerleave", (ev: PointerEvent) => {
        if (ev.pointerType !== "touch" && !this.#down?.d) {
          this.#clearGeo();
          this.#leave();
        }
      });
    }
    if (e.pointerType === "touch") {
      const tr = this.#touches?.get(e.pointerId);
      if (tr) {
        const at = this.#local(e);
        tr.x = at.x;
        tr.y = at.y;
        const d = this.#committed,
          ph = this.#pinch,
          a = ph && this.#touches?.get(ph.ids[0]),
          b = ph && this.#touches?.get(ph.ids[1]);
        if (
          ph?.ids.includes(e.pointerId) &&
          a &&
          b &&
          plotReady(d) &&
          d.view.kind !== "donut" &&
          d.layout.kind === "plot"
        ) {
          const width = pinchWidth(
            ph.w[1] - ph.w[0],
            ph.d / Math.max(1, dist(a.x, a.y, b.x, b.y)),
            minimumWidth(d.view),
          );
          const p = d.layout.plot,
            full = zoomBounds(d);
          const share = horizontalBars(d)
            ? (p.y + p.height - (a.y + b.y) / 2) / p.height
            : ((a.x + b.x) / 2 - p.x) / p.width;
          const start = clamp(ph.c - share * width, full[0], full[1] - width);
          this.#pinchWindow = width >= full[1] - full[0] ? null : [start, start + width];
          if (!this.#pinchFrame)
            this.#pinchFrame = this.#win()!.requestAnimationFrame(() => {
              this.#pinchFrame = 0;
              if (this.#pinchWindow !== undefined) this.#requestZoom(this.#pinchWindow);
              this.#pinchWindow = undefined;
            });
        }
      }
      return;
    }
    if ((this.#down && this.#down.id !== e.pointerId) || this.#tableView) return;
    if (this.#down) {
      const at = this.#local(e);
      if (
        !this.#down.d &&
        this.#committed?.zoom &&
        dist(at.x, at.y, this.#down.x, this.#down.y) > DRAG_THRESHOLD
      ) {
        this.#down.d = true;
        if (this.#shown.k === S_PIN) {
          this.#shown = NO_HOVER;
          this.#pinPage = 0;
        }
        this.#dropView();
      }
      if (this.#down.d) {
        this.#drawSelection(this.#down.x, this.#down.y, at.x, at.y);
        return;
      }
    }
    this.#pointerAt(e.clientX, e.clientY, e.timeStamp);
  }

  #leave(): void {
    this.#pointer = this.#rest = null;
    if ((this.#shown.k | 1) === S_HELD) this.#shown = this.#idle();
    this.#present();
  }

  #drawSelection(ax: number, ay: number, bx: number, by: number): void {
    const d = this.#committed;
    if (d?.layout.kind !== "plot") return;
    if (!this.#selection) {
      hideFromAT((this.#selection = make(this.#doc, "div", "axylo-selection")));
      this.#plot.appendChild(this.#selection);
    }
    const p = d.layout.plot,
      horiz = horizontalBars(d);
    const start = horiz ? p.y : p.x,
      end = start + (horiz ? p.height : p.width);
    const a = clamp(horiz ? ay : ax, start, end),
      b = clamp(horiz ? by : bx, start, end);
    const low = Math.min(a, b),
      extent = Math.abs(b - a);
    this.#selection.style.cssText = horiz
      ? boxStyle(p.x, low, p.width, extent)
      : boxStyle(low, p.y, extent, p.height);
    this.#selection.hidden = false;
  }

  #markRange(d: Committed): void {
    const px = this.#range?.s == null ? null : pixelOf(d.layout, this.#range.s);
    if (px === null) {
      if (this.#selection && !this.#down?.d) this.#selection.hidden = true;
      return;
    }
    const h = horizontalBars(d);
    this.#drawSelection(h ? -1 : px - 1, h ? px - 1 : -1, h ? 1 : px + 1, h ? px + 1 : 1);
  }

  #endRange(): void {
    if (!this.#range) return;
    this.#range = null;
    if (this.#selection && !this.#down?.d) this.#selection.hidden = true;
    if (this.#controlsState) this.#renderControls(this.#controlsState);
  }

  #endDrag(): void {
    if (this.#selection) this.#selection.hidden = true;
    if (this.#range && this.#committed) this.#markRange(this.#committed);
    const was = this.#down;
    this.#down = null;
    if (was && this.#plot.hasPointerCapture?.(was.id)) {
      try {
        this.#plot.releasePointerCapture(was.id);
      } catch {}
    }
  }

  #applyRange(d: Committed, a: number, b: number): void {
    const next = rangeWindow(zoomBounds(d), a, b, minimumWidth(d.view));
    this.#endRange();
    if (next !== undefined) this.#requestZoom(next);
  }

  #onPointerDown(e: PointerEvent): void {
    const d = this.#committed;
    const listeners = this.#startInteraction(DOWN_LISTENERS);
    if (listeners) {
      const end = this.#onPointerEnd.bind(this);
      listeners.on(this.#plot, "pointerup", end);
      listeners.on(this.#plot, "pointercancel", end);
      listeners.on(this.#plot, "lostpointercapture", (ev) => {
        if (this.#down?.id === ev.pointerId) this.#endDrag();
      });
    }
    if (!plotReady(d)) return;
    if (this.#keyed) {
      this.#keyed = false;
      this.#proxy?.classList.remove("axylo-keyed");
      this.#redraw();
    }
    const at = this.#local(e);
    if (e.pointerType === "touch") {
      const map = (this.#touches ??= new Map());
      map.set(e.pointerId, { x: at.x, y: at.y, x0: at.x, y0: at.y, t0: e.timeStamp });
      if (map.size === 2 && d.zoom === "touch" && hasZoomAxis(d)) {
        const [[ia, a] = [], [ib, b] = []] = map;
        if (ia !== undefined && ib !== undefined && a && b) {
          const w = this.#zoomWindow(d) ?? zoomBounds(d);
          this.#pinch = {
            ids: [ia, ib],
            d: Math.max(1, dist(a.x, a.y, b.x, b.y)),
            w,
            c: positionAt(d.layout, (a.x + b.x) / 2, (a.y + b.y) / 2) ?? (w[0] + w[1]) / 2,
          };
          if (this.#shown.k === S_PIN) {
            this.#shown = this.#idle();
            this.#pinPage = 0;
          }
          this.#dropView();
          this.#draw(d, null);
        }
      }
      if (map.size > 1) this.#pinched = true;
      return;
    }
    if (e.button !== 0 || this.#down) return;
    this.#down = { id: e.pointerId, x: at.x, y: at.y, d: false };
    try {
      this.#plot.setPointerCapture(e.pointerId);
    } catch {}
  }

  #onPointerEnd(e: PointerEvent): void {
    const d = this.#committed,
      cancelled = e.type === "pointercancel";
    if (e.pointerType === "touch") {
      const tr = this.#touches?.get(e.pointerId);
      this.#touches?.delete(e.pointerId);
      if (this.#pinch?.ids.includes(e.pointerId)) this.#stopPinch(!cancelled);
      const wasPinch = this.#pinched;
      if (!this.#touches?.size) this.#pinched = false;
      if (wasPinch || cancelled) return;
      const up = this.#local(e);
      if (
        tr &&
        plotReady(d) &&
        dist(up.x, up.y, tr.x0, tr.y0) < TAP_DISTANCE &&
        e.timeStamp - tr.t0 < TAP_TIME
      )
        this.#activate(d, clientPoint(e), false);
      return;
    }
    const was = this.#down;
    if (was ? was.id !== e.pointerId : !cancelled) return;
    this.#endDrag();
    if (cancelled) {
      this.#leave();
      return;
    }
    if (!was || !plotReady(d)) return;
    if (was.d) {
      const at = this.#local(e),
        a = positionAt(d.layout, was.x, was.y),
        b = positionAt(d.layout, at.x, at.y);
      if (a === null || b === null || d.view.kind === "donut") return;
      this.#applyRange(d, a, b);
      this.#pointerAt(e.clientX, e.clientY, e.timeStamp);
      return;
    }
    this.#activate(d, clientPoint(e), true);
  }

  #activate(d: Committed & { readonly ready: true }, at: Point, mouse: boolean): void {
    if (this.#range && d.view.kind !== "donut" && d.layout.kind === "plot") {
      const p = this.#plotPoint(
          d as Committed & { readonly layout: { readonly kind: "plot" } },
          at,
        ),
        pr = d.layout.plot;
      const x = positionAt(d.layout, p.x, p.y);
      if (x === null || p.x < pr.x || p.x > pr.x + pr.width || p.y < pr.y || p.y > pr.y + pr.height)
        return;
      if (this.#range.s === null) {
        this.#range.s = x;
        this.#markRange(d);
        return;
      }
      this.#applyRange(d, this.#range.s, x);
      return;
    }
    const target = this.#pick(d, at);
    this.#pointer = mouse ? at : null;
    this.#rest = null;
    this.#pinPage = 0;
    if (!target) {
      this.#shown = mouse ? NO_HOVER : this.#idle();
      this.#redraw();
      return;
    }
    const primary = d.lookup.primary(target),
      ref = primary && this.#resolveAligned(d, target, primary);
    if (!mouse && ref && this.#shown.k === S_PIN && sameRef(ref, this.#shown.r)) {
      this.#dismissPin();
      return;
    }
    this.#dismissed = null;
    if (ref && presentationFor(d) !== "none") {
      this.#shown = { k: S_PIN, r: ref, t: target };
      this.#listenPin();
    } else this.#showHover(target);
    if (mouse && this.#proxy) {
      this.#clickFocus = true;
      try {
        focusQuiet(this.#proxy);
      } finally {
        this.#clickFocus = false;
      }
    }
    if (ref) {
      this.#focus = ref;
      this.#writeProxy(true);
      if (!mouse && d.tooltip && d.readoutMode === "none")
        this.#figure.announce(this.#proxy!.getAttribute("aria-valuetext")!, this.#proxyLang);
      this.#actions.select(ref);
    }
    this.#redraw(2);
  }

  #dismissPin(): void {
    this.#endPin();
    this.#redraw();
  }

  #endPin(): void {
    if (this.#shown.k !== S_PIN) return;
    this.#pinPage = 0;
    if (this.#pointer && plotReady(this.#committed)) this.#showHover(this.#underPointer());
    else this.#shown = this.#idle();
  }

  #onScroll(): void {
    this.#clearGeo();
    const d = this.#committed;
    if (!plotReady(d)) return;
    if ((this.#shown.k | 1) === S_HELD && this.#pointer) {
      this.#rest = null;
      this.#pointTo(this.#pick(d, this.#pointer));
    } else if (!this.#tooltip?.visible) return;
    this.#redraw();
  }

  #closeTable(restore = true): void {
    if (!this.#tableView) return;
    const inside = this.#tableView.element.contains(this.#active());
    this.#tableView.destroy();
    this.#tableView = this.#tableModel = null;
    this.#clearGeo();
    this.#root.classList.remove("axylo-table-open");
    this.#plot.inert = false;
    if (inside && restore && !this.#toolbar?.focus("table")) this.#restorePlotFocus(true);
  }

  #renderTable(d: ControlsState): void {
    const model = d.reader.table;
    if (!this.#tableView || !model) return;
    if (model !== this.#tableModel) {
      this.#tableModel = model;
      const { messages: m, formatters: f } = d,
        qual = ` (${fill(m.incompleteStack, {})})`,
        qualLang = d.english("incompleteStack");
      this.#tableView.update(
        model,
        {
          previousPage: m.previousPage,
          nextPage: m.nextPage,
          pageOf: (page, count) => fill(m.pageOf, { page: f.count(page), count: f.count(count) }),
          jump: fill(m.jumpToX, { x: model.headers[0] ?? "" }),
          notFound: (tx) => fill(m.jumpNotFound, { x: tx, example: model.row(0)?.[0] ?? "" }),
          notFoundLang: d.english("jumpNotFound"),
          lang: (k) => d.english(k),
          cell: (tx) => {
            const l = missingLang(d, tx);
            return l !== undefined
              ? [{ text: tx, lang: l }]
              : qualLang && tx.endsWith(qual)
                ? [
                    { text: tx.slice(0, -qual.length), lang: null },
                    { text: qual, lang: qualLang },
                  ]
                : [{ text: tx, lang: null }];
          },
        },
        0,
      );
    }
    if (this.#tableView.element.parentNode !== this.#figure.stage)
      this.#figure.stage.appendChild(this.#tableView.element);
  }

  activateControl(action: string): void {
    switch (action) {
      case "zoomIn":
        this.#changeWindow(1 / ZOOM_FACTOR, false);
        break;
      case "zoomOut":
        this.#changeWindow(ZOOM_FACTOR, false);
        break;
      case "panLeft":
        this.#changeWindow(-0.5, true);
        break;
      case "panRight":
        this.#changeWindow(0.5, true);
        break;
      case "resetZoom":
        this.#requestZoom(null);
        break;
      case "selectRange":
        if (this.#range) this.#endRange();
        else {
          this.#startInteraction();
          this.#range = { s: null };
          if (this.#controlsState) this.#renderControls(this.#controlsState);
        }
        break;
      case "pause":
      case "resume":
        this.#actions.pause(action === "pause");
        break;
      case "table":
        if (this.#tableView) this.#closeTable();
        else if (this.#controlsState?.reader.table) {
          this.#tableView = createTableView(this.#doc, this.#figure.id, (raw) =>
            resolveJumpTarget(this.#controlsState, raw),
          );
          this.#root.classList.add("axylo-table-open");
          this.#plot.inert = true;
          this.#pointer = this.#rest = this.#tableModel = null;
          this.#pinPage = 0;
          this.#shown = NONE;
          this.#dropView();
          this.#clearGeo();
          this.#renderTable(this.#controlsState);
          this.#tableView.focus();
        }
        if (this.#controlsState) this.#renderControls(this.#controlsState);
        break;
      default:
        if (action.startsWith("series:")) this.#actions.toggle(action.slice(7));
    }
  }

  #removeLegend(): void {
    if (!this.#legendList) return;
    this.#markLegend(null);
    this.#parts.sliceList?.(this.#doc, null, this.#actions, this.#legendList);
  }

  #renderControls(d: ControlsState, measure = false): boolean {
    this.#controlsState = d;
    const inputs = controlScratch ?? [];
    controlScratch = undefined;
    let spare: unknown[] | null = inputs,
      controls: number;
    try {
      let closer = false;
      if (canZoom(d) && d.ready) {
        const w = d.zoomed ? d.view.xDomain : d.view.xFull;
        if (this.#zoomCheckView !== d.view || this.#zoomCheckWindow !== w) {
          this.#zoomCheckView = d.view;
          this.#zoomCheckWindow = w;
          this.#zoomCheckResult = canZoomIn(d.view, w);
        }
        closer = this.#zoomCheckResult;
      } else this.#zoomCheckView = null;
      controls = collectControlInputs(
        d,
        inputs,
        this.#tableView !== null,
        this.#range !== null,
        closer,
        this.#parts.swatch,
      );
      if (sameKey(this.#lastControls, inputs)) return false;
      spare = this.#lastControls;
      this.#lastControls = inputs;
    } finally {
      if (spare) {
        spare.length = 0;
        controlScratch ??= spare;
      }
    }
    const before = measure ? this.#figure.controlsSignature() : "";
    this.#controlNodes = null;
    this.#clearGeo();

    const prevAct = this.#legendList && this.#active();
    const inLegend = this.#legendList !== null && this.#legendList.contains(prevAct);
    const sliceKey = inLegend
      ? ((prevAct as HTMLElement).parentElement?.dataset.key ?? null)
      : null;
    const nextList = this.#parts.sliceList?.(this.#doc, d, this.#actions, this.#legendList) ?? null;
    if (!nextList && this.#legendList) this.#removeLegend();
    this.#legendList = nextList;
    if (inLegend && !this.#legendList?.contains(this.#active())) {
      this.#handoffSliceKey = d.ready ? sliceKey : null;
      this.#focusFigure();
    }

    const items = buildControlItems(
      d,
      controls,
      this.#parts.swatch,
      this.#range !== null,
      this.#tableView?.element.id ?? null,
    );
    const inToolbar = this.#toolbar?.element.contains(this.#active());
    if (items.length || this.#toolbar)
      (this.#toolbar ??= createToolbar(this.#doc, this)).render(
        items,
        d.messages.controlsLabel,
        d.english("controlsLabel"),
      );
    const legend: Element[] = [];
    if (this.#legendList) legend.push(this.#legendList);
    if (items.length && this.#toolbar) legend.push(this.#toolbar.element);
    const slot = d.legend === "top" ? "top" : d.legend === "right" ? "side" : "controls";
    if (this.#tableView) {
      if (controls & INSPECT) this.#renderTable(d);
      else this.#closeTable();
    }
    const act = this.#active();
    this.#figure.placeControls(slot, legend);
    for (const s of CONTROL_SLOTS) if (s !== slot) this.#figure.placeControls(s, NO_CONTROLS);
    this.#markLegend(this.#focusedSlice());
    if (isFocusable(act) && act !== this.#active() && act.isConnected) focusQuiet(act);
    else if (inToolbar && !items.length) this.#focusFigure();
    return measure && this.#figure.controlsSignature() !== before;
  }

  #placeProxy(d: Committed, hasData: boolean): void {
    const proxy = this.#proxy,
      ring = this.#ring;
    if (!proxy || !ring) return;
    const ready = plotReady(d),
      usable = ready || recoverable(d);
    if (usable !== this.#proxyUsable) {
      this.#proxyUsable = usable;
      if (!usable && this.#active() === proxy && !this.#toolbar?.focus("table"))
        this.#focusFigure();
      for (const n of [proxy, ring, this.#instructions])
        if (n && n.hidden === usable) n.hidden = !usable;
    }
    if (!usable) {
      this.#proxyKey = null;
      return;
    }
    const p = plotBox(d),
      r = this.#proxyRect;
    if (!r || r.x !== p.x || r.y !== p.y || r.width !== p.width || r.height !== p.height)
      proxy.style.cssText = ring.style.cssText = boxStyle(p.x, p.y, p.width, p.height);
    this.#proxyRect = p;
    const count = instructionSeries(d, hasData),
      lang = readingLangFor(d, hasData, this.#single);
    const zoomInstructions = ready && offersZoom(d),
      donut = d.view.kind === "donut";
    const key = [
      d.kind,
      d.messages,
      d.zoom,
      ready,
      zoomInstructions,
      d.pageLang,
      count,
      lang,
      count ? d.english("plotInstructions") : null,
      count > 1 ? d.english("seriesInstructions") : null,
      count && donut ? d.english("donutInstructions") : null,
      zoomInstructions ? d.english("zoomInstructions") : null,
    ];
    if (sameKey(this.#proxyKey, key)) return;
    this.#proxyKey = key;
    setAttr(proxy, "aria-label", d.messages.plotLabel);
    setLanguageText(
      this.#label!,
      d.messages.plotLabel,
      d.english("plotLabel") ?? (ENGLISH_TAG.test(d.pageLang!) ? null : d.pageLang),
    );
    if (this.#instructions) {
      const desc = descriptionFor(d, count);
      renderInstructions(this.#doc, this.#instructions, desc, lang, d.pageLang);
      setAttr(proxy, "aria-describedby", desc.length ? this.#instructions.id : null);
    }
    setAttr(
      proxy,
      "aria-roledescription",
      fill(d.messages.plotRole, { type: chartTypeName(d.messages, d.kind) }),
    );
    this.#plot.classList.toggle("axylo-touch-zoom", d.zoom === "touch");
    this.#plot.classList.toggle("axylo-zoomable", d.zoom !== false);
  }

  #dropHold(d: Committed, allowPick = true) {
    this.#rest = null;
    if (allowPick && this.#pointer) this.#pointTo(this.#pick(d, this.#pointer));
    else this.#shown = this.#idle();
  }
  #resetCore() {
    this.#single = false;
    this.#dismissed = this.#shownText = this.#focus = this.#rest = null;
    this.#pinPage = 0;
  }

  #reconcile(previous: Committed | null, next: Committed): void {
    const { lookup } = next;
    if (previous && previous.epoch !== next.epoch) {
      this.#resetCore();
      this.#lastHover = null;
      if (this.#shown.k !== S_KEY && this.#shown.k !== S_SYNC)
        this.#shown = this.#pointer ? NO_HOVER : this.#idle();
    } else if (previous) {
      const map = categoryRemapper(previous.view, next.view);
      if (map) {
        this.#focus = map(this.#focus);
        if (this.#shownText) {
          const moved = map(this.#shownText.r, true);
          this.#shownText = moved ? { ...this.#shownText, r: moved } : null;
        }
        if (!this.#focus) this.#single = false;
        this.#lastHover = map(this.#lastHover);
        if (this.#dismissed) {
          const kept = this.#dismissed.flatMap((id) => remapTarget(id, map) ?? []);
          this.#dismissed = kept.length ? kept : null;
        }
        if (this.#shown.k === S_PIN) {
          const mt = remapTarget(this.#shown.t, map),
            r = map(this.#shown.r, true);
          this.#shown = mt && r ? { k: S_PIN, r, t: mt } : NO_HOVER;
        } else if (this.#shown.k === S_HELD) {
          const mt = remapTarget(this.#shown.t, map);
          this.#shown = mt ? { ...this.#shown, t: mt } : NO_HOVER;
        }
      }
    }
    if (this.#focus) {
      const res = lookup.resolve(this.#focus);
      this.#focus = res;
      if (!res) this.#single = false;
      else if (!this.#single && res.kind === "aligned")
        this.#focus = lookup.primary({ kind: "x", x: res.x }) ?? res;
    }
    if (!this.#focus && this.#proxyFocused && plotReady(next) && readable(next))
      this.#focus = firstDatum(next);

    const pres = presentationFor(next),
      s = this.#shown;
    if (!plotReady(next)) {
      if (s.k === S_SYNC) s.s = null;
      else if (s.k !== S_KEY) this.#shown = this.#pointer ? NO_HOVER : this.#idle();
      this.#pinPage = 0;
      return;
    }
    if (s.k === S_SYNC) s.s = s.f(next.view, next.lookup, next.layout);
    else if (s.k === S_PIN) {
      const kept = pres === "none" ? null : stillPinned(next, s.r, s.t);
      if (kept) this.#shown = { k: S_PIN, ...kept };
      else {
        this.#endPin();
        if (this.#shown.k === S_HOVER && this.#pointer)
          this.#pointTo(this.#pick(next, this.#pointer));
      }
    } else if (s.k === S_HELD) {
      const pt = this.#pick(next, s.q);
      if (
        pres !== s.p ||
        !sameTarget(pt, s.t) ||
        (pt!.kind === "x" && !sameRef(lookup.primary(pt!), this.#lastHover)) ||
        !sameRect(this.#anchorOf(next, pt!), s.a) ||
        !lookup.tooltip(pt!).rows.length
      )
        this.#dropHold(next, !this.#down?.d);
    } else if (s.k === S_HOVER && this.#pointer && !this.#down?.d) {
      const before = s.t,
        now = this.#pointTo(this.#pick(next, this.#pointer));
      const moved =
        now !== null &&
        this.#content !== null &&
        sameTarget(this.#content.t, now) &&
        !sameRect(this.#anchorOf(next, now), this.#content.a);
      if (!sameTarget(before, now) || moved)
        this.#rest = { ...this.#pointer, t: this.#win()?.performance.now() ?? 0, g: now };
    }
  }

  commit(next: Committed | null): void {
    if (this.#destroyed) return;
    this.#clearGeo();
    const prev = this.#committed;
    this.#pendingWindow = undefined;
    if (!next?.interactive) {
      this.#reset();
      this.#committed = next;
      return;
    }
    if (prev?.layout !== next.layout || prev.theme !== next.theme) this.#tooltip?.invalidateSize();
    if (this.#swatches && prev?.view !== next.view) this.#swatches.length = 0;
    this.#overlayInput = null;
    this.#committed = next;
    this.#dirty = true;
    this.#build();
    if (this.#range && !(plotReady(next) && next.zoom && next.view.kind !== "donut")) {
      this.#range = null;
      if (this.#selection && !this.#down?.d) this.#selection.hidden = true;
    } else if (this.#range && !this.#down?.d) this.#markRange(next);
    if (
      this.#shown.k !== S_NONE ||
      this.#proxyFocused ||
      this.#focus ||
      this.#pointer ||
      this.#dismissed
    )
      this.#reconcile(prev, next);
    const hasData = plotReady(next) && readable(next);
    this.#placeProxy(next, hasData);
    this.#writeProxy(false, hasData);
    this.#renderControls(next);
    const handoff = this.#handoffSliceKey;
    this.#handoffSliceKey = null;
    const list = this.#legendList,
      leavingList = list?.dataset.roving === "false";
    if (leavingList || handoff !== null) {
      const act = this.#active();
      const sliceKey =
        leavingList && list.contains(act)
          ? (act as HTMLElement).parentElement?.dataset.key
          : handoff !== null && act === this.#root
            ? handoff
            : undefined;
      if (sliceKey !== undefined && plotReady(next)) {
        this.#focus = next.lookup.resolve({ kind: "slice", sliceKey }) ?? firstDatum(next);
        if (this.#tableView) this.#tableView.focus();
        else this.#restorePlotFocus(true);
      }
    }
    if (
      this.#shown.k !== S_NONE ||
      this.#proxyFocused ||
      this.#lastPres ||
      this.#lastHover ||
      this.#overlayVisible ||
      this.#pinListeners
    )
      this.#present();
    if (
      this.#shown.k === S_HELD &&
      (!this.#content || !sameRect(this.#content.b, this.#shown.b)) &&
      plotReady(next)
    ) {
      this.#dropHold(next);
      this.#redraw();
    }
  }

  prepare(state: ControlsState): boolean {
    if (this.#destroyed) return false;
    this.#clearGeo();
    const nextPres = presentationFor(state),
      strip = nextPres === "strip",
      readoutChanged = this.#root.classList.contains("axylo-readout-mode") !== strip;
    if (
      !state.interactive &&
      !this.#proxy &&
      !this.#committed &&
      !this.#controlsState &&
      !readoutChanged
    )
      return false;
    let controlsChanged: boolean;
    if (!state.interactive) {
      const before = this.#figure.controlsSignature();
      this.#reset();
      this.#committed = this.#controlsState = null;
      controlsChanged = this.#figure.controlsSignature() !== before;
    } else {
      this.#build();
      controlsChanged = this.#renderControls(state, true);
    }
    if (readoutChanged) {
      this.#root.classList.toggle("axylo-readout-mode", strip);
      this.#dropView(this.#shown.k !== S_PIN || nextPres === "none");
      if (this.#shown.k === S_HELD) this.#shown = this.#pointer ? NO_HOVER : this.#idle();
      this.#rest = this.#pointer
        ? { ...this.#pointer, t: this.#win()?.performance.now() ?? 0, g: this.#pointerTarget() }
        : null;
    }
    return readoutChanged || controlsChanged;
  }

  #reset(): void {
    const remote = this.#shown.k === S_SYNC;
    this.#clearGeo();
    setAttr(this.#root, "data-axylo-sync", null);
    this.#swatches = this.#hoverState = this.#hoverModel = this.#overlayInput = null;
    this.#unlistenPin();
    if (this.#committed) this.#draw(this.#committed, null);
    this.#shown = NONE;
    if (
      !this.#lastPres &&
      !this.#proxy &&
      !this.#tooltip?.visible &&
      !this.#legendList &&
      !this.#tableView &&
      !this.#lastHover
    )
      return;
    this.#lastPres = null;
    const act = this.#active(),
      owned = isElement(act) && act !== this.#root && this.#root.contains(act);
    this.#hideTooltip();
    if (this.#proxy) {
      this.#cancelGestures();
      this.#closeTable(false);
      this.#unlistenAttached();
      this.#built?.clear();
      this.#built = null;
      this.#bindStartup("removeEventListener");
      this.#listenStage = this.#startupListener = this.#pointerMoveListener = null;
      this.#interacted = false;
      this.#listenerFlags = 0;

      for (const n of [this.#proxy, this.#instructions, this.#label, this.#ring, this.#selection])
        n?.remove();
      this.#removeLegend();
      this.#toolbar?.destroy();
      this.#proxy =
        this.#instructions =
        this.#label =
        this.#ring =
        this.#selection =
        this.#legendList =
        this.#legendMarked =
        this.#proxyRect =
        this.#toolbar =
        this.#lastControls =
        this.#controlNodes =
        this.#proxyUsable =
        this.#proxyKey =
        this.#idleProxyState =
        this.#zoomCheckView =
        this.#zoomCheckWindow =
          null;
      this.#idlePosition = this.#idleMax = this.#idleEmpty = "";
      this.#proxyLang = this.#idleCount = this.#countFormatter = this.#positionTemplate = undefined;
      this.#clearGeo();
      this.#figure.clearControls();
      this.#plot.classList.remove("axylo-touch-zoom", "axylo-zoomable");
      const after = this.#active();
      if (owned && (!after || after === this.#doc.body || !this.#root.contains(after)))
        this.#focusFigure();
    }
    this.#resetCore();
    this.#tooltipContent =
      this.#touches =
      this.#handoffSliceKey =
      this.#content =
      this.#range =
      this.#pointer =
        null;
    this.#proxyFocused = this.#fromClick = this.#keyed = false;
    if (!remote) this.#hover(null);
  }

  clear(): void {
    this.#reset();
    this.#committed = this.#controlsState = null;
  }

  sync(f: SyncResolve | null, o: object): void {
    const s = this.#shown;
    if (
      f
        ? (s.k === S_NONE || s.k === S_SYNC) && !this.#proxyFocused && !this.#tableView
        : s.k === S_SYNC && s.o === o
    ) {
      const d = this.#committed;
      this.#shown = f
        ? { k: S_SYNC, s: plotReady(d) ? f(d.view, d.lookup, d.layout) : null, f, o }
        : NONE;
      this.#present(f ? 0 : 3);
    }
  }

  attach(): void {
    if (this.#attached || this.#destroyed) return;
    this.#attached = true;
    this.#clearGeo();
    registerFigure(this.#doc, this.#root);
    this.#joinTree();
    if (this.#interacted) this.#listenDocument();
  }

  detach(): void {
    if (!this.#attached) return;
    this.#attached = false;
    this.#clearGeo();
    this.#cancelGestures();
    this.#endPin();
    this.#dropView();
    unregisterFigure(this.#doc, this.#root);
    this.#unlistenAttached();
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#reset();
    unregisterFigure(this.#doc, this.#root);
    this.#tooltip?.destroy();
    this.#tooltip = this.#tooltipContent = this.#committed = this.#controlsState = null;
    this.#destroyed = true;
    this.#stopPinch();
  }
}

export function createInteraction(
  parts: InteractionParts,
  figure: Figure,
  renderer: MarkRenderer,
  actions: Actions,
): Interaction {
  return new DomInteraction(parts, figure, renderer, actions);
}
