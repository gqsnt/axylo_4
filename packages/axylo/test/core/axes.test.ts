/**
 * Axis titles (spec L6, revised) and reference labels reaching layout, through `layoutInput`.
 */
import { describe, expect, it } from 'vitest';
import type { AlignedView, TextMeasurer } from '../../src/core/contracts';
import { layoutInput, type AxisContext } from '../../src/core/axes';
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
