import type { DatumRef, DonutView, Formatters, Lookup, Rect } from '../core/contracts';
import { donutGeometry } from '../view/donut-geometry';
import { pointerOnPlot, type PlotLayout } from './geometry';
import { stepIndex } from './search';
import { sliceText } from './text';

const TURN = 6.283185307179586; // 2π, a literal so the module does no work at import time

function sectorBox(cx: number, cy: number, inner: number, outer: number, start: number, end: number): Rect {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  function include(angle: number, radius: number) {
    const x = cx + Math.sin(angle) * radius;
    const y = cy - Math.cos(angle) * radius;
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  for (const radius of [inner, outer]) {
    include(start, radius);
    include(end, radius);
    const quarter = Math.PI / 2;
    for (let angle = Math.ceil(start / quarter) * quarter; angle < end; angle += quarter) include(angle, radius);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function donutLookup(view: DonutView, layout: PlotLayout | null, formatters: Formatters, locale?: string): Lookup {
  const { slices } = view;
  let keys: Map<string, number> | undefined;
  const ring = layout?.projection.kind === 'ring' ? layout.projection : null;
  let geometry: ReturnType<typeof donutGeometry> | undefined;

  function index(datum: DatumRef): number {
    if (datum.kind !== 'slice') return -1;
    const key = datum.sliceKey;
    if (slices.length <= 4) {
      for (let i = slices.length - 1; i >= 0; i--) if (slices[i]!.key === key) return i;
      return -1;
    }
    if (!keys) {
      keys = new Map();
      for (let i = 0; i < slices.length; i++) keys.set(slices[i]!.key, i);
    }
    return keys.get(key) ?? -1;
  }

  function ref(i: number): DatumRef | null {
    const slice = slices[i];
    return slice ? { kind: 'slice', sliceKey: slice.key } : null;
  }

  function resolve(datum: DatumRef): DatumRef | null {
    if (datum.kind !== 'slice') return null;
    if (index(datum) >= 0) return datum;
    for (const slice of slices) {
      if (slice.members.length < 2) continue;
      for (const i of slice.members) {
        const label = view.frame.labels[i];
        // The view prefixes author labels that would collide with the reserved Other key.
        if (label !== undefined && datum.sliceKey === (label.startsWith('__other__') ? '__other__' + label : label)) {
          return { kind: 'slice', sliceKey: slice.key };
        }
      }
    }
    return null;
  }

  const lookup: Lookup = {
    members(target, from, count) {
      return target.kind === 'slice' && from <= 0 && count > 0 && index(target) >= 0 ? [target] : [];
    },
    has(target, datum) {
      return target.kind === 'slice' && datum.kind === 'slice' && datum.sliceKey === target.sliceKey && index(target) >= 0;
    },
    /** The slice's index in the view's slices (an "Other" slice stands for several frame categories). */
    slot: index,
    pick(pointerX, pointerY) {
      if (!layout || !ring || !(ring.r1 > ring.r0)) return null;
      const at = pointerOnPlot(layout.plot, pointerX, pointerY);
      if (!at) return null;
      const { x: px, y: py } = at;
      const dx = px - ring.cx;
      const dy = py - ring.cy;
      const radius = Math.hypot(dx, dy);
      if (radius < ring.r0 || radius > ring.r1) return null;
      const raw = Math.atan2(dx, -dy);
      const angle = raw < 0 ? raw + TURN : raw;
      const { drawn, angles } = geometry ??= donutGeometry(slices, ring);
      // Assign the narrow separators to their adjoining slices just as for proportional angles.
      for (let i = 0; i < drawn.length; i++) {
        if (angle >= angles[2 * i]! && (i + 1 === drawn.length || angle < angles[2 * i + 1]!)) {
          return { kind: 'slice', sliceKey: drawn[i]!.key };
        }
      }
      return null;
    },
    tooltip(target) {
      const datum = target.kind === 'slice' ? lookup.datum(target) : null;
      return { title: datum?.seriesLabel ?? '', rows: datum ? [datum] : [], count: datum ? 1 : 0, total: null };
    },
    primary(target) { return target.kind === 'slice' && index(target) >= 0 ? target : null; },
    datum(datum) {
      const i = index(datum);
      if (i < 0) return null;
      const { label, value, percent, state, row } = sliceText(view, slices[i]!, formatters, locale);
      return { ref: datum, seriesIndex: i, seriesLabel: label, x: label, value, percent, state, row };
    },
    anchor(datum) {
      if (datum.kind !== 'slice' || !ring || !(ring.r1 > ring.r0)) return null;
      const { drawn, angles } = geometry ??= donutGeometry(slices, ring);
      for (let i = 0; i < drawn.length; i++) {
        if (drawn[i]!.key === datum.sliceKey) return sectorBox(ring.cx, ring.cy, ring.r0, ring.r1, angles[2 * i]!, angles[2 * i + 1]!);
      }
      return null;
    },
    count: slices.length,
    ordinal: index,
    step(from, direction) {
      if (!from) return ref(0);
      const resolved = resolve(from);
      if (!resolved) return null;
      const i = index(resolved);
      const to = stepIndex(direction, i, 0, slices.length);
      return to === null ? null : ref(to);
    },
    resolve,
  };
  return lookup;
}
