/**
 * The built site itself, in system Chrome: every page loads without console errors or failed requests, does
 * not scroll sideways on a phone, names its example frames, and has no axe-core violations of its own (the
 * charts inside the frames are the library's, and are checked by the library's own accessibility tests).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium, type Browser } from 'playwright-core';
import { buildSite } from '../lib/site.mjs';
import { repoRoot } from '../lib/examples.mjs';
import { serve } from '../lib/serve.mjs';
import { pages } from '../data/nav.mjs';
import { diagnostics } from '../data/diagnostics.mjs';

const axe = fs.readFileSync(createRequire(path.join(repoRoot, 'package.json')).resolve('axe-core/axe.min.js'), 'utf8');
let server: Awaited<ReturnType<typeof serve>>;
let browser: Browser;

beforeAll(async () => {
  await buildSite();
  server = await serve();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

const all = [...pages.map(p => `${p.page}.html`), ...diagnostics.map(d => `diagnostics/${d.code}.html`)];

describe('site pages', () => {
  it.each(all)('%s', async file => {
    for (const [width, scheme] of [[390, 'dark'], [1280, 'light']] as const) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, locale: 'en-US' });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', e => errors.push(e.message));
      page.on('response', r => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
      await page.goto(server.url(`apps/docs/dist/${file}`));
      const frames = await page.evaluate(() => [...document.querySelectorAll('iframe')].map(f => f.title));
      expect(frames.every(title => title.startsWith('Live example: ')), 'every frame has a title').toBe(true);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${file} at ${width} px scrolls sideways`).toBeLessThanOrEqual(0);
      await page.addScriptTag({ content: axe });
      const violations = await page.evaluate(async () => {
        const axeGlobal = (window as unknown as { axe: { run(context: unknown, options: unknown): Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
        const result = await axeGlobal.run({ exclude: [['iframe']] }, { iframes: false, resultTypes: ['violations'] });
        return result.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(', ')}`);
      });
      expect(violations, `${file} at ${width} px, ${scheme}`).toEqual([]);
      expect(errors, `${file} errors`).toEqual([]);
      await context.close();
    }
  }, 60_000);
});
