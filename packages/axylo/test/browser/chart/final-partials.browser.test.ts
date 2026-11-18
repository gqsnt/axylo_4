/**
 * The earlier findings the final interaction review found only partly fixed (its disposition table,
 * reviews/2026-11-18/impl/wp/core-final.interaction.review.md): C2-8, C2-17, C2-18, C2-19 and C3-7. C2-7 is
 * in test/core/focus-reading.test.ts, C3-6 in final-hold, C3-9 in final-pin.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { requireEngineFeature, start, stop } from '../harness';
import { chartPage, closePage } from './util';
import { create, plotBox, settle } from './final-util';

beforeAll(start);
afterAll(stop);

const button = (page: Page, text: string) => page.locator('#chart button', { hasText: text });
const domain = (page: Page) => page.evaluate(() => window.charts[0]!.__bench.describe().xDomain);

describe('C2-8: a tap sets the datum Zoom in scales around', () => {
  it('tap on x = 80, then tap Zoom in: [40, 90], as a click would give', async () => {
    const page = await chartPage({ hasTouch: true });
    await create(page, 'line', { title: 'Tap', data: Array.from({ length: 101 }, (_, i) => ({ x: i, y: i % 7 })), x: 'x', y: 'y' });
    const p = await plotBox(page);
    await page.touchscreen.tap(p.x + 0.8 * p.width, p.y + p.height / 2);
    await settle(page);
    const zoom = (await button(page, 'Zoom in').boundingBox())!;
    await page.touchscreen.tap(zoom.x + zoom.width / 2, zoom.y + zoom.height / 2);
    await settle(page);
    expect(await domain(page)).toEqual([40, 90]);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('C2-17: focus is handed on from any chart-owned control that goes away', () => {
  for (const where of ['toolbar', 'jump field'] as const) {
    it(`a chart switched to compact with the ${where} focused: focus goes to the figure, not the page, and adds no tab stop`, async () => {
      const page = await chartPage();
      await create(page, 'line', { title: 'C', data: Array.from({ length: 20 }, (_, i) => ({ x: i, y: i })), x: 'x', y: 'y' });
      if (where === 'toolbar') await button(page, 'Zoom in').focus();
      else {
        await button(page, 'View as table').click();
        await page.locator('#chart .axylo-jump-field').focus();
      }
      await page.evaluate(() => window.charts[0]!.update({ compact: true }));
      await settle(page);
      const focused = await page.evaluate(() => ({ tag: document.activeElement?.tagName, figure: document.activeElement === document.querySelector('#chart figure'), tabIndex: (document.activeElement as HTMLElement | null)?.tabIndex }));
      expect(focused).toEqual({ tag: 'FIGURE', figure: true, tabIndex: -1 });
      expect(await closePage(page)).toEqual([]);
    });
  }
});

describe('C2-18: "Jump to" reads the column\'s own format and rejects what is not', () => {
  it('a number column with a unit: "12garbage" and "12 ms extra" are rejected; "120 ms" and "120" are accepted', async () => {
    const page = await chartPage();
    await create(page, 'line', { title: 'N', data: Array.from({ length: 300 }, (_, i) => ({ x: i, y: i })), x: { field: 'x', unit: 'ms' }, y: 'y' });
    await button(page, 'View as table').click();
    const field = page.locator('#chart .axylo-jump-field');
    for (const [text, ok] of [['12garbage', false], ['120 ms extra', false], ['120 ms', true], ['120', true], ['1,2,0', false]] as const) {
      await field.fill(text);
      await page.keyboard.press('Enter');
      expect(await field.getAttribute('aria-invalid'), text).toBe(ok ? null : 'true');
    }
    expect(await closePage(page)).toEqual([]);
  });

  it('a wall-time column: the displayed date with its time finds the row with that time, not the day\'s first', async () => {
    const page = await chartPage();
    // 150 rows an hour apart from 2026-05-30 00:00, wall time (no zone): 100 rows a page.
    const pad = (n: number) => String(n).padStart(2, '0');
    const rows = Array.from({ length: 150 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 4, 30, i));
      return { t: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:00`, y: i };
    });
    await create(page, 'line', { title: 'W', data: rows, x: { field: 't', type: 'wall' }, y: 'y' });
    await button(page, 'View as table').click();
    // Row 120 (page 2) and row 50 (page 1) fall on the same day, 2026-06-03 00:00 is row 96; 06-04 00:00 row 120.
    const shown = await page.locator('#chart .axylo-table tbody tr th').first().textContent();
    expect(shown).toBeTruthy();
    await page.locator('#chart .axylo-pager button', { hasText: 'Next page' }).click();
    const row = (await page.locator('#chart .axylo-table tbody tr th').nth(10).textContent())!;
    await page.locator('#chart .axylo-pager button', { hasText: 'Previous page' }).click();
    const field = page.locator('#chart .axylo-jump-field');
    await field.fill(row);
    await page.keyboard.press('Enter');
    expect(await field.getAttribute('aria-invalid'), row).toBeNull();
    expect(await page.locator('#chart .axylo-page').textContent()).toBe('Page 2 of 2');
    await field.fill(`${row} garbage`);
    await page.keyboard.press('Enter');
    expect(await field.getAttribute('aria-invalid')).toBe('true');
    expect(await closePage(page)).toEqual([]);
  });
});

describe('C2-19: language carried per string', () => {
  it('on a lang="de" page with only plotLabel translated, the built-in role and value text stay marked English', async () => {
    const page = await chartPage();
    await page.evaluate(() => document.documentElement.setAttribute('lang', 'de'));
    await create(page, 'line', { title: 'T', messages: { plotLabel: 'Diagramm' }, data: [0, 1, 2].map(x => ({ x, y: x })), x: 'x', y: 'y' });
    expect(await page.locator('#chart .axylo-proxy').getAttribute('lang')).toBe('en');
    expect(await page.locator('#chart .axylo-proxy').getAttribute('aria-label')).toBe('Diagramm');
    expect(await closePage(page)).toEqual([]);
  });

  it('table cells that hold the built-in "No data" or "incomplete" are marked English on a German page; author values are not', async () => {
    const page = await chartPage();
    await page.evaluate(() => document.documentElement.setAttribute('lang', 'de'));
    const data = [{ x: 0, s: 'a', y: 1 }, { x: 0, s: 'b', y: 2 }, { x: 1, s: 'a', y: null }, { x: 1, s: 'b', y: 3 }];
    await create(page, 'bar', { title: 'T', stacked: true, data, x: 'x', y: 'y', series: 's' });
    await button(page, 'View as table').click();
    const cells = await page.evaluate(() => [...document.querySelectorAll('#chart .axylo-table tbody td, #chart .axylo-table tbody th')].map(c => ({
      text: c.textContent, lang: c.getAttribute('lang'), runs: [...c.querySelectorAll('span[lang]')].map(s => [s.textContent, s.getAttribute('lang')]),
    })));
    const missing = cells.filter(c => c.text === 'No data');
    expect(missing.length).toBeGreaterThan(0);
    for (const c of missing) expect(c.lang).toBe('en');
    for (const c of cells.filter(c => /^\d+$/.test(c.text ?? ''))) expect(c.lang).toBeNull();
    const qualified = cells.filter(c => /incomplete/.test(c.text ?? ''));
    for (const c of qualified) expect(c.runs).toEqual([[' (incomplete)', 'en']]);
    expect(await closePage(page)).toEqual([]);
  });

  it('the donut\'s slice list marks a missing value\'s built-in text English', async () => {
    const page = await chartPage();
    await page.evaluate(() => document.documentElement.setAttribute('lang', 'de'));
    await create(page, 'donut', { title: 'T', data: [{ k: 'a', v: 2 }, { k: 'b', v: null }], label: 'k', value: 'v' });
    const value = page.locator('#chart .axylo-legend-list li[data-key="b"] .axylo-legend-value');
    expect(await value.textContent()).toBe('No data');
    expect(await value.getAttribute('lang')).toBe('en');
    expect(await closePage(page)).toEqual([]);
  });
});

describe('C3-7: a pinch never zooms the wrong way', () => {
  it('on a public window below the gesture minimum, spreading the fingers leaves it as it is', async () => {
    requireEngineFeature(['chromium'], 'multi-point touch input is dispatched through the Chrome DevTools protocol');
    const page = await chartPage({ hasTouch: true });
    await create(page, 'line', { title: 'Z', zoom: 'touch', data: Array.from({ length: 11 }, (_, i) => ({ x: i * 10, y: i })), x: 'x', y: 'y' });
    await page.evaluate(() => {
      const w = window as unknown as { zooms: unknown[] };
      w.zooms = [];
      window.charts[0]!.on('zoom', (z: unknown) => { w.zooms.push(z); });
      window.charts[0]!.zoom([40, 45]);
    });
    await settle(page);
    const p = await plotBox(page);
    const cx = p.x + p.width / 2;
    const cy = p.y + p.height / 2;
    const client = await page.context().newCDPSession(page);
    const points = (d: number) => [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }];
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(40) });
    for (let d = 50; d <= 140; d += 10) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(d) });
      await page.evaluate(() => window.nextFrames(1));
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await settle(page);
    const zooms = await page.evaluate(() => (window as unknown as { zooms: number[][] }).zooms);
    // The public call, then nothing wider than 5.
    expect(zooms[0]).toEqual([40, 45]);
    for (const z of zooms.slice(1)) expect(z[1]! - z[0]!).toBeLessThanOrEqual(5 + 1e-9);
    expect(await closePage(page)).toEqual([]);
  });
});
