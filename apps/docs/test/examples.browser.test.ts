/**
 * Criterion DX10: every runnable example in the documentation is compiled and rendered from the packed
 * distribution. Run after `npm run build`:
 *
 *   AXYLO_BROWSER=1 npx vitest run --config apps/docs/vitest.config.ts apps/docs/test/examples.browser.test.ts
 *
 * 1. The site build packs both packages with `npm pack` and installs the tarballs into a clean consumer
 *    (apps/docs/lib/consumer.mjs, as tests/dist does), copies the examples into it, and bundles them from
 *    there with esbuild under the `development` condition; nothing may resolve outside the consumer.
 * 2. This test type-checks every example in the consumer, strictly, against the installed declarations with
 *    library checking on, and fails if TypeScript read any declaration from outside the consumer.
 * 3. It opens each example's page in system Chrome and checks: the expected number of charts; every chart has
 *    an accessible name, and draws marks unless the example says it draws none on purpose (then it must show
 *    a state message and no marks); no console error, warning or page error, and no failed request; the
 *    diagnostics printed are exactly the ones the example says it raises on purpose; and the example's own
 *    check (test/example-checks.ts): a value from its data, and the interaction it teaches.
 *
 * Examples run in America/Los_Angeles, where an instant at UTC midnight is the previous evening, at 760 px.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { buildSite } from '../lib/site.mjs';
import { docsRoot, listExamples, repoRoot } from '../lib/examples.mjs';
import { consumerDir, listFilesOutside, writeConsumerTsconfigs } from '../lib/consumer.mjs';
import { serve } from '../lib/serve.mjs';
import { checks, type Tools } from './example-checks';

const examples = listExamples();
let server: Awaited<ReturnType<typeof serve>>;
let browser: Browser;

/** Runs tsc in the consumer; returns its errors and the files it read from outside the consumer. */
function typecheck(config: string, allowed: string[] = []): { errors: string; outside: string[] } {
  // Through node itself, so the same call works on Windows, where node_modules/.bin/tsc is a shell script.
  const tsc = path.join(repoRoot, 'node_modules/typescript/bin/tsc');
  try {
    const listing = execFileSync(process.execPath, [tsc, '-p', config, '--listFiles'], { cwd: consumerDir, encoding: 'utf8', stdio: 'pipe' });
    return { errors: '', outside: listFilesOutside(listing, allowed) };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    const out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    return { errors: out.split('\n').filter(l => /error TS/.test(l)).join('\n') || out || String(error), outside: [] };
  }
}

beforeAll(async () => {
  await buildSite();
  server = await serve(path.join(docsRoot, 'dist'));
  browser = await chromium.launch({ channel: 'chrome', headless: true });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

describe('examples type-check in the packed consumer', () => {
  it('browser examples: .ts and .tsx strict, .html scripts strict under checkJs, library checking on', () => {
    const { browser: config } = writeConsumerTsconfigs();
    const result = typecheck(config);
    expect(result.errors).toBe('');
    expect(result.outside, 'declarations read from outside the consumer').toEqual([]);
  });
  it('Node examples (DOM types in lib, as the Diagnostics page says)', () => {
    const { node: config } = writeConsumerTsconfigs();
    // The test example imports Vitest, a tool the consumer does not install.
    const result = typecheck(config, ['vitest', '@vitest', 'chai', '@types/chai', '@types/deep-eql', 'expect-type', 'tinyrainbow', '@standard-schema', 'vite', 'tinybench', 'tinyexec', 'pathe', '@types/estree', 'rollup', 'esbuild', 'postcss', 'source-map-js', 'nanoid', 'picocolors', 'lightningcss', 'rolldown', '@rolldown', '@oxc-project', 'obug', 'std-env', 'magic-string', '@jridgewell', 'estree-walker', 'fdir', 'picomatch', 'tinyglobby', 'es-module-lexer', 'why-is-node-running', 'detect-libc', 'assertion-error', '@types/node', 'undici-types']);
    expect(result.errors).toBe('');
    expect(result.outside.filter(f => /[\\/]node_modules[\\/](axylo|@axylo)[\\/]/.test(f) || /packages[\\/](axylo|react)[\\/]/.test(f))).toEqual([]);
  });
});

function tools(page: Page): Tools {
  const figure = (i: number) => page.locator('figure.axylo-figure').nth(i);
  return {
    page,
    async value(i, keys) {
      await figure(i).locator('.axylo-proxy').focus();
      for (const key of keys) await page.keyboard.press(key);
      await page.waitForTimeout(80);
      return (await figure(i).locator('.axylo-proxy').getAttribute('aria-valuetext')) ?? '';
    },
    desc: i => figure(i).evaluate(f => (f.getAttribute('aria-describedby') ?? '').split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ')),
    name: i => figure(i).evaluate(f => f.getAttribute('aria-label') ?? (f.getAttribute('aria-labelledby') ?? '').split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ').trim()),
    note: i => figure(i).evaluate(f => [...f.querySelectorAll('.axylo-note')].filter(e => !(e as HTMLElement).hidden).map(e => e.textContent).join('')),
    message: i => figure(i).evaluate(f => [...f.querySelectorAll('.axylo-message')].filter(e => !(e as HTMLElement).hidden).map(e => e.textContent).join('')),
    legend: i => figure(i).evaluate(f => [...f.querySelectorAll('.axylo-legend-list li')].map(e => e.textContent ?? '')),
    toolbar: i => figure(i).evaluate(f => [...f.querySelectorAll('.axylo-toolbar button')].map(e => e.textContent ?? '')),
    async table(i) {
      const open = figure(i).locator('.axylo-toolbar button', { hasText: /table|Tabelle/i }).first();
      if ((await open.getAttribute('aria-expanded')) !== 'true') await open.click();
      await page.waitForTimeout(100);
      return figure(i).evaluate(f => [...f.querySelectorAll('.axylo-table tbody tr')].map(r => [...r.children].map(c => c.textContent).join(' | ')));
    },
    text: selector => page.locator(selector).first().evaluate(e => e.textContent ?? ''),
    async click(selector) { await page.locator(selector).first().click(); },
    stroke: (i, k) => figure(i).evaluate((f, k) => {
      const paths = [...f.querySelectorAll('svg.axylo-svg path[style*="--axylo-series-color"]')].filter(p => getComputedStyle(p).fill === 'none');
      return paths[k] ? getComputedStyle(paths[k]!).stroke : '';
    }, k),
    async until(fn, timeout = 8000) { await page.waitForFunction(fn, null, { timeout }); },
  };
}

describe('examples render in Chrome from the packed packages', () => {
  it('every example has its own check, and every check an example', () => {
    expect(examples.map(e => e.name).filter(name => !(name in checks))).toEqual([]);
    expect(Object.keys(checks).filter(name => !examples.some(e => e.name === name))).toEqual([]);
  });

  it.each(examples.map(example => [example.repoFile, example] as const))('%s', async (_file, example) => {
    const context = await browser.newContext({ viewport: { width: 760, height: 900 }, locale: 'en-US', timezoneId: 'America/Los_Angeles' });
    const page = await context.newPage();
    const problems: string[] = [];
    const codes = new Set<string>();
    page.on('pageerror', error => problems.push(`page error: ${error.message}`));
    page.on('console', message => {
      const text = message.text();
      for (const m of text.matchAll(/^\[axylo (AX\d{3})\]/g)) codes.add(m[1]!);
      if (message.type() === 'error') problems.push(`console.error: ${text}`);
      if (message.type() === 'warning' && !text.startsWith('[axylo ')) problems.push(`console.warn: ${text}`);
    });
    page.on('requestfailed', request => problems.push(`request failed: ${request.url()}`));
    page.on('response', response => { if (response.status() >= 400) problems.push(`HTTP ${response.status()}: ${response.url()}`); });
    await page.goto(server.url(`examples/${example.name}.html`));

    const check = checks[example.name]!;
    // Ready when the expected charts exist and each has drawn marks or shows a state message.
    await page.waitForFunction(count => {
      const figures = [...document.querySelectorAll('figure.axylo-figure')];
      return figures.length === count && figures.every(f =>
        f.querySelector('svg [style*="--axylo-series-color"]') !== null ||
        [...f.querySelectorAll('.axylo-message')].some(m => !(m as HTMLElement).hidden && m.textContent));
    }, check.charts, { timeout: 15_000 });
    await page.evaluate(() => new Promise(resolve => { let n = 0; const tick = () => (++n < 3 ? requestAnimationFrame(tick) : resolve(null)); requestAnimationFrame(tick); }));

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

    expect(charts.length, `${example.repoFile}: charts`).toBe(check.charts);
    for (const chart of charts) {
      expect(['group', 'img'], `${example.repoFile}: role`).toContain(chart.role);
      expect(chart.name, `${example.repoFile}: accessible name`).not.toBe('');
      if (example.noMarks) {
        expect(chart.message, `${example.repoFile}: a state message`).not.toBe('');
        expect(chart.marks, `${example.repoFile}: no marks`).toBe(0);
      } else {
        expect(chart.marks, `${example.repoFile}: "${chart.name}" draws marks (message: "${chart.message}")`).toBeGreaterThan(0);
      }
    }
    await check.run(tools(page));
    expect(problems, `${example.repoFile}: errors`).toEqual([]);
    expect([...codes].sort(), `${example.repoFile}: diagnostics printed`).toEqual([...example.raises].sort());
    await context.close();
  }, 60_000);
});
