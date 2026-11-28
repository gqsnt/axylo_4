import {
  SLOT_VALUE, type AlignedView, type IndexRange, type PathMark, type PointMark, type Projection,
  type Rect, type ScatterView, type SeriesCue,
} from '../core/contracts';
import { buildPath, buildPoints, emptyIndexes, simplifiedPath, unthinnedPath, type JoinedRuns, type LineInput, type LineSource } from '../simplify';
import { affinePosition, affineProjection, exactProjection, position, seriesPaint, type AffineProjection } from './geometry';

const MARKER_SIZE = 6;
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
    const far = (idx: number) => Math.abs(previous - affinePosition(affine, x[idx]!)) >= SPARSE_SPACING;
    const guess = Math.max(first, i - stride);
    if (far(guess)) {
      low = guess + 1;
      if (low < high && !far(low)) high = low;
    } else {
      high = guess;
      if (low < high && far(high - 1)) low = high;
    }
    while (low < high) {
      const mid = low + ((high - low) >>> 1);
      if (far(mid)) low = mid + 1;
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
  return { type: 'points', series, xy, shape: cue.marker, size: MARKER_SIZE, fill: seriesPaint(series) };
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

// A series is filled as one nonzero SVG path, even when its paint resolves to a translucent colour.
// A retained radius-three disk witnesses each covered tile, independent of the paint.
// Each byte stores eight unit tiles. Uint16 loads span a byte boundary even when
// a witness or its bounding box straddles the last bit of a byte.
function coveredCircles(xy: Float32Array, projection: XY): Float32Array {
  const [x0, x1] = projection.x.range, [y0, y1] = projection.y.range;
  const left = Math.floor(Math.min(x0, x1)), top = Math.floor(Math.min(y0, y1));
  const width = Math.ceil(Math.max(x0, x1) - left), height = Math.ceil(Math.max(y0, y1) - top);
  if (!(width > 8 && height > 8 && width * height <= 4_000_000 && Math.abs(left) + width + Math.abs(top) + height < 2 ** 24)) return xy;
  const stride = (width >> 3) + 2;
  const tiles = new DataView(new ArrayBuffer(stride * height));
  const keep = new Uint8Array(xy.length / 2);
  let interior = 0;
  // The farthest tile corner includes half a tile, half an eighth-pixel bin
  // and half the SVG encoder's tenth-pixel rounding step on each axis.
  const masks = new Uint8Array(64 * 5);
  const far = (tile: number, phase: number) => Math.abs(tile - 1.5 - (phase + 0.5) / 8) + 0.6125;
  for (let q = 0; q < 64; q++) {
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
      if (far(c, q & 7) ** 2 + far(r, q >> 3) ** 2 <= 9) masks[q * 5 + r]! |= 1 << c;
    }
  }
  // Spread the first witnesses across x-sorted input. Every centre is visited once.
  for (let pass = 0; pass < 17; pass++) for (let i = pass; i < keep.length; i += 17) {
    const x = xy[i * 2]! - left, y = xy[i * 2 + 1]! - top;
    if (!(x >= 4 && x < width - 4 && y >= 4 && y < height - 4)) {
      keep[i] = 1;
      continue;
    }
    interior++;
    const col = (x | 0) - 2, shift = col & 7;
    const q = (((x * 8) & 7) + ((y * 8) & 7) * 8) * 5;
    let row = ((y | 0) - 2) * stride + (col >> 3);
    for (let r = 0; r < 5; r++, row += stride) {
      const before = tiles.getUint16(row, true), mask = masks[q + r]! << shift;
      if ((before & mask) !== mask) {
        keep[i] = 1;
        tiles.setUint16(row, before | mask, true);
      }
    }
  }
  let out = 0;
  for (let i = 0; i < keep.length; i++) {
    const x = xy[2 * i]!, y = xy[2 * i + 1]!;
    if (!keep[i] && interior > 2000) {
      const col = Math.floor(x - left) - 3;
      let row = (Math.floor(y - top) - 3) * stride + (col >> 3);
      const mask = 127 << (col & 7);
      let covered = mask;
      for (let r = 0; r < 7; r++, row += stride) covered &= tiles.getUint16(row, true);
      if (covered === mask || x === xy[out - 2] && y === xy[out - 1]) {
        interior--;
        continue;
      }
    }
    xy[out++] = x;
    xy[out++] = y;
  }
  return out < xy.length ? xy.slice(0, out) : xy;
}

export function scatterProject(scale: XY['x'], fallback: typeof position) {
  const exact = exactProjection(scale);
  return (value: number) => {
    if (exact) {
      const fraction = (value - exact.start) / exact.span;
      if (fraction > 0 && fraction < 1) return exact.origin + fraction * exact.extent;
    }
    return fallback(scale, value);
  };
}

export function scatterPoints(view: ScatterView, projection: XY): PointMark[] {
  const result: PointMark[] = [];
  const mapX = scatterProject(projection.x, position), mapY = scatterProject(projection.y, position);
  for (let i = 0; i < view.frame.series.length; i++) {
    if (!view.visible[i]) continue;
    const { x, y } = view.frame.series[i]!;
    const { start, end } = view.visiblePoints[i]!;
    const xy = new Float32Array(2 * (end - start));
    for (let j = start, out = 0; j < end; j++) {
      xy[out++] = mapX(x[j]!);
      xy[out++] = mapY(y[j]!);
    }
    const cue = view.cues[i]!;
    result.push(pointMark(i, cue, MARKER_SIZE === 6 && cue.marker === 'circle' && xy.length > 4000 ? coveredCircles(xy, projection) : xy));
  }
  return result;
}

