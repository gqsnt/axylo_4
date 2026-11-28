/**
 * The legend and tooltip swatch: a small SVG that repeats how a series is drawn (spec A5).
 */
import { svgElement } from "./attributes";
import type { MarkerShape, SeriesCue } from "../core/contracts";
import { MARKER_POLYGONS } from "../render/geometry";

export interface SwatchSpec {
  readonly color: number | null;
  readonly cue: SeriesCue | null;
  readonly line: boolean;
  readonly hollow: boolean;
  readonly fill?: boolean;
  readonly marker?: boolean;
  readonly pattern?: SwatchPattern | null;
  readonly shape?: SwatchShape;
}

export interface SwatchShape {
  readonly key: string;
  draw(svg: SVGSVGElement, spec: SwatchSpec): void;
}

export interface SwatchPattern {
  readonly kind: "diagonal" | "cross" | "dots";
  readonly d: string;
}

export const BACKGROUND =
  "var(--axylo-background, var(--axylo-backdrop, var(--axylo-default-background)))";
const patterns: Partial<Record<SwatchPattern["kind"], SwatchPattern>> = {};
const markerPaths: Partial<Record<MarkerShape, string>> = {};

export function swatchPattern(kind: SwatchPattern["kind"]): SwatchPattern {
  return (patterns[kind] ??= { kind, d: patternPath(kind) });
}

function patternPath(kind: "diagonal" | "cross" | "dots"): string {
  let d = "";
  if (kind === "dots") {
    for (const [cx, cy] of [
      [7.5, 3.5],
      [12.5, 3.5],
      [10, 6],
      [7.5, 8.5],
      [12.5, 8.5],
    ] as const)
      d += `M${cx + 1} ${cy}a1 1 0 1 0 -2 0a1 1 0 1 0 2 0Z`;
    return d;
  }
  for (let c = 4; c < 20; c += 4) {
    const a = Math.max(0, c - 10),
      b = Math.min(10, c);
    d += `M${5 + a} ${11 - (c - a)}L${5 + b} ${11 - (c - b)}`;
    if (kind === "cross") d += `M${5 + a} ${1 + (c - a)}L${5 + b} ${1 + (c - b)}`;
  }
  return d;
}

export function markerPath(shape: MarkerShape, cx: number, cy: number, size: number): string {
  if (shape === "circle") {
    const r = size / 2;
    return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${size} 0a${r} ${r} 0 1 0 ${-size} 0Z`;
  }
  const poly = MARKER_POLYGONS[shape];
  let d = "";
  for (let k = 0; k < poly.length; k += 2)
    d += `${k ? "L" : "M"}${(cx + poly[k]! * size).toFixed(2)} ${(cy + poly[k + 1]! * size).toFixed(2)}`;
  return d + "Z";
}

function appendShape(
  svg: SVGSVGElement,
  doc: Document,
  spec: SwatchSpec,
  square: boolean,
  marked: boolean,
  onChip: boolean,
): void {
  const marker = spec.cue?.marker;
  const shape = svgElement(doc, "path", {
    class: square ? "axylo-swatch-chip" : "axylo-swatch-marker",
    d: square ? "M5 1H15V11H5Z" : (markerPaths[marker!] ??= markerPath(marker!, 10, 6, 10)),
  });
  if (square && marked && !spec.hollow) shape.setAttribute("fill-opacity", "0.4");
  shape.setAttribute("fill", spec.hollow ? BACKGROUND : "currentColor");
  if (spec.hollow || onChip) {
    shape.setAttribute("stroke", spec.hollow ? "currentColor" : BACKGROUND);
    shape.setAttribute("stroke-width", spec.hollow ? "1.5" : "1");
  }
  svg.appendChild(shape);
}

// Shared attribute sets keep swatch setup independent of the number of visible series.
const SWATCH = {
  class: "axylo-swatch",
  viewBox: "0 0 20 12",
  width: "20",
  height: "12",
  "aria-hidden": "true",
  focusable: "false",
};
const LINE = { x1: "0", x2: "20", y1: "6", y2: "6", stroke: "currentColor", "stroke-width": "2" };

function dash(values: readonly number[] | null | undefined): string {
  return values?.length ? values.map(halfDash).join(" ") : "none";
}

const halfDash = (value: number) => Math.max(1, value / 2);

export function createSwatch(doc: Document, spec: SwatchSpec): SVGSVGElement {
  const svg = svgElement(doc, "svg", SWATCH);
  svg.style.color =
    spec.color === null
      ? "var(--axylo-muted, var(--axylo-default-muted))"
      : `var(--axylo-series-color-${spec.color + 1})`;
  if (spec.shape) {
    spec.shape.draw(svg, spec);
    return svg;
  }
  if (spec.line) {
    const line = svgElement(doc, "line", LINE);
    line.setAttribute("class", "axylo-swatch-line");
    line.style.setProperty("--axylo-swatch-dash", dash(spec.cue?.dash.normal));
    line.style.setProperty("--axylo-swatch-dash-contrast", dash(spec.cue?.dash.contrast));
    svg.appendChild(line);
  }
  const chip = spec.fill === true || !spec.cue,
    marked = chip && spec.marker === true && spec.cue !== null;
  appendShape(svg, doc, spec, chip, marked, false);
  if (marked) appendShape(svg, doc, spec, false, marked, true);
  if (chip && spec.pattern && !spec.hollow) {
    const dots = spec.pattern.kind === "dots";
    const path = svgElement(doc, "path", {
      class: "axylo-swatch-pattern",
      d: spec.pattern.d,
      fill: dots ? BACKGROUND : "none",
    });
    if (!dots) {
      path.setAttribute("stroke", BACKGROUND);
      path.setAttribute("stroke-width", "1.5");
    }
    svg.appendChild(path);
  }
  return svg;
}

export const areaSwatch = (color: number, cue: SeriesCue | null, hollow: boolean): SwatchSpec => ({
  color,
  cue,
  line: false,
  hollow,
  fill: true,
  marker: true,
  pattern: null,
});
export const lineSwatch = (color: number, cue: SeriesCue | null, hollow: boolean): SwatchSpec => ({
  color,
  cue,
  line: true,
  hollow,
});
export const pointSwatch = (color: number, cue: SeriesCue | null, hollow: boolean): SwatchSpec => ({
  color,
  cue,
  line: false,
  hollow,
});
