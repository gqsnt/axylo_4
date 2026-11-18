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
  private categoryPositions = new Float64Array();
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

  reserve(extra: number): boolean {
    if (this.end + extra <= this.x.length) return false;
    this.resize(extra);
    return true;
  }

  shrink(): void {
    if (this.x.length > Math.max(32, 4 * (this.end - this.start))) this.resize(0);
  }

  private resize(extra: number): void {
    const { start, end } = this;
    const count = end - start;
    const capacity = Math.max(16, 2 * (count + extra));
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
    this.start = 0;
    this.end = count;
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
      this.start++;
    }
  }

  frame(previous: AlignedFrame, axis: XColumn, source: RowSource, open?: (key: string) => boolean): AlignedFrame {
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
      series: Array.from(this.series.values(), ({ description, y, slot, row }) => {
        if (end === start || !open?.(description.key)) {
          return { ...description, y: y.subarray(start, end), slot: slot.subarray(start, end), row: row.subarray(start, end) };
        }
        // The last x may still receive an observation. Copy its older view only if a reader asks for it.
        const tailY = y[end - 1]!;
        const tailSlot = slot[end - 1]!;
        const tailRow = row[end - 1]!;
        let values: Float64Array | undefined;
        let states: Uint8Array | undefined;
        let rows: Int32Array | undefined;
        return {
          ...description,
          get y() {
            if (!values) {
              values = y.slice(start, end);
              values[values.length - 1] = tailY;
            }
            return values;
          },
          get slot() {
            if (!states) {
              states = slot.slice(start, end);
              states[states.length - 1] = tailSlot;
            }
            return states;
          },
          get row() {
            if (!rows) {
              rows = row.slice(start, end);
              rows[rows.length - 1] = tailRow;
            }
            return rows;
          },
        };
      }),
    };
  }
}
