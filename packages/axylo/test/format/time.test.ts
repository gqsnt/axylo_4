import { describe, expect, it } from 'vitest';
import { createTimeReadout, createTimeTickLabel, defaultTimeReadout } from '../../src/format/time';

// Normalize U+00A0 / U+202F (used by some ICU versions before AM/PM) to a plain space; everything else exact.
const norm = (s: string): string => s.replace(/[  ]/g, ' ');
const read = (...args: Parameters<typeof defaultTimeReadout>) => norm(defaultTimeReadout(...args));

const FEB24 = Date.UTC(2026, 1, 24);

describe('date readouts (calendar dates, always UTC)', () => {
  it('writes a day, a month or a year by date unit', () => {
    expect(read(FEB24, 'date', null, 'en-US', 'day')).toBe('Feb 24, 2026');
    expect(read(FEB24, 'date', null, 'de-DE', 'day')).toBe('24. Feb. 2026');
    expect(read(FEB24, 'date', null, 'en-IN', 'day')).toBe('24 Feb 2026');
    expect(read(Date.UTC(2026, 1, 1), 'date', null, 'en-US', 'month')).toBe('Feb 2026');
    expect(read(Date.UTC(2026, 0, 1), 'date', null, 'en-US', 'year')).toBe('2026');
  });

  it('ignores any time zone it is given', () => {
    expect(read(FEB24, 'date', 'America/Los_Angeles', 'en-US', 'day')).toBe('Feb 24, 2026');
    expect(read(FEB24, 'date', 'Asia/Kolkata', 'en-US', 'day')).toBe('Feb 24, 2026');
  });
});

describe('time readouts (instants in a zone, zone named)', () => {
  // 2026-02-24T00:00Z is 16:00 PST on the 23rd in Los Angeles and 05:30 IST on the 24th in Kolkata.
  it('writes en-US, de-DE and en-IN zoned times', () => {
    expect(read(FEB24, 'time', 'America/Los_Angeles', 'en-US')).toBe('Feb 23, 2026, 4:00 PM PST');
    expect(read(FEB24, 'time', 'America/Los_Angeles', 'de-DE')).toBe('23. Feb. 2026, 16:00 GMT-8');
    expect(read(FEB24, 'time', 'America/Los_Angeles', 'en-IN')).toBe('23 Feb 2026, 4:00 pm GMT-8');
    expect(read(FEB24, 'time', 'Asia/Kolkata', 'en-US')).toBe('Feb 24, 2026, 5:30 AM GMT+5:30');
    expect(read(FEB24, 'time', 'Asia/Kolkata', 'en-IN')).toBe('24 Feb 2026, 5:30 am IST');
    expect(read(FEB24, 'time', 'UTC', 'en-US')).toBe('Feb 24, 2026, 12:00 AM UTC');
  });

  it('names daylight time and the zone change on both sides of a transition', () => {
    expect(read(Date.UTC(2026, 6, 24), 'time', 'America/Los_Angeles', 'en-US')).toBe('Jul 23, 2026, 5:00 PM PDT');
    expect(read(Date.UTC(2026, 6, 24), 'time', 'Europe/Paris', 'de-DE')).toBe('24. Juli 2026, 02:00 MESZ');
    expect(read(Date.UTC(2026, 10, 1, 8, 30), 'time', 'America/Los_Angeles', 'en-US')).toBe('Nov 1, 2026, 1:30 AM PDT');
    expect(read(Date.UTC(2026, 10, 1, 9, 30), 'time', 'America/Los_Angeles', 'en-US')).toBe('Nov 1, 2026, 1:30 AM PST');
  });

  it('shows seconds and milliseconds only when the instant has them', () => {
    expect(read(Date.UTC(2026, 1, 24, 14, 30, 15), 'time', 'UTC', 'en-US')).toBe('Feb 24, 2026, 2:30:15 PM UTC');
    expect(read(Date.UTC(2026, 1, 24, 14, 30, 15, 250), 'time', 'UTC', 'en-US')).toBe('Feb 24, 2026, 2:30:15.250 PM UTC');
  });
});

describe('wall readouts (as written, no zone)', () => {
  it('writes the fields as they were written', () => {
    expect(read(Date.UTC(2026, 1, 24, 14, 30), 'wall', 'America/Los_Angeles', 'en-US')).toBe('Feb 24, 2026, 2:30 PM');
    expect(read(Date.UTC(2026, 1, 24, 14, 30), 'wall', null, 'de-DE')).toBe('24. Feb. 2026, 14:30');
  });
});

describe('author formats', () => {
  it('applies Intl options in the axis zone', () => {
    const f = createTimeReadout({ kind: 'time', timeZone: 'Asia/Kolkata', locale: 'en-US', format: { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } });
    expect(f(FEB24)).toBe('05:30');
    const d = createTimeReadout({ kind: 'date', locale: 'en-US', format: { weekday: 'long', timeZone: 'Asia/Tokyo' } as Intl.DateTimeFormatOptions });
    // The date kind is always read in UTC, even when the options name another zone.
    expect(d(FEB24)).toBe('Tuesday');
  });

  it('passes a Date to an author function and falls back once when it throws (AX160)', () => {
    const errors: unknown[] = [];
    const ok = createTimeReadout({ kind: 'date', locale: 'en-US', format: v => (v as Date).toISOString().slice(0, 10) });
    expect(ok(FEB24)).toBe('2026-02-24');
    const bad = createTimeReadout({ kind: 'date', locale: 'en-US', dateUnit: 'day', format: () => { throw new Error('no'); }, onError: e => errors.push(e) });
    expect(norm(bad(FEB24))).toBe('Feb 24, 2026');
    bad(FEB24);
    expect(errors).toHaveLength(1);
  });

  it('gives no tick labeler without a tickFormat, and one that rethrows after reporting', () => {
    expect(createTimeTickLabel({ kind: 'time', timeZone: 'UTC', locale: 'en-US' })).toBeNull();
    const errors: unknown[] = [];
    const label = createTimeTickLabel({ kind: 'time', timeZone: 'UTC', locale: 'en-US', format: () => { throw new Error('t'); }, onError: e => errors.push(e) });
    expect(() => label!(FEB24)).toThrow('t');
    expect(() => label!(FEB24)).toThrow('t');
    expect(errors).toHaveLength(1);
  });
});
