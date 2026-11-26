/**
 * Packed real-Chrome browser integration test for Campaign 5 (`axylo/stats` + `axylo/cartesian`
 * ranges/errorBars/annotations + `axylo/sync` linked hover/zoom + 0/0/0 teardown under strict CSP).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bundle, closeBrowser, cspPolicy, launch, open, startServer, type Server } from './browser';
import { fixture } from './paths';

let server: Server;
let scriptUrl: string;

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
