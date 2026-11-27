/**
 * Dense drawing for `axylo/cartesian` (spec F5), in the committed Cartesian projection and the scene's device
 * pixel ratio.
 *
 * The guarantee is simplify/index.ts's: when a drawn range holds more drawable values than four per device-pixel column
 * of the plot, each contiguous run of values keeps, in every column, its first, last, minimum and maximum sample
 * (earliest on ties), in source order; otherwise every sample is kept. A break between runs is always kept, a
 * slot with no row is bridged outside stacks, and a run of one value is an isolated point. Exact values for
 * readouts come from the frame, never from what was kept.
 *
 * Why not simplify/index.ts itself: its block index, selection cache and affine search are built for the root
 * line's million-point zoom path, and importing them adds about 9.3 kB minified to this entry, past the entry's
 * enforced 127,000 B gzip cap (tests/dist/subpaths.test.ts). This is one linear pass with typed buffers.
 *
 * A log axis cannot place a value at or below zero (RFC C4.1 §4.4). With `log`, such a slot is drawn as a
 * SLOT_GAP would be: the line breaks there exactly as before, no column extreme is read from it, and
 * `position()` never sees it. The value and state columns are borrowed from the frame: neither is copied nor
 * changed, and no derived column is made.
 */
import { SLOT_NO_ROW, SLOT_VALUE, type IndexRange, type Rect } from '../core/contracts';

type Values = Float64Array | Float32Array;

/** The source slots a drawing keeps. */
export interface Kept {
  /** Kept slots of every run, concatenated in source order. */
  readonly indexes: Uint32Array;
  /** For each run, the offset in `indexes` where it ends. */
  readonly ends: Uint32Array;
  /** Values with no joined neighbour in the range: drawn as markers, not as part of a path. */
  readonly isolated: Uint32Array;
}

export function safeRatio(devicePixelRatio: number): number {
  return Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
}

/** Four samples per device-pixel column the plot covers (the threshold of simplify/index.ts). */
export function columnLimit(plot: Rect, ratio: number): number {
  return plot.width > 0 ? 4 * (Math.ceil((plot.x + plot.width) * ratio) - Math.floor(plot.x * ratio)) : 0;
}

/** Whether slot i is drawn: it holds a value and, on a log axis, a positive finite one. */
const drawnAt = (y: Values, slot: Uint8Array | null, log: boolean) => (i: number) =>
  (!slot || slot[i] === SLOT_VALUE) && (!log || (y[i]! > 0 && y[i]! < Infinity));

function grow(buffer: Uint32Array, length: number): Uint32Array {
  if (length < buffer.length) return buffer;
  const next = new Uint32Array(Math.max(4, buffer.length * 2));
  next.set(buffer);
  return next;
}

/**
 * The kept slots of one column of values in `range`. `xAt(i)` is slot i's CSS pixel; `bridge` joins values
 * across SLOT_NO_ROW (lines and unstacked areas) instead of breaking there (stacks, F10); `log` breaks at any
 * value that is not positive.
 */
export function keep(
  y: Values, slot: Uint8Array | null, range: IndexRange, xAt: (i: number) => number,
  ratio: number, limit: number, bridge: boolean, log = false,
): Kept {
  const { start, end } = range;
  // Density is decided on the values that can be drawn, as simplify/index.ts decides it on its values: a range
  // aligned to a long bar layer may hold only a few drawable line samples, and those are all kept.
  const drawn = drawnAt(y, slot, log);
  let drawable = 0;
  for (let i = start; i < end; i++) if (drawn(i)) drawable++;
  const dense = drawable > limit;
  let out: Uint32Array = new Uint32Array(Math.max(4, dense ? Math.min(drawable, limit + 8) : drawable));
  let ends: Uint32Array = new Uint32Array(4);
  let isolated: Uint32Array = new Uint32Array(0);
  let n = 0, runs = 0, singles = 0, runStart = 0, values = 0;
  let column = NaN, first = -1, last = -1, min = -1, max = -1, low = 0, high = 0;
  const push = (i: number) => { out = grow(out, n); out[n++] = i; };
  const flush = () => {
    if (first < 0) return;
    // An extreme may also be an endpoint: each slot once, in source order.
    const earlier = Math.min(min, max), later = Math.max(min, max);
    push(first);
    if (earlier > first && earlier < last) push(earlier);
    if (later > earlier && later < last) push(later);
    if (last > first) push(last);
    first = -1;
  };
  const endRun = () => {
    flush();
    if (values === 1) {
      isolated = grow(isolated, singles);
      isolated[singles++] = out[runStart]!;
      n = runStart;
    } else if (values > 1) {
      ends = grow(ends, runs);
      ends[runs++] = n;
    }
    values = 0;
    column = NaN;
  };
  for (let i = start; i < end; i++) {
    const value = y[i]!;
    if (!drawn(i)) {
      if (!(bridge && slot?.[i] === SLOT_NO_ROW)) endRun();
      continue;
    }
    if (values++ === 0) runStart = n;
    if (!dense) { push(i); continue; }
    const c = Math.floor(xAt(i) * ratio);
    if (c !== column) {
      flush();
      column = c;
      first = min = max = last = i;
      low = high = value;
    } else {
      last = i;
      if (value < low) { low = value; min = i; }
      if (value > high) { high = value; max = i; }
    }
  }
  endRun();
  return { indexes: out.subarray(0, n), ends: ends.subarray(0, runs), isolated: isolated.subarray(0, singles) };
}

/** A path through every run of `kept`, the pen lifted between runs. */
export function pathOf(kept: Kept, xAt: (i: number) => number, yAt: (i: number) => number): Float32Array {
  const { indexes, ends } = kept;
  const xy = new Float32Array(2 * (indexes.length + Math.max(0, ends.length - 1)));
  let o = 0, run = 0;
  for (let j = 0; j < indexes.length; j++) {
    if (j === ends[run]) { xy[o++] = NaN; xy[o++] = NaN; run++; }
    const i = indexes[j]!;
    xy[o++] = xAt(i);
    xy[o++] = yAt(i);
  }
  return xy;
}

/** The points of `indexes`, with no pen lifts. */
export const pointsOf = (indexes: Uint32Array, xAt: (i: number) => number, yAt: (i: number) => number): Float32Array =>
  pathOf({ indexes, ends: indexes.subarray(0, 0), isolated: indexes }, xAt, yAt);

/** An area over the runs of `kept`: each run one region between its upper and lower boundary. */
export function bandOf(
  kept: Kept, xAt: (i: number) => number, upperAt: (i: number) => number, lowerAt: (i: number) => number,
): { upper: Float32Array; lower: Float32Array; runs: Uint32Array } {
  const { ends } = kept;
  const runs = new Uint32Array(4 * ends.length);
  for (let r = 0, from = 0; r < ends.length; from = ends[r++]!) {
    runs[4 * r] = runs[4 * r + 2] = from;
    runs[4 * r + 1] = runs[4 * r + 3] = ends[r]! - from;
  }
  return { upper: pointsOf(kept.indexes, xAt, upperAt), lower: pointsOf(kept.indexes, xAt, lowerAt), runs };
}

/** The last slot in `range` drawn as a value, or -1. Spec A5 puts the series' marker there. */
export function lastDrawnValue(y: Values, slot: Uint8Array | null, range: IndexRange, log: boolean): number {
  const drawn = drawnAt(y, slot, log);
  for (let i = Math.min(range.end, y.length) - 1; i >= range.start; i--) if (drawn(i)) return i;
  return -1;
}
