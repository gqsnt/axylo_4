/**
 * Canvas 2D mark renderer (plan 2.3). Paints with `theme.paints` (concrete colors), so the chart must call
 * `draw` again after a theme change. Two stacked canvases: the scene, and the overlay above it, so a cursor
 * or focus ring can move without repainting the marks. The overlay's backing store is only allocated when an
 * overlay is first drawn.
 *
 * Coordinates in the scene are CSS px. The backing store is CSS size × pixel ratio, with the ratio capped
 * so neither canvas exceeds MAX_PIXELS or MAX_SIDE (browsers refuse larger canvases, and memory is part
 * of the renderer comparison in plan 2.3); the transform is the actual backing-to-CSS ratio per axis.
 * Nothing in the drawing loops allocates per vertex or per point.
 */
import type { AreaMark, ArcMark, BandMark, Mark, MarkRenderer, Overlay, PaintBindings, PathMark, PointMark, Rect, RectMark, ResolvedTheme, RuleMark, Scene } from '../core/contracts';
import type { ResolvedThemeDetails } from '../theme/resolve';
import {
  DOT_RADIUS, DOT_TILE, lifted, MARKER_POLYGONS, MISSING_STROKE, PATTERN_LINE, PATTERN_TILE, missingBox, paintOf, sector, SECTOR_APEX, SECTOR_ARCS, SECTOR_RING, snapRule, unclippedRule,
} from './geometry';

const SOLID: readonly number[] = [];
const TAU = Math.PI * 2;

/** Largest backing store per canvas, in device pixels: 4096², the common limit of mobile browsers. */
export const MAX_PIXELS = 16_777_216;
/** Largest backing store side, in device pixels. */
export const MAX_SIDE = 8192;

type Ctx = CanvasRenderingContext2D;

/** Backing size for a CSS size at a requested ratio, within MAX_PIXELS and MAX_SIDE. Pure. */
export function backingSize(width: number, height: number, dpr: number): [number, number] {
  const w = Math.max(0, width), h = Math.max(0, height);
  let ratio = dpr > 0 ? dpr : 1;
  if (w > 0) ratio = Math.min(ratio, MAX_SIDE / w);
  if (h > 0) ratio = Math.min(ratio, MAX_SIDE / h);
  if (w * h > 0) ratio = Math.min(ratio, Math.sqrt(MAX_PIXELS / (w * h)));
  let bw = Math.min(MAX_SIDE, Math.round(w * ratio));
  let bh = Math.min(MAX_SIDE, Math.round(h * ratio));
  // Rounding up both sides can overshoot the pixel budget by a row or column.
  while (bw * bh > MAX_PIXELS) { bw = Math.floor(w * (ratio *= 0.999)); bh = Math.floor(h * ratio); }
  return [bw, bh];
}

export function createCanvasRenderer(doc: Document = document): MarkRenderer {
  const element = doc.createElement('div');
  element.className = 'axylo-canvas';
  element.setAttribute('aria-hidden', 'true');
  setStyles(element, { position: 'absolute', left: '0', top: '0', 'pointer-events': 'none' });
  const sceneCanvas = doc.createElement('canvas');
  const overlayCanvas = doc.createElement('canvas');
  for (const c of [sceneCanvas, overlayCanvas]) {
    setStyles(c, { position: 'absolute', left: '0', top: '0', display: 'block', width: '0px', height: '0px' });
    element.appendChild(c);
  }
  // A new canvas has a 300 × 150 store; the overlay gets one only when an overlay is drawn.
  overlayCanvas.width = 0;
  overlayCanvas.height = 0;
  const sceneCtx = sceneCanvas.getContext('2d');
  const overlayCtx = overlayCanvas.getContext('2d');
  if (sceneCtx === null || overlayCtx === null) throw new Error('Axylo: this browser cannot create a 2D canvas context.');

  const scratch = new Float64Array(8);
  let cssWidth = -1;
  let cssHeight = -1;
  let requested = 1;
  let backing: [number, number] = [0, 0];
  let overlay: Overlay | null = null;
  let overlayTheme: ResolvedTheme | null = null;
  let overlayAllocated = false;

  /** Sets the backing store if it differs; returns whether it changed (which clears it). */
  function fit(canvas: HTMLCanvasElement): boolean {
    const [bw, bh] = backing;
    if (canvas.width === bw && canvas.height === bh) return false;
    canvas.width = bw;
    canvas.height = bh;
    return true;
  }

  function begin(ctx: Ctx, canvas: HTMLCanvasElement): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scaleX(), 0, 0, scaleY(), 0, 0);
  }

  const scaleX = (): number => (cssWidth > 0 ? backing[0] / cssWidth : requested);
  const scaleY = (): number => (cssHeight > 0 ? backing[1] / cssHeight : requested);

  function resize(width: number, height: number, dpr: number): void {
    if (width !== cssWidth || height !== cssHeight) {
      cssWidth = width;
      cssHeight = height;
      // CSS size is set on its own: a backing store that happens to match must not skip it.
      for (const el of [element, sceneCanvas, overlayCanvas]) {
        el.style.setProperty('width', `${width}px`);
        el.style.setProperty('height', `${height}px`);
      }
    }
    requested = dpr;
    backing = backingSize(width, height, dpr);
  }

  function paintOverlay(): void {
    begin(overlayCtx!, overlayCanvas);
    if (overlay === null || overlayTheme === null) return;
    const contrast = overlayTheme.moreContrast || overlayTheme.forcedColors;
    const sx = scaleX(), sy = scaleY();
    paintMarks(overlayCtx!, overlay.clipped, overlay.clip, false, overlayTheme.paints, contrast, sx, sy, scratch);
    paintMarks(overlayCtx!, overlay.unclipped, null, false, overlayTheme.paints, contrast, sx, sy, scratch);
  }

  return {
    kind: 'canvas',
    element,
    draw(scene: Scene, _bindings: PaintBindings, theme: ResolvedTheme, devicePixelRatio: number): void {
      resize(scene.width, scene.height, devicePixelRatio > 0 ? devicePixelRatio : 1);
      fit(sceneCanvas);
      begin(sceneCtx, sceneCanvas);
      const background = (theme as ResolvedThemeDetails).plotBackground;
      if (background != null && background !== '') {
        sceneCtx.fillStyle = background;
        sceneCtx.fillRect(0, 0, scene.width, scene.height);
      }
      paintMarks(sceneCtx, scene.marks, scene.clip, true, theme.paints, theme.moreContrast || theme.forcedColors, scaleX(), scaleY(), scratch);
      if (overlayAllocated) {
        // A resize clears the overlay canvas; a theme change makes its colors stale. Either way repaint it.
        const resized = fit(overlayCanvas);
        if (overlay !== null && (resized || overlayTheme !== theme)) {
          overlayTheme = theme;
          paintOverlay();
        }
      }
    },
    drawOverlay(next: Overlay | null, _bindings: PaintBindings, theme: ResolvedTheme, devicePixelRatio: number): void {
      overlay = next;
      overlayTheme = theme;
      if (next === null && !overlayAllocated) return;
      overlayAllocated = true;
      // Before the first scene there is no size yet; draw() paints the overlay once there is.
      if (cssWidth < 0) { requested = devicePixelRatio > 0 ? devicePixelRatio : 1; return; }
      fit(overlayCanvas);
      paintOverlay();
    },
    destroy(): void {
      element.remove();
      // Releases the backing stores now rather than whenever the element is collected.
      sceneCanvas.width = sceneCanvas.height = 0;
      overlayCanvas.width = overlayCanvas.height = 0;
      overlay = null;
    },
  };
}

function setStyles(el: HTMLElement, styles: Readonly<Record<string, string>>): void {
  for (const name in styles) el.style.setProperty(name, styles[name]!);
}

/**
 * Paints marks back to front. With `byRole`, axis and tick rules escape the clip (scene contract); without
 * it, every mark is clipped to `clip` when one is given (overlay lists).
 */
function paintMarks(ctx: Ctx, marks: readonly Mark[], clip: Rect | null, byRole: boolean, paints: PaintBindings, contrast: boolean, sx: number, sy: number, scratch: Float64Array): void {
  let clipped = false;
  for (const mark of marks) {
    const want = clip !== null && !(byRole && mark.type === 'rule' && unclippedRule(mark.role));
    if (want !== clipped) {
      if (clipped) ctx.restore();
      else {
        ctx.save();
        ctx.beginPath();
        ctx.rect(clip!.x, clip!.y, clip!.width, clip!.height);
        ctx.clip();
      }
      clipped = want;
    }
    ctx.globalAlpha = 1;
    switch (mark.type) {
      case 'path': paintPath(ctx, mark, paints, contrast); break;
      case 'area': paintArea(ctx, mark, paints); break;
      case 'rects': paintRects(ctx, mark, paints, clip, scratch, sx, sy); break;
      case 'points': paintPoints(ctx, mark, paints); break;
      case 'arcs': paintArcs(ctx, mark, paints, scratch); break;
      case 'rule': paintRule(ctx, mark, paints, sx, sy, scratch); break;
      case 'band': paintBand(ctx, mark, paints); break;
    }
  }
  if (clipped) ctx.restore();
}

function paintPath(ctx: Ctx, mark: PathMark, paints: PaintBindings, contrast: boolean): void {
  const color = paintOf(mark.stroke, paints);
  if (color === null || !(mark.strokeWidth > 0)) return;
  const xy = mark.xy;
  ctx.beginPath();
  let pen = false;
  for (let i = 0; i + 1 < xy.length; i += 2) {
    const x = xy[i]!;
    const y = xy[i + 1]!;
    if (lifted(x) || lifted(y)) { pen = false; continue; }
    if (pen) ctx.lineTo(x, y);
    else { ctx.moveTo(x, y); pen = true; }
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = mark.strokeWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';
  ctx.setLineDash((contrast ? mark.dash.contrast : mark.dash.normal) ?? SOLID);
  ctx.stroke();
  ctx.setLineDash(SOLID);
}

function paintArea(ctx: Ctx, mark: AreaMark, paints: PaintBindings): void {
  const color = paintOf(mark.fill, paints);
  if (color === null) return;
  const { upper, lower, runs } = mark;
  const upperCount = upper.length >> 1;
  const lowerCount = lower.length >> 1;
  ctx.beginPath();
  for (let r = 0; r + 3 < runs.length; r += 4) {
    const us = runs[r]!;
    const ue = Math.min(us + runs[r + 1]!, upperCount);
    const ls = runs[r + 2]!;
    const le = Math.min(ls + runs[r + 3]!, lowerCount);
    // A region between two boundaries needs both: a run with an empty side draws nothing.
    if (ue <= us || le <= ls) continue;
    let started = false;
    for (let k = us; k < ue; k++) {
      const x = upper[2 * k]!;
      const y = upper[2 * k + 1]!;
      if (lifted(x) || lifted(y)) continue;
      if (started) ctx.lineTo(x, y); else { ctx.moveTo(x, y); started = true; }
    }
    for (let k = le - 1; k >= ls; k--) {
      const x = lower[2 * k]!;
      const y = lower[2 * k + 1]!;
      if (lifted(x) || lifted(y)) continue;
      if (started) ctx.lineTo(x, y); else { ctx.moveTo(x, y); started = true; }
    }
    if (started) ctx.closePath();
  }
  ctx.globalAlpha = mark.opacity;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = 1;
}

function paintRects(ctx: Ctx, mark: RectMark, paints: PaintBindings, clip: Rect | null, box: Float64Array, sx = 1, sy = 1): void {
  const color = paintOf(mark.fill, paints);
  if (color === null) return;
  const q = mark.xywh;
  if (mark.variant === 'bar') {
    // Each rectangle on its own, like the SVG renderer's one <rect> each: overlaps composite, and opposite
    // windings cannot cancel. Edges are snapped to device pixels, so the 1 CSS px seam the scene leaves
    // between stacked segments is whole background pixels, not two half-tones (spec A5).
    ctx.fillStyle = color;
    const snapX = (v: number) => Math.round(v * sx) / sx;
    const snapY = (v: number) => Math.round(v * sy) / sy;
    for (let i = 0; i + 3 < q.length; i += 4) {
      const x = q[i]!, y = q[i + 1]!, w = q[i + 2]!, h = q[i + 3]!;
      if (lifted(x) || lifted(y) || lifted(w) || lifted(h)) continue;
      const x0 = snapX(w < 0 ? x + w : x), y0 = snapY(h < 0 ? y + h : y);
      const x1 = snapX((w < 0 ? x + w : x) + Math.abs(w)), y1 = snapY((h < 0 ? y + h : y) + Math.abs(h));
      // A bar thinner than a device pixel keeps one pixel rather than vanishing.
      ctx.fillRect(x0, y0, Math.max(x1 - x0, Math.abs(w) > 0 ? 1 / sx : 0), Math.max(y1 - y0, Math.abs(h) > 0 ? 1 / sy : 0));
    }
    const pattern = mark.pattern;
    const ink = paints.tokens.background;
    if (pattern === undefined || pattern === 'none' || ink === '') return;
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = PATTERN_LINE;
    ctx.lineCap = 'butt';
    ctx.setLineDash(SOLID);
    for (let i = 0; i + 3 < q.length; i += 4) {
      const x = q[i]!, y = q[i + 1]!, w = q[i + 2]!, h = q[i + 3]!;
      if (lifted(x) || lifted(y) || lifted(w) || lifted(h)) continue;
      const x0 = w < 0 ? x + w : x, y0 = h < 0 ? y + h : y, x1 = x0 + Math.abs(w), y1 = y0 + Math.abs(h);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, x1 - x0, y1 - y0);
      ctx.clip();
      ctx.beginPath();
      if (pattern === 'dots') {
        for (let cy = Math.floor(y0 / DOT_TILE) * DOT_TILE + DOT_TILE / 2; cy < y1 + DOT_RADIUS; cy += DOT_TILE) {
          for (let cx = Math.floor(x0 / DOT_TILE) * DOT_TILE + DOT_TILE / 2; cx < x1 + DOT_RADIUS; cx += DOT_TILE) {
            ctx.moveTo(cx + DOT_RADIUS, cy);
            ctx.arc(cx, cy, DOT_RADIUS, 0, TAU);
          }
        }
        ctx.fill();
      } else {
        // Lines x + y = c, then for the cross hatch x − y = c, every PATTERN_TILE.
        for (let c = Math.floor((x0 + y0) / PATTERN_TILE) * PATTERN_TILE; c <= x1 + y1 + PATTERN_TILE; c += PATTERN_TILE) {
          ctx.moveTo(c - y1 - 1, y1 + 1);
          ctx.lineTo(c - y0 + 1, y0 - 1);
        }
        if (pattern === 'cross') {
          for (let c = Math.floor((x0 - y1) / PATTERN_TILE) * PATTERN_TILE; c <= x1 - y0 + PATTERN_TILE; c += PATTERN_TILE) {
            ctx.moveTo(y0 - 1 + c, y0 - 1);
            ctx.lineTo(y1 + 1 + c, y1 + 1);
          }
        }
        ctx.stroke();
      }
      ctx.restore();
    }
    return;
  }
  // "No data" (spec F2): a hollow box with a diagonal, standing on the baseline, inside the plot.
  ctx.beginPath();
  for (let i = 0; i + 3 < q.length; i += 4) {
    const x = q[i]!, y = q[i + 1]!, w = q[i + 2]!, h = q[i + 3]!;
    if (lifted(x) || lifted(y) || lifted(w) || lifted(h)) continue;
    missingBox(x, y, w, h, box, clip);
    const bx = box[0]!, by = box[1]!, bw = box[2]!, bh = box[3]!;
    ctx.rect(bx, by, bw, bh);
    ctx.moveTo(bx, by + bh);
    ctx.lineTo(bx + bw, by);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = MISSING_STROKE;
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';
  ctx.setLineDash(SOLID);
  ctx.stroke();
}

function paintPoints(ctx: Ctx, mark: PointMark, paints: PaintBindings): void {
  const color = paintOf(mark.fill, paints);
  if (color === null || !(mark.size > 0)) return;
  const xy = mark.xy;
  const size = mark.size;
  const r = size / 2;
  ctx.beginPath();
  if (mark.shape === 'circle') {
    for (let i = 0; i + 1 < xy.length; i += 2) {
      const x = xy[i]!, y = xy[i + 1]!;
      if (lifted(x) || lifted(y)) continue;
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, TAU);
    }
  } else {
    const poly = MARKER_POLYGONS[mark.shape];
    for (let i = 0; i + 1 < xy.length; i += 2) {
      const x = xy[i]!, y = xy[i + 1]!;
      if (lifted(x) || lifted(y)) continue;
      ctx.moveTo(x + poly[0]! * size, y + poly[1]! * size);
      for (let k = 2; k < poly.length; k += 2) ctx.lineTo(x + poly[k]! * size, y + poly[k + 1]! * size);
      ctx.closePath();
    }
  }
  ctx.fillStyle = color;
  ctx.fill();
}

function paintArcs(ctx: Ctx, mark: ArcMark, paints: PaintBindings, s: Float64Array): void {
  const { cx, cy, r0, r1, angles, fills, gap } = mark;
  for (let i = 0; 2 * i + 1 < angles.length; i++) {
    const fill = fills[i];
    const color = fill === undefined ? null : paintOf(fill, paints);
    if (color === null) continue;
    const kind = sector(angles[2 * i]!, angles[2 * i + 1]!, r0, r1, gap, s);
    if (kind === 0) continue;
    ctx.beginPath();
    if (kind === SECTOR_RING) {
      ctx.arc(cx, cy, r1, 0, TAU);
      if (r0 > 0) { ctx.moveTo(cx + r0, cy); ctx.arc(cx, cy, r0, TAU, 0, true); }
    } else {
      ctx.arc(cx, cy, r1, s[0]!, s[1]!);
      if (kind === SECTOR_ARCS) ctx.arc(cx, cy, s[6]!, s[2]!, s[3]!, true);
      else if (kind === SECTOR_APEX) ctx.lineTo(cx + s[4]! * Math.cos(s[5]!), cy + s[4]! * Math.sin(s[5]!));
      ctx.closePath();
    }
    ctx.fillStyle = color;
    ctx.fill();
  }
}

function paintRule(ctx: Ctx, mark: RuleMark, paints: PaintBindings, sx: number, sy: number, s: Float64Array): void {
  const color = paintOf(mark.stroke, paints);
  if (color === null || !(mark.strokeWidth > 0)) return;
  snapRule(mark.x1, mark.y1, mark.x2, mark.y2, mark.strokeWidth, sx, s, sy);
  ctx.beginPath();
  ctx.moveTo(s[0]!, s[1]!);
  ctx.lineTo(s[2]!, s[3]!);
  ctx.strokeStyle = color;
  ctx.lineWidth = s[4]!;
  ctx.lineCap = 'butt';
  ctx.setLineDash(mark.dash ?? SOLID);
  ctx.stroke();
  ctx.setLineDash(SOLID);
}

function paintBand(ctx: Ctx, mark: BandMark, paints: PaintBindings): void {
  const color = paintOf(mark.fill, paints);
  if (color === null) return;
  const b = mark.box;
  ctx.globalAlpha = mark.opacity;
  ctx.fillStyle = color;
  ctx.fillRect(b.x, b.y, b.width, b.height);
  ctx.globalAlpha = 1;
}
