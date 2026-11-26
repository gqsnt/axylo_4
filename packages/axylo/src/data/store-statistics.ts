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

export const fullStatistics = new WeakMap<Series, FullStatistics>();

// Presence certifies a continuous column. Its first dense draw can defer building a block index.
export const denseSlots = new WeakMap<Uint8Array, 'fresh' | 'drawn'>();

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
