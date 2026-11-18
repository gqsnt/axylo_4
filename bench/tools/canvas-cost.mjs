#!/usr/bin/env node
// The marginal size of the Canvas mark renderer (plan 5.1, rule 3: canvas leaves the 1.0 bundle only if it costs
// more than 0.5 KiB gzipped). Two matched production builds of the script-tag bundle from the same source snapshot,
// with the options of scripts/build.mjs: the library as it is, and the library with render/canvas.ts replaced by a
// stub that keeps its export names (every function throws, every constant is 0). The difference, gzip level 9 and
// brotli, is what the Canvas renderer adds. CSS is the same in both and cancels out.
//
//   node bench/tools/canvas-cost.mjs [--source <checkout root>] [--json]
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { REPO } from '../build.mjs';

/** A module with the same export names as `source`, which does nothing. */
export function stubOf(source) {
  const out = ['// stub: the Canvas renderer removed, for a size comparison only'];
  for (const m of source.matchAll(/^export\s+(async\s+)?(function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    out.push(m[2] === 'function' ? `export function ${m[3]}(): never { throw new Error('canvas renderer removed'); }` : m[2] === 'class' ? `export class ${m[3]} {}` : `export const ${m[3]}: any = 0;`);
  }
  return out.join('\n');
}

export async function canvasCost(source = REPO) {
  const srcDir = path.join(source, 'packages/axylo/src');
  const target = path.join(srcDir, 'render/canvas.ts');
  const common = { entryPoints: [path.join(srcDir, 'index.ts')], bundle: true, target: 'es2022', legalComments: 'none', logLevel: 'silent', format: 'iife', globalName: 'Axylo', minify: true, define: { __DEV__: 'false' }, write: false, absWorkingDir: source };
  const stub = { name: 'stub-canvas', setup(b) { b.onLoad({ filter: /render[\\/]canvas\.ts$/ }, args => (args.path === target ? { contents: stubOf(fs.readFileSync(target, 'utf8')), loader: 'ts' } : undefined)); } };
  const [full, without] = await Promise.all([build(common), build({ ...common, plugins: [stub] })]);
  const size = b => { const buf = Buffer.from(b.outputFiles[0].contents); return { min: buf.length, gzip: zlib.gzipSync(buf, { level: 9 }).length, brotli: zlib.brotliCompressSync(buf).length }; };
  const a = size(full), w = size(without);
  return { full: a, withoutCanvas: w, canvasBytesMin: a.min - w.min, canvasBytesGzip: a.gzip - w.gzip, canvasBytesBrotli: a.brotli - w.brotli, measuredAt: new Date().toISOString(), method: 'matched iife production builds, render/canvas.ts stubbed in one' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { source: { type: 'string' }, json: { type: 'boolean', default: false } } });
  const r = await canvasCost(values.source ?? REPO);
  if (values.json) console.log(JSON.stringify(r, null, 1));
  else console.log(`Canvas renderer, marginal: ${r.canvasBytesMin} B minified, ${r.canvasBytesGzip} B gzip, ${r.canvasBytesBrotli} B brotli (full bundle ${r.full.gzip} B gzip)`);
}
