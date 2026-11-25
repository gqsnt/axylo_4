import type { AlignedFrame, DiagnosticSink, Formatters, IndexRange, ReaderModel, View } from '../core/contracts';
import { report } from '../diagnostics';
import { sliceText } from '../lookup/text';
import { chartTypeName, defaultMessages, fill, fillChartSummary, fillDonutSlice, messageLanguage } from '../messages';
import type { Messages, Title } from '../public';
import { alignedStatistics } from '../view';
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

function statistics(y: Float64Array, { start, end }: IndexRange) {
  let min = Infinity;
  let max = -Infinity;
  let last = NaN;
  for (let i = start; i < end; i++) {
    const value = y[i]!;
    if (value === value && value !== Infinity && value !== -Infinity) {
      last = value;
      if (value < min) min = value;
      if (value > max) max = value;
    }
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
  let text = '';
  for (const run of runs) text += run.text;
  return text;
}

function omitTable(template: string): string {
  if (!template.includes('{seeTable}')) return template;
  const wrapped = /\(\s*\{seeTable\}\s*\)|\[\s*\{seeTable\}\s*\]|\{\s*\{seeTable\}\s*\}|【\s*\{seeTable\}\s*】|（\s*\{seeTable\}\s*）/gu;
  return template.replace(wrapped, '{seeTable}')
    .replace(/(\s*)\{seeTable\}(\s*)/g, (match: string, before: string, after: string, at: number, source: string) => {
      const next = source[at + match.length];
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

function appendSentence(runs: TextRun[], sentence: readonly TextRun[]): void {
  if (runs.length && sentence.length) addRun(runs, ' ', runs.at(-1)!.lang);
  for (const { text, lang } of sentence) addRun(runs, text, lang);
}

type ChartText = (input: ReaderInput, type: string, xLabel: string, yLabel: string, table: boolean, listReady?: boolean) => string[];

const listFormats = new Map<string | undefined, Intl.ListFormat>();

function englishList(locale: string | undefined): boolean {
  return locale === 'en';
}

/** Names joined as a list in the chart's locale ("Visits and Signups"). */
function listOf(names: readonly string[], locale: string | undefined): string {
  const length = names.length;
  if (length < 2) return names[0] ?? '';
  if (englishList(locale)) {
    if (length === 2) return names[0]! + ' and ' + names[1]!;
    let text = names[0]!;
    for (let i = 1; i < length - 1; i++) text += ', ' + names[i];
    return text + ', and ' + names[length - 1];
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

function seriesNames(frame: AlignedFrame, locale: string | undefined): string {
  const { series } = frame;
  if (series.length === 1) return series[0]!.drawable ? series[0]!.label : '';
  const names: string[] = [];
  for (const entry of series) if (entry.drawable) names.push(entry.label);
  return listOf(names, locale);
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
  const sentences = [fill(messages.donutSummary, {
    type, count: formatters.count(drawn.length), total: formatters.value(0, view.total),
  })];
  for (const slice of drawn) {
    const { label, value, percent } = sliceText(view, slice, formatters);
    sentences.push(fillDonutSlice(label, value, percent ?? ''));
  }
  return sentences;
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
  let unit: string | undefined;
  let oneUnit = true;
  let rangeNames: string[] | undefined;
  const entries: string[] = [];
  let undrawn: string[] | undefined;
  const { frame } = view;
  const nameRange = view.kind !== 'scatter' && !frame.yLabel;
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
  for (let s = 0; s < frame.series.length; s++) {
    const series = frame.series[s]!;
    if (!series.drawable) {
      (undrawn ??= []).push(seriesNotDrawnSentence(messages, series.label, table));
      continue;
    }
    drawable++;
    if (!view.visible[s]) continue;
    const range = view.kind === 'scatter' ? view.visiblePoints[s]! : view.visibleSlots;
    if (range.start < range.end && 'x' in series) {
      xMin = Math.min(xMin, series.x[range.start]!);
      xMax = Math.max(xMax, series.x[range.end - 1]!);
    }
    const stats = 'slot' in series ? alignedStatistics(series, range.start, range.end) : statistics(series.y, range);
    if (stats.min < min) { min = stats.min; minSeries = s; }
    if (stats.max > max) { max = stats.max; maxSeries = s; }
    const hasValue = Number.isFinite(stats.last);
    if (hasValue) {
      if (nameRange) (rangeNames ??= []).push(series.label);
      if (oneUnit && 'unit' in series) {
        // A shared range needs a single unit and scale on both ends.
        const current = `${series.unit}\u0001${series.valueScale}`;
        unit ??= current;
        oneUnit = unit === current;
      }
    }
    entries.push(hasValue ? fill(messages.seriesSummary, {
      series: series.label, min: formatters.value(s, stats.min),
      max: formatters.value(s, stats.max), last: formatters.value(s, stats.last),
    }) : fill(messages.seriesNoData, { series: series.label }));
  }

  const zoneText = zone ? fill(messages.timeZoneNote, { zone }) : null;
  if (!entries.length || !Number.isFinite(xMin) || !Number.isFinite(xMax)) {
    const sentences = undrawn ?? [];
    sentences.push(messages.empty);
    if (zoneText !== null) sentences.push(zoneText);
    return sentences;
  }
  const range = Number.isFinite(min) && Number.isFinite(max) && oneUnit
    ? { yMin: formatters.value(minSeries, min), yMax: formatters.value(maxSeries, max) } : null;
  let rangeLabel = yLabel;
  if (rangeNames) {
    if (rangeNames.length === 1) rangeLabel = rangeNames[0]!;
    // A failed locale lookup is retried when the summary is read.
    else if (rangeNames.length !== drawable || !listReady) {
      rangeLabel = listOf(rangeNames, input.locale);
    }
  }
  const heading = fillChartSummary(messages.chartSummary, {
    type, seriesCount: formatters.count(entries.length), xLabel, xMin: formatters.x(xMin), xMax: formatters.x(xMax), yLabel: rangeLabel,
  }, range);
  if (zoneText === null) entries.unshift(heading);
  else entries.unshift(heading, zoneText);
  if (undrawn) for (const sentence of undrawn) entries.push(sentence);
  return entries;
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
    const start = axis === 'x' ? formatters.x(from) : formatters.value(0, from);
    if (from === to) return fill(messages.referenceLine, { label, axis, from: start });
    const end = axis === 'x' ? formatters.x(to) : formatters.value(0, to);
    return fill(messages.referenceBand, { label, axis, from: start, to: end });
  });
}

function addSentence(text: string, sentence: string | undefined): string {
  return !sentence ? text : text ? `${text} ${sentence}` : sentence;
}

export type BuiltReader = ReaderModel & { readonly noteSegments: readonly TextRun[] | null };

/** Every kind's reader, dispatched on the view (a kind's composition calls readerWith with its own parts). */
export function buildReader(input: ReaderInput): BuiltReader {
  const view = input.view;
  return readerWith(view.kind === 'donut' ? donutReader : view.kind === 'scatter' ? scatterReader : alignedReader, input);
}

export function readerWith(parts: ReaderParts, input: ReaderInput): BuiltReader {
  const { view, title, labelledBy, subtitle, description, formatters, messages, disclosure } = input;
  const custom = input.labels;
  const category = custom?.category ?? messages.category;
  const value = custom?.value ?? messages.value;
  const type = chartTypeName(messages, view.kind);
  const xLabel = view.kind === 'donut' ? category : view.frame.xLabel;
  const yLabel = view.kind === 'donut' ? view.frame.valueLabel
    : view.kind === 'scatter' ? view.frame.yLabel
    : view.frame.yLabel || seriesNames(view.frame, input.locale) || value;
  const listReady = englishList(input.locale) || listFormats.has(input.locale);
  const titleText = typeof title === 'string' ? title : title?.text;
  if (!labelledBy && !titleText && input.diagnostics) report(input.diagnostics, 'AX140', 'none');
  let generated: string | undefined;
  const name = labelledBy ? '' : titleText || (generated = fill(messages.chartName, { type, x: xLabel, y: yLabel }));
  const compact = input.compact === true || (view.kind !== 'donut' && view.compact);
  const hasReferences = !compact && view.kind !== 'donut' && view.references.length > 0;
  let references: string[] | undefined;
  let table: ReaderModel['table'] = null;
  if (input.table !== false && !compact) {
    let caption = input.caption;
    if (!caption?.trim()) caption = name;
    if (!caption.trim()) caption = generated ?? fill(messages.chartName, { type, x: xLabel, y: yLabel });
    if (!caption.trim()) caption = messages.plotLabel?.trim() ? messages.plotLabel : defaultMessages.plotLabel;
    if (hasReferences) {
      references = referenceText(view, formatters, messages);
      for (const reference of references) caption += ' ' + reference;
    }
    table = parts.table(view, caption, formatters, messages, {
      category, value, percentage: custom?.percentage ?? messages.percentage,
      series: custom?.series ?? messages.series, xUnit: custom?.xUnit,
    }, input.locale);
  }
  const hasTable = table !== null;
  const omitted = disclosure?.omitted ?? 0;
  const changed = disclosure?.changed ?? 0;
  const hidden = input.labelsHidden ?? 0;
  let noteSegments: TextRun[] | null = null;
  let omission = '';
  if (omitted > 0 || changed > 0) {
    noteSegments = [];
    const counts = { omitted: formatters.count(omitted), changed: formatters.count(changed) };
    if (omitted > 0) appendSentence(noteSegments, tableSentence(messages, 'valuesNotShown', { ...counts, count: counts.omitted }, hasTable));
    if (changed > 0) appendSentence(noteSegments, tableSentence(messages, 'valuesChanged', { ...counts, count: counts.changed }, hasTable));
    omission = textOf(noteSegments);
  }
  let note = omission || null;
  if (hidden > 0) {
    noteSegments ??= [];
    appendSentence(noteSegments, tableSentence(messages, 'labelsHidden', { count: formatters.count(hidden) }, hasTable));
    note = textOf(noteSegments) || null;
  }
  let summary: string | undefined;
  return {
    name, note, table, noteSegments: note ? noteSegments : null,
    get summary() {
      // Opening the table should not scan the rest of the frame.
      if (summary !== undefined) return summary;
      let text = '';
      for (const sentence of parts.text(input, type, xLabel, yLabel, hasTable, listReady)) text = addSentence(text, sentence);
      if (compact) text = addSentence(text, stackText(view, formatters, messages));
      if (hasReferences) {
        references ??= referenceText(view, formatters, messages);
        for (const reference of references) text = addSentence(text, reference);
      }
      text = addSentence(text, subtitle);
      text = addSentence(text, omission);
      return summary = addSentence(text, description);
    },
  };
}
