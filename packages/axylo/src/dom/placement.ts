/**
 * Where a floating tooltip goes (decision 0004 revision 3, rules 1, 2 and 6), as pure arithmetic over
 * rectangles in viewport pixels, so it runs and is tested in Node. The DOM side (tooltip.ts) measures the
 * tooltip and the obstacles and applies the result.
 *
 * - Candidates in order: above, below, right, left of the datum's box (horizontal bars: right, left, above,
 *   below); a donut tries its hole first.
 * - Along the free axis a candidate is centred on the box and shifted only as far as needed to be valid.
 * - Valid: wholly inside the visible part of the plot, and overlapping neither the box, nor any control, nor
 *   any focus ring. The hole is the one exception to the box: there the tooltip's four corners must lie
 *   inside the hole (the inner radius less the slice outline's clearance), and only the focus rings' strokes
 *   are kept clear, not their filled rectangles.
 * - Rule 6's last resort (`fallback`): each candidate pushed into the visible part, shifted along its free
 *   axis clear of every control and focus ring; the one that overlaps the box least. Controls and focus
 *   rings are never covered; when no such position exists the answer is null and nothing floats.
 */
import type { Rect } from '../core/contracts';

/** Gap between the datum's box and the tooltip. */
export const OFFSET = 8;
const EPSILON = 1e-6;

export interface Hole {
  /** Centre and radii (an ellipse under a non-uniform scale) inside which the tooltip's corners must lie. */
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
}

export interface PlacementInput {
  /** The datum's active marks enlarged by the focus ring's reach: never covered (except by rule 6). */
  readonly box: Rect;
  /** The visible part of the plot: the plot rectangle cut by the viewport and every clipping ancestor. */
  readonly visible: Rect;
  readonly order: 'vertical' | 'horizontal';
  readonly hole: Hole | null;
  readonly controls: readonly Rect[];
  /** Outer rectangles of every focus ring on show (the keyboard's datum ring, wherever that datum is). */
  readonly rings: readonly Rect[];
  /** Width of a ring's stroke, surround included, for the hole's stroke test. */
  readonly ringStroke: number;
}

export interface Spot {
  readonly x: number;
  readonly y: number;
  readonly side: 'hole' | 'above' | 'below' | 'right' | 'left';
}

type Side = Exclude<Spot['side'], 'hole'>;

/** The area two rectangles share (touching edges share none). */
export function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > EPSILON && h > EPSILON ? w * h : 0;
}

function insideRect(r: Rect, outer: Rect): boolean {
  return r.x >= outer.x - EPSILON && r.y >= outer.y - EPSILON &&
    r.x + r.width <= outer.x + outer.width + EPSILON && r.y + r.height <= outer.y + outer.height + EPSILON;
}

/** A ring's four strokes, `stroke` wide, inside its outer rectangle. */
function strokes(ring: Rect, stroke: number): Rect[] {
  const s = Math.min(stroke, ring.width / 2, ring.height / 2);
  return [
    { x: ring.x, y: ring.y, width: ring.width, height: s },
    { x: ring.x, y: ring.y + ring.height - s, width: ring.width, height: s },
    { x: ring.x, y: ring.y, width: s, height: ring.height },
    { x: ring.x + ring.width - s, y: ring.y, width: s, height: ring.height },
  ];
}

/**
 * The position along one axis nearest `preferred`, in [lo, hi], outside every open interval in `blocked`;
 * null when there is none.
 */
function nearestFree(preferred: number, lo: number, hi: number, blocked: readonly (readonly [number, number])[]): number | null {
  if (hi < lo - EPSILON) return null;
  const clamp = (v: number) => Math.max(lo, Math.min(hi, v));
  const free = (v: number) => v >= lo - EPSILON && v <= hi + EPSILON && blocked.every(([a, b]) => v <= a + EPSILON || v >= b - EPSILON);
  const options = [clamp(preferred)];
  for (const [a, b] of blocked) options.push(a, b);
  let best: number | null = null;
  for (const v of options) {
    if (!free(v)) continue;
    if (best === null || Math.abs(v - preferred) < Math.abs(best - preferred) - EPSILON) best = v;
  }
  return best === null ? null : clamp(best);
}

/**
 * The tooltip on one side of the box, with its fixed coordinate `fixed`, shifted along the free axis clear
 * of `obstacles` and inside `visible`; null when no shift is clear.
 */
function along(side: Side, fixed: number, preferred: number, width: number, height: number, visible: Rect, obstacles: readonly Rect[]): Spot | null {
  const vertical = side === 'above' || side === 'below';
  // Obstacles that meet the band the tooltip occupies across the free axis block an interval of it.
  const blocked: [number, number][] = [];
  for (const o of obstacles) {
    if (vertical) {
      if (Math.min(fixed + height, o.y + o.height) - Math.max(fixed, o.y) > EPSILON) blocked.push([o.x - width, o.x + o.width]);
    } else if (Math.min(fixed + width, o.x + o.width) - Math.max(fixed, o.x) > EPSILON) {
      blocked.push([o.y - height, o.y + o.height]);
    }
  }
  const at = vertical
    ? nearestFree(preferred, visible.x, visible.x + visible.width - width, blocked)
    : nearestFree(preferred, visible.y, visible.y + visible.height - height, blocked);
  if (at === null) return null;
  return vertical ? { x: at, y: fixed, side } : { x: fixed, y: at, side };
}

function sides(order: PlacementInput['order']): Side[] {
  return order === 'horizontal' ? ['right', 'left', 'above', 'below'] : ['above', 'below', 'right', 'left'];
}

/** The fixed coordinate of a side, and the centred preferred position along the free axis. */
function anchorOf(side: Side, box: Rect, width: number, height: number): { fixed: number; preferred: number } {
  switch (side) {
    case 'above': return { fixed: box.y - OFFSET - height, preferred: box.x + box.width / 2 - width / 2 };
    case 'below': return { fixed: box.y + box.height + OFFSET, preferred: box.x + box.width / 2 - width / 2 };
    case 'right': return { fixed: box.x + box.width + OFFSET, preferred: box.y + box.height / 2 - height / 2 };
    case 'left': return { fixed: box.x - OFFSET - width, preferred: box.y + box.height / 2 - height / 2 };
  }
}

/** The hole candidate: centred, every corner inside the hole, no ring stroke or control under it. */
function holeSpot(p: PlacementInput, width: number, height: number): Spot | null {
  const hole = p.hole;
  if (!hole || hole.rx <= 0 || hole.ry <= 0) return null;
  const spot = { x: hole.cx - width / 2, y: hole.cy - height / 2, width, height };
  // The corners are the farthest points of the rectangle from the centre.
  const reach = (width / 2 / hole.rx) ** 2 + (height / 2 / hole.ry) ** 2;
  if (reach > 1 + EPSILON || !insideRect(spot, p.visible)) return null;
  if (p.controls.some(c => overlapArea(spot, c) > 0)) return null;
  if (p.rings.some(r => strokes(r, p.ringStroke).some(s => overlapArea(spot, s) > 0))) return null;
  return { x: spot.x, y: spot.y, side: 'hole' };
}

/** Rule 2: the first valid candidate for a tooltip of this size, or null. */
export function placeTooltip(p: PlacementInput, width: number, height: number): Spot | null {
  if (width > p.visible.width + EPSILON || height > p.visible.height + EPSILON) return null;
  const hole = holeSpot(p, width, height);
  if (hole) return hole;
  const obstacles = [p.box, ...p.controls, ...p.rings];
  for (const side of sides(p.order)) {
    const { fixed, preferred } = anchorOf(side, p.box, width, height);
    // The fixed coordinate must already be inside the visible part; only the free axis may shift.
    const vertical = side === 'above' || side === 'below';
    const inside = vertical
      ? fixed >= p.visible.y - EPSILON && fixed + height <= p.visible.y + p.visible.height + EPSILON
      : fixed >= p.visible.x - EPSILON && fixed + width <= p.visible.x + p.visible.width + EPSILON;
    if (!inside) continue;
    const spot = along(side, fixed, preferred, width, height, p.visible, obstacles);
    if (spot) return spot;
  }
  return null;
}

/**
 * Rule 6's last resort, for one row that fits nowhere: each side pushed into the visible part and shifted
 * along its free axis clear of every control and focus ring; the one covering the box least. Null when no
 * such position exists (the tooltip is then not shown floating; the values are in the keyboard reading and
 * the table).
 */
export function fallbackPlacement(p: PlacementInput, width: number, height: number): Spot | null {
  if (width > p.visible.width + EPSILON || height > p.visible.height + EPSILON) return null;
  const obstacles = [...p.controls, ...p.rings];
  let best: { spot: Spot; cost: number } | null = null;
  for (const side of sides(p.order)) {
    const { fixed, preferred } = anchorOf(side, p.box, width, height);
    const vertical = side === 'above' || side === 'below';
    const pushed = vertical
      ? Math.max(p.visible.y, Math.min(fixed, p.visible.y + p.visible.height - height))
      : Math.max(p.visible.x, Math.min(fixed, p.visible.x + p.visible.width - width));
    const spot = along(side, pushed, preferred, width, height, p.visible, obstacles);
    if (!spot) continue;
    const cost = overlapArea({ x: spot.x, y: spot.y, width, height }, p.box);
    if (!best || cost < best.cost - EPSILON) best = { spot, cost };
  }
  return best?.spot ?? null;
}

/** Whether a tooltip at `spot` would be valid by rule 2 (for tests and for the caller's own checks). */
export function validSpot(p: PlacementInput, spot: { x: number; y: number }, width: number, height: number): boolean {
  const r = { x: spot.x, y: spot.y, width, height };
  if (!insideRect(r, p.visible)) return false;
  if (p.controls.some(c => overlapArea(r, c) > 0) || p.rings.some(c => overlapArea(r, c) > 0)) return false;
  return overlapArea(r, p.box) === 0;
}

/** The rectangle two rectangles share, or an empty one at the first's corner. */
export function intersect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

// ── the hold (rule 3b) ─────────────────────────────────────────────────────────────────────────────

export interface Point { readonly x: number; readonly y: number }

/**
 * Whether `p` is inside the corridor of rule 3b: the convex hull of the resting position `from` and the
 * rectangle `r`, the rectangle itself included (all in viewport pixels).
 */
export function insideCorridor(from: Point, r: Rect, p: Point): boolean {
  if (p.x >= r.x - EPSILON && p.x <= r.x + r.width + EPSILON && p.y >= r.y - EPSILON && p.y <= r.y + r.height + EPSILON) return true;
  const points: Point[] = [from, { x: r.x, y: r.y }, { x: r.x + r.width, y: r.y }, { x: r.x + r.width, y: r.y + r.height }, { x: r.x, y: r.y + r.height }]
    .sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  // Andrew's monotone chain: the hull, counter-clockwise.
  const lower: Point[] = [];
  for (const q of points) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Point[] = [];
  for (const q of [...points].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  if (hull.length < 3) return false;
  for (let i = 0; i < hull.length; i++) if (cross(hull[i]!, hull[(i + 1) % hull.length]!, p) < -EPSILON) return false;
  return true;
}
