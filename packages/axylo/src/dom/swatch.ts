/**
 * The legend and tooltip swatch: a small SVG that repeats how a series is drawn (spec A5): its color, its
 * marker shape, and for lines its dash. The color is the series' custom property on the chart root
 * (`--axylo-series-color-N`), so a theme change or forced colors restyle it with no call.
 *
 * A hidden series is drawn as an outline of the same shape (spec I2: marked by shape, not by dimming).
 */
import type { MarkerShape, SeriesCue } from '../core/contracts';
import { MARKER_POLYGONS } from '../render/geometry';

const NS = 'http://www.w3.org/2000/svg';

export interface SwatchSpec {
  /** Palette index of the series (or slice), null for a muted entry such as a donut's "Other". */
  readonly color: number | null;
  readonly cue: SeriesCue | null;
  /** Draw the short dashed stroke of a line behind the marker. */
  readonly line: boolean;
  /** Outline only: the series is hidden. */
  readonly hollow: boolean;
}

function colorOf(index: number | null): string {
  return index === null ? 'var(--axylo-muted, var(--axylo-default-muted))' : `var(--axylo-series-color-${index + 1})`;
}

function markerPath(shape: MarkerShape, cx: number, cy: number, size: number): string {
  if (shape === 'circle') {
    const r = size / 2;
    return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
  }
  const poly = MARKER_POLYGONS[shape];
  let d = '';
  for (let k = 0; k < poly.length; k += 2) {
    d += `${k === 0 ? 'M' : 'L'}${(cx + poly[k]! * size).toFixed(2)} ${(cy + poly[k + 1]! * size).toFixed(2)}`;
  }
  return d + 'Z';
}

/** A 20 × 12 swatch (CSS px). aria-hidden: the series name beside it is the text. */
export function createSwatch(doc: Document, spec: SwatchSpec): SVGSVGElement {
  const svg = doc.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'axylo-swatch');
  svg.setAttribute('viewBox', '0 0 20 12');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '12');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const color = colorOf(spec.color);
  svg.style.color = color;
  if (spec.line) {
    const line = doc.createElementNS(NS, 'line');
    line.setAttribute('x1', '0');
    line.setAttribute('x2', '20');
    line.setAttribute('y1', '6');
    line.setAttribute('y2', '6');
    line.setAttribute('stroke', 'currentColor');
    line.setAttribute('stroke-width', '2');
    const dash = spec.cue?.dash.normal;
    if (dash && dash.length) line.setAttribute('stroke-dasharray', dash.map(v => Math.max(1, v / 2)).join(' '));
    svg.appendChild(line);
  }
  const shape = doc.createElementNS(NS, 'path');
  // Without a cue (a donut slice, a single bar series) the swatch is a square chip.
  shape.setAttribute('d', markerPath(spec.cue?.marker ?? 'square', 10, 6, spec.cue ? 10 : 11));
  if (spec.hollow) {
    // Under the line a hollow marker needs the background inside it, or the line shows through.
    shape.setAttribute('fill', 'var(--axylo-background, var(--axylo-backdrop, var(--axylo-default-background)))');
    shape.setAttribute('stroke', 'currentColor');
    shape.setAttribute('stroke-width', '1.5');
  } else {
    shape.setAttribute('fill', 'currentColor');
  }
  svg.appendChild(shape);
  return svg;
}
