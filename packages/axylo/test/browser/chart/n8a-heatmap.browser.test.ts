/**
 * N8a heatmap in system Chrome (cycle N8a verification bar): sequential and diverging heatmaps with missing and
 * invalid cells, the color bar, O(1) pointer hover with the exact value, the 2D keyboard grid, the matrix table's
 * semantics, axe-core in light, dark and forced colors (with the system colors the cells actually use), and the
 * 50,000-cell DOM cap. The module is bundled from source (openEntry); run after nothing else:
 *
 *   AXYLO_BROWSER=1 npx vitest run --configLoader native --no-cache packages/axylo/test/browser/chart/n8a-heatmap.browser.test.ts
 *
 * Expected values come from the fixtures below and the spec (F6 readouts, A4 table, A2 keyboard), not from a run.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BrowserContextOptions, Page } from 'playwright-core';
import { ENGINE, openEntry, start, stop } from '../harness';
import { startWithShortTmp, stopWithShortTmp } from '../acceptance/short-tmp';
import { axe } from '../a11y/util';

// A deep runner TMPDIR is too long for Chrome's socket on Linux; see acceptance/short-tmp.ts.
beforeAll(() => startWithShortTmp(start, { engine: ENGINE }));
afterAll(() => stopWithShortTmp(stop));

const ENTRY = 'packages/axylo/test/spatial/heatmap/browser.entry.ts';

const frames = (page: Page, n = 4) => page.evaluate((n: number) => new Promise<void>(resolve => {
  const step = (k: number) => (k === 0 ? resolve() : requestAnimationFrame(() => step(k - 1)));
  step(n);
}), n);

/**
 * Opens the entry and draws two heatmaps: #seq (4 days × 6 hours, one missing, one invalid) and #div (diverging),
 * both with 2 plot bins so the color bar's continuity cannot come from the bins. blank.html has two buttons and an
 * empty #chart directly in <body>; axe's page rules (region, page-has-heading-one, heading-order: a string title
 * is a level-3 heading) want a main landmark and the heading levels above, so the page gets them here, as
 * n3-interaction-a11y.browser.test.ts does, without editing the shared fixture.
 */
async function open(ctx: BrowserContextOptions = {}): Promise<Page> {
  const page = await openEntry(ENTRY, ctx);
  await page.evaluate(() => {
    const main = document.createElement('main');
    const h1 = Object.assign(document.createElement('h1'), { textContent: 'Heatmaps' });
    const h2 = Object.assign(document.createElement('h2'), { textContent: 'Panel' });
    const chart = document.getElementById('chart')!;
    chart.replaceWith(main);
    main.append(h1, h2, document.getElementById('before')!, document.getElementById('after')!);
    chart.remove();
    const box = (id: string) => {
      const el = main.insertBefore(document.createElement('div'), document.getElementById('after'));
      el.id = id;
      el.style.cssText = 'width: 640px; height: 420px; margin: 8px;';
      return el;
    };
    const days = ['Mon', 'Tue', 'Wed', 'Thu'], hours = ['00', '04', '08', '12', '16', '20'];
    const seq: { day: string; hour: string; load: unknown }[] = [];
    days.forEach((day, r) => hours.forEach((hour, c) => {
      const load = r === 1 && c === 2 ? null : r === 2 && c === 3 ? 'n/a' : r * 10 + c + 0.25;
      seq.push({ day, hour, load });
    }));
    const charts: Record<string, unknown> = {};
    (window as unknown as { hm: Record<string, unknown> }).hm = charts;
    charts.seq = window.N8A.heatmap(box('seq'), { title: 'Load by hour', data: seq, x: { field: 'hour', label: 'Hour' }, y: { field: 'day', label: 'Day' }, value: { field: 'load', label: 'Load' }, color: { bins: 2 } });
    const div: { day: string; hour: string; delta: number }[] = [];
    days.forEach((day, r) => hours.forEach((hour, c) => div.push({ day, hour, delta: (c - 2.5) * 4 + r })));
    charts.div = window.N8A.heatmap(box('div'), { title: 'Change by hour', data: div, x: 'hour', y: 'day', value: { field: 'delta', label: 'Change' }, color: { scheme: 'diverging', mid: 0, bins: 2 } });
  });
  await frames(page);
  return page;
}

/** The plot rectangle (the scene clip) in page coordinates, from the chart's own SVG. */
async function plotRect(page: Page, id: string) {
  return page.evaluate((id: string) => {
    const svg = document.querySelector<SVGSVGElement>(`#${id} svg.axylo-svg`)!;
    const clip = svg.querySelector('clipPath rect')!;
    const b = svg.getBoundingClientRect();
    const n = (k: string) => Number(clip.getAttribute(k));
    return { x: b.left + n('x'), y: b.top + n('y'), width: n('width'), height: n('height') };
  }, id);
}

describe('N8a heatmap in Chrome', () => {
  it('draws batched paths, the color bar with ticks and both swatches, and no page errors', async () => {
    const page = await open();
    const seq = await page.evaluate(() => {
      const root = document.querySelector('#seq')!;
      const paths = [...root.querySelectorAll('svg.axylo-svg path')].map(p => p.getAttribute('class') ?? '');
      return {
        bins: paths.filter(c => c.includes('axylo-heatmap-bin ')).length,
        missing: paths.filter(c => c === 'axylo-heatmap-missing').length,
        invalid: paths.filter(c => c === 'axylo-heatmap-invalid').length,
        ticks: [...root.querySelectorAll('.axylo-heatmap-tick')].map(t => t.textContent),
        swatches: [...root.querySelectorAll('.axylo-heatmap-swatch-label')].map(t => t.textContent),
      };
    });
    // 2 bins: the 22 finite values (0.25 … 35.25) fall on both sides of 17.75, so both bin paths are drawn.
    expect(seq.bins).toBe(2);
    expect([seq.missing, seq.invalid]).toEqual([1, 1]);
    // Range 0.25 … 35.25; midpoint 17.75.
    expect(seq.ticks).toEqual(['0.25', '17.75', '35.25']);
    expect(seq.swatches).toEqual(['No data', 'Invalid value']);
    // Diverging: symmetric about 0 over the larger distance (|−10| vs 13): −13 … 0 … 13.
    const ticks = await page.evaluate(() => [...document.querySelectorAll('#div .axylo-heatmap-tick')].map(t => t.textContent));
    expect(ticks).toEqual(['-13', '0', '13']);
    expect((page as Page & { errors: string[] }).errors).toEqual([]);
  });

  it('the color bar is one continuous gradient of the live palette, interpolated inside, for 2-bin plots', async () => {
    const page = await open();
    const bars = await page.evaluate(() => ['seq', 'div'].map(id => {
      const root = document.querySelector(`#${id}`)!;
      const fills = [...root.querySelectorAll<SVGRectElement>('.axylo-heatmap-bar-fill')];
      const ref = fills[0] ? getComputedStyle(fills[0]).fill : '';
      const gid = /url\("?[^#")]*#([^")]+)"?\)/.exec(ref)?.[1] ?? '';
      const gradient = document.getElementById(gid);
      const stops = gradient ? [...gradient.querySelectorAll('stop')] : [];
      const tickBox = [...root.querySelectorAll<HTMLElement>('.axylo-heatmap-tick')].map(t => t.getBoundingClientRect());
      const barBox = fills[0]?.getBoundingClientRect();
      return {
        fills: fills.length, gid, inside: gradient ? root.contains(gradient) : false, tag: gradient?.tagName ?? '',
        offsets: stops.map(s => Number(s.getAttribute('offset'))),
        colors: stops.map(s => getComputedStyle(s).stopColor),
        // Tick centres (or edges, for the ends) relative to the bar: left, middle, right.
        ticks: barBox ? tickBox.map(b => [(b.left - barBox.left) / barBox.width, (b.right - barBox.left) / barBox.width]) : [],
      };
    }));
    for (const bar of bars) {
      expect(bar.fills).toBe(1);
      expect(bar.tag).toBe('linearGradient');
      expect(bar.inside).toBe(true);
      expect(bar.offsets).toEqual(Array.from({ length: 17 }, (_, i) => i / 16));
      // Adjacent stops differ (a gradient, not two flat halves), and an interior stop is neither end.
      for (let i = 1; i < bar.colors.length; i++) expect(bar.colors[i], `stop ${i}`).not.toBe(bar.colors[i - 1]);
      expect(bar.colors[6]).not.toBe(bar.colors[0]);
      expect(bar.colors[6]).not.toBe(bar.colors[16]);
      // Ticks: low at the left edge, middle centred, high at the right edge.
      const [low, mid, high] = bar.ticks as [number[], number[], number[]];
      expect(low[0]!).toBeCloseTo(0, 1);
      expect((mid[0]! + mid[1]!) / 2).toBeCloseTo(0.5, 1);
      expect(high[1]!).toBeCloseTo(1, 1);
    }
    // Two charts, two gradients of their own.
    expect(bars[0]!.gid).not.toBe(bars[1]!.gid);
    // The anchors land exactly on stops 0, 8 and 16 (the default palette, no page override).
    expect([bars[0]!.colors[0], bars[0]!.colors[8], bars[0]!.colors[16]]).toEqual(['rgb(68, 1, 84)', 'rgb(33, 145, 140)', 'rgb(253, 231, 37)']);
    expect([bars[1]!.colors[0], bars[1]!.colors[8], bars[1]!.colors[16]]).toEqual(['rgb(43, 92, 158)', 'rgb(242, 242, 242)', 'rgb(168, 52, 63)']);
    // Live palette: a page override of one anchor restyles the bar without a redraw.
    const restyled = await page.evaluate(() => {
      document.querySelector<HTMLElement>('#seq')!.style.setProperty('--axylo-sequential-2', 'rgb(255, 0, 0)');
      const gid = /url\("?[^#")]*#([^")]+)"?\)/.exec(getComputedStyle(document.querySelector('#seq .axylo-heatmap-bar-fill')!).fill)![1]!;
      return getComputedStyle(document.getElementById(gid)!.querySelectorAll('stop')[8]!).stopColor;
    });
    expect(restyled).toBe('rgb(255, 0, 0)');
    // A repaint (new data) keeps one gradient per chart and the same id; the visible ticks are the exported ones.
    const after = await page.evaluate(async (before: string) => {
      const chart = (window as unknown as { hm: Record<string, { update(p: unknown): void }> }).hm.seq!;
      const days = ['Mon', 'Tue'], hours = ['00', '04'];
      chart.update({ data: days.flatMap((day, r) => hours.map((hour, c) => ({ day, hour, load: (r * 2 + c) * 100 }))) });
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return {
        count: document.querySelectorAll('#seq linearGradient').length, same: document.getElementById(before)?.tagName ?? '',
        ticks: [...document.querySelectorAll('#seq .axylo-heatmap-tick')].map(t => t.textContent),
        exported: window.N8A.heatmapInternals(chart as never)!.legend()!.ticks.map(t => t.label),
      };
    }, bars[0]!.gid);
    expect(after).toEqual({ count: 1, same: 'linearGradient', ticks: ['0', '150', '300'], exported: ['0', '150', '300'] });
  });

  it('table: false: the color bar is seen exactly when ready and fitting, across loading, resizes and legend toggles, and the layout settles', async () => {
    const page = await open();
    await page.evaluate(() => {
      const box = document.querySelector('main')!.insertBefore(document.createElement('div'), document.getElementById('after'));
      box.id = 'live';
      box.style.cssText = 'width: 640px; height: 420px; margin: 8px;';
      const data = ['Mon', 'Tue'].flatMap((day, r) => ['00', '04'].map((hour, c) => ({ day, hour, load: r * 2 + c })));
      (window as unknown as { hm: Record<string, unknown> }).hm.live =
        window.N8A.heatmap(box, { title: 'Live', data, x: 'hour', y: 'day', value: 'load', table: false, state: 'loading' });
    });
    await frames(page, 6);
    // What a reader sees, and how many mutations the chart makes over 10 further frames (0: nothing oscillates).
    const look = () => page.evaluate(async () => {
      const root = document.getElementById('live')!;
      const chart = (window as unknown as { hm: Record<string, object> }).hm.live!;
      const list = root.querySelector<HTMLElement>('.axylo-heatmap-legend');
      // Too small, the bar keeps its room but is hidden to readers (visibility and aria-hidden): not seen.
      const seen = !!list && list.getClientRects().length > 0 && getComputedStyle(list).display !== 'none' && list.offsetHeight > 0 &&
        getComputedStyle(list).visibility !== 'hidden' && list.closest('[aria-hidden="true"]') === null;
      let mutations = 0;
      const observer = new MutationObserver(records => { mutations += records.length; });
      observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
      await new Promise<void>(resolve => { let k = 10; const step = () => (--k ? requestAnimationFrame(step) : resolve()); requestAnimationFrame(step); });
      observer.disconnect();
      return {
        seen,
        ticks: seen ? [...list!.querySelectorAll('.axylo-heatmap-tick')].map(t => t.textContent) : null,
        exported: window.N8A.heatmapInternals(chart)!.legend()?.ticks.map(t => t.label) ?? null,
        mutations,
      };
    });
    const act = async (patch: unknown, size?: [number, number]) => {
      await page.evaluate(([patch, size]) => {
        const box = document.getElementById('live')!;
        if (size) { box.style.width = `${size[0]}px`; box.style.height = `${size[1]}px`; }
        if (patch) (window as unknown as { hm: Record<string, { update(p: unknown): void }> }).hm.live!.update(patch);
      }, [patch, size ?? null] as const);
      await frames(page, 8);
      return look();
    };
    const READY = { seen: true, ticks: ['0', '1.5', '3'], exported: ['0', '1.5', '3'], mutations: 0 };
    expect(await look()).toEqual({ seen: false, ticks: null, exported: null, mutations: 0 });
    expect(await act({ state: undefined })).toEqual(READY);
    expect(await act({ state: 'loading' })).toEqual({ seen: false, ticks: null, exported: null, mutations: 0 });
    expect(await act({ state: undefined })).toEqual(READY);
    // Below the plot minimum (L8 fallback): not seen; export keeps the scale (chart.ts policy).
    expect(await act(null, [150, 110])).toEqual({ seen: false, ticks: null, exported: ['0', '1.5', '3'], mutations: 0 });
    expect(await act(null, [640, 420])).toEqual(READY);
    expect(await act({ legend: false })).toEqual({ seen: false, ticks: null, exported: null, mutations: 0 });
    expect(await act({ legend: 'right' })).toEqual(READY);
    expect(await act({ legend: 'top' })).toEqual(READY);
    expect((page as Page & { errors: string[] }).errors).toEqual([]);
  });

  it('at a fixed host size, turning the legend off or moving it from the fallback gives the geometry of a fresh chart with that legend', async () => {
    const page = await open();
    // `plot` is the drawn plot, not the clip node: render/svg.ts builds the clip rect before any scene and keeps it
    // (possibly 0 × 0) through the L8 fallback, so a plot is only counted when the fallback summary is not shown,
    // the clip has a positive size and the scene has at least one bin path with a nonempty `d`.
    type Shot = {
      fallback: boolean;
      plot: { width: number; height: number; bins: number } | null;
      seen: boolean; mutations: number;
    };
    const shot = (id: string) => page.evaluate(async (id: string): Promise<Shot> => {
      const root = document.getElementById(id)!;
      const summary = root.querySelector<HTMLElement>('.axylo-summary');
      const fallback = !!summary && !summary.classList.contains('axylo-visually-hidden') && (summary.textContent ?? '').trim() !== '';
      const clip = root.querySelector('svg.axylo-svg clipPath rect');
      const width = clip ? Number(clip.getAttribute('width')) : 0, height = clip ? Number(clip.getAttribute('height')) : 0;
      const bins = [...root.querySelectorAll('svg.axylo-svg .axylo-scene path.axylo-heatmap-bin')]
        .filter(path => (path.getAttribute('d') ?? '').trim() !== '').length;
      const list = root.querySelector<HTMLElement>('.axylo-heatmap-legend');
      const seen = !!list && list.offsetHeight > 0 && getComputedStyle(list).visibility !== 'hidden' && list.closest('[aria-hidden="true"]') === null;
      let mutations = 0;
      const observer = new MutationObserver(records => { mutations += records.length; });
      observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
      await new Promise<void>(resolve => { let k = 10; const step = () => (--k ? requestAnimationFrame(step) : resolve()); requestAnimationFrame(step); });
      observer.disconnect();
      const plot = !fallback && width > 0 && height > 0 && bins > 0 ? { width, height, bins } : null;
      return { fallback, plot, seen, mutations };
    }, id);
    const make = (id: string, height: number, legend: 'bottom' | 'top' | 'right' | false) => page.evaluate(([id, height, legend]) => {
      const box = document.querySelector('main')!.insertBefore(document.createElement('div'), document.getElementById('after'));
      box.id = id;
      box.style.cssText = `width: 640px; height: ${height}px; margin: 8px;`;
      const data = ['Mon', 'Tue', 'Wed'].flatMap((day, r) => ['00', '04', '08'].map((hour, c) => ({ day, hour, load: r * 3 + c })));
      (window as unknown as { hm: Record<string, unknown> }).hm[id] =
        window.N8A.heatmap(box, { title: 'Fixed', data, x: 'hour', y: 'day', value: 'load', table: false, legend });
    }, [id, height, legend] as const);
    const drop = (id: string) => page.evaluate((id: string) => {
      (window as unknown as { hm: Record<string, { destroy(): void }> }).hm[id]!.destroy();
      document.getElementById(id)!.remove();
    }, id);
    const cases: string[] = [];
    // Cases that start in the fallback and turn the legend off / move or add it; and those that then plot.
    let fromFallbackOff = 0, fromFallbackMoved = 0, leftFallback = 0;
    let n = 0;
    for (const height of [110, 130, 150, 170, 190, 210, 230]) {
      for (const [first, last] of [['bottom', false], ['bottom', 'right'], ['top', false], [false, 'bottom']] as const) {
        const fresh = `fresh${n}`, moved = `moved${n++}`;
        await make(fresh, height, last);
        await make(moved, height, first);
        await frames(page, 8);
        const before = await shot(moved);
        await page.evaluate(([id, legend]) => (window as unknown as { hm: Record<string, { update(p: unknown): void }> }).hm[id]!.update({ legend }), [moved, last] as const);
        await frames(page, 8);
        const reference = await shot(fresh);
        const after = await shot(moved);
        const label = `${height}px: ${String(first)} → ${String(last)}`;
        cases.push(`${label}: before ${JSON.stringify(before)} after ${JSON.stringify(after)} fresh ${JSON.stringify(reference)}`);
        const log = `\n${cases.join('\n')}`;
        // Exactly one of the two states holds: a drawn plot or the fallback summary.
        expect(before.fallback !== (before.plot !== null), `${label} before${log}`).toBe(true);
        expect(after.fallback !== (after.plot !== null), `${label} after${log}`).toBe(true);
        expect(before.mutations, `${label} before settles${log}`).toBe(0);
        expect(after, `${label}${log}`).toEqual(reference);
        expect(after.mutations, `${label} after settles${log}`).toBe(0);
        if (before.fallback) {
          if (last === false) fromFallbackOff++;
          else fromFallbackMoved++;
          if (!after.fallback) leftFallback++;
        }
        await drop(fresh);
        await drop(moved);
      }
    }
    const log = `\n${cases.join('\n')}`;
    // Both kinds of change are made from the fallback, and at least one leaves it for a drawn plot (the reported case).
    expect(fromFallbackOff, `legend turned off from the fallback${log}`).toBeGreaterThan(0);
    expect(fromFallbackMoved, `legend moved or added from the fallback${log}`).toBeGreaterThan(0);
    expect(leftFallback, `fallback left by a legend change${log}`).toBeGreaterThan(0);
    expect((page as Page & { errors: string[] }).errors).toEqual([]);
  });

  it('hover shows the exact value of the cell under the pointer (O(1) pick), missing as No data', async () => {
    const page = await open();
    const p = await plotRect(page, 'seq');
    const cell = (r: number, c: number) => ({ x: p.x + (c + 0.5) * p.width / 6, y: p.y + (r + 0.5) * p.height / 4 });
    const tooltip = () => page.evaluate(() => (document.querySelector('#seq .axylo-tooltip') as HTMLElement | null)?.innerText ?? '');
    const at = cell(3, 5);
    await page.mouse.move(at.x, at.y);
    await frames(page);
    expect(await tooltip()).toContain('Thu, 20');
    expect(await tooltip()).toContain('35.25');
    const missing = cell(1, 2);
    await page.mouse.move(missing.x, missing.y);
    await frames(page);
    expect(await tooltip()).toContain('No data');
  });

  it('moves over the 2D grid with the arrow keys, Home and End, reading row, column and exact value', async () => {
    const page = await open();
    await page.focus('#seq .axylo-proxy');
    await frames(page);
    const reading = () => page.evaluate(() => document.querySelector('#seq .axylo-proxy')!.getAttribute('aria-valuetext'));
    expect(await reading()).toBe('Day Mon (row 1 of 4), Hour 00 (column 1 of 6), 0.25. Cell 1 of 24.');
    for (const [key, want] of [
      ['ArrowRight', 'Day Mon (row 1 of 4), Hour 04 (column 2 of 6), 1.25. Cell 2 of 24.'],
      ['ArrowDown', 'Day Tue (row 2 of 4), Hour 04 (column 2 of 6), 11.25. Cell 8 of 24.'],
      ['ArrowRight', 'Day Tue (row 2 of 4), Hour 08 (column 3 of 6), No data. Cell 9 of 24.'],
      ['End', 'Day Tue (row 2 of 4), Hour 20 (column 6 of 6), 15.25. Cell 12 of 24.'],
      ['ArrowRight', 'Day Tue (row 2 of 4), Hour 20 (column 6 of 6), 15.25. Cell 12 of 24.'],
      ['ArrowDown', 'Day Wed (row 3 of 4), Hour 20 (column 6 of 6), 25.25. Cell 18 of 24.'],
      ['Home', 'Day Wed (row 3 of 4), Hour 00 (column 1 of 6), 20.25. Cell 13 of 24.'],
      ['ArrowLeft', 'Day Wed (row 3 of 4), Hour 00 (column 1 of 6), 20.25. Cell 13 of 24.'],
      ['ArrowUp', 'Day Tue (row 2 of 4), Hour 00 (column 1 of 6), 10.25. Cell 7 of 24.'],
    ] as const) {
      await page.keyboard.press(key);
      await frames(page, 2);
      expect(await reading(), key).toBe(want);
    }
  });

  it('opens a matrix table: one column header per hour, the day as row header, exact values and No data', async () => {
    const page = await open();
    await page.locator('#seq button', { hasText: 'View as table' }).click();
    await frames(page);
    const table = await page.evaluate(() => {
      const t = document.querySelector('#seq table')!;
      return {
        cols: [...t.querySelectorAll('th[scope="col"]')].map(th => th.textContent),
        rows: [...t.querySelectorAll('th[scope="row"]')].map(th => th.textContent),
        tue: [...t.querySelectorAll('tbody tr')][1] ? [...[...t.querySelectorAll('tbody tr')][1]!.querySelectorAll('td')].map(td => td.textContent) : [],
        wed: [...t.querySelectorAll('tbody tr')][2] ? [...[...t.querySelectorAll('tbody tr')][2]!.querySelectorAll('td')].map(td => td.textContent) : [],
      };
    });
    expect(table.cols).toEqual(['Day', '00', '04', '08', '12', '16', '20']);
    expect(table.rows).toEqual(['Mon', 'Tue', 'Wed', 'Thu']);
    expect(table.tue).toEqual(['10.25', '11.25', 'No data', '13.25', '14.25', '15.25']);
    expect(table.wed[3]).toBe('Invalid value ("n/a")');
  });

  for (const [name, ctx] of [
    ['light', { colorScheme: 'light' }], ['dark', { colorScheme: 'dark' }], ['forced colors', { forcedColors: 'active' }],
  ] as const) {
    it(`axe-core reports no violations (${name})`, async () => {
      const page = await open(ctx as BrowserContextOptions);
      await page.locator('#seq button', { hasText: 'View as table' }).click();
      await frames(page);
      const { violations, ran } = await axe(page);
      expect(violations).toEqual([]);
      expect(ran.length).toBeGreaterThan(10);
    });
  }

  it('in forced colors, cells and hatches use system colors distinct from the background, and the summary points to exact values', async () => {
    const page = await open({ forcedColors: 'active' });
    const paint = await page.evaluate(() => {
      const root = document.querySelector('#seq')!;
      const bin = root.querySelector<SVGPathElement>('path.axylo-heatmap-bin')!;
      const missing = root.querySelector<SVGPathElement>('path.axylo-heatmap-missing')!;
      const bg = root.querySelector<SVGRectElement>('rect.axylo-background')!;
      // The system colors, resolved by Chrome on a probe element.
      const probe = document.body.appendChild(document.createElement('div'));
      probe.style.setProperty('forced-color-adjust', 'none');
      probe.style.setProperty('color', 'CanvasText');
      probe.style.setProperty('background-color', 'Canvas');
      const sys = { text: getComputedStyle(probe).color, canvas: getComputedStyle(probe).backgroundColor };
      probe.remove();
      return {
        sys, binFill: getComputedStyle(bin).fill, missingStroke: getComputedStyle(missing).stroke, missingFill: getComputedStyle(missing).fill,
        // The full summary is the figure's description (aria-describedby), not the small-plot fallback paragraph.
        background: getComputedStyle(bg).fill,
        summary: document.getElementById(root.querySelector('figure.axylo-figure')?.getAttribute('aria-describedby') ?? '')?.textContent ?? '',
      };
    });
    expect(paint.binFill).toBe(paint.sys.text);
    expect(paint.missingStroke).toBe(paint.sys.text);
    expect(paint.missingFill).toBe('none');
    expect(paint.background).toBe(paint.sys.canvas);
    expect(paint.binFill).not.toBe(paint.background);
    expect(paint.summary).toContain('exact value');
    expect(paint.summary).toContain('table');
  });

  it('keeps a 250 × 200 heatmap (50,000 cells) to at most 80 SVG nodes, and records its build time', async () => {
    const page = await openEntry(ENTRY);
    const result = await page.evaluate(async () => {
      const el = document.body.appendChild(document.createElement('div'));
      el.id = 'dense';
      el.style.cssText = 'width: 900px; height: 640px;';
      const n = 250 * 200, r = new Array<string>(n), c = new Array<string>(n), v = new Float64Array(n);
      for (let i = 0; i < 250; i++) for (let j = 0; j < 200; j++) {
        const k = i * 200 + j;
        r[k] = `r${i}`; c[k] = `c${j}`; v[k] = Math.sin(i / 17) * 50 + Math.cos(j / 23) * 50;
      }
      const t0 = performance.now();
      window.N8A.heatmap(el, { title: 'Dense', data: { columns: { r, c, v } }, x: 'c', y: 'r', value: 'v' } as never);
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const ms = performance.now() - t0;
      const svg = el.querySelector('svg.axylo-svg')!;
      const nodes = svg.querySelectorAll('*').length + 1;
      const bytes = [...svg.querySelectorAll('path')].reduce((s, p) => s + (p.getAttribute('d') ?? '').length, 0);
      return { nodes, paths: svg.querySelectorAll('path').length, ms, bytes };
    });
    console.log(`[n8a-ledger] Chrome 250x200 typed, 900x640: create→2 frames ${result.ms.toFixed(1)} ms, ${result.nodes} SVG nodes, ${result.paths} paths, d bytes ${result.bytes}`);
    expect(result.nodes).toBeLessThanOrEqual(80);
    expect(result.paths).toBeLessThanOrEqual(34);
  });
});
