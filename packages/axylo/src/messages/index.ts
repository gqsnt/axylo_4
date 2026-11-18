import type { Messages } from '../public';

export const defaultMessages: Messages = {
  viewAsTable: 'View as table',
  hideTable: 'Hide table',
  noData: 'No data',
  noObservation: 'No observation',
  incompleteStack: 'incomplete',
  moreRows: '+{count} more',
  otherSlices: 'Other ({count})',
  valuesNotShown: '{count} values not shown. See table.',
  valuesChanged: 'Values changed: {count}. See table.',
  labelsHidden: 'Some labels hidden. See table.',
  loading: 'Loading chart.',
  empty: 'No data to show.',
  error: 'The chart could not be drawn.',
  internalError: 'Something went wrong while drawing the chart.',
  chartName: '{type} chart of {y} by {x}',
  chartSummary: '{type} chart with {seriesCount} series. {xLabel} from {xMin} to {xMax}. {yLabel} from {yMin} to {yMax}.',
  seriesSummary: '{series}: minimum {min}, maximum {max}, last {last}.',
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
