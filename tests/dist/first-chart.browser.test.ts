/**
 * Spec DX1 in a browser: each documented first chart (examples/first-chart, copied verbatim into its
 * fixture) renders from the packed files in system Chrome: a figure with an accessible name, marks drawn, no
 * console errors or warnings. Diagnostics of level error or warning print with console.warn in every build
 * (spec 3.5), so a clean console also means no error diagnostics; the error state is checked as well.
 * Also: the title is not required (without it the chart still draws and raises only AX140), importing the
 * package changes nothing in the document (the `sideEffects` claim), and React StrictMode and hydration.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { bundle, closeBrowser, drawn, figureName, launch, open, problems, startServer, type Server } from './browser';
import { fixture, inside, nodeJson } from './paths';

let server: Server;
beforeAll(async () => { server = await startServer(); await launch(); });
afterAll(async () => { await closeBrowser(); await server?.close(); });

const NAME = /^- (group|figure|img) "Monthly visitors"/;
const page = (title: string, body: string): string =>
  `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;

/** Every input of ours that esbuild bundled came from the fixture, never from packages/. */
function fromFixture(inputs: string[], name: 'npm' | 'react'): void {
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
    const state = await drawn(w.page, '#chart');
    expect(state.marks).toBeGreaterThan(0);
    expect(await figureName(w.page, '#chart')).toMatch(/^- (group|figure|img) "[^"]+"/);
    const printed = problems(w);
    expect(printed).toHaveLength(1);
    expect(printed[0]).toMatch(/^warning: \[axylo AX140\]/);
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
    const CDN = 'https://cdn.jsdelivr.net/npm/axylo/';
    const served: string[] = [];
    const w = await open(server, context => context.route(`${CDN}**`, route => {
      // The CDN serves the published package's files by their path in the tarball.
      const rel = route.request().url().slice(CDN.length);
      const file = fixture('script', 'node_modules/axylo', rel);
      if (!inside(fixture('script', 'node_modules/axylo'), file) || !fs.existsSync(file)) return route.fulfill({ status: 404 });
      served.push(rel);
      return route.fulfill({ status: 200, contentType: rel.endsWith('.css') ? 'text/css' : 'text/javascript', body: fs.readFileSync(file) });
    }));
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
});

describe('React: examples/first-chart/react.tsx from the react fixture', () => {
  it('renders under StrictMode (setup, cleanup, setup) with one chart left', async () => {
    const { url, inputs } = await bundle({ name: 'first-react', cwd: fixture('react'), entry: fixture('react', 'main.tsx'), conditions: ['development'], nodeEnv: 'development' });
    fromFixture(inputs, 'react');
    expect(inputs).toContain(fixture('react', 'node_modules/@axylo/react/dist/index.dev.js'));
    server.pages.set('/first/react.html', { html: page('react', `<div id="root"></div><script src="${url}"></script>`) });
    const w = await open(server);
    await w.page.goto(`${server.origin}/first/react.html`);
    const state = await drawn(w.page, '#root');
    expect(state.figures).toBe(1);
    expect(state.marks).toBeGreaterThan(0);
    expect(state.errorState).toBe(false);
    expect(await figureName(w.page, '#root')).toMatch(NAME);
    expect(problems(w)).toEqual([]);
    await w.context.close();
  });

  it('hydrates the server-rendered markup without a mismatch and draws', async () => {
    const ssr = fixture('react', '.out', 'ssr.mjs');
    await build({
      entryPoints: [fixture('react', 'ssr.tsx')], bundle: true, platform: 'node', format: 'esm', packages: 'external',
      jsx: 'automatic', outfile: ssr, absWorkingDir: fixture('react'), logLevel: 'silent',
    });
    const { markup } = nodeJson<{ markup: Record<string, string> }>(path.dirname(ssr), [ssr]);
    const { url } = await bundle({ name: 'first-react-hydrate', cwd: fixture('react'), entry: fixture('react', 'hydrate.tsx'), conditions: ['development'], nodeEnv: 'development' });
    server.pages.set('/first/hydrate.html', { html: page('hydrate', `<div id="root">${markup.MonthlyVisitors}</div><script src="${url}"></script>`) });
    const w = await open(server);
    await w.page.goto(`${server.origin}/first/hydrate.html`);
    const state = await drawn(w.page, '#root');
    expect(state.figures).toBe(1);
    expect(state.marks).toBeGreaterThan(0);
    expect(await figureName(w.page, '#root')).toMatch(NAME);
    expect(problems(w)).toEqual([]);
    await w.context.close();
  });
});

describe('development and production flavours from the packed files (spec 3.5: hints print in development builds only)', () => {
  // Every value a plain decimal string: AX104, a hint (spec 3.5), and nothing else.
  const consumer = `import { line } from 'axylo';
line('#chart', { title: 'Counts', data: [{ day: '2026-01-01', count: '12' }, { day: '2026-01-02', count: '15' }, { day: '2026-01-03', count: '9' }], x: 'day', y: 'count' });`;
  for (const [flavour, printed] of [['development', 1], ['production', 0]] as const) {
    it(`${flavour}: the AX104 hint is printed ${printed ? 'once' : 'not at all'}, and the chart draws`, async () => {
      const { url } = await bundle({ name: `hint-${flavour}`, cwd: fixture('npm'), contents: consumer, conditions: [flavour] });
      server.pages.set(`/first/hint-${flavour}.html`, { html: page('hint', `<div id="chart"></div><script src="${url}"></script>`) });
      const w = await open(server);
      await w.page.goto(`${server.origin}/first/hint-${flavour}.html`);
      expect((await drawn(w.page, '#chart')).marks).toBeGreaterThan(0);
      const hints = w.console.filter(m => m.text.startsWith('[axylo AX'));
      expect(hints.filter(m => m.text.startsWith('[axylo AX104]') && m.type === 'info')).toHaveLength(printed);
      expect(hints.filter(m => !m.text.startsWith('[axylo AX104]'))).toEqual([]);
      expect(problems(w)).toEqual([]);
      await w.context.close();
    });
  }
});
