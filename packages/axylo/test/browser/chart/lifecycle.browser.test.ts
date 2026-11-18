/**
 * Resize (spec L3), the commit contract (plan 1.5, spec DX5) and teardown, observed through the stage
 * counters the development build exposes (`chart.__dev.stages()`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { start, stop } from '../harness';
import { chartPage, closePage } from './util';

beforeAll(start);
afterAll(stop);

describe('resize (spec L3)', () => {
  it('720 → 360 → 720 px relayouts with no call from the page and does not renormalize', async () => {
    const page = await chartPage();
    const result = await page.evaluate(async () => {
      const el = document.getElementById('chart')!;
      const chart = window.Axylo.line!(el, { title: 'T', data: window.fx.trendRows(), x: { field: 'day', type: 'time', timeZone: 'UTC' }, y: 'sessions', series: 'channel' });
      window.charts.push(chart);
      await chart.__bench.ready();
      const widths: number[] = [];
      const lastLabelRight = () => Math.max(...[...el.querySelectorAll('.axylo-label')].map(l => l.getBoundingClientRect().right)) - el.getBoundingClientRect().left;
      const marks = () => (el.querySelector('.axylo-canvas') as HTMLElement).getBoundingClientRect().width;
      const first = chart.__dev.stages();
      widths.push(marks());
      el.style.width = '360px';
      await window.nextFrames(3);
      widths.push(marks());
      const narrow = lastLabelRight();
      el.style.width = '720px';
      await window.nextFrames(3);
      widths.push(marks());
      const last = chart.__dev.stages();
      return { widths, narrow, first, last };
    });
    expect(result.widths).toEqual([720, 360, 720]);
    expect(result.narrow).toBeLessThanOrEqual(361);
    expect(result.last.layout - result.first.layout).toBe(2);
    expect(result.last.normalize).toBe(result.first.normalize);
    expect(result.last.options).toBe(result.first.options);
    expect(await closePage(page)).toEqual([]);
  });

  it('a container created with display: none draws once shown', async () => {
    const page = await chartPage({ css: '#chart { display: none; }' });
    const result = await page.evaluate(async () => {
      const chart = window.Axylo.line!('#chart', { title: 'Hidden', data: window.fx.trendRows(), x: 'day', y: 'sessions', series: 'channel' });
      let ready = false;
      void chart.__bench.ready().then(() => { ready = true; });
      await window.nextFrames(3);
      const hidden = { ready, draws: chart.__dev.stages().draw };
      document.getElementById('chart')!.style.display = 'block';
      await chart.__bench.ready();
      await window.nextFrames(2);
      return { hidden, draws: chart.__dev.stages().draw, labels: document.querySelectorAll('#chart .axylo-label').length };
    });
    expect(result.hidden).toEqual({ ready: false, draws: 0 });
    expect(result.draws).toBe(1);
    expect(result.labels).toBeGreaterThan(3);
    expect(await closePage(page)).toEqual([]);
  });

  it('a height: auto container gets a 16:9 plot, clamped to 160–480 px, stable over 10 frames', async () => {
    const page = await chartPage({ css: '#chart { height: auto; } .w { height: auto; }' });
    const result = await page.evaluate(async () => {
      const chart = window.Axylo.line!('#chart', { title: 'Auto', data: window.fx.trendRows(), x: 'day', y: 'sessions', series: 'channel' });
      await chart.__bench.ready();
      const plot = document.querySelector('#chart .axylo-plot')!;
      const heights: number[] = [];
      const layouts: number[] = [];
      for (let i = 0; i < 10; i++) {
        await window.nextFrames(1);
        heights.push(plot.getBoundingClientRect().height);
        layouts.push(chart.__dev.stages().layout);
      }
      const clamp: number[] = [];
      for (const width of [200, 1200]) {
        const el = Object.assign(document.body.appendChild(document.createElement('div')), { className: 'w' });
        el.style.width = `${width}px`;
        const c = window.Axylo.line!(el, { title: 'W', data: window.fx.trendRows(), x: 'day', y: 'sessions', series: 'channel' });
        await c.__bench.ready();
        clamp.push(el.querySelector('.axylo-plot')!.getBoundingClientRect().height);
      }
      return { heights, layouts, clamp };
    });
    expect(new Set(result.heights).size).toBe(1);
    expect(result.heights[0]).toBeCloseTo(720 * 9 / 16, 0);
    expect(new Set(result.layouts).size).toBe(1);
    expect(result.clamp).toEqual([160, 480]);
    expect(await closePage(page)).toEqual([]);
  });

  it('a definite container height is filled: the plot takes what the caption leaves', async () => {
    const page = await chartPage({ css: '#chart { height: 300px; }' });
    const result = await page.evaluate(async () => {
      const chart = window.Axylo.line!('#chart', { title: 'Fixed', subtitle: 'Subtitle', data: window.fx.trendRows(), x: 'day', y: 'sessions', series: 'channel' });
      await chart.__bench.ready();
      const root = document.getElementById('chart')!.getBoundingClientRect();
      const fig = document.querySelector('#chart figure')!.getBoundingClientRect();
      const plot = document.querySelector('#chart .axylo-plot')!.getBoundingClientRect();
      return { root: root.bottom, fig: fig.bottom, plot: plot.bottom, plotHeight: plot.height };
    });
    expect(result.fig).toBeCloseTo(result.root, 0);
    expect(result.plot).toBeCloseTo(result.root, 0);
    expect(result.plotHeight).toBeLessThan(300);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('commit contract (plan 1.5, spec DX5)', () => {
  it('update({ data }), append and zoom in one turn are drawn once and end in the expected state', async () => {
    const page = await chartPage();
    const result = await page.evaluate(async () => {
      const DAY = 864e5;
      const rows = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ day: from + i * DAY, v: i }));
      const t0 = Date.UTC(2026, 0, 1);
      const chart = window.Axylo.line!('#chart', { title: 'Seq', data: rows(t0, 30), x: { field: 'day', type: 'time', timeZone: 'UTC' }, y: 'v' });
      await chart.__bench.ready();
      const before = chart.__dev.stages();
      const replaced = rows(t0 + 100 * DAY, 10);
      chart.update({ data: replaced });
      chart.append([{ day: t0 + 110 * DAY, v: 10 }, { day: t0 + 111 * DAY, v: 11 }]);
      chart.zoom([new Date(t0 + 105 * DAY), new Date(t0 + 111 * DAY)]);
      const sync = chart.__dev.stages();
      await chart.__bench.ready();
      await window.nextFrames(2);
      const after = chart.__dev.stages();
      return { before, sync, after, describe: chart.__bench.describe(), t0, DAY };
    });
    const { before, sync, after, describe, t0, DAY } = result;
    expect(sync.draw).toBe(before.draw);
    expect(after.draw - before.draw).toBe(1);
    expect(after.frame - before.frame).toBe(1);
    expect(describe.series[0]!.points).toBe(12);
    expect(describe.series[0]!.oldestX).toBe(t0 + 100 * DAY);
    expect(describe.series[0]!.newestX).toBe(t0 + 111 * DAY);
    expect(describe.xDomain).toEqual([t0 + 105 * DAY, t0 + 111 * DAY]);
    expect(await closePage(page)).toEqual([]);
  });

  it('append with keep keeps that many x values, and a window zoomed to the latest edge follows', async () => {
    const page = await chartPage();
    const result = await page.evaluate(async () => {
      const t0 = Date.UTC(2026, 0, 1);
      const M = 60000;
      const chart = window.Axylo.line!('#chart', { title: 'Stream', data: { columns: { t: Float64Array.from({ length: 100 }, (_, i) => t0 + i * M), v: Float64Array.from({ length: 100 }, (_, i) => i) } }, x: { field: 't', type: 'time', timeZone: 'UTC' }, y: 'v' });
      chart.zoom([new Date(t0 + 80 * M), new Date(t0 + 99 * M)]);
      for (let i = 100; i < 110; i++) chart.append([{ t: t0 + i * M, v: i }], { keep: 100 });
      await chart.__bench.ready();
      return { d: chart.__bench.describe(), stages: chart.__dev.stages(), t0, M };
    });
    const { d, t0, M } = result;
    expect(d.series[0]!.points).toBe(100);
    expect(d.series[0]!.oldestX).toBe(t0 + 10 * M);
    expect(d.series[0]!.newestX).toBe(t0 + 109 * M);
    expect(d.xDomain).toEqual([t0 + 90 * M, t0 + 109 * M]);
    expect(result.stages.normalize).toBe(1);
    expect(result.stages.draw).toBe(1);
    expect(await closePage(page)).toEqual([]);
  });

  it('a title-only update does not renormalize, rebuild the view or relayout the plot', async () => {
    const page = await chartPage({ css: '#chart { height: auto; }' });
    const result = await page.evaluate(async () => {
      const chart = window.Axylo.line!('#chart', { title: 'Before', data: window.fx.trendRows(), x: 'day', y: 'sessions', series: 'channel' });
      await chart.__bench.ready();
      const before = chart.__dev.stages();
      chart.update({ title: 'After' });
      await chart.__bench.ready();
      await window.nextFrames(2);
      return { before, after: chart.__dev.stages(), heading: document.querySelector('#chart .axylo-title')!.textContent };
    });
    expect(result.heading).toBe('After');
    for (const stage of ['normalize', 'view', 'layout', 'scene', 'draw'] as const) expect(result.after[stage], stage).toBe(result.before[stage]);
    expect(result.after.reader).toBe(result.before.reader! + 1);
    expect(await closePage(page)).toEqual([]);
  });

  it('a data-only update that keeps the domains does not relayout', async () => {
    const page = await chartPage();
    const result = await page.evaluate(async () => {
      const t0 = Date.UTC(2026, 0, 1);
      const rows = (k: number) => Array.from({ length: 30 }, (_, i) => ({ day: t0 + i * 864e5, v: 50 + ((i * k) % 7) }));
      const chart = window.Axylo.line!('#chart', { title: 'T', data: rows(1), x: { field: 'day', type: 'time', timeZone: 'UTC' }, y: 'v' });
      await chart.__bench.ready();
      const before = chart.__dev.stages();
      chart.update({ data: rows(3) });
      await chart.__bench.ready();
      const same = chart.__dev.stages();
      chart.update({ data: rows(3).map(r => ({ ...r, v: r.v * 3 })) });
      await chart.__bench.ready();
      return { before, same, wider: chart.__dev.stages() };
    });
    expect(result.same.normalize).toBe(result.before.normalize! + 1);
    expect(result.same.layout).toBe(result.before.layout);
    expect(result.same.scene).toBe(result.before.scene! + 1);
    expect(result.wider.layout).toBe(result.before.layout! + 1);
    expect(await closePage(page)).toEqual([]);
  });

  it('a rejected strict update throws and leaves the previous chart intact', async () => {
    const page = await chartPage();
    const result = await page.evaluate(async () => {
      const good = Array.from({ length: 7 }, (_, i) => ({ day: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i], value: i }));
      const chart = window.Axylo.line!('#chart', { title: 'Strict', strict: true, data: good, x: 'day', y: 'value' });
      await chart.__bench.ready();
      const before = { stages: chart.__dev.stages(), diagnostics: chart.diagnostics, describe: chart.__bench.describe(), revision: chart.__bench.revision };
      let thrown = '';
      try {
        chart.update({ data: window.fx.dirtyRows(), title: 'Changed' });
      } catch (e) {
        thrown = String(e);
      }
      await window.nextFrames(3);
      return {
        thrown, before,
        after: { stages: chart.__dev.stages(), diagnostics: chart.diagnostics, describe: chart.__bench.describe(), revision: chart.__bench.revision },
        heading: document.querySelector('#chart .axylo-title')!.textContent,
      };
    });
    expect(result.thrown).toMatch(/AX10[236]/);
    expect(result.after.diagnostics).toEqual(result.before.diagnostics);
    expect(result.after.describe).toEqual(result.before.describe);
    expect(result.after.revision).toBe(result.before.revision);
    expect(result.after.stages.draw).toBe(result.before.stages.draw);
    expect(result.heading).toBe('Strict');
    expect(await closePage(page)).toEqual([]);
  });

  it('a rejected strict append leaves the data as it was', async () => {
    const page = await chartPage();
    const result = await page.evaluate(async () => {
      const t0 = Date.UTC(2026, 0, 1);
      const chart = window.Axylo.line!('#chart', { title: 'Strict stream', strict: true, data: [{ t: t0, v: 1 }, { t: t0 + 864e5, v: 2 }], x: { field: 't', type: 'time', timeZone: 'UTC' }, y: 'v' });
      let thrown = '';
      try {
        chart.append([{ t: t0 + 2 * 864e5, v: NaN }]);
      } catch (e) {
        thrown = String(e);
      }
      chart.append([{ t: t0 + 2 * 864e5, v: 3 }]);
      await chart.__bench.ready();
      return { thrown, d: chart.__bench.describe() };
    });
    expect(result.thrown).toMatch(/AX103/);
    expect(result.d.series[0]!.points).toBe(3);
    expect(result.d.series[0]!.missing).toBe(0);
    expect(await closePage(page)).toEqual([]);
  });

  it('destroy() before the frame draws nothing, and empties the target of what the chart added', async () => {
    const page = await chartPage();
    const result = await page.evaluate(async () => {
      const el = document.getElementById('chart')!;
      el.classList.add('mine');
      const chart = window.Axylo.line!(el, { title: 'Gone', data: window.fx.trendRows(), x: 'day', y: 'sessions', series: 'channel' });
      chart.destroy();
      await window.nextFrames(3);
      const stages = chart.__dev.stages();
      chart.update({ title: 'Again' });
      chart.append([{ day: Date.now(), channel: 'Direct', sessions: 1 }]);
      chart.zoom(null);
      await window.nextFrames(2);
      return { stages, later: chart.__dev.stages(), children: el.childElementCount, className: el.className, attributes: [...el.attributes].map(a => a.name) };
    });
    expect(result.stages.draw).toBe(0);
    expect(result.stages.frame).toBe(0);
    expect(result.later).toEqual(result.stages);
    expect(result.children).toBe(0);
    expect(result.className).toBe('mine');
    expect(result.attributes.sort()).toEqual(['class', 'id']);
    expect(await closePage(page)).toEqual([]);
  });

  it('after destroy() no observer or listener fires', async () => {
    const page = await chartPage();
    const result = await page.evaluate(async () => {
      const el = document.getElementById('chart')!;
      const chart = window.Axylo.line!(el, { title: 'Gone', data: window.fx.trendRows(), x: 'day', y: 'sessions', series: 'channel' });
      await chart.__bench.ready();
      chart.destroy();
      const stages = chart.__dev.stages();
      el.style.width = '300px';
      document.documentElement.classList.add('dark');
      document.body.setAttribute('data-theme', 'dark');
      el.dispatchEvent(new PointerEvent('pointermove', { clientX: 100, clientY: 100 }));
      await window.nextFrames(4);
      return { stages, later: chart.__dev.stages(), children: el.childElementCount };
    });
    expect(result.later).toEqual(result.stages);
    expect(result.children).toBe(0);
    expect(await closePage(page)).toEqual([]);
  });
});

describe('memory (spec P7, DX5)', () => {
  it('1,000 create–destroy cycles show no upward heap trend after forced collection', async () => {
    const page = await chartPage();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('HeapProfiler.enable');
    const samples: { cycle: number; used: number }[] = [];
    const STEP = 25;
    for (let cycle = 0; cycle < 1000; cycle += STEP) {
      await page.evaluate(async n => {
        const el = document.getElementById('chart')!;
        const rows = window.fx.trendRows();
        for (let i = 0; i < n; i++) {
          const chart = window.Axylo.line!(el, { title: 'Cycle', data: rows, x: 'day', y: 'sessions', series: 'channel' });
          await chart.__bench.ready();
          chart.destroy();
        }
      }, STEP);
      await cdp.send('HeapProfiler.collectGarbage');
      await cdp.send('HeapProfiler.collectGarbage');
      const { usedSize } = await cdp.send('Runtime.getHeapUsage');
      samples.push({ cycle: cycle + STEP, used: usedSize });
    }
    const mean = (from: number, to: number) => {
      const s = samples.filter(x => x.cycle > from && x.cycle <= to);
      return s.reduce((a, b) => a + b.used, 0) / s.length;
    };
    const early = mean(200, 400);
    const late = mean(800, 1000);
    expect(late / early, `heap mean cycles 200–400: ${Math.round(early)} B, 800–1000: ${Math.round(late)} B`).toBeLessThanOrEqual(1.05);
    const leftovers = await page.evaluate(() => document.getElementById('chart')!.childElementCount);
    expect(leftovers).toBe(0);
    expect(await closePage(page)).toEqual([]);
  }, 300_000);

  // Supplementary to the test above. On this machine the heap measured that way grows by about 6% between
  // cycles 200–400 and 800–1000 and levels off after about 1,500 cycles; heap snapshots attribute the growth
  // to compiled code (V8 InstructionStream, Code and their metadata), not to objects the chart retains. This
  // test counts only what a leak would leave: every heap object except compiled code and V8's own metadata.
  it('objects other than compiled code do not grow from cycle 300 to cycle 1,000', async () => {
    const page = await chartPage();
    const cdp = await page.context().newCDPSession(page);
    const cycles = (n: number) => page.evaluate(async k => {
      const el = document.getElementById('chart')!;
      const rows = window.fx.trendRows();
      for (let i = 0; i < k; i++) {
        const chart = window.Axylo.line!(el, { title: 'Cycle', data: rows, x: 'day', y: 'sessions', series: 'channel' });
        await chart.__bench.ready();
        chart.destroy();
      }
    }, n);
    const retained = async (): Promise<number> => {
      await cdp.send('HeapProfiler.collectGarbage');
      const chunks: string[] = [];
      const onChunk = (e: { chunk: string }) => chunks.push(e.chunk);
      cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
      await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
      cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
      const snap = JSON.parse(chunks.join('')) as { snapshot: { meta: { node_fields: string[]; node_types: [string[]] } }; nodes: number[]; strings: string[] };
      const fields = snap.snapshot.meta.node_fields;
      const types = snap.snapshot.meta.node_types[0];
      const typeAt = fields.indexOf('type');
      const nameAt = fields.indexOf('name');
      const sizeAt = fields.indexOf('self_size');
      let total = 0;
      for (let i = 0; i < snap.nodes.length; i += fields.length) {
        const type = types[snap.nodes[i + typeAt]!];
        const name = snap.strings[snap.nodes[i + nameAt]!]!;
        if (type === 'code' || name.startsWith('system / ')) continue;
        total += snap.nodes[i + sizeAt]!;
      }
      return total;
    };
    await cycles(300);
    const early = await retained();
    await cycles(700);
    const late = await retained();
    // One leaked chart (its DOM, frame and scene) is several kilobytes; 700 of them would be megabytes.
    expect(late - early, `non-code heap at cycle 300: ${early} B, at 1,000: ${late} B`).toBeLessThan(64 * 1024);
    expect(await closePage(page)).toEqual([]);
  }, 300_000);
});
