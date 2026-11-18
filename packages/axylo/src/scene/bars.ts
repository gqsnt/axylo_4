import {
  SLOT_VALUE, type AlignedView, type Projection, type Rect, type RectMark, type XScale,
} from '../core/contracts';
import { clamp, position, seriesPaint, token } from './geometry';

type Bands = Extract<Projection, { kind: 'bands' }>;

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
      const left = i > 0 ? Math.abs(center - position(scale, values[i - 1]!)) : Infinity;
      const right = i + 1 < values.length ? Math.abs(position(scale, values[i + 1]!) - center) : Infinity;
      // A continuous bar has no band width in its projection. Use the closest neighbour in x.
      const step = Math.min(left, right);
      halfWidth = 0.4 * (Number.isFinite(step) && step > 0 ? step : high - low);
    }
    extents[out++] = clamp(center - halfWidth, low, high);
    extents[out++] = clamp(center + halfWidth, low, high);
  }
  return extents;
}

export function barMarks(view: AlignedView, projection: Bands, plot: Rect): RectMark[] {
  const { band, value, horizontal } = projection;
  const { start, end } = view.visibleSlots;
  const { stack } = view;
  const order = stack?.order ?? view.visible.flatMap((shown, i) => shown ? [i] : []);
  const low = horizontal ? plot.y : plot.x;
  const high = low + (horizontal ? plot.height : plot.width);
  const valueLow = horizontal ? plot.x : plot.y;
  const valueHigh = valueLow + (horizontal ? plot.width : plot.height);
  const baseline = (v: number) => clamp(position(value, v), valueLow, valueHigh);
  const extents = bandExtents(band, view.frame.x.values, start, end, low, high);
  const positives = stack?.positive.at(-1);
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
      const width = Math.max(1, part);
      const mid = bandStart + part * ((stack ? 0 : i) + 0.5);
      const across = clamp(mid - width / 2, low, Math.max(low, high - width));
      const isValue = slot[j] === SLOT_VALUE;
      const negative = isValue && y[j]! < 0;
      const base = (negative ? prevNeg?.[j] : prevPos?.[j]) ?? 0;
      const tip = isValue ? (negative ? neg?.[j] : pos?.[j]) ?? y[j]! : base;
      let from = baseline(base);
      const to = baseline(tip);
      if (stack && (base !== 0 || negative && positives![j]! > 0) && Math.abs(to - from) > 1 &&
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

    bars.push({ type: 'rects', series, xywh: values, fill: seriesPaint(series), variant: 'bar' });
    if (absent.length) missing.push({ type: 'rects', series, xywh: absent, fill: token('muted'), variant: 'missing' });
  }
  return bars.concat(missing);
}
