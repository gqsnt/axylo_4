/**
 * Theme resolution (spec L4, DX6, A5): decides light or dark for a chart root, and turns paints into both
 * CSS expressions (for the SVG renderer, which stays live) and concrete colors (for contrast checks). Concrete colors come from the browser itself through probe elements, never from parsing CSS.
 *
 * The chart paints no background unless the author sets `--axylo-background`: marks sit on whatever is
 * behind the chart. So the background used for checks is the effective opaque backdrop, found by walking up
 * from the chart and compositing computed background colors; with `--axylo-background` it is that color
 * (composited over the backdrop), which SVG then also paints. What is measured is what is drawn.
 */
import type { PaintBindings, PaintToken, ResolvedTheme } from '../core/contracts';
import { composedParent } from '../core/environment';
import { composite, isLightColor, parseColor, type Rgba } from './color';
import { LIGHT, SERIES_COUNT } from './palette';

export interface ThemeResolution {
  readonly bindings: PaintBindings;
  readonly theme: ResolvedTheme;
  /**
   * false when the element is not connected to a document: nothing could be computed, the paints are the
   * light defaults, and the caller should resolve again once the chart is attached.
   */
  readonly resolved?: boolean;
  /**
   * false when the backdrop behind the chart could not be determined (a background image on the way up):
   * `theme.paints.tokens.background` is then a guess, and the caller should skip the AX141 check.
   */
  readonly backdropKnown?: boolean;
  /** Series keys whose author color the browser does not accept as a color; they use their palette slot. */
  readonly invalidColors?: readonly string[];
}

const TOKENS: readonly PaintToken[] = ['axis', 'grid', 'reference', 'muted', 'focus', 'text'];

/**
 * CSS expressions for the token paints. Each public name (which an author may set anywhere, including
 * `:root`) falls back to a private default from the stylesheet.
 */
// Readonly by type; not frozen at run time, since a call at import time keeps a bundler from dropping the module.
export const TOKEN_BINDINGS: Readonly<Record<PaintToken, string>> = {
  axis: 'var(--axylo-axis, var(--axylo-default-axis))',
  grid: 'var(--axylo-grid, var(--axylo-default-grid))',
  reference: 'var(--axylo-reference, var(--axylo-default-reference))',
  muted: 'var(--axylo-muted, var(--axylo-default-muted))',
  focus: 'var(--axylo-focus, var(--axylo-default-focus))',
  // The author's background if any; else the backdrop resolveTheme found (set on the chart root).
  background: 'var(--axylo-background, var(--axylo-backdrop, var(--axylo-default-background)))',
  // The chart inherits the page's text color unless the author sets --axylo-text (spec DX6).
  text: 'var(--axylo-text, currentColor)',
};

/** The palette slot for a series index, as a CSS expression. */
export const seriesBinding = (index: number): string => {
  const n = (index % SERIES_COUNT) + 1;
  return `var(--axylo-series-${n}, var(--axylo-default-series-${n}))`;
};

/**
 * Name of the custom property, set on the chart root, that carries series `index`'s color. Marks reference
 * it rather than the color itself, so the color can change (an author's `var(--brand)`, forced colors on or
 * off) with no draw call.
 */
export const seriesProperty = (index: number): string => `--axylo-series-color-${index + 1}`;

/**
 * An author color as the value of its series property. `--axylo-forced-series` is unset except under forced
 * colors, where the stylesheet sets it to a system color: the author's color then steps aside, and comes back
 * when forced colors ends, with no draw call (review finding 6).
 */
const authorBinding = (expression: string): string => `var(--axylo-forced-series, ${expression})`;

/** Series property counts already written per root, so stale ones are removed when series go away. */
const written = new WeakMap<Element, number>();

/**
 * Resolves the theme for `element` (the chart root, normally `.axylo`), sets `data-axylo-scheme` on it,
 * and writes one `--axylo-series-color-N` property per series on it. `colors` maps series keys to the
 * author's CSS colors; they stay live (`var(--brand-1)` follows `--brand-1`), but a value the browser does
 * not accept as a color is replaced by the palette slot and listed in `invalidColors`.
 */
export function resolveTheme(
  element: HTMLElement,
  seriesKeys: readonly string[],
  colors?: Readonly<Record<string, string>> | null,
): ThemeResolution {
  const doc = element.ownerDocument;
  const win = doc.defaultView;
  const connected = win !== null && element.isConnected;
  const authored = colors && seriesKeys.map(key => Object.hasOwn(colors, key) ? colors[key]?.trim() || null : null);
  const valid = connected && authored?.some(Boolean) ? validColors(element, authored) : null;
  const invalidColors: string[] = [];
  const series = seriesKeys.map((key, i) => {
    const property = seriesProperty(i);
    const own = authored?.[i];
    let value = seriesBinding(i);
    if (own) {
      if (!valid || valid[i]) value = authorBinding(own);
      else invalidColors.push(key);
    }
    setProperty(element, property, value);
    return `var(${property})`;
  });
  const before = written.get(element) ?? 0;
  for (let i = series.length; i < before; i++) element.style.removeProperty(seriesProperty(i));
  written.set(element, series.length);
  const bindings: PaintBindings = { tokens: TOKEN_BINDINGS, series };
  if (!connected) return unresolved(element, bindings, seriesKeys.length);

  const style = win.getComputedStyle(element);
  const backdrop = findBackdrop(element, win, style);
  setProperty(element, '--axylo-backdrop', rgbText(backdrop.color));

  const expression = 'var(--axylo-background)';
  const value = style.getPropertyValue('--axylo-background').trim();
  const override = value !== '' && (/^currentcolor$/i.test(value) || validColors(element, [expression])[0]);
  const overrideColor = override ? parseColor(probeColors(element, [expression])[0]!) : null;
  const overridden = overrideColor !== null && overrideColor.a > 0;
  const background = overridden ? composite(overrideColor, backdrop.color) : backdrop.color;
  const scheme = decideScheme(style, overridden ? background : null, element);
  // Where the page sets the chart's color-scheme, the stylesheet's defaults follow the browser's used scheme
  // by themselves (light-dark()), media changes included, in the frame they happen: no attribute freezes one.
  // Otherwise (color-scheme normal, or the author's --axylo-background decides) the scheme found here is it.
  const follows = !overridden && style.colorScheme.trim() !== '' && style.colorScheme.trim() !== 'normal';
  const attribute = 'data-axylo-scheme';
  if (follows) element.removeAttribute(attribute);
  else if (element.getAttribute(attribute) !== scheme) element.setAttribute(attribute, scheme);

  const expressions = [...TOKENS.map(t => TOKEN_BINDINGS[t]), ...bindings.series];
  const computed = probeColors(element, expressions);
  const tokens = {} as Record<PaintToken, string>;
  TOKENS.forEach((t, i) => { tokens[t] = computed[i]!; });
  // What is behind the marks, opaque: the author's background over the backdrop, or the backdrop.
  tokens.background = rgbText(background);
  const paints: PaintBindings = { tokens, series: computed.slice(TOKENS.length) };

  return {
    bindings,
    theme: { scheme, paints, forcedColors: win.matchMedia('(forced-colors: active)').matches,
      moreContrast: win.matchMedia('(prefers-contrast: more)').matches },
    resolved: true,
    backdropKnown: backdrop.known || (overrideColor !== null && overrideColor.a >= 1),
    invalidColors,
  };
}

function unresolved(element: HTMLElement, bindings: PaintBindings, count: number): ThemeResolution {
  const hex = (h: string): string => rgbText(parseColor(h)!);
  const tokens = {} as Record<PaintToken, string>;
  tokens.background = hex(LIGHT.background);
  for (const token of TOKENS) tokens[token] = token === 'text' ? 'rgb(0, 0, 0)' : hex(LIGHT[token]);
  const series = Array.from({ length: count }, (_, i) => hex(LIGHT.series[i % SERIES_COUNT]!));
  const scheme = element.getAttribute('data-axylo-scheme') === 'dark' ? 'dark' : 'light';
  return {
    bindings,
    theme: { scheme, forcedColors: false, moreContrast: false, paints: { tokens, series } },
    resolved: false,
    backdropKnown: false,
    invalidColors: [],
  };
}

/**
 * Spec L4: `--axylo-background` decides if present (composited over the backdrop); else a computed
 * `color-scheme` naming exactly one of light and dark; else, for a list such as "light dark", the scheme
 * the browser actually uses there (the luminance of the `Canvas` system color in the chart's context);
 * else (unset or normal) the inherited text color: light text means a dark scheme.
 */
function decideScheme(style: CSSStyleDeclaration, background: Rgba | null, element: HTMLElement): 'light' | 'dark' {
  if (background !== null) return isLightColor(background) ? 'light' : 'dark';
  const words = style.colorScheme.split(/\s+/);
  const light = words.includes('light');
  const dark = words.includes('dark');
  if (light !== dark) return light ? 'light' : 'dark';
  if (light && dark) {
    const used = parseColor(probeColors(element, ['Canvas'])[0]!);
    if (used !== null) return isLightColor(used) ? 'light' : 'dark';
  }
  const text = concreteColor(style.color, element.ownerDocument);
  return text !== null && isLightColor(text) ? 'dark' : 'light';
}

interface Backdrop { readonly color: Rgba; readonly known: boolean }

/**
 * The opaque color behind the chart: computed background colors from the chart up, composited until one
 * is opaque, over the document's canvas color. A background image on the way up makes it unknown.
 */
function findBackdrop(element: HTMLElement, win: Window, style: CSSStyleDeclaration): Backdrop {
  const layers: Rgba[] = [];
  let known = true;
  let color: Rgba | undefined;
  for (let node: Element | null = element; node !== null; node = composedParent(node)) {
    const cs = node === element ? style : win.getComputedStyle(node);
    if (cs.backgroundImage !== 'none' && cs.backgroundImage !== '') { known = false; }
    const c = concreteColor(cs.backgroundColor, element.ownerDocument);
    if (c !== null && c.a > 0) {
      if (c.a >= 1) { color = c; break; }
      layers.push(c);
    }
  }
  if (!color) {
    const white = { r: 1, g: 1, b: 1, a: 1 };
    // The page canvas: the `Canvas` system color under the root's color-scheme.
    const [canvas] = probeColors(element.ownerDocument.documentElement, ['Canvas']);
    color = parseColor(canvas!) ?? white;
    if (color.a < 1) color = composite(color, white);
  }
  while (layers.length > 0) color = composite(layers.pop()!, color);
  return { color, known };
}

const rgbText = (c: Rgba): string => `rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)})`;

function setProperty(element: HTMLElement, name: string, value: string): void {
  if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
}

// Children retain their inline declarations, but inherit variables from the chart being measured.
interface ProbeSet {
  box: HTMLElement;
  colors: HTMLElement[];
  pairs: HTMLElement[];
}
const probes = new WeakMap<Document, ProbeSet>();

function probeColors(element: Element, expressions: readonly string[], validating = false): string[] {
  const doc = element.ownerDocument;
  let cached = probes.get(doc);
  if (!cached) {
    const box = doc.createElement('div');
    box.style.display = 'none';
    probes.set(doc, cached = { box, colors: [], pairs: [] });
  }
  const { box } = cached;
  const pool = validating ? cached.pairs : cached.colors;
  box.style.forcedColorAdjust = validating ? '' : 'none';
  const spans = expressions.map((expression, i) => {
    let span = pool[i];
    if (!span) {
      span = pool[i] = doc.createElement('span');
      span.style.forcedColorAdjust = 'none';
      if (validating) {
        const parent = doc.createElement('div');
        parent.style.color = i % 2 ? 'rgb(4, 5, 6)' : 'rgb(1, 2, 3)';
        parent.style.forcedColorAdjust = 'none';
        parent.appendChild(span);
      }
    }
    // CSSOM ignores an invalid assignment, so validation must clear the previous color.
    if (validating) span.style.color = '';
    span.style.color = expression;
    box.appendChild(validating ? span.parentElement! : span);
    return span;
  });
  element.appendChild(box);
  try {
    return spans.map(span => {
      const color = doc.defaultView!.getComputedStyle(span).color;
      return validating ? color : normalizeColor(color, doc);
    });
  } finally {
    box.remove();
    box.replaceChildren();
  }
}

function validColors(element: HTMLElement, expressions: readonly (string | null)[]): boolean[] {
  const values = probeColors(element, expressions.flatMap(e => e === null ? [] : [e, e]), true);
  let index = 0;
  return expressions.map(e => {
    if (e === null) return true;
    const valid = values[index] === values[index + 1];
    index += 2;
    return valid || /^currentcolor$/i.test(e);
  });
}

/**
 * Computed colors are rgb()/rgba() for most inputs but keep other spaces (oklch(), lab()) as written.
 * Those are converted by painting one pixel, so canvas and the contrast check always get sRGB. An empty
 * or unknown value is returned as is rather than as the canvas's initial black.
 */
function normalizeColor(value: string, doc: Document): string {
  return value && !parseColor(value) ? canvasColor(value, doc) : value;
}

function concreteColor(value: string, doc: Document): Rgba | null {
  return parseColor(value) ?? (value ? parseColor(canvasColor(value, doc)) : null);
}

function canvasColor(value: string, doc: Document): string {
  const canvas = doc.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx === null) return value;
  // A sentinel first: if the browser rejects `value`, fillStyle keeps the sentinel and we know.
  ctx.fillStyle = '#010203';
  ctx.fillStyle = value;
  if (ctx.fillStyle === '#010203') return value;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgba(${r}, ${g}, ${b}, ${Math.round(((a ?? 255) / 255) * 1000) / 1000})`;
}
