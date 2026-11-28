/**
 * Bubble geometry: the size channel of a point frame, the radius rule and the painter's order.
 *
 * The size channel lives beside the frame, never in it (contracts.ts has no size column): a WeakMap keyed by the
 * PointFrame itself. A labels-only update clones the frame with `{ ...frame }` (core renamed()), which keeps the
 * frame's series array; the clone is registered as an alias of the channel found through that shared array, so
 * a clone reads the same channel without recomputing it, and new data or a new field builds a new one.
 */
import type { Layout, PointFrame, Rect, ScatterView } from '../../core/contracts';
import { scatterPosition } from '../../lookup/geometry';
import { SIZE_OK, type BubbleMeta, type SizeColumn } from './options';

/** Radius of the hollow marker a zero size is drawn as: a 1 px outline, so it is seen and can be picked. */
export const ZERO_RADIUS = 3;

export interface SizeChannel {
  readonly sizes: SizeColumn;
  /** Per series, the size of each point (frame order); NaN where the row has no drawable size. */
  readonly values: readonly Float64Array[];
  /** Largest drawable size of the frame (0 when every size is zero, -Infinity when there is none). */
  readonly max: number;
  readonly min: number;
}

let channels: WeakMap<PointFrame, SizeChannel> | undefined;
/** The channel last built for a series array: what a shared-series clone of its frame aliases. */
let bySeries: WeakMap<PointFrame['series'], SizeChannel> | undefined;

export function sizeChannel(frame: PointFrame, sizes: SizeColumn): SizeChannel {
  const map = channels ??= new WeakMap();
  const known = map.get(frame);
  if (known && known.sizes === sizes) return known;
  const shared = (bySeries ??= new WeakMap()).get(frame.series);
  if (shared && shared.sizes === sizes) {
    map.set(frame, shared);
    return shared;
  }
  let max = -Infinity, min = Infinity;
  const values = frame.series.map(series => {
    const out = new Float64Array(series.x.length);
    const rows = series.row;
    for (let i = 0; i < out.length; i++) {
      const row = rows ? rows[i]! : i;
      const ok = row >= 0 && row < sizes.values.length && (sizes.state === null || sizes.state[row] === SIZE_OK);
      const v = ok ? sizes.values[row]! : NaN;
      out[i] = v;
      if (ok && series.drawable) {
        if (v > max) max = v;
        if (v < min) min = v;
      }
    }
    return out;
  });
  const channel = { sizes, values, max, min };
  map.set(frame, channel);
  bySeries.set(frame.series, channel);
  return channel;
}

/** Smallest normal double: below it a quotient keeps fewer significant bits. */
const MIN_NORMAL = 2.2250738585072014e-308;

/**
 * Area-proportional radius: r = maxRadius · √(v / max), so A(v2) / A(v1) = v2 / v1 for every pair of positive
 * sizes the floor does not lift. v ≤ max, so v / max never overflows. When v / max is subnormal or underflows
 * (a tiny size beside a huge one), the quotient has lost its precision, so the radius is taken from the root
 * quotient √v / √max instead. That quotient can itself be subnormal (down to ≈ 2^-1049 for MIN_VALUE beside
 * MAX_VALUE), so when it is, it is computed 2^512 higher and maxRadius 2^512 lower: power-of-two scaling is
 * exact, and the final product rounds once (MIN_VALUE beside MAX_VALUE at 24 px: ≈ 3.98e-315, not 0;
 * 2 · MIN_VALUE beside MAX_VALUE at 1000 px: ≈ 2.344496271e-313; MIN_VALUE beside 2^-50 at `max: 2^-560`: 2^-1072).
 * Zero is 0 (the hollow marker), anything not drawable NaN. A positive size never returns 0: when even the
 * final radius underflows (a subnormal `radius.max`), it is Number.MIN_VALUE, the smallest positive radius a
 * double holds, so the bubble stays a positive (invisible, still pickable) circle and is never taken for the
 * zero marker. That is a representability limit, not a visible floor. A positive size is never drawn below
 * `minRadius`: the one documented exception to proportionality, so the smallest bubbles stay visible and
 * pickable. There is no other floor: the radius computed here is the one painted, picked and shown in the legend.
 */
export function radiusOf(v: number, max: number, minRadius: number, maxRadius: number): number {
  if (!(v >= 0) || !Number.isFinite(v)) return NaN;
  if (v === 0) return 0;
  if (!(max > 0) || !Number.isFinite(max)) return NaN;
  const ratio = v >= max ? 1 : v / max;
  let r: number;
  if (ratio >= MIN_NORMAL) r = maxRadius * Math.sqrt(ratio);
  else {
    // Multiplying maxRadius in first could underflow an intermediate the result does not need (2^-560 · 2^-537).
    const root = Math.sqrt(v), rootMax = Math.sqrt(max);
    const quotient = root / rootMax;
    if (quotient >= MIN_NORMAL) r = maxRadius * quotient;
    // A subnormal quotient (≥ √(2^-1074 / 2^1024) ≈ 2^-1049) has lost bits, so it is formed 2^512 higher, where
    // it is normal: √v ≥ 2^-537 and √v · 2^512 < 2^1024 are exact. maxRadius · 2^-512 is exact unless
    // maxRadius < 2^-510; then the true radius is below 2^-1022 · 2^-510, far under MIN_VALUE, so it is 0 either
    // way and any rounding of the scaled maxRadius is irrelevant.
    else r = ((root * 2 ** 512) / rootMax) * (maxRadius * 2 ** -512);
  }
  if (!(r > 0)) r = Number.MIN_VALUE;
  return Math.max(minRadius, r);
}

/**
 * Write precision (lattice steps per CSS px) for a circle of drawn radius `r`: 0.01 px, as the stock renderer
 * writes coordinates, for anything a pixel or larger; 0.0001 px below, so a small configured radius
 * (`radius.max: 0.25`, or `min: 0` with a tiny size) keeps its area ratio in the written path instead of being
 * rounded to the 0.01 px grid or to nothing.
 */
export const scaleFor = (r: number): number => (r >= 1 ? 100 : 10000);

/** `v` on the lattice of `scale` steps per px, as short as it writes. */
export function writeNum(v: number, scale: number): string {
  const c = Math.round(v * scale);
  return c === 0 ? '0' : String(c / scale);
}

/**
 * A radius (or a whole-circle diameter step) as written: 7 significant digits, not the end-point lattice, so
 * the configured radius and the area ratio survive serialization (`max: 1.006` writes 1.006; sizes 1 and 2 at
 * `max: 24` write 16.97056 and 24, ratio 0.5 within 1e-6). End points stay on scaleFor's lattice; with arcs of at
 * most 2π/3 the chord stays shorter than the diameter, so the renderer never rescales the written radius.
 */
export const writeRadius = (r: number): string => String(Number(r.toPrecision(7)));

/** The radius bubbles are drawn and picked at: the hollow marker's for a zero size. */
export const drawnRadius = (r: number): number => (r === 0 ? ZERO_RADIUS : r);

/** Every bubble drawn in one (view, layout): plot positions, radii and painter's order. */
export interface BubbleGeometry {
  readonly count: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  /**
   * 0 for a zero size (drawn hollow at ZERO_RADIUS). Float64, not Float32: a positive radius configured or
   * computed below Float32's range (min: 0 with a tiny size) must stay positive, never turn into a zero marker.
   */
  readonly r: Float64Array;
  readonly series: Uint16Array;
  /** Point index in its PointSeries. */
  readonly index: Uint32Array;
  /** Source row. */
  readonly row: Int32Array;
  /** Painter's order: largest first; equal radii by source row, so the later row is painted (and picked) on top. */
  readonly order: Uint32Array;
  /** Place of each bubble in `order`: the higher, the nearer the top. */
  readonly rank: Int32Array;
  /** Largest drawn radius (ZERO_RADIUS at least when anything is drawn). */
  readonly reach: number;
  readonly plot: Rect;
}

let geometries: WeakMap<Layout, WeakMap<ScatterView, BubbleGeometry>> | undefined;

export function bubbleGeometry(view: ScatterView, layout: Layout, meta: BubbleMeta): BubbleGeometry | null {
  if (layout.kind !== 'plot' && layout.kind !== 'compact') return null;
  const projection = layout.projection;
  if (projection.kind !== 'xy') return null;
  let byView = (geometries ??= new WeakMap()).get(layout);
  const known = byView?.get(view);
  if (known) return known;
  const frame = view.frame;
  const channel = sizeChannel(frame, meta.sizes);
  let n = 0;
  frame.series.forEach((s, i) => {
    if (!view.visible[i] || !s.drawable) return;
    const { start, end } = view.visiblePoints[i]!;
    n += Math.max(0, end - start);
  });
  const x = new Float32Array(n), y = new Float32Array(n), r = new Float64Array(n);
  const series = new Uint16Array(n), index = new Uint32Array(n), row = new Int32Array(n);
  const plot = layout.plot;
  let k = 0, reach = 0;
  frame.series.forEach((s, si) => {
    if (!view.visible[si] || !s.drawable) return;
    const { start, end } = view.visiblePoints[si]!;
    const sizes = channel.values[si]!;
    for (let i = start; i < end; i++) {
      const radius = (radiusOf(sizes[i]!, channel.max, meta.minRadius, meta.maxRadius));
      if (Number.isNaN(radius)) continue;
      const px = scatterPosition(projection.x, s.x[i]!), py = scatterPosition(projection.y, s.y[i]!);
      // Only bubbles whose centre is on the plot are drawn and picked, as scatter points are (lookup anchor).
      if (!(px >= plot.x && px <= plot.x + plot.width && py >= plot.y && py <= plot.y + plot.height)) continue;
      x[k] = px; y[k] = py; r[k] = radius; series[k] = si; index[k] = i; row[k] = s.row ? s.row[i]! : i;
      const drawn = drawnRadius(r[k]!);
      if (drawn > reach) reach = drawn;
      k++;
    }
  });
  const order = new Uint32Array(k);
  for (let i = 0; i < k; i++) order[i] = i;
  order.sort((a, b) => (r[b]! - r[a]!) || (row[a]! - row[b]!) || (series[a]! - series[b]!));
  const rank = new Int32Array(k);
  for (let o = 0; o < k; o++) rank[order[o]!] = o;
  const geometry: BubbleGeometry = {
    count: k, x: x.subarray(0, k), y: y.subarray(0, k), r: r.subarray(0, k), series: series.subarray(0, k),
    index: index.subarray(0, k), row: row.subarray(0, k), order, rank, reach, plot,
  };
  if (!byView) geometries.set(layout, byView = new WeakMap());
  byView.set(view, geometry);
  return geometry;
}

let rowIndexes: WeakMap<BubbleGeometry, Int32Array> | undefined;

/**
 * Bubble index by source row (-1: no bubble drawn for that row). A scatter frame is long form (one y field), so
 * each row belongs to one series and one typed array answers "which bubble is this datum"; the caller checks
 * the series.
 */
export function bubbleAtRow(g: BubbleGeometry): Int32Array {
  const known = (rowIndexes ??= new WeakMap()).get(g);
  if (known) return known;
  let max = -1;
  for (let b = 0; b < g.count; b++) if (g.row[b]! > max) max = g.row[b]!;
  const index = new Int32Array(max + 1).fill(-1);
  for (let b = 0; b < g.count; b++) index[g.row[b]!] = b;
  rowIndexes.set(g, index);
  return index;
}

/** The bubble drawn for a datum of series `series` at source row `row`, or -1. */
export function bubbleFor(g: BubbleGeometry, series: number, row: number): number {
  const index = bubbleAtRow(g);
  const b = row >= 0 && row < index.length ? index[row]! : -1;
  return b >= 0 && g.series[b] === series ? b : -1;
}

/** One circle per member as two arcs (a closed subpath each), in the members' order. */
export function circlesPath(g: BubbleGeometry, members: Uint32Array, grow = 0): string {
  let d = '';
  for (let i = 0; i < members.length; i++) {
    const b = members[i]!;
    const rad = drawnRadius(g.r[b]!) + grow, scale = scaleFor(rad), diameter = writeRadius(2 * rad), rr = writeRadius(rad);
    d += `M${writeNum(g.x[b]! - rad, scale)} ${writeNum(g.y[b]!, scale)}a${rr} ${rr} 0 1 0 ${diameter} 0a${rr} ${rr} 0 1 0 -${diameter} 0Z`;
  }
  return d;
}
