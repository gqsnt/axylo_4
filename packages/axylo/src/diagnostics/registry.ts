import type { DiagnosticEffect, DiagnosticInput, DiagnosticSink } from '../core/contracts';
import type { Diagnostic } from '../public';

export interface DiagnosticDetails {
  readonly field?: string;
  readonly rows?: readonly number[];
  readonly count?: number;
  readonly examples?: readonly string[];
  readonly keys?: readonly string[];
  readonly suggestion?: string;
  readonly detail?: string;
}

const quote = (name: string) => JSON.stringify(name);
const field = (d: DiagnosticDetails) => d.field === undefined ? 'The chart' : 'Field ' + quote(d.field);
const rows = (d: DiagnosticDetails) => d.rows?.length ? ' at ' + (d.rows.length === 1 ? 'row ' : 'rows ') + d.rows.join(', ') : '';
const samples = (d: DiagnosticDetails) => d.examples?.length ? ' (' + d.examples.join(', ') + ')' : '';
const count = (d: DiagnosticDetails, word: string, plural = word + 's') =>
  (d.count ?? 1) + ' ' + ((d.count ?? 1) === 1 ? word : plural);
const suggestion = (d: DiagnosticDetails) => d.suggestion === undefined ? '' : ' Did you mean ' + quote(d.suggestion) + '?';

type Entry = { readonly level: Diagnostic['level']; readonly message: (details: DiagnosticDetails) => string };

export const diagnosticRegistry = {
  AX100: { level: 'error', message: d =>
    field(d) + ' belongs to columns with different lengths' + samples(d) + '. Supply equally long columns.' },
  AX101: { level: 'error', message: d =>
    field(d) + ' is missing from the data. Available fields: ' +
    (d.keys?.length ? d.keys.map(quote).join(', ') : '(none)') + '.' + suggestion(d) + ' Use an available field or add the field to the data.' },
  AX102: { level: 'warning', message: d =>
    field(d) + ' is absent in ' + count(d, 'record') + rows(d) + '. Supply the field and send null if the value is known to be missing.' },
  AX103: { level: 'warning', message: d =>
    field(d) + ' has ' + count(d, 'non-finite value') + rows(d) + samples(d) + '. Check the calculation that produced it or send null for no data.' },
  AX104: { level: 'hint', message: d =>
    field(d) + ' has ' + count(d, 'decimal string') + rows(d) + ' and is drawn as numbers. Set parse: \'number\' to make conversion explicit.' },
  AX105: { level: 'hint', message: d =>
    field(d) + ' is missing ' + count(d, 'expected step') + samples(d) + '. Supply observations for those positions or explicit nulls to mark gaps.' },
  AX106: { level: 'warning', message: d =>
    field(d) + ' has ' + count(d, 'value that cannot be plotted as a number', 'values that cannot be plotted as numbers') +
    rows(d) + samples(d) + '. Convert values to numbers where the data is produced.' },
  AX107: { level: 'warning', message: d =>
    field(d) + ' has ' + count(d, 'unusable value') + rows(d) + samples(d) + '. ' +
    (d.detail ?? 'Supply an x value in the declared or inferred format for each row.') },
  AX108: { level: 'error', message: d =>
    field(d) + ' has ' + count(d, 'duplicate') + rows(d) + samples(d) + '. Provide one row per x and series, or one row per donut label.' },
  AX109: { level: 'hint', message: d =>
    field(d) + ' has ' + count(d, 'numeric timestamp') + rows(d) + '. ' +
    (d.detail ?? 'Set type: \'time\' for instants and supply epoch milliseconds.') },
  AX110: { level: 'warning', message: d =>
    field(d) + ' has a domain that excludes zero. The domain was widened. Include zero in the domain.' },
  AX111: { level: 'hint', message: d =>
    field(d) + ' contains instants that look like calendar dates' + rows(d) + '. Use date strings such as YYYY-MM-DD for calendar dates.' },
  AX112: { level: 'hint', message: d =>
    field(d) + ' has ' + count(d, 'date-time without an offset', 'date-times without an offset') + rows(d) +
    '. Values are shown as written. Include a UTC offset or Z if these are instants.' },
  AX120: { level: 'error', message: d =>
    field(d) + ' has ' + count(d, 'negative donut value') + rows(d) + samples(d) + '. Supply non-negative values or choose a chart that shows negatives.' },
  AX121: { level: 'warning', message: d =>
    field(d) + ' produces more than eight donut slices. Smaller slices are grouped as Other. Aggregate the data or choose a bar chart to show every category.' },
  AX130: { level: 'warning', message: d =>
    field(d) + ' produces more than eight series. The chart uses dashes or markers to distinguish them. Filter or group series to reduce the number.' },
  AX131: { level: 'hint', message: d =>
    field(d) + ' produces multiple series in a compact chart. Use one series or turn off compact mode for more room.' },
  AX132: { level: 'hint', message: d =>
    field(d) + ' produces more bars than pixels along the category axis. Aggregate categories to make the bars readable.' },
  AX133: { level: 'hint', message: d =>
    field(d) + ' produces more than 50,000 scatter points. Drawing may be slow. Filter or aggregate points to reduce drawing time.' },
  AX140: { level: 'warning', message: () =>
    'The chart uses a generated name. Set title or labelledBy to give it a descriptive name.' },
  AX141: { level: 'warning', message: () =>
    'The chart palette has less than 3:1 contrast against the background. Adjust the colors or background to reach 3:1.' },
  AX142: { level: 'hint', message: () =>
    'The plot is too small to draw and shows the summary and table control. Give the plot more room.' },
  AX143: { level: 'hint', message: d =>
    field(d) + ' has ' + count(d, 'label') + ' that could not fit. Give the plot more room or shorten the labels.' },
  AX150: { level: 'warning', message: d =>
    'Option ' + quote(d.field ?? '') + ' is ignored. ' + (d.detail ?? 'Use an option supported by this chart.') + suggestion(d) },
  AX151: { level: 'warning', message: d =>
    field(d) + ' has out-of-order append values' + rows(d) + '. A full update was used. Append rows in x order at or after the last x.' },
  AX160: { level: 'warning', message: d =>
    field(d) + ' has a custom formatter that threw' + rows(d) + '. The default format was used. Make the formatter handle every value of this field.' },
} as const satisfies Record<Diagnostic['code'], Entry>;

export type DiagnosticCode = keyof typeof diagnosticRegistry;

type MessageContext = Pick<DiagnosticDetails, 'examples' | 'keys' | 'suggestion' | 'detail'>;
const contexts = new WeakMap<DiagnosticInput, MessageContext>();

export function diagnosticContext(diagnostic: DiagnosticInput): MessageContext | undefined {
  return contexts.get(diagnostic);
}

export function createDiagnostic(
  code: DiagnosticCode,
  effect: DiagnosticEffect,
  details: DiagnosticDetails = {},
  origin: DiagnosticInput['origin'] = 'call',
): DiagnosticInput {
  const { field, rows, count, ...context } = details;
  const firstRows = rows?.slice(0, 10);
  const entry = diagnosticRegistry[code];
  const diagnostic: DiagnosticInput = {
    code, level: entry.level, effect, origin,
    message: entry.message({ field, rows: firstRows, count, ...context }),
    ...(field === undefined ? {} : { field }),
    ...(firstRows === undefined ? {} : { rows: firstRows }),
    ...(count === undefined ? {} : { count }),
  };
  contexts.set(diagnostic, context);
  return diagnostic;
}

export function report(sink: DiagnosticSink, code: DiagnosticCode, effect: DiagnosticEffect, details?: DiagnosticDetails): void {
  sink.add(createDiagnostic(code, effect, details));
}
