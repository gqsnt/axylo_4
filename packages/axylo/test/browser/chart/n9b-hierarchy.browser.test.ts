/**
 * N9b `axylo/hierarchy` in real Chrome: treemap and sunburst in light, dark and forced colors; pointer hover,
 * drill-down and breadcrumb return; hierarchical keyboard movement; table parity with the handle's committed
 * TableModel; strict rollback; and axe-core with no violations in each state (spec A2, A4, A5, A8, I1).
 * Activation follows each chart's rule: a treemap branch header drills and a leaf is selected in place; a
 * sunburst arc, a leaf included, is promoted by click and by Enter, and the center goes back up. After a
 * center or breadcrumb return the plot keeps (or takes) focus, read both from the DOM and from Chrome's own
 * accessibility tree (CDP `Accessibility.getPartialAXTree`, through the suite's `axOf`).
 *
 * The package does not export `./hierarchy` yet (the Director wires it after Wave 4), so the module is bundled
 * here from source, in memory (esbuild `write: false`), and added to the shared test page as a script.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { DARK, LIGHT } from '../../../src/theme/palette';
import { ENGINE, start, stop } from '../harness';
import { startWithShortTmp, stopWithShortTmp } from '../acceptance/short-tmp';
import { axe } from '../a11y/util';
import { axOf } from '../acceptance/util';
import { chartPage, closePage, hex } from './util';

type HierarchyModule = typeof import('../../../src/hierarchy');
type Handle = ReturnType<HierarchyModule['treemap']>;

declare global {
  interface Window {
    AxyloHierarchy: HierarchyModule;
    hchart: Handle;
    hevents: string[];
  }
}

let bundle = '';
beforeAll(async () => {
  const { build } = await import('esbuild');
  const entry = path.resolve(import.meta.dirname, '../../../src/hierarchy.ts');
  const out = await build({
    stdin: { contents: `export * from ${JSON.stringify(entry)};`, resolveDir: path.dirname(entry), loader: 'ts' },
    bundle: true, write: false, format: 'iife', globalName: 'AxyloHierarchy', target: 'es2022', define: { __DEV__: 'true' }, logLevel: 'silent',
  });
  bundle = out.outputFiles[0]!.text;
  await startWithShortTmp(start, { engine: ENGINE });
});
afterAll(() => stopWithShortTmp(stop));

const DATA = { label: 'Company', children: [
  { label: 'Engineering', children: [{ label: 'Platform', value: 30 }, { label: 'Product', value: 50 }] },
  { label: 'Sales', children: [{ label: 'EMEA', value: 12 }, { label: 'Americas with a very long regional label', value: 8 }] },
] };

type Kind = 'treemap' | 'sunburst';
type Mode = { name: string; colorScheme: 'light' | 'dark'; forcedColors: 'none' | 'active' };
const MODES: readonly Mode[] = [
  { name: 'light', colorScheme: 'light', forcedColors: 'none' },
  { name: 'dark', colorScheme: 'dark', forcedColors: 'none' },
  { name: 'forced colors', colorScheme: 'light', forcedColors: 'active' },
];

async function open(kind: Kind, mode: Mode = MODES[0]!, extra: Record<string, unknown> = {}): Promise<Page> {
  const page = await chartPage({ colorScheme: mode.colorScheme, forcedColors: mode.forcedColors });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(({ kind, data, extra }) => {
    const main = document.createElement('main');
    document.body.append(main);
    main.innerHTML = '<h1>Organisation</h1>';
    main.append(document.querySelector('#chart')!);
    window.hevents = [];
    const chart = window.AxyloHierarchy[kind]('#chart', { title: { text: 'Headcount', level: 2 }, data, value: { unit: 'people' }, ...extra } as never);
    chart.on('drill', p => window.hevents.push('drill:' + p.id));
    chart.on('select', p => window.hevents.push('select:' + p.id));
    window.hchart = chart;
  }, { kind, data: DATA, extra });
  await page.evaluate(() => window.nextFrames(2));
  return page;
}

const markSelector = (kind: Kind) => kind === 'treemap' ? '#chart svg rect[data-node]' : '#chart svg path[data-node]';
/**
 * A point well inside a node's mark, in client px. A sector's box center can fall outside the sector, so the
 * mark is sampled: of the points whose 4 px neighbours are all in its fill, the one nearest their mean.
 */
const nodeCenter = (page: Page, kind: Kind, node: number) => page.evaluate(({ sel, node }) => {
  const el = document.querySelector(`${sel}[data-node="${node}"]`) as SVGGeometryElement;
  const svgBox = el.ownerSVGElement!.getBoundingClientRect();
  const b = el.getBBox();
  const inside = (x: number, y: number) => [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4]].every(([dx, dy]) => el.isPointInFill(new DOMPoint(x + dx!, y + dy!)));
  const points: [number, number][] = [];
  for (let y = b.y; y <= b.y + b.height; y += 3) for (let x = b.x; x <= b.x + b.width; x += 3) if (inside(x, y)) points.push([x, y]);
  if (!points.length) throw new Error(`node ${node} has no interior point`);
  const mx = points.reduce((a, p) => a + p[0], 0) / points.length, my = points.reduce((a, p) => a + p[1], 0) / points.length;
  let best = points[0]!;
  for (const p of points) if (Math.hypot(p[0] - mx, p[1] - my) < Math.hypot(best[0] - mx, best[1] - my)) best = p;
  return { x: svgBox.left + best[0], y: svgBox.top + best[1] };
}, { sel: markSelector(kind), node });
const tooltip = (page: Page) => page.evaluate(() => {
  const t = document.querySelector('#chart .axylo-h-tip') as HTMLElement;
  return { hidden: t.hidden, text: t.textContent ?? '', node: t.getAttribute('data-node'), box: t.getBoundingClientRect().toJSON() as DOMRect };
});
const crumbs = (page: Page) => page.$$eval('#chart nav[aria-label="Hierarchy path"] li [data-node]', els => els.map(e => [e.tagName, e.textContent]));
const item = (page: Page) => page.$eval('#chart [role="treeitem"]', e => e.textContent ?? '');
const plotHasFocus = (page: Page) => page.evaluate(() => document.activeElement === document.querySelector('#chart .axylo-h-plot'));
/**
 * What Chrome's accessibility tree says about the focused node: the tree is focused (Chrome reports the
 * focused state on the tree or, following aria-activedescendant, on its item), and the item is a treeitem
 * whose computed name and level are the focused node's.
 */
async function axFocus(page: Page): Promise<{ focused: boolean; role: string; name: string; level: number }> {
  const tree = await axOf(page, '#chart [role="tree"]');
  const node = await axOf(page, '#chart [role="treeitem"]');
  return { focused: tree.props.focused === true || node.props.focused === true, role: node.role, name: node.name, level: Number(node.props.level) };
}

describe.each(['treemap', 'sunburst'] as const)('%s', kind => {
  it.each(MODES)('renders in $name with palette, separators, labels and zero axe violations', async mode => {
    const page = await open(kind, mode);
    try {
      // Treemap: two branches and four leaves; sunburst: the center disc too.
      expect(await page.locator(markSelector(kind)).count()).toBe(kind === 'treemap' ? 6 : 7);
      const paint = await page.evaluate(sel => {
        const leaf = document.querySelector(`${sel}[data-node="2"]`) as SVGElement;
        const s = getComputedStyle(leaf);
        return { fill: s.fill, stroke: s.stroke, strokeWidth: parseFloat(s.strokeWidth), text: getComputedStyle(document.querySelector('#chart figure')!).color };
      }, markSelector(kind));
      const rgb = (paint.fill.match(/\d+/g) ?? []).slice(0, 3).map(Number);
      if (mode.forcedColors === 'active') {
        // Every slot is the forced text color; fills never fall back to the palette.
        expect(paint.fill).toBe(paint.text);
      } else {
        expect(rgb).toEqual([...hex((mode.colorScheme === 'dark' ? DARK : LIGHT).series[0]!)]);
      }
      // At least 1 CSS px of background between neighbouring marks (spec A5).
      expect(paint.strokeWidth).toBeGreaterThanOrEqual(1);
      expect(Number(await page.getAttribute('#chart figure', 'data-labelled'))).toBeGreaterThan(0);
      expect(await crumbs(page)).toEqual([['SPAN', 'Company']]);
      expect((await axe(page)).violations).toEqual([]);
      expect(await closePage(page)).toEqual([]);
    } catch (error) { await closePage(page).catch(() => {}); throw error; }
  });

  it('pointer: hover shows the exact tooltip beside the mark', async () => {
    const page = await open(kind);
    try {
      const at = await nodeCenter(page, kind, 3); // Product: 50 of Engineering's 80, half of the total
      await page.mouse.move(at.x, at.y);
      await page.evaluate(() => window.nextFrames(1));
      const tip = await tooltip(page);
      expect(tip.hidden).toBe(false);
      expect(tip.node).toBe('3');
      expect(tip.text).toContain('Company / Engineering / Product');
      expect(tip.text).toContain('50 people');
      expect(tip.text).toContain('62.5%');
      expect(tip.text).toContain('50%');
      // The tooltip never covers the point being read (spec I1).
      const covers = at.x >= tip.box.left && at.x <= tip.box.right && at.y >= tip.box.top && at.y <= tip.box.bottom;
      expect(covers).toBe(false);
      expect((await axe(page)).violations).toEqual([]);
      await page.mouse.move(2, 2);
      expect((await tooltip(page)).hidden).toBe(true);
      expect(await closePage(page)).toEqual([]);
    } catch (error) { await closePage(page).catch(() => {}); throw error; }
  });

  it('keyboard: one tab stop for the plot; arrows move by sibling and level; Enter drills; Up and Escape ascend', async () => {
    const page = await open(kind);
    try {
      // open() moves #chart into a <main> placed after #after, so the plot is the next tab stop from there.
      await page.focus('#after');
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.getAttribute('role'))).toBe('tree');
      expect(await item(page)).toContain('Company: 100 people');
      expect(await axFocus(page)).toMatchObject({ focused: true, role: 'treeitem', level: 1 });
      await page.keyboard.press('ArrowDown');
      expect(await item(page)).toBe('Company / Engineering: 80 people. % of Parent 80%, % of Root 80%.');
      expect(await axFocus(page)).toEqual({ focused: true, role: 'treeitem', name: 'Company / Engineering: 80 people. % of Parent 80%, % of Root 80%.', level: 2 });
      await page.keyboard.press('ArrowRight');
      expect(await item(page)).toContain('Company / Sales: 20 people');
      await page.keyboard.press('Home');
      expect(await item(page)).toContain('Company / Engineering');
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      expect(await crumbs(page)).toEqual([['BUTTON', 'Company'], ['SPAN', 'Sales']]);
      expect(await item(page)).toBe('Company / Sales / EMEA: 12 people. % of Parent 60%, % of Root 12%.');
      // The keyboard reading shows the tooltip and the focus ring; axe stays clean.
      expect((await tooltip(page)).node).toBe(await page.evaluate(() => String(window.hchart.focused && document.querySelector('#chart [role="treeitem"]')!.getAttribute('data-node'))));
      expect(await page.locator('#chart svg [data-outline="focus"]').count()).toBe(1);
      expect((await axe(page)).violations).toEqual([]);
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Enter');
      // A treemap selects a leaf in place; a sunburst promotes it to the center (and Up goes back to Sales).
      expect(await page.evaluate(() => window.hevents.at(-1))).toBe(`${kind === 'treemap' ? 'select' : 'drill'}:Company/Sales/Americas with a very long regional label`);
      await page.keyboard.press('ArrowUp');
      expect(await item(page)).toContain('Company / Sales: 20 people');
      await page.keyboard.press('Escape');
      expect(await crumbs(page)).toEqual([['SPAN', 'Company']]);
      expect(await page.evaluate(() => window.hchart.focused?.id)).toBe('Company');
      expect(await axFocus(page)).toMatchObject({ focused: true, role: 'treeitem', level: 1 });
      // Focus can leave the chart: the breadcrumb has no buttons at the root, so Tab reaches the table control.
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('View as table');
      expect(await closePage(page)).toEqual([]);
    } catch (error) { await closePage(page).catch(() => {}); throw error; }
  });

  it('the opened table equals the handle\'s committed five-column TableModel, row for row', async () => {
    const page = await open(kind);
    try {
      await page.click('#chart button[aria-expanded]');
      const shown = await page.$$eval('#chart [role="region"] tbody tr', rows => rows.map(r => Array.from(r.children, c => c.textContent)));
      const model = await page.evaluate(() => {
        const t = window.hchart.table!;
        return { headers: t.headers, rows: Array.from({ length: t.rowCount }, (_, i) => t.row(i)), pageSize: t.pageSize, caption: t.caption };
      });
      expect(model.headers).toEqual(['Path', 'Depth', 'Value', '% of Parent', '% of Root']);
      // hierarchy/reader.ts TABLE_PAGE: the reader pages its table by 100 rows, so this fixture's rows are all on the first page.
      expect(model.pageSize).toBe(100);
      expect(shown).toEqual(model.rows);
      expect(shown[6]).toEqual(['Company / Sales / Americas with a very long regional label', '2', '8 people', '40%', '8%']);
      expect(await page.$eval('#chart caption', c => c.textContent)).toBe('Headcount');
      // The full label is kept in the table even where the mark's label is cut or left out.
      expect((await axe(page)).violations).toEqual([]);
      expect(await closePage(page)).toEqual([]);
    } catch (error) { await closePage(page).catch(() => {}); throw error; }
  });

  it('a strict update that finds AX190 is rejected and the drilled view, focus and table stay', async () => {
    const page = await open(kind, MODES[0]!, { strict: true });
    try {
      const result = await page.evaluate(() => {
        const c = window.hchart;
        c.drill('Company/Sales');
        const before = JSON.stringify([c.drilled, c.focused, c.table!.row(6), c.breadcrumb, c.diagnostics]);
        let thrown = '';
        try { c.update({ data: { label: 'X', children: [{ label: 'bad', value: -1 }, { label: 'ok', value: 1 }] } } as never); } catch (e) { thrown = String(e); }
        return { thrown, same: before === JSON.stringify([c.drilled, c.focused, c.table!.row(6), c.breadcrumb, c.diagnostics]) };
      });
      expect(result.thrown).toMatch(/AX190/);
      expect(result.same).toBe(true);
      expect(await crumbs(page)).toEqual([['BUTTON', 'Company'], ['SPAN', 'Sales']]);
      expect(await closePage(page)).toEqual([]);
    } catch (error) { await closePage(page).catch(() => {}); throw error; }
  });
});

describe('activation by chart', () => {
  it('treemap: a leaf click selects in place; a click on the real branch header drills; the breadcrumb returns with focus', async () => {
    const page = await open('treemap');
    try {
      const leaf = await nodeCenter(page, 'treemap', 3);
      await page.mouse.click(leaf.x, leaf.y);
      await page.evaluate(() => window.nextFrames(1));
      expect(await page.evaluate(() => window.hevents)).toEqual(['select:Company/Engineering/Product']);
      expect(await crumbs(page)).toEqual([['SPAN', 'Company']]);
      expect(await page.evaluate(() => window.hchart.focused?.id)).toBe('Company/Engineering/Product');
      // Engineering's header strip: the top 18 px of its tile, above its children.
      const header = await page.evaluate(() => {
        const r = document.querySelector('#chart svg rect[data-node="1"]')!.getBoundingClientRect();
        const kids = [...document.querySelectorAll('#chart svg rect[data-node="2"], #chart svg rect[data-node="3"]')].map(e => e.getBoundingClientRect().top);
        return { x: r.left + 12, y: r.top + 8, childTop: Math.min(...kids) };
      });
      expect(header.y).toBeLessThan(header.childTop);
      await page.mouse.click(header.x, header.y);
      await page.evaluate(() => window.nextFrames(1));
      expect(await crumbs(page)).toEqual([['BUTTON', 'Company'], ['SPAN', 'Engineering']]);
      expect(await page.evaluate(() => window.hchart.drilled.id)).toBe('Company/Engineering');
      expect(await page.locator(markSelector('treemap')).count()).toBe(2);
      await page.click('#chart nav button[data-node="0"]');
      expect(await crumbs(page)).toEqual([['SPAN', 'Company']]);
      // The pressed crumb is gone: focus moves to the plot, on the node we came from.
      expect(await plotHasFocus(page)).toBe(true);
      expect(await page.evaluate(() => window.hchart.focused?.id)).toBe('Company/Engineering');
      expect(await axFocus(page)).toMatchObject({ focused: true, role: 'treeitem', level: 2 });
      expect(await page.evaluate(() => window.hevents)).toEqual(['select:Company/Engineering/Product', 'drill:Company/Engineering', 'drill:Company']);
      expect((await axe(page)).violations).toEqual([]);
      expect(await closePage(page)).toEqual([]);
    } catch (error) { await closePage(page).catch(() => {}); throw error; }
  });

  it('sunburst: a leaf arc is promoted by click and by Enter; the center and the breadcrumb go back up with focus', async () => {
    const page = await open('sunburst');
    try {
      const leaf = await nodeCenter(page, 'sunburst', 3);
      await page.mouse.click(leaf.x, leaf.y);
      await page.evaluate(() => window.nextFrames(1));
      expect(await page.evaluate(() => window.hchart.drilled.id)).toBe('Company/Engineering/Product');
      expect(await crumbs(page)).toEqual([['BUTTON', 'Company'], ['BUTTON', 'Engineering'], ['SPAN', 'Product']]);
      // Only the promoted leaf is drawn: one full disc.
      expect(await page.locator(markSelector('sunburst')).count()).toBe(1);
      // The center: one level up; the clicked plot keeps focus, on the node we came from.
      const box = (await page.locator('#chart .axylo-h-plot').boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.evaluate(() => window.nextFrames(1));
      expect(await page.evaluate(() => window.hchart.drilled.id)).toBe('Company/Engineering');
      expect(await plotHasFocus(page)).toBe(true);
      expect(await page.evaluate(() => window.hchart.focused?.id)).toBe('Company/Engineering/Product');
      // Enter on the same leaf promotes it again; Enter on the center goes up.
      await page.keyboard.press('Enter');
      expect(await page.evaluate(() => window.hchart.drilled.id)).toBe('Company/Engineering/Product');
      expect(await axFocus(page)).toMatchObject({ focused: true, role: 'treeitem', level: 1 });
      await page.keyboard.press('Enter');
      expect(await page.evaluate(() => window.hchart.drilled.id)).toBe('Company/Engineering');
      expect(await axFocus(page)).toEqual({ focused: true, role: 'treeitem', name: 'Company / Engineering / Product: 50 people. % of Parent 62.5%, % of Root 50%.', level: 2 });
      await page.click('#chart nav button[data-node="0"]');
      expect(await crumbs(page)).toEqual([['SPAN', 'Company']]);
      expect(await plotHasFocus(page)).toBe(true);
      expect(await page.evaluate(() => window.hchart.focused?.id)).toBe('Company/Engineering');
      expect(await axFocus(page)).toMatchObject({ focused: true, role: 'treeitem', level: 2 });
      expect(await page.evaluate(() => window.hevents)).toEqual([
        'drill:Company/Engineering/Product', 'drill:Company/Engineering', 'drill:Company/Engineering/Product', 'drill:Company/Engineering', 'drill:Company',
      ]);
      // Repair round 2: Enter on the top-level center goes to its first child, without drilling.
      await page.keyboard.press('ArrowUp');
      expect(await page.evaluate(() => window.hchart.focused?.id)).toBe('Company');
      await page.keyboard.press('Enter');
      expect(await page.evaluate(() => [window.hchart.drilled.id, window.hchart.focused?.id])).toEqual(['Company', 'Company/Engineering']);
      expect(await axFocus(page)).toMatchObject({ focused: true, role: 'treeitem', level: 2 });
      expect(await page.evaluate(() => window.hevents.length)).toBe(5);
      expect((await axe(page)).violations).toEqual([]);
      expect(await closePage(page)).toEqual([]);
    } catch (error) { await closePage(page).catch(() => {}); throw error; }
  });

  it('Escape with a pointer tooltip over a drilled child: dismissed and one level up on the same key', async () => {
    const page = await open('treemap');
    try {
      await page.evaluate(() => { window.hchart.drill('Company/Engineering'); });
      await page.focus('#chart .axylo-h-plot');
      // Drilling focuses the first child (Platform); the keyboard moves to Product, the pointer reads Platform.
      await page.keyboard.press('ArrowRight');
      expect(await page.evaluate(() => window.hchart.focused?.id)).toBe('Company/Engineering/Product');
      const at = await nodeCenter(page, 'treemap', 2);
      await page.mouse.move(at.x, at.y);
      expect((await tooltip(page)).node).toBe('2');
      await page.keyboard.press('Escape');
      expect(await page.evaluate(() => window.hchart.focused?.id)).toBe('Company/Engineering');
      const tip = await tooltip(page);
      expect(tip.hidden || tip.node !== '2').toBe(true);
      expect(await axFocus(page)).toMatchObject({ focused: true, role: 'treeitem', level: 1 });
      expect(await closePage(page)).toEqual([]);
    } catch (error) { await closePage(page).catch(() => {}); throw error; }
  });
});

describe('sunburst geometry in the browser', () => {
  it('starts at 12 o\'clock and runs clockwise: just right of the top is the first child, just left the last', async () => {
    const page = await open('sunburst');
    try {
      const box = (await page.locator('#chart .axylo-h-plot').boundingBox())!;
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      const ring = (Math.min(box.width, box.height) / 2 - 2) / 3;
      await page.mouse.move(cx + 6, cy - ring * 1.5);
      expect((await tooltip(page)).text).toContain('Company / Engineering');
      await page.mouse.move(cx - 6, cy - ring * 1.5);
      expect((await tooltip(page)).text).toContain('Company / Sales');
      // Clicking the center of a drilled sunburst goes up one level.
      await page.mouse.click(cx + 6, cy - ring * 1.5);
      expect(await page.evaluate(() => window.hchart.drilled.id)).toBe('Company/Engineering');
      await page.mouse.click(cx, cy);
      expect(await page.evaluate(() => window.hchart.drilled.id)).toBe('Company');
      expect(await closePage(page)).toEqual([]);
    } catch (error) { await closePage(page).catch(() => {}); throw error; }
  });
});
