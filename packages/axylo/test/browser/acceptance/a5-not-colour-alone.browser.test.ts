/**
 * A5: series are never distinguished by colour alone, in any mode (spec 3.4). Shape markers on lines and
 * areas (last point and sparse intervals), repeated in legend and tooltip; dash under more contrast and
 * forced colours (computed style); at least 1 px of background between adjacent filled marks, measured on
 * painted pixels against a 1 px control drawn in the same page; the palette's contrast and OKLab
 * distances measured on painted mark pixels and their painted backdrop; AX141 on a background the
 * palette does not suit; and a grayscale screenshot in which three crossing lines are told apart by marker.
 * Colours are never hard-coded: they are read from the page.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { ENGINE, start, stop } from '../harness';
import {
  box, center, closePage, createRaw, create, devPage, interiorColor, modeColor, ring, screenshot, settle, shapes, signature,
  type Box, type Image, type RGB, type Shape,
} from './util';
import { SPEND, TYPES } from './fixtures';
import { barPatterns, controlCoverage, eight, markerClasses, paintedSeries, paletteProblems, scanLine, seams, strokeRuns } from './checks';

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
    // As well as colour: the two lines are painted in different colours.
    const colors = await strokeColors(page);
    expect(colors).toHaveLength(2);
    expect(colors[0], 'the two lines\' colours').not.toEqual(colors[1]);
    expect(await closePage(page)).toEqual([]);
  });
});

/** The resolved colour of each stroked series line, in slot order. */
async function strokeColors(page: Page, selector = '#chart'): Promise<string[]> {
  return page.evaluate(selector => {
    const out: [number, string][] = [];
    for (const el of document.querySelectorAll<SVGPathElement>(`${selector} svg.axylo-svg .axylo-scene path`)) {
      const slot = /--axylo-series-color-(\d+)/.exec(el.style.getPropertyValue('color'));
      if (!slot || el.style.getPropertyValue('stroke') !== 'currentcolor') continue;
      out.push([Number(slot[1]), getComputedStyle(el).color]);
    }
    return out.sort((a, b) => a[0] - b[0]).map(e => e[1]);
  }, selector);
}

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
  for (const type of ['line', 'area', 'compact', 'compact area'] as const) {
    // compact is compact line; compact area takes the same three series, drawn as areas.
    const compact = type === 'compact' || type === 'compact area';
    for (const mode of ['prefers-contrast: more', 'forced-colors: active'] as const) {
      it(`A5 ${type}: under ${mode} three lines differ by dash, pairwise`, async () => {
        const media = mode === 'prefers-contrast: more' ? { contrast: 'more' as const } : { forcedColors: 'active' as const };
        // Playwright's Firefox flips matchMedia for an emulated contrast but leaves the media rules of a sheet
        // already loaded unevaluated (observed with a plain <style> page too), so on Firefox the preference is
        // set on the context, before the page loads. The chart is created after it either way.
        const early = ENGINE === 'firefox' && 'contrast' in media;
        const page = await devPage({ ...(compact ? { css: '#chart { width: 240px; height: 48px; }' } : {}), ...(early ? media : {}) });
        if (!early) await page.emulateMedia(media);
        await createRaw(page, 'line' === type || type === 'compact' ? 'line' : 'area', {
          title: 'Three', data: denseRows(), x: { field: 'day', type: 'date' }, y: 'v', series: 's', ...(compact ? { compact: true } : {}),
        });
        const dashes = await strokeDashes(page);
        expect(dashes).toHaveLength(3);
        expect(new Set(dashes).size, JSON.stringify(dashes)).toBe(3);
        expect(await closePage(page)).toEqual([]);
      });
    }
  }
});

describe('A5 compact bar patterns in every mode', () => {
  for (const mode of ['default', 'prefers-contrast: more', 'forced-colors: active'] as const) {
    it(`A5 compact bar: ${mode === 'default' ? 'by default' : `under ${mode}`} neighbouring bar series differ by fill pattern, with no legend to tell them apart`, async () => {
      const media = mode === 'prefers-contrast: more' ? { contrast: 'more' as const } : mode === 'forced-colors: active' ? { forcedColors: 'active' as const } : null;
      const early = media !== null && ENGINE === 'firefox' && 'contrast' in media;
      const page = await devPage({ css: '#chart { width: 280px; height: 60px; }', ...(early ? media : {}) });
      if (media && !early) await page.emulateMedia(media);
      const days = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05'];
      const data = days.flatMap((day, i) => ['Alpha', 'Beta', 'Gamma'].map((s, k) => ({ day, s, v: 10 + i + 3 * k })));
      await createRaw(page, 'bar', { compact: true, title: 'Three', data, x: { field: 'day', type: 'date' }, y: 'v', series: 's' });
      const patterns = await barPatterns(page);
      expect(patterns, 'three bar series').toHaveLength(3);
      for (const p of patterns) expect(p, 'one fill per series').toHaveLength(1);
      expect(patterns[0], 'first and second series').not.toEqual(patterns[1]);
      expect(patterns[1], 'second and third series').not.toEqual(patterns[2]);
      expect(await closePage(page)).toEqual([]);
    });
  }
});

// ── separators between adjacent filled marks ──────────────────────────────────────────────────────

/**
 * Checks one seam both ways: its geometry where the drawing gives it (`gap`, CSS px), and its painted
 * pixels scanned across it, against the coverage a 1 px control gap reaches in this page at the same angle.
 * Returns a description of each failure (empty when the seam is a full 1 px of background).
 */
async function seamProblems(page: Page, img: Image, view: Box, scale: number, at: { x: number; y: number }, normal: { x: number; y: number }, colors: readonly [RGB, RGB], bg: RGB, label: string): Promise<string[]> {
  const angle = Math.atan2(normal.y, normal.x) - Math.PI / 2;
  const floor = await controlCoverage(page, colors, bg, 1, angle);
  const found = seams(img, scanLine({ x: (at.x - view.x) * scale, y: (at.y - view.y) * scale }, normal, 12 * scale), colors, bg);
  const crossing = found.filter(f => f.from !== f.to);
  if (crossing.length !== 1) return [`${label}: ${crossing.length} colour changes across the seam, expected 1`];
  // 0.02 of rounding between two rasterisations of the same geometry; the nominal gap stays 1 px.
  return crossing[0]!.coverage + 0.02 < floor ? [`${label}: ${crossing[0]!.coverage.toFixed(2)} px of background, the 1 px control gives ${floor.toFixed(2)}`] : [];
}

/** The painted colour of a bar from its interior. */
const barColor = (img: Image, view: Box, b: Box): RGB => interiorColor(img, view, b, 2).color;

describe('A5 separators', () => {
  it('A5 bar: stacked segments are separated by at least 1 px of background in every stack: geometry, and painted pixels against a 1 px control', async () => {
    const page = await devPage();
    await create(page, 'bar', { layout: 'stacked' });
    const { img, box: view, scale } = await screenshot(page, '#chart .axylo-plot');
    const bg = modeColor(img, { x0: 0, y0: 0, x1: img.width, y1: img.height }).color;
    const drawn = await shapes(page, '#chart', 100000);
    const below = (drawn[1] ?? []).map(s => s.box).sort((a, b) => a.x - b.x);
    const above = (drawn[2] ?? []).map(s => s.box).sort((a, b) => a.x - b.x);
    expect(below).toHaveLength(4);
    expect(above).toHaveLength(4);
    const problems: string[] = [];
    for (let i = 0; i < 4; i++) {
      const gap = below[i]!.y - (above[i]!.y + above[i]!.height);
      // SVG coordinates are written to 0.01 px (render/svg.ts), so two rounded edges may sit 0.01 px closer.
      if (gap < 1 - 0.011) problems.push(`stack ${i + 1}: geometric gap ${gap.toFixed(3)} px`);
      const at = { x: below[i]!.x + below[i]!.width / 2, y: below[i]!.y - gap / 2 };
      problems.push(...await seamProblems(page, img, view, scale, at, { x: 0, y: 1 }, [barColor(img, view, above[i]!), barColor(img, view, below[i]!)], bg, `stack ${i + 1}`));
    }
    expect(problems).toEqual([]);
    expect(await closePage(page)).toEqual([]);
  });

  for (const horizontal of [false, true]) {
    it(`A5 bar: grouped bars of different series are separated by at least 1 px of background${horizontal ? ' (horizontal bars)' : ''}: geometry, and painted pixels against a 1 px control`, async () => {
      const page = await devPage();
      await create(page, 'bar', horizontal ? { horizontal: true } : {});
      const { img, box: view, scale } = await screenshot(page, '#chart .axylo-plot');
      const bg = modeColor(img, { x0: 0, y0: 0, x1: img.width, y1: img.height }).color;
      const drawn = await shapes(page, '#chart', 100000);
      const key = (b: Box) => (horizontal ? b.y : b.x);
      const plan = (drawn[1] ?? []).map(s => s.box).sort((a, b) => key(a) - key(b));
      const actual = (drawn[2] ?? []).map(s => s.box).sort((a, b) => key(a) - key(b));
      expect(plan).toHaveLength(4);
      const problems: string[] = [];
      for (let i = 0; i < 4; i++) {
        const [first, second] = key(plan[i]!) < key(actual[i]!) ? [plan[i]!, actual[i]!] : [actual[i]!, plan[i]!];
        const gap = horizontal ? second.y - (first.y + first.height) : second.x - (first.x + first.width);
        if (gap < 1 - 0.011) problems.push(`group ${i + 1}: geometric gap ${gap.toFixed(3)} px`);
        // Across the seam, near the baseline where both bars are drawn.
        const at = horizontal ? { x: Math.min(first.x + first.width, second.x + second.width) - 4, y: first.y + first.height + gap / 2 }
          : { x: first.x + first.width + gap / 2, y: Math.min(first.y + first.height, second.y + second.height) - 4 };
        problems.push(...await seamProblems(page, img, view, scale, at, horizontal ? { x: 0, y: 1 } : { x: 1, y: 0 }, [barColor(img, view, first), barColor(img, view, second)], bg, `group ${i + 1}`));
      }
      expect(problems).toEqual([]);
      expect(await closePage(page)).toEqual([]);
    });
  }

  it('A5 area: stacked areas are separated by at least 1 px of background, measured across the boundary (reading: stacked areas are stacked segments)', async () => {
    const page = await devPage();
    await create(page, 'area', {}, '#chart', 'stacked');
    const { img, box: view, scale } = await screenshot(page, '#chart .axylo-plot');
    const bg = modeColor(img, { x0: 0, y0: 0, x1: img.width, y1: img.height }).color;
    // The boundary between the two stacked areas is the lower series' upper edge (its stroke).
    const runs = await strokeRuns(page, 1);
    const line = runs.flat().sort((a, b) => a.x - b.x);
    expect(line.length).toBeGreaterThanOrEqual(5);
    const problems: string[] = [];
    for (const share of [0.3, 0.5, 0.7]) {
      const x = line[0]!.x + share * (line.at(-1)!.x - line[0]!.x);
      const k = line.findIndex(p => p.x >= x);
      const a = line[k - 1]!, b = line[k]!;
      const y = a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
      const normal = { x: -(b.y - a.y), y: b.x - a.x };
      if (normal.y < 0) { normal.x = -normal.x; normal.y = -normal.y; }
      // The two fills either side, sampled 6 px off the boundary along the normal.
      const n = Math.hypot(normal.x, normal.y);
      const side = (d: number) => modeColor(img, { x0: (x + (normal.x / n) * d - view.x) * scale - 1, y0: (y + (normal.y / n) * d - view.y) * scale - 1, x1: (x + (normal.x / n) * d - view.x) * scale + 2, y1: (y + (normal.y / n) * d - view.y) * scale + 2 }).color;
      problems.push(...await seamProblems(page, img, view, scale, { x, y }, normal, [side(-6), side(6)], bg, `x at ${share}`));
    }
    expect(problems).toEqual([]);
    expect(await closePage(page)).toEqual([]);
  });

  it('A5 donut: each of the four seams of the ring, the closing one at 12 o\'clock included, is at least 1 px of background against a 1 px control at the same angle', async () => {
    const page = await devPage();
    await create(page, 'donut');
    const { img, box: view, scale } = await screenshot(page, '#chart .axylo-plot');
    const bg = modeColor(img, { x0: 0, y0: 0, x1: img.width, y1: img.height }).color;
    const g = await ring(page);
    const total = SPEND.values.reduce((a, b) => a + b, 0);
    const r = g.outer * 0.85;
    const point = (theta: number) => ({ x: g.cx + r * Math.sin(theta), y: g.cy - r * Math.cos(theta) });
    const colorAt = (theta: number) => { const p = point(theta); return modeColor(img, { x0: (p.x - view.x) * scale - 2, y0: (p.y - view.y) * scale - 2, x1: (p.x - view.x) * scale + 3, y1: (p.y - view.y) * scale + 3 }).color; };
    const problems: string[] = [];
    let before = 0;
    const mids = SPEND.values.map(v => { const m = (2 * Math.PI * (before + v / 2)) / total; before += v; return m; });
    before = 0;
    for (let i = 0; i < SPEND.values.length; i++) {
      // The seam after slice i; the last one closes the ring at 12 o'clock.
      before += SPEND.values[i]!;
      const theta = (2 * Math.PI * before) / total;
      const tangent = { x: Math.cos(theta), y: Math.sin(theta) };
      problems.push(...await seamProblems(page, img, view, scale, point(theta), tangent, [colorAt(mids[i]!), colorAt(mids[(i + 1) % mids.length]!)], bg, `seam after ${SPEND.items[i]}`));
    }
    expect(problems).toEqual([]);
    expect(await closePage(page)).toEqual([]);
  });
});

// ── palette, on painted pixels ────────────────────────────────────────────────────────────────────

describe('A5 palette', () => {
  for (const type of TYPES) {
    for (const scheme of ['light', 'dark'] as const) {
      it(`A5 ${type}: the eight painted colours (${scheme} scheme) are each at least 3:1 on their painted backdrop and at least 0.10 apart in OKLab under normal vision and simulated protanopia, deuteranopia and tritanopia, analytic and as an 8-bit image`, async () => {
        const page = await devPage({ deviceScaleFactor: type === 'scatter' ? 4 : 2, css: type === 'compact' ? '#chart { height: 200px; }' : '' });
        const { fn, options } = eight(type);
        await createRaw(page, fn, options);
        if (scheme === 'dark') {
          // The default dark background, painted by the page behind a chart whose computed scheme is dark.
          await page.evaluate(() => {
            const c = document.querySelector('#chart') as HTMLElement;
            c.style.colorScheme = 'dark';
          });
          await settle(page);
          await page.evaluate(() => {
            const fig = document.querySelector('#chart figure')!;
            // The token may be a light-dark() pair, so it is resolved where the chart's scheme applies: a probe
            // inside the figure painted with it, whose computed colour is then given to the page.
            const probe = document.createElement('div');
            probe.style.background = 'var(--axylo-default-background)';
            fig.appendChild(probe);
            document.body.style.background = getComputedStyle(probe).backgroundColor;
            probe.remove();
          });
          await settle(page);
        }
        const painted = await paintedSeries(page, type);
        expect(painted.problems).toEqual([]);
        expect(painted.colors).toHaveLength(8);
        expect(paletteProblems(painted.colors, painted.backdrop)).toEqual([]);
        expect(await closePage(page)).toEqual([]);
      });
    }

    it(`A5 ${type}: on a background the palette does not suit (the first series' painted colour itself), AX141 is raised`, async () => {
      const page = await devPage({ deviceScaleFactor: 2, css: type === 'compact' ? '#chart { height: 200px; }' : '' });
      const { fn, options } = eight(type);
      await createRaw(page, fn, options);
      const [first] = (await paintedSeries(page, type)).colors;
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
  it('A5 line: in grayscale, each of three crossing traces\' last-point marker has the shape class of its legend marker and differs from the other two by shape class (whether a reader can follow the crossing lines remains a human judgement)', async () => {
    const page = await devPage({ deviceScaleFactor: 4 });
    const values = { A: [10, 20, 40, 60, 70, 75, 78, 80, 90], B: [50, 50, 50, 50, 50, 50, 45, 40, 50], C: [90, 80, 60, 40, 20, 10, 5, 0, 10] };
    const data = Object.entries(values).flatMap(([s, v]) => v.map((y, x) => ({ x, s, y })));
    await createRaw(page, 'line', { title: 'Crossing', data, x: 'x', y: 'y', series: 's' });
    const { plot, legend } = await markerClasses(page);
    expect(plot.every(c => c !== 'none'), JSON.stringify(plot)).toBe(true);
    expect(legend).toEqual(plot);
    expect(new Set(plot).size, JSON.stringify(plot)).toBe(3);
    expect(await closePage(page)).toEqual([]);
  });
});
