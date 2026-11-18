/**
 * Spec DX1 in a browser: each documented first chart (examples/first-chart, copied verbatim into its
 * fixture) renders from the packed files in system Chrome: a figure with an accessible name, marks drawn, no
 * console errors or warnings. Diagnostics of level error or warning print with console.warn in every build
 * (spec 3.5), so a clean console also means no error diagnostics; the error state is checked as well.
 * Also: the title is not required by any of the three routes (without it the chart still draws, with a
 * generated name, and raises only AX140), importing the package changes nothing in the document (the
 * `sideEffects` claim), the React adapter's lifecycle under StrictMode as seen from outside it, and hydration.
 *
 * Scope (DX1): the documented first chart is a line chart; these tests establish DX1 for that chart by npm,
 * script tag and React. The other four chart functions come from the same entry points and files, so the
 * package-level parts (resolution, loading, styles) carry over, but their own first-chart snippets are not
 * written or tested here (see README.md).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext } from 'playwright-core';
import type { Plugin } from 'esbuild';
import { bundle, closeBrowser, drawn, figureName, launch, open, problems, startServer, type Server } from './browser';
import { fixture, here, inside, nodeJson } from './paths';

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

/** Resolves the adapter's `import 'axylo'` to pages/spy-axylo.ts, which wraps the packed core from the fixture. */
const spyOnCore = (): Plugin => {
  const spy = path.join(here, 'pages/spy-axylo.ts');
  return {
    name: 'spy-on-core',
    setup(b) {
      b.onResolve({ filter: /^axylo$/ }, async args => {
        if (args.pluginData?.spy) return undefined;
        if (args.importer === spy) return b.resolve('axylo', { kind: args.kind, resolveDir: fixture('react'), pluginData: { spy: true } });
        if (inside(fixture('react', 'node_modules/@axylo/react'), args.importer)) return { path: spy };
        return undefined;
      });
    },
  };
};

describe('React: examples/first-chart/react.tsx from the react fixture', () => {
  it('renders under StrictMode with one chart left', async () => {
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

  it('StrictMode, seen through the packed adapter: setup, cleanup, setup again, final unmount; the first chart no longer acts', async () => {
    const { url, inputs } = await bundle({
      name: 'first-react-lifecycle', cwd: fixture('react'), entry: fixture('react', 'main-strict.tsx'), conditions: ['development'],
      nodeEnv: 'development', allow: [path.join(here, 'pages')], plugins: [spyOnCore()],
    });
    expect(inputs).toContain(fixture('react', 'node_modules/@axylo/react/dist/index.dev.js'));
    expect(inputs).toContain(fixture('react', 'node_modules/axylo/dist/axylo.dev.js'));
    server.pages.set('/first/react-lifecycle.html', { html: page('react', `<div id="root"></div><script src="${url}"></script>`) });
    const w = await open(server);
    await w.page.goto(`${server.origin}/first/react-lifecycle.html`);
    expect((await drawn(w.page, '#root')).marks).toBeGreaterThan(0);
    type Log = { id: number; what: string }[];
    const log = () => w.page.evaluate(() => (window as unknown as { __spy: { log: Log } }).__spy.log.filter(e => !e.what.startsWith('event:')));
    const events = () => w.page.evaluate(() => (window as unknown as { __spy: { log: Log } }).__spy.log.filter(e => e.what.startsWith('event:')));
    // StrictMode in development runs effects, cleans them up and runs them again: create, destroy, create.
    expect(await log()).toEqual([{ id: 1, what: 'create' }, { id: 1, what: 'destroy' }, { id: 2, what: 'create' }]);
    expect(await w.page.locator('#root figure').count()).toBe(1);

    // The first chart, destroyed, ignores every call: nothing changes, nothing is created, nothing throws.
    const stale = await w.page.evaluate(async () => {
      const first = (window as unknown as { __spy: { handles: { update(p: object): void; append(r: object[]): void; zoom(d: null): void }[] } }).__spy.handles[0]!;
      first.update({ title: 'Stale' });
      first.append([{ month: '2026-05', visitors: 1 }]);
      first.zoom(null);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { figures: document.querySelectorAll('figure').length, titles: Array.from(document.querySelectorAll('.axylo-title')).map(t => t.textContent) };
    });
    expect(stale).toEqual({ figures: 1, titles: ['Monthly visitors'] });

    // Pointer events reach the handler through the live chart only.
    const plot = (await w.page.locator('#root .axylo-plot').boundingBox())!;
    for (const f of [0.3, 0.5, 0.7]) { await w.page.mouse.move(plot.x + plot.width * f, plot.y + plot.height * 0.5); await w.page.waitForTimeout(50); }
    const hovered = await events();
    expect(hovered.length).toBeGreaterThan(0);
    expect(new Set(hovered.map(e => e.id))).toEqual(new Set([2]));
    expect(await w.page.evaluate(() => (window as unknown as { __hovers: number }).__hovers)).toBeGreaterThan(0);

    // Unmount destroys the second chart and leaves nothing behind that still reacts.
    await w.page.mouse.move(1, 1);
    await w.page.evaluate(() => (window as unknown as { __unmount: () => void }).__unmount());
    expect(await log()).toEqual([{ id: 1, what: 'create' }, { id: 1, what: 'destroy' }, { id: 2, what: 'create' }, { id: 2, what: 'destroy' }]);
    expect(await w.page.locator('#root *').count()).toBe(0);
    const before = (await events()).length;
    const after = await w.page.evaluate(async () => {
      const second = (window as unknown as { __spy: { handles: { update(p: object): void }[] } }).__spy.handles[1]!;
      second.update({ title: 'Stale' });
      window.dispatchEvent(new Event('resize'));
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { figures: document.querySelectorAll('figure').length, hovers: (window as unknown as { __hovers: number }).__hovers };
    });
    await w.page.mouse.move(plot.x + plot.width * 0.5, plot.y + plot.height * 0.5);
    await w.page.waitForTimeout(100);
    expect(after.figures).toBe(0);
    expect((await events()).length).toBe(before);
    expect(problems(w)).toEqual([]);
    await w.context.close();
  });

  it('does not require the title', async () => {
    const code = fs.readFileSync(fixture('react', 'example/react.tsx'), 'utf8');
    const untitled = code.replace(' title="Monthly visitors"', '');
    expect(untitled).not.toBe(code);
    fs.mkdirSync(fixture('react', '.out', 'untitled'), { recursive: true });
    fs.writeFileSync(fixture('react', '.out', 'untitled', 'react.tsx'), untitled);
    const { url } = await bundle({
      name: 'first-react-untitled', cwd: fixture('react'), conditions: ['development'], nodeEnv: 'development',
      contents: `import { createRoot } from 'react-dom/client';\nimport { MonthlyVisitors } from './.out/untitled/react';\ncreateRoot(document.getElementById('root')!).render(<MonthlyVisitors />);`,
    });
    server.pages.set('/first/react-untitled.html', { html: page('react', `<div id="root"></div><script src="${url}"></script>`) });
    const w = await open(server);
    await w.page.goto(`${server.origin}/first/react-untitled.html`);
    await expectUntitled(w, '#root');
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
