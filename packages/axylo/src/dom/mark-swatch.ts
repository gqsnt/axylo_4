/**
 * The legend and tooltip swatch of `axylo/cartesian`, which mixes marks in one chart: each series' swatch
 * repeats the mark its layer draws (spec A5), as the scene paints it (cartesian/scene.ts):
 *
 * - line: the line with its dash and marker (the shared line swatch);
 * - bar: a filled square, without the root bar chart's pattern, which Cartesian bars do not draw;
 * - area: a translucent region under a full-colour edge that carries the series' dash;
 * - range: a translucent band, without an edge, like the band between `low` and `high`;
 * - errorBar: a whisker with its caps (when `capWidth` is not 0) and the centre marker when the layer has a visible `y`.
 *
 * A range or error bar is one mark painted in the colour of its centre field, else its `low` field, so every
 * field of the layer shows that colour. A hidden series is an outline of the same shape (spec I2).
 *
 * Only the Cartesian entry imports this module, so the root and static bundles do not carry it.
 */
import type { SeriesCue, View } from '../core/contracts';
import type { CartesianStateRef } from '../cartesian/meta';
import type { SeriesSwatch } from './interaction-types';
import { svgElement } from './attributes';
import { BACKGROUND, lineSwatch, markerPath, type SwatchShape, type SwatchSpec } from './swatch';

/** The marks' fill opacity for areas and range bands (cartesian/scene.ts). */
const TRANSLUCENT = '0.22';
const AREA_EDGE = 'M1 6L7 3L13 6L19 3';
const AREA = `${AREA_EDGE}V11H1Z`;
const BAND = 'M1 3L7 2L13 4L19 2V9L13 10L7 8L1 10Z';

function shapePath(svg: SVGSVGElement, d: string, attrs: Readonly<Record<string, string>>): SVGPathElement {
  const path = svgElement(svg.ownerDocument, 'path', { d, ...attrs });
  svg.appendChild(path);
  return path;
}

/** A fill region: translucent in the series' colour, or an outline over the background when hidden. */
function region(svg: SVGSVGElement, d: string, hollow: boolean): void {
  shapePath(svg, d, hollow
    ? { class: 'axylo-swatch-chip', fill: BACKGROUND, stroke: 'currentColor', 'stroke-width': '1.5' }
    : { class: 'axylo-swatch-chip', fill: 'currentColor', 'fill-opacity': TRANSLUCENT });
}

const dashPattern = (dash: readonly number[] | null | undefined) => dash && dash.length ? dash.map(v => Math.max(1, v / 2)).join(' ') : 'none';

const AREA_SHAPE: SwatchShape = {
  key: 'area',
  draw(svg, spec) {
    region(svg, AREA, spec.hollow);
    if (spec.hollow) return;
    // The edge is the area's stroke: 2 px with the series' dash, switched to the contrast dash by the
    // stylesheet exactly where the marks switch (the class the line swatch uses).
    const edge = shapePath(svg, AREA_EDGE, { class: 'axylo-swatch-line', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linejoin': 'round' });
    edge.style.setProperty('--axylo-swatch-dash', dashPattern(spec.cue?.dash.normal));
    edge.style.setProperty('--axylo-swatch-dash-contrast', dashPattern(spec.cue?.dash.contrast));
  },
};

const BAND_SHAPE: SwatchShape = { key: 'range', draw: (svg, spec) => region(svg, BAND, spec.hollow) };

const whiskers: Record<string, SwatchShape> = {};

/** The error bar's whisker, with caps or without, and with the centre marker of the given shape or none. */
function whiskerShape(capped: boolean, centre: SeriesCue['marker'] | null): SwatchShape {
  const key = `errorBar:${capped}:${centre ?? ''}`;
  return whiskers[key] ??= {
    key,
    draw(svg, spec) {
      const d = capped ? 'M10 1V11M6 1H14M6 11H14' : 'M10 1V11';
      const stroke = (color: string, width: string) => shapePath(svg, d, { class: 'axylo-swatch-whisker', fill: 'none', stroke: color, 'stroke-width': width });
      // Hidden: the same whisker drawn as an outline (a wide stroke with the background inside it).
      if (spec.hollow) { stroke('currentColor', '3.5'); stroke(BACKGROUND, '1.5'); } else stroke('currentColor', '1.5');
      if (centre !== null) {
        shapePath(svg, markerPath(centre, 10, 6, 6), spec.hollow
          ? { class: 'axylo-swatch-marker', fill: BACKGROUND, stroke: 'currentColor', 'stroke-width': '1.5' }
          : { class: 'axylo-swatch-marker', fill: 'currentColor', stroke: BACKGROUND, 'stroke-width': '1' });
      }
    },
  };
}

/** What a series' swatch draws: the colour index it is painted with and its shape ('line' and 'bar' use the shared ones). */
interface Drawing { readonly paint: number; readonly shape: SwatchShape | 'line' | 'bar' }

const LINE: Drawing = { paint: -1, shape: 'line' };

function drawingOf(stateRef: CartesianStateRef, index: number, view: View): Drawing {
  // Cartesian charts compose an aligned view; any other view has no layers to read.
  if (view.kind === 'donut' || view.kind === 'scatter') return LINE;
  const series = view.frame.series;
  const field = series[index]?.field;
  const meta = stateRef.meta;
  const spec = field === undefined ? undefined : meta.seriesByField.get(field);
  if (!spec || spec.mark === 'line') return LINE;
  if (spec.mark === 'bar' || spec.mark === 'area') return { paint: index, shape: spec.mark === 'bar' ? 'bar' : AREA_SHAPE };
  const interval = meta.intervals.find(iv => iv.lowField === field || iv.highField === field || iv.centerField === field);
  const at = (name: string | null | undefined) => name ? series.findIndex(s => s.field === name) : -1;
  const centre = interval ? at(interval.centerField) : -1;
  const low = interval ? at(interval.lowField) : -1;
  // The scene paints the whole interval with its centre's colour, else its low field's (seriesPaint).
  return {
    paint: centre >= 0 ? centre : low >= 0 ? low : index,
    shape: spec.mark === 'range'
      ? BAND_SHAPE
      // The scene drops the centre points while the centre series is hidden and keeps the whiskers.
      : whiskerShape((interval?.capWidth ?? 8) > 0, centre >= 0 && view.visible?.[centre] !== false ? view.cues[centre]?.marker ?? 'circle' : null),
  };
}

/** The swatch of each series of a Cartesian chart, read from the layer that declared its field. */
export function createMarkSwatch(stateRef: CartesianStateRef): SeriesSwatch {
  const swatch = (index: number, cue: SeriesCue | null, hollow: boolean, view: View): SwatchSpec => {
    const { paint, shape } = drawingOf(stateRef, index, view);
    if (shape === 'line') return lineSwatch(index, cue, hollow);
    if (shape === 'bar') return { color: paint, cue, line: false, hollow, fill: true, pattern: null };
    return { color: paint, cue, line: false, hollow, fill: true, shape };
  };
  // The layers are read at call time (stateRef.meta, restored on a rejected update), so the cached controls
  // compare the drawing they produce: a new mark, interval colour, cap or centre marker redraws the swatch.
  const key = (index: number, view: View): string => {
    const { paint, shape } = drawingOf(stateRef, index, view);
    return `${paint}:${typeof shape === 'string' ? shape : shape.key}`;
  };
  return Object.assign(swatch, { key });
}
