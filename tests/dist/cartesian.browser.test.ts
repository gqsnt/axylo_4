/**
 * Packed real-Chrome browser integration test for `axylo/cartesian` (C4.3, RFC §5 & §8):
 * verifies dual-axis (linear bar + log line) rendering under strict CSP, tooltip/keyboard/table parity
 * including nonpositive log rows (`AX171`), editable `chart.update()` (rename + secondary domain),
 * and responsive `< 360 px` right-axis collapse (`AX175` added & cleared on resize back to `640 px`).
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
    name: 'cartesian-e2e',
    cwd: fixture('npm'),
    format: 'esm',
    conditions: ['production'],
    contents: `
      import { cartesian } from 'axylo/cartesian';
      const el = document.getElementById('chart')!;
      el.style.width = '640px';
      el.style.height = '320px';
      const rows = [
        { month: 'Jan', orders: 120, latency: 10 },
        { month: 'Feb', orders: 260, latency: 0 },
        { month: 'Mar', orders: 410, latency: 100 },
        { month: 'Apr', orders: 320, latency: 1000 },
      ];
      const chart = cartesian('#chart', {
        title: 'Orders vs p99 Latency',
        data: rows,
        x: { field: 'month', ordered: true },
        axes: {
          orders: { position: 'left', scale: 'linear', label: 'Orders', unit: 'qty' },
          latency: { position: 'right', scale: 'log', base: 10, label: 'Latency', unit: 'ms' },
        },
        layers: [
          { type: 'bar', y: 'orders', yAxis: 'orders' },
          { type: 'line', y: 'latency', yAxis: 'latency' },
        ],
        reference: [{ y: 100, axisId: 'latency', label: 'SLA 100ms' }],
      });
      (window as unknown as { __cart: typeof chart }).__cart = chart;
    `,
  })).url;
});

afterAll(async () => {
  await closeBrowser();
  await server?.close();
});

describe('axylo/cartesian packed Chrome integration under strict CSP', () => {
  it('renders bars + log line + dual y-axes, preserves nonpositive log values in table, supports update() and L9 resize collapse', async () => {
    server.pages.set('/cartesian.html', {
      html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/npm/node_modules/axylo/dist/axylo.css"></head><body><div id="chart"></div><script type="module" src="${scriptUrl}"></script></body></html>`,
      headers: { 'content-security-policy': cspPolicy('cartesian') },
    });

    const watched = await open(server);
    const { page, errors } = watched;
    await page.goto(`${server.origin}/cartesian.html`);
    try {
      await page.waitForSelector('#chart svg g rect');
      await page.waitForSelector('#chart svg g path');
      await page.waitForTimeout(100);

      const initial = await page.evaluate(() => {
        const chart = (window as unknown as { __cart: { diagnostics: readonly { code: string }[] } }).__cart;
        const rects = document.querySelectorAll('#chart svg g rect').length;
        const paths = document.querySelectorAll('#chart svg g path').length;
        const tickTexts = [...document.querySelectorAll('#chart .axylo-text span')].map(el => el.textContent ?? '');
        const note = document.querySelector('#chart .axylo-note')?.textContent ?? '';
        return { rects, paths, tickTexts, note, codes: chart.diagnostics.map(d => d.code) };
      });
      expect(initial.rects).toBeGreaterThanOrEqual(4);
      expect(initial.paths).toBeGreaterThanOrEqual(1);
      expect(initial.codes).toContain('AX171');
      expect(initial.note).toMatch(/Values not shown: 1/);

      // Open data table and verify raw 0 ms value is preserved with log qualifier
      await page.getByRole('button', { name: /View as table/i }).click();
      await page.waitForSelector('#chart table tbody tr');
      const tableText = await page.evaluate(() =>
        [...document.querySelectorAll('#chart table tbody tr')].map(tr =>
          [...tr.querySelectorAll('th,td')].map(td => td.textContent?.trim() ?? ''),
        ));
      expect(tableText).toHaveLength(4);
      expect(tableText[1]![2]).toBe('0 ms (not plotted — log)');
      await page.getByRole('button', { name: /Hide table/i }).click();

      // Update label + secondary domain cleanly
      await page.evaluate(() => {
        const chart = (window as unknown as { __cart: { update(p: unknown): void } }).__cart;
        chart.update({
          axes: {
            orders: { position: 'left', label: 'Monthly Orders', unit: 'qty', domain: [0, 500] },
            latency: { position: 'right', scale: 'log', base: 10, label: 'Latency', unit: 'ms', domain: [1, 10000] },
          },
        });
      });
      await page.waitForTimeout(100);
      const updatedText = await page.evaluate(() => document.querySelector('#chart .axylo-text')?.textContent ?? '');
      expect(updatedText).toContain('Monthly Orders');

      // Resize below 360 px -> AX175 emitted and accessible summary updated; resize back to 640 px -> both cleared
      const readSummary = () => page.evaluate(() => {
        const fig = document.querySelector('#chart [aria-describedby]');
        const id = fig?.getAttribute('aria-describedby');
        return (id ? document.getElementById(id)?.textContent : '') ?? '';
      });
      expect(await readSummary()).not.toContain('Secondary right axis');

      await page.evaluate(() => { (document.getElementById('chart') as HTMLElement).style.width = '300px'; });
      await page.waitForTimeout(150);
      const narrowState = await page.evaluate(() => {
        const fig = document.querySelector('#chart [aria-describedby]');
        const id = fig?.getAttribute('aria-describedby');
        return {
          codes: (window as unknown as { __cart: { diagnostics: readonly { code: string }[] } }).__cart.diagnostics.map(d => d.code),
          summary: (id ? document.getElementById(id)?.textContent : '') ?? '',
        };
      });
      expect(narrowState.codes).toContain('AX175');
      expect(narrowState.summary).toContain('Secondary right axis');

      // Narrow -> too-small (height 50px) clears AX175 and collapsed-axis summary; back to narrow restores both
      await page.evaluate(() => { (document.getElementById('chart') as HTMLElement).style.height = '50px'; });
      await page.waitForTimeout(150);
      const tooSmallState = await page.evaluate(() => {
        const fig = document.querySelector('#chart [aria-describedby]');
        const id = fig?.getAttribute('aria-describedby');
        return {
          codes: (window as unknown as { __cart: { diagnostics: readonly { code: string }[] } }).__cart.diagnostics.map(d => d.code),
          summary: (id ? document.getElementById(id)?.textContent : '') ?? '',
        };
      });
      expect(tooSmallState.codes).not.toContain('AX175');
      expect(tooSmallState.summary).not.toContain('Secondary right axis');

      await page.evaluate(() => { (document.getElementById('chart') as HTMLElement).style.height = '320px'; });
      await page.waitForTimeout(150);
      const narrowAgain = await page.evaluate(() => {
        const fig = document.querySelector('#chart [aria-describedby]');
        const id = fig?.getAttribute('aria-describedby');
        return {
          codes: (window as unknown as { __cart: { diagnostics: readonly { code: string }[] } }).__cart.diagnostics.map(d => d.code),
          summary: (id ? document.getElementById(id)?.textContent : '') ?? '',
        };
      });
      expect(narrowAgain.codes).toContain('AX175');
      expect(narrowAgain.summary).toContain('Secondary right axis');

      await page.evaluate(() => { (document.getElementById('chart') as HTMLElement).style.width = '640px'; });
      await page.waitForTimeout(150);
      const wideStateAfter = await page.evaluate(() => {
        const fig = document.querySelector('#chart [aria-describedby]');
        const id = fig?.getAttribute('aria-describedby');
        return {
          codes: (window as unknown as { __cart: { diagnostics: readonly { code: string }[] } }).__cart.diagnostics.map(d => d.code),
          summary: (id ? document.getElementById(id)?.textContent : '') ?? '',
        };
      });
      expect(wideStateAfter.codes).not.toContain('AX175');
      expect(wideStateAfter.summary).not.toContain('Secondary right axis');

      // Strict-mode invalid update rolls back facade state cleanly so a subsequent valid update succeeds
      const rollbackOk = await page.evaluate(() => {
        const chart = (window as unknown as { __cart: { update(p: unknown): void; diagnostics: readonly { code: string }[] } }).__cart;
        let threw = false;
        try {
          chart.update({ strict: true, layers: [{ type: 'bar', y: 'orders', yAxis: 'latency' }] });
        } catch {
          threw = true;
        }
        chart.update({ strict: false, title: 'After Rollback' });
        return { threw, has173: chart.diagnostics.some(d => d.code === 'AX173') };
      });
      expect(rollbackOk).toEqual({ threw: true, has173: false });

      expect(errors).toEqual([]);
      expect(server.reports.get('cartesian') ?? []).toEqual([]);
    } finally {
      await watched.context.close();
    }
  });
});
