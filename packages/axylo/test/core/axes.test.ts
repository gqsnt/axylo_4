/**
 * Axis titles (spec L6, revised) and reference labels reaching layout, through `layoutInput`.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { AlignedView, TextMeasurer } from '../../src/core/contracts';
import { endingCandidates, layoutInput, type AxisContext } from '../../src/core/axes';
import { linearTickCandidates, valueDomain } from '../../src/scale';
import { resolveOptions, type AlignedChartType } from '../../src/data';
import { DiagnosticCollector } from '../../src/diagnostics';
import { aligned, frame } from '../lookup/fixtures';

const measurer: TextMeasurer = { width: text => text.length * 7 };
const style = { font: '12px sans-serif', letterSpacing: 0, wordSpacing: 0, lineHeight: 15 };

function titles(type: AlignedChartType, options: Record<string, unknown>, patch: Partial<AlignedView> = {}) {
  const resolved = resolveOptions(type, options, new DiagnosticCollector());
  const view = aligned(frame(type, options), { kind: type, ...patch });
  const ctx: AxisContext = {
    resolved, locale: 'en-US', compact: false, onFormatterError: () => {},
    xLabelGiven: typeof (options.x as { label?: unknown }).label === 'string', valueTitle: 'Value',
  };
  const input = layoutInput(view, { width: 600, height: 300 }, { measurer, style }, ctx);
  if (input.kind === 'ring' || input.kind === 'message') throw new Error('not cartesian');
  return { x: input.x.title, y: input.y.title, references: input.references };
}

describe('axis titles (spec L6)', () => {
  const days = [{ d: '2026-01-01', v: 1 }, { d: '2026-01-02', v: 2 }];

  it('a date or time x is untitled unless the author gave a label; the value axis takes its label and unit', () => {
    expect(titles('line', { data: days, x: 'd', y: { field: 'v', label: 'Sessions', unit: 'visits' } })).toMatchObject({ x: undefined, y: 'Sessions (visits)' });
    expect(titles('line', { data: days, x: { field: 'd', label: 'Day' }, y: 'v' })).toMatchObject({ x: 'Day', y: 'v' });
  });

  it('a category x is untitled unless labelled; a number x is a measure and is titled with its unit', () => {
    const teams = [{ t: 'A', v: 1 }, { t: 'B', v: 2 }];
    expect(titles('bar', { data: teams, x: 't', y: 'v' }, { kind: 'bar' })).toMatchObject({ x: undefined, y: 'v' });
    expect(titles('line', { data: [{ n: 1, v: 1 }, { n: 2, v: 2 }], x: { field: 'n', unit: 'm' }, y: 'v' })).toMatchObject({ x: 'n (m)' });
  });

  it('several value fields with no shared label are titled with the generic noun; a shared unit is kept', () => {
    const wide = [{ d: 1, a: 1, b: 2 }, { d: 2, a: 3, b: 4 }];
    expect(titles('line', { data: wide, x: 'd', y: [{ field: 'a', unit: 'ms' }, { field: 'b', unit: 'ms' }] }).y).toBe('Value (ms)');
    expect(titles('line', { data: wide, x: 'd', y: [{ field: 'a', unit: 'ms' }, { field: 'b', unit: 's' }] }).y).toBe('Value');
  });

  it("the view's resolved references are passed to layout so their labels are placed", () => {
    const references = [{ axis: 'y', from: 1.5, to: 1.5, label: 'Target' }] as const;
    expect(titles('line', { data: days, x: 'd', y: 'v' }, { references }).references).toBe(references);
  });
});

describe('F7: a tick set is offered only when the domain ends at its first tick at or beyond each extreme', () => {
  it('[-0.8, 0.2] with a maximum of 0.1: the 0.1-step set (which has a tick at 0.1) is not offered', () => {
    const sets = linearTickCandidates([-0.8, 0.2], v => String(v));
    const offered = endingCandidates(sets, [-0.8, 0.2], [-0.8, 0.1], null);
    for (const set of offered) {
      const values = set.map(t => t.value);
      expect(values.find(v => v >= 0.1)).toBe(0.2);
    }
    expect(offered.length).toBeGreaterThan(0);
  });

  it('for any decimal extremes, every offered set has its first tick at or beyond each extreme on the domain end', () => {
    fc.assert(fc.property(fc.integer({ min: -2000, max: 2000 }), fc.integer({ min: 1, max: 4000 }), fc.integer({ min: 0, max: 3 }),
      (low, span, places) => {
        const lo = low / 10 ** places;
        const hi = (low + span) / 10 ** places;
        const { domain } = valueDomain({ min: lo, max: hi, includeZero: false });
        const offered = endingCandidates(linearTickCandidates(domain, v => String(v)), domain, [lo, hi], null);
        for (const set of offered) {
          const values = set.map(t => t.value);
          expect(values.find(v => v >= hi)).toBe(domain[1]);
          expect([...values].reverse().find(v => v <= lo)).toBe(domain[0]);
        }
      }));
  });
});
