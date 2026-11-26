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
  const n = parseFloat(value);
  const px = Number.isFinite(n) && !value.endsWith('px') ? n * fontSize : n;
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
  font: string;
  letterSpacing: string;
  wordSpacing: string;
  /** The font epoch the context last resolved its font in; -1 before its first measurement. */
  epoch: number;
}

const contexts = new WeakMap<Document, MeasuringContext | null>();
type Widths = Map<string, number>;
interface MeasurementCache {
  readonly styles: WeakMap<TextStyle, Widths>;
  readonly fonts: Map<string, Map<number, Map<number, Widths>>>;
  size: number;
  /** The style measured last and its widths: consecutive labels of one style skip the lookups. */
  lastStyle: TextStyle | null;
  lastWidths: Widths | null;
}
/** Measured widths per document, for every style together, so the bound holds for the whole page. */
const caches = new WeakMap<Document, MeasurementCache>();
const fontEpochs = new WeakMap<Document, number>();
export const MEASUREMENT_CACHE_LIMIT = 8192;

/**
 * Web fonts finished loading in `doc`: widths measured with a fallback font are wrong now. Every chart of
 * the document calls this on the same event; the first clears the cache and the epoch moves on.
 */
export function noteFontLoad(doc: Document): void {
  fontEpochs.set(doc, (fontEpochs.get(doc) ?? 0) + 1);
  caches.delete(doc);
}

/** How many widths the document's cache holds (for tests of its bound). */
export function measurementCacheSize(doc: Document): number {
  return caches.get(doc)?.size ?? 0;
}

const measurers = new WeakMap<Document, TextMeasurer>();

function newMeasurementCache(doc: Document): MeasurementCache {
  const cache: MeasurementCache = { styles: new WeakMap(), fonts: new Map(), size: 0, lastStyle: null, lastWidths: null };
  caches.set(doc, cache);
  return cache;
}

function widthsFor(cache: MeasurementCache, style: TextStyle): Widths {
  if (cache.lastStyle === style) return cache.lastWidths!;
  let widths = cache.styles.get(style);
  if (!widths) {
    // Equivalent styles from different charts share measurements. Line height does not affect width.
    let letters = cache.fonts.get(style.font);
    if (!letters) cache.fonts.set(style.font, letters = new Map());
    let words = letters.get(style.letterSpacing);
    if (!words) letters.set(style.letterSpacing, words = new Map());
    widths = words.get(style.wordSpacing);
    if (!widths) words.set(style.wordSpacing, widths = new Map());
    cache.styles.set(style, widths);
  }
  cache.lastStyle = style;
  cache.lastWidths = widths;
  return widths;
}

function measuringContext(doc: Document): MeasuringContext | null {
  let state = contexts.get(doc);
  if (state === undefined) {
    const ctx = doc.createElement('canvas').getContext('2d') as SpacingContext | null;
    if (ctx) {
      const spaced = typeof ctx.letterSpacing === 'string' && typeof ctx.wordSpacing === 'string';
      // The context's own starting values, read once: nothing but this module changes them afterwards.
      state = {
        ctx, spaced, font: ctx.font, letterSpacing: spaced ? ctx.letterSpacing! : '', wordSpacing: spaced ? ctx.wordSpacing! : '',
        epoch: -1,
      };
    } else state = null;
    contexts.set(doc, state);
  }
  return state;
}

/**
 * Canvas `measureText` with the computed font and the page's letter and word spacing (spec A6). Where the
 * context supports `letterSpacing` and `wordSpacing` they are set on it, so the browser adds them as it
 * does for the text layer; otherwise they are added the way CSS adds them (after every character, and
 * after every space). Cached per document, font epoch, style and string.
 */
export function createMeasurer(doc: Document): TextMeasurer {
  let measurer = measurers.get(doc);
  if (measurer) return measurer;
  measurer = {
    width(text: string, style: TextStyle): number {
      let cache = caches.get(doc) ?? newMeasurementCache(doc);
      let widths = widthsFor(cache, style);
      const hit = widths.get(text);
      if (hit !== undefined) return hit;
      const state = measuringContext(doc);
      let width: number;
      let spaced = false;
      if (state) {
        const c = state.ctx;
        const epoch = fontEpochs.get(doc) ?? 0;
        if (state.epoch !== epoch) {
          // WebKit keeps the font it resolved when `font` was assigned and does not resolve it again when the
          // same string is assigned: after a font load, a different font is assigned first, so the wanted one
          // is resolved anew (the engines report, WebKit section). Once per load; Chrome and Firefox measure the
          // same either way. The live value is read here, once per load, so the toggle always differs from it.
          const toggle = c.font === '10px serif' ? '10px sans-serif' : '10px serif';
          c.font = toggle;
          state.font = toggle;
          state.epoch = epoch;
        }
        if (state.font !== style.font) {
          c.font = style.font;
          state.font = style.font;
        }
        if (state.spaced) {
          const letter = `${style.letterSpacing}px`;
          const word = `${style.wordSpacing}px`;
          if (state.letterSpacing !== letter) {
            c.letterSpacing = letter;
            state.letterSpacing = letter;
          }
          if (state.wordSpacing !== word) {
            c.wordSpacing = word;
            state.wordSpacing = word;
          }
          spaced = true;
        }
        width = c.measureText(text).width;
      } else {
        width = text.length * parseFloat(/(\d+(?:\.\d+)?)px/.exec(style.font)?.[1] ?? '12') * 0.6;
      }
      if (!spaced) {
        if (style.letterSpacing !== 0) width += style.letterSpacing * [...text].length;
        if (style.wordSpacing !== 0) {
          let spaces = 0;
          for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 32) spaces++;
          width += style.wordSpacing * spaces;
        }
      }
      if (cache.size >= MEASUREMENT_CACHE_LIMIT) {
        cache = newMeasurementCache(doc);
        widths = widthsFor(cache, style);
      }
      widths.set(text, width);
      cache.size++;
      return width;
    },
  };
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
  return register<Window, EnvSubscriber, EnvHub>(envHubs, win, envHubFor(win), new EnvRegistration(handlers), teardownHub);
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
  const hub = envHubs.get(win);
  if (!hub || !hub.subscribers.delete(subscriber) || hub.subscribers.size) return;
  envHubs.delete(win);
  hub.teardown();
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

interface GeometryHub {
  readonly observer: ResizeObserver;
  readonly index: WeakMap<Element, GeometryRegistration>;
  count: number;
  delivery: number;
}

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
export class GeometryRegistration {
  live = true;
  /** The delivery this registration last heard of, so several of its targets in one delivery count once. */
  stamp = 0;
  /** This registration's own entries of the delivery being dispatched; empty between deliveries. */
  readonly entries: ResizeObserverEntry[] = [];
  /** How many of `targets`, from the first, are observed. */
  #observed = 0;

  constructor(
    private readonly doc: Document, private readonly hub: GeometryHub, private readonly targets: readonly Element[],
    readonly listener: GeometryListener,
  ) {}

  /** Observes every target; one that cannot be observed leaves none of this chart's behind (and no empty hub). */
  observe(): void {
    const hub = this.hub;
    try {
      for (const target of this.targets) {
        hub.index.set(target, this);
        this.#observed++;
        hub.observer.observe(target);
      }
    } catch (error) {
      this.live = false;
      try { this.#unobserve(); } catch { /* the original failure matters more */ }
      throw error;
    }
    hub.count++;
  }

  /** Unobserves the targets; the last release disconnects the observer and forgets the hub. Idempotent. */
  release(): void {
    if (!this.live) return;
    this.live = false;
    this.hub.count--;
    this.#unobserve();
  }

  #unobserve(): void {
    const hub = this.hub;
    const targets = this.targets;
    const observed = this.#observed;
    this.#observed = 0;
    for (let i = 0; i < observed; i++) {
      const target = targets[i]!;
      if (hub.index.get(target) === this) hub.index.delete(target);
    }
    if (hub.count === 0) {
      if (geometryHubs.get(this.doc) === hub) geometryHubs.delete(this.doc);
      hub.observer.disconnect();
    } else {
      for (let i = 0; i < observed; i++) hub.observer.unobserve(targets[i]!);
    }
  }
}

/**
 * Observes `targets` (a chart's figure and plot) on the document's shared ResizeObserver; the listener gets
 * this registration's entries of a delivery, once, when any of its targets changed. `targets` is read again on
 * release, so it must not change meanwhile. Returns the registration; its `release` is idempotent.
 */
export function observeGeometry(
  win: Window & typeof globalThis, doc: Document, targets: readonly Element[], listener: GeometryListener,
): GeometryRegistration {
  let hub = geometryHubs.get(doc);
  if (!hub) {
    const created: GeometryHub = {
      observer: new win.ResizeObserver(entries => deliverGeometry(created, entries)),
      index: new WeakMap(), count: 0, delivery: 0,
    };
    hub = created;
    geometryHubs.set(doc, hub);
  }
  const registration = new GeometryRegistration(doc, hub, targets, listener);
  registration.observe();
  return registration;
}

/** What a chart's font probe reports to: whether a change counts now, and the change itself. */
export interface FontProbeListener {
  fontProbeReady(): boolean;
  fontProbeChanged(): void;
}

interface ProbeHub {
  readonly observer: ResizeObserver;
  readonly index: WeakMap<Element, ProbeRegistration>;
  count: number;
}

const probeHubs = new WeakMap<Document, ProbeHub>();

function deliverProbes(doc: Document, hub: ProbeHub, entries: readonly ResizeObserverEntry[]): void {
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
export class ProbeRegistration {
  live = true;
  /** The probe's last delivered content box; NaN until the first delivery, which only sets the baseline. */
  width = NaN;
  height = NaN;

  constructor(
    private readonly doc: Document, private readonly hub: ProbeHub, private readonly probe: Element,
    readonly listener: FontProbeListener,
  ) {}

  /** Idempotent; the last release disconnects the observer. */
  release(): void {
    if (this.live) this.detach(--this.hub.count === 0);
  }

  /** Stops observing the probe; the `last` one disconnects the observer and lets its hub go. */
  detach(last: boolean): void {
    this.live = false;
    const { hub, probe, doc } = this;
    if (hub.index.get(probe) === this) hub.index.delete(probe);
    if (last) {
      if (probeHubs.get(doc) === hub) probeHubs.delete(doc);
      hub.observer.disconnect();
    } else {
      hub.observer.unobserve(probe);
    }
  }
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
  let hub = probeHubs.get(doc);
  const fresh = !hub;
  if (!hub) {
    const created: ProbeHub = {
      observer: new win.ResizeObserver(entries => deliverProbes(doc, created, entries)),
      index: new WeakMap(), count: 0,
    };
    hub = created;
    probeHubs.set(doc, hub);
  }
  const shared = hub;
  const registration = new ProbeRegistration(doc, shared, probe, listener);
  shared.index.set(probe, registration);
  try {
    shared.observer.observe(probe);
  } catch (error) {
    // As for geometry: nothing of this probe stays observed, and a hub it created goes with it.
    try { registration.detach(fresh && shared.count === 0); } catch { /* the original failure matters more */ }
    throw error;
  }
  shared.count++;
  return registration;
}

/** The parent that supplies inherited styles and language, including through a slot. */
export function composedParent(element: Element): Element | null {
  const parent = element.parentNode;
  return element.assignedSlot ?? element.parentElement ?? (parent && parent.nodeType === 11 && 'host' in parent ? (parent as ShadowRoot).host : null);
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
  for (let el: Element | null = element; el; el = composedParent(el)) {
    const parent = el.parentNode;
    if (parent && parent.nodeType === 11 && 'host' in parent && !trees.includes(parent)) trees.push(parent);
  }
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
  const targets = new Set<Node>();
  let styles: Map<Node, MutationRecord[]> | undefined;
  for (const record of records) {
    const { target } = record;
    if (kind === 'theme' && record.attributeName === 'style') {
      styles ??= new Map();
      let list = styles.get(target);
      if (!list) styles.set(target, list = []);
      list.push(record);
    } else targets.add(target);
  }
  for (const sub of [...subscribers]) {
    if (!subscribers.has(sub)) continue;
    const own = sub.element;
    for (let el: Element | null = own; el; el = composedParent(el)) {
      const records = styles?.get(el);
      if (targets.has(el) || (records && (el !== own || !sub.styleChanged || sub.styleChanged(records)))) {
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
      this.#stopShadow = watchLanguage(element, () => this.onChange());
    }
  }

  /** Idempotent; the last subscriber of a root disconnects its observer. */
  stop(): void {
    const root = this.#root;
    const shadow = this.#stopShadow;
    this.#root = null;
    this.#stopShadow = null;
    shadow?.();
    if (root === null) return;
    const hub = langRootHubs.get(root);
    if (!hub || !hub.subscribers.delete(this) || hub.subscribers.size) return;
    langRootHubs.delete(root);
    disconnect(hub);
  }
}

export function watchLanguage(element: Element, onChange: () => void): () => void {
  const win = element.ownerDocument.defaultView;
  if (win === null) return () => {};
  const trees = treesOf(element);
  if (trees.length === 1) {
    return subscribeRoot(langRootHubs, 'lang', win, trees[0]!, LANG_OPTIONS, { element, onChange });
  }
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
