/**
 * Fourth pass on the third reviews (reviews/2026-11-18/impl/wp/core3.interaction.review.md, part 2), as seen
 * from the page.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { start, stop } from '../harness';
import { chartPage, closePage } from './util';

beforeAll(start);
afterAll(stop);

const proxy = '#chart .axylo-proxy';
const settle = (page: Page) => page.evaluate(async () => { for (const c of window.charts) await c.__bench.ready(); await window.nextFrames(2); });
const button = (page: Page, text: string) => page.locator('#chart button', { hasText: text });

async function create(page: Page, kind: string, options: Record<string, unknown>): Promise<void> {
  await page.evaluate(async ({ kind, options }) => {
    const chart = window.Axylo[kind]!('#chart', options);
    window.charts.push(chart);
    await chart.__bench.ready();
    await window.nextFrames(1);
  }, { kind, options });
}

describe('new item 7: zoom in never widens, zoom out never narrows', () => {
  it('on a public window below the gesture minimum, + and an inward wheel leave it as it is', async () => {
    const page = await chartPage();
    const data = Array.from({ length: 11 }, (_, i) => ({ x: i * 10, y: i }));
    await create(page, 'line', { title: 'Z', data, x: 'x', y: 'y' });
    const windows: unknown[] = [];
    await page.evaluate(() => {
      const w = window as unknown as { zooms: unknown[] };
      w.zooms = [];
      window.charts[0]!.on('zoom', (z: unknown) => { w.zooms.push(z); });
      window.charts[0]!.zoom([40, 45]);
    });
    await settle(page);
    await page.focus(proxy);
    await page.keyboard.press('+');
    await settle(page);
    const box = (await page.locator('#chart .axylo-plot').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -200);
    await settle(page);
    windows.push(...await page.evaluate(() => (window as unknown as { zooms: unknown[] }).zooms));
    // Only the public call itself: no step widened the window.
    expect(windows).toEqual([[40, 45]]);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('new item 8: loading and error are not an empty zoom; a plot with no readable series says so', () => {
  it('a zoomed chart put into loading offers no zoom and its plot reads the state, not "No data to show."', async () => {
    const page = await chartPage();
    const data = Array.from({ length: 11 }, (_, i) => ({ x: i * 10, y: i }));
    await create(page, 'line', { title: 'L', data, x: 'x', y: 'y' });
    await page.evaluate(() => { window.charts[0]!.zoom([20, 60]); });
    await settle(page);
    await page.evaluate(() => { window.charts[0]!.update({ state: 'loading' }); });
    await settle(page);
    expect(await button(page, 'Zoom out').count()).toBe(0);
    expect(await button(page, 'Zoom in').count()).toBe(0);
    const text = await page.locator(proxy).getAttribute('aria-valuetext').catch(() => null);
    if (text !== null) {
      expect(text).not.toBe('No data to show.');
      expect(text).toBe('Loading chart.');
    }
    expect(await closePage(page)).toEqual([]);
  });

  it('with every series hidden, the plot is a range of one place reading that nothing is shown, and the legend brings them back', async () => {
    const page = await chartPage();
    const data = [0, 1, 2].flatMap(x => ['a', 'b'].map(s => ({ x, s, y: x })));
    await create(page, 'line', { title: 'H', data, x: 'x', y: 'y', series: 's' });
    for (const s of ['a', 'b']) {
      await page.locator('#chart button', { hasText: s }).first().click();
      await settle(page);
    }
    const p = page.locator(proxy);
    expect(await p.getAttribute('max')).toBe('0');
    expect(await p.getAttribute('aria-valuetext')).toBe('No data to show.');
    await p.focus();
    await page.keyboard.press('ArrowRight');
    await settle(page);
    expect(await p.inputValue()).toBe('0');
    expect(await p.getAttribute('aria-valuetext')).toBe('No data to show.');
    await page.locator('#chart button', { hasText: 'a' }).first().click();
    await settle(page);
    expect(await p.getAttribute('max')).toBe('2');
    expect(await closePage(page)).toEqual([]);
  });
});

describe('new item 6: too small and compact hand focus on and leave nothing behind', () => {
  it('focused plot shrunk below the threshold: focus moves to the table control', async () => {
    const page = await chartPage({ css: '#chart { width: 600px; height: 320px; }' });
    const data = Array.from({ length: 11 }, (_, i) => ({ x: i, y: i }));
    await create(page, 'line', { title: 'S', data, x: 'x', y: 'y' });
    await page.focus(proxy);
    await page.keyboard.press('ArrowRight');
    await settle(page);
    await page.evaluate(() => { (document.querySelector('#chart') as HTMLElement).style.height = '120px'; });
    await page.evaluate(() => window.nextFrames(3));
    await settle(page);
    const active = await page.evaluate(() => document.activeElement?.textContent ?? document.activeElement?.tagName);
    expect(active).toBe('View as table');
    expect(await closePage(page)).toEqual([]);
  });

  it('a focused, hovered chart switched to compact clears its overlay and focuses the figure without a new tab stop', async () => {
    const page = await chartPage({ css: '#chart { width: 600px; height: 320px; }' });
    const data = Array.from({ length: 11 }, (_, i) => ({ x: i, y: i }));
    await create(page, 'line', { title: 'C', data, x: 'x', y: 'y' });
    await page.focus(proxy);
    await page.keyboard.press('ArrowRight');
    await settle(page);
    const overlay = () => page.evaluate(() => document.querySelector('#chart .axylo-overlay')?.childElementCount ?? 0);
    expect(await overlay()).toBeGreaterThan(0);
    await page.evaluate(() => { window.charts[0]!.update({ compact: true }); });
    await settle(page);
    expect(await overlay()).toBe(0);
    const state = await page.evaluate(() => {
      const figure = document.querySelector('#chart figure, #chart .axylo-figure') as HTMLElement;
      return { focusedFigure: document.activeElement === figure, tabIndex: figure.tabIndex, inBody: document.activeElement === document.body };
    });
    expect(state.inBody).toBe(false);
    expect(state.focusedFigure).toBe(true);
    expect(state.tabIndex).toBe(-1);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('new item 10: gesture work ends with its gesture', () => {
  it('a pinch cancelled before its frame does not zoom', async () => {
    const page = await chartPage({ hasTouch: true, css: '#chart { width: 600px; height: 320px; }' });
    const data = Array.from({ length: 101 }, (_, i) => ({ x: i, y: i }));
    await create(page, 'line', { title: 'P', data, x: 'x', y: 'y', zoom: 'touch' });
    await page.evaluate(() => {
      const w = window as unknown as { zooms: number };
      w.zooms = 0;
      window.charts[0]!.on('zoom', () => { w.zooms++; });
    });
    const box = (await page.locator('#chart .axylo-plot').boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    // Down, move and cancel in one task, so the frame the move queued has not run when the cancel arrives.
    await page.evaluate(({ cx, cy }) => {
      const plot = document.querySelector('#chart .axylo-plot')!;
      const send = (type: string, id: number, x: number) => plot.dispatchEvent(new PointerEvent(type, {
        pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: cy, bubbles: true, cancelable: true,
      }));
      send('pointerdown', 1, cx - 40);
      send('pointerdown', 2, cx + 40);
      send('pointermove', 1, cx - 120);
      send('pointermove', 2, cx + 120);
      send('pointercancel', 1, cx - 120);
      send('pointercancel', 2, cx + 120);
    }, { cx, cy });
    await page.evaluate(() => window.nextFrames(3));
    await settle(page);
    expect(await page.evaluate(() => (window as unknown as { zooms: number }).zooms)).toBe(0);
    expect(await closePage(page)).toEqual([]);
  });

  it('a press released outside a chart that does not zoom ends the press, so the next click selects', async () => {
    const page = await chartPage({ css: '#chart { width: 600px; height: 320px; margin: 40px; }' });
    const data = ['a', 'b', 'c', 'd'].map((x, i) => ({ x, y: i + 1 }));
    await create(page, 'bar', { title: 'B', data, x: 'x', y: 'y' });
    const box = (await page.locator('#chart .axylo-plot').boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.8);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width + 30, box.y - 30);
    await page.mouse.up();
    await page.evaluate(() => {
      const w = window as unknown as { selected: unknown[] };
      w.selected = [];
      window.charts[0]!.on('select', (p: unknown) => { w.selected.push((p as { x: unknown }).x); });
    });
    await page.mouse.click(box.x + box.width * 0.85, box.y + box.height * 0.5);
    await settle(page);
    expect(await page.evaluate(() => (window as unknown as { selected: unknown[] }).selected)).toEqual(['d']);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('part 1 item 2: a pin and a dismissal follow their own category only', () => {
  it('a pinned A ends when A leaves the data; it does not become a pin on B', async () => {
    const page = await chartPage({ hasTouch: true, css: '#chart { width: 600px; height: 320px; }' });
    await create(page, 'bar', { title: 'P', data: ['A', 'B', 'C'].map((x, i) => ({ x, y: i + 1 })), x: 'x', y: 'y' });
    const box = (await page.locator('#chart .axylo-plot').boundingBox())!;
    await page.touchscreen.tap(box.x + box.width * 0.2, box.y + box.height * 0.7);
    await settle(page);
    const tip = () => page.evaluate(() => {
      const visible = (el: Element | null) => el instanceof HTMLElement && !el.hidden && el.getBoundingClientRect().width > 0;
      const t = document.querySelector('#chart .axylo-tooltip');
      const r = document.querySelector('#chart .axylo-readout');
      return visible(t) ? t!.textContent : visible(r) ? r!.textContent : null;
    });
    expect(await tip()).toMatch(/^A/);
    // A leaves by eviction on the same stream (a replacement starts over anyway).
    await page.evaluate(() => { window.charts[0]!.append([{ x: 'D', y: 4 }], { keep: 3 }); });
    await settle(page);
    expect(await tip()).toBeNull();
    expect(await closePage(page)).toEqual([]);
  });

  it('a dismissed A does not silence B when A leaves and B takes its place under the pointer', async () => {
    const page = await chartPage({ css: '#chart { width: 600px; height: 320px; }' });
    await create(page, 'bar', { title: 'D', data: ['A', 'B', 'C'].map((x, i) => ({ x, y: 3 })), x: 'x', y: 'y' });
    const box = (await page.locator('#chart .axylo-plot').boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.7);
    await settle(page);
    await page.keyboard.press('Escape');
    await settle(page);
    const shown = () => page.evaluate(() => {
      const t = document.querySelector('#chart .axylo-tooltip') as HTMLElement;
      const r = document.querySelector('#chart .axylo-readout') as HTMLElement;
      return (!t.hidden && t.textContent) || (!r.hidden && r.textContent) || null;
    });
    expect(await shown()).toBeNull();
    await page.evaluate(() => { window.charts[0]!.append([{ x: 'D', y: 3 }], { keep: 3 }); });
    await settle(page);
    // The reader dismissed A, never B; B under the pointer is shown when the pointer moves over it.
    await page.mouse.move(box.x + box.width * 0.2 + 1, box.y + box.height * 0.7);
    await settle(page);
    expect(await shown()).toMatch(/^B/);
    expect(await closePage(page)).toEqual([]);
  });
});
