// A sealed benchmark artifact that can also serve `axylo/cartesian` (RFC C4.1 §8), built without changing
// bench/build.mjs:
//
//   node bench/src/cartesian-artifact.mjs [--source <checkout>] [--out <new dir>]
//
// 1. bench/build.mjs build() makes the ordinary artifact of the source, sealed, in a staging directory.
// 2. readArtifact() verifies it; every one of its files is copied into the new, empty directory (never in place).
// 3. axylo/axylo-cartesian.bench.js is compiled from a snapshot of the same packages/axylo/src with the library's own
//    recipe, as build.mjs compiles axylo.bench.iife.min.js: scripts/build.mjs PRODUCTION with __BENCH__ 'true', its
//    stylesheet plugin over the snapshot's minified stylesheet, ESM, minified, es2022, external source map.
// 4. A new manifest: the staging manifest with this id, every file re-hashed, the bundle listed in source.bundles,
//    source.axyloInputs the union of both builds' inputs (an input both read must have one hash, else the source
//    changed between the builds and nothing is written), the source hash recomputed over that union, and
//    `derivedFrom` naming the staging artifact and its manifest hash. Then the directory is sealed read-only and
//    verified with readArtifact(); the staging artifact is removed.
//
// The adapter (src/adapters/axylo-cartesian.js) is in every artifact either way; this file only adds the library side.
import { build as esbuild } from 'esbuild';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { ARTIFACTS, REPO, build, readArtifact, removeArtifact, sha256 } from '../build.mjs';

export const CARTESIAN_BUNDLE = 'axylo/axylo-cartesian.bench.js';

function listFiles(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, base)); else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out.sort();
}

/** The library sources read once; esbuild compiles from this snapshot and records what it used (as build.mjs). */
function snapshotPlugin(srcDir, used) {
  const files = new Map();
  for (const rel of listFiles(srcDir)) {
    const bytes = fs.readFileSync(path.join(srcDir, rel));
    files.set(path.join(srcDir, rel), { bytes, sha256: sha256(bytes), rel });
  }
  return () => ({
    name: 'bench-source-snapshot',
    setup(b) {
      b.onLoad({ filter: /.*/ }, args => {
        if (!args.path.startsWith(srcDir + path.sep)) return undefined;
        const f = files.get(args.path);
        if (!f) throw new Error(`source ${args.path} appeared after the snapshot was taken`);
        used.set(f.rel, f.sha256);
        return { contents: f.bytes, loader: path.extname(args.path).slice(1) === 'ts' ? 'ts' : 'js' };
      });
    },
  });
}

function seal(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) seal(p); else fs.chmodSync(p, 0o444);
  }
  fs.chmodSync(dir, 0o555);
}

/** Builds the artifact. Returns its verified manifest (readArtifact's shape). */
export async function buildCartesianArtifact({ source = REPO, out = null } = {}) {
  source = path.resolve(source);
  const srcDir = path.join(source, 'packages/axylo/src');
  const entry = path.join(srcDir, 'cartesian.ts');
  if (!fs.existsSync(entry)) throw new Error(`${entry} does not exist: this source has no axylo/cartesian entry`);
  const script = path.join(source, 'scripts/build.mjs');
  const lib = fs.existsSync(script) ? await import(pathToFileURL(script).href) : {};
  if (!lib.PRODUCTION || !lib.stylesheetPlugin) throw new Error(`${script} has no PRODUCTION recipe and stylesheet plugin; a Cartesian bundle needs the library's own recipe`);

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const dir = path.resolve(out ?? path.join(ARTIFACTS, `${stamp}-cartesian-${crypto.randomBytes(3).toString('hex')}`));
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Error(`artifact directory ${dir} exists and is not empty; artifacts are never rebuilt in place`);
  const staging = `${dir}.staging-${crypto.randomBytes(3).toString('hex')}`;
  const base = await build({ source, out: staging });
  try {
    const verified = readArtifact(base.dir);

    const used = new Map();
    const snapshot = snapshotPlugin(srcDir, used);
    const evaluate = async rel => {
      const r = await esbuild({ entryPoints: [path.join(srcDir, rel)], bundle: true, format: 'esm', write: false, logLevel: 'silent', absWorkingDir: source, plugins: [snapshot()] });
      return import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].contents).toString('base64'));
    };
    const { AXYLO_CSS } = await evaluate('theme/css.ts');
    const { minifyCss } = await evaluate('theme/minify.ts');
    const minified = minifyCss(AXYLO_CSS);
    if (verified.source.recipe?.stylesheetSha256 !== sha256(minified)) throw new Error('the stylesheet differs from the one the staging artifact was built with');
    const define = { ...lib.PRODUCTION, __BENCH__: 'true' };

    fs.mkdirSync(dir, { recursive: true });
    for (const rel of Object.keys(verified.files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.copyFileSync(path.join(base.dir, rel), path.join(dir, rel));
      fs.chmodSync(path.join(dir, rel), 0o644);
    }
    await esbuild({
      entryPoints: [entry], bundle: true, format: 'esm', target: 'es2022', minify: true, legalComments: 'none', logLevel: 'warning',
      define, sourcemap: 'external', outfile: path.join(dir, CARTESIAN_BUNDLE), absWorkingDir: source,
      plugins: [lib.stylesheetPlugin(minified), snapshot()],
    });

    const inputs = { ...verified.source.axyloInputs };
    for (const [rel, hash] of used) {
      if (rel in inputs && inputs[rel] !== hash) throw new Error(`${rel} changed between the staging build and the Cartesian build; rebuild from a quiet source`);
      inputs[rel] = hash;
    }
    const sorted = Object.fromEntries(Object.entries(inputs).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    const files = {};
    for (const rel of listFiles(dir)) { const b = fs.readFileSync(path.join(dir, rel)); files[rel] = { sha256: sha256(b), bytes: b.length }; }
    const { dir: _dir, manifestSha256, ...manifest } = verified;
    const next = {
      ...manifest,
      id: path.basename(dir),
      builtAt: new Date().toISOString(),
      derivedFrom: { id: verified.id, manifestSha256, how: 'bench/src/cartesian-artifact.mjs: every staging file copied, one bundle added, manifest rewritten' },
      source: {
        ...manifest.source,
        axyloInputs: sorted,
        axyloSourceHash: sha256(Object.entries(sorted).map(([p, h]) => `${p} ${h}\n`).join('')),
        bundles: { ...manifest.source.bundles, [CARTESIAN_BUNDLE]: 'axylo/cartesian, instrumented production (__BENCH__ true), ESM' },
        cartesian: { entry: 'packages/axylo/src/cartesian.ts', define, format: 'esm' },
      },
      files,
    };
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(next, null, 1));
    seal(dir);
    return readArtifact(dir);
  } finally {
    removeArtifact(base.dir);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { source: { type: 'string' }, out: { type: 'string' } } });
  const m = await buildCartesianArtifact({ source: values.source, out: values.out });
  console.log(`built artifact ${m.dir}\n  derived from ${m.derivedFrom.id}; source hash ${m.source.axyloSourceHash.slice(0, 16)}\n  ${CARTESIAN_BUNDLE}: ${m.files[CARTESIAN_BUNDLE].bytes} B\n  adapters: ${Object.keys(m.adapters).join(', ')}`);
}
