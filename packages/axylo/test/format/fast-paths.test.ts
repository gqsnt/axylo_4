import fc from 'fast-check';
import { expect, it, vi } from 'vitest';
import { defaultReadoutNumber, defaultTickNumber, shareText } from '../../src/format/number';
import type { ValueScale } from '../../src/format/number';
import { middleText, prepareLabels } from '../../src/layout/labels';
import { timeTickCandidates, weekStart } from '../../src/scale/time';

const locales = ['en', 'en-US'];
const scales = [null, 'percent', 'ratio'] as const;
const finite = fc.double({ noNaN: true, noDefaultInfinity: true });

function exact(format: Intl.NumberFormat, value: number, shift = 0): string {
  if (!Number.isFinite(value) || value === 0) return format.format(value === 0 ? 0 : value);
  const [mantissa, exponent] = value.toExponential().split('e');
  return (format.format as unknown as (decimal: string) => string)(`${mantissa}e${Number(exponent) + shift}`);
}

it('matches Intl halfExpand on both sides of every share tie between 0% and 100%', () => {
  const format = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 });
  expect(format.resolvedOptions()).toMatchObject({ roundingMode: 'halfExpand' });
  const compare = (value: number) => {
    const expected = exact(format, value);
    for (const locale of locales) expect(shareText(value, locale)).toBe(expected);
  };
  for (let i = 0; i < 1000; i++) {
    const tie = (i + 0.5) / 1000;
    for (const value of [tie - 1e-15, tie, tie + 1e-15]) {
      compare(value);
      compare(-value);
    }
  }
  for (const value of [0, -0, 1, -1, 12.345, Number.MAX_VALUE, -Number.MIN_VALUE, NaN, Infinity, -Infinity]) compare(value);
  fc.assert(fc.property(finite, compare), { numRuns: 1000 });
});

function readoutOptions(value: number, scale: ValueScale): Intl.NumberFormatOptions {
  const options: Intl.NumberFormatOptions = scale ? { style: 'percent' } : {};
  if (!Number.isFinite(value) || value === 0) return { ...options, maximumFractionDigits: 0 };
  const [mantissa = '', exponent] = Math.abs(value).toExponential().split('e');
  const digits = mantissa.replace('.', '');
  const point = Number(exponent) + 1 + (scale === 'ratio' ? 2 : 0);
  const fraction = point < 0 ? '0'.repeat(-point) + digits : digits.slice(point);
  const first = fraction.search(/[1-9]/);
  const precision = first < 0 ? 0 : first + 6;
  return precision > 100
    ? { ...options, notation: 'scientific', maximumSignificantDigits: 6 }
    : { ...options, maximumFractionDigits: precision };
}

it('matches Intl readouts at fraction, grouping, and scientific boundaries', () => {
  const compare = (value: number) => {
    for (const scale of scales) {
      const format = new Intl.NumberFormat('en-US', readoutOptions(value, scale));
      const expected = exact(format, value, scale === 'percent' ? -2 : 0);
      for (const locale of locales) expect(defaultReadoutNumber(value, locale, scale)).toBe(expected);
    }
  };
  for (const number of [0, 0.15, 1.005, 12.3456, 0.000123456, 1234567.89, 99.9999999, 999.9999995, 1e-7,
    1e6, 1e21, 1e-20, 1e-95, 1e-96, 1e-97, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, Number.MAX_VALUE, NaN, Infinity]) {
    compare(number);
    compare(-number);
  }
  fc.assert(fc.property(finite, compare), { numRuns: 1000 });
});

it('matches Intl fixed ticks, including zero padding and signed values that round to zero', () => {
  const compare = (value: number, digits: number) => {
    for (const scale of scales) {
      const step = Number(`1e${-digits - (scale === 'ratio' ? 2 : 0)}`);
      const format = new Intl.NumberFormat('en-US', {
        style: scale ? 'percent' : 'decimal', minimumFractionDigits: digits, maximumFractionDigits: digits,
      });
      const expected = exact(format, value, scale === 'percent' ? -2 : 0);
      for (const locale of locales) expect(defaultTickNumber(value, { step, maxAbs: 9999 }, locale, scale)).toBe(expected);
    }
  };
  for (const value of [0, -0, 1.5, -1.5, 1.005, -1.005, 0.15, 99.9999999, 1234.5, 1e-7, -1e-20]) {
    for (let digits = 0; digits <= 9; digits++) compare(value, digits);
  }
  fc.assert(fc.property(fc.double({ min: -9999, max: 9999, noNaN: true }), fc.integer({ min: 0, max: 9 }), compare), { numRuns: 1000 });
});

it('constructs no Intl.NumberFormat for the covered English paths', () => {
  const construct = vi.spyOn(Intl, 'NumberFormat');
  try {
    for (const locale of locales) {
      expect(shareText(0.0005, locale)).toBe('0.1%');
      expect(shareText(-0, locale)).toBe('0%');
      expect(defaultReadoutNumber(1.2345678, locale)).toBe('1.234568');
      expect(defaultReadoutNumber(12345.125, locale, 'percent')).toBe('12,345.125%');
      expect(defaultReadoutNumber(0.125, locale, 'ratio')).toBe('12.5%');
      expect(defaultReadoutNumber(-0, locale, 'ratio')).toBe('0%');
      expect(defaultTickNumber(1.005, { step: 0.01, maxAbs: 2 }, locale)).toBe('1.01');
      expect(defaultTickNumber(0, { step: 0.005, maxAbs: 0.04 }, locale, 'ratio')).toBe('0.0%');
    }
    expect(construct).not.toHaveBeenCalled();
  } finally {
    construct.mockRestore();
  }
});

it('uses native week rules for common locales and caches other tags within a fixed bound', () => {
  const native = (tag: string): number => {
    const locale = new Intl.Locale(tag) as Intl.Locale & { getWeekInfo?(): { firstDay: number }; weekInfo?: { firstDay: number } };
    return (locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay ?? 1;
  };
  const tags = ['en', 'en-US', 'en-GB', 'en-US-u-fw-mon', 'ar-EG'];
  const expected = tags.map(tag => native(tag) % 7);
  const construct = vi.spyOn(Intl, 'Locale');
  try {
    expect(tags.map(weekStart)).toEqual(expected);
    expect(tags.map(weekStart)).toEqual(expected);
    expect(construct.mock.calls.map(([tag]) => tag)).toEqual(tags.slice(3));

    construct.mockClear();
    const start = Date.UTC(2026, 0, 1);
    const week = 7 * 86_400_000;
    const options = { kind: 'date', locale: 'en-GB-u-fw-sun', label: String } as const;
    timeTickCandidates([start, start + 15 * week], options);
    expect(construct).not.toHaveBeenCalled();
    timeTickCandidates([start, start + 6 * week], options);
    expect(construct).toHaveBeenCalledExactlyOnceWith(options.locale);

    for (let i = 0; i < 64; i++) weekStart(`en-US-x-wave-${i}`);
    construct.mockClear();
    expect(weekStart(tags[3]!)).toBe(expected[3]);
    expect(construct).toHaveBeenCalledExactlyOnceWith(tags[3]);
  } finally {
    construct.mockRestore();
  }
});

it('truncates printable ASCII without a segmenter and preserves Unicode and CRLF clusters', () => {
  const native = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const metrics = { lineHeight: 1, width: (text: string) => Array.from(native.segment(text)).length };
  const truncate = (label: string) => middleText(label, 5, prepareLabels([[{ label, value: 0 }]]), metrics);
  const construct = vi.spyOn(Intl, 'Segmenter');
  try {
    expect(truncate('Cat 001')).toBe('Ca…01');
    expect(construct).not.toHaveBeenCalled();
    const family = '👨‍👩‍👧‍👦';
    const accented = 'e\u0301';
    expect(truncate(`A${family}long${accented}B`)).toBe(`A${family}…${accented}B`);
    expect(truncate('A\r\nlongYZ')).toBe('A\r\n…YZ');
    expect(construct).toHaveBeenCalledTimes(1);
  } finally {
    construct.mockRestore();
  }
});
