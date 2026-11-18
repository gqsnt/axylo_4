/**
 * Criterion DX4, on the built site, and each code page's minimal input, run.
 *
 * - There is one page per code of the registry and no page for a code that does not exist, and the
 *   diagnostics page links every code page.
 * - Every input in apps/docs/data/diagnostics.mjs (each code's minimal input and its further cases) is run as
 *   a chart with the packed script-tag file (an input written for `validate()` becomes the same call to the
 *   chart function), once as written and once with `strict: true`. The documented outcome beside it must
 *   hold: the code is reported, with `outcome.field` and `outcome.rows`, in `chart.diagnostics` or, where
 *   `outcome.listed` is false, only to `onDiagnostic`; a strict chart throws it exactly when `outcome.strict`
 *   says so; and the figure shows what `outcome.reader` says (a note, a message in place of the plot, the
 *   summary in place of the plot, or nothing).
 * - For an input that needs a page, the line the code page shows (made by the build from the registry and
 *   the input's sample details) is exactly a line the library printed.
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
interface Run { thrown: string[] | null; printed: string[]; lines: string[]; list: Found[]; heard: Found[]; note: string; message: string; brief: boolean }

/** Runs a minimal input in a page; `thrown` lists the codes of a strict rejection, null when nothing threw. */
async function run(input: string, strict: boolean): Promise<Run> {
  const context = await browser.newContext({ viewport: { width: 760, height: 700 }, locale: 'en-US', timezoneId: 'UTC' });
  const page = await context.newPage();
  const printed: string[] = [];
  const lines: string[] = [];
  page.on('console', m => {
    for (const x of m.text().matchAll(/^\[axylo (AX\d{3})\]/g)) printed.push(x[1]!);
    if (/^\[axylo AX\d{3}\]/.test(m.text())) lines.push(m.text());
  });
  await page.goto(server.url('examples/script-tag.html'));
  const result = await page.evaluate(({ source, strict }) => {
    document.body.replaceChildren();
    const target = document.createElement('div');
    document.body.append(target);
    type Diagnostic = { code: string; field?: string; rows?: readonly number[] };
    type Chart = { diagnostics: readonly Diagnostic[] };
    const lib = (window as unknown as { Axylo: Record<string, (t: Element, o: object) => Chart> }).Axylo;
    let chart: Chart | null = null;
    const heard: Diagnostic[] = [];
    // Every diagnostic handed to onDiagnostic, the input's own listener (if any) still called.
    const listen = (o: { onDiagnostic?: (d: Diagnostic) => void }) => ({ ...o, onDiagnostic: (d: Diagnostic) => { heard.push(d); o.onDiagnostic?.(d); } });
    const wrap = (name: string) => (t: Element, o: object) => (chart = lib[name]!(t, listen(strict ? { ...o, strict: true } : o)));
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
        heard: heard.map(d => ({ code: d.code, field: d.field ?? null, rows: d.rows ?? null })),
        // The short summary shown in place of a plot too small to draw (spec L8).
        note: shown('.axylo-note'), message: shown('.axylo-message'), brief: shown('.axylo-summary') !== '',
      });
    }, 500));
  }, { source: input, strict });
  await context.close();
  return { ...result, printed, lines };
}

type Input = { run: string; input: string; outcome: { field: string | null; rows?: readonly number[]; listed?: boolean; strict: boolean; reader: string } };
const asChart = (d: Input) =>
  d.run === 'node' ? d.input.replace(/^validate\('(\w+)', /, (_: string, type: string) => `${type}(target, `) + ';' : d.input;

/** Each code's inputs: its minimal input (`output-0` on its page), then its cases (`output-1`, …). */
const inputs = diagnostics.flatMap(d => [d as Input, ...((d as { cases?: readonly Input[] }).cases ?? [])]
  .map((input, i) => [`${d.code}${i ? ` case ${i}` : ''}`, d.code, i, input] as const));

/** The text of the printed block `output-<i>` on a code's built page. */
function shownLines(code: string, i: number): string[] {
  const html = fs.readFileSync(path.join(dist, 'diagnostics', `${code}.html`), 'utf8');
  const block = new RegExp(`<div id="output-${i}"><pre[^>]*><code[^>]*>([\\s\\S]*?)</code></pre></div>`).exec(html);
  if (!block) throw new Error(`${code}.html has no output-${i}`);
  const text = block[1]!.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  return text.split('\n');
}

describe('each input does what its page says', () => {
  it.each(inputs)('%s', async (_, code, i, d) => {
    const normal = await run(asChart(d), false);
    const listed = normal.list.filter(x => x.code === code);
    expect(normal.printed, `${code} is printed`).toContain(code);
    if (d.outcome.listed === false) {
      expect(listed, `${code} is not in chart.diagnostics`).toEqual([]);
    } else {
      expect(listed.length, `${code} is in chart.diagnostics`).toBeGreaterThan(0);
    }
    const mine = d.outcome.listed === false ? normal.heard.filter(x => x.code === code) : listed;
    expect(mine.length, `${code} is reported`).toBeGreaterThan(0);
    expect(mine.map(x => x.field), 'field').toContain(d.outcome.field);
    if (d.outcome.rows) expect(mine.map(x => x.rows), 'rows').toContainEqual(d.outcome.rows);
    if (d.run === 'browser') {
      for (const line of shownLines(code, i)) expect(normal.lines, 'the page shows a line the library printed').toContain(line);
    }
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
