/**
 * W4 integration review 6 (blocker 1, first repro): a size format failure is owned by the revision whose frame
 * built the table, fixed when the table is made.
 *
 * Rule under test (spec AX160, F12; the controller reports against the accepted options): during the frame that
 * draws revision t, an x.tickFormat that reads revision s's table (still the visible one, before t's reader is
 * made) gets the default text for the failing row, but nothing reaches t's onDiagnostic, t's diagnostics or t's
 * note. t's own table still reports its first failing read, once.
 *
 * Fixture: every y missing except one row so the chart is ready and the x tick formatter runs in the frame; the
 * size format throws only for 37.
 */
import { describe, expect, it } from 'vitest';
import { controllerFor, type Controller } from '../../../src/core/controller';
import type { ControllerCore } from '../../../src/core/controller-types';
import { openBubbleChart } from '../../../src/spatial/bubble';
import { record } from '../../finance/host';

const format = (v: number) => { if (v === 37) throw new Error('no 37'); return `${v} u`; };
const data = [{ x: 0, y: 1, s: 1 }, { x: 1, y: 2, s: 37 }, { x: 2, y: 3, s: 100 }];
const ax160 = (list: readonly { code: string }[]) => list.filter(d => d.code === 'AX160').length;

describe('AX160 ownership is fixed when the table is built', () => {
  it('a tick formatter of the replacing frame that reads the previous table reports nothing to the new revision', () => {
    const rec = record({ width: 720, height: 420 });
    let controller: Controller | null = null;
    const toS: string[] = [], toT: string[] = [];
    const chart = openBubbleChart({ title: 'S', x: 'x', y: 'y', size: { field: 's', format }, data, onDiagnostic: (d: { code: string }) => toS.push(d.code) }, (c, input) => {
      controller = controllerFor(c, input, rec.host, null);
      return controller.handle;
    });
    rec.frames();
    const core = () => controller as unknown as ControllerCore;
    const old = core().drawn!.reader.table!;
    const readOld: (string | undefined)[] = [];
    const tickFormat = (v: unknown) => {
      // Inside t's frame: the accepted revision is t, the table read is still s's.
      if (core().inFrame) readOld.push(old.row(1)!.at(-1));
      return String(v);
    };
    chart.update({ title: 'T', x: { field: 'x', tickFormat }, onDiagnostic: (d: { code: string }) => toT.push(d.code) } as never);
    rec.frames();
    rec.frames();
    expect(readOld.length).toBeGreaterThan(0);
    expect(readOld[0]).toEqual(expect.stringContaining('37'));
    expect(readOld[0]).not.toBe('37 u');
    expect(ax160(chart.diagnostics)).toBe(0);
    expect(toT).not.toContain('AX160');
    expect(toS).not.toContain('AX160');
    expect(core().drawn!.reader.note ?? '').not.toMatch(/default format/i);

    // t's own table: its first failing read is reported, once.
    const active = core().drawn!.reader.table!;
    expect(active).not.toBe(old);
    active.row(1);
    rec.frames();
    expect(ax160(chart.diagnostics)).toBe(1);
    expect(toT.filter(c => c === 'AX160')).toHaveLength(1);
  });
});

describe('AX160 for a size format is withdrawn with the size options that made it', () => {
  const empty = [{ x: 0, y: null, s: 1 }, { x: 1, y: null, s: 37 }, { x: 2, y: null, s: 100 }];
  function openEmpty(onDiagnostic: (d: { code: string }) => void, tickFormat?: (v: unknown) => string) {
    const rec = record({ width: 720, height: 420 });
    let controller: Controller | null = null;
    const x = tickFormat ? { field: 'x', tickFormat } : 'x';
    const chart = openBubbleChart({ title: 'S', x, y: 'y', size: { field: 's', format }, data: empty, onDiagnostic } as never, (c, input) => {
      controller = controllerFor(c, input, rec.host, null);
      return controller.handle;
    });
    rec.frames();
    return { rec, chart, core: () => controller as unknown as ControllerCore };
  }

  it('an inspectable empty chart switched to a working size format drops the old finding from diagnostics and note', () => {
    const seen: string[] = [];
    const { rec, chart, core } = openEmpty(d => seen.push(d.code));
    core().drawn!.reader.table!.row(1);
    rec.frames();
    expect(ax160(chart.diagnostics)).toBe(1);
    const failingNote = core().drawn!.reader.note;
    chart.update({ size: { field: 's', format: (v: number) => `${v} t` } } as never);
    rec.frames();
    expect(core().drawn!.reader.table!.row(1)!.at(-1)).toBe('37 t');
    rec.frames();
    expect(ax160(chart.diagnostics)).toBe(0);
    expect(core().drawn!.reader.note).not.toBe(failingNote);
    expect(seen.filter(c => c === 'AX160')).toHaveLength(1);
  });

  it('an update that keeps the same size options keeps the finding, once', () => {
    const seen: string[] = [];
    const { rec, chart, core } = openEmpty(d => seen.push(d.code));
    core().drawn!.reader.table!.row(1);
    rec.frames();
    chart.update({ title: 'Again' });
    rec.frames();
    core().drawn!.reader.table!.row(1);
    rec.frames();
    expect(ax160(chart.diagnostics)).toBe(1);
    expect(seen.filter(c => c === 'AX160')).toHaveLength(1);
  });

  it('a stock tick format finding survives the size options being replaced', () => {
    const tick = (v: unknown) => { if (v === 1) throw new Error('no tick'); return String(v); };
    const { rec, chart, core } = openEmpty(() => {}, tick);
    core().drawn!.reader.table!.row(1);
    rec.frames();
    const before = chart.diagnostics.filter(d => d.code === 'AX160').map(d => (d as { field?: string }).field ?? JSON.stringify(d));
    chart.update({ size: { field: 's', format: (v: number) => `${v} t` } } as never);
    rec.frames(); rec.frames();
    const after = chart.diagnostics.filter(d => d.code === 'AX160').map(d => (d as { field?: string }).field ?? JSON.stringify(d));
    expect(after).toEqual(before.filter(f => !f.includes('"s"') && f !== 's'));
  });
});
