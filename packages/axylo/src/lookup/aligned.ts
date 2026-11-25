import { binIndex } from '../data/search';
import { SLOT_NULL, SLOT_VALUE } from '../core/contracts';
import type { AlignedView, DatumRef, DatumText, Formatters, Lookup, PickTarget, SlotState } from '../core/contracts';
import type { Messages } from '../public';
import { fill } from '../messages';
import { clipBox, contains, pointBox, POINTER_SLACK, type PlotLayout } from './geometry';
import { clamp, projectBand } from '../scene/geometry';
import { lowerBound, stepIndex } from './search';
import { incomplete, slotLabel, slotText } from './text';

const TOOLTIP_LIMIT = 8;

export function alignedLookup(view: AlignedView, layout: PlotLayout | null, formatters: Formatters, messages: Messages): Lookup {
  const { frame, visibleSlots: { start, end }, stack } = view;
  const { series } = frame;
  const positions = frame.x.values;
  const visible: number[] = [];
  for (let s = 0; s < series.length; s++) if (view.visible[s] && series[s]!.drawable) visible.push(s);
  let keys: Map<string, number> | undefined;
  const plot = layout?.plot;
  const projection = layout?.projection;
  const xScale = projection?.kind === 'xy' ? projection.x : projection?.kind === 'bands' ? projection.band : null;
  const horizontal = projection?.kind === 'bands' && projection.horizontal;

  let bounds: Float64Array | undefined;
  let pickedSlot = -1;
  const inView = (i: number) => i >= start && i < end;

  function seriesIndex(key: string): number | undefined {
    if (series.length <= 4) {
      for (let s = series.length - 1; s >= 0; s--) if (series[s]!.key === key) return s;
      return undefined;
    }
    if (!keys) {
      keys = new Map();
      for (let s = 0; s < series.length; s++) keys.set(series[s]!.key, s);
    }
    return keys.get(key);
  }

  function ref(s: number, i: number): DatumRef {
    return { kind: 'aligned', seriesKey: series[s]!.key, x: positions[i]! };
  }

  function index(x: number): number {
    // The tooltip, cursor, and focus usually ask about the x just picked.
    if (pickedSlot >= 0 && positions[pickedSlot] === x) return pickedSlot;
    const i = lowerBound(positions, x);
    return positions[i] === x ? i : -1;
  }

  function isValue(s: number, i: number): boolean {
    return series[s]!.slot[i] === SLOT_VALUE;
  }

  function seek(s: number, i: number, delta: 1 | -1, lo = start, hi = end): number {
    const { slot } = series[s]!;
    for (; i >= lo && i < hi; i += delta) if (slot[i] === SLOT_VALUE) return i;
    return -1;
  }

  function first(): DatumRef | null {
    let earliest = end;
    let chosen = -1;
    for (const s of visible) {
      const i = seek(s, start, 1, start, earliest);
      if (i >= 0) {
        earliest = i;
        chosen = s;
      }
    }
    return chosen < 0 ? null : ref(chosen, earliest);
  }

  /**
   * One series' row at a slot. Rows are plain: an incomplete stack is said once, on the tooltip's total
   * (spec F10, review C2-7). A single datum read on its own (`announce`) has no total beside it, so the
   * component that makes its stack incomplete says so; the values that are there are not qualified.
   */
  function write(s: number, i: number, announce = false): DatumText {
    const entry = series[s]!;
    const state = entry.slot[i] as SlotState;
    const value = slotText(formatters, s, entry.y[i]!, state);
    const missingComponent = announce && state !== SLOT_VALUE
      && stack?.incomplete?.[i] && stack.order.includes(s) && visible.includes(s);
    return {
      ref: ref(s, i), seriesIndex: s, seriesLabel: entry.label, x: slotLabel(frame, formatters, i),
      value: missingComponent ? incomplete(value, messages) : value,
      state, percent: null, row: entry.row?.[i] ?? i,
    };
  }

  function primary(i: number): DatumRef | null {
    if (!inView(i)) return null;
    for (const s of visible) if (isValue(s, i)) return ref(s, i);
    const s = visible[0];
    return s === undefined ? null : ref(s, i);
  }

  function resolve(datum: DatumRef): DatumRef | null {
    if (datum.kind !== 'aligned') return null;
    const s = seriesIndex(datum.seriesKey);
    if (s === undefined) return null;
    const i = lowerBound(positions, datum.x);
    const exact = inView(i) && positions[i] === datum.x;
    if (!view.visible[s] || !series[s]!.drawable) {
      return exact && !view.visible[s] ? primary(i) : null;
    }
    if (exact) return datum;
    const next = seek(s, Math.max(i, start), 1);
    const replacement = next >= 0 ? next : seek(s, Math.min(i - 1, end - 1), -1);
    return replacement < 0 ? null : ref(s, replacement);
  }

  function nearestSlot(pixel: number): number {
    if (!xScale || start === end) return -1;
    const x = xScale.invert(pixel);
    if (xScale.type === 'band') return inView(x) ? x : -1;
    if (frame.binEdges) {
      const bin = binIndex(frame.binEdges, x);
      return bin >= 0 ? clamp(bin, start, end - 1) : -1;
    }
    const right = lowerBound(positions, x, start, end);
    if (right === start) return start;
    if (right === end) return end - 1;
    // Use screen distances for the final comparison because inversion can round at a midpoint.
    const leftPixel = xScale.map(positions[right - 1]!);
    const rightPixel = xScale.map(positions[right]!);
    const midpoint = leftPixel / 2 + rightPixel / 2;
    return (leftPixel <= rightPixel ? pixel >= midpoint : pixel <= midpoint) ? right : right - 1;
  }

  const at = (target: PickTarget) => target.kind === 'x' ? index(target.x) : -1;

  return {
    members(target, from, count) {
      const i = at(target);
      // The tooltip's rows, in its order: the visible series at that x.
      from = Math.max(0, from);
      return inView(i) ? visible.slice(from, from + Math.max(0, count)).map(s => ref(s, i)) : [];
    },
    has(target, datum) {
      const i = at(target);
      if (!inView(i) || datum.kind !== 'aligned' || datum.x !== positions[i]) return false;
      const s = seriesIndex(datum.seriesKey);
      return s !== undefined && !!view.visible[s] && series[s]!.drawable;
    },
    slot(datum) {
      return datum.kind === 'aligned' && seriesIndex(datum.seriesKey) !== undefined ? index(datum.x) : -1;
    },
    pick(pointerX, pointerY) {
      if (!plot || !visible.length) return null;
      // Clamp the picking axis only, with the same one-pixel allowance as pointerOnPlot.
      const right = plot.x + plot.width;
      const bottom = plot.y + plot.height;
      if (!(pointerX >= plot.x - POINTER_SLACK && pointerX <= right + POINTER_SLACK &&
        pointerY >= plot.y - POINTER_SLACK && pointerY <= bottom + POINTER_SLACK)) return null;
      const pixel = horizontal ? Math.min(bottom, Math.max(plot.y, pointerY)) : Math.min(right, Math.max(plot.x, pointerX));
      const i = nearestSlot(pixel);
      if (i < 0) return null;
      pickedSlot = i;
      return { kind: 'x', x: positions[i]! };
    },
    tooltip(target) {
      const i = at(target);
      if (!inView(i)) return { title: '', rows: [], count: 0, total: null };
      let total: string | null = null;
      if (stack && stack.order.length) {
        let positive = 0;
        let negative = 0;
        let hasValue = false;
        for (const s of stack.order) {
          if (!isValue(s, i)) continue;
          const value = series[s]!.y[i]!;
          if (value < 0) negative += value;
          else positive += value;
          hasValue = true;
        }
        const first = stack.order[0]!;
        total = !hasValue ? formatters.missing(SLOT_NULL)
          : positive > 0 && negative < 0 ? fill(messages.totalMixed, {
            positive: formatters.value(first, positive), negative: formatters.value(first, negative),
          }) : formatters.value(first, positive + negative);
        if (hasValue && stack.incomplete?.[i]) total = incomplete(total, messages);
      }
      const title = slotLabel(frame, formatters, i);
      const shown = Math.min(visible.length, TOOLTIP_LIMIT);
      const rows: DatumText[] = [];
      for (let row = 0; row < shown; row++) rows.push(write(visible[row]!, i));
      return { title, rows, count: visible.length, total };
    },
    primary(target) {
      return primary(at(target));
    },
    datum(datum) {
      if (datum.kind !== 'aligned') return null;
      const s = seriesIndex(datum.seriesKey);
      const i = index(datum.x);
      return s === undefined || i < 0 ? null : write(s, i, true);
    },
    anchor(datum) {
      if (datum.kind !== 'aligned' || !layout || !projection || !xScale) return null;
      const s = seriesIndex(datum.seriesKey);
      const i = index(datum.x);
      const lane = s === undefined ? -1 : visible.indexOf(s);
      if (s === undefined || lane < 0 || !inView(i)) return null;
      const value = series[s]!.y[i]!;
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
      bounds ??= new Float64Array(2);
      projectBand(frame, xScale, i, high - low, bounds, 0);
      const bandStart = clamp(bounds[0]!, low, high);
      const part = (clamp(bounds[1]!, low, high) - bandStart) / (stack ? 1 : visible.length);
      const size = frame.binEdges ? part : Math.max(1, part);
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
    count: end - start,
    ordinal(datum) {
      if (datum.kind !== 'aligned') return -1;
      const s = seriesIndex(datum.seriesKey);
      const i = index(datum.x);
      return s !== undefined && view.visible[s] && series[s]!.drawable && inView(i) ? i - start : -1;
    },
    step(from, direction) {
      if (!from) return first();
      const resolved = resolve(from);
      if (resolved?.kind !== 'aligned') return null;
      const s = seriesIndex(resolved.seriesKey)!;
      const at = index(resolved.x);
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
        case 'page-next':
        case 'page-previous': {
          const forward = direction === 'page-next';
          const delta = forward ? 1 : -1;
          const target = stepIndex(direction, at, start, end);
          if (target === null) return null;
          to = seek(s, target, delta);
          if (to < 0) to = seek(s, target - delta, forward ? -1 : 1, forward ? at + 1 : start, forward ? end : at);
          break;
        }
      }
      return to < 0 || to === at ? null : ref(s, to);
    },
    resolve,
  };
}
