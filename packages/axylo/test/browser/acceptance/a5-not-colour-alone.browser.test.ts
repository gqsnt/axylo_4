/**
 * A5: series are never distinguished by colour alone, in any mode (spec 3.4). Shape markers on lines and
 * areas (last point and sparse intervals), repeated in legend and tooltip; dash under more contrast and
 * forced colours; at least 1 px of background between adjacent filled marks; the palette's contrast and
 * OKLab distances measured on the colours Chrome resolved for the rendered marks; AX141 on a background the
 * palette does not suit; and a grayscale screenshot in which three crossing lines are told apart by marker.
 * Colours are never hard-coded: they are read from the page.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { start, stop } from '../harness';
import {
  backgroundColor, box, center, defaultBackground, ring, closePage, contrast, createRaw, create, devPage, distance, pixel, screenshot, seriesColors, settle, shapes, signature,
  type Image, type RGB, type Shape,
} from './util';
import { TYPES, type ChartType } from './fixtures';
import { gray, minimumDistance, VISIONS } from './vision';

beforeAll(start);
afterAll(stop);

/** 120 calendar days, three series: denser than a marker per point allows (spec L5), so markers are sparse. */
function denseRows(): Record<string, unknown>[] {
  const day = (k: number) => new Date(Date.UTC(2026, 0, 1) + k * 864e5).toISOString().slice(0, 10);
  const f = [(k: number) => 50 + 30 * Math.sin(k / 9), (k: number) => 50 + 30 * Math.cos(k / 11), (k: number) => 20 + k / 4];
  return ['Alpha', 'Beta', 'Gamma'].flatMap((s, i) => Array.from({ length: 120 }, (_, k) => ({ day: day(k), s, v: Math.round(f[i]!(k)) })));
}

/** The last vertex of each stroked line, per colour slot, in viewport px. */
async function lastVertices(page: Page): Promise<Record<number, { x: number; y: number }>> {
  return page.evaluate(() => {
    const svg = document.querySelector('#chart svg.axylo-svg') as SVGSVGElement;
    const m = svg.getScreenCTM()!;
    const out: Record<number, { x: number; y: number }> = {};
    for (const el of svg.querySelectorAll<SVGPathElement>('.axylo-scene path')) {
      const slot = /--axylo-series-color-(\d+)/.exec(el.style.getPropertyValue('color'));
      if (!slot || el.style.getPropertyValue('stroke') !== 'currentcolor') continue;
      const nums = (el.getAttribute('d') ?? '').match(/-?\d*\.?\d+/g)!.map(Number);
      let best = { x: -Infinity, y: 0 };
      for (let i = 0; i + 1 < nums.length; i += 2) if (nums[i]! > best.x) best = { x: nums[i]!, y: nums[i + 1]! };
      const p = new DOMPoint(best.x, best.y).matrixTransform(m);
      out[Number(slot[1])] = { x: p.x, y: p.y };
    }
    return out;
  });
}

/** The marker signatures in the legend (in entry order) and in the tooltip rows (in row order). */
async function swatchSignatures(page: Page, where: '.axylo-legend-entry' | '.axylo-tooltip-row'): Promise<string[]> {
  const ds = await page.locator(`#chart ${where}`).evaluateAll(els => els.map(e => e.querySelector('.axylo-swatch-marker')?.getAttribute('d') ?? ''));
  return ds.map(d => (d ? signature(d.split(/(?=M)/)[0]!) : ''));
}

const mostCommon = (list: Shape[]): string => {
  const n = new Map<string, number>();
  for (const s of list) n.set(signature(s.sub), (n.get(signature(s.sub)) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
};

describe('A5 markers repeat the series identity', () => {
  for (const type of ['line', 'area'] as const) {
    it(`A5 ${type}: each of three dense series carries a shape marker at its last point and at sparse intervals; the shapes differ by series and are repeated in the legend and the tooltip`, async () => {
      const page = await devPage();
      await createRaw(page, type, { title: 'Dense', data: denseRows(), x: { field: 'day', type: 'date' }, y: 'v', series: 's' });
      const drawn = await shapes(page, '#chart', 14);
      const ends = await lastVertices(page);
      const plotSigs: string[] = [];
      for (const slot of [1, 2, 3]) {
        const marks = drawn[slot] ?? [];
        // The last point, plus at least one more at an interval along the series.
        expect(marks.length, `markers of series ${slot}`).toBeGreaterThanOrEqual(2);
        const last = marks.map(m => center(m.box)).sort((a, b) => b.x - a.x)[0]!;
        expect(Math.abs(last.x - ends[slot]!.x), `series ${slot} last marker x`).toBeLessThanOrEqual(3);
        expect(Math.abs(last.y - ends[slot]!.y), `series ${slot} last marker y`).toBeLessThanOrEqual(3);
        // Sparse: fewer markers than points (120), spread over the series rather than bunched at its end.
        expect(marks.length).toBeLessThan(120);
        const xs = marks.map(m => center(m.box).x);
        expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan((await box(page, '#chart .axylo-proxy')).width / 3);
        plotSigs.push(mostCommon(marks));
      }
      expect(new Set(plotSigs).size, JSON.stringify(plotSigs)).toBe(3);
      expect(await swatchSignatures(page, '.axylo-legend-entry')).toEqual(plotSigs);
      const plot = await box(page, '#chart .axylo-proxy');
      await page.mouse.move(plot.x + plot.width / 2, plot.y + plot.height / 2);
      await settle(page);
      expect(await swatchSignatures(page, '.axylo-tooltip-row')).toEqual(plotSigs);
      expect(await closePage(page)).toEqual([]);
    });
  }

  it('A5 scatter: each series is drawn with its own point shape, repeated in the legend and in the tooltip of each point', async () => {
    const page = await devPage();
    await create(page, 'scatter');
    const drawn = await shapes(page, '#chart', 14);
    const sigs = [mostCommon(drawn[1] ?? []), mostCommon(drawn[2] ?? [])];
    expect(sigs[0]).not.toBe('');
    expect(sigs[0]).not.toBe(sigs[1]);
    expect(await swatchSignatures(page, '.axylo-legend-entry')).toEqual(sigs);
    for (const slot of [1, 2]) {
      // Hover the middle point of the series (the ends sit on the plot edge).
      const marks = (drawn[slot] ?? []).map(s => center(s.box)).sort((a, b) => a.x - b.x);
      const p = marks[1]!;
      await page.mouse.move(p.x, p.y);
      await settle(page);
      const tip = await swatchSignatures(page, '.axylo-tooltip-row');
      expect(tip.length).toBeGreaterThan(0);
      expect(tip[0]).toBe(sigs[slot - 1]);
    }
    expect(await closePage(page)).toEqual([]);
  });

  it('A5 compact: two compact series differ by dash as well as colour, with no legend to tell them apart', async () => {
    const page = await devPage({ css: '#chart { width: 240px; height: 48px; }' });
    await createRaw(page, 'line', { compact: true, title: 'Two', data: denseRows().filter(r => r.s !== 'Gamma'), x: { field: 'day', type: 'date' }, y: 'v', series: 's' });
    const dashes = await strokeDashes(page);
    expect(dashes).toHaveLength(2);
    expect(dashes[0]).not.toBe(dashes[1]);
    expect(await closePage(page)).toEqual([]);
  });
});

/** The computed dash of each stroked series line, in slot order. */
async function strokeDashes(page: Page, selector = '#chart'): Promise<string[]> {
  return page.evaluate(selector => {
    const out: [number, string][] = [];
    for (const el of document.querySelectorAll<SVGPathElement>(`${selector} svg.axylo-svg .axylo-scene path`)) {
      const slot = /--axylo-series-color-(\d+)/.exec(el.style.getPropertyValue('color'));
      if (!slot || el.style.getPropertyValue('stroke') !== 'currentcolor') continue;
      out.push([Number(slot[1]), getComputedStyle(el).strokeDasharray]);
    }
    return out.sort((a, b) => a[0] - b[0]).map(e => e[1]);
  }, selector);
}

describe('A5 dash under more contrast and forced colours', () => {
  for (const type of ['line', 'area', 'compact'] as const) {
    for (const mode of ['prefers-contrast: more', 'forced-colors: active'] as const) {
      it(`A5 ${type}: under ${mode} three lines differ by dash, pairwise`, async () => {
        const page = await devPage(type === 'compact' ? { css: '#chart { width: 240px; height: 48px; }' } : {});
        await page.emulateMedia(mode === 'prefers-contrast: more' ? { contrast: 'more' } : { forcedColors: 'active' });
        await createRaw(page, 'line' === type || type === 'compact' ? 'line' : 'area', {
          title: 'Three', data: denseRows(), x: { field: 'day', type: 'date' }, y: 'v', series: 's', ...(type === 'compact' ? { compact: true } : {}),
        });
        const dashes = await strokeDashes(page);
        expect(dashes).toHaveLength(3);
        expect(new Set(dashes).size, JSON.stringify(dashes)).toBe(3);
        expect(await closePage(page)).toEqual([]);
      });
    }
  }
});

// ── separators between adjacent filled marks ──────────────────────────────────────────────────────

/**
 * Walks `points` (image px) and, wherever the colour changes from one mark colour to another, sums how
 * much background the pixels in between show (reading of "at least 1 px of background" on an anti-aliased
 * raster: the background coverage of the pixels between two marks adds up to at least 0.75 px, which a
 * 1 px gap at any sub-pixel offset meets and two touching marks do not). A pixel's background coverage is
 * its projection onto the line from the nearest mark colour to the background.
 */
function separated(img: Image, points: { x: number; y: number }[], colors: readonly RGB[], bg: RGB, tolerance = 24): { transitions: number; touching: number; at: { x: number; y: number; coverage: number }[] } {
  const nearest = (c: RGB): { k: number; d: number } => {
    let best = { k: -1, d: Infinity };
    colors.forEach((m, k) => { const d = distance(c, m); if (d < best.d) best = { k, d }; });
    return best;
  };
  let last = -1, coverage = 0, transitions = 0, touching = 0;
  const at: { x: number; y: number; coverage: number }[] = [];
  let prev = '';
  for (const p of points) {
    if (p.x < 0 || p.y < 0 || p.x >= img.width || p.y >= img.height) continue;
    const key = `${Math.floor(p.x)},${Math.floor(p.y)}`;
    if (key === prev) continue;
    prev = key;
    const c = pixel(img, p.x, p.y);
    const n = nearest(c);
    if (n.d <= tolerance) {
      if (last >= 0 && n.k !== last) {
        transitions++;
        if (coverage < 0.75) { touching++; at.push({ ...p, coverage }); }
      }
      last = n.k;
      coverage = 0;
      continue;
    }
    const m = colors[n.k]!;
    const w = [bg[0] - m[0], bg[1] - m[1], bg[2] - m[2]];
    const q = [c[0] - m[0], c[1] - m[1], c[2] - m[2]];
    const len = w[0]! * w[0]! + w[1]! * w[1]! + w[2]! * w[2]! || 1;
    coverage += Math.min(1, Math.max(0, (q[0]! * w[0]! + q[1]! * w[1]! + q[2]! * w[2]!) / len));
  }
  return { transitions, touching, at };
}

const vertical = (x: number, y0: number, y1: number) => Array.from({ length: Math.ceil(y1 - y0) }, (_, i) => ({ x, y: y0 + i }));
const horizontal = (y: number, x0: number, x1: number) => Array.from({ length: Math.ceil(x1 - x0) }, (_, i) => ({ x: x0 + i, y }));

describe('A5 separators', () => {
  it('A5 bar: stacked segments are separated by at least 1 px of background, in every stack (reading: anti-aliased background coverage summed, at least 0.75 px)', async () => {
    const page = await devPage();
    await create(page, 'bar', { layout: 'stacked' });
    const { img, box: plot } = await screenshot(page, '#chart .axylo-plot');
    const colors = await seriesColors(page);
    const bg = await backgroundColor(page);
    const drawn = await shapes(page, '#chart', 100000);
    const stacks = (drawn[1] ?? []).map(s => s.box);
    expect(stacks).toHaveLength(4);
    // Geometry first: the segment above starts at least 1 px above where the one below ends.
    const above = (drawn[2] ?? []).map(s => s.box).sort((a, b) => a.x - b.x);
    [...stacks].sort((a, b) => a.x - b.x).forEach((below, i) => expect(below.y - (above[i]!.y + above[i]!.height), `stack ${i + 1} gap`).toBeGreaterThanOrEqual(1 - 0.01));
    for (const s of stacks) {
      const x = Math.round(s.x + s.width / 2 - plot.x);
      const r = separated(img, vertical(x, 0, img.height), colors, bg);
      expect(r.transitions, `stack at ${x}`).toBeGreaterThanOrEqual(1);
      expect(r.touching, `stack at ${x}: ${JSON.stringify(r.at)}`).toBe(0);
    }
    expect(await closePage(page)).toEqual([]);
  });

  it('A5 bar: grouped bars of different series are separated by at least 1 px of background (reading: two touching bars are adjacent filled marks)', async () => {
    const page = await devPage();
    await create(page, 'bar');
    const { img, box: plot } = await screenshot(page, '#chart .axylo-plot');
    const colors = await seriesColors(page);
    const bg = await backgroundColor(page);
    const drawn = await shapes(page, '#chart', 100000);
    const plan = (drawn[1] ?? []).map(s => s.box).sort((a, b) => a.x - b.x);
    const actual = (drawn[2] ?? []).map(s => s.box).sort((a, b) => a.x - b.x);
    expect(plan).toHaveLength(4);
    for (let i = 0; i < 4; i++) {
      // Just above the baseline, where both bars of the group are drawn.
      const y = Math.round(Math.min(plan[i]!.y + plan[i]!.height, actual[i]!.y + actual[i]!.height) - plot.y - 3);
      const r = separated(img, horizontal(y, plan[i]!.x - plot.x, actual[i]!.x + actual[i]!.width - plot.x), colors, bg);
      expect(r.transitions).toBe(1);
      expect(r.touching, `group ${i + 1}: ${JSON.stringify(r.at)}`).toBe(0);
    }
    expect(await closePage(page)).toEqual([]);
  });

  it('A5 area: stacked areas are separated by at least 1 px of background along a vertical through the stack (reading: stacked areas are stacked segments)', async () => {
    const page = await devPage();
    await create(page, 'area', {}, '#chart', 'stacked');
    const { img } = await screenshot(page, '#chart .axylo-plot');
    const colors = await seriesColors(page);
    const bg = await backgroundColor(page);
    const plot = await box(page, '#chart .axylo-proxy');
    const plotBox = await box(page, '#chart .axylo-plot');
    for (const share of [0.3, 0.5, 0.7]) {
      const x = Math.round(plot.x - plotBox.x + plot.width * share);
      const r = separated(img, vertical(x, plot.y - plotBox.y, plot.y - plotBox.y + plot.height), colors, bg);
      expect(r.transitions).toBeGreaterThanOrEqual(1);
      expect(r.touching, `x at ${share}`).toBe(0);
    }
    expect(await closePage(page)).toEqual([]);
  });

  it('A5 donut: adjacent slices are separated by at least 1 px of background at every boundary of the ring (reading: anti-aliased background coverage summed, at least 0.75 px)', async () => {
    const page = await devPage();
    await create(page, 'donut');
    const { img, box: plot } = await screenshot(page, '#chart .axylo-plot');
    const colors = await seriesColors(page);
    const bg = await backgroundColor(page);
    const g = await ring(page);
    const cx = g.cx - plot.x, cy = g.cy - plot.y, outer = g.outer;
    // Around the ring at 85 % of the outer radius, one point per 1/8 px of arc.
    const r = outer * 0.85;
    const n = Math.ceil(2 * Math.PI * r * 8);
    const path = Array.from({ length: n + 1 }, (_, i) => {
      const a = (i / n) * 2 * Math.PI;
      return { x: Math.round(cx + r * Math.sin(a)), y: Math.round(cy - r * Math.cos(a)) };
    });
    const result = separated(img, path, colors, bg);
    expect(result.transitions).toBeGreaterThanOrEqual(3);
    expect(result.touching, JSON.stringify(result.at)).toBe(0);
    expect(await closePage(page)).toEqual([]);
  });
});

// ── palette ───────────────────────────────────────────────────────────────────────────────────────

/** Eight series (or slices) of the type, so the whole default palette is drawn. */
function eight(type: ChartType): { fn: string; options: Record<string, unknown> } {
  const names = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'];
  if (type === 'donut') return { fn: 'donut', options: { title: 'Eight', data: names.map((n, i) => ({ n, v: 10 + i })), label: 'n', value: 'v' } };
  if (type === 'scatter') return { fn: 'scatter', options: { title: 'Eight', data: names.flatMap((s, i) => [1, 2, 3].map(x => ({ x: x + i / 10, y: i + x, s }))), x: 'x', y: 'y', series: 's' } };
  const data = names.flatMap((s, i) => ['A', 'B', 'C'].map((x, k) => ({ x, s, y: 10 + i + k })));
  return { fn: type === 'compact' ? 'line' : type, options: { title: 'Eight', data, x: 'x', y: 'y', series: 's', ...(type === 'compact' ? { compact: true } : {}) } };
}

describe('A5 palette', () => {
  for (const type of TYPES) {
    for (const scheme of ['light', 'dark'] as const) {
      it(`A5 ${type}: the eight rendered colours (${scheme} scheme) are each at least 3:1 on the background and at least 0.10 apart in OKLab under normal vision and simulated protanopia, deuteranopia and tritanopia`, async () => {
        const page = await devPage({ css: scheme === 'dark' ? '#chart { color-scheme: dark; }' : '' });
        const { fn, options } = eight(type);
        await createRaw(page, fn, options);
        const colors = await seriesColors(page);
        expect(colors).toHaveLength(8);
        // The default background of the scheme the chart resolved (spec A5: "the default light and dark backgrounds").
        const bg = await defaultBackground(page);
        colors.forEach((c, i) => expect(contrast(c, bg), `series ${i + 1} ${c} on ${bg}`).toBeGreaterThanOrEqual(3));
        for (const vision of VISIONS) {
          const m = minimumDistance(colors, vision);
          expect(m.distance, `${vision}: series ${m.pair[0] + 1} and ${m.pair[1] + 1}`).toBeGreaterThanOrEqual(0.1);
        }
        expect(await closePage(page)).toEqual([]);
      });
    }

    it(`A5 ${type}: on a background the palette does not suit (the first series colour itself), AX141 is raised`, async () => {
      const page = await devPage();
      const { fn, options } = eight(type);
      await createRaw(page, fn, options);
      const [first] = await seriesColors(page);
      await page.evaluate(([r, g, b]) => (document.querySelector('#chart') as HTMLElement).style.setProperty('--axylo-background', `rgb(${r}, ${g}, ${b})`), first!);
      await settle(page);
      const codes = await page.evaluate(() => (window as unknown as { charts: { diagnostics: { code: string }[] }[] }).charts[0]!.diagnostics.map(d => d.code));
      expect(codes).toContain('AX141');
      expect(await closePage(page)).toEqual([]);
    });
  }
});

// ── grayscale ─────────────────────────────────────────────────────────────────────────────────────

describe('A5 grayscale', () => {
  it('A5 line: in a grayscale screenshot three crossing lines are told apart by the marker at their last point (reading: the binarised markers, compared at their centres, overlap by at most 85 % of their union)', async () => {
    const page = await devPage({ deviceScaleFactor: 2 });
    // The lines cross in the middle; the last step rises by 10 on all three, so each marker is reached by
    // the same stroke and only the marker can differ.
    const values = { A: [10, 20, 40, 60, 70, 75, 78, 80, 90], B: [50, 50, 50, 50, 50, 50, 45, 40, 50], C: [90, 80, 60, 40, 20, 10, 5, 0, 10] };
    const data = Object.entries(values).flatMap(([s, v]) => v.map((y, x) => ({ x, s, y })));
    await createRaw(page, 'line', { title: 'Crossing', data, x: 'x', y: 'y', series: 's' });
    const { img, box: plotBox } = await screenshot(page, '#chart .axylo-plot');
    const scale = img.width / plotBox.width;
    const bgGray = gray(await backgroundColor(page));
    const drawn = await shapes(page, '#chart', 14);
    const masks: boolean[][] = [];
    const R = Math.round(8 * scale);
    for (const slot of [1, 2, 3]) {
      const last = (drawn[slot] ?? []).map(s => center(s.box)).sort((a, b) => b.x - a.x)[0];
      expect(last, `marker of series ${slot}`).toBeDefined();
      const cx = Math.round((last!.x - plotBox.x) * scale), cy = Math.round((last!.y - plotBox.y) * scale);
      const mask: boolean[] = [];
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) mask.push(Math.abs(gray(pixel(img, cx + dx, cy + dy)) - bgGray) > 40);
      masks.push(mask);
    }
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        let both = 0, either = 0;
        masks[i]!.forEach((v, k) => { if (v && masks[j]![k]) both++; if (v || masks[j]![k]) either++; });
        expect(both / either, `series ${i + 1} and ${j + 1}`).toBeLessThanOrEqual(0.85);
      }
    }
    expect(await closePage(page)).toEqual([]);
  });
});
