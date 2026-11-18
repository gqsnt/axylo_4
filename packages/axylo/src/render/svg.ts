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
 * One element per mark (a group for bars and slices), reused between draws when the mark at the same
 * position has the same kind; attributes are only written when their value changed, and a mark's path data
 * is not even rebuilt when its coordinate arrays are the same objects as last time. Scene arrays must
 * therefore never be mutated in place: a changed geometry is a new array.
 */
import type { AreaMark, ArcMark, Mark, MarkRenderer, Overlay, PaintBindings, PathMark, PointMark, Rect, RectMark, ResolvedTheme, RuleMark, Scene } from '../core/contracts';
import {
  DOT_RADIUS, DOT_TILE, dashText, lifted, MARKER_POLYGONS, PATTERN_LINE, PATTERN_TILE, MISSING_STROKE, missingBox, paintOf, sector, SECTOR_APEX, SECTOR_ARCS, SECTOR_NONE, SECTOR_RING, snapRule, unclippedRule,
} from './geometry';

const NS = 'http://www.w3.org/2000/svg';
let ids = 0;

/** An element plus what was last written to it, so unchanged values are not written again. */
interface Node {
  readonly key: string;
  readonly el: SVGElement;
  readonly attrs: Map<string, string>;
  readonly styles: Map<string, string>;
  readonly kids: Node[];
  /** The inputs the current `d` was built from, compared by identity. */
  source: readonly unknown[] | null;
}

function node(doc: Document, tag: string, key: string): Node {
  return { key, el: doc.createElementNS(NS, tag) as SVGElement, attrs: new Map(), styles: new Map(), kids: [], source: null };
}

/** Sets `d` from `build()` unless every input is identical (===) to the ones the current `d` came from. */
function data(n: Node, source: readonly unknown[], build: () => string): void {
  const last = n.source;
  if (last !== null && last.length === source.length && last.every((v, i) => v === source[i])) return;
  n.source = source;
  attr(n, 'd', build());
}

/** Paints `role` ('fill' or 'stroke') with a CSS color expression, through `color` and currentColor. */
function paint(n: Node, role: 'fill' | 'stroke', value: string | null): void {
  const other = role === 'fill' ? 'stroke' : 'fill';
  css(n, other, 'none');
  if (value === null) { css(n, role, 'none'); css(n, 'color', null); return; }
  css(n, 'color', value);
  css(n, role, 'currentColor');
}

function attr(n: Node, name: string, value: string | null): void {
  if (value === null) {
    if (n.attrs.has(name)) { n.attrs.delete(name); n.el.removeAttribute(name); }
  } else if (n.attrs.get(name) !== value) {
    n.attrs.set(name, value);
    n.el.setAttribute(name, value);
  }
}

// Style properties, not presentation attributes: those do not accept var(), and CSSOM writes are allowed
// under a Content Security Policy without 'unsafe-inline' (spec DX8).
function css(n: Node, name: string, value: string | null): void {
  if (value === null) {
    if (n.styles.has(name)) { n.styles.delete(name); n.el.style.removeProperty(name); }
  } else if (n.styles.get(name) !== value) {
    n.el.style.setProperty(name, value);
    // Remember only what the CSSOM accepted, so a rejected value is not taken as written next time.
    if (n.el.style.getPropertyValue(name) !== '') n.styles.set(name, value);
    else n.styles.delete(name);
  }
}

/** Two decimals: well below a device pixel at any realistic ratio, and keeps `d` short. */
const f = (v: number): number => Math.round(v * 100) / 100;

/**
 * Builds path data in chunks: each chunk is a short string built by appending, and the chunks are joined
 * once, so neither a huge rope nor one array entry per vertex is created.
 */
class PathText {
  private parts: string[] = [];
  private chunk = '';
  private n = 0;
  add(s: string): void {
    this.chunk += s;
    if (++this.n === 1024) { this.parts.push(this.chunk); this.chunk = ''; this.n = 0; }
  }
  done(): string {
    if (this.parts.length === 0) return this.chunk;
    this.parts.push(this.chunk);
    return this.parts.join('');
  }
}

export function pathData(xy: Float32Array): string {
  const out = new PathText();
  let pen = false;
  for (let i = 0; i + 1 < xy.length; i += 2) {
    const x = xy[i]!;
    const y = xy[i + 1]!;
    if (lifted(x) || lifted(y)) { pen = false; continue; }
    out.add((pen ? 'L' : 'M') + f(x) + ' ' + f(y));
    pen = true;
  }
  return out.done();
}

export function areaData(mark: AreaMark): string {
  const { upper, lower, runs } = mark;
  const upperCount = upper.length >> 1;
  const lowerCount = lower.length >> 1;
  const out = new PathText();
  for (let r = 0; r + 3 < runs.length; r += 4) {
    const us = runs[r]!;
    const ue = Math.min(us + runs[r + 1]!, upperCount);
    const ls = runs[r + 2]!;
    const le = Math.min(ls + runs[r + 3]!, lowerCount);
    // A region between two boundaries needs both: a run with an empty side draws nothing.
    if (ue <= us || le <= ls) continue;
    let started = false;
    for (let k = us; k < ue; k++) {
      const x = upper[2 * k]!, y = upper[2 * k + 1]!;
      if (lifted(x) || lifted(y)) continue;
      out.add((started ? 'L' : 'M') + f(x) + ' ' + f(y));
      started = true;
    }
    for (let k = le - 1; k >= ls; k--) {
      const x = lower[2 * k]!, y = lower[2 * k + 1]!;
      if (lifted(x) || lifted(y)) continue;
      out.add((started ? 'L' : 'M') + f(x) + ' ' + f(y));
      started = true;
    }
    if (started) out.add('Z');
  }
  return out.done();
}

function pointData(mark: PointMark): string {
  const { xy, size } = mark;
  const out = new PathText();
  if (!(size > 0)) return '';
  const r = size / 2;
  if (mark.shape === 'circle') {
    const a = ` A${f(r)} ${f(r)} 0 1 1 `;
    for (let i = 0; i + 1 < xy.length; i += 2) {
      const x = xy[i]!, y = xy[i + 1]!;
      if (lifted(x) || lifted(y)) continue;
      // Two half circles, clockwise like the polygons, so overlapping markers union under nonzero.
      out.add('M' + f(x + r) + ' ' + f(y) + a + f(x - r) + ' ' + f(y) + a + f(x + r) + ' ' + f(y) + 'Z');
    }
    return out.done();
  }
  const poly = MARKER_POLYGONS[mark.shape];
  for (let i = 0; i + 1 < xy.length; i += 2) {
    const x = xy[i]!, y = xy[i + 1]!;
    if (lifted(x) || lifted(y)) continue;
    let s = 'M' + f(x + poly[0]! * size) + ' ' + f(y + poly[1]! * size);
    for (let k = 2; k < poly.length; k += 2) s += 'L' + f(x + poly[k]! * size) + ' ' + f(y + poly[k + 1]! * size);
    out.add(s + 'Z');
  }
  return out.done();
}

function missingData(mark: RectMark, box: Float64Array, clip: Rect | null): string {
  const q = mark.xywh;
  const out = new PathText();
  for (let i = 0; i + 3 < q.length; i += 4) {
    const x = q[i]!, y = q[i + 1]!, w = q[i + 2]!, h = q[i + 3]!;
    if (lifted(x) || lifted(y) || lifted(w) || lifted(h)) continue;
    missingBox(x, y, w, h, box, clip);
    const bx = f(box[0]!), by = f(box[1]!), bw = f(box[2]!), bh = f(box[3]!);
    out.add(`M${bx} ${by}h${bw}v${bh}h${-bw}Z` + `M${bx} ${f(by + bh)}L${f(bx + bw)} ${by}`);
  }
  return out.done();
}

function sectorData(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number, gap: number, s: Float64Array): string {
  const kind = sector(a0, a1, r0, r1, gap, s);
  if (kind === SECTOR_NONE) return '';
  const px = (r: number, a: number): string => f(cx + r * Math.cos(a)) + ' ' + f(cy + r * Math.sin(a));
  if (kind === SECTOR_RING) {
    let d = `M${f(cx + r1)} ${f(cy)}A${f(r1)} ${f(r1)} 0 1 1 ${f(cx - r1)} ${f(cy)}A${f(r1)} ${f(r1)} 0 1 1 ${f(cx + r1)} ${f(cy)}Z`;
    if (r0 > 0) d += `M${f(cx + r0)} ${f(cy)}A${f(r0)} ${f(r0)} 0 1 0 ${f(cx - r0)} ${f(cy)}A${f(r0)} ${f(r0)} 0 1 0 ${f(cx + r0)} ${f(cy)}Z`;
    return d;
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
  path: 'path', area: 'path', bars: 'g', missing: 'path', points: 'path', arcs: 'g', rule: 'line', band: 'rect',
};

export function createSvgRenderer(doc: Document = document): MarkRenderer {
  const svg = doc.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'axylo-svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const [k, v] of [
    ['position', 'absolute'], ['left', '0'], ['top', '0'], ['display', 'block'], ['overflow', 'hidden'], ['pointer-events', 'none'],
    ['forced-color-adjust', 'none'],
  ] as const) svg.style.setProperty(k, v);

  const defs = doc.createElementNS(NS, 'defs');
  const sceneClipId = `axylo-clip-${++ids}`;
  const overlayClipId = `axylo-clip-${++ids}`;
  const sceneClip = clipPath(doc, defs, sceneClipId);
  const overlayClip = clipPath(doc, defs, overlayClipId);
  // The author's --axylo-background, painted behind everything and live; transparent when unset.
  const background = node(doc, 'rect', 'background');
  background.el.setAttribute('class', 'axylo-background');
  attr(background, 'x', '0');
  attr(background, 'y', '0');
  paint(background, 'fill', 'var(--axylo-background, transparent)');
  const sceneGroup = doc.createElementNS(NS, 'g');
  sceneGroup.setAttribute('class', 'axylo-scene');
  const overlayGroup = doc.createElementNS(NS, 'g');
  overlayGroup.setAttribute('class', 'axylo-overlay');
  svg.append(defs, background.el, sceneGroup, overlayGroup);

  // Bar patterns (spec F9), one definition per kind, created on first use. Their color is the background
  // paint, set on the <pattern> element because its content inherits from there, not from the bar.
  const patterns = new Map<string, { id: string; node: Node }>();
  const patternUrl = (kind: 'diagonal' | 'cross' | 'dots', bindings: PaintBindings): string => {
    let p = patterns.get(kind);
    if (p === undefined) {
      const id = `axylo-pattern-${++ids}`;
      const el = node(doc, 'pattern', 'pattern');
      el.el.setAttribute('id', id);
      el.el.setAttribute('patternUnits', 'userSpaceOnUse');
      el.el.setAttribute('x', '0');
      el.el.setAttribute('y', '0');
      const tile = kind === 'dots' ? DOT_TILE : PATTERN_TILE;
      el.el.setAttribute('width', String(tile));
      el.el.setAttribute('height', String(tile));
      const shape = doc.createElementNS(NS, 'path');
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
      el.el.appendChild(shape);
      defs.appendChild(el.el);
      p = { id, node: el };
      patterns.set(kind, p);
    }
    css(p.node, 'color', bindings.tokens.background);
    return `url(#${p.id})`;
  };

  const scratch = new Float64Array(8);
  let slots: Node[] = [];
  let width = -1;
  let height = -1;

  function update(n: Node, mark: Mark, bindings: PaintBindings, dpr: number, clipUrl: string | null, clip: Rect | null): void {
    attr(n, 'clip-path', clipUrl);
    switch (mark.type) {
      case 'path': updatePath(n, mark, bindings); break;
      case 'area':
        data(n, [mark.upper, mark.lower, mark.runs], () => areaData(mark));
        paint(n, 'fill', paintOf(mark.fill, bindings));
        css(n, 'fill-opacity', String(mark.opacity));
        break;
      case 'rects':
        if (mark.variant === 'bar') updateBars(doc, n, mark, bindings, mark.pattern === undefined || mark.pattern === 'none' ? null : patternUrl(mark.pattern, bindings));
        else {
          data(n, [mark.xywh, clip?.x, clip?.y, clip?.width, clip?.height], () => missingData(mark, scratch, clip));
          paint(n, 'stroke', paintOf(mark.fill, bindings));
          attr(n, 'stroke-width', String(MISSING_STROKE));
          attr(n, 'stroke-linejoin', 'miter');
        }
        break;
      case 'points':
        data(n, [mark.xy, mark.shape, mark.size], () => pointData(mark));
        paint(n, 'fill', paintOf(mark.fill, bindings));
        break;
      case 'arcs': updateArcs(doc, n, mark, bindings, scratch); break;
      case 'rule': updateRule(n, mark, bindings, dpr, scratch); break;
      case 'band':
        attr(n, 'x', String(f(mark.box.x)));
        attr(n, 'y', String(f(mark.box.y)));
        attr(n, 'width', String(f(Math.max(0, mark.box.width))));
        attr(n, 'height', String(f(Math.max(0, mark.box.height))));
        paint(n, 'fill', paintOf(mark.fill, bindings));
        css(n, 'fill-opacity', String(mark.opacity));
        break;
    }
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
        attr(background, 'width', String(Math.max(0, width)));
        attr(background, 'height', String(Math.max(0, height)));
      }
      setRect(sceneClip, scene.clip);
      const url = `url(#${sceneClipId})`;
      const next: Node[] = [];
      scene.marks.forEach((mark, i) => {
        const key = keyOf(mark);
        let n = slots[i];
        if (n === undefined || n.key !== key) {
          const fresh = node(doc, TAGS[key]!, key);
          if (n === undefined) sceneGroup.appendChild(fresh.el);
          else sceneGroup.replaceChild(fresh.el, n.el);
          n = fresh;
        }
        update(n, mark, bindings, dpr, mark.type === 'rule' && unclippedRule(mark.role) ? null : url, scene.clip);
        next.push(n);
      });
      for (let i = scene.marks.length; i < slots.length; i++) slots[i]!.el.remove();
      slots = next;
    },
    drawOverlay(overlay: Overlay | null, bindings: PaintBindings, _theme: ResolvedTheme, devicePixelRatio: number): void {
      const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
      overlayGroup.replaceChildren();
      if (overlay === null) return;
      setRect(overlayClip, overlay.clip);
      const url = `url(#${overlayClipId})`;
      const add = (mark: Mark, clipUrl: string | null, clip: Rect | null): void => {
        const key = keyOf(mark);
        const n = node(doc, TAGS[key]!, key);
        update(n, mark, bindings, dpr, clipUrl, clip);
        overlayGroup.appendChild(n.el);
      };
      for (const m of overlay.clipped) add(m, url, overlay.clip);
      for (const m of overlay.unclipped) add(m, null, null);
    },
    destroy(): void {
      svg.remove();
      slots = [];
    },
  };
}

function clipPath(doc: Document, defs: SVGElement, id: string): Node {
  const clip = doc.createElementNS(NS, 'clipPath');
  clip.setAttribute('id', id);
  clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
  const rect = node(doc, 'rect', 'clip');
  clip.appendChild(rect.el);
  defs.appendChild(clip);
  return rect;
}

function setRect(rect: Node, r: Rect): void {
  attr(rect, 'x', String(r.x));
  attr(rect, 'y', String(r.y));
  attr(rect, 'width', String(Math.max(0, r.width)));
  attr(rect, 'height', String(Math.max(0, r.height)));
}

function updatePath(n: Node, mark: PathMark, bindings: PaintBindings): void {
  data(n, [mark.xy], () => pathData(mark.xy));
  paint(n, 'stroke', paintOf(mark.stroke, bindings));
  attr(n, 'stroke-width', String(mark.strokeWidth));
  attr(n, 'stroke-linejoin', 'round');
  attr(n, 'stroke-linecap', 'butt');
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
}

function updateBars(doc: Document, g: Node, mark: RectMark, bindings: PaintBindings, pattern: string | null): void {
  // The group carries the color; each <rect> is painted on its own, so overlaps composite like canvas.
  // With a pattern, every rectangle is repeated once more, filled with the pattern, after all the fills.
  paint(g, 'fill', paintOf(mark.fill, bindings));
  const q = mark.xywh;
  const count = q.length >> 2;
  const total = pattern === null ? count : 2 * count;
  if (g.source !== null && g.source[0] === q && g.source[1] === pattern && g.kids.length === total) return;
  syncKids(doc, g, total, 'rect');
  g.source = [q, pattern];
  for (let i = 0; i < total; i++) {
    const k = i % count;
    const x = q[4 * k]!, y = q[4 * k + 1]!, w = q[4 * k + 2]!, h = q[4 * k + 3]!;
    const kid = g.kids[i]!;
    const bad = lifted(x) || lifted(y) || lifted(w) || lifted(h);
    attr(kid, 'x', bad ? '0' : String(f(w < 0 ? x + w : x)));
    attr(kid, 'y', bad ? '0' : String(f(h < 0 ? y + h : y)));
    attr(kid, 'width', bad ? '0' : String(f(Math.abs(w))));
    attr(kid, 'height', bad ? '0' : String(f(Math.abs(h))));
    css(kid, 'fill', i >= count ? pattern : null);
  }
}

function updateArcs(doc: Document, g: Node, mark: ArcMark, bindings: PaintBindings, s: Float64Array): void {
  const count = mark.angles.length >> 1;
  syncKids(doc, g, count, 'path');
  const same = g.source !== null && g.source[0] === mark.angles && g.source[1] === mark.cx && g.source[2] === mark.cy &&
    g.source[3] === mark.r0 && g.source[4] === mark.r1 && g.source[5] === mark.gap;
  g.source = [mark.angles, mark.cx, mark.cy, mark.r0, mark.r1, mark.gap];
  for (let i = 0; i < count; i++) {
    const kid = g.kids[i]!;
    const fill = mark.fills[i];
    if (!same) attr(kid, 'd', sectorData(mark.cx, mark.cy, mark.r0, mark.r1, mark.angles[2 * i]!, mark.angles[2 * i + 1]!, mark.gap, s));
    paint(kid, 'fill', fill === undefined ? null : paintOf(fill, bindings));
  }
}

function updateRule(n: Node, mark: RuleMark, bindings: PaintBindings, dpr: number, s: Float64Array): void {
  snapRule(mark.x1, mark.y1, mark.x2, mark.y2, mark.strokeWidth, dpr, s);
  attr(n, 'x1', String(s[0]));
  attr(n, 'y1', String(s[1]));
  attr(n, 'x2', String(s[2]));
  attr(n, 'y2', String(s[3]));
  attr(n, 'stroke-width', String(mark.strokeWidth > 0 ? s[4] : 0));
  attr(n, 'stroke-linecap', 'butt');
  attr(n, 'stroke-dasharray', mark.dash === null ? null : dashText(mark.dash));
  paint(n, 'stroke', paintOf(mark.stroke, bindings));
}

function syncKids(doc: Document, parent: Node, count: number, tag: string): void {
  if (parent.kids.length !== count) parent.source = null;
  while (parent.kids.length > count) parent.kids.pop()!.el.remove();
  while (parent.kids.length < count) {
    const kid = node(doc, tag, tag);
    parent.el.appendChild(kid.el);
    parent.kids.push(kid);
  }
}
