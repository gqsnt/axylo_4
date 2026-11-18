/**
 * Regression tests for the render review (reviews/2026-11-18/impl/wp/render.review.md), browser side.
 * Each describe names its finding. Tests that need the stylesheet change are in pending-css.browser.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import type { Page } from 'playwright-core';
import { start, stop, url } from '../harness';
import { LIGHT } from '../../../src/theme/palette';
import type { TextSpec } from './entries/api';
import { at, blend, close, diff, ENTRY, frames, ink, open, rgb, shot, WHITE, type RGB } from './util';
import type { Image } from './png';

/** AXYLO_PROPOSED_CSS=1 preloads a standalone sheet; tests of installing into a bare page do not apply then. */
const preloaded = process.env.AXYLO_PROPOSED_CSS === '1';

beforeAll(start);
afterAll(stop);

const series = (i: number): RGB => rgb(LIGHT.series[i]!);
const BLACK: RGB = [0, 0, 0];

/** Ink beyond `radius + 1.5` px of a centre, within a square of side 2 × (radius + 30). */
function inkOutside(img: Image, cx: number, cy: number, radius: number): number {
  let n = 0;
  for (let y = Math.max(0, cy - radius - 30); y < Math.min(img.height, cy + radius + 30); y++) {
    for (let x = Math.max(0, cx - radius - 30); x < Math.min(img.width, cx + radius + 30); x++) {
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > radius + 1.5 && diff(at(img, x, y), WHITE) > 10) n++;
    }
  }
  return n;
}

describe('finding 1: dominant and full-turn slices stay inside the ring', () => {
  for (const kind of ['canvas', 'svg'] as const) {
    it(kind, async () => {
      const page = await open();
      await page.evaluate(k => window.axr.mount(k, 20, 60, { scene: 'ring' }), kind);
      const img = await shot(page, 20, 60, 400, 300);
      for (const [cx, cy] of [[260, 150], [120, 150]] as const) {
        expect(inkOutside(img, cx, cy, 40), `outside ring at ${cx}`).toBe(0);
        // The hole stays empty and the ring body is painted.
        expect(diff(at(img, cx, cy), WHITE)).toBeLessThanOrEqual(2);
        expect(diff(at(img, cx, cy + 32), WHITE)).toBeGreaterThan(40);
        expect(diff(at(img, cx - 32, cy), WHITE)).toBeGreaterThan(40);
      }
      await close(page);
    });
  }
});

describe('finding 2: the "no data" mark survives the plot clip on all-negative charts', () => {
  for (const kind of ['canvas', 'svg'] as const) {
    it(kind, async () => {
      const page = await open();
      await page.evaluate(k => window.axr.mount(k, 20, 60, { scene: 'negative' }), kind);
      const img = await shot(page, 20, 60, 400, 300);
      // Vertical slot 100–120 at y 20 (top of the clip): ink below it, inside the plot.
      expect(ink(img, 98, 20, 122, 28)).toBeGreaterThanOrEqual(20);
      expect(ink(img, 98, 10, 122, 20)).toBe(0);
      // Horizontal slot 150–170 at x 380 (right edge): ink left of it, inside the plot.
      expect(ink(img, 372, 148, 380, 172)).toBeGreaterThanOrEqual(20);
      expect(ink(img, 380, 148, 390, 172)).toBe(0);
      await close(page);
    });
  }
});

describe('findings 3 and 9: what is measured is what is behind the marks', () => {
  const panel = '#panel { position: absolute; left: 0; top: 0; width: 900px; height: 700px; background: #000; }';
  const withPanel = async (): Promise<Page> => {
    const page = await open();
    await page.addStyleTag({ content: panel });
    await page.evaluate(() => { const p = document.createElement('div'); p.id = 'panel'; document.body.appendChild(p); });
    return page;
  };

  it('--axylo-background is painted behind the plot by both renderers and used for the check', async () => {
    const page = await withPanel();
    await page.evaluate(() => {
      const o = { parent: '#panel', keys: ['Direct'], colors: { Direct: 'black' }, style: { '--axylo-background': 'white' } };
      window.axr.mount('canvas', 20, 60, o);
      window.axr.mount('svg', 460, 60, o);
    });
    const r = await page.evaluate(() => window.axr.info(0));
    expect(r.theme.paints.tokens.background).toBe('rgb(255, 255, 255)');
    expect(r.lowContrast).toEqual([]);
    for (const x of [20, 460]) {
      const img = await shot(page, x, 60, 400, 300);
      expect(diff(at(img, 130, 105), WHITE), `background at ${x}`).toBeLessThanOrEqual(2);
      expect(diff(at(img, 85, 50), BLACK), `stroke at ${x}`).toBeLessThanOrEqual(8);
    }
    await close(page);
  });

  it('with no --axylo-background, the backdrop is the panel behind the chart', async () => {
    const page = await withPanel();
    await page.evaluate(() => window.axr.mount('svg', 20, 60, { parent: '#panel', keys: ['a'], colors: { a: 'rgb(20, 20, 20)' } }));
    const r = await page.evaluate(() => window.axr.info(0));
    expect(r.theme.paints.tokens.background).toBe('rgb(0, 0, 0)');
    expect(r.backdropKnown).toBe(true);
    expect(r.lowContrast).toEqual([0]);
    const img = await shot(page, 20, 60, 400, 300);
    expect(diff(at(img, 130, 105), BLACK)).toBeLessThanOrEqual(2);
    await close(page);
  });

  it('a translucent --axylo-background is composited over the real backdrop for the check and the scheme', async () => {
    const page = await withPanel();
    await page.evaluate(() => window.axr.mount('svg', 20, 60, { parent: '#panel', keys: ['a'], colors: { a: 'rgb(0, 0, 0)' }, style: { '--axylo-background': 'rgba(255, 255, 255, 0.1)' } }));
    const r = await page.evaluate(() => window.axr.info(0));
    expect(r.theme.scheme).toBe('dark');
    expect(r.lowContrast).toEqual([0]);
    await close(page);
  });

  it('translucent series colors are composited over the backdrop', async () => {
    const page = await withPanel();
    await page.evaluate(() => window.axr.mount('svg', 20, 60, { parent: '#panel', keys: ['a', 'b'], colors: { a: 'rgba(255, 255, 255, 0.1)', b: 'rgb(255, 255, 255)' } }));
    expect((await page.evaluate(() => window.axr.info(0))).lowContrast).toEqual([0]);
    await close(page);
  });

  it('a background image makes the backdrop unknown, so the caller can skip AX141', async () => {
    const page = await open();
    await page.addStyleTag({ content: 'body { background: linear-gradient(#000, #fff); }' });
    await page.evaluate(() => window.axr.mount('svg', 20, 60));
    expect((await page.evaluate(() => window.axr.info(0))).backdropKnown).toBe(false);
    await close(page);
  });
});

describe('finding 4 and 5: canvas sizes', () => {
  it('a 150 × 75 chart at DPR 2 is 150 × 75 CSS px with a 300 × 150 backing store', async () => {
    const page = await open({ deviceScaleFactor: 2 });
    await page.evaluate(() => window.axr.mount('canvas', 20, 60, { scene: 'line', width: 150, height: 75, vertices: 50 }));
    const c = await page.evaluate(() => window.axr.canvasInfo(0));
    expect([c.width, c.height, c.cssWidth, c.cssHeight]).toEqual([300, 150, 150, 75]);
    expect(c.overlayCssWidth).toBe(150);
    await close(page);
  });

  it('a 4,000 × 2,000 chart at DPR 3 stays within 16,777,216 pixels and 8,192 px a side; no overlay store until one is drawn', async () => {
    const page = await open({ deviceScaleFactor: 3 });
    await page.evaluate(() => window.axr.mount('canvas', 0, 0, { scene: 'line', width: 4000, height: 2000, vertices: 200 }));
    const c = await page.evaluate(() => window.axr.canvasInfo(0));
    expect(c.width * c.height).toBeLessThanOrEqual(16_777_216);
    expect(Math.max(c.width, c.height)).toBeLessThanOrEqual(8192);
    expect(c.width / c.height).toBeCloseTo(2, 2);
    expect([c.cssWidth, c.cssHeight]).toEqual([4000, 2000]);
    expect(c.overlayWidth * c.overlayHeight).toBe(0);
    await page.evaluate(() => window.axr.overlay(0, true));
    const after = await page.evaluate(() => window.axr.canvasInfo(0));
    expect([after.overlayWidth, after.overlayHeight]).toEqual([c.width, c.height]);
    // A 1 px rule is still whole device rows at the capped ratio (axis at y 1000).
    const k = c.height / 2000;
    const column = await page.evaluate(([y0]) => Array.from({ length: 12 }, (_, i) => window.axr.canvasPixel(0, 100, y0! + i)), [Math.round(1000 * k) - 6]);
    const alphas = column.map(p => p[3]!).filter(a => a > 0);
    expect(alphas.every(a => a === 255)).toBe(true);
    await close(page);
  });

  it('an ordinary chart never allocates an overlay store', async () => {
    const page = await open();
    await page.evaluate(() => window.axr.mount('canvas', 20, 60));
    const c = await page.evaluate(() => window.axr.canvasInfo(0));
    expect(c.overlayWidth * c.overlayHeight).toBe(0);
    expect(c.overlayCssWidth).toBe(400);
    await close(page);
  });
});

describe('finding 7: a scheme list follows the scheme the browser uses', () => {
  for (const device of ['dark', 'light'] as const) {
    it(`color-scheme: light dark with explicit dark text on a ${device} device is ${device}`, async () => {
      const page = await open({ colorScheme: device });
      await page.addStyleTag({ content: ':root { color-scheme: light dark; color: #111111; }' });
      await page.evaluate(() => window.axr.mount('svg', 20, 60));
      expect((await page.evaluate(() => window.axr.info(0))).theme.scheme).toBe(device);
      await close(page);
    });
  }
});

describe('finding 8: theme changes on the chart\'s own ancestors', () => {
  it('a data-theme toggle on a card between body and the chart repaints; the watch follows the chart when moved', async () => {
    const page = await open();
    await page.addStyleTag({ content: '[data-theme="dark"] { color-scheme: dark; color: #eeeeee; background: #16181d; }' });
    await page.evaluate(() => {
      for (const id of ['card', 'card2']) { const c = document.createElement('div'); c.id = id; document.body.appendChild(c); }
      const inner = document.createElement('div'); inner.id = 'inner'; document.getElementById('card')!.appendChild(inner);
      window.axr.mount('svg', 20, 60, { parent: '#inner' });
      window.axr.watch([85, 50]);
    });
    await page.evaluate(() => document.getElementById('card')!.setAttribute('data-theme', 'dark'));
    await page.waitForFunction(() => window.axr.fired() >= 1, undefined, { timeout: 2000 });
    expect((await page.evaluate(() => window.axr.info(0))).attribute).toBe('dark');
    await page.evaluate(() => window.axr.move(0, '#card2'));
    await frames(page, 2);
    const moved = await page.evaluate(() => window.axr.fired());
    // The old card is no longer an ancestor; the new one is.
    await page.evaluate(() => document.getElementById('card')!.setAttribute('data-theme', 'light'));
    await frames(page, 3);
    expect(await page.evaluate(() => window.axr.fired())).toBe(moved);
    await page.evaluate(() => document.getElementById('card2')!.setAttribute('data-theme', 'dark'));
    await page.waitForFunction(m => window.axr.fired() > m, moved, { timeout: 2000 });
    await page.evaluate(() => window.axr.stopWatch());
    await close(page);
  });

  it('a replaced <body> is watched', async () => {
    const page = await open();
    await page.evaluate(() => {
      window.axr.mount('svg', 20, 60);
      window.axr.watch([85, 50]);
    });
    await page.evaluate(() => {
      const fresh = document.createElement('body');
      const root = document.querySelector('.axylo')!;
      fresh.appendChild(root);
      document.documentElement.replaceChild(fresh, document.body);
    });
    await frames(page, 3);
    const before = await page.evaluate(() => window.axr.fired());
    await page.evaluate(() => document.body.classList.add('night'));
    await page.waitForFunction(b => window.axr.fired() > b, before, { timeout: 2000 });
    await page.evaluate(() => window.axr.stopWatch());
    await close(page);
  });
});

describe('finding 10: author colors are colors only', () => {
  const cases: [string, Record<string, string>, Record<string, string>][] = [
    ['a paint server', { Direct: 'url(#g)' }, {}],
    ['a custom property holding a non-color', { Direct: 'var(--brand)' }, { '--brand': 'nonsense' }],
  ];
  for (const [label, colors, style] of cases) {
    it(`${label} falls back to the palette slot in both renderers and is reported`, async () => {
      const page = await open();
      await page.evaluate(([c, s]) => {
        window.axr.mount('canvas', 20, 60, { keys: ['Direct'], colors: c, style: s });
        window.axr.mount('svg', 460, 60, { keys: ['Direct'], colors: c, style: s });
      }, [colors, style] as const);
      const r = await page.evaluate(() => window.axr.info(1));
      expect(r.invalidColors).toEqual(['Direct']);
      expect(rgb(r.theme.paints.series[0]!)).toEqual(series(0));
      for (const x of [20, 460]) expect(diff(at(await shot(page, x, 60, 400, 300), 85, 50), series(0)), `at ${x}`).toBeLessThanOrEqual(8);
      await close(page);
    });
  }

  it('a valid author color is not reported', async () => {
    const page = await open();
    await page.evaluate(() => window.axr.mount('svg', 20, 60, { keys: ['Direct'], colors: { Direct: 'rgb(0, 128, 0)' } }));
    const r = await page.evaluate(() => window.axr.info(0));
    expect(r.invalidColors).toEqual([]);
    expect(r.theme.paints.series[0]).toBe('rgb(0, 128, 0)');
    await close(page);
  });
});

describe('finding 11: stylesheet installation', () => {
  it('a chart in a shadow root is styled by a sheet adopted into that shadow root', async () => {
    const page = await open();
    const r = await page.evaluate(() => window.axr.shadowMount(20, 60));
    expect(r.adoptedInShadow).toBe(1);
    expect(r.position).toBe('absolute');
    await close(page);
  });

  it.skipIf(preloaded)('without constructable stylesheets, one <style> element is inserted, once', async () => {
    const page = await open();
    const before = await page.evaluate(() => document.querySelectorAll('style').length);
    const r = await page.evaluate(() => window.axr.ensureStylesWithoutAdoption());
    expect(r.styleElements).toBe(before + 1);
    expect(r.second).toBe(before + 1);
    expect(r.position).toBe('absolute');
    await close(page);
  });

  it.skipIf(preloaded)('a standalone sheet that is disabled later is replaced; a sentinel alone does not count', async () => {
    const page = await open();
    await page.evaluate(() => {
      const s = document.createElement('style');
      s.id = 'standalone';
      s.textContent = window.axr.css;
      document.head.appendChild(s);
    });
    expect(await page.evaluate(() => window.axr.ensureStyles())).toBe(0);
    await page.evaluate(() => { (document.getElementById('standalone') as HTMLStyleElement).sheet!.disabled = true; });
    expect(await page.evaluate(() => window.axr.ensureStyles())).toBe(1);
    await close(page);

    const fake = await open();
    await fake.addStyleTag({ content: ':root { --axylo-stylesheet: loaded; }' });
    expect(await fake.evaluate(() => window.axr.ensureStyles())).toBe(1);
    await close(fake);
  });
});

describe('finding 12: a detached chart is reported as unresolved, not black', () => {
  it('resolved: false and palette fallbacks', async () => {
    const page = await open();
    const r = await page.evaluate(() => window.axr.detached());
    expect(r.resolved).toBe(false);
    expect(r.theme.paints.series.map(c => c)).not.toContain('rgb(0, 0, 0)');
    expect(rgb(r.theme.paints.series[0]!)).toEqual(series(0));
    await close(page);
  });
});

describe('finding 14: one overlap rule — each rectangle is painted on its own', () => {
  for (const kind of ['canvas', 'svg'] as const) {
    it(kind, async () => {
      const page = await open();
      await page.evaluate(k => window.axr.mount(k, 20, 60, { scene: 'overlap', keys: ['a'], colors: { a: 'rgba(0, 0, 255, 0.5)' } }), kind);
      const img = await shot(page, 20, 60, 400, 300);
      const twice = blend([0, 0, 255], 0.5, blend([0, 0, 255], 0.5));
      expect(diff(at(img, 125, 125), twice)).toBeLessThanOrEqual(3);
      // The rectangle written with a negative width is the same rectangle: also 75 %, not cancelled.
      expect(diff(at(img, 225, 125), twice)).toBeLessThanOrEqual(3);
      await close(page);
    });
  }
});

describe('finding 15: an unchanged scene writes nothing', () => {
  it('redrawing the same scene object causes no DOM mutation in the SVG renderer', async () => {
    const page = await open();
    await page.evaluate(() => window.axr.mount('svg', 20, 60));
    expect(await page.evaluate(() => window.axr.mutationsOnRedraw(0))).toBe(0);
    await close(page);
  });
});

describe('finding 17: blank lines keep their height', () => {
  it('a middle-anchored label ["first", "", "last"] is three line heights tall and centred', async () => {
    const page = await open();
    const specs: TextSpec[] = [{ lines: ['first', '', 'last'], x: 200, y: 150, anchor: 'middle', baseline: 'middle', rotate: 0 }];
    const [p] = await page.evaluate(s => window.axr.mountTextSpecs(20, 60, s), specs);
    expect(Math.abs(p!.rect.height - 54)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(p!.rect.y - p!.box.y)).toBeLessThanOrEqual(1.5);
    await close(page);
  });
});

describe('finding 18: stronger checks', () => {
  /** Unit-box outlines of the eight markers, written from their definitions (apex up, apex down, …). */
  const t = 1 / 6;
  const plus = [[-t, -0.5], [t, -0.5], [t, -t], [0.5, -t], [0.5, t], [t, t], [t, 0.5], [-t, 0.5], [-t, t], [-0.5, t], [-0.5, -t], [-t, -t]];
  const turn = (p: number[][]): number[][] => p.map(([x, y]) => [(x! - y!) * Math.SQRT1_2, (x! + y!) * Math.SQRT1_2]);
  const star = Array.from({ length: 10 }, (_, k) => { const a = -Math.PI / 2 + (k * Math.PI) / 5, r = k % 2 ? 0.191 : 0.5; return [r * Math.cos(a), r * Math.sin(a)]; });
  const shapes: Record<string, number[][] | 'circle'> = {
    circle: 'circle', square: [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]], triangle: [[0, -0.5], [0.5, 0.5], [-0.5, 0.5]],
    diamond: [[0, -0.5], [0.5, 0], [0, 0.5], [-0.5, 0]], cross: turn(plus), plus, 'triangle-down': [[-0.5, -0.5], [0.5, -0.5], [0, 0.5]], star,
  };
  /** Signed distance in px from a point to a shape scaled by `size` (negative inside). */
  function signed(shape: number[][] | 'circle', size: number, x: number, y: number): number {
    if (shape === 'circle') return Math.hypot(x, y) - size / 2;
    const p = shape.map(([u, v]) => [u! * size, v! * size]);
    let inside = false, best = Infinity;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, yi] = p[i]!, [xj, yj] = p[j]!;
      if ((yi! > y) !== (yj! > y) && x < ((xj! - xi!) * (y - yi!)) / (yj! - yi!) + xi!) inside = !inside;
      const dx = xj! - xi!, dy = yj! - yi!;
      const k = Math.max(0, Math.min(1, ((x - xi!) * dx + (y - yi!) * dy) / (dx * dx + dy * dy)));
      best = Math.min(best, Math.hypot(x - xi! - k * dx, y - yi! - k * dy));
    }
    return inside ? -best : best;
  }

  for (const kind of ['canvas', 'svg'] as const) {
    it(`${kind}: each of the eight markers matches its own shape mask (so swapped shapes fail)`, async () => {
      const page = await open();
      await page.evaluate(k => window.axr.mount(k, 20, 60, { scene: 'markers' }), kind);
      const img = await shot(page, 20, 60, 400, 300);
      ['circle', 'square', 'triangle', 'diamond', 'cross', 'plus', 'triangle-down', 'star'].forEach((name, k) => {
        const cx = 60 + 42 * k, cy = 150;
        let checked = 0;
        for (let y = cy - 15; y < cy + 15; y++) for (let x = cx - 15; x < cx + 15; x++) {
          const d = signed(shapes[name]!, 24, x + 0.5 - cx, y + 0.5 - cy);
          if (d < -1.2) { expect(diff(at(img, x, y), series(0)), `${name} inside ${x - cx},${y - cy}`).toBeLessThanOrEqual(12); checked++; }
          else if (d > 1.2) { expect(diff(at(img, x, y), WHITE), `${name} outside ${x - cx},${y - cy}`).toBeLessThanOrEqual(12); checked++; }
        }
        expect(checked).toBeGreaterThan(500);
      });
      await close(page);
    });
  }

  it('svg: a list that changes kinds and shrinks leaves exactly the new elements, drawn like canvas', async () => {
    const page = await open();
    await page.evaluate(() => { window.axr.mount('svg', 20, 60); window.axr.mount('canvas', 460, 60); });
    await page.evaluate(() => { window.axr.drawScene(0, 'mixed'); window.axr.drawScene(1, 'mixed'); });
    expect(await page.evaluate(() => window.axr.svgTags(0))).toEqual(['path', 'line', 'rect', 'g']);
    let a = await shot(page, 20, 60, 400, 300), b = await shot(page, 460, 60, 400, 300);
    for (let y = 2; y < 300; y += 3) for (let x = 2; x < 400; x += 3) expect(diff(at(a, x, y), at(b, x, y)), `${x},${y}`).toBeLessThanOrEqual(40);
    await page.evaluate(() => { window.axr.drawScene(0, 'short'); window.axr.drawScene(1, 'short'); });
    expect(await page.evaluate(() => window.axr.svgTags(0))).toEqual(['rect']);
    a = await shot(page, 20, 60, 400, 300); b = await shot(page, 460, 60, 400, 300);
    expect(ink(a, 0, 0, 400, 300)).toBe(ink(b, 0, 0, 400, 300));
    expect(ink(a, 0, 0, 400, 300)).toBe(1600);
    await close(page);
  });

  it('C4: a non-solid normal dash is drawn in normal mode by both renderers, and the contrast dash differs', async () => {
    const gaps = async (contrast: 'more' | 'no-preference'): Promise<number[]> => {
      const page = await open({ contrast });
      await page.evaluate(() => { window.axr.mount('canvas', 20, 60, { scene: 'dash' }); window.axr.mount('svg', 460, 60, { scene: 'dash' }); });
      const out: number[] = [];
      for (const x of [20, 460]) {
        const img = await shot(page, x, 60, 400, 300);
        let n = 0;
        for (let px = 60; px < 360; px++) if (diff(at(img, px, 150), WHITE) <= 10) n++;
        out.push(n);
      }
      await close(page);
      return out;
    };
    const normal = await gaps('no-preference');
    const more = await gaps('more');
    // [8, 3] over 300 px: about 3/11 of the line is gap; [2, 2]: about half.
    for (const n of normal) { expect(n).toBeGreaterThan(50); expect(n).toBeLessThan(110); }
    for (const n of more) expect(n).toBeGreaterThan(110);
  });

  it('text: after text-spacing overrides and after a late font, relaid-out labels land on their boxes and nothing is clipped', async () => {
    const page = await open();
    await page.evaluate(() => window.axr.mountText(20, 60));
    await page.addStyleTag({ content: '* { letter-spacing: 0.12em !important; word-spacing: 0.16em !important; line-height: 1.5 !important; }' });
    const check = (probes: { box: Record<string, number>; rect: Record<string, number>; overflow?: boolean }[], what: string): void => {
      probes.forEach((p, i) => {
        expect(p.overflow, `${what} ${i} overflow`).toBe(false);
        for (const k of ['x', 'y', 'width', 'height']) expect(Math.abs(p.rect[k]! - p.box[k]!), `${what} ${i} ${k}`).toBeLessThanOrEqual(1.5);
      });
    };
    check(await page.evaluate(() => window.axr.relayoutText()), 'spacing');
    const before = await page.evaluate(() => window.axr.measureText());
    const font = fs.readFileSync('/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf').toString('base64');
    await page.evaluate(() => { (document.querySelector('.axylo-text')!.parentElement as HTMLElement).style.setProperty('font-family', '"Late Serif", sans-serif'); });
    expect(await page.evaluate(f => window.axr.loadFont('Late Serif', f), font)).toBe(true);
    const relaid = await page.evaluate(() => window.axr.relayoutText());
    check(relaid, 'late font');
    expect(relaid[2]!.rect.width).toBeGreaterThan(before[2]!.rect.width + 5);
    await close(page);
  });

  it('DX8: text layer, renderers and styles work under a Content Security Policy without unsafe-inline, served with real headers', async () => {
    const page = await open();
    const violations: string[] = [];
    await page.route('**/blank.html', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'" } });
    });
    await page.goto(url('packages/axylo/test/browser/blank.html'));
    await page.exposeFunction('reportViolation', (v: string) => { violations.push(v); });
    await page.evaluate(() => document.addEventListener('securitypolicyviolation', e => (window as unknown as { reportViolation(v: string): void }).reportViolation(`${e.violatedDirective} ${e.blockedURI}`)));
    await page.addScriptTag({ url: url(`packages/axylo/test/browser/.out/${ENTRY.split('/').pop()!.replace(/\.ts$/, '.js')}`) });
    const probes = await page.evaluate(() => {
      window.axr.mount('svg', 20, 360);
      window.axr.mount('canvas', 460, 360);
      return window.axr.mountText(20, 60);
    });
    for (const p of probes) for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(p.rect[k] - p.box[k])).toBeLessThanOrEqual(1.5);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.axylo-svg')!).position)).toBe('absolute');
    const img = await shot(page, 20, 360, 400, 300);
    expect(diff(at(img, 85, 50), series(0))).toBeLessThanOrEqual(8);
    await frames(page, 2);
    expect(violations).toEqual([]);
    await close(page);
  });
});


describe('RectMark.pattern (spec F9 second cue)', () => {
  it('a patterned bar differs from a plain bar of the same color in both renderers, and the renderers agree', async () => {
    const page = await open();
    await page.evaluate(() => { window.axr.mount('canvas', 20, 60, { scene: 'pattern' }); window.axr.mount('svg', 460, 60, { scene: 'pattern' }); });
    const images = [await shot(page, 20, 60, 400, 300), await shot(page, 460, 60, 400, 300)];
    // Pixels of the bar interior (2 px in from each edge) that are close to the background color.
    const light = (img: Image, x0: number): number => {
      let n = 0;
      for (let y = 62; y < 238; y++) for (let x = x0 + 2; x < x0 + 58; x++) if (diff(at(img, x, y), WHITE) < 80) n++;
      return n;
    };
    for (const img of images) {
      expect(light(img, 60)).toBe(0);
      const diagonal = light(img, 140), cross = light(img, 220), dots = light(img, 300);
      // About 1 px lines every 5.7 px: roughly a sixth of the area, twice that for the cross hatch.
      expect(diagonal).toBeGreaterThan(800);
      expect(cross).toBeGreaterThan(diagonal * 1.4);
      expect(dots).toBeGreaterThan(150);
      // Patterns stay inside their bars.
      expect(ink(img, 122, 60, 138, 240)).toBe(0);
    }
    let off = 0, total = 0, sum = 0;
    for (let y = 60; y < 240; y += 2) for (let x = 60; x < 360; x += 2) {
      const d = diff(at(images[0]!, x, y), at(images[1]!, x, y));
      total++; sum += d; if (d > 64) off++;
    }
    console.log(`pattern agreement: ${total} points, ${off} differ by more than 64/255, mean ${(sum / total).toFixed(2)}`);
    expect(sum / total).toBeLessThan(6);
    expect(off / total).toBeLessThan(0.03);
    await close(page);
  });
});
