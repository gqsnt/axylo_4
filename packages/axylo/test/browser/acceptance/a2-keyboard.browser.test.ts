/**
 * A2 (keyboard) and the type matrix's keyboard order (spec 3.4, 3.6; decision 0001): at most two tab stops
 * while the table is closed, the plot and one toolbar with roving focus; every point reachable in the type's
 * order; the series can be switched; the ends reached directly; focus can leave. The focus indicator is at
 * least 2 px and 3:1 and is not hidden by the tooltip. Keys are pressed with Playwright's keyboard.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { start, stop } from '../harness';
import {
  box, call, closePage, contrast, covered, create, devPage, focused, modeColor, readRange, ring, screenshot, settle, shapes, tabStops, valueText, type Box,
} from './util';
import { inkColor } from './checks';
import {
  calendar, ENERGY, FULL, inOrder, LATENCY_ORDER, share, SHIPPED, SPEND, withUnit, type ChartType,
} from './fixtures';

beforeAll(start);
afterAll(stop);

type Full = Exclude<ChartType, 'compact'>;

/** Rows `append` adds in the streaming state: one more x for each type. */
const MORE: Record<Full, unknown[]> = {
  line: [{ day: '2026-03-07', site: 'North', energy: 14 }, { day: '2026-03-07', site: 'South', energy: 9 }],
  area: [{ day: '2026-03-07', site: 'North', energy: 14 }, { day: '2026-03-07', site: 'South', energy: 9 }],
  bar: [{ quarter: 'Q5', kind: 'Plan', shipped: 60 }, { quarter: 'Q5', kind: 'Actual', shipped: 58 }],
  scatter: [{ size: 40, latency: 130, region: 'EU' }],
  donut: [{ item: 'Gifts', spend: 100 }],
};

/** What the reader must hear at each stop of a walk with Right from the first datum (spec 3.6 keyboard order). */
function walk(type: Full): string[][] {
  switch (type) {
    case 'line':
    case 'area':
      return ENERGY.days.map((day, i) => [calendar(day), 'North', withUnit(ENERGY.series[0]!.values[i]!, 'kWh'), 'South', withUnit(ENERGY.series[1]!.values[i]!, 'kWh'), `${i + 1} of 5`]);
    case 'bar':
      return SHIPPED.quarters.map((q, i) => [q, 'Plan', withUnit(SHIPPED.series[0]!.values[i]!, 't'), 'Actual', withUnit(SHIPPED.series[1]!.values[i]!, 't'), `${i + 1} of 4`]);
    case 'scatter':
      return LATENCY_ORDER.map((p, i) => [p.region, withUnit(p.size, 'kB'), withUnit(p.latency, 'ms'), `${i + 1} of 6`]);
    case 'donut':
      return SPEND.items.map((item, i) => [item, withUnit(SPEND.values[i]!, 'EUR'), share(SPEND.values[i]!), `${i + 1} of 4`]);
  }
}

/**
 * The toolbar's controls in order at full view, from the spec and the accessibility page's toolbar list
 * (apps/docs/pages/accessibility.md): legend toggles (two or more series), Zoom in, Select range (the
 * two-click range wherever a drag selects one, spec I4), Zoom out where zoom applies, the table.
 */
const TOOLBAR: Record<Full, string[]> = {
  line: ['North', 'South', 'Zoom in', 'Select range', 'Zoom out', 'View as table'],
  area: ['North', 'South', 'Zoom in', 'Select range', 'Zoom out', 'View as table'],
  // Category x: no zoom (spec 3.6), so no range to select either.
  bar: ['Plan', 'Actual', 'View as table'],
  scatter: ['EU', 'US', 'Zoom in', 'Select range', 'Zoom out', 'View as table'],
  // No legend toggles (the slice list is not a set of buttons) and no zoom (spec 3.6).
  donut: ['View as table'],
};

async function zoomIn(page: Page, type: Full): Promise<void> {
  const range = type === 'scatter' ? [12, 30] : ['2026-03-03', '2026-03-05'];
  await call(page, 'zoom', [range]);
}

describe('A2 tab stops', () => {
  for (const type of FULL as Full[]) {
    const states: [string, ((page: Page) => Promise<void>) | null][] = [
      ['collapsed', async () => {}],
      ['zoomed', type === 'line' || type === 'area' || type === 'scatter' ? page => zoomIn(page, type) : null],
      ['streaming', async page => call(page, 'append', [MORE[type]])],
    ];
    for (const [state, enter] of states) {
      if (!enter) continue;
      it(`A2 ${type}: two tab stops with the table closed (${state}): the plot, then the toolbar; Shift+Tab reverses; Tab leaves the chart`, async () => {
        const page = await devPage();
        await create(page, type);
        await enter(page);
        const forwards = await tabStops(page);
        expect(forwards).toHaveLength(3);
        expect(forwards[0]).toBe('proxy');
        expect(forwards[1]).toMatch(/^toolbar:/);
        expect(forwards[2]).toBe('after');
        const backwards = await tabStops(page, true);
        expect(backwards[0]).toMatch(/^toolbar:/);
        expect(backwards.slice(1)).toEqual(['proxy', 'before']);
        if (state === 'streaming') expect(await page.locator('#chart [role="toolbar"]').textContent()).toContain('Pause');
        expect(await closePage(page)).toEqual([]);
      });
    }

    it(`A2 ${type}: with the table open, Tab reaches the table's scroll region and the toolbar, and still leaves the chart both ways`, async () => {
      const page = await devPage();
      await create(page, type);
      await page.locator('#chart [role="toolbar"] button', { hasText: 'View as table' }).click();
      await settle(page);
      const forwards = await tabStops(page);
      expect(forwards).toContain('table');
      expect(forwards.some(s => s.startsWith('toolbar:'))).toBe(true);
      expect(forwards.at(-1)).toBe('after');
      const backwards = await tabStops(page, true);
      expect(backwards).toContain('table');
      expect(backwards.at(-1)).toBe('before');
      expect(await closePage(page)).toEqual([]);
    });

    it(`A2 ${type}: the toolbar holds ${TOOLBAR[type].join(', ')} with roving focus: one tab stop, arrows, Home and End move within it`, async () => {
      const page = await devPage();
      await create(page, type);
      await page.focus('#before');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      const label = () => page.evaluate(() => document.activeElement?.textContent ?? '');
      const visited = [await label()];
      for (let i = 1; i < TOOLBAR[type].length; i++) {
        await page.keyboard.press('ArrowRight');
        visited.push(await label());
      }
      expect(visited).toEqual(TOOLBAR[type]);
      await page.keyboard.press('Home');
      expect(await label()).toBe(TOOLBAR[type][0]);
      await page.keyboard.press('End');
      expect(await label()).toBe(TOOLBAR[type].at(-1));
      expect(await page.locator('#chart [role="toolbar"] [tabindex="0"]').count()).toBe(1);
      expect(await closePage(page)).toEqual([]);
    });
  }
});

describe('A2 and T-keyboard: every point in order, the ends, the series', () => {
  for (const type of FULL as Full[]) {
    const order = { line: 'by x, then series', area: 'by x, then series', bar: 'by category, then series', scatter: 'by x, then y', donut: 'by slice order' }[type];
    it(`A2 ${type}: Right visits every datum ${order}, each read with its text; End and Home reach the ends; Tab leaves the chart`, async () => {
      const page = await devPage();
      await create(page, type);
      await page.focus('#before');
      await page.keyboard.press('Tab');
      expect(await focused(page)).toBe('proxy');
      const expected = walk(type);
      const heard: string[] = [await valueText(page)];
      for (let i = 1; i < expected.length; i++) {
        await page.keyboard.press('ArrowRight');
        heard.push(await valueText(page));
      }
      expected.forEach((group, i) => expect(inOrder(heard[i]!, group), `stop ${i + 1}: ${JSON.stringify(group)} in "${heard[i]}"`).toBe(true));
      // Past the end Right stays on the last datum.
      await page.keyboard.press('ArrowRight');
      expect(inOrder(await valueText(page), expected.at(-1)!)).toBe(true);
      await page.keyboard.press('Home');
      expect(inOrder(await valueText(page), expected[0]!)).toBe(true);
      await page.keyboard.press('End');
      expect(inOrder(await valueText(page), expected.at(-1)!)).toBe(true);
      await page.keyboard.press('Tab');
      expect(await focused(page)).toMatch(/^toolbar:/);
      await page.keyboard.press('Tab');
      expect(await focused(page)).toBe('after');
      expect(await closePage(page)).toEqual([]);
    });
  }

  for (const type of ['line', 'area', 'bar'] as const) {
    it(`A2 ${type}: Down narrows to the first series, Right stays in it, Down and Up switch series at the same ${type === 'bar' ? 'category' : 'x'}, Escape reads every series again`, async () => {
      const page = await devPage();
      await create(page, type);
      const [first, second] = type === 'bar' ? SHIPPED.series : ENERGY.series;
      const unit = type === 'bar' ? 't' : 'kWh';
      const xs = type === 'bar' ? SHIPPED.quarters : ENERGY.days.map(calendar);
      await page.focus('#chart .axylo-proxy');
      await page.keyboard.press('ArrowDown');
      let text = await valueText(page);
      expect(inOrder(text, [first!.name, xs[0]!, withUnit(first!.values[0]!, unit)]), text).toBe(true);
      expect(text).not.toContain(second!.name);
      await page.keyboard.press('ArrowRight');
      text = await valueText(page);
      expect(inOrder(text, [first!.name, xs[1]!, withUnit(first!.values[1]!, unit)]), text).toBe(true);
      await page.keyboard.press('ArrowDown');
      text = await valueText(page);
      expect(inOrder(text, [second!.name, xs[1]!, withUnit(second!.values[1]!, unit)]), text).toBe(true);
      expect(text).not.toContain(first!.name);
      await page.keyboard.press('ArrowUp');
      text = await valueText(page);
      expect(inOrder(text, [first!.name, xs[1]!]), text).toBe(true);
      await page.keyboard.press('Escape');
      text = await valueText(page);
      if (!text.includes(second!.name)) {
        // The first Escape may close the tooltip (decision 0001); the second leaves single-series mode.
        await page.keyboard.press('Escape');
        text = await valueText(page);
      }
      expect(inOrder(text, [xs[1]!, first!.name, second!.name]), text).toBe(true);
      expect(await closePage(page)).toEqual([]);
    });

    it(`A2 ${type}: hiding the focused series with its legend toggle keeps focus on the same ${type === 'bar' ? 'category' : 'x'} and stops reading that series`, async () => {
      const page = await devPage();
      await create(page, type);
      const [first, second] = type === 'bar' ? SHIPPED.series : ENERGY.series;
      const xs = type === 'bar' ? SHIPPED.quarters : ENERGY.days.map(calendar);
      await page.focus('#chart .axylo-proxy');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowDown');
      expect(await valueText(page)).toContain(first!.name);
      await page.locator('#chart [role="toolbar"] button', { hasText: first!.name }).click();
      await settle(page);
      // Focus is on the legend toggle now; the range's text is read without focus here (DOM attribute).
      let text = await valueText(page, '#chart', { focused: false });
      expect(text).toContain(xs[2]!);
      expect(text).not.toContain(first!.name);
      expect(text).toContain(second!.name);
      // Back to the plot with the keyboard: the same x, the hidden series not read; Right moves on from there.
      await page.keyboard.press('Shift+Tab');
      text = await valueText(page);
      expect(text).toContain(xs[2]!);
      expect(text).not.toContain(first!.name);
      await page.keyboard.press('ArrowRight');
      text = await valueText(page);
      expect(text).toContain(xs[3]!);
      expect(text).not.toContain(first!.name);
      expect(await closePage(page)).toEqual([]);
    });
  }

  it('A2 scatter: Down switches to the other series and Right then stays in it, in x order (reading: Up and Down change series, as on the aligned charts)', async () => {
    const page = await devPage();
    await create(page, 'scatter');
    await page.focus('#chart .axylo-proxy');
    expect(await valueText(page)).toContain('EU');
    await page.keyboard.press('ArrowDown');
    const texts = [await valueText(page)];
    expect(texts[0]).toContain('US');
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('ArrowRight');
      texts.push(await valueText(page));
    }
    for (const t of texts) expect(t, t).toContain('US');
    // The last US point by x is 35 kB.
    expect(texts.at(-1)).toContain(withUnit(35, 'kB'));
    expect(await closePage(page)).toEqual([]);
  });
});

/** The overlay's focus ring around the focused datum: the overlay marks painted with the focus colour. */
async function datumRing(page: Page): Promise<{ box: Box; strokeWidth: number }[]> {
  return page.evaluate(() => [...document.querySelectorAll<SVGGraphicsElement>('#chart svg.axylo-svg .axylo-overlay *')]
    .filter(e => /focus/.test(e.style.getPropertyValue('color')))
    .map(e => {
      // A line's box has no thickness: widen it to the painted stroke.
      const r = e.getBoundingClientRect(), w = parseFloat(getComputedStyle(e).strokeWidth) || 0;
      const box = { x: r.x, y: r.y, width: r.width, height: r.height };
      if (box.width < w) { box.x -= (w - box.width) / 2; box.width = w; }
      if (box.height < w) { box.y -= (w - box.height) / 2; box.height = w; }
      return { box, strokeWidth: w };
    }));
}

describe('A2 focus indicator', () => {
  for (const type of FULL as Full[]) {
    it(`A2 ${type}: at every datum the keyboard reaches, the focus indicators (the plot's outline and the ring around the datum) are painted at least 2 px wide and 3:1 against their painted backdrop, and the tooltip covers neither them nor the focused datum (reading: no part of either indicator is covered)`, async () => {
      const page = await devPage();
      await create(page, type);
      await page.focus('#before');
      await page.keyboard.press('Tab');
      expect((await readRange(page)).focused).toBe(true);
      const outline = page.locator('#chart .axylo-focus-ring');
      expect(await outline.isVisible()).toBe(true);
      // Computed style: the outline's width (its painted pixels are checked below).
      const width = await outline.evaluate(el => parseFloat(getComputedStyle(el).outlineWidth));
      expect(width).toBeGreaterThanOrEqual(2);
      const steps = walk(type).length;
      const problems: string[] = [];
      for (let i = 0; i < steps; i++) {
        if (i > 0) await page.keyboard.press('ArrowRight');
        await settle(page);
        const range = await readRange(page);
        if (!range.focused || range.role !== 'slider') problems.push(`datum ${i}: the range lost focus or role`);
        const { img, box: view } = await screenshot(page, '#chart figure');
        // The plot's outline: a strip on each side, inside its box (outline-offset is negative).
        const o = await box(page, '#chart .axylo-focus-ring');
        const strips: Box[] = [
          { x: o.x + o.width * 0.4, y: o.y + 1, width: o.width * 0.2, height: 2 }, { x: o.x + o.width * 0.4, y: o.y + o.height - 3, width: o.width * 0.2, height: 2 },
          { x: o.x + 1, y: o.y + o.height * 0.4, width: 2, height: o.height * 0.2 }, { x: o.x + o.width - 3, y: o.y + o.height * 0.4, width: 2, height: o.height * 0.2 },
        ];
        const rings = await datumRing(page);
        if (!rings.length) problems.push(`datum ${i}: no ring around the focused datum`);
        for (const r of rings) if (r.strokeWidth < 2) problems.push(`datum ${i}: datum ring ${r.strokeWidth} px wide`);
        // Against the chart's painted background (the figure's most frequent colour), as L2 measures it.
        const backdrop = modeColor(img, { x0: 0, y0: 0, x1: img.width, y1: img.height }).color;
        for (const [k, b] of [...strips, ...rings.map(r => r.box)].entries()) {
          const ink = inkColor(img, view, b, backdrop);
          if (!ink) { problems.push(`datum ${i}: indicator ${k} at ${JSON.stringify(b)} not painted`); continue; }
          if (contrast(ink, backdrop) < 3) problems.push(`datum ${i}: indicator ${k} ${ink} is ${contrast(ink, backdrop).toFixed(2)}:1 on ${backdrop}`);
        }
        const tip = page.locator('#chart .axylo-tooltip');
        if (!(await tip.isVisible())) { problems.push(`datum ${i}: no tooltip`); continue; }
        const tipBox = await box(page, '#chart .axylo-tooltip');
        const drawn = await shapes(page, '#chart', type === 'donut' ? 10000 : type === 'bar' ? 10000 : 20);
        const marks = datumMarks(type, drawn, i, type === 'donut' ? await ring(page) : null);
        if (!marks.length) problems.push(`datum ${i}: no mark found for the focused datum`);
        for (const m of covered(tipBox, [...marks, ...strips, ...rings.map(r => r.box)])) problems.push(`datum ${i}: tooltip ${JSON.stringify(tipBox)} covers ${JSON.stringify(m)}`);
      }
      expect(problems).toEqual([]);
      expect(await closePage(page)).toEqual([]);
    });
  }
});

/** The drawn mark(s) of the i-th datum in keyboard order, from the SVG shapes grouped by colour slot. */
function datumMarks(type: Full, drawn: Record<number, { box: { x: number; y: number; width: number; height: number }; commands: string }[]>, i: number, donut: { cx: number; cy: number; outer: number } | null) {
  const bySlot = (slot: number) => (drawn[slot] ?? []).map(s => s.box).sort((a, b) => a.x - b.x);
  if (type === 'line' || type === 'area' || type === 'bar') return [bySlot(1)[i], bySlot(2)[i]].filter(b => b !== undefined);
  if (type === 'donut') {
    // A small box at the slice's middle angle, clockwise from 12 o'clock (spec F8), at 80 % of the outer radius.
    if (!donut) return [];
    const { cx, cy } = donut;
    const r = 0.8 * donut.outer;
    const before = SPEND.values.slice(0, i).reduce((a, b) => a + b, 0);
    const angle = 2 * Math.PI * (before + SPEND.values[i]! / 2) / SPEND.values.reduce((a, b) => a + b, 0);
    return [{ x: cx + r * Math.sin(angle) - 4, y: cy - r * Math.cos(angle) - 4, width: 8, height: 8 }];
  }
  // Scatter: the point at the i-th place in x-then-y order, from its series' shapes (EU slot 1, US slot 2).
  const p = LATENCY_ORDER[i]!;
  const slot = p.region === 'EU' ? 1 : 2;
  const same = LATENCY_ORDER.filter(q => q.region === p.region);
  return [bySlot(slot)[same.indexOf(p)]].filter(b => b !== undefined);
}
