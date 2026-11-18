/**
 * Fifth pass on the third interaction review (reviews/2026-11-18/impl/wp/core3.interaction.review.md):
 * new item 9 and part 1 items 3, 11, 12 and 15, and the language watcher, as seen from the page.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { start, stop } from '../harness';
import { chartPage, closePage } from './util';

beforeAll(start);
afterAll(stop);

const proxy = '#chart .axylo-proxy';
const settle = (page: Page) => page.evaluate(async () => { for (const c of window.charts) await c.__bench.ready(); await window.nextFrames(2); });

async function create(page: Page, kind: string, options: Record<string, unknown>): Promise<void> {
  await page.evaluate(async ({ kind, options }) => {
    const chart = window.Axylo[kind]!('#chart', options);
    window.charts.push(chart);
    await chart.__bench.ready();
    await window.nextFrames(1);
  }, { kind, options });
}

async function selections(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { selected: unknown[] };
    w.selected = [];
    window.charts[0]!.on('select', (p: unknown) => { w.selected.push(p); });
  });
}
const selected = (page: Page) => page.evaluate(() => (window as unknown as { selected: { series: string; x: unknown }[] }).selected);

const tipText = (page: Page) => page.evaluate(() => {
  const shown = (el: Element | null) => el instanceof HTMLElement && !el.hidden && el.getBoundingClientRect().width > 0;
  const t = document.querySelector('#chart .axylo-tooltip');
  const r = document.querySelector('#chart .axylo-readout');
  return shown(t) ? t!.textContent : shown(r) ? r!.textContent : null;
});

describe('new item 9: rows and slices that can be chosen are real controls', () => {
  it('tooltip rows pinned by a tap are buttons named by their text, at least 24 px tall, outside the tab order; a tap selects that series', async () => {
    const page = await chartPage({ hasTouch: true, css: '#chart { width: 640px; height: 360px; }' });
    const data = [0, 1, 2, 3].flatMap(x => ['a', 'b'].map((s, k) => ({ x, s, y: x + k * 10 })));
    await create(page, 'line', { title: 'R', data, x: 'x', y: 'y', series: 's' });
    const box = (await page.locator('#chart .axylo-plot').boundingBox())!;
    await page.touchscreen.tap(box.x + box.width * 0.5, box.y + box.height * 0.6);
    await settle(page);
    await selections(page);
    const rows = await page.evaluate(() => [...document.querySelectorAll('#chart .axylo-tooltip-choice, #chart .axylo-readout .axylo-tooltip-choice')]
      .filter(el => (el as HTMLElement).offsetParent !== null)
      .map(el => ({ tag: el.tagName, tab: (el as HTMLElement).tabIndex, h: el.getBoundingClientRect().height, text: el.textContent })));
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r.tag).toBe('BUTTON');
      expect(r.tab).toBe(-1);
      expect(r.h).toBeGreaterThanOrEqual(24);
      expect(r.text).toMatch(/^[ab]/);
    }
    const b = (await page.locator('#chart .axylo-tooltip-choice:visible', { hasText: 'b' }).first().boundingBox())!;
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    await settle(page);
    expect((await selected(page)).map(p => p.series)).toEqual(['b']);
    expect(await closePage(page)).toEqual([]);
  });

  it('a zero and a null donut slice can be chosen in the slice list by pointer', async () => {
    const page = await chartPage({ css: '#chart { width: 640px; height: 360px; }' });
    const data = [{ l: 'A', v: 3 }, { l: 'Zero', v: 0 }, { l: 'None', v: null }, { l: 'B', v: 2 }];
    await create(page, 'donut', { title: 'D', data, label: 'l', value: 'v' });
    await selections(page);
    for (const name of ['Zero', 'None']) {
      const entry = page.locator('#chart .axylo-legend-list button', { hasText: name });
      expect(await entry.getAttribute('tabindex')).toBe('-1');
      expect((await entry.boundingBox())!.height).toBeGreaterThanOrEqual(24);
      await entry.click();
    }
    expect((await selected(page)).map(p => p.x)).toEqual(['Zero', 'None']);
    // The closed chart still has two tab stops: the plot and one toolbar control.
    const stops = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#chart *')].filter(el => el.tabIndex >= 0 && !el.hidden && el.offsetParent !== null).length);
    expect(stops).toBe(2);
    expect(await closePage(page)).toEqual([]);
  });

  it('a pinned tooltip closes when the table replaces the plot, with the disclosure activated by keyboard', async () => {
    const page = await chartPage({ hasTouch: true, css: '#chart { width: 640px; height: 360px; }' });
    await create(page, 'bar', { title: 'P', data: ['A', 'B', 'C'].map((x, i) => ({ x, y: i + 1 })), x: 'x', y: 'y' });
    const box = (await page.locator('#chart .axylo-plot').boundingBox())!;
    await page.touchscreen.tap(box.x + box.width * 0.5, box.y + box.height * 0.7);
    await settle(page);
    expect(await tipText(page)).toMatch(/^B/);
    await page.locator('#chart button', { hasText: 'View as table' }).focus();
    await page.keyboard.press('Enter');
    await settle(page);
    expect(await tipText(page)).toBeNull();
    expect(await closePage(page)).toEqual([]);
  });
});

describe('part 1 item 3: the slice list comes from the slices, not from the table option', () => {
  it('an all-zero donut with table: false still lists its slices', async () => {
    const page = await chartPage();
    await create(page, 'donut', { title: 'Z', data: [{ l: 'A', v: 0 }, { l: 'B', v: 0 }], label: 'l', value: 'v', table: false });
    const items = await page.locator('#chart .axylo-legend-list li').allTextContents();
    expect(items.length).toBe(2);
    expect(items[0]).toMatch(/^A/);
    expect(await closePage(page)).toEqual([]);
  });
});

/** Taps over the plot until the tooltip shows `want`, sweeping around a guess (renderer-independent). */
async function tapUntil(page: Page, fx: number, fy: number, want: RegExp): Promise<boolean> {
  const at = (await page.locator('#chart .axylo-plot').boundingBox())!;
  for (let dy = -60; dy <= 60; dy += 6) {
    for (const dx of [0, -6, 6]) {
      await page.touchscreen.tap(at.x + at.width * fx + dx, at.y + at.height * fy + dy);
      await settle(page);
      if (want.test((await tipText(page)) ?? '')) return true;
    }
  }
  return false;
}

describe('part 1 item 11: a pinned scatter point needs a drawn anchor', () => {
  it('pinned (5, 100): changing the y domain to [0, 10] drops the pin', async () => {
    const page = await chartPage({ hasTouch: true, css: '#chart { width: 640px; height: 360px; }' });
    await create(page, 'scatter', { title: 'S', data: [{ x: 0, y: 0 }, { x: 5, y: 100 }, { x: 10, y: 50 }], x: 'x', y: 'y' });
    expect(await tapUntil(page, 0.5, 0.15, /100/)).toBe(true);
    await page.evaluate(() => { window.charts[0]!.update({ y: { field: 'y', domain: [0, 10] } }); });
    await settle(page);
    expect(await tipText(page)).toBeNull();
    expect(await closePage(page)).toEqual([]);
  });

  it('a pin on a point that gains coincident neighbours shows the new count', async () => {
    const page = await chartPage({ hasTouch: true, css: '#chart { width: 640px; height: 360px; }' });
    await create(page, 'scatter', { title: 'S', data: [{ x: 0, y: 0, s: 'S0' }, { x: 5, y: 5, s: 'S0' }, { x: 10, y: 10, s: 'S0' }], x: 'x', y: 'y', series: 's' });
    expect(await tapUntil(page, 0.5, 0.45, /^5|S0/)).toBe(true);
    await page.evaluate(() => {
      window.charts[0]!.append(Array.from({ length: 8 }, (_, i) => ({ x: 5, y: 5, s: `S${i + 1}` })));
    });
    await settle(page);
    // Nine points at (5, 5): the rows shown and "+N more" add up to nine (rule 6 may move rows into "+N more").
    const rows = await page.locator('#chart .axylo-tooltip .axylo-tooltip-row:visible').count();
    const more = Number(/(\d+) more/.exec((await tipText(page)) ?? '')?.[1] ?? 0);
    expect(rows + more).toBe(9);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('part 1 item 12: one coordinate system under a CSS transform', () => {
  it('under scale(2) on an ancestor, hovering a bar picks that bar and the tooltip is placed beside it', async () => {
    const page = await chartPage({ css: 'body { margin: 0; } #wrap { transform: scale(2); transform-origin: 0 0; } #chart { width: 400px; height: 240px; }' });
    await page.evaluate(() => {
      const chart = document.getElementById('chart')!;
      const wrap = document.createElement('div');
      wrap.id = 'wrap';
      chart.replaceWith(wrap);
      wrap.append(chart);
    });
    await create(page, 'bar', { title: 'T', data: ['A', 'B', 'C', 'D'].map((x, i) => ({ x, y: i + 1 })), x: 'x', y: 'y' });
    const plot = (await page.locator('#chart .axylo-plot').boundingBox())!;
    // In viewport pixels (twice the layout's): the last of four bands, low in the plot, is inside bar D.
    const x = plot.x + plot.width * 0.84;
    const y = plot.y + plot.height * 0.7;
    await page.mouse.move(x, y);
    await settle(page);
    expect(await tipText(page)).toMatch(/^D/);
    const tip = await page.evaluate(() => {
      const t = document.querySelector('#chart .axylo-tooltip') as HTMLElement;
      const b = t.getBoundingClientRect();
      return { floating: !t.hidden, x: b.x, y: b.y, w: b.width, h: b.height };
    });
    const figure = (await page.locator('#chart figure').boundingBox())!;
    if (tip.floating) {
      // Inside the (scaled) figure, horizontally around the bar, and clear of the pointer.
      expect(tip.x).toBeGreaterThanOrEqual(figure.x - 1);
      expect(tip.x + tip.w).toBeLessThanOrEqual(figure.x + figure.width + 1);
      // Wholly inside the (scaled) plot, as decision 0004 revision 2 requires.
      expect(tip.y).toBeGreaterThanOrEqual(plot.y - 1);
      expect(tip.y + tip.h).toBeLessThanOrEqual(plot.y + plot.height + 1);
    }
    expect(await closePage(page)).toEqual([]);
  });
});

describe('part 1 item 15: the open table stays in the card', () => {
  it('opened at 600 × 360, then the card shrinks and text grows: table and its control stay inside the figure', async () => {
    const page = await chartPage({ css: '#chart { width: 600px; height: 360px; }' });
    const data = Array.from({ length: 60 }, (_, i) => ({ x: i, y: i }));
    await create(page, 'line', { title: 'T', data, x: 'x', y: 'y' });
    await page.locator('#chart button', { hasText: 'View as table' }).click();
    await settle(page);
    await page.evaluate(() => {
      const el = document.getElementById('chart')!;
      el.style.height = '260px';
      el.style.fontSize = '200%';
    });
    await page.evaluate(() => window.nextFrames(3));
    await settle(page);
    const boxes = await page.evaluate(() => {
      const r = (sel: string) => { const b = document.querySelector(sel)!.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
      return { figure: r('#chart figure'), table: r('#chart .axylo-table'), hide: r('#chart button[aria-expanded="true"]') };
    });
    for (const inner of [boxes.table, boxes.hide]) {
      expect(inner.top).toBeGreaterThanOrEqual(boxes.figure.top - 1);
      expect(inner.bottom).toBeLessThanOrEqual(boxes.figure.bottom + 1);
      expect(inner.right).toBeLessThanOrEqual(boxes.figure.right + 1);
    }
    expect(await closePage(page)).toEqual([]);
  });
});

describe('the language watcher', () => {
  it('changing lang on the document re-renders the language marking and the number formatting, without a theme callback', async () => {
    const page = await chartPage();
    await page.evaluate(() => { document.documentElement.lang = 'en'; });
    await create(page, 'line', { title: 'L', data: [{ x: 1, y: 1234.5 }, { x: 2, y: 2000.25 }], x: 'x', y: 'y' });
    const read = () => page.evaluate(() => {
      const fig = document.querySelector('#chart figure')!;
      const summary = document.getElementById(fig.getAttribute('aria-describedby')!)!.textContent ?? '';
      return { summary, proxyLang: document.querySelector('#chart .axylo-proxy')!.getAttribute('lang'), theme: window.charts[0]!.__dev.stages().theme };
    });
    const before = await read();
    expect(before.summary).toContain('1,234.5');
    expect(before.proxyLang).toBeNull();
    await page.evaluate(() => { document.documentElement.lang = 'de'; });
    await page.evaluate(() => window.nextFrames(3));
    await settle(page);
    const after = await read();
    expect(after.summary).toContain('1.234,5');
    expect(after.proxyLang).toBe('en');
    expect(after.theme).toBe(before.theme);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('sixth pass: A7 and the note runs', () => {
  it('A7 bar: a sliding category window does not rewrite the text of the focused, unchanged datum', async () => {
    const page = await chartPage();
    await create(page, 'bar', { title: 'Q', data: ['Q1', 'Q2', 'Q3', 'Q4'].map((x, i) => ({ x, y: i + 1 })), x: 'x', y: 'y' });
    await page.focus(proxy);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const before = await page.locator(proxy).getAttribute('aria-valuetext');
    expect(before).toMatch(/^Q3/);
    await page.evaluate(() => { window.charts[0]!.append([{ x: 'Q5', y: 5 }], { keep: 4 }); });
    await settle(page);
    expect(await page.locator(proxy).getAttribute('aria-valuetext')).toBe(before);
    expect(await closePage(page)).toEqual([]);
  });

  it('the note is written as text: no serialized runs in any text or attribute of the figure', async () => {
    const page = await chartPage({ query: '?lang=de' });
    await page.evaluate(() => { document.documentElement.lang = 'de'; });
    await create(page, 'line', { title: 'N', data: [{ x: 1, y: 1 }, { x: 2, y: Number.NaN }, { x: 3, y: 3 }], x: 'x', y: 'y', messages: { seeTable: 'Siehe Tabelle.' } });
    const found = await page.evaluate(() => {
      const fig = document.querySelector('#chart figure')!;
      const out: string[] = [];
      for (const el of [fig, ...fig.querySelectorAll('*')]) {
        for (const a of el.attributes) if (/"text"\s*:|"lang"\s*:/.test(a.value)) out.push(`${el.tagName} ${a.name}`);
      }
      if (/"text"\s*:/.test(fig.textContent ?? '')) out.push('text');
      return { out, note: document.querySelector('#chart .axylo-note')!.textContent };
    });
    expect(found.out).toEqual([]);
    expect(found.note).toMatch(/Siehe Tabelle\./);
    expect(await closePage(page)).toEqual([]);
  });
});
