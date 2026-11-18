/**
 * Interaction, I1–I6 (spec 3.3): the tooltip under a real pointer, legend toggles, zoom four ways, single
 * pointer and touch, motion, and the pause control. Pointer and keys are Playwright's own input; pinch and
 * a one-finger drag go through the DevTools protocol, which Playwright's touchscreen cannot produce.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { start, stop } from '../harness';
import {
  axWithin, box, call, center, closePage, create, createRaw, devPage, intersects, plotGeometry, ring, screenshot, settle, shapes, type Box,
} from './util';
import { calendar, CARTESIAN, ENERGY, FULL, inOrder, LATENCY, share, SHIPPED, SPEND, TYPES, withUnit, type ChartType } from './fixtures';

beforeAll(start);
afterAll(stop);

type Full = Exclude<ChartType, 'compact'>;
const tooltip = (page: Page) => page.locator('#chart .axylo-tooltip');

interface Probe { x: number; y: number; expect: string[]; marks: Box[]; ordered?: boolean }

/** Whether the tooltip text says what the probe expects: in order, or (scatter, spec 3.6 lists what, not in which order) all of it. */
const says = (text: string, probe: Probe) => (probe.ordered === false ? probe.expect.every(e => text.includes(e)) : inOrder(text, probe.expect));

/** Where to point, and what the tooltip must then say, for 20 positions per type (edges included). */
async function probes(page: Page, type: Full): Promise<Probe[]> {
  const p = await box(page, '#chart .axylo-proxy');
  const drawn = await shapes(page, '#chart', type === 'bar' ? 100000 : 14);
  if (type === 'donut') {
    const g = await ring(page);
    const total = SPEND.values.reduce((a, b) => a + b, 0);
    return Array.from({ length: 20 }, (_, k) => {
      const deg = 9 + k * 18;
      let at = 0, i = 0;
      for (; i < SPEND.values.length; i++) { at += SPEND.values[i]!; if (deg < (360 * at) / total) break; }
      const a = (deg * Math.PI) / 180, r = g.outer * 0.85;
      return { x: g.cx + r * Math.sin(a), y: g.cy - r * Math.cos(a), expect: [SPEND.items[i]!, withUnit(SPEND.values[i]!, 'EUR'), share(SPEND.values[i]!)], marks: [] };
    });
  }
  if (type === 'scatter') {
    // Each point, then offsets up to 16 px (inside the 24 px picking radius); points sit on the plot's edges.
    const eu = LATENCY.points.filter(q => q.region === 'EU'), us = LATENCY.points.filter(q => q.region === 'US');
    const sortedEU = (drawn[1] ?? []).map(s => center(s.box)).sort((a, b) => a.x - b.x);
    const sortedUS = (drawn[2] ?? []).map(s => center(s.box)).sort((a, b) => a.x - b.x);
    const named = [...sortedEU.map((c, i) => ({ c, q: eu[i]! })), ...sortedUS.map((c, i) => ({ c, q: us[i]! }))];
    const offsets = [[0, 0], [10, 0], [-10, 0], [0, 12]];
    return named.flatMap(({ c, q }) => offsets.map(([dx, dy]) => ({ x: Math.min(p.x + p.width - 1, Math.max(p.x + 1, c.x + dx!)), y: Math.min(p.y + p.height - 1, Math.max(p.y + 1, c.y + dy!)), expect: [q.region, withUnit(q.size, 'kB'), withUnit(q.latency, 'ms')], marks: [], ordered: false }))).slice(0, 20);
  }
  const xs = type === 'bar' ? SHIPPED.quarters : ENERGY.days.map(calendar);
  const series = type === 'bar' ? SHIPPED.series : ENERGY.series;
  const unit = type === 'bar' ? 't' : 'kWh';
  const columns = [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1];
  const rows = [0, 0.5, 1];
  const out: Probe[] = [];
  const marks1 = (drawn[1] ?? []).map(s => s.box).sort((a, b) => a.x - b.x), marks2 = (drawn[2] ?? []).map(s => s.box).sort((a, b) => a.x - b.x);
  for (const f of columns) for (const g of rows) {
    if (out.length >= 20) break;
    const px = p.x + Math.min(p.width - 1, Math.max(1, f * p.width));
    const py = p.y + Math.min(p.height - 1, Math.max(1, g * p.height));
    // Nearest x (line, area: the marker centres), or the band under the pointer (bar: the middle of the
    // group's two bars; bands meet half-way between neighbouring groups).
    const centres = type === 'bar' ? marks1.map((m, k) => (m.x + marks2[k]!.x + marks2[k]!.width) / 2) : marks1.map(m => m.x + m.width / 2);
    const i = centres.map(c => Math.abs(c - px)).indexOf(Math.min(...centres.map(c => Math.abs(c - px))));
    out.push({ x: px, y: py, expect: [xs[i]!, series[0]!.name, withUnit(series[0]!.values[i]!, unit), series[1]!.name, withUnit(series[1]!.values[i]!, unit)], marks: [marks1[i]!, marks2[i]!].filter(Boolean) });
  }
  return out;
}

describe('I1 tooltip under the pointer', () => {
  for (const type of FULL as Full[]) {
    it(`I1 ${type}: at 20 positions, the four edges included, the tooltip shows what is there by the type's picking rule, stays inside the viewport and does not cover the active mark`, async () => {
      const page = await devPage({ css: 'body { margin: 0; } #chart { width: 100vw; height: 100vh; }' });
      await create(page, type);
      const viewport = page.viewportSize()!;
      const failures: string[] = [];
      for (const probe of await probes(page, type)) {
        // From outside the chart each time, so the last tooltip is not what the pointer lands on.
        await page.mouse.move(0, 0);
        await settle(page);
        await page.mouse.move(probe.x, probe.y);
        await settle(page);
        // The tooltip, or where it cannot fit, the fixed readout under the plot (spec I1).
        const surface = (await tooltip(page).isVisible()) ? '#chart .axylo-tooltip' : (await page.locator('#chart .axylo-readout').isVisible()) ? '#chart .axylo-readout' : null;
        if (!surface) { failures.push(`${probe.x},${probe.y}: no tooltip and no readout`); continue; }
        const text = (await page.locator(surface).textContent()) ?? '';
        if (!says(text, probe)) failures.push(`${probe.x},${probe.y}: "${text}" lacks ${JSON.stringify(probe.expect)}`);
        const t = await box(page, surface);
        if (t.x < 0 || t.y < 0 || t.x + t.width > viewport.width || t.y + t.height > viewport.height) failures.push(`${probe.x},${probe.y}: outside the viewport`);
        for (const m of probe.marks) {
          // Bars: the top of the bar, where its value is read; markers whole.
          const mark = type === 'bar' ? { x: m.x, y: m.y, width: m.width, height: Math.min(8, m.height) } : m;
          if (intersects(t, mark, 0.5)) failures.push(`${probe.x},${probe.y}: covers the mark at ${Math.round(m.x)},${Math.round(m.y)}`);
        }
      }
      expect(failures).toEqual([]);
      expect(await closePage(page)).toEqual([]);
    });

    it(`I1 ${type}: the tooltip can itself be hovered without closing (reading: the pointer moves onto it in one step); Escape closes it until the pointer reaches a different datum`, async () => {
      const page = await devPage();
      await create(page, type);
      const all = await probes(page, type);
      const first = all.find(p => p.y > 0) ?? all[0]!;
      const other = all.find(p => p.expect[0] !== first.expect[0])!;
      await page.mouse.move(first.x, first.y);
      await settle(page);
      expect(await tooltip(page).isVisible()).toBe(true);
      const t = await box(page, '#chart .axylo-tooltip');
      // Onto the tooltip in one move (reading: WCAG 1.4.13 asks that the pointer can be put on the content;
      // on a nearest-x chart the content follows a pointer that sweeps across the plot).
      await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
      await settle(page);
      expect(await tooltip(page).isVisible()).toBe(true);
      await page.mouse.move(first.x, first.y, { steps: 4 });
      await page.keyboard.press('Escape');
      await settle(page);
      expect(await tooltip(page).isVisible()).toBe(false);
      await page.mouse.move(first.x + 1, first.y + 1);
      await settle(page);
      expect(await tooltip(page).isVisible()).toBe(false);
      await page.mouse.move(other.x, other.y);
      await settle(page);
      expect(await tooltip(page).isVisible()).toBe(true);
      expect(says((await tooltip(page).textContent()) ?? '', other)).toBe(true);
      expect(await closePage(page)).toEqual([]);
    });

    if (type !== 'donut') {
      it(`I1 ${type}: with ten series ${type === 'scatter' ? 'on one coincident point' : 'at one x'} the tooltip lists eight rows and "+2 more"; in a 260 px tile the same content appears in the fixed readout under the plot`, async () => {
        const page = await devPage();
        // Long names, so eight rows make a tooltip wider than the room on either side of the plot's middle.
        const names = Array.from({ length: 10 }, (_, i) => `Region number ${i + 1}`);
        const data = type === 'scatter'
          ? names.map(s => ({ x: 5, y: 5, s })).concat([{ x: 1, y: 1, s: 'S1' }, { x: 9, y: 9, s: 'S1' }])
          : names.flatMap((s, i) => ['A', 'B', 'C'].map((x, k) => ({ x, s, y: 10 + i + k })));
        await createRaw(page, type, { title: 'Ten', data, x: 'x', y: 'y', series: 's' });
        const p = await box(page, '#chart .axylo-proxy');
        await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
        await settle(page);
        // Whichever surface shows the content (the tooltip, or the readout where it cannot fit).
        const surface = (await tooltip(page).isVisible()) ? '#chart .axylo-tooltip' : '#chart .axylo-readout';
        expect(await page.locator(`${surface} .axylo-tooltip-row:not(.axylo-tooltip-total)`).count()).toBe(8);
        expect(((await page.locator(surface).textContent()) ?? '')).toContain('+2 more');
        // A 260 px tile in a 280 px viewport: there is no room beside the marks for eight such rows. Tall, so
        // the ten legend entries still leave a readable plot (spec L8).
        await page.setViewportSize({ width: 280, height: 1000 });
        await page.evaluate(() => Object.assign((document.querySelector('#chart') as HTMLElement).style, { width: '260px', height: '760px' }));
        await settle(page);
        const q = await box(page, '#chart .axylo-proxy');
        await page.mouse.move(q.x + q.width / 2, q.y + q.height / 2);
        await settle(page);
        const readout = page.locator('#chart .axylo-readout');
        expect(await readout.isVisible()).toBe(true);
        expect(await tooltip(page).isVisible()).toBe(false);
        const plot = await box(page, '#chart .axylo-plot');
        const r = await box(page, '#chart .axylo-readout');
        expect(r.y).toBeGreaterThanOrEqual(plot.y + plot.height - 1);
        expect((await readout.textContent()) ?? '').toContain('+2 more');
        expect(await closePage(page)).toEqual([]);
      });
    }
  }

  for (const type of ['line', 'area', 'bar'] as const) {
    it(`I1 ${type}: a series with no row at the pointed x reads "No observation", distinct from "No data" for an explicit null`, async () => {
      const page = await devPage();
      // B has no row at the second x and a null at the third. The x values are irregular numbers (categories
      // for the bar), so no absent step is turned into a gap (spec F2, AX105) and the absent row stays one.
      const xs = type === 'bar' ? ['a', 'b', 'c', 'd'] : [1, 2, 5, 9];
      const data = [
        ...xs.map((x, i) => ({ x, s: 'A', y: i + 1 })),
        { x: xs[0], s: 'B', y: 5 }, { x: xs[2], s: 'B', y: null }, { x: xs[3], s: 'B', y: 6 },
      ];
      await createRaw(page, type, { title: 'Sparse', data, x: 'x', y: 'y', series: 's' });
      // Where each x is drawn: the centres of A's marks (A has a row at every x).
      const centres = ((await shapes(page, '#chart', type === 'bar' ? 100000 : 14))[1] ?? []).map(m => center(m.box)).sort((a, b) => a.x - b.x);
      expect(centres).toHaveLength(4);
      const p = await box(page, '#chart .axylo-proxy');
      const at = async (i: number) => {
        await page.mouse.move(0, 0);
        await settle(page);
        await page.mouse.move(centres[i]!.x, p.y + p.height / 2);
        await settle(page);
        return (await tooltip(page).textContent()) ?? '';
      };
      const second = await at(1);
      expect(inOrder(second, ['B', 'No observation']), second).toBe(true);
      expect(second).not.toContain('No data');
      const third = await at(2);
      expect(inOrder(third, ['B', 'No data']), third).toBe(true);
      expect(await closePage(page)).toEqual([]);
    });
  }
});

// ── I2 ────────────────────────────────────────────────────────────────────────────────────────────

describe('I2 legend toggles', () => {
  for (const type of CARTESIAN as ('line' | 'area' | 'bar' | 'scatter')[]) {
    it(`I2 ${type}: legend entries are toggle buttons with a pressed state, operable by click, Enter and Space; the marks follow`, async () => {
      const page = await devPage();
      await create(page, type);
      const name = type === 'bar' ? 'Plan' : type === 'scatter' ? 'EU' : 'North';
      const pressed = async () => (await axWithin(page, '#chart')).find(n => n.role === 'button' && n.name === name)?.props.pressed;
      const marks = async () => (await shapes(page, '#chart', 100000))[1]?.length ?? 0;
      expect(await pressed()).toBe('true');
      const shown = await marks();
      expect(shown).toBeGreaterThan(0);
      await page.locator('#chart .axylo-legend-entry', { hasText: name }).click();
      await settle(page);
      expect(await pressed()).toBe('false');
      expect(await marks()).toBe(0);
      await page.locator('#chart .axylo-legend-entry', { hasText: name }).focus();
      await page.keyboard.press('Enter');
      await settle(page);
      expect(await pressed()).toBe('true');
      expect(await marks()).toBe(shown);
      await page.keyboard.press(' ');
      await settle(page);
      expect(await pressed()).toBe('false');
      expect(await closePage(page)).toEqual([]);
    });
  }
});

// ── I3 ────────────────────────────────────────────────────────────────────────────────────────────

type Zoomable = 'line' | 'area' | 'bar' | 'scatter';
/** A chart whose x can zoom: the bar uses a date x (spec 3.6: on time, date and numeric x only). */
async function zoomable(page: Page, type: Zoomable): Promise<void> {
  if (type === 'bar') {
    const day = (k: number) => new Date(Date.UTC(2026, 0, 1) + k * 864e5).toISOString().slice(0, 10);
    await createRaw(page, 'bar', { title: 'Daily', data: Array.from({ length: 40 }, (_, k) => ({ day: day(k), v: 10 + (k % 7) })), x: { field: 'day', type: 'date' }, y: 'v' });
  } else if (type === 'scatter') {
    await createRaw(page, 'scatter', { title: 'Points', data: Array.from({ length: 40 }, (_, k) => ({ x: k, y: (k * 7) % 13 })), x: 'x', y: 'y' });
  } else {
    await createRaw(page, type, { title: 'Numbers', data: Array.from({ length: 40 }, (_, k) => ({ x: k, y: 10 + (k % 7) })), x: 'x', y: 'y' });
  }
}
const xDomain = (page: Page) => page.evaluate(() => (window as unknown as { charts: { __bench: { describe(): { xDomain: number[] } } }[] }).charts[0]!.__bench.describe().xDomain);
const width = (d: number[]) => d[1]! - d[0]!;

describe('I3 zoom four ways', () => {
  for (const type of ['line', 'area', 'bar', 'scatter'] as Zoomable[]) {
    it(`I3 ${type}: the last quarter of the x range is reached by single clicks only: Zoom in twice, then Pan right, and Reset returns`, async () => {
      const page = await devPage();
      await zoomable(page, type);
      const full = await xDomain(page);
      const button = (label: string) => page.locator('#chart [role="toolbar"] button', { hasText: label });
      await button('Zoom in').click();
      await settle(page);
      await button('Zoom in').click();
      await settle(page);
      expect(width(await xDomain(page))).toBeCloseTo(width(full) / 4, 0);
      // Single-click panning (WCAG 2.5.7): a visible control moves the window without dragging.
      expect(await button('Pan right').count()).toBe(1);
      for (let i = 0; i < 20 && (await xDomain(page))[1]! < full[1]! - 1e-9; i++) { await button('Pan right').click(); await settle(page); }
      const end = await xDomain(page);
      expect(end[1]).toBeCloseTo(full[1]!, 5);
      await button('Reset zoom').click();
      await settle(page);
      expect(await xDomain(page)).toEqual(full);
      expect(await closePage(page)).toEqual([]);
    });

    it(`I3 ${type}: dragging across the plot selects that x range`, async () => {
      const page = await devPage();
      await zoomable(page, type);
      const g = await plotGeometry(page);
      const full = g.xDomain!;
      const y = g.plot.y + g.plot.height / 2;
      await page.mouse.move(g.plot.x + 0.25 * g.plot.width, y);
      await page.mouse.down();
      await page.mouse.move(g.plot.x + 0.5 * g.plot.width, y, { steps: 6 });
      await page.mouse.up();
      await settle(page);
      const d = await xDomain(page);
      const want = [full[0]! + 0.25 * width(full), full[0]! + 0.5 * width(full)];
      expect(Math.abs(d[0]! - want[0]!)).toBeLessThanOrEqual(width(full) / 40);
      expect(Math.abs(d[1]! - want[1]!)).toBeLessThanOrEqual(width(full) / 40);
      expect(await closePage(page)).toEqual([]);
    });

    it(`I3 ${type}: from the keyboard, + and - zoom, Shift+arrows pan, 0 resets`, async () => {
      const page = await devPage();
      await zoomable(page, type);
      const full = await xDomain(page);
      await page.focus('#chart .axylo-proxy');
      await page.keyboard.press('+');
      await settle(page);
      const half = await xDomain(page);
      expect(width(half)).toBeCloseTo(width(full) / 2, 0);
      await page.keyboard.press('Shift+ArrowRight');
      await settle(page);
      expect((await xDomain(page))[0]).toBeGreaterThan(half[0]!);
      await page.keyboard.press('-');
      await settle(page);
      expect(width(await xDomain(page))).toBeCloseTo(width(full), 0);
      await page.keyboard.press('+');
      await settle(page);
      await page.keyboard.press('0');
      await settle(page);
      expect(await xDomain(page)).toEqual(full);
      expect(await closePage(page)).toEqual([]);
    });

    it(`I3 ${type}: with zoom: 'touch' a two-finger pinch zooms; without it the pinch is left to the page`, async () => {
      const pinch = async (page: Page) => {
        const g = await plotGeometry(page);
        const cx = g.plot.x + g.plot.width / 2, cy = g.plot.y + g.plot.height / 2;
        const client = await page.context().newCDPSession(page);
        const at = (d: number) => [{ x: cx - d, y: cy, id: 0 }, { x: cx + d, y: cy, id: 1 }];
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(40) });
        for (let d = 50; d <= 160; d += 10) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(d) });
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await client.detach();
        await settle(page);
      };
      const page = await devPage({ hasTouch: true });
      await zoomable(page, type);
      await call(page, 'update', [{ zoom: 'touch' }]);
      const full = await xDomain(page);
      await pinch(page);
      expect(width(await xDomain(page))).toBeLessThan(width(full) * 0.8);
      await page.close();
      const plain = await devPage({ hasTouch: true });
      await zoomable(plain, type);
      const before = await xDomain(plain);
      await pinch(plain);
      expect(await xDomain(plain)).toEqual(before);
      expect(await closePage(plain)).toEqual([]);
    });

    it(`I3 ${type}: the wheel over an unfocused plot scrolls the page; over the focused plot it zooms; with Ctrl held it never zooms`, async () => {
      const page = await devPage({ css: 'body { height: 3000px; }' });
      await zoomable(page, type);
      const full = await xDomain(page);
      const g = await plotGeometry(page);
      await page.mouse.move(g.plot.x + g.plot.width / 2, g.plot.y + g.plot.height / 2);
      await page.mouse.wheel(0, 200);
      await page.waitForFunction(() => window.scrollY > 0, null, { timeout: 5000 });
      await settle(page);
      expect(await xDomain(page)).toEqual(full);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.focus('#chart .axylo-proxy');
      await page.keyboard.down('Control');
      await page.mouse.move(g.plot.x + g.plot.width / 2, g.plot.y + g.plot.height / 2);
      await page.mouse.wheel(0, -200);
      await page.keyboard.up('Control');
      await settle(page);
      expect(await xDomain(page)).toEqual(full);
      await page.mouse.wheel(0, -200);
      await settle(page);
      expect(width(await xDomain(page))).toBeLessThan(width(full));
      expect(await closePage(page)).toEqual([]);
    });
  }
});

// ── I4 ────────────────────────────────────────────────────────────────────────────────────────────

describe('I4 single pointer, touch and target size', () => {
  for (const type of FULL as Full[]) {
    it(`I4 ${type}: every control (toolbar, legend, table pager, jump field) is at least 24 × 24 CSS px`, async () => {
      const page = await devPage();
      await create(page, type);
      // Streaming, so the Pause control is there too.
      await call(page, 'append', [more(type, 0)]);
      const small: string[] = [];
      const measure = async () => {
        for (const el of await page.locator('#chart button, #chart input:not(.axylo-proxy)').all()) {
          if (!(await el.isVisible())) continue;
          const b = (await el.boundingBox())!;
          if (b.width < 24 || b.height < 24) small.push(`${(await el.textContent()) || (await el.getAttribute('class'))}: ${b.width}×${b.height}`);
        }
      };
      await measure();
      await page.locator('#chart [role="toolbar"] button', { hasText: 'View as table' }).click();
      await settle(page);
      await measure();
      expect(small).toEqual([]);
      expect(await closePage(page)).toEqual([]);
    });

    it(`I4 ${type}: a tap shows what is under the finger, and a one-finger vertical drag over the chart scrolls the page`, async () => {
      const page = await devPage({ hasTouch: true, css: 'body { height: 3000px; }' });
      await create(page, type);
      const probe = (await probes(page, type))[type === 'donut' ? 0 : 3]!;
      await page.touchscreen.tap(probe.x, probe.y);
      await settle(page);
      expect(await tooltip(page).isVisible()).toBe(true);
      expect(says((await tooltip(page).textContent()) ?? '', probe)).toBe(true);
      const client = await page.context().newCDPSession(page);
      const p = await box(page, '#chart .axylo-proxy');
      const x = p.x + p.width / 2, y0 = p.y + p.height - 20;
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
      for (let i = 1; i <= 10; i++) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 - i * 15 }] });
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await client.detach();
      await page.waitForFunction(() => window.scrollY > 0, null, { timeout: 5000 }).catch(() => undefined);
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      expect(await closePage(page)).toEqual([]);
    });
  }
});

// ── I5 ────────────────────────────────────────────────────────────────────────────────────────────

/** Fraction of pixels that differ by more than 8 per channel. */
function changed(a: { data: Uint8Array | Buffer }, b: { data: Uint8Array | Buffer }): number {
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) if (Math.abs(a.data[i]! - b.data[i]!) > 8 || Math.abs(a.data[i + 1]! - b.data[i + 1]!) > 8 || Math.abs(a.data[i + 2]! - b.data[i + 2]!) > 8) n++;
  return n / (a.data.length / 4);
}

describe('I5 motion', () => {
  for (const type of TYPES) {
    for (const motion of ['no-preference', 'reduce'] as const) {
      it(`I5 ${type}: the first frame after fonts load equals the frame at 2.5 s within 0.1 % of pixels (prefers-reduced-motion: ${motion})`, async () => {
        const page = await devPage({ reducedMotion: motion });
        await page.evaluate(() => document.fonts.ready);
        await create(page, type);
        const first = (await screenshot(page, '#chart figure')).img;
        await page.waitForTimeout(2500);
        const later = (await screenshot(page, '#chart figure')).img;
        expect(changed(first, later)).toBeLessThanOrEqual(0.001);
        expect(await closePage(page)).toEqual([]);
      });
    }

    it(`I5 ${type}: under reduced motion an update reaches its final frame in one step; without it the update has settled 300 ms later (reading: 200 ms plus 100 ms of slack on a loaded machine)`, async () => {
      for (const motion of ['reduce', 'no-preference'] as const) {
        const page = await devPage({ reducedMotion: motion });
        await create(page, type);
        const data = type === 'donut' ? [{ item: 'Rent', spend: 300 }, { item: 'Food', spend: 900 }]
          : type === 'scatter' ? [{ size: 10, latency: 50, region: 'EU' }, { size: 30, latency: 150, region: 'US' }]
            : type === 'bar' ? [{ quarter: 'Q1', kind: 'Plan', shipped: 5 }, { quarter: 'Q2', kind: 'Plan', shipped: 60 }]
              : [{ day: '2026-03-02', site: 'North', energy: 30 }, { day: '2026-03-03', site: 'North', energy: 2 }];
        await page.evaluate(d => (window as unknown as { charts: { update(p: unknown): void }[] }).charts[0]!.update({ data: d }), data);
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
        const step = (await screenshot(page, '#chart figure')).img;
        await page.waitForTimeout(300);
        const settled = (await screenshot(page, '#chart figure')).img;
        await page.waitForTimeout(700);
        const final = (await screenshot(page, '#chart figure')).img;
        if (motion === 'reduce') expect(changed(step, final), 'reduced motion: one step').toBeLessThanOrEqual(0.001);
        expect(changed(settled, final), `${motion}: settled by 300 ms`).toBeLessThanOrEqual(0.001);
        await closePage(page);
      }
    });
  }
});

// ── I6 ────────────────────────────────────────────────────────────────────────────────────────────

function more(type: Full, k: number): unknown[] {
  const day = new Date(Date.UTC(2026, 2, 7) + k * 864e5).toISOString().slice(0, 10);
  switch (type) {
    case 'line': case 'area': return [{ day, site: 'North', energy: 10 + k }, { day, site: 'South', energy: 5 + k }];
    case 'bar': return [{ quarter: `P${k}`, kind: 'Plan', shipped: 40 + k }, { quarter: `P${k}`, kind: 'Actual', shipped: 39 + k }];
    case 'scatter': return [{ size: 40 + k, latency: 100 + k, region: 'EU' }];
    case 'donut': return [{ item: `Item ${k}`, spend: 100 + k }];
  }
}

describe('I6 pause', () => {
  for (const type of FULL as Full[]) {
    it(`I6 ${type}: append shows a Pause control; paused, new rows are buffered and nothing on screen moves; Resume applies them`, async () => {
      const page = await devPage();
      await create(page, type);
      expect(await page.locator('#chart [role="toolbar"] button', { hasText: 'Pause' }).count()).toBe(0);
      await call(page, 'append', [more(type, 0)]);
      const pause = page.locator('#chart [role="toolbar"] button', { hasText: 'Pause' });
      expect(await pause.count()).toBe(1);
      await pause.click();
      await settle(page);
      const scene = () => page.evaluate(() => document.querySelector('#chart svg.axylo-svg .axylo-scene')!.innerHTML);
      const before = await scene();
      for (let k = 1; k <= 3; k++) await call(page, 'append', [more(type, k)]);
      expect(await scene()).toBe(before);
      const resume = page.locator('#chart [role="toolbar"] button', { hasText: 'Resume' });
      expect(await resume.count()).toBe(1);
      await resume.click();
      await settle(page);
      expect(await scene()).not.toBe(before);
      // All three buffered appends arrived: the table holds them.
      await page.locator('#chart [role="toolbar"] button', { hasText: 'View as table' }).click();
      await settle(page);
      const rows = await page.locator('#chart table tbody tr').count();
      const base = type === 'scatter' ? 6 : type === 'donut' ? 4 : type === 'bar' ? 4 : 5;
      expect(rows).toBe(base + 4);
      expect(await closePage(page)).toEqual([]);
    });
  }
});
