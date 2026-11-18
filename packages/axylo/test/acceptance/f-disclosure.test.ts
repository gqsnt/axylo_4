import { expect, it } from 'vitest';
import { at, chart, codes, committed, lastModel, marks, pathRuns, reading, rows, walk } from './model';

for (const type of ['line', 'area', 'bar', 'scatter', 'donut'] as const) {
  it(`F12 ${type}: three bad values leave a three-value note and summary while the chart preserves the good observations`, () => {
    // The Phase 1 dirty fixture specifies the codes and the number of omitted values.
    const values = [10, 20, null, NaN, '40', undefined, 70];
    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const data = values.map((y, i) => ({ x: type === 'scatter' ? i + 1 : weekdays[i]!, y }));
    const r = chart(type, data, { description: 'Collected every day.' });
    r.frames();
    expect(codes(r).sort()).toEqual(['AX102', 'AX103', 'AX106']);
    const note = 'Values not shown: 3. See table.';
    expect(lastModel(r).note).toBe(note);
    expect(lastModel(r).summary).toContain(note);
    expect(lastModel(r).summary).toContain('Collected every day.');
    expect(committed(r).reader.note).toBe(note);
    expect(r.announcements).toEqual([]);
    if (type === 'line' || type === 'area') {
      expect(pathRuns(marks(r, 'path')[0]!.xy).map(run => run.length)).toEqual([2]);
      expect(marks(r, 'points').some(mark => mark.xy.length >= 2)).toBe(true);
    } else if (type === 'bar') {
      expect(marks(r, 'rects').find(mark => mark.variant === 'bar')?.xywh).toHaveLength(12);
      expect(marks(r, 'rects').find(mark => mark.variant === 'missing')?.xywh).toHaveLength(16);
    } else if (type === 'scatter') expect(marks(r, 'points')[0]?.xy).toHaveLength(6);
    else expect(marks(r, 'arcs')[0]?.angles).toHaveLength(6);
    if (type !== 'scatter') {
      expect(rows(r).map(row => row[1])).toEqual(['10', '20', 'No data', 'No data', 'No data', 'No data', '70']);
      if (type !== 'donut') expect(at(r, 4).rows[0]?.value).toBe('No data');
      else expect(reading(r, walk(r)[4]!)).toContain('No data');
    }
    r.controller.handle.update({ data: [{ x: type === 'scatter' ? 1 : 'Mon', y: 10 }, { x: type === 'scatter' ? 2 : 'Tue', y: 20 }] });
    r.frames();
    expect(lastModel(r).note).toBeNull();
    expect(lastModel(r).summary).not.toContain(note);
  });

  it(`F12 ${type}: a throwing formatter discloses changed presentation even though the value is still drawn`, () => {
    const input = [{ x: type === 'donut' ? 'A' : 1, y: 1 }, { x: type === 'donut' ? 'B' : 2, y: 2 }];
    const r = chart(type, input, {
      [type === 'donut' ? 'value' : 'y']: { field: 'y', format: (value: number) => {
        if (value === 2) throw new Error('fixture');
        return String(value);
      } },
    });
    r.frames();
    expect(codes(r)).toEqual(['AX160']);
    const note = 'Values shown differently from the data: 1. See table.';
    expect(lastModel(r).note).toBe(note);
    expect(lastModel(r).summary).toContain(note);
    expect(rows(r).map(row => row[type === 'scatter' ? 2 : 1])).toEqual(['1', '2']);
  });
}
