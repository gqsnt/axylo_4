import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { valueDomain, type ValueDomainInput } from '../../src/scale/domain';
import { linearTickCandidates } from '../../src/scale/linear';

const base = { includeZero: false, authorDomain: null, valueScale: null, references: [] } satisfies Omit<ValueDomainInput, 'min' | 'max'>;
const auto = (min: number, max: number, extra: Partial<ValueDomainInput> = {}) => valueDomain({ ...base, min, max, ...extra });

describe('valueDomain: zero baseline (F1)', () => {
  it('starts the bars fixture (values 82–97) at zero and ends at the first tick at or above 97', () => {
    // Data 0..97 (zero forced). The first nice tick at or above 97 at a step of 20 is 100.
    expect(auto(82, 97, { includeZero: true })).toEqual({ domain: [0, 100], widenedToZero: false });
  });

  it('ends all-negative bars at zero', () => {
    expect(auto(-97, -82, { includeZero: true }).domain).toEqual([-100, 0]);
  });

  it('covers both signs for mixed data', () => {
    const { domain } = auto(-30, 70, { includeZero: true });
    expect(domain[0]).toBeLessThanOrEqual(-30);
    expect(domain[1]).toBeGreaterThanOrEqual(70);
  });

  it('widens an author domain that excludes zero and says so (AX110)', () => {
    expect(auto(82, 97, { includeZero: true, authorDomain: [50, 100] })).toEqual({ domain: [0, 100], widenedToZero: true });
    expect(auto(-9, -6, { includeZero: true, authorDomain: [-10, -5] })).toEqual({ domain: [-10, 0], widenedToZero: true });
  });

  it('keeps an author domain that already includes zero, and any author domain on a line', () => {
    expect(auto(82, 97, { includeZero: true, authorDomain: [0, 120] })).toEqual({ domain: [0, 120], widenedToZero: false });
    expect(auto(82, 97, { authorDomain: [80, 95] })).toEqual({ domain: [80, 95], widenedToZero: false });
  });
});

describe('valueDomain: automatic domain (F7)', () => {
  it('does not force zero on a line', () => {
    // Span 15, step 5 (first nice step at or above 15 / 5): 80 and 100 are the first ticks beyond 82 and 97.
    expect(auto(82, 97).domain).toEqual([80, 100]);
  });

  it('includes reference values', () => {
    const { domain } = auto(10, 20, { references: [35] });
    expect(domain[0]).toBeLessThanOrEqual(10);
    expect(domain[1]).toBeGreaterThanOrEqual(35);
  });

  it('gives a usable domain for constant data', () => {
    for (const v of [50, -3, 0.002, 1e9, -5e-324]) {
      const [lo, hi] = auto(v, v).domain;
      expect(lo).toBeLessThan(v);
      expect(hi).toBeGreaterThan(v);
    }
    expect(auto(0, 0).domain[0]).toBeLessThan(auto(0, 0).domain[1]);
    expect(auto(0, 0, { includeZero: true }).domain).toEqual([0, 1]);
    expect(auto(40, 40, { includeZero: true }).domain).toEqual([0, 40]);
  });

  it('gives a usable domain for empty data', () => {
    expect(auto(NaN, NaN).domain).toEqual([0, 1]);
    expect(auto(Infinity, -Infinity, { includeZero: true }).domain).toEqual([0, 1]);
  });

  it('ends a percent field at 100 when its maximum is between 50 and 100', () => {
    expect(auto(82, 97, { includeZero: true, valueScale: 'percent' }).domain).toEqual([0, 100]);
    expect(auto(10, 50, { includeZero: true, valueScale: 'percent' }).domain).toEqual([0, 100]);
    expect(auto(10, 100, { includeZero: true, valueScale: 'percent' }).domain).toEqual([0, 100]);
  });

  it('applies the normal rule to a percent field whose maximum is small, or above full scale', () => {
    // A 4% maximum ends at the first tick at or above 4% (spec F7).
    expect(auto(1, 4, { includeZero: true, valueScale: 'percent' }).domain).toEqual([0, 4]);
    expect(auto(1, 49, { includeZero: true, valueScale: 'percent' }).domain).toEqual([0, 50]);
    // 120: step 50 (first nice step at or above 120 / 5 = 24 is 50), first tick at or above 120 is 150.
    expect(auto(1, 120, { includeZero: true, valueScale: 'percent' }).domain).toEqual([0, 150]);
  });

  it('ends a ratio field at 1 under the same rule', () => {
    expect(auto(0.2, 0.7, { includeZero: true, valueScale: 'ratio' }).domain).toEqual([0, 1]);
    expect(auto(0.01, 0.04, { includeZero: true, valueScale: 'ratio' }).domain).toEqual([0, 0.04]);
  });

  it('infers nothing from an undeclared field that looks like a percentage', () => {
    expect(auto(82, 97, { includeZero: true }).domain).toEqual([0, 100]); // same as the nice rule, not the full-scale rule
    expect(auto(10, 60, { includeZero: true }).domain).toEqual([0, 60]);
  });
});

describe('valueDomain properties', () => {
  // Magnitudes below 1e-12 are folded to zero: against a data extreme like 5e-324 the overshoot
  // "step - 5e-324" rounds to the step itself, so the strict comparison would test double rounding, not the rule.
  const value = fc.double({ min: -1e9, max: 1e9, noNaN: true, noDefaultInfinity: true }).map(v => (Math.abs(v) < 1e-12 ? 0 : v));
  const data = fc.array(value, { minLength: 1, maxLength: 20 });

  it('contains all data and references, and is not degenerate', () => {
    fc.assert(
      fc.property(data, fc.array(value, { maxLength: 3 }), fc.boolean(), fc.constantFrom(null, 'percent' as const, 'ratio' as const), (ys, refs, includeZero, valueScale) => {
        const min = Math.min(...ys);
        const max = Math.max(...ys);
        const [lo, hi] = valueDomain({ min, max, includeZero, valueScale, references: refs, authorDomain: null }).domain;
        expect(lo).toBeLessThan(hi);
        for (const v of [...ys, ...refs]) {
          expect(lo).toBeLessThanOrEqual(v);
          expect(hi).toBeGreaterThanOrEqual(v);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('with includeZero always contains zero, author domain or not', () => {
    const author = fc.option(fc.tuple(value, value), { nil: null });
    fc.assert(
      fc.property(value, value, author, (a, b, authorDomain) => {
        const r = valueDomain({ min: Math.min(a, b), max: Math.max(a, b), includeZero: true, authorDomain });
        expect(r.domain[0]).toBeLessThanOrEqual(0);
        expect(r.domain[1]).toBeGreaterThanOrEqual(0);
        if (authorDomain) {
          const excluded = Math.min(...authorDomain) > 0 || Math.max(...authorDomain) < 0;
          expect(r.widenedToZero).toBe(excluded);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('ends at the first tick at or beyond each extreme: less than one tick step of overshoot', () => {
    // For non-constant data the domain ends are the first and last tick of one of the tick candidate sets,
    // and that set's step is larger than the overshoot at each end.
    fc.assert(
      fc.property(data.filter(ys => Math.max(...ys) - Math.min(...ys) > 1e-12 * Math.max(1, ...ys.map(Math.abs))), fc.boolean(), (ys, includeZero) => {
        let min = Math.min(...ys);
        let max = Math.max(...ys);
        const [lo, hi] = valueDomain({ min, max, includeZero }).domain;
        if (includeZero) {
          min = Math.min(min, 0);
          max = Math.max(max, 0);
        }
        const sets = linearTickCandidates([lo, hi], String);
        // "Overshoot below one step" is written as "the next tick inwards is past the extreme", which compares
        // tick values exactly instead of subtracting doubles of different magnitudes.
        const matching = sets.find(set => set.length >= 2 && set[0]!.value === lo && set[set.length - 1]!.value === hi
          && set[1]!.value > min && set[set.length - 2]!.value < max);
        expect(matching, `domain [${lo}, ${hi}] for data [${min}, ${max}]`).toBeDefined();
      }),
      { numRuns: 1000 },
    );
  });
});
