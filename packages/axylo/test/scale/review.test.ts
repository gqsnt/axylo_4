/**
 * Regression tests for the cross-provider review of 2026-11-18 (reviews/2026-11-18/impl/wp/scale.review.md).
 * Each block names its finding. Expected values come from the review, the spec and Intl, not from the code.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { valueDomain } from '../../src/scale/domain';
import { linearScale, linearTickCandidates } from '../../src/scale/linear';
import { bandTickCandidates } from '../../src/scale/band';
import { timeTickCandidates } from '../../src/scale/time';

const norm = (s: string): string => s.replace(/[  ]/g, ' ');
const iso = (s: string): number => Date.parse(s);

describe('finding 1: year ticks on extreme dates return promptly', () => {
  // A hang here cannot be interrupted by the test timeout (the loop is synchronous), so each call is also
  // timed: a regression shows as a slow call before it shows as a hang.
  const cases: Array<[string, number, number]> = [
    ['years 0 to 2', iso('0000-01-01T00:00:00Z'), iso('0002-01-01T00:00:00Z')],
    ['years 200000 to 200010', iso('+200000-01-01T00:00:00Z'), iso('+200010-01-01T00:00:00Z')],
    ['the whole Date range', -8.64e15, 8.64e15],
    ['near the lower Date limit', -8.64e15, -8.64e15 + 3 * 365 * 86_400_000],
  ];
  for (const [what, lo, hi] of cases) {
    for (const kind of ['date', 'time', 'wall'] as const) {
      it(`${what}, ${kind}`, () => {
        const t0 = performance.now();
        const sets = timeTickCandidates([lo, hi], { kind, timeZone: kind === 'time' ? 'America/Los_Angeles' : null, locale: 'en-US', dateUnit: 'year' });
        expect(performance.now() - t0).toBeLessThan(1000);
        for (const set of sets) for (const t of set) {
          expect(t.value).toBeGreaterThanOrEqual(lo);
          expect(t.value).toBeLessThanOrEqual(hi);
        }
      }, 5000);
    }
  }

  it('returns nothing (instead of throwing) for positions outside the Date range', () => {
    expect(() => timeTickCandidates([9e15, 9.1e15], { kind: 'date', locale: 'en-US' })).not.toThrow();
  });
});

describe('finding 2: narrow ranges around a large value', () => {
  it('gives an ordered domain containing the data', () => {
    const { domain } = valueDomain({ min: 100000000, max: 100000000.01, includeZero: false });
    expect(domain[0]).toBeLessThanOrEqual(100000000);
    expect(domain[1]).toBeGreaterThanOrEqual(100000000.01);
    expect(domain[0]).toBeLessThan(domain[1]);
  });

  it('offers more than one tick on the original interval', () => {
    const sets = linearTickCandidates([100000000, 100000000.01], String);
    expect(sets[0]!.length).toBeGreaterThan(2);
  });

  it('holds for any base plus a small width (property)', () => {
    const base = fc.double({ min: -1e12, max: 1e12, noNaN: true, noDefaultInfinity: true });
    const relativeWidth = fc.double({ min: -14, max: 0, noNaN: true }).map(e => 10 ** e);
    fc.assert(
      fc.property(base, relativeWidth, (b, r) => {
        const max = b + Math.max(Math.abs(b), 1) * r;
        if (!(max > b)) return;
        const { domain } = valueDomain({ min: b, max, includeZero: false });
        expect(domain[0]).toBeLessThanOrEqual(b);
        expect(domain[1]).toBeGreaterThanOrEqual(max);
        expect(domain[0]).toBeLessThan(domain[1]);
        for (const set of linearTickCandidates([b, max], String)) for (const t of set) {
          expect(t.value).toBeGreaterThanOrEqual(b);
          expect(t.value).toBeLessThanOrEqual(max);
        }
      }),
      { numRuns: 1000 },
    );
  });
});

describe('finding 3: finite extremes never produce non-finite domains or pixels', () => {
  it('gives finite domains for the largest and smallest doubles', () => {
    const big = valueDomain({ min: -1e308, max: 1e308, includeZero: false }).domain;
    expect(big.every(Number.isFinite)).toBe(true);
    expect(big[0]).toBeLessThanOrEqual(-1e308);
    expect(big[1]).toBeGreaterThanOrEqual(1e308);
    expect(valueDomain({ min: 5e-324, max: 1e-323, includeZero: false }).domain).toEqual([5e-324, 1e-323]);
    const top = valueDomain({ min: 1.7e308, max: 1.7e308, includeZero: false }).domain;
    expect(top.every(Number.isFinite)).toBe(true);
    expect(top[0]).toBeLessThan(top[1]);
  });

  it('maps and inverts across a domain whose width overflows', () => {
    const s = linearScale([-1e308, 1e308], [0, 100]);
    expect(s.map(0)).toBe(50);
    expect(s.invert(50)).toBe(0);
    expect(s.map(1e308)).toBe(100);
    expect(s.invert(0)).toBe(-1e308);
  });

  it('holds for any finite data (property)', () => {
    const any = fc.double({ noNaN: true, noDefaultInfinity: true });
    fc.assert(
      fc.property(any, any, fc.boolean(), fc.constantFrom(null, 'percent' as const, 'ratio' as const), (a, b, includeZero, valueScale) => {
        const min = Math.min(a, b);
        const max = Math.max(a, b);
        const [lo, hi] = valueDomain({ min, max, includeZero, valueScale }).domain;
        expect(Number.isFinite(lo) && Number.isFinite(hi)).toBe(true);
        expect(lo).toBeLessThanOrEqual(min);
        expect(hi).toBeGreaterThanOrEqual(max);
        const s = linearScale([lo, hi], [0, 100]);
        expect(Number.isFinite(s.map(min)) && Number.isFinite(s.invert(50))).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });
});

describe('finding 4: repeated clock times across a fold are told apart', () => {
  it('names the zone on every repeated 15-minute label', () => {
    const sets = timeTickCandidates([iso('2026-11-01T07:45:00Z'), iso('2026-11-01T09:45:00Z')], { kind: 'time', timeZone: 'America/Los_Angeles', locale: 'en-US' });
    for (const set of sets) {
      const labels = set.map(t => t.label);
      expect(new Set(labels).size, labels.join(' | ')).toBe(labels.length);
    }
    const quarter = sets.find(s => s.length === 9)!;
    const at = (t: string) => norm(quarter.find(x => x.value === iso(t))!.label);
    expect(at('2026-11-01T08:15:00Z')).toBe('1:15 AM PDT');
    expect(at('2026-11-01T09:15:00Z')).toBe('1:15 AM PST');
  });
});

describe('finding 5: a daily tick in a midnight gap is the first instant of the day', () => {
  it('puts 1919-03-31 in Toronto at 04:30Z, when clocks jumped to 00:30', () => {
    // Intl's own reading of the zone database: 04:29:59Z is still March 30, 04:30Z is 00:30 on March 31.
    const read = (t: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(t);
    expect(read(iso('1919-03-31T04:29:59Z'))).toMatch(/^1919-03-30/);
    expect(read(iso('1919-03-31T04:30:00Z'))).toMatch(/^1919-03-31, 00:30/);
    const sets = timeTickCandidates([iso('1919-03-29T05:00:00Z'), iso('1919-04-02T05:00:00Z')], { kind: 'time', timeZone: 'America/Toronto', locale: 'en-US' });
    const daily = sets.find(s => s.length === 5)!;
    expect(daily.map(t => t.value)).toContain(iso('1919-03-31T04:30:00Z'));
  });
});

describe('finding 6: full-scale endpoints survive rounding', () => {
  it('keeps 100 and 1 as the top for qualifying percent and ratio data', () => {
    expect(valueDomain({ min: 100, max: 100, includeZero: false, valueScale: 'percent' }).domain[1]).toBe(100);
    expect(valueDomain({ min: 1, max: 1, includeZero: false, valueScale: 'ratio' }).domain[1]).toBe(1);
    const wide = valueDomain({ min: -1000, max: 75, includeZero: false, valueScale: 'percent' }).domain;
    expect(wide[1]).toBe(100);
    expect(wide[0]).toBeLessThanOrEqual(-1000);
  });

  it('ends at full scale whenever the maximum qualifies (property)', () => {
    fc.assert(
      fc.property(fc.constantFrom('percent' as const, 'ratio' as const), fc.double({ min: 0.5, max: 1, noNaN: true }), fc.double({ min: -20, max: 1, noNaN: true }), fc.boolean(), (scale, top, bottom, includeZero) => {
        const full = scale === 'percent' ? 100 : 1;
        const max = top * full;
        const min = Math.min(bottom * full, max);
        const [lo, hi] = valueDomain({ min, max, includeZero, valueScale: scale }).domain;
        expect(hi).toBe(full);
        expect(lo).toBeLessThanOrEqual(min);
        expect(lo).toBeLessThan(hi);
      }),
      { numRuns: 1000 },
    );
  });
});

describe('finding 11: a zero-width author domain is kept', () => {
  it('keeps [5, 5] on a line and widens it to zero on a bar', () => {
    expect(valueDomain({ min: 1, max: 9, includeZero: false, authorDomain: [5, 5] })).toEqual({ domain: [5, 5], widenedToZero: false });
    expect(valueDomain({ min: 1, max: 9, includeZero: true, authorDomain: [5, 5] })).toEqual({ domain: [0, 5], widenedToZero: true });
    expect(valueDomain({ min: 1, max: 9, includeZero: true, authorDomain: [0, 0] })).toEqual({ domain: [0, 0], widenedToZero: false });
  });
});

describe('finding 13: year labels before year 1 carry the era', () => {
  it('tells 1 BC from AD 1', () => {
    const sets = timeTickCandidates([iso('0000-01-01T00:00:00Z'), iso('0001-01-01T00:00:00Z')], { kind: 'date', locale: 'en-US', dateUnit: 'year' });
    const both = sets.find(s => s.length === 2)!;
    expect(both.map(t => norm(t.label))).toEqual(['1 BC', '1 AD']);
  });

  it('adds no era to ordinary years', () => {
    const sets = timeTickCandidates([Date.UTC(2020, 0, 1), Date.UTC(2026, 0, 1)], { kind: 'date', locale: 'en-US', dateUnit: 'year' });
    expect(sets[0]!.map(t => t.label)).toEqual(['2020', '2021', '2022', '2023', '2024', '2025', '2026']);
  });
});

describe('finding 14: category candidates stay cheap for very many categories', () => {
  it('builds no tick for 100,000 categories until a set is read, and few sets', () => {
    let reads = 0;
    const names = Array.from({ length: 100_000 }, (_, i) => `c${i}`);
    const counted = new Proxy(names, {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
        return Reflect.get(target, key, receiver);
      },
    });
    const sets = bandTickCandidates(counted);
    expect(reads).toBe(0);
    expect(sets.length).toBeLessThanOrEqual(30);
    const sparse = sets[sets.length - 2]!;
    expect(reads).toBeLessThanOrEqual(1000);
    expect(sparse[0]!.label).toBe('c0');
    expect(sets[0]!.length).toBe(100_000);
    expect(sets[sets.length - 1]!.length).toBe(1);
  });
});
