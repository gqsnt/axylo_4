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
  readonly series?: readonly string[];
  readonly sparseSeries?: readonly string[];
  readonly zeroSeries?: readonly string[];
  readonly outcome?: string;
}

const quote = (name: string) => JSON.stringify(name);
const field = (d: DiagnosticDetails) => d.field === undefined ? 'The chart' : 'Field ' + quote(d.field);
const rows = (d: DiagnosticDetails) => d.rows?.length ? ' at ' + (d.rows.length === 1 ? 'row ' : 'rows ') + d.rows.join(', ') : '';
const samples = (d: DiagnosticDetails) => d.examples?.length ? ' (' + d.examples.join(', ') + ')' : '';
const count = (d: DiagnosticDetails, word: string, plural = word + 's') =>
  (d.count ?? 1) + ' ' + ((d.count ?? 1) === 1 ? word : plural);
const suggestion = (d: DiagnosticDetails) => d.suggestion === undefined ? '' : ' Did you mean ' + quote(d.suggestion) + '?';
const series = (names?: readonly string[]) => names?.length ? ' in series ' + names.map(quote).join(', ') : '';

type Entry = { readonly level: Diagnostic['level']; readonly message: (details: DiagnosticDetails) => string };

function entry<Level extends Diagnostic['level']>(
  level: Level, message: Entry['message'], outcome: string | Entry['message'],
): Entry & { readonly level: Level } {
  return {
    level,
    message: details => message(details) + ' ' +
      (details.outcome ?? (typeof outcome === 'string' ? outcome : outcome(details))),
  };
}

export const diagnosticRegistry = {
  AX100: entry('error', d =>
    field(d) + ' belongs to columns with different lengths' + samples(d) + '. Supply equally long columns.',
  'The chart shows its error state.'),
  AX101: entry('error', d =>
    field(d) + ' is missing from the data. Available fields: ' +
    (d.keys?.length ? d.keys.map(quote).join(', ') : '(none)') + '.' + suggestion(d) + ' Use an available field or add the field to the data.',
  'The chart shows its error state.'),
  AX102: entry('warning', d =>
    (d.outcome === 'The affected row is not drawn.'
      ? field(d) + ' is absent' + rows(d) + ', affecting ' + count(d, 'value')
      : field(d) + ' is absent in ' + count(d, 'record') + rows(d)) +
    '. Supply the field and send null if the value is known to be missing.',
  'Shown as gaps.'),
  AX103: entry('warning', d =>
    field(d) + ' has ' + count(d, 'non-finite value') + rows(d) + samples(d) + '. Check the calculation that produced it or send null for no data.',
  'Shown as gaps.'),
  AX104: entry('hint', d =>
    field(d) + ' has ' + count(d, 'decimal string') + rows(d) + '. Set parse: \'number\' to make conversion explicit.',
  'The strings are parsed and drawn as numbers.'),
  AX105: entry('hint', d =>
    field(d) + ' is missing ' + count(d, 'expected step') + series(d.series) + samples(d) +
    '. Supply observations for those positions or explicit nulls to mark gaps.',
  d => {
    const outcomes = [];
    const regular = d.series?.some(name => !d.sparseSeries?.includes(name) && !d.zeroSeries?.includes(name));
    if (regular || !d.sparseSeries?.length && d.zeroSeries === undefined) outcomes.push('Shown as gaps.');
    if (d.zeroSeries !== undefined) {
      outcomes.push(regular || d.sparseSeries?.length ? 'Absent steps' + series(d.zeroSeries) + ' are shown as zeros.' : 'Shown as zeros.');
    }
    if (d.sparseSeries?.length) {
      outcomes.push('The data' + series(d.sparseSeries) + ' was too sparse to show its absent steps as gaps.');
    }
    return outcomes.join(' ');
  }),
  AX106: entry('warning', d =>
    field(d) + ' has ' + count(d, 'value that cannot be plotted as a number', 'values that cannot be plotted as numbers') +
    rows(d) + samples(d) + '. Convert values to numbers where the data is produced.',
  'The affected values are not drawn.'),
  AX107: entry('warning', d =>
    field(d) + ' has ' + count(d, 'unusable value') + rows(d) + samples(d) + '. ' +
    (d.detail ?? 'Supply an x value in the declared or inferred format for each row.'),
  'The affected rows are not drawn.'),
  AX108: entry('error', d =>
    field(d) + ' has ' + count(d, 'duplicate') + series(d.series) + rows(d) + samples(d) +
    '. Provide one row per x and series, or one row per donut label.',
  d => d.series && d.series.length > 1 ? 'The affected series are not drawn.' : 'The affected series is not drawn.'),
  AX109: entry('hint', d =>
    field(d) + ' has ' + count(d, 'numeric timestamp') + rows(d) + '. ' +
    (d.detail ?? 'Set type: \'time\' for instants and supply epoch milliseconds.'),
  'The values are drawn as declared.'),
  AX110: entry('warning', d =>
    field(d) + ' has a domain that excludes zero. Include zero in the domain.',
  'The domain is widened to include zero.'),
  AX111: entry('hint', d =>
    field(d) + ' contains instants that look like calendar dates' + rows(d) + '. Use date strings such as YYYY-MM-DD for calendar dates.',
  'The values are shown as instants with the time zone.'),
  AX112: entry('hint', d =>
    field(d) + ' has ' + count(d, 'date-time without an offset', 'date-times without an offset') + rows(d) +
    '. Include a UTC offset or Z if these are instants.',
  'The values are shown as written.'),
  AX120: entry('error', d =>
    field(d) + ' has ' + count(d, 'negative donut value') + rows(d) + samples(d) + '. Supply non-negative values or choose a chart that shows negatives.',
  'The chart shows its error state.'),
  AX121: entry('warning', d =>
    field(d) + ' produces more than eight donut slices. Aggregate the data or choose a bar chart to show every category.',
  'The seven largest slices are shown separately and the rest are grouped as Other (n).'),
  AX130: entry('warning', d =>
    field(d) + ' produces more than eight series. Filter or group series to reduce the number.',
  'All series are drawn with dash or marker differences.'),
  AX131: entry('hint', d =>
    field(d) + ' produces multiple series in a compact chart. Use one series or turn off compact mode for more room.',
  'The series are drawn with different dashes.'),
  AX132: entry('hint', d =>
    field(d) + ' produces more bars than pixels along the category axis. Aggregate categories to make the bars readable.',
  'All bars are drawn.'),
  AX133: entry('hint', d =>
    field(d) + ' produces more than 50,000 scatter points. Filter or aggregate points to reduce drawing time.',
  'All points are drawn, which may be slow.'),
  AX134: entry('error', d =>
    (d.detail ?? 'The aligned frame exceeds 20,000,000 slots.') + ' Use fewer series or choose a scatter chart.',
  'The chart shows its error state.'),
  AX140: entry('warning', () =>
    'The chart has no title or labelledBy. Set one to give it a descriptive name.',
  'The chart uses a generated name.'),
  AX141: entry('warning', () =>
    'The chart palette has less than 3:1 contrast against the background. Adjust the colors or background to reach 3:1.',
  'The chart is drawn as themed.'),
  AX142: entry('hint', () =>
    'The plot is too small to draw. Give the plot more room.',
  'The chart shows the summary and table control.'),
  AX143: entry('hint', d =>
    field(d) + ' has ' + count(d, 'label') + ' that could not fit. Give the plot more room or shorten the labels.',
  'The chart shows a note that labels were hidden.'),
  AX150: entry('warning', d =>
    'Option ' + quote(d.field ?? '') + ' is unsupported. ' + (d.detail ?? 'Use an option supported by this chart.') + suggestion(d),
  'The option is ignored.'),
  AX151: entry('warning', d =>
    field(d) + ' has out-of-order append values' + rows(d) + '. Append rows in x order at or after the last x.',
  'The rows are accepted through a full update.'),
  AX152: entry('warning', d =>
    'Option ' + quote(d.field ?? 'x.timeZone') + ' has an unknown time zone' + samples(d) + '. Supply a zone recognized by Intl.',
  'The viewer’s time zone is used.'),
  AX160: entry('warning', d =>
    field(d) + ' has a custom formatter that threw' + rows(d) + '. Make the formatter handle every value of this field.',
  'The default format is used for the affected value.'),
} as const satisfies Record<Diagnostic['code'], Entry>;

export type DiagnosticCode = keyof typeof diagnosticRegistry;

type MessageContext = Omit<DiagnosticDetails, 'field' | 'rows' | 'count'>;
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
  const { field, rows, count = rows?.length, ...context } = details;
  const firstRows = rows === undefined ? undefined : [...new Set(rows)].slice(0, 10);
  const outcome = context.outcome ?? (
    code === 'AX102' && effect === 'changed' ? 'Shown as zeros.'
      : code === 'AX108' && effect === 'chart-error' ? 'The donut is not drawn.'
      : code === 'AX150' && effect === 'chart-error' ? 'The chart shows its error state.'
      : undefined
  );
  const diagnostic: DiagnosticInput = {
    code, level: diagnosticRegistry[code].level, effect: code === 'AX105' ? 'none' : effect, origin,
    message: diagnosticRegistry[code].message({ field, rows: firstRows, count, ...context, outcome }),
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
