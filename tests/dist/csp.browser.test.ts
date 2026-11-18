/**
 * Spec DX8, the browser half: the packed files under a strict Content Security Policy sent as a real
 * response header, with no 'unsafe-inline' and no 'unsafe-eval' for scripts or styles (browser.ts, cspPolicy):
 *
 *   default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; report-uri /csp-report/<page>
 *
 * `script-src 'self'` is all that both the script-tag files and a bundled module need; `style-src 'self'`
 * admits the linked axylo.css and the page's own stylesheet. Every page draws all five chart types and the
 * compact variant, opens a tooltip and each table, and must produce no `securitypolicyviolation` event, no
 * report and no console error. Each page reports to a URL of its own, and the last test checks every page's
 * reports again after the others ran, so a late report is still caught and attributed. Both ways of getting
 * the stylesheet are run, the library applying it at run time and the page linking axylo.css, and each must
 * take effect: rules of the stylesheet show in computed styles, and the series colour it declares is what is
 * painted (so an adopted but empty sheet fails). A target matching nothing throws naming the selector.
 * Text insertion is tested per source and per surface in text.browser.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { bundle, closeBrowser, cspPolicy, drawn, figureName, launch, open, startServer, type Server } from './browser';
import { countNear, decodePng, hexRgb } from './png';
import { fixture, here } from './paths';

const IMG = '<img src=x onerror="window.__xss=(window.__xss||0)+1">';
const SCRIPT = '<script>window.__xss=(window.__xss||0)+1</script>';
const CHARTS = ['line', 'area', 'bar', 'scatter', 'donut', 'compact'] as const;
const TITLES: Record<(typeof CHARTS)[number], string> = {
  line: `Sessions ${IMG}`, area: `Stacked ${SCRIPT}`, bar: `Revenue ${IMG}`, scatter: `Latency ${SCRIPT}`, donut: `Browsers ${IMG}`, compact: `Compact ${IMG}`,
};

let server: Server;
const scripts: Record<string, string> = {};
const pages = path.join(here, 'pages');

beforeAll(async () => {
  server = await startServer();
  await launch();
  scripts.classic = (await bundle({ name: 'csp-charts-classic', cwd: pages, contents: `import { makeCharts, type Library } from './charts';\nmakeCharts((window as unknown as { Axylo: Library }).Axylo);` })).url;
  for (const condition of ['production', 'development']) {
    scripts[`module-${condition}`] = (await bundle({
      name: `csp-charts-module-${condition}`, cwd: fixture('npm'), format: 'esm', conditions: [condition], allow: [pages],
      contents: `import * as A from 'axylo';\nimport { makeCharts } from ${JSON.stringify(path.join(pages, 'charts'))};\nmakeCharts(A);`,
    })).url;
  }
});
afterAll(async () => { await closeBrowser(); await server?.close(); });

/** The light-scheme default for the first series, as the packed stylesheet declares it (`.axylo { … }`). */
const declaredSeries1 = (): string => {
  const css = fs.readFileSync(fixture('npm', 'node_modules/axylo/dist/axylo.css'), 'utf8');
  const light = /\.axylo\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  const hex = /--axylo-default-series-1:\s*(#[0-9a-fA-F]{6})/.exec(light)?.[1];
  if (!hex) throw new Error('axylo.css declares no light --axylo-default-series-1');
  return hex;
};
const PAGES: string[] = [];

const LOADERS = {
  'script tag, production (axylo.iife.min.js)': () => `<script src="/script/node_modules/axylo/dist/axylo.iife.min.js"></script><script src="${scripts.classic}"></script>`,
  'script tag, development (axylo.iife.js)': () => `<script src="/script/node_modules/axylo/dist/axylo.iife.js"></script><script src="${scripts.classic}"></script>`,
  'bundled module, production condition': () => `<script type="module" src="${scripts['module-production']}"></script>`,
  'bundled module, development condition': () => `<script type="module" src="${scripts['module-development']}"></script>`,
};

function html(loader: string, linked: boolean): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Axylo under a strict policy</title>
<link rel="stylesheet" href="/pages/page.css">
${linked ? '<link rel="stylesheet" href="/npm/node_modules/axylo/dist/axylo.css">' : ''}
<script src="/pages/observe.js"></script>
</head><body>
<h1>Charts under a strict policy</h1>
${CHARTS.map(id => `<div class="${id === 'compact' ? 'tile' : 'chart'}" id="${id}"></div>`).join('\n')}
${loader}
</body></html>`;
}

interface Seen {
  violations: unknown[];
  created: string[];
  xss: unknown;
  missing: string | null;
  diagnostics: { chart: number; code: string; level: string }[];
  adopted: number;
  styleElements: number;
  linkedActive: boolean;
}

let counter = 0;
describe.each(Object.entries(LOADERS))('%s', (_label, loader) => {
  describe.each([['applied at run time', false], ['linked by the page', true]] as const)('stylesheet %s', (_how, linked) => {
    it('draws every chart type, opens a tooltip and the tables, with no violation, no console error and no markup created', async () => {
      const id = `page-${++counter}`;
      const at = `/csp/${id}.html`;
      PAGES.push(id);
      server.pages.set(at, { html: html(loader(), linked), headers: { 'content-security-policy': cspPolicy(id) } });
      const w = await open(server);
      const response = await w.page.goto(`${server.origin}${at}`);
      expect(response?.headers()['content-security-policy']).toBe(cspPolicy(id));

      for (const id of CHARTS) {
        const state = await drawn(w.page, `#${id}`);
        expect(state.figures, `#${id} figures`).toBe(1);
        expect(state.marks, `#${id} marks`).toBeGreaterThan(0);
        expect(state.errorState, `#${id} error state`).toBe(false);
        // The title is the accessible name, character for character: inserted as text.
        expect(await figureName(w.page, `#${id}`), `#${id} name`).toContain(TITLES[id].slice(0, 20));
        // A compact chart has no visible heading (spec 3.7); its name is its text alternative.
        if (id !== 'compact') expect(await w.page.locator(`#${id} .axylo-title`).first().textContent()).toBe(TITLES[id]);
      }

      // Tooltips: the series or category name and the formatter output are shown as text. The pointer
      // sweeps the plot left to right until the tooltip shows the datum carrying the payload.
      for (const [id, expected] of [['line', IMG], ['bar', SCRIPT]] as const) {
        await w.page.locator(`#${id} .axylo-plot`).scrollIntoViewIfNeeded();
        const plot = (await w.page.locator(`#${id} .axylo-plot`).boundingBox())!;
        // Spec I1: content too wide for a floating tooltip goes to the fixed readout under the plot instead,
        // which these long payloads cause.
        const tip = w.page.locator(`#${id} .axylo-tooltip, #${id} .axylo-readout`).filter({ visible: true });
        let text = '';
        for (let f = 0.3; f < 0.99 && !text.includes(expected); f += 0.05) {
          await w.page.mouse.move(plot.x + plot.width * f, plot.y + plot.height * 0.5);
          await w.page.waitForTimeout(50);
          if (await tip.count() === 1) text = (await tip.textContent()) ?? '';
        }
        expect(text, `#${id} tooltip`).toContain(expected);
        expect(text, `#${id} tooltip formatter output`).toContain('<img src=x onerror=');
        await w.page.mouse.move(2, 2);
      }

      // Tables.
      for (const id of ['line', 'area', 'bar', 'scatter', 'donut'] as const) {
        await w.page.locator(`#${id} [role="toolbar"] button`, { hasText: 'View as table' }).click();
        const table = w.page.locator(`#${id} table`);
        await expect.poll(() => table.count(), { timeout: 5000 }).toBeGreaterThan(0);
        expect(await table.first().locator('tr').count(), `#${id} table rows`).toBeGreaterThan(1);
        const text = (await table.first().textContent()) ?? '';
        if (id !== 'area') expect(text, `#${id} table text`).toMatch(/<img src=x onerror=|<script>/);
      }

      // The stylesheet took effect: its rules are in the computed styles, its series colour is the one painted.
      const hex = declaredSeries1();
      const style = await w.page.evaluate(() => {
        const figure = document.querySelector('#line figure')!;
        // The renderer paints through `color` on the shape or its group (render/svg.ts).
        const painted = (el: Element | null): string => { for (let e = el; e && !e.classList.contains('axylo-scene'); e = e.parentElement) { const c = (e as SVGElement).style?.getPropertyValue('color') ?? ''; if (c) return c; } return ''; };
        const mark = Array.from(document.querySelectorAll<SVGElement>('#line .axylo-scene path')).find(p => /--axylo-series(-color)?-1\b/.test(painted(p)));
        return {
          display: getComputedStyle(figure).display, titleWeight: getComputedStyle(document.querySelector('#line .axylo-title')!).fontWeight,
          series1: getComputedStyle(figure).getPropertyValue('--axylo-default-series-1').trim(), mark: mark ? getComputedStyle(mark).color : null,
        };
      });
      expect(style.display, '.axylo-figure { display: flex }').toBe('flex');
      expect(style.titleWeight, '.axylo-title { font-weight: 600 }').toBe('600');
      expect(style.series1.toLowerCase()).toBe(hex.toLowerCase());
      const [r, g, b] = hexRgb(hex);
      expect(style.mark).toBe(`rgb(${r}, ${g}, ${b})`);
      await w.page.locator('#line .axylo-plot').scrollIntoViewIfNeeded();
      await w.page.mouse.move(2, 2);
      const painted = countNear(decodePng(await w.page.locator('#line .axylo-plot').screenshot({ animations: 'allow' })), [r, g, b]);
      console.info(`#line pixels painted in ${hex}: ${painted}`);
      expect(painted, `pixels of the first series in ${hex}`).toBeGreaterThan(50);

      await w.page.waitForTimeout(300); // reports are sent asynchronously; the last test looks again
      const seen: Seen = await w.page.evaluate(() => {
        const g = window as unknown as Record<string, unknown>;
        const charts = (g.__charts as { diagnostics: { code: string; level: string }[] }[] | undefined) ?? [];
        const link = Array.from(document.styleSheets).find(s => s.href?.endsWith('/axylo.css'));
        return {
          violations: g.__violations as unknown[], created: g.__created as string[], xss: g.__xss ?? null, missing: g.__missing as string | null,
          diagnostics: charts.flatMap((c, chart) => c.diagnostics.map(d => ({ chart, code: d.code, level: d.level }))),
          adopted: document.adoptedStyleSheets.length, styleElements: document.querySelectorAll('style').length,
          linkedActive: !!link && !link.disabled,
        };
      });
      const errors = [...w.errors, ...w.console.filter(m => m.type === 'error').map(m => m.text)];
      const warnings = w.console.filter(m => m.type === 'warning').map(m => m.text);
      if (warnings.length) console.info(`console warnings: ${JSON.stringify(warnings)}`);
      console.info(`stylesheets: adopted ${seen.adopted}, <style> ${seen.styleElements}, linked axylo.css active ${seen.linkedActive}`);

      expect(seen.violations, 'securitypolicyviolation events').toEqual([]);
      expect(server.reports.get(id) ?? [], 'reports sent to this page\'s report URI').toEqual([]);
      expect(errors, 'console errors and page errors').toEqual([]);
      expect(seen.created, 'elements created from markup in text').toEqual([]);
      expect(seen.xss, 'payload ran').toBeNull();
      expect(seen.diagnostics.filter(d => d.level === 'error')).toEqual([]);
      expect(seen.missing, 'error for a selector that matches nothing').toContain('#no-such-chart');
      expect(seen.styleElements, 'the library creates no <style> element').toBe(0);
      if (linked) {
        expect(seen.linkedActive).toBe(true);
        expect(seen.adopted, 'nothing adopted when the page links axylo.css').toBe(0);
      } else {
        expect(seen.adopted, 'the stylesheet adopted at run time').toBe(1);
      }
      // The computed rules came from that sheet: without it they are gone.
      const without = await w.page.evaluate(linkedPage => {
        if (linkedPage) Array.from(document.styleSheets).find(x => x.href?.endsWith('/axylo.css'))!.disabled = true;
        else document.adoptedStyleSheets = [];
        return getComputedStyle(document.querySelector('#line figure')!).display;
      }, linked);
      expect(without).not.toBe('flex');
      expect(w.external).toEqual([]);
      await w.context.close();
    });
  });
});

describe('the instruments themselves', () => {
  it('catch text inserted as HTML: the observer records the element, and each report names its directive and page', async () => {
    const id = 'negative-control';
    const at = `/csp/${id}.html`;
    server.pages.set(at, {
      html: '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>control</title><script src="/pages/observe.js"></script></head><body><script src="/pages/inject.js"></script></body></html>',
      headers: { 'content-security-policy': cspPolicy(id) },
    });
    const w = await open(server);
    await w.page.goto(`${server.origin}${at}`);
    await expect.poll(() => (server.reports.get(id) ?? []).length, { timeout: 5000 }).toBe(2);
    const seen = await w.page.evaluate(() => {
      const g = window as unknown as Record<string, unknown>;
      return { created: g.__created as string[], violations: (g.__violations as { effective: string }[]).map(v => v.effective).sort(), xss: g.__xss ?? null };
    });
    const reports = (server.reports.get(id) as { 'csp-report': Record<string, string> }[]).map(r => r['csp-report']);
    expect(reports.map(r => r['effective-directive'] ?? r['violated-directive']).sort()).toEqual(['script-src-attr', 'style-src-attr']);
    for (const r of reports) expect(r['document-uri']).toBe(`${server.origin}${at}`);
    expect(seen.violations).toEqual(['script-src-attr', 'style-src-attr']);
    expect(seen.created.some(e => e.startsWith('<img'))).toBe(true);
    expect(seen.xss).toBeNull();
    await w.context.close();
  });

  it('no page has received a report since its test ended', async () => {
    await new Promise(r => setTimeout(r, 1000));
    expect(PAGES.length).toBe(8);
    expect(Object.fromEntries(PAGES.map(p => [p, server.reports.get(p) ?? []]))).toEqual(Object.fromEntries(PAGES.map(p => [p, []])));
    expect([...server.reports.keys()].filter(k => !PAGES.includes(k) && k !== 'negative-control')).toEqual([]);
  });
});
