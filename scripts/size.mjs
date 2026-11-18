// What a consumer downloads, minified and gzipped, measured from the packed tarballs (spec DX7, P6; plan M7).
//
//   node scripts/size.mjs           pack packages/*/dist (scripts/pack.mjs --no-build), measure, print, write bench/size-latest.json
//   node scripts/size.mjs --check   the same, and exit 1 when a row exceeds its target: total gzip bytes
//                                   compared as integers against targetKiB * 1024 (116 KiB means 118,784 B)
//   node scripts/size.mjs --no-pack measure the fixtures already in tests/dist/fixtures
//
// Every row is built the way a consumer's bundler would build it: esbuild, from inside a fixture that installed
// the tarball, minified, with the `production` export condition, so only the packed files and their `exports`
// are read. The script-tag row is the two files the documented snippet loads, as shipped.
//
// Stylesheet: the JavaScript carries the stylesheet as a string and applies it at run time, so a bundler page
// downloads it inside its JavaScript and needs no axylo.css; the script-tag snippet also links axylo.css, so
// that row adds the file. "total" is what each page downloads.
//
// Targets (spec DX7, set by the owner on 2026-11-18): 116 KiB everything, 98 KiB a page that uses only `line`.
// CI runs this script without --check until the targets are met: the flag is correct,
// but it is not a gate yet. The rows for each other chart kind alone and for `validate` alone have no target;
// they show what tree-shaking leaves.
//
// The per-module breakdown cannot come from the packed files, which are one pre-bundled file each: it rebuilds
// packages/axylo/src with the release build's production settings, imported from scripts/build.mjs (the
// minified stylesheet, PRODUCTION constants), reads esbuild's metafile, and states how far that rebuild is from
// the packed axylo.js.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { PRODUCTION, stylesheetPlugin, stylesheets } from './build.mjs';
import { fixtureGuard, pack } from './pack.mjs';

const root = path.resolve(import.meta.dirname, '..');
const fixtures = path.join(root, 'tests/dist/fixtures');
const LEVEL = 9;
const gzip = bytes => gzipSync(bytes, { level: LEVEL }).length;
const kib = bytes => +(bytes / 1024).toFixed(2);

/**
 * The size targets (spec DX7, set by the owner on 2026-11-18), by row: the one place they are written. The
 * acceptance checker reads them from here, not from a measurement record.
 */
export const SIZE_TARGETS = Object.freeze({
  'line only (examples/first-chart/npm.ts)': 98,
  'everything (export * from axylo)': 116,
});

/** Whether `totalBytes` is over a target given in KiB: integer bytes against targetKiB * 1024, never rounded KiB. */
export const exceeds = (totalBytes, targetKiB) => targetKiB !== null && totalBytes > targetKiB * 1024;

async function main() {
  if (!process.argv.includes('--no-pack')) pack({ build: false, log: () => {} });
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'tests/dist/.packed/manifest.json'), 'utf8'));

  async function consumer({ cwd, contents, external = [], metafile = false }) {
    const r = await build({
      stdin: { contents, resolveDir: cwd, loader: 'ts', sourcefile: 'consumer.ts' }, absWorkingDir: cwd, bundle: true, minify: true,
      format: 'esm', target: 'es2022', conditions: ['production'], external, write: false, metafile, logLevel: 'silent',
      plugins: [fixtureGuard([cwd])],
    });
    const inputs = Object.keys(r.metafile?.inputs ?? {});
    return { bytes: r.outputFiles[0].contents, inputs };
  }

  const npm = path.join(fixtures, 'npm');
  const axyloFile = file => fs.readFileSync(path.join(npm, 'node_modules/axylo/dist', file));
  const css = axyloFile('axylo.css');

  const cases = [
    {
      entry: 'line only (examples/first-chart/npm.ts)', targetKiB: SIZE_TARGETS['line only (examples/first-chart/npm.ts)'],
      build: () => consumer({ cwd: npm, contents: fs.readFileSync(path.join(npm, 'example/npm.ts'), 'utf8') }), cssFile: false,
    },
    { entry: 'everything (export * from axylo)', targetKiB: SIZE_TARGETS['everything (export * from axylo)'], build: () => consumer({ cwd: npm, contents: "export * from 'axylo';" }), cssFile: false },
    ...['area', 'bar', 'scatter', 'donut', 'validate'].map(name => ({
      entry: `${name} only (export { ${name} } from axylo)`, targetKiB: null, cssFile: false,
      build: () => consumer({ cwd: npm, contents: `export { ${name} } from 'axylo';` }),
    })),
    { entry: 'script tag (axylo.iife.min.js + axylo.css)', targetKiB: null, build: async () => ({ bytes: axyloFile('axylo.iife.min.js') }), cssFile: true },
  ];

  const rows = [];
  for (const c of cases) {
    const { bytes } = await c.build();
    const jsGzip = gzip(bytes);
    const cssGzip = c.cssFile ? gzip(css) : 0;
    const total = jsGzip + cssGzip;
    rows.push({
      entry: c.entry, minBytes: bytes.length, jsGzipBytes: jsGzip, cssFileGzipBytes: cssGzip, totalGzipBytes: total,
      totalKiB: kib(total), targetKiB: c.targetKiB, targetBytes: c.targetKiB === null ? null : c.targetKiB * 1024,
      over: exceeds(total, c.targetKiB),
    });
  }

  console.log(`Download size from the packed tarballs (${manifest.packages.axylo.tarball}, packed ${manifest.packedAt}); esbuild minify, gzip level ${LEVEL}`);
  console.table(rows.map(r => ({
    entry: r.entry, 'min B': r.minBytes, 'js gzip B': r.jsGzipBytes, 'css file gzip B': r.cssFileGzipBytes || '—',
    'total KiB': r.totalKiB, 'target KiB': r.targetKiB ?? '—', status: r.targetKiB === null ? 'no target' : r.over ? 'OVER' : 'ok',
  })));
  console.log(`The stylesheet is ${css.length} B, ${gzip(css)} B gzipped as a file; the same text is inside every JavaScript row above.`);

  // Where the bytes of "everything" are: the source rebuilt as scripts/build.mjs builds dist/axylo.js.
  const src = path.join(root, 'packages/axylo/src');
  const { minified } = await stylesheets();
  const rebuilt = await build({
    entryPoints: [path.join(src, 'index.ts')], bundle: true, target: 'es2022', legalComments: 'none', format: 'esm', minify: true,
    define: PRODUCTION, plugins: [stylesheetPlugin(minified)], write: false, metafile: true, logLevel: 'silent', absWorkingDir: root,
  });
  const packedProd = axyloFile('axylo.js').length;
  const out = Object.values(rebuilt.metafile.outputs)[0];
  const modules = Object.entries(out.inputs).map(([file, v]) => ({ file: path.relative(src, path.resolve(root, file)), bytes: v.bytesInOutput }))
    .sort((a, b) => b.bytes - a.bytes);
  const sum = modules.reduce((n, m) => n + m.bytes, 0);
  const byDir = new Map();
  for (const m of modules) { const d = m.file.includes(path.sep) ? m.file.split(path.sep)[0] : '(root)'; byDir.set(d, (byDir.get(d) ?? 0) + m.bytes); }
  const dirs = [...byDir].sort((a, b) => b[1] - a[1]).map(([dir, bytes]) => ({ directory: dir, 'min B': bytes, share: `${((100 * bytes) / sum).toFixed(1)}%` }));
  console.log(`\nPer-module breakdown of "everything" (source rebuilt with the release settings: ${rebuilt.outputFiles[0].contents.length} B minified; the packed axylo.js is ${packedProd} B, ${rebuilt.outputFiles[0].contents.length === packedProd ? 'identical in size' : `a difference of ${rebuilt.outputFiles[0].contents.length - packedProd} B, so dist was built from different source`}). Minified bytes before gzip; gzip does not split by module.`);
  console.table(dirs);
  console.table(modules.slice(0, 25).map(m => ({ module: m.file, 'min B': m.bytes, share: `${((100 * m.bytes) / sum).toFixed(1)}%` })));

  fs.mkdirSync(path.join(root, 'bench'), { recursive: true });
  fs.writeFileSync(path.join(root, 'bench/size-latest.json'), JSON.stringify({
    date: new Date().toISOString(),
    method: 'esbuild consumer bundles from tests/dist/fixtures (packed tarballs), minify, production condition; gzip level 9',
    // The pack measured, by its tarball's integrity (what the acceptance checker compares with the current
    // pack), and the tree it was packed from.
    packed: { at: manifest.packedAt, axylo: manifest.packages.axylo.integrity, ...treeState() },
    cssFileBytes: css.length, cssFileGzipBytes: gzip(css), rows,
    breakdown: { rebuiltMinBytes: rebuilt.outputFiles[0].contents.length, packedMinBytes: packedProd, directories: dirs, modules },
  }, null, 1));

  if (process.argv.includes('--check') && rows.some(r => r.over)) {
    console.error(`size target exceeded: ${rows.filter(r => r.over).map(r => `${r.entry} ${r.totalGzipBytes} B > ${r.targetBytes} B (${r.targetKiB} KiB)`).join('; ')}`);
    process.exit(1);
  }
}

/** The commit and whether the tree had changes, for the record (the integrity is what binds it to a pack). */
function treeState() {
  try {
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return { commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain', '--untracked-files=no') !== '' };
  } catch {
    return { commit: null, dirty: null };
  }
}

if (path.resolve(process.argv[1] ?? '') === import.meta.filename) await main();
