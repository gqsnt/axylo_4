/**
 * Legibility, L1–L8 (spec 3.2), in Chrome after fonts load. Text boxes come from the rendered DOM (rotated
 * labels as rotated boxes; cut text as the part that is painted, and named as clipped or ellipsised);
 * colours and contrast from painted pixels; sizes and positions from the layout and the drawn marks.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import type { Page } from 'playwright-core';
import { start, stop } from '../harness';
import {
  axOf, axWithin, box, call, center, closePage, contrast, create, createRaw, devPage, frames, inside, modeColor, readTable, resolveColors, ring, screenshot, settle, shapes, type Box, type RGB,
} from './util';
import { FULL, optionsFor, TYPES, type ChartType } from './fixtures';
import { extent, overlaps, textBoxes, type TextBox } from './text';
import { inkColor, strokeRuns } from './checks';

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
  // Text-only zoom scales the text the page gives the chart, not the layout (reading: twice the inherited
  // size; it leaves fixed-pixel text unchanged and does not stand in for the browser's own text zoom).
  '200 % text-only zoom': 'body { font-size: 28px !important; }',
};

/** What a reader would see wrong with the chart's text now (empty when nothing). */
export async function textProblems(page: Page, categories?: readonly string[]): Promise<string[]> {
  const problems: string[] = [];
  const boxes = await textBoxes(page);
  for (const b of boxes) if (b.seen !== 'whole') problems.push(`${b.seen}: "${b.text}"`);
  const painted = boxes.filter(b => b.w > 0);
  problems.push(...overlaps(painted, 1).map(p => `overlap ${p}`));
  const fig = await box(page, '#chart figure');
  for (const b of painted) {
    const e = extent(b);
    if (e.x0 < fig.x - 1 || e.y0 < fig.y - 1 || e.x1 > fig.x + fig.width + 1 || e.y1 > fig.y + fig.height + 1) problems.push(`outside the figure: "${b.text}"`);
  }
  // Remedies (spec L1): at most three lines, rotated by at most 45°.
  for (const b of boxes.filter(b => b.role === 'tick-x' || b.role === 'tick-y')) if (Math.abs(b.angle) > Math.PI / 4 + 0.01) problems.push(`rotated ${Math.round((b.angle * 180) / Math.PI)}°: "${b.text}"`);
  const lines = await page.evaluate(() => [...document.querySelectorAll('#chart .axylo-label[data-role^="tick"]')].map(l => [[...l.children].map(c => c.textContent).join(' '), l.children.length] as const));
  for (const [t, n] of lines) if (n > 3) problems.push(`${n} lines: "${t}"`);
  for (const role of ['tick-x', 'tick-y']) {
    const texts = boxes.filter(b => b.role === role).map(b => b.text);
    const dupes = texts.filter((t, i) => texts.indexOf(t) !== i);
    if (dupes.length) problems.push(`${role} labels not distinct: ${dupes.join(', ')}`);
  }
  if (categories) problems.push(...await categoryProblems(page, boxes, categories));
  return problems;
}

/**
 * Unordered categories may not be thinned (spec L1): each is shown whole, or truncated in the middle with
 * its full text in the table, or else the "labels hidden" note is shown and AX143 raised.
 */
async function categoryProblems(page: Page, boxes: readonly TextBox[], categories: readonly string[]): Promise<string[]> {
  const shown = boxes.filter(b => b.role === 'tick-x').map(b => b.text.replace(/\s+/g, ' ').trim());
  const note = page.locator('#chart .axylo-note');
  const told = (await note.isVisible()) && /labels hidden/i.test((await note.textContent()) ?? '');
  const problems: string[] = [];
  if (told) {
    const codes = await page.evaluate(() => (window as unknown as { charts: { diagnostics: { code: string }[] }[] }).charts[0]!.diagnostics.map(d => d.code));
    if (!codes.includes('AX143')) problems.push('labels hidden but AX143 not raised');
    return problems;
  }
  if (shown.length !== categories.length) return [`${categories.length - shown.length} category labels hidden without the note`];
  categories.forEach((c, i) => {
    const t = shown[i]!;
    if (t === c) return;
    const [head, tail] = t.split('…');
    // Truncated in the middle: what is left is the category's own start and end.
    if (tail === undefined || !c.startsWith(head!.trim()) || !c.endsWith(tail.trim())) problems.push(`label ${i + 1} "${t}" is not "${c}" nor its middle truncation`);
  });
  return problems;
}

async function setWidth(page: Page, width: number): Promise<void> {
  await page.evaluate(w => { (document.querySelector('#chart') as HTMLElement).style.width = `${w}px`; }, width);
  await settle(page);
  await settle(page);
}

describe('L1 labels fit', () => {
  for (const type of FULL as Full[]) {
    for (const [condition, css] of Object.entries(CONDITIONS)) {
      it(`L1 ${type}: at widths ${WIDTHS.join(', ')} px (${condition}) no painted text overlaps other text (1 px), none is clipped, ellipsised or outside the figure, tick labels are distinct, wrapped to at most three lines and rotated at most 45°, and no category label is lost without the note`, async () => {
        const page = await devPage({ viewport: { width: 2000, height: 900 }, css: `#chart { height: 360px; } ${css}` });
        const d = busy(type);
        await createRaw(page, d.fn, d.options);
        await page.evaluate(() => document.fonts.ready);
        const problems: string[] = [];
        for (const width of WIDTHS) {
          await setWidth(page, width);
          problems.push(...(await textProblems(page, d.categories)).map(p => `${width} px: ${p}`));
          if (type === 'bar') {
            // Axylo never changes the orientation on its own: the bars stay vertical (one value axis on the left).
            const rects = ((await shapes(page, '#chart', 100000))[1] ?? []).map(r => r.box);
            if (rects.length && !rects.every(r => Math.abs(r.width - rects[0]!.width) < 0.5)) problems.push(`${width} px: the bars changed orientation`);
          }
        }
        expect(problems).toEqual([]);
        expect(await closePage(page)).toEqual([]);
      });
    }

    it(`L1 ${type}: after a font that loads late, the relaid-out text still neither overlaps nor is cut off nor leaves the figure (480 and 1280 px)`, async () => {
      const page = await devPage({ viewport: { width: 2000, height: 900 }, css: '#chart { height: 360px; font-family: "Late Sans", sans-serif; }' });
      const d = busy(type);
      await createRaw(page, d.fn, d.options);
      const before = await textBoxes(page);
      const font = fs.readFileSync('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf').toString('base64');
      await page.evaluate(async f => {
        const bytes = Uint8Array.from(atob(f), c => c.charCodeAt(0));
        const face = new FontFace('Late Sans', bytes);
        await face.load();
        document.fonts.add(face);
      }, font);
      await settle(page);
      await settle(page);
      const after = await textBoxes(page);
      // The font did change the text's size (the check below is then about a real relayout).
      expect(after.reduce((a, b) => a + b.w, 0)).not.toBeCloseTo(before.reduce((a, b) => a + b.w, 0), 0);
      const problems: string[] = [];
      for (const w of [480, 1280]) { await setWidth(page, w); problems.push(...(await textProblems(page, d.categories)).map(p => `${w} px: ${p}`)); }
      expect(problems).toEqual([]);
      expect(await closePage(page)).toEqual([]);
    });
  }

  it('L1 bar: twelve long, unordered category labels at 240 px: each is shown whole, or truncated in the middle with its full text in the table, or the note says labels are hidden and AX143 is raised', async () => {
    const page = await devPage({ viewport: { width: 1000, height: 900 }, css: '#chart { height: 360px; width: 240px; }' });
    const categories = Array.from({ length: 12 }, (_, i) => `Department number ${i + 1} of the company`);
    await createRaw(page, 'bar', { title: 'Long labels', data: categories.map((c, i) => ({ c, v: 10 + i })), x: 'c', y: 'v' });
    await page.evaluate(() => document.fonts.ready);
    const problems = await textProblems(page, categories);
    expect(problems).toEqual([]);
    const truncated = (await page.locator('#chart .axylo-label[data-role="tick-x"]').allTextContents()).filter(t => t.includes('…'));
    if (truncated.length) {
      await page.locator('#chart [role="toolbar"] button', { hasText: 'View as table' }).click();
      await settle(page);
      expect((await readTable(page)).rows.map(r => r.header)).toEqual(categories);
    }
    expect(await closePage(page)).toEqual([]);
  });
});

// ── L2 ────────────────────────────────────────────────────────────────────────────────────────────

const DARK_PAGE = 'html { color-scheme: dark; } body { background: #121212; color: #e8e8e8; }';

/**
 * Every visible text's size and contrast: its colour as computed (text paints in its computed colour)
 * against the backdrop actually painted behind it (the most frequent colour of the pixels in its box,
 * which are mostly background for text).
 */
async function textContrast(page: Page): Promise<{ text: string; size: number; ratio: number }[]> {
  const raw = await page.evaluate(() => {
    const out: { text: string; size: number; color: string; box: { x: number; y: number; width: number; height: number } }[] = [];
    const walker = document.createTreeWalker(document.querySelector('#chart')!, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement!;
      if (!n.textContent?.trim() || el.closest('[hidden], .axylo-visually-hidden, svg')) continue;
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      out.push({ text: n.textContent.trim(), size: parseFloat(s.fontSize), color: s.color, box: { x: r.x, y: r.y, width: r.width, height: r.height } });
    }
    return out;
  });
  const { img, box: view } = await screenshot(page, '#chart figure');
  const colors = await resolveColors(page, raw.map(r => r.color));
  const s = img.width / view.width;
  return raw.map((r, i) => {
    const backdrop = modeColor(img, { x0: (r.box.x - view.x) * s, y0: (r.box.y - view.y) * s, x1: (r.box.x + r.box.width - view.x) * s, y1: (r.box.y + r.box.height - view.y) * s }).color;
    return { text: r.text, size: r.size, ratio: contrast(colors[i]!, backdrop) };
  });
}

/**
 * Painted colour of each shown series' marks (bar interiors, the middle of a line's first segment, points,
 * slices) against the chart's painted background: the figure's most frequent colour, so an area's own
 * translucent fill is not taken for the background. Device pixel ratio 2 keeps a 2 px stroke's core pure.
 */
async function markContrast(page: Page, type: ChartType): Promise<{ problems: string[]; checked: number }> {
  const { img, box: view } = await screenshot(page, '#chart figure');
  const backdrop = modeColor(img, { x0: 0, y0: 0, x1: img.width, y1: img.height }).color;
  const problems: string[] = [];
  let checked = 0;
  const drawn = await shapes(page, '#chart', 100000);
  for (const [slot, list] of Object.entries(drawn)) {
    let ink: RGB | null = null;
    if (type === 'line' || type === 'area' || type === 'compact') {
      const run = (await strokeRuns(page, Number(slot))).flat().sort((a, b) => a.x - b.x);
      // A hidden series keeps no stroke: nothing to measure for it.
      if (run.length < 2) continue;
      const mx = (run[0]!.x + run[1]!.x) / 2, my = (run[0]!.y + run[1]!.y) / 2;
      ink = inkColor(img, view, { x: mx - 1, y: my - 1, width: 2, height: 2 }, backdrop);
    } else {
      const b = list.map(s => s.box).sort((p, q) => q.width * q.height - p.width * p.height)[0];
      if (!b || b.width * b.height === 0) continue;
      ink = inkColor(img, view, b, backdrop);
    }
    if (!ink) { problems.push(`series ${slot}: no painted mark found`); continue; }
    checked++;
    if (contrast(ink, backdrop) < 3) problems.push(`series ${slot}: ${ink} is ${contrast(ink, backdrop).toFixed(2)}:1 on ${backdrop}`);
  }
  return { problems, checked };
}

describe('L2 text size and contrast', () => {
  for (const type of TYPES) {
    for (const scheme of ['light', 'dark'] as const) {
      it(`L2 ${type}: in the ${scheme} scheme every text is at least 12 CSS px and 4.5:1 on what is painted behind it (legend entries of hidden series included); marks${type === 'compact' ? '' : ', axis lines and the focus indicator'} are painted at least 3:1`, async () => {
        const page = await devPage({ deviceScaleFactor: 2, css: scheme === 'dark' ? DARK_PAGE : '' });
        await create(page, type, { subtitle: 'All sites' });
        if (type !== 'compact' && type !== 'donut') {
          await page.locator('#chart .axylo-legend-entry').first().click();
          await settle(page);
          await page.mouse.move(0, 0);
        }
        const texts = await textContrast(page);
        if (type !== 'compact') expect(texts.length).toBeGreaterThan(3);
        expect(texts.filter(t => t.size < 12 || t.ratio < 4.5).map(t => `"${t.text}" ${t.size}px ${t.ratio.toFixed(2)}:1`)).toEqual([]);
        const marks = await markContrast(page, type);
        expect(marks.problems).toEqual([]);
        expect(marks.checked).toBeGreaterThan(0);
        if (type !== 'donut' && type !== 'compact') {
          // The axis lines, as painted: each rule painted with the axis colour, sampled along its length.
          const axes = await page.evaluate(() => [...document.querySelectorAll<SVGLineElement>('#chart svg.axylo-svg .axylo-scene line')].filter(l => /--axylo-axis/.test(l.style.getPropertyValue('color'))).map(l => l.getBoundingClientRect().toJSON() as { x: number; y: number; width: number; height: number }));
          expect(axes.length).toBeGreaterThan(0);
          const { img, box: view } = await screenshot(page, '#chart .axylo-plot');
          const backdrop = modeColor(img, { x0: 0, y0: 0, x1: img.width, y1: img.height }).color;
          const long = axes.filter(a => Math.max(a.width, a.height) > 40);
          expect(long.length).toBeGreaterThan(0);
          for (const a of long) {
            const b: Box = a.width > a.height ? { x: a.x + a.width * 0.3, y: a.y - 1, width: a.width * 0.4, height: 2 } : { x: a.x - 1, y: a.y + a.height * 0.3, width: 2, height: a.height * 0.4 };
            const ink = inkColor(img, view, b, backdrop);
            expect(ink, `axis line at ${JSON.stringify(a)} painted`).not.toBeNull();
            expect(contrast(ink!, backdrop)).toBeGreaterThanOrEqual(3);
          }
        }
        if (type !== 'compact') {
          await page.focus('#before');
          await page.keyboard.press('Tab');
          await settle(page);
          const { img, box: view } = await screenshot(page, '#chart figure');
          const backdrop = modeColor(img, { x0: 0, y0: 0, x1: img.width, y1: img.height }).color;
          const o = await box(page, '#chart .axylo-focus-ring');
          const ink = inkColor(img, view, { x: o.x + o.width * 0.4, y: o.y + 1, width: o.width * 0.2, height: 2 }, backdrop);
          expect(ink, 'focus outline painted').not.toBeNull();
          expect(contrast(ink!, backdrop), 'focus indicator').toBeGreaterThanOrEqual(3);
        }
        expect(await closePage(page)).toEqual([]);
      });
    }
  }
});

// ── L3 ────────────────────────────────────────────────────────────────────────────────────────────

/** The drawn position of the fixture's third datum (the same in every type): a mark's centre, in viewport px. */
async function thirdDatum(page: Page, type: Full): Promise<{ x: number; y: number }> {
  // Donut: the middle of the first slice (Travel, 15 %, so 27° clockwise from 12 o'clock).
  if (type === 'donut') { const g = await ring(page); const a = (0.15 * Math.PI); return { x: g.cx + g.outer * 0.85 * Math.sin(a), y: g.cy - g.outer * 0.85 * Math.cos(a) }; }
  const marks = ((await shapes(page, '#chart', type === 'bar' ? 100000 : 14))[1] ?? []).map(s => center(s.box)).sort((a, b) => a.x - b.x);
  return marks[2]!;
}

describe('L3 the chart follows its container', () => {
  for (const type of FULL as Full[]) {
    it(`L3 ${type}: resized 720 → 360 → 720 px with no call from the page, the marks are redrawn for each width: a known datum sits at the same share of the plot, and pointing at it there shows it`, async () => {
      const page = await devPage();
      await create(page, type);
      const shares: number[][] = [];
      for (const w of [720, 360, 720]) {
        await setWidth(page, w);
        expect((await box(page, '#chart svg.axylo-svg')).width).toBeLessThanOrEqual(w + 0.5);
        const p = await box(page, '#chart .axylo-proxy');
        const d = await thirdDatum(page, type);
        shares.push([(d.x - p.x) / p.width, (d.y - p.y) / p.height]);
        await page.mouse.move(d.x, d.y + (type === 'donut' ? 4 : 0));
        await settle(page);
        const tip = (await page.locator('#chart .axylo-tooltip, #chart .axylo-readout').allTextContents()).join(' ');
        // The third mark by x: Mar 4 (line, area), Q3 (bar), EU's third point at 30 kB (scatter), the first slice (donut).
        const want = { line: 'Mar 4, 2026', area: 'Mar 4, 2026', bar: 'Q3', scatter: '30 kB', donut: 'Travel' }[type];
        expect(tip, `${w} px`).toContain(want);
        await page.mouse.move(0, 0);
      }
      // The datum keeps its place (for a donut, its angle on a ring that is re-centred, so the share of
      // the plot's width moves with the ring's size and only the return to 720 px is compared).
      if (type !== 'donut') expect(Math.abs(shares[1]![0]! - shares[0]![0]!)).toBeLessThan(0.03);
      expect(shares[2]).toEqual(shares[0]);
      expect(await closePage(page)).toEqual([]);
    });

    it(`L3 ${type}: with no definite height the plot is 16:9 of its width, clamped to 160–480 px, stable over 10 frames; an opened table flows in the figure and pushes nothing over the next element`, async () => {
      const page = await devPage({ viewport: { width: 1300, height: 1400 }, css: '#chart { height: auto; }' });
      await create(page, type);
      for (const w of [240, 720, 1200]) {
        await setWidth(page, w);
        const heights: number[] = [];
        for (let i = 0; i < 10; i++) { heights.push((await box(page, '#chart .axylo-plot')).height); await frames(page, 1); }
        const plot = await box(page, '#chart .axylo-plot');
        const expected = Math.min(480, Math.max(160, (plot.width * 9) / 16));
        expect(Math.abs(heights[0]! - expected), `${w} px wide`).toBeLessThanOrEqual(1);
        expect(new Set(heights.map(h => Math.round(h))).size).toBe(1);
      }
      await page.locator('#chart [role="toolbar"] button', { hasText: 'View as table' }).click();
      await settle(page);
      const fig = await box(page, '#chart figure');
      expect(inside(await box(page, '#chart .axylo-table'), fig)).toBe(true);
      const after = await box(page, '#after');
      expect(after.y).toBeGreaterThanOrEqual(fig.y + fig.height - 1);
      expect(await closePage(page)).toEqual([]);
    });

    it(`L3 ${type}: a container that starts hidden draws when it is shown, at the shown size`, async () => {
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
      await page.waitForFunction(() => [...document.querySelectorAll<SVGElement>('#chart svg.axylo-svg .axylo-scene *')].some(e => /--axylo-series-color-/.test(e.style.getPropertyValue('color'))), null, { timeout: 5000 }).catch(() => undefined);
      await settle(page);
      const p = await box(page, '#chart .axylo-proxy');
      expect(p.width).toBeGreaterThan(300);
      const d = await thirdDatum(page, type);
      expect(inside({ ...d, width: 0, height: 0 }, p, 8), 'the datum is drawn inside the shown plot').toBe(true);
      expect(await closePage(page)).toEqual([]);
    });
  }
});

// ── L4 ────────────────────────────────────────────────────────────────────────────────────────────

/** The colours the marks are painted with now: computed colour of each series' first scene element. */
async function markColors(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const seen = new Map<number, string>();
    for (const el of document.querySelectorAll<SVGElement>('#chart svg.axylo-svg .axylo-scene *')) {
      const m = /--axylo-series-color-(\d+)/.exec(el.style.getPropertyValue('color'));
      if (m && !seen.has(Number(m[1]))) seen.set(Number(m[1]), getComputedStyle(el).color);
    }
    return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]);
  });
}

/** The colours painted for the first series now (a screenshot), to confirm a scheme change reached the pixels. */
async function firstMarkPixel(page: Page, type: ChartType): Promise<RGB | null> {
  const { img, box: view } = await screenshot(page, '#chart figure');
  const backdrop = modeColor(img, { x0: 0, y0: 0, x1: img.width, y1: img.height }).color;
  const b = ((await shapes(page, '#chart', 100000))[1] ?? []).map(s => s.box).sort((p, q) => q.width * q.height - p.width * p.height)[0];
  if (b && type !== 'line' && type !== 'area' && type !== 'compact') return inkColor(img, view, b, backdrop);
  const run = (await strokeRuns(page, 1)).flat().sort((p, q) => p.x - q.x);
  if (run.length < 2) return null;
  const mx = (run[0]!.x + run[1]!.x) / 2, my = (run[0]!.y + run[1]!.y) / 2;
  return inkColor(img, view, { x: mx - 1, y: my - 1, width: 2, height: 2 }, backdrop);
}

/** Applies `change` in the page and returns the marks' computed colours in the first animation frame after it. */
async function firstFrameAfter(page: Page, change: string): Promise<string[]> {
  return page.evaluate(change => new Promise<string[]>(resolve => {
    // eslint-disable-next-line no-new-func
    new Function(change)();
    requestAnimationFrame(() => {
      const seen = new Map<number, string>();
      for (const el of document.querySelectorAll<SVGElement>('#chart svg.axylo-svg .axylo-scene *')) {
        const m = /--axylo-series-color-(\d+)/.exec(el.style.getPropertyValue('color'));
        if (m && !seen.has(Number(m[1]))) seen.set(Number(m[1]), getComputedStyle(el).color);
      }
      resolve([...seen.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]));
    });
  }), change);
}

describe('L4 scheme from the page', () => {
  for (const type of TYPES) {
    it(`L4 ${type}: the scheme is the chart element's computed color-scheme, not the text colour: dark scheme with dark text gives the dark marks, light scheme with light text the light marks; with no color-scheme, light text gives dark marks`, async () => {
      const light = await devPage();
      await create(light, type);
      const L = await markColors(light);
      await light.close();
      const dark = await devPage({ css: DARK_PAGE });
      await create(dark, type);
      const D = await markColors(dark);
      await dark.close();
      expect(D).not.toEqual(L);
      for (const [css, want, label] of [
        ['#chart { color-scheme: dark; color: #111; } body { background: #121212; }', D, 'scheme dark, dark text'],
        ['#chart { color-scheme: light; color: #eee; }', L, 'scheme light, light text'],
        ['#chart { color: #eee; } body { background: #121212; }', D, 'no scheme, light text'],
      ] as const) {
        const page = await devPage({ css });
        await create(page, type);
        expect(await markColors(page), label).toEqual(want);
        await closePage(page);
      }
    });

    it(`L4 ${type}: the marks have their new colours in the first frame after each trigger: a class, style or data-theme change on <html> or <body>, a prefers-color-scheme change, and the painted pixels follow`, async () => {
      const page = await devPage({ deviceScaleFactor: 2, css: '.dk { background: #121212; color: #e8e8e8; } html[data-theme="dark"] body, body[data-theme="dark"] { background: #121212; color: #e8e8e8; } #chart.follow { color-scheme: light dark; }' });
      await create(page, type);
      const L = await markColors(page);
      const triggers: [string, string, string][] = [
        ['class on <html>', "document.documentElement.classList.add('dk')", "document.documentElement.classList.remove('dk')"],
        ['class on <body>', "document.body.classList.add('dk')", "document.body.classList.remove('dk')"],
        ['style on <body>', "document.body.style.cssText = 'background:#121212;color:#e8e8e8'", "document.body.style.cssText = ''"],
        ['data-theme on <html>', "document.documentElement.dataset.theme = 'dark'", "delete document.documentElement.dataset.theme"],
        ['data-theme on <body>', "document.body.dataset.theme = 'dark'", "delete document.body.dataset.theme"],
      ];
      let D: string[] | null = null;
      for (const [label, on, off] of triggers) {
        const now = await firstFrameAfter(page, on);
        expect(now, `${label}: dark in the first frame`).not.toEqual(L);
        D ??= now;
        expect(now, label).toEqual(D);
        await settle(page);
        const pixel = await firstMarkPixel(page, type);
        const [want] = await resolveColors(page, [D[0]!]);
        expect(pixel, `${label}: painted`).not.toBeNull();
        expect(Math.max(...pixel!.map((v, i) => Math.abs(v - want![i]!)))).toBeLessThanOrEqual(24);
        expect(await firstFrameAfter(page, off), `${label} removed`).toEqual(L);
        await settle(page);
      }
      // A media change: a chart that follows the device (color-scheme: light dark) on a dark device.
      await page.evaluate(() => document.querySelector('#chart')!.classList.add('follow'));
      await settle(page);
      await page.emulateMedia({ colorScheme: 'dark' });
      await frames(page, 1);
      expect(await markColors(page), 'prefers-color-scheme: dark').toEqual(D);
      expect(await closePage(page)).toEqual([]);
    });

    it(`L4 ${type}: a light-only page on a dark device stays light, and --axylo-background overrides the detected scheme`, async () => {
      const page = await devPage();
      await create(page, type);
      const light = await markColors(page);
      await page.close();
      const device = await devPage({ colorScheme: 'dark' });
      await create(device, type);
      expect(await markColors(device)).toEqual(light);
      await closePage(device);
      const dark = await devPage({ css: DARK_PAGE });
      await create(dark, type);
      const darkMarks = await markColors(dark);
      await dark.close();
      const override = await devPage({ css: '#chart { --axylo-background: #101010; }' });
      await create(override, type);
      expect(await markColors(override)).toEqual(darkMarks);
      expect(await closePage(override)).toEqual([]);
    });

    it(`L4 ${type}: in forced-colors mode the marks are painted in system colours, also when it is switched on at run time`, async () => {
      const page = await devPage({ deviceScaleFactor: 2 });
      await create(page, type);
      await page.emulateMedia({ forcedColors: 'active' });
      await settle(page);
      const marks = await resolveColors(page, await markColors(page));
      expect(marks.length).toBeGreaterThan(0);
      const system = await resolveColors(page, ['CanvasText', 'Canvas', 'GrayText', 'Highlight', 'LinkText', 'ButtonText']);
      for (const m of marks) expect(system.some(s => s[0] === m[0] && s[1] === m[1] && s[2] === m[2]), `${m}`).toBe(true);
      const pixel = await firstMarkPixel(page, type);
      expect(pixel).not.toBeNull();
      expect(system.some(s => Math.max(...s.map((v, i) => Math.abs(v - pixel![i]!))) <= 24), `painted ${pixel}`).toBe(true);
      expect(await closePage(page)).toEqual([]);
    });
  }
});

// ── L5 ────────────────────────────────────────────────────────────────────────────────────────────

/** Creates `n` daily points and resizes the chart until adjacent points are `spacing` px apart (±0.25). */
async function spaced(page: Page, type: 'line' | 'area', n: number, spacing: number): Promise<number> {
  const day = (k: number) => new Date(Date.UTC(2026, 0, 1) + k * 864e5).toISOString().slice(0, 10);
  await createRaw(page, type, { title: 'Spacing', data: Array.from({ length: n }, (_, k) => ({ day: day(k), v: 10 + (k % 5) })), x: { field: 'day', type: 'date' }, y: 'v' });
  let width = 720;
  for (let i = 0; i < 6; i++) {
    const run = (await strokeRuns(page, 1)).flat().sort((a, b) => a.x - b.x);
    const now = (run.at(-1)!.x - run[0]!.x) / (n - 1);
    if (Math.abs(now - spacing) <= 0.25) return now;
    width += (spacing - now) * (n - 1);
    await setWidth(page, Math.round(width * 4) / 4);
  }
  const run = (await strokeRuns(page, 1)).flat().sort((a, b) => a.x - b.x);
  return (run.at(-1)!.x - run[0]!.x) / (n - 1);
}

describe('L5 point markers', () => {
  for (const type of ['line', 'area'] as const) {
    it(`L5 ${type}: points 11 px apart do not get a marker on every point; points 13 px apart do (the 12 px threshold bracketed); an isolated point always has one`, async () => {
      const markers = async (page: Page) => ((await shapes(page, '#chart', 14))[1] ?? []).length;
      for (const [gap, every] of [[11, false], [13, true]] as const) {
        const page = await devPage({ viewport: { width: 1400, height: 700 } });
        const got = await spaced(page, type, 40, gap);
        expect(Math.abs(got - gap), `spacing reached ${got}`).toBeLessThanOrEqual(0.25);
        const n = await markers(page);
        if (every) expect(n, `${got.toFixed(2)} px apart`).toBe(40);
        else expect(n, `${got.toFixed(2)} px apart`).toBeLessThan(40);
        await closePage(page);
      }
      const isolated = await devPage();
      const day = (k: number) => new Date(Date.UTC(2026, 0, 1) + k * 864e5).toISOString().slice(0, 10);
      // Dense, with one value alone between two gaps at day 60.
      await createRaw(isolated, type, { title: 'Isolated', data: Array.from({ length: 120 }, (_, k) => ({ day: day(k), v: k === 59 || k === 61 ? null : 10 + (k % 9) })), x: { field: 'day', type: 'date' }, y: 'v' });
      const runs = (await strokeRuns(isolated, 1));
      const xs = runs.flat().map(p => p.x).sort((a, b) => a - b);
      const at60 = xs[0]! + ((xs.at(-1)! - xs[0]!) * 60) / 119;
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

/** Records every text the chart puts into a live region (or inserts already populated), in order. */
async function recordAnnouncements(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { announced: string[] };
    w.announced = [];
    const politeness = (e: Element | null): string | null => {
      for (let a = e; a; a = a.parentElement) {
        const v = a.getAttribute('aria-live'), r = a.getAttribute('role');
        if (v === 'off') return null;
        if (v) return v;
        if (r === 'alert') return 'assertive';
        if (r === 'status' || r === 'log') return 'polite';
      }
      return null;
    };
    new MutationObserver(records => {
      for (const r of records) {
        const t = r.target.nodeType === Node.TEXT_NODE ? r.target.parentElement : (r.target as Element);
        const p = politeness(t);
        if (p && t?.closest('#chart') && (t.textContent ?? '').trim()) w.announced.push(`${p}: ${(t.closest('[aria-live],[role]') ?? t).textContent!.trim()}`);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
}
const announced = (page: Page) => page.evaluate(() => [...new Set((window as unknown as { announced: string[] }).announced)]);

/** The state message: visible, inside the plot, in the tree, and no tick labels or axis lines drawn. */
async function stateShown(page: Page, text: string): Promise<string[]> {
  const out: string[] = [];
  const message = page.locator('#chart .axylo-message');
  if (!(await message.isVisible())) return ['no state message shown'];
  const shown = ((await message.textContent()) ?? '').trim();
  if (shown !== text) out.push(`message "${shown}", expected "${text}"`);
  if (!inside(await box(page, '#chart .axylo-message'), await box(page, '#chart .axylo-plot'))) out.push('the message is not inside the plot');
  if (!(await axWithin(page, '#chart')).some(n => n.name.includes(text) || n.description.includes(text))) out.push('the message is not in the accessibility tree');
  if (await page.locator('#chart .axylo-label[data-role^="tick"]').count()) out.push('tick labels drawn');
  if (await page.evaluate(() => document.querySelectorAll('#chart svg.axylo-svg .axylo-scene line').length)) out.push('axis or grid lines drawn');
  return out;
}

/** Built-in state texts replaced, so each state's exact message is known from the test itself. */
const STATE_TEXT = { loading: 'Fetching the readings.', empty: 'Nothing was measured.', internalError: 'Drawing failed here.' };

describe('L7 states inside the plot', () => {
  for (const type of TYPES) {
    it(`L7 ${type}: empty data shows its message inside the plot and in the accessibility tree, with no tick labels and no invented axis`, async () => {
      const page = await devPage();
      await create(page, type, { data: [], messages: STATE_TEXT });
      expect(await stateShown(page, STATE_TEXT.empty)).toEqual([]);
      expect(await closePage(page)).toEqual([]);
    });

    it(`L7 ${type}: loading, an author error and an internal failure each show their exact message inside the plot with no axes; each change of state is announced exactly once, politely, and nothing else is`, async () => {
      const page = await devPage();
      await create(page, type, { state: 'loading', messages: STATE_TEXT });
      expect(await stateShown(page, STATE_TEXT.loading)).toEqual([]);
      await recordAnnouncements(page);
      await call(page, 'update', [{ state: 'ready' }]);
      const ready = await announced(page);
      expect(ready, 'loading → ready').toHaveLength(1);
      expect(ready[0]!.startsWith('polite: ')).toBe(true);
      expect(await page.locator('#chart .axylo-message').isVisible()).toBe(false);
      await recordAnnouncements(page);
      await call(page, 'update', [{ state: { error: 'The query failed.' } }]);
      expect(await stateShown(page, 'The query failed.')).toEqual([]);
      const error = await announced(page);
      expect(error, 'ready → error').toHaveLength(1);
      expect(error[0]).toMatch(/^polite: .*The query failed\./);
      await call(page, 'update', [{ state: 'ready' }]);
      await recordAnnouncements(page);
      await page.evaluate(() => (window as unknown as { charts: { __dev: { fail(s: string | null): void } }[] }).charts[0]!.__dev.fail('reader'));
      await call(page, 'update', [{ title: 'Again' }]);
      expect(await stateShown(page, STATE_TEXT.internalError)).toEqual([]);
      const failed = await announced(page);
      expect(failed, 'ready → internal failure').toHaveLength(1);
      expect(failed[0]).toMatch(new RegExp(`^polite: .*${STATE_TEXT.internalError.replace('.', '\\.')}`));
      expect(await closePage(page)).toEqual([]);
    });
  }
});

// ── L8 ────────────────────────────────────────────────────────────────────────────────────────────

const plotDrawn = (page: Page) => page.evaluate(() => [...document.querySelectorAll<SVGElement>('#chart svg.axylo-svg .axylo-scene *')].some(e => /--axylo-series-color-/.test(e.style.getPropertyValue('color'))));

describe('L8 too small for a plot', () => {
  for (const type of FULL as Full[]) {
    for (const axis of ['width', 'height'] as const) {
      it(`L8 ${type}: shrinking the container's ${axis} 1 px at a time, the plot is drawn while it is at least ${axis === 'width' ? 120 : 80} px and the fallback starts when it would be less: the title, the summary's first sentence on at most two lines (cut only with an ellipsis), the full summary as the description, the table control, and AX142`, async () => {
        const page = await devPage({ css: '#chart { width: 600px; height: 400px; }' });
        await create(page, type);
        // From a size with a plot, 1 px steps down until it gives way.
        let size = axis === 'width' ? 400 : 260;
        let last: Box | null = null;
        for (; size > 20; size--) {
          await page.evaluate(([a, s]) => { (document.querySelector('#chart') as HTMLElement).style[a as 'width' | 'height'] = `${s}px`; }, [axis, size] as const);
          await settle(page);
          if (!(await plotDrawn(page))) break;
          last = await box(page, '#chart .axylo-proxy');
        }
        expect(last, 'a plot was drawn before the fallback').not.toBeNull();
        const min = axis === 'width' ? 120 : 80;
        const at = axis === 'width' ? last!.width : last!.height;
        // The last drawn plot was at least the minimum, and the fallback did not come early (2 px: one step of the container plus rounding).
        expect(at, `last drawn plot ${axis}`).toBeGreaterThanOrEqual(min);
        expect(at, `last drawn plot ${axis}`).toBeLessThan(min + 2);
        const codes = await page.evaluate(() => (window as unknown as { charts: { diagnostics: { code: string; level: string }[] }[] }).charts[0]!.diagnostics.filter(d => d.code === 'AX142').map(d => d.level));
        expect(codes).toEqual(['hint']);
        expect(await page.locator('#chart .axylo-title').isVisible()).toBe(true);
        expect(await page.locator('#chart button', { hasText: 'View as table' }).isVisible()).toBe(true);
        // Spec L8 (as amended): a short summary, the first sentence of the generated summary, on at most two
        // lines, cut with an ellipsis beyond that (never clipped by overflow); the full summary stays the
        // figure's description.
        const summary = page.locator('#chart .axylo-summary');
        expect(await summary.isVisible()).toBe(true);
        const s = await summary.evaluate(el => {
          const c = getComputedStyle(el);
          const cut = el.scrollHeight > el.clientHeight + 0.5 || el.scrollWidth > el.clientWidth + 0.5;
          const ellipsis = c.textOverflow === 'ellipsis' || (c.webkitLineClamp !== 'none' && c.webkitLineClamp !== '' && c.webkitLineClamp !== undefined);
          return { text: el.textContent ?? '', lines: Math.round(el.getBoundingClientRect().height / parseFloat(c.lineHeight)), cut, ellipsis };
        });
        expect(s.lines, `"${s.text}"`).toBeLessThanOrEqual(2);
        if (s.cut) expect(s.ellipsis, `"${s.text}" is cut, so with an ellipsis`).toBe(true);
        expect(s.text).toMatch(new RegExp(`^${{ line: 'Line', area: 'Area', bar: 'Bar', scatter: 'Scatter', donut: 'Donut' }[type]} chart`));
        // Its first sentence only, and the full summary is what the figure's description carries.
        const description = (await axOf(page, '#chart figure')).description;
        const first = description.split(/(?<=\.)\s+/)[0]!;
        expect(s.text.trim()).toBe(first);
        expect(description.split(/(?<=\.)\s+/).length, 'the description holds the full summary').toBeGreaterThan(1);
        expect((await axOf(page, '#chart figure')).name).not.toBe('');
        expect(await closePage(page)).toEqual([]);
      });
    }
  }
});
