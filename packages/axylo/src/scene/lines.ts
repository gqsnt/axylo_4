import {
  SLOT_VALUE, type AlignedView, type IndexRange, type PathMark, type PointMark, type Projection,
  type Rect, type ScatterView, type SeriesCue,
} from '../core/contracts';
import { buildPath, buildPoints, simplifyLine, type JoinedRuns, type LineInput } from '../simplify';
import { position, seriesPaint } from './geometry';

export type XY = Extract<Projection, { kind: 'xy' }>;
export type Drawing = Omit<LineInput, 'y' | 'slot' | 'range'> & {
  readonly mapX: (x: number) => number;
  readonly mapY: (y: number) => number;
};

export function drawing(x: Float64Array, xy: XY, plot: Rect, devicePixelRatio: number): Drawing {
  return {
    x, mapX: value => position(xy.x, value), mapY: value => position(xy.y, value),
    left: plot.x, width: plot.width, devicePixelRatio,
  };
}

function markerIndexes(
  input: LineInput & Drawing, range: IndexRange, isolated: Uint32Array, compact: boolean,
): Uint32Array {
  if (compact) return isolated;
  const { slot, x, mapX } = input;
  let count = 0;
  let first = range.end;
  let last = range.start;
  for (let i = range.start; i < range.end; i++) {
    if (slot[i] !== SLOT_VALUE) continue;
    if (count++ === 0) first = i;
    last = i;
  }
  if (!count) return isolated;
  const span = Math.abs(mapX(x[last]!) - mapX(x[first]!));
  const showAll = count <= 1 || span >= 12 * (count - 1);
  const capacity = showAll ? count : Math.min(count, Math.floor(span / 80) + 1 + isolated.length);
  const indexes = new Uint32Array(capacity);
  let write = capacity;
  let previous = Infinity;
  let single = isolated.length - 1;
  // Walk back from the last observed value so the series always has its identity at that end.
  for (let i = last; i >= first; i--) {
    if (slot[i] !== SLOT_VALUE) continue;
    const pixel = mapX(x[i]!);
    const required = isolated[single] === i;
    if (required) single--;
    if (showAll || required || Math.abs(previous - pixel) >= 80) {
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
  paths: PathMark[], points: PointMark[], selection: JoinedRuns = simplifyLine(input),
): void {
  const cue = view.cues[series]!;
  if (selection.indexes.length) {
    paths.push({
      type: 'path', series, xy: buildPath(selection.indexes, selection.breaks, input), stroke: seriesPaint(series),
      strokeWidth: 2, dash: cue.dash,
    });
  }
  const markers = markerIndexes(input, visible, selection.isolated, compact);
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

