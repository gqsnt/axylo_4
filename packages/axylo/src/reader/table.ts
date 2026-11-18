import { SLOT_VALUE, type Formatters, type IndexRange, type PointSeries, type ScatterView, type SlotState, type TableModel, type View } from '../core/contracts';
import { pointOrder, type PointIndex, type PointOrderWork } from '../lookup/point-order';
import { lowerBound, upperBound } from '../lookup/search';
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

type ScatterRow = PointIndex & { readonly missing?: true };

function scatterRows(view: ScatterView, work?: PointOrderWork) {
  const { frame, visiblePoints, xDomain: [min, max] } = view;
  const points = pointOrder(frame.series, visiblePoints, work);
  const gaps: (PointSeries & { readonly series: number })[] = [];
  const ranges: IndexRange[] = [];
  frame.series.forEach((series, s) => {
    const x = series.missingX;
    if (!x?.length) return;
    const start = lowerBound(x, min);
    const end = upperBound(x, max, start);
    if (start === end) return;
    // Within the missing rows, the shared x column leaves ties in series order.
    gaps.push({ ...series, series: s, x, y: x });
    ranges.push({ start, end });
  });
  if (!gaps.length) return points;

  const missing = pointOrder(gaps, ranges, work);
  const pointX = ({ series, index }: PointIndex) => frame.series[series]!.x[index]!;

  function cursor(ordinal: number): () => ScatterRow | null {
    // Find how many points precede this row without merging the earlier pages.
    // The table keeps point order and puts missing observations after points at a tied x.
    let low = Math.max(0, ordinal - missing.count);
    let high = Math.min(ordinal, points.count);
    while (low < high) {
      const mid = low + Math.floor((high - low) / 2);
      if (mid + missing.beforeX(pointX(points.at(mid)!)) < ordinal) low = mid + 1;
      else high = mid;
    }
    const nextPoint = points.cursor(low);
    const nextGap = missing.cursor(ordinal - low);
    let point = nextPoint?.() ?? null;
    let gap = nextGap?.() ?? null;
    return () => {
      if (gap && (!point || gaps[gap.series]!.x[gap.index]! < pointX(point))) {
        const row: ScatterRow = { series: gaps[gap.series]!.series, index: gap.index, missing: true };
        gap = nextGap?.() ?? null;
        return row;
      }
      const row = point;
      point = nextPoint?.() ?? null;
      return row;
    };
  }

  return { count: points.count + missing.count, cursor, beforeX: (x: number) => points.beforeX(x) + missing.beforeX(x) };
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
    const { frame } = view;
    const order = scatterRows(view, work);
    let next: (() => ScatterRow | null) | null = null;
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
        if (at.missing) return [formatters.x(series.missingX![at.index]!), series.label, messages.noData];
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
