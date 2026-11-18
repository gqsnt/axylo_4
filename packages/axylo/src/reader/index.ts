import { SLOT_VALUE, type DiagnosticSink, type Formatters, type IndexRange, type ReaderModel, type View } from '../core/contracts';
import { report } from '../diagnostics';
import { sliceText } from '../lookup/text';
import { defaultMessages, fill, fillChartSummary, fillDonutSlice } from '../messages';
import type { Messages, Title } from '../public';
import { buildTable, type ReaderLabels } from './table';

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

const TYPE_MESSAGE = {
  line: 'typeLine', area: 'typeArea', bar: 'typeBar', scatter: 'typeScatter', donut: 'typeDonut',
} as const;

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

function chartText(input: ReaderInput, type: string, xLabel: string, yLabel: string): string[] {
  const { view, formatters, messages } = input;
  if (view.kind === 'donut') {
    const drawn = view.slices.filter(slice => slice.angles && slice.angles[1] > slice.angles[0]);
    if (!drawn.length) return [messages.empty];
    return [
      fill(messages.donutSummary, { type, count: formatters.count(drawn.length), total: formatters.value(0, view.total) }),
      ...drawn.map(slice => {
        const { label, value, percent } = sliceText(view, slice, formatters);
        return fillDonutSlice(label, value, percent ?? '');
      }),
    ];
  }

  let xMin = Infinity;
  let xMax = -Infinity;
  let min = Infinity;
  let max = -Infinity;
  let minSeries = 0;
  let maxSeries = 0;
  let seriesCount = 0;
  const entries: string[] = [];
  const undrawn: string[] = [];
  const { frame } = view;
  const zone = view.kind === 'scatter'
    ? view.frame.xKind === 'time' && view.frame.timeZone
    : view.frame.x.kind === 'time' && view.frame.x.timeZone;

  if (view.kind !== 'scatter') {
    const { start, end } = view.visibleSlots;
    if (start < end) {
      xMin = view.frame.x.values[start]!;
      xMax = view.frame.x.values[end - 1]!;
    }
  }
  frame.series.forEach((series, s) => {
    if (!series.drawable) {
      undrawn.push(fill(messages.seriesNotDrawn, { series: series.label }));
      return;
    }
    if (!view.visible[s]) return;
    const range = view.kind === 'scatter' ? view.visiblePoints[s]! : view.visibleSlots;
    if (range.start < range.end && 'x' in series) {
      xMin = Math.min(xMin, series.x[range.start]!);
      xMax = Math.max(xMax, series.x[range.end - 1]!);
    }
    const stats = statistics(series.y, range, 'slot' in series ? series.slot : undefined);
    if (stats.min < min) { min = stats.min; minSeries = s; }
    if (stats.max > max) { max = stats.max; maxSeries = s; }
    seriesCount++;
    entries.push(Number.isFinite(stats.last) ? fill(messages.seriesSummary, {
      series: series.label, min: formatters.value(s, stats.min),
      max: formatters.value(s, stats.max), last: formatters.value(s, stats.last),
    }) : fill(messages.seriesNoData, { series: series.label }));
  });

  const zoneText = zone ? [fill(messages.timeZoneNote, { zone })] : [];
  if (!seriesCount || !Number.isFinite(xMin) || !Number.isFinite(xMax)) return [...undrawn, messages.empty, ...zoneText];
  const range = Number.isFinite(min) && Number.isFinite(max)
    ? { yMin: formatters.value(minSeries, min), yMax: formatters.value(maxSeries, max) } : null;
  return [
    fillChartSummary(messages.chartSummary, {
      type, seriesCount: formatters.count(seriesCount), xLabel, xMin: formatters.x(xMin), xMax: formatters.x(xMax), yLabel,
    }, range),
    ...zoneText, ...entries, ...undrawn,
  ];
}

function referenceText(view: View, formatters: Formatters, messages: Messages): string[] {
  if (view.kind === 'donut') return [];
  return view.references.map(({ axis, from, to, label }) => {
    const write = axis === 'x' ? (x: number) => formatters.x(x) : (y: number) => formatters.value(0, y);
    const values = { label, axis, from: write(from) };
    return from === to ? fill(messages.referenceLine, values) : fill(messages.referenceBand, { ...values, to: write(to) });
  });
}

export function buildReader(input: ReaderInput): ReaderModel {
  const { view, title, labelledBy, subtitle, description, formatters, messages, disclosure } = input;
  const labels = {
    category: input.labels?.category ?? messages.category,
    percentage: input.labels?.percentage ?? messages.percentage,
    series: input.labels?.series ?? messages.series,
    value: input.labels?.value ?? messages.value,
  };
  const type = messages[TYPE_MESSAGE[view.kind]];
  const xLabel = view.kind === 'donut' ? labels.category : view.frame.xLabel;
  const yLabel = view.kind === 'donut' ? view.frame.valueLabel
    : view.kind === 'scatter' ? view.frame.yLabel : view.frame.yLabel || view.frame.series[0]?.field || labels.value;
  const titleText = typeof title === 'string' ? title : title?.text;
  if (!labelledBy && !titleText && input.diagnostics) report(input.diagnostics, 'AX140', 'none');
  const generated = fill(messages.chartName, { type, x: xLabel, y: yLabel });
  const name = labelledBy ? '' : titleText || generated;
  const omitted = disclosure?.omitted ?? 0;
  const changed = disclosure?.changed ?? 0;
  const statements: string[] = [];
  if (omitted > 0 || changed > 0) {
    const counts = { omitted: formatters.count(omitted), changed: formatters.count(changed) };
    if (omitted > 0) statements.push(fill(messages.valuesNotShown, { ...counts, count: counts.omitted }));
    if (changed > 0) statements.push(fill(messages.valuesChanged, { ...counts, count: counts.changed }));
  }
  const omission = statements.join(' ');
  const hidden = input.labelsHidden ?? 0;
  const note = [omission, hidden > 0 ? fill(messages.labelsHidden, { count: formatters.count(hidden) }) : ''].filter(Boolean).join(' ') || null;
  const compact = input.compact === true || (view.kind !== 'donut' && view.compact);
  let references: string[] | undefined;
  const referencesForView = () => references ??= referenceText(view, formatters, messages);
  let summary: string | undefined;
  const caption = [input.caption, name, generated, messages.plotLabel].find(text => text?.trim()) ?? defaultMessages.plotLabel;
  return {
    name, note,
    get summary() {
      // Opening the table should not scan the rest of the frame.
      return summary ??= [...chartText(input, type, xLabel, yLabel), ...referencesForView(), subtitle, omission, description].filter(Boolean).join(' ');
    },
    table: input.table === false || compact ? null : buildTable(
      view, [caption, ...referencesForView()].join(' '), formatters, messages, labels, input.locale,
    ),
  };
}
