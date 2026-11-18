/**
 * The pure part of the interaction layer (core/focus.ts): "all series" navigation, value text, overlay and
 * zoom arithmetic. Expected values follow decision 0001, spec A2, A3, F2, I3 and the fixture data.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { DatumRef } from '../../src/core/contracts';
import {
  buildOverlay, panWindow, positionText, scaleWindow, stepAcross, targetBox, valueText, zoomApplies,
} from '../../src/core/focus';
import { buildLookup } from '../../src/lookup';
import { defaultMessages, resolveMessages } from '../../src/messages';
import { linearScale } from '../../src/scale';
import { aligned, formatter, frame, plot } from '../lookup/fixtures';

// Three series over x = 0…9. B has an outage (null) at 4–5; C has no row at 7, which on a regular number
// axis is an absent step, a gap (spec F2, AX105).
const rows = Array.from({ length: 10 }, (_, x) => [
  { x, s: 'A', y: 10 + x },
  { x, s: 'B', y: x === 4 || x === 5 ? null : 20 + x },
  ...(x === 7 ? [] : [{ x, s: 'C', y: 30 + x }]),
]).flat();
const data = frame('line', { data: rows, x: 'x', y: { field: 'y', unit: 'ms' }, series: 's' });

function model(patch: Parameters<typeof aligned>[1] = {}) {
  const view = aligned(data, { xDomain: [0, 9], xFull: [0, 9], yDomain: [0, 50], ...patch });
  const layout = plot({ kind: 'xy', x: linearScale([0, 9], [0, 90]), y: linearScale([0, 50], [100, 0]) }, 90, 100);
  const formatters = formatter(data);
  return { view, layout, formatters, lookup: buildLookup(view, layout, formatters, defaultMessages) };
}

const ref = (seriesKey: string, x: number): DatumRef => ({ kind: 'aligned', seriesKey, x });

describe('all-series navigation (decision 0001)', () => {
  it('moves over every x with an observation, including an outage, which reads "No data"', () => {
    const { view, lookup, formatters } = model();
    const visited: number[] = [];
    for (let x: number | null = stepAcross(view, null, 'first'); x !== null; x = stepAcross(view, x, 'next')) visited.push(x);
    expect(visited).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const text = valueText(view, lookup, lookup.primary({ kind: 'x', x: 4 })!, 'all', formatters, defaultMessages);
    // pointAll '{x}. {values}. {position}', seriesValue '{series} {value}', position 'Point {index} of {count}'.
    expect(text).toBe('4. A 14 ms; B No data; C 34 ms. Point 5 of 10');
    expect(valueText(view, lookup, ref('A', 7), 'all', formatters, defaultMessages)).toBe('7. A 17 ms; B 27 ms; C No data. Point 8 of 10');
  });

  it('skips an x that only a hidden series observes', () => {
    const only = frame('line', { data: [{ x: 0, s: 'A', y: 1 }, { x: 1, s: 'B', y: 2 }, { x: 2, s: 'A', y: 3 }], x: 'x', y: 'y', series: 's' });
    const view = aligned(only, { visible: [true, false] });
    expect(stepAcross(view, 0, 'next')).toBe(2);
    expect(stepAcross(view, 2, 'previous')).toBe(0);
  });

  it('Home, End and the page keys; nothing to do at an end', () => {
    const { view } = model();
    expect(stepAcross(view, 5, 'first')).toBe(0);
    expect(stepAcross(view, 5, 'last')).toBe(9);
    expect(stepAcross(view, 9, 'last')).toBeNull();
    expect(stepAcross(view, 9, 'next')).toBeNull();
    expect(stepAcross(view, 0, 'previous')).toBeNull();
    // A tenth of 10 positions is 1.
    expect(stepAcross(view, 3, 'page-next')).toBe(4);
    expect(stepAcross(view, 3, 'page-previous')).toBe(2);
  });

  it('for any start and key sequence it stays on visible slots and never repeats a position on a move', () => {
    const { view } = model({ visibleSlots: { start: 2, end: 8 }, xDomain: [2, 7] });
    const keys = ['next', 'previous', 'first', 'last', 'page-next', 'page-previous'] as const;
    fc.assert(fc.property(fc.array(fc.constantFrom(...keys), { maxLength: 30 }), sequence => {
      let x: number | null = stepAcross(view, null, 'first');
      for (const key of sequence) {
        const next = stepAcross(view, x, key);
        if (next === null) continue;
        expect(next).not.toBe(x);
        expect(next).toBeGreaterThanOrEqual(2);
        expect(next).toBeLessThanOrEqual(7);
        x = next;
      }
    }), { numRuns: 1000 });
  });
});

describe('value text (spec A3)', () => {
  it('single-series mode uses the pointOf message; all mode reads pointAll, seriesValue and position, which a translation replaces', () => {
    const { view, lookup, formatters } = model();
    expect(valueText(view, lookup, ref('B', 3), 'single', formatters, defaultMessages)).toBe('B, 3, 23 ms. Point 4 of 10.');
    const de = resolveMessages({ pointAll: '{x}: {values} ({position})', seriesValue: '{series} = {value}', position: 'Punkt {index} von {count}' });
    expect(positionText(de, formatters, 3, 10)).toBe('Punkt 4 von 10');
    expect(valueText(view, lookup, ref('A', 3), 'all', formatters, de)).toBe('3: A = 13 ms; B = 23 ms; C = 33 ms (Punkt 4 von 10)');
  });

  it('a datum outside the view has no text', () => {
    const { view, lookup, formatters } = model({ visibleSlots: { start: 0, end: 5 }, xDomain: [0, 4] });
    expect(valueText(view, lookup, ref('A', 8), 'all', formatters, defaultMessages)).toBeNull();
  });
});

describe('overlay (contracts: Overlay)', () => {
  it('a cursor rule at x and a highlighted marker per series with a value; the focus ring is unclipped', () => {
    const { view, layout, lookup } = model();
    const overlay = buildOverlay({ view, layout, lookup, target: { kind: 'x', x: 4 }, ring: ref('A', 4), only: null })!;
    const rule = overlay.clipped.find(m => m.type === 'rule')!;
    expect(rule).toMatchObject({ x1: 40, x2: 40, y1: 0, y2: 100, role: 'cursor' });
    // A and C have values at 4; B's outage has no marker.
    const points = overlay.clipped.filter(m => m.type === 'points');
    expect(points.map(p => p.type === 'points' ? p.series : -1)).toEqual([0, 0, 2, 2]);
    expect(overlay.unclipped).toHaveLength(4);
    expect(overlay.unclipped.every(m => m.type === 'rule' && m.stroke.kind === 'token' && m.stroke.name === 'focus' && m.strokeWidth >= 2)).toBe(true);
  });

  it('in single-series mode only that series is highlighted; nothing to draw is null', () => {
    const { view, layout, lookup } = model();
    const overlay = buildOverlay({ view, layout, lookup, target: { kind: 'x', x: 4 }, ring: null, only: ref('C', 4) })!;
    expect(overlay.clipped.filter(m => m.type === 'points').every(p => p.type === 'points' && p.series === 2)).toBe(true);
    expect(buildOverlay({ view, layout, lookup, target: null, ring: null, only: null })).toBeNull();
  });

  it('the box a tooltip must not cover spans every highlighted marker at x', () => {
    const { view, lookup } = model();
    expect(targetBox(view, lookup, { kind: 'x', x: 4 }, null)).toEqual({ x: 40, y: 100 - 34 * 2, width: 0, height: 20 * 2 });
  });
});

describe('zoom arithmetic (spec I3)', () => {
  it('halves and doubles around a centre, stays inside the full range, and returns to null at full width', () => {
    expect(scaleWindow([0, 100], [0, 100], 0.5, 50, 1)).toEqual([25, 75]);
    expect(scaleWindow([0, 100], [25, 75], 2, 50, 1)).toBeNull();
    expect(scaleWindow([0, 100], [0, 20], 0.5, 0, 1)).toEqual([0, 10]);
    expect(scaleWindow([0, 100], [80, 100], 2, 100, 1)).toEqual([60, 100]);
    expect(scaleWindow([0, 100], [40, 42], 0.5, 41, 2)).toEqual([40, 42]);
  });

  it('pans by a share of the width, clamped; at the edge it does not move', () => {
    expect(panWindow([0, 100], [20, 40], 0.1)).toEqual([22, 42]);
    expect(panWindow([0, 100], [80, 100], 0.1)).toBeNull();
    expect(panWindow([0, 100], [5, 25], -0.5)).toEqual([0, 20]);
  });

  it('for any window and factor the result lies inside the full range and keeps the minimum width', () => {
    fc.assert(fc.property(
      fc.double({ min: 0, max: 90, noNaN: true }), fc.double({ min: 1, max: 100, noNaN: true }),
      fc.double({ min: 0.1, max: 4, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }),
      (start, width, factor, share) => {
        const current = [start, Math.min(100, start + width)] as const;
        const next = scaleWindow([0, 100], current, factor, current[0] + share * (current[1] - current[0]), 1);
        if (next === null) return;
        expect(next[0]).toBeGreaterThanOrEqual(0);
        expect(next[1]).toBeLessThanOrEqual(100 + 1e-9);
        expect(next[1] - next[0]).toBeGreaterThanOrEqual(1 - 1e-9);
      },
    ), { numRuns: 1000 });
  });

  it('applies to time, date and number x; not to categories, donuts, compact charts or zoom: false (spec 3.6)', () => {
    const { view } = model();
    expect(zoomApplies(view, undefined)).toBe(true);
    expect(zoomApplies(view, false)).toBe(false);
    expect(zoomApplies({ ...view, compact: true }, true)).toBe(false);
    const bars = frame('bar', { data: [{ k: 'a', v: 1 }, { k: 'b', v: 2 }], x: 'k', y: 'v' });
    expect(zoomApplies(aligned(bars, { kind: 'bar' }), true)).toBe(false);
  });
});
