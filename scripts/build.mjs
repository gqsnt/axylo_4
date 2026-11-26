// Builds packages/axylo/dist: ESM (production and development flavours), script-tag files, CSS and type declarations.
//
// Importing this file builds nothing: it exports what another build of the library from source needs to
// reproduce these files (bench/build.mjs): `stylesheets()` and `stylesheetPlugin(text)`, and the `define`
// objects. Run directly (`node scripts/build.mjs`, `npm run build`), it builds.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const pkg = path.join(root, 'packages/axylo');

/** Runs a source module through esbuild and imports it, for the values the build needs from the library. */
async function evaluate(entry) {
  const r = await build({ entryPoints: [entry], bundle: true, format: 'esm', write: false, logLevel: 'silent' });
  return import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].contents).toString('base64'));
}

/**
 * The stylesheet's source of truth is src/theme/css.ts, a string in the library (it is also applied at run time
 * without a <style> element). The production files get it minified (src/theme/minify.ts: comments and layout
 * whitespace only) as a literal, so they do no work at import time, and dist/axylo.css is that same text. The
 * development files keep css.ts as written, so they stay what a plain build of the source gives.
 */
export async function stylesheets() {
  const { AXYLO_CSS: readable } = await evaluate(path.join(pkg, 'src/theme/css.ts'));
  const { minifyCss } = await evaluate(path.join(pkg, 'src/theme/minify.ts'));
  return { readable, minified: minifyCss(readable) };
}

/** Replaces src/theme/css.ts with the given stylesheet text as a literal. */
export function stylesheetPlugin(text) {
  const module = path.join(pkg, 'src/theme/css.ts');
  return {
    name: 'axylo-stylesheet',
    setup(b) {
      b.onLoad({ filter: /[\\/]theme[\\/]css\.ts$/ }, args => path.resolve(args.path) === module
        ? { contents: `export const AXYLO_CSS = ${JSON.stringify(text)};`, loader: 'js' } : undefined);
    },
  };
}

/**
 * Build-time constants. __BENCH__ carries the benchmark instrumentation (src/core/instrument.ts): false in every
 * shipped file (the development files have it through __DEV__); a benchmark build sets it true.
 */
export const PRODUCTION = { __DEV__: 'false', __BENCH__: 'false' };
export const DEVELOPMENT = { __DEV__: 'true', __BENCH__: 'false' };

async function main() {
  const dist = path.join(pkg, 'dist');
  fs.rmSync(dist, { recursive: true, force: true });
  const { minified } = await stylesheets();
  const common = { entryPoints: [path.join(pkg, 'src/index.ts')], bundle: true, target: 'es2022', legalComments: 'none', logLevel: 'warning', absWorkingDir: root };
  const prod = { define: PRODUCTION, plugins: [stylesheetPlugin(minified)] };
  const dev = { define: DEVELOPMENT };
  await Promise.all([
    build({ ...common, ...prod, format: 'esm', minify: true, outfile: path.join(dist, 'axylo.js') }),
    build({ ...common, ...dev, format: 'esm', outfile: path.join(dist, 'axylo.dev.js') }),
    build({ ...common, ...dev, format: 'iife', globalName: 'Axylo', outfile: path.join(dist, 'axylo.iife.js') }),
    build({ ...common, ...prod, format: 'iife', globalName: 'Axylo', minify: true, outfile: path.join(dist, 'axylo.iife.min.js') }),
    // The opt-in subpaths (axylo/static, axylo/stream): ESM only, each its own self-contained file, so the root
    // file above is built exactly as before and a page pays only for the entry it imports.
    ...['static', 'stream', 'cartesian', 'stats', 'sync', 'export', 'finance'].flatMap(name => {
      const entry = { ...common, entryPoints: [path.join(pkg, `src/${name}.ts`)] };
      return [
        build({ ...entry, ...prod, format: 'esm', minify: true, outfile: path.join(dist, `${name}.js`) }),
        build({ ...entry, ...dev, format: 'esm', outfile: path.join(dist, `${name}.dev.js`) }),
      ];
    }),
  ]);
  // For pages that prefer to load the stylesheet themselves, for example under a strict Content Security Policy.
  fs.writeFileSync(path.join(dist, 'axylo.css'), minified);
  execFileSync('npx', ['tsc', '-p', path.join(pkg, 'tsconfig.build.json')], { stdio: 'inherit', cwd: root });
  console.log('built', fs.readdirSync(dist).filter(f => !fs.statSync(path.join(dist, f)).isDirectory()).join(', '));
}

if (path.resolve(process.argv[1] ?? '') === import.meta.filename) await main();
