/**
 * Data the chart cannot draw as given (spec F3, F12, 3.5), states (L7) and calendar dates in three viewer
 * zones (F4). Expected codes come from the registry's statement for the combined dirty fixture.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { start, stop, url } from '../harness';
import { aria, chartPage, closePage } from './util';

beforeAll(start);
afterAll(stop);

describe('dirty input (spec 3.5, F12)', () => {
  for (const flavour of ['development', 'production'] as const) {
    it(`the combined fixture yields AX102, AX103 and AX106 once each and shows the reader's note (${flavour} build)`, async () => {
      const page = await chartPage();
      if (flavour === 'production') await page.addScriptTag({ url: url('packages/axylo/dist/axylo.iife.min.js') });
      const result = await page.evaluate(async () => {
        const chart = window.Axylo.line!('#chart', { title: 'Dirty input', data: window.fx.dirtyRows(), x: 'day', y: 'value' });
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const note = document.querySelector('#chart .axylo-note') as HTMLElement;
        return { codes: chart.diagnostics.map(d => d.code), note: note.hidden ? null : note.textContent, role: note.getAttribute('role') };
      });
      const warnings = result.codes.filter(c => ['AX102', 'AX103', 'AX106'].includes(c)).sort();
      expect(warnings).toEqual(['AX102', 'AX103', 'AX106']);
      expect(result.note).toBe('3 values not shown. See table.');
      expect(result.role).toBe('status');
      expect(await aria(page)).toContain('status: 3 values not shown. See table.');
      expect(await closePage(page)).toEqual([]);
    });
  }

  it('prints each warning once with console.warn', async () => {
    const page = await chartPage();
    const warned: string[] = [];
    page.on('console', m => { if (m.type() === 'warning') warned.push(m.text().slice(0, 13)); });
    await page.evaluate(async () => {
      for (let i = 0; i < 3; i++) window.Axylo.line!(Object.assign(document.body.appendChild(document.createElement('div')), { style: 'width:300px' }), { title: `Dirty ${i}`, data: window.fx.dirtyRows(), x: 'day', y: 'value' });
      await window.nextFrames(2);
    });
    expect(warned.sort()).toEqual(['[axylo AX102]', '[axylo AX103]', '[axylo AX106]']);
    expect(await closePage(page)).toEqual([]);
  });

  it('with strict: true the create call throws and leaves nothing in the target', async () => {
    const page = await chartPage();
    const result = await page.evaluate(async () => {
      const target = document.getElementById('chart')!;
      let error: { name: string; message: string; codes: string[] } | null = null;
      try {
        window.Axylo.line!(target, { title: 'Dirty input', strict: true, data: window.fx.dirtyRows(), x: 'day', y: 'value' });
      } catch (e) {
        const err = e as Error & { diagnostics: { code: string }[] };
        error = { name: err.name, message: err.message, codes: err.diagnostics.map(d => d.code) };
      }
      await window.nextFrames(2);
      return { error, children: target.childElementCount, className: target.className, scheme: target.getAttribute('data-axylo-scheme') };
    });
    expect(result.error?.message).toMatch(/AX10[236]/);
    expect(result.error?.codes.sort()).toEqual(['AX102', 'AX103', 'AX106']);
    expect(result.children).toBe(0);
    expect(result.className).toBe('');
    expect(result.scheme).toBeNull();
    expect(await closePage(page)).toEqual([]);
  });
});

describe('formatters (spec F6, 3.5)', () => {
  it('a custom formatter that throws falls back to the default, raises AX160 when found, and is never thrown', async () => {
    const page = await chartPage();
    const result = await page.evaluate(async () => {
      const chart = window.Axylo.line!('#chart', {
        title: 'Formatter', strict: true, data: [{ d: 1, v: 10 }, { d: 2, v: 20 }, { d: 3, v: 30 }], x: 'd',
        y: { field: 'v', tickFormat: () => { throw new Error('author bug'); } },
      });
      await chart.__bench.ready();
      return { codes: chart.diagnostics.map(d => d.code), ticks: [...document.querySelectorAll('#chart .axylo-label[data-role="tick-y"]')].map(e => e.textContent) };
    });
    expect(result.codes).toContain('AX160');
    expect(result.ticks).toContain('20');
    expect(await closePage(page)).toEqual([]);
  });
});

describe('states (spec L7)', () => {
  it('empty data shows the empty message inside the plot and no tick labels', async () => {
    const page = await chartPage();
    const result = await page.evaluate(async () => {
      const chart = window.Axylo.line!('#chart', { title: 'Nothing yet', data: [], x: 'day', y: 'value' });
      await chart.__bench.ready();
      const message = document.querySelector('#chart .axylo-plot .axylo-message') as HTMLElement;
      return { message: message.hidden ? null : message.textContent, labels: document.querySelectorAll('#chart .axylo-label').length, errors: chart.diagnostics.filter(d => d.level === 'error').length };
    });
    expect(result.message).toBe('No data to show.');
    expect(result.labels).toBe(0);
    expect(result.errors).toBe(0);
    expect(await aria(page)).toContain('No data to show.');
    expect(await closePage(page)).toEqual([]);
  });

  it("state: 'loading' then update({ state: 'ready' }) is announced once", async () => {
    const page = await chartPage();
    const result = await page.evaluate(async () => {
      const chart = window.Axylo.line!('#chart', { title: 'Sessions', state: 'loading', data: [], x: 'day', y: 'sessions', series: 'channel' });
      await chart.__bench.ready();
      const live = document.querySelector('#chart [aria-live="polite"]')!;
      const message = document.querySelector('#chart .axylo-message') as HTMLElement;
      const loading = message.hidden ? null : message.textContent;
      const said: string[] = [];
      new MutationObserver(() => said.push(live.textContent ?? '')).observe(live, { childList: true, characterData: true, subtree: true });
      chart.update({ state: 'ready', data: window.fx.trendRows() });
      await chart.__bench.ready();
      await window.nextFrames(3);
      return { loading, said, after: message.hidden };
    });
    expect(result.loading).toBe('Loading chart.');
    expect(result.said).toEqual(['Sessions']);
    expect(result.after).toBe(true);
    expect(await closePage(page)).toEqual([]);
  });

  it('an author error state and an internal failure both show their message inside the plot, in the accessibility tree', async () => {
    const page = await chartPage({ css: '#other { width: 400px; }' });
    const consoleErrors: string[] = [];
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    const result = await page.evaluate(async () => {
      const chart = window.Axylo.line!('#chart', { title: 'Sessions', data: window.fx.trendRows(), x: 'day', y: 'sessions', series: 'channel' });
      await chart.__bench.ready();
      chart.__dev.fail('reader');
      chart.update({ title: 'Sessions, renamed' });
      await window.nextFrames(2);
      const message = document.querySelector('#chart .axylo-message') as HTMLElement;
      const internal = message.hidden ? null : message.textContent;
      const labels = document.querySelectorAll('#chart .axylo-label').length;
      const el = Object.assign(document.body.appendChild(document.createElement('div')), { id: 'other' });
      const other = window.Axylo.line!(el, { title: 'Other', state: { error: 'The query failed.' }, data: [], x: 'day', y: 'v' });
      await other.__bench.ready();
      return { internal, labels, authored: el.querySelector('.axylo-message')!.textContent };
    });
    expect(result.internal).toBe('Something went wrong while drawing the chart.');
    expect(result.labels).toBe(0);
    expect(result.authored).toBe('The query failed.');
    expect(await aria(page)).toContain('Something went wrong while drawing the chart.');
    expect(await aria(page, '#other')).toContain('The query failed.');
    expect(consoleErrors.some(t => t.includes('internal error'))).toBe(true);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('calendar dates in three viewer zones (spec F4 a)', () => {
  it('the dates fixture as date strings gives identical tick text in UTC, America/Los_Angeles and Asia/Kolkata', async () => {
    const texts: string[][] = [];
    for (const timezoneId of ['UTC', 'America/Los_Angeles', 'Asia/Kolkata']) {
      const page = await chartPage({ timezoneId });
      texts.push(await page.evaluate(async () => {
        const chart = window.Axylo.line!('#chart', { title: 'Daily sessions by channel', data: window.fx.datesRows(), x: 'day', y: 'sessions', series: 'channel' });
        await chart.__bench.ready();
        return [...document.querySelectorAll('#chart .axylo-label[data-role="tick-x"]')].map(e => e.textContent ?? '');
      }));
      expect(await closePage(page)).toEqual([]);
    }
    expect(texts[0]!.length).toBeGreaterThan(2);
    expect(texts[0]![0]).toMatch(/Jan/);
    expect(texts[1]).toEqual(texts[0]);
    expect(texts[2]).toEqual(texts[0]);
  });
});
