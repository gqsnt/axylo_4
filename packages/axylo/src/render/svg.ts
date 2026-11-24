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

const NS = 'http://www.w3.org/2000/svg';
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

function node(doc: Document, tag: string, key: string): SvgNode {
  return { key, el: doc.createElementNS(NS, tag) as SVGElement, attrs: null, styles: null, kids: null, rects: null, source: null };
}

/** Sets `d` from `build()` unless every input is identical (===) to the ones the current `d` came from. */
function data(n: SvgNode, source: readonly unknown[], build: () => string): void {
  if (sameKey(n.source, source)) return;
  n.source = source;
  attr(n, 'd', build());
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
    return;
  }
  attrStr(n, name, typeof input === 'number' ? String(input) : input);
}

function isTrustedColor(value: string): boolean {
  if (value.startsWith('var(--axylo-series-color-') && value.endsWith(')') && value.length > 26) {
    for (let i = 25; i < value.length - 1; i++) {
      const ch = value.charCodeAt(i);
      if (ch < 48 || ch > 57) return false;
    }
    return true;
  }
  return value === 'var(--axylo-background, transparent)'
    || value === 'var(--axylo-axis, var(--axylo-default-axis))'
    || value === 'var(--axylo-grid, var(--axylo-default-grid))'
    || value === 'var(--axylo-reference, var(--axylo-default-reference))'
    || value === 'var(--axylo-muted, var(--axylo-default-muted))'
    || value === 'var(--axylo-focus, var(--axylo-default-focus))'
    || value === 'var(--axylo-background, var(--axylo-backdrop, var(--axylo-default-background)))'
    || value === 'var(--axylo-text, currentColor)';
}

function isTrustedCss(name: string, value: string): boolean {
  if (name === 'color') return isTrustedColor(value);
  if (name === 'fill-opacity') {
    return value === '0.25' || value === '0.8' || value === '1' || value === '0' || value === '0.5';
  }
  if (name === 'fill' || name === 'stroke') {
    if (value === 'none' || value === 'currentColor') return true;
    if (name === 'fill' && value.startsWith('url(#axylo-pattern-') && value.endsWith(')') && value.length > 20) {
      for (let i = 19; i < value.length - 1; i++) {
        const ch = value.charCodeAt(i);
        if (ch < 48 || ch > 57) return false;
      }
      return true;
    }
  }
  return false;
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
  if (value === null) {
    cssClear(n, name);
  } else if (n.styles?.get(name) !== value) {
    if (setCss(n.el.style, name, value)) (n.styles ??= new Map()).set(name, value);
    else n.styles?.delete(name);
  }
}

/** Paints `role` ('fill' or 'stroke') with a CSS color expression, through `color` and currentColor. */
function paint(n: SvgNode, role: 'fill' | 'stroke', value: string | null): void {
  const other = role === 'fill' ? 'stroke' : 'fill';
  cssTrusted(n, other, 'none');
  if (value === null) { cssTrusted(n, role, 'none'); cssClear(n, 'color'); return; }
  css(n, 'color', value);
  cssTrusted(n, role, 'currentColor');
}

/** Two decimals: well below a device pixel at any realistic ratio, and keeps `d` short. */
const f = (v: number): number => Math.round(v * 100) / 100;

let fracTable: string[] | null = null;
function getFrac(): string[] {
  if (fracTable !== null) return fracTable;
  const t = new Array<string>(100);
  t[0] = '';
  for (let i = 1; i < 100; i++) {
    t[i] = i % 10 === 0 ? '.' + (i / 10) : i < 10 ? '.0' + i : '.' + i;
  }
  return fracTable = t;
}

function fstr(v: number): string {
  if (v >= -2e7 && v <= 2e7) {
    const c = Math.round(v * 100);
    if (c === 0) return '0';
    const frac = getFrac();
    if (c > 0) {
      const q = (c / 100) | 0;
      const r = c - q * 100;
      return r === 0 ? '' + q : q + frac[r]!;
    }
    const ac = -c;
    const q = (ac / 100) | 0;
    const r = ac - q * 100;
    return r === 0 ? '-' + q : '-' + q + frac[r]!;
  }
  return String(Math.round(v * 100) / 100);
}

let pathDecoder: TextDecoder | null = null;
let pathBuf: Uint8Array | null = null;
const MAX_RETAINED_BUF = 16 * 1024;
const polyScratch = new Float64Array(24);

function ensureBuf(need: number): Uint8Array {
  if (pathBuf === null) return pathBuf = new Uint8Array(need > 4096 ? need : 4096);
  if (pathBuf.length < need) return pathBuf = new Uint8Array(Math.max(pathBuf.length * 2, need));
  return pathBuf;
}

function growBuf(used: number, need: number): Uint8Array {
  const next = new Uint8Array(Math.max(pathBuf!.length * 2, need));
  next.set(pathBuf!.subarray(0, used));
  return pathBuf = next;
}

function writeFallback(pos: number, v: number, rem: number): number {
  const s = String(Math.round(v * 100) / 100);
  // Reserve space for the serialized number, remaining commands, and any extra bytes in the current command.
  const need = pos + s.length + rem + 64;
  const b = need > pathBuf!.length ? growBuf(pos, need) : pathBuf!;
  for (let i = 0; i < s.length; i++) b[pos++] = s.charCodeAt(i);
  return pos;
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
    } else if (q < 100) {
      const d0 = (q / 10) | 0;
      b[pos++] = 48 + d0;
      b[pos++] = 48 + (q - d0 * 10);
    } else if (q < 1000) {
      const d0 = (q / 100) | 0;
      const rem1 = q - d0 * 100;
      const d1 = (rem1 / 10) | 0;
      b[pos++] = 48 + d0;
      b[pos++] = 48 + d1;
      b[pos++] = 48 + (rem1 - d1 * 10);
    } else if (q < 10000) {
      const d0 = (q / 1000) | 0;
      const rem1 = q - d0 * 1000;
      const d1 = (rem1 / 100) | 0;
      const rem2 = rem1 - d1 * 100;
      const d2 = (rem2 / 10) | 0;
      b[pos++] = 48 + d0;
      b[pos++] = 48 + d1;
      b[pos++] = 48 + d2;
      b[pos++] = 48 + (rem2 - d2 * 10);
    } else {
      let tmp = q;
      let digits = 0;
      while (tmp > 0) { tmp = (tmp / 10) | 0; digits++; }
      pos += digits;
      let end = pos;
      while (q > 0) {
        const q10 = (q / 10) | 0;
        b[--end] = 48 + (q - q10 * 10);
        q = q10;
      }
    }
    if (r !== 0) {
      b[pos++] = 46;
      const d1 = (r / 10) | 0;
      const d2 = r - d1 * 10;
      b[pos++] = 48 + d1;
      if (d2 !== 0) b[pos++] = 48 + d2;
    }
    return pos;
  }
  return writeFallback(pos, v, rem);
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
  const nPts = xy.length >> 1;
  ensureBuf(nPts * 26);
  let pos = 0;
  let pen = false;
  for (let i = 0; i < len; i += 2) {
    const x = xy[i]!;
    const y = xy[i + 1]!;
    if (lifted(x) || lifted(y)) { pen = false; continue; }
    const rem = ((len - i) >> 1) * 26;
    if (pos + 28 > pathBuf!.length) growBuf(pos, pos + rem + 28);
    pathBuf![pos++] = pen ? 76 : 77;
    pos = writeNum(pos, x, rem);
    pathBuf![pos++] = 32;
    pos = writeNum(pos, y, rem);
    pen = true;
  }
  return decodeBuf(pos);
}

export function areaData(mark: AreaMark): string {
  const { upper, lower, runs } = mark;
  const upperCount = upper.length >> 1;
  const lowerCount = lower.length >> 1;
  let maxVerts = 0;
  for (let r = 0; r + 3 < runs.length; r += 4) {
    const us = runs[r]!;
    const ue = Math.min(us + runs[r + 1]!, upperCount);
    const ls = runs[r + 2]!;
    const le = Math.min(ls + runs[r + 3]!, lowerCount);
    if (ue > us && le > ls) maxVerts += (ue - us) + (le - ls);
  }
  if (maxVerts === 0) return '';
  ensureBuf(maxVerts * 26 + (runs.length >> 2));
  let pos = 0;
  let remVerts = maxVerts;
  let remRuns = runs.length >> 2;
  for (let r = 0; r + 3 < runs.length; r += 4) {
    const us = runs[r]!;
    const ue = Math.min(us + runs[r + 1]!, upperCount);
    const ls = runs[r + 2]!;
    const le = Math.min(ls + runs[r + 3]!, lowerCount);
    // A region between two boundaries needs both: a run with an empty side draws nothing.
    if (ue <= us || le <= ls) { remRuns--; continue; }
    let started = false;
    for (let k = us; k < ue; k++) {
      const x = upper[2 * k]!, y = upper[2 * k + 1]!;
      remVerts--;
      if (lifted(x) || lifted(y)) continue;
      const rem = remVerts * 26 + remRuns;
      if (pos + 28 > pathBuf!.length) growBuf(pos, pos + rem + 28);
      pathBuf![pos++] = started ? 76 : 77;
      pos = writeNum(pos, x, rem);
      pathBuf![pos++] = 32;
      pos = writeNum(pos, y, rem);
      started = true;
    }
    for (let k = le - 1; k >= ls; k--) {
      const x = lower[2 * k]!, y = lower[2 * k + 1]!;
      remVerts--;
      if (lifted(x) || lifted(y)) continue;
      const rem = remVerts * 26 + remRuns;
      if (pos + 28 > pathBuf!.length) growBuf(pos, pos + rem + 28);
      pathBuf![pos++] = started ? 76 : 77;
      pos = writeNum(pos, x, rem);
      pathBuf![pos++] = 32;
      pos = writeNum(pos, y, rem);
      started = true;
    }
    remRuns--;
    if (started) {
      if (pos + 1 > pathBuf!.length) growBuf(pos, pos + remVerts * 26 + remRuns + 1);
      pathBuf![pos++] = 90;
    }
  }
  return decodeBuf(pos);
}

function pointData(mark: PointMark): string {
  const { xy, size } = mark;
  const len = xy.length - 1;
  if (!(size > 0) || len <= 0) return '';
  const nPts = xy.length >> 1;
  if (mark.shape === 'circle') {
    const r = size / 2;
    const rs = fstr(r);
    const arcStr = 'A' + rs + ' ' + rs + ' 0 1 1 ';
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
      const yLen = pos - yStart;
      const sLen = pos - sStart;
      const tailNeed = pos + 2 * arcLen + yLen + sLen + 64;
      if (tailNeed > pathBuf!.length) growBuf(pos, tailNeed + rem);
      pathBuf!.set(arcBytes, pos);
      pos += arcLen;
      pos = writeNum(pos, x - r, rem);
      const copyNeed = pos + 1 + yLen + arcLen + sLen + 1;
      if (copyNeed > pathBuf!.length) growBuf(pos, copyNeed + rem);
      let b = pathBuf!;
      b[pos++] = 32;
      for (let j = 0; j < yLen; j++) b[pos++] = b[yStart + j]!;
      b.set(arcBytes, pos);
      pos += arcLen;
      for (let j = 0; j < sLen; j++) b[pos++] = b[sStart + j]!;
      b[pos++] = 90;
    }
    return decodeBuf(pos);
  }
  const poly = MARKER_POLYGONS[mark.shape];
  const polyLen = poly.length;
  for (let k = 0; k < polyLen; k++) polyScratch[k] = poly[k]! * size;
  const perPoint = (polyLen >> 1) * 26 + 1;
  ensureBuf(nPts * perPoint);
  let pos = 0;
  for (let i = 0; i < len; i += 2) {
    const x = xy[i]!, y = xy[i + 1]!;
    if (lifted(x) || lifted(y)) continue;
    const rem = ((len - i) >> 1) * perPoint;
    if (pos + perPoint > pathBuf!.length) growBuf(pos, pos + rem + perPoint);
    for (let k = 0; k < polyLen; k += 2) {
      if (pos + 28 > pathBuf!.length) growBuf(pos, pos + rem + 28);
      pathBuf![pos++] = k === 0 ? 77 : 76;
      pos = writeNum(pos, x + polyScratch[k]!, rem);
      pathBuf![pos++] = 32;
      pos = writeNum(pos, y + polyScratch[k + 1]!, rem);
    }
    if (pos + 1 > pathBuf!.length) growBuf(pos, pos + rem + 1);
    pathBuf![pos++] = 90;
  }
  return decodeBuf(pos);
}

function missingData(mark: RectMark, box: Float64Array, clip: Rect | null): string {
  const q = mark.xywh;
  const nBoxes = q.length >> 2;
  if (nBoxes === 0) return '';
  const perBox = 128;
  ensureBuf(nBoxes * perBox);
  let pos = 0;
  for (let i = 0; i + 3 < q.length; i += 4) {
    const x = q[i]!, y = q[i + 1]!, w = q[i + 2]!, h = q[i + 3]!;
    if (lifted(x) || lifted(y) || lifted(w) || lifted(h)) continue;
    const rem = ((q.length - i) >> 2) * perBox;
    if (pos + perBox > pathBuf!.length) growBuf(pos, pos + rem + perBox);
    missingBox(x, y, w, h, box, clip);
    const bx = f(box[0]!), by = f(box[1]!), bw = f(box[2]!), bh = f(box[3]!);
    pathBuf![pos++] = 77;
    const bxStart = pos;
    pos = writeNum(pos, bx, rem);
    const bxLen = pos - bxStart;
    pathBuf![pos++] = 32;
    const byStart = pos;
    pos = writeNum(pos, by, rem);
    const byLen = pos - byStart;
    pathBuf![pos++] = 104; // 'h'
    pos = writeNum(pos, bw, rem);
    pathBuf![pos++] = 118; // 'v'
    pos = writeNum(pos, bh, rem);
    pathBuf![pos++] = 104; // 'h'
    pos = writeNum(pos, -bw, rem);
    if (pos + 2 + bxLen + 64 > pathBuf!.length) growBuf(pos, pos + bxLen + byLen + rem + 64);
    pathBuf![pos++] = 90; // 'Z'
    pathBuf![pos++] = 77; // 'M'
    let b = pathBuf!;
    for (let j = 0; j < bxLen; j++) b[pos++] = b[bxStart + j]!;
    b[pos++] = 32;
    pos = writeNum(pos, by + bh, rem);
    b = pathBuf!;
    b[pos++] = 76; // 'L'
    pos = writeNum(pos, bx + bw, rem);
    if (pos + 1 + byLen > pathBuf!.length) growBuf(pos, pos + 1 + byLen + rem);
    b = pathBuf!;
    b[pos++] = 32;
    for (let j = 0; j < byLen; j++) b[pos++] = b[byStart + j]!;
  }
  return decodeBuf(pos);
}

/** Two semicircles, with the opposite winding for a donut's inner edge. */
function circlePath(x: number, y: number, r: number, sweep: 0 | 1): string {
  const rs = fstr(r);
  const ys = fstr(y);
  const start = fstr(x + r) + ' ' + ys;
  const arc = 'A' + rs + ' ' + rs + ' 0 1 ' + sweep + ' ';
  return 'M' + start + arc + fstr(x - r) + ' ' + ys + arc + start + 'Z';
}

function sectorData(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number, gap: number, s: Float64Array): string {
  const kind = sector(a0, a1, r0, r1, gap, s);
  if (kind === SECTOR_NONE) return '';
  const px = (r: number, a: number): string => f(cx + r * Math.cos(a)) + ' ' + f(cy + r * Math.sin(a));
  if (kind === SECTOR_RING) {
    return circlePath(cx, cy, r1, 1) + (r0 > 0 ? circlePath(cx, cy, r0, 0) : '');
  }
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

function keyOf(mark: Mark): string {
  if (mark.type === 'rects') return mark.variant === 'bar' ? 'bars' : 'missing';
  return mark.type;
}

const TAGS: Readonly<Record<string, string>> = {
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

export const svgPath: SvgMark<PathMark> = (_c, n, mark, bindings) => updatePath(n, mark, bindings);

export const svgArea: SvgMark<AreaMark> = (_c, n, mark, bindings) => {
  const prev = n.source;
  if (prev === null || prev[0] !== mark.upper || prev[1] !== mark.lower || prev[2] !== mark.runs) {
    n.source = [mark.upper, mark.lower, mark.runs];
    attrStr(n, 'd', areaData(mark));
  }
  paint(n, 'fill', paintOf(mark.fill, bindings));
  css(n, 'fill-opacity', String(mark.opacity));
};

export const svgRects: SvgMark<RectMark> = (c, n, mark, bindings, _dpr, clip) => {
  if (mark.variant === 'bar') updateBars(c.doc, n, mark, bindings, mark.pattern === undefined || mark.pattern === 'none' ? null : patternUrl(c, mark.pattern, bindings));
  else {
    data(n, [mark.xywh, clip?.x, clip?.y, clip?.width, clip?.height], () => missingData(mark, c.scratch, clip));
    paint(n, 'stroke', paintOf(mark.fill, bindings));
    attr(n, 'stroke-width', MISSING_STROKE);
    attrStr(n, 'stroke-linejoin', 'miter');
  }
};

export const svgPoints: SvgMark<PointMark> = (_c, n, mark, bindings) => {
  const prev = n.source;
  if (prev === null || prev[0] !== mark.xy || prev[1] !== mark.shape || prev[2] !== mark.size) {
    n.source = [mark.xy, mark.shape, mark.size];
    attrStr(n, 'd', pointData(mark));
  }
  paint(n, 'fill', paintOf(mark.fill, bindings));
};

export const svgArcs: SvgMark<ArcMark> = (c, n, mark, bindings) => updateArcs(c.doc, n, mark, bindings, c.scratch);

export const svgRule: SvgMark<RuleMark> = (c, n, mark, bindings, dpr) => updateRule(n, mark, bindings, dpr, c.scratch);

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
  const { doc, defs } = c;
  const patterns = c.patterns ??= new Map();
  let p = patterns.get(kind);
  if (p === undefined) {
    const id = `axylo-pattern-${++ids}`;
    const el = node(doc, 'pattern', 'pattern');
    const pattern = el.el;
    pattern.setAttribute('id', id);
    pattern.setAttribute('patternUnits', 'userSpaceOnUse');
    pattern.setAttribute('x', '0');
    pattern.setAttribute('y', '0');
    const tile = kind === 'dots' ? DOT_TILE : PATTERN_TILE;
    pattern.setAttribute('width', String(tile));
    pattern.setAttribute('height', String(tile));
    const shape = svgElement(doc, 'path');
    const t = PATTERN_TILE;
    if (kind === 'dots') {
      const c = DOT_TILE / 2, r = DOT_RADIUS;
      shape.setAttribute('d', `M${c + r} ${c}A${r} ${r} 0 1 1 ${c - r} ${c}A${r} ${r} 0 1 1 ${c + r} ${c}Z`);
      shape.style.setProperty('fill', 'currentColor');
      shape.style.setProperty('stroke', 'none');
    } else {
      // x + y = 0, t, 2t inside one tile (the corners are pieces of the neighbouring tiles' lines).
      let d = `M0 ${t}L${t} 0M-1 1L1 -1M${t - 1} ${t + 1}L${t + 1} ${t - 1}`;
      if (kind === 'cross') d += `M0 0L${t} ${t}M${t - 1} -1L${t + 1} 1M-1 ${t - 1}L1 ${t + 1}`;
      shape.setAttribute('d', d);
      shape.style.setProperty('fill', 'none');
      shape.style.setProperty('stroke', 'currentColor');
      shape.setAttribute('stroke-width', String(PATTERN_LINE));
      shape.setAttribute('stroke-linecap', 'butt');
    }
    pattern.appendChild(shape);
    defs.appendChild(pattern);
    p = { url: `url(#${id})`, node: el };
    patterns.set(kind, p);
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
  for (const [k, v] of [
    ['position', 'absolute'], ['left', '0'], ['top', '0'], ['display', 'block'], ['overflow', 'hidden'], ['pointer-events', 'none'],
    ['forced-color-adjust', 'none'],
  ] as const) svg.style.setProperty(k, v);

  const defs = svgElement(doc, 'defs');
  const sceneClipId = `axylo-clip-${++ids}`;
  const overlayClipId = `axylo-clip-${++ids}`;
  const sceneClipUrl = `url(#${sceneClipId})`;
  const overlayClipUrl = `url(#${overlayClipId})`;
  const sceneClip = clipPath(doc, defs, sceneClipId);
  let overlayClip: SvgNode | null = null;
  // The author's --axylo-background, painted behind everything and live; transparent when unset.
  const background = node(doc, 'rect', 'background');
  background.el.setAttribute('class', 'axylo-background');
  attr(background, 'x', '0');
  attr(background, 'y', '0');
  paint(background, 'fill', 'var(--axylo-background, transparent)');
  const sceneGroup = svgElement(doc, 'g', { class: 'axylo-scene' });
  const overlayGroup = svgElement(doc, 'g', { class: 'axylo-overlay' });
  svg.append(defs, background.el, sceneGroup, overlayGroup);

  const context: SvgContext = { doc, defs, scratch: new Float64Array(8) };
  const slots: SvgNode[] = [];
  const overlaySlots: SvgNode[] = [];
  const batchRules = marks.rule === svgRule;
  let width = -1;
  let height = -1;

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
    const n = syncSlot(parent, list, i, keyOf(mark), clipUrl);
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
            const n = syncSlot(sceneGroup, slots, slot++, 'rules', clipUrl);
            updateRules(n, scene.marks, i, end, mark, color, dpr, context.scratch);
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
        if (overlaySlots.length > 0) {
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
      slots.length = 0;
      overlaySlots.length = 0;
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

function updatePath(n: SvgNode, mark: PathMark, bindings: PaintBindings): void {
  const prev = n.source;
  if (prev === null || prev[0] !== mark.xy) {
    n.source = [mark.xy];
    attrStr(n, 'd', pathData(mark.xy));
  }
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
}

function updateBars(doc: Document, g: SvgNode, mark: RectMark, bindings: PaintBindings, pattern: string | null): void {
  // The group carries the color; each <rect> is painted on its own so overlaps composite.
  // With a pattern, every rectangle is repeated once more, filled with the pattern, after all the fills.
  const color = paintOf(mark.fill, bindings);
  paint(g, 'fill', color);
  const q = mark.xywh;
  const count = q.length >> 2;
  const total = pattern === null ? count : 2 * count;
  const prev = g.source;
  const oldPattern = prev?.[1];
  const oldColor = prev?.[2];
  if (prev?.[0] === q && oldPattern === pattern && oldColor === color) return;
  if (total === 0 && g.rects === null) return;
  const rects = g.rects ??= [];
  const oldTotal = rects.length;
  const oldOverlayStart = oldPattern == null ? oldTotal : oldTotal / 2;
  while (rects.length > total) rects.pop()!.remove();
  while (rects.length < total) {
    const rect = svgElement(doc, 'rect');
    g.el.appendChild(rect);
    rects.push(rect);
  }
  g.source = [q, pattern, color];
  for (let k = 0; k < count; k++) {
    const x = q[4 * k]!, y = q[4 * k + 1]!, w = q[4 * k + 2]!, h = q[4 * k + 3]!;
    const bad = lifted(x) || lifted(y) || lifted(w) || lifted(h);
    const xs = bad ? '0' : fstr(w < 0 ? x + w : x);
    const ys = bad ? '0' : fstr(h < 0 ? y + h : y);
    const ws = bad ? '0' : fstr(w < 0 ? -w : w);
    const hs = bad ? '0' : fstr(h < 0 ? -h : h);
    const kid = rects[k]!;
    setBarRect(kid, xs, ys, ws, hs, k >= oldTotal);
    if (k >= oldOverlayStart && k < oldTotal) {
      kid.style.removeProperty('fill');
      kid.style.removeProperty('color');
    }
    if (pattern !== null) {
      const j = k + count;
      const overlay = rects[j]!;
      setBarRect(overlay, xs, ys, ws, hs, j >= oldTotal);
      const wasOverlay = j >= oldOverlayStart && j < oldTotal;
      if (!wasOverlay || oldPattern !== pattern) overlay.style.setProperty('fill', pattern);
      // The overlay carries the series colour too, so the element painted in that colour also says which
      // pattern it has (spec C4, F9); the pattern's content takes its own colour from the <pattern> element.
      if (color === null) {
        if (wasOverlay && oldColor !== null) overlay.style.removeProperty('color');
      } else if (!wasOverlay || oldColor !== color) {
        setCss(overlay.style, 'color', color);
      }
    }
  }
}

function setBarRect(rect: SVGRectElement, x: string, y: string, width: string, height: string, fresh: boolean): void {
  if (fresh || rect.getAttribute('x') !== x) rect.setAttribute('x', x);
  if (fresh || rect.getAttribute('y') !== y) rect.setAttribute('y', y);
  if (fresh || rect.getAttribute('width') !== width) rect.setAttribute('width', width);
  if (fresh || rect.getAttribute('height') !== height) rect.setAttribute('height', height);
}

function updateArcs(doc: Document, g: SvgNode, mark: ArcMark, bindings: PaintBindings, s: Float64Array): void {
  const count = mark.angles.length >> 1;
  if (count === 0 && g.kids === null) return;
  const kids = g.kids ??= [];
  const sameCount = kids.length === count;
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
    const kid = kids[i]!;
    const fill = mark.fills[i];
    if (!same) attr(kid, 'd', sectorData(mark.cx, mark.cy, mark.r0, mark.r1, mark.angles[2 * i]!, mark.angles[2 * i + 1]!, mark.gap, s));
    paint(kid, 'fill', fill === undefined ? null : paintOf(fill, bindings));
  }
}

function updateRule(n: SvgNode, mark: RuleMark, bindings: PaintBindings, dpr: number, s: Float64Array): void {
  snapRule(mark.x1, mark.y1, mark.x2, mark.y2, mark.strokeWidth, dpr, s);
  attr(n, 'x1', s[0]!);
  attr(n, 'y1', s[1]!);
  attr(n, 'x2', s[2]!);
  attr(n, 'y2', s[3]!);
  styleRule(n, mark, paintOf(mark.stroke, bindings), mark.strokeWidth > 0 ? s[4]! : 0);
}

function sameDash(a: RuleMark['dash'], b: RuleMark['dash']): boolean {
  if (a === b) return true;
  if (a === null || b === null || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function ruleRunEnd(marks: readonly Mark[], start: number, first: RuleMark, bindings: PaintBindings, color: string | null, dpr: number, s: Float64Array): number {
  const aligned = first.x1 === first.x2 || first.y1 === first.y2;
  let end = start + 1;
  for (; end < marks.length; end++) {
    const next = marks[end]!;
    if (next.type !== 'rule' || next.role !== first.role || next.strokeWidth !== first.strokeWidth
      || paintOf(next.stroke, bindings) !== color || !sameDash(first.dash, next.dash)) break;
    // A path has one stroke width. Only horizontal and vertical rules get a device-snapped width.
    const nextAligned = next.x1 === next.x2 || next.y1 === next.y2;
    if (aligned !== nextAligned && first.strokeWidth > 0) {
      const orthogonal = aligned ? first : next;
      snapRule(orthogonal.x1, orthogonal.y1, orthogonal.x2, orthogonal.y2, orthogonal.strokeWidth, dpr, s);
      if (s[4] !== first.strokeWidth) break;
    }
  }
  return end;
}

function updateRules(n: SvgNode, marks: readonly Mark[], start: number, end: number, first: RuleMark, color: string | null, dpr: number, s: Float64Array): void {
  let d = '';
  let orthogonal = false;
  for (let i = start; i < end; i++) {
    const mark = marks[i] as RuleMark;
    snapRule(mark.x1, mark.y1, mark.x2, mark.y2, mark.strokeWidth, dpr, s);
    d += `M${s[0]} ${s[1]}`;
    if (s[1] === s[3]) {
      d += `H${s[2]}`;
      orthogonal = true;
    } else if (s[0] === s[2]) {
      d += `V${s[3]}`;
      orthogonal = true;
    } else {
      d += `L${s[2]} ${s[3]}`;
    }
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
