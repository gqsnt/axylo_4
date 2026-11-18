/**
 * Shared setup for browser tests: a static server over the repository and one browser instance.
 * Tests load test/browser/page.html, which pulls in the built script-tag bundle, and drive it with Playwright.
 *
 * The engine is chosen with AXYLO_ENGINE: `chromium` (the default: system Chrome, `channel: 'chrome'`, exactly
 * as before), `firefox` or `webkit` (Playwright's own builds). Every test's Vitest metadata carries the engine
 * and its version (`meta.engine`, `meta.engineVersion`, in the JSON report's assertion results), so results
 * from different engines cannot be confused. A test that needs something only one engine offers calls
 * `requireEngineFeature`, which reports it as not run on the others, with the reason (`meta.notRun`).
 */
import { chromium, firefox, webkit, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from 'playwright-core';
import { afterEach, beforeEach, TestRunner } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../../..');
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };

let server: http.Server | undefined;
let browser: Browser | undefined;
let base = '';

export type Engine = 'chromium' | 'firefox' | 'webkit';
const requested = process.env.AXYLO_ENGINE ?? 'chromium';
if (requested !== 'chromium' && requested !== 'firefox' && requested !== 'webkit') throw new Error(`AXYLO_ENGINE must be chromium, firefox or webkit, not ${requested}`);
export const ENGINE: Engine = requested;

/** The version of the running browser, once started. */
export const engineVersion = (): string => browser?.version() ?? '';

// Every test records the engine it ran on. Registered when a test file imports the harness.
beforeEach(context => {
  Object.assign(context.task.meta, { engine: ENGINE, engineVersion: engineVersion() });
});

// The contexts each test opened. A test reported as not run stops where it is, before it closes its pages:
// they are closed after it, or dozens pile up until the file's last hook and make it time out. Only tests
// that call requireEngineFeature off its engines are affected; a Chrome run never reaches this.
const opened = new Map<string, BrowserContext[]>();
function track(context: BrowserContext): void {
  const id = TestRunner.getCurrentTest()?.id;
  if (id === undefined) return;
  const list = opened.get(id) ?? [];
  list.push(context);
  opened.set(id, list);
}
afterEach(async context => {
  const list = opened.get(context.task.id) ?? [];
  opened.delete(context.task.id);
  if ((context.task.meta as { notRun?: string }).notRun === undefined) return;
  await Promise.all(list.map(c => c.close().catch(() => undefined)));
});

/**
 * Reports the current test as not run on this engine, with `reason`, unless the engine is one of `engines`:
 * for evidence only those engines can give (Chrome's DevTools protocol: its computed accessibility tree,
 * touch input beyond a tap). Never a silent pass: Vitest records the test as skipped and `meta.notRun`
 * carries the reason.
 */
export function requireEngineFeature(engines: readonly Engine[], reason: string): void {
  if (engines.includes(ENGINE)) return;
  const test = TestRunner.getCurrentTest();
  if (!test) throw new Error(`not available on ${ENGINE}: ${reason}`);
  Object.assign(test.meta, { engine: ENGINE, engineVersion: engineVersion(), notRun: `${ENGINE}: ${reason}` });
  test.context.skip(`not run on ${ENGINE}: ${reason}`);
}

export async function start(): Promise<void> {
  server = http.createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' }).end(fs.readFileSync(file));
  });
  await new Promise<void>(r => server!.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = ENGINE === 'chromium' ? await chromium.launch({ channel: 'chrome', headless: true })
    // Firefox applies Ctrl + wheel as page zoom (the browser's default, which I3 requires the chart to leave alone)
    // and by default remembers it per site in the shared profile, so it would leak into every later context on
    // this origin. Per-tab zoom keeps each test's page at 100 %.
    : ENGINE === 'firefox' ? await firefox.launch({ headless: true, firefoxUserPrefs: { 'browser.zoom.siteSpecific': false } })
    : await webkit.launch({ headless: true });
}

export async function stop(): Promise<void> {
  await browser?.close();
  await new Promise<void>(r => server ? server.close(() => r()) : r());
}

/** Opens the blank test page with the Axylo script-tag bundle loaded as `window.Axylo`. */
export async function openPage(options: BrowserContextOptions & { query?: string } = {}): Promise<Page> {
  const { query = '', ...ctx } = options;
  const context = await browser!.newContext({ viewport: { width: 900, height: 700 }, locale: 'en-US', timezoneId: 'UTC', ...ctx });
  track(context);
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
  track(context);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  (page as Page & { errors: string[] }).errors = errors;
  await page.goto(`${base}/packages/axylo/test/browser/${html ?? 'blank.html'}${query}`);
  await page.addScriptTag({ url: `${base}/${path.relative(root, out)}` });
  return page;
}
