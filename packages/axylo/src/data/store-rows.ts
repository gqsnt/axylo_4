import type { RowSource } from '../core/contracts';
import { rowValue, type Table } from './table';

export class StreamRows {
  private readonly added = new Map<number, unknown>();
  private readonly evicted = new Set<number>();
  private readonly positions = new Map<number, number>();
  private readonly previousAtPosition = new Map<number, number>();
  private original: Table | null;
  private originalRemaining: number;
  next: number;

  constructor(table: Table) {
    this.original = table;
    this.originalRemaining = table.length;
    this.next = table.length;
  }

  record(position: number, row: number): void {
    if (!Number.isFinite(position)) return;
    const previous = this.positions.get(position);
    if (previous !== undefined) this.previousAtPosition.set(row, previous);
    this.positions.set(position, row);
  }

  resetPositions(table: Table, positions: Float64Array): void {
    this.positions.clear();
    this.previousAtPosition.clear();
    for (let i = 0; i < positions.length; i++) this.record(positions[i]!, table.rowIndex(i));
  }

  append(rows: readonly unknown[]): void {
    for (const row of rows) this.added.set(this.next++, row);
  }

  private remove(row: number): void {
    if (this.original && row < this.original.length) {
      this.evicted.add(row);
      if (--this.originalRemaining === 0) {
        this.original = null;
        this.evicted.clear();
      }
    } else {
      this.added.delete(row);
    }
  }

  evict(position: number, discard: (row: number) => void): void {
    let row = this.positions.get(position);
    while (row !== undefined) {
      const previous = this.previousAtPosition.get(row);
      this.previousAtPosition.delete(row);
      discard(row);
      this.remove(row);
      row = previous;
    }
    this.positions.delete(position);
  }

  source(): RowSource {
    const end = this.next;
    return {
      rowAt: row => {
        if (!Number.isInteger(row) || row < 0 || row >= end || this.evicted.has(row)) return null;
        if (this.original && row < this.original.length) return this.original.rowAt(row);
        return this.added.has(row) ? this.added.get(row) : null;
      },
    };
  }

  table(incoming: readonly unknown[]): Table {
    const original = this.original;
    const originalLength = original?.length ?? 0;
    const indexes: number[] = [];
    for (let i = 0; i < originalLength; i++) if (!this.evicted.has(i)) indexes.push(i);
    for (const row of this.added.keys()) indexes.push(row);
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
      isColumnRow: i => original !== null && indexes[i]! < originalLength && original.isColumnRow(indexes[i]!),
      rowAt: i => data(indexes[i]!),
      hasField: field => indexes.some((_, i) => read(i, field) !== undefined) || (original?.hasField(field) ?? false),
      keys: () => [...new Set([
        ...(original?.keys() ?? []),
        ...Array.from(this.added.values()).flatMap(row => Object.keys(row ?? {})),
        ...incoming.flatMap(row => Object.keys(row ?? {})),
      ])],
    };
  }
}
