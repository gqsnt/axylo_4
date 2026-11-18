/**
 * The compact variant, C1–C5 (spec 3.7), for compact line, area and bar: a static image with a full text
 * alternative, the fidelity rules kept, the container filled, dashes between series, and the omission
 * marker. Read from Chrome's accessibility tree and from the rendered marks.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { start, stop } from '../harness';
import { axOf, axWithin, box, closePage, createRaw, devPage, prodPage, settle, shapes, tabStops } from './util';
import { DIRTY, dirtyRows, inOrder, withUnit } from './fixtures';

beforeAll(start);
afterAll(stop);

const KINDS = ['line', 'area', 'bar'] as const;
type Kind = typeof KINDS[number];

/** Five days of one series; the Phase 1 `bars` values (82–97) for the baseline check. */
const ROWS = [12, 15, 11, 18, 16].map((v, i) => ({ day: `2026-03-0${i + 2}`, v }));
const options = (kind: Kind, extra: Record<string, unknown> = {}) => ({ compact: true, title: 'Energy, North', data: ROWS, x: { field: 'day', type: 'date' }, y: { field: 'v', label: 'Energy', unit: 'kWh' }, ...extra, kind });

async function make(page: Page, kind: Kind, extra: Record<string, unknown> = {}, target = '#chart') {
  const { kind: fn, ...rest } = options(kind, extra);
  return createRaw(page, fn, rest, target);
}

describe('C1 a static image with a text alternative', () => {
  for (const kind of KINDS) {
    it(`C1 compact ${kind}: role img, named by its title, described by the generated summary (series, x range, minimum, maximum, last value)`, async () => {
      const page = await devPage({ css: '#chart { width: 200px; height: 48px; }' });
      await make(page, kind);
      const fig = await axOf(page, '#chart figure');
      expect(fig.role).toBe('image');
      expect(fig.name).toBe('Energy, North');
      for (const group of [['Mar 2, 2026', 'Mar 6, 2026'], ['Energy', withUnit(11, 'kWh'), withUnit(18, 'kWh'), withUnit(16, 'kWh')]]) {
        expect(inOrder(fig.description, group), `${JSON.stringify(group)} in ${fig.description}`).toBe(true);
      }
      // An image: nothing inside it is exposed on its own.
      expect((await axWithin(page, '#chart figure')).filter(n => n.role !== 'image' && n.role !== 'StaticText' && n.role !== 'generic' && n.role !== 'paragraph' && n.role !== 'InlineTextBox')).toEqual([]);
      expect(await closePage(page)).toEqual([]);
    });

    for (const build of ['development', 'production'] as const) {
      it(`C1 compact ${kind}: without a title the name is generated and AX140 is raised (${build} build)`, async () => {
        const page = build === 'development' ? await devPage() : await prodPage();
        const built = await make(page, kind, { title: undefined, x: { field: 'day', type: 'date', label: 'Day' } });
        expect(built.diagnostics.filter(d => d.code === 'AX140').map(d => d.level)).toEqual(['warning']);
        const word = { line: 'Line', area: 'Area', bar: 'Bar' }[kind];
        expect((await axOf(page, '#chart figure')).name).toBe(`${word} chart of Energy by Day`);
        expect(await closePage(page)).toEqual([]);
      });
    }

    it(`C1 compact ${kind}: a page of 40 compact charts adds no tab stop, and pointing at one shows nothing a keyboard cannot reach`, async () => {
      const page = await devPage({ css: '.tile { width: 160px; height: 48px; }' });
      await page.evaluate(() => {
        const after = document.querySelector('#after')!;
        for (let i = 0; i < 40; i++) {
          const el = document.createElement('div');
          el.id = `tile-${i}`;
          el.className = 'tile';
          after.before(el);
        }
      });
      for (let i = 0; i < 40; i++) await make(page, kind, { title: `Tile ${i}` }, `#tile-${i}`);
      // #chart is empty here: from #before the next stop is #after.
      expect(await tabStops(page)).toEqual(['after']);
      const b = await box(page, '#tile-3');
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await settle(page);
      const visible = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#tile-3 .axylo-tooltip, #tile-3 .axylo-readout')].some(e => !e.hidden));
      expect(visible).toBe(false);
      expect(await closePage(page)).toEqual([]);
    });
  }
});

describe('C2 the fidelity rules hold', () => {
  for (const kind of ['area', 'bar'] as const) {
    it(`C2 compact ${kind}: the value axis includes zero: the Phase 1 bars values (82–97) are drawn from a zero baseline (F1)`, async () => {
      const page = await devPage({ css: '#chart { width: 280px; height: 100px; }' });
      const values = [94, 88, 97, 82, 91, 85, 90];
      await createRaw(page, kind, { compact: true, title: 'Satisfied', data: values.map((v, i) => ({ c: `T${i}`, v })), x: 'c', y: 'v' });
      if (kind === 'bar') {
        const rects = ((await shapes(page, '#chart', 100000))[1] ?? []).map(s => s.box).sort((a, b) => a.x - b.x);
        expect(rects).toHaveLength(7);
        // Heights proportional to the values from zero: 82 / 97 of the tallest, not a sliver.
        const tallest = Math.max(...rects.map(r => r.height));
        rects.forEach((r, i) => expect(r.height / tallest).toBeCloseTo(values[i]! / 97, 1));
      } else {
        const svg = await box(page, '#chart svg.axylo-svg');
        const fill = await page.evaluate(() => {
          const svg = document.querySelector('#chart svg.axylo-svg') as SVGSVGElement;
          const m = svg.getScreenCTM()!;
          let lowest = -Infinity, highest = Infinity;
          for (const el of svg.querySelectorAll<SVGPathElement>('.axylo-scene path')) {
            const nums = (el.getAttribute('d') ?? '').match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
            for (let i = 1; i < nums.length; i += 2) { const y = new DOMPoint(nums[i - 1]!, nums[i]!).matrixTransform(m).y; lowest = Math.max(lowest, y); highest = Math.min(highest, y); }
          }
          return { lowest, highest };
        });
        // The fill reaches down to the zero baseline at the bottom; 82 sits well above it (82 / 97 of the height).
        expect(fill.lowest).toBeGreaterThanOrEqual(svg.y + svg.height - 4);
        expect(fill.lowest - fill.highest).toBeGreaterThan(svg.height * 0.8);
      }
      expect(await closePage(page)).toEqual([]);
    });
  }

  for (const kind of KINDS) {
    it(`C2 compact ${kind}: shuffled input draws the same marks as sorted input (F11), and the dirty fixture yields AX102, AX103 and AX106 (F3)`, async () => {
      const page = await devPage({ css: '#chart, #other { width: 200px; height: 48px; }', viewport: { width: 900, height: 900 } });
      await page.evaluate(() => { const el = document.createElement('div'); el.id = 'other'; document.querySelector('#after')!.after(el); });
      await make(page, kind);
      const shuffled = [ROWS[3], ROWS[0], ROWS[4], ROWS[2], ROWS[1]];
      await make(page, kind, { data: shuffled }, '#other');
      const scene = (sel: string) => page.evaluate(sel => document.querySelector(`${sel} svg.axylo-svg .axylo-scene`)!.innerHTML.replace(/axylo-clip-\d+/g, 'clip'), sel);
      expect(await scene('#other')).toBe(await scene('#chart'));
      await page.close();
      const dirty = await devPage({ css: '#chart { width: 200px; height: 48px; }' });
      const built = await createRaw(dirty, kind, { compact: true, title: 'Dirty', data: dirtyRows(), x: 'day', y: 'value' });
      expect(built.diagnostics.filter(d => d.level === 'warning').map(d => d.code).sort()).toEqual(['AX102', 'AX103', 'AX106']);
      expect(await closePage(dirty)).toEqual([]);
    });
  }
});

describe('C3 size', () => {
  for (const kind of KINDS) {
    it(`C3 compact ${kind}: it fills containers of 24×16, 160×48 and 600×120 CSS px; with no definite height it is 32 px tall`, async () => {
      const page = await devPage();
      await make(page, kind);
      for (const [w, h] of [[24, 16], [160, 48], [600, 120]] as const) {
        await page.evaluate(([w, h]) => Object.assign((document.querySelector('#chart') as HTMLElement).style, { width: `${w}px`, height: `${h}px` }), [w, h]);
        await settle(page);
        const svg = await box(page, '#chart svg.axylo-svg');
        expect(Math.abs(svg.width - w), `${w}×${h} width`).toBeLessThanOrEqual(1);
        expect(Math.abs(svg.height - h), `${w}×${h} height`).toBeLessThanOrEqual(1);
        const marks = await page.evaluate(() => [...document.querySelectorAll<SVGElement>('#chart svg.axylo-svg .axylo-scene *')].filter(e => /--axylo-series-color-/.test(e.style.getPropertyValue('color'))).length);
        expect(marks, `${w}×${h} marks`).toBeGreaterThan(0);
      }
      await page.evaluate(() => Object.assign((document.querySelector('#chart') as HTMLElement).style, { width: '200px', height: 'auto' }));
      await settle(page);
      expect(Math.round((await box(page, '#chart figure')).height)).toBe(32);
      expect(await closePage(page)).toEqual([]);
    });
  }
});

describe('C4 more than one series', () => {
  for (const kind of KINDS) {
    it(`C4 compact ${kind}: two series differ by ${kind === 'bar' ? 'more than colour' : 'dash as well as colour'}, and AX131 suggests one series per compact chart`, async () => {
      const page = await devPage({ css: '#chart { width: 240px; height: 60px; }' });
      const data = ROWS.flatMap(r => [{ ...r, s: 'North' }, { ...r, v: r.v - 5, s: 'South' }]);
      const built = await createRaw(page, kind, { compact: true, title: 'Two', data, x: { field: 'day', type: 'date' }, y: 'v', series: 's' });
      expect(built.diagnostics.filter(d => d.code === 'AX131').map(d => d.level)).toEqual(['hint']);
      const cues = await page.evaluate(() => {
        const out: Record<string, string[]> = {};
        for (const el of document.querySelectorAll<SVGElement>('#chart svg.axylo-svg .axylo-scene *')) {
          const slot = /--axylo-series-color-(\d+)/.exec(el.style.getPropertyValue('color'));
          if (!slot) continue;
          const s = getComputedStyle(el);
          (out[slot[1]!] ??= []).push(`${s.strokeDasharray}|${el.getAttribute('fill') ?? ''}|${s.fill.startsWith('url') ? 'pattern' : ''}`);
        }
        return Object.values(out).map(v => [...new Set(v)].sort().join(' '));
      });
      expect(cues).toHaveLength(2);
      // Spec C4 names lines; for bars (reading) the second series needs some cue other than colour too.
      expect(cues[0]).not.toBe(cues[1]);
      expect(await closePage(page)).toEqual([]);
    });
  }
});

describe('C5 values left out', () => {
  for (const kind of KINDS) {
    it(`C5 compact ${kind}: with the dirty fixture the description says ${DIRTY.leftOut} values are not shown and a small corner marker appears, with a text equivalent`, async () => {
      const page = await devPage({ css: '#chart { width: 200px; height: 48px; }' });
      await createRaw(page, kind, { compact: true, title: 'Dirty', data: dirtyRows(), x: 'day', y: 'value' });
      const fig = await axOf(page, '#chart figure');
      expect(fig.description).toMatch(new RegExp(`not shown[^.]*\\b${DIRTY.leftOut}\\b|\\b${DIRTY.leftOut}\\b[^.]*not shown`, 'i'));
      const corner = page.locator('#chart .axylo-corner');
      expect(await corner.isVisible()).toBe(true);
      const c = await box(page, '#chart .axylo-corner');
      const fb = await box(page, '#chart figure');
      expect(c.width * c.height).toBeLessThan(fb.width * fb.height / 4);
      const nearCorner = (c.x - fb.x < 4 || fb.x + fb.width - (c.x + c.width) < 4) && (c.y - fb.y < 4 || fb.y + fb.height - (c.y + c.height) < 4);
      expect(nearCorner).toBe(true);
      // Its text equivalent: the image's description carries the statement the marker stands for.
      const title = await corner.getAttribute('title');
      expect(title && fig.description.includes(title.replace(/\s*See table\.?$/, '').trim()), `${title} in ${fig.description}`).toBe(true);
      expect(await closePage(page)).toEqual([]);
    });
  }
});
