/**
 * The value-axis domain (spec F1 and F7).
 *
 * Precedence: an author domain is used as given (widened to zero on bar and area); otherwise the automatic
 * domain covers the data, stack totals and reference values, and each end is the first nice tick at or
 * beyond the extreme, so it never overshoots by a whole step.
 */
import { firstIndexAtOrAbove, lastIndexAtOrBelow, nextNiceStep, niceStepAtLeast, stepMultiple, type NiceStep } from './nice';

export interface ValueDomainInput {
  /** Smallest and largest value, stack totals included. NaN (or min > max) when there is no data. */
  readonly min: number;
  readonly max: number;
  /** True for bar and area. */
  readonly includeZero: boolean;
  /** The field's `domain` option. */
  readonly authorDomain?: readonly [number, number] | null;
  /** The field's declared `scale`. */
  readonly valueScale?: 'percent' | 'ratio' | null;
  /** Reference values (lines and band ends) that must be visible. */
  readonly references?: readonly number[];
}

export interface ValueDomain {
  readonly domain: [number, number];
  /** True when an author domain excluded zero and was widened (the caller raises AX110). */
  readonly widenedToZero: boolean;
}

/**
 * Number of intervals the automatic domain is rounded to. About five gives ends that are rarely more than
 * a fifth of the span beyond the data, on a step that is one of the tick candidate sets.
 */
const DOMAIN_INTERVALS = 5;

/** The step the automatic domain of [lo, hi] is rounded to (lo < hi). Divided first so that a span wider than the largest double does not overflow. */
export function domainStep(lo: number, hi: number): NiceStep {
  const span = hi - lo;
  return Number.isFinite(span) ? niceStepAtLeast(span, DOMAIN_INTERVALS)
    : niceStepAtLeast(hi / DOMAIN_INTERVALS - lo / DOMAIN_INTERVALS);
}

export function valueDomain(input: ValueDomainInput): ValueDomain {
  const author = input.authorDomain;
  if (author != null && Number.isFinite(author[0]) && Number.isFinite(author[1])) {
    // Author bounds take precedence (F7) and are used as given, a zero-width domain included (the scale
    // draws it in the middle). Only the zero rule of F1 changes them.
    let lo = Math.min(author[0], author[1]);
    let hi = Math.max(author[0], author[1]);
    let widenedToZero = false;
    if (input.includeZero && (lo > 0 || hi < 0)) {
      lo = Math.min(lo, 0);
      hi = Math.max(hi, 0);
      widenedToZero = true;
    }
    return { domain: [lo === 0 ? 0 : lo, hi === 0 ? 0 : hi], widenedToZero };
  }

  let lo = Infinity;
  let hi = -Infinity;
  if (Number.isFinite(input.min) && Number.isFinite(input.max) && input.min <= input.max) {
    lo = input.min;
    hi = input.max;
  }
  for (const r of input.references ?? []) {
    if (!Number.isFinite(r)) continue;
    if (r < lo) lo = r;
    if (r > hi) hi = r;
  }
  if (lo > hi) return { domain: [0, 1], widenedToZero: false }; // nothing to show; the chart shows its empty state
  if (input.includeZero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  const full = input.valueScale === 'percent' ? 100 : input.valueScale === 'ratio' ? 1 : null;
  // The full-scale end is fixed; only the other end is rounded.
  const fixedTop = full !== null && hi >= full / 2 && hi <= full;
  if (fixedTop) hi = full;
  const domain = lo === hi ? aroundConstant(lo, fixedTop, input.includeZero) : niceExtent(lo, hi, fixedTop);
  return { domain: usable(domain, lo, hi), widenedToZero: false };
}

/**
 * [lo, hi] rounded outwards to the first multiple of the domain step at or beyond each end. With `fixedTop`
 * the upper end is kept as it is.
 */
export function niceExtent(lo: number, hi: number, fixedTop = false): [number, number] {
  const step = domainStep(lo, hi);
  if (!(step.value > 0 && Number.isFinite(step.value))) return [lo, hi];
  const a = stepMultiple(lastIndexAtOrBelow(lo, step), step);
  const b = fixedTop ? hi : stepMultiple(firstIndexAtOrAbove(hi, step), step);
  return [a, b];
}

/**
 * A usable domain for a single value v (only reached without includeZero, or for zero itself). Zero gets
 * [0, 1] or [-1, 1]; any other value gets a nice range about 10% either side, or below it when v is the
 * fixed full-scale top.
 */
function aroundConstant(v: number, fixedTop: boolean, includeZero: boolean): [number, number] {
  // Zero on a bar or area axis starts at the baseline.
  if (v === 0) return includeZero ? [0, 1] : [-1, 1];
  const h = Math.abs(v) * 0.1;
  if (h === 0) return [-1, 1];
  if (fixedTop || !Number.isFinite(v + h)) return niceExtent(v - 2 * h, v, true);
  if (!Number.isFinite(v - h)) return [v, niceExtent(v, v + 2 * h)[1]];
  return niceExtent(v - h, v + h);
}

/**
 * The rounded domain if it is finite, ordered and contains [lo, hi]; otherwise the finite input bounds,
 * so no rounding artefact (overflow, underflow, a step below the resolution of the values) reaches a scale.
 */
function usable(domain: [number, number], lo: number, hi: number): [number, number] {
  const [a, b] = domain;
  if (Number.isFinite(a) && Number.isFinite(b) && a <= lo && b >= hi && a < b) return [a === 0 ? 0 : a, b === 0 ? 0 : b];
  if (lo < hi) return [lo, hi];
  // A single value whose rounded neighbourhood failed: any finite interval around it.
  const h = Math.abs(lo) * 0.2;
  if (Number.isFinite(lo - h) && lo - h < lo) return [lo - h, lo];
  if (Number.isFinite(lo + h) && lo + h > lo) return [lo, lo + h];
  return [lo - 1, lo + 1];
}

/**
 * Coarser automatic domains for [lo, hi] than `domain`, each on a larger nice step and ending at the first
 * multiple of that step at or beyond each extreme, sparsest last (one interval). A plot too short for the
 * ticks of `domain` takes one of these, so its axis still ends at drawn ticks (F7). With `fixedTop` the upper
 * end stays at `domain`'s and the lower end is a whole number of steps below it.
 */
export function coarserDomains(lo: number, hi: number, domain: readonly [number, number], fixedTop = false): [number, number][] {
  const out: [number, number][] = [];
  if (!(lo < hi) || !Number.isFinite(lo) || !Number.isFinite(hi)) return out;
  const b0 = domain[1];
  // The automatic domain's own step, then each coarser one.
  let step: NiceStep = nextNiceStep(domainStep(lo, fixedTop ? b0 : hi));
  let intervals = Infinity;
  // Bounded: each step at least doubles, and the domain is reached in one interval within a few steps.
  for (let n = 0; n < 12 && intervals > 1; n++, step = nextNiceStep(step)) {
    const b = fixedTop ? b0 : stepMultiple(firstIndexAtOrAbove(hi, step), step);
    // When the top is already on the grid, round lo directly to keep decimal multiples exact.
    const a = fixedTop && stepMultiple(Math.round(b / step.value), step) !== b
      ? b - stepMultiple(firstIndexAtOrAbove(b - lo, step), step)
      : stepMultiple(lastIndexAtOrBelow(lo, step), step);
    if (!(Number.isFinite(a) && Number.isFinite(b) && a < b && a <= lo && b >= hi)) continue;
    const count = Math.round(b / step.value - a / step.value);
    if (count >= intervals) continue;
    intervals = count;
    // A domain already offered keeps its ticks of every step: only a wider one is new.
    if ((a === domain[0] && b === domain[1]) || out.some(d => d[0] === a && d[1] === b)) continue;
    out.push([a === 0 ? 0 : a, b === 0 ? 0 : b]);
  }
  return out;
}
