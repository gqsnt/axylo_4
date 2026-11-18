/**
 * Everything a reader uses to explore a full chart (decision 0001; spec I1–I6, A2–A4, A7): what is shown,
 * driven by pointer, touch and keyboard alike, and what is derived from it: the tooltip, the overlay (drawn
 * with `renderer.drawOverlay`, never by redrawing the scene), the keyboard proxy's range and value text and
 * the `hover` event. Plus the toolbar (legend, zoom, pause, table), the table view and the zoom gestures.
 *
 * What is shown is one small state machine (decision 0004 revision 3), `shown`:
 *
 *   none ── nothing (the pointer is away and the keyboard does not lead)
 *   hover ── the datum the pointer picks now (or nothing, over empty plot)
 *   held ── rule 3b: after a rest of 250 ms on a datum whose content is on show, that datum, while the
 *           pointer stays in the corridor from the resting point to the content's rectangle; it carries the
 *           geometry (anchor, rectangle) and presentation it was taken in
 *   pinned ── one datum (`ref`, the one the reader chose) and the rows shown with it
 *   keyboard ── the keyboard's datum (`focus`)
 *
 * `commit` reconciles it against the new displayed frame before anything is presented: a pin follows its
 * datum and ends with it; a hold ends when its datum's anchor, its content's rectangle or the presentation
 * changes, and picking is then from the pointer at once; a hover is picked again. Activation (click, tap,
 * Enter) never reads this state: a click or a tap picks afresh, Enter uses the keyboard's datum.
 *
 * The controller calls `commit` after every frame it draws, with the state that frame shows; this module
 * never reads a newer state than the marks show. It changes the chart only through `actions`, which go
 * through the public paths (zoom, the view's hidden set, pause), so every change follows the commit contract.
 *
 * Every listener on the chart's own elements is registered with one abort signal per build, so clearing the
 * layer or destroying the chart removes them all.
 */
import type {
  DatumRef, DatumText, Formatters, Layout, Lookup, MarkRenderer, Overlay, PaintBindings, PickTarget, ReaderModel,
  Rect, ResolvedTheme, StepDirection, TooltipModel, View, XValue,
} from '../core/contracts';
import type { Messages } from '../public';
import { fill } from '../messages';
import {
  overlayWith, OUTLINE_REACH, RING_REACH, RING_STROKE, alignedRows, canZoomIn, datumReading, groupRefs, minimumWidth, panWindow,
  pinchWidth, pixelOf, positionAt, rangeWindow, refsAt, ringRect, sameRef, stepAcross, zoomStep, targetBox, targetOf, valueText, PAN_SHARE, ZOOM_FACTOR,
  type Mode, type TargetMarks,
} from '../core/focus';
import type { Figure } from './figure';
import { createTableView, type TableView } from './table';
import { createToolbar, type Toolbar, type ToolbarItem } from './toolbar';
import { createTooltip, type Presentation, type TooltipContent } from './tooltip';
import { createSwatch, swatchPattern, type SwatchPattern, type SwatchSpec } from './swatch';
import { sliceText } from '../lookup/text';
import { barPattern } from '../scene/bars';
import { readPosition } from '../reader/x';
import { setAttr } from './attributes';
import { mappingOf, rectToViewport, toLocal, toViewport, visibleRegion, type Point } from './mapping';
import { insideCorridor, intersect, type PlacementInput } from './placement';
import { identityOf, matchesIdentity, sameTarget, type Identity } from './pointer';

type Span = readonly [number, number];

/**
 * Readout mode (decision 0004 rule 5), decided by the controller's layout: a floating tooltip, the strip
 * reserved under the plot, or no readout at all (a plot the strip would make smaller than L8 allows).
 */
export type ReadoutMode = 'floating' | 'strip' | 'none';

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
   * Readout mode (decision 0004 rule 5), decided by the controller's layout. Read only through `readoutOf`.
   * A boolean is the controller's earlier form: true for the strip, false for floating.
   */
  readonly readout?: boolean | ReadoutMode;
  /** Readout mode as the controller's layout decided it (the controller's three-state field; preferred). */
  readonly readoutMode?: ReadoutMode;
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

/**
 * The one place readout mode is read from the controller's state (decision 0004 rule 5; review finding 12
 * is the controller's). Until the controller says 'none' itself, its boolean means strip or floating.
 */
export function readoutOf(state: ControlsState): ReadoutMode {
  const r = state.readoutMode ?? state.readout;
  if (r === 'floating' || r === 'strip' || r === 'none') return r;
  return r === true ? 'strip' : 'floating';
}

/** How the content is presented for this state: never, by `tooltip: false`, in the too-small state or without a readout. */
function presentationFor(state: ControlsState): Presentation | 'none' {
  if (!state.interactive || !state.tooltip || state.tooSmall) return 'none';
  const mode = readoutOf(state);
  return mode === 'strip' ? 'strip' : mode === 'none' ? 'none' : 'floating';
}

/**
 * A bar series' pattern (spec F9), from the scene's own rule, so a swatch never disagrees with the marks.
 * Swatches exist on full charts only (the compact variant has no legend or tooltip).
 */
export function seriesPattern(index: number, compact = false): SwatchPattern['kind'] | null {
  const pattern = barPattern(index, compact);
  return pattern === 'none' ? null : pattern;
}

/** How a series is drawn, repeated in its legend and tooltip swatch (spec A5). */
export function seriesSwatch(kind: ControlsState['kind'], index: number, cue: SwatchSpec['cue'], hollow: boolean): SwatchSpec {
  if (kind === 'bar') return barSwatch(index, cue, hollow);
  if (kind === 'area') return areaSwatch(index, cue, hollow);
  return kind === 'line' ? lineSwatch(index, cue, hollow) : pointSwatch(index, cue, hollow);
}

/** One chart kind's series swatch (seriesSwatch with the kind fixed). */
export type SeriesSwatch = (index: number, cue: SwatchSpec['cue'], hollow: boolean) => SwatchSpec;
export const barSwatch: SeriesSwatch = (index, cue, hollow) => {
  const pattern = seriesPattern(index);
  return { color: index, cue, line: false, hollow, fill: true, pattern: pattern && swatchPattern(pattern) };
};
export const areaSwatch: SeriesSwatch = (index, cue, hollow) => ({ color: index, cue, line: false, hollow, fill: true, marker: true, pattern: null });
export const lineSwatch: SeriesSwatch = (index, cue, hollow) => ({ color: index, cue, line: true, hollow });
/** Scatter, and the donut, whose series swatches are never asked for (its rows are slices). */
export const pointSwatch: SeriesSwatch = (index, cue, hollow) => ({ color: index, cue, line: false, hollow });

/** The donut's slice list beside the plot: the list to show (the one given, updated) or null for none. */
export type SliceList = (doc: Document, d: ControlsState, actions: Actions, list: HTMLUListElement | null) => HTMLUListElement | null;

/** What differs between chart kinds in the interaction layer; a kind's composition holds only its own. */
export interface InteractionParts {
  readonly overlay: TargetMarks;
  readonly swatch: SeriesSwatch;
  /** Single mode's Right and Left within one series (scatter); null where single mode steps through the lookup. */
  readonly stepInSeries: ((view: Extract<View, { kind: 'scatter' }>, ref: DatumRef, direction: StepDirection) => DatumRef | null) | null;
  readonly sliceList: SliceList | null;
}

const ROVING_KEYS: Readonly<Record<string, 1 | -1 | 'first' | 'last'>> = {
  ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1, Home: 'first', End: 'last',
};

type SliceEntry = { li: HTMLLIElement; choose: HTMLButtonElement; name: HTMLElement; value: HTMLElement; swatch: string };
/** Each slice list's entries by slice key (made on first use: nothing runs at import). */
let sliceEntries: WeakMap<HTMLUListElement, Map<string, SliceEntry>> | null = null;

export const donutSliceList: SliceList = (doc, d, actions, list) => {
  const view = d.view;
  // The slice list is part of the full chart; the too-small state shows only title, summary and table (L8).
  if (view.kind !== 'donut' || !d.legend || d.tooSmall || !(d.ready || d.inspectable || (view.slices.length > 0 && view.total === 0))) {
    return null;
  }
  if (!list) {
    list = doc.createElement('ul');
    // While the plot cannot be focused (an all-zero donut), the list is how the keyboard reaches the
    // slices: one tab stop, arrows between entries (review finding 3); otherwise the plot's proxy is.
    const own = list;
    own.addEventListener('keydown', event => {
      if (own.dataset.roving !== 'true' || event.altKey || event.ctrlKey || event.metaKey) return;
      const step = ROVING_KEYS[event.key];
      if (step === undefined) return;
      const buttons = [...own.querySelectorAll<HTMLButtonElement>('.axylo-legend-choice')];
      if (!buttons.length) return;
      const at = buttons.findIndex(b => b === doc.activeElement);
      const to = step === 'first' ? 0 : step === 'last' ? buttons.length - 1 : (Math.max(0, at) + step + buttons.length) % buttons.length;
      event.preventDefault();
      for (const [i, b] of buttons.entries()) b.tabIndex = i === to ? 0 : -1;
      buttons[to]!.focus();
    });
    own.addEventListener('focusin', event => {
      if (own.dataset.roving !== 'true') return;
      for (const b of own.querySelectorAll<HTMLButtonElement>('.axylo-legend-choice')) b.tabIndex = b === event.target ? 0 : -1;
    });
  }
  list.className = 'axylo-legend-list';
  const missingLang = d.english('noData');
  // Entries are kept by slice key and updated in place, so a focused entry survives a redraw (review 12).
  sliceEntries ??= new WeakMap();
  let kept = sliceEntries.get(list);
  if (!kept) sliceEntries.set(list, kept = new Map());
  const wanted: HTMLLIElement[] = [];
  for (const slice of view.slices) {
    let entry = kept.get(slice.key);
    if (!entry) {
      const li = doc.createElement('li');
      li.dataset.key = slice.key;
      const name = doc.createElement('span');
      name.className = 'axylo-legend-name';
      const value = doc.createElement('span');
      value.className = 'axylo-legend-value';
      // Every slice, a zero or null one included, can be chosen by pointer as by keyboard: a button named by
      // the entry's text, 24 px tall.
      const choose = doc.createElement('button');
      choose.type = 'button';
      choose.tabIndex = -1;
      choose.className = 'axylo-legend-choice';
      const key = slice.key;
      choose.addEventListener('mousedown', event => event.preventDefault());
      choose.addEventListener('click', () => actions.select({ kind: 'slice', sliceKey: key }));
      li.append(choose);
      entry = { li, choose, name, value, swatch: '' };
      kept.set(slice.key, entry);
    }
    const datum = sliceText(view, slice, d.formatters);
    const swatchSpec = { color: slice.colorIndex, cue: null, line: false, hollow: slice.angles === null };
    const signature = JSON.stringify(swatchSpec);
    if (signature !== entry.swatch) {
      entry.choose.replaceChildren(createSwatch(doc, swatchSpec), entry.name, entry.value);
      entry.swatch = signature;
    }
    if (entry.name.textContent !== slice.label) entry.name.textContent = slice.label;
    const percent = datum?.percent;
    const text = datum ? (percent && percent !== datum.value ? `${datum.value} (${percent})` : datum.value) : '';
    if (entry.value.textContent !== text) entry.value.textContent = text;
    // A missing value is the built-in "No data": marked as English on a page in another language (A10).
    setAttr(entry.value, 'lang', datum && datum.value === d.messages.noData ? missingLang : null);
    wanted.push(entry.li);
  }
  const live = new Set(view.slices.map(slice => slice.key));
  for (const key of [...kept.keys()]) if (!live.has(key)) kept.delete(key);
  let at: ChildNode | null = list.firstChild;
  for (const li of wanted) {
    if (at !== li) list.insertBefore(li, at);
    at = li.nextSibling;
  }
  while (at) {
    const next: ChildNode | null = at.nextSibling;
    at.remove();
    at = next;
  }
  const roving = !d.ready;
  list.dataset.roving = String(roving);
  const buttons = [...list.querySelectorAll<HTMLButtonElement>('.axylo-legend-choice')];
  const focusedAt = buttons.findIndex(b => b === doc.activeElement || b.tabIndex === 0);
  for (const [i, b] of buttons.entries()) b.tabIndex = roving && i === Math.max(0, focusedAt) ? 0 : -1;
  return list;
};

const NAVIGATION: Readonly<Record<string, StepDirection>> = {
  ArrowRight: 'next', ArrowLeft: 'previous', Home: 'first', End: 'last', PageUp: 'page-next', PageDown: 'page-previous',
};
const DRAG_THRESHOLD = 4;
/** Decision 0004 rule 3b: a pointer that stays within 2 CSS px (viewport) for 250 ms has come to rest. */
const REST_DISTANCE = 2;
const REST_TIME = 250;
const TAP_DISTANCE = 10;
const TAP_TIME = 500;
/** Rows of a pinned tooltip per page: the lookup's eight. */
const PAGE_ROWS = 8;
/** How far a control's focus outline reaches outside it (2 px at an offset of 1 px, the stylesheet's). */
const FOCUS_OUTLINE = 3;
/** The donut's inner slice outline reaches 4 px into the hole; the hole candidate keeps 1 px more. */
const HOLE_CLEARANCE = 5;

/** What is shown, and the datum it belongs to (the file comment). */
type Shown =
  | { readonly kind: 'none' }
  | { readonly kind: 'keyboard' }
  | { readonly kind: 'hover'; readonly target: PickTarget | null }
  | {
    readonly kind: 'held'; readonly target: PickTarget;
    /** Where the pointer rested, and the content's rectangle: the corridor (viewport pixels). */
    readonly from: Point; readonly rect: Rect;
    /** The datum's box (viewport) and the presentation the hold was taken in: it ends when either changes. */
    readonly anchor: Rect | null; readonly presentation: Presentation;
  }
  | { readonly kind: 'pinned'; readonly ref: DatumRef; readonly target: PickTarget };

/** What was last presented: the datum, its content's rectangle and anchor, and how. */
interface Content {
  readonly target: PickTarget;
  readonly rect: Rect;
  readonly anchor: Rect | null;
  readonly presentation: Presentation;
}

const NONE: Shown = { kind: 'none' };

function sameWindow(a: Span | null, b: Span | null): boolean {
  return a === b || (a !== null && b !== null && a[0] === b[0] && a[1] === b[1]);
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (a === null || b === null) return a === b;
  // At layout precision: any real change of the geometry a hold was taken in ends it (review finding 6).
  const e = 0.01;
  return Math.abs(a.x - b.x) < e && Math.abs(a.y - b.y) < e && Math.abs(a.width - b.width) < e && Math.abs(a.height - b.height) < e;
}

function categoriesOf(view: View): readonly string[] | null {
  return view.kind !== 'donut' && view.kind !== 'scatter' && view.frame.x.kind === 'category' ? view.frame.x.categories : null;
}

function xKindOf(view: View): 'category' | 'number' | 'date' | 'time' | 'wall' {
  return view.kind === 'donut' ? 'category' : view.kind === 'scatter' ? view.frame.xKind : view.frame.x.kind;
}

/** Bidirectional marks a formatter writes around signs and numbers (the Arabic letter mark, for one). */
const BIDI = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;
const normalized = (text: string) => text.normalize('NFKC').replace(BIDI, '').replace(/[\s\u00a0\u202f]+/gu, ' ').trim().toLowerCase();
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A number typed in the "Jump to" field, read in the x column's own format (review C2-18): its digits (any
 * numbering system the formatter uses), decimal mark, grouping as the formatter groups that integer (or
 * none), a minus sign, and the affixes the column writes (a unit), each optional; anything else, trailing
 * text included, is not a number.
 */
export function parseNumberAs(text: string, format: (n: number) => string, count: (n: number) => string): number | null {
  const digits = new Map<string, string>();
  for (let d = 0; d <= 9; d++) {
    const written = count(d);
    if ([...written].length === 1) digits.set(written, String(d));
  }
  const isDigit = (ch: string) => /\d/u.test(ch) || digits.has(ch);
  const toAscii = (s: string) => [...s].map(ch => digits.get(ch) ?? ch).join('');
  text = text.replace(BIDI, '');
  const sample = format(1234.5).replace(BIDI, '');
  const chars = [...sample];
  const first = chars.findIndex(isDigit);
  let last = -1;
  chars.forEach((ch, i) => { if (isDigit(ch)) last = i; });
  if (first < 0) return null;
  const prefix = chars.slice(0, first).join('').trim();
  const suffix = chars.slice(last + 1).join('').trim();
  const core = chars.slice(first, last + 1);
  // In "1,234.5" the first non-digit is the group mark when four digits follow before the next mark.
  const marks = core.filter(ch => !isDigit(ch));
  const decimal = marks.length >= 2 ? marks[marks.length - 1]! : marks.length === 1 && core.length - core.indexOf(marks[0]!) === 2 ? marks[0]! : '.';
  const groupSample = [...count(1234567)].filter(ch => !isDigit(ch))[0] ?? '';
  let body = text.trim();
  if (prefix && body.startsWith(prefix)) body = body.slice(prefix.length).trim();
  if (suffix && body.endsWith(suffix)) body = body.slice(0, -suffix.length).trim();
  const minus = /^[-−‒–]/u.exec(body);
  if (minus) body = body.slice(minus[0].length);
  const [intPart = '', fracPart, extra] = body.split(decimal);
  if (extra !== undefined || intPart === '') return null;
  const groupClass = groupSample && /^[\s  ]$/u.test(groupSample) ? '[\\s\\u00a0\\u202f]' : escape(groupSample || '\u0000');
  const intDigits = intPart.replace(new RegExp(groupClass, 'gu'), '');
  if (![...intDigits].every(isDigit) || (fracPart !== undefined && (fracPart === '' || ![...fracPart].every(isDigit)))) return null;
  const integer = Number(toAscii(intDigits));
  // Grouping marks are accepted only where the column's own formatter puts them for that integer.
  if (intDigits !== intPart && normalized(toAscii(intPart)) !== normalized(toAscii(count(integer)))) return null;
  const value = Number(`${minus ? '-' : ''}${toAscii(intDigits)}${fracPart !== undefined ? `.${toAscii(fracPart)}` : ''}`);
  return Number.isFinite(value) ? value : null;
}

/**
 * The figure of the chart that most recently showed content: with focus in no chart, only it spends an Escape
 * (decision 0004, clarifications: one key press is spent by at most one chart).
 */
let lastShowing: HTMLElement | null = null;

export function createInteraction(parts: InteractionParts, figure: Figure, renderer: MarkRenderer, actions: Actions): Interaction {
  const doc = figure.figure.ownerDocument;
  const plot = figure.plot;
  // A focused row that a redraw took away hands focus back to the plot (or the figure), never the page.
  const tooltip = createTooltip(figure.tooltip, figure.readout, figure.figure, () => {
    if (proxy && !proxy.hidden) proxy.focus({ preventScroll: true });
    else focusFigure();
  });

  let c: Committed | null = null;
  /** The newest controls state (prepared or committed), for the toolbar's actions. */
  let cs: ControlsState | null = null;
  /** The keyboard's datum. Established before the range, the ring and the tooltip are written. */
  let focus: DatumRef | null = null;
  let mode: Mode = 'all';
  let shown: Shown = NONE;
  /** The pointer over the plot's column, in viewport pixels; null when it is not there. */
  let pointer: Point | null = null;
  /** Rule 3b: where the pointer came to rest (viewport), since when (event time, ms), and on which datum. */
  let rest: { at: Point; time: number; target: PickTarget | null } | null = null;
  /** What the last presentation showed, for a hold to start from. */
  let content: Content | null = null;
  /** Escape closed the tooltip for this datum; it stays closed until another datum is shown. */
  let dismissed: Identity[] = [];
  /** The first of a pinned tooltip's rows on show ("+N more" goes on through them). */
  let pinPage = 0;
  /**
   * "Select range" (spec I4, WCAG 2.5.7: the drag's range with single clicks): null while not pressed, else the
   * first end's x position once the first click set it.
   */
  let range: { start: number | null } | null = null;
  let proxyFocused = false;
  /** The last input was a key the plot handled (the ring is shown whatever :focus-visible says). */
  let keyed = false;
  let clickFocus = false;
  /** The proxy got focus from a click and no key has been pressed since: the pointer still leads. */
  let fromClick = false;
  let shownOrdinal = 0;
  /** What the value text was last written about (decision 0004, part 2); null after a state message. */
  let shownText: { ref: DatumRef; mode: Mode; reading: string | null } | null = null;
  let lastHover: DatumRef | null = null;
  let presented = '';
  let dirty = true;
  /** A zoom requested but not committed yet, so quick repeats (wheel, key repeat) build on each other. */
  let pendingWindow: Span | null | undefined;
  let tableView: TableView | null = null;
  let tableModel: unknown = null;
  /** The one pointer that owns a press or drag (review 2, finding 10); others are ignored until it ends. */
  let down: { id: number; x: number; y: number; dragging: boolean } | null = null;
  const touches = new Map<number, { x: number; y: number; x0: number; y0: number; t0: number; client: Point }>();
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
    // On the window, capturing: the chart sees Escape before anything in the page, a dialog included, and
    // spends it when it has something to close (rule 7).
    doc.defaultView?.addEventListener('keydown', onEscape, { capture: true, signal });
    doc.addEventListener('scroll', onScroll, { capture: true, passive: true, signal });
    doc.defaultView?.addEventListener('blur', onWindowBlur, { signal });
    doc.addEventListener('pointerdown', onDocumentDown, { capture: true, signal });
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
    proxy.addEventListener('keydown', event => {
      onProxyKey(event);
      // A key the plot handled: from now on its focus is shown, in every engine (spec A2; Firefox does not
      // match :focus-visible on a key after a mouse interaction).
      if (event.defaultPrevented && !keyed) setKeyed(true);
    }, { signal });
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
    // The plot's column (the plot and the strip under it) receives the moves: the corridor to the strip
    // crosses from one to the other.
    figure.stage.addEventListener('pointermove', onPointerMove, { signal });
    figure.stage.addEventListener('pointerleave', onStageLeave, { signal });
    plot.addEventListener('pointerdown', onPointerDown, { signal });
    plot.addEventListener('pointerup', onPointerUp, { signal });
    plot.addEventListener('pointercancel', onPointerCancel, { signal });
    plot.addEventListener('lostpointercapture', onLostCapture, { signal });
    plot.addEventListener('wheel', onWheel, { passive: false, signal });
    listenDocument();
  }

  /** Focus that is inside the chart's own interactive elements goes to the figure, which takes focus from script only. */
  function focusFigure(): void {
    const root = figure.figure;
    if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');
    root.focus({ preventScroll: true });
  }

  /**
   * The plot is about to stop being focusable (too small, compact, failure) while it has focus: focus goes to
   * the table control when there is one, else to the figure itself, which takes focus from script only, so no
   * tab stop is added (WCAG 2.4.3; interaction review, new item 6).
   */
  function handOff(toolbarStays = true): void {
    if (!proxy || doc.activeElement !== proxy) return;
    if (toolbarStays && toolbar?.focus('table')) return;
    focusFigure();
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

  /** Focus is in one of the chart's own elements other than the figure itself. */
  function focusOwned(): boolean {
    const active = doc.activeElement;
    return active instanceof Element && active !== figure.figure && figure.figure.contains(active);
  }

  function unbuild(ownedBefore = false): void {
    if (!proxy) return;
    // Focus anywhere in what is about to go (the plot, the toolbar, the slice list, the table and its
    // field or pager, a pinned row) is handed to the figure before it goes (review C2-17, C3-6).
    const owned = ownedBefore || focusOwned();
    cancelGestures();
    closeTable(false);
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
    if (owned && (doc.activeElement === null || doc.activeElement === doc.body || !figure.figure.contains(doc.activeElement))) focusFigure();
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

  function firstDatum(d: Committed): DatumRef | null {
    if (aligned(d.view)) {
      const x = stepAcross(d.view, null, 'first');
      return x === null ? null : d.lookup.primary({ kind: 'x', x });
    }
    return d.lookup.step(null, 'first');
  }

  /** The pointer's datum, when the pointer leads; the keyboard starts from it (contracts: Lookup.primary). */
  function pointerTarget(): PickTarget | null {
    return shown.kind === 'hover' || shown.kind === 'held' || shown.kind === 'pinned' ? shown.target : null;
  }

  /** The keyboard takes over: from the pointer's datum when the pointer leads, else from where it was. */
  function takeover(d: Committed): void {
    const target = pointerTarget();
    if (target === null) {
      focus ??= firstDatum(d);
      return;
    }
    if (shown.kind === 'pinned') {
      focus = shown.ref;
    } else if (mode === 'single' && focus?.kind === 'aligned' && target.kind === 'x') {
      focus = d.lookup.resolve({ kind: 'aligned', seriesKey: focus.seriesKey, x: target.x }) ?? d.lookup.primary(target);
    } else {
      focus = d.lookup.primary(target) ?? focus ?? firstDatum(d);
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

  /** The datum on show, by the state machine. */
  function shownTarget(): PickTarget | null {
    if (shown.kind === 'keyboard') return proxyFocused && focus && c ? keyboardTarget(c, focus) : null;
    return pointerTarget();
  }

  /** Where the state goes when the pointer is no longer what leads. */
  function idle(): Shown {
    return proxyFocused && !fromClick ? { kind: 'keyboard' } : NONE;
  }

  function swatchFor(d: Committed): (row: DatumText) => SwatchSpec | null {
    const view = d.view;
    return row => {
      if (view.kind === 'donut') return { color: view.slices[row.seriesIndex]?.colorIndex ?? null, cue: null, line: false, hollow: false };
      return parts.swatch(row.seriesIndex, view.cues[row.seriesIndex] ?? null, false);
    };
  }

  /** The mapping between the plot's layout pixels and viewport pixels (rule 10), read when needed. */
  function plotMapping() {
    return mappingOf(plot);
  }

  function pick(d: Committed, at: Point): PickTarget | null {
    const p = toLocal(plotMapping(), at);
    return d.lookup.pick(p.x, p.y);
  }

  /**
   * The datum's active marks in plot pixels. An x where no series has a mark is anchored at that x on the
   * plot's vertical middle (horizontal bars: its horizontal middle; decision 0004, clarifications).
   */
  function markBox(d: Committed, target: PickTarget): Rect | null {
    const box = targetBox(d.view, d.lookup, target, null);
    if (box || target.kind !== 'x' || d.layout.kind !== 'plot') return box;
    const p = d.layout.projection;
    const scale = p.kind === 'xy' ? p.x : p.kind === 'bands' ? p.band : null;
    if (!scale) return null;
    const at = scale.type === 'band' ? scale.center(target.x) : scale.map(target.x);
    if (!Number.isFinite(at)) return null;
    const plotRect = d.layout.plot;
    return horizontalBars(d)
      ? { x: plotRect.x + plotRect.width / 2, y: at, width: 0, height: 0 }
      : { x: at, y: plotRect.y + plotRect.height / 2, width: 0, height: 0 };
  }

  /** The datum's active marks in viewport pixels: what the hold's geometry is compared on. */
  function anchorOf(d: Committed, target: PickTarget): Rect | null {
    const box = markBox(d, target);
    return box ? rectToViewport(plotMapping(), box) : null;
  }

  /** The rows of a pinned tooltip from row `offset` on (its "+N more"); the lookup's own model for the first page. */
  function pinnedModel(d: Committed, target: PickTarget, offset: number): TooltipModel {
    const model = d.lookup.tooltip(target);
    if (offset <= 0 || offset >= model.count) return model;
    if (target.kind === 'x' && aligned(d.view)) {
      return { ...model, rows: alignedRows(d.view, d.formatters, target.x, model).slice(offset, offset + PAGE_ROWS) };
    }
    if (target.kind === 'point') {
      const refs = groupRefs(d.lookup, target).slice(offset, offset + PAGE_ROWS);
      if (!refs.length) return model;
      return { ...d.lookup.tooltip({ kind: 'point', refs, count: target.count }), title: model.title, count: model.count };
    }
    return model;
  }

  /** Draws the overlay and the tooltip for what is shown, and fires `hover` when the datum changes. */
  function present(): void {
    const d = c;
    if (!plotReady(d) || !proxy) {
      if (presented !== '') {
        if (d) renderer.drawOverlay(null, d.bindings, d.theme, d.pixelRatio);
        tooltip.hide();
        presented = '';
      }
      content = null;
      hover(null);
      markLegend(null);
      return;
    }
    const target = shownTarget();
    // The ring: on arrival by Tab (:focus-visible), and after any key the plot handled, never after a click alone.
    const visibleRing = proxyFocused && (keyed || proxy.matches(':focus-visible')) ? focus : null;
    const only = mode === 'single' && shown.kind === 'keyboard' ? focus : null;
    const presentation = presentationFor(d);
    const pinned = shown.kind === 'pinned';
    const showTip = presentation !== 'none' && target !== null && !isDismissed(target);
    // The pointer's own position is not part of it: the tooltip depends on the datum only (rule 1).
    const key = JSON.stringify([target, visibleRing, only, showTip, pinned, pinned ? pinPage : 0, presentation]);
    markLegend(proxyFocused && focus?.kind === 'slice' ? focus.sliceKey : null);
    if (!dirty && key === presented) return;
    presented = key;
    dirty = false;
    const overlay: Overlay | null = overlayWith(parts.overlay, { view: d.view, layout: d.layout, lookup: d.lookup, target, ring: visibleRing, only });
    renderer.drawOverlay(overlay, d.bindings, d.theme, d.pixelRatio);
    content = null;
    if (!showTip || target === null) {
      tooltip.hide();
    } else {
      const model = pinned ? pinnedModel(d, target, pinPage) : d.lookup.tooltip(target);
      if (model.rows.length === 0) {
        tooltip.hide();
      } else {
        const tc: TooltipContent = {
          model, swatch: swatchFor(d), moreRows: count => fill(d.messages.moreRows, { count: d.formatters.count(count) }),
          totalLabel: d.messages.total, moreLang: d.english('moreRows'), totalLang: d.english('total'),
          valueLang: text => text === d.messages.noData ? d.english('noData') : text === d.messages.noObservation ? d.english('noObservation') : null,
          // A pinned row selects its series, so one that is not the primary can be chosen without a keyboard
          // (WCAG 2.5.1); a hovered tooltip is text (rule 4).
          select: row => actions.select(row.ref),
          more: shownRows => {
            if (shown.kind !== 'pinned') return;
            const next = pinPage + Math.max(1, shownRows);
            pinPage = next >= model.count ? 0 : next;
            dirty = true;
            present();
          },
        };
        const placed = presentation === 'strip'
          ? tooltip.strip(tc, pinned, visibleRegion(figure.readout))
          : tooltip.show(tc, placementFor(d, target, visibleRing), pinned);
        const rect = placed ? tooltip.rect() : null;
        if (rect) {
          content = { target, rect, anchor: anchorOf(d, target), presentation };
          lastShowing = figure.figure;
        }
      }
    }
    // A pin whose content cannot be shown ends: no state holds a pin with nothing shown (decision 0004,
    // clarifications); what is under the pointer is shown instead.
    if (pinned && content === null) {
      endPin();
      dirty = true;
      present();
      return;
    }
    hover(target === null ? null : shown.kind === 'keyboard' ? focus : shown.kind === 'pinned' ? shown.ref : d.lookup.primary(target));
  }

  /**
   * Rules 1, 2 and 6: where the tooltip may go, from the datum only. The box is every displayed series'
   * marks at that x (the point, the slice) enlarged by the focus ring, also in single-series mode; the
   * keyboard's ring is kept clear wherever it is; the plot is the marks' rectangle inset by the plot's
   * outline and cut to what is visible; every control of the figure is avoided. All in viewport pixels.
   */
  function placementFor(d: Committed, target: PickTarget, keyboardRing: DatumRef | null): PlacementInput {
    const m = plotMapping();
    const area = d.layout.kind === 'plot' ? d.layout.plot : { x: 0, y: 0, width: d.layout.width, height: d.layout.height };
    const marks = markBox(d, target) ?? { x: area.x + area.width / 2, y: area.y + area.height / 2, width: 0, height: 0 };
    const datum = { x: marks.x - RING_REACH, y: marks.y - RING_REACH, width: marks.width + 2 * RING_REACH, height: marks.height + 2 * RING_REACH };
    const inset = OUTLINE_REACH;
    const plotRect = { x: area.x + inset, y: area.y + inset, width: Math.max(0, area.width - 2 * inset), height: Math.max(0, area.height - 2 * inset) };
    let hole: PlacementInput['hole'] = null;
    if (d.layout.kind === 'plot' && d.layout.projection.kind === 'ring' && d.layout.projection.r0 > HOLE_CLEARANCE) {
      const { cx, cy, r0 } = d.layout.projection;
      const centre = toViewport(m, { x: cx, y: cy });
      hole = { cx: centre.x, cy: centre.y, rx: (r0 - HOLE_CLEARANCE) * m.kx, ry: (r0 - HOLE_CLEARANCE) * m.ky };
    }
    const controls: Rect[] = [];
    for (const el of figure.figure.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex], .axylo-legend-list > li')) {
      if (el === proxy || el === figure.figure || tooltip.contains(el)) continue;
      const r = el.getBoundingClientRect();
      // With the focus outline it paints (2 px at 1 px offset): that is never covered either.
      const o = FOCUS_OUTLINE;
      if (r.width > 0 && r.height > 0) controls.push({ x: r.left - o, y: r.top - o, width: r.width + 2 * o, height: r.height + 2 * o });
    }
    const rings: Rect[] = [];
    const ringBox = keyboardRing ? ringRect(d.layout, d.lookup, keyboardRing) : null;
    if (ringBox) rings.push(rectToViewport(m, ringBox));
    return {
      // What can be seen of the plot, and of the tooltip's place: both chains of clipping ancestors.
      box: rectToViewport(m, datum), visible: intersect(intersect(rectToViewport(m, plotRect), visibleRegion(plot)), visibleRegion(figure.tooltip)),
      order: horizontalBars(d) ? 'horizontal' : 'vertical', hole, controls, rings, ringStroke: RING_STROKE * Math.max(m.kx, m.ky),
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
   * Decision 0004, part 2: bounds and the numeric value always match the displayed frame, silently. The value
   * text is rewritten when the reader acted (`acted`), when the focused datum is another one than the text
   * describes (it left the frame and focus moved by the lookup's rule), or when that datum's own reading
   * changed (its identity and values, compared as data); never because only the count or its place changed.
   * `focus` is established before this is called.
   */
  /** The language of what the range reads now: its template's, English where that is the built-in one (A10). */
  function readingLang(d: Committed): string | null {
    const valueKey: keyof Messages = !plotReady(d) || !readable(d) ? 'empty'
      : d.view.kind === 'donut' || (mode === 'all' && d.view.kind !== 'scatter') ? 'pointAll' : 'pointOf';
    return d.english(valueKey);
  }

  function writeProxy(acted: boolean): void {
    const d = c;
    if (!proxy || !d) return;
    // Written with each reading, so a change of template (single mode's pointOf) carries its language (C2-19).
    setAttr(proxy, 'lang', readingLang(d));
    // Unfocused, the range describes where the keyboard would start.
    const ref = plotReady(d) && readable(d) ? focus ?? firstDatum(d) : null;
    if (ref === null) {
      if (proxy.max !== '0') proxy.max = '0';
      if (proxy.value !== '0') proxy.value = '0';
      shownOrdinal = 0;
      const state = !plotReady(d) || !readable(d)
        ? (recoverable(d) || plotReady(d) ? d.messages.empty : d.message ?? d.messages.noData)
        : d.messages.noData;
      setAttr(proxy, 'aria-valuetext', state);
      // State text has replaced the datum's: the next datum text is written whatever it says (finding 2).
      shownText = null;
      return;
    }
    const max = String(Math.max(0, d.lookup.count - 1));
    const ordinal = Math.max(0, d.lookup.ordinal(ref));
    if (proxy.max !== max) proxy.max = max;
    if (proxy.value !== String(ordinal)) proxy.value = String(ordinal);
    const reading = datumReading(d.view, d.lookup, ref, mode, d.formatters, d.messages);
    const same = shownText !== null && sameRef(ref, shownText.ref) && mode === shownText.mode && reading === shownText.reading;
    if (acted || !same || !proxy.hasAttribute('aria-valuetext')) {
      const text = valueText(d.view, d.lookup, ref, mode, d.formatters, d.messages);
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
    if (mode === 'single' && from.kind === 'point' && d.view.kind === 'scatter' && parts.stepInSeries) return parts.stepInSeries(d.view, from, direction);
    return d.lookup.step(from, direction);
  }

  /** The keyboard leads now: a pin ends (the reader moved on), a dismissal for another datum lapses. */
  function keyboardLeads(d: Committed): void {
    shown = { kind: 'keyboard' };
    pinPage = 0;
    rest = null;
    if (dismissed.length && focus && !isDismissed(keyboardTarget(d, focus))) dismissed = [];
  }

  function move(direction: StepDirection): void {
    const d = c;
    if (!plotReady(d)) return;
    takeover(d);
    const from = focus;
    if (focus) {
      const next = stepFrom(d, focus, direction);
      if (next) focus = next;
    }
    // A key that leaves the reader on the same datum is not a move: a pin stays, the text is not rewritten
    // (decision 0004, clarifications).
    const moved = !sameRef(from, focus);
    if (!moved && shown.kind === 'pinned') return;
    keyboardLeads(d);
    writeProxy(moved);
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
    keyboardLeads(d);
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
      // The datum the range describes, whatever the pointer is over (review finding 1).
      event.preventDefault();
      focus ??= firstDatum(d);
      if (focus) actions.select(focus);
      return;
    }
    if (key === 'Escape') {
      // Rule 7: a tooltip on show took this Escape already (onEscape); here only single-series mode is left,
      // and otherwise Escape goes on to the page.
      if (mode === 'single') {
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
    keyboardLeads(d);
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
    if (!clickFocus) keyboardLeads(d);
    writeProxy(true);
    dirty = true;
    present();
  }

  /** The chart's last input was a key the plot handled (true), or a pointer or a blur (false). */
  function setKeyed(on: boolean): void {
    keyed = on;
    proxy?.classList.toggle('axylo-keyed', on);
    dirty = true;
    present();
  }

  function onProxyBlur(): void {
    proxyFocused = false;
    fromClick = false;
    keyed = false;
    proxy?.classList.remove('axylo-keyed');
    if (shown.kind === 'keyboard') shown = pointer && c ? { kind: 'hover', target: plotReady(c) ? pick(c, pointer) : null } : NONE;
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

  /** In the plot's layout pixels, which picking and the layout use, also under a CSS transform (rule 10). */
  function local(event: MouseEvent): Point {
    return toLocal(plotMapping(), { x: event.clientX, y: event.clientY });
  }

  /** The pointer has picked `target`: what is shown follows it; a dismissal for another datum lapses. */
  /**
   * Whether `target` shows a datum Escape closed. A point is matched by the ref recorded at Escape and its
   * membership of the whole displayed group, not only the eight sampled rows (review finding 7).
   */
  function isDismissed(target: PickTarget): boolean {
    return dismissed.some(id => matchesIdentity(id, target) ||
      (id.kind === 'point' && target.kind === 'point' && target.count > target.refs.length && c !== null && groupRefs(c.lookup, target).some(r => sameRef(r, id.ref))));
  }

  function pointTo(target: PickTarget | null): void {
    if (target !== null && dismissed.length && !isDismissed(target)) dismissed = [];
    shown = { kind: 'hover', target };
  }

  /** A pointer move over the plot's column (viewport pixels): rule 3b, then a fresh pick. */
  function pointerAt(at: Point, time: number): void {
    const d = c;
    if (!plotReady(d)) return;
    pointer = at;
    if (shown.kind === 'pinned') return;
    const still = rest !== null && Math.hypot(at.x - rest.at.x, at.y - rest.at.y) <= REST_DISTANCE;
    // A rest of 250 ms on the datum whose content is on show opens the corridor to that content. It opens
    // on the first move after the rest, also one of 2 px or less (a datum at a band's edge would otherwise
    // change on it).
    if (shown.kind === 'hover' && shown.target !== null && rest !== null && rest.target !== null && time - rest.time >= REST_TIME &&
      sameTarget(rest.target, shown.target) && content !== null && sameTarget(content.target, shown.target)) {
      shown = { kind: 'held', target: shown.target, from: rest.at, rect: content.rect, anchor: content.anchor, presentation: content.presentation };
    }
    if (shown.kind === 'held') {
      if (insideCorridor(shown.from, shown.rect, at)) {
        if (!still) rest = { at, time, target: shown.target };
        present();
        return;
      }
      // Leaving the corridor resumes picking on this same move.
      shown = { kind: 'hover', target: null };
    }
    const target = pick(d, at);
    pointTo(target);
    if (!still || rest === null || !sameTarget(rest.target, target)) rest = { at, time, target };
    present();
  }

  function onPointerMove(event: PointerEvent): void {
    if (event.pointerType === 'touch') {
      const t = touches.get(event.pointerId);
      if (t) {
        const at = local(event);
        t.x = at.x;
        t.y = at.y;
        t.client = { x: event.clientX, y: event.clientY };
        if (pinch && pinch.ids.includes(event.pointerId)) pinchMove();
      }
      return;
    }
    if (down && down.id !== event.pointerId) return;
    // The open table covers the plot: there is nothing to point at under it.
    if (tableView) return;
    const at = local(event);
    if (down) {
      if (!down.dragging && c?.zoom && Math.hypot(at.x - down.x, at.y - down.y) > DRAG_THRESHOLD) {
        down.dragging = true;
        // A gesture ends a pin: no state holds a pin with nothing shown (decision 0004, clarifications).
        if (shown.kind === 'pinned') { shown = { kind: 'hover', target: null }; pinPage = 0; }
        tooltip.hide();
        content = null;
        presented = '';
      }
      if (down.dragging) {
        drawSelection(down, at);
        return;
      }
    }
    pointerAt({ x: event.clientX, y: event.clientY }, event.timeStamp);
  }

  /** The pointer left the plot and the content: a hover or hold ends; a pin stays. */
  function leave(): void {
    pointer = null;
    rest = null;
    if (shown.kind === 'hover' || shown.kind === 'held') shown = idle();
    present();
  }

  function onStageLeave(event: PointerEvent): void {
    if (event.pointerType === 'touch' || down?.dragging) return;
    leave();
  }

  function horizontalBars(d: Committed): boolean {
    return d.layout.kind === 'plot' && d.layout.projection.kind === 'bands' && d.layout.projection.horizontal;
  }

  function drawSelection(from: Point, to: Point): void {
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

  /** The first end of "Select range", marked with the drag selection's own visual, 2 px wide. */
  function markRange(d: Committed): void {
    const px = range?.start == null ? null : pixelOf(d.layout, range.start);
    if (px === null || !selection) {
      if (selection && !down?.dragging) selection.hidden = true;
      return;
    }
    const at = horizontalBars(d) ? { x: 0, y: px } : { x: px, y: 0 };
    drawSelection({ x: at.x - 1, y: at.y - 1 }, { x: at.x + 1, y: at.y + 1 });
  }

  /** "Select range" is released: the toggle unpressed, the first end cleared and unmarked. */
  function endRange(): void {
    if (!range) return;
    range = null;
    if (selection && !down?.dragging) selection.hidden = true;
    if (cs) renderControls(cs);
  }

  /** Ends a press or drag on every way out: release, cancel, lost capture, Escape, the window losing focus. */
  function endDrag(): void {
    if (selection) selection.hidden = true;
    if (range && c) markRange(c);
    const was = down;
    down = null;
    if (was && plot.hasPointerCapture?.(was.id)) {
      try { plot.releasePointerCapture(was.id); } catch { /* already released */ }
    }
  }

  function onPointerDown(event: PointerEvent): void {
    const d = c;
    if (!plotReady(d)) return;
    // A pointer is the last input now: the ring waits for the next key.
    if (keyed) setKeyed(false);
    const at = local(event);
    if (event.pointerType === 'touch') {
      touches.set(event.pointerId, { ...at, x0: at.x, y0: at.y, t0: event.timeStamp, client: { x: event.clientX, y: event.clientY } });
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
      // The release's own position decides the tap and what it picks, not the last move (review finding 1).
      const up = local(event);
      if (t && plotReady(d) && Math.hypot(up.x - t.x0, up.y - t.y0) < TAP_DISTANCE && event.timeStamp - t.t0 < TAP_TIME) {
        activate(d, { x: event.clientX, y: event.clientY }, false);
      }
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
      const next = rangeWindow(d.view.xFull, a, b, minimumWidth(d.view));
      // A drag chooses the range itself: a pressed Select range is released (decision 0004, clarifications).
      endRange();
      if (next !== undefined) requestZoom(next);
      pointerAt({ x: event.clientX, y: event.clientY }, event.timeStamp);
      return;
    }
    activate(d, { x: event.clientX, y: event.clientY }, true);
  }

  /**
   * A click (`mouse`) or a tap: activation always picks afresh from where it happened, never from what a
   * hold shows (rule 3b). The datum there is pinned where the presentation can be pinned (rule 4; never with
   * `tooltip: false` or without a readout, rule 8), becomes the keyboard's datum (the centre of the next Zoom
   * in, review C2-8) and is selected. Empty space selects nothing and ends a pin.
   */
  function activate(d: Committed & { readonly ready: true }, at: Point, mouse: boolean): void {
    if (range && d.view.kind !== 'donut' && d.layout.kind === 'plot') {
      // Select range is pressed: the click sets an end of the range; it neither pins nor selects.
      const p = toLocal(plotMapping(), at);
      const plotRect = d.layout.plot;
      const x = positionAt(d.layout, p.x, p.y);
      if (x === null || p.x < plotRect.x || p.x > plotRect.x + plotRect.width || p.y < plotRect.y || p.y > plotRect.y + plotRect.height) return;
      if (range.start === null) {
        range.start = x;
        markRange(d);
        return;
      }
      const next = rangeWindow(d.view.xFull, range.start, x, minimumWidth(d.view));
      endRange();
      if (next !== undefined) requestZoom(next);
      return;
    }
    const target = pick(d, at);
    pointer = mouse ? at : null;
    rest = null;
    pinPage = 0;
    if (target === null) {
      shown = mouse ? { kind: 'hover', target: null } : idle();
      dirty = true;
      present();
      return;
    }
    let ref = d.lookup.primary(target);
    if (ref && mode === 'single' && focus?.kind === 'aligned' && target.kind === 'x') {
      ref = d.lookup.resolve({ kind: 'aligned', seriesKey: focus.seriesKey, x: target.x }) ?? ref;
    }
    dismissed = [];
    shown = ref && presentationFor(d) !== 'none' ? { kind: 'pinned', ref, target } : { kind: 'hover', target };
    if (mouse && proxy) {
      clickFocus = true;
      try {
        proxy.focus({ preventScroll: true });
      } finally {
        clickFocus = false;
      }
    }
    if (ref) {
      focus = ref;
      writeProxy(true);
      actions.select(ref);
    }
    dirty = true;
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

  /** A pin ends (Escape, a click elsewhere, its datum gone): what is under the pointer is shown at once. */
  function endPin(): void {
    if (shown.kind !== 'pinned') return;
    pinPage = 0;
    shown = pointer && plotReady(c) ? { kind: 'hover', target: pick(c, pointer) } : idle();
  }

  function onDocumentDown(event: PointerEvent): void {
    if (shown.kind !== 'pinned') return;
    // The composed path: inside a shadow root the target seen here is the host (review finding 9).
    const path = event.composedPath();
    const inside = path.includes(plot) || path.includes(figure.tooltip) || path.includes(figure.readout);
    if (inside) return;
    endPin();
    dirty = true;
    present();
  }

  function startPinch(d: Committed): void {
    const [ia, ib] = [...touches.keys()];
    const a = ia === undefined ? undefined : touches.get(ia);
    const b = ib === undefined ? undefined : touches.get(ib);
    if (ia === undefined || ib === undefined || !a || !b || d.view.kind === 'donut') return;
    const window = currentWindow(d)!;
    const center = positionAt(d.layout, (a.x + b.x) / 2, (a.y + b.y) / 2) ?? (window[0] + window[1]) / 2;
    pinch = { ids: [ia, ib], distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), window, center };
    if (shown.kind === 'pinned') { shown = idle(); pinPage = 0; }
    tooltip.hide();
    content = null;
    presented = '';
  }

  function pinchMove(): void {
    const d = c;
    const a = pinch ? touches.get(pinch.ids[0]) : undefined;
    const b = pinch ? touches.get(pinch.ids[1]) : undefined;
    if (!pinch || !a || !b || !plotReady(d) || d.view.kind === 'donut' || d.layout.kind !== 'plot') return;
    const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const { window, center } = pinch;
    // Spreading never widens and pinching never narrows (review C3-7).
    const width = pinchWidth(window[1] - window[0], pinch.distance / distance, minimumWidth(d.view));
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

  /**
   * Rule 7: one Escape does one thing. While a drag, a pin or a tooltip is on show, the chart spends the key
   * (nothing else in the page sees it, a surrounding dialog included); the next one goes on (to the proxy's
   * single-series mode when it has focus, else to the page).
   */
  function onEscape(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const spend = () => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    if (down?.dragging) {
      spend();
      endDrag();
      return;
    }
    // Which chart an Escape belongs to: the one focus is in; with focus in no chart, the one that showed
    // content last (decision 0004, clarifications).
    const active = doc.activeElement;
    const inChart = active instanceof Element ? active.closest('.axylo-figure') : null;
    if (inChart !== figure.figure && (inChart !== null || lastShowing !== figure.figure)) return;
    // Then a pressed Select range (its first end with it), then a tooltip or pin, then (the proxy's own
    // handler) single-series mode, then the page.
    if (range) {
      spend();
      endRange();
      return;
    }
    const target = shownTarget();
    // A pin is spent on whether or not its content can be seen (review finding 3).
    if (target === null || (!tooltip.visible && shown.kind !== 'pinned')) return;
    spend();
    const chosen = shown.kind === 'pinned' ? shown.ref : shown.kind === 'keyboard' ? focus : c?.lookup.primary(target) ?? null;
    dismissed = [identityOf(target, chosen)];
    if (shown.kind === 'pinned' || shown.kind === 'held') {
      // The pointer's physical datum is picked at once; it and the closed one stay closed until the pointer
      // reaches another (rule 7; review finding 6).
      pinPage = 0;
      const under = pointer && plotReady(c) ? pick(c, pointer) : null;
      if (under) dismissed.push(identityOf(under, c!.lookup.primary(under)));
      shown = pointer ? { kind: 'hover', target: under } : idle();
    }
    rest = null;
    dirty = true;
    present();
  }

  /**
   * The page scrolled under the pointer: a hold's geometry is gone and the pointer is over another place, so
   * it is picked again; a tooltip that stays put (pinned, the keyboard's) is placed again.
   */
  function onScroll(): void {
    const d = c;
    if (!plotReady(d)) return;
    if ((shown.kind === 'hover' || shown.kind === 'held') && pointer) {
      rest = null;
      pointTo(pick(d, pointer));
    } else if (!tooltip.visible) {
      return;
    }
    dirty = true;
    present();
  }

  // ── controls ───────────────────────────────────────────────────────────────────────────────────

  function tableOpen(): boolean {
    return tableView !== null;
  }

  /**
   * What the reader typed as an x value, in the x column's own format (review C2-18): categories exactly as
   * typed; numbers by `parseNumberAs`; dates and times as the data takes them (ISO), or as the table writes
   * them, accepted only when the column writes that same text back, so trailing text is never ignored and a
   * wall time keeps its time.
   */
  function jumpTarget(raw: string): XValue | null {
    const d = cs;
    if (!d?.reader.table || raw.trim() === '') return null;
    const view = d.view;
    const kind = xKindOf(view);
    if (kind === 'category') return raw;
    const text = raw.trim();
    // Last: an x the column itself writes, matched as written (a localized date, a sign the grammar missed).
    const written = (): number | null => {
      const want = normalized(text);
      const columns: (readonly [ArrayLike<number>, number, number])[] = view.kind === 'scatter'
        ? view.frame.series.map((series, i) => [series.x, view.visiblePoints[i]?.start ?? 0, view.visiblePoints[i]?.end ?? 0] as const)
        : view.kind === 'donut' ? [] : [[view.frame.x.values, view.visibleSlots.start, view.visibleSlots.end] as const];
      for (const [xs, start, end] of columns) for (let i = start; i < end; i++) if (normalized(d.formatters.x(xs[i]!)) === want) return xs[i]!;
      return null;
    };
    if (kind === 'number') return parseNumberAs(text, d.formatters.x, d.formatters.count) ?? written();
    const zone = view.kind === 'scatter' ? view.frame.timeZone : view.kind === 'donut' ? null : view.frame.x.timeZone;
    const position = (value: XValue) => {
      try { return readPosition(value, kind, zone); } catch { return NaN; }
    };
    if (Number.isFinite(position(text))) return text;
    const parsed = Date.parse(text.replace(/,?\s*(?:UTC|GMT)$/u, ' UTC'));
    if (!Number.isFinite(parsed)) return written();
    const at = new Date(parsed);
    const pad = (n: number) => String(n).padStart(2, '0');
    const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
    const candidate: XValue = kind === 'time' ? at : kind === 'date' ? day : `${day}T${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
    const p = position(candidate);
    return Number.isFinite(p) && normalized(d.formatters.x(p)) === normalized(text) ? candidate : written();
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
    pointer = null;
    rest = null;
    pinPage = 0;
    shown = NONE;
    tooltip.hide();
    content = null;
    presented = '';
    tableModel = null;
    renderTable(d);
    // Focus goes into the region that opened, so the next Tab does not leave the chart.
    tableView.focus();
  }

  function closeTable(restore = true): void {
    if (!tableView) return;
    // Focus inside the table goes to its disclosure before the table goes (review 2, finding 17).
    const focusInside = tableView.element.contains(doc.activeElement);
    tableView.destroy();
    tableView = null;
    tableModel = null;
    figure.figure.classList.remove('axylo-table-open');
    plot.inert = false;
    if (focusInside && restore) toolbar?.focus('table') || proxy?.focus({ preventScroll: true });
  }

  /** The cells' text as runs, built-in English marked on a page in another language (A10; review C2-19). */
  function cellRuns(d: ControlsState): (text: string) => readonly { text: string; lang: string | null }[] {
    const m = d.messages;
    const missing = new Map<string, string | null>([[m.noData, d.english('noData')], [m.noObservation, d.english('noObservation')]]);
    const qualifier = ` (${fill(m.incompleteStack, {})})`;
    const qualifierLang = d.english('incompleteStack');
    return text => {
      const lang = missing.get(text);
      if (lang !== undefined) return [{ text, lang }];
      if (qualifierLang && text.endsWith(qualifier)) return [{ text: text.slice(0, -qualifier.length), lang: null }, { text: qualifier, lang: qualifierLang }];
      return [{ text, lang: null }];
    };
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
        notFoundLang: d.english('jumpNotFound'),
        lang: key => d.english(key),
        cell: cellRuns(d),
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
      const shownSeries = view.visible[i] === true;
      return {
        key: `series:${s.key}`, label: s.label, pressed: shownSeries, lang: hiddenLang, className: 'axylo-control axylo-legend-entry',
        struck: !shownSeries, swatch: parts.swatch(i, view.cues[i] ?? null, !shownSeries),
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
      // Where a drag selects a range, two clicks can too (spec I4, WCAG 2.5.7): a toggle.
      if (d.ready) {
        items.push({
          ...button('selectRange', () => {
            if (range) endRange();
            else {
              range = { start: null };
              if (cs) renderControls(cs);
            }
          }), pressed: range !== null, symbol: 'range',
          className: 'axylo-control axylo-control-symbol',
        });
      }
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
    const next = parts.sliceList?.(doc, d, actions, legendList) ?? null;
    if (next === null && legendList) {
      // A slice the reader is on goes with its list: focus goes to the figure, not the page (C2-17).
      const inside = legendList.contains(doc.activeElement);
      legendList.remove();
      if (inside) focusFigure();
    }
    legendList = next;
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
    const inToolbar = toolbar.element.contains(active);
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
    // A toolbar that emptied under the reader hands focus to the figure, not the page (C2-17).
    else if (inToolbar && !items.length) focusFigure();
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
    // Each string in its own language where it can have one (spec A10; review C2-19): the description is an
    // element of its own. The name, the role description and the value text are attributes of the proxy
    // and share its language, which follows the value text's template (the most of what it says): English
    // only where that template is the built-in one. (A hidden labelling element would give the name its own
    // language, but a form control named only by hidden text fails axe's label-title-only.)
    const proxyLang = readingLang(d);
    setAttr(proxy, 'aria-label', d.messages.plotLabel);
    // How to move in the plot, as its description (the plotInstructions message).
    if (instructions) {
      if (instructions.textContent !== d.messages.plotInstructions) instructions.textContent = d.messages.plotInstructions;
      setAttr(instructions, 'lang', d.english('plotInstructions') ?? (proxyLang ? d.pageLang : null));
      setAttr(proxy, 'aria-describedby', instructions.id);
    }
    const type = { line: 'typeLine', area: 'typeArea', bar: 'typeBar', scatter: 'typeScatter', donut: 'typeDonut' } as const;
    setAttr(proxy, 'aria-roledescription', fill(d.messages.plotRole, { type: d.messages[type[d.kind]] }));
    plot.classList.toggle('axylo-touch-zoom', d.zoom === 'touch');
    plot.classList.toggle('axylo-zoomable', d.zoom !== false);
  }

  /**
   * Category positions across a change of categories. Keyboard focus moves on to the next surviving category
   * (A7); with `exact`, a pin, a hold or a dismissal follows only its own category and ends with it
   * (interaction review, part 1 item 2): the reader never pinned or dismissed the successor.
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

  function remapIdentity(id: Identity | null, map: (ref: DatumRef | null) => DatumRef | null): Identity | null {
    if (id === null || id.kind !== 'x') return id;
    const moved = map({ kind: 'aligned', seriesKey: '', x: id.x });
    return moved && moved.kind === 'aligned' ? { kind: 'x', x: moved.x } : null;
  }

  /**
   * Rule 8: a pin is one datum. It is kept while that datum is displayed, with the rows that share its
   * position now; when it is not (gone, out of the window, its series hidden, no longer drawn), the pin ends,
   * whatever else is at that position.
   */
  function stillPinned(next: Committed, ref: DatumRef, target: PickTarget): { ref: DatumRef; target: PickTarget } | null {
    if (!plotReady(next) || !readable(next)) return null;
    if (target.kind === 'point') {
      if (ref.kind !== 'point' || next.lookup.ordinal(ref) < 0) return null;
      const box = next.lookup.anchor(ref);
      if (!box) return null;
      const picked = next.lookup.pick(box.x + box.width / 2, box.y + box.height / 2);
      if (picked?.kind !== 'point') return { ref, target: { kind: 'point', refs: [ref], count: 1 } };
      if (picked.refs.some(r => sameRef(r, ref))) return { ref, target: picked };
      return { ref, target: { kind: 'point', refs: [ref, ...picked.refs.slice(0, Math.max(0, picked.refs.length - 1))], count: Math.max(picked.count, 1) } };
    }
    if (target.kind === 'slice') return ref.kind === 'slice' && next.lookup.ordinal(ref) >= 0 ? { ref, target } : null;
    // The exact datum chosen, never the primary in its place: it must still be displayed and its series visible.
    if (!sameRef(next.lookup.resolve(ref), ref) || !next.lookup.tooltip(target).rows.length) return null;
    return { ref, target };
  }

  /** Commit, step 1: what is shown is made true of the new frame before anything is presented. */
  function reconcile(previous: Committed | null, next: Committed): void {
    if (previous && previous.epoch !== next.epoch) {
      // A DatumRef means nothing across a data replacement: one effective focus for the new data is chosen
      // before anything is written, so the text, the ring and the tooltip agree, and the next hover is new
      // (review 3, interaction finding 5).
      mode = 'all';
      dismissed = [];
      lastHover = null;
      shownText = null;
      focus = null;
      pinPage = 0;
      rest = null;
      shown = shown.kind === 'keyboard' ? shown : pointer ? { kind: 'hover', target: null } : idle();
    } else if (previous) {
      const map = remapper(previous.view, next.view);
      if (map) {
        focus = map(focus);
        // The text describes a category, not a position: it is remapped with it, so a sliding window does
        // not rewrite the text of an unchanged datum (decision 0004 part 2; A7).
        if (shownText) {
          const moved = map(shownText.ref);
          shownText = moved ? { ...shownText, ref: moved } : null;
        }
        if (focus === null) mode = 'all';
        lastHover = map(lastHover);
        const same = remapper(previous.view, next.view, true)!;
        dismissed = dismissed.flatMap(id => remapIdentity(id, same) ?? []);
        if (shown.kind === 'pinned') {
          const target = remapTarget(shown.target, same);
          const ref = same(shown.ref);
          shown = target && ref ? { ...shown, target, ref } : { kind: 'hover', target: null };
        } else if (shown.kind === 'held') {
          // A held category that moved has a new anchor anyway: the hold ends below.
          const target = remapTarget(shown.target, same);
          shown = target ? { ...shown, target } : { kind: 'hover', target: null };
        }
      }
    }
    // Spec A7: focus follows its datum, and never points at something that is gone; with the plot focused
    // and nothing to follow, the first datum is focus, stored, before anything is written (finding 2).
    if (focus) {
      const resolved = next.lookup.resolve(focus);
      focus = resolved;
      if (resolved === null) mode = 'all';
      else if (mode === 'all' && resolved.kind === 'aligned') focus = next.lookup.primary({ kind: 'x', x: resolved.x }) ?? resolved;
    }
    if (!focus && proxyFocused && plotReady(next) && readable(next)) focus = firstDatum(next);

    const presentation = presentationFor(next);
    if (!plotReady(next)) {
      if (shown.kind !== 'keyboard') shown = pointer ? { kind: 'hover', target: null } : idle();
      pinPage = 0;
      return;
    }
    switch (shown.kind) {
      case 'pinned': {
        const kept = presentation === 'none' ? null : stillPinned(next, shown.ref, shown.target);
        if (kept) shown = { kind: 'pinned', ref: kept.ref, target: kept.target };
        else {
          endPin();
          // endPin picked with the old frame's lookup; the new frame's is the one on screen.
          const after = shown as Shown;
          if (after.kind === 'hover' && pointer) pointTo(pick(next, pointer));
        }
        break;
      }
      case 'held': {
        // The hold belongs to one datum, one geometry and one presentation (rule 3b).
        const anchor = anchorOf(next, shown.target);
        if (presentation !== shown.presentation || !sameRect(anchor, shown.anchor) || !next.lookup.tooltip(shown.target).rows.length) {
          rest = null;
          if (pointer && !down?.dragging) pointTo(pick(next, pointer));
          else shown = idle();
        }
        break;
      }
      case 'hover':
        if (pointer && !down?.dragging) {
          const before = shown.target;
          pointTo(pick(next, pointer));
          // A committed change of the datum under a still pointer starts its rest afresh (review finding 6).
          const now = (shown as Shown).kind === 'hover' ? (shown as Extract<Shown, { kind: 'hover' }>).target : null;
          if (!sameTarget(before, now)) rest = { at: pointer, time: doc.defaultView?.performance.now() ?? 0, target: now };
        }
        break;
      default:
        break;
    }
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
    // A redraw without zoom (or without a plot) ends Select range; one with it keeps the first end marked.
    if (range && !(plotReady(next) && next.zoom && next.view.kind !== 'donut')) {
      range = null;
      if (selection && !down?.dragging) selection.hidden = true;
    } else if (range) markRange(next);
    reconcile(previous, next);
    placeProxy(next);
    writeProxy(false);
    renderControls(next);
    present();
    // A hold whose content came out with another rectangle ends, and the pointer picks again at once.
    if (shown.kind === 'held' && (content === null || !sameRect(content.rect, shown.rect)) && plotReady(next)) {
      rest = null;
      if (pointer) pointTo(pick(next, pointer));
      else shown = idle();
      dirty = true;
      present();
    }
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
    const strip = presentationFor(state) === 'strip';
    if (figure.figure.classList.contains('axylo-readout-mode') !== strip) {
      figure.figure.classList.toggle('axylo-readout-mode', strip);
      // The presentation changes: a hold or what was shown in the old one goes with it (rule 3b).
      tooltip.hide();
      content = null;
      presented = '';
      if (shown.kind === 'held') shown = pointer ? { kind: 'hover', target: null } : idle();
      rest = null;
    }
    return layoutSignature() !== before;
  }

  /** What around the plot can change its size: which controls exist, where, and their labels. */
  function layoutSignature(): string {
    return [figure.top, figure.side, figure.controls].map(host => host.hidden ? '' : host.textContent ?? '').join('\u0000') +
      (figure.figure.classList.contains('axylo-readout-mode') ? '\u0000readout' : '');
  }

  /** Everything goes; a later full build starts from no input at all (new item 6; review C3-6). */
  function clear(): void {
    const d = c;
    if (presented !== '' && d) renderer.drawOverlay(null, d.bindings, d.theme, d.pixelRatio);
    presented = '';
    // Recorded before the tooltip goes: a focused pinned row goes with it (review C3-6).
    const owned = focusOwned();
    tooltip.hide();
    unbuild(owned);
    focus = null;
    shown = NONE;
    content = null;
    rest = null;
    pinPage = 0;
    range = null;
    mode = 'all';
    pointer = null;
    dismissed = [];
    shownText = null;
    proxyFocused = false;
    fromClick = false;
    keyed = false;
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
      endPin();
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
