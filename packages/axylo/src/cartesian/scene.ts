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
 * never hits `±COORDINATE_LIMIT`. Lines and areas are drawn from the samples spec F5 keeps
 * (cartesian/dense.ts) and stacks from cartesian/stacks.ts (spec F10), so their geometry is bounded by the
 * plot's device-pixel columns rather than by the data's length.
 */
import {
  SLOT_GAP, SLOT_NO_ROW, SLOT_VALUE, type AlignedView, type AreaMark, type ContinuousScale, type IndexRange, type Layout,
  type Mark, type PathMark, type PointMark, type Projection, type Rect, type RectMark,
  type RuleMark, type Scene, type View,
} from '../core/contracts';
import { boundaryPixel, clamp, position, rule, seriesPaint, token } from '../scene/geometry';
import { seriesSlots } from '../data/store-statistics';
import { stackAreaRange } from '../view';
import { bandOf, columnLimit, keep, lastDrawnValue, pathOf, pointsOf, safeRatio } from './dense';
import { cartesianStacks, type CartesianStack } from './stacks';
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
  if (!barSeriesIndexes.length) return [];
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

function isPlottable(scale: ContinuousScale, slot: number, value: number): boolean {
  // A SLOT_VALUE is always finite (core/contracts.ts).
  return slot === SLOT_VALUE && (scale.type !== 'log' || value > 0);
}

function lineMark(view: AlignedView, series: number, xy: Float32Array): PathMark {
  return {
    type: 'path', series, xy, stroke: seriesPaint(series), strokeWidth: 2,
    dash: view.cues[series]?.dash ?? { normal: null, contrast: null },
  };
}

/** Slot i's CSS x pixel, as bar-geom.ts xSlotPixel and lookup.ts place it. */
function slotX(projection: Exclude<Projection, { kind: 'ring' }>, xValues: Float64Array): (i: number) => number {
  const xScale = projection.kind === 'xy' ? projection.x : projection.band;
  return i => xSlotPixel(xScale, xValues, i);
}

/**
 * The common source vertices of one stack (as simplify/stackIndexes): every boundary's kept column extremes, and
 * both ends of every change of a component's state or sign, so neighbouring bands share one edge, stay ordered
 * between samples, and pinch exactly where a component starts or stops.
 */
function stackVertices(
  view: AlignedView, group: CartesianStack, range: IndexRange, xAt: (i: number) => number, ratio: number, limit: number,
): Uint32Array {
  const { start, end } = range;
  const size = end - start;
  const flags = new Uint8Array(size);
  if (size <= limit) flags.fill(1);
  else {
    for (let k = 0; k < group.order.length; k++) {
      for (const edge of [group.positive[k]!, group.negative[k]!]) {
        for (const i of keep(edge, null, range, xAt, ratio, limit, true).indexes) flags[i - start] = 1;
      }
      const series = view.frame.series[group.order[k]!]!;
      const states = seriesSlots(series);
      const kind = (i: number) => states && states[i] !== SLOT_VALUE ? 2 : Math.sign(series.y[i]!);
      for (let i = start + 1; i < end; i++) {
        if (kind(i) !== kind(i - 1)) flags[i - 1 - start] = flags[i - start] = 1;
      }
    }
    // The vertices next to the ends stay exact where the plot clips the drawing.
    flags[0] = flags[1] = flags[size - 2] = flags[size - 1] = 1;
  }
  let count = 0;
  for (let j = 0; j < size; j++) count += flags[j]!;
  const vertices = new Uint32Array(count);
  for (let j = 0, o = 0; j < size; j++) if (flags[j]) vertices[o++] = start + j;
  return vertices;
}

/**
 * The edge line of one stacked-area component, through the common vertices. It is drawn on each side of zero
 * along that side's cumulative boundary, the outer edge of the component's own band there, so between two
 * samples it lies on the filled polygon: where the value changes sign, the positive edge runs down to the
 * boundary below it and the negative edge runs out from it, instead of one segment crossing between the bands.
 * A vertex where the component has no value breaks both (F10: a missing component is never bridged).
 */
function stackEdge(
  vertices: Uint32Array, series: AlignedView['frame']['series'][number], group: CartesianStack, k: number,
  xAt: (i: number) => number, yScale: ContinuousScale,
): Float32Array | null {
  const states = seriesSlots(series), { y } = series, positive = group.positive[k]!;
  const xy = new Float32Array(8 * vertices.length);
  let o = 0;
  for (const side of [positive, group.negative[k]!]) {
    const put = (i: number) => { xy[o++] = xAt(i); xy[o++] = position(yScale, side[i]!); };
    for (let j = 1, open = false; j < vertices.length; j++) {
      const a = vertices[j - 1]!, b = vertices[j]!;
      // Joined where both ends have a value and either one is on this side.
      if ((states && (states[a] !== SLOT_VALUE || states[b] !== SLOT_VALUE))
        || (side === positive ? Math.max(y[a]!, y[b]!) < 0 : Math.min(y[a]!, y[b]!) >= 0)) { open = false; continue; }
      if (!open) {
        if (o) xy[o++] = xy[o++] = NaN;
        put(a);
        open = true;
      }
      put(b);
    }
  }
  return o ? xy.subarray(0, o) : null;
}

/**
 * Areas (spec F5, F10). An unstacked area keeps the samples a line would, over the zero baseline. The stacked
 * areas of one axis share one set of vertices kept on every cumulative boundary; each band has a positive and a
 * negative part on its own side of zero, a missing component adds zero height, and its edge line is not joined
 * across that slot.
 */
function buildAreaMarks(
  view: AlignedView,
  projection: Exclude<Projection, { kind: 'ring' }>,
  plot: Rect,
  meta: CartesianMeta,
  areaSeriesIndexes: readonly number[],
  ratio: number,
): { areas: AreaMark[]; strokes: PathMark[] } {
  const areas: AreaMark[] = [];
  const strokes: PathMark[] = [];
  if (!areaSeriesIndexes.length) return { areas, strokes };
  const xAt = slotX(projection, view.frame.x.values);
  const limit = columnLimit(plot, ratio);
  const stacks = cartesianStacks(view, meta);

  for (const sIdx of areaSeriesIndexes) {
    if (stacks.groupOf[sIdx]! >= 0) continue;
    const series = view.frame.series[sIdx]!;
    const yScale = axisScaleOf(projection, series.axisIndex ?? 0);
    const yAt = (i: number) => position(yScale, series.y[i]!);
    const kept = keep(series.y, seriesSlots(series), view.drawSlots[sIdx] ?? view.visibleSlots, xAt, ratio, limit, true, yScale.type === 'log');
    if (!kept.ends.length) continue;
    const zero = position(yScale, 0);
    areas.push({ type: 'area', series: sIdx, ...bandOf(kept, xAt, yAt, () => zero), fill: seriesPaint(sIdx), opacity: 0.22 });
    strokes.push(lineMark(view, sIdx, pathOf(kept, xAt, yAt)));
  }

  for (const group of stacks.groups) {
    if (group.mark !== 'area') continue;
    const yScale = axisScaleOf(projection, group.axisIndex);
    const range = stackAreaRange(view.frame, view.visibleSlots, view.xDomain);
    if (range.end - range.start < 2) continue;
    const vertices = stackVertices(view, group, range, xAt, ratio, limit);
    const count = vertices.length;
    const zero = position(yScale, 0);
    const runs = Uint32Array.of(0, count, 0, count);
    // Each side of zero is its own band per component, so a mixed-sign stack never crosses zero (F10).
    for (const side of [group.positive, group.negative]) {
      let lower = pointsOf(vertices, xAt, () => zero);
      side.forEach((values, k) => {
        const prior = side[k - 1];
        if (!vertices.some(i => values[i] !== (prior ? prior[i]! : 0))) return;
        const upper = pointsOf(vertices, xAt, i => position(yScale, values[i]!));
        areas.push({ type: 'area', series: group.order[k]!, upper, lower, runs, fill: seriesPaint(group.order[k]!), opacity: 0.22 });
        lower = upper;
      });
    }
    for (let k = 0; k < group.order.length; k++) {
      const sIdx = group.order[k]!;
      const edge = stackEdge(vertices, view.frame.series[sIdx]!, group, k, xAt, yScale);
      if (edge) strokes.push(lineMark(view, sIdx, edge));
    }
  }
  return { areas, strokes };
}

/**
 * Lines (spec F5). Markers: every isolated value, and (spec A5) the last value drawn inside the visible window,
 * wherever the drawing's overscan neighbour or trailing gaps fall.
 */
function buildLineMarks(
  view: AlignedView,
  projection: Exclude<Projection, { kind: 'ring' }>,
  plot: Rect,
  lineSeriesIndexes: readonly number[],
  compact: boolean,
  ratio: number,
): { paths: PathMark[]; points: PointMark[] } {
  const paths: PathMark[] = [];
  const points: PointMark[] = [];
  if (!lineSeriesIndexes.length) return { paths, points };
  const xAt = slotX(projection, view.frame.x.values);
  const limit = columnLimit(plot, ratio);

  for (const sIdx of lineSeriesIndexes) {
    const series = view.frame.series[sIdx]!;
    const yScale = axisScaleOf(projection, series.axisIndex ?? 0);
    // Filter y <= 0 BEFORE any position() call on log scales (RFC §4.4).
    const slot = seriesSlots(series);
    const log = yScale.type === 'log';
    const yAt = (i: number) => position(yScale, series.y[i]!);
    const kept = keep(series.y, slot, view.drawSlots[sIdx] ?? view.visibleSlots, xAt, ratio, limit, true, log);
    if (kept.ends.length) paths.push(lineMark(view, sIdx, pathOf(kept, xAt, yAt)));

    const last = compact ? -1 : lastDrawnValue(series.y, slot, view.visibleSlots, log);
    const markers = last >= 0 && !kept.isolated.includes(last) ? new Uint32Array([...kept.isolated, last]) : kept.isolated;
    if (markers.length) {
      points.push({
        type: 'points', series: sIdx, xy: pointsOf(markers, xAt, yAt),
        shape: view.cues[sIdx]?.marker ?? 'circle', size: compact ? 3 : 4, fill: seriesPaint(sIdx),
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
): { bands: AreaMark[]; strokes: PathMark[]; points: PointMark[] } {
  const bands: AreaMark[] = [];
  const strokes: PathMark[] = [];
  const points: PointMark[] = [];
  if (!meta.intervals.length) return { bands, strokes, points };

  const xAt = slotX(projection, view.frame.x.values);
  const idxByField = new Map<string, number>();
  for (let i = 0; i < view.frame.series.length; i++) idxByField.set(view.frame.series[i]!.field, i);
  const { start, end } = view.visibleSlots;
  const slotCount = Math.max(0, end - start);

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
      // One state per slot for the pair: a value where both ends can be placed, bridged where neither has a row.
      const state = new Uint8Array(view.frame.length).fill(SLOT_GAP);
      for (let i = start; i < end; i++) {
        const loSt = lowS.slot[i]!;
        const hiSt = highS.slot[i]!;
        state[i] = loSt === SLOT_NO_ROW && hiSt === SLOT_NO_ROW ? SLOT_NO_ROW
          : isPlottable(yScale, loSt, lowS.y[i]!) && isPlottable(yScale, hiSt, highS.y[i]!) ? SLOT_VALUE : SLOT_GAP;
      }
      const kept = keep(lowS.y, state, view.visibleSlots, xAt, 1, Infinity, true);
      const hiAt = (i: number) => position(yScale, Math.max(lowS.y[i]!, highS.y[i]!));
      const loAt = (i: number) => position(yScale, Math.min(lowS.y[i]!, highS.y[i]!));
      if (kept.ends.length) bands.push({ type: 'area', series: lowIdx, ...bandOf(kept, xAt, hiAt, loAt), fill: paint, opacity: 0.22 });
      // A single valid interval (e.g. zoomed onto one slot) is a visible vertical span.
      const { isolated } = kept;
      if (isolated.length) {
        const xy = new Float32Array(6 * isolated.length);
        isolated.forEach((i, j) => xy.set([xAt(i), loAt(i), xAt(i), hiAt(i), NaN, NaN], 6 * j));
        strokes.push({ type: 'path', series: lowIdx, xy, stroke: paint, strokeWidth: 4, dash: { normal: null, contrast: null } });
      }
    } else {
      // errorBar: batch all vertical whiskers and end-caps into ONE typed Float32Array PathMark (O(N), 1 SVG node)
      const halfCap = iv.capWidth / 2;
      const segsPerBar = halfCap > 0 ? 18 : 6; // 3 segments * (x1,y1,x2,y2,NaN,NaN) = 18 floats
      const segBuf = new Float32Array(slotCount * segsPerBar);
      let segPos = 0;
      const centerBuf = centerS ? new Float32Array(slotCount * 2) : null;
      let centerPos = 0;

      for (let i = start; i < end; i++) {
        const loSt = lowS.slot[i]!;
        const hiSt = highS.slot[i]!;
        const loV = lowS.y[i]!;
        const hiV = highS.y[i]!;
        if (!isPlottable(yScale, loSt, loV) || !isPlottable(yScale, hiSt, hiV)) continue;
        const px = xAt(i);
        const pyA = position(yScale, Math.min(loV, hiV));
        const pyB = position(yScale, Math.max(loV, hiV));
        segBuf[segPos++] = px; segBuf[segPos++] = pyB;
        segBuf[segPos++] = px; segBuf[segPos++] = pyA;
        segBuf[segPos++] = NaN; segBuf[segPos++] = NaN;
        if (halfCap > 0) {
          segBuf[segPos++] = px - halfCap; segBuf[segPos++] = pyA;
          segBuf[segPos++] = px + halfCap; segBuf[segPos++] = pyA;
          segBuf[segPos++] = NaN; segBuf[segPos++] = NaN;
          segBuf[segPos++] = px - halfCap; segBuf[segPos++] = pyB;
          segBuf[segPos++] = px + halfCap; segBuf[segPos++] = pyB;
          segBuf[segPos++] = NaN; segBuf[segPos++] = NaN;
        }
        if (centerS && centerBuf && isPlottable(yScale, centerS.slot[i]!, centerS.y[i]!)) {
          centerBuf[centerPos++] = px;
          centerBuf[centerPos++] = position(yScale, centerS.y[i]!);
        }
      }
      if (segPos >= 4) {
        strokes.push({
          type: 'path',
          series: centerIdx ?? lowIdx,
          xy: segPos === segBuf.length ? segBuf : segBuf.subarray(0, segPos),
          stroke: paint,
          strokeWidth: 1.5,
          dash: { normal: null, contrast: null },
        });
      }
      if (centerBuf && centerPos >= 2) {
        points.push({
          type: 'points',
          series: centerIdx ?? lowIdx,
          xy: centerPos === centerBuf.length ? centerBuf : centerBuf.subarray(0, centerPos),
          shape: view.cues[centerIdx ?? lowIdx]?.marker ?? 'circle',
          size: compact ? 3 : 4.5,
          fill: paint,
        });
      }
    }
  }
  return { bands, strokes, points };
}

export function buildCartesianScene(
  stateRef: CartesianStateRef,
  input: View,
  layout: Layout,
  devicePixelRatio: number,
): Scene {
  // A 'line' composition (cartesian.ts) builds aligned views only, so only the layout can leave nothing to draw.
  const view = input as AlignedView;
  if (layout.kind !== 'plot' && layout.kind !== 'compact') {
    return { width: layout.width, height: layout.height, clip: { x: 0, y: 0, width: layout.width, height: layout.height }, marks: [] };
  }
  // The Cartesian layout projects onto xy or bands (layout.ts), never a ring.
  const { plot } = layout;
  const projection = layout.projection as Exclude<Projection, { kind: 'ring' }>;

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
        const a = position(xScale, ref.from);
        const b = position(xScale, ref.to);
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
      const px = boundaryPixel(position(xScale, tick.value), left, right);
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
  const ratio = safeRatio(devicePixelRatio);
  const { areas, strokes } = buildAreaMarks(view, projection, plot, meta, areaSeries, ratio);
  marks.push(...areas, ...strokes);
  // 3b. Error bars & singleton range spans (batched typed PathMarks)
  marks.push(...ivMarks.strokes, ...ivMarks.points);
  // 4. Lines (always topmost data marks)
  const { paths, points } = buildLineMarks(view, projection, plot, lineSeries, compact, ratio);
  marks.push(...paths, ...points);
  // 5. Axes, reference lines, and foreground annotation markers/thresholds
  marks.push(...edges, ...refLines, ...annMarks.foreground);

  return { width: layout.width, height: layout.height, clip: plot, marks };
}
