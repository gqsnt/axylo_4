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
  const keys = new Map(slices.map((slice, i) => [slice.key, i]));
  const ring = layout?.projection.kind === 'ring' ? layout.projection : null;
  const geometry = ring && donutGeometry(slices, ring);
  const index = (datum: DatumRef) => datum.kind === 'slice' ? keys.get(datum.sliceKey) ?? -1 : -1;

  function ref(i: number): DatumRef | null {
    const slice = slices[i];
    return slice ? { kind: 'slice', sliceKey: slice.key } : null;
  }

  function resolve(datum: DatumRef): DatumRef | null {
    if (datum.kind !== 'slice') return null;
    if (keys.has(datum.sliceKey)) return datum;
    const folded = slices.find(slice => slice.members.length > 1 && slice.members.some(i => {
      const label = view.frame.labels[i];
      // The view prefixes author labels that would collide with the reserved Other key.
      return label !== undefined && datum.sliceKey === (label.startsWith('__other__') ? '__other__' + label : label);
    }));
    return folded ? { kind: 'slice', sliceKey: folded.key } : null;
  }

  const lookup: Lookup = {
    members(target, from, count) {
      return target.kind === 'slice' && keys.has(target.sliceKey) && from <= 0 && count > 0 ? [target] : [];
    },
    has(target, datum) {
      return target.kind === 'slice' && datum.kind === 'slice' && datum.sliceKey === target.sliceKey && keys.has(target.sliceKey);
    },
    /** The slice's index in the view's slices (an "Other" slice stands for several frame categories). */
    slot: index,
    pick(pointerX, pointerY) {
      const at = layout ? pointerOnPlot(layout.plot, pointerX, pointerY) : null;
      if (!geometry || !ring || !at || !(ring.r1 > ring.r0)) return null;
      const { x: px, y: py } = at;
      const dx = px - ring.cx;
      const dy = py - ring.cy;
      const radius = Math.hypot(dx, dy);
      if (radius < ring.r0 || radius > ring.r1) return null;
      const raw = Math.atan2(dx, -dy);
      const angle = raw < 0 ? raw + TURN : raw;
      // Assign the narrow separators to their adjoining slices just as for proportional angles.
      const slice = geometry.drawn.find((_, i) => angle >= geometry.angles[2 * i]! &&
        (i + 1 === geometry.drawn.length || angle < geometry.angles[2 * i + 1]!));
      return slice ? { kind: 'slice', sliceKey: slice.key } : null;
    },
    tooltip(target) {
      const datum = target.kind === 'slice' ? lookup.datum(target) : null;
      return { title: datum?.seriesLabel ?? '', rows: datum ? [datum] : [], count: datum ? 1 : 0, total: null };
    },
    primary(target) { return target.kind === 'slice' && keys.has(target.sliceKey) ? target : null; },
    datum(datum) {
      const i = index(datum);
      if (i < 0) return null;
      const { label, value, percent, state, row } = sliceText(view, slices[i]!, formatters, locale);
      return { ref: datum, seriesIndex: i, seriesLabel: label, x: label, value, percent, state, row };
    },
    anchor(datum) {
      if (datum.kind !== 'slice' || !geometry || !ring || !(ring.r1 > ring.r0)) return null;
      const i = geometry.drawn.findIndex(slice => slice.key === datum.sliceKey);
      return i < 0 ? null : sectorBox(ring.cx, ring.cy, ring.r0, ring.r1, geometry.angles[2 * i]!, geometry.angles[2 * i + 1]!);
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
