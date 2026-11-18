#!/usr/bin/env node
// Records one Chrome CPU profile (CDP Profiler, 100 us sampling) of a create workload, from the create call to the
// end of the settle window, and attributes it to Axylo's pipeline stages (lib/profile-summary.mjs).
// A profiled run is never used as a timing: the profiler slows the page down.
//
//   node bench/profile.mjs --adapter axylo:renderer=svg,build=dev --workload first --size 1x100000 [--out bench/results/profiles]
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { build, BENCH } from './build.mjs';
import { startServer, launchBrowser, runOnce, machineRecord } from './lib/driver.mjs';
import { parseAdapterRef } from './lib/refs.mjs';
import { summarizeProfile } from './lib/profile-summary.mjs';

const { values: a } = parseArgs({ options: {
  adapter: { type: 'string' }, workload: { type: 'string', default: 'first' }, size: { type: 'string', default: '3x120' },
  charts: { type: 'string' }, out: { type: 'string' }, settle: { type: 'string', default: '500' }, 'no-build': { type: 'boolean', default: false },
} });
if (!a.adapter) { console.error('usage: node bench/profile.mjs --adapter <ref> [--workload first|page] [--size 1x100000]'); process.exit(2); }
const ref = parseAdapterRef(a.adapter);
const out = path.resolve(a.out ?? path.join(BENCH, 'results/profiles'));
fs.mkdirSync(out, { recursive: true });
const params = a.workload === 'page' ? { size: a.size, charts: Number(a.charts ?? 24), gaps: false } : { size: a.size, gaps: false };
const name = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${a.workload}-${a.size}-${a.adapter.replace(/[^a-zA-Z0-9.-]+/g, '_')}`;
const file = path.join(out, `${name}.cpuprofile`);

if (!a['no-build']) await build();
const browser = await launchBrowser();
const server = await startServer();
try {
  const r = await runOnce(browser, server.base, { adapter: ref.id, adapterParams: ref.params, workload: a.workload, params, settleMs: Number(a.settle), timeoutMs: 120000, profile: { file } });
  if (r.outcome !== 'ok') { console.error(`run outcome ${r.outcome}: ${r.reason ?? r.error}`); process.exit(1); }
  const profile = JSON.parse(fs.readFileSync(file, 'utf8'));
  const summary = await summarizeProfile(profile, ref.params.build === 'dev' ? 'dev' : 'prod');
  const record = { name, adapter: a.adapter, config: r.result.adapter.config, workload: a.workload, params, profileFile: path.relative(BENCH, file), environment: machineRecord(browser, { headed: false }), page: r.result.env, note: 'profiled run: timings are slowed by the profiler and are not comparable with timed runs', summary };
  fs.writeFileSync(path.join(out, `${name}.summary.json`), JSON.stringify(record, null, 1));
  console.log(`${name}: ${summary.busyMs} ms busy of ${summary.totalMs} ms (${summary.mapping})`);
  for (const s of summary.stages) console.log(`  ${String(s.ofBusy ?? '').padStart(5)}%  ${String(s.ms).padStart(8)} ms  ${s.k}`);
} finally {
  await browser.close();
  await server.close();
}
