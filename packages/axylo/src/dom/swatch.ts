/**
 * The legend and tooltip swatch: a small SVG that repeats how a series is drawn (spec A5): a filled square
 * for bars and areas (with the bar's pattern past the eighth series, spec F9), the line with its dash and
 * marker for lines, the marker for scatter. The color is the series' custom property on the chart root
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
  /** A filled square: bars and areas fill a region. */
  readonly fill?: boolean;
  /**
   * Areas: the series' marker drawn on the square, as the marks carry it at their last point and at sparse
   * intervals (spec A5). Bars have none; they are told apart by pattern past eight series (spec F9).
   */
  readonly marker?: boolean;
  /** The bar pattern drawn over the fill in the background color (from swatchPattern), or null. */
  readonly pattern?: SwatchPattern | null;
}

export interface SwatchPattern {
  readonly kind: 'diagonal' | 'cross' | 'dots';
  /** Path data inside the chip. */
  readonly d: string;
}

const BACKGROUND = 'var(--axylo-background, var(--axylo-backdrop, var(--axylo-default-background)))';

/** A bar pattern for the chip; only the bar's swatch asks for one, so only bars carry the drawing. */
export function swatchPattern(kind: SwatchPattern['kind']): SwatchPattern {
  return { kind, d: patternPath(kind) };
}

/** The pattern inside the 10 × 10 chip at (5, 1), as path data: lines x + y = c (and x − y = c), or dots. */
function patternPath(kind: 'diagonal' | 'cross' | 'dots'): string {
  const x0 = 5, y0 = 1, size = 10;
  if (kind === 'dots') {
    let d = '';
    for (const [cx, cy] of [[7.5, 3.5], [12.5, 3.5], [10, 6], [7.5, 8.5], [12.5, 8.5]] as const) {
      d += `M${cx + 1} ${cy}a1 1 0 1 0 -2 0a1 1 0 1 0 2 0Z`;
    }
    return d;
  }
  let d = '';
  // Diagonals every 4 px, clipped to the chip by hand (no <clipPath>, so no ids to keep unique).
  for (let c = 4; c < 2 * size; c += 4) {
    const a = Math.max(0, c - size);
    const b = Math.min(size, c);
    d += `M${x0 + a} ${y0 + size - (c - a)}L${x0 + b} ${y0 + size - (c - b)}`;
    if (kind === 'cross') d += `M${x0 + a} ${y0 + (c - a)}L${x0 + b} ${y0 + (c - b)}`;
  }
  return d;
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
    // Both patterns, so the stylesheet can switch to the contrast one exactly where the marks do (prefers-
    // contrast: more, forced colors; review 2, finding 22). Halved: the swatch is a short sample.
    const pattern = (dash: readonly number[] | null | undefined) => dash && dash.length ? dash.map(v => Math.max(1, v / 2)).join(' ') : 'none';
    line.setAttribute('class', 'axylo-swatch-line');
    line.style.setProperty('--axylo-swatch-dash', pattern(spec.cue?.dash.normal));
    line.style.setProperty('--axylo-swatch-dash-contrast', pattern(spec.cue?.dash.contrast));
    svg.appendChild(line);
  }
  const shape = doc.createElementNS(NS, 'path');
  // Bars, areas and donut slices are filled regions: a square chip. Otherwise the series' marker.
  const chip = spec.fill === true || !spec.cue;
  const marked = chip && spec.marker === true && spec.cue !== null;
  shape.setAttribute('class', chip ? 'axylo-swatch-chip' : 'axylo-swatch-marker');
  shape.setAttribute('d', chip ? 'M5 1H15V11H5Z' : markerPath(spec.cue!.marker, 10, 6, 10));
  // Under a marker the chip is lighter, as an area's fill is, so the marker in full color shows on it.
  if (marked && !spec.hollow) shape.setAttribute('fill-opacity', '0.4');
  if (spec.hollow) {
    // Under the line a hollow marker needs the background inside it, or the line shows through.
    shape.setAttribute('fill', BACKGROUND);
    shape.setAttribute('stroke', 'currentColor');
    shape.setAttribute('stroke-width', '1.5');
  } else {
    shape.setAttribute('fill', 'currentColor');
  }
  svg.appendChild(shape);
  if (marked) {
    const marker = doc.createElementNS(NS, 'path');
    marker.setAttribute('class', 'axylo-swatch-marker');
    marker.setAttribute('d', markerPath(spec.cue!.marker, 10, 6, 10));
    if (spec.hollow) {
      marker.setAttribute('fill', BACKGROUND);
      marker.setAttribute('stroke', 'currentColor');
      marker.setAttribute('stroke-width', '1.5');
    } else {
      marker.setAttribute('fill', 'currentColor');
      // A thin edge of the background keeps the marker's outline readable on its own color (spec A5).
      marker.setAttribute('stroke', BACKGROUND);
      marker.setAttribute('stroke-width', '1');
    }
    svg.appendChild(marker);
  }
  if (chip && spec.pattern && !spec.hollow) {
    const pattern = doc.createElementNS(NS, 'path');
    pattern.setAttribute('class', 'axylo-swatch-pattern');
    pattern.setAttribute('d', spec.pattern.d);
    if (spec.pattern.kind === 'dots') pattern.setAttribute('fill', BACKGROUND);
    else {
      pattern.setAttribute('fill', 'none');
      pattern.setAttribute('stroke', BACKGROUND);
      pattern.setAttribute('stroke-width', '1.5');
    }
    svg.appendChild(pattern);
  }
  return svg;
}
