/**
 * Shared bar & stacked-area geometry helper for `axylo/cartesian` (C4.4).
 * Consumed by BOTH `cartesian/scene.ts` and `cartesian/lookup.ts` so rendering and pointer hit-testing
 * share identical x/y bar bounds for grouped AND stacked bars with O(N) precomputed bandwidth and
 * zero per-bar object allocation on the render path.
 */
import { SLOT_VALUE, type AlignedView, type Projection, type Rect, type XScale } from '../core/contracts';
import { clamp, position } from '../scene/geometry';
import { seriesSlots } from '../data/store-statistics';
import { axisScaleOf } from './scale-ref';
import type { CartesianMeta } from './meta';
import { cartesianStacks } from './stacks';

export function xSlotPixel(xScale: XScale, xValues: Float64Array, slotIndex: number): number {
  return position(xScale, xScale.type === 'band' ? slotIndex : xValues[slotIndex]!);
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
    if (gap > 0) {
      // A later positive gap can only lower the minimum. Once clamped, the answer is final.
      if (gap * 0.72 <= 2) return 2;
      minGap = Math.min(minGap, gap);
    }
    prev = curr;
  }
  return clamp((Number.isFinite(minGap) ? minGap : plotWidth / count) * 0.72, 2, 48);
}

interface BarSeriesGeometry {
  /** Only independent bars may be reduced at paint time. */
  readonly baseline: number | null;
  write(slot: number, out: Float32Array, offset: number): boolean;
}

export type BarSlotLayout = (series: number) => BarSeriesGeometry | undefined;

export function buildBarSlotLayout(
  view: AlignedView,
  projection: Projection | null,
  plot: Rect | null,
  meta: CartesianMeta,
  indexes: readonly number[],
): BarSlotLayout {
  const geometry: BarSeriesGeometry[] = [];
  if (!projection || projection.kind === 'ring' || !plot || !indexes.length) return () => undefined;
  const x = projection.kind === 'xy' ? projection.x : projection.band;
  const values = view.frame.x.values;
  const { start, end } = view.visibleSlots;
  const groupWidth = slotBandwidth(x, values, start, end, plot.width);
  const stacks = cartesianStacks(view, meta);
  const stackLanes: number[] = [];
  let lanes = 0;
  const laneOf: number[] = [];
  for (const s of indexes) {
    const group = stacks.groupOf[s]!;
    laneOf[s] = group < 0 ? lanes++ : (stackLanes[group] ??= lanes++);
  }
  const laneWidth = Math.max(1, groupWidth / lanes);
  const width = Math.max(1, laneWidth - +(lanes > 1)), half = groupWidth / 2;
  const top = plot.y, bottom = top + plot.height;
  return s => {
    const cached = geometry[s];
    if (cached) return cached;
    const lane = laneOf[s];
    if (lane === undefined) return;
    const series = view.frame.series[s]!, states = seriesSlots(series);
    const scale = axisScaleOf(projection, series.axisIndex);
    const yAt = (v: number) => clamp(position(scale, v), top, bottom);
    const baseline = yAt(0);
    const group = stacks.groups[stacks.groupOf[s]!];
    const prior = group ? group.order.indexOf(s) - 1 : -1;
    const positive = group?.positive[prior], negative = group?.negative[prior];
    const laneOffset = lane * laneWidth;
    return geometry[s] = {
      baseline: group ? null : baseline,
      write(i, out, offset) {
        const v = series.y[i]!;
        if ((states && states[i] !== SLOT_VALUE) || !Number.isFinite(v)) return false;
        const base = (v < 0 ? negative : positive)?.[i] ?? 0;
        const from = base === 0 ? baseline : yAt(base), to = yAt(base + v);
        // Keep the operation order shared by the scene and Float32 hit boxes.
        out[offset] = xSlotPixel(x, values, i) - half + laneOffset;
        out[offset + 1] = Math.min(from, to);
        out[offset + 2] = width;
        out[offset + 3] = Math.max(1, Math.abs(to - from));
        return true;
      },
    };
  };
}

let scratch: Float32Array | undefined;

export function writeBarRect(
  _view: AlignedView, projection: Projection, _plot: Rect, layout: BarSlotLayout, s: number, i: number,
  out: Float32Array, offset: number,
): boolean {
  return projection.kind !== 'ring' && !!layout(s)?.write(i, out, offset);
}

/** A lookup uses the very same writer and Float32 rounding as a painted slot. */
export function barBoxAt(
  view: AlignedView, projection: Projection, plot: Rect, layout: BarSlotLayout, s: number, i: number,
): Rect | null {
  const buf = scratch ??= new Float32Array(4);
  if (!writeBarRect(view, projection, plot, layout, s, i, buf, 0)) return null;
  return { x: buf[0]!, y: buf[1]!, width: buf[2]!, height: buf[3]! };
}
