import type { RowSource } from '../core/contracts';

export type Columns = Readonly<Record<string, ArrayLike<unknown>>>;

export interface Table extends RowSource {
  readonly length: number;
  readonly columns: Columns | null;
  read(row: number, field: string): unknown;
  isColumnRow(row: number): boolean;
  rowIndex(row: number): number;
  hasField(field: string): boolean;
  keys(): readonly string[];
}

const origins = new WeakMap<Table, readonly unknown[] | Columns>();

export function sameTableData(a: Table, b: Table): boolean {
  const origin = origins.get(a);
  return a === b || (origin !== undefined && origin === origins.get(b) && a.length === b.length);
}

function record(row: unknown): Record<string, unknown> | null {
  return row !== null && typeof row === 'object' ? row as Record<string, unknown> : null;
}

export function rowValue(row: unknown, field: string): unknown {
  const object = record(row);
  return object && Object.hasOwn(object, field) ? object[field] : undefined;
}

export function batchTable(rows: readonly unknown[], start = 0): Table {
  return {
    length: rows.length,
    columns: null,
    read: (row, field) => rowValue(rows[row], field),
    rowAt: row => row >= 0 && row < rows.length && Number.isInteger(row) ? rows[row] : null,
    isColumnRow: () => false,
    rowIndex: row => start + row,
    hasField: field => rows.some(row => {
      const object = record(row);
      return object !== null && Object.hasOwn(object, field);
    }),
    keys: () => {
      const keys = new Set<string>();
      for (const row of rows) for (const key of Object.keys(record(row) ?? {})) keys.add(key);
      return [...keys];
    },
  };
}

export function rowsTable(rows: readonly unknown[]): Table {
  const table = batchTable(rows);
  origins.set(table, rows);
  return table;
}

export function columnsTable(columns: Columns, length: number): Table {
  const keys = Object.keys(columns);
  const table: Table = {
    length,
    columns,
    read: (row, field) => Object.hasOwn(columns, field) ? columns[field]?.[row] : undefined,
    rowAt: row => row >= 0 && row < length && Number.isInteger(row)
      ? Object.fromEntries(keys.map(key => [key, columns[key]?.[row]]))
      : null,
    hasField: field => Object.hasOwn(columns, field),
    isColumnRow: () => true,
    rowIndex: row => row,
    keys: () => keys,
  };
  origins.set(table, columns);
  return table;
}

/**
 * Every buffer behind a typed column a caller has given any chart. A buffer the caller gave is never the
 * library's, whichever frame or store is counted. Weak, so remembering one never keeps it alive.
 */
export const borrowedBuffers = new WeakSet<ArrayBufferLike>();

/** Records the buffers of the caller's typed columns (called where the caller's data is read). */
export function borrowColumns(columns: Readonly<Record<string, unknown>>): void {
  for (const key of Object.keys(columns)) {
    const column = columns[key];
    if (ArrayBuffer.isView(column)) borrowedBuffers.add(column.buffer);
  }
}
