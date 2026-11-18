/**
 * A1: every chart has an accessible name and a generated summary; ids are unique per chart (spec 3.4).
 * Read from Chrome's accessibility tree: the figure's computed role, name and description.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { start, stop } from '../harness';
import { axe } from '../a11y/util';
import { axOf, axWithin, closePage, create, devPage, prodPage } from './util';
import { missingClauses, sentences, summaryClauses, TYPES, TYPE_WORD, withUnit, ZONE_NAMES, type ChartType, type Clause } from './fixtures';

beforeAll(start);
afterAll(stop);

const FIGURE = '#chart figure';
/** The x label the generated-name test gives, and the measure each fixture plots. */
const X_LABEL: Record<ChartType, string | null> = { line: 'Day', area: 'Day', compact: 'Day', bar: 'Quarter', scatter: 'Payload', donut: null };
const MEASURE: Record<ChartType, string> = { line: 'Energy', area: 'Energy', compact: 'Energy', bar: 'Shipped', scatter: 'Latency', donut: 'Spend' };

function untitled(type: ChartType): Record<string, unknown> {
  // `title: undefined` returns the option to its default (no title); the x field gets a label to name.
  const x = X_LABEL[type];
  const extra: Record<string, unknown> = { title: undefined };
  if (x && type === 'bar') extra.x = { field: 'quarter', label: x };
  else if (x && type === 'scatter') extra.x = { field: 'size', label: x, unit: 'kB' };
  else if (x) extra.x = { field: 'day', type: 'date', label: x };
  return extra;
}

describe('A1 accessible name and summary', () => {
  for (const type of TYPES) {
    it(`A1 ${type}: the title is the accessible name and the description is the generated summary: type, series, x and y range, each series' minimum, maximum and last value`, async () => {
      const page = await devPage();
      await create(page, type);
      const fig = await axOf(page, FIGURE);
      expect(fig.role).toBe(type === 'compact' ? 'image' : 'group');
      expect(fig.name).toBe(type === 'donut' ? 'Monthly spend' : type === 'bar' ? 'Shipments per quarter' : type === 'scatter' ? 'Latency by payload size' : 'Energy use by site');
      // Each named statement in a sentence of its own (removing the range statement, say, fails).
      expect(missingClauses(fig.description, summaryClauses(type)), fig.description).toEqual([]);
      expect(await closePage(page)).toEqual([]);
    });

    for (const build of ['development', 'production'] as const) {
      it(`A1 ${type}: with no title and no labelledBy the name is generated from type and measure ("${TYPE_WORD[type]} chart of ${MEASURE[type]}…") and AX140 is raised (${build} build)`, async () => {
        const page = build === 'development' ? await devPage() : await prodPage();
        const warnings: string[] = [];
        page.on('console', m => { if (m.type() === 'warning') warnings.push(m.text()); });
        const built = await create(page, type, untitled(type));
        const fig = await axOf(page, FIGURE);
        const x = X_LABEL[type];
        if (x) expect(fig.name).toBe(`${TYPE_WORD[type]} chart of ${MEASURE[type]} by ${x}`);
        else expect(fig.name.startsWith(`${TYPE_WORD[type]} chart of ${MEASURE[type]}`), fig.name).toBe(true);
        expect(built.diagnostics.filter(d => d.code === 'AX140').map(d => d.level)).toEqual(['warning']);
        // Spec 3.5: warnings print once per code per page in every build.
        expect(warnings.filter(w => w.includes('AX140'))).toHaveLength(1);
        // The summary is still there with the generated name.
        expect(fig.description).toContain(TYPE_WORD[type]);
        expect(await closePage(page)).toEqual([]);
      });
    }

    it(`A1 ${type}: labelledBy names the chart from the page's own heading, without a heading of its own and without AX140`, async () => {
      const page = await devPage();
      await page.evaluate(() => {
        const h = document.createElement('h2');
        h.id = 'card-heading';
        h.textContent = 'Card heading';
        document.querySelector('#chart')!.before(h);
      });
      const built = await create(page, type, { title: undefined, labelledBy: 'card-heading' });
      const fig = await axOf(page, FIGURE);
      expect(fig.name).toBe('Card heading');
      expect(built.diagnostics.map(d => d.code)).not.toContain('AX140');
      const headings = (await axWithin(page, '#chart')).filter(n => n.role === 'heading');
      expect(headings).toEqual([]);
      expect(await closePage(page)).toEqual([]);
    });

    if (type !== 'compact') {
      it(`A1 ${type}: the title's heading level is the author's, and a visually hidden title still names the chart`, async () => {
        const page = await devPage();
        await create(page, type, { title: { text: 'Level two', level: 2 } });
        let heading = (await axWithin(page, '#chart')).find(n => n.role === 'heading');
        expect(heading?.name).toBe('Level two');
        expect(heading?.props.level).toBe(2);
        await page.evaluate(() => {
          const c = (window as unknown as { charts: { update(p: unknown): void }[] }).charts[0]!;
          c.update({ title: { text: 'Hidden five', level: 5, visible: false } });
        });
        await page.evaluate(async () => { for (let i = 0; i < 3; i++) await new Promise(r => requestAnimationFrame(r)); });
        heading = (await axWithin(page, '#chart')).find(n => n.role === 'heading');
        expect(heading?.name).toBe('Hidden five');
        expect(heading?.props.level).toBe(5);
        expect((await axOf(page, FIGURE)).name).toBe('Hidden five');
        // Visually hidden: no visible area on the page.
        const size = await page.locator('#chart .axylo-title').evaluate(el => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return { area: r.width * r.height, clipped: s.clipPath !== 'none' || s.clip !== 'auto' };
        });
        expect(size.area <= 1 || size.clipped).toBe(true);
        expect(await closePage(page)).toEqual([]);
      });
    }

    it(`A1 ${type}: an author description is added to the summary and never removes the zone or the omission statement`, async () => {
      const page = await devPage();
      // Instants in a named zone (not for a donut, which has no x) with one value that cannot be drawn.
      const options: Record<string, unknown> = type === 'donut'
        ? { data: [{ item: 'Rent', spend: 1200 }, { item: 'Food', spend: '__NaN__' }, { item: 'Travel', spend: 360 }] }
        : type === 'scatter'
          ? { data: [{ size: Date.UTC(2026, 2, 2), latency: 1 }, { size: Date.UTC(2026, 2, 3), latency: '__NaN__' }, { size: Date.UTC(2026, 2, 4), latency: 3 }], x: { field: 'size', type: 'time', timeZone: 'Asia/Kolkata' }, series: undefined }
          : type === 'bar'
            ? { data: [{ quarter: Date.UTC(2026, 2, 2), shipped: 1 }, { quarter: Date.UTC(2026, 2, 3), shipped: '__NaN__' }, { quarter: Date.UTC(2026, 2, 4), shipped: 3 }], x: { field: 'quarter', type: 'time', timeZone: 'Asia/Kolkata' }, series: undefined }
            : { data: [{ day: Date.UTC(2026, 2, 2), energy: 1 }, { day: Date.UTC(2026, 2, 3), energy: '__NaN__' }, { day: Date.UTC(2026, 2, 4), energy: 3 }], x: { field: 'day', type: 'time', timeZone: 'Asia/Kolkata' }, series: undefined };
      await create(page, type, { ...options, description: 'Readings from the main meter.' });
      const fig = await axOf(page, FIGURE);
      expect(sentences(fig.description)).toContain('Readings from the main meter.');
      // The generated statements all stay beside the author's: ranges, the zone, the omission.
      const unit = { line: 'kWh', area: 'kWh', bar: 't', scatter: 'ms', donut: 'EUR', compact: 'kWh' }[type];
      const label = { line: 'Energy', area: 'Energy', bar: 'Shipped', scatter: 'Latency', donut: 'Spend', compact: 'Energy' }[type];
      const clauses: Clause[] = type === 'donut'
        ? [{ name: 'Rent', fragments: ['Rent', withUnit(1200, unit)] }, { name: 'Travel', fragments: ['Travel', withUnit(360, unit)] }]
        : [
          { name: 'x range', fragments: [type === 'bar' ? 'quarter' : type === 'scatter' ? 'size' : 'day', 'Mar 2, 2026', 'Mar 4, 2026'] },
          { name: 'y range', fragments: [label, withUnit(1, unit), withUnit(3, unit)] },
        ];
      // One value left out (NaN, AX103), said with its count (spec A1 "any omissions", F12).
      clauses.push({ name: 'omission', fragments: ['not shown', '1'] });
      expect(missingClauses(fig.description, clauses), fig.description).toEqual([]);
      if (type !== 'donut') expect(sentences(fig.description).some(t => ZONE_NAMES.some(z => t.includes(z))), fig.description).toBe(true);
      expect(await closePage(page)).toEqual([]);
    });

    if (type !== 'donut') {
      it(`A1 ${type}: the summary of instants states the time zone they are shown in`, async () => {
        const page = await devPage();
        await create(page, type, {}, '#chart', 'instants');
        const fig = await axOf(page, FIGURE);
        expect(ZONE_NAMES.some(z => fig.description.includes(z)), fig.description).toBe(true);
        expect(await closePage(page)).toEqual([]);
      });
    }

    it(`A1 ${type}: 24 charts on one page have no duplicate ids, each its own name, and axe heading-order passes`, async () => {
      const page = await devPage({ css: '.tile { width: 340px; height: 200px; }' });
      await page.evaluate(() => {
        for (let i = 0; i < 24; i++) {
          const el = document.createElement('div');
          el.id = `tile-${i}`;
          el.className = 'tile';
          document.body.appendChild(el);
        }
      });
      for (let i = 0; i < 24; i++) await create(page, type, { title: `Chart ${i + 1}` }, `#tile-${i}`);
      const ids = await page.evaluate(() => [...document.querySelectorAll('[id]')].map(e => e.id));
      expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
      const names = [];
      for (let i = 0; i < 24; i++) names.push((await axOf(page, `#tile-${i} figure`)).name);
      expect(names).toEqual(Array.from({ length: 24 }, (_, i) => `Chart ${i + 1}`));
      const result = await axe(page, 'body');
      expect(result.violations.filter(v => v.id === 'heading-order' || v.id === 'duplicate-id' || v.id === 'duplicate-id-aria')).toEqual([]);
      expect(await closePage(page)).toEqual([]);
    });
  }
});

