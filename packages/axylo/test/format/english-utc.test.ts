import fc from 'fast-check';
import { expect, it, vi } from 'vitest';
import { builtInDateFormat, DateParts } from '../../src/format/intl';

it('matches native English UTC formatting for every field combination without an era', () => {
  const fields = [
    [DateParts.Year, { year: 'numeric' }], [DateParts.Month, { month: 'short' }], [DateParts.Day, { day: 'numeric' }],
    [DateParts.Clock, { hour: 'numeric', minute: '2-digit' }], [DateParts.Seconds, { second: '2-digit' }],
    [DateParts.Milliseconds, { fractionalSecondDigits: 3 }], [DateParts.Zone, { timeZoneName: 'short' }],
    [DateParts.Offset, { timeZoneName: 'shortOffset' }],
  ] as const;
  const masks = fields.reduce<number[]>((masks, [bit]) => [...masks, ...masks.map(mask => mask | bit)], [0]);
  const formats = masks.map(mask => {
    const options: Intl.DateTimeFormatOptions = { timeZone: 'UTC' };
    for (const [bit, field] of fields) if (mask & bit) Object.assign(options, field);
    return { expected: new Intl.DateTimeFormat('en-US', options).format,
      en: builtInDateFormat('en', 'UTC', mask), us: builtInDateFormat('en-US', 'UTC', mask) };
  });
  const compare = (value: number, index: number) => {
    const { expected, en, us } = formats[index]!;
    expect(en(value)).toBe(expected(value));
    expect(us(value)).toBe(expected(value));
  };
  for (const value of [-8.64e15, Date.parse('0000-01-01'), -0.5, 0, Date.UTC(2024, 1, 29, 12, 4, 5, 6), 8.64e15]) {
    for (let i = 0; i < formats.length; i++) compare(value, i);
  }
  fc.assert(fc.property(fc.integer({ min: -8.64e15, max: 8.64e15 }), fc.integer({ min: 0, max: formats.length - 1 }), compare),
    { numRuns: 1000 });
});

it('formats English UTC dates and clock values without constructing Intl.DateTimeFormat', async () => {
  vi.resetModules();
  const { builtInDateFormat } = await import('../../src/format/intl');
  const instant = Date.UTC(2024, 1, 29, 14, 5, 6, 7);
  const expected = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', hour: 'numeric', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3,
  }).format(instant);
  const construct = vi.spyOn(Intl, 'DateTimeFormat');
  try {
    const clock = builtInDateFormat('en-US', 'UTC', DateParts.Clock | DateParts.Seconds | DateParts.Milliseconds);
    expect(builtInDateFormat('en', 'UTC', DateParts.Date)(instant)).toBe('Feb 29, 2024');
    expect(clock(instant)).toBe(expected);
    expect(clock(instant)).toBe(expected);
    expect(builtInDateFormat('en', 'UTC', DateParts.Clock | DateParts.Seconds | DateParts.Milliseconds)(instant)).toBe(expected);
    expect(construct).not.toHaveBeenCalled();
  } finally {
    construct.mockRestore();
  }
});
