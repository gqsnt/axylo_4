/**
 * Opt-in annotations for `axylo/cartesian` (C5.2):
 * point event markers, labelled thresholds, and shaded x/y ranges with axisId binding,
 * strict plot clipping across zoom/resize, greedy label collision avoidance, and accessible summaries.
 */
import type {
  AlignedView, BandMark, DiagnosticSink, Mark, PlacedText, Projection, Rect, TextMeasurer, TextStyle,
} from '../core/contracts';
import type { XValue } from '../public';
import { clamp, position, rule, token } from '../scene/geometry';
import { positionReader } from '../view/references';
import { axisScaleOf } from './scale-ref';
import { axisOf, logicalOf } from './boxplot';
import { report } from '../diagnostics/registry';
import { annotationPath, reportCartesian } from './diagnostics';
import { formatAxisValue, type CartesianAnnotationSpec, type CartesianMeta } from './meta';

const ANNOTATION_DASH = [3, 3] as const;

function resolveX(view: AlignedView, raw: XValue, sink?: DiagnosticSink, field = 'annotations'): number | null {
  const pos = positionReader(view.frame.x, undefined)(raw, sink ? { sink, field, detail: `annotation x (${String(raw)})` } : undefined);
  return Number.isFinite(pos) ? pos : null;
}

/** Reports option issues from options.ts and unresolvable x annotation coordinates (AX107). */
export function validateCartesianAnnotations(view: AlignedView, meta: CartesianMeta, sink: DiagnosticSink): void {
  for (const issue of logicalOf(meta).optionIssues) {
    if (issue.code === 'AX171') reportCartesian(sink, 'AX171', 'none', { field: issue.field, count: 1, detail: issue.detail });
    else report(sink, issue.code, 'none', {
      field: issue.field, detail: issue.detail, count: issue.count, rows: issue.rows,
      outcome: issue.field.startsWith('annotations') ? 'The annotation is not drawn; the other annotations are.' : undefined,
    });
  }
  for (const ann of meta.annotations) xFieldsOf(ann).forEach(([key, raw]) => resolveX(view, raw, sink, `${annotationPath(ann)}.${key}`));
}

/** The x positions an annotation needs, by option key: parsed against the chart's own x column. */
function xFieldsOf(ann: CartesianAnnotationSpec): [string, XValue][] {
  return ann.type === 'point' ? [['x', ann.x]]
    : ann.axis !== 'x' ? []
    : ann.type === 'threshold' ? [['value', ann.value as XValue]] : [['from', ann.from as XValue], ['to', ann.to as XValue]];
}

/** Whether an annotation can be placed at all (its x positions resolve and its y-axis exists), whatever the zoom. */
const placeable = (view: AlignedView, meta: CartesianMeta, ann: CartesianAnnotationSpec) =>
  (ann.type !== 'point' && ann.axis === 'x' || ann.axisId === undefined || meta.axisById.has(ann.axisId))
  && xFieldsOf(ann).every(([, raw]) => resolveX(view, raw) !== null);

function projectX(view: AlignedView, projection: Exclude<Projection, { kind: 'ring' }>, raw: XValue): number | null {
  const val = resolveX(view, raw);
  if (val === null) return null;
  const px = position(projection.kind === 'xy' ? projection.x : projection.band, val);
  return Number.isFinite(px) ? px : null;
}

function projectY(meta: CartesianMeta, projection: Exclude<Projection, { kind: 'ring' }>, axisId: string | undefined, raw: number): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const axis = axisOf(meta, axisId);
  if (!axis) return null;
  const yScale = axisScaleOf(projection, axis.index);
  if (yScale.type === 'log' && !(raw > 0)) return null;
  const py = position(yScale, raw);
  return Number.isFinite(py) ? py : null;
}

function clampedSpan(a: number | null, b: number | null, minB: number, maxB: number): readonly [number, number] | null {
  if (a === null || b === null) return null;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  return hi < minB || lo > maxB ? null : [clamp(lo, minB, maxB), clamp(hi, minB, maxB)];
}

export interface AnnotationLayoutResult {
  readonly labels: readonly PlacedText[];
  readonly hiddenCount: number;
}

export function layoutCartesianAnnotations(
  view: AlignedView,
  projection: Exclude<Projection, { kind: 'ring' }>,
  plot: Rect,
  meta: CartesianMeta,
  measurer: TextMeasurer,
  style: TextStyle,
  existingTexts: readonly PlacedText[] = [],
): AnnotationLayoutResult {
  if (!meta.annotations.length) return { labels: [], hiddenCount: 0 };
  const placed: Rect[] = existingTexts.map(t => t.box);
  const labels: PlacedText[] = [];
  let hiddenCount = 0;
  const lineH = Math.max(12, style.lineHeight || 14);
  const left = plot.x, right = left + plot.width, top = plot.y, bottom = top + plot.height;
  const halfH = lineH / 2 + 2;

  const tryPlace = (text: string, cands: readonly [number, number, PlacedText['anchor']][]): void => {
    const w = Math.max(8, measurer.width(text, style)) + 8, h = lineH + 2;
    for (const [x, y, anchor] of cands) {
      const box: Rect = { x: anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2, y: y - h / 2, width: w, height: h };
      if (box.x < left - 1 || box.x + w > right + 1 || box.y < top - 1 || box.y + h > bottom + 1) continue;
      if (placed.some(p => p.x < box.x + w + 2 && p.x + p.width + 2 > box.x && p.y < box.y + h + 2 && p.y + p.height + 2 > box.y)) continue;
      placed.push(box);
      labels.push({ lines: [text], full: text, x, y, anchor, baseline: 'middle', rotate: 0, role: 'reference', box });
      return;
    }
    hiddenCount++;
  };

  for (const ann of meta.annotations) {
    const text = ann.label.trim();
    if (!text) continue;
    if (ann.type === 'point') {
      const px = projectX(view, projection, ann.x), py = projectY(meta, projection, ann.axisId, ann.y);
      if (px !== null && py !== null && px >= left && px <= right && py >= top && py <= bottom) {
        tryPlace(text, [[px, py - lineH, 'middle'], [px + 8, py, 'start'], [px - 8, py, 'end'], [px, py + lineH, 'middle']]);
      }
    } else if (ann.type === 'threshold') {
      if (ann.axis === 'x') {
        const px = projectX(view, projection, ann.value as XValue);
        if (px !== null && px >= left && px <= right) {
          tryPlace(text, [[px + 4, top + halfH, 'start'], [px - 4, top + halfH, 'end'], [px + 4, bottom - halfH, 'start'], [px - 4, bottom - halfH, 'end']]);
        }
      } else {
        const py = projectY(meta, projection, ann.axisId, Number(ann.value));
        if (py !== null && py >= top && py <= bottom) {
          tryPlace(text, [[right - 4, py - halfH, 'end'], [left + 4, py - halfH, 'start'], [right - 4, py + halfH, 'end'], [left + 4, py + halfH, 'start']]);
        }
      }
    } else if (ann.axis === 'x') {
      const sp = clampedSpan(projectX(view, projection, ann.from as XValue), projectX(view, projection, ann.to as XValue), left, right);
      if (sp) {
        const mid = (sp[0] + sp[1]) / 2;
        tryPlace(text, [[mid, top + halfH, 'middle'], [sp[0] + 4, top + halfH, 'start'], [sp[1] - 4, top + halfH, 'end'], [mid, bottom - halfH, 'middle']]);
      }
    } else {
      const sp = clampedSpan(projectY(meta, projection, ann.axisId, Number(ann.from)), projectY(meta, projection, ann.axisId, Number(ann.to)), top, bottom);
      if (sp) {
        const mid = (sp[0] + sp[1]) / 2;
        tryPlace(text, [[left + 4, mid, 'start'], [right - 4, mid, 'end'], [left + 4, sp[0] + halfH, 'start']]);
      }
    }
  }
  return { labels, hiddenCount };
}

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
  const left = plot.x, right = left + plot.width, top = plot.y, bottom = top + plot.height;

  for (const ann of meta.annotations) {
    if (ann.type === 'range') {
      if (ann.axis === 'x') {
        const sp = clampedSpan(projectX(view, projection, ann.from as XValue), projectX(view, projection, ann.to as XValue), left, right);
        if (sp) bands.push({ type: 'band', box: { x: sp[0], y: top, width: Math.max(1, sp[1] - sp[0]), height: plot.height }, fill: paint, opacity: 0.14 });
      } else {
        const sp = clampedSpan(projectY(meta, projection, ann.axisId, Number(ann.from)), projectY(meta, projection, ann.axisId, Number(ann.to)), top, bottom);
        if (sp) bands.push({ type: 'band', box: { x: left, y: sp[0], width: plot.width, height: Math.max(1, sp[1] - sp[0]) }, fill: paint, opacity: 0.14 });
      }
    } else if (ann.type === 'threshold') {
      if (ann.axis === 'x') {
        const px = projectX(view, projection, ann.value as XValue);
        if (px !== null && px >= left && px <= right) foreground.push({ ...rule('reference', paint, px, top, px, bottom), strokeWidth: 1.5, dash: ANNOTATION_DASH });
      } else {
        const py = projectY(meta, projection, ann.axisId, Number(ann.value));
        if (py !== null && py >= top && py <= bottom) foreground.push({ ...rule('reference', paint, left, py, right, py), strokeWidth: 1.5, dash: ANNOTATION_DASH });
      }
    } else {
      const px = projectX(view, projection, ann.x), py = projectY(meta, projection, ann.axisId, ann.y);
      if (px !== null && py !== null && px >= left && px <= right && py >= top && py <= bottom) {
        foreground.push(
          { ...rule('reference', paint, px, Math.max(top, py - 10), px, py), strokeWidth: 1 },
          { type: 'points', series: 0, xy: Float32Array.from([px, py]), shape: 'diamond', size: 5, fill: paint },
        );
      }
    }
  }
  return { bands, foreground };
}

export function annotationSummarySentences(view: AlignedView, meta: CartesianMeta, formatX: (x: number) => string, locale: string): string[] {
  if (!meta.annotations.length) return [];
  const fmtY = (axisId: string | undefined, v: number) => {
    const axis = axisOf(meta, axisId);
    return axis ? formatAxisValue(axis, v, locale) : String(v);
  };
  const fmtX = (raw: XValue) => formatX(resolveX(view, raw)!);
  // An annotation that cannot be drawn is reported (AX107/AX174), not announced.
  return meta.annotations.filter(ann => placeable(view, meta, ann)).map(ann => {
    const tail = ann.description ? ` — ${ann.description}` : '';
    if (ann.type === 'point') return `Annotation ${ann.label} at ${fmtX(ann.x)}, ${fmtY(ann.axisId, ann.y)}${tail}.`;
    const fmt = (v: unknown) => ann.axis === 'x' ? fmtX(v as XValue) : fmtY(ann.axisId, Number(v));
    return ann.type === 'threshold'
      ? `Threshold ${ann.label} at ${ann.axis} = ${fmt(ann.value)}${tail}.`
      : `Range ${ann.label} from ${fmt(ann.from)} to ${fmt(ann.to)}${tail}.`;
  });
}

export type { CartesianAnnotationSpec };
