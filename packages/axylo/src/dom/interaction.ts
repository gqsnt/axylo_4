/**
 * Everything a reader uses to explore a full chart (decision 0001; spec I1–I6, A2–A4, A7): pointer, touch,
 * keyboard, tooltip, overlay, toolbar, table and zoom gestures.
 */
import type {
  AlignedView, DatumRef, DatumText, Formatters, Layout, Lookup, Mark, MarkRenderer, Overlay, PaintBindings, PickTarget, ReaderModel,
  Rect, ResolvedTheme, StepDirection, TooltipModel, View, XValue,
} from '../core/contracts';
import { sameKey } from '../core/axes';
import type { Messages } from '../public';
import { chartTypeName, defaultMessages, fill, messageLanguage } from '../messages';
import {
  overlayWith, OUTLINE_REACH, RING_REACH, RING_STROKE, alignedRows, alignedTargetMarks, canZoomIn, datumReading, minimumWidth, panWindow,
  pinchWidth, pixelOf, positionAt, rangeWindow, refsAt, ringRect, sameRef, stepAcross, zoomStep, targetBox, targetOf, valueText, PAN_SHARE, ZOOM_FACTOR,
  positionText, type Mode, type OverlayInput, type TargetMarks,
} from '../core/focus';
import type { Figure } from './figure';
import { createTableView, type TableView } from './table';
import { rovingIndex, createToolbar, type Toolbar, type ToolbarItem } from './toolbar';
import { createTooltip, type Presentation, type TooltipContent, type TooltipView } from './tooltip';
import { createSwatch, swatchPattern, type SwatchPattern, type SwatchSpec } from './swatch';
import type { AlignedHoverLookup, AlignedHoverModel } from '../lookup/aligned';
import { firstSlotReading, sliceText } from '../lookup/text';
import { barPattern } from '../scene/bars';
import { readPosition } from '../reader/x';
import { printedX } from '../reader/table';
import { activeElementOf, isElement, isFocusable, placeChildren, setAttr, setText, make, keepFocusOnPress, hideFromAT, shadowRootOf, shadowRootsOf } from './attributes';
import { Listeners, listenOutside, mappingOf, rectToViewport, toLocal, toViewport, visibleRegion, type Mapping, type Point } from './mapping';
import { insideCorridor, intersect, type PlacementInput } from './placement';
import { identityOf, matchesIdentity, sameTarget, type Identity } from './pointer';

type Span = readonly [number, number];
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type MutablePlacement = Omit<Mutable<PlacementInput>, 'box'> & { box: Mutable<Rect> };
export type ReadoutMode = 'floating' | 'strip' | 'none';

export interface ControlsState {
  readonly kind: 'line' | 'area' | 'bar' | 'histogram' | 'scatter' | 'donut';
  readonly view: View;
  readonly formatters: Formatters;
  readonly messages: Messages;
  readonly reader: ReaderModel;
  readonly tooSmall: boolean;
  readonly ready: boolean;
  readonly inspectable?: boolean;
  readonly empty?: boolean;
  readonly message?: string | null;
  readonly interactive: boolean;
  readonly tooltip: boolean;
  readonly legend: false | 'top' | 'right' | 'bottom';
  readonly zoom: false | true | 'touch';
  readonly zoomed: boolean;
  readonly streaming: boolean;
  readonly paused: boolean;
  readonly epoch: number;
  english(key: keyof Messages): string | null;
  readonly pageLang: string | null;
  readonly readout?: boolean | ReadoutMode;
  readonly readoutMode?: ReadoutMode;
}

export interface Committed extends ControlsState {
  readonly layout: Layout;
  readonly lookup: Lookup;
  readonly bindings: PaintBindings;
  readonly theme: ResolvedTheme;
  readonly pixelRatio: number;
}

export interface Actions {
  zoom(window: Span | null): void;
  toggle(seriesKey: string): void;
  pause(paused: boolean): void;
  select(ref: DatumRef): void;
  hover(ref: DatumRef | null): void;
}

export interface Interaction {
  prepare(state: ControlsState): boolean;
  commit(state: Committed | null): void;
  clear(): void;
  attach(): void;
  detach(): void;
  destroy(): void;
}

type InstructionKey = 'plotInstructions' | 'donutInstructions' | 'seriesInstructions' | 'zoomInstructions';
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
const focusQuiet = (el: HTMLElement) => el.focus({ preventScroll: true });
function focusFig(fig: Element | null): void {
  if (!isFocusable(fig)) return;
  if (!fig.hasAttribute('tabindex')) fig.setAttribute('tabindex', '-1');
  focusQuiet(fig);
}
function setClass(el: Element, cls: string, on: boolean): boolean {
  if (el.classList.contains(cls) === on) return false;
  el.classList.toggle(cls, on);
  return true;
}
const padRect = (x: number, y: number, w: number, h: number, ox: number, oy = ox): Rect =>
  ({ x: x - ox, y: y - oy, width: Math.max(0, w + 2 * ox), height: Math.max(0, h + 2 * oy) });
function plotCoordinate(value: number, offset: number, scale: number, start: number, extent: number): number {
  const pixel = (value - offset) / scale, edge = offset + start * scale;
  return value >= edge - 1 && value <= edge + extent * scale + 1 ? clamp(pixel, start, start + extent) : pixel;
}
const isAligned = (v: View): v is AlignedView => v.kind !== 'scatter' && v.kind !== 'donut';
const offersZoom = (d: ControlsState): d is ControlsState & { readonly zoom: true | 'touch'; readonly tooSmall: false; readonly view: Exclude<View, { kind: 'donut' }> } =>
  d.zoom !== false && !d.tooSmall && d.view.kind !== 'donut';
const plotReady = (d: Committed | null): d is Committed & { readonly ready: true } => d !== null && d.ready && d.layout.kind === 'plot';
const readable = (d: Committed) => d.view.kind === 'donut' || d.view.visible.some(Boolean);
const canInspect = (d: ControlsState) => Boolean(d.reader.table && (d.ready || d.inspectable));
const plotBox = (d: Committed): Rect => d.layout.kind === 'plot' ? d.layout.plot : { x: 0, y: 0, width: d.layout.width, height: d.layout.height };
const horizontalBars = (d: Committed) => d.layout.kind === 'plot' && d.layout.projection.kind === 'bands' && d.layout.projection.horizontal;
const boxStyle = (r: Rect) => `left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px`;
const missingLang = (d: ControlsState, t: string) =>
  t === d.messages.noData ? d.english('noData') : t === d.messages.noObservation ? d.english('noObservation') : undefined;
function posScale(d: Committed) {
  const p = d.layout.kind === 'plot' ? d.layout.projection : null;
  return p?.kind === 'xy' ? p.x : p?.kind === 'bands' ? p.band : null;
}

function instructionSeries(d: Committed, hasData = plotReady(d) && readable(d)): number {
  if (!d.interactive || !hasData || d.lookup.count === 0) return 0;
  const { view } = d;
  if (view.kind === 'donut') return 1;
  if (view.visible.length <= 1) return 1;
  let count = 0;
  for (let i = 0; i < view.visible.length; i++) {
    if (view.visible[i] && (view.kind !== 'scatter' || view.visiblePoints[i]!.end > view.visiblePoints[i]!.start) && ++count === 2) return count;
  }
  return 1;
}

export function plotDescription(d: Committed): { text: string; lang: string | null }[] {
  return descriptionFor(d, instructionSeries(d));
}

function descriptionFor(d: Committed, count: number): { text: string; lang: string | null }[] {
  if (!d.interactive || !plotReady(d)) return [];
  const { messages, view } = d, legacy = messageLanguage(messages, 'plotInstructions') === null;
  const out: { text: string; lang: string | null }[] = [];
  const add = (key: InstructionKey, fb?: 'plotInstructions') => {
    if (legacy && messageLanguage(messages, key) !== null) { if (!fb) return; key = fb; }
    const text = messages[key] ?? defaultMessages[key];
    if (text) out.push({ text, lang: d.english(key) });
  };
  if (count > 0) {
    if (view.kind === 'donut') add('donutInstructions', 'plotInstructions');
    else {
      add('plotInstructions');
      if (count > 1) add('seriesInstructions');
    }
  }
  if (offersZoom(d)) add('zoomInstructions');
  return out;
}

export function readoutOf(state: ControlsState): ReadoutMode {
  const r = state.readoutMode ?? state.readout;
  return r === 'floating' || r === 'strip' || r === 'none' ? r : r === true ? 'strip' : 'floating';
}

const presentationFor = (s: ControlsState): Presentation | 'none' => !s.interactive || !s.tooltip || s.tooSmall ? 'none' : readoutOf(s);

export function seriesPattern(index: number): SwatchPattern['kind'] | null {
  const p = barPattern(index, false);
  return p === 'none' ? null : p;
}

export type SeriesSwatch = (index: number, cue: SwatchSpec['cue'], hollow: boolean) => SwatchSpec;
export const barSwatch: SeriesSwatch = (color, cue, hollow) => {
  const p = seriesPattern(color);
  return { color, cue, line: false, hollow, fill: true, pattern: p && swatchPattern(p) };
};
export const areaSwatch: SeriesSwatch = (color, cue, hollow) => ({ color, cue, line: false, hollow, fill: true, marker: true, pattern: null });
export const lineSwatch: SeriesSwatch = (color, cue, hollow) => ({ color, cue, line: true, hollow });
export const pointSwatch: SeriesSwatch = (color, cue, hollow) => ({ color, cue, line: false, hollow });

export function seriesSwatch(kind: ControlsState['kind'], index: number, cue: SwatchSpec['cue'], hollow: boolean): SwatchSpec {
  return (kind === 'bar' || kind === 'histogram' ? barSwatch : kind === 'area' ? areaSwatch : kind === 'line' ? lineSwatch : pointSwatch)(index, cue, hollow);
}

export type SliceList = (doc: Document, d: ControlsState, actions: Actions, list: HTMLUListElement | null) => HTMLUListElement | null;

export interface InteractionParts {
  readonly overlay: TargetMarks;
  readonly swatch: SeriesSwatch;
  readonly stepInSeries: ((view: Extract<View, { kind: 'scatter' }>, ref: DatumRef, direction: StepDirection) => DatumRef | null) | null;
  readonly sliceList: SliceList | null;
}

type SliceEntry = { li: HTMLLIElement; c: HTMLButtonElement; n: HTMLElement; v: HTMLElement; s: string };
const sliceLists = new WeakMap<HTMLUListElement, { e: Map<string, SliceEntry>; l: Listeners }>();
const CHOICE = '.axylo-legend-choice';
const sliceButtons = (ul: Element) => [...ul.querySelectorAll<HTMLButtonElement>(CHOICE)];
const setTab = (bs: HTMLButtonElement[], idx: number) => bs.forEach((b, i) => { const t = i === idx ? 0 : -1; if (b.tabIndex !== t) b.tabIndex = t; });

function showsSlices(d: ControlsState): d is ControlsState & { readonly view: Extract<View, { kind: 'donut' }> } {
  const { view } = d;
  return view.kind === 'donut' && !!d.legend && !d.tooSmall && !!(d.ready || d.inspectable || (view.slices.length > 0 && view.total === 0));
}

export const donutSliceList: SliceList = (doc, d, actions, list) => {
  if (!showsSlices(d)) return null;
  const { view } = d;
  if (!list) {
    const own = list = doc.createElement('ul'), l = new Listeners();
    sliceLists.set(own, { e: new Map(), l });
    const choice = (ev: Event) => (ev.target as Element | null)?.closest?.(CHOICE);
    l.on(own, 'mousedown', ev => { if (choice(ev)) keepFocusOnPress(ev); });
    l.on(own, 'click', ev => { const k = choice(ev)?.parentElement?.dataset.key; if (k !== undefined) actions.select({ kind: 'slice', sliceKey: k }); });
    l.on(own, 'keydown', ev => {
      if (own.dataset.roving !== 'true') return;
      const bs = sliceButtons(own), to = rovingIndex(ev, Math.max(0, bs.indexOf(activeElementOf(doc, own) as HTMLButtonElement)), bs.length);
      if (to === null) return;
      ev.preventDefault();
      setTab(bs, to);
      bs[to]!.focus();
    });
    l.on(own, 'focusin', ev => {
      if (own.dataset.roving !== 'true') return;
      const bs = sliceButtons(own);
      setTab(bs, bs.indexOf(ev.target as HTMLButtonElement));
    });
  }
  if (list.className !== 'axylo-legend-list') list.className = 'axylo-legend-list';
  let st = sliceLists.get(list);
  if (!st) sliceLists.set(list, st = { e: new Map(), l: new Listeners() });
  const kept = st.e, noDataLang = d.english('noData'), wanted: HTMLLIElement[] = [], buttons: HTMLButtonElement[] = [], live = new Set<string>();
  for (const sl of view.slices) {
    live.add(sl.key);
    let en = kept.get(sl.key);
    if (!en) {
      const li = doc.createElement('li'), c = make(doc, 'button', 'axylo-legend-choice');
      li.dataset.key = sl.key; c.type = 'button'; c.tabIndex = -1; li.append(c);
      kept.set(sl.key, en = { li, c, n: make(doc, 'span', 'axylo-legend-name'), v: make(doc, 'span', 'axylo-legend-value'), s: '' });
    }
    const datum = sliceText(view, sl, d.formatters), sig = `${sl.colorIndex}:${sl.angles === null}`;
    if (sig !== en.s) {
      en.c.replaceChildren(createSwatch(doc, { color: sl.colorIndex, cue: null, line: false, hollow: sl.angles === null }), en.n, en.v);
      en.s = sig;
    }
    setText(en.n, sl.label);
    const pct = datum?.percent;
    setText(en.v, datum ? (pct && pct !== datum.value ? `${datum.value} (${pct})` : datum.value) : '');
    setAttr(en.v, 'lang', datum?.value === d.messages.noData ? noDataLang : null);
    wanted.push(en.li);
    buttons.push(en.c);
  }
  for (const k of kept.keys()) if (!live.has(k)) kept.delete(k);
  const had = activeElementOf(doc, list);
  const prev = isFocusable(had) && list.contains(had) ? sliceButtons(list) : null;
  const hadAt = prev ? prev.indexOf(had as HTMLButtonElement) : -1;
  placeChildren(list, wanted);
  if (prev) {
    if (had!.isConnected) { if (activeElementOf(doc, list) !== had) focusQuiet(had as HTMLElement); }
    else if (buttons.length) {
      let heir: HTMLButtonElement | undefined;
      for (let i = hadAt + 1; i < prev.length && !heir; i++) if (prev[i]!.isConnected) heir = prev[i];
      for (let i = hadAt - 1; i >= 0 && !heir; i--) if (prev[i]!.isConnected) heir = prev[i];
      focusQuiet(heir ?? buttons[clamp(hadAt, 0, buttons.length - 1)]!);
    } else focusFig(list.closest('.axylo-figure'));
  }
  const roving = !d.ready;
  if (list.dataset.roving !== String(roving)) list.dataset.roving = String(roving);
  let at = buttons.indexOf(activeElementOf(doc, list) as HTMLButtonElement);
  if (at < 0) at = buttons.findIndex(b => b.tabIndex === 0);
  setTab(buttons, roving ? Math.max(0, at) : -1);
  return list;
};

const NAVIGATION: Readonly<Record<string, StepDirection>> = {
  ArrowRight: 'next', ArrowLeft: 'previous', Home: 'first', End: 'last', PageUp: 'page-next', PageDown: 'page-previous',
};
const DRAG_THRESHOLD = 4, REST_DISTANCE = 2, REST_TIME = 250, TAP_DISTANCE = 10, TAP_TIME = 500, PAGE_ROWS = 8, FOCUS_OUTLINE = 3, HOLE_CLEARANCE = 5;

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
let controlScratch: unknown[] | undefined;

const sameWindow = (a: Span | null, b: Span | null) => a === b || (a !== null && b !== null && a[0] === b[0] && a[1] === b[1]);
const sameRect = (a: Rect | null, b: Rect | null) => a === null || b === null ? a === b
  : Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.width - b.width) < 0.01 && Math.abs(a.height - b.height) < 0.01;
const categoriesOf = (v: View) => isAligned(v) && v.frame.x.kind === 'category' ? v.frame.x.categories : null;
const xKindOf = (v: View) => v.kind === 'donut' ? 'category' : v.kind === 'scatter' ? v.frame.xKind : v.frame.x.kind;

const BIDI = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;
const normalized = (s: string) => s.normalize('NFKC').replace(BIDI, '').replace(/[\s\u00a0\u202f]+/gu, ' ').trim().toLowerCase();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function parseNumberAs(text: string, format: (n: number) => string, count: (n: number) => string): number | null {
  const digits = new Map<string, string>();
  for (let d = 0; d < 10; d++) { const w = count(d); if ([...w].length === 1) digits.set(w, String(d)); }
  const ascii = (s: string) => [...s.replace(BIDI, '')].map(ch => digits.get(ch) ?? ch).join('');
  const m = /^(\D*)(\d.*\d|\d)(\D*)$/u.exec(ascii(format(1234.5)));
  if (!m) return null;
  const pre = m[1]!.trim(), core = m[2]!, suf = m[3]!.trim();
  const marks = [...core.replace(/\d/g, '')];
  const dec = marks.length > 1 || (marks.length === 1 && /\D\d$/u.test(core)) ? marks.at(-1)! : '.';
  const grp = [...ascii(count(1234567)).replace(/\d/g, '')][0] ?? '';
  let body = ascii(text).trim();
  if (pre && body.startsWith(pre)) body = body.slice(pre.length).trim();
  if (suf && body.endsWith(suf)) body = body.slice(0, -suf.length).trim();
  const neg = /^[-−‒–]/u.exec(body);
  if (neg) body = body.slice(neg[0].length);
  const [ip = '', fp, extra] = body.split(dec);
  if (extra !== undefined || !ip) return null;
  const id = grp ? ip.replace(new RegExp(/^[\s\u00a0\u202f]$/u.test(grp) ? '[\\s\\u00a0\\u202f]' : escapeRe(grp), 'gu'), '') : ip;
  if (!/^\d+$/.test(id) || (fp !== undefined && !/^\d+$/.test(fp))) return null;
  if (id !== ip && normalized(ip) !== normalized(ascii(count(Number(id))))) return null;
  const v = Number(`${neg ? '-' : ''}${id}${fp !== undefined ? `.${fp}` : ''}`);
  return Number.isFinite(v) ? v : null;
}

let lastShowing: WeakMap<Document, HTMLElement[]> | undefined;
let liveFigures: WeakMap<Document, Set<HTMLElement>> | undefined;

function focusedFigure(doc: Document, own: HTMLElement): Element | null {
  const act = activeElementOf(doc, own);
  const inOwn = isElement(act) ? act.closest('.axylo-figure') : null;
  if (inOwn) return inOwn;
  for (const fig of liveFigures?.get(doc) ?? []) {
    if (fig === own) continue;
    const inner = shadowRootOf(fig)?.activeElement ?? null;
    if (isElement(inner) && fig.contains(inner)) return fig;
  }
  return null;
}

const recoverable = <T extends ControlsState>(d: T | null): d is T & { readonly zoomed: true } =>
  d !== null && !d.ready && d.empty === true && d.zoom !== false && d.zoomed && !d.tooSmall;
const canZoom = (d: ControlsState): d is ControlsState & { readonly zoom: true | 'touch'; readonly tooSmall: false; readonly view: Exclude<View, { kind: 'donut' }> } =>
  offersZoom(d) && (d.ready || recoverable(d));
const clientPoint = (e: MouseEvent): Point => ({ x: e.clientX, y: e.clientY });

class DomInteraction implements Interaction {
  private readonly root: HTMLElement;
  private readonly doc: Document;
  private readonly plot: HTMLElement;
  private tooltip: TooltipView | null = null;
  private tooltipContent: Mutable<TooltipContent> | null = null;
  private hoverModel: AlignedHoverModel | null = null;
  private overlayInput: Mutable<OverlayInput> | null = null;

  // Cached per-frame/scroll/resize geometry (Stage 2/3 invariant).
  private geoPlot: Mapping | null = null;
  private geoFigure: Mapping | null = null;
  private geoVisible: Rect | null = null;
  private geoReadout: Rect | null = null;
  private geoControls: readonly Rect[] | null = null;
  private controlNodes: readonly HTMLElement[] | null = null;
  private geoPlacement: MutablePlacement | null = null;
  private committed: Committed | null = null;
  private controlsState: ControlsState | null = null;
  private lastControls: unknown[] | null = null;
  private focus: DatumRef | null = null;
  private single = false;
  private shown: Shown = NONE;
  private pointer: Mutable<Point> | null = null;
  private hoverState: { k: 2; t: PickTarget | null } | null = null;
  private rest: { x: number; y: number; t: number; g: PickTarget | null } | null = null;
  private content: Content | null = null;
  private dismissed: Identity[] | null = null;
  private pinPage = 0;
  private range: { s: number | null } | null = null;
  private proxyFocused = false;
  private keyed = false;
  private clickFocus = false;
  private fromClick = false;
  private shownOrdinal = 0;
  private shownText: { r: DatumRef; s: boolean; d: string | null } | null = null;
  private lastHover: DatumRef | null = null;
  private lastPres: [PickTarget | null, DatumRef | null, DatumRef | null, boolean, boolean, number, Presentation | 'none'] | null = null;
  private dirty = true;
  private overlayVisible = false;
  private pendingWindow: Span | null | undefined = undefined;
  private tableView: TableView | null = null;
  private tableModel: unknown = null;
  private down: { id: number; x: number; y: number; d: boolean } | null = null;
  private touches: Map<number, { x: number; y: number; x0: number; y0: number; t0: number }> | null = null;
  private pinch: { ids: readonly [number, number]; d: number; w: Span; c: number } | null = null;
  private pinched = false;
  private pinchFrame = 0;
  private pinchWindow: Span | null | undefined = undefined;
  private destroyed = false;
  private attached = true;
  private listenStage: HTMLElement | null = null;
  private proxyFocusListener: (() => void) | null = null;
  private proxyInputListener: (() => void) | null = null;
  private pointerMoveListener: ((e: PointerEvent) => void) | null = null;
  private pointerDownListener: ((e: PointerEvent) => void) | null = null;
  private built: Listeners | null = null;
  private docListeners: Listeners | null = null;
  private pinListeners: Listeners | null = null;
  private shadowScrollListeners: Listeners | null = null;
  private interacted = false;
  private focusListeners = false;
  private moveListeners = false;
  private downListeners = false;
  private proxy: HTMLInputElement | null = null;
  private ring: HTMLElement | null = null;
  private proxyRect: Rect | null = null;
  private instructions: HTMLElement | null = null;
  private selection: HTMLElement | null = null;
  private legendList: HTMLUListElement | null = null;
  private toolbar: Toolbar | null = null;
  private legendMarked: HTMLElement | null = null;
  private proxyUsable: boolean | null = null;
  private proxyInstructionState: Committed | null = null;
  private proxyInstructionCount = 0;
  private proxyInstructionLang: string | null = null;
  private plotInstructionLang: string | null = null;
  private seriesInstructionLang: string | null = null;
  private donutInstructionLang: string | null = null;
  private zoomInstructionLang: string | null = null;
  private idleProxyState: Committed | null = null;
  private idleHasData = false;
  private idleEmpty = '';
  private proxyLang: string | null | undefined = undefined;
  private idleCount: number | undefined = undefined;
  private idlePosition = '';
  private idleMax = '';
  private countFormatter: Formatters['count'] | undefined = undefined;
  private positionTemplate: string | undefined = undefined;
  private zoomCheckView: View | null = null;
  private zoomCheckWindow: Span | null = null;
  private zoomCheckResult = false;
  private swatches: SwatchSpec[] | null = null;

  constructor(
    private readonly parts: InteractionParts,
    private readonly figure: Figure,
    private readonly renderer: MarkRenderer,
    private readonly actions: Actions,
  ) {
    this.root = figure.figure;
    this.doc = this.root.ownerDocument;
    this.plot = figure.plot;
    this.registerFigure();
  }

  private win(): Window | null { return this.doc.defaultView; }

  private activeElement(): Element | null { return activeElementOf(this.doc, this.root); }

  private getTooltip(): TooltipView {
    return this.tooltip ??= createTooltip(this.figure.tooltip, this.figure.readout, this.root, () => {
      if (this.proxy && !this.proxy.hidden) focusQuiet(this.proxy); else this.focusFigure();
    });
  }

  private clearGeo() { this.geoPlot = this.geoFigure = this.geoVisible = this.geoReadout = this.geoControls = this.geoPlacement = null; }

  private mode(): Mode { return this.single ? 'single' : 'all'; }

  private focusFigure() { return focusFig(this.root); }

  private pointerTarget(): PickTarget | null { return 't' in this.shown ? this.shown.t : null; }

  private idle(): Shown { return this.proxyFocused && !this.fromClick ? KEY : NONE; }

  private draw(d: Committed, o: Overlay | null) {
    if (!o && !this.overlayVisible) return;
    this.overlayVisible = o !== null;
    this.renderer.drawOverlay(o, d.bindings, d.theme, d.pixelRatio);
  }

  private registerFigure(): void {
    const figures = liveFigures ??= new WeakMap();
    let set = figures.get(this.doc);
    if (!set) figures.set(this.doc, set = new Set());
    set.add(this.root);
  }

  private unregisterFigure(): void {
    const figures = liveFigures?.get(this.doc);
    if (figures?.delete(this.root) && !figures.size) liveFigures!.delete(this.doc);
  }

  private listenDocument(): void {
    if (this.docListeners || !this.attached || !this.proxy) return;
    const l = this.docListeners = new Listeners(), w = this.win();
    const clearRects = this.clearControlRects.bind(this);
    l.on(w, 'keydown', this.onEscape.bind(this), true);
    l.on(this.doc, 'scroll', this.onScroll.bind(this), { capture: true, passive: true });
    l.on(w, 'resize', this.clearGeo.bind(this), { passive: true });
    l.on(w, 'blur', this.cancelGestures.bind(this));
    l.on(this.root, 'focusin', clearRects);
    l.on(this.root, 'focusout', clearRects);
  }

  private listenShadowScroll(): void {
    if (this.shadowScrollListeners || !this.attached || !this.proxy) return;
    const shadow = shadowRootOf(this.root);
    if (!shadow) return;
    // Scroll events inside a shadow tree do not reach the document listener.
    const l = this.shadowScrollListeners = new Listeners();
    const options = { capture: true, passive: true };
    const scroll = this.onScroll.bind(this);
    for (let current: ShadowRoot | null = shadow; current; current = shadowRootOf(current.host)) {
      l.on(current, 'scroll', scroll, options);
    }
  }

  private clearControlRects(): void { this.geoControls = null; }

  private startInteraction(): void {
    if (this.interacted) return;
    this.interacted = true;
    this.clearGeo();
    this.listenDocument();
  }

  private unlistenAttached(): void {
    this.docListeners?.clear();
    this.shadowScrollListeners?.clear();
    this.docListeners = this.shadowScrollListeners = null;
  }

  private unlistenPin() { this.pinListeners?.clear(); this.pinListeners = null; }

  private listenPin(): void {
    if (this.pinListeners || !this.attached) return;
    const l = this.pinListeners = new Listeners();
    listenOutside(this.doc, shadowRootsOf(this.root), 'pointerdown', [this.plot, this.figure.tooltip, this.figure.readout], () => { this.endPin(); this.redraw(); }, l);
  }

  private build(): void {
    if (this.proxy) return;
    const proxy = this.proxy = make(this.doc, 'input', 'axylo-proxy');
    proxy.type = 'range'; proxy.id = `${this.figure.id}-proxy`; proxy.min = '0'; proxy.step = '1';
    // These fixed registrations bootstrap the event groups without a per-chart listener list.
    proxy.addEventListener('focus', this.proxyFocusListener = this.onProxyFocus.bind(this));
    const input = this.proxyInputListener = this.onProxyInput.bind(this);
    proxy.addEventListener('input', input);
    proxy.addEventListener('change', input);
    this.ring = make(this.doc, 'div', 'axylo-focus-ring');
    hideFromAT(this.ring);
    this.instructions = make(this.doc, 'span', 'axylo-visually-hidden');
    this.instructions.id = `${this.figure.id}-i`;
    this.plot.append(proxy, this.ring, this.instructions);
    const stage = this.listenStage = this.figure.stage;
    stage.addEventListener('pointermove', this.pointerMoveListener = this.onPointerMove.bind(this));
    this.plot.addEventListener('pointerdown', this.pointerDownListener = this.onPointerDown.bind(this));
    this.listenShadowScroll();
  }

  private stopPinch(apply = false): void {
    this.pinch = null;
    if (this.pinchFrame) { this.win()?.cancelAnimationFrame(this.pinchFrame); this.pinchFrame = 0; }
    const w = this.pinchWindow; this.pinchWindow = undefined;
    if (apply && w !== undefined) this.requestZoom(w);
  }

  private cancelGestures(): void { this.endDrag(); this.touches?.clear(); this.pinched = false; this.stopPinch(); }

  private focusOwned() { const a = this.activeElement(); return isElement(a) && a !== this.root && this.root.contains(a); }

  private unbuild(ownedBefore = false): void {
    if (!this.proxy) return;
    const owned = ownedBefore || this.focusOwned();
    this.cancelGestures(); this.closeTable(false); this.unlistenAttached();
    this.built?.clear(); this.built = null;
    this.proxy.removeEventListener('focus', this.proxyFocusListener!);
    this.proxy.removeEventListener('input', this.proxyInputListener!);
    this.proxy.removeEventListener('change', this.proxyInputListener!);
    this.listenStage!.removeEventListener('pointermove', this.pointerMoveListener!);
    this.plot.removeEventListener('pointerdown', this.pointerDownListener!);
    this.listenStage = this.proxyFocusListener = this.proxyInputListener = this.pointerMoveListener = this.pointerDownListener = null;
    this.interacted = this.focusListeners = this.moveListeners = this.downListeners = false;
    for (const n of [this.proxy, this.instructions, this.ring, this.selection]) n?.remove();
    this.removeLegend(); this.toolbar?.destroy();
    this.proxy = this.instructions = this.ring = this.selection = this.legendList = this.legendMarked = this.proxyRect = this.toolbar = this.lastControls = this.controlNodes = null;
    this.proxyUsable = this.proxyInstructionState = this.idleProxyState = this.zoomCheckView = this.zoomCheckWindow = null;
    this.proxyInstructionLang = this.plotInstructionLang = this.seriesInstructionLang = this.donutInstructionLang = this.zoomInstructionLang = null;
    this.idlePosition = this.idleMax = this.idleEmpty = '';
    this.proxyLang = this.idleCount = this.countFormatter = this.positionTemplate = undefined;
    this.clearGeo(); this.figure.clearControls();
    this.plot.classList.remove('axylo-touch-zoom', 'axylo-zoomable');
    const after = this.activeElement();
    if (owned && (!after || after === this.doc.body || !this.root.contains(after))) this.focusFigure();
  }

  private firstDatum(d: Committed): DatumRef | null {
    if (!isAligned(d.view)) return d.lookup.step(null, 'first');
    const x = stepAcross(d.view, null, 'first');
    return x === null ? null : d.lookup.primary({ kind: 'x', x });
  }

  private resolveAligned(d: Committed, t: PickTarget) { return this.single && this.focus?.kind === 'aligned' && t.kind === 'x' ? d.lookup.resolve({ kind: 'aligned', seriesKey: this.focus.seriesKey, x: t.x }) ?? d.lookup.primary(t) : d.lookup.primary(t); }

  private takeover(d: Committed): void {
    const t = this.pointerTarget();
    if (!t) { this.focus ??= this.firstDatum(d); return; }
    if (this.shown.k === S_PIN) this.focus = this.shown.r;
    else if (this.single && this.focus?.kind === 'aligned' && t.kind === 'x') this.focus = this.resolveAligned(d, t);
    else this.focus = d.lookup.primary(t) ?? this.focus ?? this.firstDatum(d);
  }

  private pointGroup(d: Committed, ref: DatumRef, b: Rect): PickTarget {
    const picked = d.lookup.pick(b.x + b.width / 2, b.y + b.height / 2);
    return picked?.kind === 'point' && d.lookup.has(picked, ref) ? picked : targetOf(ref);
  }

  private keyboardTarget(d: Committed, ref: DatumRef): PickTarget {
    if (ref.kind === 'point' && d.view.kind === 'scatter') { const b = d.lookup.anchor(ref); if (b) return this.pointGroup(d, ref, b); }
    return targetOf(ref);
  }

  private shownTarget(): PickTarget | null { return this.shown.k === S_KEY ? (this.proxyFocused && this.focus && this.committed ? this.keyboardTarget(this.committed, this.focus) : null) : this.pointerTarget(); }

  private swatchFor(row: DatumText): SwatchSpec {
    const { view } = this.committed!, i = row.seriesIndex;
    const swatches = this.swatches ??= [];
    return swatches[i] ??= view.kind === 'donut'
      ? { color: view.slices[i]?.colorIndex ?? null, cue: null, line: false, hollow: false }
      : this.parts.swatch(i, view.cues[i] ?? null, false);
  }

  private plotMapping() { return this.geoPlot ??= mappingOf(this.plot); }

  private figureMapping() { return this.geoFigure ??= mappingOf(this.root); }

  private visiblePlot() { return this.geoVisible ??= visibleRegion(this.plot, true, this.figure.tooltip); }

  private visibleReadout() { return this.geoReadout ??= visibleRegion(this.figure.readout, false); }

  private controlRects(m: Mapping): readonly Rect[] {
    if (this.geoControls) return this.geoControls;
    const out: Rect[] = [], w = this.win();
    this.controlNodes ??= Array.from(this.root.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex],.axylo-legend-list>li'))
      .filter(el => el !== this.proxy && el !== this.root && !this.figure.tooltip.contains(el) && !this.figure.readout.contains(el));
    for (const el of this.controlNodes) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const st = w?.getComputedStyle?.(el);
      const painted = st && st.outlineStyle !== 'none' ? (parseFloat(st.outlineWidth) || 0) + Math.max(0, parseFloat(st.outlineOffset) || 0) : 0;
      const reach = Math.max(FOCUS_OUTLINE, painted);
      out.push(padRect(r.left, r.top, r.width, r.height, reach * m.kx, reach * m.ky));
    }
    return this.geoControls = out;
  }

  private pick(d: Committed, at: Point): PickTarget | null {
    if (d.layout.kind !== 'plot') return null;
    const m = this.plotMapping(), b = d.layout.plot;
    return d.lookup.pick(plotCoordinate(at.x, m.left, m.kx, b.x, b.width), plotCoordinate(at.y, m.top, m.ky, b.y, b.height));
  }

  private zoomBounds(d: Committed): Span {
    if (d.view.kind === 'donut') return [0, 0];
    if (!d.zoomed) { const s = posScale(d); if (s && s.type !== 'band') return [Math.min(...s.domain), Math.max(...s.domain)]; }
    return d.view.xFull;
  }

  private markBox(d: Committed, target: PickTarget, soleRef?: DatumRef): Rect | null {
    const box = soleRef ? d.lookup.anchor(soleRef) : targetBox(d.view, d.lookup, target, null);
    if (box || target.kind !== 'x' || d.layout.kind !== 'plot') return box;
    const s = posScale(d), at = s ? (s.type === 'band' ? s.center(target.x) : s.map(target.x)) : NaN;
    if (!Number.isFinite(at)) return null;
    const pr = d.layout.plot;
    return horizontalBars(d) ? { x: pr.x + pr.width / 2, y: at, width: 0, height: 0 } : { x: at, y: pr.y + pr.height / 2, width: 0, height: 0 };
  }

  private anchorOf(d: Committed, t: PickTarget) { const b = this.markBox(d, t); return b ? rectToViewport(this.plotMapping(), b) : null; }

  private pinnedModel(d: Committed, target: PickTarget, offset: number): TooltipModel {
    const { lookup, view, formatters } = d, m = lookup.tooltip(target);
    if (offset <= 0 || offset >= m.count) return m;
    if (target.kind === 'x' && isAligned(view)) return { ...m, rows: alignedRows(view, formatters, target.x, m).slice(offset, offset + PAGE_ROWS) };
    if (target.kind === 'point') {
      const refs = lookup.members(target, offset, PAGE_ROWS);
      if (refs.length) return { ...lookup.tooltip({ kind: 'point', refs, count: target.count }), title: m.title, count: m.count };
    }
    return m;
  }

  private clock() { return this.win()?.performance.now() ?? 0; }

  private noteShowing(promote: boolean): void {
    const showing = lastShowing ??= new WeakMap();
    let list = showing.get(this.doc);
    if (!list) showing.set(this.doc, list = []);
    if (list.at(-1) === this.root) return;
    const i = list.indexOf(this.root);
    if (promote) { if (i >= 0) list.splice(i, 1); list.push(this.root); } else if (i < 0) list.unshift(this.root);
  }

  private releaseShowing(): void {
    const list = lastShowing?.get(this.doc);
    if (!list) return;
    const i = list.indexOf(this.root);
    if (i >= 0) list.splice(i, 1);
    if (!list.length) lastShowing!.delete(this.doc);
  }

  private isLastShowing(): boolean { return lastShowing?.get(this.doc)?.at(-1) === this.root; }

  private hideTooltip() { this.tooltip?.hide(); this.releaseShowing(); }

  private dropView(hide = true) { if (hide) { this.unlistenPin(); this.hideTooltip(); } this.content = this.lastPres = null; }

  private redraw(rec: 0 | 1 | 2 = 0) { this.dirty = true; this.present(rec); }

  private present(rec: 0 | 1 | 2 = 0): void {
    const d = this.committed;
    if (!plotReady(d) || !this.proxy || (this.shown.k === S_NONE && !this.proxyFocused)) {
      if (d) this.draw(d, null);
      this.dropView();
      this.hover(null); return;
    }
    const { view, layout, lookup } = d;
    const target = this.shownTarget(), visibleRing = this.proxyFocused && (this.keyed || this.proxy.matches(':focus-visible')) ? this.focus : null;
    const only = this.single && this.shown.k === S_KEY ? this.focus : null, pres = presentationFor(d), pinned = this.shown.k === S_PIN;
    const showTip = pres !== 'none' && target !== null && !this.isDismissed(target), page = pinned ? this.pinPage : 0;
    if (!this.dirty && this.lastPres && sameTarget(target, this.lastPres[0]) && sameRef(visibleRing, this.lastPres[1]) &&
      sameRef(only, this.lastPres[2]) && showTip === this.lastPres[3] && pinned === this.lastPres[4] && page === this.lastPres[5] && pres === this.lastPres[6]) return;
    if (!this.lastPres) this.lastPres = [target, visibleRing, only, showTip, pinned, page, pres];
    else {
      this.lastPres[0] = target; this.lastPres[1] = visibleRing; this.lastPres[2] = only;
      this.lastPres[3] = showTip; this.lastPres[4] = pinned; this.lastPres[5] = page; this.lastPres[6] = pres;
    }
    this.dirty = false;
    if (pinned) this.listenPin(); else this.unlistenPin();
    const prev = this.content; this.content = null;
    if (pinned && !showTip) { this.endPin(); this.redraw(); return; }
    const readHover = showTip && this.shown.k === S_HOVER && pres === 'floating' && target.kind === 'x'
      ? (lookup as AlignedHoverLookup).alignedHover : undefined;
    let model: TooltipModel | null;
    if (readHover && target?.kind === 'x') {
      model = this.hoverModel = readHover.call(lookup, target, this.hoverModel);
    } else {
      model = showTip ? (pinned ? this.pinnedModel(d, target, this.pinPage) : lookup.tooltip(target)) : null;
    }
    const soleRef = target?.kind === 'x' && model?.count === 1 ? model.rows[0]?.ref : undefined;
    const input = this.overlayInput ??= { view, layout, lookup, target, ring: visibleRing, only };
    input.target = target; input.ring = visibleRing; input.only = only;
    let overlay: Overlay | null;
    if (readHover && soleRef && !visibleRing && layout.kind === 'plot' && layout.projection.kind === 'xy' &&
        this.parts.overlay === alignedTargetMarks) {
      // Reuse the tooltip's ref for the cursor and hover event. The renderer still gets a snapshot.
      const clipped: Mark[] = [];
      input.only = soleRef;
      alignedTargetMarks(input, layout.plot, clipped, NO_UNCLIPPED_MARKS);
      overlay = clipped.length ? { clip: layout.plot, clipped, unclipped: NO_UNCLIPPED_MARKS } : null;
    } else {
      overlay = overlayWith(this.parts.overlay, input);
    }
    if (model?.rows.length && target && pres !== 'none') {
      const tc = this.tooltipContent ??= {
        model, swatch: this.swatchFor.bind(this),
        moreRows: n => fill(this.committed!.messages.moreRows, { count: this.committed!.formatters.count(n) }),
        valueLang: t => missingLang(this.committed!, t) ?? null,
        select: row => this.actions.select(row.ref),
        more: n => {
          if (this.shown.k !== S_PIN) return;
          const next = this.pinPage + Math.max(1, n);
          this.pinPage = next >= this.tooltipContent!.model.count ? 0 : next;
          this.redraw();
        },
      };
      tc.model = model;
      if (model.total !== null) {
        tc.totalLabel = d.messages.total;
        tc.totalLang = d.english('total');
      }
      if (model.count > 1) tc.moreLang = d.english('moreRows');
      const marks = this.markBox(d, target, soleRef), map = this.plotMapping(), anchor = marks ? rectToViewport(map, marks) : null;
      const bounds = pres === 'strip' ? this.visibleReadout() : this.placementFor(d, marks, visibleRing, map);
      const figureMap = pres === 'strip' ? undefined : this.figureMapping();
      // When the tooltip needs a layout read, measure after both sets of writes.
      this.draw(d, overlay);
      const tip = this.getTooltip();
      const placed = 'box' in bounds ? tip.show(tc, bounds, pinned, figureMap) : tip.strip(tc, pinned, bounds);
      const rect = placed ? tip.rect() : null;
      if (rect) {
        this.noteShowing(rec === 2 || (rec === 0 && (!prev || !sameTarget(prev.t, target) || prev.pin !== pinned || prev.pg !== page)));
        this.content = { t: target, b: rect, a: anchor, p: pres, pin: pinned, pg: page };
      } else this.releaseShowing();
    } else {
      this.hideTooltip();
      this.draw(d, overlay);
    }
    if (pinned && !this.content) { this.endPin(); this.redraw(); return; }
    this.hover(!target ? null : this.shown.k === S_KEY ? this.focus : this.shown.k === S_PIN ? this.shown.r : soleRef ?? lookup.primary(target));
  }

  private placementFor(d: Committed, box: Rect | null, keyboardRing: DatumRef | null, m: Mapping): PlacementInput {
    const { layout, lookup } = d, area = plotBox(d);
    // The padded datum box in viewport pixels, as rectToViewport(m, padRect(...)) computes it, in one object.
    const bx = box ? box.x : area.x + area.width / 2, by = box ? box.y : area.y + area.height / 2;
    const controls = this.controlRects(m);
    const rb = keyboardRing ? ringRect(layout, lookup, keyboardRing) : null;
    const rings = rb ? [rectToViewport(m, rb)] : NO_RINGS;
    const x = m.left + (bx - RING_REACH) * m.kx, y = m.top + (by - RING_REACH) * m.ky;
    const width = Math.max(0, (box ? box.width : 0) + 2 * RING_REACH) * m.kx;
    const height = Math.max(0, (box ? box.height : 0) + 2 * RING_REACH) * m.ky;
    if (!this.geoPlacement) {
      const pr = padRect(area.x, area.y, area.width, area.height, -OUTLINE_REACH);
      let hole: PlacementInput['hole'] = null;
      if (layout.kind === 'plot' && layout.projection.kind === 'ring' && layout.projection.r0 > HOLE_CLEARANCE) {
        const { cx, cy, r0 } = layout.projection, ctr = toViewport(m, { x: cx, y: cy });
        hole = { cx: ctr.x, cy: ctr.y, rx: (r0 - HOLE_CLEARANCE) * m.kx, ry: (r0 - HOLE_CLEARANCE) * m.ky };
      }
      return this.geoPlacement = {
        box: { x, y, width, height }, visible: intersect(rectToViewport(m, pr), this.visiblePlot()),
        order: horizontalBars(d) ? 'horizontal' : 'vertical', hole, controls, rings, ringStroke: RING_STROKE * Math.max(m.kx, m.ky),
      };
    }
    const datumBox = this.geoPlacement.box;
    datumBox.x = x; datumBox.y = y; datumBox.width = width; datumBox.height = height;
    this.geoPlacement.controls = controls; this.geoPlacement.rings = rings;
    return this.geoPlacement;
  }

  private hover(ref: DatumRef | null): void { if (!sameRef(ref, this.lastHover)) { this.lastHover = ref; this.actions.hover(ref); } }

  private markLegend(sliceKey: string | null): void {
    if (this.legendMarked) {
      if (this.legendMarked.dataset.key === sliceKey && this.legendMarked.parentNode === this.legendList) return;
      this.legendMarked.classList.remove('axylo-legend-current');
      this.legendMarked = this.geoControls = null;
    }
    if (sliceKey !== null && this.legendList) {
      for (const child of this.legendList.children) {
        const li = child as HTMLElement;
        if (li.dataset.key !== sliceKey) continue;
        li.classList.add('axylo-legend-current');
        this.legendMarked = li; this.geoControls = null;
        break;
      }
    }
  }

  private markFocusedSlice(d: Committed | null): void {
    this.markLegend(plotReady(d) && this.proxyFocused && this.focus?.kind === 'slice' ? this.focus.sliceKey : null);
  }

  private readingLang(d: Committed, hasData: boolean) { return d.english( !hasData ? 'empty' : d.view.kind === 'donut' || (!this.single && d.view.kind !== 'scatter') ? 'pointAll' : 'pointOf', ); }

  private writeIdleAligned(el: HTMLInputElement, d: Committed, view: AlignedView): void {
    const { lookup, messages, formatters } = d;
    const count = lookup.count;
    if (this.idleCount !== count || this.countFormatter !== formatters.count || this.positionTemplate !== messages.position) {
      this.idleCount = count; this.countFormatter = formatters.count; this.positionTemplate = messages.position;
      this.idlePosition = positionText(messages, formatters, 0, count);
      this.idleMax = String(count - 1);
    }
    if (el.max !== this.idleMax) el.max = this.idleMax;
    if (el.value !== '0') el.value = '0';
    setAttr(el, 'aria-valuetext', firstSlotReading(view, formatters, messages, this.idlePosition));
    this.shownOrdinal = 0;
    this.shownText = null;
  }

  private writeProxy(acted: boolean, readyData?: boolean): void {
    const d = this.committed;
    if (!this.proxy || !d) return;
    const { view, lookup, formatters, messages } = d;
    if (view.kind === 'donut' || this.legendMarked) this.markFocusedSlice(d);
    const hasData = readyData ?? (plotReady(d) && readable(d)), lang = this.readingLang(d, hasData);
    const empty = hasData ? messages.noData : recoverable(d) || plotReady(d) ? messages.empty : d.message ?? messages.noData;
    const inactive = !acted && !this.proxyFocused && !this.focus;
    if (inactive) {
      const previous = this.idleProxyState;
      this.idleProxyState = d;
      if (previous && this.idleHasData === hasData && (!hasData || (previous.lookup === lookup && previous.view === view)) &&
          previous.formatters === formatters && previous.messages === messages && this.proxyLang === lang && this.idleEmpty === empty) return;
      this.idleHasData = hasData;
      this.idleEmpty = empty;
    } else this.idleProxyState = null;
    if (this.proxyLang !== lang) { setAttr(this.proxy, 'lang', lang); this.proxyLang = lang; }
    if (inactive && hasData && !this.single && lookup.count > 0 && (lookup as AlignedHoverLookup).alignedHover && isAligned(view)) {
      this.writeIdleAligned(this.proxy, d, view);
      return;
    }
    const ref = hasData ? this.focus ?? this.firstDatum(d) : null;
    if (!ref) {
      if (this.proxy.max !== '0') this.proxy.max = '0';
      if (this.proxy.value !== '0') this.proxy.value = '0';
      this.shownOrdinal = 0;
      setAttr(this.proxy, 'aria-valuetext', empty);
      this.shownText = null;
      return;
    }
    const max = String(Math.max(0, lookup.count - 1)), ord = Math.max(0, lookup.ordinal(ref)), os = String(ord);
    if (this.proxy.max !== max) this.proxy.max = max;
    if (this.proxy.value !== os) this.proxy.value = os;
    if (inactive) {
      // Position changes need no announcement suppression when the range has no focus.
      setAttr(this.proxy, 'aria-valuetext', valueText(view, lookup, ref, this.mode(), formatters, messages) ?? messages.noData);
      this.shownText = null;
    } else {
      const reading = datumReading(view, lookup, ref, this.mode(), formatters, messages);
      if (acted || !this.shownText || !sameRef(ref, this.shownText.r) || this.single !== this.shownText.s || reading !== this.shownText.d || !this.proxy.hasAttribute('aria-valuetext')) {
        setAttr(this.proxy, 'aria-valuetext', valueText(view, lookup, ref, this.mode(), formatters, messages) ?? messages.noData);
        this.shownText = { r: ref, s: this.single, d: reading };
      }
    }
    this.shownOrdinal = ord;
  }

  private stepFrom(d: Committed, from: DatumRef, dir: StepDirection): DatumRef | null {
    if (!this.single && from.kind === 'aligned' && isAligned(d.view)) {
      const x = stepAcross(d.view, from.x, dir);
      return x === null ? null : d.lookup.primary({ kind: 'x', x });
    }
    if (this.single && from.kind === 'point' && d.view.kind === 'scatter' && this.parts.stepInSeries) return this.parts.stepInSeries(d.view, from, dir);
    return d.lookup.step(from, dir);
  }

  private keyboardLeads(d: Committed): void { this.shown = KEY; this.pinPage = 0; this.rest = null; if (this.focus) this.reached(this.keyboardTarget(d, this.focus)); }

  private move(dir: StepDirection): void {
    const d = this.committed;
    if (!plotReady(d)) return;
    this.takeover(d);
    const from = this.focus;
    if (this.focus) this.focus = this.stepFrom(d, this.focus, dir) ?? this.focus;
    const moved = !sameRef(from, this.focus);
    if (!moved && this.shown.k === S_PIN) return;
    this.keyboardLeads(d); this.writeProxy(moved); this.present();
  }

  private moveSeries(delta: 1 | -1): void {
    const d = this.committed;
    if (!plotReady(d)) return;
    this.takeover(d);
    if (!this.focus) return;
    const step = delta > 0 ? 'series-next' : 'series-previous';
    if (this.focus.kind === 'aligned' && isAligned(d.view)) {
      if (!this.single) { const refs = refsAt(d.view, this.focus.x), ref = delta > 0 ? refs[0] : refs.at(-1); if (ref) { this.focus = ref; this.single = true; } }
      else this.focus = d.lookup.step(this.focus, step) ?? this.focus;
    } else if (this.focus.kind === 'point') { this.focus = d.lookup.step(this.focus, step) ?? this.focus; this.single = true; }
    this.keyboardLeads(d); this.writeProxy(true); this.present();
  }

  private atOrdinal(d: Committed, ord: number): DatumRef | null {
    const { view, lookup } = d;
    if (isAligned(view)) {
      const { start, end } = view.visibleSlots, x = view.frame.x.values[start + clamp(ord, 0, Math.max(0, end - start - 1))];
      if (x === undefined) return null;
      return this.single && this.focus?.kind === 'aligned' ? lookup.resolve({ kind: 'aligned', seriesKey: this.focus.seriesKey, x }) : lookup.primary({ kind: 'x', x });
    }
    let ref = lookup.step(null, 'first');
    for (let i = 0; ref && i < ord && i < lookup.count; i++) { const next = lookup.step(ref, 'next'); if (!next) break; ref = next; }
    if (ref && this.single && this.focus && 'seriesKey' in this.focus && 'seriesKey' in ref && ref.seriesKey !== this.focus.seriesKey) this.single = false;
    return ref;
  }

  private onProxyKey(e: KeyboardEvent): void {
    const d = this.committed;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const { key } = e, consume = () => { e.preventDefault(); e.stopPropagation(); }, rec = recoverable(d);
    if (!rec && !plotReady(d)) return;
    if (!rec) this.fromClick = false;
    if (d!.zoom) {
      if (!rec && (key === '+' || key === '=')) { consume(); this.zoomBy(1 / ZOOM_FACTOR); return; }
      if (key === '-' || key === '_') { consume(); this.zoomBy(ZOOM_FACTOR); return; }
      if (key === '0') { consume(); this.requestZoom(null); return; }
    }
    if (e.shiftKey && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      if (rec) consume(); else e.preventDefault();
      if (d!.zoom) this.pan(key === 'ArrowRight' ? PAN_SHARE : -PAN_SHARE);
      return;
    }
    const upDown = key === 'ArrowUp' || key === 'ArrowDown';
    if (rec || !readable(d!)) { if (key in NAVIGATION || upDown || (!rec && (key === 'Enter' || key === ' '))) e.preventDefault(); return; }
    const ready = d as Committed & { readonly ready: true };
    if (upDown && ready.view.kind !== 'donut') { e.preventDefault(); this.moveSeries(key === 'ArrowDown' ? 1 : -1); return; }
    if (key === 'Enter' || key === ' ') { e.preventDefault(); this.focus ??= this.firstDatum(ready); if (this.focus) this.actions.select(this.focus); return; }
    if (key === 'Escape') {
      if (this.single) {
        consume(); this.single = false;
        if (this.focus?.kind === 'aligned') this.focus = ready.lookup.primary({ kind: 'x', x: this.focus.x }) ?? this.focus;
        this.writeProxy(true); this.present();
      }
      return;
    }
    const dir = NAVIGATION[key] ?? (ready.view.kind === 'donut' && upDown ? (key === 'ArrowUp' ? 'next' : 'previous') : undefined);
    if (dir) { e.preventDefault(); this.move(dir); }
  }

  private onProxyInput(): void {
    this.startInteraction();
    const d = this.committed;
    if (!this.proxy || !plotReady(d)) return;
    if (!readable(d)) { this.writeProxy(false); return; }
    const ord = Number(this.proxy.value);
    if (!Number.isFinite(ord) || ord === this.shownOrdinal) return;
    this.takeover(d); this.focus = this.atOrdinal(d, ord) ?? this.focus; this.keyboardLeads(d); this.writeProxy(true); this.present();
  }

  private onProxyFocus(): void {
    this.startInteraction();
    if (!this.focusListeners && this.proxy) {
      this.focusListeners = true;
      const l = this.built ??= new Listeners();
      l.on(this.proxy, 'keydown', ev => { this.onProxyKey(ev); if (ev.defaultPrevented && !this.keyed) this.setKeyed(true); });
      l.on(this.proxy, 'blur', this.onProxyBlur.bind(this));
      l.on(this.plot, 'wheel', this.onWheel.bind(this), { passive: false });
    }
    const d = this.committed; this.proxyFocused = true;
    if (!plotReady(d)) { this.writeProxy(true); return; }
    this.fromClick = this.clickFocus; this.takeover(d);
    if (!this.clickFocus) this.keyboardLeads(d);
    this.writeProxy(true); this.redraw();
  }

  private setKeyed(on: boolean) { this.keyed = on; this.proxy?.classList.toggle('axylo-keyed', on); this.redraw(); }

  private onProxyBlur(): void {
    this.proxyFocused = this.fromClick = this.keyed = false;
    this.proxy?.classList.remove('axylo-keyed');
    this.markLegend(null);
    if (this.shown.k === S_KEY) this.shown = this.pointer && this.committed ? { k: S_HOVER, t: plotReady(this.committed) ? this.pick(this.committed, this.pointer) : null } : NONE;
    this.redraw(1);
  }

  private currentWindow(d: Committed): Span | null { return d.view.kind === 'donut' ? null : this.pendingWindow !== undefined ? (this.pendingWindow ?? this.zoomBounds(d)) : d.zoomed ? d.view.xDomain : this.zoomBounds(d); }

  private requestZoom(w: Span | null): void {
    const d = this.committed;
    if (!d || d.view.kind === 'donut') return;
    if (sameWindow(this.pendingWindow !== undefined ? this.pendingWindow : d.zoomed ? d.view.xDomain : null, w)) return;
    this.pendingWindow = w; this.actions.zoom(w);
  }

  private zoomBy(factor: number, center?: number): boolean {
    const d = this.committed;
    if (!d || d.view.kind === 'donut' || !d.zoom) return false;
    const now = this.currentWindow(d)!, x = this.focus?.kind === 'aligned' || this.focus?.kind === 'point' ? this.focus.x : NaN;
    const next = zoomStep(this.zoomBounds(d), now, factor, center ?? (Number.isFinite(x) && x >= now[0] && x <= now[1] ? x : (now[0] + now[1]) / 2), minimumWidth(d.view));
    if (next === undefined) return false;
    this.requestZoom(next); return true;
  }

  private pan(share: number): void {
    const d = this.committed;
    if (!d || d.view.kind === 'donut' || !d.zoom) return;
    const next = panWindow(this.zoomBounds(d), this.currentWindow(d)!, share);
    if (next) this.requestZoom(next);
  }

  private onWheel(e: WheelEvent): void {
    const d = this.committed;
    if (!plotReady(d) || !d.zoom || !this.proxy || this.activeElement() !== this.proxy || e.ctrlKey || e.metaKey || !e.deltaY) return;
    const p = this.local(e), unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    if (this.zoomBy(clamp(Math.exp(e.deltaY * unit * 0.002), 0.25, 4), positionAt(d.layout, p.x, p.y) ?? undefined)) e.preventDefault();
  }

  private local(e: MouseEvent) { return toLocal(this.plotMapping(), clientPoint(e)); }

  private dismissedBy(id: Identity, t: PickTarget) { return matchesIdentity(id, t) || (id.kind === 'point' && t.kind === 'point' && this.committed !== null && this.committed.lookup.has(t, id.ref)); }

  private isDismissed(t: PickTarget) { return this.dismissed !== null && this.dismissed.some(id => this.dismissedBy(id, t)); }

  private reached(t: PickTarget | null): void { if (t && this.dismissed) { const kept = this.dismissed.filter(id => this.dismissedBy(id, t)); this.dismissed = kept.length ? kept : null; } }

  private pointTo(t: PickTarget | null): void {
    this.reached(t);
    const state = this.hoverState ??= { k: S_HOVER, t };
    state.t = t;
    this.shown = state;
  }

  private pointerAt(x: number, y: number, time: number): void {
    const d = this.committed;
    if (!plotReady(d)) return;
    const at = this.pointer ??= { x, y };
    at.x = x; at.y = y;
    if (this.shown.k === S_PIN) return;
    const still = this.rest !== null && dist(x, y, this.rest.x, this.rest.y) <= REST_DISTANCE;
    if (this.shown.k === S_HOVER && this.shown.t && this.rest?.g && time - this.rest.t >= REST_TIME &&
      sameTarget(this.rest.g, this.shown.t) && this.content && sameTarget(this.content.t, this.shown.t)) {
      this.shown = { k: S_HELD, t: this.shown.t, f: { x: this.rest.x, y: this.rest.y }, b: this.content.b, a: this.content.a, p: this.content.p };
    }
    if (this.shown.k === S_HELD) {
      if (insideCorridor(this.shown.f, this.shown.b, at)) { if (!still) this.rest = { x, y, t: time, g: this.shown.t }; this.present(); return; }
      this.shown = NO_HOVER;
    }
    const target = this.pick(d, at);
    this.pointTo(target);
    if (!this.rest) this.rest = { x, y, t: time, g: target };
    else if (!still || !sameTarget(this.rest.g, target)) { this.rest.x = x; this.rest.y = y; this.rest.t = time; this.rest.g = target; }
    this.present();
  }

  private onPointerMove(e: PointerEvent): void {
    this.startInteraction();
    if (!this.moveListeners && this.proxy) {
      this.moveListeners = true;
      (this.built ??= new Listeners()).on(this.figure.stage, 'pointerleave', this.onStageLeave.bind(this));
    }
    if (e.pointerType === 'touch') {
      const t = this.touches?.get(e.pointerId);
      if (t) { const at = this.local(e); t.x = at.x; t.y = at.y; if (this.pinch?.ids.includes(e.pointerId)) this.pinchMove(); }
      return;
    }
    if ((this.down && this.down.id !== e.pointerId) || this.tableView) return;
    if (this.down) {
      const at = this.local(e);
      if (!this.down.d && this.committed?.zoom && dist(at.x, at.y, this.down.x, this.down.y) > DRAG_THRESHOLD) {
        this.down.d = true;
        if (this.shown.k === S_PIN) { this.shown = NO_HOVER; this.pinPage = 0; }
        this.dropView();
      }
      if (this.down.d) { this.drawSelection(this.down, at); return; }
    }
    this.pointerAt(e.clientX, e.clientY, e.timeStamp);
  }

  private leave(): void { this.pointer = this.rest = null; if (this.shown.k === S_HOVER || this.shown.k === S_HELD) this.shown = this.idle(); this.present(); }

  private onStageLeave(e: PointerEvent): void { if (e.pointerType !== 'touch' && !this.down?.d) { this.clearGeo(); this.leave(); } }

  private drawSelection(from: Point, to: Point): void {
    const d = this.committed;
    if (d?.layout.kind !== 'plot') return;
    if (!this.selection) { this.selection = make(this.doc, 'div', 'axylo-selection'); hideFromAT(this.selection); this.plot.appendChild(this.selection); }
    const p = d.layout.plot;
    const span = (a: number, b: number, lo: number, ext: number): [number, number] => {
      const u = clamp(a, lo, lo + ext), v = clamp(b, lo, lo + ext);
      return [Math.min(u, v), Math.abs(v - u)];
    };
    const [x, width] = horizontalBars(d) ? [p.x, p.width] : span(from.x, to.x, p.x, p.width);
    const [y, height] = horizontalBars(d) ? span(from.y, to.y, p.y, p.height) : [p.y, p.height];
    this.selection.style.cssText = boxStyle({ x, y, width, height });
    this.selection.hidden = false;
  }

  private markRange(d: Committed): void {
    const px = this.range?.s == null ? null : pixelOf(d.layout, this.range.s);
    if (px === null) { if (this.selection && !this.down?.d) this.selection.hidden = true; return; }
    const at = horizontalBars(d) ? { x: 0, y: px } : { x: px, y: 0 };
    this.drawSelection({ x: at.x - 1, y: at.y - 1 }, { x: at.x + 1, y: at.y + 1 });
  }

  private endRange(): void { if (!this.range) return; this.range = null; if (this.selection && !this.down?.d) this.selection.hidden = true; if (this.controlsState) this.renderControls(this.controlsState); }

  private endDrag(): void {
    if (this.selection) this.selection.hidden = true;
    if (this.range && this.committed) this.markRange(this.committed);
    const was = this.down; this.down = null;
    if (was && this.plot.hasPointerCapture?.(was.id)) { try { this.plot.releasePointerCapture(was.id); } catch { /* released */ } }
  }

  private applyRange(d: Committed, a: number, b: number): void {
    const next = rangeWindow(this.zoomBounds(d), a, b, minimumWidth(d.view));
    this.endRange();
    if (next !== undefined) this.requestZoom(next);
  }

  private endTouch(id: number, apply: boolean): boolean {
    this.touches?.delete(id);
    if (this.pinch?.ids.includes(id)) this.stopPinch(apply);
    const wasPinch = this.pinched;
    if (!this.touches?.size) this.pinched = false;
    return wasPinch;
  }

  private onPointerDown(e: PointerEvent): void {
    this.startInteraction();
    if (!this.downListeners && this.proxy) {
      this.downListeners = true;
      const l = this.built ??= new Listeners();
      l.on(this.plot, 'pointerup', this.onPointerUp.bind(this));
      l.on(this.plot, 'pointercancel', this.onPointerCancel.bind(this));
      l.on(this.plot, 'lostpointercapture', ev => { if (this.down?.id === ev.pointerId) this.endDrag(); });
    }
    const d = this.committed;
    if (!plotReady(d)) return;
    if (this.keyed) this.setKeyed(false);
    const at = this.local(e);
    if (e.pointerType === 'touch') {
      const map = this.touches ??= new Map();
      map.set(e.pointerId, { x: at.x, y: at.y, x0: at.x, y0: at.y, t0: e.timeStamp });
      if (map.size === 2 && d.zoom === 'touch' && d.view.kind !== 'donut') this.startPinch(d);
      if (map.size > 1) this.pinched = true;
      return;
    }
    if (e.button !== 0 || this.down) return;
    this.down = { id: e.pointerId, x: at.x, y: at.y, d: false };
    try { this.plot.setPointerCapture(e.pointerId); } catch { /* gone */ }
  }

  private onPointerUp(e: PointerEvent): void {
    const d = this.committed;
    if (e.pointerType === 'touch') {
      const t = this.touches?.get(e.pointerId);
      if (this.endTouch(e.pointerId, true)) return;
      const up = this.local(e);
      if (t && plotReady(d) && dist(up.x, up.y, t.x0, t.y0) < TAP_DISTANCE && e.timeStamp - t.t0 < TAP_TIME) this.activate(d, clientPoint(e), false);
      return;
    }
    if (this.down?.id !== e.pointerId) return;
    const was = this.down; this.endDrag();
    if (!plotReady(d)) return;
    if (was.d) {
      const at = this.local(e), a = positionAt(d.layout, was.x, was.y), b = positionAt(d.layout, at.x, at.y);
      if (a === null || b === null || d.view.kind === 'donut') return;
      this.applyRange(d, a, b);
      this.pointerAt(e.clientX, e.clientY, e.timeStamp);
      return;
    }
    this.activate(d, clientPoint(e), true);
  }

  private activate(d: Committed & { readonly ready: true }, at: Point, mouse: boolean): void {
    if (this.range && d.view.kind !== 'donut' && d.layout.kind === 'plot') {
      const m = this.plotMapping(), pr = d.layout.plot;
      const p = { x: plotCoordinate(at.x, m.left, m.kx, pr.x, pr.width), y: plotCoordinate(at.y, m.top, m.ky, pr.y, pr.height) };
      const x = positionAt(d.layout, p.x, p.y);
      if (x === null || p.x < pr.x || p.x > pr.x + pr.width || p.y < pr.y || p.y > pr.y + pr.height) return;
      if (this.range.s === null) { this.range.s = x; this.markRange(d); return; }
      this.applyRange(d, this.range.s, x); return;
    }
    const target = this.pick(d, at);
    this.pointer = mouse ? at : null; this.rest = null; this.pinPage = 0;
    if (!target) { this.shown = mouse ? NO_HOVER : this.idle(); this.redraw(); return; }
    const ref = d.lookup.primary(target) ? this.resolveAligned(d, target) : null;
    this.dismissed = null;
    this.shown = ref && presentationFor(d) !== 'none' ? { k: S_PIN, r: ref, t: target } : { k: S_HOVER, t: target };
    if (this.shown.k === S_PIN) this.listenPin();
    if (mouse && this.proxy) { this.clickFocus = true; try { focusQuiet(this.proxy); } finally { this.clickFocus = false; } }
    if (ref) { this.focus = ref; this.writeProxy(true); this.actions.select(ref); }
    this.redraw(2);
  }

  private onPointerCancel(e: PointerEvent): void {
    if (e.pointerType === 'touch') { this.endTouch(e.pointerId, false); return; }
    if (this.down && this.down.id !== e.pointerId) return;
    this.endDrag(); this.leave();
  }

  private endPin(): void {
    if (this.shown.k !== S_PIN) return;
    this.pinPage = 0;
    this.shown = this.pointer && plotReady(this.committed) ? { k: S_HOVER, t: this.pick(this.committed, this.pointer) } : this.idle();
  }

  private startPinch(d: Committed): void {
    if (!this.touches || d.view.kind === 'donut') return;
    const [[ia, a] = [], [ib, b] = []] = this.touches;
    if (ia === undefined || ib === undefined || !a || !b) return;
    const w = this.currentWindow(d)!;
    this.pinch = { ids: [ia, ib], d: Math.max(1, dist(a.x, a.y, b.x, b.y)), w, c: positionAt(d.layout, (a.x + b.x) / 2, (a.y + b.y) / 2) ?? (w[0] + w[1]) / 2 };
    if (this.shown.k === S_PIN) { this.shown = this.idle(); this.pinPage = 0; }
    this.dropView();
    this.draw(d, null);
  }

  private pinchMove(): void {
    const d = this.committed, a = this.pinch && this.touches?.get(this.pinch.ids[0]), b = this.pinch && this.touches?.get(this.pinch.ids[1]);
    if (!this.pinch || !a || !b || !plotReady(d) || d.view.kind === 'donut' || d.layout.kind !== 'plot') return;
    const width = pinchWidth(this.pinch.w[1] - this.pinch.w[0], this.pinch.d / Math.max(1, dist(a.x, a.y, b.x, b.y)), minimumWidth(d.view));
    const p = d.layout.plot, full = this.zoomBounds(d);
    const share = horizontalBars(d) ? (p.y + p.height - (a.y + b.y) / 2) / p.height : ((a.x + b.x) / 2 - p.x) / p.width;
    const start = clamp(this.pinch.c - share * width, full[0], full[1] - width);
    this.pinchWindow = width >= full[1] - full[0] ? null : [start, start + width];
    if (!this.pinchFrame) this.pinchFrame = this.win()!.requestAnimationFrame(() => { this.pinchFrame = 0; if (this.pinchWindow !== undefined) this.requestZoom(this.pinchWindow); this.pinchWindow = undefined; });
  }

  private onEscape(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const spend = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    const inChart = focusedFigure(this.doc, this.root);
    if (inChart !== this.root && (inChart !== null || (!this.isLastShowing() && !this.down?.d))) return;
    if (this.down?.d) { spend(); this.endDrag(); return; }
    if (this.range) { spend(); this.endRange(); return; }
    const target = this.shownTarget();
    if (!target || (!this.tooltip?.visible && this.shown.k !== S_PIN)) return;
    spend();
    this.dismissed = [identityOf(target, this.shown.k === S_PIN ? this.shown.r : this.shown.k === S_KEY ? this.focus : this.committed?.lookup.primary(target) ?? null)];
    this.pinPage = 0;
    if (this.shown.k === S_HELD) {
      const under = this.pointer && plotReady(this.committed) ? this.pick(this.committed, this.pointer) : null;
      if (under) this.dismissed.push(identityOf(under, this.committed!.lookup.primary(under)));
      this.shown = { k: S_HOVER, t: under };
    } else if (this.shown.k === S_PIN) this.shown = this.pointer ? { k: S_HOVER, t: target } : this.idle();
    this.rest = null; this.redraw();
  }

  private onScroll(): void {
    this.clearGeo();
    const d = this.committed;
    if (!plotReady(d)) return;
    if ((this.shown.k === S_HOVER || this.shown.k === S_HELD) && this.pointer) { this.rest = null; this.pointTo(this.pick(d, this.pointer)); }
    else if (!this.tooltip?.visible) return;
    this.redraw();
  }

  private jumpTarget(raw: string): XValue | null {
    const d = this.controlsState;
    if (!d?.reader.table) return null;
    const { view, formatters: f } = d, kind = xKindOf(view);
    if (kind === 'category') return raw;
    const text = raw.trim();
    if (!text) return null;
    const want = normalized(text), written = () => printedX(view, f, p => normalized(p) === want);
    if (kind === 'number') {
      const n = parseNumberAs(text, f.x, f.count);
      return n === null ? written() : normalized(f.x(n)) === want ? n : written() ?? n;
    }
    const zone = view.kind === 'scatter' ? view.frame.timeZone : view.kind === 'donut' ? null : view.frame.x.timeZone;
    const pos = (v: XValue) => { try { return readPosition(v, kind, zone); } catch { return NaN; } };
    if (Number.isFinite(pos(text))) return text;
    const parsed = Date.parse(text.replace(/,?\s*(?:UTC|GMT)$/u, ' UTC'));
    if (!Number.isFinite(parsed)) return written();
    const at = new Date(parsed), pad = (n: number) => String(n).padStart(2, '0');
    const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
    const cand: XValue = kind === 'time' ? at : kind === 'date' ? day : `${day}T${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
    const p = pos(cand);
    return Number.isFinite(p) && normalized(f.x(p)) === want ? cand : written();
  }

  private openTable(): void {
    const d = this.controlsState;
    if (!d?.reader.table || this.tableView) return;
    this.tableView = createTableView(this.doc, this.figure.id, this.jumpTarget.bind(this));
    this.root.classList.add('axylo-table-open'); this.plot.inert = true;
    this.pointer = this.rest = this.tableModel = null; this.pinPage = 0; this.shown = NONE;
    this.dropView(); this.clearGeo(); this.renderTable(d); this.tableView.focus();
  }

  private closeTable(restore = true): void {
    if (!this.tableView) return;
    const inside = this.tableView.element.contains(this.activeElement());
    this.tableView.destroy(); this.tableView = this.tableModel = null; this.clearGeo();
    this.root.classList.remove('axylo-table-open'); this.plot.inert = false;
    if (inside && restore && !this.toolbar?.focus('table')) {
      if (this.proxy && !this.proxy.hidden) focusQuiet(this.proxy);
      if (!this.proxy || this.proxy.hidden || this.activeElement() !== this.proxy) this.focusFigure();
    }
  }

  private renderTable(d: ControlsState): void {
    const model = d.reader.table;
    if (!this.tableView || !model) return;
    if (model !== this.tableModel) {
      this.tableModel = model;
      const { messages: m, formatters: f } = d, qual = ` (${fill(m.incompleteStack, {})})`, qualLang = d.english('incompleteStack');
      this.tableView.update(model, {
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
    if (this.tableView.element.parentNode !== this.figure.stage) this.figure.stage.appendChild(this.tableView.element);
  }

  private controlItems(d: ControlsState): ToolbarItem[] {
    const { messages: m, view } = d, items: ToolbarItem[] = [], inherited = d.english('controlsLabel') ? d.pageLang : null;
    if (d.ready && d.legend && view.kind !== 'donut' && !d.tooSmall && view.frame.series.length > 1) {
      view.frame.series.forEach(({ key, label }, i) => {
        const on = view.visible[i] === true;
        items.push({
          key: `series:${key}`, label, pressed: on, lang: inherited, className: 'axylo-control axylo-legend-entry',
          struck: !on, swatch: this.parts.swatch(i, view.cues[i] ?? null, !on), activate: () => this.actions.toggle(key),
        });
      });
    }
    const btn = (key: Exclude<keyof Messages, InstructionKey>, activate: () => void, disabled = false, extra?: Partial<ToolbarItem>): ToolbarItem =>
      ({ key, label: m[key] ?? defaultMessages[key], lang: d.english(key) ?? inherited, className: 'axylo-control', activate, disabled, ...extra });
    if (canZoom(d)) {
      const { xDomain: now, xFull: full } = d.view;
      if (d.ready) {
        items.push(
          btn('zoomIn', () => this.zoomBy(1 / ZOOM_FACTOR), !this.canZoomCloser(view, d.zoomed ? now : full)),
          btn('selectRange', () => {
            if (this.range) this.endRange();
            else { this.startInteraction(); this.range = { s: null }; if (this.controlsState) this.renderControls(this.controlsState); }
          }, false, {
            pressed: this.range !== null, symbol: 'range', className: 'axylo-control axylo-control-symbol',
          }),
        );
      }
      if (d.ready || d.zoomed) items.push(btn('zoomOut', () => this.zoomBy(ZOOM_FACTOR), !d.zoomed));
      if (d.zoomed) items.push(btn('panLeft', () => this.pan(-0.5), !(now[0] > full[0])), btn('panRight', () => this.pan(0.5), !(now[1] < full[1])), btn('resetZoom', () => this.requestZoom(null)));
    }
    if (d.streaming) items.push(btn(d.paused ? 'resume' : 'pause', () => this.actions.pause(!d.paused), false, { key: 'pause' }));
    if (canInspect(d)) {
      const open = this.tableView !== null;
      items.push(btn(open ? 'hideTable' : 'viewAsTable', () => { if (this.tableView) this.closeTable(); else this.openTable(); if (this.controlsState) this.renderControls(this.controlsState); }, false, {
        key: 'table', expanded: open, controls: `${this.figure.id}-table`,
      }));
    }
    return items;
  }

  private removeLegend(): void {
    if (!this.legendList) return;
    this.markLegend(null);
    sliceLists.get(this.legendList)?.l.clear();
    sliceLists.delete(this.legendList);
    this.legendList.remove();
  }

  private canZoomCloser(view: View, window: Span): boolean {
    if (this.zoomCheckView !== view || this.zoomCheckWindow !== window) {
      this.zoomCheckView = view; this.zoomCheckWindow = window;
      this.zoomCheckResult = canZoomIn(view, window);
    }
    return this.zoomCheckResult;
  }

  private controlInputs(d: ControlsState, out: unknown[]): void {
    const { view } = d;
    out.push(d.messages, d.english('controlsLabel'), d.pageLang, d.legend, this.tableView !== null, this.range !== null, canInspect(d), d.streaming, d.paused);
    if (this.tableView) out.push(d.reader.table, d.formatters);
    if (canZoom(d)) {
      const { xDomain: now, xFull: full } = d.view;
      out.push(true, d.ready, d.zoomed, d.ready && this.canZoomCloser(view, d.zoomed ? now : full), d.zoomed && now[0] > full[0], d.zoomed && now[1] < full[1]);
      if (!d.ready) this.zoomCheckView = this.zoomCheckWindow = null;
    } else {
      this.zoomCheckView = this.zoomCheckWindow = null;
      out.push(false);
    }
    if (showsSlices(d)) out.push(view, d.formatters, d.ready, d.english('noData'));
    else if (view.kind !== 'donut' && d.ready && d.legend && !d.tooSmall && view.frame.series.length > 1) {
      const { series } = view.frame;
      for (let i = 0; i < series.length; i++) {
        const s = series[i]!, cue = view.cues[i];
        out.push(s.key, s.label, view.visible[i] === true, cue?.marker, cue?.dash.normal, cue?.dash.contrast);
      }
    }
  }

  private renderControls(d: ControlsState, measure = false): boolean {
    this.controlsState = d;
    // Localized messages may reenter rendering. Borrow the scratch until the comparison completes.
    const inputs = controlScratch ?? [];
    controlScratch = undefined;
    let spare: unknown[] | null = inputs;
    try {
      this.controlInputs(d, inputs);
      if (sameKey(this.lastControls, inputs)) return false;
      spare = this.lastControls;
      this.lastControls = inputs;
    } finally {
      if (spare) {
        spare.length = 0;
        controlScratch ??= spare;
      }
    }
    const before = measure ? this.figure.controlsSignature() : '';
    this.controlNodes = null; this.clearGeo();

    const inLegend = this.legendList !== null && this.legendList.contains(this.activeElement());
    const nextList = this.parts.sliceList?.(this.doc, d, this.actions, this.legendList) ?? null;
    if (!nextList && this.legendList) this.removeLegend();
    this.legendList = nextList;
    if (inLegend && (!this.legendList || !this.legendList.contains(this.activeElement()))) this.focusFigure();

    const items = this.controlItems(d), inToolbar = this.toolbar?.element.contains(this.activeElement());
    if (items.length || this.toolbar) (this.toolbar ??= createToolbar(this.doc)).render(items, d.messages.controlsLabel, d.english('controlsLabel'));
    const legend: Element[] = [];
    if (this.legendList) legend.push(this.legendList);
    if (items.length && this.toolbar) legend.push(this.toolbar.element);
    const slot = d.legend === 'top' ? 'top' : d.legend === 'right' ? 'side' : 'controls';
    if (this.tableView && !canInspect(d)) this.closeTable(); else if (this.tableView) this.renderTable(d);
    const act = this.activeElement();
    this.figure.placeControls(slot, legend);
    for (const s of CONTROL_SLOTS) if (s !== slot) this.figure.placeControls(s, NO_CONTROLS);
    this.markFocusedSlice(this.committed);
    if (isFocusable(act) && act !== this.activeElement() && act.isConnected) focusQuiet(act);
    else if (inToolbar && !items.length) this.focusFigure();
    return measure && this.figure.controlsSignature() !== before;
  }

  private renderInstructions(el: HTMLElement, list: readonly { text: string; lang: string | null }[], proxyLang: string | null, pageLang: string | null): void {
    if (!list.length) { if (el.firstElementChild || el.textContent !== '') el.textContent = ''; setAttr(el, 'lang', null); return; }
    const langOf = (l: string | null) => l ?? (proxyLang ? pageLang : null), first = langOf(list[0]!.lang);
    // Uniform-language single-text fast path (Stage 3 DOM invariant).
    if (list.every(p => langOf(p.lang) === first)) {
      const text = list.length === 1 ? list[0]!.text : list.map(p => p.text).join(' ');
      if (el.firstElementChild) el.textContent = text; else setText(el, text);
      setAttr(el, 'lang', first);
      return;
    }
    setAttr(el, 'lang', null);
    if (!el.firstElementChild && el.firstChild) el.textContent = '';
    list.forEach(({ text, lang }, i) => {
      const span = el.children[i] ?? el.appendChild(this.doc.createElement('span'));
      setText(span, i ? ` ${text}` : text);
      setAttr(span, 'lang', langOf(lang));
    });
    while (el.children.length > list.length) el.lastElementChild!.remove();
  }

  private placeProxy(d: Committed, hasData: boolean): void {
    if (!this.proxy || !this.ring) return;
    const ready = plotReady(d), usable = ready || recoverable(d);
    if (usable !== this.proxyUsable) {
      this.proxyUsable = usable;
      if (!usable && this.activeElement() === this.proxy && !this.toolbar?.focus('table')) this.focusFigure();
      if (this.proxy.hidden === usable) this.proxy.hidden = !usable;
      if (this.ring.hidden === usable) this.ring.hidden = !usable;
      if (this.instructions && this.instructions.hidden === usable) this.instructions.hidden = !usable;
    }
    if (!usable) { this.proxyInstructionState = null; return; }
    const p = plotBox(d);
    if (!this.proxyRect || this.proxyRect.x !== p.x || this.proxyRect.y !== p.y || this.proxyRect.width !== p.width || this.proxyRect.height !== p.height) {
      this.proxy.style.cssText = this.ring.style.cssText = boxStyle(p);
    }
    this.proxyRect = p;
    const count = instructionSeries(d, hasData), lang = this.readingLang(d, hasData);
    const zoomInstructions = ready && offersZoom(d), donut = d.view.kind === 'donut';
    const plotLang = count ? d.english('plotInstructions') : null;
    const seriesLang = count > 1 ? d.english('seriesInstructions') : null;
    const donutLang = count && donut ? d.english('donutInstructions') : null;
    const zoomLang = zoomInstructions ? d.english('zoomInstructions') : null;
    const previous = this.proxyInstructionState;
    this.proxyInstructionState = d;
    if (previous && previous.kind === d.kind && previous.messages === d.messages && previous.zoom === d.zoom &&
        plotReady(previous) === ready && (ready && offersZoom(previous)) === zoomInstructions && previous.pageLang === d.pageLang &&
        this.proxyInstructionCount === count && this.proxyInstructionLang === lang &&
        this.plotInstructionLang === plotLang && this.seriesInstructionLang === seriesLang &&
        this.donutInstructionLang === donutLang && this.zoomInstructionLang === zoomLang) return;
    this.proxyInstructionCount = count;
    this.proxyInstructionLang = lang;
    this.plotInstructionLang = plotLang;
    this.seriesInstructionLang = seriesLang;
    this.donutInstructionLang = donutLang;
    this.zoomInstructionLang = zoomLang;
    setAttr(this.proxy, 'aria-label', d.messages.plotLabel);
    if (this.instructions) {
      const desc = descriptionFor(d, count);
      this.renderInstructions(this.instructions, desc, lang, d.pageLang);
      setAttr(this.proxy, 'aria-describedby', desc.length ? this.instructions.id : null);
    }
    setAttr(this.proxy, 'aria-roledescription', fill(d.messages.plotRole, { type: chartTypeName(d.messages, d.kind) }));
    setClass(this.plot, 'axylo-touch-zoom', d.zoom === 'touch');
    setClass(this.plot, 'axylo-zoomable', d.zoom !== false);
  }

  private remapper(before: View, after: View): ((ref: DatumRef | null, exact?: boolean) => DatumRef | null) | null {
    const from = categoriesOf(before), to = categoriesOf(after);
    if (!from || !to || (from.length === to.length && from.every((n, i) => to[i] === n))) return null;
    const index = new Map(to.map((n, i) => [n, i]));
    return (ref, exact) => {
      if (ref?.kind !== 'aligned') return ref;
      for (let i = ref.x; i < from.length; i++) { const at = index.get(from[i]!); if (at !== undefined) return { ...ref, x: at }; if (exact) return null; }
      return null;
    };
  }

  private remapTarget<T extends PickTarget | Identity>(t: T | null, map: (r: DatumRef | null, exact?: boolean) => DatumRef | null): T | null {
    if (t?.kind !== 'x') return t;
    const m = map({ kind: 'aligned', seriesKey: '', x: t.x }, true);
    return m?.kind === 'aligned' ? { kind: 'x', x: m.x } as T : null;
  }

  private stillPinned(next: Committed, ref: DatumRef, target: PickTarget): { r: DatumRef; t: PickTarget } | null {
    if (!plotReady(next) || !readable(next)) return null;
    const { lookup } = next;
    if (target.kind === 'point') {
      if (ref.kind !== 'point' || lookup.ordinal(ref) < 0) return null;
      const b = lookup.anchor(ref);
      return b ? { r: ref, t: this.pointGroup(next, ref, b) } : null;
    }
    if (target.kind === 'slice') return ref.kind === 'slice' && lookup.ordinal(ref) >= 0 ? { r: ref, t: target } : null;
    return sameRef(lookup.resolve(ref), ref) && lookup.tooltip(target).rows.length ? { r: ref, t: target } : null;
  }

  private dropHold(d: Committed, allowPick = true) { this.rest = null; if (allowPick && this.pointer) this.pointTo(this.pick(d, this.pointer)); else this.shown = this.idle(); }

  private resetCore() { this.single = false; this.dismissed = this.shownText = this.focus = this.rest = null; this.pinPage = 0; }

  private reconcile(previous: Committed | null, next: Committed): void {
    const { lookup } = next;
    if (previous && previous.epoch !== next.epoch) {
      this.resetCore(); this.lastHover = null;
      this.shown = this.shown.k === S_KEY ? this.shown : this.pointer ? NO_HOVER : this.idle();
    } else if (previous) {
      const map = this.remapper(previous.view, next.view);
      if (map) {
        this.focus = map(this.focus);
        if (this.shownText) { const moved = map(this.shownText.r, true); this.shownText = moved ? { ...this.shownText, r: moved } : null; }
        if (!this.focus) this.single = false;
        this.lastHover = map(this.lastHover);
        if (this.dismissed) { const kept = this.dismissed.flatMap(id => this.remapTarget(id, map) ?? []); this.dismissed = kept.length ? kept : null; }
        if (this.shown.k === S_PIN) { const t = this.remapTarget(this.shown.t, map), r = map(this.shown.r, true); this.shown = t && r ? { k: S_PIN, r, t } : NO_HOVER; }
        else if (this.shown.k === S_HELD) { const t = this.remapTarget(this.shown.t, map); this.shown = t ? { ...this.shown, t } : NO_HOVER; }
      }
    }
    if (this.focus) {
      const res = lookup.resolve(this.focus); this.focus = res;
      if (!res) this.single = false; else if (!this.single && res.kind === 'aligned') this.focus = lookup.primary({ kind: 'x', x: res.x }) ?? res;
    }
    if (!this.focus && this.proxyFocused && plotReady(next) && readable(next)) this.focus = this.firstDatum(next);

    const pres = presentationFor(next);
    if (!plotReady(next)) { if (this.shown.k !== S_KEY) this.shown = this.pointer ? NO_HOVER : this.idle(); this.pinPage = 0; return; }
    if (this.shown.k === S_PIN) {
      const kept = pres === 'none' ? null : this.stillPinned(next, this.shown.r, this.shown.t);
      if (kept) this.shown = { k: S_PIN, ...kept };
      else { this.endPin(); if ((this.shown as Shown).k === S_HOVER && this.pointer) this.pointTo(this.pick(next, this.pointer)); }
    } else if (this.shown.k === S_HELD) {
      if (pres !== this.shown.p || !sameRect(this.anchorOf(next, this.shown.t), this.shown.a) || !lookup.tooltip(this.shown.t).rows.length) this.dropHold(next, !this.down?.d);
    } else if (this.shown.k === S_HOVER && this.pointer && !this.down?.d) {
      const before = this.shown.t; this.pointTo(this.pick(next, this.pointer));
      const now = (this.shown as Shown).k === S_HOVER ? (this.shown as Extract<Shown, { k: 2 }>).t : null;
      const moved = now !== null && this.content !== null && sameTarget(this.content.t, now) && !sameRect(this.anchorOf(next, now), this.content.a);
      if (!sameTarget(before, now) || moved) this.rest = { x: this.pointer.x, y: this.pointer.y, t: this.clock(), g: now };
    }
  }

  commit(next: Committed | null): void {
    if (this.destroyed) return;
    this.clearGeo();
    const prev = this.committed;
    this.pendingWindow = undefined;
    if (!next?.interactive) { this.reset(); this.committed = next; return; }
    if (prev?.layout !== next.layout || prev.theme !== next.theme) this.tooltip?.invalidateSize();
    if (this.swatches && prev?.view !== next.view) this.swatches.length = 0;
    this.overlayInput = null;
    this.committed = next; this.dirty = true;
    this.build();
    if (this.range && !(plotReady(next) && next.zoom && next.view.kind !== 'donut')) { this.range = null; if (this.selection && !this.down?.d) this.selection.hidden = true; }
    else if (this.range && !this.down?.d) this.markRange(next);
    // An untouched chart has no datum identity to carry across frame revisions.
    if (this.shown.k !== S_NONE || this.proxyFocused || this.focus || this.pointer || this.dismissed) this.reconcile(prev, next);
    const hasData = plotReady(next) && readable(next);
    this.placeProxy(next, hasData); this.writeProxy(false, hasData); this.renderControls(next);
    if (this.shown.k !== S_NONE || this.proxyFocused || this.lastPres || this.lastHover || this.overlayVisible || this.pinListeners) this.present();
    if (this.shown.k === S_HELD && (!this.content || !sameRect(this.content.b, this.shown.b)) && plotReady(next)) { this.dropHold(next); this.redraw(); }
  }

  prepare(state: ControlsState): boolean {
    if (this.destroyed) return false;
    this.clearGeo();
    const nextPres = presentationFor(state), strip = nextPres === 'strip', readoutChanged = this.root.classList.contains('axylo-readout-mode') !== strip;
    if (!state.interactive && !this.proxy && !this.committed && !this.controlsState && !readoutChanged) return false;
    let controlsChanged: boolean;
    if (!state.interactive) {
      const before = this.figure.controlsSignature(); this.reset(); this.committed = this.controlsState = null;
      controlsChanged = this.figure.controlsSignature() !== before;
    } else { this.build(); controlsChanged = this.renderControls(state, true); }
    if (readoutChanged) {
      this.root.classList.toggle('axylo-readout-mode', strip);
      this.dropView(this.shown.k !== S_PIN || nextPres === 'none');
      if (this.shown.k === S_HELD) this.shown = this.pointer ? NO_HOVER : this.idle();
      this.rest = this.pointer ? { x: this.pointer.x, y: this.pointer.y, t: this.clock(), g: this.pointerTarget() } : null;
    }
    return readoutChanged || controlsChanged;
  }

  private reset(): void {
    this.clearGeo();
    this.swatches = this.hoverState = this.hoverModel = this.overlayInput = null;
    this.unlistenPin();
    if (this.committed) this.draw(this.committed, null);
    if (!this.lastPres && !this.proxy && !this.tooltip?.visible && !this.legendList && !this.tableView && !this.lastHover) return;
    this.lastPres = null;
    const owned = this.focusOwned();
    this.hideTooltip(); this.unbuild(owned); this.resetCore();
    this.tooltipContent = this.touches = null;
    this.shown = NONE; this.content = this.range = this.pointer = null; this.proxyFocused = this.fromClick = this.keyed = false;
    this.hover(null);
  }

  clear(): void { this.reset(); this.committed = this.controlsState = null; }

  attach(): void {
    if (this.attached || this.destroyed) return;
    this.attached = true; this.clearGeo(); this.registerFigure();
    this.listenShadowScroll();
    if (this.interacted) this.listenDocument();
  }

  detach(): void { if (!this.attached) return; this.attached = false; this.clearGeo(); this.cancelGestures(); this.endPin(); this.dropView(); this.unregisterFigure(); this.unlistenAttached(); }

  destroy(): void {
    if (this.destroyed) return;
    this.reset(); this.unregisterFigure(); this.tooltip?.destroy();
    this.tooltip = this.tooltipContent = this.committed = this.controlsState = null;
    this.destroyed = true; this.stopPinch();
  }
}

export function createInteraction(parts: InteractionParts, figure: Figure, renderer: MarkRenderer, actions: Actions): Interaction {
  return new DomInteraction(parts, figure, renderer, actions);
}
