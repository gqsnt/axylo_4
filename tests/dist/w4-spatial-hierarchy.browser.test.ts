/**
 * W4 integration in packed real Chrome: `axylo/spatial` (heatmap, bubble), `axylo/hierarchy` (treemap, sunburst)
 * and the violin layer of `axylo/cartesian`, exported through `axylo/export` bundled on its own (a second module
 * that reaches the charts only through the shared registry and the handle symbol, export/contract.ts).
 *
 * For each family: it draws; the whole-figure SVG holds its family chrome (the heatmap's colour bar with its
 * gradient and ticks, the bubble's nested-circle size legend, the hierarchy's title, drilled breadcrumb and
 * note); PNG at 1x and 2x; CSV of every model row with the table closed and open (more than 50 rows, several
 * pages), byte-identical through the mounted target and the handle and across both export bundles; and after
 * destroy nothing that responds is left (0 listeners, 0 observers, 0 frames: pages/instrument.js).
 *
 * Fixture-derived expectations:
 *   heatmap: 60 rows R0..R59 × 4 columns C0..C3, value = index (0..239): the matrix table has 60 rows, 2 pages of 50;
 *   bubble:  120 points, size i + 1 (1..120): 120 table rows, 2 pages of 100; reference sizes for a largest 120
 *            (spatial/bubble/legend.ts referenceSizes: niceFloor of 120, 120/4, 120/16) are 100, 25 and 5;
 *   violin:  120 groups G0..G119 of 5 values each: 120 table rows (one per x category, spec A4), 2 pages;
 *   hierarchy: Root, B0..B2, L0..L129 (L_i under B_(i mod 3), value i + 1) and one invalid leaf "Bad" (-5) under
 *            B2 (AX190: the note says one value is not shown, the row stays and reads "No data"; the page console
 *            prints that warning once, core/delivery.ts prints each code once per page): 135 nodes in
 *            pre-order (Root, Root / B0, Root / B0 / L0, …, Root / B2 / Bad), 2 pages of 100. The treemap is drilled
 *            into B1 and the sunburst into B0, so their breadcrumbs read Root › B1 and Root › B0, the drilled node
 *            current; the sunburst's Root crumb then drills back up.
 *   bubble rows are in x then y order (spatial/bubble/table.ts): x 0..11, then y 0..9, size 12y + x + 1.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bundle, closeBrowser, cspPolicy, launch, open, problems, startServer, type Server } from './browser';
import { fixture } from './paths';
import { csvClosedOpen, expectClosedOpenCsv, expectPng, expectWholeFigure, paintedShapes, pngExport, summarizeExport, type ExportSummary } from './export-conformance';

let server: Server;
let chartsUrl: string;
let exportOnlyUrl: string;

const HEATMAP_ROWS = 60, BUBBLES = 120, GROUPS = 120, HIERARCHY_NODES = 1 + 3 + 130 + 1;
const DRILLED: Record<string, string> = { treemap: 'B1', sunburst: 'B0' };
/** Pre-order paths of the hierarchy fixture (hierarchy/reader.ts joins labels with " / "). */
const HIERARCHY_PATHS = ['Root', ...[0, 1, 2].flatMap(b => [`Root / B${b}`,
  ...Array.from({ length: 130 }, (_, i) => i).filter(i => i % 3 === b).map(i => `Root / B${b} / L${i}`),
  ...(b === 2 ? ['Root / B2 / Bad'] : [])])];
/** Bubble rows as [x, size] from the fixture: x then y order. */
const BUBBLE_ROWS = Array.from({ length: 12 }, (_, x) => Array.from({ length: 10 }, (_, y) => [String(x), String(12 * y + x + 1)])).flat();

beforeAll(async () => {
  server = await startServer();
  await launch();
  chartsUrl = (await bundle({
    name: 'w4-spatial-hierarchy',
    cwd: fixture('npm'),
    format: 'esm',
    conditions: ['production'],
    contents: `
      import { heatmap, bubble } from 'axylo/spatial';
      import { treemap, sunburst } from 'axylo/hierarchy';
      import { cartesian } from 'axylo/cartesian';
      import { violinData } from 'axylo/stats';
      import { exportSvg, exportPng, exportPngDataUrl, exportCsv, parseCsv } from 'axylo/export';

      // From here on, pages/instrument.js records every listener, observer and frame the charts register.
      (window as unknown as { __tracking: boolean }).__tracking = true;
      const host = (id: string, width: number, height: number) => {
        const el = document.getElementById(id)!;
        el.style.width = width + 'px';
        el.style.height = height + 'px';
        return el;
      };
      const cells = Array.from({ length: ${HEATMAP_ROWS} * 4 }, (_, i) => ({ r: 'R' + Math.floor(i / 4), c: 'C' + (i % 4), v: i }));
      const dots = Array.from({ length: ${BUBBLES} }, (_, i) => ({ x: i % 12, y: Math.floor(i / 12), s: i + 1 }));
      const samples = Array.from({ length: ${GROUPS} }, (_, g) => [1, 2, 3, 4, 5].map(k => ({ g: 'G' + g, v: k + (g % 7) }))).flat();
      const violin = violinData(samples, { group: 'g', value: 'v' });
      const leaves = (b: number) => Array.from({ length: 130 }, (_, i) => i).filter(i => i % 3 === b).map(i => ({ id: 'L' + i, label: 'L' + i, value: i + 1 }));
      const tree = { id: 'Root', label: 'Root', children: [0, 1, 2].map(b => ({ id: 'B' + b, label: 'B' + b, children: b === 2 ? [...leaves(b), { id: 'Bad', label: 'Bad', value: -5 }] : leaves(b) })) };
      const charts = {
        heatmap: heatmap(host('hm', 640, 900), { title: 'Load by row', subtitle: 'Synthetic', data: cells, x: 'c', y: 'r', value: { field: 'v', label: 'Load' } }),
        bubble: bubble(host('bb', 640, 400), { title: 'Accounts', data: dots, x: 'x', y: 'y', size: { field: 's', label: 'Revenue' } }),
        violin: cartesian(host('vio', 900, 360), { title: 'Spread by group', data: violin.data, x: { field: 'x', label: 'Group' }, axes: { v: { position: 'left' } }, layers: [{ type: 'violin', yAxis: 'v', label: 'Spread' }] }),
        treemap: treemap(host('tm', 640, 420), { title: 'Tree as rectangles', data: tree }),
        sunburst: sunburst(host('sb', 520, 520), { title: 'Tree as rings', data: tree }),
      };
      charts.treemap.drill('B1');
      charts.sunburst.drill('B0');
      (window as unknown as Record<string, unknown>).__charts = charts;
      (window as unknown as Record<string, unknown>).__exp = { exportSvg, exportPng, exportPngDataUrl, exportCsv, parseCsv };
    `,
  })).url;
  exportOnlyUrl = (await bundle({
    name: 'w4-export-only',
    cwd: fixture('npm'),
    format: 'esm',
    conditions: ['production'],
    contents: `
      import * as api from 'axylo/export';
      (window as unknown as Record<string, unknown>).__exp2 = api;
    `,
  })).url;
});

afterAll(async () => {
  await closeBrowser();
  await server?.close();
});

type Api = { exportSvg(t: unknown, o?: unknown): string; exportCsv(t: unknown): string; parseCsv(s: string): string[][] };
type Live = { listeners: string[]; observers: string[]; frames: number };

async function openPage() {
  const policy = cspPolicy('w4').replace("default-src 'self';", "default-src 'self'; img-src 'self' blob: data:;");
  server.pages.set('/w4.html', {
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/npm/node_modules/axylo/dist/axylo.css"><script src="/pages/instrument.js"></script></head><body>${
      ['hm', 'bb', 'vio', 'tm', 'sb'].map(id => `<div id="${id}"></div>`).join('')}<script type="module" src="${chartsUrl}"></script><script type="module" src="${exportOnlyUrl}"></script></body></html>`,
    headers: { 'content-security-policy': policy },
  });
  const watched = await open(server);
  await watched.page.goto(`${server.origin}/w4.html`);
  await watched.page.waitForFunction(() => {
    const w = window as unknown as { __charts?: object; __exp?: object; __exp2?: object };
    return !!w.__charts && !!w.__exp && !!w.__exp2;
  });
  for (const sel of ['#hm .axylo-scene path', '#bb .axylo-scene path', '#vio .axylo-scene path', '#tm .axylo-hierarchy-marks > *', '#sb .axylo-hierarchy-marks > *']) {
    await watched.page.waitForSelector(sel, { state: 'attached' });
  }
  await watched.page.waitForTimeout(150);
  return watched;
}

/** In the page: the exported SVG of `selector` and what the live figure's family chrome shows. */
function familyChrome(selector: string) {
  const w = window as unknown as { __exp: Api; __exp2: Api };
  const text = w.__exp.exportSvg(selector);
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const shown = (el: Element) => !el.closest('[hidden]') && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
  const root = document.querySelector(selector)!;
  const live = (sel: string) => [...root.querySelectorAll(sel)].filter(shown).map(e => (e.textContent ?? '').trim()).filter(Boolean);
  const svg = doc.documentElement;
  return {
    same: w.__exp2.exportSvg(selector) === text,
    parseError: !!doc.querySelector('parsererror'),
    hasVar: text.includes('var(--'),
    width: Number(svg.getAttribute('width')), height: Number(svg.getAttribute('height')),
    title: svg.querySelector(':scope > title')?.textContent ?? null,
    texts: [...svg.querySelectorAll(':scope > g text, :scope > g > g text')].filter(t => !t.closest('svg svg')).map(t => (t.textContent ?? '').trim()),
    nested: [...svg.querySelectorAll(':scope > g svg, :scope > g > g svg')].map(s => ({
      circles: s.querySelectorAll('circle').length,
      stops: [...s.querySelectorAll('linearGradient stop')].map(stop => ({ color: stop.getAttribute('color') ?? '', stopColor: stop.getAttribute('stop-color') ?? '' })),
      // The gradient's paint as a standalone image resolves it: each stop's stop-color, laid out in the page.
      stopColors: (() => {
        const holder = document.createElement('div');
        holder.style.position = 'fixed';
        holder.style.left = '-20000px';
        const copy = document.importNode(s, true) as Element;
        holder.appendChild(copy);
        document.body.appendChild(holder);
        const colors = [...copy.querySelectorAll('linearGradient stop')].map(stop => getComputedStyle(stop).getPropertyValue('stop-color'));
        holder.remove();
        return colors;
      })(),
      gradientFill: [...s.querySelectorAll('rect')].some(r => /^url\(#/.test(r.getAttribute('fill') ?? '')),
      paths: s.querySelectorAll('path').length,
      shapes: [...s.querySelectorAll('path, rect')].filter(e => !e.closest('defs')).length,
      paints: [...s.querySelectorAll('path, rect')].filter(e => !e.closest('defs')).map(e => [e.getAttribute('fill') ?? '', e.getAttribute('stroke') ?? ''] as const),
      area: Number(s.getAttribute('width')) * Number(s.getAttribute('height')),
      svgTexts: [...s.querySelectorAll('text')].map(t => (t.textContent ?? '').trim()),
    })),
    live: {
      heatmapTitle: live('.axylo-heatmap-scale-title'),
      heatmapTicks: live('.axylo-heatmap-tick'),
      heatmapStops: root.querySelectorAll('.axylo-heatmap-stop').length,
      bubbleCircles: root.querySelectorAll('.axylo-bubble-legend circle').length,
      bubbleValues: live('.axylo-bubble-legend-value'),
      bubbleTitle: live('.axylo-bubble-legend .axylo-legend-name'),
      hierarchyTitle: live('.axylo-h-title'),
      crumbs: live('.axylo-h-crumbs [data-node]'),
      current: live('.axylo-h-current'),
      note: live('.axylo-h-note'),
      hierarchyMarks: root.querySelectorAll('.axylo-hierarchy-marks path, .axylo-hierarchy-marks rect').length,
      hierarchyLabels: live('.axylo-hierarchy-labels text'),
    },
  };
}

/**
 * In the page: `exportPng` itself (the Blob, not the data-URL convenience), read back as a data URL so the N7b
 * PNG check (export-conformance.ts expectPng) decodes it. The Blob must say it is a PNG.
 */
async function pngBlobExport(args: { selector: string; scale: number }): Promise<string> {
  const api = (window as unknown as { __exp: { exportPng(t: string, o?: unknown): Promise<Blob> } }).__exp;
  const blob = await api.exportPng(args.selector, { scale: args.scale });
  if (blob.type !== 'image/png') return `not a PNG blob: ${blob.type}`;
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** In the page: the export capability's committed table size and page size, through the handle. */
function tableOf(key: string) {
  const charts = (window as unknown as { __charts: Record<string, object> }).__charts;
  const seam = (charts[key] as Record<symbol, { table: { rowCount: number; pageSize: number } | null } | undefined>)[Symbol.for('axylo.export')];
  return seam?.table ? { rowCount: seam.table.rowCount, pageSize: seam.table.pageSize } : null;
}

/** In the page: CSV of `selector` through both export bundles, by target and by handle. */
function csvEverywhere([selector, key]: [string, string]) {
  const w = window as unknown as { __exp: Api; __exp2: Api; __charts: Record<string, object> };
  const handle = w.__charts[key]!;
  return [w.__exp.exportCsv(selector), w.__exp2.exportCsv(selector), w.__exp.exportCsv(handle), w.__exp2.exportCsv(handle)];
}

const ROWS: Record<string, number> = { heatmap: HEATMAP_ROWS, bubble: BUBBLES, violin: GROUPS, treemap: HIERARCHY_NODES, sunburst: HIERARCHY_NODES };
const SELECTOR: Record<string, string> = { heatmap: '#hm', bubble: '#bb', violin: '#vio', treemap: '#tm', sunburst: '#sb' };

describe('W4 heatmap colour bar colours in an exported SVG (packed Chrome)', () => {
  // Spec (export contract CHROME, the W4 brief): the exported colour bar is the actual bar, so its gradient
  // stops carry the colours the page shows. The heatmap colours its stops through inline CSS only; export.ts
  // copies each stop's computed `stop-color` as a presentation attribute.
  it('each exported gradient stop has the live stop\'s resolved colour', async () => {
    const watched = await openPage();
    try {
      const live = await watched.page.evaluate(() => [...document.querySelectorAll('#hm .axylo-heatmap-stop')].map(s => getComputedStyle(s).getPropertyValue('stop-color')));
      const hm = await watched.page.evaluate(familyChrome, '#hm');
      const bar = hm.nested.find(n => n.stops.length > 0)!;
      expect(live.length).toBeGreaterThan(1);
      expect(new Set(live).size).toBeGreaterThan(1);
      expect(bar.stopColors).toEqual(live);
    } finally {
      await watched.context.close();
    }
  });
});

describe('W4 spatial, hierarchy and violin export in packed Chrome', () => {
  it('each family draws, exports its whole figure with its chrome as SVG and PNG (1x, 2x), every row as CSV closed and open, and leaves nothing live after destroy', async () => {
    const watched = await openPage();
    const { page } = watched;
    try {
      // ── Core-figure families: the N7b whole-figure conformance, plus each family's own chrome.
      for (const key of ['heatmap', 'bubble', 'violin'] as const) {
        const s: ExportSummary = await page.evaluate(summarizeExport, { selector: SELECTOR[key]! });
        expectWholeFigure(s);
        for (const scale of [1, 2]) {
          expectPng(await page.evaluate(pngExport, { selector: SELECTOR[key]!, scale }), s, scale);
          expectPng(await page.evaluate(pngBlobExport, { selector: SELECTOR[key]!, scale }), s, scale);
        }
      }
      const hm = await page.evaluate(familyChrome, '#hm');
      expect(hm.same, 'both export bundles give the same heatmap SVG').toBe(true);
      expect(hm.live.heatmapTitle).toEqual(['Load']);
      expect(hm.live.heatmapTicks.length).toBeGreaterThan(1);
      for (const t of [...hm.live.heatmapTitle, ...hm.live.heatmapTicks]) expect(hm.texts, `colour bar text "${t}"`).toContain(t);
      const bar = hm.nested.find(n => n.stops.length > 0);
      expect(bar, 'the colour bar is exported with its gradient').toBeDefined();
      expect(bar!.stops.length).toBe(hm.live.heatmapStops);
      expect(bar!.gradientFill, 'the bar is filled by its own gradient').toBe(true);
      // The stops' colours themselves: see the separate test above.

      const bb = await page.evaluate(familyChrome, '#bb');
      expect(bb.same).toBe(true);
      expect(bb.live.bubbleTitle).toEqual(['Revenue']);
      // Reference sizes (spatial/bubble/legend.ts referenceSizes): the nice floors of 120, 120 / 4 and 120 / 16.
      expect(bb.live.bubbleValues).toEqual(['100', '25', '5']);
      const sizeLegend = bb.nested.find(n => n.circles > 0);
      expect(sizeLegend, 'the nested-circle size legend is exported').toBeDefined();
      expect(sizeLegend!.circles).toBe(bb.live.bubbleCircles);
      for (const t of [...bb.live.bubbleTitle, ...bb.live.bubbleValues]) expect(bb.texts, `size legend text "${t}"`).toContain(t);

      // ── Hierarchy: its own figure (no .axylo-figure): title, the drilled breadcrumb, marks, labels and note.
      for (const key of ['treemap', 'sunburst'] as const) {
        const h = await page.evaluate(familyChrome, SELECTOR[key]!);
        expect(h.parseError).toBe(false);
        expect(h.hasVar).toBe(false);
        expect(h.same).toBe(true);
        expect(h.title).toBe(key === 'treemap' ? 'Tree as rectangles' : 'Tree as rings');
        expect(h.texts).toContain(h.live.hierarchyTitle[0]);
        expect(h.live.crumbs).toEqual(['Root', DRILLED[key]]);
        expect(h.live.current).toEqual([DRILLED[key]]);
        for (const crumb of h.live.crumbs) expect(h.texts, `breadcrumb "${crumb}"`).toContain(crumb);
        expect(h.live.note).toEqual(['Values not shown: 1.']);
        expect(h.texts).toContain('Values not shown: 1.');
        // The plot surface: the largest nested SVG. Its focus ring and hover outline (the overlay) are not exported.
        const plot = [...h.nested].sort((a, b) => b.area - a.area)[0]!;
        expect(h.live.hierarchyMarks).toBeGreaterThan(0);
        expect(plot.shapes, 'every live mark is exported, and only those').toBe(h.live.hierarchyMarks);
        expect(paintedShapes(plot), `${key} plot has painted marks (exported paints: ${JSON.stringify([...new Set(plot.paints.flat())].slice(0, 8))})`).toBeGreaterThan(0);
        for (const label of h.live.hierarchyLabels) expect(plot.svgTexts, `label "${label}"`).toContain(label);
        for (const scale of [1, 2]) {
          expectPng(await page.evaluate(pngExport, { selector: SELECTOR[key]!, scale }), { width: h.width, height: h.height } as ExportSummary, scale);
          expectPng(await page.evaluate(pngBlobExport, { selector: SELECTOR[key]!, scale }), { width: h.width, height: h.height } as ExportSummary, scale);
        }
      }

      // ── CSV: every committed row, table closed then open (several pages), the same through every route.
      for (const key of ['heatmap', 'bubble', 'violin', 'treemap', 'sunburst'] as const) {
        const table = await page.evaluate(tableOf, key);
        expect(table, `${key} has a committed table`).not.toBeNull();
        expect(table!.rowCount, `${key} model rows`).toBe(ROWS[key]);
        expect(table!.rowCount).toBeGreaterThan(50);
        expect(Math.ceil(table!.rowCount / table!.pageSize), `${key} pages`).toBeGreaterThan(1);
        const before = await page.evaluate(csvEverywhere, [SELECTOR[key]!, key] as [string, string]);
        const c = await csvClosedOpen(page, SELECTOR[key]!, key);
        expectClosedOpenCsv(c, ROWS[key]!);
        // The reader pages forward: page 2 shows the rows after the first page, and the export does not change.
        await page.locator(SELECTOR[key]!).getByRole('button', { name: /Next page/i }).click();
        const second = 1 + table!.pageSize;
        await page.waitForFunction(([sel, first]) => document.querySelector(`${sel} table tbody tr`)?.querySelector('th, td')?.textContent === first,
          [SELECTOR[key]!, c.parsed[second]![0]!] as [string, string]);
        const shown = await page.evaluate(sel => [...document.querySelectorAll(`${sel} table tbody tr`)].map(tr => [...tr.querySelectorAll('th, td')].map(e => e.textContent ?? '')), SELECTOR[key]!);
        expect(shown, `${key} page 2 rows`).toEqual(c.parsed.slice(second, second + shown.length));
        const after = await page.evaluate(csvEverywhere, [SELECTOR[key]!, key] as [string, string]);
        for (const text of [...before, ...after]) expect(text).toBe(c.closedTarget);
        const body = c.parsed.slice(1);
        if (key === 'heatmap') expect(body.map(r => r[0])).toEqual(Array.from({ length: HEATMAP_ROWS }, (_, i) => `R${i}`));
        else if (key === 'violin') expect(body.map(r => r[0])).toEqual(Array.from({ length: GROUPS }, (_, i) => `G${i}`));
        else if (key === 'bubble') expect(body.map(r => [r[0], r[3]])).toEqual(BUBBLE_ROWS);
        else expect(body.map(r => r[0])).toEqual(HIERARCHY_PATHS);
      }
      // Paging and exporting kept the drilled roots; the sunburst's Root crumb (a button) drills back up.
      const drilled = () => {
        const charts = (window as unknown as { __charts: Record<string, { drilled: { id: string } }> }).__charts;
        return [charts.treemap!.drilled.id, charts.sunburst!.drilled.id];
      };
      expect(await page.evaluate(drilled)).toEqual(['B1', 'B0']);
      await page.locator('#sb .axylo-h-crumbs button', { hasText: 'Root' }).click();
      await page.waitForFunction(() => document.querySelector('#sb .axylo-h-current')?.textContent === 'Root');
      expect(await page.evaluate(drilled)).toEqual(['B1', 'Root']);

      // ── Teardown: every chart destroyed, nothing that responds is left (spec DX8).
      const live: Live & { figures: number; registered: boolean[] } = await page.evaluate(async () => {
        const w = window as unknown as { __charts: Record<string, { destroy(): void }>; __live(): Live; __exp: Api };
        for (const chart of Object.values(w.__charts)) chart.destroy();
        await new Promise(r => setTimeout(r, 100));
        const registered = ['#hm', '#bb', '#vio', '#tm', '#sb'].map(sel => { try { w.__exp.exportCsv(sel); return true; } catch { return false; } });
        return { ...w.__live(), figures: document.querySelectorAll('figure').length, registered };
      });
      expect(live.figures).toBe(0);
      expect(live.registered, 'no export capability answers after destroy').toEqual([false, false, false, false, false]);
      expect(live.listeners, 'listeners still registered').toEqual([]);
      expect(live.observers, 'observers still observing').toEqual([]);
      expect(live.frames, 'animation frames still pending').toBe(0);
      // The fixture's negative leaf is the one finding expected on this page (AX190, printed once per page);
      // anything else printed as a warning or an error, or any page error, fails.
      const printed = problems(watched);
      const expectedWarning = (p: string) => p.startsWith('warning: [axylo AX190] ');
      expect(printed.filter(expectedWarning), 'the negative leaf is reported as AX190').toHaveLength(1);
      expect(printed.filter(p => !expectedWarning(p)), 'no unexpected warning or error').toEqual([]);
    } finally {
      await watched.context.close();
    }
  });
});
