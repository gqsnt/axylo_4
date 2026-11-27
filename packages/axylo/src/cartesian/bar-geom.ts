/**
 * Shared bar & stacked-area geometry helper for `axylo/cartesian` (C4.4).
 * Consumed by BOTH `cartesian/scene.ts` and `cartesian/lookup.ts` so rendering and pointer hit-testing
 * share identical x/y bar bounds for grouped AND stacked bars with O(N) precomputed bandwidth and
 * zero per-bar object allocation on the render path.
 */
import { SLOT_VALUE, type AlignedView, type Projection, type Rect, type XScale } from '../core/contracts';
import { clamp, position } from '../scene/geometry';
import { axisScaleOf } from './scale-ref';
import type { CartesianMeta } from './meta';
import { cartesianStacks, type CartesianStacks } from './stacks';

export function xSlotPixel(xScale: XScale, xValues: Float64Array, slotIndex: number): number {
  return xScale.type === 'band' ? xScale.center(slotIndex) : position(xScale, xValues[slotIndex]!);
}

export function slotBandwidth(
  xScale: XScale,
  xValues: Float64Array,
  visibleStart: number,
  visibleEnd: number,
  plotWidth: number,
): number {
  if (xScale.type === 'band') return Math.max(2, xScale.bandwidth);
  const count = Math.max(1, visibleEnd - visibleStart);
  if (count === 1) return Math.min(36, plotWidth * 0.4);
  let minGap = Infinity;
  let prev = position(xScale, xValues[visibleStart]!);
  for (let i = visibleStart + 1; i < visibleEnd; i++) {
    const curr = position(xScale, xValues[i]!);
    const gap = Math.abs(curr - prev);
    if (gap > 0 && gap < minGap) minGap = gap;
    prev = curr;
  }
  const base = Number.isFinite(minGap) ? minGap * 0.72 : (plotWidth / count) * 0.72;
  return clamp(base, 2, 48);
}

export interface BarSlotLayout {
  /** Number of horizontal grouped bar columns at each x-slot (stacked series sharing an axis share 1 lane). */
  readonly laneCount: number;
  /** Precomputed total group width in CSS pixels (computed once per layout, O(N) total). */
  readonly groupWidth: number;
  /** Precomputed lane width in CSS pixels. */
  readonly laneWidth: number;
  /** Precomputed drawn bar width in CSS pixels. */
  readonly barWidth: number;
  /** Lane index per bar series index (`barSeriesIdx -> lane`). */
  readonly laneOf: ReadonlyMap<number, number>;
  /** The chart's stacks (spec F10): a stacked bar starts where the cumulative total on its value's side ends. */
  readonly stacks: CartesianStacks;
}

export function buildBarSlotLayout(
  view: AlignedView,
  projection: Projection | null,
  plot: Rect | null,
  meta: CartesianMeta,
  barSeriesIndexes: readonly number[],
): BarSlotLayout {
  const laneOf = new Map<number, number>();
  const stackLaneByAxis = new Map<number, number>();
  let laneCount = 0;

  for (const sIdx of barSeriesIndexes) {
    const s = view.frame.series[sIdx]!;
    const spec = meta.seriesByField.get(s.field);
    const axisIdx = s.axisIndex ?? 0;
    if (spec?.stacked) {
      let lane = stackLaneByAxis.get(axisIdx);
      if (lane === undefined) {
        lane = laneCount++;
        stackLaneByAxis.set(axisIdx, lane);
      }
      laneOf.set(sIdx, lane);
    } else {
      laneOf.set(sIdx, laneCount++);
    }
  }
  const lanes = Math.max(1, laneCount);
  let groupWidth = 12;
  if (projection && plot && projection.kind !== 'ring' && barSeriesIndexes.length > 0) {
    const xScale = projection.kind === 'xy' ? projection.x : projection.band;
    const { start, end } = view.visibleSlots;
    groupWidth = slotBandwidth(xScale, view.frame.x.values, start, end, plot.width);
  }
  const laneWidth = Math.max(1, groupWidth / lanes);
  const barWidth = Math.max(1, laneWidth - +(lanes > 1));
  return { laneCount: lanes, groupWidth, laneWidth, barWidth, laneOf, stacks: cartesianStacks(view, meta) };
}

/**
 * Writes exact rendered CSS-pixel bar `(x, y, width, height)` for `(sIdx, slotIndex)` directly into
 * `out` starting at `offset` (zero object allocations). Returns `false` if slot is missing/non-finite.
 */
export function writeBarRect(
  view: AlignedView,
  projection: Projection,
  plot: Rect,
  barLayout: BarSlotLayout,
  sIdx: number,
  slotIndex: number,
  out: Float32Array,
  offset: number,
): boolean {
  if (projection.kind === 'ring') return false;
  const series = view.frame.series[sIdx]!;
  if (series.slot[slotIndex] !== SLOT_VALUE) return false;
  const v = series.y[slotIndex]!;
  if (!Number.isFinite(v)) return false;

  const xScale = projection.kind === 'xy' ? projection.x : projection.band;
  const yScale = axisScaleOf(projection, series.axisIndex ?? 0);
  const lane = barLayout.laneOf.get(sIdx) ?? 0;

  const { groups, groupOf } = barLayout.stacks;
  const group = groups[groupOf[sIdx] ?? -1];
  const k = group ? group.order.indexOf(sIdx) : -1;
  // Missing components add zero, so the earlier component's cumulative total on this side is the base.
  const baseVal = k > 0 ? (v >= 0 ? group!.positive : group!.negative)[k - 1]![slotIndex]! : 0;
  const topVal = baseVal + v;
  const yBase = clamp(position(yScale, baseVal), plot.y, plot.y + plot.height);
  const yTop = clamp(position(yScale, topVal), plot.y, plot.y + plot.height);
  const cx = xSlotPixel(xScale, view.frame.x.values, slotIndex);
  out[offset] = cx - barLayout.groupWidth / 2 + lane * barLayout.laneWidth;
  out[offset + 1] = Math.min(yBase, yTop);
  out[offset + 2] = barLayout.barWidth;
  out[offset + 3] = Math.max(1, Math.abs(yTop - yBase));
  return true;
}

let scratch: Float32Array | undefined;

/** Computes the exact rendered CSS-pixel bar rectangle for `(sIdx, slotIndex)`, or `null` if missing. */
export function barBoxAt(
  view: AlignedView,
  projection: Projection,
  plot: Rect,
  barLayout: BarSlotLayout,
  sIdx: number,
  slotIndex: number,
): Rect | null {
  const buf = scratch ??= new Float32Array(4);
  if (!writeBarRect(view, projection, plot, barLayout, sIdx, slotIndex, buf, 0)) return null;
  return { x: buf[0]!, y: buf[1]!, width: buf[2]!, height: buf[3]! };
}
