#!/usr/bin/env node
// Prints a history record's stored analysis, or re-analyses it. Never modifies the file.
//
//   node bench/analyze.mjs <run id | path>                               the analysis stored in the record
//   node bench/analyze.mjs <run> --reanalyze                             recompute, with the record's own noise band
//   node bench/analyze.mjs <run> --reanalyze --noise <aa id>[,<aa id>]   recompute against these bands (checked)
//   node bench/analyze.mjs <run> --reanalyze --zero-only                 recompute against zero only, labelled so
//
// A re-analysis of a record that was classified against a noise band resolves that band again from its A-versus-A
// records and checks that they still match (workload, parameters, build bytes, pixel ratio, Chrome, host). If they
// cannot be resolved, it stops: dropping the band silently would turn "inconclusive" into "better".
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { BENCH } from './build.mjs';
import { analyze, parseSeed, DEFAULT_BOOTSTRAP_SEED } from './src/stats.js';
import { formatAnalysis } from './lib/report.mjs';
import { loadNoise, controlsOf } from './lib/refs.mjs';

const die = msg => { console.error(`analyze.mjs: ${msg}`); process.exit(2); };
let values, positionals;
try {
  ({ values, positionals } = parseArgs({ allowPositionals: true, options: {
    noise: { type: 'string' }, reanalyze: { type: 'boolean', default: false }, 'zero-only': { type: 'boolean', default: false },
    'bootstrap-seed': { type: 'string' }, 'history-dir': { type: 'string' }, json: { type: 'boolean', default: false },
  } }));
} catch (e) { die(e.message); }
const historyDir = path.resolve(values['history-dir'] ?? path.join(BENCH, 'history'));
if (!positionals[0]) die('usage: node bench/analyze.mjs <run id | path> [--reanalyze [--noise <ids> | --zero-only] [--bootstrap-seed N]]');
const file = fs.existsSync(positionals[0]) ? positionals[0] : path.join(historyDir, `${positionals[0]}.json`);
if (!fs.existsSync(file)) die(`no history record ${positionals[0]} (looked in ${historyDir})`);
const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
if (rec.status !== 'complete') console.log(`note: this record's status is "${rec.status}"${rec.endedBecause ? ` (${rec.endedBecause})` : ''}`);

if (!values.reanalyze) {
  if (values.noise || values['zero-only'] || values['bootstrap-seed']) die('--noise, --zero-only and --bootstrap-seed change the analysis; add --reanalyze');
  if (!rec.analysis) die('the record holds no stored analysis (interrupted before the end); use --reanalyze to analyse the runs it holds');
  console.log(values.json ? JSON.stringify(rec.analysis, null, 1) : formatAnalysis(rec, { source: 'stored' }));
  process.exit(0);
}

if (values.noise && values['zero-only']) die('give either --noise or --zero-only, not both');
if (!rec.runs?.some(r => r.phase === 'timed')) die('the record has no timed runs to analyse');
let noise = null;
const recorded = rec.design?.noiseFrom ? [].concat(rec.design.noiseFrom).map(n => n.runId) : null;
if (values.noise || (recorded && !values['zero-only'])) {
  const ids = values.noise ? values.noise.split(',') : recorded;
  try { noise = loadNoise(ids, historyDir, controlsOf(rec)); }
  catch (e) {
    die(`${values.noise ? 'the given' : 'the record\'s'} noise band cannot be used:\n${e.message}\n` +
      'Re-analysis stops here rather than classify against zero. Use --zero-only to ask for a zero-only analysis explicitly; it is labelled as such.');
  }
  rec.design.noiseFrom = noise.sources;
  rec.design.noiseCalibration = noise.calibration;
}
let bootstrapSeed = rec.design?.bootstrapSeed ?? DEFAULT_BOOTSTRAP_SEED;
if (values['bootstrap-seed']) { try { bootstrapSeed = parseSeed(values['bootstrap-seed'], '--bootstrap-seed'); } catch (e) { die(e.message); } }
rec.analysis = analyze(rec.design.workload, rec.runs, { noise, bootstrapSeed, zeroOnly: values['zero-only'] });
console.log(values.json ? JSON.stringify(rec.analysis, null, 1) : formatAnalysis(rec, { source: 're-analysis' }));
