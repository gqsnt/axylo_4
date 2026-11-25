import type { DatumRef, Formatters, Lookup } from '../core/contracts';
import type { Messages } from '../public';

const chartSummary = '{type} chart with {seriesCount} series. {xLabel} from {xMin} to {xMax}.';
// chartSummary and the range, written out: no work at import time.
const fullChartSummary = '{type} chart with {seriesCount} series. {xLabel} from {xMin} to {xMax}. {yLabel} from {yMin} to {yMax}.';

export const CHART_TYPE_MESSAGE = {
  line: 'typeLine', area: 'typeArea', bar: 'typeBar', histogram: 'typeHistogram', scatter: 'typeScatter', donut: 'typeDonut',
} as const;

export const defaultMessages: Required<Messages> = {
  viewAsTable: 'View as table',
  hideTable: 'Hide table',
  noData: 'No data',
  noObservation: 'No observation',
  incompleteStack: 'incomplete',
  moreRows: '+{count} more',
  otherSlices: 'Other ({count})',
  valuesNotShown: 'Values not shown: {count}. {seeTable}',
  valuesChanged: 'Values shown differently from the data: {count}. {seeTable}',
  labelsHidden: 'Some labels hidden. {seeTable}',
  loading: 'Loading chart.',
  empty: 'No data to show.',
  error: 'The chart could not be drawn.',
  internalError: 'Something went wrong while drawing the chart.',
  chartName: '{type} chart of {y} by {x}',
  chartSummary: fullChartSummary,
  seriesSummary: '{series}: minimum {min}, maximum {max}, last {last}.',
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
  category: 'Category',
  percentage: 'Percentage',
  series: 'Series',
  value: 'Value',
  typeLine: 'Line',
  typeArea: 'Area',
  typeBar: 'Bar',
  typeHistogram: 'Histogram',
  typeScatter: 'Scatter',
  typeDonut: 'Donut',
  donutSummary: '{type} chart with {count} slices. Total {total}.',
  seriesNoData: '{series}: no data.',
  seriesNotDrawn: '{series} could not be drawn. {seeTable}',
  referenceLine: 'Reference line {label} at {from}.',
  referenceBand: 'Reference band {label} from {from} to {to}.',
  plotRole: '{type} chart',
  pointAll: '{x}. {values}. {position}',
  seriesValue: '{series} {value}',
  position: 'Point {index} of {count}',
  total: 'Total',
  panLeft: 'Pan left',
  panRight: 'Pan right',
  jumpNotFound: 'No row matches {x}. Example: {example}',
  plotInstructions: 'Left and right arrows move between points along x. Enter selects.',
  donutInstructions: 'Arrow keys move between slices. Enter selects.',
  seriesInstructions: 'Up and down arrows move between series.',
  zoomInstructions: 'Plus and minus zoom. Press 0 to reset. Hold Shift with left or right to pan the zoomed view.',
  selectRange: 'Select range',
  seeTable: 'See table.',
  totalMixed: '{positive} and {negative}',
  incompleteAt: '{label}: incomplete at {positions}.',
  incompleteCount: '{label}: {count} incomplete stacks.',
};

export function chartTypeName(messages: Messages, kind: keyof typeof CHART_TYPE_MESSAGE): string {
  const key = CHART_TYPE_MESSAGE[kind];
  return messages[key] ?? defaultMessages[key];
}

export function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  let open = template.indexOf('{');
  if (open < 0) return template;
  let result = '';
  let start = 0;
  while (open >= 0) {
    let end = open + 1;
    for (; end < template.length; end++) {
      const code = template.charCodeAt(end);
      if (!(code >= 48 && code <= 57 || code >= 65 && code <= 90 || code === 95 || code >= 97 && code <= 122)) break;
    }
    if (end > open + 1 && template[end] === '}') {
      const name = template.slice(open + 1, end);
      if (Object.hasOwn(values, name)) {
        result += template.slice(start, open) + String(values[name]);
        start = end + 1;
      }
    }
    // An invalid placeholder can contain another opening brace.
    open = template.indexOf('{', end);
  }
  return start === 0 ? template : result + template.slice(start);
}

const authoredMessages = new WeakMap<Messages, ReadonlySet<keyof Messages>>();

export function resolveMessages(overrides?: Partial<Messages> | null): Messages {
  const messages = { ...defaultMessages };
  if (!overrides) return messages;
  let authored: Set<keyof Messages> | undefined;
  for (const key of Object.keys(messages) as (keyof Messages)[]) {
    const value = overrides[key];
    if (value == null) continue;
    messages[key] = value;
    (authored ??= new Set()).add(key);
  }
  if (authored) authoredMessages.set(messages, authored);
  return messages;
}

export function messageLanguage(messages: Messages, key: keyof Messages): 'en' | null {
  return (messages[key] ?? defaultMessages[key]) === defaultMessages[key] && !authoredMessages.get(messages)?.has(key) ? 'en' : null;
}

export function fillChartSummary(
  template: string, values: Readonly<Record<string, string>>, range: { readonly yMin: string; readonly yMax: string } | null,
): string {
  if (range) return fill(template, { ...values, ...range });
  if (template === fullChartSummary) return fill(chartSummary, values);
  // When a translation uses the same placeholders, omit the sentence that would describe the missing range.
  const withoutRange = template.includes('{yMin}') || template.includes('{yMax}')
    ? template.match(/[^.!?。！？]+[.!?。！？]*|[.!?。！？]+/gu)?.filter(part => !/\{y(?:Min|Max)\}/.test(part)).join('').trim()
    : template.trim();
  return fill(withoutRange || chartSummary, values);
}

export function fillDonutSlice(label: string, value: string, percent: string): string {
  return `${label}: ${value} (${percent}).`;
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
