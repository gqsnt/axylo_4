/**
 * Theme detection and live restyling (spec L4, A5, DX6) in system Chrome, with the hand-built scene of
 * entries/axylo-render.entry.ts. The path's stroke at (85, 50) is series 1 and is the probe point.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { start, stop } from '../harness';
import { DARK, LIGHT } from '../../../src/theme/palette';
import { contrastRatio, parseColor } from '../../../src/theme/color';
import type {} from './entries/api';
import { at, close, diff, frames, ink, open, rgb, shot, type RGB } from './util';

beforeAll(start);
afterAll(stop);

const scheme = (page: Page, id = 0): Promise<{ scheme: string; attribute: string | null }> =>
  page.evaluate(i => { const t = window.axr.theme(i); return { scheme: t.theme.scheme, attribute: t.attribute }; }, id);

const contrast = (a: RGB, b: RGB): number =>
  contrastRatio({ r: a[0] / 255, g: a[1] / 255, b: a[2] / 255, a: 1 }, { r: b[0] / 255, g: b[1] / 255, b: b[2] / 255, a: 1 });

describe('scheme detection (spec L4)', () => {
  it('a page that sets color-scheme: dark is dark', async () => {
    const page = await open();
    await page.addStyleTag({ content: ':root { color-scheme: dark; }' });
    await page.evaluate(() => window.axr.mount('svg', 20, 60));
    expect(await scheme(page)).toEqual({ scheme: 'dark', attribute: 'dark' });
    const img = await shot(page, 20, 60, 400, 300);
    expect(diff(at(img, 85, 50), rgb(DARK.series[0]!))).toBeLessThanOrEqual(8);
    await close(page);
  });

  it('a class-toggled dark theme without color-scheme is dark, from the inherited text color', async () => {
    const page = await open();
    await page.addStyleTag({ content: 'html.dark body { background: #16181d; color: #e8eaee; }' });
    await page.evaluate(() => { document.documentElement.classList.add('dark'); window.axr.mount('canvas', 20, 60); });
    expect(await scheme(page)).toEqual({ scheme: 'dark', attribute: 'dark' });
    await close(page);
  });

  it('a light-only page on a dark device stays light', async () => {
    const page = await open({ colorScheme: 'dark' });
    await page.addStyleTag({ content: ':root { color-scheme: light; }' });
    await page.evaluate(() => window.axr.mount('svg', 20, 60));
    expect(await scheme(page)).toEqual({ scheme: 'light', attribute: 'light' });
    await close(page);
  });

  it('a computed color-scheme decides even when the text color says otherwise', async () => {
    for (const [css, expected] of [
      [':root { color-scheme: dark; color: #111111; }', 'dark'],
      [':root { color-scheme: light; color: #eeeeee; background: #111111; }', 'light'],
      [':root { color-scheme: only dark; color: #111111; }', 'dark'],
    ] as const) {
      const page = await open();
      await page.addStyleTag({ content: css });
      await page.evaluate(() => window.axr.mount('svg', 20, 60));
      expect((await scheme(page)).scheme, css).toBe(expected);
      await close(page);
    }
  });

  it('color-scheme naming both falls back to the text color, which then follows the device', async () => {
    const page = await open({ colorScheme: 'dark' });
    await page.addStyleTag({ content: ':root { color-scheme: light dark; }' });
    await page.evaluate(() => window.axr.mount('svg', 20, 60));
    expect((await scheme(page)).scheme).toBe('dark');
    await close(page);
  });

  it('--axylo-background overrides color-scheme', async () => {
    const page = await open();
    await page.addStyleTag({ content: ':root { color-scheme: light; --axylo-background: #101418; }' });
    await page.evaluate(() => window.axr.mount('svg', 20, 60));
    const t = await page.evaluate(() => window.axr.theme(0));
    expect(t.theme.scheme).toBe('dark');
    expect(t.theme.paints.tokens.background).toBe('rgb(16, 20, 24)');
    await close(page);
  });

  it('theme.paints are concrete colors resolved by the browser; bindings stay CSS expressions', async () => {
    const page = await open();
    await page.evaluate(() => window.axr.mount('canvas', 20, 60));
    const t = await page.evaluate(() => window.axr.theme(0));
    expect(t.bindings.series[0]).toBe('var(--axylo-series-1)');
    expect(t.bindings.series[7]).toBe('var(--axylo-series-8)');
    expect(t.theme.paints.series.map(c => rgb(c))).toEqual(LIGHT.series.map(c => rgb(c)));
    expect(rgb(t.theme.paints.tokens.axis)).toEqual(rgb(LIGHT.axis));
    expect(rgb(t.theme.paints.tokens.background)).toEqual(rgb(LIGHT.background));
    // Text is inherited from the page (blank.html sets none: black).
    expect(rgb(t.theme.paints.tokens.text)).toEqual([0, 0, 0]);
    expect(t.theme.forcedColors).toBe(false);
    await close(page);
  });
});

describe('runtime toggle', () => {
  it('a class toggled on <html> fires watchTheme; SVG restyles with no draw call, canvas changes on the draw the callback makes', async () => {
    const page = await open();
    await page.addStyleTag({ content: 'html.dark body { background: #16181d; color: #e8eaee; }' });
    await page.evaluate(() => { window.axr.mount('canvas', 20, 60); window.axr.mount('svg', 460, 60); });
    const before = await shot(page, 460, 60, 400, 300);
    expect(diff(at(before, 85, 50), rgb(LIGHT.series[0]!))).toBeLessThanOrEqual(8);
    await page.evaluate(() => window.axr.watch([85, 50]));
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.waitForFunction(() => window.axr.fired() >= 1);
    await frames(page, 2);
    const r = await page.evaluate(() => ({ fired: window.axr.fired(), records: window.axr.records(), svgDraws: window.axr.draws(1), canvasDraws: window.axr.draws(0) }));
    expect(r.fired).toBe(1);
    expect(r.svgDraws).toBe(1);
    expect(r.canvasDraws).toBe(2);
    const canvas = r.records.find(x => x.id === 0)!;
    // Before the draw the canvas still shows the light color; after it, the dark one.
    expect(diff(canvas.before!, rgb(LIGHT.series[0]!))).toBeLessThanOrEqual(8);
    expect(diff(canvas.after!, rgb(DARK.series[0]!))).toBeLessThanOrEqual(8);
    const after = await shot(page, 460, 60, 400, 300);
    expect(diff(at(after, 85, 50), rgb(DARK.series[0]!))).toBeLessThanOrEqual(8);
    expect(diff(at(after, 300, 260), rgb(DARK.axis))).toBeLessThanOrEqual(4);
    const canvasShot = await shot(page, 20, 60, 400, 300);
    expect(diff(at(canvasShot, 85, 50), rgb(DARK.series[0]!))).toBeLessThanOrEqual(8);
    await page.evaluate(() => window.axr.stopWatch());
    await close(page);
  });

  it('folds a burst into one call per frame, reports media changes, and stop() leaves nothing firing', async () => {
    const page = await open();
    await page.evaluate(() => { window.axr.mount('svg', 20, 60); window.axr.watch([85, 50]); });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(() => window.axr.fired() >= 1);
    await page.emulateMedia({ forcedColors: 'active' });
    await page.waitForFunction(() => window.axr.fired() >= 2);
    await page.emulateMedia({ forcedColors: 'none', colorScheme: 'light' });
    await frames(page, 3);
    const settled = await page.evaluate(() => window.axr.fired());
    await page.evaluate(() => {
      for (let i = 0; i < 5; i++) document.documentElement.classList.toggle('x');
      document.body.style.setProperty('color', 'rgb(1, 2, 3)');
      document.body.setAttribute('data-theme', 'night');
    });
    await frames(page, 3);
    expect(await page.evaluate(() => window.axr.fired())).toBe(settled + 1);
    // An attribute outside the list does not count.
    await page.evaluate(() => document.documentElement.setAttribute('lang', 'fr'));
    await frames(page, 3);
    expect(await page.evaluate(() => window.axr.fired())).toBe(settled + 1);

    await page.evaluate(() => window.axr.stopWatch());
    await page.evaluate(() => { document.documentElement.classList.toggle('y'); document.body.setAttribute('data-theme', 'day'); });
    await page.emulateMedia({ colorScheme: 'dark', forcedColors: 'active', contrast: 'more' });
    await frames(page, 4);
    expect(await page.evaluate(() => window.axr.fired())).toBe(settled + 1);
    await close(page);
  });
});

describe('forced colors (emulated)', () => {
  let page: Page;
  beforeAll(async () => {
    page = await open({ forcedColors: 'active' });
    await page.evaluate(() => { window.axr.mount('canvas', 20, 60); window.axr.mount('svg', 460, 60); window.axr.mountText(20, 380); });
  });
  afterAll(async () => { await close(page); });

  it('is detected, and every paint is a system color', async () => {
    const t = await page.evaluate(() => window.axr.theme(0));
    expect(t.theme.forcedColors).toBe(true);
    expect(new Set(t.theme.paints.series).size).toBe(1);
    expect(contrastRatio(parseColor(t.theme.paints.series[0]!)!, parseColor(t.theme.paints.tokens.background)!)).toBeGreaterThanOrEqual(4.5);
    // An author color is set aside for the system colors.
    const authored = await page.evaluate(() => window.axr.theme(window.axr.mount('svg', 460, 380, { keys: ['Direct'], colors: { Direct: 'rgb(200, 0, 0)' } })));
    expect(authored.bindings.series).toEqual(['var(--axylo-series-1)']);
    expect(authored.theme.paints.series[0]).toBe(t.theme.paints.series[0]);
  });

  for (const [kind, x] of [['canvas', 20], ['svg', 460]] as const) {
    it(`${kind}: marks are visible against the background and lines use the contrast dash`, async () => {
      const img = await shot(page, x, 60, 400, 300);
      const background = at(img, 130, 105);
      expect(contrast(at(img, 85, 50), background)).toBeGreaterThanOrEqual(3);
      expect(contrast(at(img, 210, 220), background)).toBeGreaterThanOrEqual(3);
      expect(contrast(at(img, 300, 260), background)).toBeGreaterThanOrEqual(3);
      // Dashes [6, 4] along the solid-in-normal-mode segment at y 120: gaps of background appear.
      let gaps = 0;
      for (let px = 165; px < 375; px++) if (diff(at(img, px, 120), background) <= 10) gaps++;
      expect(gaps).toBeGreaterThan(50);
      expect(gaps).toBeLessThan(130);
    });
  }

  it('svg: the contrast pattern comes from the stylesheet, not a redraw', async () => {
    expect(await page.evaluate(() => window.axr.svgDash(1))).toBe('6px, 4px');
    expect(await page.evaluate(() => window.axr.draws(1))).toBe(1);
  });

  it('text is visible against the background', async () => {
    const img = await shot(page, 20, 380, 400, 300);
    const background = at(img, 300, 250);
    // "1,250 kWh", end-anchored at (380, 50).
    expect(ink(img, 300, 40, 382, 60, background)).toBeGreaterThan(20);
    let best = 1;
    for (let y = 40; y < 60; y++) for (let x = 300; x < 382; x++) best = Math.max(best, contrast(at(img, x, y), background));
    expect(best).toBeGreaterThanOrEqual(4.5);
  });
});

describe('prefers-contrast: more (emulated)', () => {
  it('both renderers switch to the contrast dash; canvas through the resolved theme, svg through CSS', async () => {
    const page = await open({ contrast: 'more' });
    await page.evaluate(() => { window.axr.mount('canvas', 20, 60); window.axr.mount('svg', 460, 60); });
    expect((await page.evaluate(() => window.axr.theme(0))).theme.moreContrast).toBe(true);
    expect(await page.evaluate(() => window.axr.svgDash(1))).toBe('6px, 4px');
    for (const x of [20, 460]) {
      const img = await shot(page, x, 60, 400, 300);
      let gaps = 0;
      for (let px = 165; px < 375; px++) if (diff(at(img, px, 120), [255, 255, 255]) <= 10) gaps++;
      expect(gaps, `at ${x}`).toBeGreaterThan(50);
    }
    await close(page);
  });
});

describe('author colors (spec DX6)', () => {
  it('colors: { Direct: "var(--brand)" } stays live in SVG: changing --brand recolors with no draw call', async () => {
    const page = await open();
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--brand', 'rgb(200, 0, 0)');
      window.axr.mount('svg', 20, 60, { keys: ['Direct'], colors: { Direct: 'var(--brand)' } });
    });
    const t = await page.evaluate(() => window.axr.theme(0));
    expect(t.bindings.series).toEqual(['var(--brand)']);
    expect(t.theme.paints.series).toEqual(['rgb(200, 0, 0)']);
    expect(diff(at(await shot(page, 20, 60, 400, 300), 85, 50), [200, 0, 0])).toBeLessThanOrEqual(8);
    await page.evaluate(() => document.documentElement.style.setProperty('--brand', 'rgb(0, 0, 200)'));
    await frames(page, 2);
    expect(diff(at(await shot(page, 20, 60, 400, 300), 85, 50), [0, 0, 200])).toBeLessThanOrEqual(8);
    expect(await page.evaluate(() => window.axr.draws(0))).toBe(1);
    await close(page);
  });
});

describe('ensureStyles', () => {
  it('adds one constructable stylesheet however often it is called, and no <style> element', async () => {
    const page = await open();
    const r = await page.evaluate(() => {
      const styles = document.querySelectorAll('style').length;
      const first = window.axr.ensureStyles();
      const second = window.axr.ensureStyles();
      return { first, second, styles, after: document.querySelectorAll('style').length };
    });
    expect(r).toEqual({ first: 1, second: 1, styles: r.styles, after: r.styles });
    await close(page);
  });

  it('adds nothing when the page already loaded the standalone stylesheet', async () => {
    const page = await open();
    await page.evaluate(() => {
      const s = document.createElement('style');
      s.textContent = window.axr.css;
      document.head.appendChild(s);
    });
    expect(await page.evaluate(() => window.axr.ensureStyles())).toBe(0);
    await page.evaluate(() => window.axr.mount('svg', 20, 60));
    expect(await page.evaluate(() => document.adoptedStyleSheets.length)).toBe(0);
    const img = await shot(page, 20, 60, 400, 300);
    expect(diff(at(img, 85, 50), rgb(LIGHT.series[0]!))).toBeLessThanOrEqual(8);
    await close(page);
  });
});
