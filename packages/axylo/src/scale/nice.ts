/**
 * Nice steps: 1, 2 or 5 times a power of ten. Multiples of a step are computed from integers so that
 * 3 × 0.1 comes out as 0.3, not 0.30000000000000004, and ticks compare exactly with domain ends.
 */

export interface NiceStep {
  /** 1, 2 or 5. */
  readonly mantissa: 1 | 2 | 5;
  readonly exponent: number;
  /** mantissa × 10^exponent as a number. */
  readonly value: number;
}

function make(mantissa: 1 | 2 | 5, exponent: number): NiceStep {
  return { mantissa, exponent, value: multiple(1, mantissa, exponent) };
}

function multiple(i: number, mantissa: number, exponent: number): number {
  const n = i * mantissa;
  if (Number.isSafeInteger(n)) return Number(`${n}e${exponent}`);
  if (exponent < 0 && exponent >= -300) return n / 10 ** -exponent;
  return n * 10 ** exponent;
}

/** Smallest nice step whose given number of intervals covers x. */
export function niceStepAtLeast(x: number, intervals = 1): NiceStep {
  const exponent = Math.floor(Math.log10(Math.max(Number.MIN_VALUE, x / intervals)));
  for (const m of [1, 2, 5] as const) {
    const step = make(m, exponent);
    // Compare the full decimal multiple: dividing 5e24 by five rounds above 1e24.
    if ((intervals === 1 ? step.value : stepMultiple(intervals, step)) >= x && step.value > 0) return step;
  }
  return make(1, exponent + 1);
}

/** The next coarser nice step. */
export function nextNiceStep(s: NiceStep): NiceStep {
  if (s.mantissa === 1) return make(2, s.exponent);
  if (s.mantissa === 2) return make(5, s.exponent);
  return make(1, s.exponent + 1);
}

/** i × step, cleaned. */
export function stepMultiple(i: number, s: NiceStep): number {
  const v = multiple(i, s.mantissa, s.exponent);
  return v === 0 ? 0 : v; // no -0
}

/**
 * Index of the first multiple of the step at or above x. The quotient is off by at most an index or two
 * from rounding, so the estimate starts at the plain quotient and is corrected by comparing the actual
 * multiples with x. (A relative tolerance on the quotient would move a large index by dozens of steps.)
 */
export function firstIndexAtOrAbove(x: number, s: NiceStep): number {
  let i = Math.ceil(x / s.value);
  // Bounded: where the step is below the resolution of x, neighbouring multiples are the same double.
  for (let n = 0; n < 8 && stepMultiple(i, s) < x; n++) i++;
  for (let n = 0; n < 8 && stepMultiple(i - 1, s) >= x; n++) i--;
  return i;
}

/** Index of the last multiple of the step at or below x. */
export function lastIndexAtOrBelow(x: number, s: NiceStep): number {
  let i = Math.floor(x / s.value);
  for (let n = 0; n < 8 && stepMultiple(i, s) > x; n++) i--;
  for (let n = 0; n < 8 && stepMultiple(i + 1, s) <= x; n++) i++;
  return i;
}

/** Most ticks in the densest candidate set. Layout never fits more on a readable axis. */
export const MAX_TICKS = 12;
