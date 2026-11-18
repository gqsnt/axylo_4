// Attributes a Chrome CPU profile (CDP Profiler) of an Axylo run to the library's pipeline stages, two ways:
//
//   self       each sample goes to its leaf frame: the Axylo module of that function when the leaf is Axylo code,
//              otherwise its category ((program): native main-thread work outside JavaScript such as style, layout
//              and paint; (garbage collector); (idle); other JavaScript). A browser API called from Axylo that V8
//              does not show as a frame of its own counts as self time of the calling Axylo function.
//   inclusive  each sample counts once for every stage that has a frame anywhere on its stack, so a stage's
//              inclusive share includes the work it called; shares do not add up to 100%.
//
// Positions are mapped to source modules through the source map bench/build.mjs wrote next to each bundle in the
// sealed artifact the profiled run loaded, for the production and the development build alike; no rebuild is
// involved, so the map describes the measured bytes (the build checks that the map does not change them).
// What this cannot do: recover frames V8 inlined away (their time shows in the caller), attribute garbage
// collection to the code that allocated, or see work on other threads (raster, GPU).
import fs from 'node:fs';
import path from 'node:path';

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
export const stageOf = mod => STAGE_OF[mod.split('/')[0]] ?? `other: ${mod}`;

const B64 = Object.fromEntries([...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'].map((c, i) => [c, i]));
export function decodeVlq(str) {
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

/** A source map (v3) -> (line, column) => module path under packages/axylo/src, or null. */
export function positionMap(map) {
  const sources = map.sources.map(s => { const i = s.indexOf('packages/axylo/src/'); return i >= 0 ? s.slice(i + 'packages/axylo/src/'.length) : s; });
  const lines = [];
  let src = 0;
  map.mappings.split(';').forEach(segs => {
    const row = [];
    let col = 0;
    for (const seg of segs.split(',')) {
      if (!seg) continue;
      const v = decodeVlq(seg);
      col += v[0];
      // A one-field segment starts an explicitly unmapped stretch: kept, so columns after it are not given to the
      // source before it.
      if (v.length >= 4) { src += v[1]; row.push([col, src]); } else row.push([col, -1]);
    }
    lines.push(row);
  });
  return (line, column) => {
    const segs = lines[line];
    if (!segs?.length) return null;
    let lo = 0, hi = segs.length - 1, best = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (segs[mid][0] <= column) { best = mid; lo = mid + 1; } else hi = mid - 1; }
    return best < 0 || segs[best][1] < 0 ? null : sources[segs[best][1]];
  };
}

const isAxylo = cf => /\/axylo\/axylo(\.bench)?\.iife(\.min)?\.js/.test(cf.url);

/**
 * @param profile  a CDP Profiler profile
 * @param opts     { map: source map object of the bundle the run loaded, build: 'prod' | 'dev' }
 */
export function summarizeProfile(profile, { map, build }) {
  const locate = map ? positionMap(map) : null;
  const nodes = new Map(profile.nodes.map(n => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const modOf = cf => (locate ? locate(cf.lineNumber, cf.columnNumber) : null);
  const self = {}, selfModule = {}, selfFunction = {}, inclusive = {};
  let total = 0, samples = 0;
  const add = (o, k, t) => { o[k] = (o[k] ?? 0) + t; };
  profile.samples.forEach((id, i) => {
    const t = (profile.timeDeltas[i] ?? 0) / 1000; // ms
    total += t; samples++;
    const leaf = nodes.get(id).callFrame;
    if (isAxylo(leaf)) {
      const mod = modOf(leaf);
      add(self, mod ? stageOf(mod) : 'axylo (unmapped)', t);
      add(selfModule, mod ?? '(unmapped)', t);
      add(selfFunction, `${leaf.functionName || '(anonymous)'} @ ${mod ?? '?'}:${leaf.lineNumber + 1}`, t);
    } else if (leaf.functionName === '(idle)') add(self, '(idle)', t);
    else if (leaf.functionName === '(program)') add(self, '(program): native main-thread work outside JS', t);
    else if (leaf.functionName === '(garbage collector)') add(self, '(garbage collector)', t);
    else add(self, 'other JavaScript (harness, page, comparison library)', t);
    const seen = new Set();
    for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
      const cf = nodes.get(cur).callFrame;
      if (!isAxylo(cf)) continue;
      const mod = modOf(cf);
      seen.add(mod ? stageOf(mod) : 'axylo (unmapped)');
    }
    if (seen.size) seen.add('Axylo (any frame)');
    for (const s of seen) add(inclusive, s, t);
  });
  const busy = total - (self['(idle)'] ?? 0);
  const table = o => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, ms]) => ({ k, ms: +ms.toFixed(2), ofBusy: busy && k !== '(idle)' ? +(100 * ms / busy).toFixed(1) : null }));
  return {
    build, mapping: locate ? 'source map from the sealed artifact (describes the measured bytes)' : 'not available: no source map in the artifact',
    samples, totalMs: +total.toFixed(2), busyMs: +busy.toFixed(2),
    self: table(self), inclusive: table(inclusive), selfModules: table(selfModule).slice(0, 25), selfFunctions: table(selfFunction).slice(0, 25),
  };
}

/** The source map of the bundle a run loaded, from its artifact directory; null when absent. */
export function artifactMap(artifactDir, build) {
  const p = path.join(artifactDir, 'axylo', build === 'dev' ? 'axylo.iife.js.map' : build === 'release' ? 'axylo.iife.min.js.map' : 'axylo.bench.iife.min.js.map');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}
