import type { DiagnosticSink } from '../core/contracts';
import type { ValueFieldOptions, XFieldOptions } from '../public';
import { report } from '../diagnostics';
import { defaultMessages } from '../messages';
import { borrowColumns, columnsTable, rowsTable, type Columns, type Table } from './table';

export type AlignedChartType = 'line' | 'area' | 'bar' | 'histogram';
export type ChartType = AlignedChartType | 'scatter' | 'donut';

export interface ResolvedXField {
  readonly field: string;
  readonly label: string;
  readonly unit: string | null;
  readonly type: NonNullable<XFieldOptions['type']> | null;
  readonly timeZone: string;
  readonly ordered: boolean;
  readonly scale?: ResolvedValueField['scale'];
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
  readonly bins?: number | readonly number[];
  readonly normalize?: 'count' | 'probability' | 'density';
  readonly sample?: ResolvedValueField;
  readonly table: Table;
  readonly x: ResolvedXField;
  readonly values: readonly ResolvedValueField[];
  readonly form: 'long' | 'wide';
  readonly series: string | null;
  readonly valid: boolean;
  readonly name: string;
}

const commonKeys = 'data title labelledBy subtitle description state legend tooltip table colors messages locale strict onDiagnostic';
const keysForChart: Record<ChartType, string> = {
  line: 'x y series zoom reference compact',
  area: 'x y series zoom reference compact stacked',
  bar: 'x y series zoom reference compact layout horizontal',
  histogram: 'x bins normalize zoom reference compact',
  scatter: 'x y series zoom reference',
  donut: 'label value',
};
const fieldKeys = 'field label unit format tickFormat domain';
const titleKeys = ['text', 'visible', 'level'];
const stateKeys = ['error', 'empty'];
const referenceKeys = ['x', 'y', 'label'];
const xTypes = ['number', 'time', 'date', 'category'] as const;
const valueScales = ['percent', 'ratio'] as const;
const missingModes = ['gap', 'zero'] as const;
const parseModes = ['number'] as const;

/** The top-level and field option names, and the message keys: made once, on first use. */
let topKeys: Partial<Record<ChartType, readonly string[]>> | undefined;
let messageKeys: readonly string[] | undefined;
let scatterXKeysCache: readonly string[] | undefined;
let xKeysCache: readonly string[] | undefined;
let valueKeysCache: readonly string[] | undefined;

const getScatterXKeys = () => scatterXKeysCache ??= (fieldKeys + ' type timeZone').split(' ');
const getXKeys = () => xKeysCache ??= getScatterXKeys().concat('ordered');
const getValueKeys = () => valueKeysCache ??= (fieldKeys + ' scale missing parse').split(' ');

function optionKeys(type: ChartType): readonly string[] {
  const known = topKeys ??= {};
  return known[type] ??= (commonKeys + ' ' + keysForChart[type]).split(' ');
}

function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let earlier = previous;
  for (let i = 1; i <= a.length; i++) {
    const costs = [i];
    for (let j = 1; j <= b.length; j++) {
      let cost = Math.min(previous[j]! + 1, costs[j - 1]! + 1, previous[j - 1]! + Number(a[i - 1] !== b[j - 1]));
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
  const lower = name.toLowerCase();
  for (const key of keys) {
    if (name === key || Math.abs(name.length - key.length) > limit) continue;
    const score = distance(lower, key.toLowerCase());
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

/** Canonical names by what was written (null: not a zone): each chart naming a zone would make a formatter. */
const ZONE_CACHE_LIMIT = 64;
let canonicalZones: Map<string, string | null> | undefined;
let canonicalZoneDtf: typeof Intl.DateTimeFormat | undefined;

export function canonicalZone(zone: unknown): string | undefined {
  if (zone === 'UTC') return zone;
  if (typeof zone !== 'string') return undefined;
  const dtf = Intl.DateTimeFormat;
  if (canonicalZoneDtf !== dtf) {
    canonicalZoneDtf = dtf;
    canonicalZones?.clear();
  }
  const cache = canonicalZones ??= new Map();
  const known = cache.get(zone);
  if (known !== undefined) return known ?? undefined;
  let canonical: string | null;
  try {
    canonical = dtf('en', { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    canonical = null;
  }
  if (cache.size >= ZONE_CACHE_LIMIT) cache.clear();
  cache.set(zone, canonical);
  return canonical ?? undefined;
}

export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function optionIssue(sink: DiagnosticSink, field: string, detail: string, effect: 'none' | 'chart-error' = 'none'): void {
  report(sink, 'AX150', effect, { field, count: 1, detail });
}

function unknownKeys(options: unknown, keys: readonly string[], sink: DiagnosticSink, path = ''): void {
  // Anything but an object has no keys to check.
  if (options === null || typeof options !== 'object') return;
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
  optionIssue(sink, path + 'tickFormat', unused);
  return null;
}

const COMPACT_TICKS = 'Compact charts draw no axis ticks.';
const DONUT_TICKS = 'Donut charts draw no axis ticks.';

function baseField<T extends XFieldOptions | ValueFieldOptions>(
  input: unknown, options: T, path: string, unusedTicks: string | null, sink: DiagnosticSink,
) {
  const field = fieldName(input) ?? '';
  return {
    field, label: options.label ?? field, unit: options.unit ?? null,
    format: (options.format ?? null) as NonNullable<T['format']> | null,
    tickFormat: resolveTickFormat(options.tickFormat, path, unusedTicks, sink) as NonNullable<T['tickFormat']> | null,
    domain: (options.domain ?? null) as NonNullable<T['domain']> | null,
  };
}

function resolveX(input: unknown, type: ChartType, unusedTicks: string | null, sink: DiagnosticSink): ResolvedXField {
  const options = object(input) as XFieldOptions;
  if (type !== 'donut') unknownKeys(input, type === 'scatter' ? getScatterXKeys() : getXKeys(), sink, 'x.');
  const declared = literal(options.type, xTypes, 'x.type', sink);
  const zone = options.timeZone === undefined || options.timeZone === 'local'
    ? 'local' : canonicalZone(options.timeZone);
  if (zone === undefined) {
    const examples = typeof options.timeZone === 'string' ? [JSON.stringify(options.timeZone)] : undefined;
    report(sink, 'AX152', 'none', { field: 'x.timeZone', examples });
  }
  return {
    ...baseField(input, options, 'x.', unusedTicks, sink),
    type: type === 'donut' ? 'category' : declared ?? null,
    timeZone: zone ?? 'local', ordered: type !== 'scatter' && (options.ordered ?? false),
  };
}

function resolveValue(input: unknown, path: string, unusedTicks: string | null, sink: DiagnosticSink): ResolvedValueField {
  const options = object(input) as ValueFieldOptions & { parse?: 'number' };
  unknownKeys(input, getValueKeys(), sink, path);
  const scale = literal(options.scale, valueScales, path + 'scale', sink) ?? null;
  const missing = literal(options.missing, missingModes, path + 'missing', sink) ?? 'gap';
  const parse = literal(options.parse, parseModes, path + 'parse', sink) ?? null;
  return { ...baseField(input, options, path, unusedTicks, sink), scale, missing, parse };
}

export function namedFields(fields: Omit<ResolvedOptions, 'table'>): [string, string][] {
  const named: [string, string][] = [[fields.x.field, 'x']];
  for (const value of fields.values) named.push([value.field, 'y']);
  if (fields.series !== null) named.push([fields.series, 'series']);
  return named;
}

const encodings = new WeakMap<ResolvedOptions, {
  readonly named: readonly (readonly [string | null, string])[];
  readonly supported: boolean;
}>();

function withTable(options: ResolvedOptions, table: Table, valid: boolean): ResolvedOptions {
  const resolved = { ...options, table, valid };
  const encoding = encodings.get(options);
  if (encoding) encodings.set(resolved, encoding);
  return resolved;
}

export function withoutTable(options: ResolvedOptions): ResolvedOptions {
  return withTable(options, rowsTable([]), options.valid);
}

export function retargetOptions(options: ResolvedOptions, table: Table, sink: DiagnosticSink, validData = true): ResolvedOptions {
  const encoding = encodings.get(options);
  return withTable(options, table, checkFields(table, encoding?.named ?? namedFields(options), sink) &&
    (encoding?.supported ?? options.valid) && validData);
}

export function resolveOptions(type: ChartType, input: unknown, sink: DiagnosticSink, retained?: Table): ResolvedOptions {
  return resolveFields(type, input, sink, retained, type === 'histogram' ? histogramFields : undefined);
}

function validEdges(edges: readonly unknown[]): boolean {
  let previous = -Infinity;
  for (const edge of edges) {
    if (typeof edge !== 'number' || !Number.isFinite(edge) || edge <= previous) return false;
    previous = edge;
  }
  return edges.length >= 2;
}

function histogramFields(options: Record<string, unknown>, compact: boolean, sink: DiagnosticSink) {
  const sample = resolveValue(options.x, 'x.', compact ? COMPACT_TICKS : null, sink);
  // Histogram positions are always numeric, so these formatters receive numbers on this axis.
  const x = { ...sample, type: 'number', timeZone: 'local', ordered: false } as ResolvedXField;
  const normalize = literal(options.normalize, ['count', 'probability', 'density'], 'normalize', sink) ?? 'count';
  let bins: ResolvedOptions['bins'];
  const b = options.bins;
  if (typeof b === 'number' && Number.isInteger(b) && b >= 1 && b <= 100 || Array.isArray(b) && validEdges(b)) bins = b;
  else if (b !== undefined) report(sink, 'AX150', 'none', { field: 'bins' });
  return { x, sample, bins, normalize };
}

export function resolveFields(type: ChartType, input: unknown, sink: DiagnosticSink, retained?: Table, histogram?: typeof histogramFields): ResolvedOptions {
  const options = object(input);
  const donut = type === 'donut';
  const compact = !donut && type !== 'scatter' && options.compact === true;
  unknownKeys(options, optionKeys(type), sink);
  unknownKeys(options.title, titleKeys, sink, 'title.');
  unknownKeys(options.state, stateKeys, sink, 'state.');
  // The message keys are those of the built-in messages (the one list of them, in the same order).
  if (options.messages !== null && typeof options.messages === 'object') {
    unknownKeys(options.messages, messageKeys ??= Object.keys(defaultMessages), sink, 'messages.');
  }
  if (compact && options.reference !== undefined) {
    optionIssue(sink, 'reference', 'Compact charts draw no references.');
  } else if (!donut && Array.isArray(options.reference)) {
    options.reference.forEach((reference, row) => {
      unknownKeys(reference, referenceKeys, sink, 'reference[' + row + '].');
    });
  }

  const { table, valid: validTable } = retained ? { table: retained, valid: true } : resolveTable(options.data, sink);
  const unusedTicks = compact ? COMPACT_TICKS : donut ? DONUT_TICKS : null;
  const xRole = donut ? 'label' : 'x';
  const yRole = donut ? 'value' : 'y';
  const xInput = options[xRole];
  const distribution = histogram?.(options, compact, sink);
  const x = distribution?.x ?? resolveX(xInput, type, unusedTicks, sink);
  const wide = !histogram && !donut && Array.isArray(options.y);
  const supported = !wide || type !== 'scatter';
  const valueInputs = histogram ? [] : wide ? options.y as readonly unknown[] : [options[yRole]];
  // Only the first value field supplies the shared axis's tick formatter.
  const values = valueInputs.map((field, index) =>
    resolveValue(field, wide ? 'y[' + index + '].' : yRole + '.', unusedTicks ?? (index > 0
      ? 'The y fields share one value axis, labelled by y[0].tickFormat.' : null), sink));
  const series = !histogram && !wide && !donut && typeof options.series === 'string' ? options.series : null;
  if (wide && options.series !== undefined) {
    optionIssue(sink, 'series', 'Use a single y field when naming a series field.');
  }
  if (!supported) {
    optionIssue(sink, 'y', 'Use a single y field for scatter charts.', 'chart-error');
  }

  const fields: [string | null, string][] = [[fieldName(xInput), xRole]];
  for (const input of valueInputs) fields.push([fieldName(input), yRole]);
  if (!histogram && values.length === 0) fields.push([null, 'y']);
  if (series !== null) fields.push([series, 'series']);
  const valid = checkFields(table, fields, sink) && validTable && supported;

  const title = typeof options.title === 'string' ? options.title : object(options.title).text;
  const name = typeof title === 'string' && title ? title
    : typeof options.labelledBy === 'string' && options.labelledBy ? options.labelledBy : type;
  const resolved: ResolvedOptions = { ...distribution, table, x, values, form: wide ? 'wide' : 'long', series, valid, name };
  encodings.set(resolved, { named: fields, supported });
  return resolved;
}

export function checkFields(table: Table, fields: readonly (readonly [string | null, string])[], sink: DiagnosticSink): boolean {
  let reported: Set<string> | undefined;
  for (const [field, role] of fields) {
    if (field !== null && (table.columns === null && table.length === 0 || table.hasField(field))) continue;
    const name = field ?? role;
    if (reported?.has(name)) continue;
    (reported ??= new Set()).add(name);
    const keys = table.keys();
    report(sink, 'AX101', 'chart-error', { field: name, keys, suggestion: field === null ? undefined : closest(name, keys), count: 1 });
  }
  return reported === undefined;
}
