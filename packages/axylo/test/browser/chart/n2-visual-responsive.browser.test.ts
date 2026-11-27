/**
 * Cycle N2: visual system, theme and responsive layout, in real Chrome, against the built bundles
 * (dist/axylo.iife.js as `window.Axylo`, dist/cartesian.dev.js as an ES module).
 *
 * 1. A matrix: line, area, bar, histogram, scatter, donut and a mixed Cartesian chart, each in light, dark and
 *    emulated forced colours (with prefers-contrast: more), at 960 and 360 CSS px, and at 320 × 256 CSS px with a
 *    device scale factor of 4. That last one is what 400 % browser zoom of a 1280 × 1024 window gives
 *    (WCAG 1.4.10 reflow, spec L1/A6): Chrome's page zoom divides the CSS viewport and multiplies the device pixel
 *    ratio by the zoom factor, so layout sees the same 320 CSS px and the same DPR. Labels are long French, German and
 *    Japanese (one language per scheme, so each kind and width sees all three). Each render must draw its marks,
 *    keep every text whole, inside the figure and apart from every other text, keep the chrome inside the
 *    container with no page-wide horizontal overflow, keep the title above the plot and the legend clear of it,
 *    paint no shape transparent, meet spec L2 contrast where it applies (text 4.5:1; axes and focus 3:1;
 *    gridlines exempt), place the hover tooltip or readout inside the viewport and the plot at both plot edges,
 *    and let Tab and Shift+Tab pass through the chart with no trap.
 * 2. `legend: 'right'` on a narrow container (F-RESP-1): 960 → 360 → 960 on one chart instance, an independently
 *    resized container in a wide viewport, a fixed height, and a donut, with focus and keyboard toggles kept.
 * 3. Mark-aware Cartesian swatches in the legend and the tooltip, hidden (hollow) state and an update that keeps a
 *    series and changes its mark.
 * 4. The Cartesian swatch drawings are not in the root or static bundles.
 *
 * Screenshots (opt-in, never needed for a pass): AXYLO_N2_SHOTS=<dir> writes one PNG per matrix render and per
 * responsive step into <dir> (see docs/progress/n2-visual-polish-ledger.md). With AXYLO_BUNDLE=<dir> the page runs
 * another build's axylo.iife.js, axylo.css and cartesian.dev.js, for before/after views.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { start, stop } from '../harness';
import { textBoxes, overlaps, extent } from '../acceptance/text';
import { chartPage, closePage } from './util';

beforeAll(start);
afterAll(stop);

// Every page this file opens, until close(): a test that fails before its own close still releases its context.
const OPEN = new Set<Page>();
async function close(page: Page): Promise<string[]> {
  OPEN.delete(page);
  return closePage(page);
}
afterEach(async () => {
  for (const page of OPEN) await page.context().close().catch(() => undefined);
  OPEN.clear();
});

const repo = path.resolve(import.meta.dirname, '../../../../..');
const dist = process.env.AXYLO_BUNDLE ?? path.join(repo, 'packages/axylo/dist');
const SHOTS = process.env.AXYLO_N2_SHOTS ? path.resolve(repo, process.env.AXYLO_N2_SHOTS) : null;
const SHOW_BUTTONS = '#before, #after { display: inline-block !important; }';

type Kind = 'line' | 'area' | 'bar' | 'histogram' | 'scatter' | 'donut' | 'cartesian';
type Scheme = 'light' | 'dark' | 'forced';
type Lang = 'fr' | 'de' | 'ja';
interface Size { readonly name: string; readonly width: number; readonly height: number; readonly scale: number }

const KINDS: readonly Kind[] = ['line', 'area', 'bar', 'histogram', 'scatter', 'donut', 'cartesian'];
const SCHEMES: readonly Scheme[] = ['light', 'dark', 'forced'];
const SIZES: readonly Size[] = [
  { name: '960', width: 960, height: 900, scale: 1 },
  { name: '360', width: 360, height: 800, scale: 1 },
  { name: '320x4', width: 320, height: 256, scale: 4 },
];
const LANG_OF: Record<Scheme, Lang> = { light: 'fr', dark: 'de', forced: 'ja' };
const LOCALE: Record<Lang, string> = { fr: 'fr-FR', de: 'de-DE', ja: 'ja-JP' };

/** Long labels a localized dashboard really carries. */
const LABELS: Record<Lang, { title: string; subtitle: string; x: string; y: string; s: readonly [string, string, string]; categories: readonly string[] }> = {
  fr: {
    title: 'Fréquentation quotidienne des services numériques par canal d’acquisition',
    subtitle: 'Moyenne mobile sur sept jours, données provisoires',
    x: 'Date de la mesure', y: 'Nombre de sessions',
    s: ['Recherche organique internationale', 'Accès direct depuis les applications', 'Campagnes de messagerie électronique'],
    categories: ['Administration générale', 'Relation client et intégration', 'Infrastructure de la plateforme', 'Applications mobiles', 'Ingénierie des données'],
  },
  de: {
    title: 'Tägliche Sitzungen nach Akquisitionskanal und Kundensegment',
    subtitle: 'Gleitender Durchschnitt über sieben Tage, vorläufige Daten',
    x: 'Messzeitpunkt', y: 'Anzahl der Sitzungen',
    s: ['Suchmaschinenoptimierung', 'Direktzugriffe über Lesezeichen', 'Newsletterkampagnenbesuche'],
    categories: ['Kundenzufriedenheitsabteilung', 'Datenschutzbeauftragtenbüro', 'Softwareentwicklungsabteilung', 'Rechnungsprüfungsstelle', 'Plattformbetrieb'],
  },
  ja: {
    title: '取得チャネル別の日次セッション数の推移と顧客セグメント',
    subtitle: '七日間の移動平均、暫定データ',
    x: '測定日', y: 'セッション数',
    s: ['自然検索からの訪問', 'ブックマークからの直接訪問', 'メールマガジン経由の訪問'],
    categories: ['請求およびアカウント管理', 'カスタマーサクセス', 'プラットフォーム運用', 'モバイルアプリ開発', 'データ基盤'],
  },
};

/** The chart function and options of a kind, with the labels of `lang`. */
function optionsFor(kind: Kind, lang: Lang): { fn: string; options: Record<string, unknown> } {
  const L = LABELS[lang];
  const days = Array.from({ length: 14 }, (_, i) => `2026-03-${String(i + 1).padStart(2, '0')}`);
  const common = { title: L.title, subtitle: L.subtitle, locale: LOCALE[lang] };
  const wave = (i: number, base: number, amp: number, phase: number) => Math.round(base + amp * Math.sin(i / 2 + phase));
  switch (kind) {
    case 'line':
    case 'area':
      return {
        fn: kind, options: {
          ...common, data: days.map((day, i) => ({ day, a: wave(i, 4200, 900, 0), b: wave(i, 2600, 700, 1), c: wave(i, 1200, 400, 2) })),
          x: { field: 'day', label: L.x },
          y: [{ field: 'a', label: L.s[0], unit: 'sessions' }, { field: 'b', label: L.s[1] }, { field: 'c', label: L.s[2] }],
          reference: [{ y: 3000, label: L.y }],
        },
      };
    case 'bar':
      return {
        fn: 'bar', options: {
          ...common, data: L.categories.map((team, i) => ({ team, a: 70 + ((i * 7) % 25), b: 60 + ((i * 11) % 30) })),
          x: { field: 'team', label: L.x }, y: [{ field: 'a', label: L.s[0], unit: '%' }, { field: 'b', label: L.s[1], unit: '%' }],
        },
      };
    case 'histogram':
      return {
        fn: 'histogram', options: {
          ...common, data: { columns: { ms: Float64Array.from({ length: 200 }, (_, i) => 20 + ((i * 37) % 180) + (i % 7) * 3) } },
          x: { field: 'ms', label: L.y }, bins: [0, 40, 80, 120, 160, 200, 240],
        },
      };
    case 'scatter':
      return {
        fn: 'scatter', options: {
          ...common, data: Array.from({ length: 60 }, (_, k) => ({ size: 100000 + k * 15000, latency: 1200 + ((k * 37) % 400), region: k % 2 ? L.s[0] : L.s[1] })),
          x: { field: 'size', label: L.x, unit: 'B' }, y: { field: 'latency', label: L.y, unit: 'ms' }, series: 'region',
        },
      };
    case 'donut':
      return {
        fn: 'donut', options: {
          ...common, data: L.categories.map((k, i) => ({ k, v: [46.2, 27.5, 14.1, 8.9, 3.3][i] })), label: 'k', value: { field: 'v', label: L.y, scale: 'percent' },
        },
      };
    case 'cartesian':
      return { fn: 'cartesian', options: { ...common, ...cartesianOptions(lang) } };
  }
}

/** A Cartesian chart with every layer type: bar and area on the left axis, line, range and error bar on the right. */
function cartesianOptions(lang: Lang, unitsMark: 'bar' | 'area' = 'bar'): Record<string, unknown> {
  const L = LABELS[lang];
  const data = Array.from({ length: 12 }, (_, i) => {
    const t = 18 + 4 * Math.sin(i / 2);
    return { day: `2026-03-${String(i + 1).padStart(2, '0')}`, units: 10 + ((i * 7) % 9), share: 4 + ((i * 3) % 5), temp: +t.toFixed(1), lo: +(t - 2).toFixed(1), hi: +(t + 2).toFixed(1), m: +(t + 6).toFixed(1), el: +(t + 4.5).toFixed(1), eh: +(t + 7.5).toFixed(1) };
  });
  return {
    data, x: { field: 'day', label: L.x },
    axes: { left: { position: 'left', label: L.y }, right: { position: 'right', label: 'Température' } },
    layers: [
      { type: unitsMark, y: { field: 'units', label: 'Units' }, yAxis: 'left' },
      { type: 'area', y: { field: 'share', label: 'Share' }, yAxis: 'left' },
      { type: 'line', y: { field: 'temp', label: 'Temperature' }, yAxis: 'right' },
      { type: 'range', low: { field: 'lo', label: 'Low' }, high: { field: 'hi', label: 'High' }, yAxis: 'right', label: 'Band' },
      { type: 'errorBar', y: { field: 'm', label: 'Mean' }, low: { field: 'el', label: 'Lower' }, high: { field: 'eh', label: 'Upper' }, yAxis: 'right', label: 'Error' },
    ],
  };
}

const SCHEME_CSS: Record<Scheme, string> = {
  light: ':root { color-scheme: light; } body { background: #ffffff; color: #1b1d22; }',
  dark: ':root { color-scheme: dark; } body { background: #16181d; color: #e8eaee; }',
  forced: ':root { color-scheme: light; } body { background: #ffffff; color: #1b1d22; }',
};

async function openChartPage(size: Size, scheme: Scheme, lang: Lang | null, css = ''): Promise<Page> {
  const page = await chartPage({
    viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale,
    locale: lang ? LOCALE[lang] : 'en-US',
    colorScheme: scheme === 'dark' ? 'dark' : 'light',
    forcedColors: scheme === 'forced' ? 'active' : 'none',
    contrast: scheme === 'forced' ? 'more' : 'no-preference',
    css: `${SHOW_BUTTONS} ${SCHEME_CSS[scheme]} #chart { width: auto; height: auto; } ${css}`,
  });
  OPEN.add(page);
  await installColorReader(page);
  if (lang) await page.evaluate(l => { document.documentElement.lang = l; }, lang);
  const file = path.join(dist, 'cartesian.dev.js');
  await page.route('**/__n2/cartesian.js', route => route.fulfill({ path: file, contentType: 'text/javascript' }));
  await page.addScriptTag({ type: 'module', content: "import { cartesian } from '/__n2/cartesian.js'; window.AxyloCartesian = cartesian;" });
  await page.waitForFunction(() => 'AxyloCartesian' in window);
  return page;
}

/** Creates the chart in #chart and waits until it has drawn (the Cartesian handle has no __bench hook). */
async function draw(page: Page, fn: string, options: Record<string, unknown>): Promise<void> {
  await page.evaluate(async ({ fn, options }) => {
    const w = window as unknown as { Axylo: Record<string, (t: string, o: unknown) => unknown>; AxyloCartesian: (t: string, o: unknown) => unknown; charts: unknown[] };
    const make = fn === 'cartesian' ? w.AxyloCartesian : w.Axylo[fn]!;
    // Typed arrays do not survive the page boundary as such: rebuild the histogram's column.
    const o = options as { data: { columns?: Record<string, unknown> } };
    if (o.data && o.data.columns) for (const k of Object.keys(o.data.columns)) o.data.columns[k] = Float64Array.from(Object.values(o.data.columns[k] as Record<string, number>));
    w.charts = [make('#chart', options)];
  }, { fn, options });
  await ready(page);
}

async function ready(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const charts = (window as unknown as { charts: { __bench?: { ready(): Promise<void> } }[] }).charts ?? [];
    for (const c of charts) if (c.__bench) await c.__bench.ready();
    for (let i = 0; i < 4; i++) await new Promise(r => requestAnimationFrame(r));
    for (const c of charts) if (c.__bench) await c.__bench.ready();
  });
}

async function shoot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.locator('#chart').screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

interface Box { x: number; y: number; width: number; height: number }
type RGBA = [number, number, number, number];

/**
 * Installs `window.__n2rgba`: any CSS colour the page computes (rgb(), color(srgb …), oklch(), a system colour)
 * read back through a 2D canvas as 8-bit RGBA. Null for a value the canvas does not accept, so an unknown
 * serialization is reported instead of being taken for a colour.
 */
async function installColorReader(page: Page): Promise<void> {
  await page.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    (window as unknown as { __n2rgba: (c: string) => RGBA | null }).__n2rgba = (c: string) => {
      for (const sentinel of ['#010203', '#040506']) {
        ctx.fillStyle = sentinel;
        const before = ctx.fillStyle;
        ctx.fillStyle = c;
        if (ctx.fillStyle !== before) break;
        // Unchanged: either the colour is the sentinel itself, or the canvas rejected it. The second sentinel tells.
        if (sentinel === '#040506') return null;
      }
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0]!, d[1]!, d[2]!, d[3]! / 255];
    };
  });
}

/** A painted shape of the scene or overlay, with its resolved paint and the opacity that reaches the screen. */
interface Mark {
  tag: string; series: boolean; knockout: boolean; style: string;
  fill: RGBA | null; fillRaw: string; fillAlpha: number; fillOpacity: number;
  stroke: RGBA | null; strokeRaw: string; strokeAlpha: number; strokeWidth: number;
}
/** A text with its resolved colour, what is behind it, and its computed size. */
interface Ink { what: string; text: string; color: RGBA | null; raw: string; behind: RGBA | null; size: number }

/** Sizes, paints and texts of the chart, read in the page. */
interface Geometry {
  chart: Box; figure: Box; plot: Box; caption: Box | null; innerWidth: number;
  /** The plot's data area: the keyboard proxy is placed on it (dom/interaction.ts, #placeProxy → plotBox). */
  dataArea: Box | null; innerHeight: number; scrollWidth: number;
  chrome: { what: string; box: Box }[];
  legend: { text: string; box: Box }[];
  side: Box | null; controls: Box | null;
  marks: Mark[]; axis: { color: RGBA | null; raw: string }[]; inks: Ink[];
  page: RGBA | null; focus: RGBA | null; system: Record<string, RGBA | null>;
  tooSmall: boolean; readout: boolean;
}

async function geometry(page: Page): Promise<Geometry> {
  return page.evaluate(() => {
    const rgba = (window as unknown as { __n2rgba: (c: string) => RGBA | null }).__n2rgba;
    const root = document.querySelector('#chart')!;
    const r = (e: Element | null) => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
    const shown = (e: Element) => { const s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden' && !e.closest('[hidden]') && e.getBoundingClientRect().width > 0; };
    const pageColor = rgba(getComputedStyle(document.body).backgroundColor);
    // What is behind an element: the first ancestor with an opaque background, else the page.
    const behind = (e: Element) => {
      for (let a: Element | null = e; a; a = a.parentElement) {
        const c = rgba(getComputedStyle(a).backgroundColor);
        if (c && c[3] >= 0.99) return c;
      }
      return pageColor;
    };
    const chrome: { what: string; box: Box }[] = [];
    for (const sel of ['.axylo-caption', '.axylo-title', '.axylo-subtitle', '.axylo-plot', '.axylo-controls', '.axylo-controls-top', '.axylo-controls-side', '.axylo-toolbar button', '.axylo-legend-list > li', '.axylo-note', '.axylo-readout']) {
      for (const e of root.querySelectorAll(sel)) if (shown(e) && !e.closest('.axylo-visually-hidden')) chrome.push({ what: sel, box: r(e)! });
    }
    const legend = [...root.querySelectorAll('.axylo-legend-entry, .axylo-legend-list > li')].filter(shown).map(e => ({ text: (e.textContent ?? '').trim(), box: r(e)! }));
    const marks: Mark[] = [];
    for (const e of root.querySelectorAll('svg.axylo-svg .axylo-scene *, svg.axylo-svg .axylo-overlay *')) {
      if (!(e instanceof SVGGeometryElement) || e.closest('clipPath, defs, mask, pattern')) continue;
      const s = getComputedStyle(e);
      if (s.display === 'none' || s.visibility === 'hidden') continue;
      // Opacity reaching the screen: the element's and every ancestor's up to the SVG root.
      let chain = 1;
      for (let a: Element | null = e; a && !(a instanceof SVGSVGElement); a = a.parentElement) chain *= parseFloat(getComputedStyle(a).opacity);
      // The paint is set on the shape or, for bars, on their group (`color` + currentColor), so read the style that applies.
      const owner = e.closest('[style*="color"]');
      const style = owner && root.contains(owner) ? owner.getAttribute('style') ?? '' : '';
      const fill = s.fill === 'none' || s.fill.startsWith('url(') ? null : rgba(s.fill);
      const stroke = s.stroke === 'none' || s.stroke.startsWith('url(') ? null : rgba(s.stroke);
      marks.push({
        tag: e.tagName, series: style.includes('--axylo-series-color'), knockout: style.includes('--axylo-background'), style,
        fill, fillRaw: s.fill, fillOpacity: parseFloat(s.fillOpacity), fillAlpha: fill ? fill[3] * parseFloat(s.fillOpacity) * chain : 0,
        stroke, strokeRaw: s.stroke, strokeWidth: parseFloat(s.strokeWidth), strokeAlpha: stroke ? stroke[3] * parseFloat(s.strokeOpacity) * chain : 0,
      });
    }
    const axis = [...root.querySelectorAll('svg.axylo-svg :is(line, path)[style*="--axylo-axis"]')].map(e => ({ raw: getComputedStyle(e).stroke, color: rgba(getComputedStyle(e).stroke) }));
    const inks: Ink[] = [];
    const ink = (what: string, sel: string) => {
      for (const e of root.querySelectorAll(sel)) {
        if (!shown(e) || e.closest('.axylo-visually-hidden') || !(e.textContent ?? '').trim()) continue;
        const s = getComputedStyle(e);
        inks.push({ what, text: (e.textContent ?? '').trim().slice(0, 24), raw: s.color, color: rgba(s.color), behind: behind(e), size: parseFloat(s.fontSize) });
      }
    };
    ink('tick text', '.axylo-text [data-role^="tick"]');
    ink('axis title', '.axylo-text [data-role^="title"]');
    ink('title', '.axylo-title');
    ink('subtitle', '.axylo-subtitle');
    ink('legend text', '.axylo-control-label, .axylo-legend-list > li');
    ink('control text', '.axylo-toolbar button:not(.axylo-legend-entry)');
    ink('note', '.axylo-note');
    const ring = root.querySelector('.axylo-focus-ring');
    const system: Record<string, RGBA | null> = {};
    for (const c of ['Canvas', 'CanvasText', 'GrayText', 'Highlight', 'HighlightText', 'LinkText', 'ButtonText', 'ButtonFace', 'ButtonBorder', 'Field', 'FieldText', 'Mark', 'MarkText', 'AccentColor', 'AccentColorText', 'SelectedItem', 'SelectedItemText', 'VisitedText', 'ActiveText']) system[c] = rgba(c);
    return {
      chart: r(root)!, figure: r(root.querySelector('figure') ?? root)!, plot: r(root.querySelector('.axylo-plot'))!, caption: r(root.querySelector('.axylo-caption')),
      dataArea: r(root.querySelector('.axylo-proxy:not([hidden])')),
      innerWidth, innerHeight, scrollWidth: document.documentElement.scrollWidth, chrome, legend,
      side: r(root.querySelector('.axylo-controls-side:not([hidden])')), controls: r(root.querySelector('.axylo-controls:not([hidden])')),
      marks, axis, inks, page: pageColor, focus: ring ? rgba(getComputedStyle(ring).outlineColor) : null, system,
      // The too-small state (spec L8) shows the summary in place of the plot.
      tooSmall: [...root.querySelectorAll('.axylo-summary:not(.axylo-visually-hidden)')].some(shown),
      readout: !!root.querySelector('.axylo-readout-mode'),
    };
  });
}

// ---- colour arithmetic (WCAG 2.x relative luminance) ----
function luminance([r, g, b]: readonly number[]): number {
  const c = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * c(r!) + 0.7152 * c(g!) + 0.0722 * c(b!);
}
/** Contrast of `fg` composited over the opaque `bg` (spec L2: against what is behind it). */
function contrast(fg: RGBA, bg: RGBA): number {
  const a = fg[3];
  const over = [0, 1, 2].map(i => fg[i]! * a + bg[i]! * (1 - a));
  const l1 = luminance(over), l2 = luminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
const css = (c: RGBA | null) => c ? `rgba(${c.slice(0, 3).join(',')},${c[3].toFixed(2)})` : 'unreadable';

const inside = (b: Box, o: Box, slack = 1) => b.x >= o.x - slack && b.y >= o.y - slack && b.x + b.width <= o.x + o.width + slack && b.y + b.height <= o.y + o.height + slack;
const overlapArea = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
const fmt = (b: Box) => `${b.x.toFixed(1)},${b.y.toFixed(1)} ${b.width.toFixed(1)}×${b.height.toFixed(1)}`;

/** Kinds that draw axes; a donut has none (spec F-kinds), so it is held to its slices, legend and readout instead. */
const AXES: Record<Kind, boolean> = { line: true, area: true, bar: true, histogram: true, scatter: true, donut: false, cartesian: true };

/** What a reader would see wrong with the chart's text: cut, outside the figure, or over another text. */
async function textProblems(page: Page, axes = true): Promise<string[]> {
  const problems: string[] = [];
  const boxes = await textBoxes(page);
  for (const b of boxes) if (b.seen !== 'whole') problems.push(`text ${b.seen}: "${b.text.slice(0, 24)}" (${b.role})`);
  const painted = boxes.filter(b => b.w > 0);
  problems.push(...overlaps(painted, 1).map(p => `text overlap: ${p}`));
  const fig = (await page.locator('#chart figure').first().boundingBox())!;
  for (const b of painted) {
    const e = extent(b);
    if (e.x0 < fig.x - 1 || e.y0 < fig.y - 1 || e.x1 > fig.x + fig.width + 1 || e.y1 > fig.y + fig.height + 1) problems.push(`text outside the figure: "${b.text.slice(0, 24)}"`);
  }
  // Every kind with axes labels them; a chart with no tick text at all has lost its axes.
  if (axes && !painted.some(b => /tick/.test(b.role))) problems.push('no tick label is painted');
  return problems;
}

/**
 * Kind-specific marks that must be drawn, read from the shipped SVG groups (cartesian/scene.ts, scene/*.ts and
 * render/svg.ts): bars are <rect>s in a <g> painted through `color`; lines and whiskers stroked paths; areas and
 * bands filled paths at the scene's declared fill-opacity; points filled paths; donut slices <path>s in a <g>.
 */
function markProblems(g: Geometry, kind: Kind): string[] {
  const series = g.marks.filter(m => m.series && !m.knockout);
  const rects = series.filter(m => m.tag === 'rect' && m.fill && m.fillAlpha > 0).length;
  const stroked = series.filter(m => m.tag === 'path' && !m.fill && m.stroke && m.strokeAlpha > 0 && m.strokeWidth > 0).length;
  const solid = series.filter(m => m.tag === 'path' && m.fill && m.fillOpacity === 1).length;
  // Areas paint at 0.25 (scene/areas.ts) or 0.8 (stacked); Cartesian areas and range bands at 0.22 (cartesian/scene.ts).
  const translucent = (allowed: readonly number[]) => series.filter(m => m.tag === 'path' && m.fill && allowed.some(o => Math.abs(m.fillOpacity - o) < 0.005)).length;
  const want: Record<Kind, [string, number][]> = {
    line: [['stroked series path', stroked]],
    area: [['filled area path at fill-opacity 0.25 or 0.8', translucent([0.25, 0.8])], ['stroked area edge', stroked]],
    bar: [['bar rect', rects]],
    histogram: [['bar rect', rects]],
    scatter: [['filled point path', solid]],
    donut: [['filled slice path', solid]],
    cartesian: [['bar rect', rects], ['area or band path at fill-opacity 0.22', translucent([0.22])], ['stroked line or whisker path', stroked]],
  };
  return want[kind].filter(([, n]) => n === 0).map(([what]) => `no ${what}`);
}

function layoutProblems(g: Geometry, kind: Kind, legend = true): string[] {
  const problems: string[] = [];
  if (g.scrollWidth > g.innerWidth + 1) problems.push(`page scrolls sideways: ${g.scrollWidth} > ${g.innerWidth}`);
  for (const c of g.chrome) if (!inside(c.box, g.chart)) problems.push(`${c.what} outside the container: ${fmt(c.box)} vs ${fmt(g.chart)}`);
  if (g.caption && g.caption.height > 0 && g.caption.y + g.caption.height > g.plot.y + 1) problems.push(`caption ${fmt(g.caption)} reaches into the plot ${fmt(g.plot)}`);
  for (const l of g.legend) if (overlapArea(l.box, g.plot) > 1) problems.push(`legend entry "${l.text.slice(0, 24)}" over the plot`);
  // The too-small state (L8) replaces the plot and the legend with the summary and the table control.
  if (g.tooSmall) return problems;
  if (g.plot.width < 1 || g.plot.height < 1) problems.push(`empty plot ${fmt(g.plot)}`);
  // Every fixture but the histogram has several series; a donut's slice list is checked by the F-RESP-1 block.
  if (legend && kind !== 'histogram' && kind !== 'donut' && g.legend.length === 0) problems.push('no legend entry is shown');
  return problems;
}

/**
 * Spec L2 and L4. Light and dark: text 4.5:1 against what is behind it and at least 12 px, marks (solid fills and
 * strokes; translucent area and band fills carry their colour through their edge or are decorative) and axes 3:1,
 * the focus outline 3:1; gridlines exempt. Forced colours: every text, axis and series paint is a system colour,
 * and the same contrast thresholds hold against Canvas (the user's colours, so they must not be broken by ours).
 */
function paintProblems(g: Geometry, scheme: Scheme, kind: Kind): string[] {
  const problems: string[] = [];
  const forced = scheme === 'forced';
  const system = Object.values(g.system).filter((c): c is RGBA => c !== null);
  const isSystem = (c: RGBA) => system.some(s => Math.max(...[0, 1, 2].map(i => Math.abs(s[i]! - c[i]!))) <= 1);
  const ground = forced ? g.system.Canvas ?? g.page : g.page;
  if (!ground || ground[3] < 0.99) return [`page background unreadable or not opaque: ${css(ground)}`];
  for (const m of g.marks) {
    // Knockouts and halos take the author's --axylo-background, transparent when unset by design.
    if (m.knockout) continue;
    for (const [role, raw, c, alpha] of [['fill', m.fillRaw, m.fill, m.fillAlpha], ['stroke', m.strokeRaw, m.stroke, m.strokeAlpha]] as const) {
      if (raw === 'none' || raw.startsWith('url(')) continue;
      if (!c) { problems.push(`${m.tag} ${role} unreadable: ${raw}`); continue; }
      if (alpha === 0 && (role === 'fill' || m.strokeWidth > 0)) problems.push(`${m.tag} ${role} is transparent`);
      if (!m.series) continue;
      if (forced && !isSystem(c)) problems.push(`forced colours: series ${role} ${css(c)} is not a system colour`);
      // A solid mark (a translucent fill is not the mark's carrier) must stand out from the background.
      const solid = role === 'stroke' ? m.strokeWidth > 0 && alpha >= 0.99 : m.fillOpacity === 1 && alpha >= 0.99;
      if (solid && contrast(c, ground) < 3) problems.push(`mark ${m.tag} ${role} ${css(c)}: ${contrast(c, ground).toFixed(2)} < 3`);
    }
  }
  if (AXES[kind] && !g.axis.length) problems.push('no axis rule');
  for (const a of g.axis) {
    if (!a.color) { problems.push(`axis stroke unreadable: ${a.raw}`); continue; }
    if (forced && !isSystem(a.color)) problems.push(`forced colours: axis ${css(a.color)} is not a system colour`);
    if (!(contrast(a.color, ground) >= 3)) problems.push(`axis ${css(a.color)}: ${contrast(a.color, ground).toFixed(2)} < 3`);
  }
  if (!g.inks.length) problems.push('no text is painted');
  for (const t of g.inks) {
    if (!t.color) { problems.push(`${t.what} colour unreadable: ${t.raw}`); continue; }
    const back = forced ? ground : t.behind ?? ground;
    if (forced && !isSystem(t.color)) problems.push(`forced colours: ${t.what} ${css(t.color)} is not a system colour`);
    if (!(contrast(t.color, back) >= 4.5)) problems.push(`${t.what} "${t.text}" ${css(t.color)} on ${css(back)}: ${contrast(t.color, back).toFixed(2)} < 4.5`);
    if (t.size < 12 - 0.01) problems.push(`${t.what} "${t.text}" is ${t.size} px < 12`);
  }
  if (!g.focus) problems.push('focus ring colour unreadable');
  else {
    if (forced && !isSystem(g.focus)) problems.push(`forced colours: focus ring ${css(g.focus)} is not a system colour`);
    if (!(contrast(g.focus, ground) >= 3)) problems.push(`focus ring ${css(g.focus)}: ${contrast(g.focus, ground).toFixed(2)} < 3`);
  }
  return problems;
}

/**
 * Pointer positions on the rendered marks themselves, in viewport px: the first and the last bar, the two ends of the
 * first series path (line, area, Cartesian), the leftmost and rightmost point marker (scatter), and a point inside
 * the largest and the smallest slice (donut). Each is checked with isPointInFill / isPointInStroke where it applies,
 * so it is on a drawn mark, not on a guess about the layout.
 */
async function markAnchors(page: Page, kind: Kind): Promise<{ where: string; x: number; y: number }[]> {
  return page.evaluate(kind => {
    const scene = document.querySelector('#chart svg.axylo-svg .axylo-scene')!;
    const toClient = (e: SVGGraphicsElement, x: number, y: number) => { const p = new DOMPoint(x, y).matrixTransform(e.getScreenCTM()!); return { x: p.x, y: p.y }; };
    const series = (sel: string) => [...scene.querySelectorAll<SVGGeometryElement>(sel)].filter(e => (e.closest('[style*="--axylo-series-color"]') !== null) && getComputedStyle(e).display !== 'none');
    const out: { where: string; x: number; y: number }[] = [];
    // A point inside `e`'s fill near (x, y), searched outwards on a 1 px grid.
    const inFill = (e: SVGGeometryElement, x: number, y: number, reach: number) => {
      for (let d = 0; d <= reach; d++) for (let i = -d; i <= d; i++) for (const [dx, dy] of [[i, -d], [i, d], [-d, i], [d, i]] as const) {
        const p = new DOMPoint(x + dx, y + dy);
        if (e.isPointInFill(p)) return p;
      }
      return null;
    };
    // An integer viewport point whose whole (2r+1)² CSS-px neighbourhood, mapped back through the inverse screen CTM,
    // is inside `e`'s fill. A sector's bounding box can cover the whole circle, so a grid hit may sit exactly on the
    // outer arc; the renderer rounds arc coordinates and the pointer arrives as viewport client coordinates, so such
    // a boundary point can land just outside the ring that the lookup picks. Coarse grid first, then every pixel and
    // a 1 px neighbourhood, so a genuinely thin sector is still found (or reported missing, never skipped silently).
    function interior(e: SVGGeometryElement): { x: number; y: number } | null {
      const ctm = e.getScreenCTM();
      if (!ctm) return null;
      const back = ctm.inverse(), box = e.getBoundingClientRect();
      const solid = (x: number, y: number, reach: number) => {
        for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
          if (!e.isPointInFill(new DOMPoint(x + dx, y + dy).matrixTransform(back))) return false;
        }
        return true;
      };
      const x0 = Math.ceil(box.left), x1 = Math.floor(box.right), y0 = Math.ceil(box.top), y1 = Math.floor(box.bottom);
      for (const [step, reach] of [[Math.max(1, Math.floor(Math.min(x1 - x0, y1 - y0) / 20)), 2], [1, 2], [1, 1]] as const) {
        for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) if (solid(x, y, reach)) return { x, y };
      }
      return null;
    }
    if (kind === 'bar' || kind === 'histogram' || kind === 'cartesian') {
      const rects = series('rect').map(e => ({ e, b: (e as SVGRectElement).getBBox() })).filter(r => r.b.width > 0 && r.b.height > 0).sort((a, b) => a.b.x - b.b.x);
      for (const [where, r] of [['first bar', rects[0]], ['last bar', rects.at(-1)]] as const) {
        if (r) out.push({ where, ...toClient(r.e, r.b.x + r.b.width / 2, r.b.y + Math.min(r.b.height / 2, 4)) });
      }
    }
    if (kind === 'line' || kind === 'area' || kind === 'cartesian') {
      const path = series('path').find(e => getComputedStyle(e).fill === 'none' && e.getTotalLength() > 0);
      if (path) {
        const len = path.getTotalLength();
        for (const [where, at] of [['line start', 0.5], ['line end', len - 0.5]] as const) {
          const p = path.getPointAtLength(at);
          out.push({ where, ...toClient(path, p.x, p.y) });
        }
      }
    }
    if (kind === 'scatter') {
      const points = series('path').filter(e => getComputedStyle(e).fill !== 'none');
      const starts: { e: SVGGeometryElement; x: number; y: number }[] = [];
      for (const e of points) for (const m of (e.getAttribute('d') ?? '').matchAll(/M\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/g)) starts.push({ e, x: +m[1]!, y: +m[2]! });
      starts.sort((a, b) => a.x - b.x);
      for (const [where, s] of [['leftmost point', starts[0]], ['rightmost point', starts.at(-1)]] as const) {
        const p = s ? inFill(s.e, s.x, s.y, 8) : null;
        if (s && p) out.push({ where, ...toClient(s.e, p.x, p.y) });
      }
    }
    if (kind === 'donut') {
      const slices = series('path').filter(e => getComputedStyle(e).fill !== 'none').map(e => ({ e, b: e.getBBox() })).sort((a, b) => b.b.width * b.b.height - a.b.width * a.b.height);
      for (const [where, s] of [['largest slice', slices[0]], ['smallest slice', slices.at(-1)]] as const) {
        if (!s) continue;
        const p = interior(s.e);
        if (p) out.push({ where, ...p });
      }
    }
    return out;
  }, kind);
}

/** The dominant slice's complete value in fr-FR: "90 (90 %)", the percent sign after a (narrow) no-break space. */
const DOMINANT_VALUE = /(^|[^\d,])90 \(90[\s\u00a0\u202f]?%\)/;

/**
 * Points at the interior anchor of the largest slice and asks that the answer carries its complete value. A failure
 * says what was under the pointer, so a picking defect reads apart from a placement one.
 */
async function dominantPointerProblems(page: Page, g: Geometry): Promise<string[]> {
  if (g.tooSmall) return [];
  const anchor = (await markAnchors(page, 'donut')).find(a => a.where === 'largest slice');
  if (!anchor) return ['largest slice: no interior pointer anchor found'];
  await page.mouse.move(0, 0);
  await page.mouse.move(anchor.x, anchor.y);
  await ready(page);
  const a = await answer(page);
  const shown = a.floating ?? a.readout;
  if (shown && a.texts.some(t => DOMINANT_VALUE.test(t))) return [];
  const probe = await page.evaluate(({ x, y }) => {
    const hit = document.elementFromPoint(x, y);
    const name = (e: Element | null) => e ? `${e.tagName.toLowerCase()}${e.classList.length ? '.' + [...e.classList].join('.') : ''}` : 'nothing';
    const slices = [...document.querySelectorAll<SVGGeometryElement>('#chart svg.axylo-svg .axylo-scene [style*="--axylo-series-color"] path')]
      .filter(e => getComputedStyle(e).fill !== 'none');
    const inside = slices.map(e => e.isPointInFill(new DOMPoint(x, y).matrixTransform(e.getScreenCTM()!.inverse())));
    const plot = document.querySelector('#chart .axylo-plot')!.getBoundingClientRect();
    return `under the pointer ${name(hit)} (in ${name(hit?.parentElement ?? null)}); in slice fills [${inside.join(', ')}]; plot ${plot.x.toFixed(1)},${plot.y.toFixed(1)} ${plot.width.toFixed(1)}×${plot.height.toFixed(1)}`;
  }, anchor);
  const what = shown ? `answer without the value 90 (90 %): ${a.texts.join(' / ').slice(0, 80)}` : 'no tooltip and no readout';
  return [`pointer on largest slice at ${anchor.x},${anchor.y}: ${what}; ${probe}`];
}

/** What answers the reader at one step: the floating tooltip or the readout strip, with its content and bounds. */
interface Answer {
  floating: Box | null; readout: Box | null; plot: Box; chart: Box; scrollY: number;
  /** The strip's first value and its pager ("+N more"), when there is a strip and they exist. */
  value: Box | null; pager: Box | null;
  title: string; rows: number; texts: string[]; stray: string[]; cut: string[]; overflow: string | null; ink: Ink[];
}

async function answer(page: Page): Promise<Answer> {
  return page.evaluate(() => {
    const rgba = (window as unknown as { __n2rgba: (c: string) => RGBA | null }).__n2rgba;
    const r = (e: Element) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
    const plot = r(document.querySelector('#chart .axylo-plot')!), chart = r(document.querySelector('#chart')!);
    const tip = document.querySelector<HTMLElement>('#chart .axylo-tooltip');
    const floating = tip && !tip.closest('[hidden]') && getComputedStyle(tip).display !== 'none' && tip.getBoundingClientRect().width > 0 && (tip.textContent ?? '').trim() ? r(tip) : null;
    const strip = document.querySelector<HTMLElement>('#chart .axylo-readout-mode .axylo-readout');
    const readout = strip && !strip.hidden && getComputedStyle(strip).visibility !== 'hidden' && (strip.textContent ?? '').trim() ? r(strip) : null;
    const box = floating ? tip! : readout ? strip! : null;
    const part = (sel: string) => { const e = readout ? strip!.querySelector(sel) : null; return e ? r(e) : null; };
    const value = part('.axylo-tooltip-value'), pager = part('.axylo-tooltip-more');
    const texts: string[] = [], stray: string[] = [], cut: string[] = [], ink: Ink[] = [];
    let title = '', rows = 0, overflow: string | null = null;
    if (box) {
      const bb = box.getBoundingClientRect();
      title = (box.querySelector('.axylo-tooltip-title')?.textContent ?? '').trim();
      rows = box.querySelectorAll('.axylo-tooltip-row, .axylo-readout-entry').length;
      // The floating tooltip hides overflow: content larger than its box would be cut (L1).
      if (floating && (box.scrollHeight > box.clientHeight + 1 || box.scrollWidth > box.clientWidth + 1)) overflow = `${box.scrollWidth}×${box.scrollHeight} in ${box.clientWidth}×${box.clientHeight}`;
      const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = n.textContent?.trim();
        if (!t || n.parentElement!.closest('.axylo-visually-hidden')) continue;
        texts.push(t);
        // A designed ellipsis cut (the strip's title and its cut entries): the cutting element must itself be in the box.
        let cutBy: Element | null = null;
        for (let a: Element | null = n.parentElement; a && a !== box; a = a.parentElement) if (getComputedStyle(a).textOverflow === 'ellipsis') cutBy = a;
        if (cutBy) {
          const c = cutBy.getBoundingClientRect();
          if (c.left < bb.left - 1 || c.right > bb.right + 1 || c.top < bb.top - 1 || c.bottom > bb.bottom + 1) cut.push(t.slice(0, 24));
          continue;
        }
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const b of range.getClientRects()) {
          if (b.width < 0.5) continue;
          if (b.left < bb.left - 1 || b.right > bb.right + 1 || b.top < bb.top - 1 || b.bottom > bb.bottom + 1) { stray.push(t.slice(0, 24)); break; }
        }
      }
      for (const e of box.querySelectorAll('.axylo-tooltip-title, .axylo-tooltip-series, .axylo-tooltip-value')) {
        const s = getComputedStyle(e);
        let back: RGBA | null = null;
        for (let a: Element | null = e; a && !back; a = a.parentElement) { const c = rgba(getComputedStyle(a).backgroundColor); if (c && c[3] >= 0.99) back = c; }
        ink.push({ what: 'tooltip text', text: (e.textContent ?? '').trim().slice(0, 24), raw: s.color, color: rgba(s.color), behind: back ?? rgba(getComputedStyle(document.body).backgroundColor), size: parseFloat(s.fontSize) });
      }
    }
    return { floating, readout, plot, chart, scrollY, value, pager, title, rows, texts, stray, cut, overflow, ink };
  });
}

/**
 * Points at marks (pointer) and steps through the data (keyboard Home, End). Decision 0004 rule 5 says what must
 * answer: in readout mode the strip; otherwise, with a plot of at least 240 × 140 CSS px, the floating tooltip;
 * a smaller plot without the strip (and the too-small state, L8) answers with neither. Whatever answers must hold
 * a title and at least one row, keep every text inside its box (a designed ellipsis cut excepted), and stay inside
 * the viewport and the plot (floating) or the viewport's width and the container (strip; the page may scroll
 * vertically at 320 px, WCAG 1.4.10).
 */
async function tooltipProblems(page: Page, kind: Kind, g: Geometry, scheme: Scheme): Promise<string[]> {
  const problems: string[] = [];
  const area = g.dataArea;
  if (!g.tooSmall && !area) return ['no plot proxy: the data area is not placed'];
  // Rule 5 reads the data area laid out without the strip; outside readout mode no strip is reserved, so the proxy's box is it.
  const mode = g.tooSmall ? 'none' : g.readout ? 'strip' : area!.width >= 240 && area!.height >= 140 ? 'floating' : 'none';
  await page.locator('#chart .axylo-plot').scrollIntoViewIfNeeded();
  const view = page.viewportSize()!;
  const anchors = g.tooSmall ? [] : await markAnchors(page, kind);
  const wanted: Record<Kind, number> = { line: 2, area: 2, bar: 2, histogram: 2, scatter: 2, donut: 2, cartesian: 4 };
  if (!g.tooSmall && anchors.length < wanted[kind]) problems.push(`only ${anchors.length} of ${wanted[kind]} mark anchors found: ${anchors.map(a => a.where).join(', ')}`);
  const steps: [string, () => Promise<void>][] = [
    ...anchors.map(a => [`pointer on ${a.where}`, async () => {
      await page.mouse.move(a.x, a.y);
    }] as [string, () => Promise<void>]),
    ['keyboard Home', async () => { await page.mouse.move(0, 0); await page.locator('#chart').getByRole('slider').focus(); await page.keyboard.press('Home'); }],
    ['keyboard End', () => page.keyboard.press('End')],
  ];
  for (const [where, act] of steps) {
    await act();
    await ready(page);
    const a = await answer(page);
    if (mode === 'none') {
      if (a.floating) problems.push(`${where}: a floating tooltip where rule 5 allows none (data area ${area ? fmt(area) : 'none'})`);
      continue;
    }
    const got = mode === 'floating' ? a.floating : a.readout;
    if (!got) { problems.push(`${where}: no ${mode === 'floating' ? 'tooltip' : 'readout'}`); continue; }
    if (!a.title) problems.push(`${where}: ${mode} has no title`);
    if (a.rows < 1) problems.push(`${where}: ${mode} has no row`);
    for (const t of a.stray) problems.push(`${where}: ${mode} text outside its box: "${t}"`);
    for (const t of a.cut) problems.push(`${where}: ${mode} ellipsis box outside the strip: "${t}"`);
    if (a.overflow) problems.push(`${where}: tooltip content overflows (${a.overflow})`);
    if (mode === 'floating') {
      if (got.x < -0.5 || got.y < -0.5 || got.x + got.width > view.width + 0.5 || got.y + got.height > view.height + 0.5) problems.push(`${where}: tooltip ${fmt(got)} leaves the ${view.width}×${view.height} viewport`);
      if (!inside(got, a.plot, 1)) problems.push(`${where}: tooltip ${fmt(got)} leaves the plot ${fmt(a.plot)}`);
    } else {
      if (got.x < -0.5 || got.x + got.width > view.width + 0.5) problems.push(`${where}: readout ${fmt(got)} leaves the viewport's width`);
      if (!inside(got, a.chart, 1)) problems.push(`${where}: readout ${fmt(got)} leaves the container ${fmt(a.chart)}`);
      // Rule 5: whatever the strip keeps, its first value is shown, and a pager stays on the strip's two lines.
      if (!a.value || a.value.width < 1) problems.push(`${where}: readout shows no value`);
      else if (!inside(a.value, got, 1)) problems.push(`${where}: readout value ${fmt(a.value)} outside the strip ${fmt(got)}`);
      if (a.pager && !inside(a.pager, got, 1)) problems.push(`${where}: readout pager ${fmt(a.pager)} outside the strip ${fmt(got)}`);
    }
    const ground = scheme === 'forced' ? g.system.Canvas : null;
    for (const t of a.ink) {
      const back = ground ?? t.behind;
      if (!t.color || !back) { problems.push(`${where}: tooltip text colour unreadable: ${t.raw}`); continue; }
      if (!(contrast(t.color, back) >= 4.5)) problems.push(`${where}: tooltip text "${t.text}" ${css(t.color)} on ${css(back)}: ${contrast(t.color, back).toFixed(2)} < 4.5`);
      if (t.size < 12 - 0.01) problems.push(`${where}: tooltip text "${t.text}" is ${t.size} px < 12`);
    }
  }
  await page.keyboard.press('Escape');
  await page.mouse.move(0, 0);
  return problems;
}

/** Tab from #before must leave through #after, and Shift+Tab from #after must come back to #before. */
async function keyboardProblems(page: Page): Promise<string[]> {
  const problems: string[] = [];
  const where = () => page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body) return 'body';
    if (a.id) return `#${a.id}`;
    return `${a.getAttribute('role') ?? a.tagName.toLowerCase()}:${(a.getAttribute('aria-label') ?? a.textContent ?? '').slice(0, 30)}`;
  });
  for (const [from, to, key] of [['#before', '#after', 'Tab'], ['#after', '#before', 'Shift+Tab']] as const) {
    await page.locator(from).focus();
    const path: string[] = [];
    let reached = false;
    for (let i = 0; i < 16 && !reached; i++) {
      await page.keyboard.press(key);
      const at = await where();
      path.push(at);
      reached = at === to;
    }
    if (!reached) problems.push(`keyboard trap: ${key} from ${from} never reaches ${to}`);
    else if (path.length < 2) problems.push(`keyboard: ${key} from ${from} skips the chart`);
  }
  return problems;
}

/** Opens a page, runs `body`, and always closes the page's context; page errors count as problems. */
async function withPage<T>(open: () => Promise<Page>, body: (page: Page) => Promise<T>): Promise<{ result: T; errors: string[] }> {
  const page = await open();
  let result: T | undefined, failure: unknown = null, failed = false;
  try { result = await body(page); } catch (e) { failure = e; failed = true; }
  const errors = await close(page);
  if (failed) throw failure;
  return { result: result as T, errors };
}

/**
 * Every matrix case records its problems here, so the last test can fail with one compact table (problem category →
 * cases) that fits a short log tail. Each case still fails on its own.
 */
const MATRIX: Map<string, string[]> = new Map();
/** A problem's category: its text without the case-specific numbers, quotes and boxes. */
const category = (p: string) => p.replace(/^(pointer on [a-z ]+|keyboard (Home|End)): /, '$1 → ').replace(/"[^"]*"/g, '"…"').replace(/rgba?\([^)]*\)/g, 'C').replace(/-?\d+(\.\d+)?/g, '#').slice(0, 90);

describe('N2 matrix: every kind, scheme and width draws a legible, contained, reachable chart', () => {
  for (const kind of KINDS) {
    for (const scheme of SCHEMES) {
      for (const size of SIZES) {
        const lang = LANG_OF[scheme];
        const name = `${kind}·${scheme}·${size.name}`;
        it(`${kind} · ${scheme} · ${size.name} (${lang})`, async () => {
          const { result: problems, errors } = await withPage(() => openChartPage(size, scheme, lang), async page => {
            const { fn, options } = optionsFor(kind, lang);
            await draw(page, fn, options);
            await shoot(page, `${kind}-${scheme}-${size.name}`);
            const g = await geometry(page);
            return [
              ...(g.tooSmall ? [] : markProblems(g, kind)),
              ...await textProblems(page, AXES[kind] && !g.tooSmall),
              ...layoutProblems(g, kind),
              ...paintProblems(g, scheme, kind),
              ...await tooltipProblems(page, kind, g, scheme),
              ...await keyboardProblems(page),
            ];
          });
          problems.push(...errors.map(e => `page error: ${e}`));
          MATRIX.set(name, problems);
          expect(problems.length, `${name}: ${problems.slice(0, 4).join(' | ')}${problems.length > 4 ? ` | +${problems.length - 4}` : ''}`).toBe(0);
        });
      }
    }
  }
});

/** Where the legend entries are relative to the plot, and the state of focus. */
async function legendPlace(page: Page): Promise<{ place: string; entries: number; focused: string | null; pressed: (string | null)[]; problems: string[] }> {
  const g = await geometry(page);
  const problems = [...layoutProblems(g, 'line'), ...await textProblems(page, !g.tooSmall)];
  const places = new Set(g.legend.map(l => l.box.x >= g.plot.x + g.plot.width - 1 ? 'beside' : l.box.y >= g.plot.y + g.plot.height - 1 ? 'below' : l.box.y + l.box.height <= g.plot.y + 1 ? 'above' : 'over'));
  const state = await page.evaluate(() => {
    const a = document.activeElement;
    return {
      focused: a && a.closest('#chart') ? (a.textContent ?? '').trim() : null,
      pressed: [...document.querySelectorAll('#chart .axylo-legend-entry')].map(e => e.getAttribute('aria-pressed')),
    };
  });
  // The tick labels and axis titles stay clear of every legend entry.
  const boxes = (await textBoxes(page)).filter(b => /tick|axis/.test(b.role));
  for (const b of boxes) {
    const e = extent(b);
    for (const l of g.legend) if (overlapArea({ x: e.x0, y: e.y0, width: e.x1 - e.x0, height: e.y1 - e.y0 }, l.box) > 1) problems.push(`"${b.text}" under legend entry "${l.text}"`);
  }
  return { place: [...places].join('+') || 'none', entries: g.legend.length, ...state, problems };
}

describe("F-RESP-1: legend: 'right' falls back to a strip under the plot on a narrow container", () => {
  it('960 → 360 → 960 on one instance: rail, strip, rail; focus, roving and toggles carry over', async () => {
    const page = await openChartPage(SIZES[0]!, 'light', 'de');
    const { options } = optionsFor('line', 'de');
    await draw(page, 'line', { ...options, legend: 'right' });
    await shoot(page, 'legend-right-960-before');
    const wide = await legendPlace(page);
    expect(wide.place).toBe('beside');
    expect(wide.problems).toEqual([]);
    expect(wide.entries).toBe(3);
    // Focus the second entry by keyboard: into the toolbar, then one step along it.
    await page.locator('#chart .axylo-legend-entry').first().focus();
    await page.keyboard.press('ArrowDown');
    const second = (await page.locator('#chart .axylo-legend-entry').nth(1).textContent())!.trim();
    expect((await legendPlace(page)).focused).toBe(second);

    await page.setViewportSize({ width: 360, height: 800 });
    await ready(page);
    await shoot(page, 'legend-right-360');
    const narrow = await legendPlace(page);
    expect(narrow.place).toBe('below');
    expect(narrow.problems).toEqual([]);
    expect(narrow.entries).toBe(3);
    expect(narrow.focused).toBe(second);
    const side = (await geometry(page)).side!;
    const plot = (await geometry(page)).plot;
    expect(side.width).toBeGreaterThan(plot.width - 2);
    // The focused entry still toggles from the keyboard, and roving still moves along the strip.
    await page.keyboard.press('Enter');
    await ready(page);
    expect((await legendPlace(page)).pressed).toEqual(['true', 'false', 'true']);
    await page.keyboard.press('ArrowRight');
    expect((await legendPlace(page)).focused).toBe((await page.locator('#chart .axylo-legend-entry').nth(2).textContent())!.trim());
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Space');
    await ready(page);
    expect((await legendPlace(page)).pressed).toEqual(['true', 'true', 'true']);

    await page.setViewportSize({ width: 960, height: 900 });
    await ready(page);
    await shoot(page, 'legend-right-960-after');
    const back = await legendPlace(page);
    expect(back.place).toBe('beside');
    expect(back.problems).toEqual([]);
    expect(back.focused).toBe(second);
    expect(await keyboardProblems(page)).toEqual([]);
    expect(await close(page)).toEqual([]);
  });

  it('the container, not the viewport, decides: a 400 px chart in a 960 px page stacks, a 600 px one keeps the rail', async () => {
    const page = await openChartPage(SIZES[0]!, 'dark', 'fr', '#chart { width: 400px; }');
    const { options } = optionsFor('line', 'fr');
    await draw(page, 'line', { ...options, legend: 'right' });
    const narrow = await legendPlace(page);
    expect(narrow.place).toBe('below');
    expect(narrow.problems).toEqual([]);
    await page.evaluate(() => { document.getElementById('chart')!.style.width = '600px'; });
    await ready(page);
    const wide = await legendPlace(page);
    expect(wide.place).toBe('beside');
    expect(wide.problems).toEqual([]);
    // Exactly at the threshold the strip wins (480 px or less), one px more brings the rail back.
    for (const [width, place] of [[480, 'below'], [481, 'beside']] as const) {
      await page.evaluate(w => { document.getElementById('chart')!.style.width = `${w}px`; }, width);
      await ready(page);
      expect((await legendPlace(page)).place, `${width} px`).toBe(place);
    }
    expect(await close(page)).toEqual([]);
  });

  it('a fixed 320 px height at 360 px keeps the strip, plot and caption inside the container', async () => {
    const page = await openChartPage(SIZES[1]!, 'light', 'ja', '#chart { height: 320px; }');
    const { options } = optionsFor('line', 'ja');
    await draw(page, 'line', { ...options, legend: 'right' });
    await shoot(page, 'legend-right-360-fixed-height');
    const g = await geometry(page);
    expect(layoutProblems(g, 'line')).toEqual([]);
    expect(g.chart.height).toBeCloseTo(320, 0);
    const place = await legendPlace(page);
    // A plot that leaves no room becomes the too-small state (spec L8); otherwise the strip sits below it.
    if (!g.tooSmall) expect(place.place).toBe('below');
    expect(place.problems).toEqual([]);
    expect(await close(page)).toEqual([]);
  });

  it('a donut with legend: right moves its slice list under the plot at 360 px, still keyboard reachable', async () => {
    const page = await openChartPage(SIZES[1]!, 'forced', 'fr');
    const { options } = optionsFor('donut', 'fr');
    await draw(page, 'donut', { ...options, legend: 'right' });
    await shoot(page, 'legend-right-donut-360');
    const g = await geometry(page);
    expect(layoutProblems(g, 'donut')).toEqual([]);
    // Five slices; a small one may be folded into "Other" by the donut's own rule, so at least four entries.
    expect(g.legend.length).toBeGreaterThanOrEqual(4);
    for (const l of g.legend) expect(l.box.y, l.text).toBeGreaterThanOrEqual(g.plot.y + g.plot.height - 1);
    expect(await keyboardProblems(page)).toEqual([]);
    expect(await close(page)).toEqual([]);
  });
});

interface SwatchPart { tag: string; cls: string | null; d: string | null; fill: string; fillOpacity: string; stroke: string }
interface Swatch { label: string; pressed: string | null; color: string; parts: SwatchPart[] }

async function swatches(page: Page, scope: string): Promise<Swatch[]> {
  return page.evaluate(scope => [...document.querySelectorAll(scope)].map(entry => {
    const svg = entry.querySelector('svg.axylo-swatch')!;
    const label = (entry.querySelector('.axylo-control-label')?.textContent ?? entry.textContent ?? '').trim();
    return {
      label, pressed: entry.getAttribute('aria-pressed'), color: svg ? getComputedStyle(svg).color : 'missing',
      parts: svg ? [...svg.children].map(c => {
        const s = getComputedStyle(c);
        return { tag: c.tagName, cls: c.getAttribute('class'), d: c.getAttribute('d'), fill: s.fill, fillOpacity: s.fillOpacity, stroke: s.stroke };
      }) : [],
    };
  }), scope);
}

const AREA_D = 'M1 6L7 3L13 6L19 3V11H1Z';
const BAND_D = 'M1 3L7 2L13 4L19 2V9L13 10L7 8L1 10Z';
const WHISKER_D = 'M10 1V11M6 1H14M6 11H14';
const CHIP_D = 'M5 1H15V11H5Z';

/** Which mark a swatch draws, read from its shapes (independent of the code that drew it). */
function markOf(s: Swatch): string {
  const p = s.parts;
  if (p.some(x => x.cls === 'axylo-swatch-whisker' && x.d === WHISKER_D)) return 'errorBar';
  if (p.some(x => x.d === BAND_D)) return 'range';
  if (p.some(x => x.d === AREA_D)) return 'area';
  if (p.some(x => x.tag === 'line' && x.cls === 'axylo-swatch-line')) return 'line';
  if (p.length === 1 && p[0]!.d === CHIP_D) return 'bar';
  return `unknown: ${JSON.stringify(p)}`;
}

describe('mark-aware Cartesian swatches (legend and tooltip)', () => {
  const EXPECTED: Record<string, string> = { Units: 'bar', Share: 'area', Temperature: 'line', Low: 'range', High: 'range', Mean: 'errorBar', Lower: 'errorBar', Upper: 'errorBar' };

  for (const scheme of SCHEMES) {
    it(`each legend entry repeats its layer's mark and colour (${scheme})`, async () => {
      const page = await openChartPage(SIZES[0]!, scheme, 'fr');
      await draw(page, 'cartesian', { title: 'Swatches', ...cartesianOptions('fr') });
      await shoot(page, `cartesian-swatches-${scheme}`);
      const legend = await swatches(page, '#chart .axylo-legend-entry');
      expect(Object.fromEntries(legend.map(s => [s.label, markOf(s)]))).toEqual(EXPECTED);
      const by = Object.fromEntries(legend.map(s => [s.label, s]));
      // Translucent where the marks are translucent, full colour where they are solid.
      expect(by.Units!.parts[0]!.fillOpacity).toBe('1');
      expect(by.Share!.parts.find(p => p.d === AREA_D)!.fillOpacity).toBe('0.22');
      expect(by.Share!.parts.find(p => p.cls === 'axylo-swatch-line')!.stroke).toBe(by.Share!.color);
      expect(by.Low!.parts[0]!.fillOpacity).toBe('0.22');
      // A range or error bar is one mark in one colour: its centre's, else its low field's (cartesian/scene.ts).
      expect(by.High!.color).toBe(by.Low!.color);
      expect(by.Lower!.color).toBe(by.Mean!.color);
      expect(by.Upper!.color).toBe(by.Mean!.color);
      expect(by.Mean!.parts.some(p => p.cls === 'axylo-swatch-marker')).toBe(true);
      // Every swatch colour is a colour the plot paints, and no swatch is transparent.
      const painted = await page.evaluate(() => {
        const out = new Set<string>();
        for (const e of document.querySelectorAll('#chart svg.axylo-svg .axylo-scene [style*="--axylo-series-color"], #chart svg.axylo-svg .axylo-scene g[style*="--axylo-series-color"] > *')) {
          const s = getComputedStyle(e);
          if (s.fill !== 'none') out.add(s.fill);
          if (s.stroke !== 'none') out.add(s.stroke);
        }
        return [...out];
      });
      const alphas = await page.evaluate(colors => colors.map(c => (window as unknown as { __n2rgba: (c: string) => RGBA | null }).__n2rgba(c)?.[3] ?? null), legend.map(s => s.color));
      legend.forEach((s, i) => {
        expect(painted, `${s.label} ${s.color}`).toContain(s.color);
        // Null (a colour the canvas cannot read) fails as well as transparent.
        expect(alphas[i], s.label).toBeGreaterThan(0);
      });
      expect(await close(page)).toEqual([]);
    });
  }

  it('a hidden series is an outline of its own shape; showing it again restores the fill', async () => {
    const page = await openChartPage(SIZES[0]!, 'light', 'fr');
    await draw(page, 'cartesian', { title: 'Hollow', ...cartesianOptions('fr') });
    const entry = (label: string) => page.locator('#chart .axylo-toolbar').getByRole('button', { name: label, exact: true });
    for (const label of ['Units', 'Share', 'Low', 'Mean']) await entry(label).click();
    await ready(page);
    const by = Object.fromEntries((await swatches(page, '#chart .axylo-legend-entry')).map(s => [s.label, s]));
    for (const label of ['Units', 'Share', 'Low', 'Mean']) {
      const s = by[label]!;
      expect(s.pressed, label).toBe('false');
      expect(markOf(s), label).toBe(EXPECTED[label]);
      // Outlined in the series' colour, the inside the background (never the series' colour).
      expect(s.parts.some(p => p.stroke === s.color), label).toBe(true);
      expect(s.parts.filter(p => p.cls !== 'axylo-swatch-marker').some(p => p.fill === s.color && p.fillOpacity !== '0'), label).toBe(false);
    }
    expect(by.Share!.parts.some(p => p.cls === 'axylo-swatch-line')).toBe(false);
    await entry('Units').click();
    await ready(page);
    const units = (await swatches(page, '#chart .axylo-legend-entry')).find(s => s.label === 'Units')!;
    expect(units.pressed).toBe('true');
    expect(units.parts[0]!.fill).toBe(units.color);
    expect(await close(page)).toEqual([]);
  });

  it('the tooltip rows carry the same mark swatches as the legend', async () => {
    const page = await openChartPage(SIZES[0]!, 'dark', 'de');
    await draw(page, 'cartesian', { title: 'Tooltip', ...cartesianOptions('de') });
    const plot = (await page.locator('#chart .axylo-plot').boundingBox())!;
    await page.mouse.move(plot.x + plot.width / 2, plot.y + plot.height / 2);
    await ready(page);
    // Series rows carry a swatch; a total row (none here) would not.
    const rows = (await swatches(page, '#chart .axylo-tooltip .axylo-tooltip-series')).filter(r => r.color !== 'missing');
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const name = Object.keys(EXPECTED).find(k => r.label === k) ?? Object.keys(EXPECTED).find(k => r.label.startsWith(k));
      expect(name, r.label).toBeDefined();
      expect(markOf(r), r.label).toBe(EXPECTED[name!]);
    }
    expect(await close(page)).toEqual([]);
  });

  it('an update that keeps a series and changes its mark redraws its swatch', async () => {
    const page = await openChartPage(SIZES[0]!, 'light', 'fr');
    await draw(page, 'cartesian', { title: 'Update', ...cartesianOptions('fr') });
    const before = (await swatches(page, '#chart .axylo-legend-entry')).find(s => s.label === 'Units')!;
    expect(markOf(before)).toBe('bar');
    await page.evaluate(layers => { (window as unknown as { charts: { update(p: unknown): void }[] }).charts[0]!.update({ layers }); }, cartesianOptions('fr', 'area').layers);
    await ready(page);
    const after = (await swatches(page, '#chart .axylo-legend-entry')).find(s => s.label === 'Units')!;
    expect(markOf(after)).toBe('area');
    expect(after.color).toBe(before.color);
    expect(await close(page)).toEqual([]);
  });
});

describe('the Cartesian swatch drawings stay out of the legacy bundles', () => {
  it('dist/axylo.js, axylo.iife.min.js and static.js carry none of them; cartesian.js does', () => {
    const read = (f: string) => fs.readFileSync(path.join(dist, f), 'utf8');
    for (const f of ['axylo.js', 'axylo.iife.min.js', 'static.js']) {
      const text = read(f);
      expect(text.includes('axylo-swatch-whisker'), f).toBe(false);
      expect(text.includes(BAND_D), f).toBe(false);
    }
    expect(read('cartesian.js').includes('axylo-swatch-whisker')).toBe(true);
  });
});

describe('readout strip on a truly narrow plot (decision 0004 rule 5)', () => {
  // A 220 px container leaves a data area under 240 px wide. The container's height is fixed and the caption kept
  // to one short title with no legend, so the data area stays well above 80 px (L8) once the two-line strip is
  // reserved: by rule 5 the strip must answer. The series and category labels stay long, so the strip's rows
  // must wrap or be cut by its own rules (axylo-readout-wrap / -cut), never spill. The 280 px height keeps the plot
  // within the 256 px tall viewport of the 400 % case, so the pointer can reach it.
  for (const [kind, scheme, size, height] of [['line', 'light', SIZES[1]!, 400], ['cartesian', 'dark', SIZES[1]!, 400], ['bar', 'forced', SIZES[2]!, 280]] as const) {
    it(`${kind} · ${scheme} · ${size.name}: a 220 px chart answers in the strip`, async () => {
      const lang = LANG_OF[scheme];
      const { result: problems, errors } = await withPage(() => openChartPage(size, scheme, lang, `#chart { width: 220px; height: ${height}px; }`), async page => {
        const { fn, options } = optionsFor(kind, lang);
        await draw(page, fn, { ...options, title: LABELS[lang].y, subtitle: undefined, legend: false });
        await shoot(page, `strip-${kind}-${scheme}-${size.name}`);
        const g = await geometry(page);
        const out: string[] = [];
        if (g.tooSmall) out.push('the 220 px chart is in the too-small state');
        if (!g.readout) out.push(`no readout mode with a plot of ${fmt(g.plot)}`);
        out.push(...layoutProblems(g, kind, false), ...await textProblems(page, AXES[kind] && !g.tooSmall), ...await tooltipProblems(page, kind, g, scheme));
        return out;
      });
      problems.push(...errors.map(e => `page error: ${e}`));
      expect(problems.length, problems.slice(0, 6).join(' | ')).toBe(0);
    });
  }
});

describe('N2 repair regressions (independent review blockers)', () => {
  it("F-RESP-1 keeps intrinsic width: an auto-width inline-block chart sized by its title switches 'bottom' → 'right'", async () => {
    const page = await openChartPage(SIZES[0]!, 'light', 'de', '#chart { display: inline-block; }');
    const L = LABELS.de;
    const title = `${L.title} — ${L.subtitle}`;
    const days = Array.from({ length: 8 }, (_, i) => `2026-03-0${i + 1}`);
    await draw(page, 'line', {
      title, locale: 'de-DE', legend: 'bottom', x: { field: 'day' },
      data: days.map((day, i) => ({ day, a: 10 + i, b: 20 - i })), y: [{ field: 'a', label: 'A' }, { field: 'b', label: 'B' }],
    });
    const before = await geometry(page);
    expect(before.chart.width, 'the title gives the inline-block its width').toBeGreaterThan(300);
    await page.evaluate(() => { (window as unknown as { charts: { update(p: unknown): void }[] }).charts[0]!.update({ legend: 'right' }); });
    await ready(page);
    await shoot(page, 'repair-inline-block-legend-right');
    const g = await geometry(page);
    expect(g.chart.width, 'containment must not collapse the shrink-to-fit target').toBeGreaterThan(before.chart.width - 2);
    expect(g.tooSmall).toBe(false);
    expect(g.plot.width).toBeGreaterThan(120);
    const place = await legendPlace(page);
    expect(place.problems).toEqual([]);
    expect(place.entries).toBe(2);
    expect(place.place).toBe(g.chart.width > 481 ? 'beside' : 'below');
    expect(await keyboardProblems(page)).toEqual([]);
    expect(await close(page)).toEqual([]);
  });

  it('donut with a dominant 90/10 slice and long labels at 360 px: keyboard Home answers inside the hole or a side, in bounds', async () => {
    const L = LABELS.fr;
    const { result: problems, errors } = await withPage(() => openChartPage(SIZES[1]!, 'light', 'fr'), async page => {
      await draw(page, 'donut', {
        title: L.title, locale: 'fr-FR', label: 'k', value: { field: 'v', label: `${L.y} ${L.y}` },
        data: [{ k: `${L.categories[0]} ${L.categories[1]}`, v: 90 }, { k: `${L.categories[2]} ${L.categories[3]}`, v: 10 }],
      });
      await shoot(page, 'repair-donut-dominant-360');
      const g = await geometry(page);
      const out = [...layoutProblems(g, 'donut'), ...await tooltipProblems(page, 'donut', g, 'light')];
      out.push(...await dominantPointerProblems(page, g));
      await page.mouse.move(0, 0);
      await page.locator('#chart').getByRole('slider').focus();
      await page.keyboard.press('Home');
      await ready(page);
      const a = await answer(page);
      if (!g.tooSmall && !a.floating && !a.readout) out.push('keyboard Home on the dominant slice shows nothing');
      if (a.floating && !inside(a.floating, a.plot)) out.push(`tooltip ${fmt(a.floating)} outside plot ${fmt(a.plot)}`);
      if ((a.floating || a.readout) && (!a.title || a.rows < 1)) out.push('the answer has no title or no row');
      // The compact donut pass drops the repeated slice name from the row, never the value and its percentage.
      if ((a.floating || a.readout) && !a.texts.some(t => DOMINANT_VALUE.test(t))) out.push(`keyboard Home: the answer does not show the value 90 (90 %): ${a.texts.join(' / ').slice(0, 80)}`);
      return out;
    });
    problems.push(...errors.map(e => `page error: ${e}`));
    expect(problems.length, problems.slice(0, 6).join(' | ')).toBe(0);
  });

  it('donut 90/10 at 360 px in a 425 px tall chart: pointer and keyboard Home both answer, in bounds', async () => {
    const L = LABELS.fr;
    const { result: problems, errors } = await withPage(() => openChartPage(SIZES[1]!, 'light', 'fr', '#chart { height: 425px; }'), async page => {
      await draw(page, 'donut', {
        title: L.title, locale: 'fr-FR', label: 'k', value: { field: 'v', label: `${L.y} ${L.y}` },
        data: [{ k: `${L.categories[0]} ${L.categories[1]}`, v: 90 }, { k: `${L.categories[2]} ${L.categories[3]}`, v: 10 }],
      });
      await shoot(page, 'repair-donut-dominant-360-tall');
      const g = await geometry(page);
      const out = [...layoutProblems(g, 'donut'), ...await tooltipProblems(page, 'donut', g, 'light')];
      out.push(...await dominantPointerProblems(page, g));
      if (g.tooSmall) out.push('a 425 px tall chart at 360 px should not be too small');
      await page.mouse.move(0, 0);
      await page.locator('#chart').getByRole('slider').focus();
      await page.keyboard.press('Home');
      await ready(page);
      const a = await answer(page);
      if (!a.floating && !a.readout) out.push('keyboard Home on the dominant slice shows nothing');
      if (a.floating && !inside(a.floating, a.plot)) out.push(`tooltip ${fmt(a.floating)} outside plot ${fmt(a.plot)}`);
      if ((a.floating || a.readout) && (!a.title || a.rows < 1)) out.push('the answer has no title or no row');
      // The compact donut pass drops the repeated slice name from the row, never the value and its percentage.
      if ((a.floating || a.readout) && !a.texts.some(t => DOMINANT_VALUE.test(t))) out.push(`keyboard Home: the answer does not show the value 90 (90 %): ${a.texts.join(' / ').slice(0, 80)}`);
      return out;
    });
    problems.push(...errors.map(e => `page error: ${e}`));
    expect(problems.length, problems.slice(0, 6).join(' | ')).toBe(0);
  });

  it('a 220 px stacked bar strip with an overwide localized total keeps value, total and pager on its two lines', async () => {
    const L = LABELS.de;
    const { result: problems, errors } = await withPage(() => openChartPage(SIZES[1]!, 'light', 'de', '#chart { width: 220px; height: 400px; }'), async page => {
      const { options } = optionsFor('bar', 'de');
      await draw(page, 'bar', {
        ...options, title: L.y, subtitle: undefined, legend: false, layout: 'stacked',
        messages: { total: 'Gesamtsumme aller gestapelten Werte dieser Kategorie insgesamt' },
      });
      await shoot(page, 'repair-strip-stacked-total-220');
      const g = await geometry(page);
      const out: string[] = [];
      if (!g.readout) out.push(`no readout mode with a plot of ${fmt(g.plot)}`);
      out.push(...layoutProblems(g, 'bar', false), ...await tooltipProblems(page, 'bar', g, 'light'));
      await page.mouse.move(0, 0);
      await page.locator('#chart').getByRole('slider').focus();
      await page.keyboard.press('Home');
      await ready(page);
      const a = await answer(page);
      if (!a.readout) out.push('keyboard Home: the strip is hidden');
      else {
        const parts = await page.evaluate(() => {
          const r = (e: Element | null) => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
          const strip = document.querySelector('#chart .axylo-readout')!;
          const total = strip.querySelector('.axylo-readout-total');
          const number = total?.lastChild ?? null;
          let numberBox = null;
          if (number) { const range = document.createRange(); range.selectNodeContents(number); numberBox = r(range as unknown as Element); }
          return { total: r(total), number: numberBox, line: parseFloat(getComputedStyle(strip).lineHeight) };
        });
        if (!parts.total || !parts.number) out.push('the strip has no stack total');
        else {
          if (!inside(parts.total, a.readout)) out.push(`total ${fmt(parts.total)} outside strip ${fmt(a.readout)}`);
          if (!inside(parts.number, a.readout) || parts.number.width < 4) out.push(`total number ${fmt(parts.number)} not shown in strip ${fmt(a.readout)}`);
        }
        if (a.readout.height > 2 * parts.line + 1) out.push(`strip ${fmt(a.readout)} taller than two lines of ${parts.line}`);
        if (!a.value || !inside(a.value, a.readout)) out.push('the first value is not inside the strip');
        if (a.pager && !inside(a.pager, a.readout)) out.push(`pager ${fmt(a.pager)} outside the strip`);
        if (a.pager && (a.pager.width < 24 || a.pager.height < 24)) out.push(`pager ${fmt(a.pager)} below 24 × 24`);
      }
      return out;
    });
    problems.push(...errors.map(e => `page error: ${e}`));
    expect(problems.length, problems.slice(0, 6).join(' | ')).toBe(0);
  });
});

describe('N2 matrix summary', () => {
  it('every one of the 63 matrix cases passed (compact table: problem category → cases)', () => {
    const byCategory = new Map<string, string[]>();
    for (const [name, problems] of MATRIX) {
      for (const c of new Set(problems.map(category))) {
        const list = byCategory.get(c) ?? [];
        list.push(name);
        byCategory.set(c, list);
      }
    }
    const table = [...byCategory].sort((a, b) => b[1].length - a[1].length)
      .map(([c, cases]) => `${cases.length}× ${c} [${cases.slice(0, 6).join(' ')}${cases.length > 6 ? ` +${cases.length - 6}` : ''}]`);
    const failing = [...MATRIX].filter(([, p]) => p.length).length;
    expect(`${MATRIX.size} run, ${failing} failing\n${table.join('\n')}`.trim()).toBe(`${KINDS.length * SCHEMES.length * SIZES.length} run, 0 failing`);
  });
});
