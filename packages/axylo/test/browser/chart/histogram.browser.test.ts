import { afterAll, beforeAll, expect, it } from 'vitest';
import { start, stop } from '../harness';
import { axe } from '../a11y/util';
import { chartPage, closePage } from './util';

beforeAll(start);
afterAll(stop);

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
