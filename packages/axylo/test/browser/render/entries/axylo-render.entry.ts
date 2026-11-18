/**
 * Browser entry for the render and theme tests. Builds a fixed Scene by hand (no scene builder exists yet)
 * and exposes small operations on `window.axr`; the tests take screenshots and sample pixels.
 */
import type { Mark, MarkRenderer, MarkerShape, Overlay, Paint, PlacedText, Scene } from '../../../../src/core/contracts';
import { createCanvasRenderer } from '../../../../src/render/canvas';
import { createSvgRenderer } from '../../../../src/render/svg';
import { createTextLayer, type TextLayer } from '../../../../src/render/text';
import { AXYLO_CSS } from '../../../../src/theme/css';
import { resolveTheme } from '../../../../src/theme/resolve';
import { ensureStyles } from '../../../../src/theme/styles';
import { watchTheme } from '../../../../src/theme/watch';
import type { AxrApi, MountOptions, RendererKind, TextProbe, WatchRecord } from './api';

const S = (index: number): Paint => ({ kind: 'series', index });
const T = (name: 'axis' | 'grid' | 'reference' | 'muted' | 'focus' | 'background' | 'text'): Paint => ({ kind: 'token', name });
const SHAPES: readonly MarkerShape[] = ['circle', 'square', 'triangle', 'diamond', 'cross', 'plus', 'triangle-down', 'star'];

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
  return { width: 400, height: 300, clip: { x: 40, y: 20, width: 340, height: 240 }, marks };
}

function lineScene(vertices: number): Scene {
  const xy = new Float32Array(vertices * 2);
  let y = 150;
  let seed = 12345;
  for (let i = 0; i < vertices; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    y = Math.min(290, Math.max(10, y + ((seed / 4294967296) - 0.5) * 6));
    xy[2 * i] = (i / Math.max(1, vertices - 1)) * 400;
    xy[2 * i + 1] = y;
  }
  return { width: 400, height: 300, clip: { x: 0, y: 0, width: 400, height: 300 }, marks: [{ type: 'path', series: 0, stroke: S(0), strokeWidth: 1.5, dash: { normal: null, contrast: null }, xy }] };
}

interface Mounted {
  readonly kind: RendererKind;
  readonly root: HTMLDivElement;
  readonly renderer: MarkRenderer;
  readonly keys: readonly string[];
  readonly colors: Readonly<Record<string, string>> | undefined;
  scene: Scene;
  draws: number;
}

const mounts: Mounted[] = [];
const DEFAULT_KEYS = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7'];

function makeRoot(left: number, top: number): HTMLDivElement {
  const root = document.createElement('div');
  root.className = 'axylo';
  for (const [k, v] of [['position', 'absolute'], ['left', `${left}px`], ['top', `${top}px`], ['width', '400px'], ['height', '300px']]) root.style.setProperty(k!, v!);
  document.body.appendChild(root);
  return root;
}

function draw(m: Mounted): void {
  const { bindings, theme } = resolveTheme(m.root, m.keys, m.colors);
  m.renderer.draw(m.scene, bindings, theme, window.devicePixelRatio);
  m.draws++;
}

function sceneCanvas(m: Mounted, layer: 'scene' | 'overlay' = 'scene'): HTMLCanvasElement {
  return m.root.querySelectorAll('canvas')[layer === 'scene' ? 0 : 1]!;
}

function pixel(m: Mounted, x: number, y: number, layer: 'scene' | 'overlay' = 'scene'): number[] {
  const ctx = sceneCanvas(m, layer).getContext('2d')!;
  return Array.from(ctx.getImageData(x, y, 1, 1).data);
}

let stopWatch: (() => void)[] = [];
let fired = 0;
const records: WatchRecord[] = [];

let text: { layer: TextLayer; root: HTMLDivElement; texts: PlacedText[] } | null = null;

/** A label's box from canvas metrics of the layer's own font: the independent expectation layout would produce. */
function placed(lines: string[], x: number, y: number, anchor: PlacedText['anchor'], baseline: PlacedText['baseline'], rotate: number, font: string, lineHeight: number): PlacedText {
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.font = font;
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
    return { box: t.texts[i]!.box, rect: { x: r.x - origin.x, y: r.y - origin.y, width: r.width, height: r.height } };
  });
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
  mount(kind: RendererKind, left: number, top: number, options: MountOptions = {}): number {
    ensureStyles(document);
    const root = makeRoot(left, top);
    const renderer = kind === 'canvas' ? createCanvasRenderer() : createSvgRenderer();
    root.appendChild(renderer.element);
    const scene = options.scene === 'line' ? lineScene(options.vertices ?? 1000) : fixedScene();
    const m: Mounted = { kind, root, renderer, keys: options.keys ?? DEFAULT_KEYS, colors: options.colors, scene, draws: 0 };
    mounts.push(m);
    draw(m);
    return mounts.length - 1;
  },
  redraw(id: number): void { draw(mounts[id]!); },
  draws: (id: number): number => mounts[id]!.draws,
  theme(id: number) {
    const m = mounts[id]!;
    const r = resolveTheme(m.root, m.keys, m.colors);
    return { theme: r.theme, bindings: r.bindings, attribute: m.root.getAttribute('data-axylo-scheme') };
  },
  canvasInfo(id: number) {
    const c = sceneCanvas(mounts[id]!);
    const r = c.getBoundingClientRect();
    return { width: c.width, height: c.height, cssWidth: r.width, cssHeight: r.height };
  },
  canvasPixel: (id: number, x: number, y: number, layer: 'scene' | 'overlay' = 'scene'): number[] => pixel(mounts[id]!, x, y, layer),
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
  overlay(id: number, on: boolean): void {
    const m = mounts[id]!;
    const { bindings, theme } = resolveTheme(m.root, m.keys, m.colors);
    const overlay: Overlay = {
      clip: m.scene.clip,
      // A cursor rule at x = 330 running past the clip (must stop at 260) and a focus square that is not clipped.
      clipped: [{ type: 'rule', x1: 330, y1: 0, x2: 330, y2: 300, stroke: T('focus'), strokeWidth: 2, dash: null, role: 'cursor' }],
      unclipped: [{ type: 'points', series: 0, shape: 'square', size: 8, fill: T('focus'), xy: Float32Array.of(20, 280) }],
    };
    m.renderer.drawOverlay(on ? overlay : null, bindings, theme, window.devicePixelRatio);
  },
  svgOverlayCount: (id: number): number => mounts[id]!.root.querySelector('.axylo-overlay')!.childElementCount,
  watch(probe: readonly [number, number]): void {
    for (const m of mounts) {
      stopWatch.push(watchTheme(m.root, () => {
        fired++;
        const dpr = window.devicePixelRatio;
        for (const n of mounts) {
          const { bindings, theme } = resolveTheme(n.root, n.keys, n.colors);
          if (n.kind !== 'canvas') { records.push({ id: mounts.indexOf(n), before: null, after: null }); continue; }
          const x = Math.round(probe[0] * dpr), y = Math.round(probe[1] * dpr);
          const before = pixel(n, x, y);
          n.renderer.draw(n.scene, bindings, theme, dpr);
          n.draws++;
          records.push({ id: mounts.indexOf(n), before, after: pixel(n, x, y) });
        }
      }));
      break; // one watcher is enough for the page; more would only repeat the same calls
    }
  },
  stopWatch(): void { for (const s of stopWatch) s(); stopWatch = []; },
  fired: (): number => fired,
  records: (): readonly WatchRecord[] => records,
  mountText(left: number, top: number): TextProbe[] {
    ensureStyles(document);
    const root = makeRoot(left, top);
    root.style.setProperty('font', '14px/18px sans-serif');
    const layer = createTextLayer();
    root.appendChild(layer.element);
    const cs = getComputedStyle(layer.element);
    const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const lh = parseFloat(cs.lineHeight);
    const texts = [
      placed(['Jan 2026'], 200, 100, 'end', 'middle', -45, font, lh),
      placed(['North America', 'and Europe'], 100, 200, 'middle', 'top', 0, font, lh),
      placed(['1,250 kWh'], 380, 50, 'end', 'middle', 0, font, lh),
      placed(['Sessions per day'], 20, 150, 'middle', 'bottom', -90, font, lh),
    ];
    layer.render(texts);
    text = { layer, root, texts };
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
  frames,
  async time(kind: RendererKind, vertices: number, repeats: number) {
    const root = makeRoot(0, 0);
    ensureStyles(document);
    const renderer = kind === 'canvas' ? createCanvasRenderer() : createSvgRenderer();
    root.appendChild(renderer.element);
    const scene = lineScene(vertices);
    const m: Mounted = { kind, root, renderer, keys: DEFAULT_KEYS, colors: undefined, scene, draws: 0 };
    const { bindings, theme } = resolveTheme(root, m.keys, undefined);
    const drawTimes: number[] = [], painted: number[] = [];
    for (let i = 0; i < repeats; i++) {
      // A fresh array each time so the SVG renderer cannot skip the write because `d` is unchanged.
      const xy = (scene.marks[0] as { xy: Float32Array }).xy.slice();
      xy[1] = xy[1]! + (i % 2) * 0.5;
      const s: Scene = { ...scene, marks: [{ ...(scene.marks[0] as Mark & { type: 'path' }), xy }] };
      await frames(1);
      const t0 = performance.now();
      renderer.draw(s, bindings, theme, window.devicePixelRatio);
      const t1 = performance.now();
      // Force style and layout now, then wait for the frame to be produced.
      void root.getBoundingClientRect();
      await frames(2);
      const t2 = performance.now();
      drawTimes.push(t1 - t0);
      painted.push(t2 - t0);
    }
    renderer.destroy();
    root.remove();
    return { draw: drawTimes, painted };
  },
};

window.axr = api;
