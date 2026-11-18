import type {
  BandScale, ContinuousScale, DiagnosticSink, Layout, PlacedText, Projection, Rect,
  TextMeasurer, TextStyle, TickCandidates, XScale,
} from '../core/contracts';
import { fitBottom, fitLeftCategories, fitValue, placeText, wrapText } from './labels';
import type { FittedLabels, Metrics } from './labels';

type Span = readonly [number, number];

interface Axis {
  readonly candidates: TickCandidates;
  readonly title?: string;
  readonly mayThin: boolean;
}

export interface ValueAxis extends Axis {
  readonly domain: Span;
}

export interface ContinuousAxis extends ValueAxis {
  readonly type: 'linear' | 'time';
}

export interface BandAxis extends Axis {
  readonly type: 'band';
  readonly count: number;
  readonly padding: number;
}

export interface ScaleConstructors {
  linear(domain: Span, range: Span): ContinuousScale;
  time(domain: Span, range: Span): ContinuousScale;
  band(count: number, range: Span, padding: number): BandScale;
}

interface Size {
  readonly width: number;
  readonly height: number;
}

interface Axes {
  /** Logical category or independent axis, including for horizontal bars. */
  readonly x: ContinuousAxis | BandAxis;
  readonly y: ValueAxis;
  readonly scales: ScaleConstructors;
}

type Cartesian = Axes & (
  | { readonly kind: 'xy' }
  | { readonly kind: 'bands'; readonly horizontal: boolean }
);

interface TextInput {
  readonly measurer: TextMeasurer;
  readonly style: TextStyle;
}

type PlotInput = Size & { readonly diagnostics: DiagnosticSink; readonly compact?: boolean };

export type LayoutInput =
  | (PlotInput & Cartesian & TextInput)
  | (PlotInput & { readonly kind: 'ring' })
  | (Size & TextInput & { readonly kind: 'message'; readonly message: string });

const INSET = 4;
const GAP = 4;
const MIN_WIDTH = 120;
const MIN_HEIGHT = 80;
const UNCHANGED = { remedies: [], hidden: 0 } as const;

function independentScale(axis: Axes['x'], range: Span, scales: ScaleConstructors): XScale {
  return axis.type === 'band' ? scales.band(axis.count, range, axis.padding) : scales[axis.type](axis.domain, range);
}

function project(plot: Rect, axes: Cartesian): Exclude<Projection, { kind: 'ring' }> {
  const across: Span = [plot.x, plot.x + plot.width];
  const up: Span = [plot.y + plot.height, plot.y];
  const horizontal = axes.kind === 'bands' && axes.horizontal;
  const x = independentScale(axes.x, horizontal ? up : across, axes.scales);
  const y = axes.scales.linear(axes.y.domain, horizontal ? across : up);
  return axes.kind === 'xy' ? { kind: 'xy', x, y } : { kind: 'bands', horizontal, band: x, value: y };
}

function ring(plot: Rect): Projection {
  const r1 = Math.min(plot.width, plot.height) / 2;
  return { kind: 'ring', cx: plot.x + plot.width / 2, cy: plot.y + plot.height / 2, r0: r1 * 0.6, r1 };
}

function tooSmall(size: Size, diagnostics: DiagnosticSink): Layout {
  diagnostics.add({
    code: 'AX142', level: 'hint', message: 'The plot needs at least 120 × 80 CSS pixels.',
    effect: 'none', origin: 'presentation',
  });
  return { ...size, kind: 'too-small' };
}

function metrics(input: TextInput): Metrics {
  return { lineHeight: input.style.lineHeight, width: text => input.measurer.width(text, input.style) };
}

function moveText(text: PlacedText, dx: number, dy: number): PlacedText {
  return { ...text, x: text.x + dx, y: text.y + dy, box: { ...text.box, x: text.box.x + dx, y: text.box.y + dy } };
}

function lane(fit: FittedLabels): number {
  return fit.texts.length ? GAP + fit.depth : 0;
}

function layoutAxes(input: PlotInput & Cartesian & TextInput, size: Size): Layout {
  const { width, height } = size;
  const text = metrics(input);
  const horizontal = input.kind === 'bands' && input.horizontal;
  const leftAxis = horizontal ? input.x : input.y;
  const bottomAxis = horizontal ? input.y : input.x;
  const leftRole = horizontal ? 'tick-x' : 'tick-y';
  const bottomRole = horizontal ? 'tick-y' : 'tick-x';
  const clearance = leftAxis.candidates.some(set => set.length > 0) ? text.lineHeight / 2 : 0;
  const top = INSET + clearance;
  let left = INSET;
  let bottom = INSET + clearance;
  const visited = new Set<string>();
  let growMargins = false;

  for (;;) {
    const plot = { x: left, y: top, width: width - left - INSET, height: height - top - bottom };
    if (plot.width < MIN_WIDTH || plot.height < MIN_HEIGHT) return tooSmall(size, input.diagnostics);

    const projection = project(plot, input);
    const xScale = projection.kind === 'xy' ? projection.x : projection.band;
    const yScale = projection.kind === 'xy' ? projection.y : projection.value;
    const leftTitle = leftAxis.title ? wrapText(leftAxis.title, plot.height, text) : [];
    const bottomTitle = bottomAxis.title ? wrapText(bottomAxis.title, plot.width, text) : [];
    if (leftTitle.some(line => text.width(line) > plot.height) ||
        bottomTitle.some(line => text.width(line) > plot.width)) return tooSmall(size, input.diagnostics);
    const leftTitleSize = leftTitle.length ? GAP + leftTitle.length * text.lineHeight : 0;
    const bottomTitleSize = bottomTitle.length ? GAP + bottomTitle.length * text.lineHeight : 0;
    const bottomRoom = height - top - MIN_HEIGHT - INSET - clearance - bottomTitleSize - GAP;

    const leftFit = horizontal
      ? fitLeftCategories(leftAxis.candidates[0] ?? [], xScale, width, height, leftRole, text)
      : fitValue(leftAxis.candidates, yScale, 'left', height, Infinity, leftRole, text);
    const bottomFit = horizontal
      ? fitValue(bottomAxis.candidates, yScale, 'bottom', width, bottomRoom, bottomRole, text)
      : fitBottom(bottomAxis.candidates, bottomAxis.mayThin, xScale, width, bottomRoom, bottomRole, text);

    const nextLeft = INSET + lane(leftFit) + leftTitleSize;
    const nextBottom = INSET + clearance + lane(bottomFit) + bottomTitleSize;
    const key = left + '/' + bottom;
    // A sparser tick set can free space for a denser set on the next pass. If that
    // cycles, keep enough margin for either fit and use the labels at the final ranges.
    if (visited.has(key) || visited.size === 16) growMargins = true;
    if ((!growMargins && nextLeft === left && nextBottom === bottom) ||
        (growMargins && nextLeft <= left && nextBottom <= bottom)) {
      const base = plot.y + plot.height + clearance;
      const texts = [
        ...leftFit.texts.map(label => moveText(label, left - GAP, 0)),
        ...bottomFit.texts.map(label => moveText(label, 0, base + GAP)),
      ];
      if (leftAxis.title && leftTitle.length) {
        texts.push(placeText(leftTitle, leftAxis.title, left - lane(leftFit) - GAP - leftTitle.length * text.lineHeight / 2,
          plot.y + plot.height / 2, 'middle', 'middle', -90, horizontal ? 'title-x' : 'title-y', text));
      }
      if (bottomAxis.title && bottomTitle.length) {
        texts.push(placeText(bottomTitle, bottomAxis.title, left + plot.width / 2, base + lane(bottomFit) + GAP,
          'middle', 'top', 0, horizontal ? 'title-y' : 'title-x', text));
      }

      const xFit = horizontal ? leftFit : bottomFit;
      const yFit = horizontal ? bottomFit : leftFit;
      const hidden = xFit.fit.hidden + yFit.fit.hidden;
      if (hidden) {
        input.diagnostics.add({
          code: 'AX143', level: 'hint', count: hidden, effect: 'none', origin: 'presentation',
          message: horizontal ? 'Some labels are hidden. See the table.' : 'Some labels are hidden. Try horizontal bars or see the table.',
        });
      }
      return { ...size, kind: 'plot', plot, projection, xTicks: xFit.ticks, yTicks: yFit.ticks, texts, fit: { x: xFit.fit, y: yFit.fit } };
    }
    visited.add(key);
    left = growMargins ? Math.max(left, nextLeft) : nextLeft;
    bottom = growMargins ? Math.max(bottom, nextBottom) : nextBottom;
  }
}

export function computeLayout(input: LayoutInput): Layout {
  const { width, height } = input;
  const size = { width, height };
  if (width <= 0 || height <= 0) return { ...size, kind: 'unmeasured' };

  if (input.kind === 'message') {
    const text = metrics(input);
    const lines = wrapText(input.message, width, text);
    return { ...size, kind: 'message', text: placeText(lines, input.message, width / 2, height / 2, 'middle', 'middle', 0, 'message', text) };
  }
  if (input.compact) {
    const x = Math.min(2, width / 2);
    const y = Math.min(2, height / 2);
    const plot = { x, y, width: width - 2 * x, height: height - 2 * y };
    return { ...size, kind: 'compact', plot, projection: input.kind === 'ring' ? ring(plot) : project(plot, input) };
  }
  if (input.kind === 'ring') {
    if (width < MIN_WIDTH || height < MIN_HEIGHT) return tooSmall(size, input.diagnostics);
    const plot = { x: 0, y: 0, width, height };
    return { ...size, kind: 'plot', plot, projection: ring(plot), xTicks: [], yTicks: [], texts: [], fit: { x: UNCHANGED, y: UNCHANGED } };
  }
  return layoutAxes(input, size);
}
