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

const STANDARD_TOKENS = ['axis', 'grid', 'reference', 'muted', 'focus'] as const;
const TOKENS = [...STANDARD_TOKENS, 'text'] as const;

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
  const slot = index % SERIES_COUNT;
  // One string per palette slot: every chart writes and compares the same ones.
  return slotBindings[slot] ??= `var(--axylo-series-${slot + 1}, var(--axylo-default-series-${slot + 1}))`;
};
const slotBindings: (string | undefined)[] = [];

/**
 * Name of the custom property, set on the chart root, that carries series `index`'s color. Marks reference
 * it rather than the color itself, so the color can change (an author's `var(--brand)`, forced colors on or
 * off) with no draw call.
 */
export const seriesProperty = (index: number): string =>
  index < PROPERTY_CACHE_LIMIT ? seriesProperties[index] ??= `--axylo-series-color-${index + 1}` : `--axylo-series-color-${index + 1}`;
/** The series property names written and read on every theme pass, made once each. */
const seriesProperties: (string | undefined)[] = [];
const PROPERTY_CACHE_LIMIT = 256;

/**
 * An author color as the value of its series property. `--axylo-forced-series` is unset except under forced
 * colors, where the stylesheet sets it to a system color: the author's color then steps aside, and comes back
 * when forced colors ends, with no draw call (review finding 6).
 */
const authorBinding = (expression: string): string => `var(--axylo-forced-series, ${expression})`;

const paletteCache: Record<string, string> = {};
const paletteRgb = (hex: string): string => paletteCache[hex] ??= rgbText(parseColor(hex)!);

function paintValues(light: string, dark: string) {
  return { light, dark, follows: `light-dark(${light}, ${dark})` };
}

function standardPaints() {
  return {
    tokens: STANDARD_TOKENS.map(name => ({
      name, property: `--axylo-${name}`, fallback: `--axylo-default-${name}`,
      values: paintValues(LIGHT[name], DARK[name]),
    })),
    series: LIGHT.series.map((light, i) => paintValues(light, DARK.series[i]!)),
  };
}

let standard: ReturnType<typeof standardPaints> | undefined;

/** Cached Canvas system color per document when forced-colors is off (keyed by colorScheme + prefersDark). */
const canvasCache = new WeakMap<Document, Map<string, Rgba | null>>();

export interface ThemeBatch {
  readonly forcedColors: boolean;
  readonly moreContrast: boolean;
  readonly prefersDark: boolean;
  readonly backdrops: WeakMap<Element, Backdrop>;
  readonly ancestorLayers: WeakMap<Element, BackdropLayer>;
  readonly canvas: Map<string, Rgba | null>;
  /** The last standard paint result of this batch (see `standardResolution`). */
  last?: StandardResult | null;
}

/**
 * The paints of a standard figure, which depend only on what is compared here: tiles of a dashboard that
 * agree on all of it share one result instead of building the same palette again.
 */
interface StandardResult {
  readonly palette: 'light' | 'dark';
  readonly text: string;
  readonly background: string;
  readonly known: boolean;
  readonly forcedColors: boolean;
  readonly moreContrast: boolean;
  readonly count: number;
  readonly theme: ResolvedTheme;
}

/** `media`: the live media state when the window's theme watchers already hold it (no new queries). */
export function createThemeBatch(
  win: Window, media?: { readonly forcedColors: boolean; readonly moreContrast: boolean; readonly prefersDark: boolean } | null,
): ThemeBatch {
  return {
    forcedColors: media ? media.forcedColors : win.matchMedia('(forced-colors: active)').matches,
    moreContrast: media ? media.moreContrast : win.matchMedia('(prefers-contrast: more)').matches,
    prefersDark: media ? media.prefersDark : win.matchMedia('(prefers-color-scheme: dark)').matches,
    backdrops: new WeakMap(),
    ancestorLayers: new WeakMap(),
    canvas: new Map(),
    last: null,
  };
}

/** The series bindings for a number of palette slots: the same strings every time, so one array per count. */
let seriesBindingArrays: Map<number, readonly string[]> | undefined;
const SERIES_BINDING_LIMIT = 64;

function seriesBindingsFor(count: number): readonly string[] {
  const cache = seriesBindingArrays ??= new Map();
  let series = cache.get(count);
  if (series) return series;
  const made = new Array<string>(count);
  for (let i = 0; i < count; i++) made[i] = `var(${seriesProperty(i)})`;
  series = made;
  if (cache.size >= SERIES_BINDING_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(count, series);
  return series;
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

interface Backdrop { readonly color: Rgba; readonly known: boolean; readonly rgb: string }

interface BackdropLayer {
  readonly color: Rgba | null;
  readonly image: boolean;
  readonly rootScheme?: string;
}

interface AncestorLayer {
  readonly node: Element;
  readonly layer: BackdropLayer;
}

interface PendingBackdrop {
  readonly own: BackdropLayer;
  readonly ancestors: readonly AncestorLayer[];
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
  ready: boolean;
  checked: boolean;
  later: string | null;
  scheme: 'light' | 'dark';
  follows: boolean;
  bg: string;
  known: boolean;
  std: boolean;
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
  let authored: (string | null)[] | null = null;
  if (colors) {
    for (let i = 0; i < seriesKeys.length; i++) {
      const key = seriesKeys[i]!;
      if (!Object.hasOwn(colors, key)) continue;
      const value = colors[key]?.trim();
      if (value) (authored ??= new Array<string | null>(seriesKeys.length).fill(null))[i] = value;
    }
  }
  const hasAuthored = connected && authored !== null;
  const series = seriesBindingsFor(seriesKeys.length);
  const previous = element.getAttribute(SCHEME_ATTRIBUTE);
  const prepared: PreparedTheme = {
    el: element, doc, win, on: connected, fc: forcedColors, mc: moreContrast, keys: seriesKeys, own: authored, custom: hasAuthored,
    bindings: { tokens: TOKEN_BINDINGS, series }, prev: previous,
    css: connected ? win.getComputedStyle(element) : undefined, batch: batch ?? null,
    initialBg: '', bgExpr: '', modes: 0,
    invalid: [], backdrop: null, pending: null,
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
    const colorScheme = style.colorScheme;
    const schemes = colorScheme === 'normal' ? [] : colorScheme.split(/\s+/);
    prepared.modes = Number(schemes.includes('light')) + 2 * Number(schemes.includes('dark'));
    // Cold Canvas and custom backgrounds must wait until the probe phase.
    if (prepared.backdrop && !prepared.bgExpr) {
      const canvas = prepared.modes === 3
        ? readCachedCanvas(doc, win!, colorScheme, forcedColors, batch) : null;
      // Nothing was written since colorScheme was read: the same value serves the decision.
      if (canvas !== undefined) decideScheme(prepared, canvas, undefined, colorScheme);
    }
  }
  return prepared;
}

const SCHEME_ATTRIBUTE = 'data-axylo-scheme';
const BACKGROUND_PROPERTY = '--axylo-background';
const BACKDROP_PROPERTY = '--axylo-backdrop';

/** `colorScheme`: the computed color-scheme when the caller read it with no write since; else it is read here. */
function decideScheme(p: PreparedTheme, schemeColor: Rgba | null, override?: Rgba, colorScheme?: string): void {
  const { css: style, modes: allowed, backdrop } = p;
  const fixed = allowed === 1 || allowed === 2;
  if (schemeColor) p.scheme = isLightColor(schemeColor) ? 'light' : 'dark';
  else if (fixed) p.scheme = allowed === 1 ? 'light' : 'dark';
  else {
    const text = concreteColor(style!.color, p.doc);
    p.scheme = text && isLightColor(text) ? 'dark' : 'light';
  }
  // For a declared color-scheme the CSS defaults follow the browser, including media changes.
  const scheme = override ? '' : colorScheme ?? style!.colorScheme;
  p.follows = !override && !!scheme && scheme !== 'normal';
  p.std = !p.fc && !p.mc && !p.custom
    && (!p.follows || fixed || schemeColor !== null);
  p.bg = override ? rgbText(schemeColor!) : backdrop!.rgb;
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

function writeBackdrop(p: PreparedTheme, empty = false): void {
  setProperty(p.el.style, BACKDROP_PROPERTY, p.backdrop!.rgb, empty);
}

function syncScheme(p: PreparedTheme, previous: string | null): void {
  if (p.follows) {
    if (previous !== null) p.el.removeAttribute(SCHEME_ATTRIBUTE);
  } else if (previous !== p.scheme) p.el.setAttribute(SCHEME_ATTRIBUTE, p.scheme);
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
  const style = element.style;
  const empty = style.length === 0;
  for (let i = 0; i < series.length; i++) {
    const own = authored?.[i];
    if (own && valid && !valid[i]) p.invalid.push(seriesKeys[i]!);
    setProperty(style, seriesProperty(i), own && (!valid || valid[i]) ? authorBinding(own) : seriesBinding(i), empty);
  }
  for (let i = written.get(element) ?? 0; i > series.length; i--) style.removeProperty(seriesProperty(i - 1));
  written.set(element, series.length);
  if (p.on) {
    writeBackdrop(p, empty);
    if (!p.ready) resolveSchemeAndBackground(p, p.bgExpr);
    syncScheme(p, p.prev);
  }
}

function resolveLateBackground(p: PreparedTheme, liveBg: string): void {
  const background = p.css!.backgroundColor;
  if (background !== p.initialBg) {
    p.initialBg = background;
    // Library writes can affect ancestor rules too. Use the current styles for this second pass.
    collectBackdrop(p, null);
    finishBackdrop(p, null);
    writeBackdrop(p);
  }
  resolveSchemeAndBackground(p, liveBg);
  // Use the live attribute after probing because applyTheme may have updated it.
  syncScheme(p, p.el.getAttribute(SCHEME_ATTRIBUTE));
  p.checked = true;
}

/**
 * Post-write verification phase: reads the live declaration after `applyTheme` so standalone stylesheet
 * overrides (and `--axylo-background` expressions referencing `--axylo-series-color-*` or `--axylo-backdrop`)
 * are detected. When `deferProbe` is true and a probe is needed, returns `null` so the caller can finish
 * layout reads first and then call `probeTheme(p)`.
 */
export function finalizeTheme(p: PreparedTheme, deferProbe = false): ThemeResolution | null {
  const { css: style } = p;
  if (style) {
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
  return standardResolution(p) ?? (deferProbe ? null : probeTheme(p));
}

function standardResolution(p: PreparedTheme): ThemeResolution | null {
  const { css: style, on: connected, scheme, follows } = p;
  if (!p.std || style?.getPropertyValue('--axylo-text')) return null;
  const defaults = standard ??= standardPaints();
  const palette = connected ? scheme : 'light';
  const expected = follows ? 'follows' : palette;
  const tokens = defaults.tokens;
  const count = p.bindings.series.length;
  if (style) {
    for (let t = 0; t < tokens.length; t++) {
      const token = tokens[t]!;
      if (style.getPropertyValue(token.property) || style.getPropertyValue(token.fallback).trim() !== token.values[expected]) return null;
    }
    for (let i = 0; i < count; i++) {
      // CSSOM has already substituted both palette variables in the property the marks use.
      // Read it on each chart so the full cascade, including child-specific selectors, still applies.
      if (style.getPropertyValue(seriesProperty(i)).trim() !== defaults.series[i % SERIES_COUNT]![expected]) return null;
    }
  }
  const text = style ? normalizeColor(style.color, p.doc) : 'rgb(0, 0, 0)';
  // Every check above passed for this figure: its paints are the palette's, the text and background it
  // has. Only a light-DOM figure whose background was not probed shares the batch's last result.
  const batch = p.batch;
  const shareable = batch !== null && connected && !p.checked && !p.bgExpr && inDocumentTree(p.el, p.doc);
  const last = shareable ? batch.last : null;
  if (last && last.palette === palette && last.text === text && last.background === p.bg && last.known === p.known &&
      last.forcedColors === p.fc && last.moreContrast === p.mc && last.count === count) {
    return { bindings: p.bindings, resolved: p.on, backdropKnown: p.known, invalidColors: p.invalid, theme: last.theme };
  }
  const paints = { background: p.bg } as Record<PaintToken, string>;
  for (let t = 0; t < tokens.length; t++) paints[tokens[t]!.name] = paletteRgb(tokens[t]!.values[palette]);
  const series = new Array<string>(count);
  for (let i = 0; i < count; i++) series[i] = paletteRgb(defaults.series[i % SERIES_COUNT]![palette]);
  paints.text = text;
  const resolution = themeResolution(p, paints, series);
  if (shareable) {
    batch.last = {
      palette, text, background: p.bg, known: p.known, forcedColors: p.fc, moreContrast: p.mc, count, theme: resolution.theme,
    };
  }
  return resolution;
}

/** The element is in its document's own tree, not in a shadow root. */
function inDocumentTree(element: Element, doc: Document): boolean {
  return typeof element.getRootNode === 'function' && element.getRootNode() === doc;
}

/** Resolves custom/non-standard paints via probe elements after `finalizeTheme(p, true)` returned `null`. */
export function probeTheme(p: PreparedTheme): ThemeResolution {
  if (p.later !== null) {
    const liveBg = p.later;
    p.later = null;
    resolveLateBackground(p, liveBg);
    return finalizeTheme(p, false)!;
  }
  const tokens = { background: p.bg } as Record<PaintToken, string>;
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

function readBackdropLayer(value: string, image: string, doc: Document, rootScheme?: string): BackdropLayer {
  return { color: concreteColor(value, doc), image: !!image && image !== 'none', rootScheme };
}

function backdrop(color: Rgba, known: boolean): Backdrop {
  return { color, known, rgb: rgbText(color) };
}

function layerOver(layer: BackdropLayer, base: Backdrop): Backdrop {
  const known = base.known && !layer.image;
  return layer.color && layer.color.a > 0
    ? backdrop(composite(layer.color, base.color), known)
    : known === base.known ? base : { ...base, known };
}

/** Share actual ancestor layers while Canvas is still cold. Always read the chart's own layer live. */
function collectBackdrop(p: PreparedTheme, batch = p.batch): void {
  const { el, doc, win, css: style, fc: forcedColors } = p;
  const root = doc.documentElement;
  const own = readBackdropLayer(p.initialBg, style!.backgroundImage, doc);
  p.pending = null;
  if (own.color && own.color.a >= 1) {
    p.backdrop = backdrop(own.color, !own.image);
    return;
  }
  let node = composedParent(el);
  let base = node ? batch?.backdrops.get(node) : undefined;
  if (base) {
    p.backdrop = layerOver(own, base);
    return;
  }

  const ancestors: AncestorLayer[] = [];
  let rootColorScheme = el === root ? style!.colorScheme : '';
  while (node) {
    let layer = batch?.ancestorLayers.get(node);
    if (!layer) {
      const cs = win!.getComputedStyle(node);
      layer = readBackdropLayer(cs.backgroundColor, cs.backgroundImage, doc, node === root ? cs.colorScheme : undefined);
      batch?.ancestorLayers.set(node, layer);
    }
    if (layer.color && layer.color.a >= 1) {
      base = backdrop(layer.color, !layer.image);
      batch?.backdrops.set(node, base);
      break;
    }
    rootColorScheme ||= layer.rootScheme ?? '';
    ancestors.push({ node, layer });
    node = composedParent(node);
    if (node) {
      base = batch?.backdrops.get(node);
      if (base) break;
    }
  }
  if (!base) {
    rootColorScheme ||= win!.getComputedStyle(root).colorScheme;
    const canvas = readCachedCanvas(doc, win!, rootColorScheme, forcedColors, p.batch);
    if (canvas === undefined) {
      p.pending = { own, ancestors, rootColorScheme };
      return;
    }
    base = canvasBackdrop(canvas);
  }
  p.backdrop = compositeBackdrop(own, ancestors, base, batch);
}

const WHITE: Rgba = { r: 1, g: 1, b: 1, a: 1 };

function canvasBackdrop(color: Rgba | null): Backdrop {
  return backdrop(color === null ? WHITE : color.a < 1 ? composite(color, WHITE) : color, true);
}

function finishBackdrop(p: PreparedTheme, batch = p.batch): void {
  if (!p.pending) return;
  const { own, ancestors, rootColorScheme } = p.pending;
  const { doc, win, fc: forcedColors } = p;
  let base: Backdrop | undefined;
  let count = ancestors.length;
  // An earlier tile may have filled an ancestor's backdrop since the read pass.
  if (batch) {
    for (let i = 0; i < count; i++) {
      base = batch.backdrops.get(ancestors[i]!.node);
      if (base) {
        count = i;
        break;
      }
    }
  }
  base ??= canvasBackdrop(resolveSystemCanvas(doc.documentElement, win!, rootColorScheme, forcedColors, p.batch));
  p.backdrop = compositeBackdrop(own, ancestors, base, batch, count);
  p.pending = null;
}

function compositeBackdrop(
  own: BackdropLayer, ancestors: readonly AncestorLayer[], base: Backdrop,
  batch: ThemeBatch | null, count = ancestors.length,
): Backdrop {
  for (let i = count - 1; i >= 0; i--) {
    const { node, layer } = ancestors[i]!;
    base = layerOver(layer, base);
    batch?.backdrops.set(node, base);
  }
  return layerOver(own, base);
}

const rgbText = (c: Rgba): string => `rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)})`;

function setProperty(style: CSSStyleDeclaration, name: string, value: string, empty: boolean): void {
  if (empty || style.getPropertyValue(name) !== value) style.setProperty(name, value);
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
