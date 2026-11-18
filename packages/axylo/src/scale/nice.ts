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
  // Dividing an exact integer by an exact power of ten gives the double nearest the decimal value.
  if (exponent >= 0) return n * 10 ** exponent;
  if (exponent >= -300) return n / 10 ** -exponent;
  return n * 10 ** exponent;
}

/** The smallest nice step at or above `x` (x > 0 and finite). */
export function niceStepAtLeast(x: number): NiceStep {
  const exponent = Math.floor(Math.log10(x));
  const base = 10 ** exponent;
  const r = x / base;
  // Tolerance: log10 and the division are off by an ulp or two for values like 0.2 or 5e-7.
  const tol = 1 + 1e-9;
  if (r <= tol) return make(1, exponent);
  if (r <= 2 * tol) return make(2, exponent);
  if (r <= 5 * tol) return make(5, exponent);
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

/** Index of the first multiple of the step at or above x. */
export function firstIndexAtOrAbove(x: number, s: NiceStep): number {
  const q = x / s.value;
  let i = Math.ceil(q - 1e-9 * Math.max(1, Math.abs(q)));
  // Bounded: where the step is below the resolution of x, neighbouring multiples are the same double.
  for (let n = 0; n < 4 && stepMultiple(i, s) < x; n++) i++;
  for (let n = 0; n < 4 && stepMultiple(i - 1, s) >= x; n++) i--;
  return i;
}

/** Index of the last multiple of the step at or below x. */
export function lastIndexAtOrBelow(x: number, s: NiceStep): number {
  const q = x / s.value;
  let i = Math.floor(q + 1e-9 * Math.max(1, Math.abs(q)));
  for (let n = 0; n < 4 && stepMultiple(i, s) > x; n++) i--;
  for (let n = 0; n < 4 && stepMultiple(i + 1, s) <= x; n++) i++;
  return i;
}

/** Most ticks in the densest candidate set. Layout never fits more on a readable axis. */
export const MAX_TICKS = 12;
