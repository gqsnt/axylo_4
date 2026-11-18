#!/usr/bin/env node
// Benchmark runner: a baseline and a candidate adapter, one workload, randomized balanced blocks, a fresh browser
// context per run, raw samples written to bench/history/<run id>.json after every run.
//
//   node bench/run.mjs --baseline uplot --candidate chartjs-tuned --workload first --size 1x100000 --blocks 6
//   node bench/run.mjs --aa uplot --workload first --size 1x100000 --blocks 8        (A-versus-A noise band)
//   node bench/run.mjs ... --noise <run id of an A-versus-A run>                        (use that band)
//
// See bench/README.md for what each metric means.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';
import { build, BENCH } from './build.mjs';
import { startServer, launchBrowser, runOnce, machineRecord, expectedFor } from './lib/driver.mjs';
import { balancedOrder, summarizeRun, analyze } from './src/stats.js';
import { formatAnalysis } from './lib/report.mjs';

const { values: a } = parseArgs({
  options: {
    baseline: { type: 'string' }, candidate: { type: 'string' }, aa: { type: 'string' },
    workload: { type: 'string', default: 'first' }, size: { type: 'string' }, gaps: { type: 'boolean', default: false },
    charts: { type: 'string' }, window: { type: 'string' }, samples: { type: 'string' },
    blocks: { type: 'string', default: '6' }, settle: { type: 'string', default: '500' }, timeout: { type: 'string', default: '120000' },
    seed: { type: 'string' }, dpr: { type: 'string', default: '1' }, headed: { type: 'boolean', default: false },
    noise: { type: 'string' }, 'history-dir': { type: 'string' }, 'no-build': { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false },
  },
});

const die = msg => { console.error(`run.mjs: ${msg}`); process.exit(2); };
const aa = a.aa ?? null;
const baseline = aa ?? a.baseline, candidate = aa ?? a.candidate;
if (!baseline || !candidate) die('give --baseline and --candidate, or --aa <adapter>');
const workload = a.workload;
if (!['first', 'page', 'stream'].includes(workload)) die(`unknown workload ${workload} (first, page, stream)`);
const params = workload === 'first' ? { size: a.size ?? '3x120', gaps: a.gaps }
  : workload === 'page' ? { size: a.size ?? '3x120', charts: Number(a.charts ?? 24), gaps: a.gaps }
  : { window: Number(a.window ?? 600), samples: Number(a.samples ?? 300) };
const blocks = Number(a.blocks);
const seed = a.seed !== undefined ? Number(a.seed) : crypto.randomInt(1, 2 ** 31);
let order;
try { order = balancedOrder(blocks, seed); } catch (e) { die(e.message); }
const settleMs = Number(a.settle), timeoutMs = Number(a.timeout), dpr = Number(a.dpr);
const historyDir = path.resolve(a['history-dir'] ?? path.join(BENCH, 'history'));
fs.mkdirSync(historyDir, { recursive: true });

let noise = null;
if (a.noise) {
  const p = fs.existsSync(a.noise) ? a.noise : path.join(historyDir, `${a.noise}.json`);
  if (!fs.existsSync(p)) die(`noise run ${a.noise} not found`);
  const n = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (n.design?.mode !== 'aa' || n.status !== 'complete') die(`noise run ${a.noise} is not a complete A-versus-A run`);
  if (n.design.workload !== workload || JSON.stringify(n.design.params) !== JSON.stringify(params)) die(`noise run ${a.noise} is for ${n.design.workload} ${JSON.stringify(n.design.params)}, not this workload`);
  noise = { runId: n.runId, adapter: n.design.baseline, chrome: n.environment.browser.version, metrics: Object.fromEntries(Object.entries(n.analysis.metrics).map(([k, m]) => [k, { lo: m.lo, hi: m.hi }])) };
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const tag = workload === 'stream' ? `w${params.window}` : `${params.size}${params.gaps ? '-gaps' : ''}${workload === 'page' ? `-x${params.charts}` : ''}`;
const runId = `${stamp}-${workload}-${tag}-${aa ? `aa-${aa}` : `${baseline}-vs-${candidate}`}-${crypto.randomBytes(2).toString('hex')}`;
const file = path.join(historyDir, `${runId}.json`);

const record = {
  schema: 'axylo-bench/1',
  runId,
  // Stays "interrupted" until the last run is analysed; a run cut short by a restart is never merged with another.
  status: 'interrupted',
  startedAt: new Date().toISOString(),
  command: process.argv.slice(2),
  design: {
    mode: aa ? 'aa' : 'compare', baseline, candidate, labels: { A: baseline, B: candidate },
    workload, params, blocks, order, seed, settleMs, timeoutMs, dpr, viewport: [1440, 900],
    noiseFrom: noise ? { runId: noise.runId, adapter: noise.adapter, chrome: noise.chrome } : null,
  },
  environment: null,
  hashes: null,
  admission: {},
  runs: [],
  analysis: null,
};
const save = () => {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 1));
  fs.renameSync(tmp, file);
};
const log = (...m) => { if (!a.quiet) console.log(...m); };

let browser, server;
const stop = async (status, why) => {
  record.status = status;
  record.endedBecause = why;
  record.finishedAt = new Date().toISOString();
  save();
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
};
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, async () => { await stop('interrupted', `signal ${sig}`); console.error(`\ninterrupted; partial record kept in ${file}`); process.exit(130); });

try {
  const manifest = a['no-build'] ? JSON.parse(fs.readFileSync(path.join(BENCH, 'dist/manifest.json'), 'utf8')) : await build();
  for (const id of new Set([baseline, candidate])) if (!manifest.adapters[id]) die(`no adapter "${id}" (have: ${Object.keys(manifest.adapters).join(', ')})`);
  const expected = expectedFor(workload, params);
  record.hashes = { fixtureChecksum: expected.checksum, page: manifest.page, adapters: Object.fromEntries([...new Set([baseline, candidate])].map(id => [id, manifest.adapters[id]])) };
  record.environment = { ...machineRecord(await (browser = await launchBrowser({ headed: a.headed })), { headed: a.headed }), libraries: manifest.versions };
  server = await startServer();
  save();
  log(`run ${runId}\n  ${aa ? `A-versus-A: ${aa}` : `A=${baseline}  B=${candidate}`}  ${workload} ${JSON.stringify(params)}  ${blocks} blocks  order ${order.join(' ')}  seed ${seed}`);
  log(`  Chrome ${browser.version()} ${a.headed ? 'headed' : 'headless'}, history -> ${path.relative(process.cwd(), file)}`);

  const spec = adapter => ({ adapter, workload, params, settleMs, timeoutMs, dpr });

  // Admission: one untimed run per adapter. An adapter that does not show the fixture is not timed at all.
  for (const id of new Set([baseline, candidate])) {
    const r = await runOnce(browser, server.base, spec(id));
    const adm = { outcome: r.outcome, reason: r.reason ?? r.error ?? null, admission: r.admission ?? null, describe: r.result?.describe ?? null, adapter: r.result?.adapter ?? null };
    record.admission[id] = adm;
    if (r.result?.env && !record.environment.page) record.environment.page = r.result.env;
    record.runs.push({ index: record.runs.length, phase: 'admission', adapter: id, outcome: r.outcome, reason: adm.reason, durationMs: r.durationMs, logs: r.logs, pageErrors: r.pageErrors });
    save();
    log(`  admission ${id}: ${r.outcome}${adm.reason ? ` (${adm.reason})` : ''}`);
  }
  const blocked = Object.entries(record.admission).filter(([, v]) => v.outcome !== 'ok');
  if (blocked.length) {
    record.analysis = { notCompared: blocked.map(([id, v]) => `${id}: ${v.outcome}${v.reason ? ` (${v.reason})` : ''}`) };
    await stop('complete', 'admission failed or adapter not available; nothing was timed');
    log(`  not timed: ${record.analysis.notCompared.join('; ')}`);
    process.exit(0);
  }

  for (let b = 0; b < order.length; b++) {
    for (let pos = 0; pos < 2; pos++) {
      const config = order[b][pos];
      const id = config === 'A' ? baseline : candidate;
      const r = await runOnce(browser, server.base, spec(id));
      const run = { index: record.runs.length, phase: 'timed', block: b, position: pos, config, adapter: id, startedAt: new Date(Date.now() - r.durationMs).toISOString(), ...r };
      if (r.outcome === 'ok') run.summary = summarizeRun(workload, r);
      record.runs.push(run);
      save();
      const primary = run.summary ? Object.entries(run.summary).find(([k]) => k === 'taskMs' || k === 'taskMsPerUpdate') : null;
      log(`  block ${b + 1}/${order.length} ${order[b]} ${config}=${id}: ${r.outcome}${primary ? ` ${primary[0]}=${primary[1].toFixed(3)}` : ''}${r.reason ? ` (${r.reason})` : ''}${r.error ? ` (${String(r.error).split('\n')[0]})` : ''}`);
    }
  }
  record.environment.loadAverageAtEnd = os.loadavg();
  record.analysis = analyze(workload, record.runs, { noise });
  await stop('complete', 'all blocks run');
  log(formatAnalysis(record));
} catch (e) {
  record.error = String(e?.stack ?? e);
  await stop('aborted', 'runner error');
  console.error(e);
  process.exit(1);
}
