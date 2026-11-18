import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { bandScale, bandTickCandidates } from '../../src/scale/band';

describe('bandScale', () => {
  it('splits the range into equal bands with equal inner and outer gaps', () => {
    const s = bandScale(4, [0, 420], 0.2);
    // 4 bands and 5 gaps of 0.2 step each: 4·step·0.8 + 5·step·0.2 = 4.2·step = 420.
    expect(s.step).toBeCloseTo(100, 10);
    expect(s.bandwidth).toBeCloseTo(80, 10);
    expect(s.map(0)).toBeCloseTo(20, 10);
    expect(s.map(3)).toBeCloseTo(320, 10);
    expect(s.map(3) + s.bandwidth + 20).toBeCloseTo(420, 10);
    expect(s.center(1)).toBeCloseTo(160, 10);
  });

  it('works with a reversed range, map giving the lower pixel edge', () => {
    const s = bandScale(4, [420, 0], 0.2);
    // Band 0 occupies [320, 400], band 3 [20, 100].
    expect(s.map(0)).toBeCloseTo(320, 10);
    expect(s.map(3)).toBeCloseTo(20, 10);
    expect(s.invert(360)).toBe(0);
    expect(s.invert(60)).toBe(3);
  });

  it('inverts to the nearest band, clamped', () => {
    const s = bandScale(4, [0, 420], 0.2);
    expect(s.invert(60)).toBe(0);
    expect(s.invert(115)).toBe(1); // in the gap, nearer band 1 (starts at 120)
    expect(s.invert(-50)).toBe(0);
    expect(s.invert(1000)).toBe(3);
    expect(bandScale(0, [0, 100], 0.2).invert(50)).toBe(-1);
  });

  it('band centres invert to their own index (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 500 }), fc.double({ min: 10, max: 4000, noNaN: true }), fc.double({ min: 0, max: 0.9, noNaN: true }), fc.boolean(), (n, width, padding, reversed) => {
        const s = bandScale(n, reversed ? [width, 0] : [0, width], padding);
        for (const i of [0, Math.floor(n / 2), n - 1]) expect(s.invert(s.center(i))).toBe(i);
        expect(s.count).toBe(n);
        expect(s.bandwidth).toBeLessThanOrEqual(s.step + 1e-9);
      }),
      { numRuns: 1000 },
    );
  });
});

describe('bandTickCandidates', () => {
  it('gives every category, then every k-th, keeping the first', () => {
    const sets = bandTickCandidates(['a', 'b', 'c', 'd', 'e']);
    // k = 1: all five; k = 2: a c e; k = 3: a d; k = 4 also gives two (skipped); k = 5: a.
    expect(sets.map(s => s.map(t => t.label))).toEqual([['a', 'b', 'c', 'd', 'e'], ['a', 'c', 'e'], ['a', 'd'], ['a']]);
    expect(sets[1]!.map(t => t.value)).toEqual([0, 2, 4]);
  });

  it('gives nothing for no categories and one set for one', () => {
    expect(bandTickCandidates([])).toEqual([]);
    expect(bandTickCandidates(['only'])).toEqual([[{ value: 0, label: 'only' }]]);
  });

  it('is densest first and always keeps the first category (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 3000 }), n => {
        const labels = Array.from({ length: n }, (_, i) => `c${i}`);
        const sets = bandTickCandidates(labels);
        expect(sets[0]!.length).toBe(n);
        for (let s = 0; s < sets.length; s++) {
          expect(sets[s]![0]!.value).toBe(0);
          if (s > 0) expect(sets[s]!.length).toBeLessThan(sets[s - 1]!.length);
          for (const t of sets[s]!) expect(t.label).toBe(labels[t.value]);
        }
        expect(sets[sets.length - 1]!.length).toBe(1);
      }),
      { numRuns: 200 },
    );
  });
});
