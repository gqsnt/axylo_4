/**
 * Shared bar & stacked-area geometry helper for `axylo/cartesian` (C4.4).
 * Consumed by BOTH `cartesian/scene.ts` and `cartesian/lookup.ts` so rendering and pointer hit-testing
 * always share identical x/y bar bounds for grouped AND stacked bars.
 */
import { SLOT_VALUE, type AlignedView, type Projection, type Rect, type XScale } from '../core/contracts';
import { clamp, position } from '../scene/geometry';
import { axisScaleOf } from './scale-ref';
import type { CartesianMeta } from './meta';

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
  for (let i = visibleStart + 1; i < visibleEnd; i++) {
    const gap = Math.abs(position(xScale, xValues[i]!) - position(xScale, xValues[i - 1]!));
    if (gap > 0 && gap < minGap) minGap = gap;
  }
  const base = Number.isFinite(minGap) ? minGap * 0.72 : (plotWidth / count) * 0.72;
  return clamp(base, 2, 48);
}

export interface BarSlotLayout {
  /** Number of horizontal grouped bar columns at each x-slot (stacked series sharing an axis share 1 lane). */
  readonly laneCount: number;
  /** Lane index per bar series index (`barSeriesIdx -> lane`). */
  readonly laneOf: ReadonlyMap<number, number>;
  /** For stacked bar series, ordered list of preceding stacked bar series on the same axis. */
  readonly stackPredecessors: ReadonlyMap<number, readonly number[]>;
}

export function buildBarSlotLayout(view: AlignedView, meta: CartesianMeta, barSeriesIndexes: readonly number[]): BarSlotLayout {
  const laneOf = new Map<number, number>();
  const stackLaneByAxis = new Map<number, number>();
  const stackGroupByAxis = new Map<number, number[]>();
  const stackPredecessors = new Map<number, readonly number[]>();
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
        stackGroupByAxis.set(axisIdx, []);
      }
      const prev = stackGroupByAxis.get(axisIdx)!;
      stackPredecessors.set(sIdx, prev.slice());
      prev.push(sIdx);
      laneOf.set(sIdx, lane);
    } else {
      laneOf.set(sIdx, laneCount++);
    }
  }
  return { laneCount: Math.max(1, laneCount), laneOf, stackPredecessors };
}

/** Computes the exact rendered CSS-pixel bar rectangle for `(sIdx, slotIndex)`, or `null` if missing. */
export function barBoxAt(
  view: AlignedView,
  projection: Projection,
  plot: Rect,
  barLayout: BarSlotLayout,
  sIdx: number,
  slotIndex: number,
): Rect | null {
  if (projection.kind === 'ring') return null;
  const series = view.frame.series[sIdx]!;
  if (series.slot[slotIndex] !== SLOT_VALUE) return null;
  const v = series.y[slotIndex]!;
  if (!Number.isFinite(v)) return null;

  const xScale = projection.kind === 'xy' ? projection.x : projection.band;
  const yScale = axisScaleOf(projection, series.axisIndex ?? 0);
  const { start, end } = view.visibleSlots;
  const xVals = view.frame.x.values;
  const groupW = slotBandwidth(xScale, xVals, start, end, plot.width);
  const laneW = Math.max(1, groupW / barLayout.laneCount);
  const lane = barLayout.laneOf.get(sIdx) ?? 0;

  let baseVal = 0;
  const preds = barLayout.stackPredecessors.get(sIdx);
  if (preds) {
    for (const pIdx of preds) {
      const ps = view.frame.series[pIdx]!;
      if (ps.slot[slotIndex] !== SLOT_VALUE) continue;
      const pv = ps.y[slotIndex]!;
      if (!Number.isFinite(pv)) continue;
      if (v >= 0 && pv >= 0) baseVal += pv;
      else if (v < 0 && pv < 0) baseVal += pv;
    }
  }
  const topVal = baseVal + v;
  const yBase = clamp(position(yScale, baseVal), plot.y, plot.y + plot.height);
  const yTop = clamp(position(yScale, topVal), plot.y, plot.y + plot.height);
  const cx = xSlotPixel(xScale, xVals, slotIndex);
  const bx = cx - groupW / 2 + lane * laneW;
  const width = Math.max(1, laneW - (barLayout.laneCount > 1 ? 1 : 0));
  const y = Math.min(yBase, yTop);
  const height = Math.max(1, Math.abs(yTop - yBase));
  return { x: bx, y, width, height };
}
