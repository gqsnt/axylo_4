import { BufferWindow } from './store-window';
import { SLOT_NO_ROW, type AlignedFrame, type RowSource, type Series, type XColumn } from '../core/contracts';
import type { ByteCount } from './store-bytes';

interface OpenSlot {
  readonly index: number;
  exposed: boolean;
  claimed: boolean;
  readonly y: number;
  readonly slot: number;
  readonly row: number;
}

type SeriesDescription = Omit<Series, 'y' | 'slot' | 'row'>;
export interface SeriesBuffers {
  description: SeriesDescription;
  y: Float64Array;
  slot: Uint8Array;
  /**
   * null while every slot came from the row with the same number (shifted by `FrameBuffers.rowShift`): a
   * typed-column frame has no row index, and a dense identity index would cost 4 bytes a slot (spec P7).
   */
  row: Int32Array | null;
  tail?: OpenSlot;
}

function buffers(description: SeriesDescription, capacity: number, rows = true): SeriesBuffers {
  return {
    description, y: new Float64Array(capacity), slot: new Uint8Array(capacity),
    row: rows ? new Int32Array(capacity) : null,
  };
}

// Spare slots when storage opens. The store opens on the first append to a static chart, so the copy
// made here is what P7 measures: a large chart gets only a small tail. Later growth doubles the window.
function openingCapacity(length: number): number {
  return length + Math.max(16, Math.min(Math.ceil(length / 8), 4096));
}

export class FrameBuffers {
  x: Float64Array;
  /** null while every slot of the window has an observation (no gap slot was ever stored). */
  private observedFlags: Uint8Array | null = null;
  private categoryPositions = new Float64Array();
  readonly series = new Map<string, SeriesBuffers>();
  private range: BufferWindow;
  /** Source row of slot i for an identity series is i + rowShift; storage rebasing moves slots, not rows. */
  private rowShift = 0;

  get start(): number { return this.range.start; }
  get end(): number { return this.range.end; }
  set end(end: number) { this.range.end = end; }
  distinct: number;

  constructor(frame?: AlignedFrame, positions?: Float64Array, order: Int32Array | null = null) {
    this.range = new BufferWindow(0, frame?.length ?? 0);
    this.distinct = 0;
    const capacity = openingCapacity(this.end);
    this.x = new Float64Array(capacity);
    if (!frame || !positions) return;
    this.x.set(frame.x.values);
    const flags = new Uint8Array(capacity);
    let slot = 0;
    const length = order?.length ?? positions.length;
    for (let i = 0; i < length; i++) {
      const x = positions[order?.[i] ?? i]!;
      while (slot < this.end && this.x[slot]! < x) slot++;
      if (slot < this.end && this.x[slot] === x && !flags[slot]) {
        flags[slot] = 1;
        this.distinct++;
      }
    }
    // Most frames observe every slot; the flags are kept only when an expected step has no observation.
    this.observedFlags = this.distinct === this.end ? null : flags;
    for (const { row, slot, y, ...description } of frame.series) {
      const series = buffers(description, capacity, row !== null);
      series.y.set(y);
      series.slot.set(slot);
      if (row) series.row!.set(row);
      this.series.set(description.key, series);
    }
  }

  fork(): FrameBuffers {
    const draft = Object.assign(Object.create(FrameBuffers.prototype) as FrameBuffers, this, {
      range: this.range.fork(),
      series: new Map(Array.from(this.series, ([key, series]) => [key, { ...series }])),
    });
    return draft;
  }

  get hasCompetingWrites(): boolean { return this.range.hasCompetingWrites; }

  /** Whether slot `index` holds an observed x (not only an expected step that no series had). */
  observed(index: number): boolean {
    return this.observedFlags ? this.observedFlags[index] === 1 : index >= this.start && index < this.end;
  }

  /** Records the observed flags of slots written from `index`. Call after `reserve`. */
  markObserved(flags: Uint8Array, index: number): void {
    if (!this.observedFlags) {
      if (flags.every(flag => flag === 1)) return;
      this.observedFlags = new Uint8Array(this.x.length).fill(1, this.start, index);
    }
    this.observedFlags.set(flags, index);
  }

  /** Writes the source row of a slot, giving the series an explicit index the first time it stops being the identity. */
  setRow(series: SeriesBuffers, index: number, row: number): void {
    if (!series.row) {
      if (row === index + this.rowShift) return;
      this.materializeRows(series);
    }
    series.row![index] = row;
  }

  private materializeRows(series: SeriesBuffers): void {
    const rows = new Int32Array(this.x.length);
    for (let i = this.start; i < this.end; i++) rows[i] = i + this.rowShift;
    series.row = rows;
  }

  reserve(extra: number): boolean {
    const capacity = this.range.reserve(extra, this.x.length);
    const grow = capacity !== 0;
    if (grow) this.resize(capacity, extra);
    // A rival may have claimed the base's tail. Reconstruct that tail before this
    // draft can publish a longer view in which the old slot is no longer special.
    else for (const series of this.series.values()) {
      if (series.tail?.claimed) this.copySeries(series);
    }
    return grow;
  }

  shrink(): void {
    const capacity = this.range.compact(this.x.length);
    if (capacity) this.resize(capacity, 0);
  }

  private resize(capacity: number, extra: number): void {
    const { start, end } = this;
    const x = new Float64Array(capacity);
    x.set(this.x.subarray(start, end));
    this.x = x;
    if (this.observedFlags) {
      const observed = new Uint8Array(capacity);
      observed.set(this.observedFlags.subarray(start, end));
      this.observedFlags = observed;
    }
    if (this.categoryPositions.length > capacity) this.categoryPositions = new Float64Array();
    for (const [key, previous] of this.series) {
      const series = buffers(previous.description, capacity, previous.row !== null);
      series.y.set(previous.y.subarray(start, end));
      series.slot.set(previous.slot.subarray(start, end));
      series.row?.set(previous.row!.subarray(start, end));
      restoreTail(previous.tail, series, end - start - 1);
      this.series.set(key, series);
    }
    this.rowShift += start;
    this.range.rebase(extra);
  }

  copySeries(series: SeriesBuffers): SeriesBuffers {
    const copy = buffers(series.description, this.x.length, series.row !== null);
    const { start, end } = this;
    copy.y.set(series.y.subarray(start, end), start);
    copy.slot.set(series.slot.subarray(start, end), start);
    copy.row?.set(series.row!.subarray(start, end), start);
    restoreTail(series.tail, copy, end - 1);
    this.series.set(series.description.key, copy);
    return copy;
  }

  writeTail(series: SeriesBuffers, hasCompetingWrites: boolean): SeriesBuffers {
    const tail = series.tail;
    // An advanced preview can expose this slot in the middle of its view. After a draw
    // has requested a column, a fill copies that series' window to protect the issued view.
    // Between draws the first writer claims the open slot and only touches the appended rows.
    if (!tail || tail.exposed || hasCompetingWrites) return this.copySeries(series);
    tail.claimed = true;
    series.tail = undefined;
    return series;
  }

  addSeries(description: SeriesDescription, zero: boolean): SeriesBuffers {
    const series = buffers(description, this.x.length);
    series.row!.fill(-1, this.start, this.end);
    if (!zero) {
      series.y.fill(NaN, this.start, this.end);
      series.slot.fill(SLOT_NO_ROW, this.start, this.end);
    }
    this.series.set(description.key, series);
    return series;
  }

  trim(keep: number | undefined, evict: (x: number, observed: boolean) => void): void {
    if (keep === undefined || keep >= this.distinct) return;
    while (this.start < this.end && (this.distinct > keep || !this.observed(this.start))) {
      const observed = this.observed(this.start);
      if (observed) this.distinct--;
      evict(this.x[this.start]!, observed);
      this.range.start++;
    }
  }

  /** Adds the storage this window owns to a byte count. */
  count(bytes: ByteCount): void {
    bytes.add('x', this.x);
    if (this.observedFlags) bytes.add('observed', this.observedFlags);
    if (this.categoryPositions.length) bytes.add('category positions', this.categoryPositions);
    for (const [key, series] of this.series) {
      bytes.add(`series ${key} y`, series.y);
      bytes.add(`series ${key} slot`, series.slot);
      if (series.row) bytes.add(`series ${key} row`, series.row);
    }
  }

  frame(previous: AlignedFrame, axis: XColumn, source: RowSource, open: (key: string) => boolean): AlignedFrame {
    const { start, end } = this;
    let positions = this.x.subarray(start, end);
    if (axis.kind === 'category' && positions[0]) {
      if (this.categoryPositions.length < positions.length) {
        const capacity = Math.max(16, positions.length * 2);
        this.categoryPositions = Float64Array.from({ length: capacity }, (_, i) => i);
      }
      positions = this.categoryPositions.subarray(0, positions.length);
    }
    return {
      ...previous, source, revision: previous.revision, length: end - start,
      x: {
        values: positions, kind: axis.kind, dateUnit: axis.dateUnit,
        timeZone: axis.timeZone, ordered: axis.ordered,
        get categories() { return axis.kind === 'category' && end === start ? [] : axis.categories; },
      },
      series: Array.from(this.series.values(), series => {
        // The frame's null row means "slot i came from row i", which holds only while nothing has shifted.
        if (!series.row && start + this.rowShift !== 0 && end > start) this.materializeRows(series);
        const { description, y, slot, row } = series;
        if (start === end || !open(description.key)) {
          return { ...description, y: y.subarray(start, end), slot: slot.subarray(start, end), row: row?.subarray(start, end) ?? null };
        }
        const index = end - 1;
        if (series.tail?.index !== index) {
          series.tail = { index, exposed: false, claimed: false, y: y[index]!, slot: slot[index]!, row: row ? row[index]! : index + this.rowShift };
        }
        const tail = series.tail;
        let values: Float64Array | undefined;
        let states: Uint8Array | undefined;
        let rows: Int32Array | undefined;
        return {
          ...description,
          get y() { return values ??= readColumn(y, tail, start, end, tail.y); },
          get slot() { return states ??= readColumn(slot, tail, start, end, tail.slot); },
          get row() { return row ? rows ??= readColumn(row, tail, start, end, tail.row) : null; },
        };
      }),
    };
  }
}

function restoreTail(tail: OpenSlot | undefined, series: SeriesBuffers, index: number): void {
  if (!tail?.claimed || index < 0) return;
  series.y[index] = tail.y;
  series.slot[index] = tail.slot;
  // An identity series keeps no index: the claimed slot's row was the identity and still is.
  if (series.row) series.row[index] = tail.row;
}

function readColumn<T extends Float64Array | Uint8Array | Int32Array>(
  data: T, tail: OpenSlot, start: number, end: number, value: number,
): T {
  if (!tail.claimed) {
    tail.exposed = true;
    return data.subarray(start, end) as T;
  }
  const snapshot = data.slice(start, end) as T;
  snapshot[snapshot.length - 1] = value;
  return snapshot;
}
