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
import { axWithin, backgroundColor, box, closePage, createRaw, devPage, distance, pixel, screenshot, settle, shapes, valueText } from './util';

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
async function inkIn(page: Page, x0: number, x1: number, y0: number, y1: number): Promise<number> {
  const { img, box: plot } = await screenshot(page, '#chart .axylo-plot');
  const bg = await backgroundColor(page);
  let n = 0;
  for (let y = Math.ceil(y0 - plot.y); y < y1 - plot.y; y++) for (let x = Math.ceil(x0 - plot.x); x < x1 - plot.x; x++) if (distance(pixel(img, x, y), bg) > 40) n++;
  return n;
}

describe('F2 gaps in lines and areas', () => {
  for (const type of ['line', 'area', 'compact'] as const) {
    it(`F2 ${type}: null values are gaps, never zero and never bridged, and the value isolated between two gaps is a visible point`, async () => {
      const page = await devPage({ css: `${NO_GRID} ${type === 'compact' ? '#chart { width: 240px; height: 60px; }' : ''}` });
      await createRaw(page, type === 'compact' ? 'line' : type, {
        title: 'Gaps', data: VALUES.map((v, x) => ({ x, v })), x: 'x', y: 'v', ...(type === 'compact' ? { compact: true } : {}),
      });
      // x positions from the drawn runs: points 0, 1, 5 and 6 are on the stroke, evenly spaced.
      const v = await vertices(page);
      expect(v.length).toBeGreaterThanOrEqual(4);
      const x0 = v[0]!.x, step = (v.at(-1)!.x - x0) / 6;
      const xs = VALUES.map((_, k) => x0 + k * step);
      // No vertex at x = 2 or x = 4 (not drawn as zero), none bridging them.
      for (const k of [2, 4]) expect(v.some(p => Math.abs(p.x - xs[k]!) < 1), `vertex at ${k}`).toBe(false);
      const svg = await box(page, '#chart svg.axylo-svg');
      const top = svg.y, bottom = type === 'compact' ? svg.y + svg.height : (await box(page, '#chart .axylo-proxy')).y + (await box(page, '#chart .axylo-proxy')).height - 3;
      const margin = 7;
      expect(await inkIn(page, xs[1]! + margin, xs[3]! - margin, top, bottom), 'between x = 1 and 3').toBe(0);
      expect(await inkIn(page, xs[3]! + margin, xs[5]! - margin, top, bottom), 'between x = 3 and 5').toBe(0);
      // The isolated value at x = 3 is drawn.
      expect(await inkIn(page, xs[3]! - 4, xs[3]! + 4, top, bottom), 'at x = 3').toBeGreaterThan(4);
      expect(await closePage(page)).toEqual([]);
    });

    it(`F2 ${type}: on a regular date axis, explicit nulls and the same rows deleted render the same gap, and the deleted rows raise AX105`, async () => {
      const page = await devPage({ viewport: { width: 900, height: 1100 }, css: `${NO_GRID} #other { width: 720px; height: 400px; } ${type === 'compact' ? '#chart, #other { width: 240px; height: 60px; }' : ''}` });
      await page.evaluate(() => { const el = document.createElement('div'); el.id = 'other'; document.querySelector('#after')!.after(el); });
      const day = (k: number) => new Date(Date.UTC(2026, 0, 1) + k * 864e5).toISOString().slice(0, 10);
      const full = Array.from({ length: 20 }, (_, k) => ({ day: day(k), v: 10 + ((k * 7) % 11) }));
      const withNulls = full.map((r, k) => (k >= 8 && k <= 10 ? { ...r, v: null } : r));
      const deleted = full.filter((_, k) => k < 8 || k > 10);
      const common = { title: 'Same gap', x: { field: 'day', type: 'date' }, y: 'v', ...(type === 'compact' ? { compact: true } : {}) };
      const fn = type === 'compact' ? 'line' : type;
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
      expect(await closePage(page)).toEqual([]);
    });
  }
});

describe('F2 bars', () => {
  it('F2 bar: a missing bar shows a "no data" mark at the baseline, distinct from a zero bar and from an empty band', async () => {
    const page = await devPage({ css: NO_GRID });
    await createRaw(page, 'bar', { title: 'Missing and zero', data: [{ q: 'Q1', v: 10 }, { q: 'Q2', v: null }, { q: 'Q3', v: 0 }, { q: 'Q4', v: 20 }], x: 'q', y: 'v' });
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

  it('F2 scatter: a point with a missing y is not drawn (never at zero) and the keyboard skips it', async () => {
    const page = await devPage();
    await createRaw(page, 'scatter', { title: 'Missing', data: [{ x: 1, y: 5 }, { x: 2, y: null }, { x: 3, y: 7 }], x: 'x', y: 'y' });
    const drawn = (await shapes(page, '#chart', 14))[1] ?? [];
    expect(drawn).toHaveLength(2);
    await page.focus('#chart .axylo-proxy');
    expect(await valueText(page)).toMatch(/of 2\b/);
    expect(await closePage(page)).toEqual([]);
  });

  it('F2 donut: a null slice is not drawn and the table reads "No data" for it', async () => {
    const page = await devPage();
    await createRaw(page, 'donut', { title: 'Missing', data: [{ l: 'A', v: 3 }, { l: 'B', v: null }, { l: 'C', v: 1 }], label: 'l', value: 'v' });
    await page.locator('#chart [role="toolbar"] button', { hasText: 'View as table' }).click();
    await settle(page);
    const rows = await page.locator('#chart table tbody tr').allInnerTexts();
    expect(rows[1]).toContain('No data');
    expect(rows[1]).not.toMatch(/\d/);
    expect(await closePage(page)).toEqual([]);
  });
});
