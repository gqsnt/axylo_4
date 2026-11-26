import type { AlignedFrame, DiagnosticSink, Formatters, IndexRange, ReaderModel, TableModel, View } from '../core/contracts';
import { report } from '../diagnostics';
import { cacheableValueSeries } from '../format';
import { sliceText } from '../lookup/text';
import { chartTypeName, defaultMessages, fill, fillChartName, fillChartSummary, fillDonutSlice, fillSeriesSummary, messageLanguage } from '../messages';
import type { Messages, Title, XValue } from '../public';
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

interface ListFormatEntry {
  readonly format: Intl.ListFormat;
  readonly lists: Map<string, string>;
}

let listFormats: Map<string | undefined, ListFormatEntry> | undefined;

function englishList(locale: string | undefined): boolean {
  return locale === 'en';
}

/** Names joined as a list in the chart's locale ("Visits and Signups"). */
function listOf(names: readonly string[], locale: string | undefined): string {
  const length = names.length;
  if (length < 2) return names[0] ?? '';
  const first = names[0]!, second = names[1]!;
  if (length === 2) return pair(first, second, locale);
  if (englishList(locale)) {
    let text = first;
    for (let i = 1; i < length - 1; i++) text += ', ' + names[i];
    return text + ', and ' + names[length - 1];
  }
  let key = '';
  for (const name of names) key += `${name.length}:${name}`;
  return localizedList(locale, key, first, second, names);
}

function pair(first: string, second: string, locale: string | undefined): string {
  if (englishList(locale)) return `${first} and ${second}`;
  return localizedList(locale, `${first.length}:${first}${second.length}:${second}`, first, second);
}

function localizedList(locale: string | undefined, key: string, first: string, second: string, names?: readonly string[]): string {
  try {
    const formats = listFormats ??= new Map();
    let entry = formats.get(locale);
    if (!entry) {
      const format = new Intl.ListFormat(locale, { type: 'conjunction' });
      if (formats.size >= 64) formats.clear();
      formats.set(locale, entry = { format, lists: new Map() });
    }
    const { format, lists } = entry;
    const cached = lists.get(key);
    if (cached !== undefined) return cached;
    const text = format.format(names ?? [first, second]);
    if (lists.size >= 128) lists.delete(lists.keys().next().value!);
    lists.set(key, text);
    return text;
  } catch {
    return names ? names.join(', ') : `${first}, ${second}`;
  }
}

interface SeriesNames {
  readonly locale: string | undefined;
  readonly labels: readonly string[];
  readonly text: string;
}

let nameLists: WeakMap<Formatters, SeriesNames> | undefined;

function seriesNames(frame: AlignedFrame, locale: string | undefined, formatters: Formatters): string {
  const { series } = frame;
  if (series.length === 1) return series[0]!.drawable ? series[0]!.label : '';
  const cached = nameLists?.get(formatters);
  if (cached && cached.locale === locale && (englishList(locale) || listFormats?.has(locale))) {
    let i = 0;
    for (const entry of series) {
      if (entry.drawable && cached.labels[i++] !== entry.label) { i = -1; break; }
    }
    if (i === cached.labels.length) return cached.text;
  }
  const names: string[] = [];
  for (const entry of series) if (entry.drawable) names.push(entry.label);
  const text = listOf(names, locale);
  if (englishList(locale) || listFormats?.has(locale)) (nameLists ??= new WeakMap()).set(formatters, { locale, labels: names, text });
  return text;
}

interface ChartName {
  readonly template: string;
  readonly type: string;
  readonly x: string;
  readonly y: string;
  readonly text: string;
}

let chartNames: WeakMap<Formatters, ChartName> | undefined;

function chartName(formatters: Formatters, template: string, type: string, x: string, y: string): string {
  const cached = chartNames?.get(formatters);
  if (cached && cached.template === template && cached.type === type && cached.x === x && cached.y === y) return cached.text;
  const text = fillChartName(template, type, x, y);
  (chartNames ??= new WeakMap()).set(formatters, { template, type, x, y, text });
  return text;
}

interface FormattedStats {
  min: number;
  max: number;
  last: number;
  minText: string;
  maxText: string;
  lastText: string;
}

interface StatsCache {
  readonly locale: string | undefined;
  readonly value: Formatters['value'];
  readonly series: (FormattedStats | undefined)[];
}

let formattedStats: WeakMap<Formatters, StatsCache> | undefined;

function statsCache(input: ReaderInput): StatsCache {
  const { formatters, locale } = input;
  const cached = formattedStats?.get(formatters);
  if (cached && cached.value === formatters.value && cached.locale === locale) return cached;
  const next = { locale, value: formatters.value, series: [] };
  (formattedStats ??= new WeakMap()).set(formatters, next);
  return next;
}

function seriesStats(cache: StatsCache, formatters: Formatters, s: number, min: number, max: number, last: number): FormattedStats {
  const entry = cache.series[s];
  if (!entry) {
    const minText = formatters.value(s, min);
    const maxText = Object.is(max, min) ? minText : formatters.value(s, max);
    const lastText = Object.is(last, min) ? minText : Object.is(last, max) ? maxText : formatters.value(s, last);
    return cache.series[s] = { min, max, last, minText, maxText, lastText };
  }
  if (!Object.is(entry.min, min)) { entry.minText = formatters.value(s, min); entry.min = min; }
  if (!Object.is(entry.max, max)) {
    entry.maxText = Object.is(max, min) ? entry.minText : formatters.value(s, max);
    entry.max = max;
  }
  if (!Object.is(entry.last, last)) {
    entry.lastText = Object.is(last, min) ? entry.minText : Object.is(last, max) ? entry.maxText : formatters.value(s, last);
    entry.last = last;
  }
  return entry;
}

/** What differs between frame shapes in the reader: the table and the summary's data sentences. */
export interface ReaderParts {
  readonly table: TableBuilder;
  readonly tableRowCount?: (view: View) => number | null;
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
  let minText: string | undefined;
  let maxText: string | undefined;
  let drawable = 0;
  let unit: string | undefined;
  let oneUnit = true;
  let rangeNames: string[] | undefined;
  let undrawn: string[] | undefined;
  const { frame } = view;
  const cacheable = cacheableValueSeries(formatters.value);
  let cache: StatsCache | undefined;
  const nameRange = view.kind !== 'scatter' && !frame.yLabel;
  const zone = view.kind === 'scatter'
    ? view.frame.xKind === 'time' && view.frame.timeZone
    : view.frame.x.kind === 'time' && view.frame.x.timeZone;
  // Reserve the heading and optional zone sentence without moving the series sentences later.
  const entries = zone ? ['', ''] : [''];
  const headingLength = entries.length;

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
    const hasValue = Number.isFinite(stats.last);
    const formatted = hasValue && cacheable?.[s]
      ? seriesStats(cache ??= statsCache(input), formatters, s, stats.min, stats.max, stats.last) : undefined;
    if (stats.min < min) { min = stats.min; minSeries = s; minText = formatted?.minText; }
    if (stats.max > max) { max = stats.max; maxSeries = s; maxText = formatted?.maxText; }
    if (hasValue) {
      if (nameRange) (rangeNames ??= []).push(series.label);
      if (frame.series.length > 1 && oneUnit && 'unit' in series) {
        // A shared range needs a single unit and scale on both ends.
        const current = `${series.unit}\u0001${series.valueScale}`;
        unit ??= current;
        oneUnit = unit === current;
      }
    }
    entries.push(hasValue ? fillSeriesSummary(messages.seriesSummary, series.label,
      formatted?.minText ?? formatters.value(s, stats.min), formatted?.maxText ?? formatters.value(s, stats.max),
      formatted?.lastText ?? formatters.value(s, stats.last),
    ) : fill(messages.seriesNoData, { series: series.label }));
  }

  const zoneText = zone ? fill(messages.timeZoneNote, { zone }) : null;
  const seriesCount = entries.length - headingLength;
  if (!seriesCount || !Number.isFinite(xMin) || !Number.isFinite(xMax)) {
    const sentences = undrawn ?? [];
    sentences.push(messages.empty);
    if (zoneText !== null) sentences.push(zoneText);
    return sentences;
  }
  const range = Number.isFinite(min) && Number.isFinite(max) && oneUnit
    ? { yMin: minText ?? formatters.value(minSeries, min), yMax: maxText ?? formatters.value(maxSeries, max) } : null;
  let rangeLabel = yLabel;
  if (rangeNames) {
    if (rangeNames.length === 1) rangeLabel = rangeNames[0]!;
    // A failed locale lookup is retried when the summary is read.
    else if (rangeNames.length !== drawable || !listReady) {
      rangeLabel = listOf(rangeNames, input.locale);
    }
  }
  entries[0] = fillChartSummary(messages.chartSummary, {
    type, seriesCount: formatters.count(seriesCount), xLabel, xMin: formatters.x(xMin), xMax: formatters.x(xMax), yLabel: rangeLabel,
  }, range);
  if (zoneText !== null) entries[1] = zoneText;
  if (undrawn) for (const sentence of undrawn) entries.push(sentence);
  return entries;
};

export const alignedReader: ReaderParts = {
  table: alignedTable,
  tableRowCount(view) {
    if (view.kind === 'donut' || view.kind === 'scatter') return null;
    const { start, end } = view.visibleSlots;
    return end - start;
  },
  text: cartesianText,
};
export const scatterReader: ReaderParts = { table: scatterTable, text: cartesianText };
export const donutReader: ReaderParts = {
  table: donutTable,
  tableRowCount: view => view.kind === 'donut' ? view.frame.labels.length : null,
  text: donutText,
};

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

interface SummaryDraft {
  readonly parts: ReaderParts;
  readonly input: ReaderInput;
  readonly type: string;
  readonly xLabel: string;
  readonly yLabel: string;
  readonly listReady: boolean;
  readonly compact: boolean;
  readonly hasReferences: boolean;
  readonly references: readonly string[] | undefined;
  readonly omission: string;
}

class Reader implements BuiltReader {
  constructor(
    readonly name: string,
    readonly note: string | null,
    readonly table: TableModel | null,
    readonly noteSegments: readonly TextRun[] | null,
    private reading: SummaryDraft | string,
  ) {}

  get summary(): string {
    const draft = this.reading;
    if (typeof draft === 'string') return draft;
    const { input, type, xLabel, yLabel, listReady, compact, hasReferences, references, omission } = draft;
    const { view, formatters, messages, subtitle, description } = input;
    let text = '';
    for (const sentence of draft.parts.text(input, type, xLabel, yLabel, this.table !== null, listReady)) text = addSentence(text, sentence);
    if (compact) text = addSentence(text, stackText(view, formatters, messages));
    if (hasReferences) {
      for (const reference of references ?? referenceText(view, formatters, messages)) text = addSentence(text, reference);
    }
    text = addSentence(text, subtitle);
    text = addSentence(text, omission);
    // The finished summary no longer needs the input, reference sentences, or formatter context.
    return this.reading = addSentence(text, description);
  }
}

interface TableSource {
  readonly build: TableBuilder;
  readonly view: View;
  readonly formatters: Formatters;
  readonly messages: Messages;
  readonly labels: ReaderLabels;
  readonly locale: string | undefined;
}

class DeferredTable implements TableModel {
  constructor(readonly caption: string, readonly rowCount: number, private source: TableSource | TableModel) {}

  private get model(): TableModel {
    const source = this.source;
    if (!('build' in source)) return source;
    return this.source = source.build(source.view, this.caption, source.formatters, source.messages, source.labels, source.locale);
  }

  get headers(): readonly string[] { return this.model.headers; }
  get pageSize(): number { return this.model.pageSize; }
  row(i: number): readonly string[] | null { return this.model.row(i); }
  pageForX(x: XValue): number | null { return this.model.pageForX(x); }
}

function makeTable(parts: ReaderParts, input: ReaderInput, caption: string, labels: ReaderLabels): TableModel {
  const { view, formatters, messages, locale } = input;
  // Controls can offer an aligned or donut table from its row count before building headers or callbacks.
  const rowCount = parts.tableRowCount?.(view);
  if (rowCount != null) return new DeferredTable(caption, rowCount, { build: parts.table, view, formatters, messages, labels, locale });
  return parts.table(view, caption, formatters, messages, labels, locale);
}

/** Every kind's reader, dispatched on the view (a kind's composition calls readerWith with its own parts). */
export function buildReader(input: ReaderInput): BuiltReader {
  const view = input.view;
  return readerWith(view.kind === 'donut' ? donutReader : view.kind === 'scatter' ? scatterReader : alignedReader, input);
}

export function readerWith(parts: ReaderParts, input: ReaderInput): BuiltReader {
  const { view, title, labelledBy, formatters, messages, disclosure } = input;
  const custom = input.labels;
  const category = custom?.category ?? messages.category;
  const value = custom?.value ?? messages.value;
  const type = chartTypeName(messages, view.kind);
  const xLabel = view.kind === 'donut' ? category : view.frame.xLabel;
  const yLabel = view.kind === 'donut' ? view.frame.valueLabel
    : view.kind === 'scatter' ? view.frame.yLabel
    : view.frame.yLabel || seriesNames(view.frame, input.locale, formatters) || value;
  const listReady = englishList(input.locale) || listFormats?.has(input.locale) === true;
  const titleText = typeof title === 'string' ? title : title?.text;
  if (!labelledBy && !titleText && input.diagnostics) report(input.diagnostics, 'AX140', 'none');
  let generated: string | undefined;
  const name = labelledBy ? '' : titleText || (generated = chartName(formatters, messages.chartName, type, xLabel, yLabel));
  const compact = input.compact === true || (view.kind !== 'donut' && view.compact);
  const hasReferences = !compact && view.kind !== 'donut' && view.references.length > 0;
  let references: string[] | undefined;
  let table: ReaderModel['table'] = null;
  if (input.table !== false && !compact) {
    let caption = input.caption;
    if (!caption?.trim()) caption = name;
    if (!caption.trim()) caption = generated ?? chartName(formatters, messages.chartName, type, xLabel, yLabel);
    if (!caption.trim()) caption = messages.plotLabel?.trim() ? messages.plotLabel : defaultMessages.plotLabel;
    if (hasReferences) {
      references = referenceText(view, formatters, messages);
      for (const reference of references) caption += ' ' + reference;
    }
    table = makeTable(parts, input, caption, {
      category, value, percentage: custom?.percentage ?? messages.percentage,
      series: custom?.series ?? messages.series, xUnit: custom?.xUnit,
    });
  }
  const hasTable = table !== null;
  const omitted = disclosure?.omitted ?? 0;
  const changed = disclosure?.changed ?? 0;
  const hidden = input.labelsHidden ?? 0;
  let noteSegments: TextRun[] | null = null;
  let omission = '';
  if (omitted > 0 || changed > 0) {
    const omittedText = formatters.count(omitted), changedText = formatters.count(changed);
    const counts = { omitted: omittedText, changed: changedText, count: omittedText };
    if (omitted > 0) noteSegments = tableSentence(messages, 'valuesNotShown', counts, hasTable);
    if (changed > 0) {
      counts.count = changedText;
      const sentence = tableSentence(messages, 'valuesChanged', counts, hasTable);
      if (noteSegments) appendSentence(noteSegments, sentence);
      else noteSegments = sentence;
    }
    omission = textOf(noteSegments!);
  }
  let note = omission || null;
  if (hidden > 0) {
    const sentence = tableSentence(messages, 'labelsHidden', { count: formatters.count(hidden) }, hasTable);
    if (noteSegments) appendSentence(noteSegments, sentence);
    else noteSegments = sentence;
    note = textOf(noteSegments) || null;
  }
  return new Reader(name, note, table, note ? noteSegments : null, {
    parts, input, type, xLabel, yLabel, listReady, compact, hasReferences, references, omission,
  });
}
