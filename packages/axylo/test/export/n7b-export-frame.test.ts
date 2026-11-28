/**
 * N7b: an export called while the chart draws a frame must not mix two revisions. The controller writes the
 * next caption, legend and note to the live figure (#arrange) before it draws the next marks and commits, and
 * an author formatter can run in between: a change in how many axis labels the layout hides rebuilds the
 * reader after #arrange, and the reference line's text calls `y.format` (reader/index.ts, referenceText).
 * The contract (export/contract.ts) says the seam reads committed state only, so in that interval the plot is
 * absent and a whole-figure export fails, while the CSV is the committed table.
 *
 * The test records the host's writes to observe the interval: figure.update without a renderer draw after
 * it means the figure shows staged chrome over the previous marks. It asserts the interval was reached,
 * so it cannot pass vacuously.
 */
import { expect, it } from 'vitest';
import { createController } from '../../src/core/controller';
import { exportCsv, exportSvg, parseCsv } from '../../src/export';
import { EXPORT, type ExportCapable } from '../../src/export/contract';
import type { FigureModel } from '../../src/dom/figure';
import { record } from '../finance/host';

interface FakeNode {
  nodeType: number; localName: string; parentNode: FakeNode | null; parentElement: FakeNode | null; shadowRoot: null; children: FakeNode[];
  ownerDocument: { defaultView: object; URL: string };
  closest(selector: string): FakeNode | null; querySelectorAll(selector: string): FakeNode[]; querySelector(selector: string): FakeNode | null;
}
const doc = { defaultView: {}, URL: 'about:blank' };
/** The element methods the lookup and exportSvg read before they reach the seam: ancestry, descendants, the window. */
function node(localName: string, parent: FakeNode | null = null): FakeNode {
  const n: FakeNode = {
    nodeType: 1, localName, parentNode: parent, parentElement: parent, shadowRoot: null, children: [], ownerDocument: doc,
    closest(selector) { for (let at: FakeNode | null = n; at; at = at.parentNode) if (selector === at.localName) return at; return null; },
    querySelectorAll() { const out: FakeNode[] = []; const visit = (x: FakeNode) => { for (const c of x.children) { out.push(c); visit(c); } }; visit(n); return out; },
    // A live <svg> exists in the container: a lookup that missed the chart would read it as a plain element.
    querySelector(selector) { return selector === 'svg' ? surface : null; },
  };
  parent?.children.push(n);
  return n;
}
const outer = node('section');
const root = node('div', outer);
const figure = node('figure', root);
const plot = node('div', node('div', figure));
const surface = node('svg', plot);

const rows = (n: number, width: number) => Array.from({ length: n }, (_, i) => ({ k: `${'C'.repeat(width)}${i}`, v: i + 1 }));

it('a formatter running while the figure shows staged chrome over the previous marks cannot export a mixed figure', () => {
  const rec = record();
  (rec.host.renderer as { element?: object }).element = surface;
  // Staged: the figure was written for the frame and the marks for it are not drawn yet.
  let staged: FigureModel | null = null;
  const update = rec.host.figure.update, draw = rec.host.renderer.draw;
  (rec.host.figure as { update: typeof update }).update = model => { staged = model; return update(model); };
  (rec.host.renderer as { draw: typeof draw }).draw = (...args) => { staged = null; draw(...args); };

  let armed = false;
  const inside: { subtitle: string | null; plot: unknown; figure: unknown; csv: string; svg: string[] }[] = [];
  const format = (v: number) => {
    if (armed && staged) {
      const seam = (handle as ExportCapable)[EXPORT]!;
      const svg: string[] = [];
      // The exact mount, an element inside the figure (ancestor lookup) and a container around it (descendant lookup).
      for (const target of [root, surface, outer]) {
        try { svg.push(`ok ${exportSvg(target as unknown as HTMLElement).length}`); } catch (e) { svg.push((e as Error).message); }
      }
      inside.push({ subtitle: (staged as FigureModel).subtitle, plot: seam.plot, figure: seam.figure, csv: exportCsv(handle), svg });
    }
    return String(v);
  };
  const handle = createController('bar', {
    title: 'T', subtitle: 'A', data: rows(4, 1), x: 'k', y: { field: 'v', format }, reference: [{ y: 2, label: 'Two' }], locale: 'en-US',
  }, rec.host).handle;
  rec.frames();
  const seam = (handle as ExportCapable)[EXPORT]!;
  expect(seam.plot).toBe(plot);
  const committed = exportCsv(handle);
  expect(parseCsv(committed)).toHaveLength(5);

  // Outside a frame, an accepted update that is not drawn yet leaves the committed figure exportable.
  armed = true;
  handle.update({ subtitle: 'B', data: rows(60, 30) });
  expect(seam.plot).toBe(plot);
  expect(seam.figure).toBe(figure);
  expect(exportCsv(handle)).toBe(committed);

  rec.frames();
  armed = false;
  // The interval was reached: the formatter ran with subtitle 'B' written to the figure and the 4-row marks still drawn.
  expect(inside.length).toBeGreaterThan(0);
  for (const seen of inside) {
    expect(seen.subtitle).toBe('B');
    expect(seen.plot).toBeNull();
    expect(seen.figure).toBe(figure);
    // The committed table, not the pending one: one revision, the drawn one.
    expect(seen.csv).toBe(committed);
    for (const result of seen.svg) expect(result).toBe('axylo/export: no rendered <svg> chart surface.');
  }
  // Once the frame has committed, the new revision is exported whole.
  expect(seam.plot).toBe(plot);
  expect(parseCsv(exportCsv(handle))).toHaveLength(61);
  handle.destroy();
});
