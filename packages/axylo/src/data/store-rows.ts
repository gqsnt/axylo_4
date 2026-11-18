import type { RowSource } from '../core/contracts';
import { StoreMap } from './store-map';
import { columnsTable, rowValue, type Columns, type Table } from './table';

const blockSize = 256;

interface ColumnBlock {
  readonly table: Table;
  // An untouched block has implicit row indexes. Only a sparse block needs a mask.
  readonly present: bigint | null;
  readonly borrowed: boolean;
}

function blockIndex(row: number): number { return Math.floor(row / blockSize); }
function rowBit(row: number): bigint { return 1n << BigInt(row % blockSize); }
function fullBlock(length: number): bigint { return (1n << BigInt(length)) - 1n; }

class RawRows {
  constructor(
    private readonly objects = new StoreMap<number, unknown>(),
    private readonly columns = new StoreMap<number, ColumnBlock>(),
    private readonly references = new Map<string, StoreMap<number, object>>(),
    private columnCount = 0,
    private borrowedSize = 0,
  ) {}

  fork(): RawRows {
    const references = new Map(Array.from(this.references, ([field, entries]) => [field, entries.fork()]));
    return new RawRows(this.objects.fork(), this.columns.fork(), references, this.columnCount, this.borrowedSize);
  }

  commit(): void {
    this.objects.commit();
    this.columns.commit();
    for (const entries of this.references.values()) entries.commit();
  }

  get size(): number { return this.objects.size + this.columnCount; }

  load(table: Table): void {
    if (!table.columns || table.length === 0) {
      for (let i = 0; i < table.length; i++) this.objects.set(i, table.rowAt(i));
      return;
    }
    const columns = table.columns;
    const keys = Object.keys(columns);
    this.columnCount = table.length;
    const borrowed = keys.some(key => ArrayBuffer.isView(columns[key]));
    this.borrowedSize = borrowed ? table.length : 0;
    for (let start = 0; start < table.length; start += blockSize) {
      const end = Math.min(start + blockSize, table.length);
      const block: Columns = Object.fromEntries(keys.map(key => [key, this.columnSlice(columns[key]!, key, start, end)]));
      this.columns.set(blockIndex(start), { table: columnsTable(block, end - start), present: null, borrowed });
    }
  }

  private columnSlice(column: ArrayLike<unknown>, field: string, start: number, end: number): ArrayLike<unknown> {
    if (ArrayBuffer.isView(column) && 'BYTES_PER_ELEMENT' in column) {
      return Uint8Array.prototype.subarray.call(column, start, end);
    }
    return Array.from({ length: end - start }, (_, i) => {
      const value = column[start + i];
      if (value === null || typeof value !== 'object' && typeof value !== 'function') return value;
      // A partly retained block may keep primitive values, but an object belongs to one row.
      this.reference(field, start + i, value);
      return undefined;
    });
  }

  private own(block: ColumnBlock): ColumnBlock {
    if (!block.borrowed) return block;
    const columns = block.table.columns!;
    const contents: Columns = Object.fromEntries(Object.entries(columns).map(([key, column]) => [
      key, ArrayBuffer.isView(column) && 'BYTES_PER_ELEMENT' in column ? Uint8Array.prototype.slice.call(column) : column,
    ]));
    return { ...block, table: columnsTable(contents, block.table.length), borrowed: false };
  }

  compactColumns(): void {
    if (!this.borrowedSize || this.columnCount * 2 > this.borrowedSize) return;
    // One copy at the halfway point frees the original large buffers after the old
    // revisions retire. Subsequent eviction can free each small block independently.
    for (const [index, block] of this.columns) this.columns.set(index, this.own(block));
    this.borrowedSize = 0;
  }

  private column(row: number): ColumnBlock | undefined {
    const block = this.columns.get(blockIndex(row));
    if (block && (block.present === null ? row % blockSize < block.table.length : (block.present & rowBit(row)) !== 0n)) return block;
    return undefined;
  }

  private reference(field: string, row: number, value: object): void {
    let entries = this.references.get(field);
    if (!entries) this.references.set(field, entries = new StoreMap());
    entries.set(row, value);
  }

  append(start: number, rows: readonly unknown[]): void {
    for (let i = 0; i < rows.length; i++) this.objects.set(start + i, rows[i]);
  }

  copy(row: number, target: RawRows): boolean {
    const block = this.column(row);
    if (block) {
      const index = blockIndex(row);
      const archived = target.columns.get(index);
      target.columns.set(index, { ...(archived ?? this.own(block)), present: (archived?.present ?? 0n) | rowBit(row) });
      target.columnCount++;
      for (const [field, entries] of this.references) {
        const value = entries.get(row);
        if (value !== undefined) target.reference(field, row, value);
      }
    } else if (this.objects.has(row)) target.objects.set(row, this.objects.get(row));
    else return false;
    return true;
  }

  forget(row: number): void {
    this.objects.delete(row);
    const block = this.column(row);
    if (block) {
      const index = blockIndex(row);
      const present = (block.present ?? fullBlock(block.table.length)) & ~rowBit(row);
      if (present) this.columns.set(index, { ...block, present });
      else this.columns.delete(index);
      this.columnCount--;
      for (const entries of this.references.values()) entries.delete(row);
    }
  }

  read(row: number, field: string): unknown {
    const range = this.column(row)?.table;
    return range ? this.references.get(field)?.get(row) ?? range.read(row % blockSize, field) : rowValue(this.objects.get(row), field);
  }

  rowAt(row: number): unknown {
    const range = this.column(row)?.table;
    if (!range) return this.objects.has(row) ? this.objects.get(row) : null;
    if (this.references.size === 0) return range.rowAt(row % blockSize);
    return Object.fromEntries(range.keys().map(field => [field, this.read(row, field)]));
  }

  isColumn(row: number): boolean {
    return this.column(row) !== undefined;
  }

  keysAt(row: number): readonly string[] {
    return this.column(row)?.table.keys() ?? Object.keys(Object(this.objects.get(row)));
  }

  hasField(row: number, field: string): boolean {
    return this.column(row)?.table.hasField(field) ?? Object.hasOwn(Object(this.objects.get(row)), field);
  }

  indexes(start: number, incoming: number): Int32Array {
    const indexes = new Int32Array(this.size + incoming);
    let i = 0;
    for (const [index, { table, present }] of this.columns) {
      const base = index * blockSize;
      for (let offset = 0; offset < table.length; offset++) {
        if (present === null || (present & rowBit(offset)) !== 0n) indexes[i++] = base + offset;
      }
    }
    for (const row of this.objects.keys()) indexes[i++] = row;
    for (let j = 0; j < incoming; j++) indexes[i++] = start + j;
    return indexes;
  }
}

type Discard = (row: number, column: boolean) => void;

export class StreamRows {
  private retained = new RawRows();
  private positions = new StoreMap<number, number>();
  // A sorted, unique column prefix already has a typed position index and implicit source rows.
  private seedPositions: Float64Array | null = null;
  private seedOffset = 0;
  private seedStart = 0;
  private previousAtPosition = new StoreMap<number, number>();
  private unplaced = new StoreMap<number, number>();
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
    draft.retained = this.retained.fork();
    draft.positions = this.positions.fork();
    draft.seedPositions = this.seedPositions;
    draft.seedOffset = this.seedOffset;
    draft.seedStart = this.seedStart;
    draft.previousAtPosition = this.previousAtPosition.fork();
    draft.unplaced = this.unplaced.fork();
    draft.latestPosition = this.latestPosition;
    draft.next = this.next;
    return draft;
  }

  commit(): void {
    this.retained.commit();
    this.positions.commit();
    this.previousAtPosition.commit();
    this.unplaced.commit();
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

  resetPositions(table: Table, positions: Float64Array, seed?: Float64Array): void {
    this.positions = new StoreMap();
    this.previousAtPosition = new StoreMap();
    this.unplaced = new StoreMap();
    this.latestPosition = -Infinity;
    this.seedPositions = null;
    this.seedStart = this.seedOffset = 0;
    if (table.columns && seed?.length === table.length && table.length) {
      let last = -Infinity;
      let i = 0;
      for (; i < seed.length; i++) {
        const position = seed[i]!;
        if (position !== positions[i] || position <= last || !Number.isFinite(position)) break;
        last = position;
      }
      if (i === seed.length) {
        this.seedPositions = seed;
        this.latestPosition = last;
        return;
      }
    }
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

  evictRead(position: number, discard?: Discard): void {
    let row = this.positions.get(position);
    while (row !== undefined) {
      const previous = this.previousAtPosition.get(row);
      this.previousAtPosition.delete(row);
      discard?.(row, this.retained.isColumn(row));
      this.forget(row);
      row = previous;
    }
    this.positions.delete(position);
    // Eviction walks positions in ascending order. Appended rows at this same x
    // have already been evicted from the delta above.
    if (this.seedPositions?.[this.seedStart] === position) {
      const index = this.seedOffset + this.seedStart++;
      discard?.(index, true);
      this.forget(index);
    }
  }

  compactColumns(): void {
    this.retained.compactColumns();
    const seed = this.seedPositions;
    if (!seed || this.seedStart * 2 < seed.length) return;
    this.seedPositions = this.seedStart === seed.length ? null : seed.slice(this.seedStart);
    this.seedOffset += this.seedStart;
    this.seedStart = 0;
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

  constructor(private readonly end: number, rows: StreamRows, live: () => boolean = () => true) {
    this.read = row => {
      if (live()) return rows.rowAt(row);
      this.release();
      return null;
    };
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
