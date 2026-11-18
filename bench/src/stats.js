// Statistics for the runner (plan 3.3). Pure, runs in Node.
// Unit of analysis: the run. Every per-frame or per-sample series is reduced to one number per run first.
import { rng } from './fixtures.js';

export function quantile(values, p) {
  const s = Float64Array.from(values).sort();
  if (!s.length) return NaN;
  const h = (s.length - 1) * p, lo = Math.floor(h), hi = Math.ceil(h);
  return s[lo] + (s[hi] - s[lo]) * (h - lo);
}
export const median = v => quantile(v, 0.5);

/**
 * Seeds are recorded so a run can be replayed exactly; a seed that the generator would silently coerce (a string,
 * a fraction, a negative number, NaN) would make the record lie about how it was produced, so it is an error.
 */
export function checkSeed(seed, what = 'seed') {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error(`${what} must be an integer from 0 to 4294967295, got ${JSON.stringify(seed)}`);
  return seed;
}
/** Parses a seed given on the command line; "12abc", "1.5" and "" are errors, not 12, 1 and 0. */
export function parseSeed(text, what = 'seed') {
  if (typeof text !== 'string' || !/^\d+$/.test(text)) throw new Error(`${what} must be an integer from 0 to 4294967295, got ${JSON.stringify(text)}`);
  return checkSeed(Number(text), what);
}

export const DEFAULT_BOOTSTRAP_SEED = 12345;

/** n blocks, half AB and half BA, in a seeded random order. */
export function balancedOrder(blocks, seed) {
  if (!Number.isInteger(blocks) || blocks < 2 || blocks % 2) throw new Error(`blocks must be an even number >= 2 (as many AB as BA), got ${blocks}`);
  checkSeed(seed, 'order seed');
  const order = [...Array(blocks / 2).fill('AB'), ...Array(blocks / 2).fill('BA')];
  const r = rng(seed);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  return order;
}

/**
 * Paired bootstrap over blocks: resample whole blocks (keeping each A with its B), and take
 * median(B) - median(A) of each resample. Percentile 95% interval.
 *
 * The estimand is the difference of the two configurations' medians (plan 3.3: "median of per-run values with a
 * paired bootstrap interval for the difference"), not the median of the paired differences; the two differ on
 * skewed data and the tests pin which one this is.
 *
 * With `strata` (one label per pair, here the block order AB or BA), each resample draws from every stratum as many
 * pairs as it has, so the balance the design fixed (as many AB as BA) is kept in every resample instead of being
 * left to chance.
 */
export function pairedBootstrap(a, b, { iterations = 10000, seed = DEFAULT_BOOTSTRAP_SEED, strata = null } = {}) {
  const n = a.length;
  if (n !== b.length) throw new Error('paired samples must have equal length');
  checkSeed(seed, 'bootstrap seed');
  if (n < 2) return { n, estimate: n ? b[0] - a[0] : NaN, lo: NaN, hi: NaN, note: 'not available: fewer than 2 complete pairs' };
  const groups = [];
  if (strata) {
    if (strata.length !== n) throw new Error('one stratum label per pair');
    const by = new Map();
    strata.forEach((s, i) => { if (!by.has(s)) by.set(s, []); by.get(s).push(i); });
    for (const key of [...by.keys()].sort()) groups.push(by.get(key));
  } else groups.push(Array.from({ length: n }, (_, i) => i));
  const r = rng(seed);
  const diffs = new Float64Array(iterations);
  const ra = new Float64Array(n), rb = new Float64Array(n);
  for (let it = 0; it < iterations; it++) {
    let k = 0;
    for (const g of groups) for (let j = 0; j < g.length; j++) { const i = g[Math.floor(r() * g.length)]; ra[k] = a[i]; rb[k] = b[i]; k++; }
    diffs[it] = median(rb) - median(ra);
  }
  return { n, estimate: median(b) - median(a), lo: quantile(diffs, 0.025), hi: quantile(diffs, 0.975), stratified: !!strata };
}

/**
 * Three outcomes for "lower is better" metrics. With a noise band (the A-versus-A interval for the same workload),
 * the interval must clear the band as well as zero.
 */
export function classify(ci, band) {
  if (!Number.isFinite(ci.lo) || !Number.isFinite(ci.hi)) return 'inconclusive';
  const lo = band ? Math.min(0, band.lo) : 0, hi = band ? Math.max(0, band.hi) : 0;
  if (ci.hi < lo) return 'better';
  if (ci.lo > hi) return 'worse';
  return 'inconclusive';
}

/**
 * Below this many complete pairs an interval is still reported, but the outcome is always "inconclusive".
 * Plan 3.3: "Sample sizes are set from a pilot in M0 ... Until then: 20 runs for full comparisons", i.e. 20 runs of
 * each configuration, which in balanced blocks is 20 complete pairs. With six pairs the percentile bootstrap gave a
 * confident verdict in the wrong direction about one time in ten on a discrete metric (review finding 11;
 * `node bench/tools/coverage.mjs` measures it), so a verdict waits for the plan's sample size.
 */
export const MIN_PAIRS = 20;
/** An A-versus-A record gives a usable band only with at least this many complete pairs. */
export const MIN_BAND_PAIRS = MIN_PAIRS;
/** Plan 3.3: the noise band comes from repeated blocks across at least three sessions. */
export const MIN_BAND_SESSIONS = 3;

const NA = reason => ({ na: `not available: ${reason}` });

/** Metric definitions per workload. Every metric: lower is better. `primary` marks the workload's primary metric. */
const CREATE = [
  { key: 'taskMs', unit: 'ms', primary: true, what: 'main-thread TaskDuration from the create call to settle window end' },
  { key: 'scriptMs', unit: 'ms', what: 'ScriptDuration in the same window' },
  { key: 'layoutStyleMs', unit: 'ms', what: 'LayoutDuration + RecalcStyleDuration in the same window' },
  { key: 'readyMs', unit: 'ms', what: 'wall clock from create call to the adapter\'s ready signal' },
  { key: 'readyFrameMs', unit: 'ms', what: 'wall clock to the first animation frame after ready' },
  { key: 'rendererCpuMs', unit: 'ms', what: 'CPU time of the page renderer process, all threads, same window (SystemInfo.getProcessInfo)' },
  { key: 'gpuCpuMs', unit: 'ms', what: 'CPU time of the GPU process, same window' },
  { key: 'heapChartBytes', unit: 'bytes', what: 'JS heap after forced GC with the chart, minus the same with only the input data' },
  { key: 'heapUsedBytes', unit: 'bytes', what: 'JS heap after forced GC with the chart (absolute)' },
  { key: 'rendererPssBytes', unit: 'bytes', what: 'page renderer process PSS with the chart (Linux /proc, after GC)' },
  { key: 'rendererPssChartBytes', unit: 'bytes', what: 'page renderer PSS with the chart minus with only the input data' },
  { key: 'gpuPssBytes', unit: 'bytes', what: 'GPU process PSS with the chart' },
  { key: 'gpuPssChartBytes', unit: 'bytes', what: 'GPU process PSS with the chart minus with only the input data' },
  { key: 'canvasBackingBytes', unit: 'bytes', what: 'CALCULATED: sum of canvas.width x canvas.height x 4 over the chart canvases' },
  { key: 'domNodes', unit: 'nodes', what: 'elements inside the chart containers' },
];
const FRAMES = [
  { key: 'frameP95Ms', unit: 'ms', what: '95th percentile animation-frame interval in the window (boundary-spanning intervals included)' },
  { key: 'frameP99Ms', unit: 'ms', what: '99th percentile animation-frame interval' },
  { key: 'framesOverThreshold', unit: 'frames', what: 'frame intervals over 1.5x the observed refresh interval (25 ms at 60 Hz)' },
  { key: 'frameMaxMs', unit: 'ms', what: 'largest frame interval' },
];
export const METRICS = {
  first: CREATE,
  page: CREATE,
  compact: CREATE,
  scatter: CREATE,
  theme: [
    { key: 'taskMsPerToggle', unit: 'ms', primary: true, what: 'median over toggles of TaskDuration from the class toggle to 3 frames + 50 ms later (no counters, no pixel reads in timed runs)' },
    { key: 'taskMsToggleMax', unit: 'ms', what: 'largest per-toggle TaskDuration' },
  ],
  resize: [
    { key: 'taskMs', unit: 'ms', primary: true, what: 'TaskDuration over the fixed width sequence and until the charts report ready' },
    ...FRAMES,
    { key: 'rendererCpuMs', unit: 'ms', what: 'page renderer process CPU time, all threads, same window' },
    { key: 'gpuCpuMs', unit: 'ms', what: 'GPU process CPU time, same window' },
  ],
  stream: [
    // P3, as plan 3.1 defines it: "Main-thread task time divided by updates", one number per run; the budget's
    // "median" is then the median of those per-run numbers over runs. It is not the median of individual updates'
    // costs, which TaskDuration cannot separate (see README, "P3").
    { key: 'taskMsPerUpdate', unit: 'ms', primary: true, what: 'P3: main-thread TaskDuration from stream start to last sample visible, divided by samples (per run)' },
    { key: 'lateFrames', unit: 'frames', what: 'P3: frame intervals over 25 ms (1.5x refresh) among the 300 intervals that start at the first sample\'s due time' },
    { key: 'delayP50Ms', unit: 'ms', what: 'median per-sample delay, scheduled time to the frame callback whose drawn state includes it' },
    { key: 'delayP95Ms', unit: 'ms', what: '95th percentile of that delay' },
    { key: 'delayMaxMs', unit: 'ms', what: 'largest delay' },
    { key: 'maxBacklog', unit: 'samples', what: 'largest number of due samples not yet shown after a frame' },
    { key: 'coalesced', unit: 'samples', what: 'samples first shown in the same frame as a later sample' },
    { key: 'frameP95Ms', unit: 'ms', what: '95th percentile of the same 300 frame intervals' },
    { key: 'frameP99Ms', unit: 'ms', what: '99th percentile of the same 300 frame intervals' },
    { key: 'createTaskMs', unit: 'ms', what: 'TaskDuration to create the initial window and settle' },
  ],
  hover: [
    { key: 'inputToReadoutP95Ms', unit: 'ms', primary: true, what: 'P4: 95th percentile over moves of pointermove event.timeStamp to the frame callback whose readout shows the hovered datum' },
    { key: 'inputToReadoutP50Ms', unit: 'ms', what: 'median of the same' },
    { key: 'inputToReadoutMaxMs', unit: 'ms', what: 'largest of the same' },
    { key: 'taskMsPerMove', unit: 'ms', what: 'TaskDuration over the moves divided by moves' },
  ],
  zoom: [
    { key: 'taskMsPerStep', unit: 'ms', primary: true, what: 'TaskDuration over the zoom/pan sequence divided by steps' },
    { key: 'stepToFrameP95Ms', unit: 'ms', what: '95th percentile over steps of chart.zoom() call to the frame callback after the chart reports the step drawn' },
    ...FRAMES,
  ],
  mem: [
    { key: 'ownedBytes', unit: 'bytes', primary: true, what: 'P7: (JS heap used + ArrayBuffer backing storage) after forced GC with the chart, minus with only the caller\'s columns' },
    { key: 'ownedRatio', unit: 'x', what: 'P7: ownedBytes / bytes of the caller\'s columns (budget: at most 1)' },
    { key: 'heapChartBytes', unit: 'bytes', what: 'JS heap used only (no ArrayBuffer backing), chart minus data' },
    { key: 'canvasBackingBytes', unit: 'bytes', what: 'CALCULATED canvas backing stores (not Axylo JS memory, reported separately)' },
    { key: 'rendererPssChartBytes', unit: 'bytes', what: 'page renderer PSS, chart minus data' },
  ],
  lifecycle: [
    { key: 'heapSlopeBytesPerCycle', unit: 'bytes', primary: true, what: 'P7: least-squares slope of (heap used + backing storage) after forced GC over the checkpoints, per create-destroy cycle' },
    { key: 'listenersAfter', unit: 'listeners', what: 'JS event listeners on the page after the last cycle minus before the first' },
    { key: 'nodesAfter', unit: 'nodes', what: 'DOM nodes after the last cycle minus before the first' },
  ],
};

const ms = (deltas, from, to, name) => {
  const d = deltas?.[`${from}->${to}`];
  return d && Number.isFinite(d[name]) ? d[name] * 1000 : NaN;
};

const cpuMs = (deltas, from, to, name) => {
  const d = deltas?.[`${from}->${to}`];
  return d && Number.isFinite(d[name]) ? d[name] * 1000 : NA(`${name} not sampled (process not identified)`);
};

/**
 * Frame intervals that overlap a window [from, to]: every pair of consecutive frame timestamps (f[i], f[i+1]) with
 * f[i+1] > from and f[i] < to. An interval that starts before the window and ends inside it, or starts inside and
 * ends after it, is counted: a 150 ms stall that straddles the end of a resize is a stall during the resize.
 */
export function intervalsOverlapping(frames, from, to) {
  const out = [];
  for (let i = 0; i + 1 < frames.length; i++) if (frames[i + 1] > from && frames[i] < to) out.push(frames[i + 1] - frames[i]);
  return out;
}

/**
 * P3's lateness window: exactly `count` consecutive frame intervals, starting with the interval in which the first
 * sample falls due (the last frame at or before that time, to the next). 300 samples at 60 Hz give 300 intervals.
 * Returns null when the frame log does not reach that far (the run then fails; see streamCompletion).
 */
export function lateWindow(frames, firstDue, count) {
  let i0 = -1;
  for (let i = 0; i < frames.length; i++) { if (frames[i] <= firstDue) i0 = i; else break; }
  if (i0 < 0) i0 = 0; // the pacing loop started after the first due time; begin at its first frame
  if (i0 + count >= frames.length) return null;
  const iv = [];
  for (let i = i0; i < i0 + count; i++) iv.push(frames[i + 1] - frames[i]);
  return { intervals: iv, firstFrame: frames[i0], lastFrame: frames[i0 + count] };
}

function frameStats(out, iv, refresh, label) {
  if (iv.length < 10) { out.frameP95Ms = out.frameP99Ms = out.framesOverThreshold = out.frameMaxMs = NA(`only ${iv.length} frame intervals in the ${label}`); return; }
  out.frameP95Ms = quantile(iv, 0.95);
  out.frameP99Ms = quantile(iv, 0.99);
  out.frameMaxMs = Math.max(...iv);
  out.framesOverThreshold = Number.isFinite(refresh) ? iv.filter(v => v > 1.5 * refresh).length : NA('refresh rate not observed');
  out.frameThresholdMs = Number.isFinite(refresh) ? 1.5 * refresh : null;
  out.frameCount = iv.length;
}

function memorySummary(out, run) {
  const m = run.memory?.samples;
  const na = NA(run.memory?.na ?? 'memory not sampled');
  if (!m?.chart || !m?.data) { for (const k of ['heapChartBytes', 'heapUsedBytes', 'rendererPssBytes', 'rendererPssChartBytes', 'gpuPssBytes', 'gpuPssChartBytes']) out[k] = na; }
  else {
    out.heapChartBytes = m.chart.heapUsed - m.data.heapUsed;
    out.heapUsedBytes = m.chart.heapUsed;
    out.rendererPssBytes = Number.isFinite(m.chart.renderer?.pss) ? m.chart.renderer.pss : NA(m.chart.renderer?.na ?? 'renderer PSS missing');
    out.rendererPssChartBytes = Number.isFinite(m.chart.renderer?.pss) && Number.isFinite(m.data.renderer?.pss) ? m.chart.renderer.pss - m.data.renderer.pss : NA(m.chart.renderer?.na ?? 'renderer PSS missing');
    out.gpuPssBytes = Number.isFinite(m.chart.gpu?.pss) ? m.chart.gpu.pss : NA(m.chart.gpu?.na ?? 'GPU PSS missing');
    out.gpuPssChartBytes = Number.isFinite(m.chart.gpu?.pss) && Number.isFinite(m.data.gpu?.pss) ? m.chart.gpu.pss - m.data.gpu.pss : NA(m.chart.gpu?.na ?? 'GPU PSS missing');
  }
  const cb = run.result.canvasBacking;
  out.canvasBackingBytes = cb ? cb.chartCanvasBytes : NA('not recorded');
  out.domNodes = cb ? cb.domNodes : NA('not recorded');
}

/** Least-squares slope of y over x. */
export function slope(xs, ys) {
  const n = xs.length;
  if (n < 2) return NaN;
  const mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  return sxx ? sxy / sxx : NaN;
}

/**
 * Whether a streaming run finished: every sample was received and acknowledged by the chart's draw record, and the
 * frame log covers P3's lateness window. An unfinished stream is a failed run (outcome "incomplete"), never a
 * timing: a chart that stops drawing would otherwise be cheaper per update than one that keeps up.
 */
export function streamCompletion(stream) {
  const reasons = [];
  if (!stream) return { complete: false, reasons: ['no stream record'] };
  if (stream.receivedCount !== stream.samples) reasons.push(`${stream.samples - stream.receivedCount} of ${stream.samples} samples never reached the page`);
  if (stream.visibleCount !== stream.samples) reasons.push(`${stream.samples - stream.visibleCount} of ${stream.samples} samples never acknowledged by the chart's draw record (${stream.ended})`);
  if (stream.ended !== 'all visible') reasons.push(`stream ended: ${stream.ended}`);
  if (Array.isArray(stream.frames) && Array.isArray(stream.due) && !lateWindow(stream.frames, stream.due[0], stream.samples)) reasons.push(`frame log does not cover ${stream.samples} frame intervals from the first due time`);
  return { complete: reasons.length === 0, reasons };
}

/** One run's raw record -> one number per metric (or a "not available" reason). */
export function summarizeRun(workload, run) {
  const out = {};
  const refresh = run.result.env?.refresh?.medianIntervalMs;
  if (workload === 'theme') {
    const t = run.result.theme;
    const per = [];
    for (let i = 0; i < t.toggles; i++) { const v = ms(run.deltas, `toggle${i}:start`, `toggle${i}:end`, 'TaskDuration'); if (Number.isFinite(v)) per.push(v); }
    out.taskMsPerToggle = per.length ? median(per) : NA('TaskDuration missing');
    out.taskMsToggleMax = per.length ? Math.max(...per) : NA('TaskDuration missing');
    return out;
  }
  if (workload === 'resize') {
    const r = run.result.resize;
    const t = ms(run.deltas, 'resize:start', 'resize:end', 'TaskDuration');
    out.taskMs = Number.isFinite(t) ? t : NA('TaskDuration missing');
    frameStats(out, intervalsOverlapping(r.frames, r.startAt, r.endAt), refresh, 'resize window');
    out.rendererCpuMs = cpuMs(run.deltas, 'resize:start', 'resize:end', 'rendererCpu');
    out.gpuCpuMs = cpuMs(run.deltas, 'resize:start', 'resize:end', 'gpuCpu');
    return out;
  }
  if (workload === 'stream') {
    const s = run.result.stream;
    const task = ms(run.deltas, 'stream:start', 'stream:end', 'TaskDuration');
    out.taskMsPerUpdate = Number.isFinite(task) ? task / s.samples : NA('TaskDuration missing');
    const delays = [];
    for (let i = 0; i < s.samples; i++) if (Number.isFinite(s.visible[i]) && Number.isFinite(s.due[i])) delays.push(s.visible[i] - s.due[i]);
    if (delays.length) { out.delayP50Ms = quantile(delays, 0.5); out.delayP95Ms = quantile(delays, 0.95); out.delayMaxMs = Math.max(...delays); }
    else out.delayP50Ms = out.delayP95Ms = out.delayMaxMs = NA('no sample became visible');
    out.maxBacklog = s.maxBacklog;
    out.coalesced = s.coalesced;
    out.neverVisible = s.neverVisible;
    const w = lateWindow(s.frames, s.due[0], s.samples);
    if (!w) out.lateFrames = out.frameP95Ms = out.frameP99Ms = NA(`frame log does not cover ${s.samples} intervals`);
    else {
      out.frameP95Ms = quantile(w.intervals, 0.95);
      out.frameP99Ms = quantile(w.intervals, 0.99);
      out.lateFrames = Number.isFinite(refresh) ? w.intervals.filter(v => v > 1.5 * refresh).length : NA('refresh rate not observed');
      out.lateThresholdMs = Number.isFinite(refresh) ? 1.5 * refresh : null;
      out.lateWindowIntervals = w.intervals.length;
    }
    const c = ms(run.deltas, 'create:start', 'create:end', 'TaskDuration');
    out.createTaskMs = Number.isFinite(c) ? c : NA('TaskDuration missing');
    return out;
  }
  if (workload === 'hover') {
    const h = run.result.hover;
    const lat = h.latencies.filter(Number.isFinite);
    if (lat.length) { out.inputToReadoutP95Ms = quantile(lat, 0.95); out.inputToReadoutP50Ms = quantile(lat, 0.5); out.inputToReadoutMaxMs = Math.max(...lat); }
    else out.inputToReadoutP95Ms = out.inputToReadoutP50Ms = out.inputToReadoutMaxMs = NA('no readout matched');
    const t = ms(run.deltas, 'hover:start', 'hover:end', 'TaskDuration');
    out.taskMsPerMove = Number.isFinite(t) ? t / h.moves : NA('TaskDuration missing');
    return out;
  }
  if (workload === 'zoom') {
    const z = run.result.zoom;
    const t = ms(run.deltas, 'zoom:start', 'zoom:end', 'TaskDuration');
    out.taskMsPerStep = Number.isFinite(t) ? t / z.steps : NA('TaskDuration missing');
    const lat = z.stepToFrame.filter(Number.isFinite);
    out.stepToFrameP95Ms = lat.length ? quantile(lat, 0.95) : NA('no step drawn');
    frameStats(out, intervalsOverlapping(z.frames, z.startAt, z.endAt), refresh, 'zoom window');
    return out;
  }
  if (workload === 'mem') {
    const m = run.memory?.samples;
    if (!m?.chart || !m?.data) { for (const k of ['ownedBytes', 'ownedRatio', 'heapChartBytes', 'rendererPssChartBytes']) out[k] = NA(run.memory?.na ?? 'memory not sampled'); }
    else {
      const total = s => (Number.isFinite(s.backingStorage) ? s.heapUsed + s.backingStorage : NaN);
      const owned = total(m.chart) - total(m.data);
      out.ownedBytes = Number.isFinite(owned) ? owned : NA('Runtime.getHeapUsage reports no backingStorageSize in this Chrome; ArrayBuffer memory cannot be separated');
      out.ownedRatio = Number.isFinite(owned) && run.result.callerColumnBytes ? owned / run.result.callerColumnBytes : NA('owned bytes not available');
      out.heapChartBytes = m.chart.heapUsed - m.data.heapUsed;
      out.rendererPssChartBytes = Number.isFinite(m.chart.renderer?.pss) && Number.isFinite(m.data.renderer?.pss) ? m.chart.renderer.pss - m.data.renderer.pss : NA(m.chart.renderer?.na ?? 'renderer PSS missing');
    }
    const cb = run.result.canvasBacking;
    out.canvasBackingBytes = cb ? cb.chartCanvasBytes : NA('not recorded');
    return out;
  }
  if (workload === 'lifecycle') {
    const pts = run.result.lifecycle.checkpoints.map(c => ({ c: c.cycles, mem: run.memory?.samples?.[c.label] }));
    const ok = pts.filter(p => p.mem && Number.isFinite(p.mem.heapUsed));
    const bytes = p => p.mem.heapUsed + (Number.isFinite(p.mem.backingStorage) ? p.mem.backingStorage : 0);
    out.heapSlopeBytesPerCycle = ok.length >= 3 ? slope(ok.map(p => p.c), ok.map(bytes)) : NA('fewer than 3 memory checkpoints');
    out.heapCheckpoints = ok.map(p => [p.c, bytes(p)]);
    const first = ok[0]?.mem, last = ok[ok.length - 1]?.mem;
    out.listenersAfter = Number.isFinite(first?.listeners) && Number.isFinite(last?.listeners) ? last.listeners - first.listeners : NA('listener count not read');
    out.nodesAfter = Number.isFinite(first?.nodes) && Number.isFinite(last?.nodes) ? last.nodes - first.nodes : NA('node count not read');
    return out;
  }
  // create workloads: first, page, compact, scatter
  const g = name => ms(run.deltas, 'create:start', 'create:end', name);
  const t = g('TaskDuration');
  out.taskMs = Number.isFinite(t) ? t : NA('TaskDuration missing');
  out.scriptMs = g('ScriptDuration');
  out.layoutStyleMs = g('LayoutDuration') + g('RecalcStyleDuration');
  out.devtoolsMs = g('DevToolsCommandDuration');
  out.readyMs = run.result.timing.readyMs;
  out.readyFrameMs = run.result.timing.readyFrameMs;
  out.rendererCpuMs = cpuMs(run.deltas, 'create:start', 'create:end', 'rendererCpu');
  out.gpuCpuMs = cpuMs(run.deltas, 'create:start', 'create:end', 'gpuCpu');
  memorySummary(out, run);
  return out;
}

/** Outcomes a timed run can have that are not a timing. "ok" is the only one that is paired. */
export const FAILURE_OUTCOMES = ['not-admitted', 'incomplete', 'error', 'timeout', 'crash', 'not-available'];

/**
 * Pair the summarized runs by block and compare B (candidate) with A (baseline) on every metric.
 * Only blocks in which both runs are "ok" and admitted are paired; the rest are counted, and they gate the speed
 * verdicts:
 *   - when any timed run failed, every timing is survivor-only and is labelled conditional;
 *   - when the candidate failed more runs than the baseline, no metric may be called "better" for it: a
 *     configuration that times out on most runs and is fast on the rest has not been shown to be faster;
 *   - when the candidate had more adverse runs (any frame over the threshold, `adverse` below) than the baseline,
 *     "better" is blocked as well: a median count of late frames hides runs that stalled.
 */
export function analyze(workload, runs, { noise = null, bootstrapSeed = DEFAULT_BOOTSTRAP_SEED, zeroOnly = false } = {}) {
  checkSeed(bootstrapSeed, 'bootstrap seed');
  const blocks = new Map();
  for (const r of runs) {
    if (r.phase !== 'timed') continue;
    if (!blocks.has(r.block)) blocks.set(r.block, {});
    blocks.get(r.block)[r.config] = r;
  }
  const orderOf = b => (b.A && b.B ? (b.A.position === 0 ? 'AB' : 'BA') : null);
  const complete = [...blocks.values()].filter(b => b.A?.outcome === 'ok' && b.B?.outcome === 'ok');
  const outcomes = {};
  const timed = { A: 0, B: 0 }, failed = { A: 0, B: 0 };
  for (const r of runs) {
    if (r.phase !== 'timed') continue;
    outcomes[`${r.config}:${r.outcome}`] = (outcomes[`${r.config}:${r.outcome}`] ?? 0) + 1;
    timed[r.config]++;
    if (r.outcome !== 'ok') failed[r.config]++;
  }
  // Adverse runs: any late frame interval in the window (P3's second number is a count that must be 0).
  const adverseKey = workload === 'stream' ? 'lateFrames' : (workload === 'resize' || workload === 'zoom') ? 'framesOverThreshold' : null;
  const adverse = { A: 0, B: 0 };
  if (adverseKey) for (const r of runs) if (r.phase === 'timed' && r.outcome === 'ok' && typeof r.summary?.[adverseKey] === 'number' && r.summary[adverseKey] > 0) adverse[r.config]++;
  const reliability = {
    timed, failed,
    failureRate: { A: timed.A ? failed.A / timed.A : NaN, B: timed.B ? failed.B / timed.B : NaN },
    adverseKey, adverse,
    conditional: failed.A + failed.B > 0,
    betterBlocked: failed.B > failed.A ? `the candidate failed ${failed.B} of ${timed.B} timed runs, the baseline ${failed.A} of ${timed.A}`
      : adverse.B > adverse.A ? `the candidate had ${adverse.B} runs with ${adverseKey} > 0, the baseline ${adverse.A}` : null,
  };
  const metrics = {};
  for (const m of METRICS[workload]) {
    const pairs = complete.filter(b => typeof b.A.summary[m.key] === 'number' && typeof b.B.summary[m.key] === 'number' && Number.isFinite(b.A.summary[m.key]) && Number.isFinite(b.B.summary[m.key]));
    const a = pairs.map(b => b.A.summary[m.key]), b = pairs.map(p => p.B.summary[m.key]);
    if (!pairs.length) {
      const reason = complete.map(p => p.A.summary[m.key]?.na ?? p.B.summary[m.key]?.na).find(Boolean) ?? 'no complete pair';
      metrics[m.key] = { ...m, na: reason.startsWith('not available') ? reason : `not available: ${reason}` };
      continue;
    }
    const strata = pairs.map(orderOf);
    const ci = pairedBootstrap(a, b, { seed: bootstrapSeed, strata: strata.every(Boolean) ? strata : null });
    const band = noise?.metrics?.[m.key];
    const bandUsable = !zeroOnly && band && Number.isFinite(band.lo) && Number.isFinite(band.hi) ? { lo: band.lo, hi: band.hi } : null;
    // Per-order estimates make differential carry-over visible: with no carry-over, AB and BA blocks estimate the
    // same difference.
    const byOrder = {};
    for (const o of ['AB', 'BA']) {
      const idx = strata.map((s, i) => (s === o ? i : -1)).filter(i => i >= 0);
      byOrder[o] = idx.length ? { pairs: idx.length, diff: median(idx.map(i => b[i])) - median(idx.map(i => a[i])) } : { pairs: 0, diff: NaN };
    }
    let outcome = pairs.length >= MIN_PAIRS ? classify(ci, bandUsable) : 'inconclusive';
    const notes = [];
    if (pairs.length < MIN_PAIRS) notes.push(`inconclusive by rule: ${pairs.length} complete pairs, fewer than ${MIN_PAIRS}`);
    if (outcome === 'better' && reliability.betterBlocked) { outcome = 'inconclusive'; notes.push(`"better" blocked: ${reliability.betterBlocked}`); }
    metrics[m.key] = {
      ...m, pairs: pairs.length,
      medianA: median(a), medianB: median(b),
      diff: ci.estimate, lo: ci.lo, hi: ci.hi, ...(ci.note ? { note: ci.note } : {}),
      relative: median(a) ? ci.estimate / median(a) : null,
      blockDiffs: pairs.map((p, i) => b[i] - a[i]),
      byOrder,
      noiseBand: zeroOnly ? 'zero-only analysis (explicitly requested): no noise band'
        : bandUsable ?? (noise ? 'not available: metric missing in the noise run' : 'not available: no A-versus-A run given (--noise)'),
      outcome,
      ...(reliability.conditional ? { conditional: `survivor-only: ${failed.A} baseline and ${failed.B} candidate timed runs failed and are not in this timing` } : {}),
      ...(notes.length ? { outcomeNote: notes.join('; ') } : {}),
    };
  }
  return { completePairs: complete.length, blocks: blocks.size, outcomes, reliability, bootstrapSeed, zeroOnly: !!zeroOnly, metrics };
}
