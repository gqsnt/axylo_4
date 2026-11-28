/**
 * N9a repair (review sol-6.2-medium__20261127T202902Z, findings 1–3): extreme-value moments and grid ends,
 * nearly flat and two-sided reflected kernels, frozen defaults and runtime option checks.
 *
 * Expected values are derived here, independently of the implementation:
 * - Silverman's h = 0.9 · min(sd, IQR / 1.34) · n^(-1/5) from hand-computed sd and IQR (R-7 quartiles).
 * - Reflected densities from a brute-force image sum: a kernel at x reflected in both bounds of [a, b] is
 *   Σ_k φ((y − x − 2kL) / h) + φ((y + x − 2a − 2kL) / h) (L = b − a), one image per side for a one-sided support.
 *   Each grid value is that function's mean over its cell (half steps around it, cut to the grid), by Simpson's
 *   rule; the column is then scaled to unit trapezoid area ('area') or to a largest value of 1 ('width').
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { kde, kdeConvention, violinData, type KdeOptions } from '../../src/stats';

const MAX = Number.MAX_VALUE;
const phi = (z: number) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
const trapezoid = (grid: ArrayLike<number>, f: ArrayLike<number>) => {
  let s = 0;
  for (let k = 1; k < grid.length; k++) s += ((grid[k]! - grid[k - 1]!) * (f[k]! + f[k - 1]!)) / 2;
  return s;
};

/** The reflected (unnormalized) estimate at y of samples xs on [a, b] (either side may be open). */
function reflected(xs: readonly number[], h: number, a: number, b: number): (y: number) => number {
  const L = b - a, two = Number.isFinite(a) && Number.isFinite(b);
  const K = two ? Math.ceil((10 * h) / L) + 2 : 0;
  return y => {
    let f = 0;
    for (const x of xs) {
      if (two) {
        for (let k = -K; k <= K; k++) f += phi((y - x - 2 * k * L) / h) + phi((y + x - 2 * a - 2 * k * L) / h);
      } else {
        f += phi((y - x) / h);
        if (Number.isFinite(a)) f += phi((y - (2 * a - x)) / h);
        if (Number.isFinite(b)) f += phi((y - (2 * b - x)) / h);
      }
    }
    return f;
  };
}

/** Cell means of f over the cells of an evenly spaced grid from lo to hi, then normalized as `mode` says. */
function expected(f: (y: number) => number, lo: number, hi: number, points: number, mode: 'area' | 'width', parts = 32): number[] {
  const step = (hi - lo) / (points - 1);
  const means: number[] = [];
  for (let k = 0; k < points; k++) {
    const u = Math.max(lo, lo + (k - 0.5) * step), v = Math.min(hi, lo + (k + 0.5) * step), w = (v - u) / parts;
    let s = 0;
    for (let j = 0; j < parts; j++) {
      const p = u + j * w;
      s += (w / 6) * (f(p) + 4 * f(p + w / 2) + f(p + w));
    }
    means.push(s / (v - u));
  }
  const grid = means.map((_, k) => lo + k * step);
  const scale = mode === 'width' ? Math.max(...means) : trapezoid(grid, means);
  return means.map(m => m / scale);
}

function expectShape(xs: number[], options: KdeOptions & { bandwidth: number }, lo: number, hi: number, tolerance = 1e-5) {
  const r = kde(xs, options);
  const a = options.clamp?.[0] ?? -Infinity, b = options.clamp?.[1] ?? Infinity;
  expect(r.grid[0]).toBeCloseTo(lo, 12);
  expect(r.grid.at(-1)).toBeCloseTo(hi, 12);
  const want = expected(reflected(xs, options.bandwidth, a, b), lo, hi, r.grid.length, r.normalize);
  const top = Math.max(...want);
  for (let k = 0; k < want.length; k++) expect(Math.abs(r.density[k]! - want[k]!) / top).toBeLessThan(tolerance);
  return r;
}

describe('N9a repair: overflow-safe moments and grid ends (finding 1)', () => {
  it('Silverman for two copies each of ±1.1e308: sd = 1.1e308 · √(4/3) is below IQR / 1.34 = 2.2e308 / 1.34', () => {
    const r = kde([-1.1e308, -1.1e308, 1.1e308, 1.1e308]);
    // Factors first, the magnitude last, so the expectation itself does not overflow.
    expect(r.bandwidth / ((0.9 * 1.1 * Math.sqrt(4 / 3) * 4 ** -0.2) * 1e308)).toBeCloseTo(1, 12);
    expect(r.summary.mean).toBe(0);
  });

  it('Silverman for two copies each of ±MAX_VALUE: sd and IQR both overflow alone, h = 0.9 · MAX · √(4/3) · 4^(-1/5) does not', () => {
    const r = kde([-MAX, -MAX, MAX, MAX]);
    const want = (0.9 * Math.sqrt(4 / 3) * 4 ** -0.2) * MAX;
    expect(Number.isFinite(want)).toBe(true);
    expect(r.bandwidth / want).toBeCloseTo(1, 12);
    expect([...r.density].every(Number.isFinite)).toBe(true);
    expect(trapezoid(r.grid, r.density)).toBeCloseTo(1, 9);
  });

  it('keeps the deviations of [1e16, 1e16, 1e16, 1e16 + 2]: sd is exactly 1', () => {
    // Mean 1e16 + 0.5, deviations −0.5 × 3 and 1.5: Σ d² = 3, sd = √(3 / 3) = 1. R-7 Q3 = 1e16 + 0.5 is not a
    // double and rounds to 1e16, so the reported IQR is 0 and the rule falls back to the sd: h = 0.9 · 1 · 4^(-1/5).
    const r = kde([1e16, 1e16, 1e16, 1e16 + 2]);
    expect(r.summary.q3 - r.summary.q1).toBe(0);
    expect(r.bandwidth).toBeCloseTo(0.9 * 4 ** -0.2, 12);
  });

  it('compensated mean: [-1e16, 1, 1e16] has mean 1/3; extreme and subnormal means stay exact', () => {
    expect(kde([-1e16, 1, 1e16]).summary.mean).toBe(1 / 3);
    expect(kde([MAX, MAX]).summary.mean).toBe(MAX);
    expect(kde([MAX, -MAX, MAX]).summary.mean / (MAX / 3)).toBeCloseTo(1, 14);
    expect(kde([5e-324, 5e-324]).summary.mean).toBe(5e-324);
    expect(violinData([{ g: 'a', v: -1e16 }, { g: 'a', v: 1 }, { g: 'a', v: 1e16 }], { group: 'g', value: 'v' }).data.columns.mean[0]).toBe(1 / 3);
  });

  it('grid ends without overflow: [1.5e308] with h = 6e307 starts at 1.5e308 − 1.8e308 = −3e307', () => {
    const r = kde([1.5e308], { bandwidth: 6e307 });
    expect(r.grid[0]! / -3e307).toBeCloseTo(1, 12);
    expect(r.grid.at(-1)).toBe(MAX);
    expect([...r.density].every(v => Number.isFinite(v) && v >= 0)).toBe(true);
    expect(trapezoid(r.grid, r.density)).toBeCloseTo(1, 9);
  });
});

describe('N9a repair: flat kernels, representable grids and two-sided reflection (finding 2)', () => {
  it('a kernel far wider than its clamp is flat: [5e-21] on [0, 1e-20] with h = MAX', () => {
    const area = kde([5e-21], { clamp: [0, 1e-20], bandwidth: MAX });
    for (const v of area.density) expect(v / 1e20).toBeCloseTo(1, 9);
    expect(trapezoid(area.grid, area.density)).toBeCloseTo(1, 12);
    const width = kde([5e-21], { clamp: [0, 1e-20], bandwidth: MAX, normalize: 'width' });
    for (const v of width.density) expect(v).toBeCloseTo(1, 12);
  });

  it('accepts a clamp a few units wide at 1e9 (2 / 127 a step is ~1.3e5 ulps) and rejects one that cannot hold the grid', () => {
    const r = kde([1e9], { clamp: [999999999, 1000000001] });
    expect(r.grid.length).toBe(128);
    expect(r.grid[0]).toBe(999999999);
    expect(r.grid.at(-1)).toBe(1000000001);
    for (let k = 1; k < 128; k++) expect(r.grid[k]!).toBeGreaterThan(r.grid[k - 1]!);
    expect(trapezoid(r.grid, r.density)).toBeCloseTo(1, 12);
    expect(kde([1], { clamp: [1, 1 + 2 ** -30] }).grid.length).toBe(128);
    // Round 4 (review sol-6.2-medium__20261127T211253Z, finding 1) checks a clamp on its own grid and density:
    // 128 values in 2^-44 at 1 (~2 ulps a step) are distinct and [0, 1e-306] has area density 1e306, so both are
    // estimated now (n9a-kde-repair4.test.ts); a grid that cannot be distinct is still reported, not guessed.
    expect(kde([1], { clamp: [1, 1 + 2 ** -44] }).grid.length).toBe(128);
    expect(() => kde([1], { clamp: [1, 1 + 2 ** -52], points: 3 })).toThrow(RangeError);
  });

  it('[0] with h = 1 on [0, 1]: fully reflected, nearly uniform (ends ≈ 1.0144 and 0.9856), not one mirror per side', () => {
    const r = expectShape([0], { bandwidth: 1, clamp: [0, 1] }, 0, 1);
    // Point values of 1 + 2 Σ exp(−(mπ)² / 2) cos(mπy) at y = 0 and 1 (series form of the same image sum).
    const series = (y: number) => 1 + 2 * [1, 2, 3].reduce((s, m) => s + Math.exp(-((m * Math.PI) ** 2) / 2) * Math.cos(m * Math.PI * y), 0);
    expect(r.density[0]).toBeCloseTo(series(0), 3);
    expect(r.density.at(-1)).toBeCloseTo(series(1), 3);
    expect(r.density.at(-1)! / r.density[0]!).toBeGreaterThan(0.97);
  });

  it('two-sided shapes across the bandwidth-to-span ratios, in both normalizations', () => {
    // L / h = 4 (the series' range), 10, 16.7 (one mirror per side), each also as a width-normalized shape.
    for (const normalize of ['area', 'width'] as const) {
      expectShape([0.1, 0.7], { bandwidth: 0.25, clamp: [0, 1], normalize }, 0, 1);
      expectShape([0.05, 0.3, 0.9], { bandwidth: 0.1, clamp: [0, 1], normalize }, 0, 1);
      expectShape([0.05, 0.9], { bandwidth: 0.06, clamp: [0, 1], normalize }, 0, 1);
      expectShape([0.5], { bandwidth: 3, clamp: [0, 1], normalize }, 0, 1);
    }
  });

  it('one-sided reflection, in both normalizations', () => {
    for (const normalize of ['area', 'width'] as const) {
      // Grid: from the bound to max + 3h.
      expectShape([0.2, 1], { bandwidth: 0.5, clamp: [0, Infinity], normalize }, 0, 2.5);
      expectShape([-0.2], { bandwidth: 0.4, clamp: [-Infinity, 0], normalize }, -1.4, 0);
    }
  });

  it('the same shapes at tiny and huge scales (the estimate is scale invariant)', () => {
    // 1e-250 is above the documented 2^-960-a-step floor (1e-300 is not: rejected above).
    for (const s of [1e-20, 1e-250, 1e300]) {
      const unit = kde([0.2, 0.8], { bandwidth: 0.3, clamp: [0, 1] });
      const scaled = kde([0.2 * s, 0.8 * s], { bandwidth: 0.3 * s, clamp: [0, s] });
      const width = kde([0.2 * s, 0.8 * s], { bandwidth: 0.3 * s, clamp: [0, s], normalize: 'width' });
      const top = Math.max(...unit.density);
      for (let k = 0; k < 128; k++) {
        expect(Math.abs(scaled.density[k]! * s - unit.density[k]!) / top).toBeLessThan(1e-9);
        expect(Math.abs(width.density[k]! - unit.density[k]! / top)).toBeLessThan(1e-9);
      }
      expect(trapezoid(scaled.grid, scaled.density)).toBeCloseTo(1, 9);
    }
  });

  it('property: two-sided estimates on [0, 1] match the brute-force image sum for any samples and bandwidth', () => {
    fc.assert(fc.property(
      fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 4 }),
      fc.double({ min: 0.02, max: 4, noNaN: true }),
      (xs, h) => {
        const r = kde(xs, { bandwidth: h, clamp: [0, 1], points: 48 });
        const lo = Math.max(0, Math.min(...xs) - 3 * h), hi = Math.min(1, Math.max(...xs) + 3 * h);
        const want = expected(reflected(xs, h, 0, 1), lo, hi, 48, 'area', 16);
        const top = Math.max(...want);
        for (let k = 0; k < 48; k++) if (Math.abs(r.density[k]! - want[k]!) / top > 1e-5) return false;
        return Math.abs(trapezoid(r.grid, r.density) - 1) < 1e-9;
      },
    ), { numRuns: 40, seed: 9 });
  });
});

describe('N9a repair: frozen defaults and runtime checks (finding 3)', () => {
  it('the convention is frozen, one object, and the estimates never read it', () => {
    const c = kdeConvention();
    expect(Object.isFrozen(c)).toBe(true);
    expect(kdeConvention()).toBe(c);
    expect(c).toEqual({ kernel: 'gaussian', bandwidth: 'silverman', normalize: 'area', points: 128, cut: 3, quantile: 'R-7' });
    expect(() => { (c as { points: number }).points = 5; }).toThrow(TypeError);
    expect(kde([1, 2, 3]).grid.length).toBe(128);
    expect(kde([1, 2, 3]).normalize).toBe('area');
    expect(violinData([{ g: 'a', v: 1 }], { group: 'g', value: 'v' }).convention).toBe(c);
  });

  it('explicit undefined options take the defaults', () => {
    const plain = kde([1, 2, 4]);
    const given = kde([1, 2, 4], { bandwidth: undefined, normalize: undefined, clamp: undefined, points: undefined });
    expect(given.bandwidth).toBe(plain.bandwidth);
    expect([...given.density]).toEqual([...plain.density]);
  });

  it('rejects malformed options at run time with RangeError', () => {
    const bad: unknown[] = [
      { bandwidth: '1' }, { bandwidth: true }, { bandwidth: 0 }, { bandwidth: -1 }, { bandwidth: NaN }, { bandwidth: Infinity },
      { clamp: '0,1' }, { clamp: [0, 1, 2] }, { clamp: [0] }, { clamp: [0, '1'] }, { clamp: ['0', 1] }, { clamp: [1, 0] },
      { clamp: [NaN, 1] }, { clamp: [Infinity, Infinity] }, { clamp: { 0: 0, 1: 1, length: 2 } },
      { points: 2.5 }, { points: '128' }, { points: 1 }, { normalize: 'peak' }, null, 5, 'area',
    ];
    for (const options of bad) {
      expect(() => kde([1, 2], options as KdeOptions), JSON.stringify(options)).toThrow(RangeError);
      if (options !== null && typeof options === 'object') {
        expect(() => violinData([{ g: 'a', v: 1 }], { group: 'g', value: 'v', ...options } as never), JSON.stringify(options)).toThrow(RangeError);
      }
    }
    // Open infinities are documented for a one-sided clamp.
    expect(kde([1], { clamp: [-Infinity, 2] }).grid.at(-1)).toBe(2);
    expect(kde([1], { clamp: [0, Infinity] }).grid[0]).toBe(0);
  });

  it('empty semantics stay explicit: empty grid, n 0, NaN summary and a NaN bandwidth unless given', () => {
    const empty = kde([]);
    expect(empty.grid.length).toBe(0);
    expect(empty.density.length).toBe(0);
    expect(empty.summary.n).toBe(0);
    expect(empty.summary.mean).toBeNaN();
    expect(empty.summary.min).toBeNaN();
    expect(empty.bandwidth).toBeNaN();
    expect(kde([], { bandwidth: 2 }).bandwidth).toBe(2);
    expect(kde([NaN, null, undefined]).summary.missing).toBe(3);
    const outside = kde([5], { clamp: [0, 1] });
    expect([outside.summary.n, outside.summary.outside, outside.grid.length]).toEqual([0, 1, 0]);
  });
});
