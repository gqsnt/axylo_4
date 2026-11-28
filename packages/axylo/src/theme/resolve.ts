/**
 * Theme resolution (spec L4, DX6, A5): decides light or dark for a chart root, and turns paints into both
 * CSS expressions for the live SVG renderer and concrete colors for contrast checks. Standard paints come
 * from the verified palette. The browser resolves custom paints through probe elements.
 */
import type { PaintBindings, PaintToken, ResolvedTheme } from "../core/contracts";
import { composedParent } from "../core/environment";
import { composite, isLightColor, lowContrastSeries, parseColor, WHITE, type Rgba } from "./color";
import { DARK, LIGHT, SERIES_COUNT } from "./palette";

export interface ThemeResolution {
  readonly bindings: PaintBindings;
  readonly theme: ResolvedTheme;
  readonly resolved?: boolean;
  readonly backdropKnown?: boolean;
  readonly invalidColors?: readonly string[];
  readonly lowContrast?: readonly number[];
}

const STD_TOKENS = ["axis", "grid", "reference", "muted", "focus"] as const;
const TOKENS = ["axis", "grid", "reference", "muted", "focus", "text"] as const;
const SCHEME_ATTR = "data-axylo-scheme";
const BG_PROP = "--axylo-background";
const BACKDROP_PROP = "--axylo-backdrop";
const M_FORCED = "(forced-colors: active)";
const M_CONTRAST = "(prefers-contrast: more)";
const M_DARK = "(prefers-color-scheme: dark)";
const NONE: readonly never[] = [];
const CLEAR_LAYER: BackdropLayer = { c: null, i: false };

export const TOKEN_BINDINGS: Readonly<Record<PaintToken, string>> = {
  axis: "var(--axylo-axis, var(--axylo-default-axis))",
  grid: "var(--axylo-grid, var(--axylo-default-grid))",
  reference: "var(--axylo-reference, var(--axylo-default-reference))",
  muted: "var(--axylo-muted, var(--axylo-default-muted))",
  focus: "var(--axylo-focus, var(--axylo-default-focus))",
  background: "var(--axylo-background, var(--axylo-backdrop, var(--axylo-default-background)))",
  text: "var(--axylo-text, currentColor)",
};

const slotBindings: (string | undefined)[] = [];
export const seriesBinding = (index: number): string => {
  const s = index % SERIES_COUNT;
  return (slotBindings[s] ??= `var(--axylo-series-${s + 1}, var(--axylo-default-series-${s + 1}))`);
};

const seriesProps: (string | undefined)[] = [];
export const seriesProperty = (index: number): string =>
  index < 256
    ? (seriesProps[index] ??= `--axylo-series-color-${index + 1}`)
    : `--axylo-series-color-${index + 1}`;

const paletteCache: Record<string, string> = {};
const rgbText = (c: Rgba): string =>
  `rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)})`;
const paletteRgb = (hex: string): string => (paletteCache[hex] ??= rgbText(parseColor(hex)!));

let standardTokens:
  | { name: (typeof STD_TOKENS)[number]; property: string; fallback: string; follows: string }[]
  | undefined;
const lightDark = (light: string, dark: string) => `light-dark(${light}, ${dark})`;
let followsSeries: string[] | undefined;

const canvasCache = new WeakMap<Document, Map<string, Rgba | null>>();
const written = new WeakMap<Element, number>();
const probes = new WeakMap<Document, { b: HTMLElement; c: HTMLElement[]; p: HTMLElement[] }>();
let paintBindings: Map<number, PaintBindings> | undefined;

const media = (win: Window, query: string) => win.matchMedia(query).matches;

export interface ThemeBatch {
  readonly f: boolean;
  readonly m: boolean;
  readonly d: boolean;
  readonly b: WeakMap<Element, Backdrop>;
  readonly a: WeakMap<Element, BackdropLayer>;
  readonly c: Map<string, Rgba | null>;
  l?: ThemeResolution | null;
}

export function createThemeBatch(
  win: Window,
  cached?: {
    readonly forcedColors: boolean;
    readonly moreContrast: boolean;
    readonly prefersDark: boolean;
  } | null,
): ThemeBatch {
  return {
    f: cached ? cached.forcedColors : media(win, M_FORCED),
    m: cached ? cached.moreContrast : media(win, M_CONTRAST),
    d: cached ? cached.prefersDark : media(win, M_DARK),
    b: new WeakMap(),
    a: new WeakMap(),
    c: new Map(),
    l: null,
  };
}

function bindingsFor(count: number): PaintBindings {
  const cache = (paintBindings ??= new Map());
  let b = cache.get(count);
  if (!b) {
    const series = new Array<string>(count);
    for (let i = 0; i < count; i++) series[i] = `var(${seriesProperty(i)})`;
    b = { tokens: TOKEN_BINDINGS, series };
    if (cache.size >= 64) cache.delete(cache.keys().next().value!);
    cache.set(count, b);
  }
  return b;
}

function getCanvas(
  el: Element,
  win: Window,
  scheme: string,
  forced: boolean,
  batch: ThemeBatch | null | undefined,
  probe: boolean,
): Rgba | null | undefined {
  const doc = el.ownerDocument;
  const shared = batch?.c.get(scheme);
  if (shared !== undefined) return shared;
  let key = "";
  if (!forced) {
    key = `${scheme}|${(batch?.d ?? media(win, M_DARK)) ? 1 : 0}`;
    const cached = canvasCache.get(doc)?.get(key);
    if (cached !== undefined) {
      batch?.c.set(scheme, cached);
      return cached;
    }
  }
  if (!probe) return undefined;
  const value = parseColor(probeColors(el, ["Canvas"])[0]!);
  if (!forced) {
    let map = canvasCache.get(doc);
    if (!map) canvasCache.set(doc, (map = new Map()));
    else if (map.size >= 32) map.clear();
    map.set(key, value);
  }
  batch?.c.set(scheme, value);
  return value;
}

interface Backdrop {
  readonly c: Rgba;
  readonly k: boolean;
  readonly r: string;
}
interface BackdropLayer {
  readonly c: Rgba | null;
  readonly i: boolean;
  readonly s?: string;
}
interface PendingBackdrop {
  readonly o: BackdropLayer;
  readonly a: readonly [Element, BackdropLayer][];
  readonly s: string;
}

export interface PreparedTheme {
  readonly el: HTMLElement;
  readonly f: boolean;
  readonly m: boolean;
  readonly k: readonly string[];
  readonly a: readonly (string | null)[] | null;
  readonly b: PaintBindings;
  readonly p: string | null;
  readonly s: CSSStyleDeclaration | undefined;
  readonly h: ThemeBatch | null;
  x: number;
  g: string;
  i: string;
  v: readonly string[];
  c: Backdrop | null;
  q: PendingBackdrop | null;
  r: boolean;
  y: boolean;
  later: string | null;
  l: "light" | "dark";
  n: boolean;
  z: string;
  kn: boolean;
  t: boolean;
}

let lastScheme = "normal",
  lastModes = 0;

export function prepareTheme(
  el: HTMLElement,
  seriesKeys: readonly string[],
  colors?: Readonly<Record<string, string>> | null,
  batch?: ThemeBatch | null,
): PreparedTheme {
  const d = el.ownerDocument,
    w = d.defaultView,
    o = w !== null && el.isConnected;
  const f = o && (batch ? batch.f : media(w, M_FORCED));
  const m = o && (batch ? batch.m : media(w, M_CONTRAST));
  let a: (string | null)[] | null = null;
  if (colors) {
    for (let i = 0; i < seriesKeys.length; i++) {
      const key = seriesKeys[i]!,
        val = Object.hasOwn(colors, key) ? colors[key]?.trim() : "";
      if (val) (a ??= new Array<string | null>(seriesKeys.length).fill(null))[i] = val;
    }
  }
  const p = el.getAttribute(SCHEME_ATTR),
    s = o ? w.getComputedStyle(el) : undefined;
  const prep: PreparedTheme = {
    el,
    f,
    m,
    k: seriesKeys,
    a,
    b: bindingsFor(seriesKeys.length),
    p,
    s,
    h: batch ?? null,
    i: "",
    g: "",
    x: 0,
    v: NONE,
    c: null,
    q: null,
    r: !o,
    y: false,
    later: null,
    l: p === "dark" ? "dark" : "light",
    n: false,
    z: paletteRgb(LIGHT.background),
    kn: false,
    t: !f && !m && !(o && a !== null),
  };
  if (s) {
    prep.i = s.backgroundColor;
    collectBackdrop(prep);
    prep.g = s.getPropertyValue(BG_PROP).trim();
    const cs = s.colorScheme;
    if (cs !== lastScheme) {
      const parts = cs === "normal" ? [] : cs.split(/\s+/);
      lastModes = +parts.includes("light") + 2 * +parts.includes("dark");
      lastScheme = cs;
    }
    prep.x = lastModes;
    if (prep.c && !prep.g) {
      const canvas = prep.x === 3 ? getCanvas(el, w!, cs, f, batch, false) : null;
      if (canvas !== undefined) decideScheme(prep, canvas, undefined, cs);
    }
  }
  return prep;
}

function decideScheme(
  p: PreparedTheme,
  schemeColor: Rgba | null,
  override?: Rgba,
  cs?: string,
): void {
  const fixed = p.x === 1 || p.x === 2;
  if (schemeColor) p.l = isLightColor(schemeColor) ? "light" : "dark";
  else if (fixed) p.l = p.x === 1 ? "light" : "dark";
  else {
    const text = concreteColor(p.s!.color, p.el.ownerDocument);
    p.l = text && isLightColor(text) ? "dark" : "light";
  }
  const scheme = override ? "" : (cs ?? p.s!.colorScheme);
  p.n = !override && !!scheme && scheme !== "normal";
  p.t = !p.f && !p.m && !(p.s && p.a) && (!p.n || fixed || schemeColor !== null);
  p.z = override ? rgbText(schemeColor!) : p.c!.r;
  p.kn = p.c!.k || (override?.a ?? 0) >= 1;
  p.r = true;
}

function resolveSchemeAndBg(p: PreparedTheme, bgExpr: string): void {
  if (bgExpr) {
    const expr = ["var(--axylo-background)"];
    p.y = true;
    if (/^currentcolor$/i.test(bgExpr) || validColors(p.el, expr)[0]) {
      const color = parseColor(probeColors(p.el, expr)[0]!);
      if (color && color.a > 0) {
        decideScheme(p, composite(color, p.c!.c), color);
        return;
      }
    }
  }
  decideScheme(
    p,
    p.x === 3
      ? getCanvas(p.el, p.el.ownerDocument.defaultView!, p.s!.colorScheme, p.f, p.h, true)!
      : null,
  );
}

const setProp = (st: CSSStyleDeclaration, name: string, val: string, empty: boolean) => {
  if (empty || st.getPropertyValue(name) !== val) st.setProperty(name, val);
};

function syncScheme(p: PreparedTheme, prev: string | null): void {
  if (p.n) {
    if (prev !== null) p.el.removeAttribute(SCHEME_ATTR);
  } else if (prev !== p.l) p.el.setAttribute(SCHEME_ATTR, p.l);
}

export function applyTheme(p: PreparedTheme): void {
  const {
    el,
    a,
    k,
    b: { series },
  } = p;
  finishBackdrop(p);
  const valid = p.s && a ? validColors(el, a) : null;
  let invalid: string[] | null = null;
  const st = el.style,
    empty = st.length === 0;
  for (let i = 0; i < series.length; i++) {
    const own = a?.[i];
    if (own && valid && !valid[i]) (invalid ??= []).push(k[i]!);
    setProp(
      st,
      seriesProperty(i),
      own && (!valid || valid[i]) ? `var(--axylo-forced-series, ${own})` : seriesBinding(i),
      empty,
    );
  }
  if (valid) p.v = invalid ?? NONE;
  for (let i = written.get(el) ?? 0; i > series.length; i--)
    st.removeProperty(seriesProperty(i - 1));
  written.set(el, series.length);
  if (p.s) {
    setProp(st, BACKDROP_PROP, p.c!.r, empty);
    if (!p.r) resolveSchemeAndBg(p, p.g);
    syncScheme(p, p.p);
  }
}

function resolveLateBg(p: PreparedTheme, liveBg: string): void {
  const bg = p.s!.backgroundColor;
  if (bg !== p.i) {
    p.i = bg;
    collectBackdrop(p, null);
    finishBackdrop(p, null);
    setProp(p.el.style, BACKDROP_PROP, p.c!.r, false);
  }
  resolveSchemeAndBg(p, liveBg);
  syncScheme(p, p.el.getAttribute(SCHEME_ATTR));
  p.y = true;
}

export function finalizeTheme(p: PreparedTheme, deferProbe = false): ThemeResolution | null {
  const s = p.s;
  if (s) {
    const bgChanged = s.backgroundColor !== p.i;
    const liveBg = !p.y || bgChanged ? s.getPropertyValue(BG_PROP).trim() : "";
    if ((!p.y && liveBg !== "") || bgChanged) {
      if (deferProbe) {
        p.later = liveBg;
        return null;
      }
      resolveLateBg(p, liveBg);
    }
  }
  return standardResolution(p) ?? (deferProbe ? null : probeTheme(p));
}

function standardResolution(p: PreparedTheme): ThemeResolution | null {
  const { s, l, n } = p,
    o = s !== undefined;
  if (!p.t || s?.getPropertyValue("--axylo-text")) return null;
  const pal = o && l === "dark" ? DARK : LIGHT,
    palName = o ? l : "light",
    count = p.b.series.length;
  if (s) {
    const tokens = (standardTokens ??= STD_TOKENS.map((name) => ({
      name,
      property: `--axylo-${name}`,
      fallback: `--axylo-default-${name}`,
      follows: lightDark(LIGHT[name], DARK[name]),
    })));
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!;
      if (
        (s.getPropertyValue(t.property) || s.getPropertyValue(t.fallback)).trim() !==
        (n ? t.follows : pal[t.name])
      )
        return null;
    }
    if (n) followsSeries ??= LIGHT.series.map((v, i) => lightDark(v, DARK.series[i]!));
    for (let i = 0; i < count; i++) {
      const slot = i % SERIES_COUNT;
      if (
        s.getPropertyValue(seriesProperty(i)).trim() !==
        (n ? followsSeries![slot] : pal.series[slot])
      )
        return null;
    }
  }
  const doc = p.el.ownerDocument,
    text = s ? normalizeColor(s.color, doc) : "rgb(0, 0, 0)";
  const batch = p.h;
  const shareable =
    batch !== null &&
    o &&
    !p.y &&
    !p.g &&
    typeof p.el.getRootNode === "function" &&
    p.el.getRootNode() === doc;
  const last = shareable ? batch.l : null;
  if (
    last &&
    last.bindings === p.b &&
    last.backdropKnown === p.kn &&
    last.theme.scheme === palName &&
    last.theme.paints.tokens.text === text &&
    last.theme.paints.tokens.background === p.z &&
    last.theme.forcedColors === p.f &&
    last.theme.moreContrast === p.m &&
    !p.v.length &&
    !last.invalidColors!.length
  )
    return last;
  const paints = { background: p.z, text } as Record<PaintToken, string>;
  for (const name of STD_TOKENS) paints[name] = paletteRgb(pal[name]);
  const series = new Array<string>(count);
  for (let i = 0; i < count; i++) series[i] = paletteRgb(pal.series[i % SERIES_COUNT]!);
  const res = themeResolution(p, paints, series, true);
  if (shareable) batch.l = res;
  return res;
}

let tokenExpressions: string[] | undefined;

export function probeTheme(p: PreparedTheme): ThemeResolution {
  if (p.later !== null) {
    const liveBg = p.later;
    p.later = null;
    resolveLateBg(p, liveBg);
    return finalizeTheme(p, false)!;
  }
  const tokens = { background: p.z } as Record<PaintToken, string>;
  const series = probeColors(
    p.el,
    (tokenExpressions ??= TOKENS.map((t) => TOKEN_BINDINGS[t])).concat(p.b.series),
  );
  const values = series.splice(0, TOKENS.length);
  TOKENS.forEach((name, i) => {
    tokens[name] = values[i]!;
  });
  return themeResolution(p, tokens, series);
}

function themeResolution(
  p: PreparedTheme,
  tokens: Record<PaintToken, string>,
  series: string[],
  standard = false,
): ThemeResolution {
  const theme = { scheme: p.l, forcedColors: p.f, moreContrast: p.m, paints: { tokens, series } };
  let lowContrast: readonly number[] | undefined;
  if (standard && p.kn)
    lowContrast =
      p.z === paletteRgb((p.l === "light" ? LIGHT : DARK).background)
        ? NONE
        : lowContrastSeries(theme);
  return {
    bindings: p.b,
    resolved: p.s !== undefined,
    backdropKnown: p.kn,
    invalidColors: p.v,
    lowContrast,
    theme,
  };
}

export function resolveTheme(
  element: HTMLElement,
  seriesKeys: readonly string[],
  colors?: Readonly<Record<string, string>> | null,
): ThemeResolution {
  const p = prepareTheme(element, seriesKeys, colors);
  applyTheme(p);
  return finalizeTheme(p, false)!;
}

function readBackdropLayer(
  val: string,
  img: string,
  doc: Document,
  rootScheme?: string,
): BackdropLayer {
  const i = !!img && img !== "none";
  return !i && !rootScheme && val === "rgba(0, 0, 0, 0)"
    ? CLEAR_LAYER
    : { c: concreteColor(val, doc), i, s: rootScheme };
}

const mkBackdrop = (c: Rgba, k: boolean): Backdrop => ({ c, k, r: rgbText(c) });

function layerOver(layer: BackdropLayer, base: Backdrop): Backdrop {
  const k = base.k && !layer.i;
  return layer.c && layer.c.a > 0
    ? mkBackdrop(composite(layer.c, base.c), k)
    : k === base.k
      ? base
      : { ...base, k };
}

function collectBackdrop(p: PreparedTheme, batch = p.h): void {
  const { el, s, f } = p,
    d = el.ownerDocument,
    w = d.defaultView!,
    root = d.documentElement;
  const own = readBackdropLayer(p.i, s!.backgroundImage, d);
  p.q = null;
  if (own.c && own.c.a >= 1) {
    p.c = mkBackdrop(own.c, !own.i);
    return;
  }
  let node = composedParent(el),
    base = node ? batch?.b.get(node) : undefined;
  if (base) {
    p.c = layerOver(own, base);
    return;
  }

  const ancestors: [Element, BackdropLayer][] = [];
  let rootCS = el === root ? s!.colorScheme : "";
  while (node) {
    let layer = batch?.a.get(node);
    if (!layer) {
      const cs = w.getComputedStyle(node);
      layer = readBackdropLayer(
        cs.backgroundColor,
        cs.backgroundImage,
        d,
        node === root ? cs.colorScheme : undefined,
      );
      batch?.a.set(node, layer);
    }
    if (layer.c && layer.c.a >= 1) {
      base = mkBackdrop(layer.c, !layer.i);
      batch?.b.set(node, base);
      break;
    }
    rootCS ||= layer.s ?? "";
    ancestors.push([node, layer]);
    node = composedParent(node);
    if (node && (base = batch?.b.get(node))) break;
  }
  if (!base) {
    rootCS ||= w.getComputedStyle(root).colorScheme;
    const canvas = getCanvas(el, w, rootCS, f, p.h, false);
    if (canvas === undefined) {
      p.q = { o: own, a: ancestors, s: rootCS };
      return;
    }
    base = canvasBackdrop(canvas);
  }
  p.c = compositeBackdrop(own, ancestors, base, batch);
}

const canvasBackdrop = (c: Rgba | null): Backdrop =>
  mkBackdrop(c === null ? WHITE : c.a < 1 ? composite(c, WHITE) : c, true);

function finishBackdrop(p: PreparedTheme, batch = p.h): void {
  if (!p.q) return;
  const { o, a, s } = p.q,
    doc = p.el.ownerDocument;
  let base: Backdrop | undefined,
    count = a.length;
  if (batch)
    for (let i = 0; i < count; i++)
      if ((base = batch.b.get(a[i]![0]))) {
        count = i;
        break;
      }
  base ??= canvasBackdrop(getCanvas(doc.documentElement, doc.defaultView!, s, p.f, p.h, true)!);
  p.c = compositeBackdrop(o, a, base, batch, count);
  p.q = null;
}

function compositeBackdrop(
  own: BackdropLayer,
  ancestors: readonly [Element, BackdropLayer][],
  base: Backdrop,
  batch: ThemeBatch | null,
  count = ancestors.length,
): Backdrop {
  for (let i = count - 1; i >= 0; i--) {
    const [node, layer] = ancestors[i]!;
    base = layerOver(layer, base);
    batch?.b.set(node, base);
  }
  return layerOver(own, base);
}

function probeColors(el: Element, expressions: readonly string[], validating = false): string[] {
  const doc = el.ownerDocument;
  let cached = probes.get(doc);
  if (!cached) {
    const b = doc.createElement("div");
    b.style.display = "none";
    probes.set(doc, (cached = { b, c: [], p: [] }));
  }
  const { b } = cached,
    pool = validating ? cached.p : cached.c;
  b.style.forcedColorAdjust = validating ? "" : "none";
  for (let i = 0; i < expressions.length; i++) {
    let span = pool[i];
    if (!span) {
      span = pool[i] = doc.createElement("span");
      span.style.forcedColorAdjust = "none";
      if (validating) {
        const parent = doc.createElement("div");
        parent.style.color = i % 2 ? "#040506" : "#010203";
        parent.style.forcedColorAdjust = "none";
        parent.appendChild(span);
      }
    }
    if (validating) span.style.color = "";
    span.style.color = expressions[i]!;
    b.appendChild(validating ? span.parentElement! : span);
  }
  el.appendChild(b);
  try {
    const colors = new Array<string>(expressions.length);
    for (let i = 0; i < colors.length; i++) {
      const color = doc.defaultView!.getComputedStyle(pool[i]!).color;
      colors[i] = validating ? color : normalizeColor(color, doc);
    }
    return colors;
  } finally {
    b.remove();
    b.replaceChildren();
  }
}

function validColors(el: HTMLElement, expressions: readonly (string | null)[]): boolean[] {
  const values = probeColors(
    el,
    expressions.flatMap((e) => (e === null ? [] : [e, e])),
    true,
  );
  let i = 0;
  return expressions.map(
    (e) => e === null || values[i++] === values[i++] || /^currentcolor$/i.test(e),
  );
}

const normalizeColor = (val: string, doc: Document): string =>
  val && !parseColor(val) ? canvasColor(val, doc) : val;
const concreteColor = (val: string, doc: Document): Rgba | null =>
  parseColor(val) ?? (val ? parseColor(canvasColor(val, doc)) : null);

function canvasColor(value: string, doc: Document): string {
  const c = doc.createElement("canvas");
  c.width = c.height = 1;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return value;
  ctx.fillStyle = "#010203";
  ctx.fillStyle = value;
  if (ctx.fillStyle === "#010203") return value;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return `rgba(${d[0]}, ${d[1]}, ${d[2]}, ${Math.round((d[3]! / 255) * 1000) / 1000})`;
}
