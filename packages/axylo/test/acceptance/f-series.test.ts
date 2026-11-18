import fc from 'fast-check';
import { expect, it } from 'vitest';
import { at, chart, codes, committed, compactKinds, expectCompact, lastModel, marks, seriesRows } from './model';

for (const type of ['line', 'area', 'bar', 'scatter', 'compact'] as const) {
  it(`F9 ${type}: six and eight series have distinct paint bindings; twelve retain distinct painted cues and raise AX130`, () => {
    for (const kind of compactKinds(type)) {
      for (const size of [6, 8, 12]) {
        const r = chart(type, seriesRows(size), { series: 's' }, undefined, kind);
        r.frames();
        expect(codes(r).includes('AX130')).toBe(size > 8);
        const cues = (type === 'bar' || type === 'compact' && kind === 'bar') ? marks(r, 'rects').filter(mark => mark.variant === 'bar').map(mark => [mark.fill, mark.pattern ?? 'none'])
          : type === 'scatter' ? marks(r, 'points').map(mark => [mark.fill, mark.shape])
            : marks(r, 'path').map(mark => [mark.stroke, mark.dash.normal]);
        expect(cues).toHaveLength(size);
        const firstEight = cues.slice(0, 8).map(([paint]) => JSON.stringify(paint));
        expect(new Set(firstEight).size).toBe(Math.min(8, size));
        expect(new Set(cues.map(cue => JSON.stringify(cue))).size).toBe(size);
        for (let i = 8; i < size; i++) expect(cues[i]![1]).not.toEqual(cues[i - 8]![1]);
        expect(lastModel(r).summary).toContain(size + ' series');
        expect(lastModel(r).note).toBeNull();
        if (type === 'compact') expectCompact(r);
        else if (type !== 'scatter') {
          expect(at(r, 1).count).toBe(size);
          expect(at(r, 1).rows.map(row => row.seriesLabel)).toEqual(seriesRows(Math.min(size, 8)).filter(row => row.x === 1).map(row => row.s));
          expect(committed(r).reader.table?.headers).toHaveLength(size + 1);
        }
      }
    }
  });
}

it('F9 line: generated series counts beyond eight retain distinguishable cues', () => {
  fc.assert(fc.property(fc.integer({ min: 9, max: 24 }), count => {
    const r = chart('line', seriesRows(count), { series: 's' }, { console: false });
    r.frames();
    expect(codes(r)).toEqual(['AX130']);
    const cues = marks(r, 'path').map(mark => JSON.stringify([mark.stroke, mark.dash.normal]));
    expect(cues).toHaveLength(count);
    expect(new Set(cues).size).toBe(count);
  }), { numRuns: 1_000 });
});
