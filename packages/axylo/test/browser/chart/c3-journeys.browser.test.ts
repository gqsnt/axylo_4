/**
 * Cycle C3.3 real-Chrome browser regressions for C3.2 audit findings:
 * - F-A11Y-1: blank title / empty labelledBy heading falls back and never leaves figure unnamed
 * - F-A11Y-2: all-zero donut focused in slice-list transfers focus & slice B identity to slider when plot becomes ready
 * - F-A11Y-3: all-omitted explicit-bin histogram omits "See table" referral; compact dirty error keeps omission sentence
 * - F-A11Y-4: passive multipage table refresh preserves unchanged <tr> DOM node identity under AT cursor
 * - F-RESP-3 & F-RESP-4: touch re-tap on pinned datum dismisses pin; 750ms slow tap still activates readout
 * - F-RESP-6: compact 24x16 lower bound renders cleanly with zero Tab stops and no pointer capture
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { start, stop } from '../harness';
import { chartPage, closePage } from './util';
import { create, frames, plotBox, settle, tip } from './final-util';

beforeAll(start);
afterAll(stop);

describe('C3.3 accessibility & responsive/touch browser regressions', () => {
  it('F-A11Y-1: empty labelledBy heading falls back to authored title or generated name + AX140', async () => {
    const page = await chartPage();
    try {
      await page.evaluate(async () => {
        const heading = document.createElement('h2');
        heading.id = 'blank-heading';
        heading.textContent = '   ';
        document.body.prepend(heading);
        const c1 = window.Axylo.line!('#chart', {
          title: 'Fallback Title', labelledBy: 'blank-heading',
          data: [{ x: 1, y: 10 }, { x: 2, y: 20 }], x: 'x', y: 'y',
        });
        window.charts.push(c1);
        await c1.__bench.ready();
      });
      await settle(page);
      const fallback = await page.evaluate(() => {
        const fig = document.querySelector('#chart figure')!;
        const refId = fig.getAttribute('aria-labelledby');
        const label = fig.getAttribute('aria-label');
        const titleEl = refId ? document.getElementById(refId) : null;
        return { refId, label, resolvedText: titleEl?.textContent?.trim() ?? null };
      });
      expect(fallback.refId).not.toBe('blank-heading');
      expect(fallback.label ?? fallback.resolvedText).toBe('Fallback Title');

      await page.evaluate(async () => {
        window.charts[0]!.update({ title: '   ', labelledBy: 'blank-heading' });
        await window.charts[0]!.__bench.ready();
      });
      await settle(page);
      const result = await page.evaluate(() => ({
        label: document.querySelector('#chart figure')!.getAttribute('aria-label') ?? '',
        labelledBy: document.querySelector('#chart figure')!.getAttribute('aria-labelledby'),
        hasAX140: window.charts[0]!.diagnostics.some(d => d.code === 'AX140'),
      }));
      expect(result.labelledBy).toBeNull();
      expect(result.label.trim().length).toBeGreaterThan(0);
      expect(result.hasAX140).toBe(true);
      expect(await closePage(page)).toEqual([]);
    } catch (error) {
      await closePage(page).catch(() => {});
      throw error;
    }
  });

  it('F-A11Y-2: all-zero donut focused on slice B transfers focus & slice B identity to slider when B becomes positive', async () => {
    const page = await chartPage();
    try {
      await page.evaluate(() => { document.getElementById('after')!.style.display = 'block'; });
      await create(page, 'donut', {
        title: 'Slices', data: [{ l: 'A', v: 0 }, { l: 'B', v: 0 }, { l: 'C', v: 0 }],
        label: 'l', value: 'v',
      });
      const sliceBtns = page.locator('#chart .axylo-legend-choice');
      expect(await sliceBtns.count()).toBe(3);
      await sliceBtns.nth(0).focus();
      await page.keyboard.press('ArrowRight');
      expect(await page.evaluate(() => document.activeElement?.textContent ?? '')).toContain('B');

      await page.evaluate(async () => {
        window.charts[0]!.update({ data: [{ l: 'A', v: 1 }, { l: 'B', v: 3 }, { l: 'C', v: 1 }] });
        await window.charts[0]!.__bench.ready();
      });
      await settle(page);
      expect(await page.evaluate(() => document.activeElement?.classList.contains('axylo-proxy') ?? false)).toBe(true);
      const vt = (await page.locator('#chart .axylo-proxy').getAttribute('aria-valuetext')) ?? '';
      expect(vt).toContain('B');
      expect(vt).toContain('60%');
      await page.keyboard.press('ArrowRight');
      expect((await page.locator('#chart .axylo-proxy').getAttribute('aria-valuetext')) ?? '').toContain('C');
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('#chart [role="toolbar"]'))).toBe(true);
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.id)).toBe('after');

      // Same transition when legend is hidden in the same update: focus still lands on proxy with slice B.
      await page.evaluate(async () => {
        window.charts[0]!.update({ legend: 'right', data: [{ l: 'A', v: 0 }, { l: 'B', v: 0 }, { l: 'C', v: 0 }] });
        await window.charts[0]!.__bench.ready();
      });
      await settle(page);
      await sliceBtns.nth(0).focus();
      await page.keyboard.press('ArrowRight');
      expect(await page.evaluate(() => document.activeElement?.textContent ?? '')).toContain('B');
      await page.evaluate(async () => {
        window.charts[0]!.update({ legend: false, data: [{ l: 'A', v: 1 }, { l: 'B', v: 3 }, { l: 'C', v: 1 }] });
        await window.charts[0]!.__bench.ready();
      });
      await settle(page);
      expect(await page.evaluate(() => document.activeElement?.classList.contains('axylo-proxy') ?? false)).toBe(true);
      const vtNoLegend = (await page.locator('#chart .axylo-proxy').getAttribute('aria-valuetext')) ?? '';
      expect(vtNoLegend).toContain('B');
      expect(vtNoLegend).toContain('60%');
      expect(await closePage(page)).toEqual([]);
    } catch (error) {
      await closePage(page).catch(() => {});
      throw error;
    }
  });

  it('F-A11Y-3: all-omitted explicit-bin histogram omits See table; compact dirty error retains omission sentence', async () => {
    const page = await chartPage();
    try {
      await create(page, 'histogram', {
        title: 'Out of range', data: [{ v: 10 }, { v: 11 }], x: 'v', bins: [0, 1, 2],
      });
      const histText = await page.evaluate(() => ({
        note: document.querySelector('#chart .axylo-note')?.textContent ?? '',
        summary: document.querySelector('#chart .axylo-summary')?.textContent ?? '',
        hasTableBtn: [...document.querySelectorAll('#chart button')].some(b => /table/i.test(b.textContent ?? '')),
      }));
      expect(histText.hasTableBtn).toBe(false);
      expect(histText.note).toMatch(/Values not shown: 2/i);
      expect(histText.note).not.toMatch(/See table/i);
      expect(histText.summary).not.toMatch(/See table/i);

      await page.evaluate(async () => {
        window.charts[0]!.destroy();
        window.charts.length = 0;
        document.documentElement.lang = 'de';
        const c = window.Axylo.line!('#chart', {
          title: 'Compact Err', compact: true, state: { error: 'Abfrage fehlgeschlagen.' },
          data: [{ x: 1, y: 10 }, { x: 2, y: NaN }, { x: 3, y: 30 }], x: 'x', y: 'y',
        });
        window.charts.push(c);
        await c.__bench.ready();
      });
      await settle(page);
      const compactDesc = await page.evaluate(() => {
        const img = document.querySelector('#chart [role="img"]');
        const descId = img?.getAttribute('aria-describedby') ?? '';
        const descEl = descId ? document.getElementById(descId) : null;
        const runs = descEl ? [...descEl.querySelectorAll('span')].map(s => ({ text: s.textContent ?? '', lang: s.getAttribute('lang') })) : [];
        return {
          text: descEl?.textContent ?? '',
          descLang: descEl?.getAttribute('lang') ?? null,
          runs,
        };
      });
      expect(compactDesc.text).toContain('Abfrage fehlgeschlagen.');
      expect(compactDesc.text).toMatch(/Values not shown: 1/i);
      expect(compactDesc.descLang).toBeNull();
      expect(compactDesc.runs).toHaveLength(2);
      expect(compactDesc.runs[0]).toEqual({ text: 'Abfrage fehlgeschlagen. ', lang: null });
      expect(compactDesc.runs[1]?.lang).toBe('en');
      expect(compactDesc.runs[1]?.text).toMatch(/Values not shown: 1/i);
      expect(await closePage(page)).toEqual([]);
    } catch (error) {
      await closePage(page).catch(() => {});
      throw error;
    }
  });

  it('F-A11Y-4: passive multipage table refresh preserves unchanged <tr> DOM node identity on append outside current page', async () => {
    const page = await chartPage();
    try {
      const rows = Array.from({ length: 105 }, (_, i) => ({ x: i, y: i * 10 }));
      await create(page, 'line', { title: 'Paged', data: rows, x: 'x', y: 'y' });
      await page.getByRole('button', { name: 'View as table' }).click();
      await settle(page);
      await page.evaluate(() => {
        const trs = [...document.querySelectorAll('#chart table tbody tr')];
        (window as unknown as { __firstRows: Element[] }).__firstRows = trs.slice(0, 5);
        (window as unknown as { __liveChanges: number }).__liveChanges = 0;
        const live = document.querySelector('#chart [aria-live]');
        if (live) {
          new MutationObserver(() => { (window as unknown as { __liveChanges: number }).__liveChanges++; })
            .observe(live, { childList: true, characterData: true, subtree: true });
        }
      });
      await page.evaluate(async () => {
        window.charts[0]!.append([{ x: 105, y: 1050 }, { x: 106, y: 1060 }]);
        await window.charts[0]!.__bench.ready();
      });
      await settle(page);
      const check = await page.evaluate(() => {
        const trs = [...document.querySelectorAll('#chart table tbody tr')];
        const prev = (window as unknown as { __firstRows: Element[] }).__firstRows;
        return {
          preserved: prev.length === 5 && prev.every((el, i) => trs[i] === el),
          liveChanges: (window as unknown as { __liveChanges: number }).__liveChanges,
        };
      });
      expect(check.preserved).toBe(true);
      expect(check.liveChanges).toBe(0);
      expect(await closePage(page)).toEqual([]);
    } catch (error) {
      await closePage(page).catch(() => {});
      throw error;
    }
  });

  it('F-RESP-3 & F-RESP-4: slow touch tap (700ms) pins tooltip, and second touch tap on the same datum dismisses pin', async () => {
    const page = await chartPage();
    try {
      await create(page, 'line', {
        title: 'Touch', data: Array.from({ length: 5 }, (_, x) => ({ x, y: x * 10 })), x: 'x', y: 'y',
      });
      const p = await plotBox(page);
      const pt = { x: p.x + p.width / 2, y: p.y + p.height / 2 };
      const touchTap = async (holdMs: number) => {
        await page.evaluate(async ({ x, y, holdMs }) => {
          const target = document.elementFromPoint(x, y) ?? document.querySelector('#chart .axylo-plot')!;
          target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'touch', clientX: x, clientY: y }));
          if (holdMs > 0) await new Promise(r => setTimeout(r, holdMs));
          target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'touch', clientX: x, clientY: y }));
        }, { x: pt.x, y: pt.y, holdMs });
        await settle(page);
      };
      // Slow 700ms tap (previously silently dropped at 500ms) opens pinned tooltip on x = 2.
      await touchTap(700);
      const pinned = await tip(page);
      expect(pinned.pinned).toBe(true);
      expect(pinned.title).toBe('2');
      // Second touch tap on the same pinned datum dismisses the pin.
      await touchTap(50);
      const after = await tip(page);
      expect(after.pinned).toBe(false);
      expect(after.title).toBeNull();
      expect(await closePage(page)).toEqual([]);
    } catch (error) {
      await closePage(page).catch(() => {});
      throw error;
    }
  });

  it('F-RESP-6: compact chart at 24x16 lower bound renders cleanly with zero Tab stops and no pointer capture', async () => {
    const page = await chartPage({ css: '#chart { width: 24px; height: 16px; }' });
    try {
      await page.evaluate(async () => {
        const counts = { hover: 0, select: 0 };
        (window as unknown as { __c3Counts: typeof counts }).__c3Counts = counts;
        const c = window.Axylo.line!('#chart', {
          title: 'Spark', compact: true, data: Array.from({ length: 6 }, (_, x) => ({ x, y: (x % 3) + 1 })), x: 'x', y: 'y',
          onHover: () => { counts.hover++; },
          onSelect: () => { counts.select++; },
        });
        window.charts.push(c);
        await c.__bench.ready();
      });
      await frames(page, 2);
      const box = await page.locator('#chart').boundingBox();
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await settle(page);
      const info = await page.evaluate(() => ({
        imgCount: document.querySelectorAll('#chart [role="img"]').length,
        tabStops: document.querySelectorAll('#chart [tabindex]:not([tabindex="-1"]), #chart button, #chart input').length,
        hasPath: document.querySelectorAll('#chart svg path').length > 0,
        tooltipVisible: !!document.querySelector('#chart .axylo-tooltip:not([hidden])'),
        counts: (window as unknown as { __c3Counts: { hover: number; select: number } }).__c3Counts,
      }));
      expect(info.imgCount).toBe(1);
      expect(info.tabStops).toBe(0);
      expect(info.hasPath).toBe(true);
      expect(info.tooltipVisible).toBe(false);
      expect(info.counts).toEqual({ hover: 0, select: 0 });
      expect(await closePage(page)).toEqual([]);
    } catch (error) {
      await closePage(page).catch(() => {});
      throw error;
    }
  });
});
