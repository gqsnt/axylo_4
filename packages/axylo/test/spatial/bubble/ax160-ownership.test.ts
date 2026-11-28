/**
 * W4 integration review (blocker 2): an AX160 for a bubble size format belongs to the revision whose table read
 * the failing row.
 *
 * Rule under test (spec AX160, F12; the controller reports against the accepted options): a failing row of a
 * table that is not the active one — the visible table of revision s once an update to t is accepted but not yet
 * drawn, or s's table kept after t is drawn — still reads the default text, but is reported to nobody: not to t's
 * onDiagnostic, not in t's diagnostics, not in t's note; and it does not count as the failure already reported,
 * so t's own first failing read reports AX160, once. Reading the active table reports once per finding.
 *
 * Fixture: every y missing (the empty, inspectable state: no layout stage), so only table reads can format the
 * size. The format throws only for 37.
 */
import { describe, expect, it } from 'vitest';
import { controllerFor, type Controller } from '../../../src/core/controller';
import type { ControllerCore } from '../../../src/core/controller-types';
import { openBubbleChart } from '../../../src/spatial/bubble';
import { record } from '../../finance/host';

const format = (v: number) => { if (v === 37) throw new Error('no 37'); return `${v} u`; };
const data = [{ x: 0, y: null, s: 1 }, { x: 1, y: null, s: 37 }, { x: 2, y: null, s: 100 }];

function open(onDiagnostic: (d: { code: string }) => void) {
  const rec = record({ width: 720, height: 420 });
  let controller: Controller | null = null;
  const chart = openBubbleChart({ title: 'S', x: 'x', y: 'y', size: { field: 's', format }, data, onDiagnostic }, (c, input) => {
    controller = controllerFor(c, input, rec.host, null);
    return controller.handle;
  });
  rec.frames();
  return { rec, chart, controller: () => controller as unknown as ControllerCore };
}

const readAll = (table: { rowCount: number; row(i: number): readonly string[] | null }) =>
  Array.from({ length: table.rowCount }, (_, i) => table.row(i)!.at(-1));
const ax160 = (list: readonly { code: string }[]) => list.filter(d => d.code === 'AX160').length;

describe('AX160 for a bubble size format is reported against the revision that owns the table', () => {
  it('a read of the visible old table while an update is accepted but not drawn, and after it draws, reports nothing to the new revision; its own first read still reports once', () => {
    const toS: string[] = [], toT: string[] = [];
    const { rec, chart, controller } = open(d => toS.push(d.code));
    const old = controller().drawn!.reader.table!;

    chart.update({ title: 'T', onDiagnostic: (d: { code: string }) => toT.push(d.code) });
    // Accepted, not drawn: the old table is still the one on screen.
    expect(controller().drawn!.reader.table).toBe(old);
    expect(controller().accepted).not.toBe(controller().drawn!.accepted);
    expect(readAll(old)).toEqual(['1 u', expect.stringContaining('37'), '100 u']);
    expect(chart.diagnostics.some(d => d.code === 'AX160')).toBe(false);
    expect(toT).not.toContain('AX160');

    rec.frames();
    const drawn = controller().drawn!;
    expect(drawn.reader.table).not.toBe(old);
    expect(ax160(chart.diagnostics)).toBe(0);
    expect(toT).not.toContain('AX160');
    expect(toS).not.toContain('AX160');
    const noteBefore = drawn.reader.note;

    // The old table kept after t is drawn: its fallback text is unchanged, and still nothing is reported.
    expect(readAll(old)[1]).toEqual(expect.stringContaining('37'));
    rec.frames();
    expect(ax160(chart.diagnostics)).toBe(0);
    expect(toT).not.toContain('AX160');
    expect(controller().drawn!.reader.note).toBe(noteBefore);

    // t's own table: the first failing read is t's finding, reported to all three outputs, once.
    const active = controller().drawn!.reader.table!;
    expect(readAll(active)[1]).toEqual(expect.stringContaining('37'));
    rec.frames();
    expect(ax160(chart.diagnostics)).toBe(1);
    expect(toT.filter(c => c === 'AX160')).toHaveLength(1);
    expect(toS).not.toContain('AX160');
    expect(controller().drawn!.reader.note).not.toBe(noteBefore);
    readAll(active);
    readAll(old);
    rec.frames();
    expect(ax160(chart.diagnostics)).toBe(1);
    expect(toT.filter(c => c === 'AX160')).toHaveLength(1);
  });

  it('a read of the active table outside a frame reports at once, then never again for that table', () => {
    const seen: string[] = [];
    const { rec, chart, controller } = open(d => seen.push(d.code));
    const table = controller().drawn!.reader.table!;
    table.row(1);
    expect(seen.filter(c => c === 'AX160')).toHaveLength(1);
    rec.frames();
    expect(ax160(chart.diagnostics)).toBe(1);
    table.row(1);
    rec.frames();
    expect(seen.filter(c => c === 'AX160')).toHaveLength(1);
  });

  it('after destroy, reads of the old and the active table report nothing', () => {
    const seen: string[] = [];
    const { rec, chart, controller } = open(d => seen.push(d.code));
    const old = controller().drawn!.reader.table!;
    chart.update({ title: 'T' });
    rec.frames();
    const active = controller().drawn!.reader.table!;
    chart.destroy();
    readAll(old); readAll(active);
    rec.frames();
    expect(seen).not.toContain('AX160');
  });
});
