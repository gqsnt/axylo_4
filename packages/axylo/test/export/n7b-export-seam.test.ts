/**
 * N7b: the `Symbol.for('axylo.export')` seam (export/contract.ts) and the closed-table CSV it gives
 * `exportCsv`, in Node. Charts run on recording hosts (no DOM); a DOM target is modelled by the few element
 * methods the exporter calls (closest, querySelector) around the renderer element the seam is put on.
 *
 * Expected values come from the spec: a line chart's table (A4) has the x column first, then one column per
 * series named by its label; every row of every page belongs to the export; the cells are the formatted text
 * the table shows (en-US numbers with grouping). Other expectations compare with the committed TableModel
 * itself, which is the definition of the table's content.
 */
import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { build, type PluginBuild } from 'esbuild';
import path from 'node:path';
import { exportCsv, parseCsv } from '../../src/export';
import { EXPORT, type ExportSeam } from '../../src/export/contract';
import type { TableModel } from '../../src/core/contracts';
import type { Composition } from '../../src/core/composition';
import { createController, staticControllerFor } from '../../src/core/controller';
import { cartesian } from '../../src/cartesian';
import { candlestick } from '../../src/finance';
import { record as recordCore } from '../core/host';
import { record as recordBare } from '../finance/host';

vi.mock('../../src/core/chart', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/chart')>();
  return {
    ...actual,
    createStaticChart: (composition: Composition, target: unknown, input: unknown) =>
      staticControllerFor(composition, input, target as never).handle,
  };
});

const seamOf = (handle: object): ExportSeam | undefined => (handle as { [EXPORT]?: ExportSeam })[EXPORT];

function lineRows(n: number): { day: number; value: number }[] {
  return Array.from({ length: n }, (_, i) => ({ day: i + 1, value: (i + 1) * 10 }));
}
const lineOptions = (n: number, extra: Record<string, unknown> = {}) => ({
  title: 'Daily value', data: lineRows(n), x: 'day', y: { field: 'value', label: 'Value' }, locale: 'en-US', ...extra,
});
/** The table text of row k of lineRows (spec A4): the x, then the value, both en-US formatted. */
const expectedLineRow = (k: number) => [(k + 1).toLocaleString('en-US'), ((k + 1) * 10).toLocaleString('en-US')];

interface FakeNode {
  nodeType: number; localName: string; parentNode: FakeNode | null; parentElement: FakeNode | null; host?: FakeNode; shadowRoot: FakeNode | null; children: FakeNode[];
  closest(selector: string): FakeNode | null; querySelectorAll(selector: string): FakeNode[]; querySelector(selector: string): FakeNode | null;
}
/** The few element methods the exporter and the registration read: ancestry, `closest('figure')`, descendants. */
function node(localName: string, parent: FakeNode | null = null, nodeType = 1): FakeNode {
  const n: FakeNode = {
    nodeType, localName, parentNode: parent, parentElement: parent?.nodeType === 1 ? parent : null, shadowRoot: null, children: [],
    closest(selector) { for (let at: FakeNode | null = n; at; at = at.parentNode) if (selector === at.localName) return at; return null; },
    querySelectorAll() { const out: FakeNode[] = []; const visit = (x: FakeNode) => { for (const c of x.children) { out.push(c); visit(c); } }; visit(n); return out; },
    querySelector() { return null; },
  };
  parent?.children.push(n);
  return n;
}
/** A mounted chart as the page has it: root > figure > stage > plot > surface (the renderer's element). */
function mount(root = node('div')): { root: FakeNode; figure: FakeNode; plot: FakeNode; surface: FakeNode } {
  const figure = node('figure', root), plot = node('div', node('div', figure)), surface = node('svg', plot);
  return { root, figure, plot, surface };
}

function allRows(table: TableModel): (readonly string[])[] {
  const rows: (readonly string[])[] = [];
  for (let i = 0; i < table.rowCount; i++) rows.push(table.row(i)!);
  return rows;
}

describe('N7b export seam on chart handles', () => {
  it('is a non-enumerable, read-only Symbol.for("axylo.export") property: a frozen capability apart from the sync seam', () => {
    const rec = recordCore('line', lineOptions(3));
    const handle = rec.controller.handle as object;
    const descriptor = Object.getOwnPropertyDescriptor(handle, Symbol.for('axylo.export'));
    expect(descriptor).toBeDefined();
    expect(descriptor!.enumerable).toBe(false);
    expect(descriptor!.writable).toBe(false);
    expect(descriptor!.configurable).toBe(false);
    expect(Object.keys(handle)).not.toContain(String(Symbol.for('axylo.export')));
    expect({ ...handle }).not.toHaveProperty(String(EXPORT));
    const seam = seamOf(handle)!;
    expect(Object.isFrozen(seam)).toBe(true);
    // Only the committed table and the figure's elements: no frame, no sync methods, nothing that writes.
    expect(Object.keys(Object.getOwnPropertyDescriptors(seam)).sort()).toEqual(['figure', 'plot', 'table']);
    expect(seam).not.toBe((handle as Record<symbol, unknown>)[Symbol.for('axylo.sync')]);
    // The sync seam keeps its own members (N6).
    expect(Object.keys((handle as Record<symbol, object>)[Symbol.for('axylo.sync')]!).sort()).toEqual(['drawn', 'onDestroy', 'point', 'sync']);
    // Nothing is committed before the first frame.
    expect(seam.table).toBeNull();
    expect(() => exportCsv(handle)).toThrow(/no committed data table/);
    rec.frames();
    expect(seam.table!.rowCount).toBe(3);
    expect(seam.table).toBe((handle as Record<symbol, { drawn: { reader: { table: unknown } } }>)[Symbol.for('axylo.sync')]!.drawn.reader.table);
  });

  it('exports every row of every page (400 rows, 4 pages of 100) with exact headers and formatted cells', () => {
    const rec = recordCore('line', lineOptions(400));
    rec.frames();
    const handle = rec.controller.handle as object;
    const table = seamOf(handle)!.table!;
    expect(Math.ceil(table.rowCount / table.pageSize)).toBeGreaterThanOrEqual(4);
    const parsed = parseCsv(exportCsv(handle));
    expect(parsed).toHaveLength(401);
    expect(parsed[0]).toEqual(['day', 'Value']);
    for (let k = 0; k < 400; k++) expect(parsed[k + 1]).toEqual(expectedLineRow(k));
  });

  it('for any row count, the CSV holds the header and exactly that many rows, in order (property)', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 260 }), n => {
      const rec = recordCore('line', lineOptions(n));
      rec.frames();
      const parsed = parseCsv(exportCsv(rec.controller.handle as object, { lineEnding: '\n' }));
      expect(parsed).toHaveLength(n + 1);
      expect(parsed[n]).toEqual(expectedLineRow(n - 1));
      rec.controller.handle.destroy();
    }), { numRuns: 25 });
  });

  it('keeps committed state: a pending update and a strict rejection do not change the export', () => {
    const rec = recordCore('line', lineOptions(5));
    rec.frames();
    const handle = rec.controller.handle;
    const before = exportCsv(handle);
    handle.update({ data: lineRows(7) });
    // Accepted but not drawn yet: the export is still what is on screen.
    expect(exportCsv(handle)).toBe(before);
    rec.frames();
    const after = exportCsv(handle);
    expect(parseCsv(after)).toHaveLength(8);
    expect(() => handle.update({ strict: true, x: 'missing-field' })).toThrow();
    rec.frames();
    expect(exportCsv(handle)).toBe(after);
  });

  it('is explicit about charts without a table (compact, table: false) and destroyed charts', () => {
    for (const extra of [{ compact: true }, { table: false }]) {
      const rec = recordCore('line', lineOptions(5, extra));
      rec.frames();
      expect(seamOf(rec.controller.handle)!.table).toBeNull();
      expect(() => exportCsv(rec.controller.handle)).toThrow(/no committed data table \(compact, table: false/);
    }
    const rec = recordCore('line', lineOptions(5));
    rec.frames();
    const handle = rec.controller.handle;
    handle.destroy();
    expect(seamOf(handle)!.table).toBeNull();
    expect(() => exportCsv(handle)).toThrow(/no committed data table/);
  });

  it('registers the figure and its mount element in the shared registry: a mounted target gives the same bytes as the handle', () => {
    const rec = recordBare();
    const dom = mount();
    (rec.host.renderer as { element?: object }).element = dom.surface;
    const handle = createController('line', lineOptions(230), rec.host).handle;
    const registry = (globalThis as Record<symbol, WeakMap<object, ExportSeam>>)[EXPORT]!;
    expect(registry).toBeInstanceOf(WeakMap);
    expect(registry.get(dom.figure)).toBe(seamOf(handle));
    expect(registry.get(dom.root)).toBe(seamOf(handle));
    // Before the first frame nothing is committed, the figure neither.
    expect(seamOf(handle)!.figure).toBeNull();
    rec.frames();
    expect(seamOf(handle)!.figure).toBe(dom.figure);
    expect(seamOf(handle)!.plot).toBe(dom.plot);
    const viaRoot = exportCsv(dom.root as unknown as HTMLElement);
    expect(viaRoot).toBe(exportCsv(handle));
    // From inside the figure (any descendant) and from an element around the root.
    expect(exportCsv(dom.surface as unknown as HTMLElement)).toBe(viaRoot);
    const outer = node('section');
    outer.children.push(dom.root);
    expect(exportCsv(outer as unknown as HTMLElement)).toBe(viaRoot);
    expect(parseCsv(viaRoot)).toHaveLength(231);
  });

  it('shares one formatting of each row between the table and every export (stateful formatter)', () => {
    let calls = 0;
    const rec = recordCore('line', lineOptions(230, { y: { field: 'value', label: 'Value', format: (v: number) => `${v}:${calls++}` } }));
    rec.frames();
    const handle = rec.controller.handle;
    const table = seamOf(handle)!.table!;
    // The reader opens the table on page 1: the DOM table reads these rows from the same committed model.
    const shown = Array.from({ length: 50 }, (_, i) => table.row(i));
    const open = exportCsv(handle);
    const closed = exportCsv(handle);
    expect(closed).toBe(open);
    const parsed = parseCsv(open);
    expect(parsed).toHaveLength(231);
    for (let k = 0; k < 50; k++) expect(parsed[k + 1]).toEqual(shown[k]);
    // Every row's value carries its own call number: no row was formatted twice.
    expect(new Set(parsed.slice(1).map(r => r[1]!.split(':')[1])).size).toBe(230);
  });

  it('stops with an error when a formatter destroys the chart or a new table is committed during the export', () => {
    let calls = 0, destroyAt = Infinity;
    const rec = recordCore('line', lineOptions(20, { y: { field: 'value', label: 'Value', format: (v: number) => { if (++calls === destroyAt) rec.controller.handle.destroy(); return String(v); } } }));
    rec.frames();
    const handle = rec.controller.handle;
    calls = 0;
    destroyAt = 2;
    expect(() => exportCsv(handle)).toThrow(/destroyed or drew another table/);
    // No row was formatted after the one that destroyed the chart.
    expect(calls).toBe(2);
  });
});

describe('N7b export seam lookup across shadow roots and remounts', () => {
  it('finds a chart inside an open shadow root of the target, and a remounted chart replaces a destroyed one', () => {
    const first = recordBare();
    const shadowHost = node('div');
    const shadow = shadowHost.shadowRoot = node('#shadow', null, 11);
    shadow.host = shadowHost;
    const dom = mount(node('div', shadow));
    (first.host.renderer as { element?: object }).element = dom.surface;
    const oldChart = createController('line', lineOptions(3), first.host).handle;
    first.frames();
    expect(parseCsv(exportCsv(shadowHost as unknown as HTMLElement))).toHaveLength(4);
    // From inside the shadow tree, the lookup climbs through the shadow root to its host's registered descendants.
    expect(parseCsv(exportCsv(dom.surface as unknown as HTMLElement))).toHaveLength(4);

    oldChart.destroy();
    // The destroyed chart's entry is passed over: no stale rows, an explicit error.
    expect(() => exportCsv(dom.root as unknown as HTMLElement)).toThrow(/no rendered <table>/);
    const second = recordBare();
    const again = mount(dom.root);
    (second.host.renderer as { element?: object }).element = again.surface;
    const newChart = createController('line', lineOptions(6), second.host).handle;
    second.frames();
    expect(seamOf(newChart)).not.toBe(seamOf(oldChart));
    expect(exportCsv(dom.root as unknown as HTMLElement)).toBe(exportCsv(newChart));
    expect(parseCsv(exportCsv(newChart))).toHaveLength(7);
  });
});

describe('N7b export seam on wrapper handles (cartesian, finance)', () => {
  it('cartesian forwards the inner seam, non-enumerable, and exports all rows by handle and by target', () => {
    const rec = recordBare({ width: 640, height: 360 });
    const dom = mount();
    (rec.host.renderer as { element?: object }).element = dom.surface;
    const rows = Array.from({ length: 250 }, (_, i) => ({ t: i + 1, a: i, b: 1000 + i }));
    const chart = cartesian(rec.host as never, {
      title: 'Two axes', data: rows, x: 't', locale: 'en-US',
      axes: { left: { position: 'left', label: 'A' }, right: { position: 'right', label: 'B' } },
      layers: [{ type: 'bar', y: 'a', yAxis: 'left' }, { type: 'line', y: 'b', yAxis: 'right' }],
    });
    rec.frames();
    const descriptor = Object.getOwnPropertyDescriptor(chart, EXPORT)!;
    expect(descriptor.enumerable).toBe(false);
    expect(descriptor.writable).toBe(false);
    const seam = seamOf(chart)!;
    // Both seams are forwarded, each the inner handle's own, and they stay apart.
    expect((chart as { [k: symbol]: unknown })[Symbol.for('axylo.sync')]).not.toBe(seam);
    expect(Object.getOwnPropertyDescriptor(chart, Symbol.for('axylo.sync'))!.enumerable).toBe(false);
    const table = seam.table!;
    expect(table.rowCount).toBe(250);
    const csv = exportCsv(chart);
    expect(exportCsv(dom.root as unknown as HTMLElement)).toBe(csv);
    const parsed = parseCsv(csv);
    expect(parsed).toHaveLength(251);
    expect(parsed[0]).toEqual([...table.headers]);
    expect(parsed.slice(1)).toEqual(allRows(table).map(r => [...r]));
    // Wrapper methods are the inner handle's bound methods: they still reach this chart.
    chart.zoom(null);
    chart.destroy();
    expect(seam.table).toBeNull();
    expect(seam.figure).toBeNull();
  });

  it('finance forwards the seam and exports 200 rows over 4 pages of 50, identical by handle and by target', () => {
    const rec = recordBare();
    const dom = mount();
    (rec.host.renderer as { element?: object }).element = dom.surface;
    const day = Date.UTC(2026, 0, 1);
    const rows = Array.from({ length: 200 }, (_, i) => ({
      d: new Date(day + i * 86_400_000), o: 100 + i, h: 103 + i, l: 98 + i, c: i % 2 ? 101 + i : 99 + i, v: 1000 + i,
    }));
    const chart = candlestick(rec.host as never, { title: 'OHLC', data: rows, x: 'd', open: 'o', high: 'h', low: 'l', close: 'c', volume: 'v' });
    rec.frames();
    expect(Object.getOwnPropertyDescriptor(chart, EXPORT)!.enumerable).toBe(false);
    const table = seamOf(chart)!.table!;
    expect(table.rowCount).toBe(200);
    expect(table.pageSize).toBe(50);
    const csv = exportCsv(chart);
    expect(exportCsv(dom.root as unknown as HTMLElement)).toBe(csv);
    const parsed = parseCsv(csv);
    expect(parsed).toHaveLength(201);
    expect(parsed[0]).toEqual([...table.headers]);
    expect(parsed.slice(1)).toEqual(allRows(table).map(r => [...r]));
    chart.destroy();
  });
});

describe('N7b CSV sources keep their behaviour', () => {
  it('TableModel and options (headers, delimiter, BOM, no header) still apply to chart exports', () => {
    const rec = recordCore('line', lineOptions(2));
    rec.frames();
    const csv = exportCsv(rec.controller.handle, { delimiter: ';', lineEnding: '\n', bom: true, headers: ['D', 'V'] });
    expect(csv).toBe('﻿D;V\n1;10\n2;20');
    expect(exportCsv(rec.controller.handle, { includeHeader: false, lineEnding: '\n' })).toBe('1,10\n2,20');
  });

  it('rejects an unsupported source with an explicit error', () => {
    expect(() => exportCsv({} as never)).toThrow(/unsupported CSV source/);
    expect(() => exportCsv('#chart')).toThrow(/require a browser DOM/);
  });
});

describe('N7b bare imports have no side effects (built entries, hints ignored)', () => {
  // The packed test (tests/dist/subpaths.test.ts) bundles `import 'axylo/<entry>'` against the built file:
  // the same two steps here, from source, without writing anything.
  const src = path.resolve(import.meta.dirname, '../../src');
  const css = { name: 'css', setup(b: PluginBuild) { b.onLoad({ filter: /[\\/]theme[\\/]css\.ts$/ }, () => ({ contents: 'export const AXYLO_CSS = "";', loader: 'js' as const })); } };
  for (const entry of ['export', 'finance', 'cartesian', 'index', 'static']) {
    it(`import '${entry}' bundles to 0 raw bytes with ignoreAnnotations`, async () => {
      const built = await build({
        entryPoints: [path.join(src, `${entry}.ts`)], bundle: true, minify: true, format: 'esm', target: 'es2022', write: false,
        logLevel: 'silent', legalComments: 'none', define: { __DEV__: 'false', __BENCH__: 'false' }, plugins: [css],
      });
      const text = built.outputFiles[0]!.text;
      const r = await build({
        stdin: { contents: "import 'built-entry';", resolveDir: src, loader: 'js' },
        bundle: true, minify: true, format: 'esm', target: 'es2022', write: false, logLevel: 'silent', ignoreAnnotations: true,
        plugins: [{ name: 'entry', setup(b) {
          b.onResolve({ filter: /^built-entry$/ }, () => ({ path: 'built-entry', namespace: 'built' }));
          b.onLoad({ filter: /.*/, namespace: 'built' }, () => ({ contents: text, loader: 'js' }));
        } }],
      });
      expect(r.outputFiles[0]!.text).toBe('');
    });
  }
});
