import { expect, it } from 'vitest';
import { aligned, at, axes, chart, codes, committed, expectCompact, expectGeometry, lastModel, marks, pathRuns, points, reading, rows, walk } from './model';

for (const type of ['line', 'area', 'scatter', 'compact'] as const) {
  it(`F11 ${type}: shuffled observations draw in ascending x and the last value belongs to the largest x`, () => {
    const sorted = [{ x: 1, y: 8 }, { x: 2, y: 5 }, { x: 3, y: 9 }];
    const r = chart(type, [sorted[2], sorted[0], sorted[1]]);
    r.frames();
    const { x, y } = axes(r);
    if (x.type === 'band') throw new Error('Expected numeric x');
    const vertices = type === 'scatter' ? points(marks(r, 'points')[0]!.xy) : pathRuns(marks(r, 'path')[0]!.xy)[0]!;
    expectGeometry(vertices.flat(), [x.map(1), y.map(8), x.map(2), y.map(5), x.map(3), y.map(9)]);
    if (type === 'area') expectGeometry(Array.from(marks(r, 'area')[0]!.upper), vertices.flat());
    expect(lastModel(r).summary).toContain('minimum 5, maximum 9, last 9');
    expect(lastModel(r).note).toBeNull();
    if (type === 'compact') expectCompact(r);
    else {
      expect(rows(r).map(row => [row[0], row[type === 'scatter' ? 2 : 1]])).toEqual([['1', '8'], ['2', '5'], ['3', '9']]);
      const { lookup } = committed(r);
      expect(walk(r).map(ref => lookup.datum(ref)?.row)).toEqual([1, 2, 0]);
      const last = lookup.step(null, 'first');
      expect(reading(r, last!)).toContain('8');
    }
  });
}

for (const type of [...aligned, 'compact'] as const) {
  const variants = type === 'compact' ? aligned : [type];
  for (const kind of variants) {
    it(`F11 ${type}: duplicate x disables just the affected ${kind} series and the model identifies that series`, () => {
      const r = chart(type, [
        { x: 1, y: 8, s: 'Keep' }, { x: 2, y: 5, s: 'Keep' },
        { x: 1, y: 9, s: 'Duplicate' }, { x: 1, y: 10, s: 'Duplicate' },
      ], { series: 's' }, undefined, kind);
      r.frames();
      expect(codes(r)).toContain('AX108');
      expect(r.controller.handle.diagnostics.find(d => d.code === 'AX108')).toMatchObject({ level: 'error', field: 'x', rows: [3] });
      const drawn = [...marks(r, 'path'), ...marks(r, 'area'), ...marks(r, 'rects'), ...marks(r, 'points')];
      expect(drawn.length).toBeGreaterThan(0);
      expect(new Set(drawn.map(mark => mark.series))).toEqual(new Set([0]));
      expect(lastModel(r).summary).toMatch(/Duplicate .*could not be drawn|Duplicate could not be drawn/);
      if (type === 'compact') expectCompact(r);
      else {
        expect(at(r, 1).rows.map(row => row.seriesLabel)).toEqual(['Keep']);
        expect(committed(r).reader.table?.headers).toContain('Duplicate');
        expect(reading(r, walk(r)[0]!)).toContain('Keep 8');
      }
    });
  }
}

it('F11 scatter: equal x and coincident coordinates are all drawn, with x then y order and original row provenance', () => {
  const r = chart('scatter', [{ x: 2, y: 5 }, { x: 1, y: 7 }, { x: 1, y: 3 }, { x: 1, y: 3 }]);
  r.frames();
  expect(codes(r)).toEqual([]);
  const { x, y } = axes(r);
  if (x.type === 'band') throw new Error('Expected numeric x');
  expectGeometry(Array.from(marks(r, 'points')[0]!.xy), [x.map(1), y.map(3), x.map(1), y.map(3), x.map(1), y.map(7), x.map(2), y.map(5)]);
  const { lookup } = committed(r);
  const target = lookup.pick(x.map(1), y.map(3))!;
  expect(lookup.tooltip(target).rows.map(row => row.row).sort()).toEqual([2, 3]);
  expect(rows(r).map(row => [row[0], row[2]])).toEqual([['1', '3'], ['1', '3'], ['1', '7'], ['2', '5']]);
  expect(reading(r, walk(r)[0]!)).toContain('3');
  expect(lastModel(r).summary).toContain('minimum 3, maximum 7, last 5');
});
