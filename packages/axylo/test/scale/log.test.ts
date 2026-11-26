/**
 * C4.2 logarithmic scale numerical oracle, property tests, and tick/domain verification (RFC C4.1 §4).
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  isValidLogBase, isValidLogDomain, logScale, logTickCandidates, niceLogDomain,
} from '../../src/scale/log';
import { affineProjection, exactProjection } from '../../src/scene/geometry';

function nextUp(x: number): number {
  const buf = new ArrayBuffer(8);
  const f = new Float64Array(buf);
  const u = new BigUint64Array(buf);
  f[0] = x;
  u[0] = u[0]! + 1n;
  return f[0]!;
}

const plain = (v: number) => String(v);

describe('C4.2 logScale numerical oracle (RFC §4.1–4.2)', () => {
  it('disables affine fast-path projection (exactProjection & affineProjection return undefined)', () => {
    const s = logScale([1, 1000], [400, 0]);
    expect(s.type).toBe('log');
    expect(exactProjection(s)).toBeUndefined();
    expect(affineProjection(s)).toBeUndefined();
  });

  it('returns NaN safely for zero, negative, NaN, and non-finite inputs', () => {
    const s = logScale([1, 1000], [400, 0]);
    for (const bad of [0, -0, -1, -1e-300, NaN, Infinity, -Infinity]) {
      expect(Number.isNaN(s.map(bad))).toBe(true);
    }
    for (const badP of [NaN, Infinity, -Infinity]) {
      expect(Number.isNaN(s.invert(badP))).toBe(true);
    }
  });

  it('passes RFC required extreme, seam, and shifted-range regression fixtures', () => {
    const eps = Number.EPSILON;

    // 1. [1e299, 2e299], range [0, 100000]: p = 12345 round-trip AND 1.5e299 -> nextUp monotonicity (no branch seam)
    const s1 = logScale([1e299, 2e299], [0, 100000]);
    const L1 = Math.log(2e299) - Math.log(1e299);
    const M1 = Math.max(1, Math.abs(Math.log(1e299)), Math.abs(Math.log(2e299)));
    const pxTol1 = Math.max(1e-9, 8 * eps * (100000 / L1) * M1);
    expect(Math.abs(s1.map(s1.invert(12345)) - 12345)).toBeLessThanOrEqual(pxTol1);
    const seamA = 1.5e299;
    const seamB = nextUp(seamA);
    expect(s1.map(seamB)).toBeGreaterThanOrEqual(s1.map(seamA));

    // 2. [1e-300, 1e300] (600 decades): overflow-safe AND shifted narrow range [999999, 1000000] value round-trip at v = 2
    const s2 = logScale([1e-300, 1e300], [999999, 1000000]);
    const L2 = Math.log(1e300) - Math.log(1e-300);
    const M2 = Math.max(1, Math.abs(Math.log(1e-300)), Math.abs(Math.log(1e300)));
    const valTol2 = Math.max(1e-11, 8 * eps * (M2 + L2 * (1000000 / 1)));
    const v2 = 2;
    expect(Math.abs(s2.invert(s2.map(v2)) - v2) / v2).toBeLessThanOrEqual(valTol2);
    expect(s2.map(1e-300)).toBe(999999);
    expect(s2.map(1e300)).toBe(1000000);
    expect(s2.invert(999999)).toBe(1e-300);
    expect(s2.invert(1000000)).toBe(1e300);

    // 3. Narrow close===true domain [1, 1 + 1e-8] via log1p/expm1
    const s3 = logScale([1, 1 + 1e-8], [0, 1000]);
    const L3 = Math.log1p(1e-8);
    const pxTol3 = Math.max(1e-9, 8 * eps * (1000 / L3));
    const mid = 1 + 5e-9;
    expect(Math.abs(s3.invert(s3.map(mid)) - mid) / mid).toBeLessThanOrEqual(1e-11);
    expect(Math.abs(s3.map(s3.invert(500)) - 500)).toBeLessThanOrEqual(pxTol3);
  });

  it('satisfies round-trip and monotonicity properties across admitted log domains and CSS ranges (fast-check)', () => {
    const eps = Number.EPSILON;
    fc.assert(
      fc.property(
        fc.double({ min: -295, max: 295, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 1e-7, max: 300, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: -1e5, max: 1e5, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 1, max: 1e5, noNaN: true, noDefaultInfinity: true }),
        fc.boolean(),
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        (expLo, spanDec, rStart, rSpan, flipped, u1, u2) => {
          const expHi = Math.min(300, expLo + spanDec);
          const d0 = Math.pow(10, expLo);
          const d1 = Math.pow(10, expHi);
          if (!(d0 > 0 && d1 > d0 && Number.isFinite(d0) && Number.isFinite(d1))) return;
          const close = d1 - d0 <= 0.5 * d0;
          const L = close ? Math.log1p((d1 - d0) / d0) : Math.log(d1) - Math.log(d0);
          if (!(L >= 1e-9)) return;

          const r0 = flipped ? rStart + rSpan : rStart;
          const r1 = flipped ? rStart : rStart + rSpan;
          const R = Math.abs(r1 - r0);
          const Pmax = Math.max(Math.abs(r0), Math.abs(r1), 1);
          const Mln = Math.max(1, Math.abs(Math.log(d0)), Math.abs(Math.log(d1)));

          const s = logScale([d0, d1], [r0, r1]);
          const a = Math.min(u1, u2);
          const b = Math.max(u1, u2);
          const pA = r0 + a * (r1 - r0);
          const pB = r0 + b * (r1 - r0);
          const vA = s.invert(pA);
          const vB = s.invert(pB);

          // Monotonicity on vA <= vB
          const mA = s.map(vA);
          const mB = s.map(vB);
          if (r1 > r0) expect(mB).toBeGreaterThanOrEqual(mA);
          else expect(mB).toBeLessThanOrEqual(mA);

          // Pixel round-trip
          const pxTol = Math.max(1e-9, 8 * eps * (R / L) * Mln);
          expect(Math.abs(mA - pA)).toBeLessThanOrEqual(pxTol);

          // Value round-trip
          const valTol = Math.max(1e-11, 8 * eps * (Mln + L * (Pmax / R)));
          const vBack = s.invert(mA);
          expect(Math.abs(vBack - vA) / vA).toBeLessThanOrEqual(valTol);
        },
      ),
      { numRuns: 300, seed: 42042 },
    );
  });
});

describe('C4.2 niceLogDomain & logTickCandidates (RFC §4.3)', () => {
  it('validates log base (10 | 2 only) and strictly positive domains', () => {
    expect(isValidLogBase(10)).toBe(true);
    expect(isValidLogBase(2)).toBe(true);
    expect(isValidLogBase(Math.E)).toBe(false);
    expect(isValidLogBase(1)).toBe(false);
    expect(isValidLogBase(0)).toBe(false);
    expect(isValidLogDomain([1, 10])).toBe(true);
    expect(isValidLogDomain([0, 10])).toBe(false);
    expect(isValidLogDomain([-1, 10])).toBe(false);
    expect(isValidLogDomain([10, 10])).toBe(false);
    expect(isValidLogDomain([10, 1])).toBe(false);
  });

  it('handles singleton domains cleanly including near IEEE-754 bounds', () => {
    expect(niceLogDomain(100, 100, 10)).toEqual([10, 1000]);
    expect(niceLogDomain(8, 8, 2)).toEqual([4, 16]);
    const hi = niceLogDomain(1e300, 1e300, 10);
    expect(hi).toEqual([1e298, 1e300]);
    const lo = niceLogDomain(1e-300, 1e-300, 10);
    expect(lo).toEqual([1e-300, 1e-298]);
  });

  it('snaps sub-decade ranges strictly outward to nice 1-2-5 (base 10) and 1-1.5-2 (base 2) mantissas', () => {
    expect(niceLogDomain(12, 48, 10)).toEqual([10, 50]);
    expect(niceLogDomain(2.1, 4.9, 10)).toEqual([2, 5]);
    // Must never snap inward even within 1e-12 of a step boundary
    const strictlyOut = niceLogDomain(1.999999999999, 5.000000000001, 10);
    expect(strictlyOut[0]).toBeLessThanOrEqual(1.999999999999);
    expect(strictlyOut[1]).toBeGreaterThanOrEqual(5.000000000001);
    expect(niceLogDomain(4.2, 5.8, 2)).toEqual([4, 6]);
  });

  it('guarantees >= 2 distinct ticks on sub-decade, middle-span (base 10 & 2), [3, 40] endpoint fallback, and bounded <= 13 ticks across 600 decades', () => {
    // Sub-decade fallback even on ultra-narrow valid domain
    const narrow = logTickCandidates([100, 100.0001], plain, 10);
    expect(narrow.length).toBeGreaterThanOrEqual(1);
    expect(narrow[0]!.length).toBeGreaterThanOrEqual(2);

    // [3, 40] contains only 1 power of 10 (10), so coarsest candidate falls back to [3, 40] endpoints
    const singlePower = logTickCandidates([3, 40], plain, 10);
    expect(singlePower[singlePower.length - 1]!.map(t => t.value)).toEqual([3, 40]);

    // Middle span base 10: densest has 1, 2, 5 multiples; coarser has powers
    const mid10 = logTickCandidates([1, 100], plain, 10);
    expect(mid10[0]!.map(t => t.value)).toEqual([1, 2, 5, 10, 20, 50, 100]);
    expect(mid10[1]!.map(t => t.value)).toEqual([1, 10, 100]);

    // Middle span base 2: densest has 1, 1.5 multiples; coarser has powers of 2
    const mid2 = logTickCandidates([1, 4], plain, 2);
    expect(mid2[0]!.map(t => t.value)).toEqual([1, 1.5, 2, 3, 4]);
    expect(mid2[1]!.map(t => t.value)).toEqual([1, 2, 4]);

    // 600 decades: precomputed stride m0 = 50 -> bounded <= 13 ticks (never 601!)
    const wide = logTickCandidates([1e-300, 1e300], plain, 10);
    expect(wide.length).toBeGreaterThanOrEqual(1);
    for (const set of wide) {
      expect(set.length).toBeGreaterThanOrEqual(2);
      expect(set.length).toBeLessThanOrEqual(13);
    }
  });
});
