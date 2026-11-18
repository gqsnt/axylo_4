import type { RowSource } from '../core/contracts';
import { rowValue, type Table } from './table';

export class StreamRows {
  private readonly added = new Map<number, unknown>();
  private readonly columnRows = new Set<number>();
  private readonly evicted = new Set<number>();
  private readonly positions = new Map<number, number>();
  private readonly previousAtPosition = new Map<number, number>();
  private readonly unplaced = new Map<number, number>();
  private latestPosition = -Infinity;
  private original: Table | null;
  private originalRemaining: number;
  next: number;

  constructor(table: Table) {
    this.original = table;
    this.originalRemaining = table.length;
    this.next = table.length;
  }

  record(position: number, row: number): void {
    if (!Number.isFinite(position)) {
      this.unplaced.set(row, this.latestPosition);
      return;
    }
    this.latestPosition = Math.max(position, this.latestPosition);
    const previous = this.positions.get(position);
    if (previous !== undefined) this.previousAtPosition.set(row, previous);
    this.positions.set(position, row);
  }

  resetPositions(table: Table, positions: Float64Array): void {
    this.positions.clear();
    this.previousAtPosition.clear();
    this.unplaced.clear();
    this.latestPosition = -Infinity;
    for (let i = 0; i < table.length; i++) this.record(positions[i] ?? NaN, table.rowIndex(i));
  }

  append(rows: readonly unknown[]): void {
    for (const row of rows) this.added.set(this.next++, row);
  }

  forget(row: number): void {
    if (this.original && row < this.original.length) {
      this.evicted.add(row);
      if (--this.originalRemaining === 0) {
        this.original = null;
        this.evicted.clear();
      }
    } else {
      this.added.delete(row);
      this.columnRows.delete(row);
    }
  }

  evict(position: number, discard: (row: number, value?: unknown, column?: boolean) => void): void {
    let row = this.positions.get(position);
    while (row !== undefined) {
      const previous = this.previousAtPosition.get(row);
      this.previousAtPosition.delete(row);
      this.discard(row, discard);
      row = previous;
    }
    this.positions.delete(position);
  }

  trimUnplaced(keep: number, first: number, observed: number, discard: (row: number, value?: unknown, column?: boolean) => void): void {
    // Invalid records need a bounded home even when every new record is unplaceable.
    const capacity = observed ? 2 * keep : keep;
    for (const [row, position] of this.unplaced) {
      if (this.unplaced.size <= capacity && (!observed || position >= first)) break;
      this.unplaced.delete(row);
      this.discard(row, discard);
    }
  }

  private read(row: number): unknown {
    if (this.evicted.has(row)) return null;
    if (this.original && row < this.original.length) return this.original.rowAt(row);
    return this.added.has(row) ? this.added.get(row) : null;
  }

  private isColumn(row: number): boolean {
    return (this.original?.isColumnRow(row) && row < this.original.length) || this.columnRows.has(row);
  }

  private discard(row: number, discard: (row: number, value?: unknown, column?: boolean) => void): void {
    discard(row, this.read(row), this.isColumn(row));
    this.forget(row);
  }

  compact(keep: number): void {
    const original = this.original;
    if (!original || this.originalRemaining > Math.max(keep, 16) || this.originalRemaining * 2 > original.length) return;
    // A small remaining window should not keep all the caller's original columns alive.
    for (let row = 0; row < original.length; row++) {
      if (this.evicted.has(row)) continue;
      this.added.set(row, original.rowAt(row));
      if (original.isColumnRow(row)) this.columnRows.add(row);
    }
    this.original = null;
    this.evicted.clear();
  }

  source(): RowSource {
    const end = this.next;
    return { rowAt: row => Number.isInteger(row) && row >= 0 && row < end ? this.read(row) : null };
  }

  table(incoming: readonly unknown[]): Table {
    const original = this.original;
    const originalLength = original?.length ?? 0;
    const indexes: number[] = [];
    for (let i = 0; i < originalLength; i++) if (!this.evicted.has(i)) indexes.push(i);
    for (const row of this.added.keys()) indexes.push(row);
    if (!original) indexes.sort((a, b) => a - b);
    const first = this.next;
    for (let i = 0; i < incoming.length; i++) indexes.push(first + i);
    const source = this.source();
    const data = (row: number) => row >= first ? incoming[row - first] : source.rowAt(row);
    const read = (i: number, field: string): unknown => {
      const row = indexes[i]!;
      return original && row < originalLength ? original.read(row, field) : rowValue(data(row), field);
    };
    return {
      length: indexes.length, columns: null, read,
      rowIndex: i => indexes[i]!,
      isColumnRow: i => this.isColumn(indexes[i]!),
      rowAt: i => data(indexes[i]!),
      hasField: field => indexes.some(row => Object.hasOwn(Object(data(row)), field)),
      keys: () => [...new Set(indexes.flatMap(row => Object.keys(Object(data(row)))))],
    };
  }
}
