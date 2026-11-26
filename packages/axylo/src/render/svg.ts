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
  attrs: Record<string, string | number> | null;
  styles: Record<string, string> | null;
  kids?: SvgNode[];
  rects?: SVGRectElement[];
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
  // For long paths the DOM owns the text. Equal lengths need an exact comparison only
  // after the source geometry changes. Reading the attribute does not read layout.
  const key = value.length > 64 ? value.length : value;
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

function isTrustedCss(name: string, value: string): boolean {
  if (name === 'color') return (value.endsWith(')') && generatedColor.test(value))
    || value === 'var(--axylo-background, transparent)'
    || value === 'var(--axylo-background, var(--axylo-backdrop, var(--axylo-default-background)))'
    || value === 'var(--axylo-text, currentColor)';
  if (name === 'fill-opacity') return value === '0' || value === '0.25' || value === '0.5' || value === '0.8' || value === '1';
  return (name === 'fill' || name === 'stroke') && (value === 'none' || value === 'currentColor');
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

function css(n: SvgNode, name: string, value: string | null, trusted = false): void {
  const cached = n.styles?.[name];
  if (value === null) {
    if (cached !== undefined) {
      delete n.styles![name];
      n.el.style.removeProperty(name);
    }
  } else if (cached !== value) {
    const style = n.el.style;
    if (trusted) style.setProperty(name, value);
    else if (!setCss(style, name, value)) {
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
  if (value === null) { css(n, role, 'none', true); css(n, 'color', null); return; }
  css(n, 'color', value);
  css(n, role, 'currentColor', true);
}

function paintFill(n: SvgNode, mark: AreaMark | BandMark, bindings: PaintBindings): void {
  paint(n, 'fill', paintOf(mark.fill, bindings));
  css(n, 'fill-opacity', String(mark.opacity));
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
let pathView: DataView | null = null;
const MAX_RETAINED_BUF = 16_384;
let polyScratch: Float64Array | null = null;

// The fallback number can be a signed, 17-digit mantissa with a three-digit exponent.
const NUMBER_BYTES = 24;
const XY_BYTES = 50; // Two worst-case numbers, a command and a space.
const XY_ESTIMATE = 26;
let digitsCache: Uint8Array | null = null;
function digitTable(): Uint8Array {
  if (digitsCache !== null) return digitsCache;
  const d = new Uint8Array(200);
  for (let i = 0; i < 100; i++) {
    d[2 * i] = 48 + ((i / 10) | 0);
    d[2 * i + 1] = 48 + i % 10;
  }
  return digitsCache = d;
}

function ensureBuf(need: number): Uint8Array {
  if (pathBuf === null) return pathBuf = new Uint8Array(need > 4096 ? need : 4096);
  return pathBuf.length < need ? pathBuf = new Uint8Array(Math.max(Math.min(pathBuf.length * 2, MAX_RETAINED_BUF), need)) : pathBuf;
}

function viewOf(buf: Uint8Array): DataView {
  if (buf.byteLength > MAX_RETAINED_BUF) return new DataView(buf.buffer);
  return pathView?.buffer === buf.buffer ? pathView : pathView = new DataView(buf.buffer);
}

function growBuf(used: number, need: number): Uint8Array {
  const next = new Uint8Array(Math.max(pathBuf!.length * 2, need));
  next.set(pathBuf!.subarray(0, used));
  return pathBuf = next;
}

function writeText(b: Uint8Array, pos: number, s: string): number {
  for (let i = 0; i < s.length; i++) b[pos++] = s.charCodeAt(i);
  return pos;
}

function writeFixed(b: Uint8Array, pos: number, cents: number): number {
  if (!(cents > -1_000_000 && cents < 1_000_000)) return writeText(b, pos, String(cents / 100));
  const digits = digitTable();
  if (cents < 0) { b[pos++] = 45; cents = -cents; }
  let q = (cents / 100) | 0;
  const r = cents - q * 100;
  if (q >= 100) {
    const hi = (q / 100) | 0;
    q -= hi * 100;
    if (hi >= 10) b[pos++] = digits[2 * hi]!;
    b[pos++] = digits[2 * hi + 1]!;
    b[pos++] = digits[2 * q]!;
  } else if (q >= 10) b[pos++] = digits[2 * q]!;
  b[pos++] = digits[2 * q + 1]!;
  if (r) {
    b[pos++] = 46;
    b[pos++] = digits[2 * r]!;
    const last = digits[2 * r + 1]!;
    if (last !== 48) b[pos++] = last;
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

function decodeBuf(len: number): string {
  const buf = pathBuf!;
  const out = len === 0 ? '' : (pathDecoder ??= new TextDecoder()).decode(buf.subarray(0, len));
  if (buf.length > MAX_RETAINED_BUF) pathBuf = null;
  return out;
}

let decimalWords: Uint32Array | null = null;

function decimalTable(): Uint32Array {
  const words = new Uint32Array(1100);
  // The low three bytes hold ASCII in little-endian order. The high byte holds its length.
  for (let n = 0; n < 10; n++) words[n] = (1 << 24) | (48 + n);
  for (let n = 10; n < 1000; n++) {
    const prefix = words[(n / 10) | 0]!;
    const length = prefix >>> 24;
    words[n] = ((length + 1) << 24) | ((48 + n % 10) << (8 * length)) | (prefix & 0xffffff);
  }
  // A whole pixel has no fraction, and a trailing zero takes no byte.
  for (let n = 1; n < 100; n++) {
    const tenths = 48 + ((n / 10) | 0);
    const last = n % 10;
    words[1000 + n] = ((last ? 3 : 2) << 24) | ((48 + last) << 16) | (tenths << 8) | 46;
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
        prefix += (pathDecoder ??= new TextDecoder()).decode(b.subarray(0, pos));
        pos = 0;
      } else {
        b = growBuf(pos, pos + XY_BYTES);
        bytes = viewOf(b);
      }
    }
    pos = writePixelPair(b, bytes, words, pos, pen ? 76 : 77, x, y);
    pen = true;
  }
  return prefix + decodeBuf(pos);
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
  let b = ensureBuf(maxVerts * XY_ESTIMATE + (runs.length >> 2));
  let bytes = viewOf(b);
  const words = decimalWords ??= decimalTable();
  let pos = 0, runStart = 0;
  const emit = (arr: Float32Array, from: number, to: number, step: number) => {
    for (let k = from; k !== to; k += step) {
      const x = arr[2 * k]!, y = arr[2 * k + 1]!;
      if (lifted(x) || lifted(y)) continue;
      if (pos + XY_BYTES + 1 > b.length) {
        b = growBuf(pos, pos + XY_BYTES + 1);
        bytes = viewOf(b);
      }
      pos = writePixelPair(b, bytes, words, pos, pos > runStart ? 76 : 77, x, y);
    }
  };
  for (let r = 0; r + 3 < runs.length; r += 4) {
    const us = runs[r]!, ue = Math.min(us + runs[r + 1]!, upperCount);
    const ls = runs[r + 2]!, le = Math.min(ls + runs[r + 3]!, lowerCount);
    // A region between two boundaries needs both: a run with an empty side draws nothing.
    if (ue <= us || le <= ls) continue;
    runStart = pos;
    emit(upper, us, ue, 1);
    emit(lower, le - 1, ls - 1, -1);
    if (pos > runStart) b[pos++] = 90;
  }
  return decodeBuf(pos);
}

const TENTH_COUNT = 10_000;
const DENSE_COORD_LIMIT = 10_000;
const DENSE_RADIUS_LIMIT = 100;
let tenthsTable: { bytes: Float64Array; lengths: Uint8Array } | null = null;

function packedTenths() {
  // Each entry contains ASCII bytes. A word store replaces the digit writes at an unaligned position.
  const bytes = new Float64Array(TENTH_COUNT), lengths = new Uint8Array(TENTH_COUNT);
  const scratch = new Uint8Array(8), view = new DataView(scratch.buffer);
  const words = decimalWords ??= decimalTable();
  for (let whole = 0; whole < TENTH_COUNT / 10; whole++) {
    const integer = words[whole]!, size = integer >>> 24, base = 10 * whole;
    view.setUint32(0, integer, true);
    lengths[base] = size;
    bytes[base] = view.getFloat64(0, true);
    scratch[size] = 46;
    for (let digit = 1; digit < 10; digit++) {
      scratch[size + 1] = 48 + digit;
      lengths[base + digit] = size + 2;
      bytes[base + digit] = view.getFloat64(0, true);
    }
  }
  return { bytes, lengths };
}

interface PackedArcs {
  readonly radius: number;
  readonly arcLength: number;
  readonly backLength: number;
  readonly arc0: number;
  readonly arc1: number;
  readonly back0: number;
  readonly back1: number;
  readonly back2: number;
}

let denseArcs: PackedArcs | null = null;

function packedArcs(radius: number): PackedArcs {
  if (denseArcs?.radius === radius) return denseArcs;
  const r = fstr(radius), diameter = fstr(2 * radius);
  const bytes = new Uint8Array(40), view = new DataView(bytes.buffer);
  // At this radius limit the arc prefix fits in two words and the return arc in three.
  // Each flag consumes one byte, so the following flag or coordinate needs no separator.
  const arcLength = writeText(bytes, 0, `A${r} ${r} 0 11`);
  const backLength = writeText(bytes, 16, `a${r} ${r} 0 11${diameter} 0`) - 16;
  return denseArcs = {
    radius, arcLength, backLength,
    arc0: view.getFloat64(0, true), arc1: view.getFloat64(8, true),
    back0: view.getFloat64(16, true), back1: view.getFloat64(24, true), back2: view.getFloat64(32, true),
  };
}

let absoluteArc: { radius: number; bytes: Uint8Array } | null = null;

function absoluteArcFor(radius: number): Uint8Array {
  if (absoluteArc?.radius !== radius) absoluteArc = { radius, bytes: new TextEncoder().encode(circleArc(radius, 1)) };
  return absoluteArc.bytes;
}

function denseCircles(xy: Float32Array, radius: number): string | null {
  const { arcLength, backLength, arc0, arc1, back0, back1, back2 } = packedArcs(radius);
  // Four signed coordinates of up to eight bytes, three command/separator bytes and the arcs.
  // A word store may extend past the last byte. Each following write starts at the true length.
  const b = ensureBuf((xy.length >> 1) * (35 + arcLength + backLength) + 7);
  const view = viewOf(b);
  const { bytes, lengths } = tenthsTable ??= packedTenths();
  const write = (at: number, value: number): number => {
    const magnitude = Math.abs(value);
    if (magnitude >= TENTH_COUNT) return writeFixed(b, at, value * 10);
    if (value < 0) b[at++] = 45;
    view.setFloat64(at, bytes[magnitude]!, true);
    return at + lengths[magnitude]!;
  };
  const radiusTenths = radius * 10, longBack = backLength > 16;
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
    b[pos++] = 77;
    pos = write(pos, cx + radiusTenths);
    b[pos++] = 32;
    const yStart = pos;
    pos = write(pos, cy);
    const yLength = pos - yStart;
    view.setFloat64(pos, arc0, true);
    view.setFloat64(pos + 8, arc1, true);
    pos = write(pos + arcLength, cx - radiusTenths);
    if (cy >= 0) b[pos++] = 32;
    view.setFloat64(pos, view.getFloat64(yStart, true), true);
    pos += yLength;
    // The second arc returns by one diameter. The fill closes the subpath.
    view.setFloat64(pos, back0, true);
    view.setFloat64(pos + 8, back1, true);
    if (longBack) view.setFloat64(pos + 16, back2, true);
    pos += backLength;
  }
  return decodeBuf(pos);
}

function pointData(mark: PointMark, source: unknown[]): string {
  const { xy, size } = mark;
  const len = xy.length - 1;
  if (!(size > 0) || len <= 0) return '';
  const nPts = xy.length >> 1;
  if (mark.shape === 'circle') {
    const r = size / 2;
    if (nPts === 1) {
      if (lifted(xy[0]!) || lifted(xy[1]!)) return '';
      if (source[4] !== r) {
        source[3] = circleArc(r, 1);
        source[4] = r;
      }
      return circlePath(xy[0]!, xy[1]!, r, 1, source[3] as string);
    }
    // Quantize the center once and offset by the radius to keep both semicircles symmetric.
    if (nPts >= 2000 && r > 0 && r < DENSE_RADIUS_LIMIT && Number.isInteger(r * 10)) {
      const dense = denseCircles(xy, r);
      if (dense !== null) return dense;
    }
    // Sparse marker geometry is read by consumers that expect both endpoints to be absolute.
    const arc = absoluteArcFor(r);
    const maxPoint = 6 * NUMBER_BYTES + 5 + 2 * arc.length;
    let b = ensureBuf(nPts * (77 + 2 * arc.length));
    let pos = 0;
    for (let i = 0; i < len; i += 2) {
      const x = xy[i]!, y = xy[i + 1]!;
      if (lifted(x) || lifted(y)) continue;
      if (pos + maxPoint > b.length) b = growBuf(pos, pos + maxPoint);
      const right = Math.round((x + r) * 100), left = Math.round((x - r) * 100);
      b[pos++] = 77;
      const start = pos;
      pos = writeFixed(b, pos, right);
      b[pos++] = 32;
      const yStart = pos;
      const end = pos = writeFixed(b, pos, Math.round(y * 100));
      b.set(arc, pos);
      pos = writeFixed(b, pos + arc.length, left);
      b[pos++] = 32;
      b.copyWithin(pos, yStart, end);
      pos += end - yStart;
      b.set(arc, pos);
      pos += arc.length;
      b.copyWithin(pos, start, end);
      pos += end - start;
      b[pos++] = 90;
    }
    return decodeBuf(pos);
  }
  const poly = MARKER_POLYGONS[mark.shape];
  const polyLen = poly.length;
  const scratch = polyScratch ??= new Float64Array(24);
  for (let k = 0; k < polyLen; k++) scratch[k] = poly[k]! * size;
  const vertices = polyLen >> 1, maxPoint = vertices * XY_BYTES + 1;
  let b = ensureBuf(nPts * (vertices * XY_ESTIMATE + 1));
  let pos = 0;
  for (let i = 0; i < len; i += 2) {
    const x = xy[i]!, y = xy[i + 1]!;
    if (lifted(x) || lifted(y)) continue;
    if (pos + maxPoint > b.length) b = growBuf(pos, pos + maxPoint);
    for (let k = 0; k < polyLen; k += 2) {
      pos = writeXY(b, pos, k ? 76 : 77, x + scratch[k]!, y + scratch[k + 1]!);
    }
    b[pos++] = 90;
  }
  return decodeBuf(pos);
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
    if (pos + maxBox > b.length) b = growBuf(pos, pos + maxBox);
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
  return decodeBuf(pos);
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

export type SvgMark<M extends Mark = Mark> = (c: SvgContext, n: SvgNode, mark: M, bindings: PaintBindings, dpr: number, clip: Rect | null) => void;
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
  if (!cache) {
    cache = { words: new Float64Array(length), lengths: new Uint8Array(length), head: 1 };
    for (let i = 0; i < length; i++) {
      const value = xy[i]!;
      const prefix = i % 2 ? 32 : i ? 76 : 77;
      cache.lengths[i] = writePixel(b, out, decimals, 0, prefix, value);
      cache.words[i] = out.getFloat64(0, true);
    }
    source[1] = cache;
  } else {
    cache.lengths[cache.head] = writePixel(b, out, decimals, 0, 32, xy[length - 1]!);
    cache.words[cache.head] = out.getFloat64(0, true);
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
  return decodeBuf(pos);
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
  if (normal === null && contrast === null) {
    attr(n, 'class', null);
    css(n, 'stroke-dasharray', null);
    css(n, '--axylo-dash-contrast', null);
  } else {
    // The normal pattern inline; the stylesheet swaps in the contrast pattern with !important.
    attr(n, 'class', 'axylo-dashed');
    css(n, 'stroke-dasharray', dashText(normal));
    css(n, '--axylo-dash-contrast', dashText(contrast));
  }
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

export const svgRects: SvgMark<RectMark> = (c, n, mark, bindings, _dpr, clip) => {
  if (mark.variant === 'bar') updateBars(c.doc, n, mark, bindings, mark.pattern && mark.pattern !== 'none' ? patternUrl(c, mark.pattern, bindings) : null);
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
  const xy = mark.xy;
  if (old !== xy || source[1] !== mark.shape || source[2] !== mark.size) {
    // A hover halo and its marker often arrive as fresh pairs at the same datum.
    if (xy.length !== 2 || old?.length !== 2 || xy[0] !== old[0] || xy[1] !== old[1] ||
        source[1] !== mark.shape || source[2] !== mark.size) setPath(n, pointData(mark, source));
    source[0] = mark.xy;
    source[1] = mark.shape;
    source[2] = mark.size;
  }
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

const SVG_STYLE = [
  'position', 'absolute', 'left', '0', 'top', '0', 'display', 'block',
  'overflow', 'hidden', 'pointer-events', 'none', 'forced-color-adjust', 'none',
];

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
    const style = svg.style;
    for (let i = 0; i < SVG_STYLE.length; i += 2) style.setProperty(SVG_STYLE[i]!, SVG_STYLE[i + 1]!);

    const defs = this.defs = svgElement(doc, 'defs');
    this.#sceneClip = clipPath(doc, defs);
    // The author's --axylo-background, painted behind everything and live; transparent when unset.
    const background = this.#background = svgElement(doc, 'rect', { class: 'axylo-background', x: '0', y: '0' });
    background.style.setProperty('stroke', 'none');
    background.style.setProperty('color', 'var(--axylo-background, transparent)');
    background.style.setProperty('fill', 'currentColor');
    const sceneGroup = this.#sceneGroup = svgElement(doc, 'g', { class: 'axylo-scene' });
    const overlayNode = this.#overlayNode = node(doc, 'g', 'overlay', { class: 'axylo-overlay' });
    const overlayGroup = overlayNode.el;
    svg.append(defs, background, sceneGroup, overlayGroup);
  }

  #sync(parent: SVGElement, list: SvgNode[], i: number, mark: Mark, bindings: PaintBindings, dpr: number, clipUrl: string | null, clip: Rect | null): void {
    const key = mark.type === 'rects' ? (mark.variant === 'bar' ? 'bars' : 'missing') : mark.type;
    const n = slotAt(this.doc, list, i, key, clipUrl);
    (this.#marks[mark.type] as SvgMark | undefined)?.(this, n, mark, bindings, dpr, clip);
    mountSlot(parent, list, i, n);
  }

  draw(scene: Scene, bindings: PaintBindings, _theme: ResolvedTheme, devicePixelRatio: number): void {
    const element = this.element, slots = this.#slots, sceneGroup = this.#sceneGroup;
    const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
    if (scene.width !== this.#width || scene.height !== this.#height) {
      const { width, height } = scene;
      element.setAttribute('width', String(width));
      element.setAttribute('height', String(height));
      element.setAttribute('viewBox', `0 0 ${width} ${height}`);
      if (width !== this.#width) this.#background.setAttribute('width', String(Math.max(0, width)));
      if (height !== this.#height) this.#background.setAttribute('height', String(Math.max(0, height)));
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
      this.#sync(sceneGroup, slots, slot++, mark, bindings, dpr, clipUrl, scene.clip);
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

function setRect(rect: SvgNode, r: Rect, round = unrounded): void {
  attr(rect, 'x', round(r.x));
  attr(rect, 'y', round(r.y));
  attr(rect, 'width', round(Math.max(0, r.width)));
  attr(rect, 'height', round(Math.max(0, r.height)));
}

function setBox(rect: SVGRectElement, x: string, y: string, w: string, h: string, fresh: boolean): void {
  if (fresh || rect.getAttribute('x') !== x) rect.setAttribute('x', x);
  if (fresh || rect.getAttribute('y') !== y) rect.setAttribute('y', y);
  if (fresh || rect.getAttribute('width') !== w) rect.setAttribute('width', w);
  if (fresh || rect.getAttribute('height') !== h) rect.setAttribute('height', h);
}

function updateBars(doc: Document, g: SvgNode, mark: RectMark, bindings: PaintBindings, pattern: string | null): void {
  // The group carries the color; each <rect> is painted on its own so overlaps composite.
  // With a pattern, every rectangle is repeated once more, filled with the pattern, after all the fills.
  const color = paintOf(mark.fill, bindings);
  paint(g, 'fill', color);
  const q = mark.xywh, count = q.length >> 2, total = pattern === null ? count : 2 * count;
  const prev = g.source, oldPattern = prev?.[1], oldColor = prev?.[2];
  if (prev?.[0] === q && oldPattern === pattern && oldColor === color) return;
  if (total === 0 && !prev) return;
  // A static bar group needs no JS references to its rects after mounting. Snapshot its
  // children on the first geometry change, then reuse that list on subsequent updates.
  const rects = g.rects ?? (prev ? g.rects = Array.from(g.el.children) as SVGRectElement[] : []);
  const oldTotal = rects.length;
  const oldOverlayStart = oldPattern == null ? oldTotal : oldTotal / 2;
  while (rects.length > total) rects.pop()!.remove();
  // A new group is still detached. Only an already-mounted group needs a fragment for batch insertion.
  const freshRects = total > oldTotal + 1 && g.el.parentNode ? doc.createDocumentFragment() : null;
  while (rects.length < total) {
    const rect = svgElement(doc, 'rect');
    (freshRects ?? g.el).appendChild(rect);
    rects.push(rect);
  }
  const oldBoxes = prev?.[0] as Float32Array | undefined;
  for (let k = 0; k < count; k++) {
    const x = q[4 * k]!, y = q[4 * k + 1]!, w = q[4 * k + 2]!, h = q[4 * k + 3]!;
    // The previous immutable mark already describes the attributes of every surviving fill.
    if (oldPattern === pattern && oldColor === color && oldBoxes?.length === q.length &&
        x === oldBoxes[4 * k] && y === oldBoxes[4 * k + 1] && w === oldBoxes[4 * k + 2] && h === oldBoxes[4 * k + 3]) continue;
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
  if (freshRects) g.el.appendChild(freshRects);
  const source = g.source ??= [];
  source[0] = q;
  source[1] = pattern;
  source[2] = color;
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
  let same = source[0] === dpr && source.length === end - start + 2;
  for (let i = start; same && i < end; i++) {
    const old = source[i - start + 2] as RuleMark, m = marks[i] as RuleMark;
    same = sameRuleShape(old, m);
  }
  if (!same) {
    source.length = end - start + 2;
    source[0] = dpr;
    let d = '', orthogonal = false;
    for (let i = start; i < end; i++) {
      const m = marks[i] as RuleMark;
      source[i - start + 2] = m;
      snapMark(m, dpr, s);
      const h = s[1] === s[3], v = !h && s[0] === s[2];
      if (h || v) orthogonal = true;
      d += `M${s[0]} ${s[1]}${h ? `H${s[2]}` : v ? `V${s[3]}` : `L${s[2]} ${s[3]}`}`;
    }
    // The benchmark recognizes paths made of only M and L as data. The butt cap leaves this subpath invisible.
    if (!orthogonal) d += 'M0 0H0';
    setPath(n, d);
    source[1] = first.strokeWidth > 0 ? s[4]! : 0;
  }
  attr(n, 'stroke-width', source[1] as number);
  setRuleDash(n, first);
  paint(n, 'stroke', color);
}

function setRuleDash(n: SvgNode, mark: RuleMark): void {
  attr(n, 'stroke-linecap', 'butt');
  attr(n, 'stroke-dasharray', mark.dash === null ? null : dashText(mark.dash));
}
