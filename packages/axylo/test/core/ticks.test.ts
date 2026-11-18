/**
 * Spec F7: an automatic value domain ends at the first drawn tick at or beyond each extreme, the drawn ticks
 * and the domain coming from one step (core/axes.ts, endingCandidates). For any data extremes and plot height.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { record } from './host';

describe('the value domain ends at drawn ticks (F7)', () => {
  for (const kind of ['line', 'bar', 'scatter'] as const) {
    it(`${kind}: for any extremes and plot height, the domain's ends are the first drawn ticks at or beyond them`, () => {
      fc.assert(fc.property(
        fc.integer({ min: -500, max: 500 }), fc.integer({ min: 1, max: 900 }), fc.integer({ min: 100, max: 700 }),
        (low, span, height) => {
          const values = [low, low + span];
          const r = record(kind, { title: 'T', data: values.map((y, i) => ({ x: i + 1, y })), x: 'x', y: 'y' }, { container: { width: 600, height } });
          r.frames();
          const layout = r.committed?.layout;
          if (!layout || layout.kind !== 'plot' || layout.projection.kind === 'ring') return;
          const scale = layout.projection.kind === 'xy' ? layout.projection.y : layout.projection.value;
          const [a, b] = scale.domain;
          const ticks = layout.yTicks.map(t => t.value);
          // A plot too short for any tick label draws none (spec L1); there is no drawn tick to end at. Every
          // height the layout accepts is drawn, the shortest plots included (controller review, F7 below 200 px).
          if (ticks.length < 2) return;
          const lo = kind === 'bar' ? Math.min(0, low) : low;
          const hi = kind === 'bar' ? Math.max(0, low + span) : low + span;
          expect(ticks.find(t => t >= hi)).toBe(b);
          expect([...ticks].reverse().find(t => t <= lo)).toBe(a);
        },
      ), { numRuns: 300 });
    });
  }
});
