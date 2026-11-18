/**
 * The findings of the interaction and accessibility review (reviews/2026-11-18/impl/wp/core2.review.md), in
 * real Chrome against the built bundle, plus the defects other agents reported against the first fix pass.
 * Accessibility outcomes are read from Chrome's own accessibility tree (CDP) where Chrome exposes them; Chrome
 * does not report `aria-valuetext` there (its "valuetext" property is the number), so value text is read
 * from the attribute the tree is built from and says so.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { ENGINE, requireEngineFeature, start, stop } from '../harness';
import { chartPage, closePage } from './util';

beforeAll(start);
afterAll(stop);

interface Ax { role: string; name: string; value: string; min: number | null; max: number | null; roledescription: string | null; focused: boolean }

/** Chrome's accessibility node for the first element matching `selector`. */
async function ax(page: Page, selector: string): Promise<Ax> {
  requireEngineFeature(['chromium'], 'the computed accessibility tree is read through the Chrome DevTools protocol');
  const client = await page.context().newCDPSession(page);
  try {
    const { root } = await client.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    const { node } = await client.send('DOM.describeNode', { nodeId });
    const { nodes } = await client.send('Accessibility.getPartialAXTree', { backendNodeId: node.backendNodeId, fetchRelatives: false });
    const n = nodes[0]!;
    const prop = (name: string) => n.properties?.find(p => p.name === name)?.value?.value as unknown;
    const num = (v: unknown) => typeof v === 'number' ? v : null;
    return {
      role: String(n.role?.value ?? ''), name: String(n.name?.value ?? ''), value: String(n.value?.value ?? ''),
      min: num(prop('valuemin')), max: num(prop('valuemax')),
      roledescription: prop('roledescription') === undefined ? null : String(prop('roledescription')), focused: prop('focused') === true,
    };
  } finally {
    await client.detach();
  }
}

const valueText = (page: Page) => page.locator('#chart .axylo-proxy').getAttribute('aria-valuetext');
const settle = (page: Page) => page.evaluate(async () => { for (const c of window.charts) await c.__bench.ready(); await window.nextFrames(2); });
const focusedClass = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.className ?? '');
const button = (page: Page, text: string) => page.locator('#chart button', { hasText: text });

async function create(page: Page, kind: string, options: Record<string, unknown>): Promise<void> {
  await page.evaluate(async ({ kind, options }) => {
    const chart = window.Axylo[kind]!('#chart', options);
    window.charts.push(chart);
    await chart.__bench.ready();
    await window.nextFrames(1);
  }, { kind, options });
}

describe('finding 1: paused charts validate every call at once and apply them in call order', () => {
  it('rows appended while paused do not come back after update({ data }); resume shows the replacement and what came after it', async () => {
    const page = await chartPage();
    await create(page, 'scatter', { title: 'P', data: [{ x: 1, y: 1 }], x: 'x', y: 'y' });
    await page.evaluate(() => window.charts[0]!.append([{ x: 2, y: 2 }]));
    await settle(page);
    await button(page, 'Pause').click();
    const result = await page.evaluate(async () => {
      const chart = window.charts[0]!;
      chart.append([{ x: 3, y: 3 }]);
      chart.update({ data: [{ x: 10, y: 1 }, { x: 11, y: 2 }] });
      chart.append([{ x: 12, y: 3 }]);
      chart.zoom([10, 12]);
      await chart.__bench.ready();
      return chart.__bench.describe().series[0];
    });
    await button(page, 'Resume').click();
    await settle(page);
    const after = await page.evaluate(() => window.charts[0]!.__bench.describe().series[0]);
    expect(result).toBeTruthy();
    expect(after).toMatchObject({ points: 3, oldestX: 10, newestX: 12 });
    expect(await closePage(page)).toEqual([]);
  });

  it('a strict chart rejects an invalid paused append at the call; valid batches before and after it survive resume', async () => {
    const page = await chartPage();
    await create(page, 'scatter', { title: 'P', strict: true, data: [{ x: 1, y: 1 }], x: 'x', y: 'y' });
    await page.evaluate(() => window.charts[0]!.append([{ x: 2, y: 2 }]));
    await settle(page);
    await button(page, 'Pause').click();
    const thrown = await page.evaluate(() => {
      const chart = window.charts[0]!;
      chart.append([{ x: 3, y: 3 }]);
      let error = '';
      try { chart.append([{ x: 4, y: NaN }]); } catch (e) { error = String(e); }
      chart.append([{ x: 5, y: 5 }]);
      return error;
    });
    await button(page, 'Resume').click();
    await settle(page);
    const s = await page.evaluate(() => window.charts[0]!.__bench.describe().series[0]!);
    expect(thrown).toMatch(/AX103/);
    expect([s.points, s.oldestX, s.newestX]).toEqual([4, 1, 5]);
    expect(await closePage(page)).toEqual([]);
  });

  it('a rejected strict update({ data }) while paused keeps the rows held back', async () => {
    const page = await chartPage();
    await create(page, 'line', { title: 'P', strict: true, data: [{ x: 1, y: 1 }], x: 'x', y: 'y' });
    await page.evaluate(() => window.charts[0]!.append([{ x: 2, y: 2 }]));
    await settle(page);
    await button(page, 'Pause').click();
    await page.evaluate(() => {
      const chart = window.charts[0]!;
      chart.append([{ x: 3, y: 3 }]);
      try { chart.update({ data: [{ x: 1, y: 'bad' }] }); } catch { /* rejected */ }
    });
    await button(page, 'Resume').click();
    await settle(page);
    const s = await page.evaluate(() => window.charts[0]!.__bench.describe().series[0]!);
    expect([s.points, s.newestX]).toEqual([3, 3]);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('finding 2: focus follows its datum on a sliding category window', () => {
  const rows = ['A', 'B', 'C'].map((c, i) => ({ c, v: i }));

  it('focused on B, appending D with keep 3: the control still says B and Enter selects B', async () => {
    const page = await chartPage();
    await create(page, 'line', { title: 'Cats', data: rows, x: 'c', y: 'v' });
    await page.evaluate(() => { (window as unknown as { selected: unknown[] }).selected = []; window.charts[0]!.on('select', p => (window as unknown as { selected: unknown[] }).selected.push((p as { x: unknown }).x)); });
    await page.focus('#chart .axylo-proxy');
    await page.keyboard.press('ArrowRight');
    expect(await valueText(page)).toMatch(/^B\./);
    await page.evaluate(() => window.charts[0]!.append([{ c: 'D', v: 3 }], { keep: 3 }));
    await settle(page);
    expect(await valueText(page)).toMatch(/^B\./);
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => (window as unknown as { selected: unknown[] }).selected)).toEqual(['B']);
    expect(await closePage(page)).toEqual([]);
  });

  it('focused on A, which the window evicts: the control moves to B by the lookup rule and says so', async () => {
    const page = await chartPage();
    await create(page, 'line', { title: 'Cats', data: rows, x: 'c', y: 'v' });
    await page.focus('#chart .axylo-proxy');
    expect(await valueText(page)).toMatch(/^A\./);
    await page.evaluate(() => window.charts[0]!.append([{ c: 'D', v: 3 }], { keep: 3 }));
    await settle(page);
    expect(await valueText(page)).toMatch(/^B\. .*Point 1 of 3$/);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('finding 3: a zoom into an empty stretch keeps its way back', () => {
  const xs = [0, 1, 3, 4, 96, 98, 99, 100];
  const options = { title: 'Gap', data: xs.map(x => ({ x, y: x })), x: 'x', y: 'y' };

  it('a zoom into [25, 75] shows the empty state, keeps focus on the plot, and "0" returns to everything', async () => {
    const page = await chartPage();
    await create(page, 'line', options);
    await page.focus('#chart .axylo-proxy');
    // The reviewer's window: one centred halving of [0, 100] (the toolbar's Zoom in with no datum chosen).
    await page.evaluate(() => window.charts[0]!.zoom([25, 75]));
    await settle(page);
    expect(await page.evaluate(() => window.charts[0]!.__bench.describe().xDomain)).toEqual([25, 75]);
    expect(await page.locator('#chart .axylo-message').textContent()).toBe('No data to show.');
    expect(await focusedClass(page)).toContain('axylo-proxy');
    expect(await button(page, 'Reset zoom').count()).toBe(1);
    expect(await button(page, 'Zoom out').count()).toBe(1);
    expect(await valueText(page)).toBe('No data to show.');
    await page.keyboard.press('0');
    await settle(page);
    expect(await page.evaluate(() => window.charts[0]!.__bench.describe().xDomain)).toEqual([0, 100]);
    expect(await focusedClass(page)).toContain('axylo-proxy');
    expect(await closePage(page)).toEqual([]);
  });

  it('the Reset control returns to everything from the empty window', async () => {
    const page = await chartPage();
    await create(page, 'line', options);
    await button(page, 'Zoom in').click();
    await settle(page);
    await button(page, 'Reset zoom').click();
    await settle(page);
    expect(await page.evaluate(() => window.charts[0]!.__bench.describe().xDomain)).toEqual([0, 100]);
    expect(await page.locator('#chart .axylo-message').isHidden()).toBe(true);
    expect(await closePage(page)).toEqual([]);
  });

  it('an all-zero donut keeps its legend and the table control; a paused stream that is empty keeps Resume', async () => {
    const page = await chartPage();
    await create(page, 'donut', { title: 'Zero', data: [{ l: 'a', v: 0 }, { l: 'b', v: 0 }], label: 'l', value: 'v' });
    const legend = await page.locator('#chart ul.axylo-legend-list > li').allTextContents();
    expect(legend.length).toBe(2);
    expect(await button(page, 'View as table').count()).toBe(1);
    await page.evaluate(async () => { window.charts.pop()!.destroy(); });
    await create(page, 'line', { title: 'S', data: [{ x: 1, y: 1 }], x: 'x', y: 'y' });
    await page.evaluate(() => window.charts[0]!.append([{ x: 2, y: 2 }]));
    await settle(page);
    await button(page, 'Pause').click();
    await page.evaluate(() => window.charts[0]!.update({ data: [] }));
    await settle(page);
    expect(await button(page, 'Resume').count()).toBe(1);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('finding 4: the focused range matches each displayed revision', () => {
  it('focused on a one-point chart, an append raises the maximum and updates the position text', async () => {
    const page = await chartPage();
    await create(page, 'line', { title: 'One', data: [{ x: 1, y: 1 }], x: 'x', y: 'y' });
    await page.focus('#chart .axylo-proxy');
    expect((await ax(page, '#chart .axylo-proxy')).max).toBe(0);
    await page.evaluate(() => window.charts[0]!.append([{ x: 2, y: 2 }]));
    await settle(page);
    const node = await ax(page, '#chart .axylo-proxy');
    expect([node.min, node.max, node.value, node.focused]).toEqual([0, 1, '0', true]);
    // Decision 0004, part 2: an append that only changes the count does not rewrite the text; the next
    // move reads the current count.
    expect(await valueText(page)).toMatch(/Point 1 of 1$/);
    await page.keyboard.press('ArrowRight');
    expect(await valueText(page)).toMatch(/Point 2 of 2$/);
    expect(await closePage(page)).toEqual([]);
  });

  it('a locale or unit change under the focused range rewrites its text', async () => {
    const page = await chartPage();
    await create(page, 'line', { title: 'U', data: [{ x: 1, y: 1500 }, { x: 2, y: 2 }], x: 'x', y: { field: 'y', unit: 'ms' } });
    await page.focus('#chart .axylo-proxy');
    expect(await valueText(page)).toContain('1,500 ms');
    await page.evaluate(() => window.charts[0]!.update({ y: { field: 'y', unit: 's' }, locale: 'de-DE' }));
    await settle(page);
    expect(await valueText(page)).toContain('1.500 s');
    expect(await closePage(page)).toEqual([]);
  });
});

describe('the plot as Chrome exposes it (A3)', () => {
  it('a slider named by plotLabel with the plotRole role description, value and bounds from the lookup', async () => {
    const page = await chartPage();
    await create(page, 'bar', { title: 'B', data: ['a', 'b', 'c'].map((x, i) => ({ x, y: i + 1 })), x: 'x', y: 'y' });
    await page.focus('#chart .axylo-proxy');
    await page.keyboard.press('End');
    const node = await ax(page, '#chart .axylo-proxy');
    expect(node).toEqual({ role: 'slider', name: 'Chart plot', value: '2', min: 0, max: 2, roledescription: 'Bar chart', focused: true });
    // Not observable in Chrome's tree (it reports the number as valuetext); the attribute it is built from:
    expect(await valueText(page)).toBe('c. y 3. Point 3 of 3');
    expect(await closePage(page)).toEqual([]);
  });
});

describe('teardown: listeners on the chart\'s own elements', () => {
  it('destroy() removes every listener the chart added to its proxy, plot, tooltip, toolbar and legend', async () => {
    const page = await chartPage();
    const left = await page.evaluate(async () => {
      const live = new Map<EventTarget, number>();
      const add = EventTarget.prototype.addEventListener;
      const remove = EventTarget.prototype.removeEventListener;
      EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, fn: EventListenerOrEventListenerObject | null, o?: boolean | AddEventListenerOptions) {
        if (fn && this instanceof Element) {
          live.set(this, (live.get(this) ?? 0) + 1);
          const signal = typeof o === 'object' ? o.signal : undefined;
          signal?.addEventListener('abort', () => live.set(this, (live.get(this) ?? 1) - 1));
        }
        return add.call(this, type, fn, o);
      } as typeof EventTarget.prototype.addEventListener;
      EventTarget.prototype.removeEventListener = function (this: EventTarget, type: string, fn: EventListenerOrEventListenerObject | null, o?: boolean | EventListenerOptions) {
        if (fn && this instanceof Element && live.has(this)) live.set(this, live.get(this)! - 1);
        return remove.call(this, type, fn, o);
      } as typeof EventTarget.prototype.removeEventListener;
      const data = [1, 2].flatMap(x => [{ x, s: 'a', y: 1 }, { x, s: 'b', y: 2 }]);
      const chart = window.Axylo.line!('#chart', { title: 'L', data, x: 'x', y: 'y', series: 's' });
      await chart.__bench.ready();
      chart.append([{ x: 3, s: 'a', y: 3 }]);
      await chart.__bench.ready();
      (document.querySelector('#chart .axylo-toolbar button') as HTMLElement).click();
      await chart.__bench.ready();
      chart.destroy();
      return [...live].filter(([, n]) => n > 0).map(([el]) => (el as Element).className || (el as Element).nodeName);
    });
    expect(left).toEqual([]);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('the tooltip stays clear of the pointer and the click meant for the plot (I1, WCAG 1.4.13)', () => {
  it('a hovered tooltip takes no pointer events; a click on the plot selects and pins the datum under the pointer', async () => {
    // Decision 0004 revision 2, rules 3 and 4 (revision 1 kept the tooltip clear of the pointer instead).
    const page = await chartPage();
    await create(page, 'line', { title: 'E', data: Array.from({ length: 20 }, (_, i) => ({ x: i, y: i })), x: 'x', y: 'y' });
    await page.evaluate(() => { (window as unknown as { selected: unknown[] }).selected = []; window.charts[0]!.on('select', p => (window as unknown as { selected: unknown[] }).selected.push((p as { x: unknown }).x)); });
    const box = (await page.locator('#chart .axylo-proxy').boundingBox())!;
    const expected: number[] = [];
    const title = () => page.locator('#chart .axylo-tooltip .axylo-tooltip-title').textContent();
    for (const share of [0.12, 0.37, 0.52, 0.81]) {
      const x = box.x + share * box.width;
      const y = box.y + box.height / 2;
      await page.keyboard.press('Escape');
      await page.mouse.move(x, y);
      const nearest = Math.round(share * 19);
      if (expected.length === 0) {
        // Hovered: text that the pointer passes through.
        expect(await page.locator('#chart .axylo-tooltip').evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none');
        expect((await title())?.trim()).toBe(String(nearest));
      }
      await page.mouse.down();
      await page.mouse.up();
      // Pinned at the clicked datum, taking events.
      expect((await title())?.trim(), `share ${share}`).toBe(String(nearest));
      expect(await page.locator('#chart .axylo-tooltip').evaluate(el => getComputedStyle(el).pointerEvents)).toBe('auto');
      expected.push(nearest);
    }
    expect(await page.evaluate(() => (window as unknown as { selected: unknown[] }).selected)).toEqual(expected);
    expect(await closePage(page)).toEqual([]);
  });

  it('in a card that clips its content, a floating tooltip stays inside the card; otherwise the readout mode the layout decided applies (strip, or none)', async () => {
    const page = await chartPage({ css: '#card { width: 360px; height: 260px; overflow: hidden; margin-top: 300px; } #card #chart { width: 360px; height: 260px; }' });
    await page.evaluate(() => {
      const card = Object.assign(document.createElement('div'), { id: 'card' });
      const chart = document.getElementById('chart')!;
      chart.replaceWith(card);
      card.appendChild(chart);
    });
    const data = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].flatMap(s => [0, 1, 2].map(x => ({ x, s, y: x + s.charCodeAt(0) })));
    await create(page, 'line', { title: 'Clipped', data, x: 'x', y: 'y', series: 's' });
    const box = (await page.locator('#chart .axylo-proxy').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const card = (await page.locator('#card').boundingBox())!;
    const tip = await page.locator('#chart .axylo-tooltip').boundingBox();
    if (tip) {
      expect(tip.x).toBeGreaterThanOrEqual(card.x);
      expect(tip.y).toBeGreaterThanOrEqual(card.y);
      expect(tip.x + tip.width).toBeLessThanOrEqual(card.x + card.width + 0.5);
      expect(tip.y + tip.height).toBeLessThanOrEqual(card.y + card.height + 0.5);
    } else if (await page.evaluate(() => document.querySelector('#chart figure')!.classList.contains('axylo-readout-mode'))) {
      expect(await page.locator('#chart .axylo-readout').isVisible()).toBe(true);
    } else {
      // Decision 0004 revision 3, rule 5: a plot under 140 px that the strip would leave under L8's 80 px has
      // no readout at all (the controller's layout decides; this plot is about 97 px high) and never floats.
      expect(box.height).toBeLessThan(140);
      expect(await page.locator('#chart .axylo-readout').isVisible()).toBe(false);
    }
    expect(await closePage(page)).toEqual([]);
  });
});

describe('single-pointer equivalents (WCAG 2.5.1, 2.5.7; finding 8)', () => {
  it('the window can be moved with clicks alone: a clicked datum becomes the centre of the next Zoom in', async () => {
    const page = await chartPage();
    await create(page, 'line', { title: 'Pan', data: Array.from({ length: 101 }, (_, i) => ({ x: i, y: i % 7 })), x: 'x', y: 'y' });
    const box = (await page.locator('#chart .axylo-proxy').boundingBox())!;
    // Click on x = 80, then Zoom in: the window halves around it, keeping x = 80 where it was (0.8 of the
    // width): 80 − 0.8 × 50 = 40, so [40, 90].
    await page.mouse.move(box.x + 0.8 * box.width, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await button(page, 'Zoom in').click();
    await settle(page);
    expect(await page.evaluate(() => window.charts[0]!.__bench.describe().xDomain)).toEqual([40, 90]);
    expect(await closePage(page)).toEqual([]);
  });

  it('a tap selects the datum it pins', async () => {
    const page = await chartPage({ hasTouch: true });
    await create(page, 'line', { title: 'Tap', data: Array.from({ length: 11 }, (_, i) => ({ x: i, y: i })), x: 'x', y: 'y' });
    await page.evaluate(() => { (window as unknown as { selected: unknown[] }).selected = []; window.charts[0]!.on('select', p => (window as unknown as { selected: unknown[] }).selected.push((p as { x: unknown }).x)); });
    const box = (await page.locator('#chart .axylo-proxy').boundingBox())!;
    await page.touchscreen.tap(box.x + 0.5 * box.width, box.y + box.height / 2);
    expect(await page.evaluate(() => (window as unknown as { selected: unknown[] }).selected)).toEqual([5]);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('the range follows assistive value changes exactly (finding 6)', () => {
  it('Home at the first datum leaves nothing behind: an assistive set to 1 lands on the second datum', async () => {
    const page = await chartPage();
    await create(page, 'line', { title: 'K', data: [0, 1, 2, 3].map(x => ({ x, y: x })), x: 'x', y: 'y' });
    await page.focus('#chart .axylo-proxy');
    await page.keyboard.press('Home');
    await page.evaluate(() => {
      const proxy = document.querySelector('#chart .axylo-proxy') as HTMLInputElement;
      proxy.value = '1';
      proxy.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(await valueText(page)).toMatch(/^1\. .*Point 2 of 4$/);
    // A direct jump from 1 to 3 goes to 3, not "one page".
    await page.evaluate(() => {
      const proxy = document.querySelector('#chart .axylo-proxy') as HTMLInputElement;
      proxy.value = '3';
      proxy.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(await valueText(page)).toMatch(/^3\. .*Point 4 of 4$/);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('zoom controls that can do nothing say so (finding 9)', () => {
  it('two x positions halve once (an attainable minimum), then Zoom in is aria-disabled and does nothing; the page keeps the wheel', async () => {
    // The fifth pass replaced "cannot be zoomed at all" (minimum 200 on a 100-wide axis) with a minimum of at
    // most half the axis (interaction review, part 1 item 9).
    const page = await chartPage();
    await create(page, 'line', { title: 'Z', data: [{ x: 0, y: 0 }, { x: 100, y: 1 }], x: 'x', y: 'y' });
    expect(await button(page, 'Zoom in').getAttribute('aria-disabled')).toBeNull();
    await button(page, 'Zoom in').click();
    await settle(page);
    expect(await page.evaluate(() => window.charts[0]!.__bench.describe().xDomain)).toEqual([25, 75]);
    expect(await button(page, 'Zoom in').getAttribute('aria-disabled')).toBe('true');
    // Playwright will not click an aria-disabled button; a pointer still can.
    await page.evaluate(() => [...document.querySelectorAll('#chart button')].find(b => b.textContent === 'Zoom in')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await settle(page);
    expect(await page.evaluate(() => window.charts[0]!.__bench.describe().xDomain)).toEqual([25, 75]);
    await page.focus('#chart .axylo-proxy');
    const prevented = await page.evaluate(() => {
      const event = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true, clientX: 300, clientY: 200 });
      document.querySelector('#chart .axylo-plot')!.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(prevented).toBe(false);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('a drag cancelled with Escape (finding 10)', () => {
  it('Escape during a drag cancels it and is spent on it: a containing handler does not see it', async () => {
    const page = await chartPage();
    await create(page, 'line', { title: 'D', data: Array.from({ length: 50 }, (_, i) => ({ x: i, y: i })), x: 'x', y: 'y' });
    await page.evaluate(() => {
      (window as unknown as { escapes: number }).escapes = 0;
      document.body.addEventListener('keydown', e => { if (e.key === 'Escape') (window as unknown as { escapes: number }).escapes++; });
    });
    const box = (await page.locator('#chart .axylo-proxy').boundingBox())!;
    await page.mouse.move(box.x + 100, box.y + 50);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 50, { steps: 4 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await settle(page);
    const result = await page.evaluate(() => ({
      escapes: (window as unknown as { escapes: number }).escapes,
      domain: window.charts[0]!.__bench.describe().xDomain,
      selection: (document.querySelector('#chart .axylo-selection') as HTMLElement).hidden,
    }));
    expect(result).toEqual({ escapes: 0, domain: [0, 49], selection: true });
    expect(await closePage(page)).toEqual([]);
  });
});

describe('tooltip persistence and dismissal (finding 13)', () => {
  it('in readout mode (a 220 px tile) the strip can be hovered without closing', async () => {
    // Decision 0004 rule 5: a plot narrower than 240 px has the readout strip under it.
    const page = await chartPage({ css: '#chart { width: 220px; height: 380px; }' });
    const data = ['Organic search', 'Direct traffic', 'Referral partners'].flatMap(s => [0, 1, 2].map(x => ({ x, s, y: x * 1000 })));
    await create(page, 'line', { title: 'Narrow', data, x: 'x', y: 'y', series: 's' });
    const box = (await page.locator('#chart .axylo-proxy').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const readout = page.locator('#chart .axylo-readout');
    expect(await readout.isVisible()).toBe(true);
    const r = (await readout.boundingBox())!;
    const before = await readout.textContent();
    expect(before).toMatch(/Organic search/);
    // Decision 0004 revision 3, rule 3b: after a rest of 250 ms the datum is held along the way to the strip.
    await page.waitForTimeout(300);
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2, { steps: 5 });
    expect(await readout.isVisible()).toBe(true);
    expect(await readout.textContent()).toBe(before);
    expect(await closePage(page)).toEqual([]);
  });

  it('a tooltip dismissed with Escape at A shows again at A after the keyboard moved to B and back', async () => {
    const page = await chartPage();
    await create(page, 'line', { title: 'E', data: [0, 1, 2].map(x => ({ x, y: x })), x: 'x', y: 'y' });
    await page.focus('#chart .axylo-proxy');
    const tip = page.locator('#chart .axylo-tooltip');
    expect(await tip.isVisible()).toBe(true);
    await page.keyboard.press('Escape');
    expect(await tip.isVisible()).toBe(false);
    await page.keyboard.press('ArrowRight');
    expect(await tip.isVisible()).toBe(true);
    await page.keyboard.press('ArrowLeft');
    expect(await tip.isVisible()).toBe(true);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('a selectable tooltip row (finding 8)', () => {
  it('clicking a secondary series row in the tooltip selects that series', async () => {
    const page = await chartPage();
    const data = [0, 1, 2].flatMap(x => [{ x, s: 'a', y: x }, { x, s: 'b', y: x + 10 }]);
    await create(page, 'line', { title: 'Rows', data, x: 'x', y: 'y', series: 's' });
    await page.evaluate(() => { (window as unknown as { selected: unknown[] }).selected = []; window.charts[0]!.on('select', p => (window as unknown as { selected: unknown[] }).selected.push((p as { series: string }).series)); });
    const box = (await page.locator('#chart .axylo-proxy').boundingBox())!;
    // Decision 0004 revision 2, rule 4: a hovered tooltip is text; a click on the plot pins it (and selects
    // the primary series), and the pinned rows are the buttons.
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.locator('#chart .axylo-tooltip button.axylo-tooltip-row', { hasText: 'b' }).click();
    expect(await page.evaluate(() => (window as unknown as { selected: unknown[] }).selected)).toEqual(['a', 'b']);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('a focused donut slice is visible even without an arc (finding 14)', () => {
  it('the zero first slice is marked in the slice list, and the plot ring is drawn inside the plot', async () => {
    const page = await chartPage({ css: '#chart { width: 320px; height: 260px; }' });
    await create(page, 'donut', { title: 'D', data: [{ l: 'Zero', v: 0 }, { l: 'Some', v: 4 }], label: 'l', value: 'v' });
    await page.focus('#before');
    await page.evaluate(() => { (document.getElementById('before') as HTMLElement).style.display = 'block'; });
    await page.focus('#before');
    await page.keyboard.press('Tab');
    const result = await page.evaluate(() => ({
      current: [...document.querySelectorAll('#chart .axylo-legend-list > li.axylo-legend-current')].map(li => li.textContent),
      offset: parseFloat(getComputedStyle(document.querySelector('#chart .axylo-focus-ring')!).outlineOffset),
      ring: getComputedStyle(document.querySelector('#chart .axylo-focus-ring')!).display,
    }));
    expect(result.current.length).toBe(1);
    expect(result.current[0]).toContain('Zero');
    expect(result.ring).toBe('block');
    expect(result.offset).toBeLessThanOrEqual(-2);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('the table takes the plot\'s place (finding 15) and stays quiet while data arrives (finding 16)', () => {
  it('in a fixed card that clips, the open table and its pager are inside the card and nothing below moves', async () => {
    const page = await chartPage({ css: '#chart { height: 260px; overflow: hidden; } #below { height: 20px; }' });
    await page.evaluate(() => document.getElementById('chart')!.after(Object.assign(document.createElement('div'), { id: 'below' })));
    const t0 = Date.UTC(2026, 0, 1);
    await create(page, 'line', { title: 'T', data: Array.from({ length: 250 }, (_, i) => ({ t: t0 + i * 864e5, y: i })), x: { field: 't', type: 'time', timeZone: 'UTC' }, y: 'y' });
    const before = (await page.locator('#below').boundingBox())!;
    await button(page, 'View as table').click();
    await settle(page);
    const card = (await page.locator('#chart').boundingBox())!;
    for (const selector of ['#chart .axylo-table-scroll', '#chart .axylo-pager']) {
      const box = (await page.locator(selector).boundingBox())!;
      expect(box.y, selector).toBeGreaterThanOrEqual(card.y - 0.5);
      expect(box.y + box.height, selector).toBeLessThanOrEqual(card.y + card.height + 0.5);
    }
    expect((await page.locator('#below').boundingBox())!.y).toBe(before.y);
    expect(await closePage(page)).toEqual([]);
  });

  it('appending rows that add a page does not make the open table speak', async () => {
    const page = await chartPage();
    await create(page, 'line', { title: 'T', data: Array.from({ length: 200 }, (_, i) => ({ x: i, y: i })), x: 'x', y: 'y' });
    await button(page, 'View as table').click();
    await settle(page);
    const spoken = await page.evaluate(async () => {
      const status = document.querySelector('#chart .axylo-page')!;
      const heard: string[] = [];
      const observer = new MutationObserver(() => { if (status.getAttribute('aria-live') !== 'off') heard.push(status.textContent ?? ''); });
      observer.observe(status, { childList: true, characterData: true, subtree: true });
      window.charts[0]!.append([{ x: 200, y: 200 }]);
      await window.charts[0]!.__bench.ready();
      await window.nextFrames(2);
      observer.disconnect();
      return { heard, text: status.textContent };
    });
    expect(spoken).toEqual({ heard: [], text: 'Page 1 of 3' });
    expect(await closePage(page)).toEqual([]);
  });
});

describe('focus survives a render (finding 17)', () => {
  it('a focused legend entry keeps focus when the series order changes', async () => {
    const page = await chartPage();
    await create(page, 'line', { title: 'W', data: [1, 2].map(x => ({ x, a: x, b: -x })), x: 'x', y: ['a', 'b'] });
    await page.locator('#chart .axylo-legend-entry', { hasText: 'b' }).focus();
    await page.evaluate(async () => { window.charts[0]!.update({ y: ['b', 'a'] }); await window.charts[0]!.__bench.ready(); await window.nextFrames(1); });
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('b');
    expect(await closePage(page)).toEqual([]);
  });

  it('turning the table off while the jump field has focus hands focus to the chart, not the page', async () => {
    const page = await chartPage();
    await create(page, 'line', { title: 'T', data: Array.from({ length: 250 }, (_, i) => ({ x: i, y: i })), x: 'x', y: 'y' });
    await button(page, 'View as table').click();
    await settle(page);
    await page.locator('#chart .axylo-jump-field').focus();
    await page.evaluate(async () => { window.charts[0]!.update({ table: false }); await window.charts[0]!.__bench.ready(); await window.nextFrames(1); });
    expect(await page.evaluate(() => !!document.activeElement?.closest('#chart'))).toBe(true);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('"Jump to" accepts what the table shows (finding 18)', () => {
  it('a grouped number ("200,000") and a displayed date ("May 31, 2026") find their page', async () => {
    const page = await chartPage();
    await create(page, 'line', { title: 'N', data: Array.from({ length: 300 }, (_, i) => ({ x: i * 1000, y: i })), x: 'x', y: 'y' });
    await button(page, 'View as table').click();
    await page.locator('#chart .axylo-jump-field').fill('200,000');
    await page.keyboard.press('Enter');
    expect(await page.locator('#chart .axylo-page').textContent()).toBe('Page 3 of 3');
    expect(await page.locator('#chart .axylo-jump-field').getAttribute('aria-invalid')).toBeNull();
    await page.locator('#chart .axylo-jump-field').fill('1 2');
    await page.keyboard.press('Enter');
    expect(await page.locator('#chart .axylo-jump-field').getAttribute('aria-invalid')).toBe('true');
    await page.evaluate(() => window.charts.pop()!.destroy());
    const days = Array.from({ length: 200 }, (_, i) => ({ d: new Date(Date.UTC(2026, 0, 1) + i * 864e5).toISOString().slice(0, 10), y: i }));
    await create(page, 'line', { title: 'D', data: days, x: 'd', y: 'y' });
    await button(page, 'View as table').click();
    await page.locator('#chart .axylo-jump-field').fill('May 31, 2026');
    await page.keyboard.press('Enter');
    // 2026-05-31 is day 150 of the series: row 151, on page 2 of 2.
    expect(await page.locator('#chart .axylo-page').textContent()).toBe('Page 2 of 2');
    expect(await closePage(page)).toEqual([]);
  });
});

describe('language of the plot (finding 19)', () => {
  it('on a lang="de" page the plot\'s built-in label and role description are marked English; a state change too', async () => {
    const page = await chartPage();
    await page.evaluate(() => { document.documentElement.lang = 'de'; });
    await create(page, 'line', { title: 'L', data: [{ x: 1, y: 1 }, { x: 2, y: 2 }], x: 'x', y: 'y' });
    expect(await page.locator('#chart .axylo-proxy').getAttribute('lang')).toBe('en');
    await page.evaluate(async () => { window.charts[0]!.update({ state: 'loading' }); await window.charts[0]!.__bench.ready(); await window.nextFrames(1); });
    expect(await page.locator('#chart .axylo-live').getAttribute('lang')).toBe('en');
    expect(await closePage(page)).toEqual([]);
  });
});

describe('swatches repeat the contrast dash (finding 22)', () => {
  it('under prefers-contrast: more a line swatch uses the dash its line uses', async () => {
    // Playwright's Firefox flips matchMedia for an emulated contrast but leaves the media rules of a sheet
    // already loaded unevaluated (a plain <style> page shows it too), so on Firefox the preference is set on
    // the context, before the page loads. The chart is created after it either way.
    const page = ENGINE === 'firefox' ? await chartPage({ contrast: 'more' }) : await chartPage();
    if (ENGINE !== 'firefox') await page.emulateMedia({ contrast: 'more' } as never);
    const data = [1, 2].flatMap(x => ['a', 'b'].map(s => ({ x, s, y: x })));
    await create(page, 'line', { title: 'C', data, x: 'x', y: 'y', series: 's' });
    const dashes = await page.evaluate(() => [...document.querySelectorAll('#chart .axylo-legend-entry .axylo-swatch-line')].map(l => getComputedStyle(l).strokeDasharray));
    expect(dashes[0]).toBe('none');
    // The second series' contrast dash is [12, 5] (view cues); the swatch draws it halved.
    expect(dashes[1]).toBe('6px, 2.5px');
    // Against the plotted line itself (SVG marks): the swatch is the same pattern at half length.
    const plotted = await page.evaluate(() => [...document.querySelectorAll('#chart svg.axylo-svg path')]
      .map(p => getComputedStyle(p).strokeDasharray).filter(d => d !== 'none'));
    // On SVG the plotted dash must be there (interaction review part 3: an all-solid plot skipped this check);
    // on canvas the marks are pixels and the swatch's own pattern above is what is checked.
    const svg = await page.locator('#chart svg.axylo-svg').count();
    if (svg) {
      expect(plotted.length).toBeGreaterThan(0);
      expect(plotted[0]!.split(',').map(v => parseFloat(v) / 2)).toEqual(dashes[1]!.split(',').map(v => parseFloat(v)));
    }
    expect(await closePage(page)).toEqual([]);
  });
});

describe('a pinned tooltip belongs to the displayed revision (finding 11)', () => {
  it('a tapped scatter point zoomed out of view takes its tooltip with it', async () => {
    const page = await chartPage({ hasTouch: true });
    await create(page, 'scatter', { title: 'Pin', data: Array.from({ length: 11 }, (_, i) => ({ x: i * 10, y: i })), x: 'x', y: 'y' });
    const box = (await page.locator('#chart .axylo-proxy').boundingBox())!;
    const g = await page.evaluate(() => window.charts[0]!.__bench.describe());
    // The point at x = 80, y = 8.
    const px = box.x + (80 - g.xDomain![0]!) / (g.xDomain![1]! - g.xDomain![0]!) * box.width;
    const py = box.y + box.height - (8 - g.yDomain![0]!) / (g.yDomain![1]! - g.yDomain![0]!) * box.height;
    await page.touchscreen.tap(px, py);
    const tip = page.locator('#chart .axylo-tooltip, #chart .axylo-readout').filter({ hasText: '80' });
    expect(await tip.count()).toBe(1);
    await page.evaluate(() => window.charts[0]!.zoom([0, 40]));
    await settle(page);
    expect(await page.evaluate(() => [...document.querySelectorAll('#chart .axylo-tooltip, #chart .axylo-readout')].filter(e => !(e as HTMLElement).hidden).length)).toBe(0);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('the pointer readout follows every move (spec I1; the benchmark\'s hover workload)', () => {
  it('one series of 10,000 points, 40 evenly spaced real moves, one per frame: each names the datum nearest the pointer\'s x', async () => {
    const page = await chartPage();
    const n = 10_000;
    await page.evaluate(async n => {
      const x = Float64Array.from({ length: n }, (_, i) => i);
      const y = Float64Array.from({ length: n }, (_, i) => Math.sin(i / 50) * 100);
      const chart = window.Axylo.line!('#chart', { title: 'Hover', data: { columns: { x, y } }, x: 'x', y: 'y' });
      window.charts.push(chart);
      (window as unknown as { hovered: number }).hovered = NaN;
      chart.on('hover', p => { (window as unknown as { hovered: number }).hovered = p ? (p as { index: number }).index : NaN; });
      await chart.__bench.ready();
    }, n);
    const box = (await page.locator('#chart .axylo-proxy').boundingBox())!;
    const { xDomain } = await page.evaluate(() => window.charts[0]!.__bench.describe());
    const y = box.y + box.height / 2;
    const picked: number[] = [];
    const expected: number[] = [];
    for (let k = 0; k < 40; k++) {
      const px = box.x + box.width * (0.1 + 0.8 * k / 39);
      await page.mouse.move(px, y);
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => r(null))));
      picked.push(await page.evaluate(() => (window as unknown as { hovered: number }).hovered));
      // The x scale maps the domain onto the plot's width; the nearest datum to the pointer's position.
      const at = xDomain![0]! + (px - box.x) / box.width * (xDomain![1]! - xDomain![0]!);
      expected.push(Math.max(0, Math.min(n - 1, Math.round(at))));
    }
    // Pixel positions are fractional; a datum one index away is the same pixel at this density.
    const off = picked.map((p, k) => Math.abs(p - expected[k]!));
    expect(Math.max(...off), JSON.stringify({ picked, expected })).toBeLessThanOrEqual(Math.ceil(n / box.width));
    expect(new Set(picked).size).toBe(40);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('spec A5 in the swatches (palette review)', () => {
  const eight = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const rows = [0, 1, 2].flatMap(x => eight.map((s, i) => ({ x, s, y: 1 + i + x })));

  it('eight area series: each legend and tooltip swatch carries that series\' marker, and the eight are distinct', async () => {
    const page = await chartPage({ css: '#chart { width: 900px; }' });
    // The markers a line chart's swatches draw are the plotted markers (both come from the view's cues).
    await create(page, 'line', { title: 'Lines', data: rows, x: 'x', y: 'y', series: 's' });
    const markers = await page.evaluate(() => [...document.querySelectorAll('#chart .axylo-legend-entry svg.axylo-swatch')].map(svg => [...svg.querySelectorAll('path')].at(-1)!.getAttribute('d')));
    await page.evaluate(() => window.charts.pop()!.destroy());
    await create(page, 'area', { title: 'Areas', data: rows, x: 'x', y: 'y', series: 's' });
    const shapes = await page.evaluate(() => [...document.querySelectorAll('#chart .axylo-legend-entry svg.axylo-swatch')].map(svg => ({
      chip: !!svg.querySelector('path.axylo-swatch-chip'), marker: svg.querySelector('path.axylo-swatch-marker')?.getAttribute('d') ?? null,
    })));
    expect(shapes.map(s => s.chip)).toEqual(eight.map(() => true));
    expect(shapes.map(s => s.marker)).toEqual(markers);
    expect(new Set(markers).size).toBe(8);
    const box = (await page.locator('#chart .axylo-proxy').boundingBox())!;
    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    const tip = await page.evaluate(() => [...document.querySelectorAll('#chart .axylo-tooltip svg.axylo-swatch, #chart .axylo-readout svg.axylo-swatch')].map(svg => svg.querySelector('path.axylo-swatch-marker')?.getAttribute('d') ?? null));
    expect(tip).toEqual(markers);
    expect(await closePage(page)).toEqual([]);
  });

  it('bar swatches past the eighth series carry the bar pattern; the first eight do not', async () => {
    const page = await chartPage({ css: '#chart { width: 900px; }' });
    const nine = [...eight, 'i'];
    await create(page, 'bar', { title: 'Bars', data: ['p', 'q'].flatMap(x => nine.map((s, i) => ({ x, s, y: i + 1 }))), x: 'x', y: 'y', series: 's' });
    const patterns = await page.evaluate(() => [...document.querySelectorAll('#chart .axylo-legend-entry svg.axylo-swatch')].map(svg => !!svg.querySelector('.axylo-swatch-pattern')));
    expect(patterns).toEqual([false, false, false, false, false, false, false, false, true]);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('adjacent filled marks are separated by background (spec A5), on rendered pixels', () => {
  it('two stacked bar segments have at least 1 px of the background between them', async () => {
    const page = await chartPage({ css: 'body { background: rgb(255, 255, 255); }' });
    await create(page, 'bar', { title: 'S', layout: 'stacked', data: ['p', 'q', 'r'].flatMap(x => [{ x, s: 'a', y: 5 }, { x, s: 'b', y: 5 }]), x: 'x', y: 'y', series: 's' });
    const proxy = (await page.locator('#chart .axylo-proxy').boundingBox())!;
    const plot = (await page.locator('#chart .axylo-plot').boundingBox())!;
    const shot = await page.screenshot({ clip: plot });
    const { decodePng } = await import('../render/png');
    const img = decodePng(shot);
    // The middle bar's centre column, from the plot's bottom edge upwards: segment a, the seam, segment b.
    const cx = Math.round(proxy.x - plot.x + proxy.width / 2);
    const column: [number, number, number][] = [];
    for (let y = Math.floor(proxy.y - plot.y + proxy.height) - 2; y > proxy.y - plot.y; y--) {
      const o = (y * img.width + cx) * 4;
      column.push([img.data[o]!, img.data[o + 1]!, img.data[o + 2]!]);
    }
    const white = (c: [number, number, number]) => c.every(v => v > 245);
    // Runs of colored / white pixels along the column.
    const runs: { white: boolean; length: number }[] = [];
    for (const c of column) {
      const w = white(c);
      if (runs.length && runs.at(-1)!.white === w) runs.at(-1)!.length++;
      else runs.push({ white: w, length: 1 });
    }
    const colored = runs.map((r, i) => ({ ...r, i })).filter(r => !r.white && r.length > 3);
    expect(colored.length, JSON.stringify(column.filter((_, i) => i % 1 === 0).map(c => c.join('.')).filter((c, i, all) => c !== all[i - 1]))).toBeGreaterThanOrEqual(2);
    const between = runs.slice(colored[0]!.i + 1, colored[1]!.i);
    expect(between.some(r => r.white && r.length >= 1)).toBe(true);
    expect(await closePage(page)).toEqual([]);
  });
});

