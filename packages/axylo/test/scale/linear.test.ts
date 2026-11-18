import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { linearScale, linearTickCandidates } from '../../src/scale/linear';

const plain = (v: number): string => String(v);
const values = (set: readonly { value: number }[]): number[] => set.map(t => t.value);

describe('linearScale', () => {
  it('maps and inverts', () => {
    const s = linearScale([0, 100], [0, 500]);
    expect(s.type).toBe('linear');
    expect(s.map(50)).toBe(250);
    expect(s.invert(250)).toBe(50);
    expect(s.map(0)).toBe(0);
    expect(s.map(100)).toBe(500);
  });

  it('supports a reversed pixel range (value axis drawn upwards)', () => {
    const s = linearScale([0, 10], [300, 0]);
    expect(s.map(0)).toBe(300);
    expect(s.map(10)).toBe(0);
    expect(s.invert(150)).toBe(5);
  });

  it('draws a zero-width domain in the middle of the range without dividing by zero', () => {
    const s = linearScale([5, 5], [0, 200]);
    expect(s.map(5)).toBe(100);
    expect(s.map(7)).toBe(100);
    expect(s.invert(30)).toBe(5);
  });

  it('map and invert are inverse (property)', () => {
    const finite = (min: number, max: number) => fc.double({ min, max, noNaN: true, noDefaultInfinity: true });
    fc.assert(
      fc.property(finite(-1e9, 1e9), finite(1e-3, 1e9), finite(-5000, 5000), finite(1, 5000), finite(0, 1), (d0, width, r0, extent, f) => {
        const d1 = d0 + width;
        const s = linearScale([d0, d1], [r0, r0 + extent]);
        const v = d0 + f * width;
        const back = s.invert(s.map(v));
        expect(Math.abs(back - v)).toBeLessThanOrEqual(1e-9 * Math.max(Math.abs(d0), Math.abs(d1), width));
        const p = r0 + f * extent;
        // The domain value in between can only be as precise as its magnitude allows, which in pixels is
        // ulp(domain) / width × extent.
        const resolution = Math.max(1, Math.max(Math.abs(d0), Math.abs(d1)) / width);
        expect(Math.abs(s.map(s.invert(p)) - p)).toBeLessThanOrEqual(1e-9 * Math.max(Math.abs(r0), extent) * resolution);
      }),
      { numRuns: 1000 },
    );
  });
});

describe('linearTickCandidates', () => {
  it('gives nice steps densest first on [0, 100]', () => {
    const sets = linearTickCandidates([0, 100], plain);
    // Steps 10, 20, 50, 100, 200: 11, 6, 3, 2 and 1 ticks.
    expect(sets.map(values)).toEqual([
      [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
      [0, 20, 40, 60, 80, 100],
      [0, 50, 100],
      [0, 100],
      [0],
    ]);
    expect(sets[0]?.[3]?.label).toBe('30');
  });

  it('cleans floating point so decimal ticks are the decimal literals', () => {
    const sets = linearTickCandidates([0.3, 0.7], plain);
    expect(values(sets[0] ?? [])).toEqual([0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7]);
    expect(values(sets[1] ?? [])).toEqual([0.3, 0.4, 0.5, 0.6, 0.7]);
    expect(values(sets[2] ?? [])).toEqual([0.4, 0.6]);
    expect(values(sets[3] ?? [])).toEqual([0.5]);
    expect(sets).toHaveLength(4);
  });

  it('handles negative and mixed-sign domains', () => {
    const sets = linearTickCandidates([-7, 3], plain);
    expect(values(sets[0] ?? [])).toEqual([-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3]);
    expect(values(sets[1] ?? [])).toEqual([-6, -4, -2, 0, 2]);
    expect(values(sets[2] ?? [])).toEqual([-5, 0]);
    // No -0 anywhere.
    for (const set of sets) for (const t of set) expect(Object.is(t.value, -0)).toBe(false);
  });

  it('passes the set step and largest magnitude to the labeler', () => {
    const seen: Array<[number, number, number]> = [];
    linearTickCandidates([0, 2_000_000], (v, c) => {
      seen.push([v, c.step, c.maxAbs]);
      return '';
    });
    expect(seen[0]).toEqual([0, 200_000, 2_000_000]);
  });

  it('gives one tick for a zero-width domain and none for a non-finite one', () => {
    expect(linearTickCandidates([4, 4], plain).map(values)).toEqual([[4]]);
    // A width below the resolution of doubles cannot hold nice steps: one tick, no endless loop.
    expect(linearTickCandidates([-5e-324, 0], plain).length).toBe(1);
    expect(linearTickCandidates([0, Infinity], plain)).toEqual([]);
  });

  it('keeps every tick inside the domain, sets densest first, no duplicates (property)', () => {
    // Any two distinct doubles, and narrow ranges on large bases (review finding 2): no filter.
    const anyDouble = fc.double({ noNaN: true, noDefaultInfinity: true });
    const narrow = fc
      .tuple(fc.double({ min: -1e15, max: 1e15, noNaN: true, noDefaultInfinity: true }), fc.double({ min: -16, max: 2, noNaN: true }))
      .map(([b, e]) => [b, b + Math.max(Math.abs(b), 1) * 10 ** e] as [number, number]);
    const domain = fc.oneof(fc.tuple(anyDouble, anyDouble), narrow).filter(([a, b]) => a !== b);
    fc.assert(
      fc.property(domain, ([a, b]) => {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        const sets = linearTickCandidates([a, b], plain);
        expect(sets.length).toBeGreaterThan(0);
        expect(sets[0]!.length).toBeLessThanOrEqual(12);
        expect(sets[sets.length - 1]!.length).toBeLessThanOrEqual(2);
        for (let s = 0; s < sets.length; s++) {
          const set = sets[s]!;
          if (s > 0) expect(set.length).toBeLessThan(sets[s - 1]!.length);
          for (let i = 0; i < set.length; i++) {
            const v = set[i]!.value;
            expect(v).toBeGreaterThanOrEqual(lo);
            expect(v).toBeLessThanOrEqual(hi);
            if (i > 0) expect(v).toBeGreaterThan(set[i - 1]!.value);
          }
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('uses only 1, 2 or 5 times a power of ten as the step (property)', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e6, max: 1e6, noNaN: true }), fc.double({ min: 1e-3, max: 1e6, noNaN: true }), (lo, width) => {
        for (const set of linearTickCandidates([lo, lo + width], plain)) {
          if (set.length < 2) continue;
          const step = set[1]!.value - set[0]!.value;
          // Tick values carry rounding of their own magnitude, so the difference is a nice step only approximately.
          const mantissa = step / 10 ** Math.floor(Math.log10(step) + 1e-6);
          expect([1, 2, 5].some(m => Math.abs(mantissa - m) < 1e-6)).toBe(true);
        }
      }),
      { numRuns: 1000 },
    );
  });
});
