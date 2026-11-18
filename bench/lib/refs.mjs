// Adapter references, workloads and noise bands for the runner and the analyzer.
import fs from 'node:fs';
import path from 'node:path';
import { MIN_BAND_PAIRS, MIN_BAND_SESSIONS } from '../src/stats.js';
import { sessionEligibility } from '../src/decision.js';

export const WORKLOADS = ['first', 'page', 'compact', 'scatter', 'stream', 'theme', 'resize', 'hover', 'zoom', 'mem', 'lifecycle'];

/**
 * "axylo:renderer=svg,build=dev" -> { id: 'axylo', params: { renderer: 'svg', build: 'dev' } }.
 * Values stay strings except true/false and plain numbers.
 */
export function parseAdapterRef(ref) {
  const [id, rest] = String(ref).split(/:(.*)/s);
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`adapter reference "${ref}": the id must be lowercase letters, digits and dashes`);
  const params = {};
  if (rest) for (const part of rest.split(',')) {
    const m = /^([A-Za-z][\w-]*)=(.*)$/.exec(part);
    if (!m) throw new Error(`adapter reference "${ref}": parameter "${part}" is not key=value`);
    params[m[1]] = m[2] === 'true' ? true : m[2] === 'false' ? false : /^-?\d+(\.\d+)?$/.test(m[2]) ? Number(m[2]) : m[2];
  }
  return { id, params };
}

/** JSON with sorted keys, so two parameter objects compare equal whatever order they were written in. */
export function stableJson(v) {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

/**
 * What a noise band must match to be used for a comparison: the measured thing (workload, parameters, settle, pixel
 * ratio), the bytes (every file the A-versus-A run loaded, by hash, must be byte-identical in the comparison's
 * artifact), the browser (Chrome version, headless or headed) and the machine (host name, CPU model, cores).
 * Taken from a history record, so the analyzer derives it from the record it replays.
 */
export function controlsOf(record) {
  const d = record.design ?? {}, env = record.environment ?? {};
  return {
    workload: d.workload, params: d.params, settleMs: d.settleMs, dpr: d.dpr ?? 1,
    chrome: env.browser?.version, headless: env.browser?.headless,
    host: env.host ?? null,
    files: record.hashes?.files ?? null,
    slots: record.hashes?.slots ?? null,
    adapters: [record.design?.baseline, record.design?.candidate].filter(Boolean),
  };
}

const hostKey = h => (h ? `${h.hostname} / ${h.cpuModel} / ${h.logicalCores} cores` : 'not recorded');

/** Every reason the A-versus-A record `n` cannot serve as a band for a comparison with controls `c`. */
export function bandMismatches(n, c) {
  const out = [];
  const nc = controlsOf(n);
  // The control must be one of the compared configurations: a uPlot A-versus-A says nothing about Canvas against SVG.
  if (c.adapters?.length && !c.adapters.includes(n.design?.baseline)) out.push(`adapter ${n.design?.baseline}, comparison ${c.adapters.join(' vs ')}`);
  const el = sessionEligibility(n);
  if (!el.eligible) out.push(`session not eligible: ${el.reasons.slice(0, 2).join('; ')}`);
  if (nc.workload !== c.workload) out.push(`workload ${nc.workload}, comparison ${c.workload}`);
  if (stableJson(nc.params) !== stableJson(c.params)) out.push(`parameters ${stableJson(nc.params)}, comparison ${stableJson(c.params)}`);
  if (nc.settleMs !== c.settleMs) out.push(`settle ${nc.settleMs} ms, comparison ${c.settleMs} ms`);
  if (nc.dpr !== c.dpr) out.push(`device pixel ratio ${nc.dpr}, comparison ${c.dpr}`);
  if (nc.chrome !== c.chrome) out.push(`Chrome ${nc.chrome}, comparison ${c.chrome}`);
  if (nc.headless !== c.headless) out.push(`${nc.headless ? 'headless' : 'headed'}, comparison ${c.headless ? 'headless' : 'headed'}`);
  if (!nc.host || !c.host || hostKey(nc.host) !== hostKey(c.host)) out.push(`host ${hostKey(nc.host)}, comparison ${hostKey(c.host)}`);
  // Bytes: every file the band's run loaded must be the same file in one of the comparison's slots.
  const served = n.hashes?.slots?.A?.served;
  if (!served || !Object.keys(served).length) out.push('the band record does not say which files it served (older record)');
  else if (!c.slots) out.push('the comparison does not record its artifact files');
  else {
    const fits = ['A', 'B'].some(slot => {
      const files = c.slots[slot]?.files;
      return files && Object.entries(served).every(([p, h]) => files[p] === h);
    });
    if (!fits) {
      const diff = Object.entries(served).filter(([p, h]) => c.slots.A?.files?.[p] !== h && c.slots.B?.files?.[p] !== h).map(([p]) => p);
      out.push(`built from different bytes: ${diff.slice(0, 4).join(', ')}${diff.length > 4 ? ', …' : ''} differ from both of the comparison's artifacts`);
    }
  }
  return out;
}

/**
 * Loads one or more complete A-versus-A records and checks each against the comparison's controls. A record that
 * does not match is refused (an error, not a warning): a band from another pixel ratio, build or machine is not
 * this comparison's noise. With several, the band is their union per metric (lowest lo, highest hi). A metric's
 * band is used only from records with at least MIN_BAND_PAIRS complete pairs for it; fewer than
 * MIN_BAND_SESSIONS records (sessions) make the band exploratory, which the report says.
 */
export function loadNoise(refs, historyDir, controls) {
  if (!controls || !controls.workload) throw new Error('loadNoise needs the comparison\'s controls (controlsOf(record))');
  const sources = [], metrics = {}, problems = [];
  for (const ref of refs) {
    const p = fs.existsSync(ref) ? ref : path.join(historyDir, `${ref}.json`);
    if (!fs.existsSync(p)) { problems.push(`noise run ${ref} not found`); continue; }
    const n = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (n.design?.mode !== 'aa' || n.status !== 'complete' || !n.analysis?.metrics) { problems.push(`noise run ${ref} is not a complete, analysed A-versus-A run`); continue; }
    const mism = bandMismatches(n, controls);
    if (mism.length) { problems.push(`noise run ${ref} does not match this comparison: ${mism.join('; ')}`); continue; }
    sources.push({ runId: n.runId, adapter: n.design.baseline, chrome: n.environment.browser.version, dpr: n.design.dpr, completePairs: n.analysis.completePairs });
    for (const [k, m] of Object.entries(n.analysis.metrics)) {
      if (!Number.isFinite(m.lo) || !Number.isFinite(m.hi) || !(m.pairs >= MIN_BAND_PAIRS)) continue;
      const cur = metrics[k];
      metrics[k] = cur ? { lo: Math.min(cur.lo, m.lo), hi: Math.max(cur.hi, m.hi), from: [...cur.from, n.runId] } : { lo: m.lo, hi: m.hi, from: [n.runId] };
    }
  }
  if (problems.length) throw new Error(problems.join('\n'));
  // Counted per metric: a session gives a band for a metric only with enough pairs for that metric, and a band
  // gates only with three such sessions; otherwise it is shown as exploratory and not used to classify.
  for (const m of Object.values(metrics)) {
    m.sessions = new Set(m.from).size;
    m.calibrated = m.sessions >= MIN_BAND_SESSIONS;
    m.calibration = m.calibrated ? `band from ${m.sessions} sessions` : `exploratory: band from ${m.sessions} session${m.sessions === 1 ? '' : 's'} with ${MIN_BAND_PAIRS}+ pairs; plan 3.3 asks for at least ${MIN_BAND_SESSIONS}; not used to classify`;
  }
  const sessions = new Set(sources.map(s => s.runId)).size;
  const calibratedMetrics = Object.entries(metrics).filter(([, m]) => m.calibrated).map(([k]) => k);
  return {
    sources, metrics, sessions,
    calibration: calibratedMetrics.length ? `calibrated for ${calibratedMetrics.join(', ')}; other metrics exploratory` : `exploratory: no metric has ${MIN_BAND_SESSIONS} sessions with ${MIN_BAND_PAIRS}+ pairs (${sessions} session${sessions === 1 ? '' : 's'} given; plan 3.3 asks for at least ${MIN_BAND_SESSIONS} per metric); not used to classify`,
    minPairs: MIN_BAND_PAIRS,
  };
}
