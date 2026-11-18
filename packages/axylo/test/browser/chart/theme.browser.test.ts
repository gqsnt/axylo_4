/**
 * Light and dark from the page (spec L4), repaint on a runtime toggle for both renderers, and AX141 for an
 * author color with poor contrast (spec A5, 3.5). Colors are the default palette (src/theme/palette.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { start, stop } from '../harness';
import { DARK, LIGHT } from '../../../src/theme/palette';
import { chartPage, closePage, count, hex, shot } from './util';

beforeAll(start);
afterAll(stop);

async function create(page: Page, renderer: 'canvas' | 'svg', extra: Record<string, unknown> = {}): Promise<{ scheme: string | null; codes: string[] }> {
  return page.evaluate(async ([r, more]) => {
    const chart = window.Axylo.line!('#chart', {
      title: 'Theme', data: window.fx.trendRows(), x: { field: 'day', type: 'time', timeZone: 'UTC' }, y: 'sessions', series: 'channel', __renderer: r, ...more,
    });
    window.charts.push(chart);
    await chart.__bench.ready();
    return { scheme: document.querySelector('#chart figure')!.getAttribute('data-axylo-scheme'), codes: chart.diagnostics.map(d => d.code) };
  }, [renderer, extra] as const);
}

const seriesPixels = async (page: Page, color: string): Promise<number> => count((await shot(page, '#chart .axylo-plot')).img, hex(color), 40);

/** The first series' color as the page resolves it now (through the chart's own custom properties). */
async function resolvedSeries(page: Page): Promise<readonly [number, number, number]> {
  return page.evaluate(() => {
    const probe = document.querySelector('#chart figure')!.appendChild(document.createElement('span'));
    probe.style.color = 'var(--axylo-series-color-1)';
    const [r, g, b] = getComputedStyle(probe).color.match(/\d+/g)!.map(Number);
    probe.remove();
    return [r!, g!, b!] as const;
  });
}

describe('scheme from the page (spec L4)', () => {
  it('a page with color-scheme: dark draws the dark palette', async () => {
    const page = await chartPage({ css: ':root { color-scheme: dark; } body { background: #16181d; color: #e8eaee; }' });
    // The page sets the scheme: the defaults follow the browser's used scheme (light-dark()), so no attribute
    // fixes one (seventh pass); the painted colours say which it is.
    expect((await create(page, 'canvas')).scheme).toBeNull();
    expect(await seriesPixels(page, DARK.series[0]!)).toBeGreaterThan(200);
    expect(await closePage(page)).toEqual([]);
  });

  it('a class-toggled dark page without color-scheme is dark, from the inherited text color', async () => {
    const page = await chartPage({ css: 'html.dark body { background: #16181d; color: #e8eaee; }' });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    expect((await create(page, 'svg')).scheme).toBe('dark');
    expect(await seriesPixels(page, DARK.series[0]!)).toBeGreaterThan(200);
    expect(await closePage(page)).toEqual([]);
  });

  it('a light-only page under dark emulation stays light', async () => {
    const page = await chartPage({ colorScheme: 'dark', css: ':root { color-scheme: light; }' });
    expect((await create(page, 'canvas')).scheme).toBeNull();
    expect(await seriesPixels(page, LIGHT.series[0]!)).toBeGreaterThan(200);
    expect(await closePage(page)).toEqual([]);
  });

  for (const renderer of ['canvas', 'svg'] as const) {
    it(`toggling a dark class repaints within a frame, without rebuilding the scene (${renderer})`, async () => {
      const page = await chartPage({ css: 'html.dark body { background: #16181d; color: #e8eaee; }' });
      expect((await create(page, renderer)).scheme).toBe('light');
      const light = await resolvedSeries(page);
      const result = await page.evaluate(async () => {
        const chart = window.charts[0]!;
        const before = chart.__dev.stages();
        document.documentElement.classList.add('dark');
        // Let the attribute observer run, then read in the first frame after the toggle.
        await Promise.resolve();
        await new Promise(r => requestAnimationFrame(r));
        return { before, after: chart.__dev.stages(), scheme: document.querySelector('#chart figure')!.getAttribute('data-axylo-scheme') };
      });
      expect(result.scheme).toBe('dark');
      expect(result.after.theme).toBe(result.before.theme! + 1);
      expect(result.after.scene).toBe(result.before.scene);
      // The same call for both renderers: canvas needs it to repaint, SVG restyles through CSS anyway.
      expect(result.after.draw).toBe(result.before.draw + 1);
      expect(result.after.layout).toBe(result.before.layout);
      // Against each scheme's resolved color (not the palette file and a wide tolerance): the drawn pixels
      // are the dark one's and not the light one's. The two must differ beyond the tolerance for this to mean
      // anything, which is asserted too.
      const dark = await resolvedSeries(page);
      const pixels = (await shot(page, '#chart .axylo-plot')).img;
      expect(Math.max(...dark.map((v, i) => Math.abs(v - light[i]!)))).toBeGreaterThan(16);
      expect(count(pixels, dark, 6)).toBeGreaterThan(200);
      expect(count(pixels, light, 6)).toBeLessThan(20);
      expect(await closePage(page)).toEqual([]);
    });
  }
});

describe('contrast (spec A5, AX141)', () => {
  it('an author color with poor contrast raises AX141 after theme resolution, and strict does not throw for it', async () => {
    const page = await chartPage();
    const result = await create(page, 'svg', { strict: true, colors: { Direct: '#f4f4f4' } });
    expect(result.codes).toContain('AX141');
    const plain = await page.evaluate(async () => {
      const el = Object.assign(document.body.appendChild(document.createElement('div')), { style: 'width: 300px' });
      const chart = window.Axylo.line!(el, { title: 'Default colors', data: window.fx.trendRows(), x: 'day', y: 'sessions', series: 'channel' });
      await chart.__bench.ready();
      return chart.diagnostics.map(d => d.code);
    });
    expect(plain).not.toContain('AX141');
    expect(await closePage(page)).toEqual([]);
  });

  it('onDiagnostic receives AX141 when it is found', async () => {
    const page = await chartPage();
    const codes = await page.evaluate(async () => {
      const seen: string[] = [];
      const chart = window.Axylo.line!('#chart', { title: 'T', colors: { Direct: '#fafafa' }, onDiagnostic: (d: { code: string }) => seen.push(d.code), data: window.fx.trendRows(), x: 'day', y: 'sessions', series: 'channel' });
      await chart.__bench.ready();
      return seen;
    });
    expect(codes).toContain('AX141');
    expect(await closePage(page)).toEqual([]);
  });
});

describe('L4: the new scheme in the first frame after the page changes (sixth pass)', () => {
  it('a class on <html> that darkens the page: the series colour the marks resolve to is dark in the next animation frame', async () => {
    const page = await chartPage({ css: '.dk { background: #121212; color: #e8e8e8; }' });
    await page.evaluate(async () => {
      const chart = window.Axylo.line!('#chart', { title: 'T', data: [0, 1, 2].map(x => ({ x, y: x })), x: 'x', y: 'y' });
      window.charts.push(chart);
      await chart.__bench.ready();
    });
    const before = await resolvedSeries(page);
    const after = await page.evaluate(() => new Promise<number[]>(resolve => {
      document.documentElement.classList.add('dk');
      requestAnimationFrame(() => {
        const probe = document.querySelector('#chart figure')!.appendChild(document.createElement('span'));
        probe.style.color = 'var(--axylo-series-color-1)';
        const rgb = getComputedStyle(probe).color.match(/\d+/g)!.map(Number);
        probe.remove();
        resolve(rgb);
      });
    }));
    expect(after).not.toEqual([...before]);
    expect(after).toEqual([...hex(DARK.series[0]!)]);
    expect(await closePage(page)).toEqual([]);
  });
});
