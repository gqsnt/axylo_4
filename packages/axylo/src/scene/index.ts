import type {
  AreaMark, BandMark, DonutView, Layout, Mark, Paint, PathMark, PointMark, Projection, Rect, RuleMark, Scene, View,
} from '../core/contracts';
import { addArea, addStackedAreas } from './areas';
import { barMarks } from './bars';
import { position, projectReference, rule, seriesPaint, token } from './geometry';
import { addLine, drawing, scatterPoints } from './lines';

type Plot = Extract<Layout, { kind: 'plot' }>;
type Cartesian = Exclude<Projection, { kind: 'ring' }>;

const TICK_LENGTH = 4;
const REFERENCE_DASH = [4, 3] as const;

function axes(projection: Cartesian) {
  return projection.kind === 'bands'
    ? { x: projection.band, y: projection.value, horizontal: projection.horizontal }
    : { x: projection.x, y: projection.y, horizontal: false };
}

function gridAndAxes(layout: Plot, projection: Cartesian): { grid: RuleMark[]; edges: RuleMark[] } {
  const { x, y, horizontal } = axes(projection);
  const { x: left, y: top, width, height } = layout.plot;
  const right = left + width;
  const bottom = top + height;
  const axis = token('axis');
  const gridPaint = token('grid');
  const grid: RuleMark[] = [];
  const edges = [rule('axis', axis, left, bottom, right, bottom), rule('axis', axis, left, top, left, bottom)];
  const bottomScale = horizontal ? y : x;
  const leftScale = horizontal ? x : y;
  for (const tick of horizontal ? layout.yTicks : layout.xTicks) {
    const pixel = position(bottomScale, tick.value);
    if (pixel < left || pixel > right) continue;
    edges.push(rule('tick', axis, pixel, bottom, pixel, bottom + TICK_LENGTH));
  }
  for (const tick of horizontal ? layout.xTicks : layout.yTicks) {
    const pixel = position(leftScale, tick.value);
    if (pixel < top || pixel > bottom) continue;
    edges.push(rule('tick', axis, left - TICK_LENGTH, pixel, left, pixel));
  }
  for (const tick of layout.yTicks) {
    const pixel = position(y, tick.value);
    if (horizontal && pixel >= left && pixel <= right) grid.push(rule('grid', gridPaint, pixel, top, pixel, bottom));
    if (!horizontal && pixel >= top && pixel <= bottom) grid.push(rule('grid', gridPaint, left, pixel, right, pixel));
  }
  return { grid, edges };
}

function references(view: Exclude<View, DonutView>, projection: Cartesian, plot: Rect): {
  bands: BandMark[]; lines: RuleMark[];
} {
  const bands: BandMark[] = [];
  const lines: RuleMark[] = [];
  const paint = token('reference');
  for (const reference of view.references) {
    const projected = projectReference(reference, projection, plot, view.xDomain);
    if (!projected) continue;
    const { vertical, low, high } = projected;
    if (low === high) {
      const line = vertical ? rule('reference', paint, low, plot.y, low, plot.y + plot.height)
        : rule('reference', paint, plot.x, low, plot.x + plot.width, low);
      lines.push({ ...line, strokeWidth: 1.5, dash: REFERENCE_DASH });
    } else {
      const box = vertical ? { ...plot, x: low, width: high - low } : { ...plot, y: low, height: high - low };
      bands.push({ type: 'band', box, fill: paint, opacity: 0.12 });
    }
  }
  return { bands, lines };
}

function arcMarks(view: DonutView, projection: Extract<Projection, { kind: 'ring' }>): Mark[] {
  const angles: number[] = [];
  const fills: Paint[] = [];
  for (const slice of view.slices) {
    if (slice.angles === null) continue;
    angles.push(...slice.angles);
    fills.push(slice.colorIndex === null ? token('muted') : seriesPaint(slice.colorIndex));
  }
  if (!angles.length) return [];
  const { cx, cy, r0, r1 } = projection;
  return [{ type: 'arcs', cx, cy, r0, r1, angles: Float32Array.from(angles), fills, gap: 1 }];
}

export function buildScene(view: View, layout: Layout, devicePixelRatio: number): Scene {
  const { width, height } = layout;
  if (layout.kind !== 'plot' && layout.kind !== 'compact') {
    return { width, height, clip: { x: 0, y: 0, width, height }, marks: [] };
  }
  const { plot: clip, projection } = layout;
  if (projection.kind === 'ring' || view.kind === 'donut') {
    const marks = projection.kind === 'ring' && view.kind === 'donut' ? arcMarks(view, projection) : [];
    return { width, height, clip, marks };
  }

  const compact = layout.kind === 'compact' || view.compact;
  const { grid, edges } = layout.kind === 'plot' && !compact ? gridAndAxes(layout, projection) : { grid: [], edges: [] };
  const { bands, lines } = compact ? { bands: [], lines: [] } : references(view, projection, clip);
  const layers: (readonly Mark[])[] = [bands, grid];
  if (view.kind === 'bar' && projection.kind === 'bands') {
    layers.push(barMarks(view, projection, clip));
  } else if (view.kind === 'scatter' && projection.kind === 'xy') {
    layers.push(scatterPoints(view, projection));
  } else if ((view.kind === 'line' || view.kind === 'area') && projection.kind === 'xy') {
    const areas: AreaMark[] = [];
    const seams: PathMark[] = [];
    const paths: PathMark[] = [];
    const points: PointMark[] = [];
    const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
    const draw = drawing(view.frame.x.values, projection, clip, dpr);
    if (view.kind === 'area' && view.stack) {
      addStackedAreas(draw, view, view.stack, compact, areas, seams, paths, points);
    } else {
      for (let i = 0; i < view.frame.series.length; i++) {
        if (!view.visible[i]) continue;
        const { slot, y } = view.frame.series[i]!;
        const input = { ...draw, range: view.drawSlots[i]!, slot, y };
        if (view.kind === 'area') addArea(input, view, i, compact, areas, paths, points);
        else addLine(input, view, i, view.visibleSlots, compact, paths, points);
      }
    }
    layers.push(areas, seams, paths, points);
  }
  layers.push(edges, lines);
  return { width, height, clip, marks: layers.flat() };
}
