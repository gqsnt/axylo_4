/**
 * A4: "View as table" (spec 3.4). The table is read from Chrome's accessibility tree (table, caption,
 * column and row headers, cells) and compared with the fixture data; paging and the jump field are driven
 * with real clicks and typing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { start, stop } from '../harness';
import { axOf, axWithin, box, call, closePage, compareTable, create, createRaw, devPage, readTable, settle } from './util';
import { calendar, ENERGY, FULL, LATENCY_ORDER, tableOf, withUnit, type ChartType } from './fixtures';

beforeAll(start);
afterAll(stop);

type Full = Exclude<ChartType, 'compact'>;

async function openTable(page: Page, selector = '#chart'): Promise<void> {
  await page.locator(`${selector} [role="toolbar"] button`, { hasText: 'View as table' }).click();
  await settle(page);
}

describe('A4 table content', () => {
  for (const type of FULL as Full[]) {
    it(`A4 ${type}: View as table opens an HTML table built from the data: title as caption, field labels with units as column headers, x values as row headers, values formatted as in F6`, async () => {
      const page = await devPage();
      await create(page, type);
      expect(await page.locator('#chart table').count()).toBe(0);
      await openTable(page);
      const t = await readTable(page);
      const want = tableOf(type);
      expect(t.name).toBe(want.caption);
      // Ordered headers, then every row exactly and in order: a value under the wrong header is a failure.
      expect(compareTable(t, want)).toEqual([]);
      expect(await closePage(page)).toEqual([]);
    });

    it(`A4 ${type}: the table sits in a focusable scroll region named by its caption, no taller than the plot, and opening it does not move another chart on the page`, async () => {
      const page = await devPage({ css: '#second { width: 720px; height: 400px; }' });
      await page.evaluate(() => {
        const el = document.createElement('div');
        el.id = 'second';
        document.querySelector('#after')!.after(el);
      });
      await create(page, type);
      await create(page, type, {}, '#second');
      const plotHeight = (await box(page, '#chart .axylo-plot')).height;
      const before = await box(page, '#second figure');
      await openTable(page);
      const after = await box(page, '#second figure');
      expect(after).toEqual(before);
      const region = (await axWithin(page, '#chart')).find(n => n.role === 'region');
      expect(region?.name).toBe(tableOf(type).caption);
      expect(region?.props.focusable).toBe(true);
      const scroll = await box(page, '#chart .axylo-table-scroll');
      expect(scroll.height).toBeLessThanOrEqual(plotHeight + 0.5);
      expect(await closePage(page)).toEqual([]);
    });
  }
});

/** 250 rows per type, so the table has three pages of at most 100. Row k (0-based) has x as `rowHeader(k)`. */
function longData(type: Full): { fn: string; options: Record<string, unknown>; rowHeader(k: number): string; jumpText(k: number): string } {
  const day = (k: number) => new Date(Date.UTC(2026, 0, 1) + k * 864e5).toISOString().slice(0, 10);
  const cat = (k: number) => `C${String(k + 1).padStart(3, '0')}`;
  switch (type) {
    case 'line':
    case 'area':
      return {
        fn: type, options: { title: 'Long', data: Array.from({ length: 250 }, (_, k) => ({ day: day(k), v: k })), x: { field: 'day', type: 'date' }, y: 'v' },
        rowHeader: k => calendar(day(k)), jumpText: k => calendar(day(k)),
      };
    case 'bar':
      return {
        fn: 'bar', options: { title: 'Long', data: Array.from({ length: 250 }, (_, k) => ({ c: cat(k), v: k + 1 })), x: 'c', y: 'v' },
        rowHeader: cat, jumpText: cat,
      };
    case 'scatter':
      return {
        fn: 'scatter', options: { title: 'Long', data: Array.from({ length: 250 }, (_, k) => ({ x: k + 1, y: (k * 7) % 50 })), x: 'x', y: 'y' },
        rowHeader: k => String(k + 1), jumpText: k => String(k + 1),
      };
    case 'donut':
      return {
        fn: 'donut', options: { title: 'Long', data: Array.from({ length: 250 }, (_, k) => ({ c: cat(k), v: 250 - k })), label: 'c', value: 'v' },
        rowHeader: cat, jumpText: cat,
      };
  }
}

describe('A4 table on a 24-chart page', () => {
  for (const type of FULL as Full[]) {
    it(`A4 ${type}: on a page of 24 charts, opening one chart's table moves none of the other 23`, async () => {
      const page = await devPage({ viewport: { width: 1400, height: 1000 }, css: '.tile { width: 340px; height: 200px; display: inline-block; vertical-align: top; }' });
      await page.evaluate(() => {
        for (let i = 0; i < 24; i++) { const el = document.createElement('div'); el.id = `tile-${i}`; el.className = 'tile'; document.body.appendChild(el); }
      });
      for (let i = 0; i < 24; i++) await create(page, type, { title: `Chart ${i + 1}` }, `#tile-${i}`);
      const where = () => page.evaluate(() => Array.from({ length: 24 }, (_, i) => document.querySelector(`#tile-${i} figure`)!.getBoundingClientRect().toJSON()));
      const before = await where();
      await page.locator('#tile-5 [role="toolbar"] button', { hasText: 'View as table' }).click();
      await settle(page);
      expect(await page.locator('#tile-5 table').count()).toBe(1);
      const after = await where();
      expect(after.filter((_, i) => i !== 5)).toEqual(before.filter((_, i) => i !== 5));
      expect(await closePage(page)).toEqual([]);
    });
  }
});

describe('A4 paging and jumping', () => {
  for (const type of FULL as Full[]) {
    it(`A4 ${type}: 250 rows are shown 100 per page; Next and Previous page reach every row; jumping to an x value shows the page that holds it`, async () => {
      const page = await devPage();
      const d = longData(type);
      await createRaw(page, d.fn, d.options);
      await openTable(page);
      let t = await readTable(page);
      expect(t.rows.map(r => r.header)).toEqual(Array.from({ length: 100 }, (_, k) => d.rowHeader(k)));
      const next = page.locator('#chart .axylo-pager button', { hasText: 'Next page' });
      const previous = page.locator('#chart .axylo-pager button', { hasText: 'Previous page' });
      await next.click();
      t = await readTable(page);
      expect(t.rows.map(r => r.header)).toEqual(Array.from({ length: 100 }, (_, k) => d.rowHeader(100 + k)));
      await next.click();
      t = await readTable(page);
      expect(t.rows.map(r => r.header)).toEqual(Array.from({ length: 50 }, (_, k) => d.rowHeader(200 + k)));
      await previous.click();
      await previous.click();
      t = await readTable(page);
      expect(t.rows[0]!.header).toBe(d.rowHeader(0));
      // Jump to row 230 by typing its x as the table shows it.
      const field = page.locator('#chart .axylo-jump-field');
      await field.click();
      await page.keyboard.type(d.jumpText(229));
      await page.keyboard.press('Enter');
      await settle(page);
      t = await readTable(page);
      expect(t.rows.map(r => r.header)).toContain(d.rowHeader(229));
      expect(await closePage(page)).toEqual([]);
    });

    it(`A4 ${type}: a "Jump to" value that matches no row is identified, described in visible text and associated with the field (reading: WCAG 3.3.1 applies to the jump field)`, async () => {
      const page = await devPage();
      const d = longData(type);
      await createRaw(page, d.fn, d.options);
      await openTable(page);
      const field = page.locator('#chart .axylo-jump-field');
      await field.click();
      await page.keyboard.type('no such value');
      await page.keyboard.press('Enter');
      await settle(page);
      expect((await axWithin(page, '#chart')).find(n => n.role === 'textbox')?.props.invalid).toBe('true');
      // The error is programmatically associated with the field: Chrome's computed description of the
      // textbox (aria-describedby or aria-errormessage) carries it, and that text is visible on the page.
      const field2 = await axOf(page, '#chart .axylo-jump-field');
      expect(field2.description, 'computed description of the jump field').toMatch(/no such value|no row/i);
      const visible = await page.evaluate(() => {
        const f = document.querySelector('#chart .axylo-jump-field') as HTMLInputElement;
        const ids = `${f.getAttribute('aria-describedby') ?? ''} ${f.getAttribute('aria-errormessage') ?? ''}`.split(/\s+/).filter(Boolean);
        return ids.map(id => document.getElementById(id)).filter((e): e is HTMLElement => !!e && e.offsetParent !== null && e.getBoundingClientRect().width > 0).map(e => e.textContent ?? '').join(' ');
      });
      expect(visible, 'visible error text').toMatch(/no such value|no row/i);
      expect(await closePage(page)).toEqual([]);
    });
  }
});

describe('A4 current range', () => {
  for (const type of ['line', 'area', 'scatter'] as const) {
    it(`A4 ${type}: zoomed in, the table covers the current x range only, row by row`, async () => {
      const page = await devPage();
      await create(page, type);
      const range = type === 'scatter' ? [12, 30] : ['2026-03-03', '2026-03-05'];
      await call(page, 'zoom', [range]);
      await openTable(page);
      const all = tableOf(type);
      const want = type === 'scatter' ? all.rows.filter((_, i) => LATENCY_ORDER[i]!.size >= 12 && LATENCY_ORDER[i]!.size <= 30) : all.rows.slice(1, 4);
      expect(compareTable(await readTable(page), { headers: all.headers, rows: want })).toEqual([]);
      expect(await closePage(page)).toEqual([]);
    });
  }

  for (const axis of ['date', 'number'] as const) {
    it(`A4 bar: on a ${axis} x axis, zoomed in, the table covers the current x range only, row by row`, async () => {
      const page = await devPage();
      const xs = axis === 'date' ? ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06'] : [1, 2, 3, 4, 5, 6];
      const values = [11, 22, 33, 44, 55, 66];
      await createRaw(page, 'bar', { title: 'Zoomable bars', data: xs.map((x, i) => ({ x, v: values[i] })), x: axis === 'date' ? { field: 'x', type: 'date' } : { field: 'x', type: 'number' }, y: 'v' });
      await call(page, 'zoom', [axis === 'date' ? ['2026-03-02', '2026-03-04'] : [2, 4]]);
      await openTable(page);
      const label = (i: number) => (axis === 'date' ? calendar(xs[i] as string) : String(xs[i]));
      expect(compareTable(await readTable(page), { headers: [['x'], ['v']], rows: [1, 2, 3].map(i => [label(i), String(values[i])]) })).toEqual([]);
      expect(await closePage(page)).toEqual([]);
    });
  }

  it('A4 line: a value near row 900,000 of a 1,000,000-row typed-column chart is reachable by jumping to its x', async () => {
    const page = await devPage();
    await page.evaluate(async () => {
      const n = 1_000_000;
      const x = new Float64Array(n);
      const y = new Float64Array(n);
      for (let i = 0; i < n; i++) { x[i] = i; y[i] = (i % 1000) + 0.25; }
      const w = window as unknown as { Axylo: Record<string, (t: string, o: unknown) => { __bench: { ready(): Promise<void> } }>; charts: unknown[] };
      const chart = w.Axylo.line!('#chart', { title: 'A million', data: { columns: { x, y } }, x: 'x', y: 'y' });
      w.charts.push(chart);
      await chart.__bench.ready();
    });
    await openTable(page);
    const field = page.locator('#chart .axylo-jump-field');
    await field.click();
    await page.keyboard.type('900,123');
    await page.keyboard.press('Enter');
    await settle(page);
    const t = await readTable(page);
    const row = t.rows.find(r => r.header === '900,123');
    expect(row?.cells).toEqual(['123.25']);
    expect(await closePage(page)).toEqual([]);
  });
});

