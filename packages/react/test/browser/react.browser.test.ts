/**
 * @axylo/react in system Chrome (plan 1.7, spec DX5, DX8): lifecycle, StrictMode, props to patches, removed
 * props, handlers, the ref, error boundaries, independence and hydration. The app (app.tsx) is driven through
 * `window.app`; the core is wrapped (spy-axylo.ts) so creates, updates, destroys and thrown errors are seen.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright-core';
import { renderToString } from 'react-dom/server';
import { start, stop } from '../../../axylo/test/browser/harness';
import { closeApp, openApp } from './open';
import type { Spec } from './app';

// The hydration test renders the tree in Node too, from source.
vi.mock('axylo', () => import('../../../axylo/src/index'));
const { hydrationTree } = await import('./tree');

beforeAll(start);
afterAll(stop);

type Handle = {
  append(rows: unknown[]): void; zoom(d: unknown): void; update(p: Record<string, unknown>): void; diagnostics: { code: string; chart: string }[];
  __bench: { describe(): { series: { points: number; newestX: number }[] } };
  __dev: { stages(): Record<string, number> };
};
type App = {
  render(specs: Spec[], options?: { strict?: boolean }): Promise<void>;
  commit(specs: Spec[], options?: { strict?: boolean; suspend?: boolean }): void;
  abandon(specs: Spec[]): Promise<void>;
  ready(): Promise<void>;
  setData(name: string, rows: unknown[]): void;
  chart(i: number): Handle | null;
  raw(i: number): Handle | null;
  duringLayout: null | (() => unknown);
  setColumns(name: string, n: number): void;
  handle(i: number): { chart: Handle | null } | null;
  spy: { attempts: number; failOn: boolean; failDestroy: boolean; errors: unknown[]; charts: { kind: string; element: WeakRef<HTMLElement>; chart: WeakRef<Handle>; updates: Record<string, unknown>[]; appends: number; destroys: number }[] };
  probe: { resizeCallbacks: number; observers: number; pendingFrames: number; mark(): number; leakedSince(mark: number): string[]; detachedSince(mark: number): string[]; detachedTargets(mark: number): Element[] };
  events: [string, unknown][];
  seen: Record<string, unknown>[];
  caught: unknown[];
  counted: Record<string, { reads: number }>;
  hydrationErrors: string[];
  nextFrames(n: number): Promise<void>;
  hydrate(): Promise<void>;
};
declare const window: Window & { app: App; saved?: unknown };

const day = (i: number) => `2026-01-${String(i + 1).padStart(2, '0')}`;
const trend = Array.from({ length: 10 }, (_, i) => [
  { day: day(i), channel: 'Direct', sessions: 30 + (i % 4) * 3, visits: 10 + i },
  { day: day(i), channel: 'Organic', sessions: 20 + (i % 3) * 2, visits: 5 + i },
]).flat();
const single = Array.from({ length: 10 }, (_, i) => ({ day: day(i), sessions: 10 + i }));
const slices = [{ channel: 'Direct', sessions: 30 }, { channel: 'Organic', sessions: 20 }, { channel: 'Referral', sessions: 10 }];
// AX106: a number field holding one string. A warning, so a strict chart throws.
const bad = single.map((r, i) => i === 4 ? { ...r, sessions: '14' } : r);
const next = { day: '2026-01-11', sessions: 21 };

async function open(): Promise<Page> {
  const page = await openApp();
  await page.evaluate(([t, s, d, b]) => {
    window.app.setData('trend', t);
    window.app.setData('single', s);
    window.app.setData('single again', s.map(r => ({ ...(r as object) })));
    window.app.setData('slices', d);
    window.app.setData('bad', b);
  }, [trend, single, slices, bad] as const);
  return page;
}

const render = (page: Page, specs: Spec[], options: { strict?: boolean } = {}) =>
  page.evaluate(async ([s, o]) => { await window.app.render(s, o); await window.app.ready(); }, [specs, options] as const);

/** Commits synchronously and returns what the parent saw during that commit, before any frame. */
const commit = (page: Page, specs: Spec[], options: { suspend?: boolean } = {}) =>
  page.evaluate(([s, o]) => { const from = window.app.seen.length; window.app.commit(s, o); return window.app.seen.slice(from); }, [specs, options] as const);

const named = (page: Page, name: string) => page.getByRole('group', { name, exact: true }).count();

const spyState = (page: Page) => page.evaluate(() => ({
  attempts: window.app.spy.attempts,
  charts: window.app.spy.charts.map(c => ({ kind: c.kind, destroys: c.destroys, updates: c.updates.map(p => Object.keys(p)) })),
}));

const points = (page: Page) => page.evaluate(() => window.app.raw(0)!.__bench.describe().series[0]!.points);
const eventsSince = (page: Page, n: number) => page.evaluate(k => window.app.events.slice(k), n);
const eventCount = (page: Page) => page.evaluate(() => window.app.events.length);

async function plotPoint(page: Page, fraction: number): Promise<{ x: number; y: number }> {
  const box = await page.evaluate(() => {
    const r = document.querySelector('#chart .axylo-plot')!.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  });
  return { x: box.x + box.width * fraction, y: box.y + box.height / 2 };
}

async function hoverAt(page: Page, fraction: number): Promise<void> {
  const p = await plotPoint(page, fraction);
  await page.mouse.move(p.x, p.y, { steps: 4 });
  await page.evaluate(() => window.app.nextFrames(3));
}

const cases: [Spec['type'], string, Record<string, unknown>][] = [
  ['Line', 'trend', { x: 'day', y: 'sessions', series: 'channel' }],
  ['Area', 'trend', { x: 'day', y: 'sessions', series: 'channel', stacked: true }],
  ['Bar', 'trend', { x: 'day', y: 'sessions', series: 'channel' }],
  ['Scatter', 'trend', { x: 'visits', y: 'sessions', series: 'channel' }],
  ['Donut', 'slices', { label: 'channel', value: 'sessions' }],
];

describe('lifecycle', () => {
  for (const [type, data, props] of cases) {
    it(`${type}: mount, update, unmount`, async () => {
      const page = await open();
      await render(page, [{ type, data, props: { ...props, title: `${type} one` } }]);
      expect(await page.locator('#chart > div.axylo > figure.axylo-figure').count()).toBe(1);
      expect(await named(page, `${type} one`)).toBe(1);

      await render(page, [{ type, data, props: { ...props, title: `${type} two` } }]);
      expect(await spyState(page)).toEqual({ attempts: 1, charts: [{ kind: type.toLowerCase(), destroys: 0, updates: [['title']] }] });
      expect(await named(page, `${type} two`)).toBe(1);
      expect(await named(page, `${type} one`)).toBe(0);

      await page.evaluate(() => { window.saved = window.app.handle(0); });
      await render(page, []);
      expect(await page.evaluate(() => document.getElementById('chart')!.innerHTML)).toBe('');
      expect((await spyState(page)).charts[0]!.destroys).toBe(1);
      expect(await page.evaluate(() => window.app.chart(0))).toBeNull();
      // A handle saved before unmount no longer reaches the destroyed chart.
      expect(await page.evaluate(() => (window.saved as { chart: unknown }).chart)).toBeNull();
      expect(await closeApp(page)).toEqual([]);
    });
  }

  it('unmounting before the first frame cancels it: nothing is drawn after destroy, destroy runs once', async () => {
    const page = await open();
    await render(page, []);
    const result = await page.evaluate(async () => {
      window.app.commit([{ type: 'Line', data: 'single', props: { x: 'day', y: 'sessions', title: 'Brief' } }]);
      const chart = window.app.spy.charts[0]!.chart.deref()!;
      const pendingWhileMounted = window.app.probe.pendingFrames;
      window.app.commit([]);
      const pendingAfter = window.app.probe.pendingFrames;
      await window.app.nextFrames(4);
      return { pendingWhileMounted, pendingAfter, draws: chart.__dev.stages().draw, destroys: window.app.spy.charts[0]!.destroys };
    });
    expect(result.pendingWhileMounted).toBeGreaterThan(0);
    expect(result).toEqual({ pendingWhileMounted: result.pendingWhileMounted, pendingAfter: 0, draws: 0, destroys: 1 });
    expect(await closeApp(page)).toEqual([]);
  });

  it('a key change destroys the old chart once and creates a new one', async () => {
    const page = await open();
    const props = { x: 'day', y: 'sessions', title: 'Keyed' };
    await render(page, [{ type: 'Line', data: 'single', key: 'a', props }]);
    await render(page, [{ type: 'Line', data: 'single', key: 'b', props }]);
    expect(await spyState(page)).toEqual({ attempts: 2, charts: [{ kind: 'line', destroys: 1, updates: [] }, { kind: 'line', destroys: 0, updates: [] }] });
    expect(await page.locator('#chart figure').count()).toBe(1);
    expect(await closeApp(page)).toEqual([]);
  });
});

describe('StrictMode', () => {
  it('setup, cleanup, setup leaves one chart; unmount leaves nothing behind', async () => {
    const page = await open();
    await render(page, [], { strict: true });
    const before = await page.evaluate(() => ({ mark: window.app.probe.mark(), observers: window.app.probe.observers }));

    await render(page, [{ type: 'Line', data: 'trend', props: { x: 'day', y: 'sessions', series: 'channel', title: 'Strict' } }], { strict: true });
    expect(await page.locator('#chart figure').count()).toBe(1);
    expect(await named(page, 'Strict')).toBe(1);
    const state = await spyState(page);
    // StrictMode ran the create twice and the cleanup once in between.
    expect(state.attempts).toBe(2);
    expect(state.charts.map(c => c.destroys)).toEqual([1, 0]);
    expect(await page.evaluate(() => window.app.probe.observers)).toBeGreaterThan(before.observers);

    await render(page, [], { strict: true });
    expect(await page.evaluate(() => document.getElementById('chart')!.innerHTML)).toBe('');
    expect((await spyState(page)).charts.map(c => c.destroys)).toEqual([1, 1]);
    await page.evaluate(() => window.app.nextFrames(2));
    const callbacks = await page.evaluate(() => window.app.probe.resizeCallbacks);
    await page.evaluate(() => { document.getElementById('chart')!.style.width = '360px'; });
    await page.setViewportSize({ width: 500, height: 600 });
    await page.evaluate(() => window.app.nextFrames(4));
    const after = await page.evaluate(m => ({
      callbacks: window.app.probe.resizeCallbacks, observers: window.app.probe.observers,
      leaked: window.app.probe.leakedSince(m), detached: window.app.probe.detachedSince(m), frames: window.app.probe.pendingFrames,
    }), before.mark);
    expect(after).toEqual({ callbacks, observers: before.observers, leaked: [], detached: after.detached, frames: 0 });
    // Listeners left on nodes that have left the document can never fire. Observed: the core leaves some on
    // its own removed proxy, toolbar and legend elements (reported to the coordinator); none may be on the
    // container React rendered or anything else outside the core's own `axylo-*` elements.
    expect(await page.evaluate(m => window.app.probe.detachedTargets(m).filter(t => t.closest('[class*="axylo-"]') === null).map(t => t.outerHTML.slice(0, 80)), before.mark)).toEqual([]);
    expect(await closeApp(page)).toEqual([]);
  });
});

describe('commit phase (findings 2 and 3)', () => {
  it('on mount, a callback ref and the parent layout effect see a created chart', async () => {
    const page = await open();
    const seen = await commit(page, [{ type: 'Line', data: 'single', callbackRef: true, props: { x: 'day', y: 'sessions', title: 'Early' } }]);
    expect(seen).toEqual([
      { index: 0, effect: 'callback ref', attached: true, chart: true },
      { index: 0, effect: 'parent layout', chart: true, diagnostics: 0 },
    ]);
    expect(await closeApp(page)).toEqual([]);
  });

  it('a parent layout effect that appends after a data change appends to the new data', async () => {
    const page = await open();
    const props = { x: 'day', y: 'sessions', title: 'Order' };
    await render(page, [{ type: 'Line', data: 'single', props }]);
    const seen = await commit(page, [{ type: 'Line', data: 'single again', props, layout: { append: [next] } }]);
    expect(seen).toEqual([{ index: 0, effect: 'parent layout', chart: true, diagnostics: 0 }, { index: 0, action: 'ok' }]);
    await page.evaluate(() => window.app.ready());
    expect(await points(page)).toBe(11);
    expect(await closeApp(page)).toEqual([]);
  });

  it('diagnostics read in a parent layout effect describe the props of that commit', async () => {
    const page = await open();
    const props = { x: 'day', y: 'sessions', title: 'Current' };
    await render(page, [{ type: 'Line', data: 'single', props }]);
    const seen = await commit(page, [{ type: 'Line', data: 'bad', props }]);
    const settled = await page.evaluate(() => window.app.chart(0)!.diagnostics.map(d => d.code));
    expect(settled).toContain('AX106');
    expect(seen).toEqual([{ index: 0, effect: 'parent layout', chart: true, diagnostics: settled.length }]);
    expect(await closeApp(page)).toEqual([]);
  });

  it('after a Suspense fallback, the revealed chart is the same one and matches the revealing commit', async () => {
    const page = await open();
    const props = { x: 'day', y: 'sessions', title: 'Suspended' };
    await render(page, [{ type: 'Line', data: 'single', props }]);
    await commit(page, [{ type: 'Line', data: 'single', props }], { suspend: true });
    expect(await page.locator('#chart .fallback').count()).toBe(1);
    const seen = await commit(page, [{ type: 'Line', data: 'single again', props, layout: { append: [next] } }]);
    expect(seen.at(-1)).toEqual({ index: 0, action: 'ok' });
    await page.evaluate(() => window.app.ready());
    expect(await points(page)).toBe(11);
    expect(await spyState(page)).toEqual({ attempts: 1, charts: [{ kind: 'line', destroys: 0, updates: [['data']] }] });
    expect(await closeApp(page)).toEqual([]);
  });

  it('onDiagnostic replaced, removed and reinstated takes effect within the commit', async () => {
    const page = await open();
    const props = { x: 'day', y: 'sessions', title: 'Diagnostics' };
    // A zoom window that cannot be read is reported synchronously, every time (spec 3.5).
    const zoomBadly = { zoom: ['not a day', 'nor this'] };
    await render(page, [{ type: 'Line', data: 'single', props, on: { diagnostic: 'A' } }]);
    let n = await eventCount(page);
    await commit(page, [{ type: 'Line', data: 'single', props, on: { diagnostic: 'B' }, layout: zoomBadly }]);
    const replaced = await eventsSince(page, n);
    expect(replaced.length).toBeGreaterThan(0);
    expect(new Set(replaced.map(e => e[0]))).toEqual(new Set(['diagnostic:B']));
    n = await eventCount(page);
    await commit(page, [{ type: 'Line', data: 'single', props, layout: zoomBadly }]);
    expect(await eventsSince(page, n)).toEqual([]);
    await commit(page, [{ type: 'Line', data: 'single', props, on: { diagnostic: 'C' }, layout: zoomBadly }]);
    const reinstated = await eventsSince(page, n);
    expect(reinstated.length).toBeGreaterThan(0);
    expect(new Set(reinstated.map(e => e[0]))).toEqual(new Set(['diagnostic:C']));
    expect(await closeApp(page)).toEqual([]);
  });

  it('onZoom replaced, removed and reinstated takes effect within the commit', async () => {
    const page = await open();
    const props = { x: 'day', y: 'sessions', title: 'Zoom' };
    await render(page, [{ type: 'Line', data: 'single', props, on: { zoom: 'A' } }]);
    let n = await eventCount(page);
    await commit(page, [{ type: 'Line', data: 'single', props, on: { zoom: 'B' }, layout: { zoom: ['2026-01-02', '2026-01-05'] } }]);
    expect((await eventsSince(page, n)).map(e => e[0])).toEqual(['zoom:B']);
    n = await eventCount(page);
    await commit(page, [{ type: 'Line', data: 'single', props, layout: { zoom: ['2026-01-03', '2026-01-06'] } }]);
    expect(await eventsSince(page, n)).toEqual([]);
    await commit(page, [{ type: 'Line', data: 'single', props, on: { zoom: 'C' }, layout: { zoom: ['2026-01-04', '2026-01-07'] } }]);
    expect((await eventsSince(page, n)).map(e => e[0])).toEqual(['zoom:C']);
    expect(await closeApp(page)).toEqual([]);
  });

  it('an abandoned transition applies nothing: no update, and handlers stay the committed ones', async () => {
    const page = await open();
    const props = { x: 'day', y: 'sessions' };
    await render(page, [{ type: 'Line', data: 'single', props: { ...props, title: 'Committed' }, on: { zoom: 'committed' } }]);
    await page.evaluate(() => window.app.abandon([{ type: 'Line', data: 'single again', props: { x: 'day', y: 'sessions', title: 'Abandoned' }, on: { zoom: 'abandoned' } }]));
    expect(await spyState(page)).toEqual({ attempts: 1, charts: [{ kind: 'line', destroys: 0, updates: [] }] });
    expect(await named(page, 'Committed')).toBe(1);
    const n = await eventCount(page);
    await page.evaluate(() => window.app.chart(0)!.zoom(['2026-01-02', '2026-01-05']));
    expect((await eventsSince(page, n)).map(e => e[0])).toEqual(['zoom:committed']);
    expect(await closeApp(page)).toEqual([]);
  });
});

describe('detached handle (review C2)', () => {
  const props = { x: 'day', y: 'sessions', title: 'Detached' };
  const later = { day: '2026-01-12', sessions: 22 };

  it('while Suspense hides the chart a saved handle reads null; a call made then waits and applies after the revealing props', async () => {
    const page = await open();
    await render(page, [{ type: 'Line', data: 'single', props }]);
    await page.evaluate(() => { window.saved = window.app.handle(0); (window as unknown as { facade: unknown }).facade = window.app.chart(0); });
    await commit(page, [{ type: 'Line', data: 'single', props }], { suspend: true });
    expect(await page.locator('#chart .fallback').count()).toBe(1);
    const hidden = await page.evaluate(n => {
      const facade = (window as unknown as { facade: { append(r: unknown[]): void } }).facade;
      let call = 'accepted';
      try { facade.append([n]); } catch (error) { call = String(error); }
      return { chart: (window.saved as { chart: unknown }).chart, call, appends: window.app.spy.charts[0]!.appends };
    }, next);
    expect(hidden).toEqual({ chart: null, call: 'accepted', appends: 0 });
    // Revealed with new data: the waiting append lands after it, so it is not erased.
    await commit(page, [{ type: 'Line', data: 'single again', props }]);
    expect(await page.evaluate(() => ({
      same: (window.saved as { chart: unknown }).chart === (window as unknown as { facade: unknown }).facade,
      appends: window.app.spy.charts[0]!.appends,
    }))).toEqual({ same: true, appends: 1 });
    await page.evaluate(() => window.app.ready());
    expect(await points(page)).toBe(11);
    expect(await spyState(page)).toEqual({ attempts: 1, charts: [{ kind: 'line', destroys: 0, updates: [['data']] }] });
    expect(await closeApp(page)).toEqual([]);
  });

  it('appended rows and the zoom survive a Suspense hide', async () => {
    const page = await open();
    await render(page, [{ type: 'Line', data: 'single', props }]);
    await page.evaluate(async n => { window.app.chart(0)!.append([n]); window.app.chart(0)!.zoom(['2026-01-03', '2026-01-07']); await window.app.ready(); }, next);
    const before = await page.evaluate(() => window.app.raw(0)!.__bench.describe() as unknown);
    await commit(page, [{ type: 'Line', data: 'single', props }], { suspend: true });
    await commit(page, [{ type: 'Line', data: 'single', props }]);
    await page.evaluate(() => window.app.ready());
    expect(await page.evaluate(() => window.app.raw(0)!.__bench.describe() as unknown)).toEqual(before);
    expect(await points(page)).toBe(11);
    expect((await spyState(page)).charts.map(c => c.destroys)).toEqual([0]);
    expect(await closeApp(page)).toEqual([]);
  });

  it('in the commit that unmounts the chart, a saved handle reads null before passive teardown; calls are then reported, and rejected after', async () => {
    const page = await open();
    const errors: string[] = [];
    page.on('console', m => { if (m.type() === 'error' && m.text().includes('[axylo/react]')) errors.push(m.text()); });
    await render(page, [{ type: 'Line', data: 'single', props }]);
    await page.evaluate(n => {
      const saved = window.app.handle(0)!;
      const facade = window.app.chart(0)!;
      (window as unknown as { facade: unknown }).facade = facade;
      window.app.duringLayout = () => {
        let call = 'accepted';
        try { facade.append([n]); } catch (error) { call = String(error); }
        return { chart: saved.chart, call };
      };
    }, next);
    const seen = await commit(page, []);
    await page.evaluate(() => { window.app.duringLayout = null; });
    expect(seen).toEqual([{ effect: 'watcher', result: { chart: null, call: 'accepted' } }]);
    await page.evaluate(() => window.app.nextFrames(2));
    expect(errors.some(e => /not applied/.test(e))).toBe(true);
    expect(await page.evaluate(() => window.app.spy.charts[0]!.appends)).toBe(0);
    const after = await page.evaluate(n => {
      try { (window as unknown as { facade: { append(r: unknown[]): void } }).facade.append([n]); return 'accepted'; } catch (error) { return String(error); }
    }, later);
    expect(after).toMatch(/unmounted/);
    expect(await closeApp(page)).toEqual([]);
  });

  it('a call from an earlier sibling\'s layout effect in the same commit applies after this commit\'s props', async () => {
    const page = await open();
    await render(page, [{ type: 'Line', data: 'single', props }]);
    await page.evaluate(n => { const facade = window.app.chart(0)!; window.app.duringLayout = () => { facade.append([n]); return 'called'; }; }, next);
    await commit(page, [{ type: 'Line', data: 'single again', props }]);
    await page.evaluate(() => { window.app.duringLayout = null; });
    await page.evaluate(() => window.app.ready());
    expect(await points(page)).toBe(11);
    expect(await closeApp(page)).toEqual([]);
  });
});

describe('disposal failures (review C3)', () => {
  const props = { x: 'day', y: 'sessions', title: 'Disposal' };

  it('when on() throws A and destroy() then throws B, the boundary receives A and B is reported', async () => {
    const page = await open();
    const errors: string[] = [];
    page.on('console', m => { if (m.type() === 'error' && m.text().includes('[axylo/react]')) errors.push(m.text()); });
    await page.evaluate(() => { window.app.spy.failOn = true; window.app.spy.failDestroy = true; });
    await render(page, [{ type: 'Line', data: 'single', props }]);
    expect(await page.evaluate(() => (window.app.caught.at(-1) as Error).message)).toBe('listener registration failed');
    expect((await spyState(page)).charts.map(c => c.destroys)).toEqual([1]);
    expect(errors.some(e => e.includes('destroy'))).toBe(true);
    expect(await closeApp(page)).toEqual([]);
  });

  it('a destroy() that throws during unmount is reported and does not reach the boundary', async () => {
    const page = await open();
    const errors: string[] = [];
    page.on('console', m => { if (m.type() === 'error' && m.text().includes('[axylo/react]')) errors.push(m.text()); });
    await page.evaluate(() => { window.app.spy.failDestroy = true; });
    await render(page, [{ type: 'Line', data: 'single', props }]);
    await page.evaluate(() => { window.saved = window.app.handle(0); });
    // The parent removes the chart in a passive effect; its boundary stays mounted.
    await render(page, [{ type: 'Line', data: 'single', props, removeAfterCommit: true }]);
    expect(await page.evaluate(() => window.app.caught.length)).toBe(0);
    expect((await spyState(page)).charts.map(c => c.destroys)).toEqual([1]);
    expect(errors.some(e => e.includes('destroy'))).toBe(true);
    expect(await page.evaluate(() => (window.saved as { chart: unknown }).chart)).toBeNull();
    expect(await closeApp(page)).toEqual([]);
  });
});

describe('memoization hint sampler (review C5)', () => {
  it('a data replacement with an unreadable column the chart does not plot still reaches the core', async () => {
    const page = await open();
    const props = { x: 't', y: 'v', title: 'Columns' };
    await page.evaluate(() => window.app.setColumns('cols', 10));
    await render(page, [{ type: 'Line', data: 'cols', props }]);
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.app.setColumns('cols', 10));
      await render(page, [{ type: 'Line', data: 'cols', props }]);
    }
    expect(await page.evaluate(() => window.app.caught.map(e => String(e)))).toEqual([]);
    expect((await spyState(page)).charts.map(c => c.updates)).toEqual([[['data'], ['data'], ['data'], ['data']]]);
    expect(await closeApp(page)).toEqual([]);
  });
});

describe('diagnostic name (review C6, pending a core change)', () => {
  it('a chart without a title, in a div with id="sessions", names its diagnostics "sessions"', async () => {
    const page = await open();
    await render(page, [{ type: 'Line', data: 'single', props: { x: 'day', y: 'sessions', id: 'sessions' } }]);
    const names = await page.evaluate(() => window.app.raw(0)!.diagnostics.map(d => [d.code, d.chart]));
    expect(names.map(n => n[0])).toContain('AX140');
    expect(new Set(names.map(n => n[1]))).toEqual(new Set(['sessions']));
    expect(await closeApp(page)).toEqual([]);
  });
});

describe('props to options', () => {
  it('an inline field object re-rendered ten times causes zero update calls', async () => {
    const page = await open();
    const spec = (label: string): Spec => ({
      type: 'Line', data: 'trend', props: {
        x: { field: 'day', type: 'date' }, y: { field: 'sessions', label, tickFormat: { notation: 'compact' } }, series: 'channel',
        title: { text: 'Inline', level: 3 }, colors: { Direct: '#1f6feb' }, reference: [{ y: 30, label: 'Target' }],
        messages: { noData: 'Nothing' }, style: { height: 300 },
      },
    });
    await render(page, [spec('Sessions')]);
    // Each evaluate deserializes the spec anew, so every render passes new objects.
    for (let i = 0; i < 10; i++) await render(page, [spec('Sessions')]);
    expect(await spyState(page)).toEqual({ attempts: 1, charts: [{ kind: 'line', destroys: 0, updates: [] }] });
    // The spy does see a real change.
    await render(page, [spec('Visits')]);
    expect((await spyState(page)).charts[0]!.updates).toEqual([['y']]);
    expect(await closeApp(page)).toEqual([]);
  });

  it('an equal replacement object is compared once, not on every later render (finding 9)', async () => {
    const page = await open();
    const colors = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`S${i}`, `#${String(i).padStart(6, '0')}`]));
    const base = { type: 'Line' as const, data: 'single', props: { x: 'day', y: 'sessions', title: 'Colors' } };
    await render(page, [{ ...base, props: { ...base.props, colors } }]);
    await render(page, [{ ...base, countedColors: { name: 'p', colors } }]);
    const once = await page.evaluate(() => window.app.counted.p!.reads);
    expect(once).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) await render(page, [{ ...base, countedColors: { name: 'p', colors } }]);
    expect(await page.evaluate(() => window.app.counted.p!.reads)).toBe(once);
    expect((await spyState(page)).charts[0]!.updates).toEqual([]);
    expect(await closeApp(page)).toEqual([]);
  });

  it('a removed title restores the generated name', async () => {
    const page = await open();
    const props = { x: 'day', y: 'sessions', series: 'channel' };
    // The second chart never had a title: its name is the generated one.
    await render(page, [{ type: 'Line', data: 'trend', props: { ...props, title: 'Sessions' } }, { type: 'Line', data: 'trend', props }]);
    expect(await named(page, 'Sessions')).toBe(1);
    const generated = await page.evaluate(() => document.querySelectorAll('#chart figure')[1]!.getAttribute('aria-label'));
    expect(generated).toBeTruthy();

    await render(page, [{ type: 'Line', data: 'trend', props }, { type: 'Line', data: 'trend', props }]);
    const sent = await page.evaluate(() => window.app.spy.charts[0]!.updates.map(p => [Object.keys(p), Object.hasOwn(p, 'title') && p.title === undefined]));
    expect(sent).toEqual([[['title'], true]]);
    expect(await named(page, 'Sessions')).toBe(0);
    expect(await named(page, generated!)).toBe(2);
    expect(await page.evaluate(() => document.querySelector('#chart figure')!.hasAttribute('aria-labelledby'))).toBe(false);
    expect(await closeApp(page)).toEqual([]);
  });

  it('title={undefined} after a title set through the ref restores the generated name (finding 4)', async () => {
    const page = await open();
    const props = { x: 'day', y: 'sessions', series: 'channel' };
    await render(page, [{ type: 'Line', data: 'trend', props }]);
    const generated = await page.evaluate(() => document.querySelector('#chart figure')!.getAttribute('aria-label'));
    await page.evaluate(async () => { window.app.chart(0)!.update({ title: 'Live' }); await window.app.ready(); });
    expect(await named(page, 'Live')).toBe(1);
    await render(page, [{ type: 'Line', data: 'trend', props, unset: ['title'] }]);
    expect(await named(page, 'Live')).toBe(0);
    expect(await named(page, generated!)).toBe(1);
    expect(await closeApp(page)).toEqual([]);
  });

  it('a removed tooltip={false} restores the tooltip', async () => {
    const page = await open();
    const props = { x: 'day', y: 'sessions', series: 'channel', title: 'Tips' };
    const shown = () => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#chart .axylo-tooltip, #chart .axylo-readout')].some(e => !e.hidden));
    await render(page, [{ type: 'Line', data: 'trend', on: { hover: 'h' }, props: { ...props, tooltip: false } }]);
    await hoverAt(page, 0.3);
    expect(await eventCount(page)).toBeGreaterThan(0);
    expect(await shown()).toBe(false);

    await render(page, [{ type: 'Line', data: 'trend', on: { hover: 'h' }, props }]);
    expect((await spyState(page)).charts[0]!.updates).toEqual([['tooltip']]);
    await hoverAt(page, 0.7);
    expect(await shown()).toBe(true);
    expect(await closeApp(page)).toEqual([]);
  });

  it('id, className, style and data-* reach the container, never the chart; aria-* is reported as an unknown option', async () => {
    const page = await open();
    await render(page, [{
      type: 'Line', data: 'single', on: { diagnostic: 'd' },
      props: { x: 'day', y: 'sessions', title: 'Host', strict: true, id: 'host-card', className: 'card', style: { height: 280 }, 'data-testid': 'card' },
    }]);
    const host = await page.evaluate(() => {
      const div = document.getElementById('host-card');
      return div && { cls: div.className, testid: div.dataset.testid, height: div.style.height, figure: !!div.querySelector('figure') };
    });
    expect(host).toEqual({ cls: 'axylo card', testid: 'card', height: '280px', figure: true });
    expect(await page.locator('#chart .caught').count()).toBe(0);
    await render(page, [{ type: 'Line', data: 'single', on: { diagnostic: 'd' }, props: { x: 'day', y: 'sessions', title: 'Host', 'aria-label': 'Named' } }]);
    expect((await page.evaluate(() => window.app.events)).filter(e => e[0] === 'diagnostic:d').map(e => e[1])).toContain('AX150');
    expect(await closeApp(page)).toEqual([]);
  });

  it('the memoization hint: once per chart, on the third endpoint-equal replacement, worded as a sample', async () => {
    const page = await open();
    const warnings: string[] = [];
    page.on('console', m => { if (m.type() === 'warning' && m.text().includes('[axylo/react]')) warnings.push(m.text()); });
    const specs: Spec[] = [
      { type: 'Line', data: 'copy a', props: { x: 'day', y: 'sessions', title: 'Copies A' } },
      { type: 'Line', data: 'copy b', props: { x: 'day', y: 'sessions', title: 'Copies B' } },
    ];
    const counts: number[] = [];
    for (let i = 0; i < 6; i++) {
      // Each replacement changes a middle row: the hint must not claim the data is the same.
      const rows = single.map((r, k) => k === 5 ? { ...r, sessions: 100 + i } : r);
      await page.evaluate(d => { window.app.setData('copy a', d.map(r => ({ ...r }))); window.app.setData('copy b', d.map(r => ({ ...r }))); }, rows);
      await render(page, specs);
      counts.push(warnings.length);
    }
    // Render 1 mounts; renders 2, 3 and 4 are the three replacements; one hint per chart.
    expect(counts).toEqual([0, 0, 0, 2, 2, 2]);
    expect(warnings[0]).toContain('first and last values in the plotted fields');
    expect(warnings[0]).not.toMatch(/same data/);
    expect(warnings.some(w => w.includes('Line'))).toBe(true);
    // Identity is all that counts for the update itself.
    expect((await spyState(page)).charts.map(c => c.updates.length)).toEqual([5, 5]);
    expect(await closeApp(page)).toEqual([]);
  });
});

describe('handlers', () => {
  it('the latest onHover is called and the chart is not recreated', async () => {
    const page = await open();
    const props = { x: 'day', y: 'sessions', series: 'channel', title: 'Handlers' };
    await render(page, [{ type: 'Line', data: 'trend', on: { hover: 'first' }, props }]);
    await page.evaluate(() => { window.saved = document.querySelector('#chart figure'); });
    await hoverAt(page, 0.2);
    const firstCount = await eventCount(page);
    expect(firstCount).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.app.events.every(e => e[0] === 'hover:first'))).toBe(true);

    await render(page, [{ type: 'Line', data: 'trend', on: { hover: 'second' }, props }]);
    await hoverAt(page, 0.8);
    const later = (await eventsSince(page, firstCount)).map(e => e[0]);
    expect(later.length).toBeGreaterThan(0);
    expect(new Set(later)).toEqual(new Set(['hover:second']));
    expect(await spyState(page)).toEqual({ attempts: 1, charts: [{ kind: 'line', destroys: 0, updates: [] }] });
    expect(await page.evaluate(() => document.querySelector('#chart figure') === window.saved)).toBe(true);
    expect(await closeApp(page)).toEqual([]);
  });

  it('the latest onSelect is called on click', async () => {
    const page = await open();
    // Without a tooltip: the core's tooltip can sit under the pointer and take the click (spec I1 lets it be hovered).
    const props = { x: 'day', y: 'sessions', title: 'Select', tooltip: false };
    await render(page, [{ type: 'Line', data: 'single', on: { select: 'one' }, props }]);
    let p = await plotPoint(page, 0.3);
    await page.mouse.click(p.x, p.y);
    await page.evaluate(() => window.app.nextFrames(2));
    const n = await eventCount(page);
    expect((await eventsSince(page, 0)).map(e => e[0])).toContain('select:one');
    await render(page, [{ type: 'Line', data: 'single', on: { select: 'two' }, props }]);
    p = await plotPoint(page, 0.7);
    await page.mouse.click(p.x, p.y);
    await page.evaluate(() => window.app.nextFrames(2));
    const later = (await eventsSince(page, n)).map(e => e[0]).filter(t => t.startsWith('select'));
    expect(later.length).toBeGreaterThan(0);
    expect(new Set(later)).toEqual(new Set(['select:two']));
    expect(await closeApp(page)).toEqual([]);
  });
});

describe('ref', () => {
  it('ref.current.chart.append adds a point; a new data prop replaces the stream', async () => {
    const page = await open();
    const props = { x: 'day', y: 'sessions', title: 'Stream' };
    await render(page, [{ type: 'Line', data: 'single', props }]);
    const first = await page.evaluate(() => ({ s: window.app.raw(0)!.__bench.describe().series[0]!, diagnostics: Array.isArray(window.app.chart(0)!.diagnostics) }));
    expect(first.s.points).toBe(10);
    expect(first.diagnostics).toBe(true);

    await page.evaluate(async n => { window.app.chart(0)!.append([n]); await window.app.ready(); }, next);
    const appended = await page.evaluate(() => window.app.raw(0)!.__bench.describe().series[0]!);
    expect(appended.points).toBe(11);
    expect(appended.newestX).toBeGreaterThan(first.s.newestX);

    await render(page, [{ type: 'Line', data: 'single again', props }]);
    expect((await spyState(page)).charts[0]!.updates).toEqual([['data']]);
    const replaced = await page.evaluate(() => window.app.raw(0)!.__bench.describe().series[0]!);
    expect(replaced).toEqual(first.s);
    expect(await closeApp(page)).toEqual([]);
  });
});

describe('errors', () => {
  it('a strict chart with bad data is caught by an error boundary and recovers when given good data', async () => {
    const page = await open();
    const props = { x: 'day', y: 'sessions', title: 'Strict data', strict: true };
    const caught = () => page.evaluate(() => document.querySelector('#chart .caught')?.textContent ?? null);
    const original = () => page.evaluate(() => window.app.caught.at(-1) === window.app.spy.errors.at(-1) && window.app.spy.errors.length > 0);

    // Rejected at creation.
    await render(page, [{ type: 'Line', data: 'bad', props }]);
    expect(await caught()).toContain('AX106');
    expect(await original()).toBe(true);
    expect(await page.locator('#chart figure').count()).toBe(0);
    expect(await spyState(page)).toEqual({ attempts: 1, charts: [] });

    await render(page, [{ type: 'Line', data: 'single', props }]);
    expect(await caught()).toBeNull();
    expect(await named(page, 'Strict data')).toBe(1);

    // Rejected by an update: the boundary takes over and the rejected chart is destroyed.
    await render(page, [{ type: 'Line', data: 'bad', props }]);
    expect(await caught()).toContain('AX106');
    expect(await original()).toBe(true);
    expect(await page.locator('#chart figure').count()).toBe(0);

    await render(page, [{ type: 'Line', data: 'single', props }]);
    expect(await caught()).toBeNull();
    expect(await named(page, 'Strict data')).toBe(1);
    expect(await spyState(page)).toEqual({
      attempts: 3,
      charts: [{ kind: 'line', destroys: 1, updates: [['data']] }, { kind: 'line', destroys: 0, updates: [] }],
    });
    expect(await closeApp(page)).toEqual([]);
  });

  it('a strict rejection reaches the boundary even when the parent removes the chart right after the commit (finding 12)', async () => {
    const page = await open();
    const props = { x: 'day', y: 'sessions', title: 'Removed', strict: true };
    await render(page, [{ type: 'Line', data: 'single', props }]);
    await render(page, [{ type: 'Line', data: 'bad', props, removeAfterCommit: true }]);
    expect(await page.evaluate(() => window.app.caught.length)).toBe(1);
    expect(await page.evaluate(() => window.app.caught[0] === window.app.spy.errors[0])).toBe(true);
    expect((await spyState(page)).charts.map(c => c.destroys)).toEqual([1]);
    expect(await closeApp(page)).toEqual([]);
  });

  it('a setup failure after the chart exists destroys it before the error propagates (finding 13)', async () => {
    const page = await open();
    await page.evaluate(() => { window.app.spy.failOn = true; });
    await render(page, [{ type: 'Line', data: 'single', props: { x: 'day', y: 'sessions', title: 'Setup' } }]);
    expect(await page.evaluate(() => document.querySelector('#chart .caught')?.textContent)).toBe('listener registration failed');
    expect((await spyState(page)).charts.map(c => c.destroys)).toEqual([1]);
    expect(await page.locator('#chart figure').count()).toBe(0);
    expect(await closeApp(page)).toEqual([]);
  });
});

describe('independence', () => {
  it('two charts in one tree are independent', async () => {
    const page = await open();
    const a = { x: 'day', y: 'sessions', series: 'channel' };
    const b = { x: 'day', y: 'sessions', series: 'channel', layout: 'stacked' };
    await render(page, [{ type: 'Line', data: 'trend', props: { ...a, title: 'A' } }, { type: 'Bar', data: 'trend', props: { ...b, title: 'B' } }]);
    expect(await page.evaluate(() => window.app.spy.charts[0]!.element.deref() !== window.app.spy.charts[1]!.element.deref())).toBe(true);

    await render(page, [{ type: 'Line', data: 'trend', props: { ...a, title: 'A2' } }, { type: 'Bar', data: 'trend', props: { ...b, title: 'B' } }]);
    expect((await spyState(page)).charts.map(c => c.updates)).toEqual([[['title']], []]);
    expect([await named(page, 'A2'), await named(page, 'B')]).toEqual([1, 1]);

    await render(page, [{ type: 'Line', data: 'trend', props: { ...a, title: 'A2' } }]);
    expect((await spyState(page)).charts.map(c => c.destroys)).toEqual([0, 1]);
    expect(await page.locator('#chart figure').count()).toBe(1);
    expect(await named(page, 'A2')).toBe(1);
    await render(page, [{ type: 'Line', data: 'trend', props: { ...a, title: 'A3' } }]);
    expect(await named(page, 'A3')).toBe(1);
    expect(await closeApp(page)).toEqual([]);
  });
});

describe('hydration', () => {
  async function hydrate(markup: string): Promise<{ errors: string[]; recoverable: string[]; reused: boolean; page: Page }> {
    const page = await openApp();
    const errors: string[] = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.evaluate(m => { document.getElementById('chart')!.innerHTML = m; window.saved = document.querySelector('#chart div.axylo'); }, markup);
    await page.evaluate(() => window.app.hydrate());
    await page.waitForFunction(() => document.querySelectorAll('#chart figure').length === 2);
    const reused = await page.evaluate(() => document.querySelector('#chart figure')!.parentElement === window.saved);
    return { errors, recoverable: await page.evaluate(() => window.app.hydrationErrors), reused, page };
  }

  it('server-rendered markup hydrates without a mismatch warning, into the server-rendered div', async () => {
    const markup = renderToString(hydrationTree());
    expect(markup).toContain('<div class="axylo card" style="height:260px"></div>');
    const { errors, recoverable, reused, page } = await hydrate(markup);
    expect(errors).toEqual([]);
    expect(recoverable).toEqual([]);
    expect(reused).toBe(true);
    expect(await named(page, 'Hydrated line')).toBe(1);
    expect(await named(page, 'Hydrated donut')).toBe(1);
    expect(await closeApp(page)).toEqual([]);
  });

  it('control: altered markup is reported, so the check above can fail', async () => {
    const markup = renderToString(hydrationTree()).replace('class="axylo card"', 'class="axylo other"');
    const { errors, recoverable, page } = await hydrate(markup);
    expect([...errors, ...recoverable].join('\n')).toMatch(/hydrat/i);
    await closeApp(page);
  });
});
