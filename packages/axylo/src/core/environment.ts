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

/** `options.locale`, else the document language, else the browser's, as a locale Intl accepts. */
export function resolveLocale(option: unknown, doc: Document | null): string {
  const candidates = [option, doc?.documentElement.lang, doc?.defaultView?.navigator.language];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.trim() === '') continue;
    try {
      const [canonical] = Intl.getCanonicalLocales(candidate.trim());
      if (canonical) return canonical;
    } catch {
      // Not a locale tag; try the next source.
    }
  }
  return new Intl.NumberFormat().resolvedOptions().locale;
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
/** Measured widths per document, for every style together, so the bound holds for the whole page. */
const caches = new WeakMap<Document, Map<string, number>>();
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
  caches.get(doc)?.clear();
}

/** How many widths the document's cache holds (for tests of its bound). */
export function measurementCacheSize(doc: Document): number {
  return caches.get(doc)?.size ?? 0;
}

type SpacingContext = CanvasRenderingContext2D & { letterSpacing?: string; wordSpacing?: string };

/**
 * Canvas `measureText` with the computed font and the page's letter and word spacing (spec A6). Where the
 * context supports `letterSpacing` and `wordSpacing` they are set on it, so the browser adds them as it
 * does for the text layer; otherwise they are added the way CSS adds them (after every character, and
 * after every space). Cached per document, font epoch, style and string.
 */
export function createMeasurer(doc: Document): TextMeasurer {
  return {
    width(text: string, style: TextStyle): number {
      let ctx = contexts.get(doc);
      if (ctx === undefined) {
        ctx = doc.createElement('canvas').getContext('2d');
        contexts.set(doc, ctx);
      }
      let cache = caches.get(doc);
      if (!cache) caches.set(doc, cache = new Map());
      const key = `${fontEpochs.get(doc) ?? 0}|${style.font}|${style.letterSpacing}|${style.wordSpacing}|${text}`;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
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
      if (cache.size >= MEASUREMENT_CACHE_LIMIT) cache.clear();
      cache.set(key, width);
      return width;
    },
  };
}

export function sameTextStyle(a: TextStyle | null, b: TextStyle): boolean {
  return a !== null && a.font === b.font && a.letterSpacing === b.letterSpacing &&
    a.wordSpacing === b.wordSpacing && a.lineHeight === b.lineHeight;
}

/**
 * Calls `onChange` when the device pixel ratio changes (browser zoom, moving to another screen), when
 * reduced motion is toggled, and when web fonts finish loading. Returns `stop`.
 */
export function watchEnvironment(win: Window, handlers: { pixelRatio(): void; motion(): void; fonts(): void }): () => void {
  let stopped = false;
  // Each subscription registers its removal as soon as it exists, so a failure part-way (a matchMedia that
  // throws) leaves none behind (review 3, finding 9).
  const undo: (() => void)[] = [];
  const stop = (): void => {
    stopped = true;
    for (let fn = undo.pop(); fn; fn = undo.pop()) {
      try { fn(); } catch { /* keep releasing */ }
    }
  };
  try {
    let ratioQuery: MediaQueryList | null = null;
    const onRatio = (): void => {
      if (stopped) return;
      arm();
      handlers.pixelRatio();
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
    const onMotion = (): void => { if (!stopped) handlers.motion(); };
    motion.addEventListener('change', onMotion);
    undo.push(() => motion.removeEventListener('change', onMotion));
    const fonts = win.document.fonts as FontFaceSet | undefined;
    // A load that brought no font faces changed nothing: Firefox fires an empty 'loadingdone' some 100 ms after
    // the page loads, and taking it for a font change ran layout again at the same sizes (spec L3; engines
    // report 2, item 2).
    const onFonts = (event: Event): void => {
      const faces = (event as Event & { fontfaces?: ArrayLike<unknown> }).fontfaces;
      if (stopped || (faces !== undefined && faces.length === 0)) return;
      handlers.fonts();
    };
    fonts?.addEventListener('loadingdone', onFonts);
    undo.push(() => fonts?.removeEventListener('loadingdone', onFonts));
  } catch (error) {
    stop();
    throw error;
  }
  return stop;
}

/**
 * Calls `onChange` when a `lang` attribute changes on `element` or an ancestor: the page's language decides
 * the formatting locale and which built-in text is marked English (spec A10, F6). An environment change,
 * kept apart from the theme watcher. Returns `stop`.
 */
export function watchLanguage(element: Element, onChange: () => void): () => void {
  const win = element.ownerDocument.defaultView;
  if (win === null) return () => {};
  const observer = new win.MutationObserver(records => {
    for (const r of records) {
      if (r.target instanceof win.Node && r.target.contains(element)) { onChange(); return; }
    }
  });
  observer.observe(element.ownerDocument.documentElement, { attributes: true, attributeFilter: ['lang'], subtree: true });
  return () => observer.disconnect();
}
