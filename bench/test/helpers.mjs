// Synthetic history records for the pure tests (not a test file itself).
import fs from 'node:fs';
import path from 'node:path';
import { BENCH } from '../build.mjs';
import { analyze } from '../src/stats.js';

export const HOST = { hostname: 'bench-host', cpuModel: 'Test CPU', logicalCores: 8 };
export const FILES = { 'index.html': 'h1', 'page.js': 'p1', 'adapters/uplot.js': 'u1', 'adapters/axylo-svg.js': 's1', 'axylo/axylo.iife.min.js': 'm1' };

export function scratchDir(name) {
  const root = path.join(BENCH, '.scratch');
  fs.mkdirSync(root, { recursive: true });
  return fs.mkdtempSync(path.join(root, `${name}-`));
}

/** Timed runs of `blocks` balanced blocks with the given per-config values (functions of the block index). */
export function timedRuns(blocks, a, b, key = 'taskMs') {
  const runs = [];
  for (let k = 0; k < blocks; k++) {
    const ab = k % 2 === 0;
    runs.push({ phase: 'timed', block: k, position: ab ? 0 : 1, config: 'A', outcome: 'ok', summary: { [key]: a(k) } });
    runs.push({ phase: 'timed', block: k, position: ab ? 1 : 0, config: 'B', outcome: 'ok', summary: { [key]: b(k) } });
  }
  return runs;
}

export function record({ runId, mode = 'compare', workload = 'first', params = { size: '3x120', gaps: false }, dpr = 1, settleMs = 500, chrome = '157.0', headless = true, host = HOST, files = FILES, served = { 'index.html': 'h1', 'page.js': 'p1', 'adapters/uplot.js': 'u1' }, runs = [], noise = null, noiseFrom = null, baseline = 'uplot', candidate = 'axylo-svg' }) {
  const slot = { artifact: 'art', files, served };
  const rec = {
    schema: 'axylo-bench/2', runId, status: 'complete',
    design: { mode, baseline, candidate, workload, params, blocks: runs.length / 2, seed: 1, bootstrapSeed: 12345, settleMs, dpr, noiseFrom },
    environment: { browser: { version: chrome, headless }, host },
    hashes: { slots: { A: slot, B: slot } },
    runs,
    blocks: Array.from({ length: runs.length / 2 }, (_, block) => ({ block, load1: 0.4 })),
  };
  rec.analysis = analyze(workload, runs, { noise });
  return rec;
}

export function write(dir, rec) { fs.writeFileSync(path.join(dir, `${rec.runId}.json`), JSON.stringify(rec)); return rec; }
