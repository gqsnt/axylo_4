/**
 * Where the chart's visible text is, as oriented rectangles in viewport px, and whether two of them
 * overlap (separating-axis test with the spec's 1 px tolerance). A rotated tick label is measured as its
 * own rotated box, not as the axis-aligned box around it, so a 45° label that only seems to touch its
 * neighbour's bounding box is not counted.
 */
import type { Page } from 'playwright-core';

export interface TextBox { text: string; owner: number; cx: number; cy: number; w: number; h: number; angle: number; role: string }

export async function textBoxes(page: Page, selector = '#chart'): Promise<TextBox[]> {
  return page.evaluate(selector => {
    const root = document.querySelector(selector)!;
    const out: { text: string; owner: number; cx: number; cy: number; w: number; h: number; angle: number; role: string }[] = [];
    const owners = new Map<Element, number>();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement!;
      if (!n.textContent?.trim()) continue;
      if (el.closest('[hidden], .axylo-visually-hidden, .axylo-tooltip, .axylo-readout, [aria-hidden="true"] svg, script, style')) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;
      // A transformed ancestor inside the chart (a placed label): measured as its own rotated box.
      let moved: HTMLElement | null = null;
      for (let a: HTMLElement | null = el; a && a !== root; a = a.parentElement) if (getComputedStyle(a).transform !== 'none') { moved = a; break; }
      const owner = moved ?? el;
      if (!owners.has(owner)) owners.set(owner, owners.size);
      const role = owner.closest('[data-role]')?.getAttribute('data-role') ?? owner.className;
      if (moved) {
        if (out.some(b => b.owner === owners.get(owner))) continue;
        const m = new DOMMatrix(getComputedStyle(moved).transform);
        const r = moved.getBoundingClientRect();
        out.push({ text: moved.textContent ?? '', owner: owners.get(owner)!, cx: r.x + r.width / 2, cy: r.y + r.height / 2, w: moved.offsetWidth, h: moved.offsetHeight, angle: Math.atan2(m.b, m.a), role });
        continue;
      }
      const range = document.createRange();
      range.selectNodeContents(n);
      // The line box, not the font's content area: a content area taller than the line height reaches
      // above and below the line with no ink in it.
      const line = parseFloat(style.lineHeight);
      for (const r of range.getClientRects()) {
        if (r.width < 0.5 || r.height < 0.5) continue;
        const h = Number.isFinite(line) ? Math.min(r.height, line) : r.height;
        out.push({ text: n.textContent ?? '', owner: owners.get(owner)!, cx: r.x + r.width / 2, cy: r.y + r.height / 2, w: r.width, h, angle: 0, role });
      }
    }
    return out;
  }, selector);
}

function corners(b: TextBox, shrink: number): [number, number][] {
  const w = Math.max(0, b.w / 2 - shrink), h = Math.max(0, b.h / 2 - shrink);
  const c = Math.cos(b.angle), s = Math.sin(b.angle);
  return ([[-w, -h], [w, -h], [w, h], [-w, h]] as const).map(([x, y]) => [b.cx + x * c - y * s, b.cy + x * s + y * c] as [number, number]);
}

/** Whether two boxes overlap by more than `tolerance` px (each is shrunk by half of it on every side). */
export function overlap(a: TextBox, b: TextBox, tolerance = 1): boolean {
  const pa = corners(a, tolerance / 2), pb = corners(b, tolerance / 2);
  for (const poly of [pa, pb]) {
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = poly[i]!, [x2, y2] = poly[(i + 1) % 4]!;
      const nx = y2 - y1, ny = x1 - x2;
      const project = (p: [number, number][]) => p.map(([x, y]) => x * nx + y * ny);
      const A = project(pa), B = project(pb);
      if (Math.max(...A) <= Math.min(...B) || Math.max(...B) <= Math.min(...A)) return false;
    }
  }
  return true;
}

/** The axis-aligned extent of a box. */
export function extent(b: TextBox): { x0: number; y0: number; x1: number; y1: number } {
  const p = corners(b, 0);
  return { x0: Math.min(...p.map(q => q[0])), y0: Math.min(...p.map(q => q[1])), x1: Math.max(...p.map(q => q[0])), y1: Math.max(...p.map(q => q[1])) };
}

/** Every pair of boxes from different elements that overlap. */
export function overlaps(boxes: readonly TextBox[], tolerance = 1): string[] {
  const out: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxes[i]!.owner === boxes[j]!.owner) continue;
      if (overlap(boxes[i]!, boxes[j]!, tolerance)) out.push(`"${boxes[i]!.text}" × "${boxes[j]!.text}"`);
    }
  }
  return out;
}
