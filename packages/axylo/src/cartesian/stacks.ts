/**
 * Stacks of `axylo/cartesian` (spec F10). A Cartesian chart can hold several independent stacks: the stacked
 * bars of one axis and the stacked areas of one axis each accumulate on their own, because they are drawn in
 * different lanes or layers. Each is a core `StackView`: positive and negative values accumulate on their own
 * sides of zero, and a component with no value (null, absent step, or no row at that x) adds zero height and
 * marks the slot incomplete.
 *
 * Only visible, drawable components take part, as in the core stack: hiding a component changes the totals the
 * reader sees, and a hidden component is not a missing one.
 */
import { SLOT_NULL, SLOT_VALUE, type AlignedView, type Formatters, type StackView } from '../core/contracts';
import type { Messages } from '../public';
import { seriesSlots } from '../data/store-statistics';
import { fill } from '../messages';
import { incomplete } from '../lookup/text';
import type { CartesianMeta } from './meta';

export interface CartesianStack extends StackView {
  readonly mark: 'bar' | 'area';
  readonly axisIndex: number;
}

export interface CartesianStacks {
  readonly groups: readonly CartesianStack[];
  /** 1 where a visible component of any stack has no value; null when every stack is complete. */
  readonly incomplete: Uint8Array | null;
  /** The stack of each frame series: an index into `groups`, or -1. */
  readonly groupOf: Int32Array;
}

interface Building {
  readonly mark: 'bar' | 'area';
  readonly axisIndex: number;
  readonly order: number[];
  readonly positive: Float64Array[];
  readonly negative: Float64Array[];
  incomplete: Uint8Array | null;
}


// A published view is immutable, and its stacks depend only on it and the layer specs.
let cache: WeakMap<AlignedView, readonly [CartesianMeta, CartesianStacks]> | undefined;

export function cartesianStacks(view: AlignedView, meta: CartesianMeta): CartesianStacks {
  const hit = cache?.get(view);
  if (hit && hit[0] === meta) return hit[1];
  const { frame } = view;
  const n = frame.length;
  const groups: Building[] = [];
  const groupOf = new Int32Array(frame.series.length).fill(-1);
  let flags: Uint8Array | null = null;
  frame.series.forEach((series, s) => {
    const spec = meta.seriesByField.get(series.field);
    if (!view.visible[s] || !series.drawable || !spec?.stacked || (spec.mark !== 'bar' && spec.mark !== 'area')) return;
    const axisIndex = series.axisIndex ?? 0;
    let g = groups.findIndex(group => group.mark === spec.mark && group.axisIndex === axisIndex);
    if (g < 0) g = groups.push({ mark: spec.mark, axisIndex, order: [], positive: [], negative: [], incomplete: null }) - 1;
    const group = groups[g]!;
    groupOf[s] = g;
    const before = group.order.length - 1;
    const prevPositive = group.positive[before];
    const prevNegative = group.negative[before];
    const positive = new Float64Array(n);
    const negative = new Float64Array(n);
    const states = seriesSlots(series);
    for (let i = 0; i < n; i++) {
      let above = prevPositive ? prevPositive[i]! : 0;
      let below = prevNegative ? prevNegative[i]! : 0;
      const value = series.y[i]!;
      if (!states || states[i] === SLOT_VALUE) {
        // Zero belongs to the positive side, as in the core stack and the bar geometry.
        if (value >= 0) above += value;
        else below += value;
      } else {
        (group.incomplete ??= new Uint8Array(n))[i] = 1;
        (flags ??= new Uint8Array(n))[i] = 1;
      }
      positive[i] = above;
      negative[i] = below;
    }
    group.order.push(s);
    group.positive.push(positive);
    group.negative.push(negative);
  });
  const stacks: CartesianStacks = { groups, incomplete: flags, groupOf };
  (cache ??= new WeakMap()).set(view, [meta, stacks]);
  return stacks;
}

/**
 * The value at which slot `i` of frame series `s` is drawn: inside a stack, its cumulative boundary on the side
 * of its own value (the band edge the scene draws); otherwise its own value. Focus anchors and hover dots are
 * placed here; readouts keep the raw value.
 */
export function drawnValue(view: AlignedView, stacks: CartesianStacks, s: number, i: number): number {
  const value = view.frame.series[s]!.y[i]!;
  const group = stacks.groups[stacks.groupOf[s]!];
  return group ? (value < 0 ? group.negative : group.positive)[group.order.indexOf(s)]![i]! : value;
}

/**
 * The tooltip total at slot `i`, worded as the core lookup words it: the sum, or the positive and the negative
 * total when signs are mixed (the two ends the reader sees, not their net), or "no data" where every component
 * is missing; marked incomplete wherever a component is missing. With several stacks (bars and areas, or two axes) the totals follow in layer order, '; '-separated.
 */
export function stackTotalText(
  view: AlignedView, stacks: CartesianStacks, i: number, formatters: Formatters, messages: Messages,
): string | null {
  const { groups } = stacks;
  if (!groups.length) return null;
  return groups.map(group => {
    // The last cumulative arrays already hold the stack's two ends at slot i.
    const top = group.order.length - 1;
    const positive = group.positive[top]![i]!;
    const negative = group.negative[top]![i]!;
    const hasValue = group.order.some(s => (seriesSlots(view.frame.series[s]!)?.[i] ?? SLOT_VALUE) === SLOT_VALUE);
    const first = group.order[0]!;
    let total = !hasValue ? formatters.missing(SLOT_NULL)
      : positive > 0 && negative < 0
        ? fill(messages.totalMixed, { positive: formatters.value(first, positive), negative: formatters.value(first, negative) })
        : formatters.value(first, positive + negative);
    // Unlike the core lookup, an all-missing slot is qualified too: F10 marks every stack with a missing component
    // incomplete in the tooltip, and the table, keyboard and summary already say so for this slot.
    if (group.incomplete?.[i]) total = incomplete(total, messages);
    return total;
  }).join('; ');
}
