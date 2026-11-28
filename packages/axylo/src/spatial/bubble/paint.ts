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

/**
 * The shapes of a geometry as flat typed arrays: occupied annulus per bubble (inner < 0: a disc) and its band
 * circles from the centre out, each with the owner code of its inner and outer side (SELF: the bubble's series,
 * NONE: unpainted, BELOW: whatever lower shapes paint).
 */
interface Shapes {
  readonly outer: Float64Array;
  readonly inner: Float64Array;
  readonly start: Int32Array;
  readonly radius: Float64Array;
  readonly innerCode: Int8Array;
  readonly outerCode: Int8Array;
}

function shapesOf(g: BubbleGeometry): Shapes {
  const n = g.count;
  const outer = new Float64Array(n), inner = new Float64Array(n), start = new Int32Array(n + 1);
  let total = 0;
  for (let b = 0; b < n; b++) { start[b] = total; total += g.r[b] === 0 ? 4 : 2; }
  start[n] = total;
  const radius = new Float64Array(total), innerCode = new Int8Array(total), outerCode = new Int8Array(total);
  const a = ZERO_RADIUS - 0.5;
  for (let b = 0; b < n; b++) {
    const r = g.r[b]!, k = start[b]!;
    if (r !== 0) {
      outer[b] = r + GAP; inner[b] = -1;
      radius[k] = r; innerCode[k] = SELF; outerCode[k] = NONE;
      radius[k + 1] = r + GAP; innerCode[k + 1] = NONE; outerCode[k + 1] = BELOW;
    } else {
      outer[b] = a + 1 + GAP; inner[b] = a - GAP;
      radius[k] = a - GAP; innerCode[k] = BELOW; outerCode[k] = NONE;
      radius[k + 1] = a; innerCode[k + 1] = NONE; outerCode[k + 1] = SELF;
      radius[k + 2] = a + 1; innerCode[k + 2] = SELF; outerCode[k + 2] = NONE;
      radius[k + 3] = a + 1 + GAP; innerCode[k + 3] = NONE; outerCode[k + 3] = BELOW;
    }
  }
  return { outer, inner, start, radius, innerCode, outerCode };
}

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
  const { rank } = g;
  const gx = g.x, gy = g.y;
  const sh = shapesOf(g);
  // Exact duplicates paint the same shape: only the topmost (highest rank) can show, so the others are left out
  // of painting before any neighbour is enumerated (n coincident bubbles would otherwise cost n² pairs). Rows,
  // picking and the table keep every one of them; only the picture is shared.
  const paintedList = distinctShapes(g);
  const pn = paintedList.length;
  const concentric = pn > 2 ? concentricMap(g, sh, paintedList, S) : null;
  if (concentric) { maps.set(g, concentric); return concentric; }
  let pairs = 0;
  const { outer, inner, start: cStart, radius: cRadius, innerCode: cIn, outerCode: cOut } = sh;
  let reach = 0;
  for (let q = 0; q < pn; q++) if (outer[paintedList[q]!]! > reach) reach = outer[paintedList[q]!]!;
  // A uniform grid of centres.
  const cell = Math.max(4, reach / 2);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let q = 0; q < pn; q++) {
    const b = paintedList[q]!;
    const x = gx[b]!, y = gy[b]!;
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const cols = pn ? Math.floor((maxX - minX) / cell) + 1 : 1, rowsN = pn ? Math.floor((maxY - minY) / cell) + 1 : 1;
  const cellOf = (x: number, y: number) => Math.floor((y - minY) / cell) * cols + Math.floor((x - minX) / cell);
  const start = new Uint32Array(cols * rowsN + 1);
  for (let q = 0; q < pn; q++) { const b = paintedList[q]!; start[cellOf(gx[b]!, gy[b]!) + 1]!++; }
  for (let c = 0; c < cols * rowsN; c++) start[c + 1]! += start[c]!;
  const items = new Uint32Array(pn), fill = start.slice(0, cols * rowsN);
  for (let q = 0; q < pn; q++) { const b = paintedList[q]!; items[fill[cellOf(gx[b]!, gy[b]!)]!++] = b; }

  const pieces: Piece[][] = Array.from({ length: S }, () => []);
  const full: Piece[][] = Array.from({ length: S }, () => []);
  let cand = new Int32Array(256);
  let count = 0;
  let cuts = new Float64Array(64);
  const vis = new Arcs();
  let culled = 0, circles = 0;

  // The lower shapes that meet the circle being split, by rank from the top down.
  let lower = new Int32Array(256);
  let lowerCount = 0;
  /**
   * Painted owner at a point among the lower shapes of the circle: the first (highest) that contains it, its
   * band there, and below it again when that band is a hole. Dense data puts most of them over any point, so the
   * scan stops after a few.
   */
  const ownerAt = (px: number, py: number, b: number, outward: boolean): number => {
    const bx = gx[b]!, by = gy[b]!, reachB = outer[b]!;
    for (let k = lowerCount - 1; k >= 0; k--) {
      const j = g.order[lower[k]!]!;
      const dx = px - gx[j]!, dy = py - gy[j]!, d = Math.sqrt(dx * dx + dy * dy);
      // Sampling outward from b's outermost circle: a band edge of j that step 1 counts as covered by b (the
      // same expression on the same operands: centre distance plus edge radius within EPS of b's reach) lies on
      // this circle, so the sample is beyond it. Bands are nested, so the first edge not collapsed is the one.
      let first = cStart[j]!;
      if (outward) {
        const ex = gx[j]! - bx, ey = gy[j]! - by, dbj = Math.sqrt(ex * ex + ey * ey);
        while (first < cStart[j + 1]! && dbj + cRadius[first]! <= reachB + EPS) first++;
        if (first === cStart[j + 1]!) continue;
      }
      // Otherwise exact containment, the same strict comparisons as the band lookup below: a tolerance here
      // would skip a lower shape whose boundary coincides with this circle (a zero ring's inner edge on a disc's
      // gap edge) and read the shape beneath it instead.
      if (!(d < outer[j]! && d > inner[j]!)) continue;
      let code: number = NONE;
      for (let c = first; c < cStart[j + 1]!; c++) if (d < cRadius[c]!) { code = cIn[c]!; break; }
      if (code === SELF) return g.series[j]!;
      if (code !== BELOW) return NONE;
    }
    return NONE;
  };

  for (let q = 0; q < pn; q++) {
    const b = paintedList[q]!;
    const cx = gx[b]!, cy = gy[b]!, rb = rank[b]!, s = g.series[b]!;
    const own = outer[b]!;
    const span = own + reach;
    const c0 = Math.max(0, Math.floor((cx - span - minX) / cell)), c1 = Math.min(cols - 1, Math.floor((cx + span - minX) / cell));
    const r0 = Math.max(0, Math.floor((cy - span - minY) / cell)), r1 = Math.min(rowsN - 1, Math.floor((cy + span - minY) / cell));
    count = 0;
    for (let ry = r0; ry <= r1; ry++) {
      for (let rx = c0; rx <= c1; rx++) {
        const c = ry * cols + rx;
        for (let k = start[c]!, end = start[c + 1]!; k < end; k++) {
          const j = items[k]!;
          if (j === b) continue;
          pairs++;
          const dx = gx[j]! - cx, dy = gy[j]! - cy, reachJ = own + outer[j]!;
          if (dx * dx + dy * dy >= reachJ * reachJ) continue;
          if (count === cand.length) { const grown = new Int32Array(count * 2); grown.set(cand); cand = grown; }
          cand[count++] = j;
        }
      }
    }
    for (let ci = cStart[b]!; ci < cStart[b + 1]!; ci++) {
      const rho = cRadius[ci]!;
      if (rho <= 0) continue;
      circles++;
      const innerOwner = cIn[ci] === SELF ? s : cIn[ci]!;
      const outerOwner = cOut[ci] === SELF ? s : cOut[ci]!;
      // 1. Remove what higher shapes cover, until nothing is left.
      vis.reset();
      // Visited in a scattered order (a stride coprime with the count), so shapes all around the circle come
      // early and a covered circle, the common case when bubbles are dense, is known covered after few.
      const stride = strideFor(count);
      for (let i = 0, k = 0; i < count && vis.length; i++, k = k + stride >= count ? k + stride - count : k + stride) {
        const j = cand[k]!;
        if (rank[j]! < rb) continue;
        const dx = gx[j]! - cx, dy = gy[j]! - cy, d = Math.sqrt(dx * dx + dy * dy);
        const R = outer[j]!, h = inner[j]!;
        // The hole of an annulus meets the circle only when it crosses it.
        const holeCrosses = h > 0 && !(d + rho <= h - EPS) && !(d >= rho + h + EPS) && !(d + h <= rho - EPS);
        if (d + rho <= R + EPS) {
          if (h <= 0) { vis.length = 0; break; }
          if (d + rho <= h - EPS) continue;
          if (!holeCrosses) { vis.length = 0; break; }
          const ch = (rho * rho + d * d - h * h) / (2 * rho * d);
          vis.cutAround(Math.atan2(dy, dx) + Math.PI, Math.PI - Math.acos(ch < -1 ? -1 : ch > 1 ? 1 : ch));
          continue;
        }
        if (d >= rho + R - EPS || d + R <= rho + EPS) continue;
        const co = (rho * rho + d * d - R * R) / (2 * rho * d);
        const om = Math.atan2(dy, dx), oh = Math.acos(co < -1 ? -1 : co > 1 ? 1 : co);
        if (!holeCrosses) { vis.cutAround(om, oh); continue; }
        const ch = (rho * rho + d * d - h * h) / (2 * rho * d);
        const hh = Math.acos(ch < -1 ? -1 : ch > 1 ? 1 : ch);
        // Concentric bands: the hole's interval is centred on the same direction, inside the outer one.
        vis.cutAround(om - (oh + hh) / 2, (oh - hh) / 2);
        vis.cutAround(om + (oh + hh) / 2, (oh - hh) / 2);
      }
      if (!vis.length) { culled++; continue; }
      const visible = Array.from(vis.list.subarray(0, vis.length));
      const needsBelow = innerOwner === BELOW || outerOwner === BELOW;
      if (!needsBelow) {
        if (innerOwner !== outerOwner) emitIntervals(visible, cx, cy, rho, innerOwner, outerOwner, pieces, full);
        continue;
      }
      // 2. Split the visible angles where lower circles cross or touch, and find the lower owner of each piece.
      const offset = rho + (innerOwner === BELOW ? -OFF : OFF);
      lowerCount = 0;
      for (let k = 0; k < count; k++) {
        const j = cand[k]!;
        if (rank[j]! > rb) continue;
        const dx = gx[j]! - cx, dy = gy[j]! - cy, d = Math.sqrt(dx * dx + dy * dy);
        // Shapes that cannot reach the circle, or lie inside it without touching, own no point of it.
        if (d > rho + outer[j]! + TOUCH || d + outer[j]! < rho - TOUCH) continue;
        if (lowerCount === lower.length) { const grown = new Int32Array(lowerCount * 2); grown.set(lower); lower = grown; }
        lower[lowerCount++] = rank[j]!;
      }
      lower.subarray(0, lowerCount).sort();
      for (let v = 0; v < visible.length; v += 2) {
        const a0 = visible[v]!, a1 = visible[v + 1]!;
        let m = 0;
        const push = (t: number) => {
          if (m === cuts.length) { const grown = new Float64Array(m * 2); grown.set(cuts); cuts = grown; }
          cuts[m++] = t;
        };
        push(a0); push(a1);
        for (let k = 0; k < lowerCount; k++) {
          const j = g.order[lower[k]!]!;
          const dx = gx[j]! - cx, dy = gy[j]! - cy, d = Math.sqrt(dx * dx + dy * dy);
          if (d < TOUCH) continue;
          const toward = Math.atan2(dy, dx);
          for (let c = cStart[j]!; c < cStart[j + 1]!; c++) {
            const R = cRadius[c]!;
            if (R <= 0 || d > rho + R + TOUCH || d < Math.abs(rho - R) - TOUCH) continue;
            let t0: number, t1 = NaN;
            if (Math.abs(d - (rho + R)) <= TOUCH) t0 = toward;
            else if (Math.abs(d - Math.abs(rho - R)) <= TOUCH) t0 = rho > R ? toward : toward + Math.PI;
            else {
              const co = (rho * rho + d * d - R * R) / (2 * rho * d);
              const half = Math.acos(co < -1 ? -1 : co > 1 ? 1 : co);
              t0 = toward - half; t1 = toward + half;
            }
            for (let q = 0; q < 2; q++) {
              const raw = q === 0 ? t0 : t1;
              if (Number.isNaN(raw)) continue;
              const t = norm(raw);
              if (t > a0 && t < a1) push(t);
              else if (t + TAU > a0 && t + TAU < a1) push(t + TAU);
            }
          }
        }
        const sorted = cuts.subarray(0, m).sort();
        let runStart = sorted[0]!, runOwner = Number.NaN;
        const flush = (end: number) => {
          if (Number.isNaN(runOwner) || end <= runStart) return;
          const i = innerOwner === BELOW ? runOwner : innerOwner, o = outerOwner === BELOW ? runOwner : outerOwner;
          if (i !== o) emitIntervals([runStart, end], cx, cy, rho, i, o, pieces, full);
        };
        for (let k = 0; k + 1 < m; k++) {
          const p = sorted[k]!, q = sorted[k + 1]!;
          if (q - p <= 1e-12) continue;
          const mid = (p + q) / 2;
          const owner = ownerAt(cx + offset * Math.cos(mid), cy + offset * Math.sin(mid), b, outerOwner === BELOW);
          if (owner !== runOwner) { flush(p); runStart = p; runOwner = owner; }
        }
        flush(sorted[m - 1]!);
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
 * with a max-heap of active shapes by rank (lazy removal) finds it in O(n log n); a full circle is emitted at
 * every edge where the owner changes. Null when the shapes do not share a centre exactly: the general step runs.
 * Measured limit (ledger): the fast path does not apply once any other point shares the plot.
 */
function concentricMap(g: BubbleGeometry, sh: Shapes, list: Uint32Array, S: number): PaintedMap | null {
  const n = list.length, cx = g.x[list[0]!]!, cy = g.y[list[0]!]!;
  for (let q = 1; q < n; q++) if (g.x[list[q]!] !== cx || g.y[list[q]!] !== cy) return null;
  const { outer, inner } = sh;
  const shapeRank = g.rank;
  // Shapes by the radius where they start covering (0 for a disc) and every edge radius, ascending.
  const byStart = Uint32Array.from(list).sort((a, b) => Math.max(0, inner[a]!) - Math.max(0, inner[b]!));
  let edgeCount = 0;
  for (let q = 0; q < n; q++) edgeCount += sh.start[list[q]! + 1]! - sh.start[list[q]!]!;
  const edges = new Float64Array(edgeCount);
  edgeCount = 0;
  for (let q = 0; q < n; q++) for (let c = sh.start[list[q]!]!; c < sh.start[list[q]! + 1]!; c++) edges[edgeCount++] = sh.radius[c]!;
  edges.sort();
  // Max-heap of shapes by rank.
  const heap = new Uint32Array(n);
  let size = 0;
  const up = (i: number) => {
    const v = heap[i]!;
    while (i > 0) { const p = (i - 1) >> 1; if (shapeRank[heap[p]!]! >= shapeRank[v]!) break; heap[i] = heap[p]!; i = p; }
    heap[i] = v;
  };
  const down = (i: number) => {
    const v = heap[i]!;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= size) break;
      if (c + 1 < size && shapeRank[heap[c + 1]!]! > shapeRank[heap[c]!]!) c++;
      if (shapeRank[heap[c]!]! <= shapeRank[v]!) break;
      heap[i] = heap[c]!; i = c;
    }
    heap[i] = v;
  };
  const pieces: Piece[][] = Array.from({ length: S }, () => []);
  const full: Piece[][] = Array.from({ length: S }, () => []);
  let next = 0, before = NONE, at = 0, circles = 0;
  for (let e = 0; e <= edges.length; e++) {
    const hi = e < edges.length ? edges[e]! : Infinity;
    if (!(hi > at)) continue;
    const mid = hi === Infinity ? at + 1 : (at + hi) / 2;
    while (next < n && Math.max(0, inner[byStart[next]!]!) <= at) { heap[size++] = byStart[next++]!; up(size - 1); }
    while (size && !(outer[heap[0]!]! > mid)) { heap[0] = heap[--size]!; if (size) down(0); }
    // The top shape covers mid unless mid is in its hole (inner > mid: not yet started, never in the heap).
    let owner: number = NONE;
    if (size) {
      const top = heap[0]!;
      for (let c = sh.start[top]!; c < sh.start[top + 1]!; c++) {
        if (mid < sh.radius[c]!) { owner = sh.innerCode[c] === SELF ? g.series[top]! : NONE; break; }
      }
    }
    if (owner !== before && at > 0) {
      circles++;
      emitIntervals([0, TAU], cx, cy, at, before, owner, pieces, full);
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
  const kept = new Uint32Array(n);
  let m = 0;
  for (let i = 0; i < n; i++) {
    const b = byShape[i]!;
    if (m > 0) {
      const p = kept[m - 1]!;
      if (x[p] === x[b] && y[p] === y[b] && r[p] === r[b]) continue;
    }
    kept[m++] = b;
  }
  return kept.subarray(0, m);
}

/** Adds visible angle pairs as pieces: increasing for the inner owner, decreasing for the outer owner. */
function emitIntervals(pairs: number[], cx: number, cy: number, rho: number, inner: number, outer: number, pieces: Piece[][], full: Piece[][]): void {
  // A visible run that wraps past 2π is one piece: [x, 2π] followed by [0, y] join at angle 0.
  let list = pairs;
  if (pairs.length >= 4 && pairs[0] === 0 && pairs[pairs.length - 1] === TAU) {
    list = pairs.slice(2, -1);
    list.push(pairs[1]! + TAU);
  }
  for (let i = 0; i < list.length; i += 2) {
    const a = list[i]!, b = list[i + 1]!;
    const whole = b - a >= TAU - 1e-12;
    for (const [owner, dir] of [[inner, 1], [outer, -1]] as const) {
      if (owner < 0) continue;
      (whole ? full : pieces)[owner]!.push({ cx, cy, rho, a, b, dir });
    }
  }
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
    for (let dx = -JOIN; dx <= JOIN; dx++) {
      for (let dy = -JOIN; dy <= JOIN; dy++) {
        const other = seen.get(key(x + dx, y + dy));
        if (other !== undefined) { const a = root(other), b = root(e); if (a !== b) parent[a] = b; }
      }
    }
    if (!seen.has(key(x, y))) seen.set(key(x, y), e);
  }
  const starts = new Map<number, number[]>();
  const keep = new Uint8Array(m);
  for (let i = 0; i < m; i++) {
    const p = list[i]!;
    // A piece shorter than the precision joins its neighbours at one vertex.
    if (root(2 * i) === root(2 * i + 1) && p.b - p.a < Math.PI) continue;
    keep[i] = 1; count++;
    const v = root(2 * i);
    let bucket = starts.get(v);
    if (!bucket) starts.set(v, bucket = []);
    bucket.push(i);
  }
  const used = new Uint8Array(m);
  const nextAt = (v: number): number => {
    const bucket = starts.get(v);
    while (bucket && bucket.length) {
      const c = bucket.pop()!;
      if (!used[c]) return c;
    }
    return -1;
  };
  for (let i = 0; i < m; i++) {
    if (!keep[i] || used[i]) continue;
    const p0 = list[i]!;
    d += 'M' + at(p0, p0.dir > 0 ? p0.a : p0.b);
    const first = root(2 * i);
    let k = i;
    for (;;) {
      used[k] = 1;
      const p = list[k]!;
      d += p.dir > 0 ? arcs(p, p.a, p.b) : arcs(p, p.b, p.a);
      const end = root(2 * k + 1);
      if (end === first) break;
      const next = nextAt(end);
      if (next < 0) { open++; break; }
      k = next;
    }
    d += 'Z';
    contours++;
  }
  return { d, arcs: count, contours, open };
}
