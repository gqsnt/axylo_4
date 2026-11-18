import type { ScatterView } from '../core/contracts';
import { contains, pointerOnPlot, scatterPosition, type PlotLayout } from './geometry';

// Squares written out, so the module does no work at import time.
const CELL = 24;
const RADIUS2 = 576; // CELL²
const COINCIDENT = 0.5;
const COINCIDENT2 = 0.25; // COINCIDENT²
const LEAF_SIZE = 32;
export const POINT_LIMIT = 8;

interface Bucket {
  readonly start: number;
  readonly end: number;
  readonly count: number;
  readonly latest: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly left?: Bucket;
  readonly right?: Bucket;
}

function distanceTo(bucket: Bucket, x: number, y: number): number {
  return Math.max(bucket.minX - x, x - bucket.maxX, 0) ** 2
    + Math.max(bucket.minY - y, y - bucket.maxY, 0) ** 2;
}

function distanceAcross(bucket: Bucket, x: number, y: number): number {
  return Math.max(Math.abs(bucket.minX - x), Math.abs(bucket.maxX - x)) ** 2
    + Math.max(Math.abs(bucket.minY - y), Math.abs(bucket.maxY - y)) ** 2;
}

export interface ScatterPick {
  /** Point indexes (into `series` and `points`), the picked one first, at most POINT_LIMIT. */
  readonly hits: readonly number[];
  readonly count: number;
}

/** Which index answered: exact positions or the device-pixel lattice (`PickTarget.rule`). */
export type GroupRule = 'exact' | 'lattice';

export interface GridOptions {
  /**
   * Distance checks an exact pick may make before it is redone on the device-pixel lattice. Defaults to the
   * number of lattice points in the pick square, (ceil(49 × ratio) + 1)². Tests pass 0 to force the lattice.
   */
  readonly exactBudget?: number;
}

/** Thrown inside an exact pick that ran out of budget; never escapes `pick`. */
const OVER_BUDGET = Symbol('over budget');

/**
 * The pointer index of a scatter view (contract: `Lookup.pick`).
 *
 * A pick first compares exact positions. When the points near the pointer make that expensive (all of them
 * at nearly the same distance, as on a ring around the pointer, or a dense cluster), the pick is redone on a
 * second index where every point is rounded to the device-pixel lattice and the points of one lattice point
 * are merged, keeping their count and their latest source row. A lattice pick examines at most the occupied
 * lattice points near the pointer, so its cost depends on the radius and the pixel ratio, not on the number
 * of points; a rounded position is off by at most 0.71 device px, and the datum's values stay exact.
 */
export function scatterGrid(
  view: ScatterView, layout: PlotLayout & { projection: Extract<PlotLayout['projection'], { kind: 'xy' }> },
  count: number, devicePixelRatio: number, options: GridOptions = {},
) {
  const { plot, projection } = layout;
  const columns = Math.floor(plot.width / CELL) + 1;
  const rows = Math.floor(plot.height / CELL) + 1;
  const series = new Uint32Array(count);
  const points = new Uint32Array(count);
  // Grid index of point i of series s at atOf[first[s] + i], -1 when it is not on the plot.
  const first = new Int32Array(view.frame.series.length + 1);
  view.frame.series.forEach((data, s) => { first[s + 1] = first[s]! + data.x.length; });
  const atOf = new Int32Array(first[view.frame.series.length]!).fill(-1);
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const tieDistance = 0.5 / ratio;
  const budget = options.exactBudget ?? (Math.ceil(49 * ratio) + 1) ** 2;
  let length = 0;
  let examined = 0;
  let cellsExamined = 0;
  let usedLattice = false;
  let membersRead = 0;

  function cellIndex(pixel: number, origin: number, size: number): number {
    // Subtracting the origin from a rounded plot edge can place that edge one cell past the grid.
    return Math.max(0, Math.min(size - 1, Math.floor((pixel - origin) / CELL)));
  }

  const column = (x: number) => cellIndex(x, plot.x, columns);
  const row = (y: number) => cellIndex(y, plot.y, rows);

  function sourceRow(at: number): number {
    const i = points[at]!;
    return view.frame.series[series[at]!]!.row?.[i] ?? i;
  }

  view.frame.series.forEach((data, s) => {
    if (!view.visible[s] || !data.drawable) return;
    const { start, end } = view.visiblePoints[s]!;
    for (let i = start; i < end; i++) {
      const x = scatterPosition(projection.x, data.x[i]!);
      const y = scatterPosition(projection.y, data.y[i]!);
      // Exact positions decide what is in the plot, on both indexes.
      if (!contains(plot, x, y)) continue;
      const at = length++;
      xs[at] = x;
      ys[at] = y;
      series[at] = s;
      points[at] = i;
      atOf[first[s]! + i] = at;
    }
  });

  /** The most points in any 4 × 4 block of cells. */
  function densestWindow(): number {
    const counts = new Int32Array((columns + 1) * (rows + 1));
    // Summed-area table, one row and column of zeros in front.
    for (let at = 0; at < length; at++) counts[(row(ys[at]!) + 1) * (columns + 1) + column(xs[at]!) + 1]!++;
    for (let r = 1; r <= rows; r++) {
      for (let c = 1; c <= columns; c++) {
        const i = r * (columns + 1) + c;
        counts[i] = counts[i]! + counts[i - 1]! + counts[i - columns - 1]! - counts[i - columns - 2]!;
      }
    }
    let densest = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < columns; c++) {
        const r1 = Math.min(rows, r + 4);
        const c1 = Math.min(columns, c + 4);
        const sum = counts[r1 * (columns + 1) + c1]! - counts[r * (columns + 1) + c1]! - counts[r1 * (columns + 1) + c]! + counts[r * (columns + 1) + c]!;
        densest = Math.max(densest, sum);
      }
    }
    return densest;
  }

  interface Index {
    pick(x: number, y: number, limit: number): ScatterPick | null;
    /** The group of point `at`: it first, then the rest of its position, then the others within 0.5 px. */
    members(at: number, from: number, take: number): number[];
    has(at: number, other: number): boolean;
  }

  function index(px: Float64Array, py: Float64Array): Index {
    const cellFor = (x: number, y: number) => column(x) + columns * row(y);
    const heads = new Map<number, number>();
    const next = new Int32Array(length);
    for (let at = 0; at < length; at++) {
      const cell = cellFor(px[at]!, py[at]!);
      next[at] = heads.get(cell) ?? -1;
      heads.set(cell, at);
    }

    function later(at: number, other: number): boolean {
      const difference = sourceRow(at) - sourceRow(other);
      if (difference !== 0) return difference > 0;
      const cellDifference = cellFor(px[at]!, py[at]!) - cellFor(px[other]!, py[other]!);
      return cellDifference < 0 || cellDifference === 0 && at > other;
    }

    const order = new Uint32Array(length);
    const multiplicity = new Uint32Array(length);
    // The representative of each point's position, and where each representative sits in `order`.
    const repOf = new Int32Array(length);
    const placed = new Int32Array(length);
    const buckets = new Map<number, Bucket>();
    function build(start: number, end: number, allowSkew = true): Bucket {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      let count = 0;
      for (let i = start; i < end; i++) {
        const p = order[i]!;
        minX = Math.min(minX, px[p]!);
        maxX = Math.max(maxX, px[p]!);
        minY = Math.min(minY, py[p]!);
        maxY = Math.max(maxY, py[p]!);
        count += multiplicity[p]!;
      }
      const bounds = { start, end, count, minX, maxX, minY, maxY };
      if (end - start <= LEAF_SIZE) {
        let latest = order[start]!;
        for (let i = start + 1; i < end; i++) {
          const at = order[i]!;
          if (later(at, latest)) latest = at;
        }
        return { ...bounds, latest };
      }

      const byX = maxX - minX >= maxY - minY;
      const positions = byX ? px : py;
      const pivot = byX ? minX / 2 + maxX / 2 : minY / 2 + maxY / 2;
      let mid = start;
      for (let i = start; i < end; i++) {
        const p = order[i]!;
        if (positions[p]! >= pivot) continue;
        order[i] = order[mid]!;
        order[mid++] = p;
      }
      const smaller = Math.min(mid - start, end - mid);
      const skewed = smaller < (end - start) / 8;
      // Keep spatially separated groups together. Consecutive skewed splits need a median to bound depth.
      const useSkew = skewed && allowSkew && smaller > 0;
      if (skewed && !useSkew) {
        order.subarray(start, end).sort((a, b) => positions[a]! - positions[b]!);
        mid = start + Math.floor((end - start) / 2);
      }
      const left = build(start, mid, !useSkew);
      const right = build(mid, end, !useSkew);
      return { ...bounds, left, right, latest: later(left.latest, right.latest) ? left.latest : right.latest };
    }

    let end = 0;
    for (const [cell, head] of heads) {
      const start = end;
      let uniform = true;
      for (let at = head; at >= 0; at = next[at]!) {
        order[end++] = at;
        uniform &&= px[at] === px[head] && py[at] === py[head];
      }
      if (!uniform) order.subarray(start, end).sort((a, b) => px[a]! - px[b]! || py[a]! - py[b]!);

      // Group identical positions before splitting the cell, so a median cannot spread them across leaves.
      // Keep the latest row as the representative and link the others for the capped tooltip.
      let write = start;
      for (let i = start; i < end;) {
        const first = order[i]!;
        const groupStart = i++;
        let last = first;
        let winner = first;
        let beforeWinner = -1;
        for (; i < end; i++) {
          const at = order[i]!;
          if (px[at] !== px[first] || py[at] !== py[first]) break;
          next[last] = at;
          if (later(at, winner)) {
            winner = at;
            beforeWinner = last;
          }
          last = at;
        }
        next[last] = -1;
        if (beforeWinner >= 0) {
          next[beforeWinner] = next[winner]!;
          next[winner] = first;
        }
        multiplicity[winner] = i - groupStart;
        for (let at = winner; at >= 0; at = next[at]!) repOf[at] = winner;
        order[write++] = winner;
      }
      end = write;
      buckets.set(cell, build(start, end));
    }
    // After the trees have arranged `order`: a bucket holds a representative iff its range holds its place.
    for (let i = 0; i < end; i++) placed[order[i]!] = i;

    function pick(x: number, y: number, limit: number): ScatterPick | null {
      // The window covers every compared position within the radius, and every 0.5 px neighbourhood of one.
      const radius = CELL + COINCIDENT;
      const left = column(x - radius);
      const right = column(x + radius);
      const top = row(y - radius);
      const bottom = row(y + radius);
      const nearby: Bucket[] = [];
      for (let cy = top; cy <= bottom; cy++) {
        for (let cx = left; cx <= right; cx++) {
          cellsExamined++;
          const bucket = buckets.get(cx + cy * columns);
          if (bucket) nearby.push(bucket);
        }
      }
      const visit = () => {
        if (++examined > limit) throw OVER_BUDGET;
      };

      let nearest = -1;
      let best = RADIUS2;
      function consider(at: number): void {
        visit();
        const distance = (px[at]! - x) ** 2 + (py[at]! - y) ** 2;
        if (distance < best || distance === best && (nearest < 0 || later(at, nearest))) {
          nearest = at;
          best = distance;
        }
      }
      function search(bucket: Bucket, distance: number): void {
        if (distance > best) return;
        if (bucket.left && bucket.right) {
          const left = distanceTo(bucket.left, x, y);
          const right = distanceTo(bucket.right, x, y);
          if (left <= right) {
            search(bucket.left, left);
            search(bucket.right, right);
          } else {
            search(bucket.right, right);
            search(bucket.left, left);
          }
        } else {
          for (let i = bucket.start; i < bucket.end; i++) consider(order[i]!);
        }
      }

      nearby.sort((a, b) => distanceTo(a, x, y) - distanceTo(b, x, y));
      for (const bucket of nearby) search(bucket, distanceTo(bucket, x, y));
      if (nearest < 0) return null;

      // Measuring from the closest point keeps a chain of near ties from extending the tie window.
      const closest = Math.sqrt(best);
      function inTie(distance: number): boolean {
        return distance <= RADIUS2 && Math.sqrt(distance) - closest < tieDistance;
      }
      function searchTies(bucket: Bucket): void {
        if (!later(bucket.latest, nearest) || !inTie(distanceTo(bucket, x, y))) return;
        if (inTie(distanceAcross(bucket, x, y))) {
          nearest = bucket.latest;
        } else if (bucket.left && bucket.right) {
          searchTies(bucket.left);
          searchTies(bucket.right);
        } else {
          for (let i = bucket.start; i < bucket.end; i++) {
            const at = order[i]!;
            if (!later(at, nearest)) continue;
            visit();
            if (inTie((px[at]! - x) ** 2 + (py[at]! - y) ** 2)) nearest = at;
          }
        }
      }
      for (const bucket of nearby) searchTies(bucket);

      return { hits: members(nearest, 0, POINT_LIMIT), count: groupSize(nearest, visit) };
    }

    const near = (at: number, cx: number, cy: number) => (px[at]! - cx) ** 2 + (py[at]! - cy) ** 2 <= COINCIDENT2;

    /** The cells' trees that can hold a position within 0.5 px of (cx, cy), in cell order. */
    function around(cx: number, cy: number): Bucket[] {
      const found: Bucket[] = [];
      for (let r = row(cy - COINCIDENT); r <= row(cy + COINCIDENT); r++) {
        for (let c = column(cx - COINCIDENT); c <= column(cx + COINCIDENT); c++) {
          const bucket = buckets.get(c + r * columns);
          if (bucket) found.push(bucket);
        }
      }
      return found;
    }

    // Members of a group, counted from a representative's whole position at a time where possible.
    function groupSize(at: number, visit: () => void = () => {}): number {
      const own = repOf[at]!;
      const cx = px[at]!;
      const cy = py[at]!;
      let size = multiplicity[own]!;
      function add(bucket: Bucket): void {
        if (distanceTo(bucket, cx, cy) > COINCIDENT2) return;
        const inside = placed[own]! >= bucket.start && placed[own]! < bucket.end;
        if (distanceAcross(bucket, cx, cy) <= COINCIDENT2) size += bucket.count - (inside ? multiplicity[own]! : 0);
        else if (bucket.left && bucket.right) {
          add(bucket.left);
          add(bucket.right);
        } else {
          for (let i = bucket.start; i < bucket.end; i++) {
            const entry = order[i]!;
            visit();
            if (entry !== own && near(entry, cx, cy)) size += multiplicity[entry]!;
          }
        }
      }
      for (const bucket of around(cx, cy)) add(bucket);
      return size;
    }

    function members(at: number, from: number, take: number): number[] {
      const out: number[] = [];
      if (take <= 0) return out;
      const own = repOf[at]!;
      const cx = px[at]!;
      const cy = py[at]!;
      let skip = from;
      const emit = (member: number): boolean => {
        membersRead++;
        if (skip > 0) skip--;
        else out.push(member);
        return out.length < take;
      };
      function position(entry: number, first = -1): boolean {
        if (skip >= multiplicity[entry]!) {
          skip -= multiplicity[entry]!;
          return true;
        }
        if (first >= 0 && !emit(first)) return false;
        for (let member = entry; member >= 0; member = next[member]!) if (member !== first && !emit(member)) return false;
        return true;
      }
      if (!position(own, at)) return out;
      function walk(bucket: Bucket): boolean {
        if (distanceTo(bucket, cx, cy) > COINCIDENT2) return true;
        if (distanceAcross(bucket, cx, cy) <= COINCIDENT2) {
          const inside = placed[own]! >= bucket.start && placed[own]! < bucket.end;
          const size = bucket.count - (inside ? multiplicity[own]! : 0);
          if (skip >= size) {
            skip -= size;
            return true;
          }
        }
        if (bucket.left && bucket.right) return walk(bucket.left) && walk(bucket.right);
        for (let i = bucket.start; i < bucket.end; i++) {
          const entry = order[i]!;
          membersRead++;
          if (entry !== own && near(entry, cx, cy) && !position(entry)) return false;
        }
        return true;
      }
      for (const bucket of around(cx, cy)) if (!walk(bucket)) break;
      return out;
    }

    return { pick, members, has: (at, other) => near(other, px[at]!, py[at]!) };
  }

  const exact = budget > 0 ? index(xs, ys) : null;
  // An exact pick checks each point of the cells it searches at most three times (nearest, ties, coincidence)
  // and samples at most POINT_LIMIT rows; it searches at most 4 × 4 cells (a 49 px window over 24 px cells).
  // When no such window holds more than the budget allows, no pick can fall back. Otherwise the lattice index
  // is built here, with the lookup, so that no pointer move does work in proportion to the data.
  const canFallBack = !exact || 3 * densestWindow() + 2 * POINT_LIMIT > budget;
  function latticeIndex(): Index {
    const lx = new Float64Array(length);
    const ly = new Float64Array(length);
    for (let at = 0; at < length; at++) {
      lx[at] = Math.round(xs[at]! * ratio) / ratio;
      ly[at] = Math.round(ys[at]! * ratio) / ratio;
    }
    return index(lx, ly);
  }
  let lattice: Index | null = canFallBack ? latticeIndex() : null;
  // Built with the lookup whenever a pick can need it; built later only if that bound were ever wrong.
  const indexFor = (rule: GroupRule): Index => (rule === 'exact' && exact) || (lattice ??= latticeIndex());

  const grid = {
    series, points,
    /** Whether the last pick was answered on the device-pixel lattice. */
    get usedLattice() { return usedLattice; },
    pick(pointerX: number, pointerY: number): ScatterPick | null {
      examined = 0;
      cellsExamined = 0;
      usedLattice = false;
      const at = pointerOnPlot(plot, pointerX, pointerY);
      if (!at) return null;
      const { x, y } = at;
      if (exact) {
        try {
          return exact.pick(x, y, budget);
        } catch (error) {
          if (error !== OVER_BUDGET) throw error;
        }
      }
      usedLattice = true;
      return indexFor('lattice').pick(x, y, Infinity);
    },
    /** The grid index of point i of series s, or -1 when it is not on the plot. */
    at(s: number, i: number): number {
      return i >= 0 && s >= 0 && s < view.frame.series.length && i < first[s + 1]! - first[s]! ? atOf[first[s]! + i]! : -1;
    },
    members(rule: GroupRule, at: number, from: number, take: number): number[] {
      membersRead = 0;
      return indexFor(rule).members(at, from, take);
    },
    has(rule: GroupRule, at: number, other: number): boolean {
      return indexFor(rule).has(at, other);
    },
  };
  // Work counters, for tests (development and benchmark builds): distance checks and rows sampled by the last
  // pick on both indexes, the cells it opened, and the entries the last `members` call read.
  if (__DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__)) {
    Object.defineProperties(grid, {
      examined: { get: () => examined }, cellsExamined: { get: () => cellsExamined }, membersRead: { get: () => membersRead },
    });
  }
  return grid as typeof grid & { readonly examined: number; readonly cellsExamined: number; readonly membersRead: number };
}
