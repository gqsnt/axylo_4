// The renderer decision of docs/04-plan-performance.md section 5.1, as data and pure functions (runs in Node).
//
//   ENDPOINTS          the declared endpoints: workload, parameters, primary metric, thresholds (declared, or frozen
//                      from the pilot at 10% and 5% of the slower median), the everyday ones, the chart type;
//   sessionEligibility whether one balanced job counts (load under 1.0 at the start of every block, one Chrome);
//   assessEndpoint     one endpoint's result from its comparison record, its A-versus-A controls and the thresholds;
//   assessPilot        the pilot: frozen thresholds and the per-order (carry-over) check;
//   decideRenderer     the three-branch rule: canvas, svg, one with the other kept for a chart type, or no
//                      decision yet with the list of what is missing.
// Interpretations where 5.1 is not explicit are marked "interpretation" and listed in the README.
import { analyze, MIN_PAIRS, median } from './stats.js';

export const DECLARED_ON = '2026-11-18';
/** Renderer A and B of every renderer comparison: Canvas is A, SVG is B (B − A, lower is better). */
export const RENDERERS = { A: { name: 'canvas', adapter: 'axylo-canvas' }, B: { name: 'svg', adapter: 'axylo-svg' } };
/** Two columns of 1,000,000 Float64 values: the caller's columns that P7's thresholds are a share of. */
const P7_COLUMNS = 2 * 8 * 1_000_000;

export const ENDPOINTS = Object.freeze([
  { id: 'P1', budget: 'P1', family: 'renderer', everyday: 'P1', chartType: 'line', workload: 'first', params: { fixture: 'trend' }, metric: 'taskMs', unit: 'ms', swi: 1, tol: 0.5 },
  { id: 'P2-100k', budget: 'P2', family: 'renderer', chartType: 'line', workload: 'first', params: { size: '1x100000', gaps: false }, metric: 'taskMs', unit: 'ms', swi: 6, tol: 3 },
  { id: 'P3-task', budget: 'P3', family: 'renderer', everyday: 'P3', chartType: 'line', workload: 'stream', params: { window: 600, samples: 300 }, metric: 'taskMsPerUpdate', unit: 'ms', swi: 0.2, tol: 0.1 },
  // P3's second metric: runs with any interval later than 25 ms. Worthwhile: fewer such runs; tolerated: no more.
  { id: 'P3-late', budget: 'P3', family: 'renderer', everyday: 'P3', chartType: 'line', workload: 'stream', params: { window: 600, samples: 300 }, metric: 'lateRun', unit: 'runs', kind: 'late-runs' },
  { id: 'P5', budget: 'P5', family: 'renderer', everyday: 'P5', chartType: 'line', workload: 'page', params: { fixture: 'trend', charts: 24 }, metric: 'taskMs', unit: 'ms', swi: 20, tol: 10 },
  { id: 'P8', budget: 'P8', family: 'renderer', everyday: 'P8', chartType: 'line (compact)', workload: 'compact', params: { fixture: 'trend', charts: 40 }, metric: 'taskMs', unit: 'ms', swi: 8, tol: 4 },
  { id: 'scatter-50k', family: 'renderer', chartType: 'scatter', workload: 'scatter', params: { size: '1x50000', clustered: false }, metric: 'readyFrameMs', unit: 'ms', pilot: { swi: 0.10, tol: 0.05 } },
  { id: 'line-10x100k', family: 'renderer', chartType: 'line (10 series)', workload: 'first', params: { size: '10x100000', gaps: false }, metric: 'taskMs', unit: 'ms', pilot: { swi: 0.10, tol: 0.05 } },
  { id: 'zoom-100k', family: 'renderer', chartType: 'line (zoom)', workload: 'zoom', params: { size: '1x100000', gaps: false }, metric: 'taskMsPerStep', unit: 'ms', pilot: { swi: 0.10, tol: 0.05 } },
  // Budget endpoints outside the renderer family (regression gating, plan 5).
  { id: 'P2-1M', budget: 'P2', family: 'budget', workload: 'first', params: { size: '1x1000000', gaps: false }, metric: 'taskMs', unit: 'ms', swi: 25, tol: 12.5 },
  { id: 'P4', budget: 'P4', family: 'budget', workload: 'hover', params: { size: '1x100000', gaps: false, moves: 200 }, metric: 'inputToReadoutP95Ms', unit: 'ms', swi: 1.7, tol: 0.8 },
  { id: 'P7-mem', budget: 'P7', family: 'budget', workload: 'mem', params: { size: '1x1000000', gaps: false }, metric: 'ownedBytes', unit: 'bytes', swi: 0.10 * P7_COLUMNS, tol: 0.05 * P7_COLUMNS },
  { id: 'P7-lifecycle', budget: 'P7', family: 'budget', workload: 'lifecycle', params: { fixture: 'trend', cycles: 2500 }, metric: 'heapGrowth', unit: 'x', kind: 'gate', gate: 0.01 },
].map(e => Object.freeze(e)));

export const FAMILY = ENDPOINTS.filter(e => e.family === 'renderer');
/** Nine endpoints judged together: Bonferroni, 1 − 0.05 / 9 = 99.44%. */
export const FAMILY_LEVEL = 1 - 0.05 / FAMILY.length;
export const EVERYDAY = ['P1', 'P3', 'P5', 'P8'];
export const LOAD_LIMIT = 1.0;
export const MIN_CONTROL_SESSIONS = 3;
/** Section 5, "complexity is paid for": a kept second renderer needs a gain of at least four times the threshold. */
export const KEEP_FACTOR = 4;
/** Section 5, "bytes are accounted for" / 5.1 rule 3. */
export const CANVAS_BYTES_LIMIT = 512;

export const endpointById = id => ENDPOINTS.find(e => e.id === id);

/** One balanced job counts only with one-minute load under 1.0 at the start of every block and one Chrome version. */
export function sessionEligibility(record) {
  const reasons = [];
  if (!record) return { eligible: false, reasons: ['no record'] };
  if (record.status !== 'complete') reasons.push(`status ${record.status}`);
  const blocks = record.blocks ?? [];
  if (!blocks.length) reasons.push('no per-block load recorded (records before the per-block gate)');
  for (const b of blocks) if (!(b.load1 < LOAD_LIMIT)) reasons.push(`block ${b.block}: one-minute load ${b.load1} at its start (limit ${LOAD_LIMIT})`);
  const versions = new Set([record.environment?.browser?.version, ...(record.runs ?? []).map(r => r.chromeVersion).filter(Boolean)]);
  versions.delete(undefined);
  if (versions.size !== 1) reasons.push(`Chrome versions in the session: ${[...versions].join(', ') || 'none recorded'}`);
  return { eligible: reasons.length === 0, reasons };
}

/** The environment a decision family is pinned to; every record and control must have the same. */
export function environmentKey(record) {
  const e = record.environment ?? {}, h = e.host ?? {};
  // Refresh rate as the page observed it, to the nearest hertz (a 60 Hz and a 120 Hz session are different conditions).
  const hz = Number.isFinite(e.page?.refresh?.hz) ? Math.round(e.page.refresh.hz) : null;
  return JSON.stringify({ host: [h.hostname, h.cpuModel, h.logicalCores], chrome: e.browser?.version, headless: e.browser?.headless, dpr: record.design?.dpr ?? 1, refreshHz: hz, artifact: record.hashes?.slots?.A?.artifact, artifactB: record.hashes?.slots?.B?.artifact, settleMs: record.design?.settleMs });
}

const sameParams = (a, b) => JSON.stringify(Object.entries(a ?? {}).sort()) === JSON.stringify(Object.entries(b ?? {}).sort());
/** Files a run of `adapter` loads from its artifact: its bundle and, for Axylo, the production library. */
const filesOf = (record, adapter) => {
  const f = record.hashes?.slots?.A?.files ?? {};
  return [`adapters/${adapter}.js`, ...(adapter.startsWith('axylo') ? ['axylo/axylo.iife.min.js'] : [])].map(p => [p, f[p]]);
};

/**
 * The control for one renderer of one endpoint: eligible A-versus-A sessions of exactly that adapter, workload,
 * parameters and environment, built from the same bytes, each with at least 20 complete pairs for the metric,
 * analysed at the family's interval level. Counted per metric: a session that lacks pairs for this metric does not
 * count. Returns the band edge (largest |end| over the qualifying sessions) or why there is none.
 */
export function controlBand(endpoint, adapter, controls, env, level = FAMILY_LEVEL) {
  const used = [], rejected = [];
  for (const c of controls) {
    const why = [];
    if (c.design?.mode !== 'aa') why.push('not A-versus-A');
    if (c.design?.baseline !== adapter) why.push(`adapter ${c.design?.baseline}`);
    if (c.design?.workload !== endpoint.workload || !sameParams(c.design?.params, endpoint.params)) why.push('another workload or parameters');
    if (environmentKey(c) !== env) why.push('another environment');
    const el = sessionEligibility(c);
    if (!el.eligible) why.push(...el.reasons);
    if (why.length) { rejected.push({ runId: c.runId, why }); continue; }
    const m = analyze(endpoint.workload, c.runs, { level, bootstrapSeed: c.design?.bootstrapSeed ?? 12345 }).metrics[endpoint.metric];
    if (!m || m.na || !(m.pairs >= MIN_PAIRS)) { rejected.push({ runId: c.runId, why: [`${m?.pairs ?? 0} complete pairs for ${endpoint.metric}`] }); continue; }
    used.push({ runId: c.runId, lo: m.lo, hi: m.hi });
  }
  const sessions = new Set(used.map(u => u.runId)).size;
  if (sessions < MIN_CONTROL_SESSIONS) return { calibrated: false, sessions, used, rejected, why: `${sessions} qualifying A-versus-A sessions of ${adapter} for ${endpoint.metric}; ${MIN_CONTROL_SESSIONS} needed` };
  const edge = Math.max(...used.map(u => Math.max(Math.abs(u.lo), Math.abs(u.hi))));
  return { calibrated: true, sessions, used, rejected, edge };
}

/** Thresholds of an endpoint: declared, or frozen from the pilot (which must predate the comparison record). */
export function thresholdsOf(endpoint, frozen, recordStartedAt) {
  if (endpoint.kind) return { kind: endpoint.kind };
  if (!endpoint.pilot) return { swi: endpoint.swi, tol: endpoint.tol, source: `declared ${DECLARED_ON}` };
  const f = frozen?.[endpoint.id];
  if (!f) return { missing: 'thresholds not frozen yet: run the pilot' };
  if (recordStartedAt && !(new Date(f.frozenAt) < new Date(recordStartedAt))) return { missing: `thresholds frozen at ${f.frozenAt}, after the comparison started (${recordStartedAt})` };
  return { swi: f.swi, tol: f.tol, source: `pilot ${f.pilotRunId}, frozen ${f.frozenAt}` };
}

/**
 * One endpoint's result from its comparison record. Every way it can fail to be a verdict is named:
 *   missing (no record), ineligible (session or environment), no-control (fewer than three qualifying
 *   control sessions per renderer), exploratory (fewer than 20 pairs), carry-over (AB and BA estimates differ by
 *   more than the noise edge), thresholds (budget-less endpoint without frozen thresholds).
 * A renderer whose runs failed (not admitted, incomplete, error, timeout, crash) has failed the endpoint: that is a
 * result, worse beyond tolerance, not a missing value.
 */
export function assessEndpoint(endpoint, { record, controls = [], frozen = null, env = null } = {}) {
  const out = { id: endpoint.id, endpoint };
  if (!record) return { ...out, status: 'missing', why: 'no comparison record' };
  const e = env ?? environmentKey(record);
  const el = sessionEligibility(record);
  if (!el.eligible) return { ...out, status: 'ineligible', runId: record.runId, why: el.reasons.join('; ') };
  if (environmentKey(record) !== e) return { ...out, status: 'ineligible', runId: record.runId, why: 'environment differs from the decision family\'s' };
  if (record.design?.baseline !== RENDERERS.A.adapter || record.design?.candidate !== RENDERERS.B.adapter || record.design?.workload !== endpoint.workload || !sameParams(record.design?.params, endpoint.params))
    return { ...out, status: 'ineligible', runId: record.runId, why: 'the record is not this endpoint\'s comparison (adapters, workload or parameters)' };
  // Not admitted at all: the side that failed admission failed the endpoint.
  if (record.analysis?.notCompared) {
    const failedA = record.analysis.notCompared.some(s => s.includes(RENDERERS.A.adapter)), failedB = record.analysis.notCompared.some(s => s.includes(RENDERERS.B.adapter));
    return { ...out, status: 'measured', runId: record.runId, failed: { A: failedA ? 1 : 0, B: failedB ? 1 : 0 }, why: record.analysis.notCompared.join('; ') };
  }
  const th = thresholdsOf(endpoint, frozen, record.startedAt);
  if (th.missing) return { ...out, status: 'thresholds', runId: record.runId, why: th.missing };
  const bands = ['A', 'B'].map(s => controlBand(endpoint, RENDERERS[s].adapter, controls, e));
  const uncalibrated = bands.filter(b => !b.calibrated);
  if (uncalibrated.length && !endpoint.kind) return { ...out, status: 'no-control', runId: record.runId, why: uncalibrated.map(b => b.why).join('; ') };
  const edge = endpoint.kind ? null : Math.max(bands[0].edge, bands[1].edge);
  const a = analyze(endpoint.workload, record.runs, { level: FAMILY_LEVEL, bootstrapSeed: record.design?.bootstrapSeed ?? 12345, ...(endpoint.kind ? {} : { endpoint: { metric: endpoint.metric, swi: th.swi, tol: th.tol }, noise: { metrics: { [endpoint.metric]: { lo: -edge, hi: edge } } } }) });
  const failed = { A: a.reliability.failed.A, B: a.reliability.failed.B };
  if (endpoint.kind === 'late-runs') {
    const late = { A: 0, B: 0 };
    for (const r of record.runs) if (r.phase === 'timed' && r.outcome === 'ok' && r.summary?.lateRun) late[r.config]++;
    return { ...out, status: 'measured', runId: record.runId, failed, late, pairs: a.completePairs };
  }
  const m = a.metrics[endpoint.metric];
  if (!m || m.na) return { ...out, status: 'measured', runId: record.runId, failed, why: m?.na ?? 'metric missing', ci: null };
  if (m.pairs < MIN_PAIRS) return { ...out, status: 'exploratory', runId: record.runId, failed, why: `${m.pairs} complete pairs, fewer than ${MIN_PAIRS}` };
  const gap = Math.abs(m.byOrder.AB.diff - m.byOrder.BA.diff);
  if (Number.isFinite(gap) && gap > edge) return { ...out, status: 'carry-over', runId: record.runId, failed, why: `AB estimate ${m.byOrder.AB.diff}, BA estimate ${m.byOrder.BA.diff}: they differ by ${gap}, more than the noise edge ${edge}; rerun with a fresh browser process per run (--isolate)`, isolated: !!record.design?.isolate };
  return { ...out, status: 'measured', runId: record.runId, failed, ci: { lo: m.lo, hi: m.hi, estimate: m.diff, level: FAMILY_LEVEL }, thresholds: m.endpoint.thresholds, classification: m.endpoint, medians: { A: m.medianA, B: m.medianB } };
}

/** The pilot for one endpoint: frozen thresholds (budget-less endpoints) and whether AB and BA agree within the noise edge. */
export function assessPilot(endpoint, pilotRecord, edge = null) {
  const a = analyze(endpoint.workload, pilotRecord.runs, { bootstrapSeed: pilotRecord.design?.bootstrapSeed ?? 12345 });
  const m = a.metrics[endpoint.metric];
  const res = { id: endpoint.id, pilotRunId: pilotRecord.runId };
  if (!m || m.na) return { ...res, ok: false, why: m?.na ?? 'metric missing' };
  if (endpoint.pilot) {
    const slower = Math.max(m.medianA, m.medianB);
    res.frozen = { swi: endpoint.pilot.swi * slower, tol: endpoint.pilot.tol * slower, slowerMedian: slower, frozenAt: new Date().toISOString(), pilotRunId: pilotRecord.runId };
  }
  const gap = Math.abs(m.byOrder.AB.diff - m.byOrder.BA.diff);
  res.order = { AB: m.byOrder.AB.diff, BA: m.byOrder.BA.diff, gap, edge };
  res.isolate = edge == null ? 'unknown: no calibrated control yet' : gap > edge;
  res.ok = true;
  return res;
}

/** Per-renderer standing on one measured endpoint: wins, beyond-tolerance regressions, failures, gain. */
export function standing(result) {
  const e = result.endpoint;
  const s = { A: { win: false, beyondTol: false, failed: result.failed?.A > 0 }, B: { win: false, beyondTol: false, failed: result.failed?.B > 0 } };
  if (e.kind === 'late-runs' && result.late) {
    s.A.win = result.late.A < result.late.B; s.B.win = result.late.B < result.late.A;
    s.A.beyondTol = result.late.A > result.late.B; s.B.beyondTol = result.late.B > result.late.A;
  } else if (result.classification) {
    const c = result.classification;
    s.A.win = c.aWins; s.B.win = c.bWins; s.A.beyondTol = c.aBeyondTol || c.bWins; s.B.beyondTol = c.bBeyondTol || c.aWins;
    s.A.gain = result.ci ? result.ci.lo : NaN; // A's improvement over B: lower bound of B − A
    s.B.gain = result.ci ? -result.ci.hi : NaN;
    s.tooNoisy = !!c.tooNoisy;
    s.inconclusive = c.label === 'inconclusive';
  }
  for (const side of ['A', 'B']) if (s[side].failed) { s[side].beyondTol = true; s[side].win = false; s[side].gain = NaN; }
  return s;
}

const other = side => (side === 'A' ? 'B' : 'A');
const nameOf = side => RENDERERS[side].name;

/**
 * Section 5.1's rule. `results` is a list of assessEndpoint results for the nine family endpoints.
 * opts.canvasBytesGzip: the measured marginal gzip size of the Canvas renderer (null when not measured).
 * Returns { kind: 'renderer' | 'renderer-with-kept' | 'none', default?, kept?, rule, missing, perEndpoint, open }.
 */
export function decideRenderer(results, { canvasBytesGzip = null } = {}) {
  const byId = new Map(results.map(r => [r.id, r]));
  const missing = [];
  for (const e of FAMILY) {
    const r = byId.get(e.id);
    if (!r) missing.push({ endpoint: e.id, why: 'not assessed' });
    else if (r.status !== 'measured') missing.push({ endpoint: e.id, status: r.status, why: r.why });
    else if (!r.endpoint.kind && !r.classification && !(r.failed?.A || r.failed?.B)) missing.push({ endpoint: e.id, status: 'no-interval', why: r.why ?? 'no interval' });
  }
  const per = {};
  for (const e of FAMILY) { const r = byId.get(e.id); if (r?.status === 'measured') per[e.id] = standing(r); }
  // Interpretation: an inconclusive interval (straddling a threshold) on a primary endpoint is rerun (section 5,
  // "inconclusive ... triggers a rerun, not a pass") before any branch applies.
  for (const [id, s] of Object.entries(per)) if (s.inconclusive && !s.A.failed && !s.B.failed) missing.push({ endpoint: id, status: 'inconclusive', why: 'the interval straddles a threshold: rerun' });
  const base = { perEndpoint: per, missing };
  if (missing.length) return { ...base, kind: 'none', rule: 'no decision yet', open: missing.map(m => `${m.endpoint}: ${m.status ?? ''} ${m.why ?? ''}`.trim()) };

  const wins = { A: [], B: [] }, regress = { A: [], B: [] };
  for (const [id, s] of Object.entries(per)) for (const side of ['A', 'B']) { if (s[side].win) wins[side].push(id); if (s[side].beyondTol) regress[side].push(id); }
  // Rule 1: worse beyond tolerance somewhere, better beyond the worthwhile margin nowhere: loses.
  const loses = side => regress[side].length > 0 && wins[side].length === 0;
  if (loses('A') && loses('B')) return { ...base, kind: 'none', rule: 'rule 1: both renderers lose (the plan has no rule for this)', wins, regress, open: ['plan 5.1 needs a rule for two losers'] };
  for (const side of ['A', 'B']) if (loses(side)) return { ...base, kind: 'renderer', default: nameOf(other(side)), rule: `rule 1: ${nameOf(side)} is worse beyond tolerance on ${regress[side].join(', ')} and better by the worthwhile margin on none`, wins, regress };
  // Rule 2: both win somewhere: count the everyday workloads, P3 as one.
  if (wins.A.length && wins.B.length) {
    const everyday = { A: [], B: [] };
    for (const w of EVERYDAY) {
      if (w === 'P3') {
        const t = per['P3-task'], l = per['P3-late'];
        for (const side of ['A', 'B']) {
          const moreLate = l?.[side].beyondTol;
          if (t?.[side].win && !moreLate) everyday[side].push('P3');
        }
      } else for (const side of ['A', 'B']) if (per[w]?.[side].win) everyday[side].push(w);
    }
    if (everyday.A.length !== everyday.B.length) {
      const def = everyday.A.length > everyday.B.length ? 'A' : 'B', o = other(def);
      const kept = [];
      for (const id of wins[o]) {
        const e = endpointById(id), s = per[id], r = byId.get(id);
        if (e.kind) continue; // a count has no "four times" (interpretation)
        const swi = r.thresholds?.swi;
        if (s[o].gain >= KEEP_FACTOR * swi) kept.push({ renderer: nameOf(o), chartType: e.chartType, endpoint: id, gainLowerBound: s[o].gain, needed: KEEP_FACTOR * swi });
      }
      return { ...base, kind: kept.length ? 'renderer-with-kept' : 'renderer', default: nameOf(def), kept, rule: `rule 2: ${nameOf(def)} wins ${everyday[def].length} everyday workloads (${everyday[def].join(', ') || 'none'}), ${nameOf(o)} ${everyday[o].length} (${everyday[o].join(', ') || 'none'})`, wins, regress, everyday };
    }
    // Equal everyday counts: rule 3 (plan 5.1).
  }
  // Rule 3: nothing separates them.
  const res = { ...base, kind: 'renderer', default: 'svg', rule: 'rule 3: nothing separates the renderers; SVG stays', wins, regress };
  if (canvasBytesGzip == null) return { ...res, canvas: 'open: the marginal Canvas size is not measured (node bench/tools/canvas-cost.mjs)', open: ['marginal Canvas size'] };
  return { ...res, canvas: canvasBytesGzip > CANVAS_BYTES_LIMIT ? `removed from the 1.0 bundle: it costs ${canvasBytesGzip} B gzipped, more than ${CANVAS_BYTES_LIMIT}` : `kept behind the switch: it costs ${canvasBytesGzip} B gzipped, at most ${CANVAS_BYTES_LIMIT}` };
}

export { median };
