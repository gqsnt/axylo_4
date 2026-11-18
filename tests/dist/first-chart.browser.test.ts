/**
 * Spec DX1 in a browser: each documented first chart (examples/first-chart, copied verbatim into its
 * fixture) renders from the packed files in system Chrome, by npm and by script tag: a figure with an
 * accessible name, marks drawn, no console errors or warnings. Diagnostics of level error or warning print with
 * console.warn in every build (spec 3.5), so a clean console also means no error diagnostics; the error state
 * is checked as well. Also: the title is not required by either route (without it the chart still draws, with
 * a generated name, and raises only AX140), and importing the package changes nothing in the document (the
 * `sideEffects` claim).
 *
 * Scope (DX1): the documented first chart is a line chart; these tests establish DX1 for that chart by npm
 * and by script tag. The other four chart functions come from the same entry points and files, so the
 * package-level parts (resolution, loading, styles) carry over, but their own first-chart snippets are not
 * written or tested here (see README.md).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext } from 'playwright-core';
import { bundle, closeBrowser, drawn, figureName, launch, open, problems, startServer, type Server } from './browser';
import { fixture, inside } from './paths';

let server: Server;
beforeAll(async () => { server = await startServer(); await launch(); });
afterAll(async () => { await closeBrowser(); await server?.close(); });

const NAME = /^- (group|figure|img) "Monthly visitors"/;
const page = (title: string, body: string): string =>
  `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;

/** Answers the snippet's CDN URLs from the packed files, by their path in the tarball, as the CDN would. */
const CDN = 'https://cdn.jsdelivr.net/npm/axylo/';
const cdn = (served: string[]) => (context: BrowserContext) => context.route(`${CDN}**`, route => {
  const rel = route.request().url().slice(CDN.length);
  const file = fixture('script', 'node_modules/axylo', rel);
  if (!inside(fixture('script', 'node_modules/axylo'), file) || !fs.existsSync(file)) return route.fulfill({ status: 404 });
  served.push(rel);
  return route.fulfill({ status: 200, contentType: rel.endsWith('.css') ? 'text/css' : 'text/javascript', body: fs.readFileSync(file) });
});

/** The chart without its title: drawn, named by a generated name, and AX140 the only thing printed (spec 3.5). */
async function expectUntitled(w: Awaited<ReturnType<typeof open>>, selector: string): Promise<void> {
  const state = await drawn(w.page, selector);
  expect(state.marks).toBeGreaterThan(0);
  expect(await figureName(w.page, selector)).toMatch(/^- (group|figure|img) "[^"]+"/);
  expect(await figureName(w.page, selector)).not.toMatch(NAME);
  const printed = problems(w);
  expect(printed).toHaveLength(1);
  expect(printed[0]).toMatch(/^warning: \[axylo AX140\]/);
}

/** Every input of ours that esbuild bundled came from the fixture, never from packages/. */
function fromFixture(inputs: string[], name: 'npm'): void {
  expect(inputs.filter(p => p.includes(`${path.sep}packages${path.sep}`) && !inside(fixture(name), p))).toEqual([]);
}

describe('npm: examples/first-chart/npm.ts bundled with esbuild from the npm fixture', () => {
  for (const [flavour, conditions] of [['production', ['production']], ['development', ['development']]] as const) {
    it(`renders under the ${flavour} condition`, async () => {
      const { url, inputs } = await bundle({ name: `first-npm-${flavour}`, cwd: fixture('npm'), entry: fixture('npm', 'example/npm.ts'), conditions: [...conditions] });
      fromFixture(inputs, 'npm');
      expect(inputs).toContain(fixture('npm', 'node_modules/axylo/dist', flavour === 'production' ? 'axylo.js' : 'axylo.dev.js'));
      server.pages.set(`/first/npm-${flavour}.html`, { html: page('npm', `<div id="chart"></div><script src="${url}"></script>`) });
      const w = await open(server);
      await w.page.goto(`${server.origin}/first/npm-${flavour}.html`);
      const state = await drawn(w.page, '#chart');
      expect(state.figures).toBe(1);
      expect(state.marks).toBeGreaterThan(0);
      expect(state.errorState).toBe(false);
      expect(await figureName(w.page, '#chart')).toMatch(NAME);
      expect(problems(w)).toEqual([]);
      expect(w.external).toEqual([]);
      await w.context.close();
    });
  }

  it('does not require the title: without it the chart draws, with a generated name, and raises only AX140', async () => {
    const code = fs.readFileSync(fixture('npm', 'example/npm.ts'), 'utf8');
    const untitled = code.replace("title: 'Monthly visitors', ", '');
    expect(untitled).not.toBe(code);
    const { url } = await bundle({ name: 'first-npm-untitled', cwd: fixture('npm'), contents: untitled, conditions: ['production'] });
    server.pages.set('/first/npm-untitled.html', { html: page('npm', `<div id="chart"></div><script src="${url}"></script>`) });
    const w = await open(server);
    await w.page.goto(`${server.origin}/first/npm-untitled.html`);
    await expectUntitled(w, '#chart');
    await w.context.close();
  });

  it('importing the package changes nothing in the document until a chart is created', async () => {
    const { url } = await bundle({
      name: 'first-npm-import-only', cwd: fixture('npm'), conditions: ['production'],
      contents: `import * as axylo from 'axylo';\n(window as unknown as { axylo: unknown }).axylo = axylo;`,
    });
    server.pages.set('/first/import-only.html', { html: page('import only', `<div id="chart"></div><script src="${url}"></script>`) });
    const w = await open(server);
    await w.page.goto(`${server.origin}/first/import-only.html`);
    const seen = await w.page.evaluate(() => ({
      loaded: typeof (window as unknown as { axylo?: { line?: unknown } }).axylo?.line === 'function',
      adopted: document.adoptedStyleSheets.length,
      sheets: document.styleSheets.length,
      styles: document.querySelectorAll('style').length,
      chart: document.getElementById('chart')!.outerHTML,
      bodyChildren: document.body.children.length,
    }));
    expect(seen).toEqual({ loaded: true, adopted: 0, sheets: 0, styles: 0, chart: '<div id="chart"></div>', bodyChildren: 2 });
    expect(problems(w)).toEqual([]);
    await w.context.close();
  });
});

describe('script tag: examples/first-chart/script.html, with the CDN URLs answered from the packed files', () => {
  it('renders', async () => {
    const served: string[] = [];
    const w = await open(server, cdn(served));
    await w.page.goto(`${server.origin}/script/example/script.html`);
    const state = await drawn(w.page, '#chart');
    expect(served.sort()).toEqual(['dist/axylo.css', 'dist/axylo.iife.min.js']);
    expect(state.figures).toBe(1);
    expect(state.marks).toBeGreaterThan(0);
    expect(state.errorState).toBe(false);
    expect(await figureName(w.page, '#chart')).toMatch(NAME);
    expect(problems(w)).toEqual([]);
    expect(w.external).toEqual([]);
    await w.context.close();
  });

  it('does not require the title', async () => {
    const code = fs.readFileSync(fixture('script', 'example/script.html'), 'utf8');
    const untitled = code.replace("title: 'Monthly visitors', ", '');
    expect(untitled).not.toBe(code);
    server.pages.set('/first/script-untitled.html', { html: untitled });
    const w = await open(server, cdn([]));
    await w.page.goto(`${server.origin}/first/script-untitled.html`);
    await expectUntitled(w, '#chart');
    await w.context.close();
  });
});
