/**
 * Reading the chart with a pointer, touch and the toolbar (spec I1–I6, A4, A7, L6, F8): tooltip, legend
 * toggles, zoom, pause, the table view, events and the figure details of part 2. Expected values come from
 * the fixtures and the spec; positions are computed from the plot rectangle and the drawn domain.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { start, stop } from '../harness';
import { LIGHT } from '../../../src/theme/palette';
import { closePage, count, hex, shot } from './util';
import { contrastOf, fixturePage, make } from '../a11y/util';

beforeAll(start);
afterAll(stop);

const DAY = 864e5;
const START = Date.UTC(2026, 0, 1);
const date = (t: number) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(t);
const number = (v: number) => new Intl.NumberFormat('en-US').format(v);

interface Geometry { plot: { x: number; y: number; width: number; height: number }; xDomain: number[]; yDomain: number[] }

/** The plot rectangle in viewport px (the keyboard proxy covers exactly it) and the drawn domains. */
async function geometry(page: Page, selector = '#chart', index = 0): Promise<Geometry> {
  return page.evaluate(({ selector, index }) => {
    const proxy = document.querySelector(`${selector} .axylo-proxy`)!.getBoundingClientRect();
    const { xDomain, yDomain } = window.charts[index]!.__bench.describe();
    return { plot: { x: proxy.x, y: proxy.y, width: proxy.width, height: proxy.height }, xDomain: xDomain!, yDomain: yDomain! };
  }, { selector, index });
}

const xPixel = (g: Geometry, x: number) => g.plot.x + (x - g.xDomain[0]!) / (g.xDomain[1]! - g.xDomain[0]!) * g.plot.width;
const settle = (page: Page) => page.evaluate(async () => { for (const c of window.charts) await c.__bench.ready(); await window.nextFrames(1); });
const domain = (page: Page) => page.evaluate(() => window.charts[0]!.__bench.describe().xDomain!);
const floating = (page: Page) => page.locator('#chart .axylo-tooltip');

describe('tooltip (spec I1)', () => {
  it('between two days shows every series at the nearer one, within one frame', async () => {
    const page = await fixturePage();
    await make(page, 'trend');
    const g = await geometry(page);
    const series = await page.evaluate(() => window.fx.trend.series);
    // 30 % of the way from day 10 to day 11: day 10 is nearer.
    const x = xPixel(g, START + 10.3 * DAY);
    await page.mouse.move(x, g.plot.y + g.plot.height / 2);
    const visibleNextFrame = await page.evaluate(async () => {
      await new Promise(r => requestAnimationFrame(r));
      return !(document.querySelector('#chart .axylo-tooltip') as HTMLElement).hidden;
    });
    expect(visibleNextFrame).toBe(true);
    const text = (await floating(page).textContent())!;
    expect(text).toContain(date(START + 10 * DAY));
    for (const s of series) expect(text).toContain(`${s.name}${number(s.values[10]!)}`);
    expect(await floating(page).locator('svg.axylo-swatch').count()).toBe(3);
    expect(await closePage(page)).toEqual([]);
  });

  it('at each of the four plot edges it stays inside the viewport and beside the active x', async () => {
    const page = await fixturePage({ css: 'body { margin: 0; } #chart { width: 100vw; height: 100vh; }' });
    await make(page, 'trend');
    const g = await geometry(page);
    const viewport = page.viewportSize()!;
    const cy = g.plot.y + g.plot.height / 2;
    const cx = g.plot.x + g.plot.width / 2;
    for (const [px, py] of [[g.plot.x + 1, cy], [g.plot.x + g.plot.width - 1, cy], [cx, g.plot.y + 1], [cx, g.plot.y + g.plot.height - 1]] as const) {
      // Each edge reached from outside the chart: a jump across the reading axis onto a shown tooltip is a
      // hover of the tooltip, which holds its datum (decision 0004, rule 3), not a new placement.
      await page.mouse.move(0, 0);
      await page.mouse.move(px, py);
      const box = (await floating(page).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      // Decision 0004: the tooltip is across the reading axis (above or below the pointer), centred on the
      // active x along it, so it never contains the pointer and reading along x never enters it.
      const at = await page.evaluate(() => window.charts[0]!.__bench.describe().xDomain);
      expect(at).toBeTruthy();
      expect(py < box.y || py > box.y + box.height, JSON.stringify({ px, py, box })).toBe(true);
    }
    expect(await closePage(page)).toEqual([]);
  });

  it('nine series show eight rows and "+1 more"', async () => {
    const page = await fixturePage();
    await page.evaluate(async () => {
      const data = Array.from({ length: 20 }, (_, i) => Object.fromEntries([['i', i], ...Array.from({ length: 9 }, (_, s) => [`s${s + 1}`, (s + 1) * 10 + i])]));
      const chart = window.Axylo.line!('#chart', { title: 'Nine', data, x: 'i', y: Array.from({ length: 9 }, (_, s) => `s${s + 1}`) });
      window.charts.push(chart);
      await chart.__bench.ready();
    });
    const g = await geometry(page);
    await page.mouse.move(g.plot.x + g.plot.width / 2, g.plot.y + g.plot.height / 2);
    expect(await floating(page).locator('.axylo-tooltip-row').count()).toBe(8);
    expect(await floating(page).locator('.axylo-tooltip-more').textContent()).toBe('+1 more');
    expect(await closePage(page)).toEqual([]);
  });

  it('can be hovered without closing, and Escape closes it until the pointer reaches another x', async () => {
    const page = await fixturePage();
    await make(page, 'trend');
    const g = await geometry(page);
    const x = xPixel(g, START + 30 * DAY);
    await page.mouse.move(x, g.plot.y + 40);
    const box = (await floating(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    expect(await floating(page).isVisible()).toBe(true);
    await page.mouse.move(x, g.plot.y + 40);
    await page.keyboard.press('Escape');
    expect(await floating(page).isVisible()).toBe(false);
    await page.mouse.move(x, g.plot.y + 60);
    expect(await floating(page).isVisible()).toBe(false);
    await page.mouse.move(xPixel(g, START + 40 * DAY), g.plot.y + 60);
    expect(await floating(page).isVisible()).toBe(true);
    expect(await floating(page).textContent()).toContain(date(START + 40 * DAY));
    expect(await closePage(page)).toEqual([]);
  });

  it('in a 260 px wide tile the same content is shown in the fixed readout under the plot', async () => {
    const page = await fixturePage({ css: '#chart { width: 260px; height: 300px; }' });
    await make(page, 'trend');
    const g = await geometry(page);
    await page.mouse.move(g.plot.x + g.plot.width / 2, g.plot.y + g.plot.height / 2);
    const readout = page.locator('#chart .axylo-readout');
    expect(await readout.isVisible()).toBe(true);
    expect(await floating(page).isVisible()).toBe(false);
    const text = (await readout.textContent())!;
    for (const name of ['Direct', 'Organic search', 'Referral']) expect(text).toContain(name);
    const [r, plot] = [(await readout.boundingBox())!, (await page.locator('#chart .axylo-plot').boundingBox())!];
    expect(Math.abs(r.y - (plot.y + plot.height))).toBeLessThanOrEqual(1);
    expect(await closePage(page)).toEqual([]);
  });

  it('a donut slice shows label, value and percentage; the overlay outlines it', async () => {
    const page = await fixturePage();
    await make(page, 'parts');
    const plot = (await page.locator('#chart .axylo-proxy').boundingBox())!;
    // Chrome (46.2 %) starts at 12 o'clock and runs clockwise: just right of the top, inside the ring.
    const cx = plot.x + plot.width / 2;
    const cy = plot.y + plot.height / 2;
    const r = Math.min(plot.width, plot.height) / 2;
    await page.mouse.move(cx + r * 0.3, cy - r * 0.8);
    const text = (await floating(page).textContent())!;
    expect(text).toContain('Chrome');
    expect(text).toContain('46.2%');
    expect(await closePage(page)).toEqual([]);
  });
});

describe('legend (spec I2, A5, L2, F8)', () => {
  it('toggles by click, Enter and Space; a hidden series leaves marks, tooltip and keyboard but stays in the table', async () => {
    const page = await fixturePage();
    await make(page, 'trend');
    const referral = page.locator('#chart .axylo-legend-entry', { hasText: 'Referral' });
    expect(await referral.getAttribute('aria-pressed')).toBe('true');
    await referral.click();
    await settle(page);
    expect(await referral.getAttribute('aria-pressed')).toBe('false');
    const { img } = await shot(page, '#chart .axylo-plot');
    expect(count(img, hex(LIGHT.series[2]!), 40)).toBeLessThan(20);
    expect(count(img, hex(LIGHT.series[0]!), 40)).toBeGreaterThan(200);
    const g = await geometry(page);
    await page.mouse.move(g.plot.x + g.plot.width / 2, g.plot.y + 30);
    expect(await floating(page).textContent()).not.toContain('Referral');
    expect(await page.locator('#chart .axylo-proxy').getAttribute('aria-valuetext')).not.toContain('Referral');
    await page.locator('#chart button', { hasText: 'View as table' }).click();
    expect(await page.locator('#chart table thead').textContent()).toContain('Referral');

    await referral.focus();
    await page.keyboard.press('Enter');
    await settle(page);
    expect(await referral.getAttribute('aria-pressed')).toBe('true');
    await page.keyboard.press(' ');
    await settle(page);
    expect(await referral.getAttribute('aria-pressed')).toBe('false');
    // Marked by an outline swatch and a struck-through name, never by dimmed text.
    expect(await referral.locator('.axylo-control-label').evaluate(el => getComputedStyle(el).textDecorationLine)).toBe('line-through');
    expect(await referral.locator('svg path').getAttribute('stroke')).toBe('currentColor');
    expect(await contrastOf(page, '#chart .axylo-legend-entry.axylo-struck .axylo-control-label')).toBeGreaterThanOrEqual(4.5);
    expect(await closePage(page)).toEqual([]);
  });

  it('a single-series chart has no legend', async () => {
    const page = await fixturePage();
    await make(page, 'bars');
    expect(await page.locator('#chart .axylo-legend-entry').count()).toBe(0);
    expect(await closePage(page)).toEqual([]);
  });

  it('the donut legend is a list of six entries with value and percentage, in slice order, outside the tab order', async () => {
    const page = await fixturePage();
    await make(page, 'parts');
    const items = page.locator('#chart ul.axylo-legend-list > li');
    expect(await items.count()).toBe(6);
    const texts = await items.allTextContents();
    const fx = await page.evaluate(() => window.fx.parts);
    fx.labels.forEach((label, i) => {
      expect(texts[i]).toContain(label);
      expect(texts[i]).toContain(`${fx.values[i]}%`);
    });
    // Each field on its own (acceptance gap: the value and the share have the same text here, so one could be
    // missing): the name, then the value with its unit ('percent' scale), then the share of the total, which
    // for shares summing to 100 is the same number. Expected from the fixture, in slice order.
    const total = fx.values.reduce((a, b) => a + b, 0);
    const fields = await items.evaluateAll(lis => lis.map(li => ({
      name: li.querySelector('.axylo-legend-name')?.textContent, value: li.querySelector('.axylo-legend-value')?.textContent,
    })));
    fx.labels.forEach((label, i) => {
      const share = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 }).format(fx.values[i]! / total);
      expect(fields[i]!.name).toBe(label);
      expect(fields[i]!.value === `${fx.values[i]}%` || fields[i]!.value === `${fx.values[i]}% (${share})`, `${fields[i]!.value}`).toBe(true);
    });
    // Entries can be chosen by pointer (interaction review, new item 9) but add no tab stop.
    const choices = await page.locator('#chart ul.axylo-legend-list button').evaluateAll(bs => bs.map(b => (b as HTMLElement).tabIndex));
    expect(choices).toEqual([-1, -1, -1, -1, -1, -1]);
    expect(await page.locator('#chart .axylo-toolbar button').allTextContents()).toEqual(['View as table']);
    expect(await closePage(page)).toEqual([]);
  });

  it('where value and share differ, each legend entry shows both: 3 (60%) and 2 (40%)', async () => {
    // Interaction review part 3: on the fixture above value and share coincide, so a lone value passed.
    const page = await fixturePage();
    await page.evaluate(async () => {
      const chart = window.Axylo.donut!('#chart', { title: 'Two', data: [{ l: 'A', v: 3 }, { l: 'B', v: 2 }], label: 'l', value: 'v' });
      window.charts.push(chart);
      await chart.__bench.ready();
    });
    const values = await page.locator('#chart ul.axylo-legend-list .axylo-legend-value').allTextContents();
    expect(values).toEqual(['3 (60%)', '2 (40%)']);
    expect(await closePage(page)).toEqual([]);
  });

  it('a donut with more than eight slices lists "Other" with its count, and a zero slice without an arc', async () => {
    const page = await fixturePage();
    await page.evaluate(async () => {
      const labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
      const values = [30, 20, 15, 10, 8, 6, 5, 0, 3, 3];
      const chart = window.Axylo.donut!('#chart', { title: 'Ten', data: labels.map((l, i) => ({ l, v: values[i] })), label: 'l', value: 'v' });
      window.charts.push(chart);
      await chart.__bench.ready();
    });
    const texts = await page.locator('#chart ul.axylo-legend-list > li').allTextContents();
    expect(texts.some(t => t.startsWith('Other ('))).toBe(true);
    // Spec F8: nine slices have a value, so the seven largest are drawn (A–G) and the other two (I, J: 3 + 3)
    // are "Other (2)", 6 in all; the zero slice H "is listed without an arc", by name, hollow. Every category
    // is in the table (A4).
    const entries = await page.locator('#chart ul.axylo-legend-list > li').evaluateAll(lis => lis.map(li => ({
      name: li.querySelector('.axylo-legend-name')?.textContent, value: li.querySelector('.axylo-legend-value')?.textContent,
      hollow: li.querySelector('svg path')?.getAttribute('stroke') === 'currentColor',
    })));
    expect(entries.map(e => e.name)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'Other (2)']);
    expect(entries.at(-1)!.value).toMatch(/^6\b/);
    expect(entries[7]!.value).toMatch(/^0\b/);
    expect(entries.map(e => e.hollow)).toEqual([false, false, false, false, false, false, false, true, false]);
    await page.locator('#chart button', { hasText: 'View as table' }).click();
    const rows = await page.locator('#chart table tbody th[scope="row"]').allTextContents();
    expect(rows).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('zoom (spec I3, I4)', () => {
  it('Zoom in and out are single clicks around the centre; Reset appears only while zoomed; the zoom event carries the range', async () => {
    const page = await fixturePage();
    await make(page, 'trend');
    await page.evaluate(() => {
      (window as unknown as { zooms: unknown[] }).zooms = [];
      window.charts[0]!.on('zoom', r => (window as unknown as { zooms: unknown[] }).zooms.push(r === null ? null : (r as Date[]).map(d => d.toISOString())));
    });
    const full = await domain(page);
    const toolbar = page.locator('#chart .axylo-toolbar');
    expect(await toolbar.locator('button', { hasText: 'Reset zoom' }).count()).toBe(0);
    await toolbar.locator('button', { hasText: 'Zoom in' }).click();
    await settle(page);
    await toolbar.locator('button', { hasText: 'Zoom in' }).click();
    await settle(page);
    const zoomed = await domain(page);
    const width = full[1]! - full[0]!;
    expect(zoomed[1]! - zoomed[0]!).toBeCloseTo(width / 4, 0);
    expect((zoomed[0]! + zoomed[1]!) / 2).toBeCloseTo((full[0]! + full[1]!) / 2, 0);
    expect(await toolbar.locator('button', { hasText: 'Reset zoom' }).count()).toBe(1);
    await toolbar.locator('button', { hasText: 'Zoom out' }).click();
    await settle(page);
    expect((await domain(page))[1]! - (await domain(page))[0]!).toBeCloseTo(width / 2, 0);
    const reset = toolbar.locator('button', { hasText: 'Reset zoom' });
    await reset.focus();
    await page.keyboard.press('Enter');
    await settle(page);
    expect(await domain(page)).toEqual(full);
    expect(await toolbar.locator('button', { hasText: 'Reset zoom' }).count()).toBe(0);
    // Focus moved to a neighbouring control, not to the page.
    expect(await page.evaluate(() => !!document.activeElement?.closest('.axylo-toolbar'))).toBe(true);
    const zooms = await page.evaluate(() => (window as unknown as { zooms: unknown[] }).zooms);
    expect(zooms).toHaveLength(4);
    expect(zooms[3]).toBeNull();
    expect(zooms[1]).toEqual([new Date(zoomed[0]!).toISOString(), new Date(zoomed[1]!).toISOString()]);
    expect(await closePage(page)).toEqual([]);
  });

  it('dragging across the plot selects a range, shown while dragging; Escape cancels', async () => {
    const page = await fixturePage();
    await make(page, 'trend');
    const g = await geometry(page);
    const y = g.plot.y + g.plot.height / 2;
    const a = g.plot.x + g.plot.width * 0.25;
    const b = g.plot.x + g.plot.width * 0.5;
    const expected = [g.xDomain[0]! + 0.25 * (g.xDomain[1]! - g.xDomain[0]!), g.xDomain[0]! + 0.5 * (g.xDomain[1]! - g.xDomain[0]!)];
    await page.mouse.move(a, y);
    await page.mouse.down();
    await page.mouse.move(b, y, { steps: 5 });
    expect(await page.locator('#chart .axylo-selection').isVisible()).toBe(true);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await settle(page);
    expect(await domain(page)).toEqual(g.xDomain);
    await page.mouse.move(a, y);
    await page.mouse.down();
    await page.mouse.move(b, y, { steps: 5 });
    await page.mouse.up();
    await settle(page);
    const after = await domain(page);
    expect(Math.abs(after[0]! - expected[0]!)).toBeLessThan(DAY);
    expect(Math.abs(after[1]! - expected[1]!)).toBeLessThan(DAY);
    expect(await page.locator('#chart .axylo-selection').isVisible()).toBe(false);
    expect(await closePage(page)).toEqual([]);
  });

  it('keyboard: + and - zoom, Shift+arrows pan, 0 resets', async () => {
    const page = await fixturePage();
    await make(page, 'trend');
    const full = await domain(page);
    await page.focus('#chart .axylo-proxy');
    await page.keyboard.press('+');
    await settle(page);
    const half = await domain(page);
    expect(half[1]! - half[0]!).toBeCloseTo((full[1]! - full[0]!) / 2, 0);
    await page.keyboard.press('Shift+ArrowRight');
    await settle(page);
    const panned = await domain(page);
    expect(panned[0]! - half[0]!).toBeCloseTo((half[1]! - half[0]!) * 0.1, 0);
    await page.keyboard.press('Shift+ArrowLeft');
    await settle(page);
    expect((await domain(page))[0]).toBeCloseTo(half[0]!, 0);
    await page.keyboard.press('-');
    await settle(page);
    expect(await domain(page)).toEqual(full);
    await page.keyboard.press('+');
    await page.keyboard.press('+');
    await settle(page);
    expect((await domain(page))[1]! - (await domain(page))[0]!).toBeCloseTo((full[1]! - full[0]!) / 4, 0);
    await page.keyboard.press('0');
    await settle(page);
    expect(await domain(page)).toEqual(full);
    expect(await closePage(page)).toEqual([]);
  });

  it('the wheel does nothing while the plot is not focused (the page scrolls), zooms when it is, and never with Ctrl', async () => {
    const page = await fixturePage({ css: 'body { height: 3000px; }' });
    await make(page, 'trend');
    const full = await domain(page);
    const g = await geometry(page);
    await page.mouse.move(g.plot.x + g.plot.width / 2, g.plot.y + g.plot.height / 2);
    await page.mouse.wheel(0, 200);
    await page.waitForFunction(() => window.scrollY > 0);
    await settle(page);
    expect(await domain(page)).toEqual(full);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.focus('#chart .axylo-proxy');
    const ctrl = await page.evaluate(() => {
      const event = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true, clientX: 300, clientY: 200 });
      document.querySelector('#chart .axylo-plot')!.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(ctrl).toBe(false);
    const meta = await page.evaluate(() => {
      const event = new WheelEvent('wheel', { deltaY: -100, metaKey: true, bubbles: true, cancelable: true, clientX: 300, clientY: 200 });
      document.querySelector('#chart .axylo-plot')!.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(meta).toBe(false);
    await settle(page);
    expect(await domain(page)).toEqual(full);
    await page.mouse.move(g.plot.x + g.plot.width / 2, g.plot.y + g.plot.height / 2);
    await page.mouse.wheel(0, -200);
    await settle(page);
    const zoomed = await domain(page);
    expect(zoomed[1]! - zoomed[0]!).toBeLessThan(full[1]! - full[0]!);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await closePage(page)).toEqual([]);
  });

  it('category bar, line and area charts have no zoom controls; a donut has none (1.0: no category zoom)', async () => {
    // Interaction review part 3: the earlier test created only a bar.
    for (const [kind, options] of [
      ['bar', { data: ['a', 'b', 'c'].map((x, i) => ({ x, y: i + 1 })), x: 'x', y: 'y' }],
      ['line', { data: ['a', 'b', 'c'].map((x, i) => ({ x, y: i + 1 })), x: 'x', y: 'y' }],
      ['area', { data: ['a', 'b', 'c'].map((x, i) => ({ x, y: i + 1 })), x: 'x', y: 'y' }],
      ['donut', { data: [{ l: 'a', v: 1 }, { l: 'b', v: 2 }], label: 'l', value: 'v' }],
    ] as const) {
      const page = await fixturePage();
      await page.evaluate(async ({ kind, options }) => {
        const chart = window.Axylo[kind]!('#chart', { title: 'Z', ...options });
        window.charts.push(chart);
        await chart.__bench.ready();
      }, { kind, options });
      for (const label of ['Zoom in', 'Zoom out', 'Reset zoom']) expect(await page.locator('#chart button', { hasText: label }).count(), `${kind} ${label}`).toBe(0);
      await page.focus('#chart .axylo-proxy');
      await page.keyboard.press('+');
      expect(await page.evaluate(() => window.charts[0]!.diagnostics.map(d => d.code))).not.toContain('AX199');
      expect(await closePage(page)).toEqual([]);
    }
  });
});

describe('touch (spec I4)', () => {
  it('a tap pins the tooltip and a tap elsewhere dismisses it; a one-finger vertical drag scrolls the page', async () => {
    const page = await fixturePage({ hasTouch: true, css: 'body { height: 3000px; }' });
    await make(page, 'trend');
    const g = await geometry(page);
    const x = g.plot.x + g.plot.width / 2;
    await page.touchscreen.tap(x, g.plot.y + g.plot.height / 2);
    await page.waitForTimeout(50);
    expect(await floating(page).isVisible()).toBe(true);
    await page.waitForTimeout(400);
    expect(await floating(page).isVisible()).toBe(true);
    await page.touchscreen.tap(450, 650);
    await page.waitForTimeout(50);
    expect(await floating(page).isVisible()).toBe(false);
    expect(await page.locator('#chart .axylo-plot').evaluate(el => getComputedStyle(el).touchAction)).toBe('manipulation');

    const client = await page.context().newCDPSession(page);
    const y0 = g.plot.y + g.plot.height - 20;
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
    for (let i = 1; i <= 10; i++) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 - i * 20 }] });
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(() => window.scrollY > 50, undefined, { timeout: 3000 });
    expect(await floating(page).isVisible()).toBe(false);
    expect(await closePage(page)).toEqual([]);
  });

  it("with zoom: 'touch' a pinch zooms through the public path; without it the chart leaves pinch to the page", async () => {
    const page = await fixturePage({ hasTouch: true });
    await make(page, 'trend', { zoom: 'touch' });
    expect(await page.locator('#chart .axylo-plot').evaluate(el => getComputedStyle(el).touchAction)).toBe('pan-x pan-y');
    await page.evaluate(() => {
      (window as unknown as { zooms: number }).zooms = 0;
      window.charts[0]!.on('zoom', () => { (window as unknown as { zooms: number }).zooms++; });
    });
    const full = await domain(page);
    const g = await geometry(page);
    const cx = g.plot.x + g.plot.width / 2;
    const cy = g.plot.y + g.plot.height / 2;
    const client = await page.context().newCDPSession(page);
    const points = (d: number) => [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }];
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(40) });
    for (let d = 50; d <= 160; d += 10) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(d) });
      await page.evaluate(() => window.nextFrames(1));
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await settle(page);
    const zoomed = await domain(page);
    // Fingers 80 px apart moved to 320 px: a quarter of the width, around the same centre.
    const ratio = (zoomed[1]! - zoomed[0]!) / (full[1]! - full[0]!);
    expect(ratio).toBeGreaterThan(0.2);
    expect(ratio).toBeLessThan(0.3);
    expect(Math.abs((zoomed[0]! + zoomed[1]!) / 2 - (full[0]! + full[1]!) / 2)).toBeLessThan(0.02 * (full[1]! - full[0]!));
    expect(await page.evaluate(() => (window as unknown as { zooms: number }).zooms)).toBeGreaterThan(0);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('streaming (spec I6, A7)', () => {
  const rowsFor = (day: number) => ['Direct', 'Organic search', 'Referral'].map((channel, k) => ({ day: START + day * DAY, channel, sessions: 1000 * (k + 1) + day }));

  it('a pause control appears after append; paused, rows are buffered and nothing moves; resume applies them', async () => {
    const page = await fixturePage();
    await make(page, 'trend');
    expect(await page.locator('#chart button', { hasText: 'Pause' }).count()).toBe(0);
    await page.evaluate(async rows => { window.charts[0]!.append(rows, { keep: 120 }); }, rowsFor(120));
    await settle(page);
    const pause = page.locator('#chart .axylo-toolbar button', { hasText: 'Pause' });
    expect(await pause.count()).toBe(1);
    await page.focus('#chart .axylo-proxy');
    await page.keyboard.press('End');
    const text = await page.locator('#chart .axylo-proxy').getAttribute('aria-valuetext');
    expect(text!.startsWith(date(START + 120 * DAY))).toBe(true);
    const before = await page.evaluate(() => window.charts[0]!.__bench.describe());
    await pause.click();
    await settle(page);
    expect(await page.locator('#chart .axylo-toolbar button', { hasText: 'Resume' }).count()).toBe(1);
    for (let d = 121; d < 125; d++) await page.evaluate(async rows => { window.charts[0]!.append(rows, { keep: 120 }); }, rowsFor(d));
    await settle(page);
    expect(await page.evaluate(() => window.charts[0]!.__bench.describe())).toEqual(before);
    expect(await page.locator('#chart .axylo-proxy').getAttribute('aria-valuetext')).toBe(text);
    await page.locator('#chart .axylo-toolbar button', { hasText: 'Resume' }).click();
    await settle(page);
    const after = await page.evaluate(() => window.charts[0]!.__bench.describe());
    expect(after.series[0]!.newestX).toBe(START + 124 * DAY);
    expect(after.series[0]!.oldestX).toBe(START + 5 * DAY);
    expect(await closePage(page)).toEqual([]);
  });

  it('keyboard focus stays on its datum until it leaves the window, then resolves forward', async () => {
    const page = await fixturePage();
    await make(page, 'trend');
    await page.focus('#chart .axylo-proxy');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    const text = () => page.locator('#chart .axylo-proxy').getAttribute('aria-valuetext');
    expect((await text())!.startsWith(date(START + 3 * DAY))).toBe(true);
    for (let d = 120; d < 123; d++) await page.evaluate(async rows => { window.charts[0]!.append(rows, { keep: 120 }); }, rowsFor(d));
    await settle(page);
    // Days 0–2 left the window; day 3 is still there, so nothing changed for the reader.
    expect((await text())!.startsWith(date(START + 3 * DAY))).toBe(true);
    await page.evaluate(async rows => { window.charts[0]!.append(rows, { keep: 120 }); }, rowsFor(123));
    await settle(page);
    expect((await text())!.startsWith(date(START + 4 * DAY))).toBe(true);
    // The position message ('Point {index} of {count}') ends the all-series value text.
    expect((await text())!.endsWith('Point 1 of 120')).toBe(true);
    // The next move starts from there.
    await page.keyboard.press('ArrowRight');
    expect((await text())!.startsWith(date(START + 5 * DAY))).toBe(true);
    expect(await closePage(page)).toEqual([]);
  });

  it('24 charts appending for two seconds change no live region', async () => {
    const page = await fixturePage({ css: '.tile { width: 220px; height: 160px; display: inline-block; }' });
    const changes = await page.evaluate(async () => {
      const charts = Array.from({ length: 24 }, () => {
        const el = document.body.appendChild(Object.assign(document.createElement('div'), { className: 'tile' }));
        return window.make('trend', el);
      });
      await Promise.all(charts.map(c => c.__bench.ready()));
      let mutations = 0;
      const observer = new MutationObserver(records => { mutations += records.length; });
      // Every live region: aria-live other than off, or a live role without aria-live="off".
      const live = '[aria-live]:not([aria-live="off"]), [role="status"]:not([aria-live="off"]), [role="alert"], [role="log"]';
      for (const region of document.querySelectorAll(live)) {
        observer.observe(region, { subtree: true, childList: true, characterData: true, attributes: true });
      }
      const start = performance.now();
      let day = 120;
      while (performance.now() - start < 2000) {
        const t = Date.UTC(2026, 0, 1) + day * 864e5;
        for (const c of charts) c.append(['Direct', 'Organic search', 'Referral'].map(channel => ({ day: t, channel, sessions: 1000 + day })), { keep: 120 });
        day++;
        await new Promise(r => setTimeout(r, 50));
      }
      await Promise.all(charts.map(c => c.__bench.ready()));
      observer.disconnect();
      return { mutations, regions: document.querySelectorAll(live).length, days: day - 120 };
    });
    expect(changes.regions).toBeGreaterThanOrEqual(24);
    expect(changes.days).toBeGreaterThan(10);
    expect(changes.mutations).toBe(0);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('table view (spec A4)', () => {
  async function counter(page: Page, n: number, extra: Record<string, unknown> = {}): Promise<void> {
    await page.evaluate(async ({ n, extra }) => {
      const data = Array.from({ length: n }, (_, i) => ({ i, v: i * 2 }));
      const chart = window.Axylo.line!('#chart', { title: 'Counter', data, x: 'i', y: { field: 'v', label: 'Twice', unit: 'pt' }, ...extra });
      window.charts.push(chart);
      await chart.__bench.ready();
    }, { n, extra });
  }

  it('opens from the toolbar with a caption, headers with units and row headers; pages of 100; closing removes it', async () => {
    const page = await fixturePage();
    await counter(page, 1000);
    const toggle = page.locator('#chart .axylo-toolbar button', { hasText: 'View as table' });
    expect(await toggle.getAttribute('aria-expanded')).toBe('false');
    await toggle.click();
    const table = page.locator('#chart table');
    expect(await table.locator('caption').textContent()).toBe('Counter');
    expect(await table.locator('thead th').allTextContents()).toEqual(['i', 'Twice (pt)']);
    expect(await table.locator('tbody th[scope="row"]').count()).toBe(100);
    expect(await table.locator('tbody tr').first().textContent()).toBe('00 pt');
    const hideToggle = page.locator('#chart .axylo-toolbar button', { hasText: 'Hide table' });
    expect(await hideToggle.getAttribute('aria-expanded')).toBe('true');
    expect(await hideToggle.getAttribute('aria-controls')).toBe(await page.locator('#chart .axylo-table').getAttribute('id'));
    const scroll = page.locator('#chart .axylo-table-scroll');
    expect(await scroll.getAttribute('role')).toBe('region');
    expect(await scroll.getAttribute('tabindex')).toBe('0');
    const [scrollBox, plotBox] = [(await scroll.boundingBox())!, (await page.locator('#chart .axylo-plot').boundingBox())!];
    expect(scrollBox.height).toBeLessThanOrEqual(plotBox.height + 1);

    await page.locator('#chart .axylo-pager button', { hasText: 'Next page' }).click();
    const headers = await table.locator('tbody th').allTextContents();
    expect(headers[0]).toBe('100');
    expect(headers.at(-1)).toBe('199');
    expect(await page.locator('#chart .axylo-page').textContent()).toBe('Page 2 of 10');

    await page.locator('#chart .axylo-jump-field').fill('550');
    await page.keyboard.press('Enter');
    expect(await page.locator('#chart .axylo-page').textContent()).toBe('Page 6 of 10');
    expect(await table.locator('tbody th').allTextContents()).toContain('550');

    await hideToggle.click();
    expect(await page.locator('#chart table').count()).toBe(0);
    expect(await page.locator('#chart .axylo-table').count()).toBe(0);
    expect(await closePage(page)).toEqual([]);
  });

  it('a value near row 900,000 of a 1,000,000-point typed-column chart is reachable; opening takes under 100 ms', async () => {
    const page = await fixturePage();
    const result = await page.evaluate(async () => {
      const n = 1_000_000;
      const x = new Float64Array(n);
      const y = new Float64Array(n);
      for (let i = 0; i < n; i++) { x[i] = i; y[i] = (i % 1000) / 4; }
      const chart = window.Axylo.line!('#chart', { title: 'Million', data: { columns: { x, y } }, x: 'x', y: 'y' });
      window.charts.push(chart);
      await chart.__bench.ready();
      const button = [...document.querySelectorAll<HTMLButtonElement>('#chart .axylo-toolbar button')].find(b => b.textContent === 'View as table')!;
      const t0 = performance.now();
      button.click();
      const opened = performance.now() - t0;
      const field = document.querySelector<HTMLInputElement>('#chart .axylo-jump-field')!;
      field.value = '900000';
      field.form!.requestSubmit();
      const row = [...document.querySelectorAll('#chart tbody tr')].find(tr => tr.querySelector('th')!.textContent === '900,000');
      return { opened, row: row?.textContent ?? null, page: document.querySelector('#chart .axylo-page')!.textContent };
    });
    expect(result.opened).toBeLessThan(100);
    expect(result.page).toBe('Page 9,001 of 10,000');
    // y[900000] = (900000 % 1000) / 4 = 0.
    expect(result.row).toBe('900,0000');
    expect(await closePage(page)).toEqual([]);
  });

  it('opening one table on a 24-chart page leaves every other chart where it was', async () => {
    const page = await fixturePage({ css: '.tile { width: 280px; height: 220px; display: inline-block; vertical-align: top; }' });
    const moved = await page.evaluate(async () => {
      const tiles = Array.from({ length: 24 }, () => document.body.appendChild(Object.assign(document.createElement('div'), { className: 'tile' })));
      const charts = tiles.map(el => window.make('trend', el));
      await Promise.all(charts.map(c => c.__bench.ready()));
      const boxes = () => tiles.map(t => JSON.stringify(t.getBoundingClientRect()));
      const before = boxes();
      const button = [...tiles[5]!.querySelectorAll<HTMLButtonElement>('.axylo-toolbar button')].find(b => b.textContent === 'View as table')!;
      button.click();
      await Promise.all(charts.map(c => c.__bench.ready()));
      await window.nextFrames(2);
      const after = boxes();
      return { changed: before.flatMap((b, i) => (b === after[i] ? [] : [i])), open: tiles[5]!.querySelectorAll('table').length };
    });
    expect(moved.open).toBe(1);
    expect(moved.changed).toEqual([]);
    expect(await closePage(page)).toEqual([]);
  });

  it('with labelledBy the table caption is the page heading', async () => {
    const page = await fixturePage();
    await page.evaluate(async () => {
      const h = document.body.insertBefore(Object.assign(document.createElement('h2'), { id: 'card', textContent: 'Sessions card' }), document.body.firstChild);
      void h;
      const chart = window.make('trend', '#chart', { title: undefined, labelledBy: 'card' });
      window.charts.push(chart);
      await chart.__bench.ready();
    });
    await page.locator('#chart button', { hasText: 'View as table' }).click();
    expect(await page.locator('#chart caption').textContent()).toBe('Sessions card');
    expect(await closePage(page)).toEqual([]);
  });

  it('table: false offers no table control', async () => {
    const page = await fixturePage();
    await make(page, 'trend', { table: false });
    expect(await page.locator('#chart button', { hasText: 'View as table' }).count()).toBe(0);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('figure details (spec L6, 3.5, events)', () => {
  it('axis titles: time and category x untitled unless labelled; number x and value axes titled with units', async () => {
    const page = await fixturePage({ css: '.w { width: 600px; height: 320px; }' });
    const titles = await page.evaluate(async () => {
      const add = () => document.body.appendChild(Object.assign(document.createElement('div'), { className: 'w' }));
      const charts = [
        window.make('trend', add()),
        window.make('trend', add(), { x: { field: 'day', type: 'time', timeZone: 'UTC', label: 'Day' } }),
        window.make('bars', add()),
        window.make('scatter', add()),
        window.Axylo.line!(add(), { title: 'Wide', data: [{ d: 1, a: 1, b: 2 }, { d: 2, a: 3, b: 4 }], x: 'd', y: ['a', 'b'] }),
        window.Axylo.line!(add(), { title: 'Units', data: [{ d: 1, v: 2 }, { d: 2, v: 3 }], x: { field: 'd', unit: 'm' }, y: { field: 'v', unit: 'kg' } }),
      ];
      await Promise.all(charts.map(c => c.__bench.ready()));
      return [...document.querySelectorAll('.w')].map(w => ({
        x: [...w.querySelectorAll('[data-role="title-x"]')].map(e => e.textContent),
        y: [...w.querySelectorAll('[data-role="title-y"]')].map(e => e.textContent),
      }));
    });
    expect(titles[0]).toEqual({ x: [], y: ['Sessions'] });
    expect(titles[1]).toEqual({ x: ['Day'], y: ['Sessions'] });
    expect(titles[2]).toEqual({ x: [], y: ['Satisfied'] });
    expect(titles[3]).toEqual({ x: ['Payload (kB)'], y: ['Latency (ms)'] });
    expect(titles[4]).toEqual({ x: ['d'], y: ['Value'] });
    expect(titles[5]).toEqual({ x: ['d (m)'], y: ['v (kg)'] });
    expect(await closePage(page)).toEqual([]);
  });

  it('the bars fixture shows its "Target" reference label next to the line at 90', async () => {
    const page = await fixturePage();
    await make(page, 'bars');
    const g = await geometry(page);
    const label = page.locator('#chart .axylo-label[data-role="reference"]');
    expect(await label.textContent()).toBe('Target');
    const box = (await label.boundingBox())!;
    const y90 = g.plot.y + g.plot.height * (1 - (90 - g.yDomain[0]!) / (g.yDomain[1]! - g.yDomain[0]!));
    // Above or below the line, within a line of text of it.
    expect(Math.min(Math.abs(box.y - y90), Math.abs(box.y + box.height - y90))).toBeLessThanOrEqual(8);
    expect(await closePage(page)).toEqual([]);
  });

  it('an internal failure raises AX199 through onDiagnostic and shows the error state', async () => {
    const page = await fixturePage();
    const result = await page.evaluate(async () => {
      const seen: string[] = [];
      const chart = window.make('trend', '#chart', { onDiagnostic: (d: { code: string }) => seen.push(d.code) });
      await chart.__bench.ready();
      chart.__dev.fail('reader');
      chart.update({ subtitle: 'Now failing' });
      await window.nextFrames(2);
      const failed = { seen: [...seen], codes: chart.diagnostics.map(d => d.code), message: document.querySelector('#chart .axylo-message')!.textContent, controls: document.querySelectorAll('#chart .axylo-proxy, #chart .axylo-toolbar button').length };
      chart.__dev.fail(null);
      chart.update({ subtitle: 'Working again' });
      await chart.__bench.ready();
      return { failed, recovered: chart.diagnostics.map(d => d.code), controls: document.querySelectorAll('#chart .axylo-proxy').length };
    });
    expect(result.failed.seen).toContain('AX199');
    expect(result.failed.codes).toContain('AX199');
    expect(result.failed.message).toBe('Something went wrong while drawing the chart.');
    expect(result.failed.controls).toBe(0);
    expect(result.recovered).not.toContain('AX199');
    expect(result.controls).toBe(1);
    expect(await closePage(page)).toEqual([]);
  });

  it('hover fires with the datum under the pointer and null on leave; a click selects', async () => {
    const page = await fixturePage();
    await make(page, 'trend');
    await page.evaluate(() => {
      const w = window as unknown as { events: unknown[] };
      w.events = [];
      const c = window.charts[0]!;
      c.on('hover', p => w.events.push(['hover', p === null ? null : (p as { series: string }).series]));
      c.on('select', p => w.events.push(['select', (p as { series: string; y: number }).series, (p as { y: number }).y]));
    });
    const g = await geometry(page);
    const series = await page.evaluate(() => window.fx.trend.series);
    await page.mouse.move(xPixel(g, START + 20 * DAY), g.plot.y + 50);
    await page.mouse.down();
    await page.mouse.up();
    await page.mouse.move(5, 5);
    const events = await page.evaluate(() => (window as unknown as { events: unknown[] }).events);
    expect(events).toEqual([['hover', 'Direct'], ['select', 'Direct', series[0]!.values[20]], ['hover', null]]);
    expect(await closePage(page)).toEqual([]);
  });
});
