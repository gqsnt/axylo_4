import { expect, it } from 'vitest';
import { at, chart, codes, committed, expectCompact, lastModel, marks, seriesRows } from './model';

for (const type of ['line', 'area', 'bar', 'scatter', 'compact'] as const) {
  it(`F9 ${type}: six and eight series have distinct paint bindings; twelve retain distinct painted cues and raise AX130`, () => {
    for (const size of [6, 8, 12]) {
      const r = chart(type, seriesRows(size), { series: 's' });
      r.frames();
      expect(codes(r).includes('AX130')).toBe(size > 8);
      const cues = type === 'bar' ? marks(r, 'rects').filter(mark => mark.variant === 'bar').map(mark => [mark.fill, mark.pattern ?? 'none'])
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
  });
}
