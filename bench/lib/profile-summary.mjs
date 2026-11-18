// Attributes a Chrome CPU profile (CDP Profiler) of an Axylo run to the library's pipeline stages.
//
// Each sample is given to the deepest stack frame that is Axylo code (so time in a browser API called by Axylo,
// such as a canvas call or a forced layout, counts for the Axylo function that called it). That frame's source
// module decides the stage. Samples with no Axylo frame are "(program)" (native main-thread work outside
// JavaScript: style, layout, paint, compositing setup), "(garbage collector)", "(idle)", or other JavaScript (the
// harness page and anything else).
//
// Positions are mapped to source modules in two ways:
//   development build (axylo.iife.js): esbuild writes "// packages/axylo/src/<module>.ts" before each module, so a
//     line number gives the module;
//   production build (axylo.iife.min.js): the bench rebuilds the same file with the same esbuild options plus a
//     source map, checks that the code is byte-identical to the shipped file, and maps line and column through it.
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { REPO } from '../build.mjs';

const AXYLO_SRC = path.join(REPO, 'packages/axylo/src');

/** Directory (or file) under packages/axylo/src -> the pipeline stage named in the M1 brief. */
export const STAGE_OF = {
  data: 'normalize',
  view: 'view', scale: 'view',
  layout: 'layout', format: 'layout',
  scene: 'scene', simplify: 'scene',
  lookup: 'lookup',
  reader: 'reader',
  render: 'draw',
  dom: 'DOM',
  theme: 'theme (not one of the eight)',
  core: 'orchestration: core/ (chart.ts, options, delivery)',
  diagnostics: 'orchestration: diagnostics/',
  messages: 'orchestration: messages/',
  'index.ts': 'orchestration: index.ts',
};
const stageOf = mod => STAGE_OF[mod.split('/')[0]] ?? `other: ${mod}`;

/** Line (0-based) -> module path, from the development build's module comments. */
function devLineMap(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const starts = [];
  lines.forEach((l, i) => { const m = /^\s*\/\/ packages\/axylo\/src\/(.+\.ts)$/.exec(l); if (m) starts.push([i, m[1]]); });
  return line => { let mod = null; for (const [i, m] of starts) { if (i <= line) mod = m; else break; } return mod; };
}

const B64 = Object.fromEntries([...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'].map((c, i) => [c, i]));
function decodeVlq(str) {
  const out = [];
  let shift = 0, value = 0;
  for (const ch of str) {
    const d = B64[ch];
    value += (d & 31) << shift;
    if (d & 32) shift += 5;
    else { out.push(value & 1 ? -(value >>> 1) : value >>> 1); value = 0; shift = 0; }
  }
  return out;
}

/** (line, column) -> module path, from a source map; null when the rebuilt file differs from the shipped one. */
async function prodPositionMap(file) {
  const res = await build({
    entryPoints: [path.join(AXYLO_SRC, 'index.ts')], bundle: true, target: 'es2022', legalComments: 'none', logLevel: 'silent',
    format: 'iife', globalName: 'Axylo', minify: true, define: { __DEV__: 'false' }, sourcemap: 'external', write: false,
    outfile: path.join(REPO, 'bench/dist/axylo-map/axylo.iife.min.js'), absWorkingDir: REPO,
  });
  const js = res.outputFiles.find(f => f.path.endsWith('.js')).text;
  const map = JSON.parse(res.outputFiles.find(f => f.path.endsWith('.map')).text);
  if (js !== fs.readFileSync(file, 'utf8')) return { map: null, note: 'not available: rebuilding packages/axylo/src now does not reproduce the measured production bundle byte for byte (the sources changed after it was built), so its minified positions cannot be mapped; see the development-build profile' };
  const sources = map.sources.map(s => { const i = s.indexOf('packages/axylo/src/'); return i >= 0 ? s.slice(i + 'packages/axylo/src/'.length) : s; });
  const lines = map.mappings.split(';').map(() => []);
  let src = 0;
  map.mappings.split(';').forEach((segs, line) => {
    let col = 0;
    for (const seg of segs.split(',')) {
      if (!seg) continue;
      const v = decodeVlq(seg);
      col += v[0];
      if (v.length >= 4) { src += v[1]; lines[line].push([col, src]); }
    }
  });
  return {
    map: (line, column) => {
      const segs = lines[line];
      if (!segs?.length) return null;
      let lo = 0, hi = segs.length - 1, best = -1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (segs[mid][0] <= column) { best = mid; lo = mid + 1; } else hi = mid - 1; }
      return best < 0 ? null : sources[segs[best][1]];
    },
    note: 'production bundle rebuilt with a source map and verified byte-identical to the shipped file',
  };
}

export async function summarizeProfile(profile, build) {
  // The snapshot the profiled run loaded (bench/dist/axylo), not whatever packages/axylo/dist holds now.
  const file = path.join(REPO, 'bench/dist/axylo', build === 'dev' ? 'axylo.iife.js' : 'axylo.iife.min.js');
  let locate, note;
  if (build === 'dev') { const f = devLineMap(file); locate = (line) => f(line); note = 'development build, module comments'; }
  else { const p = await prodPositionMap(file); note = p.note; locate = p.map; }
  const nodes = new Map(profile.nodes.map(n => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const isAxylo = cf => /\/axylo\/axylo\.iife(\.min)?\.js/.test(cf.url);
  const byStage = {}, byModule = {}, byFunction = {};
  let total = 0, inWindow = 0;
  const add = (o, k, t) => { o[k] = (o[k] ?? 0) + t; };
  profile.samples.forEach((id, i) => {
    const t = (profile.timeDeltas[i] ?? 0) / 1000; // ms
    total += t;
    let n = nodes.get(id), hit = null;
    const leaf = n.callFrame.functionName;
    for (let cur = id; cur !== undefined; cur = parent.get(cur)) { const node = nodes.get(cur); if (isAxylo(node.callFrame)) { hit = node; break; } }
    if (hit) {
      const mod = locate ? locate(hit.callFrame.lineNumber, hit.callFrame.columnNumber) : null;
      add(byStage, mod ? stageOf(mod) : 'axylo (unmapped)', t);
      add(byModule, mod ?? '(unmapped)', t);
      add(byFunction, `${hit.callFrame.functionName || '(anonymous)'} @ ${mod ?? '?'}:${hit.callFrame.lineNumber + 1}`, t);
    } else if (leaf === '(idle)') add(byStage, '(idle)', t);
    else if (leaf === '(program)') add(byStage, '(program): native main-thread work outside JS', t);
    else if (leaf === '(garbage collector)') add(byStage, '(garbage collector)', t);
    else add(byStage, 'other JavaScript (harness, page)', t);
    inWindow++;
  });
  const busy = total - (byStage['(idle)'] ?? 0);
  const table = o => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, ms]) => ({ k, ms: +ms.toFixed(2), ofBusy: busy && k !== '(idle)' ? +(100 * ms / busy).toFixed(1) : null }));
  return {
    build, mapping: note, samples: inWindow, totalMs: +total.toFixed(2), busyMs: +busy.toFixed(2),
    stages: table(byStage), modules: table(byModule).slice(0, 25), functions: table(byFunction).slice(0, 25),
  };
}
