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

export function withSignedZeros(ordered: Statistics, zeros: number): FullStatistics {
  const { min, max, last } = ordered;
  return { ordered, signed: zeros ? {
    min: min === 0 && (zeros & 1) ? -0 : min,
    max: max === 0 && (zeros & 2) ? 0 : max, last,
  } : ordered };
}

/** Only the store's regular one-row append certifies that all retained slots are unchanged. */
export function extendStatistics(previous: Series, next: Series, dropped: boolean): void {
  const known = fullStatistics.get(previous);
  if (!known) return;
  const { ordered, signed } = known;
  if (denseSlots.has(previous.slot)) denseSlots.set(next.slot, 'fresh');
  if (dropped && previous.slot[0] === SLOT_VALUE) {
    const outgoing = previous.y[0];
    if (outgoing === ordered.min || outgoing === ordered.max) return;
  }
  const last = next.y[next.y.length - 1]!;
  const result = {
    min: last < ordered.min ? last : ordered.min,
    max: last > ordered.max ? last : ordered.max, last,
  };
  fullStatistics.set(next, { ordered: result, signed: signed === ordered && last !== 0 ? result : {
    min: Math.min(signed.min, last), max: Math.max(signed.max, last), last,
  } });
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
type SlotSummaries = WeakMap<Uint8Array, BlockSummary | null>;
let summaries: WeakMap<Values, SlotSummaries> | undefined;

function slotSummaries(y: Values): SlotSummaries {
  const all = summaries ??= new WeakMap();
  let bySlot = all.get(y);
  if (!bySlot) all.set(y, bySlot = new WeakMap());
  return bySlot;
}

export function hasBlockSummary(y: Values, slot: Uint8Array): boolean {
  return !!summaries?.get(y)?.get(slot);
}

export function drawingBlocks(y: Values, slot: Uint8Array, start: number, end: number): BlockSummary | undefined {
  const bySlot = slotSummaries(y);
  if (!bySlot.has(slot)) {
    // A single draw needs no index, even for gapped data or a shared slot column.
    bySlot.set(slot, null);
    return;
  }
  return summarizeBlocks(y, slot, start, end, bySlot);
}

export function summarizeBlocks(y: Values, slot: Uint8Array, start: number, end: number, bySlot = slotSummaries(y)): BlockSummary {
  // Published series views are immutable. The store appends beyond them and copies an
  // exposed tail before filling it, so views sharing a backing buffer have separate keys.
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
    if (block >= summary.start && block < summary.end) {
      block = summary.end - 1;
      continue;
    }
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
export function windowStatistics(y: Values, slot: Uint8Array, start: number, end: number): FullStatistics {
  const summary = summarizeBlocks(y, slot, start, end);
  const count = Math.floor(slot.length / WINDOW_SIZE);
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
        if (slot[j] === SLOT_VALUE && Number.isFinite(value)) {
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
