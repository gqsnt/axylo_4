/**
 * Multi-axis mixed-layer lookup for `axylo/cartesian` (C4.3, RFC §5.2).
 * Enforces deterministic pick priority:
 *   1. Nearest line vertex (12 px at nearest slot) or scatter/box-outlier point (24 px across neighbouring slots)
 *   2. Visible bar rectangle hit at slot
 *   3. Drawn geometry of range, errorBar, or boxplot (later layers first)
 *   4. Aligned slot listing all visible series in declared layer order
 */
import {
  SLOT_NO_ROW, SLOT_VALUE, type AlignedView, type DatumRef, type DatumText, type Formatters,
  type Layout, type Lookup, type PickTarget, type Projection, type Rect, type SlotState,
  type StepDirection, type TooltipModel, type View,
} from '../core/contracts';
import type { Messages } from '../public';
import { clamp, position } from '../scene/geometry';
import { axisScaleOf } from './scale-ref';
import { barBoxAt, buildBarSlotLayout, xSlotPixel } from './bar-geom';
import type { CartesianStateRef } from './meta';
import {
  MEDIAN_WIDTH, RANGE_STROKE_WIDTH, WHISKER_WIDTH, boxHalfWidth, carrierReadout, intervalText, isCompoundKind, isLogSeries, markOf, partIndex, physicalOf, projectCompound, type CompoundSink, type LogicalKind, type PartRole,
} from './boxplot';
import { cartesianStacks, drawnValue, stackTotalText } from './stacks';
import { incomplete } from '../lookup/text';
import { lowerBound } from '../data/search';
import { MARKER_POLYGONS } from '../render/geometry';
import { sameRef } from '../core/focus';
import { repeatsIn, repeatsOf, valueAtRow, valuesText, visitRepeats } from './repeats';

const LINE_HIT_RADIUS = 12;
const POINT_HIT_RADIUS = 24;
const HIT_SLACK = 3;
const TOOLTIP_LIMIT = 8;
// Literal constants keep top-level pure so `import 'axylo/cartesian'` bundles to 0 raw bytes.
const CELL_PAD = 24.001;
const LEAF_SIZE = 16;

const pointBox = (x: number, y: number): Rect => ({ x: x - 5, y: y - 5, width: 10, height: 10 });
const grow = <T extends Float64Array | Int32Array | Uint32Array | Uint8Array>(a: T, n: number): T => {
  const b = new (a.constructor as new (n: number) => T)(n);
  b.set(a as never);
  return b;
};
const spanDist = (p: number, lo: number, hi: number) => p < lo ? lo - p : p > hi ? p - hi : 0;
// Monotone in each argument (every step is one correctly rounded operation), unlike Math.hypot: a box's bound
// is then never above the distance of anything inside it, so equal bounds can prune ties exactly.
const distOf = (gx: number, gy: number) => gx === 0 || gy === 0 ? gx + gy : Math.sqrt(gx * gx + gy * gy);

/**
 * Distance from (qx, qy), a point of the plot, to the part of a marker the plot shows: a circle of diameter
 * `size`, or `poly` scaled by `size`, both clipped to [x0, x1] × [y0, y1] as the scene's clip paints them.
 * Infinity when the clip hides all of it. With q inside the plot, the nearest painted point lies on the
 * marker's own outline, so only the outline's visible part is measured.
 */
function markerDistance(
  qx: number, qy: number, cx: number, cy: number, poly: Float64Array | null, size: number,
  x0: number, y0: number, x1: number, y1: number,
): number {
  let best = Infinity, inside = false;
  const near = (px: number, py: number) => { best = Math.min(best, Math.hypot(px - qx, py - qy)); };
  if (!poly) {
    const r = size / 2, dx = qx - cx, dy = qy - cy, d = Math.hypot(dx, dy), nx = cx + dx * r / d, ny = cy + dy * r / d;
    if (d <= r) return 0;
    if (nx >= x0 && nx <= x1 && ny >= y0 && ny <= y1) return d - r;
    // Otherwise the nearest visible part of the circle ends where it crosses the plot's edge.
    for (let k = 0; k < 8; k++) {
      const vertical = k < 4, e = vertical ? (k & 1 ? x1 : x0) : (k & 1 ? y1 : y0);
      const h = Math.sqrt(r * r - (vertical ? e - cx : e - cy) ** 2) * (k & 2 ? 1 : -1), t = (vertical ? cy : cx) + h;
      if (vertical ? t >= y0 && t <= y1 : t >= x0 && t <= x1) near(vertical ? e : t, vertical ? t : e);
    }
    return best;
  }
  for (let k = 0, n = poly.length, j = n - 2; k < n; j = k, k += 2) {
    const ax = cx + poly[j]! * size, ay = cy + poly[j + 1]! * size, ex = cx + poly[k]! * size - ax, ey = cy + poly[k + 1]! * size - ay;
    if ((ay > qy) !== (ay + ey > qy) && qx < ax + (qy - ay) * ex / ey) inside = !inside;
    // The edge's visible part (Liang–Barsky), then the nearest point of that part.
    let t0 = 0, t1 = 1;
    for (let c = 0; c < 4; c++) {
      const p = (c & 1 ? 1 : -1) * (c < 2 ? ex : ey), q = c < 2 ? (c & 1 ? x1 - ax : ax - x0) : (c & 1 ? y1 - ay : ay - y0);
      if (p) { if (p < 0) t0 = Math.max(t0, q / p); else t1 = Math.min(t1, q / p); } else if (q < 0) t0 = 2;
    }
    const t = Math.min(t1, Math.max(t0, ((qx - ax) * ex + (qy - ay) * ey) / (ex * ex + ey * ey || 1)));
    if (t0 <= t1) near(ax + t * ex, ay + t * ey);
  }
  return inside ? 0 : best;
}

/** Mirrors slotIndex -> step -1 -> step +1, then visible series order, then CSR outlier order on exact distance ties. */
function afterInScan(
  slotA: number, seriesA: number, ordA: number,
  slotB: number, seriesB: number, ordB: number,
  slotIndex: number,
): boolean {
  const groupA = slotA === slotIndex ? 0 : slotA < slotIndex ? 1 : 2;
  const groupB = slotB === slotIndex ? 0 : slotB < slotIndex ? 1 : 2;
  if (groupA !== groupB) return groupA > groupB;
  if (slotA !== slotB) return groupA === 1 ? slotA < slotB : slotA > slotB;
  if (seriesA !== seriesB) return seriesA > seriesB;
  return ordA > ordB;
}

/** True when a subtree with slot/order bounds [minSlot, maxSlot, maxOrd] can beat (bestSlot, bestOrd) on an exact tie. */
function canBeatOnTie(
  minSlot: number, maxSlot: number, maxOrd: number,
  bestSlot: number, bestOrd: number, slotIndex: number,
): boolean {
  if (bestSlot > slotIndex) return maxSlot > slotIndex && maxOrd > bestOrd;
  if (bestSlot < slotIndex) {
    if (maxSlot > slotIndex) return true;
    return minSlot < bestSlot || (minSlot === bestSlot && maxOrd > bestOrd);
  }
  return minSlot < slotIndex || maxSlot > slotIndex || maxOrd > bestOrd;
}

/** Partition order[lo..hi) in place so order[target] holds the median coordinate (O(n) average, 3-way handles duplicates). */
function nthElement(order: Uint32Array, coords: Float64Array, lo: number, hi: number, target: number): void {
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    const r = hi - 1;
    const va = coords[order[lo]!]!, vb = coords[order[mid]!]!, vc = coords[order[r]!]!;
    const pivot = va <= vb ? (vb <= vc ? vb : va <= vc ? vc : va) : (va <= vc ? va : vb <= vc ? vc : vb);
    let lt = lo, i = lo, gt = r;
    while (i <= gt) {
      const v = coords[order[i]!]!;
      if (v < pivot) { const t = order[lt]!; order[lt++] = order[i]!; order[i++] = t; }
      else if (v > pivot) { const t = order[i]!; order[i] = order[gt]!; order[gt--] = t; }
      else i++;
    }
    if (target < lt) hi = lt;
    else if (target > gt) lo = gt + 1;
    else break;
  }
}

interface Bvh {
  nb: Float64Array;
  ni: Int32Array;
  build(lo: number, hi: number): number;
}

/** Shared flat typed-array BVH builder with spatial axis choice, skew peeling, and nthElement fallback. */
function createBvh(
  xLo: Float64Array, xHi: Float64Array, yLo: Float64Array, yHi: Float64Array,
  pxs: Float64Array, splitY: Float64Array, slots: Int32Array, order: Uint32Array,
  repFirst: Int32Array | null,
): Bvh {
  let cap = Math.min(Math.max(16, order.length), 256), count = 0;
  let nb = new Float64Array(cap * 6), ni = new Int32Array(cap * 5);
  const bvh: Bvh = {
    nb, ni,
    build(lo: number, hi: number): number {
      const node = (s: number, e: number, allowSkew: boolean): number => {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        let minPx = Infinity, maxPx = -Infinity, minSy = Infinity, maxSy = -Infinity;
        let minSlot = 0x7fffffff, maxSlot = -1;
        let aux = -1;
        for (let i = s; i < e; i++) {
          const k = order[i]!, xl = xLo[k]!, xh = xHi[k]!, yl = yLo[k]!, yh = yHi[k]!;
          const px = pxs[k]!, sy = splitY[k]!;
          if (xl < minX) minX = xl;
          if (xh > maxX) maxX = xh;
          if (yl < minY) minY = yl;
          if (yh > maxY) maxY = yh;
          if (px < minPx) minPx = px;
          if (px > maxPx) maxPx = px;
          if (sy < minSy) minSy = sy;
          if (sy > maxSy) maxSy = sy;
          const f = repFirst ? repFirst[k]! : -1;
          const sLo = f >= 0 ? slots[f]! : slots[k]!, sHi = slots[k]!;
          if (sLo < minSlot) minSlot = sLo;
          if (sHi > maxSlot) maxSlot = sHi;
          if (k > aux) aux = k;
        }
        if (count === cap) {
          cap *= 2;
          nb = grow(nb, cap * 6); ni = grow(ni, cap * 5);
          bvh.nb = nb; bvh.ni = ni;
        }
        const n = count++, b = n * 6, t = n * 5;
        nb[b] = minX; nb[b + 1] = maxX; nb[b + 2] = minY; nb[b + 3] = maxY;
        nb[b + 4] = minPx; nb[b + 5] = maxPx;
        ni[t + 2] = minSlot; ni[t + 3] = maxSlot; ni[t + 4] = aux;
        const size = e - s;
        if (size <= LEAF_SIZE) { ni[t] = ~s; ni[t + 1] = e; return n; }
        const xSpan = maxPx - minPx, ySpan = maxSy - minSy;
        let mid = (s + e) >> 1;
        if (xSpan > 0 || ySpan > 0) {
          const byX = xSpan >= ySpan, coords = byX ? pxs : splitY;
          const pivot = byX ? minPx * 0.5 + maxPx * 0.5 : minSy * 0.5 + maxSy * 0.5;
          let pMid = s;
          for (let i = s; i < e; i++) {
            const p = order[i]!;
            if (coords[p]! < pivot) { order[i] = order[pMid]!; order[pMid++] = p; }
          }
          const smaller = Math.min(pMid - s, e - pMid);
          const useSkew = smaller < (size >> 2) && allowSkew && smaller >= 1;
          if (useSkew || smaller >= (size >> 2)) mid = pMid;
          else nthElement(order, coords, s, e, mid);
          allowSkew = !useSkew;
        } else {
          allowSkew = true;
        }
        const l = node(s, mid, allowSkew);
        const r = node(mid, e, allowSkew);
        ni[t] = l;
        ni[t + 1] = r;
        return n;
      };
      return node(lo, hi, true);
    },
  };
  return bvh;
}

export function createCartesianLookup(
  stateRef: CartesianStateRef,
  rawView: View,
  rawLayout: Layout,
  formatters: Formatters,
  messages: Messages,
): Lookup {
  const view = rawView as AlignedView;
  const layout = rawLayout.kind === 'plot' ? rawLayout : null;
  const { meta } = stateRef;
  const { frame } = view;
  const { series } = frame;
  const vals = frame.x.values;
  const plot = layout?.plot ?? null;
  const plotRight = plot ? plot.x + plot.width : 0;
  const plotBottom = plot ? plot.y + plot.height : 0;
  const projection: Exclude<Projection, { kind: 'ring' }> | null = layout && layout.projection.kind !== 'ring' ? layout.projection : null;
  const xScale = projection ? (projection.kind === 'xy' ? projection.x : projection.band) : null;
  const stacks = cartesianStacks(view, meta);
  const start = view.visibleSlots.start;
  const end = view.visibleSlots.end;
  const count = Math.max(0, end - start);
  const physical = physicalOf(view);
  const marks = series.map(s => markOf(meta, s.field));
  const hasCompound = marks.some(m => m && isCompoundKind(m.kind));
  const boxHalf = hasCompound && projection ? boxHalfWidth(projection, vals, view.visibleSlots) : 0;

  const geometry = marks.map((m, i) => m && projection && plot
    ? projectCompound(m, physical, i, projection, plot, boxHalf) : null);

  const kindOf = (sIdx: number): LogicalKind => marks[sIdx]?.kind ?? meta.seriesByField.get(series[sIdx]!.field)?.mark ?? 'line';

  const visible: number[] = [];
  const barSeries: number[] = [];
  const lineVisIdx: number[] = [];
  const pointVisIdx: number[] = [];
  let hasCompoundVisible = false;
  let hasBoxOrErrVisible = false;
  for (let s = 0; s < series.length; s++) {
    if (view.visible[s] && series[s]!.drawable) {
      const vIdx = visible.length;
      visible.push(s);
      const kind = kindOf(s);
      if (kind === 'bar') barSeries.push(s);
      else if (kind === 'line') lineVisIdx.push(vIdx);
      else if (kind === 'scatter' || marks[s]?.outliers) pointVisIdx.push(vIdx);
      if (marks[s] && isCompoundKind(kind)) {
        hasCompoundVisible = true;
        if (kind !== 'range') hasBoxOrErrVisible = true;
      }
    }
  }
  const barLayout = buildBarSlotLayout(view, projection, plot, meta, barSeries);

  const isLog = (s: AlignedView['frame']['series'][number] | undefined) => isLogSeries(meta, s);
  const readout = carrierReadout(meta, physical, formatters, ' (not plotted)');
  const slotForX = (x: number) => {
    const i = lowerBound(vals, x, start, end);
    return i < end && vals[i] === x ? i : -1;
  };
  const seriesIndex = (key: string) => series.findIndex(s => s.key === key);
  const isPlottable = (sIdx: number, i: number) => {
    const s = series[sIdx]!;
    return s.slot[i] === SLOT_VALUE && (!isLog(s) || s.y[i]! > 0);
  };
  const xAt = (i: number) => xSlotPixel(xScale!, vals, i);

  // With `own`, the value of one row (a point ref's), read without the other rows its x repeats.
  const datumText = (sIdx: number, i: number, announce = false, own?: number): DatumText => {
    const s = series[sIdx]!;
    let state = s.slot[i]! as SlotState;
    let value: string;
    const mark = marks[sIdx], all = own === undefined ? valuesText(s, i, v => readout.value(sIdx, v)) : readout.value(sIdx, own);
    // A scatter x read as a whole lists every row there; a point ref reads its own row (pointText).
    if (all !== null) {
      value = all;
      state = SLOT_VALUE;
    } else if (mark && isCompoundKind(mark.kind)) {
      state = SLOT_VALUE;
      const at = (role: PartRole) => partIndex(mark, physical, sIdx, role);
      const read = (role: PartRole) => {
        const idx = at(role);
        const part = physical.frame.series[idx];
        if (role !== 'y' && part && state === SLOT_VALUE) state = part.slot[i]! as SlotState;
        return readout.cell(idx, i);
      };
      if (mark.kind === 'boxplot') {
        const median = read('median'), min = read('min'), q1 = read('q1'), q3 = read('q3'), max = read('max');
        if (state !== SLOT_VALUE) {
          value = formatters.missing(state);
        } else {
          const list = readout.outliers(at('median'), mark.outliers, i);
          value = `median ${median} (min ${min}, Q1 ${q1}, Q3 ${q3}, max ${max}; ${list === null ? 'no outliers' : `outliers ${list}`})`;
        }
      } else {
        value = intervalText(mark, read);
      }
    } else if (state === SLOT_VALUE) {
      value = readout.value(sIdx, s.y[i]!);
    } else {
      value = formatters.missing(state);
      if (announce && stacks.groupOf[sIdx]! >= 0) value = incomplete(value, messages);
    }
    const xVal = vals[i]!;
    return {
      ref: { kind: 'aligned', seriesKey: s.key, x: xVal },
      seriesIndex: sIdx, seriesLabel: s.label, x: formatters.x(xVal), value, state, percent: null,
      row: s.row?.[i] ?? i,
    };
  };

  /** A point ref's series, slot and exact value, or null when its row is not at a visible slot. */
  const pointAt = (ref: DatumRef): readonly [series: number, slot: number, y: number] | null => {
    if (ref.kind !== 'point') return null;
    const sIdx = seriesIndex(ref.seriesKey), i = slotForX(ref.x);
    const y = sIdx >= 0 && i >= 0 ? valueAtRow(series[sIdx]!, i, ref.row) : NaN;
    return Number.isNaN(y) ? null : [sIdx, i, y];
  };
  const pointText = (ref: DatumRef): DatumText | null => {
    const p = pointAt(ref);
    return p && { ...datumText(p[0], p[1], false, p[2]), ref, row: (ref as { row: number }).row };
  };

  const nearestSlot = (xPx: number) => {
    if (!xScale || !count) return -1;
    if (xScale.type === 'band') return clamp(Math.round(xScale.invert(xPx)), start, end - 1);
    const i = lowerBound(vals, xScale.invert(xPx), start, end);
    if (i <= start) return start;
    if (i >= end) return end - 1;
    return Math.abs(xAt(i - 1) - xPx) <= Math.abs(xAt(i) - xPx) ? i - 1 : i;
  };

  const compoundBox = (sIdx: number, i: number): Rect | null => {
    const g = geometry[sIdx], mark = marks[sIdx];
    if (!g || !mark || g.rows[i] !== SLOT_VALUE) return null;
    const px = xAt(i), top = g.top(i), bottom = g.bottom(i);
    const half = mark.kind === 'boxplot' ? Math.max(boxHalf, g.cap) : Math.max(4, mark.kind === 'errorBar' ? g.cap : 0);
    if (!Number.isFinite(px) || !Number.isFinite(top) || !Number.isFinite(bottom)) return null;
    return { x: px - half, y: Math.min(top, bottom), width: 2 * half, height: Math.max(1, Math.abs(bottom - top)) };
  };

  /** The nearest slot from k in direction step that is drawn, skipping SLOT_NO_ROW as the painted band does. */
  const drawnNeighbour = (rows: Uint8Array, k: number, step: number) => {
    while (k >= start && k < end && rows[k] === SLOT_NO_ROW) k += step;
    return k >= start && k < end && rows[k] === SLOT_VALUE ? k : -1;
  };

  /** Distance from (xPx, yPx) to a painted rectangle clipped to plot, or Infinity when wholly clipped or empty. */
  const rectDist = (x1: number, y1: number, x2: number, y2: number, xPx: number, yPx: number): number => {
    if (!plot) return Infinity;
    const cx1 = Math.max(x1, plot.x), cx2 = Math.min(x2, plotRight);
    const cy1 = Math.max(y1, plot.y), cy2 = Math.min(y2, plotBottom);
    if (!(cx2 > cx1 && cy2 > cy1)) return Infinity;
    return Math.hypot(spanDist(xPx, cx1, cx2), spanDist(yPx, cy1, cy2));
  };

  type SlotHit = readonly [slot: number, dist: number];
  type CompoundQuery = (xPx: number, yPx: number) => SlotHit | null;

  const buildCompoundQuery = (sIdx: number): CompoundQuery | null => {
    const m = marks[sIdx], g = geometry[sIdx];
    if (!m || !g || !plot || !count || (m.kind !== 'boxplot' && m.kind !== 'errorBar')) return null;
    const { rows, cap } = g;
    let maxSlots = 0;
    for (let j = start; j < end; j++) if (rows[j] === SLOT_VALUE) maxSlots++;
    if (!maxSlots) return null;

    const isBox = m.kind === 'boxplot';
    const halfMarker = halfOf(sIdx), markerSize = 2 * halfMarker;
    // The centre is painted as the series' marker (scene.ts pointMark): measure that shape, not a circle.
    const shape = view.cues[sIdx]?.marker ?? 'circle', poly = shape === 'circle' ? null : MARKER_POLYGONS[shape];
    // No marker polygon reaches past the unit square's corners (render/geometry.ts markerPolygons).
    const reach = poly ? markerSize * Math.SQRT1_2 : halfMarker;
    const xExtent = isBox ? Math.max(boxHalf, cap) : Math.max(cap, halfMarker, WHISKER_WIDTH / 2);

    // At most one primitive per part a slot paints: box, two whiskers, median and two caps; or whisker, centre and caps.
    const capLen = maxSlots * (isBox ? (cap > 0 ? 6 : 4) : (cap > 0 ? 4 : 2));
    let len = 0;
    const pX1 = new Float64Array(capLen), pX2 = new Float64Array(capLen);
    const pY1 = new Float64Array(capLen), pY2 = new Float64Array(capLen);
    const pMidY = new Float64Array(capLen), pPx = new Float64Array(capLen);
    const pSlot = new Int32Array(capLen);

    let curSlot = 0, curPx = 0, boxY1 = 0, boxY2 = 0, hasBox = false;
    const push = (cx1: number, cy1: number, cx2: number, cy2: number) => {
      pX1[len] = cx1; pX2[len] = cx2; pY1[len] = cy1; pY2[len] = cy2;
      pMidY[len] = cy1 * 0.5 + cy2 * 0.5; pPx[len] = curPx; pSlot[len] = curSlot;
      len++;
    };
    const pushRect = (x1: number, y1: number, x2: number, y2: number, isBoxRect?: boolean, isMed?: boolean) => {
      const cx1 = Math.max(x1, plot.x), cx2 = Math.min(x2, plotRight);
      const cy1 = Math.max(y1, plot.y), cy2 = Math.min(y2, plotBottom);
      if (!(cx2 > cx1 && cy2 > cy1)) return;
      if (isMed && hasBox && cy1 >= boxY1 && cy2 <= boxY2) return;
      if (isBoxRect) { boxY1 = cy1; boxY2 = cy2; hasBox = true; }
      push(cx1, cy1, cx2, cy2);
    };
    const collectSink: CompoundSink = {
      box(x, hw, y, h) { pushRect(x - hw, y, x + hw, y + h, true); },
      whisker(x1, y1, x2, y2) {
        if (x1 === x2) pushRect(x1 - WHISKER_WIDTH / 2, Math.min(y1, y2), x1 + WHISKER_WIDTH / 2, Math.max(y1, y2));
        else pushRect(x1, y1 - WHISKER_WIDTH / 2, x2, y1 + WHISKER_WIDTH / 2);
      },
      median(x1, x2, y) { pushRect(x1, y - MEDIAN_WIDTH / 2, x2, y + MEDIAN_WIDTH / 2, false, true); },
      // A centre marker is kept as its centre, a box no rectangle has (pushRect keeps only nonempty ones).
      point: !isBox && g.centre ? (x, y) => { if (inPlot(x, y, halfMarker)) push(x, y, x, y); } : undefined,
    };

    for (let j = start; j < end; j++) {
      if (rows[j] !== SLOT_VALUE) continue;
      const px = xAt(j);
      // Written as a negated test so a NaN or infinite position fails it too.
      if (!(px + xExtent >= plot.x && px - xExtent <= plotRight)) continue;
      curSlot = j; curPx = px; hasBox = false;
      g.visit(j, px, collectSink);
    }
    if (!len) return null;

    // Rectangles and centre markers get a tree each, so a node holding a marker holds only markers and may use
    // the tighter centre bound. The winner is the least (dist, dx, slot) whichever tree is searched first.
    const order = new Uint32Array(len);
    let rects = 0, back = len;
    for (let i = 0; i < len; i++) if (pX1[i] === pX2[i]) order[--back] = i; else order[rects++] = i;
    const bvh = createBvh(pX1, pX2, pY1, pY2, pPx, pMidY, pSlot, order, null);
    const rectRoot = rects ? bvh.build(0, rects) : -1, markerRoot = rects < len ? bvh.build(rects, len) : -1;
    const { nb, ni } = bvh;

    let qx = 0, qy = 0, bestSlot = -1, bestDist = Infinity, bestDx = Infinity, markers = false;
    /**
     * A lower bound on the distance of everything in [x1, x2] × [y1, y2]: for rectangles the box's own distance
     * (exact for one). For centre markers the box holds their centres: the bound is the larger of the distance
     * to their marker boxes and to the centres less the marker's reach, which keeps a diagonal pick on a cluster
     * of round centres from reaching every box corner nearer than the winning circle. One centre (a primitive,
     * or a node of coincident ones) is bounded by its painted marker's own distance, the value every primitive
     * there takes, so a node of coincident centres prunes on an exact tie.
     */
    const lowerOf = (x1: number, x2: number, y1: number, y2: number, markers: boolean): number => {
      const box = distOf(spanDist(qx, x1, x2), spanDist(qy, y1, y2));
      if (!markers) return box;
      // Circles on one row: the pointer is inside the plot, and each horizontal slice of a clipped disk is its
      // chord cut to the plot's span, so moving a centre toward the pointer's x keeps every slice and brings it no
      // further away, side edges included. The centre nearest the pointer bounds the row, less slack, as its flat
      // chord stretches make the tie a rounding question.
      // Circles centred on or past one horizontal edge are only seen on the plot's side of it, where a disk moved
      // outward at a fixed x shows a subset of what it showed: the most inward height stands for all of them.
      const cy = y1 === y2 ? y1 : poly ? NaN : y2 <= plot.y ? y2 : y1 >= plotBottom ? y1 : NaN;
      const row = cy === cy && (x1 === x2 || !poly);
      const at = row ? markerDistance(qx, qy, clamp(qx, x1, x2), cy, poly, markerSize, plot.x, plot.y, plotRight, plotBottom) : 0;
      if (__DEV__ && row) lastPickGeometry++;
      // The slack covers rounding in both distances, ~90 ulps of their size, not a fixed 1e-9 px, so centres a
      // fraction of that apart still prune. A polygon is measured from centre + offset vertices, which round
      // with the page coordinates' size, so its slack also scales with those.
      return Math.max(
        distOf(spanDist(qx, x1 - halfMarker, x2 + halfMarker), spanDist(qy, y1 - halfMarker, y2 + halfMarker)),
        box - reach - (box + reach + (poly ? qx + qy : 0) / 10) * 1e-14,
        x1 < x2 || y1 < y2 ? at - (at + reach + qx + qy) * 1e-14 : at,
      );
    };
    const nodeDist = (b: number, m = false) => lowerOf(nb[b]!, nb[b + 1]!, nb[b + 2]!, nb[b + 3]!, m);
    const nodeDx = (b: number) => spanDist(qx, nb[b + 4]!, nb[b + 5]!);
    const canBeat = (bound: number, minSlot: number, dxMin: number): boolean =>
      !(bound > Math.min(HIT_SLACK, bestDist) || (bound === bestDist && (dxMin > bestDx || (dxMin === bestDx && minSlot >= bestSlot))));
    const search = (n: number): void => {
      if (__DEV__) lastPickNodes++;
      const b = n * 6, t = n * 5;
      if (!canBeat(nodeDist(b, markers), ni[t + 2]!, nodeDx(b))) return;
      const left = ni[t]!;
      if (left < 0) {
        for (let k = ~left, hi = ni[t + 1]!; k < hi; k++) {
          const idx = order[k]!, px = pPx[idx]!, dx = Math.abs(px - qx), j = pSlot[idx]!;
          if (__DEV__ && !markers) lastPickGeometry++;
          // Exact for a rectangle or a marker, and never below the bound its nodes were pruned by (lowerOf is
          // monotone in the box), so a rounding step cannot let a marker undercut a pruned tie.
          const dist = lowerOf(pX1[idx]!, pX2[idx]!, pY1[idx]!, pY2[idx]!, markers);
          if (!canBeat(dist, j, dx)) continue;
          if (__DEV__) lastPickCandidates++;
          bestDist = dist; bestDx = dx; bestSlot = j;
        }
        return;
      }
      const right = ni[t + 1]!, lb = left * 6, rb = right * 6;
      const ld = nodeDist(lb), rd = nodeDist(rb);
      const ldx = nodeDx(lb), rdx = nodeDx(rb);
      const leftFirst = ld !== rd ? ld < rd : ldx !== rdx ? ldx < rdx : ni[left * 5 + 2]! <= ni[right * 5 + 2]!;
      search(leftFirst ? left : right);
      search(leftFirst ? right : left);
    };
    return (xPx: number, yPx: number) => {
      qx = xPx; qy = yPx; bestSlot = -1; bestDist = Infinity; bestDx = Infinity;
      const markersFirst = markerRoot >= 0 && (rectRoot < 0 || nodeDist(markerRoot * 6) < nodeDist(rectRoot * 6));
      for (let k = 0; k < 2; k++) {
        markers = markersFirst === !k;
        const root = markers ? markerRoot : rectRoot;
        if (root >= 0) search(root);
      }
      return bestSlot >= 0 ? [bestSlot, bestDist] : null;
    };
  };

  /** The slot and distance of the drawn compound geometry under/near the pointer, or null. */
  const compoundHit = (sIdx: number, i: number, xPx: number, yPx: number): SlotHit | null => {
    const mark = marks[sIdx];
    const g = geometry[sIdx];
    if (!mark || !plot || !g) return null;
    if (mark.kind !== 'range') return compoundQueries?.[sIdx]?.(xPx, yPx) ?? null;
    if (__DEV__) lastPickCandidates++;
    const { rows } = g;
    const bandDist = (l: number, r: number): number => {
      if (l < 0 || r < 0) return Infinity;
      const lx = xAt(l), rx = xAt(r);
      const x0 = Math.max(Math.min(lx, rx), plot.x), x1 = Math.min(Math.max(lx, rx), plotRight);
      if (!(x1 > x0)) return Infinity;
      const cx = clamp(xPx, x0, x1);
      const t = rx === lx ? 0 : clamp((cx - lx) / (rx - lx), 0, 1);
      const a = g.top(l), b = g.bottom(l);
      const yA = a + t * (g.top(r) - a), yB = b + t * (g.bottom(r) - b);
      return rectDist(x0, Math.min(yA, yB), x1, Math.max(yA, yB), xPx, yPx);
    };
    if (rows[i] === SLOT_NO_ROW) {
      // keep(bridge) paints across a slot with no row; it has no reading, so report the nearer drawn end.
      const l = drawnNeighbour(rows, i - 1, -1), r = drawnNeighbour(rows, i + 1, 1);
      const dist = bandDist(l, r);
      return dist <= HIT_SLACK ? [xPx - xAt(l) <= xAt(r) - xPx ? l : r, dist] : null;
    }
    if (rows[i] !== SLOT_VALUE) return null;
    const px = xAt(i), prev = drawnNeighbour(rows, i - 1, -1), next = drawnNeighbour(rows, i + 1, 1);
    // A lone row is painted as a 4 px butt-capped vertical stroke; endpoints fall back to their painted side.
    const t = g.top(i), b = g.bottom(i);
    const dist = prev < 0 && next < 0
      ? rectDist(px - RANGE_STROKE_WIDTH / 2, Math.min(t, b), px + RANGE_STROKE_WIDTH / 2, Math.max(t, b), xPx, yPx)
      : next < 0 || (xPx < px && prev >= 0) ? bandDist(prev, i) : bandDist(i, next);
    return dist <= HIT_SLACK ? [i, dist] : null;
  };

  // A glyph clipped entirely outside the plot is not on screen, so it cannot win a pick (half = rendered half extent).
  // The painted half size of a series' point marker, which pick, anchor and overlay agree a point is visible by.
  const halfOf = (sIdx: number) => (view.compact ? 3 : marks[sIdx]?.size ?? 4) / 2;
  const inPlot = (px: number, py: number, half: number) =>
    !!plot && px + half >= plot.x && px - half <= plotRight && py + half >= plot.y && py - half <= plotBottom;

  let lastPickedSeries = -1;
  let lastPickedSlot = -1;
  let lastPickedAt: Rect | null = null;
  let lastPickCandidates = 0;
  let lastPickNodes = 0;
  // Exact compound primitive distances measured (a rectangle at a leaf, a marker wherever its outline is measured).
  let lastPickGeometry = 0;
  // Entries the point index allocated room for (each of its five per-point typed arrays has this length).
  let pointCapacity = 0;

  /**
   * The point index, as a tuple (its fields are read once per pick): xs, ys, slots, seriesIdx, reps (index into
   * the series' repeated rows, cartesian/repeats.ts, -1 for the slot's own row), repFirst, order, root, nb, ni.
   */
  type PointIndex = readonly [
    Float64Array, Float64Array, Int32Array, Uint32Array, Int32Array, Int32Array | null, Uint32Array, number, Float64Array, Int32Array,
  ];

  const buildPointIndex = (): PointIndex | null => {
    if (!plot || !projection || !count || !pointVisIdx.length) return null;
    // A marker's half size is at most 12 px (options.ts caps size at 24), so a point inPlot keeps lies within CELL_PAD.
    const minX = plot.x - CELL_PAD, maxX = plotRight + CELL_PAD;
    // Room for every point there can be: each visible slot and repeated row of a scatter, each box outlier.
    let cap = 0, len = 0;
    for (const v of pointVisIdx) {
      const sIdx = visible[v]!;
      // Only the visible window's repeats, as the scene sizes its points: offscreen rows take no room.
      cap += kindOf(sIdx) === 'scatter' ? count + repeatsIn(repeatsOf(series[sIdx]), start, end) : marks[sIdx]?.outliers?.values.length ?? 0;
    }
    if (__DEV__) pointCapacity = cap;
    const xs = new Float64Array(cap), ys = new Float64Array(cap), slots = new Int32Array(cap);
    const seriesIdx = new Uint32Array(cap), reps = new Int32Array(cap);
    const pushPoint = (px: number, py: number, slot: number, sIdx: number, rep = -1) => {
      xs[len] = px; ys[len] = py; slots[len] = slot; seriesIdx[len] = sIdx; reps[len] = rep; len++;
    };

    let curPx = 0, curSeriesIdx = 0, curHalf = 0;
    let curPointY = (_v: number) => NaN;
    const addOutlier = (v: number, slot: number) => {
      const py = curPointY(v);
      if (inPlot(curPx, py, curHalf)) pushPoint(curPx, py, slot, curSeriesIdx);
    };

    const pLen = pointVisIdx.length;
    const pHalves = new Float64Array(pLen);
    const pScales = new Array<ReturnType<typeof axisScaleOf>>(pLen);
    for (let p = 0; p < pLen; p++) {
      const sIdx = visible[pointVisIdx[p]!]!;
      pScales[p] = axisScaleOf(projection, series[sIdx]!.axisIndex ?? 0);
      pHalves[p] = halfOf(sIdx);
    }

    // Traverse slots ascending, then visible series, then CSR outliers so index `k` encodes canonical tie order.
    for (let j = start; j < end; j++) {
      let px = NaN, pxReady = false;
      for (let p = 0; p < pLen; p++) {
        const sIdx = visible[pointVisIdx[p]!]!, s = series[sIdx]!, isScat = kindOf(sIdx) === 'scatter';
        const own = isScat && s.slot[j] === SLOT_VALUE && (!isLog(s) || s.y[j]! > 0), more = isScat ? repeatsOf(s) : null;
        if (isScat ? !own && !visitRepeats(more, j) : !(physical.rows?.[sIdx]?.[j] === SLOT_VALUE && geometry[sIdx]!.outliers(j) > 0)) continue;
        if (!pxReady) {
          px = xAt(j); pxReady = true;
          if (!(px >= minX && px <= maxX)) break;
        }
        if (isScat) {
          // Repeated rows follow the slot's own row, so a coincident later row wins a tie as the contract asks.
          for (let k = -1, b = more ? more.start[j + 1]! : 0; k < b; k = k < 0 && more ? more.start[j]! : k + 1) {
            const v = k < 0 ? (own ? s.y[j]! : NaN) : more!.y[k]!, py = isLog(s) && !(v > 0) ? NaN : position(pScales[p]!, v);
            if (inPlot(px, py, pHalves[p]!)) pushPoint(px, py, j, sIdx, k);
          }
        } else {
          curPx = px; curSeriesIdx = sIdx; curHalf = pHalves[p]!;
          curPointY = geometry[sIdx]!.pointY;
          geometry[sIdx]!.outliers(j, addOutlier);
        }
      }
    }
    if (len === 0) return null;

    // One tree over every point. Points arrive in slot order, so the sort mostly finds runs that are sorted.
    const order = new Uint32Array(len);
    for (let k = 0; k < len; k++) order[k] = k;
    order.sort((a, b) => (xs[a]! - xs[b]!) || (ys[a]! - ys[b]!) || (a - b));
    // Points at one position are one entry: the latest in scan order, or (repFirst) the earliest-slot one.
    // Within a group, entries are in scan order, so their slots never decrease.
    let repFirst: Int32Array | null = null, w = 0;
    for (let i = 0; i < len;) {
      const first = order[i]!, gx = xs[first]!, gy = ys[first]!, minS = slots[first]!;
      let lastMin = first;
      while (++i < len && xs[order[i]!] === gx && ys[order[i]!] === gy) if (slots[order[i]!] === minS) lastMin = order[i]!;
      const lastWinner = order[i - 1]!;
      if (minS < slots[lastWinner]!) (repFirst ??= new Int32Array(len).fill(-1))[lastWinner] = lastMin;
      order[w++] = lastWinner;
    }
    const bvh = createBvh(xs, xs, ys, ys, xs, ys, slots, order, repFirst);
    const root = bvh.build(0, w);
    return [xs, ys, slots, seriesIdx, reps, repFirst, order, root, bvh.nb, bvh.ni];
  };

  const pointIndex = buildPointIndex();
  const compoundQueries = hasBoxOrErrVisible
    ? series.map((_, s) => (view.visible[s] && series[s]!.drawable ? buildCompoundQuery(s) : null))
    : null;

  // The winner: its series and slot, the box it was drawn in (when known) and its repeated row (-1 its slot's own
  // row; none for marks that are not points).
  const pickPreferred = (slotIndex: number, xPx: number, yPx: number): readonly [series: number, slot: number, at?: Rect, rep?: number] => {
    const fallback = [visible[0] ?? -1, slotIndex] as const;
    if (!projection || !plot) return fallback;
    let bestDist = Infinity;
    let bestSlot = slotIndex;
    let bestSeries = -1;
    let bestOrd = -1;
    let bestX = 0;
    let bestY = 0;
    let bestRep = -2;

    if (lineVisIdx.length) {
      const slotPx = xAt(slotIndex);
      for (let i = 0; i < lineVisIdx.length; i++) {
        const sIdx = visible[lineVisIdx[i]!]!;
        if (!isPlottable(sIdx, slotIndex)) continue;
        const s = series[sIdx]!;
        const py = position(axisScaleOf(projection, s.axisIndex ?? 0), s.y[slotIndex]!);
        if (__DEV__) lastPickCandidates++;
        if (!inPlot(slotPx, py, 2)) continue;
        const dist = Math.abs(py - yPx);
        if (dist <= LINE_HIT_RADIUS + 1e-6 && dist <= bestDist) {
          bestDist = dist; bestSlot = slotIndex; bestSeries = sIdx; bestOrd = -1; bestX = slotPx; bestY = py; bestRep = -2;
        }
      }
    }

    if (pointIndex) {
      const [xs, ys, slots, seriesIdx, reps, repFirst, order, root, nb, ni] = pointIndex;

      const boxDist2 = (n: number): number => {
        const b = n * 6, dx = spanDist(xPx, nb[b]!, nb[b + 1]!), dy = spanDist(yPx, nb[b + 2]!, nb[b + 3]!);
        return dx * dx + dy * dy;
      };

      const canVisitNode = (n: number, d2: number): boolean => {
        const maxR = bestSeries < 0 ? CELL_PAD : bestDist;
        const hi = maxR + 1e-9;
        if (d2 > hi * hi) return false;
        if (bestSeries < 0) return true;
        const b = n * 6, t = n * 5;
        const dx = spanDist(xPx, nb[b]!, nb[b + 1]!), dy = spanDist(yPx, nb[b + 2]!, nb[b + 3]!);
        const boxDist = Math.hypot(dx, dy);
        if (boxDist > maxR) return false;
        if (boxDist < bestDist) return true;
        return canBeatOnTie(ni[t + 2]!, ni[t + 3]!, ni[t + 4]!, bestSlot, bestOrd, slotIndex);
      };

      const preferFirst = (a: number, b: number): boolean => {
        const ta = a * 5, tb = b * 5;
        const aG2 = ni[ta + 3]! > slotIndex, bG2 = ni[tb + 3]! > slotIndex;
        if (aG2 !== bG2) return aG2;
        if (aG2) return ni[ta + 4]! >= ni[tb + 4]!;
        const aG1 = ni[ta + 2]! < slotIndex, bG1 = ni[tb + 2]! < slotIndex;
        if (aG1 !== bG1) return aG1;
        if (aG1) return ni[ta + 2]! <= ni[tb + 2]!;
        return ni[ta + 4]! >= ni[tb + 4]!;
      };

      const checkRep = (k: number) => {
        const f = repFirst ? repFirst[k]! : -1;
        const chosen = f >= 0 && slots[k]! <= slotIndex && slots[f]! < slotIndex ? f : k;
        if (__DEV__) lastPickCandidates++;
        const px = xs[chosen]!, py = ys[chosen]!;
        const dist = Math.hypot(px - xPx, py - yPx);
        if (dist <= POINT_HIT_RADIUS + 1e-6 && (
          dist < bestDist
          || (dist === bestDist && (bestSeries < 0 || afterInScan(slots[chosen]!, seriesIdx[chosen]!, chosen, bestSlot, bestSeries, bestOrd, slotIndex)))
        )) {
          bestDist = dist; bestSlot = slots[chosen]!; bestSeries = seriesIdx[chosen]!; bestOrd = chosen; bestX = px; bestY = py; bestRep = reps[chosen]!;
        }
      };

      const search = (n: number): void => {
        const t = n * 5, left = ni[t]!;
        if (left < 0) {
          const lo = ~left, hi = ni[t + 1]!;
          for (let i = lo; i < hi; i++) checkRep(order[i]!);
          return;
        }
        const right = ni[t + 1]!;
        const ld2 = boxDist2(left), rd2 = boxDist2(right);
        const first = ld2 < rd2 || (ld2 === rd2 && preferFirst(left, right));
        const a = first ? left : right, b = first ? right : left, ad = first ? ld2 : rd2, bd = first ? rd2 : ld2;
        if (__DEV__) lastPickNodes++;
        if (canVisitNode(a, ad)) search(a);
        if (__DEV__) lastPickNodes++;
        if (canVisitNode(b, bd)) search(b);
      };

      if (__DEV__) lastPickNodes++;
      const d2 = boxDist2(root);
      if (canVisitNode(root, d2)) search(root);
    }

    if (bestSeries >= 0) return [bestSeries, bestSlot, pointBox(bestX, bestY), bestRep];

    let fuzzyBar = -1;
    for (let k = barSeries.length - 1; k >= 0; k--) {
      const sIdx = barSeries[k]!;
      if (__DEV__) lastPickCandidates++;
      const box = barBoxAt(view, projection, plot, barLayout, sIdx, slotIndex);
      if (!box) continue;
      if (xPx >= box.x && xPx <= box.x + box.width && yPx >= box.y && yPx <= box.y + box.height) return [sIdx, slotIndex, box];
      if (fuzzyBar < 0 && xPx >= box.x - 1 && xPx <= box.x + box.width + 1 && yPx >= box.y - 2 && yPx <= box.y + box.height + 2) fuzzyBar = sIdx;
    }
    if (fuzzyBar >= 0) return [fuzzyBar, slotIndex];

    if (hasCompoundVisible) {
      let bestCompound: readonly [number, number] | null = null, bestCompoundDist = Infinity;
      for (let k = visible.length - 1; k >= 0; k--) {
        const sIdx = visible[k]!;
        const hit = compoundHit(sIdx, slotIndex, xPx, yPx);
        if (!hit) continue;
        if (hit[1] === 0) return [sIdx, hit[0]];
        if (hit[1] < bestCompoundDist) { bestCompound = [sIdx, hit[0]]; bestCompoundDist = hit[1]; }
      }
      if (bestCompound) return bestCompound;
    }
    return fallback;
  };

  const lookup: Lookup = {
    count,
    pick(x: number, y: number): PickTarget | null {
      if (__DEV__) { lastPickCandidates = 0; lastPickNodes = 0; lastPickGeometry = 0; }
      if (!plot || !count || !visible.length) return null;
      if (x < plot.x || x > plotRight || y < plot.y || y > plotBottom) return null;
      const nearest = nearestSlot(x);
      if (nearest < 0) return null;
      const [hitSeries, slot, at = null, rep = -2] = pickPreferred(nearest, x, y);
      lastPickedSlot = slot;
      lastPickedSeries = hitSeries;
      lastPickedAt = at;
      const s = series[hitSeries], more = rep > -2 ? repeatsOf(s) : null;
      if (more && visitRepeats(more, slot)) {
        // Rows that share this x are told apart by row: the pick names the one under the pointer.
        const row = rep >= 0 ? more.row[rep]! : s!.row?.[slot] ?? slot;
        return { kind: 'point', refs: [{ kind: 'point', seriesKey: s!.key, row, x: vals[slot]! }], count: 1 };
      }
      return { kind: 'x', x: vals[slot]! };
    },
    members(target: PickTarget, from: number, n: number): readonly DatumRef[] {
      if (target.kind === 'point') return target.refs.slice(Math.max(0, from), Math.max(0, from + n));
      if (target.kind !== 'x' || n <= 0 || slotForX(target.x) < 0) return [];
      const out: DatumRef[] = [];
      for (let k = Math.max(0, from), stop = Math.min(visible.length, from + n); k < stop; k++) {
        out.push({ kind: 'aligned', seriesKey: series[visible[k]!]!.key, x: target.x });
      }
      return out;
    },
    has(target: PickTarget, ref: DatumRef): boolean {
      if (target.kind === 'point') return target.refs.some(r => sameRef(r, ref));
      return target.kind === 'x' && ref.kind === 'aligned' && ref.x === target.x && !!lookup.resolve(ref);
    },
    slot: ref => ref.kind === 'slice' ? -1 : slotForX(ref.x),
    primary(target: PickTarget): DatumRef | null {
      if (target.kind === 'point') return target.refs[0] ?? null;
      if (target.kind !== 'x' || !visible.length) return null;
      const i = slotForX(target.x);
      if (i < 0) return null;
      const preferred = i === lastPickedSlot && lastPickedSeries >= 0 && visible.includes(lastPickedSeries) ? lastPickedSeries : visible[0]!;
      return { kind: 'aligned', seriesKey: series[preferred]!.key, x: target.x };
    },
    tooltip(target: PickTarget): TooltipModel {
      if (target.kind === 'point') {
        const rows = target.refs.slice(0, TOOLTIP_LIMIT).map(pointText).filter(r => r !== null);
        return { title: rows[0]?.x ?? '', rows, count: rows.length && target.count, total: null };
      }
      const i = target.kind === 'x' ? slotForX(target.x) : -1;
      if (i < 0) return { title: '', rows: [], count: 0, total: null };
      const rows: DatumText[] = [];
      for (let k = 0, shown = Math.min(visible.length, TOOLTIP_LIMIT); k < shown; k++) rows.push(datumText(visible[k]!, i));
      return { title: formatters.x((target as { x: number }).x), rows, count: visible.length, total: stackTotalText(view, stacks, i, formatters, messages) };
    },
    datum(ref: DatumRef): DatumText | null {
      if (ref.kind === 'point') return pointText(ref);
      if (ref.kind !== 'aligned') return null;
      const sIdx = seriesIndex(ref.seriesKey), i = slotForX(ref.x);
      return sIdx >= 0 && i >= 0 ? datumText(sIdx, i, true) : null;
    },
    anchor(ref: DatumRef): Rect | null {
      const p = pointAt(ref);
      if (ref.kind === 'slice' || (ref.kind === 'point' && !p) || !plot || !projection) return null;
      const sIdx = seriesIndex(ref.seriesKey), i = slotForX(ref.x);
      if (sIdx < 0 || i < 0 || !visible.includes(sIdx)) return null;
      if (!p) {
        if (lastPickedAt && sIdx === lastPickedSeries && i === lastPickedSlot) return lastPickedAt;
        const kind = kindOf(sIdx);
        if (kind === 'bar') return barBoxAt(view, projection, plot, barLayout, sIdx, i);
        if (isCompoundKind(kind)) {
          const box = compoundBox(sIdx, i);
          if (!box) return null;
          const y0 = clamp(box.y, plot.y, plotBottom), y1 = clamp(box.y + box.height, plot.y, plotBottom);
          return { x: box.x, y: y0, width: box.width, height: Math.max(1, y1 - y0) };
        }
        if (!isPlottable(sIdx, i)) return null;
      }
      const px = xAt(i), py = position(axisScaleOf(projection, series[sIdx]!.axisIndex ?? 0), p ? p[2] : drawnValue(view, stacks, sIdx, i));
      // inPlot's comparisons fail for a NaN or infinite position, so it also rejects those.
      if (!inPlot(px, py, p ? halfOf(sIdx) : 1)) return null;
      return pointBox(px, py);
    },
    resolve(ref: DatumRef): DatumRef | null {
      // A point whose row is gone or whose series is hidden: the x it was at, if that is still in view.
      if (ref.kind === 'point') return pointAt(ref) && visible.includes(seriesIndex(ref.seriesKey)) ? ref : lookup.primary({ kind: 'x', x: ref.x });
      if (ref.kind !== 'aligned') return null;
      const sIdx = seriesIndex(ref.seriesKey);
      return sIdx >= 0 && visible.includes(sIdx) && slotForX(ref.x) >= 0 ? ref : null;
    },
    ordinal(ref: DatumRef): number {
      return lookup.resolve(ref) ? slotForX((ref as { x: number }).x) - start : -1;
    },
    step(from: DatumRef | null, direction: StepDirection): DatumRef | null {
      if (!count || !visible.length) return null;
      // The keyboard moves by x: a point at a repeated x steps from its x in its series.
      if (from?.kind === 'point') from = { kind: 'aligned', seriesKey: from.seriesKey, x: from.x };
      if (!from) return { kind: 'aligned', seriesKey: series[visible[0]!]!.key, x: vals[start]! };
      if (!lookup.resolve(from) || from.kind !== 'aligned') return null;
      const sIdx = seriesIndex(from.seriesKey), at = slotForX(from.x);
      if (direction === 'series-next' || direction === 'series-previous') {
        const next = visible[visible.indexOf(sIdx) + (direction === 'series-next' ? 1 : -1)];
        return next === undefined ? null : { kind: 'aligned', seriesKey: series[next]!.key, x: from.x };
      }
      const page = Math.max(1, Math.round(count / 10));
      // A resolved `at` lies in [start, end), so clamping the moved slot matches each direction's own bound.
      const to = direction === 'first' ? start : direction === 'last' ? end - 1 : clamp(at + (
        direction === 'next' ? 1 : direction === 'previous' ? -1 : direction === 'page-next' ? page : direction === 'page-previous' ? -page : 0
      ), start, end - 1);
      return to === at ? null : { kind: 'aligned', seriesKey: series[sIdx]!.key, x: vals[to]! };
    },
  };
  // The exact value of a point ref, for the hover and select payload (core/controller-helpers.ts pointForDatum).
  (lookup as Lookup & { pointValue?: (ref: DatumRef) => number | null }).pointValue = ref => pointAt(ref)?.[2] ?? null;
  if (__DEV__) {
    Object.defineProperties(lookup, {
      lastPickCandidates: { get: () => lastPickCandidates },
      lastPickNodes: { get: () => lastPickNodes },
      lastPickGeometry: { get: () => lastPickGeometry },
      pointCapacity: { get: () => pointCapacity },
    });
  }
  return lookup;
}
