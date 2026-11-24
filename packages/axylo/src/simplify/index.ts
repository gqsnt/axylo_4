import { SLOT_GAP, SLOT_NO_ROW, SLOT_VALUE } from '../core/contracts';
import type { AlignedFrame, AreaMark, ContinuousScale, IndexRange, PathMark, PointMark, StackView, XScale } from '../core/contracts';
import { affinePosition, type AffineProjection } from '../scene/geometry';

type Values = Float64Array | Float32Array;
type XMap = XScale | ((x: number) => number);
type YMap = ContinuousScale | ((y: number) => number);

export interface JoinedRuns {
  /** Source slot indexes of joined runs, including runs that continue outside the range. */
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
  readonly affineX?: AffineProjection;
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
  readonly affineX?: AffineProjection;
  readonly mapY: YMap;
  readonly affineY?: AffineProjection;
}

interface Columns {
  readonly x: Float64Array;
  readonly y: Values | 0;
  readonly map: (x: number) => number;
  readonly affine?: AffineProjection;
  readonly ratio: number;
}

interface IndexBuffer {
  data: Uint32Array;
  readonly limit: number;
}

function reserve(buffer: IndexBuffer, length: number): Uint32Array {
  if (length <= buffer.data.length) return buffer.data;
  const data = new Uint32Array(Math.max(length, Math.min(buffer.limit, 2 * buffer.data.length)));
  data.set(buffer.data);
  return buffer.data = data;
}

function joinedNeighbor(slot: Uint8Array, from: number, step: -1 | 1): boolean {
  const noRow = SLOT_NO_ROW;
  let i = from;
  while (slot[i] === noRow) i += step;
  return slot[i] === SLOT_VALUE;
}

function xMapper(scale: XMap): (x: number) => number {
  if (typeof scale === 'function') return scale;
  return scale.type === 'band' ? x => scale.center(x) : x => scale.map(x);
}

function keepColumn(
  buffer: IndexBuffer, cursor: number, first: number, last: number, min: number, max: number,
): number {
  // An extreme may also be an endpoint. Emit each slot once and in source order.
  const earlier = Math.min(min, max);
  const later = Math.max(min, max);
  const indexes = reserve(buffer, cursor + Math.min(4, last - first + 1, buffer.limit - cursor));
  indexes[cursor++] = first;
  if (earlier > first && earlier < last) indexes[cursor++] = earlier;
  if (later > earlier && later < last) indexes[cursor++] = later;
  if (last > first) indexes[cursor++] = last;
  return cursor;
}

function keepRun(
  slot: Uint8Array | null, from: number, to: number, columns: Columns, indexes: IndexBuffer, cursor: number,
): number {
  const { affine, x, y, map, ratio } = columns;
  const valueSlot = SLOT_VALUE;
  let column = NaN;
  let first = from;
  let last = -1;
  let min = -1;
  let max = -1;
  let low = 0;
  let high = 0;
  for (let i = from; i <= to; i++) {
    if (slot && slot[i] !== valueSlot) continue;
    const sample = x[i]!;
    const pixel = Math.floor((affine ? affinePosition(affine, sample) : map(sample)) * ratio);
    const value = y === 0 ? 0 : y[i]!;
    if (pixel !== column) {
      if (last >= 0) cursor = keepColumn(indexes, cursor, first, last, min, max);
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
  }
  return keepColumn(indexes, cursor, first, last, min, max);
}

function scan(slot: Uint8Array, range: IndexRange) {
  const valueSlot = SLOT_VALUE;
  const noRow = SLOT_NO_ROW;
  const gap = SLOT_GAP;
  let values = 0;
  let vertices = 0;
  let runCount = 0;
  let singles = 0;
  let runFirst = -1;
  let runLast = -1;
  let runValues = 0;
  const { start, end } = range;
  const length = end - start;
  const runs: IndexBuffer = { data: new Uint32Array(Math.min(12, 3 * length)), limit: 3 * length };
  const isolated: IndexBuffer = { data: new Uint32Array(0), limit: length };
  let joinsBefore = start < end && joinedNeighbor(slot, start - 1, -1);
  const joinsAfter = start < end && joinedNeighbor(slot, end, 1);

  for (let i = start; i <= end; i++) {
    const state = i < end ? slot[i] : gap;
    if (state === valueSlot) {
      if (runValues === 0) runFirst = i;
      let next = i + 1;
      while (next < end && slot[next] === valueSlot) next++;
      runValues += next - i;
      runLast = next - 1;
      i = runLast;
      continue;
    }
    if (state === noRow) continue;
    if (runValues > 0) {
      values += runValues;
      if (runValues === 1 && !joinsBefore && !(i === end && joinsAfter)) {
        reserve(isolated, singles + 1)[singles++] = runFirst;
      } else {
        const offset = 3 * runCount++;
        const bounds = reserve(runs, offset + 3);
        bounds[offset] = runFirst;
        bounds[offset + 1] = runLast;
        bounds[offset + 2] = runValues;
        vertices += runValues;
      }
      runValues = 0;
    }
    joinsBefore = false;
  }
  return { values, vertices, runCount, runs: runs.data, isolated: isolated.data.subarray(0, singles) };
}

function select(slot: Uint8Array, range: IndexRange, limit: number, columns?: Columns) {
  const size = scan(slot, range);
  const dense = columns !== undefined && size.values > limit;
  const buffer: IndexBuffer = {
    data: new Uint32Array(dense ? Math.min(size.vertices, limit + 4 * size.runCount + 4) : size.vertices),
    limit: size.vertices,
  };
  const breaks = new Uint32Array(Math.max(0, size.runCount - 1));
  let cursor = 0;
  for (let run = 0; run < size.runCount; run++) {
    const first = size.runs[3 * run]!;
    const last = size.runs[3 * run + 1]!;
    const contiguous = last - first + 1 === size.runs[3 * run + 2];
    if (run) breaks[run - 1] = cursor;
    if (dense) cursor = keepRun(contiguous ? null : slot, first, last, columns, buffer, cursor);
    else for (let index = first; index <= last; index++) {
      if (contiguous || slot[index] === SLOT_VALUE) buffer.data[cursor++] = index;
    }
  }
  const selection: JoinedRuns = { indexes: buffer.data.subarray(0, cursor), breaks, isolated: size.isolated };
  return { selection, dense };
}

export function joinRuns(slot: Uint8Array, range: IndexRange): JoinedRuns {
  return select(slot, range, Infinity).selection;
}

function columnLimit({ width, left, devicePixelRatio: ratio }: Pick<DrawingInput, 'width' | 'left' | 'devicePixelRatio'>): number {
  return width > 0 ? 4 * (Math.ceil((left + width) * ratio) - Math.floor(left * ratio)) : 0;
}

function simplifyBoundary(input: DrawingInput, y: Values | 0) {
  const { range, devicePixelRatio: ratio } = input;
  const limit = columnLimit(input);
  const columns = range.end - range.start <= limit ? undefined
    : { x: input.x, y, map: xMapper(input.mapX), affine: input.affineX, ratio };
  return select(input.slot, range, limit, columns);
}

export function simplifyLine(input: LineInput): JoinedRuns {
  return simplifyBoundary(input, input.y).selection;
}

/** Common source vertices keep neighboring cumulative edges ordered between samples as well as at them. */
export function stackIndexes(
  input: Omit<DrawingInput, 'slot' | 'range'>, frame: AlignedFrame, stack: StackView, range: IndexRange,
): Uint32Array {
  const { start, end } = range;
  const size = end - start;
  const limit = columnLimit(input);
  if (size <= limit) return Uint32Array.from({ length: size }, (_, i) => i);
  const kept = new Uint8Array(size);
  const scratch = new Uint32Array(size);
  const buffer: IndexBuffer = { data: scratch, limit: size };
  const columns: Columns = { x: input.x, map: xMapper(input.mapX), affine: input.affineX, ratio: input.devicePixelRatio, y: 0 };
  for (let k = 0; k < stack.order.length; k++) {
    const { y, slot } = frame.series[stack.order[k]!]!;
    for (const values of [stack.positive[k]!, stack.negative[k]!]) {
      const edge = { ...columns, y: values };
      let first = start;
      for (let i = start + 1; i <= end; i++) {
        // Keep both ends of every pinch, including zero and wholly missing stretches.
        if (i < end && slot[i] === slot[first] && (slot[i] !== SLOT_VALUE || Math.sign(y[i]!) === Math.sign(y[first]!))) continue;
        const count = keepRun(null, first, i - 1, edge, buffer, 0);
        for (let j = 0; j < count; j++) kept[scratch[j]! - start] = 1;
        first = i;
      }
    }
  }
  // Keep the adjacent interval exact where the viewport clips the drawing.
  kept[1] = kept[size - 2] = 1;
  let count = 0;
  for (let i = 0; i < size; i++) if (kept[i]) scratch[count++] = i;
  return scratch.slice(0, count);
}

function yMapper(map: YMap): (value: number) => number {
  return typeof map === 'function' ? map : value => map.map(value);
}

function pack(indexes: Uint32Array, breaks: Uint32Array | null, input: PathInput): Float32Array {
  const xy = new Float32Array(2 * (indexes.length + (breaks?.length ?? 0)));
  const { x, y, mapY, affineX, affineY } = input;
  const toX = xMapper(input.mapX);
  const toY = yMapper(mapY);
  let cursor = 0;
  let nextBreak = 0;
  for (let i = 0; i < indexes.length; i++) {
    if (breaks && i === breaks[nextBreak]) {
      xy[cursor++] = NaN;
      xy[cursor++] = NaN;
      nextBreak++;
    }
    const index = indexes[i]!;
    const sample = x[index]!;
    const value = y === 0 ? 0 : y[index]!;
    xy[cursor++] = affineX ? affinePosition(affineX, sample) : toX(sample);
    xy[cursor++] = affineY ? affinePosition(affineY, value) : toY(value);
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
  readonly affineY?: AffineProjection;
}

export interface AreaBoundary {
  readonly xy: Float32Array;
  readonly selection: JoinedRuns;
  readonly values: Values;
  readonly source: AreaSource;
}

export interface AreaInput extends AreaSource {
  readonly upper: Values;
  /** Pass 0 for an unstacked baseline or the previous band's upperBoundary for a shared edge. */
  readonly lower: Float64Array | 0 | AreaBoundary;
}

export interface SimplifiedArea extends Pick<AreaMark, 'upper' | 'lower' | 'runs'> {
  readonly upperBoundary: AreaBoundary;
  /** These slots need point marks because a single x cannot enclose an area. */
  readonly isolated: Uint32Array;
}

function prepareBoundary(input: AreaSource, values: Values, selection: JoinedRuns): AreaBoundary {
  return { selection, values, source: input, xy: buildPoints(selection.indexes, { ...input, y: values }) };
}

function canShare(previous: AreaSource, next: AreaSource): boolean {
  if (previous.x !== next.x || previous.mapX !== next.mapX || previous.mapY !== next.mapY ||
      previous.affineX?.slope !== next.affineX?.slope || previous.affineX?.offset !== next.affineX?.offset ||
      previous.affineX?.exact !== next.affineX?.exact || previous.affineY?.slope !== next.affineY?.slope ||
      previous.affineY?.offset !== next.affineY?.offset || previous.affineY?.exact !== next.affineY?.exact ||
      previous.range.start !== next.range.start || previous.range.end !== next.range.end ||
      previous.left !== next.left || previous.width !== next.width ||
      previous.devicePixelRatio !== next.devicePixelRatio) return false;
  if (previous.slot === next.slot) return true;
  if (joinedNeighbor(previous.slot, next.range.start - 1, -1) !== joinedNeighbor(next.slot, next.range.start - 1, -1) ||
      joinedNeighbor(previous.slot, next.range.end, 1) !== joinedNeighbor(next.slot, next.range.end, 1)) return false;
  for (let i = next.range.start; i < next.range.end; i++) {
    const a = previous.slot[i];
    const b = next.slot[i];
    if (a !== b && (a === SLOT_VALUE || b === SLOT_VALUE || a === SLOT_NO_ROW || b === SLOT_NO_ROW)) return false;
  }
  return true;
}

export function simplifyArea(input: AreaInput): SimplifiedArea {
  const { upper, lower, ...source } = input;
  const { selection: upperSelection, dense } = simplifyBoundary(source, upper);
  const upperBoundary = prepareBoundary(source, upper, upperSelection);
  const runs = new Uint32Array(upperSelection.indexes.length === 0 ? 0 : 4 * (upperSelection.breaks.length + 1));
  if (lower === 0 && dense) {
    const upperXY = upperBoundary.xy;
    const lowerXY = new Float32Array(runs.length);
    const baseline = source.affineY ? affinePosition(source.affineY, 0) : yMapper(source.mapY)(0);
    let upperStart = 0;
    let lowerStart = 0;
    for (let run = 0; run * 4 < runs.length; run++) {
      const upperEnd = upperSelection.breaks[run] ?? upperSelection.indexes.length;
      const count = upperEnd - upperStart;
      runs[run * 4] = upperStart;
      runs[run * 4 + 1] = count;
      runs[run * 4 + 2] = lowerStart;
      runs[run * 4 + 3] = Math.min(count, 2);
      lowerXY[2 * lowerStart] = upperXY[2 * upperStart]!;
      lowerXY[2 * lowerStart++ + 1] = baseline;
      if (count > 1) {
        lowerXY[2 * lowerStart] = upperXY[2 * (upperEnd - 1)]!;
        lowerXY[2 * lowerStart++ + 1] = baseline;
      }
      upperStart = upperEnd;
    }
    return { upper: upperXY, lower: lowerXY.subarray(0, 2 * lowerStart), runs, upperBoundary, isolated: upperSelection.isolated };
  }

  let lowerSelection: JoinedRuns;
  let lowerXY: Float32Array;
  if (lower === 0) {
    lowerSelection = upperSelection;
    lowerXY = buildPoints(upperSelection.indexes, { ...source, y: 0 });
  } else if (lower instanceof Float64Array) {
    lowerSelection = simplifyBoundary(source, lower).selection;
    lowerXY = buildPoints(lowerSelection.indexes, { ...source, y: lower });
  } else {
    const boundary = canShare(lower.source, source) ? lower
      : prepareBoundary(source, lower.values, simplifyBoundary(source, lower.values).selection);
    lowerSelection = boundary.selection;
    lowerXY = boundary.xy;
  }

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
