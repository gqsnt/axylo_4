/**
 * N7a repair of review sol-6.2-medium__20261126T192538Z: a key reset to `undefined` through `candlestick.update()`
 * returns to its default on the real controller (public contract: "a key set to undefined returns to its
 * default"), and a rejected call cannot erase what was accepted before it.
 *
 * Expected values follow the contract and the fixtures: the default of `strict` is false (spec 3.5: AX180 is then
 * reported and the call accepted), the default of `reference` and `xAxis.label` is none, never a previous run.
 */
import { describe, expect, it } from 'vitest';
import type { Layout, Scene } from '../../src/core/contracts';
import { controllerFor } from '../../src/core/controller';
import { StrictError } from '../../src/core/delivery';
import { openFinanceChart, type FinanceHandle } from '../../src/finance/chart';
import { record, type Recording } from './host';

const THREE = [
  { day: '2026-01-01', o: 100, h: 112, l: 98, c: 110, v: 5000 },
  { day: '2026-01-02', o: 110, h: 111, l: 100, c: 102, v: 4200 },
  { day: '2026-01-03', o: 102, h: 106, l: 99, c: 105, v: 3100 },
];
/** A fourth row whose high is below its open: AX180. */
const BAD_OHLC = [...THREE, { day: '2026-01-04', o: 105, h: 100, l: 95, c: 104, v: 2000 }];
const FIELDS = { x: 'day', open: 'o', high: 'h', low: 'l', close: 'c', volume: 'v' };
/** Inside the fixture's price range (98–112), so the line is drawn. */
const REFERENCE = [{ y: 105, label: 'Pivot' }];

function open(options: Record<string, unknown>): { rec: Recording; chart: FinanceHandle } {
  const rec = record();
  const chart = openFinanceChart(options, (composition, translated) => controllerFor(composition, translated, rec.host).handle);
  rec.frames();
  return { rec, chart };
}

const lastScene = (rec: Recording): Scene => rec.draws[rec.draws.length - 1]!;
/** Reference lines in the drawn scene: the only dashed paths a finance scene draws (n7a-hardening). */
const referenceMarks = (scene: Scene): number =>
  scene.marks.filter(m => m.type === 'path' && m.dash.normal !== null).length;
const referenceLabels = (layout: Layout): string[] =>
  layout.kind === 'plot' ? layout.texts.filter(t => t.role === 'reference').map(t => t.full) : [];
const viewReferences = (rec: Recording): number => {
  const view = rec.committed!.view as { references?: readonly unknown[] };
  return view.references?.length ?? 0;
};
const yTitles = (layout: Layout): string[] =>
  layout.kind === 'plot' ? layout.texts.filter(t => t.role === 'title-y').map(t => t.full) : [];
const has180 = (chart: FinanceHandle): boolean => chart.diagnostics.some(d => d.code === 'AX180');

describe('review 4: explicit undefined resets reach the controller', () => {
  it('strict: undefined returns to the non-strict default: invalid OHLC is reported (AX180) and accepted', () => {
    const { rec, chart } = open({ title: 'Reset strict', strict: true, data: THREE, ...FIELDS });
    expect(rec.committed!.lookup.count).toBe(3);
    // Still strict before the reset: the same data is rejected.
    expect(() => chart.update({ data: BAD_OHLC })).toThrow(StrictError);
    rec.frames();
    expect(rec.committed!.lookup.count).toBe(3);
    expect(() => chart.update({ strict: undefined, data: BAD_OHLC })).not.toThrow();
    rec.frames();
    expect(has180(chart)).toBe(true);
    expect(rec.committed!.lookup.count).toBe(4);
    // The default stays in force for later updates too.
    expect(() => chart.update({ data: [...BAD_OHLC] })).not.toThrow();
    chart.destroy();
  });

  it('reference: undefined removes the reference from the view and from the drawn scene', () => {
    const { rec, chart } = open({ title: 'Reset reference', data: THREE, ...FIELDS, reference: REFERENCE });
    expect(viewReferences(rec)).toBe(1);
    expect(referenceMarks(lastScene(rec))).toBe(1);
    expect(referenceLabels(rec.committed!.layout)).toEqual(['Pivot']);
    chart.update({ reference: undefined });
    rec.frames();
    expect(viewReferences(rec)).toBe(0);
    expect(referenceMarks(lastScene(rec))).toBe(0);
    expect(referenceLabels(rec.committed!.layout)).toEqual([]);
    chart.destroy();
  });

  it('volumeAxis: undefined removes the x axis title; an unrelated update afterwards does not bring it back', () => {
    const { rec, chart } = open({ title: 'Reset x axis', data: THREE, ...FIELDS, volumeAxis: { label: 'Session' } });
    expect(yTitles(rec.committed!.layout)).toContain('Session');
    chart.update({ volumeAxis: undefined });
    rec.frames();
    expect(yTitles(rec.committed!.layout)).not.toContain('Session');
    chart.update({ title: 'Renamed' });
    rec.frames();
    expect(yTitles(rec.committed!.layout)).not.toContain('Session');
    chart.destroy();
  });

  it('a rejected call with resets cannot erase settings accepted before it; a later accepted reset still works', () => {
    const { rec, chart } = open({
      title: 'Rejected resets', strict: true, data: THREE, ...FIELDS, reference: REFERENCE, volumeAxis: { label: 'Session' },
    });
    expect(() => chart.update({ reference: undefined, volumeAxis: undefined, data: BAD_OHLC })).toThrow(StrictError);
    rec.frames();
    expect(viewReferences(rec)).toBe(1);
    expect(yTitles(rec.committed!.layout)).toContain('Session');
    // An unrelated accepted update after the rejection keeps both (the rejected resets were not remembered).
    chart.update({ title: 'Still here' });
    rec.frames();
    expect(viewReferences(rec)).toBe(1);
    expect(referenceMarks(lastScene(rec))).toBe(1);
    expect(yTitles(rec.committed!.layout)).toContain('Session');
    // And strict is still in force.
    expect(() => chart.update({ data: BAD_OHLC })).toThrow(StrictError);
    chart.update({ reference: undefined });
    rec.frames();
    expect(viewReferences(rec)).toBe(0);
    expect(referenceMarks(lastScene(rec))).toBe(0);
    chart.destroy();
  });

  it('a reset right after the same reset was rejected still reaches the controller', () => {
    const { rec, chart } = open({ title: 'Reset after rejection', strict: true, data: THREE, ...FIELDS, reference: REFERENCE });
    expect(() => chart.update({ reference: undefined, data: BAD_OHLC })).toThrow(StrictError);
    rec.frames();
    expect(viewReferences(rec)).toBe(1);
    chart.update({ reference: undefined });
    rec.frames();
    expect(viewReferences(rec)).toBe(0);
    expect(referenceMarks(lastScene(rec))).toBe(0);
    chart.destroy();
  });

  it('legend: undefined returns to the finance default (off), not the core default', () => {
    const onDiagnostic = (): void => {};
    const { rec, chart } = open({ title: 'Legend', data: THREE, ...FIELDS, legend: true, onDiagnostic });
    const sent: Record<string, unknown>[] = [];
    // Watch what the wrapper sends: the reset legend is the finance default, and the relay stays the same function.
    const rec2 = record();
    let first: unknown = null;
    const watched = openFinanceChart({ title: 'Legend', data: THREE, ...FIELDS, legend: true, onDiagnostic }, (composition, translated) => {
      first = translated.onDiagnostic;
      const handle = controllerFor(composition, translated, rec2.host).handle;
      return {
        update(patch) { sent.push({ ...(patch as Record<string, unknown>) }); handle.update(patch); },
        zoom: range => handle.zoom(range),
        on: (event, listener) => handle.on(event as never, listener as never),
        get diagnostics() { return handle.diagnostics; },
        destroy: () => handle.destroy(),
      };
    });
    watched.update({ legend: undefined });
    expect(sent[0]!.legend).toBe(false);
    expect(sent[0]!.onDiagnostic).toBe(first);
    expect(sent[0]!.data).toBe(THREE);
    watched.destroy();
    expect(() => chart.update({ legend: undefined })).not.toThrow();
    rec.frames();
    expect(rec.committed!.lookup.count).toBe(3);
    chart.destroy();
  });
});
