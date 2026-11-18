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

/** n blocks, half AB and half BA, in a seeded random order. */
export function balancedOrder(blocks, seed) {
  if (!Number.isInteger(blocks) || blocks < 2 || blocks % 2) throw new Error(`blocks must be an even number >= 2 (as many AB as BA), got ${blocks}`);
  const order = [...Array(blocks / 2).fill('AB'), ...Array(blocks / 2).fill('BA')];
  const r = rng(seed);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  return order;
}

/**
 * Paired bootstrap over blocks: resample whole blocks (keeping each A with its B), and take
 * median(B) - median(A) of each resample. Percentile 95% interval.
 */
export function pairedBootstrap(a, b, { iterations = 10000, seed = 12345 } = {}) {
  const n = a.length;
  if (n !== b.length) throw new Error('paired samples must have equal length');
  if (n < 2) return { n, estimate: n ? b[0] - a[0] : NaN, lo: NaN, hi: NaN, note: 'not available: fewer than 2 complete pairs' };
  const r = rng(seed);
  const diffs = new Float64Array(iterations);
  const ra = new Float64Array(n), rb = new Float64Array(n);
  for (let it = 0; it < iterations; it++) {
    for (let k = 0; k < n; k++) { const i = Math.floor(r() * n); ra[k] = a[i]; rb[k] = b[i]; }
    diffs[it] = median(rb) - median(ra);
  }
  return { n, estimate: median(b) - median(a), lo: quantile(diffs, 0.025), hi: quantile(diffs, 0.975) };
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

/** Below this many complete pairs an interval is still reported, but the outcome is always "inconclusive". */
export const MIN_PAIRS = 6;

const NA = reason => ({ na: `not available: ${reason}` });

/** Metric definitions per workload. Every metric: lower is better. `primary` marks the workload's primary metric. */
export const METRICS = {
  first: [
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
  ],
  theme: [
    { key: 'taskMsPerToggle', unit: 'ms', primary: true, what: 'median over toggles of TaskDuration from the class toggle to 3 frames + 50 ms later' },
    { key: 'taskMsToggleMax', unit: 'ms', what: 'largest per-toggle TaskDuration' },
    { key: 'canvasCallsPerToggle', unit: 'calls', what: 'median Canvas 2D drawing calls per toggle window' },
    { key: 'mutationsPerToggle', unit: 'records', what: 'median DOM mutation records inside the chart per toggle window' },
    { key: 'framesToNewColor', unit: 'frames', what: 'largest number of frames until the marks changed color (untimed toggles)' },
  ],
  resize: [
    { key: 'taskMs', unit: 'ms', primary: true, what: 'TaskDuration over the 2 s width animation and until the charts report ready' },
    { key: 'frameP95Ms', unit: 'ms', what: '95th percentile animation-frame interval during the animation' },
    { key: 'frameP99Ms', unit: 'ms', what: '99th percentile animation-frame interval' },
    { key: 'framesOverThreshold', unit: 'frames', what: 'frame intervals over 1.5x the observed refresh interval' },
    { key: 'frameMaxMs', unit: 'ms', what: 'largest frame interval' },
    { key: 'rendererCpuMs', unit: 'ms', what: 'page renderer process CPU time, all threads, same window' },
    { key: 'gpuCpuMs', unit: 'ms', what: 'GPU process CPU time, same window' },
  ],
  stream: [
    { key: 'taskMsPerUpdate', unit: 'ms', primary: true, what: 'main-thread TaskDuration from stream start to last sample visible, / samples' },
    { key: 'delayP50Ms', unit: 'ms', what: 'median per-sample delay, scheduled time to the frame whose drawn state includes it' },
    { key: 'delayP95Ms', unit: 'ms', what: '95th percentile of that delay' },
    { key: 'delayMaxMs', unit: 'ms', what: 'largest delay' },
    { key: 'maxBacklog', unit: 'samples', what: 'largest number of due samples not yet shown after a frame' },
    { key: 'coalesced', unit: 'samples', what: 'samples first shown in the same frame as a later sample' },
    { key: 'frameP95Ms', unit: 'ms', what: '95th percentile animation-frame interval' },
    { key: 'frameP99Ms', unit: 'ms', what: '99th percentile animation-frame interval' },
    { key: 'framesOverThreshold', unit: 'frames', what: 'frame intervals over 1.5x the observed refresh interval (25 ms at 60 Hz)' },
    { key: 'createTaskMs', unit: 'ms', what: 'TaskDuration to create the initial 600-point window and settle' },
  ],
};
METRICS.page = METRICS.first;

const ms = (deltas, from, to, name) => {
  const d = deltas?.[`${from}->${to}`];
  return d && Number.isFinite(d[name]) ? d[name] * 1000 : NaN;
};

const cpuMs = (deltas, from, to, name) => {
  const d = deltas?.[`${from}->${to}`];
  return d && Number.isFinite(d[name]) ? d[name] * 1000 : NA(`${name} not sampled (process not identified)`);
};

function frameStats(out, frames, from, to, refresh) {
  const f = frames.filter(t => t >= from && t <= to);
  const iv = f.slice(1).map((t, i) => t - f[i]);
  if (iv.length < 10) { out.frameP95Ms = out.frameP99Ms = out.framesOverThreshold = out.frameMaxMs = NA(`only ${iv.length} frame intervals in the window`); return; }
  out.frameP95Ms = quantile(iv, 0.95);
  out.frameP99Ms = quantile(iv, 0.99);
  out.frameMaxMs = Math.max(...iv);
  out.framesOverThreshold = Number.isFinite(refresh) ? iv.filter(v => v > 1.5 * refresh).length : NA('refresh rate not observed');
  out.frameThresholdMs = Number.isFinite(refresh) ? 1.5 * refresh : null;
  out.frameCount = iv.length;
}

function memorySummary(out, run) {
  const m = run.memory?.samples;
  const na = NA('memory not sampled');
  if (!m?.chart || !m?.data) { for (const k of ['heapChartBytes', 'heapUsedBytes', 'rendererPssBytes', 'rendererPssChartBytes', 'gpuPssBytes', 'gpuPssChartBytes']) out[k] = na; }
  else {
    out.heapChartBytes = m.chart.heapUsed - m.data.heapUsed;
    out.heapUsedBytes = m.chart.heapUsed;
    out.rendererPssBytes = Number.isFinite(m.chart.renderer.pss) ? m.chart.renderer.pss : NA(m.chart.renderer.na ?? 'renderer PSS missing');
    out.rendererPssChartBytes = Number.isFinite(m.chart.renderer.pss) && Number.isFinite(m.data.renderer.pss) ? m.chart.renderer.pss - m.data.renderer.pss : NA('renderer PSS missing');
    out.gpuPssBytes = Number.isFinite(m.chart.gpu.pss) ? m.chart.gpu.pss : NA(m.chart.gpu.na ?? 'GPU PSS missing');
    out.gpuPssChartBytes = Number.isFinite(m.chart.gpu.pss) && Number.isFinite(m.data.gpu.pss) ? m.chart.gpu.pss - m.data.gpu.pss : NA('GPU PSS missing');
  }
  const cb = run.result.canvasBacking;
  out.canvasBackingBytes = cb ? cb.chartCanvasBytes : NA('not recorded');
  out.domNodes = cb ? cb.domNodes : NA('not recorded');
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
    out.canvasCallsPerToggle = median(t.work.map(w => w.canvasCalls));
    out.mutationsPerToggle = median(t.work.map(w => w.mutations));
    out.framesToNewColor = t.framesToChange.every(v => v !== null) ? Math.max(...t.framesToChange) : NA('the marks did not change within 10 frames in an untimed toggle');
    return out;
  }
  if (workload === 'resize') {
    const r = run.result.resize;
    const t = ms(run.deltas, 'resize:start', 'resize:end', 'TaskDuration');
    out.taskMs = Number.isFinite(t) ? t : NA('TaskDuration missing');
    frameStats(out, r.frames, r.startAt, r.endAt, refresh);
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
    const from = s.startAt, to = s.endAt;
    const f = s.frames.filter(t => t >= from && t <= to);
    const iv = f.slice(1).map((t, i) => t - f[i]);
    const refresh = run.result.env?.refresh?.medianIntervalMs;
    if (iv.length >= 10) {
      out.frameP95Ms = quantile(iv, 0.95);
      out.frameP99Ms = quantile(iv, 0.99);
      out.framesOverThreshold = Number.isFinite(refresh) ? iv.filter(v => v > 1.5 * refresh).length : NA('refresh rate not observed');
      out.frameThresholdMs = Number.isFinite(refresh) ? 1.5 * refresh : null;
      out.frameCount = iv.length;
    } else out.frameP95Ms = out.frameP99Ms = out.framesOverThreshold = NA(`only ${iv.length} frame intervals in the stream window`);
    const c = ms(run.deltas, 'create:start', 'create:end', 'TaskDuration');
    out.createTaskMs = Number.isFinite(c) ? c : NA('TaskDuration missing');
    return out;
  }
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

/**
 * Pair the summarized runs by block and compare B (candidate) with A (baseline) on every metric.
 * Only blocks in which both runs are "ok" and admitted are paired; the rest are counted.
 */
export function analyze(workload, runs, { noise } = {}) {
  const blocks = new Map();
  for (const r of runs) {
    if (r.phase !== 'timed') continue;
    if (!blocks.has(r.block)) blocks.set(r.block, {});
    blocks.get(r.block)[r.config] = r;
  }
  const complete = [...blocks.values()].filter(b => b.A?.outcome === 'ok' && b.B?.outcome === 'ok');
  const outcomes = {};
  for (const r of runs) if (r.phase === 'timed') outcomes[`${r.config}:${r.outcome}`] = (outcomes[`${r.config}:${r.outcome}`] ?? 0) + 1;
  const metrics = {};
  for (const m of METRICS[workload]) {
    const pairs = complete.filter(b => typeof b.A.summary[m.key] === 'number' && typeof b.B.summary[m.key] === 'number' && Number.isFinite(b.A.summary[m.key]) && Number.isFinite(b.B.summary[m.key]));
    const a = pairs.map(b => b.A.summary[m.key]), b = pairs.map(p => p.B.summary[m.key]);
    if (!pairs.length) {
      const reason = complete.map(p => p.A.summary[m.key]?.na ?? p.B.summary[m.key]?.na).find(Boolean) ?? 'no complete pair';
      metrics[m.key] = { ...m, na: reason.startsWith('not available') ? reason : `not available: ${reason}` };
      continue;
    }
    const ci = pairedBootstrap(a, b);
    const band = noise?.metrics?.[m.key];
    const bandUsable = band && Number.isFinite(band.lo) && Number.isFinite(band.hi) ? { lo: band.lo, hi: band.hi } : null;
    metrics[m.key] = {
      ...m, pairs: pairs.length,
      medianA: median(a), medianB: median(b),
      diff: ci.estimate, lo: ci.lo, hi: ci.hi, ...(ci.note ? { note: ci.note } : {}),
      relative: median(a) ? ci.estimate / median(a) : null,
      blockDiffs: pairs.map((p, i) => b[i] - a[i]),
      noiseBand: bandUsable ?? (noise ? 'not available: metric missing in the noise run' : 'not available: no A-versus-A run given (--noise)'),
      outcome: pairs.length >= MIN_PAIRS ? classify(ci, bandUsable) : 'inconclusive',
      ...(pairs.length < MIN_PAIRS ? { outcomeNote: `inconclusive by rule: ${pairs.length} complete pairs, fewer than ${MIN_PAIRS}` } : {}),
    };
  }
  return { completePairs: complete.length, blocks: blocks.size, outcomes, metrics };
}
