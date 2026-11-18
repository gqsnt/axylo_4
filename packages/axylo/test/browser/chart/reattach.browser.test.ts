/**
 * A chart taken out of the document and put back (core/chart.ts; verification of the controller fixes, defect
 * 11 and the missing regressions): a watcher that fails while the chart is put back leaves nothing subscribed
 * and does not stop the next notification from setting the watchers up; and a font that loaded while the
 * chart was out is measured with, once it is back (spec L1). Run on chromium, firefox and webkit (AXYLO_ENGINE).
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

describe('a chart put back into the document', () => {
  it('a watcher that throws once while it is put back: nothing stays subscribed, and the next resize sets them all up', async () => {
    const page = await openEntry('packages/axylo/test/browser/chart/entries/reattach.entry.ts');
    await page.evaluate(() => {
      // Media-query listeners alive, one entry per list and listener (the theme watcher gives its three lists
      // one function), counted at the page's own matchMedia; `failAt` makes one call throw.
      const live: [MediaQueryList, unknown][] = [];
      const original = window.matchMedia.bind(window);
      const state = { live, calls: 0, failAt: -1 };
      (window as unknown as { media: typeof state }).media = state;
      window.matchMedia = (query: string) => {
        if (state.calls++ === state.failAt) throw new Error('matchMedia failed');
        const list = original(query);
        const add = list.addEventListener.bind(list);
        const remove = list.removeEventListener.bind(list);
        list.addEventListener = ((type: string, fn: EventListenerOrEventListenerObject) => { live.push([list, fn]); add(type, fn); }) as typeof list.addEventListener;
        list.removeEventListener = ((type: string, fn: EventListenerOrEventListenerObject) => {
          const at = live.findIndex(([l, f]) => l === list && f === fn);
          if (at >= 0) live.splice(at, 1);
          remove(type, fn);
        }) as typeof list.removeEventListener;
        return list;
      };
      const box = document.body.appendChild(document.createElement('div'));
      box.id = 'box';
      (window as unknown as { box: HTMLElement }).box = box;
      box.style.cssText = 'width: 600px; height: 320px;';
      window.reattach.line(box, { title: 'R', data: [0, 1, 2].map(x => ({ x, y: x })), x: 'x', y: 'y' });
    });
    await frames(page);
    type Media = { live: unknown[]; calls: number; failAt: number };
    const liveCount = () => page.evaluate(() => (window as unknown as { media: Media }).media.live.length);
    const watching = await liveCount();
    // The theme watcher's three media features and the environment's resolution and motion queries.
    expect(watching).toBe(5);
    await page.evaluate(() => document.getElementById('box')!.remove());
    await frames(page);
    expect(await liveCount()).toBe(0);
    // Put back with the environment watcher's first matchMedia throwing, after the theme watcher's three.
    await page.evaluate(() => {
      const media = (window as unknown as { media: Media }).media;
      media.failAt = media.calls + 3;
      document.body.appendChild((window as unknown as { box: HTMLElement }).box);
    });
    await frames(page);
    expect(await liveCount()).toBe(0);
    // The next notification (a resize) sets every watcher up.
    await page.evaluate(() => { document.getElementById('box')!.style.width = '640px'; });
    await frames(page);
    expect(await liveCount()).toBe(watching);
    await page.context().close();
  });

  it('a font loaded while it was out: once back, its tick labels are measured as they render, within 0.5 px', async () => {
    const page = await openEntry('packages/axylo/test/browser/chart/entries/reattach.entry.ts');
    const font = fs.readFileSync('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf').toString('base64');
    await page.evaluate(() => {
      const box = document.body.appendChild(document.createElement('div'));
      box.id = 'box';
      box.style.cssText = 'width: 600px; height: 320px; font-family: "Late Sans", sans-serif;';
      window.reattach.line(box, { title: 'F', data: [0, 1, 2].map(x => ({ x, y: x * 14000 })), x: 'x', y: 'y' });
    });
    await frames(page);
    const labels = () => page.evaluate(() => {
      const layer = document.querySelector('#box .axylo-text')!;
      // Tick labels, which are in the text layer's own style (titles have their own).
      return Array.from(layer.querySelectorAll('.axylo-label[data-role^="tick"]')).map(el => ({
        text: el.textContent ?? '', rendered: el.getBoundingClientRect().width, measured: window.reattach.width(el.textContent ?? '', layer),
      })).filter(l => l.text.trim() !== '');
    });
    const before = await labels();
    expect(before.length).toBeGreaterThan(0);
    await page.evaluate(async f => {
      const box = document.getElementById('box')!;
      box.remove();
      await new Promise(r => requestAnimationFrame(() => r(null)));
      // Loaded, then added: no 'loadingdone' reaches the chart, and it is out of the document meanwhile.
      const bytes = Uint8Array.from(atob(f), c => c.charCodeAt(0));
      const face = new FontFace('Late Sans', bytes);
      await face.load();
      document.fonts.add(face);
      await document.fonts.ready;
      document.body.appendChild(box);
    }, font);
    await frames(page, 4);
    const after = await labels();
    const widest = (list: typeof before) => Math.max(...list.map(l => l.rendered));
    // The font did change the labels, so the check is about a real change.
    expect(Math.abs(widest(after) - widest(before))).toBeGreaterThan(2);
    for (const label of after) expect(Math.abs(label.measured - label.rendered), label.text).toBeLessThan(0.5);
    await page.context().close();
  });
});
