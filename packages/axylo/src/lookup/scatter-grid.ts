import type { ScatterView } from '../core/contracts';
import { contains, type PlotLayout } from './geometry';

const CELL = 24;
const RADIUS2 = CELL * CELL;
const COINCIDENT = 0.5;
const COINCIDENT2 = COINCIDENT ** 2;
const LEAF_SIZE = 32;
export const POINT_LIMIT = 8;

interface Bucket {
  readonly start: number;
  readonly end: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly left?: Bucket;
  readonly right?: Bucket;
  readonly coincident?: number;
}

function distanceTo(bucket: Bucket, x: number, y: number): number {
  return Math.max(bucket.minX - x, x - bucket.maxX, 0) ** 2
    + Math.max(bucket.minY - y, y - bucket.maxY, 0) ** 2;
}

function distanceAcross(bucket: Bucket, x: number, y: number): number {
  return Math.max(Math.abs(bucket.minX - x), Math.abs(bucket.maxX - x)) ** 2
    + Math.max(Math.abs(bucket.minY - y), Math.abs(bucket.maxY - y)) ** 2;
}

export function scatterGrid(view: ScatterView, layout: PlotLayout & { projection: Extract<PlotLayout['projection'], { kind: 'xy' }> }, count: number) {
  const { plot, projection } = layout;
  const columns = Math.floor(plot.width / CELL) + 1;
  const rows = Math.floor(plot.height / CELL) + 1;
  const heads = new Map<number, number>();
  const next = new Int32Array(count);
  const series = new Uint32Array(count);
  const points = new Uint32Array(count);
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  let length = 0;
  let examined = 0;
  let cellsExamined = 0;

  const column = (x: number) => Math.floor((x - plot.x) / CELL);
  const row = (y: number) => Math.floor((y - plot.y) / CELL);
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
      const x = projection.x.map(data.x[i]!);
      const y = projection.y.map(data.y[i]!);
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
  const buckets = new Map<number, Bucket>();
  function build(start: number, end: number): Bucket {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = start; i < end; i++) {
      const p = order[i]!;
      minX = Math.min(minX, xs[p]!);
      maxX = Math.max(maxX, xs[p]!);
      minY = Math.min(minY, ys[p]!);
      maxY = Math.max(maxY, ys[p]!);
    }
    const bounds = { start, end, minX, maxX, minY, maxY };
    if (minX === maxX && minY === maxY) {
      let coincident = order[start]!;
      for (let i = start + 1; i < end; i++) if (later(order[i]!, coincident)) coincident = order[i]!;
      return { ...bounds, coincident };
    }
    if (end - start <= LEAF_SIZE) return bounds;

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
    // Split the indexes, never the borrowed columns. Use a median for skewed cells to contain tree depth.
    if (Math.min(mid - start, end - mid) < (end - start) / 8) {
      order.subarray(start, end).sort((a, b) => positions[a]! - positions[b]!);
      mid = start + Math.floor((end - start) / 2);
    }
    return { ...bounds, left: build(start, mid), right: build(mid, end) };
  }

  let end = 0;
  for (const [cell, head] of heads) {
    const start = end;
    for (let at = head; at >= 0; at = next[at]!) order[end++] = at;
    buckets.set(cell, build(start, end));
  }

  return {
    series, points,
    get examined() { return examined; },
    get cellsExamined() { return cellsExamined; },
    pick(x: number, y: number) {
      examined = 0;
      cellsExamined = 0;
      if (!contains(plot, x, y)) return null;
      const radius = CELL + COINCIDENT;
      const left = Math.max(0, column(x - radius));
      const right = Math.min(columns - 1, column(x + radius));
      const top = Math.max(0, row(y - radius));
      const bottom = Math.min(rows - 1, row(y + radius));
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
        if (bucket.coincident !== undefined) {
          consider(bucket.coincident);
        } else if (bucket.left && bucket.right) {
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

      const px = xs[nearest]!;
      const py = ys[nearest]!;
      const hits = [nearest];
      let count = 0;
      function add(at: number): void {
        if (hits.length < POINT_LIMIT && at !== nearest) hits.push(at);
      }
      function collect(bucket: Bucket): void {
        if (distanceTo(bucket, px, py) > COINCIDENT2) return;
        if (distanceAcross(bucket, px, py) <= COINCIDENT2) {
          count += bucket.end - bucket.start;
          for (let i = bucket.start; i < bucket.end && hits.length < POINT_LIMIT; i++) add(order[i]!);
        } else if (bucket.left && bucket.right) {
          collect(bucket.left);
          collect(bucket.right);
        } else {
          for (let i = bucket.start; i < bucket.end; i++) {
            const at = order[i]!;
            examined++;
            if ((xs[at]! - px) ** 2 + (ys[at]! - py) ** 2 <= COINCIDENT2) {
              count++;
              add(at);
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
