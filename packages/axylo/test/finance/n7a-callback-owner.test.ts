/**
 * N7a callback ownership: a finding goes to the onDiagnostic given with the call that found it, even when the
 * controller delivers it later (it defers delivery while it drains notifications, e.g. inside an event
 * listener), and errors from updates queued by getters never replace the outer call's own strict error.
 *
 * Expected values come from the stated rules (spec 3.5: AX180 invalid OHLC, AX181 invalid volume; strict throws
 * from the call that found the error), never from a previous run of this code.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { controllerFor, type Controller } from '../../src/core/controller';
import type { ControllerCore } from '../../src/core/controller-types';
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
/** A fourth row, valid OHLC, negative volume: AX181. */
const BAD_VOLUME = [...THREE, { day: '2026-01-04', o: 104, h: 108, l: 101, c: 106, v: -5 }];
const FIELDS = { x: 'day', open: 'o', high: 'h', low: 'l', close: 'c', volume: 'v' };

function open(options: Record<string, unknown>): { rec: Recording; chart: FinanceHandle; controller: () => Controller } {
  const rec = record();
  let controller: Controller | null = null;
  const chart = openFinanceChart(options, (composition, translated) => {
    controller = controllerFor(composition, translated, rec.host);
    return controller.handle;
  });
  return { rec, chart, controller: () => controller! };
}

// The chart controller is also its own ControllerCore (the interaction layer raises events through emit).
const emitHover = (c: Controller): void => { (c as unknown as ControllerCore).emit('hover', null); };
const codesOf = (error: unknown): string[] => (error instanceof StrictError ? error.diagnostics.map(d => d.code) : []);
const recorder = (): { codes: string[]; handler: (d: { code: string }) => void } => {
  const codes: string[] = [];
  return { codes, handler: d => { codes.push(d.code); } };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('callback ownership: findings go to the handler given with their call', () => {
  it('inside an event listener: a rejected update\'s AX180 reaches its own handler, not the one accepted after it', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const first = recorder();
    const rejected = recorder();
    const accepted = recorder();
    const { rec, chart, controller } = open({ title: 'Owner', strict: true, onDiagnostic: first.handler, data: THREE, ...FIELDS });
    rec.frames();
    expect(first.codes).toEqual([]);

    let rejection: unknown = null;
    let listenerRan = false;
    chart.on('hover', () => {
      listenerRan = true;
      try {
        chart.update({ onDiagnostic: rejected.handler, data: BAD_OHLC, strict: true });
      } catch (e) {
        rejection = e;
      }
      // Accepted before the controller has drained the rejection's delivery.
      chart.update({ onDiagnostic: accepted.handler, strict: false, data: BAD_VOLUME });
    });
    emitHover(controller());
    rec.frames();

    expect(listenerRan).toBe(true);
    expect(rejection).toBeInstanceOf(StrictError);
    expect(codesOf(rejection)).toContain('AX180');
    expect(codesOf(rejection)).not.toContain('AX181');
    // Each finding at its originating handler.
    expect(rejected.codes).toContain('AX180');
    expect(rejected.codes).not.toContain('AX181');
    expect(accepted.codes).toContain('AX181');
    expect(accepted.codes).not.toContain('AX180');
    expect(first.codes).toEqual([]);
    // The rejection was rolled back; the accepted update stands.
    expect(rec.committed!.lookup.count).toBe(4);
    expect(chart.diagnostics.some(d => d.code === 'AX180')).toBe(false);
    expect(chart.diagnostics.some(d => d.code === 'AX181')).toBe(true);
    chart.destroy();
  });

  it('outside a listener: synchronous rejection with a new handler reaches that handler before the call throws', () => {
    const first = recorder();
    const rejected = recorder();
    const { rec, chart } = open({ title: 'Owner', strict: true, onDiagnostic: first.handler, data: THREE, ...FIELDS });
    rec.frames();
    expect(() => chart.update({ onDiagnostic: rejected.handler, data: BAD_OHLC })).toThrow(StrictError);
    expect(rejected.codes).toContain('AX180');
    expect(first.codes).toEqual([]);
    // Rolled back: the accepted handler is still the first one.
    chart.update({ strict: false, data: BAD_VOLUME });
    rec.frames();
    expect(first.codes).toContain('AX181');
    expect(rejected.codes).not.toContain('AX181');
    chart.destroy();
  });

  it('without a handler: a strict rejection still throws, and nothing is delivered later to a handler set afterwards', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const later = recorder();
    const { rec, chart, controller } = open({ title: 'None', strict: true, data: THREE, ...FIELDS });
    rec.frames();
    let rejection: unknown = null;
    chart.on('hover', () => {
      try {
        chart.update({ data: BAD_OHLC });
      } catch (e) {
        rejection = e;
      }
      chart.update({ onDiagnostic: later.handler, title: 'Later' });
    });
    emitHover(controller());
    rec.frames();
    expect(codesOf(rejection)).toContain('AX180');
    expect(later.codes).not.toContain('AX180');
    chart.destroy();
  });
});

describe('updates queued by getters never replace the outer call\'s strict error', () => {
  it('a queued strict rejection: the outer call throws its own AX180, the queued AX181 reaches its handler', () => {
    const seen = recorder();
    const { rec, chart } = open({ title: 'Queued', strict: true, onDiagnostic: seen.handler, data: THREE, ...FIELDS });
    rec.frames();
    let thrown: unknown = null;
    try {
      chart.update({
        data: BAD_OHLC,
        get title() {
          chart.update({ data: BAD_VOLUME });
          return 'Outer';
        },
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(StrictError);
    expect(codesOf(thrown)).toContain('AX180');
    expect(codesOf(thrown)).not.toContain('AX181');
    expect(seen.codes).toEqual(expect.arrayContaining(['AX180', 'AX181']));
    rec.frames();
    // Both were rolled back: three valid rows.
    expect(rec.committed!.lookup.count).toBe(3);
    chart.destroy();
  });

  it('a queued patch whose own getter throws: the outer strict error is thrown, the queued error printed', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rec, chart } = open({ title: 'Queued', strict: true, data: THREE, ...FIELDS });
    rec.frames();
    const boom = new Error('queued getter');
    let thrown: unknown = null;
    try {
      chart.update({
        data: BAD_OHLC,
        get title() {
          chart.update({ get title(): string { throw boom; } });
          return 'Outer';
        },
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(StrictError);
    expect(codesOf(thrown)).toContain('AX180');
    expect(error.mock.calls.some(call => call.includes(boom))).toBe(true);
    chart.destroy();
  });

  it('a queued patch whose getter throws after an accepted outer call: that error still reaches the caller', () => {
    const { rec, chart } = open({ title: 'Queued', strict: true, data: THREE, ...FIELDS });
    rec.frames();
    const boom = new Error('queued getter');
    expect(() => chart.update({
      get title() {
        chart.update({ get title(): string { throw boom; } });
        return 'Outer';
      },
    })).toThrow(boom);
    rec.frames();
    expect(rec.committed!.lookup.count).toBe(3);
    chart.destroy();
  });
});
