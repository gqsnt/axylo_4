/**
 * The compact variant, C1–C5 (spec 3.7), and the rules it keeps from the full charts (C2: F1, F2, F3, F11,
 * I5, L4), each for all three compact kinds: line, area and bar, which are drawn by different code. Read
 * from Chrome's accessibility tree, from the drawn marks' positions and from painted pixels.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { start, stop } from '../harness';
import { axOf, axWithin, box, closePage, createRaw, devPage, inside, modeColor, prodPage, screenshot, settle, shapes, tabStops, type Box } from './util';
import { DIRTY, dirtyRows, missingClauses, withUnit, type Clause } from './fixtures';
import { inkColor, strokeRuns, traceMotion } from './checks';

beforeAll(start);
afterAll(stop);

const KINDS = ['line', 'area', 'bar'] as const;
type Kind = typeof KINDS[number];

/** Five days of one series. */
const VALUES = [12, 15, 11, 18, 16];
const ROWS = VALUES.map((v, i) => ({ day: `2026-03-0${i + 2}`, v }));
const options = (kind: Kind, extra: Record<string, unknown> = {}) => ({ compact: true, title: 'Energy, North', data: ROWS, x: { field: 'day', type: 'date' }, y: { field: 'v', label: 'Energy', unit: 'kWh' }, ...extra, kind });

async function make(page: Page, kind: Kind, extra: Record<string, unknown> = {}, target = '#chart') {
  const { kind: fn, ...rest } = options(kind, extra);
  return createRaw(page, fn, rest, target);
}

/** Where each datum is drawn: the bars' tops and centres, or the stroke's vertices (line, and area's upper edge). */
async function datumPoints(page: Page, kind: Kind, selector = '#chart'): Promise<{ x: number; y: number }[]> {
  if (kind === 'bar') return ((await shapes(page, selector, 100000))[1] ?? []).map(s => ({ x: s.box.x + s.box.width / 2, y: s.box.y })).sort((a, b) => a.x - b.x);
  return (await strokeRuns(page, 1, selector)).flat().sort((a, b) => a.x - b.x);
}

const CLAUSES: Clause[] = [
  { name: 'x range', fragments: ['day', 'Mar 2, 2026', 'Mar 6, 2026'] },
  { name: 'y range', fragments: ['Energy', withUnit(11, 'kWh'), withUnit(18, 'kWh')] },
  { name: 'series: minimum, maximum, last', fragments: ['Energy', withUnit(11, 'kWh'), withUnit(18, 'kWh'), withUnit(16, 'kWh')] },
];

describe('C1 a static image with a text alternative', () => {
  for (const kind of KINDS) {
    it(`C1 compact ${kind}: role img, named by its title, described by the generated summary (each named statement: x range, y range, the series' minimum, maximum and last value), with nothing inside exposed on its own`, async () => {
      const page = await devPage({ css: '#chart { width: 200px; height: 48px; }' });
      await make(page, kind);
      const fig = await axOf(page, '#chart figure');
      expect(fig.role).toBe('image');
      expect(fig.name).toBe('Energy, North');
      expect(missingClauses(fig.description, [{ name: 'type', fragments: [{ line: 'Line', area: 'Area', bar: 'Bar' }[kind]] }, ...CLAUSES]), fig.description).toEqual([]);
      expect((await axWithin(page, '#chart figure')).filter(n => !['image', 'StaticText', 'generic', 'paragraph', 'InlineTextBox', 'none'].includes(n.role)).map(n => n.role)).toEqual([]);
      expect(await closePage(page)).toEqual([]);
    });

    for (const build of ['development', 'production'] as const) {
      it(`C1 compact ${kind}: without a title the name is generated and AX140 is raised (${build} build)`, async () => {
        const page = build === 'development' ? await devPage() : await prodPage();
        const built = await make(page, kind, { title: undefined, x: { field: 'day', type: 'date', label: 'Day' } });
        expect(built.diagnostics.filter(d => d.code === 'AX140').map(d => d.level)).toEqual(['warning']);
        expect((await axOf(page, '#chart figure')).name).toBe(`${{ line: 'Line', area: 'Area', bar: 'Bar' }[kind]} chart of Energy by Day`);
        expect(await closePage(page)).toEqual([]);
      });
    }

    it(`C1 compact ${kind}: a page of 40 compact charts adds no tab stop, and pointing at one changes nothing on the page: no element appears, no text changes, no pixel changes`, async () => {
      const page = await devPage({ css: '.tile { width: 160px; height: 48px; }' });
      await page.evaluate(() => {
        const after = document.querySelector('#after')!;
        for (let i = 0; i < 40; i++) { const el = document.createElement('div'); el.id = `tile-${i}`; el.className = 'tile'; after.before(el); }
      });
      for (let i = 0; i < 40; i++) await make(page, kind, { title: `Tile ${i}` }, `#tile-${i}`);
      expect(await tabStops(page)).toEqual(['after']);
      // Leave nothing focused, so a focus ring on the page's own button does not count as a change.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await settle(page);
      const state = () => page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => (e as HTMLElement).offsetParent !== null || e.tagName === 'svg').map(e => `${e.tagName}:${e.getAttribute('class') ?? ''}:${e.children.length ? '' : e.textContent}`).join('\n'));
      const before = { dom: await state(), img: (await screenshot(page, 'body', { x: 0, y: 0, width: 900, height: 700 })).img };
      for (const i of [0, 3, 39]) {
        const b = await box(page, `#tile-${i}`);
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await settle(page);
        await page.mouse.down();
        await page.mouse.up();
        await settle(page);
      }
      expect(await state()).toBe(before.dom);
      const after = (await screenshot(page, 'body', { x: 0, y: 0, width: 900, height: 700 })).img;
      let differing = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
      for (let k = 0; k < after.data.length; k += 4) if (after.data[k] !== before.img.data[k] || after.data[k + 1] !== before.img.data[k + 1] || after.data[k + 2] !== before.img.data[k + 2]) { differing++; const x = (k / 4) % after.width, y = Math.floor(k / 4 / after.width); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      expect(differing, `pixels changed in ${x0},${y0}–${x1},${y1}`).toBe(0);
      expect(await closePage(page)).toEqual([]);
    });
  }
});

describe('C2 the fidelity rules hold', () => {
  for (const kind of ['area', 'bar'] as const) {
    it(`C2 compact ${kind}: the value axis includes zero (F1): for the Phase 1 bars values (82–97) each datum is drawn at value / 97 of the height above the bottom`, async () => {
      const page = await devPage({ css: '#chart { width: 280px; height: 100px; }' });
      const values = [94, 88, 97, 82, 91, 85, 90];
      await createRaw(page, kind, { compact: true, title: 'Satisfied', data: values.map((v, i) => ({ c: `T${i}`, v })), x: 'c', y: 'v' });
      const pts = await datumPoints(page, kind);
      expect(pts).toHaveLength(7);
      // The baseline: the bottom of the tallest bar, or the lowest point of the area's fill.
      const bottom = kind === 'bar'
        ? Math.max(...((await shapes(page, '#chart', 100000))[1] ?? []).map(s => s.box.y + s.box.height))
        : await page.evaluate(() => { const svg = document.querySelector('#chart svg.axylo-svg') as SVGSVGElement; const m = svg.getScreenCTM()!; let low = -Infinity; for (const el of svg.querySelectorAll<SVGPathElement>('.axylo-scene path')) { if (el.style.getPropertyValue('fill') !== 'currentcolor') continue; const n = el.getAttribute('d')!.match(/-?\d*\.?\d+/g)!.map(Number); for (let i = 1; i < n.length; i += 2) low = Math.max(low, new DOMPoint(n[i - 1]!, n[i]!).matrixTransform(m).y); } return low; });
      const top = Math.min(...pts.map(p => p.y));
      const height = bottom - top;
      values.forEach((v, i) => expect((bottom - pts[i]!.y) / height, `datum ${i + 1} (${v})`).toBeCloseTo(v / 97, 2));
      expect(await closePage(page)).toEqual([]);
    });
  }

  for (const kind of KINDS) {
    it(`C2 compact ${kind}: shuffled input draws the same marks as sorted input (F11), and the dirty fixture yields AX102, AX103 and AX106 (F3)`, async () => {
      const page = await devPage({ css: '#chart, #other { width: 200px; height: 48px; }', viewport: { width: 900, height: 900 } });
      await page.evaluate(() => { const el = document.createElement('div'); el.id = 'other'; document.querySelector('#after')!.after(el); });
      await make(page, kind);
      await make(page, kind, { data: [ROWS[3], ROWS[0], ROWS[4], ROWS[2], ROWS[1]] }, '#other');
      const scene = (sel: string) => page.evaluate(sel => document.querySelector(`${sel} svg.axylo-svg .axylo-scene`)!.innerHTML.replace(/axylo-clip-\d+/g, 'clip'), sel);
      expect(await scene('#other')).toBe(await scene('#chart'));
      await page.close();
      const dirty = await devPage({ css: '#chart { width: 200px; height: 48px; }' });
      const built = await createRaw(dirty, kind, { compact: true, title: 'Dirty', data: dirtyRows(), x: 'day', y: 'value' });
      expect(built.diagnostics.filter(d => d.level === 'warning').map(d => d.code).sort()).toEqual(['AX102', 'AX103', 'AX106']);
      expect(await closePage(dirty)).toEqual([]);
    });

    it(`C2 compact ${kind}: no motion (I5): from the first painted frame, frame by frame for 1.5 s, the marks never change and no animation runs`, async () => {
      const page = await devPage({ css: '#chart { width: 200px; height: 48px; }' });
      const { kind: fn, ...rest } = options(kind);
      const trace = await traceMotion(page, `window.charts.push(window.Axylo.${fn}('#chart', ${JSON.stringify(rest)}));`, 1500);
      const painted = trace.frames.findIndex(f => f.signature !== '');
      expect(painted).toBeGreaterThanOrEqual(0);
      expect(trace.animated).toBe(false);
      expect(trace.frames.slice(painted).filter((f, i, a) => i > 0 && f.signature !== a[i - 1]!.signature)).toEqual([]);
      expect(await closePage(page)).toEqual([]);
    });

    it(`C2 compact ${kind}: the scheme comes from the page (L4): a dark page paints the marks in other colours than a light one, and a class toggle repaints them`, async () => {
      const page = await devPage({ deviceScaleFactor: 2, css: '#chart { width: 200px; height: 48px; } body.dk { background: #121212; color: #e8e8e8; }' });
      await make(page, kind);
      const painted = async () => {
        const { img, box: view } = await screenshot(page, '#chart figure');
        const backdrop = modeColor(img, { x0: 0, y0: 0, x1: img.width, y1: img.height }).color;
        const p = (await datumPoints(page, kind))[1]!;
        const b: Box = kind === 'bar' ? ((await shapes(page, '#chart', 100000))[1] ?? []).map(s => s.box).sort((a, c) => a.x - c.x)[1]! : { x: p.x - 1, y: p.y - 1, width: 2, height: 2 };
        return inkColor(img, view, b, backdrop);
      };
      const light = await painted();
      expect(light).not.toBeNull();
      await page.evaluate(() => document.body.classList.add('dk'));
      await settle(page);
      const dark = await painted();
      expect(dark).not.toBeNull();
      expect(dark).not.toEqual(light);
      expect(await closePage(page)).toEqual([]);
    });
  }

  it('C2 compact line: a null is a gap and the value between two gaps is a visible point (F2)', async () => {
    const page = await devPage({ css: '#chart { width: 240px; height: 60px; }' });
    await createRaw(page, 'line', { compact: true, title: 'Gaps', data: [10, 20, null, 40, null, 60, 70].map((v, x) => ({ x, v })), x: 'x', y: 'v' });
    const runs = await strokeRuns(page, 1);
    const xs = runs.flat().map(p => p.x).sort((a, b) => a - b);
    const step = (xs.at(-1)! - xs[0]!) / 6;
    expect(runs.some(r => r.length >= 2 && r.some(p => Math.abs(p.x - (xs[0]! + 2 * step)) < 1)), 'nothing drawn at x = 2').toBe(false);
    const isolated = ((await shapes(page, '#chart', 14))[1] ?? []).map(s => s.box.x + s.box.width / 2);
    expect(isolated.some(x => Math.abs(x - (xs[0]! + 3 * step)) <= 2), 'a point at x = 3').toBe(true);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('C3 size', () => {
  for (const kind of KINDS) {
    it(`C3 compact ${kind}: it fills containers of 24×16, 160×48 and 600×120 CSS px, redrawn for each: the five data are evenly spread across the width and their heights keep their order; with no definite height it is 32 px tall`, async () => {
      const page = await devPage();
      await make(page, kind);
      for (const [w, h] of [[24, 16], [160, 48], [600, 120]] as const) {
        await page.evaluate(([w, h]) => Object.assign((document.querySelector('#chart') as HTMLElement).style, { width: `${w}px`, height: `${h}px` }), [w, h]);
        await settle(page);
        const svg = await box(page, '#chart svg.axylo-svg');
        expect(Math.abs(svg.width - w), `${w}×${h} width`).toBeLessThanOrEqual(1);
        expect(Math.abs(svg.height - h), `${w}×${h} height`).toBeLessThanOrEqual(1);
        const pts = await datumPoints(page, kind);
        expect(pts, `${w}×${h}`).toHaveLength(5);
        for (const p of pts) expect(inside({ ...p, width: 0, height: 0 }, svg, 0.5), `${w}×${h}: datum inside`).toBe(true);
        // Spread across most of the width, evenly.
        expect(pts.at(-1)!.x - pts[0]!.x).toBeGreaterThan(w * (kind === 'bar' ? 0.5 : 0.75));
        const gaps = pts.slice(1).map((p, i) => p.x - pts[i]!.x);
        for (const g of gaps) expect(Math.abs(g - gaps[0]!)).toBeLessThanOrEqual(0.6);
        // Higher values higher up: 18 (day 4) is the highest, 11 (day 3) the lowest.
        expect(pts[3]!.y).toBe(Math.min(...pts.map(p => p.y)));
        expect(pts[2]!.y).toBe(Math.max(...pts.map(p => p.y)));
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
    it(`C4 compact ${kind}: two series differ by ${kind === 'bar' ? 'more than colour, as painted (reading: A5 asks a non-colour cue of bars too)' : 'dash as well as colour'}, and AX131 suggests one series per compact chart`, async () => {
      const page = await devPage({ deviceScaleFactor: 2, css: '#chart { width: 240px; height: 80px; }' });
      const data = ROWS.flatMap(r => [{ ...r, s: 'North' }, { ...r, v: r.v - 5, s: 'South' }]);
      const built = await createRaw(page, kind, { compact: true, title: 'Two', data, x: { field: 'day', type: 'date' }, y: 'v', series: 's' });
      expect(built.diagnostics.filter(d => d.code === 'AX131').map(d => d.level)).toEqual(['hint']);
      if (kind === 'bar') {
        // Painted texture: the share of a bar's interior that is not its own solid colour. A plain bar has
        // none; a patterned one has its pattern. The two series must differ by more than colour.
        const { img, box: view } = await screenshot(page, '#chart figure');
        const backdrop = modeColor(img, { x0: 0, y0: 0, x1: img.width, y1: img.height }).color;
        const drawn = await shapes(page, '#chart', 100000);
        const texture = (b: Box) => {
          const solid = inkColor(img, view, b, backdrop)!;
          const s = img.width / view.width;
          let other = 0, n = 0;
          for (let y = Math.ceil((b.y - view.y + 1) * s); y < (b.y + b.height - view.y - 1) * s; y++) for (let x = Math.ceil((b.x - view.x + 1) * s); x < (b.x + b.width - view.x - 1) * s; x++) {
            const o = (y * img.width + x) * 4; n++;
            if (Math.max(Math.abs(img.data[o]! - solid[0]), Math.abs(img.data[o + 1]! - solid[1]), Math.abs(img.data[o + 2]! - solid[2])) > 30) other++;
          }
          return n ? other / n : 0;
        };
        const t = [1, 2].map(slot => { const b = (drawn[slot] ?? []).map(s => s.box).sort((a, c) => c.height - a.height)[0]!; return texture(b); });
        expect(Math.abs(t[0]! - t[1]!), `textures ${t.map(v => v.toFixed(2)).join(' / ')}`).toBeGreaterThan(0.1);
      } else {
        const dashes = await page.evaluate(() => [...document.querySelectorAll<SVGPathElement>('#chart svg.axylo-svg .axylo-scene path')].filter(e => /--axylo-series-color-/.test(e.style.getPropertyValue('color')) && e.style.getPropertyValue('stroke') === 'currentcolor').map(e => getComputedStyle(e).strokeDasharray));
        expect(dashes).toHaveLength(2);
        expect(dashes[0]).not.toBe(dashes[1]);
      }
      expect(await closePage(page)).toEqual([]);
    });
  }
});

describe('C5 values left out', () => {
  for (const kind of KINDS) {
    it(`C5 compact ${kind}: with the dirty fixture the description says ${DIRTY.leftOut} values are not shown, and a small marker is painted inside the figure at one of its corners, with that statement as its text equivalent`, async () => {
      const page = await devPage({ css: '#chart { width: 200px; height: 48px; }' });
      await createRaw(page, kind, { compact: true, title: 'Dirty', data: dirtyRows(), x: 'day', y: 'value' });
      const fig = await axOf(page, '#chart figure');
      expect(missingClauses(fig.description, [{ name: 'omission', fragments: ['not shown', String(DIRTY.leftOut)] }]), fig.description).toEqual([]);
      const corner = page.locator('#chart .axylo-corner');
      expect(await corner.isVisible()).toBe(true);
      const c = await box(page, '#chart .axylo-corner');
      const fb = await box(page, '#chart figure');
      expect(inside(c, fb, 0.5), 'the marker is inside the figure').toBe(true);
      expect(c.width * c.height).toBeLessThan((fb.width * fb.height) / 4);
      const nearCorner = (c.x - fb.x < 4 || fb.x + fb.width - (c.x + c.width) < 4) && (c.y - fb.y < 4 || fb.y + fb.height - (c.y + c.height) < 4);
      expect(nearCorner).toBe(true);
      // Painted: a glyph is thin and anti-aliased, so it is enough that several of its pixels stand out from the background.
      const { img, box: view } = await screenshot(page, '#chart figure');
      const backdrop = modeColor(img, { x0: 0, y0: 0, x1: img.width, y1: img.height }).color;
      let ink = 0;
      for (let y = Math.floor(c.y - view.y); y < c.y + c.height - view.y; y++) for (let x = Math.floor(c.x - view.x); x < c.x + c.width - view.x; x++) {
        const o = (y * img.width + x) * 4;
        if (Math.max(Math.abs(img.data[o]! - backdrop[0]), Math.abs(img.data[o + 1]! - backdrop[1]), Math.abs(img.data[o + 2]! - backdrop[2])) > 60) ink++;
      }
      expect(ink, 'the marker is painted').toBeGreaterThanOrEqual(3);
      // Its text equivalent: the image's description carries the statement the marker stands for.
      const title = await corner.getAttribute('title');
      expect(title && fig.description.includes(title.replace(/\s*See table\.?$/, '').trim()), `${title} in ${fig.description}`).toBe(true);
      expect(await closePage(page)).toEqual([]);
    });
  }
});
