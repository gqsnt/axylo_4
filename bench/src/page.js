// The benchmark page: one adapter, one workload, chosen by URL parameters.
//   ?adapter=uplot&workload=first&params={"size":"1x100000"}&settle=500
// The runner exposes two bindings: __benchMetrics(label) snapshots CDP Performance.getMetrics in Node and resolves
// once the snapshot is taken; __benchDone(result) hands the raw result back. Opened by hand, the page prints it.
import { workloadData, checksum } from './fixtures.js';

const q = new URLSearchParams(location.search);
const adapterId = q.get('adapter');
const workload = q.get('workload');
const params = JSON.parse(q.get('params') ?? '{}');
const settleMs = Number(q.get('settle') ?? 500);

// The binding's reply arrives inside a DevTools command task, and code continuing after `await` would run inside it
// (counted as DevToolsCommandDuration, not ScriptDuration). Measured work therefore starts inside the handler of a
// fresh task. TaskDuration counts it either way; this only keeps the secondary script/devtools split honest.
const inTask = fn => new Promise((resolve, reject) => {
  const c = new MessageChannel();
  c.port1.onmessage = () => { try { resolve(fn()); } catch (e) { reject(e); } };
  c.port2.postMessage(0);
});
const metrics = label => (window.__benchMetrics ? window.__benchMetrics(label) : Promise.resolve());
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

function containers(count, grid) {
  const root = document.getElementById('root');
  const parent = grid ? Object.assign(document.createElement('div'), { className: 'grid' }) : root;
  if (grid) root.appendChild(parent);
  return Array.from({ length: count }, () => parent.appendChild(Object.assign(document.createElement('div'), { className: 'chart' })));
}

// W-first and W-page: from the create call until a fixed settle window after every chart reports ready.
async function runCreate(adapter, fixtures, els) {
  await metrics('create:start');
  const { t0, handles, tSync } = await inTask(() => {
    const t0 = performance.now();
    const handles = fixtures.map((f, i) => adapter.create(els[i], f, {}));
    return { t0, handles, tSync: performance.now() };
  });
  await Promise.all(handles.map(h => h.ready));
  const tReady = performance.now();
  await raf();
  const tReadyFrame = performance.now();
  await sleep(settleMs);
  await metrics('create:end');
  const tEnd = performance.now();
  return {
    timing: { syncMs: r3(tSync - t0), readyMs: r3(tReady - t0), readyFrameMs: r3(tReadyFrame - t0), windowMs: r3(tEnd - t0), settleMs },
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
  const handle = await inTask(() => adapter.create(el, { x: fix.initial.x, ys: fix.initial.ys, names: fix.names }, { window: fix.window }));
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

async function main() {
  const env = pageEnvironment();
  if (adapterId === 'axylo') await loadScript('./axylo/axylo.iife.js');
  // A computed URL keeps esbuild from bundling every adapter into the page; each run loads only its own.
  const adapterUrl = new URL(`./adapters/${encodeURIComponent(adapterId)}.js`, location.href).href;
  const adapter = (await import(adapterUrl)).default;
  const meta = { id: adapter.id, library: adapter.library, version: adapter.version, config: adapter.config, floor: !!adapter.floor };
  const avail = adapter.available();
  if (!avail.ok) return done({ outcome: 'not-available', reason: avail.reason, adapter: meta, env });
  adapter.setup?.();
  const fixtures = workloadData(workload, params);
  const sum = checksum(fixtures);
  const els = containers(fixtures.length, workload === 'page');
  env.refresh = await observeRefresh();
  await raf(); await raf(); // layout of the empty containers is done before the clock starts
  let result;
  try {
    result = workload === 'stream' ? await runStream(adapter, fixtures[0], els[0]) : await runCreate(adapter, fixtures, els);
  } catch (e) {
    if (e?.benchNotAdmitted) return done({ outcome: 'not-admitted', reason: e.message, adapter: meta, env, checksum: sum });
    throw e;
  }
  done({ outcome: 'ok', adapter: meta, env, checksum: sum, ...result });
}

main().catch(e => done({ outcome: 'error', error: String(e?.stack ?? e) }));
