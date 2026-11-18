/**
 * Legibility, L1–L8 (spec 3.2), in Chrome after fonts load. Text boxes come from the rendered DOM (rotated
 * labels as rotated boxes); colours and contrast from what Chrome resolved; sizes from the layout.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { start, stop } from '../harness';
import {
  axOf, axWithin, backgroundColor, box, call, center, closePage, contrast, create, createRaw, devPage, plotGeometry, resolveColors, seriesColors, settle, shapes, type RGB,
} from './util';
import { FULL, optionsFor, TYPES, type ChartType } from './fixtures';
import { extent, overlaps, textBoxes } from './text';

beforeAll(start);
afterAll(stop);

type Full = Exclude<ChartType, 'compact'>;

/** Label-heavy data per type. `bars` and `parts` are the Phase 1 fixtures (research/harness/src/data.js). */
function busy(type: Full): { fn: string; options: Record<string, unknown>; categories?: string[] } {
  const day = (k: number) => new Date(Date.UTC(2026, 0, 1) + k * 864e5).toISOString().slice(0, 10);
  const names = ['Organic search', 'Direct', 'Referral partners'];
  const series = names.flatMap((s, i) => Array.from({ length: 120 }, (_, k) => ({ day: day(k), s, v: 12000 + 3000 * i + 900 * Math.sin(k / 7 + i) })));
  switch (type) {
    case 'line': return { fn: 'line', options: { title: 'Daily sessions by channel', subtitle: 'All regions', data: series, x: { field: 'day', type: 'date' }, y: { field: 'v', label: 'Sessions' }, series: 's' } };
    case 'area': return { fn: 'area', options: { title: 'Daily sessions by channel', data: series, x: { field: 'day', type: 'date' }, y: { field: 'v', label: 'Sessions' }, series: 's', stacked: true } };
    case 'bar': {
      const categories = ['Billing', 'Customer Success & Onboarding', 'Platform', 'Mobile', 'Data', 'Security', 'Sales Eng.'];
      const values = [94, 88, 97, 82, 91, 85, 90];
      return { fn: 'bar', categories, options: { title: 'Customer satisfaction by team', data: categories.map((team, i) => ({ team, satisfied: values[i] })), x: 'team', y: { field: 'satisfied', label: 'Satisfied', unit: '%' }, reference: [{ y: 90, label: 'Target' }] } };
    }
    case 'scatter': return { fn: 'scatter', options: { title: 'Latency by payload size', data: Array.from({ length: 60 }, (_, k) => ({ size: 100000 + k * 15000, latency: 1200 + ((k * 37) % 400), region: k % 2 ? 'Europe West' : 'North America East' })), x: { field: 'size', label: 'Payload', unit: 'B' }, y: { field: 'latency', label: 'Latency', unit: 'ms' }, series: 'region' } };
    case 'donut': {
      const labels = ['Chrome', 'Safari', 'Edge', 'Firefox', 'Samsung Internet', 'Other'];
      const values = [46.2, 27.5, 14.1, 8.9, 2.1, 1.2];
      return { fn: 'donut', options: { title: 'Sessions by browser', data: labels.map((browser, i) => ({ browser, share: values[i] })), label: 'browser', value: { field: 'share', label: 'Share', scale: 'percent' } } };
    }
  }
}

const WIDTHS = [240, 320, 480, 720, 1280, 1920];
const CONDITIONS: Record<string, string> = {
  'plain': '',
  'WCAG 1.4.12 text spacing': '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }',
  // Text-only zoom scales the text the page gives the chart, not the layout (reading: twice the inherited size).
  '200 % text-only zoom': 'body { font-size: 28px !important; }',
};

async function layoutProblems(page: Page, categories?: string[]): Promise<string[]> {
  const problems: string[] = [];
  const boxes = await textBoxes(page);
  problems.push(...overlaps(boxes, 1).map(p => `overlap ${p}`));
  const fig = await box(page, '#chart figure');
  for (const b of boxes) {
    const e = extent(b);
    if (e.x0 < fig.x - 1 || e.y0 < fig.y - 1 || e.x1 > fig.x + fig.width + 1 || e.y1 > fig.y + fig.height + 1) problems.push(`outside the figure: "${b.text}"`);
  }
  for (const role of ['tick-x', 'tick-y']) {
    const texts = boxes.filter(b => b.role === role).map(b => b.text);
    const dupes = texts.filter((t, i) => texts.indexOf(t) !== i);
    if (dupes.length) problems.push(`${role} labels not distinct: ${dupes.join(', ')}`);
  }
  if (categories) {
    // Unordered categories may not be thinned: every one is shown, or the reader is told.
    const shown = boxes.filter(b => b.role === 'tick-x').length;
    const note = page.locator('#chart .axylo-note');
    const told = (await note.isVisible()) && /labels hidden/i.test((await note.textContent()) ?? '');
    if (shown < categories.length && !told) problems.push(`${categories.length - shown} category labels hidden without the note`);
  }
  return problems;
}

describe('L1 labels fit', () => {
  for (const type of FULL as Full[]) {
    for (const [condition, css] of Object.entries(CONDITIONS)) {
      it(`L1 ${type}: at widths ${WIDTHS.join(', ')} px (${condition}) no text overlaps other text (1 px), none is outside the figure, tick labels are pairwise distinct, and no category label is hidden without the note`, async () => {
        const page = await devPage({ viewport: { width: 2000, height: 900 }, css: `#chart { height: 360px; } ${css}` });
        const d = busy(type);
        await createRaw(page, d.fn, d.options);
        await page.evaluate(() => document.fonts.ready);
        const problems: string[] = [];
        for (const width of WIDTHS) {
          await page.evaluate(w => { (document.querySelector('#chart') as HTMLElement).style.width = `${w}px`; }, width);
          await settle(page);
          await settle(page);
          problems.push(...(await layoutProblems(page, d.categories)).map(p => `${width} px: ${p}`));
        }
        expect(problems).toEqual([]);
        expect(await closePage(page)).toEqual([]);
      });
    }
  }
});

// ── L2 ────────────────────────────────────────────────────────────────────────────────────────────

const DARK_PAGE = 'html { color-scheme: dark; } body { background: #121212; color: #e8e8e8; }';

/** Every visible text node's font size and contrast against the colour painted behind it. */
async function textContrast(page: Page): Promise<{ text: string; size: number; ratio: number }[]> {
  const raw = await page.evaluate(() => {
    const out: { text: string; size: number; color: string; bg: string }[] = [];
    const walker = document.createTreeWalker(document.querySelector('#chart')!, NodeFilter.SHOW_TEXT);
    const opaque = (c: string) => !!c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement!;
      if (!n.textContent?.trim() || el.closest('[hidden], .axylo-visually-hidden, svg')) continue;
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') continue;
      let bg = 'rgb(255, 255, 255)';
      for (let a: Element | null = el; a; a = a.parentElement) { const c = getComputedStyle(a).backgroundColor; if (opaque(c)) { bg = c; break; } }
      out.push({ text: n.textContent.trim(), size: parseFloat(s.fontSize), color: s.color, bg });
    }
    return out;
  });
  const colors = await resolveColors(page, raw.flatMap(r => [r.color, r.bg]));
  return raw.map((r, i) => ({ text: r.text, size: r.size, ratio: contrast(colors[2 * i]!, colors[2 * i + 1]!) }));
}

/** The resolved colours of the axis lines (the scene's rules painted with `--axylo-axis`). */
async function axisColors(page: Page): Promise<RGB[]> {
  const css = await page.evaluate(() => [...document.querySelectorAll<SVGElement>('#chart svg.axylo-svg .axylo-scene line')].filter(l => /--axylo-axis/.test(l.style.getPropertyValue('color'))).map(l => getComputedStyle(l).color));
  return resolveColors(page, [...new Set(css)]);
}

describe('L2 text size and contrast', () => {
  for (const type of TYPES) {
    for (const scheme of ['light', 'dark'] as const) {
      it(`L2 ${type}: in the ${scheme} scheme every text is at least 12 CSS px and 4.5:1 (legend entries of hidden series included); marks, axis lines and the focus indicator are at least 3:1`, async () => {
        const page = await devPage({ css: scheme === 'dark' ? DARK_PAGE : '' });
        await create(page, type, { subtitle: 'All sites' });
        if (type !== 'compact' && type !== 'donut') {
          await page.locator('#chart .axylo-legend-entry').first().click();
          await settle(page);
        }
        const bad = (await textContrast(page)).filter(t => t.size < 12 || t.ratio < 4.5).map(t => `"${t.text}" ${t.size}px ${t.ratio.toFixed(2)}:1`);
        expect(bad).toEqual([]);
        const bg = await backgroundColor(page);
        // A hidden series draws no marks, so the marks measured are those of the shown series.
        for (const c of await seriesColors(page)) expect(contrast(c, bg), `mark ${c}`).toBeGreaterThanOrEqual(3);
        if (type !== 'donut' && type !== 'compact') for (const c of await axisColors(page)) expect(contrast(c, bg), `axis ${c}`).toBeGreaterThanOrEqual(3);
        if (type !== 'compact') {
          await page.focus('#before');
          await page.keyboard.press('Tab');
          const ring = await page.locator('#chart .axylo-focus-ring').evaluate(el => getComputedStyle(el).outlineColor);
          const [c] = await resolveColors(page, [ring]);
          expect(contrast(c!, bg), 'focus indicator').toBeGreaterThanOrEqual(3);
        }
        expect(await closePage(page)).toEqual([]);
      });
    }
  }
});

// ── L3 ────────────────────────────────────────────────────────────────────────────────────────────

describe('L3 the chart follows its container', () => {
  for (const type of FULL as Full[]) {
    it(`L3 ${type}: resized 720 → 360 → 720 px with no call from the page, the figure follows in both directions`, async () => {
      const page = await devPage();
      await create(page, type);
      const widths: number[] = [];
      for (const w of [720, 360, 720]) {
        await page.evaluate(w => { (document.querySelector('#chart') as HTMLElement).style.width = `${w}px`; }, w);
        await settle(page);
        widths.push(Math.round((await box(page, '#chart .axylo-plot')).width));
        expect((await box(page, '#chart svg.axylo-svg')).width).toBeLessThanOrEqual(w + 0.5);
      }
      expect(widths[1]).toBeLessThan(widths[0]!);
      expect(widths[2]).toBe(widths[0]);
      expect(await closePage(page)).toEqual([]);
    });

    it(`L3 ${type}: with no definite height the plot is 16:9 of its width, clamped to 160–480 px, and stable over 10 frames`, async () => {
      const page = await devPage({ viewport: { width: 1300, height: 1200 }, css: '#chart { height: auto; }' });
      await create(page, type);
      for (const w of [240, 720, 1200]) {
        await page.evaluate(w => { (document.querySelector('#chart') as HTMLElement).style.width = `${w}px`; }, w);
        await settle(page);
        const heights: number[] = [];
        for (let i = 0; i < 10; i++) {
          heights.push((await box(page, '#chart .axylo-plot')).height);
          await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
        }
        const plot = await box(page, '#chart .axylo-plot');
        const expected = Math.min(480, Math.max(160, plot.width * 9 / 16));
        expect(Math.abs(heights[0]! - expected), `${w} px wide`).toBeLessThanOrEqual(1);
        expect(new Set(heights.map(h => Math.round(h))).size).toBe(1);
      }
      expect(await closePage(page)).toEqual([]);
    });

    it(`L3 ${type}: a container that starts hidden draws when it is shown`, async () => {
      const page = await devPage({ css: '#chart.off { display: none; }' });
      await page.evaluate(() => document.querySelector('#chart')!.classList.add('off'));
      const { fn, options } = optionsFor(type);
      // Created while hidden: nothing can be drawn yet, so the test does not wait for a drawn frame here.
      await page.evaluate(({ fn, options }) => {
        const w = window as unknown as { Axylo: Record<string, (t: string, o: unknown) => unknown>; charts: unknown[] };
        w.charts.push(w.Axylo[fn]!('#chart', options));
      }, { fn, options });
      await page.evaluate(() => new Promise(r => setTimeout(r, 100)));
      await page.evaluate(() => document.querySelector('#chart')!.classList.remove('off'));
      // Shown: the chart draws on its own; wait (bounded) for its marks, then assert.
      await page.waitForFunction(() => [...document.querySelectorAll<SVGElement>('#chart svg.axylo-svg .axylo-scene *')].some(e => /--axylo-series-color-/.test(e.style.getPropertyValue('color'))), null, { timeout: 5000 }).catch(() => undefined);
      const marks = await page.evaluate(() => [...document.querySelectorAll<SVGElement>('#chart svg.axylo-svg .axylo-scene *')].filter(e => /--axylo-series-color-/.test(e.style.getPropertyValue('color'))).length);
      expect(marks).toBeGreaterThan(0);
      expect((await box(page, '#chart .axylo-plot')).width).toBeGreaterThan(300);
      expect(await closePage(page)).toEqual([]);
    });
  }
});

// ── L4 ────────────────────────────────────────────────────────────────────────────────────────────

describe('L4 scheme from the page', () => {
  for (const type of TYPES) {
    it(`L4 ${type}: a page that sets color-scheme: dark gets the dark marks; a class-toggled dark theme without color-scheme repaints by the next frame`, async () => {
      const page = await devPage({ css: 'body.dark { background: #121212; color: #e8e8e8; }' });
      await create(page, type);
      const light = await seriesColors(page);
      await page.close();
      const dark = await devPage({ css: DARK_PAGE });
      await create(dark, type);
      const darkMarks = await seriesColors(dark);
      expect(darkMarks).not.toEqual(light);
      await closePage(dark);
      const toggled = await devPage({ css: 'body.dark { background: #121212; color: #e8e8e8; }' });
      await create(toggled, type);
      expect(await seriesColors(toggled)).toEqual(light);
      await toggled.evaluate(() => document.body.classList.add('dark'));
      await toggled.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      expect(await seriesColors(toggled)).toEqual(darkMarks);
      await toggled.evaluate(() => document.body.classList.remove('dark'));
      await toggled.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      expect(await seriesColors(toggled)).toEqual(light);
      expect(await closePage(toggled)).toEqual([]);
    });

    it(`L4 ${type}: a light-only page on a dark device stays light, and --axylo-background overrides the detected scheme`, async () => {
      const page = await devPage();
      await create(page, type);
      const light = await seriesColors(page);
      await page.close();
      const device = await devPage({ colorScheme: 'dark' });
      await create(device, type);
      expect(await seriesColors(device)).toEqual(light);
      await closePage(device);
      const dark = await devPage({ css: DARK_PAGE });
      await create(dark, type);
      const darkMarks = await seriesColors(dark);
      await dark.close();
      const override = await devPage({ css: '#chart { --axylo-background: #101010; }' });
      await create(override, type);
      expect(await seriesColors(override)).toEqual(darkMarks);
      expect(await closePage(override)).toEqual([]);
    });

    it(`L4 ${type}: in forced-colors mode the marks use system colours`, async () => {
      const page = await devPage();
      await page.emulateMedia({ forcedColors: 'active' });
      await create(page, type);
      const marks = await seriesColors(page);
      expect(marks.length).toBeGreaterThan(0);
      const system = await resolveColors(page, ['CanvasText', 'Canvas', 'GrayText', 'Highlight', 'LinkText', 'ButtonText']);
      for (const m of marks) expect(system.some(s => s[0] === m[0] && s[1] === m[1] && s[2] === m[2]), `${m}`).toBe(true);
      expect(await closePage(page)).toEqual([]);
    });
  }
});

// ── L5 ────────────────────────────────────────────────────────────────────────────────────────────

/** Marker shapes per series slot: small closed subpaths in the series colour. */
async function markerCount(page: Page, slot = 1): Promise<number> {
  return ((await shapes(page, '#chart', 14))[slot] ?? []).length;
}

describe('L5 point markers', () => {
  for (const type of ['line', 'area'] as const) {
    it(`L5 ${type}: 120 daily points in 720 px (about 5.5 px apart) do not get a marker on every point; 12 points do; an isolated point always has one`, async () => {
      const day = (k: number) => new Date(Date.UTC(2026, 0, 1) + k * 864e5).toISOString().slice(0, 10);
      const page = await devPage();
      await createRaw(page, type, { title: 'Dense', data: Array.from({ length: 120 }, (_, k) => ({ day: day(k), v: 10 + (k % 9) })), x: { field: 'day', type: 'date' }, y: 'v' });
      expect(await markerCount(page)).toBeLessThan(120 / 2);
      await page.close();
      const sparse = await devPage();
      await createRaw(sparse, type, { title: 'Twelve', data: Array.from({ length: 12 }, (_, k) => ({ day: day(k), v: 10 + (k % 5) })), x: { field: 'day', type: 'date' }, y: 'v' });
      expect(await markerCount(sparse)).toBe(12);
      await sparse.close();
      const isolated = await devPage();
      // Dense, with one value alone between two gaps at day 60.
      const data = Array.from({ length: 120 }, (_, k) => ({ day: day(k), v: k === 59 || k === 61 ? null : 10 + (k % 9) }));
      await createRaw(isolated, type, { title: 'Isolated', data, x: { field: 'day', type: 'date' }, y: 'v' });
      const g = await plotGeometry(isolated);
      const at60 = g.plot.x + (60 / 119) * g.plot.width;
      const marks = ((await shapes(isolated, '#chart', 14))[1] ?? []).map(s => center(s.box).x);
      expect(marks.some(x => Math.abs(x - at60) <= 3), `marker near ${at60}: ${marks.map(Math.round).join(', ')}`).toBe(true);
      expect(await closePage(isolated)).toEqual([]);
    });
  }
});

// ── L6 ────────────────────────────────────────────────────────────────────────────────────────────

async function labels(page: Page, role: string): Promise<string[]> {
  return page.locator(`#chart .axylo-label[data-role="${role}"]`).allTextContents();
}

describe('L6 titles belong to the chart', () => {
  for (const type of FULL as Full[]) {
    it(`L6 ${type}: title and subtitle are part of the figure; axis titles follow the rule for the x kind, carry the unit, and do not overlap tick labels`, async () => {
      const page = await devPage();
      await create(page, type, { subtitle: 'Last quarter' });
      const fig = await box(page, '#chart figure');
      for (const sel of ['.axylo-title', '.axylo-subtitle']) {
        expect(await page.locator(`#chart ${sel}`).isVisible(), sel).toBe(true);
        const b = await box(page, `#chart ${sel}`);
        expect(b.y >= fig.y - 1 && b.y + b.height <= fig.y + fig.height + 1).toBe(true);
      }
      const titles = { y: await labels(page, 'title-y'), x: await labels(page, 'title-x') };
      if (type === 'line' || type === 'area') {
        expect(titles.y).toEqual(['Energy (kWh)']);
        // A date x axis is titled only with an author label.
        expect(titles.x).toEqual([]);
      } else if (type === 'bar') {
        expect(titles.y).toEqual(['Shipped (t)']);
        expect(titles.x).toEqual([]);
      } else if (type === 'scatter') {
        expect(titles.y).toEqual(['Latency (ms)']);
        expect(titles.x).toEqual(['Payload (kB)']);
      } else {
        expect([...titles.x, ...titles.y]).toEqual([]);
      }
      const boxes = await textBoxes(page);
      const axisTitles = boxes.filter(b => b.role === 'title-x' || b.role === 'title-y');
      const ticks = boxes.filter(b => b.role === 'tick-x' || b.role === 'tick-y');
      expect(overlaps([...axisTitles, ...ticks.map(t => ({ ...t, owner: t.owner + 100000 }))]).filter(o => axisTitles.some(a => o.includes(`"${a.text}"`)))).toEqual([]);
      expect(await closePage(page)).toEqual([]);
    });

    if (type !== 'donut' && type !== 'scatter') {
      it(`L6 ${type}: with an x label the ${type === 'bar' ? 'category' : 'date'} x axis is titled with it; a value field without a label is titled with its field name`, async () => {
        const page = await devPage();
        const x = type === 'bar' ? { field: 'quarter', label: 'Quarter' } : { field: 'day', type: 'date', label: 'Day' };
        await create(page, type, { x, y: type === 'bar' ? 'shipped' : 'energy' });
        expect(await labels(page, 'title-x')).toEqual([type === 'bar' ? 'Quarter' : 'Day']);
        expect(await labels(page, 'title-y')).toEqual([type === 'bar' ? 'shipped' : 'energy']);
        expect(await closePage(page)).toEqual([]);
      });
    }
  }

  it('L6 scatter: a number x without a label is titled with its field name', async () => {
    const page = await devPage();
    await create(page, 'scatter', { x: 'size', y: 'latency' });
    expect(await labels(page, 'title-x')).toEqual(['size']);
    expect(await labels(page, 'title-y')).toEqual(['latency']);
    expect(await closePage(page)).toEqual([]);
  });
});

// ── L7 ────────────────────────────────────────────────────────────────────────────────────────────

describe('L7 states inside the plot', () => {
  for (const type of TYPES) {
    it(`L7 ${type}: empty data shows a message inside the plot and in the accessibility tree, with no tick labels and no invented axis`, async () => {
      const page = await devPage();
      await create(page, type, { data: [] });
      const message = page.locator('#chart .axylo-message');
      expect(await message.isVisible()).toBe(true);
      const text = ((await message.textContent()) ?? '').trim();
      expect(text).not.toBe('');
      const plot = await box(page, '#chart .axylo-plot');
      const m = await box(page, '#chart .axylo-message');
      expect(m.x >= plot.x - 1 && m.y >= plot.y - 1 && m.x + m.width <= plot.x + plot.width + 1 && m.y + m.height <= plot.y + plot.height + 1).toBe(true);
      expect((await axWithin(page, '#chart')).some(n => n.name.includes(text) || n.description.includes(text))).toBe(true);
      expect(await page.locator('#chart .axylo-label[data-role^="tick"]').count()).toBe(0);
      expect(await page.evaluate(() => document.querySelectorAll('#chart svg.axylo-svg .axylo-scene line').length)).toBe(0);
      expect(await closePage(page)).toEqual([]);
    });

    it(`L7 ${type}: loading, an author error and an internal failure each show their message inside the plot; loading → ready is announced once, politely`, async () => {
      const page = await devPage();
      await create(page, type, { state: 'loading' });
      const message = page.locator('#chart .axylo-message');
      expect(await message.isVisible()).toBe(true);
      const loading = (await message.textContent())?.trim();
      await page.evaluate(() => {
        const w = window as unknown as { announced: string[] };
        w.announced = [];
        const live = document.querySelectorAll('#chart [aria-live="polite"], #chart [aria-live="assertive"]');
        for (const el of live) new MutationObserver(() => { if (el.textContent?.trim()) w.announced.push(`${el.getAttribute('aria-live')}: ${el.textContent}`); }).observe(el, { childList: true, characterData: true, subtree: true });
      });
      await call(page, 'update', [{ state: 'ready' }]);
      await settle(page);
      const announced = await page.evaluate(() => (window as unknown as { announced: string[] }).announced);
      expect(announced).toHaveLength(1);
      expect(announced[0]!.startsWith('polite: ')).toBe(true);
      expect(await message.isVisible()).toBe(false);
      await call(page, 'update', [{ state: { error: 'The query failed.' } }]);
      expect(await message.isVisible()).toBe(true);
      expect(await message.textContent()).not.toBe(loading);
      await call(page, 'update', [{ state: 'ready' }]);
      await page.evaluate(() => (window as unknown as { charts: { __dev: { fail(s: string | null): void } }[] }).charts[0]!.__dev.fail('reader'));
      await call(page, 'update', [{ title: 'Again' }]);
      expect(await message.isVisible()).toBe(true);
      expect(((await message.textContent()) ?? '').trim()).not.toBe('');
      expect(await closePage(page)).toEqual([]);
    });
  }
});

// ── L8 ────────────────────────────────────────────────────────────────────────────────────────────

describe('L8 too small for a plot', () => {
  for (const type of FULL as Full[]) {
    for (const [shape, css] of [['narrow', 'width: 110px; height: 300px;'], ['short', 'width: 600px; height: 90px;']] as const) {
      it(`L8 ${type}: a ${shape} container (${css}) shows the title, the one-line summary and the table control instead of a plot, and raises AX142`, async () => {
        const page = await devPage({ css: `#chart { ${css} }` });
        const built = await create(page, type);
        expect(built.diagnostics.filter(d => d.code === 'AX142').map(d => d.level)).toEqual(['hint']);
        expect(await page.locator('#chart .axylo-title').isVisible()).toBe(true);
        const summary = page.locator('#chart .axylo-summary');
        expect(await summary.isVisible()).toBe(true);
        expect(await summary.evaluate(el => el.classList.contains('axylo-visually-hidden'))).toBe(false);
        expect(await page.locator('#chart button', { hasText: 'View as table' }).isVisible()).toBe(true);
        const marks = await page.evaluate(() => [...document.querySelectorAll<SVGElement>('#chart svg.axylo-svg .axylo-scene *')].filter(e => /--axylo-series-color-/.test(e.style.getPropertyValue('color'))).length);
        expect(marks).toBe(0);
        expect((await axOf(page, '#chart figure')).name).not.toBe('');
        expect(await closePage(page)).toEqual([]);
      });
    }
  }
});
