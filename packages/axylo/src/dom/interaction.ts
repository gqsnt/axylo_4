/**
 * Everything a reader uses to explore a full chart (decision 0001; spec I1–I6, A2–A4, A7): pointer, touch,
 * keyboard, tooltip, overlay, toolbar, table and zoom gestures.
 */
import type {
  DatumRef, DatumText, Formatters, Layout, Lookup, MarkRenderer, Overlay, PaintBindings, PickTarget, ReaderModel,
  Rect, ResolvedTheme, StepDirection, TooltipModel, View, XValue,
} from '../core/contracts';
import { sameKey } from '../core/axes';
import type { Messages } from '../public';
import { chartTypeName, defaultMessages, fill, messageLanguage } from '../messages';
import {
  overlayWith, OUTLINE_REACH, RING_REACH, RING_STROKE, alignedRows, canZoomIn, datumReading, minimumWidth, panWindow,
  pinchWidth, pixelOf, positionAt, rangeWindow, refsAt, ringRect, sameRef, stepAcross, zoomStep, targetBox, targetOf, valueText, PAN_SHARE, ZOOM_FACTOR,
  type Mode, type TargetMarks,
} from '../core/focus';
import type { Figure } from './figure';
import { createTableView, type TableView } from './table';
import { rovingIndex, createToolbar, type Toolbar, type ToolbarItem } from './toolbar';
import { createTooltip, type Presentation, type TooltipContent, type TooltipView } from './tooltip';
import { createSwatch, swatchPattern, type SwatchPattern, type SwatchSpec } from './swatch';
import { sliceText } from '../lookup/text';
import { barPattern } from '../scene/bars';
import { readPosition } from '../reader/x';
import { printedX } from '../reader/table';
import { activeElementOf, isElement, isFocusable, placeChildren, setAttr, setText, make, keepFocusOnPress, hideFromAT, shadowRootOf, shadowRootsOf } from './attributes';
import { Listeners, listenOutside, mappingOf, rectToViewport, toLocal, toViewport, visibleRegion, type Mapping, type Point } from './mapping';
import { insideCorridor, intersect, type PlacementInput } from './placement';
import { identityOf, matchesIdentity, sameTarget, type Identity } from './pointer';

type Span = readonly [number, number];
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
const isAligned = (v: View): v is Extract<View, { kind: 'line' | 'area' | 'bar' | 'histogram' }> => v.kind !== 'scatter' && v.kind !== 'donut';
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

function instructionSeries(d: Committed): number {
  if (!d.interactive || !plotReady(d) || !readable(d) || d.lookup.count === 0) return 0;
  const { view } = d;
  if (view.kind === 'donut') return 1;
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

const lastShowing = new WeakMap<Document, HTMLElement[]>();
const liveFigures = new WeakMap<Document, Set<HTMLElement>>();

function focusedFigure(doc: Document, own: HTMLElement): Element | null {
  const act = activeElementOf(doc, own);
  const inOwn = isElement(act) ? act.closest('.axylo-figure') : null;
  if (inOwn) return inOwn;
  for (const fig of liveFigures.get(doc) ?? []) {
    if (fig === own) continue;
    const inner = shadowRootOf(fig)?.activeElement ?? null;
    if (isElement(inner) && fig.contains(inner)) return fig;
  }
  return null;
}

export function createInteraction(parts: InteractionParts, figure: Figure, renderer: MarkRenderer, actions: Actions): Interaction {
  const root = figure.figure, doc = root.ownerDocument, plot = figure.plot;
  const win = () => doc.defaultView, activeElement = () => activeElementOf(doc, root);
  let tooltip: TooltipView | null = null;
  const getTooltip = () => tooltip ??= createTooltip(figure.tooltip, figure.readout, root, () => {
    if (proxy && !proxy.hidden) focusQuiet(proxy); else focusFig(root);
  });

  // Cached per-frame/scroll/resize geometry (Stage 2/3 invariant).
  let geoPlot: Mapping | null = null, geoFigure: Mapping | null = null, geoVisible: Rect | null = null;
  let geoReadout: Rect | null = null, geoControls: readonly Rect[] | null = null, controlNodes: readonly HTMLElement[] | null = null;
  const clearGeo = () => { geoPlot = geoFigure = geoVisible = geoReadout = geoControls = null; };

  let c: Committed | null = null, cs: ControlsState | null = null, lastControls: unknown[] | null = null, controlScratch: unknown[] | null = null;
  let focus: DatumRef | null = null, single = false, shown: Shown = NONE, pointer: Point | null = null;
  let rest: { p: Point; t: number; g: PickTarget | null } | null = null;
  let content: Content | null = null, dismissed: Identity[] | null = null, pinPage = 0;
  let range: { s: number | null } | null = null;
  let proxyFocused = false, keyed = false, clickFocus = false, fromClick = false, shownOrdinal = 0;
  let shownText: { r: DatumRef; s: boolean; d: string | null } | null = null;
  let lastHover: DatumRef | null = null;
  let lastPres: readonly [PickTarget | null, DatumRef | null, DatumRef | null, boolean, boolean, number, Presentation | 'none'] | null = null;
  let dirty = true, overlayVisible = false, pendingWindow: Span | null | undefined, tableView: TableView | null = null, tableModel: unknown = null;
  let down: { id: number; x: number; y: number; d: boolean } | null = null;
  let touches: Map<number, { x: number; y: number; x0: number; y0: number; t0: number }> | null = null;
  let pinch: { ids: readonly [number, number]; d: number; w: Span; c: number } | null = null;
  let pinched = false, pinchFrame = 0, pinchWindow: Span | null | undefined, destroyed = false, attached = true;
  let built: Listeners | null = null, docListeners: Listeners | null = null, pinListeners: Listeners | null = null;

  let proxy: HTMLInputElement | null = null, ring: HTMLElement | null = null, proxyRect: Rect | null = null;
  let instructions: HTMLElement | null = null, selection: HTMLElement | null = null;
  let legendList: HTMLUListElement | null = null, toolbar: Toolbar | null = null, legendMarked: HTMLElement | null = null;
  let proxyUsable: boolean | null = null, proxyMeta: readonly unknown[] | null = null, idleReading: readonly unknown[] | null = null;

  const mode = (): Mode => single ? 'single' : 'all';
  const focusFigure = () => focusFig(root);
  const pointerTarget = (): PickTarget | null => 't' in shown ? shown.t : null;
  const idle = (): Shown => proxyFocused && !fromClick ? KEY : NONE;
  const draw = (d: Committed, o: Overlay | null) => {
    if (!o && !overlayVisible) return;
    overlayVisible = o !== null;
    renderer.drawOverlay(o, d.bindings, d.theme, d.pixelRatio);
  };
  const recoverable = <T extends ControlsState>(d: T | null): d is T & { readonly zoomed: true } =>
    d !== null && !d.ready && d.empty === true && d.zoom !== false && d.zoomed && !d.tooSmall;
  const canZoom = (d: ControlsState): d is ControlsState & { readonly zoom: true | 'touch'; readonly tooSmall: false; readonly view: Exclude<View, { kind: 'donut' }> } =>
    offersZoom(d) && (d.ready || recoverable(d));

  function registerFigure(): void { let s = liveFigures.get(doc); if (!s) liveFigures.set(doc, s = new Set()); s.add(root); }
  function unregisterFigure(): void { const s = liveFigures.get(doc); if (s) { s.delete(root); if (!s.size) liveFigures.delete(doc); } }
  registerFigure();

  function listenDocument(): void {
    if (docListeners || !attached || !proxy) return;
    const l = docListeners = new Listeners(), roots = shadowRootsOf(root), w = win();
    l.on(w, 'keydown', onEscape, true);
    l.on(doc, 'scroll', onScroll, { capture: true, passive: true });
    l.on(w, 'resize', clearGeo, { passive: true });
    l.on(w, 'blur', cancelGestures);
    for (const r of roots) l.on(r, 'scroll', onScroll, { capture: true, passive: true });
  }
  const unlistenDocument = () => { docListeners?.clear(); docListeners = null; };
  const unlistenPin = () => { pinListeners?.clear(); pinListeners = null; };

  function listenPin(): void {
    if (pinListeners || !attached) return;
    const l = pinListeners = new Listeners();
    listenOutside(doc, shadowRootsOf(root), 'pointerdown', [plot, figure.tooltip, figure.readout], () => { endPin(); redraw(); }, l);
  }

  function build(): void {
    if (proxy) return;
    const l = built = new Listeners();
    proxy = make(doc, 'input', 'axylo-proxy');
    proxy.type = 'range'; proxy.id = `${figure.id}-proxy`; proxy.min = '0'; proxy.step = '1';
    l.on(proxy, 'keydown', ev => { onProxyKey(ev); if (ev.defaultPrevented && !keyed) setKeyed(true); });
    for (const t of ['input', 'change'] as const) l.on(proxy, t, onProxyInput);
    l.on(proxy, 'focus', onProxyFocus);
    l.on(proxy, 'blur', onProxyBlur);
    ring = make(doc, 'div', 'axylo-focus-ring');
    hideFromAT(ring);
    instructions = make(doc, 'span', 'axylo-visually-hidden');
    instructions.id = `${figure.id}-i`;
    plot.append(proxy, ring, instructions);
    for (const t of ['focusin', 'focusout'] as const) l.on(root, t, () => { geoControls = null; });
    l.on(figure.stage, 'pointermove', onPointerMove);
    l.on(figure.stage, 'pointerleave', onStageLeave);
    l.on(plot, 'pointerdown', onPointerDown);
    l.on(plot, 'pointerup', onPointerUp);
    l.on(plot, 'pointercancel', onPointerCancel);
    l.on(plot, 'lostpointercapture', ev => { if (down?.id === ev.pointerId) endDrag(); });
    l.on(plot, 'wheel', onWheel, { passive: false });
    listenDocument();
  }

  function stopPinch(apply = false): void {
    pinch = null;
    if (pinchFrame) { win()?.cancelAnimationFrame(pinchFrame); pinchFrame = 0; }
    const w = pinchWindow; pinchWindow = undefined;
    if (apply && w !== undefined) requestZoom(w);
  }
  function cancelGestures(): void { endDrag(); touches?.clear(); pinched = false; stopPinch(); }
  const focusOwned = () => { const a = activeElement(); return isElement(a) && a !== root && root.contains(a); };

  function unbuild(ownedBefore = false): void {
    if (!proxy) return;
    const owned = ownedBefore || focusOwned();
    cancelGestures(); closeTable(false); unlistenDocument();
    built?.clear(); built = null;
    for (const n of [proxy, instructions, ring, selection]) n?.remove();
    removeLegend(); toolbar?.destroy();
    proxy = instructions = ring = selection = legendList = legendMarked = proxyRect = toolbar = lastControls = controlScratch = controlNodes = null;
    proxyUsable = proxyMeta = idleReading = null;
    clearGeo(); figure.clearControls();
    plot.classList.remove('axylo-touch-zoom', 'axylo-zoomable');
    const after = activeElement();
    if (owned && (!after || after === doc.body || !root.contains(after))) focusFigure();
  }

  function firstDatum(d: Committed): DatumRef | null {
    if (!isAligned(d.view)) return d.lookup.step(null, 'first');
    const x = stepAcross(d.view, null, 'first');
    return x === null ? null : d.lookup.primary({ kind: 'x', x });
  }

  const resolveAligned = (d: Committed, t: PickTarget) =>
    single && focus?.kind === 'aligned' && t.kind === 'x'
      ? d.lookup.resolve({ kind: 'aligned', seriesKey: focus.seriesKey, x: t.x }) ?? d.lookup.primary(t)
      : d.lookup.primary(t);

  function takeover(d: Committed): void {
    const t = pointerTarget();
    if (!t) { focus ??= firstDatum(d); return; }
    if (shown.k === S_PIN) focus = shown.r;
    else if (single && focus?.kind === 'aligned' && t.kind === 'x') focus = resolveAligned(d, t);
    else focus = d.lookup.primary(t) ?? focus ?? firstDatum(d);
  }

  function pointGroup(d: Committed, ref: DatumRef, b: Rect): PickTarget {
    const picked = d.lookup.pick(b.x + b.width / 2, b.y + b.height / 2);
    return picked?.kind === 'point' && d.lookup.has(picked, ref) ? picked : targetOf(ref);
  }

  function keyboardTarget(d: Committed, ref: DatumRef): PickTarget {
    if (ref.kind === 'point' && d.view.kind === 'scatter') { const b = d.lookup.anchor(ref); if (b) return pointGroup(d, ref, b); }
    return targetOf(ref);
  }

  const shownTarget = (): PickTarget | null =>
    shown.k === S_KEY ? (proxyFocused && focus && c ? keyboardTarget(c, focus) : null) : pointerTarget();

  const swatches: SwatchSpec[] = [];
  function swatchFor(row: DatumText): SwatchSpec {
    const { view } = c!, i = row.seriesIndex;
    return swatches[i] ??= view.kind === 'donut'
      ? { color: view.slices[i]?.colorIndex ?? null, cue: null, line: false, hollow: false }
      : parts.swatch(i, view.cues[i] ?? null, false);
  }

  const plotMapping = () => geoPlot ??= mappingOf(plot);
  const figureMapping = () => geoFigure ??= mappingOf(root);
  const visiblePlot = () => geoVisible ??= visibleRegion(plot, true, figure.tooltip);
  const visibleReadout = () => geoReadout ??= visibleRegion(figure.readout, false);

  function controlRects(m: Mapping): readonly Rect[] {
    if (geoControls) return geoControls;
    const out: Rect[] = [], w = win();
    controlNodes ??= Array.from(root.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex],.axylo-legend-list>li'))
      .filter(el => el !== proxy && el !== root && !figure.tooltip.contains(el) && !figure.readout.contains(el));
    for (const el of controlNodes) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const st = w?.getComputedStyle(el);
      const painted = st && st.outlineStyle !== 'none' ? (parseFloat(st.outlineWidth) || 0) + Math.max(0, parseFloat(st.outlineOffset) || 0) : 0;
      const reach = Math.max(FOCUS_OUTLINE, painted);
      out.push(padRect(r.left, r.top, r.width, r.height, reach * m.kx, reach * m.ky));
    }
    return geoControls = out;
  }

  function plotPoint(d: Committed, at: Point): Point {
    const m = plotMapping();
    if (d.layout.kind !== 'plot') return toLocal(m, at);
    const b = d.layout.plot, r = rectToViewport(m, b);
    const coord = (v: number, s: number, len: number, o: number, k: number, lo: number, ext: number) => {
      const p = (v - o) / k;
      return v >= s - 1 && v <= s + len + 1 ? clamp(p, lo, lo + ext) : p;
    };
    return { x: coord(at.x, r.x, r.width, m.left, m.kx, b.x, b.width), y: coord(at.y, r.y, r.height, m.top, m.ky, b.y, b.height) };
  }

  const pick = (d: Committed, at: Point) => { const p = plotPoint(d, at); return d.lookup.pick(p.x, p.y); };

  function zoomBounds(d: Committed): Span {
    if (d.view.kind === 'donut') return [0, 0];
    if (!d.zoomed) { const s = posScale(d); if (s && s.type !== 'band') return [Math.min(...s.domain), Math.max(...s.domain)]; }
    return d.view.xFull;
  }

  function markBox(d: Committed, target: PickTarget): Rect | null {
    const box = targetBox(d.view, d.lookup, target, null);
    if (box || target.kind !== 'x' || d.layout.kind !== 'plot') return box;
    const s = posScale(d), at = s ? (s.type === 'band' ? s.center(target.x) : s.map(target.x)) : NaN;
    if (!Number.isFinite(at)) return null;
    const pr = d.layout.plot;
    return horizontalBars(d) ? { x: pr.x + pr.width / 2, y: at, width: 0, height: 0 } : { x: at, y: pr.y + pr.height / 2, width: 0, height: 0 };
  }

  const anchorOf = (d: Committed, t: PickTarget) => { const b = markBox(d, t); return b ? rectToViewport(plotMapping(), b) : null; };

  function pinnedModel(d: Committed, target: PickTarget, offset: number): TooltipModel {
    const { lookup, view, formatters } = d, m = lookup.tooltip(target);
    if (offset <= 0 || offset >= m.count) return m;
    if (target.kind === 'x' && isAligned(view)) return { ...m, rows: alignedRows(view, formatters, target.x, m).slice(offset, offset + PAGE_ROWS) };
    if (target.kind === 'point') {
      const refs = lookup.members(target, offset, PAGE_ROWS);
      if (refs.length) return { ...lookup.tooltip({ kind: 'point', refs, count: target.count }), title: m.title, count: m.count };
    }
    return m;
  }

  const clock = () => win()?.performance.now() ?? 0;

  function noteShowing(promote: boolean): void {
    let list = lastShowing.get(doc);
    if (!list) lastShowing.set(doc, list = []);
    if (list.at(-1) === root) return;
    const i = list.indexOf(root);
    if (promote) { if (i >= 0) list.splice(i, 1); list.push(root); } else if (i < 0) list.unshift(root);
  }
  function releaseShowing(): void {
    const list = lastShowing.get(doc);
    if (!list) return;
    const i = list.indexOf(root);
    if (i >= 0) list.splice(i, 1);
    if (!list.length) lastShowing.delete(doc);
  }
  const isLastShowing = () => { const l = lastShowing.get(doc); return l !== undefined && l.at(-1) === root; };
  const hideTooltip = () => { tooltip?.hide(); releaseShowing(); };
  const dropView = (hide = true) => { if (hide) { unlistenPin(); hideTooltip(); } content = lastPres = null; };
  const redraw = (rec: 0 | 1 | 2 = 0) => { dirty = true; present(rec); };

  function present(rec: 0 | 1 | 2 = 0): void {
    const d = c;
    if (!plotReady(d) || !proxy || (shown.k === S_NONE && !proxyFocused)) {
      if (d) draw(d, null);
      dropView();
      hover(null); return;
    }
    const { view, layout, lookup, messages: m, formatters: f } = d;
    const target = shownTarget(), visibleRing = proxyFocused && (keyed || proxy.matches(':focus-visible')) ? focus : null;
    const only = single && shown.k === S_KEY ? focus : null, pres = presentationFor(d), pinned = shown.k === S_PIN;
    const showTip = pres !== 'none' && target !== null && !isDismissed(target), page = pinned ? pinPage : 0;
    if (!dirty && lastPres && sameTarget(target, lastPres[0]) && sameRef(visibleRing, lastPres[1]) &&
      sameRef(only, lastPres[2]) && showTip === lastPres[3] && pinned === lastPres[4] && page === lastPres[5] && pres === lastPres[6]) return;
    lastPres = [target, visibleRing, only, showTip, pinned, page, pres];
    dirty = false;
    if (pinned) listenPin(); else unlistenPin();
    const prev = content; content = null;
    const overlay = overlayWith(parts.overlay, { view, layout, lookup, target, ring: visibleRing, only });
    if (pinned && !showTip) { endPin(); redraw(); return; }
    const model = showTip ? (pinned ? pinnedModel(d, target, pinPage) : lookup.tooltip(target)) : null;
    if (model?.rows.length && target && pres !== 'none') {
      const tc: TooltipContent = {
        model, swatch: swatchFor, moreRows: n => fill(m.moreRows, { count: f.count(n) }),
        totalLabel: m.total, moreLang: d.english('moreRows'), totalLang: d.english('total'),
        valueLang: t => missingLang(d, t) ?? null, select: row => actions.select(row.ref),
        more: n => { if (shown.k !== S_PIN) return; const nxt = pinPage + Math.max(1, n); pinPage = nxt >= model.count ? 0 : nxt; redraw(); },
      };
      const marks = markBox(d, target), map = plotMapping(), anchor = marks ? rectToViewport(map, marks) : null;
      const bounds = pres === 'strip' ? visibleReadout() : placementFor(d, marks, visibleRing, map);
      const figureMap = pres === 'strip' ? undefined : figureMapping();
      // The overlay and tooltip content share the layout flush needed to measure the tooltip.
      draw(d, overlay);
      const tip = getTooltip();
      const placed = 'box' in bounds ? tip.show(tc, bounds, pinned, figureMap) : tip.strip(tc, pinned, bounds);
      const rect = placed ? tip.rect() : null;
      if (rect) {
        noteShowing(rec === 2 || (rec === 0 && (!prev || !sameTarget(prev.t, target) || prev.pin !== pinned || prev.pg !== page)));
        content = { t: target, b: rect, a: anchor, p: pres, pin: pinned, pg: page };
      } else releaseShowing();
    } else {
      hideTooltip();
      draw(d, overlay);
    }
    if (pinned && !content) { endPin(); redraw(); return; }
    hover(!target ? null : shown.k === S_KEY ? focus : shown.k === S_PIN ? shown.r : lookup.primary(target));
  }

  function placementFor(d: Committed, box: Rect | null, keyboardRing: DatumRef | null, m: Mapping): PlacementInput {
    const { layout, lookup } = d, area = plotBox(d);
    const mk = box ?? { x: area.x + area.width / 2, y: area.y + area.height / 2, width: 0, height: 0 };
    const datum = padRect(mk.x, mk.y, mk.width, mk.height, RING_REACH);
    const pr = padRect(area.x, area.y, area.width, area.height, -OUTLINE_REACH);
    let hole: PlacementInput['hole'] = null;
    if (layout.kind === 'plot' && layout.projection.kind === 'ring' && layout.projection.r0 > HOLE_CLEARANCE) {
      const { cx, cy, r0 } = layout.projection, ctr = toViewport(m, { x: cx, y: cy });
      hole = { cx: ctr.x, cy: ctr.y, rx: (r0 - HOLE_CLEARANCE) * m.kx, ry: (r0 - HOLE_CLEARANCE) * m.ky };
    }
    const rb = keyboardRing ? ringRect(layout, lookup, keyboardRing) : null;
    return {
      box: rectToViewport(m, datum), visible: intersect(rectToViewport(m, pr), visiblePlot()),
      order: horizontalBars(d) ? 'horizontal' : 'vertical', hole, controls: controlRects(m),
      rings: rb ? [rectToViewport(m, rb)] : [], ringStroke: RING_STROKE * Math.max(m.kx, m.ky),
    };
  }

  function hover(ref: DatumRef | null): void { if (!sameRef(ref, lastHover)) { lastHover = ref; actions.hover(ref); } }

  function markLegend(sliceKey: string | null): void {
    if (legendMarked) {
      if (legendMarked.dataset.key === sliceKey && legendMarked.parentNode === legendList) return;
      legendMarked.classList.remove('axylo-legend-current');
      legendMarked = geoControls = null;
    }
    if (sliceKey !== null && legendList) {
      for (const child of legendList.children) {
        const li = child as HTMLElement;
        if (li.dataset.key !== sliceKey) continue;
        li.classList.add('axylo-legend-current');
        legendMarked = li; geoControls = null;
        break;
      }
    }
  }

  function markFocusedSlice(d: Committed | null): void {
    markLegend(plotReady(d) && proxyFocused && focus?.kind === 'slice' ? focus.sliceKey : null);
  }

  const readingLang = (d: Committed) => d.english(
    !plotReady(d) || !readable(d) ? 'empty' : d.view.kind === 'donut' || (!single && d.view.kind !== 'scatter') ? 'pointAll' : 'pointOf',
  );

  function writeProxy(acted: boolean): void {
    const d = c;
    if (!proxy || !d) return;
    const { view, lookup, formatters, messages } = d;
    markFocusedSlice(d);
    const lang = readingLang(d), hasData = plotReady(d) && readable(d);
    const empty = hasData ? messages.noData : recoverable(d) || plotReady(d) ? messages.empty : d.message ?? messages.noData;
    const inactive = !acted && !proxyFocused && !focus;
    if (inactive) {
      const inputs = [hasData ? lookup : null, hasData ? view : null, formatters, messages, lang, empty];
      if (sameKey(idleReading, inputs)) return;
      idleReading = inputs;
    } else idleReading = null;
    setAttr(proxy, 'lang', lang);
    const ref = hasData ? focus ?? firstDatum(d) : null;
    if (!ref) {
      if (proxy.max !== '0') proxy.max = '0';
      if (proxy.value !== '0') proxy.value = '0';
      shownOrdinal = 0;
      setAttr(proxy, 'aria-valuetext', empty);
      shownText = null;
      return;
    }
    const max = String(Math.max(0, lookup.count - 1)), ord = Math.max(0, lookup.ordinal(ref)), os = String(ord);
    if (proxy.max !== max) proxy.max = max;
    if (proxy.value !== os) proxy.value = os;
    if (inactive) {
      // Position changes need no announcement suppression when the range has no focus.
      setAttr(proxy, 'aria-valuetext', valueText(view, lookup, ref, mode(), formatters, messages) ?? messages.noData);
      shownText = null;
    } else {
      const reading = datumReading(view, lookup, ref, mode(), formatters, messages);
      if (acted || !shownText || !sameRef(ref, shownText.r) || single !== shownText.s || reading !== shownText.d || !proxy.hasAttribute('aria-valuetext')) {
        setAttr(proxy, 'aria-valuetext', valueText(view, lookup, ref, mode(), formatters, messages) ?? messages.noData);
        shownText = { r: ref, s: single, d: reading };
      }
    }
    shownOrdinal = ord;
  }

  function stepFrom(d: Committed, from: DatumRef, dir: StepDirection): DatumRef | null {
    if (!single && from.kind === 'aligned' && isAligned(d.view)) {
      const x = stepAcross(d.view, from.x, dir);
      return x === null ? null : d.lookup.primary({ kind: 'x', x });
    }
    if (single && from.kind === 'point' && d.view.kind === 'scatter' && parts.stepInSeries) return parts.stepInSeries(d.view, from, dir);
    return d.lookup.step(from, dir);
  }

  function keyboardLeads(d: Committed): void { shown = KEY; pinPage = 0; rest = null; if (focus) reached(keyboardTarget(d, focus)); }

  function move(dir: StepDirection): void {
    const d = c;
    if (!plotReady(d)) return;
    takeover(d);
    const from = focus;
    if (focus) focus = stepFrom(d, focus, dir) ?? focus;
    const moved = !sameRef(from, focus);
    if (!moved && shown.k === S_PIN) return;
    keyboardLeads(d); writeProxy(moved); present();
  }

  function moveSeries(delta: 1 | -1): void {
    const d = c;
    if (!plotReady(d)) return;
    takeover(d);
    if (!focus) return;
    const step = delta > 0 ? 'series-next' : 'series-previous';
    if (focus.kind === 'aligned' && isAligned(d.view)) {
      if (!single) { const refs = refsAt(d.view, focus.x), ref = delta > 0 ? refs[0] : refs.at(-1); if (ref) { focus = ref; single = true; } }
      else focus = d.lookup.step(focus, step) ?? focus;
    } else if (focus.kind === 'point') { focus = d.lookup.step(focus, step) ?? focus; single = true; }
    keyboardLeads(d); writeProxy(true); present();
  }

  function atOrdinal(d: Committed, ord: number): DatumRef | null {
    const { view, lookup } = d;
    if (isAligned(view)) {
      const { start, end } = view.visibleSlots, x = view.frame.x.values[start + clamp(ord, 0, Math.max(0, end - start - 1))];
      if (x === undefined) return null;
      return single && focus?.kind === 'aligned' ? lookup.resolve({ kind: 'aligned', seriesKey: focus.seriesKey, x }) : lookup.primary({ kind: 'x', x });
    }
    let ref = lookup.step(null, 'first');
    for (let i = 0; ref && i < ord && i < lookup.count; i++) { const next = lookup.step(ref, 'next'); if (!next) break; ref = next; }
    if (ref && single && focus && 'seriesKey' in focus && 'seriesKey' in ref && ref.seriesKey !== focus.seriesKey) single = false;
    return ref;
  }

  function onProxyKey(e: KeyboardEvent): void {
    const d = c;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const { key } = e, consume = () => { e.preventDefault(); e.stopPropagation(); }, rec = recoverable(d);
    if (!rec && !plotReady(d)) return;
    if (!rec) fromClick = false;
    if (d!.zoom) {
      if (!rec && (key === '+' || key === '=')) { consume(); zoomBy(1 / ZOOM_FACTOR); return; }
      if (key === '-' || key === '_') { consume(); zoomBy(ZOOM_FACTOR); return; }
      if (key === '0') { consume(); requestZoom(null); return; }
    }
    if (e.shiftKey && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      if (rec) consume(); else e.preventDefault();
      if (d!.zoom) pan(key === 'ArrowRight' ? PAN_SHARE : -PAN_SHARE);
      return;
    }
    const upDown = key === 'ArrowUp' || key === 'ArrowDown';
    if (rec || !readable(d!)) { if (key in NAVIGATION || upDown || (!rec && (key === 'Enter' || key === ' '))) e.preventDefault(); return; }
    const ready = d as Committed & { readonly ready: true };
    if (upDown && ready.view.kind !== 'donut') { e.preventDefault(); moveSeries(key === 'ArrowDown' ? 1 : -1); return; }
    if (key === 'Enter' || key === ' ') { e.preventDefault(); focus ??= firstDatum(ready); if (focus) actions.select(focus); return; }
    if (key === 'Escape') {
      if (single) {
        consume(); single = false;
        if (focus?.kind === 'aligned') focus = ready.lookup.primary({ kind: 'x', x: focus.x }) ?? focus;
        writeProxy(true); present();
      }
      return;
    }
    const dir = NAVIGATION[key] ?? (ready.view.kind === 'donut' && upDown ? (key === 'ArrowUp' ? 'next' : 'previous') : undefined);
    if (dir) { e.preventDefault(); move(dir); }
  }

  function onProxyInput(): void {
    const d = c;
    if (!proxy || !plotReady(d)) return;
    if (!readable(d)) { writeProxy(false); return; }
    const ord = Number(proxy.value);
    if (!Number.isFinite(ord) || ord === shownOrdinal) return;
    takeover(d); focus = atOrdinal(d, ord) ?? focus; keyboardLeads(d); writeProxy(true); present();
  }

  function onProxyFocus(): void {
    const d = c; proxyFocused = true;
    if (!plotReady(d)) { writeProxy(true); return; }
    fromClick = clickFocus; takeover(d);
    if (!clickFocus) keyboardLeads(d);
    writeProxy(true); redraw();
  }

  const setKeyed = (on: boolean) => { keyed = on; proxy?.classList.toggle('axylo-keyed', on); redraw(); };

  function onProxyBlur(): void {
    proxyFocused = fromClick = keyed = false;
    proxy?.classList.remove('axylo-keyed');
    markLegend(null);
    if (shown.k === S_KEY) shown = pointer && c ? { k: S_HOVER, t: plotReady(c) ? pick(c, pointer) : null } : NONE;
    redraw(1);
  }

  const currentWindow = (d: Committed): Span | null =>
    d.view.kind === 'donut' ? null : pendingWindow !== undefined ? (pendingWindow ?? zoomBounds(d)) : d.zoomed ? d.view.xDomain : zoomBounds(d);

  function requestZoom(w: Span | null): void {
    const d = c;
    if (!d || d.view.kind === 'donut') return;
    if (sameWindow(pendingWindow !== undefined ? pendingWindow : d.zoomed ? d.view.xDomain : null, w)) return;
    pendingWindow = w; actions.zoom(w);
  }

  function zoomBy(factor: number, center?: number): boolean {
    const d = c;
    if (!d || d.view.kind === 'donut' || !d.zoom) return false;
    const now = currentWindow(d)!, x = focus?.kind === 'aligned' || focus?.kind === 'point' ? focus.x : NaN;
    const next = zoomStep(zoomBounds(d), now, factor, center ?? (Number.isFinite(x) && x >= now[0] && x <= now[1] ? x : (now[0] + now[1]) / 2), minimumWidth(d.view));
    if (next === undefined) return false;
    requestZoom(next); return true;
  }

  function pan(share: number): void {
    const d = c;
    if (!d || d.view.kind === 'donut' || !d.zoom) return;
    const next = panWindow(zoomBounds(d), currentWindow(d)!, share);
    if (next) requestZoom(next);
  }

  function onWheel(e: WheelEvent): void {
    const d = c;
    if (!plotReady(d) || !d.zoom || !proxy || activeElement() !== proxy || e.ctrlKey || e.metaKey || !e.deltaY) return;
    const p = local(e), unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    if (zoomBy(clamp(Math.exp(e.deltaY * unit * 0.002), 0.25, 4), positionAt(d.layout, p.x, p.y) ?? undefined)) e.preventDefault();
  }

  const clientPoint = (e: MouseEvent): Point => ({ x: e.clientX, y: e.clientY });
  const local = (e: MouseEvent) => toLocal(plotMapping(), clientPoint(e));
  const dismissedBy = (id: Identity, t: PickTarget) => matchesIdentity(id, t) || (id.kind === 'point' && t.kind === 'point' && c !== null && c.lookup.has(t, id.ref));
  const isDismissed = (t: PickTarget) => dismissed !== null && dismissed.some(id => dismissedBy(id, t));
  function reached(t: PickTarget | null): void { if (t && dismissed) { const kept = dismissed.filter(id => dismissedBy(id, t)); dismissed = kept.length ? kept : null; } }
  const pointTo = (t: PickTarget | null) => { reached(t); shown = { k: S_HOVER, t }; };

  function pointerAt(at: Point, time: number): void {
    const d = c;
    if (!plotReady(d)) return;
    pointer = at;
    if (shown.k === S_PIN) return;
    const still = rest !== null && dist(at.x, at.y, rest.p.x, rest.p.y) <= REST_DISTANCE;
    if (shown.k === S_HOVER && shown.t && rest?.g && time - rest.t >= REST_TIME &&
      sameTarget(rest.g, shown.t) && content && sameTarget(content.t, shown.t)) {
      shown = { k: S_HELD, t: shown.t, f: rest.p, b: content.b, a: content.a, p: content.p };
    }
    if (shown.k === S_HELD) {
      if (insideCorridor(shown.f, shown.b, at)) { if (!still) rest = { p: at, t: time, g: shown.t }; present(); return; }
      shown = NO_HOVER;
    }
    const target = pick(d, at);
    pointTo(target);
    if (!still || !rest || !sameTarget(rest.g, target)) rest = { p: at, t: time, g: target };
    present();
  }

  function onPointerMove(e: PointerEvent): void {
    if (e.pointerType === 'touch') {
      const t = touches?.get(e.pointerId);
      if (t) { const at = local(e); t.x = at.x; t.y = at.y; if (pinch?.ids.includes(e.pointerId)) pinchMove(); }
      return;
    }
    if ((down && down.id !== e.pointerId) || tableView) return;
    if (down) {
      const at = local(e);
      if (!down.d && c?.zoom && dist(at.x, at.y, down.x, down.y) > DRAG_THRESHOLD) {
        down.d = true;
        if (shown.k === S_PIN) { shown = NO_HOVER; pinPage = 0; }
        dropView();
      }
      if (down.d) { drawSelection(down, at); return; }
    }
    pointerAt(clientPoint(e), e.timeStamp);
  }

  function leave(): void { pointer = rest = null; if (shown.k === S_HOVER || shown.k === S_HELD) shown = idle(); present(); }
  function onStageLeave(e: PointerEvent): void { if (e.pointerType !== 'touch' && !down?.d) { clearGeo(); leave(); } }

  function drawSelection(from: Point, to: Point): void {
    const d = c;
    if (d?.layout.kind !== 'plot') return;
    if (!selection) { selection = make(doc, 'div', 'axylo-selection'); hideFromAT(selection); plot.appendChild(selection); }
    const p = d.layout.plot;
    const span = (a: number, b: number, lo: number, ext: number): [number, number] => {
      const u = clamp(a, lo, lo + ext), v = clamp(b, lo, lo + ext);
      return [Math.min(u, v), Math.abs(v - u)];
    };
    const [x, width] = horizontalBars(d) ? [p.x, p.width] : span(from.x, to.x, p.x, p.width);
    const [y, height] = horizontalBars(d) ? span(from.y, to.y, p.y, p.height) : [p.y, p.height];
    selection.style.cssText = boxStyle({ x, y, width, height });
    selection.hidden = false;
  }

  function markRange(d: Committed): void {
    const px = range?.s == null ? null : pixelOf(d.layout, range.s);
    if (px === null) { if (selection && !down?.d) selection.hidden = true; return; }
    const at = horizontalBars(d) ? { x: 0, y: px } : { x: px, y: 0 };
    drawSelection({ x: at.x - 1, y: at.y - 1 }, { x: at.x + 1, y: at.y + 1 });
  }

  function endRange(): void { if (!range) return; range = null; if (selection && !down?.d) selection.hidden = true; if (cs) renderControls(cs); }

  function endDrag(): void {
    if (selection) selection.hidden = true;
    if (range && c) markRange(c);
    const was = down; down = null;
    if (was && plot.hasPointerCapture?.(was.id)) { try { plot.releasePointerCapture(was.id); } catch { /* released */ } }
  }

  function applyRange(d: Committed, a: number, b: number): void {
    const next = rangeWindow(zoomBounds(d), a, b, minimumWidth(d.view));
    endRange();
    if (next !== undefined) requestZoom(next);
  }

  function endTouch(id: number, apply: boolean): boolean {
    touches?.delete(id);
    if (pinch?.ids.includes(id)) stopPinch(apply);
    const wasPinch = pinched;
    if (!touches?.size) pinched = false;
    return wasPinch;
  }

  function onPointerDown(e: PointerEvent): void {
    const d = c;
    if (!plotReady(d)) return;
    if (keyed) setKeyed(false);
    const at = local(e);
    if (e.pointerType === 'touch') {
      const map = touches ??= new Map();
      map.set(e.pointerId, { x: at.x, y: at.y, x0: at.x, y0: at.y, t0: e.timeStamp });
      if (map.size === 2 && d.zoom === 'touch' && d.view.kind !== 'donut') startPinch(d);
      if (map.size > 1) pinched = true;
      return;
    }
    if (e.button !== 0 || down) return;
    down = { id: e.pointerId, x: at.x, y: at.y, d: false };
    try { plot.setPointerCapture(e.pointerId); } catch { /* gone */ }
  }

  function onPointerUp(e: PointerEvent): void {
    const d = c;
    if (e.pointerType === 'touch') {
      const t = touches?.get(e.pointerId);
      if (endTouch(e.pointerId, true)) return;
      const up = local(e);
      if (t && plotReady(d) && dist(up.x, up.y, t.x0, t.y0) < TAP_DISTANCE && e.timeStamp - t.t0 < TAP_TIME) activate(d, clientPoint(e), false);
      return;
    }
    if (down?.id !== e.pointerId) return;
    const was = down; endDrag();
    if (!plotReady(d)) return;
    if (was.d) {
      const at = local(e), a = positionAt(d.layout, was.x, was.y), b = positionAt(d.layout, at.x, at.y);
      if (a === null || b === null || d.view.kind === 'donut') return;
      applyRange(d, a, b);
      pointerAt(clientPoint(e), e.timeStamp);
      return;
    }
    activate(d, clientPoint(e), true);
  }

  function activate(d: Committed & { readonly ready: true }, at: Point, mouse: boolean): void {
    if (range && d.view.kind !== 'donut' && d.layout.kind === 'plot') {
      const p = plotPoint(d, at), pr = d.layout.plot, x = positionAt(d.layout, p.x, p.y);
      if (x === null || p.x < pr.x || p.x > pr.x + pr.width || p.y < pr.y || p.y > pr.y + pr.height) return;
      if (range.s === null) { range.s = x; markRange(d); return; }
      applyRange(d, range.s, x); return;
    }
    const target = pick(d, at);
    pointer = mouse ? at : null; rest = null; pinPage = 0;
    if (!target) { shown = mouse ? NO_HOVER : idle(); redraw(); return; }
    const ref = d.lookup.primary(target) ? resolveAligned(d, target) : null;
    dismissed = null;
    shown = ref && presentationFor(d) !== 'none' ? { k: S_PIN, r: ref, t: target } : { k: S_HOVER, t: target };
    if (shown.k === S_PIN) listenPin();
    if (mouse && proxy) { clickFocus = true; try { focusQuiet(proxy); } finally { clickFocus = false; } }
    if (ref) { focus = ref; writeProxy(true); actions.select(ref); }
    redraw(2);
  }

  function onPointerCancel(e: PointerEvent): void {
    if (e.pointerType === 'touch') { endTouch(e.pointerId, false); return; }
    if (down && down.id !== e.pointerId) return;
    endDrag(); leave();
  }

  function endPin(): void {
    if (shown.k !== S_PIN) return;
    pinPage = 0;
    shown = pointer && plotReady(c) ? { k: S_HOVER, t: pick(c, pointer) } : idle();
  }

  function startPinch(d: Committed): void {
    if (!touches || d.view.kind === 'donut') return;
    const [[ia, a] = [], [ib, b] = []] = touches;
    if (ia === undefined || ib === undefined || !a || !b) return;
    const w = currentWindow(d)!;
    pinch = { ids: [ia, ib], d: Math.max(1, dist(a.x, a.y, b.x, b.y)), w, c: positionAt(d.layout, (a.x + b.x) / 2, (a.y + b.y) / 2) ?? (w[0] + w[1]) / 2 };
    if (shown.k === S_PIN) { shown = idle(); pinPage = 0; }
    dropView();
    draw(d, null);
  }

  function pinchMove(): void {
    const d = c, a = pinch && touches?.get(pinch.ids[0]), b = pinch && touches?.get(pinch.ids[1]);
    if (!pinch || !a || !b || !plotReady(d) || d.view.kind === 'donut' || d.layout.kind !== 'plot') return;
    const width = pinchWidth(pinch.w[1] - pinch.w[0], pinch.d / Math.max(1, dist(a.x, a.y, b.x, b.y)), minimumWidth(d.view));
    const p = d.layout.plot, full = zoomBounds(d);
    const share = horizontalBars(d) ? (p.y + p.height - (a.y + b.y) / 2) / p.height : ((a.x + b.x) / 2 - p.x) / p.width;
    const start = clamp(pinch.c - share * width, full[0], full[1] - width);
    pinchWindow = width >= full[1] - full[0] ? null : [start, start + width];
    if (!pinchFrame) pinchFrame = win()!.requestAnimationFrame(() => { pinchFrame = 0; if (pinchWindow !== undefined) requestZoom(pinchWindow); pinchWindow = undefined; });
  }

  function onEscape(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const spend = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    const inChart = focusedFigure(doc, root);
    if (inChart !== root && (inChart !== null || (!isLastShowing() && !down?.d))) return;
    if (down?.d) { spend(); endDrag(); return; }
    if (range) { spend(); endRange(); return; }
    const target = shownTarget();
    if (!target || (!tooltip?.visible && shown.k !== S_PIN)) return;
    spend();
    dismissed = [identityOf(target, shown.k === S_PIN ? shown.r : shown.k === S_KEY ? focus : c?.lookup.primary(target) ?? null)];
    pinPage = 0;
    if (shown.k === S_HELD) {
      const under = pointer && plotReady(c) ? pick(c, pointer) : null;
      if (under) dismissed.push(identityOf(under, c!.lookup.primary(under)));
      shown = { k: S_HOVER, t: under };
    } else if (shown.k === S_PIN) shown = pointer ? { k: S_HOVER, t: target } : idle();
    rest = null; redraw();
  }

  function onScroll(): void {
    clearGeo();
    const d = c;
    if (!plotReady(d)) return;
    if ((shown.k === S_HOVER || shown.k === S_HELD) && pointer) { rest = null; pointTo(pick(d, pointer)); }
    else if (!tooltip?.visible) return;
    redraw();
  }

  function jumpTarget(raw: string): XValue | null {
    const d = cs;
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

  function openTable(): void {
    const d = cs;
    if (!d?.reader.table || tableView) return;
    tableView = createTableView(doc, figure.id, jumpTarget);
    root.classList.add('axylo-table-open'); plot.inert = true;
    pointer = rest = tableModel = null; pinPage = 0; shown = NONE;
    dropView(); clearGeo(); renderTable(d); tableView.focus();
  }

  function closeTable(restore = true): void {
    if (!tableView) return;
    const inside = tableView.element.contains(activeElement());
    tableView.destroy(); tableView = tableModel = null; clearGeo();
    root.classList.remove('axylo-table-open'); plot.inert = false;
    if (inside && restore && !toolbar?.focus('table')) {
      if (proxy && !proxy.hidden) focusQuiet(proxy);
      if (!proxy || proxy.hidden || activeElement() !== proxy) focusFigure();
    }
  }

  function renderTable(d: ControlsState): void {
    const model = d.reader.table;
    if (!tableView || !model) return;
    if (model !== tableModel) {
      tableModel = model;
      const { messages: m, formatters: f } = d, qual = ` (${fill(m.incompleteStack, {})})`, qualLang = d.english('incompleteStack');
      tableView.update(model, {
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
    if (tableView.element.parentNode !== figure.stage) figure.stage.appendChild(tableView.element);
  }

  function controlItems(d: ControlsState): ToolbarItem[] {
    const { messages: m, view } = d, items: ToolbarItem[] = [], inherited = d.english('controlsLabel') ? d.pageLang : null;
    if (d.ready && d.legend && view.kind !== 'donut' && !d.tooSmall && view.frame.series.length > 1) {
      view.frame.series.forEach(({ key, label }, i) => {
        const on = view.visible[i] === true;
        items.push({
          key: `series:${key}`, label, pressed: on, lang: inherited, className: 'axylo-control axylo-legend-entry',
          struck: !on, swatch: parts.swatch(i, view.cues[i] ?? null, !on), activate: () => actions.toggle(key),
        });
      });
    }
    const btn = (key: Exclude<keyof Messages, InstructionKey>, activate: () => void, disabled = false, extra?: Partial<ToolbarItem>): ToolbarItem =>
      ({ key, label: m[key] ?? defaultMessages[key], lang: d.english(key) ?? inherited, className: 'axylo-control', activate, disabled, ...extra });
    if (canZoom(d)) {
      const { xDomain: now, xFull: full } = d.view;
      if (d.ready) {
        items.push(
          btn('zoomIn', () => zoomBy(1 / ZOOM_FACTOR), !canZoomIn(d.view, d.zoomed ? now : full)),
          btn('selectRange', () => { if (range) endRange(); else { range = { s: null }; if (cs) renderControls(cs); } }, false, {
            pressed: range !== null, symbol: 'range', className: 'axylo-control axylo-control-symbol',
          }),
        );
      }
      if (d.ready || d.zoomed) items.push(btn('zoomOut', () => zoomBy(ZOOM_FACTOR), !d.zoomed));
      if (d.zoomed) items.push(btn('panLeft', () => pan(-0.5), !(now[0] > full[0])), btn('panRight', () => pan(0.5), !(now[1] < full[1])), btn('resetZoom', () => requestZoom(null)));
    }
    if (d.streaming) items.push(btn(d.paused ? 'resume' : 'pause', () => actions.pause(!d.paused), false, { key: 'pause' }));
    if (canInspect(d)) {
      const open = tableView !== null;
      items.push(btn(open ? 'hideTable' : 'viewAsTable', () => { if (tableView) closeTable(); else openTable(); if (cs) renderControls(cs); }, false, {
        key: 'table', expanded: open, controls: `${figure.id}-table`,
      }));
    }
    return items;
  }

  function removeLegend(): void {
    if (!legendList) return;
    markLegend(null);
    sliceLists.get(legendList)?.l.clear();
    sliceLists.delete(legendList);
    legendList.remove();
  }

  function controlInputs(d: ControlsState, out: unknown[]): void {
    const { view } = d;
    out.push(d.messages, d.english('controlsLabel'), d.pageLang, d.legend, tableView !== null, range !== null, canInspect(d), d.streaming, d.paused);
    if (tableView) out.push(d.reader.table, d.formatters);
    if (canZoom(d)) {
      const { xDomain: now, xFull: full } = d.view;
      out.push(true, d.ready, d.zoomed, d.ready && canZoomIn(d.view, d.zoomed ? now : full), d.zoomed && now[0] > full[0], d.zoomed && now[1] < full[1]);
    } else out.push(false);
    if (showsSlices(d)) out.push(view, d.formatters, d.ready, d.english('noData'));
    else if (view.kind !== 'donut' && d.ready && d.legend && !d.tooSmall && view.frame.series.length > 1) {
      view.frame.series.forEach((s, i) => {
        const cue = view.cues[i];
        out.push(s.key, s.label, view.visible[i] === true, cue?.marker, cue?.dash.normal, cue?.dash.contrast);
      });
    }
  }

  function renderControls(d: ControlsState, measure = false): boolean {
    cs = d;
    const inputs = controlScratch ??= [];
    controlInputs(d, inputs);
    if (sameKey(lastControls, inputs)) { inputs.length = 0; return false; }
    const before = measure ? figure.controlsSignature() : '';
    controlScratch = lastControls;
    if (controlScratch) controlScratch.length = 0;
    lastControls = inputs; controlNodes = null; clearGeo();

    const inLegend = legendList !== null && legendList.contains(activeElement());
    const nextList = parts.sliceList?.(doc, d, actions, legendList) ?? null;
    if (!nextList && legendList) removeLegend();
    legendList = nextList;
    if (inLegend && (!legendList || !legendList.contains(activeElement()))) focusFigure();

    const items = controlItems(d), inToolbar = toolbar?.element.contains(activeElement());
    if (items.length || toolbar) (toolbar ??= createToolbar(doc)).render(items, d.messages.controlsLabel, d.english('controlsLabel'));
    const legend: Element[] = [];
    if (legendList) legend.push(legendList);
    if (items.length && toolbar) legend.push(toolbar.element);
    const slot = d.legend === 'top' ? 'top' : d.legend === 'right' ? 'side' : 'controls';
    if (tableView && !canInspect(d)) closeTable(); else if (tableView) renderTable(d);
    const act = activeElement();
    figure.placeControls(slot, legend);
    for (const s of ['top', 'side', 'controls'] as const) if (s !== slot) figure.placeControls(s, []);
    markFocusedSlice(c);
    if (isFocusable(act) && act !== activeElement() && act.isConnected) focusQuiet(act);
    else if (inToolbar && !items.length) focusFigure();
    return measure && figure.controlsSignature() !== before;
  }

  function renderInstructions(el: HTMLElement, list: readonly { text: string; lang: string | null }[], proxyLang: string | null, pageLang: string | null): void {
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
      const span = el.children[i] ?? el.appendChild(doc.createElement('span'));
      setText(span, i ? ` ${text}` : text);
      setAttr(span, 'lang', langOf(lang));
    });
    while (el.children.length > list.length) el.lastElementChild!.remove();
  }

  function placeProxy(d: Committed): void {
    if (!proxy || !ring) return;
    const ready = plotReady(d), usable = ready || recoverable(d);
    if (usable !== proxyUsable) {
      proxyUsable = usable;
      if (!usable && activeElement() === proxy && !toolbar?.focus('table')) focusFigure();
      for (const el of [proxy, ring, instructions]) if (el && el.hidden === usable) el.hidden = !usable;
    }
    if (!usable) return;
    const p = plotBox(d);
    if (!proxyRect || proxyRect.x !== p.x || proxyRect.y !== p.y || proxyRect.width !== p.width || proxyRect.height !== p.height) {
      proxy.style.cssText = ring.style.cssText = boxStyle(p);
    }
    proxyRect = p;
    const count = instructionSeries(d), lang = readingLang(d);
    const inputs = [d.kind, d.messages, d.zoom, ready, ready && offersZoom(d), count, lang, d.pageLang,
      d.english('plotInstructions'), d.english('seriesInstructions'), d.english('donutInstructions'), d.english('zoomInstructions')];
    if (sameKey(proxyMeta, inputs)) return;
    proxyMeta = inputs;
    setAttr(proxy, 'aria-label', d.messages.plotLabel);
    if (instructions) {
      const desc = descriptionFor(d, count);
      renderInstructions(instructions, desc, lang, d.pageLang);
      setAttr(proxy, 'aria-describedby', desc.length ? instructions.id : null);
    }
    setAttr(proxy, 'aria-roledescription', fill(d.messages.plotRole, { type: chartTypeName(d.messages, d.kind) }));
    setClass(plot, 'axylo-touch-zoom', d.zoom === 'touch');
    setClass(plot, 'axylo-zoomable', d.zoom !== false);
  }

  function remapper(before: View, after: View): ((ref: DatumRef | null, exact?: boolean) => DatumRef | null) | null {
    const from = categoriesOf(before), to = categoriesOf(after);
    if (!from || !to || (from.length === to.length && from.every((n, i) => to[i] === n))) return null;
    const index = new Map(to.map((n, i) => [n, i]));
    return (ref, exact) => {
      if (ref?.kind !== 'aligned') return ref;
      for (let i = ref.x; i < from.length; i++) { const at = index.get(from[i]!); if (at !== undefined) return { ...ref, x: at }; if (exact) return null; }
      return null;
    };
  }

  function remapTarget<T extends PickTarget | Identity>(t: T | null, map: (r: DatumRef | null, exact?: boolean) => DatumRef | null): T | null {
    if (t?.kind !== 'x') return t;
    const m = map({ kind: 'aligned', seriesKey: '', x: t.x }, true);
    return m?.kind === 'aligned' ? { kind: 'x', x: m.x } as T : null;
  }

  function stillPinned(next: Committed, ref: DatumRef, target: PickTarget): { r: DatumRef; t: PickTarget } | null {
    if (!plotReady(next) || !readable(next)) return null;
    const { lookup } = next;
    if (target.kind === 'point') {
      if (ref.kind !== 'point' || lookup.ordinal(ref) < 0) return null;
      const b = lookup.anchor(ref);
      return b ? { r: ref, t: pointGroup(next, ref, b) } : null;
    }
    if (target.kind === 'slice') return ref.kind === 'slice' && lookup.ordinal(ref) >= 0 ? { r: ref, t: target } : null;
    return sameRef(lookup.resolve(ref), ref) && lookup.tooltip(target).rows.length ? { r: ref, t: target } : null;
  }

  const dropHold = (d: Committed, allowPick = true) => { rest = null; if (allowPick && pointer) pointTo(pick(d, pointer)); else shown = idle(); };
  const resetCore = () => { single = false; dismissed = shownText = focus = rest = null; pinPage = 0; };

  function reconcile(previous: Committed | null, next: Committed): void {
    const { lookup } = next;
    if (previous && previous.epoch !== next.epoch) {
      resetCore(); lastHover = null;
      shown = shown.k === S_KEY ? shown : pointer ? NO_HOVER : idle();
    } else if (previous) {
      const map = remapper(previous.view, next.view);
      if (map) {
        focus = map(focus);
        if (shownText) { const moved = map(shownText.r, true); shownText = moved ? { ...shownText, r: moved } : null; }
        if (!focus) single = false;
        lastHover = map(lastHover);
        if (dismissed) { const kept = dismissed.flatMap(id => remapTarget(id, map) ?? []); dismissed = kept.length ? kept : null; }
        if (shown.k === S_PIN) { const t = remapTarget(shown.t, map), r = map(shown.r, true); shown = t && r ? { k: S_PIN, r, t } : NO_HOVER; }
        else if (shown.k === S_HELD) { const t = remapTarget(shown.t, map); shown = t ? { ...shown, t } : NO_HOVER; }
      }
    }
    if (focus) {
      const res = lookup.resolve(focus); focus = res;
      if (!res) single = false; else if (!single && res.kind === 'aligned') focus = lookup.primary({ kind: 'x', x: res.x }) ?? res;
    }
    if (!focus && proxyFocused && plotReady(next) && readable(next)) focus = firstDatum(next);

    const pres = presentationFor(next);
    if (!plotReady(next)) { if (shown.k !== S_KEY) shown = pointer ? NO_HOVER : idle(); pinPage = 0; return; }
    if (shown.k === S_PIN) {
      const kept = pres === 'none' ? null : stillPinned(next, shown.r, shown.t);
      if (kept) shown = { k: S_PIN, ...kept };
      else { endPin(); if ((shown as Shown).k === S_HOVER && pointer) pointTo(pick(next, pointer)); }
    } else if (shown.k === S_HELD) {
      if (pres !== shown.p || !sameRect(anchorOf(next, shown.t), shown.a) || !lookup.tooltip(shown.t).rows.length) dropHold(next, !down?.d);
    } else if (shown.k === S_HOVER && pointer && !down?.d) {
      const before = shown.t; pointTo(pick(next, pointer));
      const now = (shown as Shown).k === S_HOVER ? (shown as Extract<Shown, { k: 2 }>).t : null;
      const moved = now !== null && content !== null && sameTarget(content.t, now) && !sameRect(anchorOf(next, now), content.a);
      if (!sameTarget(before, now) || moved) rest = { p: pointer, t: clock(), g: now };
    }
  }

  function commit(next: Committed | null): void {
    if (destroyed) return;
    clearGeo();
    const prev = c;
    pendingWindow = undefined;
    if (!next?.interactive) { clear(); c = next; return; }
    if (prev?.view !== next?.view) swatches.length = 0;
    c = next; dirty = true;
    build();
    if (range && !(plotReady(next) && next.zoom && next.view.kind !== 'donut')) { range = null; if (selection && !down?.d) selection.hidden = true; }
    else if (range && !down?.d) markRange(next);
    // An untouched chart has no datum identity to carry across frame revisions.
    if (shown.k !== S_NONE || proxyFocused || focus || pointer || dismissed) reconcile(prev, next);
    placeProxy(next); writeProxy(false); renderControls(next);
    if (shown.k !== S_NONE || proxyFocused || lastPres || lastHover || overlayVisible || pinListeners) present();
    if (shown.k === S_HELD && (!content || !sameRect(content.b, shown.b)) && plotReady(next)) { dropHold(next); redraw(); }
  }

  function prepare(state: ControlsState): boolean {
    if (destroyed) return false;
    clearGeo();
    const nextPres = presentationFor(state), strip = nextPres === 'strip', readoutChanged = root.classList.contains('axylo-readout-mode') !== strip;
    if (!state.interactive && !proxy && !c && !cs && !readoutChanged) return false;
    let controlsChanged: boolean;
    if (!state.interactive) {
      const before = figure.controlsSignature(); clear(); c = cs = null;
      controlsChanged = figure.controlsSignature() !== before;
    } else { build(); controlsChanged = renderControls(state, true); }
    if (readoutChanged) {
      root.classList.toggle('axylo-readout-mode', strip);
      dropView(shown.k !== S_PIN || nextPres === 'none');
      if (shown.k === S_HELD) shown = pointer ? NO_HOVER : idle();
      rest = pointer ? { p: pointer, t: clock(), g: pointerTarget() } : null;
    }
    return readoutChanged || controlsChanged;
  }

  function clear(): void {
    swatches.length = 0; clearGeo();
    unlistenPin();
    if (c) draw(c, null);
    if (!lastPres && !proxy && !tooltip?.visible && !legendList && !tableView && !lastHover) return;
    lastPres = null;
    const owned = focusOwned();
    hideTooltip(); unbuild(owned); resetCore();
    shown = NONE; content = range = pointer = null; proxyFocused = fromClick = keyed = false;
    hover(null);
  }

  return {
    prepare, commit,
    clear() { clear(); c = cs = null; },
    attach() { if (attached || destroyed) return; attached = true; clearGeo(); registerFigure(); listenDocument(); },
    detach() { if (!attached) return; attached = false; clearGeo(); cancelGestures(); endPin(); dropView(); unregisterFigure(); unlistenDocument(); },
    destroy() {
      if (destroyed) return;
      clear(); unregisterFigure(); tooltip?.destroy();
      tooltip = c = cs = null;
      destroyed = true; stopPinch();
    },
  };
}
