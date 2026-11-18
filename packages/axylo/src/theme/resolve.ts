/**
 * Theme resolution (spec L4, DX6, A5): decides light or dark for a chart root, and turns paints into both
 * CSS expressions (for the SVG renderer, which stays live) and concrete colors (for canvas and contrast
 * checks). Concrete colors come from the browser itself through probe elements, never from parsing CSS.
 *
 * The chart paints no background unless the author sets `--axylo-background`: marks sit on whatever is
 * behind the chart. So the background used for checks is the effective opaque backdrop, found by walking up
 * from the chart and compositing computed background colors; with `--axylo-background` it is that color
 * (composited over the backdrop), which the renderers then also paint. What is measured is what is drawn.
 */
import type { PaintBindings, PaintToken, ResolvedTheme } from '../core/contracts';
import { composite, isLightColor, parseColor, type Rgba } from './color';
import { LIGHT, SERIES_COUNT } from './palette';

/** A resolved theme with what the renderers need beyond the contract. */
export interface ResolvedThemeDetails extends ResolvedTheme {
  /**
   * Concrete color to paint behind the whole scene, or null to paint nothing. Set when the author gives
   * `--axylo-background`; the canvas renderer fills with it, the SVG renderer paints the live CSS value.
   */
  readonly plotBackground?: string | null;
}

export interface ThemeResolution {
  readonly bindings: PaintBindings;
  readonly theme: ResolvedThemeDetails;
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

const TOKENS: readonly PaintToken[] = ['axis', 'grid', 'reference', 'muted', 'focus', 'background', 'text'];

/**
 * CSS expressions for the token paints. Each public name (which an author may set anywhere, including
 * `:root`) falls back to a private default from the stylesheet.
 */
export const TOKEN_BINDINGS: Readonly<Record<PaintToken, string>> = Object.freeze({
  axis: 'var(--axylo-axis, var(--axylo-default-axis))',
  grid: 'var(--axylo-grid, var(--axylo-default-grid))',
  reference: 'var(--axylo-reference, var(--axylo-default-reference))',
  muted: 'var(--axylo-muted, var(--axylo-default-muted))',
  focus: 'var(--axylo-focus, var(--axylo-default-focus))',
  // The author's background if any; else the backdrop resolveTheme found (set on the chart root).
  background: 'var(--axylo-background, var(--axylo-backdrop, var(--axylo-default-background)))',
  // The chart inherits the page's text color unless the author sets --axylo-text (spec DX6).
  text: 'var(--axylo-text, currentColor)',
});

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
  const bindings: PaintBindings = { tokens: TOKEN_BINDINGS, series: seriesKeys.map((_, i) => `var(${seriesProperty(i)})`) };
  const authored = seriesKeys.map(key => {
    const own = colors != null && Object.prototype.hasOwnProperty.call(colors, key) ? colors[key] : undefined;
    return own !== undefined && own.trim() !== '' ? own.trim() : null;
  });

  if (win === null || !element.isConnected) {
    writeSeries(element, authored.map((own, i) => (own === null ? seriesBinding(i) : authorBinding(own))));
    return unresolved(element, bindings, seriesKeys.length);
  }

  const forcedColors = win.matchMedia('(forced-colors: active)').matches;
  const moreContrast = win.matchMedia('(prefers-contrast: more)').matches;

  const valid = validColors(element, authored);
  const invalidColors: string[] = [];
  writeSeries(element, authored.map((own, i) => {
    if (own === null) return seriesBinding(i);
    if (valid[i]) return authorBinding(own);
    invalidColors.push(seriesKeys[i]!);
    return seriesBinding(i);
  }));

  const backdrop = findBackdrop(element, win);
  setProperty(element, '--axylo-backdrop', rgbText(backdrop.color));

  const style = win.getComputedStyle(element);
  const override = style.getPropertyValue('--axylo-background').trim() !== '';
  const [overrideText, canvasText] = probeColors(element, ['var(--axylo-background)', 'Canvas']);
  const overrideColor = override ? parseColor(overrideText!) : null;
  const background = overrideColor !== null && overrideColor.a > 0 ? composite(overrideColor, backdrop.color) : backdrop.color;

  const overridden = overrideColor !== null && overrideColor.a > 0;
  const scheme = decideScheme(style, overridden ? background : null, canvasText!, doc);
  // Where the page sets the chart's color-scheme, the stylesheet's defaults follow the browser's used scheme
  // by themselves (light-dark()), media changes included, in the frame they happen: no attribute freezes one.
  // Otherwise (color-scheme normal, or the author's --axylo-background decides) the scheme found here is it.
  const follows = !overridden && style.colorScheme.trim() !== '' && style.colorScheme.trim() !== 'normal';
  if (follows) {
    if (element.hasAttribute('data-axylo-scheme')) element.removeAttribute('data-axylo-scheme');
  } else if (element.getAttribute('data-axylo-scheme') !== scheme) element.setAttribute('data-axylo-scheme', scheme);

  const expressions = [...TOKENS.map(t => TOKEN_BINDINGS[t]), ...bindings.series];
  const computed = probeColors(element, expressions);
  const tokens = {} as Record<PaintToken, string>;
  TOKENS.forEach((t, i) => { tokens[t] = computed[i]!; });
  // What is behind the marks, opaque: the author's background over the backdrop, or the backdrop.
  tokens.background = rgbText(background);
  const paints: PaintBindings = { tokens, series: computed.slice(TOKENS.length) };

  return {
    bindings,
    theme: { scheme, forcedColors, moreContrast, paints, plotBackground: override ? overrideText! : null },
    resolved: true,
    backdropKnown: backdrop.known,
    invalidColors,
  };
}

function unresolved(element: HTMLElement, bindings: PaintBindings, count: number): ThemeResolution {
  const hex = (h: string): string => rgbText(parseColor(h)!);
  const tokens: Record<PaintToken, string> = {
    axis: hex(LIGHT.axis), grid: hex(LIGHT.grid), reference: hex(LIGHT.reference), muted: hex(LIGHT.muted),
    focus: hex(LIGHT.focus), background: hex(LIGHT.background), text: 'rgb(0, 0, 0)',
  };
  const series = Array.from({ length: count }, (_, i) => hex(LIGHT.series[i % SERIES_COUNT]!));
  const scheme = element.getAttribute('data-axylo-scheme') === 'dark' ? 'dark' : 'light';
  return {
    bindings,
    theme: { scheme, forcedColors: false, moreContrast: false, paints: { tokens, series }, plotBackground: null },
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
function decideScheme(style: CSSStyleDeclaration, background: Rgba | null, canvas: string, doc: Document): 'light' | 'dark' {
  if (background !== null) return isLightColor(background) ? 'light' : 'dark';
  const words = style.colorScheme.split(/\s+/).filter(w => w === 'light' || w === 'dark');
  const light = words.includes('light');
  const dark = words.includes('dark');
  if (light !== dark) return light ? 'light' : 'dark';
  if (light && dark) {
    const used = parseColor(normalizeColor(canvas, doc));
    if (used !== null) return isLightColor(used) ? 'light' : 'dark';
  }
  const text = parseColor(normalizeColor(style.color, doc));
  return text !== null && isLightColor(text) ? 'dark' : 'light';
}

interface Backdrop { readonly color: Rgba; readonly known: boolean }

/**
 * The opaque color behind the chart: computed background colors from the chart up, composited until one
 * is opaque, over the document's canvas color. A background image on the way up makes it unknown.
 */
function findBackdrop(element: HTMLElement, win: Window): Backdrop {
  const layers: Rgba[] = [];
  let known = true;
  let opaque = false;
  for (let node: Element | null = element; node !== null; node = parentOf(node)) {
    const cs = win.getComputedStyle(node);
    if (cs.backgroundImage !== 'none' && cs.backgroundImage !== '') { known = false; }
    const c = parseColor(normalizeColor(cs.backgroundColor, element.ownerDocument));
    if (c !== null && c.a > 0) {
      layers.push(c);
      if (c.a >= 1) { opaque = true; break; }
    }
  }
  let color: Rgba;
  if (opaque) color = layers.pop()!;
  else {
    // The page canvas: the `Canvas` system color under the root's color-scheme.
    const [canvas] = probeColors(element.ownerDocument.documentElement, ['Canvas']);
    color = parseColor(canvas!) ?? { r: 1, g: 1, b: 1, a: 1 };
    if (color.a < 1) color = composite(color, { r: 1, g: 1, b: 1, a: 1 });
  }
  while (layers.length > 0) color = composite(layers.pop()!, color);
  return { color, known };
}

/** Parent element, crossing out of a shadow root to its host. */
function parentOf(node: Element): Element | null {
  if (node.parentElement !== null) return node.parentElement;
  const root = node.parentNode;
  return root !== null && 'host' in root ? (root as ShadowRoot).host : null;
}

const rgbText = (c: Rgba): string => `rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)})`;

function setProperty(element: HTMLElement, name: string, value: string): void {
  if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
}

function writeSeries(element: HTMLElement, values: readonly string[]): void {
  values.forEach((v, i) => setProperty(element, seriesProperty(i), v));
  const before = written.get(element) ?? 0;
  for (let i = values.length; i < before; i++) element.style.removeProperty(seriesProperty(i));
  written.set(element, values.length);
}

/**
 * Which author expressions the browser accepts as colors. Each is set as `color` on two probes whose parents
 * have different colors: an expression that is not a color is dropped at computed-value time, so `color`
 * inherits and the two probes disagree. Works for `var()` references too, which CSS.supports cannot judge.
 */
function validColors(element: HTMLElement, expressions: readonly (string | null)[]): boolean[] {
  if (!expressions.some(e => e !== null)) return expressions.map(() => true);
  const doc = element.ownerDocument;
  const win = doc.defaultView!;
  const box = doc.createElement('div');
  box.style.setProperty('display', 'none');
  const pairs = expressions.map(expression => {
    if (expression === null) return null;
    return (['rgb(1, 2, 3)', 'rgb(4, 5, 6)'] as const).map(parentColor => {
      const parent = doc.createElement('div');
      parent.style.setProperty('color', parentColor);
      parent.style.setProperty('forced-color-adjust', 'none');
      const probe = doc.createElement('span');
      probe.style.setProperty('forced-color-adjust', 'none');
      probe.style.setProperty('color', expression);
      parent.appendChild(probe);
      box.appendChild(parent);
      return probe;
    });
  });
  element.appendChild(box);
  const result = pairs.map((pair, i) => {
    if (pair === null) return true;
    if (/^currentcolor$/i.test(expressions[i]!)) return true;
    return win.getComputedStyle(pair[0]!).color === win.getComputedStyle(pair[1]!).color;
  });
  box.remove();
  return result;
}

/**
 * Lets the browser resolve CSS color expressions in the element's context: one hidden child per expression,
 * all written before any is read so the style is computed once.
 */
function probeColors(element: Element, expressions: readonly string[]): string[] {
  const doc = element.ownerDocument;
  const win = doc.defaultView!;
  const box = doc.createElement('div');
  box.style.setProperty('display', 'none');
  box.style.setProperty('forced-color-adjust', 'none');
  const probes = expressions.map(expression => {
    const probe = doc.createElement('span');
    // Forced colors may replace an author `color` with CanvasText; the probe must read what was asked.
    probe.style.setProperty('forced-color-adjust', 'none');
    probe.style.setProperty('color', expression);
    box.appendChild(probe);
    return probe;
  });
  element.appendChild(box);
  const values = probes.map(p => win.getComputedStyle(p).color);
  box.remove();
  return values.map(v => normalizeColor(v, doc));
}

/**
 * Computed colors are rgb()/rgba() for most inputs but keep other spaces (oklch(), lab()) as written.
 * Those are converted by painting one pixel, so canvas and the contrast check always get sRGB. An empty
 * or unknown value is returned as is rather than as the canvas's initial black.
 */
function normalizeColor(value: string, doc: Document): string {
  if (value === '' || parseColor(value) !== null) return value;
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
