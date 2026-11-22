/**
 * A chart inside a scaled ancestor (decision 0004 revision 3, rule 10): the plot is laid out at its own layout
 * size, whatever the scale, so the marks fill the plot element exactly, a pointer on a drawn datum picks it
 * and the tooltip's datum box sits on the drawn mark. Unscaled, sub-pixel sizes stay a scale of exactly 1.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { start, stop } from '../harness';
import { chartPage, closePage } from './util';

beforeAll(start);
afterAll(stop);

async function mount(page: Page, scale: number | null, width: string): Promise<void> {
  await page.evaluate(async ({ scale, width }) => {
    const chart = document.getElementById('chart')!;
    chart.style.width = width;
    chart.style.height = '320px';
    if (scale !== null) {
      const wrap = document.createElement('div');
      wrap.style.transform = `scale(${scale})`;
      wrap.style.transformOrigin = '0 0';
      chart.replaceWith(wrap);
      wrap.append(chart);
    }
    const c = window.Axylo.bar!('#chart', { title: 'S', data: Array.from({ length: 40 }, (_, i) => ({ x: `c${i}`, y: 10 + (i % 5) })), x: 'x', y: 'y' });
    window.charts.push(c);
    await c.__bench.ready();
    await window.nextFrames(2);
  }, { scale, width });
}

/** The drawn bars' rectangles in viewport pixels, left to right, and the plot element's. */
async function geometry(page: Page) {
  return page.evaluate(() => {
    const plot = document.querySelector('#chart .axylo-plot')!.getBoundingClientRect();
    const svg = document.querySelector('#chart svg.axylo-svg') as SVGSVGElement;
    const bars = [...svg.querySelectorAll('.axylo-scene rect')].map(r => r.getBoundingClientRect())
      .filter(b => b.width > 1 && b.height > 1).sort((a, b) => a.x - b.x).map(b => ({ x: b.x, y: b.y, width: b.width, height: b.height }));
    const layoutWidth = parseFloat(getComputedStyle(document.querySelector('#chart .axylo-plot')!).width);
    return { plot: { x: plot.x, y: plot.y, width: plot.width, height: plot.height }, bars, svgWidth: Number(svg.getAttribute('width')), layoutWidth };
  });
}

for (const scale of [1.015, 0.99]) {
  describe(`an ancestor scaled by ${scale}`, () => {
    it('the scene is laid out at the plot\'s layout width; the last bar is inside the plot element', async () => {
      const page = await chartPage();
      await mount(page, scale, '600px');
      const g = await geometry(page);
      expect(Math.abs(g.svgWidth - g.layoutWidth)).toBeLessThan(0.5);
      const last = g.bars.at(-1)!;
      expect(last.x + last.width).toBeLessThanOrEqual(g.plot.x + g.plot.width + 0.5);
      expect(await closePage(page)).toEqual([]);
    });

    it('a pointer at the last bars\' drawn centres picks them, and the tooltip names each', async () => {
      const page = await chartPage();
      await mount(page, scale, '600px');
      const g = await geometry(page);
      for (const k of [37, 38, 39]) {
        const b = g.bars[k]!;
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await page.evaluate(() => window.nextFrames(2));
        const title = await page.evaluate(() => document.querySelector('#chart .axylo-tooltip:not([hidden]) .axylo-tooltip-title, #chart .axylo-readout .axylo-tooltip-title')?.textContent ?? null);
        expect(title, `bar ${k}`).toBe(`c${k}`);
      }
      expect(await closePage(page)).toEqual([]);
    });
  });
}

describe('no transform, a sub-pixel width', () => {
  it('the scale stays exactly 1: the scene is laid out at the fractional layout width', async () => {
    const page = await chartPage();
    await mount(page, null, '600.4px');
    const g = await geometry(page);
    expect(Math.abs(g.svgWidth - g.layoutWidth)).toBeLessThan(0.01);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('readout mode with a large page font (decision 0004 rule 5)', () => {
  it('a strip two lines of 40 px text tall would leave the plot under 80 px: no strip, the plot stays, no floating tooltip', async () => {
    // The axis text is small (--axylo-font-size), the page's text large: estimated from the axis text, the strip
    // would be about 30 px; in its own font it is about 98 px (the verification review's numbers).
    const page = await chartPage({ css: 'html { font-size: 40px; } body { font-size: 40px; } #chart { --axylo-font-size: 12px; }' });
    await page.evaluate(async () => {
      const chart = document.getElementById('chart')!;
      chart.style.width = '900px';
      chart.style.height = '340px';
      const c = window.Axylo.line!('#chart', { title: 'F', data: Array.from({ length: 6 }, (_, i) => ({ x: i, y: i })), x: 'x', y: 'y' });
      window.charts.push(c);
      await c.__bench.ready();
      await window.nextFrames(2);
    });
    const state = await page.evaluate(() => {
      const fig = document.querySelector('#chart figure')!;
      const proxy = document.querySelector('#chart .axylo-proxy') as HTMLElement | null;
      const p = proxy?.getBoundingClientRect();
      return { strip: fig.classList.contains('axylo-readout-mode'), plotHeight: proxy && !proxy.hidden ? p!.height : 0 };
    });
    // The page is laid out so the unstripped plot is under 140 px: the strip (about 98 px) cannot fit beside 80 px.
    expect(state.plotHeight).toBeGreaterThanOrEqual(80);
    expect(state.plotHeight).toBeLessThan(140);
    expect(state.strip).toBe(false);
    const box = (await page.locator('#chart .axylo-proxy').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.evaluate(() => window.nextFrames(2));
    expect(await page.locator('#chart .axylo-tooltip').isVisible()).toBe(false);
    expect(await closePage(page)).toEqual([]);
  });
});
