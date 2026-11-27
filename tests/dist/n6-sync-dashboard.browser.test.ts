/**
 * N6 in real Chrome against the packed production bundles, under the strict CSP of the CSP tests:
 * - Linked charts from separate entry points (`axylo` line, `axylo/cartesian`, `axylo/finance`) with disjoint y
 *   values, units and series: pointer and keyboard hover on one chart draw a crosshair and readout on every
 *   compatible peer with that peer's own datum and y, marked as a peer's, without moving focus, writing the
 *   peer's aria-valuetext, announcing, or raising a hover of the peer's own.
 * - Escape, blur and pointer leave on the source clear the peers; a late clear from a chart that no longer
 *   leads leaves the newer cursor; a peer's own pointer and keyboard supersede the peer cursor.
 * - `createDashboard`: shared zoom and reset, brushing on one panel, dynamic add and remove, a one-column
 *   stack at 320 px, and 0/0/0 listeners / observer targets / owned nodes after teardown, including a panel and
 *   a grid the page disconnected first (pages/instrument.js `__liveAll`, against the baseline taken before).
 *
 * Expected values come from the fixture rows below (spec 3.6: a line tooltip reads every visible series at
 * the x; a peer reads its own rows at that x).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { bundle, closeBrowser, cspPolicy, drawn, launch, open, startServer, type Server, type Watched } from './browser';
import { fixture } from './paths';

let server: Server;
let linkedUrl: string;
let dashboardUrl: string;

const DAYS = Array.from({ length: 12 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);
const REQUESTS = (i: number) => 100 + 7 * i;
const LATENCY = (i: number) => 5000 + 13 * i; // even days only
const ORDERS = (i: number) => 40 + i;
const MS = (i: number) => 300 + 3 * i;
const OHLC = (i: number) => ({ o: 200 + i, h: 230 + i, l: 180 + i, c: 210 + i });

/** The page-side helpers both pages share: logs of each chart's own hover and zoom events and of its peer points. */
const LOGS = `
  type P = { series: string; x: unknown; y: number | null } | null;
  const hovers: Record<string, (string | null)[]> = {};
  const points: Record<string, P[]> = {};
  const zooms: Record<string, unknown[]> = {};
  const fmt = (p: { series: string; x: unknown; y: number | null } | null): P => p && { series: p.series, x: p.x instanceof Date ? p.x.toISOString() : p.x, y: p.y };
  function watch(id: string, chart: { on(e: string, l: (p: never) => void): () => void }) {
    hovers[id] = []; points[id] = []; zooms[id] = [];
    chart.on('hover', (p: { x: unknown } | null) => { hovers[id]!.push(p === null ? null : String(p.x)); });
    chart.on('zoom', (d: unknown) => { zooms[id]!.push(d); });
  }
  const peer = (id: string) => ({ id, onHoverSync: (p: never) => { points[id]!.push(fmt(p)); } });
`;

beforeAll(async () => {
  server = await startServer();
  await launch();
  const data = `
    const DAYS = ${JSON.stringify(DAYS)};
    const reqRows = DAYS.map((d, i) => ({ d, requests: 100 + 7 * i }));
    const latRows = DAYS.filter((_, i) => i % 2 === 0).map(d => ({ d, latency: 5000 + 13 * DAYS.indexOf(d) }));
    const cartRows = DAYS.map((d, i) => ({ d, orders: 40 + i, ms: 300 + 3 * i }));
    const finRows = DAYS.map((d, i) => ({ d, o: 200 + i, h: 230 + i, l: 180 + i, c: 210 + i }));
    const size = (id: string, w: number, h: number) => { const el = document.getElementById(id)!; el.style.width = w + 'px'; el.style.height = h + 'px'; return el; };
  `;
  linkedUrl = (await bundle({
    name: 'n6-linked', cwd: fixture('npm'), format: 'esm', conditions: ['production'],
    contents: `
      import { line } from 'axylo';
      import { cartesian } from 'axylo/cartesian';
      import { candlestick } from 'axylo/finance';
      import { createSyncGroup } from 'axylo/sync';
      ${data}
      ${LOGS}
      const grid = document.getElementById('grid')!;
      // Through the style object: a strict CSP admits no inline style attribute.
      grid.style.display = 'grid'; grid.style.gridTemplateColumns = '430px 430px'; grid.style.gap = '8px';
      for (const id of ['lineA', 'lineB', 'cart', 'fin']) size(id, 430, 300);
      const charts = {
        lineA: line('#lineA', { title: 'Requests', data: reqRows, x: { field: 'd', type: 'date' }, y: { field: 'requests', unit: 'req' } }),
        lineB: line('#lineB', { title: 'Latency', data: latRows, x: { field: 'd', type: 'date' }, y: { field: 'latency', unit: 'ms' } }),
        cart: cartesian('#cart', {
          title: 'Orders and time', data: cartRows, x: { field: 'd', type: 'date' },
          axes: { orders: { position: 'left', label: 'Orders' }, ms: { position: 'right', label: 'Time', unit: 'ms' } },
          layers: [{ type: 'bar', y: 'orders', yAxis: 'orders' }, { type: 'line', y: 'ms', yAxis: 'ms' }],
        }),
        fin: candlestick('#fin', { title: 'Price', data: finRows, x: { field: 'd', type: 'date' }, open: 'o', high: 'h', low: 'l', close: 'c' }),
      };
      const group = createSyncGroup();
      for (const [id, chart] of Object.entries(charts)) { watch(id, chart as never); group.attach(chart as never, peer(id)); }
      (window as unknown as Record<string, unknown>).__n6 = { charts, group, hovers, points, zooms };
    `,
  })).url;
  dashboardUrl = (await bundle({
    name: 'n6-dashboard', cwd: fixture('npm'), format: 'esm', conditions: ['production'],
    contents: `
      import { line } from 'axylo';
      import { cartesian } from 'axylo/cartesian';
      import { candlestick } from 'axylo/finance';
      import { createDashboard } from 'axylo/sync';
      ${data}
      ${LOGS}
      const w = window as unknown as Record<string, unknown> & { __tracking: boolean; __liveAll(): unknown; __phase(label: string): void };
      const nodes = () => document.body.getElementsByTagName('*').length;
      // Nothing mounts on load: the test first lets Playwright set up its own page scripts (they add window
      // listeners and a document MutationObserver of their own), then calls this to start tracking and mount.
      w.__n6start = () => {
        // From here on, pages/instrument.js records every registration; the baseline is what exists now.
        w.__tracking = true;
        const baseline = { live: w.__liveAll(), nodes: nodes() };
        // Every registration from here records the phase it was made in (pages/instrument.js), for a failure to name.
        w.__phase('mount');
        const made: Record<string, { on(e: string, l: (p: never) => void): () => void }> = {};
        const factory = (id: string, make: (el: HTMLElement) => { on(e: string, l: (p: never) => void): () => void }) => ({
          id, sync: { onHoverSync: peer(id).onHoverSync },
          create(el: HTMLElement) { el.style.height = '280px'; const c = make(el); made[id] = c; watch(id, c); return c as never; },
        });
        const panels = {
          requests: factory('requests', el => line(el, { title: 'Requests', data: reqRows, x: { field: 'd', type: 'date' }, y: { field: 'requests', unit: 'req' }, zoom: true }) as never),
          cart: factory('cart', el => cartesian(el, {
            title: 'Orders and time', data: cartRows, x: { field: 'd', type: 'date' }, zoom: true,
            axes: { orders: { position: 'left', label: 'Orders' }, ms: { position: 'right', label: 'Time', unit: 'ms' } },
            layers: [{ type: 'bar', y: 'orders', yAxis: 'orders' }, { type: 'line', y: 'ms', yAxis: 'ms' }],
          }) as never),
          fin: factory('fin', el => candlestick(el, { title: 'Price', data: finRows, x: { field: 'd', type: 'date' }, open: 'o', high: 'h', low: 'l', close: 'c', zoom: true }) as never),
          latency: factory('latency', el => line(el, { title: 'Latency', data: latRows, x: { field: 'd', type: 'date' }, y: { field: 'latency', unit: 'ms' }, zoom: true }) as never),
      };
      const dash = createDashboard('#dash', [panels.requests, panels.cart, panels.fin], { label: 'Operations' });
      w.__n6 = { dash, panels, made, hovers, points, zooms, baseline, nodes };
      };
    `,
  })).url;
});

afterAll(async () => {
  await closeBrowser();
  await server?.close();
});

type N6 = { hovers: Record<string, (string | null)[]>; points: Record<string, ({ series: string; x: unknown; y: number | null } | null)[]> };
const logs = (page: Page) => page.evaluate(() => {
  const n6 = (window as unknown as { __n6: N6 }).__n6;
  return { hovers: n6.hovers, points: n6.points };
});

/** Moves the mouse across the chart's plot until its own last hover is at `x` (a date string). */
async function pointTo(page: Page, id: string, selector: string, x: string): Promise<void> {
  const box = (await page.locator(`${selector} .axylo-plot`).first().boundingBox())!;
  for (let f = 0.01; f <= 0.99; f += 0.005) {
    await page.mouse.move(box.x + box.width * f, box.y + box.height * 0.55);
    const last = await page.evaluate(([k]) => (window as unknown as { __n6: N6 }).__n6.hovers[k!]!.at(-1), [id]);
    if (last === x) return;
  }
  throw new Error(`no pointer position on ${selector} hovers ${x}`);
}

/** What a peer shows: the mark, the rendered cursor geometry, the floating readout, and the reader-facing state left alone. */
const peerView = (page: Page, selector: string) => page.evaluate(sel => {
  const figure = document.querySelector(`${sel} figure`)!;
  const tip = figure.querySelector<HTMLElement>('.axylo-tooltip');
  const proxy = figure.querySelector<HTMLInputElement>('.axylo-proxy');
  const overlay = figure.querySelector<SVGGElement>('svg g.axylo-overlay');
  const lines = Array.from(overlay?.querySelectorAll('line') ?? []).map(l => ({
    x1: parseFloat(l.getAttribute('x1') ?? 'NaN'),
    x2: parseFloat(l.getAttribute('x2') ?? 'NaN'),
    y1: parseFloat(l.getAttribute('y1') ?? 'NaN'),
    y2: parseFloat(l.getAttribute('y2') ?? 'NaN'),
  })).filter(l => Number.isFinite(l.x1) && Math.abs(l.x1 - l.x2) <= 1 && Math.abs(l.y2 - l.y1) > 20);
  const box = tip?.getBoundingClientRect();
  return {
    synced: figure.hasAttribute('data-axylo-sync'),
    cursorCount: lines.length,
    cursorX: lines.length === 1 ? lines[0]!.x1 : null,
    cursorSpan: lines.length === 1 ? Math.abs(lines[0]!.y2 - lines[0]!.y1) : 0,
    overlayChildren: overlay?.childElementCount ?? 0,
    plot: {
      x: parseFloat(proxy?.style.left ?? 'NaN'),
      width: parseFloat(proxy?.style.width ?? 'NaN'),
      height: parseFloat(proxy?.style.height ?? 'NaN'),
    },
    tip: !!tip && !tip.hidden && !!box && box.width > 0 && box.height > 0,
    tipText: tip?.textContent ?? '',
    tipHidden: tip?.getAttribute('aria-hidden') ?? null,
    valueText: proxy?.getAttribute('aria-valuetext') ?? null,
    live: Array.from(figure.querySelectorAll('[aria-live]')).map(e => e.textContent).join('|'),
    active: document.activeElement === document.body ? 'body' : (document.activeElement?.closest('[id]')?.id ?? document.activeElement?.tagName ?? null),
  };
}, selector);

/** Expected cursor X in SVG user units from the peer's own committed layout projection for a date string. */
const expectedCursorX = (page: Page, id: string, day: string) => page.evaluate(([k, d]) => {
  const chart = (window as unknown as { __n6: { charts: Record<string, Record<symbol, { drawn?: { layout?: { kind: string; projection?: { kind: string; x?: { map(v: number): number }; band?: { center(v: number): number } } } } }>> } }).__n6.charts[k!]!;
  const layout = chart[Symbol.for('axylo.sync')]?.drawn?.layout;
  if (!layout || layout.kind !== 'plot' || !layout.projection) return null;
  const pos = Date.parse(`${d}T00:00:00Z`);
  const p = layout.projection;
  return p.kind === 'xy' ? p.x!.map(pos) : p.kind === 'bands' ? p.band!.center(pos) : null;
}, [id, day] as const);

/**
 * Where focus is, as the node itself: on the source chart's proxy (the slider the keyboard moves), inside one of
 * the peers, or on the body. `peerView().active` names the closest element with an id, which for the focused
 * proxy is the proxy itself, so it cannot say which chart holds focus.
 */
const focusAt = (page: Page, source: string, peers: readonly string[]) => page.evaluate(([src, list]) => {
  const active = document.activeElement;
  const proxy = document.querySelector(src!);
  return {
    onSource: !!proxy && active === proxy,
    inPeer: (list as string[]).filter(sel => !!active && active !== document.body && !!document.querySelector(sel)?.contains(active)),
    body: active === document.body,
    node: active === null ? null : `${active.tagName.toLowerCase()}${active.id ? `#${active.id}` : ''}${active.className && typeof active.className === 'string' ? `.${active.className.split(' ')[0]}` : ''}`,
  };
}, [source, peers] as const);

async function openPage(name: string, body: string, script: string): Promise<Watched> {
  server.pages.set(`/${name}.html`, {
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${name}</title><link rel="stylesheet" href="/npm/node_modules/axylo/dist/axylo.css"><script src="/pages/instrument.js"></script></head><body>${body}<script type="module" src="${script}"></script></body></html>`,
    headers: { 'content-security-policy': cspPolicy(name) },
  });
  const w = await open(server);
  await w.page.goto(`${server.origin}/${name}.html`);
  return w;
}

describe('N6 linked peer cursors across entry points (packed, strict CSP)', () => {
  it('pointer hover: every peer draws its own datum and y, marked, with no focus, value text, announcement or hover of its own', async () => {
    const w = await openPage('n6-linked', '<div id="grid"><div id="lineA"></div><div id="lineB"></div><div id="cart"></div><div id="fin"></div></div>', linkedUrl);
    const { page } = w;
    try {
      for (const sel of ['#lineA', '#lineB', '#cart', '#fin']) await drawn(page, sel);
      const before = { lineB: await peerView(page, '#lineB'), cart: await peerView(page, '#cart'), fin: await peerView(page, '#fin') };

      // Day index 4 (even): every peer has a row there.
      await pointTo(page, 'lineA', '#lineA', DAYS[4]!);
      const b = await peerView(page, '#lineB'), c = await peerView(page, '#cart'), f = await peerView(page, '#fin');
      for (const [name, v] of [['lineB', b], ['cart', c], ['fin', f]] as const) {
        const wantX = (await expectedCursorX(page, name, DAYS[4]!))!;
        expect(v.synced, `${name} marked as a peer's cursor`).toBe(true);
        expect(v.cursorCount, `${name} draws one vertical cursor rule`).toBe(1);
        expect(v.cursorSpan, `${name} cursor spans plot height`).toBeGreaterThanOrEqual(v.plot.height - 2);
        expect(v.cursorX!, `${name} cursor lies inside plot`).toBeGreaterThanOrEqual(v.plot.x - 1);
        expect(v.cursorX!, `${name} cursor lies inside plot`).toBeLessThanOrEqual(v.plot.x + v.plot.width + 1);
        expect(Math.abs(v.cursorX! - wantX), `${name} cursor at expected X for ${DAYS[4]}`).toBeLessThanOrEqual(1.5);
        expect(v.tip, `${name} shows its readout`).toBe(true);
        expect(v.tipHidden, `${name} readout hidden from assistive technology`).toBe('true');
        expect(v.active, `${name}: focus not moved`).toBe('body');
        expect(v.valueText, `${name}: aria-valuetext untouched`).toBe(before[name].valueText);
        expect(v.live, `${name}: nothing announced`).toBe(before[name].live);
      }
      // Analytic check on lineB (even days 0..10): day 4 is at 0.4 of plot width.
      expect(Math.abs(b.cursorX! - (b.plot.x + 0.4 * b.plot.width))).toBeLessThanOrEqual(1.5);
      expect((await peerView(page, '#lineA')).synced).toBe(false);
      // Each readout says its own value, never the source's (requests 128).
      expect(b.tipText).toContain(LATENCY(4).toLocaleString('en-US'));
      expect(c.tipText).toContain(String(ORDERS(4)));
      expect(c.tipText).toContain(String(MS(4)));
      expect(f.tipText).toContain(String(OHLC(4).h));
      for (const v of [b, c, f]) expect(v.tipText).not.toContain(String(REQUESTS(4)));
      const l = await logs(page);
      expect(l.points.lineB!.at(-1)).toEqual({ series: 'latency', x: DAYS[4], y: LATENCY(4) });
      const cp = l.points.cart!.at(-1)!;
      expect(cp.x).toBe(DAYS[4]);
      expect(cp.y).toBe(({ orders: ORDERS(4), ms: MS(4) } as Record<string, number>)[cp.series]);
      const fp = l.points.fin!.at(-1)!;
      expect(fp.x).toBe(DAYS[4]);
      expect(Object.values(OHLC(4))).toContain(fp.y);
      expect(l.hovers.lineB).toEqual([]);
      expect(l.hovers.cart).toEqual([]);
      expect(l.hovers.fin).toEqual([]);

      // Day 5 (odd): lineB has no row there and clears (default 'clear'); the others move.
      await pointTo(page, 'lineA', '#lineA', DAYS[5]!);
      const b5 = await peerView(page, '#lineB'), c5 = await peerView(page, '#cart'), f5 = await peerView(page, '#fin');
      expect(b5.synced).toBe(false);
      expect(b5.tip).toBe(false);
      expect(b5.cursorCount, '#lineB cursor removed on unmatched day').toBe(0);
      expect(b5.overlayChildren, '#lineB overlay cleared on unmatched day').toBe(0);
      expect(c5.tipText).toContain(String(MS(5)));
      expect(c5.cursorCount).toBe(1);
      expect(c5.cursorX!).toBeGreaterThan(c.cursorX!);
      expect(Math.abs(c5.cursorX! - (await expectedCursorX(page, 'cart', DAYS[5]!))!)).toBeLessThanOrEqual(1.5);
      expect(f5.cursorCount).toBe(1);
      expect(f5.cursorX!).toBeGreaterThan(f.cursorX!);
      expect(Math.abs(f5.cursorX! - (await expectedCursorX(page, 'fin', DAYS[5]!))!)).toBeLessThanOrEqual(1.5);

      // Leaving A clears every peer.
      await page.mouse.move(895, 695);
      await page.waitForTimeout(50);
      for (const sel of ['#lineB', '#cart', '#fin']) {
        const v = await peerView(page, sel);
        expect(v.synced, `${sel} cleared on leave`).toBe(false);
        expect(v.tip, `${sel} readout gone on leave`).toBe(false);
        expect(v.cursorCount, `${sel} cursor rule removed on leave`).toBe(0);
        expect(v.overlayChildren, `${sel} overlay cleared on leave`).toBe(0);
      }
      expect((await logs(page)).hovers.lineB).toEqual([]);

      // Finance as the source: lineA reads its own requests.
      await pointTo(page, 'fin', '#fin', DAYS[3]!);
      const a = await peerView(page, '#lineA');
      expect(a.synced).toBe(true);
      expect(a.tipText).toContain(String(REQUESTS(3)));
      expect((await logs(page)).points.lineA!.at(-1)).toEqual({ series: 'requests', x: DAYS[3], y: REQUESTS(3) });
      await page.mouse.move(895, 695);

      expect(w.errors).toEqual([]);
      expect(server.reports.get('n6-linked') ?? []).toEqual([]);
    } finally {
      await w.context.close();
    }
  });

  it('keyboard on the source drives the peers without moving focus; Escape and blur clear them', async () => {
    const w = await openPage('n6-linked', '<div id="grid"><div id="lineA"></div><div id="lineB"></div><div id="cart"></div><div id="fin"></div></div>', linkedUrl);
    const { page } = w;
    try {
      for (const sel of ['#lineA', '#lineB', '#cart', '#fin']) await drawn(page, sel);
      const PEERS = ['#lineB', '#cart', '#fin'] as const;
      const SOURCE = '#lineA .axylo-proxy';
      const before = { '#lineB': await peerView(page, '#lineB'), '#cart': await peerView(page, '#cart'), '#fin': await peerView(page, '#fin') };
      await page.focus(SOURCE);
      const focused = await focusAt(page, SOURCE, PEERS);
      expect(focused.onSource, `focus starts on the source proxy (is ${focused.node})`).toBe(true);
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(50);
      // Day index 2 (even): every peer has a row there and shows its own reading of it.
      const shown = { '#lineB': await peerView(page, '#lineB'), '#cart': await peerView(page, '#cart'), '#fin': await peerView(page, '#fin') };
      for (const [sel, id] of [['#lineB', 'lineB'], ['#cart', 'cart'], ['#fin', 'fin']] as const) {
        const v = shown[sel];
        const wantX = (await expectedCursorX(page, id, DAYS[2]!))!;
        expect(v.synced, `${sel} marked as a peer's cursor`).toBe(true);
        expect(v.cursorCount, `${sel} draws one vertical cursor rule on keyboard`).toBe(1);
        expect(v.cursorSpan, `${sel} keyboard cursor spans plot height`).toBeGreaterThanOrEqual(v.plot.height - 2);
        expect(Math.abs(v.cursorX! - wantX), `${sel} keyboard cursor at expected X for ${DAYS[2]}`).toBeLessThanOrEqual(1.5);
        expect(v.tip, `${sel} shows its readout`).toBe(true);
        expect(v.tipHidden, `${sel} readout hidden from assistive technology`).toBe('true');
        expect(v.valueText, `${sel}: aria-valuetext untouched`).toBe(before[sel].valueText);
        expect(v.live, `${sel}: nothing announced`).toBe(before[sel].live);
        expect(v.tipText, `${sel} never reads the source's requests`).not.toContain(String(REQUESTS(2)));
      }
      expect(Math.abs(shown['#lineB'].cursorX! - (shown['#lineB'].plot.x + 0.2 * shown['#lineB'].plot.width))).toBeLessThanOrEqual(1.5);
      expect(shown['#lineB'].tipText).toContain(LATENCY(2).toLocaleString('en-US'));
      expect(shown['#cart'].tipText).toContain(String(ORDERS(2)));
      expect(shown['#cart'].tipText).toContain(String(MS(2)));
      expect(shown['#fin'].tipText).toContain(String(OHLC(2).h));
      const presented = await focusAt(page, SOURCE, PEERS);
      expect(presented.onSource, `focus stays on the source proxy while peers present (is ${presented.node})`).toBe(true);
      expect(presented.inPeer, 'no peer took focus').toEqual([]);
      expect((await logs(page)).points.lineB!.at(-1)).toEqual({ series: 'latency', x: DAYS[2], y: LATENCY(2) });

      await page.keyboard.press('Escape');
      await page.waitForTimeout(50);
      for (const sel of PEERS) {
        const v = await peerView(page, sel);
        expect(v.synced, `${sel} cleared by Escape`).toBe(false);
        expect(v.cursorCount, `${sel} cursor removed by Escape`).toBe(0);
        expect(v.overlayChildren, `${sel} overlay cleared by Escape`).toBe(0);
      }
      const escaped = await focusAt(page, SOURCE, PEERS);
      expect(escaped.onSource, `focus stays on the source proxy after Escape (is ${escaped.node})`).toBe(true);
      expect(escaped.inPeer, 'no peer took focus on Escape').toEqual([]);

      await page.keyboard.press('ArrowRight'); // day 3: lineB has none, cart and fin follow
      await page.waitForTimeout(50);
      const b3 = await peerView(page, '#lineB'), c3 = await peerView(page, '#cart'), f3 = await peerView(page, '#fin');
      expect(b3.synced, '#lineB has no row on day 3').toBe(false);
      expect(b3.cursorCount).toBe(0);
      expect(c3.synced).toBe(true);
      expect(c3.cursorCount).toBe(1);
      expect(c3.cursorX!).toBeGreaterThan(shown['#cart'].cursorX!);
      expect(f3.synced).toBe(true);
      expect(f3.cursorCount).toBe(1);
      expect(f3.cursorX!).toBeGreaterThan(shown['#fin'].cursorX!);
      const moved = await focusAt(page, SOURCE, PEERS);
      expect(moved.onSource, `the arrow after Escape is read on the source proxy (is ${moved.node})`).toBe(true);
      // The node blurred is the source proxy, checked just above.
      await page.evaluate(sel => (document.querySelector(sel) as HTMLElement).blur(), SOURCE);
      await page.waitForTimeout(50);
      for (const sel of PEERS) {
        const v = await peerView(page, sel);
        expect(v.synced, `${sel} cleared by blur`).toBe(false);
        expect(v.cursorCount, `${sel} cursor removed by blur`).toBe(0);
        expect(v.overlayChildren, `${sel} overlay cleared by blur`).toBe(0);
      }
      const blurred = await focusAt(page, SOURCE, PEERS);
      expect(blurred.onSource, 'the source proxy lost focus').toBe(false);
      expect(blurred.inPeer, 'blur moved focus into no peer').toEqual([]);
      const l = await logs(page);
      expect(l.hovers.lineB).toEqual([]);
      expect(l.hovers.cart).toEqual([]);
      expect(w.errors).toEqual([]);
      expect(server.reports.get('n6-linked') ?? []).toEqual([]);
    } finally {
      await w.context.close();
    }
  });

  it('a late clear from a chart that no longer leads leaves the newer cursor; a peer\'s own pointer supersedes the peer cursor', async () => {
    const w = await openPage('n6-linked', '<div id="grid"><div id="lineA"></div><div id="lineB"></div><div id="cart"></div><div id="fin"></div></div>', linkedUrl);
    const { page } = w;
    try {
      for (const sel of ['#lineA', '#lineB', '#cart', '#fin']) await drawn(page, sel);
      await page.focus('#lineA .axylo-proxy');
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      expect((await peerView(page, '#lineB')).synced).toBe(true);
      // The cartesian chart leads now: lineB follows it to day 6; lineA keeps its own keyboard reading.
      await pointTo(page, 'cart', '#cart', DAYS[6]!);
      expect((await peerView(page, '#lineB')).tipText).toContain(LATENCY(6).toLocaleString('en-US'));
      expect((await peerView(page, '#lineA')).synced).toBe(false);
      // lineA's blur arrives late: its clear is not passed on.
      await page.evaluate(() => (document.activeElement as HTMLElement).blur());
      await page.waitForTimeout(50);
      const still = await peerView(page, '#lineB');
      expect(still.synced).toBe(true);
      expect(still.tipText).toContain(LATENCY(6).toLocaleString('en-US'));
      // lineB's own pointer takes over: its own hover, no peer mark; the cartesian chart follows lineB.
      await pointTo(page, 'lineB', '#lineB', DAYS[8]!);
      const own = await peerView(page, '#lineB');
      expect(own.synced).toBe(false);
      expect(own.tipText).toContain(LATENCY(8).toLocaleString('en-US'));
      expect((await logs(page)).hovers.lineB!.at(-1)).toBe(DAYS[8]);
      expect((await peerView(page, '#cart')).synced).toBe(true);
      expect((await peerView(page, '#cart')).tipText).toContain(String(MS(8)));
      await page.mouse.move(895, 695);
      await page.waitForTimeout(50);
      expect((await peerView(page, '#cart')).synced).toBe(false);
      expect(w.errors).toEqual([]);
    } finally {
      await w.context.close();
    }
  });
});

describe('N6 createDashboard (packed, strict CSP)', () => {
  it('shared zoom, brush and reset; add and remove; a 320 px stack; 0/0/0 after teardown with disconnected panels', async () => {
    const w = await openPage('n6-dashboard', '<div id="dash"></div>', dashboardUrl);
    const { page } = w;
    try {
      // The measurement boundary. Playwright's injected scripts register window capture listeners and a document
      // MutationObserver the first time a page-side helper runs in a world (main: waitForFunction and locator
      // queries; utility: boundingBox and the actionability checks); made after tracking starts, they would be
      // counted as the dashboard's. So every helper kind this test uses runs once, on the host, before tracking.
      await page.waitForFunction(() => typeof (window as unknown as { __n6start?: unknown }).__n6start === 'function');
      expect(await page.locator('#dash').count()).toBe(1);
      await page.locator('#dash').boundingBox();
      // Not tracking and not mounted until now; the start takes the baseline and mounts in the same task.
      const started = await page.evaluate(() => {
        const n6 = window as unknown as { __tracking?: boolean; __n6start(): void; __n6?: unknown };
        const before = { tracking: !!n6.__tracking, mounted: !!n6.__n6 };
        n6.__n6start();
        return { before, mounted: !!n6.__n6 };
      });
      expect(started).toEqual({ before: { tracking: false, mounted: false }, mounted: true });
      for (const id of ['requests', 'cart', 'fin']) await drawn(page, `#dash [data-panel="${id}"]`);
      const phase = (label: string) => page.evaluate(l => (window as unknown as { __phase(label: string): void }).__phase(l), label);
      const layout = () => page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('#dash .axylo-dashboard-panel'))
        .map(p => ({ id: p.dataset.panel, left: Math.round(p.getBoundingClientRect().left), top: Math.round(p.getBoundingClientRect().top), width: Math.round(p.getBoundingClientRect().width) })));
      const wide = await layout();
      expect(wide.map(p => p.id)).toEqual(['requests', 'cart', 'fin']);
      expect(wide[0]!.top).toBe(wide[1]!.top);
      expect(wide[1]!.left).toBeGreaterThan(wide[0]!.left);
      expect(await page.evaluate(() => document.querySelectorAll('style').length)).toBe(0);
      expect(await page.locator('#dash [role="group"][aria-label="Operations"]').count()).toBe(1);

      await phase('hover');
      // Hover links the panels too.
      await pointTo(page, 'requests', '#dash [data-panel="requests"]', DAYS[4]!);
      expect((await peerView(page, '#dash [data-panel="cart"]')).synced).toBe(true);
      await page.mouse.move(895, 695);

      await phase('brush');
      // Brush on the requests panel: the others take the same window, once each.
      const plot = (await page.locator('#dash [data-panel="requests"] .axylo-plot').boundingBox())!;
      await page.mouse.move(plot.x + plot.width * 0.3, plot.y + plot.height * 0.5);
      await page.mouse.down();
      await page.mouse.move(plot.x + plot.width * 0.5, plot.y + plot.height * 0.5, { steps: 5 });
      await page.mouse.move(plot.x + plot.width * 0.7, plot.y + plot.height * 0.5, { steps: 5 });
      await page.mouse.up();
      await page.mouse.move(895, 695);
      await page.waitForTimeout(100);
      const zooms = () => page.evaluate(() => (window as unknown as { __n6: { zooms: Record<string, unknown[]> } }).__n6.zooms);
      let z = await zooms();
      expect(z.requests).toHaveLength(1);
      expect(z.requests![0]).not.toBeNull();
      // Each peer applied a window once (its own payload: a band axis may pad its ends).
      for (const id of ['cart', 'fin']) {
        expect(z[id], `${id} followed the brush once`).toHaveLength(1);
        expect(z[id]![0], `${id} zoomed in`).not.toBeNull();
      }

      await phase('reset-zoom');
      await page.evaluate(() => (window as unknown as { __n6: { dash: { reset(): void } } }).__n6.dash.reset());
      z = await zooms();
      for (const id of ['requests', 'cart', 'fin']) expect(z[id]!.at(-1), `${id} reset`).toBeNull();
      await page.evaluate(([a, b]) => (window as unknown as { __n6: { dash: { zoom(d: unknown): void } } }).__n6.dash.zoom([a, b]), [DAYS[2], DAYS[7]]);
      z = await zooms();
      expect(z.requests!.at(-1)).toEqual([DAYS[2], DAYS[7]]);
      for (const id of ['cart', 'fin']) {
        expect(z[id], `${id} zoomed by the dashboard`).toHaveLength(3);
        expect(z[id]!.at(-1)).not.toBeNull();
      }

      await phase('add-remove');
      // Add a panel, then remove one.
      const ids = await page.evaluate(() => {
        const n6 = (window as unknown as { __n6: { dash: { add(p: unknown): string; remove(id: string): boolean; ids: string[] }; panels: Record<string, unknown> } }).__n6;
        n6.dash.add(n6.panels.latency);
        const added = [...n6.dash.ids];
        const removed = n6.dash.remove('cart');
        return { added, removed, after: [...n6.dash.ids] };
      });
      expect(ids).toEqual({ added: ['requests', 'cart', 'fin', 'latency'], removed: true, after: ['requests', 'fin', 'latency'] });
      await drawn(page, '#dash [data-panel="latency"]');
      expect(await page.locator('#dash [data-panel="cart"]').count()).toBe(0);

      // 320 px: one column, nothing wider than the viewport.
      await phase('narrow');
      await page.setViewportSize({ width: 320, height: 700 });
      await page.waitForTimeout(150);
      const narrow = await layout();
      expect(new Set(narrow.map(p => p.left)).size).toBe(1);
      for (const p of narrow) expect(p.width).toBeLessThanOrEqual(320);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
      await phase('wide');
      await page.setViewportSize({ width: 900, height: 700 });
      await page.waitForTimeout(150);

      // The page disconnects a panel, then the whole grid, before the dashboard is torn down.
      const after = await page.evaluate(async () => {
        const n6 = (window as unknown as {
          __n6: { dash: { element: HTMLElement; remove(id: string): boolean; destroy(): void }; baseline: { live: unknown; nodes: number }; nodes(): number; hovers: Record<string, unknown[]>; zooms: Record<string, unknown[]>; made: Record<string, { zoom(d: unknown): void }> };
          __liveAll(): unknown; __phase(label: string): void; __snapshots(): unknown[];
        });
        const frames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const { dash } = n6.__n6;
        const fin = dash.element.querySelector<HTMLElement>('[data-panel="fin"]')!;
        n6.__phase('fin-disconnect');
        fin.remove();
        await frames();
        n6.__phase('fin-remove');
        const removedDisconnected = dash.remove('fin');
        const grid = dash.element;
        n6.__phase('grid-disconnect');
        grid.remove();
        await frames();
        n6.__phase('destroy');
        dash.destroy();
        // Right after destroy and once late callbacks had their time: says whether anything comes back.
        n6.__phase('after-destroy');
        await new Promise(r => setTimeout(r, 150));
        n6.__phase('zoom-on-destroyed');
        // A destroyed chart is inert: no event for a call made on it.
        const events = JSON.stringify([n6.__n6.hovers, n6.__n6.zooms]);
        n6.__n6.made.requests!.zoom(['2026-01-02', '2026-01-04']);
        const live = n6.__liveAll();
        n6.__phase('end');
        return {
          removedDisconnected, live, snapshots: n6.__snapshots(), baseline: n6.__n6.baseline, nodes: n6.__n6.nodes(),
          finChildren: fin.childNodes.length, gridChildren: grid.childNodes.length, dashChildren: document.getElementById('dash')!.childNodes.length,
          inert: JSON.stringify([n6.__n6.hovers, n6.__n6.zooms]) === events,
        };
      });
      const counts = (k: string, v: unknown) => (k === 'detail' ? undefined : v);
      console.info(`N6 teardown: baseline ${JSON.stringify(after.baseline, counts)}, after ${JSON.stringify({ live: after.live, nodes: after.nodes }, counts)}`);
      expect(after.removedDisconnected).toBe(true);
      type Detail = {
        listeners: { id: number; target: string; type: string; capture: boolean; phase: string; at: string }[];
        observers: { name: string; made: { phase: string; at: string } | null; targets: { target: string; phase: string; at: string }[] }[];
      };
      const live = after.live as { listeners: number; disconnected: string[]; observers: number; observerTargets: number; disconnectedTargets: number; frames: number; detail: Detail };
      const base = after.baseline.live as typeof live;
      type Snapshot = { phase: string; listeners: number; observers: number; observerTargets: number; disconnected: number; disconnectedTargets: number; frames: number; groups: Record<string, number>; observing: string[] };
      const snapshots = after.snapshots as Snapshot[];
      // What each phase began with, and every registration still live at the end: its target, type, the phase it
      // was made in and the page's stack then. Printed on every run so a later failure can be compared with it.
      const report = [
        ...snapshots.map(p => `  ${p.phase}: ${p.listeners} listeners (${p.disconnected} on disconnected nodes), ${p.observers} observers on ${p.observerTargets} targets (${p.disconnectedTargets} disconnected), ${p.frames} frames`),
        ...snapshots.filter(p => ['destroy', 'after-destroy', 'zoom-on-destroyed', 'end'].includes(p.phase))
          .map(p => `  ${p.phase} live: ${JSON.stringify(p.groups)} observing ${JSON.stringify(p.observing)}`),
        `  left after teardown (${live.detail.listeners.length} listeners, ${live.detail.observers.length} observers):`,
        ...live.detail.listeners.map(l => `    listener ${l.target} ${l.type}${l.capture ? ' (capture)' : ''} made in ${l.phase || 'before mount'} at ${l.at}`),
        ...live.detail.observers.flatMap(o => [
          `    ${o.name} made in ${o.made?.phase ?? 'untracked'} at ${o.made?.at ?? ''}`,
          ...o.targets.map(t => `      observes ${t.target} since ${t.phase} at ${t.at}`),
        ]),
      ].join('\n');
      console.info(`N6 teardown by phase:\n${report}`);
      expect(live.listeners, `net listeners (connected and disconnected)\n${report}`).toBe(base.listeners);
      expect(live.disconnected, 'listeners left on disconnected nodes').toEqual(base.disconnected);
      expect(live.observers, `net observers\n${report}`).toBe(base.observers);
      expect(live.observerTargets, `net observer targets\n${report}`).toBe(base.observerTargets);
      expect(live.disconnectedTargets, 'observer targets that are disconnected nodes').toBe(base.disconnectedTargets);
      expect(live.frames, 'animation frames still pending').toBe(0);
      expect(after.nodes, 'net owned DOM nodes').toBe(after.baseline.nodes);
      expect(after.finChildren).toBe(0);
      expect(after.gridChildren).toBe(0);
      expect(after.dashChildren).toBe(0);
      expect(after.inert).toBe(true);
      expect(w.errors).toEqual([]);
      expect(server.reports.get('n6-dashboard') ?? []).toEqual([]);
    } finally {
      await w.context.close();
    }
  });
});
