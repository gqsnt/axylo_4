/**
 * Shared setup for browser tests: a static server over the repository and one Chrome instance.
 * Tests load test/browser/page.html, which pulls in the built script-tag bundle, and drive it with Playwright.
 */
import { chromium, type Browser, type BrowserContextOptions, type Page } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../../..');
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };

let server: http.Server | undefined;
let browser: Browser | undefined;
let base = '';

export async function start(): Promise<void> {
  server = http.createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' }).end(fs.readFileSync(file));
  });
  await new Promise<void>(r => server!.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
}

export async function stop(): Promise<void> {
  await browser?.close();
  await new Promise<void>(r => server ? server.close(() => r()) : r());
}

/** Opens the blank test page with the Axylo script-tag bundle loaded as `window.Axylo`. */
export async function openPage(options: BrowserContextOptions & { query?: string } = {}): Promise<Page> {
  const { query = '', ...ctx } = options;
  const context = await browser!.newContext({ viewport: { width: 900, height: 700 }, locale: 'en-US', timezoneId: 'UTC', ...ctx });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  (page as Page & { errors: string[] }).errors = errors;
  await page.goto(`${base}/packages/axylo/test/browser/page.html${query}`);
  return page;
}

export const url = (p: string): string => `${base}/${p}`;

/**
 * Bundles a TypeScript entry for the browser and opens a page that has run it. The entry talks to the test
 * through globals it sets on `window`. Use this to test a module in a real browser before the public bundle
 * exposes it.
 */
export async function openEntry(entry: string, options: BrowserContextOptions & { query?: string; html?: string } = {}): Promise<Page> {
  const { build } = await import('esbuild');
  const out = path.join(root, 'packages/axylo/test/browser/.out', path.basename(entry).replace(/\.tsx?$/, '.js'));
  await build({ entryPoints: [path.resolve(root, entry)], bundle: true, format: 'iife', target: 'es2022', define: { __DEV__: 'true' }, outfile: out, logLevel: 'silent' });
  const { query = '', html, ...ctx } = options;
  const context = await browser!.newContext({ viewport: { width: 900, height: 700 }, locale: 'en-US', timezoneId: 'UTC', ...ctx });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  (page as Page & { errors: string[] }).errors = errors;
  await page.goto(`${base}/packages/axylo/test/browser/${html ?? 'blank.html'}${query}`);
  await page.addScriptTag({ url: `${base}/${path.relative(root, out)}` });
  return page;
}
