/**
 * Where the chart's visible text is, as oriented rectangles in viewport px, and whether two of them
 * overlap (separating-axis test with the spec's 1 px tolerance). A rotated tick label is measured as its
 * own rotated box, not as the axis-aligned box around it, so a 45° label that only seems to touch its
 * neighbour's bounding box is not counted.
 */
import type { Page } from 'playwright-core';

export interface TextBox {
  text: string; owner: number; cx: number; cy: number; w: number; h: number; angle: number; role: string;
  /**
   * How much of it a reader sees: 'whole'; 'clipped' (an ancestor that hides overflow cuts it off);
   * 'ellipsis' (cut off and ended with an ellipsis by CSS `text-overflow`). For a cut text the box is the
   * part that is painted, not the underlying text.
   */
  seen: 'whole' | 'clipped' | 'ellipsis';
}

export async function textBoxes(page: Page, selector = '#chart'): Promise<TextBox[]> {
  return page.evaluate(selector => {
    const root = document.querySelector(selector)!;
    const out: { text: string; owner: number; cx: number; cy: number; w: number; h: number; angle: number; role: string; seen: 'whole' | 'clipped' | 'ellipsis' }[] = [];
    const owners = new Map<Element, number>();
    /** The rectangle the ancestors that hide overflow leave visible, and whether one of them ends text with an ellipsis. */
    const clipOf = (el: Element) => {
      let x0 = -Infinity, y0 = -Infinity, x1 = Infinity, y1 = Infinity, ellipsis = false;
      for (let a: Element | null = el; a && a !== document.body; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (s.textOverflow === 'ellipsis' && (a as HTMLElement).scrollWidth > (a as HTMLElement).clientWidth + 0.5) ellipsis = true;
        if (s.overflowX !== 'visible' || s.overflowY !== 'visible' || s.clipPath !== 'none') {
          const r = a.getBoundingClientRect();
          if (s.overflowX !== 'visible') { x0 = Math.max(x0, r.left); x1 = Math.min(x1, r.right); }
          if (s.overflowY !== 'visible') { y0 = Math.max(y0, r.top); y1 = Math.min(y1, r.bottom); }
        }
      }
      return { x0, y0, x1, y1, ellipsis };
    };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement!;
      if (!n.textContent?.trim()) continue;
      // The tooltip and readout float over the plot by design while the reader asks for them; they are
      // checked by I1 (they must not cover the active mark or a control), not counted as overlapping text.
      if (el.closest('[hidden], .axylo-visually-hidden, .axylo-tooltip, .axylo-readout, [aria-hidden="true"] svg, script, style')) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;
      // A transformed ancestor inside the chart (a placed label): measured as its own rotated box.
      let moved: HTMLElement | null = null;
      for (let a: HTMLElement | null = el; a && a !== root; a = a.parentElement) if (getComputedStyle(a).transform !== 'none') { moved = a; break; }
      const owner = moved ?? el;
      if (!owners.has(owner)) owners.set(owner, owners.size);
      const role = owner.closest('[data-role]')?.getAttribute('data-role') ?? owner.className;
      const clip = clipOf(owner);
      if (moved) {
        if (out.some(b => b.owner === owners.get(owner))) continue;
        const m = new DOMMatrix(getComputedStyle(moved).transform);
        const r = moved.getBoundingClientRect();
        const cut = r.left < clip.x0 - 1 || r.right > clip.x1 + 1 || r.top < clip.y0 - 1 || r.bottom > clip.y1 + 1;
        // A wrapped label holds one child per line: its text is the lines joined by a space.
        const text = moved.children.length ? [...moved.children].map(c => c.textContent ?? '').join(' ') : moved.textContent ?? '';
        out.push({ text, owner: owners.get(owner)!, cx: r.x + r.width / 2, cy: r.y + r.height / 2, w: moved.offsetWidth, h: moved.offsetHeight, angle: Math.atan2(m.b, m.a), role, seen: cut ? (clip.ellipsis ? 'ellipsis' : 'clipped') : 'whole' });
        continue;
      }
      const range = document.createRange();
      range.selectNodeContents(n);
      // The line box, not the font's content area: a content area taller than the line height reaches
      // above and below the line with no ink in it.
      const line = parseFloat(style.lineHeight);
      for (const r of range.getClientRects()) {
        if (r.width < 0.5 || r.height < 0.5) continue;
        const h0 = Number.isFinite(line) ? Math.min(r.height, line) : r.height;
        const top = r.y + (r.height - h0) / 2;
        // The painted part: the line box cut to the clipping rectangle.
        const x0 = Math.max(r.left, clip.x0), x1 = Math.min(r.right, clip.x1), y0 = Math.max(top, clip.y0), y1 = Math.min(top + h0, clip.y1);
        const cut = x0 > r.left + 1 || x1 < r.right - 1 || y0 > top + 1 || y1 < top + h0 - 1;
        if (x1 <= x0 || y1 <= y0) { out.push({ text: n.textContent ?? '', owner: owners.get(owner)!, cx: r.x, cy: r.y, w: 0, h: 0, angle: 0, role, seen: clip.ellipsis ? 'ellipsis' : 'clipped' }); continue; }
        out.push({ text: n.textContent ?? '', owner: owners.get(owner)!, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, angle: 0, role, seen: cut ? (clip.ellipsis ? 'ellipsis' : 'clipped') : 'whole' });
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

/** Every pair of painted boxes that overlap by more than `tolerance`, the lines of one element included. */
export function overlaps(boxes: readonly TextBox[], tolerance = 1): string[] {
  const out: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (!boxes[i]!.w || !boxes[j]!.w) continue;
      if (overlap(boxes[i]!, boxes[j]!, tolerance)) out.push(`"${boxes[i]!.text}" × "${boxes[j]!.text}"`);
    }
  }
  return out;
}
