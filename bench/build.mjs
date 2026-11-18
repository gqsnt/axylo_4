// Builds bench/dist: the page, and one ESM bundle per adapter (src/adapters and the deliberately broken test/adapters).
// Usage: node bench/build.mjs
import { build as esbuild } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const BENCH = path.dirname(fileURLToPath(import.meta.url));
export const DIST = path.join(BENCH, 'dist');
export const REPO = path.resolve(BENCH, '..');

export const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));

export function libraryVersions() {
  const v = {};
  for (const name of ['uplot', 'chart.js', 'chartjs-adapter-date-fns', 'date-fns']) {
    try { v[name] = readJson(path.join(BENCH, 'node_modules', name, 'package.json')).version; } catch { v[name] = 'not available: not installed'; }
  }
  try { v.axylo = readJson(path.join(REPO, 'packages/axylo/package.json')).version; } catch { v.axylo = 'not available'; }
  return v;
}

function adapterSources() {
  const list = [];
  for (const [dir, test] of [['src/adapters', false], ['test/adapters', true]]) {
    for (const f of fs.readdirSync(path.join(BENCH, dir))) {
      if (!f.endsWith('.js') || f.endsWith('-common.js')) continue;
      list.push({ id: f.slice(0, -3), file: path.join(BENCH, dir, f), test });
    }
  }
  return list;
}

export async function build() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(path.join(DIST, 'adapters'), { recursive: true });
  const versions = libraryVersions();
  const common = {
    bundle: true, format: 'esm', target: 'es2022', minify: true, legalComments: 'none', logLevel: 'warning',
    loader: { '.css': 'text' },
    // Production builds of every library (Chart.js and uPlot have no separate dev mode; this pins NODE_ENV anyway).
    define: { __VERSIONS__: JSON.stringify(versions), 'process.env.NODE_ENV': '"production"' },
  };
  const adapters = adapterSources();
  await Promise.all([
    esbuild({ ...common, entryPoints: [path.join(BENCH, 'src/page.js')], outfile: path.join(DIST, 'page.js') }),
    ...adapters.map(a => esbuild({ ...common, entryPoints: [a.file], outfile: path.join(DIST, 'adapters', `${a.id}.js`) })),
  ]);
  fs.copyFileSync(path.join(BENCH, 'src/page.html'), path.join(DIST, 'index.html'));
  const hash = p => sha256(fs.readFileSync(p));
  // Snapshot of the Axylo build. Other work rebuilds packages/axylo/dist while sessions run; every run of a session
  // (run.mjs --no-build after one build) loads this copy, so all of them measure the same bytes.
  const axylo = {};
  fs.mkdirSync(path.join(DIST, 'axylo'), { recursive: true });
  for (const f of ['axylo.iife.min.js', 'axylo.iife.js', 'axylo.css']) {
    const from = path.join(REPO, 'packages/axylo/dist', f);
    if (!fs.existsSync(from)) { axylo[f] = 'not available: not built'; continue; }
    fs.copyFileSync(from, path.join(DIST, 'axylo', f));
    axylo[f] = { sha256: hash(from), builtAt: fs.statSync(from).mtime.toISOString() };
  }
  const manifest = {
    versions,
    page: { 'page.js': hash(path.join(DIST, 'page.js')), 'index.html': hash(path.join(DIST, 'index.html')) },
    axylo,
    adapters: Object.fromEntries(adapters.map(a => [a.id, { sha256: hash(path.join(DIST, 'adapters', `${a.id}.js`)), test: a.test }])),
  };
  fs.writeFileSync(path.join(DIST, 'manifest.json'), JSON.stringify(manifest, null, 1));
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const m = await build();
  console.log(`built bench/dist: page + ${Object.keys(m.adapters).length} adapters (${Object.keys(m.adapters).join(', ')})`);
}
