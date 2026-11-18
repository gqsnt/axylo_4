/**
 * The type matrix (spec 3.6), every cell about rendered or interactive behaviour: picking by pointer,
 * tooltip content, keyboard order, zoom, dense drawing (the rendered half), the limit that raises a
 * diagnostic, and reference lines and bands.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { start, stop } from '../harness';
import {
  axOf, box, center, closePage, create, createRaw, devPage, plotGeometry, ring, settle, shapes, signature, valueText,
} from './util';
import { calendar, ENERGY, inOrder, LATENCY_ORDER, share, SHIPPED, SPEND, withUnit } from './fixtures';

beforeAll(start);
afterAll(stop);

const tip = async (page: Page) => ((await page.locator('#chart .axylo-tooltip').isVisible()) ? (await page.locator('#chart .axylo-tooltip').textContent()) ?? '' : '');
const xDomain = (page: Page) => page.evaluate(() => (window as unknown as { charts: { __bench: { describe(): { xDomain: number[] | null; yDomain: number[] | null } } }[] }).charts[0]!.__bench.describe());

// ── picking ───────────────────────────────────────────────────────────────────────────────────────

describe('T-pointer: picking by pointer', () => {
  for (const type of ['line', 'area'] as const) {
    it(`T-pointer-${type}: the pointer picks the nearest x: 30 % of the way from one day to the next shows the first, 70 % the second`, async () => {
      const page = await devPage();
      await create(page, type);
      const xs = ((await shapes(page, '#chart', 14))[1] ?? []).map(s => center(s.box).x).sort((a, b) => a - b);
      expect(xs).toHaveLength(5);
      const p = await box(page, '#chart .axylo-proxy');
      for (const [f, want] of [[0.3, 1], [0.7, 2]] as const) {
        // From outside the chart each time, so the last tooltip is not under the pointer.
        await page.mouse.move(0, 0);
        await settle(page);
        await page.mouse.move(xs[1]! + f * (xs[2]! - xs[1]!), p.y + 5);
        await settle(page);
        expect(await tip(page)).toContain(calendar(ENERGY.days[want]!));
      }
      expect(await closePage(page)).toEqual([]);
    });
  }

  it('T-pointer-bar: the band under the pointer is picked, even at its edge and away from the bars', async () => {
    const page = await devPage();
    await create(page, 'bar');
    const rects = (await shapes(page, '#chart', 100000));
    const plan = (rects[1] ?? []).map(s => s.box).sort((a, b) => a.x - b.x);
    const actual = (rects[2] ?? []).map(s => s.box).sort((a, b) => a.x - b.x);
    const p = await box(page, '#chart .axylo-proxy');
    // The band of Q2 runs from half-way between Q1 and Q2 to half-way between Q2 and Q3.
    const left = (actual[0]!.x + actual[0]!.width + plan[1]!.x) / 2, right = (actual[1]!.x + actual[1]!.width + plan[2]!.x) / 2;
    for (const x of [left + 2, right - 2, plan[1]!.x + 1]) {
      await page.mouse.move(0, 0);
      await settle(page);
      await page.mouse.move(x, p.y + 4);
      await settle(page);
      const text = await tip(page);
      expect(text, `at ${x}`).toContain('Q2');
      expect(text).not.toContain('Q1');
      expect(text).not.toContain('Q3');
    }
    expect(await closePage(page)).toEqual([]);
  });

  it('T-pointer-donut: the slice under the pointer is picked; the hole and the outside pick nothing', async () => {
    const page = await devPage();
    await create(page, 'donut');
    const g = await ring(page);
    const total = SPEND.values.reduce((a, b) => a + b, 0);
    let before = 0;
    for (let i = 0; i < 4; i++) {
      const a = 2 * Math.PI * (before + SPEND.values[i]! / 2) / total;
      before += SPEND.values[i]!;
      await page.mouse.move(0, 0);
      await settle(page);
      await page.mouse.move(g.cx + 0.85 * g.outer * Math.sin(a), g.cy - 0.85 * g.outer * Math.cos(a));
      await settle(page);
      expect(await tip(page)).toContain(SPEND.items[i]!);
    }
    await page.mouse.move(g.cx, g.cy);
    await settle(page);
    expect(await tip(page)).toBe('');
    await page.mouse.move(g.cx + g.outer * 1.2, g.cy + g.outer * 0.9);
    await settle(page);
    expect(await tip(page)).toBe('');
    expect(await closePage(page)).toEqual([]);
  });

  it('T-pointer-scatter: the nearest point within 24 px is picked, nothing beyond 24 px, and a tie goes to the later row', async () => {
    const page = await devPage();
    // Two points one x unit apart at the same y, with points far to each side so neither sits on an edge.
    await createRaw(page, 'scatter', { title: 'Tie', data: [{ x: 0, y: 0, s: 'far' }, { x: 20, y: 5, s: 'first' }, { x: 21, y: 5, s: 'second' }, { x: 40, y: 9, s: 'far' }], x: 'x', y: 'y', series: 's' });
    const drawn = await shapes(page, '#chart', 14);
    const a = center(drawn[2]![0]!.box), b = center(drawn[3]![0]!.box);
    await page.mouse.move(a.x - 3, a.y);
    await settle(page);
    expect(await tip(page)).toContain('first');
    // Exactly between the two: a tie, so the later row ("second").
    await page.mouse.move(0, 0);
    await settle(page);
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2);
    await settle(page);
    const text = await tip(page);
    expect(text).toContain('second');
    expect(text).not.toContain('first');
    // 30 px above the first point: beyond 24 px of every point (from outside, so no tooltip is under it).
    await page.mouse.move(0, 0);
    await settle(page);
    await page.mouse.move(a.x, a.y - 30);
    await settle(page);
    expect(await tip(page)).toBe('');
    expect(await closePage(page)).toEqual([]);
  });
});

// ── tooltip content ───────────────────────────────────────────────────────────────────────────────

describe('T-tooltip: tooltip content', () => {
  it('T-tooltip-line: every visible series at that x, and not a hidden one', async () => {
    const page = await devPage();
    await create(page, 'line');
    const p = await box(page, '#chart .axylo-proxy');
    const xs = ((await shapes(page, '#chart', 14))[1] ?? []).map(s => center(s.box).x).sort((a, b) => a - b);
    await page.mouse.move(xs[3]!, p.y + 5);
    await settle(page);
    expect(inOrder(await tip(page), [calendar(ENERGY.days[3]!), 'North', withUnit(18, 'kWh'), 'South', withUnit(8, 'kWh')])).toBe(true);
    await page.locator('#chart .axylo-legend-entry', { hasText: 'South' }).click();
    await settle(page);
    await page.mouse.move(xs[3]!, p.y + 6);
    await settle(page);
    const text = await tip(page);
    expect(text).toContain('North');
    expect(text).not.toContain('South');
    expect(await closePage(page)).toEqual([]);
  });

  it('T-tooltip-area: every visible series at that x, plus the stack total', async () => {
    const page = await devPage();
    await create(page, 'area', {}, '#chart', 'stacked');
    const p = await box(page, '#chart .axylo-proxy');
    const xs = ((await shapes(page, '#chart', 14))[1] ?? []).map(s => center(s.box).x).sort((a, b) => a - b);
    await page.mouse.move(xs[1]!, p.y + 5);
    await settle(page);
    // Day 2: North 15, South 9, total 24.
    expect(inOrder(await tip(page), [calendar(ENERGY.days[1]!), 'North', withUnit(15, 'kWh'), 'South', withUnit(9, 'kWh')])).toBe(true);
    expect(await tip(page)).toMatch(new RegExp(`Total\\s*${withUnit(24, 'kWh')}`));
    expect(await closePage(page)).toEqual([]);
  });

  it('T-tooltip-bar: every series in that category', async () => {
    const page = await devPage();
    await create(page, 'bar');
    const plan = ((await shapes(page, '#chart', 100000))[1] ?? []).map(s => s.box).sort((a, b) => a.x - b.x);
    const p = await box(page, '#chart .axylo-proxy');
    await page.mouse.move(plan[2]!.x + plan[2]!.width / 2, p.y + 4);
    await settle(page);
    expect(inOrder(await tip(page), ['Q3', 'Plan', withUnit(50, 't'), 'Actual', withUnit(52, 't')])).toBe(true);
    expect(await closePage(page)).toEqual([]);
  });

  it('T-tooltip-donut: label, value and percentage', async () => {
    const page = await devPage();
    await create(page, 'donut');
    const g = await ring(page);
    const a = 2 * Math.PI * (1200 + 600 / 2) / 2400;
    await page.mouse.move(g.cx + 0.85 * g.outer * Math.sin(a), g.cy - 0.85 * g.outer * Math.cos(a));
    await settle(page);
    expect(inOrder(await tip(page), ['Food', withUnit(600, 'EUR'), share(600)])).toBe(true);
    expect(await closePage(page)).toEqual([]);
  });

  it('T-tooltip-scatter: the point\'s series, x and y; ten coincident points list eight and "+2 more"', async () => {
    const page = await devPage();
    await create(page, 'scatter');
    const eu = ((await shapes(page, '#chart', 14))[1] ?? []).map(s => center(s.box)).sort((a, b) => a.x - b.x);
    await page.mouse.move(eu[1]!.x, eu[1]!.y);
    await settle(page);
    // Its series, x and y (spec 3.6 lists what, not in which order).
    for (const part of ['EU', withUnit(20, 'kB'), withUnit(140, 'ms')]) expect(await tip(page)).toContain(part);
    await page.close();
    const many = await devPage();
    await createRaw(many, 'scatter', { title: 'Same place', data: [...Array.from({ length: 10 }, (_, i) => ({ x: 5, y: 5, s: `S${i + 1}` })), { x: 1, y: 1, s: 'S1' }, { x: 9, y: 9, s: 'S1' }], x: 'x', y: 'y', series: 's' });
    const p = await box(many, '#chart .axylo-proxy');
    await many.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
    await settle(many);
    expect(await many.locator('#chart .axylo-tooltip .axylo-tooltip-row').count()).toBe(8);
    expect(await tip(many)).toContain('+2 more');
    expect(await closePage(many)).toEqual([]);
  });
});

// ── keyboard order ────────────────────────────────────────────────────────────────────────────────

describe('T-keyboard: keyboard order', () => {
  const orders: Record<string, { type: 'line' | 'area' | 'bar' | 'scatter' | 'donut'; first: string[]; stops: string[][] }> = {
    'T-keyboard-line': { type: 'line', first: [], stops: ENERGY.days.map(d => [calendar(d), 'North', 'South']) },
    'T-keyboard-area': { type: 'area', first: [], stops: ENERGY.days.map(d => [calendar(d), 'North', 'South']) },
    'T-keyboard-bar': { type: 'bar', first: [], stops: SHIPPED.quarters.map(q => [q, 'Plan', 'Actual']) },
    'T-keyboard-scatter': { type: 'scatter', first: [], stops: LATENCY_ORDER.map(p => [p.region, withUnit(p.size, 'kB'), withUnit(p.latency, 'ms')]) },
    'T-keyboard-donut': { type: 'donut', first: [], stops: SPEND.items.map(i => [i]) },
  };
  const rule = { line: 'by x, then series', area: 'by x, then series', bar: 'by category, then series', scatter: 'by x, then y (x = 20 kB: 100 ms before 140 ms)', donut: 'by slice order' };
  for (const [id, o] of Object.entries(orders)) {
    it(`${id}: Right walks ${rule[o.type]}; Left walks back in reverse`, async () => {
      const page = await devPage();
      await create(page, o.type);
      await page.focus('#chart .axylo-proxy');
      const forwards = [await valueText(page)];
      for (let i = 1; i < o.stops.length; i++) { await page.keyboard.press('ArrowRight'); forwards.push(await valueText(page)); }
      o.stops.forEach((s, i) => expect(inOrder(forwards[i]!, s), `${i}: ${forwards[i]}`).toBe(true));
      const backwards = [await valueText(page)];
      for (let i = 1; i < o.stops.length; i++) { await page.keyboard.press('ArrowLeft'); backwards.push(await valueText(page)); }
      expect(backwards).toEqual([...forwards].reverse());
      if (o.type === 'line' || o.type === 'area' || o.type === 'bar') {
        // "Then series": from all series at the first x, Down goes to the first series, Down again to the second.
        await page.keyboard.press('ArrowDown');
        const one = await valueText(page);
        await page.keyboard.press('ArrowDown');
        const two = await valueText(page);
        expect(one).toContain(o.stops[0]![1]!);
        expect(one).not.toContain(o.stops[0]![2]!);
        expect(two).toContain(o.stops[0]![2]!);
      }
      expect(await closePage(page)).toEqual([]);
    });
  }
});

// ── zoom ──────────────────────────────────────────────────────────────────────────────────────────

describe('T-zoom', () => {
  for (const type of ['line', 'area', 'scatter'] as const) {
    it(`T-zoom-${type}: ${type === 'scatter' ? 'x only in 1.0: zooming narrows the x range and offers zoom controls; the y axis is not zoomed' : 'zoom applies: controls are offered and + narrows the x range'}`, async () => {
      const page = await devPage();
      await create(page, type);
      expect(await page.locator('#chart [role="toolbar"] button', { hasText: 'Zoom in' }).count()).toBe(1);
      const before = await xDomain(page);
      await page.focus('#chart .axylo-proxy');
      await page.keyboard.press('+');
      await settle(page);
      const after = await xDomain(page);
      expect(after.xDomain![1]! - after.xDomain![0]!).toBeLessThan(before.xDomain![1]! - before.xDomain![0]!);
      if (type === 'scatter') {
        // Spec 3.6: x only. The y axis keeps its full domain (reading: "x only" means y is not zoomed).
        expect(after.yDomain).toEqual(before.yDomain);
      }
      expect(await closePage(page)).toEqual([]);
    });
  }

  it('T-zoom-bar: a category bar chart has no zoom (no controls; +, wheel and drag leave the range alone); a date bar chart zooms', async () => {
    const page = await devPage();
    await create(page, 'bar');
    expect(await page.locator('#chart button', { hasText: 'Zoom in' }).count()).toBe(0);
    const before = await xDomain(page);
    await page.focus('#chart .axylo-proxy');
    await page.keyboard.press('+');
    const p = await box(page, '#chart .axylo-proxy');
    await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
    await page.mouse.wheel(0, -300);
    await page.mouse.move(p.x + 0.2 * p.width, p.y + p.height / 2);
    await page.mouse.down();
    await page.mouse.move(p.x + 0.6 * p.width, p.y + p.height / 2, { steps: 5 });
    await page.mouse.up();
    await settle(page);
    expect(await xDomain(page)).toEqual(before);
    await page.close();
    const dated = await devPage();
    const day = (k: number) => new Date(Date.UTC(2026, 0, 1) + k * 864e5).toISOString().slice(0, 10);
    await createRaw(dated, 'bar', { title: 'Daily', data: Array.from({ length: 30 }, (_, k) => ({ day: day(k), v: k % 7 + 1 })), x: { field: 'day', type: 'date' }, y: 'v' });
    expect(await dated.locator('#chart button', { hasText: 'Zoom in' }).count()).toBe(1);
    expect(await closePage(dated)).toEqual([]);
  });

  it('T-zoom-donut: a donut has no zoom: no controls, and +, - and the wheel change nothing drawn', async () => {
    const page = await devPage();
    await create(page, 'donut');
    expect(await page.locator('#chart button', { hasText: /Zoom/ }).count()).toBe(0);
    const scene = () => page.evaluate(() => document.querySelector('#chart svg.axylo-svg .axylo-scene')!.innerHTML);
    const before = await scene();
    await page.focus('#chart .axylo-proxy');
    await page.keyboard.press('+');
    await page.keyboard.press('-');
    const g = await ring(page);
    await page.mouse.move(g.cx, g.cy);
    await page.mouse.wheel(0, -300);
    await settle(page);
    expect(await scene()).toBe(before);
    expect(await closePage(page)).toEqual([]);
  });
});

// ── dense drawing (rendered half) ─────────────────────────────────────────────────────────────────

describe('T-dense', () => {
  for (const type of ['line', 'area'] as const) {
    it(`T-dense-${type}: 100,000 samples with one outlier: the drawing reaches the outlier, and the outlier is in the table`, async () => {
      const page = await devPage();
      await page.evaluate(async type => {
        const n = 100_000;
        const x = new Float64Array(n), y = new Float64Array(n);
        for (let i = 0; i < n; i++) { x[i] = i; y[i] = 10 + (i % 3); }
        y[61_234] = 100;
        const w = window as unknown as { Axylo: Record<string, (t: string, o: unknown) => { __bench: { ready(): Promise<void> } }>; charts: unknown[] };
        const chart = w.Axylo[type]!('#chart', { title: 'Dense', data: { columns: { x, y } }, x: 'x', y: 'y' });
        w.charts.push(chart);
        await chart.__bench.ready();
      }, type);
      const g = await plotGeometry(page);
      // The y of the outlier on screen: the top of the y domain if it ends at 100, else lower.
      const top = g.plot.y + (1 - (100 - g.yDomain![0]!) / (g.yDomain![1]! - g.yDomain![0]!)) * g.plot.height;
      const reach = await page.evaluate(() => {
        const svg = document.querySelector('#chart svg.axylo-svg') as SVGSVGElement;
        const m = svg.getScreenCTM()!;
        let best = Infinity;
        for (const el of svg.querySelectorAll<SVGPathElement>('.axylo-scene path')) {
          // The stroked line only (markers' arc parameters are not coordinates).
          if (!/--axylo-series-color-1\b/.test(el.style.getPropertyValue('color')) || el.style.getPropertyValue('stroke') !== 'currentcolor') continue;
          const nums = (el.getAttribute('d') ?? '').match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
          for (let i = 1; i < nums.length; i += 2) best = Math.min(best, new DOMPoint(nums[i - 1]!, nums[i]!).matrixTransform(m).y);
        }
        return best;
      });
      expect(Math.abs(reach - top)).toBeLessThanOrEqual(1);
      await page.locator('#chart [role="toolbar"] button', { hasText: 'View as table' }).click();
      await settle(page);
      await page.locator('#chart .axylo-jump-field').click();
      await page.keyboard.type('61,234');
      await page.keyboard.press('Enter');
      await settle(page);
      const row = await page.locator('#chart table tbody tr', { has: page.locator('th', { hasText: /^61,234$/ }) }).innerText();
      expect(row).toContain('100');
      expect(await closePage(page)).toEqual([]);
    });
  }

  it('T-dense-bar: more bars than pixels raises the AX132 hint and every bar is still drawn', async () => {
    const page = await devPage({ css: '#chart { width: 300px; }' });
    const built = await createRaw(page, 'bar', { title: 'Many', data: Array.from({ length: 2000 }, (_, k) => ({ c: `c${k}`, v: 1 + (k % 5) })), x: 'c', y: 'v' });
    expect(built.diagnostics.filter(d => d.code === 'AX132').map(d => d.level)).toEqual(['hint']);
    expect(((await shapes(page, '#chart', 100000))[1] ?? []).length).toBe(2000);
    expect(await closePage(page)).toEqual([]);
  });

  it('T-dense-donut: no simplified drawing: eight slices, the smallest under 0.5 %, are each drawn', async () => {
    const page = await devPage();
    const values = [600, 200, 100, 50, 30, 15, 4, 1];
    await createRaw(page, 'donut', { title: 'Eight', data: values.map((v, i) => ({ l: `S${i + 1}`, v })), label: 'l', value: 'v' });
    expect(await page.evaluate(() => document.querySelectorAll('#chart svg.axylo-svg .axylo-scene path').length)).toBe(8);
    expect(await closePage(page)).toEqual([]);
  });

  it('T-dense-scatter: above 50,000 points the AX133 hint says drawing may be slow, and every point is drawn', async () => {
    const page = await devPage();
    const built = await page.evaluate(async () => {
      const n = 50_001;
      const rows = Array.from({ length: n }, (_, i) => ({ x: i % 1000, y: Math.floor(i / 1000) }));
      const w = window as unknown as { Axylo: Record<string, (t: string, o: unknown) => { diagnostics: { code: string; level: string }[]; __bench: { ready(): Promise<void> } }>; charts: unknown[] };
      const chart = w.Axylo.scatter!('#chart', { title: 'Many', data: rows, x: 'x', y: 'y' });
      w.charts.push(chart);
      await chart.__bench.ready();
      let subpaths = 0;
      for (const el of document.querySelectorAll<SVGPathElement>('#chart svg.axylo-svg .axylo-scene path')) {
        if (/--axylo-series-color-1\b/.test(el.style.getPropertyValue('color'))) subpaths += ((el.getAttribute('d') ?? '').match(/M/g) ?? []).length;
      }
      return { codes: chart.diagnostics.map(d => `${d.level} ${d.code}`), subpaths };
    });
    expect(built.codes).toContain('hint AX133');
    expect(built.subpaths).toBe(50_001);
    expect(await closePage(page)).toEqual([]);
  });
});

// ── limits ────────────────────────────────────────────────────────────────────────────────────────

/** Per drawn series: its colour slot, line dash and marker shape, as an identity. */
async function identities(page: Page): Promise<string[]> {
  const raw = await page.evaluate(() => {
    const out = new Map<string, { color: string; dash: string; marker: string; pattern: string }>();
    for (const el of document.querySelectorAll<SVGElement>('#chart svg.axylo-svg .axylo-scene path, #chart svg.axylo-svg .axylo-scene g')) {
      const slot = /--axylo-series-color-(\d+)/.exec(el.style.getPropertyValue('color'));
      if (!slot) continue;
      // The element order groups a series' marks; the colour slot repeats after eight, so key by element run.
      const key = `${el.tagName}:${el.getAttribute('data-series') ?? ''}:${out.size}`;
      out.set(key, {
        color: getComputedStyle(el).color,
        dash: el.style.getPropertyValue('stroke') === 'currentcolor' ? getComputedStyle(el).strokeDasharray : '',
        marker: el.style.getPropertyValue('fill') === 'currentcolor' ? (el.getAttribute('d') ?? '').split(/(?=M)/)[0] ?? '' : '',
        pattern: el.getAttribute('fill')?.startsWith('url(') ? el.getAttribute('fill')! : '',
      });
    }
    return [...out.values()];
  });
  return raw.map(r => `${r.color}|${r.dash}|${r.marker ? signature(r.marker) : ''}|${r.pattern}`);
}

describe('T-limit', () => {
  for (const type of ['line', 'area', 'bar', 'scatter'] as const) {
    it(`T-limit-${type}: nine series raise AX130 and all nine are drawn, each with its own combination of colour and dash or marker`, async () => {
      const page = await devPage();
      const names = Array.from({ length: 9 }, (_, i) => `S${i + 1}`);
      const data = type === 'scatter'
        ? names.flatMap((s, i) => [1, 2, 3].map(x => ({ x: x + i / 10, y: i + x, s })))
        : names.flatMap((s, i) => ['A', 'B', 'C'].map((x, k) => ({ x, s, y: 10 + i + k })));
      const built = await createRaw(page, type, { title: 'Nine', data, x: 'x', y: 'y', series: 's' });
      expect(built.diagnostics.filter(d => d.code === 'AX130').map(d => d.level)).toEqual(['warning']);
      // Every series has drawn marks: nine legend entries, and the drawn identities include nine distinct ones.
      expect(await page.locator('#chart .axylo-legend-entry').count()).toBe(9);
      const legend = await page.locator('#chart .axylo-legend-entry svg.axylo-swatch').evaluateAll(els => els.map(e => `${getComputedStyle(e).color}|${e.innerHTML.replace(/\s+/g, ' ')}`));
      expect(new Set(legend).size, 'legend swatches, each a distinct cue').toBe(9);
      const drawn = await identities(page);
      expect(drawn.length).toBeGreaterThanOrEqual(9);
      expect(await closePage(page)).toEqual([]);
    });
  }

  it('T-limit-donut: nine slices raise AX121 and draw the seven largest plus "Other (2)"', async () => {
    const page = await devPage();
    const values = [30, 20, 15, 10, 8, 6, 5, 4, 2];
    const built = await createRaw(page, 'donut', { title: 'Nine', data: values.map((v, i) => ({ l: `S${i + 1}`, v })), label: 'l', value: 'v' });
    expect(built.diagnostics.filter(d => d.code === 'AX121').map(d => d.level)).toEqual(['warning']);
    expect(await page.evaluate(() => document.querySelectorAll('#chart svg.axylo-svg .axylo-scene path').length)).toBe(8);
    expect(await page.locator('#chart ul.axylo-legend-list > li .axylo-legend-name').allTextContents()).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'Other (2)']);
    expect(await closePage(page)).toEqual([]);
  });
});

// ── reference lines and bands ─────────────────────────────────────────────────────────────────────

describe('T-reference', () => {
  for (const type of ['line', 'area', 'bar', 'scatter'] as const) {
    it(`T-reference-${type}: a reference line beyond the data is included in the y domain, drawn with its label next to it, and listed in the summary and the table caption; a band is listed too`, async () => {
      const page = await devPage();
      // Every fixture's values stay below 200; the reference sits at 200.
      const band = type === 'bar' ? { y: [20, 30], label: 'Normal range' } : type === 'scatter' ? { x: [12, 18], label: 'Normal range' } : { x: ['2026-03-03', '2026-03-04'], label: 'Normal range' };
      await create(page, type, { reference: [{ y: 200, label: 'Ceiling' }, band] });
      const d = await xDomain(page);
      expect(d.yDomain![1]).toBeGreaterThanOrEqual(200);
      const label = page.locator('#chart .axylo-label[data-role="reference"]', { hasText: 'Ceiling' });
      expect(await label.count()).toBe(1);
      const g = await plotGeometry(page);
      const lineY = g.plot.y + (1 - (200 - d.yDomain![0]!) / (d.yDomain![1]! - d.yDomain![0]!)) * g.plot.height;
      const lb = await box(page, '#chart .axylo-label[data-role="reference"]');
      expect(Math.min(Math.abs(lb.y - lineY), Math.abs(lb.y + lb.height - lineY)), 'label next to its line').toBeLessThanOrEqual(16);
      const summary = (await axOf(page, '#chart figure')).description;
      expect(summary).toContain('Ceiling');
      expect(summary).toContain('Normal range');
      await page.locator('#chart [role="toolbar"] button', { hasText: 'View as table' }).click();
      await settle(page);
      const caption = (await page.locator('#chart table caption').textContent()) ?? '';
      expect(caption).toContain('Ceiling');
      expect(caption).toContain('Normal range');
      expect(await closePage(page)).toEqual([]);
    });
  }

  it('T-reference-donut: a donut has no reference lines: an author reference is not drawn and not described, and is reported', async () => {
    const page = await devPage();
    const built = await create(page, 'donut', { reference: [{ y: 200, label: 'Ceiling' }] });
    expect(await page.locator('#chart .axylo-label[data-role="reference"]').count()).toBe(0);
    expect((await axOf(page, '#chart figure')).description).not.toContain('Ceiling');
    // An option that does not apply to the chart type is AX150 at run time (spec DX3).
    expect(built.diagnostics.map(d => d.code)).toContain('AX150');
    expect(await closePage(page)).toEqual([]);
  });
});


