/**
 * N5: R-7 quantiles and Tukey summaries stay finite, ordered and inside the data at extreme finite inputs.
 * Hand-computed expectations (h = p (n - 1), Q = x[i] + f (x[i+1] - x[i]), evaluated without overflow):
 * - [-1e308, 1e308]: Q(0.5) = 0 (the difference 2e308 is past Number.MAX_VALUE).
 * - [-MAX, MAX]: Q(0.25) = -MAX / 2, Q(0.75) = MAX / 2.
 * - [-MAX, -0.9 MAX, -0.9 MAX, 0.9 MAX, 0.9 MAX, MAX], k = 0: Q1 = -0.9 MAX, Q3 = 0.9 MAX, IQR = 1.8 MAX is not
 *   representable (Infinity), the fences are Q1 and Q3, so the whiskers are ±0.9 MAX and ±MAX are outliers.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { boxplot, quantile, quantiles, summarizeBox } from '../../src/stats';

const MAX = Number.MAX_VALUE;

describe('N5 stats overflow hardening', () => {
  it('interpolates opposite-sign extremes without overflow', () => {
    expect(quantile([-1e308, 1e308], 0.5)).toBe(0);
    expect(quantile([-MAX, MAX], 0.5)).toBe(0);
    const q = quantiles([-MAX, MAX], [0, 0.25, 0.75, 1]);
    expect(q[0]).toBe(-MAX);
    expect(q[3]).toBe(MAX);
    expect(q[1]! / (-MAX / 2)).toBeCloseTo(1, 14);
    expect(q[2]! / (MAX / 2)).toBeCloseTo(1, 14);
  });

  it('keeps exact endpoints and same-sign values near MAX_VALUE finite and in order', () => {
    const values = [0.9 * MAX, MAX, 0.95 * MAX];
    expect(quantile(values, 0)).toBe(0.9 * MAX);
    expect(quantile(values, 1)).toBe(MAX);
    const s = summarizeBox(values);
    for (const v of [s.min, s.whiskerLow, s.q1, s.median, s.q3, s.whiskerHigh, s.max, s.iqr, s.mean]) expect(Number.isFinite(v)).toBe(true);
    expect(s.median).toBe(0.95 * MAX);
    expect(s.mean / (0.95 * MAX)).toBeCloseTo(1, 14);
    expect(summarizeBox([MAX, MAX]).mean).toBe(MAX);
    expect(summarizeBox([-MAX, -MAX]).mean).toBe(-MAX);
  });

  it('reports an unrepresentable IQR as Infinity and keeps k = 0 fences on the quartiles', () => {
    const values = [-MAX, -0.9 * MAX, -0.9 * MAX, 0.9 * MAX, 0.9 * MAX, MAX];
    const zero = summarizeBox(values, { whiskerFactor: 0 });
    expect(zero.q1).toBe(-0.9 * MAX);
    expect(zero.q3).toBe(0.9 * MAX);
    expect(zero.iqr).toBe(Infinity);
    expect(zero.whiskerLow).toBe(-0.9 * MAX);
    expect(zero.whiskerHigh).toBe(0.9 * MAX);
    expect(Array.from(zero.outliers)).toEqual([-MAX, MAX]);
    const tukey = summarizeBox(values);
    expect(tukey.whiskerLow).toBe(-MAX);
    expect(tukey.whiskerHigh).toBe(MAX);
    expect(tukey.outliers.length).toBe(0);
    const grouped = boxplot(values.map(v => ({ g: 'a', v })), { x: 'g', y: 'v', whiskerFactor: 0 });
    expect(Array.from(grouped.outliers.columns.y)).toEqual([-MAX, MAX]);
  });

  it('keeps every quantile of finite values finite, ordered in p and inside [min, max] (property)', () => {
    const extreme = fc.oneof(
      fc.double({ noNaN: true, noDefaultInfinity: true }),
      fc.constantFrom(MAX, -MAX, 1e308, -1e308, 0, -0, Number.MIN_VALUE),
    );
    fc.assert(fc.property(
      fc.array(extreme, { minLength: 1, maxLength: 40 }), fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 2, maxLength: 8 }),
      (values, probs) => {
        const sorted = [...probs].sort((a, b) => a - b);
        const q = quantiles(values, sorted);
        const min = Math.min(...values), max = Math.max(...values);
        for (let i = 0; i < q.length; i++) {
          expect(Number.isFinite(q[i]!)).toBe(true);
          expect(q[i]!).toBeGreaterThanOrEqual(min);
          expect(q[i]!).toBeLessThanOrEqual(max);
          if (i > 0) expect(q[i]!).toBeGreaterThanOrEqual(q[i - 1]!);
        }
      },
    ), { numRuns: 1000 });
  });

  it('keeps min <= whiskerLow <= q1 <= median <= q3 <= whiskerHigh <= max at extremes for every k (property)', () => {
    const extreme = fc.oneof(
      fc.double({ noNaN: true, noDefaultInfinity: true }),
      fc.constantFrom(MAX, -MAX, 0.9 * MAX, -0.9 * MAX),
    );
    fc.assert(fc.property(
      fc.array(extreme, { minLength: 1, maxLength: 40 }), fc.constantFrom(0, 0.5, 1.5, 3, 1e300),
      (values, k) => {
        const s = summarizeBox(values, { whiskerFactor: k });
        const chain = [s.min, s.whiskerLow, s.q1, s.median, s.q3, s.whiskerHigh, s.max];
        for (const v of chain) expect(Number.isFinite(v)).toBe(true);
        for (let i = 1; i < chain.length; i++) expect(chain[i]!).toBeGreaterThanOrEqual(chain[i - 1]!);
        expect(Number.isNaN(s.iqr)).toBe(false);
        expect(s.iqr).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(s.mean)).toBe(true);
        for (const o of s.outliers) expect(o < s.whiskerLow || o > s.whiskerHigh).toBe(true);
        const inside = values.filter(v => v >= s.whiskerLow && v <= s.whiskerHigh).length;
        expect(inside + s.outliers.length).toBe(values.length);
      },
    ), { numRuns: 1000 });
  });

  // Review finding 6. [-MAX, -1e308, -1e308, 1e308, 1e308, MAX], n = 6: Q1 (h = 1.25) = -1e308, Q3 (h = 3.75) = 1e308,
  // IQR = 2e308 is past MAX. With k = 0.1 the fences are -1e308 - 0.1 * 2e308 = -1.2e308 and +1.2e308, both
  // finite, so the endpoints ±MAX (about ±1.797e308) are outliers and the whiskers end at ±1e308.
  it('scales an overflowed IQR before applying a small whisker factor', () => {
    const s = summarizeBox([-MAX, -1e308, -1e308, 1e308, 1e308, MAX], { whiskerFactor: 0.1 });
    expect(s.q1).toBe(-1e308);
    expect(s.q3).toBe(1e308);
    expect(s.iqr).toBe(Infinity);
    expect(Array.from(s.outliers)).toEqual([-MAX, MAX]);
    expect(s.whiskerLow).toBe(-1e308);
    expect(s.whiskerHigh).toBe(1e308);
    // k = 1: the fences (±3e308) are past the finite range, so no finite value is an outlier.
    const wide = summarizeBox([-MAX, -1e308, -1e308, 1e308, 1e308, MAX], { whiskerFactor: 1 });
    expect(wide.outliers.length).toBe(0);
    expect(wide.whiskerLow).toBe(-MAX);
    expect(wide.whiskerHigh).toBe(MAX);
  });

  // Cross-provider seal review finding 4: [-MAX, 5e307, 5e307, 1.75e308, 1.75e308], n = 5, k = 1.5:
  // Q1 = 5e307, median = 5e307, Q3 = 1.75e308, IQR = 1.25e308 (finite). 1.5 * IQR = 1.875e308 overflows MAX,
  // yet lowerFence = 5e307 - 1.875e308 = -1.375e308 is finite, so -MAX is an outlier and whiskerLow = 5e307.
  // Mirrored case [-1.75e308, -1.75e308, -5e307, -5e307, MAX]: upperFence = +1.375e308, MAX is an outlier.
  it('scales a finite IQR when k * IQR overflows without dropping finite fences', () => {
    const low = summarizeBox([-MAX, 5e307, 5e307, 1.75e308, 1.75e308]);
    expect(low.q1).toBe(5e307);
    expect(low.median).toBe(5e307);
    expect(low.q3).toBe(1.75e308);
    expect(low.iqr).toBe(1.25e308);
    expect(Number.isFinite(low.iqr)).toBe(true);
    expect(low.whiskerLow).toBe(5e307);
    expect(low.whiskerHigh).toBe(1.75e308);
    expect(Array.from(low.outliers)).toEqual([-MAX]);

    const high = summarizeBox([-1.75e308, -1.75e308, -5e307, -5e307, MAX]);
    expect(high.q1).toBe(-1.75e308);
    expect(high.median).toBe(-5e307);
    expect(high.q3).toBe(-5e307);
    expect(high.iqr).toBe(1.25e308);
    expect(Number.isFinite(high.iqr)).toBe(true);
    expect(high.whiskerLow).toBe(-1.75e308);
    expect(high.whiskerHigh).toBe(-5e307);
    expect(Array.from(high.outliers)).toEqual([MAX]);

    const lowZero = summarizeBox([-MAX, 5e307, 5e307, 1.75e308, 1.75e308], { whiskerFactor: 0 });
    expect(lowZero.whiskerLow).toBe(5e307);
    expect(lowZero.whiskerHigh).toBe(1.75e308);
    expect(Array.from(lowZero.outliers)).toEqual([-MAX]);

    const highZero = summarizeBox([-1.75e308, -1.75e308, -5e307, -5e307, MAX], { whiskerFactor: 0 });
    expect(highZero.whiskerLow).toBe(-1.75e308);
    expect(highZero.whiskerHigh).toBe(-5e307);
    expect(Array.from(highZero.outliers)).toEqual([MAX]);
  });
});
