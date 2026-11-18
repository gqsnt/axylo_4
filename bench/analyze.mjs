#!/usr/bin/env node
// Re-print, or re-analyse with a noise band, a history record. Does not modify the file.
//   node bench/analyze.mjs <run id | path> [--noise <A-versus-A run id | path>]
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { BENCH } from './build.mjs';
import { analyze } from './src/stats.js';
import { formatAnalysis } from './lib/report.mjs';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { noise: { type: 'string' } } });
const load = ref => JSON.parse(fs.readFileSync(fs.existsSync(ref) ? ref : path.join(BENCH, 'history', `${ref}.json`), 'utf8'));
if (!positionals[0]) { console.error('usage: node bench/analyze.mjs <run id | path> [--noise <run id | path>]'); process.exit(2); }
const rec = load(positionals[0]);
if (rec.status !== 'complete') console.log(`note: this record's status is "${rec.status}"${rec.endedBecause ? ` (${rec.endedBecause})` : ''}; analysing the runs it holds`);
let noise = null;
if (values.noise) {
  const n = load(values.noise);
  if (n.design.mode !== 'aa') { console.error('the --noise record is not an A-versus-A run'); process.exit(2); }
  if (n.design.workload !== rec.design.workload || JSON.stringify(n.design.params) !== JSON.stringify(rec.design.params)) { console.error('the --noise record is for another workload'); process.exit(2); }
  if (n.environment.browser.version !== rec.environment.browser.version) console.log(`warning: noise run used Chrome ${n.environment.browser.version}, this run ${rec.environment.browser.version}`);
  noise = { metrics: Object.fromEntries(Object.entries(n.analysis.metrics).map(([k, m]) => [k, { lo: m.lo, hi: m.hi }])) };
  rec.design.noiseFrom = { runId: n.runId };
}
if (rec.runs.some(r => r.phase === 'timed')) rec.analysis = analyze(rec.design.workload, rec.runs, { noise });
console.log(formatAnalysis(rec));
