/**
 * Browser entry for the render and theme tests. Builds Scenes by hand (no scene builder is involved) and
 * exposes small operations on `window.axr`; the tests take screenshots and sample pixels.
 */
import type { Mark, MarkRenderer, MarkerShape, Overlay, Paint, PlacedText, Scene } from '../../../../src/core/contracts';
import { createSvgRenderer } from '../../../../src/render/svg';
import { createTextLayer, type TextLayer } from '../../../../src/render/text';
import { AXYLO_CSS } from '../../../../src/theme/css';
import { lowContrastSeries } from '../../../../src/theme/color';
import { resolveTheme, type ThemeResolution } from '../../../../src/theme/resolve';
import { ensureStyles } from '../../../../src/theme/styles';
import { watchTheme } from '../../../../src/theme/watch';
import type { AxrApi, MountOptions, ResolveInfo, SceneName, TextProbe, TextSpec } from './api';

const S = (index: number): Paint => ({ kind: 'series', index });
const T = (name: 'axis' | 'grid' | 'reference' | 'muted' | 'focus' | 'background' | 'text'): Paint => ({ kind: 'token', name });
const SHAPES: readonly MarkerShape[] = ['circle', 'square', 'triangle', 'diamond', 'cross', 'plus', 'triangle-down', 'star'];
const CLIP = { x: 40, y: 20, width: 340, height: 240 };
const TAU = Math.PI * 2;

/** The fixed test scene, 400 × 300 CSS px. Every coordinate here is quoted by the tests. */
export function fixedScene(pathShift = 0): Scene {
  const marks: Mark[] = [
    { type: 'band', box: { x: 60, y: 30, width: 40, height: 230 }, fill: T('reference'), opacity: 0.15 },
    // Grid rule reaching outside the clip on both sides: only 40–380 may show.
    { type: 'rule', x1: 10, y1: 110, x2: 390, y2: 110, stroke: T('grid'), strokeWidth: 1, dash: null, role: 'grid' },
    {
      type: 'area', series: 1, fill: S(1), opacity: 0.5,
      upper: Float32Array.of(50, 150, 80, 140, 110, 150, 130, 150, 150, 145, 170, 150),
      lower: Float32Array.of(50, 200, 110, 200, 130, 200, 170, 200),
      runs: Uint32Array.of(0, 3, 0, 2, 3, 3, 2, 2),
    },
    {
      // Three segments, one pen lift; the last segment runs past the clip's right edge (380).
      type: 'path', series: 0, stroke: S(0), strokeWidth: 3, dash: { normal: null, contrast: [6, 4] },
      xy: Float32Array.of(50, 50 + pathShift, 120, 50 + pathShift, 120, 100, NaN, NaN, 160, 120, 395, 120),
    },
    { type: 'rects', series: 2, fill: S(2), variant: 'bar', xywh: Float32Array.of(200, 180, 20, 80, 230, 140, 20, 120) },
    // The third slot (260–280) has no data; the fourth (290–310) is left empty for comparison.
    { type: 'rects', series: 2, fill: S(2), variant: 'missing', xywh: Float32Array.of(260, 252, 20, 8) },
    ...SHAPES.map((shape, k): Mark => ({ type: 'points', series: 3, shape, size: 10, fill: S(3), xy: Float32Array.of(50 + 20 * k, 235) })),
    {
      type: 'arcs', cx: 300, cy: 60, r0: 25, r1: 40, gap: 4,
      angles: Float32Array.of(0, Math.PI / 2, Math.PI / 2, Math.PI, Math.PI, 1.5 * Math.PI, 1.5 * Math.PI, 2 * Math.PI),
      fills: [S(4), S(5), S(6), S(7)],
    },
    // The x axis lies on the clip's bottom edge (y 260), i.e. outside it, and must still be drawn.
    { type: 'rule', x1: 40, y1: 260, x2: 380, y2: 260, stroke: T('axis'), strokeWidth: 1, dash: null, role: 'axis' },
    { type: 'rule', x1: 40, y1: 20, x2: 40, y2: 260, stroke: T('axis'), strokeWidth: 1, dash: null, role: 'axis' },
    { type: 'rule', x1: 200, y1: 260, x2: 200, y2: 268, stroke: T('axis'), strokeWidth: 1, dash: null, role: 'tick' },
  ];
  return { width: 400, height: 300, clip: CLIP, marks };
}

function lineScene(vertices: number, width = 400, height = 300): Scene {
  const xy = new Float32Array(vertices * 2);
  // Starts a quarter down, away from the axis rule at mid-height that the tests sample.
  let y = height / 4;
  let seed = 12345;
  for (let i = 0; i < vertices; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    y = Math.min(height - 10, Math.max(10, y + ((seed / 4294967296) - 0.5) * 6));
    xy[2 * i] = (i / Math.max(1, vertices - 1)) * width;
    xy[2 * i + 1] = y;
  }
  return {
    width, height, clip: { x: 0, y: 0, width, height },
    marks: [
      { type: 'path', series: 0, stroke: S(0), strokeWidth: 1.5, dash: { normal: null, contrast: null }, xy },
      { type: 'rule', x1: 0, y1: Math.round(height / 2), x2: width, y2: Math.round(height / 2), stroke: T('axis'), strokeWidth: 1, dash: null, role: 'axis' },
    ],
  };
}

const plain = (marks: Mark[]): Scene => ({ width: 400, height: 300, clip: CLIP, marks });

/** Named scenes used by the review tests; coordinates are quoted there. */
function namedScene(name: SceneName, options: MountOptions): Scene {
  switch (name) {
    case 'fixed': return fixedScene();
    case 'line': return lineScene(options.vertices ?? 1000, options.width, options.height);
    case 'markers':
      return plain(SHAPES.map((shape, k): Mark => ({ type: 'points', series: 0, shape, size: 24, fill: S(0), xy: Float32Array.of(60 + 42 * k, 150) })));
    case 'ring':
      return plain([
        // A 99.9 % slice and its tiny neighbour, gap 1 (finding 1).
        { type: 'arcs', cx: 260, cy: 150, r0: 25, r1: 40, gap: 1, angles: Float32Array.of(0, 0.999 * TAU, 0.999 * TAU, TAU), fills: [S(0), S(1)] },
        // One full turn that does not start at 12 o'clock, as Float32.
        { type: 'arcs', cx: 120, cy: 150, r0: 25, r1: 40, gap: 1, angles: Float32Array.of(0.3, 0.3 + TAU), fills: [S(2)] },
      ]);
    case 'negative':
      return plain([
        // All-negative vertical chart: zero is the top of the clip (y 20). All-negative horizontal: zero is the right edge (x 380).
        { type: 'rects', series: 0, fill: S(0), variant: 'missing', xywh: Float32Array.of(100, 20, 20, 0) },
        { type: 'rects', series: 0, fill: S(0), variant: 'missing', xywh: Float32Array.of(380, 150, 0, 20) },
      ]);
    case 'overlap':
      return plain([
        // Two coincident rectangles, and the same rectangle written once with a negative width.
        { type: 'rects', series: 0, fill: S(0), variant: 'bar', xywh: Float32Array.of(100, 100, 50, 50, 100, 100, 50, 50) },
        { type: 'rects', series: 0, fill: S(0), variant: 'bar', xywh: Float32Array.of(250, 100, -50, 50, 200, 100, 50, 50) },
      ]);
    case 'dash':
      return plain([{ type: 'path', series: 0, stroke: S(0), strokeWidth: 2, dash: { normal: [8, 3], contrast: [2, 2] }, xy: Float32Array.of(50, 150, 370, 150) }]);
    case 'mixed':
      return plain([
        { type: 'points', series: 1, shape: 'square', size: 12, fill: S(1), xy: Float32Array.of(80, 80) },
        { type: 'rule', x1: 40, y1: 200, x2: 380, y2: 200, stroke: T('axis'), strokeWidth: 1, dash: null, role: 'axis' },
        { type: 'band', box: { x: 200, y: 50, width: 60, height: 60 }, fill: S(2), opacity: 1 },
        { type: 'rects', series: 3, fill: S(3), variant: 'bar', xywh: Float32Array.of(300, 150, 20, 50) },
      ]);
    case 'pattern':
      // Same color four times: plain, then the three F9 patterns (spec F9's second cue).
      return plain([
        { type: 'rects', series: 0, fill: S(0), variant: 'bar', xywh: Float32Array.of(60, 60, 60, 180) },
        { type: 'rects', series: 0, fill: S(0), variant: 'bar', pattern: 'diagonal', xywh: Float32Array.of(140, 60, 60, 180) },
        { type: 'rects', series: 0, fill: S(0), variant: 'bar', pattern: 'cross', xywh: Float32Array.of(220, 60, 60, 180) },
        { type: 'rects', series: 0, fill: S(0), variant: 'bar', pattern: 'dots', xywh: Float32Array.of(300, 60, 60, 180) },
      ]);
    case 'short':
      return plain([{ type: 'band', box: { x: 100, y: 100, width: 40, height: 40 }, fill: S(4), opacity: 1 }]);
  }
}

interface Mounted {
  readonly root: HTMLDivElement;
  readonly renderer: MarkRenderer;
  readonly keys: readonly string[];
  readonly colors: Readonly<Record<string, string>> | undefined;
  scene: Scene;
  draws: number;
}

const mounts: Mounted[] = [];
const DEFAULT_KEYS = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7'];

function makeRoot(left: number, top: number, width = 400, height = 300, parent: Element | ShadowRoot = document.body): HTMLDivElement {
  const root = document.createElement('div');
  root.className = 'axylo';
  for (const [k, v] of [['position', 'absolute'], ['left', `${left}px`], ['top', `${top}px`], ['width', `${width}px`], ['height', `${height}px`]]) root.style.setProperty(k!, v!);
  parent.appendChild(root);
  return root;
}

function draw(m: Mounted): void {
  const { bindings } = resolveTheme(m.root, m.keys, m.colors);
  m.renderer.draw(m.scene, bindings, window.devicePixelRatio);
  m.draws++;
}

function info(r: ThemeResolution, root: Element | null): ResolveInfo {
  return {
    theme: r.theme, bindings: r.bindings, attribute: root?.getAttribute('data-axylo-scheme') ?? null,
    resolved: r.resolved, backdropKnown: r.backdropKnown, invalidColors: r.invalidColors, lowContrast: lowContrastSeries(r.theme),
  };
}

let stopWatch: (() => void)[] = [];
let fired = 0;

let text: { layer: TextLayer; root: HTMLDivElement; specs: TextSpec[]; texts: PlacedText[] } | null = null;

/**
 * A label's box from canvas metrics of the layer's own computed font and spacing: the independent
 * expectation layout would produce.
 */
function placed(spec: TextSpec, layer: HTMLElement): PlacedText {
  const cs = getComputedStyle(layer);
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const spacing = (v: string): string => (v === 'normal' ? '0px' : v);
  ctx.letterSpacing = spacing(cs.letterSpacing) as typeof ctx.letterSpacing;
  ctx.wordSpacing = spacing(cs.wordSpacing) as typeof ctx.wordSpacing;
  const lineHeight = cs.lineHeight === 'normal' ? parseFloat(cs.fontSize) * 1.2 : parseFloat(cs.lineHeight);
  const { lines, x, y, anchor, baseline, rotate } = spec;
  const w = Math.max(...lines.map(l => ctx.measureText(l).width));
  const h = lines.length * lineHeight;
  const ax = anchor === 'start' ? 0 : anchor === 'middle' ? w / 2 : w;
  const ay = baseline === 'top' ? 0 : baseline === 'middle' ? h / 2 : h;
  const a = (rotate * Math.PI) / 180;
  const xs: number[] = [], ys: number[] = [];
  for (const [cx, cy] of [[-ax, -ay], [w - ax, -ay], [w - ax, h - ay], [-ax, h - ay]] as const) {
    xs.push(x + cx * Math.cos(a) - cy * Math.sin(a));
    ys.push(y + cx * Math.sin(a) + cy * Math.cos(a));
  }
  const box = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  return { lines, full: lines.join(' '), x, y, anchor, baseline, rotate, role: 'tick-x', box };
}

function measure(): TextProbe[] {
  const t = text!;
  const origin = t.root.getBoundingClientRect();
  return Array.from(t.layer.element.children).map((el, i) => {
    const r = el.getBoundingClientRect();
    const h = el as HTMLElement;
    return {
      box: t.texts[i]!.box,
      rect: { x: r.x - origin.x, y: r.y - origin.y, width: r.width, height: r.height },
      overflow: h.scrollWidth > h.clientWidth + 1 || h.scrollHeight > h.clientHeight + 1,
    };
  });
}

function mountTextSpecs(left: number, top: number, specs: readonly TextSpec[], font = '14px/18px sans-serif'): TextProbe[] {
  ensureStyles(document);
  const root = makeRoot(left, top);
  root.style.setProperty('font', font);
  const layer = createTextLayer();
  root.appendChild(layer.element);
  const texts = specs.map(s => placed(s, layer.element));
  layer.render(texts);
  text = { layer, root, specs: [...specs], texts };
  return measure();
}

const frames = (n: number): Promise<void> => new Promise(resolve => {
  const step = (k: number): void => { if (k === 0) resolve(); else requestAnimationFrame(() => step(k - 1)); };
  step(n);
});

const api: AxrApi = {
  css: AXYLO_CSS,
  ensureStyles(): number {
    ensureStyles(document);
    return document.adoptedStyleSheets.length;
  },
  mount(left: number, top: number, options: MountOptions = {}): number {
    ensureStyles(document);
    const parent = options.parent ? document.querySelector(options.parent)! : document.body;
    const scene = namedScene(options.scene ?? 'fixed', options);
    const root = makeRoot(left, top, scene.width, scene.height, parent);
    for (const [k, v] of Object.entries(options.style ?? {})) root.style.setProperty(k, v);
    const renderer = createSvgRenderer();
    root.appendChild(renderer.element);
    const m: Mounted = { root, renderer, keys: options.keys ?? DEFAULT_KEYS, colors: options.colors, scene, draws: 0 };
    mounts.push(m);
    draw(m);
    return mounts.length - 1;
  },
  redraw(id: number): void { draw(mounts[id]!); },
  drawScene(id: number, scene: SceneName): void {
    const m = mounts[id]!;
    m.scene = namedScene(scene, {});
    draw(m);
  },
  draws: (id: number): number => mounts[id]!.draws,
  theme(id: number) {
    const m = mounts[id]!;
    const r = resolveTheme(m.root, m.keys, m.colors);
    return { theme: r.theme, bindings: r.bindings, attribute: m.root.getAttribute('data-axylo-scheme') };
  },
  info(id: number): ResolveInfo {
    const m = mounts[id]!;
    return info(resolveTheme(m.root, m.keys, m.colors), m.root);
  },
  detached(): ResolveInfo {
    const el = document.createElement('div');
    el.className = 'axylo';
    return info(resolveTheme(el, ['a', 'b'], { b: 'rgb(10, 20, 30)' }), el);
  },
  move(id: number, parent: string): void { document.querySelector(parent)!.appendChild(mounts[id]!.root); },
  svgDash(id: number): string {
    const el = mounts[id]!.root.querySelector('.axylo-dashed');
    return el === null ? 'missing' : getComputedStyle(el).strokeDasharray;
  },
  svgReuse(id: number) {
    const m = mounts[id]!;
    const group = m.root.querySelector('.axylo-scene')!;
    const before = Array.from(group.children);
    const pathBefore = group.querySelector('path.axylo-dashed')!.getAttribute('d');
    m.scene = fixedScene(5);
    draw(m);
    const after = Array.from(group.children);
    const pathAfter = group.querySelector('path.axylo-dashed')!.getAttribute('d');
    m.scene = fixedScene();
    draw(m);
    return { sameNodes: before.length === after.length && before.every((el, i) => el === after[i]), dChanged: pathBefore !== pathAfter, count: after.length };
  },
  svgTags: (id: number): string[] => Array.from(mounts[id]!.root.querySelector('.axylo-scene')!.children, el => el.tagName),
  async mutationsOnRedraw(id: number): Promise<number> {
    const m = mounts[id]!;
    let count = 0;
    const observer = new MutationObserver(list => { count += list.length; });
    observer.observe(m.renderer.element, { attributes: true, subtree: true, childList: true, characterData: true });
    draw(m);
    await Promise.resolve();
    count += observer.takeRecords().length;
    observer.disconnect();
    return count;
  },
  overlay(id: number, on: boolean): void {
    const m = mounts[id]!;
    const { bindings } = resolveTheme(m.root, m.keys, m.colors);
    const overlay: Overlay = {
      clip: m.scene.clip,
      // A cursor rule at x = 330 running past the clip (must stop at 260), a focus square that is not
      // clipped, and a highlighted point in series 1's color.
      clipped: [
        { type: 'rule', x1: 330, y1: 0, x2: 330, y2: 300, stroke: T('focus'), strokeWidth: 2, dash: null, role: 'cursor' },
        { type: 'points', series: 0, shape: 'circle', size: 10, fill: S(0), xy: Float32Array.of(355, 230) },
      ],
      unclipped: [{ type: 'points', series: 0, shape: 'square', size: 8, fill: T('focus'), xy: Float32Array.of(20, 280) }],
    };
    m.renderer.drawOverlay(on ? overlay : null, bindings, window.devicePixelRatio);
  },
  svgOverlayCount: (id: number): number => mounts[id]!.root.querySelector('.axylo-overlay')!.childElementCount,
  watch(): void {
    const first = mounts[0];
    if (!first) return;
    stopWatch.push(watchTheme(first.root, () => {
      fired++;
      for (const mount of mounts) resolveTheme(mount.root, mount.keys, mount.colors);
    }));
  },
  stopWatch(): void { for (const s of stopWatch) s(); stopWatch = []; },
  fired: (): number => fired,
  mountText(left: number, top: number): TextProbe[] {
    return mountTextSpecs(left, top, [
      { lines: ['Jan 2026'], x: 200, y: 100, anchor: 'end', baseline: 'middle', rotate: -45 },
      { lines: ['North America', 'and Europe'], x: 100, y: 200, anchor: 'middle', baseline: 'top', rotate: 0 },
      { lines: ['1,250 kWh'], x: 380, y: 50, anchor: 'end', baseline: 'middle', rotate: 0 },
      { lines: ['Sessions per day'], x: 20, y: 150, anchor: 'middle', baseline: 'bottom', rotate: -90 },
    ]);
  },
  mountTextSpecs,
  relayoutText(): TextProbe[] {
    const t = text!;
    t.texts = t.specs.map(s => placed(s, t.layer.element));
    t.layer.render(t.texts);
    return measure();
  },
  measureText: (): TextProbe[] => measure(),
  textReuse() {
    const t = text!;
    const before = Array.from(t.layer.element.querySelectorAll('div'));
    t.layer.render(t.texts);
    const after = Array.from(t.layer.element.querySelectorAll('div'));
    const markup = createTextLayer();
    markup.render([{ ...t.texts[2]!, lines: ['<b>bold</b> & <img src=x>'] }]);
    const inert = markup.element.querySelector('b, img') === null && markup.element.textContent === '<b>bold</b> & <img src=x>';
    return { sameNodes: before.length === after.length && before.every((el, i) => el === after[i]), markupInert: inert };
  },
  async loadFont(family: string, base64: string): Promise<boolean> {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const face = new FontFace(family, bytes.buffer);
    await face.load();
    document.fonts.add(face);
    await document.fonts.ready;
    return document.fonts.check(`14px "${family}"`);
  },
  setRootStyle(id: number, name: string, value: string): void { mounts[id]!.root.style.setProperty(name, value); },
  frames,
  shadowMount(left: number, top: number) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    (ensureStyles as (root: Document | ShadowRoot) => void)(shadow);
    const root = makeRoot(left, top, 400, 300, shadow);
    const renderer = createSvgRenderer();
    root.appendChild(renderer.element);
    const keys = DEFAULT_KEYS;
    const m: Mounted = { root, renderer, keys, colors: undefined, scene: fixedScene(), draws: 0 };
    mounts.push(m);
    draw(m);
    return {
      position: getComputedStyle(renderer.element).position,
      adoptedInShadow: shadow.adoptedStyleSheets.length,
      adoptedInDocument: document.adoptedStyleSheets.length,
    };
  },
  ensureStylesWithoutAdoption() {
    // Simulate an engine without constructable or adopted stylesheets.
    delete (Document.prototype as { adoptedStyleSheets?: unknown }).adoptedStyleSheets;
    delete (ShadowRoot.prototype as { adoptedStyleSheets?: unknown }).adoptedStyleSheets;
    ensureStyles(document);
    const first = document.querySelectorAll('style').length;
    ensureStyles(document);
    const second = document.querySelectorAll('style').length;
    const root = makeRoot(0, 0);
    const svg = createSvgRenderer();
    root.appendChild(svg.element);
    const probe = document.createElement('div');
    probe.className = 'axylo-text';
    root.appendChild(probe);
    return { styleElements: first, second, position: getComputedStyle(probe).position };
  },
};

window.axr = api;
