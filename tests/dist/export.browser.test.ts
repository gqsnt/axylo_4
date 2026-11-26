/**
 * Packed real-Chrome browser integration test for `axylo/export` (C6.1):
 * verifies standalone SVG serialization (resolved colors, zero `var(--axylo-...)`, concrete `<text>`
 * labels, `<title>`/`<desc>` metadata, exact dimensions), PNG rasterization at 2x DPR (`image/png`
 * Blob + decoded pixel dimensions), and RFC 4180 CSV parity against Axylo's rendered accessible table.
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
    name: 'export-e2e',
    cwd: fixture('npm'),
    format: 'esm',
    conditions: ['production'],
    contents: `
      import { line } from 'axylo/static';
      import { exportSvg, exportPng, exportPngDataUrl, exportCsv, parseCsv } from 'axylo/export';

      const el = document.getElementById('chart')!;
      el.style.width = '600px';
      el.style.height = '300px';
      const rows = [
        { month: 'Jan', rev: 1200 },
        { month: 'Feb', rev: 1450 },
        { month: 'Mar', rev: 1380 },
      ];
      const chart = line('#chart', {
        title: 'Monthly Revenue',
        data: rows,
        x: { field: 'month', ordered: true },
        y: { field: 'rev', label: 'Revenue', unit: 'USD' },
      });
      (window as unknown as Record<string, unknown>).__exp = {
        chart, exportSvg, exportPng, exportPngDataUrl, exportCsv, parseCsv, rows,
      };
    `,
  })).url;
});

afterAll(async () => {
  await closeBrowser();
  await server?.close();
});

describe('C6.1 axylo/export packed Chrome integration', () => {
  it('exports self-contained SVG, 2x PNG Blob/dataURL, and exact accessible-table CSV', async () => {
    // Allow blob: / data: only for img-src so exportPng rasterization works alongside strict script-src/style-src 'self'.
    const policy = cspPolicy('export').replace("default-src 'self';", "default-src 'self'; img-src 'self' blob: data:;");
    server.pages.set('/export.html', {
      html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/npm/node_modules/axylo/dist/axylo.css"></head><body><div id="chart"></div><script type="module" src="${scriptUrl}"></script></body></html>`,
      headers: { 'content-security-policy': policy },
    });

    const watched = await open(server);
    const { page, errors } = watched;
    await page.goto(`${server.origin}/export.html`);
    try {
      await page.waitForSelector('#chart svg g path');
      await page.waitForTimeout(120);

      // 1. Standalone SVG check
      const svgResult = await page.evaluate(() => {
        const api = (window as unknown as { __exp: { exportSvg(t: string, o?: unknown): string } }).__exp;
        const svg = api.exportSvg('#chart', { width: 600, height: 300 });
        return {
          startsSvg: svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'),
          hasVar: svg.includes('var(--axylo'),
          hasTitle: svg.includes('<title>Monthly Revenue</title>'),
          hasDesc: svg.includes('<desc>'),
          hasText: svg.includes('<text '),
          hasWidth: svg.includes('width="600"'),
          hasHeight: svg.includes('height="300"'),
          length: svg.length,
        };
      });
      expect(svgResult.startsSvg).toBe(true);
      expect(svgResult.hasVar).toBe(false);
      expect(svgResult.hasTitle).toBe(true);
      expect(svgResult.hasDesc).toBe(true);
      expect(svgResult.hasText).toBe(true);
      expect(svgResult.hasWidth).toBe(true);
      expect(svgResult.hasHeight).toBe(true);
      expect(svgResult.length).toBeGreaterThan(400);

      // 2. PNG rasterization check at 2x scale -> decoded image is exactly 1200x600
      const pngResult = await page.evaluate(async () => {
        const api = (window as unknown as {
          __exp: {
            exportPng(t: string, o?: unknown): Promise<Blob>;
            exportPngDataUrl(t: string, o?: unknown): Promise<string>;
          };
        }).__exp;
        const blob = await api.exportPng('#chart', { width: 600, height: 300, scale: 2 });
        const dataUrl = await api.exportPngDataUrl('#chart', { width: 600, height: 300, scale: 2 });
        const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = reject;
          img.src = dataUrl;
        });
        return { type: blob.type, size: blob.size, isPngUrl: dataUrl.startsWith('data:image/png;base64,'), ...dims };
      });
      expect(pngResult.type).toBe('image/png');
      expect(pngResult.size).toBeGreaterThan(1000);
      expect(pngResult.isPngUrl).toBe(true);
      expect(pngResult.w).toBe(1200);
      expect(pngResult.h).toBe(600);

      // 3. Open accessible table and verify exportCsv('#chart') matches exact rendered table rows
      await page.getByRole('button', { name: /View as table/i }).click();
      await page.waitForSelector('#chart table tbody tr');
      const csvRows = await page.evaluate(() => {
        const api = (window as unknown as {
          __exp: { exportCsv(t: string): string; parseCsv(s: string): string[][] };
        }).__exp;
        return api.parseCsv(api.exportCsv('#chart'));
      });
      expect(csvRows).toHaveLength(4); // header + 3 months
      expect(csvRows[0]).toEqual(['month', 'Revenue (USD)']);
      expect(csvRows[1]![0]).toBe('Jan');
      expect(csvRows[1]![1]).toContain('1,200');
      expect(csvRows[3]![0]).toBe('Mar');

      expect(errors).toEqual([]);
      expect(server.reports.get('export') ?? []).toEqual([]);
    } finally {
      await watched.context.close();
    }
  });
});
