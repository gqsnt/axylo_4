/**
 * The type matrix (spec 3.6), every cell about rendered or interactive behaviour: picking by pointer,
 * tooltip content, keyboard order, zoom, dense drawing (the rendered half), the limit that raises a
 * diagnostic, and reference lines and bands. Marks are identified by where they are drawn and in what
 * colour, never by counting elements alone.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { start, stop } from '../harness';
import {
  axOf, box, center, closePage, create, createRaw, devPage, distance, inkColorAt, modeColor, plotGeometry, readRange, readTable, resolveColors, ring, screenshot, settle, shapes, signature, valueText, type Box, type RGB,
} from './util';
import { calendar, ENERGY, inOrder, LATENCY_ORDER, share, SHIPPED, SPEND, withUnit } from './fixtures';
import { inkColor, referenceMarks, spikeColumn, strokeRuns } from './checks';

beforeAll(start);
afterAll(stop);

const tip = async (page: Page) => ((await page.locator('#chart .axylo-tooltip').isVisible()) ? (await page.locator('#chart .axylo-tooltip').textContent()) ?? '' : '');
const xDomain = (page: Page) => page.evaluate(() => (window as unknown as { charts: { __bench: { describe(): { xDomain: number[] | null; yDomain: number[] | null } } }[] }).charts[0]!.__bench.describe());
const away = async (page: Page) => { await page.mouse.move(0, 0); await settle(page); };
/** The angle (radians clockwise from 12 o'clock) of the middle of slice `i` of `values`. */
const midAngle = (values: readonly number[], i: number) => (2 * Math.PI * (values.slice(0, i).reduce((a, b) => a + b, 0) + values[i]! / 2)) / values.reduce((a, b) => a + b, 0);

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
        await away(page);
        await page.mouse.move(xs[1]! + f * (xs[2]! - xs[1]!), p.y + 5);
        await settle(page);
        expect(await tip(page)).toContain(calendar(ENERGY.days[want]!));
      }
      expect(await closePage(page)).toEqual([]);
    });
  }

  for (const horizontal of [false, true]) {
    it(`T-pointer-bar: the band under the pointer is picked, even at its edge and away from the bars${horizontal ? ' (horizontal bars: bands run along y)' : ''}`, async () => {
      const page = await devPage();
      await create(page, 'bar', horizontal ? { horizontal: true } : {});
      const rects = await shapes(page, '#chart', 100000);
      const along = (b: Box) => (horizontal ? b.y : b.x), size = (b: Box) => (horizontal ? b.height : b.width);
      const plan = (rects[1] ?? []).map(s => s.box).sort((a, b) => along(a) - along(b));
      const actual = (rects[2] ?? []).map(s => s.box).sort((a, b) => along(a) - along(b));
      expect(plan).toHaveLength(4);
      const p = await box(page, '#chart .axylo-proxy');
      // The band of the second category runs from half-way between groups 1 and 2 to half-way between 2 and 3.
      const end = (i: number) => Math.max(along(plan[i]!) + size(plan[i]!), along(actual[i]!) + size(actual[i]!));
      const startOf = (i: number) => Math.min(along(plan[i]!), along(actual[i]!));
      const lo = (end(0) + startOf(1)) / 2, hi = (end(1) + startOf(2)) / 2;
      const labels = horizontal ? SHIPPED.quarters : SHIPPED.quarters;
      for (const t of [lo + 2, hi - 2, startOf(1) + 1]) {
        await away(page);
        await page.mouse.move(horizontal ? p.x + p.width - 4 : t, horizontal ? t : p.y + 4);
        await settle(page);
        const text = await tip(page);
        expect(text, `at ${t}`).toContain(labels[1]!);
        expect(text).not.toContain(labels[0]!);
        expect(text).not.toContain(labels[2]!);
      }
      expect(await closePage(page)).toEqual([]);
    });
  }

  it('T-pointer-donut: the slice under the pointer is picked; the hole and the outside pick nothing', async () => {
    const page = await devPage();
    await create(page, 'donut');
    const g = await ring(page);
    for (let i = 0; i < 4; i++) {
      const a = midAngle(SPEND.values, i);
      await away(page);
      await page.mouse.move(g.cx + 0.85 * g.outer * Math.sin(a), g.cy - 0.85 * g.outer * Math.cos(a));
      await settle(page);
      expect(await tip(page)).toContain(SPEND.items[i]!);
    }
    await away(page);
    await page.mouse.move(g.cx, g.cy);
    await settle(page);
    expect(await tip(page)).toBe('');
    await page.mouse.move(g.cx + g.outer * 1.2, g.cy + g.outer * 0.9);
    await settle(page);
    expect(await tip(page)).toBe('');
    expect(await closePage(page)).toEqual([]);
  });

  it('T-pointer-scatter: the nearest point within 24 px is picked: 23 px from a lone point it is, 25 px it is not', async () => {
    const page = await devPage();
    await createRaw(page, 'scatter', { title: 'Lone', data: [{ x: 0, y: 0, s: 'corner' }, { x: 20, y: 5, s: 'lone' }, { x: 40, y: 10, s: 'corner' }], x: 'x', y: 'y', series: 's' });
    const lone = center((await shapes(page, '#chart', 14))[2]![0]!.box);
    for (const [d, picked] of [[23, true], [25, false]] as const) {
      for (const [dx, dy] of [[d, 0], [0, -d], [-d * Math.SQRT1_2, d * Math.SQRT1_2]]) {
        await away(page);
        await page.mouse.move(lone.x + dx!, lone.y + dy!);
        await settle(page);
        expect((await tip(page)).includes('lone'), `${d} px (${Math.round(dx!)}, ${Math.round(dy!)})`).toBe(picked);
      }
    }
    expect(await closePage(page)).toEqual([]);
  });

  it('T-pointer-scatter: two points equally near the pointer: the later row wins, whichever series it is (source order reversed, the other wins)', async () => {
    for (const order of [['first', 'second'], ['second', 'first']] as const) {
      const page = await devPage();
      const rows = { first: { x: 20, y: 5, s: 'first' }, second: { x: 21, y: 5, s: 'second' } };
      await createRaw(page, 'scatter', { title: 'Tie', data: [{ x: 0, y: 0, s: 'far' }, rows[order[0]], rows[order[1]], { x: 40, y: 9, s: 'far' }], x: 'x', y: 'y', series: 's' });
      const drawn = await shapes(page, '#chart', 14);
      const pts = [drawn[2]![0]!, drawn[3]![0]!].map(s => center(s.box));
      await away(page);
      await page.mouse.move((pts[0]!.x + pts[1]!.x) / 2, (pts[0]!.y + pts[1]!.y) / 2);
      await settle(page);
      const text = await tip(page);
      expect(text, `rows ${order.join(', ')}`).toContain(order[1]);
      expect(text).not.toContain(order[0]);
      expect(await closePage(page)).toEqual([]);
    }
  });
});

// ── tooltip content ───────────────────────────────────────────────────────────────────────────────

describe('T-tooltip: tooltip content', () => {
  for (const type of ['line', 'area', 'bar'] as const) {
    it(`T-tooltip-${type}: every visible series at that ${type === 'bar' ? 'category' : 'x'}${type === 'area' ? ' and, stacked, the stack total' : ''}, in series order; a hidden series is not listed`, async () => {
      const page = await devPage();
      await create(page, type, {}, '#chart', type === 'area' ? 'stacked' : 'default');
      const p = await box(page, '#chart .axylo-proxy');
      const drawn = await shapes(page, '#chart', type === 'bar' ? 100000 : 14);
      const xs = (drawn[1] ?? []).map(s => center(s.box).x).sort((a, b) => a - b);
      const [first, second] = type === 'bar' ? SHIPPED.series : ENERGY.series;
      const unit = type === 'bar' ? 't' : 'kWh';
      const label = type === 'bar' ? SHIPPED.quarters[2]! : calendar(ENERGY.days[2]!);
      await page.mouse.move(type === 'bar' ? xs[2]! : xs[2]!, p.y + 5);
      await settle(page);
      const rows = () => page.locator('#chart .axylo-tooltip .axylo-tooltip-row').evaluateAll(els => els.map(e => e.textContent ?? ''));
      const want = [`${first!.name}${withUnit(first!.values[2]!, unit)}`, `${second!.name}${withUnit(second!.values[2]!, unit)}`];
      if (type === 'area') want.push(`Total${withUnit(first!.values[2]! + second!.values[2]!, unit)}`);
      expect(await page.locator('#chart .axylo-tooltip .axylo-tooltip-title').textContent()).toBe(label);
      expect(await rows()).toEqual(want);
      await away(page);
      await page.locator('#chart .axylo-legend-entry', { hasText: second!.name }).click();
      await settle(page);
      await away(page);
      await page.mouse.move(xs[2]!, p.y + 6);
      await settle(page);
      const left = await rows();
      expect(left[0]).toBe(want[0]);
      expect(left.join(' ')).not.toContain(second!.name);
      expect(await closePage(page)).toEqual([]);
    });
  }

  it('T-tooltip-bar: on horizontal bars too, every series in the category under the pointer', async () => {
    const page = await devPage();
    await create(page, 'bar', { horizontal: true });
    const p = await box(page, '#chart .axylo-proxy');
    const ys = ((await shapes(page, '#chart', 100000))[1] ?? []).map(s => center(s.box).y).sort((a, b) => a - b);
    await page.mouse.move(p.x + p.width - 4, ys[1]!);
    await settle(page);
    expect(inOrder(await tip(page), [SHIPPED.quarters[1]!, 'Plan', withUnit(45, 't'), 'Actual', withUnit(47, 't')])).toBe(true);
    expect(await closePage(page)).toEqual([]);
  });

  it('T-tooltip-donut: label, value and percentage of the slice under the pointer', async () => {
    const page = await devPage();
    await create(page, 'donut');
    const g = await ring(page);
    const a = midAngle(SPEND.values, 3);
    await page.mouse.move(g.cx + 0.85 * g.outer * Math.sin(a), g.cy - 0.85 * g.outer * Math.cos(a));
    await settle(page);
    expect(inOrder(await tip(page), [SPEND.items[3]!, withUnit(SPEND.values[3]!, 'EUR'), share(SPEND.values[3]!)])).toBe(true);
    expect(await closePage(page)).toEqual([]);
  });

  it('T-tooltip-scatter: the point\'s series, x and y; ten coincident points list eight distinct series of the ten and "+2 more"', async () => {
    const page = await devPage();
    await create(page, 'scatter');
    const eu = ((await shapes(page, '#chart', 14))[1] ?? []).map(s => center(s.box)).sort((a, b) => a.x - b.x);
    await page.mouse.move(eu[1]!.x, eu[1]!.y);
    await settle(page);
    for (const part of ['EU', withUnit(20, 'kB'), withUnit(140, 'ms')]) expect(await tip(page)).toContain(part);
    await page.close();
    const many = await devPage();
    const names = Array.from({ length: 10 }, (_, i) => `S${i + 1}`);
    await createRaw(many, 'scatter', { title: 'Same place', data: [...names.map(s => ({ x: 5, y: 5, s })), { x: 1, y: 1, s: 'S1' }, { x: 9, y: 9, s: 'S1' }], x: 'x', y: 'y', series: 's' });
    const p = await box(many, '#chart .axylo-proxy');
    await many.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
    await settle(many);
    const listed = await many.locator('#chart .axylo-tooltip .axylo-tooltip-row .axylo-tooltip-series').allTextContents();
    expect(listed).toHaveLength(8);
    expect(new Set(listed).size).toBe(8);
    expect(listed.every(n => names.includes(n))).toBe(true);
    expect(await tip(many)).toContain('+2 more');
    expect(await closePage(many)).toEqual([]);
  });
});

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
      expect((await readRange(page)).value).toBe(0);
      for (let i = 1; i < o.stops.length; i++) {
        await page.keyboard.press('ArrowRight');
        forwards.push(await valueText(page));
        // The range's own position (Chrome's computed value) moves with the text.
        expect((await readRange(page)).value).toBe(i);
      }
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

describe('F10 mixed-sign stacks, rendered', () => {
  for (const type of ['area', 'bar'] as const) {
    it(`F10 ${type}: a stack with a positive and a negative part reads the positive total and the negative total in the tooltip, never their net, and the parts sit on their own sides of zero`, async () => {
      const page = await devPage();
      const data = [{ x: 'A', s: 'Up', y: 5 }, { x: 'A', s: 'Down', y: -3 }, { x: 'B', s: 'Up', y: 4 }, { x: 'B', s: 'Down', y: -2 }, { x: 'C', s: 'Up', y: 6 }, { x: 'C', s: 'Down', y: -1 }];
      await createRaw(page, type, { title: 'Mixed', data, x: 'x', y: { field: 'y', unit: 'kg' }, series: 's', ...(type === 'area' ? { stacked: true } : { layout: 'stacked' }) });
      const g = await plotGeometry(page);
      const zero = g.plot.y + (1 - (0 - g.yDomain![0]!) / (g.yDomain![1]! - g.yDomain![0]!)) * g.plot.height;
      if (type === 'bar') {
        const drawn = await shapes(page, '#chart', 100000);
        for (const r of (drawn[1] ?? []).map(s => s.box)) expect(r.y + r.height, 'Up above zero').toBeLessThanOrEqual(zero + 1);
        for (const r of (drawn[2] ?? []).map(s => s.box)) expect(r.y, 'Down below zero').toBeGreaterThanOrEqual(zero - 1);
      }
      const xs = ((await shapes(page, '#chart', type === 'bar' ? 100000 : 14))[1] ?? []).map(s => center(s.box).x).sort((a, b) => a - b);
      await page.mouse.move(xs[0]!, g.plot.y + 4);
      await settle(page);
      const total = (await page.locator('#chart .axylo-tooltip .axylo-tooltip-total').textContent()) ?? '';
      expect(total).toContain(withUnit(5, 'kg'));
      expect(total).toContain('-3 kg');
      expect(total).not.toMatch(/(^|[^-\d])2 kg/);
      expect(await closePage(page)).toEqual([]);
    });
  }
});

// ── zoom ──────────────────────────────────────────────────────────────────────────────────────────

describe('T-zoom', () => {
  for (const type of ['line', 'area', 'scatter'] as const) {
    it(`T-zoom-${type}: ${type === 'scatter' ? 'x only in 1.0: + narrows the x range, controls are offered, and the y axis keeps the full data range though the visible y extremes change' : 'zoom applies: controls are offered and + narrows the x range'}`, async () => {
      const page = await devPage();
      await create(page, type);
      expect(await page.locator('#chart [role="toolbar"] button', { hasText: 'Zoom in' }).count()).toBe(1);
      const before = await xDomain(page);
      if (type === 'scatter') await page.evaluate(() => (window as unknown as { charts: { zoom(d: unknown): void }[] }).charts[0]!.zoom([12, 22]));
      else { await page.focus('#chart .axylo-proxy'); await page.keyboard.press('+'); }
      await settle(page);
      const after = await xDomain(page);
      expect(after.xDomain![1]! - after.xDomain![0]!).toBeLessThan(before.xDomain![1]! - before.xDomain![0]!);
      // Scatter (spec 3.6): x only. In [12, 22] the visible y values are 90–140 too… so the window [12, 22]
      // holds only 90, 100, 140 (y 90–140 of 90–140 overall); the y axis must keep the full domain.
      if (type === 'scatter') expect(after.yDomain).toEqual(before.yDomain);
      expect(await closePage(page)).toEqual([]);
    });
  }

  it('T-zoom-bar: a category bar chart has no zoom (no controls; +, wheel and drag each leave the range alone); date and number bar charts zoom', async () => {
    const page = await devPage();
    await create(page, 'bar');
    expect(await page.locator('#chart button', { hasText: 'Zoom in' }).count()).toBe(0);
    const before = await xDomain(page);
    await page.focus('#chart .axylo-proxy');
    await page.keyboard.press('+');
    await settle(page);
    expect(await xDomain(page), 'after +').toEqual(before);
    const p = await box(page, '#chart .axylo-proxy');
    await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
    await page.mouse.wheel(0, -300);
    await settle(page);
    expect(await xDomain(page), 'after the wheel').toEqual(before);
    await page.mouse.move(p.x + 0.2 * p.width, p.y + p.height / 2);
    await page.mouse.down();
    await page.mouse.move(p.x + 0.6 * p.width, p.y + p.height / 2, { steps: 5 });
    await page.mouse.up();
    await settle(page);
    expect(await xDomain(page), 'after a drag').toEqual(before);
    await page.close();
    for (const axis of ['date', 'number'] as const) {
      const other = await devPage();
      const day = (k: number) => new Date(Date.UTC(2026, 0, 1) + k * 864e5).toISOString().slice(0, 10);
      await createRaw(other, 'bar', { title: 'Zoomable', data: Array.from({ length: 30 }, (_, k) => ({ x: axis === 'date' ? day(k) : k, v: (k % 7) + 1 })), x: { field: 'x', type: axis }, y: 'v' });
      expect(await other.locator('#chart button', { hasText: 'Zoom in' }).count(), axis).toBe(1);
      const full = await xDomain(other);
      await other.focus('#chart .axylo-proxy');
      await other.keyboard.press('+');
      await settle(other);
      const z = await xDomain(other);
      expect(z.xDomain![1]! - z.xDomain![0]!, axis).toBeLessThan(full.xDomain![1]! - full.xDomain![0]!);
      expect(await closePage(other)).toEqual([]);
    }
  });

  it('T-zoom-donut: a donut has no zoom: no controls, and +, - and the wheel each change nothing drawn', async () => {
    const page = await devPage();
    await create(page, 'donut');
    expect(await page.locator('#chart button', { hasText: /Zoom/ }).count()).toBe(0);
    const scene = () => page.evaluate(() => document.querySelector('#chart svg.axylo-svg .axylo-scene')!.innerHTML);
    const before = await scene();
    await page.focus('#chart .axylo-proxy');
    await page.keyboard.press('+');
    await settle(page);
    expect(await scene(), 'after +').toBe(before);
    await page.keyboard.press('-');
    await settle(page);
    expect(await scene(), 'after -').toBe(before);
    const g = await ring(page);
    await page.mouse.move(g.cx, g.cy);
    await page.mouse.wheel(0, -300);
    await settle(page);
    expect(await scene(), 'after the wheel').toBe(before);
    expect(await closePage(page)).toEqual([]);
  });
});

// ── dense drawing (rendered half) ─────────────────────────────────────────────────────────────────

/** Viewport position of data (x, y) on a plot whose domains are fixed by the author. */
const project = (plot: Box, xd: readonly number[], yd: readonly number[]) => (x: number, y: number) => ({ x: plot.x + ((x - xd[0]!) / (xd[1]! - xd[0]!)) * plot.width, y: plot.y + (1 - (y - yd[0]!) / (yd[1]! - yd[0]!)) * plot.height });

describe('T-dense', () => {
  for (const type of ['line', 'area'] as const) {
    for (const dpr of [1, 2]) {
      it(`T-dense-${type}: 100,000 samples at device pixel ratio ${dpr} with fixed domains: a spike at sample 61,234 and a dip at 20,000 are each drawn in their own device-pixel column and nowhere else; a break inside one column is kept; a sample the drawing dropped is in the table`, async () => {
        const page = await devPage({ deviceScaleFactor: dpr });
        await page.evaluate(async type => {
          const n = 100_000;
          const x = new Float64Array(n), y = new Float64Array(n);
          for (let i = 0; i < n; i++) { x[i] = i; y[i] = 40 + (i % 3); }
          y[61_234] = 95;
          y[20_000] = 5;
          // A break: samples 80,000 and 80,001 missing, so one device column holds the end of a run and the start of the next.
          y[80_000] = NaN;
          y[80_001] = NaN;
          const w = window as unknown as { Axylo: Record<string, (t: string, o: unknown) => { __bench: { ready(): Promise<void> } }>; charts: unknown[] };
          const chart = w.Axylo[type]!('#chart', { title: 'Dense', data: { columns: { x, y } }, x: { field: 'x', domain: [0, n - 1] }, y: { field: 'y', domain: [0, 100] } });
          w.charts.push(chart);
          await chart.__bench.ready();
        }, type);
        const plot = await box(page, '#chart .axylo-proxy');
        const at = project(plot, [0, 99_999], [0, 100]);
        const runs = await strokeRuns(page, 1);
        const spike = spikeColumn(runs, at(61_234, 95), dpr);
        expect(spike.reached, 'spike drawn in its column').toBe(true);
        expect(spike.outside, 'spike height reached elsewhere').toEqual([]);
        const dip = spikeColumn(runs, at(20_000, 5), dpr);
        expect(dip.reached, 'dip drawn in its column').toBe(true);
        expect(dip.outside).toEqual([]);
        // The break: a run ends before x of 80,000 and the next starts after it, within a pixel column or two.
        // The break: one run ends and the next begins within a device pixel or so of the missing samples.
        const gapX = at(80_000.5, 0).x;
        const lifts = runs.slice(1).map((r, k) => ({ end: runs[k]!.at(-1)!.x, start: r[0]!.x }));
        expect(lifts.some(l => Math.abs(l.end - gapX) <= 1.5 && Math.abs(l.start - gapX) <= 1.5), `pen lift at x ${gapX.toFixed(1)}: ${JSON.stringify(lifts.map(l => [l.end.toFixed(1), l.start.toFixed(1)]))}`).toBe(true);
        await page.locator('#chart [role="toolbar"] button', { hasText: 'View as table' }).click();
        await settle(page);
        await page.locator('#chart .axylo-jump-field').click();
        await page.keyboard.type('50,001');
        await page.keyboard.press('Enter');
        await settle(page);
        const row = (await readTable(page)).rows.find(r => r.header === '50,001');
        expect(row?.cells).toEqual([String(40 + (50_001 % 3))]);
        expect(await closePage(page)).toEqual([]);
      });
    }
  }

  it('T-dense-area: stacked, the upper boundary reaches the cumulative spike (series 1 at 61,234 plus series 2 there) in its own column, at device pixel ratio 2', async () => {
    const page = await devPage({ deviceScaleFactor: 2 });
    await page.evaluate(async () => {
      const n = 100_000;
      const rows = { x: new Float64Array(2 * n), y: new Float64Array(2 * n), s: new Array<string>(2 * n) };
      for (let i = 0; i < n; i++) { rows.x[i] = i; rows.y[i] = 20; rows.s[i] = 'A'; rows.x[n + i] = i; rows.y[n + i] = 10 + (i % 2); rows.s[n + i] = 'B'; }
      rows.y[61_234] = 70;
      const w = window as unknown as { Axylo: Record<string, (t: string, o: unknown) => { __bench: { ready(): Promise<void> } }>; charts: unknown[] };
      const chart = w.Axylo.area!('#chart', { title: 'Stacked dense', data: { columns: rows }, x: { field: 'x', domain: [0, n - 1] }, y: { field: 'y', domain: [0, 100] }, series: 's', stacked: true });
      w.charts.push(chart);
      await chart.__bench.ready();
    });
    const plot = await box(page, '#chart .axylo-proxy');
    const at = project(plot, [0, 99_999], [0, 100]);
    // Series B sits on A: its stroke is the cumulative sum, 70 + (61,234 mod 2 = 0) + 10 = 80 at the spike.
    const top = spikeColumn(await strokeRuns(page, 2), at(61_234, 80), 2);
    expect(top.reached, 'cumulative spike drawn').toBe(true);
    expect(top.outside).toEqual([]);
    expect(await closePage(page)).toEqual([]);
  });

  it('T-dense-bar: more bars than pixels raises the AX132 hint and every bar is still drawn, each where its category is', async () => {
    const page = await devPage({ css: '#chart { width: 300px; }' });
    const built = await createRaw(page, 'bar', { title: 'Many', data: Array.from({ length: 2000 }, (_, k) => ({ c: `c${k}`, v: k === 1234 ? 50 : 1 + (k % 5) })), x: 'c', y: 'v' });
    expect(built.diagnostics.filter(d => d.code === 'AX132').map(d => d.level)).toEqual(['hint']);
    const rects = ((await shapes(page, '#chart', 100000))[1] ?? []).map(s => s.box);
    expect(rects).toHaveLength(2000);
    // The tall one (50) is the 1,235th band from the left.
    const sorted = [...rects].sort((a, b) => a.x - b.x || a.y - b.y);
    const tallest = rects.reduce((a, b) => (b.height > a.height ? b : a));
    expect(sorted.indexOf(tallest)).toBe(1234);
    expect(await closePage(page)).toEqual([]);
  });

  it('T-dense-donut: no simplified drawing: eight slices, the smallest under 0.2 %, are each drawn at their angle in their colour', async () => {
    const page = await devPage();
    const values = [600, 200, 100, 50, 30, 15, 4, 1];
    await createRaw(page, 'donut', { title: 'Eight', data: values.map((v, i) => ({ l: `S${i + 1}`, v })), label: 'l', value: 'v' });
    const { img, box: plot, scale } = await screenshot(page, '#chart .axylo-plot');
    const g = await ring(page);
    const colors = await resolveColors(page, await page.locator('#chart ul.axylo-legend-list > li svg.axylo-swatch').evaluateAll(els => els.map(e => getComputedStyle(e).color)));
    const wrong: string[] = [];
    // The slices' own paths, by colour, with the angle their outer arc starts at (clockwise from 12 o'clock).
    const starts = await page.evaluate(({ cx, cy }) => [...document.querySelectorAll<SVGPathElement>('#chart svg.axylo-svg .axylo-scene path')].filter(p => /M\s*-?[\d.]+[ ,]-?[\d.]+/.test(p.getAttribute('d') ?? '')).map(p => {
      const m = p.getScreenCTM()!; const [x, y] = /M\s*(-?[\d.]+)[ ,](-?[\d.]+)/.exec(p.getAttribute('d')!)!.slice(1).map(Number);
      const q = new DOMPoint(x!, y!).matrixTransform(m);
      return { color: getComputedStyle(p).color, angle: (Math.atan2(q.x - cx, cy - q.y) + 2 * Math.PI) % (2 * Math.PI) };
    }), g);
    const css = await page.locator('#chart ul.axylo-legend-list > li svg.axylo-swatch').evaluateAll(els => els.map(e => getComputedStyle(e).color));
    values.forEach((v, i) => {
      const a = midAngle(values, i);
      const arc = ((2 * Math.PI * v) / 1000) * g.outer;
      // A slice wider than 4 px of arc is checked on the screen; a thinner one is hidden by its 1 px
      // separators (spec A5), so its own path is checked to start where its share puts it.
      if (arc > 4) {
        const c = inkColorAt(img, (g.cx - plot.x + 0.85 * g.outer * Math.sin(a)) * scale, (g.cy - plot.y - 0.85 * g.outer * Math.cos(a)) * scale);
        if (distance(c, colors[i]!) > 30) wrong.push(`S${i + 1}: ${c} vs ${colors[i]}`);
      } else {
        const start = (2 * Math.PI * values.slice(0, i).reduce((x, y) => x + y, 0)) / 1000;
        if (!starts.some(p => p.color === css[i] && Math.abs(p.angle - start) < 0.02)) wrong.push(`S${i + 1}: no path of its colour starts at ${((start * 180) / Math.PI).toFixed(1)}°`);
      }
    });
    expect(wrong).toEqual([]);
    expect(await closePage(page)).toEqual([]);
  });

  it('T-dense-scatter: above 50,000 points the AX133 hint says drawing may be slow, and every point is drawn: points chosen across the data are found at their own positions', async () => {
    const page = await devPage();
    const built = await page.evaluate(async () => {
      const n = 50_001;
      const rows = Array.from({ length: n }, (_, i) => ({ x: i % 1000, y: Math.floor(i / 1000) }));
      const w = window as unknown as { Axylo: Record<string, (t: string, o: unknown) => { diagnostics: { code: string; level: string; message: string }[]; __bench: { ready(): Promise<void> } }>; charts: unknown[] };
      const chart = w.Axylo.scatter!('#chart', { title: 'Many', data: rows, x: { field: 'x', domain: [0, 999] }, y: { field: 'y', domain: [0, 50] } });
      w.charts.push(chart);
      await chart.__bench.ready();
      return chart.diagnostics.filter(d => d.code === 'AX133').map(d => `${d.level} ${d.message}`);
    });
    expect(built).toHaveLength(1);
    expect(built[0]).toMatch(/^hint .*slow/i);
    const plot = await box(page, '#chart .axylo-proxy');
    const at = project(plot, [0, 999], [0, 50]);
    const found = await page.evaluate(points => {
      const svg = document.querySelector('#chart svg.axylo-svg') as SVGSVGElement;
      const m = svg.getScreenCTM()!;
      const starts: { x: number; y: number }[] = [];
      for (const el of svg.querySelectorAll<SVGPathElement>('.axylo-scene path')) {
        if (!/--axylo-series-color-1\b/.test(el.style.getPropertyValue('color'))) continue;
        for (const sub of (el.getAttribute('d') ?? '').split('M').slice(1)) {
          const [px, py] = sub.split(/[ A-Z]/).filter(Boolean).map(Number);
          const p = new DOMPoint(px!, py!).matrixTransform(m);
          starts.push({ x: p.x, y: p.y });
        }
      }
      // A mark's path starts within its 6 px shape box of its point.
      return { count: starts.length, hits: points.map(q => starts.some(s0 => Math.abs(s0.x - q.x) <= 5 && Math.abs(s0.y - q.y) <= 5)) };
    // (x, y) = (i mod 1000, floor(i / 1000)) for i < 50,001: the last point is (0, 50).
    }, [at(0, 0), at(0, 50), at(999, 49), at(500, 25), at(123, 45), at(876, 3)]);
    expect(found.hits).toEqual([true, true, true, true, true, true]);
    expect(found.count).toBe(50_001);
    expect(await closePage(page)).toEqual([]);
  });
});

// ── limits ────────────────────────────────────────────────────────────────────────────────────────

/** One painted identity per series, in series order: colour, dash, marker shape and bar pattern, from each series' own marks in DOM order. */
async function cues(page: Page, type: 'line' | 'area' | 'bar' | 'scatter'): Promise<string[]> {
  const raw = await page.evaluate(type => {
    const scene = document.querySelector('#chart svg.axylo-svg .axylo-scene')!;
    const series = (el: Element) => /--axylo-series-color-/.test((el as SVGElement).style.getPropertyValue('color'));
    const strokes = [...scene.querySelectorAll<SVGPathElement>('path')].filter(e => series(e) && e.style.getPropertyValue('stroke') === 'currentcolor');
    const fills = [...scene.querySelectorAll<SVGPathElement>('path')].filter(e => series(e) && e.style.getPropertyValue('fill') === 'currentcolor' && !e.style.getPropertyValue('fill-opacity'));
    const bars = [...scene.children].filter(e => e.tagName.toLowerCase() === 'g' && series(e));
    const n = type === 'bar' ? bars.length : type === 'scatter' ? fills.length : strokes.length;
    return Array.from({ length: n }, (_, i) => {
      const line = strokes[i], marker = type === 'bar' ? null : fills[i], group = bars[i];
      const color = getComputedStyle((line ?? marker ?? group)!).color;
      const dash = line ? getComputedStyle(line).strokeDasharray : '';
      const shape = marker ? (marker.getAttribute('d') ?? '').split(/(?=M)/)[0] ?? '' : '';
      const pattern = group ? [...group.children].map(r => (r as SVGElement).style.getPropertyValue('fill')).filter(Boolean).join(',') : '';
      return { color, dash, shape, pattern };
    });
  }, type);
  return raw.map(r => `${r.color}|${r.dash}|${r.shape ? signature(r.shape) : ''}|${r.pattern}`);
}

describe('T-limit', () => {
  for (const type of ['line', 'area', 'bar', 'scatter'] as const) {
    it(`T-limit-${type}: eight series raise no AX130; nine raise AX130 once, and each of the nine is painted with its own combination of colour and dash, marker or pattern`, async () => {
      const make = (count: number) => {
        const names = Array.from({ length: count }, (_, i) => `S${i + 1}`);
        return type === 'scatter'
          ? names.flatMap((s, i) => [1, 2, 3].map(x => ({ x: x + i / 10, y: i + x, s })))
          : names.flatMap((s, i) => ['A', 'B', 'C'].map((x, k) => ({ x, s, y: 10 + i + k })));
      };
      const eight = await devPage();
      const ok = await createRaw(eight, type, { title: 'Eight', data: make(8), x: 'x', y: 'y', series: 's' });
      expect(ok.diagnostics.map(d => d.code)).not.toContain('AX130');
      await closePage(eight);
      const page = await devPage();
      const built = await createRaw(page, type, { title: 'Nine', data: make(9), x: 'x', y: 'y', series: 's' });
      expect(built.diagnostics.filter(d => d.code === 'AX130').map(d => d.level)).toEqual(['warning']);
      const ids = await cues(page, type);
      expect(ids, 'one painted identity per series').toHaveLength(9);
      expect(new Set(ids).size, JSON.stringify(ids)).toBe(9);
      expect(await closePage(page)).toEqual([]);
    });
  }

  it('F9 bar: thirty-two series are each painted with their own combination of colour and fill pattern (spec F9 as settled: bar cues are distinct up to 32 series)', async () => {
    const page = await devPage({ viewport: { width: 1400, height: 800 }, css: '#chart { width: 1300px; height: 600px; }' });
    const names = Array.from({ length: 32 }, (_, i) => `S${i + 1}`);
    await createRaw(page, 'bar', { title: 'Thirty-two', data: names.flatMap((s, i) => ['A', 'B'].map((x, k) => ({ x, s, y: 10 + i + k }))), x: 'x', y: 'y', series: 's' });
    const ids = await cues(page, 'bar');
    expect(ids).toHaveLength(32);
    expect(new Set(ids).size, JSON.stringify(ids)).toBe(32);
    expect(await closePage(page)).toEqual([]);
  });

  it('T-limit-donut: eight slices raise no AX121; nine raise it and draw the seven largest (here not the first seven) plus "Other (2)"', async () => {
    const eight = await devPage();
    const ok = await createRaw(eight, 'donut', { title: 'Eight', data: [5, 1, 4, 2, 8, 3, 7, 6].map((v, i) => ({ l: `S${i + 1}`, v })), label: 'l', value: 'v' });
    expect(ok.diagnostics.map(d => d.code)).not.toContain('AX121');
    await closePage(eight);
    const page = await devPage();
    // Smallest are S1 (2) and S4 (1): grouped. The rest keep their order.
    const values = [2, 30, 20, 1, 15, 10, 8, 6, 5];
    const built = await createRaw(page, 'donut', { title: 'Nine', data: values.map((v, i) => ({ l: `S${i + 1}`, v })), label: 'l', value: 'v' });
    expect(built.diagnostics.filter(d => d.code === 'AX121').map(d => d.level)).toEqual(['warning']);
    expect(await page.locator('#chart ul.axylo-legend-list > li .axylo-legend-name').allTextContents()).toEqual(['S2', 'S3', 'S5', 'S6', 'S7', 'S8', 'S9', 'Other (2)']);
    expect(await closePage(page)).toEqual([]);
  });
});

// ── reference lines and bands ─────────────────────────────────────────────────────────────────────

describe('T-reference', () => {
  for (const type of ['line', 'area', 'bar', 'scatter'] as const) {
    for (const which of ['line', 'band'] as const) {
      it(`T-reference-${type}: a reference ${which} outside the data is included in the domain, painted at its position in the reference colour, labelled next to its own mark, and listed in the summary and the table caption`, async () => {
        const page = await devPage();
        // Every fixture's values stay below 200 and its x within the data; each reference lies beyond.
        // 187: above every value, and not on a tick (so not on a gridline).
        const ref = which === 'line' ? { y: 187, label: 'Ceiling' }
          : type === 'bar' ? { y: [150, 180], label: 'Normal range' }
            : type === 'scatter' ? { x: [40, 50], label: 'Normal range' } : { x: ['2026-03-08', '2026-03-10'], label: 'Normal range' };
        await create(page, type, { reference: [ref] });
        const d = await xDomain(page);
        const g = await plotGeometry(page);
        if (which === 'line' || type === 'bar') expect(d.yDomain![1]).toBeGreaterThanOrEqual(which === 'line' ? 187 : 180);
        const marks = (await referenceMarks(page)).filter(m => m.kind === which);
        expect(marks.length, `a painted reference ${which}`).toBeGreaterThan(0);
        const m = marks.sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height)[0]!;
        const y = (v: number) => g.plot.y + (1 - (v - d.yDomain![0]!) / (d.yDomain![1]! - d.yDomain![0]!)) * g.plot.height;
        if (which === 'line') {
          expect(Math.abs(m.box.y + m.box.height / 2 - y(187)), 'line at y = 187').toBeLessThanOrEqual(1.5);
          expect(m.box.width).toBeGreaterThan(g.plot.width * 0.9);
        } else if (type === 'bar') {
          expect(Math.abs(m.box.y - y(180))).toBeLessThanOrEqual(1.5);
          expect(Math.abs(m.box.y + m.box.height - y(150))).toBeLessThanOrEqual(1.5);
        } else {
          // An x band beyond the data: inside the widened x domain, to the right of every mark.
          expect(m.box.x).toBeGreaterThan(g.plot.x + g.plot.width / 2);
        }
        // Painted: a line shows the reference colour along its length (a dashed line has gaps, so the most
        // frequent non-background colour along it); a band shows the reference colour composited at the
        // band's computed opacity over the background.
        const { img, box: view } = await screenshot(page, '#chart .axylo-plot');
        const backdrop = modeColor(img, { x0: 0, y0: 0, x1: img.width, y1: img.height }).color;
        const [want] = await resolveColors(page, [m.paint]);
        if (which === 'line') {
          const ink = inkColor(img, view, { x: m.box.x + 4, y: m.box.y + m.box.height / 2 - 1, width: m.box.width - 8, height: 2 }, backdrop);
          expect(ink, 'the line is painted').not.toBeNull();
          expect(distance(ink!, want!), `painted ${ink}, reference ${want}`).toBeLessThanOrEqual(24);
        } else {
          const alpha = await page.evaluate(() => { for (const el of document.querySelectorAll<SVGElement>('#chart svg.axylo-svg .axylo-scene *')) if (/--axylo-reference/.test(el.style.getPropertyValue('color'))) { const c = getComputedStyle(el); const r = el.getBoundingClientRect(); if (r.width > 2.5 && r.height > 2.5) return Number(c.fillOpacity) * Number(c.opacity); } return 1; });
          const expected = want!.map((v, i) => Math.round(alpha * v + (1 - alpha) * backdrop[i]!)) as unknown as RGB;
          const painted = modeColor(img, { x0: (m.box.x - view.x + 2) * (img.width / view.width), y0: (m.box.y - view.y + 2) * (img.width / view.width), x1: (m.box.x + m.box.width - view.x - 2) * (img.width / view.width), y1: (m.box.y + m.box.height - view.y - 2) * (img.width / view.width) }).color;
          expect(distance(painted, backdrop), 'the band is visibly painted').toBeGreaterThan(6);
          expect(distance(painted, expected), `painted ${painted}, expected ${expected} (reference at opacity ${alpha})`).toBeLessThanOrEqual(8);
        }
        const label = await box(page, '#chart .axylo-label[data-role="reference"]');
        const gapY = Math.max(0, m.box.y - (label.y + label.height), label.y - (m.box.y + m.box.height));
        const gapX = Math.max(0, m.box.x - (label.x + label.width), label.x - (m.box.x + m.box.width));
        expect(Math.hypot(gapX, gapY), 'label next to its own mark').toBeLessThanOrEqual(16);
        const summary = (await axOf(page, '#chart figure')).description;
        expect(summary).toContain(ref.label);
        await page.locator('#chart [role="toolbar"] button', { hasText: 'View as table' }).click();
        await settle(page);
        expect((await page.locator('#chart table caption').textContent()) ?? '').toContain(ref.label);
        expect(await closePage(page)).toEqual([]);
      });
    }
  }

  it('T-reference-donut: a donut has no reference lines: an author reference is reported (AX150), and nothing is drawn, labelled or described for it', async () => {
    const page = await devPage();
    const built = await create(page, 'donut', { reference: [{ y: 200, label: 'Ceiling' }] });
    expect(await referenceMarks(page)).toEqual([]);
    expect(await page.locator('#chart .axylo-label[data-role="reference"]').count()).toBe(0);
    expect((await axOf(page, '#chart figure')).description).not.toContain('Ceiling');
    expect(await page.locator('#chart').innerText()).not.toContain('Ceiling');
    expect(built.diagnostics.map(d => d.code)).toContain('AX150');
    expect(await closePage(page)).toEqual([]);
  });
});
