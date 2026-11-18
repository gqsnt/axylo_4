/**
 * Spec DX8: creating, destroying and creating again on the same element works and leaks nothing, the sequence a
 * framework's strict or development mode produces. On the packed core, without any framework, by both routes
 * a page loads it: a bundled module (production condition) and the script-tag file.
 *
 * On one element: create, destroy, create again. Then one figure; the destroyed handle is inert (update,
 * append and zoom change nothing, and its listeners receive no events while the live chart's do). After the
 * final destroy the element is exactly as the page wrote it, and nothing responds to resize or the pointer: the
 * listeners, observers and animation frames registered since the first create are gone, as far as the page can
 * observe them (pages/instrument.js wraps the platform's registration calls before the library loads).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bundle, closeBrowser, drawn, launch, open, problems, startServer, type Server } from './browser';
import { fixture } from './paths';

let server: Server;
let module = '';
beforeAll(async () => {
  server = await startServer();
  await launch();
  module = (await bundle({ name: 'lifecycle-module', cwd: fixture('npm'), format: 'esm', conditions: ['production'], contents: `import * as A from 'axylo';\n(window as unknown as { Axylo: unknown }).Axylo = A;` })).url;
});
afterAll(async () => { await closeBrowser(); await server?.close(); });

const ROUTES = {
  'bundled module (production condition)': () => `<script type="module" src="${module}"></script>`,
  'script tag (axylo.iife.min.js)': () => '<script src="/script/node_modules/axylo/dist/axylo.iife.min.js"></script>',
};
const ELEMENT = '<div id="chart" class="card"></div>';

interface Live { listeners: string[]; observers: string[]; frames: number; requested: number }

describe.each(Object.entries(ROUTES))('%s', (label, route) => {
  it('create, destroy, create again on one element: one chart, the first inert; after destroy nothing is left that responds', async () => {
    const at = `/lifecycle/${label.replace(/\W+/g, '-')}.html`;
    server.pages.set(at, { html: `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>lifecycle</title><link rel="stylesheet" href="/pages/page.css"><script src="/pages/instrument.js"></script></head><body>${ELEMENT}${route()}</body></html>` });
    const w = await open(server);
    await w.page.goto(`${server.origin}${at}`);
    await w.page.waitForFunction(() => typeof (window as unknown as { Axylo?: { line?: unknown } }).Axylo?.line === 'function');

    await w.page.evaluate(async () => {
      type Handle = { destroy(): void; on(e: string, l: (p: unknown) => void): () => void; update(p: object): void; append(r: object[]): void; zoom(d: unknown): void };
      const g = window as unknown as { Axylo: { line(t: Element, o: object): Handle }; __tracking: boolean; __charts: Handle[]; __events: number[] };
      const el = document.getElementById('chart')!;
      const options = { title: 'Monthly visitors', data: [{ month: '2026-01', visitors: 4210 }, { month: '2026-02', visitors: 4685 }, { month: '2026-03', visitors: 5302 }, { month: '2026-04', visitors: 5127 }], x: 'month', y: 'visitors' };
      const frames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      g.__tracking = true;
      g.__events = [0, 0];
      const first = g.Axylo.line(el, options);
      first.on('hover', () => { g.__events[0]!++; });
      await frames();
      first.destroy();
      (g as unknown as { __between: string }).__between = el.outerHTML;
      const second = g.Axylo.line(el, options);
      second.on('hover', () => { g.__events[1]!++; });
      g.__charts = [first, second];
    });
    expect(await w.page.evaluate(() => (window as unknown as { __between: string }).__between), 'the element between destroy and create').toBe(ELEMENT);
    expect((await drawn(w.page, '#chart')).marks).toBeGreaterThan(0);
    expect(await w.page.locator('#chart figure').count()).toBe(1);

    // The destroyed chart is inert.
    const stale = await w.page.evaluate(async () => {
      const g = window as unknown as { __charts: { update(p: object): void; append(r: object[]): void; zoom(d: unknown): void }[] };
      const first = g.__charts[0]!;
      first.update({ title: 'Stale' });
      first.append([{ month: '2026-05', visitors: 1 }]);
      first.zoom(['2026-01', '2026-02']);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { figures: document.querySelectorAll('#chart figure').length, titles: Array.from(document.querySelectorAll('#chart .axylo-title')).map(t => t.textContent) };
    });
    expect(stale).toEqual({ figures: 1, titles: ['Monthly visitors'] });
    const plot = (await w.page.locator('#chart .axylo-plot').boundingBox())!;
    for (const f of [0.3, 0.5, 0.7]) { await w.page.mouse.move(plot.x + plot.width * f, plot.y + plot.height * 0.5); await w.page.waitForTimeout(50); }
    const events = () => w.page.evaluate(() => (window as unknown as { __events: number[] }).__events);
    const [toFirst, toSecond] = await events();
    expect(toFirst, 'events reaching the destroyed chart').toBe(0);
    expect(toSecond, 'events reaching the live chart').toBeGreaterThan(0);
    const whileLive: Live = await w.page.evaluate(() => (window as unknown as { __live(): Live }).__live());
    // The instruments see the live chart's registrations, so an empty list after destroy means something.
    console.info(`${label}, live chart: ${whileLive.listeners.length} listeners, ${whileLive.observers.length} observers`);
    expect(whileLive.listeners.length).toBeGreaterThan(0);
    expect(whileLive.observers.length).toBeGreaterThan(0);

    // The final destroy: the element as written, and nothing left that responds.
    // Leaving the plot is itself an event (hover with null); count from after it.
    await w.page.mouse.move(1, 1);
    await w.page.waitForTimeout(50);
    const beforeDestroy = (await events())[1];
    const after: Live & { element: string } = await w.page.evaluate(async () => {
      const g = window as unknown as { __charts: { destroy(): void }[]; __live(): Live };
      g.__charts[1]!.destroy();
      await new Promise(r => setTimeout(r, 100));
      return { ...g.__live(), element: document.getElementById('chart')!.outerHTML };
    });
    expect(after.element).toBe(ELEMENT);
    expect(after.listeners, 'listeners still registered').toEqual([]);
    expect(after.observers, 'observers still observing').toEqual([]);
    expect(after.frames, 'animation frames still pending').toBe(0);

    await w.page.setViewportSize({ width: 700, height: 600 });
    await w.page.evaluate(() => window.dispatchEvent(new Event('resize')));
    for (const f of [0.3, 0.5, 0.7]) { await w.page.mouse.move(plot.x + plot.width * f, plot.y + plot.height * 0.5); await w.page.waitForTimeout(50); }
    const later: Live & { element: string } = await w.page.evaluate(() => ({ ...(window as unknown as { __live(): Live }).__live(), element: document.getElementById('chart')!.outerHTML }));
    expect(later.requested, 'frames requested after destroy').toBe(after.requested);
    expect(later.element).toBe(ELEMENT);
    expect((await events())[1], 'events after destroy').toBe(beforeDestroy);
    expect(problems(w)).toEqual([]);
    await w.context.close();
  });
});
