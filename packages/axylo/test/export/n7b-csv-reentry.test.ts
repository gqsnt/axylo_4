/**
 * N7b supplementary CSV review (sol-6.2-medium__20261127T221753Z): the committed table's row memo under author
 * formatters that re-enter the export, supersede a frame, or destroy the chart, and raw rows that are not objects.
 *
 * Expected values come from the spec and C6: a row is formatted once per committed table, so every export of
 * that table has the same bytes; a formatter that throws on a drawn cell is reported (AX160, spec 3.5) and its
 * cell falls back to the default en-US text; nothing is reported on a destroyed chart; a `Data<Row>` row that is
 * not an object has no fields.
 */
import { describe, expect, it } from 'vitest';
import { exportCsv, parseCsv } from '../../src/export';
import { record } from '../core/host';

/** The frame state the scenario checks (fields the controller keeps public for its wrappers). */
type Frames = { readonly inFrame: boolean; readonly inflight: object | null };
const frames = (rec: { controller: unknown }) => rec.controller as Frames;

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ day: i + 1, value: (i + 1) * 10 }));
const options = (n: number, format: (v: number) => string, extra: Record<string, unknown> = {}) => ({
  title: 'Daily value', data: rows(n), x: 'day', y: { field: 'value', label: 'Value', format }, locale: 'en-US', ...extra,
});

describe('N7b committed table row memo under re-entrant formatters', () => {
  it('rejects a nested read of the row being formatted, and the outer and later exports are byte-identical', () => {
    let calls = 0, nest = false, nested: unknown = null, nestedCsv: string | null = null;
    const rec = record('line', options(20, v => {
      if (nest && v === 30) {
        nest = false;
        try { nestedCsv = exportCsv(rec.controller.handle); } catch (error) { nested = error; }
      }
      return `${v}:${calls++}`;
    }));
    rec.frames();
    const handle = rec.controller.handle;
    nest = true;
    const before = calls;
    const outer = exportCsv(handle);
    expect(nestedCsv).toBeNull();
    expect(String(nested)).toMatch(/row in use/);
    // The row the nested read stopped on is not stuck: the next export reads it from the memo.
    expect(exportCsv(handle)).toBe(outer);
    const parsed = parseCsv(outer);
    expect(parsed).toHaveLength(21);
    // Every row was formatted exactly once, by the outer read.
    expect(calls - before).toBe(20);
    expect(new Set(parsed.slice(1).map(r => r[1]!.split(':')[1])).size).toBe(20);
    for (let k = 0; k < 20; k++) expect(parsed[k + 1]![1]!.split(':')[0]).toBe(((k + 1) * 10).toLocaleString('en-US'));
  });

  it('reports AX160 for a drawn-table cell read from a frame the formatter superseded', () => {
    let armed = false, exporting = false, csv: string | null = null, superseded = false;
    const rec = record('line', options(20, v => {
      if (armed && frames(rec).inFrame) {
        armed = false;
        rec.controller.handle.update({ subtitle: 'C' });
        superseded = frames(rec).inflight !== null && frames(rec).inFrame;
        exporting = true;
        try { csv = exportCsv(rec.controller.handle); } finally { exporting = false; }
      }
      if (exporting && v === 50) throw new Error('bad cell');
      return String(v);
    }));
    rec.frames();
    const handle = rec.controller.handle;
    expect(handle.diagnostics.some(d => d.code === 'AX160')).toBe(false);
    armed = true;
    handle.update({ subtitle: 'B' });
    rec.frames();
    // The scenario was reached: the export ran inside a frame after the formatter's own update.
    expect(superseded).toBe(true);
    const parsed = parseCsv(csv!);
    expect(parsed).toHaveLength(21);
    // The failing cell falls back to the default text; the rest are the formatter's.
    expect(parsed[5]).toEqual(['5', '50']);
    expect(handle.diagnostics.filter(d => d.code === 'AX160')).toHaveLength(1);
  });

  it('reports nothing after a formatter destroys the chart and then throws', () => {
    let kill = false;
    const rec = record('line', options(20, v => {
      if (kill) {
        kill = false;
        rec.controller.handle.destroy();
        throw new Error('after destroy');
      }
      return String(v);
    }));
    rec.frames();
    const handle = rec.controller.handle;
    const printed = rec.printed.length;
    kill = true;
    expect(() => exportCsv(handle)).toThrow(/destroyed or drew another table/);
    expect(handle.diagnostics).toEqual([]);
    rec.frames();
    expect(rec.printed.slice(printed).some(p => p.includes('AX160'))).toBe(false);
  });
});

describe('N7b raw Data<Row> rows that are not objects (C6)', () => {
  it('exports a primitive row as an empty record, even for a selected field such as length', () => {
    const data = ['abc', { length: 2 }, 7, null] as unknown as readonly Record<string, unknown>[];
    expect(exportCsv(data, { fields: ['length'], lineEnding: '\n' })).toBe('length\n""\n2\n""\n""');
  });
});
