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
const SELECTION_CACHE_BYTES = 64 * 1024;
const SELECTION_CACHE_ENTRIES = 12;
const NO_INDEXES = new Uint32Array(0);
type ExactProjection = NonNullable<AffineProjection['exact']>;

interface SelectionCache {
  readonly x: Float64Array;
  readonly s: number;
  readonly e: number;
  readonly ds: number;
  readonly dn: number;
  readonly o: number;
  readonly r: number;
  readonly map: Map<number, Uint32Array>;
  bytes: number;
}

interface BlockSummary {
  readonly blocks: Uint8Array;
  s: number;
  e: number;
  uses: number;
  full?: IndexRange;
  sel?: SelectionCache;
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
    bySlot.set(slot, summary = { blocks: new Uint8Array(2 * count), s: 0, e: 0, uses: 0 });
  }
  const { blocks } = summary;
  const begin = Math.ceil(start / BLOCK_SIZE);
  const stop = Math.min(count, Math.floor(end / BLOCK_SIZE));
  if (begin >= summary.s && stop <= summary.e) return summary;
  for (let block = begin; block < stop; block++) {
    const offset = 2 * block;
    if (blocks[offset]) continue;
    const first = block * BLOCK_SIZE;
    let i = 0;
    while (i < BLOCK_SIZE && slot[first + i] === SLOT_VALUE && Number.isNaN(y[first + i])) i++;
    let low = y[first + i]!, high = low, min = i, max = i;
    for (; i < BLOCK_SIZE && slot[first + i] === SLOT_VALUE; i++) {
      const value = y[first + i]!;
      if (value < low) { low = value; min = i; }
      if (value > high) { high = value; max = i; }
    }
    // Zero means uncomputed. A mixed block must be visited slot by slot to preserve gaps.
    blocks[offset] = i === BLOCK_SIZE ? Math.min(min + 1, BLOCK_SIZE) : MIXED_BLOCK;
    blocks[offset + 1] = Math.min(max, BLOCK_SIZE - 1);
  }
  summary.s = begin;
  summary.e = stop;
  return summary;
}

function reserve(buffer: IndexBuffer, length: number): Uint32Array {
  if (length <= buffer.data.length) return buffer.data;
  const data = new Uint32Array(Math.max(length, Math.min(buffer.limit, 2 * buffer.data.length)));
  data.set(buffer.data);
  return buffer.data = data;
}

function joinedNeighbor(slot: Uint8Array, from: number, step: -1 | 1): boolean {
  let i = from;
  while (slot[i] === SLOT_NO_ROW) i += step;
  return slot[i] === SLOT_VALUE;
}

function xMapper(scale: XMap, affine?: AffineProjection): (x: number) => number {
  if (affine) return affineMapper(affine);
  return typeof scale === 'function' ? scale : scale.type === 'band' ? x => scale.center(x) : x => scale.map(x);
}

function keepColumn(
  indexes: Uint32Array, cursor: number, first: number, last: number, min: number, max: number,
): number {
  // An extreme may also be an endpoint. Emit each slot once and in source order.
  const earlier = Math.min(min, max), later = Math.max(min, max);
  indexes[cursor++] = first;
  if (earlier > first && earlier < last) indexes[cursor++] = earlier;
  if (later > earlier && later < last) indexes[cursor++] = later;
  if (last > first) indexes[cursor++] = last;
  return cursor;
}

function appendColumn(
  buffer: IndexBuffer, cursor: number, first: number, last: number, min: number, max: number,
): number {
  return keepColumn(reserve(buffer, cursor + Math.min(4, last - first + 1, buffer.limit - cursor)), cursor, first, last, min, max);
}

function keepRun(
  slot: Uint8Array | null, from: number, to: number, columns: Columns, indexes: IndexBuffer, cursor: number,
): number {
  const { x, y, map, ratio, affine } = columns;
  const exact = affine?.exact;
  const monotone = exact && hasMonotoneColumns(exact, x[from]!, x[to]!) && interpolatesEndpoints(exact);
  const start = exact?.start ?? 0, span = exact?.span ?? 1;
  const origin = exact?.origin ?? 0, extent = exact?.extent ?? 0;
  const simple = affine !== undefined && !exact;
  const slope = affine?.slope ?? 0, offset = affine?.offset ?? 0;
  let column = NaN, first = from, last = -1, min = -1, max = -1, low = 0, high = 0;
  for (let i = from; i <= to; i++) {
    if (slot && slot[i] !== SLOT_VALUE) continue;
    const at = x[i]!;
    const pixel = Math.floor((monotone ? origin + (at - start) / span * extent : simple ? slope * at + offset : map(at)) * ratio);
    const value = y === 0 ? 0 : y[i]!;
    if (pixel !== column) {
      if (last >= 0) cursor = appendColumn(indexes, cursor, first, last, min, max);
      column = pixel; first = min = max = i; low = high = value;
    } else {
      if (value < low) { low = value; min = i; }
      if (value > high) { high = value; max = i; }
    }
    last = i;
  }
  return appendColumn(indexes, cursor, first, last, min, max);
}

function hasMonotoneColumns({ start, end, origin, edge, span, extent, bounded }: ExactProjection, first: number, last: number): boolean {
  // Column searches require monotonicity, including the scale's special-cased endpoints.
  return Number.isFinite(span) && span !== 0 && span === end - start && Number.isFinite(extent) &&
    origin + extent === edge && (bounded || (Math.min(first, last) >= Math.min(start, end) && Math.max(first, last) <= Math.max(start, end)));
}

function selectionCache(
  summary: BlockSummary, x: Float64Array, { start, end }: IndexRange, exact: ExactProjection, ratio: number,
): SelectionCache {
  const c = summary.sel;
  if (c && c.x === x && c.s === start && c.e === end && c.ds === exact.start && c.dn === exact.span && c.o === exact.origin && c.r === ratio) return c;
  return summary.sel = { x, s: start, e: end, ds: exact.start, dn: exact.span, o: exact.origin, r: ratio, map: new Map(), bytes: 0 };
}

function rememberSelection(cache: SelectionCache, extent: number, indexes: Uint32Array): void {
  if (indexes.byteLength > SELECTION_CACHE_BYTES) return;
  const { map } = cache;
  while (cache.bytes + indexes.byteLength > SELECTION_CACHE_BYTES || map.size >= SELECTION_CACHE_ENTRIES) {
    const oldest = map.keys().next().value!;
    cache.bytes -= map.get(oldest)!.byteLength;
    map.delete(oldest);
  }
  // The caller owns the returned indexes, so only a private snapshot can be reused.
  map.set(extent, indexes.slice());
  cache.bytes += indexes.byteLength;
}

function keepAffineRun(
  x: Float64Array, y: Values, from: number, to: number, { exact, slope, offset }: AffineProjection, ratio: number,
  firstColumn: number, lastColumn: number, blocks: Uint8Array,
  indexes: Uint32Array, cursor: number,
): number {
  const start = exact?.start ?? 0, span = exact?.span ?? 1;
  const origin = exact?.origin ?? 0, extent = exact?.extent ?? 0;
  let prevSize = Math.floor((to - from + 1) / (Math.abs(lastColumn - firstColumn) + 1));
  for (let first = from, column = firstColumn; first <= to;) {
    let last = to, nextColumn = lastColumn;
    if (column !== lastColumn) {
      let next = to, step = Math.max(1, prevSize);
      last = first;
      while (last + step < next) {
        const p = last + step, at = x[p]!;
        const c = Math.floor((exact ? origin + (at - start) / span * extent : slope * at + offset) * ratio);
        if (c === column) { last = p; step *= 2; }
        else { next = p; nextColumn = c; break; }
      }
      while (last + 1 < next) {
        const mid = last + ((next - last) >>> 1), at = x[mid]!;
        const c = Math.floor((exact ? origin + (at - start) / span * extent : slope * at + offset) * ratio);
        if (c === column) last = mid;
        else { next = mid; nextColumn = c; }
      }
    }
    prevSize = last - first + 1;
    let min = first, max = first, low = y[first]!, high = low;
    let i = first;
    const blockStart = Math.min(last + 1, Math.ceil(i / BLOCK_SIZE) * BLOCK_SIZE);
    const blockEnd = Math.floor((last + 1) / BLOCK_SIZE) * BLOCK_SIZE;
    for (; i < blockStart; i++) {
      const value = y[i]!;
      if (value < low) { low = value; min = i; }
      if (value > high) { high = value; max = i; }
    }
    for (; i < blockEnd; i += BLOCK_SIZE) {
      const o = i / (BLOCK_SIZE / 2), eMin = i + blocks[o]! - 1, eMax = i + blocks[o + 1]!;
      const bLow = y[eMin]!, bHigh = y[eMax]!;
      if (bLow < low) { low = bLow; min = eMin; }
      if (bHigh > high) { high = bHigh; max = eMax; }
    }
    for (; i <= last; i++) {
      const value = y[i]!;
      if (value < low) { low = value; min = i; }
      if (value > high) { high = value; max = i; }
    }
    cursor = keepColumn(indexes, cursor, first, last, min, max);
    first = last + 1;
    column = nextColumn;
  }
  return cursor;
}

function scan(slot: Uint8Array, range: IndexRange, blocks?: Uint8Array) {
  let values = 0, vertices = 0, runCount = 0, singles = 0, runFirst = -1, runLast = -1, runValues = 0;
  const { start, end } = range, length = end - start;
  const runs: IndexBuffer = { data: new Uint32Array(Math.min(12, 3 * length)), limit: 3 * length };
  const isolated: IndexBuffer = { data: NO_INDEXES, limit: length };
  let joinsBefore = start < end && joinedNeighbor(slot, start - 1, -1);
  const joinsAfter = start < end && joinedNeighbor(slot, end, 1);

  for (let i = start; i <= end; i++) {
    const state = i < end ? slot[i] : SLOT_GAP;
    if (state === SLOT_VALUE) {
      if (runValues === 0) runFirst = i;
      let next = i + 1;
      if (!blocks) {
        // Short windows have no block index, so their contiguous runs need only read slot states.
        while (next < end && slot[next] === SLOT_VALUE) next++;
      } else {
        while (next < end) {
          const block = next % BLOCK_SIZE === 0 ? blocks[2 * (next / BLOCK_SIZE)] : 0;
          if (block && block !== MIXED_BLOCK && next + BLOCK_SIZE <= end) next += BLOCK_SIZE;
          else if (slot[next] === SLOT_VALUE) next++;
          else break;
        }
      }
      runValues += next - i;
      runLast = i = next - 1;
      continue;
    }
    if (state === SLOT_NO_ROW) continue;
    if (runValues > 0) {
      values += runValues;
      if (runValues === 1 && !joinsBefore && !(i === end && joinsAfter)) {
        reserve(isolated, singles + 1)[singles++] = runFirst;
      } else {
        const offset = 3 * runCount++, bounds = reserve(runs, offset + 3);
        bounds[offset] = runFirst;
        bounds[offset + 1] = runLast;
        bounds[offset + 2] = runValues;
        vertices += runValues;
      }
      runValues = 0;
    }
    joinsBefore = false;
  }
  return { values, vertices, runCount, runs: runs.data, isolated: singles ? isolated.data.subarray(0, singles) : NO_INDEXES };
}

function select(slot: Uint8Array, range: IndexRange, limit: number, columns?: Columns) {
  const length = range.end - range.start, affine = columns?.affine, y = columns?.y;
  // Near the density threshold, most blocks would straddle device columns.
  const summary = affine && y && length >= 1024 && length >= 4 * limit && range.end <= y.length
    ? summarize(y, slot, range) : undefined;
  // Blocks suffice for a one-off draw. Build the extra indexes only when the series is reused.
  const reused = summary !== undefined && summary.uses++ > 0;
  const full = summary?.full;
  const size = full && full.start <= range.start && full.end >= range.end ? undefined : scan(slot, range, summary?.blocks);
  const values = size?.values ?? length;
  const vertices = size?.vertices ?? length;
  const runCount = size?.runCount ?? 1;
  const isolated = size?.isolated ?? NO_INDEXES;
  if (summary && size && values === length) {
    // Overlapping validated ranges certify one continuous run for subsequent zooms.
    summary.full = full && full.start <= range.end && range.start <= full.end
      ? { start: Math.min(full.start, range.start), end: Math.max(full.end, range.end) } : { ...range };
  }
  const dense = columns !== undefined && values > limit;
  // Responsive layouts can revisit widths without changing their data or zoom.
  let cache: SelectionCache | undefined;
  const exact = affine?.exact;
  if (dense && reused && summary && exact && values === length && hasMonotoneColumns(exact, columns.x[range.start]!, columns.x[range.end - 1]!)) {
    cache = selectionCache(summary, columns.x, range, exact, columns.ratio);
    const indexes = cache.map.get(exact.extent);
    if (indexes) return { selection: { indexes: indexes.slice(), breaks: NO_INDEXES, isolated }, dense };
  }
  let buffer: IndexBuffer | undefined;
  const initialCapacity = dense ? Math.min(vertices, limit + 4 * runCount + 4) : vertices;
  const breaks = runCount > 1 ? new Uint32Array(runCount - 1) : NO_INDEXES;
  let cursor = 0;
  for (let run = 0; run < runCount; run++) {
    const first = size?.runs[3 * run] ?? range.start, last = size?.runs[3 * run + 1] ?? range.end - 1;
    const runLength = last - first + 1, contiguous = !size || runLength === size.runs[3 * run + 2];
    if (run) breaks[run - 1] = cursor;
    if (dense && contiguous && summary && affine && y && runLength >= 2 * BLOCK_SIZE) {
      const { x, ratio } = columns;
      const start = x[first]!, end = x[last]!;
      if (!exact || hasMonotoneColumns(exact, start, end)) {
        const firstColumn = Math.floor((exact
          ? exact.origin + (start - exact.start) / exact.span * exact.extent : affine.slope * start + affine.offset) * ratio);
        const lastColumn = Math.floor((exact
          ? exact.origin + (end - exact.start) / exact.span * exact.extent : affine.slope * end + affine.offset) * ratio);
        const capacity = 4 * (Math.abs(lastColumn - firstColumn) + 1);
        if (capacity <= runLength) {
          // A single dense run can reserve for its actual projected span, including offscreen endpoints.
          buffer ??= { data: new Uint32Array(runCount === 1 ? capacity : initialCapacity), limit: vertices };
          cursor = keepAffineRun(x, y, first, last, affine, ratio, firstColumn, lastColumn, summary.blocks,
            reserve(buffer, cursor + capacity), cursor);
          continue;
        }
      }
    }
    buffer ??= { data: new Uint32Array(initialCapacity), limit: vertices };
    if (dense) cursor = keepRun(contiguous ? null : slot, first, last, columns, buffer, cursor);
    else if (contiguous) {
      const data = buffer.data;
      for (let index = first; index <= last; index++) data[cursor++] = index;
    } else {
      const data = buffer.data;
      for (let index = first; index <= last; index++) if (slot[index] === SLOT_VALUE) data[cursor++] = index;
    }
  }
  const selection: JoinedRuns = { indexes: buffer?.data.subarray(0, cursor) ?? NO_INDEXES, breaks, isolated };
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
  const { range, devicePixelRatio: ratio } = input, limit = columnLimit(input);
  return select(input.slot, range, limit, range.end - range.start <= limit ? undefined
    : { x: input.x, y, map: xMapper(input.mapX, input.affineX), affine: input.affineX, ratio });
}

export function simplifyLine(input: LineInput): JoinedRuns {
  return simplifyBoundary(input, input.y).selection;
}

/** Common source vertices keep neighboring cumulative edges ordered between samples as well as at them. */
export function stackIndexes(
  input: Omit<DrawingInput, 'slot' | 'range'>, frame: AlignedFrame, stack: StackView, range: IndexRange,
): Uint32Array {
  const { start, end } = range, size = end - start;
  if (size <= columnLimit(input)) return Uint32Array.from({ length: size }, (_, i) => i);
  const kept = new Uint8Array(size), scratch = new Uint32Array(size);
  const buffer: IndexBuffer = { data: scratch, limit: size };
  const columns = { x: input.x, map: xMapper(input.mapX, input.affineX), affine: input.affineX, ratio: input.devicePixelRatio, y: 0 as Values | 0 };
  for (let k = 0; k < stack.order.length; k++) {
    const { y, slot } = frame.series[stack.order[k]!]!;
    for (const values of [stack.positive[k]!, stack.negative[k]!]) {
      columns.y = values;
      let first = start;
      for (let i = start + 1; i <= end; i++) {
        // Keep both ends of every pinch, including zero and wholly missing stretches.
        if (i < end && slot[i] === slot[first] && (slot[i] !== SLOT_VALUE || Math.sign(y[i]!) === Math.sign(y[first]!))) continue;
        const count = keepRun(null, first, i - 1, columns, buffer, 0);
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
  if (!interpolatesEndpoints(exact)) return value => affinePosition(affine, value);
  const { scale, start, end, origin, span, extent, bounded } = exact;
  if (bounded) return value => origin + (value - start) / span * extent;
  const low = span > 0 ? start : end, high = span > 0 ? end : start;
  return value => value >= low && value <= high ? origin + (value - start) / span * extent : position(scale, value);
}

function pack(indexes: Uint32Array, breaks: Uint32Array | null, input: PathInput): Float32Array {
  const xy = new Float32Array(2 * (indexes.length + (breaks?.length ?? 0)));
  const { x, y, mapY, affineX, affineY } = input;
  const xExact = affineX?.exact, yExact = affineY?.exact;
  if (!breaks?.length && y !== 0 && xExact?.bounded && yExact && interpolatesEndpoints(xExact) && interpolatesEndpoints(yExact)) {
    const { start: xs, origin: xo, span: xn, extent: xe } = xExact;
    const { start: ys, end: ye, origin: yo, span: yn, extent: yx, bounded, scale } = yExact;
    const low = yn > 0 ? ys : ye, high = yn > 0 ? ye : ys;
    for (let i = 0; i < indexes.length; i++) {
      const idx = indexes[i]!, val = y[idx]!;
      xy[2 * i] = xo + (x[idx]! - xs) / xn * xe;
      xy[2 * i + 1] = bounded || (val >= low && val <= high) ? yo + (val - ys) / yn * yx : position(scale, val);
    }
    return xy;
  }
  const toX = xMapper(input.mapX, affineX), toY = affineY ? affineMapper(affineY) : yMapper(mapY);
  if (!breaks?.length) {
    for (let i = 0; i < indexes.length; i++) {
      const idx = indexes[i]!;
      xy[2 * i] = toX(x[idx]!);
      xy[2 * i + 1] = toY(y === 0 ? 0 : y[idx]!);
    }
    return xy;
  }
  let cursor = 0, nextBreak = 0;
  for (let i = 0; i < indexes.length; i++) {
    if (i === breaks[nextBreak]) { xy[cursor++] = NaN; xy[cursor++] = NaN; nextBreak++; }
    const idx = indexes[i]!;
    xy[cursor++] = toX(x[idx]!);
    xy[cursor++] = toY(y === 0 ? 0 : y[idx]!);
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

function sameAffine(a?: AffineProjection, b?: AffineProjection): boolean {
  return a?.slope === b?.slope && a?.offset === b?.offset && a?.exact === b?.exact;
}

function canShare(p: AreaSource, n: AreaSource): boolean {
  if (p.x !== n.x || p.mapX !== n.mapX || p.mapY !== n.mapY ||
      !sameAffine(p.affineX, n.affineX) || !sameAffine(p.affineY, n.affineY) ||
      p.range.start !== n.range.start || p.range.end !== n.range.end ||
      p.left !== n.left || p.width !== n.width || p.devicePixelRatio !== n.devicePixelRatio) return false;
  if (p.slot === n.slot) return true;
  const { start, end } = n.range;
  if (joinedNeighbor(p.slot, start - 1, -1) !== joinedNeighbor(n.slot, start - 1, -1) ||
      joinedNeighbor(p.slot, end, 1) !== joinedNeighbor(n.slot, end, 1)) return false;
  for (let i = start; i < end; i++) {
    const a = p.slot[i], b = n.slot[i];
    if (a !== b && (a === SLOT_VALUE || b === SLOT_VALUE || a === SLOT_NO_ROW || b === SLOT_NO_ROW)) return false;
  }
  return true;
}

export function simplifyArea(input: AreaInput): SimplifiedArea {
  const { upper, lower, ...source } = input;
  const { selection: upperSel, dense } = simplifyBoundary(source, upper);
  const upperBoundary = prepareBoundary(source, upper, upperSel);
  const runs = new Uint32Array(upperSel.indexes.length ? 4 * (upperSel.breaks.length + 1) : 0);
  const flatDense = lower === 0 && dense;
  let lowerSel: JoinedRuns = upperSel;
  let lowerXY: Float32Array;
  let baseline = 0;
  if (flatDense) {
    lowerXY = new Float32Array(runs.length);
    baseline = source.affineY ? affinePosition(source.affineY, 0) : yMapper(source.mapY)(0);
  } else if (lower === 0) {
    lowerXY = buildPoints(upperSel.indexes, { ...source, y: 0 });
  } else if (lower instanceof Float64Array) {
    lowerSel = simplifyBoundary(source, lower).selection;
    lowerXY = buildPoints(lowerSel.indexes, { ...source, y: lower });
  } else {
    const b = canShare(lower.source, source) ? lower
      : prepareBoundary(source, lower.values, simplifyBoundary(source, lower.values).selection);
    lowerSel = b.selection;
    lowerXY = b.xy;
  }

  let upperStart = 0, lowerStart = 0;
  for (let run = 0; run * 4 < runs.length; run++) {
    const upperEnd = upperSel.breaks[run] ?? upperSel.indexes.length, count = upperEnd - upperStart;
    const lowerCount = flatDense ? Math.min(count, 2) : (lowerSel.breaks[run] ?? lowerSel.indexes.length) - lowerStart;
    if (flatDense) {
      lowerXY[2 * lowerStart] = upperBoundary.xy[2 * upperStart]!;
      lowerXY[2 * lowerStart + 1] = baseline;
      if (count > 1) {
        lowerXY[2 * (lowerStart + 1)] = upperBoundary.xy[2 * (upperEnd - 1)]!;
        lowerXY[2 * (lowerStart + 1) + 1] = baseline;
      }
    }
    runs[run * 4] = upperStart;
    runs[run * 4 + 1] = count;
    runs[run * 4 + 2] = lowerStart;
    runs[run * 4 + 3] = lowerCount;
    upperStart = upperEnd;
    lowerStart += lowerCount;
  }
  return {
    upper: upperBoundary.xy,
    lower: flatDense ? lowerXY.subarray(0, 2 * lowerStart) : lowerXY,
    runs, upperBoundary, isolated: upperSel.isolated,
  };
}
