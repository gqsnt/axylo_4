/**
 * The findings of the core review (reviews/2026-11-18/impl/wp/core1.review.md) as seen from the page, in
 * real Chrome against the built bundle. The logic findings are also covered in Node (test/core/controller.
 * test.ts); these check what only the browser shows: events from real input, the DOM after teardown, the
 * accessibility tree, the fallback under real CSS, and document listeners.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { start, stop } from '../harness';
import { aria, chartPage, closePage, columnsWith, shot, type RGB } from './util';

beforeAll(start);
afterAll(stop);



async function plotBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  return (await page.locator('#chart .axylo-proxy').boundingBox())!;
}

describe('data path (findings 1, 2, 3, 7)', () => {
  it('a strict ninth series is rejected without entering the store; a later valid append and strict: false show eight', async () => {
    const page = await chartPage();
    const result = await page.evaluate(async () => {
      const series = Array.from({ length: 8 }, (_, i) => `S${i}`);
      const data = series.flatMap(s => [{ x: 1, s, y: 1 }, { x: 2, s, y: 2 }]);
      const chart = window.Axylo.line!('#chart', { title: 'Strict', strict: true, data, x: 'x', y: 'y', series: 's' });
      let thrown = '';
      try { chart.append([{ x: 3, s: 'S8', y: 3 }]); } catch (e) { thrown = String(e); }
      let second = '';
      try { chart.append([{ x: 3, s: 'S0', y: 3 }]); } catch (e) { second = String(e); }
      chart.update({ strict: false });
      await chart.__bench.ready();
      return { thrown, second, keys: chart.__bench.describe().series.map(s => s.key) };
    });
    expect(result.thrown).toMatch(/AX130/);
    expect(result.second).toBe('');
    expect(result.keys).toEqual(Array.from({ length: 8 }, (_, i) => `S${i}`));
    expect(await closePage(page)).toEqual([]);
  });

  it('a new y field after append with keep shows the retained rows; update({ data }) with the original array replaces them', async () => {
    const page = await chartPage();
    const result = await page.evaluate(async () => {
      const data = [1, 2, 3].map(x => ({ x, a: x, b: -x }));
      const chart = window.Axylo.line!('#chart', { title: 'Stream', data, x: 'x', y: 'a' });
      chart.append([{ x: 4, a: 4, b: -4 }], { keep: 2 });
      chart.update({ y: 'b' });
      await chart.__bench.ready();
      const after = chart.__bench.describe().series[0]!;
      chart.update({ data });
      await chart.__bench.ready();
      const replaced = chart.__bench.describe().series[0]!;
      return { after: [after.oldestX, after.newestX, after.points], replaced: [replaced.oldestX, replaced.newestX, replaced.points] };
    });
    expect(result.after).toEqual([3, 4, 2]);
    expect(result.replaced).toEqual([1, 3, 3]);
    expect(await closePage(page)).toEqual([]);
  });

  it('a hover over the frame on screen reports its own row after an evicting append that is not drawn yet', async () => {
    const page = await chartPage();
    await page.evaluate(async () => {
      const chart = window.Axylo.line!('#chart', { title: 'Evict', data: [0, 1, 2].map(x => ({ x, y: x })), x: 'x', y: 'y' });
      window.charts.push(chart);
      await chart.__bench.ready();
    });
    const box = await plotBox(page);
    const event = await page.evaluate(({ x, y }) => {
      const chart = window.charts[0]!;
      let seen: unknown = 'none';
      chart.on('hover', p => { seen = p; });
      chart.append([{ x: 3, y: 3 }], { keep: 1 });
      const plot = document.querySelector('#chart .axylo-plot')!;
      plot.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true, pointerType: 'mouse' }));
      return seen;
    }, { x: box.x + 1, y: box.y + box.height / 2 });
    expect(event).toEqual({ series: 'y', x: 0, y: 0, row: { x: 0, y: 0 }, index: 0 });
    expect(await closePage(page)).toEqual([]);
  });

  it('scatter [10, 20] + 5 with keep 2 keeps [10, 20] and raises AX151', async () => {
    const page = await chartPage();
    const result = await page.evaluate(async () => {
      const chart = window.Axylo.scatter!('#chart', { title: 'S', data: [{ x: 10, y: 1 }, { x: 20, y: 2 }], x: 'x', y: 'y' });
      chart.append([{ x: 5, y: 3 }], { keep: 2 });
      await chart.__bench.ready();
      const s = chart.__bench.describe().series[0]!;
      return { range: [s.oldestX, s.newestX, s.points], codes: chart.diagnostics.map(d => d.code) };
    });
    expect(result.range).toEqual([10, 20, 2]);
    expect(result.codes).toContain('AX151');
    expect(await closePage(page)).toEqual([]);
  });
});

describe('failures (finding 4)', () => {
  it('after an internal failure the pointer shows nothing; after the cause is removed an update brings back the axis labels', async () => {
    const page = await chartPage();
    await page.evaluate(async () => {
      const chart = window.Axylo.line!('#chart', { title: 'Fail', data: Array.from({ length: 20 }, (_, i) => ({ x: i, y: i })), x: 'x', y: 'y' });
      window.charts.push(chart);
      await chart.__bench.ready();
      chart.__dev.fail('reader');
      chart.update({ title: 'Fail 2' });
      await chart.__bench.ready();
    });
    const box = (await page.locator('#chart .axylo-plot').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const during = await page.evaluate(() => ({
      tooltip: !(document.querySelector('#chart .axylo-tooltip') as HTMLElement).hidden,
      labels: document.querySelectorAll('#chart .axylo-label').length,
      message: document.querySelector('#chart .axylo-message')!.textContent,
    }));
    const after = await page.evaluate(async () => {
      const chart = window.charts[0]!;
      chart.__dev.fail(null);
      chart.update({ title: 'Recovered' });
      await chart.__bench.ready();
      return { labels: document.querySelectorAll('#chart .axylo-label').length, codes: chart.diagnostics.map(d => d.code) };
    });
    expect(during).toEqual({ tooltip: false, labels: 0, message: 'Something went wrong while drawing the chart.' });
    expect(after.labels).toBeGreaterThan(3);
    expect(after.codes).toEqual([]);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('controls and events (finding 5)', () => {
  it('the Zoom in button fires zoom, a click on a datum fires select', async () => {
    const page = await chartPage();
    await page.evaluate(async () => {
      const chart = window.Axylo.line!('#chart', { title: 'E', data: Array.from({ length: 20 }, (_, i) => ({ x: i, y: i })), x: 'x', y: 'y' });
      window.charts.push(chart);
      (window as unknown as { seen: unknown[] }).seen = [];
      chart.on('zoom', w => (window as unknown as { seen: unknown[] }).seen.push(['zoom', w]));
      chart.on('select', p => (window as unknown as { seen: unknown[] }).seen.push(['select', (p as { x: number }).x]));
      await chart.__bench.ready();
    });
    await page.locator('#chart button', { hasText: 'Zoom in' }).click();
    await page.evaluate(async () => { await window.charts[0]!.__bench.ready(); await window.nextFrames(2); });
    const box = await plotBox(page);
    // Exactly over x = 10 of the zoomed window [4.75, 14.25], so the tooltip beside it is not under the pointer.
    await page.mouse.move(box.x + (10 - 4.75) / 9.5 * box.width, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    const seen = await page.evaluate(() => (window as unknown as { seen: unknown[] }).seen);
    expect(seen[0]).toEqual(['zoom', [4.75, 14.25]]);
    expect(seen[1]).toEqual(['select', 10]);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('re-entrant author code (finding 6)', () => {
  it('an onDiagnostic that updates the chart receives each diagnostic once', async () => {
    const page = await chartPage();
    const seen = await page.evaluate(async () => {
      const seen: string[] = [];
      const chart = window.Axylo.line!('#chart', { title: 'Named', data: [{ x: 1, y: 1 }, { x: 2, y: 2 }], x: 'x', y: 'y' });
      // Removing the title raises AX140 in this update; the handler updates the chart from inside delivery.
      chart.update({
        title: undefined,
        onDiagnostic: (d: { code: string }) => { seen.push(d.code); chart.update({ description: String(seen.length) }); },
      });
      chart.update({ subtitle: 'later' });
      await chart.__bench.ready();
      return seen;
    });
    expect(seen).toEqual(['AX140']);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('state (findings 8, 9, 10, 11)', () => {
  it('a segment crossing a zoomed window is drawn, not "No data"', async () => {
    const page = await chartPage();
    const result = await page.evaluate(async () => {
      const chart = window.Axylo.line!('#chart', { title: 'Z', data: [{ x: 0, y: 0 }, { x: 10, y: 10 }], x: 'x', y: 'y' });
      window.charts.push(chart);
      chart.zoom([2, 4]);
      await chart.__bench.ready();
      await window.nextFrames(1);
      const probe = document.querySelector('#chart figure')!.appendChild(document.createElement('span'));
      probe.style.color = 'var(--axylo-series-color-1)';
      const color = getComputedStyle(probe).color.match(/\d+/g)!.map(Number);
      probe.remove();
      return {
        hidden: (document.querySelector('#chart .axylo-message') as HTMLElement).hidden,
        color,
        valueText: document.querySelector('#chart .axylo-proxy')?.getAttribute('aria-valuetext') ?? null,
      };
    });
    expect(result.hidden).toBe(true);
    expect(result.valueText).not.toBe('No data to show.');
    // The stroke itself (controller review, finding 20): the series color across most of the plot's width.
    const { img } = await shot(page, '#chart .axylo-plot');
    const has = columnsWith(img, result.color as unknown as RGB, 0, img.height, 40);
    const inside = has.slice(Math.floor(img.width * 0.2), Math.floor(img.width * 0.9));
    expect(inside.filter(Boolean).length).toBeGreaterThan(inside.length * 0.9);
    expect(await closePage(page)).toEqual([]);
  });

  it('a window that no longer ends at the latest x after a data replacement stays put when rows arrive', async () => {
    const page = await chartPage();
    const domain = await page.evaluate(async () => {
      const r = (xs: number[]) => xs.map(x => ({ x, y: x }));
      const chart = window.Axylo.line!('#chart', { title: 'F', data: r([0, 5, 10]), x: 'x', y: 'y' });
      chart.zoom([5, 10]);
      chart.update({ data: r([0, 5, 10, 15]) });
      chart.append([{ x: 20, y: 20 }]);
      await chart.__bench.ready();
      return chart.__bench.describe().xDomain;
    });
    expect(domain).toEqual([5, 10]);
    expect(await closePage(page)).toEqual([]);
  });

  it('validate and a created bar chart agree on AX110; zoom never throws under strict', async () => {
    const page = await chartPage();
    const result = await page.evaluate(async () => {
      const options = { title: 'B', data: [{ x: 'a', y: 2 }, { x: 'b', y: 3 }], x: 'x', y: { field: 'y', domain: [1, 3] } };
      const validated = (window.Axylo.validate as unknown as (t: string, o: unknown) => { code: string }[])('bar', options).map(d => d.code);
      const chart = window.Axylo.bar!('#chart', options);
      const created = chart.diagnostics.map(d => d.code);
      const strict = window.Axylo.line!(document.body.appendChild(document.createElement('div')), { title: 'S', strict: true, data: [{ x: 1, y: 1 }, { x: 2, y: 2 }], x: 'x', y: 'y' });
      let thrown = '';
      try { strict.zoom(['oops', 'bad']); } catch (e) { thrown = String(e); }
      return { validated, created, thrown };
    });
    expect(result.validated).toEqual(['AX110']);
    expect(result.created).toEqual(['AX110']);
    expect(result.thrown).toBe('');
    expect(await closePage(page)).toEqual([]);
  });

  it('a throwing tick formatter shows its note on the frame that found it; a working one removes AX160 and the note', async () => {
    const page = await chartPage();
    const result = await page.evaluate(async () => {
      const chart = window.Axylo.line!('#chart', { title: 'T', data: [{ x: 1, y: 1 }, { x: 2, y: 2 }], x: 'x', y: { field: 'y', tickFormat: () => { throw new Error('t'); } } });
      await chart.__bench.ready();
      const note = () => {
        const el = document.querySelector('#chart .axylo-note') as HTMLElement;
        return el.hidden ? null : el.textContent;
      };
      const first = { codes: chart.diagnostics.map(d => d.code), note: note() };
      chart.update({ y: { field: 'y', tickFormat: (v: number) => `${v}` } });
      await chart.__bench.ready();
      return { first, second: { codes: chart.diagnostics.map(d => d.code), note: note() } };
    });
    expect(result.first.codes).toEqual(['AX160']);
    expect(result.first.note).toMatch(/shown differently/);
    expect(result.second).toEqual({ codes: [], note: null });
    expect(await closePage(page)).toEqual([]);
  });
});

describe('lifecycle (finding 12)', () => {
  it('destroy() takes back the custom properties the chart wrote on the target', async () => {
    const page = await chartPage();
    const style = await page.evaluate(async () => {
      const el = document.getElementById('chart')!;
      el.style.setProperty('--brand', 'red');
      const chart = window.Axylo.line!(el, { title: 'P', data: [{ x: 1, s: 'a', y: 1 }, { x: 1, s: 'b', y: 2 }], x: 'x', y: 'y', series: 's' });
      await chart.__bench.ready();
      const during = el.getAttribute('style');
      const figure = el.querySelector('figure')!.getAttribute('style');
      chart.destroy();
      return { during, figure, after: el.getAttribute('style') };
    });
    // Review 3, finding 10: the chart writes its properties on its own figure, never on the target.
    expect(style.during).toBe('--brand: red;');
    expect(style.figure).toMatch(/--axylo-series-color-1/);
    expect(style.after).toBe('--brand: red;');
    expect(await closePage(page)).toEqual([]);
  });

  it('a target removed from the document without destroy() releases document listeners, and gets them back when it returns', async () => {
    const page = await chartPage();
    const result = await page.evaluate(async () => {
      // Count listeners on the document, its font set and media queries, and observers on the document.
      const live = new Set<string>();
      const add = EventTarget.prototype.addEventListener;
      const remove = EventTarget.prototype.removeEventListener;
      const name = (t: EventTarget, type: string, fn: unknown) => `${t === document ? 'document' : t === document.fonts ? 'fonts' : t instanceof MediaQueryList ? `mq:${t.media}` : 'other'}|${type}|${String(fn).length}|${(window as unknown as { ids: WeakMap<object, number> }).ids.get(fn as object)}`;
      const ids = new WeakMap<object, number>();
      (window as unknown as { ids: WeakMap<object, number> }).ids = ids;
      let n = 0;
      EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, fn: EventListenerOrEventListenerObject | null, o?: boolean | AddEventListenerOptions) {
        if (fn && (this === document || this === document.fonts || this instanceof MediaQueryList)) {
          if (!ids.has(fn as object)) ids.set(fn as object, ++n);
          const entry = name(this, type, fn);
          live.add(entry);
          // A listener removed by aborting its signal is removed as well.
          const signal = typeof o === 'object' ? o.signal : undefined;
          signal?.addEventListener('abort', () => live.delete(entry));
        }
        return add.call(this, type, fn, o);
      } as typeof EventTarget.prototype.addEventListener;
      EventTarget.prototype.removeEventListener = function (this: EventTarget, type: string, fn: EventListenerOrEventListenerObject | null, o?: boolean | EventListenerOptions) {
        if (fn) live.delete(name(this, type, fn));
        return remove.call(this, type, fn, o);
      } as typeof EventTarget.prototype.removeEventListener;
      const observing = new Set<MutationObserver>();
      const observe = MutationObserver.prototype.observe;
      const disconnect = MutationObserver.prototype.disconnect;
      MutationObserver.prototype.observe = function (this: MutationObserver, target: Node, o?: MutationObserverInit) { observing.add(this); return observe.call(this, target, o); };
      MutationObserver.prototype.disconnect = function (this: MutationObserver) { observing.delete(this); return disconnect.call(this); };

      const el = document.getElementById('chart')!;
      const chart = window.Axylo.line!(el, { title: 'D', data: [{ x: 1, y: 1 }, { x: 2, y: 2 }], x: 'x', y: 'y' });
      await chart.__bench.ready();
      const attached = { listeners: live.size, observers: observing.size };
      const parent = el.parentNode!;
      const next = el.nextSibling;
      el.remove();
      await window.nextFrames(3);
      const detached = { listeners: live.size, observers: observing.size };
      parent.insertBefore(el, next);
      await window.nextFrames(3);
      const back = { listeners: live.size, observers: observing.size };
      // A theme change on the page reaches the chart again.
      const draws = chart.__dev.stages().theme;
      document.documentElement.setAttribute('data-theme', 'dark');
      await window.nextFrames(3);
      return { attached, detached, back, themed: chart.__dev.stages().theme > draws };
    });
    expect(result.attached.listeners).toBeGreaterThan(0);
    expect(result.attached.observers).toBeGreaterThan(0);
    expect(result.detached).toEqual({ listeners: 0, observers: 0 });
    expect(result.back).toEqual(result.attached);
    expect(result.themed).toBe(true);
    expect(await closePage(page)).toEqual([]);
  });

  it('a failure part-way through creation leaves the target as it was', async () => {
    const page = await chartPage();
    const result = await page.evaluate(() => {
      const el = document.getElementById('chart')!;
      const original = window.ResizeObserver;
      (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class { constructor() { throw new Error('no observer'); } };
      let thrown = '';
      try {
        window.Axylo.line!(el, { title: 'X', data: [{ x: 1, y: 1 }], x: 'x', y: 'y' });
      } catch (e) {
        thrown = String(e);
      }
      window.ResizeObserver = original;
      return { thrown, children: el.childElementCount, className: el.className, attributes: [...el.attributes].map(a => a.name).sort() };
    });
    expect(result.thrown).toMatch(/no observer/);
    expect(result).toMatchObject({ children: 0, className: '', attributes: ['id'] });
    expect(await closePage(page)).toEqual([]);
  });

  it('a failure late in setup, after the first frame was asked for, leaves the target as it was and draws nothing later', async () => {
    // The language and theme watchers are set up last: their observer failing is a late setup failure
    // (controller review, finding 20).
    const page = await chartPage();
    const result = await page.evaluate(async () => {
      const el = document.getElementById('chart')!;
      const original = MutationObserver.prototype.observe;
      const frames: number[] = [];
      const raf = window.requestAnimationFrame;
      window.requestAnimationFrame = (cb: FrameRequestCallback) => { frames.push(1); return raf.call(window, cb); };
      MutationObserver.prototype.observe = function () { throw new Error('late failure'); };
      let thrown = '';
      try {
        window.Axylo.line!(el, { title: 'X', data: [{ x: 1, y: 1 }, { x: 2, y: 2 }], x: 'x', y: 'y' });
      } catch (e) {
        thrown = String(e);
      }
      MutationObserver.prototype.observe = original;
      window.requestAnimationFrame = raf;
      await window.nextFrames(3);
      return { thrown, asked: frames.length, children: el.childElementCount, className: el.className, attributes: [...el.attributes].map(a => a.name).sort() };
    });
    expect(result.thrown).toMatch(/late failure/);
    // The frame was asked for before the failure, so its cancellation is what is tested.
    expect(result.asked).toBeGreaterThan(0);
    expect(result).toMatchObject({ children: 0, className: '', attributes: ['id'] });
    expect(await closePage(page)).toEqual([]);
  });
});

describe('sizing (finding 13)', () => {
  it('stepping a container one pixel at a time through the L8 boundary switches once, at the same height both ways', async () => {
    const page = await chartPage({ css: '#chart { height: 240px; }' });
    const result = await page.evaluate(async () => {
      const el = document.getElementById('chart')!;
      const chart = window.Axylo.line!(el, { title: 'Small', subtitle: 'A subtitle', data: Array.from({ length: 30 }, (_, i) => ({ x: i, s: i % 2 ? 'a' : 'b', y: i })), x: 'x', y: 'y', series: 's' });
      await chart.__bench.ready();
      const state = async (height: number) => {
        el.style.height = `${height}px`;
        await window.nextFrames(2);
        await chart.__bench.ready();
        const seen: boolean[] = [];
        for (let i = 0; i < 6; i++) {
          await window.nextFrames(1);
          seen.push(!(document.querySelector('#chart .axylo-summary') as HTMLElement).classList.contains('axylo-visually-hidden'));
        }
        return seen;
      };
      const heights = Array.from({ length: 110 }, (_, i) => 120 + i);
      const up: boolean[][] = [];
      for (const h of heights) up.push(await state(h));
      const down: boolean[][] = [];
      for (const h of [...heights].reverse()) down.push(await state(h));
      return { heights, up, down: down.reverse() };
    });
    const steady = (runs: boolean[][]) => runs.map((seen, i) => {
      expect(new Set(seen).size, `height ${result.heights[i]}: ${seen.join(',')}`).toBe(1);
      return seen[0]!;
    });
    const up = steady(result.up);
    const down = steady(result.down);
    expect(up).toEqual(down);
    expect(up[0]).toBe(true);
    expect(up.at(-1)).toBe(false);
    expect(up.filter((v, i) => i > 0 && v !== up[i - 1]).length).toBe(1);
    expect(await closePage(page)).toEqual([]);
  }, 120_000);
});

describe('bars, donut colors, stages (findings 15, 16, 17, 18)', () => {
  it('bars on x with domain [0, 20] label no tick outside [0, 20]', async () => {
    const page = await chartPage();
    const ticks = await page.evaluate(async () => {
      const chart = window.Axylo.bar!('#chart', { title: 'B', data: [{ x: 0, y: 1 }, { x: 10, y: 2 }, { x: 20, y: 3 }], x: { field: 'x', domain: [0, 20] }, y: 'y' });
      await chart.__bench.ready();
      return [...document.querySelectorAll('#chart .axylo-label[data-role="tick-x"]')].map(l => Number(l.textContent));
    });
    expect(ticks.length).toBeGreaterThan(1);
    for (const t of ticks) expect(t >= 0 && t <= 20, String(ticks)).toBe(true);
    expect(await closePage(page)).toEqual([]);
  });

  it('a color pinned to Sales paints the Sales arc when a zero slice comes first', async () => {
    const page = await chartPage();
    const colors = await page.evaluate(async () => {
      const chart = window.Axylo.donut!('#chart', { title: 'D', data: [{ l: 'Empty', v: 0 }, { l: 'Sales', v: 4 }], label: 'l', value: 'v', colors: { Sales: 'rgb(255, 0, 0)' }, __renderer: 'svg' });
      await chart.__bench.ready();
      return [...document.querySelectorAll('#chart svg path')].map(p => getComputedStyle(p).fill).filter(f => f.startsWith('rgb(255, 0, 0)'));
    });
    expect(colors.length).toBeGreaterThan(0);
    expect(await closePage(page)).toEqual([]);
  });

  it('a domain-only update does not renormalize; a caption-only update reruns only the reader', async () => {
    const page = await chartPage({ css: '#chart { height: auto; }' });
    const result = await page.evaluate(async () => {
      const t = Float64Array.from({ length: 50 }, (_, i) => i);
      const chart = window.Axylo.scatter!('#chart', { title: 'S', data: { columns: { t, v: t.map(x => x * 2) } }, x: 't', y: 'v' });
      await chart.__bench.ready();
      const a = chart.__dev.stages();
      chart.update({ x: { field: 't', domain: [0, 100] } });
      await chart.__bench.ready();
      const b = chart.__dev.stages();
      chart.update({ description: 'More words.' });
      await chart.__bench.ready();
      await window.nextFrames(2);
      return { a, b, c: chart.__dev.stages() };
    });
    expect(result.b.normalize).toBe(result.a.normalize);
    const changed = Object.keys(result.c).filter(k => result.c[k as 'frame'] !== result.b[k as 'frame']).sort();
    expect(changed).toEqual(['figure', 'frame', 'options', 'reader']);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('naming (finding 19)', () => {
  it('a labelledBy that names nothing gets a generated name and AX140; with a heading it is used and no second heading is made', async () => {
    const page = await chartPage();
    const result = await page.evaluate(async () => {
      const el = document.getElementById('chart')!;
      const chart = window.Axylo.line!(el, { labelledBy: 'missing', data: [{ x: 1, y: 1 }, { x: 2, y: 2 }], x: 'x', y: 'y' });
      await chart.__bench.ready();
      const figure = el.querySelector('figure')!;
      const missing = { label: figure.getAttribute('aria-label'), labelledby: figure.getAttribute('aria-labelledby'), codes: chart.diagnostics.map(d => d.code) };
      chart.destroy();
      const heading = document.body.insertBefore(Object.assign(document.createElement('h2'), { id: 'card', textContent: 'Card heading' }), el);
      const named = window.Axylo.line!(el, { labelledBy: 'card', title: 'Also a title', data: [{ x: 1, y: 1 }, { x: 2, y: 2 }], x: 'x', y: 'y' });
      await named.__bench.ready();
      const f = el.querySelector('figure')!;
      return {
        missing, heading: heading.id,
        withHeading: { labelledby: f.getAttribute('aria-labelledby'), internal: [...el.querySelectorAll('[role="heading"]')].filter(h => !(h as HTMLElement).hidden).length },
      };
    });
    expect(result.missing).toEqual({ label: 'Line chart of y by x', labelledby: null, codes: ['AX140'] });
    expect(result.withHeading).toEqual({ labelledby: 'card', internal: 0 });
    expect(await closePage(page)).toEqual([]);
  });

  it('generated ids do not collide with ids already in the page', async () => {
    const page = await chartPage();
    const duplicates = await page.evaluate(async () => {
      for (const id of ['axylo-1-t', 'axylo-2', 'axylo-3-s']) document.body.appendChild(Object.assign(document.createElement('span'), { id }));
      for (let i = 0; i < 3; i++) {
        const el = document.body.appendChild(document.createElement('div'));
        const chart = window.Axylo.line!(el, { title: `C${i}`, data: [{ x: 1, y: 1 }, { x: 2, y: 2 }], x: 'x', y: 'y' });
        await chart.__bench.ready();
      }
      const ids = [...document.querySelectorAll('[id]')].map(e => e.id);
      return ids.filter((id, i) => ids.indexOf(id) !== i);
    });
    expect(duplicates).toEqual([]);
    expect(await closePage(page)).toEqual([]);
  });

  it("a compact chart's accessible description includes its state", async () => {
    const page = await chartPage({ css: '#chart { height: 40px; width: 200px; }' });
    await page.evaluate(async () => {
      const chart = window.Axylo.line!('#chart', { title: 'Tile', compact: true, state: 'loading', data: [{ x: 1, y: 1 }, { x: 2, y: 2 }], x: 'x', y: 'y' });
      await chart.__bench.ready();
    });
    expect(await aria(page)).toMatch(/img "Tile"/);
    const description = await page.evaluate(() => {
      const figure = document.querySelector('#chart figure')!;
      return document.getElementById(figure.getAttribute('aria-describedby')!)!.textContent;
    });
    expect(description).toBe('Loading chart.');
    expect(await closePage(page)).toEqual([]);
  });
});

describe('presentation (renderer default, messages, reference plate, legend)', () => {
  it('the default mark renderer is SVG; canvas stays selectable', async () => {
    const page = await chartPage();
    const kinds = await page.evaluate(async () => {
      const a = window.Axylo.line!('#chart', { title: 'A', data: [{ x: 1, y: 1 }, { x: 2, y: 2 }], x: 'x', y: 'y' });
      const el = document.body.appendChild(document.createElement('div'));
      const b = window.Axylo.line!(el, { title: 'B', data: [{ x: 1, y: 1 }, { x: 2, y: 2 }], x: 'x', y: 'y', __renderer: 'canvas' });
      return [a.__dev.renderer, b.__dev.renderer];
    });
    // chartPage may select a renderer for the whole suite (AXYLO_RENDERER); without it the default shows.
    expect(kinds[1]).toBe('canvas');
    if (!process.env.AXYLO_RENDERER) expect(kinds[0]).toBe('svg');
    expect(await closePage(page)).toEqual([]);
  });

  it('the plot says what it is with plotRole, and a stacked tooltip labels its total with total', async () => {
    const page = await chartPage();
    await page.evaluate(async () => {
      const data = [0, 1, 2].flatMap(x => [{ x, s: 'a', y: 1 }, { x, s: 'b', y: 2 }]);
      // plotRole overridden, so the text comes from the message and not from a constant (finding 20).
      const chart = window.Axylo.area!('#chart', { title: 'Stack', stacked: true, data, x: 'x', y: 'y', series: 's', messages: { total: 'Sum', plotRole: 'Graph: {type}' } });
      window.charts.push(chart);
      await chart.__bench.ready();
    });
    const box = await plotBox(page);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const result = await page.evaluate(() => ({
      role: document.querySelector('#chart .axylo-proxy')!.getAttribute('aria-roledescription'),
      total: document.querySelector('#chart .axylo-tooltip .axylo-tooltip-total')?.textContent,
    }));
    expect(result.role).toBe('Graph: Area');
    expect(result.total).toBe('Sum3');
    expect(await closePage(page)).toEqual([]);
  });

  it('a reference label sits on a plate of the backdrop color, 2 px beyond its text', async () => {
    const page = await chartPage({ css: 'body { background: rgb(250, 240, 230); }' });
    const plate = await page.evaluate(async () => {
      const chart = window.Axylo.bar!('#chart', { title: 'R', data: [{ x: 'a', y: 5 }, { x: 'b', y: 9 }], x: 'x', y: 'y', reference: [{ y: 7, label: 'Target' }] });
      await chart.__bench.ready();
      const label = document.querySelector('#chart .axylo-label[data-role="reference"]')!;
      const s = getComputedStyle(label);
      return { background: s.backgroundColor, shadow: s.boxShadow };
    });
    expect(plate.background).toBe('rgb(250, 240, 230)');
    expect(plate.shadow).toBe('rgb(250, 240, 230) 0px 0px 0px 2px');
    expect(await closePage(page)).toEqual([]);
  });

  it('legend swatches: a filled square for bars and areas, the line with its marker for lines, the marker for scatter', async () => {
    const page = await chartPage();
    const swatches = await page.evaluate(async () => {
      const data = [1, 2].flatMap(x => [{ x, s: 'a', y: 1 }, { x, s: 'b', y: 2 }]);
      const out: Record<string, { line: boolean; d: string | null }> = {};
      for (const kind of ['bar', 'area', 'line', 'scatter'] as const) {
        const el = document.body.appendChild(document.createElement('div'));
        el.style.width = '600px';
        const chart = window.Axylo[kind]!(el, { title: kind, data, x: 'x', y: 'y', series: 's' });
        await chart.__bench.ready();
        const swatch = el.querySelector('.axylo-legend-entry svg.axylo-swatch')!;
        out[kind] = { line: swatch.querySelector('line') !== null, d: swatch.querySelector('path')!.getAttribute('d') };
      }
      return out;
    });
    expect(swatches.bar).toEqual({ line: false, d: 'M5 1H15V11H5Z' });
    expect(swatches.area).toEqual({ line: false, d: 'M5 1H15V11H5Z' });
    expect(swatches.line!.line).toBe(true);
    expect(swatches.line!.d).not.toBe('M5 1H15V11H5Z');
    expect(swatches.scatter!.line).toBe(false);
    expect(swatches.scatter!.d).not.toBe('M5 1H15V11H5Z');
    expect(await closePage(page)).toEqual([]);
  });

  it("legend: 'top' puts the legend above the plot, 'right' beside it, false removes it; there is still one toolbar", async () => {
    const page = await chartPage();
    const result = await page.evaluate(async () => {
      const data = [1, 2].flatMap(x => [{ x, s: 'a', y: 1 }, { x, s: 'b', y: 2 }]);
      const chart = window.Axylo.line!('#chart', { title: 'L', data, x: 'x', y: 'y', series: 's', legend: 'top' });
      await chart.__bench.ready();
      const where = () => {
        const entry = document.querySelector('#chart .axylo-legend-entry');
        const plot = document.querySelector('#chart .axylo-plot')!.getBoundingClientRect();
        if (!entry) return 'none';
        const box = entry.getBoundingClientRect();
        return box.bottom <= plot.top ? 'above' : box.left >= plot.right ? 'beside' : box.top >= plot.bottom ? 'below' : 'over';
      };
      const toolbars = () => document.querySelectorAll('#chart [role="toolbar"]').length;
      const top = [where(), toolbars()];
      chart.update({ legend: 'right' });
      await chart.__bench.ready();
      const right = [where(), toolbars()];
      chart.update({ legend: 'bottom' });
      await chart.__bench.ready();
      const bottom = [where(), toolbars()];
      chart.update({ legend: false });
      await chart.__bench.ready();
      return { top, right, bottom, off: where() };
    });
    expect(result).toEqual({ top: ['above', 1], right: ['beside', 1], bottom: ['below', 1], off: 'none' });
    expect(await closePage(page)).toEqual([]);
  });
});

