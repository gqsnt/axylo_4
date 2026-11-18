/**
 * A6 (reflow and text spacing, Chrome only), A7 (data arriving does not speak), A8 (axe-core in every
 * state) and A10 (replaceable built-in text, `lang="en"` on a page in another language). Spec 3.4.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { start, stop } from '../harness';
import { axe } from '../a11y/util';
import { axWithin, box, call, closePage, create, devPage, settle, valueText } from './util';
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
    it(`A6 ${type}: at 320 CSS px wide (400 % of 1280) the page does not scroll horizontally and no chart text is clipped (Chrome)`, async () => {
      const page = await devPage({ viewport: { width: 320, height: 640 }, css: 'body { margin: 0; } #chart { width: auto; height: auto; }' });
      await create(page, type);
      const scroll = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(scroll.width).toBeLessThanOrEqual(scroll.client);
      expect(await clippedText(page)).toEqual([]);
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
    new MutationObserver(records => {
      for (const r of records) {
        const target = r.target.nodeType === Node.TEXT_NODE ? r.target.parentElement : r.target as Element;
        const region = live(target);
        if (region && (region.textContent ?? '').trim()) w.liveChanges.push(region.textContent ?? '');
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
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

    it(`A7 ${type}: with the plot focused, appends change no live region and focus stays on its datum while it is in the window`, async () => {
      const page = await devPage();
      await create(page, type);
      await page.focus('#chart .axylo-proxy');
      await page.keyboard.press('End');
      const text = await valueText(page);
      await watchLive(page);
      // Growing, not sliding: the datum stays in the window.
      for (let k = 0; k < 3; k++) await call(page, 'append', [streamRow(type, k)]);
      const after = await valueText(page);
      expect(await page.evaluate(() => (window as unknown as { liveChanges: string[] }).liveChanges)).toEqual([]);
      // The same datum: its own words (everything before the position; on a donut also before the share,
      // which an added slice changes) are unchanged.
      const datum = (t: string) => t.replace(/\.?\s*Point \d+ of \d+\.?$/, '').replace(/\s*\([^)]*%\)/, '');
      expect(datum(after)).toBe(datum(text));
      expect(await closePage(page)).toEqual([]);
    });

    if (type !== 'donut') it(`A7 ${type}: with the plot focused, appended rows do not change what the focused plot says (reading: a focused range whose value text changes is spoken, so its position must not count arriving rows)`, async () => {
      const page = await devPage();
      await create(page, type);
      await page.focus('#chart .axylo-proxy');
      await page.keyboard.press('ArrowRight');
      const text = await valueText(page);
      for (let k = 0; k < 3; k++) await call(page, 'append', [streamRow(type, k)]);
      expect(await valueText(page)).toBe(text);
      expect(await closePage(page)).toEqual([]);
    });
  }
});

// ── A8 ────────────────────────────────────────────────────────────────────────────────────────────

type State = [string, (page: Page) => Promise<void>];

function states(type: ChartType): State[] {
  const list: State[] = [['default', async () => {}]];
  if (type !== 'compact') {
    list.push(['keyboard focus with tooltip', async page => { await page.focus('#before'); await page.keyboard.press('Tab'); await page.keyboard.press('ArrowRight'); }]);
    list.push(['pointer tooltip', async page => { const p = await box(page, '#chart .axylo-proxy'); await page.mouse.move(p.x + p.width * 0.6, p.y + p.height * 0.5); }]);
    list.push(['table open', async page => { await page.locator('#chart [role="toolbar"] button', { hasText: 'View as table' }).click(); await settle(page); }]);
    list.push(['streaming', async page => call(page, 'append', [streamRow(type as Full, 0)])]);
  }
  if (type === 'line' || type === 'area' || type === 'scatter') {
    list.push(['zoomed', async page => call(page, 'zoom', [type === 'scatter' ? [12, 30] : ['2026-03-03', '2026-03-05']])]);
  }
  if (type !== 'compact' && type !== 'donut' && type !== 'scatter') {
    list.push(['a series hidden', async page => { await page.locator('#chart .axylo-legend-entry').first().click(); await settle(page); }]);
  }
  list.push(['loading', async page => call(page, 'update', [{ state: 'loading' }])]);
  list.push(['empty', async page => call(page, 'update', [{ data: [] }])]);
  list.push(['error', async page => call(page, 'update', [{ state: { error: 'The query failed.' } }])]);
  return list;
}

describe('A8 axe-core', () => {
  for (const type of TYPES) {
    it(`A8 ${type}: axe-core reports no violations in any state (${states(type).map(s => s[0]).join(', ')}, and with values left out)`, async () => {
      const failures: string[] = [];
      for (const [name, enter] of states(type)) {
        const page = await devPage();
        await create(page, type);
        await enter(page);
        const result = await axe(page, '#chart');
        for (const v of result.violations) failures.push(`${name}: ${v.id} (${v.nodes.join(', ')})`);
        await closePage(page);
      }
      const page = await devPage();
      await create(page, type, {}, '#chart', 'dirty');
      const result = await axe(page, '#chart');
      for (const v of result.violations) failures.push(`values left out: ${v.id} (${v.nodes.join(', ')})`);
      // heading-order is about the page's outline, so it is run over the page; the page's own landmarks
      // (axe's "region") are the author's and are not counted (spec 3.4).
      const outline = await axe(page, 'body');
      for (const v of outline.violations.filter(v => v.id === 'heading-order')) failures.push(`values left out: ${v.id} (${v.nodes.join(', ')})`);
      if (type !== 'compact') expect(outline.ran).toContain('heading-order');
      await closePage(page);
      expect(failures).toEqual([]);
    });
  }
});

// ── A10 ───────────────────────────────────────────────────────────────────────────────────────────

/** Every key of the public `Messages` interface (src/public.ts), the spec's "every built-in string". */
const MESSAGE_KEYS = [
  'viewAsTable', 'hideTable', 'noData', 'noObservation', 'incompleteStack', 'moreRows', 'otherSlices', 'valuesNotShown', 'valuesChanged', 'labelsHidden',
  'loading', 'empty', 'error', 'internalError', 'chartName', 'chartSummary', 'seriesSummary', 'referenceSummary', 'timeZoneNote', 'plotLabel', 'controlsLabel',
  'pointOf', 'zoomIn', 'zoomOut', 'resetZoom', 'pause', 'resume', 'previousPage', 'nextPage', 'pageOf', 'jumpToX', 'showSeries', 'hideSeries', 'category',
  'percentage', 'series', 'value', 'typeLine', 'typeArea', 'typeBar', 'typeScatter', 'typeDonut', 'donutSummary', 'seriesNoData', 'seriesNotDrawn',
  'referenceLine', 'referenceBand', 'plotRole', 'pointAll', 'seriesValue', 'position', 'total', 'panLeft', 'panRight', 'jumpNotFound', 'plotInstructions',
] as const;
const PLACEHOLDERS = '{count} {type} {x} {y} {series} {value} {index} {page} {label} {from} {to} {zone} {min} {max} {last} {total} {xLabel} {xMin} {xMax} {yLabel} {yMin} {yMax} {seriesCount} {values} {position} {percent} {example}';
/** Distinctive words of the built-in English text; none may remain once every message is replaced. */
const ENGLISH = ['View as table', 'Hide table', 'Chart plot', 'Chart controls', 'Zoom in', 'Zoom out', 'Reset zoom', 'No data', 'not shown', 'Previous page', 'Next page', 'Jump to', 'Category', 'Percentage', 'minimum', 'maximum', 'Point ', 'chart with', 'Pause', 'Times are shown', ' chart'];

/** Every text an assistive technology or a sighted reader gets from the chart, after the reader used it. */
async function everyText(page: Page, type: ChartType): Promise<string> {
  const parts: string[] = [];
  if (type !== 'compact') {
    await page.focus('#chart .axylo-proxy');
    await page.keyboard.press('ArrowRight');
    parts.push(await valueText(page));
    await page.locator('#chart [role="toolbar"] button').last().click();
    await settle(page);
  }
  for (const n of await axWithin(page, '#chart')) parts.push(n.name, n.description, String(n.props.roledescription ?? ''));
  parts.push(await page.locator('#chart').innerText());
  return parts.join(' | ');
}

describe('A10 built-in text', () => {
  for (const type of TYPES) {
    it(`A10 ${type}: every built-in string is replaced through messages: none of the built-in English is left in the figure, the accessibility tree or the value text`, async () => {
      const page = await devPage();
      const messages = Object.fromEntries(MESSAGE_KEYS.map(k => [k, `ZZ-${k} ${PLACEHOLDERS}`]));
      // Dirty data, so the note is shown; a donut and the cartesian types each get theirs.
      await create(page, type, { messages, title: 'Replaced' }, '#chart', 'dirty');
      if (type !== 'compact') await call(page, 'append', [type === 'donut' ? [{ day: 'Mon2', value: 5 }] : type === 'scatter' ? [{ n: 8, value: 5 }] : [{ day: 'Mon2', value: 5 }]]);
      const text = await everyText(page, type);
      expect(ENGLISH.filter(e => text.includes(e)), text.slice(0, 2000)).toEqual([]);
      expect(text).toContain('ZZ-');
      expect(await closePage(page)).toEqual([]);
    });

    it(`A10 ${type}: on a lang="de" page the built-in English text is marked lang="en", and the author's own text is not (reading: the generated summary's sentences are built-in English)`, async () => {
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
        // Built-in English: the summary, the note, the toolbar's fixed controls, the plot's name and role, the table pager.
        const builtIn = [
          ...document.querySelectorAll('#chart .axylo-summary, #chart .axylo-note:not([hidden]), #chart .axylo-pager button, #chart .axylo-page'),
          ...[...document.querySelectorAll('#chart [role="toolbar"] button:not(.axylo-legend-entry)')],
          ...document.querySelectorAll('#chart .axylo-proxy'),
        ];
        for (const el of builtIn) if (langOf(el) !== 'en') out.push(`not marked en: ${el.className} "${(el.textContent || el.getAttribute('aria-label') || '').slice(0, 40)}"`);
        const title = document.querySelector('#chart .axylo-title:not([hidden])');
        if (title && langOf(title) === 'en') out.push('author title marked en');
        return out;
      });
      expect(wrong).toEqual([]);
      expect(await closePage(page)).toEqual([]);
    });
  }
});

