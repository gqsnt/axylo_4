/**
 * Automated accessibility checks (spec A8, L2, A10, I5, L4): axe-core on every fixture in every state,
 * forced colors and reduced motion emulation, and built-in English marked on a page in another language.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { start, stop } from '../harness';
import { closePage } from '../chart/util';
import { axe, FIXTURES, fixturePage, make, type FixtureName } from './util';

beforeAll(start);
afterAll(stop);

/** The chart inside a page with its own structure, as a dashboard would have it. */
async function structuredPage(options: Parameters<typeof fixturePage>[0] = {}): Promise<Page> {
  const page = await fixturePage(options);
  await page.evaluate(() => {
    const main = document.createElement('main');
    const h1 = Object.assign(document.createElement('h1'), { textContent: 'Dashboard' });
    const h2 = Object.assign(document.createElement('h2'), { textContent: 'Traffic' });
    const chart = document.getElementById('chart')!;
    chart.replaceWith(main);
    main.append(h1, h2, chart);
  });
  return page;
}

const settle = (page: Page) => page.evaluate(async () => { for (const c of window.charts) await c.__bench.ready(); await window.nextFrames(1); });

type State = 'default' | 'table open' | 'tooltip shown' | 'series hidden';

async function enter(page: Page, state: State): Promise<boolean> {
  if (state === 'default') return true;
  if (state === 'table open') {
    const toggle = page.locator('#chart .axylo-toolbar button', { hasText: 'View as table' });
    if (!(await toggle.count())) return false;
    await toggle.click();
    return true;
  }
  if (state === 'tooltip shown') {
    const proxy = page.locator('#chart .axylo-proxy');
    if (!(await proxy.count()) || !(await proxy.isVisible())) return false;
    // The keyboard shows the tooltip at a datum on every chart type, wherever its marks are.
    await proxy.focus();
    await page.keyboard.press('ArrowRight');
    return page.locator('#chart .axylo-tooltip').first().isVisible();
  }
  const entry = page.locator('#chart .axylo-legend-entry').first();
  if (!(await entry.count())) return false;
  await entry.click();
  await settle(page);
  return true;
}

describe('axe-core reports no violations (spec A8)', () => {
  for (const fixture of FIXTURES) {
    it(`${fixture}: default, table open, tooltip shown, series hidden`, async () => {
      const page = await structuredPage();
      await make(page, fixture as FixtureName);
      const report: Record<string, string[]> = {};
      const applied: State[] = [];
      for (const state of ['default', 'tooltip shown', 'series hidden', 'table open'] as const) {
        if (!(await enter(page, state))) continue;
        applied.push(state);
        const { violations, ran } = await axe(page);
        report[state] = violations.map(v => `${v.id}: ${v.help} (${v.nodes.join(', ')})`);
        expect(ran).toContain('heading-order');
        // The rule applies only where the region scrolls: the trend table's 120 rows do.
        if (state === 'table open' && fixture === 'trend') expect(ran).toContain('scrollable-region-focusable');
      }
      expect(report).toEqual(Object.fromEntries(applied.map(s => [s, []])));
      // Which states apply follows from the fixture (spec C1, L7, 3.6).
      const interactive = ['trend', 'bars', 'parts', 'scatter', 'stacked', 'dirty'].includes(fixture);
      expect(applied.includes('table open')).toBe(interactive);
      expect(applied.includes('tooltip shown')).toBe(interactive);
      expect(applied.includes('series hidden')).toBe(['trend', 'scatter', 'stacked'].includes(fixture));
      expect(await closePage(page)).toEqual([]);
    });
  }
});

describe('axe-core in the states the fixture loop does not reach (review 2, finding 21)', () => {
  it('trend paused, zoomed, in the narrow readout and in the internal-error state: no violations; undecided rules listed apart', async () => {
    const page = await structuredPage({ css: '#narrow { width: 260px; height: 300px; }' });
    await make(page, 'trend');
    const results: Record<string, { violations: string[]; incomplete: string[] }> = {};
    const check = async (state: string) => {
      const { violations, ran, incomplete } = await axe(page);
      results[state] = { violations: violations.map(v => v.id), incomplete };
      expect(ran, state).toContain('heading-order');
    };
    await page.evaluate(async () => { window.charts[0]!.append([{ day: Date.UTC(2026, 4, 1), channel: 'Direct', sessions: 1 }]); await window.charts[0]!.__bench.ready(); });
    await page.locator('#chart .axylo-toolbar button', { hasText: 'Pause' }).click();
    await settle(page);
    await check('paused');
    await page.locator('#chart .axylo-toolbar button', { hasText: 'Zoom in' }).click();
    await settle(page);
    await check('zoomed');
    await page.evaluate(async () => {
      const el = document.querySelector('main')!.appendChild(Object.assign(document.createElement('div'), { id: 'narrow' }));
      const c = window.make('trend', el);
      window.charts.push(c);
      await c.__bench.ready();
    });
    const box = (await page.locator('#narrow .axylo-proxy').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    expect(await page.locator('#narrow .axylo-readout').isVisible()).toBe(true);
    await check('narrow readout');
    await page.evaluate(async () => { const c = window.charts[0]!; c.__dev.fail('reader'); c.update({ subtitle: 'x' }); await c.__bench.ready(); });
    expect(await page.locator('#chart .axylo-message').textContent()).toBe('Something went wrong while drawing the chart.');
    await check('internal error');
    for (const [state, r] of Object.entries(results)) expect(r.violations, state).toEqual([]);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('forced colors and reduced motion (spec L4, I5, A2)', () => {
  it('every control and the focus indicator are visible in forced colors; nothing animates under reduced motion', async () => {
    const page = await structuredPage({ forcedColors: 'active', reducedMotion: 'reduce' });
    await make(page, 'trend');
    await page.evaluate(async () => { window.charts[0]!.append([{ day: Date.UTC(2026, 4, 1), channel: 'Direct', sessions: 40000 }]); await window.charts[0]!.__bench.ready(); });
    await page.locator('#chart .axylo-toolbar button', { hasText: 'Zoom in' }).click();
    await settle(page);
    const controls = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#chart .axylo-toolbar button')].map(b => {
      const s = getComputedStyle(b);
      const r = b.getBoundingClientRect();
      const swatch = b.querySelector('svg');
      return {
        text: b.textContent, width: r.width, height: r.height, color: s.color, background: s.backgroundColor,
        swatch: swatch ? getComputedStyle(swatch).color : null,
      };
    }));
    expect(controls.map(c => c.text)).toEqual(['Direct', 'Organic search', 'Referral', 'Zoom in', 'Zoom out', 'Reset zoom', 'Pause', 'View as table']);
    for (const c of controls) {
      expect(c.width).toBeGreaterThanOrEqual(24);
      expect(c.height).toBeGreaterThanOrEqual(24);
      expect(c.color).not.toBe(c.background);
      if (c.swatch !== null) expect(c.swatch).not.toBe(c.background);
    }
    await page.focus('#chart .axylo-proxy');
    await page.keyboard.press('ArrowRight');
    const ring = await page.locator('#chart .axylo-focus-ring').evaluate(el => {
      const s = getComputedStyle(el);
      return { display: s.display, width: parseFloat(s.outlineWidth), style: s.outlineStyle, color: s.outlineColor, page: getComputedStyle(document.body).backgroundColor };
    });
    expect(ring).toMatchObject({ display: 'block', style: 'solid' });
    expect(ring.width).toBeGreaterThanOrEqual(2);
    expect(ring.color).not.toBe(ring.page);
    await page.keyboard.press('Tab');
    const button = await page.evaluate(() => {
      const s = getComputedStyle(document.activeElement!);
      return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
    });
    expect(button.style).not.toBe('none');
    expect(button.width).toBeGreaterThanOrEqual(2);
    const motion = await page.evaluate(() => ({
      animations: document.getAnimations().length,
      transitions: [...document.querySelectorAll('#chart *')].filter(el => {
        const s = getComputedStyle(el);
        return s.transitionDuration.split(',').some(d => parseFloat(d) > 0) || s.animationName !== 'none';
      }).length,
    }));
    expect(motion).toEqual({ animations: 0, transitions: 0 });
    expect(await closePage(page)).toEqual([]);
  });
});

describe('language (spec A10)', () => {
  it('on a lang="de" page built-in strings carry lang="en"; an overridden string and the series names are in the page language', async () => {
    const page = await fixturePage();
    await page.evaluate(() => { document.documentElement.lang = 'de'; });
    await make(page, 'trend', { messages: { zoomIn: 'Vergrößern' } });
    const langs = await page.evaluate(() => {
      const lang = (el: Element | null) => el?.closest('[lang]')?.getAttribute('lang') ?? null;
      const button = (text: string) => [...document.querySelectorAll('#chart .axylo-toolbar button')].find(b => b.textContent === text) ?? null;
      return {
        toolbar: document.querySelector('#chart .axylo-toolbar')!.getAttribute('lang'),
        zoomIn: button('Vergrößern')?.getAttribute('lang') ?? null, zoomInEffective: lang(button('Vergrößern')),
        zoomOut: button('Zoom out')?.getAttribute('lang') ?? null,
        table: button('View as table')?.getAttribute('lang') ?? null,
        legend: lang(button('Direct')),
      };
    });
    expect(langs).toEqual({ toolbar: 'en', zoomIn: 'de', zoomInEffective: 'de', zoomOut: 'en', table: 'en', legend: 'de' });
    expect(await closePage(page)).toEqual([]);
  });

  it('an overridden string is not marked English, even inherited, when it is the only text', async () => {
    const page = await fixturePage();
    await page.evaluate(() => { document.documentElement.lang = 'de'; });
    await make(page, 'loading', { messages: { loading: 'Diagramm wird geladen.' } });
    expect(await page.locator('#chart .axylo-message').evaluate(el => el.closest('[lang]')?.getAttribute('lang'))).toBe('de');
    await page.evaluate(async () => { window.charts[0]!.update({ messages: undefined }); await window.charts[0]!.__bench.ready(); });
    expect(await page.locator('#chart .axylo-message').getAttribute('lang')).toBe('en');
    expect(await closePage(page)).toEqual([]);
  });

  it('on an English page nothing is marked', async () => {
    const page = await fixturePage();
    await make(page, 'trend');
    expect(await page.locator('#chart [lang]').count()).toBe(0);
    expect(await closePage(page)).toEqual([]);
  });
});
