#!/usr/bin/env node
// Records Chrome CPU profiles (CDP Profiler, 100 us sampling) of one create run and attributes them to Axylo's
// pipeline stages (lib/profile-summary.mjs), self and inclusive. The run is split at the first frame after the
// chart reports ready: "active" is the create call up to that frame, "settle" the fixed settle period after it,
// summarized separately. A profiled run is never used as a timing: the profiler slows the page down.
//
//   node bench/profile.mjs --adapter axylo-svg --size 1x100000 [--artifact <dir>] [--out bench/results/profiles]
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { build, readArtifact, BENCH } from './build.mjs';
import { startServer, launchBrowser, runOnce, machineRecord } from './lib/driver.mjs';
import { parseAdapterRef } from './lib/refs.mjs';
import { summarizeProfile, artifactMap } from './lib/profile-summary.mjs';
import { workloadParams } from './run.mjs';

const { values: a } = parseArgs({ options: {
  adapter: { type: 'string' }, workload: { type: 'string', default: 'first' }, size: { type: 'string' }, fixture: { type: 'string' },
  charts: { type: 'string' }, out: { type: 'string' }, settle: { type: 'string', default: '500' }, artifact: { type: 'string' },
} });
if (!a.adapter) { console.error('usage: node bench/profile.mjs --adapter <ref> [--workload first|page] [--size 1x100000 | --fixture trend] [--artifact <dir>]'); process.exit(2); }
if (!['first', 'page', 'compact', 'scatter'].includes(a.workload)) { console.error('profile.mjs profiles create workloads only'); process.exit(2); }
const ref = parseAdapterRef(a.adapter);
const out = path.resolve(a.out ?? path.join(BENCH, 'results/profiles'));
fs.mkdirSync(out, { recursive: true });
const params = workloadParams(a.workload, a);
const artifact = readArtifact(a.artifact ?? (await build()).dir);
const name = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${a.workload}-${params.fixture ?? params.size}-${a.adapter.replace(/[^a-zA-Z0-9.-]+/g, '_')}`;
const file = path.join(out, `${name}.cpuprofile`);

const browser = await launchBrowser();
const server = await startServer({ A: artifact });
try {
  const r = await runOnce(browser, server, { adapter: ref.id, adapterParams: ref.params, workload: a.workload, params, settleMs: Number(a.settle), timeoutMs: 120000, profile: { file } });
  if (r.outcome !== 'ok') { console.error(`run outcome ${r.outcome}: ${r.reason ?? r.error}`); process.exitCode = 1; }
  else {
    const buildKind = r.result.adapter.params?.build ?? 'prod';
    const map = artifactMap(artifact.dir, buildKind);
    const active = summarizeProfile(JSON.parse(fs.readFileSync(file, 'utf8')), { map, build: buildKind });
    const settleFile = file.replace(/\.cpuprofile$/, '.settle.cpuprofile');
    const settle = fs.existsSync(settleFile) ? summarizeProfile(JSON.parse(fs.readFileSync(settleFile, 'utf8')), { map, build: buildKind }) : null;
    const served = server.served().A;
    const bundle = `axylo/${r.result.adapter.bundle?.replace(/^axylo\//, '') ?? (buildKind === 'dev' ? 'axylo.iife.js' : 'axylo.bench.iife.min.js')}`;
    const record = {
      name, adapter: a.adapter, config: r.result.adapter.config, workload: a.workload, params,
      artifact: { id: artifact.id, dir: artifact.dir, source: artifact.source.head, axyloSourceHash: artifact.source.axyloSourceHash, bundle, bundleSha256: served[bundle] ?? 'not served', mapSha256: artifact.files[`${bundle}.map`]?.sha256 ?? 'not available' },
      profileFiles: { active: path.relative(BENCH, file), settle: settle ? path.relative(BENCH, settleFile) : null },
      environment: machineRecord(browser, { headed: false }), page: r.result.env,
      note: 'profiled run: timings are slowed by the profiler and are not comparable with timed runs. "active" = create call to the first frame after ready; "settle" = the settle period after it.',
      active, settle,
    };
    fs.writeFileSync(path.join(out, `${name}.summary.json`), JSON.stringify(record, null, 1));
    for (const [label, s] of [['active', active], ['settle', settle]]) {
      if (!s) continue;
      console.log(`${name} ${label}: ${s.busyMs} ms busy of ${s.totalMs} ms (${s.mapping})`);
      console.log('  self:'); for (const x of s.self.slice(0, 10)) console.log(`    ${String(x.ofBusy ?? '').padStart(5)}%  ${String(x.ms).padStart(8)} ms  ${x.k}`);
      console.log('  inclusive:'); for (const x of s.inclusive.slice(0, 10)) console.log(`    ${String(x.ofBusy ?? '').padStart(5)}%  ${String(x.ms).padStart(8)} ms  ${x.k}`);
    }
  }
} finally {
  await browser.close();
  await server.close();
}
