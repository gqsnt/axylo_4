/**
 * Shared setup for the chart tests: the test page with the built script-tag bundle (`window.Axylo`, the
 * development flavour), and the Phase 1 fixtures (research/harness/src/data.js) installed as `window.fx`.
 */
import type { BrowserContextOptions, Page } from 'playwright-core';
import { expect } from 'vitest';
import { openPage } from '../harness';
import { decodePng, type Image } from '../render/png';

export type { Image };

declare global {
  interface Window {
    // The bundle's global and the fixtures, typed loosely: the tests drive the public API as a page would.
    Axylo: Record<string, (...args: unknown[]) => ChartLike>;
    fx: Fixtures;
    charts: ChartLike[];
    nextFrames(n?: number): Promise<void>;
  }
}

export interface ChartLike {
  update(patch: Record<string, unknown>): void;
  append(rows: readonly unknown[], options?: { keep?: number }): void;
  zoom(domain: readonly unknown[] | null): void;
  on(event: string, listener: (payload: unknown) => void): () => void;
  readonly diagnostics: readonly { code: string; level: string; message: string; field?: string; chart: string }[];
  destroy(): void;
  __bench: { revision: number; ready(): Promise<void>; describe(): { xDomain: number[] | null; yDomain: number[] | null; series: { key: string; points: number; oldestX: number; newestX: number; missing: number }[] } };
  __dev: { stages(): Stages; fail(stage: string | null): void; renderer: string };
}

/** Counters per pipeline stage (src/core/chart.ts, STAGES). */
export type Stages = Record<'options' | 'normalize' | 'append' | 'view' | 'frame' | 'theme' | 'formatters' | 'layout' | 'scene' | 'lookup' | 'reader' | 'draw' | 'text' | 'figure', number>;

export interface Fixtures {
  trend: { title: string; yTitle: string; t: number[]; series: { name: string; values: (number | null)[] }[] };
  trendRows(): Record<string, unknown>[];
  datesRows(): Record<string, unknown>[];
  bars: { title: string; yTitle: string; name: string; categories: string[]; values: number[] };
  parts: { title: string; name: string; labels: string[]; values: number[] };
  dirtyRows(): Record<string, unknown>[];
  scale(n: number): { title: string; t: number[]; y: number[] };
  rng(seed: number): () => number;
}

/** Runs in the page: the Phase 1 fixtures, reproduced from research/harness/src/data.js. */
function installFixtures(): void {
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const DAY = 864e5;
  const START = Date.UTC(2026, 0, 1);
  const trend = (() => {
    const r = rng(7), n = 120;
    const t = Array.from({ length: n }, (_, i) => START + i * DAY);
    const mk = (base: number, growth: number, noise: number, season: number) => t.map((_, i) => Math.round(base + growth * i + season * Math.sin((i / 7) * 2 * Math.PI) + (r() - 0.5) * noise));
    const series: { name: string; values: (number | null)[] }[] = [
      { name: 'Direct', values: mk(31000, 120, 4000, 3000) },
      { name: 'Organic search', values: mk(18000, 60, 3000, 2500) },
      { name: 'Referral', values: mk(4200, -8, 1200, 400) },
    ];
    for (let i = 60; i < 67; i++) series[2]!.values[i] = null;
    return { title: 'Daily sessions by channel', yTitle: 'Sessions', t, series };
  })();
  const days = trend.t.map(t => new Date(t).toISOString().slice(0, 10));
  const dirty = { categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], values: [10, 20, null, NaN, '40', undefined, 70] };
  const fx = {
    rng,
    trend,
    trendRows: () => trend.series.flatMap(s => s.values.map((v, i) => ({ day: trend.t[i], channel: s.name, sessions: v }))),
    datesRows: () => trend.series.flatMap(s => s.values.map((v, i) => ({ day: days[i], channel: s.name, sessions: v }))),
    bars: {
      title: 'Customer satisfaction by team', yTitle: 'Satisfied (%)', name: 'Satisfied (%)',
      categories: ['Billing', 'Customer Success & Onboarding', 'Platform', 'Mobile', 'Data', 'Security', 'Sales Eng.'],
      values: [94, 88, 97, 82, 91, 85, 90],
    },
    parts: {
      title: 'Sessions by browser', name: 'Share (%)',
      labels: ['Chrome', 'Safari', 'Edge', 'Firefox', 'Samsung Internet', 'Other'],
      values: [46.2, 27.5, 14.1, 8.9, 2.1, 1.2],
    },
    dirtyRows: () => dirty.categories.map((day, i) => (dirty.values[i] === undefined ? { day } : { day, value: dirty.values[i] })),
    scale(n: number) {
      const r = rng(1), t = new Array<number>(n), y = new Array<number>(n);
      let v = 100;
      for (let i = 0; i < n; i++) { v += (r() - 0.5) * 2; t[i] = START + i * 60000; y[i] = Math.round(v * 100) / 100; }
      return { title: `${n.toLocaleString('en-US')} points`, t, y };
    },
  };
  (window as unknown as { fx: unknown }).fx = fx;
  (window as unknown as { charts: unknown[] }).charts = [];
  (window as unknown as { nextFrames: (n?: number) => Promise<void> }).nextFrames = (n = 1) => new Promise(resolve => {
    let left = n;
    const step = () => { if (--left <= 0) resolve(); else requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}

/** A directory holding another build's axylo.iife.js and axylo.css (see chartPage). */
const BUNDLE = process.env.AXYLO_BUNDLE ?? null;

/** Whether the running test file is one of the chart core's own browser suites (chart/, a11y/). */
function ownSuite(): boolean {
  const path = (expect.getState().testPath ?? '').replace(/\\/g, '/');
  return /\/test\/browser\/(?:chart|a11y)\//.test(path);
}

/** Suites that may run another build through AXYLO_BUNDLE without taking the renderer switch (render/). */
function bundleSuite(): boolean {
  const path = (expect.getState().testPath ?? '').replace(/\\/g, '/');
  return /\/test\/browser\/render\//.test(path);
}

export async function chartPage(options: BrowserContextOptions & { query?: string; css?: string; standaloneCss?: boolean } = {}): Promise<Page> {
  const { css, standaloneCss = true, ...rest } = options;
  const page = await openPage(rest);
  // AXYLO_BUNDLE=<dir> (this directory's suites only): the page runs the bundle built in <dir> instead of the
  // shared dist, so a test can be shown to fail on an older revision without touching what other suites load.
  if (BUNDLE && (ownSuite() || bundleSuite())) {
    await page.evaluate(() => {
      document.querySelector('link[rel="stylesheet"]')?.remove();
      delete (window as unknown as { Axylo?: unknown }).Axylo;
    });
    await page.addScriptTag({ path: `${BUNDLE}/axylo.iife.js` });
    await page.addStyleTag({ path: `${BUNDLE}/axylo.css` });
  }
  await page.evaluate(installFixtures);
  // The test page links dist/axylo.css; without it the library applies the same sheet through ensureStyles.
  if (!standaloneCss) await page.evaluate(() => document.querySelector('link[rel="stylesheet"]')?.remove());
  await page.addStyleTag({ content: `#before, #after { display: none; } ${css ?? ''}` });
  return page;
}

export async function closePage(page: Page): Promise<string[]> {
  const errors = (page as Page & { errors: string[] }).errors;
  await page.context().close();
  return errors;
}

export async function shot(page: Page, selector: string): Promise<{ img: Image; box: { x: number; y: number; width: number; height: number } }> {
  const box = (await page.locator(selector).boundingBox())!;
  const img = decodePng(await page.screenshot({ clip: box, animations: 'disabled', caret: 'hide' }));
  return { img, box };
}

export type RGB = readonly [number, number, number];

export function at(img: Image, x: number, y: number): RGB {
  const o = (Math.floor(y) * img.width + Math.floor(x)) * 4;
  return [img.data[o]!, img.data[o + 1]!, img.data[o + 2]!];
}

export const diff = (a: RGB, b: RGB): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

export function hex(color: string): RGB {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!m) throw new Error(`not a hex color: ${color}`);
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

/** Pixels of `img` within `tolerance` of `color`. */
export function count(img: Image, color: RGB, tolerance = 24, region?: { x0: number; y0: number; x1: number; y1: number }): number {
  const { x0 = 0, y0 = 0, x1 = img.width, y1 = img.height } = region ?? {};
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (diff(at(img, x, y), color) <= tolerance) n++;
  return n;
}

/** Columns of `img` (within the rows given) that contain `color`. */
export function columnsWith(img: Image, color: RGB, y0: number, y1: number, tolerance = 24): boolean[] {
  const out: boolean[] = [];
  for (let x = 0; x < img.width; x++) {
    let hit = false;
    for (let y = y0; y < y1 && !hit; y++) if (diff(at(img, x, y), color) <= tolerance) hit = true;
    out.push(hit);
  }
  return out;
}

/** The accessibility tree of the chart target as Playwright's ARIA snapshot (YAML text). */
export const aria = (page: Page, selector = '#chart'): Promise<string> => page.locator(selector).ariaSnapshot();
