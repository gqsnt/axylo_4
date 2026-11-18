import { SLOT_NO_ROW, type AlignedFrame, type RowSource, type Series, type XColumn } from '../core/contracts';

type SeriesDescription = Omit<Series, 'y' | 'slot' | 'row'>;
export interface SeriesBuffers {
  description: SeriesDescription;
  y: Float64Array;
  slot: Uint8Array;
  row: Int32Array;
}

function buffers(description: SeriesDescription, capacity: number): SeriesBuffers {
  return { description, y: new Float64Array(capacity), slot: new Uint8Array(capacity), row: new Int32Array(capacity) };
}

export class FrameBuffers {
  x: Float64Array;
  observed: Uint8Array;
  readonly series = new Map<string, SeriesBuffers>();
  start = 0;
  end: number;
  distinct: number;

  constructor(frame: AlignedFrame, positions: Float64Array, order: Int32Array | null) {
    this.end = frame.length;
    this.distinct = 0;
    const capacity = Math.max(16, this.end * 2);
    this.x = new Float64Array(capacity);
    this.x.set(frame.x.values);
    this.observed = new Uint8Array(capacity);
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

  reserve(extra: number): void {
    if (this.end + extra <= this.x.length) return;
    const { start, end } = this;
    const count = end - start;
    const capacity = Math.max(16, 2 * (count + extra));
    const x = new Float64Array(capacity);
    const observed = new Uint8Array(capacity);
    x.set(this.x.subarray(start, end));
    observed.set(this.observed.subarray(start, end));
    this.x = x;
    this.observed = observed;
    for (const [key, previous] of this.series) {
      const series = buffers(previous.description, capacity);
      series.y.set(previous.y.subarray(start, end));
      series.slot.set(previous.slot.subarray(start, end));
      series.row.set(previous.row.subarray(start, end));
      this.series.set(key, series);
    }
    this.start = 0;
    this.end = count;
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

  trim(keep: number | undefined, evict: (x: number) => void): void {
    if (keep === undefined || keep >= this.distinct) return;
    while (this.start < this.end && (this.distinct > keep || !this.observed[this.start])) {
      if (this.observed[this.start]) {
        this.distinct--;
        evict(this.x[this.start]!);
      }
      this.start++;
    }
  }

  frame(previous: AlignedFrame, axis: XColumn, source: RowSource): AlignedFrame {
    const { start, end } = this;
    return {
      ...previous, source, revision: previous.revision, length: end - start,
      x: { ...axis, values: this.x.subarray(start, end) },
      series: Array.from(this.series.values(), ({ description, y, slot, row }) => ({
        ...description, y: y.subarray(start, end), slot: slot.subarray(start, end), row: row.subarray(start, end),
      })),
    };
  }
}
