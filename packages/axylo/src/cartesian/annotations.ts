/**
 * Opt-in annotations for `axylo/cartesian` (C5.2):
 * supports point event markers, labelled thresholds, and shaded x/y ranges with axisId binding,
 * strict plot clipping across zoom/resize, greedy label collision avoidance (zero overlap, never silent loss),
 * and accessible summary descriptions — without altering existing `Reference` semantics or datum lookup.
 */
import type {
  AlignedView, BandMark, Mark, PlacedText, PointMark, Projection, Rect, RuleMark, TextMeasurer, TextStyle,
} from '../core/contracts';
import type { XValue } from '../public';
import { clamp, position, rule, token } from '../scene/geometry';
import { axisScaleOf } from './scale-ref';
import { formatAxisValue, type CartesianAnnotationSpec, type CartesianMeta } from './meta';

const ANNOTATION_DASH = [3, 3] as const;
const LABEL_PAD_X = 4;
const LABEL_PAD_Y = 2;

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.width + 2 && a.x + a.width + 2 > b.x && a.y < b.y + b.height + 2 && a.y + a.height + 2 > b.y;
}

function boxFitsPlot(box: Box, plot: Rect): boolean {
  return box.x >= plot.x - 1 && box.x + box.width <= plot.x + plot.width + 1
    && box.y >= plot.y - 1 && box.y + box.height <= plot.y + plot.height + 1;
}

function resolveXCoord(view: AlignedView, raw: XValue): number | null {
  const col = view.frame.x;
  if (col.kind === 'category') {
    const idx = col.categories?.indexOf(String(raw)) ?? -1;
    return idx >= 0 ? idx : null;
  }
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (raw instanceof Date) return Number.isFinite(raw.getTime()) ? raw.getTime() : null;
  if (typeof raw === 'string') {
    const ms = Date.parse(raw.length === 10 ? `${raw}T00:00:00Z` : raw);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function projectX(view: AlignedView, projection: Exclude<Projection, { kind: 'ring' }>, raw: XValue): number | null {
  const val = resolveXCoord(view, raw);
  if (val === null) return null;
  const xScale = projection.kind === 'xy' ? projection.x : projection.band;
  const px = xScale.type === 'band' ? xScale.center(val) : position(xScale, val);
  return Number.isFinite(px) ? px : null;
}

function projectY(
  meta: CartesianMeta,
  projection: Exclude<Projection, { kind: 'ring' }>,
  axisId: string | undefined,
  raw: number,
): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const axis = meta.axisById.get(axisId ?? meta.leftAxisId) ?? meta.axes[0];
  if (!axis) return null;
  const yScale = axisScaleOf(projection, axis.index);
  if (yScale.type === 'log' && !(raw > 0)) return null;
  const py = position(yScale, raw);
  return Number.isFinite(py) ? py : null;
}

export interface AnnotationLayoutResult {
  readonly labels: readonly PlacedText[];
  readonly hiddenCount: number;
}

/**
 * Places non-overlapping annotation labels strictly inside `plot`, avoiding collisions with earlier
 * annotation labels and reporting `hiddenCount` whenever any visible annotation label cannot fit.
 */
export function layoutCartesianAnnotations(
  view: AlignedView,
  projection: Exclude<Projection, { kind: 'ring' }>,
  plot: Rect,
  meta: CartesianMeta,
  measurer: TextMeasurer,
  style: TextStyle,
): AnnotationLayoutResult {
  if (!meta.annotations.length) return { labels: [], hiddenCount: 0 };
  const placed: Box[] = [];
  const labels: PlacedText[] = [];
  let hiddenCount = 0;
  const lineH = Math.max(12, style.lineHeight || 14);
  const left = plot.x;
  const right = plot.x + plot.width;
  const top = plot.y;
  const bottom = plot.y + plot.height;

  const tryPlace = (text: string, candidates: readonly { x: number; y: number; anchor: PlacedText['anchor'] }[]): boolean => {
    const w = Math.max(8, measurer.width(text, style)) + LABEL_PAD_X * 2;
    const h = lineH + LABEL_PAD_Y;
    for (const c of candidates) {
      const bx = c.anchor === 'start' ? c.x : c.anchor === 'end' ? c.x - w : c.x - w / 2;
      const by = c.y - h / 2;
      const box: Box = { x: bx, y: by, width: w, height: h };
      if (!boxFitsPlot(box, plot)) continue;
      if (placed.some(p => boxesOverlap(p, box))) continue;
      placed.push(box);
      labels.push({
        lines: [text],
        full: text,
        x: c.x,
        y: c.y,
        anchor: c.anchor,
        baseline: 'middle',
        rotate: 0,
        role: 'reference',
        box,
      });
      return true;
    }
    return false;
  };

  for (const ann of meta.annotations) {
    const labelText = ann.label.trim();
    if (!labelText) continue;

    if (ann.type === 'point') {
      const px = projectX(view, projection, ann.x);
      const py = projectY(meta, projection, ann.axisId, ann.y);
      if (px === null || py === null || px < left || px > right || py < top || py > bottom) continue;
      const ok = tryPlace(labelText, [
        { x: px, y: py - lineH, anchor: 'middle' },
        { x: px + 8, y: py, anchor: 'start' },
        { x: px - 8, y: py, anchor: 'end' },
        { x: px, y: py + lineH, anchor: 'middle' },
      ]);
      if (!ok) hiddenCount++;
    } else if (ann.type === 'threshold') {
      if (ann.axis === 'x') {
        const px = projectX(view, projection, ann.value as XValue);
        if (px === null || px < left || px > right) continue;
        const ok = tryPlace(labelText, [
          { x: px + 4, y: top + lineH / 2 + 2, anchor: 'start' },
          { x: px - 4, y: top + lineH / 2 + 2, anchor: 'end' },
          { x: px + 4, y: bottom - lineH / 2 - 2, anchor: 'start' },
          { x: px - 4, y: bottom - lineH / 2 - 2, anchor: 'end' },
        ]);
        if (!ok) hiddenCount++;
      } else {
        const py = projectY(meta, projection, ann.axisId, Number(ann.value));
        if (py === null || py < top || py > bottom) continue;
        const ok = tryPlace(labelText, [
          { x: right - 4, y: py - lineH / 2 - 2, anchor: 'end' },
          { x: left + 4, y: py - lineH / 2 - 2, anchor: 'start' },
          { x: right - 4, y: py + lineH / 2 + 2, anchor: 'end' },
          { x: left + 4, y: py + lineH / 2 + 2, anchor: 'start' },
        ]);
        if (!ok) hiddenCount++;
      }
    } else {
      // Shaded range annotation
      if (ann.axis === 'x') {
        const a = projectX(view, projection, ann.from as XValue);
        const b = projectX(view, projection, ann.to as XValue);
        if (a === null || b === null) continue;
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        if (hi < left || lo > right) continue;
        const clLo = clamp(lo, left, right);
        const clHi = clamp(hi, left, right);
        const mid = (clLo + clHi) / 2;
        const ok = tryPlace(labelText, [
          { x: mid, y: top + lineH / 2 + 2, anchor: 'middle' },
          { x: clLo + 4, y: top + lineH / 2 + 2, anchor: 'start' },
          { x: clHi - 4, y: top + lineH / 2 + 2, anchor: 'end' },
          { x: mid, y: bottom - lineH / 2 - 2, anchor: 'middle' },
        ]);
        if (!ok) hiddenCount++;
      } else {
        const a = projectY(meta, projection, ann.axisId, Number(ann.from));
        const b = projectY(meta, projection, ann.axisId, Number(ann.to));
        if (a === null || b === null) continue;
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        if (hi < top || lo > bottom) continue;
        const clLo = clamp(lo, top, bottom);
        const clHi = clamp(hi, top, bottom);
        const midY = (clLo + clHi) / 2;
        const ok = tryPlace(labelText, [
          { x: left + 4, y: midY, anchor: 'start' },
          { x: right - 4, y: midY, anchor: 'end' },
          { x: left + 4, y: clLo + lineH / 2 + 2, anchor: 'start' },
        ]);
        if (!ok) hiddenCount++;
      }
    }
  }

  return { labels, hiddenCount };
}

/** Builds clipped visual marks for annotations (bands behind data, threshold rules & point markers above data). */
export function buildCartesianAnnotationMarks(
  view: AlignedView,
  projection: Exclude<Projection, { kind: 'ring' }>,
  plot: Rect,
  meta: CartesianMeta,
): { bands: BandMark[]; foreground: Mark[] } {
  const bands: BandMark[] = [];
  const foreground: Mark[] = [];
  if (!meta.annotations.length) return { bands, foreground };

  const paint = token('reference');
  const left = plot.x;
  const right = plot.x + plot.width;
  const top = plot.y;
  const bottom = plot.y + plot.height;

  for (const ann of meta.annotations) {
    if (ann.type === 'range') {
      if (ann.axis === 'x') {
        const a = projectX(view, projection, ann.from as XValue);
        const b = projectX(view, projection, ann.to as XValue);
        if (a === null || b === null) continue;
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        if (hi < left || lo > right) continue;
        const clLo = clamp(lo, left, right);
        const clHi = clamp(hi, left, right);
        bands.push({
          type: 'band',
          box: { x: clLo, y: top, width: Math.max(1, clHi - clLo), height: plot.height },
          fill: paint,
          opacity: 0.14,
        });
      } else {
        const a = projectY(meta, projection, ann.axisId, Number(ann.from));
        const b = projectY(meta, projection, ann.axisId, Number(ann.to));
        if (a === null || b === null) continue;
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        if (hi < top || lo > bottom) continue;
        const clLo = clamp(lo, top, bottom);
        const clHi = clamp(hi, top, bottom);
        bands.push({
          type: 'band',
          box: { x: left, y: clLo, width: plot.width, height: Math.max(1, clHi - clLo) },
          fill: paint,
          opacity: 0.14,
        });
      }
    } else if (ann.type === 'threshold') {
      if (ann.axis === 'x') {
        const px = projectX(view, projection, ann.value as XValue);
        if (px === null || px < left || px > right) continue;
        const r: RuleMark = { ...rule('reference', paint, px, top, px, bottom), strokeWidth: 1.5, dash: ANNOTATION_DASH };
        foreground.push(r);
      } else {
        const py = projectY(meta, projection, ann.axisId, Number(ann.value));
        if (py === null || py < top || py > bottom) continue;
        const r: RuleMark = { ...rule('reference', paint, left, py, right, py), strokeWidth: 1.5, dash: ANNOTATION_DASH };
        foreground.push(r);
      }
    } else {
      const px = projectX(view, projection, ann.x);
      const py = projectY(meta, projection, ann.axisId, ann.y);
      if (px === null || py === null || px < left || px > right || py < top || py > bottom) continue;
      const leader: RuleMark = { ...rule('reference', paint, px, Math.max(top, py - 10), px, py), strokeWidth: 1 };
      const dot: PointMark = {
        type: 'points',
        series: 0,
        xy: Float32Array.from([px, py]),
        shape: 'diamond',
        size: 5,
        fill: paint,
      };
      foreground.push(leader, dot);
    }
  }
  return { bands, foreground };
}

/** Formats accessible summary sentences for every configured annotation (guarantees zero silent label loss). */
export function annotationSummarySentences(
  meta: CartesianMeta,
  formatX: (x: XValue) => string,
  locale: string,
): string[] {
  if (!meta.annotations.length) return [];
  const out: string[] = [];
  const fmtY = (axisId: string | undefined, v: number) => {
    const axis = meta.axisById.get(axisId ?? meta.leftAxisId) ?? meta.axes[0];
    return axis ? formatAxisValue(axis, v, locale) : String(v);
  };
  for (const ann of meta.annotations) {
    const tail = ann.description ? ` — ${ann.description}` : '';
    if (ann.type === 'point') {
      out.push(`Annotation ${ann.label} at ${formatX(ann.x)}, ${fmtY(ann.axisId, ann.y)}${tail}.`);
    } else if (ann.type === 'threshold') {
      const valText = ann.axis === 'x' ? formatX(ann.value as XValue) : fmtY(ann.axisId, Number(ann.value));
      out.push(`Threshold ${ann.label} at ${ann.axis} = ${valText}${tail}.`);
    } else {
      const fromText = ann.axis === 'x' ? formatX(ann.from as XValue) : fmtY(ann.axisId, Number(ann.from));
      const toText = ann.axis === 'x' ? formatX(ann.to as XValue) : fmtY(ann.axisId, Number(ann.to));
      out.push(`Range ${ann.label} from ${fromText} to ${toText}${tail}.`);
    }
  }
  return out;
}

export type { CartesianAnnotationSpec };
