/**
 * Review findings whose fix needs the stylesheet change (finding 13, and the stylesheet half of finding 6).
 * Expected to FAIL against the current packages/axylo/src/theme/css.ts until the token part is replaced by
 * the one in proposed-css.ts.
 *
 * With AXYLO_PROPOSED_CSS=1 the page loads the proposed token part (plus the current structure part) as a
 * standalone stylesheet instead, which checks that the proposal fixes them.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { start, stop } from '../harness';
import type {} from './entries/api';
import { at, close, diff, frames, open, shot } from './util';

beforeAll(start);
afterAll(stop);

describe('finding 13: page-level theming reaches the chart; component rules stay inside it', () => {
  it('a token set on :root recolors the marks of both renderers', async () => {
    const page = await open();
    await page.addStyleTag({ content: ':root { --axylo-axis: rgb(255, 0, 0); --axylo-series-1: rgb(0, 160, 0); }' });
    await page.evaluate(() => { window.axr.mount('canvas', 20, 60); window.axr.mount('svg', 460, 60); });
    for (const x of [20, 460]) {
      const img = await shot(page, x, 60, 400, 300);
      expect(diff(at(img, 300, 260), [255, 0, 0]), `axis at ${x}`).toBeLessThanOrEqual(3);
      expect(diff(at(img, 85, 50), [0, 160, 0]), `series at ${x}`).toBeLessThanOrEqual(8);
    }
    await close(page);
  });

  it('a page element named .axylo-text outside any chart is not positioned or made inert', async () => {
    const page = await open();
    await page.evaluate(() => {
      window.axr.ensureStyles();
      const own = document.createElement('p');
      own.className = 'axylo-text';
      own.id = 'own';
      document.body.appendChild(own);
    });
    const r = await page.evaluate(() => { const cs = getComputedStyle(document.getElementById('own')!); return [cs.position, cs.pointerEvents]; });
    expect(r).toEqual(['static', 'auto']);
    await close(page);
  });

  it('typography custom properties reach the text layer, and unset they inherit the page font', async () => {
    const page = await open();
    await page.evaluate(() => window.axr.mountText(20, 60));
    const family = (): Promise<string> => page.evaluate(() => getComputedStyle(document.querySelector('.axylo-text')!).fontFamily);
    expect(await family()).toBe('sans-serif');
    await page.evaluate(() => (document.querySelector('.axylo-text')!.parentElement as HTMLElement).style.setProperty('--axylo-font-family', 'serif'));
    expect(await family()).toBe('serif');
    await close(page);
  });
});

describe('finding 6: forced colors on and off on the same mounted SVG, overlay included', () => {
  it('a pinned series color gives way to a system color under forced colors and comes back after, with no draw call', async () => {
    const page = await open();
    await page.evaluate(() => {
      window.axr.mount('svg', 20, 60, { keys: ['s0'], colors: { s0: 'rgb(200, 0, 0)' } });
      window.axr.overlay(0, true);
    });
    const red: [number, number, number] = [200, 0, 0];
    let img = await shot(page, 20, 60, 400, 300);
    expect(diff(at(img, 85, 50), red)).toBeLessThanOrEqual(8);
    expect(diff(at(img, 355, 230), red)).toBeLessThanOrEqual(8);

    await page.emulateMedia({ forcedColors: 'active' });
    await frames(page, 2);
    img = await shot(page, 20, 60, 400, 300);
    for (const [x, y] of [[85, 50], [355, 230]] as const) expect(diff(at(img, x, y), red), `forced ${x},${y}`).toBeGreaterThan(100);
    // The canvas renderer gets the same answer from the resolved theme.
    const forced = await page.evaluate(() => window.axr.info(0));
    expect(forced.theme.paints.series[0]).not.toBe('rgb(200, 0, 0)');

    await page.emulateMedia({ forcedColors: 'none' });
    await frames(page, 2);
    img = await shot(page, 20, 60, 400, 300);
    expect(diff(at(img, 85, 50), red)).toBeLessThanOrEqual(8);
    expect(diff(at(img, 355, 230), red)).toBeLessThanOrEqual(8);
    expect(await page.evaluate(() => window.axr.draws(0))).toBe(1);
    await close(page);
  });
});
