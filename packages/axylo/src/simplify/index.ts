import { SLOT_GAP, SLOT_NO_ROW, SLOT_VALUE } from '../core/contracts';
import type { AreaMark, ContinuousScale, IndexRange, PathMark, PointMark, XScale } from '../core/contracts';

type Values = Float64Array | Float32Array;
type XMap = XScale | ((x: number) => number);
type YMap = ContinuousScale | ((y: number) => number);

export interface JoinedRuns {
  /** Source slot indexes of runs with at least two values. */
  readonly indexes: Uint32Array;
  /** Offsets into indexes at which a new run starts, excluding the first run. */
  readonly breaks: Uint32Array;
  readonly isolated: Uint32Array;
}

interface DrawingInput {
  readonly x: Float64Array;
  readonly slot: Uint8Array;
  readonly range: IndexRange;
  /** The x projection is monotone in source order, so each column is visited once per run. */
  readonly mapX: XMap;
  readonly left: number;
  readonly width: number;
  readonly devicePixelRatio: number;
}

export interface LineInput extends DrawingInput {
  readonly y: Values;
}

export interface PathInput {
  readonly x: Float64Array;
  readonly y: Values | 0;
  readonly mapX: XMap;
  readonly mapY: YMap;
}

interface Columns {
  readonly x: Float64Array;
  readonly y: Values | 0;
  readonly map: (x: number) => number;
  readonly ratio: number;
}

function xMapper(scale: XMap): (x: number) => number {
  if (typeof scale === 'function') return scale;
  return scale.type === 'band' ? x => scale.center(x) : x => scale.map(x);
}

function keepColumn(
  indexes: Uint32Array | undefined, cursor: number, first: number, last: number, min: number, max: number,
): number {
  // An extreme may also be an endpoint. Emit each slot once and in source order.
  const earlier = Math.min(min, max);
  const later = Math.max(min, max);
  if (indexes) indexes[cursor] = first;
  cursor++;
  if (earlier > first && earlier < last) {
    if (indexes) indexes[cursor] = earlier;
    cursor++;
  }
  if (later > earlier && later < last) {
    if (indexes) indexes[cursor] = later;
    cursor++;
  }
  if (last > first) {
    if (indexes) indexes[cursor] = last;
    cursor++;
  }
  return cursor;
}

function scan(slot: Uint8Array, range: IndexRange, columns?: Columns, output?: JoinedRuns) {
  const indexes = output?.indexes;
  const valueSlot = SLOT_VALUE;
  const noRow = SLOT_NO_ROW;
  const gap = SLOT_GAP;
  let values = 0;
  let vertices = 0;
  let breaks = 0;
  let isolated = 0;
  let runStart = 0;
  let runFirst = -1;
  let runLast = -1;
  let column = 0;
  let first = -1;
  let last = -1;
  let min = -1;
  let max = -1;
  let low = 0;
  let high = 0;
  const { start, end } = range;

  for (let i = start; i <= end; i++) {
    const state = i < end ? slot[i] : gap;
    if (state !== valueSlot) {
      if (state === noRow || runFirst < 0) continue;
      if (runFirst === runLast) {
        if (output) output.isolated[isolated] = runFirst;
        isolated++;
      } else {
        if (columns) vertices = keepColumn(indexes, vertices, first, last, min, max);
        if (runStart > 0) {
          if (output) output.breaks[breaks] = runStart;
          breaks++;
        }
      }
      runFirst = -1;
      runLast = -1;
      continue;
    }

    values++;
    if (runFirst < 0) {
      runFirst = i;
      runStart = vertices;
    }

    if (columns) {
      const pixel = Math.floor(columns.map(columns.x[i]!) * columns.ratio);
      const value = columns.y === 0 ? 0 : columns.y[i]!;
      if (runLast < 0 || pixel !== column) {
        if (runLast >= 0) vertices = keepColumn(indexes, vertices, first, last, min, max);
        column = pixel;
        first = min = max = i;
        low = high = value;
      } else {
        if (value < low) {
          low = value;
          min = i;
        }
        if (value > high) {
          high = value;
          max = i;
        }
      }
      last = i;
    } else if (runLast >= 0) {
      if (runLast === runFirst) {
        if (indexes) indexes[vertices] = runFirst;
        vertices++;
      }
      if (indexes) indexes[vertices] = i;
      vertices++;
    }
    runLast = i;
  }
  return { values, vertices, breaks, isolated };
}

function select(slot: Uint8Array, range: IndexRange, limit: number, columns?: Columns): JoinedRuns {
  const size = scan(slot, range, columns);
  const dense = size.values > limit;
  const output: JoinedRuns = {
    indexes: new Uint32Array(dense ? size.vertices : size.values - size.isolated),
    breaks: new Uint32Array(size.breaks),
    isolated: new Uint32Array(size.isolated),
  };
  scan(slot, range, dense ? columns : undefined, output);
  return output;
}

export function joinRuns(slot: Uint8Array, range: IndexRange): JoinedRuns {
  return select(slot, range, Infinity);
}

function simplifyBoundary(input: DrawingInput, y: Values | 0): JoinedRuns {
  const { left, width, devicePixelRatio: ratio, range } = input;
  const columns = width > 0 ? Math.ceil((left + width) * ratio) - Math.floor(left * ratio) : 0;
  const limit = 4 * columns;
  if (range.end - range.start <= limit) return joinRuns(input.slot, range);
  return select(input.slot, range, limit, { x: input.x, y, map: xMapper(input.mapX), ratio });
}

export function simplifyLine(input: LineInput): JoinedRuns {
  return simplifyBoundary(input, input.y);
}

function pack(indexes: Uint32Array, breaks: Uint32Array | null, input: PathInput): Float32Array {
  const xy = new Float32Array(2 * (indexes.length + (breaks?.length ?? 0)));
  const { x, y, mapY } = input;
  const toX = xMapper(input.mapX);
  const toY = typeof mapY === 'function' ? mapY : (value: number) => mapY.map(value);
  let cursor = 0;
  let nextBreak = 0;
  for (let i = 0; i < indexes.length; i++) {
    if (breaks && i === breaks[nextBreak]) {
      xy[cursor++] = NaN;
      xy[cursor++] = NaN;
      nextBreak++;
    }
    const index = indexes[i]!;
    xy[cursor++] = toX(x[index]!);
    xy[cursor++] = toY(y === 0 ? 0 : y[index]!);
  }
  return xy;
}

export function buildPath(indexes: Uint32Array, breaks: Uint32Array, input: PathInput): PathMark['xy'] {
  return pack(indexes, breaks, input);
}

export function buildPoints(indexes: Uint32Array, input: PathInput): PointMark['xy'] {
  return pack(indexes, null, input);
}

interface AreaSource extends DrawingInput {
  readonly mapY: YMap;
}

export interface AreaBoundary {
  readonly xy: Float32Array;
  readonly selection: JoinedRuns;
  readonly values: Float64Array;
  readonly source: AreaSource;
}

export interface AreaInput extends AreaSource {
  readonly upper: Float64Array;
  /** Pass 0 for an unstacked baseline or the previous band's upperBoundary for a shared edge. */
  readonly lower: Float64Array | 0 | AreaBoundary;
}

export interface SimplifiedArea extends Pick<AreaMark, 'upper' | 'lower' | 'runs'> {
  readonly upperBoundary: AreaBoundary;
  /** These slots need point marks because a single x cannot enclose an area. */
  readonly isolated: Uint32Array;
}

function prepareBoundary(input: AreaSource, values: Float64Array): AreaBoundary {
  const selection = simplifyBoundary(input, values);
  return { selection, values, source: input, xy: buildPoints(selection.indexes, { ...input, y: values }) };
}

function canShare(previous: AreaSource, next: AreaSource): boolean {
  if (previous.x !== next.x || previous.mapX !== next.mapX || previous.mapY !== next.mapY ||
      previous.range.start !== next.range.start || previous.range.end !== next.range.end ||
      previous.left !== next.left || previous.width !== next.width ||
      previous.devicePixelRatio !== next.devicePixelRatio) return false;
  if (previous.slot === next.slot) return true;
  for (let i = next.range.start; i < next.range.end; i++) {
    const a = previous.slot[i];
    const b = next.slot[i];
    if (a !== b && (a === SLOT_VALUE || b === SLOT_VALUE || a === SLOT_NO_ROW || b === SLOT_NO_ROW)) return false;
  }
  return true;
}

export function simplifyArea(input: AreaInput): SimplifiedArea {
  const { upper, lower, ...source } = input;
  const upperBoundary = prepareBoundary(source, upper);
  const upperSelection = upperBoundary.selection;
  let lowerSelection: JoinedRuns;
  let lowerXY: Float32Array;
  if (lower === 0 || lower instanceof Float64Array) {
    lowerSelection = simplifyBoundary(source, lower);
    lowerXY = buildPoints(lowerSelection.indexes, { ...source, y: lower });
  } else {
    const boundary = canShare(lower.source, source) ? lower : prepareBoundary(source, lower.values);
    lowerSelection = boundary.selection;
    lowerXY = boundary.xy;
  }

  const runs = new Uint32Array(upperSelection.indexes.length === 0 ? 0 : 4 * (upperSelection.breaks.length + 1));
  let upperStart = 0;
  let lowerStart = 0;
  for (let run = 0; run * 4 < runs.length; run++) {
    const upperEnd = upperSelection.breaks[run] ?? upperSelection.indexes.length;
    const lowerEnd = lowerSelection.breaks[run] ?? lowerSelection.indexes.length;
    runs[run * 4] = upperStart;
    runs[run * 4 + 1] = upperEnd - upperStart;
    runs[run * 4 + 2] = lowerStart;
    runs[run * 4 + 3] = lowerEnd - lowerStart;
    upperStart = upperEnd;
    lowerStart = lowerEnd;
  }

  return { upper: upperBoundary.xy, lower: lowerXY, runs, upperBoundary, isolated: upperSelection.isolated };
}
