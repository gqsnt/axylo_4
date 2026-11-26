/**
 * C5.1 unit & property tests for `axylo/stats` (R-7 quantiles, Tukey 1.5xIQR box-plot transform,
 * columnar/row parity, missing values, outliers, zero borrowed-input mutation).
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { BOXPLOT_CONVENTION, QUANTILE_CONVENTION, boxplot, quantile, quantiles, summarizeBox } from '../../src/stats';

describe('C5.1 axylo/stats R-7 quantiles & Tukey box-plot transform', () => {
  it('declares explicit R-7 + Tukey 1.5xIQR conventions', () => {
    expect(QUANTILE_CONVENTION).toBe('R-7');
    expect(BOXPLOT_CONVENTION).toEqual({ quantile: 'R-7', whisker: 'tukey-iqr', defaultWhiskerFactor: 1.5 });
  });

  it('matches hand-computed R-7 quantiles, whiskers, and outliers', () => {
    // Sorted sample: [1, 10, 12, 13, 14, 15, 16, 18, 40] (n = 9)
    // h(0.25)=2 -> 12, h(0.5)=4 -> 14, h(0.75)=6 -> 16, IQR = 4
    // Fences: [12 - 6 = 6, 16 + 6 = 22] -> whiskerLow = 10, whiskerHigh = 18, outliers = [1, 40]
    const raw = [15, null, 40, 12, undefined, 1, 18, NaN, 13, 16, 10, 14, Infinity];
    const s = summarizeBox(raw);
    expect(s.count).toBe(9);
    expect(s.missing).toBe(4);
    expect(s.min).toBe(1);
    expect(s.q1).toBe(12);
    expect(s.median).toBe(14);
    expect(s.q3).toBe(16);
    expect(s.iqr).toBe(4);
    expect(s.whiskerLow).toBe(10);
    expect(s.whiskerHigh).toBe(18);
    expect(s.max).toBe(40);
    expect([...s.outliers]).toEqual([1, 40]);

    // Quantile interpolation check: [10, 20, 30, 40] -> h(0.25)=0.75 -> 17.5, h(0.5)=1.5 -> 25, h(0.75)=2.25 -> 32.5
    expect([...quantiles([40, 10, 30, 20], [0, 0.25, 0.5, 0.75, 1])]).toEqual([10, 17.5, 25, 32.5, 40]);
    expect(quantile([40, 10, 30, 20], 0.25)).toBe(17.5);
    expect(Number.isNaN(quantile([], 0.5))).toBe(true);
    expect(Number.isNaN(quantile([1, 2], 1.5))).toBe(true);
  });

  it('transforms both row arrays and borrowed typed columns identically without mutating inputs', () => {
    const rows = [
      { group: 'A', val: 10 }, { group: 'A', val: 12 }, { group: 'A', val: 14 }, { group: 'A', val: 16 }, { group: 'A', val: 50 },
      { group: 'B', val: 20 }, { group: 'B', val: 22 }, { group: 'B', val: 24 }, { group: 'B', val: null },
    ];
    const colY = new Float64Array([10, 12, 14, 16, 50, 20, 22, 24, NaN]);
    const colYCopy = Float64Array.from(colY);
    const fromRows = boxplot(rows, { x: 'group', y: 'val' });
    const fromCols = boxplot(
      { columns: { group: ['A', 'A', 'A', 'A', 'A', 'B', 'B', 'B', 'B'], val: colY } },
      { x: 'group', y: 'val' },
    );

    // Borrowed column was NOT mutated/sorted in place
    expect([...colY]).toEqual([...colYCopy]);
    expect(fromCols.groups.map(g => g.label)).toEqual(['A', 'B']);
    expect([...fromCols.data.columns.q1]).toEqual([...fromRows.data.columns.q1]);
    expect([...fromCols.data.columns.median]).toEqual([...fromRows.data.columns.median]);
    expect([...fromCols.data.columns.q3]).toEqual([...fromRows.data.columns.q3]);
    expect([...fromCols.data.columns.whiskerLow]).toEqual([...fromRows.data.columns.whiskerLow]);
    expect([...fromCols.data.columns.whiskerHigh]).toEqual([...fromRows.data.columns.whiskerHigh]);
    expect(fromRows.outliers.columns.x).toEqual(['A']);
    expect([...fromRows.outliers.columns.y]).toEqual([50]);
  });

  it('satisfies ordering and fence invariants across 200 random samples (fast-check)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }), { minLength: 1, maxLength: 80 }),
        samples => {
          const s = summarizeBox(samples);
          expect(s.count).toBe(samples.length);
          expect(s.min).toBeLessThanOrEqual(s.whiskerLow);
          expect(s.whiskerLow).toBeLessThanOrEqual(s.q1);
          expect(s.q1).toBeLessThanOrEqual(s.median);
          expect(s.median).toBeLessThanOrEqual(s.q3);
          expect(s.q3).toBeLessThanOrEqual(s.whiskerHigh);
          expect(s.whiskerHigh).toBeLessThanOrEqual(s.max);
          expect(s.iqr).toBeCloseTo(s.q3 - s.q1, 10);
          for (let i = 0; i < s.outliers.length; i++) {
            const v = s.outliers[i]!;
            expect(v < s.whiskerLow || v > s.whiskerHigh).toBe(true);
            if (i > 0) expect(v).toBeGreaterThanOrEqual(s.outliers[i - 1]!);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
