import type { ScatterView, XScale } from '../core/contracts';
import { pointerOnPlot, scatterPosition, type PlotLayout } from './geometry';

// Squares written out, so the module does no work at import time.
const CELL = 24;
const RADIUS2 = 576; // CELL²
const COINCIDENT = 0.5;
const COINCIDENT2 = 0.25; // COINCIDENT²
const LEAF_SIZE = 32;
const MAX_DENSE_CELLS = 65_536;
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

function linearProjection(scale: XScale) {
  if (scale.type === 'band') return null;
  const [d0, d1] = scale.domain;
  const [r0, r1] = scale.range;
  const span = d1 - d0, extent = r1 - r0;
  if (!Number.isFinite(span) || !span || !Number.isFinite(extent) || !extent) return null;
  return { d0, d1, r0, r1, span, extent, low: Math.min(r0, r1), high: Math.max(r0, r1) };
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
  count: number, devicePixelRatio: number, options: GridOptions = {},
) {
  const { plot, projection } = layout;
  const columns = Math.floor(plot.width / CELL) + 1;
  const rows = Math.floor(plot.height / CELL) + 1;
  const gridSize = columns * rows;
  const dense = gridSize <= MAX_DENSE_CELLS;
  const dataSeries = view.frame.series;
  const series = new Uint32Array(count);
  const points = new Uint32Array(count);
  // Grid index of point i of series s at atOf[first[s] + i - start of its range], -1 when it is not on the
  // plot: sized to the points in view, so a narrow view of a large frame indexes only what it shows.
  const shown = dataSeries.map((data, s) => view.visible[s] && data.drawable ? view.visiblePoints[s]! : { start: 0, end: 0 });
  const first = new Int32Array(shown.length + 1);
  shown.forEach(({ start, end }, s) => { first[s + 1] = first[s]! + end - start; });
  const atOf = new Int32Array(first[shown.length]!).fill(-1);
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

  function cellLists(capacity: number) {
    const heads = dense ? new Int32Array(gridSize).fill(-1) : new Map<number, number>();
    const cells = dense ? new Uint16Array(capacity) : new Float64Array(capacity);
    const next = new Int32Array(capacity);
    function add(at: number, x: number, y: number): void {
      const cell = row(y) * columns + column(x);
      cells[at] = cell;
      if (heads instanceof Map) {
        next[at] = heads.get(cell) ?? -1;
        heads.set(cell, at);
      } else {
        next[at] = heads[cell]!;
        heads[cell] = at;
      }
    }
    return { heads, cells, next, add };
  }

  const exactLists = budget > 0 ? cellLists(count) : null;
  const sourceRows = new Float64Array(count);
  const linearX = linearProjection(projection.x), linearY = linearProjection(projection.y);
  const right = plot.x + plot.width, bottom = plot.y + plot.height;
  dataSeries.forEach((data, s) => {
    const { start, end } = shown[s]!;
    const { x: valuesX, y: valuesY, row: source } = data;
    const offset = first[s]! - start;
    for (let i = start; i < end; i++) {
      const vx = valuesX[i]!;
      const vy = valuesY[i]!;
      // Keep the endpoints and arithmetic of continuous.map. The fallback also repairs rounding at the edges.
      let x: number;
      if (linearX) {
        const { d0, d1, r0, r1, span, extent, low, high } = linearX;
        x = vx === d0 ? r0 : vx === d1 ? r1 : r0 + ((vx - d0) / span) * extent;
        if (!(x >= low && x <= high)) x = scatterPosition(projection.x, vx);
      } else {
        x = scatterPosition(projection.x, vx);
      }
      let y: number;
      if (linearY) {
        const { d0, d1, r0, r1, span, extent, low, high } = linearY;
        y = vy === d0 ? r0 : vy === d1 ? r1 : r0 + ((vy - d0) / span) * extent;
        if (!(y >= low && y <= high)) y = scatterPosition(projection.y, vy);
      } else {
        y = scatterPosition(projection.y, vy);
      }
      // Exact positions decide what is in the plot, on both indexes.
      if (!(x >= plot.x && x <= right && y >= plot.y && y <= bottom)) continue;
      const at = length++;
      xs[at] = x;
      ys[at] = y;
      series[at] = s;
      points[at] = i;
      sourceRows[at] = source?.[i] ?? i;
      atOf[offset + i] = at;
      exactLists?.add(at, x, y);
    }
  });

  /** The most points in any 4 × 4 block of cells. */
  function densestWindow(buckets: readonly (Bucket | undefined)[] | Map<number, Bucket>): number {
    let densest = 0;
    if (buckets instanceof Map) {
      // Each occupied cell contributes to at most sixteen windows, identified by their top left cell.
      const windows = new Map<number, number>();
      for (const [cell, { count }] of buckets) {
        const r = Math.floor(cell / columns), c = cell % columns;
        for (let dy = 0; dy <= Math.min(3, r); dy++) {
          for (let dx = 0; dx <= Math.min(3, c); dx++) {
            const key = cell - dy * columns - dx;
            const sum = (windows.get(key) ?? 0) + count;
            windows.set(key, sum);
            densest = Math.max(densest, sum);
          }
        }
      }
      return densest;
    }
    const totals = new Int32Array(columns);
    for (let r = 0; r < rows; r++) {
      let sum = 0;
      for (let c = 0; c < columns; c++) {
        const i = r * columns + c;
        totals[c]! += (buckets[i]?.count ?? 0) - (r >= 4 ? buckets[i - 4 * columns]?.count ?? 0 : 0);
        sum += totals[c]! - (c >= 4 ? totals[c - 4]! : 0);
        densest = Math.max(densest, sum);
      }
    }
    return densest;
  }

  interface Index {
    readonly buckets: readonly (Bucket | undefined)[] | Map<number, Bucket>;
    pick(x: number, y: number, limit: number): ScatterPick | null;
    /** The group of point `at`: it first, then the rest of its position, then the others within 0.5 px. */
    members(at: number, from: number, take: number): number[];
    has(at: number, other: number): boolean;
  }

  function index(px: Float64Array, py: Float64Array, { heads, cells, next }: ReturnType<typeof cellLists>): Index {
    function later(at: number, other: number): boolean {
      const difference = sourceRows[at]! - sourceRows[other]!;
      if (difference !== 0) return difference > 0;
      const cellDifference = cells[at]! - cells[other]!;
      return cellDifference < 0 || cellDifference === 0 && at > other;
    }

    const order = new Uint32Array(length);
    const multiplicity = new Uint32Array(length);
    // The representative of each point's position, and where each representative sits in `order`.
    const repOf = new Int32Array(length);
    const placed = new Int32Array(length);
    const buckets = dense ? new Array<Bucket | undefined>(gridSize) : new Map<number, Bucket>();
    const comparePosition = (a: number, b: number) => px[a]! - px[b]! || py[a]! - py[b]!;

    function build(start: number, end: number, allowSkew = true): Bucket {
      const size = end - start;
      const leaf = size <= LEAF_SIZE;
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
        if (leaf) {
          count += multiplicity[p]!;
          if (later(p, latest)) latest = p;
          // Only leaves know the final order after all splits.
          placed[p] = i;
        }
      }
      if (leaf) {
        return { start, end, count, minX, maxX, minY, maxY, latest };
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
      const skewed = smaller < size / 8;
      // Keep spatially separated groups together. Consecutive skewed splits need a median to bound depth.
      const useSkew = skewed && allowSkew && smaller > 0;
      if (skewed && !useSkew) {
        order.subarray(start, end).sort((a, b) => positions[a]! - positions[b]!);
        mid = start + Math.floor(size / 2);
      }
      const left = build(start, mid, !useSkew);
      const right = build(mid, end, !useSkew);
      return {
        start, end, count: left.count + right.count, minX, maxX, minY, maxY, left, right,
        latest: later(left.latest, right.latest) ? left.latest : right.latest,
      };
    }

    let end = 0;
    function buildCell(head: number): Bucket {
      const start = end;
      order[end++] = head;
      if (next[head] === -1) {
        multiplicity[head] = 1;
        repOf[head] = head;
        placed[head] = start;
        return { start, end, count: 1, minX: px[head]!, maxX: px[head]!, minY: py[head]!, maxY: py[head]!, latest: head };
      }
      let ascending = true, strictlyDescending = true;
      let previous = head;
      for (let at = next[head]!; at >= 0; at = next[at]!) {
        order[end++] = at;
        if (ascending || strictlyDescending) {
          if (comparePosition(at, previous) < 0) ascending = false;
          else strictlyDescending = false;
          previous = at;
        }
      }
      // A series in x order usually gives a strictly descending list. Reversing it is stable only without ties.
      if (strictlyDescending) {
        let write = end;
        for (let at = head; at >= 0;) {
          const following = next[at]!;
          order[--write] = at;
          multiplicity[at] = 1;
          repOf[at] = at;
          next[at] = -1;
          at = following;
        }
        return build(start, end);
      }
      if (!ascending && end - start <= LEAF_SIZE) {
        for (let i = start + 1; i < end; i++) {
          const at = order[i]!, x = px[at]!, y = py[at]!;
          let j = i;
          while (j > start) {
            const before = order[j - 1]!;
            if (!(x < px[before]! || x === px[before] && y < py[before]!)) break;
            order[j--] = before;
          }
          order[j] = at;
        }
      } else if (!ascending) {
        order.subarray(start, end).sort(comparePosition);
      }

      // Group identical positions before splitting the cell, so a median cannot spread them across leaves.
      // Keep the latest row as the representative and link the others for the capped tooltip.
      let write = start;
      for (let i = start; i < end;) {
        const first = order[i]!;
        const groupStart = i++;
        const x = px[first]!, y = py[first]!;
        let winner = first;
        for (; i < end; i++) {
          const at = order[i]!;
          if (px[at] !== x || py[at] !== y) break;
          if (later(at, winner)) winner = at;
        }
        // Prepend in reverse order to preserve the stable order behind the representative.
        let head = -1;
        for (let j = i - 1; j >= groupStart; j--) {
          const at = order[j]!;
          repOf[at] = winner;
          if (at !== winner) {
            next[at] = head;
            head = at;
          }
        }
        next[winner] = head;
        multiplicity[winner] = i - groupStart;
        order[write++] = winner;
      }
      end = write;
      return build(start, end);
    }
    heads.forEach((head, cell) => {
      if (head < 0) return;
      const bucket = buildCell(head);
      if (buckets instanceof Map) buckets.set(cell, bucket);
      else buckets[cell] = bucket;
    });

    const squaredDistance = (at: number, x: number, y: number) => (px[at]! - x) ** 2 + (py[at]! - y) ** 2;
    function otherCount({ count, start, end }: Bucket, own: number): number {
      const place = placed[own]!;
      return place >= start && place < end ? count - multiplicity[own]! : count;
    }

    function pick(x: number, y: number, limit: number): ScatterPick | null {
      // The window covers every compared position within the radius, and every 0.5 px neighbourhood of one.
      const nearby = around(x, y, CELL + COINCIDENT, true);
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
            if (inTie(squaredDistance(at, x, y))) nearest = at;
          }
        }
      }
      for (const bucket of nearby) searchTies(bucket);

      return { hits: members(nearest, 0, POINT_LIMIT), count: groupSize(nearest, visit) };
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
          const bucket = buckets instanceof Map ? buckets.get(cell) : buckets[cell];
          if (bucket) found.push(bucket);
        }
      }
      return found;
    }

    // Counting can consume a whole bucket. Paging can skip one, or descend until its page is full.
    function visitGroup(at: number, whole: (size: number) => boolean, position: (entry: number) => boolean, visit: () => void): void {
      const own = repOf[at]!;
      const cx = px[at]!;
      const cy = py[at]!;
      function walk(bucket: Bucket): boolean {
        if (distanceTo(bucket, cx, cy) > COINCIDENT2) return true;
        if (distanceAcross(bucket, cx, cy) <= COINCIDENT2 && whole(otherCount(bucket, own))) return true;
        if (bucket.left && bucket.right) return walk(bucket.left) && walk(bucket.right);
        for (let i = bucket.start; i < bucket.end; i++) {
          const entry = order[i]!;
          visit();
          if (entry !== own && near(entry, cx, cy) && !position(entry)) return false;
        }
        return true;
      }
      for (const bucket of around(cx, cy)) if (!walk(bucket)) break;
    }

    function groupSize(at: number, visit: () => void): number {
      let size = multiplicity[repOf[at]!]!;
      const add = (count: number) => { size += count; return true; };
      visitGroup(at, add, entry => add(multiplicity[entry]!), visit);
      return size;
    }

    function members(at: number, from: number, take: number): number[] {
      const out: number[] = [];
      if (take <= 0) return out;
      const own = repOf[at]!;
      let skip = from;
      const emit = (member: number): boolean => {
        if (trackWork) membersRead++;
        if (skip > 0) skip--;
        else out.push(member);
        return out.length < take;
      };
      function skipGroup(size: number): boolean {
        if (!(skip >= size)) return false;
        skip -= size;
        return true;
      }
      function position(entry: number, first = -1): boolean {
        if (skipGroup(multiplicity[entry]!)) return true;
        if (first >= 0 && !emit(first)) return false;
        for (let member = entry; member >= 0; member = next[member]!) if (member !== first && !emit(member)) return false;
        return true;
      }
      if (!position(own, at)) return out;
      visitGroup(at, skipGroup, position, () => { if (trackWork) membersRead++; });
      return out;
    }

    return { buckets, pick, members, has: (at, other) => near(other, px[at]!, py[at]!) };
  }

  const exact = exactLists && index(xs, ys, exactLists);
  // An exact pick checks each point of the cells it searches at most three times (nearest, ties, coincidence)
  // and samples at most POINT_LIMIT rows; it searches at most 4 × 4 cells (a 49 px window over 24 px cells).
  // When no such window holds more than the budget allows, no pick can fall back. Otherwise the lattice index
  // is built here, with the lookup, so that no pointer move does work in proportion to the data.
  const canFallBack = !exact || (3 * length + 2 * POINT_LIMIT > budget && 3 * densestWindow(exact.buckets) + 2 * POINT_LIMIT > budget);
  function latticeIndex(): Index {
    const px = new Float64Array(length), py = new Float64Array(length);
    const lists = cellLists(length);
    for (let i = 0; i < length; i++) {
      px[i] = Math.round(xs[i]! * ratio) / ratio;
      py[i] = Math.round(ys[i]! * ratio) / ratio;
      lists.add(i, px[i]!, py[i]!);
    }
    return index(px, py, lists);
  }
  let lattice: Index | null = canFallBack ? latticeIndex() : null;
  // Built with the lookup whenever a pick can need it; built later only if that bound were ever wrong.
  const getLattice = () => lattice ??= latticeIndex();
  const indexFor = (rule: GroupRule): Index => (rule === 'exact' && exact) || getLattice();

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
      return getLattice().pick(x, y, Infinity);
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
