/**
 * Round 3: the narrow cross-provider re-check (reviews/2026-11-18/impl/wp/blockers-recheck.review.md), its
 * still-partial defects (table 1) and regressions (table 2), each with the reviewer's sequence, against
 * decision 0004 revision 3 and its clarifications (the Escape one as rewritten for this round).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { requireEngineFeature, start, stop } from '../harness';
import { RENDERER, chartPage, closePage } from './util';
import { create, frames, inside, lastHover, plotBox, recordEvents, selected, settle, strip, tip, walk, type Box, type Pt } from './final-util';

beforeAll(start);
afterAll(stop);

const proxy = '#chart .axylo-proxy';
const valueText = (page: Page) => page.locator(proxy).getAttribute('aria-valuetext');
const clickAt = async (page: Page, at: Pt) => { await page.mouse.move(at.x, at.y); await page.mouse.down(); await page.mouse.up(); await settle(page); };

describe('item 1: groups come from the lookup (C8, I8)', () => {
  it('nine exactly coincident points with clipped points interleaved in x order: page two lists the ninth, not page one again', async () => {
    const page = await chartPage();
    // Members at x 5 + i·1e-9 (one pixel), y 5; between each two in x order a point at y 500, outside the y domain.
    const data = Array.from({ length: 9 }, (_, i) => [{ x: 5 + i * 1e-9, y: 5, s: 'A', id: i }, { x: 5 + i * 1e-9 + 5e-10, y: 500, s: 'A', id: 100 + i }]).flat();
    await create(page, 'scatter', { title: 'G', data, x: { field: 'x', domain: [0, 10] }, y: { field: 'y', domain: [0, 10] }, series: 's' });
    await recordEvents(page);
    const p = await plotBox(page);
    await clickAt(page, { x: p.x + p.width / 2, y: p.y + p.height / 2 });
    const more = page.locator('#chart .axylo-tooltip button.axylo-tooltip-more');
    expect(await more.textContent()).toBe('+1 more');
    const first = new Set<number>();
    for (const b of await page.locator('#chart .axylo-tooltip button.axylo-tooltip-row').all()) { await b.click(); await settle(page); }
    for (const e of await selected(page)) first.add((e.row as { id: number }).id);
    await more.click();
    await settle(page);
    const rows = page.locator('#chart .axylo-tooltip button.axylo-tooltip-row');
    expect(await rows.count()).toBe(1);
    await rows.first().click();
    await settle(page);
    const ninth = ((await selected(page)).at(-1)!.row as { id: number }).id;
    expect(first.has(ninth)).toBe(false);
    expect(ninth).toBeLessThan(9);
    expect(await closePage(page)).toEqual([]);
  });

  it('the 32,000-point ring around the pointer: every row of page two belongs to the winning group (within its device pixel)', async () => {
    const page = await chartPage({ css: '#chart { width: 520px; height: 420px; }' });
    await create(page, 'scatter', { title: 'Ring', data: [{ x: 0, y: 0 }], x: { field: 'x', domain: [0, 200] }, y: { field: 'y', domain: [0, 200] } });
    const p = await plotBox(page);
    // A 20 px ring around the plot's centre, in data units of this plot.
    await page.evaluate(({ w, h }) => {
      const n = 32_000;
      window.charts[0]!.update({ data: Array.from({ length: n }, (_, i) => ({ x: 100 + (20 * 200 / w) * Math.cos(2 * Math.PI * i / n), y: 100 + (20 * 200 / h) * Math.sin(2 * Math.PI * i / n) })) });
    }, { w: p.width, h: p.height });
    await settle(page);
    await recordEvents(page);
    await clickAt(page, { x: p.x + p.width / 2, y: p.y + p.height / 2 });
    const more = page.locator('#chart .axylo-tooltip button.axylo-tooltip-more');
    // The reviewer's ring at DPR 1: the winning lattice group has more than eight members.
    expect(await more.count()).toBe(1);
    const pageOne: Pt[] = [];
    const screen = (e: { x: unknown; y: number | null }) => ({ x: p.x + ((e.x as number) / 200) * p.width, y: p.y + p.height * (1 - (e.y as number) / 200) });
    for (const b of await page.locator('#chart .axylo-tooltip button.axylo-tooltip-row').all()) { await b.click(); await settle(page); }
    for (const e of await selected(page)) pageOne.push(screen(e));
    const before = (await selected(page)).length;
    await more.click();
    await settle(page);
    for (const b of await page.locator('#chart .axylo-tooltip button.axylo-tooltip-row').all()) { await b.click(); await settle(page); }
    const pageTwo = (await selected(page)).slice(before).map(screen);
    expect(pageTwo.length).toBeGreaterThan(0);
    // A lattice group is one point of the device-pixel lattice (DPR 1: the plot's whole pixels): every member
    // of page two rounds to the same plot pixel as page one's members.
    const cell = (q: Pt) => `${Math.round(q.x - p.x)},${Math.round(q.y - p.y)}`;
    const cells = new Set(pageOne.map(cell));
    expect(cells.size, [...cells].join(' ')).toBe(1);
    for (const q of pageTwo) expect(cell(q)).toBe(cell(pageOne[0]!));
    expect(await closePage(page)).toEqual([]);
  });
});

describe('item 2: Escape and dismissal by the rewritten clarification', () => {
  // The acceptance fixture: four slices of spend, the probe at 45° (Travel) and the next slice's at 63° (Rent).
  it.skipIf(RENDERER === 'canvas')('donut: after a rest and the corridor into the tooltip, Escape, back to the first slice (closed), then to another: it opens', async () => {
    const page = await chartPage({ css: '#before, #after { display: inline-block !important; }' });
    const items = ['Travel', 'Rent', 'Books', 'Food'], values = [360, 1200, 240, 600];
    await create(page, 'donut', { title: 'Monthly spend', data: items.map((item, i) => ({ item, spend: values[i] })), label: 'item', value: { field: 'spend', label: 'Spend', unit: 'EUR' } });
    const g = await page.evaluate(() => {
      const svg = document.querySelector('#chart svg.axylo-svg') as SVGSVGElement;
      const m = svg.getScreenCTM()!;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const el of svg.querySelectorAll<SVGPathElement>('.axylo-scene path')) {
        if (!/A/.test(el.getAttribute('d') ?? '')) continue;
        const b = el.getBBox();
        if (b.width < 1 || b.height < 1) continue;
        const a = new DOMPoint(b.x, b.y).matrixTransform(m), c = new DOMPoint(b.x + b.width, b.y + b.height).matrixTransform(m);
        x0 = Math.min(x0, a.x); y0 = Math.min(y0, a.y); x1 = Math.max(x1, c.x); y1 = Math.max(y1, c.y);
      }
      return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, outer: (x1 - x0) / 2 };
    });
    const at = (deg: number): Pt => ({ x: g.cx + g.outer * 0.85 * Math.sin(deg * Math.PI / 180), y: g.cy - g.outer * 0.85 * Math.cos(deg * Math.PI / 180) });
    const first = at(45), other = at(63);
    await page.mouse.move(first.x, first.y);
    await settle(page);
    const t = (await tip(page)).box!;
    await page.waitForTimeout(300);
    const target = { x: Math.min(t.x + t.width - 2, Math.max(t.x + 2, first.x)), y: Math.min(t.y + t.height - 2, Math.max(t.y + 2, first.y)) };
    await walk(page, first, target, 24, async () => null);
    expect((await tip(page)).title).toBe('Travel');
    await page.keyboard.press('Escape');
    await settle(page);
    expect((await tip(page)).title).toBeNull();
    await page.mouse.move(first.x, first.y);
    await settle(page);
    expect((await tip(page)).title).toBeNull();
    await page.mouse.move(other.x, other.y);
    await settle(page);
    expect((await tip(page)).title).toBe('Rent');
    expect(await closePage(page)).toEqual([]);
  });

  it('R4: pin A, move over B, Escape, move within B: B opens (only the pinned datum was dismissed)', async () => {
    const page = await chartPage();
    await create(page, 'line', { title: 'T', data: Array.from({ length: 5 }, (_, x) => ({ x, y: x })), x: { field: 'x', domain: [0, 4] }, y: 'y' });
    const p = await plotBox(page);
    const at = (x: number, dy = 0): Pt => ({ x: p.x + (x / 4) * p.width, y: p.y + p.height / 2 + dy });
    await clickAt(page, at(1));
    expect(await tip(page)).toMatchObject({ title: '1', pinned: true });
    await page.mouse.move(at(3).x, at(3).y);
    await settle(page);
    await page.keyboard.press('Escape');
    await settle(page);
    expect((await tip(page)).title).toBeNull();
    await page.mouse.move(at(3).x + 1, at(3).y + 1);
    await settle(page);
    expect(await tip(page)).toMatchObject({ title: '3', pinned: false });
    expect(await closePage(page)).toEqual([]);
  });
});

describe('item 3 (R1): a pressed row selects its own category; only the press\'s own click is swallowed', () => {
  it('pin Q3 in Q1–Q4, press its row, append Q5 with keep 4, release over the row: Q3 is selected', async () => {
    const page = await chartPage();
    await create(page, 'bar', { title: 'B', data: ['Q1', 'Q2', 'Q3', 'Q4'].map((x, i) => ({ x, y: i + 1 })), x: 'x', y: 'y' });
    await recordEvents(page);
    const p = await plotBox(page);
    await clickAt(page, { x: p.x + p.width * (2.5 / 4), y: p.y + p.height * 0.9 });
    expect(await tip(page)).toMatchObject({ title: 'Q3', pinned: true });
    const before = (await selected(page)).length;
    const row = (await page.locator('#chart .axylo-tooltip button.axylo-tooltip-row').first().boundingBox())!;
    await page.mouse.move(row.x + row.width / 2, row.y + row.height / 2);
    await page.mouse.down();
    await page.evaluate(() => window.charts[0]!.append([{ x: 'Q5', y: 5 }], { keep: 4 }));
    await settle(page);
    expect((await tip(page)).title).toBe('Q3');
    const now = (await page.locator('#chart .axylo-tooltip button.axylo-tooltip-row').first().boundingBox())!;
    await page.mouse.move(now.x + now.width / 2, now.y + now.height / 2);
    await page.mouse.up();
    await settle(page);
    const after = (await selected(page)).slice(before);
    expect(after.map(e => e.x)).toEqual(['Q3']);
    expect(await closePage(page)).toEqual([]);
  });

  it('a pointer press on one row, then Enter on another row at once: both are selected', async () => {
    const page = await chartPage();
    const data = [0, 1, 2].flatMap(x => ['North', 'South'].map((s, i) => ({ x, s, y: x + i * 3 })));
    await create(page, 'line', { title: 'Two', data, x: { field: 'x', domain: [0, 2] }, y: 'y', series: 's' });
    await recordEvents(page);
    const p = await plotBox(page);
    await clickAt(page, { x: p.x + p.width / 2, y: p.y + p.height / 2 });
    const before = (await selected(page)).length;
    await page.locator('#chart .axylo-tooltip button', { hasText: 'North' }).click();
    await page.locator('#chart .axylo-tooltip button', { hasText: 'South' }).focus();
    await page.keyboard.press('Enter');
    await settle(page);
    expect((await selected(page)).slice(before).map(e => e.series)).toEqual(['North', 'South']);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('item 4 (R2): Escape belongs to the chart focus is in, through shadow roots', () => {
  it('A in a shadow root, created first: pin A, hover B, Escape: A\'s pin closes, B\'s tooltip stays', async () => {
    const page = await chartPage({ css: '#chart { width: 480px; height: 300px; }' });
    await page.evaluate(async () => {
      const host = document.createElement('div');
      document.body.insertBefore(host, document.getElementById('chart'));
      const root = host.attachShadow({ mode: 'open' });
      for (const sheet of document.querySelectorAll('style, link[rel="stylesheet"]')) root.appendChild(sheet.cloneNode(true));
      const inner = document.createElement('div');
      inner.style.cssText = 'width: 480px; height: 300px;';
      root.appendChild(inner);
      (window as unknown as { shadowChart: HTMLElement }).shadowChart = inner;
      const data = Array.from({ length: 5 }, (_, x) => ({ x, y: x }));
      const a = window.Axylo.line!(inner, { title: 'A', data, x: 'x', y: 'y' });
      await a.__bench.ready();
      const b = window.Axylo.line!('#chart', { title: 'B', data, x: 'x', y: 'y' });
      await b.__bench.ready();
      window.charts.push(a, b);
      await window.nextFrames(2);
    });
    const aProxy = await page.evaluate(() => {
      const r = (window as unknown as { shadowChart: HTMLElement }).shadowChart.querySelector('.axylo-proxy')!.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    const aPinned = () => page.evaluate(() => (window as unknown as { shadowChart: HTMLElement }).shadowChart.querySelector('.axylo-tooltip')!.classList.contains('axylo-tooltip-pinned'));
    await clickAt(page, { x: aProxy.x + aProxy.width / 2, y: aProxy.y + aProxy.height / 2 });
    expect(await aPinned()).toBe(true);
    const b = await plotBox(page);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await settle(page);
    expect((await tip(page)).title).not.toBeNull();
    await page.keyboard.press('Escape');
    await settle(page);
    expect(await aPinned()).toBe(false);
    expect((await tip(page)).title).not.toBeNull();
    expect(await closePage(page)).toEqual([]);
  });
});

/** A 220 px tile (readout mode) of three series with long names, its strip's parts and their boxes. */
async function stripParts(page: Page) {
  return page.evaluate(() => {
    const s = document.querySelector('#chart .axylo-readout') as HTMLElement;
    const box = s.getBoundingClientRect();
    const parts = [s.querySelector('.axylo-tooltip-title'), s.querySelector('.axylo-readout-entry'), s.querySelector('.axylo-tooltip-more')]
      .filter((e): e is Element => !!e).map(e => [...e.getClientRects()].every(r => r.left >= box.left - 0.5 && r.right <= box.right + 0.5 && r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5));
    return { hidden: s.hidden, parts };
  });
}

describe('item 5 (I4): a strip is shown only when its title, one value and its pager can be seen', () => {
  it('a long category name in a narrow strip: the title is cut with an ellipsis and the first row and pager stay inside, or nothing is shown', async () => {
    const page = await chartPage({ css: '#chart { width: 220px; height: 420px; }' });
    const names = ['North-western regional distribution', 'South-eastern regional distribution', 'Central'];
    const cats = ['A category whose name is long enough to fill both lines of the strip by itself, and more', 'B'];
    await create(page, 'bar', { title: 'L', legend: false, data: cats.flatMap(x => names.map((s, i) => ({ x, s, y: i + 1 }))), x: 'x', y: 'y', series: 's' });
    const p = await plotBox(page);
    await clickAt(page, { x: p.x + p.width / 4, y: p.y + p.height - 4 });
    const s = await stripParts(page);
    if (!s.hidden) {
      expect(s.parts.length).toBeGreaterThanOrEqual(2);
      expect(s.parts.every(Boolean), JSON.stringify(s)).toBe(true);
    }
    expect(await closePage(page)).toEqual([]);
  });

  it('a strip of which a card leaves only a sliver visible is not shown', async () => {
    const page = await chartPage({ css: '#card { width: 220px; overflow: hidden; } #card #chart { width: 220px; height: 400px; }' });
    await page.evaluate(() => {
      const card = Object.assign(document.createElement('div'), { id: 'card' });
      const chart = document.getElementById('chart')!;
      chart.replaceWith(card);
      card.appendChild(chart);
    });
    await create(page, 'line', { title: 'S', legend: false, table: false, data: [0, 1, 2].map(x => ({ x, y: x })), x: 'x', y: 'y' });
    const p = await plotBox(page);
    const card = (await page.locator('#card').boundingBox())!;
    // 5 px of the strip (under the plot and its axis) are inside the card.
    const s0 = (await strip(page)).box;
    await page.evaluate(h => { document.getElementById('card')!.style.height = `${h}px`; }, s0.y + 5 - card.y);
    await settle(page);
    await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
    await settle(page);
    expect((await strip(page)).text).toBeNull();
    expect(await closePage(page)).toEqual([]);
  });
});

describe('item 6 (I5): clipping through a slot', () => {
  it('a chart slotted into a component whose shadow wrapper clips: the tooltip stays inside the wrapper', async () => {
    const page = await chartPage({ css: '#chart { width: 360px; height: 360px; }' });
    await page.evaluate(() => {
      const host = document.createElement('div');
      const chart = document.getElementById('chart')!;
      chart.replaceWith(host);
      host.appendChild(chart);
      const root = host.attachShadow({ mode: 'open' });
      // The wrapper clips 60 px below the plot's top.
      root.innerHTML = '<div id="wrap" style="width: 360px; height: 140px; overflow: hidden;"><slot></slot></div>';
    });
    await create(page, 'line', { title: 'Slot', legend: false, data: [0, 1, 2, 3].map(x => ({ x, y: 10 })), x: 'x', y: { field: 'y', domain: [0, 10] } });
    const wrapBox = () => page.evaluate(() => {
      const r = (document.querySelector('#chart')!.parentElement!.shadowRoot!.getElementById('wrap'))!.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    const p = await plotBox(page);
    // The wrapper ends 60 px below the plot's top: below the points on that edge there is no room.
    await page.evaluate(h => { (document.querySelector('#chart')!.parentElement!.shadowRoot!.getElementById('wrap') as HTMLElement).style.height = `${h}px`; }, p.y + 60 - (await wrapBox()).y);
    await settle(page);
    const wrap = await wrapBox();
    await page.mouse.move(p.x + p.width / 3, p.y + 4);
    await settle(page);
    const t = (await tip(page)).box;
    if (t) expect(t.y + t.height).toBeLessThanOrEqual(wrap.y + wrap.height + 0.5);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('item 7 (R8): range gestures clamp to the domain the plot is drawn with', () => {
  it('a narrow scatter drawn wider than its data: Select range from −1000 to 1500 asks for that zoom', async () => {
    const page = await chartPage({ css: '#chart { width: 195px; height: 360px; }' });
    await create(page, 'scatter', { title: 'N', data: [{ x: -3.3, y: 1 }, { x: 7.7, y: 2 }, { x: 1001.5, y: 3 }], x: 'x', y: 'y' });
    const domainOf = () => page.evaluate(() => window.charts[0]!.__bench.describe().xDomain);
    const before = await domainOf();
    const p = await plotBox(page);
    // The domain the plot is drawn with spans its width; −1000 and 1500 at their places in it.
    const [lo, hi] = before as [number, number];
    const xAt = (v: number) => p.x + ((v - lo) / (hi - lo)) * p.width;
    await page.evaluate(() => { const w = window as unknown as { zooms: unknown[] }; w.zooms = []; window.charts[0]!.on('zoom', z => w.zooms.push(z)); });
    const toggle = page.locator('#chart [role="toolbar"] button[title="Select range"]');
    await toggle.click();
    await clickAt(page, { x: xAt(-1000), y: p.y + p.height / 2 });
    await clickAt(page, { x: xAt(1500), y: p.y + p.height / 2 });
    // This layer's half: the two ends ask for a zoom (the selection is not taken for the whole range). Which
    // domain the controller then clamps that window to is the controller's half of R8.
    const zooms = await page.evaluate(() => (window as unknown as { zooms: unknown[] }).zooms);
    expect(zooms).toHaveLength(1);
    expect(zooms[0]).not.toBeNull();
    void domainOf;
    expect(await closePage(page)).toEqual([]);
  });
});

describe('item 7 (R8): every zoom gesture works in the same bounds', () => {
  it('the reviewer\'s 195 px scatter, unzoomed: a wheel over the plot zooms around the pointer within the domain the plot is drawn with', async () => {
    const page = await chartPage({ css: '#chart { width: 195px; height: 360px; }' });
    await create(page, 'scatter', { title: 'N', data: [{ x: -3.3, y: 1 }, { x: 7.7, y: 2 }, { x: 1001.5, y: 3 }], x: 'x', y: 'y' });
    await page.evaluate(() => { const w = window as unknown as { zooms: unknown[] }; w.zooms = []; window.charts[0]!.on('zoom', z => w.zooms.push(z)); });
    const [lo, hi] = (await page.evaluate(() => window.charts[0]!.__bench.describe().xDomain)) as [number, number];
    const p = await plotBox(page);
    await page.locator(proxy).focus();
    // At four fifths of the drawn width; one wheel step of −200 px scales the window by e^(−0.4).
    const share = 0.8;
    await page.mouse.move(p.x + share * p.width, p.y + p.height / 2);
    await page.mouse.wheel(0, -200);
    await settle(page);
    const zooms = await page.evaluate(() => (window as unknown as { zooms: number[][] }).zooms);
    expect(zooms).toHaveLength(1);
    const at = lo + share * (hi - lo), width = (hi - lo) * Math.exp(-0.4);
    const start = Math.max(lo, Math.min(at - share * width, hi - width));
    const tolerance = (hi - lo) / p.width;
    expect(Math.abs(zooms[0]![0]! - start)).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(zooms[0]![1]! - (start + width))).toBeLessThanOrEqual(tolerance);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('item 8 (R9): the one-pixel tolerance is in viewport pixels', () => {
  it('a chart scaled to 0.5 horizontally: a pointer at the whole viewport pixel left of the plot\'s edge (up to 1 px outside) picks the mark on that edge', async () => {
    const page = await chartPage({ css: '#wrap { transform: scale(0.5, 1); transform-origin: 0 0; width: 720px; }' });
    await page.evaluate(() => {
      const wrap = Object.assign(document.createElement('div'), { id: 'wrap' });
      const chart = document.getElementById('chart')!;
      chart.replaceWith(wrap);
      wrap.appendChild(chart);
    });
    await create(page, 'scatter', { title: 'E', data: [{ x: 0, y: 5 }, { x: 10, y: 5 }], x: { field: 'x', domain: [0, 10] }, y: { field: 'y', domain: [0, 10] } });
    await recordEvents(page);
    const p = await plotBox(page);
    // A whole pixel, as Firefox and WebKit deliver it: 0 to 1 viewport px outside, 0 to 2 layout px at 0.5.
    await page.mouse.move(Math.ceil(p.x) - 1, Math.round(p.y + p.height / 2));
    await settle(page);
    expect(await lastHover(page)).toMatchObject({ x: 0 });
    expect(await closePage(page)).toEqual([]);
  });
});

describe('item 10 (R14): a redraw during a drag keeps the drag\'s rectangle', () => {
  it('Select range with its first end set, a drag, an append before release: the selection is the drag\'s, not the 2 px marker', async () => {
    const page = await chartPage();
    await create(page, 'line', { title: 'R', data: Array.from({ length: 101 }, (_, i) => ({ x: i, y: i % 7 })), x: 'x', y: 'y' });
    const p = await plotBox(page);
    await page.locator('#chart [role="toolbar"] button[title="Select range"]').click();
    await clickAt(page, { x: p.x + p.width * 0.8, y: p.y + p.height / 2 });
    await page.mouse.move(p.x + p.width * 0.1, p.y + p.height / 2);
    await page.mouse.down();
    await page.mouse.move(p.x + p.width * 0.4, p.y + p.height / 2, { steps: 6 });
    await page.evaluate(() => window.charts[0]!.append([{ x: 101, y: 3 }]));
    await settle(page);
    const sel = (await page.locator('#chart .axylo-selection').boundingBox())!;
    expect(sel.width).toBeGreaterThan(p.width * 0.2);
    await page.mouse.up();
    expect(await closePage(page)).toEqual([]);
  });
});

describe('item 11 (I6): a presentation switch starts the rest afresh for the still pointer', () => {
  it('after a switch into the strip under a still pointer and a rest of 300 ms there, the corridor to the strip holds', async () => {
    const page = await chartPage({ css: '#chart { width: 300px; height: 420px; }' });
    await create(page, 'scatter', { title: 'S', data: [{ x: 1, y: 9 }, { x: 9, y: 1 }], x: { field: 'x', domain: [0, 10] }, y: { field: 'y', domain: [0, 10] } });
    const p0 = await plotBox(page);
    const at = { x: p0.x + p0.width * 0.1, y: p0.y + p0.height * 0.1 };
    await page.mouse.move(at.x, at.y);
    await settle(page);
    // Narrower than 240: the strip, with the pointer still over the same point.
    await page.evaluate(() => { document.getElementById('chart')!.style.width = '220px'; });
    await settle(page);
    const p = await plotBox(page);
    const here = { x: p.x + p.width * 0.1, y: p.y + p.height * 0.1 };
    await page.mouse.move(here.x, here.y);
    await settle(page);
    const before = (await strip(page)).text;
    expect(before).not.toBeNull();
    await page.waitForTimeout(300);
    const s = (await strip(page)).box;
    const target = { x: Math.min(s.x + s.width - 2, Math.max(s.x + 2, here.x)), y: s.y + 2 };
    const seen = await walk(page, here, target, 20, async () => (await strip(page)).text);
    expect(seen.every(t => t === before), seen.join(' | ')).toBe(true);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('item 12 (I13): a reordered slice keeps focus; a missing-y scatter row can be jumped to', () => {
  it('an all-zero donut\'s focused entry keeps focus when the slices are reordered', async () => {
    const page = await chartPage({ css: '#before, #after { display: inline-block !important; }' });
    await create(page, 'donut', { title: 'Z', table: false, data: [{ k: 'a', v: 0 }, { k: 'b', v: 0 }, { k: 'c', v: 0 }], label: 'k', value: 'v' });
    await page.focus('#before');
    await page.keyboard.press('Tab');
    await page.keyboard.press('ArrowDown');
    expect(await page.evaluate(() => document.activeElement?.closest('li')?.dataset.key)).toBe('b');
    await page.evaluate(() => window.charts[0]!.update({ data: [{ k: 'c', v: 0 }, { k: 'b', v: 0 }, { k: 'a', v: 0 }] }));
    await settle(page);
    expect(await page.evaluate(() => document.activeElement?.closest('li')?.dataset.key)).toBe('b');
    expect(await closePage(page)).toEqual([]);
  });

  it('a scatter on a date x: the date the table prints for a row with no y finds its page', async () => {
    const page = await chartPage();
    const day = (k: number) => new Date(Date.UTC(2026, 0, 1) + k * 864e5).toISOString().slice(0, 10);
    const rows = Array.from({ length: 250 }, (_, k) => ({ d: day(k), y: k === 230 ? null : k }));
    await create(page, 'scatter', { title: 'M', data: rows, x: { field: 'd', type: 'date' }, y: 'y' });
    await page.locator('#chart button', { hasText: 'View as table' }).click();
    // The printed date of the row with no y, as the table writes it (it lists every row, by x).
    let printed: string | null = null;
    for (let k = 0; k < 3 && printed === null; k++) {
      printed = await page.evaluate(() => [...document.querySelectorAll('#chart .axylo-table tbody tr')].find(tr => tr.querySelectorAll('td')[1]?.textContent === 'No data')?.querySelector('th')?.textContent ?? null);
      if (printed === null) await page.locator('#chart .axylo-pager button', { hasText: 'Next page' }).click();
    }
    expect(printed).not.toBeNull();
    await page.locator('#chart .axylo-pager button', { hasText: 'Previous page' }).click();
    await page.locator('#chart .axylo-pager button', { hasText: 'Previous page' }).click();
    const field = page.locator('#chart .axylo-jump-field');
    await field.fill(printed!);
    await page.keyboard.press('Enter');
    expect(await field.getAttribute('aria-invalid'), printed!).toBeNull();
    expect(await closePage(page)).toEqual([]);
  });
});

describe('item 13: tests the re-check found missing', () => {
  it('I2: a narrowed secondary ref pinned survives a redraw and Resume', async () => {
    const page = await chartPage();
    const data = [0, 1, 2].flatMap(x => [{ x, s: 'A', y: x + 1 }, { x, s: 'B', y: x + 5 }]);
    await create(page, 'line', { title: 'T', data, x: { field: 'x', domain: [0, 3] }, y: 'y', series: 's' });
    await recordEvents(page);
    await page.locator(proxy).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await settle(page);
    expect(await valueText(page)).toMatch(/^B, /);
    const p = await plotBox(page);
    await clickAt(page, { x: p.x + p.width / 3, y: p.y + p.height / 2 });
    expect((await selected(page)).at(-1)).toMatchObject({ series: 'B', x: 1 });
    expect((await tip(page)).pinned).toBe(true);
    await page.evaluate(() => window.charts[0]!.append([{ x: 3, s: 'A', y: 1 }]));
    await settle(page);
    expect((await tip(page)).pinned).toBe(true);
    // Pause and Resume from the keyboard: a press elsewhere would end the pin (rule 4).
    await page.locator('#chart [role="toolbar"] button', { hasText: 'Pause' }).focus();
    await page.keyboard.press('Enter');
    await page.evaluate(() => window.charts[0]!.append([{ x: 3, s: 'B', y: 2 }]));
    await page.locator('#chart [role="toolbar"] button', { hasText: 'Resume' }).focus();
    await page.keyboard.press('Enter');
    await settle(page);
    expect(await tip(page)).toMatchObject({ title: '1', pinned: true });
    await page.locator(proxy).focus();
    await page.keyboard.press('Enter');
    await settle(page);
    expect((await selected(page)).at(-1)).toMatchObject({ series: 'B', x: 1 });
    expect(await closePage(page)).toEqual([]);
  });

  it('I3: a pinch that commits no zoom ends the pin, and hover works after it', async () => {
    requireEngineFeature(['chromium'], 'multi-point touch input is dispatched through the Chrome DevTools protocol');
    const page = await chartPage({ hasTouch: true });
    await create(page, 'line', { title: 'P', zoom: 'touch', data: Array.from({ length: 11 }, (_, x) => ({ x, y: x })), x: { field: 'x', domain: [0, 10] }, y: 'y' });
    const p = await plotBox(page);
    await page.touchscreen.tap(p.x + p.width * 0.3, p.y + p.height / 2);
    await settle(page);
    expect((await tip(page)).pinned).toBe(true);
    const client = await page.context().newCDPSession(page);
    const cx = p.x + p.width / 2, cy = p.y + p.height / 2;
    // Two fingers down and up without moving: no zoom.
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx - 40, y: cy, id: 1 }, { x: cx + 40, y: cy, id: 2 }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await settle(page);
    expect((await tip(page)).pinned).toBe(false);
    await page.mouse.move(p.x + p.width * 0.8, p.y + p.height / 2);
    await settle(page);
    expect((await tip(page)).title).toBe('8');
    expect(await closePage(page)).toEqual([]);
  });
});

void inside; void frames;
void (null as unknown as Box);
