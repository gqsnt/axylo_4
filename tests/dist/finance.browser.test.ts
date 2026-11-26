/**
 * Packed real-Chrome browser integration test for `axylo/finance` (C6.3) under strict CSP:
 * verifies hollow-up / filled-down / doji candlesticks + volume panel, `AX180`/`AX181` disclosure,
 * accessible table parity, strict `update()` rollback, and clean teardown.
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
    name: 'finance-e2e',
    cwd: fixture('npm'),
    format: 'esm',
    conditions: ['production'],
    contents: `
      import { candlestick } from 'axylo/finance';
      const el = document.getElementById('chart')!;
      el.style.width = '640px';
      el.style.height = '340px';
      const rows = [
        { day: '2026-01-01', open: 100, high: 112, low: 98, close: 110, vol: 5000 },
        { day: '2026-01-02', open: 110, high: 111, low: 100, close: 102, vol: 4200 },
        { day: '2026-01-03', open: 102, high: 105, low: 99, close: 102, vol: 3100 },
        { day: '2026-01-04', open: 105, high: 100, low: 95, close: 104, vol: 2000 },
      ];
      const chart = candlestick('#chart', {
        title: 'ACME Daily OHLC',
        data: rows,
        x: 'day',
        open: 'open', high: 'high', low: 'low', close: 'close', volume: 'vol',
        yAxis: { unit: 'USD' },
      });
      (window as unknown as Record<string, unknown>).__fin = chart;
    `,
  })).url;
});

afterAll(async () => {
  await closeBrowser();
  await server?.close();
});

describe('C6.3 axylo/finance packed Chrome integration under strict CSP', () => {
  it('renders candlesticks + volume, discloses AX180, matches table/summary, and rolls back rejected strict updates', async () => {
    server.pages.set('/finance.html', {
      html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/npm/node_modules/axylo/dist/axylo.css"></head><body><div id="chart"></div><script type="module" src="${scriptUrl}"></script></body></html>`,
      headers: { 'content-security-policy': cspPolicy('finance') },
    });

    const watched = await open(server);
    const { page, errors } = watched;
    await page.goto(`${server.origin}/finance.html`);
    try {
      await page.waitForSelector('#chart svg g path');
      await page.waitForSelector('#chart svg g rect');
      await page.waitForTimeout(120);

      const initial = await page.evaluate(() => {
        const chart = (window as unknown as { __fin: { diagnostics: readonly { code: string }[] } }).__fin;
        const fig = document.querySelector('#chart [aria-describedby]');
        const id = fig?.getAttribute('aria-describedby');
        return {
          codes: chart.diagnostics.map(d => d.code),
          summary: (id ? document.getElementById(id)?.textContent : '') ?? '',
          paths: document.querySelectorAll('#chart svg g path').length,
          rects: document.querySelectorAll('#chart svg g rect').length,
        };
      });
      expect(initial.codes).toContain('AX180');
      expect(initial.summary).toContain('Up candles are drawn hollow');
      expect(initial.paths).toBeGreaterThanOrEqual(2);
      expect(initial.rects).toBeGreaterThanOrEqual(4); // down body + 3 valid volume bars

      // Open accessible table and verify exact OHLC + Change + Direction + Volume rows
      await page.getByRole('button', { name: /View as table/i }).click();
      await page.waitForSelector('#chart table tbody tr');
      const table = await page.evaluate(() => ({
        headers: [...document.querySelectorAll('#chart table thead th')].map(th => th.textContent?.trim() ?? ''),
        rows: [...document.querySelectorAll('#chart table tbody tr')].map(tr =>
          [...tr.querySelectorAll('th, td')].map(td => td.textContent?.trim() ?? ''),
        ),
      }));
      expect(table.headers).toEqual(['day', 'Open', 'High', 'Low', 'Close', 'Change', 'Direction', 'Volume']);
      expect(table.rows).toHaveLength(4);
      expect(table.rows[0]![5]).toBe('+10 USD');
      expect(table.rows[0]![6]).toBe('up');
      expect(table.rows[3]![1]).toContain('(invalid OHLC)');

      // Strict rollback check
      const rolled = await page.evaluate(() => {
        const chart = (window as unknown as { __fin: { update(p: unknown): void; diagnostics: readonly { code: string }[] } }).__fin;
        let threw = false;
        try {
          chart.update({ strict: true, open: 'close' });
        } catch {
          threw = true;
        }
        chart.update({ strict: false, title: 'After Finance Rollback' });
        return { threw, titleText: document.querySelector('#chart figcaption')?.textContent ?? '' };
      });
      expect(rolled.threw).toBe(true);
      expect(errors).toEqual([]);
      expect(server.reports.get('finance') ?? []).toEqual([]);
    } finally {
      await watched.context.close();
    }
  });
});
