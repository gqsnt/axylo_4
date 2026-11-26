/**
 * Dual-axis responsive layout stage for `axylo/cartesian` (C4.2, RFC §2.2 & §5.1, spec L9).
 * - Single projection authority: builds `yAxes = [leftScale]` or `[leftScale, rightScale]` where
 *   `projection.y === projection.yAxes[0]`.
 * - At container width `>= 360 px`: reserves both left and right gutters, draws right ticks (`anchor: 'start'`)
 *   and right axis title.
 * - At container width `< 360 px` (and `>= 120 x 80 px`): collapses secondary right-axis ticks/title and
 *   emits `AX175` via `layoutDiagnostics` (cleared automatically when resized back to `>= 360 px`).
 * - Folds right-axis hidden label count into `fit.y.hidden` (while exposing `fit.yRight`) so `frame-state.ts:60`
 *   triggers `AX143` with 0 B changes to core files.
 */
import type {
  AlignedView, ContinuousScale, DiagnosticInput, Layout, PlacedText, Projection, Rect,
  ResolvedReference, TextMeasurer, TextStyle, Tick, TickCandidates, View, XScale,
} from '../core/contracts';
import type { AxisContext } from '../core/axes';
import { baseLayoutKey, type LayoutStage } from '../core/composition';
import { createDiagnostic } from '../diagnostics/registry';
import { createNumberTickLabeler, createTimeTickLabel } from '../format';
import {
  fitBottom, fitBottomLines, fitValue, placeBottomLines, placeText, prepareLabels, wrapText,
  type FittedLabels, type Metrics,
} from '../layout/labels';
import { bandScale, bandTickCandidates, linearScale, linearTickCandidates, timeScale, timeTickCandidates } from '../scale';
import { logScale, type Span } from '../scale/log';
import { withUnit } from '../reader/table';
import { axisScaleOf } from './scale-ref';
import { axisTickCandidates, createTickFailureTracker, type TickFailureTracker } from './axes';
import { createCartesianDiagnostic } from './diagnostics';
import type { CartesianAxisSpec, CartesianStateRef } from './meta';

export const DUAL_AXIS_MIN_WIDTH = 360;
const INSET = 4;
const GAP = 4;
const TICK_GAP = 6;
const MIN_WIDTH = 120;
const MIN_HEIGHT = 80;
const NO_TITLE: readonly string[] = [];
const NO_LABELS: FittedLabels = { ticks: [], texts: [], depth: 0, remedies: [] };

function makeMetrics(measurer: TextMeasurer, style: TextStyle): Metrics {
  const widths = new Map<string, number>();
  return {
    lineHeight: style.lineHeight,
    width(text) {
      const hit = widths.get(text);
      if (hit !== undefined) return hit;
      const w = measurer.width(text, style);
      widths.set(text, w);
      return w;
    },
  };
}

function titleLines(title: string | undefined, span: number, text: Metrics): readonly string[] | null {
  if (!title) return NO_TITLE;
  const lines = wrapText(title, span, text);
  for (const line of lines) if (text.width(line) > span) return null;
  return lines;
}

const titleDepth = (lines: readonly string[], text: Metrics) => lines.length ? GAP + lines.length * text.lineHeight : 0;
const lane = (fit: FittedLabels) => fit.texts.length ? TICK_GAP + fit.depth : 0;

function moveText(text: PlacedText, dx: number, dy: number): PlacedText {
  const { box } = text;
  return { ...text, x: text.x + dx, y: text.y + dy, box: { ...box, x: box.x + dx, y: box.y + dy } };
}

/** Converts a left-anchored (`anchor: 'end'`, `x = 0`) label from `fitValue` into a right-axis label (`anchor: 'start'`). */
function placeRightTick(label: PlacedText, xRight: number): PlacedText {
  const { box } = label;
  return {
    ...label,
    x: xRight,
    anchor: 'start',
    box: { x: xRight, y: box.y, width: box.width, height: box.height },
  };
}

function buildValueScale(axis: CartesianAxisSpec, domain: Span, range: Span): ContinuousScale {
  return axis.scale === 'log' ? logScale(domain, range) : linearScale(domain, range);
}

function buildXScale(view: AlignedView, range: Span, hasBars: boolean): XScale {
  const { x } = view.frame;
  if (x.kind === 'category') return bandScale(x.categories?.length ?? view.frame.length, range, hasBars ? 0.25 : 0);
  if (x.kind === 'time' || x.kind === 'date' || x.kind === 'wall') return timeScale(view.xDomain, range);
  return linearScale(view.xDomain, range);
}

function buildXCandidates(view: AlignedView, ctx: AxisContext, failures: TickFailureTracker): { candidates: TickCandidates; mayThin: boolean } {
  const { x } = view.frame;
  const xOpt = ctx.resolved.x;
  if (x.kind === 'category') {
    const cats = x.categories ?? [];
    return { candidates: bandTickCandidates(cats), mayThin: x.ordered };
  }
  if (x.kind === 'time' || x.kind === 'date' || x.kind === 'wall') {
    const customLabel = createTimeTickLabel({
      kind: x.kind,
      timeZone: x.timeZone,
      locale: ctx.locale,
      dateUnit: x.dateUnit,
      format: xOpt.tickFormat,
    });
    const label = customLabel
      ? (value: number) => {
          try { return customLabel(value); }
          catch { failures.failedValues.add(value); return String(value); }
        }
      : null;
    return {
      candidates: timeTickCandidates(view.xDomain, {
        kind: x.kind, timeZone: x.timeZone, locale: ctx.locale, dateUnit: x.dateUnit, label,
      }),
      mayThin: true,
    };
  }
  const custom = xOpt.tickFormat;
  const fmt = custom == null
    ? createNumberTickLabeler({ locale: ctx.locale })
    : (value: number, tc: { step: number; maxAbs: number }) =>
        createNumberTickLabeler({
          locale: ctx.locale,
          tickFormat: custom as never,
          onError: () => { failures.failedValues.add(value); },
        })(value, tc);
  return { candidates: linearTickCandidates(view.xDomain, fmt), mayThin: true };
}

function axisTitleText(axis: CartesianAxisSpec): string | undefined {
  const label = axis.label ?? axis.id;
  return withUnit(label, axis.unit);
}

function placeCartesianReferences(
  references: readonly ResolvedReference[],
  projection: Projection,
  plot: Rect,
  texts: PlacedText[],
  text: Metrics,
  meta: CartesianStateRef['meta'],
): void {
  if (!references.length || projection.kind === 'ring') return;
  const xScale = projection.kind === 'xy' ? projection.x : projection.band;
  for (const ref of references) {
    if (!ref.label) continue;
    if (ref.axis === 'x') {
      const px = xScale.type === 'band' ? xScale.center(ref.from) : xScale.map(ref.from);
      if (!Number.isFinite(px) || px < plot.x || px > plot.x + plot.width) continue;
      texts.push(placeText([ref.label], ref.label, Math.min(plot.x + plot.width - 2, px + 4), plot.y + 4, 'start', 'top', 0, 'reference', text));
    } else {
      const axis = meta.axisById.get(ref.axisId ?? meta.leftAxisId) ?? meta.axes[0]!;
      const scale = axisScaleOf(projection, axis.index);
      const py = scale.map(ref.from);
      if (!Number.isFinite(py) || py < plot.y || py > plot.y + plot.height) continue;
      const rightSide = axis.position === 'right';
      const tx = rightSide ? plot.x + plot.width - 4 : plot.x + 4;
      const ty = Math.max(plot.y + text.lineHeight / 2, py - 4);
      texts.push(placeText([ref.label], ref.label, tx, ty, rightSide ? 'end' : 'start', 'bottom', 0, 'reference', text));
    }
  }
}

export interface CartesianLayoutComputation {
  readonly layout: Layout;
  readonly collapsedRightAxis: boolean;
  readonly xFailures: TickFailureTracker;
  readonly yFailures: readonly TickFailureTracker[];
}

export function computeCartesianLayoutDetailed(
  view: AlignedView,
  size: { readonly width: number; readonly height: number },
  textInput: { readonly measurer: TextMeasurer; readonly style: TextStyle },
  ctx: AxisContext,
  stateRef: CartesianStateRef,
): CartesianLayoutComputation {
  const { width, height } = size;
  const xFailures = createTickFailureTracker();
  const { meta } = stateRef;
  const yFailures = meta.axes.map(() => createTickFailureTracker());

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { layout: { width, height, kind: 'unmeasured' }, collapsedRightAxis: false, xFailures, yFailures };
  }

  const hasBars = meta.series.some(s => s.mark === 'bar');
  const domains: readonly Span[] = view.yDomains?.length ? view.yDomains : [view.yDomain];
  const makeProjection = (plot: Rect): Projection => {
    const x = buildXScale(view, [plot.x, plot.x + plot.width], hasBars);
    const up: Span = [plot.y + plot.height, plot.y];
    const yAxes = meta.axes.map((axis, i) => buildValueScale(axis, domains[i] ?? view.yDomain, up));
    return { kind: 'xy', x, y: yAxes[0]!, yAxes };
  };

  if (ctx.compact) {
    const mx = Math.min(2, width / 2);
    const my = Math.min(2, height / 2);
    const plot: Rect = { x: mx, y: my, width: width - 2 * mx, height: height - 2 * my };
    return {
      layout: { width, height, kind: 'compact', plot, projection: makeProjection(plot) },
      collapsedRightAxis: false,
      xFailures,
      yFailures,
    };
  }

  if (width < MIN_WIDTH + 2 * INSET || height < MIN_HEIGHT + 2 * INSET) {
    return { layout: { width, height, kind: 'too-small' }, collapsedRightAxis: false, xFailures, yFailures };
  }

  const text = makeMetrics(textInput.measurer, textInput.style);
  const leftAxis = meta.axes[0]!;
  const rightAxis = meta.axes[1] ?? null;
  const showRightAxis = rightAxis !== null && width >= DUAL_AXIS_MIN_WIDTH;
  const collapsedRightAxis = rightAxis !== null && !showRightAxis;

  const leftDomain = domains[0] ?? view.yDomain;
  const rightDomain = rightAxis ? (domains[1] ?? view.yDomain) : null;
  const leftCandidates = axisTickCandidates(leftDomain, leftAxis, ctx.locale, yFailures[0]!);
  const rightCandidates = showRightAxis && rightAxis && rightDomain
    ? axisTickCandidates(rightDomain, rightAxis, ctx.locale, yFailures[1]!)
    : [];
  const { candidates: xCandidates, mayThin: xMayThin } = buildXCandidates(view, ctx, xFailures);

  const leftLabels = prepareLabels(leftCandidates);
  const rightLabels = showRightAxis ? prepareLabels(rightCandidates) : undefined;
  const xLabels = prepareLabels(xMayThin ? xCandidates : xCandidates.slice(0, 1));

  const clearance = (leftLabels.sets.some(s => s.length > 0) || (rightLabels?.sets.some(s => s.length > 0) ?? false))
    ? text.lineHeight / 2 : 0;
  const top = INSET + clearance;
  let left = INSET;
  let right = INSET;
  let bottom = INSET + clearance;

  const leftTitleStr = axisTitleText(leftAxis);
  const rightTitleStr = showRightAxis && rightAxis ? axisTitleText(rightAxis) : undefined;
  const xTitleStr = (view.frame.x.kind === 'number' || ctx.xLabelGiven)
    ? withUnit(view.frame.xLabel, ctx.resolved.x.unit)
    : undefined;

  const measured: number[] = [];
  const bottomMeasured: number[] = [];
  let leftFit = NO_LABELS;
  let rightFit = NO_LABELS;
  let xFit = NO_LABELS;
  let leftTitle = NO_TITLE;
  let rightTitle = NO_TITLE;
  let xTitle = NO_TITLE;
  let leftTitleSize = 0;
  let rightTitleSize = 0;
  let xTitleSize = 0;
  let bottomLineSet = -1;
  let bottomLane = 0;
  let grow = false;

  for (let iter = 0; iter < 16; iter++) {
    const plot: Rect = { x: left, y: top, width: width - left - right, height: height - top - bottom };
    if (plot.width < MIN_WIDTH - 1e-7 || plot.height < MIN_HEIGHT - 1e-7) {
      return { layout: { width, height, kind: 'too-small' }, collapsedRightAxis, xFailures, yFailures };
    }

    const projection = makeProjection(plot);
    const xScale = projection.kind === 'xy' ? projection.x : (projection as { readonly band: XScale }).band;
    const leftScale = axisScaleOf(projection, 0);
    const rightScale = showRightAxis ? axisScaleOf(projection, 1) : null;

    const lLines = titleLines(leftTitleStr, plot.height, text);
    if (!lLines) return { layout: { width, height, kind: 'too-small' }, collapsedRightAxis, xFailures, yFailures };
    leftTitle = lLines;
    leftTitleSize = titleDepth(lLines, text);

    const rLines = showRightAxis ? titleLines(rightTitleStr, plot.height, text) : NO_TITLE;
    if (!rLines) return { layout: { width, height, kind: 'too-small' }, collapsedRightAxis, xFailures, yFailures };
    rightTitle = rLines;
    rightTitleSize = showRightAxis ? titleDepth(rLines, text) : 0;

    const availSide = Math.max(0, width - 2 * INSET - MIN_WIDTH - leftTitleSize - rightTitleSize - (showRightAxis ? 2 * TICK_GAP : TICK_GAP));
    const leftRoom = showRightAxis ? availSide / 2 : availSide;
    const rightRoom = showRightAxis ? availSide / 2 : 0;

    leftFit = fitValue(leftCandidates, leftScale, 'left', height, leftRoom, 'tick-y', text, leftLabels, measured);
    rightFit = showRightAxis && rightScale && rightLabels
      ? fitValue(rightCandidates, rightScale, 'left', height, rightRoom, 'tick-y', text, rightLabels, measured)
      : NO_LABELS;

    const bLines = titleLines(xTitleStr, plot.width, text);
    if (!bLines) return { layout: { width, height, kind: 'too-small' }, collapsedRightAxis, xFailures, yFailures };
    xTitle = bLines;
    xTitleSize = titleDepth(bLines, text);

    const fixed = INSET + clearance + xTitleSize + TICK_GAP;
    const bottomRoom = Math.max(0, height - top - MIN_HEIGHT - fixed);
    const deferLines = xScale.type !== 'band';
    bottomLineSet = deferLines ? fitBottomLines(xLabels, xMayThin, xScale, width, bottomRoom, text, bottomMeasured) : -1;
    if (bottomLineSet >= 0) {
      bottomLane = xLabels.sets[bottomLineSet]!.length ? TICK_GAP + Math.max(0, text.lineHeight) : 0;
    } else {
      const rotatedRoom = Math.min(bottomRoom, height * 0.4 - fixed);
      xFit = fitBottom(xCandidates, xMayThin, xScale, width, bottomRoom, 'tick-x', text, xLabels, rotatedRoom, measured, !deferLines);
      bottomLane = lane(xFit);
    }

    const nextLeft = INSET + lane(leftFit) + leftTitleSize;
    const nextRight = showRightAxis ? INSET + lane(rightFit) + rightTitleSize : INSET;
    const nextBottom = INSET + clearance + bottomLane + xTitleSize;

    if (iter >= 6) grow = true;
    if ((!grow && nextLeft === left && nextRight === right && nextBottom === bottom) ||
        (grow && nextLeft <= left && nextRight <= right && nextBottom <= bottom)) {
      const base = plot.y + plot.height + clearance;
      const texts: PlacedText[] = [];
      for (const label of leftFit.texts) texts.push(moveText(label, left - TICK_GAP, 0));
      if (showRightAxis) {
        const rightEdge = plot.x + plot.width + TICK_GAP;
        for (const label of rightFit.texts) texts.push(placeRightTick(label, rightEdge));
      }
      if (bottomLineSet >= 0) {
        xFit = placeBottomLines(xLabels.sets[bottomLineSet]!, bottomLineSet > 0, base + TICK_GAP, 'tick-x', text, bottomMeasured);
        for (const label of xFit.texts) texts.push(label);
      } else {
        for (const label of xFit.texts) texts.push(moveText(label, 0, base + TICK_GAP));
      }
      if (leftTitleStr && leftTitle.length) {
        texts.push(placeText(
          leftTitle, leftTitleStr, left - lane(leftFit) - GAP - leftTitle.length * text.lineHeight / 2,
          plot.y + plot.height / 2, 'middle', 'middle', -90, 'title-y', text,
        ));
      }
      if (showRightAxis && rightTitleStr && rightTitle.length) {
        texts.push(placeText(
          rightTitle, rightTitleStr, plot.x + plot.width + lane(rightFit) + GAP + rightTitle.length * text.lineHeight / 2,
          plot.y + plot.height / 2, 'middle', 'middle', -90, 'title-y', text,
        ));
      }
      if (xTitleStr && xTitle.length) {
        texts.push(placeText(xTitle, xTitleStr, left + plot.width / 2, base + bottomLane + GAP, 'middle', 'top', 0, 'title-x', text));
      }
      placeCartesianReferences(view.references, projection, plot, texts, text, meta);

      const xHidden = xScale.type === 'band' ? Math.max(0, (view.frame.x.categories?.length ?? view.frame.length) - xFit.texts.length) : 0;
      const leftHidden = leftFit.partial ? Math.max(0, (leftCandidates[leftCandidates.length - 1]?.length ?? 0) - leftFit.ticks.length) : 0;
      const rightHidden = showRightAxis && rightFit.partial
        ? Math.max(0, (rightCandidates[rightCandidates.length - 1]?.length ?? 0) - rightFit.ticks.length)
        : 0;

      const layout: Layout = {
        width,
        height,
        kind: 'plot',
        plot,
        projection,
        xTicks: xFit.ticks,
        yTicks: leftFit.ticks,
        ...(showRightAxis ? { yTicksRight: rightFit.ticks } : {}),
        texts,
        fit: {
          x: { remedies: xFit.remedies, hidden: xHidden },
          // Fold right-axis hidden label count into fit.y.hidden so frame-state.ts:60 triggers AX143 at 0 B core tax.
          y: { remedies: leftFit.remedies, hidden: leftHidden + rightHidden },
          ...(showRightAxis ? { yRight: { remedies: rightFit.remedies, hidden: rightHidden } } : {}),
        },
      };
      return { layout, collapsedRightAxis, xFailures, yFailures };
    }

    left = grow ? Math.max(left, nextLeft) : nextLeft;
    right = grow ? Math.max(right, nextRight) : nextRight;
    bottom = grow ? Math.max(bottom, nextBottom) : nextBottom;
  }

  return { layout: { width, height, kind: 'too-small' }, collapsedRightAxis, xFailures, yFailures };
}

export function createCartesianLayoutStage(stateRef: CartesianStateRef): LayoutStage {
  let lastResult: CartesianLayoutComputation | null = null;
  let lastLayout: Layout | null = null;
  return {
    layoutKey(view, size, style, fontEpoch, ctx) {
      const base = baseLayoutKey(view, size, style, fontEpoch, ctx);
      if (view.kind === 'donut') return base;
      base.push(view.xDomain[0], view.xDomain[1]);
      const domains = view.yDomains ?? [view.yDomain];
      for (const d of domains) base.push(d[0], d[1]);
      for (const axis of stateRef.meta.axes) {
        base.push(axis.id, axis.position, axis.scale, axis.base, axis.label, axis.unit, axis.tickFormat);
      }
      base.push(view.references, ctx.resolved.x.label, ctx.resolved.x.unit, ctx.resolved.x.tickFormat);
      for (const v of view.visible) base.push(v);
      return base;
    },
    compute(view, size, text, ctx) {
      if (view.kind === 'donut' || view.kind === 'scatter') {
        return { width: size.width, height: size.height, kind: 'unmeasured' };
      }
      const res = computeCartesianLayoutDetailed(view, size, text, ctx, stateRef);
      lastResult = res;
      lastLayout = res.layout;
      return res.layout;
    },
    layoutDiagnostics(_view, ctx, layout) {
      if (layout.kind !== 'plot' || !lastResult || lastLayout !== layout) return [];
      const out: DiagnosticInput[] = [];
      if (lastResult.xFailures.drawn(layout.xTicks)) {
        out.push(createDiagnostic('AX160', 'none', { field: ctx.resolved.x.field }, 'presentation'));
      }
      const leftAxis = stateRef.meta.axes[0];
      if (leftAxis && lastResult.yFailures[0]?.drawn(layout.yTicks)) {
        out.push(createDiagnostic('AX160', 'none', { field: leftAxis.id }, 'presentation'));
      }
      const rightAxis = stateRef.meta.axes[1];
      if (rightAxis && layout.yTicksRight && lastResult.yFailures[1]?.drawn(layout.yTicksRight)) {
        out.push(createDiagnostic('AX160', 'none', { field: rightAxis.id }, 'presentation'));
      }
      if (lastResult.collapsedRightAxis && rightAxis) {
        out.push(createCartesianDiagnostic('AX175', 'none', { field: rightAxis.id }, 'presentation'));
      }
      return out;
    },
  };
}
