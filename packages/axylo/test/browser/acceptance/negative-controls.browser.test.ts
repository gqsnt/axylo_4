/**
 * Negative controls: for each checker the suite's verdicts rest on, the behaviour is broken from the test
 * side in a real chart (an element removed, cells swapped, marks made transparent, an animation added, a
 * spike moved, a separator narrowed) and the checker must report the break. A checker that cannot fail
 * here proves nothing where it passes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { start, stop } from '../harness';
import {
  axOf, box, center, closePage, compareTable, covered, create, createRaw, devPage, figureLayout, modeColor, readTable, screenshot, settle, shapes, valueText,
} from './util';
import { missingClauses, summaryClauses, tableOf } from './fixtures';
import { controlCoverage, eight, markerClasses, paintedSeries, paletteProblems, referenceMarks, spikeColumn, strokeRuns, traceMotion } from './checks';
import { overlaps, textBoxes } from './text';

beforeAll(start);
afterAll(stop);

describe('negative controls', () => {
  it('A5 bar: negative control: the separator check, calibrated on a 1 px control, flags a 0.5 px gap and touching marks', async () => {
    const page = await devPage();
    const colors = [[67, 149, 234], [231, 116, 18]] as const;
    const bg = [255, 255, 255] as const;
    const one = await controlCoverage(page, colors, bg, 1);
    const half = await controlCoverage(page, colors, bg, 0.5);
    const none = await controlCoverage(page, colors, bg, 0);
    // The suite accepts a seam when it reaches the 1 px control's coverage less 0.02.
    expect(one).toBeGreaterThan(0.8);
    expect(half + 0.02).toBeLessThan(one);
    expect(none + 0.02).toBeLessThan(one);
    const diagonal = await controlCoverage(page, colors, bg, 0.5, Math.PI / 5);
    expect(diagonal + 0.02).toBeLessThan(await controlCoverage(page, colors, bg, 1, Math.PI / 5));
    expect(await closePage(page)).toEqual([]);
  });

  it('A5 line: negative control: painted-colour sampling reports marks made nearly transparent, and marks covered by an element', async () => {
    const page = await devPage({ deviceScaleFactor: 2 });
    const { fn, options } = eight('line');
    await createRaw(page, fn, options);
    const good = await paintedSeries(page, 'line');
    expect(good.problems).toEqual([]);
    expect(paletteProblems(good.colors, good.backdrop)).toEqual([]);
    await page.addStyleTag({ content: '#chart .axylo-scene { opacity: 0.15; }' });
    const faint = await paintedSeries(page, 'line');
    expect([...faint.problems, ...paletteProblems(faint.colors, faint.backdrop)].length).toBeGreaterThan(0);
    await page.addStyleTag({ content: '#chart .axylo-scene { opacity: 1; } #chart .axylo-plot::after { content: ""; position: absolute; inset: 0; background: white; z-index: 50; }' });
    const hidden = await paintedSeries(page, 'line');
    expect([...hidden.problems, ...paletteProblems(hidden.colors, hidden.backdrop)].length).toBeGreaterThan(0);
    expect(await closePage(page)).toEqual([]);
  });

  it('A5 line: negative control: the grayscale marker-class check reports three identical markers as not distinct', async () => {
    const page = await devPage({ deviceScaleFactor: 4 });
    const data = Object.entries({ A: [10, 90], B: [50, 50], C: [90, 10] }).flatMap(([s, v]) => v.map((y, x) => ({ x, s, y })));
    await createRaw(page, 'line', { title: 'Crossing', data, x: 'x', y: 'y', series: 's' });
    // Every marker, in the plot and in the legend, replaced by the same circle at its own centre.
    await page.evaluate(() => {
      const circle = (cx: number, cy: number, r: number) => `M${cx + r} ${cy} A${r} ${r} 0 1 1 ${cx - r} ${cy} A${r} ${r} 0 1 1 ${cx + r} ${cy}Z`;
      const centreOf = (sub: string) => {
        const t = sub.match(/[MLAZ]|-?\d*\.?\d+/gi) ?? [];
        const xs: number[] = [], ys: number[] = [];
        let cmd = '';
        for (let i = 0; i < t.length;) {
          if (/^[A-Za-z]$/.test(t[i]!)) { cmd = t[i]!.toUpperCase(); i++; continue; }
          if (cmd === 'A') { xs.push(Number(t[i + 5])); ys.push(Number(t[i + 6])); i += 7; } else { xs.push(Number(t[i])); ys.push(Number(t[i + 1])); i += 2; }
        }
        return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2] as const;
      };
      for (const m of document.querySelectorAll('#chart .axylo-legend-entry .axylo-swatch-marker')) m.setAttribute('d', circle(10, 6, 3));
      for (const p of document.querySelectorAll<SVGPathElement>('#chart svg.axylo-svg .axylo-scene path')) {
        if (p.getAttribute('stroke-width') || !/--axylo-series-color-/.test(p.style.getPropertyValue('color'))) continue;
        p.setAttribute('d', p.getAttribute('d')!.split(/(?=M)/).map(sub => { const [x, y] = centreOf(sub); return circle(x, y, 3); }).join(''));
      }
    });
    const { plot, legend } = await markerClasses(page);
    expect(new Set(plot).size).toBe(1);
    expect(new Set(legend).size).toBe(1);
    expect(await closePage(page)).toEqual([]);
  });

  it('L1 line: negative control: the text check reports an overlapping label, a clipped one, and two lines that overlap by 1.1 px', async () => {
    const page = await devPage();
    await create(page, 'line');
    expect(overlaps((await textBoxes(page)).filter(b => b.w > 0))).toEqual([]);
    await page.evaluate(() => {
      const tick = document.querySelector('#chart .axylo-label[data-role="tick-x"]') as HTMLElement;
      const r = tick.getBoundingClientRect();
      const fake = document.createElement('div');
      fake.textContent = 'Overlapping';
      fake.style.cssText = `position: fixed; left: ${r.x + 2}px; top: ${r.y + 2}px; font: 14px sans-serif;`;
      document.querySelector('#chart figure')!.appendChild(fake);
    });
    expect(overlaps((await textBoxes(page)).filter(b => b.w > 0)).some(o => o.includes('Overlapping'))).toBe(true);
    await page.evaluate(() => {
      const box = document.createElement('div');
      box.style.cssText = 'width: 30px; overflow: hidden; white-space: nowrap;';
      box.textContent = 'A label far too long for its box';
      document.querySelector('#chart figure')!.appendChild(box);
      // Two lines of one element, the second pulled up so the two overlap by about 1.1 px.
      const two = document.createElement('div');
      two.style.cssText = 'font: 14px/14px sans-serif;';
      const a = document.createElement('div'); a.textContent = 'Two lines, first';
      const b = document.createElement('div'); b.textContent = 'Two lines, second'; b.style.marginTop = '-1.1px';
      two.append(a, b);
      document.querySelector('#chart figure')!.appendChild(two);
    });
    const boxes = await textBoxes(page);
    expect(boxes.some(b => b.seen === 'clipped' && b.text.startsWith('A label'))).toBe(true);
    expect(overlaps(boxes.filter(b => b.w > 0)).some(o => o.includes('Two lines'))).toBe(true);
    expect(await closePage(page)).toEqual([]);
  });

  it('A4 line: negative control: the table comparison reports two swapped cells and two swapped headers', async () => {
    const page = await devPage();
    await create(page, 'line');
    await page.locator('#chart [role="toolbar"] button', { hasText: 'View as table' }).click();
    await settle(page);
    expect(compareTable(await readTable(page), tableOf('line'))).toEqual([]);
    await page.evaluate(() => {
      const row = document.querySelector('#chart table tbody tr')!;
      const [a, b] = row.querySelectorAll('td');
      const t = a!.textContent; a!.textContent = b!.textContent; b!.textContent = t;
    });
    expect(compareTable(await readTable(page), tableOf('line')).length).toBeGreaterThan(0);
    await page.evaluate(() => {
      const row = document.querySelector('#chart table tbody tr')!;
      const [a, b] = row.querySelectorAll('td');
      const t = a!.textContent; a!.textContent = b!.textContent; b!.textContent = t;
      const [, h1, h2] = document.querySelectorAll('#chart table thead th');
      const u = h1!.textContent; h1!.textContent = h2!.textContent; h2!.textContent = u;
    });
    expect(compareTable(await readTable(page), tableOf('line')).length).toBeGreaterThan(0);
    expect(await closePage(page)).toEqual([]);
  });

  it('A1 line: negative control: the summary check reports a summary without its range statement', async () => {
    const page = await devPage();
    await create(page, 'line');
    const description = (await axOf(page, '#chart figure')).description;
    expect(missingClauses(description, summaryClauses('line'))).toEqual([]);
    const without = description.split(/(?<=\.)\s+/).filter(s => !s.startsWith('Energy from')).join(' ');
    expect(without).not.toBe(description);
    expect(missingClauses(without, summaryClauses('line')).length).toBeGreaterThan(0);
    expect(await closePage(page)).toEqual([]);
  });

  it('A2 line: negative control: reading the value text fails when the range has lost focus, and when it is no longer exposed as a slider', async () => {
    const page = await devPage();
    await create(page, 'line');
    await page.focus('#before');
    await page.keyboard.press('Tab');
    expect(await valueText(page)).not.toBe('');
    // Out of the chart with the keyboard: Tab to the toolbar, Tab again to the button after the chart.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('after');
    await expect(valueText(page), 'focus is on the button after the chart').rejects.toThrow(/focus/);
    await page.focus('#chart .axylo-proxy');
    // A focusable input keeps its role against role="presentation" in Chrome; turning it into a text field does not.
    await page.evaluate(() => { (document.querySelector('#chart .axylo-proxy') as HTMLInputElement).type = 'text'; });
    await expect(valueText(page)).rejects.toThrow(/slider/);
    expect(await closePage(page)).toEqual([]);
  });

  it('I1 bar: negative control: the occlusion check reports a tooltip moved over the active bars', async () => {
    const page = await devPage();
    await create(page, 'bar');
    const bars = ((await shapes(page, '#chart', 100000))[1] ?? []).map(s => s.box).sort((a, b) => a.x - b.x);
    const p = await box(page, '#chart .axylo-proxy');
    await page.mouse.move(bars[1]!.x + bars[1]!.width / 2, p.y + 4);
    await settle(page);
    const tip = await box(page, '#chart .axylo-tooltip');
    expect(covered(tip, [bars[1]!])).toEqual([]);
    await page.evaluate(({ x, y }) => { const t = document.querySelector('#chart .axylo-tooltip') as HTMLElement; t.style.position = 'fixed'; t.style.left = `${x}px`; t.style.top = `${y}px`; t.style.transform = 'none'; }, center(bars[1]!));
    expect(covered(await box(page, '#chart .axylo-tooltip'), [bars[1]!]).length).toBe(1);
    expect(await closePage(page)).toEqual([]);
  });

  it('I5 line: negative control: the motion trace reports an entry animation added to the marks, and an update transition that outlasts 200 ms', async () => {
    const page = await devPage();
    const { optionsFor } = await import('./fixtures');
    const { fn, options } = optionsFor('line');
    // An entry fade started on the marks' group as soon as it exists, as a library animation would be.
    const fade = "const go = () => { const s = document.querySelector('#chart .axylo-scene'); if (s) s.animate([{ opacity: 0 }, { opacity: 1 }], 1000); else requestAnimationFrame(go); }; requestAnimationFrame(go);";
    const entry = await traceMotion(page, `window.charts.push(window.Axylo.${fn}('#chart', ${JSON.stringify(options)})); ${fade}`, 1500);
    expect(entry.animated).toBe(true);
    expect(entry.settledAt).toBeGreaterThan(200);
    await page.close();
    const second = await devPage();
    await create(second, 'line');
    // A 600 ms transition started with the update, as a library transition would be.
    const update = await traceMotion(second, `window.charts[0].update({ data: ${JSON.stringify([{ day: '2026-03-02', site: 'North', energy: 30 }, { day: '2026-03-03', site: 'North', energy: 2 }])} }); requestAnimationFrame(() => document.querySelector('#chart .axylo-scene').animate([{ opacity: 0.2 }, { opacity: 1 }], 600));`, 1000);
    expect(update.settledAt).toBeGreaterThan(200);
    expect(await closePage(second)).toEqual([]);
  });

  it('T-reference-line: negative control: the reference check finds nothing once the line is removed, and a wrong colour once it is repainted', async () => {
    const page = await devPage();
    await create(page, 'line', { reference: [{ y: 200, label: 'Ceiling' }] });
    const marks = await referenceMarks(page);
    expect(marks.filter(m => m.kind === 'line')).toHaveLength(1);
    await page.evaluate(() => { for (const el of document.querySelectorAll<SVGElement>('#chart svg.axylo-svg .axylo-scene *')) if (/--axylo-reference/.test(el.style.getPropertyValue('color'))) el.style.setProperty('stroke', 'transparent'); });
    const { img, box: view, scale } = await screenshot(page, '#chart .axylo-plot');
    const m = (await referenceMarks(page)).find(r => r.kind === 'line')!;
    const at = modeColor(img, { x0: (m.box.x + m.box.width / 2 - view.x) * scale - 1, y0: (m.box.y - view.y) * scale - 1, x1: (m.box.x + m.box.width / 2 - view.x) * scale + 2, y1: (m.box.y - view.y) * scale + 2 }).color;
    expect(at).toEqual(modeColor(img, { x0: 0, y0: 0, x1: img.width, y1: img.height }).color);
    await page.evaluate(() => { for (const el of document.querySelectorAll('#chart svg.axylo-svg .axylo-scene *')) if (/--axylo-reference/.test((el as SVGElement).style.getPropertyValue('color'))) el.remove(); });
    expect(await referenceMarks(page)).toEqual([]);
    expect(await closePage(page)).toEqual([]);
  });

  it('I1 line: negative control: the layout comparison flags a strip that takes room in the flow only while a datum is shown', async () => {
    const page = await devPage();
    await create(page, 'line');
    const before = await figureLayout(page);
    expect(await figureLayout(page)).toBe(before);
    // A strip that appears in the flow with text, as an unreserved readout would.
    await page.evaluate(() => {
      const strip = document.createElement('div');
      strip.className = 'unreserved-strip';
      strip.style.cssText = 'height: 34px;';
      strip.textContent = 'Mar 2, 2026: North 12 kWh; South 7 kWh';
      const fig = document.querySelector('#chart figure')!;
      fig.insertBefore(strip, fig.querySelector('.axylo-controls'));
    });
    expect(await figureLayout(page)).not.toBe(before);
    expect(await closePage(page)).toEqual([]);
  });

  it('T-dense-line: negative control: the spike-column check reports a spike moved five columns away', async () => {
    const page = await devPage();
    await page.evaluate(async () => {
      const n = 100_000;
      const x = new Float64Array(n), y = new Float64Array(n);
      for (let i = 0; i < n; i++) { x[i] = i; y[i] = 40 + (i % 3); }
      y[61_234] = 95;
      const w = window as unknown as { Axylo: Record<string, (t: string, o: unknown) => { __bench: { ready(): Promise<void> } }>; charts: unknown[] };
      const chart = w.Axylo.line!('#chart', { title: 'Dense', data: { columns: { x, y } }, x: { field: 'x', domain: [0, n - 1] }, y: { field: 'y', domain: [0, 100] } });
      w.charts.push(chart);
      await chart.__bench.ready();
    });
    const plot = await box(page, '#chart .axylo-proxy');
    const spike = { x: plot.x + (61_234 / 99_999) * plot.width, y: plot.y + 0.05 * plot.height };
    expect(spikeColumn(await strokeRuns(page, 1), spike, 1)).toMatchObject({ reached: true, outside: [] });
    const moved = (await strokeRuns(page, 1)).map(run => run.map(p => (Math.abs(p.y - spike.y) <= 0.75 ? { ...p, x: p.x + 5 } : p)));
    const result = spikeColumn(moved, spike, 1);
    expect(result.reached).toBe(false);
    expect(result.outside.length).toBeGreaterThan(0);
    expect(await closePage(page)).toEqual([]);
  });
});
