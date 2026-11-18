import type { DiagnosticInput } from '../core/contracts';
import { createDiagnostic } from '../diagnostics';
import { dailyDelta, DAY, HOUR, sameDailyTime } from './x';

function phase(position: number, shift: number): number {
  return ((position % DAY + DAY) % DAY + shift) % DAY;
}

function daily(a: number, b: number): boolean {
  const delta = dailyDelta(b - a);
  return delta >= DAY && delta % DAY === 0;
}

class PhaseExtreme {
  private positions: number[] = [];
  private start = 0;

  constructor(private readonly shift: number, private readonly direction: 1 | -1) {}

  add(position: number): void {
    const target = this.direction * phase(position, this.shift);
    while (this.positions.length > this.start &&
      this.direction * phase(this.positions.at(-1)!, this.shift) >= target) {
      this.positions.pop();
    }
    this.positions.push(position);
  }

  evict(position: number): void {
    if (this.positions[this.start] === position) this.start++;
    if (2 * this.start >= this.positions.length) {
      this.positions = this.positions.slice(this.start);
      this.start = 0;
    }
  }

  value(): number {
    return phase(this.positions[this.start]!, this.shift);
  }
}

export class CalendarWindow {
  private readonly extremes = [0, DAY / 2].map(shift => ({
    min: new PhaseExtreme(shift, 1), max: new PhaseExtreme(shift, -1),
  }));

  private readonly rows = new Set<number>();
  private readonly breaks = new Set<number>();
  private last = -Infinity;
  private distinct = 0;

  observe(position: number): void {
    if (position === this.last) return;
    if (this.distinct && !daily(this.last, position)) this.breaks.add(this.last);
    for (const { min, max } of this.extremes) {
      min.add(position);
      max.add(position);
    }
    this.last = position;
    this.distinct++;
  }

  record(row: number): void {
    this.rows.add(row);
  }

  evictPosition(position: number): void {
    this.breaks.delete(position);
    for (const { min, max } of this.extremes) {
      min.evict(position);
      max.evict(position);
    }
    if (--this.distinct === 0) this.last = -Infinity;
  }

  evictRow(row: number): void {
    this.rows.delete(row);
  }

  private matches(first: number): boolean {
    if (this.breaks.size) return false;
    if (this.distinct < 2) return true;
    // Two origins let us compare clock times near midnight without displacing a value by a whole day.
    const clock = phase(first, 0);
    const shifted = clock < HOUR || clock > DAY - HOUR;
    const mid = shifted ? phase(first, DAY / 2) : clock;
    const { min, max } = this.extremes[Number(shifted)]!;
    return mid - min.value() <= HOUR && max.value() - mid <= HOUR;
  }

  private firstRows(): number[] {
    const rows: number[] = [];
    for (const row of this.rows) {
      if (rows.length === 10) break;
      rows.push(row);
    }
    return rows;
  }

  diagnostic(field: string, first: number): DiagnosticInput | null {
    return this.distinct >= 2 && this.matches(first)
      ? createDiagnostic('AX111', 'none', { field, count: this.rows.size, rows: this.firstRows() })
      : null;
  }

  preview(field: string, first: number, positions: Float64Array, nextRow: number): DiagnosticInput | null {
    if (!this.matches(first)) return null;
    let anchor = first;
    let last = this.last;
    let appended = 0;
    const rows = this.firstRows();
    for (let i = 0; i < positions.length; i++) {
      const position = positions[i]!;
      if (!Number.isFinite(position)) continue;
      if (Number.isFinite(last) && last !== position && (!daily(last, position) || !sameDailyTime(anchor, position))) return null;
      if (!Number.isFinite(last)) anchor = position;
      last = position;
      appended++;
      if (rows.length < 10) rows.push(nextRow + i);
    }
    return appended && last !== anchor
      ? createDiagnostic('AX111', 'none', { field, count: this.rows.size + appended, rows })
      : null;
  }
}
