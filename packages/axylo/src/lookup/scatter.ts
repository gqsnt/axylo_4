import { SLOT_VALUE } from '../core/contracts';
import type { DatumRef, DatumText, Formatters, Lookup, PointSeries, ScatterView } from '../core/contracts';
import { contains, pointBox, type PlotLayout } from './geometry';
import { pointOrder, type PointIndex } from './point-order';
import { POINT_LIMIT, scatterGrid } from './scatter-grid';
import { lowerBound, pageDistance } from './search';

function indexByRow(series: PointSeries): (row: number) => number {
  const rows = series.row;
  if (!rows) return row => Number.isInteger(row) && row >= 0 && row < series.x.length ? row : -1;
  let sorted = true;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]! < rows[i - 1]!) { sorted = false; break; }
  }
  if (sorted) return row => {
    const i = lowerBound(rows, row);
    return rows[i] === row ? i : -1;
  };
  // Keep the caller's columns borrowed. Only the permutation needs space when source row order changed.
  const order = new Uint32Array(rows.length);
  for (let i = 0; i < order.length; i++) order[i] = i;
  order.sort((a, b) => rows[a]! - rows[b]!);
  return row => {
    let start = 0;
    let end = order.length;
    while (start < end) {
      const mid = start + Math.floor((end - start) / 2);
      if (rows[order[mid]!]! < row) start = mid + 1;
      else end = mid;
    }
    const i = order[start];
    return i !== undefined && rows[i] === row ? i : -1;
  };
}

export function scatterLookup(view: ScatterView, layout: PlotLayout | null, formatters: Formatters): Lookup & { readonly lastPickCandidates: number } {
  const { series } = view.frame;
  const keys = new Map(series.map((entry, i) => [entry.key, i]));
  const rowIndexes = new Map<number, (row: number) => number>();
  const locations = new WeakMap<DatumRef, PointIndex>();
  const ranges = view.visiblePoints.map((range, s) => view.visible[s] && series[s]!.drawable ? range : { start: 0, end: 0 });
  const order = pointOrder(series, ranges);
  const active = ranges.flatMap((range, s) => range.end > range.start ? [s] : []);
  const projection = layout?.projection.kind === 'xy' ? layout.projection : null;
  const grid = layout && projection ? scatterGrid(view, { ...layout, projection }, order.count) : null;

  function ref(s: number, i: number): DatumRef {
    const entry = series[s]!;
    const datum = { kind: 'point', seriesKey: entry.key, row: entry.row?.[i] ?? i, x: entry.x[i]! } as const;
    // A pick already knows the point's position. A ref rebuilt by the caller still resolves by source row.
    locations.set(datum, { series: s, index: i });
    return datum;
  }

  function locate(datum: DatumRef): PointIndex | null {
    if (datum.kind !== 'point') return null;
    const known = locations.get(datum);
    if (known) return known;
    const s = keys.get(datum.seriesKey);
    if (s === undefined) return null;
    let locateRow = rowIndexes.get(s);
    if (!locateRow) {
      locateRow = indexByRow(series[s]!);
      rowIndexes.set(s, locateRow);
    }
    const index = locateRow(datum.row);
    return index < 0 ? null : { series: s, index };
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
    for (let i = start; i < end; i++) {
      const px = projection?.x.map(entry.x[i]!) ?? entry.x[i]!;
      const py = projection?.y.map(entry.y[i]!) ?? entry.y[i]!;
      const distance = Math.hypot(px - x, py - y);
      if (distance < best) { nearest = i; best = distance; }
    }
    return ref(s, nearest);
  }

  function at(ordinal: number): DatumRef | null {
    const point = order.at(ordinal);
    return point ? ref(point.series, point.index) : null;
  }

  return {
    pick(px, py) {
      const picked = grid?.pick(px, py);
      return grid && picked ? {
        kind: 'point', refs: picked.hits.map(i => ref(grid.series[i]!, grid.points[i]!)), count: picked.count,
      } : null;
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
      const x = projection.x.map(entry.x[point.index]!);
      const y = projection.y.map(entry.y[point.index]!);
      return contains(layout.plot, x, y) ? pointBox(x, y) : null;
    },
    count: order.count,
    ordinal(datum) {
      const point = locate(datum);
      return point ? order.ordinal(point.series, point.index) : -1;
    },
    step(from, direction) {
      if (!from) return at(0);
      const point = locate(from);
      if (!point) return null;
      const ordinal = order.ordinal(point.series, point.index);
      if (ordinal < 0) return null;
      switch (direction) {
        case 'next': return at(ordinal + 1);
        case 'previous': return at(ordinal - 1);
        case 'first': return at(0);
        case 'last': return at(order.count - 1);
        case 'page-next': return at(Math.min(order.count - 1, ordinal + pageDistance(order.count)));
        case 'page-previous': return at(Math.max(0, ordinal - pageDistance(order.count)));
        case 'series-next':
        case 'series-previous': {
          const neighbor = active[active.indexOf(point.series) + (direction === 'series-next' ? 1 : -1)];
          return neighbor === undefined ? null : nearest(point, neighbor);
        }
      }
    },
    resolve(datum) { return locate(datum) ? datum : null; },
    get lastPickCandidates() { return grid?.examined ?? 0; },
  };
}
