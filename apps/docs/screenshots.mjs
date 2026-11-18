// Screenshots of the built site in system Chrome, for review. Build the site first (node apps/docs/build.mjs).
// Usage:
//   node apps/docs/screenshots.mjs                      the four review shots, into apps/docs/screenshots/
//   node apps/docs/screenshots.mjs <page> [<page> …]    each page at phone and desktop widths in both
//                                                       schemes, into apps/docs/.scratch/shots/
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { serve } from './lib/serve.mjs';
import { docsRoot } from './lib/examples.mjs';

const REVIEW = [
  { page: 'getting-started', width: 1280, scheme: 'light', file: 'getting-started-desktop-light.png' },
  { page: 'line', width: 390, scheme: 'dark', file: 'line-phone-dark.png' },
  { page: 'diagnostics', width: 1280, scheme: 'dark', file: 'diagnostics-desktop-dark.png' },
  { page: 'theming', width: 390, scheme: 'light', file: 'theming-phone-light.png' },
];

const asked = process.argv.slice(2);
const shots = asked.length
  ? asked.flatMap(page => [390, 1280].flatMap(width => ['light', 'dark'].map(scheme =>
      ({ page, width, scheme, file: `${page}-${width}-${scheme}.png` }))))
  : REVIEW;
const outDir = path.join(docsRoot, asked.length ? '.scratch/shots' : 'screenshots');
fs.mkdirSync(outDir, { recursive: true });

const server = await serve();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const shot of shots) {
    const context = await browser.newContext({
      viewport: { width: shot.width, height: shot.width < 600 ? 844 : 900 }, colorScheme: shot.scheme,
      deviceScaleFactor: shot.width < 600 ? 2 : 1, locale: 'en-US', timezoneId: 'Europe/Berlin',
    });
    const page = await context.newPage();
    await page.goto(server.url(`apps/docs/dist/${shot.page}.html`), { waitUntil: 'load' });
    // Lazy frames load as they come into view: scroll through once, then wait for every frame to settle.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += innerHeight / 2) { scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); }
      scrollTo(0, 0);
    });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(outDir, shot.file), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log(`${shot.file}${overflow > 0 ? `  (page scrolls sideways by ${overflow}px)` : ''}`);
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
