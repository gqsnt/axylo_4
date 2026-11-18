/**
 * Keyboard and screen-reader proxy (decision 0001; spec A2, A3, A7). Expected text comes from the trend
 * fixture (three series over 120 UTC days, Referral null on days 60–66) and the built-in messages; the
 * accessibility node is read from Chrome itself through the DevTools protocol after each step.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { start, stop } from '../harness';
import { aria, closePage } from '../chart/util';
import { axNode, fixturePage, make, tabStops } from './util';

beforeAll(start);
afterAll(stop);

const SHOW_BUTTONS = '#before, #after { display: inline-block !important; }';
const DAY = 864e5;
const START = Date.UTC(2026, 0, 1);
const number = (v: number) => new Intl.NumberFormat('en-US').format(v);
const date = (i: number) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(START + i * DAY);

async function trendValues(page: Page): Promise<{ name: string; values: (number | null)[] }[]> {
  return page.evaluate(() => window.fx.trend.series);
}

const valueText = (page: Page) => page.locator('#chart .axylo-proxy').getAttribute('aria-valuetext');

describe('tab order (spec A2): the plot, then the toolbar, then out', () => {
  const states: [string, (page: Page) => Promise<void>][] = [
    ['default', async () => {}],
    ['zoomed', async page => {
      await page.evaluate(async () => {
        const c = window.charts[0]!;
        c.zoom([Date.UTC(2026, 1, 1), Date.UTC(2026, 2, 1)]);
        await c.__bench.ready();
        await window.nextFrames(1);
      });
    }],
    ['streaming', async page => {
      await page.evaluate(async () => {
        const c = window.charts[0]!;
        c.append([{ day: Date.UTC(2026, 4, 1), channel: 'Direct', sessions: 41000 }], { keep: 120 });
        await c.__bench.ready();
        await window.nextFrames(1);
      });
    }],
    ['hidden series', async page => {
      await page.locator('#chart .axylo-legend-entry', { hasText: 'Referral' }).click();
      await page.evaluate(async () => { await window.charts[0]!.__bench.ready(); await window.nextFrames(1); });
    }],
  ];
  for (const [state, enter] of states) {
    it(`exactly two stops in the ${state} state, forwards and backwards`, async () => {
      const page = await fixturePage({ css: SHOW_BUTTONS });
      await make(page, 'trend');
      await enter(page);
      const forwards = await tabStops(page);
      expect(forwards[0]).toBe('proxy');
      expect(forwards[1]).toMatch(/^toolbar:/);
      expect(forwards.slice(2)).toEqual(['after']);
      const backwards = await tabStops(page, true);
      expect(backwards[0]).toMatch(/^toolbar:/);
      expect(backwards[1]).toBe('proxy');
      expect(backwards.slice(2)).toEqual(['before']);
      if (state === 'streaming') expect(await page.locator('#chart .axylo-toolbar').textContent()).toContain('Pause');
      if (state === 'zoomed') expect(await page.locator('#chart .axylo-toolbar').textContent()).toContain('Reset zoom');
      expect(await closePage(page)).toEqual([]);
    });
  }

  it('the toolbar has roving focus: arrows, Home and End move within it; one tab stop', async () => {
    const page = await fixturePage({ css: SHOW_BUTTONS });
    await make(page, 'trend');
    await page.focus('#before');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const label = () => page.evaluate(() => document.activeElement?.textContent ?? '');
    expect(await label()).toBe('Direct');
    await page.keyboard.press('ArrowRight');
    expect(await label()).toBe('Organic search');
    await page.keyboard.press('End');
    expect(await label()).toBe('View as table');
    await page.keyboard.press('Home');
    expect(await label()).toBe('Direct');
    await page.keyboard.press('ArrowLeft');
    expect(await label()).toBe('View as table');
    // Leaving and coming back lands on the control last used.
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    expect(await label()).toBe('View as table');
    expect(await page.locator('#chart [role="toolbar"] [tabindex="0"]').count()).toBe(1);
    expect(await closePage(page)).toEqual([]);
  });

  // Changed by review 2, finding 15: the open table takes the plot's place (so opening it moves nothing on the
  // page) and the plot under it is inert, so no focus lands on something covered (WCAG 2.4.11).
  it('the table, once open, takes the plot\'s place: the toolbar, then its scroll region; focus still leaves the chart', async () => {
    const page = await fixturePage({ css: SHOW_BUTTONS });
    await make(page, 'trend');
    await page.locator('#chart button', { hasText: 'View as table' }).click();
    const stops = await tabStops(page);
    // In document order: the table's scroll region (and its pager) where the plot was, then the toolbar.
    expect(stops[0]).toBe('table');
    expect(stops).toContainEqual(expect.stringMatching(/^toolbar:/));
    expect(stops).not.toContain('proxy');
    expect(stops.at(-1)).toBe('after');
    expect(await closePage(page)).toEqual([]);
  });

  it('a compact chart adds no tab stop (spec C1)', async () => {
    const page = await fixturePage({ css: SHOW_BUTTONS });
    await make(page, 'compact');
    expect(await tabStops(page)).toEqual(['after']);
    expect(await page.locator('#chart input, #chart button').count()).toBe(0);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('keyboard walk on the trend fixture (decision 0001)', () => {
  it('reads every series at x, narrows to one with Down, reaches the ends, pages by a tenth, and selects', async () => {
    const page = await fixturePage({ css: SHOW_BUTTONS });
    await make(page, 'trend');
    const series = await trendValues(page);
    await page.evaluate(() => {
      (window as unknown as { selected: unknown[] }).selected = [];
      window.charts[0]!.on('select', p => {
        const point = p as { series: string; x: Date; y: number | null; index: number };
        (window as unknown as { selected: unknown[] }).selected.push({ series: point.series, x: point.x.toISOString(), y: point.y });
      });
    });
    await page.focus('#before');
    await page.keyboard.press('Tab');
    let node = await axNode(page, '#chart .axylo-proxy');
    expect(node).toMatchObject({ role: 'slider', name: 'Chart plot', roledescription: 'Line chart', focused: true, value: '0', max: 119 });
    expect(node.text).toContain(date(0));
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');

    // Fourth x, all three series with their values, ending with the position.
    node = await axNode(page, '#chart .axylo-proxy');
    expect(node.role).toBe('slider');
    expect(node.text.startsWith(date(3))).toBe(true);
    for (const s of series) expect(node.text).toContain(`${s.name} ${number(s.values[3]!)}`);
    expect(node.text.endsWith('Point 4 of 120')).toBe(true);
    expect(node).toMatchObject({ value: '3', max: 119, focused: true });
    const tree = await aria(page);
    expect(tree).toContain('slider "Chart plot"');
    expect(tree).toContain('toolbar "Chart controls"');

    // Down narrows to the first series, again to the second.
    await page.keyboard.press('ArrowDown');
    node = await axNode(page, '#chart .axylo-proxy');
    expect(node.text.startsWith(`Direct, ${date(3)}`)).toBe(true);
    expect(node.text.endsWith(`, ${number(series[0]!.values[3]!)}. Point 4 of 120.`)).toBe(true);
    expect(node.text).not.toContain('Organic');
    await page.keyboard.press('ArrowDown');
    node = await axNode(page, '#chart .axylo-proxy');
    expect(node.text.startsWith(`Organic search, ${date(3)}`)).toBe(true);
    expect(node.text).toContain(number(series[1]!.values[3]!));

    // Home and End reach the ends; Page Down moves back by a tenth (12 of 120).
    await page.keyboard.press('Home');
    node = await axNode(page, '#chart .axylo-proxy');
    expect(node.text.startsWith(`Organic search, ${date(0)}`)).toBe(true);
    expect(node.text.endsWith('Point 1 of 120.')).toBe(true);
    await page.keyboard.press('End');
    node = await axNode(page, '#chart .axylo-proxy');
    expect(node.text.startsWith(`Organic search, ${date(119)}`)).toBe(true);
    expect(node.text.endsWith('Point 120 of 120.')).toBe(true);
    expect(node.value).toBe('119');
    await page.keyboard.press('PageDown');
    node = await axNode(page, '#chart .axylo-proxy');
    expect(node.text.endsWith('Point 108 of 120.')).toBe(true);
    expect(node.value).toBe('107');
    await page.keyboard.press('PageUp');
    expect((await axNode(page, '#chart .axylo-proxy')).text.endsWith('Point 120 of 120.')).toBe(true);
    expect(await page.locator('#chart .axylo-proxy').inputValue()).toBe('119');

    // Escape: first the tooltip, then single-series mode, then it is left to the page.
    expect(await page.locator('#chart .axylo-tooltip').isVisible()).toBe(true);
    await page.keyboard.press('Escape');
    expect(await page.locator('#chart .axylo-tooltip').isVisible()).toBe(false);
    expect((await axNode(page, '#chart .axylo-proxy')).text.startsWith('Organic search, ')).toBe(true);
    await page.keyboard.press('Escape');
    node = await axNode(page, '#chart .axylo-proxy');
    expect(node.text.startsWith(date(119) + ', 12:00 AM UTC. Direct ')).toBe(true);
    const escape = await page.evaluate(() => new Promise<boolean>(resolve => {
      document.addEventListener('keydown', e => resolve(e.defaultPrevented), { once: true });
      document.querySelector<HTMLElement>('#chart .axylo-proxy')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    }));
    expect(escape).toBe(false);

    // Enter selects the datum the reader is on: the last day, the first series with a value.
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press(' ');
    const selected = await page.evaluate(() => (window as unknown as { selected: unknown[] }).selected);
    expect(selected).toEqual([
      { series: 'Direct', x: new Date(START + 119 * DAY).toISOString(), y: series[0]!.values[119] },
      { series: 'Direct', x: new Date(START + 118 * DAY).toISOString(), y: series[0]!.values[118] },
    ]);
    expect(await closePage(page)).toEqual([]);
  });

  it('the focus ring is at least 2 px in the focus color and is drawn only for keyboard focus', async () => {
    const page = await fixturePage({ css: SHOW_BUTTONS });
    await make(page, 'trend');
    const ring = page.locator('#chart .axylo-focus-ring');
    expect(await ring.isVisible()).toBe(false);
    await page.focus('#before');
    await page.keyboard.press('Tab');
    expect(await ring.isVisible()).toBe(true);
    const style = await ring.evaluate(el => {
      const s = getComputedStyle(el);
      return { width: parseFloat(s.outlineWidth), style: s.outlineStyle, color: s.outlineColor };
    });
    expect(style.width).toBeGreaterThanOrEqual(2);
    expect(style.style).toBe('solid');
    // LIGHT.focus (#1f5fcc) is 6.0:1 on white (theme/palette.ts, spec L2 requires 3:1).
    expect(style.color).toBe('rgb(31, 95, 204)');
    // The tooltip sits beside the mark and never over the whole ring.
    const [tip, box] = await Promise.all([page.locator('#chart .axylo-tooltip').first().boundingBox(), ring.boundingBox()]);
    expect(tip!.width * tip!.height).toBeLessThan(box!.width * box!.height / 2);
    // And it covers none of the focused marks (review 2, finding 21: an intersection, not an area): the
    // first day of each series, at its value, as the drawn domains place it.
    const marks = await page.evaluate(() => {
      const { xDomain, yDomain } = window.charts[0]!.__bench.describe();
      const p = document.querySelector('#chart .axylo-proxy')!.getBoundingClientRect();
      return window.fx.trend.series.map(s => ({
        x: p.left + (window.fx.trend.t[0]! - xDomain![0]!) / (xDomain![1]! - xDomain![0]!) * p.width,
        y: p.bottom - (s.values[0]! - yDomain![0]!) / (yDomain![1]! - yDomain![0]!) * p.height,
      }));
    });
    for (const m of marks) {
      const inside = m.x >= tip!.x - 4 && m.x <= tip!.x + tip!.width + 4 && m.y >= tip!.y - 4 && m.y <= tip!.y + tip!.height + 4;
      expect(inside, JSON.stringify(m)).toBe(false);
    }
    expect(await closePage(page)).toEqual([]);
  });
});

describe('missing data and hidden series', () => {
  it('stepping onto the outage reads "No data" for Referral; a hidden series is skipped; hiding the focused series keeps the x', async () => {
    const page = await fixturePage({ css: SHOW_BUTTONS });
    await make(page, 'trend');
    await page.focus('#before');
    await page.keyboard.press('Tab');
    for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowRight');
    let text = (await axNode(page, '#chart .axylo-proxy')).text;
    expect(text.startsWith(date(60))).toBe(true);
    expect(text).toContain('Referral No data');
    expect(text.endsWith('Point 61 of 120')).toBe(true);

    // In single-series mode Referral skips its own outage (lookup.step): from day 59 Right lands on day 67.
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowUp');
    text = (await axNode(page, '#chart .axylo-proxy')).text;
    expect(text.startsWith(`Referral, ${date(59)}`)).toBe(true);
    await page.keyboard.press('ArrowRight');
    text = (await axNode(page, '#chart .axylo-proxy')).text;
    expect(text.startsWith(`Referral, ${date(67)}`)).toBe(true);
    expect(text.endsWith('Point 68 of 120.')).toBe(true);
    await page.keyboard.press('ArrowLeft');

    // Hide the focused series with the legend: focus resolves to the same x.
    await page.locator('#chart .axylo-legend-entry', { hasText: 'Referral' }).click();
    await page.evaluate(async () => { await window.charts[0]!.__bench.ready(); await window.nextFrames(1); });
    text = (await valueText(page))!;
    expect(text).toContain(date(59));
    expect(text.endsWith('Point 60 of 120.')).toBe(true);
    expect(text).not.toContain('Referral');

    // Back on the plot, Up and Down move over the visible series only.
    await page.focus('#chart .axylo-proxy');
    await page.keyboard.press('Escape');
    text = (await axNode(page, '#chart .axylo-proxy')).text;
    expect(text).not.toContain('Referral');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    text = (await axNode(page, '#chart .axylo-proxy')).text;
    expect(text.startsWith(`Organic search, ${date(59)}`)).toBe(true);
    expect(await closePage(page)).toEqual([]);
  });
});
