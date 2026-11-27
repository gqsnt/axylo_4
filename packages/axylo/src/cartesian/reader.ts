/**
 * Reader & table parts for `axylo/cartesian` (C4.3, RFC §2.2 & §5.2).
 * - Formats y-reference lines/bands using the bound axis's own formatter & unit (defaulting omitted
 *   `axisId` explicitly to the `'left'` axis, even when that axis currently has zero series).
 * - Preserves exact raw values in the data table, appending `" (not plotted — log)"` on nonpositive log rows.
 * - Marks incomplete stacks (spec F10) with the core wording: in the table by handing the core table a view whose
 *   `stack` carries the union of the Cartesian stacks' incomplete slots, and in the summary with the core's
 *   "incomplete at" sentence over the visible window. The published view keeps no stack: the core value-extent
 *   helpers would read it as the only data of the chart.
 */
import { SLOT_VALUE, type AlignedView, type Formatters, type ResolvedReference, type TableModel, type View } from '../core/contracts';
import type { Messages } from '../public';
import { fill } from '../messages';
import { alignedReader, type ReaderParts } from '../reader';
import { alignedTable, withUnit, type ReaderLabels } from '../reader/table';
import { annotationSummarySentences } from './annotations';
import { formatAxisValue, type CartesianStateRef } from './meta';
import { cartesianStacks } from './stacks';

// A 'line' composition (cartesian.ts) builds aligned views only.
function cartesianTable(
  stateRef: CartesianStateRef,
  view: AlignedView,
  caption: string,
  formatters: Formatters,
  messages: Messages,
  labels: ReaderLabels,
  locale: string | undefined,
): TableModel {
  const { meta } = stateRef;
  // The core table reads only `incomplete` of a stack.
  const { incomplete } = cartesianStacks(view, meta);
  const base = alignedTable(incomplete ? { ...view, stack: { order: [], positive: [], negative: [], incomplete } } : view,
    caption, formatters, messages, labels, locale);
  const logSeries = view.frame.series.map(s => (s.axisId ? meta.axisById.get(s.axisId)?.scale === 'log' : false));
  if (!logSeries.some(Boolean)) return base;

  const { start } = view.visibleSlots;
  return {
    caption: base.caption,
    headers: base.headers,
    rowCount: base.rowCount,
    pageSize: base.pageSize,
    pageForX: x => base.pageForX(x),
    row(index: number): readonly string[] | null {
      const cells = base.row(index);
      if (!cells) return null;
      const slotIndex = start + index;
      let changed = false;
      const out = cells.slice();
      for (let s = 0; s < view.frame.series.length; s++) {
        if (!logSeries[s]) continue;
        const series = view.frame.series[s]!;
        if (series.slot[slotIndex] === SLOT_VALUE && !(series.y[slotIndex]! > 0)) {
          out[s + 1] = `${out[s + 1]} (not plotted — log)`;
          changed = true;
        }
      }
      return changed ? out : cells;
    },
  };
}

export function createCartesianReader(stateRef: CartesianStateRef): ReaderParts {
  return {
    table: (view, caption, formatters, messages, labels, locale) =>
      cartesianTable(stateRef, view as AlignedView, caption, formatters, messages, labels, locale),
    tableRowCount: alignedReader.tableRowCount,
    stateKey: () => {
      const { meta } = stateRef;
      const collapse = meta.collapsedRightAxis === true ? '1' : '0';
      if (!meta.annotations.length) return collapse;
      return `${collapse}|${JSON.stringify(meta.annotations)}`;
    },
    text(input, type, xLabel, yLabel, table, listReady) {
      const sentences = [...alignedReader.text(input, type, xLabel, yLabel, table, listReady)];
      const { meta } = stateRef;
      const { view, formatters, messages } = input;
      // Spec F10 asks for "incomplete" in announcements too. The core says it only for compact charts and reads
      // `view.stack`, which a Cartesian view does not carry, so the sentence (core wording, at most three
      // positions) is made here from the visible window of the Cartesian stacks.
      // A 'line' composition (cartesian.ts) builds aligned views only.
      const flags = cartesianStacks(view as AlignedView, meta).incomplete;
      if (flags) {
        const { frame, visibleSlots: { start, end } } = view as AlignedView;
        const positions: string[] = [];
        let count = 0;
        for (let i = start; i < end; i++) if (flags[i] && count++ < 3) positions.push(formatters.x(frame.x.values[i]!));
        if (count) {
          sentences.push(count > 3
            ? fill(messages.incompleteCount, { label: frame.xLabel, count: formatters.count(count) })
            : fill(messages.incompleteAt, { label: frame.xLabel, positions: positions.join(', ') }));
        }
      }
      if (meta.collapsedRightAxis && meta.axes[1]) {
        const right = meta.axes[1];
        sentences.push(`Secondary right axis (${withUnit(right.label ?? right.id, right.unit)}) values are plotted on their own scale.`);
      }
      if (meta.annotations.length > 0) {
        const fmtX = (x: unknown) => {
          if (typeof x === 'number') return input.formatters.x(x);
          if (x instanceof Date) return input.formatters.x(x.getTime());
          return String(x);
        };
        sentences.push(...annotationSummarySentences(meta, fmtX, input.locale ?? 'en-US'));
      }
      return sentences;
    },
    ref(ref: ResolvedReference, value: number, formatters: Formatters, locale: string | undefined): string {
      if (ref.axis !== 'y') return formatters.x(value);
      const { meta } = stateRef;
      const axis = meta.axisById.get(ref.axisId ?? meta.leftAxisId) ?? meta.axes[0];
      if (!axis) return formatters.value(0, value);
      return formatAxisValue(axis, value, locale ?? 'en-US');
    },
  };
}
