/**
 * SVG draws the hand-built scene (entries/axylo-render.entry.ts, `fixedScene`), checked
 * by sampling screenshot pixels at points chosen from the scene's coordinates. Expected colors are the
 * default light palette (theme/palette.ts) on the page's white background.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { start, stop } from '../harness';
import { LIGHT } from '../../../src/theme/palette';
import type {} from './entries/api';
import { at, blend, close, diff, ink, open, rgb, shot, WHITE, type RGB } from './util';
import type { Image } from './png';

const series = (i: number): RGB => rgb(LIGHT.series[i]!);

beforeAll(start);
afterAll(stop);

describe('fixed scene, SVG', () => {
  let page: Page;
  let image: Image;

  beforeAll(async () => {
    page = await open();
    await page.evaluate(() => window.axr.mount(460, 60));
    image = await shot(page, 460, 60, 400, 300);
  });
  afterAll(async () => { await close(page); });

  const px = (x: number, y: number): RGB => at(image, x, y);

  it('path: stroke where it passes, background where the pen was lifted, nothing past the clip', () => {
    expect(diff(px(85, 50), series(0))).toBeLessThanOrEqual(8);
    expect(diff(px(120, 75), series(0))).toBeLessThanOrEqual(8);
    expect(diff(px(300, 120), series(0))).toBeLessThanOrEqual(8);
    // On the straight line between the last vertex before the lift (120,100) and the first after (160,120).
    expect(diff(px(130, 105), WHITE)).toBeLessThanOrEqual(2);
    expect(diff(px(140, 110), series(0))).toBeGreaterThan(60);
    // x 388 is past the clip's right edge (380).
    expect(diff(px(388, 120), WHITE)).toBeLessThanOrEqual(2);
  });

  it('path: solid in normal mode (the contrast dash is not used)', () => {
    for (let x = 165; x < 375; x++) expect(diff(px(x, 120), series(0)), `x ${x}`).toBeLessThanOrEqual(30);
  });

  it('area: one translucent polygon per run, nothing between the runs', () => {
    expect(diff(px(55, 180), blend(series(1), 0.5))).toBeLessThanOrEqual(6);
    expect(diff(px(150, 180), blend(series(1), 0.5))).toBeLessThanOrEqual(6);
    expect(diff(px(120, 180), WHITE)).toBeLessThanOrEqual(2);
    // Above the upper boundary of run 1 (y 140 at x 80).
    expect(diff(px(52, 138), WHITE)).toBeLessThanOrEqual(2);
  });

  it('bars are filled; the missing bar is a hollow mark at the baseline, unlike an empty slot', () => {
    expect(diff(px(210, 220), series(2))).toBeLessThanOrEqual(4);
    expect(diff(px(240, 150), series(2))).toBeLessThanOrEqual(4);
    const img = image;
    const missing = ink(img, 256, 245, 284, 260);
    const empty = ink(img, 288, 245, 312, 260);
    expect(missing).toBeGreaterThanOrEqual(30);
    expect(empty).toBe(0);
    // Hollow: well inside the box but off the diagonal is background, so it cannot read as a short bar.
    expect(diff(px(264, 254), WHITE)).toBeLessThanOrEqual(10);
    // Its outline is the series color, and it stands on the baseline (nothing above y 245).
    expect(diff(px(260, 256), series(2))).toBeLessThanOrEqual(30);
    expect(ink(img, 256, 230, 284, 245)).toBe(0);
  });

  it('points: all eight marker shapes are drawn, filled, and differ', () => {
    const counts: number[] = [];
    for (let k = 0; k < 8; k++) {
      const x = 50 + 20 * k;
      expect(diff(px(x, 235), series(3)), `shape ${k}`).toBeLessThanOrEqual(8);
      counts.push(ink(image, x - 7, 228, x + 7, 242));
    }
    for (const n of counts) expect(n).toBeGreaterThan(15);
    expect(new Set(counts).size).toBeGreaterThanOrEqual(5);
  });

  it('ring: four slices in their colors with background gaps between them', () => {
    const mid = 32.5;
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      expect(diff(px(300 + mid * Math.sin(a), 60 - mid * Math.cos(a)), series(4 + k)), `slice ${k}`).toBeLessThanOrEqual(8);
    }
    // Gap centres at 12, 3, 6 and 9 o'clock (4 px wide).
    for (const [x, y] of [[299, 27], [300, 27], [332, 59], [332, 60], [299, 92], [300, 92], [267, 59], [267, 60]] as const) {
      expect(diff(px(x, y), WHITE), `gap ${x},${y}`).toBeLessThanOrEqual(12);
    }
    // Inside the hole.
    expect(diff(px(300, 60), WHITE)).toBeLessThanOrEqual(2);
  });

  it('clip: grid outside the clip is not drawn, axis and tick rules outside it are', () => {
    expect(diff(px(25, 110), WHITE)).toBeLessThanOrEqual(2);
    expect(diff(px(385, 110), WHITE)).toBeLessThanOrEqual(2);
    expect(diff(px(370, 110), rgb(LIGHT.grid))).toBeLessThanOrEqual(3);
    expect(diff(px(300, 260), rgb(LIGHT.axis))).toBeLessThanOrEqual(3);
    expect(diff(px(200, 265), rgb(LIGHT.axis))).toBeLessThanOrEqual(3);
    expect(diff(px(40, 200), rgb(LIGHT.axis))).toBeLessThanOrEqual(3);
    // A crisp 1 px rule: the rows next to the x axis are background.
    expect(diff(px(300, 259), WHITE)).toBeLessThanOrEqual(2);
    expect(diff(px(300, 261), WHITE)).toBeLessThanOrEqual(2);
  });

  it('band: translucent fill', () => {
    expect(diff(px(80, 90), blend(rgb(LIGHT.reference), 0.15))).toBeLessThanOrEqual(4);
  });

});

describe('overlay and reuse', () => {
  let page: Page;
  beforeAll(async () => {
    page = await open();
    await page.evaluate(() => { window.axr.mount(460, 60); });
  });
  afterAll(async () => { await close(page); });

  it('svg: drawOverlay replaces its own group and leaves the scene alone', async () => {
    await page.evaluate(() => window.axr.overlay(0, true));
    expect(await page.evaluate(() => window.axr.svgOverlayCount(0))).toBe(3);
    const img = await shot(page, 460, 60, 400, 300);
    expect(diff(at(img, 330, 100), rgb(LIGHT.focus))).toBeLessThanOrEqual(4);
    expect(diff(at(img, 330, 280), WHITE)).toBeLessThanOrEqual(2);
    expect(diff(at(img, 20, 280), rgb(LIGHT.focus))).toBeLessThanOrEqual(4);
    expect(await page.evaluate(() => window.axr.draws(0))).toBe(1);
    await page.evaluate(() => window.axr.overlay(0, false));
    expect(await page.evaluate(() => window.axr.svgOverlayCount(0))).toBe(0);
  });

  it('svg: a draw with the same mark list reuses every element and only rewrites what changed', async () => {
    const r = await page.evaluate(() => window.axr.svgReuse(0));
    expect(r.count).toBe(18);
    expect(r.sameNodes).toBe(true);
    expect(r.dChanged).toBe(true);
  });
});

describe('device pixel ratio 2', () => {
  let page: Page;
  beforeAll(async () => {
    page = await open({ deviceScaleFactor: 2 });
    await page.evaluate(() => { window.axr.mount(460, 60); });
  });
  afterAll(async () => { await close(page); });

  /** Indexes of the inked entries of a strip of pixels; asserts they are one run of fully inked pixels. */
  function crisp(values: readonly (readonly number[])[], inked: (v: readonly number[]) => boolean, full: (v: readonly number[]) => boolean): number {
    const hits = values.map((v, i) => (inked(v) ? i : -1)).filter(i => i >= 0);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[hits.length - 1]! - hits[0]! + 1).toBe(hits.length);
    for (const i of hits) expect(full(values[i]!), `entry ${i}: ${values[i]!.join(',')}`).toBe(true);
    return hits.length;
  }

  it('svg: the same rule is two whole device rows on screen', async () => {
    const img = await shot(page, 460, 60, 400, 300);
    expect(img.width).toBe(800);
    const column = Array.from({ length: 21 }, (_, k) => at(img, 600, 510 + k));
    expect(crisp(column, v => diff(v, WHITE) > 2, v => diff(v, rgb(LIGHT.axis)) <= 2)).toBe(2);
    const row = Array.from({ length: 21 }, (_, k) => at(img, 70 + k, 400));
    expect(crisp(row, v => diff(v, WHITE) > 2, v => diff(v, rgb(LIGHT.axis)) <= 2)).toBe(2);
  });
});
