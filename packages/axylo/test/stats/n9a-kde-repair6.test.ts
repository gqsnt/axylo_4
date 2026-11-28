/**
 * N9a repair round 6: a clamp holding exactly `points` consecutive doubles gets them as its grid, and the small-value
 * bucket of the mean is compensated (spec: summary mean is exact; the grid is strictly increasing on the clamp).
 */
import { describe, expect, it } from 'vitest';
import { kde } from '../../src/stats';
import { densityOnGrid } from '../../src/stats/kde';

const MAX = Number.MAX_VALUE, EPS = Number.EPSILON;

describe('N9a repair 6', () => {
  it('clamp [1.25, 1.25 + 3ε] with 4 points is the four consecutive doubles', () => {
    // 1.25 is in [1, 2), where one ulp is ε, so the four values below are consecutive and exact.
    const r = kde([1.25], { clamp: [1.25, 1.25 + 3 * EPS], points: 4, bandwidth: 1, normalize: 'width' });
    expect(Array.from(r.grid)).toEqual([1.25, 1.25 + EPS, 1.25 + 2 * EPS, 1.25 + 3 * EPS]);
    for (const v of r.density) expect(Number.isFinite(v) && v >= 0 && v <= 1).toBe(true);
    expect(Math.max(...r.density)).toBe(1);
  });

  it('a grid spanning ±MAX (span not finite) keeps exact ends and a finite midpoint', () => {
    const [g] = densityOnGrid(Float64Array.of(0), 1e300, -MAX, MAX, -MAX, MAX, 5, true);
    expect([g[0], g[2], g[4]]).toEqual([-MAX, 0, MAX]);
  });

  it('mean of [-MAX, -1e-275, 1e-307, 1e-275, MAX] is 1e-307 / 5', () => {
    // Both symmetric pairs cancel exactly; the residual 1e-307 / 5 is representable.
    expect(kde([-MAX, -1e-275, 1e-307, 1e-275, MAX]).summary.mean).toBe(1e-307 / 5);
  });
});
