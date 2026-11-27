/**
 * Packed real-Chrome browser integration test for `axylo/cartesian` (C4.3, RFC §5 & §8):
 * verifies dual-axis (linear bar + log line) rendering under strict CSP, tooltip/keyboard/table parity
 * including nonpositive log rows (`AX171`), editable `chart.update()` (rename + secondary domain),
 * and responsive `< 360 px` right-axis collapse (`AX175` added & cleared on resize back to `640 px`).
 *
 * N4 adds, on a second page built from formulas shared with the test: a 100,000-point dual-axis line + bar chart
 * whose drawn line path stays within four vertices per pixel column (spec F5) at full range and after zoom; two
 * nonpositive log values disclosed (AX171, note) and read with the same raw value by keyboard, pointer and table
 * (F13); right-axis ticks and title shown, collapsed at 320 px and restored at 960 px with no overlapping axis text
 * (L9, AX175, summary); and signed, incomplete stacked bars and areas checked against the fixture's geometry and
 * read with the same totals by keyboard, pointer, table and summary (F10). State is awaited by polling the DOM.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { bundle, closeBrowser, cspPolicy, launch, open, startServer, type Server } from './browser';
import { fixture } from './paths';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let server: Server;
let scriptUrl: string;
let denseUrl: string;

// The N4 dense fixture: 100,000 minutes; a log line with two nonpositive values (slots 1 and 2) and one peak,
// and integer bars on a linear left axis. The page builds the same columns from the same formulas.
const DENSE_N = 100_000;
const MINUTE = 60_000;
const DENSE_START = Date.UTC(2026, 0, 1);
const DENSE_PEAK = 54_321;
const denseLatency = (i: number) => (i === 1 ? 0 : i === 2 ? -5 : i === DENSE_PEAK ? 9000 : 100 + (i * 7919) % 900);
const denseOrders = (i: number) => 20 + (i * 37) % 180;
/** A latency reading as the log line words it: nonpositive values are kept, qualified, never projected (F13). */
const latencyText = (i: number) => (denseLatency(i) > 0 ? `${denseLatency(i)} ms` : `${denseLatency(i)} ms (not plotted)`);

// The N4 signed-stack fixture (spec F10): bars a + b on the left axis, areas c + d on the right axis.
const STACK_ROWS = [
  { m: 1, a: 10, b: -3, c: 4, d: 2 },
  { m: 2, a: -5, b: 6, c: 3, d: null },
  { m: 3, a: 4, b: null, c: -2, d: 5 },
] as const;

// Chrome binds its ProcessSingleton socket at $TMPDIR/com.google.Chrome.XXXXXX/SingletonSocket and aborts when that
// path exceeds sockaddr_un.sun_path (108 bytes with the NUL), which deeply nested CI workspaces' TMPDIR does. Only
// then, on Linux, Chrome is launched with TMPDIR at a fresh directory inside this test directory, spelt through the
// short /proc/self/cwd link: Playwright passes process.env and no cwd, so Chrome inherits the worker's cwd and the
// spelling names the same directory in both processes. Normal runs with a short TMPDIR are left alone.
const SOCKET_PATH_MAX = 107;
const singletonSocketBytes = (dir: string) => Buffer.byteLength(path.join(dir, 'com.google.Chrome.XXXXXX', 'SingletonSocket'));
let chromeTmp: string | undefined;

async function launchWithShortTmpdir(): Promise<void> {
  if (process.platform !== 'linux' || singletonSocketBytes(os.tmpdir()) <= SOCKET_PATH_MAX) { await launch(); return; }
  chromeTmp = fs.mkdtempSync(path.join(import.meta.dirname, 'cartesian-chrome-tmp-'));
  const relative = path.relative(process.cwd(), chromeTmp);
  // The link only names chromeTmp while the relative path stays below the cwd.
  const linked = !relative.startsWith('..') && !path.isAbsolute(relative) ? path.join('/proc/self/cwd', relative) : chromeTmp;
  const short = singletonSocketBytes(chromeTmp) <= SOCKET_PATH_MAX ? chromeTmp : linked;
  if (singletonSocketBytes(short) > SOCKET_PATH_MAX) {
    throw new Error(`no Chrome TMPDIR short enough for its singleton socket: ${short} (cwd ${process.cwd()})`);
  }
  const saved = process.env.TMPDIR;
  process.env.TMPDIR = short;
  try {
    await launch();
  } finally {
    if (saved === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = saved;
  }
}

beforeAll(async () => {
  server = await startServer();
  await launchWithShortTmpdir();
  scriptUrl = (await bundle({
    name: 'cartesian-e2e',
    cwd: fixture('npm'),
    format: 'esm',
    conditions: ['production'],
    contents: `
      import { cartesian } from 'axylo/cartesian';
      const el = document.getElementById('chart')!;
      el.style.width = '640px';
      el.style.height = '320px';
      const rows = [
        { month: 'Jan', orders: 120, latency: 10 },
        { month: 'Feb', orders: 260, latency: 0 },
        { month: 'Mar', orders: 410, latency: 100 },
        { month: 'Apr', orders: 320, latency: 1000 },
      ];
      const chart = cartesian('#chart', {
        title: 'Orders vs p99 Latency',
        data: rows,
        x: { field: 'month', ordered: true },
        axes: {
          orders: { position: 'left', scale: 'linear', label: 'Orders', unit: 'qty' },
          latency: { position: 'right', scale: 'log', base: 10, label: 'Latency', unit: 'ms' },
        },
        layers: [
          { type: 'bar', y: 'orders', yAxis: 'orders' },
          { type: 'line', y: 'latency', yAxis: 'latency' },
        ],
        reference: [{ y: 100, axisId: 'latency', label: 'SLA 100ms' }],
      });
      (window as unknown as { __cart: typeof chart }).__cart = chart;
    `,
  })).url;
  denseUrl = (await bundle({
    name: 'cartesian-n4',
    cwd: fixture('npm'),
    format: 'esm',
    conditions: ['production'],
    contents: `
      import { cartesian } from 'axylo/cartesian';
      // The same formulas as the test's DENSE_* helpers: integer values, so every reading is exact.
      const n = ${DENSE_N};
      const t = new Float64Array(n), latency = new Float64Array(n), orders = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        t[i] = ${DENSE_START} + i * ${MINUTE};
        latency[i] = i === 1 ? 0 : i === 2 ? -5 : i === ${DENSE_PEAK} ? 9000 : 100 + (i * 7919) % 900;
        orders[i] = 20 + (i * 37) % 180;
      }
      const dense = document.getElementById('dense')!;
      dense.style.width = '960px';
      dense.style.height = '360px';
      const big = cartesian(dense, {
        title: 'Dense dual axis', data: { columns: { t, latency, orders } }, x: { field: 't', type: 'time', timeZone: 'UTC' },
        axes: { orders: { position: 'left', label: 'Orders', unit: 'qty' }, latency: { position: 'right', scale: 'log', label: 'Latency', unit: 'ms' } },
        layers: [{ type: 'bar', y: 'orders', yAxis: 'orders' }, { type: 'line', y: 'latency', yAxis: 'latency' }],
        zoom: true,
      });
      const stacks = document.getElementById('stacks')!;
      // Inside the test context's 900 px viewport (tests/dist/browser.ts), so a real pointer reaches every slot.
      stacks.style.width = '860px';
      stacks.style.height = '320px';
      const stacked = cartesian(stacks, {
        title: 'Signed stacks', data: ${JSON.stringify(STACK_ROWS)}, x: 'm', axes: { v: { position: 'left' }, w: { position: 'right' } },
        layers: [{ type: 'bar', y: ['a', 'b'], yAxis: 'v', stacked: true }, { type: 'area', y: ['c', 'd'], yAxis: 'w', stacked: true }],
      });
      Object.assign(window, { __dense: big, __stacked: stacked });
    `,
  })).url;
});

afterAll(async () => {
  try {
    await closeBrowser();
    await server?.close();
  } finally {
    // After closeBrowser: Playwright removes its profile and artifacts dirs (created under this one) on close.
    if (chromeTmp) fs.rmSync(chromeTmp, { recursive: true, force: true });
  }
});

describe('axylo/cartesian packed Chrome integration under strict CSP', () => {
  it('renders bars + log line + dual y-axes, preserves nonpositive log values in table, supports update() and L9 resize collapse', async () => {
    server.pages.set('/cartesian.html', {
      html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/npm/node_modules/axylo/dist/axylo.css"></head><body><div id="chart"></div><script type="module" src="${scriptUrl}"></script></body></html>`,
      headers: { 'content-security-policy': cspPolicy('cartesian') },
    });

    const watched = await open(server);
    const { page, errors } = watched;
    await page.goto(`${server.origin}/cartesian.html`);
    try {
      await page.waitForSelector('#chart svg g rect');
      await page.waitForSelector('#chart svg g path');
      await page.waitForTimeout(100);

      const initial = await page.evaluate(() => {
        const chart = (window as unknown as { __cart: { diagnostics: readonly { code: string }[] } }).__cart;
        const rects = document.querySelectorAll('#chart svg g rect').length;
        const paths = document.querySelectorAll('#chart svg g path').length;
        const tickTexts = [...document.querySelectorAll('#chart .axylo-text span')].map(el => el.textContent ?? '');
        const note = document.querySelector('#chart .axylo-note')?.textContent ?? '';
        return { rects, paths, tickTexts, note, codes: chart.diagnostics.map(d => d.code) };
      });
      expect(initial.rects).toBeGreaterThanOrEqual(4);
      expect(initial.paths).toBeGreaterThanOrEqual(1);
      expect(initial.codes).toContain('AX171');
      expect(initial.note).toMatch(/Values not shown: 1/);

      // Open data table and verify raw 0 ms value is preserved with log qualifier
      await page.getByRole('button', { name: /View as table/i }).click();
      await page.waitForSelector('#chart table tbody tr');
      const tableText = await page.evaluate(() =>
        [...document.querySelectorAll('#chart table tbody tr')].map(tr =>
          [...tr.querySelectorAll('th,td')].map(td => td.textContent?.trim() ?? ''),
        ));
      expect(tableText).toHaveLength(4);
      expect(tableText[1]![2]).toBe('0 ms (not plotted — log)');
      await page.getByRole('button', { name: /Hide table/i }).click();

      // Update label + secondary domain cleanly
      await page.evaluate(() => {
        const chart = (window as unknown as { __cart: { update(p: unknown): void } }).__cart;
        chart.update({
          axes: {
            orders: { position: 'left', label: 'Monthly Orders', unit: 'qty', domain: [0, 500] },
            latency: { position: 'right', scale: 'log', base: 10, label: 'Latency', unit: 'ms', domain: [1, 10000] },
          },
        });
      });
      await page.waitForTimeout(100);
      const updatedText = await page.evaluate(() => document.querySelector('#chart .axylo-text')?.textContent ?? '');
      expect(updatedText).toContain('Monthly Orders');

      // Resize below 360 px -> AX175 emitted and accessible summary updated; resize back to 640 px -> both cleared
      const readSummary = () => page.evaluate(() => {
        const fig = document.querySelector('#chart [aria-describedby]');
        const id = fig?.getAttribute('aria-describedby');
        return (id ? document.getElementById(id)?.textContent : '') ?? '';
      });
      expect(await readSummary()).not.toContain('Secondary right axis');

      await page.evaluate(() => { (document.getElementById('chart') as HTMLElement).style.width = '300px'; });
      await page.waitForTimeout(150);
      const narrowState = await page.evaluate(() => {
        const fig = document.querySelector('#chart [aria-describedby]');
        const id = fig?.getAttribute('aria-describedby');
        return {
          codes: (window as unknown as { __cart: { diagnostics: readonly { code: string }[] } }).__cart.diagnostics.map(d => d.code),
          summary: (id ? document.getElementById(id)?.textContent : '') ?? '',
        };
      });
      expect(narrowState.codes).toContain('AX175');
      expect(narrowState.summary).toContain('Secondary right axis');

      // Narrow -> too-small (height 50px) clears AX175 and collapsed-axis summary; back to narrow restores both
      await page.evaluate(() => { (document.getElementById('chart') as HTMLElement).style.height = '50px'; });
      await page.waitForTimeout(150);
      const tooSmallState = await page.evaluate(() => {
        const fig = document.querySelector('#chart [aria-describedby]');
        const id = fig?.getAttribute('aria-describedby');
        return {
          codes: (window as unknown as { __cart: { diagnostics: readonly { code: string }[] } }).__cart.diagnostics.map(d => d.code),
          summary: (id ? document.getElementById(id)?.textContent : '') ?? '',
        };
      });
      expect(tooSmallState.codes).not.toContain('AX175');
      expect(tooSmallState.summary).not.toContain('Secondary right axis');

      await page.evaluate(() => { (document.getElementById('chart') as HTMLElement).style.height = '320px'; });
      await page.waitForTimeout(150);
      const narrowAgain = await page.evaluate(() => {
        const fig = document.querySelector('#chart [aria-describedby]');
        const id = fig?.getAttribute('aria-describedby');
        return {
          codes: (window as unknown as { __cart: { diagnostics: readonly { code: string }[] } }).__cart.diagnostics.map(d => d.code),
          summary: (id ? document.getElementById(id)?.textContent : '') ?? '',
        };
      });
      expect(narrowAgain.codes).toContain('AX175');
      expect(narrowAgain.summary).toContain('Secondary right axis');

      await page.evaluate(() => { (document.getElementById('chart') as HTMLElement).style.width = '640px'; });
      await page.waitForTimeout(150);
      const wideStateAfter = await page.evaluate(() => {
        const fig = document.querySelector('#chart [aria-describedby]');
        const id = fig?.getAttribute('aria-describedby');
        return {
          codes: (window as unknown as { __cart: { diagnostics: readonly { code: string }[] } }).__cart.diagnostics.map(d => d.code),
          summary: (id ? document.getElementById(id)?.textContent : '') ?? '',
        };
      });
      expect(wideStateAfter.codes).not.toContain('AX175');
      expect(wideStateAfter.summary).not.toContain('Secondary right axis');

      // Strict-mode invalid update rolls back facade state cleanly so a subsequent valid update succeeds
      const rollbackOk = await page.evaluate(() => {
        const chart = (window as unknown as { __cart: { update(p: unknown): void; diagnostics: readonly { code: string }[] } }).__cart;
        let threw = false;
        try {
          chart.update({ strict: true, layers: [{ type: 'bar', y: 'orders', yAxis: 'latency' }] });
        } catch {
          threw = true;
        }
        chart.update({ strict: false, title: 'After Rollback' });
        return { threw, has173: chart.diagnostics.some(d => d.code === 'AX173') };
      });
      expect(rollbackOk).toEqual({ threw: true, has173: false });

      expect(errors).toEqual([]);
      expect(server.reports.get('cartesian') ?? []).toEqual([]);
    } finally {
      await watched.context.close();
    }
  });
});

describe('axylo/cartesian N4 in packed Chrome: dense decimation, signed and incomplete stacks, L9 restore', () => {
  type Handle = { diagnostics: readonly { code: string; field?: string; count?: number }[]; zoom(range: readonly [number, number] | null): void };
  type Box = { x: number; y: number; width: number; height: number };
  const page = () => `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/npm/node_modules/axylo/dist/axylo.css"></head><body><div id="dense"></div><div id="stacks"></div><script type="module" src="${denseUrl}"></script></body></html>`;
  const POLL = { timeout: 20_000 };

  /** Vertex count of the longest series-painted path (pen lifts are M commands, not vertices). */
  const longestPath = (p: Page, id: string) => p.evaluate(sel => {
    let best = 0;
    const scene = document.querySelector(`#${sel} .axylo-scene`);
    for (const path of Array.from(document.querySelectorAll(`#${sel} .axylo-scene path`))) {
      const d = path.getAttribute('d') ?? '';
      if (d.includes('Z')) continue;
      // Only data strokes: grid and tick rules can be batched into one path too, painted with --axylo-grid/axis.
      let at: Element | null = path;
      let paint = '';
      while (at && at !== scene && !paint) { paint = (at as SVGElement).style?.getPropertyValue('color') ?? ''; at = at.parentElement; }
      if (!paint.includes('--axylo-series-')) continue;
      const count = (d.match(/[ML]/g) ?? []).length;
      if (count > best) best = count;
    }
    return best;
  }, id);
  /** The plot (the scene clip rectangle, render/svg.ts) in page px. */
  const plotBox = (p: Page, id: string) => p.evaluate(sel => {
    const svg = document.querySelector(`#${sel} svg.axylo-svg`)!;
    const o = svg.getBoundingClientRect();
    const r = svg.querySelector('defs clipPath rect')!;
    return { x: o.x + Number(r.getAttribute('x')), y: o.y + Number(r.getAttribute('y')), width: Number(r.getAttribute('width')), height: Number(r.getAttribute('height')) };
  }, id);
  /** The axis texts the layout placed (role and box, page px). */
  const texts = (p: Page, id: string) => p.evaluate(sel => Array.from(document.querySelectorAll(`#${sel} .axylo-text [data-role]`), el => {
    const r = el.getBoundingClientRect();
    return { role: el.getAttribute('data-role') ?? '', text: (el.textContent ?? '').trim(), box: { x: r.x, y: r.y, width: r.width, height: r.height } };
  }).filter(l => l.text && l.box.width > 0), id);
  const overlap = (a: Box, b: Box) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;
  const overlapping = (list: readonly { text: string; box: Box }[]) => {
    const out: string[] = [];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (overlap(list[i]!.box, list[j]!.box)) out.push(`${list[i]!.text} × ${list[j]!.text}`);
    return out;
  };
  const summary = (p: Page, id: string) => p.evaluate(sel => {
    const fig = document.querySelector(`#${sel} [aria-describedby]`);
    const describedBy = fig?.getAttribute('aria-describedby');
    return (describedBy ? document.getElementById(describedBy)?.textContent : '') ?? '';
  }, id);
  const handle = (p: Page, name: '__dense' | '__stacked') => p.evaluate(n => (window as unknown as Record<string, Handle>)[n]!.diagnostics.map(d => ({ code: d.code, field: d.field, count: d.count })), name);
  const cursorX = (p: Page, id: string) => p.evaluate(sel => {
    const line = document.querySelector(`#${sel} .axylo-overlay line`);
    const svg = document.querySelector(`#${sel} svg.axylo-svg`)!.getBoundingClientRect();
    return line ? svg.x + Number(line.getAttribute('x1')) : null;
  }, id);
  /** Keyboard reading after a key: waits for the proxy's text to name the expected point. */
  const readingAt = async (p: Page, id: string, point: number) => {
    const proxy = p.locator(`#${id} .axylo-proxy`);
    await expect.poll(async () => (await proxy.getAttribute('aria-valuetext')) ?? '', POLL).toMatch(new RegExp(`Point ${point} of \\d+`));
    await expect.poll(() => cursorX(p, id), POLL).not.toBeNull();
    return { text: (await proxy.getAttribute('aria-valuetext')) ?? '', x: (await cursorX(p, id))! };
  };
  /** A pointer x for a slot's cursor x: the first and last slots sit on the plot's edges, and the rule is snapped to
   *  the pixel grid, so it is moved one pixel inside the plot (slots here are tens of pixels apart). */
  const inside = (x: number, box: Box) => Math.min(box.x + box.width - 1, Math.max(box.x + 1, x));
  const tooltipText = (p: Page, id: string) => {
    const tip = p.locator(`#${id} .axylo-tooltip, #${id} .axylo-readout`).filter({ visible: true });
    return async () => ((await tip.count()) === 1 ? (await tip.textContent()) ?? '' : '');
  };

  it('draws 100,000 points with a bounded path, discloses the log omission, keeps pointer, keyboard and table on the same raw datum, and collapses and restores the right axis at 960 → 320 → 960 px', async () => {
    server.pages.set('/cartesian-n4.html', { html: page(), headers: { 'content-security-policy': cspPolicy('cartesian-n4') } });
    const watched = await open(server);
    const { page: p, errors } = watched;
    await p.goto(`${server.origin}/cartesian-n4.html`);
    try {
      // F5: at most four kept samples per device-pixel column of a < 960 px plot (DPR 1), never 100,000.
      await expect.poll(() => longestPath(p, 'dense'), POLL).toBeGreaterThan(100);
      const full = await longestPath(p, 'dense');
      const plot = await plotBox(p, 'dense');
      const dpr = await p.evaluate(() => devicePixelRatio);
      // simplify/index.ts columnLimit: four samples per device-pixel column, plus the two clipped ends per run.
      const bound = (width: number) => 4 * Math.ceil(width * dpr) + 8;
      expect(full).toBeLessThanOrEqual(bound(plot.width));

      // F13 / AX171: two nonpositive latency values, counted once for the field, disclosed in the note.
      const ax171 = (await handle(p, '__dense')).filter(d => d.code === 'AX171');
      expect(ax171).toEqual([{ code: 'AX171', field: 'latency', count: 2 }]);
      expect(await p.locator('#dense .axylo-note').textContent()).toMatch(/Values not shown: 2\b/);

      // Right axis present at 960 px: its ticks and title sit right of the plot; no axis text overlaps.
      const wide = await texts(p, 'dense');
      const rightOf = (list: typeof wide, box: Box) => list.filter(l => (l.role === 'tick-y' || l.role === 'title-y') && l.box.x >= box.x + box.width - 0.5);
      expect(rightOf(wide, plot).some(l => l.role === 'tick-y')).toBe(true);
      expect(rightOf(wide, plot).map(l => l.text)).toContain('Latency (ms)');
      expect(overlapping(wide)).toEqual([]);

      // A real pointer over the full 100,000 points (the plot's centre is inside the 900 px viewport even though the
      // chart is 960 px wide): the tooltip reads both series (raw values, any one slot).
      const fullTip = tooltipText(p, 'dense');
      await p.mouse.move(plot.x + plot.width * 0.5, plot.y + plot.height * 0.5);
      await expect.poll(fullTip, POLL).toMatch(/\d qty[\s\S]*\d ms|\d ms[\s\S]*\d qty/);
      await p.mouse.move(1, 1);

      // Zoom into the first 21 minutes: slots are tens of pixels apart, so pointer, keyboard and table name one datum.
      await p.evaluate(([a, b]) => (window as unknown as { __dense: Handle }).__dense.zoom([a, b]), [DENSE_START, DENSE_START + 20 * MINUTE] as const);
      await expect.poll(() => longestPath(p, 'dense'), POLL).toBeLessThan(40);
      // Slots 1 and 2 are not drawn on the log axis, so slot 0 stands alone and the path starts at slot 3.
      expect(await longestPath(p, 'dense')).toBeGreaterThanOrEqual(18);
      const proxy = p.locator('#dense .axylo-proxy');
      await proxy.focus();
      await p.keyboard.press('Home');
      const readings: { text: string; x: number }[] = [];
      readings.push(await readingAt(p, 'dense', 1));
      for (const point of [2, 3]) {
        await p.keyboard.press('ArrowRight');
        readings.push(await readingAt(p, 'dense', point));
      }
      for (let i = 0; i < 3; i++) {
        expect(readings[i]!.text).toContain(`${denseOrders(i)} qty`);
        expect(readings[i]!.text).toContain(latencyText(i));
      }
      expect(readings[1]!.x).toBeGreaterThan(readings[0]!.x);
      expect(readings[2]!.x).toBeGreaterThan(readings[1]!.x);
      await proxy.blur();
      const zoomedPlot = await plotBox(p, 'dense');
      const tip = tooltipText(p, 'dense');
      for (let i = 0; i < 3; i++) {
        await p.mouse.move(inside(readings[i]!.x, zoomedPlot), zoomedPlot.y + zoomedPlot.height * 0.5);
        await expect.poll(tip, POLL).toContain(latencyText(i));
        expect(await tip()).toContain(`${denseOrders(i)} qty`);
      }
      await p.mouse.move(1, 1);
      await p.locator('#dense').getByRole('button', { name: /View as table/i }).click();
      await p.waitForSelector('#dense table tbody tr');
      const rows = await p.evaluate(() => Array.from(document.querySelectorAll('#dense table tbody tr'), tr => Array.from(tr.querySelectorAll('th,td'), c => c.textContent?.trim() ?? '')));
      for (let i = 0; i < 3; i++) {
        expect(rows[i]![1]).toBe(`${denseOrders(i)} qty`);
        expect(rows[i]![2]).toBe(denseLatency(i) > 0 ? `${denseLatency(i)} ms` : `${denseLatency(i)} ms (not plotted — log)`);
      }
      await p.locator('#dense').getByRole('button', { name: /Hide table/i }).click();

      // Back to the full range: the drawing is bounded again.
      await p.evaluate(() => (window as unknown as { __dense: Handle }).__dense.zoom(null));
      await expect.poll(() => longestPath(p, 'dense'), POLL).toBeGreaterThan(100);
      expect(await longestPath(p, 'dense')).toBeLessThanOrEqual(bound(plot.width));

      // L9: at 320 px the right axis collapses (AX175, summary sentence, no right-axis texts); at 960 px it returns.
      const codes = async () => (await handle(p, '__dense')).map(d => d.code);
      await p.evaluate(() => { (document.getElementById('dense') as HTMLElement).style.width = '320px'; });
      await expect.poll(codes, POLL).toContain('AX175');
      await expect.poll(() => summary(p, 'dense'), POLL).toContain('Secondary right axis (Latency (ms))');
      const narrowPlot = await plotBox(p, 'dense');
      const narrow = await texts(p, 'dense');
      expect(rightOf(narrow, narrowPlot)).toEqual([]);
      expect(overlapping(narrow)).toEqual([]);
      await p.evaluate(() => { (document.getElementById('dense') as HTMLElement).style.width = '960px'; });
      await expect.poll(codes, POLL).not.toContain('AX175');
      await expect.poll(() => summary(p, 'dense'), POLL).not.toContain('Secondary right axis');
      const restoredPlot = await plotBox(p, 'dense');
      const restored = await texts(p, 'dense');
      expect(rightOf(restored, restoredPlot).map(l => l.text)).toContain('Latency (ms)');
      expect(rightOf(restored, restoredPlot).some(l => l.role === 'tick-y')).toBe(true);
      expect(overlapping(restored)).toEqual([]);
      expect(await longestPath(p, 'dense')).toBeLessThanOrEqual(bound(restoredPlot.width));
      expect(errors).toEqual([]);
      expect(server.reports.get('cartesian-n4') ?? []).toEqual([]);
    } finally {
      await watched.context.close();
    }
  });

  it('stacks signed bars and areas on their own sides of zero and reads totals and incomplete stacks alike by pointer, keyboard and table', async () => {
    server.pages.set('/cartesian-n4s.html', { html: page(), headers: { 'content-security-policy': cspPolicy('cartesian-n4s') } });
    const watched = await open(server);
    const { page: p, errors } = watched;
    await p.goto(`${server.origin}/cartesian-n4s.html`);
    try {
      await p.locator('#stacks').scrollIntoViewIfNeeded();
      // Series-painted shapes of the stack chart, grouped by paint (render/svg.ts writes the paint to `color`).
      const shapes = () => p.evaluate(() => {
        const scene = document.querySelector('#stacks .axylo-scene')!;
        const paint = (el: Element) => {
          let at: Element | null = el;
          while (at && at !== scene) { const c = (at as SVGElement).style?.getPropertyValue('color') ?? ''; if (c) return c; at = at.parentElement; }
          return '';
        };
        const rects = Array.from(scene.querySelectorAll('rect'), r => { const b = r.getBoundingClientRect(); return { paint: paint(r), x: b.x, y: b.y, width: b.width, height: b.height }; })
          .filter(r => r.paint.includes('--axylo-series-') && r.width > 0 && r.height > 0);
        const areas = Array.from(scene.querySelectorAll('path'), path => ({ paint: paint(path), d: path.getAttribute('d') ?? '' }))
          .filter(a => a.paint.includes('--axylo-series-') && a.d.includes('Z'))
          .map(a => ({ paint: a.paint, ys: Array.from(a.d.matchAll(/[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)/g), m => Number(m[2])) }));
        return { rects, areas, svgY: document.querySelector('#stacks svg.axylo-svg')!.getBoundingClientRect().y };
      });
      await expect.poll(async () => (await shapes()).rects.length, POLL).toBe(5);
      const { rects, areas, svgY } = await shapes();
      // a has values at every m (3 rectangles), b is null at m = 3 (2 rectangles, F10: zero height, no shape).
      const byPaint = new Map<string, typeof rects>();
      for (const r of rects) byPaint.set(r.paint, [...(byPaint.get(r.paint) ?? []), r]);
      const groups = [...byPaint.values()].sort((g, h) => h.length - g.length);
      expect(groups.map(g => g.length)).toEqual([3, 2]);
      const [a, b] = groups.map(g => [...g].sort((r, q) => r.x - q.x)) as [typeof rects, typeof rects];
      const top = (r: Box) => r.y, bottom = (r: Box) => r.y + r.height;
      // Zero is a's base at m = 1 and m = 3 (positive) and a's top at m = 2 (negative): one line for every slot.
      const zero = bottom(a[0]!);
      for (const edge of [bottom(a[2]!), top(a[1]!), top(b[0]!), bottom(b[1]!)]) expect(Math.abs(edge - zero)).toBeLessThanOrEqual(1);
      // Heights follow the fixture's values (one scale): 10, -5, 4 for a; -3, 6 for b.
      const unit = a[0]!.height / 10;
      expect(Math.abs(a[1]!.height - 5 * unit)).toBeLessThanOrEqual(1.5);
      expect(Math.abs(a[2]!.height - 4 * unit)).toBeLessThanOrEqual(1.5);
      expect(Math.abs(b[0]!.height - 3 * unit)).toBeLessThanOrEqual(1.5);
      expect(Math.abs(b[1]!.height - 6 * unit)).toBeLessThanOrEqual(1.5);
      // Areas on the right axis: c + d have a positive and a negative part; each band stays on one side of
      // the right axis's zero, read from its "0" tick label (centred on its tick).
      const plot = await plotBox(p, 'stacks');
      const rightZero = (await texts(p, 'stacks')).find(l => l.role === 'tick-y' && l.text === '0' && l.box.x >= plot.x + plot.width - 0.5);
      expect(rightZero).toBeDefined();
      const zeroW = rightZero!.box.y + rightZero!.box.height / 2 - svgY;
      expect(areas.length).toBeGreaterThanOrEqual(3);
      let below = 0;
      for (const band of areas) {
        const above = band.ys.every(y => y <= zeroW + 2);
        const under = band.ys.every(y => y >= zeroW - 2);
        expect(above || under).toBe(true);
        if (under && !above) below++;
      }
      expect(below).toBeGreaterThanOrEqual(1);

      // Totals (spec F10, messages totalMixed "{positive} and {negative}", '; ' between the bar and the area stack).
      const totals = ['10 and -3; 6', '6 and -5; 3 (incomplete)', '4 (incomplete); 5 and -2'];
      const proxy = p.locator('#stacks .axylo-proxy');
      await proxy.focus();
      await p.keyboard.press('Home');
      const readings = [await readingAt(p, 'stacks', 1)];
      for (const point of [2, 3]) {
        await p.keyboard.press('ArrowRight');
        readings.push(await readingAt(p, 'stacks', point));
      }
      readings.forEach((r, i) => expect(r.text).toContain(`Total ${totals[i]}`));
      await proxy.blur();
      const tip = tooltipText(p, 'stacks');
      for (let i = 0; i < 3; i++) {
        await p.mouse.move(inside(readings[i]!.x, plot), plot.y + plot.height * 0.25);
        await expect.poll(tip, POLL).toContain(totals[i]!);
      }
      await p.mouse.move(1, 1);
      await p.locator('#stacks').getByRole('button', { name: /View as table/i }).click();
      await p.waitForSelector('#stacks table tbody tr');
      const firstCells = await p.evaluate(() => Array.from(document.querySelectorAll('#stacks table tbody tr'), tr => tr.querySelector('th,td')?.textContent?.trim() ?? ''));
      expect(firstCells).toEqual(['1', '2 (incomplete)', '3 (incomplete)']);
      // Announcements: the summary names both incomplete positions (messages incompleteAt).
      expect(await summary(p, 'stacks')).toContain('m: incomplete at 2, 3.');
      expect(errors).toEqual([]);
      expect(server.reports.get('cartesian-n4s') ?? []).toEqual([]);
    } finally {
      await watched.context.close();
    }
  });
});
