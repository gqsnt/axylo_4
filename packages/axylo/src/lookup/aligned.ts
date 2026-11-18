import { SLOT_VALUE } from '../core/contracts';
import type { AlignedView, DatumRef, DatumText, Formatters, Lookup, SlotState } from '../core/contracts';
import type { Messages } from '../public';
import { clipBox, contains, pointBox, type PlotLayout } from './geometry';
import { lowerBound, pageDistance } from './search';
import { incomplete, slotText } from './text';

const RANK_BLOCK = 256;
const TOOLTIP_LIMIT = 8;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function alignedLookup(view: AlignedView, layout: PlotLayout | null, formatters: Formatters, messages: Messages): Lookup {
  const { frame, visibleSlots: { start, end }, stack } = view;
  const positions = frame.x.values;
  const visible = frame.series.flatMap((series, s) => view.visible[s] && series.drawable ? [s] : []);
  const keys = new Map(frame.series.map((series, s) => [series.key, s]));
  const projection = layout?.projection;
  const xScale = projection?.kind === 'xy' ? projection.x : projection?.kind === 'bands' ? projection.band : null;
  let ranks: Float64Array | undefined;

  function ref(s: number, i: number): DatumRef {
    return { kind: 'aligned', seriesKey: frame.series[s]!.key, x: positions[i]! };
  }

  function index(x: number): number {
    const i = lowerBound(positions, x);
    return positions[i] === x ? i : -1;
  }

  function isValue(s: number, i: number): boolean {
    return frame.series[s]!.slot[i] === SLOT_VALUE;
  }

  function seek(s: number, i: number, delta: 1 | -1, lo = start, hi = end): number {
    for (; i >= lo && i < hi; i += delta) if (isValue(s, i)) return i;
    return -1;
  }

  function first(): DatumRef | null {
    let earliest = end;
    let series = -1;
    for (const s of visible) {
      const i = seek(s, start, 1, start, earliest);
      if (i >= 0) {
        earliest = i;
        series = s;
      }
    }
    return series < 0 ? null : ref(series, earliest);
  }

  function write(s: number, i: number, announce = false): DatumText {
    const series = frame.series[s]!;
    const state = series.slot[i] as SlotState;
    const value = slotText(formatters, s, series.y[i]!, state);
    return {
      ref: ref(s, i), seriesIndex: s, seriesLabel: series.label, x: formatters.x(positions[i]!),
      value: announce && stack?.incomplete?.[i] && visible.includes(s) ? incomplete(value, messages) : value,
      state, percent: null, row: series.row?.[i] ?? i,
    };
  }

  function rankBlocks(): Float64Array {
    if (ranks) return ranks;
    // Pointing and stepping need no index. Build a small prefix index only when an ordinal is requested.
    ranks = new Float64Array(Math.ceil((end - start) / RANK_BLOCK) + 1);
    for (let block = 1; block < ranks.length; block++) {
      const lo = start + (block - 1) * RANK_BLOCK;
      const hi = Math.min(lo + RANK_BLOCK, end);
      let n = ranks[block - 1]!;
      for (const s of visible) for (let i = lo; i < hi; i++) if (isValue(s, i)) n++;
      ranks[block] = n;
    }
    return ranks;
  }

  function nearestSlot(pixel: number): number {
    if (!xScale || start === end) return -1;
    const x = xScale.invert(pixel);
    if (xScale.type === 'band') return x >= start && x < end ? x : -1;
    const right = lowerBound(positions, x, start, end);
    if (right === start) return start;
    if (right === end) return end - 1;
    // Use screen distances for the final comparison because inversion can round at a midpoint.
    const leftPixel = xScale.map(positions[right - 1]!);
    const rightPixel = xScale.map(positions[right]!);
    const midpoint = leftPixel / 2 + rightPixel / 2;
    return (leftPixel <= rightPixel ? pixel >= midpoint : pixel <= midpoint) ? right : right - 1;
  }

  return {
    pick(px, py) {
      if (!layout || !visible.length || !contains(layout.plot, px, py)) return null;
      const i = nearestSlot(projection?.kind === 'bands' && projection.horizontal ? py : px);
      return i < 0 ? null : { kind: 'x', x: positions[i]! };
    },
    tooltip(target) {
      const i = target.kind === 'x' ? index(target.x) : -1;
      if (i < start || i >= end) return { title: '', rows: [], count: 0, total: null };
      let total: string | null = null;
      if (stack && stack.order.length) {
        let sum = 0;
        for (const s of stack.order) if (isValue(s, i)) sum += frame.series[s]!.y[i]!;
        total = formatters.value(stack.order[0]!, sum);
        if (stack.incomplete?.[i]) total = incomplete(total, messages);
      }
      return {
        title: formatters.x(positions[i]!), rows: visible.slice(0, TOOLTIP_LIMIT).map(s => write(s, i)),
        count: visible.length, total,
      };
    },
    primary(target) {
      const i = target.kind === 'x' ? index(target.x) : -1;
      const s = i >= start && i < end ? (visible.find(s => isValue(s, i)) ?? visible[0]) : undefined;
      return s === undefined ? null : ref(s, i);
    },
    datum(datum) {
      if (datum.kind !== 'aligned') return null;
      const s = keys.get(datum.seriesKey);
      const i = index(datum.x);
      return s === undefined || i < 0 ? null : write(s, i, true);
    },
    anchor(datum) {
      if (datum.kind !== 'aligned' || !layout || !projection || !xScale) return null;
      const s = keys.get(datum.seriesKey);
      const i = index(datum.x);
      const lane = s === undefined ? -1 : visible.indexOf(s);
      if (s === undefined || lane < 0 || i < start || i >= end) return null;
      const value = frame.series[s]!.y[i]!;
      const present = isValue(s, i);
      const accumulated = stack?.order.indexOf(s) ?? -1;
      const side = value < 0 ? stack?.negative : stack?.positive;
      const top = accumulated < 0 ? value : side![accumulated]![i]!;
      if (projection.kind === 'xy') {
        if (!present) return null;
        const x = xScale.type === 'band' ? xScale.center(datum.x) : xScale.map(datum.x);
        const y = projection.y.map(top);
        return contains(layout.plot, x, y) ? pointBox(x, y) : null;
      }
      if (projection.kind !== 'bands') return null;
      const horizontal = projection.horizontal;
      const { plot } = layout;
      const low = horizontal ? plot.y : plot.x;
      const high = low + (horizontal ? plot.height : plot.width);
      const center = xScale.type === 'band' ? xScale.center(datum.x) : xScale.map(datum.x);
      let half: number;
      if (xScale.type === 'band') {
        half = xScale.bandwidth / 2;
      } else {
        const adjacent = i > 0 ? Math.abs(center - xScale.map(positions[i - 1]!)) : Infinity;
        const following = i + 1 < positions.length ? Math.abs(xScale.map(positions[i + 1]!) - center) : Infinity;
        const spacing = Math.min(adjacent, following);
        // Continuous bars use their closest neighbour to leave a gap on both sides of a mark.
        half = 0.4 * (Number.isFinite(spacing) && spacing > 0 ? spacing : high - low);
      }
      const bandStart = clamp(center - half, low, high);
      const part = (clamp(center + half, low, high) - bandStart) / (stack ? 1 : visible.length);
      const size = Math.max(1, part);
      const middle = bandStart + part * ((stack ? 0 : lane) + 0.5);
      const band = clamp(middle - size / 2, low, Math.max(low, high - size));
      const base = accumulated > 0 ? side![accumulated - 1]![i]! : 0;
      const valueLow = horizontal ? plot.x : plot.y;
      const valueHigh = valueLow + (horizontal ? plot.width : plot.height);
      const baseline = projection.value.map(base);
      const tip = present ? projection.value.map(top) : baseline;
      let a = clamp(baseline, valueLow, valueHigh);
      const b = clamp(tip, valueLow, valueHigh);
      const mixedSign = value < 0 && (stack?.positive.at(-1)?.[i] ?? 0) > 0;
      if (stack && (base !== 0 || mixedSign) && Math.abs(b - a) > 1 && baseline === a) {
        a += Math.sign(b - a);
      }
      const length = Math.abs(a - b);
      const edge = Math.min(a, b);
      const box = horizontal ? { x: edge, y: band, width: length, height: size }
        : { x: band, y: edge, width: size, height: length };
      if (!present) {
        // The renderer grows missing markers from a zero-length baseline rectangle.
        const height = Math.max(6, box.height);
        return clipBox({ ...box, y: box.y + box.height - height, height, width: Math.max(6, box.width) }, plot);
      }
      if (length === 0 && (baseline < valueLow && tip < valueLow || baseline > valueHigh && tip > valueHigh)) return null;
      return clipBox(box, plot);
    },
    get count() {
      const blocks = rankBlocks();
      return blocks[blocks.length - 1]!;
    },
    ordinal(datum) {
      if (datum.kind !== 'aligned') return -1;
      const s = keys.get(datum.seriesKey);
      const i = index(datum.x);
      if (s === undefined || !visible.includes(s) || i < start || i >= end || !isValue(s, i)) return -1;
      const block = Math.floor((i - start) / RANK_BLOCK);
      const lo = start + block * RANK_BLOCK;
      let n = rankBlocks()[block]!;
      for (const series of visible) {
        for (let j = lo; j < i; j++) if (isValue(series, j)) n++;
        if (series < s && isValue(series, i)) n++;
      }
      return n;
    },
    step(from, direction) {
      if (!from) return first();
      if (from.kind !== 'aligned') return null;
      const s = keys.get(from.seriesKey);
      const at = index(from.x);
      if (s === undefined || !visible.includes(s) || at < start || at >= end) return null;
      let to = -1;
      switch (direction) {
        case 'series-next':
        case 'series-previous': {
          const neighbor = visible[visible.indexOf(s) + (direction === 'series-next' ? 1 : -1)];
          return neighbor === undefined ? null : ref(neighbor, at);
        }
        case 'first': to = seek(s, start, 1); break;
        case 'last': to = seek(s, end - 1, -1); break;
        case 'next': to = seek(s, at + 1, 1); break;
        case 'previous': to = seek(s, at - 1, -1); break;
        case 'page-next': {
          if (at === end - 1) return null;
          const target = Math.min(end - 1, at + pageDistance(end - start));
          to = seek(s, target, 1);
          if (to < 0) to = seek(s, target - 1, -1, at + 1);
          break;
        }
        case 'page-previous': {
          if (at === start) return null;
          const target = Math.max(start, at - pageDistance(end - start));
          to = seek(s, target, -1);
          if (to < 0) to = seek(s, target + 1, 1, start, at);
          break;
        }
      }
      return to < 0 ? null : ref(s, to);
    },
    resolve(datum) {
      if (datum.kind !== 'aligned') return null;
      const s = keys.get(datum.seriesKey);
      if (s === undefined) return null;
      const i = lowerBound(positions, datum.x);
      if (positions[i] === datum.x) return datum;
      const next = seek(s, i, 1, 0, frame.length);
      const replacement = next >= 0 ? next : seek(s, i - 1, -1, 0, frame.length);
      return replacement < 0 ? null : ref(s, replacement);
    },
  };
}
