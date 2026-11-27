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

/**
 * Final N7a blocker (review sol-6.2-medium): a non-strict failure leaves AX199 among the chart's diagnostics and
 * marks it delivered, with no handler to give it to. A later strict call that fails the same way is a rejection
 * of that call (spec 3.5): it throws, and its own onDiagnostic receives the AX199 once, although the chart's
 * diagnostics already hold an AX199. The rejected call changes nothing (plan 1.5): AX199 stays current and the
 * proposed `strict` and handler are not kept.
 */
describe('a strict rejection while AX199 is already current reaches the submitted handler', () => {
  /** A distinct second replacement: a new array, a new throwing row, other values in candle 2. */
  const otherSameLength = (): Record<string, unknown>[] => [throwingRow(), VALID_THREE[1]!, THREE[2]!];

  it('in two ordinary updates: the first returns with AX199, the second throws and delivers AX199 once to its handler', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const submitted = recorder();
    const { rec, chart } = open({ title: 'Strict after AX199', data: THREE, ...FIELDS });
    expect(thrown(() => chart.update({ data: sameLength() }))).toBeNull();
    expect(codes(chart)).toContain('AX199');
    const error = thrown(() => chart.update({ strict: true, onDiagnostic: submitted.handler, data: otherSameLength() }));
    expect(error).toBeInstanceOf(StrictError);
    expect(codesOf(error)).toContain('AX199');
    expect(submitted.codes.filter(c => c === 'AX199')).toEqual(['AX199']);
    expect(codes(chart)).toContain('AX199');
    rec.frames();
    expect(submitted.codes.filter(c => c === 'AX199')).toEqual(['AX199']);
    expect(codes(chart)).toContain('AX199');
    // Rolled back: still non-strict (a warning is accepted) and the submitted handler was not kept.
    expect(thrown(() => chart.update({ data: BAD_VOLUME }))).toBeNull();
    rec.frames();
    expect(codes(chart)).toContain('AX181');
    expect(codes(chart)).not.toContain('AX199');
    expect(submitted.codes).toEqual(['AX199']);
    expect(rec.committed!.lookup.count).toBe(4);
    chart.destroy();
  });

  it('with both updates inside one hover notification drain: delivered once to the handler, after the listener', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const submitted = recorder();
    const { rec, chart, controller } = open({ title: 'Strict after AX199 in drain', data: THREE, ...FIELDS });
    let first: unknown = 'not run';
    let second: unknown = null;
    let codesAfterFirst: string[] = [];
    let codesAfterSecond: string[] = [];
    let handlerDuringListener: string[] | null = null;
    chart.on('hover', () => {
      first = thrown(() => chart.update({ data: sameLength() }));
      codesAfterFirst = codes(chart);
      second = thrown(() => chart.update({ strict: true, onDiagnostic: submitted.handler, data: otherSameLength() }));
      codesAfterSecond = codes(chart);
      handlerDuringListener = submitted.codes.slice();
    });
    emitHover(controller());
    rec.frames();
    expect(first).toBeNull();
    expect(codesAfterFirst).toContain('AX199');
    expect(second).toBeInstanceOf(StrictError);
    expect(codesOf(second)).toContain('AX199');
    expect(codesAfterSecond).toContain('AX199');
    // Deferred while the listener ran, then given once.
    expect(handlerDuringListener).toEqual([]);
    expect(submitted.codes.filter(c => c === 'AX199')).toEqual(['AX199']);
    expect(codes(chart)).toContain('AX199');
    expect(thrown(() => chart.update({ data: BAD_VOLUME }))).toBeNull();
    rec.frames();
    expect(codes(chart)).toContain('AX181');
    expect(codes(chart)).not.toContain('AX199');
    expect(submitted.codes).toEqual(['AX199']);
    expect(rec.committed!.lookup.count).toBe(4);
    chart.destroy();
  });
});

/**
 * Follow-up blocker (review sol-6.2-medium__20261127T010724Z): a strict rejection that names a finding which is
 * current and was already given to that call's handler does not give it to that handler again (spec 3.5: each
 * finding reaches onDiagnostic once; a strict call still throws it). A handler that answers AX181 with a strict
 * call therefore sees AX181 once, and the nested call's throw stays observable to it. The handler re-enters at
 * most LIMIT times, so a controller that re-delivers fails these assertions instead of looping.
 */
describe('a strict rejection does not hand a current finding back to the handler that already has it', () => {
  const LIMIT = 3;
  type Nested = { codes: string[]; errors: unknown[]; handler: (d: { code: string }) => void };
  /** A handler that answers each AX181 with a strict update, at most LIMIT times; `submit` makes the update. */
  const answering = (submit: (n: number) => void): Nested => {
    const list: string[] = [];
    const errors: unknown[] = [];
    // Counted on entry: a re-delivery made from inside the nested call itself must also stay bounded.
    let entries = 0;
    return {
      codes: list, errors,
      handler: d => {
        list.push(d.code);
        if (d.code !== 'AX181' || entries >= LIMIT) return;
        const n = entries++;
        errors.push(thrown(() => submit(n)));
      },
    };
  };
  const quiet = (): void => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  };
  const expectOneStrictAX181 = (nested: Nested): void => {
    expect(nested.codes.filter(c => c === 'AX181')).toEqual(['AX181']);
    expect(nested.errors).toHaveLength(1);
    expect(nested.errors[0]).toBeInstanceOf(StrictError);
    expect(codesOf(nested.errors[0])).toContain('AX181');
  };

  it('in an ordinary update: the handler runs once for AX181 and sees its strict title update throw', () => {
    quiet();
    let chart: FinanceHandle | null = null;
    const h = answering(n => chart!.update({ strict: true, title: `Strict ${n}` }));
    const opened = open({ title: 'Volume', data: THREE, ...FIELDS, onDiagnostic: h.handler });
    chart = opened.chart;
    expect(thrown(() => chart!.update({ data: BAD_VOLUME }))).toBeNull();
    opened.rec.frames();
    expectOneStrictAX181(h);
    // Rolled back: the title and strict were not kept, AX181 stays current, the four rows are drawn.
    expect(codes(chart)).toContain('AX181');
    expect(thrown(() => chart!.update({ data: BAD_THREE }))).toBeNull();
    opened.rec.frames();
    expect(codes(chart)).toContain('AX180');
    expect(h.codes.filter(c => c === 'AX181')).toEqual(['AX181']);
    chart.destroy();
  });

  it('inside a hover notification drain: the handler runs once for AX181, after the listener', () => {
    quiet();
    let chart: FinanceHandle | null = null;
    const h = answering(n => chart!.update({ strict: true, title: `Strict ${n}` }));
    const opened = open({ title: 'Volume in drain', data: THREE, ...FIELDS, onDiagnostic: h.handler });
    chart = opened.chart;
    let inListener: unknown = 'not run';
    let codesDuringListener: string[] | null = null;
    chart.on('hover', () => {
      inListener = thrown(() => chart!.update({ data: BAD_VOLUME }));
      codesDuringListener = h.codes.slice();
    });
    emitHover(opened.controller());
    opened.rec.frames();
    expect(inListener).toBeNull();
    expect(codesDuringListener).toEqual([]);
    expectOneStrictAX181(h);
    expect(codes(chart)).toContain('AX181');
    expect(opened.rec.committed!.lookup.count).toBe(4);
    chart.destroy();
  });

  it('a newly submitted handler gets the current AX181 once, and not again when it re-enters with itself', () => {
    quiet();
    let chart: FinanceHandle | null = null;
    // The second handler is submitted with each strict call it makes; the first hands over to it.
    const second: Nested = answering(n => chart!.update({ strict: true, title: `Second ${n}`, onDiagnostic: second.handler }));
    const first = answering(n => chart!.update({ strict: true, title: `First ${n}`, onDiagnostic: second.handler }));
    const opened = open({ title: 'Hand over', data: THREE, ...FIELDS, onDiagnostic: first.handler });
    chart = opened.chart;
    expect(thrown(() => chart!.update({ data: BAD_VOLUME }))).toBeNull();
    opened.rec.frames();
    expectOneStrictAX181(first);
    expectOneStrictAX181(second);
    chart.destroy();
  });

  it('after the accepted handler changes while AX181 stays current, a strict call gives AX181 once to the new handler', () => {
    quiet();
    const first = recorder();
    let chart: FinanceHandle | null = null;
    const second = answering(n => chart!.update({ strict: true, title: `Strict ${n}` }));
    const opened = open({ title: 'Handler change', data: THREE, ...FIELDS, onDiagnostic: first.handler });
    chart = opened.chart;
    expect(thrown(() => chart!.update({ data: BAD_VOLUME }))).toBeNull();
    expect(first.codes).toEqual(['AX181']);
    // Non-strict: AX181 is not news, so the new handler is not given it (key deduplication).
    expect(thrown(() => chart!.update({ onDiagnostic: second.handler }))).toBeNull();
    opened.rec.frames();
    expect(second.codes).toEqual([]);
    const error = thrown(() => chart!.update({ strict: true, title: 'Strict' }));
    expect(error).toBeInstanceOf(StrictError);
    expect(codesOf(error)).toContain('AX181');
    opened.rec.frames();
    // Once to the new handler, whose own nested strict call is then not answered with it again.
    expectOneStrictAX181(second);
    expect(first.codes).toEqual(['AX181']);
    chart.destroy();
  });

  it('inside a hover drain, accepted A submits B and B omits the handler: each gets AX181 once, both nested calls throw', () => {
    quiet();
    let chart: FinanceHandle | null = null;
    // B's strict call omits onDiagnostic, so it is answered through the accepted handler A, which already had
    // AX181: handing it back to A would let A submit B again, and the two would trade the finding for ever.
    const b = answering(n => chart!.update({ strict: true, title: `B ${n}` }));
    const a = answering(n => chart!.update({ strict: true, title: `A ${n}`, onDiagnostic: b.handler }));
    const opened = open({ title: 'A and B', data: THREE, ...FIELDS, onDiagnostic: a.handler });
    chart = opened.chart;
    let inListener: unknown = 'not run';
    chart.on('hover', () => {
      inListener = thrown(() => chart!.update({ data: BAD_VOLUME }));
    });
    emitHover(opened.controller());
    opened.rec.frames();
    expect(inListener).toBeNull();
    expectOneStrictAX181(a);
    expectOneStrictAX181(b);
    expect(codes(chart)).toContain('AX181');
    expect(opened.rec.committed!.lookup.count).toBe(4);
    chart.destroy();
  });
});
