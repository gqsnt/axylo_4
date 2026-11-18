// Reports minified + gzipped size of what a consumer downloads, against the provisional targets in the spec (DX7).
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import fs from 'node:fs';
const pkg = 'packages/axylo';
const kib = b => +(b / 1024).toFixed(2);
const css = fs.existsSync(`${pkg}/dist/axylo.css`) ? gzipSync(fs.readFileSync(`${pkg}/dist/axylo.css`)).length : 0;
const bundle = async code => {
  const r = await build({ stdin: { contents: code, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, minify: true, format: 'esm', write: false, define: { __DEV__: 'false' }, logLevel: 'silent' });
  return gzipSync(r.outputFiles[0].contents).length;
};
const exported = fs.readFileSync(`${pkg}/src/index.ts`, 'utf8');
const has = name => new RegExp(`\\b${name}\\b`).test(exported);
const rows = [];
rows.push({ entry: 'everything', gzipKiB: kib(await bundle(`export * from './${pkg}/src/index.ts'`) + css), targetKiB: 40 });
if (has('line')) rows.push({ entry: 'line only', gzipKiB: kib(await bundle(`import { line } from './${pkg}/src/index.ts'; (globalThis as any).x = line;`) + css), targetKiB: 25 });
console.table(rows);
fs.mkdirSync('bench/history', { recursive: true });
fs.writeFileSync('bench/size-latest.json', JSON.stringify({ date: new Date().toISOString(), cssGzipBytes: css, rows }, null, 1));
if (process.argv.includes('--check') && rows.some(r => r.gzipKiB > r.targetKiB)) { console.error('size target exceeded'); process.exit(1); }
