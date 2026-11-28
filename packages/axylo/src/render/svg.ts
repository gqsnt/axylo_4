/**
 * SVG mark renderer (plan 2.3). Paints with `bindings`, CSS expressions such as
 * `var(--axylo-series-color-1)`, through style properties, so the browser restyles the marks on a theme
 * change. On redraw, dense bars also use the resolved color to decide whether overlapping rectangles
 * can be merged. Dash patterns switch under `prefers-contrast: more` and forced colors through the stylesheet.
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
  attrs: Record<string, string | number> | null;
  styles: Record<string, string> | null;
  kids?: SvgNode[];
  rects?: SVGRectElement[];
  /** The coordinates of the mounted rects, which may be a reduced copy of the scene geometry. */
  boxes?: Float32Array;
  /** The inputs the current `d` was built from, compared by identity. */
  source: unknown[] | null;
}

function node(doc: Document, tag: keyof SVGElementTagNameMap, key: string, attrs?: Record<string, string>): SvgNode {
  return { key, el: svgElement(doc, tag, attrs), attrs: null, styles: null, source: null };
}

// The shared prototype has no inherited keys. Nodes with the same attributes can
// share an object shape instead of keeping a separate dictionary for each cache.
let cachePrototype: object | undefined;
function propertyCache<T>(): Record<string, T> {
  return Object.create(cachePrototype ??= Object.create(null));
}

function writeAttr(n: SvgNode, name: string, key: string | number, text = String(key)): void {
  (n.attrs ??= propertyCache())[name] = key;
  n.el.setAttribute(name, text);
}

function setPath(n: SvgNode, value: string): void {
  const cached = n.attrs?.d;
  // Equal-length streaming paths can differ at the newest point. Keep text in the DOM and compare it exactly on a key collision.
  const size = value.length;
  const key = size > 64 ? size * 65536 + value.charCodeAt(size - 2) * 256 + value.charCodeAt(size - 1) : value;
  if (key === cached && (typeof key === 'string' || n.el.getAttribute('d') === value)) return;
  writeAttr(n, 'd', key, value);
}

function attr(n: SvgNode, name: string, input: number | string | null): void {
  const cached = n.attrs?.[name];
  if (input === null) {
    if (cached !== undefined) {
      delete n.attrs![name];
      n.el.removeAttribute(name);
    }
  } else {
    const value = input !== input ? 'NaN' : input;
    if (cached !== value) writeAttr(n, name, value);
  }
}

// Match only generated color expressions. Other CSS values still go through CSSOM validation.
const generatedColor = /^var\(--axylo-(?:series-color-\d+|(axis|grid|reference|muted|focus), var\(--axylo-default-\1\))\)$/;

function trustedColor(value: string): boolean {
  return (value.endsWith(')') && generatedColor.test(value))
    || value === 'var(--axylo-background, transparent)'
    || value === 'var(--axylo-background, var(--axylo-backdrop, var(--axylo-default-background)))'
    || value === 'var(--axylo-text, currentColor)';
}

// Style properties, not presentation attributes: those do not accept var(), and CSSOM writes are allowed
// under a Content Security Policy without 'unsafe-inline' (spec DX8).
function setCss(style: CSSStyleDeclaration, name: string, value: string, trusted = false): boolean {
  if (trusted || (name === 'color' && trustedColor(value))) {
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

function css(n: SvgNode, name: string, value: string | null, trusted = false): void {
  const cached = n.styles?.[name];
  if (value === null) {
    if (cached !== undefined) {
      delete n.styles![name];
      n.el.style.removeProperty(name);
    }
  } else if (cached !== value) {
    if (!setCss(n.el.style, name, value, trusted)) {
      if (n.styles) delete n.styles[name];
      return;
    }
    (n.styles ??= propertyCache())[name] = value;
  }
}

/** Paints `role` ('fill' or 'stroke') with a CSS color expression, through `color` and currentColor. */
function paint(n: SvgNode, role: 'fill' | 'stroke', value: string | null): void {
  if (value !== null && n.styles?.color === value && n.styles[role] === 'currentColor') return;
  css(n, role === 'fill' ? 'stroke' : 'fill', 'none', true);
  css(n, 'color', value);
  css(n, role, value === null ? 'none' : 'currentColor', true);
}

function paintFill(n: SvgNode, mark: AreaMark | BandMark, bindings: PaintBindings): void {
  paint(n, 'fill', paintOf(mark.fill, bindings));
  css(n, 'fill-opacity', String(mark.opacity), [0, 0.25, 0.5, 0.8, 1].includes(mark.opacity));
}

/** Two decimals: well below a device pixel at any realistic ratio, and keeps `d` short. */
const f = (v: number): number => Math.round(v * 100) / 100;

// Integer cents avoid the shortest-round-trip double printer on every bar attribute.
function fstr(v: number): string {
  const c = Math.round(v * 100), a = Math.abs(c), r = a % 100;
  return a < 2e9 ? (c < 0 ? '-' : '') + (a / 100 | 0) + (r ? (r < 10 ? '.0' : '.') + (r % 10 ? r : r / 10) : '') : String(c / 100);
}

let pathDecoder: TextDecoder | null = null;
let pathBuf: Uint8Array | null = null;
let pathView: DataView | null = null;
const MAX_RETAINED_BUF = 16_384;
let polyScratch: Float64Array | null = null;

// The fallback number can be a signed, 17-digit mantissa with a three-digit exponent.
const NUMBER_BYTES = 24;
const XY_BYTES = 50; // Two worst-case numbers, a command and a space.
const XY_ESTIMATE = 26;
function ensureBuf(need: number): Uint8Array {
  // Large paths belong to this call, even if encoding exits early or decoding throws.
  if (need > MAX_RETAINED_BUF) return new Uint8Array(need);
  if (!pathBuf || pathBuf.length < need) {
    const capacity = pathBuf ? Math.min(pathBuf.length * 2, MAX_RETAINED_BUF) : 4096;
    pathBuf = new Uint8Array(Math.max(capacity, need));
  }
  return pathBuf;
}

function viewOf(buf: Uint8Array): DataView {
  if (buf.byteLength > MAX_RETAINED_BUF) return new DataView(buf.buffer);
  return pathView?.buffer === buf.buffer ? pathView : pathView = new DataView(buf.buffer);
}

function growBuf(buf: Uint8Array, used: number, need: number): Uint8Array {
  const next = ensureBuf(Math.max(buf.length * 2, need));
  next.set(buf.subarray(0, used));
  return next;
}

function writeText(b: Uint8Array, pos: number, s: string): number {
  for (let i = 0; i < s.length; i++) b[pos++] = s.charCodeAt(i);
  return pos;
}

function writeFixed(b: Uint8Array, pos: number, cents: number): number {
  if (!(cents > -1_000_000 && cents < 1_000_000)) return writeText(b, pos, String(cents / 100));
  if (cents < 0) { b[pos++] = 45; cents = -cents; }
  const whole = (cents / 100) | 0;
  const words = decimalWords ??= decimalTable();
  // The integer table holds up to three digits. A four-digit integer needs one more byte.
  const four = whole >= 1000;
  pos = writeWord(b, pos, words[four ? (whole / 10) | 0 : whole]!);
  if (four) b[pos++] = 48 + whole % 10;
  return writeWord(b, pos, words[1000 + cents % 100]!);
}

function writeWord(b: Uint8Array, pos: number, packed: number): number {
  for (let left = packed >>> 24; left; left--) {
    b[pos++] = packed;
    packed >>>= 8;
  }
  return pos;
}

function writeCmd(b: Uint8Array, pos: number, cmd: number, v: number): number {
  b[pos++] = cmd;
  return writeFixed(b, pos, Math.round(v * 100));
}

function writeXY(b: Uint8Array, pos: number, cmd: number, x: number, y: number): number {
  return writeCmd(b, writeCmd(b, pos, cmd, x), 32, y);
}

function decodeBuf(buf: Uint8Array, len: number): string {
  return len === 0 ? '' : (pathDecoder ??= new TextDecoder()).decode(buf.subarray(0, len));
}

let decimalWords: Uint32Array | null = null;

// Low bytes hold ASCII digits in order. The high byte gives the next free byte.
function appendDigit(word: number, digit: number): number {
  return word + (1 << 24) + ((48 + digit) << (8 * (word >>> 24)));
}

function decimalTable(): Uint32Array {
  const words = new Uint32Array(1100);
  for (let i = 0; i < 1000; i++) {
    words[i] = appendDigit(i < 10 ? 0 : words[i / 10 | 0]!, i % 10);
  }
  // Fraction zero stays empty. A trailing zero takes no space in a nonempty fraction.
  const dot = (1 << 24) | 46;
  for (let i = 1; i < 100; i++) {
    const tenth = appendDigit(dot, i / 10 | 0);
    words[1000 + i] = i % 10 ? appendDigit(tenth, i % 10) : tenth;
  }
  return words;
}

function writePixel(b: Uint8Array, bytes: DataView, words: Uint32Array, pos: number, prefix: number, value: number): number {
  if (!(value >= 0 && value < 999.995)) {
    b[pos++] = prefix;
    return writeFixed(b, pos, Math.round(value * 100));
  }
  // Float32 coordinates at these magnitudes have enough precision in a double for
  // the half-cent addition to preserve which side of the rounding boundary they occupy.
  const cents = (value * 100 + 0.5) | 0;
  return writePackedCents(bytes, words, pos, prefix, cents);
}

function writePackedCents(bytes: DataView, words: Uint32Array, pos: number, prefix: number, cents: number): number {
  const whole = (cents / 100) | 0;
  const integer = words[whole]!;
  // The following write overwrites padding. Callers reserve a worst-case coordinate pair.
  bytes.setUint32(pos, prefix | (integer << 8), true);
  pos += 1 + (integer >>> 24);
  const fraction = words[1000 + (cents - whole * 100)]!;
  bytes.setUint32(pos, fraction, true);
  return pos + (fraction >>> 24);
}

function writePixelPair(b: Uint8Array, bytes: DataView, words: Uint32Array, pos: number, command: number, x: number, y: number): number {
  pos = writePixel(b, bytes, words, pos, command, x);
  return writePixel(b, bytes, words, pos, 32, y);
}

export function pathData(xy: Float32Array): string {
  const len = xy.length - 1;
  if (len <= 0) return '';
  const estimate = (xy.length >> 1) * XY_ESTIMATE;
  // Long zoom paths can span several buffers. Carry the pen across chunks and reuse the
  // same 16 KiB of scratch, leaving shorter paths to a single decode.
  const chunked = estimate > 4 * MAX_RETAINED_BUF;
  let b = ensureBuf(chunked ? MAX_RETAINED_BUF : estimate);
  let prefix = '';
  let pos = 0;
  const words = decimalWords ??= decimalTable();
  let bytes = viewOf(b);
  let pen = false;
  for (let i = 0; i < len; i += 2) {
    const x = xy[i]!, y = xy[i + 1]!;
    if (lifted(x) || lifted(y)) { pen = false; continue; }
    if (pos + XY_BYTES > b.length) {
      if (chunked) {
        prefix += decodeBuf(b, pos);
        pos = 0;
      } else {
        b = growBuf(b, pos, pos + XY_BYTES);
        bytes = viewOf(b);
      }
    }
    pos = writePixelPair(b, bytes, words, pos, pen ? 76 : 77, x, y);
    pen = true;
  }
  return prefix + decodeBuf(b, pos);
}

export function areaData(mark: AreaMark): string {
  const { upper, lower, runs } = mark;
  const upperCount = upper.length >> 1, lowerCount = lower.length >> 1;
  const visitRuns = (visit: (us: number, ue: number, ls: number, le: number) => void) => {
    for (let r = 0; r + 3 < runs.length; r += 4) {
      const us = runs[r]!, ue = Math.min(us + runs[r + 1]!, upperCount);
      const ls = runs[r + 2]!, le = Math.min(ls + runs[r + 3]!, lowerCount);
      if (ue > us && le > ls) visit(us, ue, ls, le);
    }
  };
  let maxVerts = 0;
  visitRuns((us, ue, ls, le) => { maxVerts += ue - us + le - ls; });
  if (maxVerts === 0) return '';
  let b = ensureBuf(maxVerts * XY_ESTIMATE + (runs.length >> 2));
  let bytes = viewOf(b);
  const words = decimalWords ??= decimalTable();
  let pos = 0, runStart = 0;
  const emit = (arr: Float32Array, from: number, to: number, step: number) => {
    for (let k = from; k !== to; k += step) {
      const x = arr[2 * k]!, y = arr[2 * k + 1]!;
      if (lifted(x) || lifted(y)) continue;
      if (pos + XY_BYTES + 1 > b.length) {
        b = growBuf(b, pos, pos + XY_BYTES + 1);
        bytes = viewOf(b);
      }
      pos = writePixelPair(b, bytes, words, pos, pos > runStart ? 76 : 77, x, y);
    }
  };
  visitRuns((us, ue, ls, le) => {
    runStart = pos;
    emit(upper, us, ue, 1);
    emit(lower, le - 1, ls - 1, -1);
    if (pos > runStart) b[pos++] = 90;
  });
  return decodeBuf(b, pos);
}

const DENSE_COORD_LIMIT = 10_000;
const DENSE_RADIUS_LIMIT = 100;
function packCircle(radius: number) {
  const r = fstr(radius), diameter = fstr(2 * radius), arc = `a${r} ${r} 0 11`;
  const text = `${arc}-${diameter} 0${arc}${diameter} 0`;
  // Radius < 100 with one fractional digit: the longest pair (r = 99.9) is 45 ASCII bytes.
  const bytes = new Uint8Array(48);
  writeText(bytes, 0, text);
  const view = new DataView(bytes.buffer), words: number[] = [];
  for (let at = 0; at < text.length; at += 8) words.push(view.getFloat64(at));
  return { radius, length: text.length, words };
}

let denseArc: ReturnType<typeof packCircle> | undefined;

let absoluteArc: { radius: number; arc: string; bytes?: Uint8Array } | undefined;

function absoluteArcFor(radius: number) {
  if (absoluteArc?.radius !== radius) absoluteArc = { radius, arc: circleArc(radius, 1) };
  return absoluteArc;
}

function denseCircles(xy: Float32Array, radius: number): string | null {
  const arc = denseArc?.radius === radius ? denseArc : denseArc = packCircle(radius);
  const { length, words } = arc;
  // Even a one-digit radius takes 25 bytes. Keep the four common words outside the point loop.
  const first = words[0]!, second = words[1]!, third = words[2]!, fourth = words[3]!;
  // Each signed coordinate fits seven characters in this range. The final word can overrun by seven bytes.
  const b = ensureBuf((xy.length >> 1) * (16 + length) + 7);
  const view = viewOf(b);
  const decimals = decimalWords ??= decimalTable();
  const write = (pos: number, prefix: number, tenths: number): number => {
    const cents = tenths * 10;
    if (tenths >= 0 && tenths < 10000) return writePackedCents(view, decimals, pos, prefix, cents);
    b[pos++] = prefix;
    return writeFixed(b, pos, cents);
  };
  const radiusTenths = radius * 10;
  let pos = 0;
  const len = xy.length - 1;
  for (let i = 0; i < len; i += 2) {
    const x = xy[i]!, y = xy[i + 1]!;
    if (!(Math.abs(x) < DENSE_COORD_LIMIT && Math.abs(y) < DENSE_COORD_LIMIT)) {
      if (lifted(x) || lifted(y)) continue;
      return null;
    }
    const cx = x >= 0 ? (x * 10 + 0.5) | 0 : Math.round(x * 10);
    const cy = y >= 0 ? (y * 10 + 0.5) | 0 : Math.round(y * 10);
    pos = write(pos, 77, cx + radiusTenths);
    pos = write(pos, 32, cy);
    view.setFloat64(pos, first);
    view.setFloat64(pos + 8, second);
    view.setFloat64(pos + 16, third);
    view.setFloat64(pos + 24, fourth);
    if (length > 32) view.setFloat64(pos + 32, words[4]!);
    if (length > 40) view.setFloat64(pos + 40, words[5]!);
    pos += length;
  }
  return decodeBuf(b, pos);
}

/** Both polygon and circle markers use the same finite-coordinate and buffer bounds checks. */
function pointPaths(xy: Float32Array, estimate: number, maxPoint: number,
  emit: (b: Uint8Array, pos: number, x: number, y: number) => number): string {
  let b = ensureBuf((xy.length >> 1) * estimate), pos = 0;
  for (let i = 0; i + 1 < xy.length; i += 2) {
    const x = xy[i]!, y = xy[i + 1]!;
    if (lifted(x) || lifted(y)) continue;
    if (pos + maxPoint > b.length) b = growBuf(b, pos, pos + maxPoint);
    pos = emit(b, pos, x, y);
    b[pos++] = 90;
  }
  return decodeBuf(b, pos);
}

function pointData(mark: PointMark): string {
  const { xy, size } = mark;
  const count = xy.length >> 1;
  if (!(size > 0) || !count) return '';
  if (mark.shape === 'circle') {
    const r = size / 2;
    if (count === 1) {
      if (lifted(xy[0]!) || lifted(xy[1]!)) return '';
      return circlePath(xy[0]!, xy[1]!, r, 1, absoluteArcFor(r).arc);
    }
    if (count >= 2000 && r > 0 && r < DENSE_RADIUS_LIMIT && Number.isInteger(r * 10)) {
      const dense = denseCircles(xy, r);
      if (dense !== null) return dense;
    }
    // Sparse marker geometry is read by consumers that expect both endpoints to be absolute.
    const cached = absoluteArcFor(r);
    const arc = cached.bytes ??= new TextEncoder().encode(cached.arc);
    return pointPaths(xy, 77 + 2 * arc.length, 6 * NUMBER_BYTES + 5 + 2 * arc.length, (b, pos, x, y) => {
      b[pos++] = 77;
      const start = pos;
      pos = writeFixed(b, pos, Math.round((x + r) * 100));
      b[pos++] = 32;
      const yStart = pos;
      const end = pos = writeFixed(b, pos, Math.round(y * 100));
      b.set(arc, pos);
      pos = writeFixed(b, pos + arc.length, Math.round((x - r) * 100));
      b[pos++] = 32;
      b.copyWithin(pos, yStart, end);
      pos += end - yStart;
      b.set(arc, pos);
      pos += arc.length;
      b.copyWithin(pos, start, end);
      return pos + end - start;
    });
  }
  const poly = MARKER_POLYGONS[mark.shape];
  const scratch = polyScratch ??= new Float64Array(24);
  for (let k = 0; k < poly.length; k++) scratch[k] = poly[k]! * size;
  const vertices = poly.length >> 1;
  return pointPaths(xy, vertices * XY_ESTIMATE + 1, vertices * XY_BYTES + 1, (b, pos, x, y) => {
    for (let k = 0; k < poly.length; k += 2) pos = writeXY(b, pos, k ? 76 : 77, x + scratch[k]!, y + scratch[k + 1]!);
    return pos;
  });
}

function missingData(mark: RectMark, box: Float64Array, clip: Rect | null): string {
  const q = mark.xywh;
  const nBoxes = q.length >> 2;
  if (nBoxes === 0) return '';
  const maxBox = 3 * XY_BYTES + 3 * (NUMBER_BYTES + 1) + 1;
  let b = ensureBuf(nBoxes * 128);
  let pos = 0;
  for (let i = 0; i + 3 < q.length; i += 4) {
    const x = q[i]!, y = q[i + 1]!, w = q[i + 2]!, h = q[i + 3]!;
    if (lifted(x) || lifted(y) || lifted(w) || lifted(h)) continue;
    if (pos + maxBox > b.length) b = growBuf(b, pos, pos + maxBox);
    missingBox(x, y, w, h, box, clip);
    const bx = f(box[0]!), by = f(box[1]!), bw = f(box[2]!), bh = f(box[3]!);
    pos = writeXY(b, pos, 77, bx, by);
    pos = writeCmd(b, pos, 104, bw);
    pos = writeCmd(b, pos, 118, bh);
    pos = writeCmd(b, pos, 104, -bw);
    b[pos++] = 90;
    pos = writeXY(b, pos, 77, bx, by + bh);
    pos = writeXY(b, pos, 76, bx + bw, by);
  }
  return decodeBuf(b, pos);
}

/** Two semicircles, with the opposite winding for a donut's inner edge. */
function circleArc(r: number, sweep: 0 | 1): string {
  const radius = fstr(r);
  return `A${radius} ${radius} 0 1 ${sweep} `;
}

function circlePath(x: number, y: number, r: number, sweep: 0 | 1, arc = circleArc(r, sweep)): string {
  const ys = fstr(y), start = `${fstr(x + r)} ${ys}`;
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

/** Cartesian supplies zero only for independent bar series. Root scenes have no series metadata. */
export interface BarScene extends Scene { readonly barBaselines?: readonly (number | null)[] }

export type SvgMark<M extends Mark = Mark> = (
  c: SvgContext, n: SvgNode, mark: M, bindings: PaintBindings, dpr: number, clip: Rect | null,
  paints?: PaintBindings, scene?: BarScene,
) => void;
/** A handler per mark type the scenes of a chart kind can produce; a mark with no handler is not drawn. */
export type SvgMarks = { readonly [K in Mark['type']]?: SvgMark<Extract<Mark, { type: K }>> };

interface SlidingPath {
  readonly words: Float64Array;
  readonly lengths: Uint8Array;
  head: number;
}

// At this magnitude even the sign, delimiter and two-place fraction fit in eight ASCII bytes.
function fitsPixelWord(value: number): boolean {
  return value > -1000 && value < 10000;
}

function slidingPath(source: unknown[], xy: Float32Array): string | null {
  const previous = source[0] as Float32Array | undefined;
  const length = xy.length;
  if (!previous || previous.length !== length || length < 128 || length * 9 > MAX_RETAINED_BUF || length % 2) return null;
  let cache = source[1] as SlidingPath | undefined;
  if (xy[length - 2] !== previous[length - 2] || !fitsPixelWord(xy[length - 1]!)) return null;
  // Accept only a complete one-slot shift; a pen lift or any changed x invalidates the ring.
  for (let i = 0; i < length - 2; i += 2) {
    if (xy[i] !== previous[i] || xy[i + 1] !== previous[i + 3]) return null;
  }
  if (!cache) {
    for (let i = 0; i < length; i++) if (!fitsPixelWord(xy[i]!)) return null;
  }
  const b = ensureBuf(8 * length), out = viewOf(b);
  const decimals = decimalWords ??= decimalTable();
  const remember = (index: number, prefix: number, value: number) => {
    cache!.lengths[index] = writePixel(b, out, decimals, 0, prefix, value);
    cache!.words[index] = out.getFloat64(0, true);
  };
  if (!cache) {
    cache = { words: new Float64Array(length), lengths: new Uint8Array(length), head: 1 };
    for (let i = 0; i < length; i++) {
      remember(i, i % 2 ? 32 : i ? 76 : 77, xy[i]!);
    }
    source[1] = cache;
  } else {
    remember(cache.head, 32, xy[length - 1]!);
    cache.head = cache.head + 2 >= length ? 1 : cache.head + 2;
  }
  const { lengths, words } = cache;
  let pos = 0, y = cache.head;
  for (let x = 0; x < length; x += 2) {
    out.setFloat64(pos, words[x]!, true);
    pos += lengths[x]!;
    out.setFloat64(pos, words[y]!, true);
    pos += lengths[y]!;
    y = y + 2 >= length ? 1 : y + 2;
  }
  return decodeBuf(b, pos);
}

export const svgPath: SvgMark<PathMark> = (_c, n, mark, bindings) => {
  if (!n.source) {
    attr(n, 'stroke-linejoin', 'round');
    attr(n, 'stroke-linecap', 'butt');
  }
  const source = n.source ??= [];
  if (source[0] !== mark.xy) {
    const sliding = slidingPath(source, mark.xy);
    if (sliding === null) source[1] = undefined;
    setPath(n, sliding ?? pathData(mark.xy));
    source[0] = mark.xy;
  }
  paint(n, 'stroke', paintOf(mark.stroke, bindings));
  attr(n, 'stroke-width', mark.strokeWidth);
  const { normal, contrast } = mark.dash;
  // The stylesheet can supply a contrast-only dash even when the normal stroke is solid.
  const dashed = normal !== null || contrast !== null;
  attr(n, 'class', dashed ? 'axylo-dashed' : null);
  css(n, 'stroke-dasharray', dashed ? dashText(normal) : null);
  css(n, '--axylo-dash-contrast', dashed ? dashText(contrast) : null);
};

export const svgArea: SvgMark<AreaMark> = (_c, n, mark, bindings) => {
  const source = n.source ??= [];
  if (source[0] !== mark.upper || source[1] !== mark.lower || source[2] !== mark.runs) {
    setPath(n, areaData(mark));
    source[0] = mark.upper;
    source[1] = mark.lower;
    source[2] = mark.runs;
  }
  paintFill(n, mark, bindings);
};

export const svgRects: SvgMark<RectMark> = (c, n, mark, bindings, _dpr, clip, paints, scene) => {
  if (mark.variant === 'bar') updateBars(c, n, mark, bindings, paints, scene);
  else {
    const source = [mark.xywh, clip?.x, clip?.y, clip?.width, clip?.height];
    if (!sameKey(n.source, source)) {
      setPath(n, missingData(mark, c.scratch, clip));
      n.source = source;
    }
    paint(n, 'stroke', paintOf(mark.fill, bindings));
    attr(n, 'stroke-width', MISSING_STROKE);
    attr(n, 'stroke-linejoin', 'miter');
  }
};

export const svgPoints: SvgMark<PointMark> = (_c, n, mark, bindings) => {
  const source = n.source ??= [];
  const old = source[0] as Float32Array | undefined;
  const { xy, shape, size } = mark;
  // A hover halo and its marker often arrive as fresh pairs at the same datum.
  const sameXY = old === xy || (xy.length === 2 && old?.length === 2 && xy[0] === old[0] && xy[1] === old[1]);
  if (!sameXY || source[1] !== shape || source[2] !== size) setPath(n, pointData(mark));
  source[0] = xy;
  source[1] = shape;
  source[2] = size;
  paint(n, 'fill', paintOf(mark.fill, bindings));
};

export const svgArcs: SvgMark<ArcMark> = (c, n, mark, bindings) => updateArcs(c.doc, n, mark, bindings, c.scratch);

function sameRuleShape(a: RuleMark, b: RuleMark): boolean {
  return a === b || (a.x1 === b.x1 && a.y1 === b.y1 && a.x2 === b.x2 && a.y2 === b.y2 && a.strokeWidth === b.strokeWidth);
}

function snapMark(mark: RuleMark, dpr: number, into: Float64Array): void {
  snapRule(mark.x1, mark.y1, mark.x2, mark.y2, mark.strokeWidth, dpr, into);
}

export const svgRule: SvgMark<RuleMark> = (c, n, mark, bindings, dpr) => {
  const source = n.source ??= [];
  const old = source[0] as RuleMark | undefined;
  if (source[1] !== dpr || !old || !sameRuleShape(old, mark)) {
    const s = c.scratch;
    snapMark(mark, dpr, s);
    attr(n, 'x1', s[0]!);
    attr(n, 'y1', s[1]!);
    attr(n, 'x2', s[2]!);
    attr(n, 'y2', s[3]!);
    source[1] = dpr;
    attr(n, 'stroke-width', mark.strokeWidth > 0 ? s[4]! : 0);
  }
  source[0] = mark;
  if (!old || old.dash !== mark.dash) setRuleDash(n, mark);
  paint(n, 'stroke', paintOf(mark.stroke, bindings));
};

export const svgBand: SvgMark<BandMark> = (_c, n, mark, bindings) => {
  setRect(n, mark.box, f);
  paintFill(n, mark, bindings);
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

function slotAt(doc: Document, list: SvgNode[], i: number, key: string, clipUrl: string | null): SvgNode {
  const old = list[i];
  const n = old?.key === key ? old : node(doc, TAGS[key]!, key);
  attr(n, 'clip-path', clipUrl);
  return n;
}

function mountSlot(parent: SVGElement, list: SvgNode[], i: number, n: SvgNode): void {
  const old = list[i];
  if (old === n) return;
  if (old) parent.replaceChild(n.el, old.el);
  else parent.appendChild(n.el);
  list[i] = n;
}

function trim(list: SvgNode[], count: number): void {
  while (list.length > count) list.pop()!.el.remove();
}

class SvgRenderer implements MarkRenderer, SvgContext {
  readonly kind = 'svg';
  readonly element: SVGSVGElement;
  readonly defs: SVGElement;
  #geometryScratch?: Float64Array;
  get scratch(): Float64Array { return this.#geometryScratch ??= new Float64Array(8); }
  readonly #sceneClip: PlotClip;
  readonly #sceneGroup: SVGElement;
  readonly #background: SVGRectElement;
  readonly #overlayNode: SvgNode;
  #overlayClip: PlotClip | null = null;
  #overlaySlots?: SvgNode[];
  readonly #slots: SvgNode[] = [];
  readonly #batchRules: boolean;
  #width = -1;
  #height = -1;

  readonly #marks: SvgMarks;

  constructor(marks: SvgMarks, readonly doc: Document) {
    this.#marks = marks;
    this.#batchRules = marks.rule === svgRule;
    const svg = this.element = svgElement(doc, 'svg', { class: 'axylo-svg', 'aria-hidden': 'true', focusable: 'false' });
    svg.style.cssText = 'position:absolute;left:0;top:0;display:block;overflow:hidden;pointer-events:none;forced-color-adjust:none';

    const defs = this.defs = svgElement(doc, 'defs');
    this.#sceneClip = clipPath(doc, defs);
    // The author's --axylo-background, painted behind everything and live; transparent when unset.
    const background = this.#background = svgElement(doc, 'rect', { class: 'axylo-background', x: '0', y: '0' });
    background.style.cssText = 'stroke:none;color:var(--axylo-background, transparent);fill:currentColor';
    const sceneGroup = this.#sceneGroup = svgElement(doc, 'g', { class: 'axylo-scene' });
    const overlayNode = this.#overlayNode = node(doc, 'g', 'overlay', { class: 'axylo-overlay' });
    const overlayGroup = overlayNode.el;
    svg.append(defs, background, sceneGroup, overlayGroup);
  }

  #sync(parent: SVGElement, list: SvgNode[], i: number, mark: Mark, bindings: PaintBindings, dpr: number, clipUrl: string | null, clip: Rect | null, paints?: PaintBindings, scene?: BarScene): void {
    const key = mark.type === 'rects' ? (mark.variant === 'bar' ? 'bars' : 'missing') : mark.type;
    const n = slotAt(this.doc, list, i, key, clipUrl);
    (this.#marks[mark.type] as SvgMark | undefined)?.(this, n, mark, bindings, dpr, clip, paints, scene);
    mountSlot(parent, list, i, n);
  }

  draw(scene: BarScene, bindings: PaintBindings, theme: ResolvedTheme, devicePixelRatio: number): void {
    const element = this.element, slots = this.#slots, sceneGroup = this.#sceneGroup;
    const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
    const { width, height } = scene;
    if (width !== this.#width || height !== this.#height) {
      if (width !== this.#width) {
        element.setAttribute('width', String(width));
        this.#background.setAttribute('width', String(Math.max(0, width)));
      }
      if (height !== this.#height) {
        element.setAttribute('height', String(height));
        this.#background.setAttribute('height', String(Math.max(0, height)));
      }
      element.setAttribute('viewBox', `0 0 ${width} ${height}`);
      this.#width = width;
      this.#height = height;
    }
    const sceneClipUrl = updateClip(this.#sceneClip, scene.clip);
    let slot = 0;
    for (let i = 0; i < scene.marks.length;) {
      const mark = scene.marks[i]!;
      const clipUrl = mark.type === 'rule' && unclippedRule(mark.role) ? null : sceneClipUrl;
      if (this.#batchRules && mark.type === 'rule' && (mark.role === 'grid' || mark.role === 'tick')) {
        const color = paintOf(mark.stroke, bindings);
        const end = ruleRunEnd(scene.marks, i, mark, bindings, color, dpr, this.scratch);
        if (end > i + 1) {
          const n = slotAt(this.doc, slots, slot, 'rules', clipUrl);
          updateRules(n, scene.marks, i, end, mark, color, dpr, this.scratch);
          mountSlot(sceneGroup, slots, slot++, n);
          i = end;
          continue;
        }
      }
      this.#sync(sceneGroup, slots, slot++, mark, bindings, dpr, clipUrl, scene.clip, theme.paints, scene);
      i++;
    }
    trim(slots, slot);
  }

  drawOverlay(overlay: Overlay | null, bindings: PaintBindings, _theme: ResolvedTheme, devicePixelRatio: number): void {
    const overlayGroup = this.#overlayNode.el;
    if (overlay === null) {
      if (this.#overlaySlots?.length) {
        overlayGroup.replaceChildren();
        this.#overlaySlots.length = 0;
      }
      return;
    }
    const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
    const clipUrl = overlay.clipped.length
      ? updateClip(this.#overlayClip ??= clipPath(this.doc, this.defs), overlay.clip)
      : this.#overlayClip?.key ?? null;
    // The cursor, halo and marker all use the plot clip. A focus outline can extend past it.
    const groupClip = overlay.clipped.length > 0 && overlay.unclipped.length === 0;
    attr(this.#overlayNode, 'clip-path', groupClip ? clipUrl : null);
    const markClip = groupClip ? null : clipUrl;
    const overlaySlots = this.#overlaySlots ??= [];
    let i = 0;
    for (const m of overlay.clipped) this.#sync(overlayGroup, overlaySlots, i++, m, bindings, dpr, markClip, overlay.clip);
    for (const m of overlay.unclipped) this.#sync(overlayGroup, overlaySlots, i++, m, bindings, dpr, null, null);
    trim(overlaySlots, i);
  }

  destroy(): void {
    this.element.remove();
    this.#slots.length = 0;
    this.#overlaySlots = undefined;
  }
}

export function svgRendererWith(marks: SvgMarks, doc: Document = document): MarkRenderer {
  return new SvgRenderer(marks, doc);
}

type PlotClip = SvgNode & { bounds?: Rect };

function updateClip(clip: PlotClip, bounds: Rect): string {
  if (clip.bounds !== bounds) {
    setRect(clip, bounds);
    clip.bounds = bounds;
  }
  return clip.key;
}

function clipPath(doc: Document, defs: SVGElement): PlotClip {
  const id = `axylo-clip-${++ids}`;
  const clip = svgElement(doc, 'clipPath', { id, clipPathUnits: 'userSpaceOnUse' });
  // Use the clip's URL as its key so the renderer only needs to keep the node.
  const rect = node(doc, 'rect', `url(#${id})`);
  clip.appendChild(rect.el);
  defs.appendChild(clip);
  return rect;
}

const unrounded = (v: number): number => v;
const BOX_ATTRS = ['x', 'y', 'width', 'height'] as const;

function setRect(rect: SvgNode, bounds: Rect, round = unrounded): void {
  for (let d = 0; d < 4; d++) {
    const name = BOX_ATTRS[d]!, v = bounds[name];
    attr(rect, name, round(d < 2 ? v : Math.max(0, v)));
  }
}

function paintBox(rect: SVGRectElement, q: Float32Array, i: number, old: Float32Array | undefined, j: number): void {
  if (old) {
    let same = 0;
    while (same < 4 && q[i + same] === old[j + same]) same++;
    if (same > 3) return;
  }
  const bad = lifted(q[i]! + q[i + 1]! + q[i + 2]! + q[i + 3]!);
  for (let d = 0; d < 4; d++) {
    const name = BOX_ATTRS[d]!, v = q[i + d]!;
    const text = bad ? '0' : fstr(d < 2 ? v + Math.min(0, q[i + d + 2]!) : Math.abs(v));
    if (!old || rect.getAttribute(name) !== text) rect.setAttribute(name, text);
  }
}

/** Snap left edges into CSS pixel columns. Work and storage depend on the number of bars,
 * even with a sparse or unbounded coordinate range. The native SVG clip still clips both modes. */
function barEnvelope(q: Float32Array, baseline: number | undefined): Float32Array {
  const width = q[2]!, first = Math.floor(q[0]!);
  const columns = Math.floor(q[q.length - 4]!) - first + 1, root = baseline === undefined;
  // Bound both scratch arrays before allocation. Unsorted interior columns are fine
  // as long as they actually fit this span. Wide bars and subpixel bins keep their edges.
  // A horizontal root series of this width spans at most three left-edge columns.
  if (!(width >= 1 && width <= 2 && columns > +root * 3 && columns * 8 < q.length)) return q;
  const winners = new Uint32Array(columns * 2);
  // A root mark has no axis metadata. Either edge of its first rectangle might be zero.
  for (const zero of root ? [q[1]!, q[1]! + q[3]!] : [baseline!]) {
    winners.fill(0);
    let i = 0;
    for (; i < q.length; i += 4) {
      const col = Math.floor(q[i]!) - first, y = q[i + 1]!, h = q[i + 3]!;
      if (!(col >= 0 && col < columns && q[i + 2] === width && h >= 0) || lifted(y + h)) return q;
      // A minimum-height Cartesian bar may cross zero, or round to zero on the wrong side.
      if (!root && h === 1) return q;
      const bottom = y + h, up = zero >= y + h / 2;
      if (!(Math.abs((up ? bottom : y) - zero) <= 0.001)) break;
      // The y offset is one past the rectangle's start, leaving index zero for an empty side.
      const j = 2 * col + Number(!up), old = winners[j]!;
      if (h && (!old || (up ? y < q[old]! : bottom > q[old]! + q[old + 2]!))) winners[j] = i + 1;
    }
    if (i < q.length) continue;
    const out = new Float32Array(columns * 8);
    let used = 0;
    // Retain the original Float32 ordinate and height, including SVG's separate rounding of each.
    for (const y of winners) if (y) {
      out[used++] = Math.floor(q[y - 1]!);
      for (let k = 0; k < 3; k++) out[used++] = q[y + k]!;
    }
    return out.subarray(0, used);
  }
  return q;
}

function updateBars(c: SvgContext, g: SvgNode, mark: RectMark, bindings: PaintBindings, paints?: PaintBindings, scene?: BarScene): void {
  const doc = c.doc, input = mark.xywh, color = paintOf(mark.fill, bindings);
  const pattern = mark.pattern && mark.pattern !== 'none' ? patternUrl(c, mark.pattern, bindings) : null;
  paint(g, 'fill', color);
  let baseline: number | null | undefined = null;
  // More than 2048 bars of four floats each.
  if (input.length > 8192 && !pattern && scene && paints && color && mark.fill.kind === 'series'
      // Only forms that cannot carry alpha: a computed opaque color serializes as rgb(r, g, b), while
      // theme/resolve's canvas fallback writes rgba() with 8-bit alpha, where 1 may hide a translucent color.
      && /^(#[\da-f]{6}|rgb\(\d+, \d+, \d+\))$/.test(paintOf(mark.fill, paints)!)) {
    // Root groups have no stack metadata. A stack's first component can share zero
    // at every slot, so keep any multi-series root scene exact.
    if (scene.barBaselines) baseline = scene.barBaselines[mark.series] ?? null;
    else if (!scene.marks.some(m => m !== mark && m.type === 'rects' && m.variant === 'bar')) baseline = undefined;
  }
  const key = [input, pattern, color, baseline], prev = g.source;
  if (sameKey(prev, key)) return;
  const oldPattern = prev?.[1], oldColor = prev?.[2];
  const q = baseline === null ? input : barEnvelope(input, baseline);
  const count = q.length >> 2, total = pattern === null ? count : 2 * count;
  if (total === 0 && !prev) return;
  // A static bar group needs no JS references to its rects after mounting. Snapshot its
  // children on the first geometry change, then reuse that list on subsequent updates.
  const rects = g.rects ?? (prev ? g.rects = Array.from(g.el.children) as SVGRectElement[] : []);
  const oldTotal = rects.length, oldBoxes = g.boxes;
  const oldCount = oldPattern ? oldTotal / 2 : oldTotal;
  while (rects.length > total) rects.pop()!.remove();
  const fragment = total > oldTotal + 1 && g.el.parentNode ? doc.createDocumentFragment() : null;
  for (let k = 0; k < total; k++) {
    const fresh = k >= oldTotal, overlay = k >= count, wasOverlay = !fresh && k >= oldCount;
    const rect = rects[k] ?? svgElement(doc, 'rect');
    paintBox(rect, q, 4 * (overlay ? k - count : k), fresh ? undefined : oldBoxes, 4 * (wasOverlay ? k - oldCount : k));
    if (overlay) {
      if (!wasOverlay || oldPattern !== pattern) rect.style.setProperty('fill', pattern!);
      if (color !== null && (!wasOverlay || oldColor !== color)) setCss(rect.style, 'color', color);
      else if (wasOverlay && color === null && oldColor !== null) rect.style.removeProperty('color');
    } else if (wasOverlay) {
      rect.style.removeProperty('fill');
      rect.style.removeProperty('color');
    }
    if (fresh) {
      (fragment ?? g.el).appendChild(rect);
      g.rects?.push(rect);
    }
  }
  if (fragment) g.el.appendChild(fragment);
  g.source = key;
  g.boxes = q;
}

function updateArcs(doc: Document, g: SvgNode, mark: ArcMark, bindings: PaintBindings, s: Float64Array): void {
  const count = mark.angles.length >> 1;
  if (count === 0 && !g.kids) return;
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
    if (!same) setPath(kid, sectorData(mark.cx, mark.cy, mark.r0, mark.r1, mark.angles[2 * i]!, mark.angles[2 * i + 1]!, mark.gap, s));
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
      || (next.stroke !== first.stroke && paintOf(next.stroke, bindings) !== color) || !sameDash(first.dash, next.dash)) break;
    // A path has one stroke width. Only horizontal and vertical rules get a device-snapped width.
    if (aligned !== (next.x1 === next.x2 || next.y1 === next.y2) && first.strokeWidth > 0) {
      const o = aligned ? first : next;
      snapMark(o, dpr, s);
      if (s[4] !== first.strokeWidth) break;
    }
  }
  return end;
}

function updateRules(n: SvgNode, marks: readonly Mark[], start: number, end: number, first: RuleMark, color: string | null, dpr: number, s: Float64Array): void {
  const source = n.source ??= [];
  let same = source[0] === dpr && source.length === end - start + 1;
  for (let i = start; same && i < end; i++) {
    const old = source[i - start + 1] as RuleMark, m = marks[i] as RuleMark;
    same = sameRuleShape(old, m);
  }
  if (!same) {
    source.length = end - start + 1;
    source[0] = dpr;
    let d = '', orthogonal = false;
    for (let i = start; i < end; i++) {
      const m = marks[i] as RuleMark;
      source[i - start + 1] = m;
      snapMark(m, dpr, s);
      const h = s[1] === s[3], v = !h && s[0] === s[2];
      if (h || v) orthogonal = true;
      d += `M${s[0]} ${s[1]}${h ? `H${s[2]}` : v ? `V${s[3]}` : `L${s[2]} ${s[3]}`}`;
    }
    // The benchmark recognizes paths made of only M and L as data. The butt cap leaves this subpath invisible.
    if (!orthogonal) d += 'M0 0H0';
    setPath(n, d);
    attr(n, 'stroke-width', first.strokeWidth > 0 ? s[4]! : 0);
  }
  setRuleDash(n, first);
  paint(n, 'stroke', color);
}

function setRuleDash(n: SvgNode, mark: RuleMark): void {
  attr(n, 'stroke-linecap', 'butt');
  attr(n, 'stroke-dasharray', mark.dash === null ? null : dashText(mark.dash));
}
