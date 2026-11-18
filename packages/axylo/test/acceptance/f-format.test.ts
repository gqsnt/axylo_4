import { expect, it } from 'vitest';
import { chart, codes, committed, compactKinds, expectCompact, lastModel, marks, reading, rows, types, walk } from './model';

const examples = [
  ['en-US', '123,456.75', '0.000123456', '0.3'],
  ['de-DE', '123.456,75', '0,000123456', '0,3'],
  ['en-IN', '1,23,456.75', '0.000123456', '0.3'],
] as const;

for (const type of types) {
  it(`F6 ${type}: localized readouts keep the full integer and six significant fraction digits, with the unit`, () => {
    for (const kind of compactKinds(type)) {
      for (const [locale, large, small, sum] of examples) {
        const field = { field: 'y', unit: 'ms' };
        const r = chart(type, [
          { x: type === 'donut' ? 'A' : 1, y: 123456.75 },
          { x: type === 'donut' ? 'B' : 2, y: 0.000123456321 },
          { x: type === 'donut' ? 'C' : 3, y: 0.1 + 0.2 },
        ], { [type === 'donut' ? 'value' : 'y']: field }, { locale }, kind);
        r.frames();
        const expected = [large, small, sum].map(value => value + ' ms');
        expect(codes(r)).toEqual([]);
        expect(lastModel(r).summary).toContain(expected[0]);
        expect(lastModel(r).summary).toContain(expected[1]);
        expect(lastModel(r).summary).toContain(expected[2]);
        expect(lastModel(r).note).toBeNull();
        if (type === 'compact') expectCompact(r);
        else {
          expect(rows(r).map(row => row[type === 'scatter' ? 2 : 1])).toEqual(expected);
          const { lookup } = committed(r);
          walk(r).forEach((ref, i) => {
            const target = ref.kind === 'aligned' ? { kind: 'x' as const, x: ref.x }
              : ref.kind === 'point' ? { kind: 'point' as const, refs: [ref], count: 1 } : ref;
            expect(lookup.tooltip(target).rows[0]?.value).toBe(expected[i]);
            expect(reading(r, ref)).toContain(expected[i]);
          });
        }
        const mark = type === 'donut' ? 'arcs' : type === 'scatter' ? 'points' : (type === 'compact' ? kind : type) === 'bar' ? 'rects' : 'path';
        expect(marks(r, mark)).toHaveLength(1);
      }
    }
  });

  it(`F6 ${type}: a throwing value formatter falls back for reader text and preserves drawn marks`, () => {
    for (const kind of compactKinds(type)) {
      const r = chart(type, [{ x: type === 'donut' ? 'A' : 1, y: 123456.75 }, { x: type === 'donut' ? 'B' : 2, y: 20 }], {
        [type === 'donut' ? 'value' : 'y']: { field: 'y', unit: 'ms', format() { throw new Error('formatter fixture'); } },
      }, undefined, kind);
      r.frames();
      expect(lastModel(r).summary).toContain('123,456.75 ms');
      if (type === 'compact') expectCompact(r);
      else {
        expect(rows(r)[0]?.[type === 'scatter' ? 2 : 1]).toBe('123,456.75 ms');
        expect(reading(r, walk(r)[0]!)).toContain('123,456.75 ms');
      }
      expect(codes(r)).toEqual(['AX160']);
      const mark = type === 'donut' ? 'arcs' : type === 'scatter' ? 'points' : (type === 'compact' ? kind : type) === 'bar' ? 'rects' : 'path';
      expect(marks(r, mark)).toHaveLength(1);
    }
  });
}

for (const type of ['line', 'area', 'bar', 'scatter'] as const) {
  it(`F6 ${type}: compact ticks and full readouts use separate formatters`, () => {
    const r = chart(type, [{ x: 1, y: 50_000 }, { x: 2, y: 100_000 }], {
      y: { field: 'y', unit: 'ms', domain: [0, 100_000], tickFormat: { notation: 'compact' } },
    });
    r.frames();
    const ticks = r.texts.at(-1)?.filter(text => text.role === 'tick-y').map(text => text.full);
    expect(ticks).toContain('100K');
    expect(rows(r).map(row => row[type === 'scatter' ? 2 : 1])).toEqual(['50,000 ms', '100,000 ms']);
    expect(reading(r, walk(r).at(-1)!)).toContain('100,000 ms');
  });
}

it('F6 donut: percentage text is independently localized in tooltip and table', () => {
  const r = chart('donut', [{ x: 'A', y: 1 }, { x: 'B', y: 7 }], {}, { locale: 'de-DE' });
  r.frames();
  const first = walk(r)[0]!;
  if (first.kind !== 'slice') throw new Error('Expected a slice');
  const percent = committed(r).lookup.tooltip(first).rows[0]?.percent;
  expect(percent?.replaceAll('\u00a0', ' ')).toBe('12,5 %');
  expect(rows(r)[0]?.[2]?.replaceAll('\u00a0', ' ')).toBe('12,5 %');
  expect(reading(r, first)?.replaceAll('\u00a0', ' ')).toContain('12,5 %');
});

for (const type of ['line', 'area', 'bar', 'scatter', 'compact'] as const) {
  it(`F6 ${type}: dates in the summary, table and readouts follow the locale with the same calendar day`, () => {
    for (const kind of compactKinds(type)) {
      for (const [locale, expected] of [['en-US', 'Feb 29, 2024'], ['de-DE', '29. Feb. 2024'], ['en-IN', '29 Feb 2024']]) {
        const r = chart(type, [{ x: '2024-02-29', y: 18 }, { x: '2024-03-01', y: 20 }], {}, { locale, timeZone: 'Asia/Kolkata' }, kind);
        r.frames();
        expect(lastModel(r).summary).toContain(expected);
        if (type === 'compact') expectCompact(r);
        else {
          const ref = walk(r)[0]!;
          const target = ref.kind === 'aligned' ? { kind: 'x' as const, x: ref.x } : { kind: 'point' as const, refs: [ref], count: 1 };
          expect(committed(r).lookup.tooltip(target).title).toBe(expected);
          expect(rows(r)[0]?.[0]).toBe(expected);
          expect(reading(r, ref)).toContain(expected);
        }
      }
    }
  });
}

it('F6 line: a zoned instant uses the German page locale while the axis names the viewer zone', () => {
  // 00:00Z is 05:30 in Kolkata. German formats that time with a 24-hour clock.
  const r = chart('line', [{ x: '2024-02-29T00:00Z', y: 3 }, { x: '2024-02-29T01:00Z', y: 4 }], {}, {
    locale: 'de-DE', timeZone: 'Asia/Kolkata',
  });
  r.frames();
  const text = '29. Feb. 2024, 05:30 GMT+5:30';
  const ref = walk(r)[0]!;
  expect(ref.kind).toBe('aligned');
  if (ref.kind !== 'aligned') throw new Error('Expected an aligned instant');
  expect(committed(r).lookup.tooltip({ kind: 'x', x: ref.x }).title).toBe(text);
  expect(rows(r)[0]?.[0]).toBe(text);
  expect(reading(r, ref)).toContain(text);
  expect(lastModel(r).summary).toContain(text);
});
