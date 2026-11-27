/**
 * The bubble table (spec A4): the scatter table's rows (every point in the current x range in x then y order,
 * then the rows with no y), plus the size of each row. A row whose size is not drawable keeps its row here (AX187
 * sends the reader to the table): a negative or infinite size is written as given, a missing one as "No data".
 */
import type { Formatters, IndexRange, ScatterView, TableModel } from '../../core/contracts';
import type { Messages, XValue } from '../../public';
import { pointOrder } from '../../lookup/point-order';
import { lowerBound, upperBound } from '../../lookup/search';
import { readPosition } from '../../reader/x';
import { withUnit, type ReaderLabels } from '../../reader/table';
import type { SizeChannel } from './geometry';
import type { BubbleMeta } from './options';
import { sizeText } from './text';

const PAGE_SIZE = 100;

/** The size cell of a source row: its raw number when it has one (drawable or not), else "No data". */
export function rowSizeText(meta: BubbleMeta, row: number, locale: string, messages: Pick<Messages, 'noData'>): string {
  const values = meta.sizes.values;
  return sizeText(meta, locale, row >= 0 && row < values.length ? values[row]! : NaN, messages);
}

export function bubbleTable(
  view: ScatterView, caption: string, formatters: Formatters, messages: Messages, labels: ReaderLabels,
  meta: BubbleMeta, _channel: SizeChannel, locale: string,
): TableModel {
  const { frame, visiblePoints, xDomain: [min, max] } = view;
  const gaps: { x: Float64Array; y: null }[] = [];
  const ranges: IndexRange[] = [];
  const sources: number[] = [];
  frame.series.forEach((series, s) => {
    const x = series.missingX;
    if (!x?.length) return;
    const start = lowerBound(x, min);
    const range = { start, end: upperBound(x, max, start) };
    if (range.start === range.end) return;
    gaps.push({ x, y: null });
    ranges.push(range);
    sources.push(s);
  });
  const order = pointOrder(gaps.length ? [...frame.series, ...gaps] : frame.series,
    gaps.length ? [...visiblePoints, ...ranges] : visiblePoints);
  const headers = [withUnit(frame.xLabel, frame.xUnit), labels.series, withUnit(frame.yLabel, frame.yUnit), withUnit(meta.label, meta.unit)];
  const rowCount = order.count;
  let next: ReturnType<typeof order.cursor> | null = null;
  let nextOrdinal = -1;
  const row = (i: number): readonly string[] | null => {
    if (i !== nextOrdinal) next = order.cursor(i);
    const at = next?.();
    nextOrdinal = i + 1;
    if (!at) return null;
    const missing = sources[at.series - frame.series.length];
    const series = frame.series[missing ?? at.series]!;
    if (missing === undefined) {
      const source = series.row ? series.row[at.index]! : at.index;
      return [formatters.x(series.x[at.index]!), series.label, formatters.value(at.series, series.y[at.index]!),
        rowSizeText(meta, source, locale, messages)];
    }
    const source = series.missingRow ? series.missingRow[at.index]! : -1;
    return [formatters.x(series.missingX![at.index]!), series.label, messages.noData, rowSizeText(meta, source, locale, messages)];
  };
  return {
    caption, headers, rowCount, pageSize: PAGE_SIZE,
    row: i => (Number.isInteger(i) && i >= 0 && i < rowCount ? row(i) : null),
    pageForX(x: XValue) {
      const position = readPosition(x, frame.xKind, frame.timeZone);
      const ordinal = Number.isFinite(position) ? order.beforeX(position) : -1;
      return ordinal >= 0 && ordinal < rowCount ? Math.floor(ordinal / PAGE_SIZE) : null;
    },
  };
}
