/**
 * Mixed-layer dual-axis scene builder for `axylo/cartesian` (C4.3, RFC §5.2).
 * Deterministic paint order:
 *   1. Reference bands + primary left-axis gridlines
 *   2. `bar` layers (grouped across visible bar series at each x-slot)
 *   3. `area` layers
 *   4. `line` layers (always topmost so trend lines stay unobstructed over bars)
 *   5. Axis spines, left/bottom/right ticks, and reference lines
 *
 * Uses `axisScaleOf(projection, s.axisIndex)` exclusively (single projection authority) and filters
 * `slot === SLOT_VALUE && (scale.type !== 'log' || y > 0)` BEFORE calling `position()` so `NaN`
 * never hits `±COORDINATE_LIMIT`.
 */
import {
  SLOT_NO_ROW, SLOT_VALUE, type AlignedView, type AreaMark, type ContinuousScale, type Layout,
  type Mark, type PathMark, type PointMark, type Projection, type Rect, type RectMark,
  type RuleMark, type Scene, type View, type XScale,
} from '../core/contracts';
import { boundaryPixel, clamp, position, rule, seriesPaint, token } from '../scene/geometry';
import { axisScaleOf } from './scale-ref';
import { buildBarSlotLayout, writeBarRect, xSlotPixel } from './bar-geom';
import { buildCartesianAnnotationMarks } from './annotations';
import type { CartesianMeta, CartesianStateRef } from './meta';

const TICK_LENGTH = 4;
const REFERENCE_DASH = [4, 3] as const;

function buildBarMarks(
  view: AlignedView,
  projection: Projection,
  plot: Rect,
  meta: CartesianMeta,
  barSeriesIndexes: readonly number[],
): RectMark[] {
  if (!barSeriesIndexes.length || projection.kind === 'ring') return [];
  const barLayout = buildBarSlotLayout(view, projection, plot, meta, barSeriesIndexes);
  const { start, end } = view.visibleSlots;
  const maxBars = Math.max(0, end - start);
  const marks: RectMark[] = [];

  for (const sIdx of barSeriesIndexes) {
    const buf = new Float32Array(maxBars * 4);
    let written = 0;
    for (let i = start; i < end; i++) {
      if (writeBarRect(view, projection, plot, barLayout, sIdx, i, buf, written)) {
        written += 4;
      }
    }
    if (written > 0) {
      marks.push({
        type: 'rects',
        series: sIdx,
        xywh: written === buf.length ? buf : buf.subarray(0, written),
        fill: seriesPaint(sIdx),
        variant: 'bar',
      });
    }
  }
  return marks;
}

function buildAreaMarks(
  view: AlignedView,
  projection: Projection,
  plot: Rect,
  meta: CartesianMeta,
  areaSeriesIndexes: readonly number[],
): { areas: AreaMark[]; strokes: PathMark[] } {
  const areas: AreaMark[] = [];
  const strokes: PathMark[] = [];
  if (!areaSeriesIndexes.length || projection.kind === 'ring') return { areas, strokes };
  const xScale = projection.kind === 'xy' ? projection.x : projection.band;
  const xVals = view.frame.x.values;
  const n = view.frame.length;
  const posStackByAxis = new Map<number, Float64Array>();
  const negStackByAxis = new Map<number, Float64Array>();

  for (const sIdx of areaSeriesIndexes) {
    const series = view.frame.series[sIdx]!;
    const spec = meta.seriesByField.get(series.field);
    const stacked = spec?.stacked === true;
    const axisIdx = series.axisIndex ?? 0;
    const yScale = axisScaleOf(projection, axisIdx);
    const yZero = clamp(position(yScale, 0), plot.y, plot.y + plot.height);
    const { start, end } = view.drawSlots[sIdx] ?? view.visibleSlots;

    let posAcc = posStackByAxis.get(axisIdx);
    let negAcc = negStackByAxis.get(axisIdx);
    if (stacked && !posAcc) {
      posAcc = new Float64Array(n);
      negAcc = new Float64Array(n);
      posStackByAxis.set(axisIdx, posAcc);
      negStackByAxis.set(axisIdx, negAcc);
    }

    const upperCoords: number[] = [];
    const lowerCoords: number[] = [];
    const runs: number[] = [];
    const strokeCoords: number[] = [];
    let runStart = -1;
    let runCount = 0;

    const flush = () => {
      if (runCount >= 2) runs.push(runStart, runCount, runStart, runCount);
      runStart = -1;
      runCount = 0;
    };

    for (let i = start; i < end; i++) {
      const st = series.slot[i]!;
      if (st === SLOT_NO_ROW && !stacked) continue;
      const v = st === SLOT_VALUE ? series.y[i]! : NaN;
      if (st !== SLOT_VALUE || !Number.isFinite(v)) {
        if (stacked && posAcc && negAcc) {
          // Stacked missing slot contributes 0 height while keeping cumulative baseline intact.
          const px = xSlotPixel(xScale, xVals, i);
          const py = clamp(position(yScale, posAcc[i]!), plot.y, plot.y + plot.height);
          if (runStart < 0) runStart = upperCoords.length / 2;
          upperCoords.push(px, py);
          lowerCoords.push(px, py);
          runCount++;
          if (strokeCoords.length && !Number.isNaN(strokeCoords[strokeCoords.length - 1]!)) strokeCoords.push(NaN, NaN);
          continue;
        }
        flush();
        if (strokeCoords.length && !Number.isNaN(strokeCoords[strokeCoords.length - 1]!)) {
          strokeCoords.push(NaN, NaN);
        }
        continue;
      }
      const px = xSlotPixel(xScale, xVals, i);
      let pyLow = yZero;
      let pyHigh: number;
      if (stacked && posAcc && negAcc) {
        const acc = v >= 0 ? posAcc : negAcc;
        const prev = acc[i]!;
        const next = prev + v;
        acc[i] = next;
        pyLow = clamp(position(yScale, prev), plot.y, plot.y + plot.height);
        pyHigh = clamp(position(yScale, next), plot.y, plot.y + plot.height);
      } else {
        pyHigh = position(yScale, v);
      }
      if (runStart < 0) runStart = upperCoords.length / 2;
      upperCoords.push(px, pyHigh);
      lowerCoords.push(px, pyLow);
      strokeCoords.push(px, pyHigh);
      runCount++;
    }
    flush();

    if (runs.length > 0) {
      areas.push({
        type: 'area',
        series: sIdx,
        upper: Float32Array.from(upperCoords),
        lower: Float32Array.from(lowerCoords),
        runs: Uint32Array.from(runs),
        fill: seriesPaint(sIdx),
        opacity: 0.22,
      });
    }
    if (strokeCoords.length >= 2) {
      strokes.push({
        type: 'path',
        series: sIdx,
        xy: Float32Array.from(strokeCoords),
        stroke: seriesPaint(sIdx),
        strokeWidth: 2,
        dash: view.cues[sIdx]?.dash ?? { normal: null, contrast: null },
      });
    }
  }
  return { areas, strokes };
}

function isPlottable(scale: ContinuousScale, slot: number, value: number): boolean {
  if (slot !== SLOT_VALUE || !Number.isFinite(value)) return false;
  return scale.type !== 'log' || value > 0;
}

function buildLineMarks(
  view: AlignedView,
  projection: Projection,
  lineSeriesIndexes: readonly number[],
  compact: boolean,
): { paths: PathMark[]; points: PointMark[] } {
  const paths: PathMark[] = [];
  const points: PointMark[] = [];
  if (!lineSeriesIndexes.length || projection.kind === 'ring') return { paths, points };
  const xScale = projection.kind === 'xy' ? projection.x : projection.band;
  const xVals = view.frame.x.values;

  for (const sIdx of lineSeriesIndexes) {
    const series = view.frame.series[sIdx]!;
    const yScale = axisScaleOf(projection, series.axisIndex ?? 0);
    const { start, end } = view.drawSlots[sIdx] ?? view.visibleSlots;
    const xy: number[] = [];
    const pts: number[] = [];
    let runLen = 0;
    let lastPx = NaN;
    let lastPy = NaN;

    const endRun = () => {
      if (runLen === 1 && Number.isFinite(lastPx) && Number.isFinite(lastPy)) {
        pts.push(lastPx, lastPy);
      }
      if (runLen > 0) xy.push(NaN, NaN);
      runLen = 0;
    };

    for (let i = start; i < end; i++) {
      const st = series.slot[i]!;
      if (st === SLOT_NO_ROW) continue;
      const v = series.y[i]!;
      // Filter y <= 0 BEFORE calling position() on log scales (RFC §4.4).
      if (!isPlottable(yScale, st, v)) {
        endRun();
        continue;
      }
      const px = xSlotPixel(xScale, xVals, i);
      const py = position(yScale, v);
      xy.push(px, py);
      lastPx = px;
      lastPy = py;
      runLen++;
    }
    if (runLen === 1 && Number.isFinite(lastPx) && Number.isFinite(lastPy)) {
      pts.push(lastPx, lastPy);
    } else if (!compact && runLen > 1 && Number.isFinite(lastPx) && Number.isFinite(lastPy)) {
      // Spec A5: shape marker at the last visible point of each line.
      pts.push(lastPx, lastPy);
    }

    if (xy.length >= 2) {
      paths.push({
        type: 'path',
        series: sIdx,
        xy: Float32Array.from(xy),
        stroke: seriesPaint(sIdx),
        strokeWidth: 2,
        dash: view.cues[sIdx]?.dash ?? { normal: null, contrast: null },
      });
    }
    if (pts.length >= 2) {
      points.push({
        type: 'points',
        series: sIdx,
        xy: Float32Array.from(pts),
        shape: view.cues[sIdx]?.marker ?? 'circle',
        size: compact ? 3 : 4,
        fill: seriesPaint(sIdx),
      });
    }
  }
  return { paths, points };
}

function buildIntervalMarks(
  view: AlignedView,
  projection: Exclude<Projection, { kind: 'ring' }>,
  meta: CartesianMeta,
  compact: boolean,
): { bands: AreaMark[]; strokes: PathMark[]; rules: RuleMark[]; points: PointMark[] } {
  const bands: AreaMark[] = [];
  const strokes: PathMark[] = [];
  const rules: RuleMark[] = [];
  const points: PointMark[] = [];
  if (!meta.intervals.length) return { bands, strokes, rules, points };

  const xScale = projection.kind === 'xy' ? projection.x : projection.band;
  const xVals = view.frame.x.values;
  const idxByField = new Map<string, number>();
  for (let i = 0; i < view.frame.series.length; i++) idxByField.set(view.frame.series[i]!.field, i);
  const { start, end } = view.visibleSlots;

  for (const iv of meta.intervals) {
    const lowIdx = idxByField.get(iv.lowField);
    const highIdx = idxByField.get(iv.highField);
    if (lowIdx === undefined || highIdx === undefined) continue;
    if (!view.visible[lowIdx] && !view.visible[highIdx]) continue;
    const lowS = view.frame.series[lowIdx]!;
    const highS = view.frame.series[highIdx]!;
    if (!lowS.drawable || !highS.drawable) continue;
    const centerIdx = iv.centerField ? idxByField.get(iv.centerField) : undefined;
    const centerS = centerIdx !== undefined && view.visible[centerIdx] ? view.frame.series[centerIdx] : undefined;
    const yScale = axisScaleOf(projection, iv.axisIndex);
    const paint = seriesPaint(centerIdx ?? lowIdx);

    if (iv.mark === 'range') {
      const upperCoords: number[] = [];
      const lowerCoords: number[] = [];
      const runs: number[] = [];
      let runStart = -1;
      let runCount = 0;
      const flush = () => {
        if (runCount >= 2) runs.push(runStart, runCount, runStart, runCount);
        runStart = -1;
        runCount = 0;
      };
      for (let i = start; i < end; i++) {
        const loSt = lowS.slot[i]!;
        const hiSt = highS.slot[i]!;
        if (loSt === SLOT_NO_ROW && hiSt === SLOT_NO_ROW) continue;
        const loV = lowS.y[i]!;
        const hiV = highS.y[i]!;
        if (!isPlottable(yScale, loSt, loV) || !isPlottable(yScale, hiSt, hiV)) {
          flush();
          continue;
        }
        const px = xSlotPixel(xScale, xVals, i);
        const a = Math.min(loV, hiV);
        const b = Math.max(loV, hiV);
        const pyHigh = position(yScale, b);
        const pyLow = position(yScale, a);
        if (runStart < 0) runStart = upperCoords.length / 2;
        upperCoords.push(px, pyHigh);
        lowerCoords.push(px, pyLow);
        runCount++;
      }
      flush();
      if (runs.length > 0) {
        bands.push({
          type: 'area',
          series: lowIdx,
          upper: Float32Array.from(upperCoords),
          lower: Float32Array.from(lowerCoords),
          runs: Uint32Array.from(runs),
          fill: paint,
          opacity: 0.22,
        });
      }
    } else {
      // errorBar: vertical whisker rule + horizontal end caps + optional center marker
      const halfCap = iv.capWidth / 2;
      const centerPts: number[] = [];
      for (let i = start; i < end; i++) {
        const loSt = lowS.slot[i]!;
        const hiSt = highS.slot[i]!;
        const loV = lowS.y[i]!;
        const hiV = highS.y[i]!;
        if (!isPlottable(yScale, loSt, loV) || !isPlottable(yScale, hiSt, hiV)) continue;
        const px = xSlotPixel(xScale, xVals, i);
        const pyA = position(yScale, Math.min(loV, hiV));
        const pyB = position(yScale, Math.max(loV, hiV));
        rules.push({ ...rule('reference', paint, px, pyB, px, pyA), strokeWidth: 1.5 });
        if (halfCap > 0) {
          rules.push({ ...rule('reference', paint, px - halfCap, pyA, px + halfCap, pyA), strokeWidth: 1.5 });
          rules.push({ ...rule('reference', paint, px - halfCap, pyB, px + halfCap, pyB), strokeWidth: 1.5 });
        }
        if (centerS && isPlottable(yScale, centerS.slot[i]!, centerS.y[i]!)) {
          centerPts.push(px, position(yScale, centerS.y[i]!));
        }
      }
      if (centerPts.length >= 2) {
        points.push({
          type: 'points',
          series: centerIdx ?? lowIdx,
          xy: Float32Array.from(centerPts),
          shape: view.cues[centerIdx ?? lowIdx]?.marker ?? 'circle',
          size: compact ? 3 : 4.5,
          fill: paint,
        });
      }
    }
  }
  return { bands, strokes, rules, points };
}

export function buildCartesianScene(
  stateRef: CartesianStateRef,
  view: View,
  layout: Layout,
  _devicePixelRatio: number,
): Scene {
  if ((layout.kind !== 'plot' && layout.kind !== 'compact') || view.kind === 'donut' || view.kind === 'scatter') {
    return { width: layout.width, height: layout.height, clip: { x: 0, y: 0, width: layout.width, height: layout.height }, marks: [] };
  }
  const { plot, projection } = layout;
  if (projection.kind === 'ring') {
    return { width: layout.width, height: layout.height, clip: plot, marks: [] };
  }

  const compact = layout.kind === 'compact' || view.compact;
  const marks: Mark[] = [];
  const edges: RuleMark[] = [];
  const refLines: RuleMark[] = [];
  const { meta } = stateRef;

  const xScale = projection.kind === 'xy' ? projection.x : projection.band;
  const leftScale = axisScaleOf(projection, 0);
  const left = plot.x;
  const right = plot.x + plot.width;
  const top = plot.y;
  const bottom = plot.y + plot.height;

  // 1. Reference bands & gridlines
  if (!compact && view.references.length) {
    const paint = token('reference');
    for (const ref of view.references) {
      if (ref.axis === 'x') {
        const a = xScale.type === 'band' ? xScale.center(ref.from) : position(xScale, ref.from);
        const b = xScale.type === 'band' ? xScale.center(ref.to) : position(xScale, ref.to);
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        const lo = clamp(Math.min(a, b), left, right);
        const hi = clamp(Math.max(a, b), left, right);
        if (ref.from === ref.to) {
          refLines.push({ ...rule('reference', paint, lo, top, lo, bottom), strokeWidth: 1.5, dash: REFERENCE_DASH });
        } else {
          marks.push({ type: 'band', box: { x: lo, y: top, width: Math.max(1, hi - lo), height: plot.height }, fill: paint, opacity: 0.12 });
        }
      } else {
        const axisSpec = meta.axisById.get(ref.axisId ?? meta.leftAxisId) ?? meta.axes[0]!;
        const yScale = axisScaleOf(projection, axisSpec.index);
        if (yScale.type === 'log' && (!(ref.from > 0) || !(ref.to > 0))) continue;
        const a = position(yScale, ref.from);
        const b = position(yScale, ref.to);
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        const lo = clamp(Math.min(a, b), top, bottom);
        const hi = clamp(Math.max(a, b), top, bottom);
        if (ref.from === ref.to) {
          refLines.push({ ...rule('reference', paint, left, lo, right, lo), strokeWidth: 1.5, dash: REFERENCE_DASH });
        } else {
          marks.push({ type: 'band', box: { x: left, y: lo, width: plot.width, height: Math.max(1, hi - lo) }, fill: paint, opacity: 0.12 });
        }
      }
    }
  }

  if (layout.kind === 'plot' && !compact) {
    const axisPaint = token('axis');
    const gridPaint = token('grid');
    edges.push(rule('axis', axisPaint, left, bottom, right, bottom));
    edges.push(rule('axis', axisPaint, left, top, left, bottom));
    for (const tick of layout.xTicks) {
      const px = boundaryPixel(xScale.type === 'band' ? xScale.center(tick.value) : position(xScale, tick.value), left, right);
      if (px !== null) edges.push(rule('tick', axisPaint, px, bottom, px, bottom + TICK_LENGTH));
    }
    for (const tick of layout.yTicks) {
      const py = boundaryPixel(position(leftScale, tick.value), top, bottom);
      if (py === null) continue;
      marks.push(rule('grid', gridPaint, left, py, right, py));
      edges.push(rule('tick', axisPaint, left - TICK_LENGTH, py, left, py));
    }
    if (layout.yTicksRight && meta.axes[1]) {
      const rightScale = axisScaleOf(projection, 1);
      edges.push(rule('axis', axisPaint, right, top, right, bottom));
      for (const tick of layout.yTicksRight) {
        const py = boundaryPixel(position(rightScale, tick.value), top, bottom);
        if (py !== null) edges.push(rule('tick', axisPaint, right, py, right + TICK_LENGTH, py));
      }
    }
  }

  // Partition visible drawable series by mark type (deterministic paint order: range -> bar -> area -> errorBar -> line)
  const barSeries: number[] = [];
  const areaSeries: number[] = [];
  const lineSeries: number[] = [];
  for (let i = 0; i < view.frame.series.length; i++) {
    if (!view.visible[i] || !view.frame.series[i]!.drawable) continue;
    const spec = meta.seriesByField.get(view.frame.series[i]!.field);
    const mark = spec?.mark ?? 'line';
    if (mark === 'range' || mark === 'errorBar') continue;
    if (mark === 'bar') barSeries.push(i);
    else if (mark === 'area') areaSeries.push(i);
    else lineSeries.push(i);
  }

  const annMarks = !compact ? buildCartesianAnnotationMarks(view, projection, plot, meta) : { bands: [], foreground: [] };
  const ivMarks = buildIntervalMarks(view, projection, meta, compact);

  // 1b. Shaded range annotations & data range bands behind bars/lines
  marks.push(...annMarks.bands, ...ivMarks.bands);
  // 2. Bars
  marks.push(...buildBarMarks(view, projection, plot, meta, barSeries));
  // 3. Areas
  const { areas, strokes } = buildAreaMarks(view, projection, plot, meta, areaSeries);
  marks.push(...areas, ...strokes);
  // 3b. Error bars
  marks.push(...ivMarks.rules, ...ivMarks.points);
  // 4. Lines (always topmost data marks)
  const { paths, points } = buildLineMarks(view, projection, lineSeries, compact);
  marks.push(...paths, ...points);
  // 5. Axes, reference lines, and foreground annotation markers/thresholds
  marks.push(...edges, ...refLines, ...annMarks.foreground);

  return { width: layout.width, height: layout.height, clip: plot, marks };
}
