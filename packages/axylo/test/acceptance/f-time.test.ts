import fc from 'fast-check';
import { expect, it } from 'vitest';
import { at, axes, chart, codes, committed, compactKinds, message, expectCompact, lastModel, marks, pixel, points, reading, rows, walk, type Type } from './model';

const zones = ['UTC', 'America/Los_Angeles', 'Asia/Kolkata'] as const;
const instant = Date.UTC(2024, 1, 29);
const following = Date.UTC(2024, 2, 1);
const dates = ['2024-02-29', '2024-03-01'];
const instants = [
  ['Feb 29, 2024, 12:00 AM UTC', 'Mar 1, 2024, 12:00 AM UTC'],
  ['Feb 28, 2024, 4:00 PM PST', 'Feb 29, 2024, 4:00 PM PST'],
  ['Feb 29, 2024, 5:30 AM GMT+5:30', 'Mar 1, 2024, 5:30 AM GMT+5:30'],
] as const;

function check(r: ReturnType<typeof chart>, type: Type, kind: 'line' | 'area' | 'bar', positions: readonly number[], text: readonly string[]) {
  const x = axes(r).x;
  expect(x.type).toBe('time');
  const pixels = positions.map(value => pixel(x, value));
  const actual = (type === 'compact' ? kind : type) === 'bar'
    ? [0, 4].map(i => marks(r, 'rects')[0]!.xywh[i]! + marks(r, 'rects')[0]!.xywh[i + 2]! / 2)
    : points(type === 'scatter' ? marks(r, 'points')[0]!.xy : marks(r, 'path')[0]!.xy).map(p => p[0]);
  expect(actual).toHaveLength(pixels.length);
  pixels.forEach((expected, i) => expect(actual[i]).toBeCloseTo(expected, 3));
  text.forEach(heading => expect(lastModel(r).summary).toContain(heading));
  expect(lastModel(r).note).toBeNull();
  if (type === 'compact') expectCompact(r);
  else {
    expect(rows(r).map(row => row[0]?.replaceAll('\u202f', ' '))).toEqual(text);
    const { lookup } = committed(r);
    walk(r).forEach((ref, i) => {
      const heading = type === 'scatter'
        ? lookup.tooltip({ kind: 'point', refs: [ref], count: 1 }).title
        : at(r, positions[i]!).title;
      expect(heading.replaceAll('\u202f', ' ')).toBe(text[i]);
      expect(reading(r, ref)?.replaceAll('\u202f', ' ')).toContain(text[i]);
    });
  }
}

for (const type of ['line', 'area', 'bar', 'scatter', 'compact'] as const) {
  it(`F4 ${type}: calendar days, months and years keep their input precision across time zones (reading: month and year inputs keep their granularity)`, () => {
    for (const kind of compactKinds(type)) {
      for (const timeZone of zones) {
        for (const [values, expected, positions] of [
          [dates, ['Feb 29, 2024', 'Mar 1, 2024'], [instant, following]],
          [['2024-02', '2024-03'], ['Feb 2024', 'Mar 2024'], [Date.UTC(2024, 1, 1), Date.UTC(2024, 2, 1)]],
          [['2024', '2025'], ['2024', '2025'], [Date.UTC(2024, 0, 1), Date.UTC(2025, 0, 1)]],
        ] as const) {
          const r = chart(type, values.map((x, i) => ({ x, y: i + 2 })), {}, { timeZone }, kind);
          r.frames();
          check(r, type, kind, positions, expected);
          expect(codes(r)).toEqual([]);
          expect(lastModel(r).summary).not.toContain(timeZone);
        }
      }
    }
  });

  for (const form of ['ISO with offset', 'Date objects', 'declared epoch milliseconds'] as const) {
    it(`F4 ${type}: ${form} read in three local times, name the zone and raise AX111 for whole days (reading: Intl zone aliases name the same zone)`, () => {
      for (const kind of compactKinds(type)) {
        const values = form === 'ISO with offset' ? ['2024-02-29T05:30:00+05:30', '2024-03-01T00:00:00Z']
          : form === 'Date objects' ? [new Date(instant), new Date(following)] : [instant, following];
        zones.forEach((timeZone, i) => {
          for (const explicit of [false, true]) {
            const r = chart(type, values.map((x, i) => ({ x, y: i + 2 })), {
              x: { field: 'x', timeZone: explicit ? 'UTC' : undefined, type: form === 'declared epoch milliseconds' ? 'time' : undefined },
            }, { container: { width: 1600, height: 400 }, timeZone }, kind);
            r.frames();
            expect(codes(r)).toEqual(['AX111']);
            check(r, type, kind, [instant, following], instants[explicit ? 0 : i]!);
            const zone = explicit ? 'UTC' : new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone;
            expect(lastModel(r).summary).toContain(message('timeZoneNote', { zone }));
          }
        });
      }
    });
  }

  it(`F4 ${type}: DST spring skips an hour and fall repeats it with distinct zone abbreviations`, () => {
    for (const kind of compactKinds(type)) {
      for (const [a, b, expected] of [
        [Date.UTC(2024, 2, 10, 9, 30), Date.UTC(2024, 2, 10, 10, 30), ['Mar 10, 2024, 1:30 AM PST', 'Mar 10, 2024, 3:30 AM PDT']],
        [Date.UTC(2024, 10, 3, 8, 30), Date.UTC(2024, 10, 3, 9, 30), ['Nov 3, 2024, 1:30 AM PDT', 'Nov 3, 2024, 1:30 AM PST']],
      ] as const) {
        const r = chart(type, [{ x: a, y: 3 }, { x: b, y: 4 }], { x: { field: 'x', type: 'time', timeZone: zones[1] } }, undefined, kind);
        r.frames();
        check(r, type, kind, [a, b], expected);
      }
    }
  });

  it(`F4 ${type}: wall-clock input stays as written through a DST transition and raises AX112`, () => {
    for (const kind of compactKinds(type)) {
      const a = Date.UTC(2024, 2, 10, 2, 30);
      const b = Date.UTC(2024, 2, 10, 3, 30);
      const r = chart(type, [{ x: '2024-03-10T02:30', y: 3 }, { x: '2024-03-10T03:30', y: 4 }], { x: { field: 'x', timeZone: zones[1] } }, undefined, kind);
      r.frames();
      expect(codes(r)).toEqual(['AX112']);
      check(r, type, kind, [a, b], ['Mar 10, 2024, 2:30 AM', 'Mar 10, 2024, 3:30 AM']);
      expect(lastModel(r).summary).not.toContain(zones[1]);
    }
  });

  it(`F4 ${type}: an impossible date is omitted, and bare epoch-like numbers remain numbers`, () => {
    for (const kind of compactKinds(type)) {
      const bad = chart(type, [{ x: dates[0], y: 3 }, { x: '2024-02-30', y: 99 }, { x: dates[1], y: 4 }], { x: { field: 'x', type: 'date' } }, undefined, kind);
      bad.frames();
      expect(codes(bad)).toEqual(['AX107']);
      expect(lastModel(bad).summary).toContain(message('seriesSummary', { series: 'y', min: 3, max: 4, last: 4 }));
      expect(lastModel(bad).summary).toContain('Values not shown: 1.');
      if (type !== 'compact') expect(rows(bad).map(row => row[0])).toEqual(['Feb 29, 2024', 'Mar 1, 2024']);
      const bare = chart(type, [{ x: instant, y: 3 }, { x: following, y: 4 }], {}, undefined, kind);
      bare.frames();
      expect(codes(bare)).toEqual(['AX109']);
      expect(axes(bare).x.type).toBe('linear');
      expect(lastModel(bare).summary).toContain('1,709,164,800,000');
      if (type !== 'compact') expect(rows(bare)[0]?.[0]).toBe('1,709,164,800,000');
    }
  });
}

for (const type of ['line', 'area', 'bar', 'scatter', 'compact'] as const) {
  it(`F4 ${type}: declaring an instant column as date keeps its UTC calendar dates in every zone`, () => {
    for (const kind of compactKinds(type)) {
      for (const timeZone of zones) {
        const r = chart(type, [
          { x: new Date(instant), y: 3 }, { x: following, y: 4 },
        ], { x: { field: 'x', type: 'date' } }, { timeZone }, kind);
        r.frames();
        expect(codes(r)).toEqual([]);
        check(r, type, kind, [instant, following], ['Feb 29, 2024', 'Mar 1, 2024']);
      }
    }
  });

  it(`F4 ${type}: mixing wall-clock times and instants with no calendar date is never silent: the minority rows are reported and not drawn`, () => {
    for (const kind of compactKinds(type)) {
      // Three wall-clock times (no offset) and two instants (with an offset), no calendar date: the majority
      // fixes the axis as wall-clock (AX112), and the two instants cannot be combined with it silently.
      const r = chart(type, [
        { x: '2024-03-01T02:30', y: 1 }, { x: '2024-03-01T04:00', y: 2 }, { x: '2024-03-01T03:00Z', y: 30 },
        { x: '2024-03-01T06:00', y: 3 }, { x: '2024-03-01T05:00+01:00', y: 40 },
      ], {}, { console: false }, kind);
      r.frames();
      const found = r.controller.handle.diagnostics;
      expect(found.map(d => d.code).sort()).toEqual(['AX107', 'AX112']);
      expect(found.find(d => d.code === 'AX107')).toMatchObject({ field: 'x', rows: [2, 4] });
      expect(lastModel(r).summary).toContain(message('seriesSummary', { series: 'y', min: 1, max: 3, last: 3 }));
      expect(lastModel(r).summary).toContain('Values not shown: 2.');
    }
  });

  it(`F4 ${type}: mixing calendar dates with a wall time and an instant reports both incompatible rows (reading: a clear majority fixes the axis type)`, () => {
    for (const kind of compactKinds(type)) {
      const r = chart(type, [
        { x: '2024-02-29', y: 3 }, { x: '2024-03-01T02:30', y: 40 },
        { x: '2024-02-29T16:00Z', y: 50 }, { x: '2024-03-01', y: 4 }, { x: '2024-03-02', y: 4 },
      ], {}, undefined, kind);
      r.frames();
      expect(r.controller.handle.diagnostics).toMatchObject([{ code: 'AX107', field: 'x', rows: [1, 2] }]);
      expect(lastModel(r).summary).toContain(message('seriesSummary', { series: 'y', min: 3, max: 4, last: 4 }));
      expect(lastModel(r).summary).toContain('Values not shown: 2.');
      if (type !== 'compact') expect(rows(r).map(row => row[0])).toEqual(['Feb 29, 2024', 'Mar 1, 2024', 'Mar 2, 2024']);
    }
  });
}

it('F4 line: generated instants around DST and the year boundary preserve elapsed time and local readouts', () => {
  const boundaries = [
    { at: Date.UTC(2024, 2, 10, 10), before: 'Mar 10, 2024, 1', after: 'Mar 10, 2024, 3', firstZone: 'PST', lastZone: 'PDT', meridiem: 'AM' },
    { at: Date.UTC(2024, 10, 3, 9), before: 'Nov 3, 2024, 1', after: 'Nov 3, 2024, 1', firstZone: 'PDT', lastZone: 'PST', meridiem: 'AM' },
    { at: Date.UTC(2025, 0, 1, 8), before: 'Dec 31, 2024, 11', after: 'Jan 1, 2025, 12', firstZone: 'PST', lastZone: 'PST', meridiem: 'PM' },
  ] as const;
  fc.assert(fc.property(fc.constantFrom(...boundaries), fc.integer({ min: 1, max: 59 }), fc.integer({ min: 0, max: 59 }), (boundary, earlier, later) => {
    const a = boundary.at - earlier * 60_000;
    const b = boundary.at + later * 60_000;
    const r = chart('line', [{ x: new Date(b), y: 4 }, { x: new Date(a), y: 3 }], {}, { timeZone: zones[1] });
    r.frames();
    const min = (minutes: number) => String(minutes).padStart(2, '0');
    check(r, 'line', 'line', [a, b], [
      `${boundary.before}:${min(60 - earlier)} ${boundary.meridiem} ${boundary.firstZone}`,
      `${boundary.after}:${min(later)} AM ${boundary.lastZone}`,
    ]);
  }), { numRuns: 1_000 });
});
