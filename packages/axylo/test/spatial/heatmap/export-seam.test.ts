/**
 * W4 integration: the heatmap wrapper forwards the inner handle's `axylo/export` capability (export/contract.ts
 * `forwardSeams`), so `exportCsv(chart)` reads the committed, unpaginated table.
 *
 * Fixture: 60 rows × 4 columns, every cell present, value = its index. With few columns the table is the matrix
 * (reader.ts): one row per data row, the row label then one cell per column; 60 rows at 50 per page are two
 * pages. CSV: the header and 60 lines, each value written as in the fixture (integers below 1,000).
 */
import { describe, expect, it } from 'vitest';
import { exportCsv, parseCsv } from '../../../src/export';
import { heatmapInternals } from '../../../src/spatial/heatmap/chart';
import { openRecorded } from './host';

const EXPORT = Symbol.for('axylo.export');
const ROWS = 60, COLS = 4;
const data = Array.from({ length: ROWS * COLS }, (_, i) => ({ r: `R${Math.floor(i / COLS)}`, c: `C${i % COLS}`, v: i }));

describe('heatmap export capability', () => {
  it('is the inner handle\'s, forwarded not enumerable and read-only, and its CSV holds every committed row', () => {
    const { handle, controller } = openRecorded({ title: 'Grid', data, x: 'c', y: 'r', value: 'v' });
    const descriptor = Object.getOwnPropertyDescriptor(handle, EXPORT)!;
    expect(descriptor.enumerable).toBe(false);
    expect(descriptor.writable).toBe(false);
    const inner = (controller.handle as unknown as Record<symbol, unknown>)[EXPORT];
    expect(descriptor.value).toBe(inner);
    const seam = descriptor.value as { table: { rowCount: number; pageSize: number } | null };
    const table = heatmapInternals(handle)!.table()!;
    expect(seam.table).toBe(table);
    expect(table.rowCount).toBeGreaterThan(50);
    expect(Math.ceil(table.rowCount / table.pageSize)).toBeGreaterThan(1);
    const csv = parseCsv(exportCsv(handle));
    expect(csv.length).toBe(1 + table.rowCount);
    expect(csv[0]!.slice(1)).toEqual(Array.from({ length: COLS }, (_, c) => `C${c}`));
    expect(csv.slice(1)).toEqual(Array.from({ length: ROWS }, (_, r) => [`R${r}`, ...Array.from({ length: COLS }, (_, c) => String(r * COLS + c))]));
    handle.destroy();
    expect(seam.table).toBeNull();
  });
});
