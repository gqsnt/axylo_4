import { afterAll, beforeAll, expect, it } from 'vitest';
import { start, stop } from '../harness';
import { create, plotBox, settle } from './final-util';
import { chartPage, closePage } from './util';

beforeAll(start);
afterAll(stop);

const line = {
  title: 'Daily values', data: Array.from({ length: 101 }, (_, x) => ({ x, y: x })), x: 'x', y: 'y',
};

it('uses the theme text and font on the open table and the font on the title', async () => {
  const page = await chartPage({ css: '#chart { color: black; font-family: serif; --axylo-background: black; --axylo-text: white; --axylo-font-family: monospace; }' });
  await create(page, 'line', line);
  await page.getByRole('button', { name: 'View as table' }).click();
  expect(await page.locator('.axylo-title').evaluate(el => getComputedStyle(el).fontFamily)).toBe('monospace');
  expect(await page.locator('.axylo-table').evaluate(el => {
    const style = getComputedStyle(el);
    return [style.color, style.backgroundColor, style.fontFamily];
  })).toEqual(['rgb(255, 255, 255)', 'rgb(0, 0, 0)', 'monospace']);
  expect(await closePage(page)).toEqual([]);
});

it('gives a pinned tooltip a heavier border and underlines its paging button', async () => {
  const page = await chartPage();
  const data = Array.from({ length: 9 }, () => ({ x: 5, y: 5 }));
  await create(page, 'scatter', {
    title: 'Coincident points', data, x: { field: 'x', domain: [0, 10] }, y: { field: 'y', domain: [0, 10] },
  });
  const plot = await plotBox(page);
  await page.mouse.click(plot.x + plot.width / 2, plot.y + plot.height / 2);
  await settle(page);
  const pinned = page.locator('.axylo-tooltip.axylo-tooltip-pinned');
  expect(await pinned.evaluate(el => getComputedStyle(el).borderTopWidth)).toBe('2px');
  expect(await pinned.locator('button.axylo-tooltip-more').evaluate(el => getComputedStyle(el).textDecorationLine)).toBe('underline');
  expect(await closePage(page)).toEqual([]);
});

it('clears the jump error and its description as soon as the field is edited', async () => {
  const page = await chartPage();
  await create(page, 'line', line);
  await page.getByRole('button', { name: 'View as table' }).click();
  const field = page.locator('.axylo-jump-field');
  const error = page.locator('.axylo-jump-error');
  await field.fill('unknown');
  await field.press('Enter');
  expect(await field.getAttribute('aria-invalid')).toBe('true');
  expect(await field.evaluate(el => getComputedStyle(el).borderTopWidth)).toBe('2px');
  expect(await error.textContent()).toContain('unknown');
  expect(await field.getAttribute('aria-describedby')).toBe(await error.getAttribute('id'));
  await field.press('Backspace');
  expect(await field.getAttribute('aria-invalid')).toBeNull();
  expect(await field.getAttribute('aria-describedby')).toBeNull();
  expect(await error.textContent()).toBe('');
  expect(await closePage(page)).toEqual([]);
});

it('uses the muted color on Zoom out at full view', async () => {
  const page = await chartPage({ css: '#chart { --axylo-muted: #555; }' });
  await create(page, 'line', { ...line, zoom: true });
  const control = page.getByRole('button', { name: 'Zoom out', exact: true });
  expect(await control.getAttribute('aria-disabled')).toBe('true');
  expect(await control.evaluate(el => getComputedStyle(el).color)).toBe('rgb(85, 85, 85)');
  expect(await closePage(page)).toEqual([]);
});
