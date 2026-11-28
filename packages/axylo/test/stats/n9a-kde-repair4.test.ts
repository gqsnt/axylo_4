/**
 * N9a repair round 4 (review sol-6.2-medium__20261127T211253Z, findings 1–2). Expected values from the definitions:
 * - a bandwidth far above a clamp [a, b] reflects the kernel into a flat density: 1 / (b − a) by area, 1 by width;
 * - a finite clamp is accepted when its grid of `points` values is strictly increasing and the density finite;
 * - the mean of [-MAX, 1e-307, MAX] is 1e-307 / 3.
 */
import { describe, expect, it } from 'vitest';
import { kde, violinData } from '../../src/stats';

const MAX = Number.MAX_VALUE;
const u = 2 ** -52;
const finiteAndIncreasing = (r: { grid: Float64Array; density: Float64Array }) => {
  for (let k = 0; k < r.grid.length; k++) {
    expect(Number.isFinite(r.density[k]!) && r.density[k]! >= 0).toBe(true);
    if (k) expect(r.grid[k]!).toBeGreaterThan(r.grid[k - 1]!);
  }
};

describe('N9a repair 4: tight clamps are checked on their grid and density (finding 1)', () => {
  it('[0, 1e-306] with 5e-307 and h = MAX: 128 distinct values, area density 1e306, width 1', () => {
    const area = kde([5e-307], { clamp: [0, 1e-306], bandwidth: MAX });
    finiteAndIncreasing(area);
    expect([area.grid.length, area.grid[0], area.grid[127]]).toEqual([128, 0, 1e-306]);
    for (const v of area.density) expect(v / 1e306).toBeCloseTo(1, 9);
    for (const v of kde([5e-307], { clamp: [0, 1e-306], bandwidth: MAX, normalize: 'width' }).density) expect(v).toBeCloseTo(1, 12);
    // The default bandwidth of one value is far wider too.
    for (const v of kde([0], { clamp: [0, 1e-306] }).density) expect(v / 1e306).toBeCloseTo(1, 9);
  });

  it('two points eight ulps apart at 1 (and straddling 1) are the grid, with a flat density', () => {
    for (const [a, b] of [[1, 1 + 8 * u], [1 - 4 * (u / 2), 1 + 4 * u]] as const) {
      const r = kde([1], { clamp: [a, b], points: 2 });
      expect(Array.from(r.grid)).toEqual([a, b]);
      for (const v of r.density) expect(v * (b - a)).toBeCloseTo(1, 9);
      expect(Array.from(kde([1], { clamp: [a, b], points: 2, normalize: 'width' }).density)).toEqual([1, 1]);
    }
  });

  it('grids of one ulp a step, whose half steps round onto a grid value, are estimated (point value of the empty cell)', () => {
    // [1, 1 + u]: the first cell is [1, 1] (1 + u / 2 rounds to even). Cosine series (h = 0.9 far above u).
    const one = kde([1], { clamp: [1, 1 + u], points: 2 });
    expect(Array.from(one.grid)).toEqual([1, 1 + u]);
    for (const v of one.density) expect(v * u).toBeCloseTo(1, 9);
    // [1, 1 + 4u] at five points with h = u / 10: one mirror per bound (L = 40 h); the cell [1, 1] reads the point
    // value there, ~exp(-200) of the peak, and the peak is at the sample's grid value.
    const narrow = kde([1 + 2 * u], { clamp: [1, 1 + 4 * u], points: 5, bandwidth: u / 10, normalize: 'width' });
    expect(Array.from(narrow.grid)).toEqual([0, 1, 2, 3, 4].map(k => 1 + k * u));
    finiteAndIncreasing(narrow);
    expect(narrow.density[2]).toBe(1);
    expect(narrow.density[0]!).toBeLessThan(1e-80);
    // Subnormal supports: fractions come from b − a, exact there (their halves round onto each other).
    for (const b of [5e-324, 1e-323, 1e-320]) {
      expect(Array.from(kde([0], { clamp: [0, b], points: 2, normalize: 'width' }).density)).toEqual([1, 1]);
    }
  });

  it('peak normalization does not inherit the area limit; indistinct grids and unrepresentable areas are RangeErrors', () => {
    const width = kde([0], { clamp: [0, 1e-320], normalize: 'width' });
    finiteAndIncreasing(width);
    for (const v of width.density) expect(v).toBeCloseTo(1, 12);
    // Area density 1e320 is past Number.MAX_VALUE.
    expect(() => kde([0], { clamp: [0, 1e-320] })).toThrow(RangeError);
    // Three values in one ulp, 128 in 1e-15 (~4.5 ulps) at 1, two in the smallest subnormal step by area.
    expect(() => kde([1], { clamp: [1, 1 + u], points: 3 })).toThrow(RangeError);
    expect(() => kde([1], { clamp: [1, 1 + 1e-15] })).toThrow(RangeError);
    expect(() => kde([0], { clamp: [0, 5e-324], points: 2 })).toThrow(RangeError);
    expect(() => violinData([{ g: 'a', v: 1 }], { group: 'g', value: 'v', clamp: [1, 1 + u], points: 3 })).toThrow(RangeError);
  });

  it('keeps the open and extreme supports', () => {
    for (const clamp of [[-MAX, MAX], [0, Infinity], [-Infinity, 0]] as [number, number][]) {
      for (const normalize of ['area', 'width'] as const) finiteAndIncreasing(kde([-1, 0, 0, 2], { clamp, normalize }));
    }
    finiteAndIncreasing(kde([-MAX, MAX], { clamp: [-MAX, MAX], bandwidth: MAX }));
  });
});

describe('N9a repair 4: the compensated mean keeps small residuals (finding 2)', () => {
  it('[-MAX, 1e-307, MAX] has mean 1e-307 / 3; tiny values beside large ones are summed apart', () => {
    expect(kde([-MAX, 1e-307, MAX]).summary.mean / (1e-307 / 3)).toBeCloseTo(1, 14);
    expect(kde([MAX, -MAX, -1e-300, 4e-300]).summary.mean / (3e-300 / 4)).toBeCloseTo(1, 14);
    expect(kde([-1e16, 1, 1e16]).summary.mean).toBeCloseTo(1 / 3, 15);
    expect(kde([MAX, MAX]).summary.mean).toBe(MAX);
    expect(kde([1e-310, 3e-310]).summary.mean).toBe(2e-310);
    const { groups } = violinData([{ g: 'a', v: -MAX }, { g: 'a', v: 1e-307 }, { g: 'a', v: MAX }], { group: 'g', value: 'v' });
    expect(groups[0]!.kde.summary.mean / (1e-307 / 3)).toBeCloseTo(1, 14);
  });
});
