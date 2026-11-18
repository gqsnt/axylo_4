/**
 * Shared setup for the browser acceptance suite. Pages come from the existing harness (development
 * bundle, `chartPage`) or from `prod.html` in this directory (the minified production bundle). Charts are
 * created through the public API with the hand-written fixtures in `fixtures.ts`; the accessibility tree is
 * read from Chrome itself through the DevTools protocol (roles, names, descriptions, states), never from the
 * attributes the code sets, except where a comment says Chrome cannot report the property.
 *
 * THIS SUITE IS EVIDENCE FOR THE SVG RENDERER ONLY. It locates marks by reading the SVG DOM (paths, rects,
 * their colour slots) before sampling their pixels, so it says nothing about the canvas renderer, and it
 * refuses to run when `AXYLO_RENDERER=canvas` is set rather than report SVG results under a canvas run.
 *
 * Every checker the suite leans on (separators, painted colour, text overlap, table comparison, the focused
 * range, tooltip occlusion, motion, reference marks, dense columns) has a negative control in
 * `negative-controls.browser.test.ts` that breaks the behaviour from the test side and requires the
 * checker to report it.
 */
import type { Page } from 'playwright-core';
import { ENGINE, openPage, requireEngineFeature, url } from '../harness';

export { ENGINE, requireEngineFeature };

/** Why a test that reads Chrome's computed accessibility tree is not run on another engine. */
export const AX_TREE_REASON = "the browser's own computed accessibility tree (roles, names, descriptions, states) is read through the Chrome DevTools protocol; Playwright offers no engine-neutral equivalent (its aria snapshot is its own computation and carries no descriptions)";
import { chartPage, RENDERER } from '../chart/util';

if (RENDERER === 'canvas') {
  throw new Error('The browser acceptance suite reads the SVG DOM and is evidence for the SVG renderer only; it does not run with AXYLO_RENDERER=canvas.');
}
import { decodePng, type Image } from '../render/png';
import { type ChartType, optionsFor, type Variant } from './fixtures';

export { closePage, at, diff, shot } from '../chart/util';
export type { Image };

/** The two elements around every chart, so the tab order can be walked from and to the page. */
/** Why a test that drives the screen with more than one touch point, or drags a finger, is not run off Chromium. */
export const TOUCH_INPUT_REASON = "multi-point and moving touch input is dispatched through the Chrome DevTools protocol (Input.dispatchTouchEvent); Playwright's engine-neutral touchscreen only taps";
export const SHOW_BUTTONS = '#before, #after { display: inline-block !important; }';

export interface Built {
  diagnostics: { code: string; level: string; message: string }[];
}

/** Development bundle page (`window.Axylo` from dist/axylo.iife.js), with `#before`, `#chart`, `#after`. */
export async function devPage(options: Parameters<typeof chartPage>[0] = {}): Promise<Page> {
  return chartPage({ ...options, css: `${SHOW_BUTTONS} ${options.css ?? ''}` });
}

/** Runs in the page: the same renderer switch chart/util.ts applies, for the production page. */
function selectRenderer(renderer: string): void {
  const original = (window as unknown as { Axylo: Record<string, unknown> }).Axylo;
  const wrapped: Record<string, unknown> = { ...original };
  for (const name of ['line', 'area', 'bar', 'scatter', 'donut']) {
    const make = original[name] as (target: unknown, options: Record<string, unknown>) => unknown;
    wrapped[name] = (target: unknown, options: Record<string, unknown>) => make(target, { __renderer: renderer, ...options });
  }
  (window as unknown as { Axylo: unknown }).Axylo = wrapped;
}

/** Production bundle page (dist/axylo.iife.min.js, `__DEV__` false): no test hooks on the handle. */
export async function prodPage(options: { css?: string; viewport?: { width: number; height: number } } = {}): Promise<Page> {
  const page = await openPage(options.viewport ? { viewport: options.viewport } : {});
  await page.goto(url('packages/axylo/test/browser/acceptance/prod.html'));
  if (RENDERER) await page.evaluate(selectRenderer, RENDERER);
  await page.evaluate(() => { (window as unknown as { nextFrames(n?: number): Promise<void> }).nextFrames = (n = 1) => new Promise(r => { let k = n; const f = () => (--k <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }); });
  await page.addStyleTag({ content: `${SHOW_BUTTONS} ${options.css ?? ''}` });
  return page;
}

/**
 * Creates a chart from the fixture of `type` (with `extra` merged over its options) in `target` and waits
 * until it has drawn. Works on both pages: in production there is no `__bench.ready`, so it waits for
 * frames until the figure exists.
 */
export async function create(page: Page, type: ChartType, extra: Record<string, unknown> = {}, target = '#chart', variant: Variant = 'default'): Promise<Built> {
  const { fn, options } = optionsFor(type, variant);
  return createRaw(page, fn, { ...options, ...extra }, target);
}

/** Creates a chart with options given in full. */
export async function createRaw(page: Page, fn: string, options: Record<string, unknown>, target = '#chart'): Promise<Built> {
  return page.evaluate(async ({ fn, options, target }) => {
    const w = window as unknown as {
      Axylo: Record<string, (t: unknown, o: unknown) => { diagnostics: Built['diagnostics']; __bench?: { ready(): Promise<void> } }>;
      charts: unknown[];
    };
    w.charts ??= [];
    // NaN does not survive the trip into the page as JSON; fixtures write it as '__NaN__'.
    const rows = (options as { data?: unknown }).data;
    if (Array.isArray(rows)) for (const row of rows) for (const k of Object.keys(row)) if (row[k] === '__NaN__') row[k] = NaN;
    const chart = w.Axylo[fn]!(target, options);
    w.charts.push(chart);
    const frame = () => new Promise(r => requestAnimationFrame(r));
    if (chart.__bench) await chart.__bench.ready();
    for (let i = 0; i < 3; i++) await frame();
    return { diagnostics: chart.diagnostics.map(d => ({ code: d.code, level: d.level, message: d.message })) };
  }, { fn, options, target });
}

/** Waits for every chart on the page to draw what it was last given, then one more frame. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const charts = (window as unknown as { charts: { __bench?: { ready(): Promise<void> } }[] }).charts ?? [];
    for (const c of charts) if (c.__bench) await c.__bench.ready();
    for (let i = 0; i < 2; i++) await new Promise(r => requestAnimationFrame(r));
  });
}

/** Calls a method on chart `index` in the page (`update`, `zoom`, `append`) and waits for it to draw. */
export async function call(page: Page, method: 'update' | 'zoom' | 'append', args: unknown[], index = 0): Promise<void> {
  await page.evaluate(({ method, args, index }) => {
    const charts = (window as unknown as { charts: Record<string, (...a: unknown[]) => void>[] }).charts;
    charts[index]![method]!(...args);
  }, { method, args, index });
  await settle(page);
}

// ── accessibility tree (Chrome's own, through the DevTools protocol) ───────────────────────────────

export interface AX {
  id: string;
  role: string;
  name: string;
  description: string;
  value: string;
  ignored: boolean;
  props: Record<string, unknown>;
  children: string[];
  backend: number | null;
}

interface RawAX {
  nodeId: string; ignored: boolean; role?: { value?: unknown }; name?: { value?: unknown }; description?: { value?: unknown };
  value?: { value?: unknown }; properties?: { name: string; value: { value?: unknown } }[]; childIds?: string[]; backendDOMNodeId?: number;
}

function toAX(n: RawAX): AX {
  const props: Record<string, unknown> = {};
  for (const p of n.properties ?? []) props[p.name] = p.value?.value;
  return {
    id: n.nodeId, role: String(n.role?.value ?? ''), name: String(n.name?.value ?? ''), description: String(n.description?.value ?? ''),
    value: String(n.value?.value ?? ''), ignored: n.ignored, props, children: n.childIds ?? [], backend: n.backendDOMNodeId ?? null,
  };
}

async function backendOf(page: Page, selector: string): Promise<number> {
  requireEngineFeature(['chromium'], AX_TREE_REASON);
  const client = await page.context().newCDPSession(page);
  try {
    const { root } = await client.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!nodeId) throw new Error(`no element for ${selector}`);
    const { node } = await client.send('DOM.describeNode', { nodeId });
    return node.backendNodeId;
  } finally {
    await client.detach();
  }
}

/** Chrome's accessibility node for the first element matching `selector`. */
export async function axOf(page: Page, selector: string): Promise<AX> {
  const backend = await backendOf(page, selector);
  const client = await page.context().newCDPSession(page);
  try {
    const { nodes } = await client.send('Accessibility.getPartialAXTree', { backendNodeId: backend, fetchRelatives: false });
    return toAX(nodes[0] as RawAX);
  } finally {
    await client.detach();
  }
}

/**
 * The accessibility nodes inside the element matching `selector` (the element's own node first), in tree
 * order, without ignored nodes: what an assistive technology can reach there.
 */
export async function axWithin(page: Page, selector = '#chart'): Promise<AX[]> {
  const backend = await backendOf(page, selector);
  const client = await page.context().newCDPSession(page);
  try {
    const { nodes } = await client.send('Accessibility.getFullAXTree');
    const all = new Map((nodes as RawAX[]).map(n => [n.nodeId, toAX(n)]));
    const start = [...all.values()].find(n => n.backend === backend);
    if (!start) return [];
    const out: AX[] = [];
    const visit = (id: string) => {
      const n = all.get(id);
      if (!n) return;
      if (!n.ignored) out.push(n);
      for (const c of n.children) visit(c);
    };
    visit(start.id);
    return out;
  } finally {
    await client.detach();
  }
}

/** The text an assistive technology finds inside `selector`: names and static text of unignored nodes. */
export async function axText(page: Page, selector = '#chart'): Promise<string> {
  const nodes = await axWithin(page, selector);
  return nodes.filter(n => n.role === 'StaticText').map(n => n.name).join(' • ');
}

/** The plot's range as the reader meets it: focus, Chrome's computed role and numbers, and its value text. */
export interface FocusedRange {
  /** The range is the document's active element. */
  focused: boolean;
  /** Chrome's computed role for it ('slider'), and whether Chrome exposes it at all. */
  role: string;
  ignored: boolean;
  /** Chrome's computed numeric value and bounds. */
  value: number;
  max: number;
  /**
   * DOM ATTRIBUTE, not the computed tree: `aria-valuetext`. Chrome's DevTools tree reports the range's
   * number as its value text (decision 0001), so the text is read from the attribute the platform tree is
   * built from. What a screen reader speaks from it is established only by rehearsal (spec A3).
   */
  text: string;
}

export async function readRange(page: Page, selector = '#chart'): Promise<FocusedRange> {
  const proxy = `${selector} .axylo-proxy`;
  const focused = await page.evaluate(sel => document.activeElement === document.querySelector(sel), proxy);
  if (ENGINE !== 'chromium') {
    // DOM, not a computed tree (other engines have no DevTools access to theirs): an <input type="range">
    // has the implicit role slider, it is exposed unless hidden or aria-hidden, and its value and bounds are
    // the element's own.
    const dom = await page.locator(proxy).evaluate(el => {
      const input = el as HTMLInputElement;
      const role = el.getAttribute('role') ?? (input.type === 'range' ? 'slider' : input.type === 'text' ? 'textbox' : input.type);
      const ignored = !!el.closest('[aria-hidden="true"], [hidden], [inert]') || getComputedStyle(el).display === 'none';
      return { role, ignored, value: Number(input.value), max: Number(input.max) };
    });
    return { focused, ...dom, text: (await page.locator(proxy).getAttribute('aria-valuetext')) ?? '' };
  }
  const ax = await axOf(page, proxy);
  return {
    focused, role: ax.role, ignored: ax.ignored, value: Number(ax.value), max: Number(ax.props.valuemax),
    text: (await page.locator(proxy).getAttribute('aria-valuetext')) ?? '',
  };
}

/**
 * The value text of the plot's range, after checking that the range has focus and that Chrome exposes it
 * as a slider: a stale proxy that lost focus cannot stand in for what the reader is on. `{ focused: false }`
 * reads it without focus (after a legend click, say), and says so at the call.
 */
export async function valueText(page: Page, selector = '#chart', options: { focused?: boolean } = {}): Promise<string> {
  const r = await readRange(page, selector);
  if (options.focused !== false && !r.focused) throw new Error(`the plot's range does not have focus (text: "${r.text}")`);
  if (r.ignored || r.role !== 'slider') throw new Error(`the plot's range is exposed as "${r.role}"${r.ignored ? ' (ignored)' : ''}, not a slider`);
  return r.text;
}

// ── focus and tab order ────────────────────────────────────────────────────────────────────────────

/** What has focus: 'proxy', 'toolbar:<label>', 'table', 'before', 'after', 'body' or tag.class. */
export async function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return 'body';
    if (el.id === 'before' || el.id === 'after') return el.id;
    if (el.classList.contains('axylo-proxy')) return 'proxy';
    if (el.closest('.axylo-toolbar')) return 'toolbar:' + (el.textContent ?? '');
    if (el.classList.contains('axylo-table-scroll')) return 'table';
    return el.tagName.toLowerCase() + '.' + el.className;
  });
}

/** Presses Tab (or Shift+Tab) from #before (or #after) until focus leaves the chart; lists every stop. */
export async function tabStops(page: Page, backwards = false): Promise<string[]> {
  await page.focus(backwards ? '#after' : '#before');
  const stops: string[] = [];
  for (let i = 0; i < 16; i++) {
    await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab');
    const at = await focused(page);
    stops.push(at);
    if (at === 'before' || at === 'after' || at === 'body') break;
  }
  return stops;
}

// ── geometry ───────────────────────────────────────────────────────────────────────────────────────

export interface Box { x: number; y: number; width: number; height: number }

export async function box(page: Page, selector: string): Promise<Box> {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`no box for ${selector}`);
  return b;
}

/** The plot area in viewport px (the keyboard proxy covers exactly it) and the drawn domains (dev only). */
export async function plotGeometry(page: Page, index = 0, selector = '#chart'): Promise<{ plot: Box; xDomain: number[] | null; yDomain: number[] | null }> {
  return page.evaluate(({ index, selector }) => {
    const r = document.querySelector(`${selector} .axylo-proxy`)!.getBoundingClientRect();
    const charts = (window as unknown as { charts: { __bench: { describe(): { xDomain: number[] | null; yDomain: number[] | null } } }[] }).charts;
    const { xDomain, yDomain } = charts[index]!.__bench.describe();
    return { plot: { x: r.x, y: r.y, width: r.width, height: r.height }, xDomain, yDomain };
  }, { index, selector });
}

export const intersects = (a: Box, b: Box, slack = 0): boolean =>
  a.x < b.x + b.width - slack && b.x < a.x + a.width - slack && a.y < b.y + b.height - slack && b.y < a.y + a.height - slack;

export const inside = (inner: Box, outer: Box, slack = 1): boolean =>
  inner.x >= outer.x - slack && inner.y >= outer.y - slack && inner.x + inner.width <= outer.x + outer.width + slack && inner.y + inner.height <= outer.y + outer.height + slack;

// ── pixels and colour ──────────────────────────────────────────────────────────────────────────────

/**
 * A screenshot of `selector`'s box as painted. Animations are left running (Playwright's default), so a
 * transition the library starts is captured as it is, never fast-forwarded to its end.
 */
export async function screenshot(page: Page, selector: string, clip?: Box): Promise<{ img: Image; box: Box; scale: number }> {
  const b = clip ?? await box(page, selector);
  const img = decodePng(await page.screenshot({ clip: b, animations: 'allow', caret: 'hide' }));
  return { img, box: b, scale: img.width / b.width };
}

export type RGB = readonly [number, number, number];

/** Resolves any CSS colour the page understands to sRGB bytes, in the page. */
export async function resolveColors(page: Page, colors: readonly string[]): Promise<RGB[]> {
  return page.evaluate(colors => colors.map(c => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0]!, d[1]!, d[2]!] as const;
  }), colors as string[]) as Promise<RGB[]>;
}

/** WCAG 2.x relative luminance and contrast. */
export function luminance([r, g, b]: RGB): number {
  const f = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function contrast(a: RGB, b: RGB): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The colour the marks are painted with, resolved in the page from the rendered SVG element's `color`. */
export async function seriesColors(page: Page, selector = '#chart'): Promise<RGB[]> {
  const css = await page.evaluate(selector => {
    const seen = new Map<number, string>();
    for (const el of document.querySelectorAll<SVGElement>(`${selector} svg.axylo-svg .axylo-scene *`)) {
      const m = /--axylo-series-color-(\d+)/.exec(el.style.getPropertyValue('color'));
      if (m && !seen.has(Number(m[1]))) seen.set(Number(m[1]), getComputedStyle(el).color);
    }
    return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]);
  }, selector);
  return resolveColors(page, css);
}

/**
 * The colour painted behind the marks: the chart's own background rect when it is opaque (an author's
 * `--axylo-background`), else the nearest ancestor background, else the canvas white.
 */
export async function backgroundColor(page: Page, selector = '#chart'): Promise<RGB> {
  const css = await page.evaluate(selector => {
    const opaque = (c: string) => !!c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c);
    const rect = document.querySelector(`${selector} svg.axylo-svg .axylo-background`) as SVGElement | null;
    if (rect) {
      // The background rect is painted through `color` and currentColor, like every mark (render/svg.ts).
      const s = getComputedStyle(rect);
      if (opaque(s.color)) return s.color;
    }
    let el: Element | null = document.querySelector(selector);
    while (el) {
      const c = getComputedStyle(el).backgroundColor;
      if (opaque(c)) return c;
      el = el.parentElement;
    }
    return 'rgb(255, 255, 255)';
  }, selector);
  return (await resolveColors(page, [css]))[0]!;
}

/**
 * The default background of the scheme the chart resolved: `--axylo-default-background` as the marks
 * inherit it (read on the mark layer, wherever the library puts the scheme switch).
 */
export async function defaultBackground(page: Page, selector = '#chart'): Promise<RGB> {
  const css = await page.evaluate(selector => {
    const at = document.querySelector(`${selector} figure`) ?? document.querySelector(selector)!;
    // Resolved in place (the token may be a light-dark() pair that depends on the chart's scheme).
    const probe = document.createElement('div');
    probe.style.background = 'var(--axylo-default-background)';
    at.appendChild(probe);
    const c = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return c;
  }, selector);
  return (await resolveColors(page, [css]))[0]!;
}

export function pixel(img: Image, x: number, y: number): RGB {
  const o = (Math.floor(y) * img.width + Math.floor(x)) * 4;
  return [img.data[o]!, img.data[o + 1]!, img.data[o + 2]!];
}

export const distance = (a: RGB, b: RGB): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

/** Pixels within `tolerance` of `color` in a region of `img`. */
export function countColor(img: Image, color: RGB, tolerance = 30, region?: { x0: number; y0: number; x1: number; y1: number }): number {
  const { x0 = 0, y0 = 0, x1 = img.width, y1 = img.height } = region ?? {};
  let n = 0;
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(img.height, y1); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(img.width, x1); x++) if (distance(pixel(img, x, y), color) <= tolerance) n++;
  }
  return n;
}

// ── marks as drawn (SVG renderer), to locate a datum on screen ─────────────────────────────────────

export interface Shape {
  /** Viewport box of one closed subpath or rect. */
  box: Box;
  /** The command letters of the subpath ("MAAZ" for a circle, "MLLLZ" for a square). */
  commands: string;
  /** The subpath's own path data ('rect' for a rect), for `signature`. */
  sub: string;
}

/**
 * A shape's identity independent of size and position: its commands and its vertices scaled to the larger
 * side of its box, rounded. A circle, a square, a diamond and a triangle each give a different signature.
 */
export function signature(sub: string): string {
  if (sub === 'rect') return 'rect';
  // Arcs: a round marker, whatever points its path happens to pass through.
  if (/A/i.test(sub)) return 'round';
  const tokens = sub.match(/[MLAZHV]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  const pts: [number, number][] = [];
  let cmds = '';
  let cmd = '';
  for (let i = 0; i < tokens.length;) {
    const t = tokens[i]!;
    if (/^[A-Za-z]$/.test(t)) { cmd = t.toUpperCase(); cmds += cmd; i++; continue; }
    if (cmd === 'A') { pts.push([Number(tokens[i + 5]), Number(tokens[i + 6])]); i += 7; }
    else if (cmd === 'M' || cmd === 'L') { pts.push([Number(tokens[i]), Number(tokens[i + 1])]); i += 2; }
    else i++;
  }
  const x0 = Math.min(...pts.map(p => p[0])), y0 = Math.min(...pts.map(p => p[1]));
  const size = Math.max(Math.max(...pts.map(p => p[0])) - x0, Math.max(...pts.map(p => p[1])) - y0) || 1;
  // Sorted and unique, so where a shape's path starts does not matter.
  const vertices = [...new Set(pts.map(([x, y]) => `${Math.round(4 * (x - x0) / size)},${Math.round(4 * (y - y0) / size)}`))].sort();
  return cmds.replace(/Z/g, '').replace(/L+/g, 'L').replace(/A+/g, 'A') + ':' + vertices.join(' ');
}

/**
 * Per series colour slot (1-based, from `--axylo-series-color-N`), the small closed shapes drawn in that
 * colour: markers on lines and areas, scatter points, bar rects. Shapes larger than `maxSize` px (an area's
 * fill, a line's stroke) are left out.
 */
export async function shapes(page: Page, selector = '#chart', maxSize = 20): Promise<Record<number, Shape[]>> {
  return page.evaluate(({ selector, maxSize }) => {
    const svg = document.querySelector(`${selector} svg.axylo-svg`) as SVGSVGElement | null;
    const out: Record<number, { box: { x: number; y: number; width: number; height: number }; commands: string; sub: string }[]> = {};
    if (!svg) return out;
    const origin = svg.getBoundingClientRect();
    const matrix = svg.getScreenCTM();
    const toPage = (x: number, y: number) => {
      if (!matrix) return { x: origin.x + x, y: origin.y + y };
      const p = new DOMPoint(x, y).matrixTransform(matrix);
      return { x: p.x, y: p.y };
    };
    const slotOf = (el: Element | null): number | null => {
      for (let e = el; e && e !== svg; e = e.parentElement) {
        const m = /--axylo-series-color-(\d+)/.exec((e as SVGElement).style?.getPropertyValue('color') ?? '');
        if (m) return Number(m[1]);
      }
      return null;
    };
    for (const el of svg.querySelectorAll('.axylo-scene path, .axylo-scene rect')) {
      const slot = slotOf(el);
      if (slot === null) continue;
      const list = (out[slot] ??= []);
      if (el.tagName.toLowerCase() === 'rect') {
        const r = el as SVGRectElement;
        const a = toPage(r.x.baseVal.value, r.y.baseVal.value);
        const b = toPage(r.x.baseVal.value + r.width.baseVal.value, r.y.baseVal.value + r.height.baseVal.value);
        const rb = { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
        // A patterned bar is drawn twice (colour, then pattern on top): one mark.
        if (!list.some(o => o.sub === 'rect' && Math.abs(o.box.x - rb.x) < 0.01 && Math.abs(o.box.y - rb.y) < 0.01 && Math.abs(o.box.width - rb.width) < 0.01 && Math.abs(o.box.height - rb.height) < 0.01)) list.push({ box: rb, commands: 'rect', sub: 'rect' });
        continue;
      }
      const d = el.getAttribute('d') ?? '';
      for (const sub of d.split(/(?=M)/)) {
        const tokens = sub.match(/[MLAZHV]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
        let commands = '';
        const xs: number[] = [];
        const ys: number[] = [];
        let cmd = '';
        for (let i = 0; i < tokens.length;) {
          const t = tokens[i]!;
          if (/^[A-Za-z]$/.test(t)) { cmd = t.toUpperCase(); commands += cmd; i++; if (cmd === 'Z') continue; }
          if (cmd === 'A') { xs.push(Number(tokens[i + 5])); ys.push(Number(tokens[i + 6])); i += 7; }
          else if (cmd === 'M' || cmd === 'L') { xs.push(Number(tokens[i])); ys.push(Number(tokens[i + 1])); i += 2; }
          else i++;
        }
        if (!xs.length) continue;
        const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
        const a = toPage(x0, y0);
        const b = toPage(x1, y1);
        const w = b.x - a.x, h = b.y - a.y;
        if (w > maxSize || h > maxSize) continue;
        // A circle's subpath records only the two ends of a horizontal diameter: widen it to the disc.
        const round = commands.includes('A') && h < w / 2;
        list.push({ box: round ? { x: a.x, y: a.y - w / 2, width: w, height: w } : { x: a.x, y: a.y, width: w, height: h }, commands, sub });
      }
    }
    return out;
  }, { selector, maxSize });
}

export const center = (b: Box): { x: number; y: number } => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** A donut's ring in viewport px: centre and outer radius, from the union of the drawn slices' boxes. */
export async function ring(page: Page, selector = '#chart'): Promise<{ cx: number; cy: number; outer: number }> {
  return page.evaluate(selector => {
    const svg = document.querySelector(`${selector} svg.axylo-svg`) as SVGSVGElement;
    const m = svg.getScreenCTM()!;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const el of svg.querySelectorAll<SVGPathElement>('.axylo-scene path')) {
      // Slices only: arcs with an area (an empty path's box sits at the origin and would move the centre).
      if (!/A/.test(el.getAttribute('d') ?? '')) continue;
      const b = el.getBBox();
      if (b.width < 1 || b.height < 1) continue;
      const a = new DOMPoint(b.x, b.y).matrixTransform(m), c = new DOMPoint(b.x + b.width, b.y + b.height).matrixTransform(m);
      x0 = Math.min(x0, a.x); y0 = Math.min(y0, a.y); x1 = Math.max(x1, c.x); y1 = Math.max(y1, c.y);
    }
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, outer: (x1 - x0) / 2 };
  }, selector);
}


// ── painted colour ─────────────────────────────────────────────────────────────────────────────────

/** The most frequent colour of the image pixels in a region (image px): the backdrop of a mostly empty area. */
export function modeColor(img: Image, region: { x0: number; y0: number; x1: number; y1: number }): { color: RGB; share: number; pixels: number } {
  const counts = new Map<number, number>();
  let n = 0;
  for (let y = Math.max(0, Math.floor(region.y0)); y < Math.min(img.height, Math.ceil(region.y1)); y++) {
    for (let x = Math.max(0, Math.floor(region.x0)); x < Math.min(img.width, Math.ceil(region.x1)); x++) {
      const [r, g, b] = pixel(img, x, y);
      const key = (r << 16) | (g << 8) | b;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      n++;
    }
  }
  let best = 0, count = 0;
  for (const [k, c] of counts) if (c > count) { best = k; count = c; }
  return { color: [(best >> 16) & 255, (best >> 8) & 255, best & 255], share: n ? count / n : 0, pixels: n };
}

/**
 * The colour painted inside a mark: the most frequent colour of its interior (viewport box, inset by `inset`
 * CSS px so anti-aliased edges are left out). `share` says how uniform the interior is.
 */
export function interiorColor(img: Image, view: Box, mark: Box, inset = 1): { color: RGB; share: number; pixels: number } {
  const s = img.width / view.width;
  return modeColor(img, { x0: (mark.x - view.x + inset) * s, y0: (mark.y - view.y + inset) * s, x1: (mark.x + mark.width - view.x - inset) * s, y1: (mark.y + mark.height - view.y - inset) * s });
}

// ── table comparison ─────────────────────────────────────────────────────────────────────────────────

export interface TableRead { name: string; headers: string[]; rows: { header: string; cells: string[] }[] }

/**
 * Differences between a table as read and the expected one: the column headers in order (each header must
 * contain its fragments in order, so a label and its unit stay together), then every row as its row header
 * followed by its cells, exactly and in order. Swapping two cells, or two headers, is a difference.
 */
export function compareTable(actual: TableRead, expected: { headers: string[][]; rows: string[][] }): string[] {
  const out: string[] = [];
  if (actual.headers.length !== expected.headers.length) out.push(`headers: ${JSON.stringify(actual.headers)} has ${actual.headers.length}, expected ${expected.headers.length}`);
  expected.headers.forEach((frag, i) => {
    const h = actual.headers[i] ?? '';
    let at = 0;
    for (const f of frag) { const k = h.indexOf(f, at); if (k < 0) { out.push(`header ${i + 1} "${h}" lacks ${JSON.stringify(frag)}`); break; } at = k + f.length; }
  });
  if (actual.rows.length !== expected.rows.length) out.push(`rows: ${actual.rows.length}, expected ${expected.rows.length}`);
  expected.rows.forEach((row, i) => {
    const a = actual.rows[i];
    const got = a ? [a.header, ...a.cells] : [];
    if (JSON.stringify(got) !== JSON.stringify(row)) out.push(`row ${i + 1}: ${JSON.stringify(got)} expected ${JSON.stringify(row)}`);
  });
  return out;
}

/** The table inside `selector` as Chrome exposes it: its name (the caption), column headers, and rows. */
export async function readTable(page: Page, selector = '#chart'): Promise<TableRead> {
  if (ENGINE !== 'chromium') {
    // DOM: the HTML table's own caption, header and body cells (another engine's computed table roles are
    // not reachable; the table's content is what A4 compares).
    return page.evaluate(sel => {
      const t = document.querySelector(`${sel} table`);
      if (!t) return { name: '', headers: [], rows: [] };
      return {
        name: t.querySelector('caption')?.textContent ?? '',
        headers: [...t.querySelectorAll('thead th')].map(h => h.textContent ?? ''),
        rows: [...t.querySelectorAll('tbody tr')].map(r => ({ header: r.querySelector('th')?.textContent ?? '', cells: [...r.querySelectorAll('td')].map(c => c.textContent ?? '') })),
      };
    }, selector);
  }
  const all = await axWithin(page, `${selector} table`).catch(() => [] as AX[]);
  const table = all.find(n => n.role === 'table');
  if (!table) return { name: '', headers: [], rows: [] };
  const byId = new Map(all.map(n => [n.id, n]));
  const kids = (n: AX): AX[] => n.children.map(c => byId.get(c)).filter((c): c is AX => !!c).flatMap(c => c.role === 'rowgroup' || c.role === 'generic' ? kids(c) : [c]);
  const headers: string[] = [];
  const rows: { header: string; cells: string[] }[] = [];
  for (const row of all.filter(n => n.role === 'row')) {
    const cells = kids(row);
    const head = cells.filter(c => c.role === 'columnheader');
    if (head.length) { headers.push(...head.map(c => c.name)); continue; }
    rows.push({ header: cells.find(c => c.role === 'rowheader')?.name ?? '', cells: cells.filter(c => c.role === 'cell' || c.role === 'gridcell').map(c => c.name) });
  }
  return { name: table.name, headers, rows };
}

// ── tooltip occlusion ────────────────────────────────────────────────────────────────────────────────

/** The marks a shown tooltip (or readout) box covers, by more than `slack` px; the list is empty when none. */
export function covered(tip: Box, marks: readonly Box[], slack = 0.5): Box[] {
  return marks.filter(m => intersects(tip, m, slack));
}

/** Waits for `n` animation frames in the page. */
export async function frames(page: Page, n = 1): Promise<void> {
  await page.evaluate(n => new Promise<void>(r => { let k = n; const f = () => (--k <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
}

/** The colour at an image pixel, as the 3×3 neighbourhood's most frequent colour (robust to one anti-aliased pixel). */
export function inkColorAt(img: Image, x: number, y: number): RGB {
  return modeColor(img, { x0: x - 1, y0: y - 1, x1: x + 2, y1: y + 2 }).color;
}

/**
 * Where every part of the figure sits (caption, body, plot, controls, note, readout strip), the floating
 * tooltip left out: equal strings mean nothing in the figure's flow moved.
 */
export async function figureLayout(page: Page, selector = '#chart'): Promise<string> {
  return page.evaluate(selector => [...document.querySelectorAll(`${selector} figure > *, ${selector} .axylo-body > *`)]
    .filter(e => !e.classList.contains('axylo-tooltip'))
    .map(e => { const r = e.getBoundingClientRect(); return `${e.className}:${r.x.toFixed(1)},${r.y.toFixed(1)},${r.width.toFixed(1)},${r.height.toFixed(1)}`; }).join('|'), selector);
}
