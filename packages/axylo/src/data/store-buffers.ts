import { BufferWindow } from './store-window';
import { SLOT_NO_ROW, type AlignedFrame, type RowSource, type Series, type XColumn } from '../core/contracts';

interface OpenSlot {
  readonly index: number;
  exposed: boolean;
  changed: boolean;
}

type SeriesDescription = Omit<Series, 'y' | 'slot' | 'row'>;
export interface SeriesBuffers {
  description: SeriesDescription;
  y: Float64Array;
  slot: Uint8Array;
  row: Int32Array;
  tail?: OpenSlot;
}

function buffers(description: SeriesDescription, capacity: number): SeriesBuffers {
  return { description, y: new Float64Array(capacity), slot: new Uint8Array(capacity), row: new Int32Array(capacity) };
}

export class FrameBuffers {
  x: Float64Array;
  observed: Uint8Array;
  private categoryPositions = new Float64Array();
  readonly series = new Map<string, SeriesBuffers>();
  private range: BufferWindow;

  get start(): number { return this.range.start; }
  get end(): number { return this.range.end; }
  set end(end: number) { this.range.end = end; }
  distinct: number;

  constructor(frame?: AlignedFrame, positions?: Float64Array, order: Int32Array | null = null) {
    this.range = new BufferWindow(0, frame?.length ?? 0);
    this.distinct = 0;
    const capacity = Math.max(16, this.end * 2);
    this.x = new Float64Array(capacity);
    this.observed = new Uint8Array(capacity);
    if (!frame || !positions) return;
    this.x.set(frame.x.values);
    let slot = 0;
    const length = order?.length ?? positions.length;
    for (let i = 0; i < length; i++) {
      const x = positions[order?.[i] ?? i]!;
      while (slot < this.end && this.x[slot]! < x) slot++;
      if (slot < this.end && this.x[slot] === x && !this.observed[slot]) {
        this.observed[slot] = 1;
        this.distinct++;
      }
    }
    for (const { row, slot, y, ...description } of frame.series) {
      const series = buffers(description, capacity);
      series.y.set(y);
      series.slot.set(slot);
      if (row) series.row.set(row);
      else for (let i = 0; i < this.end; i++) series.row[i] = i;
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

  reserve(extra: number): boolean {
    const capacity = this.range.reserve(extra, this.x.length);
    if (capacity) this.resize(capacity, extra);
    return capacity !== 0;
  }

  shrink(): void {
    const capacity = this.range.compact(this.x.length);
    if (capacity) this.resize(capacity, 0);
  }

  private resize(capacity: number, extra: number): void {
    const { start, end } = this;
    const x = new Float64Array(capacity);
    const observed = new Uint8Array(capacity);
    x.set(this.x.subarray(start, end));
    observed.set(this.observed.subarray(start, end));
    this.x = x;
    this.observed = observed;
    if (this.categoryPositions.length > capacity) this.categoryPositions = new Float64Array();
    for (const [key, previous] of this.series) {
      const series = buffers(previous.description, capacity);
      series.y.set(previous.y.subarray(start, end));
      series.slot.set(previous.slot.subarray(start, end));
      series.row.set(previous.row.subarray(start, end));
      this.series.set(key, series);
    }
    this.range.rebase(extra);
  }

  copySeries(series: SeriesBuffers): SeriesBuffers {
    const copy = buffers(series.description, this.x.length);
    const { start, end } = this;
    copy.y.set(series.y.subarray(start, end), start);
    copy.slot.set(series.slot.subarray(start, end), start);
    copy.row.set(series.row.subarray(start, end), start);
    this.series.set(series.description.key, copy);
    return copy;
  }

  writeTail(series: SeriesBuffers, prepared: boolean): SeriesBuffers {
    if (prepared || series.tail?.exposed) return this.copySeries(series);
    if (series.tail) series.tail.changed = true;
    series.tail = undefined;
    return series;
  }

  addSeries(description: SeriesDescription, zero: boolean): SeriesBuffers {
    const series = buffers(description, this.x.length);
    series.row.fill(-1, this.start, this.end);
    if (!zero) {
      series.y.fill(NaN, this.start, this.end);
      series.slot.fill(SLOT_NO_ROW, this.start, this.end);
    }
    this.series.set(description.key, series);
    return series;
  }

  trim(keep: number | undefined, evict: (x: number, observed: boolean) => void): void {
    if (keep === undefined || keep >= this.distinct) return;
    while (this.start < this.end && (this.distinct > keep || !this.observed[this.start])) {
      const observed = this.observed[this.start] === 1;
      if (observed) this.distinct--;
      evict(this.x[this.start]!, observed);
      this.range.start++;
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
        const { description, y, slot, row } = series;
        if (start === end || !open(description.key)) {
          return { ...description, y: y.subarray(start, end), slot: slot.subarray(start, end), row: row.subarray(start, end) };
        }
        const index = end - 1;
        if (series.tail?.index !== index) series.tail = { index, exposed: false, changed: false };
        const tail = series.tail;
        // Keep open slots cheap to read. A writer can reuse an unexposed slot, and the
        // older frame then reconstructs that column only if someone opens it later.
        const tailY = y[index]!;
        const tailSlot = slot[index]!;
        const tailRow = row[index]!;
        let values: Float64Array | undefined;
        let states: Uint8Array | undefined;
        let rows: Int32Array | undefined;
        return {
          ...description,
          get y() { return values ??= readColumn(y, tail, start, end, tailY); },
          get slot() { return states ??= readColumn(slot, tail, start, end, tailSlot); },
          get row() { return rows ??= readColumn(row, tail, start, end, tailRow); },
        };
      }),
    };
  }
}

function readColumn<T extends Float64Array | Uint8Array | Int32Array>(
  data: T, tail: OpenSlot, start: number, end: number, value: number,
): T {
  if (!tail.changed) {
    tail.exposed = true;
    return data.subarray(start, end) as T;
  }
  const snapshot = data.slice(start, end) as T;
  snapshot[snapshot.length - 1] = value;
  return snapshot;
}
