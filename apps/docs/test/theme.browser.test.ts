/**
 * The theming page's table of defaults, painted: in a light page and a dark page, a chart drawn by the packed
 * script-tag file paints its axis, gridlines, reference line, first two series, subtitle and focus ring in the
 * colour the table gives for that scheme (the documented private default of each property, read from the
 * packed stylesheet).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { buildSite } from '../lib/site.mjs';
import { readThemeDefaults } from '../lib/theme.mjs';
import { docsRoot } from '../lib/examples.mjs';
import { installed } from '../lib/consumer.mjs';
import { serve } from '../lib/serve.mjs';
import { tokens } from '../data/tokens.mjs';

let server: Awaited<ReturnType<typeof serve>>;
let browser: Browser;
let theme: ReturnType<typeof readThemeDefaults>;

beforeAll(async () => {
  await buildSite();
  theme = readThemeDefaults(fs.readFileSync(path.join(installed('axylo'), 'dist/axylo.css'), 'utf8'));
  server = await serve(path.join(docsRoot, 'dist'));
  browser = await chromium.launch({ channel: 'chrome', headless: true });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

const rgb = (hex: string) => {
  const h = hex.length === 4 ? hex.slice(1).split('').map(c => c + c).join('') : hex.slice(1, 7);
  return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`;
};
const documentedDefault = (name: string) => tokens.find(t => t.name === name)?.default;

describe('documented defaults are the painted colours', () => {
  it.each(['light', 'dark'] as const)('%s', async scheme => {
    const context = await browser.newContext({ viewport: { width: 760, height: 700 }, colorScheme: scheme });
    const page = await context.newPage();
    await page.goto(server.url('examples/script-tag.html'));
    await page.evaluate(() => {
      document.body.replaceChildren();
      const target = document.createElement('div');
      document.body.append(target);
      const rows = [1, 2, 3, 4].map(i => ({ day: `2026-03-0${i}`, a: i, b: 5 - i }));
      (window as unknown as { Axylo: { line(t: Element, o: object): unknown } }).Axylo.line(target, {
        title: 'T', subtitle: 'S', data: rows, x: 'day', y: ['a', 'b'], reference: [{ y: 3, label: 'R' }],
      });
    });
    await page.waitForSelector('svg.axylo-svg path');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(150);
    const painted = await page.evaluate(() => {
      const stroke = (sel: string) => { const e = document.querySelector(sel); return e ? getComputedStyle(e).stroke : 'missing'; };
      const series = (k: number) => {
        const p = [...document.querySelectorAll(`svg.axylo-svg path[style*="--axylo-series-color-${k}"]`)].find(e => getComputedStyle(e).fill === 'none');
        return p ? getComputedStyle(p).stroke : 'missing';
      };
      return {
        '--axylo-axis': stroke('svg.axylo-svg line[style*="--axylo-axis"]'),
        '--axylo-grid': stroke('svg.axylo-svg line[style*="--axylo-grid"]'),
        '--axylo-reference': stroke('svg.axylo-svg [style*="--axylo-reference"]'),
        '--axylo-series-1': series(1),
        '--axylo-series-2': series(2),
        '--axylo-muted': getComputedStyle(document.querySelector('.axylo-subtitle')!).color,
        '--axylo-focus': getComputedStyle(document.querySelector('.axylo-focus-ring')!).outlineColor,
      };
    });
    const expected = Object.fromEntries(Object.keys(painted).map(name => [name, rgb(theme[scheme][documentedDefault(name)!]!)]));
    expect(painted).toEqual(expected);
    await context.close();
  }, 60_000);
});
