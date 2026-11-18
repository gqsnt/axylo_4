/**
 * The chart types render their Phase 1 fixtures through the public API of the built bundle, with both mark
 * renderers (spec A1, C1, F2; plan M1 "trend renders"). Expected values come from the fixtures and the spec.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { start, stop } from '../harness';
import { LIGHT } from '../../../src/theme/palette';
import { aria, chartPage, closePage, columnsWith, count, hex, shot } from './util';

beforeAll(start);
afterAll(stop);

const renderers = ['canvas', 'svg'] as const;

describe('trend (3 series × 120 days, 7 nulls)', () => {
  for (const renderer of renderers) {
    it(`renders with the ${renderer} renderer: named group, summary of three series, three colors, a visible gap`, async () => {
      const page = await chartPage();
      const result = await page.evaluate(async r => {
        const fx = window.fx;
        const chart = window.Axylo.line!('#chart', {
          title: fx.trend.title, data: fx.trendRows(), x: { field: 'day', type: 'time', timeZone: 'UTC' },
          y: { field: 'sessions', label: fx.trend.yTitle }, series: 'channel', __renderer: r,
        });
        await chart.__bench.ready();
        const fig = document.querySelector('#chart figure')!;
        const summary = document.getElementById(fig.getAttribute('aria-describedby')!)!.textContent;
        return { summary, renderer: chart.__dev.renderer, diagnostics: chart.diagnostics.map(d => d.level + ' ' + d.code) };
      }, renderer);
      expect(result.renderer).toBe(renderer);
      expect(result.diagnostics.filter(d => d.startsWith('error'))).toEqual([]);
      for (const name of ['Direct', 'Organic search', 'Referral']) expect(result.summary).toContain(name);
      const tree = await aria(page);
      expect(tree).toContain('group "Daily sessions by channel"');
      expect(tree).toContain('heading "Daily sessions by channel" [level=3]');

      const { img } = await shot(page, '#chart .axylo-plot');
      const colors = LIGHT.series.slice(0, 3).map(hex);
      for (const color of colors) expect(count(img, color, 40)).toBeGreaterThan(200);
      // Referral (series 3) is null at days 60–66: a run of columns without its color, with color on both sides.
      const has = columnsWith(img, colors[2]!, 0, img.height, 40);
      const from = Math.floor(img.width * 0.35);
      const to = Math.floor(img.width * 0.75);
      let longest = 0;
      let run = 0;
      for (let x = from; x < to; x++) {
        run = has[x] ? 0 : run + 1;
        longest = Math.max(longest, run);
      }
      expect(longest).toBeGreaterThanOrEqual(20);
      expect(has.slice(from - 40, from).some(Boolean)).toBe(true);
      expect(has.slice(to, to + 40).some(Boolean)).toBe(true);
      expect(await closePage(page)).toEqual([]);
    });
  }
});

describe('the other chart types', () => {
  for (const renderer of renderers) {
    it(`bar, area, scatter, donut and compact render their fixtures (${renderer})`, async () => {
      const page = await chartPage({ css: '.tile { width: 480px; height: 300px; } .spark { width: 160px; }' });
      const result = await page.evaluate(async r => {
        const fx = window.fx;
        const A = window.Axylo;
        const box = (id: string, className = 'tile') => {
          const el = document.createElement('div');
          el.id = id;
          el.className = className;
          document.body.appendChild(el);
          return el;
        };
        const barRows = fx.bars.categories.map((team, i) => ({ team, satisfied: fx.bars.values[i] }));
        const groupRows = fx.bars.categories.flatMap((team, i) => [
          { team, year: '2025', satisfied: fx.bars.values[i]! - 3 }, { team, year: '2026', satisfied: fx.bars.values[i] },
        ]);
        const random = fx.rng(3);
        const points = Array.from({ length: 500 }, (_, i) => ({ x: random() * 100, y: random() * 50 + i * 0.01, group: i % 2 ? 'A' : 'B' }));
        const charts = {
          bar: A.bar!(box('bar'), { title: fx.bars.title, data: barRows, x: 'team', y: { field: 'satisfied', label: fx.bars.yTitle }, __renderer: r }),
          grouped: A.bar!(box('grouped'), { title: 'Grouped', data: groupRows, x: 'team', y: 'satisfied', series: 'year', __renderer: r }),
          stacked: A.bar!(box('stacked'), { title: 'Stacked', data: groupRows, x: 'team', y: 'satisfied', series: 'year', layout: 'stacked', __renderer: r }),
          area: A.area!(box('area'), { title: 'Stacked area', data: fx.trendRows(), x: { field: 'day', type: 'time', timeZone: 'UTC' }, y: 'sessions', series: 'channel', stacked: true, __renderer: r }),
          scatter: A.scatter!(box('scatter'), { title: 'Scatter of 500 points', data: points, x: 'x', y: 'y', series: 'group', __renderer: r }),
          donut: A.donut!(box('donut'), { title: fx.parts.title, data: fx.parts.labels.map((label, i) => ({ label, share: fx.parts.values[i] })), label: 'label', value: { field: 'share', label: fx.parts.name }, __renderer: r }),
          compact: A.line!(box('compact', 'spark'), { title: 'Sessions, last 120 days', data: fx.trendRows().filter(row => row.channel === 'Direct'), x: { field: 'day', type: 'time', timeZone: 'UTC' }, y: 'sessions', compact: true, __renderer: r }),
        };
        await Promise.all(Object.values(charts).map(c => c.__bench.ready()));
        const out: Record<string, Record<string, unknown>> = {};
        for (const [name, chart] of Object.entries(charts)) {
          const fig = document.querySelector(`#${name} figure`) as HTMLElement;
          const marks = fig.querySelector('.axylo-canvas canvas, .axylo-svg') as HTMLElement;
          out[name] = {
            role: fig.getAttribute('role'), label: fig.getAttribute('aria-label'), labelledby: fig.getAttribute('aria-labelledby'),
            errors: chart.diagnostics.filter(d => d.level === 'error').map(d => d.code),
            message: (fig.querySelector('.axylo-message') as HTMLElement).hidden ? null : fig.querySelector('.axylo-message')!.textContent,
            marks: marks.getBoundingClientRect().height,
            plotHeight: fig.querySelector('.axylo-plot')!.getBoundingClientRect().height,
            tabStops: fig.querySelectorAll('[tabindex]').length,
            summary: document.getElementById(fig.getAttribute('aria-describedby')!)!.textContent,
          };
        }
        return out;
      }, renderer);
      for (const [name, r] of Object.entries(result) as [string, Record<string, unknown>][]) {
        expect(r.errors, name).toEqual([]);
        expect(r.message, name).toBeNull();
        expect(r.marks, name).toBeGreaterThan(0);
        expect(r.summary, name).not.toBe('');
      }
      for (const name of ['bar', 'grouped', 'stacked', 'area', 'scatter', 'donut']) {
        expect(result[name]!.role, name).toBe('group');
        expect(result[name]!.labelledby, name).toMatch(/-t$/);
      }
      // Compact (spec C1, C3): an image named by its title, described by the summary, no tab stop, 32 px tall.
      expect(result.compact!.role).toBe('img');
      expect(result.compact!.label).toBe('Sessions, last 120 days');
      expect(result.compact!.tabStops).toBe(0);
      expect(result.compact!.plotHeight).toBe(32);
      const tree = await aria(page, '#compact');
      expect(tree).toContain('img "Sessions, last 120 days"');
      expect(tree).not.toContain('heading');
      // Donut summary lists the slices with their values (spec F8 text).
      expect(result.donut!.summary).toContain('Chrome');
      expect(result.donut!.summary).toContain('Samsung Internet');
      expect(await aria(page, '#donut')).toContain('group "Sessions by browser"');
      expect(await closePage(page)).toEqual([]);
    });
  }
});

describe('compact variant (spec C1, C5)', () => {
  it('with values left out, the description says so and a corner marker appears; there is no note element', async () => {
    const page = await chartPage({ css: '#chart { width: 160px; height: auto; }' });
    const result = await page.evaluate(async () => {
      const chart = window.Axylo.line!('#chart', { title: 'Dirty spark', compact: true, data: window.fx.dirtyRows(), x: 'day', y: 'value' });
      await chart.__bench.ready();
      const fig = document.querySelector('#chart figure')!;
      const corner = fig.querySelector('.axylo-corner') as HTMLElement;
      const note = fig.querySelector('.axylo-note') as HTMLElement;
      return {
        description: document.getElementById(fig.getAttribute('aria-describedby')!)!.textContent,
        corner: corner.hidden ? null : corner.getBoundingClientRect().width, cornerTitle: corner.getAttribute('title'),
        note: note.hidden, tabStops: fig.querySelectorAll('[tabindex]').length,
      };
    });
    expect(result.description).toMatch(/3\b.*not shown|not shown.*3\b/i);
    expect(result.corner).toBeGreaterThan(0);
    expect(result.cornerTitle).toMatch(/not shown/i);
    expect(result.note).toBe(true);
    expect(result.tabStops).toBe(0);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('names and ids', () => {
  it('24 charts on one page: no duplicate ids, each its own name', async () => {
    const page = await chartPage({ css: '.tile { width: 220px; height: 160px; display: inline-block; }' });
    const result = await page.evaluate(async () => {
      const charts = Array.from({ length: 24 }, (_, i) => {
        const el = document.createElement('div');
        el.className = 'tile';
        document.body.appendChild(el);
        return window.Axylo.line!(el, { title: `Chart ${i + 1}`, data: window.fx.trendRows(), x: { field: 'day', type: 'time', timeZone: 'UTC' }, y: 'sessions', series: 'channel' });
      });
      await Promise.all(charts.map(c => c.__bench.ready()));
      const ids = [...document.querySelectorAll('[id]')].map(e => e.id);
      const names = [...document.querySelectorAll('figure')].map(f => document.getElementById(f.getAttribute('aria-labelledby')!)?.textContent);
      return { ids, duplicates: ids.filter((id, i) => ids.indexOf(id) !== i), names };
    });
    expect(result.duplicates).toEqual([]);
    expect(new Set(result.names).size).toBe(24);
    expect(result.names[23]).toBe('Chart 24');
    expect(await closePage(page)).toEqual([]);
  });

  it('labelledBy names the chart from the page heading, with no heading of its own; title.level and visible are honoured', async () => {
    const page = await chartPage();
    const result = await page.evaluate(async () => {
      const h = document.createElement('h2');
      h.id = 'card-title';
      h.textContent = 'Sessions card';
      document.body.prepend(h);
      const rows = window.fx.trendRows();
      const a = window.Axylo.line!('#chart', { labelledBy: 'card-title', data: rows, x: 'day', y: 'sessions', series: 'channel' });
      const el = document.createElement('div');
      el.id = 'second';
      el.style.width = '400px';
      document.body.appendChild(el);
      const b = window.Axylo.line!(el, { title: { text: 'Hidden title', level: 4, visible: false }, data: rows, x: 'day', y: 'sessions', series: 'channel' });
      await Promise.all([a.__bench.ready(), b.__bench.ready()]);
      const t = el.querySelector('.axylo-title') as HTMLElement;
      return {
        a: document.querySelector('#chart figure')!.getAttribute('aria-labelledby'),
        aHeading: (document.querySelector('#chart .axylo-title') as HTMLElement).hidden,
        aCodes: a.diagnostics.map(d => d.code),
        bLevel: t.getAttribute('aria-level'), bWidth: t.getBoundingClientRect().width,
      };
    });
    expect(result.a).toBe('card-title');
    expect(result.aHeading).toBe(true);
    expect(result.aCodes).not.toContain('AX140');
    expect(result.bLevel).toBe('4');
    expect(result.bWidth).toBeLessThanOrEqual(1);
    expect(await aria(page, '#second')).toContain('heading "Hidden title" [level=4]');
    expect(await closePage(page)).toEqual([]);
  });

  it('a chart without title or labelledBy gets a generated name and AX140', async () => {
    const page = await chartPage();
    const result = await page.evaluate(async () => {
      const chart = window.Axylo.line!('#chart', { data: window.fx.trendRows(), x: 'day', y: 'sessions', series: 'channel' });
      await chart.__bench.ready();
      return { codes: chart.diagnostics.map(d => d.code), label: document.querySelector('#chart figure')!.getAttribute('aria-label') };
    });
    expect(result.codes).toContain('AX140');
    expect(result.label).toBe('Line chart of sessions by day');
    expect(await closePage(page)).toEqual([]);
  });

  it('a selector that matches nothing throws an error naming it', async () => {
    const page = await chartPage();
    const message = await page.evaluate(() => {
      try {
        window.Axylo.line!('#missing-chart', { data: [], x: 'a', y: 'b' });
        return 'no error';
      } catch (error) {
        return String(error);
      }
    });
    expect(message).toContain('#missing-chart');
    expect(await closePage(page)).toEqual([]);
  });

  it('works with the stylesheet applied through ensureStyles (no linked axylo.css)', async () => {
    const page = await chartPage({ standaloneCss: false });
    const result = await page.evaluate(async () => {
      const chart = window.Axylo.line!('#chart', { title: 'T', data: window.fx.trendRows(), x: 'day', y: 'sessions', series: 'channel' });
      await chart.__bench.ready();
      const summary = document.querySelector('#chart .axylo-summary')!;
      return { sheets: document.adoptedStyleSheets.length, summaryWidth: summary.getBoundingClientRect().width, display: getComputedStyle(document.querySelector('#chart figure')!).display };
    });
    expect(result.sheets).toBe(1);
    expect(result.display).toBe('flex');
    expect(result.summaryWidth).toBeLessThanOrEqual(1);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('tooltip', () => {
  it('shows every series at the nearest x on pointer move, built as text, and hides on leave', async () => {
    const page = await chartPage();
    await page.evaluate(async () => {
      const chart = window.Axylo.line!('#chart', { title: 'T', data: window.fx.trendRows(), x: { field: 'day', type: 'time', timeZone: 'UTC' }, y: 'sessions', series: 'channel' });
      window.charts.push(chart);
      await chart.__bench.ready();
    });
    const plot = (await page.locator('#chart .axylo-plot').boundingBox())!;
    await page.mouse.move(plot.x + plot.width * 0.5, plot.y + plot.height * 0.5);
    const tip = page.locator('#chart .axylo-tooltip');
    await expect.poll(() => tip.isVisible()).toBe(true);
    const text = await tip.textContent();
    for (const name of ['Direct', 'Organic search', 'Referral']) expect(text).toContain(name);
    expect(text).toContain('UTC');
    expect(await tip.locator('script, img').count()).toBe(0);
    await page.mouse.move(5, 5);
    await expect.poll(() => tip.isVisible()).toBe(false);
    expect(await closePage(page)).toEqual([]);
  });
});
