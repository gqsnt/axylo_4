/**
 * Criterion DX4, on the built site, and each code page's minimal input, run.
 *
 * - There is one page per code of the registry and no page for a code that does not exist, and the
 *   diagnostics page links every code page.
 * - Every minimal input in apps/docs/data/diagnostics.mjs is run as a chart with the packed script-tag file
 *   (an input written for `validate()` becomes the same call to the chart function), once as written and once
 *   with `strict: true`. The documented outcome beside it must hold: the code is reported, with
 *   `outcome.field` and `outcome.rows`; a strict chart throws it exactly when `outcome.strict` says so; and the
 *   figure shows what `outcome.reader` says (a note, a message in place of the plot, the summary in place of
 *   the plot, or nothing).
 *
 *   npm run build && AXYLO_BROWSER=1 npx vitest run --config apps/docs/vitest.config.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { buildSite } from '../lib/site.mjs';
import { docsRoot } from '../lib/examples.mjs';
import { serve } from '../lib/serve.mjs';
import { diagnosticRegistry } from '../../../packages/axylo/src/diagnostics/registry';
import { diagnostics } from '../data/diagnostics.mjs';

let server: Awaited<ReturnType<typeof serve>>;
let browser: Browser;
const dist = path.join(docsRoot, 'dist');

beforeAll(async () => {
  await buildSite();
  server = await serve(dist);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

describe('one page per diagnostic code', () => {
  it('every code in the registry has a built page', () => {
    const missing = Object.keys(diagnosticRegistry).filter(code => !fs.existsSync(path.join(dist, 'diagnostics', `${code}.html`)));
    expect(missing).toEqual([]);
  });
  it('every built page is for a code in the registry', () => {
    const pages = fs.readdirSync(path.join(dist, 'diagnostics')).map(f => f.replace(/\.html$/, ''));
    expect(pages.filter(code => !(code in diagnosticRegistry))).toEqual([]);
  });
  it('the diagnostics page links every code page', () => {
    const html = fs.readFileSync(path.join(dist, 'diagnostics.html'), 'utf8');
    expect(Object.keys(diagnosticRegistry).filter(code => !html.includes(`href="diagnostics/${code}.html"`))).toEqual([]);
  });
});

interface Found { code: string; field: string | null; rows: readonly number[] | null }
interface Run { thrown: string[] | null; printed: string[]; list: Found[]; note: string; message: string; brief: boolean }

/** Runs a minimal input in a page; `thrown` lists the codes of a strict rejection, null when nothing threw. */
async function run(input: string, strict: boolean): Promise<Run> {
  const context = await browser.newContext({ viewport: { width: 760, height: 700 }, locale: 'en-US', timezoneId: 'UTC' });
  const page = await context.newPage();
  const printed: string[] = [];
  page.on('console', m => { for (const x of m.text().matchAll(/^\[axylo (AX\d{3})\]/g)) printed.push(x[1]!); });
  await page.goto(server.url('examples/script-tag.html'));
  const result = await page.evaluate(({ source, strict }) => {
    document.body.replaceChildren();
    const target = document.createElement('div');
    document.body.append(target);
    type Chart = { diagnostics: readonly { code: string; field?: string; rows?: readonly number[] }[] };
    const lib = (window as unknown as { Axylo: Record<string, (t: Element, o: object) => Chart> }).Axylo;
    let chart: Chart | null = null;
    const wrap = (name: string) => (t: Element, o: object) => (chart = lib[name]!(t, strict ? { ...o, strict: true } : o));
    let thrown: string[] | null = null;
    try {
      new Function('target', 'line', 'area', 'bar', 'scatter', 'donut', source)(target, wrap('line'), wrap('area'), wrap('bar'), wrap('scatter'), wrap('donut'));
    } catch (error) {
      thrown = ((error as { diagnostics?: readonly { code: string }[] }).diagnostics ?? []).map(d => d.code);
    }
    return new Promise<Omit<Run, 'printed'>>(resolve => setTimeout(() => {
      const f = target.querySelector('figure');
      const shown = (sel: string) => f ? [...f.querySelectorAll(sel)].filter(e => !(e as HTMLElement).hidden && !e.closest('[hidden]')).map(e => e.textContent ?? '').join('') : '';
      resolve({
        thrown,
        list: (chart?.diagnostics ?? []).map(d => ({ code: d.code, field: d.field ?? null, rows: d.rows ?? null })),
        // The short summary shown in place of a plot too small to draw (spec L8).
        note: shown('.axylo-note'), message: shown('.axylo-message'), brief: shown('.axylo-summary') !== '',
      });
    }, 500));
  }, { source: input, strict });
  await context.close();
  return { ...result, printed };
}

const asChart = (d: (typeof diagnostics)[number]) =>
  d.run === 'node' ? d.input.replace(/^validate\('(\w+)', /, (_: string, type: string) => `${type}(target, `) + ';' : d.input;

describe('each minimal input does what its page says', () => {
  it.each(diagnostics.map(d => [d.code, d] as const))('%s', async (code, d) => {
    const normal = await run(asChart(d), false);
    const mine = normal.list.filter(x => x.code === code);
    expect(normal.printed, `${code} is printed`).toContain(code);
    expect(mine.length, `${code} is in chart.diagnostics`).toBeGreaterThan(0);
    expect(mine.map(x => x.field), 'field').toContain(d.outcome.field);
    if (d.outcome.rows) expect(mine.map(x => x.rows), 'rows').toContainEqual(d.outcome.rows);
    const reader = d.outcome.reader;
    if (reader === 'nothing') {
      expect({ note: normal.note, message: normal.message }).toEqual({ note: '', message: '' });
    } else if (reader === 'fallback') {
      expect({ brief: normal.brief, message: normal.message }).toEqual({ brief: true, message: '' });
    } else if (reader.startsWith('note: ')) {
      expect(normal.note).toBe(reader.slice(6));
    } else {
      expect(normal.message).toBe(reader.slice(9));
    }
    const strict = await run(asChart(d), true);
    const thrown = strict.thrown?.includes(code) ?? false;
    expect(thrown, `a strict chart ${d.outcome.strict ? 'throws' : 'does not throw'} ${code} (thrown: ${strict.thrown})`).toBe(d.outcome.strict);
  }, 60_000);
});
