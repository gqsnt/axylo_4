import type { DiagnosticInput } from '../core/contracts';
import { createDiagnostic } from '../diagnostics';
import { StoreMap } from './store-map';
import { calendarIntervals } from './steps';

export class CalendarWindow {
  #rows: StoreMap<number, true> = new StoreMap();
  // Evictions walk the ordered window from the front. When its newest break leaves, every older break has left.
  #utcBreak = -Infinity;
  #localBreak = -Infinity;
  #last = -Infinity;
  #distinct = 0;

  constructor(private readonly zone: string = 'UTC') {}

  fork(): CalendarWindow {
    const draft = new CalendarWindow(this.zone);
    draft.#rows = this.#rows.fork();
    draft.#utcBreak = this.#utcBreak;
    draft.#localBreak = this.#localBreak;
    draft.#last = this.#last;
    draft.#distinct = this.#distinct;
    return draft;
  }

  commit(): void {
    this.#rows = this.#rows.commit();
  }

  observe(position: number): void {
    if (position === this.#last) return;
    if (this.#distinct) {
      const interval = calendarIntervals(this.#last, position, this.zone);
      if (!(interval & 1)) this.#utcBreak = this.#last;
      if (!(interval & 2)) this.#localBreak = this.#last;
    }
    this.#last = position;
    this.#distinct++;
  }

  record(row: number): void {
    this.#rows.set(row, true);
  }

  evictPosition(position: number): void {
    if (position === this.#utcBreak) this.#utcBreak = -Infinity;
    if (position === this.#localBreak) this.#localBreak = -Infinity;
    if (--this.#distinct === 0) this.#last = -Infinity;
  }

  evictRow(row: number): void {
    this.#rows.delete(row);
  }

  #matches(): number {
    return (this.#utcBreak === -Infinity ? 1 : 0) | (this.#localBreak === -Infinity ? 2 : 0);
  }

  #firstRows(): number[] {
    const rows: number[] = [];
    for (const row of this.#rows.keys()) {
      if (rows.length === 10) break;
      rows.push(row);
    }
    return rows;
  }

  daily(): boolean {
    return this.#distinct >= 2 && this.#matches() !== 0;
  }

  diagnostic(field: string, first: number): DiagnosticInput | null {
    return Number.isFinite(first) && this.daily()
      ? createDiagnostic('AX111', 'none', { field, count: this.#rows.size, rows: this.#firstRows() })
      : null;
  }

  append(field: string, first: number, positions: Float64Array, nextRow: number): DiagnosticInput | null {
    const visible = !this.#distinct || Number.isFinite(first);
    const before = this.#rows.size;
    for (let i = 0; i < positions.length; i++) {
      const position = positions[i]!;
      if (Number.isFinite(position)) {
        this.observe(position);
        this.record(nextRow + i);
      }
    }
    return visible && this.#rows.size > before ? this.diagnostic(field, 0) : null;
  }
}
