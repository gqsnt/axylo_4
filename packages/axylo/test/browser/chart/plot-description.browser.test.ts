import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { start, stop } from '../harness';
import { create, settle } from './final-util';
import { chartPage, closePage } from './util';

beforeAll(start);
afterAll(stop);

const POINTS = 'Left and right arrows move between points along x. Enter selects.';
const SLICES = 'Arrow keys move between slices. Enter selects.';
const SERIES = 'Up and down arrows move between series.';
const ZOOM = 'Plus and minus zoom. Press 0 to reset. Hold Shift with left or right to pan the zoomed view.';
const line = { title: 'Trend', x: 'x', y: 'y', data: [1, 2, 3, 4].map(x => ({ x, y: 2 * x })) };
const twoSeries = { ...line, series: 's', data: line.data.flatMap(row => [{ ...row, s: 'A' }, { ...row, s: 'B', y: row.y + 1 }]) };
const bar = { ...line, title: 'By quarter', data: line.data.map(row => ({ ...row, x: `Q${row.x}` })) };
const donut = { title: 'Slices', label: 'label', value: 'y', data: [{ label: 'A', y: 2 }, { label: 'B', y: 4 }] };

const plot = (page: Page) => page.locator('#chart .axylo-proxy');
const zoomIn = (page: Page) => page.getByRole('button', { name: 'Zoom in', exact: true });
const description = (page: Page) => plot(page).evaluate(el => document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent);

it.each([
  ['line with two series', 'line', twoSeries, `${POINTS} ${SERIES} ${ZOOM}`, true],
  ['line with one series', 'line', line, `${POINTS} ${ZOOM}`, true],
  ['category bar', 'bar', bar, POINTS, false],
  ['donut', 'donut', donut, SLICES, false],
] as const)('%s describes the keys its plot offers (A2, I3)', async (_name, kind, options, expected, zoom) => {
  const page = await chartPage();
  await create(page, kind, options);
  expect(await description(page)).toBe(expected);
  expect(await zoomIn(page).count()).toBe(zoom ? 1 : 0);
  expect(await closePage(page)).toEqual([]);
});

it('updates zoom help in both directions without rewriting the focused datum’s value text', async () => {
  const page = await chartPage();
  await create(page, 'line', twoSeries);
  await plot(page).focus();
  expect(await description(page)).toBe(`${POINTS} ${SERIES} ${ZOOM}`);

  for (const zoom of [false, true]) {
    const valueTextWrites = await plot(page).evaluate(async (el, zoom) => {
      const changes: MutationRecord[] = [];
      const observer = new MutationObserver(records => changes.push(...records));
      observer.observe(el, { attributes: true, attributeFilter: ['aria-valuetext'] });
      window.charts[0]!.update({ zoom });
      await window.charts[0]!.__bench.ready();
      await window.nextFrames(2);
      changes.push(...observer.takeRecords());
      observer.disconnect();
      return changes.length;
    }, zoom);
    expect(await description(page)).toBe(zoom ? `${POINTS} ${SERIES} ${ZOOM}` : `${POINTS} ${SERIES}`);
    expect(await zoomIn(page).count()).toBe(zoom ? 1 : 0);
    expect(await plot(page).evaluate(el => el === document.activeElement)).toBe(true);
    expect(valueTextWrites).toBe(0);
  }
  expect(await closePage(page)).toEqual([]);
});

it('removes and restores the series instructions as the legend hides and shows a series', async () => {
  const page = await chartPage();
  await create(page, 'line', twoSeries);
  const series = page.getByRole('button', { name: 'B', exact: true });
  expect(await description(page)).toBe(`${POINTS} ${SERIES} ${ZOOM}`);
  await series.press('Space');
  await settle(page);
  expect(await series.getAttribute('aria-pressed')).toBe('false');
  expect(await description(page)).toBe(`${POINTS} ${ZOOM}`);
  await series.press('Space');
  await settle(page);
  expect(await series.getAttribute('aria-pressed')).toBe('true');
  expect(await description(page)).toBe(`${POINTS} ${SERIES} ${ZOOM}`);
  expect(await closePage(page)).toEqual([]);
});

it('preserves a legacy translation and marks built-in instruction sentences as English (A10)', async () => {
  const page = await chartPage();
  await page.evaluate(() => { document.documentElement.lang = 'de'; });
  await create(page, 'line', { ...twoSeries, messages: { plotInstructions: 'Eigene Tastaturhilfe.' } });
  expect(await description(page)).toBe('Eigene Tastaturhilfe.');
  await page.evaluate(() => window.charts[0]!.update({ messages: { seriesInstructions: 'Mit den Pfeiltasten die Reihe wechseln.' } }));
  await settle(page);
  expect(await description(page)).toBe(`${POINTS} Mit den Pfeiltasten die Reihe wechseln. ${ZOOM}`);
  const languages = await plot(page).evaluate(el => {
    const instructions = document.getElementById(el.getAttribute('aria-describedby') ?? '');
    return Array.from(instructions?.children ?? [], part => part.closest('[lang]')?.getAttribute('lang'));
  });
  expect(languages).toEqual(['en', 'de', 'en']);
  expect(await closePage(page)).toEqual([]);
});
