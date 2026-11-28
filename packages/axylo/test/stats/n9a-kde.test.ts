/**
 * N9a: Gaussian kernel density (`kde`, `violinData` of `axylo/stats`).
 *
 * Expected values come from the definition, not from the implementation:
 * - f(x) = 1/(n h) Σ φ((x − xᵢ)/h), φ the standard normal density; Silverman h = 0.9 · min(sd, IQR/1.34) · n^(-1/5)
 *   with the bw.nrd0 fallbacks (sd, then |x| of a constant sample, then 1), sd with n − 1, IQR from R-7 quartiles.
 * - The grid has `points` values from min − 3h to max + 3h (cut to `clamp`); grid value k stands for the cell of
 *   half steps around it, and its density is the mean of f over that cell, so the trapezoid rule over the grid
 *   is the mass on the grid. `'area'` divides by that mass (unit area), `'width'` by the largest value.
 * The reference cell means below integrate φ with Simpson's rule (independent of the library's CDF).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { kdeConvention, kde, quantile, violinData, type KdeResult } from '../../src/stats';

const MAX = Number.MAX_VALUE;
const phi = (z: number) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);

/** ∫ f over [u, v] by composite Simpson (512 panels). */
function simpson(f: (x: number) => number, u: number, v: number): number {
  const m = 512, step = (v - u) / m;
  let s = f(u) + f(v);
  for (let i = 1; i < m; i++) s += (i % 2 ? 4 : 2) * f(u + i * step);
  return (s * step) / 3;
}

/** Trapezoid rule straight from the returned grid (half steps, so a step across ±MAX_VALUE does not overflow). */
function trapezoid(r: KdeResult): number {
  let s = 0;
  for (let k = 1; k < r.grid.length; k++) s += (r.grid[k]! / 2 - r.grid[k - 1]! / 2) * (r.density[k - 1]! + r.density[k]!);
  return s;
}

function expectWellFormed(r: KdeResult) {
  expect(r.bandwidth > 0 && Number.isFinite(r.bandwidth)).toBe(true);
  for (let k = 0; k < r.grid.length; k++) {
    expect(Number.isFinite(r.grid[k]!)).toBe(true);
    expect(Number.isFinite(r.density[k]!)).toBe(true);
    expect(r.density[k]!).toBeGreaterThanOrEqual(0);
    if (k) expect(r.grid[k]!).toBeGreaterThan(r.grid[k - 1]!);
  }
}

describe('N9a kde: defaults and the bandwidth rule', () => {
  it('documents frozen defaults', () => {
    expect(kdeConvention()).toEqual({ kernel: 'gaussian', bandwidth: 'silverman', normalize: 'area', points: 128, cut: 3, quantile: 'R-7' });
    const r = kde([1, 2, 3, 4, 5]);
    expect(r.grid.length).toBe(128);
    expect(r.normalize).toBe('area');
  });

  it("uses Silverman's rule: 0.9 · min(sd, IQR/1.34) · n^(-1/5)", () => {
    // [1..5]: sd = √2.5 ≈ 1.581, R-7 Q1 = 2, Q3 = 4, IQR/1.34 ≈ 1.493 is the smaller.
    expect(kde([5, 1, 4, 2, 3]).bandwidth).toBeCloseTo(0.9 * (2 / 1.34) * 5 ** -0.2, 14);
    // [0, 0, 0, 10, 20, 30, 40, 1000]: Q1 = 0, Q3 = 32.5, sd ≈ 347 → IQR/1.34 wins.
    expect(kde([0, 0, 0, 10, 20, 30, 40, 1000]).bandwidth).toBeCloseTo(0.9 * (32.5 / 1.34) * 8 ** -0.2, 12);
    // Seven zeros and one 10: IQR = 0, so the scale falls back to sd = √12.5.
    expect(kde([0, 0, 0, 0, 0, 0, 0, 10]).bandwidth).toBeCloseTo(0.9 * Math.sqrt(12.5) * 8 ** -0.2, 12);
  });

  it('falls back to |x| for a constant sample and to 1 for zeros: never 0 or NaN', () => {
    expect(kde([5, 5, 5, 5]).bandwidth).toBeCloseTo(0.9 * 5 * 4 ** -0.2, 14);
    expect(kde([-3]).bandwidth).toBeCloseTo(0.9 * 3, 14);
    expect(kde([0, 0]).bandwidth).toBeCloseTo(0.9 * 2 ** -0.2, 14);
    expect(kde([5e-324]).bandwidth).toBe(5e-324);
    for (const sample of [[0], [7], [5e-324, 5e-324], [MAX, MAX], [-MAX, MAX], [1e-310, 2e-310]]) expectWellFormed(kde(sample));
  });

  it('uses an explicit bandwidth exactly and rejects invalid options', () => {
    expect(kde([1, 2, 3], { bandwidth: 0.25 }).bandwidth).toBe(0.25);
    for (const bandwidth of [0, -1, NaN, Infinity]) expect(() => kde([1], { bandwidth })).toThrow(RangeError);
    for (const points of [1, 2.5, 4097, NaN]) expect(() => kde([1], { points })).toThrow(RangeError);
    expect(() => kde([1], { normalize: 'peak' as never })).toThrow(RangeError);
    for (const clamp of [[1, 1], [2, 1], [NaN, 1], [Infinity, Infinity], [-Infinity, -Infinity], [1, 1 + 1e-15]] as [number, number][]) {
      expect(() => kde([1], { clamp })).toThrow(RangeError);
    }
    // The options are checked even when nothing can be estimated.
    expect(() => violinData([], { group: 'g' as never, value: 'v' as never, bandwidth: -1 })).toThrow(RangeError);
  });
});

describe('N9a kde: shape', () => {
  it('a single sample is the kernel itself: the cell means of φ over the grid, scaled to unit mass on ±3h', () => {
    const r = kde([0], { bandwidth: 1, points: 129 });
    expect(r.grid[0]).toBe(-3);
    expect(r.grid[128]).toBe(3);
    expect(r.grid[64]).toBeCloseTo(0, 15);
    const mass = simpson(phi, -3, 3);
    const step = 6 / 128;
    for (const k of [0, 10, 40, 63, 64, 65, 100, 128]) {
      const u = Math.max(-3, r.grid[k]! - step / 2), v = Math.min(3, r.grid[k]! + step / 2);
      expect(r.density[k]! / (simpson(phi, u, v) / (v - u) / mass)).toBeCloseTo(1, 6);
    }
    // Unimodal and symmetric about the sample.
    for (let k = 1; k <= 64; k++) expect(r.density[k]!).toBeGreaterThan(r.density[k - 1]!);
    for (let k = 0; k < 129; k++) expect(r.density[k]! / r.density[128 - k]!).toBeCloseTo(1, 9);
  });

  it('two samples: the mean of two kernels, bimodal when they are 4h apart', () => {
    const r = kde([-2, 2], { bandwidth: 1, points: 201 });
    const f = (x: number) => (phi(x + 2) + phi(x - 2)) / 2;
    const mass = simpson(f, -5, 5);
    const at = (x: number) => r.density[Math.round(((x + 5) / 10) * 200)]!;
    expect(at(0) / (f(0) / mass)).toBeCloseTo(1, 3);
    expect(at(2) / (f(2) / mass)).toBeCloseTo(1, 3);
    expect(at(2)).toBeGreaterThan(at(0));
    expect(at(-2)).toBeCloseTo(at(2), 9);
  });

  it('is translation and scale equivariant', () => {
    const base = kde([1, 2, 2.5, 4, 7]);
    const moved = kde([101, 102, 102.5, 104, 107]);
    const scaled = kde([10, 20, 25, 40, 70]);
    expect(moved.bandwidth).toBeCloseTo(base.bandwidth, 12);
    expect(scaled.bandwidth).toBeCloseTo(10 * base.bandwidth, 12);
    for (let k = 0; k < base.grid.length; k++) {
      expect(moved.grid[k]!).toBeCloseTo(base.grid[k]! + 100, 9);
      expect(moved.density[k]!).toBeCloseTo(base.density[k]!, 9);
      expect(scaled.grid[k]! / 10).toBeCloseTo(base.grid[k]!, 9);
      expect(scaled.density[k]! * 10).toBeCloseTo(base.density[k]!, 9);
    }
  });

  it("'width' has largest value 1 and the same shape as 'area'", () => {
    const area = kde([1, 2, 2, 3, 8]), width = kde([1, 2, 2, 3, 8], { normalize: 'width' });
    expect(width.normalize).toBe('width');
    expect(Math.max(...width.density)).toBe(1);
    const top = Math.max(...area.density);
    for (let k = 0; k < area.grid.length; k++) expect(width.density[k]!).toBeCloseTo(area.density[k]! / top, 12);
  });

  it('keeps all mass of a bandwidth far narrower than a grid step', () => {
    const r = kde([0, 10], { bandwidth: 1e-9 });
    expect(trapezoid(r)).toBeCloseTo(1, 9);
    // Each sample sits in an end cell, half a step wide: that cell holds half the mass.
    const half = (r.grid[1]! - r.grid[0]!) / 2;
    expect(r.density[0]! * half).toBeCloseTo(0.5, 9);
    expect(r.density[127]! * half).toBeCloseTo(0.5, 9);
    expect(r.density[64]!).toBe(0);
  });
});

describe('N9a kde: support', () => {
  it('reflects kernels at a finite bound: no grid below it, doubled density at it', () => {
    const r = kde([0], { bandwidth: 1, clamp: [0, Infinity], points: 301 });
    expect(r.grid[0]).toBe(0);
    expect(r.grid[300]).toBe(3);
    expect(trapezoid(r)).toBeCloseTo(1, 9);
    // f(x) = 2 φ(x) on [0, 3], scaled to unit mass there. The first cell is [0, step/2].
    const mass = simpson(x => 2 * phi(x), 0, 3), step = 3 / 300;
    expect(r.density[0]! / (simpson(x => 2 * phi(x), 0, step / 2) / (step / 2) / mass)).toBeCloseTo(1, 6);
    expect(r.density[0]! / (2 * phi(0))).toBeCloseTo(1, 2);
    // Reflection makes the boundary a maximum with zero slope.
    expect(r.density[0]!).toBeGreaterThan(r.density[1]!);
    expect(r.density[1]! / r.density[0]!).toBeGreaterThan(0.9999);
  });

  it('drops samples outside the clamp and summarizes the retained ones', () => {
    const r = kde([-1, 1, 2, 3, 12, NaN, null], { clamp: [0, 10] });
    expect(r.summary).toEqual({ n: 3, missing: 2, outside: 2, min: 1, q1: 1.5, median: 2, q3: 2.5, max: 3, mean: 2 });
    expect(r.bandwidth).toBeCloseTo(kde([1, 2, 3]).bandwidth, 14);
    expect(r.grid[0]).toBe(0);
    expect(r.grid[127]!).toBeLessThanOrEqual(10);
  });

  it('a wide kernel on a closed interval reflects into a uniform density', () => {
    const r = kde([0.5], { clamp: [0, 1], bandwidth: 1e300 });
    expect(r.grid[0]).toBe(0);
    expect(r.grid[127]).toBe(1);
    for (const d of r.density) expect(d).toBeCloseTo(1, 6);
  });

  it('empty input: empty grid and density, NaN summary and bandwidth unless given', () => {
    for (const values of [[], [NaN, null, undefined, Infinity], [20, 30]]) {
      const r = kde(values, { clamp: [0, 10] });
      expect(r.grid.length).toBe(0);
      expect(r.density.length).toBe(0);
      expect(r.bandwidth).toBeNaN();
      expect(r.summary.n).toBe(0);
      expect(r.summary.median).toBeNaN();
    }
    expect(kde([], { bandwidth: 2 }).bandwidth).toBe(2);
  });
});

describe('N9a kde: representability limits', () => {
  it('extreme finite samples: grid held inside ±MAX_VALUE, unit area', () => {
    const r = kde([-MAX, MAX]);
    expectWellFormed(r);
    expect(r.grid[0]).toBe(-MAX);
    expect(r.grid[127]).toBe(MAX);
    expect(trapezoid(r)).toBeCloseTo(1, 9);
    expect(r.summary.mean).toBe(0);
    const near = kde([0.9 * MAX, MAX]);
    expectWellFormed(near);
    expect(near.grid[127]).toBe(MAX);
  });

  it('subnormal and narrow-at-magnitude samples widen the grid, not the bandwidth', () => {
    for (const [values, bandwidth] of [[[5e-324, 1e-323], undefined], [[5e-324], undefined], [[1e300, 1e300], 1e-300], [[1, 1], 1e-200]] as const) {
      const r = kde(values, bandwidth === undefined ? {} : { bandwidth });
      expectWellFormed(r);
      if (bandwidth !== undefined) expect(r.bandwidth).toBe(bandwidth);
      // A widened grid's steps are 2^22 ulps, so the area is exact to their rounding (~1e-7), not to 1e-9.
      expect(Math.abs(trapezoid(r) - 1)).toBeLessThan(1e-6);
      expect(r.grid[0]!).toBeLessThanOrEqual(values[0]);
      expect(r.grid[127]!).toBeGreaterThanOrEqual(values[values.length - 1]!);
    }
  });
});

const finite = fc.double({ noNaN: true, noDefaultInfinity: true });
const sampleArb = fc.oneof(
  fc.array(finite, { minLength: 1, maxLength: 40 }),
  fc.array(fc.double({ min: -1e3, max: 1e3, noNaN: true }), { minLength: 1, maxLength: 80 }),
  fc.tuple(finite, fc.integer({ min: 1, max: 20 })).map(([v, n]) => Array.from({ length: n }, () => v)),
  fc.array(fc.constantFrom(0, 5e-324, -5e-324, 1e-310, MAX, -MAX), { minLength: 1, maxLength: 10 }),
);
const optionsArb = fc.record({
  normalize: fc.constantFrom('area' as const, 'width' as const),
  bandwidth: fc.option(fc.oneof(fc.double({ min: 1e-12, max: 1e6, noNaN: true }), fc.constantFrom(5e-324, 1e-300, 1e300, MAX)), { nil: undefined }),
  points: fc.option(fc.integer({ min: 2, max: 300 }), { nil: undefined }),
  clamp: fc.option(fc.constantFrom<[number, number]>([0, Infinity], [-Infinity, 0], [-1, 1], [0, 100], [-MAX, MAX]), { nil: undefined }),
}, { requiredKeys: [] });

describe('N9a kde: properties', () => {
  it('for any finite sample and options: finite non-negative density on a strictly increasing grid, unit area or unit peak', () => {
    fc.assert(fc.property(sampleArb, optionsArb, (values, options) => {
      const r = kde(values, options);
      const [a, b] = options.clamp ?? [-Infinity, Infinity];
      const kept = values.filter(v => v >= a && v <= b);
      expect(r.summary.n + r.summary.outside).toBe(values.length);
      if (!kept.length) { expect(r.grid.length).toBe(0); return; }
      expectWellFormed(r);
      expect(r.grid.length).toBe(options.points ?? 128);
      expect(r.grid[0]!).toBeGreaterThanOrEqual(a);
      expect(r.grid[r.grid.length - 1]!).toBeLessThanOrEqual(b);
      expect(r.grid[0]!).toBeLessThanOrEqual(Math.min(...kept));
      expect(r.grid[r.grid.length - 1]!).toBeGreaterThanOrEqual(Math.max(...kept));
      if (options.normalize === 'width') expect(Math.max(...r.density)).toBe(1);
      else expect(Math.abs(trapezoid(r) - 1)).toBeLessThan(0.02);
      expect(r.summary.median).toBe(quantile(kept, 0.5));
    }), { numRuns: 300 });
  });

  it('area normalization is exact to rounding, not just within 0.02', () => {
    fc.assert(fc.property(fc.array(fc.double({ min: -1e6, max: 1e6, noNaN: true }), { minLength: 1, maxLength: 60 }),
      fc.option(fc.double({ min: 1e-9, max: 1e9, noNaN: true }), { nil: undefined }), (values, bandwidth) => {
        expect(Math.abs(trapezoid(kde(values, { bandwidth })) - 1)).toBeLessThan(1e-9);
      }), { numRuns: 200 });
  });
});

describe('N9a violinData', () => {
  it('groups rows in first-seen order with one estimate and R-7 summary per group, as aligned typed columns', () => {
    const rows = [
      { g: 'B', v: 4 }, { g: 'A', v: 1 }, { g: 'B', v: 6 }, { g: 'A', v: 3 }, { g: 'A', v: null }, { g: null, v: 9 }, { g: 'C', v: NaN },
    ];
    const r = violinData(rows, { group: 'g', value: 'v' });
    const c = r.data.columns;
    expect(c.x).toEqual(['B', 'A', 'C']);
    expect([...c.n]).toEqual([2, 2, 0]);
    expect([...c.median]).toEqual([5, 2, NaN]);
    expect([...c.q1]).toEqual([4.5, 1.5, NaN]);
    expect(c.bandwidth[0]).toBeCloseTo(kde([4, 6]).bandwidth, 14);
    expect(c.bandwidth[2]).toBeNaN();
    expect(c.grid[2]!.length).toBe(0);
    expect(r.groups[1]!.kde.summary.missing).toBe(1);
    expect(r.groups[0]!.kde.density).toBe(c.density[0]);
    expect(r.normalize).toBe('area');
    expect(r.convention).toBe(kdeConvention());
  });

  it('reads columnar data and Date groups, and passes kde options to every group', () => {
    const d1 = new Date(Date.UTC(2026, 0, 1)), d2 = new Date(Date.UTC(2026, 0, 2));
    const r = violinData({ columns: { day: [d1, d2, new Date(d1.getTime())], ms: Float64Array.of(10, 20, 30) } },
      { group: 'day', value: 'ms', normalize: 'width', clamp: [0, Infinity], points: 16 });
    expect(r.groups.map(g => g.label)).toEqual([d1.toISOString(), d2.toISOString()]);
    expect([...r.data.columns.n]).toEqual([2, 1]);
    for (const g of r.groups) {
      expect(g.kde.grid.length).toBe(16);
      expect(Math.max(...g.kde.density)).toBe(1);
      expect(g.kde.grid[0]!).toBeGreaterThanOrEqual(0);
    }
  });
});
