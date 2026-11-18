/**
 * Pins, keyboard recovery, placement in the page and coordinates (decision 0004 revision 3, rules 1, 2, 4, 6,
 * 8, 9 and 10; part 2), against the final interaction review's findings 2, 3, 4, 6, 7, 9, 10, 13 and 14 and
 * the mutations 2, 3, 4, 6, 8, 9 and 10 of its last table (reviews/2026-11-18/impl/wp/core-final.interaction.review.md).
 * Accessibility outcomes are read from Chrome's accessibility tree where Chrome exposes them.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { start, stop } from '../harness';
import { RENDERER, chartPage, closePage } from './util';
import { axButtons, create, drawnShapes, frames, inside, overlaps, plotBox, recordEvents, selected, settle, strip, tip, type Box, type DrawnShape, type Pt } from './final-util';

beforeAll(start);
afterAll(stop);

const proxy = '#chart .axylo-proxy';
const valueText = (page: Page) => page.locator(proxy).getAttribute('aria-valuetext');
const active = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.className ?? '');
/** Strokes in the focus colour in the SVG overlay: the datum ring (null on the canvas renderer). */
const ringStrokes = (page: Page) => page.evaluate(() => {
  const overlay = document.querySelector('#chart .axylo-overlay');
  return overlay ? [...overlay.querySelectorAll('*')].filter(e => /--axylo(?:-default)?-focus/.test((e as SVGElement).getAttribute('style') ?? '')).length : null;
});

describe('finding 2 and mutation 3: one effective focus after recovering from an empty window', () => {
  it('focus the first point of x 0, 1, 99, 100, zoom to [25, 75], press 0: focus, reading, ring, tooltip and Enter agree on x 0', async () => {
    const page = await chartPage();
    await create(page, 'line', { title: 'Gap', data: [0, 1, 99, 100].map(x => ({ x, y: x % 7 })), x: 'x', y: 'y' });
    await recordEvents(page);
    await page.locator(proxy).focus();
    await page.keyboard.press('Home');
    await settle(page);
    expect(await valueText(page)).toMatch(/^0\. /);
    await page.evaluate(() => window.charts[0]!.zoom([25, 75]));
    await settle(page);
    expect(await valueText(page)).toBe('No data to show.');
    await page.keyboard.press('0');
    await settle(page);
    // Before any other reader action: every derived thing names the same datum.
    expect(await active(page)).toContain('axylo-proxy');
    expect(await valueText(page)).toMatch(/^0\. y 0\. Point 1 of /);
    expect((await tip(page)).title).toBe('0');
    if (RENDERER !== 'canvas') expect(await ringStrokes(page)).toBeGreaterThan(0);
    await page.keyboard.press('Enter');
    await settle(page);
    const s = await selected(page);
    expect(s.at(-1)).toMatchObject({ x: 0, index: 0 });
    expect(await closePage(page)).toEqual([]);
  });
});

describe('finding 3 and mutation 2: an all-zero donut\'s slices are reachable by keyboard', () => {
  it('with table: false, Tab reaches the slice list (one stop), arrows move, Enter selects that slice; two stops at most', async () => {
    const page = await chartPage({ css: '#before, #after { display: inline-block !important; }' });
    await create(page, 'donut', { title: 'Zero', table: false, data: [{ k: 'a', v: 0 }, { k: 'b', v: 0 }], label: 'k', value: 'v' });
    await recordEvents(page);
    await page.focus('#before');
    const stops: string[] = [];
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      const now = await page.evaluate(() => document.activeElement?.id || (document.activeElement?.textContent ?? '').trim());
      if (now === 'after') break;
      stops.push(now);
    }
    expect(stops.length).toBeGreaterThan(0);
    expect(stops.length).toBeLessThanOrEqual(2);
    await page.focus('#before');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.className)).toBe('axylo-legend-choice');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await settle(page);
    const s = await selected(page);
    expect(s.map(e => e.x)).toEqual(['a', 'b']);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('finding 14: an idle append does not rewrite the focused reading under a translated template', () => {
  it('pointOf "{series} {x} {value} [{index}/{count}]", first scatter point focused, one point appended: the value text stays', async () => {
    const page = await chartPage();
    await create(page, 'scatter', { title: 'T', messages: { pointOf: '{series} {x} {value} [{index}/{count}]' }, data: [{ x: 0, y: 2 }], x: 'x', y: 'y' });
    await page.locator(proxy).focus();
    await settle(page);
    const before = await valueText(page);
    expect(before).toBe('y 0 2 [1/1]');
    await page.evaluate(() => window.charts[0]!.append([{ x: 5, y: 3 }]));
    await settle(page);
    expect(await page.locator(proxy).getAttribute('max')).toBe('1');
    expect(await valueText(page)).toBe(before);
    // The reader's next move reads the current count (decision 0004 part 2).
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    await settle(page);
    expect(await valueText(page)).toBe('y 0 2 [1/2]');
    expect(await closePage(page)).toEqual([]);
  });
});

/** Two line series, pinned at x = 2 (the plot's middle) by a click. */
async function pinnedTwo(page: Page): Promise<void> {
  const data = [0, 1, 2].flatMap(x => ['North', 'South'].map((s, i) => ({ x, s, y: x + i * 3 })));
  // Fixed domains: an append at x = 3 moves nothing that is drawn at x = 2, where the pin is.
  await create(page, 'line', { title: 'Two', data, x: { field: 'x', domain: [0, 4] }, y: { field: 'y', domain: [0, 10] }, series: 's' });
  const p = await plotBox(page);
  await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await settle(page);
  expect((await tip(page)).pinned).toBe(true);
}

describe('findings 6 and 7, mutation 6: pinned content is real and stable', () => {
  it('a pinned tooltip\'s rows are buttons named by their text in Chrome\'s tree; hovered, none', async () => {
    const page = await chartPage();
    const data = [0, 1, 2].flatMap(x => ['North', 'South'].map((s, i) => ({ x, s, y: x + i * 3 })));
    await create(page, 'line', { title: 'Two', data, x: 'x', y: 'y', series: 's' });
    const p = await plotBox(page);
    await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
    await settle(page);
    expect(await axButtons(page, '#chart .axylo-tooltip')).toEqual([]);
    await page.mouse.down();
    await page.mouse.up();
    await settle(page);
    const buttons = await axButtons(page, '#chart .axylo-tooltip');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toMatch(/^North\s*\S+/);
    expect(buttons[1]).toMatch(/^South\s*\S+/);
    expect(await closePage(page)).toEqual([]);
  });

  it('a press on the secondary row held across an append that commits still selects that row, once', async () => {
    const page = await chartPage();
    await pinnedTwo(page);
    await recordEvents(page);
    const row = page.locator('#chart .axylo-tooltip button', { hasText: 'South' });
    const b = (await row.boundingBox())!;
    const before = await row.elementHandle();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.evaluate(() => window.charts[0]!.append([{ x: 3, s: 'North', y: 1 }]));
    await settle(page);
    expect(await page.evaluate(([a]) => (a as Element).isConnected, [before])).toBe(true);
    await page.mouse.up();
    await settle(page);
    const s = await selected(page);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ series: 'South', x: 2 });
    expect(await closePage(page)).toEqual([]);
  });

  it('ten coincident points of one series pinned: "+2 more" is a button that shows the other two, and each can be selected', async () => {
    const page = await chartPage();
    const data = [...Array.from({ length: 10 }, (_, i) => ({ x: 5, y: 5, s: 'A', id: i })), { x: 1, y: 1, s: 'A', id: 10 }, { x: 9, y: 9, s: 'A', id: 11 }];
    await create(page, 'scatter', { title: 'Same', data, x: 'x', y: 'y', series: 's' });
    await recordEvents(page);
    const p = await plotBox(page);
    await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await settle(page);
    const ids = new Set<number>();
    for (const e of await selected(page)) ids.add((e.row as { id: number }).id);
    const more = page.locator('#chart .axylo-tooltip button.axylo-tooltip-more');
    expect(await more.textContent()).toBe('+2 more');
    await more.click();
    await settle(page);
    const rows = page.locator('#chart .axylo-tooltip button.axylo-tooltip-row');
    expect(await rows.count()).toBe(2);
    for (let i = 0; i < 2; i++) {
      await rows.nth(i).click();
      await settle(page);
    }
    for (const e of await selected(page)) ids.add((e.row as { id: number }).id);
    // The pick's first, and the two that were past the eight.
    expect(ids.size).toBe(3);
    for (const id of ids) expect(id).toBeLessThan(10);
    expect(await closePage(page)).toEqual([]);
  });

  it('mutation 8: on a touch page, a tap on the second entry of a pinned strip selects exactly that series, x and row', async () => {
    const page = await chartPage({ hasTouch: true, css: '#chart { width: 220px; height: 420px; }' });
    const data = [0, 1, 2].flatMap(x => ['Na', 'So'].map((s, i) => ({ x, s, y: x + i * 3, id: `${s}${x}` })));
    await create(page, 'line', { title: 'Narrow', data, x: 'x', y: 'y', series: 's' });
    await recordEvents(page);
    const p = await plotBox(page);
    await page.touchscreen.tap(p.x + p.width / 2, p.y + p.height / 2);
    await settle(page);
    const entries = page.locator('#chart .axylo-readout button.axylo-readout-entry');
    expect(await entries.count()).toBe(2);
    const b = (await entries.nth(1).boundingBox())!;
    expect(b.height).toBeGreaterThanOrEqual(24);
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    await settle(page);
    const s = await selected(page);
    expect(s.at(-1)).toMatchObject({ series: 'So', x: 1, row: { id: 'So1' } });
    expect(await closePage(page)).toEqual([]);
  });

  it('a narrow strip always keeps the x and one row', async () => {
    const page = await chartPage({ css: '#chart { width: 200px; height: 420px; }' });
    const names = ['A very long series name indeed', 'Another very long series name', 'Third long name'];
    await create(page, 'line', { title: 'N', data: [0, 1].flatMap(x => names.map((s, i) => ({ x, s, y: i + x }))), x: 'x', y: 'y', series: 's' });
    const p = await plotBox(page);
    await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
    await settle(page);
    const text = (await strip(page)).text ?? '';
    expect(text).toMatch(/^\d: /);
    expect(await page.locator('#chart .axylo-readout .axylo-readout-entry').count()).toBeGreaterThanOrEqual(1);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('finding 9: a pin and a dismissal belong to the datum the reader chose', () => {
  async function single(page: Page): Promise<Pt> {
    await create(page, 'scatter', { title: 'P', data: [{ x: 5, y: 5, s: 'A' }, { x: 1, y: 1, s: 'B' }, { x: 9, y: 9, s: 'B' }], x: { field: 'x', domain: [0, 10] }, y: { field: 'y', domain: [0, 10] }, series: 's' });
    const p = await plotBox(page);
    return { x: p.x + p.width / 2, y: p.y + p.height / 2 };
  }

  it('pin A alone, append coincident B, hide A from the keyboard legend: the pin ends', async () => {
    const page = await chartPage();
    const at = await single(page);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.up();
    await settle(page);
    expect(await tip(page)).toMatchObject({ pinned: true });
    await page.evaluate(() => window.charts[0]!.append([{ x: 5, y: 5, s: 'B' }]));
    await settle(page);
    expect((await tip(page)).rows.length).toBe(2);
    const a = page.locator('#chart .axylo-legend-entry', { hasText: 'A' });
    await a.focus();
    await page.keyboard.press('Enter');
    await settle(page);
    expect((await tip(page)).pinned).toBe(false);
    expect(await closePage(page)).toEqual([]);
  });

  it('dismiss A with Escape, append coincident B under the still pointer: it stays closed', async () => {
    const page = await chartPage();
    const at = await single(page);
    await page.mouse.move(at.x, at.y);
    await frames(page, 2);
    expect((await tip(page)).title).not.toBeNull();
    await page.keyboard.press('Escape');
    await settle(page);
    expect((await tip(page)).title).toBeNull();
    await page.evaluate(() => window.charts[0]!.append([{ x: 5, y: 5, s: 'B' }]));
    await settle(page);
    expect((await tip(page)).title).toBeNull();
    expect(await closePage(page)).toEqual([]);
  });
});

describe('finding 10: the box is every displayed series at x, also in single-series mode', () => {
  it('narrowed to the lower series by the keyboard, the tooltip covers neither series\' point at that x', async () => {
    const page = await chartPage({ css: '#chart { width: 640px; height: 400px; }' });
    const data = [0, 5, 10].flatMap(x => [{ x, s: 'a', y: 40 }, { x, s: 'b', y: 52 }]);
    await create(page, 'line', { title: 'Close', data, x: { field: 'x', domain: [0, 10] }, y: { field: 'y', domain: [0, 100] }, series: 's' });
    await page.locator(proxy).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await settle(page);
    expect(await valueText(page)).toMatch(/^a, 5/);
    const p = await plotBox(page);
    const screen = (y: number): Pt => ({ x: p.x + p.width / 2, y: p.y + p.height * (1 - y / 100) });
    const t = (await tip(page)).box!;
    for (const y of [40, 52]) {
      const c = screen(y);
      expect(overlaps(t, { x: c.x - 6, y: c.y - 6, width: 12, height: 12 }), `the tooltip ${JSON.stringify(t)} covers the point at y ${y}`).toBe(false);
    }
    expect(await closePage(page)).toEqual([]);
  });
});

describe('finding 4 and mutation 4: placement inside the part of the plot that is visible', () => {
  it('in a card that clips the chart, the floating tooltip stays inside the card, and the pinned rows are the topmost element at their centres', async () => {
    const page = await chartPage({ css: '#card { width: 360px; height: 220px; overflow: hidden; margin-top: 40px; } #card #chart { width: 360px; height: 320px; }' });
    await page.evaluate(() => {
      const card = Object.assign(document.createElement('div'), { id: 'card' });
      const chart = document.getElementById('chart')!;
      chart.replaceWith(card);
      card.appendChild(chart);
    });
    const data = ['A', 'B', 'C', 'D'].flatMap(s => [0, 1, 2, 3].map(x => ({ x, s, y: x + s.charCodeAt(0) })));
    await create(page, 'line', { title: 'Clipped', data, x: 'x', y: 'y', series: 's' });
    const card = (await page.locator('#card').boundingBox())!;
    const p = await plotBox(page);
    const failures: string[] = [];
    for (const share of [0.1, 0.5, 0.9]) {
      const at = { x: p.x + p.width * share, y: Math.min(card.y + card.height - 10, p.y + p.height / 2) };
      await page.mouse.move(at.x, at.y);
      await settle(page);
      const t = (await tip(page)).box;
      if (!t) { failures.push(`share ${share}: no tooltip`); continue; }
      if (t.x < card.x - 0.5 || t.y < card.y - 0.5 || t.x + t.width > card.x + card.width + 0.5 || t.y + t.height > card.y + card.height + 0.5) failures.push(`share ${share}: ${JSON.stringify(t)} outside the card ${JSON.stringify(card)}`);
      await page.mouse.down();
      await page.mouse.up();
      await settle(page);
      for (const b of await page.locator('#chart .axylo-tooltip button').all()) {
        const r = (await b.boundingBox())!;
        const top = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.textContent ?? null, { x: r.x + r.width / 2, y: r.y + r.height / 2 });
        if (top !== (await b.textContent())) failures.push(`share ${share}: the row "${await b.textContent()}" is not hittable (${top})`);
      }
      await page.keyboard.press('Escape');
    }
    expect(failures).toEqual([]);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('finding 13: one mapping from fractional sizes under a transformed ancestor', () => {
  for (const transform of ['scale(1.015)', 'translate(13.3px, 7.7px) scale(1.25, 0.8)']) {
    it(`under ${transform}, pointing at each of the last bars' painted centres shows that bar`, async () => {
      if (RENDERER === 'canvas') return; // the painted centres are read from the SVG marks
      const page = await chartPage({ css: `#wrap { transform: ${transform}; transform-origin: 0 0; width: 640px; } #chart { width: 620px; height: 360px; }` });
      await page.evaluate(() => {
        const wrap = Object.assign(document.createElement('div'), { id: 'wrap' });
        const chart = document.getElementById('chart')!;
        chart.replaceWith(wrap);
        wrap.appendChild(chart);
      });
      const names = Array.from({ length: 40 }, (_, i) => `C${i}`);
      await create(page, 'bar', { title: 'Many', data: names.map((x, i) => ({ x, y: 10 + (i % 5) })), x: 'x', y: 'y' });
      const bars: DrawnShape[] = ((await drawnShapes(page, 100000))[1] ?? []).filter(b => b.sub === 'rect').sort((a, b) => a.box.x - b.box.x);
      const p = await plotBox(page);
      const failures: string[] = [];
      const view = await page.evaluate(() => ({ x: 0, y: 0, width: document.documentElement.clientWidth, height: document.documentElement.clientHeight }));
      const shown = bars.filter(b => inside({ x: b.box.x + b.box.width / 2, y: b.box.y + b.box.height / 2 }, p) && inside({ x: b.box.x + b.box.width / 2, y: b.box.y + b.box.height / 2 }, view));
      for (const bar of shown.slice(-6)) {
        const k = bars.indexOf(bar);
        await page.mouse.move(bar.box.x + bar.box.width / 2, bar.box.y + bar.box.height / 2);
        await frames(page, 2);
        const title = (await tip(page)).title;
        if (title !== names[k]) failures.push(`bar ${names[k]} shows ${title}`);
      }
      expect(shown.length).toBeGreaterThan(6);
      expect(failures).toEqual([]);
      expect(await closePage(page)).toEqual([]);
    });
  }
});

describe('mutation 9: narrowed scatter driven by input and by change alone, then after an append', () => {
  for (const form of ['input', 'change'] as const) {
    it(`A0 B1 A2 B3 A4, narrowed to B, set to 2 by ${form} only: A2 and every series; append A5, Right: B3`, async () => {
      const page = await chartPage();
      const data = [0, 1, 2, 3, 4].map(x => ({ x, y: x, s: x % 2 ? 'B' : 'A' }));
      await create(page, 'scatter', { title: 'N', data, x: 'x', y: 'y', series: 's' });
      await page.locator(proxy).focus();
      await page.keyboard.press('ArrowDown');
      await settle(page);
      expect(await valueText(page)).toMatch(/^B, /);
      await page.evaluate(form => {
        const el = document.querySelector('#chart .axylo-proxy') as HTMLInputElement;
        el.value = '2';
        el.dispatchEvent(new Event(form, { bubbles: true }));
      }, form);
      await settle(page);
      expect(await valueText(page)).toMatch(/^A, 2, 2\. Point 3 of 5/);
      expect(await page.locator(proxy).inputValue()).toBe('2');
      await page.evaluate(() => window.charts[0]!.append([{ x: 5, y: 5, s: 'A' }]));
      await settle(page);
      await page.keyboard.press('ArrowRight');
      await settle(page);
      expect(await valueText(page)).toMatch(/^B, 3, 3\. Point 4 of 6/);
      expect(await page.locator(proxy).inputValue()).toBe('3');
      expect(await closePage(page)).toEqual([]);
    });
  }
});

describe('mutation 10: every plotted area marker matches its legend and tooltip swatch', () => {
  it('eight area series: the shape drawn for each series is the shape in its legend entry and its tooltip row', async () => {
    if (RENDERER === 'canvas') return; // plotted shapes are read from the SVG marks
    const page = await chartPage({ css: '#chart { width: 900px; height: 480px; }' });
    const eight = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const day = (k: number) => new Date(Date.UTC(2026, 0, 1) + k * 864e5).toISOString().slice(0, 10);
    await create(page, 'area', { title: 'Areas', data: Array.from({ length: 60 }, (_, k) => eight.map((s, i) => ({ day: day(k), s, v: 10 * i + (k % 5) }))).flat(), x: { field: 'day', type: 'date' }, y: 'v', series: 's' });
    const drawn = await drawnShapes(page, 14);
    const common = (list: DrawnShape[]) => {
      const n = new Map<string, number>();
      for (const d of list) n.set(signature(d.sub), (n.get(signature(d.sub)) ?? 0) + 1);
      return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    };
    const plotted = eight.map((_, i) => common(drawn[i + 1] ?? []));
    const swatches = async (where: string) => (await page.locator(`#chart ${where}`).evaluateAll(els => els.map(e => e.querySelector('.axylo-swatch-marker')?.getAttribute('d') ?? '')))
      .map(d => d ? signature(d.split(/(?=M)/)[0]!) : '');
    expect(plotted.every(s => s !== ''), JSON.stringify(plotted)).toBe(true);
    expect(await swatches('.axylo-legend-entry')).toEqual(plotted);
    const p = await plotBox(page);
    await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
    await settle(page);
    expect(await swatches('.axylo-tooltip-row')).toEqual(plotted);
    expect(new Set(plotted).size).toBeGreaterThanOrEqual(4);
    expect(await closePage(page)).toEqual([]);
  });
});

void (null as unknown as Box);

/** A marker's identity whatever its size and place: its commands and its vertices scaled to its box, rounded. */
function signature(sub: string): string {
  if (/A/i.test(sub)) return 'round';
  const nums = (sub.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
  const pts: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i]!, nums[i + 1]!]);
  if (!pts.length) return '';
  const x0 = Math.min(...pts.map(p => p[0])), y0 = Math.min(...pts.map(p => p[1]));
  const size = Math.max(Math.max(...pts.map(p => p[0])) - x0, Math.max(...pts.map(p => p[1])) - y0) || 1;
  return [...new Set(pts.map(([x, y]) => `${Math.round(4 * (x - x0) / size)},${Math.round(4 * (y - y0) / size)}`))].sort().join(' ');
}
