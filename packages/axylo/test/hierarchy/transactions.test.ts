/**
 * Repair round 2 regressions (review sol-6.2-medium__20261127T171804Z): author code that changes the chart
 * while a part is drawn (a value formatter that updates or drills), in every render path; diagnostics recorded
 * when handed out, not when queued; explicit nested ids that keep naming their node when siblings move; and
 * Enter on a sunburst's center going to its first child.
 *
 * Expected values come from the fixture data and the keyboard / event contract (ledger, "Keyboard" and
 * "Events"); the pre-order of TWO is R0 A1 a1₂ a2₃ B4 b1₅ b2₆ and its values are all different (51, 40, 30,
 * 10, 11, 6, 5), so a formatter can tell which node is being read.
 */
import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { sunburst, treemap, type HierarchyOptions, type SunburstChart, type TreemapChart } from '../../src/hierarchy';
import { DiagnosticCollector } from '../../src/diagnostics/collector';
import { buildHierarchy, childAt, childCount, isBranch, type HierarchyModel } from '../../src/hierarchy/tree';
import { arbTree } from './fixtures';
import { navigate } from '../../src/hierarchy/nav';
import { fakeTarget, type FakeElement } from './fake-dom';

const TWO = { label: 'R', children: [
  { label: 'A', children: [{ label: 'a1', value: 30 }, { label: 'a2', value: 10 }] },
  { label: 'B', children: [{ label: 'b1', value: 6 }, { label: 'b2', value: 5 }] },
] };
const NEW = { label: 'New', children: [{ label: 'Fresh', value: 3 }] };
const KINDS = [['treemap', treemap], ['sunburst', sunburst]] as const;
type Kind = typeof treemap | typeof sunburst;
type Chart = TreemapChart & SunburstChart;

function open(kind: Kind, options: Partial<HierarchyOptions> = {}) {
  const { doc, target, host } = fakeTarget();
  const chart = kind(target, { title: 'Headcount', data: TWO, ...options } as HierarchyOptions) as Chart;
  const plot = host.find(e => e.attributes.get('class') === 'axylo-h-plot')!;
  const tip = host.find(e => e.attributes.get('class') === 'axylo-h-tip')!;
  const item = () => host.find(e => e.getAttribute('role') === 'treeitem');
  const nav = () => host.find(e => e.tagName === 'NAV')!;
  const current = () => host.find(e => e.getAttribute('aria-current') === 'location');
  const crumbButtons = () => host.all(e => e.tagName === 'BUTTON' && e.hasAttribute('data-node')).map(e => e.textContent);
  const toggle = () => host.find(e => e.tagName === 'BUTTON' && e.hasAttribute('aria-controls'))!;
  const rows = () => host.all(e => e.tagName === 'TR' && e.hasAttribute('data-node'));
  return { doc, host, chart, plot, tip, item, nav, current, crumbButtons, toggle, rows };
}
const key = (plot: FakeElement, k: string) => plot.dispatch('keydown', { key: k });
const move = (plot: FakeElement, x: number, y: number) => plot.dispatch('pointermove', { clientX: x, clientY: y });
const click = (plot: FakeElement, x: number, y: number) => plot.dispatch('click', { clientX: x, clientY: y });

/** Where `label` is under the pointer, found on a separate chart of the same data and size (its texts stay unread). */
function locate(kind: Kind, label: string): [number, number] {
  const { chart, plot } = open(kind);
  let found: string | null = null;
  chart.on('hover', p => { found = p?.label ?? null; });
  for (let y = 5; y < 400; y += 10) for (let x = 5; x < 600; x += 10) {
    move(plot, x, y);
    if (found === label) { chart.destroy(); return [x, y]; }
  }
  throw new Error(`no point shows ${label}`);
}

/** A value format that, the first time it formats `value` after `arm()`, runs `then`. */
function trap(value: number) {
  let armed = false;
  let then: () => void = () => {};
  return {
    format: (v: number) => { if (armed && v === value) { armed = false; then(); } return String(v); },
    arm(action: () => void) { armed = true; then = action; },
    get fired() { return !armed; },
  };
}

function recorder(chart: Chart) {
  const events: string[] = [];
  chart.on('hover', p => events.push(`hover:${p === null ? 'null' : `${p.id}|${p.label}`}`));
  chart.on('select', p => events.push(`select:${p.id}`));
  chart.on('drill', p => events.push(`drill:${p.id}`));
  return events;
}

describe('1. a formatter that changes the chart while a part is drawn: the nested change wins', () => {
  it.each(KINDS)('%s: breadcrumb — drilling R/A, a formatter drills R/B: one drill event, a current crumb, the whole bar', (_n, kind) => {
    const t = trap(40);
    const o = open(kind, { value: { format: t.format } });
    const events = recorder(o.chart);
    t.arm(() => { o.chart.drill('R/B'); });
    const made = vi.spyOn(o.doc, 'createElement');
    expect(o.chart.drill('R/A')).toBe(true);
    expect(t.fired).toBe(true);
    // No crumb was ever built for the superseded path R › A (A is node 1).
    const built = made.mock.results.map(r => r.value as FakeElement).filter(e => e.getAttribute('data-node') === '1');
    expect(built).toEqual([]);
    made.mockRestore();
    expect(o.chart.drilled.id).toBe('R/B');
    expect(events).toEqual(['drill:R/B']);
    expect(o.current()?.textContent).toBe('B');
    expect(o.crumbButtons()).toEqual(['R']);
    expect(o.chart.breadcrumb.map(c => [c.label, c.current])).toEqual([['R', false], ['B', true]]);
    expect(o.chart.focused?.id).toBe('R/B/b1');
    expect(o.item()!.getAttribute('data-node')).toBe('5');
    expect(o.item()!.textContent.startsWith('R / B / b1:')).toBe(true);
  });

  it.each(KINDS)('%s: hover — a formatter updates while the tooltip is read: no hover payload of the old model, no stale tooltip', (_n, kind) => {
    const at = locate(kind, 'a1');
    const t = trap(30);
    const o = open(kind, { value: { format: t.format } });
    const events = recorder(o.chart);
    t.arm(() => o.chart.update({ data: NEW }));
    move(o.plot, ...at);
    expect(t.fired).toBe(true);
    // The hover belonged to the replaced view: never delivered, so no payload names a node of the new model wrongly.
    expect(events).toEqual([]);
    expect(o.chart.drilled.label).toBe('New');
    expect(o.nav().textContent).toBe('New');
    expect(o.item()!.textContent.startsWith('New')).toBe(true);
    expect(o.tip.hidden).toBe(true);
    // The next move reads the new model.
    for (let x = 5; x < 600 && !events.length; x += 20) move(o.plot, x, 200);
    expect(events[0]).toMatch(/^hover:New(\/Fresh)?\|(New|Fresh)$/);
  });

  it.each(KINDS)('%s: pointer leave after a superseded hover delivers one hover(null) at most and leaves no outline', (_n, kind) => {
    const at = locate(kind, 'a1');
    const o = open(kind);
    const events = recorder(o.chart);
    move(o.plot, ...at);
    expect(events).toEqual(['hover:R/A/a1|a1']);
    o.plot.dispatch('pointerleave', {});
    o.plot.dispatch('pointerleave', {});
    expect(events).toEqual(['hover:R/A/a1|a1', 'hover:null']);
    expect(o.tip.hidden).toBe(true);
    expect(o.host.all(e => e.hasAttribute('data-outline'))).toEqual([]);
  });

  it.each(KINDS)('%s: keyboard focus — the focused item reads A and a formatter drills R/B: focus and item follow R/B', (_n, kind) => {
    const t = trap(40);
    const o = open(kind, { value: { format: t.format } });
    const events = recorder(o.chart);
    o.plot.focus();
    t.arm(() => { o.chart.drill('R/B'); });
    key(o.plot, 'ArrowDown');
    expect(t.fired).toBe(true);
    expect(o.chart.drilled.id).toBe('R/B');
    expect(o.chart.focused?.id).toBe('R/B/b1');
    expect(o.item()!.getAttribute('data-node')).toBe('5');
    expect(o.item()!.getAttribute('aria-level')).toBe('2');
    expect(o.item()!.textContent.startsWith('R / B / b1:')).toBe(true);
    expect(o.current()?.textContent).toBe('B');
    // The keyboard reading shows the tooltip of the node that is focused now.
    expect(o.tip.hidden).toBe(false);
    expect(o.tip.getAttribute('data-node')).toBe('5');
    expect(events).toEqual(['drill:R/B']);
  });

  it('treemap: select — a leaf click whose item text drills elsewhere: the superseded select is not delivered', () => {
    const at = locate(treemap, 'a2');
    const t = trap(10);
    const o = open(treemap, { value: { format: t.format } });
    const events = recorder(o.chart);
    t.arm(() => { o.chart.drill('R/B'); });
    click(o.plot, ...at);
    expect(t.fired).toBe(true);
    expect(events).toEqual(['drill:R/B']);
    expect(o.chart.drilled.id).toBe('R/B');
    expect(o.chart.focused?.id).toBe('R/B/b1');
    expect(o.item()!.getAttribute('data-node')).toBe('5');
  });

  it('treemap: select without reentry is still delivered once with the clicked leaf', () => {
    const at = locate(treemap, 'a2');
    const o = open(treemap);
    const events = recorder(o.chart);
    click(o.plot, ...at);
    expect(events).toEqual(['select:R/A/a2']);
    expect(o.chart.focused?.id).toBe('R/A/a2');
  });

  it.each(KINDS)('%s: table — a formatter updates while rows are read: the table is drawn whole for the new revision', (_n, kind) => {
    const t = trap(40);
    const o = open(kind, { value: { format: t.format } });
    t.arm(() => o.chart.update({ title: 'Retitled', data: { ...TWO, children: [...TWO.children, { label: 'C', value: 9 }] } }));
    o.toggle().dispatch('click', {});
    expect(t.fired).toBe(true);
    expect(o.host.find(e => e.tagName === 'H3')!.textContent).toBe('Retitled');
    expect(o.toggle().getAttribute('aria-expanded')).toBe('true');
    expect(o.rows().length).toBe(8);
    expect(o.rows().map(r => r.children[0]!.textContent)).toEqual(['R', 'R / A', 'R / A / a1', 'R / A / a2', 'R / B', 'R / B / b1', 'R / B / b2', 'R / C']);
    expect(o.rows()[0]!.children[2]!.textContent).toBe('60');
  });

  it.each(KINDS)('%s: table — a formatter drills while rows are read: every row is drawn and the bar shows R/B', (_n, kind) => {
    const t = trap(40);
    const o = open(kind, { value: { format: t.format } });
    const events = recorder(o.chart);
    t.arm(() => { o.chart.drill('R/B'); });
    o.toggle().dispatch('click', {});
    expect(o.rows().length).toBe(7);
    expect(o.current()?.textContent).toBe('B');
    expect(events).toEqual(['drill:R/B']);
  });

  it.each(KINDS)('%s: chrome — an update whose summary formatter drills: the drill wins, chrome and plot read the new revision', (_n, kind) => {
    const t = trap(62);
    const o = open(kind, { value: { format: t.format } });
    const events = recorder(o.chart);
    t.arm(() => { o.chart.drill('R/B'); });
    o.chart.update({ title: 'Grown', data: { ...TWO, children: [...TWO.children, { label: 'C', value: 11 }] } });
    expect(t.fired).toBe(true);
    expect(o.host.find(e => e.tagName === 'H3')!.textContent).toBe('Grown');
    expect(o.chart.drilled.id).toBe('R/B');
    expect(o.current()?.textContent).toBe('B');
    expect(o.item()!.getAttribute('data-node')).toBe('5');
    expect(events).toEqual(['drill:R/B']);
  });

  it('a formatter that changes the chart every time it runs stops with a console error instead of hanging', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let chart: Chart | null = null;
    let flip = false;
    // Each update makes a new reader, so the table's row for A is read (and formatted) again every time.
    const format = (v: number) => { if (chart && v === 40) { flip = !flip; chart.update({ title: flip ? 'x' : 'y' }); } return String(v); };
    const o = open(treemap, { value: { format } });
    chart = o.chart;
    expect(() => o.toggle().dispatch('click', {})).not.toThrow();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('keeps changing the chart'));
    error.mockRestore();
  });
});

describe('2. diagnostics are recorded when handed out', () => {
  // AX191 (orphan o), AX190 (negative x), AX192 (nothing positive left).
  const THREE = [{ id: 'r', parent: null }, { id: 'x', parent: 'r', value: -5 }, { id: 'o', parent: 'zz', value: 1 }];

  it.each(KINDS)('%s: a handler that retitles on the first finding still gets all three, once each', (_n, kind) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: string[] = [];
    const o = open(kind);
    let retitled = 0;
    o.chart.update({
      data: THREE,
      onDiagnostic: d => { seen.push(d.code); if (seen.length === 1) { retitled++; o.chart.update({ title: 'Retitled' }); } },
    });
    expect(retitled).toBe(1);
    expect([...seen].sort()).toEqual(['AX190', 'AX191', 'AX192']);
    expect(seen.length).toBe(3);
    expect(o.chart.diagnostics.map(d => d.code).sort()).toEqual(['AX190', 'AX191', 'AX192']);
    expect(o.host.find(e => e.tagName === 'H3')!.textContent).toBe('Retitled');
    // Dedupe: a later update with the same handler and findings hands out nothing again.
    o.chart.update({ title: 'Again' });
    expect(seen.length).toBe(3);
    // A replacement handler gets the persisting findings once.
    const second: string[] = [];
    o.chart.update({ onDiagnostic: d => second.push(d.code) });
    o.chart.update({ title: 'Once more' });
    expect([...second].sort()).toEqual(['AX190', 'AX191', 'AX192']);
    expect(second.length).toBe(3);
    warn.mockRestore();
  });

  it('a handler whose update drops a finding is not handed the dropped one; a late AX160 still reaches it once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: string[] = [];
    let armed = false;
    const format = (v: number) => { if (armed && v === 3) throw new Error('three'); return String(v); };
    const o = open(treemap, { value: { format } });
    o.chart.update({
      data: THREE,
      onDiagnostic: d => {
        seen.push(d.code);
        // Fixes the data on the first finding: the others belonged to the replaced revision.
        if (seen.length === 1) o.chart.update({ data: { label: 'R', children: [{ label: 'z', value: 3 }] } });
      },
    });
    expect(seen.length).toBe(1);
    expect(o.chart.diagnostics).toEqual([]);
    armed = true;
    o.chart.table!.row(1);
    o.chart.table!.row(1);
    expect(seen.slice(1)).toEqual(['AX160']);
    warn.mockRestore();
  });
});

describe('3. explicit nested ids keep their node', () => {
  const model = (data: unknown): HierarchyModel => buildHierarchy(data, 'All', new DiagnosticCollector());
  const idOf = (m: HierarchyModel, label: string, k = 0): string => m.ids.filter((_, i) => m.labels[i] === label)[k]!;

  it('a label-only "Ops" and an explicit id "Ops": the explicit one is Ops in either order and after colliding inserts', () => {
    const explicit = { id: 'Ops', label: 'Explicit', value: 2 };
    const plain = { label: 'Ops', value: 1 };
    const a = model({ label: 'R', children: [plain, explicit] });
    const b = model({ label: 'R', children: [explicit, plain] });
    const c = model({ label: 'R', children: [{ label: 'Ops', value: 7 }, plain, { label: 'Ops#2', value: 1 }, explicit] });
    for (const m of [a, b, c]) expect(idOf(m, 'Explicit')).toBe('Ops');
    expect(idOf(a, 'Ops')).toBe('R/Ops');
    expect(idOf(b, 'Ops')).toBe('R/Ops');
    expect([idOf(c, 'Ops', 0), idOf(c, 'Ops', 1), idOf(c, 'Ops#2')]).toEqual(['R/Ops', 'R/Ops#2', 'R/Ops\\#2']);
    // Without explicit ids, ids follow sibling order (the documented label policy).
    const d = model({ label: 'R', children: [{ label: 'Ops', value: 1 }, { label: 'Ops', value: 2 }] });
    expect(d.ids).toEqual(['R', 'R/Ops', 'R/Ops#2']);
  });

  it('genuinely duplicate explicit sibling ids: the first in order keeps the plain id, later ones are numbered, labels after them', () => {
    const m = model({ label: 'R', children: [{ label: 'd', value: 3 }, { id: 'd', label: 'one', value: 1 }, { id: 'd', label: 'two', value: 2 }] });
    expect(m.ids).toEqual(['R', 'R/d#3', 'R/d', 'R/d#2']);
  });

  it('explicit ids under an explicit parent and at the top of a forest are claimed the same way', () => {
    // The top-level label 'k' would be the plain path 'k', which the explicit id reserves: it is numbered.
    const m = model([{ label: 'k', value: 1 }, { id: 'k', label: 'K', children: [{ label: 'q', value: 1 }, { id: 'q', label: 'Q', value: 2 }] }]);
    expect(m.ids).toEqual(['', 'k#2', 'k', 'k/q', 'q']);
  });

  it('for any siblings, an explicit id names the same node whatever the order, and all ids stay unique', () => {
    const sibling = fc.oneof(
      fc.record({ label: fc.constantFrom('a', 'b', 'a#2', 'a/b'), value: fc.nat(9) }),
      fc.record({ label: fc.constantFrom('a', 'b'), children: fc.constant([{ label: 'a', value: 1 }]) }),
    );
    const explicitIds = fc.uniqueArray(fc.constantFrom('a', 'b', 'a#2', 'a/b', 'c'), { maxLength: 4 });
    fc.assert(fc.property(fc.array(sibling, { maxLength: 6 }), explicitIds, fc.array(fc.nat(), { minLength: 10, maxLength: 10 }), (plain, ids, order) => {
      const nodes: Record<string, unknown>[] = [...plain, ...ids.map(id => ({ id, label: `explicit ${id}`, value: 1 }))];
      const shuffled = nodes.map((n, k) => [order[k % order.length]! + k * 0.001, n] as const).sort((x, y) => x[0] - y[0]).map(x => x[1]);
      for (const children of [nodes, shuffled]) {
        const m = model({ label: 'R', children });
        expect(new Set(m.ids).size).toBe(m.count);
        for (const id of ids) {
          const escaped = id.replace(/[\\/#]/g, ch => '\\' + ch);
          expect(idOf(m, `explicit ${id}`)).toBe(escaped);
        }
      }
    }), { numRuns: 300 });
  });

  it.each(KINDS)('%s: drilled into the explicit "Ops", a reorder and a colliding insert keep drill and focus on it', (_n, kind) => {
    const plain = { label: 'Ops', value: 1 };
    const explicit = { id: 'Ops', label: 'Ops', children: [{ label: 'x', value: 2 }, { label: 'y', value: 3 }] };
    const o = open(kind, { data: { label: 'R', children: [plain, explicit] } });
    expect(o.chart.drill('Ops')).toBe(true);
    expect(o.chart.drilled.value).toBe(5);
    o.plot.focus();
    key(o.plot, 'ArrowRight');
    expect(o.chart.focused?.id).toBe('Ops/y');
    o.chart.update({ data: { label: 'R', children: [explicit, plain] } });
    expect(o.chart.drilled.id).toBe('Ops');
    expect(o.chart.drilled.value).toBe(5);
    expect(o.chart.focused?.id).toBe('Ops/y');
    o.chart.update({ data: { label: 'R', children: [{ label: 'Ops', children: [{ label: 'y', value: 9 }] }, plain, explicit] } });
    expect(o.chart.drilled.value).toBe(5);
    expect(o.chart.focused?.path).toEqual(['R', 'Ops', 'y']);
    expect(o.chart.focused?.value).toBe(3);
  });
});

describe('4. Enter on a sunburst center goes to its first child', () => {
  const m = buildHierarchy(TWO, 'All', new DiagnosticCollector());

  it('pure navigation: the initial center, a drilled branch center, a centered leaf, and treemap unchanged', () => {
    expect(navigate(m, { root: 0, focus: 0 }, 'Enter', 'sunburst')).toEqual({ root: 0, focus: 1, select: false });
    expect(navigate(m, { root: 0, focus: 0 }, ' ', 'sunburst')).toEqual({ root: 0, focus: 1, select: false });
    expect(navigate(m, { root: 4, focus: 4 }, 'Enter', 'sunburst')).toEqual({ root: 4, focus: 5, select: false });
    // A centered leaf has no child: Enter goes up, as a click on the center does.
    expect(navigate(m, { root: 5, focus: 5 }, 'Enter', 'sunburst')).toEqual({ root: 4, focus: 5, select: false });
    // An arc still promotes.
    expect(navigate(m, { root: 0, focus: 1 }, 'Enter', 'sunburst')).toEqual({ root: 1, focus: 2, select: false });
    expect(navigate(m, { root: 0, focus: 0 }, 'Enter', 'treemap')).toEqual({ root: 0, focus: 1, select: false });
  });

  it('for any tree and centered node: Enter/Space go to its first child when it has one, else a centered leaf goes up', () => {
    fc.assert(fc.property(arbTree(4), fc.nat(), fc.constantFrom('Enter', ' ') as fc.Arbitrary<'Enter' | ' '>, (tree, pick, k) => {
      const mm = buildHierarchy(tree, 'All', new DiagnosticCollector());
      const center = pick % mm.count;
      const r = navigate(mm, { root: center, focus: center }, k, 'sunburst');
      if (childCount(mm, center) > 0) expect(r).toEqual({ root: center, focus: childAt(mm, center, 0), select: false });
      else if (mm.parent[center]! >= 0) expect(r).toEqual({ root: mm.parent[center]!, focus: center, select: false });
      else expect(r).toEqual({ root: center, focus: center, select: false });
      expect(isBranch(mm, r.root) || r.root === center).toBe(true);
    }), { numRuns: 300 });
  });

  it('public handle: Enter on the initial center focuses the first child without drilling; the center click still ascends', () => {
    const o = open(sunburst);
    const events = recorder(o.chart);
    o.plot.focus();
    key(o.plot, 'Enter');
    expect(o.chart.drilled.id).toBe('R');
    expect(o.chart.focused?.id).toBe('R/A');
    expect(o.item()!.getAttribute('aria-level')).toBe('2');
    expect(events).toEqual([]);
    // Enter on that arc promotes it; Enter on the new center goes to its first child.
    key(o.plot, 'Enter');
    expect([o.chart.drilled.id, o.chart.focused?.id]).toEqual(['R/A', 'R/A/a1']);
    key(o.plot, 'ArrowUp');
    expect(o.chart.focused?.id).toBe('R/A');
    key(o.plot, 'Enter');
    expect([o.chart.drilled.id, o.chart.focused?.id]).toEqual(['R/A', 'R/A/a1']);
    // The center click goes up.
    click(o.plot, 300, 200);
    expect(o.chart.drilled.id).toBe('R');
    expect(events).toEqual(['drill:R/A', 'drill:R']);
  });
});
