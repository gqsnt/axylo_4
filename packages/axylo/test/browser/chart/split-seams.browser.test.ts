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
import { create, frames, inside, lastHover, nearestInside, plotBox, recordEvents, selected, settle, TALL, tip, walk } from './final-util';

beforeAll(start);
afterAll(stop);

const proxy = '#chart .axylo-proxy';
const valueText = (page: Page) => page.locator(proxy).getAttribute('aria-valuetext');
const activeIsProxy = (page: Page) => page.evaluate(() => document.activeElement?.classList.contains('axylo-proxy') ?? false);
const toolbarButton = (page: Page, name: string) => page.locator('#chart [role="toolbar"] button', { hasText: name });
const escapeRe = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasToken = (text: string, token: string) => new RegExp(`(?:^|[^\\d\\w%])${escapeRe(token)}(?:$|[^\\d\\w%])`).test(text);

/** Structured per-cell text of each floating tooltip row (never concatenating label+value spans). */
async function tipRowCells(page: Page): Promise<string[][]> {
  return page.evaluate(() => [...document.querySelectorAll('#chart .axylo-tooltip .axylo-tooltip-row')]
    .map(row => [...row.children].map(cell => (cell.textContent ?? '').trim()).filter(Boolean)));
}

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

/** Walks Tab from the focused proxy: A2 allows at most two stops (proxy -> toolbar -> #after). */
async function expectTabExitsToAfter(page: Page): Promise<void> {
  const classify = () => page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return 'none';
    if (el.id === 'after') return 'after';
    if (el.closest('#chart [role="toolbar"]')) return 'toolbar';
    if (document.getElementById('chart')!.contains(el)) return `chart:${el.className || el.tagName}`;
    return `outside:${el.tagName}`;
  });
  await page.keyboard.press('Tab');
  expect(await classify()).toBe('toolbar');
  await page.keyboard.press('Tab');
  expect(await classify()).toBe('after');
}

describe('seam 1: strict: true rollback leaves the drawn chart as it was', () => {
  it('a rejected update() and a rejected append() throw AX103 and change no mark, label, title or tooltip; select still works', async () => {
    const page = await chartPage();
    try {
      await create(page, 'line', { title: 'Good', strict: true, data: Array.from({ length: 5 }, (_, x) => ({ x, y: x * 10 })), x: 'x', y: 'y' });
      await recordEvents(page);
      const p = await plotBox(page);
      // x = 0..4 span the plot; x = 2 is its middle.
      const middle = { x: p.x + p.width / 2, y: p.y + p.height / 2 };
      await page.mouse.move(middle.x, middle.y);
      await page.locator('#chart .axylo-tooltip').waitFor({ state: 'visible' });
      await settle(page);
      const shown = await tip(page);
      expect(shown.title).toBe('2');
      expect((await tipRowCells(page)).flat()).toContain('20');
      const snapshot = () => page.evaluate(() => ({
        scene: document.querySelector('#chart .axylo-scene')?.innerHTML ?? null,
        markPaths: document.querySelectorAll('#chart .axylo-scene path, #chart .axylo-scene line, #chart .axylo-scene rect, #chart .axylo-scene circle').length,
        labels: [...document.querySelectorAll('#chart .axylo-label, #chart svg text')].map(l => (l.textContent ?? '').trim()).filter(Boolean),
        title: document.querySelector('#chart .axylo-title')?.textContent ?? null,
        tooltip: (() => { const t = document.querySelector('#chart .axylo-tooltip') as HTMLElement | null; return t && !t.hidden ? t.textContent : null; })(),
      }));
      const before = await snapshot();
      expect(before.scene).toBeTruthy();
      expect(before.markPaths).toBeGreaterThan(0);
      expect(before.labels.length).toBeGreaterThan(0);
      expect(before.title).toBe('Good');
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
      const beforeSel = (await selected(page)).length;
      await page.mouse.click(middle.x, middle.y);
      await settle(page);
      const afterSel = await selected(page);
      expect(afterSel.length).toBe(beforeSel + 1);
      expect(afterSel.at(-1)).toMatchObject({ x: 2, y: 20 });
      expect(await closePage(page)).toEqual([]);
    } catch (error) {
      await closePage(page).catch(() => {});
      throw error;
    }
  });
});

describe('seam 2: keyboard focus survives zoom(), update({ data }) and a resize across the readout threshold', () => {
  it('(a) zoom() away from the focused datum and replacing the data keep focus on the proxy; Tab leaves through toolbar to #after', async () => {
    const page = await chartPage();
    try {
      // chartPage hides the page's #after button; show it so Tab has a deterministic target after the chart.
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
      const selBefore = (await selected(page)).length;
      await page.keyboard.press('Enter');
      await settle(page);
      const selAfter = await selected(page);
      expect(selAfter.length).toBe(selBefore + 1);
      expect(selAfter.at(-1)).toMatchObject({ x, y: x });
      await page.evaluate(async () => {
        window.charts[0]!.update({ data: [{ x: 100, y: 1 }, { x: 101, y: 2 }, { x: 102, y: 3 }] });
        await window.charts[0]!.__bench.ready();
      });
      await settle(page);
      expect(await activeIsProxy(page)).toBe(true);
      const replaced = (await valueText(page))!;
      expect(replaced.startsWith('100')).toBe(true);
      expect(replaced.endsWith('Point 1 of 3')).toBe(true);
      await expectTabExitsToAfter(page);
      expect(await closePage(page)).toEqual([]);
    } catch (error) {
      await closePage(page).catch(() => {});
      throw error;
    }
  });

  it('(b) 640 px → 220 px → 640 px keeps focus and the datum; floating tooltip ↔ readout strip; Tab leaves through toolbar to #after', async () => {
    const page = await chartPage();
    try {
      await page.evaluate(() => {
        document.getElementById('chart')!.style.width = '640px';
        document.getElementById('after')!.style.display = 'block';
      });
      await create(page, 'line', { title: 'Resize', data: Array.from({ length: 5 }, (_, x) => ({ x, y: x * 10 })), x: 'x', y: 'y' });
      await page.locator(proxy).focus();
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await settle(page);
      const text = (await valueText(page))!;
      expect(text).toMatch(/^2\b/);
      expect((await tip(page)).title).toBe('2');
      for (const width of ['220px', '640px']) {
        await page.evaluate(w => { document.getElementById('chart')!.style.width = w; }, width);
        await settle(page);
        await settle(page);
        expect(await activeIsProxy(page)).toBe(true);
        expect(await valueText(page)).toBe(text);
        if (width === '220px') {
          expect(await page.locator('#chart .axylo-tooltip').isVisible()).toBe(false);
          const strip = page.locator('#chart .axylo-readout');
          expect(await strip.isVisible()).toBe(true);
          const stripText = (await strip.textContent()) ?? '';
          expect(hasToken(stripText, '2')).toBe(true);
          expect(hasToken(stripText, '20')).toBe(true);
        } else {
          const shown = await tip(page);
          expect(shown.title).toBe('2');
          expect((await tipRowCells(page)).flat()).toContain('20');
        }
      }
      await expectTabExitsToAfter(page);
      expect(await closePage(page)).toEqual([]);
    } catch (error) {
      await closePage(page).catch(() => {});
      throw error;
    }
  });
});

describe('seam 3: one frame behind pointer, keyboard, tooltip, events and table', () => {
  const intervals = ['0–2', '2–5', '5–10'];
  const midpoints = [1, 3.5, 7.5];

  async function fiveWay(page: Page, values: number[], formatted: string[], domain: readonly [number, number] = [0, 10]): Promise<void> {
    const p = await plotBox(page);
    const [dLo, dHi] = domain;
    const span = dHi - dLo;
    // Probe a point inside each bin that lies within the visible domain.
    const probeX = [
      Math.max(dLo + span * 0.03, Math.min(2 - 0.1, 1)),
      3.5,
      Math.min(dHi - span * 0.03, Math.max(5 + 0.1, 7.5)),
    ];
    for (let i = 0; i < 3; i++) {
      await page.mouse.move(p.x + ((probeX[i]! - dLo) / span) * p.width, p.y + p.height - 3);
      await settle(page);
      const shown = await tip(page);
      expect(shown.title).toBe(intervals[i]);
      expect((await tipRowCells(page)).flat()).toContain(formatted[i]);
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
      expect(hasToken(text, formatted[i]!)).toBe(true);
      expect(text.endsWith(`Point ${i + 1} of 3`)).toBe(true);
      const selBefore = (await selected(page)).length;
      await page.keyboard.press('Enter');
      await settle(page);
      const selAfter = await selected(page);
      expect(selAfter.length).toBe(selBefore + 1);
      expect(selAfter.at(-1)).toMatchObject({ x: midpoints[i], y: values[i], row: null, index: -1 });
    }
    await page.keyboard.press('Escape');
    await openTable(page);
    expect(await tableRows(page)).toEqual(intervals.map((t, i) => [t, formatted[i]]));
    await closeTable(page);
  }

  it('histogram bins [0, 2, 5, 10] with an empty interior bin agree five ways under count, probability and zoom', async () => {
    const page = await chartPage();
    try {
      await create(page, 'histogram', { title: 'H', data: [{ v: 0 }, { v: 1 }, { v: 5 }, { v: 10 }], x: 'v', bins: [0, 2, 5, 10], normalize: 'count' });
      await recordEvents(page);
      await fiveWay(page, [2, 0, 2], ['2', '0', '2']);
      await page.evaluate(async () => { window.charts[0]!.update({ normalize: 'probability' }); await window.charts[0]!.__bench.ready(); });
      await settle(page);
      await fiveWay(page, [0.5, 0, 0.5], ['50%', '0%', '50%']);
      await page.evaluate(async () => { window.charts[0]!.update({ normalize: 'count' }); await window.charts[0]!.__bench.ready(); });
      await settle(page);
      // Hold normalization fixed at count across the zoom transition so tick and pixel changes come strictly from zoom([1, 8]).
      const xTicks = () => page.evaluate(() => [...document.querySelectorAll('#chart .axylo-label[data-role^="tick-x"]')]
        .map(t => (t.textContent ?? '').trim()).filter(Boolean));
      const xTicksBefore = await xTicks();
      expect(xTicksBefore.length).toBeGreaterThan(0);
      const pBefore = await plotBox(page);
      // 17.14% of plot width is x = 1.71 on unzoomed [0, 10] (bin 0–2), but x = 2.2 on zoomed [1, 8] (empty bin 2–5).
      const distinguishX = pBefore.x + pBefore.width * (1.2 / 7);
      await page.mouse.move(distinguishX, pBefore.y + pBefore.height - 3);
      await settle(page);
      expect((await tip(page)).title).toBe('0–2');
      await page.evaluate(async () => {
        window.charts[0]!.zoom([1, 8]);
        await window.charts[0]!.__bench.ready();
      });
      await settle(page);
      expect(await toolbarButton(page, 'Reset zoom').isVisible()).toBe(true);
      const xTicksAfter = await xTicks();
      expect(xTicksAfter.length).toBeGreaterThan(0);
      expect(xTicksAfter).not.toEqual(xTicksBefore);
      const pAfter = await plotBox(page);
      await page.mouse.move(pAfter.x + pAfter.width * (1.2 / 7), pAfter.y + pAfter.height - 3);
      await settle(page);
      expect((await tip(page)).title).toBe('2–5');
      // Zoom does not rebin (F6): all three bins overlap [1, 8] and agree across all five surfaces.
      await fiveWay(page, [2, 0, 2], ['2', '0', '2'], [1, 8]);
      expect(await closePage(page)).toEqual([]);
    } catch (error) {
      await closePage(page).catch(() => {});
      throw error;
    }
  });

  it('donut cross-check: pointer hover, tooltip, keyboard, select and table agree on slice A', async () => {
    const page = await chartPage();
    try {
      await create(page, 'donut', { title: 'D', data: [{ l: 'A', v: 3 }, { l: 'B', v: 2 }], label: 'l', value: 'v' });
      await recordEvents(page);
      // Pointer hover onto slice A (60% of the ring, starting at -90 deg clockwise -> +18 deg sits in its interior).
      const p = await plotBox(page);
      const cx = p.x + p.width / 2;
      const cy = p.y + p.height / 2;
      const r = Math.min(p.width, p.height) * 0.34;
      const angle = (18 * Math.PI) / 180;
      await page.mouse.move(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
      await settle(page);
      const pointerTip = await tip(page);
      expect(pointerTip.title).toBe('A');
      const pointerCells = (await tipRowCells(page)).flat();
      expect(pointerCells.some(c => hasToken(c, '3'))).toBe(true);
      expect(pointerCells.some(c => hasToken(c, '60%'))).toBe(true);
      expect(await lastHover(page)).toMatchObject({ series: 'A', x: 'A', y: 3 });
      // Move pointer outside, then verify keyboard + select + table agree identically.
      await page.mouse.move(p.x + p.width + 200, p.y - 200);
      await settle(page);
      await page.locator(proxy).focus();
      await page.keyboard.press('Home');
      await settle(page);
      const text = (await valueText(page))!;
      expect(text).toContain('A');
      expect(hasToken(text, '3')).toBe(true);
      expect(hasToken(text, '60%')).toBe(true);
      const shown = await tip(page);
      expect(shown.title).toBe('A');
      const keyCells = (await tipRowCells(page)).flat();
      expect(keyCells.some(c => hasToken(c, '3'))).toBe(true);
      expect(keyCells.some(c => hasToken(c, '60%'))).toBe(true);
      const selBefore = (await selected(page)).length;
      await page.keyboard.press('Enter');
      await settle(page);
      const selAfter = await selected(page);
      expect(selAfter.length).toBe(selBefore + 1);
      expect(selAfter.at(-1)).toMatchObject({ series: 'A', x: 'A', y: 3 });
      expect(await lastHover(page)).toMatchObject({ series: 'A', x: 'A', y: 3 });
      await page.keyboard.press('Escape');
      await openTable(page);
      expect((await tableRows(page))[0]).toEqual(['A', '3', '60%']);
      expect(await closePage(page)).toEqual([]);
    } catch (error) {
      await closePage(page).catch(() => {});
      throw error;
    }
  });
});

describe('seam 4: Pause/Resume through total eviction of the paused window', () => {
  it('paused, pin/select/table stay on the frozen window through total eviction; resumed, they jump, the pin closes, focus recovers, and listeners stay flat', async () => {
    requireEngineFeature(['chromium'], 'the registered event listeners are read through the Chrome DevTools protocol (DOMDebugger.getEventListeners)');
    const page = await chartPage();
    const { cdp, count } = await listenerCounter(page);
    try {
      const baseline = {
        document: await count('document'),
        window: await count('window'),
        fonts: await count('document.fonts'),
      };
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
      let cycleCounts: { document: number; window: number; fonts: number } | null = null;
      // Cycles 0 and 2 exercise the pinned tooltip + paused selection across eviction (table closed);
      // cycle 1 exercises the frozen data table across eviction separately because opening the table closes any pin.
      for (let cycle = 0; cycle < 3; cycle++) {
        const tableCycle = cycle === 1;
        const d = await page.evaluate(() => window.charts[0]!.__bench.describe().series[0]!);
        const lo = d.oldestX;
        const p = await plotBox(page);
        const pinX = p.x + (1 / 3) * p.width;
        await page.locator(proxy).focus();
        await page.keyboard.press('Home');
        await page.keyboard.press('ArrowRight');
        const pinnedText = (await valueText(page))!;
        expect(pinnedText).toMatch(new RegExp(`^${lo + 1}\\b`));
        if (!tableCycle) {
          await page.mouse.move(pinX, p.y + p.height / 2);
          await page.mouse.down();
          await page.mouse.up();
          await settle(page);
          expect((await tip(page)).pinned).toBe(true);
        }
        // Pause from the keyboard so clicking another target cannot end the pin.
        await toolbarButton(page, 'Pause').focus();
        await page.keyboard.press('Enter');
        await settle(page);
        if (tableCycle) await openTable(page);
        const frozen = await page.evaluate(() => ({ scene: document.querySelector('#chart .axylo-scene')?.innerHTML, describe: window.charts[0]!.__bench.describe() }));
        const frozenRows = tableCycle ? await tableRows(page) : null;
        const frozenTip = tableCycle ? null : await tip(page);
        if (frozenTip) expect(frozenTip.pinned).toBe(true);
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
        if (tableCycle) {
          expect(frozenRows!.map(r => r[0])).toEqual([String(lo), String(lo + 1), String(lo + 2), String(lo + 3)]);
          expect(await tableRows(page)).toEqual(frozenRows);
        } else {
          const afterTip = await tip(page);
          expect(afterTip.pinned).toBe(true);
          expect({ title: afterTip.title, rows: afterTip.rows, pinned: afterTip.pinned }).toEqual({
            title: frozenTip!.title, rows: frozenTip!.rows, pinned: true,
          });
          expect(Math.abs((afterTip.box?.x ?? 0) - (frozenTip!.box?.x ?? 0))).toBeLessThan(0.5);
          expect(Math.abs((afterTip.box?.y ?? 0) - (frozenTip!.box?.y ?? 0))).toBeLessThan(0.5);
          // Fresh select event from the pinned tooltip's North row carries the original frozen payload.
          const selBefore = (await selected(page)).length;
          await page.locator('#chart .axylo-tooltip button.axylo-tooltip-choice').first().click();
          await settle(page);
          const selAfter = await selected(page);
          expect(selAfter.length).toBe(selBefore + 1);
          expect(selAfter.at(-1)).toMatchObject({ series: 'North', x: lo + 1, y: (lo + 1) * 10, row: { x: lo + 1, s: 'North', y: (lo + 1) * 10 } });
        }
        expect(await valueText(page)).toBe(pinnedText);
        await toolbarButton(page, 'Resume').focus();
        await page.keyboard.press('Enter');
        await settle(page);
        const resumed = await page.evaluate(() => window.charts[0]!.__bench.describe().series[0]!);
        expect(resumed).toMatchObject({ oldestX: next - 4, newestX: next - 1 });
        expect((await tip(page)).pinned).toBe(false);
        if (tableCycle) {
          expect((await tableRows(page)).map(r => r[0])).toEqual([String(next - 4), String(next - 3), String(next - 2), String(next - 1)]);
          await closeTable(page);
        }
        // Focus recovers cleanly onto the retained post-eviction window after Resume.
        await page.locator(proxy).focus();
        await page.keyboard.press('Home');
        await settle(page);
        const recovered = (await valueText(page))!;
        expect(recovered).toMatch(new RegExp(`^${next - 4}\\b`));
        expect(await page.locator('#chart [role="toolbar"] [tabindex="0"]').count()).toBe(1);
        const now = {
          document: await count('document'),
          window: await count('window'),
          fonts: await count('document.fonts'),
        };
        if (cycleCounts) expect(now).toEqual(cycleCounts);
        cycleCounts = now;
      }
      await page.evaluate(() => window.charts[0]!.destroy());
      await frames(page, 2);
      expect({
        document: await count('document'),
        window: await count('window'),
        fonts: await count('document.fonts'),
      }).toEqual(baseline);
      await cdp.detach();
      expect(await closePage(page)).toEqual([]);
    } catch (error) {
      await cdp.detach().catch(() => {});
      await closePage(page).catch(() => {});
      throw error;
    }
  });
});

describe('seam 5: destroy() in the middle of things', () => {
  it('mid-hover, mid-Select range and during an in-flight resize and font load leave nothing behind', async () => {
    requireEngineFeature(['chromium'], 'the registered event listeners are read through the Chrome DevTools protocol (DOMDebugger.getEventListeners)');
    const page = await chartPage();
    const consoleErrors: string[] = [];
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    const { cdp, count } = await listenerCounter(page);
    try {
      const baseline = {
        document: await count('document'),
        window: await count('window'),
        fonts: await count('document.fonts'),
      };
      const LINE = { title: 'D', data: Array.from({ length: 11 }, (_, x) => ({ x, y: x })), x: 'x', y: 'y' };
      // Instrument ResizeObserver so we verify every observer created by a chart is disconnected on destroy().
      await page.evaluate(() => {
        const NativeRO = window.ResizeObserver;
        const win = window as unknown as { __activeRO?: number };
        win.__activeRO = 0;
        window.ResizeObserver = class TrackedResizeObserver extends NativeRO {
          #live = false;
          override observe(target: Element, options?: ResizeObserverOptions) {
            if (!this.#live) { this.#live = true; win.__activeRO = (win.__activeRO ?? 0) + 1; }
            super.observe(target, options);
          }
          override disconnect() {
            if (this.#live) { this.#live = false; win.__activeRO = (win.__activeRO ?? 0) - 1; }
            super.disconnect();
          }
        };
      });
      // (a1) Destroy while inside a real held hover corridor (rest >= 250ms on Q3, cross into Q4 while Q3 stays held).
      await page.evaluate(() => {
        const el = document.getElementById('chart')!;
        el.style.width = '640px';
        el.style.height = '360px';
      });
      await create(page, 'bar', { title: 'Tall', data: TALL, x: 'x', y: 'y' });
      const p1 = await plotBox(page);
      const at = { x: p1.x + p1.width * (2.5 / 6), y: p1.y + p1.height * 0.6 };
      await page.mouse.move(at.x, at.y);
      await frames(page, 2);
      const firstTip = await tip(page);
      expect(firstTip.title).toBe('Q3');
      await page.waitForTimeout(320);
      const edge = p1.x + p1.width * (3 / 6);
      const target = nearestInside(firstTip.box!, at);
      const over = { x: Math.max(target.x, edge + 4), y: target.y };
      expect(inside(over, firstTip.box!)).toBe(true);
      const heldTitles = await walk(page, at, over, 12, async () => (await tip(page)).title);
      expect(heldTitles.every(t => t === 'Q3')).toBe(true);
      const hoverDestroy = await page.evaluate(async () => {
        const chart = window.charts.at(-1)!;
        chart.destroy();
        const stages = chart.__dev.stages();
        for (const target of [document, window]) {
          for (const type of ['pointermove', 'pointerup', 'click']) target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: 200, clientY: 200 }));
        }
        await window.nextFrames(2);
        return {
          stages,
          later: chart.__dev.stages(),
          children: document.getElementById('chart')!.childElementCount,
          activeRO: (window as unknown as { __activeRO?: number }).__activeRO ?? -1,
        };
      });
      expect(hoverDestroy.later).toEqual(hoverDestroy.stages);
      expect(hoverDestroy.children).toBe(0);
      expect(hoverDestroy.activeRO).toBe(0);
      expect(await page.locator('.axylo-tooltip').count()).toBe(0);
      // (a2) Destroy mid-Select range with a live selection overlay.
      await create(page, 'line', LINE);
      const p2 = await plotBox(page);
      await page.locator('#chart [role="toolbar"] button[title="Select range"]').click();
      await settle(page);
      await page.mouse.move(p2.x + p2.width / 4, p2.y + p2.height / 2);
      await page.mouse.down();
      await page.mouse.up();
      await settle(page);
      expect(await page.locator('#chart .axylo-selection').isVisible()).toBe(true);
      const rangeDestroy = await page.evaluate(async () => {
        const chart = window.charts.at(-1)!;
        chart.destroy();
        const stages = chart.__dev.stages();
        for (const target of [document, window]) {
          target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          for (const type of ['pointermove', 'pointerup', 'click']) target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: 200, clientY: 200 }));
        }
        await window.nextFrames(2);
        return {
          stages,
          later: chart.__dev.stages(),
          children: document.getElementById('chart')!.childElementCount,
          activeRO: (window as unknown as { __activeRO?: number }).__activeRO ?? -1,
        };
      });
      expect(rangeDestroy.later).toEqual(rangeDestroy.stages);
      expect(rangeDestroy.children).toBe(0);
      expect(rangeDestroy.activeRO).toBe(0);
      // (b) Destroy during an in-flight resize and a real registered FontFace load whose loadingdone fires after destroy().
      const font = fs.readFileSync('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf').toString('base64');
      const fontDestroy = await page.evaluate(async ({ f, LINE }) => {
        const el = document.getElementById('chart')!;
        const chart = window.Axylo.line!(el, LINE);
        window.charts = [chart];
        el.style.width = '310px';
        const face = new FontFace('LateDestroy', `url(data:font/ttf;base64,${f})`);
        let loadingDoneFaces = 0;
        const onDone = (e: Event) => { loadingDoneFaces += (e as FontFaceSetLoadEvent).fontfaces?.length ?? 0; };
        document.fonts.addEventListener('loadingdone', onDone);
        document.fonts.add(face);
        const loading = face.load();
        chart.destroy();
        const stages = chart.__dev.stages();
        await loading;
        await document.fonts.ready;
        await window.nextFrames(3);
        document.fonts.removeEventListener('loadingdone', onDone);
        return {
          stages,
          later: chart.__dev.stages(),
          children: el.childElementCount,
          loadingDoneFaces,
          activeRO: (window as unknown as { __activeRO?: number }).__activeRO ?? -1,
        };
      }, { f: font, LINE });
      expect(fontDestroy.loadingDoneFaces).toBeGreaterThan(0);
      expect(fontDestroy.later.draw).toBe(fontDestroy.stages.draw);
      expect(fontDestroy.later.layout).toBe(fontDestroy.stages.layout);
      expect(fontDestroy.children).toBe(0);
      expect(fontDestroy.activeRO).toBe(0);
      expect(await page.locator('.axylo-tooltip').count()).toBe(0);
      expect(await page.locator('.axylo-selection').count()).toBe(0);
      expect({
        document: await count('document'),
        window: await count('window'),
        fonts: await count('document.fonts'),
      }).toEqual(baseline);
      await cdp.detach();
      expect(consoleErrors).toEqual([]);
      expect(await closePage(page)).toEqual([]);
    } catch (error) {
      await cdp.detach().catch(() => {});
      await closePage(page).catch(() => {});
      throw error;
    }
  });
});
