/**
 * Packed real-Chrome browser integration test for Campaign 5 (`axylo/stats` + `axylo/cartesian`
 * ranges/errorBars/annotations + `axylo/sync` linked hover/zoom + 0/0/0 teardown under strict CSP).
 *
 * N5 cases (second describe, own page and bundle; the sync cases above are unchanged): one legend entry per
 * range / error bar that hides the whole mark, the native boxplot (boxes, medians, whiskers, outliers) with
 * tooltip, keyboard, table and axe-core parity, the scatter layer on a log right axis, and malformed annotations
 * (AX150 / AX103) with strict rollback. The `scatter` and `boxplot` layers are typed by the packed
 * `CartesianLayerOptions`; the packed declarations are compiled strictly in subpaths.test.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bundle, closeBrowser, cspPolicy, launch, open, startServer, type Server } from './browser';
import { fixture, repo } from './paths';

let server: Server;
let scriptUrl: string;
let n5Url: string;
let w3Url: string;
const axeSource = fs.readFileSync(path.join(repo, 'node_modules/axe-core/axe.min.js'), 'utf8');

beforeAll(async () => {
  server = await startServer();
  await launch();
  scriptUrl = (await bundle({
    name: 'c5-e2e',
    cwd: fixture('npm'),
    format: 'esm',
    conditions: ['production'],
    contents: `
      import { line } from 'axylo/static';
      import { cartesian } from 'axylo/cartesian';
      import { boxplot } from 'axylo/stats';
      import { createSyncGroup } from 'axylo/sync';

      const cBox = document.getElementById('box')!;
      cBox.style.width = '640px';
      cBox.style.height = '300px';

      const samples = [
        { team: 'Core', ms: 10 }, { team: 'Core', ms: 12 }, { team: 'Core', ms: 14 }, { team: 'Core', ms: 16 }, { team: 'Core', ms: 48 },
        { team: 'Edge', ms: 20 }, { team: 'Edge', ms: 24 }, { team: 'Edge', ms: 26 }, { team: 'Edge', ms: 30 }, { team: 'Edge', ms: 34 },
      ];
      const box = boxplot(samples, { x: 'team', y: 'ms' });

      const boxChart = cartesian('#box', {
        title: 'Latency Distribution',
        data: box.data,
        x: { field: 'x', ordered: true },
        axes: { ms: { position: 'left', label: 'Latency', unit: 'ms' } },
        layers: [
          { type: 'range', low: 'q1', high: 'q3', yAxis: 'ms', label: 'IQR' },
          { type: 'errorBar', y: 'median', low: 'whiskerLow', high: 'whiskerHigh', yAxis: 'ms', label: 'Whiskers' },
        ],
        annotations: [
          { type: 'threshold', axis: 'y', value: 25, axisId: 'ms', label: 'SLO 25ms', description: 'Target p50 threshold' },
        ],
      });

      // Two synced numeric line charts for C5.3 linked zoom, peer detach, and 0/0/0 teardown check
      const cA = document.getElementById('syncA')!;
      const cB = document.getElementById('syncB')!;
      cA.style.width = '480px'; cA.style.height = '220px';
      cB.style.width = '480px'; cB.style.height = '220px';
      const rows = Array.from({ length: 12 }, (_, i) => ({ t: i + 1, a: 10 + i * 2, b: 100 - i * 3 }));
      const zoomEvents: string[] = [];

      const chartA = line('#syncA', { title: 'Chart A', data: rows, x: { field: 't', unit: 's' }, y: 'a' });
      const chartB = line('#syncB', { title: 'Chart B', data: rows, x: { field: 't', unit: 's' }, y: 'b' });
      const group = createSyncGroup();
      const detachA = group.attach(chartA, { id: 'A', xKind: 'number', xUnit: 's', onZoomSync: (d) => zoomEvents.push('A:' + JSON.stringify(d)) });
      const detachB = group.attach(chartB, { id: 'B', xKind: 'number', xUnit: 's', onZoomSync: (d) => zoomEvents.push('B:' + JSON.stringify(d)) });

      (window as unknown as Record<string, unknown>).__c5 = {
        boxChart, chartA, chartB, group, detachA, detachB, zoomEvents,
      };
    `,
  })).url;
  n5Url = (await bundle({
    name: 'c5-n5',
    cwd: fixture('npm'),
    format: 'esm',
    conditions: ['production'],
    contents: `
      import { cartesian } from 'axylo/cartesian';
      import { boxplot } from 'axylo/stats';

      for (const id of ['iv', 'bx', 'sc', 'ann']) {
        const el = document.getElementById(id)!;
        el.style.width = '640px';
        el.style.height = '320px';
      }

      const iv = cartesian('#iv', {
        title: 'Intervals',
        data: [
          { x: 1, lo: 10, hi: 30, m: 60, elo: 55, ehi: 65, t: 200 },
          { x: 2, lo: 40, hi: 20, m: 70, elo: 65, ehi: 75, t: 210 },
          { x: 3, lo: 15, hi: 500, m: 80, elo: 75, ehi: 85, t: 220 },
          { x: 4, lo: 25, hi: 45, m: 90, elo: 85, ehi: 95, t: 230 },
        ],
        x: 'x',
        axes: { v: { position: 'left', unit: 'ms' } },
        layers: [
          { type: 'range', low: 'lo', high: 'hi', yAxis: 'v', label: 'Band' },
          { type: 'errorBar', y: 'm', low: 'elo', high: 'ehi', yAxis: 'v', label: 'Err' },
          { type: 'line', y: { field: 't', label: 'Trend' }, yAxis: 'v' },
        ],
      });

      const samples = { A: [1, 2, 3, 4, 5, 6, 7, 8, 9, 30], B: [10, 11, 12, 13, 14], C: [-20, 2, 4, 6, 8] };
      const rows = Object.entries(samples).flatMap(([g, values]) => values.map(v => ({ g, v })));
      const stats = boxplot(rows, { x: 'g', y: 'v' });
      const bx = cartesian('#bx', {
        title: 'Spread by group',
        data: { columns: { ...stats.data.columns, outliers: stats.groups.map(g => g.summary.outliers) } },
        x: 'x',
        axes: { v: { position: 'left' } },
        layers: [
          { type: 'boxplot', min: 'whiskerLow', q1: 'q1', median: 'median', q3: 'q3', max: 'whiskerHigh', outliers: 'outliers', yAxis: 'v', label: 'Spread' },
          { type: 'scatter', y: 'mean', yAxis: 'v', label: 'Mean' },
        ],
      });

      const sc = cartesian('#sc', {
        title: 'Scatter on a log axis',
        data: [{ x: 1, a: 1, b: 10 }, { x: 2, a: 2, b: 20 }, { x: 3, a: -1, b: 30 }, { x: 4, a: 4, b: 40 }, { x: 5, a: 8, b: 50 }],
        x: 'x',
        axes: { l: { position: 'left' }, r: { position: 'right', scale: 'log' } },
        layers: [
          { type: 'line', y: 'b', yAxis: 'l' },
          { type: 'scatter', y: 'a', yAxis: 'r', label: 'Points' },
        ],
      });

      const ann = cartesian('#ann', {
        title: 'Annotated',
        data: [{ x: 1, y: 1 }, { x: 2, y: 4 }, { x: 3, y: 9 }],
        x: 'x',
        axes: { v: { position: 'left' } },
        layers: [{ type: 'line', y: 'y', yAxis: 'v' }],
        annotations: [{ type: 'point', x: 2, y: 4, label: 'Peak' }],
      });

      // The series of the last hover event per chart: which mark won the pick, as the public API reports it.
      const hovers: Record<string, string | null> = {};
      bx.on('hover', p => { hovers.bx = p ? p.series : null; });
      sc.on('hover', p => { hovers.sc = p ? p.series : null; });
      (window as unknown as Record<string, unknown>).__n5 = { iv, bx, sc, ann, hovers };
    `,
  })).url;
  w3Url = (await bundle({
    name: 'c5-w3',
    cwd: fixture('npm'),
    format: 'esm',
    conditions: ['production'],
    contents: `
      import { cartesian } from 'axylo/cartesian';

      for (const id of ['rx', 'lone', 'loneErr', 'layer', 'nine']) {
        const el = document.getElementById(id)!;
        el.style.width = '640px';
        el.style.height = '320px';
      }
      type Payload = { series: string; x: unknown; y: number | null; index: number; row: unknown } | null;
      const events: Record<string, Payload[]> = { hover: [], select: [], layer: [] };
      const keep = (p: Payload) => p && { series: p.series, x: p.x, y: p.y, index: p.index, row: p.row };

      const rx = cartesian('#rx', {
        title: 'Repeated x',
        data: [{ x: 1, y: 2 }, { x: 1, y: 3 }, { x: 2, y: 4 }],
        x: 'x',
        axes: { v: { position: 'left', domain: [0, 5] } },
        layers: [{ type: 'scatter', y: 'y', yAxis: 'v', label: 'Pts' }],
      });
      rx.on('hover', p => { if (p) events.hover!.push(keep(p)); });
      rx.on('select', p => { events.select!.push(keep(p)); });

      const lone = cartesian('#lone', {
        title: 'Lone band',
        data: [{ x: 1, lo: 10, hi: 30 }, { x: 2, lo: 20, hi: 40 }, { x: 3, lo: 15, hi: 35 }],
        x: 'x',
        axes: { v: { position: 'left' } },
        layers: [{ type: 'range', low: 'lo', high: 'hi', yAxis: 'v', label: 'Band' }],
      });

      const loneErr = cartesian('#loneErr', {
        title: 'Lone error bar',
        data: [{ x: 1, m: 20, lo: 10, hi: 30 }, { x: 2, m: 30, lo: 20, hi: 40 }, { x: 3, m: 25, lo: 15, hi: 35 }],
        x: 'x',
        axes: { v: { position: 'left' } },
        layers: [{ type: 'errorBar', y: 'm', low: 'lo', high: 'hi', yAxis: 'v', label: 'Spread' }],
      });

      const layer = cartesian('#layer', {
        title: 'Layered',
        data: [{ x: 1, b: 10, a: 80 }, { x: 2, b: 20, a: 80 }, { x: 3, b: 30, a: 80 }],
        x: 'x',
        axes: { v: { position: 'left', domain: [0, 100] } },
        layers: [{ type: 'line', y: 'b', yAxis: 'v' }, { type: 'scatter', y: 'a', yAxis: 'v', label: 'Points' }],
      });
      layer.on('hover', p => { events.layer!.push(keep(p)); });

      const lines = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8'];
      const nine = cartesian('#nine', {
        title: 'Nine',
        data: [1, 2, 3].map(x => ({ x, l1: x, l2: x + 1, l3: x + 2, l4: x + 3, l5: x + 4, l6: x + 5, l7: x + 6, l8: x + 7, lo: 20, hi: 80, m: x === 3 ? null : 50, elo: 20, ehi: 80 })),
        x: 'x',
        axes: { v: { position: 'left', domain: [0, 100] } },
        layers: [
          { type: 'line', y: 'l1', yAxis: 'v' }, ...lines.slice(1).map(f => ({ type: 'line' as const, y: f as 'l2', yAxis: 'v' as const })),
          { type: 'range', low: 'lo', high: 'hi', yAxis: 'v', label: 'Band' },
          // A tenth series: an error bar whose centre is missing at x = 3 while its bounds are there.
          { type: 'errorBar', y: 'm', low: 'elo', high: 'ehi', yAxis: 'v', label: 'Err' },
        ],
      });
      (window as unknown as Record<string, unknown>).__w3 = { rx, lone, loneErr, layer, nine, events };
    `,
  })).url;
});

afterAll(async () => {
  await closeBrowser();
  await server?.close();
});

describe('Campaign 5 packed Chrome integration (stats + ranges + annotations + sync)', () => {
  it('renders boxplot via cartesian range/errorBar + annotations and verifies linked sync + 0/0/0 teardown under strict CSP', async () => {
    server.pages.set('/c5.html', {
      html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/npm/node_modules/axylo/dist/axylo.css"></head><body><div id="box"></div><div id="syncA"></div><div id="syncB"></div><script type="module" src="${scriptUrl}"></script></body></html>`,
      headers: { 'content-security-policy': cspPolicy('c5') },
    });

    const watched = await open(server);
    const { page, errors } = watched;
    await page.goto(`${server.origin}/c5.html`);
    try {
      await page.waitForSelector('#box svg g path');
      await page.waitForSelector('#syncA svg g path');
      await page.waitForSelector('#syncB svg g path');
      await page.waitForTimeout(120);

      const state = await page.evaluate(() => {
        const fig = document.querySelector('#box [aria-describedby]');
        const id = fig?.getAttribute('aria-describedby');
        const summary = (id ? document.getElementById(id)?.textContent : '') ?? '';
        const textLayer = document.querySelector('#box .axylo-text')?.textContent ?? '';
        const paths = document.querySelectorAll('#box svg g path').length;
        return { summary, textLayer, paths };
      });
      expect(state.paths).toBeGreaterThanOrEqual(2);
      expect(state.textLayer).toContain('SLO 25ms');
      expect(state.summary).toContain('Threshold SLO 25ms at y = 25 ms — Target p50 threshold.');

      // Trigger linked zoom from A -> B (single propagation, zero feedback loop!)
      const syncResult = await page.evaluate(() => {
        const api = (window as unknown as {
          __c5: {
            chartA: { zoom(d: [number, number] | null): void; destroy(): void };
            chartB: { zoom(d: [number, number] | null): void; destroy(): void };
            boxChart: { destroy(): void };
            group: { size: number; destroy(): void };
            detachB: () => void;
            zoomEvents: string[];
          };
        }).__c5;
        api.chartA.zoom([3, 8]);
        const afterZoom = [...api.zoomEvents];
        // Detach B and verify group size drops to 1 and surviving peer stays intact
        api.detachB();
        const sizeAfterDetach = api.group.size;
        api.group.destroy();
        const sizeAfterDestroy = api.group.size;
        api.chartA.destroy();
        api.chartB.destroy();
        api.boxChart.destroy();
        const leftoverNodes = document.getElementById('box')!.childNodes.length
          + document.getElementById('syncA')!.childNodes.length
          + document.getElementById('syncB')!.childNodes.length;
        return { afterZoom, sizeAfterDetach, sizeAfterDestroy, leftoverNodes };
      });
      expect(syncResult.afterZoom).toEqual(['B:[3,8]']);
      expect(syncResult.sizeAfterDetach).toBe(1);
      expect(syncResult.sizeAfterDestroy).toBe(0);
      expect(syncResult.leftoverNodes).toBe(0);

      expect(errors).toEqual([]);
      expect(server.reports.get('c5') ?? []).toEqual([]);
    } finally {
      await watched.context.close();
    }
  });
});

/** Series-painted shapes per palette slot under `selector` (the SVG renderer paints through var(--axylo-series-N)). */
const painted = (sel: string) => {
    const out: Record<string, { rects: number; paths: number; circles: number; markers: number }> = {};
    for (const el of Array.from(document.querySelectorAll<SVGElement>(`${sel} .axylo-scene path, ${sel} .axylo-scene rect, ${sel} .axylo-scene circle`))) {
      let node: Element | null = el, color = '';
      while (node && !color) { color = (node as SVGElement).style?.getPropertyValue('color') ?? ''; node = node.parentElement; }
      // The renderer binds series i (zero-based) to `--axylo-series-color-${i + 1}` (theme/resolve.ts seriesProperty).
      const bound = /--axylo-series-color-(\d+)/.exec(color)?.[1];
      if (bound === undefined) continue;
      const slot = String(Number(bound) - 1);
      const entry = out[slot] ??= { rects: 0, paths: 0, circles: 0, markers: 0 };
      const tag = el.tagName.toLowerCase();
      const d = el.getAttribute('d') ?? '';
      if (tag === 'rect') entry.rects++;
      else if (tag === 'circle') entry.circles++;
      else if (d.length > 1) {
        entry.paths++;
        // A batch of markers is one path, one closed subpath per marker (render/svg.ts pointData); whiskers, caps
        // and medians are open segments. Only bands (a range's area) also close, and none is counted below.
        entry.markers += (d.match(/Z/g) ?? []).length;
      }
    }
    return out;
};

/** Client coordinates of the marker centres of series `index` (zero-based) in `sel`: one per closed subpath. */
const markerCentres = ([sel, index]: [string, number]) => {
  const out: { x: number; y: number }[] = [];
  for (const el of Array.from(document.querySelectorAll<SVGPathElement>(`${sel} .axylo-scene path`))) {
    let node: Element | null = el, color = '';
    while (node && !color) { color = (node as SVGElement).style?.getPropertyValue('color') ?? ''; node = node.parentElement; }
    if (!color.includes(`--axylo-series-color-${index + 1})`) && !color.includes(`--axylo-series-color-${index + 1},`)) continue;
    const d = el.getAttribute('d') ?? '';
    const ctm = el.getScreenCTM();
    if (!ctm || !d.includes('Z')) continue;
    // Each marker is its own subpath (circle arcs or a polygon), so its box centre is the marker's centre.
    for (const sub of d.match(/M[^M]*Z/g) ?? []) {
      const probe = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      probe.setAttribute('d', sub);
      el.parentNode!.appendChild(probe);
      const b = probe.getBBox();
      probe.remove();
      const p = new DOMPoint(b.x + b.width / 2, b.y + b.height / 2).matrixTransform(ctm);
      out.push({ x: p.x, y: p.y });
    }
  }
  return out;
};

/**
 * Per box rect of series `index` in `sel` (left to right): its client box and the open segments painted around it,
 * classified by position. A median is a horizontal segment as wide as the box strictly inside it; a whisker is a
 * vertical segment on the box centre leaving its top or bottom; a cap is a horizontal segment at a whisker's far end.
 */
const boxGeometry = ([sel, index]: [string, number]) => {
  const colorOf = (el: Element) => {
    let node: Element | null = el, color = '';
    while (node && !color) { color = (node as SVGElement).style?.getPropertyValue('color') ?? ''; node = node.parentElement; }
    return color;
  };
  const mine = (c: string) => c.includes(`--axylo-series-color-${index + 1})`) || c.includes(`--axylo-series-color-${index + 1},`);
  const boxes = Array.from(document.querySelectorAll<SVGRectElement>(`${sel} .axylo-scene rect`))
    .filter(el => mine(colorOf(el))).map(el => el.getBoundingClientRect()).sort((a, b) => a.x - b.x);
  const segs: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const el of Array.from(document.querySelectorAll<SVGPathElement>(`${sel} .axylo-scene path`))) {
    const ctm = el.getScreenCTM(), d = el.getAttribute('d') ?? '';
    if (!ctm || d.includes('Z')) continue;
    for (const sub of d.match(/M[^M]*/g) ?? []) {
      const n = (sub.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
      if (n.length !== 4) continue;
      const a = new DOMPoint(n[0], n[1]).matrixTransform(ctm), b = new DOMPoint(n[2], n[3]).matrixTransform(ctm);
      segs.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
  }
  const near = (a: number, b: number) => Math.abs(a - b) <= 1;
  return boxes.map(r => {
    const cx = r.x + r.width / 2, top = r.y, bottom = r.y + r.height;
    const flat = segs.filter(g => near(g.y1, g.y2) && near(Math.abs(g.x2 - g.x1), r.width) && near(Math.min(g.x1, g.x2), r.x));
    const medians = flat.filter(g => g.y1 > top + 1 && g.y1 < bottom - 1).map(g => (g.y1 - top) / r.height);
    const whiskers = segs.filter(g => near(g.x1, cx) && near(g.x2, cx) && (near(Math.max(g.y1, g.y2), top) || near(Math.min(g.y1, g.y2), bottom)));
    const up = whiskers.filter(g => near(Math.max(g.y1, g.y2), top)).map(g => Math.abs(g.y2 - g.y1) / r.height);
    const down = whiskers.filter(g => near(Math.min(g.y1, g.y2), bottom) && !near(Math.max(g.y1, g.y2), top)).map(g => Math.abs(g.y2 - g.y1) / r.height);
    const ends = whiskers.map(g => near(Math.max(g.y1, g.y2), top) ? Math.min(g.y1, g.y2) : Math.max(g.y1, g.y2));
    const caps = ends.filter(y => flat.some(g => near(g.y1, y))).length;
    return { x: r.x, y: r.y, width: r.width, height: r.height, medians, up, down, caps };
  });
};

describe('N5 intervals, boxplot, scatter and annotation diagnostics in packed Chrome', () => {
  it('gives each interval one legend toggle, draws a native boxplot and a log scatter, and rolls back strict annotations', async () => {
    server.pages.set('/n5.html', {
      html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/npm/node_modules/axylo/dist/axylo.css"></head><body><div id="iv"></div><div id="bx"></div><div id="sc"></div><div id="ann"></div><script type="module" src="${n5Url}"></script></body></html>`,
      headers: { 'content-security-policy': cspPolicy('n5') },
    });
    const watched = await open(server);
    const { page, errors } = watched;
    await page.goto(`${server.origin}/n5.html`);
    try {
      for (const id of ['#iv', '#bx', '#sc', '#ann']) await page.waitForSelector(`${id} .axylo-scene path`);
      await page.waitForTimeout(120);

      // ── Intervals: three legend entries (Band, Err, Trend), never Low/High/carrier fields.
      const legend = page.locator('#iv .axylo-legend-entry');
      await expect.poll(() => legend.count(), { timeout: 5000 }).toBe(3);
      expect(await legend.allTextContents()).toEqual(['Band', 'Err', 'Trend']);
      const before = await page.evaluate(painted, '#iv');
      expect(before['0']?.paths ?? 0).toBeGreaterThan(0);
      expect(before['1']?.paths ?? 0).toBeGreaterThan(0);
      await page.locator('#iv .axylo-legend-entry', { hasText: 'Band' }).click();
      await expect.poll(() => page.locator('#iv .axylo-legend-entry', { hasText: 'Band' }).getAttribute('aria-pressed'), { timeout: 5000 }).toBe('false');
      await expect.poll(async () => (await page.evaluate(painted, '#iv'))['0'] ?? null, { timeout: 5000 }).toBeNull();
      // The other series stay drawn.
      const after = await page.evaluate(painted, '#iv');
      expect(after['1']?.paths ?? 0).toBeGreaterThan(0);
      await page.locator('#iv .axylo-legend-entry', { hasText: 'Band' }).click();
      await expect.poll(async () => (await page.evaluate(painted, '#iv'))['0']?.paths ?? 0, { timeout: 5000 }).toBeGreaterThan(0);
      // The error bar's one toggle hides its whiskers and its centre markers together, and shows them again.
      expect(before['1']?.markers ?? 0).toBe(4);
      await page.locator('#iv .axylo-legend-entry', { hasText: 'Err' }).click();
      await expect.poll(async () => (await page.evaluate(painted, '#iv'))['1'] ?? null, { timeout: 5000 }).toBeNull();
      expect((await page.evaluate(painted, '#iv'))['0']?.paths ?? 0).toBeGreaterThan(0);
      await page.locator('#iv .axylo-legend-entry', { hasText: 'Err' }).click();
      await expect.poll(async () => (await page.evaluate(painted, '#iv'))['1']?.markers ?? 0, { timeout: 5000 }).toBe(4);
      // Hover the error bar's first centre marker: the tooltip reads each interval as one row with its raw bounds.
      const centres = await page.evaluate(markerCentres, ['#iv', 1] as [string, number]);
      expect(centres).toHaveLength(4);
      await page.mouse.move(centres[0]!.x, centres[0]!.y);
      const ivTip = page.locator('#iv .axylo-tooltip, #iv .axylo-readout').filter({ visible: true });
      await expect.poll(async () => (await ivTip.count()) === 1 ? (await ivTip.textContent()) ?? '' : '', { timeout: 5000 })
        .toContain('60 ms (55 ms – 65 ms)');
      expect(await ivTip.textContent()).toContain('10 ms – 30 ms');
      await page.mouse.move(1, 1);
      // Keyboard: the plot proxy reads the same interval texts at the first x.
      const ivProxy = page.locator('#iv .axylo-proxy');
      await ivProxy.focus();
      await page.keyboard.press('Home');
      await expect.poll(async () => (await ivProxy.getAttribute('aria-valuetext')) ?? '', { timeout: 5000 }).toContain('10 ms – 30 ms');
      await page.locator('#iv').getByRole('button', { name: /View as table/i }).click();
      await page.waitForSelector('#iv table tbody tr');
      const ivTable = await page.evaluate(() => ({
        headers: [...document.querySelectorAll('#iv table thead th')].map(th => th.textContent?.trim() ?? ''),
        rows: [...document.querySelectorAll('#iv table tbody tr')].map(tr => [...tr.querySelectorAll('th, td')].map(td => td.textContent?.trim() ?? '')),
      }));
      expect(ivTable.headers).toEqual(['x', 'Band (ms)', 'Err (ms)', 'Trend (ms)']);
      expect(ivTable.rows[1]).toEqual(['2', '40 ms – 20 ms', '70 ms (65 ms – 75 ms)', '210 ms']);
      await page.locator('#iv').getByRole('button', { name: 'Hide table' }).click();

      // ── Boxplot: three discrete boxes (rects), medians and whiskers (paths), two outliers; one legend entry each.
      const bxLegend = page.locator('#bx .axylo-legend-entry');
      await expect.poll(() => bxLegend.count(), { timeout: 5000 }).toBe(2);
      expect(await bxLegend.allTextContents()).toEqual(['Spread', 'Mean']);
      await page.locator('#bx').scrollIntoViewIfNeeded();
      const box = await page.evaluate(painted, '#bx');
      expect(box['0']?.rects).toBe(3);
      expect(box['0']?.paths ?? 0).toBeGreaterThanOrEqual(1);
      // Medians and whiskers, each found on its own: one median per box half way through it (Q3 − median equals
      // median − Q1 in all three: 2.25/4.5, 1/2, 2/4), and whiskers as long as the stats say, relative to the IQR:
      // A up (9 − 7.75)/4.5, down (3.25 − 1)/4.5; B 1/2 both; C up (8 − 6)/4, down 0 (min = Q1 = 2). Caps at both ends.
      const geometry = await page.evaluate(boxGeometry, ['#bx', 0] as [string, number]);
      expect(geometry).toHaveLength(3);
      const expected = [[1.25 / 4.5, 2.25 / 4.5], [0.5, 0.5], [0.5, 0]];
      geometry.forEach((g, k) => {
        expect(g.medians).toHaveLength(1);
        expect(g.medians[0]!).toBeCloseTo(0.5, 1);
        expect(g.up).toHaveLength(1);
        expect(g.up[0]!).toBeCloseTo(expected[k]![0]!, 1);
        expect(g.down).toHaveLength(1);
        expect(g.down[0]!).toBeCloseTo(expected[k]![1]!, 1);
        expect(g.caps).toBe(2);
      });
      // Two outlier markers (30 in A, -20 in C), drawn as markers of the box's own series.
      expect(box['0']?.markers).toBe(2);
      // Each box rect spans Q1 to Q3, so its height is proportional to the IQR: A 4.5, B 2, C 4.
      const heights = await page.evaluate(() => Array.from(document.querySelectorAll<SVGRectElement>('#bx .axylo-scene rect'))
        .filter(el => {
          let node: Element | null = el, color = '';
          while (node && !color) { color = (node as SVGElement).style?.getPropertyValue('color') ?? ''; node = node.parentElement; }
          return color.includes('--axylo-series-color-1)') || color.includes('--axylo-series-color-1,');
        })
        .map(el => el.getBoundingClientRect()).sort((a, b) => a.x - b.x).map(b => b.height));
      expect(heights).toHaveLength(3);
      expect(heights[0]! / heights[1]!).toBeCloseTo(4.5 / 2, 1);
      expect(heights[2]! / heights[1]!).toBeCloseTo(4 / 2, 1);
      // Hover the outlier 30: the box is picked at its x and read with its outliers.
      const outliers = await page.evaluate(markerCentres, ['#bx', 0] as [string, number]);
      expect(outliers).toHaveLength(2);
      const high = outliers.reduce((a, b) => (b.y < a.y ? b : a));
      const hoverOf = (id: string) => page.evaluate(k => (window as unknown as { __n5: { hovers: Record<string, string | null> } }).__n5.hovers[k] ?? null, id);
      // The neighbouring mean marker's series, from the hover event, so the box's own wins can be told apart.
      const means = await page.evaluate(markerCentres, ['#bx', 1] as [string, number]);
      expect(means).toHaveLength(3);
      await page.mouse.move(means[1]!.x, means[1]!.y);
      await expect.poll(() => hoverOf('bx'), { timeout: 5000 }).not.toBeNull();
      const meanSeries = await hoverOf('bx');
      await page.mouse.move(1, 1);
      await page.mouse.move(high.x, high.y);
      const outTip = page.locator('#bx .axylo-tooltip, #bx .axylo-readout').filter({ visible: true });
      await expect.poll(async () => (await outTip.count()) === 1 ? (await outTip.textContent()) ?? '' : '', { timeout: 5000 })
        .toContain('outliers 30');
      const boxSeries = await hoverOf('bx');
      expect(boxSeries).not.toBeNull();
      expect(boxSeries).not.toBe(meanSeries);
      await page.mouse.move(1, 1);
      // Hover the first box's centre: the tooltip reads its five numbers and outliers.
      // Inside the first box at its lower-left corner, the point of the box farthest from A's mean marker (7.5):
      // more than the 24 px point radius away, so only the box's own geometry can win the pick (spec 3.6).
      const a = geometry[0]!, aMean = means.reduce((m, p) => (p.x < m.x ? p : m));
      const firstBox = { x: a.x + 2, y: a.y + a.height - 2 };
      expect(Math.hypot(firstBox.x - aMean.x, firstBox.y - aMean.y)).toBeGreaterThan(24);
      await page.mouse.move(firstBox.x, firstBox.y);
      const tip = page.locator('#bx .axylo-tooltip, #bx .axylo-readout').filter({ visible: true });
      await expect.poll(async () => (await tip.count()) === 1 ? (await tip.textContent()) ?? '' : '', { timeout: 5000 })
        .toContain('median 5.5 (min 1, Q1 3.25, Q3 7.75, max 9; outliers 30)');
      expect(await hoverOf('bx')).toBe(boxSeries);
      await page.mouse.move(1, 1);
      // Keyboard: the plot proxy reads the same box.
      const proxy = page.locator('#bx .axylo-proxy');
      await proxy.focus();
      await page.keyboard.press('Home');
      await expect.poll(async () => (await proxy.getAttribute('aria-valuetext')) ?? '', { timeout: 5000 }).toContain('median 5.5 (min 1, Q1 3.25, Q3 7.75, max 9; outliers 30)');
      await page.locator('#bx').getByRole('button', { name: /View as table/i }).click();
      await page.waitForSelector('#bx table tbody tr');
      const bxTable = await page.evaluate(() => ({
        headers: [...document.querySelectorAll('#bx table thead th')].map(th => th.textContent?.trim() ?? ''),
        rows: [...document.querySelectorAll('#bx table tbody tr')].map(tr => [...tr.querySelectorAll('th, td')].map(td => td.textContent?.trim() ?? '')),
      }));
      expect(bxTable.headers).toEqual(['x', 'Spread min', 'Spread Q1', 'Spread median', 'Spread Q3', 'Spread max', 'Spread outliers', 'Mean']);
      expect(bxTable.rows).toEqual([
        ['A', '1', '3.25', '5.5', '7.75', '9', '30', '7.5'],
        ['B', '10', '11', '12', '13', '14', 'none', '12'],
        ['C', '2', '2', '4', '6', '8', '-20', '0'],
      ]);
      // Hiding the box removes boxes, whiskers, medians and outliers together.
      await page.locator('#bx .axylo-legend-entry', { hasText: 'Spread' }).click();
      await expect.poll(async () => (await page.evaluate(painted, '#bx'))['0'] ?? null, { timeout: 5000 }).toBeNull();

      // ── Scatter on the right log axis: four markers (the nonpositive value is not drawn), AX171 reported.
      const scDiagnostics = await page.evaluate(() => (window as unknown as { __n5: { sc: { diagnostics: readonly { code: string; field?: string }[] } } }).__n5.sc.diagnostics.map(d => `${d.code}:${d.field ?? ''}`));
      expect(scDiagnostics).toContain('AX171:a');
      // The third chart starts below the 700 px viewport: bring it in before reading client coordinates.
      await page.locator('#sc').scrollIntoViewIfNeeded();
      const scatter = await page.evaluate(painted, '#sc');
      // Four markers: a = 1, 2, 4, 8 (the -1 at x = 3 is not drawn on the log axis).
      expect(scatter['1']?.markers).toBe(4);
      // Hover the marker of x = 4 (the third drawn one, left to right): the tooltip reads that x and its value.
      const points = (await page.evaluate(markerCentres, ['#sc', 1] as [string, number])).sort((p, q) => p.x - q.x);
      expect(points).toHaveLength(4);
      // a doubles from x = 1 to 2 and from 4 to 8: equal steps on the log axis.
      expect(points[0]!.y - points[1]!.y).toBeCloseTo(points[2]!.y - points[3]!.y, 0);
      await page.mouse.move(points[2]!.x, points[2]!.y);
      const scTip = page.locator('#sc .axylo-tooltip, #sc .axylo-readout').filter({ visible: true });
      await expect.poll(async () => (await scTip.count()) === 1 ? (await scTip.textContent()) ?? '' : '', { timeout: 5000 })
        .toMatch(/Points\s*4/);
      // The scatter point won the pick, not the line on the left axis (b = 40 at that x).
      await expect.poll(() => hoverOf('sc'), { timeout: 5000 }).toBe('a');
      await page.mouse.move(1, 1);
      // Keyboard: Home enters all-series mode; first ArrowDown selects the first visible series (b),
      // second ArrowDown moves to the scatter (Points) at the same x, ArrowRight twice reaches x = 3 (-1 on log).
      const scProxy = page.locator('#sc .axylo-proxy');
      await scProxy.focus();
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await expect.poll(async () => (await scProxy.getAttribute('aria-valuetext')) ?? '', { timeout: 5000 }).toMatch(/Points.*\b1\b/);
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await expect.poll(async () => (await scProxy.getAttribute('aria-valuetext')) ?? '', { timeout: 5000 }).toContain('-1 (not plotted)');
      await page.locator('#sc').getByRole('button', { name: /View as table/i }).click();
      await page.waitForSelector('#sc table tbody tr');
      const scTable = await page.evaluate(() => ({
        headers: [...document.querySelectorAll('#sc table thead th')].map(th => th.textContent?.trim() ?? ''),
        rows: [...document.querySelectorAll('#sc table tbody tr')].map(tr => [...tr.querySelectorAll('th, td')].map(td => td.textContent?.trim() ?? '')),
      }));
      expect(scTable.headers).toEqual(['x', 'b', 'Points']);
      expect(scTable.rows).toEqual([
        ['1', '10', '1'], ['2', '20', '2'], ['3', '30', '-1 (not plotted — log)'], ['4', '40', '4'], ['5', '50', '8'],
      ]);
      await page.locator('#sc').getByRole('button', { name: 'Hide table' }).click();

      // ── Annotations: a malformed one is reported (lenient), a strict update bringing one is rolled back.
      const annStrict = await page.evaluate(() => {
        const chart = (window as unknown as { __n5: { ann: { update(p: unknown): void; diagnostics: readonly { code: string; field?: string }[] } } }).__n5.ann;
        const codes = () => chart.diagnostics.map(d => `${d.code}:${d.field ?? ''}`).sort();
        const valid = codes();
        let threw = false;
        try {
          chart.update({ strict: true, annotations: [{ type: 'point', x: 1, y: 1, label: 'Attempted' }, { type: 'point', x: 3, y: 'nine', label: 'Bad' }] });
        } catch { threw = true; }
        const afterStrict = codes();
        return { valid, threw, afterStrict };
      });
      expect(annStrict.threw).toBe(true);
      expect(annStrict.afterStrict).toEqual(annStrict.valid);
      // Assert the previously accepted annotation remains rendered (and neither the attempted valid sibling nor the invalid one was applied).
      await expect.poll(async () => (await page.locator('#ann .axylo-text').textContent()) ?? '', { timeout: 5000 }).toContain('Peak');
      const strictText = (await page.locator('#ann .axylo-text').textContent()) ?? '';
      expect(strictText).not.toContain('Attempted');
      expect(strictText).not.toContain('Bad');

      const annRest = await page.evaluate(() => {
        const chart = (window as unknown as { __n5: { ann: { update(p: unknown): void; diagnostics: readonly { code: string; field?: string }[] } } }).__n5.ann;
        const codes = () => chart.diagnostics.map(d => `${d.code}:${d.field ?? ''}`).sort();
        chart.update({ strict: false, annotations: [{ type: 'point', x: 2, y: 4, label: 'Peak' }, { type: 'threshold', axis: 'y', value: Number.NaN, label: 'NaN' }] });
        const lenient = codes();
        chart.update({ annotations: [{ type: 'point', x: 3, y: 9, label: 'Corrected' }] });
        const corrected = codes();
        return { lenient, corrected };
      });
      expect(annRest.lenient).toContain('AX103:annotations[1].value');
      expect(annRest.corrected.filter(c => c.startsWith('AX103') || c.startsWith('AX150'))).toEqual([]);
      await expect.poll(async () => (await page.locator('#ann .axylo-text').textContent()) ?? '', { timeout: 5000 }).toContain('Corrected');

      // ── axe-core on the four figures, evaluated through the DevTools protocol (no inline script under CSP).
      await page.evaluate(axeSource);
      const axe = await page.evaluate(async () => {
        const run = (window as unknown as { axe: { run(context: unknown, options: unknown): Promise<{ violations: { id: string; nodes: unknown[] }[] }> } }).axe;
        const result = await run.run({ include: [['#iv'], ['#bx'], ['#sc'], ['#ann']] }, { resultTypes: ['violations'] });
        return result.violations.map(v => `${v.id} (${v.nodes.length})`);
      });
      expect(axe).toEqual([]);

      const leftovers = await page.evaluate(() => {
        const { iv, bx, sc, ann } = (window as unknown as { __n5: Record<'iv' | 'bx' | 'sc' | 'ann', { destroy(): void }> }).__n5;
        for (const chart of [iv, bx, sc, ann]) chart.destroy();
        return ['iv', 'bx', 'sc', 'ann'].reduce((n, id) => n + document.getElementById(id)!.childNodes.length, 0);
      });
      expect(leftovers).toBe(0);
      expect(errors).toEqual([]);
      expect(server.reports.get('n5') ?? []).toEqual([]);
    } finally {
      await watched.context.close();
    }
  });
});

/**
 * W3 integration seal in packed Chrome: repeated-x scatter points with their own hover and select payloads (spec
 * F11, I3), a lone range's legend toggle by pointer and keyboard, same-x layered marks updating the hover event and
 * the tooltip's anchor, and a ninth series' interval in a pinned tooltip's second page and the keyboard reading.
 */
describe('W3 integration: repeated-x scatter, lone interval legend, same-x layers, overflow intervals', () => {
  it('hovers and selects each repeated-x point, toggles a lone band, follows same-x layers and reads 20 – 80 past eight rows', async () => {
    server.pages.set('/w3.html', {
      html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/npm/node_modules/axylo/dist/axylo.css"></head><body><div id="rx"></div><div id="lone"></div><div id="loneErr"></div><div id="layer"></div><div id="nine"></div><script type="module" src="${w3Url}"></script></body></html>`,
      headers: { 'content-security-policy': cspPolicy('w3') },
    });
    const watched = await open(server);
    const { page, errors } = watched;
    await page.goto(`${server.origin}/w3.html`);
    type Events = Record<string, ({ series: string; x: unknown; y: number | null; index: number; row: unknown } | null)[]>;
    const events = () => page.evaluate(() => (window as unknown as { __w3: { events: Events } }).__w3.events);
    try {
      for (const id of ['#rx', '#lone', '#loneErr', '#layer', '#nine']) await page.waitForSelector(`${id} .axylo-scene path`);

      // ── Finding 4: three points, no AX108, each hovered and selected by its own row.
      const rxCodes = await page.evaluate(() => (window as unknown as { __w3: { rx: { diagnostics: readonly { code: string }[] } } }).__w3.rx.diagnostics.map(d => d.code));
      expect(rxCodes).not.toContain('AX108');
      await expect.poll(async () => (await page.evaluate(painted, '#rx'))['0']?.markers ?? 0, { timeout: 5000 }).toBe(3);
      // Left to right, then top to bottom: (1, 3), (1, 2), (2, 4) on screen; y = 3 is above y = 2.
      const pts = (await page.evaluate(markerCentres, ['#rx', 0] as [string, number])).sort((p, q) => p.x - q.x || p.y - q.y);
      expect(pts).toHaveLength(3);
      expect(pts[0]!.x).toBeCloseTo(pts[1]!.x, 0);
      const rxTipShown = page.locator('#rx .axylo-tooltip, #rx .axylo-readout').filter({ visible: true });
      for (const [i, p] of pts.entries()) {
        await page.mouse.move(p.x, p.y);
        await expect.poll(async () => (await events()).hover!.length, { timeout: 5000 }).toBeGreaterThan(i);
        await page.mouse.down();
        await page.mouse.up();
        // The click's select payload is observable: wait for it rather than for a fixed time.
        await expect.poll(async () => (await events()).select!.length, { timeout: 5000 }).toBe(i + 1);
        await page.keyboard.press('Escape');
        await page.mouse.move(1, 1);
        await expect.poll(() => rxTipShown.count(), { timeout: 5000 }).toBe(0);
      }
      const expected = [
        { series: 'y', x: 1, y: 3, index: 1, row: { x: 1, y: 3 } },
        { series: 'y', x: 1, y: 2, index: 0, row: { x: 1, y: 2 } },
        { series: 'y', x: 2, y: 4, index: 2, row: { x: 2, y: 4 } },
      ];
      const got = await events();
      // Each point's hover is the first event raised for it (later moves may raise it again before leaving).
      const firsts = got.hover!.filter((e, i, all) => i === 0 || JSON.stringify(e) !== JSON.stringify(all[i - 1]));
      expect(firsts).toEqual(expected);
      expect(got.select).toEqual(expected);
      const rxTip = page.locator('#rx .axylo-tooltip, #rx .axylo-readout').filter({ visible: true });
      await page.mouse.move(pts[0]!.x, pts[0]!.y);
      await expect.poll(async () => (await rxTip.count()) === 1 ? (await rxTip.textContent()) ?? '' : '', { timeout: 5000 }).toMatch(/Pts\s*3/);
      await page.mouse.move(1, 1);

      // ── Finding 2: one legend toggle for a lone range; pointer and keyboard hide and restore it.
      const loneEntry = page.locator('#lone .axylo-legend-entry');
      await expect.poll(() => loneEntry.count(), { timeout: 5000 }).toBe(1);
      expect(await loneEntry.textContent()).toBe('Band');
      await loneEntry.click();
      await expect.poll(() => loneEntry.getAttribute('aria-pressed'), { timeout: 5000 }).toBe('false');
      await expect.poll(async () => (await page.evaluate(painted, '#lone'))['0'] ?? null, { timeout: 5000 }).toBeNull();
      // The last hidden series comes back from the same toggle.
      await loneEntry.click();
      await expect.poll(async () => (await page.evaluate(painted, '#lone'))['0']?.paths ?? 0, { timeout: 5000 }).toBeGreaterThan(0);
      await loneEntry.focus();
      await page.keyboard.press('Enter');
      await expect.poll(() => loneEntry.getAttribute('aria-pressed'), { timeout: 5000 }).toBe('false');
      await page.keyboard.press(' ');
      await expect.poll(() => loneEntry.getAttribute('aria-pressed'), { timeout: 5000 }).toBe('true');
      await expect.poll(async () => (await page.evaluate(painted, '#lone'))['0']?.paths ?? 0, { timeout: 5000 }).toBeGreaterThan(0);
      // A lone error bar has the same toggle, by pointer and by keyboard (Enter and Space).
      const errEntry = page.locator('#loneErr .axylo-legend-entry');
      await expect.poll(() => errEntry.count(), { timeout: 5000 }).toBe(1);
      expect(await errEntry.textContent()).toBe('Spread');
      await errEntry.click();
      await expect.poll(() => errEntry.getAttribute('aria-pressed'), { timeout: 5000 }).toBe('false');
      await expect.poll(async () => (await page.evaluate(painted, '#loneErr'))['0'] ?? null, { timeout: 5000 }).toBeNull();
      await errEntry.click();
      await expect.poll(() => errEntry.getAttribute('aria-pressed'), { timeout: 5000 }).toBe('true');
      await expect.poll(async () => (await page.evaluate(painted, '#loneErr'))['0']?.paths ?? 0, { timeout: 5000 }).toBeGreaterThan(0);
      await errEntry.focus();
      await page.keyboard.press('Enter');
      await expect.poll(() => errEntry.getAttribute('aria-pressed'), { timeout: 5000 }).toBe('false');
      await expect.poll(async () => (await page.evaluate(painted, '#loneErr'))['0'] ?? null, { timeout: 5000 }).toBeNull();
      await page.keyboard.press(' ');
      await expect.poll(() => errEntry.getAttribute('aria-pressed'), { timeout: 5000 }).toBe('true');
      await expect.poll(async () => (await page.evaluate(painted, '#loneErr'))['0']?.paths ?? 0, { timeout: 5000 }).toBeGreaterThan(0);
      // A lone line keeps no legend (the #layer chart has two series and so two entries; #rx has none).
      expect(await page.locator('#rx .axylo-legend-entry').count()).toBe(0);

      // ── Finding 3: at one x, moving from the scatter marker to the line vertex changes the hover and the anchor.
      await page.locator('#layer').scrollIntoViewIfNeeded();
      const scatter = (await page.evaluate(markerCentres, ['#layer', 1] as [string, number])).sort((p, q) => p.x - q.x);
      expect(scatter).toHaveLength(3);
      // The line's last value (b = 30 at x = 3) carries a marker: with the scatter's a = 80 it fixes the y scale, so
      // b = 20 at x = 2 sits at y80 + (y30 - y80) * (80 - 20) / (80 - 30).
      const lineEnd = await page.evaluate(markerCentres, ['#layer', 0] as [string, number]);
      expect(lineEnd).toHaveLength(1);
      const lineY = scatter[1]!.y + (lineEnd[0]!.y - scatter[2]!.y) * 1.2;
      const tip = page.locator('#layer .axylo-tooltip').filter({ visible: true });
      await page.mouse.move(scatter[1]!.x, scatter[1]!.y);
      await expect.poll(async () => (await events()).layer!.at(-1)?.series ?? null, { timeout: 5000 }).toBe('a');
      await expect.poll(() => tip.count(), { timeout: 5000 }).toBe(1);
      const tipAtScatter = (await tip.boundingBox())!;
      // Straight down at the same x: the pick moves to the line's vertex within its 12 px radius.
      for (let y = scatter[1]!.y + 20; y <= lineY; y += 20) await page.mouse.move(scatter[1]!.x, y);
      await page.mouse.move(scatter[1]!.x, lineY);
      await expect.poll(async () => (await events()).layer!.at(-1)?.series ?? null, { timeout: 5000 }).toBe('b');
      const layerEvents = (await events()).layer!.filter(Boolean);
      expect(layerEvents.every(e => e!.x === 2)).toBe(true);
      await expect.poll(async () => Math.round(((await tip.boundingBox())?.y ?? tipAtScatter.y) - tipAtScatter.y), { timeout: 5000 }).not.toBe(0);
      // And back up: the scatter wins again.
      await page.mouse.move(scatter[1]!.x, scatter[1]!.y);
      await expect.poll(async () => (await events()).layer!.at(-1)?.series ?? null, { timeout: 5000 }).toBe('a');
      await page.mouse.move(1, 1);

      // ── Finding 5: the ninth series (a range) reads 20 – 80, and the tenth (an error bar with no centre at x = 3)
      // "No data (20 – 80)", on the pinned tooltip's later pages and by keyboard.
      await page.locator('#nine').scrollIntoViewIfNeeded();
      // l1's last value marker (x = 3): a line vertex there picks x = 3, where every series but the error bar's centre has a value.
      const nineEnd = await page.evaluate(markerCentres, ['#nine', 0] as [string, number]);
      expect(nineEnd).toHaveLength(1);
      await page.mouse.move(nineEnd[0]!.x, nineEnd[0]!.y);
      await page.mouse.down();
      await page.mouse.up();
      const more = page.locator('#nine .axylo-tooltip button.axylo-tooltip-more');
      const nineTip = page.locator('#nine .axylo-tooltip').filter({ visible: true });
      await expect.poll(() => more.count(), { timeout: 5000 }).toBe(1);
      // However many rows a page fits, paging on reaches every series: gather each page's text until both
      // intervals have been seen (or a bounded number of pages, as ten series need at most ten).
      const band = /Band\s*20 – 80/, err = /Err\s*No data \(20 – 80\)/;
      let seen = (await nineTip.textContent()) ?? '';
      for (let k = 0; k < 10 && !(band.test(seen) && err.test(seen)) && (await more.count()) === 1; k++) {
        expect((await more.textContent()) ?? '').toMatch(/^\+\d+ more$/);
        const before = (await nineTip.textContent()) ?? '';
        await more.click();
        await expect.poll(async () => (await nineTip.textContent()) ?? '', { timeout: 5000 }).not.toBe(before);
        seen += ' ' + ((await nineTip.textContent()) ?? '');
      }
      expect(seen).toMatch(band);
      expect(seen).toMatch(err);
      await page.keyboard.press('Escape');
      await page.mouse.move(1, 1);
      const nineProxy = page.locator('#nine .axylo-proxy');
      await nineProxy.focus();
      await page.keyboard.press('Home');
      await expect.poll(async () => (await nineProxy.getAttribute('aria-valuetext')) ?? '', { timeout: 5000 }).toContain('Band 20 – 80');
      // x = 3, where the error bar has no centre: the keyboard reading keeps its bounds.
      await page.keyboard.press('End');
      await expect.poll(async () => (await nineProxy.getAttribute('aria-valuetext')) ?? '', { timeout: 5000 }).toContain('Err No data (20 – 80)');

      const leftovers = await page.evaluate(() => {
        const charts = (window as unknown as { __w3: Record<'rx' | 'lone' | 'loneErr' | 'layer' | 'nine', { destroy(): void }> }).__w3;
        for (const id of ['rx', 'lone', 'loneErr', 'layer', 'nine'] as const) charts[id].destroy();
        return ['rx', 'lone', 'loneErr', 'layer', 'nine'].reduce((n, id) => n + document.getElementById(id)!.childNodes.length, 0);
      });
      expect(leftovers).toBe(0);
      expect(errors).toEqual([]);
      expect(server.reports.get('w3') ?? []).toEqual([]);
    } finally {
      await watched.context.close();
    }
  });
});
