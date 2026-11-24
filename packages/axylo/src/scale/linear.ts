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
  const map = d0 === d1 ? () => r0 / 2 + r1 / 2 : interpolate(d0, d1, r0, r1);
  const invert = r0 === r1 || d0 === d1 ? () => d0 : interpolate(r0, r1, d0, d1);
  return { type, domain: [d0, d1], range: [r0, r1], map, invert };
}

function interpolate(a: number, b: number, start: number, end: number): (v: number) => number {
  const span = b - a;
  const extent = end - start;
  if (extent === 0) return () => start;
  return v => {
    if (v === a) return start;
    if (v === b) return end;
    const delta = v - a;
    // Differences across opposite signs can overflow even when their ratio is small.
    const f = Number.isFinite(span) && Number.isFinite(delta) ? delta / span
      : (v / 2 - a / 2) / (b / 2 - a / 2);
    if (!Number.isFinite(extent)) return start * (1 - f) + end * f;
    const offset = f * extent;
    return Number.isFinite(offset) ? start + offset : (start / 2 + f * (extent / 2)) * 2;
  };
}

function sortedDomain(domain: readonly [number, number]): [number, number] {
  return domain[0] <= domain[1] ? [domain[0], domain[1]] : [domain[1], domain[0]];
}

/**
 * Tick sets at nice steps (1, 2, 5 × 10^k), densest first, every tick inside the domain.
 * The densest set has at most MAX_TICKS ticks; the sparsest has one.
 */
export function linearTickCandidates(domain: readonly [number, number], format: TickLabeler, deferLabels = false): TickCandidates {
  const [lo, hi] = sortedDomain(domain);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  // A width that no nice step can resolve (subnormal, or below the precision of the values) gets one tick.
  // Divided before subtracting, so that [-1e308, 1e308] does not overflow.
  const width = hi / (MAX_TICKS - 1) - lo / (MAX_TICKS - 1);
  const tick = (value: number, context: TickContext): Tick => {
    if (!deferLabels) return { value, label: format(value, context) };
    // Domain selection reads positions. Only layout needs the built-in label.
    let label: string;
    return { value, get label() { return label ??= format(value, context); } };
  };
  const single = (value: number): Tick[] => [tick(value, { step: 0, maxAbs: Math.abs(value) })];
  const tooNarrow = !(width > 0) || hi - lo <= 4 * Number.EPSILON * Math.max(Math.abs(lo), Math.abs(hi));
  if (lo === hi || tooNarrow) {
    return [single(lo === 0 ? 0 : lo)];
  }
  const sets: Tick[][] = [];
  let step = niceStepAtLeast(width);
  for (let guard = 0; guard < 40 && Number.isFinite(step.value); guard++) {
    const i0 = firstIndexAtOrAbove(lo, step);
    const i1 = lastIndexAtOrBelow(hi, step);
    // Beyond 2^53 the index arithmetic is no longer exact (i + 1 === i), and a double cannot hold those
    // multiples anyway: such a step is below the resolution of the values, so try a coarser one.
    if (!(Math.max(Math.abs(i0), Math.abs(i1)) * step.mantissa <= Number.MAX_SAFE_INTEGER)) {
      step = nextNiceStep(step);
      continue;
    }
    const count = i1 - i0 + 1;
    if (count >= 1 && count <= MAX_TICKS) {
      const values: number[] = [];
      // Counted, not `i <= i1`: the loop must end whatever the index arithmetic does.
      for (let n = 0; n < count; n++) {
        const v = stepMultiple(i0 + n, step);
        // Where the step is below the resolution of the values, neighbours collapse to one double.
        if (v >= lo && v <= hi && values[values.length - 1] !== v) values.push(v);
      }
      if (values.length > 0) {
        const maxAbs = Math.max(Math.abs(values[0] as number), Math.abs(values[values.length - 1] as number));
        const context: TickContext = { step: step.value, maxAbs };
        const set = values.map(value => tick(value, context));
        pushCandidate(sets, set);
      }
    }
    if (count <= 1) break;
    step = nextNiceStep(step);
  }
  // Every step was below the resolution of the values: one tick, as for a domain too narrow to divide.
  if (sets.length === 0) {
    return [single(lo === 0 ? 0 : lo)];
  }
  // A coarser step can jump from several multiples straight to none.
  const last = sets[sets.length - 1]!;
  if (last.length > 1) {
    const v = lo <= 0 && hi >= 0 ? 0 : last[0]!.value;
    sets.push(single(v));
  }
  return sets;
}

/**
 * Keeps the sequence strictly decreasing in size. When a coarser step gives as many ticks as the previous
 * set, the coarser one replaces it: same density, rounder numbers.
 */
export function pushCandidate<T extends { length: number }>(sets: T[], set: T): void {
  const last = sets[sets.length - 1];
  if (last !== undefined && set.length >= last.length) {
    if (set.length === last.length) sets[sets.length - 1] = set;
    return;
  }
  sets.push(set);
}
