import type { ContinuousScale, Tick, TickCandidates } from '../core/contracts';
import { MAX_TICKS, firstIndexAtOrAbove, lastIndexAtOrBelow, nextNiceStep, niceStepAtLeast, stepMultiple } from './nice';

/** What a tick labeler knows about the set its value belongs to. */
export interface TickContext {
  /** Distance between adjacent ticks of the set. */
  readonly step: number;
  /** Largest absolute tick value of the set. */
  readonly maxAbs: number;
}

/** Writes one tick label. A plain `(value) => string` is a valid labeler. */
export type TickLabeler = (value: number, context: TickContext) => string;

export function linearScale(domain: readonly [number, number], range: readonly [number, number]): ContinuousScale {
  return continuous('linear', domain, range);
}

/** Shared by linear and time scales: both are linear in their domain units (time: epoch ms). */
export function continuous(type: 'linear' | 'time', domain: readonly [number, number], range: readonly [number, number]): ContinuousScale {
  const d0 = domain[0];
  const d1 = domain[1];
  const r0 = range[0];
  const r1 = range[1];
  const span = d1 - d0;
  const extent = r1 - r0;
  const mid = r0 / 2 + r1 / 2;
  // A domain wider than the largest double (say [-1e308, 1e308]) is interpolated on halves, so the
  // intermediate width never overflows.
  const overflow = !Number.isFinite(span) && Number.isFinite(d0) && Number.isFinite(d1);
  const halfSpan = d1 / 2 - d0 / 2;
  let map: (v: number) => number;
  let invert: (p: number) => number;
  if (span === 0) map = () => mid; // a zero-width domain (one value, one instant) is drawn in the middle
  else if (overflow) map = (v: number) => r0 + ((v / 2 - d0 / 2) / halfSpan) * extent;
  else map = (v: number) => r0 + ((v - d0) / span) * extent;
  if (extent === 0) invert = () => d0;
  else if (overflow) invert = (p: number) => {
    const f = (p - r0) / extent;
    return d0 * (1 - f) + d1 * f;
  };
  else invert = (p: number) => d0 + ((p - r0) / extent) * span;
  return { type, domain: [d0, d1], range: [r0, r1], map, invert };
}

function sortedDomain(domain: readonly [number, number]): [number, number] {
  return domain[0] <= domain[1] ? [domain[0], domain[1]] : [domain[1], domain[0]];
}

/**
 * Tick sets at nice steps (1, 2, 5 × 10^k), densest first, every tick inside the domain.
 * The densest set has at most MAX_TICKS ticks; the sparsest has one.
 */
export function linearTickCandidates(domain: readonly [number, number], format: TickLabeler): TickCandidates {
  const [lo, hi] = sortedDomain(domain);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  // A width that no nice step can resolve (subnormal, or below the precision of the values) gets one tick.
  // Divided before subtracting, so that [-1e308, 1e308] does not overflow.
  const width = hi / (MAX_TICKS - 1) - lo / (MAX_TICKS - 1);
  const tooNarrow = !(width > 1e-300) || hi - lo <= 4 * Number.EPSILON * Math.max(Math.abs(lo), Math.abs(hi));
  if (lo === hi || tooNarrow) {
    const v = lo === 0 ? 0 : lo;
    return [[{ value: v, label: format(v, { step: 0, maxAbs: Math.abs(v) }) }]];
  }
  const sets: Tick[][] = [];
  let step = niceStepAtLeast(width);
  for (let guard = 0; guard < 40 && Number.isFinite(step.value); guard++) {
    const i0 = firstIndexAtOrAbove(lo, step);
    const i1 = lastIndexAtOrBelow(hi, step);
    const count = i1 - i0 + 1;
    if (count >= 1 && count <= MAX_TICKS) {
      const values: number[] = [];
      for (let i = i0; i <= i1; i++) {
        const v = stepMultiple(i, step);
        // Where the step is below the resolution of the values, neighbours collapse to one double.
        if (v >= lo && v <= hi && values[values.length - 1] !== v) values.push(v);
      }
      if (values.length > 0) {
        const maxAbs = Math.max(Math.abs(values[0] as number), Math.abs(values[values.length - 1] as number));
        const context: TickContext = { step: step.value, maxAbs };
        const set = values.map(value => ({ value, label: format(value, context) }));
        pushCandidate(sets, set);
      }
    }
    if (count <= 1) break;
    step = nextNiceStep(step);
  }
  // Near the largest doubles the next step overflows; the only multiple of an infinite step is zero.
  const last = sets[sets.length - 1];
  if (!Number.isFinite(step.value) && last !== undefined && last.length > 1 && lo <= 0 && hi >= 0) {
    pushCandidate(sets, [{ value: 0, label: format(0, { step: 0, maxAbs: 0 }) }]);
  }
  return sets;
}

/**
 * Keeps the sequence strictly decreasing in size. When a coarser step gives as many ticks as the previous
 * set, the coarser one replaces it: same density, rounder numbers.
 */
export function pushCandidate(sets: Tick[][], set: Tick[]): void {
  const last = sets[sets.length - 1];
  if (last !== undefined && set.length >= last.length) {
    if (set.length === last.length) sets[sets.length - 1] = set;
    return;
  }
  sets.push(set);
}
