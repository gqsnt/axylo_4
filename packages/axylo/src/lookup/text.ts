import { SLOT_NULL, SLOT_VALUE, type AlignedFrame, type DonutView, type DonutSlice, type Formatters, type SlotState } from '../core/contracts';
import { createFormatters } from '../format';
import type { Messages } from '../public';
import { defaultMessages, fill } from '../messages';

export function slotLabel(frame: AlignedFrame, formatters: Formatters, i: number): string {
  const edges = frame.binEdges;
  return edges ? formatters.x(edges[i]!) + '–' + formatters.x(edges[i + 1]!) : formatters.x(frame.x.values[i]!);
}

export function slotText(formatters: Formatters, series: number, value: number, state: SlotState): string {
  return state === SLOT_VALUE ? formatters.value(series, value) : formatters.missing(state);
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
