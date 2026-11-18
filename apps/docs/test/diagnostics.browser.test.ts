/**
 * Criterion DX4, on the built site: there is one page per code of the registry and no page for a code that
 * does not exist. And the minimal inputs that can only raise their code in a page (contrast, size, labels,
 * formatters, appends) do raise it, rendered with the built script-tag bundle in system Chrome.
 *
 *   npm run build && AXYLO_BROWSER=1 npx vitest run --config apps/docs/vitest.config.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { buildSite } from '../lib/site.mjs';
import { docsRoot } from '../lib/examples.mjs';
import { serve } from '../lib/serve.mjs';
import { diagnosticRegistry } from '../../../packages/axylo/src/diagnostics/registry';
import { diagnostics } from '../data/diagnostics.mjs';

let server: Awaited<ReturnType<typeof serve>>;
let browser: Browser;
const dist = path.join(docsRoot, 'dist');

beforeAll(async () => {
  await buildSite();
  server = await serve();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

describe('one page per diagnostic code', () => {
  it('every code in the registry has a built page', () => {
    const missing = Object.keys(diagnosticRegistry).filter(code => !fs.existsSync(path.join(dist, 'diagnostics', `${code}.html`)));
    expect(missing).toEqual([]);
  });
  it('every built page is for a code in the registry', () => {
    const pages = fs.readdirSync(path.join(dist, 'diagnostics')).map(f => f.replace(/\.html$/, ''));
    expect(pages.filter(code => !(code in diagnosticRegistry))).toEqual([]);
  });
  it('the diagnostics page links every code page', () => {
    const html = fs.readFileSync(path.join(dist, 'diagnostics.html'), 'utf8');
    expect(Object.keys(diagnosticRegistry).filter(code => !html.includes(`href="diagnostics/${code}.html"`))).toEqual([]);
  });
});

describe('minimal inputs that need a page raise their code', () => {
  const inPage = diagnostics.filter(d => d.run === 'browser');
  it.each(inPage.map(d => [d.code, d.input] as const))('%s', async (code, input) => {
    const context = await browser.newContext({ viewport: { width: 760, height: 700 }, locale: 'en-US', timezoneId: 'UTC' });
    const page = await context.newPage();
    const codes = new Set<string>();
    const errors: string[] = [];
    page.on('console', m => {
      if (m.type() === 'error') errors.push(m.text());
      for (const match of m.text().matchAll(/^\[axylo (AX\d{3})\]/g)) codes.add(match[1]!);
    });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(server.url('apps/docs/dist/examples/script-tag.html'));
    await page.evaluate(source => {
      document.body.replaceChildren();
      const target = document.createElement('div');
      document.body.append(target);
      const { line, area, bar, scatter, donut } = (window as unknown as { Axylo: Record<string, unknown> }).Axylo;
      new Function('target', 'line', 'area', 'bar', 'scatter', 'donut', source)(target, line, area, bar, scatter, donut);
    }, input);
    await expect.poll(() => codes.has(code), { timeout: 5000 }).toBe(true);
    expect(errors).toEqual([]);
    await context.close();
  });
});
