/**
 * C6.1 unit tests for `axylo/export` CSV serialization & RFC 4180 round-trip parity (Node/SSR safe).
 */
import { describe, expect, it } from 'vitest';
import { exportCsv, parseCsv, type CsvTableLike } from '../../src/export';

describe('C6.1 axylo/export CSV round-trip parity', () => {
  it('round-trips TableModel headers, row count, ordering, commas, quotes, and embedded newlines', () => {
    const model: CsvTableLike = {
      headers: ['Month', 'Revenue, "Net"', 'Notes'],
      rowCount: 3,
      row(i) {
        return [
          ['Jan', '$1,200', 'Line 1\nLine 2'],
          ['Feb', '$1,450', 'Quoted "alpha" value'],
          ['Mar', 'No data', 'Plain'],
        ][i] ?? null;
      },
    };
    const csv = exportCsv(model);
    const parsed = parseCsv(csv);
    expect(parsed).toEqual([
      ['Month', 'Revenue, "Net"', 'Notes'],
      ['Jan', '$1,200', 'Line 1\nLine 2'],
      ['Feb', '$1,450', 'Quoted "alpha" value'],
      ['Mar', 'No data', 'Plain'],
    ]);
  });

  it('exports both row arrays and columnar Data<Row> identically with optional UTF-8 BOM', () => {
    const rows = [
      { x: 'A', y: 10, note: 'ok' },
      { x: 'B', y: null, note: 'a,b' },
    ];
    const cols = { columns: { x: ['A', 'B'], y: [10, null], note: ['ok', 'a,b'] } };
    const csvRows = exportCsv(rows, { bom: true, lineEnding: '\n' });
    const csvCols = exportCsv(cols, { bom: true, lineEnding: '\n' });
    expect(csvRows.startsWith('\uFEFF')).toBe(true);
    expect(csvRows).toBe(csvCols);
    expect(parseCsv(csvRows)).toEqual([
      ['x', 'y', 'note'],
      ['A', '10', 'ok'],
      ['B', '', 'a,b'],
    ]);
  });
});
