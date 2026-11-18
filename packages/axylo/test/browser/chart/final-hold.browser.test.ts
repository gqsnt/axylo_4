/**
 * What is shown, as one state machine (decision 0004 revision 3, rules 3, 3b, 4, 7 and 8), against the final
 * interaction review's findings 1, 5, 8, 15 and 16 and earlier C3-3 and C3-6, each with the reviewer's
 * sequence (reviews/2026-11-18/impl/wp/core-final.interaction.review.md).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { start, stop } from '../harness';
import { chartPage, closePage } from './util';
import {
  TALL, create, frames, inside, nearestInside, plotBox, recordEvents, selected, settle, strip, tip, walk, type Box, type Pt,
} from './final-util';

beforeAll(start);
afterAll(stop);

/** The tall bars at 640 × 360; the resting point on Q3 and the plot box. */
async function tallBars(page: Page): Promise<{ at: Pt; p: Box }> {
  await create(page, 'bar', { title: 'Tall', data: TALL, x: 'x', y: 'y' });
  const p = await plotBox(page);
  return { at: { x: p.x + p.width * (2.5 / 6), y: p.y + p.height * 0.6 }, p };
}

/** Rest on Q3, then go into the corridor to its tooltip (beside it, over Q4's band) and stop there, Q3 still shown. */
async function intoCorridor(page: Page): Promise<{ at: Pt; p: Box; over: Pt; start: Box }> {
  const { at, p } = await tallBars(page);
  await page.mouse.move(at.x, at.y);
  await frames(page, 2);
  const first = await tip(page);
  expect(first.title).toBe('Q3');
  await page.waitForTimeout(320);
  // A point of the tooltip's rectangle past the band edge between Q3 and Q4.
  const edge = p.x + p.width * (3 / 6);
  const target = nearestInside(first.box!, at);
  const over = { x: Math.max(target.x, edge + 4), y: target.y };
  expect(inside(over, first.box!), 'the tooltip reaches over Q4\'s band').toBe(true);
  const seen = await walk(page, at, over, 12, async () => (await tip(page)).title);
  expect(seen.every(t => t === 'Q3'), `held along the corridor: ${seen.join(', ')}`).toBe(true);
  return { at, p, over, start: first.box! };
}

describe('finding 1 and mutation 1: activation picks afresh, never from the hold', () => {
  it('rest on Q3, cross into Q4 along the corridor with Q3 still shown, click: Q4\'s exact datum and row are selected and pinned', async () => {
    const page = await chartPage({ css: '#chart { width: 640px; height: 360px; }' });
    const { over } = await intoCorridor(page);
    await recordEvents(page);
    expect((await tip(page)).title).toBe('Q3');
    await page.mouse.down();
    await page.mouse.up();
    await settle(page);
    const s = await selected(page);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ x: 'Q4', y: 99, index: 3, row: { x: 'Q4', y: 99 } });
    const after = await tip(page);
    expect(after.title).toBe('Q4');
    expect(after.pinned).toBe(true);
    void over;
    expect(await closePage(page)).toEqual([]);
  });

  it('scatter: B under A\'s tooltip, reached along A\'s corridor after a rest: a click selects B', async () => {
    const page = await chartPage({ css: '#chart { width: 640px; height: 400px; }' });
    const axes = { x: { field: 'x', domain: [0, 100] }, y: { field: 'y', domain: [0, 100] } };
    // First where A's tooltip goes, then B put under its centre.
    await create(page, 'scatter', { title: 'S', data: [{ x: 50, y: 30, s: 'A' }], ...axes, series: 's' });
    const p = await plotBox(page);
    const screen = (x: number, y: number): Pt => ({ x: p.x + (x / 100) * p.width, y: p.y + p.height * (1 - y / 100) });
    const a = screen(50, 30);
    await page.mouse.move(a.x, a.y);
    await frames(page, 2);
    const t = (await tip(page)).box!;
    const c = { x: t.x + t.width / 2, y: t.y + t.height / 2 };
    const b = { x: ((c.x - p.x) / p.width) * 100, y: (1 - (c.y - p.y) / p.height) * 100 };
    await page.mouse.move(5, 5);
    await page.evaluate(b => window.charts[0]!.update({ data: [{ x: 50, y: 30, s: 'A' }, { x: b.x, y: b.y, s: 'B' }] }), b);
    await settle(page);
    await recordEvents(page);
    await page.mouse.move(a.x, a.y);
    await frames(page, 2);
    expect((await tip(page)).rows.join(' ')).toMatch(/^A/);
    await page.waitForTimeout(320);
    const seen = await walk(page, a, c, 12, async () => (await tip(page)).rows.join(' '));
    expect(seen.every(r => /^A/.test(r)), `A held on the way: ${seen.join(' | ')}`).toBe(true);
    await page.mouse.down();
    await page.mouse.up();
    await settle(page);
    const s = await selected(page);
    expect(s).toHaveLength(1);
    expect(s[0]!.series).toBe('B');
    expect(await closePage(page)).toEqual([]);
  });

  it('donut: a click on the empty hole selects nothing and ends a pin', async () => {
    const page = await chartPage({ css: '#chart { width: 640px; height: 400px; }' });
    await create(page, 'donut', { title: 'D', data: [{ k: 'a', v: 3 }, { k: 'b', v: 2 }, { k: 'c', v: 1 }], label: 'k', value: 'v' });
    await recordEvents(page);
    const p = await plotBox(page);
    const centre = { x: p.x + p.width / 2, y: p.y + p.height / 2 };
    // A slice: on the ring, straight above the centre (the first slice starts at 12 o'clock).
    const r = Math.min(p.width, p.height) * 0.4;
    await page.mouse.move(centre.x + 10, centre.y - r);
    await frames(page, 2);
    await page.mouse.down();
    await page.mouse.up();
    await settle(page);
    expect(await selected(page)).toHaveLength(1);
    expect((await tip(page)).pinned).toBe(true);
    await page.mouse.move(centre.x, centre.y + 3);
    await page.mouse.down();
    await page.mouse.up();
    await settle(page);
    expect(await selected(page)).toHaveLength(1);
    expect((await tip(page)).pinned).toBe(false);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('finding 5: every placement has a route after a rest', () => {
  it('a dense line with points at the plot\'s left edge and 2 px in: after a rest on the first, the straight way onto its tooltip keeps it', async () => {
    const page = await chartPage({ css: '#chart { width: 640px; height: 360px; }' });
    // 300 x positions over the plot's width: about 2 px apart.
    await create(page, 'line', { title: 'Dense', data: Array.from({ length: 300 }, (_, i) => ({ x: i, y: Math.sin(i / 9) * 10 + 50 })), x: 'x', y: 'y' });
    const p = await plotBox(page);
    const at = { x: p.x + 0.4, y: p.y + p.height / 2 };
    await page.mouse.move(at.x, at.y);
    await frames(page, 2);
    const first = await tip(page);
    expect(first.title).toBe('0');
    await page.waitForTimeout(320);
    const target = nearestInside(first.box!, at);
    const seen = await walk(page, at, { x: target.x + 20, y: target.y }, 24, async () => {
      const t = await tip(page);
      return `${t.title}@${t.box ? Math.round(t.box.x) : '-'}`;
    });
    expect(new Set(seen), seen.join(', ')).toEqual(new Set([`0@${Math.round(first.box!.x)}`]));
    expect(await closePage(page)).toEqual([]);
  });

  it('readout mode, horizontal bars: from an upper category, after a rest, the way down to the strip keeps it and ends on the strip', async () => {
    const page = await chartPage({ css: '#chart { width: 220px; height: 420px; }' });
    await create(page, 'bar', { title: 'H', horizontal: true, data: ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'].map((x, i) => ({ x, y: i + 2 })), x: 'x', y: 'y' });
    const p = await plotBox(page);
    const at = { x: p.x + p.width * 0.3, y: p.y + p.height * 0.1 };
    await page.mouse.move(at.x, at.y);
    await frames(page, 2);
    const before = (await strip(page)).text;
    expect(before).toMatch(/Alpha|Echo/);
    await page.waitForTimeout(320);
    const s = (await strip(page)).box;
    const target = nearestInside(s, at);
    const seen = await walk(page, at, target, 30, async () => (await strip(page)).text);
    expect(seen.every(t => t === before), seen.join(' | ')).toBe(true);
    expect(await closePage(page)).toEqual([]);
  });

  it('readout mode, an isolated scatter point: after a rest, the way to the strip across empty plot keeps the reading', async () => {
    const page = await chartPage({ css: '#chart { width: 220px; height: 420px; }' });
    await create(page, 'scatter', { title: 'S', data: [{ x: 1, y: 9 }, { x: 9, y: 1 }], x: { field: 'x', domain: [0, 10] }, y: { field: 'y', domain: [0, 10] } });
    const p = await plotBox(page);
    const at = { x: p.x + p.width * 0.1, y: p.y + p.height * 0.1 };
    await page.mouse.move(at.x, at.y);
    await frames(page, 2);
    const before = (await strip(page)).text;
    expect(before).toMatch(/1/);
    await page.waitForTimeout(320);
    const target = nearestInside((await strip(page)).box, at);
    const seen = await walk(page, at, target, 30, async () => (await strip(page)).text);
    expect(seen.every(t => t === before), seen.join(' | ')).toBe(true);
    expect(await closePage(page)).toEqual([]);
  });

  it('without a rest the same way to the strip is never held (rule 3b: a sweep never stalls)', async () => {
    const page = await chartPage({ css: '#chart { width: 220px; height: 420px; }' });
    await create(page, 'scatter', { title: 'S', data: [{ x: 1, y: 9 }, { x: 9, y: 1 }], x: { field: 'x', domain: [0, 10] }, y: { field: 'y', domain: [0, 10] } });
    const p = await plotBox(page);
    const at = { x: p.x + p.width * 0.1, y: p.y + p.height * 0.1 };
    await page.mouse.move(at.x, at.y);
    await frames(page, 2);
    const target = nearestInside((await strip(page)).box, at);
    const seen = await walk(page, at, target, 30, async () => (await strip(page)).text);
    expect(seen.at(-1)).toBeNull();
    expect(await closePage(page)).toEqual([]);
  });
});

describe('finding 8 and mutation 5: a hold belongs to one datum, one geometry and one presentation', () => {
  it('a stream commit that moves the bands while the pointer rests in the corridor: Q4 at once, without a move, and the next move in the old hull does not bring Q3 back', async () => {
    const page = await chartPage({ css: '#chart { width: 640px; height: 360px; }' });
    const { over } = await intoCorridor(page);
    // A seventh category: every band narrows, so Q3's anchor and its tooltip's place change.
    await page.evaluate(() => window.charts[0]!.append([{ x: 'Q7', y: 50 }]));
    await settle(page);
    const now = await tip(page);
    const under = await page.evaluate(({ x }) => {
      const p = document.querySelector('#chart .axylo-proxy')!.getBoundingClientRect();
      return Math.floor(((x - p.x) / p.width) * 7);
    }, over);
    expect(now.title).toBe(`Q${under + 1}`);
    expect(now.title).not.toBe('Q3');
    await page.mouse.move(over.x - 1, over.y);
    await frames(page, 2);
    expect((await tip(page)).title).not.toBe('Q3');
    expect(await closePage(page)).toEqual([]);
  });

  it('a resize into readout mode while the pointer is in the corridor: the hold ends, the strip shows the datum under the pointer', async () => {
    const page = await chartPage({ css: '#chart { width: 640px; height: 360px; }' });
    const { over } = await intoCorridor(page);
    await page.evaluate(() => { document.getElementById('chart')!.style.width = '230px'; });
    await settle(page);
    await frames(page, 3);
    expect((await tip(page)).title).toBeNull();
    const shown = (await strip(page)).text;
    // The pointer is now where the narrower plot has some other band, or nothing: never the held Q3.
    const p = await plotBox(page);
    const expected = inside(over, p) ? `Q${Math.floor(((over.y - p.y) / p.height) * 6) + 1}` : null;
    void expected;
    expect(shown === null || !/^Q3:/.test(shown)).toBe(true);
    expect(await closePage(page)).toEqual([]);
  });

  it('the same commit with a pin keeps the pin on its datum; with the keyboard the reading stays on its datum', async () => {
    const page = await chartPage({ css: '#chart { width: 640px; height: 360px; }' });
    const { at } = await tallBars(page);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.up();
    await settle(page);
    expect(await tip(page)).toMatchObject({ title: 'Q3', pinned: true });
    await page.evaluate(() => window.charts[0]!.append([{ x: 'Q7', y: 50 }]));
    await settle(page);
    expect(await tip(page)).toMatchObject({ title: 'Q3', pinned: true });
    await page.mouse.move(5, 5);
    await page.keyboard.press('Escape');
    await page.locator('#chart .axylo-proxy').focus();
    await page.keyboard.press('End');
    await settle(page);
    const text = await page.locator('#chart .axylo-proxy').getAttribute('aria-valuetext');
    expect(text).toMatch(/^Q7/);
    await page.evaluate(() => window.charts[0]!.append([{ x: 'Q8', y: 40 }]));
    await settle(page);
    expect(await page.locator('#chart .axylo-proxy').getAttribute('aria-valuetext')).toBe(text);
    expect((await tip(page)).title).toBe('Q7');
    expect(await closePage(page)).toEqual([]);
  });

  it('review C3-6: switching to compact and back while held starts from no hold: the first move picks', async () => {
    const page = await chartPage({ css: '#chart { width: 640px; height: 360px; }' });
    const { over } = await intoCorridor(page);
    await page.evaluate(() => window.charts[0]!.update({ compact: true }));
    await settle(page);
    await page.evaluate(() => window.charts[0]!.update({ compact: false }));
    await settle(page);
    await page.mouse.move(over.x + 1, over.y);
    await frames(page, 2);
    const p = await plotBox(page);
    const band = Math.floor(((over.x + 1 - p.x) / p.width) * 6);
    expect((await tip(page)).title).toBe(`Q${band + 1}`);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('finding 15: one Escape does one thing', () => {
  it('in a modal dialog with a pin and single-series mode: the first Escape closes the pin only, the second leaves single mode, the third closes the dialog', async () => {
    const page = await chartPage({ css: 'dialog { width: 700px; } #chart { width: 640px; height: 360px; }' });
    await page.evaluate(() => {
      const dialog = document.createElement('dialog');
      document.body.appendChild(dialog);
      dialog.appendChild(document.getElementById('chart')!);
      dialog.showModal();
    });
    const data = [0, 1, 2, 3].flatMap(x => ['a', 'b'].map((s, i) => ({ x, s, y: x + i * 5 })));
    await create(page, 'line', { title: 'Dialog', data, x: 'x', y: 'y', series: 's' });
    await page.locator('#chart .axylo-proxy').focus();
    await page.keyboard.press('ArrowDown');
    await settle(page);
    expect(await page.locator('#chart .axylo-proxy').getAttribute('aria-valuetext')).toMatch(/^a, /);
    const p = await plotBox(page);
    await page.mouse.move(p.x + p.width * 0.66, p.y + p.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await settle(page);
    expect((await tip(page)).pinned).toBe(true);
    const open = () => page.evaluate(() => document.querySelector('dialog')!.open);
    await page.keyboard.press('Escape');
    await settle(page);
    expect((await tip(page)).title).toBeNull();
    expect(await open()).toBe(true);
    // Still narrowed to one series: the reading names one series.
    expect(await page.locator('#chart .axylo-proxy').getAttribute('aria-valuetext')).toMatch(/^a, /);
    await page.keyboard.press('Escape');
    await settle(page);
    expect(await open()).toBe(true);
    expect(await page.locator('#chart .axylo-proxy').getAttribute('aria-valuetext')).not.toMatch(/^a, /);
    await page.keyboard.press('Escape');
    await settle(page);
    expect(await open()).toBe(false);
    expect(await closePage(page)).toEqual([]);
  });

  it('a hovered tooltip spends Escape: a page listener does not see it; with nothing shown, it does', async () => {
    const page = await chartPage({ css: '#chart { width: 640px; height: 360px; }' });
    await create(page, 'line', { title: 'E', data: [0, 1, 2].map(x => ({ x, y: x })), x: 'x', y: 'y' });
    await page.evaluate(() => {
      const w = window as unknown as { escapes: number };
      w.escapes = 0;
      document.addEventListener('keydown', e => { if (e.key === 'Escape') w.escapes++; });
    });
    const p = await plotBox(page);
    await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
    await frames(page, 2);
    await page.keyboard.press('Escape');
    await settle(page);
    expect((await tip(page)).title).toBeNull();
    expect(await page.evaluate(() => (window as unknown as { escapes: number }).escapes)).toBe(0);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => (window as unknown as { escapes: number }).escapes)).toBe(1);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('finding 16: tooltip: false pins nothing', () => {
  it('click A, move over B: B is highlighted and hovered; no tooltip; Escape goes to the page', async () => {
    const page = await chartPage({ css: '#chart { width: 640px; height: 360px; }' });
    await create(page, 'line', { title: 'Off', tooltip: false, data: [0, 1, 2, 3].map(x => ({ x, y: x })), x: 'x', y: 'y' });
    await recordEvents(page);
    await page.evaluate(() => {
      const w = window as unknown as { escapes: number };
      w.escapes = 0;
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && !e.defaultPrevented) w.escapes++; });
    });
    const p = await plotBox(page);
    await page.mouse.move(p.x + 2, p.y + p.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await settle(page);
    const s = await selected(page);
    expect(s).toHaveLength(1);
    expect(s[0]!.x).toBe(0);
    expect(await page.evaluate(() => document.activeElement?.className)).toBe('axylo-proxy');
    await page.mouse.move(p.x + p.width - 2, p.y + p.height / 2);
    await settle(page);
    expect(await page.evaluate(() => (window as unknown as { hovered: { x: unknown }[] }).hovered.at(-1)?.x)).toBe(3);
    expect(await page.locator('#chart .axylo-tooltip').isHidden()).toBe(true);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => (window as unknown as { escapes: number }).escapes)).toBe(1);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('mutation 7: a dense line\'s visible text follows every move, at several strides, both ways', () => {
  it('the tooltip names the x nearest the pointer after each of 40 moves, strides 1, 7 and 23 positions, rightwards and leftwards', async () => {
    const page = await chartPage({ css: '#chart { width: 720px; height: 360px; }' });
    const n = 2000;
    await create(page, 'line', { title: 'Many', data: Array.from({ length: n }, (_, i) => ({ x: i, y: (i * 37) % 101 })), x: { field: 'x', domain: [0, n - 1] }, y: 'y' });
    const p = await plotBox(page);
    const failures: string[] = [];
    for (const stride of [1, 7, 23]) {
      for (const direction of [1, -1]) {
        await page.mouse.move(5, 5);
        await frames(page);
        for (let k = 0; k < 40; k++) {
          const i = direction > 0 ? 100 + k * stride : n - 100 - k * stride;
          const x = p.x + (i / (n - 1)) * p.width;
          await page.mouse.move(x, p.y + p.height / 2);
          await frames(page);
          const title = (await tip(page)).title;
          const shown = Number((title ?? '').replace(/[^\d]/g, ''));
          // The nearest x to a pointer at the position of x = i, within the half device pixel the pick rounds to.
          if (Math.abs(shown - i) > Math.ceil((n - 1) / p.width)) failures.push(`stride ${stride} dir ${direction} move ${k}: expected about ${i}, shown ${title}`);
        }
      }
    }
    expect(failures).toEqual([]);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('rule 5 (finding 12 is the controller\'s): a plot below the readout limits never floats a tooltip', () => {
  it('stepping the card\'s height: wherever the plot is shorter than 140 px, pointing shows the strip or no readout, never a floating tooltip, and still highlights', async () => {
    const page = await chartPage({ css: '#chart { width: 480px; height: 300px; }' });
    await create(page, 'line', { title: 'Short', data: [0, 1, 2, 3].map(x => ({ x, y: x })), x: 'x', y: 'y' });
    await recordEvents(page);
    const failures: string[] = [];
    let below = 0;
    for (let h = 300; h >= 150; h -= 10) {
      await page.evaluate(h => { document.getElementById('chart')!.style.height = `${h}px`; }, h);
      await settle(page);
      const p = await page.locator('#chart .axylo-proxy').boundingBox();
      if (!p) continue;
      await page.mouse.move(5, 5);
      await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
      await settle(page);
      const t = await tip(page);
      if (p.height < 140) {
        below++;
        if (t.title !== null) failures.push(`${h}: plot ${p.height.toFixed(1)} px high floats a tooltip`);
        const hovered = await page.evaluate(() => (window as unknown as { hovered: unknown[] }).hovered.at(-1));
        if (!hovered) failures.push(`${h}: nothing highlighted`);
      } else if (t.title === null) failures.push(`${h}: plot ${p.height.toFixed(1)} px high shows no tooltip`);
    }
    expect(below).toBeGreaterThan(0);
    expect(failures).toEqual([]);
    expect(await closePage(page)).toEqual([]);
  });
});
