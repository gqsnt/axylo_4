/**
 * N8b bubble chart in Chrome, built from source (the package has no `axylo/spatial` entry until the Director
 * wires it): size legend beside the series legend, containment picking of a small bubble inside a large one of
 * another series (hover and click), tooltip, keyboard and table reading the same (x, y, size), zoom, axe-core
 * in light, dark and forced colors, single-series legend refresh and cleanup, and the SVG node bound at 50,000.
 *
 * Bubble positions are read from the committed geometry (`bubbleInternals(chart).geometry`: centres and radii
 * from the scales, not from the lookup that is under test). The painted picture is checked against the
 * painter's order with Chrome's own fill test (`SVGGeometryElement.isPointInFill`, nonzero rule) on each series
 * path, the mouse away from the plot (no hover overlay). Expected text comes from the fixture and en-US
 * formatting.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { ENGINE, openEntry, start, stop } from '../harness';
import { axe } from '../a11y/util';
import { closePage } from './util';
import { startWithShortTmp, stopWithShortTmp } from '../acceptance/short-tmp';

// A deep runner TMPDIR (a workspace-local one included) is too long for Chrome's socket on Linux; see
// acceptance/short-tmp.ts.
beforeAll(() => startWithShortTmp(start, { engine: ENGINE }));
afterAll(() => stopWithShortTmp(stop));

const ENTRY = 'packages/axylo/test/spatial/bubble/bubble.entry.ts';

declare global {
  interface Window {
    chart: ReturnType<Window['n8b']['bubble']>;
    selected: unknown[];
  }
}

/** Fixture: series "Large" holds one big disc at the plot's centre; "Small" a small one inside it, plus edges. */
const NESTED = [
  { gdp: 50, life: 70, pop: 1000, region: 'Large' },
  { gdp: 52, life: 70, pop: 4, region: 'Small' },
  { gdp: 0, life: 50, pop: 100, region: 'Large' },
  { gdp: 100, life: 90, pop: 9, region: 'Small' },
  { gdp: 20, life: 80, pop: 250, region: 'Third' },
];

async function frames(page: Page, n = 3): Promise<void> {
  await page.evaluate(async n => {
    for (let i = 0; i < n; i++) await new Promise(r => requestAnimationFrame(() => r(null)));
  }, n);
}

/** Waits, frame by frame, until bubble paths are drawn (the first frame may still be measuring the container). */
async function drawn(page: Page): Promise<void> {
  const ok = await page.evaluate(async () => {
    for (let i = 0; i < 240; i++) {
      if (document.querySelector('#chart svg.axylo-svg .axylo-scene path[data-bubble]')) return true;
      await new Promise(r => requestAnimationFrame(() => r(null)));
    }
    return false;
  });
  expect(ok).toBe(true);
  await frames(page, 2);
}

async function open(options: Record<string, unknown>, context: Parameters<typeof openEntry>[1] = {}): Promise<Page> {
  const page = await openEntry(ENTRY, context);
  await page.evaluate(options => {
    window.selected = [];
    window.chart = window.n8b.bubble('#chart', options as never);
    window.chart.on('select', p => { window.selected.push(p); });
  }, options);
  await drawn(page);
  return page;
}

const BASE = {
  title: 'Life expectancy by GDP', data: NESTED, x: { field: 'gdp', label: 'GDP', unit: 'k$' }, y: { field: 'life', label: 'Life', unit: 'years' },
  size: { field: 'pop', label: 'Population', unit: 'M' }, series: 'region',
};

interface Circle { series: number; cx: number; cy: number; r: number; row: number }

/** Every drawn bubble in viewport px (r 0: a zero marker), from the committed geometry. */
async function circles(page: Page): Promise<Circle[]> {
  return page.evaluate(() => {
    const svg = document.querySelector('#chart svg.axylo-svg')!;
    const box = svg.getBoundingClientRect();
    const g = window.n8b.bubbleInternals(window.chart)!.geometry!;
    return Array.from({ length: g.count }, (_, b) => ({ series: g.series[b]!, cx: box.x + g.x[b]!, cy: box.y + g.y[b]!, r: g.r[b]!, row: g.row[b]! }));
  });
}

/**
 * The unhovered picture: at sample points (random, and 0.3 px inside and outside every disc edge), exactly the
 * series that the painter's order puts on top fills its path, by Chrome's own nonzero fill test. The expected
 * owner: discs painted largest first (equal radii by source row), each opaque in its series colour with a 1 px
 * unpainted ring, a zero size a 1 px ring at radius 3 with an unpainted band each side; points within 0.1 px of
 * an edge are skipped. Returns the mismatches.
 */
async function pictureMismatches(page: Page, samples = 3000): Promise<string[]> {
  await page.mouse.move(1, 1);
  await frames(page);
  return page.evaluate(samples => {
    const g = window.n8b.bubbleInternals(window.chart)!.geometry!;
    const svg = document.querySelector<SVGSVGElement>('#chart svg.axylo-svg')!;
    const paths = [...svg.querySelectorAll<SVGPathElement>('.axylo-scene path[data-bubble="series"]')];
    const order = Array.from({ length: g.count }, (_, i) => i).sort((a, b) => (g.r[b]! - g.r[a]!) || (g.row[a]! - g.row[b]!) || (g.series[a]! - g.series[b]!));
    const bands = (b: number) => g.r[b] === 0 ? { edges: [1.5, 2.5, 3.5, 4.5], paint: [-1, g.series[b]!, -1] } : { edges: [0, g.r[b]!, g.r[b]! + 1], paint: [g.series[b]!, -1] };
    const owner = (px: number, py: number): number | null => {
      let o = -1;
      for (const b of order) {
        const { edges, paint } = bands(b), d = Math.hypot(px - g.x[b]!, py - g.y[b]!);
        for (const e of edges) if (e > 0 && Math.abs(d - e) < 0.1) return null;
        for (let k = 0; k < paint.length; k++) if (d >= edges[k]! && d < edges[k + 1]!) o = paint[k]!;
      }
      return o;
    };
    let seed = 3;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const points: [number, number][] = [];
    const { plot } = g;
    for (let i = 0; i < samples; i++) points.push([plot.x + rand() * plot.width, plot.y + rand() * plot.height]);
    for (let b = 0; b < g.count; b++) {
      for (const e of bands(b).edges) {
        if (e <= 0) continue;
        for (let k = 0; k < 8; k++) {
          const t = rand() * 2 * Math.PI;
          for (const off of [-0.3, 0.3]) points.push([g.x[b]! + (e + off) * Math.cos(t), g.y[b]! + (e + off) * Math.sin(t)]);
        }
      }
    }
    const wrong: string[] = [];
    const point = svg.createSVGPoint();
    for (const [px, py] of points) {
      const o = owner(px, py);
      if (o === null) continue;
      point.x = px; point.y = py;
      for (const path of paths) {
        const s = Number(path.dataset.series), filled = path.isPointInFill(point);
        if (filled !== (o === s)) wrong.push(`(${px.toFixed(2)}, ${py.toFixed(2)}) series ${s} ${filled ? 'painted' : 'missing'}, owner ${o}`);
      }
      if (wrong.length > 10) break;
    }
    return wrong;
  }, samples);
}

const tooltipText = (page: Page) => page.locator('#chart .axylo-tooltip').innerText();

describe('N8b bubble (Chrome, source build)', () => {
  it('multi-series: size legend beside series toggles, small bubble inside a large one is hovered and clicked', async () => {
    const page = await open(BASE);
    // Series toggles in the toolbar, and the nested-circle size legend list beside them.
    expect(await page.locator('#chart .axylo-legend-entry').count()).toBe(3);
    const legend = page.locator('#chart ul.axylo-bubble-legend');
    expect(await legend.count()).toBe(1);
    expect(await legend.locator('circle').count()).toBe(3);
    // Largest size 1000 → reference sizes 1000, 250, 50 (nice values at or below 1, ¼ and 1⁄16 of the maximum).
    expect(await legend.locator('li').allInnerTexts()).toEqual(['Population (M)', '1,000 M', '250 M', '50 M']);
    const radii = await legend.locator('circle').evaluateAll(cs => cs.map(c => Number(c.getAttribute('r'))));
    expect(radii[0]).toBe(24);
    expect(radii[1]).toBe(12);

    const drawn = await circles(page);
    const big = [...drawn].sort((a, b) => b.r - a.r)[0]!;
    // Small: size 4 of 1000 → 24·√0.004 = 1.52 px, lifted to the 2 px floor.
    const small = drawn.find(c => c.r === 2 && Math.abs(c.cy - big.cy) < 1)!;
    expect(big.r).toBe(24);
    expect(small).toBeDefined();
    expect(Math.hypot(small.cx - big.cx, small.cy - big.cy)).toBeLessThan(big.r);

    await page.mouse.move(small.cx, small.cy);
    await frames(page);
    const tip = await tooltipText(page);
    expect(tip).toContain('Small');
    expect(tip).toContain('52 k$');
    expect(tip).toContain('70 years; Population: 4 M');
    await page.mouse.click(small.cx, small.cy);
    await frames(page);
    const selected = await page.evaluate(() => window.selected);
    expect(selected[selected.length - 1]).toMatchObject({ series: 'Small', y: 70, index: 1 });

    // Inside the large disc, away from the small one: the large bubble.
    await page.mouse.move(big.cx, big.cy + 15);
    await frames(page);
    expect(await tooltipText(page)).toContain('Population: 1,000 M');
    expect(await closePage(page)).toEqual([]);
  });

  it('keyboard order is x then y and the reading, tooltip and table say the same (x, y, size)', async () => {
    const page = await open(BASE);
    await page.focus('#chart .axylo-proxy');
    const readings: string[] = [];
    // Home lands on the first datum whatever focusing selected; each ArrowRight is the next in x then y order.
    for (let i = 0; i < NESTED.length; i++) {
      await page.keyboard.press(i === 0 ? 'Home' : 'ArrowRight');
      await frames(page, 2);
      readings.push(await page.locator('#chart .axylo-proxy').getAttribute('aria-valuetext') ?? '');
    }
    // x order: 0, 20, 50, 52, 100.
    const order = ['0 k$', '20 k$', '50 k$', '52 k$', '100 k$'];
    readings.forEach((text, i) => expect(text).toContain(order[i]));
    expect(readings[3]).toContain('70 years; Population: 4 M');

    await page.getByRole('button', { name: 'View as table' }).click();
    await frames(page);
    const header = await page.locator('#chart .axylo-table th[scope="col"]').allInnerTexts();
    expect(header).toEqual(['GDP (k$)', 'Series', 'Life (years)', 'Population (M)']);
    const rows = await page.locator('#chart .axylo-table tbody tr').evaluateAll(trs => trs.map(tr => [...tr.children].map(c => (c as HTMLElement).innerText)));
    expect(rows).toEqual([
      ['0 k$', 'Large', '50 years', '100 M'],
      ['20 k$', 'Third', '80 years', '250 M'],
      ['50 k$', 'Large', '70 years', '1,000 M'],
      ['52 k$', 'Small', '70 years', '4 M'],
      ['100 k$', 'Small', '90 years', '9 M'],
    ]);
    expect(await closePage(page)).toEqual([]);
  });

  it('the unhovered picture is the painter\'s order: alternating concentric series and partly crossing discs', async () => {
    // A ⊃ B ⊃ A ⊃ B … at one point, discs of both series crossing them, a zero marker on top, and equal discs.
    const data: { x: number; y: number; s: number; g: string }[] = [];
    for (let k = 0; k < 10; k++) data.push({ x: 50, y: 50, s: (10 - k) ** 2, g: k % 2 ? 'B' : 'A' });
    data.push({ x: 53, y: 50, s: 36, g: 'B' }, { x: 47, y: 52, s: 49, g: 'A' }, { x: 50, y: 50, s: 0, g: 'B' });
    data.push({ x: 80, y: 30, s: 64, g: 'A' }, { x: 80, y: 30, s: 64, g: 'B' }, { x: 0, y: 0, s: 1, g: 'A' }, { x: 100, y: 100, s: 1, g: 'B' });
    for (const rows of [data, [...data].reverse()]) {
      const page = await open({ title: 'Picture', data: rows, x: 'x', y: 'y', size: 's', series: 'g', radius: { min: 0, max: 60 } });
      expect(await page.locator('#chart .axylo-scene path[data-bubble="series"]').count()).toBe(2);
      expect(await pictureMismatches(page)).toEqual([]);
      expect(await closePage(page)).toEqual([]);
    }
  });

  it('the unhovered picture of the multi-series fixture is the painter\'s order', async () => {
    const page = await open(BASE);
    expect(await pictureMismatches(page)).toEqual([]);
    expect(await closePage(page)).toEqual([]);
  });

  it('zoom keeps radii and draws only the window', async () => {
    const page = await open(BASE);
    const before = await circles(page);
    await page.evaluate(() => window.chart.zoom([40, 60]));
    await frames(page);
    const after = await circles(page);
    expect(after.map(c => c.r).sort((a, b) => a - b)).toEqual([2, 24]);
    expect(before.length).toBeGreaterThan(after.length);
    expect(await closePage(page)).toEqual([]);
  });

  for (const [name, context] of [
    ['light', { colorScheme: 'light' }], ['dark', { colorScheme: 'dark' }], ['forced colors', { forcedColors: 'active' }],
  ] as const) {
    it(`axe-core: no violations (${name}), table open and closed`, async () => {
      const page = await open(BASE, context);
      expect((await axe(page)).violations).toEqual([]);
      await page.getByRole('button', { name: 'View as table' }).click();
      await frames(page);
      expect((await axe(page)).violations).toEqual([]);
      expect(await closePage(page)).toEqual([]);
    });
  }

  it('single series: the size legend follows data, size, locale and legend updates, and leaves on destroy', async () => {
    const one = NESTED.map(({ region: _r, ...rest }) => ({ ...rest, pop2: rest.pop * 2 }));
    const page = await open({ ...BASE, data: one, series: undefined });
    const legend = () => page.locator('#chart ul.axylo-bubble-legend li').allInnerTexts();
    expect(await legend()).toEqual(['Population (M)', '1,000 M', '250 M', '50 M']);
    await page.evaluate(() => window.chart.update({ size: { field: 'pop2', label: 'Twice' } } as never));
    await frames(page);
    expect(await legend()).toEqual(['Twice', '2,000', '500', '100']);
    await page.evaluate(data => window.chart.update({ data: data.map(r => ({ ...r, pop2: r.pop2 * 10 })) } as never), one);
    await frames(page);
    expect(await legend()).toEqual(['Twice', '20,000', '5,000', '1,000']);
    await page.evaluate(() => window.chart.update({ locale: 'de-DE' } as never));
    await frames(page);
    expect(await legend()).toEqual(['Twice', '20.000', '5.000', '1.000']);
    await page.evaluate(() => window.chart.update({ legend: false } as never));
    await frames(page);
    expect(await page.locator('#chart ul.axylo-bubble-legend').count()).toBe(0);
    await page.evaluate(() => window.chart.update({ legend: 'auto' } as never));
    await frames(page);
    expect(await legend()).toEqual(['Twice', '20.000', '5.000', '1.000']);
    await page.evaluate(() => window.chart.destroy());
    await frames(page);
    expect(await page.locator('ul.axylo-bubble-legend').count()).toBe(0);
    expect(await closePage(page)).toEqual([]);
  });

  it('50,000 bubbles: bounded SVG DOM, build time recorded', async () => {
    const page = await openEntry(ENTRY);
    const result = await page.evaluate(async () => {
      const n = 50_000;
      const x = new Float64Array(n), y = new Float64Array(n), s = new Float64Array(n), g = new Array<string>(n);
      let seed = 7;
      const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < n; i++) { x[i] = rand() * 1000; y[i] = rand() * 1000; s[i] = i % 97 === 0 ? 0 : rand() * 1e6; g[i] = ['a', 'b', 'c'][i % 3]!; }
      const t0 = performance.now();
      window.chart = window.n8b.bubble('#chart', { title: '50k', data: { columns: { x, y, s, g } }, x: 'x', y: 'y', size: 's', series: 'g' } as never);
      const created = performance.now() - t0;
      // Drawn: the first animation frame after which the bubble paths are in the document.
      let frames = 0;
      while (!document.querySelector('#chart .axylo-scene path[data-bubble]') && frames < 600) {
        await new Promise(r => requestAnimationFrame(() => r(null)));
        frames++;
      }
      const drawn = performance.now() - t0;
      const svg = document.querySelector('#chart svg.axylo-svg')!;
      const paths = [...svg.querySelectorAll<SVGPathElement>('.axylo-scene path[data-bubble]')];
      return {
        created, drawn, frames, sceneNodes: svg.querySelector('.axylo-scene')!.childElementCount, svgElements: svg.querySelectorAll('*').length,
        bubblePaths: paths.length, paints: paths.map(p => `${p.dataset.series}:${p.dataset.bubble}`),
        dBytes: paths.reduce((n, p) => n + (p.getAttribute('d') ?? '').length, 0),
        bubbles: window.n8b.bubbleInternals(window.chart)!.geometry!.count,
      };
    });
    console.info('[N8b 50k Chrome]', JSON.stringify(result));
    expect(result.sceneNodes).toBeLessThanOrEqual(25);
    // The whole SVG, axes, gridlines, defs and overlay included, stays bounded at 50,000 bubbles.
    expect(result.svgElements).toBeLessThanOrEqual(25);
    // One plot path per series, holding what that series shows of all 50,000 bubbles.
    expect(result.paints).toEqual(['0:series', '1:series', '2:series']);
    expect(result.bubbles).toBe(50_000);
    expect(await closePage(page)).toEqual([]);
  });
});
