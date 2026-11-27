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

const LINE_HIT_RADIUS = 12;
const POINT_HIT_RADIUS = 24;
const HIT_SLACK = 3;
const TOOLTIP_LIMIT = 8;
const CELL = 16;
// Literal constants keep top-level pure so `import 'axylo/cartesian'` bundles to 0 raw bytes.
const CELL_PAD = 24.001;
const RADIUS_PAD2 = 576.048001; // 24.001²
const MAX_DENSE_CELLS = 65_536;
const LEAF_SIZE = 16;

const pointBox = (x: number, y: number): Rect => ({ x: x - 5, y: y - 5, width: 10, height: 10 });
const grow = <T extends Float64Array | Int32Array | Uint32Array | Uint8Array>(a: T, n: number): T => {
  const b = new (a.constructor as new (n: number) => T)(n);
  b.set(a as never);
  return b;
};
const spanDist = (p: number, lo: number, hi: number) => p < lo ? lo - p : p > hi ? p - hi : 0;

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

/** Last index in sorted slice order[lo..hi) where slots[order[i]] === minSlot. */
function lastWithSlot(order: Uint32Array, slots: Int32Array, lo: number, hi: number, minSlot: number): number {
  let l = lo, r = hi - 1;
  while (l < r) {
    const m = (l + r + 1) >> 1;
    if (slots[order[m]!]! <= minSlot) l = m;
    else r = m - 1;
  }
  return order[l]!;
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
  repFirst: Int32Array | null, isPt: Uint8Array | null,
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
        let aux = isPt ? 0 : -1;
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
          if (isPt) { if (isPt.length) aux |= isPt[k]!; }
          else if (k > aux) aux = k;
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

  const datumText = (sIdx: number, i: number, announce = false): DatumText => {
    const s = series[sIdx]!;
    let state = s.slot[i]! as SlotState;
    let value: string;
    const mark = marks[sIdx];
    if (mark && isCompoundKind(mark.kind)) {
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
      row: s.row ? s.row[i]! : i,
    };
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

  type CompoundQuery = (xPx: number, yPx: number) => { slot: number; dist: number } | null;

  const buildCompoundQuery = (sIdx: number): CompoundQuery | null => {
    const m = marks[sIdx], g = geometry[sIdx];
    if (!m || !g || !plot || !count || (m.kind !== 'boxplot' && m.kind !== 'errorBar')) return null;
    const { rows, cap } = g;
    let maxSlots = 0;
    for (let j = start; j < end; j++) if (rows[j] === SLOT_VALUE) maxSlots++;
    if (!maxSlots) return null;

    const isBox = m.kind === 'boxplot';
    const halfMarker = (view.compact ? 3 : m.size) / 2;
    const xExtent = isBox ? Math.max(boxHalf, cap) : Math.max(cap, halfMarker, WHISKER_WIDTH / 2);

    let capLen = Math.max(16, maxSlots * (isBox ? (cap > 0 ? 5 : 3) : (cap > 0 ? 3 : 2))), len = 0;
    let pX1 = new Float64Array(capLen), pX2 = new Float64Array(capLen);
    let pY1 = new Float64Array(capLen), pY2 = new Float64Array(capLen);
    let pMidY = new Float64Array(capLen), pPx = new Float64Array(capLen);
    let pSlot = new Int32Array(capLen);
    let pIsPt: Uint8Array | null = !isBox && g.centre ? new Uint8Array(capLen) : null;
    let pPtY: Float64Array | null = pIsPt ? new Float64Array(capLen) : null;

    let curSlot = 0, curPx = 0, boxY1 = 0, boxY2 = 0, hasBox = false;
    const push = (cx1: number, cy1: number, cx2: number, cy2: number, ptY?: number) => {
      if (len === capLen) {
        capLen *= 2;
        pX1 = grow(pX1, capLen); pX2 = grow(pX2, capLen);
        pY1 = grow(pY1, capLen); pY2 = grow(pY2, capLen);
        pMidY = grow(pMidY, capLen); pPx = grow(pPx, capLen);
        pSlot = grow(pSlot, capLen);
        if (pIsPt) pIsPt = grow(pIsPt, capLen);
        if (pPtY) pPtY = grow(pPtY, capLen);
      }
      pX1[len] = cx1; pX2[len] = cx2; pY1[len] = cy1; pY2[len] = cy2;
      pMidY[len] = cy1 * 0.5 + cy2 * 0.5; pPx[len] = curPx; pSlot[len] = curSlot;
      if (ptY !== undefined) { pIsPt![len] = 1; pPtY![len] = ptY; }
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
      point: pIsPt ? (x, y) => {
        if (Number.isFinite(y) && inPlot(x, y, halfMarker)) push(x - halfMarker, y - halfMarker, x + halfMarker, y + halfMarker, y);
      } : undefined,
    };

    for (let j = start; j < end; j++) {
      if (rows[j] !== SLOT_VALUE) continue;
      const px = xAt(j);
      if (!Number.isFinite(px) || px + xExtent < plot.x || px - xExtent > plotRight) continue;
      curSlot = j; curPx = px; hasBox = false;
      g.visit(j, px, collectSink);
    }
    if (!len) return null;

    const order = new Uint32Array(len);
    for (let i = 0; i < len; i++) order[i] = i;
    const bvh = createBvh(pX1, pX2, pY1, pY2, pPx, pMidY, pSlot, order, null, pIsPt ?? new Uint8Array(0));
    bvh.build(0, len);
    const { nb, ni } = bvh;

    let qx = 0, qy = 0, bestSlot = -1, bestDist = Infinity, bestDx = Infinity;
    const distOf = (gx: number, gy: number) => gx === 0 || gy === 0 ? gx + gy : Math.hypot(gx, gy);
    const nodeDist = (b: number) => distOf(spanDist(qx, nb[b]!, nb[b + 1]!), spanDist(qy, nb[b + 2]!, nb[b + 3]!));
    const canBeat = (gx: number, gy: number, minSlot: number, hasPt: boolean, dxMin: number): number => {
      const distMin = distOf(gx, gy);
      const eps = (gx > 0 || gy > 0) && hasPt ? 1e-11 : bestDist > 0 && gx > 0 && gy > 0 ? 1e-12 : 0;
      if (distMin > Math.min(HIT_SLACK, bestDist) + eps) return -1;
      if (eps === 0 && (distMin > bestDist || (distMin === bestDist && (dxMin > bestDx || (dxMin === bestDx && minSlot >= bestSlot))))) return -1;
      return distMin;
    };
    const search = (n: number): void => {
      if (__DEV__) lastPickNodes++;
      const b = n * 6, t = n * 5;
      if (canBeat(spanDist(qx, nb[b]!, nb[b + 1]!), spanDist(qy, nb[b + 2]!, nb[b + 3]!), ni[t + 2]!, ni[t + 4]! !== 0, spanDist(qx, nb[b + 4]!, nb[b + 5]!)) < 0) return;
      const left = ni[t]!;
      if (left < 0) {
        for (let k = ~left, hi = ni[t + 1]!; k < hi; k++) {
          const idx = order[k]!, px = pPx[idx]!, dx = Math.abs(px - qx), j = pSlot[idx]!;
          const isPt = pIsPt ? pIsPt[idx]! !== 0 : false;
          const dMin = canBeat(spanDist(qx, pX1[idx]!, pX2[idx]!), spanDist(qy, pY1[idx]!, pY2[idx]!), j, isPt, dx);
          if (dMin < 0) continue;
          if (__DEV__) lastPickCandidates++;
          const dist = isPt ? Math.max(0, Math.hypot(qx - px, qy - pPtY![idx]!) - halfMarker) : dMin;
          if (dist <= HIT_SLACK && (dist < bestDist || (dist === bestDist && (dx < bestDx || (dx === bestDx && j < bestSlot))))) {
            bestDist = dist; bestDx = dx; bestSlot = j;
          }
        }
        return;
      }
      const right = ni[t + 1]!, lb = left * 6, rb = right * 6;
      const ld = nodeDist(lb), rd = nodeDist(rb);
      const ldx = spanDist(qx, nb[lb + 4]!, nb[lb + 5]!), rdx = spanDist(qx, nb[rb + 4]!, nb[rb + 5]!);
      const leftFirst = ld !== rd ? ld < rd : ldx !== rdx ? ldx < rdx : ni[left * 5 + 2]! <= ni[right * 5 + 2]!;
      search(leftFirst ? left : right);
      search(leftFirst ? right : left);
    };
    return (xPx: number, yPx: number) => {
      qx = xPx; qy = yPx; bestSlot = -1; bestDist = Infinity; bestDx = Infinity;
      search(0);
      return bestSlot >= 0 ? { slot: bestSlot, dist: bestDist } : null;
    };
  };

  /** The slot and distance of the drawn compound geometry under/near the pointer, or null. */
  const compoundHit = (sIdx: number, i: number, xPx: number, yPx: number): { slot: number; dist: number } | null => {
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
      return dist <= HIT_SLACK ? { slot: xPx - xAt(l) <= xAt(r) - xPx ? l : r, dist } : null;
    }
    if (rows[i] !== SLOT_VALUE) return null;
    const px = xAt(i), prev = drawnNeighbour(rows, i - 1, -1), next = drawnNeighbour(rows, i + 1, 1);
    // A lone row is painted as a 4 px butt-capped vertical stroke; endpoints fall back to their painted side.
    const t = g.top(i), b = g.bottom(i);
    const dist = prev < 0 && next < 0
      ? rectDist(px - RANGE_STROKE_WIDTH / 2, Math.min(t, b), px + RANGE_STROKE_WIDTH / 2, Math.max(t, b), xPx, yPx)
      : next < 0 || (xPx < px && prev >= 0) ? bandDist(prev, i) : bandDist(i, next);
    return dist <= HIT_SLACK ? { slot: i, dist } : null;
  };

  // A glyph clipped entirely outside the plot is not on screen, so it cannot win a pick (half = rendered half extent).
  const inPlot = (px: number, py: number, half: number) =>
    !!plot && px + half >= plot.x && px - half <= plotRight && py + half >= plot.y && py - half <= plotBottom;

  let lastPickedSeries = -1;
  let lastPickedSlot = -1;
  let lastPickedAt: Rect | null = null;
  let lastPickCandidates = 0;
  let lastPickNodes = 0;

  interface PointIndex {
    readonly xs: Float64Array;
    readonly ys: Float64Array;
    readonly slots: Int32Array;
    readonly seriesIdx: Uint32Array;
    readonly repFirst: Int32Array | null;
    readonly order: Uint32Array;
    readonly cols: number;
    readonly rows: number;
    readonly cellToDense: Map<number, number> | null;
    readonly roots: Int32Array;
    readonly nb: Float64Array;
    readonly ni: Int32Array;
    readonly candRoots: Int32Array;
    readonly candDist2: Float64Array;
  }

  const buildPointIndex = (): PointIndex | null => {
    if (!plot || !projection || !count || !pointVisIdx.length) return null;
    const minX = plot.x - CELL_PAD, maxX = plotRight + CELL_PAD;
    const minY = plot.y - CELL_PAD, maxY = plotBottom + CELL_PAD;
    let cap = 0, len = 0;
    let xs = new Float64Array(0);
    let ys = new Float64Array(0);
    let slots = new Int32Array(0);
    let seriesIdx = new Uint32Array(0);
    const pushPoint = (px: number, py: number, slot: number, sIdx: number) => {
      if (len === cap) {
        const nextCap = cap === 0 ? Math.min(Math.max(16, count), 4096) : cap * 2;
        xs = grow(xs, nextCap);
        ys = grow(ys, nextCap);
        slots = grow(slots, nextCap);
        seriesIdx = grow(seriesIdx, nextCap);
        cap = nextCap;
      }
      xs[len] = px; ys[len] = py; slots[len] = slot; seriesIdx[len] = sIdx; len++;
    };

    let curPx = 0, curSeriesIdx = 0, curHalf = 0;
    let curPointY = (_v: number) => NaN;
    const addOutlier = (v: number, slot: number) => {
      const py = curPointY(v);
      if (py >= minY && py <= maxY && inPlot(curPx, py, curHalf)) pushPoint(curPx, py, slot, curSeriesIdx);
    };
    const pLen = pointVisIdx.length;
    const pHalves = new Float64Array(pLen);
    const pScales = new Array<ReturnType<typeof axisScaleOf>>(pLen);
    for (let p = 0; p < pLen; p++) {
      const sIdx = visible[pointVisIdx[p]!]!;
      pScales[p] = axisScaleOf(projection, series[sIdx]!.axisIndex ?? 0);
      pHalves[p] = (view.compact ? 3 : marks[sIdx]?.size ?? 4) / 2;
    }

    // Traverse slots ascending, then visible series, then CSR outliers so index `k` encodes canonical tie order.
    for (let j = start; j < end; j++) {
      let px = NaN, pxReady = false;
      for (let p = 0; p < pLen; p++) {
        const sIdx = visible[pointVisIdx[p]!]!, s = series[sIdx]!, isScat = kindOf(sIdx) === 'scatter';
        if (isScat ? (s.slot[j] !== SLOT_VALUE || (isLog(s) && !(s.y[j]! > 0))) : !(physical.rows?.[sIdx]?.[j] === SLOT_VALUE && geometry[sIdx]!.outliers(j) > 0)) continue;
        if (!pxReady) {
          px = xAt(j); pxReady = true;
          if (!(px >= minX && px <= maxX)) break;
        }
        if (isScat) {
          const py = position(pScales[p]!, s.y[j]!);
          if (py >= minY && py <= maxY && inPlot(px, py, pHalves[p]!)) pushPoint(px, py, j, sIdx);
        } else {
          curPx = px; curSeriesIdx = sIdx; curHalf = pHalves[p]!;
          curPointY = geometry[sIdx]!.pointY;
          geometry[sIdx]!.outliers(j, addOutlier);
        }
      }
    }
    if (len === 0) return null;

    const cols = Math.max(1, Math.floor(plot.width / CELL) + 1);
    const rows = Math.max(1, Math.floor(plot.height / CELL) + 1);
    const gridSize = cols * rows;
    const useDenseGrid = gridSize <= MAX_DENSE_CELLS;
    const cellToDense = useDenseGrid ? null : new Map<number, number>();
    const cellOf = new Int32Array(len);
    const counts = new Int32Array(useDenseGrid ? gridSize : Math.min(gridSize, len));
    let numCells = useDenseGrid ? gridSize : 0;
    for (let k = 0; k < len; k++) {
      const c = clamp(Math.floor((xs[k]! - plot.x) / CELL), 0, cols - 1);
      const r = clamp(Math.floor((ys[k]! - plot.y) / CELL), 0, rows - 1);
      const rawCell = r * cols + c;
      let ci = rawCell;
      if (cellToDense) {
        let mapped = cellToDense.get(rawCell);
        if (mapped === undefined) { mapped = numCells++; cellToDense.set(rawCell, mapped); }
        ci = mapped;
      }
      cellOf[k] = ci;
      counts[ci] = counts[ci]! + 1;
    }

    const cursor = new Int32Array(numCells);
    for (let ci = 0, running = 0; ci < numCells; ci++) {
      cursor[ci] = running;
      running += counts[ci]!;
    }
    const order = new Uint32Array(len);
    for (let k = 0; k < len; k++) {
      const ci = cellOf[k]!;
      order[cursor[ci]!] = k;
      cursor[ci] = cursor[ci]! + 1;
    }

    const roots = new Int32Array(numCells).fill(-1);
    let repFirst: Int32Array | null = null;
    const recordGroup = (gStart: number, gEnd: number): number => {
      const lastWinner = order[gEnd - 1]!;
      if (gEnd - gStart > 1) {
        const minS = slots[order[gStart]!]!, maxS = slots[lastWinner]!;
        if (minS < maxS) {
          repFirst ??= new Int32Array(len).fill(-1);
          repFirst[lastWinner] = lastWithSlot(order, slots, gStart, gEnd, minS);
        }
      }
      return lastWinner;
    };

    const cmpY = (a: number, b: number) => (ys[a]! - ys[b]!) || (a - b);
    const cmpPos = (a: number, b: number) => (xs[a]! - xs[b]!) || cmpY(a, b);
    const dedupe = (lo: number, hi: number, w: number): number => {
      for (let i = lo; i < hi;) {
        const gStart = i++, first = order[gStart]!, gx = xs[first]!, gy = ys[first]!;
        while (i < hi && xs[order[i]!] === gx && ys[order[i]!] === gy) i++;
        order[w++] = recordGroup(gStart, i);
      }
      return w;
    };
    const bvh = createBvh(xs, xs, ys, ys, xs, ys, slots, order, repFirst, null);

    for (let ci = 0; ci < numCells; ci++) {
      const cnt = counts[ci]!;
      if (cnt === 0) continue;
      let cEnd = cursor[ci]!;
      const cStart = cEnd - cnt;
      if (cnt > LEAF_SIZE) {
        let xSorted = true, hasEqualX = false;
        for (let i = cStart + 1; i < cEnd; i++) {
          const dx = xs[order[i]!]! - xs[order[i - 1]!]!;
          if (dx < 0) { xSorted = false; break; }
          if (dx === 0) hasEqualX = true;
        }
        if (xSorted && hasEqualX) {
          let write = cStart;
          for (let i = cStart; i < cEnd;) {
            const rStart = i++, rx = xs[order[rStart]!]!;
            while (i < cEnd && xs[order[i]!]! === rx) i++;
            if (i - rStart === 1) {
              order[write++] = order[rStart]!;
            } else {
              const y0 = ys[order[rStart]!]!;
              let sameY = true;
              for (let j = rStart + 1; j < i; j++) if (ys[order[j]!]! !== y0) { sameY = false; break; }
              if (!sameY) order.subarray(rStart, i).sort(cmpY);
              write = dedupe(rStart, i, write);
            }
          }
          cEnd = write;
        } else if (!xSorted) {
          order.subarray(cStart, cEnd).sort(cmpPos);
          cEnd = dedupe(cStart, cEnd, cStart);
        }
      }
      roots[ci] = bvh.build(cStart, cEnd);
    }

    return {
      xs, ys, slots, seriesIdx, repFirst, order, cols, rows, cellToDense, roots,
      nb: bvh.nb, ni: bvh.ni, candRoots: new Int32Array(36), candDist2: new Float64Array(36),
    };
  };

  const pointIndex = buildPointIndex();
  const compoundQueries = hasBoxOrErrVisible
    ? series.map((_, s) => (view.visible[s] && series[s]!.drawable ? buildCompoundQuery(s) : null))
    : null;

  const pickPreferred = (slotIndex: number, xPx: number, yPx: number) => {
    const fallback = { series: visible[0] ?? -1, slot: slotIndex, at: null as Rect | null };
    if (!projection || !plot) return fallback;
    let bestDist = Infinity;
    let bestSlot = slotIndex;
    let bestSeries = -1;
    let bestOrd = -1;
    let bestX = 0;
    let bestY = 0;

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
          bestDist = dist; bestSlot = slotIndex; bestSeries = sIdx; bestOrd = -1; bestX = slotPx; bestY = py;
        }
      }
    }

    if (pointIndex) {
      const {
        xs, ys, slots, seriesIdx, repFirst, order, cols, rows, cellToDense, roots,
        nb, ni, candRoots, candDist2,
      } = pointIndex;

      const boxDist2 = (n: number): number => {
        const b = n * 6, dx = spanDist(xPx, nb[b]!, nb[b + 1]!), dy = spanDist(yPx, nb[b + 2]!, nb[b + 3]!);
        return dx * dx + dy * dy;
      };

      const canVisitNode = (n: number, d2: number): boolean => {
        const maxR = bestSeries < 0 ? CELL_PAD : bestDist;
        const hi = maxR + 1e-9;
        if (d2 > hi * hi) return false;
        if (bestSeries < 0) return true;
        const lo = maxR - 1e-9;
        if (lo > 0 && d2 < lo * lo) return true;
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
          bestDist = dist; bestSlot = slots[chosen]!; bestSeries = seriesIdx[chosen]!; bestOrd = chosen; bestX = px; bestY = py;
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

      const maxR = bestSeries < 0 ? CELL_PAD : Math.min(bestDist + 1e-9, CELL_PAD);
      const cMin = clamp(Math.floor((xPx - maxR - plot.x) / CELL), 0, cols - 1);
      const cMax = clamp(Math.floor((xPx + maxR - plot.x) / CELL), 0, cols - 1);
      const rMin = clamp(Math.floor((yPx - maxR - plot.y) / CELL), 0, rows - 1);
      const rMax = clamp(Math.floor((yPx + maxR - plot.y) / CELL), 0, rows - 1);
      let candCount = 0;
      for (let r = rMin; r <= rMax; r++) {
        for (let c = cMin; c <= cMax; c++) {
          const rawCell = r * cols + c;
          const ci = cellToDense ? (cellToDense.get(rawCell) ?? -1) : rawCell;
          if (ci < 0) continue;
          const root = roots[ci]!;
          if (root < 0) continue;
          if (__DEV__) lastPickNodes++;
          const d2 = boxDist2(root);
          if (d2 <= RADIUS_PAD2 && canVisitNode(root, d2)) {
            candRoots[candCount] = root;
            candDist2[candCount] = d2;
            candCount++;
          }
        }
      }
      for (let i = 1; i < candCount; i++) {
        const root = candRoots[i]!, d2 = candDist2[i]!;
        let j = i;
        while (j > 0 && (candDist2[j - 1]! > d2 || (candDist2[j - 1]! === d2 && preferFirst(root, candRoots[j - 1]!)))) {
          candRoots[j] = candRoots[j - 1]!;
          candDist2[j] = candDist2[j - 1]!;
          j--;
        }
        candRoots[j] = root;
        candDist2[j] = d2;
      }
      for (let i = 0; i < candCount; i++) {
        if (canVisitNode(candRoots[i]!, candDist2[i]!)) search(candRoots[i]!);
      }
    }

    if (bestSeries >= 0) return { series: bestSeries, slot: bestSlot, at: pointBox(bestX, bestY) };

    let fuzzyBar = -1;
    for (let k = barSeries.length - 1; k >= 0; k--) {
      const sIdx = barSeries[k]!;
      if (__DEV__) lastPickCandidates++;
      const box = barBoxAt(view, projection, plot, barLayout, sIdx, slotIndex);
      if (!box) continue;
      if (xPx >= box.x && xPx <= box.x + box.width && yPx >= box.y && yPx <= box.y + box.height) return { series: sIdx, slot: slotIndex, at: box };
      if (fuzzyBar < 0 && xPx >= box.x - 1 && xPx <= box.x + box.width + 1 && yPx >= box.y - 2 && yPx <= box.y + box.height + 2) fuzzyBar = sIdx;
    }
    if (fuzzyBar >= 0) return { series: fuzzyBar, slot: slotIndex, at: null };

    if (hasCompoundVisible) {
      let bestCompound: { series: number; slot: number; dist: number } | null = null;
      for (let k = visible.length - 1; k >= 0; k--) {
        const sIdx = visible[k]!;
        const hit = compoundHit(sIdx, slotIndex, xPx, yPx);
        if (!hit) continue;
        if (hit.dist === 0) return { series: sIdx, slot: hit.slot, at: null };
        if (!bestCompound || hit.dist < bestCompound.dist) bestCompound = { series: sIdx, slot: hit.slot, dist: hit.dist };
      }
      if (bestCompound) return { series: bestCompound.series, slot: bestCompound.slot, at: null };
    }
    return fallback;
  };

  const lookup: Lookup = {
    count,
    pick(x: number, y: number): PickTarget | null {
      if (__DEV__) { lastPickCandidates = 0; lastPickNodes = 0; }
      if (!plot || !count || !visible.length) return null;
      if (x < plot.x || x > plotRight || y < plot.y || y > plotBottom) return null;
      const nearest = nearestSlot(x);
      if (nearest < 0) return null;
      const hit = pickPreferred(nearest, x, y);
      lastPickedSlot = hit.slot;
      lastPickedSeries = hit.series;
      lastPickedAt = hit.at;
      return { kind: 'x', x: vals[hit.slot]! };
    },
    members(target: PickTarget, from: number, n: number): readonly DatumRef[] {
      if (target.kind !== 'x' || n <= 0 || slotForX(target.x) < 0) return [];
      const out: DatumRef[] = [];
      for (let k = Math.max(0, from), stop = Math.min(visible.length, from + n); k < stop; k++) {
        out.push({ kind: 'aligned', seriesKey: series[visible[k]!]!.key, x: target.x });
      }
      return out;
    },
    has(target: PickTarget, ref: DatumRef): boolean {
      return target.kind === 'x' && ref.kind === 'aligned' && ref.x === target.x && !!lookup.resolve(ref);
    },
    slot: ref => ref.kind === 'aligned' ? slotForX(ref.x) : -1,
    primary(target: PickTarget): DatumRef | null {
      if (target.kind !== 'x' || !visible.length) return null;
      const i = slotForX(target.x);
      if (i < 0) return null;
      const preferred = i === lastPickedSlot && lastPickedSeries >= 0 && visible.includes(lastPickedSeries) ? lastPickedSeries : visible[0]!;
      return { kind: 'aligned', seriesKey: series[preferred]!.key, x: target.x };
    },
    tooltip(target: PickTarget): TooltipModel {
      if (target.kind !== 'x') return { title: '', rows: [], count: 0, total: null };
      const i = slotForX(target.x);
      if (i < 0) return { title: '', rows: [], count: 0, total: null };
      const rows: DatumText[] = [];
      for (let k = 0, shown = Math.min(visible.length, TOOLTIP_LIMIT); k < shown; k++) rows.push(datumText(visible[k]!, i));
      return { title: formatters.x(target.x), rows, count: visible.length, total: stackTotalText(view, stacks, i, formatters, messages) };
    },
    datum(ref: DatumRef): DatumText | null {
      if (ref.kind !== 'aligned') return null;
      const sIdx = seriesIndex(ref.seriesKey), i = slotForX(ref.x);
      return sIdx >= 0 && i >= 0 ? datumText(sIdx, i, true) : null;
    },
    anchor(ref: DatumRef): Rect | null {
      if (ref.kind !== 'aligned' || !plot || !projection) return null;
      const sIdx = seriesIndex(ref.seriesKey), i = slotForX(ref.x);
      if (sIdx < 0 || i < 0 || !visible.includes(sIdx)) return null;
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
      const px = xAt(i), py = position(axisScaleOf(projection, series[sIdx]!.axisIndex ?? 0), drawnValue(view, stacks, sIdx, i));
      if (!Number.isFinite(px) || !Number.isFinite(py) || !inPlot(px, py, 1)) return null;
      return pointBox(px, py);
    },
    resolve(ref: DatumRef): DatumRef | null {
      if (ref.kind !== 'aligned') return null;
      const sIdx = seriesIndex(ref.seriesKey);
      return sIdx >= 0 && visible.includes(sIdx) && slotForX(ref.x) >= 0 ? ref : null;
    },
    ordinal(ref: DatumRef): number {
      return lookup.resolve(ref) ? slotForX((ref as { x: number }).x) - start : -1;
    },
    step(from: DatumRef | null, direction: StepDirection): DatumRef | null {
      if (!count || !visible.length) return null;
      if (!from) return { kind: 'aligned', seriesKey: series[visible[0]!]!.key, x: vals[start]! };
      if (!lookup.resolve(from) || from.kind !== 'aligned') return null;
      const sIdx = seriesIndex(from.seriesKey), at = slotForX(from.x);
      if (direction === 'series-next' || direction === 'series-previous') {
        const next = visible[visible.indexOf(sIdx) + (direction === 'series-next' ? 1 : -1)];
        return next === undefined ? null : { kind: 'aligned', seriesKey: series[next]!.key, x: from.x };
      }
      const page = Math.max(1, Math.round(count / 10));
      const to = direction === 'first' ? start
        : direction === 'last' ? end - 1
        : direction === 'next' ? Math.min(end - 1, at + 1)
        : direction === 'previous' ? Math.max(start, at - 1)
        : direction === 'page-next' ? Math.min(end - 1, at + page)
        : direction === 'page-previous' ? Math.max(start, at - page) : at;
      return to === at ? null : { kind: 'aligned', seriesKey: series[sIdx]!.key, x: vals[to]! };
    },
  };
  if (__DEV__) {
    Object.defineProperties(lookup, {
      lastPickCandidates: { get: () => lastPickCandidates },
      lastPickNodes: { get: () => lastPickNodes },
    });
  }
  return lookup;
}
