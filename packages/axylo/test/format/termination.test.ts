/**
 * Every public format function returns, promptly, for any finite or non-finite input.
 *
 * A synchronous endless loop cannot be stopped by the test timeout, so each call is also timed against a
 * wall-clock budget. The fixed case is the input that hung `vitest run packages/axylo/test/format`
 * (review.test.ts, finding 9 property): ratio ticks in en-IN on [990129262714874.8, 990129262714875.8],
 * where the tick index passed 2^53 and `i++` stopped changing i in linearTickCandidates.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createNumberReadout, createNumberTickLabeler, defaultReadoutNumber, defaultTickNumber } from '../../src/format/number';
import { createTimeReadout, createTimeTickLabel, defaultTimeReadout } from '../../src/format/time';
import { createFormatters } from '../../src/format/index';
import { linearTickCandidates } from '../../src/scale/linear';
import { SLOT_ABSENT_FIELD, SLOT_NO_ROW } from '../../src/core/contracts';

const BUDGET_MS = 1000;

function timed<T>(what: string, f: () => T): T {
  const t0 = performance.now();
  const out = f();
  const ms = performance.now() - t0;
  expect(ms, `${what} took ${ms.toFixed(0)} ms`).toBeLessThan(BUDGET_MS);
  return out;
}

const EXTREMES: readonly number[] = [
  0, -0, 5e-324, -5e-324, 2.2250738585072014e-308, 1e-300, 1e-95, 1e-94, 0.1, 1, -1, 1e15, 2 ** 53, 1e21, 1e300,
  Number.MAX_VALUE, -Number.MAX_VALUE, NaN, Infinity, -Infinity,
  8.64e15, -8.64e15, 8.64e15 + 1, -8.64e15 - 1, 1e16, -1e16,
];
const value = fc.oneof(fc.constantFrom(...EXTREMES), fc.double());
const scale = fc.constantFrom(null, 'percent' as const, 'ratio' as const);
const locale = fc.constantFrom('en-US', 'de-DE', 'en-IN');

describe('fixed case that once never returned', () => {
  it('ratio ticks in en-IN on [990129262714874.8, 990129262714875.8]', () => {
    const labeler = createNumberTickLabeler({ locale: 'en-IN', scale: 'ratio' });
    const sets = timed('ticks', () => linearTickCandidates([990129262714874.8, 990129262714875.8], labeler));
    expect(sets.length).toBeGreaterThan(0);
    for (const set of sets) expect(new Set(set.map(t => t.label)).size).toBe(set.length);
  });
});

describe('guard: every public format function returns within the budget for extreme inputs', () => {
  it('number readouts and tick labels', () => {
    fc.assert(
      fc.property(value, value, value, scale, locale, (v, step, maxAbs, s, l) => {
        expect(typeof timed('defaultReadoutNumber', () => defaultReadoutNumber(v, l, s))).toBe('string');
        timed('createNumberReadout', () => createNumberReadout({ locale: l, scale: s, unit: 'ms' })(v));
        timed('author options', () => createNumberReadout({ locale: l, scale: s, format: { maximumFractionDigits: 2 } })(v));
        timed('defaultTickNumber', () => defaultTickNumber(v, { step, maxAbs }, l, s));
        timed('createNumberTickLabeler', () => createNumberTickLabeler({ locale: l, scale: s })(v, { step, maxAbs }));
      }),
      { numRuns: 1000 },
    );
  });

  it('production tick labels on any domain, including narrow ranges on large bases', () => {
    const narrow = fc.tuple(fc.double({ min: 1e13, max: 1e17, noNaN: true }), fc.double({ min: 1e-3, max: 1e3, noNaN: true })).map(([b, w]) => [b, b + w] as [number, number]);
    const domain = fc.oneof(fc.tuple(value, value), narrow);
    fc.assert(
      fc.property(domain, scale, locale, ([a, b], s, l) => {
        timed('labeled ticks', () => linearTickCandidates([a, b], createNumberTickLabeler({ locale: l, scale: s })));
      }),
      { numRuns: 1000 },
    );
  });

  it('time readouts, tick labels and the Formatters', () => {
    const kind = fc.constantFrom('time' as const, 'date' as const, 'wall' as const);
    const zone = fc.constantFrom('UTC', 'America/Los_Angeles', 'Asia/Kolkata');
    const unit = fc.constantFrom('day' as const, 'month' as const, 'year' as const, null);
    fc.assert(
      fc.property(value, kind, zone, unit, locale, (p, k, z, u, l) => {
        expect(typeof timed('defaultTimeReadout', () => defaultTimeReadout(p, k, z, l, u))).toBe('string');
        timed('createTimeReadout options', () => createTimeReadout({ kind: k, timeZone: z, locale: l, dateUnit: u, format: { hour: 'numeric' } })(p));
        timed('createTimeReadout function', () => createTimeReadout({ kind: k, timeZone: z, locale: l, format: () => 'x' })(p));
        timed('createTimeTickLabel', () => createTimeTickLabel({ kind: k, timeZone: z, locale: l, format: { month: 'short' } })?.(p));
        const f = timed('createFormatters', () => createFormatters(
          { series: [{ field: 'v', unit: 'ms', scale: null }], x: { field: 'x', kind: k, unit: null, timeZone: z, dateUnit: u, categories: null }, messages: { noData: 'No data', noObservation: 'No observation' } },
          { locale: l, timeZone: 'UTC' },
        ));
        timed('Formatters', () => [f.value(0, p), f.value(5, p), f.x(p), f.missing(SLOT_NO_ROW), f.missing(SLOT_ABSENT_FIELD)]);
      }),
      { numRuns: 1000 },
    );
  });
});
