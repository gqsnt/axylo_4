/**
 * Geometry shared by the canvas and SVG renderers, so both draw the same picture. Pure: runs in Node.
 * Every function writes into a caller-owned scratch array instead of returning objects, so drawing
 * allocates nothing per mark element.
 */
import type { MarkerShape, Paint, PaintBindings, RuleMark } from '../core/contracts';

/** True for NaN and ±Infinity: such a coordinate lifts the pen. */
export const lifted = (v: number): boolean => v - v !== 0;

/** The paint's entry in a binding table (CSS expressions or concrete colors), or null for 'none'. */
export function paintOf(paint: Paint, table: PaintBindings): string | null {
  if (paint.kind === 'none') return null;
  if (paint.kind === 'token') return table.tokens[paint.name];
  const s = table.series;
  if (s.length === 0) return null;
  return s[paint.index] ?? s[((paint.index % s.length) + s.length) % s.length]!;
}

/** Rules whose role is drawn outside the plot clip (the scene contract). */
export const unclippedRule = (role: RuleMark['role']): boolean => role === 'axis' || role === 'tick';

/**
 * Snaps a horizontal or vertical rule to device pixels so a 1 px rule covers whole pixel rows and stays
 * crisp. Writes x1, y1, x2, y2 and the line width, all in CSS px, into `out`. Other rules pass through.
 */
export function snapRule(x1: number, y1: number, x2: number, y2: number, width: number, dpr: number, out: Float64Array): void {
  const device = Math.max(1, Math.round(width * dpr));
  const half = device / 2;
  if (y1 === y2) {
    const y = (Math.round(y1 * dpr - half) + half) / dpr;
    out[0] = Math.round(x1 * dpr) / dpr; out[1] = y; out[2] = Math.round(x2 * dpr) / dpr; out[3] = y;
    out[4] = device / dpr;
  } else if (x1 === x2) {
    const x = (Math.round(x1 * dpr - half) + half) / dpr;
    out[0] = x; out[1] = Math.round(y1 * dpr) / dpr; out[2] = x; out[3] = Math.round(y2 * dpr) / dpr;
    out[4] = device / dpr;
  } else {
    out[0] = x1; out[1] = y1; out[2] = x2; out[3] = y2; out[4] = width;
  }
}

/** Smallest side of the "no data" marker, CSS px: large enough not to read as a hairline or a zero bar. */
export const MISSING_MIN = 6;
/** Outline width of the "no data" marker, CSS px. */
export const MISSING_STROKE = 1.5;

/**
 * Box of the "no data" marker of spec F2 for one 'missing' rect. The scene gives the empty slot at the
 * baseline: its band extent along the category axis and its edge on the baseline. A side thinner than
 * MISSING_MIN is grown away from the baseline (upwards for a zero height, rightwards for a zero width),
 * so the marker sits on the baseline. The renderers draw it hollow, with a diagonal, inset by half the
 * outline so the outline stays inside the box. Writes x, y, width, height of the outline path into `out`.
 */
export function missingBox(x: number, y: number, w: number, h: number, out: Float64Array): void {
  const left = w < 0 ? x + w : x;
  let top = h < 0 ? y + h : y;
  const width = Math.max(Math.abs(w), MISSING_MIN);
  let height = Math.abs(h);
  if (height < MISSING_MIN) { top = top + height - MISSING_MIN; height = MISSING_MIN; }
  const inset = MISSING_STROKE / 2;
  out[0] = left + inset; out[1] = top + inset; out[2] = width - MISSING_STROKE; out[3] = height - MISSING_STROKE;
}

/** Result of `sector`. */
export const SECTOR_NONE = 0;    // nothing to draw
export const SECTOR_RING = 1;    // a full annulus (one slice that is the whole circle)
export const SECTOR_ARCS = 2;    // outer arc, then inner arc back
export const SECTOR_APEX = 3;    // outer arc, then one apex point (the gap closes before the inner radius)

/**
 * Annular sector with `gap` CSS px of background between it and its neighbours: each side is moved
 * gap/2 into the slice, parallel to its radius, so the gap has constant width (spec A5) rather than a
 * constant angle. Input angles are radians clockwise from 12 o'clock. Writes, in canvas angles (radians
 * clockwise from 3 o'clock): out[0], out[1] the outer arc; out[2], out[3] the inner arc (drawn from
 * out[2] back to out[3]); for SECTOR_APEX, out[4] the apex radius and out[5] its angle.
 */
export function sector(a0: number, a1: number, r0: number, r1: number, gap: number, out: Float64Array): number {
  const span = a1 - a0;
  if (!(span > 0) || !(r1 > 0) || !(r1 > r0)) return SECTOR_NONE;
  if (span >= 2 * Math.PI - 1e-9) return SECTOR_RING;
  const quarter = Math.PI / 2;
  const d = gap > 0 ? gap / 2 : 0;
  if (d >= r1) return SECTOR_NONE;
  const outer = Math.asin(d / r1);
  if (span <= 2 * outer) return SECTOR_NONE;
  out[0] = a0 + outer - quarter;
  out[1] = a1 - outer - quarter;
  // Radius at which the two moved sides meet, on the bisector.
  const meet = d > 0 ? d / Math.sin(span / 2) : 0;
  if (r0 > 0 && r0 > meet && r0 > d) {
    const inner = Math.asin(d / r0);
    out[2] = a1 - inner - quarter;
    out[3] = a0 + inner - quarter;
    return SECTOR_ARCS;
  }
  out[4] = meet;
  out[5] = (a0 + a1) / 2 - quarter;
  return SECTOR_APEX;
}

/**
 * Marker outlines in a unit box centred on the point, clockwise on screen (y down), so all of a mark's
 * markers can be filled as one path with the nonzero rule. 'circle' is drawn as an arc instead.
 */
export type PolygonShape = Exclude<MarkerShape, 'circle'>;

function plus(): number[] {
  const t = 1 / 6; // half arm thickness: arms are a third of the box
  return [-t, -0.5, t, -0.5, t, -t, 0.5, -t, 0.5, t, t, t, t, 0.5, -t, 0.5, -t, t, -0.5, t, -0.5, -t, -t, -t];
}

function rotate45(p: number[]): number[] {
  const c = Math.SQRT1_2;
  const out: number[] = [];
  for (let i = 0; i < p.length; i += 2) out.push((p[i]! - p[i + 1]!) * c, (p[i]! + p[i + 1]!) * c);
  return out;
}

function star(): number[] {
  const out: number[] = [];
  const inner = 0.5 * 0.382;
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const r = k % 2 === 0 ? 0.5 : inner;
    out.push(r * Math.cos(a), r * Math.sin(a));
  }
  return out;
}

export const MARKER_POLYGONS: Readonly<Record<PolygonShape, Float64Array>> = {
  square: Float64Array.of(-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5),
  triangle: Float64Array.of(0, -0.5, 0.5, 0.5, -0.5, 0.5),
  'triangle-down': Float64Array.of(-0.5, -0.5, 0.5, -0.5, 0, 0.5),
  diamond: Float64Array.of(0, -0.5, 0.5, 0, 0, 0.5, -0.5, 0),
  plus: Float64Array.from(plus()),
  cross: Float64Array.from(rotate45(plus())),
  star: Float64Array.from(star()),
};

/** Signed area of a packed polygon; positive means clockwise on screen (y down). */
export function signedArea(p: Float64Array): number {
  let a = 0;
  const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += p[2 * i]! * p[2 * j + 1]! - p[2 * j]! * p[2 * i + 1]!;
  }
  return a / 2;
}

/** Joins a dash pattern for CSS and SVG, or 'none' for solid. */
export const dashText = (dash: readonly number[] | null): string => (dash === null || dash.length === 0 ? 'none' : dash.join(' '));
