/**
 * Regression tests for the cross-provider review of 2026-11-18 (reviews/2026-11-18/impl/wp/scale.review.md).
 * Expected strings come from the spec (F4, F6 as clarified by the coordinator), the review and Intl.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createNumberReadout, createNumberTickLabeler, defaultReadoutNumber } from '../../src/format/number';
import { createTimeReadout, defaultTimeReadout } from '../../src/format/time';
import { createFormatters } from '../../src/format/index';
import { linearTickCandidates } from '../../src/scale/linear';

const norm = (s: string): string => s.replace(/[  ]/g, ' ');
const iso = (s: string): number => Date.parse(s);

describe('finding 7: readouts keep the full integer part and six significant fraction digits', () => {
  // F6: the integer part in full; the fraction to six significant digits, leading zeros of the fraction
  // not counted; trailing zeros removed; never "-0".
  const cases: Array<[number, string]> = [
    [123456.75, '123,456.75'],
    [0.000123456, '0.000123456'],
    [1.23456789e-7, '0.000000123457'],
    [0.1 + 0.2, '0.3'],
    [36207.5, '36,207.5'],
    [1234567.891, '1,234,567.891'],
    [123456.123456789, '123,456.123457'],
    [2 / 3, '0.666667'],
    [1234567, '1,234,567'],
    [-0, '0'],
    [-1.5e-7, '-0.00000015'],
  ];
  for (const [v, text] of cases) it(`writes ${v} as ${text}`, () => expect(defaultReadoutNumber(v, 'en-US')).toBe(text));

  it('writes any integer part and short fraction exactly (property, expected built from the input)', () => {
    // Inputs are built as decimal strings with at most 15 significant digits, so the double reads back as
    // the same decimal, and the fraction has at most six significant digits, so nothing is rounded.
    const input = fc.record({
      negative: fc.boolean(),
      integer: fc.integer({ min: 0, max: 99999 }),
      zeros: fc.integer({ min: 0, max: 9 }),
      digits: fc.stringMatching(/^[1-9][0-9]{0,5}$/),
      hasFraction: fc.boolean(),
    }).filter(r => String(r.integer).length + r.zeros + r.digits.length <= 15);
    fc.assert(
      fc.property(input, r => {
        const fraction = r.hasFraction ? ('0'.repeat(r.zeros) + r.digits).replace(/0+$/, '') : '';
        const literal = `${r.negative ? '-' : ''}${r.integer}${fraction ? '.' + fraction : ''}`;
        const v = Number(literal);
        const grouped = String(r.integer).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        const expected = v === 0 ? '0' : `${r.negative ? '-' : ''}${grouped}${fraction ? '.' + fraction : ''}`;
        expect(defaultReadoutNumber(v, 'en-US')).toBe(expected);
      }),
      { numRuns: 1000 },
    );
  });
});

describe('finding 8: percent conversion keeps decimal rounding and never throws', () => {
  it('rounds a declared percent as the decimal it is', () => {
    // 10.00005 % is the fraction 0.1000005; at four fraction digits it rounds half up to 10.0001 %.
    const f = createNumberReadout({ locale: 'en-US', scale: 'percent', format: { maximumFractionDigits: 4 } });
    expect(f(10.00005)).toBe('10.0001%');
    expect(defaultReadoutNumber(10.00005, 'en-US', 'percent')).toBe('10.00005%');
    // 0.07 × 100 is 7.000000000000001 in binary; the readout is 7 %.
    expect(defaultReadoutNumber(0.07, 'en-US', 'ratio')).toBe('7%');
    expect(defaultReadoutNumber(0.0000001234567, 'en-US', 'ratio')).toBe('0.0000123457%');
  });

  it('labels ratio ticks on a huge domain without throwing', () => {
    const labeler = createNumberTickLabeler({ locale: 'en-US', scale: 'ratio' });
    expect(() => linearTickCandidates([0, 1e307], labeler)).not.toThrow();
  });
});

describe('finding 9: distinct ticks never read the same', () => {
  it('gives distinct labels on [0, 1e-21]', () => {
    const labeler = createNumberTickLabeler({ locale: 'en-US' });
    const dense = linearTickCandidates([0, 1e-21], labeler)[0]!;
    expect(dense.length).toBeGreaterThan(2);
    expect(new Set(dense.map(t => t.label)).size).toBe(dense.length);
  });

  it('gives distinct labels for any domain, scale and locale (property, production labeler)', () => {
    const base = fc.double({ min: -1e300, max: 1e300, noNaN: true, noDefaultInfinity: true });
    const exponent = fc.double({ min: -300, max: 300, noNaN: true });
    fc.assert(
      fc.property(base, exponent, fc.constantFrom(null, 'percent' as const, 'ratio' as const), fc.constantFrom('en-US', 'de-DE', 'en-IN'), (b, e, scale, locale) => {
        const hi = b + 10 ** e;
        if (!(hi > b) || !Number.isFinite(hi)) return;
        const labeler = createNumberTickLabeler({ locale, scale });
        for (const set of linearTickCandidates([b, hi], labeler)) {
          const labels = set.map(t => t.label);
          expect(new Set(labels).size, `${labels.join(' | ')} on [${b}, ${hi}]`).toBe(labels.length);
        }
      }),
      { numRuns: 1000 },
    );
  });
});

describe('finding 10: the zone and the unit are never lost, the percent sign never doubled', () => {
  const LA = 'America/Los_Angeles';
  it('adds the zone to author Intl options that omit it', () => {
    const f = createTimeReadout({ kind: 'time', timeZone: LA, locale: 'en-US', format: { hour: 'numeric', minute: '2-digit' } });
    expect(norm(f(iso('2026-11-01T08:30:00Z')))).toBe('1:30 AM PDT');
    expect(norm(f(iso('2026-11-01T09:30:00Z')))).toBe('1:30 AM PST');
  });

  it('does not add a second zone, and handles styles that cannot take one', () => {
    const named = createTimeReadout({ kind: 'time', timeZone: LA, locale: 'en-US', format: { hour: 'numeric', minute: '2-digit', timeZoneName: 'long' } });
    expect(norm(named(iso('2026-11-01T09:30:00Z')))).toBe('1:30 AM Pacific Standard Time');
    const styled = createTimeReadout({ kind: 'time', timeZone: LA, locale: 'en-US', format: { dateStyle: 'medium', timeStyle: 'short' } });
    expect(norm(styled(iso('2026-11-01T09:30:00Z')))).toBe('Nov 1, 2026, 1:30 AM PST');
  });

  it('adds the zone to an author function unless it is already there', () => {
    const bare = createTimeReadout({ kind: 'time', timeZone: LA, locale: 'en-US', format: () => 'early' });
    expect(norm(bare(iso('2026-11-01T09:30:00Z')))).toBe('early PST');
    const already = createTimeReadout({ kind: 'time', timeZone: LA, locale: 'en-US', format: () => '1:30 PST' });
    expect(already(iso('2026-11-01T09:30:00Z'))).toBe('1:30 PST');
    // Calendar dates and wall times have no zone to add.
    expect(createTimeReadout({ kind: 'date', locale: 'en-US', format: () => 'd' })(0)).toBe('d');
  });

  it('appends the unit to an author function unless it already ends with it', () => {
    expect(createNumberReadout({ locale: 'en-US', unit: 'ms', format: v => v.toFixed(1) })(3)).toBe('3.0 ms');
    expect(createNumberReadout({ locale: 'en-US', unit: 'ms', format: v => `${v} ms` })(3)).toBe('3 ms');
  });

  it('never writes a second percent sign from the unit of a percent or ratio field', () => {
    expect(createNumberReadout({ locale: 'en-US', unit: '%', scale: 'percent' })(12)).toBe('12%');
    expect(createNumberReadout({ locale: 'en-US', unit: '%', scale: 'ratio' })(0.12)).toBe('12%');
    expect(norm(createNumberReadout({ locale: 'de-DE', unit: '%', scale: 'percent' })(12))).toBe('12 %');
    expect(createNumberReadout({ locale: 'en-US', unit: '%', scale: 'percent', format: { maximumFractionDigits: 0 } })(12.4)).toBe('12%');
    // Other units are kept.
    expect(createNumberReadout({ locale: 'en-US', unit: 'of users', scale: 'percent' })(12)).toBe('12% of users');
  });
});

describe('finding 12: category formatters are applied', () => {
  const base = {
    series: [],
    messages: { noData: 'No data', noObservation: 'No observation' },
  };
  it('calls the author function with the category name', () => {
    const f = createFormatters({ ...base, x: { field: 'channel', kind: 'category', unit: null, timeZone: null, dateUnit: null, categories: ['direct'], format: v => String(v).toUpperCase() } }, { locale: 'en-US', timeZone: 'UTC' });
    expect(f.x(0)).toBe('DIRECT');
  });

  it('falls back to the name and reports the field once when it throws (AX160)', () => {
    const reports: string[] = [];
    const f = createFormatters(
      { ...base, x: { field: 'channel', kind: 'category', unit: null, timeZone: null, dateUnit: null, categories: ['direct', 'search'], format: () => { throw new Error('no'); } }, onFormatterError: field => reports.push(field) },
      { locale: 'en-US', timeZone: 'UTC' },
    );
    expect(f.x(0)).toBe('direct');
    expect(f.x(1)).toBe('search');
    expect(reports).toEqual(['channel']);
  });
});

describe('finding 13: readouts before year 1 carry the era', () => {
  it('tells 1 BC from AD 1, and adds no era to ordinary dates', () => {
    expect(norm(defaultTimeReadout(iso('0000-01-01T00:00:00Z'), 'date', null, 'en-US', 'day'))).toBe('Jan 1, 1 BC');
    expect(norm(defaultTimeReadout(iso('0001-01-01T00:00:00Z'), 'date', null, 'en-US', 'day'))).toBe('Jan 1, 1');
    expect(norm(defaultTimeReadout(iso('-000044-03-15T00:00:00Z'), 'date', null, 'en-US', 'year'))).toBe('45 BC');
    expect(norm(defaultTimeReadout(iso('0000-01-01T12:00:00Z'), 'wall', null, 'en-US'))).toBe('Jan 1, 1 BC, 12:00 PM');
    expect(norm(defaultTimeReadout(Date.UTC(2026, 1, 24), 'date', null, 'en-US', 'day'))).toBe('Feb 24, 2026');
  });
});
