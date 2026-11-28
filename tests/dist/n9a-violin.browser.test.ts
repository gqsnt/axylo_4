/**
 * N9a in packed real Chrome: the native `violin` layer of `axylo/cartesian` fed by `violinData()` of `axylo/stats`.
 *
 * Cases: a lone violin layer (mirrored outlines, inner Q1–Q3 box, median bar, one legend toggle by pointer and
 * keyboard), a mixed chart (scatter + violin + boxplot, each with its own legend entry and marks), pointer,
 * keyboard and table parity of the violin readout (n, median, IQR, min, max, bandwidth), and axe-core with zero
 * violations in light, dark and forced colors. Bundle gates (0 raw bytes on bare imports, the root/static caps and
 * the cartesian/stats caps) live in subpaths.test.ts.
 *
 * Expected values (R-7, Silverman with the bw.nrd0 fallbacks; see packages/axylo/test/cartesian/n9a-violin.test.ts):
 *   A = 1..5: n 5, median 3, Q1 2, Q3 4, min 1, max 5, h = 0.9 · (2 / 1.34) · 5^(-1/5) ≈ 0.973585
 *   B = 2, 4, 4, 6, 10, 12: n 6, median 5, Q1 4, Q3 9, min 2, max 12
 *   C = 7, 7, 7: n 3, median 7, h = 0.9 · 7 · 3^(-1/5) (a constant sample)
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bundle, closeBrowser, cspPolicy, launch, open, problems, startServer, type Server } from './browser';
import { fixture, repo } from './paths';

let server: Server;
let url: string;
const axeSource = fs.readFileSync(path.join(repo, 'node_modules/axe-core/axe.min.js'), 'utf8');

beforeAll(async () => {
  server = await startServer();
  await launch();
  url = (await bundle({
    name: 'n9a-violin',
    cwd: fixture('npm'),
    format: 'esm',
    conditions: ['production'],
    contents: `
      import { cartesian } from 'axylo/cartesian';
      import { violinData } from 'axylo/stats';

      for (const id of ['vio', 'mix']) {
        const el = document.getElementById(id)!;
        el.style.width = '640px';
        el.style.height = '320px';
      }
      const samples: Record<string, number[]> = { A: [1, 2, 3, 4, 5], B: [2, 4, 4, 6, 10, 12], C: [7, 7, 7] };
      const rows = Object.entries(samples).flatMap(([g, values]) => values.map(v => ({ g, v })));
      const result = violinData(rows, { group: 'g', value: 'v' });
      const c = result.data.columns;

      const vio = cartesian('#vio', {
        title: 'Latency by team',
        data: result.data,
        x: { field: 'x', label: 'Team' },
        axes: { v: { position: 'left', label: 'Latency' } },
        layers: [{ type: 'violin', yAxis: 'v', label: 'Spread' }],
      });
      const mix = cartesian('#mix', {
        title: 'Mixed layers',
        data: { columns: { ...c, mark: Float64Array.of(3, NaN, 7), bmin: c.min, bq1: c.q1, bmed: c.median, bq3: c.q3, bmax: c.max } },
        x: { field: 'x', label: 'Team' },
        axes: { v: { position: 'left' } },
        layers: [
          { type: 'scatter', y: 'mark', yAxis: 'v', label: 'Marker' },
          { type: 'violin', yAxis: 'v', label: 'Spread' },
          { type: 'boxplot', min: 'bmin', q1: 'bq1', median: 'bmed', q3: 'bq3', max: 'bmax', yAxis: 'v', label: 'Box' },
        ],
      });
      const hovers: Record<string, string | null> = {};
      vio.on('hover', p => { hovers.vio = p ? p.series : null; });
      (window as unknown as Record<string, unknown>).__n9a = { vio, mix, hovers, bandwidth: Array.from(c.bandwidth) };
    `,
  })).url;
});

afterAll(async () => {
  await closeBrowser();
  await server?.close();
});

/** Per series slot (zero-based) of `sel`: painted rects, paths and closed subpaths (outline polygons or markers). */
const painted = (sel: string) => {
  const out: Record<string, { rects: number; paths: number; closed: number }> = {};
  for (const el of Array.from(document.querySelectorAll<SVGElement>(`${sel} .axylo-scene path, ${sel} .axylo-scene rect`))) {
    let node: Element | null = el, color = '';
    while (node && !color) { color = (node as SVGElement).style?.getPropertyValue('color') ?? ''; node = node.parentElement; }
    const bound = /--axylo-series-color-(\d+)/.exec(color)?.[1];
    if (bound === undefined) continue;
    const entry = out[String(Number(bound) - 1)] ??= { rects: 0, paths: 0, closed: 0 };
    if (el.tagName.toLowerCase() === 'rect') entry.rects++;
    else if ((el.getAttribute('d') ?? '').length > 1) {
      entry.paths++;
      entry.closed += ((el.getAttribute('d') ?? '').match(/Z/g) ?? []).length;
    }
  }
  return out;
};

/** Client boxes of the inner Q1–Q3 rects of series `index` in `sel`, left to right. */
const innerBoxes = ([sel, index]: [string, number]) => Array.from(document.querySelectorAll<SVGRectElement>(`${sel} .axylo-scene rect`))
  .filter(el => {
    let node: Element | null = el, color = '';
    while (node && !color) { color = (node as SVGElement).style?.getPropertyValue('color') ?? ''; node = node.parentElement; }
    return color.includes(`--axylo-series-color-${index + 1})`) || color.includes(`--axylo-series-color-${index + 1},`);
  })
  .map(el => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; })
  .sort((a, b) => a.x - b.x);

describe('N9a violin layer in packed Chrome', () => {
  it('draws violins with inner boxes, toggles a lone layer, reads the same values by pointer, keyboard and table, and passes axe in every scheme', async () => {
    server.pages.set('/n9a.html', {
      html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/npm/node_modules/axylo/dist/axylo.css"></head><body><div id="vio"></div><div id="mix"></div><script type="module" src="${url}"></script></body></html>`,
      headers: { 'content-security-policy': cspPolicy('n9a') },
    });
    const watched = await open(server);
    const { page } = watched;
    await page.goto(`${server.origin}/n9a.html`);
    try {
      for (const id of ['#vio', '#mix']) await page.waitForSelector(`${id} .axylo-scene path`);
      await page.waitForTimeout(120);
      const bandwidth = await page.evaluate(() => (window as unknown as { __n9a: { bandwidth: number[] } }).__n9a.bandwidth);
      expect(bandwidth[0]!).toBeCloseTo(0.9 * (2 / 1.34) * 5 ** -0.2, 12);

      // ── Lone violin: three closed outlines (one filled area run each) plus their strokes, three inner boxes.
      const vio = await page.evaluate(painted, '#vio');
      expect(vio['0']?.rects).toBe(3);
      expect(vio['0']?.closed ?? 0).toBeGreaterThanOrEqual(3);
      // Inner boxes span Q1–Q3: heights in the ratio of the IQRs, A 2 : B 5 (C is constant, drawn 1 px high).
      const boxes = await page.evaluate(innerBoxes, ['#vio', 0] as [string, number]);
      expect(boxes).toHaveLength(3);
      expect(boxes[1]!.height / boxes[0]!.height).toBeCloseTo(5 / 2, 1);
      expect(boxes[2]!.height).toBeLessThanOrEqual(1.5);

      // One legend entry even though the violin is the only layer; pointer and keyboard toggle it.
      const entry = page.locator('#vio .axylo-legend-entry');
      await expect.poll(() => entry.count(), { timeout: 5000 }).toBe(1);
      expect(await entry.allTextContents()).toEqual(['Spread']);
      await entry.click();
      await expect.poll(() => entry.getAttribute('aria-pressed'), { timeout: 5000 }).toBe('false');
      await expect.poll(async () => (await page.evaluate(painted, '#vio'))['0'] ?? null, { timeout: 5000 }).toBeNull();
      await entry.click();
      await expect.poll(() => entry.getAttribute('aria-pressed'), { timeout: 5000 }).toBe('true');
      await entry.focus();
      await page.keyboard.press('Enter');
      await expect.poll(() => entry.getAttribute('aria-pressed'), { timeout: 5000 }).toBe('false');
      await page.keyboard.press(' ');
      await expect.poll(() => entry.getAttribute('aria-pressed'), { timeout: 5000 }).toBe('true');

      // ── Table: the same cells, one column per reading.
      await page.locator('#vio').getByRole('button', { name: /View as table/i }).click();
      await page.waitForSelector('#vio table tbody tr');
      const table = await page.evaluate(() => ({
        headers: [...document.querySelectorAll('#vio table thead th')].map(th => th.textContent?.trim() ?? ''),
        rows: [...document.querySelectorAll('#vio table tbody tr')].map(tr => [...tr.querySelectorAll('th, td')].map(td => td.textContent?.trim() ?? '')),
      }));
      expect(table.headers).toEqual(['Team', 'Spread median', 'Spread n', 'Spread IQR', 'Spread min', 'Spread max', 'Spread bandwidth']);
      // The bandwidth cell is the chart's own value format of h; its text is then the readouts' text.
      const hText = table.rows[0]![6]!;
      expect(Number(hText.replace(/,/g, ''))).toBeCloseTo(bandwidth[0]!, 5);
      expect(table.rows[0]).toEqual(['A', '3', '5', '2 – 4', '1', '5', hText]);
      expect(table.rows[1]!.slice(0, 6)).toEqual(['B', '5', '6', '4 – 9', '2', '12']);
      expect(table.rows[2]!.slice(0, 6)).toEqual(['C', '7', '3', '7 – 7', '7', '7']);
      await page.locator('#vio').getByRole('button', { name: 'Hide table' }).click();

      // ── Pointer: inside A's inner box the tooltip reads the violin's six values.
      const expected = `median 3 (n 5, IQR 2 – 4, min 1, max 5, bandwidth ${hText})`;
      const a = (await page.evaluate(innerBoxes, ['#vio', 0] as [string, number]))[0]!;
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      const tip = page.locator('#vio .axylo-tooltip, #vio .axylo-readout').filter({ visible: true });
      await expect.poll(async () => (await tip.count()) === 1 ? (await tip.textContent()) ?? '' : '', { timeout: 5000 }).toContain(expected);
      await expect.poll(() => page.evaluate(() => (window as unknown as { __n9a: { hovers: Record<string, string | null> } }).__n9a.hovers.vio ?? null), { timeout: 5000 }).not.toBeNull();
      await page.mouse.move(1, 1);

      // ── Keyboard: the plot proxy reads the same text, and steps to B.
      const proxy = page.locator('#vio .axylo-proxy');
      await proxy.focus();
      await page.keyboard.press('Home');
      await expect.poll(async () => (await proxy.getAttribute('aria-valuetext')) ?? '', { timeout: 5000 }).toContain(expected);
      await page.keyboard.press('ArrowRight');
      await expect.poll(async () => (await proxy.getAttribute('aria-valuetext')) ?? '', { timeout: 5000 }).toContain('median 5 (n 6, IQR 4 – 9, min 2, max 12, ');

      // ── Mixed layers: one entry and its own marks per layer.
      const mixLegend = page.locator('#mix .axylo-legend-entry');
      await expect.poll(() => mixLegend.count(), { timeout: 5000 }).toBe(3);
      expect(await mixLegend.allTextContents()).toEqual(['Marker', 'Spread', 'Box']);
      await page.locator('#mix').scrollIntoViewIfNeeded();
      const mix = await page.evaluate(painted, '#mix');
      expect(mix['0']?.closed).toBe(2);
      expect(mix['1']?.rects).toBe(3);
      expect(mix['2']?.rects).toBe(3);
      await page.locator('#mix .axylo-legend-entry', { hasText: 'Spread' }).click();
      await expect.poll(async () => (await page.evaluate(painted, '#mix'))['1'] ?? null, { timeout: 5000 }).toBeNull();
      expect((await page.evaluate(painted, '#mix'))['2']?.rects).toBe(3);
      await page.locator('#mix .axylo-legend-entry', { hasText: 'Spread' }).click();

      // ── axe-core in light, dark and forced colors.
      await page.evaluate(axeSource);
      const axe = () => page.evaluate(async () => {
        const run = (window as unknown as { axe: { run(context: unknown, options: unknown): Promise<{ violations: { id: string; nodes: unknown[] }[] }> } }).axe;
        const result = await run.run({ include: [['#vio'], ['#mix']] }, { resultTypes: ['violations'] });
        return result.violations.map(v => `${v.id} (${v.nodes.length})`);
      });
      for (const media of [{ colorScheme: 'light' }, { colorScheme: 'dark' }, { colorScheme: 'light', forcedColors: 'active' }] as const) {
        await page.emulateMedia(media);
        await page.waitForTimeout(120);
        expect((await page.evaluate(painted, '#vio'))['0']?.rects ?? (await page.locator('#vio .axylo-scene rect').count())).toBeGreaterThanOrEqual(3);
        expect(await axe(), JSON.stringify(media)).toEqual([]);
      }

      const leftovers = await page.evaluate(() => {
        const { vio, mix } = (window as unknown as { __n9a: Record<'vio' | 'mix', { destroy(): void }> }).__n9a;
        vio.destroy();
        mix.destroy();
        return ['vio', 'mix'].reduce((n, id) => n + document.getElementById(id)!.childNodes.length, 0);
      });
      expect(leftovers).toBe(0);
      expect(problems(watched)).toEqual([]);
    } finally {
      await watched.context.close();
    }
  });
});
