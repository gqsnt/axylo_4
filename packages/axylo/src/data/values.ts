import { SLOT_ABSENT_FIELD, SLOT_INVALID, SLOT_NULL, SLOT_VALUE, type DiagnosticSink, type SlotState } from '../core/contracts';
import type { ResolvedValueField } from './options';
import { Reports } from './reports';
import type { Table } from './table';

const decimal = /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
export type ValueMode = 'empty' | 'decimal' | 'other';
export type ValueCounts = Record<Exclude<ValueMode, 'empty'>, number>;

export function valueMode(value: unknown, column: boolean): ValueMode {
  if (value == null || value === '' || (column && typeof value === 'number' && Number.isNaN(value))) return 'empty';
  return typeof value === 'string' && decimal.test(value) ? 'decimal' : 'other';
}

export function inspectValues(table: Table, field: string, included?: (row: number) => boolean): ValueMode {
  let mode: ValueMode = 'empty';
  for (let i = 0; i < table.length; i++) {
    if (included && !included(i)) continue;
    const next = valueMode(table.read(i, field), table.isColumnRow(i));
    if (next === 'other') return next;
    if (next === 'decimal') mode = next;
  }
  return mode;
}

export interface Values {
  readonly y: Float64Array | Float32Array;
  readonly slot: Uint8Array;
}

export function readValues(
  table: Table,
  field: ResolvedValueField,
  sink: DiagnosticSink,
  impute: boolean,
  startRow = 0,
  mode?: ValueMode,
  included?: (row: number) => boolean,
  outcome?: string,
  counts?: ValueCounts,
): Values {
  mode ??= inspectValues(table, field.field, included);
  const column = table.columns?.[field.field];
  const zero = impute && field.missing === 'zero';
  const reports = new Reports(field.field, sink);
  const slot = new Uint8Array(table.length);
  let y = column instanceof Float64Array || column instanceof Float32Array ? column : new Float64Array(table.length);

  for (let i = 0; i < table.length; i++) {
    if (included && !included(i)) continue;
    const raw = column === undefined ? table.read(i, field.field) : column[i];
    if (counts) {
      const kind = valueMode(raw, table.isColumnRow(i));
      if (kind !== 'empty') counts[kind]++;
    }
    let value = NaN;
    let state: SlotState = SLOT_VALUE;
    if (typeof raw === 'number') {
      if (Number.isFinite(raw)) value = raw;
      else if (Number.isNaN(raw) && (column || table.isColumnRow(i))) state = SLOT_NULL;
      else {
        state = SLOT_INVALID;
        reports.add('AX103', 'omitted', startRow + table.rowIndex(i), raw, undefined, { outcome });
      }
    } else if (raw === undefined) {
      state = SLOT_ABSENT_FIELD;
      reports.add('AX102', zero ? 'changed' : 'omitted', startRow + table.rowIndex(i), undefined, undefined, { outcome });
    } else if (raw === null || raw === '') {
      state = SLOT_NULL;
    } else if (mode === 'decimal') {
      value = Number(raw);
      if (!Number.isFinite(value)) {
        value = NaN;
        state = SLOT_INVALID;
        reports.add('AX103', 'omitted', startRow + table.rowIndex(i), raw, undefined, { outcome });
      }
      if (field.parse !== 'number') reports.add('AX104', 'none', startRow + table.rowIndex(i));
    } else {
      state = SLOT_INVALID;
      reports.add('AX106', 'omitted', startRow + table.rowIndex(i), raw, undefined, { outcome });
    }
    if (zero && (state === SLOT_NULL || state === SLOT_ABSENT_FIELD)) value = 0;
    if (y === column && !Object.is(y[i], value)) {
      // Infinity and explicit zero imputation cannot be represented by an unchanged borrowed view.
      y = y.slice();
    }
    if (y !== column) y[i] = value;
    slot[i] = state;
  }

  reports.flush(sink);
  return { y, slot };
}
