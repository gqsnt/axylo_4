/**
 * Reader & table parts for `axylo/cartesian` (C4.3, RFC §2.2 & §5.2).
 * - Formats y-reference lines/bands using the bound axis's own formatter & unit (defaulting omitted
 *   `axisId` explicitly to the `'left'` axis, even when that axis currently has zero series).
 * - Preserves exact raw values in the data table, appending `" (not plotted — log)"` on nonpositive log rows.
 */
import { SLOT_VALUE, type AlignedView, type Formatters, type ResolvedReference, type TableModel, type View } from '../core/contracts';
import type { Messages } from '../public';
import { alignedReader, type ReaderParts } from '../reader';
import { alignedTable, type ReaderLabels } from '../reader/table';
import { formatAxisValue, type CartesianStateRef } from './meta';

function cartesianTable(
  stateRef: CartesianStateRef,
  view: View,
  caption: string,
  formatters: Formatters,
  messages: Messages,
  labels: ReaderLabels,
  locale: string | undefined,
): TableModel {
  const base = alignedTable(view, caption, formatters, messages, labels, locale);
  if (view.kind === 'donut' || view.kind === 'scatter') return base;
  const aligned = view as AlignedView;
  const { meta } = stateRef;
  const logSeries = aligned.frame.series.map(s => (s.axisId ? meta.axisById.get(s.axisId)?.scale === 'log' : false));
  if (!logSeries.some(Boolean)) return base;

  const { start } = aligned.visibleSlots;
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
      for (let s = 0; s < aligned.frame.series.length; s++) {
        if (!logSeries[s]) continue;
        const series = aligned.frame.series[s]!;
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
      cartesianTable(stateRef, view, caption, formatters, messages, labels, locale),
    tableRowCount: alignedReader.tableRowCount,
    text(input, type, xLabel, yLabel, table, listReady) {
      const sentences = [...alignedReader.text(input, type, xLabel, yLabel, table, listReady)];
      const { meta } = stateRef;
      if (meta.collapsedRightAxis && meta.axes[1]) {
        const right = meta.axes[1];
        const title = right.unit ? `${right.label ?? right.id} (${right.unit})` : (right.label ?? right.id);
        sentences.push(`Secondary right axis (${title}) values are plotted on their own scale.`);
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
