/**
 * The painted picture of a bubble geometry as one SVG path per series: the exact visible parts of every disc.
 *
 * Why not one path of whole circles per series: SVG paints a path in one colour, all at once, so paths of whole
 * circles cannot follow a painter's order that interleaves series (A ⊃ B ⊃ A ⊃ B …). Instead the picture the
 * painter's order would produce is computed as a planar map and each series receives the boundary of the region
 * it owns. Every point of the plot is owned by the topmost shape containing it (painter's order: largest first,
 * equal radii by source row, so the smallest and then the latest is on top), and painted with that shape's band.
 *
 * Shapes (all opaque, so ownership is well defined):
 *  - a positive size: its disc of radius r in the series colour, ringed by a GAP px band painted with nothing, so
 *    a bubble over another of the same series keeps a visible edge (the plot shows through the ring);
 *  - a zero size: a 1 px ring (ZERO_RADIUS ± 0.5) in the series colour, with a GAP px band of nothing on each
 *    side; the hole shows what is beneath.
 *
 * Every band edge is a circle. For each circle in turn: the angles covered by a higher shape's occupied annulus
 * are removed (a coincident or tangent higher boundary counts as covering, so equal discs are drawn once); the
 * visible angles are split where a circle of a lower shape crosses, when the side away from this shape's bands
 * shows lower shapes; each piece then has an owner on either side. A piece whose two owners differ is added to
 * the inner owner's path traversed with increasing angle and to the outer owner's reversed, so every series'
 * pieces form closed boundaries with its region on the same side (nonzero fill). Pieces are joined into closed
 * contours at shared end points (written at 0.01 px, as every coordinate here).
 */
import type { BubbleGeometry } from './geometry';
import { scaleFor, writeNum, writeRadius, ZERO_RADIUS } from './geometry';

/** Width in CSS px of the unpainted ring around every bubble and on both sides of a zero marker. */
export const GAP = 1;
// Literals, not Math.PI expressions: a property read at the top level is a side effect to a bundler that
// ignores purity annotations, and importing this module must leave nothing behind.
const TAU = 6.283185307179586;
const ARC_LIMIT = 2.0943951023931953;
/** Lattice steps (0.01 px) within which piece end points are joined. */
const JOIN = 2;
/** Boundaries within this distance (CSS px) of a higher shape's edge count as covered (tangency, equal discs). */
const EPS = 1e-6;

/** Band owner codes: >= 0 a series, NONE an unpainted band, BELOW whatever lower shapes paint there. */
const NONE = -1;
const BELOW = -2;

export interface PaintedSeries {
  /** The `d` of this series' path ('' when it shows nothing). */
  readonly d: string;
  /** Pieces of circles in the path, and contours they were joined into. */
  readonly arcs: number;
  readonly contours: number;
  /** Contours that did not return to their start (closed by a straight segment); 0 for consistent input. */
  readonly open: number;
}

export interface PaintedMap {
  readonly series: readonly PaintedSeries[];
  /** Bubbles painted after exact duplicates (same centre and radius) were collapsed onto the topmost one. */
  readonly painted: number;
  /** Neighbour pairs enumerated (the work of the candidate step), for complexity tests. */
  readonly pairs: number;
  /** Circles whose boundary was entirely covered by higher shapes, of all circles considered. */
  readonly culled: number;
  readonly circles: number;
}

const SELF = -3;

/**
 * Distance off a circle (CSS px) at which the lower owner of a piece is read. Lower edges within EPS beyond an
 * outer circle are not resolved by this offset but by the very predicate step 1 culls them with (ownerAt's
 * collapsed edges): a sampled sliver and a culled sliver must never be the same one (the review's four-row
 * fixture was culled at 5e-7 px yet sampled inside at 1e-7, leaving an open contour and a fill at
 * (54.25, 51.25)). Half of EPS keeps the sample inside every sliver step 1 does draw (width > EPS).
 */
const OFF = 5e-7;
/** Centre distances within this of a tangency are treated as touching at one point. */
const TOUCH = 1e-6;

const norm = (a: number): number => { a %= TAU; return a < 0 ? a + TAU : a; };


/** One oriented piece of a circle: from angle a to b (a < b) traversed increasing (dir 1) or decreasing (-1). */
interface Piece { cx: number; cy: number; rho: number; a: number; b: number; dir: 1 | -1 }

// The three/five bands include BELOW on the unoccupied side of each marker.
const DISC = [SELF, NONE, BELOW];
const RING = [BELOW, NONE, SELF, NONE, BELOW];
const zeroInner = ZERO_RADIUS - 0.5 - GAP;
const zeroOuter = ZERO_RADIUS + 0.5 + GAP;
const zeroEdges = [zeroInner, ZERO_RADIUS - 0.5, ZERO_RADIUS + 0.5, zeroOuter];
const bands = (r: number) => r ? DISC : RING;
const edge = (r: number, i: number) => r ? r + i * GAP : zeroEdges[i]!;

/** Growable interval list (pairs of angles in [0, 2π]) with subtraction. */
class Arcs {
  list = new Float64Array(64);
  length = 0;
  #spare = new Float64Array(64);
  reset(): void { this.list[0] = 0; this.list[1] = TAU; this.length = 2; }
  /** Removes [a, b] (0 ≤ a < b ≤ 2π). */
  cut(a: number, b: number): void {
    const from = this.list, n = this.length;
    if (this.#spare.length < n + 4) this.#spare = new Float64Array((n + 4) * 2);
    const to = this.#spare;
    let m = 0;
    for (let i = 0; i < n; i += 2) {
      const lo = from[i]!, hi = from[i + 1]!;
      if (hi <= a || lo >= b) { to[m++] = lo; to[m++] = hi; continue; }
      if (lo < a) { to[m++] = lo; to[m++] = a; }
      if (hi > b) { to[m++] = b; to[m++] = hi; }
    }
    this.#spare = from;
    this.list = to;
    this.length = m;
  }
  /** Removes the angles within `half` of `mid` (any real `mid`). */
  cutAround(mid: number, half: number): void {
    if (half >= Math.PI) { this.length = 0; return; }
    if (half <= 0) return;
    const a = norm(mid - half), b = a + 2 * half;
    if (b <= TAU) this.cut(a, b);
    else { this.cut(a, TAU); this.cut(0, b - TAU); }
  }
}

/** Each bit certifies a whole CSS pixel, including its corners, inside a higher occupied disc. */
function coveredShapes(g: BubbleGeometry, outer: Float64Array, list: Uint32Array, left: number, top: number, width: number, height: number) {
  // Stay on the pixel lattice where EPS dominates rounding, and bound scratch even for extreme layouts.
  if (!(list.length > 64 && width <= 2048 && height <= 2048 && Math.abs(left) < 1e7 && Math.abs(top) < 1e7)) return;
  const words = Math.ceil(width / 32);
  const bits = new Uint32Array(words * height);
  const hidden = new Uint8Array(g.count);
  const span = (row: number, lo: number, hi: number, stamp: boolean) => {
    for (let word = lo >> 5; word <= hi >> 5; word++) {
      const mask = (word === lo >> 5 ? -1 << (lo & 31) : -1) & (word === hi >> 5 ? -1 >>> (31 - (hi & 31)) : -1);
      const slot = row * words + word;
      if (stamp) bits[slot]! |= mask;
      else if (~bits[slot]! & mask) return false;
    }
    return true;
  };
  // A duplicate's identical topmost disc visits first, so stamping it again cannot add coverage.
  for (let i = g.count - 1; i >= 0; i--) {
    const b = g.order[i]!, x = g.x[b]! - left, y = g.y[b]! - top, r = outer[b]!;
    const x0 = Math.floor(x - r), x1 = Math.floor(x + r), y0 = Math.floor(y - r), y1 = Math.floor(y + r);
    if (!(x0 >= 0 && y0 >= 0 && x1 < width && y1 < height)) continue;
    let row = y0;
    while (row <= y1 && span(row, x0, x1, false)) row++;
    if (row > y1) { hidden[b] = 1; continue; }
    if (g.r[b] === 0) continue;
    const rr = (r - 8 * EPS) ** 2;
    for (let row = y0 + 1; row < y1; row++) {
      const dy = Math.abs(row + 0.5 - y) + 0.5;
      const dx = Math.sqrt(rr - dy * dy);
      const a = Math.ceil(x - dx), z = Math.floor(x + dx) - 1;
      if (a <= z) span(row, a, z, true);
    }
  }
  return hidden;
}

function crossing(rho: number, d: number, r: number): number {
  const cosine = (rho * rho + d * d - r * r) / (2 * rho * d);
  return Math.acos(Math.max(-1, Math.min(1, cosine)));
}

let maps: WeakMap<BubbleGeometry, PaintedMap> | undefined;

const STRIDES = [7919, 104729, 1299709, 15485863];
function gcd(a: number, b: number): number { while (b) [a, b] = [b, a % b]; return a; }
function strideFor(count: number): number {
  if (count < 3) return 1;
  for (const p of STRIDES) { const s = p % count; if (s > 0 && gcd(s, count) === 1) return s; }
  return 1;
}

/**
 * The visible map of a geometry: per frame series index, the path of what it shows. Cost: per bubble, the
 * shapes whose occupied area can meet its own (a uniform grid of centres); per circle, the higher of those until
 * the circle is covered, and only for its visible angles the lower ones.
 */
export function paintedMap(g: BubbleGeometry, seriesCount: number): PaintedMap {
  const known = (maps ??= new WeakMap()).get(g);
  if (known && known.series.length === seriesCount) return known;
  const S = Math.max(0, seriesCount);
  const { rank, order } = g;
  const gx = g.x, gy = g.y;
  const outer = g.r.subarray(0, g.count).map(r => r ? r + GAP : zeroOuter);
  // Exact duplicates paint the same shape: only the topmost (highest rank) can show, so the others are left out
  // of painting before any neighbour is enumerated (n coincident bubbles would otherwise cost n² pairs). Rows,
  // picking and the table keep every one of them; only the picture is shared.
  const paintedList = distinctShapes(g);
  const pn = paintedList.length;
  const concentric = pn > 2 ? concentricMap(g, outer, paintedList, S) : null;
  if (concentric) { maps.set(g, concentric); return concentric; }
  let pairs = 0;
  let reach = 0;
  // A uniform grid of centres.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let q = 0; q < pn; q++) {
    const b = paintedList[q]!;
    const x = gx[b]!, y = gy[b]!;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    reach = Math.max(reach, outer[b]!);
  }
  const left = Math.floor(minX - reach), top = Math.floor(minY - reach);
  const hidden = coveredShapes(g, outer, paintedList, left, top, Math.floor(maxX + reach - left) + 1, Math.floor(maxY + reach - top) + 1);
  // On a visible outer arc a buried disc cannot own the outward sample. Its
  // covering solid either clips the arc from above, or outranks it below.
  // Small circles, holes and unbounded coordinates use every lower neighbour.
  const pruneLower = hidden && g.r.every(r => r >= 1);
  const cell = Math.max(4, reach / 2);
  const cols = pn ? Math.floor((maxX - minX) / cell) + 1 : 1, rowsN = pn ? Math.floor((maxY - minY) / cell) + 1 : 1;
  const heads = new Uint32Array(cols * rowsN), next = new Uint32Array(g.count);
  for (let q = pn - 1; q >= 0; q--) {
    const b = paintedList[q]!;
    const c = Math.floor((gy[b]! - minY) / cell) * cols + Math.floor((gx[b]! - minX) / cell);
    next[b] = heads[c]!;
    heads[c] = b + 1;
  }
  const pieces: Piece[][] = Array.from({ length: S }, () => []);
  const full: Piece[][] = Array.from({ length: S }, () => []);
  const cand = new Int32Array(pn), buried = new Int32Array(pn);
  const distance = new Float64Array(g.count);
  let count = 0, buriedCount = 0;
  let cuts = new Float64Array(64);
  const vis = new Arcs();
  let culled = 0, circles = 0;

  // The lower shapes that meet the circle being split, by rank from the top down.
  const lower = new Int32Array(pn);
  const probes: number[] = [];
  const probeRadius = 0.01;
  let lowerCount = 0;
  /**
   * Painted owner at a point among the lower shapes of the circle: the first (highest) that contains it, its
   * band there, and below it again when that band is a hole. Dense data puts most of them over any point, so the
   * scan stops after a few.
   */
  const ownerAt = (px: number, py: number, b: number, outward: boolean): number => {
    const reachB = outer[b]!;
    for (let k = lowerCount - 1; k >= 0; k--) {
      const j = order[lower[k]!]!;
      const dx = px - gx[j]!, dy = py - gy[j]!, d = Math.sqrt(dx * dx + dy * dy);
      const r = g.r[j]!, codes = bands(r);
      if (!(d < outer[j]!) || (!r && d <= zeroInner)) continue;
      // On the outward sample, a lower edge collapsed by the same EPS predicate
      // as step 1 is already behind the sample. A collapsed outer edge reveals
      // the next lower shape. The strict hole test above handles BELOW on rings.
      for (let c = 0; c + 1 < codes.length; c++) {
        const R = edge(r, c);
        if (d < R && !(outward && distance[j]! + R <= reachB + EPS)) {
          return codes[c] === SELF ? g.series[j]! : NONE;
        }
      }
    }
    return NONE;
  };

  for (let q = 0; q < pn; q++) {
    const b = paintedList[q]!;
    const cx = gx[b]!, cy = gy[b]!, rb = rank[b]!, s = g.series[b]!;
    const own = outer[b]!, radius = g.r[b]!, codes = bands(radius);
    if (hidden?.[b]) {
      const edges = codes.length - 1;
      circles += edges; culled += edges;
      continue;
    }
    const span = own + reach;
    const c0 = Math.max(0, Math.floor((cx - span - minX) / cell)), c1 = Math.min(cols - 1, Math.floor((cx + span - minX) / cell));
    const r0 = Math.max(0, Math.floor((cy - span - minY) / cell)), r1 = Math.min(rowsN - 1, Math.floor((cy + span - minY) / cell));
    count = 0;
    for (let ry = r0; ry <= r1; ry++) {
      for (let rx = c0; rx <= c1; rx++) {
        const c = ry * cols + rx;
        for (let j = heads[c]! - 1; j >= 0; j = next[j]! - 1) {
          if (j === b) continue;
          pairs++;
          const dx = gx[j]! - cx, dy = gy[j]! - cy, reachJ = own + outer[j]!;
          const d2 = dx * dx + dy * dy;
          if (d2 >= reachJ * reachJ) continue;
          cand[count++] = j;
        }
      }
    }
    const stride = strideFor(count);
    for (let ci = 0; ci + 1 < codes.length; ci++) {
      const rho = edge(radius, ci);
      if (rho <= 0) continue;
      circles++;
      const innerOwner = codes[ci] === SELF ? s : codes[ci]!;
      const outerOwner = codes[ci + 1] === SELF ? s : codes[ci + 1]!;
      // 1. Remove what higher shapes cover, until nothing is left.
      vis.reset();
      // Visited in a scattered order (a stride coprime with the count), so shapes all around the circle come
      // early and a covered circle, the common case when bubbles are dense, is known covered after few.
      for (let i = 0, k = 0; i < count && vis.length; i++, k = k + stride >= count ? k + stride - count : k + stride) {
        const j = cand[k]!;
        if (rank[j]! <= rb) continue;
        const dx = gx[j]! - cx, dy = gy[j]! - cy, d2 = dx * dx + dy * dy;
        const R = outer[j]!, h = g.r[j] ? -1 : zeroInner;
        if (h <= 0 && R > rho && R < 1e7 && d2 <= (R - rho) ** 2) { vis.length = 0; break; }
        const d = Math.sqrt(d2);
        // The hole of an annulus meets the circle only when it crosses it.
        const holeCrosses = h > 0 && !(d + rho <= h - EPS) && !(d >= rho + h + EPS) && !(d + h <= rho - EPS);
        if (d + rho <= R + EPS) {
          if (h <= 0) { vis.length = 0; break; }
          if (d + rho <= h - EPS) continue;
          if (!holeCrosses) { vis.length = 0; break; }
          vis.cutAround(Math.atan2(dy, dx) + Math.PI, Math.PI - crossing(rho, d, h));
          continue;
        }
        if (d >= rho + R - EPS || d + R <= rho + EPS) continue;
        const om = Math.atan2(dy, dx), oh = crossing(rho, d, R);
        if (!holeCrosses) { vis.cutAround(om, oh); continue; }
        const hh = crossing(rho, d, h);
        // Concentric bands: the hole's interval is centred on the same direction, inside the outer one.
        vis.cutAround(om - (oh + hh) / 2, (oh - hh) / 2);
        vis.cutAround(om + (oh + hh) / 2, (oh - hh) / 2);
      }
      if (!vis.length) { culled++; continue; }
      const visible = vis.list;
      const needsBelow = innerOwner === BELOW || outerOwner === BELOW;
      if (!needsBelow) {
        const wraps = vis.length >= 4 && visible[0] === 0 && visible[vis.length - 1] === TAU;
        for (let v = wraps ? 2 : 0; v < vis.length; v += 2) {
          const end = wraps && v + 2 === vis.length ? visible[1]! + TAU : visible[v + 1]!;
          emitPiece(cx, cy, rho, visible[v]!, end, innerOwner, outerOwner, pieces, full);
        }
        continue;
      }
      // 2. Split the visible angles where lower circles cross or touch, and find the lower owner of each piece.
      const offset = rho + (innerOwner === BELOW ? -OFF : OFF);
      buriedCount = lowerCount = 0;
      for (let k = 0; k < count; k++) {
        const j = cand[k]!;
        if (rank[j]! >= rb) continue;
        const dx = gx[j]! - cx, dy = gy[j]! - cy, d = Math.sqrt(dx * dx + dy * dy);
        if (d > rho + outer[j]! + TOUCH || d + outer[j]! < rho - TOUCH) continue;
        distance[j] = d;
        if (pruneLower && hidden[j]) {
          if (d + rho >= g.r[j]! - TOUCH) buried[buriedCount++] = j;
        } else lower[lowerCount++] = rank[j]!;
      }
      lower.subarray(0, lowerCount).sort();
      let m = 0;
      const push = (t: number) => {
        if (m === cuts.length) { const grown = new Float64Array(m * 2); grown.set(cuts); cuts = grown; }
        cuts[m++] = t;
      };
      for (let v = 0; v < vis.length; v++) push(visible[v]!);
      // Buried edges can still split an interval. The reference samples at the
      // angular midpoint on the offset circle, so dropping a cut near a colour
      // transition can change its owner. Keep buried cuts near each nominal
      // crossing and visible end. If the shifted crossing is delta radians away,
      // a cut farther than 2*delta cannot move a midpoint across it: the nominal
      // cut is already closer. Four times the arc distance also covers a shifted
      // crossing entering from outside the visible interval. Include room for
      // the reference's skipped 1e-12 intervals, TOUCH, and floating point.
      const rounding = 8 * EPS + rho * count * 8e-12;
      let guard = rounding;
      probes.length = 0;
      // A higher-ranked candidate occupying the whole guard neighbourhood hides the
      // transition too. When the bound reaches that neighbourhood's radius
      // (including uncertain tangencies), enumerate all buried edges instead.
      const probe = (t: number, k: number) => {
        const x = cx + rho * Math.cos(t), y = cy + rho * Math.sin(t);
        for (let i = lowerCount - 1; i > k; i--) {
          const j = order[lower[i]!]!, dx = x - gx[j]!, dy = y - gy[j]!;
          if (dx * dx + dy * dy < (outer[j]! - probeRadius) ** 2) return;
        }
        probes.push(x, y);
      };
      if (buriedCount) for (let v = 0; v < vis.length; v++) probe(visible[v]!, lowerCount);
      // The potentially owning edges establish the probes before cutter-only edges use them.
      for (let i = 0; i < lowerCount + buriedCount; i++) {
        const k = lowerCount - 1 - i;
        const j = k < 0 ? buried[-1 - k]! : order[lower[k]!]!;
        if (k < 0 && guard < probeRadius) {
          const rr = g.r[j]! ** 2, RR = outer[j]! ** 2, tolerance = guard * (2 * outer[j]! + guard);
          let hit = false;
          for (let e = 0; e < probes.length; e += 2) {
            const dx = probes[e]! - gx[j]!, dy = probes[e + 1]! - gy[j]!, d2 = dx * dx + dy * dy;
            if (Math.min(Math.abs(d2 - rr), Math.abs(d2 - RR)) <= tolerance) { hit = true; break; }
          }
          if (!hit) continue;
        }
        const dx = gx[j]! - cx, dy = gy[j]! - cy, d = distance[j]!;
        if (d < TOUCH) { if (k >= 0) guard = Infinity; continue; }
        const toward = Math.atan2(dy, dx);
        for (let c = 0; c < (g.r[j] ? 2 : 4); c++) {
          const R = edge(g.r[j]!, c);
          if (R <= 0 || d > rho + R + TOUCH || d < Math.abs(rho - R) - TOUCH) continue;
          let t0: number, t1 = NaN;
          if (Math.abs(d - (rho + R)) <= TOUCH) t0 = toward;
          else if (Math.abs(d - Math.abs(rho - R)) <= TOUCH) t0 = rho > R ? toward : toward + Math.PI;
          else {
            const half = crossing(rho, d, R);
            t0 = toward - half; t1 = toward + half;
            if (k >= 0 && buriedCount) guard = Math.max(guard, rounding + 4 * rho * Math.abs(half - crossing(offset, d, R)));
          }
          if (k >= 0 && Number.isNaN(t1)) guard = Infinity;
          for (let q = 0; q < 2; q++) {
            const t = norm(q ? t1 : t0);
            for (let v = 0; v < vis.length; v += 2) if (t > visible[v]! && t < visible[v + 1]!) {
              push(t);
              if (k >= 0 && buriedCount && guard < probeRadius) probe(t, k);
              break;
            }
          }
        }
      }
      const sorted = cuts.subarray(0, m).sort();
      let cursor = 0;
      for (let v = 0; v < vis.length; v += 2) {
        const end = visible[v + 1]!;
        let runStart = sorted[cursor]!, runOwner = Number.NaN;
        const flush = (end: number) => {
          if (Number.isNaN(runOwner) || end <= runStart) return;
          const i = innerOwner === BELOW ? runOwner : innerOwner, o = outerOwner === BELOW ? runOwner : outerOwner;
          if (i !== o) emitPiece(cx, cy, rho, runStart, end, i, o, pieces, full);
        };
        for (; cursor + 1 < m && sorted[cursor]! < end; cursor++) {
          const p = sorted[cursor]!, q = sorted[cursor + 1]!;
          if (q - p <= 1e-12) continue;
          const mid = (p + q) / 2;
          const owner = ownerAt(cx + offset * Math.cos(mid), cy + offset * Math.sin(mid), b, outerOwner === BELOW);
          if (owner !== runOwner) { flush(p); runStart = p; runOwner = owner; }
        }
        flush(end);
        cursor++;
      }
    }
  }
  const series = pieces.map((list, s) => assemble(list, full[s]!));
  const map: PaintedMap = { series, culled, circles, painted: pn, pairs };
  maps.set(g, map);
  return map;
}

/**
 * The exact picture when every painted shape shares one centre (a concentric cluster, the worst case of the
 * general step: every pair of shapes meets). Ownership then depends on the radius alone: along the sorted band
 * edges, each radial band is owned by the topmost shape (highest rank) whose occupied annulus covers it, painted
 * with that shape's band there (a zero ring's hole is outside its annulus, so what is under it shows). A sweep
 * over the sorted edges advances monotonically through the discs; a full circle is emitted at
 * every edge where the owner changes. Null when the shapes do not share a centre exactly: the general step runs.
 * Measured limit (ledger): the fast path does not apply once any other point shares the plot.
 */
function concentricMap(g: BubbleGeometry, outer: Float64Array, list: Uint32Array, S: number): PaintedMap | null {
  const n = list.length, cx = g.x[list[0]!]!, cy = g.y[list[0]!]!;
  for (let q = 1; q < n; q++) if (g.x[list[q]!] !== cx || g.y[list[q]!] !== cy) return null;
  // Distinct concentric discs are already sorted by increasing radius. Only the zero marker
  // has a hole; it is on top wherever its annulus is occupied.
  const ring = g.r[list[0]!] === 0 ? list[0]! : -1;
  const edges = new Float64Array(n * 2 + (ring >= 0 ? 2 : 0));
  let k = 0;
  for (const b of list) for (let c = 0; c < (g.r[b] ? 2 : 4); c++) edges[k++] = edge(g.r[b]!, c);
  edges.sort();
  const pieces: Piece[][] = Array.from({ length: S }, () => []);
  const full: Piece[][] = Array.from({ length: S }, () => []);
  let next = ring >= 0 ? 1 : 0, before = NONE, at = 0, circles = 0;
  for (let e = 0; e <= edges.length; e++) {
    const hi = e < edges.length ? edges[e]! : Infinity;
    if (!(hi > at)) continue;
    const mid = hi === Infinity ? at + 1 : (at + hi) / 2;
    while (next < n && outer[list[next]!]! <= mid) next++;
    const top = ring >= 0 && at >= zeroInner && mid < zeroOuter ? ring : list[next];
    let owner: number = NONE;
    if (top !== undefined) {
      if (top === ring ? mid >= zeroEdges[1]! && mid < zeroEdges[2]! : mid < g.r[top]!) owner = g.series[top]!;
    }
    if (owner !== before && at > 0) {
      circles++;
      emitPiece(cx, cy, at, 0, TAU, before, owner, pieces, full);
    }
    before = owner; at = hi;
  }
  return { series: pieces.map((l, s) => assemble(l, full[s]!)), culled: 0, circles, painted: n, pairs: 0 };
}

/**
 * Bubbles of the geometry with exact duplicates (same x, y and radius, so the same shape) collapsed onto the one
 * with the highest rank, the one painted on top. Sorted by (x, y, r) so duplicates are adjacent: n log n.
 */
function distinctShapes(g: BubbleGeometry): Uint32Array {
  const n = g.count, { x, y, r, rank } = g;
  const byShape = new Uint32Array(n);
  for (let b = 0; b < n; b++) byShape[b] = b;
  byShape.sort((a, b) => (x[a]! - x[b]!) || (y[a]! - y[b]!) || (r[a]! - r[b]!) || (rank[b]! - rank[a]!));

  let m = 0;
  for (let i = 0; i < n; i++) {
    const b = byShape[i]!;
    if (m > 0) {
      const p = byShape[m - 1]!;
      if (x[p] === x[b] && y[p] === y[b] && r[p] === r[b]) continue;
    }
    byShape[m++] = b;
  }
  return byShape.subarray(0, m);
}

/** Adds visible angle pairs as pieces: increasing for the inner owner, decreasing for the outer owner. */
function emitPiece(cx: number, cy: number, rho: number, a: number, b: number, inner: number, outer: number, pieces: Piece[][], full: Piece[][]): void {
  const to = b - a >= TAU - 1e-12 ? full : pieces;
  if (inner >= 0) to[inner]!.push({ cx, cy, rho, a, b, dir: 1 });
  if (outer >= 0) to[outer]!.push({ cx, cy, rho, a, b, dir: -1 });
}

/** A point of a piece's circle, written at that circle's precision (finer below 1 px: geometry.scaleFor). */
function at(p: Piece, angle: number): string {
  const scale = scaleFor(p.rho);
  return writeNum(p.cx + p.rho * Math.cos(angle), scale) + ' ' + writeNum(p.cy + p.rho * Math.sin(angle), scale);
}

/**
 * SVG arcs from angle `from` to `to` (|to − from| ≤ 2π), split so no arc spans more than 2π/3. The written end
 * points are rounded to 0.01 px (the radius keeps 7 digits: geometry.writeRadius); an arc near a half turn would turn that into a centre shift of a large
 * fraction of a pixel (the renderer scales the radius to the chord), at 2π/3 it stays within 0.01 px.
 */
function arcs(p: Piece, from: number, to: number): string {
  const span = to - from, parts = Math.max(1, Math.ceil(Math.abs(span) / ARC_LIMIT - 1e-9));
  const rr = writeRadius(p.rho), sweep = span > 0 ? 1 : 0;
  let d = '';
  for (let k = 1; k <= parts; k++) d += `A${rr} ${rr} 0 0 ${sweep} ${at(p, from + (span * k) / parts)}`;
  return d;
}

/** Joins pieces into closed contours at shared end points and writes them; whole circles are their own. */
function assemble(list: Piece[], whole: Piece[]): PaintedSeries {
  let d = '';
  let contours = 0, open = 0, count = 0;
  for (const p of whole) {
    // Relative semicircles whose diameter is exactly twice the written radius: the start point may round to the
    // lattice, but the radius and closure stay exact, so the painted area matches the size (A ∝ v).
    const rr = writeRadius(p.rho), dd = String(2 * Number(rr)), sweep = p.dir > 0 ? 1 : 0;
    d += `M${writeNum(p.cx - Number(rr), scaleFor(p.rho))} ${writeNum(p.cy, scaleFor(p.rho))}a${rr} ${rr} 0 1 ${sweep} ${dd} 0a${rr} ${rr} 0 1 ${sweep} -${dd} 0Z`;
    contours++; count++;
  }
  // End points are matched on the 0.01 px lattice they are written at, to JOIN lattice steps: a vertex shared by
  // two circles is computed from each and may round to neighbouring lattice points, and a piece shorter than the
  // precision moves its neighbours' meeting point by a step. A join within 0.02 px leaves every piece in place;
  // only the contours they are read into change, which the nonzero rule does not see.
  const m = list.length;
  const qx = new Int32Array(m * 2), qy = new Int32Array(m * 2);
  for (let i = 0; i < m; i++) {
    const p = list[i]!;
    const a0 = p.dir > 0 ? p.a : p.b, a1 = p.dir > 0 ? p.b : p.a;
    qx[2 * i] = Math.round((p.cx + p.rho * Math.cos(a0)) * 100); qy[2 * i] = Math.round((p.cy + p.rho * Math.sin(a0)) * 100);
    qx[2 * i + 1] = Math.round((p.cx + p.rho * Math.cos(a1)) * 100); qy[2 * i + 1] = Math.round((p.cy + p.rho * Math.sin(a1)) * 100);
  }
  // End points within JOIN lattice steps of each other are one vertex, transitively (union-find), so the vertex
  // a joined contour meets is the same whichever of its pieces is read first.
  const parent = new Int32Array(m * 2);
  for (let e = 0; e < m * 2; e++) parent[e] = e;
  const root = (e: number): number => { while (parent[e] !== e) { parent[e] = parent[parent[e]!]!; e = parent[e]!; } return e; };
  const key = (x: number, y: number) => x * 4194304 + y;
  const seen = new Map<number, number>();
  for (let e = 0; e < m * 2; e++) {
    const x = qx[e]!, y = qy[e]!;
    const same = seen.get(key(x, y));
    if (same !== undefined && Math.abs(x) < 2 ** 30 && qx[same] === x && qy[same] === y) { parent[e] = root(same); continue; }
    for (let dx = -JOIN; dx <= JOIN; dx++) {
      for (let dy = -JOIN; dy <= JOIN; dy++) {
        const other = seen.get(key(x + dx, y + dy));
        if (other !== undefined) { const a = root(other), b = root(e); if (a !== b) parent[a] = b; }
      }
    }
    if (same === undefined) seen.set(key(x, y), e);
  }
  const links = new Int32Array(m);
  const starts = new Int32Array(2 * m);
  const keep = new Uint8Array(m);
  for (let i = 0; i < m; i++) {
    const p = list[i]!;
    // A piece shorter than the precision joins its neighbours at one vertex.
    if (root(2 * i) === root(2 * i + 1) && p.b - p.a < Math.PI) continue;
    keep[i] = 1; count++;
    const v = root(2 * i);
    links[i] = starts[v]!;
    starts[v] = i + 1;
  }
  for (let i = 0; i < m; i++) {
    if (!keep[i]) continue;
    const p0 = list[i]!;
    d += 'M' + at(p0, p0.dir > 0 ? p0.a : p0.b);
    const first = root(2 * i);
    let k = i;
    for (;;) {
      keep[k] = 0;
      const p = list[k]!;
      d += p.dir > 0 ? arcs(p, p.a, p.b) : arcs(p, p.b, p.a);
      const end = root(2 * k + 1);
      if (end === first) break;
      let next = starts[end]! - 1;
      while (next >= 0 && !keep[next]) next = links[next]! - 1;
      if (next >= 0) starts[end] = links[next]!;
      if (next < 0) { open++; break; }
      k = next;
    }
    d += 'Z';
    contours++;
  }
  return { d, arcs: count, contours, open };
}
