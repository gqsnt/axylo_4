// The benchmark page: one adapter, one workload, chosen by URL parameters.
//   ?adapter=uplot&workload=first&params={"size":"1x100000"}&settle=500&aparams={"renderer":"svg"}&probe=geometry
// The runner exposes bindings: __benchMetrics(label) snapshots CDP Performance.getMetrics in Node and resolves once
// the snapshot is taken; __benchMemory(label) forces a garbage collection and records heap and process memory;
// __benchPointer(x, y) dispatches a real pointer move; __benchDone(result) hands the raw result back. Opened by
// hand, the page prints the result.
//
// probe: '' for timed runs, which do nothing beyond the workload inside or around the measured windows;
//   'geometry' for the untimed admission run: Canvas 2D drawing calls are recorded so the readback can include the
//   polylines the library stroked, the theme workload reads every mark's color after every toggle, the resize
//   workload checks the chart's geometry at the narrowest width;
//   'counters' for the untimed theme run that counts Canvas 2D calls and DOM mutations per toggle.
import { workloadData, checksum, zoomSteps } from './fixtures.js';
import { lateWindow } from './stats.js';
import { themeMismatch } from './drawn.js';

const q = new URLSearchParams(location.search);
const adapterId = q.get('adapter');
const workload = q.get('workload');
const params = JSON.parse(q.get('params') ?? '{}');
const settleMs = Number(q.get('settle') ?? 500);
const adapterParams = JSON.parse(q.get('aparams') ?? '{}');
const probe = q.get('probe') || null;
const profiled = q.get('profile') === '1';
// Memory is sampled in the create workloads only, always outside the timed window.
const memoryWanted = (workload === 'first' || workload === 'page' || workload === 'compact' || workload === 'mem') && params.memory !== false;

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

const LAYOUT = {
  page: { grid: 'grid', count: 24 },
  compact: { grid: 'grid compact', count: 40 },
};
function containers(count, grid, resizable) {
  const root = document.getElementById('root');
  const parent = grid || resizable ? Object.assign(document.createElement('div'), { className: `${grid || ''} ${resizable ? 'resize-box' : ''}`.trim() }) : root;
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

// ── drawing capture (probe runs only) ────────────────────────────────────────────────────────────
// Records, per canvas, the polylines each stroke() call drew (moveTo/lineTo between beginPath and stroke, in the
// coordinates the library passed, which for a library that draws through setTransform are CSS px), its strokeStyle,
// and the last rectangle used as a clip. A clear of the whole canvas starts a new frame's record. Path2D strokes
// are recorded as strokes without vertices (uPlot draws that way; its drawn readback comes from its own state).
function installCapture() {
  const P = CanvasRenderingContext2D.prototype;
  const by = new WeakMap();
  const st = ctx => { let s = by.get(ctx.canvas); if (!s) by.set(ctx.canvas, s = { strokes: [], clip: null, path: [], open: null, rect: null }); return s; };
  const orig = {};
  const wrap = (name, fn) => { orig[name] = P[name]; P[name] = function (...a) { fn(this, a); return orig[name].apply(this, a); }; };
  wrap('beginPath', ctx => { const s = st(ctx); s.path = []; s.open = null; s.rect = null; });
  wrap('moveTo', (ctx, [x, y]) => { const s = st(ctx); s.open = [x, y]; s.path.push(s.open); });
  wrap('lineTo', (ctx, [x, y]) => { const s = st(ctx); if (!s.open) { s.open = [x, y]; s.path.push(s.open); } else s.open.push(x, y); });
  wrap('rect', (ctx, [x, y, w, h]) => { st(ctx).rect = { x, y, width: w, height: h }; });
  wrap('clip', ctx => { const s = st(ctx); if (s.rect) s.clip = s.rect; });
  wrap('stroke', (ctx, a) => { const s = st(ctx); s.strokes.push(a[0] ? { color: String(ctx.strokeStyle), path2d: true, polylines: [] } : { color: String(ctx.strokeStyle), polylines: s.path.filter(p => p.length >= 4).map(p => p.slice()) }); });
  wrap('clearRect', (ctx, [x, y, w, h]) => {
    const m = ctx.getTransform();
    const X = m.a * x + m.e, Y = m.d * y + m.f, W = m.a * w, H = m.d * h;
    if (X <= 0 && Y <= 0 && X + W >= ctx.canvas.width && Y + H >= ctx.canvas.height) { const s = st(ctx); s.strokes = []; }
  });
  return { of: canvas => { const s = by.get(canvas); return s ? { strokes: s.strokes, clip: s.clip } : { strokes: [], clip: null }; } };
}
const capture = probe === 'geometry' ? installCapture() : null;
const describeAll = handles => handles.map(h => h.describe({ capture, probe }));

// ── W-first, W-page, W-compact, W-scatter, W-mem ────────────────────────────────────────────────
// From the create call until a fixed settle window after every chart reports ready. The readback (describe) is
// taken after the end mark, so the admission check never runs inside the measured window.
async function runCreate(adapter, fixtures, els) {
  const opts = { params: adapterParams, compact: workload === 'compact', kind: workload === 'scatter' ? 'scatter' : 'line' };
  await metrics('create:start');
  const { t0, handles, tSync } = await inTask(() => {
    const t0 = performance.now();
    const handles = fixtures.map((f, i) => adapter.create(els[i], f, opts));
    return { t0, handles, tSync: performance.now() };
  });
  await Promise.all(handles.map(h => h.ready));
  const tReady = performance.now();
  await raf();
  const tReadyFrame = performance.now();
  if (profiled) await metrics('create:ready'); // profiled runs only: splits the profile into active and settle parts
  await sleep(settleMs);
  await metrics('create:end');
  const tEnd = performance.now();
  const backing = canvasBacking();
  if (memoryWanted) await memory('chart');
  return {
    timing: { syncMs: r3(tSync - t0), readyMs: r3(tReady - t0), readyFrameMs: r3(tReadyFrame - t0), windowMs: r3(tEnd - t0), settleMs },
    canvasBacking: backing,
    callerColumnBytes: fixtures.reduce((s, f) => s + f.x.byteLength + f.ys.reduce((t, c) => t + c.byteLength, 0), 0),
    describe: describeAll(handles),
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
// after any frame callback the library itself registered for that append. Frame pacing keeps recording after the
// last sample until it covers P3's window of `samples` intervals from the first due time.
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
  let framesDone;
  const framesCovered = new Promise(r => { framesDone = r; });
  const dueBy = t => Math.max(0, Math.min(N, Math.floor((t - startAt) / period) + 1));

  // Frame pacing loop. Its callback runs first in each frame (registered earliest), so it accounts the previous
  // frame: by then that frame's visibility has been read.
  const pace = ts => {
    if (!Number.isNaN(prevFrameNow)) maxBacklog = Math.max(maxBacklog, dueBy(prevFrameNow) - visibleCount);
    prevFrameNow = performance.now();
    frames.push(ts);
    if (Number.isFinite(due[0]) && lateWindow(frames, due[0], N)) framesDone();
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
  // Outside the measured window: keep the frame log going until it covers the lateness window (or give up).
  await Promise.race([framesCovered, sleep(3000)]);
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
    describe: describeAll([handle]),
  };
}

// ── theme ───────────────────────────────────────────────────────────────────────────────────────
// Counts drawing work during a window: Canvas 2D calls that put pixels down, and DOM mutation records inside the
// chart. Used only in the 'counters' probe run, never in a timed run.
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

/**
 * Per-mark colors against the colors the library says the marks should have in the current scheme
 * (adapter.themeColors: { expected: [css color per series], marks: [css color per series mark] }), all normalized
 * by a canvas round-trip. Every series mark must show its expected color; one stale mark fails the check.
 */
const normColor = (() => { const c = document.createElement('canvas').getContext('2d'); return v => { c.fillStyle = '#000'; c.fillStyle = v; return c.fillStyle; }; })();
function themeState(handle, el) {
  const t = handle.themeColors?.(el, { capture });
  if (!t) return null;
  return { expected: t.expected.map(normColor), marks: t.marks.map(normColor) };
}
// W-theme: toggle a class-based dark theme on <html> and measure main-thread task time per toggle, over a fixed
// window of three animation frames plus 50 ms (Axylo promises the repaint within one frame, spec L4). Timed runs
// do nothing else. The 'geometry' probe checks every mark's color after every toggle and counts frames until the
// new colors show; the 'counters' probe counts drawing calls and mutations per toggle.
async function runTheme(adapter, fix, el) {
  const toggles = params.toggles ?? 20;
  await metrics('create:start');
  const handle = await inTask(() => adapter.create(el, fix, { params: adapterParams }));
  await handle.ready;
  await sleep(settleMs);
  await metrics('create:end');
  const html = document.documentElement;
  const reasons = [], states = [];
  const counter = probe === 'counters' ? workCounter(el) : null;
  const work = [];
  if (probe === 'geometry') {
    const s = themeState(handle, el);
    if (!s) reasons.push('the adapter has no theme readback (the library has no theme mechanism)');
    else { states.push(s); const m = themeMismatch(s); if (m) reasons.push(`before the first toggle: ${m}`); }
  }
  for (let i = 0; i < toggles; i++) {
    counter?.take();
    await metrics(`toggle${i}:start`);
    await inTask(() => html.classList.toggle('bench-dark'));
    await raf(); await raf(); await raf();
    await sleep(50);
    await metrics(`toggle${i}:end`);
    if (counter) work.push(counter.take());
    if (probe === 'geometry' && !reasons.length) {
      const s = themeState(handle, el);
      states.push(s);
      const m = themeMismatch(s);
      if (m) reasons.push(`after toggle ${i + 1}: ${m}`);
      else if (i === 0 && s.marks.every((c, k) => c === states[0].marks[k])) reasons.push(`the marks kept their colors on the first toggle (${s.marks.join(', ')})`);
    }
  }
  counter?.stop();
  // Latency: untimed toggles, the marks read after every frame until each shows its expected color (<= 10 frames).
  const framesToChange = [];
  if (probe === 'geometry' && !reasons.length) {
    for (let i = 0; i < 4; i++) {
      const before = themeState(handle, el).marks.join();
      html.classList.toggle('bench-dark');
      // Let mutation observers (where a library notices the toggle) run first, so a frame callback the library
      // registers in response comes before this sampler's in the same frame.
      await Promise.resolve();
      let n = 0, ok = false;
      while (n < 10 && !ok) { await raf(); n++; const s = themeState(handle, el); ok = !themeMismatch(s) && s.marks.join() !== before; }
      framesToChange.push(ok ? n : null);
    }
  }
  if (html.classList.contains('bench-dark')) html.classList.remove('bench-dark');
  await raf(); await raf();
  return {
    theme: { toggles, windowFrames: 3, windowExtraMs: 50, probe, work, states: probe === 'geometry' ? states.slice(0, 3) : undefined, framesToChange },
    themeCheck: probe === 'geometry' ? { ok: reasons.length === 0, reasons: reasons.slice(0, 5) } : undefined,
    timing: { settleMs },
    describe: describeAll([handle]),
  };
}

// ── resize ──────────────────────────────────────────────────────────────────────────────────────
// W-resize: the box holding the chart(s) goes 1,200 -> 400 -> 1,200 px in a fixed sequence of widths, one per
// animation frame (60 down, 60 up, 3 at the end), so every adapter receives the same steps however busy it is
// (2 s at 60 Hz; the elapsed time is recorded). Task time and frame intervals are recorded over the sequence. Every
// run checks the final geometry; the 'geometry' probe also stops at the narrowest width, waits for the charts to
// report ready, and checks the intermediate geometry there.
function widestGraphic(el) { let w = 0; for (const g of el.querySelectorAll('canvas, svg')) w = Math.max(w, g.getBoundingClientRect().width); return w; }
function fillReasons(els, when) {
  const out = [];
  els.forEach((el, i) => {
    const cw = el.clientWidth, widest = widestGraphic(el);
    if (!(widest >= 0.9 * cw && widest <= cw + 1)) out.push(`chart ${i} ${when}: widest canvas/svg is ${widest.toFixed(1)} px in a ${cw} px container`);
  });
  return out;
}
async function runResize(adapter, fixtures, els, box) {
  const wide = 1200, narrow = 400, down = 60, up = 60;
  const widths = [];
  for (let i = 1; i <= down; i++) widths.push(wide - (wide - narrow) * i / down);
  for (let i = 1; i <= up; i++) widths.push(narrow + (wide - narrow) * i / up);
  widths.push(wide, wide, wide);
  await metrics('create:start');
  const handles = await inTask(() => fixtures.map((f, i) => adapter.create(els[i], f, { params: adapterParams, resize: true })));
  await Promise.all(handles.map(h => h.ready));
  await sleep(settleMs);
  await metrics('create:end');
  const frames = [], applied = [];
  const reasons = [];
  let intermediate = null;
  await metrics('resize:start');
  const startAt = performance.now();
  await new Promise(resolve => {
    let k = 0;
    const step = async ts => {
      frames.push(ts);
      if (k >= widths.length) { resolve(); return; }
      box.style.width = `${widths[k]}px`;
      applied.push(widths[k]);
      if (probe === 'geometry' && k === down - 1) {
        // Untimed probe only: let the charts catch up at the narrowest width, then check what they committed.
        await raf();
        await Promise.all(handles.map(h => h.ready));
        await raf();
        intermediate = els.map(el => ({ container: el.clientWidth, widest: r3(widestGraphic(el)) }));
        reasons.push(...fillReasons(els, `at ${narrow} px`));
      }
      k++;
      requestAnimationFrame(step);
    };
    inTask(() => requestAnimationFrame(step));
  });
  const endAt = performance.now();
  await Promise.all(handles.map(h => h.ready));
  await metrics('resize:end');
  await sleep(settleMs);
  reasons.push(...fillReasons(els, 'after the resize'));
  return {
    resize: { from: wide, to: narrow, steps: widths.length, startAt: r3(startAt), endAt: r3(endAt), elapsedMs: r3(endAt - startAt), frames: frames.map(r3), widths: applied, intermediate },
    resizeCheck: { ok: reasons.length === 0, reasons: reasons.slice(0, 5) },
    timing: { settleMs },
    describe: describeAll(handles),
  };
}

// ── W-hover (P4) ────────────────────────────────────────────────────────────────────────────────
// 200 real pointer moves left to right across the plot (CDP Input through the runner). For each move: the
// pointermove event's timeStamp, then the first animation-frame callback in which the chart's readout shows the
// datum the chart's own hover state picked for that event. The frame reader is registered from a window listener
// in the bubbling phase, after the chart's own listener on the plot has run, so a frame callback the chart
// registered for the move runs before it. This is the frame callback, not presentation (no trace).
async function runHover(adapter, fix, el) {
  const moves = params.moves ?? 200;
  const handle = await inTask(() => adapter.create(el, fix, { params: adapterParams, hover: true }));
  await handle.ready;
  await sleep(settleMs);
  if (!handle.hoverTarget) return { unsupported: 'the adapter has no hover readout' };
  const rect = handle.hoverTarget().getBoundingClientRect();
  const y = rect.top + rect.height / 2;
  const xs = Array.from({ length: moves }, (_, k) => rect.left + rect.width * (0.1 + 0.8 * k / (moves - 1)));
  const eventAt = new Float64Array(moves).fill(NaN), shownAt = new Float64Array(moves).fill(NaN), picked = new Float64Array(moves).fill(NaN);
  let current = -1, waiting = null;
  const onMove = e => {
    if (current < 0) return;
    eventAt[current] = e.timeStamp;
    const k = current;
    let frames = 0;
    const read = () => {
      frames++;
      const idx = handle.hoveredIndex();
      if (Number.isFinite(idx) && handle.readoutShows(idx)) { shownAt[k] = performance.now(); picked[k] = idx; waiting?.(); return; }
      if (frames < 10) requestAnimationFrame(read); else waiting?.();
    };
    requestAnimationFrame(read);
  };
  window.addEventListener('pointermove', onMove);
  // Untimed: put the pointer on the plot once so the first timed move is a move, not an entry.
  await window.__benchPointer?.(rect.left + rect.width * 0.05, y);
  await raf(); await raf();
  await metrics('hover:start');
  for (let k = 0; k < moves; k++) {
    current = k;
    const seen = new Promise(r => { waiting = r; });
    await window.__benchPointer?.(xs[k], y);
    await Promise.race([seen, sleep(500)]);
    waiting = null;
  }
  await metrics('hover:end');
  current = -1;
  window.removeEventListener('pointermove', onMove);
  const latencies = Array.from(eventAt, (t, k) => (Number.isFinite(shownAt[k]) && Number.isFinite(t) ? shownAt[k] - t : NaN));
  const reasons = [];
  const missed = latencies.filter(v => !Number.isFinite(v)).length;
  if (missed > moves * 0.05) reasons.push(`${missed} of ${moves} moves never showed a matching readout within 10 frames`);
  const idx = Array.from(picked).filter(Number.isFinite);
  for (let i = 1; i < idx.length; i++) if (idx[i] < idx[i - 1]) { reasons.push(`readout went backwards (${idx[i - 1]} then ${idx[i]}) on a left-to-right sweep`); break; }
  const n = fix.x.length;
  if (idx.length && (idx[0] > 0.2 * n || idx[idx.length - 1] < 0.8 * n)) reasons.push(`readouts span indices ${idx[0]}..${idx[idx.length - 1]} of ${n} for a sweep over 10%..90% of the plot`);
  // Moves are at least a pixel apart over at least as many data as moves, so each should read a datum of its own.
  const distinct = new Set(idx).size;
  if (n >= moves && distinct < moves / 2) reasons.push(`the readout showed ${distinct} distinct data for ${moves} moves over ${n} points: it does not follow the datum under the pointer`);
  return {
    hover: { moves, latencies: latencies.map(r3), picked: Array.from(picked), missed },
    hoverCheck: { ok: reasons.length === 0, reasons },
    timing: { settleMs },
    describe: describeAll([handle]),
  };
}

// ── W-zoom ──────────────────────────────────────────────────────────────────────────────────────
// 60 calls to the public zoom (Axylo chart.zoom([lo, hi])): 20 in, 20 out, 20 pan steps; each waits for the chart
// to report the step drawn and one frame. The final window is known in Node (fixtures.zoomSteps), so the admission
// check reads back exactly that view and the drawn extremes inside it.
async function runZoom(adapter, fix, el) {
  const steps = zoomSteps(fix);
  const handle = await inTask(() => adapter.create(el, fix, { params: adapterParams }));
  await handle.ready;
  await sleep(settleMs);
  if (!handle.zoom) return { unsupported: 'the adapter has no zoom' };
  const frames = [];
  let pacing = true;
  const pace = ts => { frames.push(ts); if (pacing) requestAnimationFrame(pace); };
  requestAnimationFrame(pace);
  await raf();
  const stepToFrame = [];
  await metrics('zoom:start');
  const startAt = performance.now();
  for (const [lo, hi] of steps) {
    const t0 = await inTask(() => { const t = performance.now(); handle.zoom(lo, hi); return t; });
    await handle.ready;
    await raf();
    stepToFrame.push(r3(performance.now() - t0));
  }
  const endAt = performance.now();
  await metrics('zoom:end');
  await raf();
  pacing = false;
  return {
    zoom: { steps: steps.length, finalWindow: steps[steps.length - 1], stepToFrame, startAt: r3(startAt), endAt: r3(endAt), frames: frames.map(r3) },
    timing: { settleMs },
    describe: describeAll([handle]),
  };
}

// ── W-mem lifecycle (P7) ────────────────────────────────────────────────────────────────────────
// Create, wait for ready, destroy, on one container, `cycles` times after 20 warm-up cycles; heap after forced
// collection (and listener and node counts) at checkpoints. The readback for admission comes from one more chart
// created after the last checkpoint.
async function runLifecycle(adapter, fix, el) {
  const cycles = params.cycles ?? 1000, warm = 20;
  const at = new Set([0, 100, 300, 1000, cycles].filter(c => c <= cycles));
  const checkpoints = [];
  const once = async () => { const h = adapter.create(el, fix, { params: adapterParams }); await h.ready; h.destroy(); };
  for (let i = 0; i < warm; i++) await once();
  for (let c = 0; c <= cycles; c++) {
    if (at.has(c)) { const label = `cycles${c}`; await raf(); await memory(label); checkpoints.push({ cycles: c, label }); }
    if (c < cycles) await once();
  }
  const leftover = el.childElementCount;
  const handle = adapter.create(el, fix, { params: adapterParams });
  await handle.ready;
  const reasons = leftover ? [`${leftover} elements left in the container after the last destroy()`] : [];
  return { lifecycle: { cycles, warm, checkpoints, leftover }, lifecycleCheck: { ok: !reasons.length, reasons }, timing: { settleMs }, describe: describeAll([handle]) };
}

async function main() {
  const env = pageEnvironment();
  // A computed URL keeps esbuild from bundling every adapter into the page; each run loads only its own.
  const adapterUrl = new URL(`./adapters/${encodeURIComponent(adapterId)}.js`, location.href).href;
  const adapter = (await import(adapterUrl)).default;
  await adapter.load?.(adapterParams);
  const meta = { id: adapter.id, library: adapter.library, version: adapter.version, config: adapter.configFor?.(adapterParams) ?? adapter.config, params: adapter.resolvedParams?.(adapterParams) ?? adapterParams, floor: !!adapter.floor, expectRenderer: adapter.expectRendererFor?.(adapterParams) ?? null };
  const avail = adapter.available(workload);
  if (!avail.ok) return done({ outcome: 'not-available', reason: avail.reason, adapter: meta, env });
  adapter.setup?.(adapterParams);
  if (memoryWanted) await memory('blank');
  const fixtures = workloadData(workload, params);
  const sum = checksum(fixtures);
  const grid = LAYOUT[workload]?.grid ?? (workload === 'resize' && fixtures.length > 1 ? 'grid' : null);
  const { els, box } = containers(workload === 'lifecycle' ? 1 : fixtures.length, grid, workload === 'resize');
  env.refresh = await observeRefresh();
  await raf(); await raf(); // layout of the empty containers is done before the clock starts
  if (memoryWanted) await memory('data');
  let result;
  try {
    result = workload === 'stream' ? await runStream(adapter, fixtures[0], els[0])
      : workload === 'theme' ? await runTheme(adapter, fixtures[0], els[0])
      : workload === 'resize' ? await runResize(adapter, fixtures, els, box)
      : workload === 'hover' ? await runHover(adapter, fixtures[0], els[0])
      : workload === 'zoom' ? await runZoom(adapter, fixtures[0], els[0])
      : workload === 'lifecycle' ? await runLifecycle(adapter, fixtures[0], els[0])
      : await runCreate(adapter, fixtures, els);
  } catch (e) {
    if (e?.benchNotAdmitted) return done({ outcome: 'not-admitted', reason: e.message, adapter: meta, env, checksum: sum });
    throw e;
  }
  if (result.unsupported) return done({ outcome: 'not-available', reason: result.unsupported, adapter: meta, env });
  done({ outcome: 'ok', adapter: meta, env, checksum: sum, probe, ...result });
}

main().catch(e => done({ outcome: 'error', error: String(e?.stack ?? e) }));
