/**
 * N7a repair of the two AX199 blockers of cross-provider review sol-6.2-medium (finance/chart.ts), on the real
 * controller (recording host):
 *  1. a call the controller fails (AX199) and returns from normally is not accepted by the wrapper either, so the
 *     resets it carried are sent again when it is retried;
 *  2. the wrapper never reads the rows of a replacement `data`: a throwing row getter reaches the controller's
 *     error boundary (AX199) instead of escaping the wrapper as a plain error.
 *
 * Expected values follow spec 3.5 (a failure of Axylo itself is AX199; under strict it is a rejection, else it is
 * reported and the call returns; AX180 is reported and accepted when not strict) and the commit contract of plan
 * 1.5 (a key set to undefined returns to its default; a call that is not accepted changes nothing). The default of
 * `strict` is false and of `reference` is none.
 */
import { describe, expect, it } from 'vitest';
import type { Scene } from '../../src/core/contracts';
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
/** Four valid candles. */
const VALID_FOUR = [...THREE, { day: '2026-01-04', o: 105, h: 108, l: 101, c: 107, v: 2000 }];
const FIELDS = { x: 'day', open: 'o', high: 'h', low: 'l', close: 'c', volume: 'v' };
/** Inside the fixture's price range (98–112), so the line is drawn. */
const REFERENCE = [{ y: 105, label: 'Pivot' }];

/** A row whose x getter (enumerable, as an object literal makes it) throws when read. */
function throwingRow(): Record<string, unknown> {
  return {
    get day(): string { throw new Error('x getter failed'); },
    o: 100, h: 112, l: 98, c: 110, v: 5000,
  };
}
/**
 * Five rows and more: a length neither the accepted data nor any retry has (`more` gives each failing call of one
 * test its own), so no element-wise comparison (blocker 2) is reached on the way and the getter is first read by
 * the controller while it normalizes. Each retry then tests blocker 1 alone.
 */
const changedLength = (more = 0): Record<string, unknown>[] =>
  [...VALID_FOUR, ...Array.from({ length: more + 1 }, throwingRow)];
/** Three rows (the accepted length), the first one throwing: an element-wise comparison with THREE reaches it first. */
const sameLength = (): Record<string, unknown>[] => [throwingRow(), THREE[1]!, THREE[2]!];

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
const viewReferences = (rec: Recording): number => {
  const view = rec.committed!.view as { references?: readonly unknown[] };
  return view.references?.length ?? 0;
};
const codes = (chart: FinanceHandle): string[] => chart.diagnostics.map(d => d.code);
const thrown = (run: () => void): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  return null;
};
const codesOf = (error: unknown): string[] => (error instanceof StrictError ? error.diagnostics.map(d => d.code) : []);

/** The failing call of blocker 1: both resets, with replacement rows whose x getter throws. */
const failingResets = (chart: FinanceHandle, more = 0): unknown =>
  thrown(() => chart.update({ strict: undefined, reference: undefined, data: changedLength(more) }));

describe('blocker 1: resets survive a call the controller failed with AX199', () => {
  it('the failed call is reported (AX199) and returns; retrying both resets with one invalid candle is accepted with AX180', () => {
    const { rec, chart } = open({ title: 'Retry strict', strict: true, data: THREE, ...FIELDS, reference: REFERENCE });
    expect(rec.committed!.lookup.count).toBe(3);
    // The call itself is not strict (its own strict is reset), so the failure is reported, not thrown.
    expect(failingResets(chart)).toBeNull();
    rec.frames();
    expect(codes(chart)).toContain('AX199');
    const retry = thrown(() => chart.update({ strict: undefined, reference: undefined, data: BAD_OHLC }));
    expect(codesOf(retry)).toEqual([]);
    expect(retry).toBeNull();
    rec.frames();
    expect(codes(chart)).toContain('AX180');
    expect(codes(chart)).not.toContain('AX199');
    expect(rec.committed!.lookup.count).toBe(4);
    chart.destroy();
  });

  it('retrying both resets with fully valid rows clears the old reference, and strict stays reset', () => {
    const { rec, chart } = open({ title: 'Retry reference', strict: true, data: THREE, ...FIELDS, reference: REFERENCE });
    expect(viewReferences(rec)).toBe(1);
    expect(referenceMarks(lastScene(rec))).toBe(1);
    expect(failingResets(chart)).toBeNull();
    rec.frames();
    expect(codes(chart)).toContain('AX199');
    expect(thrown(() => chart.update({ strict: undefined, reference: undefined, data: VALID_FOUR }))).toBeNull();
    rec.frames();
    expect(codes(chart)).not.toContain('AX199');
    expect(rec.committed!.lookup.count).toBe(4);
    expect(viewReferences(rec)).toBe(0);
    expect(referenceMarks(lastScene(rec))).toBe(0);
    // An update that does not mention strict now runs under the default (non-strict): AX180 is accepted.
    expect(thrown(() => chart.update({ data: BAD_OHLC }))).toBeNull();
    chart.destroy();
  });

  it('repeated failed calls change nothing; the next readable retry carries both resets', () => {
    const { rec, chart } = open({ title: 'Repeated', strict: true, data: THREE, ...FIELDS, reference: REFERENCE });
    expect(failingResets(chart)).toBeNull();
    expect(failingResets(chart, 1)).toBeNull();
    // A failed call that leaves the resets out: still nothing accepted, strict and the reference still in force.
    expect(codesOf(thrown(() => chart.update({ data: changedLength(2) })))).toContain('AX199');
    rec.frames();
    expect(thrown(() => chart.update({ strict: undefined, reference: undefined, data: BAD_OHLC }))).toBeNull();
    rec.frames();
    expect(codes(chart)).toContain('AX180');
    expect(viewReferences(rec)).toBe(0);
    chart.destroy();
  });

  it('a create that failed before normalization is followed by an update that carries the resets', () => {
    // `data.columns` is read while the options are resolved, before any normalization.
    // Not a plain object, so no structural comparison of two of them reads it either.
    class Unreadable { get columns(): unknown { throw new Error('columns failed'); } }
    const { rec, chart } = open({ title: 'Failed create', data: new Unreadable(), ...FIELDS, reference: REFERENCE });
    expect(codes(chart)).toContain('AX199');
    // A second call that fails the same way, with the reset, is not accepted either.
    expect(thrown(() => chart.update({ reference: undefined, data: new Unreadable() }))).toBeNull();
    expect(codes(chart)).toContain('AX199');
    expect(thrown(() => chart.update({ reference: undefined, data: THREE }))).toBeNull();
    rec.frames();
    expect(codes(chart)).not.toContain('AX199');
    expect(rec.committed!.lookup.count).toBe(3);
    expect(viewReferences(rec)).toBe(0);
    chart.destroy();
  });

  it('a view-only zoom between a failed call and its retry does not count as accepting the failed call', () => {
    const { rec, chart } = open({ title: 'Zoomed', strict: true, data: THREE, ...FIELDS, reference: REFERENCE, zoom: true });
    expect(failingResets(chart)).toBeNull();
    chart.zoom(null);
    rec.frames();
    expect(thrown(() => chart.update({ strict: undefined, reference: undefined, data: BAD_OHLC }))).toBeNull();
    rec.frames();
    expect(codes(chart)).toContain('AX180');
    expect(viewReferences(rec)).toBe(0);
    chart.destroy();
  });

  it('a destroyed chart ignores updates', () => {
    const { chart } = open({ title: 'Gone', strict: true, data: THREE, ...FIELDS });
    chart.destroy();
    expect(thrown(() => chart.update({ strict: undefined, data: changedLength() }))).toBeNull();
    expect(thrown(() => chart.update({ data: BAD_OHLC }))).toBeNull();
  });
});

describe('blocker 2: a same-length replacement with a throwing row getter reaches the controller', () => {
  it('strict: the update throws a StrictError with AX199, and the accepted chart is kept', () => {
    const { rec, chart } = open({ title: 'Same length strict', strict: true, data: THREE, ...FIELDS });
    const error = thrown(() => chart.update({ data: sameLength() }));
    expect(error).toBeInstanceOf(StrictError);
    expect(codesOf(error)).toContain('AX199');
    rec.frames();
    expect(rec.committed!.lookup.count).toBe(3);
    // Still strict, still on its accepted data: a readable invalid candle is rejected with AX180.
    expect(codesOf(thrown(() => chart.update({ data: BAD_OHLC })))).toContain('AX180');
    chart.destroy();
  });

  it('non-strict: AX199 is reported and the update returns normally; a readable retry recovers', () => {
    const { rec, chart } = open({ title: 'Same length', data: THREE, ...FIELDS });
    expect(thrown(() => chart.update({ data: sameLength() }))).toBeNull();
    rec.frames();
    expect(codes(chart)).toContain('AX199');
    expect(thrown(() => chart.update({ data: VALID_FOUR }))).toBeNull();
    rec.frames();
    expect(codes(chart)).not.toContain('AX199');
    expect(rec.committed!.lookup.count).toBe(4);
    chart.destroy();
  });

  it('the replacement is borrowed and its getter read once; an omitted data keeps it, an explicit undefined clears it', () => {
    const { rec, chart } = open({ title: 'Borrowed', data: THREE, ...FIELDS });
    const rows = [...VALID_FOUR];
    let reads = 0;
    chart.update({ get data() { reads++; return rows; } });
    expect(reads).toBe(1);
    rec.frames();
    expect(rec.committed!.lookup.count).toBe(4);
    chart.update({ title: 'Renamed' });
    rec.frames();
    expect(rec.committed!.lookup.count).toBe(4);
    chart.update({ data: undefined });
    rec.frames();
    expect(rec.committed?.lookup.count ?? 0).toBe(0);
    chart.destroy();
  });
});
