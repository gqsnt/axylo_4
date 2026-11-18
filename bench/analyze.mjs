#!/usr/bin/env node
// Re-print, or re-analyse with a noise band, a history record. Does not modify the file.
//   node bench/analyze.mjs <run id | path> [--noise <A-versus-A run id | path>]
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { BENCH } from './build.mjs';
import { analyze } from './src/stats.js';
import { formatAnalysis } from './lib/report.mjs';
import { loadNoise } from './lib/refs.mjs';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { noise: { type: 'string' } } });
const load = ref => JSON.parse(fs.readFileSync(fs.existsSync(ref) ? ref : path.join(BENCH, 'history', `${ref}.json`), 'utf8'));
if (!positionals[0]) { console.error('usage: node bench/analyze.mjs <run id | path> [--noise <run id | path>]'); process.exit(2); }
const rec = load(positionals[0]);
if (rec.status !== 'complete') console.log(`note: this record's status is "${rec.status}"${rec.endedBecause ? ` (${rec.endedBecause})` : ''}; analysing the runs it holds`);
let noise = null;
if (values.noise) {
  noise = loadNoise(values.noise.split(','), path.join(BENCH, 'history'), rec.design.workload, rec.design.params);
  for (const src of noise.sources) if (src.chrome !== rec.environment.browser.version) console.log(`warning: noise run ${src.runId} used Chrome ${src.chrome}, this run ${rec.environment.browser.version}`);
  rec.design.noiseFrom = noise.sources;
}
if (rec.runs.some(r => r.phase === 'timed')) rec.analysis = analyze(rec.design.workload, rec.runs, { noise });
console.log(formatAnalysis(rec));
