/**
 * Bubble options, the size column and the bubble diagnostics (AX187–AX189).
 *
 * The size field is not one of the controller's encoding keys (core/stages.ts ENCODING_KEYS), so an update that
 * changes only `size` or `radius` keeps the frame. Everything about sizes is therefore read where every update
 * path passes: the composition's `resolve` stage. It reads the size column from the resolved table (the caller's
 * rows, or the borrowed typed column), memoized by table and field so a title update reads no row, and reports
 * the size findings into the option sink, which the controller regenerates on every call (it keeps only AX100 and
 * AX101 from an earlier call). A strict chart therefore rejects a size patch from the call that made it.
 */
import type { DiagnosticInput, DiagnosticSink } from '../../core/contracts';
import type { BubbleOptions } from '../../spatial';
import { report } from '../../diagnostics';
import type { ResolvedOptions } from '../../data/options';
import type { Table } from '../../data/table';
import type { NumberFormatOption } from '../../format';

// Declared in the entry file (spatial.ts): the package ships that declaration file, not this module's.
export type { BubbleOptions, BubbleRadius, SizeField, SizeFieldOptions } from '../../spatial';

export const DEFAULT_MIN_RADIUS = 2;
export const DEFAULT_MAX_RADIUS = 24;
/** Bubbles drawn above this count raise AX189 (a hint): their discs cover each other. */
export const DENSE_BUBBLES = 10_000;

/** Per source row: 0 a size (finite, ≥ 0), 1 no data (null, ''), 2 not drawable (reported: AX187, AX102, AX106). */
export const SIZE_OK = 0;
export const SIZE_NULL = 1;
export const SIZE_INVALID = 2;

/** The size of every source row, read once per (table, field, parse). */
export interface SizeColumn {
  /** Raw numeric size per source row; NaN where it is not a number. May be the caller's own typed column. */
  readonly values: Float64Array | Float32Array;
  /** null when every row holds a size. */
  readonly state: Uint8Array | null;
  /** Rows with a size, and of those, rows whose size is zero. */
  readonly sized: number;
  readonly zeros: number;
  /** Rows without the key. */
  readonly absent: number;
  /** No row (or typed column) has the field: the size setting names nothing, reported by resolveBubble. */
  readonly missing: boolean;
  readonly findings: readonly DiagnosticInput[];
}

export interface BubbleMeta {
  readonly field: string;
  readonly label: string;
  readonly unit: string | null;
  readonly format: NumberFormatOption | null;
  readonly parse: boolean;
  readonly minRadius: number;
  readonly maxRadius: number;
  readonly sizes: SizeColumn;
}

const SIZE_KEYS = ['field', 'label', 'unit', 'format', 'parse'];
const RADIUS_KEYS = ['min', 'max'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The options the scatter resolver reads: the bubble keys are taken out, so they are not unknown options there. */
export function scatterPart(options: unknown): Record<string, unknown> {
  if (!isRecord(options)) return {};
  const { size: _size, radius: _radius, ...rest } = options;
  return rest;
}

export function createBubbleDiagnostic(
  code: 'AX187' | 'AX188' | 'AX189',
  details: { readonly field?: string; readonly rows?: readonly number[]; readonly count?: number; readonly detail?: string;
    readonly origin?: DiagnosticInput['origin'] },
): DiagnosticInput {
  const rows = details.rows ? details.rows.slice(0, 10) : undefined;
  const count = details.count ?? rows?.length;
  const where = rows?.length ? ` (rows ${rows.join(', ')})` : '';
  const field = `Field '${details.field ?? 'size'}'`;
  const message = details.detail ?? (code === 'AX187'
    ? `${field} has ${count ?? 0} size value${count === 1 ? '' : 's'} that ${count === 1 ? 'is' : 'are'} negative or not finite${where}. A bubble's area shows a magnitude, so these bubbles are not drawn; their rows stay in the table.`
    : code === 'AX188'
      ? `${field} is zero in every row that has a size, so no bubble has an area. Every bubble is drawn as a hollow zero marker; check that the size field is the one intended.`
      : `${count ?? 0} bubbles are drawn. Discs this dense cover each other, so most cannot be told apart; consider aggregating, filtering, or a heatmap. Every bubble stays in the tooltip, keyboard reading and table.`);
  return {
    code, level: code === 'AX189' ? 'hint' : 'warning', effect: code === 'AX187' ? 'omitted' : 'none',
    origin: details.origin ?? 'call', message,
    ...(details.field !== undefined ? { field: details.field } : {}),
    ...(rows?.length ? { rows } : {}),
    ...(count !== undefined ? { count } : {}),
  };
}

let columns: WeakMap<Table, Map<string, SizeColumn>> | undefined;

const decimal = /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/**
 * Reads the size of every row with the value-field rules of spec F2/F3 (null is "no data", silently; an absent
 * key is AX102; strings are AX104 or AX106 as for a y field), and reports a negative or non-finite number as
 * AX187 once over the whole column with its exact count and first source rows. A Float64Array or Float32Array
 * column is borrowed, never copied.
 */
export function readSizes(table: Table, field: string, parse: boolean): SizeColumn {
  const byField = (columns ??= new WeakMap()).get(table);
  const key = (parse ? 'p:' : 'n:') + field;
  const known = byField?.get(key);
  if (known) return known;
  const n = table.length;
  const raw = table.columns?.[field];
  const borrowed = raw instanceof Float64Array || raw instanceof Float32Array;
  const values: Float64Array | Float32Array = borrowed ? raw : new Float64Array(n);
  let state: Uint8Array | null = null;
  let sized = 0, zeros = 0;
  const bad: number[] = [];
  let badCount = 0;
  const absent: number[] = [];
  let absentCount = 0;
  const strings: number[] = [];
  let stringCount = 0;
  let decimals = 0, others = 0;
  if (!borrowed && !parse) {
    // Spec AX104: a column made only of plain decimal strings is parsed (with a hint); one stray string is AX106.
    for (let i = 0; i < n; i++) {
      const v = table.read(i, field);
      if (v == null || v === '') continue;
      if (typeof v === 'string' && decimal.test(v)) decimals++;
      else others++;
    }
  }
  const parseAll = parse || (decimals > 0 && others === 0);
  for (let i = 0; i < n; i++) {
    let v: number;
    let s = SIZE_OK;
    const input = borrowed ? raw[i]! : table.read(i, field);
    const row = table.rowIndex(i);
    if (typeof input === 'number') {
      v = input;
      // NaN is not "no data" here, whether it comes from a row or a typed column: a size must be a magnitude.
      if (!Number.isFinite(v) || v < 0) {
        s = SIZE_INVALID;
        if (bad.length < 10) bad.push(row);
        badCount++;
      }
    } else if (input === undefined) {
      v = NaN; s = SIZE_INVALID;
      if (absent.length < 10) absent.push(row);
      absentCount++;
    } else if (input === null || input === '') {
      v = NaN; s = SIZE_NULL;
    } else if (typeof input === 'string' && parseAll && decimal.test(input)) {
      v = Number(input);
      if (!Number.isFinite(v) || v < 0) {
        s = SIZE_INVALID;
        if (bad.length < 10) bad.push(row);
        badCount++;
      }
    } else {
      v = NaN; s = SIZE_INVALID;
      if (strings.length < 10) strings.push(row);
      stringCount++;
    }
    if (!borrowed) values[i] = v;
    if (s !== SIZE_OK) (state ??= new Uint8Array(n))[i] = s;
    else {
      sized++;
      if (v === 0) zeros++;
    }
  }
  const missing = n > 0 ? absentCount === n : table.columns !== null && !table.hasField(field);
  const sink = new Collected();
  // A field no row has is one finding about the setting (resolveBubble), not one per row.
  if (absentCount && !missing) report(sink, 'AX102', 'omitted', { field, rows: absent, count: absentCount, outcome: 'Those bubbles are not drawn.' });
  if (stringCount) report(sink, 'AX106', 'omitted', { field, rows: strings, count: stringCount, outcome: 'Those bubbles are not drawn.' });
  if (!parse && decimals > 0 && others === 0) report(sink, 'AX104', 'none', { field, count: decimals });
  if (badCount) sink.add(createBubbleDiagnostic('AX187', { field, rows: bad, count: badCount }));
  if (sized > 0 && zeros === sized) sink.add(createBubbleDiagnostic('AX188', { field }));
  if (sized > DENSE_BUBBLES) sink.add(createBubbleDiagnostic('AX189', { count: sized }));
  const column: SizeColumn = { values, state, sized, zeros, absent: absentCount, missing, findings: sink.list };
  let map = columns.get(table);
  if (!map) columns.set(table, map = new Map());
  map.set(key, column);
  return column;
}

let emptyColumns: Map<number, SizeColumn> | undefined;
function noSizes(n: number): SizeColumn {
  const known = (emptyColumns ??= new Map()).get(n);
  if (known) return known;
  const column: SizeColumn = { values: new Float64Array(n).fill(NaN), state: new Uint8Array(n).fill(SIZE_INVALID), sized: 0, zeros: 0, absent: n, missing: true, findings: [] };
  if (emptyColumns.size > 8) emptyColumns.clear();
  emptyColumns.set(n, column);
  return column;
}

class Collected implements DiagnosticSink {
  readonly list: DiagnosticInput[] = [];
  add(d: DiagnosticInput): void { this.list.push(d); }
}

function fieldName(spec: unknown): string | null {
  if (typeof spec === 'string') return spec;
  return isRecord(spec) && typeof spec.field === 'string' ? spec.field : null;
}

function radiusValue(input: unknown, path: string, fallback: number, sink: DiagnosticSink): number {
  if (input === undefined) return fallback;
  if (typeof input === 'number' && Number.isFinite(input) && input >= 0 && input <= 1000) return input;
  report(sink, 'AX150', 'none', { field: path, count: 1, detail: 'Use a number of CSS pixels from 0 to 1000.' });
  return fallback;
}

/** A key of the data that differs from `name` only in case or by one character, else the first key. */
function nearKey(name: string, keys: readonly string[]): string | undefined {
  const lower = name.toLowerCase();
  return keys.find(k => k.toLowerCase() === lower) ?? keys.find(k => k.length === name.length &&
    [...k].filter((c, i) => c !== name[i]).length === 1);
}

/**
 * The bubble part of one call's options, reported into the option sink.
 *
 * The size setting is required. When it is absent, reset, not a field name, or names a field no row has, the
 * chart cannot show what it is for: AX150 with the chart-error effect (the error state, as for a scatter given
 * several y fields), raised from the setting of this call. Not AX101: the controller keeps AX101 with the data
 * that raised it (controller-helpers dataFindings) and drops it from calls that keep the data, so a size-only
 * patch could neither raise it (a strict reset would pass) nor clear it (a fixed size would stay in error). Option
 * findings are regenerated by every call, so this one is raised, rejected under strict, and cleared exactly with
 * the setting, and validateBubble reports the same.
 */
export function resolveBubble(options: unknown, resolved: ResolvedOptions, sink: DiagnosticSink): BubbleMeta {
  const input = isRecord(options) ? options : {};
  const spec = input.size;
  const named = fieldName(spec);
  const field = named ?? '';
  const fieldOptions = isRecord(spec) ? spec : {};
  if (isRecord(spec)) {
    for (const key of Object.keys(spec)) {
      if (!SIZE_KEYS.includes(key)) report(sink, 'AX150', 'none', { field: 'size.' + key, count: 1 });
    }
  }
  const parse = fieldOptions.parse === 'number';
  if (fieldOptions.parse !== undefined && !parse) {
    report(sink, 'AX150', 'none', { field: 'size.parse', count: 1, detail: "Use parse: 'number'." });
  }
  const table = resolved.table;
  const sizes = field === '' ? noSizes(table.length) : readSizes(table, field, parse);
  if (field === '') {
    const keys = table.keys();
    report(sink, 'AX150', 'chart-error', {
      field: 'size', count: 1,
      detail: (spec === undefined || spec === null ? 'A bubble chart needs a size field' : 'Size must name a numeric field, or be { field }') +
        ' whose values set the bubble areas. Available fields: ' + (keys.length ? keys.map(k => `'${k}'`).join(', ') : '(none)') + '.',
    });
  } else if (sizes.missing) {
    const keys = table.keys();
    const near = nearKey(field, keys);
    report(sink, 'AX150', 'chart-error', {
      field: 'size', count: 1,
      detail: `Size field '${field}' is missing from the data. Available fields: ` +
        (keys.length ? keys.map(k => `'${k}'`).join(', ') : '(none)') + '.' + (near ? ` Did you mean '${near}'?` : ''),
    });
  }
  const radius = isRecord(input.radius) ? input.radius : {};
  if (input.radius !== undefined && !isRecord(input.radius)) report(sink, 'AX150', 'none', { field: 'radius', count: 1 });
  for (const key of Object.keys(radius)) {
    if (!RADIUS_KEYS.includes(key)) report(sink, 'AX150', 'none', { field: 'radius.' + key, count: 1 });
  }
  let maxRadius = radiusValue(radius.max, 'radius.max', DEFAULT_MAX_RADIUS, sink);
  let minRadius = radiusValue(radius.min, 'radius.min', DEFAULT_MIN_RADIUS, sink);
  if (maxRadius <= 0) {
    report(sink, 'AX150', 'none', { field: 'radius.max', count: 1, detail: 'The largest radius must be above zero.' });
    maxRadius = DEFAULT_MAX_RADIUS;
  }
  if (minRadius > maxRadius) {
    report(sink, 'AX150', 'none', { field: 'radius.min', count: 1, detail: 'The smallest radius cannot exceed the largest.' });
    minRadius = Math.min(DEFAULT_MIN_RADIUS, maxRadius);
  }
  for (const d of sizes.findings) sink.add(d);
  const label = typeof fieldOptions.label === 'string' && fieldOptions.label.trim() ? fieldOptions.label : field;
  const unit = typeof fieldOptions.unit === 'string' && fieldOptions.unit ? fieldOptions.unit : null;
  const format = typeof fieldOptions.format === 'function' || isRecord(fieldOptions.format)
    ? fieldOptions.format as NumberFormatOption : null;
  return { field, label, unit, format, parse, minRadius, maxRadius, sizes };
}

/** Equal metas draw the same: an update that changes neither keeps the layout, scene and lookup. */
export function sameMeta(a: BubbleMeta, b: BubbleMeta): boolean {
  return a.field === b.field && a.label === b.label && a.unit === b.unit && a.parse === b.parse &&
    a.minRadius === b.minRadius && a.maxRadius === b.maxRadius && a.sizes === b.sizes && sameFormat(a.format, b.format);
}

function sameFormat(a: NumberFormatOption | null, b: NumberFormatOption | null): boolean {
  if (a === b) return true;
  if (!isRecord(a) || !isRecord(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => Object.is(a[k], (b as Record<string, unknown>)[k]));
}
