import { afterAll, beforeAll, expect, it } from 'vitest';
import { DARK, LIGHT } from '../../../src/theme/palette';
import { ENGINE, start, stop } from '../harness';
import { startWithShortTmp, stopWithShortTmp } from '../acceptance/short-tmp';
import { axe } from '../a11y/util';
import { chartPage, closePage, hex } from './util';

// A deep runner TMPDIR is too long for Chrome's socket on Linux; see acceptance/short-tmp.ts.
beforeAll(() => startWithShortTmp(start, { engine: ENGINE }));
afterAll(() => stopWithShortTmp(stop));

it('draws unequal bins, reads intervals by pointer and keyboard, zooms and exposes the data table', async () => {
  const page = await chartPage();
  await page.evaluate(async () => {
    const main = document.createElement('main');
    document.body.append(main);
    main.innerHTML = '<h1>Measurements</h1>';
    main.append(document.querySelector('#chart')!);
    const chart = window.Axylo.histogram!('#chart', {
      title: { text: 'Response times', level: 2 }, data: { columns: { ms: Float64Array.of(0, 1, 2, 4, 10) } },
      x: 'ms', bins: [0, 2, 4, 10],
    });
    chart.on('select', value => { document.body.dataset.selected = JSON.stringify(value); });
    window.charts = [chart];
    await chart.__bench.ready();
  });
  const bars = page.locator('#chart .axylo-svg g > rect');
  expect(await bars.count()).toBe(3);
  const first = (await bars.first().boundingBox())!;
  const last = (await bars.last().boundingBox())!;
  expect(last.width + 1).toBeCloseTo(3 * (first.width + 1), 0);
  await page.mouse.move(last.x + 2, last.y + last.height / 2);
  const tooltip = page.locator('.axylo-tooltip');
  await tooltip.waitFor({ state: 'visible' });
  expect(await tooltip.textContent()).toContain('4–10');
  const plot = page.getByRole('slider');
  await plot.focus();
  await plot.press('Home');
  await plot.press('ArrowRight');
  expect(await plot.getAttribute('aria-valuetext')).toContain('2–4');
  await plot.press('Enter');
  expect(await page.evaluate(() => JSON.parse(document.body.dataset.selected!))).toMatchObject({ x: 3, y: 1, row: null });
  await plot.press('Escape');
  await tooltip.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.evaluate(() => window.charts[0]!.__bench.ready());
  const [lo, hi] = (await page.evaluate(() => window.charts[0]!.__bench.describe().xDomain))!;
  expect(hi! - lo!).toBe(5);
  await page.evaluate(async () => {
    window.charts[0]!.zoom([2.5, 7.5]);
    await window.charts[0]!.__bench.ready();
  });
  await page.getByRole('button', { name: 'View as table' }).click();
  expect(await page.getByRole('rowheader').allTextContents()).toEqual(['2–4', '4–10']);
  expect(await page.getByRole('cell').allTextContents()).toEqual(['1', '2']);
  expect((await axe(page)).violations).toEqual([]);
  await page.evaluate(async () => {
    window.charts[0]!.update({ compact: true });
    await window.charts[0]!.__bench.ready();
  });
  expect(await page.getByRole('img', { name: 'Response times' }).count()).toBe(1);
  expect(await page.getByRole('slider').count()).toBe(0);
  expect(await bars.count()).toBe(3);
  expect((await axe(page)).violations).toEqual([]);
  expect(await closePage(page)).toEqual([]);
});

it('resizes across wide, narrow strip, and too-small widths without label overlap or focus loss (histogram-resize-test)', async () => {
  const page = await chartPage({ css: '#chart { width: 640px; height: 320px; }' });
  try {
    await page.evaluate(async () => {
      const chart = window.Axylo.histogram!('#chart', {
        title: 'Latencies',
        data: { columns: { ms: Float64Array.of(0, 1, 2, 3, 5, 6, 8, 9, 10) } },
        x: 'ms',
        bins: [0, 2, 5, 10],
      });
      window.charts = [chart];
      await chart.__bench.ready();
      await window.nextFrames(2);
    });
    const plot = page.locator('#chart .axylo-proxy');
    await plot.focus();
    await plot.press('Home');
    await plot.press('ArrowRight');
    const focusedText = (await plot.getAttribute('aria-valuetext'))!;
    expect(focusedText).toContain('2–5');
    expect(await page.locator('#chart .axylo-tooltip').isVisible()).toBe(true);

    // Narrow to 220px: switches from floating tooltip to readout strip while keeping focus and zero label overlap.
    await page.evaluate(async () => {
      document.getElementById('chart')!.style.width = '220px';
      await window.charts[0]!.__bench.ready();
      await window.nextFrames(3);
    });
    expect(await page.evaluate(() => document.activeElement?.classList.contains('axylo-proxy') ?? false)).toBe(true);
    expect(await plot.getAttribute('aria-valuetext')).toBe(focusedText);
    expect(await page.locator('#chart .axylo-tooltip').isVisible()).toBe(false);
    expect(await page.locator('#chart .axylo-readout').isVisible()).toBe(true);
    expect(await page.locator('#chart .axylo-readout').textContent()).toContain('2–5');
    const narrowOverlaps = await page.evaluate(() => {
      const boxes = [...document.querySelectorAll('#chart .axylo-label')]
        .filter(el => (el.textContent ?? '').trim() !== '')
        .map(el => el.getBoundingClientRect())
        .filter(b => b.width > 0 && b.height > 0);
      let count = 0;
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!, b = boxes[j]!;
          if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) count++;
        }
      }
      return count;
    });
    expect(narrowOverlaps).toBe(0);

    // Too small (100x70): enters L8 fallback cleanly without throwing and reports AX142.
    await page.evaluate(async () => {
      const el = document.getElementById('chart')!;
      el.style.width = '100px';
      el.style.height = '70px';
      await window.charts[0]!.__bench.ready();
      await window.nextFrames(3);
    });
    expect(await page.evaluate(() => window.charts[0]!.diagnostics.some(d => d.code === 'AX142'))).toBe(true);

    // Restore to 640x320: plot recovers with all 3 bars and floating tooltip responds to keyboard focus.
    await page.evaluate(async () => {
      const el = document.getElementById('chart')!;
      el.style.width = '640px';
      el.style.height = '320px';
      await window.charts[0]!.__bench.ready();
      await window.nextFrames(3);
    });
    expect(await page.locator('#chart .axylo-svg g > rect').count()).toBe(3);
    await plot.focus();
    await plot.press('Home');
    expect(await page.locator('#chart .axylo-tooltip').isVisible()).toBe(true);
    expect(await page.locator('#chart .axylo-tooltip').textContent()).toContain('0–2');
    expect(await closePage(page)).toEqual([]);
  } catch (error) {
    await closePage(page).catch(() => {});
    throw error;
  }
});

it('paints histogram across light, dark, forced-colors, and custom color override with zero axe violations (histogram-theme-test)', async () => {
  const page = await chartPage({ css: ':root { color-scheme: light dark; }' });
  try {
    await page.evaluate(async () => {
      const main = document.createElement('main');
      document.body.append(main);
      main.innerHTML = '<h1>Histogram Theme</h1>';
      main.append(document.querySelector('#chart')!);
      const chart = window.Axylo.histogram!('#chart', {
        title: { text: 'Distribution', level: 2 },
        data: { columns: { ms: Float64Array.of(0, 1, 2, 4, 8, 10) } },
        x: 'ms',
        bins: [0, 2, 5, 10],
      });
      window.charts = [chart];
      await chart.__bench.ready();
      await window.nextFrames(2);
    });
    const barColor = () => page.evaluate(() => {
      const rect = document.querySelector<SVGRectElement>('#chart svg.axylo-svg .axylo-scene g > rect')!;
      const raw = getComputedStyle(rect).fill;
      return raw.match(/\d+/g)!.slice(0, 3).map(Number);
    });
    expect(await barColor()).toEqual([...hex(LIGHT.series[0]!)]);
    expect((await axe(page)).violations).toEqual([]);

    // Dark scheme: histogram bars follow the dark palette.
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.evaluate(async () => { await window.nextFrames(3); });
    expect(await barColor()).toEqual([...hex(DARK.series[0]!)]);
    expect((await axe(page)).violations).toEqual([]);

    // Emulated forced-colors: bars stay rendered and axe stays clean.
    await page.emulateMedia({ colorScheme: 'light', forcedColors: 'active' });
    await page.evaluate(async () => { await window.nextFrames(3); });
    expect(await page.locator('#chart .axylo-svg g > rect').count()).toBe(3);
    expect((await axe(page)).violations).toEqual([]);

    // Custom CSS token (--axylo-series-1) and colors override are honoured on histogram marks.
    await page.emulateMedia({ colorScheme: 'light', forcedColors: 'none' });
    await page.evaluate(async () => {
      document.getElementById('chart')!.style.setProperty('--axylo-series-1', '#654321');
      await window.nextFrames(2);
    });
    expect(await barColor()).toEqual([0x65, 0x43, 0x21]);
    await page.evaluate(async () => {
      window.charts[0]!.update({ colors: { Count: '#123456' } });
      await window.charts[0]!.__bench.ready();
      await window.nextFrames(2);
    });
    expect(await barColor()).toEqual([0x12, 0x34, 0x56]);
    expect(await closePage(page)).toEqual([]);
  } catch (error) {
    await closePage(page).catch(() => {});
    throw error;
  }
});
