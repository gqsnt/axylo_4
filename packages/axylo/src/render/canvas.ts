/**
 * Canvas 2D mark renderer (plan 2.3). Paints with `theme.paints` (concrete colors), so the chart must call
 * `draw` again after a theme change. Two stacked canvases: the scene, and the overlay above it, so a cursor
 * or focus ring can move without repainting the marks.
 *
 * Coordinates in the scene are CSS px; each context is scaled by the device pixel ratio once per draw.
 * Nothing in the drawing loops allocates per vertex or per point.
 */
import type { AreaMark, ArcMark, BandMark, Mark, MarkRenderer, Overlay, PaintBindings, PathMark, PointMark, Rect, RectMark, ResolvedTheme, RuleMark, Scene } from '../core/contracts';
import {
  lifted, MARKER_POLYGONS, MISSING_STROKE, missingBox, paintOf, sector, SECTOR_APEX, SECTOR_ARCS, SECTOR_RING, snapRule, unclippedRule,
} from './geometry';

const SOLID: readonly number[] = [];
const TAU = Math.PI * 2;

type Ctx = CanvasRenderingContext2D;

export function createCanvasRenderer(doc: Document = document): MarkRenderer {
  const element = doc.createElement('div');
  element.className = 'axylo-canvas';
  element.setAttribute('aria-hidden', 'true');
  setStyles(element, { position: 'absolute', left: '0', top: '0', 'pointer-events': 'none' });
  const sceneCanvas = doc.createElement('canvas');
  const overlayCanvas = doc.createElement('canvas');
  for (const c of [sceneCanvas, overlayCanvas]) {
    setStyles(c, { position: 'absolute', left: '0', top: '0', display: 'block' });
    element.appendChild(c);
  }
  const sceneCtx = sceneCanvas.getContext('2d');
  const overlayCtx = overlayCanvas.getContext('2d');
  if (sceneCtx === null || overlayCtx === null) throw new Error('Axylo: this browser cannot create a 2D canvas context.');

  const scratch = new Float64Array(8);
  let cssWidth = 0;
  let cssHeight = 0;
  let overlay: Overlay | null = null;
  let overlayTheme: ResolvedTheme | null = null;
  let ratio = 1;

  function fit(canvas: HTMLCanvasElement, width: number, height: number, dpr: number): boolean {
    const bw = Math.max(0, Math.round(width * dpr));
    const bh = Math.max(0, Math.round(height * dpr));
    if (canvas.width === bw && canvas.height === bh) return false;
    // Assigning width or height reallocates and clears the backing store, so only on a real change.
    canvas.width = bw;
    canvas.height = bh;
    canvas.style.setProperty('width', `${width}px`);
    canvas.style.setProperty('height', `${height}px`);
    return true;
  }

  function begin(ctx: Ctx, canvas: HTMLCanvasElement, dpr: number): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function paintOverlay(dpr: number): void {
    begin(overlayCtx!, overlayCanvas, dpr);
    if (overlay === null || overlayTheme === null) return;
    const contrast = overlayTheme.moreContrast || overlayTheme.forcedColors;
    paintMarks(overlayCtx!, overlay.clipped, overlay.clip, false, overlayTheme.paints, contrast, dpr, scratch);
    paintMarks(overlayCtx!, overlay.unclipped, null, false, overlayTheme.paints, contrast, dpr, scratch);
  }

  return {
    kind: 'canvas',
    element,
    draw(scene: Scene, _bindings: PaintBindings, theme: ResolvedTheme, devicePixelRatio: number): void {
      const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
      if (scene.width !== cssWidth || scene.height !== cssHeight) {
        cssWidth = scene.width;
        cssHeight = scene.height;
        element.style.setProperty('width', `${cssWidth}px`);
        element.style.setProperty('height', `${cssHeight}px`);
      }
      fit(sceneCanvas, cssWidth, cssHeight, dpr);
      begin(sceneCtx, sceneCanvas, dpr);
      paintMarks(sceneCtx, scene.marks, scene.clip, true, theme.paints, theme.moreContrast || theme.forcedColors, dpr, scratch);
      // A resize clears the overlay canvas; a theme change makes its colors stale. Either way repaint it.
      const resized = fit(overlayCanvas, cssWidth, cssHeight, dpr);
      if (overlay !== null && (resized || dpr !== ratio || overlayTheme !== theme)) {
        overlayTheme = theme;
        paintOverlay(dpr);
      }
      ratio = dpr;
    },
    drawOverlay(next: Overlay | null, _bindings: PaintBindings, theme: ResolvedTheme, devicePixelRatio: number): void {
      const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
      overlay = next;
      overlayTheme = theme;
      fit(overlayCanvas, cssWidth, cssHeight, dpr);
      paintOverlay(dpr);
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
function paintMarks(ctx: Ctx, marks: readonly Mark[], clip: Rect | null, byRole: boolean, paints: PaintBindings, contrast: boolean, dpr: number, scratch: Float64Array): void {
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
      case 'rects': paintRects(ctx, mark, paints, scratch); break;
      case 'points': paintPoints(ctx, mark, paints); break;
      case 'arcs': paintArcs(ctx, mark, paints, scratch); break;
      case 'rule': paintRule(ctx, mark, paints, dpr, scratch); break;
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

function paintRects(ctx: Ctx, mark: RectMark, paints: PaintBindings, box: Float64Array): void {
  const color = paintOf(mark.fill, paints);
  if (color === null) return;
  const q = mark.xywh;
  ctx.beginPath();
  if (mark.variant === 'bar') {
    for (let i = 0; i + 3 < q.length; i += 4) {
      const x = q[i]!, y = q[i + 1]!, w = q[i + 2]!, h = q[i + 3]!;
      if (lifted(x) || lifted(y) || lifted(w) || lifted(h)) continue;
      ctx.rect(x, y, w, h);
    }
    ctx.fillStyle = color;
    ctx.fill();
    return;
  }
  // "No data" (spec F2): a hollow box with a diagonal, standing on the baseline.
  for (let i = 0; i + 3 < q.length; i += 4) {
    const x = q[i]!, y = q[i + 1]!, w = q[i + 2]!, h = q[i + 3]!;
    if (lifted(x) || lifted(y) || lifted(w) || lifted(h)) continue;
    missingBox(x, y, w, h, box);
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
      if (kind === SECTOR_ARCS) ctx.arc(cx, cy, r0, s[2]!, s[3]!, true);
      else if (kind === SECTOR_APEX) ctx.lineTo(cx + s[4]! * Math.cos(s[5]!), cy + s[4]! * Math.sin(s[5]!));
      ctx.closePath();
    }
    ctx.fillStyle = color;
    ctx.fill();
  }
}

function paintRule(ctx: Ctx, mark: RuleMark, paints: PaintBindings, dpr: number, s: Float64Array): void {
  const color = paintOf(mark.stroke, paints);
  if (color === null || !(mark.strokeWidth > 0)) return;
  snapRule(mark.x1, mark.y1, mark.x2, mark.y2, mark.strokeWidth, dpr, s);
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
