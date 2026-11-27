/**
 * Cycle N3 (Wave 2, Track A): interaction, accessibility and reflow evidence in Chromium, Firefox and WebKit.
 *
 * - F-RESP-2: a touch tap where neither tooltip nor strip fits (readout 'none', spec I1) speaks the tapped
 *   datum's reading once, politely, in the proxy's reading language; no overlay, no layout change.
 * - F-A11Y-6: the plot's name is its own language-tagged element referenced by aria-labelledby, independent
 *   of the proxy's lang, which follows pointAll / pointOf (A10); both override directions on a lang="de" page.
 * - F-A11Y-4: a valid jump to the page already shown is confirmed once per submission (A4, A7).
 * - F-A11Y-5: native value and max, aria-valuetext, datum identity and live-region mutations while data
 *   streams under a focused proxy (A3, A7).
 * - F-RESP-5: 320 CSS px at 400 % (320 × 256 CSS px, device scale 4) across interactive states (A6, I4).
 * - F-RESP-6: compact charts at 24×16 and 120×79 (C1, C3) against the full chart's AX142 (L8).
 * - Forced colours: muted text (subtitle, disabled controls) is CanvasText; grid lines keep GrayText (L2, L4).
 * - Histogram touch, zoom inputs, focus survival, Pause/Resume and contrast; axe-core and keyboard paths on
 *   axylo/cartesian and axylo/finance (A2, A3, A4, A8, I3, I4, I6).
 *
 * Every input is Playwright's engine-neutral API (mouse, keyboard, touchscreen.tap, wheel); nothing here reads
 * the Chrome DevTools protocol. Opt-in entry points are the built dist/cartesian.dev.js and dist/finance.dev.js.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { ENGINE, start, stop } from '../harness';
import { startWithShortTmp, stopWithShortTmp } from '../acceptance/short-tmp';
import { axe } from '../a11y/util';
import { focused, recordAnnouncements, settle, SHOW_BUTTONS, tabStops } from '../acceptance/util';
import { chartPage, closePage, type ChartLike } from './util';
import { plotBox } from './final-util';

// A deep runner TMPDIR is too long for Chrome's socket on Linux; see acceptance/short-tmp.ts.
beforeAll(() => startWithShortTmp(start, { engine: ENGINE }));
afterAll(() => stopWithShortTmp(stop));

type Opt = Record<string, unknown>;
interface Range { value: number; max: number; text: string; lang: string; own: string | null }

/** Creates a chart with `fn` from `window.Axylo`, or from an opt-in entry ('cartesian', 'finance'). */
async function make(page: Page, fn: string, options: Opt, target = '#chart'): Promise<void> {
  await page.evaluate(({ fn, options, target }) => {
    const w = window as unknown as { Axylo: Record<string, (t: string, o: unknown) => ChartLike>; AxyloOptIn?: Record<string, (t: string, o: unknown) => ChartLike> };
    const maker = fn === 'cartesian' || fn === 'candlestick' ? w.AxyloOptIn![fn]! : w.Axylo[fn]!;
    const o = options as { data?: { columns?: Record<string, unknown> } };
    // Typed arrays do not survive the page boundary as such: rebuild a histogram's column.
    if (o.data && o.data.columns) for (const k of Object.keys(o.data.columns)) o.data.columns[k] = Float64Array.from(Object.values(o.data.columns[k] as Record<string, number>));
    window.charts.push(maker(target, options));
  }, { fn, options, target });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await settle(page);
  await settle(page);
}

/** Loads the built opt-in entry points as ES modules (each carries its own copy of the core). */
async function loadOptIn(page: Page): Promise<void> {
  await page.addScriptTag({
    type: 'module',
    content: "import { cartesian } from '/packages/axylo/dist/cartesian.dev.js'; import { candlestick } from '/packages/axylo/dist/finance.dev.js'; window.AxyloOptIn = { cartesian, candlestick };",
  });
  await page.waitForFunction(() => 'AxyloOptIn' in window);
}

/** The chart inside a page with its own landmarks and headings, as axe's page-level rules expect. */
async function structure(page: Page): Promise<void> {
  await page.evaluate(() => {
    const main = document.createElement('main');
    // A string title is a level-3 heading: the page gives it the levels above (axe heading-order).
    const h1 = Object.assign(document.createElement('h1'), { textContent: 'Dashboard' });
    const h2 = Object.assign(document.createElement('h2'), { textContent: 'Panel' });
    const chart = document.getElementById('chart')!;
    chart.replaceWith(main);
    main.append(h1, h2, document.getElementById('before')!, chart, document.getElementById('after')!);
  });
}

const range = (page: Page): Promise<Range> => page.locator('#chart .axylo-proxy').evaluate(el => {
  const input = el as HTMLInputElement;
  return { value: Number(input.value), max: Number(input.max), text: input.getAttribute('aria-valuetext') ?? '', lang: input.closest('[lang]')?.getAttribute('lang') ?? '', own: input.getAttribute('lang') };
});

const proxyFocused = (page: Page) => page.evaluate(() => document.activeElement?.classList.contains('axylo-proxy') ?? false);
const announcedNow = (page: Page) => page.evaluate(() => [...(window as unknown as { announced: string[] }).announced]);
const diagnosticCodes = (page: Page, i = 0) => page.evaluate(i => window.charts[i]!.diagnostics.map(d => d.code), i);
const xDomain = (page: Page) => page.evaluate(() => window.charts[0]!.__bench.describe().xDomain!);

/** Records every `select` of chart 0 on `window.picked`. */
async function recordSelect(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { picked: unknown[] };
    w.picked = [];
    window.charts[0]!.on('select', p => w.picked.push(p));
  });
}
const picked = (page: Page) => page.evaluate(() => (window as unknown as { picked: { x: unknown; y: unknown; series?: string; index?: number }[] }).picked);

/**
 * Counts, from now on, every change to the proxy's value, max and aria-valuetext attributes, and every
 * mutation inside a live region of the chart (aria-live other than off, role status / alert / log).
 */
async function watchMutations(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { muts: { proxy: string[]; live: number }; mutObs?: MutationObserver[] };
    w.mutObs?.forEach(o => o.disconnect());
    w.muts = { proxy: [], live: 0 };
    const proxy = document.querySelector('#chart .axylo-proxy')!;
    const a = new MutationObserver(rs => { for (const r of rs) w.muts.proxy.push(r.attributeName ?? ''); });
    a.observe(proxy, { attributes: true, attributeFilter: ['value', 'max', 'aria-valuetext'] });
    const live = (n: Node | null): boolean => {
      for (let e = n && n.nodeType === Node.TEXT_NODE ? n.parentElement : n as Element | null; e; e = e.parentElement) {
        const v = e.getAttribute('aria-live'), r = e.getAttribute('role');
        if (v === 'off') return false;
        if (v || r === 'status' || r === 'alert' || r === 'log') return true;
      }
      return false;
    };
    const b = new MutationObserver(rs => { for (const r of rs) if (live(r.target)) w.muts.live++; });
    b.observe(document.querySelector('#chart')!, { subtree: true, childList: true, characterData: true });
    w.mutObs = [a, b];
  });
}
const mutations = (page: Page) => page.evaluate(() => {
  const m = (window as unknown as { muts: { proxy: string[]; live: number } }).muts;
  return { proxy: [...m.proxy], live: m.live };
});

/**
 * The datum the proxy is on, as the chart reports it when Enter selects it (spec A2: Enter selects). The press
 * must emit exactly one new select, so an earlier event can never stand in for it.
 */
async function identity(page: Page): Promise<{ x: unknown; y: unknown; series?: string; index?: number }> {
  const before = (await picked(page)).length;
  await page.keyboard.press('Enter');
  await settle(page);
  const all = await picked(page);
  expect(all.length, 'Enter emits one fresh select').toBe(before + 1);
  return all.at(-1)!;
}

/** Counts, from now on, every Escape that reaches the document unconsumed (the chart listens on the window, capturing). */
async function watchEscapes(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { escapes: number };
    w.escapes = 0;
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !e.defaultPrevented) w.escapes++; });
  });
}
const escapesSeen = (page: Page) => page.evaluate(() => (window as unknown as { escapes: number }).escapes);

/**
 * Escape from single-series reading with keyboard focus showing the tooltip (decisions 0001 and 0004 rule 7):
 * one Escape does one thing. The first closes the tooltip and nothing else (the single-series reading, its lang
 * and focus stay); the second leaves single-series mode; the third is not consumed, so it reaches the page.
 * Returns the reading after the second Escape.
 */
async function escapeInOrder(page: Page, one: Range, afterFirst?: () => Promise<void>): Promise<Range> {
  await watchEscapes(page);
  expect(await page.locator('#chart .axylo-tooltip').isVisible(), 'keyboard focus shows the tooltip').toBe(true);
  await page.keyboard.press('Escape');
  await settle(page);
  expect(await page.locator('#chart .axylo-tooltip').isVisible(), 'the first Escape closes the tooltip').toBe(false);
  expect(await proxyFocused(page)).toBe(true);
  const kept = await range(page);
  expect(kept, 'the first Escape keeps the single-series reading').toEqual(one);
  expect(await escapesSeen(page)).toBe(0);
  await afterFirst?.();
  await page.keyboard.press('Escape');
  await settle(page);
  expect(await proxyFocused(page)).toBe(true);
  const back = await range(page);
  expect(await escapesSeen(page)).toBe(0);
  await page.keyboard.press('Escape');
  await settle(page);
  expect(await escapesSeen(page), 'with nothing left to close, Escape goes to the page').toBe(1);
  expect(await proxyFocused(page)).toBe(true);
  expect(await range(page)).toEqual(back);
  return back;
}

// ── F-RESP-2 ───────────────────────────────────────────────────────────────────────────────────────

describe('F-RESP-2: a touch tap in readout mode none speaks the tapped datum (spec I1, I4, A7)', () => {
  const data = [0, 1, 2, 3, 4].map(x => ({ x, y: x * 10 }));
  const NARROW = `${SHOW_BUTTONS} #chart { width: 200px; height: 260px; }`;

  /**
   * Readout none (spec I1): narrower than 240 px (no floating tooltip), no strip (the root has no readout
   * class), and still a plot (not L8's fallback). Shrinks the height until the layout leaves the strip out;
   * returns that height.
   */
  async function toNone(page: Page): Promise<number> {
    let found = false, height = 0;
    for (let h = 260; h >= 100 && !found; h -= 4) {
      height = h;
      await page.evaluate(h => { document.getElementById('chart')!.style.height = `${h}px`; }, h);
      await settle(page);
      found = await page.evaluate(() => {
        const proxy = document.querySelector('#chart .axylo-proxy') as HTMLElement | null;
        if (!proxy || proxy.hidden) return false;
        const r = proxy.getBoundingClientRect();
        return r.width >= 120 && r.width < 240 && r.height >= 80 && !document.querySelector('#chart .axylo-readout-mode') && !document.querySelector('#chart.axylo-readout-mode');
      });
    }
    expect(found, 'a container height with readout none').toBe(true);
    expect(await diagnosticCodes(page)).not.toContain('AX142');
    return height;
  }

  /** One touch tap; returns only the select events and announcements it caused (fresh, never earlier ones). */
  async function tap(page: Page, x: number, y: number): Promise<{ picked: { x: unknown; y: unknown }[]; said: string[] }> {
    const before = { picked: (await picked(page)).length, said: (await announcedNow(page)).length };
    await page.touchscreen.tap(x, y);
    await settle(page);
    return { picked: (await picked(page)).slice(before.picked), said: (await announcedNow(page)).slice(before.said) };
  }

  it('in a plot that holds neither tooltip nor strip, each tap selects exactly the tapped datum once and announces its exact reading once, politely, with no overlay and no layout change', async () => {
    const page = await chartPage({ hasTouch: true, css: NARROW });
    try {
      await make(page, 'line', { title: 'Load', data, x: 'x', y: { field: 'y', label: 'Load' } });
      await toNone(page);
      await recordSelect(page);
      await recordAnnouncements(page);
      const p = await plotBox(page);
      // Pointing (I1) highlights without a readout and says nothing.
      await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
      await settle(page);
      expect(await page.locator('#chart .axylo-tooltip').isVisible()).toBe(false);
      expect(await page.locator('#chart .axylo-readout').isVisible()).toBe(false);
      expect(await announcedNow(page)).toEqual([]);
      const before = await page.evaluate(() => JSON.stringify(document.querySelector('#chart figure')!.getBoundingClientRect()));

      // x 0–4 across the plot: its middle is x = 2.
      const first = await tap(page, p.x + p.width / 2, p.y + p.height / 2);
      expect(first.picked).toHaveLength(1);
      expect(first.picked[0]).toMatchObject({ x: 2, y: 20 });
      // The template pointAll '{x}. {values}. {position}' (messages) with seriesValue '{series} {value}'.
      expect(first.said).toEqual(['polite: 2. Load 20. Point 3 of 5']);
      expect(await page.locator('#chart .axylo-tooltip').isVisible()).toBe(false);
      expect(await page.locator('#chart .axylo-readout').isVisible()).toBe(false);
      expect(await page.evaluate(() => JSON.stringify(document.querySelector('#chart figure')!.getBoundingClientRect()))).toBe(before);
      // The live region carries the proxy's reading language (here the page's own: built-in English on lang="en").
      const liveLang = await page.evaluate(() => [...document.querySelectorAll('#chart [aria-live="polite"]')].find(e => (e.textContent ?? '').includes('Load 20'))?.closest('[lang]')?.getAttribute('lang') ?? null);
      expect(liveLang).toBe((await range(page)).lang);
      expect((await range(page)).text).toBe('2. Load 20. Point 3 of 5');

      // 95 % across is nearest x = 4 (3.8 rounds to the last point).
      const second = await tap(page, p.x + p.width * 0.95, p.y + p.height / 2);
      expect(second.picked).toHaveLength(1);
      expect(second.picked[0]).toMatchObject({ x: 4, y: 40 });
      expect(second.said).toEqual(['polite: 4. Load 40. Point 5 of 5']);
      // The keyboard gives the same reading for the same point.
      await page.locator('#chart .axylo-proxy').focus();
      await page.keyboard.press('End');
      await settle(page);
      expect((await range(page)).text).toBe('4. Load 40. Point 5 of 5');
      expect(await closePage(page)).toEqual([]);
    } catch (error) {
      await closePage(page).catch(() => {});
      throw error;
    }
  });

  it('a tap that lands on no datum selects nothing and says nothing; a tap on a point then selects it and speaks once', async () => {
    const page = await chartPage({ hasTouch: true, css: NARROW });
    try {
      // Points at two corners and the middle; the plot's top-left corner is farther than the 24 px pick
      // radius from all of them (the plot is at least 120 × 80 px here).
      await make(page, 'scatter', { title: 'Spots', data: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 }], x: 'x', y: 'y' });
      await toNone(page);
      await recordSelect(page);
      await recordAnnouncements(page);
      const p = await plotBox(page);
      expect(p.width).toBeGreaterThanOrEqual(120);
      expect(p.height).toBeGreaterThanOrEqual(80);
      const miss = await tap(page, p.x + 4, p.y + 4);
      expect(miss).toEqual({ picked: [], said: [] });
      const hit = await tap(page, p.x + p.width / 2, p.y + p.height / 2);
      expect(hit.picked).toHaveLength(1);
      expect(hit.picked[0]).toMatchObject({ x: 5, y: 5 });
      expect(hit.said).toHaveLength(1);
      expect(hit.said[0]).toBe(`polite: ${(await range(page)).text}`);
      expect(await closePage(page)).toEqual([]);
    } catch (error) {
      await closePage(page).catch(() => {});
      throw error;
    }
  });

  for (const [where, css, none] of [['full size', '#chart { width: 640px; height: 360px; }', false], ['where readout none would apply', NARROW, true]] as const) {
    it(`tooltip: false, ${where}: a tap selects the tapped datum once and announces nothing (the author chose no readout)`, async () => {
      const page = await chartPage({ hasTouch: true, css });
      try {
        // tooltip: false drops the strip at every height, so toNone on that chart would accept its first height.
        // The geometry comes from a tooltip-enabled control instead: the height where it reaches readout none.
        let control: Awaited<ReturnType<typeof plotBox>> | null = null;
        if (none) {
          await make(page, 'line', { title: 'Load', data, x: 'x', y: { field: 'y', label: 'Load' } });
          await toNone(page);
          control = await plotBox(page);
          await page.evaluate(() => { window.charts.pop()!.destroy(); });
          await settle(page);
        }
        await make(page, 'line', { title: 'Load', data, x: 'x', y: { field: 'y', label: 'Load' }, tooltip: false });
        await recordSelect(page);
        await recordAnnouncements(page);
        const p = await plotBox(page);
        if (control) {
          // The same container, so the same plot: narrower than the tooltip's 240 px and still a plot.
          for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(p[k] - control[k]), k).toBeLessThanOrEqual(0.5);
          expect(p.width).toBeLessThan(240);
          expect(p.height).toBeGreaterThanOrEqual(80);
          expect(await diagnosticCodes(page)).not.toContain('AX142');
        }
        const once = await tap(page, p.x + p.width / 2, p.y + p.height / 2);
        expect(once.picked).toHaveLength(1);
        expect(once.picked[0]).toMatchObject({ x: 2, y: 20 });
        expect(once.said).toEqual([]);
        const again = await tap(page, p.x + p.width * 0.95, p.y + p.height / 2);
        expect(again.picked).toHaveLength(1);
        expect(again.picked[0]).toMatchObject({ x: 4, y: 40 });
        expect(again.said).toEqual([]);
        expect(await page.locator('#chart .axylo-tooltip').isVisible()).toBe(false);
        expect(await closePage(page)).toEqual([]);
      } catch (error) {
        await closePage(page).catch(() => {});
        throw error;
      }
    });
  }

  it('where the floating tooltip fits, a tap still pins it and the live region stays silent (unchanged behaviour)', async () => {
    const page = await chartPage({ hasTouch: true, css: '#chart { width: 640px; height: 360px; }' });
    try {
      await make(page, 'line', { title: 'Load', data, x: 'x', y: { field: 'y', label: 'Load' } });
      await recordAnnouncements(page);
      const p = await plotBox(page);
      await page.touchscreen.tap(p.x + p.width / 2, p.y + p.height / 2);
      await settle(page);
      expect(await page.locator('#chart .axylo-tooltip.axylo-tooltip-pinned').isVisible()).toBe(true);
      expect((await announcedNow(page)).filter(a => a.includes('Load 20'))).toEqual([]);
      expect(await closePage(page)).toEqual([]);
    } catch (error) {
      await closePage(page).catch(() => {});
      throw error;
    }
  });
});

// ── F-A11Y-6 ───────────────────────────────────────────────────────────────────────────────────────

describe('F-A11Y-6: the plot name and the point reading are tagged with their own languages (spec A10, A3)', () => {
  const data = [0, 1, 2].flatMap(x => ['Nord', 'Süd'].map((s, i) => ({ x, s, y: x + i * 5 })));

  async function labelOf(page: Page): Promise<{ text: string; lang: string; same: boolean }> {
    return page.evaluate(() => {
      const proxy = document.querySelector('#chart .axylo-proxy')!;
      const ids = (proxy.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
      const el = ids.length === 1 ? document.getElementById(ids[0]!) : null;
      const w = window as unknown as { labelEl?: Element };
      const same = w.labelEl === undefined || w.labelEl === el;
      w.labelEl = el ?? undefined;
      return { text: el?.textContent ?? '', lang: el?.closest('[lang]')?.getAttribute('lang') ?? '', same };
    });
  }

  for (const [direction, messages, plotLabel, labelLang, allLang, oneLang] of [
    ['translated pointAll, built-in English plotLabel and pointOf', { pointAll: '{x}: {values}. {position}' }, 'Chart plot', 'en', 'de', 'en'],
    ['translated plotLabel and pointOf, built-in English pointAll', { plotLabel: 'Diagrammfläche', pointOf: '{series}, {x}, {value}. Punkt {index} von {count}.' }, 'Diagrammfläche', 'de', 'en', 'de'],
  ] as const) {
    it(`lang="de" page, ${direction}: the slider's name comes from one element in ${labelLang}; its own lang follows the reading (${allLang} for all series, ${oneLang} for one) while focus stays`, async () => {
      const page = await chartPage({ css: SHOW_BUTTONS });
      try {
        await page.evaluate(() => document.documentElement.setAttribute('lang', 'de'));
        await make(page, 'line', { title: 'Temperatur', data, x: 'x', y: 'y', series: 's', messages });
        await page.locator('#chart .axylo-proxy').focus();
        await page.keyboard.press('Home');
        await settle(page);
        expect(await page.getByRole('slider', { name: plotLabel }).count()).toBe(1);
        let label = await labelOf(page);
        expect(label).toEqual({ text: plotLabel, lang: labelLang, same: true });
        const all = await range(page);
        expect(all.lang).toBe(allLang);

        await page.keyboard.press('ArrowDown');
        await settle(page);
        expect(await proxyFocused(page)).toBe(true);
        const one = await range(page);
        expect(one.lang).toBe(oneLang);
        expect(one.value).toBe(all.value);
        expect(one.text).not.toBe(all.text);
        expect(one.text).toContain('Nord');
        label = await labelOf(page);
        expect(label).toEqual({ text: plotLabel, lang: labelLang, same: true });

        const back = await escapeInOrder(page, one, async () => expect(await labelOf(page)).toEqual({ text: plotLabel, lang: labelLang, same: true }));
        expect(back.lang).toBe(allLang);
        expect(back.text).toBe(all.text);
        expect(await labelOf(page)).toEqual({ text: plotLabel, lang: labelLang, same: true });
        expect(await page.getByRole('slider', { name: plotLabel }).count()).toBe(1);
        expect(await closePage(page)).toEqual([]);
      } catch (error) {
        await closePage(page).catch(() => {});
        throw error;
      }
    });
  }

  it('the label element is hidden from browsing (no duplicate text) and axe finds no violation in either mode', async () => {
    const page = await chartPage({ css: SHOW_BUTTONS });
    try {
      await structure(page);
      await page.evaluate(() => document.documentElement.setAttribute('lang', 'de'));
      await make(page, 'line', { title: 'Temperatur', data, x: 'x', y: 'y', series: 's', messages: { pointAll: '{x}: {values}. {position}' } });
      const hidden = await page.evaluate(() => {
        const id = document.querySelector('#chart .axylo-proxy')!.getAttribute('aria-labelledby')!;
        return document.getElementById(id)!.closest('[aria-hidden="true"]') !== null;
      });
      expect(hidden).toBe(true);
      await page.locator('#chart .axylo-proxy').focus();
      await page.keyboard.press('ArrowDown');
      await settle(page);
      expect((await axe(page)).violations).toEqual([]);
      expect(await closePage(page)).toEqual([]);
    } catch (error) {
      await closePage(page).catch(() => {});
      throw error;
    }
  });

  // The figure's id prefix (axylo-N) reserves only its own suffixes; ids the page already uses for "-l" must
  // not become the slider's name (spec A1: ids unique). The first chart of a page is axylo-1 unless taken. The
  // label's id grows by a 0 while it is taken in its own tree (where aria-labelledby resolves): -l, -l0, -l00.
  for (const where of ['document', 'shadow root'] as const) {
    it(`in the ${where}: page ids named like the label are skipped; the slider keeps its own name and its id is unique`, async () => {
      const page = await chartPage({ css: SHOW_BUTTONS });
      try {
        const result = await page.evaluate(async where => {
          const decoy = (parent: Node, id: string) => { const e = document.createElement('span'); e.id = id; e.textContent = 'Wrong name'; parent.appendChild(e); };
          const chartEl = document.getElementById('chart')!;
          let tree: Document | ShadowRoot = document, target: HTMLElement = chartEl;
          if (where === 'shadow root') {
            const shadow = chartEl.attachShadow({ mode: 'open' });
            target = shadow.appendChild(document.createElement('section'));
            target.style.height = '350px';
            tree = shadow;
          }
          const parent = tree === document ? document.body : tree;
          for (let n = 1; n <= 4; n++) { decoy(parent, `axylo-${n}-l`); decoy(parent, `axylo-${n}-l0`); }
          const chart = window.Axylo.line!(target, { title: 'Load', data: [0, 1, 2].map(x => ({ x, y: x })), x: 'x', y: 'y' });
          window.charts.push(chart);
          await chart.__bench.ready();
          await window.nextFrames(3);
          const figure = tree.querySelector('figure')!;
          const proxy = tree.querySelector('.axylo-proxy')!;
          const id = proxy.getAttribute('aria-labelledby') ?? '';
          const named = tree.getElementById(id);
          const count = (t: Document | ShadowRoot) => t.querySelectorAll(`[id="${id}"]`).length;
          return {
            figure: figure.id, id,
            decoyStill: tree.getElementById(`${figure.id}-l`)?.textContent ?? null,
            text: named?.textContent ?? null, inChart: !!named && figure.contains(named),
            unique: count(tree),
          };
        }, where);
        expect(result.figure).toMatch(/^axylo-[1-4]$/);
        expect(result.decoyStill).toBe('Wrong name');
        expect(result.id).toBe(`${result.figure}-l00`);
        expect(result.text).toBe('Chart plot');
        expect(result.inChart).toBe(true);
        expect(result.unique).toBe(1);
        expect(await page.getByRole('slider', { name: 'Chart plot', exact: true }).count()).toBe(1);
        expect(await page.getByRole('slider', { name: 'Wrong name' }).count()).toBe(0);
        expect(await closePage(page)).toEqual([]);
      } catch (error) {
        await closePage(page).catch(() => {});
        throw error;
      }
    });
  }

  // The label is kept while a chart is detached, so its id is checked again where it reattaches: an id the new
  // tree already uses would otherwise outrank the chart's own label for aria-labelledby (spec A1).
  it('moved between the document and shadow roots: an id the destination already uses is skipped, the page\'s element keeps it, and the same slider is named by the chart\'s label', async () => {
    const page = await chartPage({ css: SHOW_BUTTONS });
    try {
      const steps = await page.evaluate(async () => {
        const w = window as unknown as { kept: Element | null };
        const target = document.getElementById('chart')!;
        target.style.cssText = 'width: 500px; height: 350px';
        const chart = window.Axylo.line!(target, { title: 'Load', data: [0, 1, 2].map(x => ({ x, y: x })), x: 'x', y: 'y' });
        window.charts.push(chart);
        await chart.__bench.ready();
        await window.nextFrames(3);
        const figure = target.querySelector('figure')!.id;
        const proxy = w.kept = target.querySelector('.axylo-proxy');
        const decoy = (parent: Node, id: string) => { const e = document.createElement('span'); e.id = id; e.textContent = 'Wrong name'; parent.insertBefore(e, parent.firstChild); return e; };
        const state = (tree: Document | ShadowRoot, decoys: Element[]) => {
          const id = proxy!.getAttribute('aria-labelledby') ?? '';
          const named = tree.getElementById(id);
          return {
            id, sameProxy: tree.querySelector('.axylo-proxy') === proxy,
            text: named?.textContent ?? null, inChart: !!named && target.contains(named),
            unique: tree.querySelectorAll(`[id="${id}"]`).length,
            decoys: decoys.map(d => [d.id, d.textContent, d.isConnected]),
          };
        };
        const move = async (into: Node) => {
          target.remove();
          await window.nextFrames(3);
          into.appendChild(target);
          await chart.__bench.ready();
          await window.nextFrames(3);
        };
        const out: Record<string, unknown> = { figure, start: state(document, []) };
        // Document to a shadow root whose tree already has the label's id, before the chart in tree order.
        const first = document.body.appendChild(document.createElement('div')).attachShadow({ mode: 'open' });
        const a = decoy(first, `${figure}-l`);
        await move(first);
        out.shadow = state(first, [a]);
        // Shadow root to another shadow root that also has the next candidate id.
        const second = document.body.appendChild(document.createElement('div')).attachShadow({ mode: 'open' });
        const b = [decoy(second, `${figure}-l0`), decoy(second, `${figure}-l`)];
        await move(second);
        out.other = state(second, b);
        // Back to the document, which now has the first candidate.
        const c = decoy(document.body, `${figure}-l`);
        await move(document.body);
        out.back = state(document, [c]);
        // Reattached where nothing collides with its current id: the lookup finds the label itself; unchanged.
        await move(document.body);
        out.again = state(document, [c]);
        return out;
      });
      const f = steps.figure as string;
      const ok = (id: string, decoys: [string, string, boolean][]) => ({ id, sameProxy: true, text: 'Chart plot', inChart: true, unique: 1, decoys });
      expect(steps.start).toEqual(ok(`${f}-l`, []));
      expect(steps.shadow).toEqual(ok(`${f}-l0`, [[`${f}-l`, 'Wrong name', true]]));
      expect(steps.other).toEqual(ok(`${f}-l00`, [[`${f}-l0`, 'Wrong name', true], [`${f}-l`, 'Wrong name', true]]));
      expect(steps.back).toEqual(ok(`${f}-l0`, [[`${f}-l`, 'Wrong name', true]]));
      expect(steps.again).toEqual(ok(`${f}-l0`, [[`${f}-l`, 'Wrong name', true]]));
      // The computed name (Playwright's accessible-name computation, engine-neutral) is the chart's label.
      expect(await page.getByRole('slider', { name: 'Chart plot', exact: true }).count()).toBe(1);
      expect(await page.getByRole('slider', { name: 'Wrong name' }).count()).toBe(0);
      expect(await closePage(page)).toEqual([]);
    } catch (error) {
      await closePage(page).catch(() => {});
      throw error;
    }
  });
});

// ── F-A11Y-4 ───────────────────────────────────────────────────────────────────────────────────────

describe('F-A11Y-4: a valid jump to the current page is confirmed once (spec A4, A7)', () => {
  it('each submitted jump announces its page once, also when it is the page shown and the words repeat; boundary paging and passive refresh stay silent', async () => {
    const page = await chartPage({ css: SHOW_BUTTONS });
    try {
      await make(page, 'line', { title: 'Paged', data: Array.from({ length: 105 }, (_, x) => ({ x, y: x * 10 })), x: 'x', y: 'y' });
      await page.locator('#chart [role="toolbar"] button', { hasText: 'View as table' }).click();
      await settle(page);
      await recordAnnouncements(page);
      const field = page.locator('#chart .axylo-jump-field');
      const submit = async (text: string) => { await field.fill(text); await field.press('Enter'); await settle(page); };
      // pageOf 'Page {page} of {count}': rows 0–99 on page 1, 100–104 on page 2 (A4: 100 rows per page).
      await submit('5');
      expect(await announcedNow(page)).toEqual(['polite: Page 1 of 2']);
      await submit('7');
      expect(await announcedNow(page)).toEqual(['polite: Page 1 of 2', 'polite: Page 1 of 2']);
      expect(await field.getAttribute('aria-invalid')).toBeNull();
      await submit('104');
      expect(await announcedNow(page)).toEqual(['polite: Page 1 of 2', 'polite: Page 1 of 2', 'polite: Page 2 of 2']);
      // Next is disabled on the last page (aria-disabled, so it stays focusable): pressing it says nothing.
      // Playwright waits for an aria-disabled button to become enabled, so the press is forced once the state is checked.
      const next = page.locator('#chart .axylo-pager button').nth(1);
      expect(await next.getAttribute('aria-disabled')).toBe('true');
      await next.click({ force: true });
      await settle(page);
      expect(await announcedNow(page)).toHaveLength(3);
      // An x that is not in the data is an error, not a page announcement.
      await submit('9999');
      expect(await field.getAttribute('aria-invalid')).toBe('true');
      expect((await announcedNow(page)).filter(a => a.includes('Page'))).toHaveLength(3);
      // Data arriving refreshes the table without speaking (A7).
      await field.fill('');
      const was = (await announcedNow(page)).length;
      await page.evaluate(async () => { window.charts[0]!.append([{ x: 105, y: 1050 }]); await window.charts[0]!.__bench.ready(); });
      await settle(page);
      expect((await announcedNow(page)).slice(was).filter(a => a.includes('Page'))).toEqual([]);
      expect(await closePage(page)).toEqual([]);
    } catch (error) {
      await closePage(page).catch(() => {});
      throw error;
    }
  });
});

// ── F-A11Y-5 ───────────────────────────────────────────────────────────────────────────────────────

describe('F-A11Y-5: the focused proxy while data streams (spec A3, A7)', () => {
  it('line: count-only append, ordinal shift, eviction and repeated boundary arrows: value, max, value text, datum and live region', async () => {
    const page = await chartPage({ css: SHOW_BUTTONS });
    try {
      await make(page, 'line', { title: 'Stream', data: Array.from({ length: 10 }, (_, x) => ({ x, y: 100 + x })), x: 'x', y: { field: 'y', label: 'Level' } });
      await recordSelect(page);
      const proxy = page.locator('#chart .axylo-proxy');
      await proxy.focus();
      await page.keyboard.press('Home');
      for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
      await settle(page);
      const start = await range(page);
      expect(start).toMatchObject({ value: 5, max: 9 });
      expect(start.text).toContain('Level 105');
      expect((await identity(page)).x).toBe(5);
      const append = async (rows: Opt[], keep?: number) => {
        await page.evaluate(async ({ rows, keep }) => { window.charts[0]!.append(rows, keep === undefined ? undefined : { keep }); await window.charts[0]!.__bench.ready(); }, { rows, keep });
        await settle(page);
      };

      // Count-only append: the datum keeps its ordinal; only max grows. Nothing speaks (A7).
      await watchMutations(page);
      await append([{ x: 10, y: 110 }]);
      let now = await range(page);
      expect(now).toMatchObject({ value: 5, max: 10, text: start.text });
      expect(await mutations(page)).toMatchObject({ live: 0 });
      expect((await mutations(page)).proxy).not.toContain('aria-valuetext');
      expect(await proxyFocused(page)).toBe(true);
      expect((await identity(page)).x).toBe(5);

      // Ordinal shift: the oldest row leaves the window; the same datum is now at ordinal 4.
      await watchMutations(page);
      await append([{ x: 11, y: 111 }], 11);
      now = await range(page);
      expect(now).toMatchObject({ value: 4, max: 10, text: start.text });
      expect(await mutations(page)).toMatchObject({ live: 0 });
      expect((await mutations(page)).proxy).not.toContain('aria-valuetext');
      expect((await identity(page)).x).toBe(5);

      // Eviction: the focused datum leaves the window. Focus stays on the proxy, on a datum that exists.
      await watchMutations(page);
      await append([{ x: 12, y: 112 }, { x: 13, y: 113 }, { x: 14, y: 114 }, { x: 15, y: 115 }, { x: 16, y: 116 }], 8);
      now = await range(page);
      expect(await proxyFocused(page)).toBe(true);
      expect(now.max).toBe(7);
      expect(now.value).toBeGreaterThanOrEqual(0);
      expect(now.value).toBeLessThanOrEqual(7);
      expect(now.text).not.toBe(start.text);
      expect((await mutations(page)).live).toBe(0);
      // keep 8 after x = 16 leaves x 9–16: the focused datum is one of them.
      const after = (await identity(page)).x as number;
      expect(after).toBeGreaterThanOrEqual(9);
      expect(after).toBeLessThanOrEqual(16);

      // Repeated boundary arrows: End, then ArrowRight three times changes nothing at all.
      await page.keyboard.press('End');
      await settle(page);
      const end = await range(page);
      expect(end.value).toBe(end.max);
      await watchMutations(page);
      for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
      await settle(page);
      expect(await mutations(page)).toEqual({ proxy: [], live: 0 });
      expect(await range(page)).toEqual(end);
      await page.keyboard.press('Home');
      await settle(page);
      await watchMutations(page);
      for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
      await settle(page);
      expect(await mutations(page)).toEqual({ proxy: [], live: 0 });
      expect(await closePage(page)).toEqual([]);
    } catch (error) {
      await closePage(page).catch(() => {});
      throw error;
    }
  });
  it('histogram with fixed bins: a value appended into the focused bin changes its count in place: same ordinal, same bin, new value text, nothing spoken', async () => {
    const page = await chartPage({ css: `${SHOW_BUTTONS} #chart { width: 640px; height: 360px; }` });
    try {
      // Bins 0–2, 2–4, 4–6, 6–8 hold one sample each; fixed bins keep their edges as data arrives.
      await make(page, 'histogram', { title: 'Samples', data: [1, 3, 5, 7].map(v => ({ v })), x: 'v', bins: [0, 2, 4, 6, 8] });
      await recordSelect(page);
      const proxy = page.locator('#chart .axylo-proxy');
      await proxy.focus();
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowRight');
      await settle(page);
      const start = await range(page);
      expect(start).toMatchObject({ value: 1, max: 3 });
      expect(start.text).toContain('2–4');
      // The histogram's value is the bin's count (y label 'Count'), read through seriesValue '{series} {value}'.
      expect(start.text).toContain('Count 1');
      const before = await identity(page);
      expect(before.y).toBe(1);

      await watchMutations(page);
      // 3 falls in 2–4: an append, so the data epoch (and with it the focused datum) is kept.
      await page.evaluate(async () => { window.charts[0]!.append([{ v: 3 }]); await window.charts[0]!.__bench.ready(); });
      await settle(page);
      expect(await proxyFocused(page)).toBe(true);
      const now = await range(page);
      expect(now.value).toBe(1);
      expect(now.max).toBe(3);
      // A3: the value text describes the focused point, so the new count is in it; the rest stays (the bin
      // count, so "Point 2 of 4", does not change).
      expect(now.text).toBe(start.text.replace('Count 1', 'Count 2'));
      const m = await mutations(page);
      expect(m.live).toBe(0);
      expect(m.proxy).toContain('aria-valuetext');
      const after = await identity(page);
      expect(after.x).toEqual(before.x);
      expect(after.index).toEqual(before.index);
      expect(after.series).toEqual(before.series);
      expect(after.y).toBe(2);
      expect(await closePage(page)).toEqual([]);
    } catch (error) {
      await closePage(page).catch(() => {});
      throw error;
    }
  });
});

// ── F-RESP-5 ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Reflow problems at the current state (WCAG 1.4.10, 2.5.8; spec A6, I4): horizontal scrolling of the page
 * or the figure, visible text cut by an ancestor that hides overflow or by the viewport, and visible controls
 * under 24×24. The data table's own scroll region is two-dimensional content (WCAG 1.4.10's exception); the
 * plot's covered, inert subtree under the open table is not visible text.
 */
async function reflowProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const doc = document.documentElement, vw = doc.clientWidth;
    if (doc.scrollWidth > vw + 1) out.push(`page scrolls horizontally: ${doc.scrollWidth} > ${vw}`);
    const figure = document.querySelector('#chart figure') as HTMLElement;
    if (figure.scrollWidth > figure.clientWidth + 1) out.push(`figure scrolls horizontally: ${figure.scrollWidth} > ${figure.clientWidth}`);
    const skip = (el: Element) => !!el.closest('[hidden], .axylo-visually-hidden, [inert], .axylo-table-scroll, [aria-hidden="true"] svg');
    const visible = (el: Element) => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) !== 0; };
    const root = document.querySelector('#chart')!;
    // Any box inside the chart that scrolls sideways, at any depth (the open table's overlay and pager
    // included); only the table's own data scroller is exempt, as two-dimensional content.
    for (const el of root.querySelectorAll('*')) {
      if (!(el instanceof HTMLElement) || el.closest('.axylo-table-scroll, .axylo-visually-hidden') || !visible(el)) continue;
      const x = getComputedStyle(el).overflowX;
      if ((x === 'auto' || x === 'scroll') && el.scrollWidth > el.clientWidth + 1) out.push(`${el.className || el.tagName} scrolls horizontally: ${el.scrollWidth} > ${el.clientWidth}`);
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement!;
      if (!n.textContent?.trim() || skip(el) || !visible(el)) continue;
      let x0 = -1, x1 = vw + 1, y0 = -Infinity, y1 = Infinity, ellipsis = false;
      for (let a: Element | null = el; a && a !== document.body; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (s.textOverflow === 'ellipsis') ellipsis = true;
        const r = a.getBoundingClientRect();
        // A scroll container keeps its content reachable; only hidden or clipped overflow cuts text off.
        const cuts = (v: string) => v === 'hidden' || v === 'clip';
        if (cuts(s.overflowX)) { x0 = Math.max(x0, r.left - 1); x1 = Math.min(x1, r.right + 1); }
        if (cuts(s.overflowY)) { y0 = Math.max(y0, r.top - 1); y1 = Math.min(y1, r.bottom + 1); }
      }
      const rr = document.createRange();
      rr.selectNodeContents(n);
      for (const r of rr.getClientRects()) {
        if (r.width < 0.5 || r.height < 0.5) continue;
        const line = parseFloat(getComputedStyle(el).lineHeight), h = Number.isFinite(line) ? Math.min(r.height, line) : r.height;
        const top = r.top + (r.height - h) / 2;
        if ((r.left < x0 || r.right > x1 || top < y0 || top + h > y1) && !ellipsis) out.push(`clipped text "${(n.textContent ?? '').trim().slice(0, 40)}" in ${el.className || el.tagName}`);
      }
    }
    for (const el of root.querySelectorAll('button, input, select, a[href], [tabindex]')) {
      if (el.matches('.axylo-proxy, .axylo-table-scroll, figure') || skip(el) || !visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      // 24 CSS px (WCAG 2.5.8), less only what layout coordinates round away (1/64 px; Gecko 1/60).
      if (r.width < 24 - 1 / 50 || r.height < 24 - 1 / 50) out.push(`target "${(el.textContent || el.getAttribute('aria-label') || el.className).trim().slice(0, 30)}" ${r.width.toFixed(1)}×${r.height.toFixed(1)} < 24×24`);
    }
    return out;
  });
}

/**
 * Where the legend is: the control slot holding its entries (the series toggles), how many, the box around
 * them and the plot's box (viewport px).
 */
async function legendPlace(page: Page): Promise<{ slot: string; entries: number; legend: DOMRectLike; plot: DOMRectLike }> {
  return page.evaluate(() => {
    const entries = [...document.querySelectorAll('#chart .axylo-legend-entry')];
    const slots = new Set(entries.map(e => {
      const host = e.closest('.axylo-controls, .axylo-controls-top, .axylo-controls-side');
      return host ? [...host.classList].find(c => c.startsWith('axylo-controls')) ?? '' : '';
    }));
    const rects = entries.map(e => e.getBoundingClientRect());
    const legend = { top: Math.min(...rects.map(r => r.top)), bottom: Math.max(...rects.map(r => r.bottom)), left: Math.min(...rects.map(r => r.left)), right: Math.max(...rects.map(r => r.right)) };
    const p = document.querySelector('#chart .axylo-plot')!.getBoundingClientRect();
    return { slot: slots.size === 1 ? [...slots][0]! : [...slots].join(' + '), entries: entries.length, legend, plot: { top: p.top, bottom: p.bottom, left: p.left, right: p.right } };
  });
}
interface DOMRectLike { top: number; bottom: number; left: number; right: number }

describe('F-RESP-5: 320 CSS px at 400 % in every interactive state (spec A6, I4; WCAG 1.4.10, 2.5.8)', () => {
  const VIEW = { viewport: { width: 320, height: 256 }, deviceScaleFactor: 4 };
  const BASE = `${SHOW_BUTTONS} body { margin: 0; } #chart { width: auto; height: auto; }`;
  const three = [0, 1, 2, 3, 4, 5].flatMap(x => ['Northern region', 'Southern region', 'Western region'].map((s, i) => ({ x, s, y: x + i * 4 })));
  // Ten separate aligned series (decision 0001: a pointer anywhere over the plot picks the nearest x, so the
  // click cannot miss), ten units apart so no two lines touch. Pinned rows are 24 px buttons (decision 0004
  // rule 4): ten of them cannot fit in a plot inside a 256 px viewport, so the content pages ("+N more").
  const ten = [0, 1, 2, 3, 4].flatMap(x => Array.from({ length: 10 }, (_, i) => ({ x, s: `Series ${i + 1}`, y: 10 + i * 10 + x })));
  const tenOptions = { title: 'Ten series', data: ten, x: 'x', y: 'y', series: 's', legend: false };
  const readoutMode = (page: Page) => page.locator('#chart.axylo-readout-mode, #chart .axylo-readout-mode').count();

  /**
   * Scrolls the plot's top into the 320×256 viewport, clicks the plot at its middle x inside the visible part,
   * then scrolls on only as far as `content` (when given) needs to be seen whole, keeping the plot in view.
   */
  async function pinMiddle(page: Page, content?: string): Promise<void> {
    await page.evaluate(() => window.scrollBy(0, document.querySelector('#chart .axylo-proxy')!.getBoundingClientRect().top - 4));
    await settle(page);
    const view = page.viewportSize()!;
    const p = await plotBox(page);
    const at = { x: p.x + p.width / 2, y: p.y + (Math.min(p.y + p.height, view.height) - p.y) / 2 };
    expect(at.x > 0 && at.x < view.width && at.y > 0 && at.y < view.height, `click ${at.x},${at.y} inside the viewport`).toBe(true);
    await page.mouse.click(at.x, at.y);
    await settle(page);
    if (content) {
      await page.evaluate(sel => { const r = document.querySelector(sel)!.getBoundingClientRect(); if (r.bottom > innerHeight) window.scrollBy(0, r.bottom - innerHeight + 2); }, content);
      await settle(page);
      const q = await plotBox(page);
      expect(q.y + q.height, 'the plot is still in view').toBeGreaterThan(0);
    }
  }

  /** The element's box lies within the viewport and the element itself is what is at its centre. */
  async function usable(page: Page, selector: string): Promise<{ inView: boolean; onTop: boolean; width: number; height: number }> {
    return page.locator(selector).evaluate(el => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const doc = document.documentElement;
      return { inView: r.left >= -0.5 && r.top >= -0.5 && r.right <= doc.clientWidth + 0.5 && r.bottom <= doc.clientHeight + 0.5, onTop: !!hit && (hit === el || el.contains(hit)), width: r.width, height: r.height };
    });
  }

  /** Chart width, readout mode, and the plot's (proxy's) and the strip's boxes in viewport px. */
  async function stripGeometry(page: Page): Promise<{ width: number; mode: boolean; plot: DOMRectLike & { width: number; height: number }; strip: (DOMRectLike & { height: number }) | null; view: number }> {
    return page.evaluate(() => {
      const chart = document.getElementById('chart')!;
      const box = (el: Element) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; };
      const strip = document.querySelector('#chart .axylo-readout');
      return {
        width: chart.getBoundingClientRect().width,
        mode: !!document.querySelector('#chart.axylo-readout-mode, #chart .axylo-readout-mode'),
        plot: box(document.querySelector('#chart .axylo-proxy')!),
        strip: strip ? box(strip) : null,
        view: innerHeight,
      };
    });
  }

  /**
   * Readout mode with a strip (decision 0004 rule 5): the plot laid out without the strip is under 240 px
   * wide, and with the strip reserved it is still at least 120×80 (L8). Tries descending widths around the
   * floating limit, each after layout, fonts and the resize observer have settled.
   */
  async function toStrip(page: Page): Promise<void> {
    const tried: unknown[] = [];
    for (const w of [290, 278, 266, 254, 242, 230]) {
      await page.evaluate(w => { document.getElementById('chart')!.style.width = `${w}px`; }, w);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await settle(page);
      await settle(page);
      const g = await stripGeometry(page);
      tried.push(g);
      if (g.mode && g.strip && g.strip.height >= 24 && g.plot.width >= 120 && g.plot.height >= 80) {
        expect(await diagnosticCodes(page)).not.toContain('AX142');
        return;
      }
    }
    expect.fail(`no width gave a strip with a plot of at least 120×80: ${JSON.stringify(tried)}`);
  }

  /**
   * Scrolls the strip's reserved box (hidden, but laid out) into the 320×256 viewport, then clicks the plot at
   * its middle x inside the part of the plot that is visible. Nothing scrolls between that and the click.
   */
  async function pinStrip(page: Page): Promise<void> {
    await page.evaluate(() => {
      const r = document.querySelector('#chart .axylo-readout')!.getBoundingClientRect();
      if (r.bottom > innerHeight - 2) window.scrollBy(0, r.bottom - innerHeight + 2);
      else if (r.top < 0) window.scrollBy(0, r.top);
    });
    await settle(page);
    const g = await stripGeometry(page);
    const top = Math.max(g.plot.top, 0), bottom = Math.min(g.plot.bottom, g.view);
    const at = { x: (g.plot.left + g.plot.right) / 2, y: (top + bottom) / 2 };
    const geometry = JSON.stringify({ at, ...g });
    expect(g.strip !== null && g.strip.top >= -0.5 && g.strip.bottom <= g.view + 0.5, `the strip's box is in the viewport: ${geometry}`).toBe(true);
    expect(bottom - top, `some of the plot is visible above the strip: ${geometry}`).toBeGreaterThanOrEqual(8);
    await page.mouse.click(at.x, at.y);
    await settle(page);
    expect(await readoutMode(page), `still readout mode after the click: ${geometry}`).toBeGreaterThan(0);
  }

  const STATES: { name: string; css?: string; build(page: Page): Promise<void> }[] = [
    {
      name: 'zoomed, streaming: the eight-control toolbar',
      async build(page) {
        await make(page, 'line', { title: 'Requests per minute', data: Array.from({ length: 50 }, (_, x) => ({ x, y: 20 + (x % 7) })), x: 'x', y: 'y' });
        await page.evaluate(async () => { const c = window.charts[0]!; c.append([{ x: 50, y: 22 }]); await c.__bench.ready(); c.zoom([10, 30]); await c.__bench.ready(); });
        await settle(page);
        const names = await page.locator('#chart [role="toolbar"] button').allTextContents();
        for (const n of ['Zoom in', 'Zoom out', 'Pan left', 'Pan right', 'Reset zoom', 'Pause', 'View as table']) expect(names.map(s => s.trim())).toContain(n);
        expect(names.length).toBeGreaterThanOrEqual(8);
      },
    },
    {
      name: 'pinned floating tooltip with its "+N more" pager',
      // The viewport's width (BASE: width auto, so a vertical scrollbar cannot make the page scroll sideways) and
      // tall enough for a plot of at least 240×140 without the strip: floating mode (decision 0004 rule 5).
      css: '#chart { height: 300px; }',
      async build(page) {
        await make(page, 'line', tenOptions);
        expect(await readoutMode(page), 'floating mode, not readout').toBe(0);
        await pinMiddle(page, '#chart .axylo-tooltip');
        expect(await page.locator('#chart .axylo-tooltip.axylo-tooltip-pinned').isVisible()).toBe(true);
        expect(await page.locator('#chart .axylo-tooltip button.axylo-tooltip-row').count()).toBeGreaterThan(0);
        const more = '#chart .axylo-tooltip button.axylo-tooltip-more';
        expect(await page.locator(more).isVisible()).toBe(true);
        expect(await page.locator(more).textContent()).toMatch(/\+\d+ more/);
        expect(await usable(page, '#chart .axylo-tooltip')).toMatchObject({ inView: true });
        const pager = await usable(page, more);
        expect(pager).toMatchObject({ inView: true, onTop: true });
        expect(Math.min(pager.width, pager.height)).toBeGreaterThanOrEqual(24 - 1 / 50);
      },
    },
    {
      name: 'pinned strip readout with its pager',
      // Tall enough that the plot keeps at least 80 px above a strip of two 24 px lines (decision 0004 rule 5,
      // L8); the width is searched below, since the plot width without the strip depends on the measured axes.
      css: '#chart { height: 350px; }',
      async build(page) {
        await make(page, 'line', tenOptions);
        await toStrip(page);
        await pinStrip(page);
        // The strip (not the floating tooltip) shows, pinned by the click, with its pager as a visible button.
        expect(await page.locator('#chart .axylo-readout.axylo-readout-pinned').isVisible()).toBe(true);
        expect(await page.locator('#chart .axylo-tooltip').isVisible()).toBe(false);
        const more = '#chart .axylo-readout button.axylo-tooltip-more';
        expect(await page.locator(more).isVisible()).toBe(true);
        expect(await page.locator(more).textContent()).toMatch(/\+\d+ more/);
        expect(await usable(page, '#chart .axylo-readout')).toMatchObject({ inView: true });
        const pager = await usable(page, more);
        expect(pager, JSON.stringify(await stripGeometry(page))).toMatchObject({ inView: true, onTop: true });
        expect(Math.min(pager.width, pager.height)).toBeGreaterThanOrEqual(24 - 1 / 50);
      },
    },
    {
      name: 'open table with its pager',
      async build(page) {
        await make(page, 'line', { title: 'Paged', data: Array.from({ length: 105 }, (_, x) => ({ x, y: x })), x: 'x', y: 'y' });
        await page.locator('#chart [role="toolbar"] button', { hasText: 'View as table' }).click();
        await settle(page);
        expect(await page.locator('#chart .axylo-pager').isVisible()).toBe(true);
      },
    },
    {
      name: 'streaming',
      async build(page) {
        await make(page, 'line', { title: 'Live', data: three, x: 'x', y: 'y', series: 's' });
        await page.evaluate(async () => { const c = window.charts[0]!; c.append([{ x: 6, s: 'Northern region', y: 3 }]); await c.__bench.ready(); });
        await settle(page);
        expect(await page.locator('#chart [role="toolbar"] button', { hasText: 'Pause' }).count()).toBe(1);
      },
    },
    {
      name: "legend: 'top'",
      async build(page) {
        await make(page, 'line', { title: 'Regions', data: three, x: 'x', y: 'y', series: 's', legend: 'top' });
        const at = await legendPlace(page);
        expect(at.slot).toBe('axylo-controls-top');
        expect(at.entries).toBe(3);
        // Above the plot.
        expect(at.legend.bottom).toBeLessThanOrEqual(at.plot.top + 1);
      },
    },
    {
      name: "legend: 'right' (at 480 px or less, under the plot: F-RESP-1)",
      async build(page) {
        await make(page, 'line', { title: 'Regions', data: three, x: 'x', y: 'y', series: 's', legend: 'right' });
        const at = await legendPlace(page);
        // The 'right' slot, drawn under the plot as 'bottom' would be, since the row is 320 px wide.
        expect(at.slot).toBe('axylo-controls-side');
        expect(at.entries).toBe(3);
        expect(at.legend.top).toBeGreaterThanOrEqual(at.plot.bottom - 1);
        expect(at.legend.left).toBeGreaterThanOrEqual(at.plot.left - 1);
        expect(at.legend.right).toBeLessThanOrEqual(at.plot.right + 1);
      },
    },
  ];

  for (const state of STATES) {
    it(`${state.name}: no horizontal scrolling, no clipped text, every visible control at least 24×24`, async () => {
      const page = await chartPage({ ...VIEW, css: `${BASE} ${state.css ?? ''}` });
      try {
        await state.build(page);
        expect(await reflowProblems(page)).toEqual([]);
        expect(await closePage(page)).toEqual([]);
      } catch (error) {
        await closePage(page).catch(() => {});
        throw error;
      }
    });
  }

  it('the reflow checker is not blind: a 400 px wide chart in the 320 px viewport is reported', async () => {
    const page = await chartPage({ ...VIEW, css: `${BASE} #chart { width: 400px; }` });
    try {
      await make(page, 'line', { title: 'Too wide', data: three, x: 'x', y: 'y', series: 's' });
      expect((await reflowProblems(page)).some(p => p.startsWith('page scrolls horizontally'))).toBe(true);
      expect(await closePage(page)).toEqual([]);
    } catch (error) {
      await closePage(page).catch(() => {});
      throw error;
    }
  });
});

// ── F-RESP-6 ───────────────────────────────────────────────────────────────────────────────────────

describe('F-RESP-6: compact charts at 24×16 and 120×79 (spec C1, C3) against the full chart (L8)', () => {
  const data = Array.from({ length: 6 }, (_, x) => ({ x, y: (x % 3) + 1 }));
  for (const [w, h] of [[24, 16], [120, 79]] as const) {
    it(`${w}×${h}: the compact chart fills its box, adds no Tab stop, captures no pointer and raises no AX142; the full chart there raises AX142`, async () => {
      const page = await chartPage({ hasTouch: true, css: `${SHOW_BUTTONS} #chart { width: ${w}px; height: ${h}px; }` });
      try {
        // Every setPointerCapture call made in the page (the page itself makes none, so any is the chart's), and
        // each pointerdown's real target. A touch pointer's implicit capture is the browser's own (Pointer Events
        // 3, implicit capture), not a call, so it is not counted.
        await page.evaluate(() => {
          type Down = { id: number; type: string; inChart: boolean; target: string };
          const w = window as unknown as { calls: { id: number; inChart: boolean; target: string }[]; downs: Down[]; lastDown: Element | null };
          w.calls = []; w.downs = []; w.lastDown = null;
          const name = (e: Element) => `${e.tagName.toLowerCase()}${typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).join('.') : ''}`;
          const original = Element.prototype.setPointerCapture;
          Element.prototype.setPointerCapture = function (this: Element, id: number) {
            w.calls.push({ id, inChart: !!this.closest('#chart'), target: name(this) });
            return original.call(this, id);
          };
          document.addEventListener('pointerdown', e => {
            const t = e.target instanceof Element ? e.target : null;
            w.lastDown = t;
            w.downs.push({ id: e.pointerId, type: e.pointerType, inChart: !!t?.closest('#chart'), target: t ? name(t) : String(e.target) });
          }, true);
        });
        await make(page, 'line', { title: 'Spark', compact: true, data, x: 'x', y: 'y' });
        await recordSelect(page);
        const fill = await page.evaluate(() => {
          const chart = document.getElementById('chart')!.getBoundingClientRect();
          const svg = document.querySelector('#chart svg.axylo-svg')!.getBoundingClientRect();
          const marks = [...document.querySelectorAll('#chart svg.axylo-svg path')].map(p => p.getBoundingClientRect()).filter(r => r.width > 0 || r.height > 0);
          const inside = marks.every(r => r.left >= chart.left - 1 && r.right <= chart.right + 1 && r.top >= chart.top - 1 && r.bottom <= chart.bottom + 1);
          const span = marks.length ? Math.max(...marks.map(r => r.right)) - Math.min(...marks.map(r => r.left)) : 0;
          return { chart: [chart.width, chart.height], svg: [Math.abs(svg.width - chart.width) <= 1, Math.abs(svg.height - chart.height) <= 1], marks: marks.length, inside, span, imgs: document.querySelectorAll('#chart [role="img"]').length };
        });
        expect(fill.chart).toEqual([w, h]);
        expect(fill.svg).toEqual([true, true]);
        expect(fill.marks).toBeGreaterThan(0);
        expect(fill.inside).toBe(true);
        // Spread across the width (C3: it fills its container), less any stroke inset.
        expect(fill.span).toBeGreaterThan(w * 0.75);
        expect(fill.imgs).toBe(1);
        expect(await tabStops(page)).toEqual(['after']);
        // The Tab sentinels sit a few px above and below a 16 px chart, where touch adjustment (Chromium) can move
        // a tap's target onto them. During pointer input only, they are hidden without changing layout
        // (visibility: a hidden element is neither hit nor a touch-adjustment candidate), so the tap is on the chart.
        const sentinels = (shown: boolean) => page.evaluate(v => { for (const id of ['before', 'after']) document.getElementById(id)!.style.visibility = v; }, shown ? '' : 'hidden');
        await sentinels(false);
        const c = (await page.locator('#chart').boundingBox())!;
        await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
        await page.mouse.down();
        // A mouse pointer has no implicit capture: on its actual target, capture would only be the chart's.
        const held = await page.evaluate(() => {
          const w = window as unknown as { downs: { id: number }[]; lastDown: Element | null };
          return w.lastDown ? w.lastDown.hasPointerCapture(w.downs.at(-1)!.id) : null;
        });
        await page.mouse.up();
        await page.touchscreen.tap(c.x + c.width / 2, c.y + c.height / 2);
        await settle(page);
        const seen = await page.evaluate(() => {
          const w = window as unknown as { calls: unknown[]; downs: { type: string; inChart: boolean; target: string }[] };
          return { calls: w.calls, downs: w.downs.map(d => ({ type: d.type, inChart: d.inChart })), targets: w.downs.map(d => d.target) };
        });
        await sentinels(true);
        // Both inputs landed on the compact chart itself (not beside it), as a mouse and as a touch pointer.
        expect(seen.downs, `pointerdown targets: ${seen.targets.join(', ')}`).toEqual([{ type: 'mouse', inChart: true }, { type: 'touch', inChart: true }]);
        expect(held).toBe(false);
        // Each recorded call names the element it was made on; the pointerdowns' targets help read a failure.
        expect(seen.calls, `pointerdown targets: ${seen.targets.join(', ')}`).toEqual([]);
        expect(await picked(page)).toEqual([]);
        expect(await page.locator('#chart .axylo-tooltip:visible').count()).toBe(0);
        // No focus taken (C1: a compact chart is an image).
        expect(await page.evaluate(() => !!document.activeElement?.closest('#chart'))).toBe(false);
        expect(await diagnosticCodes(page)).not.toContain('AX142');
        // Still no Tab stop of its own once the sentinels are back.
        expect(await tabStops(page)).toEqual(['after']);

        await page.evaluate(() => { window.charts[0]!.destroy(); window.charts = []; });
        await make(page, 'line', { title: 'Spark', data, x: 'x', y: 'y' });
        expect(await diagnosticCodes(page)).toContain('AX142');
        expect(await closePage(page)).toEqual([]);
      } catch (error) {
        await closePage(page).catch(() => {});
        throw error;
      }
    });
  }
});

// ── Forced colours: muted text ───────────────────────────────────────────────────────────────────────

/** WCAG contrast of `selector`'s computed text color against the resolved system color `ground`. */
async function textContrast(page: Page, selector: string, ground: string): Promise<{ color: string; ratio: number }> {
  return page.evaluate(({ selector, ground }) => {
    const el = document.querySelector(selector) as HTMLElement;
    const probe = document.createElement('span');
    probe.style.color = ground;
    document.body.append(probe);
    const back = getComputedStyle(probe).color;
    probe.remove();
    const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
    };
    const color = getComputedStyle(el).color;
    const a = lum(rgb(color)), b = lum(rgb(back));
    return { color, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
  }, { selector, ground });
}

async function systemColor(page: Page, name: string): Promise<string> {
  return page.evaluate(name => { const s = document.createElement('span'); s.style.color = name; document.body.append(s); const c = getComputedStyle(s).color; s.remove(); return c; }, name);
}

describe('forced colours: muted text meets 4.5:1 and grid lines keep GrayText (spec L2, L4; wave 1 forced · 320x4)', () => {
  it('outside forced colours the muted token reaches the subtitle and the disabled Zoom out; in forced colours both are CanvasText, and --axylo-grid and --axylo-muted stay GrayText', async () => {
    const page = await chartPage({ css: `${SHOW_BUTTONS} :root { color-scheme: light; } body { background: #fff; color: #1b1d22; }` });
    try {
      await make(page, 'line', { title: 'Usage', subtitle: 'Last 50 minutes', data: Array.from({ length: 50 }, (_, x) => ({ x, y: x % 9 })), x: 'x', y: 'y' });
      const zoomOut = '#chart [role="toolbar"] button[aria-disabled="true"]';
      expect((await page.locator(zoomOut).allTextContents()).map(s => s.trim())).toContain('Zoom out');
      const muted = await page.evaluate(() => {
        const root = document.querySelector('#chart')!;
        const probe = document.createElement('span');
        probe.style.color = 'var(--axylo-muted, var(--axylo-default-muted))';
        root.append(probe);
        const c = getComputedStyle(probe).color;
        probe.remove();
        return c;
      });
      const plainSubtitle = await page.evaluate(() => getComputedStyle(document.querySelector('#chart .axylo-subtitle')!).color);
      const plainDisabled = await page.evaluate(s => getComputedStyle(document.querySelector(s)!).color, zoomOut);
      expect(plainSubtitle).toBe(muted);
      expect(plainDisabled).toBe(muted);

      await page.emulateMedia({ forcedColors: 'active' });
      await settle(page);
      // Playwright sends the forced-colors override to all three engines: the media state must be real here.
      expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches), `${ENGINE}: forced-colors emulation`).toBe(true);
      const canvasText = await systemColor(page, 'CanvasText');
      const subtitle = await textContrast(page, '#chart .axylo-subtitle', 'Canvas');
      const disabled = await textContrast(page, zoomOut, 'Canvas');
      expect(subtitle.color).toBe(canvasText);
      expect(disabled.color).toBe(canvasText);
      expect(subtitle.ratio).toBeGreaterThanOrEqual(4.5);
      expect(disabled.ratio).toBeGreaterThanOrEqual(4.5);
      const tokens = await page.evaluate(() => {
        const s = getComputedStyle(document.querySelector('#chart')!);
        return [s.getPropertyValue('--axylo-grid').trim(), s.getPropertyValue('--axylo-muted').trim()];
      });
      expect(tokens.map(t => t.replace(/\s*!important/, ''))).toEqual(['GrayText', 'GrayText']);
      expect(await closePage(page)).toEqual([]);
    } catch (error) {
      await closePage(page).catch(() => {});
      throw error;
    }
  });
});

// ── Histogram ──────────────────────────────────────────────────────────────────────────────────────

describe('histogram in a real browser: touch, zoom inputs, focus across data, Pause/Resume, contrast', () => {
  const opts = { title: 'Response times', data: { columns: { ms: [0, 1, 2, 4, 10] } }, x: 'ms', bins: [0, 2, 4, 10] };

  it('a tap pins the bin under the finger; a second tap on it dismisses the pin (spec I4)', async () => {
    const page = await chartPage({ hasTouch: true, css: '#chart { width: 640px; height: 360px; }' });
    try {
      await make(page, 'histogram', opts);
      const last = (await page.locator('#chart .axylo-svg g > rect').last().boundingBox())!;
      const at = { x: last.x + last.width / 2, y: last.y + last.height / 2 };
      await page.touchscreen.tap(at.x, at.y);
      await settle(page);
      const pinned = page.locator('#chart .axylo-tooltip.axylo-tooltip-pinned');
      expect(await pinned.isVisible()).toBe(true);
      expect(await pinned.textContent()).toContain('4–10');
      await page.touchscreen.tap(at.x, at.y);
      await settle(page);
      expect(await page.locator('#chart .axylo-tooltip.axylo-tooltip-pinned').count()).toBe(0);
      expect(await page.locator('#chart .axylo-tooltip').isVisible()).toBe(false);
      expect(await closePage(page)).toEqual([]);
    } catch (error) {
      await closePage(page).catch(() => {});
      throw error;
    }
  });

  it('zooms by buttons, by + - 0 on the focused plot, and by the wheel only while the plot has focus (spec I3)', async () => {
    const page = await chartPage({ css: `${SHOW_BUTTONS} #chart { width: 640px; height: 360px; } body { height: 3000px; }` });
    try {
      await make(page, 'histogram', opts);
      const width = async () => { const [lo, hi] = await xDomain(page); return hi! - lo!; };
      const full = await width();
      expect(full).toBe(10);
      await page.getByRole('button', { name: 'Zoom in' }).click();
      await settle(page);
      expect(await width()).toBe(5);
      await page.getByRole('button', { name: 'Zoom out' }).click();
      await settle(page);
      expect(await width()).toBe(10);

      const proxy = page.locator('#chart .axylo-proxy');
      await proxy.focus();
      await page.keyboard.press('+');
      await settle(page);
      const keyIn = await width();
      expect(keyIn).toBeLessThan(full);
      await page.keyboard.press('-');
      await settle(page);
      expect(await width()).toBeGreaterThan(keyIn);
      await page.keyboard.press('+');
      await page.keyboard.press('0');
      await settle(page);
      expect(await xDomain(page)).toEqual([0, 10]);

      // The wheel over an unfocused plot scrolls the page and leaves the domain alone. The page starts 100 px
      // down, so a wheel up (which zooms in when the plot has focus) has page to scroll back.
      await page.locator('#before').focus();
      await page.evaluate(() => window.scrollTo(0, 100));
      await settle(page);
      expect(await page.evaluate(() => window.scrollY)).toBe(100);
      const p = await plotBox(page);
      expect(p.y + p.height / 2).toBeGreaterThan(0);
      await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
      await page.mouse.wheel(0, -200);
      // Scrolling may finish after the event (smooth scrolling); a page that never scrolls fails below.
      await page.waitForFunction(() => window.scrollY < 100, undefined, { timeout: 3000 }).catch(() => {});
      await settle(page);
      expect(await page.evaluate(() => window.scrollY)).toBeLessThan(100);
      expect(await xDomain(page)).toEqual([0, 10]);
      await proxy.focus();
      const q = await plotBox(page);
      await page.mouse.move(q.x + q.width / 2, q.y + q.height / 2);
      await page.mouse.wheel(0, -200);
      await settle(page);
      expect(await width()).toBeLessThan(full);
      expect(await closePage(page)).toEqual([]);
    } catch (error) {
      await closePage(page).catch(() => {});
      throw error;
    }
  });

  it('keyboard focus stays on the same bin across update() and append(); Pause holds the view and Resume releases it (spec A7, I6)', async () => {
    const page = await chartPage({ css: `${SHOW_BUTTONS} #chart { width: 640px; height: 360px; }` });
    try {
      await make(page, 'histogram', { title: 'Samples', data: [1, 3, 5, 7].map(v => ({ v })), x: 'v', bins: [0, 2, 4, 6, 8] });
      const proxy = page.locator('#chart .axylo-proxy');
      await proxy.focus();
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowRight');
      await settle(page);
      expect((await range(page)).text).toContain('2–4');
      await page.evaluate(async () => { window.charts[0]!.update({ title: 'Samples (ms)' }); await window.charts[0]!.__bench.ready(); });
      await settle(page);
      expect(await proxyFocused(page)).toBe(true);
      expect((await range(page)).text).toContain('2–4');
      await page.evaluate(async () => { window.charts[0]!.append([{ v: 3.5 }, { v: 6.5 }]); await window.charts[0]!.__bench.ready(); });
      await settle(page);
      expect(await proxyFocused(page)).toBe(true);
      expect((await range(page)).text).toContain('2–4');

      const pause = page.locator('#chart [role="toolbar"] button', { hasText: 'Pause' });
      expect(await pause.count()).toBe(1);
      await pause.click();
      await settle(page);
      const resume = page.locator('#chart [role="toolbar"] button', { hasText: 'Resume' });
      expect(await resume.count()).toBe(1);
      const rows = async () => { await page.locator('#chart [role="toolbar"] button', { hasText: 'View as table' }).click(); await settle(page); const t = await page.locator('#chart table tbody').innerText(); await page.locator('#chart [role="toolbar"] button', { hasText: 'Hide table' }).click(); await settle(page); return t; };
      const held = await rows();
      await page.evaluate(async () => { window.charts[0]!.append([{ v: 7.5 }, { v: 7.6 }, { v: 7.7 }]); await window.charts[0]!.__bench.ready(); });
      await settle(page);
      expect(await rows()).toBe(held);
      await page.locator('#chart [role="toolbar"] button', { hasText: 'Resume' }).click();
      await settle(page);
      expect(await page.locator('#chart [role="toolbar"] button', { hasText: 'Pause' }).count()).toBe(1);
      expect(await rows()).not.toBe(held);
      expect(await closePage(page)).toEqual([]);
    } catch (error) {
      await closePage(page).catch(() => {});
      throw error;
    }
  });

  for (const scheme of ['light', 'dark'] as const) {
    it(`${scheme}: the title, tick labels and the tooltip's text are at least 12 px and 4.5:1 (spec L2)`, async () => {
      const css = scheme === 'dark' ? ':root { color-scheme: dark; } body { background: #16181d; color: #e8eaee; }' : ':root { color-scheme: light; } body { background: #ffffff; color: #1b1d22; }';
      const page = await chartPage({ colorScheme: scheme, css: `#chart { width: 640px; height: 360px; } ${css}` });
      try {
        await make(page, 'histogram', opts);
        await page.locator('#chart .axylo-proxy').focus();
        await page.keyboard.press('Home');
        await settle(page);
        const problems = await page.evaluate(() => {
          const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
          const lum = ([r, g, b]: number[]) => { const f = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!); };
          const backOf = (el: Element | null) => {
            for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c; }
            return getComputedStyle(document.body).backgroundColor;
          };
          const out: string[] = [];
          for (const el of document.querySelectorAll('#chart .axylo-title, #chart .axylo-label, #chart .axylo-tooltip-title, #chart .axylo-tooltip-row')) {
            if (!(el.textContent ?? '').trim() || el.getClientRects().length === 0 || el.closest('[hidden], .axylo-visually-hidden')) continue;
            const s = getComputedStyle(el);
            const a = lum(rgb(s.color)), b = lum(rgb(backOf(el)));
            const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
            if (parseFloat(s.fontSize) < 12) out.push(`${el.className} "${el.textContent}" ${s.fontSize}`);
            if (ratio < 4.5) out.push(`${el.className} "${el.textContent}" ${ratio.toFixed(2)} < 4.5`);
          }
          return out;
        });
        expect(problems).toEqual([]);
        expect(await page.locator('#chart .axylo-tooltip').isVisible()).toBe(true);
        expect(await closePage(page)).toEqual([]);
      } catch (error) {
        await closePage(page).catch(() => {});
        throw error;
      }
    });
  }
});

// ── axylo/cartesian and axylo/finance ──────────────────────────────────────────────────────────────

const DAYS = Array.from({ length: 12 }, (_, i) => `2026-03-${String(i + 1).padStart(2, '0')}`);

function cartesianOptions(): Opt {
  return {
    title: 'Units, share and requests',
    data: DAYS.map((day, i) => ({ day, units: 10 + ((i * 7) % 9), share: 4 + ((i * 3) % 5), req: 10 ** (1 + (i % 4)) })),
    x: { field: 'day', label: 'Day' },
    axes: { left: { position: 'left', label: 'Units' }, right: { position: 'right', scale: 'log', label: 'Requests' } },
    layers: [
      { type: 'bar', y: { field: 'units', label: 'Units' }, yAxis: 'left' },
      { type: 'area', y: { field: 'share', label: 'Share' }, yAxis: 'left' },
      { type: 'line', y: { field: 'req', label: 'Requests' }, yAxis: 'right' },
    ],
  };
}

const units = (i: number) => 10 + ((i * 7) % 9), share = (i: number) => 4 + ((i * 3) % 5), requests = (i: number) => 10 ** (1 + (i % 4));
const candle = (i: number) => { const o = 100 + i * 2, c = o + (i % 2 ? -3 : 4); return { o, h: Math.max(o, c) + 2, l: Math.min(o, c) - 2, c, v: 1000 + i * 250 }; };

function financeOptions(): Opt {
  return {
    title: 'ACME',
    data: DAYS.slice(0, 8).map((day, i) => ({ day, ...candle(i) })),
    // Labels the fixture names, so the table's headers can be told from the built-in defaults.
    x: 'day', open: { field: 'o', label: 'Opening' }, high: { field: 'h', label: 'Highest' }, low: { field: 'l', label: 'Lowest' },
    close: { field: 'c', label: 'Closing' }, volume: { field: 'v', label: 'Shares' }, yAxis: { unit: 'USD' },
  };
}

/** A formatted number back to its value: grouping, units and currency signs dropped; compact K / M expanded. */
function numberIn(text: string): number {
  const t = text.replace(/\u2212/g, '-').trim();
  const m = /(\d[\d,]*(?:\.\d+)?)\s*([KM])?/.exec(t);
  if (!m) return Number.NaN;
  // The sign may sit before a currency sign ("-$3.00").
  const sign = t.slice(0, m.index).includes('-') ? -1 : 1;
  return sign * Number(m[1]!.replace(/,/g, '')) * (m[2] === 'K' ? 1e3 : m[2] === 'M' ? 1e6 : 1);
}

/**
 * What the opt-in chart drew, read from the DOM alone (the opt-in handles carry no `__bench`). Selectors follow
 * the production renderer: src/render/svg.ts (one `svg.axylo-svg` whose `g.axylo-scene` holds one node per mark:
 * a bar series is a `g` of `rect`s, an area a filled `path` with a fill-opacity below 1, a line a `path`
 * "Mx yLx y…" with stroke-width 2 and no fill), src/render/text.ts (`.axylo-label` tick labels),
 * src/dom/interaction-controls.ts (`.axylo-legend-entry`) and src/finance/render.ts (pane clips
 * `clipPath#axylo-finance-<price|volume>-<n>` set as `clip-path` on that pane's marks).
 */
async function optInShape(page: Page) {
  return page.evaluate(() => {
    const chart = document.querySelector('#chart')!;
    const plot = chart.querySelector('.axylo-proxy')!.getBoundingClientRect();
    const svgs = chart.querySelectorAll('svg.axylo-svg');
    const scene = svgs.length === 1 ? svgs[0]!.querySelector(':scope > g.axylo-scene') : null;
    const labels = [...chart.querySelectorAll('.axylo-label')]
      .filter(e => (e.textContent ?? '').trim() && e.getClientRects().length > 0)
      .map(e => { const r = e.getBoundingClientRect(); return { text: (e.textContent ?? '').trim(), cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 }; });
    const beside = (side: 'left' | 'right') => labels
      .filter(l => (side === 'left' ? l.cx < plot.left - 4 : l.cx > plot.right + 4) && l.cy >= plot.top - 8 && l.cy <= plot.bottom + 6)
      .map(l => ({ text: l.text, cy: l.cy }));
    const kids = scene ? [...scene.children] as SVGElement[] : [];
    const vertices = (d: string) => [...d.matchAll(/[ML]\s*(-?[\d.]+)[\s,]*(-?[\d.]+)/g)].map(m => [Number(m[1]), Number(m[2])] as [number, number]);
    const bars = kids.filter(k => k.tagName.toLowerCase() === 'g' && k.childElementCount > 0 && [...k.children].every(c => c.tagName.toLowerCase() === 'rect'))
      .map(g => ({ rects: g.childElementCount, clip: g.getAttribute('clip-path') }));
    const paths = kids.filter(k => k.tagName.toLowerCase() === 'path');
    const areas = paths.filter(k => k.style.fill !== 'none' && k.style.fill !== '' && Number(k.style.fillOpacity) > 0 && Number(k.style.fillOpacity) < 1).length;
    const lines = paths.filter(k => k.getAttribute('stroke-width') === '2' && k.style.fill === 'none').map(k => vertices(k.getAttribute('d') ?? ''));
    const panes = [...chart.querySelectorAll('svg clipPath[id^="axylo-finance-"]')].map(c => {
      const r = c.querySelector('rect'), y = Number(r?.getAttribute('y')), height = Number(r?.getAttribute('height'));
      const marked = [...chart.querySelectorAll(`svg [clip-path="url(#${c.id})"]`)];
      // Every bar rectangle of this pane inside the pane's own clip rectangle (half a pixel of rounding).
      const rects = marked.flatMap(m => [...m.querySelectorAll(':scope > rect')]);
      const inside = rects.every(q => { const qy = Number(q.getAttribute('y')), qh = Number(q.getAttribute('height')); return qy >= y - 0.5 && qy + qh <= y + height + 0.5; });
      return { kind: c.id.split('-')[2]!, y, height, marks: marked.length, rects: rects.length, inside };
    });
    return {
      renderer: scene && chart.querySelectorAll('canvas').length === 0 ? 'svg' : null,
      series: [...chart.querySelectorAll('.axylo-legend-entry')].map(e => (e.textContent ?? '').trim()),
      left: beside('left'), right: beside('right'), bars, areas, lines, panes,
    };
  });
}

/** The opt-in chart's scene is in the DOM (no `__bench.ready` on opt-in handles). */
async function optInDrawn(page: Page): Promise<void> {
  await page.waitForSelector('#chart .axylo-proxy', { state: 'attached' });
  await page.waitForFunction(() => (document.querySelector('#chart svg.axylo-svg > g.axylo-scene')?.childElementCount ?? 0) > 0 && document.querySelectorAll('#chart .axylo-label').length > 0);
  await settle(page);
}

/** Asserts the opt-in chart is what its options ask for (A8 scans and parity mean nothing on a fallback). */
async function expectOptInShape(page: Page, fn: 'cartesian' | 'candlestick'): Promise<void> {
  const shape = await optInShape(page);
  expect(shape.renderer).toBe('svg');
  if (fn === 'cartesian') {
    // Three layers, each a legend entry (bar, area, line).
    expect(shape.series).toHaveLength(3);
    for (const [i, name] of ['Units', 'Share', 'Requests'].entries()) expect(shape.series[i]).toContain(name);
    // Mixed marks: one bar per day (12), one filled area, and the area's edge plus the line as stroked paths.
    expect(shape.bars.map(b => b.rects), JSON.stringify(shape.bars)).toEqual([12]);
    expect(shape.areas).toBeGreaterThanOrEqual(1);
    expect(shape.lines.length).toBeGreaterThanOrEqual(2);
    // Two value axes: numbers on both sides of the plot.
    const left = shape.left.filter(l => Number.isFinite(numberIn(l.text)));
    const right = shape.right.filter(l => Number.isFinite(numberIn(l.text)));
    expect(left.length).toBeGreaterThanOrEqual(2);
    // The right axis is logarithmic: its powers of ten (10 to 10,000 in the data) are evenly spaced.
    const decades = right.filter(l => { const v = numberIn(l.text); return v > 0 && Number.isInteger(Math.log10(v)); })
      .sort((a, b) => numberIn(a.text) - numberIn(b.text));
    expect(decades.length, `right ticks: ${right.map(l => l.text).join(', ')}`).toBeGreaterThanOrEqual(3);
    const gaps = decades.slice(1).map((l, i) => (decades[i]!.cy - l.cy) / Math.log10(numberIn(l.text) / numberIn(decades[i]!.text)));
    for (const g of gaps) { expect(g).toBeGreaterThan(0); expect(Math.abs(g - gaps[0]!)).toBeLessThanOrEqual(1.5); }
    // The drawn line itself is log-scaled: requests 10^(1 + i % 4) put its 12 vertices on 4 evenly spaced
    // heights (a linear scale would space them 1 : 10 : 100), rising with the value, left to right.
    const logLine = shape.lines.filter(v => v.length === 12).find(v => {
      const step = v[1]![1] - v[0]![1];
      return step < -5 && v.every(([, y], i) => Math.abs(y - (v[0]![1] + (i % 4) * step)) <= 1) && v.every(([x], i) => i === 0 || x > v[i - 1]![0]);
    });
    expect(logLine, JSON.stringify(shape.lines)).toBeDefined();
  } else {
    // A price pane above a separate volume pane, each clipping its own marks.
    const price = shape.panes.find(p => p.kind === 'price'), volume = shape.panes.find(p => p.kind === 'volume');
    expect(price, JSON.stringify(shape.panes)).toBeDefined();
    expect(volume, JSON.stringify(shape.panes)).toBeDefined();
    expect(price!.height).toBeGreaterThan(0);
    expect(volume!.height).toBeGreaterThan(0);
    expect(volume!.y).toBeGreaterThanOrEqual(price!.y + price!.height);
    expect(price!.marks).toBeGreaterThan(0);
    expect(volume!.marks).toBeGreaterThan(0);
    // One volume bar per day (8, every volume positive) and the 4 falling days' filled bodies (odd i: close
    // below open), each inside its own pane.
    expect(volume!.rects).toBe(8);
    expect(price!.rects).toBe(4);
    expect(volume!.inside).toBe(true);
    expect(price!.inside).toBe(true);
  }
}

const SCHEMES = {
  light: { colorScheme: 'light', forcedColors: 'none', css: ':root { color-scheme: light; } body { background: #ffffff; color: #1b1d22; }' },
  dark: { colorScheme: 'dark', forcedColors: 'none', css: ':root { color-scheme: dark; } body { background: #16181d; color: #e8eaee; }' },
  forced: { colorScheme: 'light', forcedColors: 'active', css: ':root { color-scheme: light; } body { background: #ffffff; color: #1b1d22; }' },
} as const;

for (const [name, fn, options] of [['axylo/cartesian dual-axis log, mixed bar/area/line', 'cartesian', cartesianOptions], ['axylo/finance candlestick with a volume pane', 'candlestick', financeOptions]] as const) {
  describe(name, () => {
    for (const scheme of ['light', 'dark', 'forced'] as const) {
      it(`axe-core: no violations in ${scheme}, default, keyboard reading with tooltip, and table open (spec A8)`, async () => {
        const s = SCHEMES[scheme];
        const page = await chartPage({ colorScheme: s.colorScheme, forcedColors: s.forcedColors, css: `${SHOW_BUTTONS} ${s.css} #chart { width: 720px; height: 420px; }` });
        try {
          // The scheme scanned is the one asked for: forced-colors and the color scheme as media states.
          const media = await page.evaluate(() => ({ forced: matchMedia('(forced-colors: active)').matches, dark: matchMedia('(prefers-color-scheme: dark)').matches }));
          expect(media, `${ENGINE}: media for ${scheme}`).toEqual({ forced: scheme === 'forced', dark: scheme === 'dark' });
          await structure(page);
          await loadOptIn(page);
          await make(page, fn, options());
          await page.waitForSelector('#chart .axylo-proxy', { state: 'attached' });
          await optInDrawn(page);
          await expectOptInShape(page, fn);
          const report: Record<string, unknown[]> = {};
          // Each scan is of the state it names.
          expect(await page.locator('#chart .axylo-tooltip').isVisible()).toBe(false);
          expect(await page.locator('#chart table').count()).toBe(0);
          report.default = (await axe(page)).violations;
          await page.locator('#chart .axylo-proxy').focus();
          await page.keyboard.press('Home');
          await page.keyboard.press('ArrowRight');
          await settle(page);
          expect(await proxyFocused(page)).toBe(true);
          expect((await range(page)).value).toBe(1);
          expect(await page.locator('#chart .axylo-tooltip').isVisible()).toBe(true);
          report.reading = (await axe(page)).violations;
          await page.locator('#chart [role="toolbar"] button', { hasText: 'View as table' }).click();
          await settle(page);
          expect(await page.locator('#chart table').isVisible()).toBe(true);
          expect(await page.locator('#chart table tbody tr').count()).toBe(fn === 'cartesian' ? 12 : 8);
          expect(await page.locator('#chart [role="toolbar"] button', { hasText: 'Hide table' }).count()).toBe(1);
          report.table = (await axe(page)).violations;
          expect(report).toEqual({ default: [], reading: [], table: [] });
          expect(await closePage(page)).toEqual([]);
        } catch (error) {
          await closePage(page).catch(() => {});
          throw error;
        }
      });
    }

    it('keyboard: two Tab stops, Home/End/arrows/PageUp/PageDown move in order, Up/Down and Escape, and the table opens and closes with focus restored (spec A2, A3, A4)', async () => {
      const page = await chartPage({ css: `${SHOW_BUTTONS} #chart { width: 720px; height: 420px; }` });
      try {
        await loadOptIn(page);
        await make(page, fn, options());
        await page.waitForSelector('#chart .axylo-proxy', { state: 'attached' });
        await optInDrawn(page);
        const forwards = await tabStops(page);
        expect(forwards[0]).toBe('proxy');
        expect(forwards[1]).toMatch(/^toolbar:/);
        expect(forwards.slice(2)).toEqual(['after']);
        expect((await tabStops(page, true)).at(-1)).toBe('before');

        await page.locator('#chart .axylo-proxy').focus();
        await page.keyboard.press('Home');
        await settle(page);
        const first = await range(page);
        expect(first.value).toBe(0);
        expect(first.text).not.toBe('');
        await page.keyboard.press('End');
        await settle(page);
        const last = await range(page);
        expect(last.value).toBe(last.max);
        expect(last.max).toBe(fn === 'cartesian' ? 11 : 7);
        await page.keyboard.press('ArrowLeft');
        await settle(page);
        expect((await range(page)).value).toBe(last.max - 1);
        await page.keyboard.press('Home');
        await page.keyboard.press('ArrowRight');
        await settle(page);
        expect((await range(page)).value).toBe(1);
        await page.keyboard.press('PageUp');
        await settle(page);
        const paged = (await range(page)).value;
        expect(paged).toBeGreaterThan(1);
        await page.keyboard.press('PageDown');
        await settle(page);
        expect((await range(page)).value).toBe(1);

        const all = await range(page);
        await page.keyboard.press('ArrowDown');
        await settle(page);
        const down = await range(page);
        expect(await proxyFocused(page)).toBe(true);
        expect(down.value).toBe(all.value);
        if (fn === 'cartesian') {
          // One series at a time: pointOf names the series (messages: '{series}, {x}, {value}. Point …').
          expect(down.text).not.toBe(all.text);
          const series = ['Units', 'Share', 'Requests'];
          const firstSeries = series.find(s => down.text.startsWith(s));
          expect(firstSeries).toBeDefined();
          await page.keyboard.press('ArrowDown');
          await settle(page);
          const next = await range(page);
          expect(next.text.startsWith(firstSeries!)).toBe(false);
          await page.keyboard.press('ArrowUp');
          await settle(page);
          expect((await range(page)).text).toBe(down.text);
        }
        const back = await escapeInOrder(page, await range(page));
        expect(back.text).toBe(all.text);
        expect(back.value).toBe(all.value);

        // The table: opened from the toolbar by keyboard, focus goes to its region; closed, focus returns to the toggle.
        await page.keyboard.press('Tab');
        await page.keyboard.press('End');
        expect(await focused(page)).toBe('toolbar:View as table');
        await page.keyboard.press('Enter');
        await settle(page);
        expect(await focused(page)).toBe('table');
        expect(await page.locator('#chart table').count()).toBe(1);
        await page.keyboard.press('Tab');
        expect(await focused(page)).toBe('toolbar:Hide table');
        await page.keyboard.press('Enter');
        await settle(page);
        expect(await page.locator('#chart table').count()).toBe(0);
        expect(await focused(page)).toBe('toolbar:View as table');
        await page.keyboard.press('Shift+Tab');
        expect(await focused(page)).toBe('proxy');
        expect(await closePage(page)).toEqual([]);
      } catch (error) {
        await closePage(page).catch(() => {});
        throw error;
      }
    });

    it('table parity: the fixture\'s headers, one row per keyboard point in order, and every named value of a row in that point\'s reading (spec A3, A4)', async () => {
      const page = await chartPage({ css: `${SHOW_BUTTONS} #chart { width: 720px; height: 420px; }` });
      try {
        await loadOptIn(page);
        await make(page, fn, options());
        await page.waitForSelector('#chart .axylo-proxy', { state: 'attached' });
        await optInDrawn(page);
        await expectOptInShape(page, fn);
        await page.locator('#chart .axylo-proxy').focus();
        await page.keyboard.press('Home');
        await settle(page);
        const readings: string[] = [];
        const { max } = await range(page);
        for (let i = 0; i <= max; i++) {
          readings.push((await range(page)).text);
          await page.keyboard.press('ArrowRight');
        }
        await settle(page);
        await page.locator('#chart [role="toolbar"] button', { hasText: 'View as table' }).click();
        await settle(page);
        const table = await page.evaluate(() => ({
          headers: [...document.querySelectorAll('#chart table thead th')].map(th => (th.textContent ?? '').trim()),
          rows: [...document.querySelectorAll('#chart table tbody tr')].map(tr => [...tr.children].map(c => (c.textContent ?? '').trim())),
        }));
        // Headers: x, then the fixture's labels; finance adds Change and Direction before the volume (spec A4).
        expect(table.headers).toEqual(fn === 'cartesian'
          ? ['Day', 'Units', 'Share', 'Requests']
          : ['day', 'Opening', 'Highest', 'Lowest', 'Closing', 'Change', 'Direction', 'Shares']);
        const n = fn === 'cartesian' ? 12 : 8;
        expect(readings).toHaveLength(n);
        expect(table.rows).toHaveLength(n);
        // A value is in the reading under its own name: seriesValue '{series} {value}', or finance's "name: value".
        const named = (reading: string, name: string, cell: string) => reading.includes(`${name} ${cell}`) || reading.includes(`${name}: ${cell}`);
        const misses: string[] = [];
        table.rows.forEach((row, i) => {
          const reading = readings[i]!;
          expect(row).toHaveLength(table.headers.length);
          for (const cell of row) expect(cell, `row ${i}`).not.toBe('');
          if (!reading.includes(row[0]!)) misses.push(`row ${i}: x "${row[0]}" not in "${reading}"`);
          const expected: [number, number][] = fn === 'cartesian'
            ? [[1, units(i)], [2, share(i)], [3, requests(i)]]
            : (() => { const k = candle(i); return [[1, k.o], [2, k.h], [3, k.l], [4, k.c], [5, k.c - k.o], [7, k.v]]; })();
          for (const [col, value] of expected) {
            if (numberIn(row[col]!) !== value) misses.push(`row ${i}: ${table.headers[col]} "${row[col]}" is not ${value}`);
          }
          if (fn === 'cartesian') {
            for (const col of [1, 2, 3]) if (!named(reading, table.headers[col]!, row[col]!)) misses.push(`row ${i}: "${table.headers[col]} ${row[col]}" not in "${reading}"`);
          } else {
            const k = candle(i);
            if (row[6] !== (k.c > k.o ? 'up' : k.c < k.o ? 'down' : 'unchanged')) misses.push(`row ${i}: Direction "${row[6]}"`);
            for (const col of [1, 2, 3, 4, 7]) if (!named(reading, table.headers[col]!, row[col]!)) misses.push(`row ${i}: "${table.headers[col]} ${row[col]}" not in "${reading}"`);
            // The reading gives change and direction together: "Change +4 USD (up)".
            if (!named(reading, 'Change', `${row[5]} (${row[6]})`)) misses.push(`row ${i}: "Change ${row[5]} (${row[6]})" not in "${reading}"`);
          }
        });
        expect(misses).toEqual([]);
        expect(await closePage(page)).toEqual([]);
      } catch (error) {
        await closePage(page).catch(() => {});
        throw error;
      }
    });
  });
}
