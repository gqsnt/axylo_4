/**
 * Radial partition (sunburst). The drilled root is the center disc and spans the full turn; each child takes
 * an arc of its parent's span exactly in proportion to its value, in the caller's order, clockwise from 12
 * o'clock (the donut convention: x = cx + sin(a)·r, y = cy − cos(a)·r). Every depth gets a ring of the same
 * thickness, so radii grow with depth. The last child of a parent ends exactly where the parent ends. Pure.
 */
import { childAt, childCount, ratio, subtreeEnd, type HierarchyModel } from '../tree';

/** 2π as a literal: an expression over `Math` would be kept by a bundler that ignores purity annotations. */
export const TURN = 6.283185307179586;

export interface SunburstGeometry {
  readonly root: number;
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
  /** Thickness of one ring (and the radius of the center disc). */
  readonly ring: number;
  /** Per node; NaN outside the drilled subtree. Angles in radians, clockwise from 12 o'clock. */
  readonly a0: Float64Array;
  readonly a1: Float64Array;
  readonly r0: Float64Array;
  readonly r1: Float64Array;
}

export function layoutSunburst(m: HierarchyModel, root: number, cx: number, cy: number, radius: number): SunburstGeometry {
  const n = m.count;
  const a0 = new Float64Array(n).fill(NaN), a1 = new Float64Array(n).fill(NaN);
  const r0 = new Float64Array(n).fill(NaN), r1 = new Float64Array(n).fill(NaN);
  const end = subtreeEnd(m, root);
  const base = m.depth[root]!;
  let levels = 0;
  for (let i = root; i < end; i++) levels = Math.max(levels, m.depth[i]! - base);
  const ring = Math.max(0, radius) / (levels + 1);
  a0[root] = 0; a1[root] = TURN; r0[root] = 0; r1[root] = ring;
  for (let p = root; p < end; p++) {
    const k = childCount(m, p);
    if (k === 0) continue;
    // Shares of this parent from the subtree-local scaled totals (see tree.ts `ratio`).
    let total = 0;
    let last = -1;
    for (let c = 0; c < k; c++) { const s = ratio(m, childAt(m, p, c), p) ?? 0; total += s; if (s > 0) last = c; }
    const start = a0[p]!, span = a1[p]! - start;
    let cum = 0;
    for (let c = 0; c < k; c++) {
      const child = childAt(m, p, c);
      const s = ratio(m, child, p) ?? 0;
      const from = total > 0 ? start + span * (cum / total) : start;
      cum += s;
      const to = c === last ? a1[p]! : total > 0 && s > 0 ? start + span * (cum / total) : from;
      a0[child] = from; a1[child] = to;
      const d = m.depth[child]! - base;
      r0[child] = d * ring; r1[child] = (d + 1) * ring;
    }
  }
  return { root, cx, cy, radius, ring, a0, a1, r0, r1 };
}

/** Point at angle `a` (clockwise from 12 o'clock) and radius `r`. */
export const polar = (cx: number, cy: number, a: number, r: number): readonly [number, number] =>
  [cx + Math.sin(a) * r, cy - Math.cos(a) * r];

/** The node under a point, or -1: the deepest arc whose ring and span contain it. Follows child links from the drilled root only (one ring per step), never scanning the subtree. */
export function pickSunburst(m: HierarchyModel, g: SunburstGeometry, px: number, py: number): number {
  const dx = px - g.cx, dy = py - g.cy;
  const r = Math.hypot(dx, dy);
  if (!(g.ring > 0) || r > g.radius) return -1;
  // atan2 measured clockwise from 12 o'clock, in [0, 2π).
  let a = Math.atan2(dx, -dy);
  if (a < 0) a += TURN;
  let node = g.root;
  if (r <= g.ring) return node;
  // Walk down from the root: at each ring the child whose span holds the angle.
  for (;;) {
    let next = -1;
    const k = childCount(m, node);
    for (let c = 0; c < k; c++) {
      const child = childAt(m, node, c);
      if (g.a1[child]! > g.a0[child]! && a >= g.a0[child]! && a < g.a1[child]!) { next = child; break; }
    }
    if (next < 0) return -1;
    if (r < g.r1[next]!) return r >= g.r0[next]! ? next : -1;
    node = next;
  }
}

/** SVG path of an annular sector; a full turn is drawn as two halves (an arc command cannot close on itself). */
export function sectorPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const span = a1 - a0;
  if (!(span > 0) || !(r1 > r0)) return '';
  const f = (v: number) => Math.round(v * 100) / 100;
  if (span >= TURN - 1e-9) {
    const mid = a0 + Math.PI;
    const [ox0, oy0] = polar(cx, cy, a0, r1), [ox1, oy1] = polar(cx, cy, mid, r1);
    let d = `M${f(ox0)},${f(oy0)}A${f(r1)},${f(r1)} 0 1 1 ${f(ox1)},${f(oy1)}A${f(r1)},${f(r1)} 0 1 1 ${f(ox0)},${f(oy0)}Z`;
    if (r0 > 0) {
      const [ix0, iy0] = polar(cx, cy, a0, r0), [ix1, iy1] = polar(cx, cy, mid, r0);
      d += `M${f(ix0)},${f(iy0)}A${f(r0)},${f(r0)} 0 1 0 ${f(ix1)},${f(iy1)}A${f(r0)},${f(r0)} 0 1 0 ${f(ix0)},${f(iy0)}Z`;
    }
    return d;
  }
  const large = span > Math.PI ? 1 : 0;
  const [ox0, oy0] = polar(cx, cy, a0, r1), [ox1, oy1] = polar(cx, cy, a1, r1);
  if (r0 <= 0) return `M${f(cx)},${f(cy)}L${f(ox0)},${f(oy0)}A${f(r1)},${f(r1)} 0 ${large} 1 ${f(ox1)},${f(oy1)}Z`;
  const [ix1, iy1] = polar(cx, cy, a1, r0), [ix0, iy0] = polar(cx, cy, a0, r0);
  return `M${f(ox0)},${f(oy0)}A${f(r1)},${f(r1)} 0 ${large} 1 ${f(ox1)},${f(oy1)}L${f(ix1)},${f(iy1)}A${f(r0)},${f(r0)} 0 ${large} 0 ${f(ix0)},${f(iy0)}Z`;
}

/** Whether a point lies in the annular sector [r0, r1] × [a0, a1]. */
export function inSector(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number, px: number, py: number): boolean {
  const dx = px - cx, dy = py - cy;
  const r = Math.hypot(dx, dy);
  if (r < r0 || r > r1) return false;
  if (a1 - a0 >= TURN - 1e-9) return true;
  let a = Math.atan2(dx, -dy);
  if (a < 0) a += TURN;
  return a >= a0 && a <= a1;
}
