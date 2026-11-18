/**
 * A6 (reflow and text spacing, Chrome only), A7 (data arriving does not speak), A8 (axe-core in every
 * state) and A10 (replaceable built-in text, `lang="en"` on a page in another language). Spec 3.4.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { start, stop } from '../harness';
import { axe } from '../a11y/util';
import { axOf, axWithin, box, call, closePage, create, createRaw, devPage, readRange, ring, settle, shapes, center, valueText } from './util';
import type { Messages } from '../../../src/public';
import { overlaps, textBoxes } from './text';
import { FULL, TYPES, type ChartType } from './fixtures';

beforeAll(start);
afterAll(stop);

type Full = Exclude<ChartType, 'compact'>;

/** WCAG 1.4.12's text-spacing overrides, as a user style sheet would apply them. */
const TEXT_SPACING = '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }';

/** Text-bearing elements of the chart that are rendered, and whether each is clipped or outside the figure. */
async function clippedText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const fig = document.querySelector('#chart figure')!.getBoundingClientRect();
    const out: string[] = [];
    const walker = document.createTreeWalker(document.querySelector('#chart')!, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement!;
      if (!n.textContent?.trim() || el.closest('[hidden], .axylo-visually-hidden, .axylo-tooltip, .axylo-readout')) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      // Clipped by an ancestor that hides overflow: the text's box reaches outside that ancestor's box.
      for (let a: HTMLElement | null = el; a && a !== document.body; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
          const b = a.getBoundingClientRect();
          if (r.left < b.left - 1 || r.right > b.right + 1 || r.top < b.top - 1 || r.bottom > b.bottom + 1) { out.push(`clipped: ${n.textContent}`); break; }
        }
      }
      if (r.left < fig.left - 1 || r.right > fig.right + 1 || r.top < fig.top - 1 || r.bottom > fig.bottom + 1) out.push(`outside the figure: ${n.textContent}`);
    }
    return out;
  });
}

describe('A6 reflow and text spacing (Chrome only)', () => {
  for (const type of FULL as Full[]) {
    it(`A6 ${type}: at 400 % zoom of a 1280 × 1024 window (320 × 256 CSS px at device pixel ratio 4) the page does not scroll horizontally and no chart text is clipped, ellipsised or overlapping (Chrome)`, async () => {
      const page = await devPage({ viewport: { width: 320, height: 256 }, deviceScaleFactor: 4, css: 'body { margin: 0; } #chart { width: auto; height: auto; }' });
      await create(page, type);
      const scroll = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(scroll.width).toBeLessThanOrEqual(scroll.client);
      expect(await clippedText(page)).toEqual([]);
      const boxes = await textBoxes(page);
      expect(boxes.filter(b => b.seen !== 'whole').map(b => `${b.seen}: ${b.text}`)).toEqual([]);
      expect(overlaps(boxes.filter(b => b.w > 0))).toEqual([]);
      expect(await closePage(page)).toEqual([]);
    });

    it(`A6 ${type}: with the WCAG 1.4.12 text-spacing overrides no chart text is clipped or pushed outside the figure (Chrome)`, async () => {
      const page = await devPage({ css: TEXT_SPACING });
      await create(page, type);
      await settle(page);
      expect(await clippedText(page)).toEqual([]);
      expect(await closePage(page)).toEqual([]);
    });
  }
});

// ── A7 ────────────────────────────────────────────────────────────────────────────────────────────

/** One more x for each type, numbered k; a sliding window keeps 5 x values (4 slices on the donut). */
function streamRow(type: Full, k: number): unknown[] {
  const day = new Date(Date.UTC(2026, 2, 7) + k * 864e5).toISOString().slice(0, 10);
  switch (type) {
    case 'line':
    case 'area': return [{ day, site: 'North', energy: 10 + (k % 5) }, { day, site: 'South', energy: 5 + (k % 3) }];
    case 'bar': return [{ quarter: `P${k}`, kind: 'Plan', shipped: 40 + k }, { quarter: `P${k}`, kind: 'Actual', shipped: 39 + k }];
    case 'scatter': return [{ size: 40 + k, latency: 100 + k, region: 'EU' }];
    case 'donut': return [{ item: `Item ${k}`, spend: 100 + k }];
  }
}

/** Counts text changes of every live region in the page (aria-live other than off, role status or alert). */
async function watchLive(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { liveChanges: string[] };
    w.liveChanges = [];
    const live = (el: Element | null): Element | null => {
      for (let e = el; e; e = e.parentElement) {
        const v = e.getAttribute('aria-live');
        if (v === 'off') return null;
        if (v === 'polite' || v === 'assertive' || e.getAttribute('role') === 'alert' || (e.getAttribute('role') === 'status' && v === null)) return e;
      }
      return null;
    };
    const isLive = (e: Element) => { const v = e.getAttribute('aria-live'); const r = e.getAttribute('role'); return (v !== null && v !== 'off') || r === 'alert' || ((r === 'status' || r === 'log') && v !== 'off'); };
    new MutationObserver(records => {
      for (const r of records) {
        // Text changing inside a live region.
        const target = r.target.nodeType === Node.TEXT_NODE ? r.target.parentElement : r.target as Element;
        const region = live(target);
        if (region && (region.textContent ?? '').trim()) w.liveChanges.push(region.textContent ?? '');
        // A live region (or an element holding one) inserted already populated, wherever its parent is.
        for (const n of r.addedNodes) {
          if (!(n instanceof Element)) continue;
          for (const e of [n, ...n.querySelectorAll('*')]) if (isLive(e) && (e.textContent ?? '').trim()) w.liveChanges.push(`inserted: ${e.textContent}`);
        }
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-live', 'role'] });
  });
}

describe('A7 data arriving does not speak', () => {
  for (const type of FULL as Full[]) {
    it(`A7 ${type}: 24 charts appending ten times each change no live region, with no chart focused`, async () => {
      const page = await devPage({ css: '.tile { width: 340px; height: 200px; }' });
      await page.evaluate(() => {
        for (let i = 0; i < 24; i++) {
          const el = document.createElement('div');
          el.id = `tile-${i}`;
          el.className = 'tile';
          document.body.appendChild(el);
        }
      });
      for (let i = 0; i < 24; i++) await create(page, type, {}, `#tile-${i}`);
      await watchLive(page);
      for (let k = 0; k < 10; k++) {
        await page.evaluate(({ rows }) => {
          for (const c of (window as unknown as { charts: { append(r: unknown[], o: unknown): void }[] }).charts) c.append(rows, { keep: 5 });
        }, { rows: streamRow(type, k) });
        await settle(page);
      }
      expect(await page.evaluate(() => (window as unknown as { liveChanges: string[] }).liveChanges)).toEqual([]);
      expect(await closePage(page)).toEqual([]);
    });

    it(`A7 ${type}: with the plot focused, a sliding window keeps focus on its datum: the value text is not rewritten while the datum stays (decision 0004), the numeric position follows it, eviction moves focus to the next datum once, and the next key reads the current count`, async () => {
      const page = await devPage();
      await create(page, type);
      await page.focus('#before');
      await page.keyboard.press('Tab');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      const before = await readRange(page);
      expect(before.focused && before.role === 'slider').toBe(true);
      expect(before.value).toBe(2);
      // The datum the reader is on, in its own words (series names, x, values), and the window size.
      const own = (t: string) => t.replace(/\.?\s*Point \d+ of \d+\.?$/, '').replace(/\s*\([^)]*%\)/, '');
      const size = before.max + 1;
      await watchLive(page);
      const keep = { line: 5, area: 5, bar: 4, scatter: 5, donut: 4 }[type];
      // Two appends: the first two x values leave, the reader's datum stays, now at position 0.
      for (let k = 0; k < 2; k++) await call(page, 'append', [streamRow(type, k), { keep }]);
      const during = await readRange(page);
      expect(during.focused).toBe(true);
      expect(during.role).toBe('slider');
      if (type === 'donut') expect(own(during.text)).toBe(own(before.text));
      else expect(during.text, 'not rewritten for an unchanged datum').toBe(before.text);
      expect(during.value, 'the numeric position follows the datum').toBe(0);
      expect(during.max + 1).toBe(size);
      // A third append evicts it: the text is rewritten once and names the datum focus went to.
      await call(page, 'append', [streamRow(type, 2), { keep }]);
      const after = await readRange(page);
      expect(after.focused).toBe(true);
      expect(own(after.text)).not.toBe(own(before.text));
      // Where focus went is the lookup's rule; its text and its numeric position agree.
      expect(after.text).toMatch(new RegExp(`\\b${after.value + 1} of ${after.max + 1}\\b`));
      const evicted = after.text;
      await call(page, 'append', [[], { keep }]);
      expect((await readRange(page)).text).toBe(evicted);
      // The next key lands on the neighbour and reads the current count.
      await page.keyboard.press('ArrowRight');
      const next = await readRange(page);
      expect(next.value).toBe(after.value + 1);
      expect(next.text).toMatch(new RegExp(`\\b${after.value + 2} of ${next.max + 1}\\b`));
      expect(await page.evaluate(() => (window as unknown as { liveChanges: string[] }).liveChanges)).toEqual([]);
      expect(await closePage(page)).toEqual([]);
    });
  }
});

// ── A8 ────────────────────────────────────────────────────────────────────────────────────────────

type Kind = ChartType | 'compact area' | 'compact bar';
interface State { name: string; enter(page: Page): Promise<void>; holds(page: Page): Promise<boolean> }

const button = (page: Page, label: string) => page.locator('#chart [role="toolbar"] button', { hasText: label });
const visible = async (page: Page, sel: string) => (await page.locator(sel).count()) > 0 && page.locator(sel).first().isVisible();

/** A place on a datum of the fixture, to point at: a scatter point, a donut slice, the middle of an aligned plot. */
async function onDatum(page: Page, type: Kind): Promise<{ x: number; y: number }> {
  if (type === 'donut') { const g = await ring(page); return { x: g.cx + 0.85 * g.outer, y: g.cy }; }
  if (type === 'scatter') return center((await shapes(page, '#chart', 14))[1]![1]!.box);
  const p = await box(page, '#chart .axylo-proxy');
  return { x: p.x + p.width / 2, y: p.y + p.height / 2 };
}

/** Every state a reader can bring a chart of `type` into, each with a check that it was really entered. */
function states(type: Kind): State[] {
  const compact = type === 'compact' || type === 'compact area' || type === 'compact bar';
  const list: State[] = [{ name: 'default', enter: async () => {}, holds: async page => visible(page, '#chart figure') }];
  if (!compact) {
    list.push({ name: 'keyboard focus with tooltip', enter: async page => { await page.focus('#before'); await page.keyboard.press('Tab'); await page.keyboard.press('ArrowRight'); }, holds: async page => (await readRange(page)).focused && visible(page, '#chart .axylo-tooltip') });
    list.push({ name: 'pointer tooltip', enter: async page => { const p = await onDatum(page, type); await page.mouse.move(p.x, p.y); await settle(page); }, holds: async page => (await visible(page, '#chart .axylo-tooltip')) || visible(page, '#chart .axylo-readout') });
    list.push({ name: 'table open', enter: async page => { await button(page, 'View as table').click(); await settle(page); }, holds: async page => visible(page, '#chart table') });
    list.push({ name: 'streaming, paused', enter: async page => { await call(page, 'append', [streamRow(type as Full, 0)]); await button(page, 'Pause').click(); await settle(page); }, holds: async page => (await button(page, 'Resume').count()) === 1 });
  }
  if (type === 'line' || type === 'area' || type === 'scatter') {
    list.push({ name: 'zoomed', enter: async page => call(page, 'zoom', [type === 'scatter' ? [12, 30] : ['2026-03-03', '2026-03-05']]), holds: async page => (await button(page, 'Reset zoom').count()) === 1 });
  }
  if (type === 'line' || type === 'area' || type === 'bar' || type === 'scatter') {
    list.push({ name: 'a series hidden', enter: async page => { await page.locator('#chart .axylo-legend-entry').first().click(); await settle(page); }, holds: async page => (await page.locator('#chart .axylo-legend-entry').first().getAttribute('aria-pressed')) === 'false' });
  }
  list.push({ name: 'loading', enter: async page => call(page, 'update', [{ state: 'loading' }]), holds: async page => visible(page, '#chart .axylo-message') });
  list.push({ name: 'empty', enter: async page => call(page, 'update', [{ data: [] }]), holds: async page => visible(page, '#chart .axylo-message') });
  list.push({ name: 'error', enter: async page => call(page, 'update', [{ state: { error: 'The query failed.' } }]), holds: async page => visible(page, '#chart .axylo-message') });
  return list;
}

/** A page with landmarks and a page heading, so a scan of the whole document judges the chart, not the test page. */
async function landmarkPage(): Promise<Page> {
  const page = await devPage();
  await page.evaluate(() => {
    const main = document.createElement('main');
    const h1 = document.createElement('h1');
    h1.textContent = 'Dashboard';
    // The chart's default heading is level 3, so the page gives it a level-2 section to sit in.
    const h2 = document.createElement('h2');
    h2.textContent = 'Energy';
    main.append(h1, h2, document.querySelector('#before')!, document.querySelector('#chart')!, document.querySelector('#after')!);
    document.body.appendChild(main);
  });
  return page;
}

async function make(page: Page, type: Kind, variant: 'default' | 'dirty' = 'default'): Promise<void> {
  if (type === 'compact area' || type === 'compact bar') {
    const fn = type === 'compact area' ? 'area' : 'bar';
    await createRaw(page, fn, { compact: true, title: 'Compact', data: variant === 'dirty' ? [{ d: 'a', v: 1 }, { d: 'b', v: '__NaN__' }, { d: 'c', v: 3 }] : [{ d: 'a', v: 1 }, { d: 'b', v: 2 }, { d: 'c', v: 3 }], x: 'd', y: 'v' });
  } else await create(page, type, {}, '#chart', variant);
}

describe('A8 axe-core', () => {
  for (const type of [...TYPES, 'compact area', 'compact bar'] as Kind[]) {
    it(`A8 ${type.startsWith('compact') ? 'compact' : type}: axe-core reports no violations on the whole landmarked page in every state (${type}: ${states(type).map(s => s.name).join(', ')}, and with values left out), each state checked to hold before the scan`, async () => {
      const failures: string[] = [];
      const cases: [string, 'default' | 'dirty', State][] = [...states(type).map(s => [s.name, 'default', s] as [string, 'default', State]), ['values left out', 'dirty', states(type)[0]!]];
      for (const [name, variant, state] of cases) {
        const page = await landmarkPage();
        await make(page, type, variant);
        await state.enter(page);
        if (!(await state.holds(page))) failures.push(`${name}: the state was not entered`);
        const result = await axe(page, 'body');
        for (const v of result.violations) failures.push(`${name}: ${v.id} (${v.nodes.join(', ')})`);
        // heading-order decided (passed or failed, not left incomplete) wherever the chart has a heading.
        if (!type.startsWith('compact') && !result.ran.includes('heading-order')) failures.push(`${name}: heading-order did not complete`);
        await closePage(page);
      }
      expect(failures).toEqual([]);
    });
  }

  for (const type of FULL as Full[]) {
    it(`A8 ${type}: with a 250-row table open, its scroll region scrolls and axe-core decides scrollable-region-focusable with no violation`, async () => {
      const page = await landmarkPage();
      const day = (k: number) => new Date(Date.UTC(2026, 0, 1) + k * 864e5).toISOString().slice(0, 10);
      const long: Record<Full, [string, Record<string, unknown>]> = {
        line: ['line', { title: 'Long', data: Array.from({ length: 250 }, (_, k) => ({ d: day(k), v: k })), x: { field: 'd', type: 'date' }, y: 'v' }],
        area: ['area', { title: 'Long', data: Array.from({ length: 250 }, (_, k) => ({ d: day(k), v: k })), x: { field: 'd', type: 'date' }, y: 'v' }],
        bar: ['bar', { title: 'Long', data: Array.from({ length: 250 }, (_, k) => ({ d: `c${k}`, v: k + 1 })), x: 'd', y: 'v' }],
        scatter: ['scatter', { title: 'Long', data: Array.from({ length: 250 }, (_, k) => ({ x: k, y: k % 7 })), x: 'x', y: 'y' }],
        donut: ['donut', { title: 'Long', data: Array.from({ length: 250 }, (_, k) => ({ l: `c${k}`, v: k + 1 })), label: 'l', value: 'v' }],
      };
      await createRaw(page, long[type][0], long[type][1]);
      await button(page, 'View as table').click();
      await settle(page);
      expect(await page.locator('#chart .axylo-table-scroll').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
      const result = await axe(page, 'body');
      expect(result.violations.map(v => `${v.id} (${v.nodes.join(', ')})`)).toEqual([]);
      expect(result.ran).toContain('scrollable-region-focusable');
      expect(await closePage(page)).toEqual([]);
    });
  }
});

// ── A10 ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * Every key of the public `Messages` (src/public.ts). Typed as a record over its keys, so a key added to the
 * contract and missing here does not compile. Each entry names the chart types whose reader surfaces show
 * that string in the scenarios below, or says why none does.
 */
const WHERE: Record<keyof Messages, readonly ChartType[] | string> = {
  viewAsTable: ['line', 'area', 'bar', 'scatter', 'donut'], hideTable: ['line', 'area', 'bar', 'scatter', 'donut'],
  noData: ['line', 'area', 'bar', 'scatter', 'donut'], noObservation: ['line', 'area', 'bar'], incompleteStack: ['area', 'bar'],
  moreRows: ['line', 'area', 'bar', 'scatter'], otherSlices: ['donut'], valuesNotShown: ['line', 'area', 'bar', 'scatter', 'donut', 'compact'],
  valuesChanged: ['donut'], labelsHidden: 'only when labels do not fit after every remedy; not reached by these fixtures',
  loading: ['line', 'area', 'bar', 'scatter', 'donut', 'compact'], empty: ['line', 'area', 'bar', 'scatter', 'donut', 'compact'],
  error: ['line', 'area', 'bar', 'scatter', 'donut', 'compact'], internalError: ['line', 'area', 'bar', 'scatter', 'donut', 'compact'],
  chartName: ['line', 'area', 'bar', 'scatter', 'donut', 'compact'], chartSummary: ['line', 'area', 'bar', 'scatter', 'compact'],
  seriesSummary: ['line', 'area', 'bar', 'scatter', 'compact'], referenceSummary: 'deprecated; no surface uses it (src/messages/index.ts)',
  timeZoneNote: ['line', 'area', 'bar', 'scatter', 'compact'], plotLabel: ['line', 'area', 'bar', 'scatter', 'donut'],
  controlsLabel: ['line', 'area', 'bar', 'scatter', 'donut'], pointOf: ['line', 'area', 'bar', 'scatter'],
  zoomIn: ['line', 'area', 'scatter'], zoomOut: ['line', 'area', 'scatter'], resetZoom: ['line', 'area', 'scatter'],
  pause: ['line', 'area', 'bar', 'scatter', 'donut'], resume: ['line', 'area', 'bar', 'scatter', 'donut'],
  previousPage: ['line', 'area', 'bar', 'scatter', 'donut'], nextPage: ['line', 'area', 'bar', 'scatter', 'donut'], pageOf: ['line', 'area', 'bar', 'scatter', 'donut'],
  jumpToX: ['line', 'area', 'bar', 'scatter', 'donut'], showSeries: 'no surface uses it (src has no caller)', hideSeries: 'no surface uses it (src has no caller)',
  category: ['donut'], percentage: ['donut'], series: ['scatter'], value: 'used only when a value field has no label; every scenario labels or names it',
  typeLine: ['line', 'compact'], typeArea: ['area'], typeBar: ['bar'], typeScatter: ['scatter'], typeDonut: ['donut'],
  donutSummary: ['donut'], seriesNoData: ['line', 'area', 'bar', 'scatter'], seriesNotDrawn: ['line', 'area', 'bar'],
  referenceLine: ['line', 'area', 'bar', 'scatter'], referenceBand: ['line', 'area', 'bar', 'scatter'],
  plotRole: ['line', 'area', 'bar', 'scatter', 'donut'], pointAll: ['line', 'area', 'bar'], seriesValue: ['line', 'area', 'bar'],
  position: ['line', 'area', 'bar', 'donut'], total: ['area', 'bar'], panLeft: ['line', 'area', 'scatter'], panRight: ['line', 'area', 'scatter'],
  // Added to the contract in 93666f4 and not yet used by the library (pending on the core's implementation).
  totalMixed: ['area', 'bar'], incompleteAt: ['area', 'bar'], incompleteCount: ['area', 'bar'],
  jumpNotFound: ['line', 'area', 'bar', 'scatter', 'donut'], plotInstructions: ['line', 'area', 'bar', 'scatter', 'donut'], seeTable: ['line', 'area', 'bar', 'scatter', 'donut'],
};
const KEYS = Object.keys(WHERE) as (keyof Messages)[];
/** Each key's own sentinel, with every placeholder the templates use, so filled templates stay recognisable. */
const sentinel = (k: keyof Messages) => `[${k}]`;
const MESSAGES = Object.fromEntries(KEYS.map(k => [k, `${sentinel(k)} {count}{seeTable}{type}{x}{y}{series}{value}{index}{label}{from}{to}{zone}{min}{max}{last}{total}{xLabel}{xMin}{xMax}{yLabel}{yMin}{yMax}{seriesCount}{values}{position}{percent}{example}{page}{positive}{negative}{at}`])) as Record<keyof Messages, string>;

/** Everything the reader gets from the chart now: AX names, descriptions, roles, static text, the value text (DOM attribute), visible text and title attributes. */
async function surfaces(page: Page): Promise<string> {
  const parts: string[] = [];
  for (const n of await axWithin(page, '#chart')) parts.push(n.name, n.description, String(n.props.roledescription ?? ''));
  parts.push(await page.evaluate(() => [...document.querySelectorAll('#chart *')].map(e => `${e.getAttribute('aria-valuetext') ?? ''} ${e.getAttribute('title') ?? ''}`).join(' ')));
  parts.push(await page.locator('#chart').innerText());
  return parts.join(' | ');
}

/** Scenarios that between them bring every applicable built-in string of `type` onto a reader surface. */
async function exercise(page: Page, type: ChartType): Promise<string> {
  const seen: string[] = [];
  const fresh = async (fn: string, options: Record<string, unknown>) => {
    await page.evaluate(() => { for (const c of (window as unknown as { charts: { destroy(): void }[] }).charts.splice(0)) c.destroy(); });
    await createRaw(page, fn, { ...options, messages: MESSAGES });
  };
  const take = async () => { seen.push(await surfaces(page)); };
  const aligned = type === 'line' || type === 'area' || type === 'bar';
  const fn = type === 'compact' ? 'line' : type;
  const compact = type === 'compact' ? { compact: true } : {};
  const DAY = 864e5, T0 = Date.UTC(2026, 2, 2);
  // 1. Instants with a null, a series with no row at one x, a series with no data, a duplicate x in a series, references; no title.
  if (type === 'donut') {
    await fresh('donut', { data: [{ l: 'A', v: 30 }, { l: 'B', v: null }, { l: 'C', v: '__NaN__' }, ...Array.from({ length: 8 }, (_, i) => ({ l: `S${i}`, v: 10 - i }))], label: 'l', value: 'v' });
  } else if (type === 'scatter') {
    await fresh('scatter', { data: [{ x: T0, y: 1, s: 'A' }, { x: T0 + DAY, y: null, s: 'A' }, { x: T0 + 2 * DAY, y: '__NaN__', s: 'A' }, { x: T0, y: 2, s: 'Z' }, { x: T0, y: null, s: 'E' }], x: { field: 'x', type: 'time', timeZone: 'UTC' }, y: 'y', series: 's', reference: [{ y: 1.5, label: 'Mid' }, { y: [0.5, 0.8], label: 'Low' }] });
  } else {
    const rows = [
      { x: T0, s: 'A', y: 1 }, { x: T0 + DAY, s: 'A', y: null }, { x: T0 + 2 * DAY, s: 'A', y: 3 }, { x: T0 + 3 * DAY, s: 'A', y: '__NaN__' },
      { x: T0, s: 'B', y: 2 }, { x: T0 + 2 * DAY, s: 'B', y: 4 }, { x: T0 + 3 * DAY, s: 'B', y: 5 },
      { x: T0, s: 'E', y: null }, { x: T0, s: 'D', y: 1 }, { x: T0, s: 'D', y: 2 },
      // A negative component, so a stacked readout has a positive and a negative total (totalMixed).
      { x: T0 + 2 * DAY, s: 'C', y: -2 },
    ];
    await fresh(fn, { data: type === 'compact' ? rows.filter(r => r.s === 'A') : rows, x: { field: 'x', type: 'time', timeZone: 'UTC' }, y: 'y', ...(type === 'compact' ? {} : { series: 's' }), ...compact, ...(type === 'compact' ? {} : { reference: [{ y: 1.5, label: 'Mid' }, { x: [T0 + DAY, T0 + 2 * DAY], label: 'Window' }] }), ...((type === 'area' || type === 'bar') ? (type === 'area' ? { stacked: true } : { layout: 'stacked' }) : {}) });
  }
  await take();
  if (type !== 'compact') {
    // 2. Keyboard over the null and the missing row, tooltip on them, the table with a failed jump.
    await page.focus('#chart .axylo-proxy');
    for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowRight'); await take(); }
    await page.keyboard.press('ArrowDown');
    await take();
    const p = await box(page, '#chart .axylo-proxy');
    for (const f of [0.02, 0.35, 0.65, 0.98]) { await page.mouse.move(p.x + f * p.width, p.y + p.height / 2); await settle(page); await take(); }
    // Off the plot first: whether the readout may cover a control is I1's question (i1-pointer), not this one's.
    await page.mouse.move(0, 0);
    await page.focus('#before');
    await settle(page);
    await page.locator('#chart [role="toolbar"] button').last().click();
    await settle(page);
    await take();
    // 3. Paging (250 rows), zoom and pan, streaming and pause, more than eight rows in a tooltip.
    const many = type === 'donut' ? { data: Array.from({ length: 250 }, (_, k) => ({ l: `c${k}`, v: k + 1 })), label: 'l', value: 'v' }
      : type === 'scatter' ? { data: [...Array.from({ length: 250 }, (_, k) => ({ x: k, y: k % 7, s: 'S0' })), ...Array.from({ length: 10 }, (_, k) => ({ x: 100, y: 3, s: `S${k + 1}` }))], x: 'x', y: 'y', series: 's' }
        : { data: Array.from({ length: 250 }, (_, k) => Array.from({ length: 10 }, (_, s) => ({ x: type === 'bar' ? `c${k}` : k, s: `S${s}`, y: k + s }))).flat(), x: 'x', y: 'y', series: 's' };
    await fresh(fn, { title: 'Many', ...many });
    await page.locator('#chart [role="toolbar"] button').last().click();
    await settle(page);
    await page.locator('#chart .axylo-pager button').last().click();
    await settle(page);
    await take();
    await page.locator('#chart .axylo-jump-field').click();
    await page.keyboard.type('no such value');
    await page.keyboard.press('Enter');
    await settle(page);
    await take();
    // Close the table again, so the plot is back under the pointer.
    await page.locator('#chart [role="toolbar"] button').last().click();
    await settle(page);
    if (type === 'line' || type === 'area' || type === 'scatter') {
      await page.mouse.move(0, 0);
      for (const k of ['zoomIn', 'panLeft'] as const) {
        const b = page.locator('#chart [role="toolbar"] button', { hasText: sentinel(k) });
        if (await b.count() !== 1) throw new Error(`no ${k} control`);
        await b.click({ timeout: 10000 });
        await settle(page);
      }
      await take();
    }
    const q = await box(page, '#chart .axylo-proxy');
    // More than eight rows: the coincident scatter points (series S1…S10 at one place), or ten series at one x.
    const at = type === 'scatter' ? center((await shapes(page, '#chart', 14))[2]![0]!.box) : { x: q.x + q.width * 0.4, y: q.y + q.height / 2 };
    await page.mouse.move(at.x, at.y);
    await settle(page);
    await take();
    await call(page, 'append', [type === 'donut' ? [{ l: 'new', v: 3 }] : type === 'scatter' ? [{ x: 300, y: 1, s: 'S0' }] : [{ x: type === 'bar' ? 'new' : 300, s: 'S0', y: 1 }]]);
    await take();
    await page.mouse.move(0, 0);
    await settle(page);
    await page.locator('#chart [role="toolbar"] button', { hasText: sentinel('pause') }).click();
    await settle(page);
    await take();
  }
  // 4. States: loading, empty, author error, internal failure.
  for (const state of ['loading', 'empty', 'error'] as const) {
    await call(page, 'update', [state === 'loading' ? { state: 'loading' } : state === 'empty' ? { state: 'ready', data: [] } : { state: { error: 'Query failed' } }]);
    await take();
  }
  // A chart error of Axylo's own (AX101: the value field is not in the rows) shows the built-in error text.
  await call(page, 'update', [type === 'donut' ? { state: 'ready', data: [{ l: 'A', v: 1 }], value: 'nosuch' } : { state: 'ready', data: [{ x: 1, y: 1 }], x: 'x', y: 'nosuch' }]);
  await take();
  await call(page, 'update', [type === 'donut' ? { data: [{ l: 'A', v: 1 }], value: 'v' } : { data: [{ x: 1, y: 1 }], x: 'x', y: 'y' }]);
  await page.evaluate(() => (window as unknown as { charts: { __dev: { fail(s: string | null): void } }[] }).charts[0]!.__dev.fail('reader'));
  await call(page, 'update', [{ title: 'Again' }]);
  await take();
  void aligned;
  return seen.join(' || ');
}

describe('A10 built-in text', () => {
  for (const type of TYPES) {
    it(`A10 ${type}: every built-in string that a ${type} chart shows is replaced through messages: each applicable key's own sentinel reaches a reader surface, and no built-in English is left`, async () => {
      const page = await devPage({ css: '#chart { height: 480px; }' });
      const text = await exercise(page, type);
      const missing = KEYS.filter(k => Array.isArray(WHERE[k]) && (WHERE[k] as readonly ChartType[]).includes(type) && !text.includes(sentinel(k)));
      expect(missing, 'keys whose replacement never reached a surface').toEqual([]);
      // Sentinels are taken out first: "[moreRows]" must not count as the English word.
      const plain = text.replace(/\[[A-Za-z]+\]/g, '');
      const ENGLISH = ['View as table', 'Hide table', 'Chart plot', 'Chart controls', 'Zoom in', 'Zoom out', 'Reset zoom', 'No data', 'No observation', 'not shown', 'shown differently', 'Previous page', 'Next page', 'Jump to', 'Percentage', 'minimum', 'maximum', 'Point ', ' chart with', 'Pause', 'Resume', 'Times are shown', 'See table', 'Loading chart', 'No data to show', 'could not be drawn', 'went wrong', 'Pan left', 'Pan right', 'Arrow keys', 'Reference line', 'Reference band', 'Total', 'incomplete'];
      expect([...ENGLISH.filter(e => plain.includes(e)), ...(/\+\d+ more/.test(plain) ? ['+N more'] : [])], 'built-in English still shown').toEqual([]);
      expect(await closePage(page)).toEqual([]);
    });

    it(`A10 ${type}: on a lang="de" page the built-in English is marked lang="en" where the reader meets it: the description the figure references, the visible summary, the note, the controls, the plot's name and role; the author's title is not`, async () => {
      const page = await devPage();
      await page.evaluate(() => document.documentElement.setAttribute('lang', 'de'));
      await create(page, type, { title: 'Energieverbrauch' }, '#chart', 'dirty');
      if (type !== 'compact') {
        await page.focus('#chart .axylo-proxy');
        await page.locator('#chart [role="toolbar"] button', { hasText: 'View as table' }).click();
        await settle(page);
      }
      const wrong = await page.evaluate(() => {
        const out: string[] = [];
        const langOf = (el: Element) => el.closest('[lang]')?.getAttribute('lang') ?? '';
        const fig = document.querySelector('#chart figure')!;
        // The element the figure's accessible description comes from, whatever its class.
        const described = (fig.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean).map(id => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
        if (!described.length) out.push('the figure references no description');
        const builtIn = [
          ...described, ...document.querySelectorAll('#chart .axylo-summary, #chart .axylo-note:not([hidden]), #chart .axylo-pager button, #chart .axylo-page'),
          ...document.querySelectorAll('#chart [role="toolbar"] button:not(.axylo-legend-entry)'), ...document.querySelectorAll('#chart .axylo-proxy'),
        ];
        for (const el of builtIn) if (langOf(el) !== 'en') out.push(`not marked en: ${el.className || el.id} "${(el.textContent || el.getAttribute('aria-label') || '').slice(0, 40)}"`);
        const title = document.querySelector('#chart .axylo-title:not([hidden])');
        if (title && langOf(title) === 'en') out.push('author title marked en');
        return out;
      });
      expect(wrong).toEqual([]);
      if (type !== 'compact') expect((await axOf(page, '#chart figure')).description).not.toBe('');
      expect(await closePage(page)).toEqual([]);
    });
  }
});
