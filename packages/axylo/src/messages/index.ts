import type { DatumRef, Formatters, Lookup } from '../core/contracts';
import type { Messages } from '../public';

const chartSummary = '{type} chart with {seriesCount} series. {xLabel} from {xMin} to {xMax}.';
const fullChartSummary = chartSummary + ' {yLabel} from {yMin} to {yMax}.';
const donutSlice = '{label}: {value} ({percent}).';

export const defaultMessages: Messages = {
  viewAsTable: 'View as table',
  hideTable: 'Hide table',
  noData: 'No data',
  noObservation: 'No observation',
  incompleteStack: 'incomplete',
  moreRows: '+{count} more',
  otherSlices: 'Other ({count})',
  valuesNotShown: 'Values not shown: {count}. See table.',
  valuesChanged: 'Values shown differently from the data: {count}. See table.',
  labelsHidden: 'Some labels hidden. See table.',
  loading: 'Loading chart.',
  empty: 'No data to show.',
  error: 'The chart could not be drawn.',
  internalError: 'Something went wrong while drawing the chart.',
  chartName: '{type} chart of {y} by {x}',
  chartSummary: fullChartSummary,
  seriesSummary: '{series}: minimum {min}, maximum {max}, last {last}.',
  // Deprecated. Retained for callers with an existing override.
  referenceSummary: 'Reference: {label}.',
  timeZoneNote: 'Times are shown in {zone}.',
  plotLabel: 'Chart plot',
  controlsLabel: 'Chart controls',
  pointOf: '{series}, {x}, {value}. Point {index} of {count}.',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  resetZoom: 'Reset zoom',
  pause: 'Pause',
  resume: 'Resume',
  previousPage: 'Previous page',
  nextPage: 'Next page',
  pageOf: 'Page {page} of {count}',
  jumpToX: 'Jump to {x}',
  showSeries: 'Show {series}',
  hideSeries: 'Hide {series}',
  category: 'Category',
  percentage: 'Percentage',
  series: 'Series',
  value: 'Value',
  typeLine: 'Line',
  typeArea: 'Area',
  typeBar: 'Bar',
  typeScatter: 'Scatter',
  typeDonut: 'Donut',
  donutSummary: '{type} chart with {count} slices. Total {total}.',
  seriesNoData: '{series}: no data.',
  seriesNotDrawn: '{series} could not be drawn. See table.',
  referenceLine: 'Reference line {label} at {from}.',
  referenceBand: 'Reference band {label} from {from} to {to}.',
};

export function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (placeholder: string, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : placeholder,
  );
}

export function resolveMessages(overrides?: Partial<Messages> | null): Messages {
  const messages = { ...defaultMessages };
  for (const key of Object.keys(messages) as (keyof Messages)[]) {
    messages[key] = overrides?.[key] ?? messages[key];
  }
  return messages;
}

export function fillChartSummary(
  template: string, values: Readonly<Record<string, string>>, range: { readonly yMin: string; readonly yMax: string } | null,
): string {
  if (range) return fill(template, { ...values, ...range });
  // When a translation uses the same placeholders, omit the sentence that would describe the missing range.
  const withoutRange = template === fullChartSummary ? chartSummary
    : template.match(/[^.!?。！？]+[.!?。！？]*|[.!?。！？]+/gu)?.filter(part => !/\{y(?:Min|Max)\}/.test(part)).join('').trim();
  return fill(withoutRange || chartSummary, values);
}

export function fillDonutSlice(label: string, value: string, percent: string): string {
  return fill(donutSlice, { label, value, percent });
}

export function pointOf(lookup: Lookup, ref: DatumRef, formatters: Formatters, messages: Messages): string | null {
  const ordinal = lookup.ordinal(ref);
  if (ordinal < 0) return null;
  const datum = lookup.datum(ref);
  if (!datum) return null;
  return fill(messages.pointOf, {
    series: datum.seriesLabel, x: datum.x, value: datum.value,
    index: formatters.count(ordinal + 1), count: formatters.count(lookup.count),
  });
}
