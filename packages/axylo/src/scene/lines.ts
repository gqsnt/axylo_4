import {
  SLOT_VALUE, type AlignedView, type IndexRange, type PathMark, type PointMark, type Projection,
  type Rect, type ScatterView, type SeriesCue,
} from '../core/contracts';
import { buildPath, buildPoints, emptyIndexes, simplifiedPath, unthinnedPath, type JoinedRuns, type LineInput, type LineSource } from '../simplify';
import { affinePosition, affineProjection, exactProjection, position, seriesPaint, type AffineProjection } from './geometry';

const MARKER_SPACING = 12;
const SPARSE_SPACING = 80;

export type XY = Extract<Projection, { kind: 'xy' }>;
export type Drawing = Omit<LineInput, 'y' | 'slot' | 'range'> & {
  readonly mapX: (x: number) => number;
  readonly mapY: (y: number) => number;
  readonly affineY?: AffineProjection;
};

export function drawing(x: Float64Array, xy: XY, plot: Rect, devicePixelRatio: number): Drawing {
  return {
    x, mapX: value => position(xy.x, value), mapY: value => position(xy.y, value),
    affineX: affineProjection(xy.x, x.length ? [x[0]!, x[x.length - 1]!] : undefined),
    affineY: affineProjection(xy.y),
    left: plot.x, width: plot.width, devicePixelRatio: Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1,
  };
}

let markerScratch: Uint32Array | undefined;

function denseMarkerPoints(
  input: LineSource & Drawing, range: IndexRange, affine: AffineProjection, path: Float32Array | null,
): Float32Array | null {
  const { exact } = affine;
  // A special-cased end pixel must agree with the monotone interpolation used by the search.
  if (exact && exact.origin + exact.extent !== exact.edge) return null;
  const { slot, x } = input;
  let first = range.start;
  while (first < range.end && slot && slot[first] !== SLOT_VALUE) first++;
  if (first === range.end) return new Float32Array(0);
  const firstPixel = affinePosition(affine, x[first]!);
  let previous = firstPixel;
  let next = first + 1;
  for (; next < range.end; next++) {
    if (slot && slot[next] !== SLOT_VALUE) continue;
    const pixel = affinePosition(affine, x[next]!);
    if (Math.abs(pixel - previous) < MARKER_SPACING) break;
    previous = pixel;
  }
  if (next === range.end) return null;
  let last = range.end - 1;
  while (slot && slot[last] !== SLOT_VALUE) last--;
  previous = affinePosition(affine, x[last]!);
  const capacity = Math.min(last - first + 1, Math.floor(Math.abs(previous - firstPixel) / SPARSE_SPACING) + 1);
  const indexes = markerScratch && markerScratch.length >= capacity ? markerScratch : new Uint32Array(capacity);
  markerScratch = undefined;
  const stride = Math.max(1, Math.ceil((last - first) / Math.abs(previous - firstPixel) * SPARSE_SPACING));
  let write = capacity;
  for (let i = last; i >= first;) {
    indexes[--write] = i;
    let low = first;
    let high = i;
    // A regular time window lands on this bracket immediately. Verify it in projected pixels
    // before skipping any slots, including at an exact spacing tie or on an irregular axis.
    const guess = Math.max(first, i - stride);
    if (Math.abs(previous - affinePosition(affine, x[guess]!)) >= SPARSE_SPACING) {
      low = guess + 1;
      if (low < high && Math.abs(previous - affinePosition(affine, x[low]!)) < SPARSE_SPACING) high = low;
    } else {
      high = guess;
      if (low < high && Math.abs(previous - affinePosition(affine, x[high - 1]!)) >= SPARSE_SPACING) low = high;
    }
    while (low < high) {
      const mid = low + ((high - low) >>> 1);
      if (Math.abs(previous - affinePosition(affine, x[mid]!)) >= SPARSE_SPACING) low = mid + 1;
      else high = mid;
    }
    i = low - 1;
    while (i >= first && slot && slot[i] !== SLOT_VALUE) i--;
    if (i >= first) previous = affinePosition(affine, x[i]!);
  }
  let xy: Float32Array;
  if (path) {
    xy = new Float32Array(2 * (capacity - write));
    for (let j = write, out = 0; j < capacity; j++) {
      const source = 2 * (indexes[j]! - input.range.start);
      xy[out++] = path[source]!;
      xy[out++] = path[source + 1]!;
    }
  } else {
    xy = buildPoints(indexes.subarray(write, capacity), input);
  }
  if (indexes.length <= 1024) markerScratch = indexes;
  return xy;
}

function markerIndexes(
  input: LineSource & Drawing, range: IndexRange, isolated: Uint32Array, compact: boolean,
): Uint32Array {
  if (compact) return isolated;
  const { slot, x, mapX, affineX } = input;
  const pixelAt = affineX ? (i: number) => affinePosition(affineX, x[i]!) : (i: number) => mapX(x[i]!);
  let count = 0;
  let first = range.end;
  let last = range.start;
  let previousPixel = 0;
  let showAll = true;
  for (let i = range.start; i < range.end; i++) {
    if (slot && slot[i] !== SLOT_VALUE) continue;
    if (count++ === 0) first = i;
    if (showAll) {
      const pixel = pixelAt(i);
      showAll = i === first || Math.abs(pixel - previousPixel) >= MARKER_SPACING;
      previousPixel = pixel;
    }
    last = i;
  }
  if (!count) return isolated;
  const capacity = showAll ? count : Math.min(count,
    Math.floor(Math.abs(pixelAt(last) - pixelAt(first)) / SPARSE_SPACING) + 1 + isolated.length);
  const indexes = new Uint32Array(capacity);
  let write = capacity;
  let previous = Infinity;
  let single = isolated.length - 1;
  // Walk back from the last observed value so the series always has its identity at that end.
  for (let i = last; i >= first; i--) {
    if (slot && slot[i] !== SLOT_VALUE) continue;
    const pixel = showAll ? 0 : pixelAt(i);
    const required = isolated[single] === i;
    if (required) single--;
    if (showAll || required || Math.abs(previous - pixel) >= SPARSE_SPACING) {
      indexes[--write] = i;
      previous = pixel;
    }
  }
  return indexes.subarray(write);
}

function pointMark(series: number, cue: SeriesCue, xy: Float32Array): PointMark {
  return { type: 'points', series, xy, shape: cue.marker, size: 6, fill: seriesPaint(series) };
}

export function addLine(
  input: LineSource & Drawing, view: AlignedView, series: number, visible: IndexRange, compact: boolean,
  paths: PathMark[], points: PointMark[], selection?: JoinedRuns, packed?: Float32Array,
): void {
  const cue = view.cues[series]!;
  let xy = selection ? null : unthinnedPath(input);
  const fullPath = xy;
  let isolated = emptyIndexes();
  if (selection) {
    // A single slot in an author domain can have joined neighbours outside the drawing.
    const single = input.range.end - input.range.start === 1 && selection.indexes.length === 1;
    isolated = single ? selection.indexes : selection.isolated;
    if (selection.indexes.length && !single) {
      xy = packed && !selection.breaks.length ? packed : buildPath(selection.indexes, selection.breaks, input);
    }
  } else if (!xy) {
    ({ xy, isolated } = simplifiedPath(input));
  }
  if (xy) paths.push({
    type: 'path', series, xy, stroke: seriesPaint(series), strokeWidth: 2, dash: cue.dash,
  });
  if (!compact && input.affineX && input.affineX.slope !== 0 && visible.end - visible.start > 64 && !isolated.length) {
    const markerXY = denseMarkerPoints(input, visible, input.affineX,
      visible.start >= input.range.start && visible.end <= input.range.end ? fullPath : null);
    if (markerXY) {
      if (markerXY.length) points.push(pointMark(series, cue, markerXY));
      return;
    }
  }
  const markers = markerIndexes(input, visible, isolated, compact);
  if (markers.length) points.push(pointMark(series, cue, buildPoints(markers, input)));
}

export function scatterPoints(view: ScatterView, projection: XY): PointMark[] {
  const result: PointMark[] = [];
  const xProjection = exactProjection(projection.x);
  const yProjection = exactProjection(projection.y);
  for (let i = 0; i < view.frame.series.length; i++) {
    if (!view.visible[i]) continue;
    const { x, y } = view.frame.series[i]!;
    const { start, end } = view.visiblePoints[i]!;
    const xy = new Float32Array(2 * (end - start));
    if (xProjection && yProjection) {
      const { start: xStart, span: xSpan, origin: xOrigin, extent: xExtent } = xProjection;
      const { start: yStart, span: ySpan, origin: yOrigin, extent: yExtent } = yProjection;
      // Interior fractions fit in the packed coordinates. Endpoints, NaN and extrapolation use position.
      for (let index = start, out = 0; index < end; index++) {
        const xValue = x[index]!;
        const yValue = y[index]!;
        const xFraction = (xValue - xStart) / xSpan;
        const yFraction = (yValue - yStart) / ySpan;
        xy[out++] = xFraction > 0 && xFraction < 1 ? xOrigin + xFraction * xExtent : position(projection.x, xValue);
        xy[out++] = yFraction > 0 && yFraction < 1 ? yOrigin + yFraction * yExtent : position(projection.y, yValue);
      }
    } else {
      for (let index = start, out = 0; index < end; index++) {
        xy[out++] = position(projection.x, x[index]!);
        xy[out++] = position(projection.y, y[index]!);
      }
    }
    result.push(pointMark(i, view.cues[i]!, xy));
  }
  return result;
}

