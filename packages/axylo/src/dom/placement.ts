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

function sides(order: PlacementInput['order']): Side[] {
  return order === 'horizontal' ? ['right', 'left', 'above', 'below'] : ['above', 'below', 'right', 'left'];
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
  return place(p, width, height, false);
}

/** Rule 6: choose the legal side with least overlap when no side clears the datum. */
export function fallbackPlacement(p: PlacementInput, width: number, height: number): Spot | null {
  return place(p, width, height, true);
}

function place(p: PlacementInput, width: number, height: number, fallback: boolean): Spot | null {
  const { visible, box } = p;
  if (width > visible.width + EPSILON || height > visible.height + EPSILON) return null;
  const obstacles = [...p.controls, ...p.rings];
  if (!fallback) {
    const hole = holeSpot(p, width, height);
    if (hole) return hole;
    obstacles.unshift(box);
  }
  let best: { spot: Spot; cost: number; off: number } | null = null;
  for (const side of sides(p.order)) {
    // Translate each side into a fixed axis and the free axis along which the tooltip can slide.
    const vertical = side === 'above' || side === 'below';
    const along = vertical ? 'x' : 'y', across = vertical ? 'y' : 'x';
    const span = vertical ? 'width' : 'height', depth = vertical ? 'height' : 'width';
    const size = vertical ? width : height, thickness = vertical ? height : width;
    const lo = visible[along], hi = lo + visible[span] - size;
    const min = visible[across], max = min + visible[depth];
    const fixed = side === 'above' || side === 'left' ? box[across] - OFFSET - thickness : box[across] + box[depth] + OFFSET;
    const preferred = box[along] + box[span] / 2 - size / 2;
    const spotAt = (along: number, across: number): Spot => vertical ? { x: along, y: across, side } : { x: across, y: along, side };
    if (!fallback) {
      if (!(fixed >= min - EPSILON && fixed + thickness <= max + EPSILON)) continue;
      const blocked: [number, number][] = [];
      for (const o of obstacles) {
        if (Math.min(fixed + thickness, o[across] + o[depth]) - Math.max(fixed, o[across]) > EPSILON) {
          blocked.push([o[along] - size, o[along] + o[span]]);
        }
      }
      const at = nearestFree(preferred, lo, hi, blocked);
      if (at !== null) return spotAt(at, fixed);
      continue;
    }
    const pushed = Math.max(min, Math.min(fixed, max - thickness));
    const edges = [preferred, lo, hi, box[along] - size, box[along] + box[span]];
    for (const o of obstacles) edges.push(o[along] - size, o[along] + o[span]);
    for (const e of edges) {
      const at = Math.max(lo, Math.min(hi, e));
      const spot = spotAt(at, pushed);
      const r = { x: spot.x, y: spot.y, width, height };
      if (obstacles.some(o => overlapArea(r, o) > 0)) continue;
      const cost = overlapArea(r, p.box);
      const off = Math.abs(at - preferred);
      if (!best || cost < best.cost - EPSILON || (Math.abs(cost - best.cost) <= EPSILON && spot.side === best.spot.side && off < best.off - EPSILON)) best = { spot, cost, off };
    }
    // Candidates of later sides win only by covering less (the side order is kept on ties).
    if (best && best.cost <= EPSILON) break;
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
 * Pointer positions are known to one CSS pixel (Firefox and WebKit give whole pixels): the corridor is taken
 * with that much slack (decision 0004, clarifications).
 */
export const CORRIDOR_SLACK = 1;

/**
 * Whether `p` is inside the corridor of rule 3b: the convex hull of the resting position `from` and the
 * rectangle `r`, the rectangle itself included, widened by `CORRIDOR_SLACK` (all in viewport pixels).
 */
export function insideCorridor(from: Point, r: Rect, p: Point): boolean {
  const slack = CORRIDOR_SLACK + EPSILON;
  if (p.x >= r.x - EPSILON && p.x <= r.x + r.width + EPSILON && p.y >= r.y - EPSILON && p.y <= r.y + r.height + EPSILON) return true;
  const points: Point[] = [from, { x: r.x, y: r.y }, { x: r.x + r.width, y: r.y }, { x: r.x + r.width, y: r.y + r.height }, { x: r.x, y: r.y + r.height }]
    .sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  // Andrew's monotone chain: the hull, counter-clockwise.
  const chain = (ordered: Point[]) => {
    const half: Point[] = [];
    for (const q of ordered) {
      while (half.length >= 2 && cross(half[half.length - 2]!, half[half.length - 1]!, q) <= 0) half.pop();
      half.push(q);
    }
    half.pop();
    return half;
  };
  const hull = [...chain(points), ...chain(points.reverse())];
  if (hull.length < 3) return false;
  let outside = false;
  for (let i = 0; i < hull.length && !outside; i++) outside = cross(hull[i]!, hull[(i + 1) % hull.length]!, p) < -EPSILON;
  if (!outside) return true;
  // Outside: within the slack of the hull's boundary (the distance to its nearest edge).
  let nearest = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!, b = hull[(i + 1) % hull.length]!;
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    nearest = Math.min(nearest, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return nearest <= slack;
}
