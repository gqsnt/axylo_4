/**
 * F8, rendered (spec 3.1): donut slices keep the given order, start at 12 o'clock and run clockwise (read
 * from the screenshot along the ring); the legend shows every slice's value and percentage as text, in
 * slice order; zero, null, negative, more than eight and all-zero slices each have their own outcome.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { start, stop } from '../harness';
import { axWithin, closePage, create, devPage, distance, pixel, readTable, resolveColors, ring, screenshot, settle, type RGB } from './util';
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
  it('F8 donut: slices keep the given (unsorted) order, start at 12 o\'clock and run clockwise: the ring at each slice\'s middle angle shows that slice\'s legend colour', async () => {
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
    expect(text).toContain(share(SPEND.values[0]!));
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
    // The two drawn arcs are Rent (two thirds, from 12 o'clock) and Food (the last third), by colour.
    const { img, box: plot } = await screenshot(page, '#chart .axylo-plot');
    const g = await ring(page);
    const colors = await legendColors(page);
    const at = (deg: number) => { const a = (deg * Math.PI) / 180; return pixel(img, g.cx - plot.x + 0.85 * g.outer * Math.sin(a), g.cy - plot.y - 0.85 * g.outer * Math.cos(a)); };
    expect(distance(at(120), colors[0]!), 'Rent at 120°').toBeLessThanOrEqual(24);
    expect(distance(at(300), colors[2]!), 'Food at 300°').toBeLessThanOrEqual(24);
    expect(await closePage(page)).toEqual([]);
  });

  it('F8 donut: a negative value is AX120 and the chart shows its error state inside the plot, with no slices', async () => {
    const page = await devPage();
    const built = await create(page, 'donut', { data: [{ item: 'Rent', spend: 1200 }, { item: 'Refund', spend: -50 }], messages: { error: 'This donut cannot be drawn.' } });
    expect(built.diagnostics.filter(d => d.code === 'AX120').map(d => d.level)).toEqual(['error']);
    expect(await sliceCount(page)).toBe(0);
    const message = page.locator('#chart .axylo-plot .axylo-message');
    expect(await message.isVisible()).toBe(true);
    expect(((await message.textContent()) ?? '').trim()).toBe('This donut cannot be drawn.');
    const text = (await axWithin(page, '#chart')).filter(n => n.role === 'StaticText').map(n => n.name).join(' ');
    expect(text).toContain(((await message.textContent()) ?? '').trim());
    expect(await closePage(page)).toEqual([]);
  });

  it('F8 donut: ten slices in scrambled order draw the seven largest, in their given order, then "Other (3)" holding the other three, with AX121; arcs and legend agree; the table lists all ten in the given order', async () => {
    const page = await devPage();
    // The seven largest are not the first seven: S2 30, S3 8, S5 20, S6 15, S8 10, S9 6, S10 5; Other = S1 3 + S4 2 + S7 4.
    const values = [3, 30, 8, 2, 20, 15, 4, 10, 6, 5];
    const built = await create(page, 'donut', { data: values.map((v, i) => ({ item: `S${i + 1}`, spend: v })) });
    expect(built.diagnostics.filter(d => d.code === 'AX121').map(d => d.level)).toEqual(['warning']);
    const drawn = [['S2', 30], ['S3', 8], ['S5', 20], ['S6', 15], ['S8', 10], ['S9', 6], ['S10', 5], ['Other (3)', 9]] as const;
    const entries = await legend(page);
    expect(entries.map(e => e.replace(/\s+[\d,.]+\s*EUR.*$/, ''))).toEqual(drawn.map(d => d[0]));
    drawn.forEach(([, v], i) => expect(entries[i]).toContain(withUnit(v, SPEND.unit)));
    expect(await sliceCount(page)).toBe(8);
    // Each arc sits where its share puts it, clockwise from 12 o'clock, in the legend's colour.
    const { img, box: plot } = await screenshot(page, '#chart .axylo-plot');
    const g = await ring(page);
    const colors = await legendColors(page);
    const total = values.reduce((a, b) => a + b, 0);
    let before = 0;
    const wrong: string[] = [];
    drawn.forEach(([name, v], i) => {
      const a = (2 * Math.PI * (before + v / 2)) / total;
      before += v;
      const seen = pixel(img, g.cx - plot.x + 0.85 * g.outer * Math.sin(a), g.cy - plot.y - 0.85 * g.outer * Math.cos(a));
      if (distance(seen, colors[i]!) > 24) wrong.push(`${name} at ${Math.round((a * 180) / Math.PI)}°: ${seen}, legend ${colors[i]}`);
    });
    expect(wrong).toEqual([]);
    await page.locator('#chart [role="toolbar"] button', { hasText: 'View as table' }).click();
    await settle(page);
    const rows = await page.locator('#chart table tbody th[scope="row"]').allTextContents();
    expect(rows).toEqual(values.map((_, i) => `S${i + 1}`));
    expect(await closePage(page)).toEqual([]);
  });

  it('F8 donut: eight slices are all drawn and raise no AX121; the ninth is what groups', async () => {
    const page = await devPage();
    const built = await create(page, 'donut', { data: [5, 1, 4, 2, 8, 3, 7, 6].map((v, i) => ({ item: `S${i + 1}`, spend: v })) });
    expect(built.diagnostics.map(d => d.code)).not.toContain('AX121');
    expect(await sliceCount(page)).toBe(8);
    expect((await legend(page)).map(e => e.split(' ')[0])).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']);
    await page.close();
    // The ninth: nine slices with an arc. The seven largest (9, 8, 7, 6, 5, 4, 3) are drawn; the rest (S2 = 1,
    // S4 = 2) are grouped as "Other (2)" with their sum, and AX121 is raised; the table lists every category.
    const nine = [5, 1, 4, 2, 8, 3, 7, 6, 9].map((v, i) => ({ item: `S${i + 1}`, spend: v }));
    const ninth = await devPage();
    const grouped = await create(ninth, 'donut', { data: nine });
    expect(grouped.diagnostics.map(d => d.code), 'the ninth slice raises AX121').toContain('AX121');
    expect(await sliceCount(ninth), 'seven slices and Other').toBe(8);
    const entries = await legend(ninth);
    const names = entries.map(e => /^(Other \(\d+\)|S\d+)/.exec(e)?.[1]);
    expect(names.filter(n => n !== undefined && !n.startsWith('Other')), 'the seven largest keep their order').toEqual(['S1', 'S3', 'S5', 'S6', 'S7', 'S8', 'S9']);
    const other = entries.find(e => e.startsWith('Other (2)'));
    expect(other, 'the grouped slices are listed as Other (2)').toBeDefined();
    expect(other, 'with their sum').toContain(withUnit(3, 'EUR'));
    await ninth.locator('#chart [role="toolbar"] button', { hasText: 'View as table' }).click();
    await settle(ninth);
    const table = await readTable(ninth);
    expect(table.rows.map(r => r.header), 'the table lists every category').toEqual(nine.map(d => d.item));
    expect(await closePage(ninth)).toEqual([]);
  });

  it('F8 donut: zero and null slices do not count toward the eight-slice limit and are never grouped: eight drawn slices plus a zero and a null raise no AX121 and list all ten, the zero and the null by name', async () => {
    const page = await devPage();
    const data = [5, 0, 1, 4, 2, null, 8, 3, 7, 6].map((v, i) => ({ item: `S${i + 1}`, spend: v }));
    const built = await create(page, 'donut', { data });
    expect(built.diagnostics.map(d => d.code)).not.toContain('AX121');
    expect(await sliceCount(page)).toBe(8);
    const entries = await legend(page);
    expect(entries.map(e => e.split(' ')[0])).toEqual(data.map(d => d.item));
    expect(entries[1]).toContain(withUnit(0, SPEND.unit));
    expect(entries[5]).toContain('No data');
    expect(await closePage(page)).toEqual([]);
  });

  it('F8 donut: an all-zero donut shows the empty state inside the plot, with its exact message and no slices', async () => {
    const page = await devPage();
    await create(page, 'donut', { data: SPEND.items.map(item => ({ item, spend: 0 })), messages: { empty: 'Nothing spent this month.' } });
    expect(await sliceCount(page)).toBe(0);
    const message = page.locator('#chart .axylo-plot .axylo-message');
    expect(await message.isVisible()).toBe(true);
    expect(((await message.textContent()) ?? '').trim()).toBe('Nothing spent this month.');
    expect(await closePage(page)).toEqual([]);
  });
});
