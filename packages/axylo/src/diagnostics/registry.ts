import type { DiagnosticEffect, DiagnosticInput, DiagnosticSink, View, XKind } from '../core/contracts';
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
  readonly chartType?: View['kind'];
  readonly xKind?: XKind;
  readonly horizontal?: boolean;
}

const quote = (name: string) => JSON.stringify(name);
const field = (d: DiagnosticDetails) => d.field === undefined ? 'The chart' : 'Field ' + quote(d.field);
const rows = (d: DiagnosticDetails) => d.rows?.length ? ' at ' + (d.rows.length === 1 ? 'row ' : 'rows ') + d.rows.join(', ') : '';
const samples = (d: DiagnosticDetails) => d.examples?.length ? ' (' + d.examples.join(', ') + ')' : '';
const count = (d: DiagnosticDetails, word: string, plural = word + 's') =>
  (d.count ?? 1) + ' ' + ((d.count ?? 1) === 1 ? word : plural);
const has = (d: DiagnosticDetails, word: string, plural?: string) => field(d) + ' has ' + count(d, word, plural);
const chartError = 'The chart shows its error state.';
const suggestion = (d: DiagnosticDetails) => d.suggestion === undefined ? '' : ' Did you mean ' + quote(d.suggestion) + '?';
const series = (names?: readonly string[]) => names?.length ? ' in series ' + names.map(quote).join(', ') : '';

/**
 * A code's level, its message and the default outcome sentence that follows it. Plain data: building the
 * table at import time would keep a bundler from dropping the module (message() puts the parts together).
 */
type Entry = {
  readonly level: Diagnostic['level'];
  readonly text: (details: DiagnosticDetails) => string;
  readonly outcome: string | ((details: DiagnosticDetails) => string);
};

function message(entry: Entry, details: DiagnosticDetails): string {
  const { outcome } = entry;
  return entry.text(details) + ' ' + (details.outcome ?? (typeof outcome === 'string' ? outcome : outcome(details)));
}

export const diagnosticRegistry = {
  AX100: { level: 'error', text: d =>
    field(d) + ' belongs to columns with different lengths' + samples(d) + '. Supply equally long columns.',
  outcome: chartError },
  AX101: { level: 'error', text: d =>
    field(d) + ' is missing from the data. Available fields: ' +
    (d.keys?.length ? d.keys.map(quote).join(', ') : '(none)') + '.' + suggestion(d) + ' Use an available field or add the field to the data.',
  outcome: chartError },
  AX102: { level: 'warning', text: d =>
    (d.outcome === 'The affected row is not drawn.'
      ? field(d) + ' is absent' + rows(d) + ', affecting ' + count(d, 'value')
      : field(d) + ' is absent in ' + count(d, 'record') + rows(d)) +
    '. Supply the field and send null if the value is known to be missing.',
  outcome: 'Shown as gaps.' },
  AX103: { level: 'warning', text: d =>
    has(d, 'non-finite value') + rows(d) + samples(d) + '. Check the calculation that produced it or send null for no data.',
  outcome: 'Shown as gaps.' },
  AX104: { level: 'hint', text: d =>
    has(d, 'decimal string') + rows(d) + '. Set parse: \'number\' to make conversion explicit.',
  outcome: 'The strings are parsed and drawn as numbers.' },
  AX105: { level: 'hint', text: d =>
    field(d) + ' is missing ' + count(d, 'expected step') + series(d.series) + samples(d) +
    '. Supply observations for those positions or explicit nulls to mark gaps.',
  outcome: d => {
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
  } },
  AX106: { level: 'warning', text: d =>
    has(d, 'value that cannot be plotted as a number', 'values that cannot be plotted as numbers') +
    rows(d) + samples(d) + '. Convert values to numbers where the data is produced.',
  outcome: 'The affected values are not drawn.' },
  AX107: { level: 'warning', text: d =>
    has(d, 'unusable value') + rows(d) + samples(d) + '. ' +
    (d.detail ?? 'Supply an x value in the declared or inferred format for each row.'),
  outcome: 'The affected rows are not drawn.' },
  AX108: { level: 'error', text: d =>
    has(d, 'duplicate') + series(d.series) + rows(d) + samples(d) +
    '. Provide one row per x and series, or one row per donut label.',
  outcome: d => d.series && d.series.length > 1 ? 'The affected series are not drawn.' : 'The affected series is not drawn.' },
  AX109: { level: 'hint', text: d =>
    has(d, 'numeric timestamp') + rows(d) + '. ' +
    (d.detail ?? 'Set type: \'time\' for instants and supply epoch milliseconds.'),
  outcome: 'The values are drawn as declared.' },
  AX110: { level: 'warning', text: d =>
    field(d) + ' has a domain that excludes zero. Include zero in the domain.',
  outcome: 'The domain is widened to include zero.' },
  AX111: { level: 'hint', text: d =>
    field(d) + ' contains instants that look like calendar dates' + rows(d) + '. Use date strings such as YYYY-MM-DD for calendar dates.',
  outcome: 'The values are shown as instants with the time zone.' },
  AX112: { level: 'hint', text: d =>
    has(d, 'date-time without an offset', 'date-times without an offset') + rows(d) +
    '. Include a UTC offset or Z if these are instants.',
  outcome: 'The values are shown as written.' },
  AX120: { level: 'error', text: d =>
    has(d, 'negative donut value') + rows(d) + samples(d) + '. Supply non-negative values or choose a chart that shows negatives.',
  outcome: chartError },
  AX121: { level: 'warning', text: d =>
    field(d) + ' produces more than eight donut slices. Aggregate the data or choose a bar chart to show every category.',
  outcome: 'The seven largest slices are shown separately and the rest are grouped as Other (n).' },
  AX130: { level: 'warning', text: d =>
    field(d) + ' produces more than eight series. Filter or group series to reduce the number.',
  outcome: 'All series are drawn with dash or marker differences.' },
  AX131: { level: 'hint', text: d =>
    field(d) + ' produces multiple series in a compact chart. Use one series or turn off compact mode for more room.',
  outcome: 'The series are drawn with different dashes.' },
  AX132: { level: 'hint', text: d =>
    field(d) + ' produces more bars than pixels along the category axis. Aggregate categories to make the bars readable.',
  outcome: 'All bars are drawn.' },
  AX133: { level: 'hint', text: d =>
    field(d) + ' produces more than 50,000 scatter points. Filter or aggregate points to reduce drawing time.',
  outcome: 'All points are drawn, which may be slow.' },
  AX134: { level: 'error', text: d =>
    (d.detail ?? 'The aligned frame exceeds 20,000,000 slots.') + ' Use fewer series or choose a scatter chart.',
  outcome: chartError },
  AX140: { level: 'warning', text: () =>
    'The chart has no title or labelledBy. Set one to give it a descriptive name.',
  outcome: 'The chart uses a generated name.' },
  AX141: { level: 'warning', text: () =>
    'The chart palette has less than 3:1 contrast against the background. Adjust the colors or background to reach 3:1.',
  outcome: 'The chart is drawn as themed.' },
  AX142: { level: 'hint', text: () =>
    'The plot is too small to draw. Give the plot more room.',
  outcome: 'The chart shows the summary and table control.' },
  AX143: { level: 'hint', text: d =>
    has(d, 'label') + ' that could not fit. Give the plot more room or shorten the labels.' +
    (d.chartType === 'bar' && d.xKind === 'category' && d.horizontal !== true
      ? ' For vertical bars with category labels, try horizontal bars (horizontal: true).' : ''),
  outcome: 'The chart shows a note that labels were hidden.' },
  AX150: { level: 'warning', text: d =>
    'Option ' + quote(d.field ?? '') + ' is unsupported. ' + (d.detail ?? 'Use an option supported by this chart.') + suggestion(d),
  outcome: 'The option is ignored.' },
  AX151: { level: 'warning', text: d =>
    field(d) + ' has out-of-order append values' + rows(d) + '. Append rows in x order at or after the last x.',
  outcome: 'The rows are accepted through a full update.' },
  AX152: { level: 'warning', text: d =>
    'Option ' + quote(d.field ?? 'x.timeZone') + ' has an unknown time zone' + samples(d) + '. Supply a zone recognized by Intl.',
  outcome: 'The viewer’s time zone is used.' },
  AX160: { level: 'warning', text: d =>
    field(d) + ' has a custom formatter that threw' + rows(d) + '. Make the formatter handle every value of this field.',
  outcome: 'The default format is used for the affected value.' },
  AX199: { level: 'error', text: () =>
    'Axylo failed while building this chart: an error was thrown, printed above. If it comes from your code (a row getter, a callback), fix it there; otherwise it is a defect in Axylo: please report it with that error.',
  outcome: chartError },
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
      : code === 'AX150' && effect === 'chart-error' ? chartError
      : undefined
  );
  const entry = diagnosticRegistry[code];
  const diagnostic: DiagnosticInput = {
    code, level: entry.level, effect: code === 'AX105' ? 'none' : effect, origin,
    message: message(entry, { field, rows: firstRows, count, ...context, outcome }),
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
