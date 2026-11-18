/**
 * F8, rendered (spec 3.1): donut slices keep the given order, start at 12 o'clock and run clockwise (read
 * from the screenshot along the ring); the legend shows every slice's value and percentage as text, in
 * slice order; zero, null, negative, more than eight and all-zero slices each have their own outcome.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { start, stop } from '../harness';
import { axWithin, closePage, create, devPage, distance, pixel, resolveColors, ring, screenshot, settle, type RGB } from './util';
import { share, SPEND, withUnit } from './fixtures';

beforeAll(start);
afterAll(stop);

/** The colour of each legend entry's swatch, resolved by the page. */
async function legendColors(page: import('playwright-core').Page): Promise<RGB[]> {
  const css = await page.locator('#chart ul.axylo-legend-list > li svg.axylo-swatch').evaluateAll(els => els.map(e => getComputedStyle(e).color));
  return resolveColors(page, css);
}

async function sliceCount(page: import('playwright-core').Page): Promise<number> {
  // Every path of a donut's scene is a slice (the "Other" slice has its own muted colour).
  return page.evaluate(() => document.querySelectorAll('#chart svg.axylo-svg .axylo-scene path').length);
}

/** Each legend entry as "name value": its name and value parts joined by a space. */
async function legend(page: import('playwright-core').Page): Promise<string[]> {
  return page.locator('#chart ul.axylo-legend-list > li').evaluateAll(lis => lis.map(li =>
    [li.querySelector('.axylo-legend-name')?.textContent ?? '', li.querySelector('.axylo-legend-value')?.textContent ?? ''].join(' ').trim()));
}

describe('F8 donut geometry and legend', () => {
  it('F8 donut: slices keep the given order, start at 12 o\'clock and run clockwise: the ring at each slice\'s middle angle shows that slice\'s legend colour', async () => {
    const page = await devPage();
    await create(page, 'donut');
    const { img, box: plot } = await screenshot(page, '#chart .axylo-plot');
    const g = await ring(page);
    const colors = await legendColors(page);
    expect(colors).toHaveLength(4);
    const total = SPEND.values.reduce((a, b) => a + b, 0);
    const at = (degrees: number) => {
      const a = degrees * Math.PI / 180, r = g.outer * 0.85;
      return pixel(img, g.cx - plot.x + r * Math.sin(a), g.cy - plot.y - r * Math.cos(a));
    };
    let before = 0;
    SPEND.values.forEach((v, i) => {
      const mid = 360 * (before + v / 2) / total;
      before += v;
      const seen = at(mid);
      const nearest = colors.map(c => distance(c, seen)).indexOf(Math.min(...colors.map(c => distance(c, seen))));
      expect(nearest, `${SPEND.items[i]} at ${mid}°: ${seen}`).toBe(i);
      expect(distance(colors[i]!, seen), `${SPEND.items[i]} at ${mid}°`).toBeLessThanOrEqual(24);
    });
    // Just clockwise of 12 o'clock is the first slice; just anticlockwise of it, the last.
    expect(distance(at(3), colors[0]!)).toBeLessThanOrEqual(24);
    expect(distance(at(357), colors[3]!)).toBeLessThanOrEqual(24);
    expect(await closePage(page)).toEqual([]);
  });

  it('F8 donut: the legend shows every slice\'s value and percentage as text, in slice order, and is in the accessibility tree', async () => {
    const page = await devPage();
    await create(page, 'donut');
    const entries = await legend(page);
    expect(entries).toHaveLength(4);
    SPEND.items.forEach((item, i) => {
      const e = entries[i]!;
      expect(e.startsWith(item), e).toBe(true);
      expect(e).toContain(withUnit(SPEND.values[i]!, SPEND.unit));
      expect(e).toContain(share(SPEND.values[i]!));
    });
    const text = (await axWithin(page, '#chart ul.axylo-legend-list')).filter(n => n.role === 'StaticText').map(n => n.name).join(' ');
    for (const item of SPEND.items) expect(text).toContain(item);
    expect(text).toContain(share(1200));
    expect(await closePage(page)).toEqual([]);
  });

  it('F8 donut: a zero slice is listed without an arc; a null slice is listed as "No data", without an arc', async () => {
    const page = await devPage();
    await create(page, 'donut', { data: [{ item: 'Rent', spend: 1200 }, { item: 'Gifts', spend: 0 }, { item: 'Food', spend: 600 }, { item: 'Pets', spend: null }] });
    const entries = await legend(page);
    expect(entries.map(e => e.split(/\s/)[0])).toEqual(['Rent', 'Gifts', 'Food', 'Pets']);
    expect(entries[1]).toContain(withUnit(0, SPEND.unit));
    expect(entries[3]).toContain('No data');
    expect(entries[3]).not.toMatch(/\d/);
    expect(await sliceCount(page)).toBe(2);
    expect(await closePage(page)).toEqual([]);
  });

  it('F8 donut: a negative value is AX120 and the chart shows its error state inside the plot, with no slices', async () => {
    const page = await devPage();
    const built = await create(page, 'donut', { data: [{ item: 'Rent', spend: 1200 }, { item: 'Refund', spend: -50 }] });
    expect(built.diagnostics.filter(d => d.code === 'AX120').map(d => d.level)).toEqual(['error']);
    expect(await sliceCount(page)).toBe(0);
    const message = page.locator('#chart .axylo-plot .axylo-message');
    expect(await message.isVisible()).toBe(true);
    expect(((await message.textContent()) ?? '').trim()).not.toBe('');
    const text = (await axWithin(page, '#chart')).filter(n => n.role === 'StaticText').map(n => n.name).join(' ');
    expect(text).toContain(((await message.textContent()) ?? '').trim());
    expect(await closePage(page)).toEqual([]);
  });

  it('F8 donut: ten slices draw the seven largest and "Other (3)" with AX121; the table lists all ten categories', async () => {
    const page = await devPage();
    const values = [30, 20, 15, 10, 8, 6, 5, 4, 3, 2];
    const built = await create(page, 'donut', { data: values.map((v, i) => ({ item: `S${i + 1}`, spend: v })) });
    expect(built.diagnostics.filter(d => d.code === 'AX121').map(d => d.level)).toEqual(['warning']);
    const entries = await legend(page);
    expect(entries.map(e => e.replace(/\s+[\d,.]+\s*EUR.*$/, ''))).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'Other (3)']);
    // Other is 4 + 3 + 2 = 9.
    expect(entries[7]).toContain(withUnit(9, SPEND.unit));
    expect(await sliceCount(page)).toBe(8);
    await page.locator('#chart [role="toolbar"] button', { hasText: 'View as table' }).click();
    await settle(page);
    const rows = await page.locator('#chart table tbody th[scope="row"]').allTextContents();
    expect(rows).toEqual(values.map((_, i) => `S${i + 1}`));
    expect(await closePage(page)).toEqual([]);
  });

  it('F8 donut: an all-zero donut shows the empty state inside the plot, with no slices', async () => {
    const page = await devPage();
    await create(page, 'donut', { data: SPEND.items.map(item => ({ item, spend: 0 })) });
    expect(await sliceCount(page)).toBe(0);
    const message = page.locator('#chart .axylo-plot .axylo-message');
    expect(await message.isVisible()).toBe(true);
    expect(((await message.textContent()) ?? '').trim()).not.toBe('');
    expect(await closePage(page)).toEqual([]);
  });
});
