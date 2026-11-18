/**
 * @axylo/react in system Chrome (plan 1.7, spec DX8): lifecycle, StrictMode, props to patches, removed props,
 * handlers, the ref, error boundaries, independence and hydration. The app (app.tsx) is driven through
 * `window.app`; the core is wrapped (spy-axylo.ts) so creates, updates and destroys can be counted.
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

type App = {
  render(specs: Spec[], options?: { strict?: boolean }): Promise<void>;
  ready(): Promise<void>;
  setData(name: string, rows: unknown[]): void;
  chart(i: number): { append(rows: unknown[]): void; diagnostics: unknown[]; __bench: { describe(): { series: { points: number; newestX: number }[] } } } | null;
  spy: { attempts: number; charts: { kind: string; element: HTMLElement; updates: Record<string, unknown>[]; destroyed: boolean }[] };
  probe: { resizeCallbacks: number; observers: number; pendingFrames: number; mark(): number; leakedSince(mark: number): string[] };
  events: [string, number | null][];
  hydrationErrors: string[];
  nextFrames(n: number): Promise<void>;
  hydrate(): Promise<void>;
};
declare const window: Window & { app: App; saved?: Element | null };

const day = (i: number) => `2026-01-${String(i + 1).padStart(2, '0')}`;
const trend = Array.from({ length: 10 }, (_, i) => [
  { day: day(i), channel: 'Direct', sessions: 30 + (i % 4) * 3, visits: 10 + i },
  { day: day(i), channel: 'Organic', sessions: 20 + (i % 3) * 2, visits: 5 + i },
]).flat();
const single = Array.from({ length: 10 }, (_, i) => ({ day: day(i), sessions: 10 + i }));
const slices = [{ channel: 'Direct', sessions: 30 }, { channel: 'Organic', sessions: 20 }, { channel: 'Referral', sessions: 10 }];
// AX106: a number field holding one string. A warning, so a strict chart throws.
const bad = single.map((r, i) => i === 4 ? { ...r, sessions: '14' } : r);

async function open(): Promise<Page> {
  const page = await openApp();
  await page.evaluate(([t, s, d, b]) => {
    window.app.setData('trend', t);
    window.app.setData('single', s);
    window.app.setData('slices', d);
    window.app.setData('bad', b);
  }, [trend, single, slices, bad] as const);
  return page;
}

const render = (page: Page, specs: Spec[], options: { strict?: boolean } = {}) =>
  page.evaluate(async ([s, o]) => { await window.app.render(s, o); await window.app.ready(); }, [specs, options] as const);

const named = (page: Page, name: string) => page.getByRole('group', { name, exact: true }).count();

const spyState = (page: Page) => page.evaluate(() => ({
  attempts: window.app.spy.attempts,
  charts: window.app.spy.charts.map(c => ({ kind: c.kind, destroyed: c.destroyed, updates: c.updates.map(p => Object.keys(p)) })),
}));

async function hoverAt(page: Page, fraction: number): Promise<void> {
  const box = await page.evaluate(() => {
    const r = document.querySelector('#chart .axylo-plot')!.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  });
  await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2, { steps: 4 });
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
      expect(await spyState(page)).toEqual({ attempts: 1, charts: [{ kind: type.toLowerCase(), destroyed: false, updates: [['title']] }] });
      expect(await named(page, `${type} two`)).toBe(1);
      expect(await named(page, `${type} one`)).toBe(0);

      await render(page, []);
      expect(await page.evaluate(() => document.getElementById('chart')!.innerHTML)).toBe('');
      expect((await spyState(page)).charts[0]!.destroyed).toBe(true);
      expect(await page.evaluate(() => window.app.chart(0))).toBeNull();
      expect(await closeApp(page)).toEqual([]);
    });
  }
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
    // StrictMode ran the create effect twice and its cleanup once.
    expect(state.attempts).toBe(2);
    expect(state.charts.map(c => c.destroyed)).toEqual([true, false]);
    expect(await page.evaluate(() => window.app.probe.observers)).toBeGreaterThan(before.observers);

    await render(page, [], { strict: true });
    expect(await page.evaluate(() => document.getElementById('chart')!.innerHTML)).toBe('');
    await page.evaluate(() => window.app.nextFrames(2));
    const callbacks = await page.evaluate(() => window.app.probe.resizeCallbacks);
    await page.evaluate(() => { document.getElementById('chart')!.style.width = '360px'; });
    await page.setViewportSize({ width: 500, height: 600 });
    await page.evaluate(() => window.app.nextFrames(4));
    const after = await page.evaluate(m => ({
      callbacks: window.app.probe.resizeCallbacks, observers: window.app.probe.observers,
      leaked: window.app.probe.leakedSince(m), frames: window.app.probe.pendingFrames,
    }), before.mark);
    expect(after).toEqual({ callbacks, observers: before.observers, leaked: [], frames: 0 });
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
    expect(await spyState(page)).toEqual({ attempts: 1, charts: [{ kind: 'line', destroyed: false, updates: [] }] });
    // The spy does see a real change.
    await render(page, [spec('Visits')]);
    expect((await spyState(page)).charts[0]!.updates).toEqual([['y']]);
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
    const sent = await page.evaluate(() => window.app.spy.charts[0]!.updates.map(p => [Object.keys(p), 'title' in p && p.title === undefined]));
    expect(sent).toEqual([[['title'], true]]);
    expect(await named(page, 'Sessions')).toBe(0);
    expect(await named(page, generated!)).toBe(2);
    expect(await page.evaluate(() => document.querySelector('#chart figure')!.hasAttribute('aria-labelledby'))).toBe(false);
    expect(await closeApp(page)).toEqual([]);
  });

  it('a removed tooltip={false} restores the tooltip', async () => {
    const page = await open();
    const props = { x: 'day', y: 'sessions', series: 'channel', title: 'Tips' };
    const shown = () => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#chart .axylo-tooltip, #chart .axylo-readout')].some(e => !e.hidden));
    await render(page, [{ type: 'Line', data: 'trend', hover: 'h', props: { ...props, tooltip: false } }]);
    await hoverAt(page, 0.3);
    expect((await page.evaluate(() => window.app.events.length))).toBeGreaterThan(0);
    expect(await shown()).toBe(false);

    await render(page, [{ type: 'Line', data: 'trend', hover: 'h', props }]);
    expect((await spyState(page)).charts[0]!.updates).toEqual([['tooltip']]);
    await hoverAt(page, 0.7);
    expect(await shown()).toBe(true);
    expect(await closeApp(page)).toEqual([]);
  });

  it('data with a new identity and the same content three renders in a row warns once', async () => {
    const page = await open();
    const warnings: string[] = [];
    page.on('console', m => { if (m.type() === 'warning' && m.text().includes('[axylo/react]')) warnings.push(m.text()); });
    const spec: Spec = { type: 'Line', data: 'copy', props: { x: 'day', y: 'sessions', title: 'Copies' } };
    const again = async () => {
      await page.evaluate(rows => window.app.setData('copy', rows), single);
      await render(page, [spec]);
    };
    await again();
    await again();
    await again();
    expect(warnings).toEqual([]);
    await again();
    await again();
    await again();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Memoize');
    // Identity is all that counts for the update itself.
    expect((await spyState(page)).charts[0]!.updates).toEqual(Array.from({ length: 5 }, () => ['data']));
    expect(await closeApp(page)).toEqual([]);
  });
});

describe('handlers', () => {
  it('the latest onHover is called and the chart is not recreated', async () => {
    const page = await open();
    const props = { x: 'day', y: 'sessions', series: 'channel', title: 'Handlers' };
    await render(page, [{ type: 'Line', data: 'trend', hover: 'first', props }]);
    await page.evaluate(() => { window.saved = document.querySelector('#chart figure'); });
    await hoverAt(page, 0.2);
    const firstCount = await page.evaluate(() => window.app.events.length);
    expect(firstCount).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.app.events.every(e => e[0] === 'first'))).toBe(true);

    await render(page, [{ type: 'Line', data: 'trend', hover: 'second', props }]);
    await hoverAt(page, 0.8);
    const later = await page.evaluate(n => window.app.events.slice(n).map(e => e[0]), firstCount);
    expect(later.length).toBeGreaterThan(0);
    expect(new Set(later)).toEqual(new Set(['second']));
    expect(await spyState(page)).toEqual({ attempts: 1, charts: [{ kind: 'line', destroyed: false, updates: [] }] });
    expect(await page.evaluate(() => document.querySelector('#chart figure') === window.saved)).toBe(true);
    expect(await closeApp(page)).toEqual([]);
  });
});

describe('ref', () => {
  it('ref.current.chart.append adds a point; a new data prop replaces the stream', async () => {
    const page = await open();
    const props = { x: 'day', y: 'sessions', title: 'Stream' };
    await render(page, [{ type: 'Line', data: 'single', props }]);
    const first = await page.evaluate(() => ({ s: window.app.chart(0)!.__bench.describe().series[0]!, diagnostics: Array.isArray(window.app.chart(0)!.diagnostics) }));
    expect(first.s.points).toBe(10);
    expect(first.diagnostics).toBe(true);

    await page.evaluate(async () => { window.app.chart(0)!.append([{ day: '2026-01-11', sessions: 21 }]); await window.app.ready(); });
    const appended = await page.evaluate(() => window.app.chart(0)!.__bench.describe().series[0]!);
    expect(appended.points).toBe(11);
    expect(appended.newestX).toBeGreaterThan(first.s.newestX);

    await page.evaluate(rows => window.app.setData('single again', rows), single);
    await render(page, [{ type: 'Line', data: 'single again', props }]);
    expect((await spyState(page)).charts[0]!.updates).toEqual([['data']]);
    const replaced = await page.evaluate(() => window.app.chart(0)!.__bench.describe().series[0]!);
    expect(replaced).toEqual(first.s);
    expect(await closeApp(page)).toEqual([]);
  });
});

describe('errors', () => {
  it('a strict chart with bad data is caught by an error boundary and recovers when given good data', async () => {
    const page = await open();
    const props = { x: 'day', y: 'sessions', title: 'Strict data', strict: true };
    const caught = () => page.evaluate(() => document.querySelector('#chart .caught')?.textContent ?? null);

    // Rejected at creation.
    await render(page, [{ type: 'Line', data: 'bad', props }]);
    expect(await caught()).toContain('AX106');
    expect(await page.locator('#chart figure').count()).toBe(0);
    expect(await spyState(page)).toEqual({ attempts: 1, charts: [] });

    await render(page, [{ type: 'Line', data: 'single', props }]);
    expect(await caught()).toBeNull();
    expect(await named(page, 'Strict data')).toBe(1);

    // Rejected by an update: the boundary takes over and the rejected chart is destroyed.
    await render(page, [{ type: 'Line', data: 'bad', props }]);
    expect(await caught()).toContain('AX106');
    expect(await page.locator('#chart figure').count()).toBe(0);

    await render(page, [{ type: 'Line', data: 'single', props }]);
    expect(await caught()).toBeNull();
    expect(await named(page, 'Strict data')).toBe(1);
    expect(await spyState(page)).toEqual({
      attempts: 3,
      charts: [{ kind: 'line', destroyed: true, updates: [['data']] }, { kind: 'line', destroyed: false, updates: [] }],
    });
    expect(await closeApp(page)).toEqual([]);
  });
});

describe('independence', () => {
  it('two charts in one tree are independent', async () => {
    const page = await open();
    const a = { x: 'day', y: 'sessions', series: 'channel' };
    const b = { x: 'day', y: 'sessions', series: 'channel', layout: 'stacked' };
    await render(page, [{ type: 'Line', data: 'trend', props: { ...a, title: 'A' } }, { type: 'Bar', data: 'trend', props: { ...b, title: 'B' } }]);
    expect(await page.evaluate(() => window.app.spy.charts[0]!.element !== window.app.spy.charts[1]!.element)).toBe(true);

    await render(page, [{ type: 'Line', data: 'trend', props: { ...a, title: 'A2' } }, { type: 'Bar', data: 'trend', props: { ...b, title: 'B' } }]);
    expect((await spyState(page)).charts.map(c => c.updates)).toEqual([[['title']], []]);
    expect([await named(page, 'A2'), await named(page, 'B')]).toEqual([1, 1]);

    await render(page, [{ type: 'Line', data: 'trend', props: { ...a, title: 'A2' } }]);
    expect((await spyState(page)).charts.map(c => c.destroyed)).toEqual([false, true]);
    expect(await page.locator('#chart figure').count()).toBe(1);
    expect(await named(page, 'A2')).toBe(1);
    await render(page, [{ type: 'Line', data: 'trend', props: { ...a, title: 'A3' } }]);
    expect(await named(page, 'A3')).toBe(1);
    expect(await closeApp(page)).toEqual([]);
  });
});

describe('hydration', () => {
  async function hydrate(markup: string): Promise<{ errors: string[]; recoverable: string[]; figures: number; page: Page }> {
    const page = await openApp();
    const errors: string[] = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.evaluate(m => { document.getElementById('chart')!.innerHTML = m; }, markup);
    await page.evaluate(() => window.app.hydrate());
    await page.waitForFunction(() => document.querySelectorAll('#chart figure').length === 2);
    return { errors, recoverable: await page.evaluate(() => window.app.hydrationErrors), figures: 2, page };
  }

  it('server-rendered markup hydrates without a mismatch warning', async () => {
    const markup = renderToString(hydrationTree());
    expect(markup).toContain('<div class="axylo card" style="height:260px"></div>');
    const { errors, recoverable, page } = await hydrate(markup);
    expect(errors).toEqual([]);
    expect(recoverable).toEqual([]);
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
