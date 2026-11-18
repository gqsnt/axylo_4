/**
 * The cross-provider verification of the interaction rewrite (reviews/2026-11-18/impl/wp/fixes-verify.interaction.review.md,
 * "New defects"), each with the reviewer's event sequence, against decision 0004 revision 3 and its
 * clarifications after the verification.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { start, stop } from '../harness';
import { RENDERER, chartPage, closePage } from './util';
import { TALL, create, frames, inside, lastHover, nearestInside, plotBox, recordEvents, selected, settle, tip, walk, type Box, type Pt } from './final-util';

beforeAll(start);
afterAll(stop);

const proxy = '#chart .axylo-proxy';
const valueText = (page: Page) => page.locator(proxy).getAttribute('aria-valuetext');

/** Dispatches a pointer event of `type` on the plot, as the browser would, at a viewport point. */
async function pointer(page: Page, type: string, at: Pt, pointerType = 'touch', id = 11): Promise<void> {
  await page.evaluate(({ type, at, pointerType, id }) => {
    const plot = document.querySelector('#chart .axylo-plot')!;
    plot.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: id, pointerType, isPrimary: true, clientX: at.x, clientY: at.y, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
  }, { type, at, pointerType, id });
}

describe('1: activation picks what the release or the range says', () => {
  it('a touch down 1 px inside A\'s half and lifted 2 px away in B\'s, with no move between, selects B', async () => {
    const page = await chartPage({ hasTouch: true });
    await create(page, 'line', { title: 'T', data: [0, 1, 2, 3].map(x => ({ x, y: x })), x: { field: 'x', domain: [0, 3] }, y: 'y' });
    await recordEvents(page);
    const p = await plotBox(page);
    // The boundary between x = 1 and x = 2 is the plot's middle.
    const mid = p.x + p.width / 2;
    await pointer(page, 'pointerdown', { x: mid - 1, y: p.y + p.height / 2 });
    await pointer(page, 'pointerup', { x: mid + 1, y: p.y + p.height / 2 });
    await settle(page);
    const s = await selected(page);
    expect(s).toHaveLength(1);
    expect(s[0]!.x).toBe(2);
    expect(await closePage(page)).toEqual([]);
  });

  it('Enter selects the datum the focused range describes, not the one under the pointer', async () => {
    const page = await chartPage();
    await create(page, 'line', { title: 'T', data: [0, 1, 2, 3].map(x => ({ x, y: x })), x: 'x', y: 'y' });
    await recordEvents(page);
    await page.locator(proxy).focus();
    await page.keyboard.press('Home');
    expect(await valueText(page)).toMatch(/^0\. /);
    const p = await plotBox(page);
    await page.mouse.move(p.x + p.width - 2, p.y + p.height / 2);
    await settle(page);
    await page.keyboard.press('Enter');
    await settle(page);
    expect((await selected(page)).map(e => e.x)).toEqual([0]);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('2: a pin is one DatumRef', () => {
  it('pin aligned A at x = 1, hide A from the keyboard legend while B remains: the pin ends, it does not become B', async () => {
    const page = await chartPage();
    const data = [0, 1, 2].flatMap(x => [{ x, s: 'A', y: x + 1 }, { x, s: 'B', y: x + 5 }]);
    await create(page, 'line', { title: 'T', data, x: { field: 'x', domain: [0, 2] }, y: 'y', series: 's' });
    await recordEvents(page);
    const p = await plotBox(page);
    await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await settle(page);
    expect(await tip(page)).toMatchObject({ title: '1', pinned: true });
    expect((await selected(page)).at(-1)).toMatchObject({ series: 'A', x: 1 });
    await page.locator('#chart .axylo-legend-entry', { hasText: 'A' }).focus();
    await page.keyboard.press('Enter');
    await settle(page);
    expect((await tip(page)).pinned).toBe(false);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('3: no pin is held with nothing shown', () => {
  it('pin a point, start a drag, Escape, move over another point: that point\'s tooltip shows', async () => {
    const page = await chartPage();
    await create(page, 'line', { title: 'T', data: Array.from({ length: 11 }, (_, x) => ({ x, y: x })), x: { field: 'x', domain: [0, 10] }, y: 'y' });
    const p = await plotBox(page);
    const at = (x: number): Pt => ({ x: p.x + (x / 10) * p.width, y: p.y + p.height / 2 });
    await page.mouse.move(at(3).x, at(3).y);
    await page.mouse.down();
    await page.mouse.up();
    await settle(page);
    const pinnedTip = await tip(page);
    expect(pinnedTip).toMatchObject({ title: '3', pinned: true });
    // The drag starts on the plot, where the pinned tooltip (which takes the pointer) is not.
    const b = pinnedTip.box!;
    const y = b.y > p.y + p.height / 2 ? p.y + 6 : p.y + p.height - 6;
    await page.mouse.move(at(3).x, y);
    await page.mouse.down();
    await page.mouse.move(at(5).x, y, { steps: 4 });
    // The drag is under way: the selection is drawn.
    expect(await page.locator('#chart .axylo-selection').isVisible()).toBe(true);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await settle(page);
    await page.mouse.move(at(8).x, at(8).y);
    await settle(page);
    expect(await tip(page)).toMatchObject({ title: '8', pinned: false });
    expect(await closePage(page)).toEqual([]);
  });
});

describe('4: fit is judged on what can be seen', () => {
  it('a chart clipped to a short visible band, eight series pinned: the tooltip\'s rows and its "+N more" lie wholly inside it, and it inside the card', async () => {
    const page = await chartPage({ css: '#card { width: 640px; height: 170px; overflow: hidden; } #card #chart { width: 640px; height: 420px; }' });
    await page.evaluate(() => {
      const card = Object.assign(document.createElement('div'), { id: 'card' });
      const chart = document.getElementById('chart')!;
      chart.replaceWith(card);
      card.appendChild(chart);
    });
    const series = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    await create(page, 'line', { title: 'Clip', legend: false, data: [0, 1, 2, 3].flatMap(x => series.map((s, i) => ({ x, s, y: i + x }))), x: 'x', y: 'y', series: 's' });
    const card = (await page.locator('#card').boundingBox())!;
    const p = await plotBox(page);
    await page.mouse.move(p.x + p.width * 0.35, Math.min(card.y + card.height - 8, p.y + 20));
    await page.mouse.down();
    await page.mouse.up();
    await settle(page);
    const t = await page.evaluate(() => {
      const el = document.querySelector('#chart .axylo-tooltip') as HTMLElement;
      if (el.hidden) return null;
      const box = el.getBoundingClientRect();
      const parts = [...el.children].map(c => c.getBoundingClientRect());
      return { box: { x: box.x, y: box.y, width: box.width, height: box.height }, cut: parts.filter(r => r.bottom > box.bottom + 0.5 || r.right > box.right + 0.5).length, rows: el.querySelectorAll('button').length };
    });
    if (t) {
      expect(t.cut).toBe(0);
      expect(t.box.y + t.box.height).toBeLessThanOrEqual(card.y + card.height + 0.5);
      expect(t.rows).toBeGreaterThanOrEqual(1);
    } else {
      // Nothing visible could be shown: then nothing is pinned either.
      expect((await tip(page)).pinned).toBe(false);
    }
    expect(await closePage(page)).toEqual([]);
  });

  it('a strip its card clips away entirely is not shown, and a click on the plot holds no pin', async () => {
    // A 220 px tile (readout mode) in a card that ends at the plot's bottom: the strip is wholly cut off.
    const page = await chartPage({ css: '#card { width: 220px; overflow: hidden; } #card #chart { width: 220px; height: 400px; }' });
    await page.evaluate(() => {
      const card = Object.assign(document.createElement('div'), { id: 'card' });
      const chart = document.getElementById('chart')!;
      chart.replaceWith(card);
      card.appendChild(chart);
    });
    await create(page, 'line', { title: 'S', legend: false, table: false, data: [0, 1, 2].map(x => ({ x, y: x })), x: 'x', y: 'y' });
    const p = await plotBox(page);
    await page.evaluate(h => { document.getElementById('card')!.style.height = `${h}px`; }, p.y + p.height - (await page.locator('#card').boundingBox())!.y);
    await settle(page);
    await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await settle(page);
    expect(await page.locator('#chart .axylo-readout').evaluate(el => (el as HTMLElement).hidden)).toBe(true);
    expect(await page.locator('#chart .axylo-readout-pinned').count()).toBe(0);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('5: the visible region follows the composed clipping chain', () => {
  it('a chart in a shadow root inside a clipping card: its tooltip stays inside the card; a press on a pinned row keeps the pin', async () => {
    const page = await chartPage({ css: '#card { width: 360px; overflow: hidden; margin-top: 30px; }' });
    await page.evaluate(() => {
      const card = Object.assign(document.createElement('div'), { id: 'card' });
      document.getElementById('chart')!.replaceWith(card);
      const host = document.createElement('div');
      card.appendChild(host);
      const root = host.attachShadow({ mode: 'open' });
      // The page's stylesheets (the library's among them) apply inside the shadow root too.
      for (const sheet of document.querySelectorAll('style, link[rel="stylesheet"]')) root.appendChild(sheet.cloneNode(true));
      const inner = Object.assign(document.createElement('div'), { id: 'chart' });
      inner.style.cssText = 'width: 360px; height: 360px;';
      root.appendChild(inner);
      (window as unknown as { shadowChart: HTMLElement }).shadowChart = inner;
    });
    await page.evaluate(async () => {
      const target = (window as unknown as { shadowChart: HTMLElement }).shadowChart;
      // Points on the plot's top edge: above them there is no room, below them the card ends soon.
      const series = ['A', 'B'];
      const chart = window.Axylo.line!(target, { title: 'Shadow', data: [0, 1, 2, 3].flatMap(x => series.map(s => ({ x, s, y: 10 }))), x: 'x', y: { field: 'y', domain: [0, 10] }, series: 's' });
      window.charts.push(chart);
      await chart.__bench.ready();
      await window.nextFrames(2);
    });
    const geometry = () => page.evaluate(() => {
      const root = (window as unknown as { shadowChart: HTMLElement }).shadowChart;
      const t = root.querySelector('.axylo-tooltip') as HTMLElement;
      const p = root.querySelector('.axylo-proxy')!.getBoundingClientRect();
      const b = t.getBoundingClientRect();
      return { hidden: t.hidden, tip: { x: b.x, y: b.y, width: b.width, height: b.height }, plot: { x: p.x, y: p.y, width: p.width, height: p.height }, pinned: t.classList.contains('axylo-tooltip-pinned') };
    });
    let g = await geometry();
    // The card ends 60 px below the plot's top: a tooltip below the points would pass its edge.
    await page.evaluate(h => { document.getElementById('card')!.style.height = `${h}px`; }, g.plot.y + 60 - (await page.locator('#card').boundingBox())!.y);
    await settle(page);
    g = await geometry();
    const card = (await page.locator('#card').boundingBox())!;
    await page.mouse.move(g.plot.x + g.plot.width / 3, g.plot.y + 4);
    await settle(page);
    g = await geometry();
    if (!g.hidden) {
      expect(g.tip.y + g.tip.height).toBeLessThanOrEqual(card.y + card.height + 0.5);
      expect(g.tip.x + g.tip.width).toBeLessThanOrEqual(card.x + card.width + 0.5);
    }
    await page.mouse.down();
    await page.mouse.up();
    await settle(page);
    g = await geometry();
    if (!g.hidden && g.pinned) {
      const row = await page.evaluate(() => {
        const b = (window as unknown as { shadowChart: HTMLElement }).shadowChart.querySelector('.axylo-tooltip button')!.getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      });
      await page.mouse.move(row.x, row.y);
      await page.mouse.down();
      await settle(page);
      expect((await geometry()).pinned, 'a press on a pinned row inside the shadow root is not a press outside').toBe(true);
      await page.mouse.up();
    }
    expect(await closePage(page)).toEqual([]);
  });
});

/** The tall bars at 640 × 360 and the resting point on Q3. */
async function tallBars(page: Page): Promise<{ at: Pt; p: Box }> {
  await create(page, 'bar', { title: 'Tall', data: TALL, x: 'x', y: 'y' });
  const p = await plotBox(page);
  return { at: { x: p.x + p.width * (2.5 / 6), y: p.y + p.height * 0.6 }, p };
}

describe('6: the rest clock and the hold\'s geometry', () => {
  it('a redraw that puts another datum under the still pointer restarts the rest: restoring A and moving on at once does not hold A', async () => {
    const page = await chartPage({ css: '#chart { width: 640px; height: 360px; }' });
    await create(page, 'line', { title: 'R', data: Array.from({ length: 11 }, (_, x) => ({ x, y: 5 })), x: 'x', y: { field: 'y', domain: [0, 10] } });
    const p = await plotBox(page);
    const at = { x: p.x + 0.3 * p.width, y: p.y + p.height / 2 };
    await page.mouse.move(at.x, at.y);
    await frames(page, 2);
    const first = await tip(page);
    expect(first.title).toBe('3');
    // Within one epoch: a zoom puts another x under the still pointer, then the full view puts 3 back.
    await page.waitForTimeout(100);
    await page.evaluate(() => window.charts[0]!.zoom([2, 10]));
    await settle(page);
    expect((await tip(page)).title).not.toBe('3');
    await page.waitForTimeout(170);
    await page.evaluate(() => window.charts[0]!.zoom(null));
    await settle(page);
    expect((await tip(page)).title).toBe('3');
    // Less than 250 ms since 3 came back: to the far side of its tooltip, over x = 4's half of the plot,
    // which a hold from the first rest (more than 250 ms ago) would keep on 3.
    const over = { x: first.box!.x + first.box!.width - 3, y: first.box!.y + first.box!.height / 2 };
    expect(over.x, 'the tooltip reaches past the midpoint to x = 4').toBeGreaterThan(p.x + 0.35 * p.width);
    const seen = await walk(page, at, over, 4, async () => (await tip(page)).title);
    expect(seen.at(-1)).toBe('4');
    expect(await closePage(page)).toEqual([]);
  });

  it('Escape while held: the content stays closed, and the datum under the still pointer is the one reported at once', async () => {
    const page = await chartPage({ css: '#chart { width: 640px; height: 360px; }' });
    const { at, p } = await tallBars(page);
    await recordEvents(page);
    await page.mouse.move(at.x, at.y);
    await frames(page, 2);
    const first = await tip(page);
    await page.waitForTimeout(320);
    const target = nearestInside(first.box!, at);
    const over = { x: Math.max(target.x, p.x + p.width / 2 + 4), y: target.y };
    expect(inside(over, first.box!)).toBe(true);
    await walk(page, at, over, 10, async () => null);
    expect((await tip(page)).title).toBe('Q3');
    await page.keyboard.press('Escape');
    await settle(page);
    expect((await tip(page)).title).toBeNull();
    expect(await lastHover(page)).toMatchObject({ x: 'Q4' });
    expect(await closePage(page)).toEqual([]);
  });
});

describe('7: a dismissal belongs to the ref chosen, not to the sampled rows', () => {
  it('dismiss scatter A, append fifteen coincident B under the still pointer: it stays closed', async () => {
    const page = await chartPage();
    await create(page, 'scatter', { title: 'P', data: [{ x: 5, y: 5, s: 'A' }, { x: 1, y: 1, s: 'B' }, { x: 9, y: 9, s: 'B' }], x: { field: 'x', domain: [0, 10] }, y: { field: 'y', domain: [0, 10] }, series: 's' });
    const p = await plotBox(page);
    await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
    await frames(page, 2);
    expect((await tip(page)).title).not.toBeNull();
    await page.keyboard.press('Escape');
    await settle(page);
    expect((await tip(page)).title).toBeNull();
    await page.evaluate(() => window.charts[0]!.append(Array.from({ length: 15 }, () => ({ x: 5, y: 5, s: 'B' }))));
    await settle(page);
    expect((await tip(page)).title).toBeNull();
    expect(await closePage(page)).toEqual([]);
  });
});

describe('9: a press completes against the row it began on; focus survives a change of presentation', () => {
  it('pin scatter A near the top, press its row, append a later coincident B above it, release: A is selected, once', async () => {
    const page = await chartPage();
    await create(page, 'scatter', { title: 'P', data: [{ x: 5, y: 9.5, s: 'A' }, { x: 1, y: 1, s: 'B' }], x: { field: 'x', domain: [0, 10] }, y: { field: 'y', domain: [0, 10] }, series: 's' });
    await recordEvents(page);
    const p = await plotBox(page);
    await page.mouse.move(p.x + p.width / 2, p.y + p.height * 0.05);
    await page.mouse.down();
    await page.mouse.up();
    await settle(page);
    const before = await selected(page);
    const row = (await page.locator('#chart .axylo-tooltip button.axylo-tooltip-row').first().boundingBox())!;
    await page.mouse.move(row.x + row.width / 2, row.y + row.height / 2);
    await page.mouse.down();
    await page.evaluate(() => window.charts[0]!.append([{ x: 5, y: 9.5, s: 'B' }]));
    await settle(page);
    await page.mouse.up();
    await settle(page);
    const after = (await selected(page)).slice(before.length);
    expect(after).toHaveLength(1);
    expect(after[0]!.series).toBe('A');
    expect(await closePage(page)).toEqual([]);
  });

  it('a focused pinned row keeps focus when the plot changes from floating to the strip', async () => {
    const page = await chartPage({ css: '#chart { width: 640px; height: 360px; }' });
    const data = [0, 1, 2].flatMap(x => ['North', 'South'].map((s, i) => ({ x, s, y: x + i * 3 })));
    await create(page, 'line', { title: 'Two', data, x: 'x', y: 'y', series: 's' });
    const p = await plotBox(page);
    await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await settle(page);
    await page.locator('#chart .axylo-tooltip button', { hasText: 'South' }).focus();
    await page.evaluate(() => { document.getElementById('chart')!.style.width = '220px'; });
    await settle(page);
    await frames(page, 3);
    const focused = await page.evaluate(() => ({ inStrip: !!document.activeElement?.closest('.axylo-readout'), text: document.activeElement?.textContent ?? '', inChart: !!document.activeElement?.closest('#chart') }));
    expect(focused.inChart).toBe(true);
    if (focused.inStrip) expect(focused.text).toMatch(/^South/);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('10: a narrowed category that slides keeps its text', () => {
  it('narrowed to Q3 (value 3) in Q1–Q4, append Q5 with keep 4: the value text is not rewritten', async () => {
    const page = await chartPage();
    await create(page, 'bar', { title: 'B', data: ['Q1', 'Q2', 'Q3', 'Q4'].map((x, i) => ({ x, y: i + 1 })), x: 'x', y: 'y' });
    await page.locator(proxy).focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await settle(page);
    const before = await valueText(page);
    expect(before).toMatch(/Q3, 3\. Point 3 of 4/);
    await page.evaluate(() => window.charts[0]!.append([{ x: 'Q5', y: 5 }], { keep: 4 }));
    await settle(page);
    expect(await valueText(page)).toBe(before);
    expect(await page.locator(proxy).inputValue()).toBe('1');
    expect(await closePage(page)).toEqual([]);
  });
});

describe('12: slice list focus, the jump field\'s own strings, language with each reading', () => {
  it('an all-zero donut\'s focused second entry keeps focus when another entry\'s text changes', async () => {
    const page = await chartPage({ css: '#before, #after { display: inline-block !important; }' });
    await create(page, 'donut', { title: 'Z', table: false, data: [{ k: 'a', v: 0 }, { k: 'b', v: 0 }, { k: 'c', v: 0 }], label: 'k', value: 'v' });
    await page.focus('#before');
    await page.keyboard.press('Tab');
    await page.keyboard.press('ArrowDown');
    expect(await page.evaluate(() => document.activeElement?.closest('li')?.dataset.key)).toBe('b');
    await page.evaluate(() => window.charts[0]!.update({ data: [{ k: 'a', v: 0 }, { k: 'b', v: 0 }, { k: 'c', v: null }] }));
    await settle(page);
    expect(await page.evaluate(() => document.activeElement?.closest('li')?.dataset.key)).toBe('b');
    expect(await closePage(page)).toEqual([]);
  });

  it('the jump field accepts the chart\'s own Arabic negative with its unit, and its own German date', async () => {
    const page = await chartPage();
    await create(page, 'line', { title: 'A', locale: 'ar-EG', data: Array.from({ length: 250 }, (_, i) => ({ x: -1234.5 + i * 10, y: i })), x: { field: 'x', unit: 'ms' }, y: 'y' });
    await page.locator('#chart button', { hasText: 'View as table' }).click();
    const field = page.locator('#chart .axylo-jump-field');
    // What the chart writes for x = -1,234.5 in ar-EG with its unit, made here with Intl as the chart does.
    const arabic = await page.evaluate(() => `${new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 6 }).format(-1234.5)} ms`);
    const cells = await page.locator('#chart .axylo-table tbody th').allTextContents();
    expect(cells.map(c => c.replace(/\s+/g, ' '))).toContain(arabic.replace(/\s+/g, ' '));
    await field.fill(arabic);
    await page.keyboard.press('Enter');
    expect(await field.getAttribute('aria-invalid'), arabic).toBeNull();
    await page.evaluate(() => window.charts.pop()!.destroy());
    const days = Array.from({ length: 200 }, (_, i) => ({ d: new Date(Date.UTC(2026, 0, 1) + i * 864e5).toISOString().slice(0, 10), y: i }));
    await create(page, 'line', { title: 'D', locale: 'de-DE', data: days, x: 'd', y: 'y' });
    await page.locator('#chart button', { hasText: 'View as table' }).click();
    const german = await page.evaluate(() => new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 4, 31))));
    const dates = await page.locator('#chart .axylo-table tbody th').allTextContents();
    await page.locator('#chart .axylo-pager button', { hasText: 'Next page' }).click();
    dates.push(...await page.locator('#chart .axylo-table tbody th').allTextContents());
    expect(dates, `the chart writes ${german}`).toContain(german);
    await page.locator('#chart .axylo-pager button', { hasText: 'Previous page' }).click();
    await page.locator('#chart .axylo-jump-field').fill(german);
    await page.keyboard.press('Enter');
    expect(await page.locator('#chart .axylo-jump-field').getAttribute('aria-invalid'), german).toBeNull();
    expect(await page.locator('#chart .axylo-page').textContent()).toMatch(/2/);
    expect(await closePage(page)).toEqual([]);
  });

  it('on a German page with pointAll translated, single mode\'s built-in pointOf is marked English as soon as it is read; a jump error carries its template\'s language', async () => {
    const page = await chartPage();
    await page.evaluate(() => document.documentElement.setAttribute('lang', 'de'));
    // 150 x positions, so the table has a pager and its jump field.
    const data = Array.from({ length: 150 }, (_, x) => ['a', 'b'].map((s, i) => ({ x, s, y: x + i }))).flat();
    await create(page, 'line', { title: 'T', messages: { pointAll: '{x}: {values}. {position}' }, data, x: 'x', y: 'y', series: 's' });
    await page.locator(proxy).focus();
    await page.keyboard.press('ArrowRight');
    expect(await page.locator(proxy).getAttribute('lang')).toBeNull();
    // No frame in between: the language goes with the reading.
    const lang = await page.evaluate(() => {
      const el = document.querySelector('#chart .axylo-proxy') as HTMLElement;
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      return el.getAttribute('lang');
    });
    expect(lang).toBe('en');
    await page.locator('#chart button', { hasText: 'View as table' }).click();
    await page.locator('#chart .axylo-jump-field').fill('nichts');
    await page.keyboard.press('Enter');
    expect(await page.locator('#chart .axylo-jump-error').getAttribute('lang')).toBe('en');
    expect(await closePage(page)).toEqual([]);
  });
});

describe('epoch replacement (the DOM half of C3-5)', () => {
  it('a full data replacement while the plot is focused: the text, the ring and Enter agree on the new first datum', async () => {
    const page = await chartPage();
    await create(page, 'line', { title: 'E', data: [0, 1, 2].map(x => ({ x, y: x })), x: 'x', y: 'y' });
    await recordEvents(page);
    await page.locator(proxy).focus();
    await page.keyboard.press('End');
    await settle(page);
    await page.evaluate(() => window.charts[0]!.update({ data: [10, 11, 12, 13].map(x => ({ x, y: x * 2 })) }));
    await settle(page);
    expect(await valueText(page)).toMatch(/^10\. y 20\. Point 1 of 4/);
    expect((await tip(page)).title).toBe('10');
    if (RENDERER !== 'canvas') {
      const ring = await page.evaluate(() => [...document.querySelectorAll('#chart .axylo-overlay *')].filter(e => /--axylo(?:-default)?-focus/.test(e.getAttribute('style') ?? '')).length);
      expect(ring).toBeGreaterThan(0);
    }
    await page.keyboard.press('Enter');
    await settle(page);
    expect((await selected(page)).at(-1)).toMatchObject({ x: 10, y: 20 });
    expect(await closePage(page)).toEqual([]);
  });
});

describe('the focus ring after a click and a key, in every engine (spec A2, WCAG 2.4.7)', () => {
  it('click the plot, then ArrowRight: the ring is displayed, on the datum the range describes', async () => {
    const page = await chartPage();
    await create(page, 'line', { title: 'K', data: Array.from({ length: 11 }, (_, x) => ({ x, y: 5 })), x: { field: 'x', domain: [0, 10] }, y: { field: 'y', domain: [0, 10] } });
    const p = await plotBox(page);
    const outline = () => page.locator('#chart .axylo-focus-ring').evaluate(el => getComputedStyle(el).display);
    /** The focus-coloured strokes of the overlay (SVG), as one box in viewport pixels. */
    const ringBox = () => page.evaluate(() => {
      const els = [...document.querySelectorAll('#chart .axylo-overlay *')].filter(e => /--axylo(?:-default)?-focus/.test(e.getAttribute('style') ?? '')) as SVGGraphicsElement[];
      if (!els.length) return null;
      const r = els.map(e => e.getBoundingClientRect());
      const x0 = Math.min(...r.map(b => b.left)), x1 = Math.max(...r.map(b => b.right));
      return { cx: (x0 + x1) / 2 };
    });
    await page.mouse.move(p.x + 0.3 * p.width, p.y + p.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await settle(page);
    expect(await page.evaluate(() => document.activeElement?.className)).toContain('axylo-proxy');
    // What a click alone shows is left to the engine's :focus-visible (all three match it on this range
    // after a click, observed 2026-11-18); only the key's effect is the rule here.
    await page.keyboard.press('ArrowRight');
    await settle(page);
    expect(await valueText(page)).toMatch(/^4\. /);
    expect(await outline()).toBe('block');
    if (RENDERER !== 'canvas') {
      const ring = await ringBox();
      expect(ring).not.toBeNull();
      expect(Math.abs(ring!.cx - (p.x + 0.4 * p.width))).toBeLessThanOrEqual(2);
    }
    expect(await closePage(page)).toEqual([]);
  });
});

describe('the focus ring after a mouse interaction elsewhere in the chart, then focus and a key', () => {
  it('click Zoom in with the mouse, focus the plot from script, ArrowRight: the plot\'s ring is displayed', async () => {
    const page = await chartPage();
    await create(page, 'line', { title: 'K', data: Array.from({ length: 21 }, (_, x) => ({ x, y: 5 })), x: 'x', y: 'y' });
    await page.locator('#chart [role="toolbar"] button', { hasText: 'Zoom in' }).click();
    await settle(page);
    await page.locator(proxy).focus();
    await page.keyboard.press('ArrowRight');
    await settle(page);
    expect(await page.locator('#chart .axylo-focus-ring').evaluate(el => getComputedStyle(el).display)).toBe('block');
    expect(await closePage(page)).toEqual([]);
  });
});

describe('decision 0004, clarifications after the verification', () => {
  it('a key that leaves the reader on the same datum (Home on the first point) keeps the pin and the text', async () => {
    const page = await chartPage();
    await create(page, 'line', { title: 'H', data: Array.from({ length: 5 }, (_, x) => ({ x, y: x })), x: { field: 'x', domain: [0, 4] }, y: 'y' });
    const p = await plotBox(page);
    await page.mouse.move(p.x + 2, p.y + p.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await settle(page);
    expect(await tip(page)).toMatchObject({ title: '0', pinned: true });
    const text = await valueText(page);
    await page.keyboard.press('Home');
    await settle(page);
    expect(await tip(page)).toMatchObject({ title: '0', pinned: true });
    expect(await valueText(page)).toBe(text);
    // A real move releases it.
    await page.keyboard.press('ArrowRight');
    await settle(page);
    expect(await tip(page)).toMatchObject({ title: '1', pinned: false });
    expect(await closePage(page)).toEqual([]);
  });

  it('an x where no series has a mark anchors its tooltip at that x on the plot\'s vertical middle', async () => {
    const page = await chartPage({ css: '#chart { width: 640px; height: 360px; }' });
    const data = [0, 1, 2, 3, 4].flatMap(x => ['a', 'b'].map(s => ({ x, s, y: x === 1 ? null : x + (s === 'a' ? 0 : 1) })));
    await create(page, 'line', { title: 'G', data, x: { field: 'x', domain: [0, 4] }, y: 'y', series: 's' });
    const p = await plotBox(page);
    const at = p.x + p.width / 4;
    await page.mouse.move(at, p.y + p.height / 2);
    await settle(page);
    const t = await tip(page);
    expect(t.title).toBe('1');
    // Centred on that x (it fits without a shift), above or below the plot's middle.
    expect(Math.abs(t.box!.x + t.box!.width / 2 - at)).toBeLessThanOrEqual(1);
    const middle = p.y + p.height / 2;
    expect(t.box!.y + t.box!.height <= middle || t.box!.y >= middle).toBe(true);
    expect(await closePage(page)).toEqual([]);
  });
});
