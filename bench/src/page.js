// The benchmark page: one adapter, one workload, chosen by URL parameters.
//   ?adapter=uplot&workload=first&params={"size":"1x100000"}&settle=500&aparams={"renderer":"svg"}
// The runner exposes three bindings: __benchMetrics(label) snapshots CDP Performance.getMetrics in Node and resolves
// once the snapshot is taken; __benchMemory(label) forces a garbage collection and records heap and process memory;
// __benchDone(result) hands the raw result back. Opened by hand, the page prints the result.
import { workloadData, checksum } from './fixtures.js';

const q = new URLSearchParams(location.search);
const adapterId = q.get('adapter');
const workload = q.get('workload');
const params = JSON.parse(q.get('params') ?? '{}');
const settleMs = Number(q.get('settle') ?? 500);
const adapterParams = JSON.parse(q.get('aparams') ?? '{}');
// Memory is sampled in the create workloads only, always outside the timed window.
const memoryWanted = (workload === 'first' || workload === 'page') && params.memory !== false;

// The binding's reply arrives inside a DevTools command task, and code continuing after `await` would run inside it
// (counted as DevToolsCommandDuration, not ScriptDuration). Measured work therefore starts inside the handler of a
// fresh task. TaskDuration counts it either way; this only keeps the secondary script/devtools split honest.
const inTask = fn => new Promise((resolve, reject) => {
  const c = new MessageChannel();
  c.port1.onmessage = () => { try { resolve(fn()); } catch (e) { reject(e); } };
  c.port2.postMessage(0);
});
const metrics = label => (window.__benchMetrics ? window.__benchMetrics(label) : Promise.resolve());
const memory = label => (window.__benchMemory ? window.__benchMemory(label) : Promise.resolve());
const done = result => {
  if (window.__benchDone) window.__benchDone(result);
  else document.getElementById('status').textContent = JSON.stringify(result, (k, v) => (Array.isArray(v) && v.length > 20 ? `[${v.length} values]` : v), 1);
};
const raf = () => new Promise(r => requestAnimationFrame(r));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const r3 = v => Math.round(v * 1000) / 1000;

function pageEnvironment() {
  let webgl = 'not available: no WebGL context';
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      webgl = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : `not available: WEBGL_debug_renderer_info missing (${gl.getParameter(gl.RENDERER)})`;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch (e) { webgl = `not available: ${e}`; }
  return { devicePixelRatio, userAgent: navigator.userAgent, webglRenderer: webgl, viewport: [innerWidth, innerHeight], hardwareConcurrency: navigator.hardwareConcurrency };
}

// The refresh rate the page observes: median interval of 60 idle animation frames.
async function observeRefresh() {
  const ts = [];
  await new Promise(res => { const f = t => { ts.push(t); if (ts.length < 61) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  const d = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b);
  const median = d[d.length >> 1];
  return { medianIntervalMs: r3(median), hz: r3(1000 / median), minMs: r3(d[0]), maxMs: r3(d[d.length - 1]) };
}

function loadScript(src) {
  return new Promise(res => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => res();
    s.onerror = () => { window.__axyloLoadError = `could not load ${src}`; res(); };
    document.head.appendChild(s);
  });
}

function containers(count, grid, resizable) {
  const root = document.getElementById('root');
  const parent = grid || resizable ? Object.assign(document.createElement('div'), { className: `${grid ? 'grid' : ''} ${resizable ? 'resize-box' : ''}`.trim() }) : root;
  if (parent !== root) root.appendChild(parent);
  const els = Array.from({ length: count }, () => parent.appendChild(Object.assign(document.createElement('div'), { className: 'chart' })));
  return { els, box: parent };
}

// Calculated, not measured: bytes a 4-byte-per-pixel backing store needs for every canvas on the page (canvas.width
// and canvas.height are device pixels, so the pixel ratio is already in them). The browser may hold more (double
// buffering, GPU copies) or less (canvases not yet drawn); the process figures are the measured ones.
function canvasBacking() {
  const root = document.getElementById('root');
  let chart = 0, other = 0, count = 0;
  for (const c of document.querySelectorAll('canvas')) {
    const bytes = c.width * c.height * 4;
    if (root.contains(c)) { chart += bytes; count++; } else other += bytes;
  }
  return { chartCanvasBytes: chart, chartCanvasCount: count, otherCanvasBytes: other, svgElements: root.querySelectorAll('svg').length, svgPaths: root.querySelectorAll('svg path').length, domNodes: root.getElementsByTagName('*').length };
}

// W-first and W-page: from the create call until a fixed settle window after every chart reports ready.
async function runCreate(adapter, fixtures, els) {
  await metrics('create:start');
  const { t0, handles, tSync } = await inTask(() => {
    const t0 = performance.now();
    const handles = fixtures.map((f, i) => adapter.create(els[i], f, { params: adapterParams }));
    return { t0, handles, tSync: performance.now() };
  });
  await Promise.all(handles.map(h => h.ready));
  const tReady = performance.now();
  await raf();
  const tReadyFrame = performance.now();
  await sleep(settleMs);
  await metrics('create:end');
  const tEnd = performance.now();
  const backing = canvasBacking();
  if (memoryWanted) await memory('chart');
  return {
    timing: { syncMs: r3(tSync - t0), readyMs: r3(tReady - t0), readyFrameMs: r3(tReadyFrame - t0), windowMs: r3(tEnd - t0), settleMs },
    canvasBacking: backing,
    describe: handles.map(h => h.describe()),
  };
}

// The producer: a worker with its own timers, so samples are due on a 60 Hz schedule whatever the page's main
// thread and animation frames are doing. It sends the sequence number, the scheduled time and the send time, both
// converted to the page's time base.
const PRODUCER = `
onmessage = e => {
  const { startAt, pageOrigin, period, count } = e.data;
  const shift = pageOrigin - performance.timeOrigin; // page time = worker time - shift
  const t0 = startAt + shift;
  let k = 0;
  const tick = () => {
    const now = performance.now();
    while (k < count && t0 + k * period <= now) { postMessage({ seq: k, due: t0 + k * period - shift, sent: now - shift }); k++; }
    if (k < count) setTimeout(tick, Math.max(0, t0 + k * period - performance.now()));
  };
  setTimeout(tick, Math.max(0, t0 - performance.now()));
};`;

// W-stream: a window chart fed by the producer. Visibility is read from the chart's own draw record
// (adapter.drawnNewestX), in an animation-frame callback registered after the append that needs it, so it runs
// after any frame callback the library itself registered for that append.
async function runStream(adapter, fix, el) {
  const N = fix.samples, period = 1000 / 60;
  await metrics('create:start');
  const handle = await inTask(() => adapter.create(el, { x: fix.initial.x, ys: fix.initial.ys, names: fix.names }, { window: fix.window, params: adapterParams }));
  await handle.ready;
  await sleep(settleMs);
  await metrics('create:end');

  const due = new Float64Array(N).fill(NaN), sent = new Float64Array(N).fill(NaN), received = new Float64Array(N).fill(NaN);
  const visible = new Float64Array(N).fill(NaN), visibleFrame = new Float64Array(N).fill(NaN), appendMs = new Float64Array(N).fill(NaN);
  const x0 = fix.stream.x[0];
  const frames = [];
  let receivedCount = 0, visibleCount = 0, coalesced = 0, framesWithNew = 0, maxBacklog = 0, readerPending = false, pacing = true;
  let prevFrameNow = NaN, startAt = NaN;
  let finish;
  const finished = new Promise(r => { finish = r; });
  const dueBy = t => Math.max(0, Math.min(N, Math.floor((t - startAt) / period) + 1));

  // Frame pacing loop. Its callback runs first in each frame (registered earliest), so it accounts the previous
  // frame: by then that frame's visibility has been read.
  const pace = ts => {
    if (!Number.isNaN(prevFrameNow)) maxBacklog = Math.max(maxBacklog, dueBy(prevFrameNow) - visibleCount);
    prevFrameNow = performance.now();
    frames.push(ts);
    if (pacing) requestAnimationFrame(pace);
  };
  const reader = ts => {
    readerPending = false;
    const now = performance.now();
    const newest = handle.drawnNewestX();
    const upto = Math.min(N - 1, Math.round((newest - x0) / fix.step));
    let k = 0;
    while (visibleCount <= upto) { visible[visibleCount] = now; visibleFrame[visibleCount] = ts; visibleCount++; k++; }
    if (k) { framesWithNew++; coalesced += k - 1; }
    if (visibleCount === N) finish('all visible');
    else if (visibleCount < receivedCount) { readerPending = true; requestAnimationFrame(reader); }
  };

  const worker = new Worker(URL.createObjectURL(new Blob([PRODUCER], { type: 'text/javascript' })));
  worker.onmessage = e => {
    const { seq, due: d, sent: s } = e.data;
    received[seq] = performance.now(); due[seq] = d; sent[seq] = s; receivedCount++;
    const a = performance.now();
    handle.append(fix.stream.x[seq], [fix.stream.y[seq]]);
    appendMs[seq] = performance.now() - a;
    if (!readerPending) { readerPending = true; requestAnimationFrame(reader); }
  };

  await metrics('stream:start');
  await inTask(() => {
    requestAnimationFrame(pace);
    startAt = performance.now() + 50;
    worker.postMessage({ startAt, pageOrigin: performance.timeOrigin, period, count: N });
  });
  const lastDue = startAt + (N - 1) * period;
  const timer = setInterval(() => { if (performance.now() > lastDue + 5000) finish('timeout: not every sample became visible within 5 s of the last one'); }, 250);
  const how = await finished;
  clearInterval(timer);
  const tEnd = performance.now();
  await metrics('stream:end');
  pacing = false;
  worker.terminate();
  return {
    stream: {
      samples: N, periodMs: r3(period), startAt: r3(startAt), endAt: r3(tEnd), ended: how,
      receivedCount, visibleCount, neverVisible: N - visibleCount, coalesced, framesWithNew, maxBacklog,
      due: Array.from(due, r3), sent: Array.from(sent, r3), received: Array.from(received, r3),
      visible: Array.from(visible, r3), visibleFrame: Array.from(visibleFrame, r3), appendMs: Array.from(appendMs, r3),
      frames: frames.map(r3),
    },
    timing: { settleMs },
    describe: [handle.describe()],
  };
}

// ── theme ───────────────────────────────────────────────────────────────────────────────────────
// What the marks look like, independent of the library: the computed stroke of every SVG path, and the most
// frequent fully opaque colors of every canvas, read from a copy (the chart's own canvas is never read back, so
// the browser has no reason to move it off the GPU path).
function markSignature(el) {
  const parts = [];
  const strokes = new Set();
  for (const p of el.querySelectorAll('svg path, svg polyline, svg line')) {
    const st = getComputedStyle(p).stroke;
    if (st && st !== 'none') strokes.add(st);
  }
  if (strokes.size) parts.push(`svg:${[...strokes].sort().join('|')}`);
  for (const c of el.querySelectorAll('canvas')) {
    if (!c.width || !c.height) continue;
    const copy = document.createElement('canvas');
    copy.width = c.width; copy.height = c.height;
    const ctx = copy.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(c, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const hist = new Map();
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] !== 255) continue;
      const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      hist.set(k, (hist.get(k) ?? 0) + 1);
    }
    const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => `#${k.toString(16).padStart(6, '0')}`).sort();
    parts.push(`canvas:${top.join('|')}`);
  }
  return parts.join(' ');
}

// Counts drawing work during a window: Canvas 2D calls that put pixels down, and DOM mutation records inside the
// chart. Counting adds one increment per call and one observer callback per batch, the same for every adapter.
function workCounter(el) {
  const names = ['stroke', 'fill', 'fillRect', 'strokeRect', 'fillText', 'strokeText', 'clearRect', 'drawImage', 'putImageData'];
  const proto = CanvasRenderingContext2D.prototype;
  const saved = {};
  const counts = { canvasCalls: 0, mutations: 0 };
  for (const n of names) {
    saved[n] = proto[n];
    proto[n] = function (...args) { counts.canvasCalls++; return saved[n].apply(this, args); };
  }
  const mo = new MutationObserver(records => { counts.mutations += records.length; });
  mo.observe(el, { subtree: true, attributes: true, childList: true, characterData: true });
  return {
    take() { const t = { ...counts, mutations: counts.mutations + mo.takeRecords().length }; counts.canvasCalls = 0; counts.mutations = 0; return t; },
    stop() { for (const n of names) proto[n] = saved[n]; mo.disconnect(); },
  };
}

// W-theme: toggle a class-based dark theme on <html> and measure main-thread task time per toggle, over a fixed
// window of three animation frames plus 50 ms (Axylo promises the repaint within one frame, spec L4). The marks'
// colors are checked after each window. How many frames the change took is measured in separate, untimed toggles
// afterwards, because sampling pixels in every frame would add readback work to the measured window.
async function runTheme(adapter, fix, el) {
  const toggles = params.toggles ?? 20;
  await metrics('create:start');
  const handle = await inTask(() => adapter.create(el, fix, { params: adapterParams }));
  await handle.ready;
  await sleep(settleMs);
  await metrics('create:end');
  const html = document.documentElement;
  const signatures = [markSignature(el)];
  const work = [];
  const counter = workCounter(el);
  for (let i = 0; i < toggles; i++) {
    counter.take();
    await metrics(`toggle${i}:start`);
    await inTask(() => html.classList.toggle('bench-dark'));
    await raf(); await raf(); await raf();
    await sleep(50);
    await metrics(`toggle${i}:end`);
    work.push(counter.take());
    signatures.push(markSignature(el));
  }
  counter.stop();
  const reasons = [];
  const light = signatures[0], dark = signatures[1];
  if (light === dark) reasons.push(`marks did not change color on the first toggle (${light})`);
  signatures.forEach((sig, i) => { const want = i % 2 ? dark : light; if (sig !== want) reasons.push(`after ${i} toggles the marks show ${sig}, expected ${want}`); });
  // Latency: untimed toggles, the marks sampled after every frame until they change (at most 10 frames).
  const framesToChange = [];
  for (let i = 0; i < 4; i++) {
    const before = markSignature(el);
    html.classList.toggle('bench-dark');
    // Let mutation observers (where a library notices the toggle) run first, so a frame callback the library
    // registers in response comes before this sampler's in the same frame.
    await Promise.resolve();
    let n = 0, changed = false;
    while (n < 10 && !changed) { await raf(); n++; changed = markSignature(el) !== before; }
    framesToChange.push(changed ? n : null);
  }
  if (html.classList.contains('bench-dark')) html.classList.remove('bench-dark');
  return {
    theme: { toggles, windowFrames: 3, windowExtraMs: 50, work, signatures: [...new Set(signatures)], framesToChange },
    themeCheck: { ok: reasons.length === 0, reasons: reasons.slice(0, 5) },
    timing: { settleMs },
    describe: [handle.describe()],
  };
}

// ── resize ──────────────────────────────────────────────────────────────────────────────────────
// W-resize: the box holding the chart(s) is animated 1,200 -> 400 -> 1,200 px over 2 s, one width per animation
// frame, linear in time. Task time and frame intervals are recorded over the animation; afterwards every chart
// must fill its container's new width (its widest canvas or svg within 90-100% of the container).
async function runResize(adapter, fixtures, els, box) {
  const duration = params.durationMs ?? 2000, wide = 1200, narrow = 400;
  await metrics('create:start');
  const handles = await inTask(() => fixtures.map((f, i) => adapter.create(els[i], f, { params: adapterParams, resize: true })));
  await Promise.all(handles.map(h => h.ready));
  await sleep(settleMs);
  await metrics('create:end');
  const frames = [], widths = [];
  await metrics('resize:start');
  let startAt = NaN;
  await new Promise(resolve => {
    let after = 0;
    const step = ts => {
      if (Number.isNaN(startAt)) startAt = performance.now();
      const t = performance.now() - startAt;
      const half = duration / 2;
      const w = t < half ? wide - (wide - narrow) * t / half : t < duration ? narrow + (wide - narrow) * (t - half) / half : wide;
      box.style.width = `${w}px`;
      frames.push(ts); widths.push(Math.round(w));
      if (t >= duration) after++;
      if (after > 2) resolve(); else requestAnimationFrame(step);
    };
    inTask(() => requestAnimationFrame(step));
  });
  const endAt = performance.now();
  await Promise.all(handles.map(h => h.ready));
  await metrics('resize:end');
  await sleep(settleMs);
  const reasons = [];
  els.forEach((el, i) => {
    const cw = el.clientWidth;
    let widest = 0;
    for (const g of el.querySelectorAll('canvas, svg')) widest = Math.max(widest, g.getBoundingClientRect().width);
    if (!(widest >= 0.9 * cw && widest <= cw + 1)) reasons.push(`chart ${i}: widest canvas/svg is ${widest.toFixed(1)} px in a ${cw} px container after the resize`);
  });
  return {
    resize: { durationMs: duration, from: wide, to: narrow, startAt: r3(startAt), endAt: r3(endAt), frames: frames.map(r3), widths },
    resizeCheck: { ok: reasons.length === 0, reasons: reasons.slice(0, 5) },
    timing: { settleMs },
    describe: handles.map(h => h.describe()),
  };
}

async function main() {
  const env = pageEnvironment();
  // A computed URL keeps esbuild from bundling every adapter into the page; each run loads only its own.
  const adapterUrl = new URL(`./adapters/${encodeURIComponent(adapterId)}.js`, location.href).href;
  const adapter = (await import(adapterUrl)).default;
  await adapter.load?.(adapterParams);
  const meta = { id: adapter.id, library: adapter.library, version: adapter.version, config: adapter.configFor?.(adapterParams) ?? adapter.config, params: adapter.resolvedParams?.(adapterParams) ?? adapterParams, floor: !!adapter.floor };
  const avail = adapter.available();
  if (!avail.ok) return done({ outcome: 'not-available', reason: avail.reason, adapter: meta, env });
  adapter.setup?.(adapterParams);
  if (memoryWanted) await memory('blank');
  const fixtures = workloadData(workload, params);
  const sum = checksum(fixtures);
  const { els, box } = containers(fixtures.length, workload === 'page' || (workload === 'resize' && fixtures.length > 1), workload === 'resize');
  env.refresh = await observeRefresh();
  await raf(); await raf(); // layout of the empty containers is done before the clock starts
  if (memoryWanted) await memory('data');
  let result;
  try {
    result = workload === 'stream' ? await runStream(adapter, fixtures[0], els[0])
      : workload === 'theme' ? await runTheme(adapter, fixtures[0], els[0])
      : workload === 'resize' ? await runResize(adapter, fixtures, els, box)
      : await runCreate(adapter, fixtures, els);
  } catch (e) {
    if (e?.benchNotAdmitted) return done({ outcome: 'not-admitted', reason: e.message, adapter: meta, env, checksum: sum });
    throw e;
  }
  done({ outcome: 'ok', adapter: meta, env, checksum: sum, ...result });
}

main().catch(e => done({ outcome: 'error', error: String(e?.stack ?? e) }));
