/**
 * Cycle C3.3 wave A (spec A1, A4, C5, F12): blank names, the table referral of an empty histogram, and the
 * description of a compact error that still shows its omission marker. Driven through the recording host.
 */
import { describe, expect, it } from 'vitest';
import { lastModel, record } from './host';

const codes = (list: readonly { code: string }[]) => list.map(d => d.code).sort();
const rowsOf = (ys: number[]) => ys.map((y, x) => ({ x, y }));

describe('F-A11Y-1: a blank title or an empty labelledBy heading names nothing (A1)', () => {
  it('a whitespace-only title is absent: generated name, no heading, AX140', () => {
    for (const title of ['   ', { text: ' \t ' }]) {
      const r = record('line', { title, data: rowsOf([1, 2]), x: 'x', y: 'y' });
      r.frames();
      expect(lastModel(r).title).toBeNull();
      expect(lastModel(r).labelledBy).toBeNull();
      expect(lastModel(r).name).toBe('Line chart of y by x');
      expect(codes(r.controller.handle.diagnostics)).toEqual(['AX140']);
    }
  });

  it('an empty labelledBy heading falls back to an authored title, without AX140', () => {
    const r = record('line', { labelledBy: 'card', title: 'Revenue', data: rowsOf([1, 2]), x: 'x', y: 'y' });
    r.ids.card = '  ';
    r.frames();
    expect(lastModel(r).labelledBy).toBeNull();
    expect(lastModel(r).title?.text).toBe('Revenue');
    expect(lastModel(r).name).toBe('Revenue');
    expect(r.controller.handle.diagnostics).toEqual([]);
  });

  it('an empty labelledBy heading and a blank title keep the generated name and raise AX140', () => {
    const r = record('line', { labelledBy: 'card', title: ' ', data: rowsOf([1, 2]), x: 'x', y: 'y' });
    r.ids.card = '';
    r.frames();
    expect(lastModel(r).labelledBy).toBeNull();
    expect(lastModel(r).title).toBeNull();
    expect(lastModel(r).name).toBe('Line chart of y by x');
    expect(codes(r.controller.handle.diagnostics)).toEqual(['AX140']);
    r.ids.card = 'Card heading';
    r.controller.handle.update({ description: 'redraw' });
    r.frames();
    expect(lastModel(r).labelledBy).toBe('card');
    expect(r.controller.handle.diagnostics).toEqual([]);
  });
});

describe('F-A11Y-3: table referrals and compact error descriptions (F12, C5, A4)', () => {
  it('a full histogram whose samples all fall outside its bins does not point to a table it cannot open', () => {
    const r = record('histogram', { title: 'Samples', x: 'v', bins: [0, 1], data: [{ v: 5 }, { v: 6 }] });
    r.frames();
    const m = lastModel(r);
    expect(m.note).toMatch(/Values not shown: 2\./);
    expect(m.note).not.toMatch(/table/i);
    expect(r.prepared[r.prepared.length - 1]!.inspectable).toBe(false);
  });

  it('a compact chart in an error state with omissions describes them next to the error', () => {
    const data = [{ x: 0, y: 1 }, { x: 1, y: 'n/a' }, { x: 2, y: 3 }];
    const r = record('line', { title: 'C', compact: true, state: { error: 'The query failed.' }, data, x: 'x', y: 'y' });
    r.frames();
    const m = lastModel(r);
    expect(m.note).toMatch(/Values not shown: 1/);
    expect(m.summary.startsWith('The query failed.')).toBe(true);
    expect(m.summary).toContain(m.note!);
  });

  it('a compact error without omissions is described by the error alone', () => {
    const r = record('line', { title: 'C', compact: true, state: { error: 'The query failed.' }, data: rowsOf([1, 2]), x: 'x', y: 'y' });
    r.frames();
    expect(lastModel(r).summary).toBe('The query failed.');
  });
});
