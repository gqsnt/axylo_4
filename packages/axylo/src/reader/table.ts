import { binIndex } from '../data/search';
import {
  SLOT_VALUE, type AlignedView, type DonutView, type Formatters, type IndexRange, type ScatterView, type SlotState,
  type TableModel, type View,
} from '../core/contracts';
import { pointOrder, type PointIndex, type PointOrderWork } from '../lookup/point-order';
import { lowerBound, upperBound } from '../lookup/search';
import { donutRatio, incomplete, slotLabel, slotText } from '../lookup/text';
import type { Messages, XValue } from '../public';
import { readPosition } from './x';

const PAGE_SIZE = 100;

export function withUnit(label: string, unit: string | null): string {
  return unit ? `${label} (${unit})` : label;
}

function page(ordinal: number, count: number): number | null {
  return ordinal >= 0 && ordinal < count ? Math.floor(ordinal / PAGE_SIZE) : null;
}

function paged(
  caption: string, headers: readonly string[], rowCount: number,
  row: TableModel['row'], ordinalForX: (x: XValue) => number,
): TableModel {
  return {
    caption, headers, rowCount, pageSize: PAGE_SIZE,
    row: i => Number.isInteger(i) && i >= 0 && i < rowCount ? row(i) : null,
    pageForX: x => page(ordinalForX(x), rowCount),
  };
}

export interface ReaderLabels {
  readonly category: string;
  readonly percentage: string;
  readonly series: string;
  readonly value: string;
  /** Supplied with the labels because the aligned frame has no x unit. */
  readonly xUnit?: string | null;
}

function scatterRows(view: ScatterView, work?: PointOrderWork) {
  const { frame, visiblePoints, xDomain: [min, max] } = view;
  const gaps: { x: Float64Array; y: null }[] = [];
  const ranges: IndexRange[] = [];
  const sources: number[] = [];
  frame.series.forEach((series, s) => {
    const x = series.missingX;
    if (!x?.length) return;
    const start = lowerBound(x, min);
    const end = upperBound(x, max, start);
    if (start === end) return;
    gaps.push({ x, y: null });
    ranges.push({ start, end });
    sources.push(s);
  });
  const order = pointOrder(gaps.length ? [...frame.series, ...gaps] : frame.series,
    gaps.length ? [...visiblePoints, ...ranges] : visiblePoints, work);
  return { order, sources };
}

/** A chart kind's table, in buildTable's terms (a kind's composition holds only its own). */
export type TableBuilder = (
  view: View, caption: string, formatters: Formatters, messages: Messages, labels: ReaderLabels, locale?: string, work?: PointOrderWork,
) => TableModel;

export function buildTable(view: View, caption: string, formatters: Formatters, messages: Messages, labels: ReaderLabels, locale?: string, work?: PointOrderWork): TableModel {
  const build = view.kind === 'donut' ? donutTable : view.kind === 'scatter' ? scatterTable : alignedTable;
  return build(view, caption, formatters, messages, labels, locale, work);
}

export const donutTable: TableBuilder = (view, caption, formatters, messages, labels) => {
  const { frame, total } = view as DonutView;
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
  return paged(caption, [labels.category, withUnit(frame.valueLabel, frame.unit), labels.percentage], rowCount,
    i => {
      const state = frame.slot[i] as SlotState;
      const value = frame.values[i]!;
      return [frame.labels[i]!, slotText(formatters, 0, value, state), state === SLOT_VALUE && value >= 0
        ? writePercent(value) : messages.noData];
    },
    x => readPosition(x, 'category', null, frame.labels),
  );
};

export const scatterTable: TableBuilder = (view, caption, formatters, messages, labels, _locale, work) => {
  const scatter = view as ScatterView;
  const { frame } = scatter;
  const { order, sources } = scatterRows(scatter, work);
  let next: (() => PointIndex | null) | null = null;
  let nextOrdinal = -1;
  return paged(caption, [withUnit(frame.xLabel, frame.xUnit), labels.series, withUnit(frame.yLabel, frame.yUnit)], order.count,
    i => {
      if (i !== nextOrdinal) next = order.cursor(i);
      const at = next?.();
      nextOrdinal = i + 1;
      if (!at) return null;
      const missing = sources[at.series - frame.series.length];
      const series = frame.series[missing ?? at.series]!;
      const xs = missing === undefined ? series.x : series.missingX!;
      return [formatters.x(xs[at.index]!), series.label,
        missing === undefined ? formatters.value(at.series, series.y[at.index]!) : messages.noData];
    },
    x => {
      const position = readPosition(x, frame.xKind, frame.timeZone);
      return Number.isFinite(position) ? order.beforeX(position) : -1;
    },
  );
};

export const alignedTable: TableBuilder = (view, caption, formatters, messages, labels) => {
  const { frame, visibleSlots: { start, end }, stack } = view as AlignedView;
  const { series } = frame;
  const headers = [withUnit(frame.xLabel, labels.xUnit ?? null)];
  for (const entry of series) headers.push(withUnit(entry.label, entry.unit));
  return paged(caption, headers, end - start,
    i => {
      const at = start + i;
      const x = slotLabel(frame, formatters, at);
      const row = [stack?.incomplete?.[at] ? incomplete(x, messages) : x];
      for (let s = 0; s < series.length; s++) {
        const entry = series[s]!;
        row.push(slotText(formatters, s, entry.y[at]!, entry.slot[at] as SlotState));
      }
      return row;
    },
    x => {
      const position = readPosition(x, frame.x.kind, frame.x.timeZone, frame.x.categories);
      if (!Number.isFinite(position)) return -1;
      return (frame.binEdges ? binIndex(frame.binEdges, position) : lowerBound(frame.x.values, position, start, end)) - start;
    },
  );
};

/**
 * The smallest x among the rows the table prints whose x, as the table writes it, `matches` (the jump field's
 * last resort for text the parsers do not read): scatter points of every series in view and, inside the view,
 * the rows with no y; the slots in view on aligned charts. null when no printed row matches.
 */
export function printedX(view: View, formatters: Formatters, matches: (printed: string) => boolean): number | null {
  let found = Infinity;
  const scan = (xs: Float64Array, start: number, end: number) => {
    for (let i = start; i < end; i++) if (xs[i]! < found && matches(formatters.x(xs[i]!))) found = xs[i]!;
  };
  if (view.kind === 'scatter') {
    const [min, max] = view.xDomain;
    view.frame.series.forEach((series, s) => {
      scan(series.x, view.visiblePoints[s]!.start, view.visiblePoints[s]!.end);
      const missing = series.missingX;
      if (missing) {
        const start = lowerBound(missing, min);
        scan(missing, start, upperBound(missing, max, start));
      }
    });
  } else if (view.kind !== 'donut') {
    for (let i = view.visibleSlots.start; i < view.visibleSlots.end; i++) {
      if (matches(slotLabel(view.frame, formatters, i))) return view.frame.x.values[i]!;
    }
  }
  return Number.isFinite(found) ? found : null;
}
