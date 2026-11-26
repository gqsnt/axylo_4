/**
 * Split-protection seams (cycle C1.2, track B): the places where one stage's failure, a lifecycle call or a
 * stream window could leave another stage's DOM, focus or listeners out of step. Expected values come from the
 * spec (strict rollback, I1/I6, F6, A2/A4/A7, DX5/DX8) and the fixture data written here, not from a run.
 */
import type { CDPSession, Page } from 'playwright-core';
import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireEngineFeature, start, stop } from '../harness';
import { chartPage, closePage } from './util';
import { create, frames, lastHover, plotBox, recordEvents, selected, settle, tip } from './final-util';

beforeAll(start);
afterAll(stop);

const proxy = '#chart .axylo-proxy';
const valueText = (page: Page) => page.locator(proxy).getAttribute('aria-valuetext');
const activeIsProxy = (page: Page) => page.evaluate(() => document.activeElement?.classList.contains('axylo-proxy') ?? false);
const toolbarButton = (page: Page, name: string) => page.locator('#chart [role="toolbar"] button', { hasText: name });

async function listenerCounter(page: Page): Promise<{ cdp: CDPSession; count(expression: string): Promise<number> }> {
  const cdp = await page.context().newCDPSession(page);
  return {
    cdp,
    async count(expression: string) {
      const { result } = await cdp.send('Runtime.evaluate', { expression });
      const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId! });
      return listeners.length;
    },
  };
}

async function tableRows(page: Page): Promise<string[][]> {
  return page.evaluate(() => [...document.querySelectorAll('#chart table tbody tr')].map(tr => [...tr.children].map(c => (c.textContent ?? '').trim())));
}

async function openTable(page: Page): Promise<void> {
  if (await page.locator('#chart table').count() === 0 || !(await page.locator('#chart table').isVisible())) {
    await page.getByRole('button', { name: 'View as table' }).click();
    await settle(page);
  }
}

async function closeTable(page: Page): Promise<void> {
  if (await page.locator('#chart table').count() > 0 && await page.locator('#chart table').isVisible()) {
    await page.getByRole('button', { name: /Hide table|View as chart/i }).click();
    await settle(page);
  }
}

describe('seam 1: strict: true rollback leaves the drawn chart as it was', () => {
  it('a rejected update() and a rejected append() throw AX103 and change no mark, label, title or tooltip; select still works', async () => {
    const page = await chartPage();
    await create(page, 'line', { title: 'Good', strict: true, data: Array.from({ length: 5 }, (_, x) => ({ x, y: x * 10 })), x: 'x', y: 'y' });
    await recordEvents(page);
    const p = await plotBox(page);
    // x = 0..4 span the plot; x = 2 is its middle.
    const middle = { x: p.x + p.width / 2, y: p.y + p.height / 2 };
    await page.mouse.move(middle.x, middle.y);
    await page.locator('#chart .axylo-tooltip').waitFor({ state: 'visible' });
    await settle(page);
    const shown = await tip(page);
    expect(shown.title).toContain('2');
    expect(shown.rows.join(' ')).toContain('20');
    const snapshot = () => page.evaluate(() => ({
      scene: document.querySelector('#chart .axylo-scene')?.innerHTML ?? null,
      labels: [...document.querySelectorAll('#chart .axylo-label')].map(l => l.textContent),
      title: document.querySelector('#chart .axylo-title')?.textContent ?? null,
      tooltip: (() => { const t = document.querySelector('#chart .axylo-tooltip') as HTMLElement | null; return t && !t.hidden ? t.textContent : null; })(),
    }));
    const before = await snapshot();
    expect(before.tooltip).not.toBeNull();
    const errors = await page.evaluate(async () => {
      const chart = window.charts[0]!;
      const out: { message: string; codes: string[] }[] = [];
      const attempt = (f: () => void) => {
        try { f(); out.push({ message: 'no throw', codes: [] }); } catch (e) {
          const err = e as Error & { diagnostics?: { code: string }[] };
          out.push({ message: err.message, codes: (err.diagnostics ?? []).map(d => d.code) });
        }
      };
      attempt(() => chart.update({ title: 'Bad', data: [{ x: 0, y: NaN }] }));
      attempt(() => chart.append([{ x: 5, y: NaN }]));
      await window.nextFrames(2);
      return out;
    });
    for (const e of errors) {
      expect(e.message).toMatch(/AX103/);
      expect(e.codes).toContain('AX103');
    }
    await frames(page, 2);
    expect(await snapshot()).toEqual(before);
    await page.mouse.click(middle.x, middle.y);
    await settle(page);
    expect((await selected(page)).at(-1)).toMatchObject({ x: 2, y: 20 });
    expect(await closePage(page)).toEqual([]);
  });
});

describe('seam 2: keyboard focus survives zoom(), update({ data }) and a resize across the readout threshold', () => {
  it('(a) zoom() away from the focused datum and replacing the data keep focus on the proxy; Tab leaves', async () => {
    const page = await chartPage();
    // chartPage hides the page's #after button; show it so Tab has somewhere to go after the chart.
    await page.evaluate(() => { document.getElementById('after')!.style.display = 'block'; });
    await create(page, 'line', { title: 'Focus', data: Array.from({ length: 10 }, (_, x) => ({ x, y: x })), x: 'x', y: 'y' });
    await recordEvents(page);
    await page.locator(proxy).focus();
    await page.keyboard.press('Home');
    for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight');
    expect(await valueText(page)).toMatch(/^8\b/);
    await page.evaluate(async () => { window.charts[0]!.zoom([0, 4]); await window.charts[0]!.__bench.ready(); });
    await settle(page);
    expect(await activeIsProxy(page)).toBe(true);
    const zoomed = (await valueText(page))!;
    const x = Number(/^(\d+)/.exec(zoomed)?.[1]);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThanOrEqual(4);
    await page.keyboard.press('Enter');
    await settle(page);
    expect((await selected(page)).at(-1)).toMatchObject({ x, y: x });
    await page.evaluate(async () => {
      window.charts[0]!.update({ data: [{ x: 100, y: 1 }, { x: 101, y: 2 }, { x: 102, y: 3 }] });
      await window.charts[0]!.__bench.ready();
    });
    await settle(page);
    expect(await activeIsProxy(page)).toBe(true);
    const replaced = (await valueText(page))!;
    expect(replaced.startsWith('100')).toBe(true);
    expect(replaced.endsWith('Point 1 of 3')).toBe(true);
    // No trap: a bounded number of Tabs leaves the chart.
    let left = false;
    for (let i = 0; i < 12 && !left; i++) {
      await page.keyboard.press('Tab');
      left = await page.evaluate(() => !document.getElementById('chart')!.contains(document.activeElement));
    }
    expect(left).toBe(true);
    expect(await closePage(page)).toEqual([]);
  });

  it('(b) 640 px → 220 px → 640 px keeps focus and the datum; floating tooltip ↔ readout strip; Tab leaves', async () => {
    const page = await chartPage();
    await page.evaluate(() => { document.getElementById('chart')!.style.width = '640px'; });
    await create(page, 'line', { title: 'Resize', data: Array.from({ length: 5 }, (_, x) => ({ x, y: x * 10 })), x: 'x', y: 'y' });
    await page.locator(proxy).focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await settle(page);
    const text = (await valueText(page))!;
    expect(text).toMatch(/^2\b/);
    expect((await tip(page)).title).toContain('2');
    for (const width of ['220px', '640px']) {
      await page.evaluate(w => { document.getElementById('chart')!.style.width = w; }, width);
      await settle(page);
      await settle(page);
      expect(await activeIsProxy(page)).toBe(true);
      expect(await valueText(page)).toBe(text);
      if (width === '220px') {
        expect(await page.locator('#chart .axylo-tooltip').isVisible()).toBe(false);
        expect(await page.locator('#chart .axylo-readout').isVisible()).toBe(true);
      } else {
        expect((await tip(page)).title).toContain('2');
      }
    }
    let left = false;
    for (let i = 0; i < 12 && !left; i++) {
      await page.keyboard.press('Tab');
      left = await page.evaluate(() => !document.getElementById('chart')!.contains(document.activeElement));
    }
    expect(left).toBe(true);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('seam 3: one frame behind pointer, keyboard, tooltip, events and table', () => {
  const intervals = ['0–2', '2–5', '5–10'];
  const midpoints = [1, 3.5, 7.5];

  async function fiveWay(page: Page, values: number[], formatted: string[]): Promise<void> {
    const p = await plotBox(page);
    // The x domain is the bin edges 0..10 (spec F6), so a midpoint m sits at m / 10 of the plot.
    for (let i = 0; i < 3; i++) {
      await page.mouse.move(p.x + (midpoints[i]! / 10) * p.width, p.y + p.height - 3);
      await settle(page);
      const shown = await tip(page);
      expect(shown.title).toContain(intervals[i]);
      expect(shown.rows.join(' ')).toContain(formatted[i]);
      expect(await lastHover(page)).toMatchObject({ x: midpoints[i], y: values[i], row: null, index: -1 });
    }
    await page.mouse.move(p.x + p.width + 200, p.y - 200);
    await settle(page);
    await page.locator(proxy).focus();
    await page.keyboard.press('Home');
    for (let i = 0; i < 3; i++) {
      if (i > 0) await page.keyboard.press('ArrowRight');
      const text = (await valueText(page))!;
      expect(text).toContain(intervals[i]);
      expect(text).toContain(formatted[i]);
      expect(text.endsWith(`Point ${i + 1} of 3`)).toBe(true);
      await page.keyboard.press('Enter');
      await settle(page);
      expect((await selected(page)).at(-1)).toMatchObject({ x: midpoints[i], y: values[i], row: null, index: -1 });
    }
    await page.keyboard.press('Escape');
    await openTable(page);
    expect(await tableRows(page)).toEqual(intervals.map((t, i) => [t, formatted[i]]));
    await page.getByRole('button', { name: /View as chart|Hide table|View as table/ }).first().click();
    await settle(page);
  }

  it('histogram bins [0, 2, 5, 10] with an empty interior bin agree five ways under count, probability and zoom', async () => {
    const page = await chartPage();
    await create(page, 'histogram', { title: 'H', data: [{ v: 0 }, { v: 1 }, { v: 5 }, { v: 10 }], x: 'v', bins: [0, 2, 5, 10], normalize: 'count' });
    await recordEvents(page);
    await fiveWay(page, [2, 0, 2], ['2', '0', '2']);
    await page.evaluate(async () => { window.charts[0]!.update({ normalize: 'probability' }); await window.charts[0]!.__bench.ready(); });
    await settle(page);
    await fiveWay(page, [0.5, 0, 0.5], ['50%', '0%', '50%']);
    await page.evaluate(async () => {
      window.charts[0]!.update({ normalize: 'count' });
      window.charts[0]!.zoom([1, 8]);
      await window.charts[0]!.__bench.ready();
    });
    await settle(page);
    // Zoom does not rebin (F6): all three bins overlap [1, 8] and keep their counts.
    await openTable(page);
    expect(await tableRows(page)).toEqual([['0–2', '2'], ['2–5', '0'], ['5–10', '2']]);
    expect(await closePage(page)).toEqual([]);
  });

  it('donut cross-check: tooltip, keyboard, hover/select and table agree on slice A', async () => {
    const page = await chartPage();
    await create(page, 'donut', { title: 'D', data: [{ l: 'A', v: 3 }, { l: 'B', v: 2 }], label: 'l', value: 'v' });
    await recordEvents(page);
    await page.locator(proxy).focus();
    await page.keyboard.press('Home');
    await settle(page);
    const text = (await valueText(page))!;
    expect(text).toContain('A');
    expect(text).toContain('3');
    expect(text).toContain('60%');
    const shown = await tip(page);
    expect(`${shown.title} ${shown.rows.join(' ')}`).toContain('3');
    await page.keyboard.press('Enter');
    await settle(page);
    expect((await selected(page)).at(-1)).toMatchObject({ series: 'A', x: 'A', y: 3 });
    expect(await lastHover(page)).toMatchObject({ series: 'A', x: 'A', y: 3 });
    await page.keyboard.press('Escape');
    await openTable(page);
    expect((await tableRows(page))[0]).toEqual(['A', '3', '60%']);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('seam 4: Pause/Resume through total eviction of the paused window', () => {
  it('paused, everything stays on 0..3; resumed, it jumps to 10..13, the pin closes, and no listener accumulates', async () => {
    requireEngineFeature(['chromium'], 'the registered event listeners are read through the Chrome DevTools protocol (DOMDebugger.getEventListeners)');
    const page = await chartPage();
    const { cdp, count } = await listenerCounter(page);
    const baseline = { document: await count('document'), window: await count('window') };
    await create(page, 'line', {
      title: 'S',
      data: [{ x: 0, s: 'North', y: 0 }, { x: 0, s: 'South', y: 5 }],
      x: 'x', y: 'y', series: 's',
    });
    await page.evaluate(async () => {
      window.charts[0]!.append([1, 2, 3].flatMap(x => [
        { x, s: 'North', y: x * 10 },
        { x, s: 'South', y: x * 10 + 5 },
      ]), { keep: 4 });
      await window.charts[0]!.__bench.ready();
    });
    await recordEvents(page);
    await settle(page);
    let next = 4;
    let cycleCounts: { document: number; window: number } | null = null;
    for (let cycle = 0; cycle < 3; cycle++) {
      const d = await page.evaluate(() => window.charts[0]!.__bench.describe().series[0]!);
      const lo = d.oldestX;
      const p = await plotBox(page);
      const pinX = p.x + (1 / 3) * p.width;
      await page.mouse.move(pinX, p.y + p.height / 2);
      await page.mouse.down();
      await page.mouse.up();
      await settle(page);
      expect((await tip(page)).pinned).toBe(true);
      await page.locator(proxy).focus();
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowRight');
      const pinnedText = (await valueText(page))!;
      expect(pinnedText).toMatch(new RegExp(`^${lo + 1}\\b`));
      // Re-pin after keyboard move so both pinned tooltip and paused proxy focus are active across eviction.
      await page.mouse.move(pinX, p.y + p.height / 2);
      await page.mouse.down();
      await page.mouse.up();
      await settle(page);
      expect((await tip(page)).pinned).toBe(true);
      // From the keyboard: a press elsewhere would end the pin.
      await toolbarButton(page, 'Pause').focus();
      await page.keyboard.press('Enter');
      await settle(page);
      if (cycle === 0) await openTable(page);
      const frozen = await page.evaluate(() => ({ scene: document.querySelector('#chart .axylo-scene')?.innerHTML, describe: window.charts[0]!.__bench.describe() }));
      const frozenRows = cycle === 0 ? await tableRows(page) : null;
      const frozenTip = await tip(page);
      await page.evaluate(async ({ from }) => {
        for (let x = from; x < from + 10; x++) {
          window.charts[0]!.append([{ x, s: 'North', y: x * 10 }, { x, s: 'South', y: x * 10 + 5 }], { keep: 4 });
        }
        await window.charts[0]!.__bench.ready();
      }, { from: next });
      next += 10;
      await settle(page);
      expect(await page.evaluate(() => ({ scene: document.querySelector('#chart .axylo-scene')?.innerHTML, describe: window.charts[0]!.__bench.describe() }))).toEqual(frozen);
      expect(frozen.describe.series[0]).toMatchObject({ oldestX: lo, newestX: lo + 3 });
      const afterTip = await tip(page);
      expect({ title: afterTip.title, rows: afterTip.rows, pinned: afterTip.pinned }).toEqual({
        title: frozenTip.title, rows: frozenTip.rows, pinned: frozenTip.pinned,
      });
      expect(Math.abs((afterTip.box?.x ?? 0) - (frozenTip.box?.x ?? 0))).toBeLessThan(0.5);
      expect(Math.abs((afterTip.box?.y ?? 0) - (frozenTip.box?.y ?? 0))).toBeLessThan(0.5);
      expect(await valueText(page)).toBe(pinnedText);
      if (frozenRows) {
        expect(frozenRows.map(r => r[0])).toEqual(['0', '1', '2', '3']);
        expect(await tableRows(page)).toEqual(frozenRows);
      }
      await page.locator(proxy).focus();
      await page.keyboard.press('Enter');
      await settle(page);
      expect((await selected(page)).at(-1)).toMatchObject({ series: 'North', x: lo + 1, y: (lo + 1) * 10, row: { x: lo + 1, s: 'North', y: (lo + 1) * 10 } });
      await toolbarButton(page, 'Resume').focus();
      await page.keyboard.press('Enter');
      await settle(page);
      const resumed = await page.evaluate(() => window.charts[0]!.__bench.describe().series[0]!);
      expect(resumed).toMatchObject({ oldestX: next - 4, newestX: next - 1 });
      expect((await tip(page)).pinned).toBe(false);
      if (cycle === 0) {
        expect((await tableRows(page)).map(r => r[0])).toEqual(['10', '11', '12', '13']);
        await closeTable(page);
      }
      expect(await page.locator('#chart [role="toolbar"] [tabindex="0"]').count()).toBe(1);
      const now = { document: await count('document'), window: await count('window') };
      if (cycleCounts) expect(now).toEqual(cycleCounts);
      cycleCounts = now;
    }
    await page.evaluate(() => window.charts[0]!.destroy());
    await frames(page, 2);
    expect({ document: await count('document'), window: await count('window') }).toEqual(baseline);
    await cdp.detach();
    expect(await closePage(page)).toEqual([]);
  });
});

describe('seam 5: destroy() in the middle of things', () => {
  it('mid-hover, mid-Select range and during an in-flight resize and font load leave nothing behind', async () => {
    requireEngineFeature(['chromium'], 'the registered event listeners are read through the Chrome DevTools protocol (DOMDebugger.getEventListeners)');
    const page = await chartPage();
    const consoleErrors: string[] = [];
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    const { cdp, count } = await listenerCounter(page);
    const baseline = { document: await count('document'), window: await count('window') };
    const LINE = { title: 'D', data: Array.from({ length: 11 }, (_, x) => ({ x, y: x })), x: 'x', y: 'y' };
    await create(page, 'line', LINE);
    const p = await plotBox(page);
    await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
    await page.locator('#chart .axylo-tooltip').waitFor({ state: 'visible' });
    await page.waitForTimeout(300);
    await page.locator('#chart [role="toolbar"] button[title="Select range"]').click();
    await settle(page);
    await page.mouse.move(p.x + p.width / 4, p.y + p.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await settle(page);
    expect(await page.locator('#chart .axylo-selection').isVisible()).toBe(true);
    const a = await page.evaluate(async () => {
      const chart = window.charts[0]!;
      chart.destroy();
      const stages = chart.__dev.stages();
      for (const target of [document, window]) {
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        for (const type of ['pointermove', 'pointerup', 'click']) target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: 200, clientY: 200 }));
      }
      await window.nextFrames(2);
      return { stages, later: chart.__dev.stages(), children: document.getElementById('chart')!.childElementCount };
    });
    expect(a.later).toEqual(a.stages);
    expect(a.children).toBe(0);
    const font = fs.readFileSync('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf').toString('base64');
    const b = await page.evaluate(async ({ f, LINE }) => {
      const el = document.getElementById('chart')!;
      const chart = window.Axylo.line!(el, LINE);
      window.charts = [chart];
      el.style.width = '310px';
      const bytes = Uint8Array.from(atob(f), c => c.charCodeAt(0));
      const loading = new FontFace('LateDestroy', bytes).load().then(face => { document.fonts.add(face); });
      chart.destroy();
      const stages = chart.__dev.stages();
      await loading;
      await document.fonts.ready;
      await window.nextFrames(3);
      return { stages, later: chart.__dev.stages(), children: el.childElementCount };
    }, { f: font, LINE });
    expect(b.later.draw).toBe(b.stages.draw);
    expect(b.later.layout).toBe(b.stages.layout);
    expect(b.children).toBe(0);
    expect(await page.locator('.axylo-tooltip').count()).toBe(0);
    expect(await page.locator('.axylo-selection').count()).toBe(0);
    expect({ document: await count('document'), window: await count('window') }).toEqual(baseline);
    await cdp.detach();
    expect(consoleErrors).toEqual([]);
    expect(await closePage(page)).toEqual([]);
  });
});
