/**
 * N9a support repair (round 3): finite clamps whose width overflows (opposite-sign bounds near ±MAX_VALUE) and
 * tight clamps that are representable but were rejected.
 *
 * Expected values are derived here, independently of the implementation:
 * - The estimate is scale and shift invariant, so a clamp [A + s·α, A + s·β] with bandwidth s·h has the shape of
 *   [α, β] with bandwidth h. The returned grid is mapped to those unit coordinates (exactly where the mapping is a
 *   power of two), and the reference is the brute-force reflected image sum
 *   Σ_k φ((y − x − 2kL) / h) + φ((y + x − 2α − 2kL) / h), L = β − α, averaged by Simpson's rule over the cells of the
 *   returned grid (half steps around each value, cut to the grid), then scaled to unit trapezoid area or a peak of 1.
 *   Using the returned grid's own cells keeps the reference exact even where rounding makes a tight grid uneven.
 * - A clamp is accepted when its steps are at least 2^-48 of its magnitude (the ulp is at most m · 2^-52, and each
 *   grid value carries at most 3 · m · 2^-53 of rounding, so neighbours stay >= 13 ulps apart) and at least 2^-1022
 *   (the area density is at most 2 / step, below Number.MAX_VALUE); below either it is a RangeError.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { kde, type KdeResult } from '../../src/stats';

const MAX = Number.MAX_VALUE;
const phi = (z: number) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);

/** Trapezoid area from half-differences, so steps across ±MAX_VALUE and densities near it do not overflow. */
function trapezoid(grid: ArrayLike<number>, f: ArrayLike<number>): number {
  let s = 0;
  for (let k = 1; k < grid.length; k++) s += (grid[k]! / 2 - grid[k - 1]! / 2) * (f[k]! + f[k - 1]!);
  return s;
}

function imageSum(xs: readonly number[], h: number, a: number, b: number): (y: number) => number {
  const L = b - a, K = Math.ceil((10 * h) / L) + 2;
  return y => {
    let f = 0;
    for (const x of xs) for (let k = -K; k <= K; k++) f += phi((y - x - 2 * k * L) / h) + phi((y + x - 2 * a - 2 * k * L) / h);
    return f;
  };
}

/**
 * Reference cell means of f over the cells of `grid`, in unit coordinates (`toUnit`), normalized as `mode` says.
 * A cell's ends are the midpoints of neighbouring grid values as stored doubles (g / 2 + g' / 2, the representable
 * half step): on a tight grid the exact midpoint is not a double, and half an ulp there is 2^-13 of [1, 1 + 2^-40].
 */
function reference(f: (y: number) => number, grid: ArrayLike<number>, toUnit: (g: number) => number, mode: 'area' | 'width'): number[] {
  const last = grid.length - 1, parts = 32, ys = Array.from(grid, toUnit);
  const mid = (k: number, j: number) => toUnit(grid[k]! / 2 + grid[j]! / 2);
  const means = ys.map((_, k) => {
    const u = mid(Math.max(k - 1, 0), k), v = mid(k, Math.min(k + 1, last)), w = (v - u) / parts;
    let s = 0;
    for (let j = 0; j < parts; j++) s += (w / 6) * (f(u + j * w) + 4 * f(u + j * w + w / 2) + f(u + j * w + w));
    return s / (v - u);
  });
  const scale = mode === 'width' ? Math.max(...means) : trapezoid(ys, means);
  return means.map(m => m / scale);
}

/** The returned density against the reference on the returned grid, both in unit coordinates (`toUnit`). */
function expectReference(r: KdeResult, toUnit: (g: number) => number, xs: number[], h: number, a: number, b: number, tolerance = 1e-5) {
  const ys = Array.from(r.grid, toUnit);
  const want = reference(imageSum(xs, h, a, b), r.grid, toUnit, r.normalize);
  // Unit coordinates per data unit, over the whole grid (one step of a tight grid is uneven by its rounding).
  const last = ys.length - 1, unitArea = (ys[last]! - ys[0]!) / (r.grid[last]! / 2 - r.grid[0]! / 2) / 2;
  const top = Math.max(...want);
  for (let k = 0; k < want.length; k++) {
    // An area density in data units is the unit density divided by the scale (unitArea = 1 / scale).
    const got = r.normalize === 'area' ? r.density[k]! / unitArea : r.density[k]!;
    expect(Math.abs(got - want[k]!) / top, `k = ${k}`).toBeLessThan(tolerance);
  }
}

function expectWellFormed(r: KdeResult, points = 128) {
  expect(r.grid.length).toBe(points);
  for (let k = 0; k < points; k++) {
    expect(Number.isFinite(r.density[k]!) && r.density[k]! >= 0).toBe(true);
    if (k) expect(r.grid[k]!).toBeGreaterThan(r.grid[k - 1]!);
  }
  if (r.normalize === 'width') expect(Math.max(...r.density)).toBe(1);
  else expect(Math.abs(trapezoid(r.grid, r.density) - 1)).toBeLessThan(1e-9);
}

describe('N9a support repair: a clamp width that overflows (finite opposite-sign bounds near ±MAX_VALUE)', () => {
  it('kde([-MAX], h = MAX, clamp [-MAX, MAX]) has the shape of kde([-1], h = 1, clamp [-1, 1]): L / h = 2, all images', () => {
    for (const normalize of ['width', 'area'] as const) {
      const unit = kde([-1], { bandwidth: 1, clamp: [-1, 1], normalize });
      const huge = kde([-MAX], { bandwidth: MAX, clamp: [-MAX, MAX], normalize });
      expectWellFormed(unit);
      expectWellFormed(huge);
      expect([huge.grid[0], huge.grid[127]]).toEqual([-MAX, MAX]);
      // The ordinary case against the independent image sum, then the huge one against both.
      expectReference(unit, g => g, [-1], 1, -1, 1);
      expectReference(huge, g => g / MAX, [-1], 1, -1, 1);
      const top = Math.max(...unit.density);
      for (let k = 0; k < 128; k++) {
        const scaled = normalize === 'area' ? huge.density[k]! * MAX : huge.density[k]!;
        expect(Math.abs(scaled - unit.density[k]!) / top).toBeLessThan(1e-9);
      }
    }
    // Fully reflected, the density at the far bound is well above a single mirror's: the image sum's own value there.
    const ends = reference(imageSum([-1], 1, -1, 1), [-1, 1], g => g, 'width');
    expect(kde([-MAX], { bandwidth: MAX, clamp: [-MAX, MAX], normalize: 'width', points: 2 }).density[1]).toBeCloseTo(ends[1]!, 6);
  });

  it('an asymmetric pair and the default bandwidth at the extremes keep both normalizations', () => {
    for (const normalize of ['width', 'area'] as const) {
      const huge = kde([MAX / 4], { bandwidth: MAX / 2, clamp: [-MAX, MAX / 2], normalize });
      expectWellFormed(huge);
      expectReference(huge, g => g / MAX, [0.25], 0.5, -1, 0.5);
      // Default (Silverman) bandwidth: whatever h the rule gives, the shape is the unit shape with h / MAX.
      const rule = kde([-MAX, MAX / 2, MAX], { clamp: [-MAX, MAX], normalize });
      expectWellFormed(rule);
      expect(Number.isFinite(rule.bandwidth) && rule.bandwidth > 0).toBe(true);
      expectReference(rule, g => g / MAX, [-1, 0.5, 1], rule.bandwidth / MAX, -1, 1);
    }
  });
});

describe('N9a support repair: tight clamps that hold a distinct grid are estimated', () => {
  const e = 2 ** -40;

  it('[1, 1 + 2^-40]: 128 distinct values, the shape of [0, 1], finite area density', () => {
    for (const normalize of ['width', 'area'] as const) {
      const r = kde([1 + 0.25 * e, 1 + 0.5 * e], { bandwidth: 0.2 * e, clamp: [1, 1 + e], normalize });
      expectWellFormed(r);
      expect([r.grid[0], r.grid[127]]).toEqual([1, 1 + e]);
      // (g − 1) · 2^40 is exact: g − 1 by Sterbenz, the product by a power of two.
      expectReference(r, g => (g - 1) / e, [0.25, 0.5], 0.2, 0, 1);
      // One mirror per bound (L / h = 50) on the same clamp.
      // 1 + 0.1 · 2^-40 rounds to the nearest ulp (2^-12 of the clamp), so the reference uses the stored value.
      const x = 1 + 0.1 * e, narrow = kde([x], { bandwidth: 0.02 * e, clamp: [1, 1 + e], normalize });
      expectWellFormed(narrow);
      expectReference(narrow, g => (g - 1) / e, [(x - 1) / e], 0.02, 0, 1);
    }
    // The default bandwidth of one value there is far wider than the clamp: a uniform density of 2^40.
    for (const v of kde([1], { clamp: [1, 1 + e] }).density) expect(v / 2 ** 40).toBeCloseTo(1, 9);
  });

  it('[0, 1e-300] (area density 1e300) and the smallest accepted step 2^-1022 are finite', () => {
    for (const v of kde([0], { clamp: [0, 1e-300] }).density) expect(v / 1e300).toBeCloseTo(1, 9);
    const least = 127 * 2 ** -1022;
    const r = kde([least / 3], { bandwidth: least / 4, clamp: [0, least] });
    expectWellFormed(r);
    expectReference(r, g => g / least, [1 / 3], 1 / 4, 0, 1);
  });

  it('requests that cannot be made distinct or finite are still RangeErrors', () => {
    // 4096 values in 2^-40 at 1 are 2^12 / 4095 ulps apart (> 1), so the grid is distinct and estimated.
    const tight = kde([1], { clamp: [1, 1 + e], points: 4096 });
    expect(tight.grid.length).toBe(4096);
    for (const v of tight.density) expect(Number.isFinite(v) && v >= 0).toBe(true);
    for (let k = 1; k < tight.grid.length; k++) expect(tight.grid[k]!).toBeGreaterThan(tight.grid[k - 1]!);
    // 4096 values in 2^-50 at 1 span only 4 ulps: genuinely indistinct.
    expect(() => kde([1], { clamp: [1, 1 + 2 ** -50], points: 4096 })).toThrow(RangeError);
    // Round 4 (review sol-6.2-medium__20261127T211253Z, finding 1): 128 values in 2^-44 at ±1 (~2 ulps a step) are
    // distinct and [0, 1e-306] (area density 1e306) is finite, so they are estimated (n9a-kde-repair4.test.ts).
    for (const clamp of [[1, 1 + 2 ** -44], [-1 - 2 ** -44, -1]] as [number, number][]) expectWellFormed(kde([clamp[0]], { clamp }));
    // An area density past Number.MAX_VALUE; two values in the smallest subnormal step.
    expect(() => kde([0], { clamp: [0, 1e-320] })).toThrow(RangeError);
    expect(() => kde([0], { clamp: [0, 5e-324] })).toThrow(RangeError);
  });

  it('property: at twice the acceptance limit, any magnitude and point count gives a distinct grid and both invariants', () => {
    fc.assert(fc.property(
      fc.integer({ min: -1000, max: 1000 }), fc.double({ min: 1, max: 2, noNaN: true }), fc.boolean(),
      fc.integer({ min: 2, max: 4096 }), fc.double({ min: 0.001, max: 100, noNaN: true }), fc.constantFrom('area' as const, 'width' as const),
      (exponent, mantissa, negative, points, relative, normalize) => {
        const a = (negative ? -1 : 1) * mantissa * 2 ** exponent;
        const b = a + 2 * Math.max(Math.abs(a) * 2 ** -48, 2 ** -1022) * (points - 1);
        const r = kde([a, b / 2 + a / 2, b], { clamp: [a, b], points, normalize, bandwidth: relative * (b - a) });
        expectWellFormed(r, points);
      },
    ), { numRuns: 200, seed: 3 });
  });
});
