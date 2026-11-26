import {
  SLOT_NO_ROW, SLOT_VALUE, type AlignedView, type Projection, type Rect, type RectMark,
} from '../core/contracts';
import { clamp, projectBands, position, seriesPaint, token } from './geometry';

type Bands = Extract<Projection, { kind: 'bands' }>;
// With the eight palette colours, no pattern and three patterns give the 32 combinations of spec F9.
const PATTERNS = ['diagonal', 'cross', 'dots'] as const;

/**
 * The pattern over a bar series' fill. A full chart adds one past the eighth series (F9); its legend names
 * the rest. A compact chart has no legend, so its bars side by side must differ by more than colour (spec A5,
 * C4): series s of colour c = s mod 8 in cycle k = floor(s / 8) takes pattern (k + c) mod 4 of none, diagonal,
 * cross, dots. Neighbours then differ by one pattern step (by two across a cycle), each colour takes all four
 * patterns over the first 32 series (F9's 32 combinations, the same as a full chart's), and series 0 is plain.
 * Series further apart can share a pattern and differ by colour; only more pattern values could avoid that.
 */
export function barPattern(series: number, compact: boolean): 'none' | typeof PATTERNS[number] {
  const group = compact ? (Math.floor(series / 8) + series % 8) % 4 : Math.floor(series / 8);
  return group ? PATTERNS[(group - 1) % PATTERNS.length]! : 'none';
}

function visibleOrder(visible: readonly boolean[]): number[] {
  const order: number[] = [];
  for (let i = 0; i < visible.length; i++) if (visible[i]) order.push(i);
  return order;
}

export function barMarks(view: AlignedView, projection: Bands, plot: Rect): RectMark[] {
  const { band, value, horizontal } = projection;
  const { start, end } = view.drawSlots[0] ?? view.visibleSlots;
  const { stack, frame } = view;
  const order = stack?.order ?? visibleOrder(view.visible);
  const low = horizontal ? plot.y : plot.x;
  const high = low + (horizontal ? plot.height : plot.width);
  const valueLow = horizontal ? plot.x : plot.y;
  const valueHigh = valueLow + (horizontal ? plot.width : plot.height);
  const zero = position(value, 0);
  const banded = band.type === 'band';
  const bins = frame.binEdges;
  const extents = projectBands(frame, band, start, end, high - low);
  const positives = stack?.positive.at(-1);
  const negatives = stack?.negative.at(-1);
  const divisor = stack ? 1 : order.length;
  const grouped = !stack && divisor > 1;
  const bars: RectMark[] = [];
  const missing: RectMark[] = [];

  for (let i = 0; i < order.length; i++) {
    const series = order[i]!;
    const { slot, y } = frame.series[series]!;
    const pos = stack?.positive[i];
    const neg = stack?.negative[i];
    const prevPos = stack?.positive[i - 1];
    const prevNeg = stack?.negative[i - 1];
    let valid = 0;
    let missed = 0;
    for (let j = start; j < end; j++) {
      if (slot[j] === SLOT_VALUE) valid++;
      else if (slot[j] !== SLOT_NO_ROW) missed++;
    }
    const values = new Float32Array(valid * 4);
    // A missing bar gets the "no data" mark; a slot the series merely has no row for gets nothing (F2).
    const absent = new Float32Array(missed * 4);
    let valueOffset = 0;
    let missingOffset = 0;
    const bandOffset = (stack ? 0 : i) + 0.5;

    for (let j = start, k = 0; j < end; j++, k += 2) {
      const state = slot[j];
      if (state === SLOT_NO_ROW) continue;
      const isValue = state === SLOT_VALUE;
      const bandStart = extents[k]!;
      let across: number;
      let width: number;
      if (bins) {
        // Clip in double precision so a bin extending far offscreen keeps exact Float32 plot edges.
        across = clamp(bandStart, low, high);
        width = Math.max(0, clamp(extents[k + 1]!, low, high) - across);
      } else {
        const part = (extents[k + 1]! - bandStart) / divisor;
        // Grouped bars side by side keep 1 px of background between them (spec A5); a stack shares its band.
        width = Math.max(1, grouped ? part - 1 : part);
        const mid = bandStart + part * bandOffset;
        across = banded ? clamp(mid - width / 2, low, Math.max(low, high - width)) : mid - width / 2;
      }
      const positiveTotal = positives?.[j] ?? 0;
      const negativeTotal = negatives?.[j] ?? 0;
      // A missing value has no sign. Prefer the positive edge unless only the negative side exists
      // or the preceding components have accumulated only on that side.
      const negative = isValue ? y[j]! < 0
        : negativeTotal < 0 && (positiveTotal === 0 || (prevNeg?.[j] ?? 0) < 0 && (prevPos?.[j] ?? 0) === 0);
      const base = isValue ? (negative ? prevNeg?.[j] : prevPos?.[j]) ?? 0 : negative ? negativeTotal : positiveTotal;
      const tip = isValue ? (negative ? neg?.[j] : pos?.[j]) ?? y[j]! : base;
      const basePixel = base === 0 ? zero : position(value, base);
      let from = clamp(basePixel, valueLow, valueHigh);
      const to = tip === base ? from : clamp(tip === 0 ? zero : position(value, tip), valueLow, valueHigh);
      if (stack && (base !== 0 || negative && positiveTotal > 0) && Math.abs(to - from) > 1 && basePixel === from) {
        // Leave the shared edge clear without moving the outside end of the stack.
        from += Math.sign(to - from);
      }

      const rects = isValue ? values : absent;
      let offset = isValue ? valueOffset : missingOffset;
      const along = Math.min(from, to);
      const length = Math.abs(to - from);
      rects[offset++] = horizontal ? along : across;
      rects[offset++] = horizontal ? across : along;
      rects[offset++] = horizontal ? length : width;
      rects[offset++] = horizontal ? width : length;
      if (isValue) valueOffset = offset;
      else missingOffset = offset;
    }

    const pattern = barPattern(series, view.compact && order.length > 1);
    const bar: RectMark = { type: 'rects', series, xywh: values, fill: seriesPaint(series), variant: 'bar' };
    bars.push(pattern === 'none' ? bar : { ...bar, pattern });
    if (absent.length) missing.push({ type: 'rects', series, xywh: absent, fill: token('muted'), variant: 'missing' });
  }
  return missing.length ? bars.concat(missing) : bars;
}
