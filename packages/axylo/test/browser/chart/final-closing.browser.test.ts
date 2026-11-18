/**
 * The closing fix pass (reviews/2026-11-18/impl/wp/closing.fix.md, interaction author's six items, from
 * reviews/2026-11-18/impl/wp/final-check.review.md), each with the reviewer's sequence against decision 0004.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { start, stop } from '../harness';
import { chartPage, closePage } from './util';
import { create, overlaps, plotBox, recordEvents, selected, settle, tip, type Pt } from './final-util';

beforeAll(start);
afterAll(stop);

const proxy = '#chart .axylo-proxy';
const clickAt = async (page: Page, at: Pt) => { await page.mouse.move(at.x, at.y); await page.mouse.down(); await page.mouse.up(); await settle(page); };

describe('1 (I4): every row of a strip is checked against what its card leaves visible', () => {
  it('two short series pinned on one strip line, a card that clips just after the first row: every button shown is wholly inside the card, or no strip', async () => {
    const page = await chartPage({ css: '#card { overflow: hidden; } #card #chart { width: 220px; height: 420px; }' });
    await page.evaluate(() => {
      const card = Object.assign(document.createElement('div'), { id: 'card' });
      const chart = document.getElementById('chart')!;
      chart.replaceWith(card);
      card.appendChild(chart);
    });
    await create(page, 'line', { title: 'S', legend: false, table: false, data: [0, 1, 2].flatMap(x => ['A', 'B'].map((s, i) => ({ x, s, y: x + i }))), x: 'x', y: 'y', series: 's' });
    const p = await plotBox(page);
    const at = { x: p.x + p.width / 2, y: p.y + p.height / 2 };
    await clickAt(page, at);
    // The card then ends 2 px after the first button, and the chart redraws (a new point arrives).
    const first = (await page.locator('#chart .axylo-readout button.axylo-readout-entry').first().boundingBox())!;
    const card = (await page.locator('#card').boundingBox())!;
    await page.evaluate(w => { document.getElementById('card')!.style.width = `${w}px`; }, first.x + first.width + 2 - card.x);
    await page.evaluate(() => window.charts[0]!.append([{ x: 3, s: 'A', y: 1 }]));
    await settle(page);
    const clip = (await page.locator('#card').boundingBox())!;
    const shown = await page.evaluate(() => {
      const s = document.querySelector('#chart .axylo-readout') as HTMLElement;
      return s.hidden ? null : [...s.querySelectorAll('button')].map(b => { const r = b.getBoundingClientRect(); return { left: r.left, right: r.right }; });
    });
    if (shown !== null) for (const b of shown) expect(b.right, JSON.stringify(shown)).toBeLessThanOrEqual(clip.x + clip.width + 0.5);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('2 (I5): a control\'s own painted outline is kept clear', () => {
  it('a legend button beside the plot with a 32 px outline, focused: the tooltip of the datum next to it does not cover the outline', async () => {
    const page = await chartPage({ css: '#chart { width: 640px; height: 400px; } #chart .axylo-control:focus { outline: 32px solid rgb(200, 0, 0) !important; outline-offset: 0 !important; }' });
    // Points along the plot's top edge, the legend to the right of the plot.
    await create(page, 'line', { title: 'O', legend: 'right', data: Array.from({ length: 11 }, (_, x) => ['A', 'B'].map((s, i) => ({ x, s, y: 10 - i * 0.2 }))).flat(), x: { field: 'x', domain: [0, 10] }, y: { field: 'y', domain: [0, 10] }, series: 's' });
    const button = page.locator('#chart [role="toolbar"] button').first();
    await button.focus();
    const b = (await button.boundingBox())!;
    const outline = { x: b.x - 32, y: b.y - 32, width: b.width + 64, height: b.height + 64 };
    const p = await plotBox(page);
    // The last x is at the plot's right edge, within 32 px of the button: its tooltip is pushed to that edge.
    expect(outline.x).toBeLessThan(p.x + p.width);
    await page.mouse.move(p.x + p.width - 1, p.y + 6);
    await settle(page);
    const t = (await tip(page)).box;
    expect(t).not.toBeNull();
    expect(overlaps(t!, outline), `${JSON.stringify(t)} covers ${JSON.stringify(outline)}`).toBe(false);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('3 (R1): a press across a change from floating to strip', () => {
  it('press Q3\'s floating row, shrink into readout mode while holding, release over the Q3 strip button: Q3 is selected, once', async () => {
    const page = await chartPage({ css: '#chart { width: 640px; height: 360px; }' });
    await create(page, 'bar', { title: 'B', data: ['Q1', 'Q2', 'Q3', 'Q4'].map((x, i) => ({ x, y: i + 1 })), x: 'x', y: 'y' });
    await recordEvents(page);
    const p = await plotBox(page);
    await clickAt(page, { x: p.x + p.width * (2.5 / 4), y: p.y + p.height * 0.9 });
    expect(await tip(page)).toMatchObject({ title: 'Q3', pinned: true });
    const before = (await selected(page)).length;
    const row = (await page.locator('#chart .axylo-tooltip button.axylo-tooltip-row').first().boundingBox())!;
    await page.mouse.move(row.x + row.width / 2, row.y + row.height / 2);
    await page.mouse.down();
    await page.evaluate(() => { document.getElementById('chart')!.style.width = '220px'; });
    await settle(page);
    await page.evaluate(() => window.nextFrames(3));
    const strip = (await page.locator('#chart .axylo-readout button.axylo-readout-entry').first().boundingBox())!;
    await page.mouse.move(strip.x + strip.width / 2, strip.y + strip.height / 2);
    await page.mouse.up();
    await settle(page);
    expect((await selected(page)).slice(before).map(e => e.x)).toEqual(['Q3']);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('4: a pinned scatter pager after appends near the pin', () => {
  it('pin a point at 0.8 px, append eight at 0 and the latest at 0.4 px: "+N more" pages to rows not on page one', async () => {
    const page = await chartPage({ css: '#chart { width: 640px; height: 400px; }' });
    await create(page, 'scatter', { title: 'P', data: [{ x: 500, y: 5, id: 'pin' }], x: { field: 'x', domain: [0, 1000] }, y: { field: 'y', domain: [0, 10] } });
    await recordEvents(page);
    const p = await plotBox(page);
    // Data units of one plot pixel; the pinned point 0.8 px right of x = 500's place.
    const unit = 1000 / p.width;
    await page.evaluate(u => window.charts[0]!.update({ data: [{ x: 500 + 0.8 * u, y: 5, id: 'pin' }] }), unit);
    await settle(page);
    await clickAt(page, { x: p.x + ((500 + 0.8 * unit) / 1000) * p.width, y: p.y + p.height / 2 });
    expect((await tip(page)).pinned).toBe(true);
    await page.evaluate(u => window.charts[0]!.append([...Array.from({ length: 8 }, (_, i) => ({ x: 500, y: 5, id: `a${i}` })), { x: 500 + 0.4 * u, y: 5, id: 'latest' }]), unit);
    await settle(page);
    expect((await tip(page)).pinned).toBe(true);
    const more = page.locator('#chart .axylo-tooltip button.axylo-tooltip-more');
    if (await more.count() === 0) { expect(await closePage(page)).toEqual([]); return; }
    const ids = async () => {
      const out: string[] = [];
      const start = (await selected(page)).length;
      for (const b of await page.locator('#chart .axylo-tooltip button.axylo-tooltip-row').all()) { await b.click(); await settle(page); }
      for (const e of (await selected(page)).slice(start)) out.push((e.row as { id: string }).id);
      return out;
    };
    const one = await ids();
    await more.click();
    await settle(page);
    const two = await ids();
    expect(two.length).toBeGreaterThan(0);
    for (const id of two) expect(one, `page two repeats ${id}`).not.toContain(id);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('5: a changed x format rewrites the focused reading', () => {
  it('focus Q1 in all-series mode, change its format to "Quarter Q1": the value text says so', async () => {
    const page = await chartPage();
    const data = ['Q1', 'Q2'].flatMap(x => ['A', 'B'].map((s, i) => ({ x, s, y: i + 1 })));
    await create(page, 'bar', { title: 'F', data, x: 'x', y: 'y', series: 's' });
    await page.locator(proxy).focus();
    await page.keyboard.press('Home');
    await settle(page);
    expect(await page.locator(proxy).getAttribute('aria-valuetext')).toMatch(/^Q1\. /);
    await page.evaluate(() => window.charts[0]!.update({ x: { field: 'x', format: (v: unknown) => `Quarter ${String(v)}` } }));
    await settle(page);
    expect(await page.locator(proxy).getAttribute('aria-valuetext')).toMatch(/^Quarter Q1\. /);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('6 (R9): a snapped Select range end lands on the plot\'s edge exactly', () => {
  it('a chart scaled to 0.5: Select range from the whole pixel left of the plot to its middle zooms from the start', async () => {
    const page = await chartPage({ css: '#wrap { transform: scale(0.5, 1); transform-origin: 0 0; width: 720px; }' });
    await page.evaluate(() => {
      const wrap = Object.assign(document.createElement('div'), { id: 'wrap' });
      const chart = document.getElementById('chart')!;
      chart.replaceWith(wrap);
      wrap.appendChild(chart);
    });
    await create(page, 'line', { title: 'E', data: Array.from({ length: 101 }, (_, x) => ({ x, y: x % 7 })), x: { field: 'x', domain: [0, 100] }, y: 'y' });
    await page.evaluate(() => { const w = window as unknown as { zooms: unknown[] }; w.zooms = []; window.charts[0]!.on('zoom', z => w.zooms.push(z)); });
    const p = await plotBox(page);
    await page.locator('#chart [role="toolbar"] button[title="Select range"]').click();
    await clickAt(page, { x: Math.ceil(p.x) - 1, y: Math.round(p.y + p.height / 2) });
    await clickAt(page, { x: Math.round(p.x + p.width / 2), y: Math.round(p.y + p.height / 2) });
    const zooms = await page.evaluate(() => (window as unknown as { zooms: number[][] }).zooms);
    expect(zooms).toHaveLength(1);
    expect(zooms[0]![0]).toBe(0);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('long value text (spec I1; decision 0004 rule 6): the tooltip wraps it, it is never hidden', () => {
  const LONG: [string, Record<string, unknown>][] = [
    ['a 60-letter unit', { unit: 'x'.repeat(60) }],
    ['a unit of twelve words', { unit: 'word '.repeat(12).trim() }],
    ['a long format with a unit', { unit: 'kWh', format: (v: number) => `approximately ${v} measured across every reporting station` }],
  ];
  /** The tooltip's title and its first row's first line lie inside the tooltip, and it inside the plot. */
  const parts = (page: Page) => page.evaluate(() => {
    const t = document.querySelector('#chart .axylo-tooltip') as HTMLElement;
    const plot = document.querySelector('#chart .axylo-proxy')!.getBoundingClientRect();
    const box = t.getBoundingClientRect();
    const inside = (r: DOMRect | undefined, o: DOMRect) => !!r && r.left >= o.left - 0.5 && r.top >= o.top - 0.5 && r.right <= o.right + 0.5 && r.bottom <= o.bottom + 0.5;
    return {
      hidden: t.hidden, inPlot: inside(box, plot),
      title: inside(t.querySelector('.axylo-tooltip-title')?.getClientRects()[0], box),
      row: inside(t.querySelector('.axylo-tooltip-row .axylo-tooltip-value')?.getClientRects()[0], box),
      total: !!t.querySelector('.axylo-tooltip-total'),
      valueLines: (() => { const v = t.querySelector('.axylo-tooltip-row .axylo-tooltip-value') as HTMLElement | null; return v ? Math.round(v.getBoundingClientRect().height / parseFloat(getComputedStyle(v).lineHeight)) : 0; })(),
    };
  });
  for (const kind of ['line', 'area'] as const) {
    for (const [name, field] of LONG) {
      it(`${kind}, ${name}: the tooltip shows, its title and first row inside it and inside the plot${kind === 'area' ? ', the stack total present' : ''}`, async () => {
        const page = await chartPage({ css: '#chart { width: 640px; height: 320px; }' });
        await page.evaluate(async ({ kind, field, fmt }) => {
          const y: Record<string, unknown> = { field: 'y', ...field };
          if (fmt) y.format = (v: number) => `approximately ${v} measured across every reporting station`;
          const data = [0, 1, 2, 3].flatMap(x => ['A', 'B'].map((s, i) => ({ x, s, y: x + i + 1 })));
          const chart = window.Axylo[kind]!('#chart', { title: 'Long', data, x: 'x', y, series: 's', ...(kind === 'area' ? { stacked: true } : {}) });
          window.charts.push(chart);
          await chart.__bench.ready();
          await window.nextFrames(2);
        }, { kind, field: { unit: field.unit }, fmt: 'format' in field });
        const p = await plotBox(page);
        await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
        await settle(page);
        const r = await parts(page);
        expect(r).toMatchObject({ hidden: false, inPlot: true, title: true, row: true, ...(kind === 'area' ? { total: true } : {}) });
        expect(await closePage(page)).toEqual([]);
      });
    }
  }

  it('a short unit keeps value and unit on one line', async () => {
    const page = await chartPage({ css: '#chart { width: 640px; height: 320px; }' });
    await create(page, 'line', { title: 'Short', data: [0, 1, 2, 3].map(x => ({ x, y: 1000 + x })), x: 'x', y: { field: 'y', unit: 'ms' } });
    const p = await plotBox(page);
    await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
    await settle(page);
    const r = await parts(page);
    expect(r).toMatchObject({ hidden: false, valueLines: 1 });
    expect(await page.locator('#chart .axylo-tooltip .axylo-tooltip-value').textContent()).toMatch(/ ms$/);
    expect(await closePage(page)).toEqual([]);
  });

  it('the strip: a 60-letter unit in a 220 px tile wraps or is cut, the title and the row\'s start are shown', async () => {
    const page = await chartPage({ css: '#chart { width: 220px; height: 420px; }' });
    await create(page, 'line', { title: 'Strip', legend: false, data: [0, 1, 2].map(x => ({ x, y: x + 1 })), x: 'x', y: { field: 'y', unit: 'x'.repeat(60) } });
    const p = await plotBox(page);
    await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
    await settle(page);
    const r = await page.evaluate(() => {
      const s = document.querySelector('#chart .axylo-readout') as HTMLElement;
      const box = s.getBoundingClientRect();
      const first = (sel: string) => s.querySelector(sel)?.getClientRects()[0];
      const inside = (q: DOMRect | undefined) => !!q && q.left >= box.left - 0.5 && q.top >= box.top - 0.5 && q.left < box.right && q.top < box.bottom;
      return { hidden: s.hidden, title: inside(first('.axylo-tooltip-title')), row: inside(first('.axylo-readout-entry')) };
    });
    expect(r).toEqual({ hidden: false, title: true, row: true });
    expect(await closePage(page)).toEqual([]);
  });
});
