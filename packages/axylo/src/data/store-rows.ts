import type { RowSource } from '../core/contracts';
import { columnsTable, rowValue, type Columns, type Table } from './table';

const blockSize = 256;

function columnSlice(column: ArrayLike<unknown>, start: number, end: number): ArrayLike<unknown> {
  if (ArrayBuffer.isView(column) && 'slice' in column && typeof column.slice === 'function') {
    const slice = column.slice as (start: number, end: number) => ArrayLike<unknown>;
    return slice.call(column, start, end);
  }
  return Array.from({ length: end - start }, (_, i) => column[start + i]);
}

class RawRows {
  private readonly objects = new Map<number, unknown>();
  private readonly columns = new Map<number, Table>();

  get size(): number { return this.objects.size + this.columns.size; }

  load(table: Table): void {
    if (!table.columns || table.length === 0) {
      for (let i = 0; i < table.length; i++) this.objects.set(i, table.rowAt(i));
      return;
    }
    const columns = table.columns;
    const keys = Object.keys(columns);
    // Evicting a block must release its buffers even if another block from the source survives.
    for (let start = 0; start < table.length; start += blockSize) {
      const end = Math.min(start + blockSize, table.length);
      const block: Columns = Object.fromEntries(keys.map(key => [key, columnSlice(columns[key]!, start, end)]));
      const range = columnsTable(block, end - start);
      for (let i = start; i < end; i++) this.columns.set(i, range);
    }
  }

  append(start: number, rows: readonly unknown[]): void {
    for (let i = 0; i < rows.length; i++) this.objects.set(start + i, rows[i]);
  }

  copy(row: number, target: RawRows): boolean {
    const columns = this.columns.get(row);
    if (columns) target.columns.set(row, columns);
    else if (this.objects.has(row)) target.objects.set(row, this.objects.get(row));
    else return false;
    return true;
  }

  copyTo(target: RawRows): void {
    for (const [row, value] of this.objects) target.objects.set(row, value);
    for (const [row, range] of this.columns) target.columns.set(row, range);
  }

  forget(row: number): void {
    this.objects.delete(row);
    this.columns.delete(row);
  }

  read(row: number, field: string): unknown {
    const range = this.columns.get(row);
    return range ? range.read(row % blockSize, field) : rowValue(this.objects.get(row), field);
  }

  rowAt(row: number): unknown {
    const range = this.columns.get(row);
    return range ? range.rowAt(row % blockSize) : this.objects.has(row) ? this.objects.get(row) : null;
  }

  isColumn(row: number): boolean {
    return this.columns.has(row);
  }

  keysAt(row: number): readonly string[] {
    return this.columns.get(row)?.keys() ?? Object.keys(Object(this.objects.get(row)));
  }

  hasField(row: number, field: string): boolean {
    return this.columns.get(row)?.hasField(field) ?? Object.hasOwn(Object(this.objects.get(row)), field);
  }

  indexes(start: number, incoming: number): Int32Array {
    const indexes = new Int32Array(this.size + incoming);
    let i = 0;
    for (const row of this.columns.keys()) indexes[i++] = row;
    for (const row of this.objects.keys()) indexes[i++] = row;
    for (let j = 0; j < incoming; j++) indexes[i++] = start + j;
    return indexes;
  }
}

type Discard = (row: number, column: boolean) => void;

export class StreamRows {
  private readonly retained = new RawRows();
  private readonly positions = new Map<number, number>();
  private readonly previousAtPosition = new Map<number, number>();
  private readonly unplaced = new Map<number, number>();
  private latestPosition = -Infinity;
  onForget?: (row: number) => void;
  next: number;

  constructor(table?: Table) {
    if (table) this.retained.load(table);
    this.next = table?.length ?? 0;
  }

  get size(): number { return this.retained.size; }

  fork(): StreamRows {
    const draft = new StreamRows();
    this.retained.copyTo(draft.retained);
    for (const [position, row] of this.positions) draft.positions.set(position, row);
    for (const [row, previous] of this.previousAtPosition) draft.previousAtPosition.set(row, previous);
    for (const [row, position] of this.unplaced) draft.unplaced.set(row, position);
    draft.latestPosition = this.latestPosition;
    draft.next = this.next;
    return draft;
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
    this.retained.append(this.next, rows);
    this.next += rows.length;
  }

  forget(row: number): void {
    this.onForget?.(row);
    this.retained.forget(row);
  }

  evict(position: number, discard: (row: number, value?: unknown, column?: boolean) => void): void {
    this.evictRead(position, (row, column) => discard(row, this.rowAt(row), column));
  }

  evictRead(position: number, discard: Discard): void {
    let row = this.positions.get(position);
    while (row !== undefined) {
      const previous = this.previousAtPosition.get(row);
      this.previousAtPosition.delete(row);
      discard(row, this.retained.isColumn(row));
      this.forget(row);
      row = previous;
    }
    this.positions.delete(position);
  }

  trimUnplaced(keep: number, first: number, observed: number, discard: (row: number, value?: unknown, column?: boolean) => void): void {
    this.trimUnplacedRead(keep, first, observed, (row, column) => discard(row, this.rowAt(row), column));
  }

  trimUnplacedRead(keep: number, first: number, observed: number, discard: Discard): void {
    // Invalid records need a bounded home even when every new record is unplaceable.
    const capacity = observed ? 2 * keep : keep;
    for (const [row, position] of this.unplaced) {
      if (this.unplaced.size <= capacity && (!observed || position >= first)) break;
      this.unplaced.delete(row);
      discard(row, this.retained.isColumn(row));
      this.forget(row);
    }
  }

  read(row: number, field: string): unknown {
    return this.retained.read(row, field);
  }

  rowAt(row: number): unknown {
    return this.retained.rowAt(row);
  }

  source(): RowSource {
    return new FrameSource(this.next, this);
  }

  compact(keep: number): void {
    // Column blocks are released as their final retained row leaves.
    void keep;
  }

  archive(row: number, target: RawRows): boolean {
    return this.retained.copy(row, target);
  }

  table(incoming: readonly unknown[] = []): Table {
    const retained = this.retained;
    const first = this.next;
    const indexes = retained.indexes(first, incoming.length);
    return {
      length: indexes.length, columns: null,
      read: (i, field) => {
        const row = indexes[i]!;
        return row < first ? retained.read(row, field) : rowValue(incoming[row - first], field);
      },
      rowIndex: i => indexes[i]!,
      isColumnRow: i => retained.isColumn(indexes[i]!),
      rowAt: i => {
        const row = indexes[i]!;
        return row < first ? retained.rowAt(row) : incoming[row - first];
      },
      hasField: field => indexes.some(row => row < first ? retained.hasField(row, field) : Object.hasOwn(Object(incoming[row - first]), field)),
      keys: () => {
        const keys = new Set<string>();
        for (const row of indexes) {
          const fields = row < first ? retained.keysAt(row) : Object.keys(Object(incoming[row - first]));
          for (const field of fields) keys.add(field);
        }
        return [...keys];
      },
    };
  }
}

export class FrameSource implements RowSource {
  private read: ((row: number) => unknown) | null;

  constructor(private readonly end: number, rows: StreamRows) {
    this.read = row => rows.rowAt(row);
  }

  rowAt(row: number): unknown {
    return Number.isInteger(row) && row >= 0 && row < this.end && this.read ? this.read(row) : null;
  }

  bind(read: (row: number) => unknown): void {
    this.read = read;
  }

  release(): void {
    this.read = null;
  }
}

export class RowWindow {
  private readonly archived = new RawRows();
  private readonly lastSeen = new Map<number, number>();
  private readonly evictions = new Map<number, number[]>();
  private readonly sources = new Map<number, FrameSource>();
  private latestRevision = -Infinity;
  private latestEnd = 0;
  private rows: StreamRows | null;
  private closed = false;

  constructor(rows: StreamRows) {
    this.rows = rows;
  }

  get size(): number { return (this.rows?.size ?? 0) + this.archived.size; }
  get disposable(): boolean { return this.closed && this.sources.size === 0; }

  archive(row: number): void {
    const revision = this.latestRevision;
    // Newly appended rows can be evicted before any accepted frame has addressed them.
    if (!this.sources.has(revision) || row >= this.latestEnd || !this.rows?.archive(row, this.archived)) return;
    this.lastSeen.set(row, revision);
    let indexes = this.evictions.get(revision);
    if (!indexes) this.evictions.set(revision, indexes = []);
    indexes.push(row);
  }

  publish(revision: number, source: FrameSource, rows: StreamRows): void {
    this.rows = rows;
    this.latestRevision = revision;
    this.latestEnd = rows.next;
    this.sources.set(revision, source);
    source.bind(row => {
      const last = this.lastSeen.get(row);
      return last === undefined ? this.rows?.rowAt(row) : revision <= last ? this.archived.rowAt(row) : null;
    });
  }

  close(): void {
    this.closed = true;
    if (this.sources.size === 0) this.rows = null;
  }

  retire(revision: number): void {
    for (const [number, source] of this.sources) {
      if (number > revision) break;
      source.release();
      this.sources.delete(number);
    }
    for (const [number, indexes] of this.evictions) {
      if (number > revision) break;
      for (const row of indexes) {
        this.archived.forget(row);
        this.lastSeen.delete(row);
      }
      this.evictions.delete(number);
    }
    if (this.closed && this.sources.size === 0) this.rows = null;
  }
}

export class RowRevisions {
  private readonly windows = new Set<RowWindow>();
  current: RowWindow;

  constructor(rows: StreamRows) {
    this.windows.add(this.current = new RowWindow(rows));
  }

  get size(): number {
    let size = 0;
    for (const window of this.windows) size += window.size;
    return size;
  }

  replace(rows: StreamRows): void {
    this.current.close();
    if (this.current.disposable) this.windows.delete(this.current);
    this.windows.add(this.current = new RowWindow(rows));
  }

  retire(revision: number): void {
    for (const window of this.windows) {
      window.retire(revision);
      if (window.disposable) this.windows.delete(window);
    }
  }
}
