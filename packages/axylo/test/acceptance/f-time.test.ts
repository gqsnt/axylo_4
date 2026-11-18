import { expect, it } from 'vitest';
import { at, axes, chart, codes, committed, expectCompact, lastModel, marks, pixel, points, reading, rows, walk, type Type } from './model';

const zones = ['UTC', 'America/Los_Angeles', 'Asia/Kolkata'] as const;
const instant = Date.UTC(2024, 1, 29);
const following = Date.UTC(2024, 2, 1);
const dates = ['2024-02-29', '2024-03-01'];
const instants = [
  ['Feb 29, 2024, 12:00 AM UTC', 'Mar 1, 2024, 12:00 AM UTC'],
  ['Feb 28, 2024, 4:00 PM PST', 'Feb 29, 2024, 4:00 PM PST'],
  ['Feb 29, 2024, 5:30 AM GMT+5:30', 'Mar 1, 2024, 5:30 AM GMT+5:30'],
] as const;

function check(r: ReturnType<typeof chart>, type: Type, positions: readonly number[], text: readonly string[]) {
  const x = axes(r).x;
  expect(x.type).toBe('time');
  const pixels = positions.map(value => pixel(x, value));
  const actual = type === 'bar'
    ? [0, 4].map(i => marks(r, 'rects')[0]!.xywh[i]! + marks(r, 'rects')[0]!.xywh[i + 2]! / 2)
    : points(type === 'scatter' ? marks(r, 'points')[0]!.xy : marks(r, 'path')[0]!.xy).map(p => p[0]);
  expect(actual).toHaveLength(pixels.length);
  pixels.forEach((expected, i) => expect(actual[i]).toBeCloseTo(expected, 3));
  text.forEach(heading => expect(lastModel(r).summary).toContain(heading));
  expect(lastModel(r).note ?? '').not.toMatch(/values (not shown|shown differently)/i);
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
    for (const timeZone of zones) {
      const r = chart(type, dates.map((x, i) => ({ x, y: i + 2 })), { x: { field: 'x', timeZone } });
      r.frames();
      check(r, type, [instant, following], ['Feb 29, 2024', 'Mar 1, 2024']);
      expect(codes(r)).toEqual([]);
      expect(lastModel(r).summary).not.toContain(timeZone);
    }
    for (const [values, expected, positions] of [
      [['2024-02', '2024-03'], ['Feb 2024', 'Mar 2024'], [Date.UTC(2024, 1, 1), Date.UTC(2024, 2, 1)]],
      [['2024', '2025'], ['2024', '2025'], [Date.UTC(2024, 0, 1), Date.UTC(2025, 0, 1)]],
    ] as const) {
      const r = chart(type, values.map((x, i) => ({ x, y: i + 2 })), { x: { field: 'x', timeZone: zones[1] } });
      r.frames();
      check(r, type, positions, expected);
    }
  });

  for (const form of ['ISO with offset', 'Date objects', 'declared epoch milliseconds'] as const) {
    it(`F4 ${type}: ${form} read in three local times, name the zone and raise AX111 for whole days (reading: Intl zone aliases name the same zone)`, () => {
      const values = form === 'ISO with offset' ? ['2024-02-29T05:30:00+05:30', '2024-03-01T00:00:00Z']
        : form === 'Date objects' ? [new Date(instant), new Date(following)] : [instant, following];
      zones.forEach((timeZone, i) => {
        const r = chart(type, values.map((x, i) => ({ x, y: i + 2 })), {
          x: { field: 'x', timeZone, type: form === 'declared epoch milliseconds' ? 'time' : undefined },
        }, { container: { width: 1600, height: 400 } });
        r.frames();
        expect(codes(r).filter(code => code !== 'AX143')).toEqual(['AX111']);
        check(r, type, [instant, following], instants[i]!);
        expect(lastModel(r).summary).toContain('Times are shown in ' + new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone + '.');
      });
    });
  }

  it(`F4 ${type}: DST spring skips an hour and fall repeats it with distinct zone abbreviations`, () => {
    for (const [a, b, expected] of [
      [Date.UTC(2024, 2, 10, 9, 30), Date.UTC(2024, 2, 10, 10, 30), ['Mar 10, 2024, 1:30 AM PST', 'Mar 10, 2024, 3:30 AM PDT']],
      [Date.UTC(2024, 10, 3, 8, 30), Date.UTC(2024, 10, 3, 9, 30), ['Nov 3, 2024, 1:30 AM PDT', 'Nov 3, 2024, 1:30 AM PST']],
    ] as const) {
      const r = chart(type, [{ x: a, y: 3 }, { x: b, y: 4 }], { x: { field: 'x', type: 'time', timeZone: zones[1] } });
      r.frames();
      check(r, type, [a, b], expected);
    }
  });

  it(`F4 ${type}: wall-clock input stays as written through a DST transition and raises AX112`, () => {
    const a = Date.UTC(2024, 2, 10, 2, 30);
    const b = Date.UTC(2024, 2, 10, 3, 30);
    const r = chart(type, [{ x: '2024-03-10T02:30', y: 3 }, { x: '2024-03-10T03:30', y: 4 }], { x: { field: 'x', timeZone: zones[1] } });
    r.frames();
    expect(codes(r)).toEqual(['AX112']);
    check(r, type, [a, b], ['Mar 10, 2024, 2:30 AM', 'Mar 10, 2024, 3:30 AM']);
    expect(lastModel(r).summary).not.toContain(zones[1]);
  });

  it(`F4 ${type}: an impossible date is omitted, and bare epoch-like numbers remain numbers`, () => {
    const bad = chart(type, [{ x: dates[0], y: 3 }, { x: '2024-02-30', y: 99 }, { x: dates[1], y: 4 }], { x: { field: 'x', type: 'date' } });
    bad.frames();
    expect(codes(bad)).toEqual(['AX107']);
    expect(lastModel(bad).summary).toContain('maximum 4');
    expect(lastModel(bad).summary).toContain('Values not shown: 1.');
    if (type !== 'compact') expect(rows(bad).map(row => row[0])).toEqual(['Feb 29, 2024', 'Mar 1, 2024']);
    const bare = chart(type, [{ x: instant, y: 3 }, { x: following, y: 4 }]);
    bare.frames();
    expect(codes(bare)).toEqual(['AX109']);
    expect(axes(bare).x.type).toBe('linear');
    expect(lastModel(bare).summary).toContain('1,709,164,800,000');
    if (type !== 'compact') expect(rows(bare)[0]?.[0]).toBe('1,709,164,800,000');
  });
}

for (const type of ['line', 'area', 'bar', 'scatter', 'compact'] as const) {
  it(`F4 ${type}: declaring an instant column as date keeps its UTC calendar dates in every zone`, () => {
    for (const timeZone of zones) {
      const r = chart(type, [
        { x: new Date(instant), y: 3 }, { x: following, y: 4 },
      ], { x: { field: 'x', type: 'date', timeZone } });
      r.frames();
      expect(codes(r)).toEqual([]);
      check(r, type, [instant, following], ['Feb 29, 2024', 'Mar 1, 2024']);
    }
  });

  it(`F4 ${type}: mixing calendar dates with a wall time and an instant reports both incompatible rows (reading: a clear majority fixes the axis type)`, () => {
    const r = chart(type, [
      { x: '2024-02-29', y: 3 }, { x: '2024-03-01T02:30', y: 40 },
      { x: '2024-02-29T16:00Z', y: 50 }, { x: '2024-03-01', y: 4 },
    ]);
    r.frames();
    expect(r.controller.handle.diagnostics).toMatchObject([{ code: 'AX107', field: 'x', rows: [1, 2] }]);
    expect(lastModel(r).summary).toContain('maximum 4');
    expect(lastModel(r).summary).toContain('Values not shown: 2.');
    if (type !== 'compact') expect(rows(r).map(row => row[0])).toEqual(['Feb 29, 2024', 'Mar 1, 2024']);
  });
}
