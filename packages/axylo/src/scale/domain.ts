/**
 * The value-axis domain (spec F1 and F7).
 *
 * Precedence: an author domain is used as given (widened to zero on bar and area); otherwise the automatic
 * domain covers the data, stack totals and reference values, and each end is the first nice tick at or
 * beyond the extreme, so it never overshoots by a whole step.
 */
import { firstIndexAtOrAbove, lastIndexAtOrBelow, niceStepAtLeast, stepMultiple, type NiceStep } from './nice';

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

/** The step the automatic domain of [lo, hi] is rounded to (lo < hi). */
export function domainStep(lo: number, hi: number): NiceStep {
  return niceStepAtLeast((hi - lo) / DOMAIN_INTERVALS);
}

export function valueDomain(input: ValueDomainInput): ValueDomain {
  const author = input.authorDomain;
  if (author != null && Number.isFinite(author[0]) && Number.isFinite(author[1])) {
    let lo = Math.min(author[0], author[1]);
    let hi = Math.max(author[0], author[1]);
    let widenedToZero = false;
    if (input.includeZero && (lo > 0 || hi < 0)) {
      lo = Math.min(lo, 0);
      hi = Math.max(hi, 0);
      widenedToZero = true;
    }
    if (lo === hi) return { domain: aroundConstant(lo, input.includeZero), widenedToZero };
    return { domain: [lo, hi], widenedToZero };
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
  if (full !== null && hi >= full / 2 && hi <= full) hi = full;
  if (lo === hi) return { domain: aroundConstant(lo, input.includeZero), widenedToZero: false };
  return { domain: niceExtent(lo, hi), widenedToZero: false };
}

/** [lo, hi] rounded outwards to the first multiple of the domain step at or beyond each end. */
export function niceExtent(lo: number, hi: number): [number, number] {
  const step = domainStep(lo, hi);
  return [stepMultiple(lastIndexAtOrBelow(lo, step), step), stepMultiple(firstIndexAtOrAbove(hi, step), step)];
}

/**
 * A usable domain for a single value. Zero gets [0, 1]; any other value gets a nice range about 10%
 * either side (or from zero when zero must be included, which only happens for zero itself here).
 */
function aroundConstant(v: number, includeZero: boolean): [number, number] {
  // Below 1e-300 a tenth of the value is not representable; such a value is drawn as zero would be.
  if (Math.abs(v) < 1e-300) return includeZero ? [Math.min(0, v), 1] : [-1, 1];
  const h = Math.abs(v) * 0.1;
  return niceExtent(v - h, v + h);
}
