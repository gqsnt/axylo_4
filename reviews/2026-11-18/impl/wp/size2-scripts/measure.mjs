// Size measurement for a scratch copy of packages/axylo/src, reproducing scripts/build.mjs (production ESM:
// PRODUCTION defines, minified stylesheet literal, es2022, minify, legalComments none) and then
// scripts/size.mjs (consumer bundle: esbuild minify, es2022, esm, production condition; gzip level 9).
//
//   node .scratch-size/measure.mjs <variantDir> [--lib '<json esbuild overrides>'] [--consumer '<json>'] [--meta <row>] [--json]
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const variant = path.resolve(import.meta.dirname, args[0] ?? 'base');
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const libOverrides = opt('--lib') ? JSON.parse(opt('--lib')) : {};
const consumerOverrides = opt('--consumer') ? JSON.parse(opt('--consumer')) : {};
const metaRow = opt('--meta');
const gzip = b => gzipSync(b, { level: 9 }).length;

async function evaluate(entry) {
  const r = await build({ entryPoints: [entry], bundle: true, format: 'esm', write: false, logLevel: 'silent' });
  return import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].contents).toString('base64'));
}

const cssModule = path.join(variant, 'theme/css.ts');
const { AXYLO_CSS } = await evaluate(cssModule);
const { minifyCss } = await evaluate(path.join(variant, 'theme/minify.ts'));
let css = minifyCss(AXYLO_CSS);
if (process.env.CSS_ESBUILD) css = (await import('esbuild')).transformSync(css, { loader: 'css', minify: true }).code.trimEnd();
if (process.env.CSS_EMPTY) css = '';
const stylesheetPlugin = {
  name: 'stylesheet',
  setup(b) {
    b.onLoad({ filter: /[\\/]theme[\\/]css\.ts$/ }, a => path.resolve(a.path) === cssModule
      ? { contents: `export const AXYLO_CSS = ${JSON.stringify(css)};`, loader: 'js' } : undefined);
  },
};
const PRODUCTION = { __DEV__: 'false', __BENCH__: 'false' };
const { define: extraDefine, ...libRest } = libOverrides;
const libCommon = {
  bundle: true, target: 'es2022', legalComments: 'none', logLevel: 'error', minify: true,
  define: { ...PRODUCTION, ...(extraDefine ?? {}) }, plugins: [stylesheetPlugin], write: false, ...libRest,
  ...(process.env.MANGLE ? { mangleProps: new RegExp(process.env.MANGLE) } : {}),
};
const lib = await build({ ...libCommon, entryPoints: [path.join(variant, 'index.ts')], format: 'esm', metafile: true });
const outDir = path.join(import.meta.dirname, 'out', path.basename(variant) + (process.env.CSS_ESBUILD ? '-cssesb' : '') + (process.env.CSS_EMPTY ? '-cssnone' : '') + (process.env.MANGLE ? '-mangled' : ''));
fs.mkdirSync(outDir, { recursive: true });
const libFile = path.join(outDir, 'axylo.js');
fs.writeFileSync(libFile, lib.outputFiles[0].contents);

const npmExample = fs.readFileSync(path.join(root, 'tests/dist/fixtures/npm/example/npm.ts'), 'utf8');
const resolveTo = target => ({ name: 'axylo', setup(b) { b.onResolve({ filter: /^axylo$/ }, () => ({ path: target })); } });

async function consumer(contents, target = libFile, extra = {}) {
  const r = await build({
    stdin: { contents, resolveDir: outDir, loader: 'ts', sourcefile: 'consumer.ts' }, bundle: true, minify: true,
    format: 'esm', target: 'es2022', conditions: ['production'], write: false, logLevel: 'error', plugins: [resolveTo(target)],
    ...consumerOverrides, ...extra,
  });
  return r;
}

const rows = [
  ['everything', "export * from 'axylo';"],
  ['line', npmExample],
  ['area', "export { area } from 'axylo';"],
  ['bar', "export { bar } from 'axylo';"],
  ['scatter', "export { scatter } from 'axylo';"],
  ['donut', "export { donut } from 'axylo';"],
  ['validate', "export { validate } from 'axylo';"],
].filter(([name]) => !process.env.ROWS || process.env.ROWS.split(',').includes(name));
const result = { lib: { min: lib.outputFiles[0].contents.length, gzip: gzip(lib.outputFiles[0].contents) }, css: { min: css.length, gzip: gzip(css) } };
for (const [name, contents] of rows) {
  const r = await consumer(contents);
  const bytes = r.outputFiles[0].contents;
  result[name] = { min: bytes.length, gzip: gzip(bytes) };
  fs.writeFileSync(path.join(outDir, `${name}.js`), bytes);
}

if (metaRow) {
  // One-step build from source for the per-module attribution of a row (minified bytes, not gzip).
  const contents = rows.find(r => r[0] === metaRow)[1];
  const r = await build({
    ...libCommon, stdin: { contents, resolveDir: outDir, loader: 'ts', sourcefile: 'consumer.ts' }, format: 'esm',
    conditions: ['production'], metafile: true, plugins: [stylesheetPlugin, resolveTo(path.join(variant, 'index.ts'))],
  });
  const out = Object.values(r.metafile.outputs)[0];
  const mods = Object.entries(out.inputs).map(([f, v]) => [path.relative(variant, path.resolve(f)), v.bytesInOutput]).sort((a, b) => b[1] - a[1]);
  result.meta = { total: r.outputFiles[0].contents.length, gzip: gzip(r.outputFiles[0].contents), modules: mods };
}

if (args.includes('--json')) console.log(JSON.stringify(result));
else {
  const kib = b => (b / 1024).toFixed(2);
  console.log(`variant ${path.basename(variant)}: lib ${result.lib.min} B min, css ${result.css.min} B (${result.css.gzip} gz)`);
  for (const [name] of rows) console.log(`${name.padEnd(11)} ${String(result[name].min).padStart(7)} min  ${String(result[name].gzip).padStart(7)} gz  ${kib(result[name].gzip)} KiB`);
  if (result.meta) {
    console.log(`meta ${metaRow}: ${result.meta.total} min ${result.meta.gzip} gz`);
    for (const [f, b] of result.meta.modules) console.log(String(b).padStart(7), f);
  }
}
