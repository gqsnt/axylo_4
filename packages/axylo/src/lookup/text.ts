import { SLOT_NULL, SLOT_VALUE, type DonutView, type DonutSlice, type Formatters, type SlotState } from '../core/contracts';
import { defaultReadoutNumber } from '../format';
import type { Messages } from '../public';
import { fill } from '../messages';

export function slotText(formatters: Formatters, series: number, value: number, state: SlotState): string {
  return state === SLOT_VALUE ? formatters.value(series, value) : formatters.missing(state);
}

export function incomplete(text: string, messages: Messages): string {
  return `${text} (${fill(messages.incompleteStack, {})})`;
}

export function sliceText(view: DonutView, slice: DonutSlice, formatters: Formatters, locale: string) {
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
    percent: state === SLOT_VALUE ? donutPercent(value, view.total, locale) : null,
    state,
    row: single ? frame.row?.[member] ?? member : -1,
  };
}

export function donutPercent(value: number, total: number, locale: string): string {
  return defaultReadoutNumber(total > 0 ? value / total : 0, locale, 'ratio');
}
