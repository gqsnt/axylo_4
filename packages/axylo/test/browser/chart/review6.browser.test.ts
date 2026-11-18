/**
 * Decision 0004 rule 3b (seventh pass): a pointer that has rested 250 ms on a datum holds it along the
 * corridor to a tooltip that is not across the reading axis; a pointer that has not rested is never held.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { start, stop } from '../harness';
import { chartPage, closePage } from './util';

beforeAll(start);
afterAll(stop);

type Box = { x: number; y: number; width: number; height: number };
const frames = (page: Page, n = 1) => page.evaluate(k => window.nextFrames(k), n);

async function create(page: Page, kind: string, options: Record<string, unknown>): Promise<void> {
  await page.evaluate(async ({ kind, options }) => {
    const chart = window.Axylo[kind]!('#chart', options);
    window.charts.push(chart);
    await chart.__bench.ready();
    await window.nextFrames(1);
  }, { kind, options });
}

async function tip(page: Page): Promise<{ title: string | null; box: Box | null }> {
  return page.evaluate(() => {
    const t = document.querySelector('#chart .axylo-tooltip') as HTMLElement;
    if (t.hidden) return { title: null, box: null };
    const b = t.getBoundingClientRect();
    return { title: t.querySelector('.axylo-tooltip-title')?.textContent ?? null, box: { x: b.x, y: b.y, width: b.width, height: b.height } };
  });
}

/** A point 2 px inside `box`, nearest to `from`. */
const nearestInside = (box: Box, from: { x: number; y: number }) => ({
  x: Math.min(box.x + box.width - 2, Math.max(box.x + 2, from.x)), y: Math.min(box.y + box.height - 2, Math.max(box.y + 2, from.y)),
});

/** Moves in `steps` straight steps, one frame each; returns the tooltip seen after each step. */
async function walk(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps: number) {
  const seen: { title: string | null; box: Box | null }[] = [];
  for (let k = 1; k <= steps; k++) {
    await page.mouse.move(from.x + (to.x - from.x) * k / steps, from.y + (to.y - from.y) * k / steps);
    await frames(page);
    seen.push(await tip(page));
  }
  return seen;
}

/** Tall bars, so a bar's tooltip has no room above or below and goes beside it. */
async function tallBars(page: Page): Promise<{ at: { x: number; y: number } }> {
  await create(page, 'bar', { title: 'Tall', data: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6'].map((x, i) => ({ x, y: [96, 100, 97, 99, 98, 95][i] })), x: 'x', y: 'y' });
  const p = (await page.locator('#chart .axylo-proxy').boundingBox())!;
  return { at: { x: p.x + p.width * (2.5 / 6), y: p.y + p.height * 0.6 } };
}

describe('rule 3b: a rest holds the datum along the corridor', () => {
  it('bar: after a rest, a slow straight approach to the tooltip beside the bar keeps Q3, unmoved, and ends inside it', async () => {
    const page = await chartPage({ css: '#chart { width: 640px; height: 360px; }' });
    const { at } = await tallBars(page);
    await page.mouse.move(at.x, at.y);
    await frames(page, 2);
    const start = await tip(page);
    expect(start.title).toBe('Q3');
    await page.waitForTimeout(320);
    const target = nearestInside(start.box!, at);
    const seen = await walk(page, at, target, 20);
    for (const [k, s] of seen.entries()) {
      expect(s.title, `step ${k + 1}`).toBe('Q3');
      expect(s.box, `step ${k + 1}`).toEqual(start.box);
    }
    expect(await closePage(page)).toEqual([]);
  });

  it('bar: without a rest, the same path changes the datum at the next band', async () => {
    const page = await chartPage({ css: '#chart { width: 640px; height: 360px; }' });
    const { at } = await tallBars(page);
    await page.mouse.move(at.x, at.y);
    await frames(page, 2);
    const start = await tip(page);
    const seen = await walk(page, at, nearestInside(start.box!, at), 20);
    expect(seen.map(s => s.title).some(t => t !== 'Q3')).toBe(true);
    expect(await closePage(page)).toEqual([]);
  });

  it('bar: leaving the rectangle away from the corridor resumes picking on that move', async () => {
    const page = await chartPage({ css: '#chart { width: 640px; height: 360px; }' });
    const { at } = await tallBars(page);
    await page.mouse.move(at.x, at.y);
    await frames(page, 2);
    const start = await tip(page);
    await page.waitForTimeout(320);
    const target = nearestInside(start.box!, at);
    await walk(page, at, target, 10);
    expect((await tip(page)).title).toBe('Q3');
    // Out of the rectangle downwards, away from the corridor, in one move: what is under the pointer there.
    await page.mouse.move(target.x, start.box!.y + start.box!.height + 40);
    await frames(page);
    expect((await tip(page)).title).not.toBe('Q3');
    expect(await closePage(page)).toEqual([]);
  });

  it('bar: a fast sweep through the tooltip\'s rectangle after a rest elsewhere is never held', async () => {
    const page = await chartPage({ css: '#chart { width: 640px; height: 360px; }' });
    const { at } = await tallBars(page);
    await page.mouse.move(at.x, at.y);
    await frames(page, 2);
    const start = await tip(page);
    await page.waitForTimeout(320);
    // Away, out of the corridor at once, then a sweep through where Q3's tooltip was.
    const p = (await page.locator('#chart .axylo-proxy').boundingBox())!;
    await page.mouse.move(p.x + 4, p.y + p.height - 4);
    await frames(page);
    const r = start.box!;
    const seen = await walk(page, { x: r.x - 10, y: r.y + r.height / 2 }, { x: r.x + r.width + 10, y: r.y + r.height / 2 }, 12);
    // What is under the pointer is shown: never Q3, which the pointer rested on before leaving its corridor.
    expect(seen.map(s => s.title).filter(t => t === 'Q3')).toEqual([]);
    expect(seen.some(s => s.title !== null)).toBe(true);
    expect(await closePage(page)).toEqual([]);
  });

  it('donut: after a rest, a slow straight approach to the tooltip in the hole keeps the slice, unmoved', async () => {
    const page = await chartPage({ css: '#chart { width: 640px; height: 400px; }' });
    await create(page, 'donut', { title: 'D', data: [{ l: 'Rent', v: 40 }, { l: 'Food', v: 25 }, { l: 'Travel', v: 20 }, { l: 'Other', v: 15 }], label: 'l', value: 'v' });
    const p = (await page.locator('#chart .axylo-proxy').boundingBox())!;
    const cx = p.x + p.width / 2, cy = p.y + p.height / 2, outer = Math.min(p.width, p.height) / 2;
    // Travel: from 65 % to 85 % of the turn; its middle at 75 %, i.e. 9 o'clock.
    const at = { x: cx - outer * 0.85, y: cy };
    await page.mouse.move(at.x, at.y);
    await frames(page, 2);
    const start = await tip(page);
    expect(start.title).toBe('Travel');
    await page.waitForTimeout(320);
    const seen = await walk(page, at, nearestInside(start.box!, at), 20);
    for (const [k, s] of seen.entries()) {
      expect(s.title, `step ${k + 1}`).toBe('Travel');
      expect(s.box, `step ${k + 1}`).toEqual(start.box);
    }
    expect(await closePage(page)).toEqual([]);
  });
});

describe('seventh pass: a two-tone focus ring (WCAG 1.4.11)', () => {
  it('crossing the datum ring over a bar of each dark series colour: background, then focus colour, then background, each at least 1 device px', async () => {
    const { DARK } = await import('../../../src/theme/palette');
    const { at, diff, hex, shot } = await import('./util');
    const bg = hex(DARK.background);
    const focusColor = hex(DARK.focus);
    for (const color of DARK.series) {
      const page = await chartPage({ deviceScaleFactor: 2, css: `body { background: ${DARK.background}; color: #e8e8e8; } #chart { width: 600px; height: 300px; }` });
      // Forty equal bars, 15 px apart with 3 px gaps: the ring, 4 px outside the focused bar, lies over its neighbour.
      await create(page, 'bar', { title: 'R', data: Array.from({ length: 40 }, (_, i) => ({ x: `c${i}`, y: 10 })), x: 'x', y: 'y', colors: { y: color } });
      await page.focus('#chart .axylo-proxy');
      for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight');
      await frames(page, 2);
      const { img } = await shot(page, '#chart .axylo-proxy');
      const y = Math.floor(img.height / 2);
      const near = (x: number, c: readonly [number, number, number], tol = 30) => diff(at(img, x, y), c) <= tol;
      let found = false;
      for (let x = 2; x < img.width - 2 && !found; x++) {
        if (!near(x, focusColor) || near(x - 1, focusColor)) continue;
        // A focus run from x: at least 2 device px; then background on both sides, at least 1 device px each.
        let end = x;
        while (end < img.width && near(end, focusColor)) end++;
        if (end - x < 2) continue;
        const leftBg = near(x - 1, bg, 12);
        const rightBg = near(end, bg, 12);
        if (leftBg && rightBg) found = true;
      }
      expect(found, `ring on ${color}`).toBe(true);
      // And the ring really crosses a mark: the series colour is next to the outer surround somewhere on the row.
      let crossing = false;
      for (let x = 2; x < img.width - 3; x++) if (near(x, hex(color), 30) && near(x + 1, bg, 12) && (near(x + 2, focusColor) || near(x + 3, focusColor))) crossing = true;
      expect(crossing, `the ring crosses the ${color} bar`).toBe(true);
      expect(await closePage(page)).toEqual([]);
    }
  });
});
