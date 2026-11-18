#!/usr/bin/env node
// The renderer decision of plan 5.1, end to end, on one sealed artifact:
//
//   node bench/decision.mjs plan                       the command sequence, with expected durations
//   node bench/decision.mjs controls --artifact <dir>  one A-versus-A session per renderer per endpoint job (run 3x)
//   node bench/decision.mjs pilot    --artifact <dir>  10-block comparisons; freezes the budget-less thresholds and
//                                                      the per-order (carry-over) check into bench/decision/pilot.json
//   node bench/decision.mjs endpoints --artifact <dir> 20-block comparisons, a fresh browser per run where the pilot
//                                                      found order effects
//   node bench/decision.mjs decide   --artifact <dir>  applies the rule (src/decision.js) to the recorded jobs and
//                                                      writes bench/decision/decision-<time>.json
//
// Every job is an ordinary run.mjs session (history/<run id>.json); bench/decision/ledger.json lists which job is
// which. Nothing here relaxes a rule: an ineligible, uncontrolled or carried-over endpoint leaves "no decision yet".
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';
import { readArtifact, BENCH, REPO, sha256 } from './build.mjs';
import { runSession } from './run.mjs';
import { FAMILY, RENDERERS, FAMILY_LEVEL, assessEndpoint, assessPilot, decideRenderer, environmentKey, controlBand, endpointById } from './src/decision.js';
import { DEFAULT_BOOTSTRAP_SEED } from './src/stats.js';
import { canvasCost } from './tools/canvas-cost.mjs';

let DIR = path.join(BENCH, 'decision'), LEDGER, PILOT, historyDir = path.join(BENCH, 'history');
const setDirs = (dir, hist) => { DIR = path.resolve(dir ?? DIR); LEDGER = path.join(DIR, 'ledger.json'); PILOT = path.join(DIR, 'pilot.json'); if (hist) historyDir = path.resolve(hist); };
const die = m => { console.error(`decision.mjs: ${m}`); process.exit(2); };

/** One job per distinct workload and parameters (P3's two metrics share the stream job). */
export const JOBS = (() => {
  const by = new Map();
  for (const e of FAMILY) { const k = `${e.workload} ${JSON.stringify(e.params)}`; if (!by.has(k)) by.set(k, { workload: e.workload, params: e.params, endpoints: [] }); by.get(k).endpoints.push(e.id); }
  return [...by.values()];
})();
/** Rough seconds per run on the reference machine, from smoke runs (create workloads include the 500 ms settle). */
const SECONDS_PER_RUN = { first: 2.5, page: 3, compact: 3, scatter: 3.5, stream: 8, zoom: 7 };
const jobSeconds = (job, blocks, isolate) => (2 * blocks + 4) * ((job.params.size === '10x100000' ? 5 : SECONDS_PER_RUN[job.workload] ?? 4) + (isolate ? 1 : 0));

const readJson = (p, fallback) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fallback);
const ledger = () => readJson(LEDGER, { schema: 'axylo-bench-decision-ledger/1', jobs: [] });
const appendLedger = entry => { fs.mkdirSync(DIR, { recursive: true }); const l = ledger(); l.jobs.push({ ...entry, at: new Date().toISOString() }); fs.writeFileSync(LEDGER, JSON.stringify(l, null, 1)); };
const loadRecord = id => readJson(path.join(historyDir, `${id}.json`), null);

function baseCfg(a, artifact) {
  return { artifacts: { A: artifact }, settleMs: Number(a.settle ?? 500), timeoutMs: 120000, dpr: 1, headed: false, historyDir, quiet: a.quiet, bootstrapSeed: DEFAULT_BOOTSTRAP_SEED, noiseIds: null };
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { values: a } = parseArgs({ args: rest, options: { artifact: { type: 'string' }, blocks: { type: 'string' }, only: { type: 'string' }, 'canvas-bytes': { type: 'string' }, quiet: { type: 'boolean', default: false }, dir: { type: 'string' }, 'history-dir': { type: 'string' }, settle: { type: 'string' } } });
  setDirs(a.dir, a['history-dir']);
  if (cmd === 'plan') return plan();
  if (!['controls', 'pilot', 'endpoints', 'decide'].includes(cmd)) die('usage: node bench/decision.mjs plan | controls | pilot | endpoints | decide --artifact <dir>');
  if (!a.artifact) die('--artifact <sealed artifact dir> is required: the whole decision family uses one artifact');
  const artifact = readArtifact(a.artifact);
  const jobs = a.only ? JOBS.filter(j => j.endpoints.some(e => a.only.split(',').includes(e))) : JOBS;
  const seed = () => crypto.randomInt(1, 2 ** 31);

  if (cmd === 'controls') {
    const blocks = Number(a.blocks ?? 20);
    for (const job of jobs) for (const side of ['A', 'B']) {
      const ref = RENDERERS[side].adapter;
      const rec = await runSession({ ...baseCfg(a, artifact), mode: 'aa', A: { ref, slot: 'A' }, B: { ref, slot: 'A' }, workload: job.workload, params: job.params, blocks, seed: seed(), command: ['decision', 'controls'] });
      appendLedger({ kind: 'control', endpoints: job.endpoints, adapter: ref, runId: rec.runId, artifact: artifact.id, eligible: rec.eligibility?.eligible ?? false });
      console.log(`control ${ref} ${job.endpoints.join('+')}: ${rec.runId} ${rec.eligibility?.eligible ? 'eligible' : `NOT eligible (${rec.eligibility?.reasons?.join('; ')})`}`);
    }
    return;
  }
  if (cmd === 'pilot') {
    const blocks = Number(a.blocks ?? 10);
    const pilot = readJson(PILOT, { schema: 'axylo-bench-pilot/1', artifact: artifact.id, endpoints: {} });
    if (pilot.artifact !== artifact.id) die(`bench/decision/pilot.json is for artifact ${pilot.artifact}; move it away to pilot another artifact`);
    const controls = ledger().jobs.filter(j => j.kind === 'control' && j.artifact === artifact.id).map(j => loadRecord(j.runId)).filter(Boolean);
    for (const job of jobs) {
      const rec = await runSession({ ...baseCfg(a, artifact), mode: 'compare', A: { ref: RENDERERS.A.adapter, slot: 'A' }, B: { ref: RENDERERS.B.adapter, slot: 'A' }, workload: job.workload, params: job.params, blocks, seed: seed(), command: ['decision', 'pilot'] });
      appendLedger({ kind: 'pilot', endpoints: job.endpoints, runId: rec.runId, artifact: artifact.id });
      for (const id of job.endpoints) {
        const e = endpointById(id);
        if (e.kind) continue;
        const env = environmentKey(rec);
        const bands = ['A', 'B'].map(s => controlBand(e, RENDERERS[s].adapter, controls, env, 0.95));
        const edge = bands.every(b => b.calibrated) ? Math.max(bands[0].edge, bands[1].edge) : null;
        const p = assessPilot(e, rec, edge);
        // Frozen once: a later pilot run never moves thresholds that comparisons may already rely on.
        const prev = pilot.endpoints[id];
        pilot.endpoints[id] = { ...p, ...(prev?.frozen ? { frozen: prev.frozen } : {}) };
        console.log(`pilot ${id}: ${p.ok ? `AB ${p.order.AB}, BA ${p.order.BA}, isolate: ${p.isolate}${p.frozen ? `; thresholds ${(prev?.frozen ?? p.frozen).swi} / ${(prev?.frozen ?? p.frozen).tol}` : ''}` : p.why}`);
      }
      fs.mkdirSync(DIR, { recursive: true });
      fs.writeFileSync(PILOT, JSON.stringify(pilot, null, 1));
    }
    return;
  }
  if (cmd === 'endpoints') {
    const blocks = Number(a.blocks ?? 20);
    const pilot = readJson(PILOT, null);
    if (!pilot) die('run the pilot first (bench/decision/pilot.json missing)');
    for (const job of jobs) {
      const isolate = job.endpoints.some(id => pilot.endpoints[id]?.isolate === true);
      const unknown = job.endpoints.filter(id => !endpointById(id).kind && typeof pilot.endpoints[id]?.isolate !== 'boolean');
      if (unknown.length) console.log(`note: the pilot could not check order effects for ${unknown.join(', ')} (no calibrated control at pilot time); running without isolation, the decision checks again`);
      const rec = await runSession({ ...baseCfg(a, artifact), mode: 'compare', A: { ref: RENDERERS.A.adapter, slot: 'A' }, B: { ref: RENDERERS.B.adapter, slot: 'A' }, workload: job.workload, params: job.params, blocks, seed: seed(), isolate, endpoint: job.endpoints[0], command: ['decision', 'endpoints'] });
      appendLedger({ kind: 'endpoint', endpoints: job.endpoints, runId: rec.runId, artifact: artifact.id, isolate });
      console.log(`endpoint ${job.endpoints.join('+')}: ${rec.runId}${isolate ? ' (process per run)' : ''}`);
    }
    return;
  }
  // decide
  const l = ledger().jobs.filter(j => j.artifact === artifact.id);
  const controls = l.filter(j => j.kind === 'control').map(j => loadRecord(j.runId)).filter(Boolean);
  const pilot = readJson(PILOT, { endpoints: {} });
  const frozen = Object.fromEntries(Object.entries(pilot.endpoints ?? {}).filter(([, p]) => p.frozen).map(([id, p]) => [id, p.frozen]));
  const latest = id => { const j = l.filter(x => x.kind === 'endpoint' && x.endpoints.includes(id)).at(-1); return j ? loadRecord(j.runId) : null; };
  const records = FAMILY.map(e => [e, latest(e.id)]);
  const first = records.find(([, r]) => r)?.[1];
  const env = first ? environmentKey(first) : null;
  const results = records.map(([e, record]) => assessEndpoint(e, { record, controls, frozen, env }));
  let canvasBytesGzip = a['canvas-bytes'] !== undefined ? Number(a['canvas-bytes']) : null, canvasNote = canvasBytesGzip != null ? 'given on the command line' : null;
  if (canvasBytesGzip == null) {
    // Measured from the sources the artifact was built from, only if the checkout still has exactly those sources.
    const same = Object.entries(artifact.source.axyloInputs).every(([p, h]) => { try { return sha256(fs.readFileSync(path.join(artifact.source.root ?? REPO, 'packages/axylo/src', p))) === h; } catch { return false; } });
    if (same) { const c = await canvasCost(artifact.source.root ?? REPO); canvasBytesGzip = c.canvasBytesGzip; canvasNote = `measured: ${c.method}`; }
    else canvasNote = 'not measured: the checkout no longer has the artifact\'s sources (pass --canvas-bytes from a measurement of them)';
  }
  const decision = decideRenderer(results, { canvasBytesGzip });
  const out = { schema: 'axylo-bench-decision/1', at: new Date().toISOString(), artifact: artifact.id, environment: env, level: FAMILY_LEVEL, canvasBytesGzip, canvasNote, results: results.map(({ endpoint, ...r }) => r), decision };
  fs.mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, `decision-${out.at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(`decision (${decision.rule}): ${decision.kind === 'none' ? 'NO DECISION YET' : decision.default}${decision.kept?.length ? `, with ${decision.kept.map(k => `${k.renderer} kept for ${k.chartType}`).join(', ')}` : ''}${decision.canvas ? `; canvas ${decision.canvas}` : ''}`);
  for (const r of results) console.log(`  ${r.id.padEnd(13)} ${r.status}${r.classification ? `: ${r.classification.label} [${r.ci.lo.toFixed(3)}, ${r.ci.hi.toFixed(3)}]` : ''}${r.late ? `: late runs canvas ${r.late.A}, svg ${r.late.B}` : ''}${r.why ? ` (${r.why})` : ''}`);
  if (decision.open?.length) console.log(`  open: ${decision.open.join('; ')}`);
  console.log(`written ${path.relative(process.cwd(), file)}`);
}

function plan() {
  const t = (blocks, isolate) => JOBS.reduce((s, j) => s + jobSeconds(j, blocks, isolate), 0) / 60;
  const controls = 2 * t(20, false), pilot = t(10, false), endpoints = t(20, false), endpointsIsolated = t(20, true);
  console.log(`Renderer decision, plan 5.1, on one sealed artifact, on a quiet machine (one-minute load under 1.0 at every block).
${JOBS.length} endpoint jobs: ${JOBS.map(j => j.endpoints.join('+')).join(', ')}.

  node bench/build.mjs                                                      # note the artifact directory, <A>
  node bench/decision.mjs controls --artifact <A>     # session 1: ~${controls.toFixed(0)} min
  node bench/decision.mjs controls --artifact <A>     # session 2, later (a separate session): ~${controls.toFixed(0)} min
  node bench/decision.mjs controls --artifact <A>     # session 3: ~${controls.toFixed(0)} min
  node bench/decision.mjs pilot --artifact <A>        # ~${pilot.toFixed(0)} min; freezes thresholds for scatter-50k, line-10x100k, zoom-100k
  node bench/decision.mjs endpoints --artifact <A>    # ~${endpoints.toFixed(0)} min (~${endpointsIsolated.toFixed(0)} min if every job needs a process per run)
  node bench/decision.mjs decide --artifact <A>       # seconds; prints the decision or what is missing

Total ~${((3 * controls + pilot + endpoints) / 60).toFixed(1)} h of runs (estimates from smoke runs under load). A job whose session is not
eligible (load, Chrome version) is recorded and does not count: rerun that step for those endpoints with --only <ids>.`);
}

await main();
