import type { DiagnosticSink } from '../core/contracts';
import type { ValueFieldOptions, XFieldOptions } from '../public';
import { report } from '../diagnostics';
import { defaultMessages } from '../messages';
import { borrowColumns } from './store-bytes';
import { columnsTable, rowsTable, type Columns, type Table } from './table';

export type AlignedChartType = 'line' | 'area' | 'bar';
export type ChartType = AlignedChartType | 'scatter' | 'donut';

export interface ResolvedXField {
  readonly field: string;
  readonly label: string;
  readonly unit: string | null;
  readonly type: NonNullable<XFieldOptions['type']> | null;
  readonly timeZone: string;
  readonly ordered: boolean;
  readonly format: NonNullable<XFieldOptions['format']> | null;
  readonly tickFormat: NonNullable<XFieldOptions['tickFormat']> | null;
  readonly domain: NonNullable<XFieldOptions['domain']> | null;
}

export interface ResolvedValueField {
  readonly field: string;
  readonly label: string;
  readonly unit: string | null;
  readonly scale: NonNullable<ValueFieldOptions['scale']> | null;
  readonly missing: NonNullable<ValueFieldOptions['missing']>;
  readonly parse: 'number' | null;
  readonly format: NonNullable<ValueFieldOptions['format']> | null;
  readonly tickFormat: NonNullable<ValueFieldOptions['tickFormat']> | null;
  readonly domain: NonNullable<ValueFieldOptions['domain']> | null;
}

export interface ResolvedOptions {
  readonly table: Table;
  readonly x: ResolvedXField;
  readonly values: readonly ResolvedValueField[];
  readonly form: 'long' | 'wide';
  readonly series: string | null;
  readonly valid: boolean;
  readonly name: string;
}

// The option names each chart accepts. Written out rather than spread from shared lists: building them at
// import time would keep a bundler from dropping the module.
const aligned = ['data', 'title', 'labelledBy', 'subtitle', 'description', 'state', 'legend', 'tooltip',
  'table', 'colors', 'messages', 'locale', 'strict', 'onDiagnostic', 'x', 'y', 'series', 'zoom', 'reference', 'compact'];
const keysForChart: Record<ChartType, readonly string[]> = {
  line: aligned,
  area: ['data', 'title', 'labelledBy', 'subtitle', 'description', 'state', 'legend', 'tooltip',
    'table', 'colors', 'messages', 'locale', 'strict', 'onDiagnostic', 'x', 'y', 'series', 'zoom', 'reference', 'compact', 'stacked'],
  bar: ['data', 'title', 'labelledBy', 'subtitle', 'description', 'state', 'legend', 'tooltip',
    'table', 'colors', 'messages', 'locale', 'strict', 'onDiagnostic', 'x', 'y', 'series', 'zoom', 'reference', 'compact', 'layout', 'horizontal'],
  scatter: ['data', 'title', 'labelledBy', 'subtitle', 'description', 'state', 'legend', 'tooltip',
    'table', 'colors', 'messages', 'locale', 'strict', 'onDiagnostic', 'x', 'y', 'series', 'zoom', 'reference'],
  donut: ['data', 'title', 'labelledBy', 'subtitle', 'description', 'state', 'legend', 'tooltip',
    'table', 'colors', 'messages', 'locale', 'strict', 'onDiagnostic', 'label', 'value'],
};
const scatterXKeys = ['field', 'label', 'unit', 'format', 'tickFormat', 'domain', 'type', 'timeZone'];
const xKeys = ['field', 'label', 'unit', 'format', 'tickFormat', 'domain', 'type', 'timeZone', 'ordered'];
const valueKeys = ['field', 'label', 'unit', 'format', 'tickFormat', 'domain', 'scale', 'missing', 'parse'];

function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let earlier = previous;
  for (let i = 1; i <= a.length; i++) {
    const costs = [i];
    for (let j = 1; j <= b.length; j++) {
      let cost = Math.min(previous[j]! + 1, costs[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 2] === b[j - 1] && a[i - 1] === b[j - 2]) {
        cost = Math.min(cost, earlier[j - 2]! + 1);
      }
      costs.push(cost);
    }
    earlier = previous;
    previous = costs;
  }
  return previous[b.length]!;
}

function closest<T extends string>(name: string, keys: readonly T[], limit = name.length / 3): T | undefined {
  let suggestion: T | undefined;
  let best = Infinity;
  for (const key of keys) {
    if (name === key || Math.abs(name.length - key.length) > limit) continue;
    const score = distance(name.toLowerCase(), key.toLowerCase());
    if (score <= limit && score < best) {
      suggestion = key;
      best = score;
    }
  }
  return suggestion;
}

function literal<const T extends string>(value: unknown, keys: readonly T[], field: string, sink: DiagnosticSink): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && keys.includes(value as T)) return value as T;
  const suggestion = typeof value === 'string' ? closest(value, keys, Infinity) : keys[0];
  report(sink, 'AX150', 'none', { field, suggestion, detail: 'Use a supported value for this option.' });
  return undefined;
}

export function canonicalZone(zone: unknown): string | undefined {
  if (typeof zone !== 'string') return undefined;
  try {
    return Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function unknownKeys(options: Record<string, unknown>, keys: readonly string[], sink: DiagnosticSink, path = ''): void {
  for (const key of Object.keys(options)) {
    if (!keys.includes(key)) {
      const suggestion = closest(key, keys);
      report(sink, 'AX150', 'none', { field: path + key, suggestion: suggestion && path + suggestion, count: 1 });
    }
  }
}

export function resolveTable(data: unknown, sink: DiagnosticSink): { table: Table; valid: boolean } {
  if (Array.isArray(data)) return { table: rowsTable(data), valid: true };
  const columns = object(object(data).columns) as Columns;
  const keys = Object.keys(columns);
  const length = columns[keys[0] ?? '']?.length ?? 0;
  const differing = keys.find(key => {
    const column = columns[key];
    return typeof column !== 'object' || column === null || column.length !== length ||
      !Number.isInteger(column.length) || column.length < 0 || column.length > 0x7fffffff;
  });
  if (differing !== undefined) {
    report(sink, 'AX100', 'chart-error', {
      field: differing, count: 1, examples: keys.map(key => JSON.stringify(key) + ': ' + columns[key]?.length),
    });
  }
  // The P7 byte count leaves out what the caller gave (development and benchmark builds count).
  if (__DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__)) borrowColumns(columns);
  return { table: columnsTable(columns, differing === undefined ? length : 0), valid: differing === undefined };
}

function fieldName(input: unknown): string | null {
  const field = typeof input === 'string' ? input : object(input).field;
  return typeof field === 'string' ? field : null;
}

/**
 * A tick format that labels nothing is reported, never dropped silently: a compact chart draws no ticks, and
 * the value axis that y fields share takes its labels from the first field (`unused` says why, or null).
 */
function resolveTickFormat<T>(format: T | undefined, path: string, unused: string | null, sink: DiagnosticSink): T | null {
  if (unused === null || format == null) return format ?? null;
  report(sink, 'AX150', 'none', { field: path + 'tickFormat', count: 1, detail: unused });
  return null;
}

const COMPACT_TICKS = 'Compact charts draw no axis ticks.';
const DONUT_TICKS = 'Donut charts draw no axis ticks.';

function resolveX(input: unknown, type: ChartType, compact: boolean, sink: DiagnosticSink): ResolvedXField {
  const unusedTicks = compact ? COMPACT_TICKS : type === 'donut' ? DONUT_TICKS : null;
  const options = object(input) as XFieldOptions;
  if (type !== 'donut') unknownKeys(object(input), type === 'scatter' ? scatterXKeys : xKeys, sink, 'x.');
  const field = fieldName(input) ?? '';
  const declared = literal(options.type, ['number', 'time', 'date', 'category'], 'x.type', sink);
  const zone = options.timeZone === undefined || options.timeZone === 'local'
    ? 'local' : canonicalZone(options.timeZone);
  if (zone === undefined) {
    const examples = typeof options.timeZone === 'string' ? [JSON.stringify(options.timeZone)] : undefined;
    report(sink, 'AX152', 'none', { field: 'x.timeZone', examples });
  }
  return {
    field, label: options.label ?? field, unit: options.unit ?? null,
    type: type === 'donut' ? 'category' : declared ?? null,
    timeZone: zone ?? 'local', ordered: type !== 'scatter' && (options.ordered ?? false),
    format: options.format ?? null, tickFormat: resolveTickFormat(options.tickFormat, 'x.', unusedTicks, sink),
    domain: options.domain ?? null,
  };
}

function resolveValue(input: unknown, path: string, unusedTicks: string | null, sink: DiagnosticSink): ResolvedValueField {
  const options = object(input) as ValueFieldOptions & { parse?: 'number' };
  unknownKeys(object(input), valueKeys, sink, path);
  const field = fieldName(input) ?? '';
  return {
    field, label: options.label ?? field, unit: options.unit ?? null,
    scale: literal(options.scale, ['percent', 'ratio'], path + 'scale', sink) ?? null,
    missing: literal(options.missing, ['gap', 'zero'], path + 'missing', sink) ?? 'gap',
    parse: literal(options.parse, ['number'], path + 'parse', sink) ?? null, format: options.format ?? null,
    tickFormat: resolveTickFormat(options.tickFormat, path, unusedTicks, sink), domain: options.domain ?? null,
  };
}

const encodings = new WeakMap<ResolvedOptions, {
  readonly named: readonly (readonly [string | null, string])[];
  readonly supported: boolean;
}>();

export function withoutTable(options: ResolvedOptions): ResolvedOptions {
  const resolved = { ...options, table: rowsTable([]) };
  const encoding = encodings.get(options);
  if (encoding) encodings.set(resolved, encoding);
  return resolved;
}

export function retargetOptions(options: ResolvedOptions, table: Table, sink: DiagnosticSink, validData = true): ResolvedOptions {
  const encoding = encodings.get(options);
  const named = encoding?.named ?? [
    [options.x.field, 'x'] as const,
    ...options.values.map(value => [value.field, 'y'] as const),
    ...(options.series === null ? [] : [[options.series, 'series'] as const]),
  ];
  const valid = checkFields(table, named, sink) && (encoding?.supported ?? options.valid) && validData;
  const resolved = { ...options, table, valid };
  if (encoding) encodings.set(resolved, encoding);
  return resolved;
}

export function resolveOptions(type: ChartType, input: unknown, sink: DiagnosticSink, retained?: Table): ResolvedOptions {
  const options = object(input);
  const donut = type === 'donut';
  const compact = !donut && type !== 'scatter' && options.compact === true;
  unknownKeys(options, keysForChart[type], sink);
  unknownKeys(object(options.title), ['text', 'visible', 'level'], sink, 'title.');
  unknownKeys(object(options.state), ['error', 'empty'], sink, 'state.');
  // The message keys are those of the built-in messages (the one list of them, in the same order).
  unknownKeys(object(options.messages), Object.keys(defaultMessages), sink, 'messages.');
  if (compact && options.reference !== undefined) {
    report(sink, 'AX150', 'none', { field: 'reference', count: 1, detail: 'Compact charts draw no references.' });
  } else if (!donut && Array.isArray(options.reference)) {
    options.reference.forEach((reference, row) => {
      unknownKeys(object(reference), ['x', 'y', 'label'], sink, 'reference[' + row + '].');
    });
  }

  const { table, valid: validTable } = retained ? { table: retained, valid: true } : resolveTable(options.data, sink);
  const xInput = donut ? options.label : options.x;
  const x = resolveX(xInput, type, compact, sink);
  const wide = !donut && Array.isArray(options.y);
  const supportsWide = type !== 'scatter' && !donut;
  const valueInputs = wide ? options.y as readonly unknown[] : [donut ? options.value : options.y];
  // Only the first value field supplies the shared axis's tick formatter.
  const values = valueInputs.map((field, index) =>
    resolveValue(field, wide ? 'y[' + index + '].' : donut ? 'value.' : 'y.', compact ? COMPACT_TICKS : donut ? DONUT_TICKS
      : index > 0 ? 'The y fields share one value axis, labelled by y[0].tickFormat.' : null, sink));
  const series = !wide && !donut && typeof options.series === 'string' ? options.series : null;
  if (wide && options.series !== undefined) {
    report(sink, 'AX150', 'none', { field: 'series', count: 1, detail: 'Use a single y field when naming a series field.' });
  }
  if (wide && !supportsWide) {
    report(sink, 'AX150', 'chart-error', { field: 'y', count: 1, detail: 'Use a single y field for scatter charts.' });
  }

  let valid = validTable && (!wide || supportsWide);
  const fields: [string | null, string][] = [[fieldName(xInput), donut ? 'label' : 'x']];
  for (const input of valueInputs) fields.push([fieldName(input), donut ? 'value' : 'y']);
  if (values.length === 0) fields.push([null, 'y']);
  if (series !== null) fields.push([series, 'series']);
  valid = checkFields(table, fields, sink) && valid;

  const title = typeof options.title === 'string' ? options.title : object(options.title).text;
  const name = typeof title === 'string' && title ? title
    : typeof options.labelledBy === 'string' && options.labelledBy ? options.labelledBy : type;
  const resolved: ResolvedOptions = { table, x, values, form: wide ? 'wide' : 'long', series, valid, name };
  encodings.set(resolved, { named: fields, supported: !wide || supportsWide });
  return resolved;
}

export function checkFields(table: Table, fields: readonly (readonly [string | null, string])[], sink: DiagnosticSink): boolean {
  const reported = new Set<string>();
  for (const [field, role] of fields) {
    if (field !== null && (table.columns === null && table.length === 0 || table.hasField(field))) continue;
    const name = field ?? role;
    if (reported.has(name)) continue;
    reported.add(name);
    const keys = table.keys();
    report(sink, 'AX101', 'chart-error', { field: name, keys, suggestion: field === null ? undefined : closest(name, keys), count: 1 });
  }
  return reported.size === 0;
}
