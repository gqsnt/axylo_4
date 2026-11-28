import { SLOT_VALUE, type Series } from '../core/contracts';
import { denseSlots, fullStatistics, seriesSlots } from './series';

// Existing readers import this module. Their read-side exports can be bundled independently.
export * from './series';

// Shared state columns allocated for a dense store y buffer on first .slot read or first sparse write.
let sharedStatesMap: WeakMap<ArrayBufferLike, Uint8Array> | undefined;
export function existingSharedStates(y: Float64Array): Uint8Array | undefined {
  return sharedStatesMap?.get(y.buffer);
}
export function sharedStatesFor(y: Float64Array): Uint8Array {
  let states = sharedStatesMap?.get(y.buffer);
  if (!states) (sharedStatesMap ??= new WeakMap()).set(y.buffer, states = new Uint8Array(y.length));
  return states;
}

/** Only the store's regular one-row append certifies that all retained slots are unchanged. */
export function extendStatistics(previous: Series, next: Series, dropped: boolean): void {
  const known = fullStatistics.get(previous);
  if (!known) return;
  const { ordered, signed } = known;
  const before = seriesSlots(previous), after = seriesSlots(next);
  if (after && (!before || denseSlots.has(before))) denseSlots.set(after, 'fresh');
  if (dropped && (!before || before[0] === SLOT_VALUE)) {
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
