/**
 * Every public scale function returns, promptly, for any finite or non-finite input.
 *
 * A synchronous endless loop cannot be stopped by the test timeout, so each call is also timed against a
 * wall-clock budget: a regression towards a hang shows as a slow call first. The fixed cases are inputs
 * that once looped forever.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { linearScale, linearTickCandidates } from '../../src/scale/linear';
import { valueDomain } from '../../src/scale/domain';
import { bandScale, bandTickCandidates } from '../../src/scale/band';
import { timeScale, timeTickCandidates } from '../../src/scale/time';
import { firstInstantAtOrAfterWall, instantToWall, wallToInstant, wallToInstants, zoneOffset } from '../../src/scale/zone';

const BUDGET_MS = 1000;

/** Runs `f` and fails if it took longer than the budget. */
function timed<T>(what: string, f: () => T): T {
  const t0 = performance.now();
  const out = f();
  const ms = performance.now() - t0;
  expect(ms, `${what} took ${ms.toFixed(0)} ms`).toBeLessThan(BUDGET_MS);
  return out;
}

/** n units in the last place above b (b finite and positive). */
const ulpsAbove = (b: number, n: number): number => b + n * 2 ** (Math.floor(Math.log2(Math.abs(b))) - 52);

const EXTREMES: readonly number[] = [
  0, -0, 5e-324, -5e-324, 2.2250738585072014e-308, 1e-300, 0.1, 1, -1, 1e15, 2 ** 53, 2 ** 53 + 2, 1e300,
  Number.MAX_VALUE, -Number.MAX_VALUE, NaN, Infinity, -Infinity,
  8.64e15, -8.64e15, 8.64e15 + 1, -8.64e15 - 1, 1e16, -1e16,
];

/** Extremes, ordinary doubles, and narrow ranges on large bases (where index arithmetic runs out of bits). */
const value = fc.oneof(fc.constantFrom(...EXTREMES), fc.double());
const domain = fc.oneof(
  fc.tuple(value, value),
  fc.tuple(fc.constantFrom(1e15, 990129262714874.8, 2 ** 53, 1e20, 1e300, 1.7e308, 8.6e15), fc.integer({ min: 1, max: 4000 }))
    .map(([b, n]) => [b, ulpsAbove(b, n)] as [number, number]),
  fc.tuple(fc.double({ min: 1e14, max: 1e16, noNaN: true }), fc.double({ min: 0.01, max: 100, noNaN: true })).map(([b, w]) => [b, b + w] as [number, number]),
);

describe('fixed cases that once never returned', () => {
  it('linear ticks on [990129262714874.8, +1] (the hung format run)', () => {
    const sets = timed('linearTickCandidates', () => linearTickCandidates([990129262714874.8, 990129262714875.8], String));
    expect(sets.length).toBeGreaterThan(0);
    for (const set of sets) for (const t of set) {
      expect(t.value).toBeGreaterThanOrEqual(990129262714874.8);
      expect(t.value).toBeLessThanOrEqual(990129262714875.8);
    }
  });

  it('linear ticks on 1e300 plus a few units in the last place', () => {
    for (const n of [6, 8, 12, 40, 1000]) {
      const hi = ulpsAbove(1e300, n);
      const sets = timed(`ulps ${n}`, () => linearTickCandidates([1e300, hi], String));
      expect(sets.length).toBeGreaterThan(0);
      for (const set of sets) for (const t of set) {
        expect(t.value).toBeGreaterThanOrEqual(1e300);
        expect(t.value).toBeLessThanOrEqual(hi);
      }
    }
  });
});

describe('guard: every public scale function returns within the budget for extreme inputs', () => {
  it('linear: scale, ticks and value domain', () => {
    fc.assert(
      fc.property(domain, value, fc.boolean(), fc.constantFrom(null, 'percent' as const, 'ratio' as const), ([a, b], v, includeZero, valueScale) => {
        const s = timed('linearScale', () => linearScale([a, b], [0, 100]));
        timed('map/invert', () => [s.map(v), s.invert(v), s.map(a), s.invert(50)]);
        timed('linearTickCandidates', () => linearTickCandidates([a, b], String));
        const r = timed('valueDomain', () => valueDomain({ min: Math.min(a, b), max: Math.max(a, b), includeZero, valueScale, references: [v], authorDomain: null }));
        expect(r.domain.every(Number.isFinite)).toBe(true);
        timed('valueDomain author', () => valueDomain({ min: a, max: b, includeZero, authorDomain: [a, b] }));
      }),
      { numRuns: 1000 },
    );
  });

  it('band: scale and candidates', () => {
    fc.assert(
      fc.property(value, value, value, value, (count, r0, r1, p) => {
        const s = timed('bandScale', () => bandScale(count, [r0, r1], p));
        timed('band map/invert', () => [s.map(0), s.center(0), s.invert(r0), s.invert(NaN)]);
      }),
      { numRuns: 1000 },
    );
    for (const n of [0, 1, 2, 7, 1000, 100_000]) {
      const labels = Array.from({ length: n }, (_, i) => String(i));
      const sets = timed(`bandTickCandidates ${n}`, () => bandTickCandidates(labels));
      if (n > 0) timed('read sparse set', () => sets[sets.length - 1]!.length);
    }
  });

  it('time: scale, ticks and zone helpers', () => {
    const zone = fc.constantFrom('UTC', 'America/Los_Angeles', 'Asia/Kolkata', 'Europe/Paris', 'Australia/Lord_Howe');
    const kind = fc.constantFrom('time' as const, 'date' as const, 'wall' as const);
    const unit = fc.constantFrom('day' as const, 'month' as const, 'year' as const, null);
    fc.assert(
      fc.property(domain, value, zone, kind, unit, ([a, b], v, timeZone, k, dateUnit) => {
        const s = timed('timeScale', () => timeScale([a, b], [0, 100]));
        timed('time map/invert', () => [s.map(v), s.invert(v)]);
        const sets = timed('timeTickCandidates', () => timeTickCandidates([a, b], { kind: k, timeZone, locale: 'en-US', dateUnit }));
        for (const set of sets) for (const t of set) expect(Number.isFinite(t.value)).toBe(true);
        timed('zone helpers', () => [zoneOffset(timeZone, v), instantToWall(timeZone, v), wallToInstants(timeZone, v), wallToInstant(timeZone, v, 'later'), firstInstantAtOrAfterWall(timeZone, v)]);
      }),
      { numRuns: 300 },
    );
  });
});
