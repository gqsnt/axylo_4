/**
 * Squarified treemap (Bruls, Huizing and van Wijk, 2000). Every branch's inner area (its rectangle minus its
 * header strip and padding) is split among its children exactly in proportion to their values: the last tile
 * of a row and the last row of a rectangle take what is left, so rounding never leaks area. Pure.
 */
import { childAt, childCount, ratio, subtreeEnd, type HierarchyModel } from '../tree';

export interface TreemapRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

export interface TreemapLayoutOptions {
  /** Height of a branch's header strip, when the branch is tall enough for it. */
  readonly header: number;
  /** Inset of a nested branch's children from its edges, when it has room. */
  readonly padding: number;
}

export interface TreemapGeometry {
  readonly root: number;
  /** Per node; NaN outside the laid-out subtree. */
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly w: Float64Array;
  readonly h: Float64Array;
  /** Header strip height given to each branch (0 when it had no room or is the root). */
  readonly header: Float64Array;
  /** The inner rectangle the children were split over: x, y, w, h per node. */
  readonly inner: Float64Array;
}

/** The aspect ratio cost of a row (the paper's `worst`): its worst tile when laid along `side`. */
function worst(sum: number, min: number, max: number, side: number): number {
  const s2 = sum * sum, side2 = side * side;
  return Math.max((side2 * max) / s2, s2 / (side2 * min));
}

export function layoutTreemap(m: HierarchyModel, root: number, rect: TreemapRect, options: TreemapLayoutOptions): TreemapGeometry {
  const n = m.count;
  const x = new Float64Array(n).fill(NaN), y = new Float64Array(n).fill(NaN);
  const w = new Float64Array(n).fill(NaN), h = new Float64Array(n).fill(NaN);
  const header = new Float64Array(n);
  const inner = new Float64Array(n * 4).fill(NaN);
  x[root] = rect.x; y[root] = rect.y; w[root] = Math.max(0, rect.width); h[root] = Math.max(0, rect.height);
  const end = subtreeEnd(m, root);
  // Scratch for one branch's children, sorted by weight; sized once for the largest family.
  let order = new Int32Array(16);
  let area = new Float64Array(16);
  let share = new Float64Array(0);
  // Pre-order: every parent's rectangle is known before its children are visited.
  for (let p = root; p < end; p++) {
    const k = childCount(m, p);
    if (k === 0) continue;
    const px = x[p]!, py = y[p]!, pw = w[p]!, ph = h[p]!;
    let head = 0, pad = 0;
    if (p !== root) {
      head = ph >= options.header * 2 && pw >= options.header * 2 ? options.header : 0;
      pad = pw > options.padding * 4 && ph - head > options.padding * 4 ? options.padding : 0;
    }
    header[p] = head;
    const ix = px + pad, iy = py + head, iw = Math.max(0, pw - 2 * pad), ih = Math.max(0, ph - head - pad);
    inner[p * 4] = ix; inner[p * 4 + 1] = iy; inner[p * 4 + 2] = iw; inner[p * 4 + 3] = ih;
    if (order.length < k) { order = new Int32Array(k * 2); area = new Float64Array(k * 2); }
    // Shares of this parent, from the subtree-local scaled totals: a small branch beside a huge one keeps its
    // own exact split when drilled, whatever the magnitudes elsewhere in the tree.
    let total = 0;
    if (share.length < n) share = new Float64Array(n);
    for (let c = 0; c < k; c++) { const child = childAt(m, p, c); order[c] = child; const s = ratio(m, child, p) ?? 0; share[child] = s; total += s; }
    // Largest first; ties keep the caller's order, so the same input always gives the same tiles.
    const sorted = Array.from(order.subarray(0, k)).sort((a, b) => share[b]! - share[a]! || a - b);
    const full = iw * ih;
    let positive = 0;
    for (let c = 0; c < k; c++) {
      order[c] = sorted[c]!;
      area[c] = total > 0 ? (share[sorted[c]!]! / total) * full : 0;
      if (area[c]! > 0) positive = c + 1;
    }
    // Children with nothing to show get an empty tile at the inner corner: present, never overlapping.
    for (let c = positive; c < k; c++) { const child = order[c]!; x[child] = ix; y[child] = iy; w[child] = 0; h[child] = 0; }
    squarify(order, area, positive, ix, iy, iw, ih, x, y, w, h);
  }
  return { root, x, y, w, h, header, inner };
}

function squarify(
  order: Int32Array, area: Float64Array, count: number,
  rx: number, ry: number, rw: number, rh: number,
  x: Float64Array, y: Float64Array, w: Float64Array, h: Float64Array,
): void {
  let i = 0;
  let remaining = 0;
  for (let c = 0; c < count; c++) remaining += area[c]!;
  while (i < count) {
    const side = Math.min(rw, rh);
    let sum = area[i]!;
    let j = i + 1;
    if (side > 0) {
      let best = worst(sum, area[i]!, area[i]!, side);
      while (j < count) {
        const next = sum + area[j]!;
        const ratio = worst(next, area[j]!, area[i]!, side);
        if (ratio > best) break;
        best = ratio;
        sum = next;
        j++;
      }
    } else {
      j = count;
      sum = remaining;
    }
    const last = j === count;
    remaining -= sum;
    if (rw >= rh) {
      // A column along the left edge of what is left.
      const t = last ? rw : rh > 0 ? sum / rh : 0;
      let cy = ry;
      for (let c = i; c < j; c++) {
        const child = order[c]!;
        const len = c === j - 1 ? ry + rh - cy : t > 0 ? area[c]! / t : 0;
        x[child] = rx; y[child] = cy; w[child] = t; h[child] = Math.max(0, len);
        cy += len;
      }
      rx += t; rw = Math.max(0, rw - t);
    } else {
      // A row along the top edge.
      const t = last ? rh : rw > 0 ? sum / rw : 0;
      let cx = rx;
      for (let c = i; c < j; c++) {
        const child = order[c]!;
        const len = c === j - 1 ? rx + rw - cx : t > 0 ? area[c]! / t : 0;
        x[child] = cx; y[child] = ry; w[child] = Math.max(0, len); h[child] = t;
        cx += len;
      }
      ry += t; rh = Math.max(0, rh - t);
    }
    i = j;
  }
}

/** The deepest tile under a point, or -1. Tiles of one parent never overlap, so the walk down is unique. */
export function pickTreemap(m: HierarchyModel, g: TreemapGeometry, px: number, py: number): number {
  const inside = (i: number) => w[i]! > 0 && h[i]! > 0 && px >= x[i]! && px < x[i]! + w[i]! && py >= y[i]! && py < y[i]! + h[i]!;
  const { x, y, w, h } = g;
  if (!inside(g.root)) return -1;
  let node = g.root;
  for (;;) {
    const k = childCount(m, node);
    let next = -1;
    for (let c = 0; c < k; c++) { const child = childAt(m, node, c); if (inside(child)) { next = child; break; } }
    if (next < 0) return node;
    node = next;
  }
}
