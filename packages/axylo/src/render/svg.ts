/**
 * SVG mark renderer (plan 2.3). Paints with `bindings`, CSS expressions such as
 * `var(--axylo-series-color-1)`, through style properties, so the browser restyles the marks on a theme
 * change with no call. Dash patterns switch under `prefers-contrast: more` and forced colors through the
 * stylesheet (theme/css.ts).
 *
 * Every paint goes through the `color` property and is used as `currentColor` for fill or stroke. So a
 * series color is always a color, never an SVG paint server (`url(#…)`), exactly as for the canvas
 * renderer. The renderer opts out of forced-color adjustment (`forced-color-adjust: none`): in forced
 * colors the stylesheet maps every paint to a system color itself.
 *
 * Elements are reused between draws when the slot has the same kind. Bars and slices use groups, and
 * compatible grid or tick rules share a path. Attributes are only written when their value changes.
 * Marks with coordinate arrays reuse their path data while those arrays have the same identity.
 * Scene arrays must therefore never be mutated in place: a changed geometry is a new array.
 */
import { sameKey } from '../core/axes';
import type {
  AreaMark, ArcMark, BandMark, Mark, MarkRenderer, Overlay, PaintBindings, PathMark, PointMark, Rect, RectMark, ResolvedTheme, RuleMark, Scene,
} from '../core/contracts';
import {
  DOT_RADIUS, DOT_TILE, dashText, lifted, MARKER_POLYGONS, PATTERN_LINE, PATTERN_TILE, MISSING_STROKE, missingBox, paintOf, sector, SECTOR_APEX, SECTOR_ARCS, SECTOR_NONE, SECTOR_RING, snapRule, unclippedRule,
} from './geometry';

import { svgElement } from '../dom/attributes';

let ids = 0;

/** An element plus what was last written to it, so unchanged values are not written again. */
export interface SvgNode {
  readonly key: string;
  readonly el: SVGElement;
  attrs: Map<string, string> | null;
  styles: Map<string, string> | null;
  kids: SvgNode[] | null;
  rects: SVGRectElement[] | null;
  /** The inputs the current `d` was built from, compared by identity. */
  source: readonly unknown[] | null;
}

function node(doc: Document, tag: keyof SVGElementTagNameMap, key: string, attrs?: Record<string, string>): SvgNode {
  return { key, el: svgElement(doc, tag, attrs), attrs: null, styles: null, kids: null, rects: null, source: null };
}

/** Sets `d` from `build()` unless every input is identical (===) to the ones the current `d` came from. */
function data(n: SvgNode, source: readonly unknown[], build: () => string): void {
  if (sameKey(n.source, source)) return;
  n.source = source;
  attrStr(n, 'd', build());
}

function attrStr(n: SvgNode, name: string, value: string): void {
  if (n.attrs?.get(name) !== value) {
    (n.attrs ??= new Map()).set(name, value);
    n.el.setAttribute(name, value);
  }
}

function attr(n: SvgNode, name: string, input: number | string | null): void {
  if (input === null) {
    if (n.attrs?.delete(name)) n.el.removeAttribute(name);
  } else attrStr(n, name, String(input));
}

function hasDigits(s: string, prefix: string): boolean {
  const start = prefix.length;
  if (!s.startsWith(prefix) || !s.endsWith(')') || s.length <= start + 1) return false;
  for (let i = start; i < s.length - 1; i++) {
    const ch = s.charCodeAt(i);
    if (ch < 48 || ch > 57) return false;
  }
  return true;
}

const TRUSTED_COLOR_RE = /^var\(--axylo-(?:background, (?:transparent|var\(--axylo-backdrop, var\(--axylo-default-background\)\))|text, currentColor|(axis|grid|reference|muted|focus), var\(--axylo-default-\1\))\)$/;

function isTrustedCss(name: string, value: string): boolean {
  if (name === 'color') return hasDigits(value, 'var(--axylo-series-color-') || TRUSTED_COLOR_RE.test(value);
  if (name === 'fill-opacity') return /^(?:0(?:\.25|\.5|\.8)?|1)$/.test(value);
  return (name === 'fill' || name === 'stroke')
    && (value === 'none' || value === 'currentColor' || (name === 'fill' && hasDigits(value, 'url(#axylo-pattern-')));
}

function cssClear(n: SvgNode, name: string): void {
  if (n.styles?.delete(name)) n.el.style.removeProperty(name);
}

function cssTrusted(n: SvgNode, name: string, value: string): void {
  if (n.styles?.get(name) !== value) {
    (n.styles ??= new Map()).set(name, value);
    n.el.style.setProperty(name, value);
  }
}

// Style properties, not presentation attributes: those do not accept var(), and CSSOM writes are allowed
// under a Content Security Policy without 'unsafe-inline' (spec DX8).
function setCss(style: CSSStyleDeclaration, name: string, value: string): boolean {
  if (isTrustedCss(name, value)) {
    style.setProperty(name, value);
    return true;
  }
  // Validate independently of any prior declaration so a rejected assignment cannot inherit its value.
  const before = style.getPropertyValue(name);
  style.setProperty(name, value);
  const after = style.getPropertyValue(name);
  if (after !== '' && after !== before) return true;
  style.removeProperty(name);
  style.setProperty(name, value);
  if (style.getPropertyValue(name) !== '') return true;
  if (before !== '') style.setProperty(name, before);
  return false;
}

function css(n: SvgNode, name: string, value: string | null): void {
  if (value === null) cssClear(n, name);
  else if (n.styles?.get(name) !== value) {
    if (setCss(n.el.style, name, value)) (n.styles ??= new Map()).set(name, value);
    else n.styles?.delete(name);
  }
}

/** Paints `role` ('fill' or 'stroke') with a CSS color expression, through `color` and currentColor. */
function paint(n: SvgNode, role: 'fill' | 'stroke', value: string | null): void {
  cssTrusted(n, role === 'fill' ? 'stroke' : 'fill', 'none');
  if (value === null) { cssTrusted(n, role, 'none'); cssClear(n, 'color'); return; }
  css(n, 'color', value);
  cssTrusted(n, role, 'currentColor');
}

/** Two decimals: well below a device pixel at any realistic ratio, and keeps `d` short. */
const f = (v: number): number => Math.round(v * 100) / 100;

function fstr(v: number): string {
  if (v >= -2e7 && v <= 2e7) {
    const c = Math.round(v * 100);
    if (c === 0) return '0';
    const ac = c < 0 ? -c : c;
    const q = (ac / 100) | 0;
    const r = ac - q * 100;
    return (c < 0 ? '-' : '') + q + (r === 0 ? '' : r % 10 === 0 ? '.' + r / 10 : r < 10 ? '.0' + r : '.' + r);
  }
  return String(f(v));
}

let pathDecoder: TextDecoder | null = null;
let pathBuf: Uint8Array | null = null;
const MAX_RETAINED_BUF = 16 * 1024;
let polyScratch: Float64Array | null = null;

function ensureBuf(need: number): Uint8Array {
  if (pathBuf === null) return pathBuf = new Uint8Array(need > 4096 ? need : 4096);
  return pathBuf.length < need ? pathBuf = new Uint8Array(Math.max(pathBuf.length * 2, need)) : pathBuf;
}

function growBuf(used: number, need: number): Uint8Array {
  const next = new Uint8Array(Math.max(pathBuf!.length * 2, need));
  next.set(pathBuf!.subarray(0, used));
  return pathBuf = next;
}

function writeNum(pos: number, v: number, rem: number): number {
  if (v >= -2e7 && v <= 2e7) {
    let c = Math.round(v * 100);
    const b = pathBuf!;
    if (c === 0) { b[pos++] = 48; return pos; }
    if (c < 0) { b[pos++] = 45; c = -c; }
    let q = (c / 100) | 0;
    const r = c - q * 100;
    if (q < 10) {
      b[pos++] = 48 + q;
    } else {
      const start = pos;
      while (q > 0) {
        const q10 = (q / 10) | 0;
        b[pos++] = 48 + q - q10 * 10;
        q = q10;
      }
      for (let l = start, hi = pos - 1; l < hi; l++, hi--) {
        const t = b[l]!; b[l] = b[hi]!; b[hi] = t;
      }
    }
    if (r) {
      b[pos++] = 46;
      const d1 = (r / 10) | 0;
      b[pos++] = 48 + d1;
      if (r !== d1 * 10) b[pos++] = 48 + r - d1 * 10;
    }
    return pos;
  }
  const s = String(f(v));
  const need = pos + s.length + rem + 64;
  const b = need > pathBuf!.length ? growBuf(pos, need) : pathBuf!;
  for (let i = 0; i < s.length; i++) b[pos++] = s.charCodeAt(i);
  return pos;
}

function writeByte(pos: number, byte: number, rem: number): number {
  if (pos >= pathBuf!.length) growBuf(pos, pos + rem + 1);
  pathBuf![pos++] = byte;
  return pos;
}

function writeCmd(pos: number, cmd: number, v: number, rem: number): number {
  if (pos + 16 > pathBuf!.length) growBuf(pos, pos + rem + 16);
  pathBuf![pos++] = cmd;
  return writeNum(pos, v, rem);
}

function writeXY(pos: number, cmd: number, x: number, y: number, rem: number): number {
  if (pos + 28 > pathBuf!.length) growBuf(pos, pos + rem + 28);
  pathBuf![pos++] = cmd;
  pos = writeNum(pos, x, rem);
  pathBuf![pos++] = 32;
  return writeNum(pos, y, rem);
}

function decodeBuf(len: number): string {
  const buf = pathBuf!;
  const out = len === 0 ? '' : (pathDecoder ??= new TextDecoder()).decode(buf.subarray(0, len));
  if (buf.length > MAX_RETAINED_BUF) pathBuf = null;
  return out;
}

export function pathData(xy: Float32Array): string {
  const len = xy.length - 1;
  if (len <= 0) return '';
  ensureBuf((xy.length >> 1) * 26);
  let pos = 0;
  let pen = false;
  for (let i = 0; i < len; i += 2) {
    const x = xy[i]!, y = xy[i + 1]!;
    if (lifted(x) || lifted(y)) { pen = false; continue; }
    pos = writeXY(pos, pen ? 76 : 77, x, y, ((len - i) >> 1) * 26);
    pen = true;
  }
  return decodeBuf(pos);
}

export function areaData(mark: AreaMark): string {
  const { upper, lower, runs } = mark;
  const upperCount = upper.length >> 1, lowerCount = lower.length >> 1;
  let maxVerts = 0;
  for (let r = 0; r + 3 < runs.length; r += 4) {
    const us = runs[r]!, ue = Math.min(us + runs[r + 1]!, upperCount);
    const ls = runs[r + 2]!, le = Math.min(ls + runs[r + 3]!, lowerCount);
    if (ue > us && le > ls) maxVerts += ue - us + le - ls;
  }
  if (maxVerts === 0) return '';
  let remRuns = runs.length >> 2;
  ensureBuf(maxVerts * 26 + remRuns);
  let pos = 0, remVerts = maxVerts, runStart = 0;
  const emit = (arr: Float32Array, from: number, to: number, step: number) => {
    for (let k = from; k !== to; k += step) {
      const x = arr[2 * k]!, y = arr[2 * k + 1]!;
      remVerts--;
      if (!lifted(x) && !lifted(y)) pos = writeXY(pos, pos > runStart ? 76 : 77, x, y, remVerts * 26 + remRuns);
    }
  };
  for (let r = 0; r + 3 < runs.length; r += 4) {
    const us = runs[r]!, ue = Math.min(us + runs[r + 1]!, upperCount);
    const ls = runs[r + 2]!, le = Math.min(ls + runs[r + 3]!, lowerCount);
    remRuns--;
    // A region between two boundaries needs both: a run with an empty side draws nothing.
    if (ue <= us || le <= ls) continue;
    runStart = pos;
    emit(upper, us, ue, 1);
    emit(lower, le - 1, ls - 1, -1);
    if (pos > runStart) pos = writeByte(pos, 90, remVerts * 26 + remRuns);
  }
  return decodeBuf(pos);
}

function pointData(mark: PointMark): string {
  const { xy, size } = mark;
  const len = xy.length - 1;
  if (!(size > 0) || len <= 0) return '';
  const nPts = xy.length >> 1;
  if (mark.shape === 'circle') {
    const r = size / 2, rs = fstr(r);
    const arcStr = `A${rs} ${rs} 0 1 1 `;
    const arcLen = arcStr.length;
    const arcBytes = new Uint8Array(arcLen);
    for (let j = 0; j < arcLen; j++) arcBytes[j] = arcStr.charCodeAt(j);
    const perPoint = 77 + 2 * arcLen;
    ensureBuf(nPts * perPoint);
    let pos = 0;
    for (let i = 0; i < len; i += 2) {
      const x = xy[i]!, y = xy[i + 1]!;
      if (lifted(x) || lifted(y)) continue;
      const rem = ((len - i) >> 1) * perPoint + perPoint;
      if (pos + perPoint > pathBuf!.length) growBuf(pos, pos + rem);
      pathBuf![pos++] = 77;
      const sStart = pos;
      pos = writeNum(pos, x + r, rem);
      pathBuf![pos++] = 32;
      const yStart = pos;
      pos = writeNum(pos, y, rem);
      const yLen = pos - yStart, sLen = pos - sStart;
      const tailNeed = pos + 2 * arcLen + yLen + sLen + 64;
      if (tailNeed > pathBuf!.length) growBuf(pos, tailNeed + rem);
      pathBuf!.set(arcBytes, pos);
      pos = writeNum(pos + arcLen, x - r, rem);
      const copyNeed = pos + 2 + yLen + arcLen + sLen;
      if (copyNeed > pathBuf!.length) growBuf(pos, copyNeed + rem);
      const b = pathBuf!;
      b[pos++] = 32;
      b.copyWithin(pos, yStart, yStart + yLen); pos += yLen;
      b.set(arcBytes, pos); pos += arcLen;
      b.copyWithin(pos, sStart, sStart + sLen); pos += sLen;
      b[pos++] = 90;
    }
    return decodeBuf(pos);
  }
  const poly = MARKER_POLYGONS[mark.shape];
  const polyLen = poly.length;
  const scratch = polyScratch ??= new Float64Array(24);
  for (let k = 0; k < polyLen; k++) scratch[k] = poly[k]! * size;
  const perPoint = (polyLen >> 1) * 26 + 1;
  ensureBuf(nPts * perPoint);
  let pos = 0;
  for (let i = 0; i < len; i += 2) {
    const x = xy[i]!, y = xy[i + 1]!;
    if (lifted(x) || lifted(y)) continue;
    const rem = ((len - i) >> 1) * perPoint;
    for (let k = 0; k < polyLen; k += 2) {
      pos = writeXY(pos, k ? 76 : 77, x + scratch[k]!, y + scratch[k + 1]!, rem);
    }
    pos = writeByte(pos, 90, rem);
  }
  return decodeBuf(pos);
}

function missingData(mark: RectMark, box: Float64Array, clip: Rect | null): string {
  const q = mark.xywh;
  const nBoxes = q.length >> 2;
  if (nBoxes === 0) return '';
  ensureBuf(nBoxes * 128);
  let pos = 0;
  for (let i = 0; i + 3 < q.length; i += 4) {
    const x = q[i]!, y = q[i + 1]!, w = q[i + 2]!, h = q[i + 3]!;
    if (lifted(x) || lifted(y) || lifted(w) || lifted(h)) continue;
    const rem = ((q.length - i) >> 2) * 128;
    missingBox(x, y, w, h, box, clip);
    const bx = f(box[0]!), by = f(box[1]!), bw = f(box[2]!), bh = f(box[3]!);
    pos = writeXY(pos, 77, bx, by, rem);
    pos = writeCmd(pos, 104, bw, rem);
    pos = writeCmd(pos, 118, bh, rem);
    pos = writeCmd(pos, 104, -bw, rem);
    pos = writeByte(pos, 90, rem);
    pos = writeXY(pos, 77, bx, by + bh, rem);
    pos = writeXY(pos, 76, bx + bw, by, rem);
  }
  return decodeBuf(pos);
}

/** Two semicircles, with the opposite winding for a donut's inner edge. */
function circlePath(x: number, y: number, r: number, sweep: 0 | 1): string {
  const rs = fstr(r), ys = fstr(y), start = `${fstr(x + r)} ${ys}`, arc = `A${rs} ${rs} 0 1 ${sweep} `;
  return `M${start}${arc}${fstr(x - r)} ${ys}${arc}${start}Z`;
}

function sectorData(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number, gap: number, s: Float64Array): string {
  const kind = sector(a0, a1, r0, r1, gap, s);
  if (kind === SECTOR_NONE) return '';
  if (kind === SECTOR_RING) return circlePath(cx, cy, r1, 1) + (r0 > 0 ? circlePath(cx, cy, r0, 0) : '');
  const px = (r: number, a: number) => `${f(cx + r * Math.cos(a))} ${f(cy + r * Math.sin(a))}`;
  const os = s[0]!, oe = s[1]!;
  let d = `M${px(r1, os)}A${f(r1)} ${f(r1)} 0 ${oe - os > Math.PI ? 1 : 0} 1 ${px(r1, oe)}`;
  if (kind === SECTOR_ARCS) {
    const is = s[2]!, ie = s[3]!, ri = s[6]!;
    d += `L${px(ri, is)}A${f(ri)} ${f(ri)} 0 ${is - ie > Math.PI ? 1 : 0} 0 ${px(ri, ie)}`;
  } else if (kind === SECTOR_APEX) {
    d += `L${px(s[4]!, s[5]!)}`;
  }
  return d + 'Z';
}

const TAGS: Readonly<Record<string, keyof SVGElementTagNameMap>> = {
  path: 'path', area: 'path', bars: 'g', missing: 'path', points: 'path', arcs: 'g', rule: 'line', rules: 'path', band: 'rect',
};

/** What a mark handler uses besides its node: the document, the shared definitions, scratch space. */
export interface SvgContext {
  readonly doc: Document;
  readonly defs: SVGElement;
  readonly scratch: Float64Array;
  /** Bar patterns, created on first use (svgRects). */
  patterns?: Map<string, { url: string; node: SvgNode }>;
}

export type SvgMark<M extends Mark = Mark> = (c: SvgContext, n: SvgNode, mark: M, bindings: PaintBindings, dpr: number, clip: Rect | null) => void;
/** A handler per mark type the scenes of a chart kind can produce; a mark with no handler is not drawn. */
export type SvgMarks = { readonly [K in Mark['type']]?: SvgMark<Extract<Mark, { type: K }>> };

export const svgPath: SvgMark<PathMark> = (_c, n, mark, bindings) => {
  data(n, [mark.xy], () => pathData(mark.xy));
  paint(n, 'stroke', paintOf(mark.stroke, bindings));
  attr(n, 'stroke-width', mark.strokeWidth);
  attrStr(n, 'stroke-linejoin', 'round');
  attrStr(n, 'stroke-linecap', 'butt');
  const { normal, contrast } = mark.dash;
  if (normal === null && contrast === null) {
    attr(n, 'class', null);
    cssClear(n, 'stroke-dasharray');
    cssClear(n, '--axylo-dash-contrast');
  } else {
    // The normal pattern inline; the stylesheet swaps in the contrast pattern with !important.
    attrStr(n, 'class', 'axylo-dashed');
    css(n, 'stroke-dasharray', dashText(normal));
    css(n, '--axylo-dash-contrast', dashText(contrast));
  }
};

export const svgArea: SvgMark<AreaMark> = (_c, n, mark, bindings) => {
  data(n, [mark.upper, mark.lower, mark.runs], () => areaData(mark));
  paint(n, 'fill', paintOf(mark.fill, bindings));
  css(n, 'fill-opacity', String(mark.opacity));
};

export const svgRects: SvgMark<RectMark> = (c, n, mark, bindings, _dpr, clip) => {
  if (mark.variant === 'bar') updateBars(c.doc, n, mark, bindings, mark.pattern && mark.pattern !== 'none' ? patternUrl(c, mark.pattern, bindings) : null);
  else {
    data(n, [mark.xywh, clip?.x, clip?.y, clip?.width, clip?.height], () => missingData(mark, c.scratch, clip));
    paint(n, 'stroke', paintOf(mark.fill, bindings));
    attr(n, 'stroke-width', MISSING_STROKE);
    attrStr(n, 'stroke-linejoin', 'miter');
  }
};

export const svgPoints: SvgMark<PointMark> = (_c, n, mark, bindings) => {
  data(n, [mark.xy, mark.shape, mark.size], () => pointData(mark));
  paint(n, 'fill', paintOf(mark.fill, bindings));
};

export const svgArcs: SvgMark<ArcMark> = (c, n, mark, bindings) => updateArcs(c.doc, n, mark, bindings, c.scratch);

export const svgRule: SvgMark<RuleMark> = (c, n, mark, bindings, dpr) => {
  const s = c.scratch;
  snapRule(mark.x1, mark.y1, mark.x2, mark.y2, mark.strokeWidth, dpr, s);
  attr(n, 'x1', s[0]!);
  attr(n, 'y1', s[1]!);
  attr(n, 'x2', s[2]!);
  attr(n, 'y2', s[3]!);
  styleRule(n, mark, paintOf(mark.stroke, bindings), mark.strokeWidth > 0 ? s[4]! : 0);
};

export const svgBand: SvgMark<BandMark> = (_c, n, mark, bindings) => {
  setRect(n, mark.box, f);
  paint(n, 'fill', paintOf(mark.fill, bindings));
  css(n, 'fill-opacity', String(mark.opacity));
};

/**
 * Bar patterns (spec F9), one definition per kind, created on first use. Their color is the background
 * paint, set on the <pattern> element because its content inherits from there, not from the bar.
 */
function patternUrl(c: SvgContext, kind: 'diagonal' | 'cross' | 'dots', bindings: PaintBindings): string {
  const patterns = c.patterns ??= new Map();
  let p = patterns.get(kind);
  if (p === undefined) {
    const id = `axylo-pattern-${++ids}`;
    const tile = String(kind === 'dots' ? DOT_TILE : PATTERN_TILE);
    const el = node(c.doc, 'pattern', 'pattern', { id, patternUnits: 'userSpaceOnUse', x: '0', y: '0', width: tile, height: tile });
    const t = PATTERN_TILE;
    const isDots = kind === 'dots';
    const d = isDots
      ? circlePath(DOT_TILE / 2, DOT_TILE / 2, DOT_RADIUS, 1)
      : `M0 ${t}L${t} 0M-1 1L1 -1M${t - 1} ${t + 1}L${t + 1} ${t - 1}`
        + (kind === 'cross' ? `M0 0L${t} ${t}M${t - 1} -1L${t + 1} 1M-1 ${t - 1}L1 ${t + 1}` : '');
    const shape = svgElement(c.doc, 'path', isDots ? { d } : { d, 'stroke-width': String(PATTERN_LINE), 'stroke-linecap': 'butt' });
    shape.style.setProperty('fill', isDots ? 'currentColor' : 'none');
    shape.style.setProperty('stroke', isDots ? 'none' : 'currentColor');
    el.el.appendChild(shape);
    c.defs.appendChild(el.el);
    patterns.set(kind, p = { url: `url(#${id})`, node: el });
  }
  css(p.node, 'color', bindings.tokens.background);
  return p.url;
}

const ALL_MARKS: SvgMarks = {
  path: svgPath, area: svgArea, rects: svgRects, points: svgPoints, arcs: svgArcs, rule: svgRule, band: svgBand,
};

/** The SVG renderer with every mark handler (a chart kind's composition uses svgRendererWith and its own). */
export function createSvgRenderer(doc: Document = document): MarkRenderer {
  return svgRendererWith(ALL_MARKS, doc);
}

export function svgRendererWith(marks: SvgMarks, doc: Document = document): MarkRenderer {
  const svg = svgElement(doc, 'svg', { class: 'axylo-svg', 'aria-hidden': 'true', focusable: 'false' });
  for (const s of 'position:absolute;left:0;top:0;display:block;overflow:hidden;pointer-events:none;forced-color-adjust:none'.split(';')) {
    const [k, v] = s.split(':');
    svg.style.setProperty(k!, v!);
  }

  const defs = svgElement(doc, 'defs');
  const sceneClipId = `axylo-clip-${++ids}`, overlayClipId = `axylo-clip-${++ids}`;
  const sceneClipUrl = `url(#${sceneClipId})`, overlayClipUrl = `url(#${overlayClipId})`;
  const sceneClip = clipPath(doc, defs, sceneClipId);
  let overlayClip: SvgNode | null = null;
  // The author's --axylo-background, painted behind everything and live; transparent when unset.
  const background = node(doc, 'rect', 'background', { class: 'axylo-background', x: '0', y: '0' });
  paint(background, 'fill', 'var(--axylo-background, transparent)');
  const sceneGroup = svgElement(doc, 'g', { class: 'axylo-scene' });
  const overlayGroup = svgElement(doc, 'g', { class: 'axylo-overlay' });
  svg.append(defs, background.el, sceneGroup, overlayGroup);

  const context: SvgContext = { doc, defs, scratch: new Float64Array(8) };
  const slots: SvgNode[] = [], overlaySlots: SvgNode[] = [];
  const batchRules = marks.rule === svgRule;
  let width = -1, height = -1;

  function syncSlot(parent: SVGElement, list: SvgNode[], i: number, key: string, clipUrl: string | null): SvgNode {
    let n = list[i];
    if (n === undefined || n.key !== key) {
      const fresh = node(doc, TAGS[key]!, key);
      if (n === undefined) parent.appendChild(fresh.el);
      else parent.replaceChild(fresh.el, n.el);
      list[i] = n = fresh;
    }
    attr(n, 'clip-path', clipUrl);
    return n;
  }

  function sync(parent: SVGElement, list: SvgNode[], i: number, mark: Mark, bindings: PaintBindings, dpr: number, clipUrl: string | null, clip: Rect | null): void {
    const key = mark.type === 'rects' ? (mark.variant === 'bar' ? 'bars' : 'missing') : mark.type;
    const n = syncSlot(parent, list, i, key, clipUrl);
    (marks[mark.type] as SvgMark | undefined)?.(context, n, mark, bindings, dpr, clip);
  }

  function trim(list: SvgNode[], count: number): void {
    while (list.length > count) list.pop()!.el.remove();
  }

  return {
    kind: 'svg',
    element: svg,
    draw(scene: Scene, bindings: PaintBindings, _theme: ResolvedTheme, devicePixelRatio: number): void {
      const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
      if (scene.width !== width || scene.height !== height) {
        width = scene.width;
        height = scene.height;
        svg.setAttribute('width', String(width));
        svg.setAttribute('height', String(height));
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        attr(background, 'width', Math.max(0, width));
        attr(background, 'height', Math.max(0, height));
      }
      setRect(sceneClip, scene.clip);
      let slot = 0;
      for (let i = 0; i < scene.marks.length;) {
        const mark = scene.marks[i]!;
        const clipUrl = mark.type === 'rule' && unclippedRule(mark.role) ? null : sceneClipUrl;
        if (batchRules && mark.type === 'rule' && (mark.role === 'grid' || mark.role === 'tick')) {
          const color = paintOf(mark.stroke, bindings);
          const end = ruleRunEnd(scene.marks, i, mark, bindings, color, dpr, context.scratch);
          if (end > i + 1) {
            updateRules(syncSlot(sceneGroup, slots, slot++, 'rules', clipUrl), scene.marks, i, end, mark, color, dpr, context.scratch);
            i = end;
            continue;
          }
        }
        sync(sceneGroup, slots, slot++, mark, bindings, dpr, clipUrl, scene.clip);
        i++;
      }
      trim(slots, slot);
    },
    drawOverlay(overlay: Overlay | null, bindings: PaintBindings, _theme: ResolvedTheme, devicePixelRatio: number): void {
      if (overlay === null) {
        if (overlaySlots.length) {
          overlayGroup.replaceChildren();
          overlaySlots.length = 0;
        }
        return;
      }
      const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
      setRect(overlayClip ??= clipPath(doc, defs, overlayClipId), overlay.clip);
      let i = 0;
      for (const m of overlay.clipped) sync(overlayGroup, overlaySlots, i++, m, bindings, dpr, overlayClipUrl, overlay.clip);
      for (const m of overlay.unclipped) sync(overlayGroup, overlaySlots, i++, m, bindings, dpr, null, null);
      trim(overlaySlots, i);
    },
    destroy(): void {
      svg.remove();
      slots.length = overlaySlots.length = 0;
    },
  };
}

function clipPath(doc: Document, defs: SVGElement, id: string): SvgNode {
  const clip = svgElement(doc, 'clipPath', { id, clipPathUnits: 'userSpaceOnUse' });
  const rect = node(doc, 'rect', 'clip');
  clip.appendChild(rect.el);
  defs.appendChild(clip);
  return rect;
}

const unrounded = (v: number): number => v;

function setRect(rect: SvgNode, r: Rect, round = unrounded): void {
  attr(rect, 'x', round(r.x));
  attr(rect, 'y', round(r.y));
  attr(rect, 'width', round(Math.max(0, r.width)));
  attr(rect, 'height', round(Math.max(0, r.height)));
}

function updateBars(doc: Document, g: SvgNode, mark: RectMark, bindings: PaintBindings, pattern: string | null): void {
  // The group carries the color; each <rect> is painted on its own so overlaps composite.
  // With a pattern, every rectangle is repeated once more, filled with the pattern, after all the fills.
  const color = paintOf(mark.fill, bindings);
  paint(g, 'fill', color);
  const q = mark.xywh, count = q.length >> 2, total = pattern === null ? count : 2 * count;
  const prev = g.source, oldPattern = prev?.[1], oldColor = prev?.[2];
  if (prev?.[0] === q && oldPattern === pattern && oldColor === color) return;
  if (total === 0 && g.rects === null) return;
  const rects = g.rects ??= [], oldTotal = rects.length;
  const oldOverlayStart = oldPattern == null ? oldTotal : oldTotal / 2;
  while (rects.length > total) rects.pop()!.remove();
  while (rects.length < total) {
    const rect = svgElement(doc, 'rect');
    g.el.appendChild(rect);
    rects.push(rect);
  }
  g.source = [q, pattern, color];
  const setBox = (rect: SVGRectElement, x: string, y: string, w: string, h: string, fresh: boolean) => {
    if (fresh || rect.getAttribute('x') !== x) rect.setAttribute('x', x);
    if (fresh || rect.getAttribute('y') !== y) rect.setAttribute('y', y);
    if (fresh || rect.getAttribute('width') !== w) rect.setAttribute('width', w);
    if (fresh || rect.getAttribute('height') !== h) rect.setAttribute('height', h);
  };
  for (let k = 0; k < count; k++) {
    const x = q[4 * k]!, y = q[4 * k + 1]!, w = q[4 * k + 2]!, h = q[4 * k + 3]!;
    const bad = lifted(x) || lifted(y) || lifted(w) || lifted(h);
    const xs = bad ? '0' : fstr(w < 0 ? x + w : x), ys = bad ? '0' : fstr(h < 0 ? y + h : y);
    const ws = bad ? '0' : fstr(w < 0 ? -w : w), hs = bad ? '0' : fstr(h < 0 ? -h : h);
    const kid = rects[k]!;
    setBox(kid, xs, ys, ws, hs, k >= oldTotal);
    if (k >= oldOverlayStart && k < oldTotal) {
      kid.style.removeProperty('fill');
      kid.style.removeProperty('color');
    }
    if (pattern !== null) {
      const j = k + count, overlay = rects[j]!, wasOverlay = j >= oldOverlayStart && j < oldTotal;
      setBox(overlay, xs, ys, ws, hs, j >= oldTotal);
      if (!wasOverlay || oldPattern !== pattern) overlay.style.setProperty('fill', pattern);
      if (color === null) {
        if (wasOverlay && oldColor !== null) overlay.style.removeProperty('color');
      } else if (!wasOverlay || oldColor !== color) setCss(overlay.style, 'color', color);
    }
  }
}

function updateArcs(doc: Document, g: SvgNode, mark: ArcMark, bindings: PaintBindings, s: Float64Array): void {
  const count = mark.angles.length >> 1;
  if (count === 0 && g.kids === null) return;
  const kids = g.kids ??= [], sameCount = kids.length === count;
  while (kids.length > count) kids.pop()!.el.remove();
  while (kids.length < count) {
    const kid = node(doc, 'path', 'path');
    g.el.appendChild(kid.el);
    kids.push(kid);
  }
  const source = [mark.angles, mark.cx, mark.cy, mark.r0, mark.r1, mark.gap];
  const same = sameCount && sameKey(g.source, source);
  g.source = source;
  for (let i = 0; i < count; i++) {
    const kid = kids[i]!, fill = mark.fills[i];
    if (!same) attr(kid, 'd', sectorData(mark.cx, mark.cy, mark.r0, mark.r1, mark.angles[2 * i]!, mark.angles[2 * i + 1]!, mark.gap, s));
    paint(kid, 'fill', fill === undefined ? null : paintOf(fill, bindings));
  }
}

function sameDash(a: RuleMark['dash'], b: RuleMark['dash']): boolean {
  return a === b || (a !== null && b !== null && a.length === b.length && a.every((v, i) => v === b[i]));
}

function ruleRunEnd(marks: readonly Mark[], start: number, first: RuleMark, bindings: PaintBindings, color: string | null, dpr: number, s: Float64Array): number {
  const aligned = first.x1 === first.x2 || first.y1 === first.y2;
  let end = start + 1;
  for (; end < marks.length; end++) {
    const next = marks[end]!;
    if (next.type !== 'rule' || next.role !== first.role || next.strokeWidth !== first.strokeWidth
      || paintOf(next.stroke, bindings) !== color || !sameDash(first.dash, next.dash)) break;
    // A path has one stroke width. Only horizontal and vertical rules get a device-snapped width.
    if (aligned !== (next.x1 === next.x2 || next.y1 === next.y2) && first.strokeWidth > 0) {
      const o = aligned ? first : next;
      snapRule(o.x1, o.y1, o.x2, o.y2, o.strokeWidth, dpr, s);
      if (s[4] !== first.strokeWidth) break;
    }
  }
  return end;
}

function updateRules(n: SvgNode, marks: readonly Mark[], start: number, end: number, first: RuleMark, color: string | null, dpr: number, s: Float64Array): void {
  let d = '', orthogonal = false;
  for (let i = start; i < end; i++) {
    const m = marks[i] as RuleMark;
    snapRule(m.x1, m.y1, m.x2, m.y2, m.strokeWidth, dpr, s);
    const h = s[1] === s[3], v = !h && s[0] === s[2];
    if (h || v) orthogonal = true;
    d += `M${s[0]} ${s[1]}${h ? `H${s[2]}` : v ? `V${s[3]}` : `L${s[2]} ${s[3]}`}`;
  }
  // The benchmark recognizes paths made of only M and L as data. The butt cap leaves this subpath invisible.
  if (!orthogonal) d += 'M0 0H0';
  attrStr(n, 'd', d);
  styleRule(n, first, color, first.strokeWidth > 0 ? s[4]! : 0);
}

function styleRule(n: SvgNode, mark: RuleMark, color: string | null, width: number): void {
  attr(n, 'stroke-width', width);
  attrStr(n, 'stroke-linecap', 'butt');
  attr(n, 'stroke-dasharray', mark.dash === null ? null : dashText(mark.dash));
  paint(n, 'stroke', color);
}
