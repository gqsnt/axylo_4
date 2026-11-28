import type { IndexRange, ScatterView } from '../core/contracts';
import { scatterProject } from '../scene/lines';
import { pointerOnPlot, scatterPosition, type PlotLayout } from './geometry';

// Squares written out, so the module does no work at import time.
const CELL = 24;
const RADIUS2 = 576; // CELL²
const COINCIDENT = 0.5;
const COINCIDENT2 = 0.25; // COINCIDENT²
const LEAF_SIZE = 32;
// Larger columns and cells are prepared up front so opening a new region has a fixed upper bound.
const COLUMN_LIMIT = 32_768;
const CELL_LIMIT = 4096;
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
  left?: Bucket;
  skew?: boolean;
  right?: Bucket;
}

function distanceTo(bucket: Bucket, x: number, y: number): number {
  return Math.max(bucket.minX - x, x - bucket.maxX, 0) ** 2
    + Math.max(bucket.minY - y, y - bucket.maxY, 0) ** 2;
}

function distanceAcross(bucket: Bucket, x: number, y: number): number {
  return Math.max(x - bucket.minX, bucket.maxX - x) ** 2
    + Math.max(y - bucket.minY, bucket.maxY - y) ** 2;
}

export interface ScatterPick {
  /** Point indexes (into `series` and `points`), the picked one first, at most POINT_LIMIT. */
  readonly hits: readonly number[];
  readonly count: number;
}

/** Which index answered: exact positions or the device-pixel lattice (`PickTarget.rule`). */
export type GroupRule = 'exact' | 'lattice';

export interface GridOptions {
  /** Build the lookup's grid on its first spatial query. */
  readonly lazy?: boolean;
  /**
   * Distance checks an exact pick may make before it is redone on the device-pixel lattice. Defaults to the
   * number of lattice points in the pick square, (ceil(49 × ratio) + 1)². Tests pass 0 to force the lattice.
   */
  readonly exactBudget?: number;
}

/** Thrown inside an exact pick that ran out of budget; never escapes `pick`. */
const OVER_BUDGET = {};

const NO_POINTS: IndexRange = { start: 0, end: 0 };

export function scatterRanges(view: ScatterView): readonly IndexRange[] {
  return view.frame.series.map((entry, s) => view.visible[s] && entry.drawable ? view.visiblePoints[s]! : NO_POINTS);
}

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
  count: number, devicePixelRatio: number, options: GridOptions = {}, shown = scatterRanges(view),
) {
  const { plot, projection } = layout;
  const columns = Math.floor(plot.width / CELL) + 1;
  const rows = Math.floor(plot.height / CELL) + 1;
  const dataSeries = view.frame.series;
  const series = new Uint32Array(count);
  const points = new Uint32Array(count);
  // Grid index of point i of series s at atOf[first[s] + i - start of its range], -1 when it is not on the
  // plot: sized to the points in view, so a narrow view of a large frame indexes only what it shows.
  const first = new Int32Array(shown.length + 1);
  shown.forEach(({ start, end }, s) => { first[s + 1] = first[s]! + end - start; });
  const atOf = new Int32Array(count);
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const tieDistance = 0.5 / ratio;
  const budget = options.exactBudget ?? (Math.ceil(49 * ratio) + 1) ** 2;
  let length = 0;
  const trackWork = __DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__);
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

  const sourceRows = new Float64Array(count);
  let strictX = true, single = true;
  const mapX = scatterProject(projection.x, scatterPosition), mapY = scatterProject(projection.y, scatterPosition);
  const right = plot.x + plot.width, bottom = plot.y + plot.height;
  for (let s = 0; s < dataSeries.length; s++) {
    const data = dataSeries[s]!;
    const { start, end } = shown[s]!;
    const { x: valuesX, y: valuesY, row: source } = data;
    const offset = first[s]! - start;
    for (let i = start; i < end; i++) {
      const x = mapX(valuesX[i]!);
      const y = mapY(valuesY[i]!);
      // Exact positions decide what is in the plot, on both indexes.
      if (!(x >= plot.x && x <= right && y >= plot.y && y <= bottom)) {
        atOf[offset + i] = -1;
        continue;
      }
      const at = length++;
      if (at) {
        if (x <= xs[at - 1]!) strictX = false;
        if (single && (x !== xs[0] || y !== ys[0])) single = false;
      }
      xs[at] = x;
      ys[at] = y;
      series[at] = s;
      points[at] = i;
      sourceRows[at] = source?.[i] ?? i;
      atOf[offset + i] = at;
    }
  }

  interface Index {
    pick(x: number, y: number, limit: number): ScatterPick | null;
    /** The group of point `at`: it first, then the rest of its position, then the others within 0.5 px. */
    members(at: number, from: number, take: number): number[];
    has(at: number, other: number): boolean;
  }

  const snap = (value: number) => Math.round(value * ratio) / ratio;
  function index(rounded: boolean): Index {
    const px = rounded ? new Float64Array(length) : xs, py = rounded ? new Float64Array(length) : ys;

    const cells: Record<number, Cell> = Object.create(null);
    if (rounded) for (let i = 0; i < length; i++) {
      px[i] = snap(xs[i]!);
      py[i] = snap(ys[i]!);
    }
    const xCell = (at: number) => column(px[at]!);
    const cellOf = (at: number) => row(py[at]!) * columns + xCell(at);
    function later(at: number, other: number): boolean {
      const difference = sourceRows[at]! - sourceRows[other]!;
      if (difference !== 0) return difference > 0;
      const cellDifference = cellOf(at) - cellOf(other);
      return cellDifference < 0 || cellDifference === 0 && at > other;
    }
    interface Cell {
      count: number; head: number; bucket?: Bucket;
    }
    const order = new Uint32Array(length), rowsByPosition = new Uint32Array(length);
    // One array first links the raw entries of a cell, then gives each point's group.
    const group = new Int32Array(length);
    const sizeOf = new Uint32Array(length), placed = new Uint32Array(length);
    const sorted = strictX && !rounded;
    const comparePosition = (a: number, b: number) => px[a]! - px[b]! || py[a]! - py[b]!;

    function build(start: number, end: number, allowSkew = true): Bucket {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      let latest = order[start]!;
      let count = 0;
      for (let i = start; i < end; i++) {
        const p = order[i]!;
        const x = px[p]!, y = py[p]!;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        count += sizeOf[group[p]!]!;
        if (later(p, latest)) latest = p;
        placed[p] = i;
      }
      const bucket: Bucket = { start, end, count, minX, maxX, minY, maxY, latest, skew: allowSkew };
      if (end - start > CELL_LIMIT) split(bucket);
      return bucket;
    }

    function split(bucket: Bucket): boolean {
      if (bucket.left) return true;
      const { start, end, minX, maxX, minY, maxY } = bucket;
      const size = end - start;
      if (size <= LEAF_SIZE) return false;
      const byX = maxX - minX >= maxY - minY;
      const positions = byX ? px : py;
      const pivot = byX ? minX / 2 + maxX / 2 : minY / 2 + maxY / 2;
      let mid = start;
      // A lazy split rewrites the shared order and placed arrays during a pick. That is safe: it runs synchronously
      // on the one JS thread and only within this bucket's range, which no caller reads until the split returns.
      for (let i = start; i < end; i++) {
        const p = order[i]!;
        if (positions[p]! >= pivot) continue;
        order[i] = order[mid]!;
        order[mid++] = p;
      }
      const smaller = Math.min(mid - start, end - mid);
      const skewed = smaller < size / 8;
      // Keep spatially separated groups together. Consecutive skewed splits need a median to bound depth.
      const useSkew = skewed && bucket.skew && smaller > 0;
      if (skewed && !useSkew) {
        order.subarray(start, end).sort((a, b) => positions[a]! - positions[b]!);
        mid = start + Math.floor(size / 2);
      }
      bucket.left = build(start, mid, !useSkew);
      bucket.right = build(mid, end, !useSkew);
      return true;
    }

    function buildCell(cell: Cell): Bucket {
      const start = offset, end = offset += cell.count;
      let at = cell.head;
      for (let slot = start; slot < end; slot++) {
        rowsByPosition[sorted ? end - 1 - (slot - start) : slot] = at;
        at = single ? at - 1 : group[at]!;
      }
      if (!sorted && !single) rowsByPosition.subarray(start, end).sort(comparePosition);
      let write = start;
      for (let i = start; i < end;) {
        const first = i;
        const head = rowsByPosition[i]!;
        let winner = i;
        do {
          const at = rowsByPosition[i]!;
          if (sourceRows[at]! > sourceRows[rowsByPosition[winner]!]!) winner = i;
          group[at] = first;
          i++;
        } while (!sorted && i < end && comparePosition(rowsByPosition[i]!, head) === 0);
        sizeOf[first] = i - first;
        const rep = rowsByPosition[winner]!;
        if (winner !== first) rowsByPosition.copyWithin(first + 1, first, winner);
        rowsByPosition[first] = rep;
        order[write++] = rep;
      }
      return build(start, write);
    }
    let offset = 0;
    const pending: (IndexRange | undefined)[] = [];
    function distribute(start: number, end: number): void {
      for (let at = start; at < end; at++) {
        const key = cellOf(at);
        const cell = cells[key] ??= { count: 0, head: -1 };
        group[at] = cell.head;
        cell.head = at;
        cell.count++;
      }
    }
    if (strictX && !single) {
      for (let start = 0; start < length;) {
        const c = xCell(start);
        let lo = start + 1;
        while (lo + LEAF_SIZE < length && xCell(lo + LEAF_SIZE) === c) lo += LEAF_SIZE + 1;
        while (lo < length && xCell(lo) === c) lo++;
        if (lo - start <= COLUMN_LIMIT) pending[c] = { start, end: lo };
        else distribute(start, lo);
        start = lo;
      }
    } else if (single && length) {
      cells[cellOf(0)] = { count: length, head: length - 1 };
    } else distribute(0, length);
    for (const cell of Object.values(cells)) if (cell.count > CELL_LIMIT) cell.bucket = buildCell(cell);

    function bucketAt(cell: number): Bucket | undefined {
      const c = cell % columns;
      const range = pending[c];
      if (range) {
        distribute(range.start, range.end);
        pending[c] = undefined;
      }
      const entry = cells[cell];
      if (entry) return entry.bucket ??= buildCell(entry);
    }

    const squaredDistance = (at: number, x: number, y: number) => (px[at]! - x) ** 2 + (py[at]! - y) ** 2;
    function pick(x: number, y: number, limit: number): ScatterPick | null {
      // The window covers every compared position within the radius, and every 0.5 px neighbourhood of one.
      const visit = () => {
        if (++examined > limit) throw OVER_BUDGET;
      };

      let nearest = -1;
      let best = RADIUS2;
      function consider(at: number): void {
        visit();
        const distance = squaredDistance(at, x, y);
        if (distance < best || distance === best && (nearest < 0 || later(at, nearest))) {
          nearest = at;
          best = distance;
        }
      }
      function search(bucket: Bucket, distance: number): void {
        if (distance > best) return;
        if (split(bucket)) {
          const a = bucket.left!, b = bucket.right!;
          const left = distanceTo(a, x, y), right = distanceTo(b, x, y);
          if (left <= right) { search(a, left); search(b, right); }
          else { search(b, right); search(a, left); }
        } else {
          for (let i = bucket.start; i < bucket.end; i++) consider(order[i]!);
        }
      }

      const nearby = around(x, y, CELL + COINCIDENT, true);
      nearby.sort((a, b) => distanceTo(a, x, y) - distanceTo(b, x, y));
      for (const bucket of nearby) search(bucket, distanceTo(bucket, x, y));
      if (nearest < 0) return null;

      const closest = Math.sqrt(best);
      function inTie(distance: number): boolean {
        return distance <= RADIUS2 && Math.sqrt(distance) - closest < tieDistance;
      }
      function searchTies(bucket: Bucket): void {
        if (!later(bucket.latest, nearest) || !inTie(distanceTo(bucket, x, y))) return;
        if (inTie(distanceAcross(bucket, x, y))) {
          nearest = bucket.latest;
        } else if (split(bucket)) {
          searchTies(bucket.left!);
          searchTies(bucket.right!);
        } else {
          for (let i = bucket.start; i < bucket.end; i++) {
            const at = order[i]!;
            if (!later(at, nearest)) continue;
            visit();
            if (inTie(squaredDistance(at, x, y))) nearest = at;
          }
        }
      }
      for (const bucket of nearby) searchTies(bucket);

      return readGroup(nearest, 0, POINT_LIMIT, visit);
    }

    const near = (at: number, cx: number, cy: number) => squaredDistance(at, cx, cy) <= COINCIDENT2;

    /** Trees intersecting the search square, in cell order. */
    function around(cx: number, cy: number, radius = COINCIDENT, picking = false): Bucket[] {
      const found: Bucket[] = [];
      const bottom = row(cy + radius);
      const right = column(cx + radius);
      const left = column(cx - radius);
      for (let r = row(cy - radius); r <= bottom; r++) {
        for (let c = left; c <= right; c++) {
          if (trackWork && picking) cellsExamined++;
          const cell = c + r * columns;
          const bucket = bucketAt(cell);
          if (bucket) found.push(bucket);
        }
      }
      return found;
    }

    function readGroup(at: number, from: number, take: number, visit?: () => void) {
      const hits: number[] = [];
      const own = group[at]!, cx = px[at]!, cy = py[at]!;
      const rep = rowsByPosition[own]!;
      let count = sizeOf[own]!;
      function emit(member: number): void {
        if (trackWork) membersRead++;
        if (from > 0) from--;
        else hits.push(member);
      }
      function emitPosition(start: number): void {
        const n = sizeOf[start]!;
        if (from >= n) { from -= n; return; }
        const head = start === own ? at : rowsByPosition[start]!;
        emit(head);
        for (let i = start; i < start + n && hits.length < take; i++) {
          const member = rowsByPosition[i]!;
          if (member !== head) emit(member);
        }
      }
      if (take > 0) emitPosition(own);
      function walk(bucket: Bucket, counting: boolean): void {
        if (distanceTo(bucket, cx, cy) > COINCIDENT2) return;
        const inside = distanceAcross(bucket, cx, cy) <= COINCIDENT2;
        if (inside) {
          const place = placed[rep]!;
          const n = bucket.count - (place >= bucket.start && place < bucket.end ? sizeOf[own]! : 0);
          if (counting) count += n;
          if (from >= n) { from -= n; return; }
          counting = false;
        }
        if (!counting && hits.length >= take) return;
        if (split(bucket)) {
          walk(bucket.left!, counting);
          walk(bucket.right!, counting);
        } else {
          for (let i = bucket.start; i < bucket.end && (counting || hits.length < take); i++) {
            const entry = order[i]!;
            if (counting) visit!();
            else if (trackWork) membersRead++;
            const position = group[entry]!;
            if (position !== own && (inside || near(entry, cx, cy))) {
              if (counting) count += sizeOf[position]!;
              if (hits.length < take) emitPosition(position);
            }
          }
        }
      }
      for (const bucket of around(cx, cy)) walk(bucket, !!visit);
      return { hits, count };
    }
    function members(at: number, from: number, take: number): number[] {
      bucketAt(cellOf(at));
      return readGroup(at, from, take).hits;
    }
    return { pick, members, has: (at, other) => near(other, px[at]!, py[at]!) };
  }

  const exact = budget > 0 ? index(false) : null;
  let lattice = !exact || (single ? 1 : 3 * length + 2 * POINT_LIMIT) > budget ? index(true) : null;
  const indexFor = (rule: GroupRule): Index => (rule === 'exact' && exact) || (lattice ??= index(true));

  const grid = {
    series, points,
    /** Whether the last pick was answered on the device-pixel lattice. */
    get usedLattice() { return usedLattice; },
    pick(pointerX: number, pointerY: number): ScatterPick | null {
      examined = 0;
      if (trackWork) cellsExamined = 0;
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
      const range = shown[s];
      return range && i >= range.start && i < range.end ? atOf[first[s]! + i - range.start]! : -1;
    },
    members(rule: GroupRule, at: number, from: number, take: number): number[] {
      if (trackWork) membersRead = 0;
      return indexFor(rule).members(at, from, take);
    },
    has(rule: GroupRule, at: number, other: number): boolean {
      return indexFor(rule).has(at, other);
    },
  };
  // Work counters, for tests (development and benchmark builds): distance checks and rows sampled by the last
  // pick on both indexes, the cells it opened, and the entries the last `members` call read.
  if (trackWork) {
    Object.defineProperties(grid, {
      examined: { get: () => examined }, cellsExamined: { get: () => cellsExamined }, membersRead: { get: () => membersRead },
    });
  }
  return grid as typeof grid & { readonly examined: number; readonly cellsExamined: number; readonly membersRead: number };
}
