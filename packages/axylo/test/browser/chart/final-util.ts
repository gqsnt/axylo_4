/**
 * Helpers for the tests of the final interaction review (reviews/2026-11-18/impl/wp/core-final.interaction.review.md)
 * against decision 0004 revision 3.
 */
import type { Page } from 'playwright-core';

export type Box = { x: number; y: number; width: number; height: number };
export type Pt = { x: number; y: number };

export const frames = (page: Page, n = 1) => page.evaluate(k => window.nextFrames(k), n);
export const settle = (page: Page) => page.evaluate(async () => { for (const c of window.charts) await c.__bench.ready(); await window.nextFrames(2); });

export async function create(page: Page, kind: string, options: Record<string, unknown>, target = '#chart'): Promise<void> {
  await page.evaluate(async ({ kind, options, target }) => {
    const chart = window.Axylo[kind]!(target, options);
    window.charts.push(chart);
    await chart.__bench.ready();
    await window.nextFrames(1);
  }, { kind, options, target });
}

/** Records every `select` and `hover` of chart `i` on `window.selected` / `window.hovered`. */
export async function recordEvents(page: Page, i = 0): Promise<void> {
  await page.evaluate(i => {
    const w = window as unknown as { selected: unknown[]; hovered: unknown[] };
    w.selected = [];
    w.hovered = [];
    window.charts[i]!.on('select', p => w.selected.push(p));
    window.charts[i]!.on('hover', p => w.hovered.push(p));
  }, i);
}

export const selected = (page: Page) => page.evaluate(() => (window as unknown as { selected: { series: string; x: unknown; y: number | null; row: unknown; index: number }[] }).selected);
export const lastHover = (page: Page) => page.evaluate(() => (window as unknown as { hovered: unknown[] }).hovered.at(-1) ?? null);

/** The floating tooltip: its title, row texts, rectangle, and whether it is pinned. */
export async function tip(page: Page): Promise<{ title: string | null; rows: string[]; box: Box | null; pinned: boolean }> {
  return page.evaluate(() => {
    const t = document.querySelector('#chart .axylo-tooltip') as HTMLElement;
    if (t.hidden) return { title: null, rows: [], box: null, pinned: false };
    const b = t.getBoundingClientRect();
    return {
      title: t.querySelector('.axylo-tooltip-title')?.textContent ?? null,
      rows: [...t.querySelectorAll('.axylo-tooltip-row')].map(r => r.textContent ?? ''),
      box: { x: b.x, y: b.y, width: b.width, height: b.height }, pinned: t.classList.contains('axylo-tooltip-pinned'),
    };
  });
}

/** The readout strip's text, or null when it shows nothing. */
export async function strip(page: Page): Promise<{ text: string | null; box: Box }> {
  return page.evaluate(() => {
    const r = document.querySelector('#chart .axylo-readout') as HTMLElement;
    const b = r.getBoundingClientRect();
    return { text: r.hidden ? null : r.textContent, box: { x: b.x, y: b.y, width: b.width, height: b.height } };
  });
}

export const plotBox = async (page: Page): Promise<Box> => (await page.locator('#chart .axylo-proxy').boundingBox())!;

/** A point 2 px inside `box`, nearest to `from`. */
export const nearestInside = (box: Box, from: Pt): Pt => ({
  x: Math.min(box.x + box.width - 2, Math.max(box.x + 2, from.x)), y: Math.min(box.y + box.height - 2, Math.max(box.y + 2, from.y)),
});

/** Moves straight from `from` to `to` in `steps` moves, one frame each; returns what was shown after each. */
export async function walk<T>(page: Page, from: Pt, to: Pt, steps: number, read: () => Promise<T>): Promise<T[]> {
  const seen: T[] = [];
  for (let k = 1; k <= steps; k++) {
    await page.mouse.move(from.x + (to.x - from.x) * k / steps, from.y + (to.y - from.y) * k / steps);
    await frames(page);
    seen.push(await read());
  }
  return seen;
}

export const overlaps = (a: Box, b: Box) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.5 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.5;
export const inside = (p: Pt, b: Box) => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;

/** Six full-height bars, so a bar's tooltip has no room above or below and goes beside it (into the next band). */
export const TALL = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6'].map((x, i) => ({ x, y: [96, 100, 97, 99, 98, 95][i]! }));

/** Chrome's accessibility nodes (role and name) under the first element matching `selector`. */
export async function axButtons(page: Page, selector: string): Promise<string[]> {
  const client = await page.context().newCDPSession(page);
  try {
    const { root } = await client.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!nodeId) return [];
    const { node } = await client.send('DOM.describeNode', { nodeId });
    const { nodes } = await client.send('Accessibility.getPartialAXTree', { backendNodeId: node.backendNodeId, fetchRelatives: false });
    const { nodes: all } = await client.send('Accessibility.getFullAXTree', {});
    const within = new Set<string>([nodes[0]!.nodeId]);
    // Descendants of the element's node in the full tree.
    for (let grew = true; grew;) {
      grew = false;
      for (const n of all) if (n.parentId && within.has(n.parentId) && !within.has(n.nodeId)) { within.add(n.nodeId); grew = true; }
    }
    return all.filter(n => within.has(n.nodeId) && !n.ignored && n.role?.value === 'button').map(n => String(n.name?.value ?? ''));
  } finally {
    await client.detach();
  }
}

/** A drawn shape (SVG renderer): its viewport box and its own path data ('rect' for a rect). */
export interface DrawnShape { box: Box; sub: string }

/** Per series colour slot (1-based), the small closed shapes drawn in that colour (markers, points, bars). */
export async function drawnShapes(page: Page, maxSize = 20): Promise<Record<number, DrawnShape[]>> {
  return page.evaluate(maxSize => {
    const svg = document.querySelector('#chart svg.axylo-svg') as SVGSVGElement | null;
    const out: Record<number, { box: { x: number; y: number; width: number; height: number }; sub: string }[]> = {};
    if (!svg) return out;
    const m = svg.getScreenCTM()!;
    const toPage = (x: number, y: number) => new DOMPoint(x, y).matrixTransform(m);
    const slotOf = (el: Element | null): number | null => {
      for (let e = el; e && e !== svg; e = e.parentElement) {
        const s = /--axylo-series-color-(\d+)/.exec((e as SVGElement).style?.getPropertyValue('color') ?? '');
        if (s) return Number(s[1]);
      }
      return null;
    };
    for (const el of svg.querySelectorAll('.axylo-scene path, .axylo-scene rect')) {
      const slot = slotOf(el);
      if (slot === null) continue;
      const list = (out[slot] ??= []);
      if (el.tagName.toLowerCase() === 'rect') {
        const r = el as SVGRectElement;
        const a = toPage(r.x.baseVal.value, r.y.baseVal.value);
        const b = toPage(r.x.baseVal.value + r.width.baseVal.value, r.y.baseVal.value + r.height.baseVal.value);
        if (!list.some(o => Math.abs(o.box.x - a.x) < 0.01 && Math.abs(o.box.y - a.y) < 0.01)) list.push({ box: { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y }, sub: 'rect' });
        continue;
      }
      for (const sub of (el.getAttribute('d') ?? '').split(/(?=M)/)) {
        const nums = (sub.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
        if (nums.length < 2 || /A/i.test(sub)) {
          if (/A/i.test(sub) && nums.length >= 2) {
            const a = toPage(nums[0]!, nums[1]!);
            list.push({ box: { x: a.x, y: a.y, width: 0, height: 0 }, sub });
          }
          continue;
        }
        const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
        const a = toPage(Math.min(...xs), Math.min(...ys)), b = toPage(Math.max(...xs), Math.max(...ys));
        if (b.x - a.x > maxSize || b.y - a.y > maxSize) continue;
        list.push({ box: { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y }, sub });
      }
    }
    return out;
  }, maxSize);
}
