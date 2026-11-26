import type {
  AreaMark, DonutView, Layout, Mark, PathMark, PointMark, Projection, Rect, RuleMark, Scene, View,
} from '../core/contracts';
import { DONUT_GAP, donutGeometry } from '../view/donut-geometry';
import { addArea, addStackedAreas } from './areas';
import { barMarks } from './bars';
import { boundaryPixel, position, projectReference, rule, seriesPaint, token } from './geometry';
import { addLine, drawing, scatterPoints } from './lines';
import { seriesSlots } from '../data/store-statistics';

type Plot = Extract<Layout, { kind: 'plot' }>;
type Cartesian = Exclude<Projection, { kind: 'ring' }>;

const TICK_LENGTH = 4;
const REFERENCE_DASH = [4, 3] as const;

function axes(projection: Cartesian) {
  return projection.kind === 'bands'
    ? { x: projection.band, y: projection.value, horizontal: projection.horizontal }
    : { x: projection.x, y: projection.y, horizontal: false };
}

function addGrid(layout: Plot, projection: Cartesian, marks: Mark[]): RuleMark[] {
  const { x, y, horizontal } = axes(projection);
  const { x: left, y: top, width, height } = layout.plot;
  const right = left + width;
  const bottom = top + height;
  const axis = token('axis');
  const gridPaint = token('grid');
  const edges = [rule('axis', axis, left, bottom, right, bottom), rule('axis', axis, left, top, left, bottom)];
  const bottomScale = horizontal ? y : x;
  const leftScale = horizontal ? x : y;
  for (const tick of horizontal ? layout.yTicks : layout.xTicks) {
    const pixel = boundaryPixel(position(bottomScale, tick.value), left, right);
    if (pixel === null) continue;
    if (horizontal) marks.push(rule('grid', gridPaint, pixel, top, pixel, bottom));
    edges.push(rule('tick', axis, pixel, bottom, pixel, bottom + TICK_LENGTH));
  }
  for (const tick of horizontal ? layout.xTicks : layout.yTicks) {
    const pixel = boundaryPixel(position(leftScale, tick.value), top, bottom);
    if (pixel === null) continue;
    if (!horizontal) marks.push(rule('grid', gridPaint, left, pixel, right, pixel));
    edges.push(rule('tick', axis, left - TICK_LENGTH, pixel, left, pixel));
  }
  return edges;
}

function addReferenceBands(view: Exclude<View, DonutView>, projection: Cartesian, plot: Rect, marks: Mark[]): RuleMark[] {
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
      marks.push({ type: 'band', box, fill: paint, opacity: 0.12 });
    }
  }
  return lines;
}

function arcMarks(view: DonutView, projection: Extract<Projection, { kind: 'ring' }>): Mark[] {
  const { drawn, angles } = donutGeometry(view.slices, projection);
  if (!drawn.length) return [];
  const fills = drawn.map(slice => slice.colorIndex === null ? token('muted') : seriesPaint(slice.colorIndex));
  const { cx, cy, r0, r1 } = projection;
  return [{ type: 'arcs', cx, cy, r0, r1, angles, fills, gap: DONUT_GAP }];
}

/** Where the marks go: the plot or compact layout, or null for a layout with nothing drawn. */
type Drawn = Extract<Layout, { kind: 'plot' | 'compact' }>;

function emptyScene(layout: Layout): Scene {
  const { width, height } = layout;
  return { width, height, clip: { x: 0, y: 0, width, height }, marks: [] };
}

/** A chart kind's data marks, layered between the grid and the axes; empty when the projection does not fit. */
export type DataLayers = (
  view: Exclude<View, DonutView>, projection: Cartesian, clip: Rect, compact: boolean, devicePixelRatio: number,
) => readonly (readonly Mark[])[];

/** The scene of a Cartesian chart: references and grid, the kind's data layers, then axes and reference lines. */
export function cartesianScene(layers: DataLayers, view: View, layout: Layout, devicePixelRatio: number): Scene {
  if (layout.kind !== 'plot' && layout.kind !== 'compact') return emptyScene(layout);
  const { width, height } = layout;
  const { plot: clip, projection } = layout;
  if (projection.kind === 'ring' || view.kind === 'donut') return { width, height, clip, marks: [] };
  const compact = layout.kind === 'compact' || view.compact;
  const marks: Mark[] = [];
  const lines = !compact && view.references.length ? addReferenceBands(view, projection, clip, marks) : null;
  const edges = layout.kind === 'plot' && !compact ? addGrid(layout, projection, marks) : null;
  for (const layer of layers(view, projection, clip, compact, devicePixelRatio)) {
    for (const mark of layer) marks.push(mark);
  }
  if (edges) for (const edge of edges) marks.push(edge);
  if (lines) for (const line of lines) marks.push(line);
  return { width, height, clip, marks };
}

export function donutScene(view: View, layout: Layout): Scene {
  if (layout.kind !== 'plot' && layout.kind !== 'compact') return emptyScene(layout);
  const { width, height } = layout;
  const { plot: clip, projection } = layout as Drawn;
  const marks = projection.kind === 'ring' && view.kind === 'donut' ? arcMarks(view, projection) : [];
  return { width, height, clip, marks };
}

export const barLayers: DataLayers = (view, projection, clip) =>
  (view.kind === 'bar' || view.kind === 'histogram') && projection.kind === 'bands' ? [barMarks(view, projection, clip)] : [];

export const scatterLayers: DataLayers = (view, projection) =>
  view.kind === 'scatter' && projection.kind === 'xy' ? [scatterPoints(view, projection)] : [];

export const lineLayers: DataLayers = (view, projection, clip, compact, devicePixelRatio) => {
  if (view.kind !== 'line' || projection.kind !== 'xy') return [];
  const draw = drawing(view.frame.x.values, projection, clip, devicePixelRatio);
  const paths: PathMark[] = [];
  const points: PointMark[] = [];
  for (let i = 0; i < view.frame.series.length; i++) {
    if (!view.visible[i]) continue;
    const series = view.frame.series[i]!;
    // A dense series hands no state column; reading series.slot would make one of zeros.
    addLine({ ...draw, range: view.drawSlots[i]!, slot: seriesSlots(series), y: series.y }, view, i, view.visibleSlots, compact, paths, points);
  }
  return [paths, points];
};

export const areaLayers: DataLayers = (view, projection, clip, compact, devicePixelRatio) => {
  if (view.kind === 'line') return lineLayers(view, projection, clip, compact, devicePixelRatio);
  if (view.kind !== 'area' || projection.kind !== 'xy') return [];
  const draw = drawing(view.frame.x.values, projection, clip, devicePixelRatio);
  const areas: AreaMark[] = [];
  const paths: PathMark[] = [];
  const points: PointMark[] = [];
  if (view.stack) {
    const seams: PathMark[] = [];
    addStackedAreas(draw, view, view.stack, compact, areas, seams, paths, points);
    return [areas, seams, paths, points];
  }
  for (let i = 0; i < view.frame.series.length; i++) {
    if (!view.visible[i]) continue;
    const { slot, y } = view.frame.series[i]!;
    addArea({ ...draw, range: view.drawSlots[i]!, slot, y }, view, i, compact, areas, paths, points);
  }
  return [areas, paths, points];
};

// Each kind's scene, for its composition.
export const lineScene = (view: View, layout: Layout, devicePixelRatio: number): Scene => cartesianScene(lineLayers, view, layout, devicePixelRatio);
export const areaScene = (view: View, layout: Layout, devicePixelRatio: number): Scene => cartesianScene(areaLayers, view, layout, devicePixelRatio);
export const barScene = (view: View, layout: Layout, devicePixelRatio: number): Scene => cartesianScene(barLayers, view, layout, devicePixelRatio);
export const scatterScene = (view: View, layout: Layout, devicePixelRatio: number): Scene => cartesianScene(scatterLayers, view, layout, devicePixelRatio);

const allLayers: DataLayers = (view, projection, clip, compact, devicePixelRatio) =>
  (view.kind === 'bar' || view.kind === 'histogram') ? barLayers(view, projection, clip, compact, devicePixelRatio)
    : view.kind === 'scatter' ? scatterLayers(view, projection, clip, compact, devicePixelRatio)
      : view.kind === 'area' ? areaLayers(view, projection, clip, compact, devicePixelRatio)
        : lineLayers(view, projection, clip, compact, devicePixelRatio);

/** Every kind's scene, dispatched on the view (a kind's composition calls its own scene directly). */
export function buildScene(view: View, layout: Layout, devicePixelRatio: number): Scene {
  if (layout.kind === 'plot' || layout.kind === 'compact') {
    if (layout.projection.kind === 'ring' || view.kind === 'donut') return donutScene(view, layout);
  }
  return cartesianScene(allLayers, view, layout, devicePixelRatio);
}
