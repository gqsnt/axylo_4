import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { TickCandidates } from '../../src/core/contracts';
import { timeScale, timeTickCandidates, type TimeTickOptions } from '../../src/scale/time';

const H = 3_600_000;
const DAY = 86_400_000;
const LA = 'America/Los_Angeles';
const PARIS = 'Europe/Paris';
const KOLKATA = 'Asia/Kolkata';

// Intl writes a narrow no-break space (U+202F) or a no-break space (U+00A0) before AM/PM and inside some
// dates, depending on the ICU version. The tests normalize both to a plain space; the text is otherwise exact.
const norm = (s: string): string => s.replace(/[  ]/g, ' ');
const labels = (set: readonly { label: string }[] | undefined): string[] => (set ?? []).map(t => norm(t.label));
const values = (set: readonly { value: number }[] | undefined): number[] => (set ?? []).map(t => t.value);

const time = (timeZone: string, locale = 'en-US'): TimeTickOptions => ({ kind: 'time', timeZone, locale });
const date = (dateUnit: 'day' | 'month' | 'year' = 'day', locale = 'en-US'): TimeTickOptions => ({ kind: 'date', locale, dateUnit });

/** The candidate set with exactly n ticks. */
function withCount(sets: TickCandidates, n: number) {
  const set = sets.find(s => s.length === n);
  expect(set, `a set of ${n} ticks among sizes ${sets.map(s => s.length).join(', ')}`).toBeDefined();
  return set!;
}

/** Local fields of an instant, read with Intl directly (independent of the code under test). */
const oracles = new Map<string, Intl.DateTimeFormat>();
function local(timeZone: string, t: number): { ymd: string; hm: string } {
  let dtf = oracles.get(timeZone);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    oracles.set(timeZone, dtf);
  }
  const parts = Object.fromEntries(
    dtf
      .formatToParts(t)
      .map(p => [p.type, p.value]),
  );
  return { ymd: `${parts.year}-${parts.month}-${parts.day}`, hm: `${parts.hour}:${parts.minute}`.replace(/^24/, '00') };
}

describe('timeScale', () => {
  it('is linear in epoch milliseconds', () => {
    const s = timeScale([Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 2)], [0, 240]);
    expect(s.type).toBe('time');
    expect(s.map(Date.UTC(2026, 0, 1, 12))).toBe(120);
    expect(s.invert(60)).toBe(Date.UTC(2026, 0, 1, 6));
  });
});

describe('timeTickCandidates: daylight saving', () => {
  it('puts one tick on each local midnight of a daily Los Angeles series across the March change', () => {
    // Midnight is 08:00Z under PST (to Sunday 8 March) and 07:00Z under PDT (from Monday 9 March).
    const lo = Date.UTC(2026, 2, 5, 8);
    const hi = Date.UTC(2026, 2, 12, 7);
    const days = withCount(timeTickCandidates([lo, hi], time(LA)), 8);
    expect(values(days)).toEqual([
      Date.UTC(2026, 2, 5, 8), Date.UTC(2026, 2, 6, 8), Date.UTC(2026, 2, 7, 8), Date.UTC(2026, 2, 8, 8),
      Date.UTC(2026, 2, 9, 7), Date.UTC(2026, 2, 10, 7), Date.UTC(2026, 2, 11, 7), Date.UTC(2026, 2, 12, 7),
    ]);
    expect(labels(days)).toEqual(['Mar 5, 2026', 'Mar 6', 'Mar 7', 'Mar 8', 'Mar 9', 'Mar 10', 'Mar 11', 'Mar 12']);
  });

  it('puts daily ticks on local midnight across the November change in Los Angeles (a 25-hour day)', () => {
    const lo = Date.UTC(2026, 9, 30, 7); // Oct 30 00:00 PDT
    const hi = Date.UTC(2026, 10, 3, 8); // Nov 3 00:00 PST
    const days = withCount(timeTickCandidates([lo, hi], time(LA)), 5);
    expect(values(days)).toEqual([Date.UTC(2026, 9, 30, 7), Date.UTC(2026, 9, 31, 7), Date.UTC(2026, 10, 1, 7), Date.UTC(2026, 10, 2, 8), Date.UTC(2026, 10, 3, 8)]);
  });

  it('skips the missing hour of the Los Angeles spring-forward night', () => {
    // 00:00 PST to 05:00 PDT: clocks show 0, 1, 3, 4, 5 o'clock, one real hour apart.
    const sets = timeTickCandidates([Date.UTC(2026, 2, 8, 8), Date.UTC(2026, 2, 8, 12)], time(LA));
    const hours = withCount(sets, 5);
    expect(values(hours)).toEqual([8, 9, 10, 11, 12].map(h => Date.UTC(2026, 2, 8, h)));
    expect(labels(hours)).toEqual(['Mar 8, 12:00 AM', '1:00 AM', '3:00 AM', '4:00 AM', '5:00 AM']);
  });

  it('keeps both 1 a.m. ticks of the Los Angeles fall-back night and names their zones', () => {
    const hours = withCount(timeTickCandidates([Date.UTC(2026, 10, 1, 7), Date.UTC(2026, 10, 1, 11)], time(LA)), 5);
    expect(values(hours)).toEqual([7, 8, 9, 10, 11].map(h => Date.UTC(2026, 10, 1, h)));
    expect(labels(hours)).toEqual(['Nov 1, 12:00 AM', '1:00 AM PDT', '1:00 AM PST', '2:00 AM', '3:00 AM']);
  });

  it('handles both Paris transitions', () => {
    // 29 March: 00:00 CET (23:00Z) to 05:00 CEST (03:00Z); 02:00 does not exist.
    const spring = withCount(timeTickCandidates([Date.UTC(2026, 2, 28, 23), Date.UTC(2026, 2, 29, 3)], time(PARIS, 'de-DE')), 5);
    expect(values(spring)).toEqual([Date.UTC(2026, 2, 28, 23), Date.UTC(2026, 2, 29, 0), Date.UTC(2026, 2, 29, 1), Date.UTC(2026, 2, 29, 2), Date.UTC(2026, 2, 29, 3)]);
    // de-DE writes a numeric hour without a leading zero ("0:00"), as Intl.DateTimeFormat does on its own.
    expect(labels(spring)).toEqual(['29. März, 0:00', '1:00', '3:00', '4:00', '5:00']);
    // 25 October: 02:00 CEST (00:00Z) to 04:00 CET (03:00Z); 02:00 happens twice.
    const autumn = withCount(timeTickCandidates([Date.UTC(2026, 9, 25, 0), Date.UTC(2026, 9, 25, 3)], time(PARIS)), 4);
    expect(values(autumn)).toEqual([0, 1, 2, 3].map(h => Date.UTC(2026, 9, 25, h)));
    // Daily ticks across the March change: midnight is 23:00Z before it and 22:00Z after.
    const days = withCount(timeTickCandidates([Date.UTC(2026, 2, 26, 23), Date.UTC(2026, 2, 31, 22)], time(PARIS)), 6);
    expect(values(days)).toEqual([Date.UTC(2026, 2, 26, 23), Date.UTC(2026, 2, 27, 23), Date.UTC(2026, 2, 28, 23), Date.UTC(2026, 2, 29, 22), Date.UTC(2026, 2, 30, 22), Date.UTC(2026, 2, 31, 22)]);
  });
});

describe('timeTickCandidates: zones, calendars and labels', () => {
  it('puts hour ticks on local hours in a half-hour zone', () => {
    // 00:00Z–06:00Z is 05:30–11:30 IST; local hours 06:00..11:00 are at :30 UTC.
    const hours = withCount(timeTickCandidates([Date.UTC(2026, 1, 24, 0), Date.UTC(2026, 1, 24, 6)], time(KOLKATA)), 6);
    expect(values(hours)).toEqual([0, 1, 2, 3, 4, 5].map(h => Date.UTC(2026, 1, 24, h, 30)));
    expect(labels(hours)).toEqual(['Feb 24, 6:00 AM', '7:00 AM', '8:00 AM', '9:00 AM', '10:00 AM', '11:00 AM']);
    // Kolkata midnight is 18:30Z the day before.
    const days = withCount(timeTickCandidates([Date.UTC(2026, 1, 23, 18, 30), Date.UTC(2026, 1, 26, 18, 30)], time(KOLKATA)), 4);
    expect(values(days)).toEqual([23, 24, 25, 26].map(d => Date.UTC(2026, 1, d, 18, 30)));
  });

  it('includes the leap day 2028-02-29', () => {
    const days = withCount(timeTickCandidates([Date.UTC(2028, 1, 26), Date.UTC(2028, 2, 3)], date()), 7);
    expect(values(days)).toEqual([Date.UTC(2028, 1, 26), Date.UTC(2028, 1, 27), Date.UTC(2028, 1, 28), Date.UTC(2028, 1, 29), Date.UTC(2028, 2, 1), Date.UTC(2028, 2, 2), Date.UTC(2028, 2, 3)]);
    expect(labels(days)).toEqual(['Feb 26, 2028', 'Feb 27', 'Feb 28', 'Feb 29', 'Mar 1', 'Mar 2', 'Mar 3']);
  });

  it('puts month ticks on the first of each month across month ends', () => {
    const sets = timeTickCandidates([Date.UTC(2026, 0, 31), Date.UTC(2026, 4, 31)], date());
    expect(values(sets[0])).toEqual([Date.UTC(2026, 1, 1), Date.UTC(2026, 2, 1), Date.UTC(2026, 3, 1), Date.UTC(2026, 4, 1)]);
    expect(labels(sets[0])).toEqual(['Feb 2026', 'Mar', 'Apr', 'May']);
  });

  it('adds the year on the first tick and where the year changes', () => {
    const days = withCount(timeTickCandidates([Date.UTC(2026, 11, 29), Date.UTC(2027, 0, 3)], date()), 6);
    expect(labels(days)).toEqual(['Dec 29, 2026', 'Dec 30', 'Dec 31', 'Jan 1, 2027', 'Jan 2', 'Jan 3']);
    const months = withCount(timeTickCandidates([Date.UTC(2026, 9, 1), Date.UTC(2027, 2, 1)], date('month')), 6);
    expect(labels(months)).toEqual(['Oct 2026', 'Nov', 'Dec', 'Jan 2027', 'Feb', 'Mar']);
  });

  it('adds the date on the first clock tick and where the day changes', () => {
    const hours = withCount(timeTickCandidates([Date.UTC(2026, 1, 24, 18), Date.UTC(2026, 1, 25, 6)], { kind: 'wall', locale: 'en-US' }), 7);
    expect(labels(hours)).toEqual(['Feb 24, 6:00 PM', '8:00 PM', '10:00 PM', 'Feb 25, 12:00 AM', '2:00 AM', '4:00 AM', '6:00 AM']);
  });

  it('labels with the locale, not hand-built English names', () => {
    const days = withCount(timeTickCandidates([Date.UTC(2026, 1, 24), Date.UTC(2026, 1, 27)], date('day', 'de-DE')), 4);
    expect(labels(days)).toEqual(['24. Feb. 2026', '25. Feb.', '26. Feb.', '27. Feb.']);
  });

  it('never goes finer than the date unit', () => {
    // Two months of monthly dates: a day axis would offer weekly ticks, a month axis must not.
    const monthly = timeTickCandidates([Date.UTC(2026, 0, 1), Date.UTC(2026, 2, 1)], date('month'));
    expect(monthly.map(values)).toEqual([
      [Date.UTC(2026, 0, 1), Date.UTC(2026, 1, 1), Date.UTC(2026, 2, 1)],
      [Date.UTC(2026, 0, 1), Date.UTC(2026, 2, 1)],
      [Date.UTC(2026, 0, 1)],
    ]);
    const yearly = timeTickCandidates([Date.UTC(2000, 0, 1), Date.UTC(2026, 0, 1)], date('year'));
    expect(yearly.map(s => labels(s))).toEqual([
      ['2000', '2005', '2010', '2015', '2020', '2025'],
      ['2000', '2010', '2020'],
      ['2000', '2020'],
      ['2000'],
    ]);
  });

  it('uses the author label where given, and the built-in one where it throws', () => {
    const sets = timeTickCandidates([Date.UTC(2026, 1, 24), Date.UTC(2026, 1, 26)], {
      ...date(),
      label: v => {
        if (v === Date.UTC(2026, 1, 25)) throw new Error('boom');
        return `d${new Date(v).getUTCDate()}`;
      },
    });
    expect(labels(sets[0])).toEqual(['d24', 'Feb 25', 'd26']);
  });

  it('gives one tick for an instant domain', () => {
    const sets = timeTickCandidates([Date.UTC(2026, 1, 24, 14), Date.UTC(2026, 1, 24, 14)], time('UTC'));
    expect(sets.map(values)).toEqual([[Date.UTC(2026, 1, 24, 14)]]);
    expect(labels(sets[0])).toEqual(['Feb 24, 2:00 PM']);
  });
});

describe('timeTickCandidates properties', () => {
  const zones = fc.constantFrom(LA, PARIS, KOLKATA, 'UTC');
  const start = fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2030, 0, 1) });

  it('keeps every tick inside the domain, ascending, and the sets densest first', () => {
    // Spans from one second to 40 years, on a log scale so every unit gets exercised.
    const span = fc.double({ min: 0, max: Math.log10(40 * 365 * DAY / 1000), noNaN: true }).map(e => Math.round(1000 * 10 ** e));
    const kind = fc.constantFrom<'time' | 'date' | 'wall'>('time', 'date', 'wall');
    const unit = fc.constantFrom<'day' | 'month' | 'year'>('day', 'month', 'year');
    fc.assert(
      fc.property(start, span, zones, kind, unit, fc.constantFrom('en-US', 'de-DE', 'en-IN'), (lo, width, timeZone, k, dateUnit, locale) => {
        const hi = lo + width;
        const sets = timeTickCandidates([lo, hi], { kind: k, timeZone, locale, dateUnit });
        expect(sets.length).toBeGreaterThan(0);
        expect(sets[0]!.length).toBeLessThanOrEqual(12);
        for (let s = 0; s < sets.length; s++) {
          if (s > 0) expect(sets[s]!.length).toBeLessThan(sets[s - 1]!.length);
          const set = sets[s]!;
          for (let i = 0; i < set.length; i++) {
            expect(set[i]!.value).toBeGreaterThanOrEqual(lo);
            expect(set[i]!.value).toBeLessThanOrEqual(hi);
            if (i > 0) expect(set[i]!.value).toBeGreaterThan(set[i - 1]!.value);
            expect(set[i]!.label.length).toBeGreaterThan(0);
          }
          if (k === 'date' && dateUnit !== 'day' && set.length > 1) {
            // Month and year axes: every tick on the first of a month (of January for years).
            for (const t of set) {
              expect(new Date(t.value).getUTCDate()).toBe(1);
              if (dateUnit === 'year') expect(new Date(t.value).getUTCMonth()).toBe(0);
            }
          }
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('offers a daily set on local midnights for any 2–10 day range in any zone', () => {
    const days = fc.integer({ min: 2, max: 10 });
    fc.assert(
      fc.property(start, days, zones, (lo, n, timeZone) => {
        const hi = lo + n * DAY;
        const sets = timeTickCandidates([lo, hi], time(timeZone));
        // Local midnights in [lo, hi], found by scanning every hour with Intl (whole-hour and half-hour zones only).
        const expected: number[] = [];
        for (let t = Math.ceil(lo / (30 * 60_000)) * 30 * 60_000; t <= hi; t += 30 * 60_000) if (local(timeZone, t).hm === '00:00') expected.push(t);
        const daily = sets.find(s => s.length === expected.length && s.every((tick, i) => tick.value === expected[i]));
        expect(daily, `${timeZone} ${new Date(lo).toISOString()} + ${n} days`).toBeDefined();
        // Consecutive ticks are consecutive calendar days, whatever the length of the day in hours.
        for (let i = 1; i < expected.length; i++) {
          const a = local(timeZone, expected[i - 1]!).ymd;
          const b = local(timeZone, expected[i]!).ymd;
          const next = new Date(Date.parse(`${a}T00:00:00Z`) + DAY).toISOString().slice(0, 10);
          expect(b).toBe(next);
        }
      }),
      { numRuns: 1000 },
    );
  });
});
