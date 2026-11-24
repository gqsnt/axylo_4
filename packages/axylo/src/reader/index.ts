import { SLOT_VALUE, type DiagnosticSink, type Formatters, type IndexRange, type ReaderModel, type View } from '../core/contracts';
import { report } from '../diagnostics';
import { sliceText } from '../lookup/text';
import { chartTypeName, defaultMessages, fill, fillChartSummary, fillDonutSlice, messageLanguage } from '../messages';
import type { Messages, Title } from '../public';
import { alignedTable, donutTable, scatterTable, type ReaderLabels, type TableBuilder } from './table';

export interface ReaderInput {
  readonly view: View;
  readonly formatters: Formatters;
  readonly messages: Messages;
  /** Retained for callers that previously supplied the chart type label. */
  readonly type: string;
  readonly title?: string | Title;
  readonly labelledBy?: string;
  /** Visible text of the external heading when the chart uses labelledBy. */
  readonly caption?: string;
  readonly subtitle?: string;
  readonly description?: string;
  readonly disclosure?: { readonly omitted: number; readonly changed: number };
  readonly labelsHidden?: number;
  readonly table?: boolean;
  readonly compact?: boolean;
  readonly locale?: string;
  readonly labels?: Partial<ReaderLabels>;
  readonly diagnostics?: DiagnosticSink;
}

const MAX_STACK_POSITIONS = 3;

function statistics(y: Float64Array | Float32Array, { start, end }: IndexRange, slot?: Uint8Array) {
  let min = Infinity;
  let max = -Infinity;
  let last = NaN;
  for (let i = start; i < end; i++) {
    if (slot && slot[i] !== SLOT_VALUE) continue;
    const value = y[i]!;
    if (!Number.isFinite(value)) continue;
    last = value;
    if (last < min) min = last;
    if (last > max) max = last;
  }
  return { min, max, last };
}

type TableSentence = 'valuesNotShown' | 'valuesChanged' | 'labelsHidden' | 'seriesNotDrawn';
type TextRun = { readonly text: string; readonly lang: 'en' | null };

function addRun(runs: TextRun[], text: string, lang: TextRun['lang']): void {
  if (text === '') return;
  const last = runs.at(-1);
  if (last?.lang === lang) runs[runs.length - 1] = { text: last.text + text, lang };
  else runs.push({ text, lang });
}

function textOf(runs: readonly TextRun[]): string {
  return runs.map(run => run.text).join('');
}

function omitTable(template: string): string {
  const placeholder = /\{seeTable\}/;
  if (!placeholder.test(template)) return template;
  const wrapped = /\(\s*\{seeTable\}\s*\)|\[\s*\{seeTable\}\s*\]|\{\s*\{seeTable\}\s*\}|【\s*\{seeTable\}\s*】|（\s*\{seeTable\}\s*）/gu;
  return template.replace(wrapped, '{seeTable}')
    .replace(/(\s*)\{seeTable\}(\s*)/g, (_, before: string, after: string, at: number, source: string) => {
      const next = source[at + before.length + '{seeTable}'.length + after.length];
      return at > 0 && next !== undefined && !/[.,;:!?。！？)\]】）]/u.test(next) && (before || after) ? ' ' : '';
    }).replace(/[\s\p{Bidi_Control}]+$/u, '').trimStart();
}

/** Builds one disclosure with literal whitespace and language to preserve when joining its runs. */
export function tableSentence(
  messages: Messages, key: TableSentence, values: Readonly<Record<string, string | number>>, table: boolean,
): TextRun[] {
  const result: TextRun[] = [];
  const lang = messageLanguage(messages, key);
  const template = table && messages.seeTable !== '' ? messages[key] : omitTable(messages[key]);
  let start = 0;
  for (const match of template.matchAll(/\{(\w+)\}/gu)) {
    const name = match[1]!;
    addRun(result, template.slice(start, match.index), lang);
    if (name === 'seeTable') addRun(result, messages.seeTable, messageLanguage(messages, 'seeTable'));
    else if (Object.hasOwn(values, name)) addRun(result, String(values[name]), name === 'series' ? null : lang);
    else addRun(result, match[0], lang);
    start = match.index + match[0].length;
  }
  addRun(result, template.slice(start), lang);
  return result;
}

export function seriesNotDrawnSentence(messages: Messages, series: string, table: boolean): string {
  return textOf(tableSentence(messages, 'seriesNotDrawn', { series }, table));
}

function joinSentences(sentences: readonly (readonly TextRun[])[]): TextRun[] {
  const runs: TextRun[] = [];
  for (const sentence of sentences) {
    if (runs.length && sentence.length) addRun(runs, ' ', runs.at(-1)!.lang);
    for (const { text, lang } of sentence) addRun(runs, text, lang);
  }
  return runs;
}

type ChartText = (input: ReaderInput, type: string, xLabel: string, yLabel: string, table: boolean, listReady?: boolean) => string[];

const listFormats = new Map<string | undefined, Intl.ListFormat>();

/** Names joined as a list in the chart's locale ("Visits and Signups"). */
function listOf(names: readonly string[], locale: string | undefined): string {
  if (names.length < 2) return names[0] ?? '';
  if (locale === 'en') {
    return names.slice(0, -1).join(', ') + (names.length === 2 ? ' and ' : ', and ') + names.at(-1);
  }
  try {
    let format = listFormats.get(locale);
    if (!format) {
      format = new Intl.ListFormat(locale, { type: 'conjunction' });
      if (listFormats.size >= 64) listFormats.clear();
      listFormats.set(locale, format);
    }
    return format.format(names);
  } catch {
    return names.join(', ');
  }
}

/** What differs between frame shapes in the reader: the table and the summary's data sentences. */
export interface ReaderParts {
  readonly table: TableBuilder;
  readonly text: ChartText;
}

const donutText: ChartText = (input, type) => {
  const { view, formatters, messages } = input;
  if (view.kind !== 'donut') return [];
  const drawn = view.slices.filter(slice => slice.angles !== null);
  if (!drawn.length) return [messages.empty];
  return [
    fill(messages.donutSummary, { type, count: formatters.count(drawn.length), total: formatters.value(0, view.total) }),
    ...drawn.map(slice => {
      const { label, value, percent } = sliceText(view, slice, formatters);
      return fillDonutSlice(label, value, percent ?? '');
    }),
  ];
};

const cartesianText: ChartText = (input, type, xLabel, yLabel, table, listReady) => {
  const { view, formatters, messages } = input;
  if (view.kind === 'donut') return [];

  let xMin = Infinity;
  let xMax = -Infinity;
  let min = Infinity;
  let max = -Infinity;
  let minSeries = 0;
  let maxSeries = 0;
  let drawable = 0;
  const ranged: number[] = [];
  const entries: string[] = [];
  const undrawn: string[] = [];
  const { frame } = view;
  const zone = view.kind === 'scatter'
    ? view.frame.xKind === 'time' && view.frame.timeZone
    : view.frame.x.kind === 'time' && view.frame.x.timeZone;

  if (view.kind !== 'scatter') {
    const { start, end } = view.visibleSlots;
    if (start < end) {
      xMin = view.frame.binEdges?.[start] ?? view.frame.x.values[start]!;
      xMax = view.frame.binEdges?.[end] ?? view.frame.x.values[end - 1]!;
    }
  }
  frame.series.forEach((series, s) => {
    if (!series.drawable) {
      undrawn.push(seriesNotDrawnSentence(messages, series.label, table));
      return;
    }
    drawable++;
    if (!view.visible[s]) return;
    const range = view.kind === 'scatter' ? view.visiblePoints[s]! : view.visibleSlots;
    if (range.start < range.end && 'x' in series) {
      xMin = Math.min(xMin, series.x[range.start]!);
      xMax = Math.max(xMax, series.x[range.end - 1]!);
    }
    const stats = statistics(series.y, range, 'slot' in series ? series.slot : undefined);
    if (Number.isFinite(stats.last)) ranged.push(s);
    if (stats.min < min) { min = stats.min; minSeries = s; }
    if (stats.max > max) { max = stats.max; maxSeries = s; }
    entries.push(Number.isFinite(stats.last) ? fill(messages.seriesSummary, {
      series: series.label, min: formatters.value(s, stats.min),
      max: formatters.value(s, stats.max), last: formatters.value(s, stats.last),
    }) : fill(messages.seriesNoData, { series: series.label }));
  });

  const zoneText = zone ? [fill(messages.timeZoneNote, { zone })] : [];
  if (!entries.length || !Number.isFinite(xMin) || !Number.isFinite(xMax)) return [...undrawn, messages.empty, ...zoneText];
  // One range over series in different units would put one unit on one end and another on the other end:
  // then each series' own sentence gives its range in its unit, and the chart's sentence has none.
  const unitOf = (s: number) => {
    const series = frame.series[s]!;
    return 'unit' in series ? `${series.unit}\u0001${series.valueScale}` : '';
  };
  const oneUnit = ranged.every(s => unitOf(s) === unitOf(ranged[0]!));
  const range = Number.isFinite(min) && Number.isFinite(max) && oneUnit
    ? { yMin: formatters.value(minSeries, min), yMax: formatters.value(maxSeries, max) } : null;
  let rangeLabel = yLabel;
  if (view.kind !== 'scatter' && !frame.yLabel && ranged.length) {
    if (ranged.length === 1) rangeLabel = frame.series[ranged[0]!]!.label;
    // A failed locale lookup is retried when the summary is read.
    else if (ranged.length !== drawable || !listReady) {
      rangeLabel = listOf(ranged.map(s => frame.series[s]!.label), input.locale);
    }
  }
  return [
    fillChartSummary(messages.chartSummary, {
      type, seriesCount: formatters.count(entries.length), xLabel, xMin: formatters.x(xMin), xMax: formatters.x(xMax), yLabel: rangeLabel,
    }, range),
    ...zoneText, ...entries, ...undrawn,
  ];
};

export const alignedReader: ReaderParts = { table: alignedTable, text: cartesianText };
export const scatterReader: ReaderParts = { table: scatterTable, text: cartesianText };
export const donutReader: ReaderParts = { table: donutTable, text: donutText };

function stackText(view: View, formatters: Formatters, messages: Messages): string {
  if (view.kind === 'donut' || view.kind === 'scatter') return '';
  const flags = view.stack?.incomplete;
  if (!flags) return '';
  const positions: number[] = [];
  let count = 0;
  for (let i = view.visibleSlots.start; i < view.visibleSlots.end; i++) {
    if (!flags[i]) continue;
    if (count < MAX_STACK_POSITIONS) positions.push(view.frame.x.values[i]!);
    count++;
  }
  if (!count) return '';
  const label = view.frame.xLabel;
  return count > MAX_STACK_POSITIONS
    ? fill(messages.incompleteCount, { label, count: formatters.count(count) })
    : fill(messages.incompleteAt, { label, positions: positions.map(position => formatters.x(position)).join(', ') });
}

function referenceText(view: View, formatters: Formatters, messages: Messages): string[] {
  if (view.kind === 'donut') return [];
  return view.references.map(({ axis, from, to, label }) => {
    const write = axis === 'x' ? (x: number) => formatters.x(x) : (y: number) => formatters.value(0, y);
    const values = { label, axis, from: write(from) };
    return from === to ? fill(messages.referenceLine, values) : fill(messages.referenceBand, { ...values, to: write(to) });
  });
}

export type BuiltReader = ReaderModel & { readonly noteSegments: readonly TextRun[] | null };

/** Every kind's reader, dispatched on the view (a kind's composition calls readerWith with its own parts). */
export function buildReader(input: ReaderInput): BuiltReader {
  const view = input.view;
  return readerWith(view.kind === 'donut' ? donutReader : view.kind === 'scatter' ? scatterReader : alignedReader, input);
}

export function readerWith(parts: ReaderParts, input: ReaderInput): BuiltReader {
  const { view, title, labelledBy, subtitle, description, formatters, messages, disclosure } = input;
  const labels = {
    category: input.labels?.category ?? messages.category,
    percentage: input.labels?.percentage ?? messages.percentage,
    series: input.labels?.series ?? messages.series,
    value: input.labels?.value ?? messages.value,
    xUnit: input.labels?.xUnit,
  };
  const type = chartTypeName(messages, view.kind);
  const xLabel = view.kind === 'donut' ? labels.category : view.frame.xLabel;
  const yLabel = view.kind === 'donut' ? view.frame.valueLabel
    : view.kind === 'scatter' ? view.frame.yLabel
    : view.frame.yLabel || listOf(view.frame.series.flatMap(s => s.drawable ? [s.label] : []), input.locale) || labels.value;
  const listReady = input.locale === 'en' || listFormats.has(input.locale);
  const titleText = typeof title === 'string' ? title : title?.text;
  if (!labelledBy && !titleText && input.diagnostics) report(input.diagnostics, 'AX140', 'none');
  const generated = fill(messages.chartName, { type, x: xLabel, y: yLabel });
  const name = labelledBy ? '' : titleText || generated;
  const compact = input.compact === true || (view.kind !== 'donut' && view.compact);
  let references: string[] | undefined;
  const referencesForView = () => references ??= compact ? [] : referenceText(view, formatters, messages);
  const caption = [input.caption, name, generated, messages.plotLabel].find(text => text?.trim()) ?? defaultMessages.plotLabel;
  const table = input.table === false || compact ? null : parts.table(
    view, [caption, ...referencesForView()].join(' '), formatters, messages, labels, input.locale,
  );
  const hasTable = table !== null;
  const omitted = disclosure?.omitted ?? 0;
  const changed = disclosure?.changed ?? 0;
  const statements: TextRun[][] = [];
  if (omitted > 0 || changed > 0) {
    const counts = { omitted: formatters.count(omitted), changed: formatters.count(changed) };
    if (omitted > 0) statements.push(tableSentence(messages, 'valuesNotShown', { ...counts, count: counts.omitted }, hasTable));
    if (changed > 0) statements.push(tableSentence(messages, 'valuesChanged', { ...counts, count: counts.changed }, hasTable));
  }
  const omission = textOf(joinSentences(statements));
  const hidden = input.labelsHidden ?? 0;
  if (hidden > 0) statements.push(tableSentence(messages, 'labelsHidden', { count: formatters.count(hidden) }, hasTable));
  const noteSegments = joinSentences(statements);
  const note = textOf(noteSegments) || null;
  let summary: string | undefined;
  return {
    name, note, table, noteSegments: note ? noteSegments : null,
    get summary() {
      // Opening the table should not scan the rest of the frame.
      return summary ??= [
        ...parts.text(input, type, xLabel, yLabel, hasTable, listReady), compact ? stackText(view, formatters, messages) : '',
        ...referencesForView(), subtitle, omission, description,
      ].filter(Boolean).join(' ');
    },
  };
}
