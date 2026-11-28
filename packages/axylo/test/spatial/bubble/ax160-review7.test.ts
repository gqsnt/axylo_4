/**
 * W4 integration review 7: two AX160 defects (spec AX160 effect 'changed', F12: the note says a value is shown in a
 * default format; one public finding per field).
 *
 * 1. A table the core reused for a newer accepted revision (an onDiagnostic-only update keeps the reader) is the
 *    drawn table of that revision: a failing size read on it reports to diagnostics, the new onDiagnostic and the note.
 * 2. A stock x format and the size format on the same field both throw: withdrawing the size finding (its options
 *    replaced) keeps the stock one, in diagnostics and the note, while the x cell still shows its default text.
 *
 * Fixture: an empty, inspectable chart (every y missing), so there is no layout stage; size 37 throws.
 */
import { describe, expect, it } from 'vitest';
import { controllerFor, type Controller } from '../../../src/core/controller';
import { exportCsv } from '../../../src/export';
import type { ControllerCore } from '../../../src/core/controller-types';
import { openBubbleChart } from '../../../src/spatial/bubble';
import { record } from '../../finance/host';

const empty = [{ x: 0, y: null, s: 1 }, { x: 1, y: null, s: 37 }, { x: 2, y: null, s: 100 }];
const ax160 = (list: readonly { code: string; field?: string }[]) => list.filter(d => d.code === 'AX160').map(d => d.field);

function open(options: Record<string, unknown>) {
  const rec = record({ width: 720, height: 420 });
  let controller: Controller | null = null;
  const chart = openBubbleChart({ title: 'R7', y: 'y', data: empty, ...options } as never, (c, input) => {
    controller = controllerFor(c, input, rec.host, null);
    return controller.handle;
  });
  rec.frames();
  return { rec, chart, core: () => controller as unknown as ControllerCore };
}

describe('AX160 on a reused table', () => {
  it('a failing size read of the table kept across an onDiagnostic-only update reports to all three outputs', () => {
    const format = (v: number) => { if (v === 37) throw new Error('no 37'); return `${v} u`; };
    const first: string[] = [];
    const second: { code: string; field?: string }[] = [];
    const { rec, chart, core } = open({ x: 'x', size: { field: 's', format }, onDiagnostic: (d: { code: string }) => first.push(d.code) });
    const before = core().drawn!;
    const table = before.reader.table!;
    const noteBefore = before.reader.note;
    chart.update({ onDiagnostic: (d: { code: string; field?: string }) => second.push(d) } as never);
    rec.frames();
    const after = core().drawn!;
    // The precondition of the defect: a newer accepted revision draws the same table.
    expect(after.accepted).not.toBe(before.accepted);
    expect(after.reader.table).toBe(table);

    expect(table.row(1)!.at(-1)).not.toBe('37 u');
    rec.frames();
    expect(ax160(chart.diagnostics)).toEqual(['s']);
    expect(ax160(second)).toEqual(['s']);
    expect(first).not.toContain('AX160');
    const note = core().drawn!.reader.note;
    expect(note).not.toBeNull();
    expect(note).not.toBe(noteBefore);
  });
});

describe('AX160 for a CSV export while an onDiagnostic-only update is pending', () => {
  it('the fallback cached by the early export reports once on the first owned read after publication', () => {
    let calls = 0;
    const format = (v: number) => { calls++; if (v === 37) throw new Error('no 37'); return `${v} u`; };
    const first: string[] = [];
    const second: { code: string; field?: string }[] = [];
    const { rec, chart, core } = open({ x: 'x', size: { field: 's', format }, onDiagnostic: (d: { code: string }) => first.push(d.code) });
    const before = core().drawn!;
    const noteBefore = before.reader.note;
    chart.update({ onDiagnostic: (d: { code: string; field?: string }) => second.push(d) } as never);
    // Pending: the drawn table is the older revision's, so this read is not the newer revision's to report.
    const early = exportCsv(chart as never);
    const fallback = early.split('\r\n')[2]!.split(',').at(-1);
    expect(fallback).not.toBe('37 u');
    const formatted = calls;
    expect(ax160(chart.diagnostics)).toEqual([]);
    expect(second).toEqual([]);
    rec.frames();
    const after = core().drawn!;
    expect(after.accepted).not.toBe(before.accepted);
    expect(after.reader.table).toBe(before.reader.table);
    // Publication alone reports nothing: no read the accepted revision owns has failed yet.
    expect(ax160(chart.diagnostics)).toEqual([]);
    expect(second).toEqual([]);
    expect(after.reader.note).toBe(noteBefore);

    // The owned read: the same cached text (no second format call), and the finding it carries is reported once.
    expect(exportCsv(chart as never)).toBe(early);
    expect(calls).toBe(formatted);
    rec.frames();
    expect(ax160(chart.diagnostics)).toEqual(['s']);
    expect(ax160(second)).toEqual(['s']);
    expect(first).not.toContain('AX160');
    const note = core().drawn!.reader.note;
    expect(note).not.toBeNull();
    expect(note).not.toBe(noteBefore);

    // Exactly once: further owned reads (the note changed, so of a new table, formatted once) add nothing.
    expect(exportCsv(chart as never)).toBe(early);
    rec.frames();
    expect(ax160(chart.diagnostics)).toEqual(['s']);
    expect(ax160(second)).toEqual(['s']);
  });
});

describe('AX160 for a size and a stock format on the same field', () => {
  it('withdrawing the size finding keeps the stock x finding, in diagnostics and the note', () => {
    const throws = (v: number) => { if (v === 1) throw new Error('no 1'); return `${v} u`; };
    const { rec, chart, core } = open({ x: { field: 'x', format: throws }, size: { field: 'x', format: throws } });
    const noteEmpty = core().drawn!.reader.note;
    const row = core().drawn!.reader.table!.row(1)!;
    expect(row).not.toContain('1 u');
    rec.frames();
    // Present before retirement: one public finding for the field (per-field deduplication).
    expect(ax160(chart.diagnostics)).toEqual(['x']);
    const noteFailing = core().drawn!.reader.note;
    expect(noteFailing).not.toBeNull();
    expect(noteFailing).not.toBe(noteEmpty);

    chart.update({ size: { field: 'x', format: (v: number) => `${v} t` } } as never);
    rec.frames();
    const cells = core().drawn!.reader.table!.row(1)!;
    expect(cells.at(-1)).toBe('1 t');
    // The x cell still falls back to its default text.
    expect(cells).not.toContain('1 u');
    rec.frames();
    expect(ax160(chart.diagnostics)).toEqual(['x']);
    expect(core().drawn!.reader.note).toBe(noteFailing);
  });
});
