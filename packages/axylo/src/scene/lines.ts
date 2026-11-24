import {
  SLOT_VALUE, type AlignedView, type IndexRange, type PathMark, type PointMark, type Projection,
  type Rect, type ScatterView, type SeriesCue,
} from '../core/contracts';
import { buildPath, buildPoints, simplifyLine, type JoinedRuns, type LineInput } from '../simplify';
import { affinePosition, affineProjection, position, seriesPaint, type AffineProjection } from './geometry';

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
    left: plot.x, width: plot.width, devicePixelRatio,
  };
}

function denseMarkers(input: LineInput, range: IndexRange, affine: AffineProjection): Uint32Array | null {
  const { exact } = affine;
  // A special-cased end pixel must agree with the monotone interpolation used by the search.
  if (exact && exact.origin + exact.extent !== exact.edge) return null;
  const { slot, x } = input;
  let first = range.start;
  while (first < range.end && slot[first] !== SLOT_VALUE) first++;
  if (first === range.end) return new Uint32Array(0);
  const firstPixel = affinePosition(affine, x[first]!);
  let previous = firstPixel;
  let next = first + 1;
  for (; next < range.end; next++) {
    if (slot[next] !== SLOT_VALUE) continue;
    const pixel = affinePosition(affine, x[next]!);
    if (Math.abs(pixel - previous) < MARKER_SPACING) break;
    previous = pixel;
  }
  if (next === range.end) return null;
  let last = range.end - 1;
  while (slot[last] !== SLOT_VALUE) last--;
  previous = affinePosition(affine, x[last]!);
  const capacity = Math.min(last - first + 1, Math.floor(Math.abs(previous - firstPixel) / SPARSE_SPACING) + 1);
  const indexes = new Uint32Array(capacity);
  let write = capacity;
  for (let i = last; i >= first;) {
    indexes[--write] = i;
    let low = first;
    let high = i;
    // Search the projected distance directly so an exact 80 px tie uses the same slot as the walk.
    while (low < high) {
      const mid = low + ((high - low) >>> 1);
      if (Math.abs(previous - affinePosition(affine, x[mid]!)) >= SPARSE_SPACING) low = mid + 1;
      else high = mid;
    }
    i = low - 1;
    while (i >= first && slot[i] !== SLOT_VALUE) i--;
    if (i >= first) previous = affinePosition(affine, x[i]!);
  }
  return indexes.subarray(write);
}

function markerIndexes(
  input: LineInput & Drawing, range: IndexRange, isolated: Uint32Array, compact: boolean,
): Uint32Array {
  if (compact) return isolated;
  const { slot, x, mapX, affineX } = input;
  if (affineX && affineX.slope !== 0 && range.end - range.start > 64 && isolated.length === 0) {
    const markers = denseMarkers(input, range, affineX);
    if (markers) return markers;
  }
  const pixelAt = affineX ? (i: number) => affinePosition(affineX, x[i]!) : (i: number) => mapX(x[i]!);
  let count = 0;
  let first = range.end;
  let last = range.start;
  let previousPixel = 0;
  let showAll = true;
  for (let i = range.start; i < range.end; i++) {
    if (slot[i] !== SLOT_VALUE) continue;
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
    if (slot[i] !== SLOT_VALUE) continue;
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
  input: LineInput & Drawing, view: AlignedView, series: number, visible: IndexRange, compact: boolean,
  paths: PathMark[], points: PointMark[], selection: JoinedRuns = simplifyLine(input), packed?: Float32Array,
): void {
  const cue = view.cues[series]!;
  // A single slot in an author domain can have joined neighbours outside the drawing.
  const singlePoint = input.range.end - input.range.start === 1 && selection.indexes.length === 1;
  if (selection.indexes.length && !singlePoint) {
    const xy = packed && selection.breaks.length === 0 ? packed : buildPath(selection.indexes, selection.breaks, input);
    paths.push({
      type: 'path', series, xy, stroke: seriesPaint(series),
      strokeWidth: 2, dash: cue.dash,
    });
  }
  const markers = markerIndexes(input, visible, singlePoint ? selection.indexes : selection.isolated, compact);
  if (markers.length) points.push(pointMark(series, cue, buildPoints(markers, input)));
}

export function scatterPoints(view: ScatterView, projection: XY): PointMark[] {
  const result: PointMark[] = [];
  for (let i = 0; i < view.frame.series.length; i++) {
    if (!view.visible[i]) continue;
    const { x, y } = view.frame.series[i]!;
    const { start, end } = view.visiblePoints[i]!;
    const xy = new Float32Array(2 * (end - start));
    for (let index = start, out = 0; index < end; index++) {
      xy[out++] = position(projection.x, x[index]!);
      xy[out++] = position(projection.y, y[index]!);
    }
    result.push(pointMark(i, view.cues[i]!, xy));
  }
  return result;
}

