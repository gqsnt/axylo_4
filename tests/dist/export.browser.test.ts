/**
 * Packed real-Chrome browser integration test for `axylo/export` (C6.1):
 * verifies standalone SVG serialization (resolved colors, zero `var(--axylo-...)`, concrete `<text>`
 * labels, `<title>`/`<desc>` metadata, exact dimensions), PNG rasterization at 2x DPR (`image/png`
 * Blob + decoded pixel dimensions), and RFC 4180 CSV parity against Axylo's rendered accessible table.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bundle, closeBrowser, cspPolicy, drawn, launch, open, startServer, type Server } from './browser';
import { fixture } from './paths';
import {
  csvClosedOpen, expectClosedOpenCsv, expectPng, expectWholeFigure, luminance, marksInBand, plotOf, pngExport, pngRegion, summarizeExport,
} from './export-conformance';

let server: Server;
let scriptUrl: string;
let figureUrl: string;
let exportOnlyUrl: string;

beforeAll(async () => {
  server = await startServer();
  await launch();
  scriptUrl = (await bundle({
    name: 'export-e2e',
    cwd: fixture('npm'),
    format: 'esm',
    conditions: ['production'],
    contents: `
      import { line } from 'axylo/static';
      import { exportSvg, exportPng, exportPngDataUrl, exportCsv, parseCsv } from 'axylo/export';

      const el = document.getElementById('chart')!;
      el.style.width = '600px';
      el.style.height = '300px';
      const rows = [
        { month: 'Jan', rev: 1200 },
        { month: 'Feb', rev: 1450 },
        { month: 'Mar', rev: 1380 },
      ];
      const chart = line('#chart', {
        title: 'Monthly Revenue',
        data: rows,
        x: { field: 'month', ordered: true },
        y: { field: 'rev', label: 'Revenue', unit: 'USD' },
      });
      (window as unknown as Record<string, unknown>).__exp = {
        chart, exportSvg, exportPng, exportPngDataUrl, exportCsv, parseCsv, rows,
      };
    `,
  })).url;
  // N7b: whole figures (caption, legend, plot, note) of root, cartesian and finance charts, light and dark,
  // and charts whose tables have several pages.
  figureUrl = (await bundle({
    name: 'export-figure-e2e',
    cwd: fixture('npm'),
    format: 'esm',
    conditions: ['production'],
    contents: `
      import { line, bar, donut } from 'axylo';
      import { cartesian } from 'axylo/cartesian';
      import { candlestick } from 'axylo/finance';
      import { exportSvg, exportPng, exportPngDataUrl, exportCsv, parseCsv } from 'axylo/export';

      // Sizes and the dark scheme through the CSSOM: the page's CSP has no 'unsafe-inline' style.
      const host = (id: string, width: number, height: number, dark = false) => {
        const el = document.getElementById(id)!;
        el.style.width = width + 'px';
        el.style.height = height + 'px';
        if (dark) { el.style.colorScheme = 'dark'; el.style.background = 'rgb(18, 18, 18)'; el.style.color = 'rgb(232, 232, 232)'; }
        return el;
      };
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const day = Date.UTC(2026, 0, 1);
      const ohlc = Array.from({ length: 200 }, (_, i) => ({
        d: new Date(day + i * 86400000), o: 100 + i, h: 104 + i, l: 97 + i, c: i % 3 ? 102 + i : 98 + i, v: 1000 + 10 * i,
      }));
      const charts = {
        line: line(host('line', 640, 400), {
          title: 'Revenue and cost', subtitle: 'Fiscal year 2026, in USD', locale: 'en-US',
          // May's revenue is not a number: the reader's note says a value is not shown (F12).
          data: months.map((m, i) => ({ m, rev: i === 4 ? Number.NaN : 1000 + 50 * i, cost: 800 + 30 * i })),
          x: { field: 'm', ordered: true }, y: [{ field: 'rev', label: 'Revenue' }, { field: 'cost', label: 'Cost' }],
        }),
        bar: bar(host('bar', 360, 360), {
          title: 'Visits by long category name', locale: 'en-US',
          data: months.map((m, i) => ({ c: m + ' campaign landing page ' + (i + 1), v: 10 + i })),
          x: 'c', y: { field: 'v', label: 'Visits' },
        }),
        donut: donut(host('donut', 560, 360), {
          title: 'Share by channel', locale: 'en-US', legend: 'right',
          data: [{ ch: 'Direct', v: 40 }, { ch: 'Search', v: 30 }, { ch: 'Social', v: 20 }, { ch: 'Email', v: 10 }],
          label: 'ch', value: 'v',
        }),
        cartesian: cartesian(host('cart', 680, 420, true), {
          title: 'Orders and latency', subtitle: 'Two axes, dark scheme', locale: 'en-US',
          data: months.map((m, i) => ({ m, orders: 100 + 9 * i, ms: 20 + 3 * i })),
          x: 'm',
          axes: { orders: { position: 'left', label: 'Orders' }, ms: { position: 'right', scale: 'log', label: 'Latency', unit: 'ms' } },
          layers: [{ type: 'bar', y: 'orders', yAxis: 'orders' }, { type: 'line', y: 'ms', yAxis: 'ms' }],
          annotations: [{ type: 'threshold', axis: 'y', value: 150, axisId: 'orders', label: 'Target' }],
        }),
        finance: candlestick(host('fin', 720, 440), {
          title: 'OHLC, light', subtitle: '200 sessions with volume', locale: 'en-US',
          data: ohlc, x: 'd', open: 'o', high: 'h', low: 'l', close: 'c', volume: 'v',
        }),
        financeDark: candlestick(host('findark', 720, 440, true), {
          title: 'OHLC, dark', subtitle: '200 sessions with volume', locale: 'en-US',
          data: ohlc, x: 'd', open: 'o', high: 'h', low: 'l', close: 'c', volume: 'v',
        }),
        // One swatch per mark kind (spec A5): bar, area, line, range, error bar.
        swatches: cartesian(host('swatches', 720, 420), {
          title: 'Every mark kind', locale: 'en-US',
          // The error bar has its own bounds: a field bound to two layers is rejected with AX174 (cartesian/options.ts).
          data: months.map((m, i) => ({ m, a: 10 + i, b: 5 + i, c: 20 - i, lo: 8 + i, hi: 14 + i, mid: 11 + i, errLo: 9 + i, errHi: 13 + i })),
          x: 'm', axes: { y: { position: 'left', label: 'Value' } },
          layers: [
            // Line, bar and area layers take their series name from the field (cartesian/options.ts), not the layer.
            { type: 'bar', y: { field: 'a', label: 'Bars' }, yAxis: 'y' }, { type: 'area', y: { field: 'b', label: 'Area' }, yAxis: 'y' },
            { type: 'line', y: { field: 'c', label: 'Line' }, yAxis: 'y' }, { type: 'range', low: 'lo', high: 'hi', yAxis: 'y', label: 'Band' },
            { type: 'errorBar', y: 'mid', low: 'errLo', high: 'errHi', yAxis: 'y', label: 'Error' },
          ],
        }),
        // The author's plot background (--axylo-background), which the renderer paints in the plot.
        background: line((() => { const el = host('bg', 480, 300); el.style.setProperty('--axylo-background', '#182030'); el.style.color = 'rgb(232, 232, 232)'; return el; })(), {
          title: 'Plot background', locale: 'en-US', data: months.map((m, i) => ({ m, v: 10 + i })), x: { field: 'm', ordered: true }, y: 'v',
        }),
        hidden: line(host('hidden', 480, 300), {
          title: { text: 'Hidden heading', visible: false }, subtitle: 'Visible subtitle', locale: 'en-US',
          data: months.map((m, i) => ({ m, v: 10 + i })), x: { field: 'm', ordered: true }, y: 'v',
        }),
        pending: line(host('pending', 480, 300), {
          title: 'Pending updates', locale: 'en-US', data: months.slice(0, 5).map((m, i) => ({ m, v: 10 + i })), x: { field: 'm', ordered: true }, y: 'v',
        }),
        remount: line(host('remount', 480, 300), {
          title: 'First mount', locale: 'en-US', data: months.slice(0, 3).map((m, i) => ({ m, v: 10 + i })), x: { field: 'm', ordered: true }, y: 'v',
        }),
        many: line(host('many', 640, 320), {
          title: 'Four hundred days', locale: 'en-US',
          data: Array.from({ length: 400 }, (_, i) => ({ day: i + 1, value: (i + 1) * 10 })),
          x: 'day', y: { field: 'value', label: 'Value' },
        }),
      };
      // A plain table, not a chart: CSV reads its cells as shown.
      const plain = document.getElementById('plain')!;
      const table = document.createElement('table');
      for (const [tag, cells] of [['th', ['Name', 'Note']], ['td', ['Ada', 'says "hi", twice']]] as const) {
        const tr = document.createElement('tr');
        for (const text of cells) { const cell = document.createElement(tag); cell.textContent = text; tr.appendChild(cell); }
        (tag === 'th' ? table.createTHead() : table.createTBody()).appendChild(tr);
      }
      plain.appendChild(table);
      // A Wave 4-style family (export/contract.ts): its own figure and a plot that is not .axylo-svg, a colour
      // bar marked data-axylo-export, a part that is not chrome, and a 230-row table, registered by hand.
      const w4 = host('w4', 420, 300);
      const make = (tag: string, parent: Element, text?: string, ns?: string) => {
        const e = ns ? document.createElementNS(ns, tag) : document.createElement(tag);
        if (text) e.textContent = text;
        parent.appendChild(e);
        return e;
      };
      const SVG = 'http://www.w3.org/2000/svg';
      const fig = make('figure', w4);
      fig.setAttribute('aria-label', 'Wave 4 fixture');
      make('div', make('div', fig), 'Fixture heatmap').className = 'axylo-title';
      (fig.firstElementChild as HTMLElement).className = 'axylo-caption';
      const plot = make('div', fig);
      const surface = make('svg', plot, undefined, SVG);
      for (const [k, v] of [['width', '400'], ['height', '200'], ['viewBox', '0 0 400 200']]) surface.setAttribute(k, v);
      const scene = make('g', surface, undefined, SVG);
      scene.setAttribute('class', 'axylo-scene');
      for (let i = 0; i < 8; i++) {
        const cell = make('rect', scene, undefined, SVG);
        for (const [k, v] of [['x', String(i * 50)], ['y', '0'], ['width', '50'], ['height', '200'], ['fill', 'rgb(' + 30 * i + ', 0, 120)']]) cell.setAttribute(k, v);
      }
      // Not named 'bar': a module-level const would shadow the imported bar() for the whole module (TDZ).
      const colourBar = make('div', fig);
      colourBar.setAttribute('data-axylo-export', 'colour-bar');
      const barSvg = make('svg', colourBar, undefined, SVG);
      for (const [k, v] of [['width', '200'], ['height', '10'], ['viewBox', '0 0 200 10']]) barSvg.setAttribute(k, v);
      const barRect = make('rect', barSvg, undefined, SVG);
      for (const [k, v] of [['width', '200'], ['height', '10'], ['fill', 'rgb(0, 0, 120)']]) barRect.setAttribute(k, v);
      make('span', colourBar, '0 to 100');
      make('div', fig, 'Not part of the figure');
      const cells = Array.from({ length: 230 }, (_, i) => ['r' + (i + 1), String(i * 3)]);
      const tableModel = { caption: 'Cells', headers: ['Cell', 'Value'], rowCount: 230, pageSize: 50, row: (i: number) => cells[i] ?? null, pageForX: () => null };
      const registry = ((globalThis as unknown as Record<symbol, WeakMap<object, object>>)[Symbol.for('axylo.export')] ??= new WeakMap());
      const capability = Object.freeze({ table: tableModel, figure: fig, plot });
      registry.set(fig, capability).set(w4, capability);
      Object.assign(window as unknown as Record<string, unknown>, {
        __exp: { exportSvg, exportPng, exportPngDataUrl, exportCsv, parseCsv }, __charts: charts,
        __remount: () => line('#remount', {
          title: 'Second mount', locale: 'en-US', data: months.slice(0, 7).map((m, i) => ({ m, v: 100 + i })), x: { field: 'm', ordered: true }, y: 'v',
        }),
      });
    `,
  })).url;
});

beforeAll(async () => {
  // axylo/export bundled on its own, loaded as a second module: it reaches the other bundle's charts only
  // through the shared registry and the handle symbol.
  exportOnlyUrl = (await bundle({
    name: 'export-only-e2e',
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

describe('C6.1 axylo/export packed Chrome integration', () => {
  it('exports self-contained SVG, 2x PNG Blob/dataURL, and exact accessible-table CSV', async () => {
    // Allow blob: / data: only for img-src so exportPng rasterization works alongside strict script-src/style-src 'self'.
    const policy = cspPolicy('export').replace("default-src 'self';", "default-src 'self'; img-src 'self' blob: data:;");
    server.pages.set('/export.html', {
      html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/npm/node_modules/axylo/dist/axylo.css"></head><body><div id="chart"></div><script type="module" src="${scriptUrl}"></script></body></html>`,
      headers: { 'content-security-policy': policy },
    });

    const watched = await open(server);
    const { page, errors } = watched;
    await page.goto(`${server.origin}/export.html`);
    try {
      await page.waitForSelector('#chart svg g path');
      await page.waitForTimeout(120);

      // 1. Standalone SVG check
      const svgResult = await page.evaluate(() => {
        const api = (window as unknown as { __exp: { exportSvg(t: string, o?: unknown): string } }).__exp;
        const svg = api.exportSvg('#chart', { width: 600, height: 300 });
        return {
          startsSvg: svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'),
          hasVar: svg.includes('var(--axylo'),
          hasTitle: svg.includes('<title>Monthly Revenue</title>'),
          hasDesc: svg.includes('<desc>'),
          hasText: svg.includes('<text '),
          hasWidth: svg.includes('width="600"'),
          hasHeight: svg.includes('height="300"'),
          length: svg.length,
        };
      });
      expect(svgResult.startsSvg).toBe(true);
      expect(svgResult.hasVar).toBe(false);
      expect(svgResult.hasTitle).toBe(true);
      expect(svgResult.hasDesc).toBe(true);
      expect(svgResult.hasText).toBe(true);
      expect(svgResult.hasWidth).toBe(true);
      expect(svgResult.hasHeight).toBe(true);
      expect(svgResult.length).toBeGreaterThan(400);

      // 2. PNG rasterization check at 2x scale -> decoded image is exactly 1200x600
      const pngResult = await page.evaluate(async () => {
        const api = (window as unknown as {
          __exp: {
            exportPng(t: string, o?: unknown): Promise<Blob>;
            exportPngDataUrl(t: string, o?: unknown): Promise<string>;
          };
        }).__exp;
        const blob = await api.exportPng('#chart', { width: 600, height: 300, scale: 2 });
        const dataUrl = await api.exportPngDataUrl('#chart', { width: 600, height: 300, scale: 2 });
        const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = reject;
          img.src = dataUrl;
        });
        return { type: blob.type, size: blob.size, isPngUrl: dataUrl.startsWith('data:image/png;base64,'), ...dims };
      });
      expect(pngResult.type).toBe('image/png');
      expect(pngResult.size).toBeGreaterThan(1000);
      expect(pngResult.isPngUrl).toBe(true);
      expect(pngResult.w).toBe(1200);
      expect(pngResult.h).toBe(600);

      // 3. Open accessible table and verify exportCsv('#chart') matches exact rendered table rows
      await page.getByRole('button', { name: /View as table/i }).click();
      await page.waitForSelector('#chart table tbody tr');
      const csvRows = await page.evaluate(() => {
        const api = (window as unknown as {
          __exp: { exportCsv(t: string): string; parseCsv(s: string): string[][] };
        }).__exp;
        return api.parseCsv(api.exportCsv('#chart'));
      });
      expect(csvRows).toHaveLength(4); // header + 3 months
      expect(csvRows[0]).toEqual(['month', 'Revenue (USD)']);
      expect(csvRows[1]![0]).toBe('Jan');
      expect(csvRows[1]![1]).toContain('1,200');
      expect(csvRows[3]![0]).toBe('Mar');

      expect(errors).toEqual([]);
      expect(server.reports.get('export') ?? []).toEqual([]);
    } finally {
      await watched.context.close();
    }
  });
});

/**
 * Runs in the page. Without `report` (for waitForFunction) it is true once the fixture module has
 * finished (`__charts`, `__exp`, and the separate bundle's `__exp2`) and every chart draws a data mark;
 * otherwise it returns the initialisation flags and each chart's mark count. A data mark is a shape with
 * geometry painted through a series paint (the browser.ts chartState rule) or through finance's semantic
 * paints (--axylo-up / --axylo-down / --axylo-volume, finance/render.ts), or a canvas with a painted pixel.
 */
function paintedMarks({ selectors, report }: { selectors: string[]; report: boolean }): boolean | Record<string, number | boolean> {
  const w = window as unknown as Record<string, unknown>;
  const initialized = !!w.__charts && !!w.__exp && !!w.__exp2;
  const data = /--axylo-(series-|up|down|volume)/;
  const count = (sel: string) => {
    const root = document.querySelector(sel);
    if (!root) return 0;
    let marks = 0;
    for (const el of Array.from(root.querySelectorAll<SVGGraphicsElement>('.axylo-scene path, .axylo-scene rect, .axylo-scene circle, .axylo-scene line, .axylo-scene polyline'))) {
      const geometry = el.tagName.toLowerCase() === 'path'
        ? (el.getAttribute('d') ?? '').trim().length > 1
        : (() => { const b = el.getBBox(); return b.width > 0 || b.height > 0; })();
      if (!geometry) continue;
      let painted: Element | null = el;
      let color = '';
      while (painted && painted !== root && !color) { color = (painted as SVGElement).style?.getPropertyValue('color') ?? ''; painted = painted.parentElement; }
      if (data.test(color)) marks++;
    }
    for (const canvas of Array.from(root.querySelectorAll('canvas'))) {
      const ctx = canvas.getContext('2d');
      if (!ctx || canvas.width === 0 || canvas.height === 0) continue;
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== 0) { marks++; break; }
    }
    return marks;
  };
  if (!report) return initialized && selectors.every(sel => count(sel) > 0);
  return Object.fromEntries<number | boolean>([['initialized', initialized], ...selectors.map(sel => [sel, count(sel)] as [string, number])]);
}

describe('N7b whole-figure SVG/PNG and closed-table CSV (packed Chrome)', () => {
  const ids = ['line', 'bar', 'donut', 'cart', 'fin', 'findark', 'swatches', 'bg', 'hidden', 'pending', 'remount', 'many', 'w4', 'plain'];
  const charts = ['line', 'bar', 'donut', 'cart', 'fin', 'findark', 'swatches', 'bg', 'hidden', 'pending', 'remount', 'many'];
  async function openFigures() {
    const policy = cspPolicy('export-figure').replace("default-src 'self';", "default-src 'self'; img-src 'self' blob: data:;");
    server.pages.set('/export-figure.html', {
      html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/npm/node_modules/axylo/dist/axylo.css"></head><body>${
        ids.map(id => `<div id="${id}"></div>`).join('')}<script type="module" src="${figureUrl}"></script><script type="module" src="${exportOnlyUrl}"></script></body></html>`,
      headers: { 'content-security-policy': policy },
    });
    const watched = await open(server);
    const { page } = watched;
    // One bounded wait for the whole page, cut short by the first page error: a fixture that throws while
    // building its charts must name the error at once, not spend a 10 s mark wait on every chart after it.
    let failed: (error: Error) => void = () => {};
    const pageError = new Promise<never>((_, reject) => { failed = reject; });
    pageError.catch(() => {});
    const onError = (e: Error) => failed(new Error(`export-figure page error: ${String(e)}`));
    page.on('pageerror', onError);
    const selectors = charts.map(id => `#${id}`);
    try {
      await page.goto(`${server.origin}/export-figure.html`);
      const ready = page.waitForFunction(paintedMarks, { selectors, report: false }, { timeout: 15000, polling: 50 });
      ready.catch(() => {});
      try {
        await Promise.race([ready, pageError]);
      } catch (error) {
        const counts = await page.evaluate(paintedMarks, { selectors, report: true }).catch(() => null);
        throw new Error(`export-figure fixture not ready: ${error instanceof Error ? error.message : String(error)}\n`
          + `page errors: ${JSON.stringify(watched.errors)}; state: ${JSON.stringify(counts)}`);
      }
      const counts = await page.evaluate(paintedMarks, { selectors, report: true }) as Record<string, number | boolean>;
      console.info(`export-figure marks: ${JSON.stringify(counts)}`);
      for (const sel of selectors) expect(counts[sel], `${sel} draws marks`).toBeGreaterThan(0);
    } catch (error) {
      await watched.context.close();
      throw error;
    } finally {
      page.off('pageerror', onError);
    }
    await page.waitForTimeout(150);
    return watched;
  }

  it('composes caption, legend swatches, plot, rotated labels and note, light and dark, at 1x and 2x', async () => {
    const watched = await openFigures();
    const { page, errors } = watched;
    try {
      for (const selector of ['#line', '#bar', '#donut', '#cart', '#fin', '#findark', '#swatches', '#bg', '#many']) {
        const s = await page.evaluate(summarizeExport, { selector });
        console.info(`${selector}: ${s.width}x${s.height}, ${s.texts.length} texts, ${s.svgs.length} svgs, dom ${JSON.stringify(s.dom)}`);
        expectWholeFigure(s);
        // Default size is the figure's own (the viewBox keeps its fractional size).
        expect(Math.abs(s.width - s.viewBox[2]!)).toBeLessThanOrEqual(0.5);
        for (const scale of [1, 2]) expectPng(await page.evaluate(pngExport, { selector, scale }), s, scale);
      }

      const line = await page.evaluate(summarizeExport, { selector: '#line' });
      expect(line.dom.title).toBe('Revenue and cost');
      expect(line.dom.subtitle).toBe('Fiscal year 2026, in USD');
      expect(line.dom.legend).toEqual(['Revenue', 'Cost']);
      expect(line.dom.swatches).toBe(2);
      expect(line.dom.note, 'the fixture shows a reader note').toBeTruthy();
      expect(luminance(line.background!)).toBeGreaterThan(0.8);
      expect(luminance(line.texts.find(t => t.text === 'Revenue and cost')!.fill)).toBeLessThan(0.3);

      const bar = await page.evaluate(summarizeExport, { selector: '#bar' });
      // Twelve long categories in 360 px: the labels are rotated (and the exported texts keep each angle).
      expect(bar.dom.rotatedLabels, 'the fixture rotates labels').toBeGreaterThan(0);

      const donut = await page.evaluate(summarizeExport, { selector: '#donut' });
      expect(donut.dom.legend).toEqual(['Direct', 'Search', 'Social', 'Email']);
      expect(donut.dom.legendValues).toHaveLength(4);
      expect(donut.dom.legendValues.join(' ')).toMatch(/40%/);
      const donutPlot = plotOf(donut);
      // legend: 'right': the legend values sit to the right of the ring.
      for (const value of donut.dom.legendValues) {
        expect(donut.texts.some(t => value.includes(t.text) && t.x > donutPlot.x + donutPlot.width)).toBe(true);
      }

      for (const selector of ['#cart', '#findark']) {
        const dark = await page.evaluate(summarizeExport, { selector });
        expect(dark.background).toBe('rgb(18, 18, 18)');
        expect(luminance(dark.texts.find(t => t.text === dark.dom.title)!.fill), `${selector} title is light on dark`).toBeGreaterThan(0.5);
      }
      const cart = await page.evaluate(summarizeExport, { selector: '#cart' });
      expect(cart.texts.some(t => t.text === 'Target'), 'annotation label').toBe(true);
      // Both axes' series are drawn: the bars (left axis) and the line (right axis) in their own colours.
      const paints = new Set(cart.marks.flatMap(m => [m.fill, m.stroke]).filter(p => /^(rgb|#)/.test(p) && luminance(p) > 0.05 && luminance(p) < 0.95));
      expect(paints.size, 'two series colours in the exported scene').toBeGreaterThanOrEqual(2);
      for (const label of ['Orders', 'Latency (ms)']) expect(cart.texts.some(t => t.text === label), `axis title ${label}`).toBe(true);
      // Finance: candles in the price pane and bars in the volume pane, both exported.
      for (const selector of ['#fin', '#findark']) {
        const fin = await page.evaluate(summarizeExport, { selector });
        expect(marksInBand(fin, 0, 0.6), `${selector} price pane marks`).toBeGreaterThan(0);
        expect(marksInBand(fin, 0.7, 1), `${selector} volume pane marks`).toBeGreaterThan(0);
      }
      // One swatch per mark kind, each drawing that kind's shape: five different geometries.
      const kinds = await page.evaluate(summarizeExport, { selector: '#swatches' });
      expect(kinds.dom.legend).toEqual(['Bars', 'Area', 'Line', 'Band', 'Error']);
      expect(kinds.swatchShapes).toHaveLength(5);
      expect(new Set(kinds.swatchShapes).size, 'bar, area, line, range and error-bar swatches differ').toBe(5);

      // Background: the author's plot background is in the plot's pixels by default; an explicit colour or
      // transparency replaces it there too, at 1x and 2x.
      const bg = await page.evaluate(summarizeExport, { selector: '#bg' });
      const plotBox = plotOf(bg);
      for (const scale of [1, 2]) {
        const own = pngRegion(await page.evaluate(pngExport, { selector: '#bg', scale }), plotBox, scale, [24, 32, 48]);
        expect(own.matching, `default keeps --axylo-background in the plot at ${scale}x`).toBeGreaterThan(0.5);
        const magenta = pngRegion(await page.evaluate(pngExport, { selector: '#bg', scale, options: { background: '#ff00ff' } }), plotBox, scale, [255, 0, 255]);
        expect(magenta.matching, `explicit background fills the plot at ${scale}x`).toBeGreaterThan(0.5);
        const clear = pngRegion(await page.evaluate(pngExport, { selector: '#bg', scale, options: { background: 'transparent' } }), plotBox, scale, [24, 32, 48]);
        expect(clear.transparent, `transparent leaves the plot clear at ${scale}x`).toBeGreaterThan(0.5);
        expect(clear.matching).toBe(0);
      }

      // plotOnly keeps the plot alone (no caption, legend or note); width/height scale the drawing.
      for (const selector of ['#line', '#donut', '#cart', '#swatches']) {
        const only = await page.evaluate(summarizeExport, { selector, options: { plotOnly: true } });
        expectWholeFigure(only, { plotOnly: true });
        // The legend's labels are not drawn outside the plot, and no swatch is exported (expectWholeFigure).
      }
      const sized = await page.evaluate(summarizeExport, { selector: '#fin', options: { width: 360, height: 220 } });
      expect([sized.width, sized.height]).toEqual([360, 220]);
      expectPng(await page.evaluate(pngExport, { selector: '#fin', scale: 2, options: { width: 360, height: 220 } }), sized, 2);

      // Exporting never changes the page.
      const before = await page.evaluate(() => document.body.innerHTML.length);
      await page.evaluate(summarizeExport, { selector: '#cart' });
      expect(await page.evaluate(() => document.body.innerHTML.length)).toBe(before);

      expect(errors).toEqual([]);
      expect(server.reports.get('export-figure') ?? []).toEqual([]);
    } finally {
      await watched.context.close();
    }
  });

  it('exports every row with the table closed and open, byte-identical, by target and by handle', async () => {
    const watched = await openFigures();
    const { page, errors } = watched;
    try {
      const fin = await csvClosedOpen(page, '#fin', 'finance');
      expectClosedOpenCsv(fin, 200);
      expect(fin.shownRows).toHaveLength(50);

      const many = await csvClosedOpen(page, '#many', 'many');
      expectClosedOpenCsv(many, 400);
      expect(many.parsed[0]).toEqual(['day', 'Value']);
      for (let k = 0; k < 400; k++) {
        expect(many.parsed[k + 1]).toEqual([(k + 1).toLocaleString('en-US'), ((k + 1) * 10).toLocaleString('en-US')]);
      }
      // With the table open, the figure export is still the chart (the table is a control, not the figure).
      expectWholeFigure(await page.evaluate(summarizeExport, { selector: '#many' }));

      const plain = await page.evaluate(() => {
        const api = (window as unknown as { __exp: { exportCsv(t: string): string; parseCsv(s: string): string[][] } }).__exp;
        return api.parseCsv(api.exportCsv('#plain'));
      });
      expect(plain).toEqual([['Name', 'Note'], ['Ada', 'says "hi", twice']]);

      expect(errors).toEqual([]);
    } finally {
      await watched.context.close();
    }
  });
  it('reads committed state across separate bundles: hidden title, pending and rejected updates, destroy and remount, a Wave 4 family', async () => {
    const watched = await openFigures();
    const { page, errors } = watched;
    type Api = { exportSvg(t: unknown, o?: unknown): string; exportCsv(t: unknown): string; parseCsv(s: string): string[][] };
    try {
      // The second, separately bundled copy of axylo/export gives the same bytes as the first, by target and by handle.
      const same = await page.evaluate(() => {
        const w = window as unknown as { __exp: Api; __exp2: Api; __charts: Record<string, object> };
        return ['#fin', '#cart', '#many'].map(sel => [w.__exp.exportCsv(sel), w.__exp2.exportCsv(sel), w.__exp2.exportCsv(w.__charts[{ '#fin': 'finance', '#cart': 'cartesian', '#many': 'many' }[sel]!]!)]);
      });
      for (const [a, b, c] of same) { expect(b).toBe(a); expect(c).toBe(a); }
      expect(await page.evaluate(() => (window as unknown as { __exp: Api; __exp2: Api }).__exp2.exportSvg('#cart') === (window as unknown as { __exp: Api }).__exp.exportSvg('#cart'))).toBe(true);

      // A hidden title is not drawn, but it still names the image.
      const hidden = await page.evaluate(summarizeExport, { selector: '#hidden' });
      expect(hidden.dom.title).toBeNull();
      expect(hidden.texts.some(t => t.text.includes('Hidden heading'))).toBe(false);
      expect(hidden.texts.some(t => t.text === 'Visible subtitle')).toBe(true);
      expect(hidden.title).toBe('Hidden heading');
      expectWholeFigure(hidden);

      // Pending and rejected updates: the export is what is drawn, until the next frame draws the update.
      const pending = await page.evaluate(() => {
        const w = window as unknown as { __exp: Api; __charts: Record<string, { update(p: unknown): void }> };
        const chart = w.__charts.pending!;
        const before = w.__exp.exportCsv('#pending');
        chart.update({ data: Array.from({ length: 9 }, (_, i) => ({ m: 'M' + i, v: i })) });
        const whilePending = w.__exp.exportCsv('#pending');
        let rejected = false;
        try { chart.update({ strict: true, x: 'missing-field' }); } catch { rejected = true; }
        return { before, whilePending, afterRejected: w.__exp.exportCsv('#pending'), rejected };
      });
      expect(pending.whilePending).toBe(pending.before);
      expect(pending.rejected).toBe(true);
      expect(pending.afterRejected).toBe(pending.before);
      await page.waitForTimeout(150);
      const drawnRows = await page.evaluate(() => (window as unknown as { __exp: Api }).__exp.parseCsv((window as unknown as { __exp: Api }).__exp.exportCsv('#pending')));
      expect(drawnRows).toHaveLength(10);

      // Destroy, then mount again on the same element: never the destroyed chart's rows.
      const destroyed = await page.evaluate(() => {
        const w = window as unknown as { __exp: Api; __charts: Record<string, { destroy(): void }>; __remount(): object };
        const chart = w.__charts.remount!;
        const first = w.__exp.parseCsv(w.__exp.exportCsv('#remount')).length;
        chart.destroy();
        let afterDestroy = '';
        try { w.__exp.exportCsv('#remount'); } catch (e) { afterDestroy = String(e); }
        let handleAfter = '';
        try { w.__exp.exportCsv(chart); } catch (e) { handleAfter = String(e); }
        (w as unknown as Record<string, object>).__second = w.__remount();
        return { first, afterDestroy, handleAfter };
      });
      expect(destroyed.first).toBe(4);
      expect(destroyed.afterDestroy).toMatch(/axylo\/export/);
      expect(destroyed.handleAfter).toMatch(/no committed data table/);
      await drawn(page, '#remount');
      const second = await page.evaluate(() => {
        const w = window as unknown as { __exp: Api; __second: object };
        return { target: w.__exp.exportCsv('#remount'), handle: w.__exp.exportCsv(w.__second), svg: w.__exp.exportSvg('#remount') };
      });
      expect(second.target).toBe(second.handle);
      expect(second.target.split('\r\n')).toHaveLength(8);
      expect(second.svg).toContain('Second mount');
      expect(second.svg).not.toContain('First mount');

      // A Wave 4-style family registered by hand: its own plot (no .axylo-svg), its colour bar, its table.
      const w4 = await page.evaluate(() => {
        const w = window as unknown as { __exp: Api; __exp2: Api };
        return { svg: w.__exp.exportSvg('#w4'), plotOnly: w.__exp.exportSvg('#w4', { plotOnly: true }), csv: w.__exp2.parseCsv(w.__exp2.exportCsv('#w4')) };
      });
      expect(w4.svg).toContain('Fixture heatmap');
      expect(w4.svg).toContain('0 to 100');
      expect(w4.svg).toContain('<title>Wave 4 fixture</title>');
      expect(w4.svg).not.toContain('Not part of the figure');
      expect(w4.svg.match(/<rect x="\d+" y="0" width="50" height="200"/g)).toHaveLength(8);
      expect(w4.plotOnly).not.toContain('0 to 100');
      expect(w4.plotOnly).not.toContain('Fixture heatmap');
      expect(w4.csv).toHaveLength(231);
      expect(w4.csv[230]).toEqual(['r230', String(229 * 3)]);

      expect(errors).toEqual([]);
    } finally {
      await watched.context.close();
    }
  });
});

describe('N7b exportSvg keeps a transformed SVG viewport where the page paints it (packed Chrome)', () => {
  it('preserves the painted corners of a transformed SVG viewport at its live figure position', async () => {
    // A plain figure (no chart): off-centre rotation, unequal scale and translation over a viewBox mapping.
    server.pages.set('/transformed-viewport.html', { html: `<!doctype html>
      <style>
        figure { position: fixed; left: 41px; top: 37px; margin: 0; width: 400px; height: 240px }
        #plot { position: absolute; left: 80px; top: 50px }
        #surface { transform: translate(17px, 11px) rotate(28deg) scale(1.25, .8); transform-origin: 13px 7px }
      </style>
      <figure><div id="plot"><svg id="surface" width="96" height="52" viewBox="0 0 40 20">
        <rect x="4" y="3" width="27" height="11" />
      </svg></div></figure><script type="module" src="${exportOnlyUrl}"></script>` });
    const { context, page } = await open(server);
    try {
      await page.goto(server.origin + '/transformed-viewport.html');
      const { live, copy } = await page.evaluate(() => {
        const figure = document.querySelector('figure')!;
        const markup = (window as unknown as { __exp2: { exportSvg: (target: Element) => string } }).__exp2.exportSvg(figure);
        const image = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;
        // Measure the standalone export in its own document, without the source page's transforms.
        const frame = document.createElement('iframe');
        document.body.append(frame);
        const doc = frame.contentDocument!;
        doc.body.style.margin = '0';
        const rendered = doc.body.appendChild(doc.importNode(image, true));
        const corners = (mark: SVGGraphicsElement, surface: Element) => {
          const origin = surface.getBoundingClientRect(), transform = mark.getScreenCTM()!;
          return [[4, 3], [31, 3], [31, 14], [4, 14]].flatMap(([x, y]) => {
            const point = new DOMPoint(x, y).matrixTransform(transform);
            return [point.x - origin.left, point.y - origin.top];
          });
        };
        return {
          live: corners(figure.querySelector('rect')!, figure),
          copy: corners(rendered.querySelector('#surface rect')!, rendered),
        };
      });
      expect(live).toHaveLength(8);
      for (let i = 0; i < live.length; i++) expect(copy[i]).toBeCloseTo(live[i]!, 2);
    } finally {
      await context.close();
    }
  });
});
