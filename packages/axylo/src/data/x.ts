import type { Environment, XColumn, XKind } from '../core/contracts';
import type { ResolvedXField } from './options';
import { Reports } from './reports';
import type { Table } from './table';

const calendar = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;
const dateTime = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?([Zz]|[+-]\d{2}:?\d{2})?$/;
const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const maxInstant = 8_640_000_000_000_000;
export const DAY = 86_400_000;
export const HOUR = 3_600_000;
export type DateUnit = NonNullable<XColumn['dateUnit']>;

function validDate(year: string, month = '01', day = '01'): boolean {
  const m = Number(month);
  const y = Number(year);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const max = (daysInMonth[m - 1] ?? 0) + (m === 2 && leap ? 1 : 0);
  return Number(day) >= 1 && Number(day) <= max;
}

export function kindOf(value: unknown): XKind | null {
  if (typeof value === 'number') return Number.isFinite(value) ? 'number' : null;
  if (value instanceof Date) return 'time';
  if (typeof value !== 'string') return null;
  if (calendar.test(value)) return 'date';
  const parts = dateTime.exec(value);
  if (parts) return parts[8] ? 'time' : 'wall';
  // An invalid ISO-looking value should be reported rather than establishing a category axis.
  if (/^\d{4}-\d{2}-\d{2}[Tt]/.test(value)) return 'wall';
  return 'category';
}

function instant(value: string, kind: 'time' | 'wall'): number {
  const parts = dateTime.exec(value);
  if (!parts || !validDate(parts[1]!, parts[2], parts[3]) || (kind === 'time') !== Boolean(parts[8])) return NaN;
  return Date.parse(kind === 'wall' ? value + 'Z' : value);
}

export function inferKind(table: Table, field: string, series: string | null = null): XKind | null {
  let candidate: XKind | null = null;
  for (let i = 0; i < table.length; i++) {
    if (series !== null && nameOf(table.read(i, series)) === null) continue;
    const value = table.read(i, field);
    const kind = kindOf(value);
    candidate ??= kind;
    if (kind === 'number' || kind === 'category') return kind;
    if (kind === 'date' && typeof value === 'string') {
      const parts = calendar.exec(value)!;
      if (validDate(parts[1]!, parts[2], parts[3])) return kind;
    } else if (value instanceof Date && Number.isFinite(value.getTime())) {
      return 'time';
    } else if ((kind === 'time' || kind === 'wall') && typeof value === 'string' && Number.isFinite(instant(value, kind))) {
      return kind;
    }
  }
  return candidate;
}

export function nameOf(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

export class XParser {
  readonly timeZone: string | null;
  readonly categories: string[] | null;
  private readonly indexes: Map<string, number> | null;
  dateUnit: DateUnit | null = null;

  constructor(
    readonly field: ResolvedXField,
    readonly kind: XKind,
    env: Pick<Environment, 'timeZone'>,
    private readonly scatter = false,
    categories?: readonly string[],
  ) {
    this.timeZone = kind === 'time' ? (field.timeZone === 'local' ? env.timeZone : field.timeZone) : null;
    this.categories = kind === 'category' ? [...(categories ?? [])] : null;
    this.indexes = this.categories ? new Map(this.categories.map((name, index) => [name, index])) : null;
  }

  private parse(raw: unknown, row: number, reports: Reports): number {
    const kind = this.kind;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      if (kind === 'number' && !this.field.type && Math.abs(raw) >= 1e11 && Math.abs(raw) < 1e14) {
        reports.add('AX109', 'none', row, undefined, 'Set type: \'time\' if these values are epoch milliseconds.');
      }
      if (kind === 'time' && this.field.type === 'time' && Math.abs(raw) >= 1e9 && Math.abs(raw) < 1e10) {
        reports.add('AX109', 'none', row, undefined, 'These values look like seconds. Multiply them by 1,000 to supply epoch milliseconds.');
      }
      if (kind === 'number' || kind === 'time' && this.field.type === 'time' && Math.abs(raw) <= maxInstant) return raw;
    }
    if (kind === 'time' && raw instanceof Date) return raw.getTime();
    if (kind === 'category' && !this.scatter) {
      const name = this.field.type === 'category' ? nameOf(raw) : typeof raw === 'string' && kindOf(raw) === 'category' ? raw : null;
      if (name === null) return NaN;
      const known = this.indexes!.get(name);
      if (known !== undefined) return known;
      const index = this.categories!.length;
      this.categories!.push(name);
      this.indexes!.set(name, index);
      return index;
    }
    if (typeof raw !== 'string') return NaN;
    if (kind === 'date') {
      const parts = calendar.exec(raw);
      if (!parts || !validDate(parts[1]!, parts[2], parts[3])) return NaN;
      const unit = parts[3] !== undefined ? 'day' : parts[2] !== undefined ? 'month' : 'year';
      if (this.dateUnit === null || unit === 'day' || unit === 'month' && this.dateUnit === 'year') this.dateUnit = unit;
      return Date.parse(parts[1] + '-' + (parts[2] ?? '01') + '-' + (parts[3] ?? '01') + 'T00:00:00Z');
    }
    if (kind === 'wall' || kind === 'time') {
      const position = instant(raw, kind);
      if (kind === 'wall' && Number.isFinite(position)) reports.add('AX112', 'none', row);
      return position;
    }
    return NaN;
  }

  read(raw: unknown, row: number, reports: Reports): number {
    if (raw === undefined) {
      reports.add('AX102', 'omitted', row);
      return NaN;
    }
    const result = this.parse(raw, row, reports);
    if (!Number.isFinite(result)) {
      const fix = this.scatter && this.kind === 'category'
        ? 'Use a numeric, calendar date or time field for scatter x values.'
        : undefined;
      reports.add('AX107', 'omitted', row, raw, fix);
    }
    return result;
  }

  restore(categoryCount: number, dateUnit: DateUnit | null): void {
    this.dateUnit = dateUnit;
    if (!this.categories) return;
    while (this.categories.length > categoryCount) this.indexes!.delete(this.categories.pop()!);
  }

  column(values: Float64Array, snapshotCategories = false): XColumn {
    const names = this.categories;
    const length = names?.length;
    let snapshot: readonly string[] | undefined;
    return {
      kind: this.kind, values,
      get categories() {
        return names === null || !snapshotCategories ? names : (snapshot ??= names.slice(0, length));
      },
      timeZone: this.timeZone, dateUnit: this.kind === 'date' ? this.dateUnit ?? 'day' : null,
      ordered: this.kind === 'category' && this.field.ordered,
    };
  }
}

export function dailyDelta(delta: number): number {
  const days = Math.round(delta / DAY);
  return days > 0 && Math.abs(delta - days * DAY) <= HOUR ? days * DAY : delta;
}

export function sameDailyTime(first: number, position: number): boolean {
  const delta = position - first;
  return Math.abs(delta - Math.round(delta / DAY) * DAY) <= HOUR;
}
