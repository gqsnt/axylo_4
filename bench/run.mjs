#!/usr/bin/env node
// Benchmark runner: a baseline and a candidate, one workload, randomized balanced blocks, a fresh browser context per
// run, raw samples written to bench/history/<run id>.json after every run.
//
//   node bench/run.mjs --baseline uplot --candidate chartjs-tuned --workload first --size 1x100000
//   node bench/run.mjs --aa uplot --workload first --size 1x100000                     (A-versus-A noise band)
//   node bench/run.mjs ... --noise <run id of an A-versus-A run>[,<another>]             (use that band; checked)
//   node bench/run.mjs --baseline axylo-canvas --candidate axylo-svg ...                 (renderer comparison)
//   node bench/run.mjs --adapter axylo-svg --base <artifact dir> --candidate <artifact dir> ...   (two builds)
//
// Every session serves one sealed artifact per side (bench/build.mjs). Without --artifact (or --base/--candidate
// in two-build mode) the runner builds a fresh one for this session. See bench/README.md for what each metric means.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { build, readArtifact, BENCH } from './build.mjs';
import { startServer, launchBrowser, runOnce, machineRecord, expectedFor, rasterInfo, rasterLabel } from './lib/driver.mjs';
import { balancedOrder, summarizeRun, analyze, parseSeed, median, DEFAULT_BOOTSTRAP_SEED } from './src/stats.js';
import { formatAnalysis } from './lib/report.mjs';
import { parseAdapterRef, loadNoise, controlsOf, WORKLOADS } from './lib/refs.mjs';
import { endpointById, sessionEligibility, RENDERERS } from './src/decision.js';

/** Workloads that a budget in spec section 5 names; they default to the plan's 20 runs per configuration. */
export const DEFAULT_BLOCKS = 20;

/** Parameters of a workload from the command line; keys that are not given are left out (never undefined). */
export function workloadParams(workload, a) {
  const def = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  const n = v => (v === undefined ? undefined : Number(v));
  const lineOrTrend = fallback => (a.fixture === 'trend' ? { fixture: 'trend' } : { size: a.size ?? fallback, gaps: !!a.gaps });
  switch (workload) {
    case 'first': return def(lineOrTrend('3x120'));
    case 'page': return def({ ...lineOrTrend('3x120'), charts: n(a.charts) ?? 24 });
    case 'compact': return def({ fixture: 'trend', charts: n(a.charts) ?? 40 });
    case 'scatter': return def({ size: a.size ?? '1x10000', clustered: !!a.clustered });
    case 'theme': return def(a.fixture === 'trend' ? { fixture: 'trend', toggles: n(a.toggles) ?? 20 } : { size: a.size ?? '3x120', toggles: n(a.toggles) ?? 20 });
    case 'resize': return def({ size: a.size ?? '1x100000', charts: n(a.charts) ?? 1 });
    case 'stream': return def({ window: n(a.window) ?? 600, samples: n(a.samples) ?? 300 });
    case 'hover': return def({ size: a.size ?? '1x100000', gaps: false, moves: n(a.moves) ?? 200 });
    case 'zoom': return def({ size: a.size ?? '1x100000', gaps: false });
    case 'mem': return def({ size: a.size ?? '1x1000000', gaps: false });
    case 'lifecycle': return def({ fixture: 'trend', cycles: n(a.cycles) ?? 2500 }); // plan 5.1: windows 1,500-2,000 and 2,000-2,500
    default: throw new Error(`unknown workload ${workload}`);
  }
}

const tagOf = (workload, p) => workload === 'stream' ? `w${p.window}`
  : `${p.fixture ?? p.size}${p.gaps ? '-gaps' : ''}${p.clustered ? '-clustered' : ''}${p.charts > 1 ? `-x${p.charts}` : ''}${p.cycles ? `-c${p.cycles}` : ''}`;
const slug = ref => ref.replace(/[^a-zA-Z0-9.-]+/g, '_');
const artifactSlot = m => ({ artifact: m.id, dir: m.dir, manifestSha256: m.manifestSha256, source: { head: m.source.head, uncommitted: m.source.uncommitted, axyloSourceHash: m.source.axyloSourceHash, shippedOptions: m.source.shippedOptions, distComparison: m.source.distComparison }, bench: m.bench, files: Object.fromEntries(Object.entries(m.files).map(([p, f]) => [p, f.sha256])), served: {} });
const HARNESS = rel => rel === 'index.html' || rel === 'page.js' || rel.startsWith('adapters/');

/**
 * One balanced job. cfg: { mode: 'compare' | 'aa' | 'builds', A: { ref, slot }, B: { ref, slot }, artifacts: { A, B? },
 * workload, params, blocks, seed, bootstrapSeed, settleMs, timeoutMs, dpr, headed, noiseIds, historyDir, quiet,
 * command, label }. Returns the record (also written to history).
 */
export async function runSession(cfg) {
  const log = (...m) => { if (!cfg.quiet) console.log(...m); };
  const order = balancedOrder(cfg.blocks, cfg.seed);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const who = cfg.mode === 'aa' ? `aa-${slug(cfg.A.ref)}` : cfg.mode === 'builds' ? `builds-${slug(cfg.A.ref)}` : `${slug(cfg.A.ref)}-vs-${slug(cfg.B.ref)}`;
  const runId = `${stamp}-${cfg.workload}-${tagOf(cfg.workload, cfg.params)}${cfg.dpr !== 1 ? `-dpr${cfg.dpr}` : ''}-${who}-${crypto.randomBytes(2).toString('hex')}`;
  fs.mkdirSync(cfg.historyDir, { recursive: true });
  const file = path.join(cfg.historyDir, `${runId}.json`);
  const refA = parseAdapterRef(cfg.A.ref), refB = parseAdapterRef(cfg.B.ref);
  const record = {
    schema: 'axylo-bench/2',
    runId,
    // Stays "interrupted" until the last run is analysed; a run cut short by a restart is never merged with another.
    status: 'interrupted',
    startedAt: new Date().toISOString(),
    command: cfg.command ?? null,
    design: {
      raster: cfg.gpu ? 'gpu' : 'software',
      mode: cfg.mode, baseline: cfg.A.ref, candidate: cfg.B.ref, labels: { A: cfg.A.ref, B: cfg.B.ref }, adapters: { A: refA, B: refB },
      ...(cfg.mode === 'builds' ? { builds: { A: cfg.artifacts.A.dir, B: cfg.artifacts.B.dir } } : {}),
      workload: cfg.workload, params: cfg.params, blocks: cfg.blocks, order, seed: cfg.seed, bootstrapSeed: cfg.bootstrapSeed,
      settleMs: cfg.settleMs, timeoutMs: cfg.timeoutMs, dpr: cfg.dpr, viewport: [1440, 900],
      warmup: 'one untimed admission run per side (A then B), then one untimed warm-up run per side in the opposite order (B then A), so each side has run twice in this browser before timing starts',
      isolate: !!cfg.isolate,
      isolation: cfg.isolate ? 'a fresh browser process for every run (plan 5.1, where order changes the estimate)' : 'one browser process for the session, a fresh context per run',
      endpoint: cfg.endpoint ?? null,
      noiseFrom: null,
    },
    environment: null,
    hashes: { fixtureChecksum: expectedFor(cfg.workload, cfg.params).checksum, slots: { A: artifactSlot(cfg.artifacts.A), B: artifactSlot(cfg.artifacts.B ?? cfg.artifacts.A) } },
    admission: {},
    probes: {},
    // One-minute load at the start of each block documents the measurement conditions.
    blocks: [],
    runs: [],
    analysis: null,
  };
  const save = () => { const tmp = `${file}.tmp`; fs.writeFileSync(tmp, JSON.stringify(record, null, 1)); fs.renameSync(tmp, file); };

  let browser, server;
  const stop = async (status, why) => {
    record.status = status;
    record.endedBecause = why;
    record.finishedAt = new Date().toISOString();
    if (server) {
      const served = server.served();
      for (const slot of ['A', 'B']) {
        const s = cfg.mode === 'builds' ? slot : 'A';
        record.hashes.slots[slot].served = served[s] ?? {};
      }
      record.integrity = { violations: server.violations() };
    }
    record.eligibility = sessionEligibility(record);
    save();
    await browser?.close().catch(() => {});
    await server?.close().catch(() => {});
  };
  const onSignal = async sig => { await stop('interrupted', `signal ${sig}`); console.error(`\ninterrupted; partial record kept in ${file}`); process.exit(130); };
  const handlers = ['SIGINT', 'SIGTERM', 'SIGHUP'].map(sig => { const h = () => onSignal(sig); process.on(sig, h); return [sig, h]; });
  try {
    const slots = cfg.mode === 'builds' ? { A: cfg.artifacts.A, B: cfg.artifacts.B } : { A: cfg.artifacts.A };
    for (const [side, ref] of [['A', refA], ['B', refB]]) {
      const m = slots[cfg[side].slot];
      if (!m.adapters[ref.id]) throw new Error(`no adapter "${ref.id}" in artifact ${m.id} (have: ${Object.keys(m.adapters).join(', ')})`);
    }
    browser = await launchBrowser({ headed: cfg.headed, gpu: cfg.gpu });
    record.environment = { ...machineRecord(browser, { headed: cfg.headed }), libraries: cfg.artifacts.A.versions };
    // Raster: what this browser actually does. A GPU session whose browser rasterizes in software is refused.
    const raster = await rasterInfo(browser);
    record.environment.raster = { ...rasterLabel(raster, !!cfg.gpu), detail: raster, flags: cfg.gpu ? (cfg.headed ? 'headed, --ignore-gpu-blocklist' : 'headless, --enable-gpu --use-angle=gl --ignore-gpu-blocklist') : 'Playwright defaults' };
    if (record.environment.raster.refused) throw new Error(`refusing to label this session "gpu": ${record.environment.raster.refused}`);
    server = await startServer(slots);
    if (cfg.noiseIds) {
      const noise = loadNoise(cfg.noiseIds, cfg.historyDir, controlsOf(record));
      record.design.noiseFrom = noise.sources;
      record.design.noiseCalibration = noise.calibration;
      cfg.noise = noise;
    }
    save();
    log(`run ${runId}\n  ${cfg.mode === 'aa' ? `A-versus-A: ${cfg.A.ref}` : cfg.mode === 'builds' ? `two builds of ${cfg.A.ref}: A=${cfg.artifacts.A.id} B=${cfg.artifacts.B.id}` : `A=${cfg.A.ref}  B=${cfg.B.ref}`}  ${cfg.workload} ${JSON.stringify(cfg.params)}  ${cfg.blocks} blocks  order seed ${cfg.seed}, bootstrap seed ${cfg.bootstrapSeed}`);
    log(`  Chrome ${browser.version()} ${cfg.headed ? 'headed' : 'headless'}, history -> ${path.relative(process.cwd(), file)}`);

    // Every run goes through here: in isolated sessions each run gets its own browser process, and every run
    // records the Chrome version it ran in (a session counts only with one version).
    const execute = async s => {
      if (!cfg.isolate) return checkRaster({ ...(await runOnce(browser, server, s)), chromeVersion: browser.version() });
      const own = await launchBrowser({ headed: cfg.headed, gpu: cfg.gpu });
      try { return checkRaster({ ...(await runOnce(own, server, s)), chromeVersion: own.version() }); } finally { await own.close().catch(() => {}); }
    };
    // Every GPU run's own page must report a hardware WebGL renderer; a run that fell back to SwiftShader is an
    // environment error, not a GPU timing.
    const checkRaster = r => (cfg.gpu && /swiftshader/i.test(String(r.result?.env?.webglRenderer ?? '')) ? { ...r, outcome: 'error', error: `GPU mode, but this run's page reports WebGL "${r.result.env.webglRenderer}"`, deltas: undefined } : r);
    const spec = (side, extra = {}) => ({ adapter: (side === 'A' ? refA : refB).id, adapterParams: (side === 'A' ? refA : refB).params, slot: cfg[side].slot, workload: cfg.workload, params: cfg.params, settleMs: cfg.settleMs, timeoutMs: cfg.timeoutMs, dpr: cfg.dpr, ...extra });
    const sides = cfg.mode === 'aa' ? ['A'] : ['A', 'B'];
    const keyOf = side => `${cfg[side].slot}:${cfg[side].ref}`;

    // Admission: one untimed probe run per side that captures what the chart drew. A side that does not show the
    // fixture is not timed at all.
    for (const side of sides) {
      const r = await execute(spec(side, { probe: 'geometry' }));
      const adm = { outcome: r.outcome, reason: r.reason ?? r.error ?? null, admission: r.admission ?? null, describe: r.result?.describe ?? null, adapter: r.result?.adapter ?? null, themeCheck: r.result?.themeCheck, resizeCheck: r.result?.resizeCheck, hoverCheck: r.result?.hoverCheck, theme: r.result?.theme ? { framesToChange: r.result.theme.framesToChange, states: r.result.theme.states } : undefined, resize: r.result?.resize ? { intermediate: r.result.resize.intermediate } : undefined };
      record.admission[keyOf(side)] = adm;
      if (r.result?.env && !record.environment.page) record.environment.page = r.result.env;
      record.runs.push({ index: record.runs.length, phase: 'admission', chromeVersion: r.chromeVersion, side, adapter: r.adapter, slot: cfg[side].slot, outcome: r.outcome, reason: adm.reason, limits: r.admission?.limits, durationMs: r.durationMs, logs: r.logs, pageErrors: r.pageErrors });
      if (cfg.workload === 'theme' && r.outcome === 'ok') {
        const ftc = r.result.theme.framesToChange;
        record.probes[`${keyOf(side)}:colors`] = { kind: 'per-mark colors after every toggle; frames until new colors (4 untimed toggles)', outcome: 'ok', summary: { framesToNewColor: ftc.every(v => v !== null) ? Math.max(...ftc) : 'not available: a toggle took more than 10 frames' } };
      }
      save();
      log(`  admission ${keyOf(side)}: ${r.outcome}${adm.reason ? ` (${adm.reason})` : ''}`);
    }
    if (cfg.workload === 'theme') {
      // Drawing work per toggle, counted in its own untimed run (the counters add work, so never in a timed run).
      for (const side of sides) {
        if (record.admission[keyOf(side)].outcome !== 'ok') continue;
        const r = await execute(spec(side, { probe: 'counters' }));
        const w = r.result?.theme?.work ?? [];
        record.probes[`${keyOf(side)}:counters`] = { kind: 'Canvas 2D calls and DOM mutations per toggle', outcome: r.outcome, reason: r.reason ?? r.error, summary: w.length ? { canvasCallsPerToggle: median(w.map(x => x.canvasCalls)), mutationsPerToggle: median(w.map(x => x.mutations)) } : null };
        record.runs.push({ index: record.runs.length, phase: 'probe', side, probe: 'counters', adapter: r.adapter, slot: cfg[side].slot, outcome: r.outcome, durationMs: r.durationMs, work: w });
        save();
      }
    }
    const blocked = sides.map(s => [keyOf(s), record.admission[keyOf(s)]]).filter(([, v]) => v.outcome !== 'ok');
    if (blocked.length) {
      record.analysis = { notCompared: blocked.map(([id, v]) => `${id}: ${v.outcome}${v.reason ? ` (${v.reason})` : ''}` ) };
      await stop('complete', 'admission failed or adapter not available; nothing was timed');
      log(`  not timed: ${record.analysis.notCompared.join('; ')}`);
      return record;
    }
    // Symmetric warm-up: the admission runs went A then B; one more untimed run each, B then A.
    for (const side of [...sides].reverse()) {
      const r = await execute(spec(side));
      record.runs.push({ index: record.runs.length, phase: 'warmup', chromeVersion: r.chromeVersion, side, adapter: r.adapter, slot: cfg[side].slot, outcome: r.outcome, reason: r.reason ?? r.error ?? null, durationMs: r.durationMs });
      save();
    }

    for (let b = 0; b < order.length; b++) {
      const load1 = os.loadavg()[0];
      record.blocks.push({ block: b, load1, at: new Date().toISOString() });
      log(`  block ${b + 1}: one-minute load ${load1.toFixed(2)} at its start`);
      for (let pos = 0; pos < 2; pos++) {
        const side = order[b][pos];
        const r = await execute(spec(side));
        const run = { index: record.runs.length, phase: 'timed', block: b, position: pos, config: side, startedAt: new Date(Date.now() - r.durationMs).toISOString(), ...r, ref: cfg[side].ref };
        if (r.outcome === 'ok') run.summary = summarizeRun(cfg.workload, r);
        record.runs.push(run);
        save();
        const primary = run.summary ? Object.entries(run.summary).find(([k]) => ['taskMs', 'taskMsPerUpdate', 'taskMsPerToggle', 'inputToReadoutP95Ms', 'taskMsPerStep', 'ownedBytes', 'heapSlopeBytesPerCycle'].includes(k)) : null;
        log(`  block ${b + 1}/${order.length} ${order[b]} ${side}=${cfg[side].ref}${cfg.mode === 'builds' ? `@${cfg[side].slot}` : ''}: ${r.outcome}${primary && typeof primary[1] === 'number' ? ` ${primary[0]}=${primary[1].toFixed(3)}` : ''}${r.reason ? ` (${r.reason})` : ''}${r.error ? ` (${String(r.error).split('\n')[0]})` : ''}`);
      }
    }
    record.environment.loadAverageAtEnd = os.loadavg();
    // The bytes on disk must still be the bytes the manifest names, and every served file must have matched.
    for (const m of Object.values(slots)) readArtifact(m.dir);
    if (server.violations().length) {
      record.analysis = { notCompared: [`served files differed from the artifact manifest: ${server.violations().join('; ')}`] };
      await stop('aborted', 'artifact integrity');
      return record;
    }
    const ep = cfg.endpoint ? endpointById(cfg.endpoint) : null;
    record.analysis = analyze(cfg.workload, record.runs, { noise: cfg.noise ?? null, bootstrapSeed: cfg.bootstrapSeed, ...(ep && ep.swi ? { endpoint: { metric: ep.metric, swi: ep.swi, tol: ep.tol } } : {}) });
    await stop('complete', 'all blocks run');
    log(formatAnalysis(record));
    return record;
  } catch (e) {
    record.error = String(e?.stack ?? e);
    await stop('aborted', 'runner error');
    throw e;
  } finally {
    for (const [sig, h] of handlers) process.off(sig, h);
  }
}

/**
 * Plan 6, pull requests: a result worse than the workload's tolerance triggers one automatic rerun; two in a row
 * flag the change. "Worse than the tolerance" here: the primary metric's outcome is "worse" and the lower end of
 * its interval is above the declared tolerance (so the regression is larger than tolerated, not just non-zero).
 */
export function screeningVerdict(record, tolerance) {
  // A job that could not measure the candidate is its own outcome, never "within tolerance": a candidate that times
  // out in every block must not clear the screen. It is retried like a regression and flagged if it repeats.
  if (record.analysis?.notCompared) return { status: 'failed', exceeds: false, failed: true, why: `not compared: ${record.analysis.notCompared.join('; ')}` };
  const rel = record.analysis?.reliability;
  if (rel?.failed?.B) return { status: 'failed', exceeds: false, failed: true, why: `the candidate failed ${rel.failed.B} of ${rel.timed.B} timed runs` };
  const m = Object.values(record.analysis?.metrics ?? {}).find(x => x.primary);
  if (!m || m.na) return { status: 'failed', exceeds: false, failed: true, why: `primary metric not available${m?.na ? `: ${m.na}` : ''}` };
  const exceeds = m.lo > tolerance && m.outcome !== 'inconclusive';
  return { status: exceeds ? 'exceeds' : m.pairs >= 20 ? 'within' : 'inconclusive', exceeds, failed: false, why: `${m.key}: interval [${m.lo}, ${m.hi}] against tolerance ${tolerance}` };
}

async function main() {
  const die = msg => { console.error(`run.mjs: ${msg}`); process.exit(2); };
  let a;
  try {
    ({ values: a } = parseArgs({
      options: {
        baseline: { type: 'string' }, candidate: { type: 'string' }, aa: { type: 'string' }, adapter: { type: 'string' }, base: { type: 'string' },
        workload: { type: 'string', default: 'first' }, size: { type: 'string' }, fixture: { type: 'string' }, gaps: { type: 'boolean', default: false }, clustered: { type: 'boolean', default: false },
        charts: { type: 'string' }, window: { type: 'string' }, samples: { type: 'string' }, toggles: { type: 'string' }, moves: { type: 'string' }, cycles: { type: 'string' },
        blocks: { type: 'string' }, settle: { type: 'string', default: '500' }, timeout: { type: 'string', default: '120000' },
        seed: { type: 'string' }, 'bootstrap-seed': { type: 'string' }, dpr: { type: 'string', default: '1' }, headed: { type: 'boolean', default: false },
        noise: { type: 'string' }, 'history-dir': { type: 'string' }, artifact: { type: 'string' }, source: { type: 'string' },
        screen: { type: 'boolean', default: false }, tolerance: { type: 'string' }, 'allow-harness-difference': { type: 'boolean', default: false },
        quiet: { type: 'boolean', default: false }, isolate: { type: 'boolean', default: false }, endpoint: { type: 'string' }, gpu: { type: 'boolean', default: false },
      },
    }));
  } catch (e) { die(e.message); }
  // --endpoint pins the recipe of a declared endpoint (src/decision.js): workload and parameters come from the table,
  // and the renderer comparison's adapters are the default sides.
  const ep = a.endpoint ? endpointById(a.endpoint) : null;
  if (a.endpoint && !ep) die(`unknown endpoint ${a.endpoint}`);
  if (ep && (a.size || a.fixture || a.charts || a.window || a.samples || a.moves || a.cycles || a.gaps || a.clustered)) die('--endpoint fixes the workload parameters; do not combine it with --size, --fixture and the like');
  const workload = ep ? ep.workload : a.workload;
  if (!WORKLOADS.includes(workload)) die(`unknown workload ${workload} (${WORKLOADS.join(', ')})`);
  if (a.fixture && a.fixture !== 'trend') die(`unknown fixture ${a.fixture} (trend)`);
  let params;
  try { params = ep ? { ...ep.params } : workloadParams(workload, a); } catch (e) { die(e.message); }
  if ((ep?.family === 'renderer' || ep?.family === 'gpu') && !a.aa && !a.base) { a.baseline ??= RENDERERS.A.adapter; a.candidate ??= RENDERERS.B.adapter; }
  const blocks = a.blocks === undefined ? DEFAULT_BLOCKS : Number(a.blocks);
  let seed, bootstrapSeed;
  try {
    seed = a.seed !== undefined ? parseSeed(a.seed, '--seed') : crypto.randomInt(1, 2 ** 31);
    bootstrapSeed = a['bootstrap-seed'] !== undefined ? parseSeed(a['bootstrap-seed'], '--bootstrap-seed') : DEFAULT_BOOTSTRAP_SEED;
    balancedOrder(blocks, seed);
  } catch (e) { die(e.message); }
  const settleMs = Number(a.settle), timeoutMs = Number(a.timeout), dpr = ep?.dpr ?? Number(a.dpr);
  if (ep?.raster === 'gpu' && !a.gpu) die(`endpoint ${ep.id} belongs to the gpu family: add --gpu`);
  if (!(dpr === 1 || dpr === 2)) die(`--dpr must be 1 or 2, got ${a.dpr}`);
  const historyDir = path.resolve(a['history-dir'] ?? path.join(BENCH, 'history'));

  let mode, A, B, artifacts;
  try {
    if (a.base) {
      if (!a.candidate || !a.adapter) die('two-build mode needs --adapter <ref> --base <artifact dir> --candidate <artifact dir>');
      mode = 'builds';
      parseAdapterRef(a.adapter);
      A = { ref: a.adapter, slot: 'A' }; B = { ref: a.adapter, slot: 'B' };
      artifacts = { A: readArtifact(a.base), B: readArtifact(a.candidate) };
      if (artifacts.A.id === artifacts.B.id) die('--base and --candidate are the same artifact; use --aa for A-versus-A');
      // Only the library may differ: a different page or adapter would confound the comparison.
      const diff = Object.keys({ ...artifacts.A.files, ...artifacts.B.files }).filter(HARNESS).filter(p => artifacts.A.files[p]?.sha256 !== artifacts.B.files[p]?.sha256);
      if (diff.length && !a['allow-harness-difference']) die(`the two artifacts differ in harness files, not only in the library: ${diff.join(', ')} (rebuild both with the same bench/, or pass --allow-harness-difference)`);
    } else {
      const aa = a.aa ?? null;
      const baseline = aa ?? a.baseline, candidate = aa ?? a.candidate;
      if (!baseline || !candidate) die('give --baseline and --candidate, or --aa <adapter>, or --adapter with --base and --candidate');
      parseAdapterRef(baseline); parseAdapterRef(candidate);
      mode = aa ? 'aa' : 'compare';
      A = { ref: baseline, slot: 'A' }; B = { ref: candidate, slot: 'A' };
      artifacts = { A: a.artifact ? readArtifact(a.artifact) : readArtifact((await build({ source: a.source })).dir) };
      if (!a.artifact && !a.quiet) console.log(`built session artifact ${artifacts.A.dir}`);
    }
  } catch (e) { die(e.message); }
  if (a.screen && mode !== 'builds') die('--screen applies to two-build mode (--base/--candidate)');
  let tolerance = null;
  if (a.screen) { tolerance = Number(a.tolerance); if (a.tolerance === undefined || !Number.isFinite(tolerance)) die('--screen needs --tolerance <largest regression tolerated, in the primary metric\'s unit>; the plan has it declared per workload before measuring'); }

  const cfg = { mode, A, B, artifacts, workload, params, blocks, isolate: a.isolate, gpu: a.gpu, endpoint: ep?.id, seed, bootstrapSeed, settleMs, timeoutMs, dpr, headed: a.headed, noiseIds: a.noise ? a.noise.split(',') : null, historyDir, quiet: a.quiet, command: process.argv.slice(2) };
  try {
    const first = await runSession(cfg);
    if (!a.screen) return;
    const v1 = screeningVerdict(first, tolerance);
    console.log(`screening, first job ${first.runId}: ${v1.status} (${v1.why})`);
    if (!v1.exceeds && !v1.failed) return;
    const again = await runSession({ ...cfg, seed: crypto.randomInt(1, 2 ** 31), command: [...cfg.command, '(screening rerun)'] });
    const v2 = screeningVerdict(again, tolerance);
    const flagged = v2.exceeds || v2.failed;
    console.log(`screening, rerun ${again.runId}: ${v2.status} (${v2.why})`);
    console.log(flagged ? `FLAGGED: ${v1.status} then ${v2.status}, two jobs in a row` : 'not flagged: the rerun did not confirm the first job');
    const screenFile = path.join(historyDir, `${again.runId}.screening.json`);
    fs.writeFileSync(screenFile, JSON.stringify({ schema: 'axylo-bench-screening/1', tolerance, jobs: [first.runId, again.runId], verdicts: [v1, v2], flagged }, null, 1));
    if (flagged) process.exitCode = 3;
  } catch (e) {
    console.error(e?.message ?? e);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
