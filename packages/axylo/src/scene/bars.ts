import {
  SLOT_VALUE, type AlignedView, type Projection, type Rect, type RectMark, type XScale,
} from '../core/contracts';
import { barHalfWidth } from '../view/bar-bands';
import { clamp, COORDINATE_LIMIT, position, seriesPaint, token } from './geometry';

type Bands = Extract<Projection, { kind: 'bands' }>;
// With the eight palette colours, no pattern and three patterns give the 32 combinations of spec F9.
const PATTERNS = ['diagonal', 'cross', 'dots'] as const;

/**
 * The pattern over a bar series' fill. A full chart adds one past the eighth series (F9). A compact chart has
 * no legend, so past its first series bars carry a pattern from the start and two series never differ by colour
 * alone (spec A5, C4), for as long as the patterns last: its combinations are the same 32, with the pattern
 * shifted by one for every colour but the first's. Series 1 to 24 are patterned; 25 to 31 are plain and differ
 * from series 0 by colour only, which a fourth pattern would avoid. After 32, combinations repeat.
 */
export function barPattern(series: number, compact: boolean): 'none' | typeof PATTERNS[number] {
  const group = compact ? (Math.floor(series / 8) + (series % 8 === 0 ? 0 : 1)) % 4 : Math.floor(series / 8);
  return group ? PATTERNS[(group - 1) % PATTERNS.length]! : 'none';
}

function bandExtents(
  scale: XScale, values: Float64Array, start: number, end: number, low: number, high: number,
): Float64Array {
  const extents = new Float64Array((end - start) * 2);
  for (let i = start, out = 0; i < end; i++) {
    const value = values[i]!;
    const center = position(scale, value);
    let halfWidth: number;
    if (scale.type === 'band') {
      halfWidth = scale.bandwidth / 2;
    } else {
      const half = barHalfWidth(values, i);
      // Project the extent before clipping so zoom does not shift or narrow the bar.
      const span = scale.domain[1] - scale.domain[0];
      const pixels = Math.abs(scale.range[1] - scale.range[0]);
      if (span === 0) halfWidth = (high - low) * 0.4;
      else if (pixels === 0) halfWidth = 0;
      else {
        const fraction = Number.isFinite(span) ? half / span : (half / 2) / (scale.domain[1] / 2 - scale.domain[0] / 2);
        // An extreme extrapolation still needs to fit the packed scene geometry.
        halfWidth = Math.min(fraction * pixels, COORDINATE_LIMIT);
      }
    }
    extents[out++] = center - halfWidth;
    extents[out++] = center + halfWidth;
  }
  return extents;
}

export function barMarks(view: AlignedView, projection: Bands, plot: Rect): RectMark[] {
  const { band, value, horizontal } = projection;
  const { start, end } = view.drawSlots[0] ?? view.visibleSlots;
  const { stack } = view;
  const order = stack?.order ?? view.visible.flatMap((shown, i) => shown ? [i] : []);
  const low = horizontal ? plot.y : plot.x;
  const high = low + (horizontal ? plot.height : plot.width);
  const valueLow = horizontal ? plot.x : plot.y;
  const valueHigh = valueLow + (horizontal ? plot.width : plot.height);
  const baseline = (v: number) => clamp(position(value, v), valueLow, valueHigh);
  const extents = bandExtents(band, view.frame.x.values, start, end, low, high);
  const positives = stack?.positive.at(-1);
  const negatives = stack?.negative.at(-1);
  const divisor = stack ? 1 : order.length;
  const bars: RectMark[] = [];
  const missing: RectMark[] = [];

  for (let i = 0; i < order.length; i++) {
    const series = order[i]!;
    const { slot, y } = view.frame.series[series]!;
    const pos = stack?.positive[i];
    const neg = stack?.negative[i];
    const prevPos = stack?.positive[i - 1];
    const prevNeg = stack?.negative[i - 1];
    let valid = 0;
    for (let j = start; j < end; j++) if (slot[j] === SLOT_VALUE) valid++;
    const values = new Float32Array(valid * 4);
    const absent = new Float32Array((end - start - valid) * 4);
    let valueOffset = 0;
    let missingOffset = 0;

    for (let j = start, k = 0; j < end; j++, k += 2) {
      const bandStart = extents[k]!;
      const part = (extents[k + 1]! - bandStart) / divisor;
      // Grouped bars side by side keep 1 px of background between them (spec A5); a stack shares its band.
      const width = Math.max(1, !stack && divisor > 1 ? part - 1 : part);
      const mid = bandStart + part * ((stack ? 0 : i) + 0.5);
      const across = band.type === 'band' ? clamp(mid - width / 2, low, Math.max(low, high - width)) : mid - width / 2;
      const isValue = slot[j] === SLOT_VALUE;
      const positiveTotal = positives?.[j] ?? 0;
      const negativeTotal = negatives?.[j] ?? 0;
      // A missing value has no sign. Prefer the positive edge unless only the negative side exists
      // or the preceding components have accumulated only on that side.
      const negative = isValue ? y[j]! < 0
        : negativeTotal < 0 && (positiveTotal === 0 || (prevNeg?.[j] ?? 0) < 0 && (prevPos?.[j] ?? 0) === 0);
      const base = isValue ? (negative ? prevNeg?.[j] : prevPos?.[j]) ?? 0 : negative ? negativeTotal : positiveTotal;
      const tip = isValue ? (negative ? neg?.[j] : pos?.[j]) ?? y[j]! : base;
      let from = baseline(base);
      const to = baseline(tip);
      if (stack && (base !== 0 || negative && positiveTotal > 0) && Math.abs(to - from) > 1 &&
        position(value, base) === from) {
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
  return bars.concat(missing);
}
