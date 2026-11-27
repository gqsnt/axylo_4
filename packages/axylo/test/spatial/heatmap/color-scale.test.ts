/**
 * The quantized color scales (src/spatial/color-scale.ts). Expected values come from the definitions: a bin is
 * floor(t × bins) of the normalized position, clamped to the ends; a diverging bin depends on the side of the
 * midpoint and the distance from it only; the default colors are the anchors interpolated in OKLab.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  binColor, colorAt, defaultBinOklab, divergingBin, hexToOklab, makeDomain, binOf, sequentialBin, validBins,
  DIVERGING_ANCHORS, SEQUENTIAL_ANCHORS,
} from '../../../src/spatial/color-scale';

const finite = fc.double({ noNaN: true, noDefaultInfinity: true });
const binsArb = fc.integer({ min: 2, max: 64 });

describe('sequential bins', () => {
  it('are monotonic in the value and always a valid bin, for any finite domain, including the whole double range', () => {
    fc.assert(fc.property(finite, finite, finite, finite, binsArb, (a, b, u, v, bins) => {
      const lo = Math.min(a, b), hi = Math.max(a, b);
      fc.pre(lo < hi);
      const x = Math.min(u, v), y = Math.max(u, v);
      const bx = sequentialBin(x, lo, hi, bins), by = sequentialBin(y, lo, hi, bins);
      expect(Number.isInteger(bx) && bx >= 0 && bx < bins).toBe(true);
      expect(bx).toBeLessThanOrEqual(by);
    }));
  });

  it('put the domain ends in the end bins and clamp values outside', () => {
    expect(sequentialBin(0, 0, 100, 32)).toBe(0);
    expect(sequentialBin(100, 0, 100, 32)).toBe(31);
    expect(sequentialBin(-5, 0, 100, 32)).toBe(0);
    expect(sequentialBin(1e9, 0, 100, 32)).toBe(31);
    // t = 0.5 exactly: floor(0.5 × 32) = 16.
    expect(sequentialBin(50, 0, 100, 32)).toBe(16);
    // No overflow for the widest domain: -MAX to MAX, the midpoint 0 is t = 0.5.
    expect(sequentialBin(0, -Number.MAX_VALUE, Number.MAX_VALUE, 32)).toBe(16);
    expect(sequentialBin(Number.MAX_VALUE, -Number.MAX_VALUE, Number.MAX_VALUE, 32)).toBe(31);
    expect(sequentialBin(-Number.MAX_VALUE, -Number.MAX_VALUE, Number.MAX_VALUE, 32)).toBe(0);
  });

  it('give every value the middle bin on a degenerate domain', () => {
    expect(sequentialBin(5, 5, 5, 32)).toBe(16);
    expect(sequentialBin(5, 5, 5, 7)).toBe(3);
  });

  it('split [0, bins) into equal bins: value k lands in bin k', () => {
    fc.assert(fc.property(binsArb, bins => {
      for (let k = 0; k < bins; k++) expect(sequentialBin(k + 0.5, 0, bins, bins)).toBe(k);
    }));
  });
});

describe('diverging bins', () => {
  it('are mirror images about the midpoint: v and 2·mid − v land in bins b and bins − 1 − b (even bins)', () => {
    // Integers in the safe range: mid ± e is exact, so |v − mid| is the same on both sides.
    const int = fc.integer({ min: -1e12, max: 1e12 });
    // e ≥ 1: the midpoint itself is its own mirror; with an even count it takes the upper centre bin (below).
    fc.assert(fc.property(int, fc.integer({ min: 1, max: 1e12 }), fc.integer({ min: 1, max: 1e12 }), fc.integer({ min: 1, max: 32 }), (mid, e, radius, half) => {
      const bins = half * 2;
      expect(divergingBin(mid, mid, radius, bins)).toBe(bins / 2);
      const above = divergingBin(mid + e, mid, radius, bins), below = divergingBin(mid - e, mid, radius, bins);
      expect(above).toBe(bins - 1 - below);
      expect(above).toBeGreaterThanOrEqual(bins / 2);
    }));
  });

  it('with an odd count keep the midpoint in the centre bin and stay symmetric', () => {
    fc.assert(fc.property(fc.integer({ min: -1e9, max: 1e9 }), fc.integer({ min: 1, max: 1e9 }), fc.integer({ min: 1, max: 1e9 }), fc.integer({ min: 1, max: 31 }), (mid, e, radius, arm) => {
      const bins = arm * 2 + 1;
      expect(divergingBin(mid, mid, radius, bins)).toBe(arm);
      expect(divergingBin(mid + e, mid, radius, bins)).toBe(bins - 1 - divergingBin(mid - e, mid, radius, bins));
    }));
  });

  it('are monotonic in the value', () => {
    fc.assert(fc.property(finite, finite, finite, fc.double({ min: 1e-300, max: 1e300, noNaN: true }), binsArb, (mid, u, v, radius, bins) => {
      const x = Math.min(u, v), y = Math.max(u, v);
      expect(divergingBin(x, mid, radius, bins)).toBeLessThanOrEqual(divergingBin(y, mid, radius, bins));
    }));
  });

  it('make a symmetric domain about the midpoint from asymmetric data', () => {
    const d = makeDomain('diverging', -2, 10, 0, 32);
    expect([d.lo, d.hi, d.radius, d.mid]).toEqual([-10, 10, 10, 0]);
    // -2 is 0.2 of the radius below 0: k = floor(0.2 × 16) = 3, bin 15 − 3 = 12.
    expect(binOf(d, -2)).toBe(12);
    expect(binOf(d, 2)).toBe(19);
    const wide = makeDomain('diverging', -Number.MAX_VALUE, Number.MAX_VALUE, 0, 32);
    expect(Number.isFinite(wide.radius)).toBe(true);
    expect(binOf(wide, Number.MAX_VALUE)).toBe(31);
  });
});

describe('colors', () => {
  it('sequential default colors get lighter bin by bin (perceptually ordered, OKLab L)', () => {
    for (const bins of [2, 7, 32, 64]) {
      let previous = -Infinity;
      for (let b = 0; b < bins; b++) {
        const [l] = defaultBinOklab('sequential', b, bins);
        expect(l).toBeGreaterThan(previous);
        previous = l;
      }
    }
    // Anchors themselves rise in lightness.
    const ls = SEQUENTIAL_ANCHORS.map(h => hexToOklab(h)[0]);
    for (let i = 1; i < ls.length; i++) expect(ls[i]!).toBeGreaterThan(ls[i - 1]!);
  });

  it('diverging default colors are lightest at the centre and matched in lightness on both arms', () => {
    const bins = 32;
    const l = Array.from({ length: bins }, (_, b) => defaultBinOklab('diverging', b, bins)[0]);
    for (let b = 0; b < bins / 2 - 1; b++) {
      expect(l[b + 1]!).toBeGreaterThan(l[b]!);
      expect(l[bins - 2 - b]!).toBeGreaterThan(l[bins - 1 - b]!);
      expect(Math.abs(l[b]! - l[bins - 1 - b]!)).toBeLessThan(0.03);
    }
    const anchors = DIVERGING_ANCHORS.map(h => hexToOklab(h)[0]);
    expect(Math.abs(anchors[0]! - anchors[4]!)).toBeLessThan(0.03);
    expect(Math.abs(anchors[1]! - anchors[3]!)).toBeLessThan(0.03);
  });

  it('are live CSS: anchors as custom properties with private defaults, OKLab mixing, and a forced-colors switch', () => {
    expect(colorAt('sequential', 0)).toBe('var(--axylo-forced-series, var(--axylo-sequential-0, #440154))');
    expect(colorAt('sequential', 1)).toBe('var(--axylo-forced-series, var(--axylo-sequential-4, #fde725))');
    // Two bins: bin 0 sits at t = 0.25, exactly anchor 1 of 5 (no mixing needed).
    expect(binColor('diverging', 0, 2)).toBe('var(--axylo-forced-series, var(--axylo-diverging-1, #8fb4d9))');
    // Bin 0 of 32 sits at t = 1/64 of the way: 4 × 1/64 = 0.0625 into the first segment, 93.75 % of anchor 0.
    expect(binColor('sequential', 0, 32)).toBe(
      'var(--axylo-forced-series, color-mix(in oklab, var(--axylo-sequential-0, #440154) 93.75%, var(--axylo-sequential-1, #3b528b)))');
    for (let b = 0; b < 32; b++) expect(binColor('sequential', b, 32)).not.toMatch(/url\(|<|;/);
  });

  it('accept 2 to 64 bins only', () => {
    expect([1, 2, 64, 65, 2.5, '8', NaN].map(validBins)).toEqual([null, 2, 64, null, null, null, null]);
  });
});
