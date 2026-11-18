import type { DiagnosticSink } from '../core/contracts';
import type { Messages, ValueFieldOptions, XFieldOptions } from '../public';
import { report } from '../diagnostics';
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

const common = ['data', 'title', 'labelledBy', 'subtitle', 'description', 'state', 'legend', 'tooltip',
  'table', 'colors', 'messages', 'locale', 'strict', 'onDiagnostic'];
const cartesian = [...common, 'x', 'y', 'series', 'zoom', 'reference'];
const aligned = [...cartesian, 'compact'];
const keysForChart: Record<ChartType, readonly string[]> = {
  line: aligned, area: [...aligned, 'stacked'], bar: [...aligned, 'layout', 'horizontal'],
  scatter: cartesian, donut: [...common, 'label', 'value'],
};
const fieldKeys = ['field', 'label', 'unit', 'format', 'tickFormat', 'domain'];
const scatterXKeys = [...fieldKeys, 'type', 'timeZone'];
const xKeys = [...scatterXKeys, 'ordered'];
const valueKeys = [...fieldKeys, 'scale', 'missing', 'parse'];
const messageKeys = {
  viewAsTable: true, hideTable: true, noData: true, noObservation: true, incompleteStack: true, moreRows: true,
  otherSlices: true, valuesNotShown: true, valuesChanged: true, labelsHidden: true, loading: true, empty: true,
  error: true, internalError: true, chartName: true, chartSummary: true, seriesSummary: true, referenceSummary: true,
  timeZoneNote: true, plotLabel: true, controlsLabel: true, pointOf: true, zoomIn: true, zoomOut: true, resetZoom: true,
  pause: true, resume: true, previousPage: true, nextPage: true, pageOf: true, jumpToX: true, showSeries: true, hideSeries: true,
  category: true, percentage: true, series: true, value: true, typeLine: true, typeArea: true, typeBar: true, typeScatter: true,
  typeDonut: true, donutSummary: true, seriesNoData: true, seriesNotDrawn: true, referenceLine: true, referenceBand: true,
} satisfies Record<keyof Messages, true>;

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

function object(value: unknown): Record<string, unknown> {
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

function resolveTable(data: unknown, sink: DiagnosticSink): { table: Table; valid: boolean } {
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
  return { table: columnsTable(columns, differing === undefined ? length : 0), valid: differing === undefined };
}

function fieldName(input: unknown): string | null {
  const field = typeof input === 'string' ? input : object(input).field;
  return typeof field === 'string' ? field : null;
}

function resolveX(input: unknown, type: ChartType, sink: DiagnosticSink): ResolvedXField {
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
    format: options.format ?? null, tickFormat: options.tickFormat ?? null, domain: options.domain ?? null,
  };
}

function resolveValue(input: unknown, path: string, sink: DiagnosticSink): ResolvedValueField {
  const options = object(input) as ValueFieldOptions & { parse?: 'number' };
  unknownKeys(object(input), valueKeys, sink, path);
  const field = fieldName(input) ?? '';
  return {
    field, label: options.label ?? field, unit: options.unit ?? null,
    scale: literal(options.scale, ['percent', 'ratio'], path + 'scale', sink) ?? null,
    missing: literal(options.missing, ['gap', 'zero'], path + 'missing', sink) ?? 'gap',
    parse: literal(options.parse, ['number'], path + 'parse', sink) ?? null, format: options.format ?? null,
    tickFormat: options.tickFormat ?? null, domain: options.domain ?? null,
  };
}

export function resolveOptions(type: ChartType, input: unknown, sink: DiagnosticSink): ResolvedOptions {
  const options = object(input);
  unknownKeys(options, keysForChart[type], sink);
  unknownKeys(object(options.title), ['text', 'visible', 'level'], sink, 'title.');
  unknownKeys(object(options.state), ['error', 'empty'], sink, 'state.');
  unknownKeys(object(options.messages), Object.keys(messageKeys), sink, 'messages.');
  if (type !== 'donut' && Array.isArray(options.reference)) {
    options.reference.forEach((reference, row) => {
      unknownKeys(object(reference), ['x', 'y', 'label'], sink, 'reference[' + row + '].');
    });
  }

  const { table, valid: validTable } = resolveTable(options.data, sink);
  const donut = type === 'donut';
  const xInput = donut ? options.label : options.x;
  const x = resolveX(xInput, type, sink);
  const wide = !donut && Array.isArray(options.y);
  const supportsWide = type !== 'scatter' && !donut;
  const valueInputs = wide ? options.y as readonly unknown[] : [donut ? options.value : options.y];
  const values = valueInputs.map((field, index) =>
    resolveValue(field, wide ? 'y[' + index + '].' : donut ? 'value.' : 'y.', sink));
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
  return { table, x, values, form: wide ? 'wide' : 'long', series, valid, name };
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
