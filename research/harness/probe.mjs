// Drives system Chrome through every library x task and records what a reader and a developer would observe.
// Usage: node probe.mjs [phase ...]   phases: look, empty, a11y, env, perf, dates, sentinels, lightonly   (default: the first five)
// LIBS=chartjs-tuned,echarts-tuned node probe.mjs perf   runs a subset
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';
import fs from 'node:fs';

const BASE = 'http://localhost:4173/';
const LIBS = ['chartjs', 'recharts', 'd3', 'echarts', 'highcharts', 'apexcharts', 'plotly', 'nivo', 'mui', 'uplot', 'axylo'];
const only = process.env.LIBS?.split(',') ?? LIBS;
const phases = process.argv.slice(2).length ? process.argv.slice(2) : ['look', 'empty', 'a11y', 'env', 'perf'];
fs.mkdirSync('shots', { recursive: true });
const resultsFile = 'results.json';
const results = fs.existsSync(resultsFile) ? JSON.parse(fs.readFileSync(resultsFile, 'utf8')) : {};
const save = () => fs.writeFileSync(resultsFile, JSON.stringify(results, null, 1));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
results._env = { chrome: browser.version(), date: new Date().toISOString(), headless: true };
// every invocation is recorded, so a later partial run does not erase when earlier results were taken
(results._runs ??= []).push({ date: results._env.date, chrome: results._env.chrome, phases, libs: only, settleMs: Number(process.env.SETTLE ?? 1800) });

const SETTLE = Number(process.env.SETTLE ?? 1800);
async function open(ctxOpts, lib, task, extra = '', settle = SETTLE, timeout = 60000, marks = null) {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 520 }, timezoneId: 'UTC', locale: 'en-US', ...ctxOpts });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => { if (['warning', 'error'].includes(m.type())) logs.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
  page.on('pageerror', e => logs.push(`pageerror: ${String(e).slice(0, 300)}`));
  if (marks) { // main-thread accounting from the browser itself, independent of how a library schedules its work
    const cdp = await ctx.newCDPSession(page); await cdp.send('Performance.enable');
    await page.exposeFunction('__mark', async name => { const { metrics } = await cdp.send('Performance.getMetrics'); marks[name] = Object.fromEntries(metrics.map(m => [m.name, m.value])); });
  }
  await page.goto(`${BASE}?lib=${lib}&task=${task}${extra}`);
  let res;
  try { res = await (await page.waitForFunction(() => window.__result, null, { timeout })).jsonValue(); }
  catch { res = { noResultWithinMs: timeout }; }
  if (settle) await sleep(settle);
  return { ctx, page, logs, res };
}

const domStats = lib => {
  const el = document.getElementById('chart');
  const all = [...el.querySelectorAll('*')];
  const attrs = ['role', 'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-hidden', 'aria-live', 'tabindex', 'aria-roledescription'];
  const marked = all.filter(n => attrs.some(a => n.hasAttribute(a))).slice(0, 40).map(n => {
    const o = { tag: n.tagName.toLowerCase() };
    for (const a of attrs) if (n.hasAttribute(a)) o[a] = n.getAttribute(a).slice(0, 160);
    return o;
  });
  const texts = [...el.querySelectorAll('svg text')].filter(t => t.textContent.trim());
  const sizes = {}, fills = {};
  for (const t of texts) { const cs = getComputedStyle(t); sizes[cs.fontSize] = (sizes[cs.fontSize] ?? 0) + 1; fills[cs.fill] = (fills[cs.fill] ?? 0) + 1; }
  const htmlText = {};
  if (lib === 'axylo') {
    // Axylo draws the marks in SVG and lays out the plot labels in HTML.
    htmlText.htmlTextSizes = {};
    htmlText.htmlTextColors = {};
    for (const t of el.querySelectorAll('.axylo-text > .axylo-label')) {
      if (!t.textContent.trim() || !t.getClientRects().length) continue;
      const { fontSize, color } = getComputedStyle(t);
      htmlText.htmlTextSizes[fontSize] = (htmlText.htmlTextSizes[fontSize] ?? 0) + 1;
      htmlText.htmlTextColors[color] = (htmlText.htmlTextColors[color] ?? 0) + 1;
    }
  }
  const big = el.querySelector('svg, canvas');
  return {
    nodes: all.length, svg: el.querySelectorAll('svg').length, canvas: el.querySelectorAll('canvas').length,
    svgTitle: el.querySelectorAll('svg title').length, svgDesc: el.querySelectorAll('svg desc').length,
    tables: el.querySelectorAll('table').length, markedCount: all.filter(n => attrs.some(a => n.hasAttribute(a))).length, marked,
    canvasFallback: [...el.querySelectorAll('canvas')].map(c => c.textContent.trim().slice(0, 120)),
    svgTextSizes: sizes, svgTextFills: fills, mainWidth: big ? Math.round(big.getBoundingClientRect().width) : null,
    mainHeight: big ? Math.round(big.getBoundingClientRect().height) : null, ...htmlText,
  };
};

const shot = async (page, name) => { const p = `shots/${name}.png`; await page.locator('#chart').screenshot({ path: p }); return p; };
const diffRatio = (a, b) => {
  const A = PNG.sync.read(a), B = PNG.sync.read(b);
  if (A.width !== B.width || A.height !== B.height) return 1;
  let n = 0;
  for (let i = 0; i < A.data.length; i += 4) if (Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]) > 30) n++;
  return n / (A.data.length / 4);
};
const bodyLines = page => page.evaluate(() => document.body.innerText.split('\n').map(s => s.trim()).filter(Boolean));

for (const lib of only) {
  const R = (results[lib] ??= {});

  if (phases.includes('look')) for (const task of ['trend', 'bars', 'parts', 'dirty']) {
    const { ctx, page, logs, res } = await open({}, lib, task);
    const out = { res, logs };
    if (!res.unsupported) {
      out.dom = await page.evaluate(domStats, lib);
      out.aria = (await page.locator('#chart').ariaSnapshot().catch(e => 'ERR ' + e)).slice(0, 2500);
      await shot(page, `${task}-${lib}`);
    }
    R[task] = out; save(); await ctx.close();
    console.log(lib, task, JSON.stringify(res).slice(0, 120), logs.length ? `logs:${logs.length}` : '');
  }

  if (phases.includes('empty')) {
    // the query returned no rows: what does the reader see, and what does assistive technology get?
    const { ctx, page, logs, res } = await open({}, lib, 'empty');
    R.empty = { res, logs: logs.slice(0, 4), text: (await bodyLines(page)).filter(l => !['before', 'after'].includes(l)).slice(0, 12),
      aria: (await page.locator('#chart').ariaSnapshot().catch(e => 'ERR ' + e)).slice(0, 600) };
    await shot(page, `empty-${lib}`); await ctx.close(); save();
    console.log(lib, 'empty', JSON.stringify(R.empty.text).slice(0, 160), logs.length ? `logs:${logs.length}` : '');
  }

  if (phases.includes('dates')) {
    // the same daily series given as instants (task trend) and as calendar-date strings (task dates), read in three zones
    R.dates = {};
    for (const task of ['trend', 'dates']) for (const [tz, tag] of [['UTC', 'utc'], ['America/Los_Angeles', 'la'], ['Asia/Kolkata', 'kolkata']]) {
      const o = await open({ timezoneId: tz }, lib, task);
      const rec = { res: o.res.error ? { error: o.res.error.slice(0, 160) } : o.res.unsupported ? 'unsupported' : 'ok' };
      if (rec.res === 'ok') {
        const b0 = await bodyLines(o.page);
        const box = await o.page.locator('#chart').boundingBox();
        await o.page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
        await o.page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.45, { steps: 8 });
        await sleep(500);
        rec.hoverText = (await bodyLines(o.page)).filter(l => !b0.includes(l)).slice(0, 8);
        // canvas tooltips are invisible to text capture: ask Chart.js for the tooltip it would show for one known datum (index 54 = 2026-02-24)
        if (lib === 'chartjs') rec.tooltipForIndex54 = await o.page.evaluate(() => { const c = window.__handle.chart; c.tooltip.setActiveElements([{ datasetIndex: 0, index: 54 }], { x: 0, y: 0 }); c.update(); return { title: c.tooltip.title, body: c.tooltip.body.map(b => b.lines).flat() }; });
        // Read the visible Axylo heading separately so the table can retain its time zone.
        if (lib === 'axylo') rec.readoutTitle = (await o.page.locator('#chart .axylo-tooltip-title:visible').allTextContents())[0] ?? null;
        await shot(o.page, `${task === 'dates' ? 'datestr' : 'instant'}-${tag}-${lib}`);
      }
      (R.dates[task] ??= {})[tag] = rec; await o.ctx.close();
    }
    save(); console.log(lib, 'dates', JSON.stringify(R.dates).slice(0, 400));
  }

  if (phases.includes('sentinels')) {
    R.sentinels = {};
    for (const kind of ['null', 'nan', 'string', 'undefined']) {
      const { ctx, page, logs, res } = await open({}, lib, `dirty-${kind}`);
      R.sentinels[kind] = { error: res.error ? res.error.split('\n')[0].slice(0, 160) : null, logCount: logs.length, firstLog: logs[0]?.slice(0, 140) ?? null };
      await shot(page, `one-${kind}-${lib}`); await ctx.close();
    }
    save(); console.log(lib, 'sentinels', JSON.stringify(R.sentinels).slice(0, 300));
  }

  if (phases.includes('lightonly')) {
    // a page that declares itself light-only, viewed on a device set to dark: the chart should stay light
    const { ctx, page } = await open({ colorScheme: 'dark' }, lib, 'trend', '&scheme=light');
    await shot(page, `lightonly-${lib}`); await ctx.close();
  }

  if (phases.includes('a11y')) {
    const { ctx, page } = await open({}, lib, 'trend');
    const k = { stops: [] };
    await page.focus('#before');
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const a = await page.evaluate(() => {
        const e = document.activeElement, c = document.getElementById('chart');
        if (e.id === 'after') return 'AFTER';
        if (!c.contains(e)) return 'OUTSIDE:' + e.tagName;
        const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
        return { tag: e.tagName.toLowerCase(), role: e.getAttribute('role'), label: (e.getAttribute('aria-label') ?? e.textContent ?? '').trim().slice(0, 120), cls: String(e.className?.baseVal ?? e.className).slice(0, 60), box: [Math.round(r.width), Math.round(r.height)], outline: cs.outlineStyle + ' ' + cs.outlineWidth };
      });
      if (a === 'AFTER') break;
      k.stops.push(a);
    }
    // arrow-key exploration from the first stop inside the chart
    await page.focus('#before'); await page.keyboard.press('Tab');
    const before = await bodyLines(page);
    const describe = () => page.evaluate(lib => {
      const e = document.activeElement;
      const live = [...document.querySelectorAll('[aria-live]')].map(n => n.textContent.trim().slice(0, 200)).filter(Boolean);
      const value = lib === 'axylo' ? { valueText: e.getAttribute('aria-valuetext') } : {};
      return { active: (e.getAttribute?.('aria-label') ?? e.textContent ?? '').trim().slice(0, 160), tag: e.tagName.toLowerCase(), live, ...value };
    }, lib);
    k.arrows = [];
    for (const key of ['ArrowRight', 'ArrowRight', 'ArrowDown', 'Enter']) { await page.keyboard.press(key); await sleep(250); k.arrows.push({ key, ...(await describe()) }); }
    const after = await bodyLines(page);
    k.newTextAfterKeys = after.filter(l => !before.includes(l)).slice(0, 12);
    await shot(page, `kbd-${lib}`);
    R.keyboard = k; await ctx.close();

    // pointer hover: what does the default tooltip say?
    for (const [tz, tag] of [['UTC', 'utc'], ['America/Los_Angeles', 'la']]) {
      const o = await open({ timezoneId: tz }, lib, 'trend');
      const b0 = await bodyLines(o.page);
      const box = await o.page.locator('#chart').boundingBox();
      await o.page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
      await o.page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.45, { steps: 8 });
      await sleep(500);
      const b1 = await bodyLines(o.page);
      R[`hover_${tag}`] = { newText: b1.filter(l => !b0.includes(l)).slice(0, 14) };
      await shot(o.page, `hover-${tag}-${lib}`);
      await o.ctx.close();
    }
    save(); console.log(lib, 'a11y', k.stops.length, 'tab stops');
  }

  if (phases.includes('env')) {
    // container resize
    { const { ctx, page } = await open({}, lib, 'trend');
      await page.evaluate(() => { document.getElementById('chart').style.width = '360px'; });
      await sleep(900);
      R.resize = await page.evaluate(() => { const c = document.getElementById('chart'); return { widestGraphic: Math.max(...[...c.querySelectorAll('svg, canvas')].map(n => Math.round(n.getBoundingClientRect().width))), scrollWidth: c.scrollWidth }; });
      await shot(page, `resize-${lib}`); await ctx.close(); }
    // born narrow (phone width)
    { const { ctx, page } = await open({}, lib, 'trend', '&w=340'); await shot(page, `narrow-${lib}`); await ctx.close(); }
    // dark scheme
    { const { ctx, page } = await open({ colorScheme: 'dark' }, lib, 'trend'); await shot(page, `dark-${lib}`); await ctx.close(); }
    // motion: compare an early frame with the settled frame, with and without prefers-reduced-motion
    for (const rm of ['no-preference', 'reduce']) {
      const { ctx, page } = await open({ reducedMotion: rm }, lib, 'bars', '', 0);
      const early = await page.locator('#chart').screenshot();
      await sleep(2500);
      const late = await page.locator('#chart').screenshot();
      R[`motion_${rm}`] = { earlyVsSettledDiff: +diffRatio(early, late).toFixed(4) };
      await ctx.close();
    }
    save(); console.log(lib, 'env', R.resize, R['motion_no-preference'], R.motion_reduce);
  }

  if (phases.includes('perf')) {
    R.scale = {};
    for (const n of [10000, 100000, 1000000]) {
      const prev = R.scale[n / 10];
      if (prev && (prev.noResultWithinMs || prev.error || prev.toPaintMs > 8000)) { R.scale[n] = { skipped: 'previous size too slow' }; continue; }
      const runs = [];
      for (let i = 0; i < 3; i++) { const marks = {}; const { ctx, res } = await open({}, lib, 'scale', `&n=${n}`, 0, 45000, marks); if (marks['create:end']) res.taskMs = 1000 * (marks['create:end'].TaskDuration - marks['create:start'].TaskDuration); runs.push(res); await ctx.close(); if (res.noResultWithinMs || res.error) break; }
      const ok = runs.filter(r => r.toPaintMs).map(r => r.toPaintMs).sort((a, b) => a - b);
      const task = runs.filter(r => r.taskMs).map(r => r.taskMs).sort((a, b) => a - b);
      R.scale[n] = ok.length ? { toPaintMs: +ok[Math.floor(ok.length / 2)].toFixed(1), runs: ok.map(v => +v.toFixed(1)), taskMs: task.length ? +task[Math.floor(task.length / 2)].toFixed(1) : null, taskRuns: task.map(v => +v.toFixed(1)), failedRuns: runs.length - ok.length } : runs[runs.length - 1];
      save(); console.log(lib, 'scale', n, JSON.stringify(R.scale[n]).slice(0, 160));
    }
    { const marks = {}; const { ctx, res, logs } = await open({}, lib, 'stream', '', 0, 90000, marks);
      if (marks['stream:end']) { const d = k => 1000 * (marks['stream:end'][k] - marks['stream:start'][k]); res.taskMsPerUpdate = d('TaskDuration') / res.frames; res.scriptMsPerUpdate = d('ScriptDuration') / res.frames; res.layoutStyleMsPerUpdate = (d('LayoutDuration') + d('RecalcStyleDuration')) / res.frames; }
      for (const key in res) if (typeof res[key] === 'number') res[key] = +res[key].toFixed(2);
      R.stream = { ...res, logs: logs.slice(0, 3) }; await ctx.close(); save(); console.log(lib, 'stream', JSON.stringify(R.stream).slice(0, 200)); }
  }
}
save();
await browser.close();
