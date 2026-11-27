// Cycle N2 measuring recipe (docs/progress/n2-visual-polish-ledger.md). Builds any tree of the library's sources
// the way scripts/build.mjs builds dist (same esbuild settings, PRODUCTION / DEVELOPMENT defines, the stylesheet
// minified by that tree's own src/theme/minify.ts and embedded as a literal), so a baseline and a candidate are
// built under identical conditions without touching packages/axylo/dist or packing a tarball.
//
//   node docs/progress/n2-size-and-bundle.mjs size   <src> [out]   release files of <src>, then consumer
//        tree-shaken bundles (esbuild, minify, es2022) and their gzip level 9 bytes, embedded CSS included
//   node docs/progress/n2-size-and-bundle.mjs bundle <src> <out>   axylo.iife.js, axylo.css and cartesian.dev.js of
//        <src> in <out>: the files AXYLO_BUNDLE=<out> needs to run the N2 browser suite against that build
//   node docs/progress/n2-size-and-bundle.mjs compare <base-src> <src> [out]   `size` of both trees, built the same
//        way into [out]/base and [out]/candidate, and the gzip-9 delta of every row (exit 1 if a budget row grows:
//        root line only, static line only, static everything)
//
// <src> is a packages/axylo/src directory, e.g. a baseline exported with
//   git archive <baseline-sha> packages/axylo/src | tar -x -C <dir>
// Run it from the repository root (it needs the installed esbuild). Never writes outside [out]/<out>.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const [command, ...args] = process.argv.slice(2);
if (!['size', 'bundle', 'compare'].includes(command) || !args[0] || ((command === 'bundle' || command === 'compare') && !args[1])) {
  console.error('usage: node docs/progress/n2-size-and-bundle.mjs size <src> [out] | bundle <src> <out> | compare <base-src> <src> [out]');
  process.exit(2);
}
const defaultOut = src => path.join(process.cwd(), '.prism-cache/tmp/n2-size', path.basename(path.dirname(path.dirname(src))) || 'src');

if (command === 'compare') {
  const root = path.resolve(args[2] ?? path.join(process.cwd(), '.prism-cache/tmp/n2-size/compare'));
  const base = await measure(path.resolve(args[0]), path.join(root, 'base'));
  const cand = await measure(path.resolve(args[1]), path.join(root, 'candidate'));
  console.log(`  ${'row (gzip -9 B)'.padEnd(58)} ${'base'.padStart(9)} ${'candidate'.padStart(9)} ${'delta'.padStart(7)}`);
  let grew = false;
  base.forEach(([name, , gz], i) => {
    const d = cand[i][2] - gz;
    if (i === 0 || i === 2 || i === 3) grew ||= d > 0;
    console.log(`  ${name.padEnd(58)} ${String(gz).padStart(9)} ${String(cand[i][2]).padStart(9)} ${(d > 0 ? '+' : '') + d}`);
  });
  process.exit(grew ? 1 : 0);
}
const src = path.resolve(args[0]);
const out = path.resolve(args[1] ?? defaultOut(src));
fs.mkdirSync(out, { recursive: true });

async function evaluate(file) {
  const r = await build({ entryPoints: [file], bundle: true, format: 'esm', write: false, logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString('base64')}`);
}

/** The release stylesheet of <src> (its own minifier), written to <out>, and the esbuild options that embed it. */
async function setup(src, out) {
  fs.mkdirSync(out, { recursive: true });
  const { AXYLO_CSS } = await evaluate(path.join(src, 'theme/css.ts'));
  const { minifyCss } = await evaluate(path.join(src, 'theme/minify.ts'));
  const css = minifyCss(AXYLO_CSS);
  fs.writeFileSync(path.join(out, 'axylo.css'), css);
  const cssModule = path.join(src, 'theme/css.ts');
  const embedded = {
    name: 'axylo-stylesheet',
    setup(b) {
      b.onLoad({ filter: /[\\/]theme[\\/]css\.ts$/ }, args => path.resolve(args.path) === cssModule
        ? { contents: `export const AXYLO_CSS = ${JSON.stringify(css)};`, loader: 'js' } : undefined);
    },
  };
  const common = { bundle: true, target: 'es2022', legalComments: 'none', logLevel: 'warning' };
  const prod = { ...common, define: { __DEV__: 'false', __BENCH__: 'false' }, plugins: [embedded], minify: true, format: 'esm' };
  const dev = { ...common, define: { __DEV__: 'true', __BENCH__: 'false' } };
  return { css, prod, dev };
}

/** Release files of <src> in <out>, then each consumer row: [name, minified bytes, gzip -9 bytes]. */
async function measure(src, out) {
  const { css, prod } = await setup(src, out);
  for (const [name, file] of [['axylo', 'index'], ['static', 'static'], ['cartesian', 'cartesian']]) {
    await build({ ...prod, entryPoints: [path.join(src, `${file}.ts`)], outfile: path.join(out, `${name}.js`) });
  }
  const gzip = bytes => gzipSync(bytes, { level: 9 }).length;
  const consumer = async contents => (await build({
    stdin: { contents, resolveDir: out, loader: 'ts', sourcefile: 'consumer.ts' }, bundle: true, minify: true, format: 'esm', target: 'es2022', write: false, logLevel: 'silent',
  })).outputFiles[0].contents;
  // The first row is examples/first-chart/npm.ts, the "line only" row of scripts/size.mjs, against the built file.
  const rows = [
    ['root line only (examples/first-chart/npm.ts)', fs.readFileSync(path.join(process.cwd(), 'examples/first-chart/npm.ts'), 'utf8').replace("from 'axylo'", "from './axylo.js'")],
    ['root everything (export *)', "export * from './axylo.js';"],
    ["static line only (export { line } from 'axylo/static')", "export { line } from './static.js';"],
    ["static everything (export * from 'axylo/static')", "export * from './static.js';"],
    ["cartesian (export { cartesian } from 'axylo/cartesian')", "export { cartesian } from './cartesian.js';"],
  ];
  const measured = [];
  for (const [name, contents] of rows) {
    const bytes = await consumer(contents);
    measured.push([name, bytes.length, gzip(bytes)]);
  }
  measured.push(['axylo.css (file; the same text is embedded in every row)', css.length, gzip(Buffer.from(css))]);
  return measured;
}

if (command === 'bundle') {
  const { prod, dev } = await setup(src, out);
  await Promise.all([
    build({ ...dev, entryPoints: [path.join(src, 'index.ts')], format: 'iife', globalName: 'Axylo', outfile: path.join(out, 'axylo.iife.js') }),
    build({ ...dev, entryPoints: [path.join(src, 'cartesian.ts')], format: 'esm', outfile: path.join(out, 'cartesian.dev.js') }),
    build({ ...prod, entryPoints: [path.join(src, 'index.ts')], outfile: path.join(out, 'axylo.js') }),
    build({ ...prod, entryPoints: [path.join(src, 'static.ts')], outfile: path.join(out, 'static.js') }),
    build({ ...prod, entryPoints: [path.join(src, 'cartesian.ts')], outfile: path.join(out, 'cartesian.js') }),
    build({ ...prod, entryPoints: [path.join(src, 'index.ts')], format: 'iife', globalName: 'Axylo', outfile: path.join(out, 'axylo.iife.min.js') }),
  ]);
  console.log(`bundle of ${src} in ${out}`);
} else {
  console.log(`${src}\n  ${'row'.padEnd(58)} ${'min B'.padStart(8)} ${'gzip-9 B'.padStart(9)}`);
  for (const [name, min, gz] of await measure(src, out)) console.log(`  ${name.padEnd(58)} ${String(min).padStart(8)} ${String(gz).padStart(9)}`);
}
