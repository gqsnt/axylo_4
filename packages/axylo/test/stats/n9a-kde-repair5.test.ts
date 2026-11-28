/**
 * N9a repair round 5: a clamp a few ulps wide with a bandwidth of Number.MIN_VALUE. Half steps round onto grid
 * values there, so some cells have no width; their point density would be half / h ≈ 2^1022 times the rest and
 * overflow before the normalization (spec: the density is finite, ≥ 0, unit trapezoid area or peak 1).
 */
import { describe, expect, it } from 'vitest';
import { kde } from '../../src/stats';
import { densityOnGrid } from '../../src/stats/kde';

const EPS = Number.EPSILON;
// Trapezoid area as a sum of half-step × mean pairs, each finite at these magnitudes.
const area = (g: Float64Array, d: Float64Array) => {
  let s = 0;
  for (let k = 1; k < g.length; k++) s += (g[k]! - g[k - 1]!) * (d[k]! / 2 + d[k - 1]! / 2);
  return s;
};

describe('N9a repair 5: collapsed cells on a skinny clamp', () => {
  it('densityOnGrid on [16] over [16, 16 + 16ε] with h = MIN_VALUE is finite in both modes', () => {
    const s = Float64Array.of(16), b = 16 + 16 * EPS;
    const [g, peak] = densityOnGrid(s, Number.MIN_VALUE, 16, b, 16, b, 2, true);
    expect(Array.from(g)).toEqual([16, b]);
    expect(Math.max(...peak)).toBe(1);
    for (const v of peak) expect(v >= 0 && v <= 1).toBe(true);
    const [g2, unit] = densityOnGrid(s, Number.MIN_VALUE, 16, b, 16, b, 2, false);
    for (const v of unit) expect(Number.isFinite(v) && v >= 0).toBe(true);
    expect(Math.abs(area(g2, unit) - 1)).toBeLessThan(0.02);
  });

  for (const ulps of [1, 2, 3, 5, 8]) for (const points of new Set([2, ulps + 1])) {
    it(`public kde over a clamp of ${ulps} ulps at 16, ${points} points: width peak 1, area 1`, () => {
      const clamp: [number, number] = [16, 16 + ulps * 16 * EPS];
      // One grid value per ulp at most, so the grid is strictly increasing and accepted.
      const r = kde([16], { clamp, bandwidth: Number.MIN_VALUE, points, normalize: 'width' });
      expect(Math.max(...r.density)).toBe(1);
      for (const v of r.density) expect(v >= 0 && v <= 1).toBe(true);
      const a = kde([16], { clamp, bandwidth: Number.MIN_VALUE, points, normalize: 'area' });
      for (const v of a.density) expect(Number.isFinite(v) && v >= 0).toBe(true);
      expect(Math.abs(area(a.grid, a.density) - 1)).toBeLessThan(0.02);
    });
  }
});
