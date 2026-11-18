/**
 * A local HTTP server over the fixtures and one system Chrome (playwright-core, channel 'chrome', headless)
 * for the distribution's browser tests. packages/axylo/test/browser/harness.ts is not reused: it serves the
 * whole repository with no response headers, and these tests need pages served with real headers from the
 * fixtures only.
 */
import { chromium, type Browser, type BrowserContext, type ConsoleMessage, type Page } from 'playwright-core';
import { build } from 'esbuild';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fixture, here, out } from './paths';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.map': 'application/json',
};

/** URL prefix → directory. Nothing else on disk is reachable. */
const MOUNTS: Record<string, string> = {
  '/npm/': fixture('npm'), '/script/': fixture('script'), '/react/': fixture('react'), '/pages/': path.join(here, 'pages'), '/out/': out,
};

export interface Server {
  origin: string;
  /** Generated documents: path → body and response headers. */
  pages: Map<string, { html: string; headers?: Record<string, string> }>;
  /** Bodies POSTed to /csp-report. */
  reports: unknown[];
  close(): Promise<void>;
}

export async function startServer(): Promise<Server> {
  const pages = new Map<string, { html: string; headers?: Record<string, string> }>();
  const reports: unknown[] = [];
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (req.method === 'POST' && pathname === '/csp-report') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => { try { reports.push(JSON.parse(body)); } catch { reports.push(body); } res.writeHead(204).end(); });
      return;
    }
    const page = pages.get(pathname);
    if (page) { res.writeHead(200, { 'content-type': TYPES['.html']!, ...page.headers }).end(page.html); return; }
    const mount = Object.keys(MOUNTS).find(p => pathname.startsWith(p));
    if (!mount) { res.writeHead(404).end(); return; }
    const dir = MOUNTS[mount]!;
    const file = path.join(dir, pathname.slice(mount.length));
    if (!file.startsWith(dir + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(fs.readFileSync(file));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { origin, pages, reports, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

let browser: Browser | undefined;
export async function launch(): Promise<Browser> {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  return browser;
}
export async function closeBrowser(): Promise<void> {
  await browser?.close();
  browser = undefined;
}

export interface Watched {
  page: Page;
  context: BrowserContext;
  console: { type: string; text: string }[];
  errors: string[];
  /** Requests to any origin but the local server, and whether they were answered. */
  external: string[];
}

/** A fresh context whose only network is the local server (plus routes the caller adds), with console capture. */
export async function open(server: Server, setup?: (context: BrowserContext) => Promise<unknown>): Promise<Watched> {
  const context = await browser!.newContext({ viewport: { width: 900, height: 700 }, locale: 'en-US', timezoneId: 'UTC' });
  const external: string[] = [];
  await context.route(url => !url.href.startsWith(server.origin), route => { external.push(route.request().url()); return route.abort(); });
  if (setup) await setup(context);
  const page = await context.newPage();
  const watched: Watched = { page, context, console: [], errors: [], external };
  page.on('console', (m: ConsoleMessage) => watched.console.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', e => watched.errors.push(String(e)));
  return watched;
}

/** Console lines that a clean first chart must not print. */
export const problems = (w: Watched): string[] => [
  ...w.errors.map(e => `pageerror: ${e}`),
  ...w.console.filter(m => m.type === 'error' || m.type === 'warning').map(m => `${m.type}: ${m.text}`),
];

/** Bundles an entry for the browser, as an application's bundler would, from inside a fixture. */
export async function bundle(options: {
  name: string; cwd: string; entry?: string; contents?: string; format?: 'iife' | 'esm'; conditions?: string[]; nodeEnv?: 'development' | 'production';
}): Promise<{ url: string; inputs: string[] }> {
  const outfile = path.join(out, `${options.name}.js`);
  const r = await build({
    ...(options.entry ? { entryPoints: [options.entry] } : { stdin: { contents: options.contents!, resolveDir: options.cwd, loader: 'tsx' as const } }),
    absWorkingDir: options.cwd, bundle: true, format: options.format ?? 'iife', target: 'es2022', jsx: 'automatic', outfile,
    conditions: options.conditions ?? [], metafile: true, logLevel: 'silent',
    define: { 'process.env.NODE_ENV': JSON.stringify(options.nodeEnv ?? 'production') },
  });
  return { url: `/out/${options.name}.js`, inputs: Object.keys(r.metafile.inputs).map(p => path.resolve(options.cwd, p)) };
}

export interface ChartState {
  figures: number;
  /** Shapes in the SVG scene that have geometry and are painted with a series color, or painted canvas pixels. */
  marks: number;
  /** Shapes in the scene that are not series-painted (grid, axes, references). */
  other: number;
  errorState: boolean;
  text: string;
}

/**
 * What a chart under `selector` shows. A data mark is told from a gridline by its paint: the SVG renderer
 * paints every shape through `color` with the unresolved CSS expression of its paint (render/svg.ts,
 * contracts PaintBindings), so series shapes carry `var(--axylo-series-N)` and the grid `var(--axylo-grid)`.
 */
export async function chartState(page: Page, selector: string): Promise<ChartState> {
  return page.evaluate(sel => {
    const root = document.querySelector(sel);
    if (!root) return { figures: 0, marks: 0, other: 0, errorState: false, text: '' };
    let marks = 0;
    let other = 0;
    for (const el of Array.from(root.querySelectorAll<SVGGraphicsElement>('.axylo-scene path, .axylo-scene rect, .axylo-scene circle, .axylo-scene line, .axylo-scene polyline'))) {
      const geometry = el.tagName.toLowerCase() === 'path'
        ? (el.getAttribute('d') ?? '').trim().length > 1
        : (() => { const b = el.getBBox(); return b.width > 0 || b.height > 0; })();
      if (!geometry) continue;
      let painted: Element | null = el;
      let color = '';
      while (painted && painted !== root && !color) { color = (painted as SVGElement).style?.getPropertyValue('color') ?? ''; painted = painted.parentElement; }
      if (color.includes('--axylo-series-')) marks++;
      else other++;
    }
    for (const canvas of Array.from(root.querySelectorAll('canvas'))) {
      const ctx = canvas.getContext('2d');
      if (!ctx || canvas.width === 0 || canvas.height === 0) continue;
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) { marks++; break; }
    }
    const message = root.querySelector('.axylo-message') as HTMLElement | null;
    const errorState = !!message && !message.hidden && getComputedStyle(message).display !== 'none' && (message.textContent ?? '').trim() !== '';
    return { figures: root.querySelectorAll('figure').length, marks, other, errorState, text: root.textContent ?? '' };
  }, selector);
}

/** Waits until the chart under `selector` has drawn marks, or the timeout passes; returns its last state. */
export async function drawn(page: Page, selector: string, timeout = 10000): Promise<ChartState> {
  const until = Date.now() + timeout;
  let state = await chartState(page, selector);
  while (state.marks === 0 && Date.now() < until) {
    await page.waitForTimeout(50);
    state = await chartState(page, selector);
  }
  console.info(`${selector}: ${state.figures} figure(s), ${state.marks} series-painted mark(s), ${state.other} other shape(s)${state.errorState ? ', error state' : ''}`);
  return state;
}

/** The role and accessible name of the first figure under `selector`, as Playwright's accessibility snapshot computes them. */
export async function figureName(page: Page, selector: string): Promise<string> {
  const snapshot = await page.locator(`${selector} figure`).first().ariaSnapshot();
  const first = snapshot.split('\n')[0] ?? '';
  console.info(`${selector}: ${first}`);
  return first;
}
