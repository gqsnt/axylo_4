import { afterAll, beforeAll, expect, it } from 'vitest';
import { start, stop } from '../harness';
import { chartPage, closePage } from './util';
import { create, settle } from './final-util';

beforeAll(start);
afterAll(stop);

const options = {
  title: 'Values', data: Array.from({ length: 201 }, (_, x) => ({ x, y: 1234.5 + x })), x: 'x', y: 'y',
};

it('uses the shadow tree for styles, generated IDs and the table caption, and inherits locale through the host', async () => {
  const page = await chartPage();
  const result = await page.evaluate(async opts => {
    document.documentElement.lang = 'de';
    const host = document.querySelector('#chart')!;
    const shadow = host.attachShadow({ mode: 'open' });
    const collision = shadow.appendChild(document.createElement('span'));
    collision.id = 'axylo-1-t';
    const label = shadow.appendChild(document.createElement('span'));
    label.id = 'external';
    label.textContent = 'Messwerte';
    const target = shadow.appendChild(document.createElement('section'));
    target.style.height = '350px';
    const chart = window.Axylo.line!(target, { ...opts, labelledBy: label.id });
    await chart.__bench.ready();
    return {
      id: target.querySelector('figure')!.id,
      position: getComputedStyle(target.querySelector('.axylo-svg')!).position,
    };
  }, options);
  expect(result.position).toBe('absolute');
  expect(result.id).toBeTruthy();
  expect(result.id).not.toBe('axylo-1');
  await page.getByRole('button', { name: 'View as table' }).click();
  expect(await page.locator('caption').textContent()).toBe('Messwerte');
  const cell = page.locator('tbody tr').first().locator('td').first();
  expect(await cell.textContent()).toBe('1.234,5');
  await page.locator('#chart').evaluate(host => { host.setAttribute('lang', 'en-US'); });
  await expect.poll(() => cell.textContent()).toBe('1,234.5');
  expect(await closePage(page)).toEqual([]);
});

it('resolves backdrop and invalid background overrides through a slot and checks contrast over an opaque override', async () => {
  const page = await chartPage();
  await page.evaluate(() => {
    const target = document.querySelector('#chart')!;
    const host = document.createElement('div');
    target.before(host);
    host.appendChild(target);
    const section = host.attachShadow({ mode: 'open' }).appendChild(document.createElement('section'));
    section.style.cssText = 'background: black; color: white; --axylo-background: nonsense';
    section.appendChild(document.createElement('slot'));
  });
  await create(page, 'line', { ...options, colors: { y: 'white' } });
  const figure = page.locator('figure');
  expect(await figure.getAttribute('data-axylo-scheme')).toBe('dark');
  expect(await figure.evaluate(el => (el as HTMLElement).style.getPropertyValue('--axylo-backdrop'))).toBe('rgb(0, 0, 0)');
  await page.locator('section').evaluate(el => {
    el.style.cssText = 'background: linear-gradient(black, blue); --axylo-background: white';
  });
  await expect.poll(() => page.evaluate(() => window.charts[0]!.diagnostics.map(d => d.code))).toContain('AX141');
  expect(await closePage(page)).toEqual([]);
});

it('replaces an inactive standalone sheet and observes the title size floor', async () => {
  const page = await chartPage({ css: '#chart {font-size: 8px}' });
  await create(page, 'line', options);
  await page.evaluate(() => {
    window.charts.pop()!.destroy();
    document.querySelector<HTMLLinkElement>('link[rel=stylesheet]')!.media = 'print';
  });
  await create(page, 'line', options);
  expect(await page.locator('.axylo-title').evaluate(el => getComputedStyle(el).fontSize)).toBe('12px');
  expect(await page.locator('.axylo-svg').evaluate(el => getComputedStyle(el).position)).toBe('absolute');
  expect(await closePage(page)).toEqual([]);
});

it('defers a collapsed chart, then exposes readable paged data and stable live regions in a short card', async () => {
  const page = await chartPage({ css: '#chart {width: 320px; height: 0}' });
  const codes = await page.evaluate(async opts => {
    const chart = window.Axylo.line!('#chart', opts);
    window.charts.push(chart);
    await window.nextFrames(3);
    return chart.diagnostics.map(d => d.code);
  }, options);
  expect(codes).not.toContain('AX142');
  await page.locator('#chart').evaluate(el => { el.style.height = '90px'; });
  await page.getByRole('button', { name: 'View as table' }).click();
  await settle(page);
  expect((await page.locator('.axylo-table-scroll').boundingBox())!.height).toBeGreaterThan(24);
  const announcement = page.locator('.axylo-pager [aria-live=polite]');
  expect(await announcement.textContent()).toBe('');
  await page.getByRole('button', { name: 'Next page' }).click();
  expect(await announcement.textContent()).toBe('Page 2 of 3');
  const field = page.locator('.axylo-jump-field');
  await field.fill('unknown');
  await field.press('Enter');
  expect(await field.evaluate(el => el === document.activeElement)).toBe(true);
  expect(await page.locator('.axylo-jump-error[role=status]').isVisible()).toBe(true);
  expect(await closePage(page)).toEqual([]);
});

it('installs styles again when a detached chart reconnects inside a shadow root', async () => {
  const page = await chartPage();
  await create(page, 'line', options);
  await page.evaluate(async () => {
    const target = document.querySelector<HTMLElement>('#chart')!;
    target.style.cssText = 'width: 500px; height: 320px';
    target.remove();
    await window.nextFrames(3);
    const host = document.body.appendChild(document.createElement('div'));
    host.attachShadow({ mode: 'open' }).appendChild(target);
    await window.nextFrames(3);
  });
  expect(await page.locator('.axylo-svg').evaluate(el => getComputedStyle(el).position)).toBe('absolute');
  expect(await closePage(page)).toEqual([]);
});

it('wraps an unbroken legend label and shows keyboard focus on legend and tooltip choices', async () => {
  const page = await chartPage({ css: '#chart {width: 320px; height: 650px}' });
  const name = 'abc'.repeat(30);
  await create(page, 'line', { ...options, y: [name, 'y'], data: options.data.map(row => ({ ...row, [name]: row.y })) });
  const button = page.locator('.axylo-legend-entry').filter({ hasText: name });
  expect(await button.evaluate(el => {
    const chart = el.closest('figure')!.getBoundingClientRect();
    const label = el.querySelector('.axylo-control-label')!;
    return el.getBoundingClientRect().right <= chart.right && label.scrollWidth <= label.clientWidth;
  })).toBe(true);
  await page.keyboard.press('Tab');
  for (const [choice, offset] of [['legend', '1px'], ['tooltip', '-2px']] as const) {
    const outline = await page.locator('figure').evaluate((figure, choice) => {
      const control = figure.appendChild(document.createElement('button'));
      control.className = 'axylo-' + choice + '-choice';
      control.focus();
      const style = getComputedStyle(control);
      return [style.outlineStyle, style.outlineWidth, style.outlineOffset];
    }, choice);
    expect(outline).toEqual(['solid', '2px', offset]);
  }
  expect(await closePage(page)).toEqual([]);
});
