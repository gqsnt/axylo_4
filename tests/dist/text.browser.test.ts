/**
 * Spec DX8: labels and formatter output are inserted as text, never as HTML. Review finding 20: one distinct
 * sentinel per text source and chart type (pages/sentinels.ts), each destination triggered, and for each an
 * exact literal expectation, so one surface cannot vouch for another.
 *
 * Sources: title, subtitle, description (the summary), series name, category, x and y field labels, unit,
 * x and y value formatters, tick formatters, every built-in message that reaches the page, the reader note on
 * the dirty input, and author error text. Destinations: heading, accessible name and description, legend,
 * axis ticks and titles, tooltip or readout, table caption, headers and cells, and `aria-valuetext`.
 *
 * Each sentinel is `<u data-axs="id">body</u>`. Parsed, it would become a `u` element with `data-axs`: the
 * page's observer (pages/observe.js) records any such element and the test counts them. Read as text, it must
 * appear character for character; every `data-axs` the page shows must belong to a whole sentinel, so a
 * truncated, escaped or half-parsed one fails. The pages are served under the strict policy of
 * csp.browser.test.ts, from the packed script-tag file and from a bundled module.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { bundle, closeBrowser, cspPolicy, drawn, launch, open, startServer, type Server, type Watched } from './browser';
import { fixture, here } from './paths';
import { KINDS, MESSAGE_CHARTS, S, SOURCES, type Kind } from './pages/sentinels';

let server: Server;
const pages = path.join(here, 'pages');
const scripts: Record<string, string> = {};

beforeAll(async () => {
  server = await startServer();
  await launch();
  for (const [name, fn] of [['sentinel', 'makeSentinelCharts'], ['message', 'makeMessageCharts']] as const) {
    scripts[`${name}-classic`] = (await bundle({
      name: `text-${name}-classic`, cwd: pages, contents: `import { ${fn}, type Library } from './sentinels';\n${fn}((window as unknown as { Axylo: Library }).Axylo);`,
    })).url;
    scripts[`${name}-module`] = (await bundle({
      name: `text-${name}-module`, cwd: fixture('npm'), format: 'esm', conditions: ['development'], allow: [pages],
      contents: `import * as A from 'axylo';\nimport { ${fn} } from ${JSON.stringify(path.join(pages, 'sentinels'))};\n${fn}(A);`,
    })).url;
  }
});
afterAll(async () => { await closeBrowser(); await server?.close(); });

const LOADERS = {
  'script tag, production (axylo.iife.min.js)': (name: string) => `<script src="/script/node_modules/axylo/dist/axylo.iife.min.js"></script><script src="${scripts[`${name}-classic`]}"></script>`,
  'bundled module, development condition': (name: string) => `<script type="module" src="${scripts[`${name}-module`]}"></script>`,
};

let counter = 0;
async function load(ids: readonly string[], script: string): Promise<Watched & { id: string }> {
  const id = `text-${++counter}`;
  server.pages.set(`/text/${id}.html`, {
    html: `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>Text</title><link rel="stylesheet" href="/pages/page.css"><script src="/pages/observe.js"></script></head><body>
${ids.map(c => `<div class="${c === 'compact' ? 'tile' : 'chart tall'}" id="${c}"></div>`).join('\n')}
${script}</body></html>`,
    headers: { 'content-security-policy': cspPolicy(id) },
  });
  const w = await open(server);
  await w.page.goto(`${server.origin}/text/${id}.html`);
  return { ...w, id };
}

/** A sentinel with any plain body: the shape formatter output takes. */
const anyBody = (sentinelId: string): RegExp => new RegExp(`<u data-axs="${sentinelId}">[^<>]*</u>`);
const exactBody = (sentinelId: string, body: RegExp): RegExp => new RegExp(`^<u data-axs="${sentinelId}">${body.source}</u>$`);
/** What is left of a text once every whole sentinel is removed: must hold no markup at all. */
const residue = (text: string): string => text.replace(/<u data-axs="[\w-]+">[^<>]*<\/u>/g, '');
/**
 * True when the text holds only whole sentinels and plain text. The charts are sized so that no sentinel
 * label is truncated (spec L1 would allow an ellipsis): a cut sentinel fails here as a mangled one would.
 */
const clean = (text: string): boolean => !/[<>]|data-axs/.test(residue(text));

/** Everything the page shows as text or attribute value, and how many parsed sentinels exist. */
async function pageText(page: Page): Promise<{ texts: string[]; attrs: string[]; parsed: number; created: string[] }> {
  return page.evaluate(() => {
    const texts: string[] = [];
    const attrs: string[] = [];
    // Per element: an axis label's wrapped lines are one text; otherwise each element's own text nodes.
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      for (const a of Array.from(el.attributes)) attrs.push(a.value);
      if (el.tagName === 'SCRIPT' || el.closest('.axylo-label') && !el.classList.contains('axylo-label')) continue;
      if (el.classList.contains('axylo-label')) { texts.push(Array.from(el.children).map(l => l.textContent ?? '').join(' ')); continue; }
      const own = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent ?? '').join('');
      if (own) texts.push(own);
    }
    return {
      texts, attrs, parsed: document.querySelectorAll('[data-axs], u').length,
      created: (window as unknown as { __created: string[] }).__created,
    };
  });
}

/** Text of each element matching `selector` under the chart; axis labels are joined across their wrapped lines. */
const textsOf = (page: Page, chart: string, selector: string): Promise<string[]> =>
  page.evaluate(([c, sel]) => Array.from(document.querySelectorAll(`#${c} ${sel}`)).map(e => {
    const lines = Array.from(e.children).filter(k => k.tagName === 'DIV');
    return e.classList.contains('axylo-label') && lines.length > 0 ? lines.map(l => l.textContent ?? '').join(' ') : e.textContent ?? '';
  }), [chart, selector] as const);

/** The text of the elements an attribute (aria-labelledby, aria-describedby) points at. */
const referenced = (page: Page, chart: string, attribute: string): Promise<string> =>
  page.evaluate(([c, attr]) => {
    const fig = document.querySelector(`#${c} figure`)!;
    const ids = fig.getAttribute(attr);
    if (!ids) return attr === 'aria-labelledby' ? fig.getAttribute('aria-label') ?? '' : '';
    return ids.split(/\s+/).map(i => document.getElementById(i)?.textContent ?? '').join(' ');
  }, [chart, attribute] as const);

/** Moves the pointer over the plot until the visible tooltip or readout contains `anchor`; returns that surface's parts. */
async function tooltipWith(page: Page, chart: string, anchor: string): Promise<{ title: string[]; series: string[]; values: string[]; all: string } | null> {
  const plot = page.locator(`#${chart} .axylo-plot`);
  await plot.scrollIntoViewIfNeeded();
  const box = (await plot.boundingBox())!;
  const surface = page.locator(`#${chart} .axylo-tooltip, #${chart} .axylo-readout`).filter({ visible: true });
  for (const fy of chart === 'scatter' ? [0.2, 0.35, 0.5, 0.65, 0.8] : [0.5]) {
    for (let fx = 0.1; fx < 0.98; fx += chart === 'scatter' ? 0.025 : 0.05) {
      await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
      await page.waitForTimeout(30);
      if (await surface.count() !== 1) continue;
      const all = (await surface.textContent()) ?? '';
      if (!all.includes(anchor)) continue;
      const part = (cls: string) => surface.locator(cls).allTextContents();
      return { title: await part('.axylo-tooltip-title'), series: await part('.axylo-tooltip-series'), values: await part('.axylo-tooltip-value'), all };
    }
  }
  return null;
}

describe.each(Object.entries(LOADERS))('%s', (_label, loader) => {
  it('every author text source reaches its surfaces literally, on all five chart types and the compact variant', async () => {
    const w = await load([...KINDS, 'compact'], loader('sentinel'));
    const page = w.page;
    for (const kind of KINDS) expect((await drawn(page, `#${kind}`)).marks, `${kind} drawn`).toBeGreaterThan(0);

    for (const kind of KINDS) {
      const id = SOURCES[kind];
      const s = (k: string) => S(id[k]!);
      const at = `${kind}:`;
      const cartesian = kind !== 'donut';
      const anchor = cartesian ? s('series') : s('category');

      // Heading, accessible name, subtitle, description.
      expect(await textsOf(page, kind, '.axylo-title'), `${at} heading`).toEqual([s('title')]);
      expect(await referenced(page, kind, 'aria-labelledby'), `${at} accessible name`).toBe(s('title'));
      expect(await textsOf(page, kind, '.axylo-subtitle'), `${at} subtitle`).toEqual([s('subtitle')]);
      const description = await referenced(page, kind, 'aria-describedby');
      for (const k of ['description', ...(cartesian ? ['xLabel', 'yLabel', 'series'] : ['category', 'unit'])]) {
        expect(description, `${at} description carries ${k}`).toContain(s(k));
      }
      expect(clean(description), `${at} description: ${residue(description)}`).toBe(true);

      // Legend.
      if (cartesian) {
        expect((await textsOf(page, kind, '.axylo-legend-entry .axylo-control-label')).sort(), `${at} legend`).toEqual(['Plain', s('series')].sort());
      } else {
        expect(await textsOf(page, kind, '.axylo-legend-name'), `${at} legend names`).toEqual([s('category'), 'Firefox', 'Safari']);
        const values = await textsOf(page, kind, '.axylo-legend-value');
        expect(values[0], `${at} legend value`).toContain(S(id.yFormat!, '45'));
        expect(values[0]).toContain(s('unit'));
        for (const v of values) expect(clean(v), `${at} legend value ${v}`).toBe(true);
      }

      // Axis ticks and titles.
      if (cartesian) {
        const labels = await textsOf(page, kind, '.axylo-text .axylo-label');
        for (const tick of ['yTick', 'xTick'].filter(k => id[k])) {
          const ticks = labels.filter(l => l.includes(`data-axs="${id[tick]}"`));
          expect(ticks.length, `${at} ${tick} labels`).toBeGreaterThanOrEqual(2);
          for (const t of ticks) expect(t, `${at} ${tick}`).toMatch(exactBody(id[tick]!, /-?\d+(\.\d+)?/));
        }
        expect(labels, `${at} x axis title`).toContain(s('xLabel'));
        const yTitle = labels.find(l => l.includes(s('yLabel')));
        expect(yTitle, `${at} y axis title`).toBeDefined();
        expect(yTitle).toContain(s('unit'));
        for (const l of labels) expect(clean(l), `${at} axis label ${l}`).toBe(true);
      }

      // Tooltip or readout.
      const tip = await tooltipWith(page, kind, anchor);
      expect(tip, `${at} a tooltip showing ${anchor}`).not.toBeNull();
      expect(tip!.series, `${at} tooltip series`).toContain(anchor);
      expect(tip!.values.length).toBeGreaterThan(0);
      for (const v of tip!.values.filter(x => !/^\d/.test(x) || x.includes('<'))) {
        expect(v, `${at} tooltip value`).toMatch(anyBody(id.yFormat!));
        expect(v).toContain(s('unit'));
      }
      if (kind === 'line' || kind === 'area') expect(tip!.title, `${at} tooltip x`).toEqual([expect.stringMatching(exactBody(id.xFormat!, /2026-03-0[2-6]/))]);
      if (kind === 'bar') expect([s('category'), 'North', 'South'], `${at} tooltip category`).toContain(tip!.title[0]);
      if (kind === 'donut') expect(tip!.title, `${at} tooltip slice`).toEqual([s('category')]);
      if (kind === 'scatter') expect(tip!.all, `${at} tooltip x`).toMatch(anyBody(id.xFormat!));
      expect(clean(tip!.all), `${at} tooltip: ${residue(tip!.all)}`).toBe(true);

      // aria-valuetext of the plot's keyboard proxy, as the pointer left it.
      const valuetext = (await page.locator(`#${kind} .axylo-proxy`).getAttribute('aria-valuetext')) ?? '';
      expect(valuetext, `${at} aria-valuetext`).toMatch(anyBody(id.yFormat!));
      expect(valuetext).toContain(s('unit'));
      expect(valuetext).toMatch(anyBody(kind === 'donut' || kind === 'bar' ? id.category! : id.xFormat!));
      expect(clean(valuetext), `${at} aria-valuetext: ${residue(valuetext)}`).toBe(true);
      await page.mouse.move(1, 1);

      // Table: caption, headers, and each cell against the fixture row it came from.
      await page.locator(`#${kind} [role="toolbar"] button`, { hasText: 'View as table' }).click();
      await expect.poll(() => page.locator(`#${kind} table`).count()).toBe(1);
      expect(await textsOf(page, kind, 'table caption'), `${at} caption`).toEqual([s('title')]);
      const headers = await textsOf(page, kind, 'thead th');
      const rows = await page.evaluate(c => Array.from(document.querySelectorAll(`#${c} tbody tr`)).map(r => Array.from(r.children).map(x => x.textContent ?? '')), kind);
      for (const cell of [...headers, ...rows.flat()]) expect(clean(cell), `${at} table cell ${cell}`).toBe(true);
      const col = (pred: (h: string) => boolean) => headers.findIndex(pred);
      const value = (v: number) => S(id.yFormat!, String(v));
      if (kind === 'line' || kind === 'area' || kind === 'bar') {
        expect(headers[0], `${at} x header`).toBe(s('xLabel'));
        const mine = col(h => h.includes(s('series'))), plain = col(h => h.startsWith('Plain'));
        expect(headers[mine]).toContain(s('unit'));
        const keys = kind === 'bar' ? [s('category'), 'North', 'South'] : ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06'].map(d => S(id.xFormat!, d));
        expect(rows.map(r => r[0]), `${at} row headers`).toEqual(keys);
        rows.forEach((r, i) => {
          const base = kind === 'bar' ? 300 + 40 * i : 100 + 10 * i;
          expect(r[mine], `${at} row ${i}, ${s('series')}`).toContain(value(base));
          expect(r[plain], `${at} row ${i}, Plain`).toContain(value(base + (kind === 'bar' ? 25 : 50)));
          expect(r[mine]).toContain(s('unit'));
        });
      }
      if (kind === 'scatter') {
        expect(headers[0]).toBe(s('xLabel'));
        const y = col(h => h.includes(s('yLabel')));
        expect(headers[y]).toContain(s('unit'));
        const seriesCol = rows[0]!.findIndex((_, j) => j !== 0 && j !== y);
        rows.forEach((r, i) => {
          expect(r[0], `${at} row ${i} x`).toBe(S(id.xFormat!, String(10 + 5 * i)));
          expect(r[y], `${at} row ${i} y`).toContain(value(40 + ((i * 7) % 11) * 3));
          expect(r[seriesCol], `${at} row ${i} series`).toBe(i % 2 ? s('series') : 'Plain');
        });
      }
      if (kind === 'donut') {
        const v = col(h => h.includes(s('yLabel')));
        expect(headers[v]).toContain(s('unit'));
        expect(rows.map(r => r[0]), `${at} row headers`).toEqual([s('category'), 'Firefox', 'Safari']);
        expect(rows.map(r => r[v]), `${at} values`).toEqual([expect.stringContaining(value(45)), expect.stringContaining(value(30)), expect.stringContaining(value(25))]);
      }
    }

    // Compact: a static image whose name and description are its text (spec 3.7, C1).
    expect(await page.locator('#compact figure').getAttribute('role')).toBe('img');
    expect(await referenced(page, 'compact', 'aria-labelledby')).toBe(S('c-title'));
    expect(await referenced(page, 'compact', 'aria-describedby')).toContain(S('c-desc'));

    const all = await pageText(page);
    for (const t of [...all.texts, ...all.attrs]) expect(clean(t), `page text: ${residue(t).slice(0, 120)}`).toBe(true);
    expect(all.parsed, 'parsed sentinels').toBe(0);
    expect(all.created, 'elements created from text').toEqual([]);
    expect(w.errors).toEqual([]);
    expect(server.reports.get(w.id) ?? []).toEqual([]);
    await w.context.close();
  });

  it('every built-in string that reaches the page is the override, literally, and the dirty-input note reads as written', async () => {
    const w = await load(MESSAGE_CHARTS, loader('message'));
    const page = w.page;
    await drawn(page, '#line');
    // Gather what each chart shows: as drawn, under the pointer across the plot, and with its table open.
    const shown = new Map<string, Set<string>>();
    const snapshot = async (chart: string) => {
      const set = shown.get(chart) ?? new Set<string>();
      const { texts, attrs } = await page.evaluate(c => {
        const root = document.getElementById(c)!;
        const texts: string[] = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n.textContent ?? '');
        const attrs = Array.from(root.querySelectorAll('*')).flatMap(e => Array.from(e.attributes).map(a => a.value));
        return { texts, attrs };
      }, chart);
      for (const t of [...texts, ...attrs]) set.add(t);
      shown.set(chart, set);
    };
    for (const chart of MESSAGE_CHARTS) {
      await page.locator(`#${chart}`).scrollIntoViewIfNeeded();
      await snapshot(chart);
      const box = await page.locator(`#${chart} .axylo-plot`).boundingBox().catch(() => null);
      if (box) for (let fx = 0.1; fx < 0.98; fx += 0.1) { await page.mouse.move(box.x + box.width * fx, box.y + box.height * 0.5); await page.waitForTimeout(30); await snapshot(chart); }
      await page.mouse.move(1, 1);
      const button = page.locator(`#${chart} [role="toolbar"] button`, { hasText: 'm-viewAsTable' });
      if (await button.count() === 1) { await button.click(); await page.waitForTimeout(100); await snapshot(chart); }
    }

    // Which strings each chart must show, and why: the surfaces the spec and the Messages docs name.
    const toolbar = ['line', 'area', 'bar', 'scatter', 'donut'];
    const REQUIRED: Record<string, string[]> = {
      viewAsTable: toolbar, hideTable: toolbar, controlsLabel: toolbar, // table control and the toolbar's name
      plotLabel: toolbar, plotRole: toolbar, plotInstructions: toolbar, // the plot's keyboard proxy
      pointAll: ['line', 'area', 'bar', 'donut'], pointOf: ['scatter'], // its value text
      previousPage: toolbar, nextPage: toolbar, pageOf: toolbar, jumpToX: toolbar, // the table's pager
      category: ['donut'], percentage: ['donut'], series: ['scatter'], // table headers
      zoomIn: ['line', 'area', 'scatter'], zoomOut: ['line', 'area', 'scatter'], // zoomable x
      resetZoom: ['untitled'], panLeft: ['untitled'], panRight: ['untitled'], // while zoomed
      chartSummary: ['area', 'bar', 'scatter'], seriesSummary: ['area', 'bar', 'scatter'], donutSummary: ['donut'],
      chartName: ['untitled'], timeZoneNote: ['untitled'], referenceLine: ['untitled'], referenceBand: ['untitled'],
      valuesNotShown: ['line'], noData: ['line'], // the dirty input
      total: ['area'], incompleteStack: ['sparse'], moreRows: ['many'], seriesNoData: ['many'], otherSlices: ['slices'],
      loading: ['loading'], empty: ['nothing'],
    };
    const missing: string[] = [];
    for (const [key, charts] of Object.entries(REQUIRED)) {
      for (const chart of charts) if (![...(shown.get(chart) ?? [])].some(t => t.includes(S(`m-${key}`)))) missing.push(`${key} on #${chart}`);
    }
    expect(missing, 'built-in strings not shown as their override').toEqual([]);

    // The reader note: replaced whole, and the built-in template with only {seeTable} replaced (spec F12).
    expect(await textsOf(page, 'line', '.axylo-note')).toEqual([S('m-valuesNotShown')]);
    expect(await textsOf(page, 'note', '.axylo-note')).toEqual([`Values not shown: 3. ${S('m-seeTable')}`]);
    // Author error text in the error state (spec L7).
    expect([...(shown.get('failed') ?? [])].some(t => t.includes(S('src-error'))), 'author error text').toBe(true);

    const all = await pageText(page);
    for (const t of [...all.texts, ...all.attrs]) expect(clean(t), `page text: ${residue(t).slice(0, 120)}`).toBe(true);
    expect(all.parsed).toBe(0);
    expect(all.created).toEqual([]);
    expect(w.errors).toEqual([]);
    expect(server.reports.get(w.id) ?? []).toEqual([]);
    await w.context.close();
  });
});
