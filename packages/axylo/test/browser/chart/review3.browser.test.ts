/**
 * The third reviews (reviews/2026-11-18/impl/wp/core3.controller.review.md and core3.interaction.review.md),
 * as seen from the page. Node sequences of the controller review are in test/core/snapshot.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { start, stop } from '../harness';
import { chartPage, closePage } from './util';

beforeAll(start);
afterAll(stop);

const valueText = (page: Page) => page.locator('#chart .axylo-proxy').getAttribute('aria-valuetext');
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

describe('interaction blocker 1: an assistive value change always ends', () => {
  it('scatter A0 B1 A2 B3 A4, narrowed to B, set to 2: lands on A2 at once', async () => {
    const page = await chartPage();
    const data = [0, 1, 2, 3, 4].map(x => ({ x, s: x % 2 ? 'B' : 'A', y: x }));
    await create(page, 'scatter', { title: 'S', data, x: 'x', y: 'y', series: 's' });
    await page.focus('#chart .axylo-proxy');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    expect(await valueText(page)).toMatch(/^B,/);
    const done = await Promise.race([
      page.evaluate(() => {
        const proxy = document.querySelector('#chart .axylo-proxy') as HTMLInputElement;
        proxy.value = '2';
        proxy.dispatchEvent(new Event('input', { bubbles: true }));
        return 'ended';
      }),
      new Promise<string>(r => setTimeout(() => r('hung'), 5000)),
    ]);
    expect(done).toBe('ended');
    expect(await valueText(page)).toMatch(/Point 3 of 5/);
    expect(await valueText(page)).toMatch(/^A,/);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('interaction blocker 2: the open table covers the plot, never its controls', () => {
  it("with legend: 'right' the Hide table button stays visible and hittable, and focus moves into the table", async () => {
    const page = await chartPage();
    const data = [0, 1, 2].flatMap(x => ['a', 'b'].map(s => ({ x, s, y: x })));
    await create(page, 'line', { title: 'R', data, x: 'x', y: 'y', series: 's', legend: 'right' });
    await button(page, 'View as table').focus();
    await page.keyboard.press('Enter');
    await settle(page);
    const hide = button(page, 'Hide table');
    const box = (await hide.boundingBox())!;
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('button')?.textContent, [box.x + box.width / 2, box.y + box.height / 2]);
    expect(hit).toBe('Hide table');
    expect(await page.evaluate(() => document.activeElement?.classList.contains('axylo-table-scroll'))).toBe(true);
    // The table sits over the plot's column, not over the side controls.
    const [table, side] = await Promise.all([page.locator('#chart .axylo-table').boundingBox(), page.locator('#chart .axylo-controls-side').boundingBox()]);
    expect(table!.x + table!.width).toBeLessThanOrEqual(side!.x + 0.5);
    await hide.click();
    await settle(page);
    expect(await page.locator('#chart .axylo-table').count()).toBe(0);
    expect(await closePage(page)).toEqual([]);
  });

  it('shrinking an open table\'s card keeps the pager and toolbar inside it', async () => {
    const page = await chartPage({ css: '#chart { height: 360px; overflow: hidden; }' });
    await create(page, 'line', { title: 'T', data: Array.from({ length: 250 }, (_, i) => ({ x: i, y: i })), x: 'x', y: 'y' });
    await button(page, 'View as table').click();
    await settle(page);
    await page.evaluate(() => { document.getElementById('chart')!.style.height = '240px'; });
    await settle(page);
    const card = (await page.locator('#chart').boundingBox())!;
    for (const selector of ['#chart .axylo-pager', '#chart .axylo-toolbar']) {
      const box = (await page.locator(selector).boundingBox())!;
      expect(box.y + box.height, selector).toBeLessThanOrEqual(card.y + card.height + 0.5);
    }
    expect(await closePage(page)).toEqual([]);
  });
});

describe('controller finding 10: two charts on one target keep their own colors', () => {
  it('pins of red and blue on the first series each paint their own chart; destroying one leaves the other', async () => {
    const page = await chartPage();
    const result = await page.evaluate(async () => {
      const el = document.getElementById('chart')!;
      const data = [1, 2].flatMap(x => [{ x, s: 'a', y: x }, { x, s: 'b', y: -x }]);
      const red = window.Axylo.line!(el, { title: 'Red', data, x: 'x', y: 'y', series: 's', colors: { a: 'rgb(255, 0, 0)' }, __renderer: 'svg' });
      const blue = window.Axylo.line!(el, { title: 'Blue', data, x: 'x', y: 'y', series: 's', colors: { a: 'rgb(0, 0, 255)' }, __renderer: 'svg' });
      await Promise.all([red.__bench.ready(), blue.__bench.ready()]);
      const strokes = () => [...el.querySelectorAll('figure')].map(f => [...f.querySelectorAll('svg.axylo-svg path')].map(p => getComputedStyle(p).stroke).find(c => c === 'rgb(255, 0, 0)' || c === 'rgb(0, 0, 255)') ?? null);
      const both = strokes();
      red.destroy();
      await window.nextFrames(2);
      return { both, after: strokes(), scheme: el.getAttribute('data-axylo-scheme') };
    });
    expect(result.both).toEqual(['rgb(255, 0, 0)', 'rgb(0, 0, 255)']);
    expect(result.after).toEqual(['rgb(0, 0, 255)']);
    expect(result.scheme).toBeNull();
    expect(await closePage(page)).toEqual([]);
  });
});

