/**
 * Floating tooltip placement (decision 0004 revision 3, rules 1, 2, 6) and corridor hold (rule 3b),
 * pure rectangle arithmetic in viewport pixels so it runs in Node.
 */
import type { Rect } from '../core/contracts';
import { clamp } from '../scene/geometry';

export const OFFSET = 8;
const E = 1e-6;

export interface Hole {
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
}

export interface PlacementInput {
  readonly box: Rect;
  readonly visible: Rect;
  readonly order: 'vertical' | 'horizontal';
  readonly hole: Hole | null;
  readonly controls: readonly Rect[];
  readonly rings: readonly Rect[];
  readonly ringStroke: number;
}

export interface Spot {
  readonly x: number;
  readonly y: number;
  readonly side: 'hole' | 'above' | 'below' | 'right' | 'left';
}

type Side = Exclude<Spot['side'], 'hole'>;

export function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > E && h > E ? w * h : 0;
}

function hits(r: Rect, list: readonly Rect[]): boolean {
  for (let i = 0; i < list.length; i++) if (overlapArea(r, list[i]!) > 0) return true;
  return false;
}

// The rectangle under test on each move, reused: only the spot that wins becomes an object.
const probe = { x: 0, y: 0, width: 0, height: 0 };
function probeAt(x: number, y: number, width: number, height: number): Rect {
  probe.x = x; probe.y = y; probe.width = width; probe.height = height;
  return probe;
}

const insideRect = (r: Rect, o: Rect) =>
  r.x >= o.x - E && r.y >= o.y - E && r.x + r.width <= o.x + o.width + E && r.y + r.height <= o.y + o.height + E;

function holeSpot(p: PlacementInput, width: number, height: number): Spot | null {
  const h = p.hole;
  if (!h || h.rx <= 0 || h.ry <= 0) return null;
  const x = h.cx - width / 2, y = h.cy - height / 2;
  const r = probeAt(x, y, width, height);
  if ((width / 2 / h.rx) ** 2 + (height / 2 / h.ry) ** 2 > 1 + E || !insideRect(r, p.visible) || hits(r, p.controls)) return null;
  for (const ring of p.rings) {
    const s = Math.min(p.ringStroke, ring.width / 2, ring.height / 2);
    // Overlaps one of the four stroke strips iff it overlaps the outer rect without lying wholly inside the inner hole.
    if (overlapArea(r, ring) > 0 && !insideRect(r, { x: ring.x + s, y: ring.y + s, width: ring.width - 2 * s, height: ring.height - 2 * s })) return null;
  }
  return { x, y, side: 'hole' };
}

export const placeTooltip = (p: PlacementInput, w: number, h: number): Spot | null => place(p, w, h, false);
export const fallbackPlacement = (p: PlacementInput, w: number, h: number): Spot | null => place(p, w, h, true);

const HORIZ: readonly Side[] = ['right', 'left', 'above', 'below'];
const VERT: readonly Side[] = ['above', 'below', 'right', 'left'];

function place(p: PlacementInput, width: number, height: number, fallback: boolean): Spot | null {
  const { visible, box } = p;
  if (width > visible.width + E || height > visible.height + E) return null;
  let obstacles: readonly Rect[] | undefined;
  if (!fallback) {
    const hole = holeSpot(p, width, height);
    if (hole) return hole;
  }
  let bestSpot: Spot | null = null, bestCost = Infinity, bestOff = Infinity;
  for (const side of p.order === 'horizontal' ? HORIZ : VERT) {
    const vert = side === 'above' || side === 'below';
    const ax = vert ? 'x' : 'y', cx = vert ? 'y' : 'x', sp = vert ? 'width' : 'height', dp = vert ? 'height' : 'width';
    const size = vert ? width : height, thick = vert ? height : width;
    const lo = visible[ax], hi = lo + visible[sp] - size, min = visible[cx], max = min + visible[dp];
    const fixed = side === 'above' || side === 'left' ? box[cx] - OFFSET - thick : box[cx] + box[dp] + OFFSET;
    if (!fallback && (fixed < min - E || fixed + thick > max + E)) continue;
    const across = fallback ? clamp(fixed, min, max - thick) : fixed;
    const pref = box[ax] + box[sp] / 2 - size / 2;
    if (!fallback) {
      const at = clamp(pref, lo, hi), x = vert ? at : across, y = vert ? across : at;
      const r = probeAt(x, y, width, height);
      if (!hits(r, p.controls) && !hits(r, p.rings) && overlapArea(r, box) === 0) return { x, y, side };
    }
    // Only a blocked candidate needs the edges of every obstacle.
    const obs = obstacles ??= fallback ? [...p.controls, ...p.rings] : [box, ...p.controls, ...p.rings];
    const edges = fallback ? [pref, lo, hi, box[ax] - size, box[ax] + box[sp]] : [];
    for (const o of obs) {
      if (o[cx] + o[dp] > across + E && o[cx] < across + thick - E) edges.push(o[ax] - size, o[ax] + o[sp]);
    }
    for (const e of edges) {
      const at = clamp(e, lo, hi), x = vert ? at : across, y = vert ? across : at;
      const r = probeAt(x, y, width, height);
      if (hits(r, obs)) continue;
      const cost = fallback ? overlapArea(r, box) : 0, off = Math.abs(at - pref);
      if (!bestSpot || cost < bestCost - E || (Math.abs(cost - bestCost) <= E && side === bestSpot.side && off < bestOff - E)) {
        bestSpot = { x, y, side }; bestCost = cost; bestOff = off;
      }
    }
    if (bestSpot && (!fallback || bestCost <= E)) break;
  }
  return bestSpot;
}

export function validSpot(p: PlacementInput, spot: { x: number; y: number }, width: number, height: number): boolean {
  const r = probeAt(spot.x, spot.y, width, height);
  return insideRect(r, p.visible) && !hits(r, p.controls) && !hits(r, p.rings) && overlapArea(r, p.box) === 0;
}

export function intersect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
}

export interface Point { readonly x: number; readonly y: number }
export const CORRIDOR_SLACK = 1;

export function insideCorridor(from: Point, r: Rect, p: Point): boolean {
  if (insideRect({ x: p.x, y: p.y, width: 0, height: 0 }, r)) return true;
  const x2 = r.x + r.width, y2 = r.y + r.height;
  const pts: Point[] = [from, { x: r.x, y: r.y }, { x: x2, y: r.y }, { x: x2, y: y2 }, { x: r.x, y: y2 }]
    .sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const chain = (list: Point[]) => {
    const h: Point[] = [];
    for (const q of list) {
      while (h.length >= 2 && cross(h[h.length - 2]!, h[h.length - 1]!, q) <= 0) h.pop();
      h.push(q);
    }
    h.pop();
    return h;
  };
  const hull = [...chain(pts), ...chain(pts.reverse())], n = hull.length;
  if (n < 3) return false;
  let outside = false, nearest = Infinity;
  for (let i = 0; i < n; i++) {
    const a = hull[i]!, b = hull[(i + 1) % n]!;
    if (cross(a, b, p) < -E) outside = true;
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    nearest = Math.min(nearest, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return !outside || nearest <= CORRIDOR_SLACK + E;
}
