import { expect, it, vi } from 'vitest';
import { createController } from '../../src/core/controller';
import { exportCsv } from '../../src/export';
import { EXPORT, type ExportCapable, registry } from '../../src/export/contract';
import { record } from '../finance/host';

function chartAt(mount: object, value: number, querySelectorAll = () => []) {
  const figure = { nodeType: 1, parentNode: mount, querySelectorAll };
  const plot = { nodeType: 1, parentNode: figure, querySelectorAll, closest: (tag: string) => tag === 'figure' ? figure : null };
  const surface = { nodeType: 1, parentNode: plot, parentElement: plot, querySelectorAll };
  const rec = record();
  (rec.host.renderer as { element?: object }).element = surface;
  const handle = createController('line', { data: [{ day: 1, value }], x: 'day', y: 'value' }, rec.host).handle;
  return { handle, surface, figure, draw: rec.frames, seam: (handle as ExportCapable)[EXPORT] };
}

it('resolves registered ancestors without scanning marks and releases only the destroyed mount', () => {
  const scan = vi.fn(() => { throw new Error('subtree scan on a registered target'); });
  const mount = { nodeType: 1, querySelectorAll: scan };
  const older = chartAt(mount, 12, scan), newer = chartAt(mount, 34, scan);
  older.draw();
  newer.draw();
  const map = registry()!;
  try {
    expect(map.get(mount)).toBe(newer.seam);
    expect(exportCsv(older.surface)).toBe(exportCsv(older.handle));
    expect(exportCsv(newer.surface)).toBe(exportCsv(newer.handle));
    expect(exportCsv(mount)).toBe(exportCsv(newer.handle));
    expect(exportCsv(older.handle)).not.toBe(exportCsv(newer.handle));
    older.handle.destroy();
    expect(map.has(older.figure)).toBe(false);
    expect(map.get(mount)).toBe(newer.seam);
    expect(map.get(newer.figure)).toBe(newer.seam);
    expect(exportCsv(mount)).toBe(exportCsv(newer.handle));
    expect(scan).not.toHaveBeenCalled();
  } finally {
    older.handle.destroy();
    newer.handle.destroy();
  }
  expect(map.has(newer.figure)).toBe(false);
  expect(map.has(mount)).toBe(false);
});

it('requires a commit for an exact mount and skips pending figures when searching a container', () => {
  const pendingMount = { nodeType: 1, querySelectorAll: () => { throw new Error('scanned pending mount'); } };
  const pending = chartAt(pendingMount, 12), ready = chartAt({ nodeType: 1 }, 34);
  try {
    ready.draw();
    expect(() => exportCsv(pendingMount)).toThrow(/no committed data table/);
    const outer = { nodeType: 1, querySelectorAll: () => [pending.figure, ready.figure] };
    expect(exportCsv(outer)).toBe(exportCsv(ready.handle));
  } finally {
    pending.handle.destroy();
    ready.handle.destroy();
  }
});
