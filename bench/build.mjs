// Builds one sealed benchmark artifact: the page, one ESM bundle per adapter (src/adapters and the deliberately broken
// test/adapters), and the Axylo script-tag builds compiled from source with source maps.
//
//   node bench/build.mjs [--source <checkout root>] [--out <dir>]
//
// The artifact is a directory of its own (default bench/artifacts/<id>/), never shared with another session, so a
// concurrent build cannot replace the bytes a session serves. Its manifest.json records:
//   - the sha256 and size of every file in the directory (the server checks each file against it as it serves);
//   - the Axylo sources that were compiled: each file's sha256 as esbuild read it (the build reads every source once
//     into memory and compiles from that snapshot, so the production and development builds see the same bytes),
//     the git HEAD of the source checkout and its uncommitted changes, both read at build time;
//   - whether the production bundle is byte-identical to what scripts/build.mjs produces (same esbuild options; the
//     external source map does not change the JavaScript) and to the checkout's packages/axylo/dist, if present.
// After writing, every file and directory is made read-only. Delete an artifact with `chmod -R u+w <dir> && rm -r <dir>`.
import { build as esbuild, version as esbuildVersion } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

export const BENCH = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(BENCH, '..');
export const ARTIFACTS = path.join(BENCH, 'artifacts');

export const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));

export function libraryVersions(source = REPO) {
  const v = {};
  for (const name of ['uplot', 'chart.js', 'chartjs-adapter-date-fns', 'date-fns', 'echarts']) {
    try { v[name] = readJson(path.join(BENCH, 'node_modules', name, 'package.json')).version; } catch { v[name] = 'not available: not installed'; }
  }
  try { v.axylo = readJson(path.join(source, 'packages/axylo/package.json')).version; } catch { v.axylo = 'not available'; }
  return v;
}

function git(cwd, args) {
  try { return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; }
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

function listFiles(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, base)); else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out.sort();
}

/** Reads every file under `dir` once; esbuild then compiles from this snapshot, not from the live tree. */
function snapshotSources(dir) {
  const files = new Map();
  for (const rel of listFiles(dir)) {
    const abs = path.join(dir, rel);
    const bytes = fs.readFileSync(abs);
    files.set(abs, { bytes, sha256: sha256(bytes), rel });
  }
  return files;
}

function snapshotPlugin(snapshot, srcDir, used) {
  return {
    name: 'bench-source-snapshot',
    setup(b) {
      b.onLoad({ filter: /.*/ }, args => {
        if (!args.path.startsWith(srcDir + path.sep)) return undefined;
        const f = snapshot.get(args.path);
        if (!f) throw new Error(`source ${args.path} appeared after the snapshot was taken`);
        used.set(f.rel, f.sha256);
        return { contents: f.bytes, loader: path.extname(args.path).slice(1) === 'ts' ? 'ts' : 'js' };
      });
    },
  };
}

/** Builds the artifact. Returns its manifest. */
export async function build({ source = REPO, out = null } = {}) {
  source = path.resolve(source);
  const srcDir = path.join(source, 'packages/axylo/src');
  const head = git(source, ['rev-parse', 'HEAD']);
  const id = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${(head ?? 'nogit').slice(0, 8)}-${crypto.randomBytes(3).toString('hex')}`;
  const dir = path.resolve(out ?? path.join(ARTIFACTS, id));
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Error(`artifact directory ${dir} exists and is not empty; artifacts are never rebuilt in place`);
  fs.mkdirSync(path.join(dir, 'adapters'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'axylo'), { recursive: true });

  // Provenance first, so it describes the snapshot the build compiles, not the tree after it.
  const status = git(source, ['status', '--short', '--', 'packages/axylo']);
  const snapshot = fs.existsSync(srcDir) ? snapshotSources(srcDir) : new Map();
  const versions = libraryVersions(source);
  const hasCanvasMarks = snapshot.has(path.join(srcDir, 'render/canvas.ts'));
  const common = {
    bundle: true, format: 'esm', target: 'es2022', minify: true, legalComments: 'none', logLevel: 'warning',
    loader: { '.css': 'text' },
    // Production builds of every library (Chart.js and uPlot have no separate dev mode; this pins NODE_ENV anyway).
    define: { __VERSIONS__: JSON.stringify(versions), 'process.env.NODE_ENV': '"production"' },
  };
  const adapters = adapterSources().filter(adapter => hasCanvasMarks || adapter.id !== 'axylo-canvas');
  // The library's own build recipe (scripts/build.mjs of the source checkout): the production defines and the
  // stylesheet plugin that inlines the minified stylesheet. Three script-tag files, each with an external source map
  // (which leaves the JavaScript byte-identical, checked below):
  //   axylo.iife.min.js        RELEASE: exactly the shipped recipe (PRODUCTION, no instrumentation), for the byte
  //                            check, size and sanity runs (build=release); it has no __bench hook;
  //   axylo.bench.iife.min.js  INSTRUMENTED production: the same with __BENCH__ = true, so the hook is attached when
  //                            globalThis.__AXYLO_BENCH__ is true; every workload that reads the hook (build=prod);
  //   axylo.iife.js            DEVELOPMENT (build=dev): hooks through __DEV__; profiles only.
  // An older checkout without that recipe is built the old way and says so (recipe: 'legacy').
  const axyloCommon = { entryPoints: [path.join(srcDir, 'index.ts')], bundle: true, target: 'es2022', legalComments: 'none', logLevel: 'warning', format: 'iife', globalName: 'Axylo', absWorkingDir: source };
  const used = new Map();
  let recipe = { kind: 'legacy', release: { __DEV__: 'false' }, bench: { __DEV__: 'false' }, dev: { __DEV__: 'true' }, plugins: () => [] };
  const script = path.join(source, 'scripts/build.mjs');
  if (snapshot.size && fs.existsSync(script)) {
    const lib = await import(pathToFileURL(script).href);
    if (lib.PRODUCTION && lib.DEVELOPMENT && lib.stylesheetPlugin) {
      // The stylesheet text from the snapshot, through the library's own minifier, as scripts/build.mjs does.
      const evaluate = async rel => {
        const r = await esbuild({ entryPoints: [path.join(srcDir, rel)], bundle: true, format: 'esm', write: false, logLevel: 'silent', absWorkingDir: source, plugins: [snapshotPlugin(snapshot, srcDir, used)] });
        return import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].contents).toString('base64'));
      };
      const { AXYLO_CSS } = await evaluate('theme/css.ts');
      const { minifyCss } = await evaluate('theme/minify.ts');
      const minified = minifyCss(AXYLO_CSS);
      recipe = { kind: 'scripts/build.mjs', release: lib.PRODUCTION, bench: { ...lib.PRODUCTION, __BENCH__: 'true' }, dev: lib.DEVELOPMENT, plugins: () => [lib.stylesheetPlugin(minified)], stylesheetSha256: sha256(minified) };
    }
  }
  const prodPlugins = () => [...recipe.plugins(), snapshotPlugin(snapshot, srcDir, used)];
  const axyloBuilds = snapshot.size ? [
    esbuild({ ...axyloCommon, minify: true, define: recipe.release, sourcemap: 'external', outfile: path.join(dir, 'axylo/axylo.iife.min.js'), plugins: prodPlugins() }),
    esbuild({ ...axyloCommon, minify: true, define: recipe.bench, sourcemap: 'external', outfile: path.join(dir, 'axylo/axylo.bench.iife.min.js'), plugins: prodPlugins() }),
    esbuild({ ...axyloCommon, define: recipe.dev, sourcemap: 'external', outfile: path.join(dir, 'axylo/axylo.iife.js'), plugins: [snapshotPlugin(snapshot, srcDir, used)] }),
  ] : [];
  await Promise.all([
    esbuild({ ...common, entryPoints: [path.join(BENCH, 'src/page.js')], outfile: path.join(dir, 'page.js') }),
    ...adapters.map(a => esbuild({ ...common, entryPoints: [a.file], outfile: path.join(dir, 'adapters', `${a.id}.js`) })),
    ...axyloBuilds,
  ]);
  fs.copyFileSync(path.join(BENCH, 'src/page.html'), path.join(dir, 'index.html'));
  fs.writeFileSync(path.join(dir, 'axylo/capabilities.json'), JSON.stringify({ canvasMarks: hasCanvasMarks }));

  let shippedOptions = 'not available: no Axylo sources';
  let distComparison = 'not available: no packages/axylo/dist/axylo.iife.min.js in the source checkout';
  if (snapshot.size) {
    const plain = await esbuild({ ...axyloCommon, minify: true, define: recipe.release, write: false, outfile: path.join(dir, 'axylo/axylo.iife.min.js'), plugins: [...recipe.plugins(), snapshotPlugin(snapshot, srcDir, new Map())] });
    const built = fs.readFileSync(path.join(dir, 'axylo/axylo.iife.min.js'));
    // Holds for the uninstrumented release copy only; the instrumented one differs by design (__BENCH__).
    shippedOptions = Buffer.compare(Buffer.from(plain.outputFiles[0].contents), built) === 0
      ? `identical: axylo.iife.min.js (release copy) is byte-for-byte what the ${recipe.kind} recipe produces from this snapshot`
      : 'DIFFERENT: the source-mapped release build differs from a plain build; the source map may not describe the measured bytes';
    const dist = path.join(source, 'packages/axylo/dist/axylo.iife.min.js');
    if (fs.existsSync(dist)) distComparison = Buffer.compare(fs.readFileSync(dist), built) === 0 ? 'identical to packages/axylo/dist/axylo.iife.min.js at build time' : 'differs from packages/axylo/dist/axylo.iife.min.js at build time (that file was built from another source state)';
  }

  const files = {};
  for (const rel of listFiles(dir)) { const b = fs.readFileSync(path.join(dir, rel)); files[rel] = { sha256: sha256(b), bytes: b.length }; }
  const inputs = Object.fromEntries([...used.entries()].sort());
  const manifest = {
    schema: 'axylo-bench-artifact/1',
    id: path.basename(dir),
    builtAt: new Date().toISOString(),
    source: {
      root: source,
      head: head ?? 'not available: not a git checkout (or git failed)',
      uncommitted: status === null ? 'not available' : status === '' ? 'clean' : status.split('\n'),
      axyloInputs: inputs,
      axyloSourceHash: sha256(Object.entries(inputs).map(([p, h]) => `${p} ${h}\n`).join('')),
      shippedOptions, distComparison,
      recipe: { kind: recipe.kind, release: recipe.release, instrumented: recipe.bench, development: recipe.dev, stylesheetSha256: recipe.stylesheetSha256 ?? 'not available: legacy recipe' },
      bundles: { 'axylo/axylo.iife.min.js': 'release (shipped recipe, no hook)', 'axylo/axylo.bench.iife.min.js': 'instrumented production (__BENCH__ true)', 'axylo/axylo.iife.js': 'development' },
    },
    bench: { head: git(BENCH, ['rev-parse', 'HEAD']) ?? 'not available', uncommitted: (git(BENCH, ['status', '--short', '--', '.']) ?? 'not available') || 'clean' },
    esbuild: esbuildVersion,
    versions,
    adapters: Object.fromEntries(adapters.map(a => [a.id, { file: `adapters/${a.id}.js`, test: a.test }])),
    files,
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  seal(dir);
  return { ...manifest, dir };
}

function seal(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) seal(p); else fs.chmodSync(p, 0o444);
  }
  fs.chmodSync(dir, 0o555);
}

/** Makes an artifact writable again and removes it (tests and scratch use only). */
export function removeArtifact(dir) {
  if (!fs.existsSync(dir)) return;
  const open = d => { fs.chmodSync(d, 0o755); for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) open(path.join(d, e.name)); };
  open(dir);
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Loads an artifact's manifest and checks every file against it. Throws when a file is missing, extra, or differs:
 * a session never serves bytes other than the ones its record names.
 */
export function readArtifact(dir) {
  dir = path.resolve(dir);
  const mf = path.join(dir, 'manifest.json');
  if (!fs.existsSync(mf)) throw new Error(`${dir} is not a bench artifact (no manifest.json); build one with node bench/build.mjs`);
  const manifest = readJson(mf);
  const problems = [];
  const present = new Set(listFiles(dir).filter(f => f !== 'manifest.json'));
  for (const [rel, f] of Object.entries(manifest.files)) {
    if (!present.has(rel)) { problems.push(`${rel} missing`); continue; }
    present.delete(rel);
    if (sha256(fs.readFileSync(path.join(dir, rel))) !== f.sha256) problems.push(`${rel} changed since the build`);
  }
  for (const rel of present) problems.push(`${rel} is not in the manifest`);
  if (problems.length) throw new Error(`artifact ${dir} does not match its manifest: ${problems.join('; ')}`);
  return { ...manifest, dir, manifestSha256: sha256(fs.readFileSync(mf)) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { source: { type: 'string' }, out: { type: 'string' } } });
  const m = await build({ source: values.source, out: values.out });
  console.log(`built artifact ${m.dir}\n  Axylo sources: ${m.source.head} (${Array.isArray(m.source.uncommitted) ? `${m.source.uncommitted.length} uncommitted changes` : m.source.uncommitted}), source hash ${m.source.axyloSourceHash.slice(0, 16)}\n  production bundle: ${m.source.shippedOptions}; ${m.source.distComparison}\n  adapters: ${Object.keys(m.adapters).join(', ')}`);
}
