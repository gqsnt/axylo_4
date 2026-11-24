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

function canvasKey(win: Window, scheme: string, batch?: ThemeBatch | null): string {
  const dark = batch?.prefersDark ?? win.matchMedia('(prefers-color-scheme: dark)').matches;
  return `${scheme}|${dark ? '1' : '0'}`;
}

// A cached null records an unavailable Canvas color, while undefined still needs a probe.
function readCachedCanvas(
  doc: Document, win: Window, scheme: string, forcedColors: boolean, batch?: ThemeBatch | null,
): Rgba | null | undefined {
  const shared = batch?.canvas.get(scheme);
  if (shared !== undefined) return shared;
  if (forcedColors) return;
  const key = canvasKey(win, scheme, batch);
  const value = canvasCache.get(doc)?.get(key);
  if (value !== undefined) batch?.canvas.set(scheme, value);
  return value;
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
  if (cached !== undefined) return cached;
  const value = parseColor(probeColors(element, ['Canvas'])[0]!);
  if (!forcedColors) {
    const cacheKey = canvasKey(win, colorScheme, batch);
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
  readonly el: HTMLElement;
  readonly doc: Document;
  readonly win: Window | null;
  readonly on: boolean;
  readonly fc: boolean;
  readonly mc: boolean;
  readonly keys: readonly string[];
  readonly own: readonly (string | null)[] | null;
  readonly custom: boolean;
  readonly bindings: PaintBindings;
  readonly prev: string | null;
  readonly css: CSSStyleDeclaration | undefined;
  readonly batch: ThemeBatch | null;
  /** Bit 0 allows light, bit 1 allows dark. */
  modes: number;
  bgExpr: string;
  initialBg: string;
  invalid: string[];
  backdrop: Backdrop | null;
  pending: PendingBackdrop | null;
  rgb: string | null;
  ready: boolean;
  checked: boolean;
  later: string | null;
  scheme: 'light' | 'dark';
  follows: boolean;
  bg: string;
  known: boolean;
  std: boolean;
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
  const series = seriesKeys.map((_, i) => `var(${seriesProperty(i)})`);
  const previous = element.getAttribute(SCHEME_ATTRIBUTE);
  const prepared: PreparedTheme = {
    el: element, doc, win, on: connected, fc: forcedColors, mc: moreContrast, keys: seriesKeys, own: authored, custom: hasAuthored,
    bindings: { tokens: TOKEN_BINDINGS, series }, prev: previous,
    css: connected ? win.getComputedStyle(element) : undefined, batch: batch ?? null,
    initialBg: '', bgExpr: '', modes: 0,
    invalid: [], backdrop: null, pending: null, rgb: null,
    ready: !connected, checked: false, later: null,
    scheme: previous === 'dark' ? 'dark' : 'light', follows: false,
    bg: paletteRgb(LIGHT.background), known: false,
    std: !forcedColors && !moreContrast && !hasAuthored,
  };
  const style = prepared.css;
  if (style) {
    prepared.initialBg = style.backgroundColor;
    collectBackdrop(prepared);
    prepared.bgExpr = style.getPropertyValue(BACKGROUND_PROPERTY).trim();
    const schemes = style.colorScheme.split(/\s+/);
    prepared.modes = Number(schemes.includes('light')) + 2 * Number(schemes.includes('dark'));
    // Cold Canvas and custom backgrounds must wait until the probe phase.
    if (prepared.backdrop && !prepared.bgExpr) {
      const canvas = prepared.modes === 3
        ? readCachedCanvas(doc, win!, style.colorScheme, forcedColors, batch) : null;
      if (canvas !== undefined) decideScheme(prepared, canvas);
    }
  }
  return prepared;
}

const SCHEME_ATTRIBUTE = 'data-axylo-scheme';
const BACKGROUND_PROPERTY = '--axylo-background';
const BACKDROP_PROPERTY = '--axylo-backdrop';

function decideScheme(p: PreparedTheme, schemeColor: Rgba | null, override?: Rgba): void {
  const { css: style, modes: allowed, backdrop } = p;
  const fixed = allowed === 1 || allowed === 2;
  if (schemeColor) p.scheme = isLightColor(schemeColor) ? 'light' : 'dark';
  else if (fixed) p.scheme = allowed === 1 ? 'light' : 'dark';
  else {
    const text = concreteColor(style!.color, p.doc);
    p.scheme = text && isLightColor(text) ? 'dark' : 'light';
  }
  // For a declared color-scheme the CSS defaults follow the browser, including media changes.
  p.follows = !override && !!style!.colorScheme && style!.colorScheme !== 'normal';
  p.std = !p.fc && !p.mc && !p.custom
    && (!p.follows || fixed || schemeColor !== null);
  p.bg = override ? rgbText(schemeColor!) : p.rgb!;
  p.known = backdrop!.known || (override?.a ?? 0) >= 1;
  p.ready = true;
}

/**
 * Resolves scheme, `follows`, `background`, and `backdropKnown` after `--axylo-series-color-*` and
 * `--axylo-backdrop` have been written on `p.el`, so `--axylo-background` may reference them.
 */
function resolveSchemeAndBackground(p: PreparedTheme, bgExpr: string): void {
  const { el: element, win, css: style, backdrop, modes: allowed, fc: forcedColors, batch } = p;
  if (bgExpr) {
    const expression = ['var(--axylo-background)'];
    p.checked = true;
    if (/^currentcolor$/i.test(bgExpr) || validColors(element, expression)[0]) {
      const color = parseColor(probeColors(element, expression)[0]!);
      if (color && color.a > 0) {
        decideScheme(p, composite(color, backdrop!.color), color);
        return;
      }
    }
  }
  const canvas = allowed === 3 ? resolveSystemCanvas(element, win!, style!.colorScheme, forcedColors, batch) : null;
  decideScheme(p, canvas);
}

function writeBackdrop(p: PreparedTheme): void {
  setProperty(p.el, BACKDROP_PROPERTY, p.rgb!);
}

function syncScheme(p: PreparedTheme, previous: string | null): void {
  if (p.follows) p.el.removeAttribute(SCHEME_ATTRIBUTE);
  else if (previous !== p.scheme) p.el.setAttribute(SCHEME_ATTRIBUTE, p.scheme);
}

/**
 * Write & coordinated-probe phase of theme resolution: sets `--axylo-series-color-*`, `--axylo-backdrop`,
 * and `data-axylo-scheme` on `element`. When `--axylo-background` is set, series and backdrop properties
 * are written before `--axylo-background` is probed so references to them resolve cleanly.
 */
export function applyTheme(p: PreparedTheme): void {
  const { el: element, own: authored, custom: hasAuthored, keys: seriesKeys, bindings: { series } } = p;
  finishBackdrop(p);

  const valid = hasAuthored ? validColors(element, authored!) : null;
  if (valid) p.invalid = [];
  for (let i = 0, count = valid ? seriesKeys.length : series.length; i < count; i++) {
    const own = authored?.[i];
    if (own && valid && !valid[i]) p.invalid.push(seriesKeys[i]!);
    setProperty(element, seriesProperty(i), own && (!valid || valid[i]) ? authorBinding(own) : seriesBinding(i));
  }
  for (let i = written.get(element) ?? 0; i > series.length; i--) element.style.removeProperty(seriesProperty(i - 1));
  written.set(element, series.length);
  if (p.on) {
    writeBackdrop(p);
    if (!p.ready) resolveSchemeAndBackground(p, p.bgExpr);
    syncScheme(p, p.prev);
  }
}

function resolveLateBackground(p: PreparedTheme, liveBg: string): void {
  if (p.css!.backgroundColor !== p.initialBg) {
    p.initialBg = p.css!.backgroundColor;
    collectBackdrop(p);
    finishBackdrop(p);
    writeBackdrop(p);
  }
  resolveSchemeAndBackground(p, liveBg);
  // Use the live attribute after probing because applyTheme may have updated it.
  syncScheme(p, p.follows ? null : p.el.getAttribute(SCHEME_ATTRIBUTE));
  p.checked = true;
}

/**
 * Post-write verification phase: reads the live declaration after `applyTheme` so standalone stylesheet
 * overrides (and `--axylo-background` expressions referencing `--axylo-series-color-*` or `--axylo-backdrop`)
 * are detected. When `deferProbe` is true and a probe is needed, returns `null` so the caller can finish
 * layout reads first and then call `probeTheme(p)`.
 */
export function finalizeTheme(p: PreparedTheme, deferProbe = false): ThemeResolution | null {
  const { on: connected, css: style, doc, bindings: { series } } = p;
  if (connected && style) {
    // A `background-color` or `--axylo-background` referencing `--axylo-series-color-*` or `--axylo-backdrop`
    // may change or become non-empty after `applyTheme` writes them.
    const bgChanged = style.backgroundColor !== p.initialBg;
    const liveBg = !p.checked || bgChanged ? style.getPropertyValue(BACKGROUND_PROPERTY).trim() : '';
    if ((!p.checked && liveBg !== '') || bgChanged) {
      if (deferProbe) {
        p.later = liveBg;
        return null;
      }
      resolveLateBackground(p, liveBg);
    }
  }
  const { scheme, follows } = p;
  let standard = p.std;
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
  const tokens = { background: p.bg } as Record<PaintToken, string>;
  for (const name of TOKENS) {
    if (name !== 'text') tokens[name] = paint(name, LIGHT[name], DARK[name]);
  }
  const seriesColors = series.map((_, i) => {
    const slot = i % SERIES_COUNT;
    return paint(`series-${slot + 1}`, LIGHT.series[slot]!, DARK.series[slot]!, seriesProperty(i));
  });
  if (standard) {
    tokens.text = style ? normalizeColor(style.color, doc) : 'rgb(0, 0, 0)';
    return themeResolution(p, tokens, seriesColors);
  }
  p.tokens = tokens;
  if (deferProbe) return null;
  return probeTheme(p);
}

/** Resolves custom/non-standard paints via probe elements after `finalizeTheme(p, true)` returned `null`. */
export function probeTheme(p: PreparedTheme): ThemeResolution {
  if (p.later !== null) {
    const liveBg = p.later;
    p.later = null;
    resolveLateBackground(p, liveBg);
    return finalizeTheme(p, false)!;
  }
  const tokens = p.tokens ?? ({ background: p.bg } as Record<PaintToken, string>);
  const seriesColors = probeColors(p.el, [...TOKENS.map(t => TOKEN_BINDINGS[t]), ...p.bindings.series]);
  const values = seriesColors.splice(0, TOKENS.length);
  TOKENS.forEach((name, i) => { tokens[name] = values[i]!; });
  return themeResolution(p, tokens, seriesColors);
}

function themeResolution(p: PreparedTheme, tokens: Record<PaintToken, string>, series: string[]): ThemeResolution {
  return {
    bindings: p.bindings, resolved: p.on, backdropKnown: p.known, invalidColors: p.invalid,
    theme: { scheme: p.scheme, forcedColors: p.fc, moreContrast: p.mc, paints: { tokens, series } },
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
 * Retain the layers only when the read phase runs out of cached information. The write phase can still
 * reuse an ancestor filled by a sibling in the meantime.
 */
function collectBackdrop(p: PreparedTheme): void {
  const { el: element, doc, win, css: style, fc: forcedColors, batch } = p;
  const cached = batch?.backdrops;
  const nodes: Element[] = [];
  const layers: (Rgba | null)[] = [];
  const images: boolean[] = [];
  let rootColorScheme = '';
  let base: Rgba | null = null;
  let known = true;
  for (let node: Element | null = element; node; node = composedParent(node)) {
    const hit = node === element ? undefined : cached?.get(node);
    if (hit) {
      base = hit.color;
      known = hit.known;
      break;
    }
    const cs = node === element ? style! : win!.getComputedStyle(node);
    if (node === doc.documentElement) rootColorScheme = cs.colorScheme;
    const hasImage = !!(cs.backgroundImage && cs.backgroundImage !== 'none');
    const color = concreteColor(cs.backgroundColor, doc);
    if (color && color.a >= 1) {
      base = color;
      known = !hasImage;
      if (node !== element) cached?.set(node, { color, known });
      break;
    }
    nodes.push(node);
    layers.push(color && color.a > 0 ? color : null);
    images.push(hasImage);
  }
  if (!base) {
    rootColorScheme ||= win!.getComputedStyle(doc.documentElement).colorScheme;
    const canvas = readCachedCanvas(doc, win!, rootColorScheme, forcedColors, batch);
    if (canvas === undefined) {
      p.pending = { nodes, layers, images, rootColorScheme };
      return;
    }
    base = opaqueCanvas(canvas);
  }
  compositeBackdrop(p, nodes, layers, images, base, known);
}

const WHITE: Rgba = { r: 1, g: 1, b: 1, a: 1 };

function opaqueCanvas(color: Rgba | null): Rgba {
  return color === null ? WHITE : color.a < 1 ? composite(color, WHITE) : color;
}

function finishBackdrop(p: PreparedTheme): void {
  if (!p.pending) return;
  const { nodes, layers, images, rootColorScheme } = p.pending;
  const { doc, win, fc: forcedColors, batch } = p;
  let base: Backdrop | undefined;
  let start = nodes.length - 1;
  // An earlier tile may have filled an ancestor's backdrop since the read pass.
  if (batch) {
    for (let i = 1; i < nodes.length; i++) {
      base = batch.backdrops.get(nodes[i]!);
      if (base) {
        start = i - 1;
        break;
      }
    }
  }
  const color = base?.color ?? opaqueCanvas(resolveSystemCanvas(doc.documentElement, win!, rootColorScheme, forcedColors, batch));
  compositeBackdrop(p, nodes, layers, images, color, base?.known ?? true, start);
}

function compositeBackdrop(
  p: PreparedTheme, nodes: readonly Element[], layers: readonly (Rgba | null)[], images: readonly boolean[],
  color: Rgba, known: boolean, start = nodes.length - 1,
): void {
  const cached = p.batch?.backdrops;
  for (let i = start; i >= 0; i--) {
    if (images[i]) known = false;
    const layer = layers[i]!;
    if (layer !== null) color = composite(layer, color);
    if (cached && nodes[i] !== p.el) cached.set(nodes[i]!, { color, known });
  }
  p.backdrop = { color, known };
  p.rgb = rgbText(color);
  p.pending = null;
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
