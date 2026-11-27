/**
 * The public handles of `axylo/hierarchy` on a minimal DOM: strict rollback (spec 3.5, plan 1.5) through
 * `treemap` and `sunburst`, drill-down and the breadcrumb, hierarchical keyboard focus, and that tooltip,
 * focused item, breadcrumb and table read the same path, value and shares.
 */
import { describe, expect, it, vi } from 'vitest';
import { sunburst, treemap, type HierarchyOptions, type TreemapChart } from '../../src/hierarchy';
import { fakeTarget, type FakeElement } from './fake-dom';

const DATA = { label: 'Company', children: [
  { label: 'Engineering', children: [{ label: 'Platform', value: 30 }, { label: 'Product', value: 50 }] },
  { label: 'Sales', children: [{ label: 'EMEA', value: 12 }, { label: 'Americas', value: 8 }] },
] };
// Pre-order: Company0 Engineering1 Platform2 Product3 Sales4 EMEA5 Americas6. Total 100.
// One negative leaf (AX190) and one orphan (AX191); 'z' keeps a positive total, so no AX192.
const INVALID = [{ id: 'r', parent: null }, { id: 'x', parent: 'r', value: -5 }, { id: 'y', parent: 'nowhere', value: 2 }, { id: 'z', parent: 'r', value: 3 }];

const KINDS = [['treemap', treemap], ['sunburst', sunburst]] as const;

function open(kind: typeof treemap, options: Partial<HierarchyOptions> = {}) {
  const { doc, target, host } = fakeTarget();
  const chart = kind(target, { title: 'Headcount', data: DATA, ...options } as HierarchyOptions);
  const plot = host.find(e => e.attributes.get('class') === 'axylo-h-plot')!;
  return { doc, host, chart, plot };
}
const tableRows = (chart: TreemapChart) => Array.from({ length: chart.table!.rowCount }, (_, r) => chart.table!.row(r));
const key = (plot: FakeElement, k: string) => plot.dispatch('keydown', { key: k });
const crumbs = (host: FakeElement) => host.find(e => e.tagName === 'NAV')!.all(e => e.hasAttribute('data-node')).map(e => e.textContent);

describe.each(KINDS)('%s handle', (_name, kind) => {
  it('mounts a figure with a named breadcrumb nav, tree plot, table control and no DOM before create', () => {
    const { host, chart, plot } = open(kind);
    const nav = host.find(e => e.tagName === 'NAV')!;
    expect(nav.getAttribute('aria-label')).toBe('Hierarchy path');
    expect(crumbs(host)).toEqual(['Company']);
    expect(plot.getAttribute('role')).toBe('tree');
    expect(plot.getAttribute('tabindex')).toBe('0');
    expect(host.find(e => e.getAttribute('role') === 'treeitem')).not.toBeNull();
    expect(chart.element.tagName).toBe('FIGURE');
    expect(chart.diagnostics).toEqual([]);
    expect(host.find(e => e.attributes.get('class') === 'axylo-h-note')!.hidden).toBe(true);
    expect(Number(chart.element.getAttribute('data-labelled'))).toBeGreaterThan(0);
    chart.destroy();
    expect(host.children.length).toBe(0);
  });

  it('a strict update that finds AX190/AX191 throws and keeps data, diagnostics, drill, focus, table and breadcrumb', () => {
    const seen: string[] = [];
    const { host, chart, plot } = open(kind, { strict: true, onDiagnostic: d => seen.push(d.code) });
    expect(chart.drill('Company/Sales')).toBe(true);
    key(plot, 'ArrowRight');
    // The open table is reader state too: it stays open, with the committed rows.
    host.find(e => e.tagName === 'BUTTON' && e.getAttribute('aria-expanded') !== null)!.dispatch('click', {});
    const shownRows = () => host.find(e => e.tagName === 'TBODY')!.children.map(tr => tr.children.map(c => c.textContent));
    const shownBefore = shownRows();
    const before = {
      rows: tableRows(chart), crumbs: crumbs(host), drilled: chart.drilled, focused: chart.focused,
      diagnostics: chart.diagnostics, item: host.find(e => e.getAttribute('role') === 'treeitem')!.textContent,
    };
    expect(before.drilled.id).toBe('Company/Sales');
    expect(before.focused?.label).toBe('Americas');
    expect(() => chart.update({ data: INVALID } as never)).toThrow(/AX19[01]/);
    expect(seen.sort()).toEqual(['AX190', 'AX191']);
    expect(tableRows(chart)).toEqual(before.rows);
    expect(crumbs(host)).toEqual(before.crumbs);
    expect(chart.drilled).toEqual(before.drilled);
    expect(chart.focused).toEqual(before.focused);
    expect(chart.diagnostics).toEqual(before.diagnostics);
    expect(host.find(e => e.getAttribute('role') === 'treeitem')!.textContent).toBe(before.item);
    expect(host.find(e => e.getAttribute('role') === 'region')!.hidden).toBe(false);
    expect(shownRows()).toEqual(shownBefore);
    // A valid update afterwards commits, and keeps the drilled node by id.
    chart.update({ data: { ...DATA, children: [...DATA.children, { label: 'Ops', value: 10 }] } });
    expect(chart.table!.rowCount).toBe(8);
    expect(chart.drilled.id).toBe('Company/Sales');
  });

  it('strict create with a finding throws and mounts nothing; non-strict reports and commits', () => {
    const { target, host } = fakeTarget();
    expect(() => kind(target, { title: 'T', data: INVALID, strict: true } as never)).toThrow(/AX19/);
    expect(host.children.length).toBe(0);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loose = kind(target, { title: 'T', data: INVALID } as never);
    expect(loose.diagnostics.map(d => d.code).sort()).toEqual(['AX190', 'AX191']);
    // The reader's note (spec F12): one invalid leaf and one orphan were left out.
    const note = host.find(e => e.attributes.get('class') === 'axylo-h-note')!;
    expect(note.hidden).toBe(false);
    expect(note.textContent).toBe('Values not shown: 2.');
    warn.mockRestore();
  });

  it('an update rejected in strict mode, then strict turned off, commits the same data with its diagnostics', () => {
    const { chart } = open(kind, { strict: true });
    expect(() => chart.update({ data: [] as never })).toThrow(/AX192/);
    expect(chart.table!.rowCount).toBe(7);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    chart.update({ data: [] as never, strict: false });
    warn.mockRestore();
    expect(chart.diagnostics.map(d => d.code)).toEqual(['AX192']);
    expect(chart.focused).toBeNull();
  });

  it('keyboard: Down, Right, Home/End, Enter drills, Up/Escape ascend with focus continuity', () => {
    const { host, chart, plot } = open(kind);
    const drills: string[] = [];
    chart.on('drill', p => drills.push(p.id));
    plot.focus();
    expect(chart.focused?.label).toBe('Company');
    key(plot, 'ArrowDown');
    expect(chart.focused?.label).toBe('Engineering');
    key(plot, 'ArrowRight');
    expect(chart.focused?.label).toBe('Sales');
    key(plot, 'Home');
    expect(chart.focused?.label).toBe('Engineering');
    key(plot, 'End');
    expect(chart.focused?.label).toBe('Sales');
    key(plot, 'Enter');
    expect(chart.drilled.label).toBe('Sales');
    expect(chart.focused?.label).toBe('EMEA');
    expect(crumbs(host)).toEqual(['Company', 'Sales']);
    expect(host.find(e => e.getAttribute('aria-current') === 'location')!.textContent).toBe('Sales');
    key(plot, 'ArrowUp');
    expect(chart.focused?.label).toBe('Sales');
    // Up from the drilled root: the view and focus both go to the parent.
    key(plot, 'Escape');
    expect(chart.drilled.label).toBe('Company');
    expect(chart.focused?.label).toBe('Company');
    key(plot, 'ArrowDown');
    key(plot, 'ArrowRight');
    expect(chart.focused?.label).toBe('Sales');
    expect(drills).toEqual(['Company/Sales', 'Company']);
    const item = host.find(e => e.getAttribute('role') === 'treeitem')!;
    expect(item.getAttribute('aria-level')).toBe('2');
    expect(item.getAttribute('aria-posinset')).toBe('2');
    expect(item.getAttribute('aria-setsize')).toBe('2');
    expect(item.getAttribute('aria-expanded')).toBe('false');
    // The focus ring is drawn.
    expect(host.find(e => e.getAttribute('data-outline') === 'focus')).not.toBeNull();
  });

  it('Enter on a leaf selects it (treemap) or promotes it to the center (sunburst); the breadcrumb button returns to an ancestor', () => {
    const { host, chart, plot } = open(kind);
    const selected: string[] = [];
    chart.on('select', p => selected.push(p.label));
    chart.drill('Company/Engineering');
    plot.focus();
    key(plot, 'Enter');
    if (kind === treemap) {
      expect(selected).toEqual(['Platform']);
      expect(chart.drilled.label).toBe('Engineering');
    } else {
      expect(selected).toEqual([]);
      expect(chart.drilled.label).toBe('Platform');
      expect(chart.focused?.label).toBe('Platform');
      // Enter on the centered node goes up again, focus staying on it.
      key(plot, 'Enter');
      expect(chart.drilled.label).toBe('Engineering');
      expect(chart.focused?.label).toBe('Platform');
    }
    const button = host.find(e => e.tagName === 'BUTTON' && e.getAttribute('data-node') === '0')!;
    button.dispatch('click', {});
    expect(chart.drilled.label).toBe('Company');
    expect(chart.focused?.label).toBe('Engineering');
    expect(chart.drill('nope')).toBe(false);
    // A treemap drills into branches only; a sunburst centers a leaf too.
    expect(chart.drill('Company/Engineering/Platform')).toBe(kind === sunburst);
  });

  it('tooltip, focused item, breadcrumb and table read the same path, value and shares', () => {
    const { host, chart, plot } = open(kind, { value: { unit: 'people' } });
    chart.drill('Company/Engineering');
    plot.focus();
    key(plot, 'ArrowRight');
    const focused = chart.focused!;
    expect(focused.path).toEqual(['Company', 'Engineering', 'Product']);
    const row = tableRows(chart)[3]!;
    expect(row).toEqual(['Company / Engineering / Product', '2', '50 people', '62.5%', '50%']);
    const tip = host.find(e => e.attributes.get('class') === 'axylo-h-tip')!;
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toContain('Company / Engineering / Product');
    expect(tip.textContent).toContain('50 people');
    expect(tip.textContent).toContain('62.5%');
    expect(tip.textContent).toContain('50%');
    const item = host.find(e => e.getAttribute('role') === 'treeitem')!;
    expect(item.textContent).toBe('Company / Engineering / Product: 50 people. % of Parent 62.5%, % of Root 50%.');
    const crumb = chart.breadcrumb.at(-1)!;
    expect([crumb.path, crumb.value, crumb.shareOfRoot]).toEqual(['Company / Engineering', '80 people', '80%']);
    // The table control shows the same committed rows.
    const toggle = host.find(e => e.tagName === 'BUTTON' && e.getAttribute('aria-expanded') !== null)!;
    toggle.dispatch('click', {});
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const shown = host.find(e => e.tagName === 'TBODY')!.children.map(tr => tr.children.map(c => c.textContent));
    expect(shown).toEqual(tableRows(chart));
    const headers = host.find(e => e.tagName === 'THEAD')!.all(e => e.tagName === 'TH').map(e => e.textContent);
    expect(headers).toEqual(['Path', 'Depth', 'Value', '% of Parent', '% of Root']);
  });

  it('table: false hides the control and the handle reports no table', () => {
    const { chart, host } = open(kind, { table: false });
    expect(chart.table).toBeNull();
    expect(host.find(e => e.attributes.get('class') === 'axylo-h-controls')!.hidden).toBe(true);
  });

  it('a value formatter that throws is AX160 (presentation): reported, never thrown, even when strict', () => {
    const seen: string[] = [];
    const { chart } = open(kind, { strict: true, onDiagnostic: d => seen.push(d.code), value: { format: () => { throw new Error('no'); } } });
    expect(seen).toEqual(['AX160']);
    expect(chart.diagnostics.map(d => d.code)).toEqual(['AX160']);
    expect(chart.table!.row(0)![2]).toBe('100');
  });
});

describe('late findings', () => {
  it('AX160 found while an updated chart writes a table cell reaches onDiagnostic once, as presentation', () => {
    const seen: string[] = [];
    const format = (v: number) => { if (v === 7) throw new Error('seven'); return String(v); };
    const { host, chart } = open(treemap, { onDiagnostic: d => seen.push(d.code), value: { format } });
    chart.update({ data: { label: 'R', children: [{ label: 'a', value: 7 }, { label: 'b', value: 5 }] } });
    expect(seen).toEqual([]);
    host.find(e => e.tagName === 'BUTTON' && e.getAttribute('aria-expanded') !== null)!.dispatch('click', {});
    expect(seen).toEqual(['AX160']);
    expect(chart.diagnostics.map(d => d.code)).toEqual(['AX160']);
    // The default format is used for the cell.
    expect(chart.table!.row(1)![2]).toBe('7');
  });
});

describe('pointer', () => {
  it('treemap: hovering a tile shows its tooltip; a leaf click selects it in place; a branch header click drills', () => {
    const { host, chart, plot } = open(treemap);
    const hovers: (string | null)[] = [];
    const selected: string[] = [];
    chart.on('hover', p => hovers.push(p?.label ?? null));
    chart.on('select', p => selected.push(p.label));
    // Engineering (80) takes the left 80% of a 600×400 plot; its leaves sit below its 18 px header.
    plot.dispatch('pointermove', { clientX: 100, clientY: 200 });
    expect(hovers.at(-1)).toMatch(/Platform|Product/);
    const tip = host.find(e => e.attributes.get('class') === 'axylo-h-tip')!;
    expect(tip.hidden).toBe(false);
    plot.dispatch('click', { clientX: 100, clientY: 200 });
    expect(chart.drilled.label).toBe('Company');
    expect(selected).toEqual([hovers.at(-1)]);
    expect(chart.focused?.label).toBe(hovers.at(-1));
    plot.dispatch('click', { clientX: 100, clientY: 6 });
    expect(chart.drilled.label).toBe('Engineering');
    expect(chart.focused?.label).toBe('Platform');
    plot.dispatch('pointerleave', {});
    expect(hovers.at(-1)).toBeNull();
    expect(tip.hidden).toBe(true);
  });

  it('sunburst: clicking an arc promotes it to the center; clicking the center ascends', () => {
    const { chart, plot } = open(sunburst);
    // Plot 600×400: center (300, 200), radius 198, three rings of 66. Engineering spans 0–0.8 turn: up-right of center.
    plot.dispatch('click', { clientX: 300 + 90, clientY: 200 - 30 });
    expect(chart.drilled.label).toBe('Engineering');
    plot.dispatch('click', { clientX: 300, clientY: 200 });
    expect(chart.drilled.label).toBe('Company');
  });
});

describe('labels (fake DOM measures 7 px per character)', () => {
  const LONG = 'A label far too long to fit in any tile of this plot';
  const data = { label: 'R', children: [
    { label: 'Big', children: [{ label: LONG, value: 500 }, { label: 'Tiny', value: 0.01 }, { label: 'Mid', value: 120 }] },
    { label: 'Other', value: 300 },
  ] };

  it('treemap: every drawn label lies inside its own tile, labels never overlap, and cut or left-out labels stay whole in table and tooltip', () => {
    const { target, host } = fakeTarget({ width: 400, height: 260 });
    const chart = treemap(target, { title: 'T', data });
    const svgRoot = host.find(e => e.tagName === 'svg')!;
    const tiles = svgRoot.all(e => e.tagName === 'rect' && e.hasAttribute('data-node')).map(e => ({
      x: +e.getAttribute('x')!, y: +e.getAttribute('y')!, w: +e.getAttribute('width')!, h: +e.getAttribute('height')!,
    }));
    const texts = svgRoot.all(e => e.tagName === 'text').map(e => ({
      text: e.textContent, x: +e.getAttribute('x')!, y: +e.getAttribute('y')!, w: e.textContent.length * 7, h: 14,
    }));
    expect(texts.length).toBeGreaterThan(0);
    // The tiny tile has no room for a label; the long one is cut with an ellipsis.
    expect(texts.some(t => t.text === 'Tiny')).toBe(false);
    const cut = texts.find(t => t.text.startsWith('A label'))!;
    expect(cut.text.endsWith('…')).toBe(true);
    for (const t of texts) {
      const box = { x0: t.x, x1: t.x + t.w, y0: t.y - t.h / 2, y1: t.y + t.h / 2 };
      expect(tiles.some(r => box.x0 >= r.x && box.x1 <= r.x + r.w + 1e-6 && box.y0 >= r.y - 1e-6 && box.y1 <= r.y + r.h + 1e-6)).toBe(true);
    }
    for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i]!, b = texts[j]!;
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oy = Math.min(a.y + 7, b.y + 7) - Math.max(a.y - 7, b.y - 7);
      expect(ox <= 0 || oy <= 0).toBe(true);
    }
    const rows = tableRows(chart);
    expect(rows.some(r => r![0] === `R / Big / ${LONG}`)).toBe(true);
    expect(rows.some(r => r![0] === 'R / Big / Tiny')).toBe(true);
    expect(chart.breadcrumb[0]!.label).toBe('R');
  });

  it('sunburst: labels that do not fit their sector are left out, never drawn across a neighbour', () => {
    const { target, host } = fakeTarget({ width: 300, height: 300 });
    sunburst(target, { title: 'T', data });
    const texts = host.find(e => e.tagName === 'svg')!.all(e => e.tagName === 'text').map(e => e.textContent);
    expect(texts).toContain('R');
    expect(texts).not.toContain('Tiny');
    expect(texts.every(t => t === LONG ? false : true)).toBe(true);
  });
});
