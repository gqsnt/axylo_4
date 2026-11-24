import type { DiagnosticInput } from '../core/contracts';
import { createDiagnostic } from '../diagnostics';
import { StoreMap } from './store-map';
import { calendarIntervals } from './steps';

export class CalendarWindow {
  #rows = new StoreMap<number, true>();
  #utcBreaks = new StoreMap<number, true>();
  #localBreaks = new StoreMap<number, true>();
  #last = -Infinity;
  #distinct = 0;

  constructor(private readonly zone: string = 'UTC') {}

  fork(): CalendarWindow {
    const draft = new CalendarWindow(this.zone);
    draft.#rows = this.#rows.fork();
    draft.#utcBreaks = this.#utcBreaks.fork();
    draft.#localBreaks = this.#localBreaks.fork();
    draft.#last = this.#last;
    draft.#distinct = this.#distinct;
    return draft;
  }

  commit(): void {
    this.#rows.commit();
    this.#utcBreaks.commit();
    this.#localBreaks.commit();
  }

  observe(position: number): void {
    if (position === this.#last) return;
    if (this.#distinct) {
      const interval = calendarIntervals(this.#last, position, this.zone);
      if (!(interval & 1)) this.#utcBreaks.set(this.#last, true);
      if (!(interval & 2)) this.#localBreaks.set(this.#last, true);
    }
    this.#last = position;
    this.#distinct++;
  }

  record(row: number): void {
    this.#rows.set(row, true);
  }

  evictPosition(position: number): void {
    this.#utcBreaks.delete(position);
    this.#localBreaks.delete(position);
    if (--this.#distinct === 0) this.#last = -Infinity;
  }

  evictRow(row: number): void {
    this.#rows.delete(row);
  }

  #matches(): number {
    return (this.#utcBreaks.size ? 0 : 1) | (this.#localBreaks.size ? 0 : 2);
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

  preview(field: string, first: number, positions: Float64Array, nextRow: number): DiagnosticInput | null {
    let matches = this.#matches();
    if (!matches || this.#distinct > 0 && !Number.isFinite(first)) return null;
    let last = this.#last;
    let distinct = this.#distinct;
    let appended = 0;
    const rows = this.#firstRows();
    for (let i = 0; i < positions.length; i++) {
      const position = positions[i]!;
      if (!Number.isFinite(position)) continue;
      if (position !== last) {
        if (distinct) matches &= calendarIntervals(last, position, this.zone);
        if (!matches) return null;
        distinct++;
        last = position;
      }
      appended++;
      if (rows.length < 10) rows.push(nextRow + i);
    }
    return appended && distinct >= 2
      ? createDiagnostic('AX111', 'none', { field, count: this.#rows.size + appended, rows })
      : null;
  }
}
