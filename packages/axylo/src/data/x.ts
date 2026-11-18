import type { DiagnosticInput, Environment, XColumn, XKind } from '../core/contracts';
import { DiagnosticCollector, report, type DiagnosticCode } from '../diagnostics';
import { diagnosticContext } from '../diagnostics/registry';
import type { XValue } from '../public';
import { canonicalZone, type ResolvedXField } from './options';
import { Reports } from './reports';
import type { Table } from './table';

const calendar = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;
const dateTime = /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?([Zz]|[+-]\d{2}:?\d{2})?$/;
const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const maxInstant = 8_640_000_000_000_000;
export const DAY = 86_400_000;
export const HOUR = 3_600_000;
export type DateUnit = NonNullable<XColumn['dateUnit']>;

export interface XAxisMeta extends Pick<XColumn, 'kind' | 'categories' | 'timeZone'> {
  readonly field?: ResolvedXField;
}

export interface XPositionParser {
  position(value: XValue): number | null;
  readonly reports: readonly DiagnosticInput[];
}

/**
 * Converts author values to positions on a resolved axis. Categories must already exist.
 * Reports accumulate by code and field for this parser and have no source row provenance.
 */
export function createXParser(axis: XAxisMeta, environment: Pick<Environment, 'timeZone'>): XPositionParser {
  const field = axis.field ?? {
    field: 'x', label: 'x', unit: null, type: axis.kind === 'wall' || axis.kind === 'number' ? null : axis.kind,
    timeZone: 'local', ordered: false, format: null, tickFormat: null, domain: null,
  };
  const parser = new XParser({ ...field, timeZone: axis.timeZone ?? field.timeZone }, axis.kind, environment);
  const categories = new Map(axis.categories?.map((label, index) => [label, index]));
  const diagnostics = new DiagnosticCollector();
  return {
    position(value) {
      if (axis.kind === 'category') {
        const name = nameOf(value);
        const index = name === null ? undefined : categories.get(name);
        if (index !== undefined) return index;
        report(diagnostics, 'AX107', 'none', { field: field.field, rows: [], outcome: 'The option is ignored.' });
        return null;
      }
      const reports = new Reports(field.field);
      const position = parser.read(value, -1, reports);
      reports.flush({ add(diagnostic) {
        const { code, count, effect } = diagnostic;
        const context = diagnosticContext(diagnostic);
        report(diagnostics, code as DiagnosticCode, 'none', {
          ...context, field: field.field, count, rows: [], outcome: effect === 'omitted' ? 'The option is ignored.' : context?.outcome,
        });
      } });
      return Number.isFinite(position) ? position : null;
    },
    get reports() { return diagnostics.inputs(); },
  };
}

export function dateUnitOf(value: unknown): DateUnit {
  if (typeof value === 'string' && calendar.test(value)) {
    if (value.length === 4) return 'year';
    if (value.length === 7) return 'month';
  }
  return 'day';
}

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
  if (/^\d{4}-\d{2}-\d{2}[Tt ]/.test(value)) return /(?:[Zz]|[+-]\d{2}:?\d{2})$/.test(value) ? 'time' : 'wall';
  return 'category';
}

function instant(value: string, kind: 'time' | 'wall'): number {
  const parts = dateTime.exec(value);
  if (!parts || !validDate(parts[1]!, parts[2], parts[3]) || (kind === 'time') !== Boolean(parts[8])) return NaN;
  const iso = value[10] === ' ' ? value.slice(0, 10) + 'T' + value.slice(11) : value;
  return Date.parse(kind === 'wall' ? iso + 'Z' : iso);
}

const kinds = ['date', 'time', 'wall', 'number', 'category'] as const;
export type KindVotes = Record<XKind, number>;

export function countKinds(table: Table, field: string, series: string | null = null): KindVotes {
  const votes: KindVotes = { date: 0, time: 0, wall: 0, number: 0, category: 0 };
  const column = table.columns?.[field];
  if (series === null && (column instanceof Float64Array || column instanceof Float32Array)) {
    for (const value of column) {
      if (Number.isFinite(value)) votes.number++;
      else if (!Number.isNaN(value)) votes.category++;
    }
    return votes;
  }
  for (let i = 0; i < table.length; i++) {
    if (series !== null && nameOf(table.read(i, series)) === null) continue;
    const value = table.read(i, field);
    if (value == null || value === '' || Number.isNaN(value) && table.isColumnRow(i)) continue;
    votes[kindOf(value) ?? 'category']++;
  }
  return votes;
}

export function preferredKind(votes: KindVotes): XKind | null {
  const { date, time, wall, number, category } = votes;
  const recognized = date + time + wall + number;
  if (recognized + category === 0) return null;
  if (category >= recognized) return 'category';
  // Use a fixed order for ties so reordering records cannot change which values are drawn.
  return kinds.find(kind => kind !== 'category' && votes[kind] === Math.max(date, time, wall, number))!;
}

export function inferKind(table: Table, field: string, series: string | null = null): XKind | null {
  return preferredKind(countKinds(table, field, series));
}

export function nameOf(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

export class XParser {
  readonly timeZone: string | null;
  private names: string[] | null;
  private firstCategory = 0;
  private firstIndex = 0;
  private readonly indexes: Map<string, number> | null;
  dateUnit: DateUnit | null = null;

  constructor(
    readonly field: ResolvedXField,
    readonly kind: XKind,
    env: Pick<Environment, 'timeZone'>,
    private readonly scatter = false,
    categories?: readonly string[],
  ) {
    this.timeZone = kind === 'time'
      ? (field.timeZone === 'local' ? undefined : canonicalZone(field.timeZone)) ??
        canonicalZone(env.timeZone) ?? Intl.DateTimeFormat().resolvedOptions().timeZone
      : null;
    this.names = kind === 'category' ? [...(categories ?? [])] : null;
    this.indexes = this.names ? new Map(this.names.map((name, index) => [name, index])) : null;
  }

  get categories(): string[] | null {
    return this.names && (this.firstCategory === 0 ? this.names : this.names.slice(this.firstCategory));
  }

  get categoryCount(): number {
    return (this.names?.length ?? 0) - this.firstCategory;
  }

  categoryName(position: number): string | undefined {
    return this.names?.[position - this.firstIndex + this.firstCategory];
  }

  fork(): XParser {
    const draft = new XParser(this.field, this.kind, { timeZone: this.timeZone ?? 'UTC' }, this.scatter, this.categories ?? undefined);
    draft.dateUnit = this.dateUnit;
    draft.firstIndex = this.firstIndex;
    if (draft.indexes && this.firstIndex !== 0) {
      for (const [name, index] of draft.indexes) draft.indexes.set(name, index + this.firstIndex);
    }
    return draft;
  }

  evictCategories(count: number): void {
    if (!this.names) return;
    for (let i = 0; i < count; i++) {
      this.indexes!.delete(this.names[this.firstCategory++]!);
      this.firstIndex++;
    }
    if (2 * this.firstCategory >= this.names.length) {
      this.names = this.names.slice(this.firstCategory);
      this.firstCategory = 0;
    }
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
      const index = this.firstIndex + this.categoryCount;
      this.names!.push(name);
      this.indexes!.set(name, index);
      return index;
    }
    if (kind === 'date' && this.field.type === 'date' && (typeof raw === 'number' || raw instanceof Date ||
      typeof raw === 'string' && kindOf(raw) === 'time')) {
      const ms = typeof raw === 'number' ? new Date(raw).getTime() : raw instanceof Date ? raw.getTime() : instant(raw, 'time');
      if (!Number.isFinite(ms)) return NaN;
      this.dateUnit = 'day';
      return Math.floor(ms / DAY) * DAY;
    }
    if (typeof raw !== 'string') return NaN;
    if (kind === 'date') {
      const parts = calendar.exec(raw);
      if (!parts || !validDate(parts[1]!, parts[2], parts[3])) return NaN;
      const unit: DateUnit = parts[3] !== undefined ? 'day' : parts[2] !== undefined ? 'month' : 'year';
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

  read(raw: unknown, row: number, reports: Reports, omitted = 1): number {
    if (raw === undefined) {
      reports.add('AX102', 'omitted', row, undefined, undefined, { amount: omitted, outcome: 'The affected row is not drawn.' });
      return NaN;
    }
    const result = this.parse(raw, row, reports);
    if (!Number.isFinite(result)) {
      const fix = this.scatter && this.kind === 'category'
        ? 'Use a numeric, calendar date or time field for scatter x values.'
        : undefined;
      reports.add('AX107', 'omitted', row, raw, fix, { amount: omitted });
    }
    return result;
  }

  restore(categoryCount: number, dateUnit: DateUnit | null): void {
    this.dateUnit = dateUnit;
    if (!this.names) return;
    while (this.categoryCount > categoryCount) this.indexes!.delete(this.names.pop()!);
  }

  column(values: Float64Array, snapshotCategories = false): XColumn {
    const names = this.names;
    const start = this.firstCategory;
    const length = names?.length;
    let snapshot: readonly string[] | undefined;
    return {
      kind: this.kind, values,
      get categories() {
        return names === null || !snapshotCategories && start === 0 ? names : (snapshot ??= names.slice(start, length));
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

const positionFormats = new Map<string, Intl.DateTimeFormat>();

export function positionName(axis: Pick<XColumn, 'kind' | 'dateUnit' | 'timeZone' | 'categories'>, position: number): string {
  if (axis.kind === 'category') return JSON.stringify(axis.categories?.[position] ?? position);
  if (axis.kind === 'number') return String(position);
  if (axis.kind === 'time') {
    const zone = axis.timeZone ?? 'UTC';
    if (zone === 'UTC') return new Date(position).toISOString();
    let format = positionFormats.get(zone);
    if (!format) {
      format = new Intl.DateTimeFormat('en-CA', {
        timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, hourCycle: 'h23',
      });
      positionFormats.set(zone, format);
    }
    return format.format(position) + ' ' + zone;
  }
  const iso = new Date(position).toISOString();
  if (axis.kind === 'wall') return iso.slice(0, -1);
  return iso.slice(0, axis.dateUnit === 'year' ? -20 : axis.dateUnit === 'month' ? -17 : -14);
}
