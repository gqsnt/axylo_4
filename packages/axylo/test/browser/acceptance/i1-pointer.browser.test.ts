/**
 * Interaction, I1–I6 (spec 3.3; decision 0004 for tooltip placement): the tooltip under a real pointer,
 * legend toggles, zoom four ways, single pointer and touch, motion, and the pause control. Pointer and keys
 * are Playwright's own input; pinch and a one-finger drag go through the DevTools protocol, which
 * Playwright's touchscreen cannot produce. Frame counts and deadlines are read with the page's own clock.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { start, stop } from '../harness';
import {
  axWithin, box, call, center, closePage, compareTable, covered, create, createRaw, devPage, figureLayout, inside, plotGeometry, readRange, readTable, requireEngineFeature, ring, ENGINE, screenshot, settle, shapes, TOUCH_INPUT_REASON, valueText, type Box,
} from './util';
import { calendar, CARTESIAN, ENERGY, FULL, inOrder, LATENCY, share, SHIPPED, SPEND, SPEND_TOTAL, tableOf, TYPES, withUnit, type ChartType } from './fixtures';
import { traceMotion } from './checks';

beforeAll(start);
afterAll(stop);

type Full = Exclude<ChartType, 'compact'>;
const tooltip = (page: Page) => page.locator('#chart .axylo-tooltip');

interface Probe { x: number; y: number; expect: string[]; marks: Box[]; ordered?: boolean }

/** Whether the tooltip text says what the probe expects: in order, or (scatter, spec 3.6 lists what, not in which order) all of it. */
const says = (text: string, probe: Probe) => (probe.ordered === false ? probe.expect.every(e => text.includes(e)) : inOrder(text, probe.expect));

/** Where to point, what must then be shown, and the active marks that must stay uncovered: 20 positions per type, edges included. */
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
      const x = g.cx + r * Math.sin(a), y = g.cy - r * Math.cos(a);
      // The active mark is the slice; the part of it under the pointer (12 px around it) must stay visible.
      return { x, y, expect: [SPEND.items[i]!, withUnit(SPEND.values[i]!, 'EUR'), share(SPEND.values[i]!)], marks: [{ x: x - 6, y: y - 6, width: 12, height: 12 }] };
    });
  }
  if (type === 'scatter') {
    // Each point, then offsets up to 12 px (inside the 24 px picking radius); the point's own mark is the active one.
    const eu = LATENCY.points.filter(q => q.region === 'EU'), us = LATENCY.points.filter(q => q.region === 'US');
    const sortedEU = (drawn[1] ?? []).map(s => s.box).sort((a, b) => a.x - b.x);
    const sortedUS = (drawn[2] ?? []).map(s => s.box).sort((a, b) => a.x - b.x);
    const named = [...sortedEU.map((b, i) => ({ b, q: eu[i]! })), ...sortedUS.map((b, i) => ({ b, q: us[i]! }))];
    const offsets = [[0, 0], [10, 0], [-10, 0], [0, 12]];
    return named.flatMap(({ b, q }) => offsets.map(([dx, dy]) => ({ x: Math.min(p.x + p.width - 1, Math.max(p.x + 1, center(b).x + dx!)), y: Math.min(p.y + p.height - 1, Math.max(p.y + 1, center(b).y + dy!)), expect: [q.region, withUnit(q.size, 'kB'), withUnit(q.latency, 'ms')], marks: [b], ordered: false }))).slice(0, 20);
  }
  const xs = type === 'bar' ? SHIPPED.quarters : ENERGY.days.map(calendar);
  const series = type === 'bar' ? SHIPPED.series : ENERGY.series;
  const unit = type === 'bar' ? 't' : 'kWh';
  const out: Probe[] = [];
  const marks1 = (drawn[1] ?? []).map(s => s.box).sort((a, b) => a.x - b.x), marks2 = (drawn[2] ?? []).map(s => s.box).sort((a, b) => a.x - b.x);
  for (const f of [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1]) for (const g of [0, 0.5, 1]) {
    if (out.length >= 20) break;
    const px = p.x + Math.min(p.width - 1, Math.max(1, f * p.width));
    const py = p.y + Math.min(p.height - 1, Math.max(1, g * p.height));
    // Nearest x (line, area: the marker centres), or the band under the pointer (bar: the middle of the group).
    const centres = type === 'bar' ? marks1.map((m, k) => (m.x + marks2[k]!.x + marks2[k]!.width) / 2) : marks1.map(m => m.x + m.width / 2);
    const i = centres.map(c => Math.abs(c - px)).indexOf(Math.min(...centres.map(c => Math.abs(c - px))));
    // Bars: the whole bars of the group are the active marks (decision 0004: clearance from the active mark).
    out.push({ x: px, y: py, expect: [xs[i]!, series[0]!.name, withUnit(series[0]!.values[i]!, unit), series[1]!.name, withUnit(series[1]!.values[i]!, unit)], marks: [marks1[i]!, marks2[i]!].filter(Boolean) });
  }
  return out;
}

/** Counts animation frames in the page and records, per pointer move, the frame of the move and of the next change to the tooltip or readout. */
async function frameClock(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { clock: { frame: number; moved: number; shown: number } };
    w.clock = { frame: 0, moved: -1, shown: -1 };
    const tick = () => { w.clock.frame++; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    document.addEventListener('pointermove', () => { w.clock.moved = w.clock.frame; w.clock.shown = -1; }, true);
    const seen = () => { if (w.clock.shown < 0 && w.clock.moved >= 0) w.clock.shown = w.clock.frame; };
    for (const sel of ['#chart .axylo-tooltip', '#chart .axylo-readout']) {
      new MutationObserver(seen).observe(document.querySelector(sel)!, { childList: true, subtree: true, characterData: true, attributes: true });
    }
  });
}

/**
 * Resizes the chart's container along `axis` until its plot (the keyboard proxy's box) is `target` CSS px,
 * ±0.5, by bisection between 40 and 1100 px (a container too small for a plot counts as too small); returns
 * the plot size reached.
 */
async function plotTo(page: Page, axis: 'width' | 'height', target: number): Promise<number> {
  const measure = async (size: number) => {
    await page.evaluate(([a, s]) => { (document.querySelector('#chart') as HTMLElement).style[a as 'width' | 'height'] = `${s}px`; }, [axis, size] as const);
    await settle(page);
    const b = await page.locator('#chart .axylo-proxy').boundingBox();
    return b && (await page.locator('#chart .axylo-proxy').isVisible()) ? b[axis] : 0;
  };
  let lo = 40, hi = 1100, got = 0;
  for (let i = 0; i < 24; i++) {
    const mid = Math.round(((lo + hi) / 2) * 4) / 4;
    got = await measure(mid);
    if (Math.abs(got - target) <= 0.5) return got;
    if (got < target) lo = mid; else hi = mid;
    if (hi - lo < 0.25) break;
  }
  return got;
}

/**
 * Both sides of the readout-mode limit along `axis`. Entering readout mode reserves the strip, so the plot
 * jumps across the limit (about 140 → 92 px in height) and no size exists in between. By bisection on the
 * container's size: the smallest container whose plot is at least `limit` (floating mode) and the largest
 * whose plot is under it (readout mode), each with the plot size measured there.
 */
async function plotSides(page: Page, axis: 'width' | 'height', limit: number): Promise<{ floating: { container: number; plot: number }; readout: { container: number; plot: number } }> {
  const measure = async (size: number) => {
    await page.evaluate(([a, s]) => { (document.querySelector('#chart') as HTMLElement).style[a as 'width' | 'height'] = `${s}px`; }, [axis, size] as const);
    await settle(page);
    const b = await page.locator('#chart .axylo-proxy').boundingBox();
    return b && (await page.locator('#chart .axylo-proxy').isVisible()) ? b[axis] : 0;
  };
  let lo = 40, hi = 1100;
  let floating = { container: hi, plot: await measure(hi) };
  let readout = { container: lo, plot: 0 };
  while (hi - lo > 0.25) {
    const mid = Math.round(((lo + hi) / 2) * 4) / 4;
    const plot = await measure(mid);
    if (plot >= limit) { hi = mid; floating = { container: mid, plot }; } else { lo = mid; readout = { container: mid, plot }; }
  }
  return { floating, readout };
}

describe('I1 tooltip under the pointer', () => {
  for (const type of FULL as Full[]) {
    it(`I1 ${type}: at 20 positions, the four edges included, what is there is shown by the type's picking rule within one frame of the move (95th percentile, counted in animation frames), inside the viewport, without covering the active mark`, async () => {
      const page = await devPage({ css: 'body { margin: 0; } #chart { width: 100vw; height: 100vh; }' });
      await create(page, type);
      await frameClock(page);
      const viewport = page.viewportSize()!;
      const failures: string[] = [];
      const latency: number[] = [];
      const all = await probes(page, type);
      for (const probe of all) {
        if (!probe.marks.length) { failures.push(`${probe.x},${probe.y}: no active mark located`); continue; }
        // From outside the chart each time, so the last tooltip is not what the pointer lands on.
        await page.mouse.move(0, 0);
        await settle(page);
        await page.mouse.move(probe.x, probe.y);
        await settle(page);
        const clock = await page.evaluate(() => (window as unknown as { clock: { moved: number; shown: number } }).clock);
        latency.push(clock.shown < 0 ? Infinity : clock.shown - clock.moved);
        // The tooltip, or where it cannot fit, the fixed readout under the plot (spec I1).
        const surface = (await tooltip(page).isVisible()) ? '#chart .axylo-tooltip' : (await page.locator('#chart .axylo-readout').isVisible()) ? '#chart .axylo-readout' : null;
        if (!surface) { failures.push(`${probe.x},${probe.y}: no tooltip and no readout`); continue; }
        const text = (await page.locator(surface).textContent()) ?? '';
        if (!says(text, probe)) failures.push(`${probe.x},${probe.y}: "${text}" lacks ${JSON.stringify(probe.expect)}`);
        const t = await box(page, surface);
        if (t.x < 0 || t.y < 0 || t.x + t.width > viewport.width || t.y + t.height > viewport.height) failures.push(`${probe.x},${probe.y}: outside the viewport`);
        for (const m of covered(t, probe.marks)) failures.push(`${probe.x},${probe.y}: covers the active mark at ${Math.round(m.x)},${Math.round(m.y)}`);
      }
      expect(failures).toEqual([]);
      const sorted = [...latency].sort((a, b) => a - b);
      expect(sorted[Math.ceil(0.95 * sorted.length) - 1], `frames from move to readout: ${latency.join(', ')}`).toBeLessThanOrEqual(1);
      expect(await closePage(page)).toEqual([]);
    });

    it(`I1 ${type}: the tooltip can itself be hovered (decision 0004 revision 2, rule 3b): after a 300 ms rest on the datum, moving straight onto the tooltip's rectangle, it stays for the same datum (same rows) and does not move at every step; with the pointer inside it, it is still shown; Escape closes it until another datum`, async () => {
      const page = await devPage();
      await create(page, type);
      const all = await probes(page, type);
      const first = all[type === 'donut' ? 2 : type === 'scatter' ? 4 : 10]!;
      const other = all.find(p => p.expect[0] !== first.expect[0])!;
      await page.mouse.move(first.x, first.y);
      await settle(page);
      expect(await tooltip(page).isVisible()).toBe(true);
      const rows = () => page.locator('#chart .axylo-tooltip .axylo-tooltip-row').allTextContents();
      const startRows = await rows();
      expect(says(startRows.join(' ') + ((await page.locator('#chart .axylo-tooltip .axylo-tooltip-title').textContent()) ?? ''), first) || says((await tooltip(page).textContent()) ?? '', first)).toBe(true);
      const startBox = await box(page, '#chart .axylo-tooltip');
      // Rest 300 ms on the datum (decision 0004 rule 3b: a rest of 250 ms holds the datum along the corridor to
      // a tooltip that is not across the reading axis; harmless where it is). Then straight onto the rectangle,
      // to its point nearest the datum, 2 px inside, in 24 steps, every one checked from the first.
      await page.waitForTimeout(300);
      const target = { x: Math.min(startBox.x + startBox.width - 2, Math.max(startBox.x + 2, first.x)), y: Math.min(startBox.y + startBox.height - 2, Math.max(startBox.y + 2, first.y)) };
      const failures: string[] = [];
      for (let k = 1; k <= 24; k++) {
        await page.mouse.move(first.x + ((target.x - first.x) * k) / 24, first.y + ((target.y - first.y) * k) / 24);
        await settle(page);
        if (!(await tooltip(page).isVisible())) { failures.push(`step ${k}: the tooltip closed`); break; }
        const now = await rows();
        if (JSON.stringify(now) !== JSON.stringify(startRows)) { failures.push(`step ${k}: rows changed to ${JSON.stringify(now)}`); break; }
        const b = await box(page, '#chart .axylo-tooltip');
        if (Math.abs(b.x - startBox.x) > 0.5 || Math.abs(b.y - startBox.y) > 0.5 || Math.abs(b.width - startBox.width) > 0.5 || Math.abs(b.height - startBox.height) > 0.5) { failures.push(`step ${k}: the tooltip moved from ${JSON.stringify(startBox)} to ${JSON.stringify(b)}`); break; }
      }
      expect(failures).toEqual([]);
      const end = await box(page, '#chart .axylo-tooltip');
      expect(inside({ ...target, width: 0, height: 0 }, end, 0), 'the pointer is inside the tooltip\'s rectangle').toBe(true);
      await page.keyboard.press('Escape');
      await settle(page);
      expect(await tooltip(page).isVisible()).toBe(false);
      await page.mouse.move(first.x, first.y);
      await settle(page);
      expect(await tooltip(page).isVisible()).toBe(false);
      await page.mouse.move(other.x, other.y);
      await settle(page);
      expect(await tooltip(page).isVisible()).toBe(true);
      expect(says((await tooltip(page).textContent()) ?? '', other)).toBe(true);
      expect(await closePage(page)).toEqual([]);
    });

    it(`I1 ${type}: a hovered tooltip is text, not controls (no button in Chrome's tree); a click on the plot pins it for that datum, its rows become buttons of at least 24 × 24 CSS px that select their series, and Escape dismisses it`, async () => {
      const page = await devPage();
      await create(page, type);
      await page.evaluate(() => {
        const w = window as unknown as { selected: string[]; charts: { on(e: string, f: (p: unknown) => void): void }[] };
        w.selected = [];
        w.charts[0]!.on('select', p => w.selected.push((p as { series: string }).series));
      });
      const probe = (await probes(page, type))[type === 'donut' ? 2 : type === 'scatter' ? 4 : 10]!;
      await page.mouse.move(probe.x, probe.y);
      await settle(page);
      // Off Chromium the accessibility tree is not readable; the DOM gives the same evidence for buttons, which have no
      // other source of the role than the element or its role attribute.
      const buttonsIn = async () => ENGINE === 'chromium'
        ? (await axWithin(page, '#chart .axylo-tooltip').catch(() => [])).filter(n => n.role === 'button')
        : await page.locator('#chart .axylo-tooltip button:visible, #chart .axylo-tooltip [role="button"]:visible').allTextContents();
      expect(await buttonsIn(), 'a hovered tooltip holds no buttons').toEqual([]);
      await page.mouse.down();
      await page.mouse.up();
      await settle(page);
      const pinned = page.locator('#chart .axylo-tooltip button, #chart .axylo-tooltip [role="button"]');
      const n = await pinned.count();
      expect(n, 'the pinned tooltip has a button per row').toBeGreaterThan(0);
      const small: string[] = [];
      for (const b of await pinned.all()) { const r = (await b.boundingBox())!; if (r.width < 24 || r.height < 24) small.push(`${await b.textContent()}: ${r.width.toFixed(1)}×${r.height.toFixed(1)}`); }
      expect(small).toEqual([]);
      const before = await page.evaluate(() => (window as unknown as { selected: string[] }).selected.length);
      const last = pinned.nth(n - 1);
      const name = ((await last.textContent()) ?? '').trim();
      await last.click();
      await settle(page);
      const selected = await page.evaluate(() => (window as unknown as { selected: string[] }).selected);
      expect(selected.length).toBe(before + 1);
      expect(name.startsWith(selected.at(-1)!), `"${name}" selects "${selected.at(-1)}"`).toBe(true);
      await page.keyboard.press('Escape');
      await settle(page);
      expect(await tooltip(page).isVisible()).toBe(false);
      expect(await closePage(page)).toEqual([]);
    });

    if (type !== 'scatter' && type !== 'donut') {
      it(`I1 ${type}: a hovered tooltip never stalls picking: a fast sweep along the reading axis through the tooltip's rectangle shows a new datum at every step, and a click with the pointer over the tooltip selects the datum under the pointer`, async () => {
        const page = await devPage();
        await create(page, type);
        await page.evaluate(() => {
          const w = window as unknown as { picked: unknown[]; charts: { on(e: string, f: (p: unknown) => void): void }[] };
          w.picked = [];
          w.charts[0]!.on('select', p => w.picked.push((p as { x: unknown }).x));
        });
        const xs = ((await shapes(page, '#chart', type === 'bar' ? 100000 : 14))[1] ?? []).map(s => center(s.box).x).sort((a, b) => a - b);
        const labels = type === 'bar' ? SHIPPED.quarters : ENERGY.days.map(calendar);
        await page.mouse.move(xs[2]!, (await box(page, '#chart .axylo-proxy')).y + 20);
        await settle(page);
        const t = await box(page, '#chart .axylo-tooltip');
        const y = t.y + t.height / 2;
        // One move per datum, at the tooltip's height, without intermediate moves: each lands on a new nearest x.
        const shown: string[] = [];
        for (const x of xs) {
          await page.mouse.move(x, y, { steps: 1 });
          await settle(page);
          shown.push((await page.locator('#chart .axylo-tooltip .axylo-tooltip-title').textContent()) ?? '');
        }
        expect(shown).toEqual(labels);
        // Back to the third datum, then a click at a point inside its tooltip: the click selects the datum under
        // the pointer, the nearest x to the click point (which is the third one when the tooltip spans its x).
        await page.mouse.move(0, 0);
        await page.mouse.move(xs[2]!, (await box(page, '#chart .axylo-proxy')).y + 20);
        await settle(page);
        const over = await box(page, '#chart .axylo-tooltip');
        const click = { x: Math.min(over.x + over.width - 2, Math.max(over.x + 2, xs[2]!)), y: over.y + over.height / 2 };
        const nearest = xs.map(x => Math.abs(x - click.x)).indexOf(Math.min(...xs.map(x => Math.abs(x - click.x))));
        await page.mouse.move(click.x, click.y);
        await settle(page);
        if (nearest === 2) expect(inside({ ...click, width: 0, height: 0 }, await box(page, '#chart .axylo-tooltip'), 0), 'the pointer is over the tooltip').toBe(true);
        await page.mouse.down();
        await page.mouse.up();
        await settle(page);
        const picked = await page.evaluate(() => (window as unknown as { picked: unknown[] }).picked);
        expect(picked).toHaveLength(1);
        expect(picked[0]).toBe(type === 'bar' ? SHIPPED.quarters[nearest] : ENERGY.days[nearest]);
        expect(await closePage(page)).toEqual([]);
      });
    }

    it(`I1 ${type}: outside readout mode a tooltip never overlaps a control, shown for the pointer or for the keyboard`, async () => {
      const failures: string[] = [];
      for (const css of ['', '#chart { width: 420px; height: 320px; }']) {
        const page = await devPage({ css });
        await create(page, type);
        const plot = await box(page, '#chart .axylo-proxy');
        expect(plot.width >= 240 && plot.height >= 140, `${css || 'default'}: not in readout mode`).toBe(true);
        const controls = async () => {
          const out: Box[] = [];
          for (const b of await page.locator('#chart button, #chart .axylo-legend-list li, #chart input:not(.axylo-proxy)').all()) if (await b.isVisible()) out.push((await b.boundingBox())!);
          return out;
        };
        const check = async (how: string) => {
          if (!(await tooltip(page).isVisible())) return;
          for (const c of covered(await box(page, '#chart .axylo-tooltip'), await controls())) failures.push(`${css || 'default'} ${how}: the tooltip covers a control at ${Math.round(c.x)},${Math.round(c.y)}`);
        };
        for (const probe of (await probes(page, type)).filter((_, i) => i % 2 === 0)) {
          await page.mouse.move(0, 0);
          await settle(page);
          await page.mouse.move(probe.x, probe.y);
          await settle(page);
          await check('pointer');
        }
        await page.mouse.move(0, 0);
        await page.focus('#before');
        await page.keyboard.press('Tab');
        for (let i = 0; i < 4; i++) { await page.keyboard.press('ArrowRight'); await settle(page); await check('keyboard'); }
        await closePage(page);
      }
      expect(failures).toEqual([]);
    });

    for (const axis of ['width', 'height'] as const) {
      it(`I1 ${type}: readout mode is decided by layout: on each side of the ${axis === 'width' ? '240 px width' : '140 px height'} limit (the plot jumps across it when the strip is reserved), a plot at or above it gets a floating tooltip and one below it gets the content in a strip reserved under the plot, with no floating tooltip; showing or hiding a datum moves nothing; the strip covers nothing and nothing covers it`, async () => {
        const page = await devPage({ viewport: { width: 1000, height: 900 } });
        await create(page, type);
        const limit = axis === 'width' ? 240 : 140;
        const sides = await plotSides(page, axis, limit);
        for (const [side, readout] of [[sides.floating, false], [sides.readout, true]] as const) {
          await page.evaluate(([a, s]) => { (document.querySelector('#chart') as HTMLElement).style[a as 'width' | 'height'] = `${s}px`; }, [axis, side.container] as const);
          await settle(page);
          const got = (await box(page, '#chart .axylo-proxy'))[axis];
          const target = `${got.toFixed(1)} px`;
          expect(readout ? got > 0 && got < limit : got >= limit, `${readout ? 'readout' : 'floating'} side: plot ${axis} ${target}`).toBe(true);
          const layout = () => figureLayout(page);
          await page.mouse.move(0, 0);
          await settle(page);
          const hidden = await layout();
          const p = (await probes(page, type))[type === 'donut' ? 2 : type === 'scatter' ? 4 : 10]!;
          await page.mouse.move(p.x, p.y);
          await settle(page);
          const strip = page.locator('#chart .axylo-readout');
          if (readout) {
            expect(await tooltip(page).isVisible(), `${target} px: no floating tooltip in readout mode`).toBe(false);
            expect(await strip.isVisible(), `${target} px: the strip shows the datum`).toBe(true);
            expect(says((await strip.textContent()) ?? '', p), `${target} px: strip text`).toBe(true);
            const s = await box(page, '#chart .axylo-readout');
            const plotBox = await box(page, '#chart .axylo-plot');
            expect(s.y, 'under the plot').toBeGreaterThanOrEqual(plotBox.y + plotBox.height - 0.5);
            const lines = await strip.evaluate(el => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
            expect(lines).toBeLessThanOrEqual(2);
            // Covers nothing and is covered by nothing: no other visible element of the figure intersects it, and
            // what is at its centre is the strip.
            const others: Box[] = [];
            for (const e of await page.locator('#chart button, #chart .axylo-legend-list li, #chart .axylo-note, #chart .axylo-plot').all()) if (await e.isVisible()) others.push((await e.boundingBox())!);
            expect(covered(s, others).map(o => `${Math.round(o.x)},${Math.round(o.y)}`)).toEqual([]);
            const atCentre = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.axylo-readout'), center(s));
            expect(atCentre).toBe(true);
          } else {
            expect(await tooltip(page).isVisible(), `${target} px: a floating tooltip`).toBe(true);
          }
          expect(await layout(), `${target} px: showing a datum moved the layout`).toBe(hidden);
          await page.mouse.move(0, 0);
          await settle(page);
          expect(await layout(), `${target} px: hiding it moved the layout`).toBe(hidden);
        }
        expect(await closePage(page)).toEqual([]);
      });
    }

    if (type !== 'donut') {
      it(`I1 ${type}: with ten series ${type === 'scatter' ? 'on one coincident point' : 'at one x'} the tooltip lists eight of the series by name and "+2 more"; in readout mode the strip, on at most two lines, names the same series in the same order up to where it is cut and counts the rest in "+N more"`, async () => {
        const page = await devPage({ viewport: { width: 1000, height: 1000 } });
        const names = Array.from({ length: 10 }, (_, i) => `Region number ${i + 1}`);
        const data = type === 'scatter'
          ? names.map(s => ({ x: 5, y: 5, s })).concat([{ x: 1, y: 1, s: names[0]! }, { x: 9, y: 9, s: names[0]! }])
          : names.flatMap((s, i) => ['A', 'B', 'C'].map((x, k) => ({ x, s, y: 10 + i + k })));
        await createRaw(page, type, { title: 'Ten', data, x: 'x', y: 'y', series: 's' });
        const p = await box(page, '#chart .axylo-proxy');
        await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
        await settle(page);
        expect(await tooltip(page).isVisible()).toBe(true);
        const shown = await page.locator('#chart .axylo-tooltip .axylo-tooltip-row:not(.axylo-tooltip-total) .axylo-tooltip-series').allTextContents();
        expect(shown).toHaveLength(8);
        expect(new Set(shown).size).toBe(8);
        expect(shown.every(n => names.includes(n))).toBe(true);
        expect((await tooltip(page).textContent()) ?? '').toContain('+2 more');
        await page.mouse.move(0, 0);
        // Tall, so the ten legend entries still leave a readable plot at that width (spec L8).
        await page.evaluate(() => { (document.querySelector('#chart') as HTMLElement).style.height = '760px'; });
        const got = await plotTo(page, 'width', 200);
        expect(got).toBeLessThan(240);
        expect(got).toBeGreaterThan(120);
        const q = await box(page, '#chart .axylo-proxy');
        await page.mouse.move(q.x + q.width / 2, q.y + q.height / 2);
        await settle(page);
        const strip = page.locator('#chart .axylo-readout');
        expect(await strip.isVisible()).toBe(true);
        expect(await tooltip(page).isVisible()).toBe(false);
        const text = (await strip.textContent()) ?? '';
        const inStrip = names.filter(n => new RegExp(`${n}(?!\\d)`).test(text)).sort((a, b) => text.indexOf(a) - text.indexOf(b));
        expect(inStrip.length).toBeGreaterThan(0);
        // In the tooltip's order, from its start.
        expect(inStrip).toEqual(shown.slice(0, inStrip.length));
        const more = /\+(\d+) more/.exec(text);
        expect(more, 'the strip counts the rest').not.toBeNull();
        expect(Number(more![1])).toBe(10 - inStrip.length);
        const lines = await strip.evaluate(el => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
        expect(lines).toBeLessThanOrEqual(2);
        expect(await closePage(page)).toEqual([]);
      });
    }
  }

  /** Bars that fill the plot's height (author domain [0, 100]), so a tooltip cannot go above or below and is placed beside. */
  async function besideBars(page: Page): Promise<{ centres: number[]; tip: Box; plot: Box }> {
    await createRaw(page, 'bar', { title: 'Tall', data: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6'].map(q => ({ q, v: 100 })), x: 'q', y: { field: 'v', domain: [0, 100] } });
    const centres = ((await shapes(page, '#chart', 100000))[1] ?? []).map(s => center(s.box).x).sort((a, b) => a - b);
    const plot = await box(page, '#chart .axylo-proxy');
    await page.mouse.move(centres[2]!, plot.y + plot.height / 2);
    await settle(page);
    const tip = await box(page, '#chart .axylo-tooltip');
    return { centres, tip, plot };
  }
  const title = async (page: Page) => ((await tooltip(page).isVisible()) ? ((await page.locator('#chart .axylo-tooltip .axylo-tooltip-title').textContent()) ?? '') : '');

  it('I1 bar: rule 3b converse: without a rest, the straight path to a tooltip placed beside a full-height bar changes the datum as soon as it crosses into the next band', async () => {
    const page = await devPage();
    const { centres, tip, plot } = await besideBars(page);
    // Precondition: the tooltip is beside the bar (not above or below), so the path to it crosses bands.
    expect(tip.x > centres[2]! || tip.x + tip.width < centres[2]!, `tooltip ${JSON.stringify(tip)} beside the bar at ${centres[2]}`).toBe(true);
    const y = plot.y + plot.height / 2;
    const toward = tip.x > centres[2]! ? 1 : -1;
    const next = centres[2 + toward]!;
    // No rest: arrive and leave at once, in steps of 6 px, past the half-way line to the next band.
    await page.mouse.move(0, 0);
    await page.mouse.move(centres[2]!, y);
    const seen: string[] = [];
    for (let x = centres[2]!; toward > 0 ? x <= next : x >= next; x += 6 * toward) {
      await page.mouse.move(x, y, { steps: 1 });
      seen.push(await title(page));
    }
    await settle(page);
    seen.push(await title(page));
    expect(seen.at(-1), `datum after crossing: ${seen.join(' → ')}`).toBe(toward > 0 ? 'Q4' : 'Q2');
    expect(await closePage(page)).toEqual([]);
  });

  it('I1 bar: rule 3b converse: after a rest, leaving the corridor to the tooltip sideways resumes picking on that move', async () => {
    const page = await devPage();
    const { centres, tip, plot } = await besideBars(page);
    const y = plot.y + plot.height / 2;
    await page.waitForTimeout(300);
    // Part of the way along the corridor (held), then straight up out of it, over the next band.
    const toward = tip.x > centres[2]! ? 1 : -1;
    const next = centres[2 + toward]!;
    await page.mouse.move(next, y, { steps: 6 });
    await settle(page);
    expect(await title(page), 'held along the corridor').toBe('Q3');
    await page.mouse.move(next, Math.max(plot.y + 4, tip.y - 30), { steps: 1 });
    await settle(page);
    expect(await title(page), 'out of the corridor: the band under the pointer').toBe(toward > 0 ? 'Q4' : 'Q2');
    expect(await closePage(page)).toEqual([]);
  });

  it('I1 bar: a fast sweep that never rests is never held: one move per band, across a tooltip placed beside the bars, shows every band in turn', async () => {
    const page = await devPage();
    const { centres, plot } = await besideBars(page);
    const y = plot.y + plot.height / 2;
    await page.mouse.move(0, 0);
    const shown: string[] = [];
    for (const x of centres) { await page.mouse.move(x, y, { steps: 1 }); await settle(page); shown.push(await title(page)); }
    expect(shown).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6']);
    expect(await closePage(page)).toEqual([]);
  });

  it('I1 donut: a fast sweep that never rests is never held: one move per slice, around the ring, shows every slice in turn', async () => {
    const page = await devPage();
    await create(page, 'donut');
    const g = await ring(page);
    await page.mouse.move(0, 0);
    const shown: string[] = [];
    let before = 0;
    for (let i = 0; i < SPEND.values.length; i++) {
      const a = (2 * Math.PI * (before + SPEND.values[i]! / 2)) / SPEND_TOTAL;
      before += SPEND.values[i]!;
      await page.mouse.move(g.cx + 0.85 * g.outer * Math.sin(a), g.cy - 0.85 * g.outer * Math.cos(a), { steps: 1 });
      await settle(page);
      shown.push((await tooltip(page).isVisible()) ? ((await tooltip(page).textContent()) ?? '') : '');
    }
    SPEND.items.forEach((item, i) => expect(shown[i], `slice ${i + 1}`).toContain(item));
    expect(await closePage(page)).toEqual([]);
  });

  for (const type of ['line', 'area', 'bar'] as const) {
    it(`I1 ${type}: a series with no row at the pointed x reads "No observation", distinct from "No data" for an explicit null`, async () => {
      const page = await devPage();
      // B has no row at the second x and a null at the third. The x values are irregular numbers (categories
      // for the bar), so no absent step is turned into a gap (spec F2, AX105) and the absent row stays one.
      const xs = type === 'bar' ? ['a', 'b', 'c', 'd'] : [1, 2, 5, 9];
      const data = [...xs.map((x, i) => ({ x, s: 'A', y: i + 1 })), { x: xs[0], s: 'B', y: 5 }, { x: xs[2], s: 'B', y: null }, { x: xs[3], s: 'B', y: 6 }];
      await createRaw(page, type, { title: 'Sparse', data, x: 'x', y: 'y', series: 's' });
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
    it(`I2 ${type}: legend entries are toggle buttons with a pressed state, operable by click, Enter and Space; after each, the marks follow`, async () => {
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
      expect(await marks()).toBe(0);
      expect(await closePage(page)).toEqual([]);
    });
  }
});

// ── I3 ────────────────────────────────────────────────────────────────────────────────────────────

type Zoomable = 'line' | 'area' | 'bar' | 'bar (date)' | 'scatter';
/** A chart whose x can zoom: bars on a number and on a date axis (spec 3.6: never a category axis). */
async function zoomable(page: Page, type: Zoomable): Promise<void> {
  if (type === 'bar (date)') {
    const day = (k: number) => new Date(Date.UTC(2026, 0, 1) + k * 864e5).toISOString().slice(0, 10);
    await createRaw(page, 'bar', { title: 'Daily', data: Array.from({ length: 40 }, (_, k) => ({ day: day(k), v: 10 + (k % 7) })), x: { field: 'day', type: 'date' }, y: 'v' });
  } else if (type === 'scatter') {
    await createRaw(page, 'scatter', { title: 'Points', data: Array.from({ length: 40 }, (_, k) => ({ x: k, y: (k * 7) % 13 })), x: 'x', y: 'y' });
  } else {
    await createRaw(page, type, { title: 'Numbers', data: Array.from({ length: 40 }, (_, k) => ({ x: k, y: 10 + (k % 7) })), x: { field: 'x', type: 'number' }, y: 'y' });
  }
}
const xDomain = (page: Page) => page.evaluate(() => (window as unknown as { charts: { __bench: { describe(): { xDomain: number[] } } }[] }).charts[0]!.__bench.describe().xDomain);
const width = (d: number[]) => d[1]! - d[0]!;
const cell = (t: Zoomable): ChartType => (t === 'bar (date)' ? 'bar' : t);

describe('I3 zoom four ways', () => {
  for (const type of ['line', 'area', 'bar', 'bar (date)', 'scatter'] as Zoomable[]) {
    it(`I3 ${cell(type)}${type === 'bar (date)' ? ' (date axis)' : type === 'bar' ? ' (number axis)' : ''}: by single clicks only: Zoom in twice quarters the range, Zoom out doubles it, Pan right reaches the end, Reset returns`, async () => {
      const page = await devPage();
      await zoomable(page, type);
      const full = await xDomain(page);
      const button = (label: string) => page.locator('#chart [role="toolbar"] button', { hasText: label });
      await button('Zoom in').click();
      await settle(page);
      await button('Zoom in').click();
      await settle(page);
      expect(width(await xDomain(page))).toBeCloseTo(width(full) / 4, 0);
      await button('Zoom out').click();
      await settle(page);
      expect(width(await xDomain(page))).toBeCloseTo(width(full) / 2, 0);
      // Single-click panning (WCAG 2.5.7): a visible control moves the window without dragging.
      expect(await button('Pan right').count()).toBe(1);
      for (let i = 0; i < 20 && (await xDomain(page))[1]! < full[1]! - 1e-9; i++) { await button('Pan right').click(); await settle(page); }
      expect((await xDomain(page))[1]).toBeCloseTo(full[1]!, 5);
      await button('Reset zoom').click();
      await settle(page);
      expect(await xDomain(page)).toEqual(full);
      expect(await closePage(page)).toEqual([]);
    });

    it(`I3 ${cell(type)}${type === 'bar (date)' ? ' (date axis)' : type === 'bar' ? ' (number axis)' : ''}: dragging across the plot selects that x range`, async () => {
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

    it(`I3 ${cell(type)}${type === 'bar (date)' ? ' (date axis)' : type === 'bar' ? ' (number axis)' : ''}: from the keyboard, each of +, Shift+Right, Shift+Left, - and 0 has its own effect, checked after each key`, async () => {
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
      const right = await xDomain(page);
      expect(right[0]).toBeGreaterThan(half[0]!);
      expect(width(right)).toBeCloseTo(width(half), 0);
      await page.keyboard.press('Shift+ArrowLeft');
      await settle(page);
      expect((await xDomain(page))[0]).toBeLessThan(right[0]!);
      await page.keyboard.press('-');
      await settle(page);
      expect(width(await xDomain(page))).toBeCloseTo(width(full), 0);
      await page.keyboard.press('+');
      await settle(page);
      expect(width(await xDomain(page))).toBeLessThan(width(full));
      await page.keyboard.press('0');
      await settle(page);
      expect(await xDomain(page)).toEqual(full);
      expect(await closePage(page)).toEqual([]);
    });

    it(`I3 ${cell(type)}${type === 'bar (date)' ? ' (date axis)' : type === 'bar' ? ' (number axis)' : ''}: with zoom: 'touch' a two-finger pinch zooms; without it the pinch is left to the page: the chart's range is unchanged and the browser's default is not prevented`, async () => {
      const pinch = async (page: Page) => {
        const g = await plotGeometry(page);
        const cx = g.plot.x + g.plot.width / 2, cy = g.plot.y + g.plot.height / 2;
        await page.evaluate(() => {
          const w = window as unknown as { prevented: number };
          w.prevented = 0;
          // Registered on the window after the chart's own listeners: sees whether they cancelled the gesture.
          for (const t of ['touchstart', 'touchmove']) window.addEventListener(t, e => { if (e.defaultPrevented) w.prevented++; }, { passive: true });
        });
        requireEngineFeature(['chromium'], TOUCH_INPUT_REASON);
        const client = await page.context().newCDPSession(page);
        const at = (d: number) => [{ x: cx - d, y: cy, id: 0 }, { x: cx + d, y: cy, id: 1 }];
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(40) });
        for (let d = 50; d <= 160; d += 10) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(d) });
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await client.detach();
        await settle(page);
        return page.evaluate(() => (window as unknown as { prevented: number }).prevented);
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
      expect(await pinch(plain), 'touch events cancelled by the chart').toBe(0);
      expect(await xDomain(plain)).toEqual(before);
      expect(await closePage(plain)).toEqual([]);
    });

    it(`I3 ${cell(type)}${type === 'bar (date)' ? ' (date axis)' : type === 'bar' ? ' (number axis)' : ''}: the wheel over an unfocused plot scrolls the page; over the focused plot it zooms; with Ctrl or Meta held it never zooms and is not cancelled`, async () => {
      const page = await devPage({ css: 'body { height: 3000px; }' });
      await zoomable(page, type);
      const full = await xDomain(page);
      const g = await plotGeometry(page);
      await page.evaluate(() => {
        const w = window as unknown as { cancelled: string[] };
        w.cancelled = [];
        window.addEventListener('wheel', e => { if (e.defaultPrevented && (e.ctrlKey || e.metaKey)) w.cancelled.push(e.ctrlKey ? 'Control' : 'Meta'); }, { passive: true });
      });
      await page.mouse.move(g.plot.x + g.plot.width / 2, g.plot.y + g.plot.height / 2);
      await page.mouse.wheel(0, 200);
      await page.waitForFunction(() => window.scrollY > 0, null, { timeout: 5000 }).catch(() => undefined);
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      await settle(page);
      expect(await xDomain(page)).toEqual(full);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.focus('#chart .axylo-proxy');
      for (const key of ['Control', 'Meta']) {
        await page.keyboard.down(key);
        await page.mouse.move(g.plot.x + g.plot.width / 2, g.plot.y + g.plot.height / 2);
        await page.mouse.wheel(0, -200);
        await page.keyboard.up(key);
        await settle(page);
        expect(await xDomain(page), `${key} + wheel`).toEqual(full);
      }
      expect(await page.evaluate(() => (window as unknown as { cancelled: string[] }).cancelled)).toEqual([]);
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
    it(`I4 ${type}: every control is at least 24 × 24 CSS px: toolbar, legend, table pager, jump field, the rows of a pinned tooltip and the readout strip's entries for a pinned datum (hovered rows are text, decision 0004)`, async () => {
      const page = await devPage();
      await create(page, type);
      const small: string[] = [];
      const measure = async (sel: string) => {
        for (const el of await page.locator(sel).all()) {
          if (!(await el.isVisible())) continue;
          const b = (await el.boundingBox())!;
          if (b.width < 24 || b.height < 24) small.push(`${(await el.textContent()) || (await el.getAttribute('class'))}: ${b.width.toFixed(1)}×${b.height.toFixed(1)}`);
        }
      };
      // Hovered rows are text (decision 0004 revision 2); pinned rows are buttons, and so are the readout strip's
      // entries for a pinned datum: those are measured.
      const p = (await probes(page, type))[type === 'donut' ? 2 : 10]!;
      await page.mouse.move(p.x, p.y);
      await settle(page);
      await page.mouse.down();
      await page.mouse.up();
      await settle(page);
      expect(await page.locator('#chart .axylo-tooltip button, #chart .axylo-tooltip [role="button"]').count(), 'pinned rows are buttons').toBeGreaterThan(0);
      await measure('#chart .axylo-tooltip button, #chart .axylo-tooltip [role="button"]');
      await page.keyboard.press('Escape');
      await settle(page);
      // Readout mode (plot narrower than 240 px): the strip's entries for a pinned datum.
      await plotTo(page, 'width', 200);
      const q = (await probes(page, type))[type === 'donut' ? 2 : 4]!;
      await page.mouse.move(q.x, q.y);
      await page.mouse.down();
      await page.mouse.up();
      await settle(page);
      expect(await page.locator('#chart .axylo-readout button, #chart .axylo-readout [role="button"]').count(), 'pinned strip entries are buttons').toBeGreaterThan(0);
      await measure('#chart .axylo-readout button, #chart .axylo-readout [role="button"]');
      await page.keyboard.press('Escape');
      await page.evaluate(() => { (document.querySelector('#chart') as HTMLElement).style.width = ''; });
      await settle(page);
      await page.mouse.move(0, 0);
      // Streaming, so the Pause control is there too.
      await call(page, 'append', [more(type, 0)]);
      await measure('#chart button, #chart input:not(.axylo-proxy)');
      await page.mouse.move(0, 0);
      await page.locator('#chart [role="toolbar"] button', { hasText: 'View as table' }).click();
      await settle(page);
      await measure('#chart button, #chart input:not(.axylo-proxy)');
      expect(small).toEqual([]);
      expect(await closePage(page)).toEqual([]);
    });

    it(`I4 ${type}: by touch alone: a tap shows what is under the finger, taps operate the ${type === 'donut' ? 'table control' : 'legend toggle, Zoom in where it applies, and the table control'}, and a one-finger vertical drag over the chart scrolls the page from where it was`, async () => {
      const page = await devPage({ hasTouch: true, css: 'body { height: 3000px; }' });
      await create(page, type);
      const probe = (await probes(page, type))[type === 'donut' ? 0 : 3]!;
      await page.touchscreen.tap(probe.x, probe.y);
      await settle(page);
      expect(await tooltip(page).isVisible()).toBe(true);
      expect(says((await tooltip(page).textContent()) ?? '', probe)).toBe(true);
      const tapOn = async (sel: string, text: string) => { const b = (await page.locator(sel, { hasText: text }).first().boundingBox())!; await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); await settle(page); };
      if (type !== 'donut') {
        const name = type === 'bar' ? 'Plan' : type === 'scatter' ? 'EU' : 'North';
        await tapOn('#chart .axylo-legend-entry', name);
        expect(await page.locator('#chart .axylo-legend-entry', { hasText: name }).getAttribute('aria-pressed')).toBe('false');
        await tapOn('#chart .axylo-legend-entry', name);
      }
      if (type === 'line' || type === 'area' || type === 'scatter') {
        const before = width(await xDomain(page));
        await tapOn('#chart [role="toolbar"] button', 'Zoom in');
        expect(width(await xDomain(page))).toBeLessThan(before);
        await tapOn('#chart [role="toolbar"] button', 'Reset zoom');
      }
      await tapOn('#chart [role="toolbar"] button', 'View as table');
      expect(await page.locator('#chart table').count()).toBe(1);
      await tapOn('#chart [role="toolbar"] button', 'Hide table');
      // The taps above have run on every engine; the drag needs moving touch input.
      requireEngineFeature(['chromium'], TOUCH_INPUT_REASON);
      const client = await page.context().newCDPSession(page);
      const p = await box(page, '#chart .axylo-proxy');
      const x = p.x + p.width / 2, y0 = p.y + p.height - 20;
      const startY = await page.evaluate(() => window.scrollY);
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
      for (let i = 1; i <= 10; i++) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 - i * 15 }] });
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await client.detach();
      await page.waitForFunction(s => window.scrollY > s, startY, { timeout: 5000 }).catch(() => undefined);
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(startY);
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

/** The page-side code that creates the fixture of `type` without waiting (for `traceMotion`). */
function createAction(type: ChartType): string {
  const { fn, options } = type === 'compact' ? { fn: 'line', options: { compact: true, title: 'C', data: ENERGY.days.map((d, i) => ({ day: d, v: ENERGY.series[0]!.values[i] })), x: { field: 'day', type: 'date' }, y: 'v' } } : { fn: '', options: {} };
  if (type === 'compact') return `window.charts.push(window.Axylo.${fn}('#chart', ${JSON.stringify(options)}));`;
  return `window.charts.push(window.make_${type}());`;
}

/** Data that changes every mark of the fixture, for the update test; its last value is distinct. */
function update(type: ChartType): unknown[] {
  switch (type) {
    case 'donut': return [{ item: 'Rent', spend: 300 }, { item: 'Food', spend: 900 }];
    case 'scatter': return [{ size: 10, latency: 50, region: 'EU' }, { size: 30, latency: 150, region: 'US' }];
    case 'bar': return [{ quarter: 'Q1', kind: 'Plan', shipped: 5 }, { quarter: 'Q2', kind: 'Plan', shipped: 60 }];
    case 'compact': return [{ day: '2026-03-02', energy: 30 }, { day: '2026-03-03', energy: 2 }];
    default: return [{ day: '2026-03-02', site: 'North', energy: 30 }, { day: '2026-03-03', site: 'North', energy: 2 }];
  }
}

/** Installs `window.make_<type>()` building the default fixture, so a create can be traced from the page. */
async function installMakers(page: Page): Promise<void> {
  const { optionsFor } = await import('./fixtures');
  const all = Object.fromEntries((['line', 'area', 'bar', 'scatter', 'donut'] as const).map(t => [t, optionsFor(t)]));
  await page.evaluate(all => {
    for (const [t, { fn, options }] of Object.entries(all)) (window as unknown as Record<string, unknown>)[`make_${t}`] = () => (window as unknown as { Axylo: Record<string, (s: string, o: unknown) => unknown> }).Axylo[fn]!('#chart', JSON.parse(JSON.stringify(options)));
  }, all);
}

describe('I5 motion', () => {
  for (const type of TYPES) {
    for (const motion of ['no-preference', 'reduce'] as const) {
      it(`I5 ${type}: first render is not animated (prefers-reduced-motion: ${motion}): from the first painted frame, frame by frame for 2.5 s, the marks' markup and computed paint never change and no animation runs on the chart; a screenshot taken with animations running matches the one at 2.5 s`, async () => {
        const page = await devPage({ reducedMotion: motion });
        await page.evaluate(() => document.fonts.ready);
        await installMakers(page);
        const trace = await traceMotion(page, createAction(type), 2500);
        const painted = trace.frames.findIndex(f => f.signature !== '');
        expect(painted, 'the chart painted').toBeGreaterThanOrEqual(0);
        expect(trace.animated, 'an animation ran on the chart').toBe(false);
        const changes = trace.frames.slice(painted).filter((f, i, a) => i > 0 && f.signature !== a[i - 1]!.signature);
        expect(changes.map(f => Math.round(f.t)), 'frames whose marks differ from the first painted one').toEqual([]);
        const shot = (await screenshot(page, '#chart figure')).img;
        await page.waitForTimeout(500);
        expect(changed(shot, (await screenshot(page, '#chart figure')).img)).toBeLessThanOrEqual(0.001);
        expect(await closePage(page)).toEqual([]);
      });
    }

    it(`I5 ${type}: an update shows the new data and settles within 200 ms of the call, on the page's clock; under reduced motion its first frame is already the final one, with no animation`, async () => {
      for (const motion of ['no-preference', 'reduce'] as const) {
        const page = await devPage({ reducedMotion: motion });
        await create(page, type);
        const before = await page.evaluate(() => document.querySelector('#chart svg.axylo-svg .axylo-scene')!.innerHTML);
        const trace = await traceMotion(page, `window.charts[0].update({ data: ${JSON.stringify(update(type))} });`, 800);
        const after = await page.evaluate(() => document.querySelector('#chart svg.axylo-svg .axylo-scene')!.innerHTML);
        expect(after, `${motion}: the update was drawn`).not.toBe(before);
        expect(trace.settledAt, `${motion}: page-clock ms from the call to the final frame`).toBeLessThanOrEqual(200);
        if (motion === 'reduce') {
          expect(trace.animated).toBe(false);
          // One step: at most the old picture and then the final one, nothing in between.
          const final = trace.frames.at(-1)!.signature;
          const k = trace.frames.findIndex(f => f.signature === final);
          expect(trace.frames.slice(k).every(f => f.signature === final), 'reduced motion: one step').toBe(true);
          expect(new Set(trace.frames.slice(0, k).map(f => f.signature)).size, 'reduced motion: no intermediate frame').toBeLessThanOrEqual(1);
        }
        await closePage(page);
      }
    });
  }

  for (const type of FULL as Full[]) {
    it(`I5 ${type}: a filter change across 24 charts on one page settles within 200 ms of the change, on the page's clock`, async () => {
      const page = await devPage({ css: '.tile { width: 340px; height: 200px; display: inline-block; }' });
      await page.evaluate(() => { for (let i = 0; i < 24; i++) { const el = document.createElement('div'); el.id = `tile-${i}`; el.className = 'tile'; document.body.appendChild(el); } });
      for (let i = 0; i < 24; i++) await create(page, type, { title: `Tile ${i + 1}` }, `#tile-${i}`);
      const result = await page.evaluate(async data => {
        const charts = (window as unknown as { charts: { update(p: unknown): void }[] }).charts;
        const sig = () => [...document.querySelectorAll('svg.axylo-svg .axylo-scene')].map(s => s.innerHTML).join('|');
        const before = sig();
        const t0 = performance.now();
        for (const c of charts) c.update({ data });
        const frames: { t: number; s: string }[] = [];
        await new Promise<void>(r => { const f = () => { const t = performance.now() - t0; frames.push({ t, s: sig() }); if (t > 800) r(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
        const final = frames.at(-1)!.s;
        let k = frames.length - 1;
        while (k > 0 && frames[k - 1]!.s === final) k--;
        return { settled: frames[k]!.t, drew: final !== before };
      }, update(type));
      expect(result.drew).toBe(true);
      expect(result.settled).toBeLessThanOrEqual(200);
      expect(await closePage(page)).toEqual([]);
    });
  }
});

// ── I6 ────────────────────────────────────────────────────────────────────────────────────────────

function more(type: Full, k: number): Record<string, unknown>[] {
  const day = new Date(Date.UTC(2026, 2, 7) + k * 864e5).toISOString().slice(0, 10);
  switch (type) {
    case 'line': case 'area': return [{ day, site: 'North', energy: 20 + k }, { day, site: 'South', energy: 30 + k }];
    case 'bar': return [{ quarter: `P${k}`, kind: 'Plan', shipped: 60 + k }, { quarter: `P${k}`, kind: 'Actual', shipped: 70 + k }];
    case 'scatter': return [{ size: 40 + k, latency: 200 + k, region: 'EU' }];
    case 'donut': return [{ item: `Item ${k}`, spend: 100 + k }];
  }
}

/** The table rows each appended row adds, as the table writes them. */
function moreRows(type: Full, k: number): string[][] {
  const r = more(type, k);
  switch (type) {
    case 'line': case 'area': return [[calendar(r[0]!.day as string), withUnit(r[0]!.energy as number, 'kWh'), withUnit(r[1]!.energy as number, 'kWh')]];
    case 'bar': return [[r[0]!.quarter as string, withUnit(r[0]!.shipped as number, 't'), withUnit(r[1]!.shipped as number, 't')]];
    case 'scatter': return [[withUnit(r[0]!.size as number, 'kB'), 'EU', withUnit(r[0]!.latency as number, 'ms')]];
    case 'donut': return [[r[0]!.item as string, withUnit(r[0]!.spend as number, 'EUR')]];
  }
}

describe('I6 pause', () => {
  for (const type of FULL as Full[]) {
    it(`I6 ${type}: append shows a Pause control; paused, new rows are buffered and nothing a reader gets moves (marks, summary, value text, tooltip, open table); Resume applies each buffered row once, with its values`, async () => {
      const page = await devPage({ css: '#chart { height: 520px; }' });
      await create(page, type);
      expect(await page.locator('#chart [role="toolbar"] button', { hasText: 'Pause' }).count()).toBe(0);
      await call(page, 'append', [more(type, 0)]);
      const pause = page.locator('#chart [role="toolbar"] button', { hasText: 'Pause' });
      expect(await pause.count()).toBe(1);
      await pause.click();
      await settle(page);
      await page.locator('#chart [role="toolbar"] button', { hasText: 'View as table' }).click();
      await settle(page);
      const snapshot = async () => ({
        scene: await page.evaluate(() => document.querySelector('#chart svg.axylo-svg .axylo-scene')?.innerHTML ?? ''),
        description: (await axWithin(page, '#chart')).find(n => n.role === 'group')?.description ?? '',
        // DOM attribute: the open table makes the plot inert, so the range is read from its attribute.
        text: (await page.locator('#chart .axylo-proxy').getAttribute('aria-valuetext')) ?? '',
        table: JSON.stringify(await readTable(page)),
      });
      const before = await snapshot();
      for (let k = 1; k <= 3; k++) await call(page, 'append', [more(type, k)]);
      expect(await snapshot()).toEqual(before);
      await page.locator('#chart [role="toolbar"] button', { hasText: 'Resume' }).click();
      await settle(page);
      const t = await readTable(page);
      const base = tableOf(type);
      // Donut shares change with every slice, so only names and values are compared there.
      const strip = (rows: string[][]) => (type === 'donut' ? rows.map(r => r.slice(0, 2)) : rows);
      const want = strip([...base.rows, ...[0, 1, 2, 3].flatMap(k => moreRows(type, k))]);
      expect(compareTable({ ...t, rows: t.rows.map(r => ({ header: r.header, cells: type === 'donut' ? r.cells.slice(0, 1) : r.cells })) }, { headers: base.headers, rows: want })).toEqual([]);
      expect(await closePage(page)).toEqual([]);
    });
  }
});

