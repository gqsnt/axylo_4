import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createNumberReadout, createNumberTickLabeler, defaultReadoutNumber, defaultTickNumber } from '../../src/format/number';

// Intl uses U+00A0 (de-DE "12,5 %", "1,5 Mio.") and, depending on ICU, U+202F in some places. Tests
// normalize both to a plain space; every other character, including grouping separators, is exact.
const norm = (s: string): string => s.replace(/[  ]/g, ' ');
const readout = (locale: string, v: number, extra: Parameters<typeof createNumberReadout>[0] extends infer S ? Partial<S> : never = {}) =>
  norm(createNumberReadout({ locale, ...extra })(v));

describe('readout format (spec F6)', () => {
  // Expected strings: CLDR conventions as Intl.NumberFormat applies them, with the F6 digit rule as clarified
  // after review: the full integer part; the fraction to six significant digits, its leading zeros not
  // counted; trailing zeros removed.
  const cases: Array<[string, number, string, string, string]> = [
    //  what                  value          en-US           de-DE           en-IN
    ['large integer', 1234567, '1,234,567', '1.234.567', '12,34,567'],
    ['small decimal', 0.000123456, '0.000123456', '0,000123456', '0.000123456'],
    ['value with a fraction', 36207.5, '36,207.5', '36.207,5', '36,207.5'],
    ['negative', -1234.5, '-1,234.5', '-1.234,5', '-1,234.5'],
  ];
  for (const [what, v, enUS, deDE, enIN] of cases) {
    it(`writes a ${what} in en-US, de-DE and en-IN`, () => {
      expect(readout('en-US', v)).toBe(enUS);
      expect(readout('de-DE', v)).toBe(deDE);
      expect(readout('en-IN', v)).toBe(enIN);
    });
  }

  it('writes percentages for percent (0–100) and ratio (0–1) fields', () => {
    expect(readout('en-US', 12.5, { scale: 'percent' })).toBe('12.5%');
    expect(readout('de-DE', 12.5, { scale: 'percent' })).toBe('12,5 %');
    expect(readout('en-IN', 12.5, { scale: 'percent' })).toBe('12.5%');
    expect(readout('en-US', 0.125, { scale: 'ratio' })).toBe('12.5%');
    expect(readout('de-DE', 0.125, { scale: 'ratio' })).toBe('12,5 %');
    expect(readout('en-US', 0.0412345, { scale: 'ratio' })).toBe('4.12345%');
  });

  it('keeps the full integer part and rounds the fraction to six significant digits', () => {
    expect(readout('en-US', 123456.789)).toBe('123,456.789');
    expect(readout('en-US', 1234567.891)).toBe('1,234,567.891');
    expect(readout('en-US', 2 / 3)).toBe('0.666667');
    expect(readout('en-US', 0.1 + 0.2)).toBe('0.3');
    expect(readout('en-US', 0.5)).toBe('0.5');
    expect(readout('en-US', 1e21)).toBe('1,000,000,000,000,000,000,000');
    // Fraction 0.000000 then 49999999: six significant digits 499999|99 round up to 500000.
    expect(readout('en-US', 7.00000049999999)).toBe('7.0000005');
  });

  it('never writes "-0"', () => {
    expect(readout('en-US', -0)).toBe('0');
    // A small negative value is not zero, and is written in full.
    expect(readout('en-US', -0.0000001)).toBe('-0.0000001');
  });

  it('appends the unit after a space', () => {
    expect(readout('en-US', 12, { unit: 'ms' })).toBe('12 ms');
    expect(readout('de-DE', 36207.5, { unit: 'USD' })).toBe('36.207,5 USD');
  });

  it('uses the author format instead of the default', () => {
    expect(readout('en-US', 1.23456, { format: { maximumFractionDigits: 2 }, unit: 'ms' })).toBe('1.23 ms');
    expect(readout('en-US', 1234.5, { format: { style: 'currency', currency: 'USD' }, unit: 'USD' })).toBe('$1,234.50');
    expect(readout('en-US', 12.5, { format: { maximumFractionDigits: 0 }, scale: 'percent' })).toBe('13%');
    expect(readout('en-US', 3, { format: v => `${v} things` })).toBe('3 things');
  });

  it('falls back to the default and reports once when an author formatter throws (AX160)', () => {
    const errors: unknown[] = [];
    const f = createNumberReadout({ locale: 'en-US', unit: 'ms', format: () => { throw new Error('bad'); }, onError: e => errors.push(e) });
    expect(f(36207.5)).toBe('36,207.5 ms');
    expect(f(1)).toBe('1 ms');
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('bad');
  });

  it('falls back and reports when author Intl options are invalid', () => {
    const errors: unknown[] = [];
    const f = createNumberReadout({ locale: 'en-US', format: { maximumFractionDigits: 500 }, onError: e => errors.push(e) });
    expect(f(1234567)).toBe('1,234,567');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(RangeError);
  });

  it('writes the integer part in full and at most six significant fraction digits (property)', () => {
    // Expected integer part from the input: the truncated value, or one more where the fraction rounds up.
    fc.assert(
      fc.property(fc.double({ min: -1e12, max: 1e12, noNaN: true }).filter(v => Math.abs(v) >= 1e-90), v => {
        const text = defaultReadoutNumber(v, 'en-US');
        expect(text.startsWith('-')).toBe(v < 0);
        const [integer = '', fraction = ''] = text.replace('-', '').split('.');
        const whole = BigInt(Math.trunc(Math.abs(v)));
        expect([whole, whole + 1n]).toContain(BigInt(integer.replace(/,/g, '')));
        expect(fraction.endsWith('0')).toBe(false);
        // Leading zeros of the fraction do not count.
        expect(fraction.replace(/^0+/, '').length).toBeLessThanOrEqual(6);
        // A fraction that is there shows, unless it rounded up into the integer part.
        if (Math.abs(v) - Math.trunc(Math.abs(v)) > 0) {
          expect(fraction.length > 0 || BigInt(integer.replace(/,/g, '')) === whole + 1n).toBe(true);
        }
      }),
      { numRuns: 1000 },
    );
  });
});

describe('tick format', () => {
  const tick = (locale: string, v: number, step: number, maxAbs: number, scale: 'percent' | 'ratio' | null = null) =>
    norm(defaultTickNumber(v, { step, maxAbs }, locale, scale));

  it('groups digits and uses the fraction digits of the step, the same for every tick', () => {
    expect(tick('en-US', 50000, 10000, 100000)).toBe('50,000');
    expect(tick('de-DE', 50000, 10000, 100000)).toBe('50.000');
    expect(tick('en-IN', 500000, 100000, 900000)).toBe('5,00,000');
    expect([0, 0.5, 1].map(v => tick('en-US', v, 0.5, 1))).toEqual(['0.0', '0.5', '1.0']);
    expect(tick('de-DE', 0.25, 0.05, 1)).toBe('0,25');
  });

  it('is compact when the largest tick is at least a million', () => {
    expect(tick('en-US', 1_500_000, 500_000, 2_000_000)).toBe('1.5M');
    expect(tick('de-DE', 1_500_000, 500_000, 2_000_000)).toBe('1,5 Mio.');
    expect(tick('en-IN', 1_500_000, 500_000, 2_000_000)).toBe('15L');
    // Enough significant digits for the step, so neighbouring ticks never read the same.
    expect(tick('en-US', 10_200_000, 200_000, 10_400_000)).toBe('10.2M');
    expect(tick('en-US', 10_400_000, 200_000, 10_400_000)).toBe('10.4M');
    expect(tick('en-US', 0, 500_000, 2_000_000)).toBe('0');
    expect(tick('en-US', 200_000, 200_000, 1_200_000)).toBe('200K');
  });

  it('writes percentage ticks for declared percent and ratio fields', () => {
    expect(tick('en-US', 20, 20, 100, 'percent')).toBe('20%');
    expect(tick('en-US', 0.2, 0.2, 1, 'ratio')).toBe('20%');
    expect(tick('en-US', 0.025, 0.005, 0.04, 'ratio')).toBe('2.5%');
  });

  it('uses the author tickFormat, falling back on failure and reporting once', () => {
    const errors: unknown[] = [];
    const ctx = { step: 1_000_000, maxAbs: 5_000_000 };
    expect(createNumberTickLabeler({ locale: 'en-US', tickFormat: { notation: 'scientific' } })(2_000_000, ctx)).toBe('2E6');
    const failing = createNumberTickLabeler({ locale: 'en-US', tickFormat: () => { throw new Error('x'); }, onError: e => errors.push(e) });
    expect(failing(2_000_000, ctx)).toBe('2M');
    expect(failing(3_000_000, ctx)).toBe('3M');
    expect(errors).toHaveLength(1);
  });
});
