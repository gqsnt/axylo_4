import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { instantToWall, utcFields, wallToInstant, wallToInstants, zoneOffset } from '../../src/scale/zone';

const H = 3_600_000;
const M = 60_000;
const LA = 'America/Los_Angeles';
const PARIS = 'Europe/Paris';
const KOLKATA = 'Asia/Kolkata';

// 2026 transitions (published rules, not computed by the code under test):
//  US: second Sunday of March, 2026-03-08 02:00 PST → 03:00 PDT (10:00Z);
//      first Sunday of November, 2026-11-01 02:00 PDT → 01:00 PST (09:00Z).
//  EU: last Sunday of March, 2026-03-29 01:00Z (02:00 CET → 03:00 CEST);
//      last Sunday of October, 2026-10-25 01:00Z (03:00 CEST → 02:00 CET).

describe('zoneOffset', () => {
  it('gives standard and daylight offsets', () => {
    expect(zoneOffset(LA, Date.UTC(2026, 0, 15))).toBe(-8 * H);
    expect(zoneOffset(LA, Date.UTC(2026, 6, 15))).toBe(-7 * H);
    expect(zoneOffset(PARIS, Date.UTC(2026, 0, 15))).toBe(1 * H);
    expect(zoneOffset(PARIS, Date.UTC(2026, 6, 15))).toBe(2 * H);
    expect(zoneOffset('UTC', Date.UTC(2026, 6, 15))).toBe(0);
  });

  it('changes at the exact second of each 2026 transition', () => {
    expect(zoneOffset(LA, Date.UTC(2026, 2, 8, 9, 59, 59, 999))).toBe(-8 * H);
    expect(zoneOffset(LA, Date.UTC(2026, 2, 8, 10))).toBe(-7 * H);
    expect(zoneOffset(LA, Date.UTC(2026, 10, 1, 8, 59, 59, 999))).toBe(-7 * H);
    expect(zoneOffset(LA, Date.UTC(2026, 10, 1, 9))).toBe(-8 * H);
    expect(zoneOffset(PARIS, Date.UTC(2026, 2, 29, 0, 59, 59, 999))).toBe(1 * H);
    expect(zoneOffset(PARIS, Date.UTC(2026, 2, 29, 1))).toBe(2 * H);
    expect(zoneOffset(PARIS, Date.UTC(2026, 9, 25, 0, 59, 59, 999))).toBe(2 * H);
    expect(zoneOffset(PARIS, Date.UTC(2026, 9, 25, 1))).toBe(1 * H);
  });

  it('handles a half-hour zone', () => {
    expect(zoneOffset(KOLKATA, Date.UTC(2026, 0, 1))).toBe(5 * H + 30 * M);
    expect(zoneOffset(KOLKATA, Date.UTC(2026, 6, 1))).toBe(5 * H + 30 * M);
    expect(zoneOffset('Asia/Kathmandu', Date.UTC(2026, 6, 1))).toBe(5 * H + 45 * M);
  });

  it('handles a leap day and years before 100', () => {
    expect(zoneOffset(LA, Date.UTC(2028, 1, 29, 12))).toBe(-8 * H);
    expect(new Date(utcFields(50, 0, 1)).getUTCFullYear()).toBe(50);
  });
});

describe('wallToInstants and wallToInstant', () => {
  it('finds nothing in the Los Angeles spring-forward gap, and moves forward compatibly', () => {
    const wall = Date.UTC(2026, 2, 8, 2, 30);
    expect(wallToInstants(LA, wall)).toEqual([]);
    expect(wallToInstant(LA, wall)).toBe(Date.UTC(2026, 2, 8, 10, 30)); // 03:30 PDT
    expect(wallToInstant(LA, wall, 'later')).toBe(Date.UTC(2026, 2, 8, 10, 30));
    expect(wallToInstant(LA, wall, 'earlier')).toBe(Date.UTC(2026, 2, 8, 9, 30)); // 01:30 PST
  });

  it('finds both instants in the Los Angeles fall-back fold', () => {
    const wall = Date.UTC(2026, 10, 1, 1, 30);
    expect(wallToInstants(LA, wall)).toEqual([Date.UTC(2026, 10, 1, 8, 30), Date.UTC(2026, 10, 1, 9, 30)]);
    expect(wallToInstant(LA, wall)).toBe(Date.UTC(2026, 10, 1, 8, 30));
    expect(wallToInstant(LA, wall, 'later')).toBe(Date.UTC(2026, 10, 1, 9, 30));
  });

  it('handles both Paris transitions', () => {
    expect(wallToInstants(PARIS, Date.UTC(2026, 2, 29, 2, 30))).toEqual([]);
    expect(wallToInstant(PARIS, Date.UTC(2026, 2, 29, 2, 30))).toBe(Date.UTC(2026, 2, 29, 1, 30)); // 03:30 CEST
    expect(wallToInstants(PARIS, Date.UTC(2026, 9, 25, 2, 30))).toEqual([Date.UTC(2026, 9, 25, 0, 30), Date.UTC(2026, 9, 25, 1, 30)]);
  });

  it('maps local midnight in Kolkata to 18:30 UTC the day before', () => {
    expect(wallToInstants(KOLKATA, Date.UTC(2026, 1, 24))).toEqual([Date.UTC(2026, 1, 23, 18, 30)]);
  });

  it('round-trips every instant (property)', () => {
    const zones = fc.constantFrom(LA, PARIS, KOLKATA, 'UTC', 'Australia/Lord_Howe', 'America/Santiago');
    const instants = fc.integer({ min: Date.UTC(2000, 0, 1), max: Date.UTC(2035, 0, 1) });
    fc.assert(
      fc.property(zones, instants, (zone, t) => {
        const wall = instantToWall(zone, t);
        expect(wallToInstants(zone, wall)).toContain(t);
        // Any instant shown at that wall time shows that wall time.
        for (const u of wallToInstants(zone, wall)) expect(instantToWall(zone, u)).toBe(wall);
      }),
      { numRuns: 1000 },
    );
  });
});
