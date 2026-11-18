/**
 * Spec L4 on a prefers-color-scheme change (seventh pass): on a page that gives the chart a color-scheme of
 * `light dark`, the SVG marks have the dark colours in the first animation frame after the device turns
 * dark, without waiting for the media query's change event (which Chrome dispatches a frame later).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { start, stop } from '../harness';
import { DARK, LIGHT } from '../../../src/theme/palette';
import { chartPage, closePage, hex } from '../chart/util';

beforeAll(start);
afterAll(stop);

describe('L4: the used colour scheme reaches the marks in the frame it changes', () => {
  it('color-scheme: light dark, the device turns dark: the first frame paints the marks dark', async () => {
    const page = await chartPage({ css: ':root { color-scheme: light dark; }' });
    await page.evaluate(async () => {
      const chart = window.Axylo.line!('#chart', { title: 'S', data: [0, 1, 2].map(x => ({ x, y: x })), x: 'x', y: 'y', __renderer: 'svg' });
      window.charts.push(chart);
      await chart.__bench.ready();
      await window.nextFrames(2);
    });
    const mark = () => page.evaluate(() => {
      const el = [...document.querySelectorAll<SVGElement>('#chart svg.axylo-svg .axylo-scene *')].find(e => /--axylo-series-color-1/.test(e.style.getPropertyValue('color')))!;
      return getComputedStyle(el).color.match(/\d+/g)!.slice(0, 3).map(Number);
    });
    expect(await mark()).toEqual([...hex(LIGHT.series[0]!)]);
    await page.emulateMedia({ colorScheme: 'dark' });
    const first = await page.evaluate(() => new Promise<{ matches: boolean; rgb: number[] }>(resolve => requestAnimationFrame(() => {
      const el = [...document.querySelectorAll<SVGElement>('#chart svg.axylo-svg .axylo-scene *')].find(e => /--axylo-series-color-1/.test(e.style.getPropertyValue('color')))!;
      resolve({ matches: matchMedia('(prefers-color-scheme: dark)').matches, rgb: getComputedStyle(el).color.match(/\d+/g)!.slice(0, 3).map(Number) });
    })));
    expect(first.matches).toBe(true);
    expect(first.rgb).toEqual([...hex(DARK.series[0]!)]);
    // And back, in the same way.
    await page.emulateMedia({ colorScheme: 'light' });
    const back = await page.evaluate(() => new Promise<number[]>(resolve => requestAnimationFrame(() => {
      const el = [...document.querySelectorAll<SVGElement>('#chart svg.axylo-svg .axylo-scene *')].find(e => /--axylo-series-color-1/.test(e.style.getPropertyValue('color')))!;
      resolve(getComputedStyle(el).color.match(/\d+/g)!.slice(0, 3).map(Number));
    })));
    expect(back).toEqual([...hex(LIGHT.series[0]!)]);
    expect(await closePage(page)).toEqual([]);
  });

  it('color-scheme normal keeps the scheme the chart resolved: light text on a dark page gives dark marks', async () => {
    const page = await chartPage({ css: 'body { background: #121212; color: #e8e8e8; }' });
    await page.evaluate(async () => {
      const chart = window.Axylo.line!('#chart', { title: 'S', data: [0, 1, 2].map(x => ({ x, y: x })), x: 'x', y: 'y', __renderer: 'svg' });
      window.charts.push(chart);
      await chart.__bench.ready();
    });
    const scheme = await page.evaluate(() => document.querySelector('#chart figure')!.getAttribute('data-axylo-scheme'));
    expect(scheme).toBe('dark');
    expect(await closePage(page)).toEqual([]);
  });
});
