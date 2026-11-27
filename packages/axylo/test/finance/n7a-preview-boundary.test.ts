/**
 * N7a repair of the blocker of cross-provider review sol-6.2-medium__20261126T200021Z, on the static controller
 * the browser entry uses (`staticControllerFor`, recording host): the controller previews a patch, and tells
 * whether `data` changed, before it installs the patch's `strict` and `onDiagnostic`. For a same-length
 * replacement that comparison read the rows, so a throwing row getter failed under the previous call's settings.
 * The wrapper now hands the controller an opaque holder of the caller's data (compared by identity, never read)
 * and the finance resolver gives the original back, so the getter is first read under the submitted settings.
 *
 * Expected values follow spec 3.5 (a failure of Axylo itself is AX199: under strict a rejection thrown as a
 * StrictError and given to that call's onDiagnostic, else reported while the call returns; AX180 is reported and
 * accepted when not strict) and plan 1.5 (a key set to undefined returns to its default, `strict` false and no
 * reference; a rejected call changes nothing; data is borrowed, never copied).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Scene } from '../../src/core/contracts';
import { staticControllerFor, type Controller } from '../../src/core/controller';
import type { ControllerCore } from '../../src/core/controller-types';
import { StrictError } from '../../src/core/delivery';
import { rowsTable, sameTableData } from '../../src/data/table';
import { openFinanceChart, type FinanceHandle } from '../../src/finance/chart';
import { record, type Recording } from './host';

const THREE = [
  { day: '2026-01-01', o: 100, h: 112, l: 98, c: 110, v: 5000 },
  { day: '2026-01-02', o: 110, h: 111, l: 100, c: 102, v: 4200 },
  { day: '2026-01-03', o: 102, h: 106, l: 99, c: 105, v: 3100 },
];
/** Three rows (the accepted length), readable, the last one with high below open: AX180. */
const BAD_THREE = [THREE[0]!, THREE[1]!, { day: '2026-01-03', o: 102, h: 100, l: 99, c: 101, v: 3100 }];
/** Three valid rows, other values than THREE (a different candle 2). */
const VALID_THREE = [THREE[0]!, { day: '2026-01-02', o: 110, h: 115, l: 104, c: 112, v: 4400 }, THREE[2]!];
/** A fourth row, valid OHLC, negative volume: AX181. */
const BAD_VOLUME = [...THREE, { day: '2026-01-04', o: 104, h: 108, l: 101, c: 106, v: -5 }];
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
/** The accepted length, the first row throwing: a structural comparison with THREE reaches it first. */
const sameLength = (): Record<string, unknown>[] => [throwingRow(), THREE[1]!, THREE[2]!];

function open(options: Record<string, unknown>): { rec: Recording; chart: FinanceHandle; core: () => ControllerCore; controller: () => Controller } {
  const rec = record();
  let controller: Controller | null = null;
  const chart = openFinanceChart(options, (composition, translated) => {
    controller = staticControllerFor(composition, translated, rec.host);
    return controller.handle;
  });
  rec.frames();
  return { rec, chart, controller: () => controller!, core: () => controller as unknown as ControllerCore };
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
const recorder = (): { codes: string[]; handler: (d: { code: string }) => void } => {
  const list: string[] = [];
  return { codes: list, handler: d => { list.push(d.code); } };
};
// The chart controller is also its own ControllerCore (the interaction layer raises events through emit).
const emitHover = (c: Controller): void => { (c as unknown as ControllerCore).emit('hover', null); };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a same-length throwing replacement fails under the settings submitted with it', () => {
  const failingResets = (chart: FinanceHandle): unknown =>
    thrown(() => chart.update({ strict: undefined, reference: undefined, data: sameLength() }));

  it('from strict, with strict and reference reset: returns normally with AX199; a readable same-length retry accepts AX180', () => {
    const { rec, chart } = open({ title: 'Preview strict', strict: true, data: THREE, ...FIELDS, reference: REFERENCE });
    expect(rec.committed!.lookup.count).toBe(3);
    expect(failingResets(chart)).toBeNull();
    rec.frames();
    expect(codes(chart)).toContain('AX199');
    const retry = thrown(() => chart.update({ strict: undefined, reference: undefined, data: BAD_THREE }));
    expect(codesOf(retry)).toEqual([]);
    expect(retry).toBeNull();
    rec.frames();
    expect(codes(chart)).toContain('AX180');
    expect(codes(chart)).not.toContain('AX199');
    expect(rec.committed!.lookup.count).toBe(3);
    chart.destroy();
  });

  it('from strict, with strict and reference reset: a readable valid retry removes the visible reference', () => {
    const { rec, chart } = open({ title: 'Preview reference', strict: true, data: THREE, ...FIELDS, reference: REFERENCE });
    expect(viewReferences(rec)).toBe(1);
    expect(referenceMarks(lastScene(rec))).toBe(1);
    expect(failingResets(chart)).toBeNull();
    rec.frames();
    expect(codes(chart)).toContain('AX199');
    expect(thrown(() => chart.update({ strict: undefined, reference: undefined, data: VALID_THREE }))).toBeNull();
    rec.frames();
    expect(codes(chart)).not.toContain('AX199');
    expect(rec.committed!.lookup.count).toBe(3);
    expect(viewReferences(rec)).toBe(0);
    expect(referenceMarks(lastScene(rec))).toBe(0);
    chart.destroy();
  });

  it('from non-strict, with strict true and a new handler: StrictError with AX199, given to the new handler only', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const first = recorder();
    const submitted = recorder();
    const { rec, chart } = open({ title: 'Preview non-strict', onDiagnostic: first.handler, data: THREE, ...FIELDS });
    const error = thrown(() => chart.update({ strict: true, onDiagnostic: submitted.handler, data: sameLength() }));
    expect(error).toBeInstanceOf(StrictError);
    expect(codesOf(error)).toContain('AX199');
    // Given to the call's own handler before the call threw.
    expect(submitted.codes).toContain('AX199');
    expect(first.codes).not.toContain('AX199');
    rec.frames();
    expect(rec.committed!.lookup.count).toBe(3);
    // Rolled back: still non-strict, and the accepted handler is still the first one.
    expect(thrown(() => chart.update({ data: BAD_VOLUME }))).toBeNull();
    rec.frames();
    expect(first.codes).toContain('AX181');
    expect(submitted.codes).not.toContain('AX181');
    expect(codes(chart)).not.toContain('AX199');
    chart.destroy();
  });

  it('while the controller drains notifications: a strict rejection with a changed handler reaches only that handler', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const first = recorder();
    const submitted = recorder();
    const { rec, chart, controller } = open({ title: 'Preview drain', strict: true, onDiagnostic: first.handler, data: THREE, ...FIELDS });
    let rejection: unknown = null;
    let listenerRan = false;
    chart.on('hover', () => {
      listenerRan = true;
      rejection = thrown(() => chart.update({ onDiagnostic: submitted.handler, data: sameLength() }));
    });
    emitHover(controller());
    rec.frames();
    expect(listenerRan).toBe(true);
    expect(rejection).toBeInstanceOf(StrictError);
    expect(codesOf(rejection)).toContain('AX199');
    expect(submitted.codes).toContain('AX199');
    expect(first.codes).toEqual([]);
    expect(rec.committed!.lookup.count).toBe(3);
    // Rollback kept the accepted handler (and strict): the next finding goes to the first handler.
    expect(thrown(() => chart.update({ strict: false, data: BAD_VOLUME }))).toBeNull();
    rec.frames();
    expect(first.codes).toContain('AX181');
    expect(submitted.codes).not.toContain('AX181');
    chart.destroy();
  });
});

describe('the data holder: borrowed, reused while the accepted data is unchanged, compared with the accepted data', () => {
  it('resolution reads the caller\'s own rows; unrelated updates and the same rows again keep the frame', () => {
    const rows = THREE.slice();
    const { rec, chart, core } = open({ title: 'Reuse', data: rows, ...FIELDS });
    const frame = core().accepted!.frame;
    expect(core().accepted!.source.table.rowAt(0)).toBe(rows[0]);
    chart.update({ title: 'Renamed' });
    rec.frames();
    expect(core().accepted!.frame).toBe(frame);
    chart.update({ data: rows });
    rec.frames();
    expect(core().accepted!.frame).toBe(frame);
    // A label over the same columns: the frame is renamed, never normalized again, and reads the same rows.
    chart.update({ open: { field: 'o', label: 'Opening' } });
    rec.frames();
    expect(core().accepted!.source.table.rowAt(0)).toBe(rows[0]);
    expect(rec.committed!.lookup.count).toBe(3);
    const renamedFrame = core().accepted!.frame;
    chart.update({ title: 'Renamed again' });
    rec.frames();
    expect(core().accepted!.frame).toBe(renamedFrame);
    // A new array is new data, even with the same rows: the chart borrows the array it was last given.
    const copy = rows.slice();
    chart.update({ data: copy });
    rec.frames();
    expect(core().accepted!.frame).not.toBe(renamedFrame);
    expect(sameTableData(core().accepted!.source.table, rowsTable(copy))).toBe(true);
    expect(core().accepted!.source.table.rowAt(2)).toBe(rows[2]);
    expect(rec.committed!.lookup.count).toBe(3);
    chart.destroy();
  });

  it('caller-owned typed columns are borrowed through the holder', () => {
    const day = ['2026-01-01', '2026-01-02', '2026-01-03'];
    const o = new Float64Array([100, 110, 102]);
    const h = new Float64Array([112, 111, 106]);
    const l = new Float64Array([98, 100, 99]);
    const c = new Float64Array([110, 102, 105]);
    const v = new Float64Array([5000, 4200, 3100]);
    const columns = { day, o, h, l, c, v };
    const { rec, chart, core } = open({ title: 'Columns', data: { columns }, ...FIELDS });
    const table = core().accepted!.source.table;
    expect(table.columns).toBe(columns);
    expect(table.columns!.o).toBe(o);
    expect(rec.committed!.lookup.count).toBe(3);
    expect(codes(chart)).toEqual([]);
    chart.destroy();
  });

  it('an omitted data keeps the accepted rows, an explicit undefined clears them', () => {
    const { rec, chart, core } = open({ title: 'Omit', data: THREE, ...FIELDS });
    chart.update({ title: 'Kept' });
    rec.frames();
    expect(core().accepted!.source.table.rowAt(0)).toBe(THREE[0]);
    expect(rec.committed!.lookup.count).toBe(3);
    chart.update({ data: undefined });
    rec.frames();
    expect(rec.committed?.lookup.count ?? 0).toBe(0);
    chart.destroy();
  });

  it('a failed proposal is not the comparison base: its rows, readable on retry, are new data against the accepted rows', () => {
    let failing = true;
    const rows: Record<string, unknown>[] = [
      { get day(): string { if (failing) throw new Error('x getter failed'); return '2026-01-01'; }, o: 100, h: 112, l: 98, c: 110, v: 5000 },
      VALID_THREE[1]!, VALID_THREE[2]!,
    ];
    const { rec, chart, core } = open({ title: 'Proposal', data: THREE, ...FIELDS });
    const frame = core().accepted!.frame;
    expect(thrown(() => chart.update({ data: rows }))).toBeNull();
    rec.frames();
    expect(codes(chart)).toContain('AX199');
    // An update without data after the failure keeps the accepted rows.
    chart.update({ title: 'Still accepted' });
    rec.frames();
    expect(core().accepted!.source.table.rowAt(0)).toBe(THREE[0]);
    failing = false;
    expect(thrown(() => chart.update({ data: rows }))).toBeNull();
    rec.frames();
    expect(codes(chart)).not.toContain('AX199');
    expect(core().accepted!.frame).not.toBe(frame);
    expect(core().accepted!.source.table.rowAt(1)).toBe(VALID_THREE[1]);
    expect(rec.committed!.lookup.count).toBe(3);
    chart.destroy();
  });
});
