import type { DiagnosticInput, DiagnosticSink, Frame, RowSource } from '../core/contracts';
import { DiagnosticCollector } from '../diagnostics';
import type { FrameVersion } from './normalize';
import { resolveFields, resolveTable, retargetOptions, withoutTable, type ChartType, type ResolvedOptions } from './options';

import { once, type PreparedFrame } from './transaction';
import { lowerBound } from './search';
import { StoreMap, mapValues } from './store-map';
import { rowValue, type Columns, type Table } from './table';

/** Share a matching window. A prefix already on that backing keeps its existing cursor. */
export function shareRemainder(
  prefix: Float64Array, offset: number, x: Float64Array, start: number, end: number,
): Float64Array | null {
  const remaining = prefix.length - offset;
  if (remaining <= 0 || remaining > end - start) return null;
  if (prefix.buffer === x.buffer && prefix.byteOffset + offset * 8 === x.byteOffset + start * 8) return prefix;
  return x[start] === prefix[offset] && x[start + remaining - 1] === prefix[prefix.length - 1]
    ? x.subarray(start, start + remaining) : null;
}

/** The left edge of the newest distinct positions. An undersized window has no lower bound. */
export function retentionStart({ positions, order }: { positions: Float64Array; order: Int32Array | null }, keep: number): number {
  let first = Infinity;
  for (let i = (order?.length ?? positions.length) - 1; keep > 0 && i >= 0; i--) {
    const position = positions[order?.[i] ?? i]!;
    if (position !== first) {
      first = position;
      keep--;
    }
  }
  return keep ? -Infinity : first;
}

// Invalid positions have a bounded arrival-order suffix. For an aligned over-budget frame
// the suffix starts only after the first observation in the retained x range.
export function selectWindow(table: Table, x: Parameters<typeof retentionStart>[0], keep: number,
  discard: (index: number) => void, retain?: (index: number) => void): number {
  const first = retentionStart(x, keep);
  if (retain && first === -Infinity) return first;
  const { positions } = x;
  let unplaced = 2 * keep, from = table.length;
  for (let i = table.length - 1; unplaced && i >= 0; i--) {
    if (!Number.isFinite(positions[i])) { from = i; unplaced--; }
  }
  let placed = !retain;
  for (let i = 0; i < table.length; i++) {
    const p = positions[i]!;
    const inside = Number.isFinite(p) ? p >= first : placed && i >= from;
    if (inside) { placed = true; retain?.(i); }
    else discard(table.rowIndex(i));
  }
  return first;
}

export function groupFor<K, V extends object>(map: Map<K, V>, key: K, create: new () => V): V {
  let group = map.get(key);
  if (!group) map.set(key, group = new create());
  return group;
}

const blockSize = 256;

interface ColumnBlock {
  readonly columns: Columns;
  readonly length: number;
  // Zero for a contiguous block. Only irregular eviction needs a 256-bit membership mask.
  present: bigint;
  owner?: object;
  readonly borrowed: boolean;
  archived?: number;
}

function blockIndex(row: number): number { return Math.floor(row / blockSize); }
function bit(offset: number): bigint { return 1n << BigInt(offset); }

function typedColumn(column: ArrayLike<unknown>): boolean {
  return ArrayBuffer.isView(column) && 'BYTES_PER_ELEMENT' in column;
}

export function forkValues<K, V extends { fork(): V }>(source: ReadonlyMap<K, V>): Map<K, V> {
  return mapValues(source, value => value.fork());
}

export class RawRows {
  #objects: StoreMap<number, unknown>;
  #columns?: StoreMap<number, ColumnBlock>;
  declare readonly columnBlocks: StoreMap<number, ColumnBlock> | undefined;
  static {
    if (__DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__)) Object.defineProperty(RawRows.prototype, 'columnBlocks', {
      get(this: RawRows) { return this.#columns; },
    });
  }
  #references: Map<string, StoreMap<number, object>> | null;
  #keys: readonly string[];
  #columnCount: number;
  #borrowedSize: number;
  // Keep the advancing edge on the draft itself so it can share its block with the base.
  #first = 0;
  #owner?: object;

  constructor(previous?: RawRows) {
    this.#objects = previous ? previous.#objects.fork() : new StoreMap();
    this.#columns = previous && previous.#columnCount ? previous.#columns!.fork() : undefined;
    this.#references = previous && previous.#references?.size ? forkValues(previous.#references) : null;
    this.#keys = previous ? previous.#keys : [];
    this.#columnCount = previous ? previous.#columnCount : 0;
    this.#borrowedSize = previous ? previous.#borrowedSize : 0;
    if (previous) this.#first = previous.#first;
  }

  commit(): void {
    this.#objects = this.#objects.commit();
    this.#columns = this.#columns?.commit();
    if (this.#references) {
      for (const [field, entries] of this.#references) this.#references.set(field, entries.commit());
    }
  }

  get size(): number { return this.#objects.size + this.#columnCount; }

  load(table: Table): void {
    if (!table.columns || table.length === 0) {
      for (let i = 0; i < table.length; i++) this.#objects.set(i, table.rowAt(i));
      return;
    }
    this.#columns ??= new StoreMap();
    const columns = table.columns;
    this.#columnCount = table.length;
    const keys = this.#keys = Object.keys(columns);
    const borrowed = keys.some(key => ArrayBuffer.isView(columns[key]));
    this.#borrowedSize = borrowed ? table.length : 0;
    for (let start = 0; start < table.length; start += blockSize) {
      const end = Math.min(start + blockSize, table.length);
      const block: Columns = Object.fromEntries(keys.map(key => [key, this.#columnSlice(columns[key]!, key, start, end)]));
      this.#columns!.set(blockIndex(start), { columns: block, length: end - start, present: 0n, borrowed });
    }
  }

  #columnSlice(column: ArrayLike<unknown>, field: string, start: number, end: number): ArrayLike<unknown> {
    if (typedColumn(column)) {
      return Uint8Array.prototype.subarray.call(column, start, end);
    }
    return Array.from({ length: end - start }, (_, i) => {
      const value = column[start + i];
      if (value === null || typeof value !== 'object' && typeof value !== 'function') return value;
      // A partly retained block may keep primitive values, but an object belongs to one row.
      this.#reference(field, start + i, value);
      return undefined;
    });
  }

  #own(block: ColumnBlock): ColumnBlock {
    if (!block.borrowed) return block;
    const columns = block.columns;
    const contents = Object.fromEntries(Object.entries(columns).map(([key, column]) => [
      key, typedColumn(column) ? Uint8Array.prototype.slice.call(column) : column,
    ]));
    return { ...block, columns: contents, borrowed: false };
  }

  needsColumnCompaction(discarded = 0): boolean {
    return this.#borrowedSize > 0 && (this.#columnCount - discarded) * 2 <= this.#borrowedSize;
  }

  compactColumns(): void {
    if (!this.needsColumnCompaction()) return;
    // One copy at the halfway point frees the original large buffers after the old
    // revisions retire. Subsequent eviction can free each small block independently.
    for (const [index, block] of this.#columns!) this.#columns!.set(index, this.#own(block));
    this.#borrowedSize = 0;
  }

  #column(row: number): ColumnBlock | undefined {
    if (!this.#columnCount || row < this.#first) return;
    const block = this.#columns!.get(blockIndex(row));
    const offset = row % blockSize;
    if (block && offset < block.length && (!block.present || (block.present & bit(offset)))) return block;
  }

  #reference(field: string, row: number, value: object): void {
    groupFor(this.#references ??= new Map(), field, StoreMap<number, object>).set(row, value);
  }

  protected appendRows(start: number, rows: readonly unknown[]): void {
    for (let i = 0; i < rows.length; i++) this.#objects.set(start + i, rows[i]);
  }

  appendOne(index: number, row: unknown): void { this.#objects.set(index, row); }

  copy(row: number, target: RawRows, rolling = false): boolean {
    const block = this.#column(row);
    if (block) {
      target.#columns ??= new StoreMap();
      target.#keys = this.#keys;
      const index = blockIndex(row);
      const archived = target.#columns.get(index);
      if (archived) archived.archived!++;
      else {
        const owned = this.#own(block);
        // A rolling predecessor and the live rows can share the evacuated block.
        if (rolling && owned !== block) this.#columns!.set(index, owned);
        // RowWindow records the revision for each individual row. The archive itself needs
        // only a block reference count, so the final retirement can release its backing.
        target.#columns.set(index, { ...owned, present: 0n, archived: 1 });
      }
      target.#columnCount++;
      if (this.#references) {
        for (const [field, entries] of this.#references) {
          const value = entries.get(row);
          if (value !== undefined) target.#reference(field, row, value);
        }
      }
    } else if (this.#objects.has(row)) target.#objects.set(row, this.#objects.get(row));
    else return false;
    return true;
  }

  forget(row: number): void {
    const block = this.#column(row);
    if (!block) this.#objects.delete(row);
    else {
      const index = blockIndex(row);
      const offset = row % blockSize;
      const end = block.length;
      if (block.archived) {
        if (--block.archived === 0) this.#columns!.delete(index);
      } else if (!block.present && row === this.#first) {
        this.#first++;
        if (offset + 1 === end) this.#columns!.delete(index);
      } else {
        // The live suffix borrows whole blocks. Only eviction out of order needs a hole mask.
        const base = index * blockSize;
        const present = (block.present || bit(end) - bit(Math.max(0, this.#first - base))) & ~bit(offset);
        if (present) {
          // Further removals in the same draft edit its private mask. A rival starts with a fresh owner.
          const owner = this.#owner ??= {};
          if (block.owner === owner) block.present = present;
          else this.#columns!.set(index, { ...block, present, owner });
        } else {
          this.#columns!.delete(index);
          if (this.#first >= base && this.#first < base + end) this.#first = base + end;
        }
      }
      this.#columnCount--;
      if (this.#references) {
        for (const entries of this.#references.values()) entries.delete(row);
      }
    }
  }

  read(row: number, field: string): unknown {
    const block = this.#column(row);
    if (!block) return rowValue(this.#objects.get(row), field);
    if (Object.hasOwn(block.columns, field)) return this.#references?.get(field)?.get(row) ?? block.columns[field]![row % blockSize];
  }

  rowAt(row: number): unknown {
    const block = this.#column(row);
    if (!block) return this.#objects.has(row) ? this.#objects.get(row) : null;
    return Object.fromEntries(this.#keys.map(key => [key, this.#references?.get(key)?.get(row) ?? block.columns[key]![row % blockSize]]));
  }

  isColumn(row: number): boolean { return this.#column(row) !== undefined; }

  protected fieldsAt(row: number): object {
    return this.#column(row)?.columns ?? Object(this.#objects.get(row));
  }

  indexes(start: number, incoming: number): Int32Array {
    const indexes = new Int32Array(this.size + incoming);
    let i = 0;
    if (this.#columns) for (const [index, block] of this.#columns) {
      const { length, present } = block;
      const base = index * blockSize;
      if (!present) {
        for (let offset = Math.max(0, this.#first - base); offset < length; offset++) indexes[i++] = base + offset;
      } else {
        // Enumerate an irregular block a word at a time, visiting only its surviving rows.
        let mask = present;
        for (let word = base; mask; word += 32, mask >>= 32n) {
          let bits = Number(BigInt.asIntN(32, mask));
          while (bits) {
            indexes[i++] = word + 31 - Math.clz32(bits & -bits);
            bits &= bits - 1;
          }
        }
      }
    }
    for (const row of this.#objects.keys()) indexes[i++] = row;
    for (let j = 0; j < incoming; j++) indexes[i++] = start + j;
    return indexes;
  }
}

type Discard = (row: number, column: boolean) => void;

export class StreamRows extends RawRows {
  #positions: StoreMap<number, number>;
  // A sorted, unique column prefix already has a typed position index and implicit source rows.
  #seedPositions: Float64Array | null = null;
  declare readonly initialPositions: Float64Array | null;
  static {
    if (__DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__)) Object.defineProperty(StreamRows.prototype, 'initialPositions', {
      get(this: StreamRows) { return this.#seedPositions; },
    });
  }
  #seedOffset = 0;
  #seedStart = 0;
  #previousAtPosition: StoreMap<number, number> | null;
  #unplaced: StoreMap<number, number> | null;
  #latestPosition = -Infinity;
  trackEvictions = false;
  evicted: number | number[] | null = null;
  next: number;

  constructor(table?: Table, previous?: StreamRows) {
    super(previous);
    if (previous) {
      this.#positions = previous.#positions.fork();
      this.#previousAtPosition = previous.#previousAtPosition?.size
        ? previous.#previousAtPosition.fork() : null;
      this.#unplaced = previous.#unplaced?.size
        ? previous.#unplaced.fork() : null;
      this.#seedPositions = previous.#seedPositions;
      this.#seedOffset = previous.#seedOffset;
      this.#seedStart = previous.#seedStart;
      this.#latestPosition = previous.#latestPosition;
      this.next = previous.next;
    } else {
      this.#positions = new StoreMap();
      this.#previousAtPosition = null;
      this.#unplaced = null;
      if (table) this.load(table);
      this.next = table?.length ?? 0;
    }
  }

  get hasUnplaced(): boolean { return Boolean(this.#unplaced?.size); }

  fork(trackEvictions = false): StreamRows {
    const draft = new StreamRows(undefined, this);
    draft.trackEvictions = trackEvictions;
    return draft;
  }

  override commit(): void {
    super.commit();
    this.#positions = this.#positions.commit();
    if (this.#previousAtPosition) this.#previousAtPosition = this.#previousAtPosition.commit();
    if (this.#unplaced) this.#unplaced = this.#unplaced.commit();
  }

  record(position: number, row: number): void {
    if (!Number.isFinite(position)) {
      (this.#unplaced ??= new StoreMap()).set(row, this.#latestPosition);
      return;
    }
    this.#latestPosition = Math.max(position, this.#latestPosition);
    const previous = this.#positions.get(position);
    if (previous !== undefined) (this.#previousAtPosition ??= new StoreMap()).set(row, previous);
    this.#positions.set(position, row);
  }

  resetPositions(table: Table, positions: Float64Array, seed?: Float64Array): void {
    this.#positions = new StoreMap();
    this.#previousAtPosition = null;
    this.#unplaced = null;
    this.#latestPosition = -Infinity;
    this.#seedPositions = null;
    this.#seedStart = this.#seedOffset = 0;
    if (table.columns && seed?.length === table.length && table.length) {
      let last = -Infinity;
      let i = 0;
      for (; i < seed.length; i++) {
        const position = seed[i]!;
        if (position !== positions[i] || position <= last || !Number.isFinite(position)) break;
        last = position;
      }
      if (i === seed.length) {
        this.#seedPositions = seed;
        this.#latestPosition = last;
        return;
      }
    }
    for (let i = 0; i < table.length; i++) this.record(positions[i] ?? NaN, table.rowIndex(i));
  }

  append(rows: readonly unknown[]): void {
    this.appendRows(this.next, rows);
    this.next += rows.length;
  }

  appendPositions(rows: readonly unknown[], positions: Float64Array, ascending: boolean): void {
    const start = this.next;
    this.append(rows);
    if (ascending && positions[0]! > this.#latestPosition) {
      for (let i = 0; i < positions.length; i++) this.#positions.set(positions[i]!, start + i);
      this.#latestPosition = positions[positions.length - 1]!;
    } else {
      for (let i = 0; i < positions.length; i++) this.record(positions[i]!, start + i);
    }
  }

  /** The dense append path has already checked that this x is new and in order. */
  appendPosition(row: object, position: number): void {
    this.appendOne(this.next, row);
    this.#positions.set(position, this.next++);
    this.#latestPosition = position;
  }

  firstRowAt(position: number): number | undefined {
    return this.#positions.get(position) ??
      (this.#seedPositions?.[this.#seedStart] === position ? this.#seedOffset + this.#seedStart : undefined);
  }

  evictSingle(position: number, row: number): void {
    // The dense window has exactly one retained row per position.
    if (this.#seedPositions?.[this.#seedStart] === position) this.#seedStart++;
    else this.#positions.delete(position);
    this.forget(row);
  }

  previewAppend(row: object, evicted: number | undefined): FrameSource {
    // The preview overlays just the changed rows until its base is superseded or it is published.
    return new FrameSource(this.next + 1, this, undefined, row, evicted);
  }

  override forget(row: number): void {
    if (this.trackEvictions) {
      if (this.evicted === null) this.evicted = row;
      else if (typeof this.evicted === 'number') this.evicted = [this.evicted, row];
      else this.evicted.push(row);
    }
    super.forget(row);
  }

  evictRead(position: number, discard?: Discard): void {
    let row = this.#positions.get(position);
    if (row !== undefined) {
      const previousMap = this.#previousAtPosition;
      do {
        const previous: number | undefined = previousMap?.get(row);
        if (previous !== undefined) previousMap!.delete(row);
        discard?.(row, this.isColumn(row));
        this.forget(row);
        row = previous;
      } while (row !== undefined);
      this.#positions.delete(position);
    }
    // Eviction walks positions in ascending order. Appended rows at this same x
    // have already been evicted from the delta above.
    if (this.#seedPositions?.[this.#seedStart] === position) {
      const index = this.#seedOffset + this.#seedStart++;
      discard?.(index, true);
      this.forget(index);
    }
  }

  /** As `Observations.share`: the seed's remaining positions read from the store's window (see store.ts). */
  shareSeed(x: Float64Array, start: number, end: number): void {
    const seed = this.#seedPositions;
    if (!seed) return;
    const shared = shareRemainder(seed, this.#seedStart, x, start, end);
    if (!shared || shared === seed) return;
    this.#seedPositions = shared;
    this.#seedOffset += this.#seedStart;
    this.#seedStart = 0;
  }

  override compactColumns(window?: ArrayBufferLike): void {
    super.compactColumns();
    const seed = this.#seedPositions;
    if (!seed || this.#seedStart * 2 < seed.length) return;
    if (seed.buffer === window && this.#seedStart < seed.length) return;
    this.#seedPositions = this.#seedStart === seed.length ? null : seed.slice(this.#seedStart);
    this.#seedOffset += this.#seedStart;
    this.#seedStart = 0;
  }

  trimUnplacedRead(keep: number, first: number, observed: number, discard: Discard): void {
    const unplaced = this.#unplaced;
    if (!unplaced || unplaced.size === 0) return;
    // Invalid records need a bounded home even when every new record is unplaceable.
    const capacity = observed ? 2 * keep : keep;
    for (const [row, position] of unplaced) {
      if (unplaced.size <= capacity && (!observed || position >= first)) break;
      unplaced.delete(row);
      discard(row, this.isColumn(row));
      this.forget(row);
    }
  }

  source(live?: () => boolean): FrameSource {
    return new FrameSource(this.next, this, live);
  }

  /** Every retained source row, ascending: the opening's column rows come first, appended rows after them. */
  retainedIndexes(): Int32Array {
    return this.indexes(0, 0);
  }

  table(incoming: readonly unknown[] = []): Table {
    const retained = this;
    const first = this.next;
    const indexes = retained.indexes(first, incoming.length);
    const fields = (row: number): object => row < first ? retained.fieldsAt(row) : Object(incoming[row - first]);
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
      hasField: field => indexes.some(row => Object.hasOwn(fields(row), field)),
      keys: () => {
        const keys = new Set<string>();
        for (const row of indexes) for (const field of Object.keys(fields(row))) keys.add(field);
        return [...keys];
      },
    };
  }
}

export class FrameSource implements RowSource {
  #rows: StreamRows | null;
  #live: (() => boolean) | null;
  #store: RevisionStore<Frame> | null = null;
  #base: Frame | null = null;
  #window: RowWindow | null = null;
  #revision = 0;
  #next: FrameSource | null = null;
  #appended?: object;
  readonly #evicted?: number;

  readonly #end: number;

  constructor(
    end: number, rows: StreamRows, live?: () => boolean,
    appended?: object, evicted?: number,
  ) {
    this.#end = end;
    this.#rows = rows;
    this.#live = live ?? null;
    this.#appended = appended;
    this.#evicted = evicted;
  }

  rowAt(row: number): unknown {
    if (!Number.isInteger(row) || row < 0 || row >= this.#end) return null;
    if (this.#window) return this.#window.readRevision(this.#revision, row);
    if (this.#rows) {
      if ((this.#store === null || this.#store.frame === this.#base) && (this.#live === null || this.#live())) {
        if (this.#appended) {
          if (row === this.#evicted) return null;
          if (row === this.#end - 1) return this.#appended;
        }
        return this.#rows.rowAt(row);
      }
      this.release();
    }
    return null;
  }

  get limit(): number { return this.#end; }

  watchBase(store: RevisionStore<Frame>, base: Frame): void {
    this.#store = store;
    this.#base = base;
  }

  belongsTo(window: RowWindow, revision: number): boolean {
    return this.#window === window && this.#revision === revision;
  }

  get revision(): number { return this.#revision; }

  bindWindow(window: RowWindow, revision: number, previous: FrameSource | null): void {
    this.release();
    this.#window = window;
    this.#revision = revision;
    if (previous) previous.#next = this;
  }

  release(): FrameSource | null {
    const next = this.#next;
    this.#next = null;
    this.#window = null;
    this.#rows = null;
    this.#live = null;
    this.#store = null;
    this.#base = null;
    this.#appended = undefined;
    return next;
  }
}

export class RowWindow {
  private readonly archived = new RawRows();
  readonly #lastSeen = new Map<number, number>();
  // Publication and retirement are ordered. Link the sources themselves, with no per-revision map entry.
  #first: FrameSource | null = null;
  #last: FrameSource | null = null;
  private rows: StreamRows | null;
  #closed = false;

  constructor(rows: StreamRows) {
    this.rows = rows;
  }

  get size(): number { return (this.rows?.size ?? 0) + this.archived.size; }
  get disposable(): boolean { return this.#closed && !this.#last; }

  archive(row: number, rolling = false): void {
    // Newly appended rows can be evicted before any accepted frame has addressed them.
    const source = this.#last;
    if (!source || row >= source.limit || this.#lastSeen.has(row) || !this.rows?.copy(row, this.archived, rolling)) return;
    this.#lastSeen.set(row, source.revision);
  }

  readRevision(revision: number, row: number): unknown {
    const last = this.#lastSeen.get(row);
    return last === undefined ? this.rows?.rowAt(row) : revision <= last ? this.archived.rowAt(row) : null;
  }

  publish(revision: number, source: FrameSource, rows: StreamRows): void {
    this.rows = rows;
    source.bindWindow(this, revision, this.#last);
    this.#first ??= source;
    this.#last = source;
  }

  /**
   * The source rows a published revision's `rowAt` answers, ascending, or null when it is not one of this
   * window's live revisions. The rows still retained below its end, and the evicted rows kept for it.
   */
  retainedRows(revision: number, source: RowSource): ArrayLike<number> | null {
    if (!(source instanceof FrameSource) || !source.belongsTo(this, revision) || !this.rows) return null;
    const end = source.limit;
    const current = this.rows.retainedIndexes();
    const live = current.length === 0 || current[current.length - 1]! < end ? current : current.subarray(0, lowerBound(current, end));
    const kept: number[] = [];
    for (const [row, last] of this.#lastSeen) if (revision <= last && row < end) kept.push(row);
    if (!kept.length) return live;
    kept.sort((a, b) => a - b);
    // Merge the two ascending lists.
    const all = new Int32Array(live.length + kept.length);
    for (let i = 0, j = 0, k = 0; k < all.length; k++) {
      all[k] = j >= kept.length || i < live.length && live[i]! < kept[j]! ? live[i++]! : kept[j++]!;
    }
    return all;
  }

  close(): void {
    this.#closed = true;
    if (this.disposable) this.rows = null;
  }

  retire(revision: number): void {
    while (this.#first && this.#first.revision <= revision) this.#first = this.#first.release();
    if (!this.#first) this.#last = null;
    // A source row leaves a window once. Map insertion order is therefore eviction revision order.
    if (this.#lastSeen.size) {
      for (const [row, last] of this.#lastSeen) {
        if (last > revision) break;
        this.archived.forget(row);
        this.#lastSeen.delete(row);
      }
    }
    if (this.disposable) this.rows = null;
  }
}

let replaceWindow: (revisions: RowRevisions, rows: StreamRows) => void;

export class RowRevisions {
  private older?: Set<RowWindow>;
  #retired = -Infinity;
  current: RowWindow;

  constructor(rows: StreamRows) { this.current = new RowWindow(rows); }

  static {
    if (__DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__)) replaceWindow = (history, rows) => {
      history.current.close();
      if (!history.current.disposable) (history.older ??= new Set()).add(history.current);
      history.current = new RowWindow(rows);
    };
  }

  get size(): number {
    let size = this.current.size;
    if ((__DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__)) && this.older) for (const window of this.older) size += window.size;
    return size;
  }

  retainedRows({ revision, source }: Pick<Frame, 'revision' | 'source'>): ArrayLike<number> | null {
    const rows = this.current.retainedRows(revision, source);
    if ((__DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__)) && !rows && this.older) for (const window of this.older) {
      const previous = window.retainedRows(revision, source);
      if (previous) return previous;
    }
    return rows;
  }

  retire(revision: number): void {
    if (revision <= this.#retired) return;
    this.#retired = revision;
    this.current.retire(revision);
    if ((__DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__)) && this.older) for (const window of this.older) {
      window.retire(revision);
      if (window.disposable) this.older.delete(window);
    }
  }
}

/** Shared revision and row ownership for aligned, point and slice frames. */
export abstract class RevisionStore<F extends Frame, P extends PreparedFrame<F> = PreparedFrame<F>> {
  protected rows: StreamRows;
  protected readonly revisions: RowRevisions;
  protected current!: F;
  readonly #currentFrame = () => this.current;
  protected latest!: readonly DiagnosticInput[];

  constructor(table: Table, protected readonly kind: ChartType, private readonly resolve = resolveFields) {
    this.rows = new StreamRows(table);
    this.revisions = new RowRevisions(this.rows);
  }

  resolveEncoding(input: unknown, sink: DiagnosticSink): ResolvedOptions {
    return withoutTable(this.resolve(this.kind, input, sink, this.rows.table()));
  }

  protected checkPreparation(): void {}

  prepareReencode(options: ResolvedOptions, version: FrameVersion) {
    return this.prepareEncoding(this.rows.fork(), options, version, new DiagnosticCollector());
  }

  protected prepareEncoding(rows: StreamRows, options: ResolvedOptions, version: FrameVersion, call: DiagnosticCollector,
    replacement?: ReturnType<typeof resolveTable>,
  ) {
    this.checkPreparation();
    const base = this.current;
    checkVersion(base, version);
    const table = replacement?.table ?? rows.table();
    const resolved = retargetOptions(options, table, call, replacement?.valid);
    return this.encode(base, rows, resolved, options, version, call, replacement !== undefined);
  }

  protected abstract encode(base: F, rows: StreamRows, resolved: ResolvedOptions, options: ResolvedOptions, version: FrameVersion,
    call: DiagnosticCollector, replacement: boolean): P;

  get frame(): F { return this.current; }
  get retainedRowCount(): number { return this.revisions.size; }
  retainedRows(frame: Frame): ArrayLike<number> | null { return this.revisions.retainedRows(frame); }
  retire(revision: number): void { this.revisions.retire(Math.min(revision, this.current.revision)); }

  protected publish(frame: F, source = this.rows.source()): void {
    this.revisions.current.publish(frame.revision, source, this.rows);
    this.current = frame.source === source ? frame : { ...frame, source };
  }

  protected preview(base: F, result: F, rows: StreamRows, diagnostics: readonly DiagnosticInput[],
    callDiagnostics: readonly DiagnosticInput[], apply: () => void, source = rows.source(),
  ): PreparedFrame<F> & { commit: ReturnType<typeof once> } {
    source.watchBase(this, base);
    const frame = result.source === source ? result : { ...result, source };
    const commit = once(this.#currentFrame, () => {
      apply();
      this.latest = diagnostics;
      this.publish(frame, source);
    }, base);
    return { frame, diagnostics, callDiagnostics, commit };
  }

  protected commitRows(rows: StreamRows, replacement: boolean): void {
    if (__DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__)) {
      if (replacement) replaceWindow(this.revisions, rows);
    }
    const evicted = rows.evicted;
    if (typeof evicted === 'number') this.revisions.current.archive(evicted);
    else if (evicted) {
      for (let i = 0; i < evicted.length; i++) this.revisions.current.archive(evicted[i]!);
    }
    rows.evicted = null;
    rows.trackEvictions = false;
    rows.commit();
    this.rows = rows;
  }
}

export function nextVersion(frame: FrameVersion): FrameVersion {
  return { epoch: frame.epoch, revision: frame.revision + 1 };
}

export function checkVersion(base: FrameVersion, version: FrameVersion): void {
  if (version.revision <= base.revision || version.epoch <= base.epoch) {
    throw new Error('Encoding updates and replacements require a newer epoch and revision.');
  }
}

interface EncodingExtras<F extends Frame> {
  prepareReencode(options: ResolvedOptions, version: FrameVersion): PreparedFrame<F>;
  reencode(options: ResolvedOptions, version: FrameVersion): F;
  replace(data: unknown, options: ResolvedOptions, version: FrameVersion): F;
  prepareReplace(data: unknown, options: ResolvedOptions, version: FrameVersion): PreparedFrame<F>;
}

/** Installed only by the development and benchmark store constructors. */
export function installEncodingExtras<F extends Frame, S extends EncodingExtras<F> & RevisionStore<F>>(proto: S): void {
  function commit(change: PreparedFrame<F>): F {
    change.commit();
    return change.frame;
  }
  proto.reencode = function (options, version) { return commit(this.prepareReencode(options, version)); };
  proto.replace = function (data, options, version) { return commit(this.prepareReplace(data, options, version)); };
  proto.prepareReplace = function (data, options, version) {
    const call = new DiagnosticCollector();
    const replacement = resolveTable(data, call);
    return this['prepareEncoding'](new StreamRows(replacement.table), options, version, call, replacement);
  };
}

export function forwardDiagnostics(inputs: readonly DiagnosticInput[], sink: DiagnosticSink): void {
  for (let i = 0; i < inputs.length; i++) sink.add(inputs[i]!);
}
