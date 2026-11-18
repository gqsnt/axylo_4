/**
 * F12, rendered: when a warning means values were left out or changed, a short note says so inside the
 * figure and in the accessibility tree, in every build (spec 3.1). Development bundle and the minified
 * production bundle (prod.html) alike; the tree is Chrome's own.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { start, stop } from '../harness';
import { axWithin, box, closePage, create, devPage, inside, prodPage, settle } from './util';
import { DIRTY, FULL, type ChartType } from './fixtures';

beforeAll(start);
afterAll(stop);

type Full = Exclude<ChartType, 'compact'>;

/** The note as the spec words it, for `n` values. */
const notShown = (n: number) => `Values not shown: ${n}. See table.`;

async function noteState(page: Page): Promise<{ text: string; visible: boolean; insideFigure: boolean; inTree: boolean }> {
  const note = page.locator('#chart .axylo-note');
  const visible = (await note.count()) > 0 && (await note.isVisible());
  const text = visible ? ((await note.textContent()) ?? '').trim() : '';
  const insideFigure = visible ? inside(await box(page, '#chart .axylo-note'), await box(page, '#chart figure')) : false;
  const tree = await axWithin(page, '#chart');
  const inTree = !!text && tree.some(n => (n.role === 'StaticText' || n.role === 'status') && n.name.includes(text));
  return { text, visible, insideFigure, inTree };
}

describe('F12 values left out', () => {
  for (const type of FULL as Full[]) {
    for (const build of ['development', 'production'] as const) {
      it(`F12 ${type}: the dirty fixture shows "${notShown(DIRTY.leftOut)}" inside the figure and in the accessibility tree (${build} build)`, async () => {
        const page = build === 'development' ? await devPage() : await prodPage();
        const built = await create(page, type, {}, '#chart', 'dirty');
        // Thu (NaN, AX103), Fri ('40', AX106) and Sat (absent, AX102) are left out; Wed (null) is a silent gap.
        expect(built.diagnostics.filter(d => d.level === 'warning').map(d => d.code).sort()).toEqual(['AX102', 'AX103', 'AX106']);
        const note = await noteState(page);
        expect(note.visible).toBe(true);
        expect(note.text).toBe(notShown(DIRTY.leftOut));
        expect(note.insideFigure).toBe(true);
        expect(note.inTree).toBe(true);
        expect(await closePage(page)).toEqual([]);
      });
    }

    it(`F12 ${type}: one value left out reads correctly for a count of one, and clean data shows no note`, async () => {
      const page = await devPage();
      await create(page, type);
      expect((await noteState(page)).visible).toBe(false);
      await page.close();
      const second = await devPage();
      const data = type === 'donut' ? [{ item: 'Rent', spend: 1200 }, { item: 'Food', spend: '__NaN__' }, { item: 'Travel', spend: 360 }]
        : type === 'scatter' ? [{ size: 1, latency: 3, region: 'EU' }, { size: 2, latency: '__NaN__', region: 'EU' }, { size: 3, latency: 5, region: 'EU' }]
          : type === 'bar' ? [{ quarter: 'Q1', kind: 'Plan', shipped: 1 }, { quarter: 'Q2', kind: 'Plan', shipped: '__NaN__' }, { quarter: 'Q3', kind: 'Plan', shipped: 3 }]
            : [{ day: '2026-03-02', site: 'North', energy: 1 }, { day: '2026-03-03', site: 'North', energy: '__NaN__' }, { day: '2026-03-04', site: 'North', energy: 3 }];
      await create(second, type, { data });
      const note = await noteState(second);
      expect(note.text).toBe(notShown(1));
      expect(note.inTree).toBe(true);
      expect(await closePage(second)).toEqual([]);
    });
  }
});

describe('F12 values changed', () => {
  for (const type of FULL as Full[]) {
    for (const build of ['development', 'production'] as const) {
      it(`F12 ${type}: a readout formatter that throws for one value (AX160) shows a note inside the figure and in the accessibility tree once a reader surface formats that value (reading: the default format in place of the author's is a changed value) (${build} build)`, async () => {
        const page = build === 'development' ? await devPage() : await prodPage();
        await page.evaluate(async type => {
          const A = (window as unknown as { Axylo: Record<string, (t: string, o: unknown) => unknown> }).Axylo;
          const format = (v: number) => { if (v === 15 || v === 600 || v === 140 || v === 47) throw new Error('no'); return `${v} units`; };
          const opts: Record<string, Record<string, unknown>> = {
            line: { title: 'T', data: [12, 15, 11].map((v, i) => ({ d: `2026-03-0${i + 2}`, v })), x: { field: 'd', type: 'date' }, y: { field: 'v', format } },
            area: { title: 'T', data: [12, 15, 11].map((v, i) => ({ d: `2026-03-0${i + 2}`, v })), x: { field: 'd', type: 'date' }, y: { field: 'v', format } },
            bar: { title: 'T', data: [45, 47, 50].map((v, i) => ({ q: `Q${i + 1}`, v })), x: 'q', y: { field: 'v', format } },
            scatter: { title: 'T', data: [120, 140, 135].map((v, i) => ({ x: i + 1, v })), x: 'x', y: { field: 'v', format } },
            donut: { title: 'T', data: [1200, 600, 360].map((v, i) => ({ l: `S${i}`, v })), label: 'l', value: { field: 'v', format } },
          };
          const chart = A[type]!('#chart', opts[type]) as { __bench?: { ready(): Promise<void> } };
          (window as unknown as { charts: unknown[] }).charts.push(chart);
          if (chart.__bench) await chart.__bench.ready();
          for (let i = 0; i < 3; i++) await new Promise(r => requestAnimationFrame(r));
        }, type);
        // Make every reader surface format every value: the summary is built at once; open the table too.
        await page.locator('#chart [role="toolbar"] button', { hasText: 'View as table' }).click();
        await settle(page);
        // The note follows on a later frame (the formatter fails while the table page is built); the
        // production handle has no `ready`, so wait for the note, then assert on it.
        await page.waitForFunction(() => document.querySelector<HTMLElement>('#chart .axylo-note')?.hidden === false, null, { timeout: 5000 }).catch(() => undefined);
        const note = await noteState(page);
        expect(note, JSON.stringify(note)).toMatchObject({ visible: true, insideFigure: true, inTree: true });
        expect(note.text).toMatch(/\b1\b/);
        expect(note.text).toMatch(/table/i);
        expect(await closePage(page)).toEqual([]);
      });
    }
  }

  it('F12 donut: more than eight slices are grouped into "Other (n)" (AX121) and the note says values are shown differently, in the figure and the accessibility tree', async () => {
    const page = await devPage();
    const values = [30, 20, 15, 10, 8, 6, 5, 4, 3, 2];
    const built = await create(page, 'donut', { data: values.map((v, i) => ({ item: `S${i + 1}`, spend: v })) });
    expect(built.diagnostics.map(d => d.code)).toContain('AX121');
    const note = await noteState(page);
    expect(note.visible).toBe(true);
    // Three slices (S8–S10) are not drawn as given.
    expect(note.text).toMatch(/\b3\b/);
    expect(note.text).toMatch(/table/i);
    expect(note.inTree).toBe(true);
    expect(await closePage(page)).toEqual([]);
  });
});
