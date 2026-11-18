import type { ScatterView } from '../core/contracts';
import { contains, scatterPosition, type PlotLayout } from './geometry';

const CELL = 24;
const RADIUS2 = CELL * CELL;
const COINCIDENT = 0.5;
const COINCIDENT2 = COINCIDENT ** 2;
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

export function scatterGrid(
  view: ScatterView, layout: PlotLayout & { projection: Extract<PlotLayout['projection'], { kind: 'xy' }> },
  count: number, devicePixelRatio: number,
) {
  const { plot, projection } = layout;
  const columns = Math.floor(plot.width / CELL) + 1;
  const rows = Math.floor(plot.height / CELL) + 1;
  const heads = new Map<number, number>();
  const next = new Int32Array(count);
  const series = new Uint32Array(count);
  const points = new Uint32Array(count);
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  const tieDistance = 0.5 / (Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1);
  let length = 0;
  let examined = 0;
  let cellsExamined = 0;

  function cellIndex(pixel: number, origin: number, size: number): number {
    // Subtracting the origin from a rounded plot edge can place that edge one cell past the grid.
    return Math.max(0, Math.min(size - 1, Math.floor((pixel - origin) / CELL)));
  }

  const column = (x: number) => cellIndex(x, plot.x, columns);
  const row = (y: number) => cellIndex(y, plot.y, rows);
  const cellFor = (x: number, y: number) => column(x) + columns * row(y);

  function sourceRow(at: number): number {
    const i = points[at]!;
    return view.frame.series[series[at]!]!.row?.[i] ?? i;
  }

  function later(at: number, other: number): boolean {
    const difference = sourceRow(at) - sourceRow(other);
    if (difference !== 0) return difference > 0;
    const cellDifference = cellFor(xs[at]!, ys[at]!) - cellFor(xs[other]!, ys[other]!);
    return cellDifference < 0 || cellDifference === 0 && at > other;
  }

  view.frame.series.forEach((data, s) => {
    if (!view.visible[s] || !data.drawable) return;
    const { start, end } = view.visiblePoints[s]!;
    for (let i = start; i < end; i++) {
      const x = scatterPosition(projection.x, data.x[i]!);
      const y = scatterPosition(projection.y, data.y[i]!);
      if (!contains(plot, x, y)) continue;
      const cell = cellFor(x, y);
      const at = length++;
      next[at] = heads.get(cell) ?? -1;
      heads.set(cell, at);
      xs[at] = x;
      ys[at] = y;
      series[at] = s;
      points[at] = i;
    }
  });

  const order = new Uint32Array(length);
  const multiplicity = new Uint32Array(length);
  const buckets = new Map<number, Bucket>();
  function build(start: number, end: number, allowSkew = true): Bucket {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let count = 0;
    for (let i = start; i < end; i++) {
      const p = order[i]!;
      minX = Math.min(minX, xs[p]!);
      maxX = Math.max(maxX, xs[p]!);
      minY = Math.min(minY, ys[p]!);
      maxY = Math.max(maxY, ys[p]!);
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
    const positions = byX ? xs : ys;
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
      uniform &&= xs[at] === xs[head] && ys[at] === ys[head];
    }
    if (!uniform) order.subarray(start, end).sort((a, b) => xs[a]! - xs[b]! || ys[a]! - ys[b]!);

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
        if (xs[at] !== xs[first] || ys[at] !== ys[first]) break;
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
      order[write++] = winner;
    }
    end = write;
    buckets.set(cell, build(start, end));
  }

  return {
    series, points,
    // Count individual distance checks and rows visited while sampling tooltip refs.
    get examined() { return examined; },
    get cellsExamined() { return cellsExamined; },
    pick(x: number, y: number) {
      examined = 0;
      cellsExamined = 0;
      if (!contains(plot, x, y)) return null;
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

      let nearest = -1;
      let best = RADIUS2;
      function consider(at: number): void {
        examined++;
        const distance = (xs[at]! - x) ** 2 + (ys[at]! - y) ** 2;
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
            examined++;
            if (inTie((xs[at]! - x) ** 2 + (ys[at]! - y) ** 2)) nearest = at;
          }
        }
      }
      for (const bucket of nearby) searchTies(bucket);

      const px = xs[nearest]!;
      const py = ys[nearest]!;
      const hits = [nearest];
      let count = 0;
      function sample(head: number): void {
        for (let at = head; at >= 0 && hits.length < POINT_LIMIT; at = next[at]!) {
          examined++;
          if (at !== nearest) hits.push(at);
        }
      }
      function collect(bucket: Bucket): void {
        if (distanceTo(bucket, px, py) > COINCIDENT2) return;
        if (distanceAcross(bucket, px, py) <= COINCIDENT2) {
          count += bucket.count;
          for (let i = bucket.start; i < bucket.end && hits.length < POINT_LIMIT; i++) sample(order[i]!);
        } else if (bucket.left && bucket.right) {
          collect(bucket.left);
          collect(bucket.right);
        } else {
          for (let i = bucket.start; i < bucket.end; i++) {
            const at = order[i]!;
            examined++;
            if ((xs[at]! - px) ** 2 + (ys[at]! - py) ** 2 <= COINCIDENT2) {
              count += multiplicity[at]!;
              sample(at);
            }
          }
        }
      }
      // The same cell set covers every possible 0.5 px neighbourhood of the nearest point.
      for (const bucket of nearby) collect(bucket);
      return { hits, count };
    },
  };
}
