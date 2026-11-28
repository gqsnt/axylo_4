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
 * A log axis cannot place a value at or below zero (RFC C4.1 §4.4). With `log`, such a slot is drawn as a
 * SLOT_GAP would be: the line breaks there exactly as before, no column extreme is read from it, and
 * `position()` never sees it. The value and state columns are borrowed from the frame: both retain their original
 * contents. Large ranges share indexes of the earliest extrema of complete windows.
 */
import { SLOT_NO_ROW, SLOT_VALUE, type IndexRange, type Rect, type Series, type XScale } from '../core/contracts';

import { denseSlots, seriesSlots, WINDOW_SIZE } from '../data/store-statistics';
import { COORDINATE_LIMIT } from '../scene/geometry';

/** On sorted finite inputs between low and high, interpolation follows the committed map
 * including its endpoint shortcuts. Extreme spans and extrapolation use position() instead. */
export function linearPixels(scale: XScale, low: number, high: number) {
  if (scale.type !== 'time' && scale.type !== 'linear') return;
  const [a, b] = scale.domain, [origin, edge] = scale.range;
  const span = b - a, extent = edge - origin;
  const pixel = (v: number) => origin + (v - a) / span * extent;
  if (Number.isFinite(span) && span !== 0 && extent !== 0 && Object.is(pixel(a), origin) && Object.is(pixel(b), edge) &&
      Math.max(Math.abs(pixel(low)), Math.abs(pixel(high))) <= COORDINATE_LIMIT) return pixel;
}

type Values = Float64Array | Float32Array;

/** A normalized layer can already have materialized its all-value slot column. */
export function mixedSlots(s: Series) {
  const slot = seriesSlots(s);
  return slot && denseSlots.has(slot) ? null : slot;
}

let windows: WeakMap<Series, Float64Array | null> | undefined;

/** Defer the index until the same immutable series is visited again. Each zoom
 * populates only complete windows. A new revision can share y with different slots. */
export function seriesWindows(s: Series, lookupOnly = false) {
  const cache = windows ??= new WeakMap();
  let indexes = cache.get(s);
  if (lookupOnly) return indexes;
  if (indexes === undefined) cache.set(s, null);
  else if (!indexes) cache.set(s, indexes = new Float64Array(2 * Math.floor(s.y.length / WINDOW_SIZE)).fill(-2));
  return indexes;
}

export function extremaIndexes(y: Values, slot: Uint8Array | null, start: number, end: number, seed = -1, blocks?: Float64Array | null): readonly [number, number] {
  let min = seed, max = seed;
  for (let i = start; i < end;) {
    const stop = blocks ? Math.min(end, i + WINDOW_SIZE - i % WINDOW_SIZE) : end;
    const cache = stop - i === WINDOW_SIZE ? blocks : null, pair = 2 * i / WINDOW_SIZE;
    let a = -1, b = -1;
    if (cache && cache[pair] !== -2) {
      a = cache[pair]!;
      b = cache[pair + 1]!;
    } else {
      let low = Infinity, high = -Infinity;
      for (let j = i; j < stop; j++) {
        if (slot && slot[j] !== SLOT_VALUE) continue;
        const value = y[j]!;
        if (value < low) { low = value; a = j; }
        if (value > high) { high = value; b = j; }
      }
      if (cache) {
        // -2 marks an uncomputed window, -1 an empty one.
        cache[pair] = a;
        cache[pair + 1] = b;
      }
    }
    if (y[a]! < (y[min] ?? Infinity)) min = a;
    if (y[b]! > (y[max] ?? -Infinity)) max = b;
    i = stop;
  }
  return [min, max];
}

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

export class Slots {
  data: Uint32Array;
  length = 0;

  constructor(capacity = 4) {
    this.data = new Uint32Array(capacity);
  }

  push(slot: number) {
    if (this.length === this.data.length) {
      const next = new Uint32Array(Math.max(4, 2 * this.length));
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = slot;
  }

  used() { return this.data.subarray(0, this.length); }
}

/**
 * The kept slots of one column of values in `range`. `xAt(i)` is slot i's CSS pixel; `bridge` joins values
 * across SLOT_NO_ROW (lines and unstacked areas) instead of breaking there (stacks, F10); `log` breaks at any
 * value that is not positive.
 */
export function keep(
  y: Values, slot: Uint8Array | null, range: IndexRange, xAt: (i: number) => number,
  ratio: number, limit: number, bridge: boolean, log = false, monotone = false, series?: Series,
): Kept {
  const { start, end } = range;
  // Density is decided on the values that can be drawn, as simplify/index.ts decides it on its values: a range
  // aligned to a long bar layer may hold only a few drawable line samples, and those are all kept.
  const drawn = drawnAt(y, slot, log);
  const continuous = !log && !slot && start >= 0 && end <= y.length;
  let drawable = end - start;
  if (!continuous && drawable > limit) {
    drawable = 0;
    for (let i = start; i < end; i++) if (drawn(i) && ++drawable > limit) break;
  }
  const dense = drawable > limit;
  const jump = monotone && dense && continuous;
  const blocks = jump && series ? seriesWindows(series) : null;
  const columnAt = (i: number) => Math.floor(xAt(i) * ratio);
  const out = new Slots(Math.max(4, Math.min(drawable, limit + 8)));
  const ends = new Slots(), isolated = new Slots(0);
  let runStart = 0;
  const endRun = () => {
    if (out.length === runStart + 1) isolated.push(out.data[--out.length]!);
    else if (out.length > runStart) ends.push(out.length);
    runStart = out.length;
  };
  for (let i = start; i < end;) {
    if (!drawn(i)) {
      if (!(bridge && slot?.[i] === SLOT_NO_ROW)) endRun();
      i++;
      continue;
    }
    const first = i++;
    out.push(first);
    if (!dense) continue;
    const column = columnAt(first);
    let last = first;
    if (jump) {
      // Forward probes preserve rounded column boundaries on uneven and reversed scales.
      let step = 1;
      while (first + step < end && columnAt(first + step) === column) step *= 2;
      for (step = Math.floor(step / 2); step >= 1; step = Math.floor(step / 2)) {
        if (last + step < end && columnAt(last + step) === column) last += step;
      }
      i = last + 1;
    } else {
      for (; i < end; i++) {
        if (!drawn(i)) {
          if (bridge && slot?.[i] === SLOT_NO_ROW) continue;
          break;
        }
        if (columnAt(i) !== column) break;
        last = i;
      }
    }
    if (first === last) continue;
    const [min, max] = extremaIndexes(y, continuous ? null : slot, first + 1, last + 1, first, blocks);
    const earlier = Math.min(min, max), later = Math.max(min, max);
    if (earlier > first && earlier < last) out.push(earlier);
    if (later > earlier && later < last) out.push(later);
    out.push(last);
  }
  endRun();
  return { indexes: out.used(), ends: ends.used(), isolated: isolated.used() };
}

/** XY vertices with a pen lift at each supplied run boundary. */
export function pointsOf(indexes: Uint32Array, xAt: (i: number) => number, yAt: (i: number) => number, ends?: Uint32Array): Float32Array {
  const xy = new Float32Array(2 * (indexes.length + Math.max(0, (ends?.length ?? 1) - 1)));
  let o = 0, run = 0;
  for (let j = 0; j < indexes.length; j++) {
    if (j === ends?.[run]) { xy[o++] = NaN; xy[o++] = NaN; run++; }
    const i = indexes[j]!;
    xy[o++] = xAt(i);
    xy[o++] = yAt(i);
  }
  return xy;
}

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
