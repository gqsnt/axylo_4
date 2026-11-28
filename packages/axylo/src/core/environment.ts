/**
 * The browser inputs that output depends on besides options and data (contracts: Environment), and the
 * watchers that say when one of them changed: device pixel ratio, reduced motion, web fonts finishing a load.
 * Nothing here runs at import time; every function takes the window or element it reads.
 */
import type { TextMeasurer, TextStyle } from './contracts';

/**
 * The viewer's zone as read in the current task: a dashboard that creates its charts together asks Intl once,
 * not once per chart (each asking makes a DateTimeFormat). A later task reads it again, so a zone that changes
 * while the page is open is still followed.
 */
let taskZone: string | undefined;
let taskZoneDtf: typeof Intl.DateTimeFormat | undefined;
let taskZoneTz: string | undefined;

function forgetTaskZone(): void {
  taskZone = undefined;
  taskZoneDtf = undefined;
  taskZoneTz = undefined;
}

export function viewerTimeZone(): string {
  const dtf = Intl.DateTimeFormat;
  const tz = (globalThis as { process?: { env?: { TZ?: string } } }).process?.env?.TZ;
  if (taskZone !== undefined && taskZoneDtf === dtf && taskZoneTz === tz) return taskZone;
  let zone: string;
  try {
    zone = dtf().resolvedOptions().timeZone || 'UTC';
  } catch {
    zone = 'UTC';
  }
  if (typeof queueMicrotask === 'function') {
    const schedule = taskZone === undefined;
    taskZone = zone;
    taskZoneDtf = dtf;
    taskZoneTz = tz;
    if (schedule) queueMicrotask(forgetTaskZone);
  }
  return zone;
}

const LOCALE_CACHE_LIMIT = 64;
const canonicalLocales = new Map<string, string | null>();
let canonicalize: typeof Intl.getCanonicalLocales | undefined;

function canonicalLocale(candidate: unknown): string | null {
  if (typeof candidate !== 'string') return null;
  const tag = candidate.trim();
  if (!tag) return null;
  if (canonicalize !== Intl.getCanonicalLocales) {
    canonicalize = Intl.getCanonicalLocales;
    canonicalLocales.clear();
  }
  const cached = canonicalLocales.get(tag);
  if (cached !== undefined) return cached;
  let canonical: string | null = null;
  try { canonical = Intl.getCanonicalLocales(tag)[0] ?? null; }
  catch { /* Try the next locale source. */ }
  if (canonicalLocales.size >= LOCALE_CACHE_LIMIT) canonicalLocales.delete(canonicalLocales.keys().next().value!);
  canonicalLocales.set(tag, canonical);
  return canonical;
}

/** `options.locale`, else the document language, else the browser's, as a locale Intl accepts. */
export function resolveLocale(option: unknown, doc: Document | null, lang = doc?.documentElement.lang): string {
  return canonicalLocale(option) ?? canonicalLocale(lang) ?? canonicalLocale(doc?.defaultView?.navigator.language)
    ?? new Intl.NumberFormat().resolvedOptions().locale;
}

/** A computed length in pixels, or `fallback` for one that is not a number ('', 'normal'). */
function pixels(value: string, fontSize: number, fallback: number): number {
  if (value === 'normal') return fallback;
  const n = parseFloat(value);
  const px = value.endsWith('px') ? n : n * fontSize;
  return Number.isFinite(px) ? px : fallback;
}

/**
 * The text style of tick labels, read from the text layer's own computed style, so measurement agrees with
 * what the layer renders (it uses `font-size: max(12px, 1em)`), including the page's text spacing (spec A6).
 */
export function readTextStyle(element: Element): TextStyle {
  const win = element.ownerDocument.defaultView;
  const style = win?.getComputedStyle(element);
  const fontSize = style ? parseFloat(style.fontSize) || 12 : 12;
  if (!style) return { font: `${fontSize}px sans-serif`, letterSpacing: 0, wordSpacing: 0, lineHeight: fontSize * 1.2 };
  const family = style.fontFamily || 'sans-serif';
  const font = `${style.fontStyle || 'normal'} ${style.fontWeight || '400'} ${fontSize}px ${family}`;
  return {
    font,
    letterSpacing: pixels(style.letterSpacing, fontSize, 0),
    wordSpacing: pixels(style.wordSpacing, fontSize, 0),
    // 'normal' depends on the font's metrics; 1.2 is the common value and errs on the side of room.
    lineHeight: pixels(style.lineHeight, fontSize, Math.ceil(fontSize * 1.2)),
  };
}

type SpacingContext = CanvasRenderingContext2D & { letterSpacing?: string; wordSpacing?: string };

/**
 * A document's measuring context with what this module last set on it. The context is private to the module,
 * so these are what it holds: a value is assigned only when it differs, never read back (engines normalize
 * `font` on reading, so comparing with the live value assigned it again, and parsed it, on every miss).
 */
interface MeasuringContext {
  readonly ctx: SpacingContext;
  /** The context sets letter and word spacing itself (else they are added the way CSS adds them). */
  readonly spaced: boolean;
  /** Null after a font load, until the canvas has resolved its font again. */
  font: string | null;
  /** Initial CSSOM strings become numeric pixels after their first comparison. */
  letterSpacing: string | number;
  wordSpacing: string | number;
}

function applySpacing(state: MeasuringContext, key: 'letterSpacing' | 'wordSpacing', value: number): void {
  if (state[key] === value) return;
  const css = `${value}px`;
  if (state[key] !== css) state.ctx[key] = css;
  state[key] = value;
}

type Widths = Map<string, number>;
class MeasurementCache {
  readonly #styles = new WeakMap<TextStyle, Widths>();
  readonly #fonts = new Map<string, Widths>();
  size = 0;
  #lastStyle: TextStyle | null = null;
  #lastWidths: Widths | null = null;

  widthsFor(style: TextStyle): Widths {
    if (this.#lastStyle === style) return this.#lastWidths!;
    let widths = this.#styles.get(style);
    if (!widths) {
      // Numeric spacings before the arbitrary font string make an unambiguous key.
      const key = `${style.letterSpacing} ${style.wordSpacing} ${style.font}`;
      widths = this.#fonts.get(key);
      if (!widths) this.#fonts.set(key, widths = new Map());
      this.#styles.set(style, widths);
    }
    this.#lastStyle = style;
    return this.#lastWidths = widths;
  }
}
/** Measured widths per document, for every style together, so the bound holds for the whole page. */
const measurers = new WeakMap<Document, DocumentMeasurer>();
export const MEASUREMENT_CACHE_LIMIT = 8192;

export function noteFontLoad(doc: Document): void {
  measurers.get(doc)?.invalidate();
}

/** How many widths the document's cache holds (for tests of its bound). */
export function measurementCacheSize(doc: Document): number {
  return measurers.get(doc)?.cache?.size ?? 0;
}

function measuringContext(doc: Document): MeasuringContext | null {
  const ctx = doc.createElement('canvas').getContext('2d') as SpacingContext | null;
  if (!ctx) return null;
  const letter = ctx.letterSpacing, word = ctx.wordSpacing;
  const spaced = typeof letter === 'string' && typeof word === 'string';
  return { ctx, spaced, font: null, letterSpacing: letter ?? '', wordSpacing: word ?? '' };
}

/**
 * Canvas `measureText` with the computed font and the page's letter and word spacing (spec A6). Where the
 * context supports `letterSpacing` and `wordSpacing` they are set on it, so the browser adds them as it
 * does for the text layer; otherwise they are added the way CSS adds them (after every character, and
 * after every space). Cached per document, font epoch, style and string.
 */
class DocumentMeasurer implements TextMeasurer {
  cache?: MeasurementCache;
  #context?: MeasuringContext | null;

  constructor(private readonly doc: Document) {}

  invalidate(): void {
    this.cache = undefined;
    if (this.#context) this.#context.font = null;
  }

  readonly width = (text: string, style: TextStyle): number => {
    let cache = this.cache ??= new MeasurementCache();
    let widths = cache.widthsFor(style);
    const hit = widths.get(text);
    if (hit !== undefined) return hit;
    if (this.#context === undefined) this.#context = measuringContext(this.doc);
    const state = this.#context;
    let width: number;
    if (state) {
      const c = state.ctx;
      if (state.font === null) {
        // WebKit keeps the font it resolved when `font` was assigned and does not resolve it again when the
        // same string is assigned: after a font load, a different font is assigned first, so the wanted one
        // is resolved anew (the engines report, WebKit section). Once per load; Chrome and Firefox measure the
        // same either way. The live value is read here, once per load, so the toggle always differs from it.
        const toggle = c.font === '10px serif' ? '10px sans-serif' : '10px serif';
        c.font = toggle;
        state.font = toggle;
      }
      if (state.font !== style.font) {
        c.font = style.font;
        state.font = style.font;
      }
      if (state.spaced) {
        applySpacing(state, 'letterSpacing', style.letterSpacing);
        applySpacing(state, 'wordSpacing', style.wordSpacing);
      }
      width = c.measureText(text).width;
    } else {
      width = text.length * parseFloat(/(\d+(?:\.\d+)?)px/.exec(style.font)?.[1] ?? '12') * 0.6;
    }
    if (!state?.spaced) {
      if (style.letterSpacing !== 0) width += style.letterSpacing * [...text].length;
      if (style.wordSpacing !== 0) {
        let spaces = 0;
        for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 32) spaces++;
        width += style.wordSpacing * spaces;
      }
    }
    if (cache.size >= MEASUREMENT_CACHE_LIMIT) {
      cache = this.cache = new MeasurementCache();
      widths = cache.widthsFor(style);
    }
    widths.set(text, width);
    cache.size++;
    return width;
  };
}

export function createMeasurer(doc: Document): TextMeasurer {
  let measurer = measurers.get(doc);
  if (measurer) return measurer;
  measurer = new DocumentMeasurer(doc);
  measurers.set(doc, measurer);
  return measurer;
}

export function sameTextStyle(a: TextStyle | null, b: TextStyle): boolean {
  return a !== null && a.font === b.font && a.letterSpacing === b.letterSpacing &&
    a.wordSpacing === b.wordSpacing && a.lineHeight === b.lineHeight;
}

/** What hears of the window's environment changes; reduced motion is optional (charts draw no animation). */
export interface EnvSubscriber {
  pixelRatio(): void;
  motion?(): void;
  fonts(): void;
}

interface EnvHub {
  readonly subscribers: Set<EnvSubscriber>;
  readonly teardown: () => void;
}

/** One `watchEnvironment` call: its own entry, so one handlers object watched twice is two subscriptions. */
class EnvRegistration implements EnvSubscriber {
  constructor(private readonly h: { pixelRatio(): void; motion(): void; fonts(): void }) {}
  pixelRatio(): void { this.h.pixelRatio(); }
  motion(): void { this.h.motion(); }
  fonts(): void { this.h.fonts(); }
}

type Subscriptions<S> = { readonly subscribers: Set<S> };

export function drainUndo(fns: (() => void)[]): void {
  for (let fn = fns.pop(); fn; fn = fns.pop()) release(fn);
}

// Teardown continues even if a host listener throws while being removed.
export function release(fn: () => void): void {
  try { fn(); } catch { /* keep releasing */ }
}

export function register<K extends object, S, H extends Subscriptions<S>>(
  hubs: WeakMap<K, H>, key: K, hub: H, entry: S, teardown: (hub: H) => void,
): () => void {
  const { subscribers } = hub;
  subscribers.add(entry);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    subscribers.delete(entry);
    if (!subscribers.size) {
      if (hubs.get(key) === hub) hubs.delete(key);
      teardown(hub);
    }
  };
}

function unsubscribe<K extends object, S, H extends Subscriptions<S>>(
  hubs: WeakMap<K, H>, key: K, subscriber: S, teardown: (hub: H) => void,
): void {
  const hub = hubs.get(key);
  if (hub && hub.subscribers.delete(subscriber) && !hub.subscribers.size) {
    hubs.delete(key);
    teardown(hub);
  }
}

export function teardownHub(hub: { teardown(): void }): void {
  hub.teardown();
}

export function listen(
  undo: (() => void)[], target: EventTarget | undefined, type: string, listener: EventListener,
): void {
  target?.addEventListener(type, listener);
  undo.push(() => target?.removeEventListener(type, listener));
}

export function dispatch<S>(subscribers: Set<S>, notify: (entry: S) => void): void {
  // Changes to subscriptions during a notification apply to the rest of this batch.
  for (const sub of [...subscribers]) if (subscribers.has(sub)) notify(sub);
}

const envHubs = new WeakMap<Window, EnvHub>();

/**
 * Calls `onChange` when the device pixel ratio changes (browser zoom, moving to another screen), when
 * reduced motion is toggled, and when web fonts finish loading. Returns `stop`.
 * Listeners are shared per window and released as soon as the last subscriber stops.
 */
export function watchEnvironment(win: Window, handlers: { pixelRatio(): void; motion(): void; fonts(): void }): () => void {
  return subscribeEnvironment(win, new EnvRegistration(handlers));
}

/** The browser host already owns the subscriber and records its undo alongside the other subscriptions. */
export function subscribeEnvironment(win: Window, subscriber: EnvSubscriber): () => void {
  return register<Window, EnvSubscriber, EnvHub>(envHubs, win, envHubFor(win), subscriber, teardownHub);
}

/**
 * `subscriber` hears of the window's environment changes until `leaveEnvironment` with the same object: a chart
 * subscribes the object it already has, so the subscription makes no wrapper and no `stop` closure.
 */
export function joinEnvironment(win: Window, subscriber: EnvSubscriber): void {
  envHubFor(win).subscribers.add(subscriber);
}

/** Ends `joinEnvironment`; the last subscriber's leaving removes the window's listeners. Idempotent. */
export function leaveEnvironment(win: Window, subscriber: EnvSubscriber): void {
  unsubscribe(envHubs, win, subscriber, teardownHub);
}

function envHubFor(win: Window): EnvHub {
  let hub = envHubs.get(win);
  if (!hub) {
    let active = true;
    const subscribers = new Set<EnvSubscriber>();
    // Each subscription registers its removal as soon as it exists, so a failure part-way (a matchMedia that
    // throws) leaves none behind (review 3, finding 9).
    const undo: (() => void)[] = [];
    const teardown = (): void => {
      active = false;
      drainUndo(undo);
    };
    try {
      let ratioQuery: MediaQueryList | null = null;
      const onRatio = (): void => {
        if (!active) return;
        arm();
        dispatch(subscribers, notifyPixelRatio);
      };
      // A resolution query matches one ratio only, so it is re-armed for the new ratio after each change.
      const arm = (): void => {
        ratioQuery?.removeEventListener('change', onRatio);
        ratioQuery = win.matchMedia(`(resolution: ${win.devicePixelRatio}dppx)`);
        ratioQuery.addEventListener('change', onRatio);
      };
      arm();
      undo.push(() => ratioQuery?.removeEventListener('change', onRatio));
      const motion = win.matchMedia('(prefers-reduced-motion: reduce)');
      const onMotion = (): void => {
        if (!active) return;
        dispatch(subscribers, notifyMotion);
      };
      listen(undo, motion, 'change', onMotion);
      const fonts = win.document.fonts as FontFaceSet | undefined;
      // A load that brought no font faces changed nothing: Firefox fires an empty 'loadingdone' some 100 ms after
      // the page loads, and taking it for a font change ran layout again at the same sizes (spec L3; engines
      // report 2, item 2).
      const onFonts = (event: Event): void => {
        const faces = (event as Event & { fontfaces?: ArrayLike<unknown> }).fontfaces;
        if (!active || (faces !== undefined && faces.length === 0)) return;
        // One real load moves the document's measurement epoch once, before any chart hears of it.
        noteFontLoad(win.document);
        dispatch(subscribers, notifyFonts);
      };
      listen(undo, fonts, 'loadingdone', onFonts);
    } catch (error) {
      teardown();
      throw error;
    }
    hub = { subscribers, teardown };
    envHubs.set(win, hub);
  }
  return hub;
}

const notifyPixelRatio = (sub: EnvSubscriber): void => sub.pixelRatio();
const notifyFonts = (sub: EnvSubscriber): void => sub.fonts();
const notifyMotion = (sub: EnvSubscriber): void => sub.motion?.();

// ── Shared ResizeObservers ────────────────────────────────────────────────────────────────────────
//
// A dashboard of many charts needs one observer per document, not one per chart: each delivery is mapped
// back to the charts its targets belong to, and every chart hears of it once. A hub holds its charts only
// while they are registered; a chart releases its registration when it leaves the document, so a forgotten
// chart is not kept reachable from the page through the hub.

/** What hears of its targets' resizes: the entries of one delivery that are its own, once per delivery. */
export interface GeometryListener {
  geometryChanged(entries: readonly ResizeObserverEntry[]): void;
}

interface ResizeHub<R extends Targets> {
  readonly observer: ResizeObserver;
  readonly index: WeakMap<Element, R>;
  count: number;
  delivery: number;
  disconnect(): void;
}

function resizeHub<R extends Targets>(
  hubs: WeakMap<Document, ResizeHub<R>>, win: Window & typeof globalThis, doc: Document,
  deliver: (hub: ResizeHub<R>, entries: readonly ResizeObserverEntry[], doc: Document) => void,
): ResizeHub<R> {
  const existing = hubs.get(doc);
  if (existing) return existing;
  const hub: ResizeHub<R> = {
    observer: new win.ResizeObserver(entries => deliver(hub, entries, doc)),
    index: new WeakMap(), count: 0, delivery: 0,
    disconnect() {
      if (hubs.get(doc) === hub) hubs.delete(doc);
      hub.observer.disconnect();
    },
  };
  hubs.set(doc, hub);
  return hub;
}

/** The successful prefix is enough to roll back a partially observed chart. */
abstract class Targets {
  live = true;
  #observed = 0;
  readonly #targets: Element | readonly Element[];

  constructor(private readonly hub: ResizeHub<Targets>, targets: Element | readonly Element[]) {
    this.#targets = targets;
  }
  #at(i: number): Element {
    return Array.isArray(this.#targets) ? this.#targets[i]! : this.#targets as Element;
  }
  observe(disconnectOnFailure: boolean): this {
    const hub = this.hub;
    const count = Array.isArray(this.#targets) ? this.#targets.length : 1;
    try {
      while (this.#observed < count) {
        const target = this.#at(this.#observed);
        hub.index.set(target, this);
        this.#observed++;
        hub.observer.observe(target);
      }
    } catch (error) {
      release(() => this.#detach(disconnectOnFailure && !hub.count));
      throw error;
    }
    hub.count++;
    return this;
  }
  release(): void {
    if (this.live) this.#detach(--this.hub.count === 0);
  }
  #detach(last: boolean): void {
    this.live = false;
    const hub = this.hub, count = this.#observed;
    this.#observed = 0;
    for (let i = 0; i < count; i++) {
      const target = this.#at(i);
      if (hub.index.get(target) === this) hub.index.delete(target);
    }
    if (last) hub.disconnect();
    else for (let i = 0; i < count; i++) hub.observer.unobserve(this.#at(i));
  }
}

type GeometryHub = ResizeHub<GeometryRegistration>;
const geometryHubs = new WeakMap<Document, GeometryHub>();

function deliverGeometry(hub: GeometryHub, entries: readonly ResizeObserverEntry[]): void {
  // One pass groups the delivery by chart, so a dashboard mounting at once costs one look at each entry, and
  // each chart reads only its own.
  const stamp = ++hub.delivery;
  const touched: GeometryRegistration[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const registration = hub.index.get(entry.target);
    if (!registration || !registration.live) continue;
    if (registration.stamp !== stamp) {
      registration.stamp = stamp;
      registration.entries.length = 0;
      touched.push(registration);
    }
    registration.entries.push(entry);
  }
  try {
    // One chart's failure does not keep the others from hearing of their own resize.
    notifyLive(touched, notifyGeometry);
  } finally {
    // Entries name their targets: none is kept past its delivery.
    for (const registration of touched) registration.entries.length = 0;
  }
}

/**
 * One chart's targets on the document's shared ResizeObserver. A class, so a chart's registration is one
 * object and its release is a shared method rather than closures made per chart.
 */
export class GeometryRegistration extends Targets {
  stamp = 0;
  readonly entries: ResizeObserverEntry[] = [];
  constructor(hub: GeometryHub, targets: readonly Element[], readonly listener: GeometryListener) { super(hub, targets); }
}

/**
 * Observes `targets` (a chart's figure and plot) on the document's shared ResizeObserver; the listener gets
 * this registration's entries of a delivery, once, when any of its targets changed. `targets` is read again on
 * release, so it must not change meanwhile. Returns the registration; its `release` is idempotent.
 */
export function observeGeometry(
  win: Window & typeof globalThis, doc: Document, targets: readonly Element[], listener: GeometryListener,
): GeometryRegistration {
  return new GeometryRegistration(resizeHub(geometryHubs, win, doc, deliverGeometry), targets, listener).observe(true);
}

/** What a chart's font probe reports to: whether a change counts now, and the change itself. */
export interface FontProbeListener {
  fontProbeReady(): boolean;
  fontProbeChanged(): void;
}

type ProbeHub = ResizeHub<ProbeRegistration>;
const probeHubs = new WeakMap<Document, ProbeHub>();

function deliverProbes(hub: ProbeHub, entries: readonly ResizeObserverEntry[], doc: Document): void {
  let changed: ProbeRegistration[] | null = null;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const registration = hub.index.get(entry.target);
    if (!registration || !registration.live) continue;
    const box = entry.contentRect;
    const { width, height } = box;
    const baseline = Number.isNaN(registration.width);
    if (!baseline && (width !== registration.width || height !== registration.height) && registration.listener.fontProbeReady()) {
      (changed ??= []).push(registration);
    }
    registration.width = width;
    registration.height = height;
  }
  if (changed === null) return;
  // A font load is seen by every probe of the page at once: widths measured with the old font go once.
  noteFontLoad(doc);
  notifyLive(changed, notifyProbe);
}

const notifyGeometry = (r: GeometryRegistration): void => r.listener.geometryChanged(r.entries);
const notifyProbe = (r: ProbeRegistration): void => r.listener.fontProbeChanged();

/** Calls `notify` on every live registration; the first failure is rethrown once all were called. */
function notifyLive<R extends { readonly live: boolean }>(list: readonly R[], notify: (r: R) => void): void {
  let failed = false;
  let failure: unknown;
  for (const registration of list) {
    if (!registration.live) continue;
    try { notify(registration); } catch (error) {
      if (!failed) { failed = true; failure = error; }
    }
  }
  if (failed) throw failure;
}

/** One chart's font probe on the document's shared probe observer; `release` is a shared method. */
export class ProbeRegistration extends Targets {
  /** The first probe box establishes its baseline. */
  width = NaN;
  height = NaN;
  constructor(hub: ProbeHub, probe: Element, readonly listener: FontProbeListener) { super(hub, probe); }
}

/**
 * Observes a chart's font probe (an element in its own text layer, so it inherits the chart's font) on the
 * document's shared probe observer. A change of the probe's size after its first delivery means the font it
 * renders in changed: the measurement cache is cleared once and `fontProbeChanged` called for each chart whose
 * `fontProbeReady()` holds. Returns the registration; its `release` is idempotent.
 */
export function observeFontProbe(
  win: Window & typeof globalThis, doc: Document, probe: Element, listener: FontProbeListener,
): ProbeRegistration {
  const fresh = !probeHubs.has(doc);
  const hub = resizeHub(probeHubs, win, doc, deliverProbes);
  return new ProbeRegistration(hub, probe, listener).observe(fresh);
}

/** The parent that supplies inherited styles and language, including through a slot. */
export function composedParent(element: Element, roots?: Node[]): Element | null {
  const parent = element.assignedSlot ?? element.parentElement;
  if (parent) return parent;
  const root = element.parentNode;
  if (!root || root.nodeType !== 11 || !('host' in root)) return null;
  if (roots && !roots.includes(root)) roots.push(root);
  return (root as ShadowRoot).host;
}

export function holds(target: Node, element: Element): boolean {
  for (let el: Element | null = element; el; el = composedParent(el)) if (el === target) return true;
  return false;
}

export function pageLanguage(element: Element): string | null {
  for (let el: Element | null = element; el; el = composedParent(el)) {
    const lang = el.getAttribute('lang');
    if (lang !== null) return lang.trim() || null;
  }
  return null;
}

/** Subtree observation stops at shadow boundaries, including those entered through slots. */
export function observeTrees(observer: MutationObserver, element: Element, options: MutationObserverInit): void {
  observeRoots(observer, treesOf(element), options);
}

function observeRoots(observer: MutationObserver, roots: readonly Node[], options: MutationObserverInit): void {
  for (const root of roots) observer.observe(root, options);
}

function treesOf(element: Element): Node[] {
  const trees: Node[] = [element.ownerDocument.documentElement];
  // A light-DOM ancestor can enter a shadow tree through a slot even when element.getRootNode() is the document.
  let el: Element | null = element;
  while (el) el = composedParent(el, trees);
  return trees;
}

export interface SharedTreeSubscriber {
  readonly element: Element;
  readonly onChange: () => void;
  /** Optional filter for `style` attribute mutations directly on `element`. */
  readonly styleChanged?: (records: readonly MutationRecord[]) => boolean;
}

interface RootMutationHub {
  readonly observer: MutationObserver;
  readonly subscribers: Set<SharedTreeSubscriber>;
}

/** Per-root ref-counted MutationObserver hubs: each documentElement or ShadowRoot owns its own observer. */
const langRootHubs = new WeakMap<Node, RootMutationHub>();
const themeRootHubs = new WeakMap<Node, RootMutationHub>();

function dispatchMutations(
  kind: 'lang' | 'theme',
  subscribers: Set<SharedTreeSubscriber>,
  records: readonly MutationRecord[],
): void {
  if (subscribers.size === 0 || records.length === 0) return;
  const targets = new Map<Node, boolean | MutationRecord[]>();
  // Only a chart's own style filter needs old declarations. An ancestor's style always counts.
  if (kind === 'theme') {
    for (const sub of subscribers) if (sub.styleChanged) targets.set(sub.element, false);
  }
  for (const record of records) {
    const { target } = record;
    const own = targets.get(target);
    if (record.attributeName === 'style' && own !== undefined && own !== true) {
      if (own === false) targets.set(target, [record]);
      else own.push(record);
    } else targets.set(target, true);
  }
  for (const sub of [...subscribers]) {
    if (!subscribers.has(sub)) continue;
    const own = sub.element;
    for (let el: Element | null = own; el; el = composedParent(el)) {
      const change = targets.get(el);
      if (change && (change === true || el !== own || !sub.styleChanged || sub.styleChanged(change))) {
        sub.onChange();
        break;
      }
    }
  }
}

function disconnect(hub: RootMutationHub): void {
  hub.observer.disconnect();
}

function subscribeRoot(
  hubs: WeakMap<Node, RootMutationHub>,
  kind: 'lang' | 'theme',
  win: Window & typeof globalThis,
  root: Node,
  options: MutationObserverInit,
  subscriber: SharedTreeSubscriber,
): () => void {
  return register(hubs, root, rootHubFor(hubs, kind, win, root, options), subscriber, disconnect);
}

function rootHubFor(
  hubs: WeakMap<Node, RootMutationHub>,
  kind: 'lang' | 'theme',
  win: Window & typeof globalThis,
  root: Node,
  options: MutationObserverInit,
): RootMutationHub {
  let hub = hubs.get(root);
  if (!hub) {
    const subscribers = new Set<SharedTreeSubscriber>();
    const observer = new win.MutationObserver(records => dispatchMutations(kind, subscribers, records));
    try {
      observer.observe(root, options);
    } catch (error) {
      try { observer.disconnect(); } catch { /* ignore */ }
      throw error;
    }
    hub = { observer, subscribers };
    hubs.set(root, hub);
  }
  return hub;
}

/**
 * Shared per-root ref-counted subtree `MutationObserver` for `documentElement` and each `ShadowRoot`.
 * Because every root owns its own observer, removing the last subscriber from a shadow root never
 * disconnects `documentElement`'s observer or drops pending records for surviving charts.
 */
export function subscribeTreeMutations(
  kind: 'lang' | 'theme',
  element: Element,
  options: MutationObserverInit,
  subscriber: SharedTreeSubscriber,
): () => void {
  const doc = element.ownerDocument;
  const win = doc.defaultView;
  if (win === null) return () => {};
  const hubs = kind === 'lang' ? langRootHubs : themeRootHubs;
  const trees = treesOf(element);
  if (trees.length === 1) {
    return subscribeRoot(hubs, kind, win, trees[0]!, options, subscriber);
  }
  const stops: (() => void)[] = [];
  try {
    for (const root of trees) stops.push(subscribeRoot(hubs, kind, win, root, options, subscriber));
  } catch (error) {
    drainUndo(stops);
    throw error;
  }
  return () => drainUndo(stops);
}

const LANG_OPTIONS: MutationObserverInit = { attributes: true, attributeFilter: ['lang'], subtree: true };

/**
 * Calls `onChange` when a `lang` attribute changes on `element` or an ancestor: the page's language decides
 * the formatting locale and which built-in text is marked English (spec A10, F6). An environment change,
 * kept apart from the theme watcher. Returns `stop`.
 */
/**
 * `watchLanguage` for a chart, which tells `target.language()`: the watch is its own subscriber and stops by
 * identity, so a chart in the light DOM makes one object for it and no closure.
 */
export class LanguageWatch implements SharedTreeSubscriber {
  /** The shared root hub this watch is on, or the dedicated observer of a chart inside shadow DOM. */
  #root: Node | null = null;
  #stopShadow: (() => void) | null = null;

  constructor(readonly element: Element, private readonly target: { language(): void }) {}

  onChange(): void { this.target.language(); }

  start(): void {
    const element = this.element;
    const win = element.ownerDocument.defaultView;
    if (win === null) return;
    const trees = treesOf(element);
    if (trees.length === 1) {
      const root = trees[0]!;
      rootHubFor(langRootHubs, 'lang', win, root, LANG_OPTIONS).subscribers.add(this);
      this.#root = root;
    } else {
      this.#stopShadow = watchShadowLanguage(win, trees, element, () => this.onChange());
    }
  }

  /** Idempotent; the last subscriber of a root disconnects its observer. */
  stop(): void {
    const root = this.#root;
    const shadow = this.#stopShadow;
    this.#root = null;
    this.#stopShadow = null;
    shadow?.();
    if (root !== null) unsubscribe<Node, SharedTreeSubscriber, RootMutationHub>(langRootHubs, root, this, disconnect);
  }
}

export function watchLanguage(element: Element, onChange: () => void): () => void {
  const win = element.ownerDocument.defaultView;
  if (win === null) return () => {};
  const trees = treesOf(element);
  if (trees.length === 1) {
    return subscribeRoot(langRootHubs, 'lang', win, trees[0]!, LANG_OPTIONS, { element, onChange });
  }
  return watchShadowLanguage(win, trees, element, onChange);
}

function watchShadowLanguage(win: Window & typeof globalThis, trees: Node[], element: Element, onChange: () => void): () => void {
  // Inside shadow DOM, keep one dedicated observer across the composed trees so teardown disconnects once
  // and never perturbs the shared documentElement hub used by light-DOM charts.
  const observer = new win.MutationObserver(records => {
    for (const r of records) {
      if (holds(r.target, element)) { onChange(); return; }
    }
  });
  try {
    observeRoots(observer, trees, LANG_OPTIONS);
  } catch (error) {
    observer.disconnect();
    throw error;
  }
  return () => observer.disconnect();
}
