/**
 * Criterion DX10: every runnable example in the documentation is compiled and rendered from the built
 * library. Run after `npm run build`:
 *
 *   AXYLO_BROWSER=1 npx vitest run apps/docs/test/examples.browser.test.ts
 *
 * 1. Type-checks every example against the package's declarations (packages/axylo/dist/index.d.ts and
 *    packages/react/dist/index.d.ts, reached through the workspace packages `axylo` and `@axylo/react`).
 * 2. Builds the site, which compiles the examples with esbuild and copies the library's built files.
 * 3. Opens each example's page in system Chrome and checks: every chart has an accessible name; every
 *    chart draws marks unless the example says it draws none on purpose; no console errors or page errors;
 *    the diagnostics printed are exactly the ones the example says it raises on purpose.
 *
 * Examples run in America/Los_Angeles, where an instant at UTC midnight is the previous evening, so the
 * date examples are exercised where they matter, and at 760 px, about the width an example has on a
 * documentation page on a desktop screen.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { buildSite } from '../lib/site.mjs';
import { docsRoot, listExamples, repoRoot, writeTypecheckInputs } from '../lib/examples.mjs';
import { serve } from '../lib/serve.mjs';

interface Example { name: string; file: string; ext: string; raises: string[]; noMarks: boolean }

// Through node itself, so the same call works on Windows, where node_modules/.bin/tsc is a shell script.
const tsc = path.join(repoRoot, 'node_modules/typescript/bin/tsc');
// Read from the sources at collection time, so each example is its own test.
const examples: Example[] = listExamples();
let server: Awaited<ReturnType<typeof serve>>;
let browser: Browser;

function typecheck(config: string): string {
  try {
    execFileSync(process.execPath, [tsc, '-p', path.join(docsRoot, 'examples', config)], { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' });
    return '';
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    return `${e.stdout ?? ''}${e.stderr ?? ''}` || String(error);
  }
}

beforeAll(async () => {
  writeTypecheckInputs();
  await buildSite();
  server = await serve();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

describe('examples type-check against the package declarations', () => {
  it('TypeScript and React examples (strict)', () => {
    expect(typecheck('tsconfig.json')).toBe('');
  });
  it('scripts of the HTML examples (checkJs)', () => {
    expect(typecheck('tsconfig.html.json')).toBe('');
  });
});

describe('examples render in Chrome from the built library', () => {
  it('there are examples', () => {
    expect(examples.length).toBeGreaterThan(20);
  });

  it.each(examples.map(example => [example.file, example] as const))('%s', async (_file, example) => {
    const context = await browser.newContext({
      viewport: { width: 760, height: 900 }, locale: 'en-US', timezoneId: 'America/Los_Angeles',
    });
    const page = await context.newPage();
    const errors: string[] = [];
    const codes = new Set<string>();
    page.on('pageerror', error => errors.push(`page error: ${error.message}`));
    page.on('console', message => {
      const text = message.text();
      if (message.type() === 'error') errors.push(`console.error: ${text}`);
      for (const m of text.matchAll(/^\[axylo (AX\d{3})\]/g)) codes.add(m[1]!);
      if (message.type() === 'warning' && !text.startsWith('[axylo ')) errors.push(`console.warn: ${text}`);
    });
    page.on('requestfailed', request => errors.push(`request failed: ${request.url()}`));
    page.on('response', response => { if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`); });
    await page.goto(server.url(`apps/docs/dist/examples/${example.name}.html`));

    // Ready when every chart has drawn marks or shows a state message, and nothing changes for 3 frames.
    await page.waitForFunction(() => {
      const figures = [...document.querySelectorAll('figure.axylo-figure')];
      return figures.length > 0 && figures.every(f =>
        f.querySelector('svg [style*="--axylo-series-color"], canvas') !== null ||
        [...f.querySelectorAll('.axylo-message')].some(m => !(m as HTMLElement).hidden && m.textContent));
    }, null, { timeout: 15_000 });
    await page.evaluate(() => new Promise(resolve => {
      let n = 0;
      const tick = () => (++n < 3 ? requestAnimationFrame(tick) : resolve(null));
      requestAnimationFrame(tick);
    }));

    const charts = await page.evaluate(() => [...document.querySelectorAll('figure.axylo-figure')].map(f => {
      const labelled = f.getAttribute('aria-labelledby');
      const name = (f.getAttribute('aria-label') ?? '') ||
        (labelled ?? '').split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ').trim();
      const marks = [...f.querySelectorAll('svg [style*="--axylo-series-color"]')].filter(el => {
        const box = (el as SVGGraphicsElement).getBBox();
        return box.width > 0 || box.height > 0;
      }).length;
      const message = [...f.querySelectorAll('.axylo-message')].find(m => !(m as HTMLElement).hidden)?.textContent ?? '';
      return { role: f.getAttribute('role'), name, marks, message };
    }));

    expect(charts.length, `${example.file}: charts`).toBeGreaterThan(0);
    for (const chart of charts) {
      expect(['group', 'img'], `${example.file}: role`).toContain(chart.role);
      expect(chart.name, `${example.file}: accessible name`).not.toBe('');
      if (example.noMarks) expect(chart.message, `${example.file}: a state message`).not.toBe('');
      else expect(chart.marks, `${example.file}: "${chart.name}" draws marks (message: "${chart.message}")`).toBeGreaterThan(0);
    }
    expect(errors, `${example.file}: errors`).toEqual([]);
    expect([...codes].sort(), `${example.file}: diagnostics printed`).toEqual([...example.raises].sort());
    await context.close();
  }, 60_000);
});
