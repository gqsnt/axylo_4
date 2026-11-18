/**
 * Spec L3 and L1 with the document's font events (core/environment.ts; engines report 2, item 2): a
 * 'loadingdone' that brought no font faces (Firefox fires one after load) does not run layout again, and a
 * real late font still does, after which tick labels are measured as they render. No CDP. Run on chromium,
 * firefox and webkit (AXYLO_ENGINE).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import type { Page } from 'playwright-core';
import { openEntry, start, stop } from '../harness';

beforeAll(start);
afterAll(stop);

const frames = (page: Page, n = 3) => page.evaluate((n: number) => new Promise<void>(resolve => {
  const step = (k: number) => k === 0 ? resolve() : requestAnimationFrame(() => step(k - 1));
  step(n);
}), n);

describe('document font events', () => {
  it('an empty loadingdone leaves layout alone; a late font reruns it and its labels measure as they render', async () => {
    const page = await openEntry('packages/axylo/test/browser/chart/entries/reattach.entry.ts');
    const font = fs.readFileSync('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf').toString('base64');
    await page.evaluate(() => {
      const box = document.body.appendChild(document.createElement('div'));
      box.id = 'box';
      box.style.cssText = 'width: 600px; height: 320px; font-family: "Late Sans", sans-serif;';
      const chart = window.reattach.line(box, { title: 'F', data: [0, 1, 2].map(x => ({ x, y: x * 14000 })), x: 'x', y: 'y' });
      (window as unknown as { chart: typeof chart }).chart = chart;
    });
    await page.evaluate(() => document.fonts.ready);
    await frames(page, 6);
    const layouts = () => page.evaluate(() =>
      (window as unknown as { chart: { __dev: { stages(): Record<string, number> } } }).chart.__dev.stages().layout ?? 0);
    const settled = await layouts();
    await page.evaluate(() => {
      const event = new Event('loadingdone');
      Object.defineProperty(event, 'fontfaces', { value: [] });
      document.fonts.dispatchEvent(event);
    });
    await frames(page, 4);
    expect(await layouts()).toBe(settled);
    // A real late font: added, then loaded, so the set reports it in its own loadingdone.
    await page.evaluate(async f => {
      const bytes = Uint8Array.from(atob(f), c => c.charCodeAt(0));
      const face = new FontFace('Late Sans', bytes);
      document.fonts.add(face);
      await face.load();
      await document.fonts.ready;
    }, font);
    await frames(page, 4);
    expect(await layouts()).toBeGreaterThan(settled);
    const labels = await page.evaluate(() => {
      const layer = document.querySelector('#box .axylo-text')!;
      return Array.from(layer.querySelectorAll('.axylo-label[data-role^="tick"]')).map(el => ({
        text: el.textContent ?? '', rendered: el.getBoundingClientRect().width, measured: window.reattach.width(el.textContent ?? '', layer),
      })).filter(l => l.text.trim() !== '');
    });
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(Math.abs(label.measured - label.rendered), label.text).toBeLessThan(0.5);
    await page.context().close();
  });
});
