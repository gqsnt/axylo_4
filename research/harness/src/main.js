import * as data from './data.js';
const mods = import.meta.glob('./libs/*.{js,jsx}');
const q = new URLSearchParams(location.search);
const lib = q.get('lib'), task = q.get('task') ?? 'trend', n = Number(q.get('n') ?? 100000);
const el = document.getElementById('chart');
if (q.get('w')) el.style.width = q.get('w') + 'px';
if (q.get('scheme')) document.documentElement.style.colorScheme = q.get('scheme'); // e.g. a light-only page under a dark OS
const mark = name => window.__mark ? window.__mark(name) : null; // the probe records CDP main-thread metrics at these points
const raf = () => new Promise(r => requestAnimationFrame(() => r()));
window.__result = null;
(async () => {
  const key = Object.keys(mods).find(k => k.startsWith(`./libs/${lib}.`));
  if (!key) { el.textContent = 'Choose a library and task, for example ?lib=axylo&task=trend'; return; }
  try {
    const m = await mods[key]();
    const one = task.startsWith('dirty-') ? task.slice(6) : null;
    const fn = task === 'empty' ? m.trend : one ? m.dirty : m[task];
    if (!fn) { window.__result = { unsupported: true }; el.textContent = `${lib}: ${task} not supported`; return; }
    // "empty": the trend chart when the query returned no rows
    const d = task === 'scale' ? data.scale(n) : task === 'stream' ? data.stream()
      : task === 'empty' ? { ...data.trend, title: 'Daily sessions by channel', t: [], series: data.trend.series.map(s => ({ ...s, values: [] })) }
      : one ? data.dirtyOne(one)
      : data[task];
    await raf();
    await mark('create:start');
    const t0 = performance.now();
    const handle = await fn(el, d);
    const t1 = performance.now();
    await raf(); await raf();
    const t2 = performance.now();
    window.__handle = handle;
    const res = { createMs: t1 - t0, toPaintMs: t2 - t0 };
    if (window.__mark) { await new Promise(r => setTimeout(r, 1600)); await mark('create:end'); } // long enough for entry animations to finish
    if (task === 'stream') {
      // let entry animations settle, then push one point per frame
      await new Promise(r => setTimeout(r, 1500));
      const frames = Number(q.get('frames') ?? 300), push = [], gaps = [];
      await mark('stream:start');
      let last = performance.now();
      for (let i = 0; i < frames; i++) {
        const [x, y] = d.next();
        const a = performance.now(); handle.push(x, y); push.push(performance.now() - a);
        await raf(); const now = performance.now(); gaps.push(now - last); last = now;
      }
      await raf(); await mark('stream:end');
      const pct = (arr, p) => [...arr].sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * p))];
      Object.assign(res, { pushP50: pct(push, 0.5), pushP95: pct(push, 0.95), frameP50: pct(gaps, 0.5), frameP95: pct(gaps, 0.95), framesOver20ms: gaps.filter(g => g > 20).length, frames });
    }
    window.__result = res;
  } catch (e) { console.error(e); window.__result = { error: String(e?.stack ?? e) }; }
})();
