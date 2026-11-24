import { SLOT_GAP, SLOT_NO_ROW, SLOT_VALUE } from '../core/contracts';
import type { AlignedFrame, AreaMark, ContinuousScale, IndexRange, PathMark, PointMark, StackView, XScale } from '../core/contracts';
import { affinePosition, position, type AffineProjection } from '../scene/geometry';

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
  /** Ordered x values from the same published frame as slot. */
  readonly x: Float64Array;
  /** View of a published frame; its elements stay fixed for the lifetime of the view. */
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
  /** View of a published frame, with the same lifetime guarantee as slot. */
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

const BLOCK_SIZE = 32;
const MIXED_BLOCK = 255;
const SELECTION_CACHE_BYTES = 192 * 1024;
const SELECTION_CACHE_ENTRIES = 24;
type ExactProjection = NonNullable<AffineProjection['exact']>;

interface SelectionCache {
  readonly x: Float64Array;
  readonly start: number;
  readonly end: number;
  readonly domainStart: number;
  readonly domainSpan: number;
  readonly origin: number;
  readonly ratio: number;
  readonly byExtent: Map<number, Uint32Array>;
  bytes: number;
}

interface BlockSummary {
  readonly blocks: Uint8Array;
  start: number;
  end: number;
  contiguous?: { readonly range: IndexRange; readonly result: ReturnType<typeof scan> };
  turns?: { readonly start: number; readonly end: number; readonly indexes: Uint32Array | null };
  selections?: SelectionCache;
}
const summaries = new WeakMap<Values, WeakMap<Uint8Array, BlockSummary>>();

function summarize(y: Values, slot: Uint8Array, { start, end }: IndexRange): BlockSummary {
  // Published series views are immutable. The store appends beyond them and copies an
  // exposed tail before filling it, so views sharing a backing buffer have separate keys.
  let bySlot = summaries.get(y);
  if (!bySlot) summaries.set(y, bySlot = new WeakMap());
  const count = Math.floor(Math.min(y.length, slot.length) / BLOCK_SIZE);
  let summary = bySlot.get(slot);
  if (summary?.blocks.length !== 2 * count) {
    bySlot.set(slot, summary = { blocks: new Uint8Array(2 * count), start: 0, end: 0 });
  }
  const { blocks } = summary;
  const begin = Math.ceil(start / BLOCK_SIZE);
  const stop = Math.min(count, Math.floor(end / BLOCK_SIZE));
  if (begin >= summary.start && stop <= summary.end) return summary;
  for (let block = begin; block < stop; block++) {
    const offset = 2 * block;
    if (blocks[offset]) continue;
    const first = block * BLOCK_SIZE;
    let low = y[first]!;
    let high = low;
    let min = 0;
    let max = 0;
    let i = 0;
    for (; i < BLOCK_SIZE && slot[first + i] === SLOT_VALUE; i++) {
      const value = y[first + i]!;
      if (Number.isNaN(low)) {
        low = high = value;
        min = max = i;
      } else {
        if (value < low) { low = value; min = i; }
        if (value > high) { high = value; max = i; }
      }
    }
    // Zero means uncomputed. A mixed block must be visited slot by slot to preserve gaps.
    blocks[offset] = i === BLOCK_SIZE ? min + 1 : MIXED_BLOCK;
    blocks[offset + 1] = max;
  }
  summary.start = begin;
  summary.end = stop;
  return summary;
}

function turningPoints(summary: BlockSummary, y: Values, start: number, end: number): Uint32Array | null {
  const cached = summary.turns;
  if (cached && start >= cached.start && end <= cached.end) return cached.indexes;
  // An earliest interior minimum must be below its predecessor and no higher than its successor.
  // The reverse holds for maxima. The column walk supplies the endpoints separately.
  // Cap the index at about one byte per six slots. Noisy runs use the block summaries.
  const indexes = new Uint32Array(Math.ceil((end - start) / 24));
  let count = 0;
  let before = y[start]!;
  let value = y[start + 1]!;
  let i = start + 1;
  for (; i + 1 < end; i++) {
    const after = y[i + 1]!;
    if (!Number.isFinite(before)) break;
    if ((value < before && value <= after) || (value > before && value >= after)) {
      if (count === indexes.length) break;
      indexes[count++] = i;
    }
    before = value;
    value = after;
  }
  const result = i + 1 === end && Number.isFinite(before) && Number.isFinite(value)
    ? indexes.subarray(0, count) : null;
  summary.turns = { start, end, indexes: result };
  return result;
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

function xMapper(scale: XMap, affine?: AffineProjection): (x: number) => number {
  if (affine) return affineMapper(affine);
  if (typeof scale === 'function') return scale;
  return scale.type === 'band' ? x => scale.center(x) : x => scale.map(x);
}

function keepColumn(
  indexes: Uint32Array, cursor: number, first: number, last: number, min: number, max: number,
): number {
  // An extreme may also be an endpoint. Emit each slot once and in source order.
  const earlier = Math.min(min, max);
  const later = Math.max(min, max);
  indexes[cursor++] = first;
  if (earlier > first && earlier < last) indexes[cursor++] = earlier;
  if (later > earlier && later < last) indexes[cursor++] = later;
  if (last > first) indexes[cursor++] = last;
  return cursor;
}

function appendColumn(
  buffer: IndexBuffer, cursor: number, first: number, last: number, min: number, max: number,
): number {
  const indexes = reserve(buffer, cursor + Math.min(4, last - first + 1, buffer.limit - cursor));
  return keepColumn(indexes, cursor, first, last, min, max);
}

function keepRun(
  slot: Uint8Array | null, from: number, to: number, columns: Columns, indexes: IndexBuffer, cursor: number,
): number {
  const { x, y, map, ratio } = columns;
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
    const pixel = Math.floor(map(sample) * ratio);
    const value = y === 0 ? 0 : y[i]!;
    if (pixel !== column) {
      if (last >= 0) cursor = appendColumn(indexes, cursor, first, last, min, max);
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
  return appendColumn(indexes, cursor, first, last, min, max);
}

function columnMapper(affine: AffineProjection, ratio: number, first: number, last: number) {
  const { exact, slope, offset } = affine;
  if (!exact) return (x: number) => Math.floor((slope * x + offset) * ratio);
  if (!hasMonotoneColumns(exact, first, last)) return;
  const { start, origin, span, extent } = exact;
  return (x: number) => Math.floor((origin + (x - start) / span * extent) * ratio);
}

function hasMonotoneColumns({ start, end, origin, edge, span, extent, bounded }: ExactProjection,
  first: number, last: number,
): boolean {
  // Column searches require monotonicity, including the scale's special-cased endpoints.
  return Number.isFinite(span) && span !== 0 && span === end - start && Number.isFinite(extent) &&
    origin + extent === edge && (bounded ||
      (Math.min(first, last) >= Math.min(start, end) && Math.max(first, last) <= Math.max(start, end)));
}

function selectionCache(
  summary: BlockSummary, x: Float64Array, { start, end }: IndexRange, exact: ExactProjection, ratio: number,
): SelectionCache {
  const cached = summary.selections;
  if (cached && cached.x === x && cached.start === start && cached.end === end &&
      cached.domainStart === exact.start && cached.domainSpan === exact.span &&
      cached.origin === exact.origin && cached.ratio === ratio) return cached;
  return summary.selections = {
    x, start, end, domainStart: exact.start, domainSpan: exact.span, origin: exact.origin, ratio,
    byExtent: new Map(), bytes: 0,
  };
}

function rememberSelection(cache: SelectionCache, extent: number, indexes: Uint32Array): void {
  if (indexes.byteLength > SELECTION_CACHE_BYTES) return;
  const { byExtent } = cache;
  while (cache.bytes + indexes.byteLength > SELECTION_CACHE_BYTES || byExtent.size >= SELECTION_CACHE_ENTRIES) {
    const oldest = byExtent.keys().next().value!;
    cache.bytes -= byExtent.get(oldest)!.byteLength;
    byExtent.delete(oldest);
  }
  // The caller owns the returned indexes, so only a private snapshot can be reused.
  byExtent.set(extent, indexes.slice());
  cache.bytes += indexes.byteLength;
}

function keepAffineRun(
  x: Float64Array, y: Values, from: number, to: number, pixel: (x: number) => number,
  firstColumn: number, lastColumn: number, blocks: Uint8Array, turns: Uint32Array | null,
  indexes: Uint32Array, cursor: number,
): number {
  let previousSize = Math.floor((to - from + 1) / (Math.abs(lastColumn - firstColumn) + 1));
  let turn = 0;
  if (turns) {
    let end = turns.length;
    while (turn < end) {
      const mid = turn + ((end - turn) >>> 1);
      if (turns[mid]! <= from) turn = mid + 1;
      else end = mid;
    }
  }
  for (let first = from, column = firstColumn; first <= to;) {
    let last = to;
    let nextColumn = lastColumn;
    if (column !== lastColumn) {
      // On regular x the previous column predicts the next edge within a slot or two.
      // Widen the search exponentially for irregular x, using the exact pixel calculation.
      last = first;
      let next = to;
      const guess = Math.min(first + previousSize, to);
      const guessColumn = pixel(x[guess]!);
      if (guessColumn === column) {
        last = guess;
        for (let step = 1; last + step < next; step *= 2) {
          const probe = last + step;
          const probeColumn = pixel(x[probe]!);
          if (probeColumn !== column) { next = probe; nextColumn = probeColumn; break; }
          last = probe;
        }
      } else {
        next = guess;
        nextColumn = guessColumn;
        for (let step = 1; next - step > last; step *= 2) {
          const probe = next - step;
          const probeColumn = pixel(x[probe]!);
          if (probeColumn === column) { last = probe; break; }
          next = probe;
          nextColumn = probeColumn;
        }
      }
      while (last + 1 < next) {
        const mid = last + ((next - last) >>> 1);
        const midColumn = pixel(x[mid]!);
        if (midColumn === column) last = mid;
        else { next = mid; nextColumn = midColumn; }
      }
    }
    previousSize = last - first + 1;
    let min = first;
    let max = first;
    let low = y[first]!;
    let high = low;
    if (turns) {
      while (turn < turns.length && turns[turn]! <= last) {
        const i = turns[turn++]!;
        const value = y[i]!;
        if (value < low) { low = value; min = i; }
        if (value > high) { high = value; max = i; }
      }
      const value = y[last]!;
      if (value < low) min = last;
      if (value > high) max = last;
    } else {
      let i = first;
      const fullStart = Math.min(last + 1, Math.ceil(first / BLOCK_SIZE) * BLOCK_SIZE);
      const fullEnd = last + 1 - (last + 1) % BLOCK_SIZE;
      for (; i < fullStart; i++) {
        const value = y[i]!;
        if (value < low) { low = value; min = i; }
        if (value > high) { high = value; max = i; }
      }
      for (; i < fullEnd; i += BLOCK_SIZE) {
        const offset = 2 * (i / BLOCK_SIZE);
        const earlierMin = i + blocks[offset]! - 1;
        const earlierMax = i + blocks[offset + 1]!;
        const blockLow = y[earlierMin]!;
        const blockHigh = y[earlierMax]!;
        if (blockLow < low) { low = blockLow; min = earlierMin; }
        if (blockHigh > high) { high = blockHigh; max = earlierMax; }
      }
      for (; i <= last; i++) {
        const value = y[i]!;
        if (value < low) { low = value; min = i; }
        if (value > high) { high = value; max = i; }
      }
    }
    cursor = keepColumn(indexes, cursor, first, last, min, max);
    first = last + 1;
    column = nextColumn;
  }
  return cursor;
}

function scan(slot: Uint8Array, range: IndexRange, blocks?: Uint8Array) {
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
      if (blocks) {
        while (next < end) {
          const block = next % BLOCK_SIZE === 0 ? blocks[2 * (next / BLOCK_SIZE)] : 0;
          if (block && block !== MIXED_BLOCK && next + BLOCK_SIZE <= end) next += BLOCK_SIZE;
          else if (slot[next] === valueSlot) next++;
          else break;
        }
      } else {
        while (next < end && slot[next] === valueSlot) next++;
      }
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
  const length = range.end - range.start;
  const affine = columns?.affine;
  const y = columns?.y;
  // Near the density threshold, most blocks would straddle device columns.
  const summary = affine && y && length >= 1024 && length >= 4 * limit && range.end <= y.length
    ? summarize(y, slot, range) : undefined;
  const blocks = summary?.blocks;
  const cached = summary?.contiguous;
  const size = cached?.range.start === range.start && cached.range.end === range.end
    ? cached.result : scan(slot, range, blocks);
  if (summary && size !== cached?.result && size.values === length) {
    summary.contiguous = { range: { ...range }, result: size };
  }
  const dense = columns !== undefined && size.values > limit;
  // Responsive layouts can revisit widths without changing their data or zoom.
  // Cache only the single-run case, after validating the exact column projection.
  let cache: SelectionCache | undefined;
  const exact = affine?.exact;
  if (dense && summary && exact && size.values === length) {
    const { x, ratio } = columns;
    if (hasMonotoneColumns(exact, x[range.start]!, x[range.end - 1]!)) {
      cache = selectionCache(summary, x, range, exact, ratio);
      const indexes = cache.byExtent.get(exact.extent);
      if (indexes) {
        return { selection: { indexes: indexes.slice(), breaks: new Uint32Array(0), isolated: size.isolated }, dense };
      }
    }
  }
  const buffer: IndexBuffer = {
    data: new Uint32Array(dense ? Math.min(size.vertices, limit + 4 * size.runCount + 4) : size.vertices),
    limit: size.vertices,
  };
  const breaks = new Uint32Array(Math.max(0, size.runCount - 1));
  let cursor = 0;
  for (let run = 0; run < size.runCount; run++) {
    const first = size.runs[3 * run]!;
    const last = size.runs[3 * run + 1]!;
    const runLength = last - first + 1;
    const contiguous = runLength === size.runs[3 * run + 2];
    if (run) breaks[run - 1] = cursor;
    if (dense && contiguous && summary && affine && y && runLength >= 2 * BLOCK_SIZE) {
      const { x, ratio } = columns;
      const pixel = columnMapper(affine, ratio, x[first]!, x[last]!);
      if (pixel) {
        const firstColumn = pixel(x[first]!);
        const lastColumn = pixel(x[last]!);
        const capacity = 4 * (Math.abs(lastColumn - firstColumn) + 1);
        if (capacity <= runLength) {
          const turns = size.values === runLength && runLength >= 4096
            ? turningPoints(summary, y, first, last + 1) : null;
          cursor = keepAffineRun(x, y, first, last, pixel, firstColumn, lastColumn, summary.blocks,
            turns, reserve(buffer, cursor + capacity), cursor);
          continue;
        }
      }
    }
    if (dense) cursor = keepRun(contiguous ? null : slot, first, last, columns, buffer, cursor);
    else for (let index = first; index <= last; index++) {
      if (contiguous || slot[index] === SLOT_VALUE) buffer.data[cursor++] = index;
    }
  }
  const selection: JoinedRuns = { indexes: buffer.data.subarray(0, cursor), breaks, isolated: size.isolated };
  if (cache && exact) rememberSelection(cache, exact.extent, selection.indexes);
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
    : { x: input.x, y, map: xMapper(input.mapX, input.affineX), affine: input.affineX, ratio };
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
  const columns: Columns = { x: input.x, map: xMapper(input.mapX, input.affineX), ratio: input.devicePixelRatio, y: 0 };
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

function interpolatesEndpoints({ start, end, origin, edge, span, extent }: ExactProjection): boolean {
  // The endpoints can bypass interpolation only when it returns the same bits, including signed zero.
  return !Object.is(origin, -0) && Object.is(origin + (start - start) / span * extent, origin) &&
    Object.is(origin + (end - start) / span * extent, edge);
}

function affineMapper(affine: AffineProjection): (value: number) => number {
  const { exact, slope, offset } = affine;
  if (!exact) return value => slope * value + offset;
  const { scale, start, end, origin, edge, span, extent, bounded } = exact;
  if (interpolatesEndpoints(exact)) {
    if (bounded) return value => origin + (value - start) / span * extent;
    const low = span > 0 ? start : end;
    const high = span > 0 ? end : start;
    return value => value >= low && value <= high
      ? origin + (value - start) / span * extent : position(scale, value);
  }
  return value => affinePosition(affine, value);
}

function pack(indexes: Uint32Array, breaks: Uint32Array | null, input: PathInput): Float32Array {
  const xy = new Float32Array(2 * (indexes.length + (breaks?.length ?? 0)));
  const { x, y, mapY, affineX, affineY } = input;
  const xExact = affineX?.exact;
  const yExact = affineY?.exact;
  if (!breaks?.length && y !== 0 && xExact?.bounded && yExact &&
      interpolatesEndpoints(xExact) && interpolatesEndpoints(yExact)) {
    const { start: xStart, origin: xOrigin, span: xSpan, extent: xExtent } = xExact;
    const { start: yStart, end: yEnd, origin: yOrigin, span: ySpan, extent: yExtent, bounded, scale } = yExact;
    const low = ySpan > 0 ? yStart : yEnd;
    const high = ySpan > 0 ? yEnd : yStart;
    for (let i = 0; i < indexes.length; i++) {
      const index = indexes[i]!;
      const value = y[index]!;
      xy[2 * i] = xOrigin + (x[index]! - xStart) / xSpan * xExtent;
      xy[2 * i + 1] = bounded || (value >= low && value <= high)
        ? yOrigin + (value - yStart) / ySpan * yExtent : position(scale, value);
    }
    return xy;
  }

  const toX = xMapper(input.mapX, affineX);
  const toY = affineY ? affineMapper(affineY) : yMapper(mapY);
  if (!breaks?.length) {
    for (let i = 0; i < indexes.length; i++) {
      const index = indexes[i]!;
      xy[2 * i] = toX(x[index]!);
      xy[2 * i + 1] = toY(y === 0 ? 0 : y[index]!);
    }
    return xy;
  }
  let cursor = 0;
  let nextBreak = 0;
  for (let i = 0; i < indexes.length; i++) {
    if (i === breaks[nextBreak]) {
      xy[cursor++] = NaN;
      xy[cursor++] = NaN;
      nextBreak++;
    }
    const index = indexes[i]!;
    const sample = x[index]!;
    const value = y === 0 ? 0 : y[index]!;
    xy[cursor++] = toX(sample);
    xy[cursor++] = toY(value);
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
