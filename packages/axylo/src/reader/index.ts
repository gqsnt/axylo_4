import { SLOT_VALUE, type DiagnosticSink, type Formatters, type IndexRange, type ReaderModel, type View } from '../core/contracts';
import { report } from '../diagnostics';
import { sliceText } from '../lookup/text';
import { fill } from '../messages';
import type { Messages, Title } from '../public';
import { buildTable, type ReaderLabels } from './table';

export interface ReaderInput {
  readonly view: View;
  readonly formatters: Formatters;
  readonly messages: Messages;
  readonly type: string;
  readonly title?: string | Title;
  readonly labelledBy?: string;
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

const DEFAULT_LABELS: ReaderLabels = { category: 'Category', percentage: 'Percentage', series: 'Series', value: 'Value' };

function statistics(y: Float64Array | Float32Array, { start, end }: IndexRange, slot?: Uint8Array) {
  let min = Infinity;
  let max = -Infinity;
  let last = NaN;
  for (let i = start; i < end; i++) {
    if (slot && slot[i] !== SLOT_VALUE) continue;
    last = y[i]!;
    if (last < min) min = last;
    if (last > max) max = last;
  }
  return { min, max, last };
}

function chartText(input: ReaderInput, xLabel: string, yLabel: string, locale: string): string[] {
  const { view, formatters, messages, type } = input;
  const noData = fill(messages.noData, {});
  const writeValue = (s: number, n: number) => Number.isFinite(n) ? formatters.value(s, n) : noData;
  let xMin = Infinity;
  let xMax = -Infinity;
  let min = Infinity;
  let max = -Infinity;
  let minSeries = 0;
  let maxSeries = 0;
  let seriesCount = 0;
  let zone: string | null = null;
  const entries: string[] = [];

  if (view.kind === 'donut') {
    const { frame, slices } = view;
    const stats = statistics(frame.values, { start: 0, end: frame.labels.length }, frame.slot);
    min = stats.min;
    max = stats.max;
    seriesCount = slices.length;
    for (const slice of slices) {
      const { label, value, percent } = sliceText(view, slice, formatters, locale);
      entries.push(percent === null ? `${label}: ${value}.` : `${label}: ${value} (${percent}).`);
    }
  } else {
    if (view.kind === 'scatter') {
      zone = view.frame.xKind === 'time' ? view.frame.timeZone : null;
      view.frame.series.forEach(({ x }, s) => {
        const { start, end } = view.visiblePoints[s]!;
        if (start === end) return;
        xMin = Math.min(xMin, x[start]!);
        xMax = Math.max(xMax, x[end - 1]!);
      });
    } else {
      const { frame, visibleSlots: { start, end } } = view;
      zone = frame.x.kind === 'time' ? frame.x.timeZone : null;
      if (start < end) {
        xMin = frame.x.values[start]!;
        xMax = frame.x.values[end - 1]!;
      }
    }
    view.frame.series.forEach((series, s) => {
      if (!view.visible[s] || !series.drawable) return;
      const range = view.kind === 'scatter' ? view.visiblePoints[s]! : view.visibleSlots;
      const stats = statistics(series.y, range, 'slot' in series ? series.slot : undefined);
      if (stats.min < min) { min = stats.min; minSeries = s; }
      if (stats.max > max) { max = stats.max; maxSeries = s; }
      seriesCount++;
      entries.push(fill(messages.seriesSummary, {
        series: series.label, min: writeValue(s, stats.min), max: writeValue(s, stats.max), last: writeValue(s, stats.last),
      }));
    });
  }

  const first = view.kind === 'donut' ? view.frame.labels[0] : Number.isFinite(xMin) ? formatters.x(xMin) : undefined;
  const last = view.kind === 'donut' ? view.frame.labels.at(-1) : Number.isFinite(xMax) ? formatters.x(xMax) : undefined;
  const parts = [first === undefined || last === undefined ? fill(messages.empty, {}) : fill(messages.chartSummary, {
    type, seriesCount, xLabel, xMin: first, xMax: last, yLabel, yMin: writeValue(minSeries, min), yMax: writeValue(maxSeries, max),
  })];
  if (zone) parts.push(fill(messages.timeZoneNote, { zone }));
  parts.push(...entries);
  if (view.kind !== 'donut') {
    for (const { axis, from, to, label } of view.references) {
      const write = axis === 'x' ? (x: number) => formatters.x(x) : (y: number) => formatters.value(minSeries, y);
      parts.push(fill(messages.referenceSummary, { label, axis, from: write(from), to: write(to) }));
    }
  }
  return parts;
}

export function buildReader(input: ReaderInput): ReaderModel {
  const { view, type, title, labelledBy, subtitle, description, formatters, messages, disclosure } = input;
  const labels = { ...DEFAULT_LABELS, ...input.labels };
  const xLabel = view.kind === 'donut' ? labels.category : view.frame.xLabel;
  const yLabel = view.kind === 'donut' ? view.frame.valueLabel : view.frame.yLabel ?? labels.value;
  const titleText = typeof title === 'string' ? title : title?.text;
  if (!labelledBy && !titleText && input.diagnostics) report(input.diagnostics, 'AX140', 'none');
  const name = labelledBy ? '' : titleText || fill(messages.chartName, { type, x: xLabel, y: yLabel });
  const omitted = disclosure?.omitted ?? 0;
  const changed = disclosure?.changed ?? 0;
  const omission = omitted + changed > 0 ? fill(messages.valuesNotShown, { count: omitted + changed, omitted, changed }) : '';
  const hidden = input.labelsHidden ?? 0;
  const note = [omission, hidden > 0 ? fill(messages.labelsHidden, { count: hidden }) : ''].filter(Boolean).join(' ') || null;
  const compact = input.compact === true || (view.kind !== 'donut' && view.compact);
  const locale = input.locale ?? (view.kind === 'donut' ? new Intl.NumberFormat().resolvedOptions().locale : '');
  let summary: string | undefined;
  return {
    name, note,
    get summary() {
      // The table can be opened without formatting or scanning any other row for the summary.
      return summary ??= [...chartText(input, xLabel, yLabel, locale), subtitle, omission, description].filter(Boolean).join(' ');
    },
    table: input.table === false || compact ? null : buildTable(view, name, formatters, messages, labels, locale),
  };
}
