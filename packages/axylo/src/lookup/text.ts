import { SLOT_NULL, SLOT_VALUE, type AlignedFrame, type AlignedView, type DonutView, type DonutSlice, type Formatters, type SlotState } from '../core/contracts';
import { createFormatters } from '../format';
import type { Messages } from '../public';
import { defaultMessages, fill } from '../messages';

export function singleContinuousSeries(view: AlignedView) {
  const { frame, visible, stack } = view;
  const first = frame.series[0];
  return frame.series.length === 1 && visible[0] && first?.drawable && !stack?.order.length && frame.x.kind !== 'category'
    ? first : undefined;
}

export function slotLabel(frame: AlignedFrame, formatters: Formatters, i: number): string {
  const edges = frame.binEdges;
  return edges ? formatters.x(edges[i]!) + '–' + formatters.x(edges[i + 1]!) : formatters.x(frame.x.values[i]!);
}

export function slotText(formatters: Formatters, series: number, value: number, state: SlotState): string {
  return state === SLOT_VALUE ? formatters.value(series, value) : formatters.missing(state);
}

/** The idle range reads the first slot of an unstacked single-series lookup. */
export function firstSlotReading(view: AlignedView, formatters: Formatters, messages: Messages, position: string): string {
  const { frame, visibleSlots: { start } } = view;
  const series = frame.series[0]!;
  const x = slotLabel(frame, formatters, start);
  const value = slotText(formatters, 0, series.y[start]!, series.slot[start] as SlotState);
  // Preserve the heading and row calls for author formatters, even though only the heading is read here.
  slotLabel(frame, formatters, start);
  const values = fill(messages.seriesValue, { series: series.label, value });
  return fill(messages.pointAll, { x, values, position });
}

export function incomplete(text: string, messages: Messages): string {
  return `${text} (${fill(messages.incompleteStack, {})})`;
}

export function sliceText(view: DonutView, slice: DonutSlice, formatters: Formatters, _locale?: string) {
  const { frame } = view;
  const member = slice.members[0];
  const single = slice.members.length === 1 && member !== undefined;
  let state = single ? frame.slot[member] as SlotState : SLOT_NULL;
  let value = 0;
  for (const i of slice.members) {
    if (frame.slot[i] === SLOT_VALUE) {
      value += frame.values[i]!;
      state = SLOT_VALUE;
    }
  }
  return {
    label: single ? frame.labels[member]! : slice.label,
    value: slotText(formatters, 0, value, state),
    percent: state === SLOT_VALUE ? formatters.percent(
      Number.isFinite(view.total) ? donutRatio(value, view.total) : slice.ratio ?? 0,
    ) : null,
    state,
    row: single ? frame.row?.[member] ?? member : -1,
  };
}

export function donutRatio(value: number, total: number): number {
  return total > 0 ? value / total : 0;
}

/** Legacy helper for a caller that supplies a locale. Views already have Formatters. */
export function donutPercent(value: number, total: number, locale: string): string {
  const formatters = createFormatters({
    series: [], x: { field: 'x', kind: 'number', unit: null, categories: null, dateUnit: null, timeZone: null },
    messages: defaultMessages,
  }, { locale, timeZone: 'UTC' });
  return formatters.percent(donutRatio(value, total));
}
