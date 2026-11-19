import { SLOT_VALUE } from '../core/contracts';
import type { DatumRef, DatumText, Formatters, Lookup, PickTarget, PointSeries, ScatterView } from '../core/contracts';
import { contains, pointBox, scatterPosition, type PlotLayout } from './geometry';
import { pointOrder, type PointIndex } from './point-order';
import { POINT_LIMIT, scatterGrid, type GridOptions } from './scatter-grid';
import { lowerBound, upperBound, pageDistance } from './search';

interface ScatterWork {
  locations: number;
  seriesCandidates: number;
  orderComparisons: number;
}

/**
 * A ref rebuilt by the caller is found by its x, then by its row among the points at that x. Where many points
 * share an x, a row index keeps that from walking them all. It belongs to the frame's series, not to a view:
 * kept with the series and released with it, so a zoom or pan of the same frame builds nothing again.
 */
const RUN = 32;
const rowIndexes = new WeakMap<PointSeries, Map<number, number> | null>();
function rowIndex(entry: PointSeries): Map<number, number> | null {
  let index = rowIndexes.get(entry);
  if (index !== undefined) return index;
  index = null;
  const { x, row } = entry;
  if (row) {
    let run = 1;
    let longest = 1;
    for (let i = 1; i < x.length && longest <= RUN; i++) longest = Math.max(longest, run = x[i] === x[i - 1] ? run + 1 : 1);
    if (longest > RUN) {
      index = new Map<number, number>();
      for (let i = 0; i < row.length; i++) index.set(row[i]!, i);
    }
  }
  rowIndexes.set(entry, index);
  return index;
}

export function scatterLookup(
  view: ScatterView, layout: PlotLayout | null, formatters: Formatters, work?: ScatterWork, devicePixelRatio = 1,
  gridOptions?: GridOptions,
): Lookup & {
  readonly lastPickCandidates: number; readonly lastPickCells?: number; readonly lastPickLattice: boolean; readonly lastMembersRead: number;
} {
  const trackWork = __DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__);
  const { series } = view.frame;
  const keys = new Map(series.map((entry, i) => [entry.key, i]));
  const locations = new WeakMap<DatumRef, PointIndex>();
  const ranges = view.visiblePoints.map((range, s) => view.visible[s] && series[s]!.drawable ? range : { start: 0, end: 0 });
  const order = pointOrder(series, ranges, trackWork && work ? {
    get comparisons() { return work.orderComparisons; },
    set comparisons(value) { work.orderComparisons = value; },
  } : undefined);
  const active = ranges.flatMap((range, s) => range.end > range.start ? [s] : []);
  const projection = layout?.projection.kind === 'xy' ? layout.projection : null;
  const grid = layout && projection ? scatterGrid(view, { ...layout, projection }, order.count, devicePixelRatio, gridOptions) : null;

  function ref(s: number, i: number): DatumRef {
    const entry = series[s]!;
    const datum = { kind: 'point', seriesKey: entry.key, row: entry.row?.[i] ?? i, x: entry.x[i]! } as const;
    // A pick already knows the point's position. A ref rebuilt by the caller still resolves by source row.
    locations.set(datum, { series: s, index: i });
    return datum;
  }

  const byRow = series.map(rowIndex);

  function locate(datum: DatumRef): PointIndex | null {
    if (datum.kind !== 'point') return null;
    const known = locations.get(datum);
    if (known) return known;
    const s = keys.get(datum.seriesKey);
    if (s === undefined) return null;
    const { x, row } = series[s]!;
    const rows = byRow[s];
    if (!row || rows) {
      const direct = rows ? rows.get(datum.row) : datum.row;
      if (direct === undefined || x[direct] !== datum.x) return null;
      const point = { series: s, index: direct };
      locations.set(datum, point);
      return point;
    }
    for (let i = lowerBound(x, datum.x); x[i] === datum.x; i++) {
      if (trackWork && work) work.locations++;
      if ((row?.[i] ?? i) !== datum.row) continue;
      const point = { series: s, index: i };
      locations.set(datum, point);
      return point;
    }
    return null;
  }

  function resolve(datum: DatumRef): DatumRef | null {
    if (datum.kind !== 'point') return null;
    const s = keys.get(datum.seriesKey);
    if (s === undefined) return null;
    const { start, end } = ranges[s]!;
    if (!view.visible[s]) {
      let primary: PointIndex | null = null;
      let y = Infinity;
      for (const t of active) {
        const { start, end } = ranges[t]!;
        const entry = series[t]!;
        const i = lowerBound(entry.x, datum.x, start, end);
        if (i < end && entry.x[i] === datum.x && entry.y[i]! < y) {
          primary = { series: t, index: i };
          y = entry.y[i]!;
        }
      }
      return primary ? ref(primary.series, primary.index) : null;
    }
    if (start === end) return null;
    const point = locate(datum);
    if (point && point.index >= start && point.index < end) return datum;
    const x = series[s]!.x;
    const right = upperBound(x, datum.x, start, end);
    if (right < end) return ref(s, right);
    const left = lowerBound(x, datum.x, start, end) - 1;
    return left >= start ? ref(s, left) : null;
  }

  function write(datum: DatumRef): DatumText | null {
    const at = locate(datum);
    if (!at || datum.kind !== 'point') return null;
    const { series: s, index: i } = at;
    const entry = series[s]!;
    return {
      ref: datum, seriesIndex: s, seriesLabel: entry.label, x: formatters.x(entry.x[i]!),
      value: formatters.value(s, entry.y[i]!), percent: null, state: SLOT_VALUE, row: datum.row,
    };
  }

  function nearest(from: PointIndex, s: number): DatumRef {
    const { start, end } = ranges[s]!;
    const entry = series[s]!;
    const fromX = series[from.series]!.x[from.index]!;
    const fromY = series[from.series]!.y[from.index]!;
    const x = projection?.x.map(fromX) ?? fromX;
    const y = projection?.y.map(fromY) ?? fromY;
    let nearest = start;
    let best = Infinity;

    function consider(i: number, dx: number): void {
      if (trackWork && work) work.seriesCandidates++;
      const py = projection?.y.map(entry.y[i]!) ?? entry.y[i]!;
      const distance = Math.hypot(dx, py - y);
      if (distance < best || distance === best && i < nearest) {
        nearest = i;
        best = distance;
      }
    }

    const dx = (i: number) => Math.abs((projection?.x.map(entry.x[i]!) ?? entry.x[i]!) - x);
    const flatY = projection && (projection.y.range[0] === projection.y.range[1] || projection.y.domain[0] === projection.y.domain[1]);
    // Starting at x, only runs whose horizontal distance can still win need a y search.
    let right = lowerBound(entry.x, fromX, start, end);
    let left = right - 1;
    while (left >= start || right < end) {
      const leftDistance = left >= start ? dx(left) : Infinity;
      const rightDistance = right < end ? dx(right) : Infinity;
      const distance = Math.min(leftDistance, rightDistance);
      if (distance > best) break;
      let lo: number;
      let hi: number;
      if (leftDistance <= rightDistance && left >= start) {
        hi = left + 1;
        lo = left > start && entry.x[left] === entry.x[left - 1]
          ? lowerBound(entry.x, entry.x[left]!, start, hi) : left;
        left = lo - 1;
      } else {
        lo = right;
        hi = right + 1 < end && entry.x[right] === entry.x[right + 1]
          ? upperBound(entry.x, entry.x[right]!, right, end) : right + 1;
        right = hi;
      }
      if (lo + 1 === hi || flatY) {
        consider(lo, distance);
      } else {
        const middle = lowerBound(entry.y, fromY, lo, hi);
        if (middle < hi) consider(middle, distance);
        if (middle > lo) consider(lowerBound(entry.y, entry.y[middle - 1]!, lo, middle), distance);
      }
    }
    return ref(s, nearest);
  }

  /** A datum's place in the pointer index, -1 when it is not drawn on the plot (hidden, outside the view). */
  function gridAt(datum: DatumRef | undefined): number {
    const point = datum && locate(datum);
    if (!grid || !point) return -1;
    const { start, end } = ranges[point.series]!;
    return point.index >= start && point.index < end ? grid.at(point.series, point.index) : -1;
  }

  function toRef(point: PointIndex | null): DatumRef | null {
    return point ? ref(point.series, point.index) : null;
  }

  const lookup = {
    pick(px: number, py: number): PickTarget | null {
      const picked = grid?.pick(px, py);
      return grid && picked ? {
        kind: 'point', refs: picked.hits.map(i => ref(grid.series[i]!, grid.points[i]!)), count: picked.count,
        // The contract's default when absent is the exact rule.
        ...grid.usedLattice && { rule: 'lattice' as const },
      } : null;
    },
    members(target, from, count) {
      const at = target.kind === 'point' ? gridAt(target.refs[0]) : -1;
      if (!grid || at < 0) return [];
      return grid.members(target.kind === 'point' && target.rule === 'lattice' ? 'lattice' : 'exact', at, Math.max(0, from), count)
        .map(i => ref(grid.series[i]!, grid.points[i]!));
    },
    has(target, datum) {
      const at = target.kind === 'point' ? gridAt(target.refs[0]) : -1;
      const other = gridAt(datum);
      return grid !== null && at >= 0 && other >= 0 &&
        grid.has(target.kind === 'point' && target.rule === 'lattice' ? 'lattice' : 'exact', at, other);
    },
    slot(datum) {
      return locate(datum)?.index ?? -1;
    },
    tooltip(target) {
      if (target.kind !== 'point') return { title: '', rows: [], count: 0, total: null };
      const rows = target.refs.slice(0, POINT_LIMIT).flatMap(datum => {
        const text = write(datum);
        return text ? [text] : [];
      });
      return { title: rows[0]?.x ?? '', rows, count: target.count, total: null };
    },
    primary(target) { return target.kind === 'point' ? target.refs[0] ?? null : null; },
    datum: write,
    anchor(datum) {
      const point = locate(datum);
      if (!point || !layout || !projection) return null;
      const { start, end } = ranges[point.series]!;
      if (point.index < start || point.index >= end) return null;
      const entry = series[point.series]!;
      const x = scatterPosition(projection.x, entry.x[point.index]!);
      const y = scatterPosition(projection.y, entry.y[point.index]!);
      return contains(layout.plot, x, y) ? pointBox(x, y) : null;
    },
    count: order.count,
    ordinal(datum) {
      const point = locate(datum);
      return point ? order.ordinal(point.series, point.index) : -1;
    },
    step(from, direction) {
      if (!from) return toRef(order.edge(1));
      const resolved = resolve(from);
      const point = resolved && locate(resolved);
      if (!point) return null;
      switch (direction) {
        case 'next': return toRef(order.edge(1, point));
        case 'previous': return toRef(order.edge(-1, point));
        case 'first':
        case 'last': {
          const edge = order.edge(direction === 'first' ? 1 : -1);
          return edge?.series === point.series && edge.index === point.index ? null : toRef(edge);
        }
        case 'page-next':
        case 'page-previous': {
          const ordinal = order.ordinal(point.series, point.index);
          const to = direction === 'page-next' ? Math.min(order.count - 1, ordinal + pageDistance(order.count))
            : Math.max(0, ordinal - pageDistance(order.count));
          return to === ordinal ? null : toRef(order.at(to));
        }
        case 'series-next':
        case 'series-previous': {
          const neighbor = active[active.indexOf(point.series) + (direction === 'series-next' ? 1 : -1)];
          return neighbor === undefined ? null : nearest(point, neighbor);
        }
      }
    },
    resolve,
  } satisfies Lookup;
  // The last pick's and the last `members` call's work, for tests (development and benchmark builds only).
  if (trackWork) {
    Object.defineProperties(lookup, {
      lastPickCandidates: { get: () => grid?.examined ?? 0 }, lastPickCells: { get: () => grid?.cellsExamined ?? 0 },
      lastPickLattice: { get: () => grid?.usedLattice ?? false }, lastMembersRead: { get: () => grid?.membersRead ?? 0 },
    });
  }
  return lookup as typeof lookup & {
    readonly lastPickCandidates: number; readonly lastPickCells?: number; readonly lastPickLattice: boolean; readonly lastMembersRead: number;
  };
}
