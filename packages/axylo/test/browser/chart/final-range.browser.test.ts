/**
 * "Select range" (spec I4: every interaction works with a single pointer without dragging; WCAG 2.5.7; final
 * interaction review C2-8): a toolbar toggle, wherever a drag selects a zoom range, after which the next two
 * plot clicks or taps set the range's two ends, in either order, by the drag's own rules.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { requireEngineFeature, start, stop } from '../harness';
import { chartPage, closePage } from './util';
import { create, plotBox, recordEvents, selected, settle, tip, type Box } from './final-util';

beforeAll(start);
afterAll(stop);

/** The toggle, a 24 × 24 symbol named by its hidden text (and its title). */
const toggle = (page: Page) => page.locator('#chart [role="toolbar"] button[title="Select range"]');
const pressed = (page: Page) => toggle(page).getAttribute('aria-pressed');
const domain = (page: Page) => page.evaluate(() => window.charts[0]!.__bench.describe().xDomain);
/** x = 0 … 100 over the plot, one point per unit. */
const LINE = { title: 'R', data: Array.from({ length: 101 }, (_, i) => ({ x: i, y: i % 7 })), x: 'x', y: 'y' };
const at = (p: Box, x: number) => ({ x: p.x + (x / 100) * p.width, y: p.y + p.height / 2 });

async function click(page: Page, point: { x: number; y: number }): Promise<void> {
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.up();
  await settle(page);
}

/** Expected window to the precision of a click: one CSS px of the plot, in x units. */
function near(actual: number[] | null, expected: [number, number], p: Box): void {
  expect(actual).not.toBeNull();
  const unit = 100 / p.width;
  expect(Math.abs(actual![0]! - expected[0])).toBeLessThanOrEqual(unit);
  expect(Math.abs(actual![1]! - expected[1])).toBeLessThanOrEqual(unit);
}

describe('the toggle', () => {
  it('is a symbol button named "Select range" (its text, kept as the accessible name, and its title), its shape drawn in the text colour, also in forced colours', async () => {
    for (const forcedColors of ['none', 'active'] as const) {
      const page = await chartPage({ forcedColors });
      await create(page, 'line', LINE);
      const t = await toggle(page).evaluate(b => {
        const path = b.querySelector('svg path');
        return {
          name: b.textContent, title: b.getAttribute('title'), svg: !!path,
          stroke: path ? getComputedStyle(path).stroke : '', background: getComputedStyle(b).backgroundColor,
        };
      });
      expect(t).toMatchObject({ name: 'Select range', title: 'Select range', svg: true });
      expect(t.stroke).not.toBe(t.background);
      expect(t.stroke).not.toBe('none');
      expect(await closePage(page)).toEqual([]);
    }
  });

  it('adds no toolbar row at any width, in any state, against the toolbar as it was without it (6 px gaps, 8 px padding)', async () => {
    const page = await chartPage({ viewport: { width: 1200, height: 900 } });
    const failures = await page.evaluate(async () => {
      const W = window as unknown as { Axylo: Record<string, (t: string, o: unknown) => { __bench: { ready(): Promise<void>; describe(): { xDomain: number[] } }; zoom(d: number[]): void; append(r: unknown[]): void; destroy(): void }>; nextFrames(n: number): Promise<void> };
      const before = document.createElement('style');
      // The toolbar before the toggle existed: no toggle, its earlier spacing.
      before.textContent = '#chart .axylo-toolbar { gap: 4px 6px !important; } #chart .axylo-control { padding-inline: 8px !important; } #chart .axylo-control-symbol { display: none !important; }';
      const rows = () => new Set([...document.querySelectorAll('#chart .axylo-toolbar button')].filter(b => (b as HTMLElement).offsetParent).map(b => Math.round(b.getBoundingClientRect().top))).size;
      const out: string[] = [];
      const days = Array.from({ length: 30 }, (_, i) => ['Direct', 'Organic search', 'Referral'].map((s, k) => ({ t: Date.UTC(2026, 0, 1 + i), s, y: i + k })) ).flat();
      const cases: [string, Record<string, unknown>][] = [
        ['three series', { title: 'T', data: days, x: { field: 't', type: 'time' }, y: 'y', series: 's' }],
        ['one series', { title: 'T', data: Array.from({ length: 50 }, (_, i) => ({ x: i, y: i })), x: 'x', y: 'y' }],
      ];
      const widths = [220, 240, 280, 320];
      for (let w = 200; w <= 900; w += 10) widths.push(w);
      for (const [name, options] of cases) for (const state of ['plain', 'zoomed', 'streaming']) for (const w of widths) {
        const el = document.getElementById('chart')!;
        el.style.width = `${w}px`;
        el.style.height = '400px';
        const c = W.Axylo.line!('#chart', options);
        await c.__bench.ready();
        if (state === 'zoomed') { const d = c.__bench.describe().xDomain; c.zoom([d[0]! + (d[1]! - d[0]!) / 4, d[0]! + (d[1]! - d[0]!) / 2]); await c.__bench.ready(); }
        if (state === 'streaming') { c.append([]); await c.__bench.ready(); }
        await W.nextFrames(2);
        const now = rows();
        document.head.appendChild(before);
        const was = rows();
        before.remove();
        if (now > was) out.push(`${name}, ${state}, ${w} px: ${was} rows before, ${now} with the toggle`);
        c.destroy();
      }
      return out;
    });
    expect(failures).toEqual([]);
    expect(await closePage(page)).toEqual([]);
  });

  it('is a real toggle button, at least 24 × 24 CSS px, unpressed until pressed', async () => {
    const page = await chartPage();
    await create(page, 'line', LINE);
    expect(await toggle(page).count()).toBe(1);
    expect(await toggle(page).evaluate(el => el.tagName)).toBe('BUTTON');
    expect(await pressed(page)).toBe('false');
    const b = (await toggle(page).boundingBox())!;
    expect(b.width).toBeGreaterThanOrEqual(24);
    expect(b.height).toBeGreaterThanOrEqual(24);
    await toggle(page).click();
    expect(await pressed(page)).toBe('true');
    expect(await closePage(page)).toEqual([]);
  });

  for (const [name, kind, options] of [
    ['a category bar chart', 'bar', { title: 'C', data: [{ x: 'a', y: 1 }, { x: 'b', y: 2 }], x: 'x', y: 'y' }],
    ['a donut', 'donut', { title: 'D', data: [{ k: 'a', v: 1 }, { k: 'b', v: 2 }], label: 'k', value: 'v' }],
    ['a compact line', 'line', { ...LINE, compact: true }],
    ['a line with zoom: false', 'line', { ...LINE, zoom: false }],
  ] as const) {
    it(`is absent on ${name} (no drag-to-zoom there)`, async () => {
      const page = await chartPage();
      await create(page, kind, options);
      expect(await page.locator('#chart button[title="Select range"]').count()).toBe(0);
      expect(await closePage(page)).toEqual([]);
    });
  }

  for (const [name, kind, options] of [
    ['a scatter chart', 'scatter', { title: 'S', data: [{ x: 1, y: 1 }, { x: 9, y: 2 }], x: 'x', y: 'y' }],
    ['a time line', 'line', { title: 'T', data: Array.from({ length: 30 }, (_, i) => ({ t: Date.UTC(2026, 0, 1 + i), y: i })), x: { field: 't', type: 'time' }, y: 'y' }],
  ] as const) {
    it(`is present on ${name}`, async () => {
      const page = await chartPage();
      await create(page, kind, options);
      expect(await toggle(page).count()).toBe(1);
      expect(await closePage(page)).toEqual([]);
    });
  }
});

describe('two clicks set the range', () => {
  for (const [first, second] of [[20, 60], [60, 20]] as const) {
    it(`clicks at x = ${first} then x = ${second}: the window is [20, 60]; nothing is pinned or selected; the toggle releases itself`, async () => {
      const page = await chartPage();
      await create(page, 'line', LINE);
      await recordEvents(page);
      const p = await plotBox(page);
      await toggle(page).click();
      await click(page, at(p, first));
      // Between the clicks the first end is marked with the drag selection's visual, at that x.
      const mark = page.locator('#chart .axylo-selection');
      expect(await mark.isVisible()).toBe(true);
      const m = (await mark.boundingBox())!;
      expect(Math.abs(m.x + m.width / 2 - at(p, first).x)).toBeLessThanOrEqual(1.5);
      expect(await pressed(page)).toBe('true');
      await click(page, at(p, second));
      near(await domain(page), [20, 60], p);
      expect(await pressed(page)).toBe('false');
      expect(await mark.isVisible()).toBe(false);
      expect(await selected(page)).toEqual([]);
      expect((await tip(page)).pinned).toBe(false);
      // Released: the next click pins and selects again.
      await click(page, { x: p.x + p.width / 2, y: p.y + p.height / 2 });
      expect(await selected(page)).toHaveLength(1);
      expect((await tip(page)).pinned).toBe(true);
      expect(await closePage(page)).toEqual([]);
    });
  }

  it('two clicks closer than the smallest window zoom nothing, as a drag would, and release the toggle', async () => {
    const page = await chartPage();
    // Two x slots only: the smallest window is half the range.
    await create(page, 'line', { title: 'Two', data: [{ x: 0, y: 1 }, { x: 100, y: 2 }], x: 'x', y: 'y' });
    const p = await plotBox(page);
    await toggle(page).click();
    await click(page, at(p, 40));
    await click(page, at(p, 60));
    expect(await domain(page)).toEqual([0, 100]);
    expect(await pressed(page)).toBe('false');
    expect(await closePage(page)).toEqual([]);
  });

  it('by touch: tap the toggle, then two taps on the plot', async () => {
    const page = await chartPage({ hasTouch: true });
    await create(page, 'line', LINE);
    await recordEvents(page);
    const p = await plotBox(page);
    const t = (await toggle(page).boundingBox())!;
    await page.touchscreen.tap(t.x + t.width / 2, t.y + t.height / 2);
    await settle(page);
    expect(await pressed(page)).toBe('true');
    for (const x of [70, 30]) {
      const q = at(p, x);
      await page.touchscreen.tap(q.x, q.y);
      await settle(page);
    }
    near(await domain(page), [30, 70], p);
    expect(await pressed(page)).toBe('false');
    expect(await selected(page)).toEqual([]);
    expect(await closePage(page)).toEqual([]);
  });

  it('by pen: two pen clicks on the plot', async () => {
    requireEngineFeature(['chromium'], 'pen input is dispatched through the Chrome DevTools protocol');
    const page = await chartPage();
    await create(page, 'line', LINE);
    const p = await plotBox(page);
    await toggle(page).click();
    const client = await page.context().newCDPSession(page);
    for (const x of [10, 50]) {
      const q = at(p, x);
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'] as const) {
        await client.send('Input.dispatchMouseEvent', { type, x: q.x, y: q.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1, pointerType: 'pen' });
      }
      await settle(page);
    }
    near(await domain(page), [10, 50], p);
    expect(await pressed(page)).toBe('false');
    expect(await closePage(page)).toEqual([]);
  });
});

describe('a drag while it is pressed', () => {
  it('zooms as a drag and releases the toggle, the first end cleared (decision 0004, clarifications)', async () => {
    const page = await chartPage();
    await create(page, 'line', LINE);
    const p = await plotBox(page);
    await toggle(page).click();
    await click(page, at(p, 80));
    const a = at(p, 10), b = at(p, 40);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    await page.mouse.up();
    await settle(page);
    near(await domain(page), [10, 40], p);
    expect(await pressed(page)).toBe('false');
    expect(await page.locator('#chart .axylo-selection').isVisible()).toBe(false);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('cancelling', () => {
  it('pressing the toggle again, Escape, or a redraw without zoom each release it and clear the first end', async () => {
    const page = await chartPage();
    await create(page, 'line', LINE);
    const p = await plotBox(page);
    const mark = page.locator('#chart .axylo-selection');
    const armWithEnd = async () => {
      await toggle(page).click();
      await click(page, at(p, 20));
      expect(await mark.isVisible()).toBe(true);
    };
    // The toggle again.
    await armWithEnd();
    await toggle(page).click();
    expect(await pressed(page)).toBe('false');
    expect(await mark.isVisible()).toBe(false);
    // Escape.
    await armWithEnd();
    await page.keyboard.press('Escape');
    await settle(page);
    expect(await pressed(page)).toBe('false');
    expect(await mark.isVisible()).toBe(false);
    // A redraw without zoom: the toggle goes; with zoom back it is unpressed, and the old first end is gone.
    await armWithEnd();
    await page.evaluate(() => window.charts[0]!.update({ zoom: false }));
    await settle(page);
    expect(await page.locator('#chart button[title="Select range"]').count()).toBe(0);
    expect(await mark.isVisible()).toBe(false);
    await page.evaluate(() => window.charts[0]!.update({ zoom: true }));
    await settle(page);
    expect(await pressed(page)).toBe('false');
    // In every case the first end was cleared: after pressing it again, one click alone zooms nothing.
    await toggle(page).click();
    await click(page, at(p, 80));
    expect(await domain(page)).toEqual([0, 100]);
    expect(await pressed(page)).toBe('true');
    expect(await closePage(page)).toEqual([]);
  });

  it('one Escape does one thing: the pressed toggle first, then the tooltip, then single-series mode, then the page', async () => {
    const page = await chartPage();
    const data = Array.from({ length: 21 }, (_, x) => ['a', 'b'].map((s, i) => ({ x: x * 5, s, y: x + i * 5 }))).flat();
    await create(page, 'line', { title: 'E', data, x: 'x', y: 'y', series: 's' });
    await page.evaluate(() => {
      const w = window as unknown as { escapes: number };
      w.escapes = 0;
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && !e.defaultPrevented) w.escapes++; });
    });
    const proxy = page.locator('#chart .axylo-proxy');
    await proxy.focus();
    await page.keyboard.press('ArrowDown');
    await settle(page);
    expect(await proxy.getAttribute('aria-valuetext')).toMatch(/^a, /);
    // The toggle pressed from the keyboard's toolbar stop, focus back on the plot: the keyboard's tooltip shows.
    await toggle(page).focus();
    await page.keyboard.press('Enter');
    await proxy.focus();
    await settle(page);
    expect(await pressed(page)).toBe('true');
    expect((await tip(page)).title).not.toBeNull();
    const escapes = () => page.evaluate(() => (window as unknown as { escapes: number }).escapes);
    await page.keyboard.press('Escape');
    await settle(page);
    expect([await pressed(page), (await tip(page)).title !== null, /^a, /.test((await proxy.getAttribute('aria-valuetext')) ?? ''), await escapes()]).toEqual(['false', true, true, 0]);
    await page.keyboard.press('Escape');
    await settle(page);
    expect([(await tip(page)).title !== null, /^a, /.test((await proxy.getAttribute('aria-valuetext')) ?? ''), await escapes()]).toEqual([false, true, 0]);
    await page.keyboard.press('Escape');
    await settle(page);
    expect([/^a, /.test((await proxy.getAttribute('aria-valuetext')) ?? ''), await escapes()]).toEqual([false, 0]);
    await page.keyboard.press('Escape');
    expect(await escapes()).toBe(1);
    expect(await closePage(page)).toEqual([]);
  });
});
