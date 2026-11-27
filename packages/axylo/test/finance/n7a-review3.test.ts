/**
 * N7a repair of cross-provider review sol-6.2-medium__20261126T190553Z, blockers 1–3, on the real controller
 * (recording host) and the pure stages:
 *  1. an update made by onDiagnostic returns or throws its own strict error, synchronously, to its own caller;
 *  2. finance format options are snapshotted where they are submitted: ticks and readouts change together on
 *     resubmission, and an edit that was never submitted reaches neither;
 *  3. AX160 follows the drawn label that fell back, not a label made for the same value in a discarded set.
 *
 * Expected values come from the review's fixtures and the stated rules (spec 3.5: strict throws from the call
 * that found the error; AX160 only for a drawn fallback), never from a previous run of this code.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { controllerFor, type Controller } from '../../src/core/controller';
import { StrictError } from '../../src/core/delivery';
import type { Layout } from '../../src/core/contracts';
import { openFinanceChart, type FinanceHandle } from '../../src/finance/chart';
import { parseFinanceInput } from '../../src/finance/core';
import { financeLayout, financePanes, volumeTicks, VolumeTickFailures, type FinancePanes } from '../../src/finance/layout';
import { createNumberTickLabeler } from '../../src/format';
import { stage, type Staged } from './fixtures';
import type { Composition } from '../../src/core/composition';
import { rowsTable, sameTableData } from '../../src/data/table';
import { record, resolvedTable, type Recording } from './host';

const THREE = [
  { day: '2026-01-01', o: 100, h: 112, l: 98, c: 110, v: 5000 },
  { day: '2026-01-02', o: 110, h: 111, l: 100, c: 102, v: 4200 },
  { day: '2026-01-03', o: 102, h: 106, l: 99, c: 105, v: 3100 },
];
/** A fourth row whose high is below its open: AX180. */
const BAD_OHLC = [...THREE, { day: '2026-01-04', o: 105, h: 100, l: 95, c: 104, v: 2000 }];
/** A fourth row, valid OHLC, negative volume: AX181. */
const BAD_VOLUME = [...THREE, { day: '2026-01-04', o: 104, h: 108, l: 101, c: 106, v: -5 }];
/** Both at once: AX180 and AX181 in one call. */
const BAD_BOTH = [...THREE, { day: '2026-01-04', o: 105, h: 100, l: 95, c: 104, v: -5 }];
const FIELDS = { x: 'day', open: 'o', high: 'h', low: 'l', close: 'c', volume: 'v' };

function open(options: Record<string, unknown>, size = { width: 720, height: 420 }): {
  rec: Recording; chart: FinanceHandle; controller: () => Controller;
} {
  const rec = record(size);
  let controller: Controller | null = null;
  const chart = openFinanceChart(options, (composition, translated) => {
    controller = controllerFor(composition, translated, rec.host);
    return controller.handle;
  });
  return { rec, chart, controller: () => controller! };
}

const panesOf = (layout: Layout): FinancePanes => {
  const panes = financePanes(layout);
  if (!panes) throw new Error(`no finance panes on a ${layout.kind} layout`);
  return panes;
};
const ax160 = (s: Staged): boolean =>
  (financeLayout(s.stateRef).layoutDiagnostics?.(s.view, s.ctx, s.layout) ?? []).some(d => d.code === 'AX160');
const codesOf = (error: unknown): string[] => (error instanceof StrictError ? error.diagnostics.map(d => d.code) : []);

afterEach(() => {
  vi.restoreAllMocks();
});

// ───────────────────────────── blocker 1 ─────────────────────────────

describe('review 3, blocker 1: nested updates from onDiagnostic keep their own strict errors', () => {
  it('outer AX180 and nested AX181: each caller receives its own error, synchronously', () => {
    let chart: FinanceHandle | null = null;
    const log: string[] = [];
    let innerError: unknown = null;
    let innerReturned = false;
    const onDiagnostic = (d: { code: string }) => {
      log.push(d.code);
      if (d.code !== 'AX180') return;
      // The rejected outer call is already rolled back: the handler sees the committed chart.
      expect(chart!.diagnostics.some(x => x.code === 'AX180')).toBe(false);
      log.push('nested:start');
      try {
        chart!.update({ data: BAD_VOLUME });
        innerReturned = true;
      } catch (error) {
        innerError = error;
        log.push('nested:threw');
      }
    };
    const { rec, chart: c } = open({ title: 'Strict', strict: true, onDiagnostic, data: THREE, ...FIELDS });
    chart = c;
    rec.frames();
    let outerError: unknown = null;
    try {
      chart.update({ data: BAD_OHLC });
    } catch (error) {
      outerError = error;
      log.push('outer:threw');
    }
    expect(innerReturned).toBe(false);
    expect(innerError).toBeInstanceOf(StrictError);
    expect(outerError).toBeInstanceOf(StrictError);
    expect(outerError).not.toBe(innerError);
    expect(codesOf(innerError)).toContain('AX181');
    expect(codesOf(innerError)).not.toContain('AX180');
    expect(codesOf(outerError)).toContain('AX180');
    expect(codesOf(outerError)).not.toContain('AX181');
    // The nested call's finding reached the handler inside the nested call, before it threw; the outer threw last.
    expect(log).toEqual(['AX180', 'nested:start', 'AX181', 'nested:threw', 'outer:threw']);
    rec.frames();
    expect(rec.committed!.lookup.count).toBe(3);
    expect(chart.diagnostics.filter(d => d.code === 'AX180' || d.code === 'AX181')).toEqual([]);
    chart.destroy();
  });

  it('a successful nested update after a rejection runs over the last accepted options and returns', () => {
    let chart: FinanceHandle | null = null;
    let returned = false;
    const onDiagnostic = (d: { code: string }) => {
      if (d.code !== 'AX180' || returned) return;
      chart!.update({ title: 'Nested' });
      returned = true;
    };
    const { rec, chart: c } = open({ title: 'Strict', strict: true, onDiagnostic, data: THREE, ...FIELDS, volumeAxis: { label: 'Shares' } });
    chart = c;
    rec.frames();
    expect(() => chart!.update({ data: BAD_OHLC, volumeAxis: { label: 'Rejected' } })).toThrow(StrictError);
    expect(returned).toBe(true);
    rec.frames();
    const layout = rec.committed!.layout;
    const titles = layout.kind === 'plot' ? layout.texts.filter(t => t.role === 'title-y').map(t => t.full) : [];
    expect(titles).toContain('Shares');
    expect(titles).not.toContain('Rejected');
    expect(rec.committed!.lookup.count).toBe(3);
    chart.destroy();
  });

  it('an accepted outer update: the nested strict update throws AX181 to its caller, the outer returns', () => {
    let chart: FinanceHandle | null = null;
    let innerError: unknown = null;
    let nested = 0;
    const onDiagnostic = (d: { code: string }) => {
      if (d.code !== 'AX180' || nested++) return;
      // The outer update is already accepted: the handler sees its finding in the chart's diagnostics.
      expect(chart!.diagnostics.some(x => x.code === 'AX180')).toBe(true);
      try {
        chart!.update({ strict: true, data: BAD_VOLUME });
      } catch (error) {
        innerError = error;
      }
    };
    const { rec, chart: c } = open({ title: 'Loose', onDiagnostic, data: THREE, ...FIELDS });
    chart = c;
    rec.frames();
    expect(() => chart!.update({ data: BAD_OHLC })).not.toThrow();
    expect(nested).toBe(1);
    expect(codesOf(innerError)).toEqual(expect.arrayContaining(['AX181']));
    expect(codesOf(innerError)).not.toContain('AX180');
    rec.frames();
    // The outer update stands (four rows, AX180); the nested one was rolled back.
    expect(rec.committed!.lookup.count).toBe(4);
    expect(chart.diagnostics.some(d => d.code === 'AX180')).toBe(true);
    expect(chart.diagnostics.some(d => d.code === 'AX181')).toBe(false);
    chart.destroy();
  });

  it('delivers a call\'s findings in order, isolates a throwing handler, and stops once the handler destroys the chart', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen: string[] = [];
    const onDiagnostic = (d: { code: string }) => {
      seen.push(d.code);
      throw new Error('handler');
    };
    const { rec, chart } = open({ title: 'Strict', strict: true, onDiagnostic, data: THREE, ...FIELDS });
    rec.frames();
    let thrown: unknown = null;
    try {
      chart.update({ data: BAD_BOTH });
    } catch (e) {
      thrown = e;
    }
    // The call's own strict error, never the handler's.
    expect(thrown).toBeInstanceOf(StrictError);
    expect(seen).toEqual(codesOf(thrown).filter(c => c === 'AX180' || c === 'AX181'));
    expect(seen).toEqual(expect.arrayContaining(['AX180', 'AX181']));
    expect(error).toHaveBeenCalledTimes(1);
    chart.destroy();

    let chart2: FinanceHandle | null = null;
    const after: string[] = [];
    const destroying = (d: { code: string }) => {
      after.push(d.code);
      chart2?.destroy();
    };
    const second = open({ title: 'Strict', strict: true, onDiagnostic: destroying, data: THREE, ...FIELDS });
    chart2 = second.chart;
    second.rec.frames();
    expect(() => chart2!.update({ data: BAD_BOTH })).toThrow(StrictError);
    expect(after).toHaveLength(1);
  });

  it('gives the controller the same onDiagnostic while the author\'s handler is unchanged, a new one when it changes', () => {
    const seen: unknown[] = [];
    const first = () => {};
    const second = () => {};
    const { chart } = openFinanceChartRecording(seen, { title: 'Same', onDiagnostic: first, data: THREE, ...FIELDS });
    chart.update({ title: 'Two' });
    chart.update({ onDiagnostic: first });
    chart.update({ onDiagnostic: second });
    chart.update({ onDiagnostic: first });
    expect(seen.length).toBe(5);
    expect(typeof seen[0]).toBe('function');
    expect(seen[1]).toBe(seen[0]);
    expect(seen[2]).toBe(seen[0]);
    expect(seen[3]).not.toBe(seen[0]);
    expect(typeof seen[3]).toBe('function');
    expect(seen[4]).toBe(seen[0]);
    chart.destroy();
  });
});

/** Opens a chart on a recording host, noting the onDiagnostic the controller is given on every call. */
function openFinanceChartRecording(seen: unknown[], options: Record<string, unknown>): { chart: FinanceHandle } {
  const rec = record();
  const chart = openFinanceChart(options, (composition, translated) => {
    seen.push(translated.onDiagnostic);
    const controller = controllerFor(composition, translated, rec.host);
    const inner = controller.handle;
    return {
      update(patch) { seen.push((patch as Record<string, unknown>).onDiagnostic); inner.update(patch); },
      zoom: range => inner.zoom(range),
      on: (event, listener) => inner.on(event as never, listener as never),
      get diagnostics() { return inner.diagnostics; },
      destroy: () => inner.destroy(),
    };
  });
  return { chart };
}

// ───────────────────────────── blocker 2 ─────────────────────────────

describe('review 3, blocker 2: format options are snapshotted at submission', () => {
  const volumeCell = (rec: Recording, row: number): string => {
    const table = rec.committed!.reader.table!;
    return table.row(row)![table.headers.indexOf('Volume')]!;
  };
  const axis = (rec: Recording): string[] => panesOf(rec.committed!.layout).volumeTicks.map(t => t.label);

  it('resubmitting an edited Intl object changes ticks and readouts together; an unsubmitted edit reaches neither', () => {
    const format: Intl.NumberFormatOptions = { maximumFractionDigits: 0 };
    const volumeAxis = { format };
    const size = { width: 720, height: 420 };
    const { rec, chart, controller } = open({ title: 'Formats', data: THREE, ...FIELDS, volumeAxis }, size);
    rec.frames();
    expect(volumeCell(rec, 0)).toBe('5,000');
    expect(axis(rec)).toContain('2,000');

    // Edited and resubmitted (the same objects): both lanes take it.
    // Both bounds move together: minimum above maximum is a RangeError (a fallback, not a format).
    format.minimumFractionDigits = 2;
    format.maximumFractionDigits = 2;
    chart.update({ volumeAxis });
    rec.frames();
    expect(volumeCell(rec, 0)).toBe('5,000.00');
    expect(axis(rec)).toContain('2,000.00');

    // Edited, not submitted: a resize and an unrelated update keep the accepted format.
    format.minimumFractionDigits = 3;
    format.maximumFractionDigits = 3;
    size.width = 760;
    controller().invalidate.resize();
    rec.frames();
    expect(axis(rec)).toContain('2,000.00');
    expect(volumeCell(rec, 0)).toBe('5,000.00');
    chart.update({ title: 'Unrelated' });
    rec.frames();
    expect(axis(rec)).toContain('2,000.00');
    expect(axis(rec)).not.toContain('2,000.000');
    expect(volumeCell(rec, 0)).toBe('5,000.00');

    // Submitted again: now both read three digits.
    chart.update({ volumeAxis });
    rec.frames();
    expect(axis(rec)).toContain('2,000.000');
    expect(volumeCell(rec, 0)).toBe('5,000.000');
    chart.destroy();
  });

  it('an unsubmitted edit of a price format cannot leak into an unrelated patch', () => {
    const format: Intl.NumberFormatOptions = { maximumFractionDigits: 0 };
    const { rec, chart } = open({ title: 'Price', data: THREE, ...FIELDS, yAxis: { format } });
    rec.frames();
    const cell = () => rec.committed!.reader.table!.row(0)![1];
    expect(cell()).toBe('100');
    format.minimumFractionDigits = 2;
    format.maximumFractionDigits = 2;
    chart.update({ volumeAxis: { label: 'Shares' } });
    rec.frames();
    expect(cell()).toBe('100');
    chart.destroy();
  });

  it('keeps the accepted format object for equal content and replaces it for new content (layout key by value)', () => {
    const first = parseFinanceInput({ ...FIELDS, data: THREE, volumeAxis: { format: { maximumFractionDigits: 0 } }, yAxis: { format: { style: 'currency', currency: 'USD' } } });
    const same = parseFinanceInput({ ...FIELDS, data: THREE, volumeAxis: { format: { maximumFractionDigits: 0 } }, yAxis: { format: { style: 'currency', currency: 'USD' } } }, first.meta);
    expect(same.meta.volumeFormat).toBe(first.meta.volumeFormat);
    expect(same.meta.priceFormat).toBe(first.meta.priceFormat);
    const changed = parseFinanceInput({ ...FIELDS, data: THREE, volumeAxis: { format: { maximumFractionDigits: 2 } } }, first.meta);
    expect(changed.meta.volumeFormat).not.toBe(first.meta.volumeFormat);
    expect(changed.meta.volumeFormat).toEqual({ maximumFractionDigits: 2 });
    expect(changed.meta.priceFormat).toBeNull();
    // A function format is kept by identity, never copied.
    const fn = (v: number) => `${v}`;
    expect(parseFinanceInput({ ...FIELDS, volumeAxis: { format: fn } }).meta.volumeFormat).toBe(fn);
  });

  it('keeps borrowed data and function formats by identity through the wrapper', () => {
    const data = THREE.slice();
    const fn = (v: number) => `${v} sh`;
    let received: Record<string, unknown> | null = null;
    let used: Composition | null = null;
    const rec = record();
    openFinanceChart({ title: 'Borrowed', data, ...FIELDS, volumeAxis: { format: fn } }, (composition, translated) => {
      received = translated;
      used = composition;
      return controllerFor(composition, translated, rec.host).handle;
    });
    // The controller holds the wrapper's data holder; what resolution reads is the caller's own array and rows.
    const table = resolvedTable(used!, received!);
    expect(sameTableData(table, rowsTable(data))).toBe(true);
    expect(table.rowAt(0)).toBe(data[0]);
    const volumeSpec = (received!.y as Record<string, unknown>[]).find(s => s.field === 'v')!;
    expect(volumeSpec.format).toBe(fn);
  });
});

// ───────────────────────────── blocker 3 ─────────────────────────────

describe('review 3, blocker 3: AX160 follows the drawn label instance', () => {
  const data = (max: number) => [1000, 3000, max].map((v, i) => ({ day: `2026-03-0${i + 2}`, o: 100, h: 104, l: 99, c: 103, v }));
  // [0, 2000, 4000] is the densest set of at most three; 4000 reads as 2000, so that set is discarded and
  // [0, 5000] is drawn. Each lane attempt labels 0 twice, discarded set first: the call count's parity says which.
  const formatWith = (zero: (call: number) => string) => {
    let zeroCalls = 0;
    return (v: number) => {
      if (v === 0) return zero(zeroCalls++);
      return v === 4000 ? '$2000' : `$${v}`;
    };
  };

  it('a zero that failed in a discarded set and succeeded in the drawn set reports nothing', () => {
    const format = formatWith(call => {
      if (call % 2 === 0) throw new Error('zero in the discarded set');
      return 'zero';
    });
    const s = stage({ data: data(5000), ...FIELDS, volumeAxis: { format } });
    expect(s.panes.volumeTicks.map(t => t.label)).toEqual(['zero', '$5000']);
    expect(s.panes.volumeFormatFailed).toBe(false);
    expect(ax160(s)).toBe(false);
  });

  it('the inverse: a zero that succeeded in the discarded set and failed in the drawn set reports AX160', () => {
    const format = formatWith(call => {
      if (call % 2 === 0) return 'zero';
      throw new Error('zero in the drawn set');
    });
    const s = stage({ data: data(5000), ...FIELDS, volumeAxis: { format } });
    // The drawn baseline carries the default label in place of the author's.
    expect(s.panes.volumeTicks.map(t => t.value)).toEqual([0, 5000]);
    expect(s.panes.volumeTicks[0]!.label).toBe('0');
    expect(s.panes.volumeFormatFailed).toBe(true);
    expect(ax160(s)).toBe(true);
  });

  it('on the real controller: the failing-then-successful zero never emits AX160', () => {
    const format = formatWith(call => {
      if (call % 2 === 0) throw new Error('zero in the discarded set');
      return 'zero';
    });
    const { rec, chart } = open({ title: 'Zero', data: data(5000), ...FIELDS, volumeAxis: { format } });
    rec.frames(6);
    expect(panesOf(rec.committed!.layout).volumeTicks.map(t => t.label)).toEqual(['zero', '$5000']);
    expect(chart.diagnostics.some(d => d.code === 'AX160')).toBe(false);
    chart.destroy();
  });

  it('tracks each label call: volumeTicks marks the fallback on the instance that threw', () => {
    const failures = new VolumeTickFailures();
    const format = formatWith(call => {
      if (call % 2 === 0) throw new Error('zero in the discarded set');
      return 'zero';
    });
    const label = createNumberTickLabeler({ locale: 'en-US', tickFormat: failures.author(format), onError: failures.report });
    const ticks = volumeTicks(5000, 120, 15, label, failures);
    expect(ticks.map(t => [t.value, t.label, t.fallback])).toEqual([[0, 'zero', false], [5000, '$5000', false]]);
    expect(failures.drawn(ticks)).toBe(false);
  });
});
