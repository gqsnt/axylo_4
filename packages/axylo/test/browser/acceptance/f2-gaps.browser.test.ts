/**
 * F2, rendered (spec 3.1): missing values are never drawn as zero and never bridged; an isolated value
 * between two gaps is a visible point; a missing bar shows a "no data" mark distinct from a zero bar;
 * explicit nulls and deleted rows on a regular date axis render the same gap (AX105); readouts say
 * "No data". Gaps are read from screenshots with the gridlines made transparent through the public
 * `--axylo-grid` property, so any non-background pixel in a gap is a drawn mark.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { start, stop } from '../harness';
import { axWithin, backgroundColor, box, center, closePage, createRaw, devPage, distance, pixel, plotGeometry, readTable, resolveColors, ring, screenshot, settle, shapes, valueText } from './util';

beforeAll(start);
afterAll(stop);

const NO_GRID = '#chart, #other { --axylo-grid: transparent; }';

/** Values over x = 0…6: gaps at 2 and 4, so 3 is isolated between two gaps. */
const VALUES = [10, 20, null, 40, null, 60, 70];

/** Vertices of each stroked series line, in viewport px, sorted by x. */
async function vertices(page: Page, selector = '#chart'): Promise<{ x: number; y: number }[]> {
  return page.evaluate(selector => {
    const svg = document.querySelector(`${selector} svg.axylo-svg`) as SVGSVGElement;
    const m = svg.getScreenCTM()!;
    const out: { x: number; y: number }[] = [];
    for (const el of svg.querySelectorAll<SVGPathElement>('.axylo-scene path')) {
      if (!/--axylo-series-color-1\b/.test(el.style.getPropertyValue('color')) || el.style.getPropertyValue('stroke') !== 'currentcolor') continue;
      const nums = (el.getAttribute('d') ?? '').match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
      for (let i = 0; i + 1 < nums.length; i += 2) { const p = new DOMPoint(nums[i]!, nums[i + 1]!).matrixTransform(m); out.push({ x: p.x, y: p.y }); }
    }
    return out.sort((a, b) => a.x - b.x);
  }, selector);
}

/** Non-background pixels in the columns [x0, x1) and rows [y0, y1) of the plot screenshot (viewport px). */
async function inkIn(page: Page, x0: number, x1: number, y0: number, y1: number, selector = '#chart'): Promise<number> {
  const { img, box: plot } = await screenshot(page, `${selector} .axylo-plot`);
  const bg = await backgroundColor(page, selector);
  let n = 0;
  for (let y = Math.ceil(y0 - plot.y); y < y1 - plot.y; y++) for (let x = Math.ceil(x0 - plot.x); x < x1 - plot.x; x++) if (distance(pixel(img, x, y), bg) > 40) n++;
  return n;
}

describe('F2 gaps in lines and areas', () => {
  for (const type of ['line', 'area', 'compact', 'compact area'] as const) {
    // compact is compact line; compact area takes the same data, drawn as an area.
    const compact = type === 'compact' || type === 'compact area';
    const fn = type === 'compact' ? 'line' : type === 'compact area' ? 'area' : type;
    it(`F2 ${type}: null values are gaps, never zero and never bridged, and the value isolated between two gaps is a visible point`, async () => {
      const page = await devPage({ css: `${NO_GRID} ${compact ? '#chart { width: 240px; height: 60px; }' : ''}` });
      await createRaw(page, fn, {
        title: 'Gaps', data: VALUES.map((v, x) => ({ x, v })), x: 'x', y: 'v', ...(compact ? { compact: true } : {}),
      });
      // x positions from the drawn runs: points 0, 1, 5 and 6 are on the stroke, evenly spaced.
      const v = await vertices(page);
      expect(v.length).toBeGreaterThanOrEqual(4);
      const x0 = v[0]!.x, step = (v.at(-1)!.x - x0) / 6;
      const xs = VALUES.map((_, k) => x0 + k * step);
      // No vertex at x = 2 or x = 4 (not drawn as zero), none bridging them.
      for (const k of [2, 4]) expect(v.some(p => Math.abs(p.x - xs[k]!) < 1), `vertex at ${k}`).toBe(false);
      const svg = await box(page, '#chart svg.axylo-svg');
      const top = svg.y, bottom = compact ? svg.y + svg.height : (await box(page, '#chart .axylo-proxy')).y + (await box(page, '#chart .axylo-proxy')).height - 3;
      const margin = 7;
      expect(await inkIn(page, xs[1]! + margin, xs[3]! - margin, top, bottom), 'between x = 1 and 3').toBe(0);
      expect(await inkIn(page, xs[3]! + margin, xs[5]! - margin, top, bottom), 'between x = 3 and 5').toBe(0);
      // The isolated value at x = 3 is drawn.
      expect(await inkIn(page, xs[3]! - 4, xs[3]! + 4, top, bottom), 'at x = 3').toBeGreaterThan(4);
      expect(await closePage(page)).toEqual([]);
    });

    it(`F2 ${type}: on a regular date axis, explicit nulls and the same rows deleted render the same gap, and the deleted rows raise AX105`, async () => {
      const page = await devPage({ viewport: { width: 900, height: 1100 }, css: `${NO_GRID} #other { width: 720px; height: 400px; } ${compact ? '#chart, #other { width: 240px; height: 60px; }' : ''}` });
      await page.evaluate(() => { const el = document.createElement('div'); el.id = 'other'; document.querySelector('#after')!.after(el); });
      const day = (k: number) => new Date(Date.UTC(2026, 0, 1) + k * 864e5).toISOString().slice(0, 10);
      const full = Array.from({ length: 20 }, (_, k) => ({ day: day(k), v: 10 + ((k * 7) % 11) }));
      const withNulls = full.map((r, k) => (k >= 8 && k <= 10 ? { ...r, v: null } : r));
      const deleted = full.filter((_, k) => k < 8 || k > 10);
      const common = { title: 'Same gap', x: { field: 'day', type: 'date' }, y: 'v', ...(compact ? { compact: true } : {}) };
      const a = await createRaw(page, fn, { ...common, data: withNulls }, '#chart');
      const b = await createRaw(page, fn, { ...common, data: deleted }, '#other');
      expect(a.diagnostics.map(d => d.code)).not.toContain('AX105');
      expect(b.diagnostics.map(d => d.code)).toContain('AX105');
      // The same drawing: identical mark geometry in both plots (the same pixels follow from it; a pixel
      // comparison of two places on the page also measures the rasteriser, so it is not used).
      const scene = (sel: string) => page.evaluate(sel => [...document.querySelectorAll(`${sel} .axylo-scene path, ${sel} .axylo-scene rect`)].map(e => e.getAttribute('d') ?? `${e.getAttribute('x')},${e.getAttribute('y')},${e.getAttribute('width')},${e.getAttribute('height')}`), sel);
      const drawn = await scene('#chart');
      expect(drawn.length).toBeGreaterThan(0);
      expect(await scene('#other')).toEqual(drawn);
      // And each, on its own, leaves days 8–10 undrawn: no vertex there, no ink between day 7 and day 11.
      for (const sel of ['#chart', '#other']) {
        const v = await vertices(page, sel);
        const x0 = v[0]!.x, step = (v.at(-1)!.x - x0) / 19;
        for (const k of [8, 9, 10]) expect(v.some(p => Math.abs(p.x - (x0 + k * step)) < 1), `${sel}: vertex at day ${k}`).toBe(false);
        const svg = await box(page, `${sel} svg.axylo-svg`);
        const top = svg.y, bottom = compact ? svg.y + svg.height : (await box(page, `${sel} .axylo-proxy`)).y + (await box(page, `${sel} .axylo-proxy`)).height - 3;
        expect(await inkIn(page, x0 + 7 * step + 7, x0 + 11 * step - 7, top, bottom, sel), `${sel}: ink in the gap`).toBe(0);
      }
      expect(await closePage(page)).toEqual([]);
    });
  }
});

describe("F2 missing: 'zero'", () => {
  for (const type of ['line', 'area', 'bar', 'compact', 'compact area', 'compact bar'] as const) {
    const compact = type.startsWith('compact');
    const fn = type === 'compact' ? 'line' : type === 'compact area' ? 'area' : type === 'compact bar' ? 'bar' : type;
    it(`F2 ${type}: with missing: 'zero' on the field, an explicit null and an absent step are drawn at zero, on the zero baseline`, async () => {
      const page = await devPage({ css: `${NO_GRID} ${compact ? '#chart { width: 240px; height: 60px; }' : ''}` });
      const day = (k: number) => new Date(Date.UTC(2026, 0, 1) + k * 864e5).toISOString().slice(0, 10);
      // Daily counts; day 2 is null and day 4 has no row.
      const data = [5, 6, null, 7, undefined, 8, 9].flatMap((v, k) => (v === undefined ? [] : [{ day: day(k), v }]));
      await createRaw(page, fn, { title: 'Counts', data, x: { field: 'day', type: 'date' }, y: { field: 'v', missing: 'zero' }, ...(compact ? { compact: true } : {}) });
      if (fn === 'bar') {
        const rects = ((await shapes(page, '#chart', 100000))[1] ?? []).map(s => s.box).sort((a, b) => a.x - b.x);
        // Seven bands; at days 2 and 4 nothing rises above the baseline (a zero bar, not a gap mark).
        const tall = rects.filter(r => r.height > 1.5);
        expect(tall).toHaveLength(5);
      } else {
        const v = await vertices(page);
        expect(v).toHaveLength(7);
        const zero = Math.max(...v.map(p => p.y));
        // The lowest vertices are the two zeros, at the bottom of a value axis that starts at zero.
        const sorted = [...v].sort((a, b) => b.y - a.y);
        expect(Math.abs(sorted[0]!.y - zero)).toBeLessThan(0.01);
        expect(Math.abs(sorted[1]!.y - zero)).toBeLessThan(0.01);
        expect([sorted[0]!, sorted[1]!].map(p => v.indexOf(p)).sort()).toEqual([2, 4]);
        if (!compact) {
          const plot = await box(page, '#chart .axylo-proxy');
          expect(Math.abs(zero - (plot.y + plot.height))).toBeLessThanOrEqual(1);
        }
      }
      expect(await closePage(page)).toEqual([]);
    });
  }
});

describe('F2 bars', () => {
  for (const compact of [false, true]) {
  it(compact ? 'F2 compact bar: a missing bar shows a "no data" mark at the baseline, distinct from a zero bar (C2)' : 'F2 bar: a missing bar shows a "no data" mark at the baseline, distinct from a zero bar and from an empty band', async () => {
    const page = await devPage({ css: `${NO_GRID} ${compact ? '#chart { width: 240px; height: 60px; }' : ''}` });
    await createRaw(page, 'bar', { title: 'Missing and zero', data: [{ q: 'Q1', v: 10 }, { q: 'Q2', v: null }, { q: 'Q3', v: 0 }, { q: 'Q4', v: 20 }], x: 'q', y: 'v', ...(compact ? { compact: true } : {}) });
    const rects = ((await shapes(page, '#chart', 100000))[1] ?? []).map(s => s.box).filter(b => b.height > 2).sort((a, b) => a.x - b.x);
    expect(rects).toHaveLength(2);
    const c1 = rects[0]!.x + rects[0]!.width / 2, c4 = rects[1]!.x + rects[1]!.width / 2;
    const step = (c4 - c1) / 3, half = rects[0]!.width / 2;
    const baseline = rects[0]!.y + rects[0]!.height;
    const patch = async (center: number) => {
      const { img, box: plot } = await screenshot(page, '#chart .axylo-plot');
      const out: number[] = [];
      for (let y = Math.round(baseline - plot.y - 14); y < baseline - plot.y - 1; y++) for (let x = Math.round(center - half - plot.x); x < center + half - plot.x; x++) out.push(...pixel(img, x, y));
      return out;
    };
    const missing = await patch(c1 + step), zero = await patch(c1 + 2 * step);
    const bg = await backgroundColor(page);
    const ink = (p: number[]) => { let n = 0; for (let i = 0; i < p.length; i += 3) if (distance([p[i]!, p[i + 1]!, p[i + 2]!], bg) > 40) n++; return n; };
    expect(ink(missing), 'the missing bar has a visible mark above the axis line').toBeGreaterThan(4);
    let differing = 0;
    for (let i = 0; i < missing.length; i += 3) if (distance([missing[i]!, missing[i + 1]!, missing[i + 2]!], [zero[i]!, zero[i + 1]!, zero[i + 2]!]) > 40) differing++;
    expect(differing, 'the missing and zero bars look different').toBeGreaterThan(4);
    expect(await closePage(page)).toEqual([]);
  });
  }
});

describe('F2 readouts say "No data"', () => {
  for (const type of ['line', 'area', 'bar'] as const) {
    it(`F2 ${type}: the tooltip, the table and the keyboard read "No data" at the missing value, and the zero next to it as 0`, async () => {
      const page = await devPage();
      const data = type === 'bar'
        ? [{ q: 'Q1', v: 10 }, { q: 'Q2', v: null }, { q: 'Q3', v: 0 }, { q: 'Q4', v: 20 }]
        : [{ q: '2026-03-02', v: 10 }, { q: '2026-03-03', v: null }, { q: '2026-03-04', v: 0 }, { q: '2026-03-05', v: 20 }];
      await createRaw(page, type, { title: 'Missing', data, x: type === 'bar' ? 'q' : { field: 'q', type: 'date' }, y: { field: 'v', label: 'Count' } });
      await page.focus('#chart .axylo-proxy');
      await page.keyboard.press('ArrowRight');
      expect(await valueText(page)).toContain('No data');
      await page.keyboard.press('ArrowRight');
      const zero = await valueText(page);
      expect(zero).not.toContain('No data');
      expect(zero).toMatch(/\b0\b/);
      await page.keyboard.press('ArrowLeft');
      expect(await page.locator('#chart .axylo-tooltip').textContent()).toContain('No data');
      await page.locator('#chart [role="toolbar"] button', { hasText: 'View as table' }).click();
      await settle(page);
      const cells = (await axWithin(page, '#chart table')).filter(n => n.role === 'cell').map(n => n.name);
      expect(cells).toEqual(['10', 'No data', '0', '20']);
      expect(await closePage(page)).toEqual([]);
    });
  }

  it('F2 scatter: a point with a missing y is not drawn (never at zero): the two drawn points are the ones at (1, 5) and (3, 7); the table lists the missing row as "No data"; the keyboard skips it', async () => {
    const page = await devPage();
    await createRaw(page, 'scatter', { title: 'Missing', data: [{ x: 1, y: 5 }, { x: 2, y: null }, { x: 3, y: 7 }, { x: 0, y: 0 }, { x: 4, y: 10 }], x: { field: 'x', domain: [0, 4] }, y: { field: 'y', domain: [0, 10] } });
    const g = await plotGeometry(page);
    const at = (x: number, y: number) => ({ x: g.plot.x + ((x - g.xDomain![0]!) / (g.xDomain![1]! - g.xDomain![0]!)) * g.plot.width, y: g.plot.y + (1 - (y - g.yDomain![0]!) / (g.yDomain![1]! - g.yDomain![0]!)) * g.plot.height });
    const drawn = ((await shapes(page, '#chart', 14))[1] ?? []).map(s => center(s.box));
    const near = (p: { x: number; y: number }) => drawn.some(d => Math.hypot(d.x - p.x, d.y - p.y) <= 2);
    expect(near(at(1, 5)), 'point (1, 5)').toBe(true);
    expect(near(at(3, 7)), 'point (3, 7)').toBe(true);
    expect(near(at(2, 0)), 'nothing at (2, 0)').toBe(false);
    expect(drawn.filter(d => Math.abs(d.x - at(2, 0).x) <= 2)).toEqual([]);
    await page.focus('#chart .axylo-proxy');
    expect(await valueText(page)).toMatch(/of 4\b/);
    await page.locator('#chart [role="toolbar"] button', { hasText: 'View as table' }).click();
    await settle(page);
    const rows = (await readTable(page)).rows.map(r => [r.header, ...r.cells]);
    // x, series (one series, named by the y field), y (tableOf('scatter') columns).
    expect(rows.find(r => r[0] === '2')).toEqual(['2', 'y', 'No data']);
    expect(await closePage(page)).toEqual([]);
  });

  it('F2 donut: a null slice is not drawn (A fills three quarters from 12 o\'clock, C the last quarter) and the table reads "No data" for it', async () => {
    const page = await devPage();
    await createRaw(page, 'donut', { title: 'Missing', data: [{ l: 'A', v: 3 }, { l: 'B', v: null }, { l: 'C', v: 1 }], label: 'l', value: 'v' });
    const { img, box: plot } = await screenshot(page, '#chart .axylo-plot');
    const g = await ring(page);
    const legend = await resolveColors(page, await page.locator('#chart ul.axylo-legend-list > li svg.axylo-swatch').evaluateAll(els => els.map(e => getComputedStyle(e).color)));
    const sample = (deg: number) => { const a = (deg * Math.PI) / 180; return pixel(img, g.cx - plot.x + 0.85 * g.outer * Math.sin(a), g.cy - plot.y - 0.85 * g.outer * Math.cos(a)); };
    expect(distance(sample(135), legend[0]!), 'A at 135°').toBeLessThanOrEqual(24);
    expect(distance(sample(315), legend[2]!), 'C at 315°').toBeLessThanOrEqual(24);
    expect(await page.evaluate(() => document.querySelectorAll('#chart svg.axylo-svg .axylo-scene path').length)).toBe(2);
    await page.locator('#chart [role="toolbar"] button', { hasText: 'View as table' }).click();
    await settle(page);
    const rows = await page.locator('#chart table tbody tr').allInnerTexts();
    expect(rows[1]).toContain('No data');
    expect(rows[1]).not.toMatch(/\d/);
    expect(await closePage(page)).toEqual([]);
  });
});
