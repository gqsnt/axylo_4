import fc from 'fast-check';
import { expect, it } from 'vitest';
import { aligned, at, axes, chart, codes, committed, date, expectCompact, expectGeometry, expectValues, lastModel, marks, pathRuns, pixel, points, reading, rows, walk } from './model';

const observations = [
  { x: '2024-02-24', y: 6 },
  { x: '2024-02-25', y: 8 },
  { x: '2024-02-26', y: null },
  { x: '2024-02-27', y: 5 },
  { x: '2024-02-28' },
  { x: '2024-03-01', y: 0 },
  { x: '2024-03-02', y: 7 },
];

for (const kind of aligned) {
  for (const compact of [false, true]) {
    const type = compact ? 'compact' : kind;
    it(`F2 ${type}: ${kind} distinguishes null, absent field, absent date and zero in geometry and reader text`, () => {
      const r = chart(type, observations, {}, undefined, kind);
      r.frames();
      expect(codes(r).sort()).toEqual(['AX102', 'AX105']);
      const { x, y } = axes(r);
      if (kind === 'bar') {
        const [filled, missing] = marks(r, 'rects');
        expect(filled?.variant).toBe('bar');
        expect(missing?.variant).toBe('missing');
        expect(filled?.xywh).toHaveLength(5 * 4);
        expect(missing?.xywh).toHaveLength(3 * 4);
        expectGeometry([filled!.xywh[13]!, filled!.xywh[15]!], [y.map(0), 0]);
        const missingCenters = [0, 4, 8].map(i => missing!.xywh[i]! + missing!.xywh[i + 2]! / 2);
        expectGeometry(missingCenters, [2, 4, 5].map(i => pixel(x, date(i))));
        expectGeometry([1, 5, 9].map(i => missing!.xywh[i]!), [y.map(0), y.map(0), y.map(0)]);
      } else {
        const expectedRuns = [[0, 1], [6, 7]];
        const stroke = marks(r, 'path')[0]!;
        expect(pathRuns(stroke.xy)).toHaveLength(expectedRuns.length);
        pathRuns(stroke.xy).forEach((run, i) => expectGeometry(run.map(p => p[0]), expectedRuns[i]!.map(j => pixel(x, date(j)))));
        expect(marks(r, 'points').flatMap(mark => points(mark.xy)).some(p => Math.abs(p[0] - pixel(x, date(3))) < 0.001)).toBe(true);
        if (kind === 'area') {
          const area = marks(r, 'area')[0]!;
          expect(Array.from(area.runs).filter((_, i) => i % 4 === 1)).toEqual([2, 2]);
        }
      }
      expect(lastModel(r).summary).toContain('minimum 0, maximum 8, last 7');
      expect(lastModel(r).summary).toContain('Values not shown: 1.');
      if (compact) expectCompact(r);
      else {
        expect(lastModel(r).note).toBe('Values not shown: 1. See table.');
        const values = ['6', '8', 'No data', '5', 'No data', 'No data', '0', '7'];
        expect(rows(r).map(row => row[1])).toEqual(values);
        values.forEach((value, i) => expectValues(r, date(i), [value]));
      }
    });

    it(`F2 ${type}: ${kind} missing zero makes the requested count gaps ordinary zero values`, () => {
      const r = chart(type, observations, { y: { field: 'y', missing: 'zero' } }, undefined, kind);
      r.frames();
      expect(lastModel(r).summary).toContain('minimum 0, maximum 8, last 7');
      const { y } = axes(r);
      if (kind === 'bar') {
        const bars = marks(r, 'rects');
        expect(bars).toHaveLength(1);
        expect(bars[0]?.xywh).toHaveLength(32);
        expectGeometry([2, 4, 5, 6].map(i => bars[0]!.xywh[4 * i + 3]!), [0, 0, 0, 0]);
      } else {
        const runs = pathRuns(marks(r, 'path')[0]!.xy);
        expect(runs.map(run => run.length)).toEqual([8]);
        expectGeometry([2, 4, 5, 6].map(i => runs[0]![i]![1]), [y.map(0), y.map(0), y.map(0), y.map(0)]);
      }
      expect(lastModel(r).summary).toContain('Values shown differently from the data: 1.');
      if (compact) expectCompact(r);
      else {
        expect(lastModel(r).note).toBe('Values shown differently from the data: 1. See table.');
        expect(rows(r).map(row => row[1])).toEqual(['6', '8', '0', '5', '0', '0', '0', '7']);
        for (const i of [2, 4, 5, 6]) expectValues(r, date(i), ['0']);
      }
    });
  }
}

for (const type of ['line', 'area', 'compact'] as const) {
  it(`F2 ${type}: for any generated missing index no stroke or fill run bridges it`, () => {
    fc.assert(fc.property(fc.array(fc.option(fc.integer({ min: -8, max: 8 }), { nil: null }), { minLength: 3, maxLength: 14 }), values => {
      const r = chart(type, values.map((y, x) => ({ x, y })), { x: { field: 'x', type: 'number' } }, undefined, type === 'compact' ? 'area' : 'line');
      r.frames();
      if (values.every(value => value === null)) {
        expect(marks(r, 'path')).toEqual([]);
        return;
      }
      const { x } = axes(r);
      const indexes = (run: [number, number][]) => {
        if (x.type === 'band') throw new Error('Expected a numeric x axis');
        return run.map(([px]) => Math.round(x.invert(px)));
      };
      const strokes = marks(r, 'path').flatMap(mark => pathRuns(mark.xy));
      const fills = marks(r, 'area').flatMap(mark => {
        const vertices = points(mark.upper);
        return Array.from({ length: mark.runs.length / 4 }, (_, run) => {
          const start = mark.runs[run * 4]!;
          return vertices.slice(start, start + mark.runs[run * 4 + 1]!);
        });
      });
      for (const run of [...strokes, ...fills].map(indexes)) {
        expect(values.slice(run[0]!, run.at(-1)! + 1)).not.toContain(null);
      }
    }), { numRuns: 1_000 });
  });
}

it('F2 line: deleted daily rows and explicit nulls leave the same seven-day break', () => {
  const data = Array.from({ length: 12 }, (_, i) => ({ x: new Date(date(i)).toISOString().slice(0, 10), y: i >= 2 && i <= 8 ? null : i }));
  const explicit = chart('line', data);
  const deleted = chart('line', data.filter(row => row.y !== null));
  explicit.frames();
  deleted.frames();
  expect(codes(explicit)).toEqual([]);
  expect(codes(deleted)).toContain('AX105');
  expect(pathRuns(marks(deleted, 'path')[0]!.xy).map(run => run.length)).toEqual([2, 3]);
  expect(marks(deleted, 'path')[0]?.xy).toEqual(marks(explicit, 'path')[0]?.xy);
  expect(rows(deleted)).toEqual(rows(explicit));
  expect(at(deleted, date(5)).rows[0]?.value).toBe('No data');
});

const scatter = [{ x: 1, y: 4 }, { x: 2, y: null }, { x: 3 }, { x: 4, y: 0 }];

it('F2 scatter: gaps are unplotted, zero is readable and the table says No data (reading: the table keeps omitted observations)', () => {
  const r = chart('scatter', scatter);
  r.frames();
  expect(marks(r, 'points')[0]?.xy).toHaveLength(4);
  const refs = walk(r);
  const { lookup } = committed(r);
  expect(refs.map(ref => lookup.datum(ref)?.value)).toEqual(['4', '0']);
  expect(reading(r, refs[1]!)).toContain('0');
  expect(lastModel(r).summary).toContain('minimum 0, maximum 4, last 0');
  expect(rows(r).map(row => row[2])).toEqual(['4', 'No data', 'No data', '0']);
});

it('F2 scatter: missing zero draws two imputed zero points and exposes all four observations', () => {
  const r = chart('scatter', scatter, { y: { field: 'y', missing: 'zero' } });
  r.frames();
  expect(marks(r, 'points')[0]?.xy).toHaveLength(8);
  const refs = walk(r);
  const { lookup } = committed(r);
  expect(refs.map(ref => lookup.datum(ref)?.value)).toEqual(['4', '0', '0', '0']);
  expect(rows(r).map(row => row[2])).toEqual(['4', '0', '0', '0']);
  refs.slice(1).forEach(ref => expect(reading(r, ref)).toContain('0'));
});

it('F2 donut: null and absent slices have no arc and read No data; a real zero reads 0', () => {
  const r = chart('donut', [{ x: 'A', y: 5 }, { x: 'B', y: null }, { x: 'C' }, { x: 'D', y: 0 }]);
  r.frames();
  expect(codes(r)).toEqual(['AX102']);
  expect(marks(r, 'arcs')[0]?.angles).toHaveLength(2);
  const refs = walk(r);
  expect(refs).toHaveLength(4);
  expect(rows(r).map(row => row[1])).toEqual(['5', 'No data', 'No data', '0']);
  refs.forEach((ref, i) => expect(reading(r, ref)).toContain(['5', 'No data', 'No data', '0'][i]!));
  expect(lastModel(r).summary).toContain('Total 5');
  expect(lastModel(r).note).toBe('Values not shown: 1. See table.');
});

it('F2 bar: horizontal missing marks sit at zero and real zero is a zero-width bar', () => {
  const r = chart('bar', [{ x: 'Valid', y: 8 }, { x: 'None', y: null }, { x: 'Zero', y: 0 }], { horizontal: true });
  r.frames();
  const { y } = axes(r);
  const filled = marks(r, 'rects').find(mark => mark.variant === 'bar')!;
  const missing = marks(r, 'rects').find(mark => mark.variant === 'missing')!;
  expect(filled.xywh).toHaveLength(8);
  expect(missing.xywh).toHaveLength(4);
  expectGeometry([filled.xywh[4]!, filled.xywh[6]!, missing.xywh[0]!, missing.xywh[2]!], [y.map(0), 0, y.map(0), 0]);
  expectValues(r, 1, ['No data']);
  expectValues(r, 2, ['0']);
  expect(rows(r)).toEqual([['Valid', '8'], ['None', 'No data'], ['Zero', '0']]);
});

it('F2 donut: missing zero makes null and absent counts readable as zero without drawing their arcs', () => {
  const r = chart('donut', [{ x: 'A', y: 6 }, { x: 'B', y: null }, { x: 'C' }, { x: 'D', y: 0 }], {
    value: { field: 'y', missing: 'zero' },
  });
  r.frames();
  expect(codes(r)).toEqual(['AX102']);
  expect(marks(r, 'arcs')[0]?.angles).toHaveLength(2);
  const { lookup } = committed(r);
  const zeros = walk(r).slice(1);
  expect(zeros).toHaveLength(3);
  for (const ref of zeros) {
    if (ref.kind !== 'slice') throw new Error('Expected a slice');
    expect(lookup.tooltip(ref).rows[0]).toMatchObject({ value: '0', percent: '0%' });
    expect(reading(r, ref)).toContain('0 (0%)');
  }
  expect(rows(r).map(row => row[1])).toEqual(['6', '0', '0', '0']);
  expect(lastModel(r).summary).toContain('Total 6');
});
