import { SLOT_VALUE, type Series } from '../core/contracts';

export interface Statistics {
  readonly min: number;
  readonly max: number;
  readonly last: number;
}

// Readers keep the first value on ties. Domains order -0 before +0.
export interface FullStatistics {
  readonly ordered: Statistics;
  readonly signed: Statistics;
}

let totals: WeakMap<Series, FullStatistics> | undefined;
export const fullStatistics = {
  get(series: Series) { return totals?.get(series); },
  set(series: Series, stats: FullStatistics) { (totals ??= new WeakMap()).set(series, stats); },
};

// Continuity belongs to the slots alone. Extrema depend on the paired value column as well.
let continuous: WeakSet<Uint8Array> | undefined;
export const denseSlots = {
  has(slot: Uint8Array) { return continuous?.has(slot) ?? false; },
  set(slot: Uint8Array, _state: 'fresh') { (continuous ??= new WeakSet()).add(slot); },
};

// Series whose every slot is SLOT_VALUE and whose state column was never asked for. A million-point line
// would otherwise carry a megabyte of zeros; the column is made only when a reader outside the hot paths reads it.
// Each maps to its slot count, so a state can be answered without reading a lazily copied y column.
let unmaterialized: WeakMap<object, number> | undefined;

/**
 * Gives `fields` an all-SLOT_VALUE `slot` made on first read. `length` spares a lazy y column from being read;
 * `make` lets a store hand out a view on a column it shares between revisions, as it does for y.
 */
export function denseSeries<T extends Omit<Series, 'slot'>>(
  fields: T, length?: number, make?: () => Uint8Array,
): T & { readonly slot: Uint8Array } {
  const series = fields as T & { slot: Uint8Array };
  Object.defineProperty(series, 'slot', {
    configurable: true, enumerable: true,
    get(this: T & { slot: Uint8Array }): Uint8Array {
      const slot = make?.() ?? new Uint8Array(unmaterialized?.get(this) ?? this.y.length);
      unmaterialized?.delete(this);
      // A data property from here on, so byte counting and later reads see an ordinary column.
      Object.defineProperty(this, 'slot', { value: slot, configurable: true, enumerable: true, writable: true });
      denseSlots.set(slot, 'fresh');
      return slot;
    },
  });
  (unmaterialized ??= new WeakMap()).set(series, length ?? series.y.length);
  return series;
}

/** The series' slot states, or null when every slot is SLOT_VALUE and no column exists. Never makes the column. */
export function seriesSlots(series: { readonly slot: Uint8Array }): Uint8Array | null {
  return unmaterialized?.has(series) ? null : series.slot;
}

/** The state of one slot, read without making a dense series' column. */
export function slotState(series: { readonly slot: Uint8Array }, index: number): number {
  const length = unmaterialized?.get(series);
  if (length === undefined) return series.slot[index]!;
  // Out of range answers what a column read would: no state.
  return index >= 0 && index < length ? SLOT_VALUE : NaN;
}

/** A copy of `series` with some descriptive fields replaced, without making a dense series' state column. */
export function reviseSeries(series: Series, patch: Partial<Pick<Series, 'label' | 'unit' | 'drawable'>>): Series {
  if (!unmaterialized?.has(series)) return { ...series, ...patch };
  const { key, label, field, unit, valueScale, drawable, y, row } = series;
  const next = denseSeries({ key, label, field, unit, valueScale, drawable, y, row, ...patch });
  const known = fullStatistics.get(series);
  if (known) fullStatistics.set(next, known);
  return next;
}

export function withSignedZeros(ordered: Statistics, zeros: number): FullStatistics {
  const { min, max, last } = ordered;
  return { ordered, signed: zeros ? {
    min: min === 0 && (zeros & 1) ? -0 : min,
    max: max === 0 && (zeros & 2) ? 0 : max, last,
  } : ordered };
}

type Values = Float32Array | Float64Array;
export const BLOCK_SIZE = 16;
export const MIXED_BLOCK = 255;
export const WINDOW_SIZE = 256;

interface WindowBlocks {
  readonly min: Float64Array;
  readonly max: Float64Array;
  readonly zeros: Uint8Array;
  // Zero marks an uncomputed window, -1 an empty one, otherwise the last finite index plus one.
  readonly last: Int32Array;
}

export interface BlockSummary {
  readonly blocks: Uint8Array;
  start: number;
  end: number;
  windows?: WindowBlocks;
}
type SlotSummaries = WeakMap<object, BlockSummary | null>;
// The key of a y view's summary when its series has no state column (null: every slot is SLOT_VALUE).
const allValues = {};
let summaries: WeakMap<Values, SlotSummaries> | undefined;

function slotSummaries(y: Values): SlotSummaries {
  const all = summaries ??= new WeakMap();
  let bySlot = all.get(y);
  if (!bySlot) all.set(y, bySlot = new WeakMap());
  return bySlot;
}

export function hasBlockSummary(y: Values, slot: Uint8Array | null): boolean {
  return !!summaries?.get(y)?.get(slot ?? allValues);
}

export function drawingBlocks(y: Values, slot: Uint8Array | null, start: number, end: number): BlockSummary | undefined {
  const bySlot = slotSummaries(y);
  if (!bySlot.has(slot ?? allValues)) {
    // A single draw needs no index, even for gapped data or a shared slot column.
    bySlot.set(slot ?? allValues, null);
    return;
  }
  return summarizeBlocks(y, slot, start, end, bySlot);
}

/** `slot` null: every slot is SLOT_VALUE, so no state is read. */
export function summarizeBlocks(y: Values, slot: Uint8Array | null, start: number, end: number, bySlot = slotSummaries(y)): BlockSummary {
  // Published series views are immutable. The store appends beyond them and copies an
  // exposed tail before filling it, so views sharing a backing buffer have separate keys.
  const count = Math.floor((slot ? Math.min(y.length, slot.length) : y.length) / BLOCK_SIZE);
  const key = slot ?? allValues;
  let summary = bySlot.get(key);
  if (summary?.blocks.length !== 2 * count) {
    bySlot.set(key, summary = { blocks: new Uint8Array(2 * count), start: 0, end: 0 });
  }
  const { blocks } = summary;
  const begin = Math.ceil(start / BLOCK_SIZE);
  const stop = Math.min(count, Math.floor(end / BLOCK_SIZE));
  if (begin >= summary.start && stop <= summary.end) return summary;
  for (let block = begin; block < stop; block++) {
    if (block >= summary.start && block < summary.end) {
      block = summary.end - 1;
      continue;
    }
    const offset = 2 * block;
    if (blocks[offset]) continue;
    const first = block * BLOCK_SIZE;
    let i = 0;
    while (i < BLOCK_SIZE && (!slot || slot[first + i] === SLOT_VALUE) && Number.isNaN(y[first + i])) i++;
    let low = y[first + i]!, high = low, min = i, max = i;
    for (; i < BLOCK_SIZE && (!slot || slot[first + i] === SLOT_VALUE); i++) {
      const value = y[first + i]!;
      if (value < low) { low = value; min = i; }
      if (value > high) { high = value; max = i; }
    }
    // Zero means uncomputed. A mixed block must be visited slot by slot to preserve gaps.
    blocks[offset] = i === BLOCK_SIZE ? Math.min(min + 1, BLOCK_SIZE) : MIXED_BLOCK;
    blocks[offset + 1] = Math.min(max, BLOCK_SIZE - 1);
  }
  if (begin <= summary.end && stop >= summary.start) {
    summary.start = Math.min(summary.start, begin);
    summary.end = Math.max(summary.end, stop);
  } else {
    summary.start = begin;
    summary.end = stop;
  }
  return summary;
}

/** Whole windows reuse the drawing's earliest extrema. Only their two cut edges need a row scan. */
export function windowStatistics(y: Values, slot: Uint8Array | null, start: number, end: number): FullStatistics {
  const summary = summarizeBlocks(y, slot, start, end);
  const count = Math.floor((slot ?? y).length / WINDOW_SIZE);
  const windows = summary.windows ??= {
    min: new Float64Array(count), max: new Float64Array(count), last: new Int32Array(count), zeros: new Uint8Array(count),
  };
  let min = Infinity, max = -Infinity, final = -1, zeros = 0;
  for (let i = start; i < end;) {
    const w = Math.floor(i / WINDOW_SIZE);
    const stop = Math.min(end, (w + 1) * WINDOW_SIZE);
    const whole = stop - i === WINDOW_SIZE;
    let low = Infinity, high = -Infinity, last = -1, signs = 0;
    if (whole && windows.last[w] !== 0) {
      low = windows.min[w]!; high = windows.max[w]!;
      last = windows.last[w]! - 1;
      signs = windows.zeros[w]!;
    } else {
      for (let j = i; j < stop;) {
        if (j % BLOCK_SIZE === 0 && j + BLOCK_SIZE <= stop) {
          const off = j / BLOCK_SIZE * 2, index = summary.blocks[off]!;
          if (index && index !== MIXED_BLOCK) {
            const a = y[j + index - 1]!, b = y[j + summary.blocks[off + 1]!]!;
            const tail = j + BLOCK_SIZE - 1;
            // A zero extreme needs both signs. The reader also ignores nonfinite observations.
            if (Number.isFinite(a) && Number.isFinite(b) && a !== 0 && b !== 0 && Number.isFinite(y[tail])) {
              if (a < low) low = a;
              if (b > high) high = b;
              last = tail;
              j += BLOCK_SIZE;
              continue;
            }
          }
        }
        const value = y[j]!;
        if ((!slot || slot[j] === SLOT_VALUE) && Number.isFinite(value)) {
          if (value < low) low = value;
          if (value > high) high = value;
          if (value === 0) signs |= Object.is(value, -0) ? 1 : 2;
          last = j;
        }
        j++;
      }
      if (whole) {
        windows.min[w] = low; windows.max[w] = high;
        windows.last[w] = last < 0 ? -1 : last + 1;
        windows.zeros[w] = signs;
      }
    }
    if (low < min) min = low;
    if (high > max) max = high;
    if (last >= 0) final = last;
    zeros |= signs;
    i = stop;
  }
  return withSignedZeros({ min, max, last: final < 0 ? NaN : y[final]! }, zeros);
}
