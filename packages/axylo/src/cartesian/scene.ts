/**
 * Mixed-layer dual-axis scene builder for `axylo/cartesian` (C4.3, RFC §5.2).
 * Paint order:
 *   1. Reference bands + left-axis gridlines, shaded annotations and `range` bands
 *   2. `bar` layers, then `boxplot` boxes, whiskers and medians, then `violin` outlines and inner boxes
 *   3. `area` layers
 *   3b. `errorBar` whiskers/centres, box outliers, `scatter` points
 *   4. `line` layers (topmost data marks)
 *   5. Axis spines, ticks, reference lines, and foreground annotations
 */
import {
  SLOT_VALUE, type AlignedView, type AreaMark, type ContinuousScale, type IndexRange, type Layout,
  type Mark, type PathMark, type PointMark, type Projection, type RectMark,
  type RuleMark, type Tick, type Series, type View,
} from '../core/contracts';
import type { BarScene } from '../render/svg';
import { boundaryPixel, clamp, position, rule, seriesPaint, token } from '../scene/geometry';
import { seriesSlots } from '../data/store-statistics';
import { bandOf, columnLimit, keep, lastDrawnValue, pathOf, pointsOf, safeRatio } from './dense';
import { cartesianStacks, type CartesianStack } from './stacks';
import { axisScaleOf } from './scale-ref';
import { buildBarSlotLayout, xSlotPixel } from './bar-geom';
import { buildCartesianAnnotationMarks } from './annotations';
import { repeatsIn, repeatsOf, visitRepeats } from './repeats';
import type { CartesianStateRef } from './meta';
import { projectViolin, violinMarks } from './violin';
import {
  MEDIAN_WIDTH, RANGE_STROKE_WIDTH, WHISKER_WIDTH, axisOf, boxHalfWidth, isCompoundKind, markOf, physicalOf, projectCompound, type CompoundSink,
} from './boxplot';

const TICK_LENGTH = 4;
const REFERENCE_DASH = [4, 3] as const;
const SOLID_DASH = { normal: null, contrast: null } as const;
const trim = (buf: Float32Array, used: number) => used === buf.length ? buf : buf.subarray(0, used);
const pointMark = (view: AlignedView, series: number, xy: Float32Array, size: number, fill = seriesPaint(series)): PointMark =>
  ({ type: 'points', series, xy, shape: view.cues[series]?.marker ?? 'circle', size, fill });
const strokeMark = (series: number, xy: Float32Array, stroke: PathMark['stroke'], strokeWidth: number, dash: PathMark['dash'] = SOLID_DASH): PathMark =>
  ({ type: 'path', series, xy, stroke, strokeWidth, dash });
const areaMark = (series: number, band: Pick<AreaMark, 'upper' | 'lower' | 'runs'>): AreaMark =>
  ({ type: 'area', series, ...band, fill: seriesPaint(series), opacity: 0.22 });
const barMark = (series: number, data: Float32Array, used: number): RectMark =>
  ({ type: 'rects', series, xywh: trim(data, used), fill: seriesPaint(series), variant: 'bar' });

function writeSeg(buf: Float32Array, at: number, x1: number, y1: number, x2: number, y2: number): number {
  buf[at++] = x1; buf[at++] = y1; buf[at++] = x2; buf[at++] = y2; buf[at++] = NaN; buf[at++] = NaN;
  return at;
}

function stackVertices(
  view: AlignedView, group: CartesianStack, range: IndexRange, xAt: (i: number) => number, ratio: number, limit: number,
): Uint32Array {
  const { start, end } = range, size = end - start;
  const flags = new Uint8Array(size);
  if (size <= limit) flags.fill(1);
  else {
    for (let k = 0; k < group.order.length; k++) {
      for (const edge of [group.positive[k]!, group.negative[k]!]) {
        for (const i of keep(edge, null, range, xAt, ratio, limit, true).indexes) flags[i - start] = 1;
      }
      const series = view.frame.series[group.order[k]!]!, states = seriesSlots(series);
      const kind = (i: number) => states && states[i] !== SLOT_VALUE ? 2 : Math.sign(series.y[i]!);
      for (let i = start + 1; i < end; i++) if (kind(i) !== kind(i - 1)) flags[i - 1 - start] = flags[i - start] = 1;
    }
    flags[0] = flags[1] = flags[size - 2] = flags[size - 1] = 1;
  }
  let count = 0;
  for (let j = 0; j < size; j++) count += flags[j]!;
  const vertices = new Uint32Array(count);
  for (let j = 0, o = 0; j < size; j++) if (flags[j]) vertices[o++] = start + j;
  return vertices;
}

function stackEdge(
  vertices: Uint32Array, series: Series, group: CartesianStack, k: number, xAt: (i: number) => number, yScale: ContinuousScale,
): Float32Array | null {
  const states = seriesSlots(series), { y } = series, positive = group.positive[k]!;
  const xy = new Float32Array(8 * vertices.length);
  let o = 0;
  for (const side of [positive, group.negative[k]!]) {
    const put = (i: number) => { xy[o++] = xAt(i); xy[o++] = position(yScale, side[i]!); };
    for (let j = 1, open = false; j < vertices.length; j++) {
      const a = vertices[j - 1]!, b = vertices[j]!;
      if ((states && (states[a] !== SLOT_VALUE || states[b] !== SLOT_VALUE))
        || (side === positive ? Math.max(y[a]!, y[b]!) < 0 : Math.min(y[a]!, y[b]!) >= 0)) { open = false; continue; }
      if (!open) { if (o) xy[o++] = xy[o++] = NaN; put(a); open = true; }
      put(b);
    }
  }
  return o ? xy.subarray(0, o) : null;
}

export function buildCartesianScene(
  stateRef: CartesianStateRef,
  input: View,
  layout: Layout,
  devicePixelRatio: number,
): BarScene {
  const view = input as AlignedView;
  if (layout.kind !== 'plot' && layout.kind !== 'compact') {
    return { width: layout.width, height: layout.height, clip: { x: 0, y: 0, width: layout.width, height: layout.height }, marks: [] };
  }
  const { plot, width, height } = layout;
  const projection = layout.projection as Exclude<Projection, { kind: 'ring' }>;
  const compact = layout.kind === 'compact' || view.compact;
  const { meta } = stateRef;
  const { frame, visibleSlots } = view;
  const { start, end } = visibleSlots;
  const slotCount = Math.max(0, end - start);
  const xScale = projection.kind === 'xy' ? projection.x : projection.band;
  const xAt = (i: number) => xSlotPixel(xScale, frame.x.values, i);
  const left = plot.x, right = left + plot.width, top = plot.y, bottom = top + plot.height;

  const marks: Mark[] = [];
  const edges: RuleMark[] = [];
  const refLines: RuleMark[] = [];

  // 1. Reference bands & lines
  if (!compact && view.references.length) {
    const paint = token('reference');
    for (const ref of view.references) {
      const isX = ref.axis === 'x';
      const scale = isX ? xScale : axisScaleOf(projection, axisOf(meta, ref.axisId)!.index);
      if (!isX && scale.type === 'log' && (!(ref.from > 0) || !(ref.to > 0))) continue;
      const a = position(scale, ref.from), b = position(scale, ref.to);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      const minB = isX ? left : top, maxB = isX ? right : bottom;
      const lo = clamp(Math.min(a, b), minB, maxB), hi = clamp(Math.max(a, b), minB, maxB);
      if (ref.from === ref.to) {
        refLines.push({ ...(isX ? rule('reference', paint, lo, top, lo, bottom) : rule('reference', paint, left, lo, right, lo)), strokeWidth: 1.5, dash: REFERENCE_DASH });
      } else {
        marks.push({
          type: 'band',
          box: isX ? { x: lo, y: top, width: Math.max(1, hi - lo), height: plot.height } : { x: left, y: lo, width: plot.width, height: Math.max(1, hi - lo) },
          fill: paint, opacity: 0.12,
        });
      }
    }
  }

  if (layout.kind === 'plot' && !compact) {
    const axisPaint = token('axis'), gridPaint = token('grid');
    edges.push(rule('axis', axisPaint, left, bottom, right, bottom), rule('axis', axisPaint, left, top, left, bottom));
    for (const tick of layout.xTicks) {
      const px = boundaryPixel(position(xScale, tick.value), left, right);
      if (px !== null) edges.push(rule('tick', axisPaint, px, bottom, px, bottom + TICK_LENGTH));
    }
    const verticalTicks = (ticks: readonly Tick[], side: 0 | 1) => {
      const scale = axisScaleOf(projection, side);
      const from = side ? right : left - TICK_LENGTH;
      for (const tick of ticks) {
        const y = boundaryPixel(position(scale, tick.value), top, bottom);
        if (y === null) continue;
        if (!side) marks.push(rule('grid', gridPaint, left, y, right, y));
        edges.push(rule('tick', axisPaint, from, y, side ? right + TICK_LENGTH : left, y));
      }
    };
    verticalTicks(layout.yTicks, 0);
    if (layout.yTicksRight && meta.axes[1]) {
      edges.push(rule('axis', axisPaint, right, top, right, bottom));
      verticalTicks(layout.yTicksRight, 1);
    }
  }

  // Partition visible drawable series by logical mark
  const barSeries: number[] = [], areaSeries: number[] = [], lineSeries: number[] = [], scatterSeries: number[] = [];
  const physical = physicalOf(view);
  const annMarks = !compact ? buildCartesianAnnotationMarks(view, projection, plot, meta) : { bands: [], foreground: [] };
  const ivBands: AreaMark[] = [], ivStrokes: PathMark[] = [], ivPoints: PointMark[] = [];
  const boxRects: RectMark[] = [], boxStrokes: PathMark[] = [], boxPoints: PointMark[] = [];
  const violins: Mark[] = [];
  let boxHalf: number | undefined;

  for (let index = 0; index < frame.series.length; index++) {
    if (!view.visible[index] || !frame.series[index]!.drawable) continue;
    const field = frame.series[index]!.field, m = markOf(meta, field);
    const kind = m?.kind ?? meta.seriesByField.get(field)?.mark ?? 'line';
    if (!isCompoundKind(kind)) {
      (kind === 'bar' ? barSeries : kind === 'area' ? areaSeries : kind === 'scatter' ? scatterSeries : lineSeries).push(index);
      continue;
    }
    if (!m) continue;
    boxHalf ??= boxHalfWidth(projection, frame.x.values, visibleSlots);
    if (m.kind === 'violin') {
      const g = projectViolin(m, physical, index, projection, plot, boxHalf * 1.5);
      if (g) violins.push(...violinMarks(index, g, start, end, xAt));
      continue;
    }
    const geometry = projectCompound(m, physical, index, projection, plot, boxHalf);
    if (!geometry) continue;
    const { rows, low, centre, cap } = geometry;
    const paint = seriesPaint(index);
    if (m.kind === 'range') {
      const kept = keep(low.y, rows, visibleSlots, xAt, 1, Infinity, true);
      if (kept.ends.length) ivBands.push(areaMark(index, bandOf(kept, xAt, geometry.top, geometry.bottom)));
      if (kept.isolated.length) {
        const xy = new Float32Array(6 * kept.isolated.length);
        kept.isolated.forEach((i, j) => writeSeg(xy, 6 * j, xAt(i), geometry.bottom(i), xAt(i), geometry.top(i)));
        ivStrokes.push(strokeMark(index, xy, paint, RANGE_STROKE_WIDTH));
      }
      continue;
    }

    const box = m.kind === 'boxplot';
    const rects = new Float32Array(box ? slotCount * 4 : 0);
    const medians = new Float32Array(box ? slotCount * 6 : 0);
    const strokes = new Float32Array(slotCount * 6 * ((box ? 2 : 1) + (cap > 0 ? 2 : 0)));
    let points = new Float32Array(!box && centre?.drawable ? slotCount * 2 : 0);
    let r = 0, md = 0, w = 0, n = 0, outCount = 0;
    const putPoint = (x: number, y: number) => { points[n++] = x; points[n++] = y; };
    const sink: CompoundSink = {
      box(x, halfWidth, y, height) {
        rects[r++] = x - halfWidth; rects[r++] = y; rects[r++] = 2 * halfWidth; rects[r++] = height;
      },
      whisker(x1, y1, x2, y2) { w = writeSeg(strokes, w, x1, y1, x2, y2); },
      median(x1, x2, y) { md = writeSeg(medians, md, x1, y, x2, y); },
      point: centre?.drawable ? putPoint : undefined,
    };
    for (let i = start; i < end; i++) {
      if (rows[i] !== SLOT_VALUE) continue;
      const x = xAt(i);
      geometry.visit(i, x, sink);
      if (m.outliers) outCount += geometry.outliers(i);
    }
    if (r) boxRects.push(barMark(index, rects, r));
    if (w) (box ? boxStrokes : ivStrokes).push(strokeMark(index, trim(strokes, w), paint, WHISKER_WIDTH));
    if (md) boxStrokes.push(strokeMark(index, trim(medians, md), token('background'), MEDIAN_WIDTH));
    if (outCount) {
      points = new Float32Array(outCount * 2);
      const append = (v: number, slot: number) => {
        const y = geometry.pointY(v);
        if (Number.isFinite(y)) putPoint(xAt(slot), y);
      };
      for (let i = start; i < end; i++) if (rows[i] === SLOT_VALUE) geometry.outliers(i, append);
    }
    if (n) (box ? boxPoints : ivPoints).push(pointMark(view, index, trim(points, n), compact ? 3 : m.size, paint));
  }

  // 1b. Shaded range annotations & data range bands
  marks.push(...annMarks.bands, ...ivBands);

  // 2. Bars, then boxes with whiskers and medians
  // A missing entry identifies a compound glyph that also uses RectMark.variant === 'bar'.
  const barBaselines: (number | null)[] = [];
  if (barSeries.length) {
    const barLayout = buildBarSlotLayout(view, projection, plot, meta, barSeries);
    for (const sIdx of barSeries) {
      const { baseline, write } = barLayout(sIdx)!;
      barBaselines[sIdx] = baseline;
      const buf = new Float32Array(slotCount * 4);
      let written = 0;
      for (let i = start; i < end; i++) if (write(i, buf, written)) written += 4;
      if (written) marks.push(barMark(sIdx, buf, written));
    }
  }
  marks.push(...boxRects, ...boxStrokes, ...violins);

  // 3. Areas
  const ratio = safeRatio(devicePixelRatio), limit = columnLimit(plot, ratio);
  const line = (s: number, xy: Float32Array) => strokeMark(s, xy, seriesPaint(s), 2, view.cues[s]?.dash);
  const drawTrace = (sIdx: number, strokes: Mark[], markers?: PointMark[]) => {
    const s = frame.series[sIdx]!, scale = axisScaleOf(projection, s.axisIndex);
    const slot = seriesSlots(s), log = scale.type === 'log';
    const yAt = (i: number) => position(scale, s.y[i]!);
    const kept = keep(s.y, slot, view.drawSlots[sIdx] ?? visibleSlots, xAt, ratio, limit, true, log);
    if (kept.ends.length) {
      if (!markers) {
        const zero = position(scale, 0);
        marks.push(areaMark(sIdx, bandOf(kept, xAt, yAt, () => zero)));
      }
      strokes.push(line(sIdx, pathOf(kept, xAt, yAt)));
    }
    if (markers) {
      const last = compact ? -1 : lastDrawnValue(s.y, slot, visibleSlots, log);
      const indexes = last >= 0 && !kept.isolated.includes(last) ? new Uint32Array([...kept.isolated, last]) : kept.isolated;
      if (indexes.length) markers.push(pointMark(view, sIdx, pointsOf(indexes, xAt, yAt), compact ? 3 : 4));
    }
  };
  if (areaSeries.length) {
    const stacks = cartesianStacks(view, meta);
    const areaStrokes: PathMark[] = [];
    for (const s of areaSeries) if (stacks.groupOf[s]! < 0) drawTrace(s, areaStrokes);
    for (const group of stacks.groups) {
      if (group.mark !== 'area') continue;
      const yScale = axisScaleOf(projection, group.axisIndex), xv = frame.x.values, vs = visibleSlots;
      const range = frame.x.kind === 'category' ? vs : {
        start: vs.start > 0 && vs.start < xv.length && view.xDomain[0] < xv[vs.start]! ? vs.start - 1 : vs.start,
        end: vs.end > 0 && vs.end < xv.length && xv[vs.end - 1]! < view.xDomain[1] ? vs.end + 1 : vs.end,
      };
      if (range.end - range.start < 2) continue;
      const vertices = stackVertices(view, group, range, xAt, ratio, limit);
      const zero = position(yScale, 0), runs = Uint32Array.of(0, vertices.length, 0, vertices.length);
      for (const side of [group.positive, group.negative]) {
        let lower = pointsOf(vertices, xAt, () => zero);
        side.forEach((values, k) => {
          const prior = side[k - 1];
          if (!vertices.some(i => values[i] !== (prior ? prior[i]! : 0))) return;
          const upper = pointsOf(vertices, xAt, i => position(yScale, values[i]!));
          marks.push(areaMark(group.order[k]!, { upper, lower, runs }));
          lower = upper;
        });
      }
      for (let k = 0; k < group.order.length; k++) {
        const edge = stackEdge(vertices, frame.series[group.order[k]!]!, group, k, xAt, yScale);
        if (edge) areaStrokes.push(line(group.order[k]!, edge));
      }
    }
    marks.push(...areaStrokes);
  }

  // 3b. Error bars, box outliers, scatter points
  marks.push(...ivStrokes, ...ivPoints, ...boxPoints);
  for (const index of scatterSeries) {
    const s = frame.series[index]!, yScale = axisScaleOf(projection, s.axisIndex);
    const more = repeatsOf(s);
    const xy = new Float32Array(2 * (slotCount + repeatsIn(more, start, end)));
    let o = 0, px = 0;
    const put = (v: number) => { if (yScale.type !== 'log' || v > 0) { xy[o++] = px; xy[o++] = position(yScale, v); } };
    for (let i = start; i < end; i++) {
      px = xAt(i);
      if (s.slot[i] === SLOT_VALUE) put(s.y[i]!);
      visitRepeats(more, i, put);
    }
    if (o) marks.push(pointMark(view, index, trim(xy, o), compact ? 3 : markOf(meta, s.field)?.size ?? 4));
  }

  // 4. Lines (topmost data marks)
  const linePoints: PointMark[] = [];
  for (const s of lineSeries) drawTrace(s, marks, linePoints);
  marks.push(...linePoints, ...edges, ...refLines, ...annMarks.foreground);

  return { width, height, clip: plot, marks, barBaselines };
}
