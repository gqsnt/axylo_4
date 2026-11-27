/**
 * Scatter rows that share an x with an earlier row of the same series (spec F11: ordinary data on a scatter).
 * The aligned frame keeps one row per x slot; the others are kept here, per slot, in typed arrays.
 * Every top-level statement stays pure so `import 'axylo/cartesian'` bundles to 0 raw bytes.
 */
import { SLOT_VALUE, type DiagnosticSink, type Series } from '../core/contracts';
import { readValues } from '../data/values';
import { readX, type DataEnvironment } from '../data/normalize';
import type { ResolvedOptions } from '../data/options';
import { lowerBound } from '../data/search';

export interface RepeatColumn {
  /** Per slot, where its repeated rows start in `y` and `row`; `start[length]` is their number. */
  readonly start: Uint32Array;
  readonly y: Float64Array;
  /** Source row index of each repeated row. */
  readonly row: Int32Array;
}

// Keyed by the series' y column: a renamed frame or a view copies the series object but keeps its columns.
let columns: WeakMap<object, RepeatColumn> | undefined;

export const repeatsOf = (s: Series | undefined): RepeatColumn | null => (s && columns?.get(s.y)) ?? null;

/** How many repeated rows the slots [a, b) have together. */
export const repeatsIn = (col: RepeatColumn | null, a: number, b: number): number => col ? col.start[b]! - col.start[a]! : 0;

/** How many repeated rows a slot has; with `visit`, each one's value and its index into the column. */
export function visitRepeats(col: RepeatColumn | null, slot: number, visit?: (y: number, k: number) => void): number {
  if (!col) return 0;
  const a = col.start[slot]!, b = col.start[slot + 1]!;
  if (visit) for (let k = a; k < b; k++) visit(col.y[k]!, k);
  return b - a;
}

/** Every value of a scatter series at a slot that has repeated rows, the slot's own row first; null otherwise. */
export function valuesText(s: Series, slot: number, text: (v: number) => string): string | null {
  const col = repeatsOf(s);
  if (!visitRepeats(col, slot)) return null;
  const words = s.slot[slot] === SLOT_VALUE ? [text(s.y[slot]!)] : [];
  visitRepeats(col, slot, v => words.push(text(v)));
  return words.join(', ');
}

/**
 * The value of a scatter series' source row at a slot: the slot's own row first, then its repeats. A slot's
 * repeats are in source-row order (a stable sort by x, collectRepeats), so the row is found by bisection.
 */
export function valueAtRow(s: Series, slot: number, row: number): number {
  if (s.slot[slot] === SLOT_VALUE && (s.row?.[slot] ?? slot) === row) return s.y[slot]!;
  const col = repeatsOf(s), b = col ? col.start[slot + 1]! : 0, k = col ? lowerBound(col.row, row, col.start[slot]!, b) : 0;
  return k < b && col!.row[k] === row ? col!.y[k]! : NaN;
}

/**
 * Collect the repeated rows of each series, in the order the aligned frame read them (the first row at an x is
 * the slot's own; data/normalize.ts alignGroup), with the same x parser and value reader.
 */
export function collectRepeats(
  resolved: ResolvedOptions, env: DataEnvironment, series: readonly Series[], xs: Float64Array, length: number,
): void {
  const quiet: DiagnosticSink = { add() {} };
  const { order, positions } = readX('line', resolved, env, quiet);
  if (!order) return;
  const { table } = resolved;
  for (const s of series) {
    const field = resolved.values.find(v => v.field === s.field)!;
    // With impute on, a missing value the field fills (missing: 'zero') reads as 0 and an unplottable one as NaN,
    // the policy the aligned frame applies to a slot's own row, so a repeat is kept exactly when it is a number.
    const values = readValues(table, field, quiet, true, 0, undefined, row => Number.isFinite(positions[row]));
    const start = new Uint32Array(length + 1), y: number[] = [], row: number[] = [], own = s.row as Int32Array;
    let previous = NaN, slot = 0, first = 0;
    for (const r of order) {
      const p = positions[r]!, v = values.y[r]!;
      if (p !== previous) { previous = p; first = r; slot = lowerBound(xs, p, slot, length); }
      else if (v === v) {
        // The aligned frame gives a filled slot no source row (row -1); its points are told apart by row, so the
        // slot's own row is named here. This series' row column is its own (the aligned path built it).
        if (own[slot]! < 0) own[slot] = table.rowIndex(first);
        y.push(v); row.push(table.rowIndex(r)); start[slot + 1]!++;
      }
    }
    for (let j = 0; j < length; j++) start[j + 1]! += start[j]!;
    if (y.length) (columns ??= new WeakMap()).set(s.y, { start, y: Float64Array.from(y), row: Int32Array.from(row) });
  }
}
