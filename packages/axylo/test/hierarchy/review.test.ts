/**
 * End-to-end handle regressions for the N9b review findings: activation by chart, Escape with a pointer
 * tooltip, positive leaf roots and empty drilled roots, revision-bound late findings and reentrant author
 * code, diagnostic delivery to a replacement handler and changed-value disclosure, and unique nested ids.
 */
import { describe, expect, it, vi } from 'vitest';
import { sunburst, treemap, type HierarchyOptions, type SunburstChart, type TreemapChart } from '../../src/hierarchy';
import { fakeTarget, type FakeElement } from './fake-dom';

const DATA = { label: 'Company', children: [
  { label: 'Engineering', children: [{ label: 'Platform', value: 30 }, { label: 'Product', value: 50 }] },
  { label: 'Sales', children: [{ label: 'EMEA', value: 12 }, { label: 'Americas', value: 8 }] },
] };
// Pre-order: Company0 Engineering1 Platform2 Product3 Sales4 EMEA5 Americas6.

function open<K extends typeof treemap | typeof sunburst>(kind: K, options: Partial<HierarchyOptions> = {}) {
  const { doc, target, host } = fakeTarget();
  const chart = kind(target, { title: 'Headcount', data: DATA, ...options } as HierarchyOptions) as TreemapChart & SunburstChart;
  const plot = host.find(e => e.attributes.get('class') === 'axylo-h-plot')!;
  const tip = host.find(e => e.attributes.get('class') === 'axylo-h-tip')!;
  const item = () => host.find(e => e.getAttribute('role') === 'treeitem');
  return { doc, host, chart, plot, tip, item };
}
const key = (plot: FakeElement, k: string) => plot.dispatch('keydown', { key: k });
const move = (plot: FakeElement, x: number, y: number) => plot.dispatch('pointermove', { clientX: x, clientY: y });
const click = (plot: FakeElement, x: number, y: number) => plot.dispatch('click', { clientX: x, clientY: y });
const crumbButton = (host: FakeElement, label: string) => host.find(e => e.tagName === 'BUTTON' && e.hasAttribute('data-node') && e.textContent === label)!;
// Sunburst on 600×400: center (300, 200), three rings of 66 px. Platform spans 0–108°, the leaf ring is 132–198 px.
const polar = (deg: number, r: number): [number, number] => [300 + Math.sin(deg * Math.PI / 180) * r, 200 - Math.cos(deg * Math.PI / 180) * r];

describe('1. activation by chart', () => {
  it('sunburst: a leaf arc is promoted to the center by click, the center click goes up, and a leaf root survives an id-preserving update', () => {
    const { chart, plot, doc } = open(sunburst);
    const drills: string[] = [];
    const selects: string[] = [];
    chart.on('drill', p => drills.push(p.label));
    chart.on('select', p => selects.push(p.label));
    click(plot, ...polar(54, 165));
    expect(chart.drilled.label).toBe('Platform');
    expect(chart.focused?.label).toBe('Platform');
    expect(drills).toEqual(['Platform']);
    expect(selects).toEqual([]);
    chart.update({ data: { ...DATA, children: [...DATA.children, { label: 'Ops', value: 5 }] } });
    expect(chart.drilled.id).toBe('Company/Engineering/Platform');
    // The center: one level up.
    plot.focus();
    click(plot, 300, 200);
    expect(chart.drilled.label).toBe('Engineering');
    expect(chart.focused?.label).toBe('Platform');
    expect(doc.activeElement).toBe(plot);
  });

  it('treemap: Enter on the drilled root goes into it; a leaf is selected, never opening its parent', () => {
    const { chart, plot } = open(treemap);
    const selects: string[] = [];
    chart.on('select', p => selects.push(p.label));
    plot.focus();
    key(plot, 'Enter');
    expect(chart.drilled.label).toBe('Company');
    expect(chart.focused?.label).toBe('Engineering');
    key(plot, 'ArrowDown');
    key(plot, 'Enter');
    expect(selects).toEqual(['Platform']);
    expect(chart.drilled.label).toBe('Company');
  });
});

describe('2. Escape with a pointer tooltip', () => {
  it.each([['treemap', treemap], ['sunburst', sunburst]] as const)('%s: Escape dismisses the pointer tooltip and ascends on the same key; at the top it only dismisses', (_n, kind) => {
    const { chart, plot, tip } = open(kind);
    chart.drill('Company/Engineering');
    plot.focus();
    key(plot, 'ArrowRight');
    expect(chart.focused?.label).toBe('Product');
    // Pointer over Platform (treemap: right column of the drilled plot; sunburst: its arc, now the ring 99–198 px over 0–135°).
    const at: [number, number] = kind === treemap ? [500, 200] : polar(60, 150);
    move(plot, ...at);
    expect(tip.hidden).toBe(false);
    expect(tip.getAttribute('data-node')).toBe('2');
    key(plot, 'Escape');
    expect(chart.focused?.label).toBe('Engineering');
    expect(chart.drilled.label).toBe('Engineering');
    expect(tip.hidden || tip.getAttribute('data-node') !== '2').toBe(true);
    // The pointer on the same datum keeps it dismissed.
    move(plot, at[0] + 1, at[1]);
    expect(tip.hidden || tip.getAttribute('data-node') !== '2').toBe(true);
    // Up from the drilled root: view and focus go to the parent.
    key(plot, 'Escape');
    expect(chart.drilled.label).toBe('Company');
    expect(chart.focused?.label).toBe('Company');
    // At the top: a pointer tooltip is dismissed and nothing else moves.
    move(plot, ...(kind === treemap ? [100, 200] as [number, number] : polar(54, 165)));
    expect(tip.hidden).toBe(false);
    key(plot, 'Escape');
    expect(tip.hidden).toBe(true);
    expect(chart.focused?.label).toBe('Company');
    expect(chart.drilled.label).toBe('Company');
  });
});

describe('4. leaf roots and empty drilled roots', () => {
  it('treemap: a positive one-node tree is drawn as one tile and reads 100%', () => {
    const { target, host } = fakeTarget();
    const chart = treemap(target, { title: 'T', data: { label: 'Only', value: 5 } });
    const tiles = host.all(e => e.tagName === 'rect' && e.hasAttribute('data-node'));
    expect(tiles.map(t => [t.getAttribute('data-node'), t.getAttribute('width'), t.getAttribute('height')])).toEqual([['0', '600', '400']]);
    expect(chart.table!.row(0)).toEqual(['Only', '0', '5', '—', '100%']);
    const plot = host.find(e => e.attributes.get('class') === 'axylo-h-plot')!;
    expect(plot.getAttribute('role')).toBe('tree');
    const hovers: (string | null)[] = [];
    chart.on('hover', p => hovers.push(p?.label ?? null));
    move(plot, 300, 200);
    expect(hovers).toEqual(['Only']);
  });

  it.each([['treemap', treemap], ['sunburst', sunburst]] as const)('%s: a drilled zero-valued branch shows an explicit empty state and still goes up', (_n, kind) => {
    const data = { label: 'R', children: [{ label: 'Z', children: [{ label: 'z1', value: 0 }] }, { label: 'P', value: 4 }] };
    const { chart, plot, host } = open(kind, { data });
    const empty = host.find(e => e.attributes.get('class') === 'axylo-h-empty')!;
    expect(empty.hidden).toBe(true);
    expect(chart.drill('R/Z')).toBe(true);
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toContain('Nothing to show in Z');
    expect(plot.getAttribute('role')).toBe('tree');
    // A click on the plot (the drilled root) goes up.
    click(plot, 300, 200);
    expect(chart.drilled.label).toBe('R');
    expect(empty.hidden).toBe(true);
    // And so do the keyboard and the breadcrumb.
    chart.drill('R/Z');
    plot.focus();
    key(plot, 'ArrowUp');
    key(plot, 'ArrowUp');
    expect(chart.drilled.label).toBe('R');
    chart.drill('R/Z');
    crumbButton(host, 'R').dispatch('click', {});
    expect(chart.drilled.label).toBe('R');
    expect(chart.focused?.label).toBe('Z');
  });
});

describe('5. revisions and reentrant author code', () => {
  const OLD = { label: 'Old', children: [{ label: 'Group', value: 7 }, { label: 'b', value: 5 }] };
  const NEW = { label: 'New', children: [{ label: 'Fresh', value: 3 }] };

  it('AX160 found while the focused node is read, with onDiagnostic updating the chart: item, table and handle all read the new revision', () => {
    let armed = false;
    let chart!: TreemapChart;
    const seen: string[] = [];
    const format = (v: number) => { if (armed && v === 7) throw new Error('seven'); return String(v); };
    const opened = open(treemap, {
      data: OLD, value: { format },
      onDiagnostic: d => { seen.push(d.code); if (d.code === 'AX160') chart.update({ data: NEW }); },
    });
    chart = opened.chart;
    armed = true;
    opened.plot.focus();
    key(opened.plot, 'ArrowDown');
    expect(seen).toEqual(['AX160']);
    expect(chart.drilled.label).toBe('New');
    expect(chart.table!.row(0)![0]).toBe('New');
    expect(opened.item()!.textContent.startsWith('New')).toBe(true);
    expect(opened.host.find(e => e.tagName === 'NAV')!.textContent).toBe('New');
    // The finding belonged to the replaced revision: not attached to the new one.
    expect(chart.diagnostics.map(d => d.code)).toEqual([]);
  });

  it('a read through an old unpaginated TableModel never delivers or attaches AX160 to the new revision', () => {
    let armed = false;
    const seen: string[] = [];
    const format = (v: number) => { if (armed && v === 7) throw new Error('seven'); return String(v); };
    const { chart, host } = open(treemap, { data: OLD, value: { format }, onDiagnostic: d => seen.push(d.code) });
    const old = chart.table!;
    chart.update({ data: NEW });
    armed = true;
    expect(old.row(1)).toEqual(['Old / Group', '1', '7', '58.3%', '58.3%']);
    expect(seen).toEqual([]);
    expect(chart.diagnostics).toEqual([]);
    expect(host.find(e => e.attributes.get('class') === 'axylo-h-note')!.hidden).toBe(true);
    // The current table still reports its own finding.
    chart.update({ data: OLD });
    chart.table!.row(1);
    expect(seen).toEqual(['AX160']);
    expect(chart.diagnostics.map(d => d.code)).toEqual(['AX160']);
  });

  it('a hover(null) listener that updates the chart: the superseded drill event is never delivered', () => {
    const { chart, plot } = open(treemap);
    const drills: string[] = [];
    let done = false;
    chart.on('hover', p => { if (p === null && !done) { done = true; chart.update({ data: NEW }); } });
    chart.on('drill', p => drills.push(p.id));
    move(plot, 100, 200);
    expect(chart.drill('Company/Engineering')).toBe(true);
    expect(done).toBe(true);
    expect(drills).toEqual([]);
    expect(chart.drilled.label).toBe('New');
  });

  it('a formatter that updates the chart during a draw: no stale DOM is written over the new revision', () => {
    let armed = false;
    let chart!: TreemapChart;
    const format = (v: number) => { if (armed && v === 7) { armed = false; chart.update({ data: NEW }); } return String(v); };
    const opened = open(treemap, { data: OLD, value: { format } });
    chart = opened.chart;
    armed = true;
    opened.plot.focus();
    key(opened.plot, 'ArrowDown');
    expect(chart.drilled.label).toBe('New');
    expect(opened.item()!.textContent.startsWith('New')).toBe(true);
    expect(opened.item()!.getAttribute('data-node')).toBe('0');
    expect(opened.host.find(e => e.tagName === 'NAV')!.textContent).toBe('New');
  });

  it('a formatter that destroys the chart during a draw: nothing more is written or delivered, and nothing throws', () => {
    let armed = false;
    let chart!: TreemapChart;
    const seen: string[] = [];
    const format = (v: number) => { if (armed && v === 7) { armed = false; chart.destroy(); } return String(v); };
    const opened = open(treemap, { data: OLD, value: { format }, onDiagnostic: d => seen.push(d.code) });
    chart = opened.chart;
    const hovers: unknown[] = [];
    chart.on('hover', p => hovers.push(p));
    armed = true;
    opened.plot.focus();
    expect(() => key(opened.plot, 'ArrowDown')).not.toThrow();
    expect(opened.host.children.length).toBe(0);
    expect(hovers).toEqual([]);
    expect(seen).toEqual([]);
    expect(chart.drill(null)).toBe(false);
  });

  it('a listener that destroys the chart mid-dispatch stops later listeners; payloads are frozen and taken before any listener ran', () => {
    const { chart, plot, host } = open(treemap);
    const later = vi.fn();
    const payloads: unknown[] = [];
    chart.on('select', p => { payloads.push(p); chart.destroy(); });
    chart.on('select', later);
    click(plot, 100, 200);
    expect(later).not.toHaveBeenCalled();
    expect(host.children.length).toBe(0);
    expect(Object.isFrozen(payloads[0])).toBe(true);
    expect(Object.isFrozen((payloads[0] as { path: unknown }).path)).toBe(true);
    // Nothing runs on a destroyed chart.
    expect(() => key(plot, 'ArrowDown')).not.toThrow();
  });

  it('an onDiagnostic that updates during create-time delivery leaves one coherent revision', () => {
    let chart: TreemapChart | undefined;
    const seen: string[] = [];
    const { target, host } = fakeTarget();
    chart = treemap(target, { data: OLD, onDiagnostic: d => { seen.push(d.code); } } as HierarchyOptions);
    expect(seen).toEqual(['AX140']);
    chart.update({ data: NEW, onDiagnostic: d => { seen.push(`2:${d.code}`); chart!.update({ title: 'Now titled' }); } });
    // The replacement handler gets the persisting AX140, then its update clears it.
    expect(seen).toEqual(['AX140', '2:AX140']);
    expect(chart.diagnostics).toEqual([]);
    expect(host.find(e => e.tagName === 'H3')!.textContent).toBe('Now titled');
  });
});

describe('6. delivery and disclosure', () => {
  const INVALID = [{ id: 'r', parent: null }, { id: 'x', parent: 'r', value: -5 }, { id: 'z', parent: 'r', value: 3 }];

  it('strict turned on with a new onDiagnostic: the new handler gets the committed AX190 and the call throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first: string[] = [];
    const { chart } = open(treemap, { data: INVALID, onDiagnostic: d => first.push(d.code) });
    expect(first).toEqual(['AX190']);
    const second: string[] = [];
    expect(() => chart.update({ strict: true, onDiagnostic: d => second.push(d.code) })).toThrow(/AX190/);
    expect(second).toEqual(['AX190']);
    expect(first).toEqual(['AX190']);
    // A non-strict replacement handler gets the persisting findings once.
    const third: string[] = [];
    chart.update({ onDiagnostic: d => third.push(d.code) });
    chart.update({ title: 'Again' });
    expect(third).toEqual(['AX190']);
    warn.mockRestore();
  });

  it('an overflowing total is disclosed in the figure note and the plot description', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { host, plot } = open(sunburst, { data: { label: 'R', children: [{ label: 'a', value: 1e308 }, { label: 'b', value: 1e308 }] } });
    warn.mockRestore();
    const note = host.find(e => e.attributes.get('class') === 'axylo-h-note')!;
    expect(note.hidden).toBe(false);
    expect(note.textContent).toBe('Totals shown as "more than" the largest number: 1.');
    expect(plot.getAttribute('aria-describedby')!.split(' ')).toContain(note.id);
  });

  it('a formatter fallback (AX160, found late) is disclosed in the figure note and the plot description', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { host, plot } = open(treemap, { value: { format: () => { throw new Error('no'); } } });
    warn.mockRestore();
    const note = host.find(e => e.attributes.get('class') === 'axylo-h-note')!;
    expect(note.hidden).toBe(false);
    expect(note.textContent).toBe('Values use the default number format: the value format failed.');
    expect(plot.getAttribute('aria-describedby')!.split(' ')).toContain(note.id);
  });
});

describe('7. unique nested ids through the handle', () => {
  const DUP = { label: 'R', children: [{ label: 'Ops', value: 1 }, { label: 'Ops', children: [{ label: 'x', value: 2 }, { label: 'y', value: 3 }] }] };

  it.each([['treemap', treemap], ['sunburst', sunburst]] as const)('%s: the second "Ops" (a branch) drills by its own id, and an update restores drill and focus by id', (_n, kind) => {
    const { chart, plot } = open(kind, { data: DUP });
    plot.focus();
    key(plot, 'ArrowDown');
    key(plot, 'ArrowRight');
    const focused = chart.focused!;
    expect(focused.label).toBe('Ops');
    expect(focused.id).not.toBe('R/Ops');
    expect(chart.drill(focused.id)).toBe(true);
    expect(chart.drilled.id).toBe(focused.id);
    key(plot, 'ArrowRight');
    expect(chart.focused?.label).toBe('y');
    chart.update({ data: { ...DUP, children: [...DUP.children, { label: 'Ops', value: 4 }] } });
    expect(chart.drilled.id).toBe(focused.id);
    expect(chart.focused?.label).toBe('y');
    expect(chart.focused?.path).toEqual(['R', 'Ops', 'y']);
  });
});
