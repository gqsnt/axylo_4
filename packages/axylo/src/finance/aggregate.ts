/**
 * Pixel-bin OHLCV aggregation for dense candlestick views (`axylo/finance`, N7a).
 *
 * Drawing is the only consumer: tooltip, keyboard, table and summary keep reading the raw slots, so a zoom
 * back in (or any readout) is exact. Storage is typed and bounded by the plot width, never by the row count.
 */

/** Width of one aggregation column in CSS px. Two pixels leave a visible body and a gap between neighbours. */
export const BIN_WIDTH = 2;

/** Candles in view beyond which drawing aggregates: more than one candle per bin column (and at least 200). */
export function denseThreshold(plotWidth: number): number {
  return Math.max(plotWidth / BIN_WIDTH, 200);
}

export interface OhlcvBins {
  /** Number of filled bins. */
  readonly count: number;
  /** Pixel center of each bin (CSS px). */
  readonly center: Float64Array;
  readonly open: Float64Array;
  readonly high: Float64Array;
  readonly low: Float64Array;
  readonly close: Float64Array;
  /**
   * Sum of the drawable volumes in the bin; NaN when the bin has none. A sum past the largest double (each
   * volume finite, their total not) is held at Number.MAX_VALUE and counted in `saturated`.
   */
  readonly volume: Float64Array;
  /** Drawable candles in the bin (0 = the bin holds volume only, or nothing drawable). */
  readonly candles: Uint32Array;
  /** First and last slot of the bin, for tests and diagnostics. */
  readonly first: Int32Array;
  readonly last: Int32Array;
  /** Largest bin volume sum (0 when none): the dense volume pane's maximum. Always finite. */
  readonly maxVolume: number;
  /** Bins whose volume sum overflowed and is drawn at Number.MAX_VALUE (reported as AX181 by the layout). */
  readonly saturated: number;
}

export interface OhlcvColumns {
  readonly open: ArrayLike<number>;
  readonly high: ArrayLike<number>;
  readonly low: ArrayLike<number>;
  readonly close: ArrayLike<number>;
  /** Null when the chart has no volume field (or it is hidden). */
  readonly volume: ArrayLike<number> | null;
  /** Whether slot i is a drawable candle (complete and a valid OHLC envelope). */
  readonly candle: (slot: number) => boolean;
  /** Whether slot i has a drawable volume (a finite, non-negative value of a drawable candle). */
  readonly drawableVolume: (slot: number) => boolean;
  /** Projected x of slot i in CSS px. */
  readonly x: (slot: number) => number;
}

/**
 * Aggregates the slots [start, end) into contiguous bins of BIN_WIDTH CSS px across [left, left + width]:
 * first open, highest high, lowest low, last close, summed volume. Slots are sorted by x, so a bin is a
 * contiguous run and one pass suffices. A slot projected on (or rounding past) the right edge joins the last
 * column instead of opening one outside the plot.
 */
export function aggregateOhlcv(columns: OhlcvColumns, start: number, end: number, left: number, width: number): OhlcvBins {
  const cols = Math.max(1, Math.ceil(width / BIN_WIDTH));
  const center = new Float64Array(cols);
  const open = new Float64Array(cols);
  const high = new Float64Array(cols);
  const low = new Float64Array(cols);
  const close = new Float64Array(cols);
  const volume = new Float64Array(cols);
  const candles = new Uint32Array(cols);
  const first = new Int32Array(cols);
  const last = new Int32Array(cols);
  let count = 0;
  let column = -1;
  let maxVolume = 0;
  let saturated = 0;
  let capped = false;
  const { volume: vol } = columns;
  for (let i = start; i < end; i++) {
    const px = columns.x(i);
    if (!Number.isFinite(px)) continue;
    const isCandle = columns.candle(i);
    const hasVolume = vol !== null && columns.drawableVolume(i);
    if (!isCandle && !hasVolume) continue;
    let c = Math.floor((px - left) / BIN_WIDTH);
    if (c < 0) c = 0;
    else if (c >= cols) c = cols - 1;
    if (c !== column) {
      // Columns only grow with x; a NaN-free sorted x never revisits one.
      column = c;
      const b = count++;
      center[b] = Math.min(left + width, left + (c + 0.5) * BIN_WIDTH);
      high[b] = -Infinity;
      low[b] = Infinity;
      open[b] = NaN;
      close[b] = NaN;
      volume[b] = NaN;
      candles[b] = 0;
      first[b] = i;
      capped = false;
    }
    const b = count - 1;
    last[b] = i;
    if (isCandle) {
      if (candles[b] === 0) open[b] = columns.open[i]!;
      close[b] = columns.close[i]!;
      const h = columns.high[i]!;
      const l = columns.low[i]!;
      if (h > high[b]!) high[b] = h;
      if (l < low[b]!) low[b] = l;
      candles[b]!++;
    }
    if (hasVolume) {
      const v = vol![i]!;
      const was = volume[b]!;
      let sum = was !== was ? v : was + v;
      if (sum === Infinity) {
        // A bar taller than any representable volume cannot be drawn as given: it is held at the top of
        // the scale and counted once per bin, so the layout can say so. Readouts keep the raw values.
        sum = Number.MAX_VALUE;
        if (!capped) saturated++;
        capped = true;
      }
      volume[b] = sum;
      if (sum > maxVolume) maxVolume = sum;
    }
  }
  return { count, center, open, high, low, close, volume, candles, first, last, maxVolume, saturated };
}
