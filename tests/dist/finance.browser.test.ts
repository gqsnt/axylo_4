/**
 * Packed real-Chrome integration test for `axylo/finance` under strict CSP (C6.3, reworked in N7a): split
 * price and volume panes with their own ticks, titles and clips; the exact explicit price domain; live semantic
 * paints with hollow-up / filled-down encoding; hover from both panes, keyboard navigation and keyboard zoom with
 * exact readout/table parity; strict rollback; axe-core; bounded SVG for 5,000 candles; clean teardown.
 *
 * Pane containment is checked on what can be measured honestly: a CSS clip does not shrink an SVG element's
 * bounding box, and a candle body centered on the first or last time sits half outside the pane until the
 * clip cuts it. So each mark's vertical extent (cut in the geometry) is compared with its pane, its horizontal
 * extent with the pane widened by at most half a candle body, and its clip with the pane's clip rectangle.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { bundle, closeBrowser, cspPolicy, launch, open, startServer, type Server } from './browser';
import { fixture, repo } from './paths';

let server: Server;
let scriptUrl: string;

const DAYS = 60;
const DAY = 86_400_000;
const START = Date.UTC(2026, 0, 1);
/** The fixture, the same formula as the page's: integer prices so every readout is exact. */
function row(i: number) {
  const open = 100 + (i % 10);
  const close = open + ((i % 3) - 1) * 2;
  return { day: new Date(START + i * DAY).toISOString().slice(0, 10), open, high: Math.max(open, close) + 3, low: Math.min(open, close) - 2, close, vol: 1000 * (1 + (i % 5)) };
}
const ROWS = Array.from({ length: DAYS }, (_, i) => row(i));
const grouped = (n: number) => n.toLocaleString('en-US');
/** Above the explicit [100, 120] domain of the fixed chart: nothing of it may be painted in either pane. */
const ABOVE = { day: '2026-01-21', open: 130, high: 131, low: 125, close: 126, vol: 9000 };
/** One candle per case on consecutive days (no AX105 gap slots): up, AX180 (high below the body), down, AX181 (negative volume), down, up. */
const FLAGGED = [
  { day: '2026-03-02', open: 100, high: 106, low: 99, close: 104, vol: 1000 },
  { day: '2026-03-03', open: 104, high: 103, low: 100, close: 102, vol: 2000 },
  { day: '2026-03-04', open: 104, high: 105, low: 98, close: 100, vol: 3000 },
  { day: '2026-03-05', open: 100, high: 108, low: 99, close: 106, vol: -500 },
  { day: '2026-03-06', open: 106, high: 107, low: 101, close: 102, vol: 4000 },
  { day: '2026-03-07', open: 102, high: 110, low: 101, close: 109, vol: 5000 },
];
/** The widest candle body the renderer draws is 24 px (finance/render.ts candleWidth): half of it may pass a pane's side. */
const HALF_BODY = 12;

const axeSource = fs.readFileSync(path.join(repo, 'node_modules/axe-core/axe.min.js'), 'utf8');

beforeAll(async () => {
  server = await startServer();
  await launch();
  scriptUrl = (await bundle({
    name: 'finance-e2e',
    cwd: fixture('npm'),
    format: 'esm',
    conditions: ['production'],
    contents: `
      import { candlestick } from 'axylo/finance';
      const START = ${START};
      const DAY = ${DAY};
      const row = i => {
        const open = 100 + (i % 10);
        const close = open + ((i % 3) - 1) * 2;
        return { day: new Date(START + i * DAY).toISOString().slice(0, 10), open, high: Math.max(open, close) + 3, low: Math.min(open, close) - 2, close, vol: 1000 * (1 + (i % 5)) };
      };
      const size = (el, w, h) => { el.style.width = w + 'px'; el.style.height = h + 'px'; };
      const main = document.getElementById('chart');
      size(main, 760, 460);
      const chart = candlestick('#chart', {
        title: 'ACME Daily OHLC',
        data: Array.from({ length: ${DAYS} }, (_, i) => row(i)),
        x: 'day',
        open: 'open', high: 'high', low: 'low', close: 'close', volume: 'vol',
        yAxis: { unit: 'USD', label: 'Price' },
        volumeAxis: { label: 'Shares' },
      });
      const fixed = document.getElementById('fixed');
      size(fixed, 640, 380);
      const fixedChart = candlestick('#fixed', {
        title: 'Fixed domain',
        data: [...Array.from({ length: 20 }, (_, i) => row(i)), ${JSON.stringify(ABOVE)}],
        x: 'day', open: 'open', high: 'high', low: 'low', close: 'close', volume: 'vol',
        yAxis: { domain: [100, 120] },
      });
      const flagged = document.getElementById('flagged');
      size(flagged, 640, 380);
      const flaggedChart = candlestick('#flagged', {
        title: 'Flagged rows',
        data: ${JSON.stringify(FLAGGED)},
        x: 'day', open: 'open', high: 'high', low: 'low', close: 'close', volume: 'vol',
        yAxis: { unit: 'USD' },
      });
      const dense = document.getElementById('dense');
      size(dense, 760, 420);
      const denseChart = candlestick('#dense', {
        title: 'Dense',
        data: Array.from({ length: 5000 }, (_, i) => ({ x: i, o: 100 + Math.sin(i / 40) * 8, h: 104 + Math.sin(i / 40) * 8, l: 96 + Math.sin(i / 40) * 8, c: 100 + Math.sin(i / 40) * 8 + ((i % 3) - 1), v: 100 + (i % 17) })),
        x: 'x', open: 'o', high: 'h', low: 'l', close: 'c', volume: 'v',
      });
      Object.assign(window, { __fin: chart, __fixed: fixedChart, __dense: denseChart, __flagged: flaggedChart });
    `,
  })).url;
});

afterAll(async () => {
  await closeBrowser();
  await server?.close();
});

interface Box { x: number; y: number; width: number; height: number }
interface Panes { price: Box; volume: Box; svg: Box }

/** The pane clip rectangles (CSS px of the page) the finance SVG handlers attached to the data marks. */
async function panes(page: Page, sel: string): Promise<Panes> {
  return page.evaluate(s => {
    const svg = document.querySelector(`${s} svg.axylo-svg`)!;
    const origin = svg.getBoundingClientRect();
    const rectOf = (kind: string) => {
      const r = svg.querySelector(`clipPath[id^="axylo-finance-${kind}-"] rect`)!;
      return { x: origin.x + Number(r.getAttribute('x')), y: origin.y + Number(r.getAttribute('y')), width: Number(r.getAttribute('width')), height: Number(r.getAttribute('height')) };
    };
    return { price: rectOf('price'), volume: rectOf('volume'), svg: { x: origin.x, y: origin.y, width: origin.width, height: origin.height } };
  }, sel);
}

/** Marks by their semantic paint: the renderer writes the paint expression to `color` on the shape or its group. */
async function marks(page: Page, sel: string) {
  return page.evaluate(s => {
    const scene = document.querySelector(`${s} .axylo-scene`)!;
    const find = (name: string) => Array.from(scene.children).find(el => ((el as SVGElement).style.getPropertyValue('color') ?? '').includes(name)) as SVGGraphicsElement | undefined;
    const box = (el: SVGGraphicsElement | undefined) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const up = find('--axylo-up');
    const down = find('--axylo-down');
    const volume = find('--axylo-volume');
    const style = (el: Element | undefined | null) => (el ? getComputedStyle(el) : null);
    // The rectangle of the clip the mark carries, in page px: what the browser paints is the box cut to it.
    const svg = scene.closest('svg')!;
    const origin = svg.getBoundingClientRect();
    const clipBox = (el: Element | undefined) => {
      const id = /^url\(#(.+)\)$/.exec(el?.getAttribute('clip-path') ?? '')?.[1];
      const r = id ? svg.querySelector(`clipPath[id="${id}"] rect`) : null;
      return r ? { x: origin.x + Number(r.getAttribute('x')), y: origin.y + Number(r.getAttribute('y')), width: Number(r.getAttribute('width')), height: Number(r.getAttribute('height')) } : null;
    };
    const wick = Array.from(scene.children).find(el => el.tagName === 'path' && el.getAttribute('stroke-width') === '1.25');
    return {
      clips: { up: clipBox(up), down: clipBox(down), volume: clipBox(volume), wick: clipBox(wick) },
      wick: wick ? { box: box(wick as SVGGraphicsElement), d: wick.getAttribute('d') ?? '' } : null,
      upD: up?.getAttribute('d') ?? '',
      up: up ? { box: box(up), tag: up.tagName, fill: style(up)!.fill, stroke: style(up)!.stroke, clip: up.getAttribute('clip-path') } : null,
      down: down ? { box: box(down), rects: down.querySelectorAll('rect').length, fill: style(down.querySelector('rect'))?.fill ?? '', clip: down.getAttribute('clip-path') } : null,
      volume: volume ? { box: box(volume), rects: volume.querySelectorAll('rect').length, fill: style(volume.querySelector('rect'))?.fill ?? '', clip: volume.getAttribute('clip-path'),
        centers: Array.from(volume.querySelectorAll('rect'), r => { const b = r.getBoundingClientRect(); return b.x + b.width / 2; }) } : null,
    };
  }, sel);
}

async function labels(page: Page, sel: string) {
  return page.evaluate(s => Array.from(document.querySelectorAll(`${s} .axylo-text [data-role]`), el => {
    const r = el.getBoundingClientRect();
    return { role: el.getAttribute('data-role') ?? '', text: (el.textContent ?? '').trim(), box: { x: r.x, y: r.y, width: r.width, height: r.height } };
  }).filter(l => l.text && l.box.width > 0), sel);
}

const bottom = (b: Box) => b.y + b.height;
const right = (b: Box) => b.x + b.width;
const inside = (inner: Box, outer: Box, slack = 1.5) =>
  inner.x >= outer.x - slack && inner.y >= outer.y - slack && right(inner) <= right(outer) + slack && bottom(inner) <= bottom(outer) + slack;
const overlap = (a: Box, b: Box) => a.x < right(b) - 0.5 && b.x < right(a) - 0.5 && a.y < bottom(b) - 0.5 && b.y < bottom(a) - 0.5;
/** Vertical extent inside the pane (cut in the geometry); horizontally at most half a body past its sides. */
const inPane = (mark: Box, pane: Box, slack = 1) =>
  mark.y >= pane.y - slack && bottom(mark) <= bottom(pane) + slack && mark.x >= pane.x - HALF_BODY - slack && right(mark) <= right(pane) + HALF_BODY + slack;
const sameBox = (a: Box | null, b: Box) => !!a && Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.width - b.width) < 0.01 && Math.abs(a.height - b.height) < 0.01;
/** The painted part of a mark: its box cut to its clip. */
const paintedPart = (mark: Box, clip: Box): Box | null => {
  const x = Math.max(mark.x, clip.x), y = Math.max(mark.y, clip.y);
  const w = Math.min(right(mark), right(clip)) - x, h = Math.min(bottom(mark), bottom(clip)) - y;
  return w > 0 && h > 0 ? { x, y, width: w, height: h } : null;
};
/** x of every vertex of a path's `d` (the renderer writes absolute M/L commands), in SVG px. */
const vertexXs = (d: string) => Array.from(d.matchAll(/[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)/g), m => Number(m[1]));
/** Two animation frames: whatever the last state change scheduled has been drawn. */
const frames = (page: Page) => page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

describe('N7a axylo/finance packed Chrome integration under strict CSP', () => {
  it('draws split panes, exact domains, live paints, parity, keyboard and zoom, rollback, axe, and bounded dense SVG', async () => {
    server.pages.set('/finance.html', {
      html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Finance</title><link rel="stylesheet" href="/npm/node_modules/axylo/dist/axylo.css"></head><body><main><div id="chart"></div><div id="fixed"></div><div id="dense"></div><div id="flagged"></div></main><script type="module" src="${scriptUrl}"></script></body></html>`,
      headers: { 'content-security-policy': cspPolicy('finance') },
    });

    const watched = await open(server);
    const { page, errors } = watched;
    await page.goto(`${server.origin}/finance.html`);
    try {
      for (const sel of ['#chart', '#fixed', '#dense', '#flagged']) {
        await page.waitForFunction(s => !!document.querySelector(`${s} svg clipPath[id^="axylo-finance-volume-"]`) &&
          !!Array.from(document.querySelectorAll(`${s} .axylo-scene > *`)).find(el => ((el as SVGElement).style.getPropertyValue('color') ?? '').includes('--axylo-volume')), sel);
      }

      // ── Panes: disjoint, price above volume, marks inside their own pane, clip paths attached.
      const p = await panes(page, '#chart');
      expect(bottom(p.price)).toBeLessThan(p.volume.y);
      expect(p.price.height / (bottom(p.volume) - p.price.y)).toBeGreaterThan(0.68);
      expect(p.volume.height / (bottom(p.volume) - p.price.y)).toBeGreaterThan(0.2);
      const m = await marks(page, '#chart');
      expect(m.up && m.down && m.volume).toBeTruthy();
      expect(m.up!.clip).toMatch(/^url\(#axylo-finance-price-\d+\)$/);
      expect(m.down!.clip).toMatch(/^url\(#axylo-finance-price-\d+\)$/);
      expect(m.volume!.clip).toMatch(/^url\(#axylo-finance-volume-\d+\)$/);
      // Each mark carries its own pane's clip, its geometry stays in that pane, and what is painted is inside it.
      expect(sameBox(m.clips.up, p.price) && sameBox(m.clips.down, p.price) && sameBox(m.clips.wick, p.price)).toBe(true);
      expect(sameBox(m.clips.volume, p.volume)).toBe(true);
      expect(inPane(m.up!.box!, p.price)).toBe(true);
      expect(inPane(m.down!.box!, p.price)).toBe(true);
      expect(inPane(m.wick!.box!, p.price)).toBe(true);
      expect(inPane(m.volume!.box!, p.volume)).toBe(true);
      for (const [mark, pane] of [[m.up!.box!, p.price], [m.down!.box!, p.price], [m.wick!.box!, p.price], [m.volume!.box!, p.volume]] as const) {
        const shown = paintedPart(mark, pane);
        expect(shown).not.toBeNull();
        expect(inside(shown!, pane, 0.01)).toBe(true);
      }
      // No price geometry reaches the volume pane and no volume bar reaches the price pane, even unclipped.
      expect(bottom(m.down!.box!)).toBeLessThanOrEqual(p.volume.y);
      expect(bottom(m.wick!.box!)).toBeLessThanOrEqual(p.volume.y);
      expect(m.volume!.box!.y).toBeGreaterThanOrEqual(bottom(p.price));
      expect(m.volume!.rects).toBe(DAYS); // every volume is positive and every candle valid

      // ── Ticks and titles: price ticks beside the price pane only, all positive; volume ticks beside volume.
      const text = await labels(page, '#chart');
      const priceTicks = text.filter(l => l.role === 'tick-y' && right(l.box) <= p.price.x + 1);
      const volumeTicks = text.filter(l => l.role === 'tick-y' && l.box.x >= right(p.volume) - 1);
      expect(priceTicks.length).toBeGreaterThanOrEqual(2);
      for (const t of priceTicks) {
        const mid = t.box.y + t.box.height / 2;
        expect(mid).toBeGreaterThanOrEqual(p.price.y - 1);
        expect(mid).toBeLessThanOrEqual(bottom(p.price) + 1);
        expect(Number(t.text.replace(/,/g, ''))).toBeGreaterThan(0);
      }
      expect(volumeTicks.length).toBeGreaterThanOrEqual(2);
      expect(volumeTicks.length).toBeLessThanOrEqual(3);
      for (const t of volumeTicks) {
        const mid = t.box.y + t.box.height / 2;
        expect(mid).toBeGreaterThanOrEqual(p.volume.y - 1);
        expect(mid).toBeLessThanOrEqual(bottom(p.volume) + 1);
      }
      const titles = text.filter(l => l.role === 'title-y').map(l => l.text).sort();
      expect(titles).toEqual(['Price (USD)', 'Shares']);
      const xTicks = text.filter(l => l.role === 'tick-x');
      expect(xTicks.length).toBeGreaterThan(0);
      for (const t of xTicks) expect(t.box.y).toBeGreaterThanOrEqual(bottom(p.volume) - 1);
      for (const t of text.filter(l => l.role === 'title-y')) expect(inside(t.box, p.svg, 0.5)).toBe(true);
      for (let i = 0; i < text.length; i++) for (let j = i + 1; j < text.length; j++) {
        expect(overlap(text[i]!.box, text[j]!.box), `${text[i]!.text} / ${text[j]!.text}`).toBe(false);
      }

      // ── Explicit yAxis.domain [100, 120] stays exactly that: its end ticks are 100 and 120, nothing below.
      const fixedPanes = await panes(page, '#fixed');
      const fixedTicks = (await labels(page, '#fixed')).filter(l => l.role === 'tick-y' && right(l.box) <= fixedPanes.price.x + 1)
        .map(l => Number(l.text.replace(/,/g, '')));
      expect(Math.min(...fixedTicks)).toBe(100);
      expect(Math.max(...fixedTicks)).toBe(120);
      expect(fixedTicks.every(v => v >= 100 && v <= 120)).toBe(true);
      // The end ticks sit on the pane's edges (no padding hides behind the same end labels): 120 centred on the
      // price pane's top, 100 on its bottom (review sol-6.2-medium, packed-assertion note).
      const fixedEnds = (await labels(page, '#fixed')).filter(l => l.role === 'tick-y' && right(l.box) <= fixedPanes.price.x + 1);
      const centerOf = (value: number) => {
        const l = fixedEnds.find(e => Number(e.text.replace(/,/g, '')) === value)!;
        return l.box.y + l.box.height / 2;
      };
      expect(Math.abs(centerOf(120) - fixedPanes.price.y)).toBeLessThanOrEqual(1.5);
      expect(Math.abs(centerOf(100) - bottom(fixedPanes.price))).toBeLessThanOrEqual(1.5);
      // The candle above the domain is not painted anywhere: every price mark stays in the price pane vertically,
      // while its volume bar (its own scale) is drawn and the table keeps its raw prices.
      const fixedMarks = await marks(page, '#fixed');
      for (const box of [fixedMarks.up!.box!, fixedMarks.down!.box!, fixedMarks.wick!.box!]) expect(inPane(box, fixedPanes.price)).toBe(true);
      expect(fixedMarks.volume!.rects).toBe(21);
      expect(inPane(fixedMarks.volume!.box!, fixedPanes.volume)).toBe(true);

      // ── Semantic paints: live custom properties, hollow up (stroke only), filled down.
      await page.evaluate(() => {
        const el = document.getElementById('chart')!;
        el.style.setProperty('--axylo-up', 'rgb(0, 128, 0)');
        el.style.setProperty('--axylo-down', 'rgb(200, 0, 0)');
        el.style.setProperty('--axylo-volume', 'rgb(0, 0, 160)');
      });
      const painted = await marks(page, '#chart');
      expect(painted.up!.tag.toLowerCase()).toBe('path');
      expect(painted.up!.fill).toBe('none');
      expect(painted.up!.stroke).toBe('rgb(0, 128, 0)');
      expect(painted.down!.fill).toBe('rgb(200, 0, 0)');
      expect(painted.volume!.fill).toBe('rgb(0, 0, 160)');

      // ── Hover from the volume pane and from the price pane: the readout is the raw row, as the table shows it.
      const tip = page.locator('#chart .axylo-tooltip, #chart .axylo-readout').filter({ visible: true });
      const centers = painted.volume!.centers;
      for (const [j, y] of [[7, p.volume.y + p.volume.height * 0.8], [12, p.price.y + p.price.height * 0.5]] as const) {
        await page.mouse.move(centers[j]!, y);
        await expect.poll(async () => (await tip.count()) === 1 ? (await tip.textContent()) ?? '' : '', { timeout: 5000 })
          .toContain(`${ROWS[j]!.open} USD`);
        const shown = (await tip.textContent()) ?? '';
        const r = ROWS[j]!;
        for (const part of [`${r.open} USD`, `${r.high} USD`, `${r.low} USD`, `${r.close} USD`, grouped(r.vol)]) expect(shown).toContain(part);
      }
      // The cursor rule spans both panes.
      const cursor = await page.evaluate(() => {
        const line = document.querySelector('#chart .axylo-overlay line') as SVGLineElement | null;
        if (!line) return null;
        const b = line.getBoundingClientRect();
        return { top: b.y, bottom: b.y + b.height };
      });
      expect(cursor).not.toBeNull();
      expect(cursor!.top).toBeLessThanOrEqual(p.price.y + 1);
      expect(cursor!.bottom).toBeGreaterThanOrEqual(bottom(p.volume) - 1);
      await page.mouse.move(1, 1);

      // ── Keyboard: the plot proxy steps one candle per ArrowRight, and its text is the raw row.
      const proxy = page.locator('#chart .axylo-proxy');
      await proxy.focus();
      const seen: number[] = [];
      for (let k = 0; k < 3; k++) {
        const previous = (await proxy.getAttribute('aria-valuetext')) ?? '';
        await page.keyboard.press('ArrowRight');
        await expect.poll(async () => {
          const now = (await proxy.getAttribute('aria-valuetext')) ?? '';
          return now !== previous && /Point \d+ of 60/.test(now);
        }, { timeout: 5000 }).toBe(true);
        const valuetext = (await proxy.getAttribute('aria-valuetext')) ?? '';
        // The position the reading states ("Point n of 60") names the row; its values must be that row's.
        const index = Number(/Point (\d+) of 60/.exec(valuetext)![1]) - 1;
        const r = ROWS[index]!;
        for (const part of [`${r.open} USD`, `${r.high} USD`, `${r.low} USD`, `${r.close} USD`, grouped(r.vol)]) expect(valuetext).toContain(part);
        seen.push(index);
      }
      expect(seen[1]! - seen[0]!).toBe(1);
      expect(seen[2]! - seen[1]!).toBe(1);

      // ── Zoom in (keyboard) and reset: fewer candles drawn, back to all of them; panes are kept.
      await page.keyboard.press('+');
      await page.waitForFunction(n => {
        const g = Array.from(document.querySelectorAll('#chart .axylo-scene > *')).find(el => ((el as SVGElement).style.getPropertyValue('color') ?? '').includes('--axylo-volume'));
        return !!g && g.querySelectorAll('rect').length < n;
      }, DAYS);
      const zoomedPanes = await panes(page, '#chart');
      expect(bottom(zoomedPanes.price)).toBeLessThan(zoomedPanes.volume.y);
      await page.locator('#chart').getByRole('button', { name: 'Reset zoom' }).click();
      await page.waitForFunction(n => {
        const g = Array.from(document.querySelectorAll('#chart .axylo-scene > *')).find(el => ((el as SVGElement).style.getPropertyValue('color') ?? '').includes('--axylo-volume'));
        return !!g && g.querySelectorAll('rect').length === n;
      }, DAYS);

      // ── Table: the same raw values, and it toggles back.
      await page.locator('#chart').getByRole('button', { name: /View as table/i }).click();
      await page.waitForSelector('#chart table tbody tr');
      const table = await page.evaluate(() => ({
        headers: [...document.querySelectorAll('#chart table thead th')].map(th => th.textContent?.trim() ?? ''),
        rows: [...document.querySelectorAll('#chart table tbody tr')].map(tr => [...tr.querySelectorAll('th, td')].map(td => td.textContent?.trim() ?? '')),
      }));
      expect(table.headers).toEqual(['day', 'Open', 'High', 'Low', 'Close', 'Change', 'Direction', 'Volume']);
      expect(table.rows.length).toBe(50); // first page of 60 rows
      for (const j of [0, 7, 12, 49]) {
        const r = ROWS[j]!;
        const diff = r.close - r.open;
        expect(table.rows[j]!.slice(1)).toEqual([
          `${r.open} USD`, `${r.high} USD`, `${r.low} USD`, `${r.close} USD`, `${diff > 0 ? '+' : ''}${diff} USD`,
          diff > 0 ? 'up' : diff < 0 ? 'down' : 'unchanged', grouped(r.vol),
        ]);
      }
      await page.locator('#chart').getByRole('button', { name: 'Hide table' }).click();
      await expect.poll(() => page.locator('#chart table').filter({ visible: true }).count(), { timeout: 5000 }).toBe(0);

      // ── axe-core: no violations on the chart figures. Evaluated through the DevTools protocol, not an inline script.
      await page.evaluate(axeSource);
      const axe = await page.evaluate(async () => {
        const run = (window as unknown as { axe: { run(context: unknown, options: unknown): Promise<{ violations: { id: string; nodes: unknown[] }[] }> } }).axe;
        const result = await run.run({ include: [['#chart'], ['#fixed'], ['#dense'], ['#flagged']] }, { resultTypes: ['violations'] });
        return result.violations.map(v => `${v.id} (${v.nodes.length})`);
      });
      expect(axe).toEqual([]);

      // ── Strict rollback: the rejected update leaves panes, marks and diagnostics as they were; the next one applies.
      const snapshot = async () => ({ panes: await panes(page, '#chart'), marks: (await marks(page, '#chart')).volume!.rects,
        titles: (await labels(page, '#chart')).filter(l => l.role === 'title-y').map(l => l.text).sort(),
        codes: await page.evaluate(() => (window as unknown as { __fin: { diagnostics: readonly { code: string }[] } }).__fin.diagnostics.map(d => d.code).sort()) });
      const before = await snapshot();
      const threw = await page.evaluate(() => {
        const chart = (window as unknown as { __fin: { update(p: unknown): void } }).__fin;
        try { chart.update({ strict: true, open: 'close', volumeAxis: { label: 'Rejected' } }); return false; } catch { return true; }
      });
      expect(threw).toBe(true);
      // A rejected update schedules nothing new; two frames later the chart is still the committed one.
      await frames(page);
      expect(await snapshot()).toEqual(before);
      await page.evaluate(() => (window as unknown as { __fin: { update(p: unknown): void } }).__fin.update({ volumeAxis: { label: 'Lots' } }));
      await expect.poll(async () => (await labels(page, '#chart')).filter(l => l.role === 'title-y').map(l => l.text).sort(), { timeout: 5000 })
        .toEqual(['Lots', 'Price (USD)']);

      // ── Volume off and on again through the public update path: the price pane takes the whole plot, then gives it back.
      const shown = await panes(page, '#chart');
      const volumeMark = (present: boolean) => page.waitForFunction(want =>
        !!Array.from(document.querySelectorAll('#chart .axylo-scene > *')).find(el => ((el as SVGElement).style.getPropertyValue('color') ?? '').includes('--axylo-volume')) === want, present);
      await page.evaluate(() => (window as unknown as { __fin: { update(p: unknown): void } }).__fin.update({ volume: undefined }));
      await volumeMark(false);
      const alone = await panes(page, '#chart');
      expect(alone.price.height).toBeGreaterThan(shown.price.height * 1.25);
      // The plot keeps its bottom (the x axis may re-fit by a pixel at the wider plot width).
      expect(Math.abs(bottom(alone.price) - bottom(shown.volume))).toBeLessThanOrEqual(2);
      expect((await labels(page, '#chart')).filter(l => l.role === 'title-y').map(l => l.text)).toEqual(['Price (USD)']);
      const aloneMarks = await marks(page, '#chart');
      expect(inPane(aloneMarks.down!.box!, alone.price)).toBe(true);
      await page.evaluate(() => (window as unknown as { __fin: { update(p: unknown): void } }).__fin.update({ volume: 'vol' }));
      await volumeMark(true);
      const back = await panes(page, '#chart');
      expect(sameBox(back.price, shown.price) && sameBox(back.volume, shown.volume)).toBe(true);

      // ── AX180 / AX181: diagnosed, summarised, read with their qualifiers, and left out of the right marks only.
      const flaggedInfo = await page.evaluate(() => {
        const chart = (window as unknown as { __flagged: { diagnostics: readonly { code: string; count?: number; rows?: readonly number[] }[] } }).__flagged;
        // The figure is the target or its first described descendant (the proxy, described by its instructions, comes later).
        const figure = document.querySelector('#flagged[aria-describedby], #flagged [aria-describedby]');
        const summary = (figure?.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
          .map(id => document.getElementById(id)?.textContent ?? '').join(' ');
        return { diagnostics: chart.diagnostics.map(d => ({ code: d.code, count: d.count, rows: d.rows })), summary };
      });
      expect(flaggedInfo.diagnostics.filter(d => d.code === 'AX180' || d.code === 'AX181').sort((a, b) => a.code.localeCompare(b.code))).toEqual([
        { code: 'AX180', count: 1, rows: [1] },
        { code: 'AX181', count: 1, rows: [3] },
      ]);
      expect(flaggedInfo.summary).toContain('Values not shown');
      // Below the fold: scrolled into view first, so pointer coordinates and every box below are measured in view.
      await page.locator('#flagged').scrollIntoViewIfNeeded();
      const flaggedMarks = await marks(page, '#flagged');
      // Volume bars for rows 0, 2, 4, 5 only: row 1 has no drawable candle, row 3 a negative volume.
      expect(flaggedMarks.volume!.rects).toBe(4);
      expect(flaggedMarks.down!.rects).toBe(2); // rows 2 and 4
      const flaggedProxy = page.locator('#flagged .axylo-proxy');
      await flaggedProxy.focus();
      const cursorX = () => page.evaluate(() => {
        const line = document.querySelector('#flagged .axylo-overlay line');
        return line ? Number(line.getAttribute('x1')) : null;
      });
      // Polls the attribute itself (not a boolean) so a timeout prints the reading the proxy actually holds.
      const readAt = async (point: number) => {
        await expect.poll(async () => (await flaggedProxy.getAttribute('aria-valuetext')) ?? '', { timeout: 5000 }).toContain(`Point ${point} of 6`);
        // The reading and the cursor rule are written in the same key handler; two frames rule out a stale rule.
        await frames(page);
        await expect.poll(cursorX, { timeout: 5000 }).not.toBeNull();
        return { text: (await flaggedProxy.getAttribute('aria-valuetext')) ?? '', x: (await cursorX())! };
      };
      // Focusing the proxy already selects the first candle (dom/interaction.ts #onProxyFocus → #takeover →
      // firstDatum), so an ArrowRight here would land on point 2. Home pins the start whatever focus chose.
      await page.keyboard.press('Home');
      const first = await readAt(1);
      for (const part of ['100 USD', '106 USD', '99 USD', '104 USD', '+4 USD (up)', '1,000']) expect(first.text).toContain(part);
      expect(first.text).not.toContain('invalid');
      await page.keyboard.press('ArrowRight');
      const invalidOhlc = await readAt(2);
      expect(invalidOhlc.x).toBeGreaterThan(first.x);
      for (const part of ['104 USD (invalid OHLC)', '103 USD (invalid OHLC)', '100 USD (invalid OHLC)', '102 USD (invalid OHLC)', '2,000']) {
        expect(invalidOhlc.text).toContain(part);
      }
      await page.keyboard.press('ArrowRight');
      const third = await readAt(3);
      expect(third.x).toBeGreaterThan(invalidOhlc.x);
      await page.keyboard.press('ArrowRight');
      const invalidVolume = await readAt(4);
      expect(invalidVolume.x).toBeGreaterThan(third.x);
      for (const part of ['100 USD', '108 USD', '99 USD', '106 USD', '-500 (invalid volume)']) expect(invalidVolume.text).toContain(part);
      expect(invalidVolume.text).not.toContain('invalid OHLC');
      // The AX180 candle has no wick or body; the AX181 candle is drawn (hollow, up) but has no volume bar.
      // The cursor rule is snapped to the pixel grid (at most half a pixel off); neighbouring candles are ~90 px apart.
      const near = (xs: readonly number[], x: number) => xs.some(v => Math.abs(v - x) < 1.5);
      expect(near(vertexXs(flaggedMarks.wick!.d), invalidOhlc.x)).toBe(false);
      expect(near(vertexXs(flaggedMarks.upD), invalidOhlc.x)).toBe(false);
      expect(near(vertexXs(flaggedMarks.wick!.d), invalidVolume.x)).toBe(true);
      const svgLeft = await page.evaluate(() => document.querySelector('#flagged svg.axylo-svg')!.getBoundingClientRect().x);
      expect(near(flaggedMarks.volume!.centers.map(c => c - svgLeft), invalidVolume.x)).toBe(false);
      expect(near(flaggedMarks.volume!.centers.map(c => c - svgLeft), invalidOhlc.x)).toBe(false);
      // Pointer: the same qualifiers in the tooltip.
      const flaggedTip = page.locator('#flagged .axylo-tooltip, #flagged .axylo-readout').filter({ visible: true });
      await flaggedProxy.blur();
      await page.locator('#flagged').scrollIntoViewIfNeeded();
      const flaggedPanes = await panes(page, '#flagged');
      await page.mouse.move(svgLeft + invalidOhlc.x, flaggedPanes.price.y + flaggedPanes.price.height / 2);
      await expect.poll(async () => (await flaggedTip.count()) === 1 ? (await flaggedTip.textContent()) ?? '' : '', { timeout: 5000 })
        .toContain('104 USD (invalid OHLC)');
      await page.mouse.move(svgLeft + invalidVolume.x, flaggedPanes.volume.y + flaggedPanes.volume.height / 2);
      await expect.poll(async () => (await flaggedTip.count()) === 1 ? (await flaggedTip.textContent()) ?? '' : '', { timeout: 5000 })
        .toContain('-500 (invalid volume)');
      await page.mouse.move(1, 1);
      // Table: raw values with the same qualifiers; the AX180 row has no direction.
      await page.locator('#flagged').getByRole('button', { name: /View as table/i }).click();
      await page.waitForSelector('#flagged table tbody tr');
      const flaggedRows = await page.evaluate(() => [...document.querySelectorAll('#flagged table tbody tr')]
        .map(tr => [...tr.querySelectorAll('th, td')].map(td => td.textContent?.trim() ?? '')));
      expect(flaggedRows).toHaveLength(6);
      expect(flaggedRows[1]!.slice(1, 5)).toEqual(['104 USD (invalid OHLC)', '103 USD (invalid OHLC)', '100 USD (invalid OHLC)', '102 USD (invalid OHLC)']);
      expect(flaggedRows[1]![6]).toBe('omitted');
      expect(flaggedRows[1]![7]).toBe('2,000');
      expect(flaggedRows[3]!.slice(1)).toEqual(['100 USD', '108 USD', '99 USD', '106 USD', '+6 USD', 'up', '-500 (invalid volume)']);
      await page.locator('#flagged').getByRole('button', { name: 'Hide table' }).click();

      // The fixed chart's table keeps the raw prices of the candle above its domain.
      await page.locator('#fixed').getByRole('button', { name: /View as table/i }).click();
      await page.waitForSelector('#fixed table tbody tr');
      const aboveRow = await page.evaluate(() => {
        const last = [...document.querySelectorAll('#fixed table tbody tr')].at(-1)!;
        return [...last.querySelectorAll('th, td')].map(td => td.textContent?.trim() ?? '');
      });
      expect(aboveRow.slice(1, 5)).toEqual(['130', '131', '125', '126']);
      await page.locator('#fixed').getByRole('button', { name: 'Hide table' }).click();

      // ── 5,000 candles: aggregated into pixel bins, so the SVG stays small.
      const dense = await page.evaluate(() => ({
        rects: document.querySelectorAll('#dense svg rect').length,
        nodes: document.querySelectorAll('#dense svg *').length,
      }));
      expect(dense.rects).toBeLessThan(1500);
      expect(dense.nodes).toBeLessThan(2000);
      const densePanes = await panes(page, '#dense');
      const denseMarks = await marks(page, '#dense');
      expect(inPane(denseMarks.volume!.box!, densePanes.volume)).toBe(true);
      expect(inPane(denseMarks.down!.box!, densePanes.price)).toBe(true);
      expect(sameBox(denseMarks.clips.volume, densePanes.volume) && sameBox(denseMarks.clips.down, densePanes.price)).toBe(true);

      expect(errors).toEqual([]);
      expect(server.reports.get('finance') ?? []).toEqual([]);
      await page.evaluate(() => {
        for (const k of ['__fin', '__fixed', '__dense', '__flagged']) (window as unknown as Record<string, { destroy(): void }>)[k]!.destroy();
      });
      expect(await page.evaluate(() => document.querySelectorAll('#chart svg, #fixed svg, #dense svg, #flagged svg').length)).toBe(0);
    } finally {
      await watched.context.close();
    }
  });
});
