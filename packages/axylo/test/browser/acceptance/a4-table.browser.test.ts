/**
 * A4: "View as table" (spec 3.4). The table is read from Chrome's accessibility tree (table, caption,
 * column and row headers, cells) and compared with the fixture data; paging and the jump field are driven
 * with real clicks and typing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { start, stop } from '../harness';
import { axWithin, box, call, closePage, create, createRaw, devPage, settle, type AX } from './util';
import { calendar, ENERGY, FULL, inOrder, LATENCY_ORDER, share, SHIPPED, SPEND, withUnit, type ChartType } from './fixtures';

beforeAll(start);
afterAll(stop);

type Full = Exclude<ChartType, 'compact'>;

/** Expected table: caption, column headers (each as fragments in order), row headers, cells per row. */
function expectedTable(type: Full): { caption: string; headers: string[][]; rows: string[]; cells: string[][] } {
  switch (type) {
    case 'line':
    case 'area':
      return {
        caption: ENERGY.title,
        // The x field has no label, so its name is the label (spec L6); value columns carry the unit.
        headers: [['day'], ['North', 'kWh'], ['South', 'kWh']],
        rows: ENERGY.days.map(calendar),
        cells: ENERGY.days.map((_, i) => ENERGY.series.map(s => withUnit(s.values[i]!, 'kWh'))),
      };
    case 'bar':
      return {
        caption: SHIPPED.title,
        headers: [['quarter'], ['Plan', 't'], ['Actual', 't']],
        rows: SHIPPED.quarters,
        cells: SHIPPED.quarters.map((_, i) => SHIPPED.series.map(s => withUnit(s.values[i]!, 't'))),
      };
    case 'scatter':
      // One row per point in x-then-y order (spec 3.6); the x measure's label and unit head the first column.
      return {
        caption: 'Latency by payload size',
        headers: [['Payload', 'kB'], ['Latency', 'ms']],
        rows: LATENCY_ORDER.map(p => withUnit(p.size, 'kB')),
        cells: LATENCY_ORDER.map(p => [p.region, withUnit(p.latency, 'ms')]),
      };
    case 'donut':
      return {
        caption: SPEND.title,
        headers: [['Spend', 'EUR']],
        rows: SPEND.items,
        cells: SPEND.items.map((_, i) => [withUnit(SPEND.values[i]!, 'EUR'), share(SPEND.values[i]!)]),
      };
  }
}

async function openTable(page: Page, selector = '#chart'): Promise<void> {
  await page.locator(`${selector} [role="toolbar"] button`, { hasText: 'View as table' }).click();
  await settle(page);
}

/** The table as Chrome exposes it: its name (the caption), column headers, and per row the row header and cells. */
async function readTable(page: Page, selector = '#chart'): Promise<{ name: string; headers: string[]; rows: { header: string; cells: string[] }[] }> {
  const nodes = await axWithin(page, selector);
  const table = nodes.find(n => n.role === 'table');
  if (!table) return { name: '', headers: [], rows: [] };
  const all = await axWithin(page, `${selector} table`);
  const byId = new Map(all.map(n => [n.id, n]));
  const rows: { header: string; cells: string[] }[] = [];
  const headers: string[] = [];
  const kids = (n: AX): AX[] => n.children.map(c => byId.get(c)).filter((c): c is AX => !!c).flatMap(c => c.ignored || c.role === 'rowgroup' || c.role === 'generic' ? kids(c) : [c]);
  for (const row of all.filter(n => n.role === 'row')) {
    const cells = kids(row);
    const head = cells.filter(c => c.role === 'columnheader');
    if (head.length) { headers.push(...head.map(c => c.name)); continue; }
    const rh = cells.find(c => c.role === 'rowheader');
    rows.push({ header: rh?.name ?? '', cells: cells.filter(c => c.role === 'cell' || c.role === 'gridcell').map(c => c.name) });
  }
  return { name: table.name, headers, rows };
}

describe('A4 table content', () => {
  for (const type of FULL as Full[]) {
    it(`A4 ${type}: View as table opens an HTML table built from the data: title as caption, field labels with units as column headers, x values as row headers, values formatted as in F6`, async () => {
      const page = await devPage();
      await create(page, type);
      expect(await page.locator('#chart table').count()).toBe(0);
      await openTable(page);
      const t = await readTable(page);
      const want = expectedTable(type);
      expect(t.name).toBe(want.caption);
      for (const h of want.headers) expect(t.headers.some(x => inOrder(x, h)), `${JSON.stringify(h)} in ${JSON.stringify(t.headers)}`).toBe(true);
      expect(t.rows.map(r => r.header)).toEqual(want.rows);
      t.rows.forEach((r, i) => {
        for (const cell of want.cells[i]!) expect(r.cells, `row ${want.rows[i]}`).toContain(cell);
      });
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
      expect(region?.name).toBe(expectedTable(type).caption);
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

    it(`A4 ${type}: a "Jump to" value that matches no row is identified and described in visible text (reading: WCAG 3.3.1 applies to the jump field)`, async () => {
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
      // The field's accessible description, or text next to it, says what went wrong.
      const described = await page.evaluate(() => {
        const f = document.querySelector('#chart .axylo-jump-field') as HTMLInputElement;
        const ids = (f.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
        const own = ids.map(id => document.getElementById(id)).filter((e): e is HTMLElement => !!e && e.offsetParent !== null).map(e => e.textContent ?? '');
        const near = [...(f.closest('.axylo-pager')?.querySelectorAll<HTMLElement>('[role="alert"], .axylo-jump-error, [aria-live]') ?? [])].filter(e => e.offsetParent !== null).map(e => e.textContent ?? '');
        return [...own, ...near].join(' ');
      });
      expect(described).toMatch(/no such value|no row/i);
      expect(await closePage(page)).toEqual([]);
    });
  }
});

describe('A4 current range', () => {
  for (const type of ['line', 'area', 'scatter'] as const) {
    it(`A4 ${type}: zoomed in, the table covers the current x range only`, async () => {
      const page = await devPage();
      await create(page, type);
      const range = type === 'scatter' ? [12, 30] : ['2026-03-03', '2026-03-05'];
      await call(page, 'zoom', [range]);
      await openTable(page);
      const t = await readTable(page);
      const want = type === 'scatter'
        ? LATENCY_ORDER.filter(p => p.size >= 12 && p.size <= 30).map(p => withUnit(p.size, 'kB'))
        : ENERGY.days.slice(1, 4).map(calendar);
      expect(t.rows.map(r => r.header)).toEqual(want);
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

