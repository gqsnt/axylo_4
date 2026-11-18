import { SLOT_VALUE, type Formatters, type SlotState, type TableModel, type View } from '../core/contracts';
import { pointOrder, type PointIndex, type PointOrderWork } from '../lookup/point-order';
import { lowerBound } from '../lookup/search';
import { donutRatio, incomplete, slotText } from '../lookup/text';
import type { Messages } from '../public';
import { readPosition } from './x';

const PAGE_SIZE = 100;

export function withUnit(label: string, unit: string | null): string {
  return unit ? `${label} (${unit})` : label;
}

function page(ordinal: number, count: number): number | null {
  return ordinal >= 0 && ordinal < count ? Math.floor(ordinal / PAGE_SIZE) : null;
}

export interface ReaderLabels {
  readonly category: string;
  readonly percentage: string;
  readonly series: string;
  readonly value: string;
  /** Supplied with the labels because the aligned frame has no x unit. */
  readonly xUnit?: string | null;
}

export function buildTable(view: View, caption: string, formatters: Formatters, messages: Messages, labels: ReaderLabels, _locale?: string, work?: PointOrderWork): TableModel {
  if (view.kind === 'donut') {
    const { frame, total } = view;
    const rowCount = frame.labels.length;
    let weights: { max: number; total: number } | undefined;
    function writePercent(value: number): string {
      if (Number.isFinite(total)) return formatters.percent(donutRatio(value, total));
      if (!weights) {
        let max = 0;
        for (let i = 0; i < rowCount; i++) if (frame.slot[i] === SLOT_VALUE) max = Math.max(max, frame.values[i]!);
        let scaled = 0;
        for (let i = 0; i < rowCount; i++) if (frame.slot[i] === SLOT_VALUE) scaled += frame.values[i]! / max;
        weights = { max, total: scaled };
      }
      return formatters.percent(donutRatio(value / weights.max, weights.total));
    }
    return {
      caption, headers: [labels.category, withUnit(frame.valueLabel, frame.unit), labels.percentage], rowCount, pageSize: PAGE_SIZE,
      row(i) {
        if (!Number.isInteger(i) || i < 0 || i >= rowCount) return null;
        const state = frame.slot[i] as SlotState;
        const value = frame.values[i]!;
        return [frame.labels[i]!, slotText(formatters, 0, value, state), state === SLOT_VALUE && value >= 0
          ? writePercent(value) : messages.noData];
      },
      pageForX(x) { return page(readPosition(x, 'category', null, frame.labels), rowCount); },
    };
  }
  if (view.kind === 'scatter') {
    const { frame, visiblePoints } = view;
    const order = pointOrder(frame.series, visiblePoints, work);
    let next: (() => PointIndex | null) | null = null;
    let nextOrdinal = -1;
    return {
      caption, headers: [withUnit(frame.xLabel, frame.xUnit), labels.series, withUnit(frame.yLabel, frame.yUnit)],
      rowCount: order.count, pageSize: PAGE_SIZE,
      row(i) {
        if (!Number.isInteger(i) || i < 0 || i >= order.count) return null;
        if (i !== nextOrdinal) next = order.cursor(i);
        const at = next?.();
        nextOrdinal = i + 1;
        if (!at) return null;
        const series = frame.series[at.series]!;
        return [formatters.x(series.x[at.index]!), series.label, formatters.value(at.series, series.y[at.index]!)];
      },
      pageForX(x) {
        const xPos = readPosition(x, frame.xKind, frame.timeZone);
        return Number.isFinite(xPos) ? page(order.beforeX(xPos), order.count) : null;
      },
    };
  }

  const { frame, visibleSlots: { start, end }, stack } = view;
  const rowCount = end - start;
  return {
    caption, headers: [withUnit(frame.xLabel, labels.xUnit ?? null), ...frame.series.map(series => withUnit(series.label, series.unit))],
    rowCount, pageSize: PAGE_SIZE,
    row(i) {
      if (!Number.isInteger(i) || i < 0 || i >= rowCount) return null;
      const at = start + i;
      const x = formatters.x(frame.x.values[at]!);
      return [stack?.incomplete?.[at] ? incomplete(x, messages) : x,
        ...frame.series.map((series, s) => slotText(formatters, s, series.y[at]!, series.slot[at] as SlotState))];
    },
    pageForX(x) {
      const xPos = readPosition(x, frame.x.kind, frame.x.timeZone, frame.x.categories);
      return Number.isFinite(xPos) ? page(lowerBound(frame.x.values, xPos, start, end) - start, rowCount) : null;
    },
  };
}
