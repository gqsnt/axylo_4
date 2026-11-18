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
const caches = new WeakMap<Document, Map<string, Map<string, number>>>();
const CACHE_LIMIT = 4096;

/**
 * Canvas `measureText` with the computed font, plus the page's letter and word spacing (added the way CSS
 * adds them: after every character, and after every space). Cached per style and string.
 */
export function createMeasurer(doc: Document): TextMeasurer {
  return {
    width(text: string, style: TextStyle): number {
      let ctx = contexts.get(doc);
      if (ctx === undefined) {
        ctx = doc.createElement('canvas').getContext('2d');
        contexts.set(doc, ctx);
      }
      let byStyle = caches.get(doc);
      if (!byStyle) caches.set(doc, byStyle = new Map());
      const key = `${style.font}|${style.letterSpacing}|${style.wordSpacing}`;
      let cache = byStyle.get(key);
      if (!cache) byStyle.set(key, cache = new Map());
      const hit = cache.get(text);
      if (hit !== undefined) return hit;
      let width: number;
      if (ctx) {
        if (ctx.font !== style.font) ctx.font = style.font;
        width = ctx.measureText(text).width;
      } else {
        width = text.length * parseFloat(/(\d+(?:\.\d+)?)px/.exec(style.font)?.[1] ?? '12') * 0.6;
      }
      if (style.letterSpacing !== 0) width += style.letterSpacing * [...text].length;
      if (style.wordSpacing !== 0) {
        let spaces = 0;
        for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 32) spaces++;
        width += style.wordSpacing * spaces;
      }
      if (cache.size >= CACHE_LIMIT) cache.clear();
      cache.set(text, width);
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
  let ratioQuery: MediaQueryList | null = null;
  const onRatio = (): void => {
    if (stopped) return;
    arm();
    handlers.pixelRatio();
  };
  // A resolution query matches one ratio only, so it is re-armed for the new ratio after each change.
  function arm(): void {
    ratioQuery?.removeEventListener('change', onRatio);
    ratioQuery = win.matchMedia(`(resolution: ${win.devicePixelRatio}dppx)`);
    ratioQuery.addEventListener('change', onRatio);
  }
  arm();
  const motion = win.matchMedia('(prefers-reduced-motion: reduce)');
  const onMotion = (): void => { if (!stopped) handlers.motion(); };
  motion.addEventListener('change', onMotion);
  const fonts = win.document.fonts as FontFaceSet | undefined;
  const onFonts = (): void => { if (!stopped) handlers.fonts(); };
  fonts?.addEventListener('loadingdone', onFonts);
  return () => {
    stopped = true;
    ratioQuery?.removeEventListener('change', onRatio);
    motion.removeEventListener('change', onMotion);
    fonts?.removeEventListener('loadingdone', onFonts);
  };
}
