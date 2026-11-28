/**
 * Legend and tooltip swatch for `axylo/cartesian` (spec A5, I2).
 * Every top-level statement stays pure so `import 'axylo/cartesian'` bundles to 0 raw bytes.
 */
import type { AlignedView, SeriesCue, View } from '../core/contracts';
import type { CartesianStateRef } from './meta';
import type { SeriesSwatch } from '../dom/interaction-types';
import { svgElement } from '../dom/attributes';
import { BACKGROUND, lineSwatch, markerPath, pointSwatch, type SwatchShape, type SwatchSpec } from '../dom/swatch';
import { markOf, partIndex, physicalOf } from './boxplot';

const shapePath = (svg: SVGSVGElement, d: string, cls: string, fill: string, extra?: Readonly<Record<string, string>>) => {
  const path = svgElement(svg.ownerDocument, 'path', { d, class: cls, fill, ...extra });
  svg.appendChild(path);
  return path;
};

const region = (svg: SVGSVGElement, d: string, hollow: boolean) => {
  shapePath(svg, d, 'axylo-swatch-chip', hollow ? BACKGROUND : 'currentColor',
    hollow ? { stroke: 'currentColor', 'stroke-width': '1.5' } : { 'fill-opacity': '0.22' });
};

const dashPat = (dash: readonly number[] | null | undefined) => dash?.length ? dash.map(v => Math.max(1, v / 2)).join(' ') : 'none';

const AREA_SHAPE: SwatchShape = {
  key: 'area',
  draw(svg, spec) {
    region(svg, 'M1 6L7 3L13 6L19 3V11H1Z', spec.hollow);
    if (spec.hollow) return;
    const edge = shapePath(svg, 'M1 6L7 3L13 6L19 3', 'axylo-swatch-line', 'none', { stroke: 'currentColor', 'stroke-width': '2', 'stroke-linejoin': 'round' });
    edge.style.setProperty('--axylo-swatch-dash', dashPat(spec.cue?.dash.normal));
    edge.style.setProperty('--axylo-swatch-dash-contrast', dashPat(spec.cue?.dash.contrast));
  },
};

const BAND_SHAPE: SwatchShape = { key: 'range', draw: (svg, spec) => region(svg, 'M1 3L7 2L13 4L19 2V9L13 10L7 8L1 10Z', spec.hollow) };

const whiskers: Record<string, SwatchShape> = {};

function whiskerShape(capped: boolean, centre: SeriesCue['marker'] | null): SwatchShape {
  const key = `errorBar:${capped}:${centre ?? ''}`;
  return whiskers[key] ??= {
    key,
    draw(svg, spec) {
      const d = capped ? 'M10 1V11M6 1H14M6 11H14' : 'M10 1V11';
      const stroke = (color: string, width: string) => shapePath(svg, d, 'axylo-swatch-whisker', 'none', { stroke: color, 'stroke-width': width });
      if (spec.hollow) { stroke('currentColor', '3.5'); stroke(BACKGROUND, '1.5'); } else stroke('currentColor', '1.5');
      if (centre !== null) {
        shapePath(svg, markerPath(centre, 10, 6, 6), 'axylo-swatch-marker', spec.hollow ? BACKGROUND : 'currentColor',
          spec.hollow ? { stroke: 'currentColor', 'stroke-width': '1.5' } : { stroke: BACKGROUND, 'stroke-width': '1' });
      }
    },
  };
}

const BOX_SHAPE: SwatchShape = {
  key: 'boxplot',
  draw(svg, spec) {
    if (spec.hollow) {
      shapePath(svg, 'M5 3H15V9H5Z', 'axylo-swatch-chip', BACKGROUND, { stroke: 'currentColor', 'stroke-width': '1.5' });
    } else {
      shapePath(svg, 'M5 3H15V9H5Z', 'axylo-swatch-chip', 'currentColor');
      shapePath(svg, 'M5 6H15', 'axylo-swatch-median', 'none', { stroke: BACKGROUND, 'stroke-width': '1.5' });
    }
    shapePath(svg, 'M10 1V3M10 9V11M7 1H13M7 11H13', 'axylo-swatch-whisker', 'none', { stroke: 'currentColor', 'stroke-width': '1.5' });
  },
};

const VIOLIN_SHAPE: SwatchShape = {
  key: 'violin',
  draw(svg, spec) {
    const d = 'M10 1C12 4 15 5 12 7C11 8 11 10 10 11C9 10 9 8 8 7C5 5 8 4 10 1Z';
    if (spec.hollow) shapePath(svg, d, 'axylo-swatch-chip', BACKGROUND, { stroke: 'currentColor', 'stroke-width': '1.5' });
    else {
      shapePath(svg, d, 'axylo-swatch-chip', 'currentColor');
      shapePath(svg, 'M8 6H12', 'axylo-swatch-median', 'none', { stroke: BACKGROUND, 'stroke-width': '1.5' });
    }
  },
};

interface Drawing { readonly paint: number; readonly shape: SwatchShape | 'line' | 'point' | 'bar' }
const LINE: Drawing = { paint: -1, shape: 'line' };

function drawingOf(stateRef: CartesianStateRef, index: number, view: View): Drawing {
  if (view.kind === 'donut' || view.kind === 'scatter') return LINE;
  const field = view.frame.series[index]?.field;
  const { meta } = stateRef;
  const mark = field === undefined ? undefined : markOf(meta, field);
  const kind = mark?.kind ?? (field === undefined ? undefined : meta.seriesByField.get(field)?.mark);
  if (!kind || kind === 'line') return LINE;
  if (kind === 'scatter') return { paint: index, shape: 'point' };
  if (kind === 'bar') return { paint: index, shape: 'bar' };
  if (kind === 'area') return { paint: index, shape: AREA_SHAPE };
  if (kind === 'boxplot') return { paint: index, shape: BOX_SHAPE };
  if (kind === 'violin') return { paint: index, shape: VIOLIN_SHAPE };
  if (kind === 'range') return { paint: index, shape: BAND_SHAPE };
  const physical = physicalOf(view as AlignedView);
  const centre = mark ? partIndex(mark, physical, index, 'y') : -1;
  const drawsCentre = centre >= 0 && physical.frame.series[centre]?.drawable !== false && view.visible?.[index] !== false;
  return { paint: index, shape: whiskerShape((mark?.capWidth ?? 8) > 0, drawsCentre ? view.cues[index]?.marker ?? 'circle' : null) };
}

export function createMarkSwatch(stateRef: CartesianStateRef): SeriesSwatch {
  const swatch = (index: number, cue: SeriesCue | null, hollow: boolean, view: View): SwatchSpec => {
    const { paint, shape } = drawingOf(stateRef, index, view);
    if (shape === 'line') return lineSwatch(index, cue, hollow);
    if (shape === 'point') return pointSwatch(index, cue, hollow);
    return shape === 'bar'
      ? { color: paint, cue, line: false, hollow, fill: true, pattern: null }
      : { color: paint, cue, line: false, hollow, fill: true, shape };
  };
  return Object.assign(swatch, {
    key: (index: number, view: View): string => {
      const { paint, shape } = drawingOf(stateRef, index, view);
      return `${paint}:${typeof shape === 'string' ? shape : shape.key}`;
    },
    legendForOne: (view: View): boolean => {
      const shape = view.kind !== 'donut' && view.frame.series.length === 1 ? drawingOf(stateRef, 0, view).shape : null;
      return shape === BAND_SHAPE || shape === VIOLIN_SHAPE || (typeof shape === 'object' && !!shape?.key.startsWith('errorBar'));
    },
  });
}
