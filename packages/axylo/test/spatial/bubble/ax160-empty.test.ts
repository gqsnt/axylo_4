/**
 * W4 integration: AX160 for a bubble size format on a chart whose plot is empty but whose table has rows.
 *
 * Rule under test (spec AX160, F12; N8b ledger, fifth repairs item 5): when an author format throws, the
 * default text is shown instead and AX160 (effect 'changed') is reported to `chart.diagnostics`, to
 * `onDiagnostic`, and in the reader's note. An empty plot has no layout stage, so the size format's failure
 * goes through the controller's formatter report: the drawn table's rows still read the size, and a throw
 * there is that drawn figure's finding.
 *
 * Fixture: every y is missing, so nothing is drawn (the empty state), while each row's size is in the table.
 * The format throws only for 37, so the legend and summary range (never formatted for an empty plot) cannot
 * be what reports it: only reading the 37 row can.
 */
import { describe, expect, it } from 'vitest';
import { controllerFor, type Controller } from '../../../src/core/controller';
import type { ControllerCore } from '../../../src/core/controller-types';
import { openBubbleChart } from '../../../src/spatial/bubble';
import { record } from '../../finance/host';

function open(options: Record<string, unknown>) {
  const rec = record({ width: 720, height: 420 });
  let controller: Controller | null = null;
  const chart = openBubbleChart({ title: 'Bubbles', ...options }, (c, input) => {
    controller = controllerFor(c, input, rec.host, null);
    return controller.handle;
  });
  rec.frames();
  // The controller's committed frame, as the export seam and the bubble's own state read it.
  return { rec, chart, controller: () => controller as unknown as ControllerCore };
}

describe('AX160 for a size format on an empty, inspectable bubble chart', () => {
  it('reading the throwing row of the drawn table reports AX160 to diagnostics, onDiagnostic and the note, once', () => {
    const seen: { code: string; field?: string }[] = [];
    const format = (v: number) => { if (v === 37) throw new Error('no 37'); return `${v} u`; };
    const data = [{ x: 0, y: null, s: 1 }, { x: 1, y: null, s: 37 }, { x: 2, y: null, s: 100 }];
    const { rec, chart, controller } = open({
      x: 'x', y: 'y', size: { field: 's', format }, data,
      onDiagnostic: (d: { code: string; field?: string }) => seen.push(d),
    });
    const drawn = controller().drawn!;
    // The empty state: nothing to draw (the interaction layer is given a state that is not ready), yet an
    // inspectable table with every row.
    expect(rec.committed?.ready ?? false).toBe(false);
    const table = drawn.reader.table!;
    expect(table.rowCount).toBe(3);
    expect(chart.diagnostics.filter(d => d.code === 'AX160')).toEqual([]);
    expect(seen.filter(d => d.code === 'AX160')).toEqual([]);
    const noteBefore = drawn.reader.note;

    const cells = Array.from({ length: table.rowCount }, (_, i) => table.row(i)!);
    // The author's text where it works, the default text (not nothing) where it threw.
    expect(cells.map(r => r.at(-1))).toEqual(['1 u', expect.stringContaining('37'), '100 u']);
    expect(cells[1]!.at(-1)).not.toBe('37 u');
    rec.frames();

    const ax160 = chart.diagnostics.filter(d => d.code === 'AX160');
    expect(ax160.map(d => d.field)).toEqual(['s']);
    expect(seen.filter(d => d.code === 'AX160').map(d => d.field)).toEqual(['s']);
    // Effect 'changed' (the size reads in a default format): the reader's note says so (spec F12).
    const note = controller().drawn!.reader.note;
    expect(note).not.toBeNull();
    expect(note).not.toBe(noteBefore);

    // Further failing reads (the same rows, again) report nothing new.
    table.row(1);
    rec.frames();
    expect(chart.diagnostics.filter(d => d.code === 'AX160').length).toBe(1);
    expect(seen.filter(d => d.code === 'AX160').length).toBe(1);
  });

  it('after destroy, a failing read reports nothing', () => {
    const seen: string[] = [];
    const format = (v: number) => { if (v === 37) throw new Error('no 37'); return `${v} u`; };
    const { rec, chart, controller } = open({
      x: 'x', y: 'y', size: { field: 's', format }, data: [{ x: 0, y: null, s: 37 }],
      onDiagnostic: (d: { code: string }) => seen.push(d.code),
    });
    const table = controller().drawn!.reader.table!;
    chart.destroy();
    table.row(0);
    rec.frames();
    expect(seen).not.toContain('AX160');
  });
});
