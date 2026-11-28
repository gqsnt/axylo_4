/**
 * Rendering oracle for the N8b bubble paths (shared by the tests here). It does not share code with the
 * renderer: it parses each series' SVG `d` with the SVG arc rules (SVG 1.1 F.6.5, endpoint to centre
 * parameterization, radius scaled up when too small), flattens arcs finely, and evaluates the nonzero winding
 * number at sample points. The expected owner of a point comes straight from the stated picture: shapes painted
 * largest first (equal radii by source row, then series), each an opaque disc of radius r in its series colour
 * ringed by an unpainted GAP band, a zero size a 1 px ring at ZERO_RADIUS with an unpainted GAP band on both
 * sides and a see-through hole; the last shape painted over a point owns it.
 */
import type { BubbleGeometry } from '../../../src/spatial/bubble/geometry';
import { ZERO_RADIUS } from '../../../src/spatial/bubble/geometry';
import { GAP, paintedMap } from '../../../src/spatial/bubble/paint';

export interface Disc { x: number; y: number; r: number; series: number; row: number }

export function geometryOf(discs: readonly Disc[], width = 200, height = 200): BubbleGeometry {
  const n = discs.length;
  const order = Uint32Array.from(discs.map((_, i) => i)).sort((a, b) =>
    (discs[b]!.r - discs[a]!.r) || (discs[a]!.row - discs[b]!.row) || (discs[a]!.series - discs[b]!.series));
  const rank = new Int32Array(n);
  order.forEach((b, o) => { rank[b] = o; });
  return {
    count: n, x: Float32Array.from(discs, d => d.x), y: Float32Array.from(discs, d => d.y), r: Float64Array.from(discs, d => d.r),
    series: Uint16Array.from(discs, d => d.series), index: Uint32Array.from(discs, (_, i) => i), row: Int32Array.from(discs, d => d.row),
    order, rank, reach: Math.max(ZERO_RADIUS, ...discs.map(d => d.r)), plot: { x: 0, y: 0, width, height },
  };
}

/** Band edges of a shape (CSS px from its centre) and what each band paints: series index or -1 (nothing). */
function bands(d: Disc): { edges: number[]; paint: number[]; hole: number } {
  if (d.r === 0) {
    const a = ZERO_RADIUS - 0.5;
    return { edges: [a - GAP, a, a + 1, a + 1 + GAP], paint: [-1, d.series, -1], hole: a - GAP };
  }
  return { edges: [0, d.r, d.r + GAP], paint: [d.series, -1], hole: -1 };
}

/** The painter's-order owner of a point (-1: nothing painted), or null when it is within `margin` of an edge. */
export function expectedOwner(discs: readonly Disc[], g: BubbleGeometry, px: number, py: number, margin: number): number | null {
  let owner = -1;
  for (const b of g.order) {
    const d = discs[b]!, { edges, paint } = bands(d);
    const dist = Math.hypot(px - d.x, py - d.y);
    for (const e of edges) if (e > 0 && Math.abs(dist - e) < margin) return null;
    for (let k = 0; k < paint.length; k++) {
      if (dist >= edges[k]! && dist < edges[k + 1]!) owner = paint[k]!;
    }
  }
  return owner;
}

/** Flattens an M / A / a (relative arc) / Z path into line segments [x0, y0, x1, y1, …]. */
export function flatten(d: string): number[] {
  const out: number[] = [];
  const tokens = d.match(/[MAZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  let k = 0, cx = 0, cy = 0, sx = 0, sy = 0;
  const read = () => Number(tokens[k++]);
  const line = (x: number, y: number) => { out.push(cx, cy, x, y); cx = x; cy = y; };
  while (k < tokens.length) {
    const c = tokens[k++]!;
    if (c === 'M') { if (cx !== sx || cy !== sy) line(sx, sy); cx = sx = read(); cy = sy = read(); }
    else if (c === 'Z') { line(sx, sy); }
    else if (c === 'A' || c === 'a') {
      let rx = Math.abs(read()), ry = Math.abs(read());
      read();
      const large = read(), sweep = read(), rel = c === 'a', x = read() + (rel ? cx : 0), y = read() + (rel ? cy : 0);
      if (x === cx && y === cy) continue;
      // F.6.5 with no rotation.
      const x1p = (cx - x) / 2, y1p = (cy - y) / 2;
      const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
      if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
      const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
      const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
      let coef = Math.sqrt(Math.max(0, num / den));
      if (large === sweep) coef = -coef;
      const cxp = (coef * rx * y1p) / ry, cyp = (-coef * ry * x1p) / rx;
      const ox = cxp + (cx + x) / 2, oy = cyp + (cy + y) / 2;
      const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
      const t1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
      let dt = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
      if (!sweep && dt > 0) dt -= 2 * Math.PI;
      if (sweep && dt < 0) dt += 2 * Math.PI;
      const steps = Math.max(2, Math.ceil(Math.abs(dt) / 0.01));
      for (let s = 1; s < steps; s++) {
        const t = t1 + (dt * s) / steps;
        line(ox + rx * Math.cos(t), oy + ry * Math.sin(t));
      }
      line(x, y);
    }
  }
  if (cx !== sx || cy !== sy) line(sx, sy);
  return out;
}

export function winding(segments: readonly number[], px: number, py: number): number {
  let w = 0;
  for (let i = 0; i < segments.length; i += 4) {
    const x0 = segments[i]!, y0 = segments[i + 1]!, x1 = segments[i + 2]!, y1 = segments[i + 3]!;
    if (y0 <= py) {
      if (y1 > py && (x1 - x0) * (py - y0) - (px - x0) * (y1 - y0) > 0) w++;
    } else if (y1 <= py && (x1 - x0) * (py - y0) - (px - x0) * (y1 - y0) < 0) w--;
  }
  return w;
}

/** Sample points: random over the box, and just inside and outside of every band edge at random angles. */
function samples(discs: readonly Disc[], rand: () => number, box: number, count: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < count; i++) out.push([rand() * box, rand() * box]);
  for (const d of discs) {
    for (const e of bands(d).edges) {
      if (e <= 0) continue;
      for (let k = 0; k < 6; k++) {
        const t = rand() * 2 * Math.PI;
        for (const off of [-0.15, 0.15]) out.push([d.x + (e + off) * Math.cos(t), d.y + (e + off) * Math.sin(t)]);
      }
    }
  }
  return out;
}

function lcg(seed: number) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

/** Checks the painted picture at every sample: exactly the expected series has a nonzero winding there. */
export function checkPicture(discs: readonly Disc[], seriesCount: number, seed: number, box = 200, count = 1500) {
  const g = geometryOf(discs, box, box);
  const map = paintedMap(g, seriesCount);
  const flat = map.series.map(s => flatten(s.d));
  const wrong: string[] = [];
  for (const [px, py] of samples(discs, lcg(seed), box, count)) {
    const owner = expectedOwner(discs, g, px, py, 0.05);
    if (owner === null) continue;
    for (let s = 0; s < seriesCount; s++) {
      const filled = winding(flat[s]!, px, py) !== 0;
      if (filled !== (owner === s)) wrong.push(`(${px.toFixed(2)}, ${py.toFixed(2)}) series ${s} ${filled ? 'painted' : 'missing'}, owner ${owner}`);
    }
    if (wrong.length > 5) break;
  }
  return { wrong, map };
}

/** The discs of a geometry built by the chart, for the oracle (which orders them again by its own rule). */
export function discsOf(g: BubbleGeometry): Disc[] {
  return Array.from({ length: g.count }, (_, b) => ({ x: g.x[b]!, y: g.y[b]!, r: g.r[b]!, series: g.series[b]!, row: g.row[b]! }));
}
