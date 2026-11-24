import fc from 'fast-check';
import { expect, it } from 'vitest';
import { bandScale } from '../../src/scale/band';
import { coarserDomains, valueDomain } from '../../src/scale/domain';
import { linearScale, linearTickCandidates } from '../../src/scale/linear';
import { niceStepAtLeast } from '../../src/scale/nice';
import { timeTickCandidates } from '../../src/scale/time';
import { MAX_DATE, wallToInstants } from '../../src/scale/zone';

it.each([
  ['America/Los_Angeles', '2026-11-01T08:00Z', 'Nov 1', 'PDT', 'PST'],
  ['America/New_York', '2024-11-03T05:00Z', 'Nov 3', 'EDT', 'EST'],
])('names both occurrences of the first clock tick in %s (F4)', (timeZone, start, date, before, after) => {
  const lo = Date.parse(start);
  const hour = 3_600_000;
  const sets = timeTickCandidates([lo, lo + 2 * hour], { kind: 'time', timeZone, locale: 'en-US' });
  const hourly = sets.find(set => set.length === 3)!;
  expect(hourly.map(t => t.value)).toEqual([lo, lo + hour, lo + 2 * hour]);
  const labels = hourly.map(t => t.label.replace(/\s/g, ' '));
  expect(labels[0]).toContain(date);
  expect(labels[0]).toContain('1:00 AM ' + before);
  expect(labels.slice(1)).toEqual(['1:00 AM ' + after, '2:00 AM']);
});

it('uses positive zero for epoch ticks and for the custom formatter', () => {
  const ticks = timeTickCandidates([-1, 15], {
    kind: 'time', locale: 'en-US', timeZone: 'UTC', label: v => Object.is(v, -0) ? '-0' : String(v),
  }).flat().filter(t => t.value === 0);
  expect(ticks.length).toBeGreaterThan(0);
  for (const t of ticks) expect(t).toEqual({ value: 0, label: '0' });
});

it('only returns representable instants at the ends of the calendar', () => {
  expect(wallToInstants('America/New_York', MAX_DATE)).toEqual([]);
  expect(wallToInstants('Asia/Tokyo', -MAX_DATE)).toEqual([]);
  expect(wallToInstants('UTC', MAX_DATE + 1)).toEqual([]);
  expect(wallToInstants('UTC', -MAX_DATE)).toEqual([-MAX_DATE]);
});

it.each([
  ['Asia/Tokyo', MAX_DATE - 2 * 60_000, MAX_DATE],
  // Los Angeles local mean time was UTC−07:52:58. The first full minute is 58 seconds in.
  ['America/Los_Angeles', -MAX_DATE + 58_000, -MAX_DATE + 178_000],
] as const)('keeps date context on just the first tick outside the wall Date range (%s)', (timeZone, lo, hi) => {
  const ticks = timeTickCandidates([lo, hi], { kind: 'time', timeZone, locale: 'en-US' })
    .find(set => set.length === 3)!;
  const short: Intl.DateTimeFormatOptions = { timeZone, hour: 'numeric', minute: '2-digit' };
  if (lo < 0) short.era = 'short';
  const contextual = new Intl.DateTimeFormat('en-US', { ...short, month: 'short', day: 'numeric' });
  const clock = new Intl.DateTimeFormat('en-US', short);
  expect(ticks.map(t => t.label)).toEqual(ticks.map((t, i) => (i === 0 ? contextual : clock).format(t.value)));
});

it('maps and inverts finite endpoints exactly in either direction', () => {
  const pair = fc.tuple(fc.double({ noNaN: true, noDefaultInfinity: true }),
    fc.double({ noNaN: true, noDefaultInfinity: true })).filter(([a, b]) => a !== b);
  fc.assert(fc.property(pair, pair, (domain, range) => {
    const s = linearScale(domain, range);
    expect(domain.map(s.map)).toEqual(range);
    expect(range.map(s.invert)).toEqual(domain);
  }));
  const scale = linearScale([5, 5], [11.2, 117]);
  expect([scale.invert(-Infinity), scale.invert(Infinity)]).toEqual([5, 5]);
});

it('interpolates and extrapolates through overflowing differences in either direction', () => {
  const big = 2 ** 1023;
  const both = linearScale([-big, big], [big, -big]);
  expect(both.map(big / 2)).toBe(-big / 2);
  expect(both.invert(-big / 2)).toBe(big / 2);
  const domain = linearScale([-big, 0], [0, 16]);
  expect(domain.map(big)).toBe(32);
  expect(domain.invert(32)).toBe(big);
  const range = linearScale([0, 16], [-big, 0]);
  expect(range.invert(big)).toBe(32);
  expect(range.map(32)).toBe(big);
});

it.each([5e24, 5e-23])('keeps an exact decimal extreme %s on the domain boundary (F7)', max => {
  expect(valueDomain({ min: 0, max, includeZero: false }).domain).toEqual([0, max]);
  expect(linearTickCandidates([0, max], String)[0]!.at(-1)!.value).toBe(max);
});

it('never chooses a step smaller than the requested spacing', () => {
  expect(niceStepAtLeast(0.2 + Number.EPSILON).value).toBe(0.5);
  fc.assert(fc.property(fc.double({ min: Number.MIN_VALUE, max: Number.MAX_VALUE, noNaN: true }), x => {
    expect(niceStepAtLeast(x).value).toBeGreaterThanOrEqual(x);
  }));
});

it('keeps small representable domains local and divisible', () => {
  const [lo, hi] = valueDomain({ min: 1e-301, max: 1e-301, includeZero: false }).domain;
  expect(lo).toBeGreaterThan(0);
  expect(lo).toBeLessThan(1e-301);
  expect(hi).toBeGreaterThan(1e-301);
  expect(hi).toBeLessThan(2e-301);
  const [dense] = linearTickCandidates([0, 1e-300], String);
  expect(dense!.map(t => t.value)).toEqual(Array.from({ length: 11 }, (_, i) => Number(`${i}e-301`)));
});

it('offers a single tick when the next nice interval has no multiples inside the domain', () => {
  const sets = linearTickCandidates([6, 9], String);
  expect(sets[0]!.length).toBeGreaterThan(1);
  expect(sets.at(-1)).toHaveLength(1);
  expect(sets.at(-1)![0]!.value).toBeGreaterThanOrEqual(6);
  expect(sets.at(-1)![0]!.value).toBeLessThanOrEqual(9);
});

it('coarsens from the full ratio domain and keeps decimal grid edges exact (F7)', () => {
  expect(coarserDomains(0.31, 0.51, [0.2, 1], true)).toEqual([[0, 1]]);
  expect(coarserDomains(0.96, 0.98, [0.96, 1], true)).toEqual([[0.95, 1]]);
});

it('counts coarser intervals even when their combined width overflows', () => {
  expect(coarserDomains(-4e307, 9e307, [-5e307, 1e308])).toEqual([[-1e308, 1e308]]);
});

it.each([false, true])('places and inverts every band across an overflowing range (reversed %s)', reversed => {
  const big = 2 ** 1023;
  const s = bandScale(4, reversed ? [big, -big] : [-big, big], 0);
  expect(s.bandwidth).toBe(big / 2);
  expect(s.step).toBe(s.bandwidth);
  for (let i = 0; i < 4; i++) {
    const edge = ((reversed ? 3 - i : i) - 2) * (big / 2);
    expect(s.map(i)).toBe(edge);
    expect(s.center(i)).toBe(edge + big / 4);
    expect(s.invert(s.center(i))).toBe(i);
  }
});
