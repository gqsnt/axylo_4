/**
 * The browser inputs that output depends on besides options and data (contracts: Environment), and the
 * watchers that say when one of them changed: device pixel ratio, reduced motion, web fonts finishing a load.
 * Nothing here runs at import time; every function takes the window or element it reads.
 */
import type { TextMeasurer, TextStyle } from './contracts';

export function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
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

function pixels(value: string, fontSize: number): number {
  if (value === '' || value === 'normal') return NaN;
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return NaN;
  return value.endsWith('px') ? n : n * fontSize;
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
  const letterSpacing = pixels(style.letterSpacing, fontSize);
  const wordSpacing = pixels(style.wordSpacing, fontSize);
  const lineHeight = pixels(style.lineHeight, fontSize);
  return {
    font,
    letterSpacing: Number.isFinite(letterSpacing) ? letterSpacing : 0,
    wordSpacing: Number.isFinite(wordSpacing) ? wordSpacing : 0,
    // 'normal' depends on the font's metrics; 1.2 is the common value and errs on the side of room.
    lineHeight: Number.isFinite(lineHeight) ? lineHeight : Math.ceil(fontSize * 1.2),
  };
}

const contexts = new WeakMap<Document, CanvasRenderingContext2D | null>();
type Widths = Map<string, number>;
interface MeasurementCache {
  readonly styles: WeakMap<TextStyle, Widths>;
  readonly fonts: Map<string, Map<number, Map<number, Widths>>>;
  size: number;
}
/** Measured widths per document, for every style together, so the bound holds for the whole page. */
const caches = new WeakMap<Document, MeasurementCache>();
const fontEpochs = new WeakMap<Document, number>();
/** The font epoch each document's context last resolved its font in. */
const contextEpochs = new WeakMap<Document, number>();
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

type SpacingContext = CanvasRenderingContext2D & { letterSpacing?: string; wordSpacing?: string };

const measurers = new WeakMap<Document, TextMeasurer>();

function newMeasurementCache(doc: Document): MeasurementCache {
  const cache: MeasurementCache = { styles: new WeakMap(), fonts: new Map(), size: 0 };
  caches.set(doc, cache);
  return cache;
}

function widthsFor(cache: MeasurementCache, style: TextStyle): Widths {
  let widths = cache.styles.get(style);
  if (widths) return widths;
  // Equivalent styles from different charts share measurements. Line height does not affect width.
  let letters = cache.fonts.get(style.font);
  if (!letters) cache.fonts.set(style.font, letters = new Map());
  let words = letters.get(style.letterSpacing);
  if (!words) letters.set(style.letterSpacing, words = new Map());
  widths = words.get(style.wordSpacing);
  if (!widths) words.set(style.wordSpacing, widths = new Map());
  cache.styles.set(style, widths);
  return widths;
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
      let ctx = contexts.get(doc);
      if (ctx === undefined) {
        ctx = doc.createElement('canvas').getContext('2d');
        contexts.set(doc, ctx);
      }
      let width: number;
      let spaced = false;
      if (ctx) {
        const c = ctx as SpacingContext;
        const epoch = fontEpochs.get(doc) ?? 0;
        if (contextEpochs.get(doc) !== epoch) {
          // WebKit keeps the font it resolved when `font` was assigned and does not resolve it again when the
          // same string is assigned: after a font load, a different font is assigned first, so the wanted one
          // is resolved anew (the engines report, WebKit section). Once per load; Chrome and Firefox measure the
          // same either way.
          c.font = c.font === '10px serif' ? '10px sans-serif' : '10px serif';
          contextEpochs.set(doc, epoch);
        }
        if (c.font !== style.font) c.font = style.font;
        if (typeof c.letterSpacing === 'string' && typeof c.wordSpacing === 'string') {
          const letter = `${style.letterSpacing}px`;
          const word = `${style.wordSpacing}px`;
          if (c.letterSpacing !== letter) c.letterSpacing = letter;
          if (c.wordSpacing !== word) c.wordSpacing = word;
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

interface EnvSubscriber {
  readonly pixelRatio: () => void;
  readonly motion: () => void;
  readonly fonts: () => void;
}

interface EnvRegistration { readonly h: EnvSubscriber }
interface EnvHub {
  readonly subscribers: Set<EnvRegistration>;
  readonly teardown: () => void;
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
  let hub = envHubs.get(win);
  if (!hub) {
    let active = true;
    const subscribers = new Set<EnvRegistration>();
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
  return register(envHubs, win, hub, { h: handlers }, teardownHub);
}

const notifyPixelRatio = (sub: EnvRegistration): void => sub.h.pixelRatio();
const notifyMotion = (sub: EnvRegistration): void => sub.h.motion();
const notifyFonts = (sub: EnvRegistration): void => sub.h.fonts();

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
  return register(hubs, root, hub, subscriber, disconnect);
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
