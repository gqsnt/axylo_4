import { SLOT_ABSENT_FIELD, SLOT_INVALID, SLOT_NULL, SLOT_VALUE, type DiagnosticSink, type SlotState } from '../core/contracts';
import type { ResolvedValueField } from './options';
import { Reports } from './reports';
import type { FullStatistics } from './store-statistics';
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
  /** null when every slot is SLOT_VALUE: an all-zero column would cost a byte per row and say nothing. */
  readonly slot: Uint8Array | null;
  readonly allValid: boolean;
  readonly statistics?: FullStatistics;
}

export function readValues(
  table: Table,
  field: ResolvedValueField,
  sink: DiagnosticSink,
  impute: boolean,
  startRow = 0,
  mode?: ValueMode | 'parsed',
  included?: (row: number) => boolean,
  outcome?: string,
  counts?: ValueCounts,
  keepAllValidSlots = true,
): Values {
  const column = table.columns?.[field.field];
  const borrowed = column instanceof Float64Array || column instanceof Float32Array;
  const zero = impute && field.missing === 'zero';
  let slot: Uint8Array | undefined;
  let y = borrowed ? column : new Float64Array(table.length);
  let i = 0;
  let allValid = !included;
  if (borrowed && !included) {
    // Values and typed NaNs can stay in the caller's storage without generic row validation.
    if (counts && keepAllValidSlots && table.length >= 256) {
      let min = column[0]!, max = min;
      if (Number.isFinite(min)) {
        // Interior values and exact repeats leave both finite extrema unchanged.
        // Opposite zero signs still go through Math.min/max.
        for (i = 1; i < table.length; i++) {
          const value = column[i]!;
          if ((value > min && value < max) || Object.is(value, min) || Object.is(value, max)) continue;
          if (!Number.isFinite(value)) break;
          min = Math.min(min, value);
          max = Math.max(max, value);
        }
      }
      if (i === table.length) {
        const last = column[table.length - 1]!;
        const signed = { min, max, last };
        let ordered = signed;
        if (min === 0 || max === 0) {
          // The reader keeps the first zero on a tie, including its sign.
          for (let row = 0; row < i; row++) {
            const value = column[row]!;
            if (value === 0) {
              ordered = { min: min === 0 ? value : min, max: max === 0 ? value : max, last };
              break;
            }
          }
        }
        counts.other += table.length;
        return { y, slot: null, allValid: true, statistics: { ordered, signed } };
      }
    }
    let missing = 0;
    for (; i < table.length; i++) {
      const value = column[i]!;
      if (Number.isFinite(value)) continue;
      if (zero || !Number.isNaN(value)) break;
      (slot ??= new Uint8Array(table.length))[i] = SLOT_NULL;
      missing++;
    }
    if (counts) counts.other += i - missing;
    allValid = missing === 0;
    if (i === table.length) {
      return { y, slot: slot ?? null, allValid };
    }
  }
  slot ??= new Uint8Array(table.length);
  const reports = new Reports(field.field, sink);
  mode ??= borrowed ? 'other' : inspectValues(table, field.field, included);

  for (; i < table.length; i++) {
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
      reports.add('AX102', zero ? 'changed' : 'omitted', startRow + table.rowIndex(i), undefined, undefined,
        { outcome: zero ? undefined : outcome });
    } else if (raw === null || raw === '') {
      state = SLOT_NULL;
    } else if (mode === 'decimal' || mode === 'parsed' && typeof raw === 'string' && decimal.test(raw)) {
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
    if (state !== SLOT_VALUE) {
      slot[i] = state;
      allValid = false;
    }
  }

  reports.flush(sink);
  return { y, slot: allValid ? null : slot, allValid };
}
