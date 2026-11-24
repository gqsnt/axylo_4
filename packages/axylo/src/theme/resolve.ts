/**
 * Theme resolution (spec L4, DX6, A5): decides light or dark for a chart root, and turns paints into both
 * CSS expressions for the live SVG renderer and concrete colors for contrast checks. Standard paints come
 * from the verified palette. The browser resolves custom paints through probe elements.
 *
 * The chart paints no background unless the author sets `--axylo-background`: marks sit on whatever is
 * behind the chart. So the background used for checks is the effective opaque backdrop, found by walking up
 * from the chart and compositing computed background colors; with `--axylo-background` it is that color
 * (composited over the backdrop), which SVG then also paints. What is measured is what is drawn.
 */
import type { PaintBindings, PaintToken, ResolvedTheme } from '../core/contracts';
import { composedParent } from '../core/environment';
import { composite, isLightColor, parseColor, type Rgba } from './color';
import { DARK, LIGHT, SERIES_COUNT } from './palette';

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

const TOKENS = ['axis', 'grid', 'reference', 'muted', 'focus', 'text'] as const;

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

const paletteCache: Record<string, string> = {};
const paletteRgb = (hex: string): string => paletteCache[hex] ??= rgbText(parseColor(hex)!);

/** Cached Canvas system color per document when forced-colors is off (keyed by colorScheme + prefersDark). */
const canvasCache = new WeakMap<Document, Map<string, Rgba | null>>();

export interface ThemeBatch {
  readonly forcedColors: boolean;
  readonly moreContrast: boolean;
  readonly prefersDark: boolean;
  readonly backdrops: Map<Element, Backdrop>;
  readonly canvas: Map<string, Rgba | null>;
}

export function createThemeBatch(win: Window): ThemeBatch {
  return {
    forcedColors: win.matchMedia('(forced-colors: active)').matches,
    moreContrast: win.matchMedia('(prefers-contrast: more)').matches,
    prefersDark: win.matchMedia('(prefers-color-scheme: dark)').matches,
    backdrops: new Map(),
    canvas: new Map(),
  };
}

function readCachedCanvas(
  doc: Document,
  win: Window,
  colorScheme: string,
  forcedColors: boolean,
  batch?: ThemeBatch | null,
): { readonly hit: true; readonly value: Rgba | null } | { readonly hit: false } {
  if (batch && batch.canvas.has(colorScheme)) {
    return { hit: true, value: batch.canvas.get(colorScheme)! };
  }
  if (!forcedColors) {
    const prefersDark = batch ? batch.prefersDark : win.matchMedia('(prefers-color-scheme: dark)').matches;
    const cacheKey = `${colorScheme}|${prefersDark ? '1' : '0'}`;
    const docMap = canvasCache.get(doc);
    if (docMap && docMap.has(cacheKey)) {
      const value = docMap.get(cacheKey)!;
      batch?.canvas.set(colorScheme, value);
      return { hit: true, value };
    }
  }
  return { hit: false };
}

function resolveSystemCanvas(
  element: Element,
  win: Window,
  colorScheme: string,
  forcedColors: boolean,
  batch?: ThemeBatch | null,
): Rgba | null {
  const doc = element.ownerDocument;
  const cached = readCachedCanvas(doc, win, colorScheme, forcedColors, batch);
  if (cached.hit) return cached.value;
  const value = parseColor(probeColors(element, ['Canvas'])[0]!);
  if (!forcedColors) {
    const prefersDark = batch ? batch.prefersDark : win.matchMedia('(prefers-color-scheme: dark)').matches;
    const cacheKey = `${colorScheme}|${prefersDark ? '1' : '0'}`;
    let docMap = canvasCache.get(doc);
    if (!docMap) canvasCache.set(doc, docMap = new Map());
    else if (docMap.size >= 32) docMap.clear();
    docMap.set(cacheKey, value);
  }
  batch?.canvas.set(colorScheme, value);
  return value;
}

/** Series property counts already written per root, so stale ones are removed when series go away. */
const written = new WeakMap<Element, number>();

interface Backdrop { readonly color: Rgba; readonly known: boolean }

interface PendingBackdrop {
  readonly nodes: readonly Element[];
  readonly layers: readonly (Rgba | null)[];
  readonly images: readonly boolean[];
  readonly rootColorScheme: string;
}

export interface PreparedTheme {
  readonly element: HTMLElement;
  readonly doc: Document;
  readonly win: Window | null;
  readonly connected: boolean;
  readonly forcedColors: boolean;
  readonly moreContrast: boolean;
  readonly seriesKeys: readonly string[];
  readonly authored: readonly (string | null)[] | null;
  readonly hasAuthored: boolean;
  readonly bindings: PaintBindings;
  readonly series: readonly string[];
  readonly previous: string | null;
  readonly style: CSSStyleDeclaration | undefined;
  readonly batch: ThemeBatch | null;
  readonly hasLight: boolean;
  readonly hasDark: boolean;
  readonly bgOverrideExpr: string;
  initialBgColor: string;
  propValues: { readonly property: string; readonly value: string }[];
  invalidColors: string[];
  backdrop: Backdrop | null;
  backdropPending: PendingBackdrop | null;
  backdropRgb: string | null;
  schemeReady: boolean;
  bgResolved: boolean;
  needsBgResolve: string | null;
  scheme: 'light' | 'dark';
  follows: boolean;
  background: string;
  backdropKnown: boolean;
  standard: boolean;
  tokens?: Record<PaintToken, string>;
}

/**
 * Pure read-only phase of theme resolution: inspects computed style, cached backdrop and scheme without
 * writing inline custom properties, attributes, or probe elements to the DOM. Any work requiring DOM
 * probes (`validColors`, uncached `Canvas`, `--axylo-background`) is deferred to `applyTheme` / `probeTheme`.
 */
export function prepareTheme(
  element: HTMLElement,
  seriesKeys: readonly string[],
  colors?: Readonly<Record<string, string>> | null,
  batch?: ThemeBatch | null,
): PreparedTheme {
  const doc = element.ownerDocument;
  const win = doc.defaultView;
  const connected = win !== null && element.isConnected;
  const forcedColors = connected && (batch ? batch.forcedColors : win.matchMedia('(forced-colors: active)').matches);
  const moreContrast = connected && (batch ? batch.moreContrast : win.matchMedia('(prefers-contrast: more)').matches);
  const authored = colors ? seriesKeys.map(key => Object.hasOwn(colors, key) ? colors[key]?.trim() || null : null) : null;
  const hasAuthored = Boolean(connected && authored?.some(Boolean));
  const invalidColors: string[] = [];
  const propValues: { property: string; value: string }[] = [];
  const series = seriesKeys.map((_, i) => {
    const property = seriesProperty(i);
    const own = authored?.[i];
    // When disconnected, authored colors are kept verbatim without probing; when connected with authored colors,
    // `applyTheme` validates them before writing `propValues`.
    const value = own && !hasAuthored ? authorBinding(own) : seriesBinding(i);
    propValues.push({ property, value });
    return `var(${property})`;
  });
  const bindings: PaintBindings = { tokens: TOKEN_BINDINGS, series };
  const previous = element.getAttribute('data-axylo-scheme');
  let scheme: 'light' | 'dark' = previous === 'dark' ? 'dark' : 'light';
  let backdropKnown = false;
  let background = paletteRgb(LIGHT.background);
  let backdrop: Backdrop | null = null;
  let backdropPending: PendingBackdrop | null = null;
  let backdropRgb: string | null = null;
  let style: CSSStyleDeclaration | undefined;
  let follows = false;
  let standard = !forcedColors && !moreContrast && !hasAuthored;
  let hasLight = false;
  let hasDark = false;
  let bgOverrideExpr = '';
  let initialBgColor = '';
  let schemeReady = !connected;
  if (connected) {
    style = win.getComputedStyle(element);
    initialBgColor = style.backgroundColor;
    const prep = prepareBackdrop(element, win, style, forcedColors, batch);
    if (prep.done) {
      backdrop = prep.backdrop;
      backdropRgb = rgbText(backdrop.color);
    } else {
      backdropPending = prep.pending;
    }
    bgOverrideExpr = style.getPropertyValue('--axylo-background').trim();
    const schemes = style.colorScheme.split(/\s+/);
    hasLight = schemes.includes('light');
    hasDark = schemes.includes('dark');
    // Only decide scheme in Phase 1 when backdrop is ready and `--axylo-background` is currently unset;
    // any probe (`Canvas` cache miss or `--axylo-background`) is deferred to the write/probe phase.
    if (backdrop !== null && bgOverrideExpr === '') {
      let canvasKnown = true;
      let schemeColor: Rgba | null = null;
      if (hasLight && hasDark) {
        const hit = readCachedCanvas(doc, win, style.colorScheme, forcedColors, batch);
        if (hit.hit) schemeColor = hit.value;
        else canvasKnown = false;
      }
      if (canvasKnown) {
        if (schemeColor) scheme = isLightColor(schemeColor) ? 'light' : 'dark';
        else if (hasLight !== hasDark) scheme = hasLight ? 'light' : 'dark';
        else {
          const text = concreteColor(style.color, doc);
          scheme = text && isLightColor(text) ? 'dark' : 'light';
        }
        follows = !!style.colorScheme && style.colorScheme !== 'normal';
        if (follows) standard &&= hasLight !== hasDark || schemeColor !== null;
        background = backdropRgb!;
        backdropKnown = backdrop.known;
        schemeReady = true;
      }
    }
  }
  return {
    element, doc, win, connected, forcedColors, moreContrast, seriesKeys, authored, hasAuthored,
    bindings, series, previous, style, batch: batch ?? null, hasLight, hasDark, bgOverrideExpr, initialBgColor,
    propValues, invalidColors, backdrop, backdropPending, backdropRgb, schemeReady,
    bgResolved: false, needsBgResolve: null, scheme, follows, background, backdropKnown, standard,
  };
}

/**
 * Resolves scheme, `follows`, `background`, and `backdropKnown` after `--axylo-series-color-*` and
 * `--axylo-backdrop` have been written on `p.element`, so `--axylo-background` may reference them.
 */
function resolveSchemeAndBackground(p: PreparedTheme, bgExpr: string): void {
  const { element, doc, win, style, backdrop, hasLight, hasDark } = p;
  let overrideColor: Rgba | null = null;
  if (bgExpr !== '') {
    const expression = ['var(--axylo-background)'];
    if (/^currentcolor$/i.test(bgExpr) || validColors(element, expression)[0]) {
      overrideColor = parseColor(probeColors(element, expression)[0]!);
    }
    p.bgResolved = true;
  }
  const overridden = overrideColor !== null && overrideColor.a > 0;
  const opaque = overridden ? composite(overrideColor!, backdrop!.color) : backdrop!.color;
  const schemeColor = overridden ? opaque
    : hasLight && hasDark ? resolveSystemCanvas(element, win!, style!.colorScheme, p.forcedColors, p.batch) : null;
  if (schemeColor) p.scheme = isLightColor(schemeColor) ? 'light' : 'dark';
  else if (hasLight !== hasDark) p.scheme = hasLight ? 'light' : 'dark';
  else {
    const text = concreteColor(style!.color, doc);
    p.scheme = text && isLightColor(text) ? 'dark' : 'light';
  }
  // Where the page sets the chart's color-scheme, the stylesheet's defaults follow the browser's used scheme
  // by themselves (light-dark()), media changes included, in the frame they happen: no attribute freezes one.
  // Otherwise (color-scheme normal, or the author's --axylo-background decides) the scheme found here is it.
  p.follows = !overridden && !!style!.colorScheme && style!.colorScheme !== 'normal';
  p.standard = !p.forcedColors && !p.moreContrast && !p.hasAuthored;
  if (p.follows) p.standard &&= hasLight !== hasDark || schemeColor !== null;
  p.background = rgbText(opaque);
  p.backdropKnown = backdrop!.known || (overrideColor?.a ?? 0) >= 1;
  p.schemeReady = true;
}

/**
 * Write & coordinated-probe phase of theme resolution: sets `--axylo-series-color-*`, `--axylo-backdrop`,
 * and `data-axylo-scheme` on `element`. When `--axylo-background` is set, series and backdrop properties
 * are written before `--axylo-background` is probed so references to them resolve cleanly.
 */
export function applyTheme(p: PreparedTheme): void {
  const { element, series } = p;
  if (p.connected && p.backdropPending !== null) {
    // Resolve uncached page Canvas before writing to `element` so sibling tiles reuse the cached backdrop.
    p.backdrop = finishBackdrop(element, p.win!, p.forcedColors, p.backdropPending, p.batch);
    p.backdropRgb = rgbText(p.backdrop.color);
    p.backdropPending = null;
  }
  if (p.hasAuthored) {
    const authored = p.authored!;
    const valid = validColors(element, authored);
    const invalidColors: string[] = [];
    const propValues: { property: string; value: string }[] = [];
    for (let i = 0; i < p.seriesKeys.length; i++) {
      const property = seriesProperty(i);
      const own = authored[i];
      let value = seriesBinding(i);
      if (own) {
        if (valid[i]) value = authorBinding(own);
        else invalidColors.push(p.seriesKeys[i]!);
      }
      propValues.push({ property, value });
    }
    p.propValues = propValues;
    p.invalidColors = invalidColors;
    p.standard = false;
  }
  for (let i = 0; i < p.propValues.length; i++) {
    const entry = p.propValues[i]!;
    setProperty(element, entry.property, entry.value);
  }
  for (let i = written.get(element) ?? 0; i > series.length; i--) element.style.removeProperty(seriesProperty(i - 1));
  written.set(element, series.length);
  if (p.connected) {
    setProperty(element, '--axylo-backdrop', p.backdropRgb!);
    if (!p.schemeReady) {
      resolveSchemeAndBackground(p, p.bgOverrideExpr);
    }
    if (p.follows) element.removeAttribute('data-axylo-scheme');
    else if (p.previous !== p.scheme) element.setAttribute('data-axylo-scheme', p.scheme);
  }
}

function resolveLateBackground(p: PreparedTheme, liveBg: string): void {
  if (p.connected && p.style && p.win && p.style.backgroundColor !== p.initialBgColor) {
    p.initialBgColor = p.style.backgroundColor;
    const prep = prepareBackdrop(p.element, p.win, p.style, p.forcedColors, p.batch);
    p.backdrop = prep.done ? prep.backdrop : finishBackdrop(p.element, p.win, p.forcedColors, prep.pending, p.batch);
    p.backdropRgb = rgbText(p.backdrop.color);
    setProperty(p.element, '--axylo-backdrop', p.backdropRgb);
  }
  resolveSchemeAndBackground(p, liveBg);
  if (p.follows) p.element.removeAttribute('data-axylo-scheme');
  else if (p.element.getAttribute('data-axylo-scheme') !== p.scheme) p.element.setAttribute('data-axylo-scheme', p.scheme);
}

/**
 * Post-write verification phase: reads the live declaration after `applyTheme` so standalone stylesheet
 * overrides (and `--axylo-background` expressions referencing `--axylo-series-color-*` or `--axylo-backdrop`)
 * are detected. When `deferProbe` is true and a probe is needed, returns `null` so the caller can finish
 * layout reads first and then call `probeTheme(p)`.
 */
export function finalizeTheme(p: PreparedTheme, deferProbe = false): ThemeResolution | null {
  const { connected, style, doc, series, bindings, forcedColors, moreContrast } = p;
  if (connected && style) {
    // A `background-color` or `--axylo-background` referencing `--axylo-series-color-*` or `--axylo-backdrop`
    // may change or become non-empty after `applyTheme` writes them.
    const bgChanged = style.backgroundColor !== p.initialBgColor;
    const liveBg = !p.bgResolved || bgChanged ? style.getPropertyValue('--axylo-background').trim() : '';
    if ((!p.bgResolved && liveBg !== '') || bgChanged) {
      if (deferProbe) {
        p.needsBgResolve = liveBg;
        return null;
      }
      resolveLateBackground(p, liveBg);
      p.bgResolved = true;
    }
  }
  const { scheme, follows, backdropKnown, invalidColors } = p;
  let standard = p.standard;
  // Read the live declaration after updating the attribute. Standalone stylesheets may replace any slot.
  const read = (name: string) => style?.getPropertyValue(name);
  standard &&= !read('--axylo-text');
  function paint(name: string, light: string, dark: string, property?: string): string {
    const hex = connected && scheme === 'dark' ? dark : light;
    if (standard && style) {
      const expected = follows ? `light-dark(${light}, ${dark})` : hex;
      standard = !read('--axylo-' + name) && read('--axylo-default-' + name)?.trim() === expected
        && (!property || read(property)?.trim() === expected);
    }
    return paletteRgb(hex);
  }
  const tokens = { background: p.background } as Record<PaintToken, string>;
  for (const name of TOKENS) {
    if (name !== 'text') tokens[name] = paint(name, LIGHT[name], DARK[name]);
  }
  const seriesColors = series.map((_, i) => {
    const slot = i % SERIES_COUNT;
    return paint(`series-${slot + 1}`, LIGHT.series[slot]!, DARK.series[slot]!, seriesProperty(i));
  });
  if (standard) {
    tokens.text = style ? normalizeColor(style.color, doc) : 'rgb(0, 0, 0)';
    return { bindings, resolved: connected, backdropKnown, invalidColors, theme: { scheme, forcedColors, moreContrast, paints: { tokens, series: seriesColors } } };
  }
  p.tokens = tokens;
  if (deferProbe) return null;
  return probeTheme(p);
}

/** Resolves custom/non-standard paints via probe elements after `finalizeTheme(p, true)` returned `null`. */
export function probeTheme(p: PreparedTheme): ThemeResolution {
  if (p.needsBgResolve !== null) {
    const liveBg = p.needsBgResolve;
    p.needsBgResolve = null;
    resolveLateBackground(p, liveBg);
    p.bgResolved = true;
    return finalizeTheme(p, false)!;
  }
  const tokens = p.tokens ?? ({ background: p.background } as Record<PaintToken, string>);
  const seriesColors = probeColors(p.element, [...TOKENS.map(t => TOKEN_BINDINGS[t]), ...p.series]);
  const values = seriesColors.splice(0, TOKENS.length);
  TOKENS.forEach((name, i) => { tokens[name] = values[i]!; });
  const paints = { tokens, series: seriesColors };
  return {
    bindings: p.bindings, resolved: p.connected, backdropKnown: p.backdropKnown, invalidColors: p.invalidColors,
    theme: { scheme: p.scheme, forcedColors: p.forcedColors, moreContrast: p.moreContrast, paints },
  };
}

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
  const prepared = prepareTheme(element, seriesKeys, colors);
  applyTheme(prepared);
  return finalizeTheme(prepared, false)!;
}

/**
 * Read-only backdrop walk: collects computed background colors from the chart up until an opaque ancestor
 * or cached backdrop is found. If the walk reaches the document root and `Canvas` is not cached, returns
 * the collected layers so `finishBackdrop` can probe `Canvas` during the write phase.
 */
function prepareBackdrop(
  element: HTMLElement,
  win: Window,
  style: CSSStyleDeclaration,
  forcedColors: boolean,
  batch?: ThemeBatch | null,
): { readonly done: true; readonly backdrop: Backdrop } | { readonly done: false; readonly pending: PendingBackdrop } {
  const doc = element.ownerDocument;
  const cachedBackdrops = batch?.backdrops;
  const nodes: Element[] = [];
  const layers: (Rgba | null)[] = [];
  const images: boolean[] = [];
  let baseColor: Rgba | undefined;
  let baseKnown = true;
  let rootColorScheme = '';
  for (let node: Element | null = element; node !== null; node = composedParent(node)) {
    if (node !== element && cachedBackdrops) {
      const hit = cachedBackdrops.get(node);
      if (hit !== undefined) {
        baseColor = hit.color;
        baseKnown = hit.known;
        break;
      }
    }
    const cs = node === element ? style : win.getComputedStyle(node);
    if (node === doc.documentElement) rootColorScheme = cs.colorScheme;
    const hasImage = !!(cs.backgroundImage && cs.backgroundImage !== 'none');
    const c = concreteColor(cs.backgroundColor, doc);
    if (c && c.a >= 1) {
      baseColor = c;
      baseKnown = !hasImage;
      if (cachedBackdrops && node !== element) cachedBackdrops.set(node, { color: baseColor, known: baseKnown });
      break;
    }
    nodes.push(node);
    layers.push(c && c.a > 0 ? c : null);
    images.push(hasImage);
  }
  if (!baseColor) {
    const white = { r: 1, g: 1, b: 1, a: 1 };
    if (!rootColorScheme) rootColorScheme = win.getComputedStyle(doc.documentElement).colorScheme;
    const hit = readCachedCanvas(doc, win, rootColorScheme, forcedColors, batch);
    if (!hit.hit) {
      return { done: false, pending: { nodes, layers, images, rootColorScheme } };
    }
    baseColor = hit.value ?? white;
    if (baseColor.a < 1) baseColor = composite(baseColor, white);
  }
  return { done: true, backdrop: compositeBackdrop(element, nodes, layers, images, baseColor, baseKnown, cachedBackdrops) };
}

function finishBackdrop(
  element: HTMLElement,
  win: Window,
  forcedColors: boolean,
  pending: PendingBackdrop,
  batch?: ThemeBatch | null,
): Backdrop {
  const doc = element.ownerDocument;
  const cachedBackdrops = batch?.backdrops;
  const { nodes, layers, images, rootColorScheme } = pending;
  let baseColor: Rgba | undefined;
  let baseKnown = true;
  let start = nodes.length - 1;
  if (cachedBackdrops) {
    for (let i = 1; i < nodes.length; i++) {
      const hit = cachedBackdrops.get(nodes[i]!);
      if (hit !== undefined) {
        baseColor = hit.color;
        baseKnown = hit.known;
        start = i - 1;
        break;
      }
    }
  }
  if (!baseColor) {
    const white = { r: 1, g: 1, b: 1, a: 1 };
    // The page canvas: the `Canvas` system color under the root's color-scheme.
    baseColor = resolveSystemCanvas(doc.documentElement, win, rootColorScheme, forcedColors, batch) ?? white;
    if (baseColor.a < 1) baseColor = composite(baseColor, white);
  }
  return compositeBackdrop(element, nodes, layers, images, baseColor, baseKnown, cachedBackdrops, start);
}

function compositeBackdrop(
  element: HTMLElement,
  nodes: readonly Element[],
  layers: readonly (Rgba | null)[],
  images: readonly boolean[],
  baseColor: Rgba,
  baseKnown: boolean,
  cachedBackdrops?: Map<Element, Backdrop>,
  start = nodes.length - 1,
): Backdrop {
  let accColor = baseColor;
  let accKnown = baseKnown;
  for (let i = start; i >= 0; i--) {
    if (images[i]) accKnown = false;
    const layer = layers[i]!;
    if (layer !== null) accColor = composite(layer, accColor);
    if (cachedBackdrops && nodes[i] !== element) cachedBackdrops.set(nodes[i]!, { color: accColor, known: accKnown });
  }
  return { color: accColor, known: accKnown };
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
        parent.style.color = i % 2 ? '#040506' : '#010203';
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
  return expressions.map(e => e === null || values[index++] === values[index++] || /^currentcolor$/i.test(e));
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
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx === null) return value;
  // A sentinel first: if the browser rejects `value`, fillStyle keeps the sentinel and we know.
  ctx.fillStyle = '#010203';
  ctx.fillStyle = value;
  if (ctx.fillStyle === '#010203') return value;
  ctx.fillRect(0, 0, 1, 1);
  const bytes = ctx.getImageData(0, 0, 1, 1).data;
  return `rgba(${bytes.slice(0, 3).join(', ')}, ${Math.round(bytes[3]! / 255 * 1000) / 1000})`;
}
