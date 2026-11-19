// Bundle cost of each library for exactly the harness tasks (line + bar + donut): minified and gzipped.
// React libraries are measured with react/react-dom external, since a React app already ships them.
import { build } from 'esbuild';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { axyloDirectory, axyloEntry } from './packed-axylo.mjs';
const libs = { chartjs: 'js', recharts: 'jsx', d3: 'js', echarts: 'js', highcharts: 'js', apexcharts: 'js', plotly: 'js', nivo: 'jsx', mui: 'jsx', uplot: 'js', axylo: 'js' };
const out = {};
for (const [lib, ext] of Object.entries(libs)) {
  const alias = lib === 'axylo' ? { axylo: axyloEntry } : undefined;
  const r = await build({ entryPoints: [`src/libs/${lib}.${ext}`], bundle: true, minify: true, format: 'esm', write: false, jsx: 'automatic',
    external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'], loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent', alias });
  const buf = Buffer.from(r.outputFiles[0].contents);
  const src = fs.readFileSync(`src/libs/${lib}.${ext}`, 'utf8').split('\n').filter(l => l.trim() && !l.trim().startsWith('//'));
  out[lib] = { minKB: +(buf.length / 1024).toFixed(1), gzipKB: +(gzipSync(buf).length / 1024).toFixed(1), brotliKB: +(brotliCompressSync(buf).length / 1024).toFixed(1), harnessLoc: src.length };
  if (lib === 'axylo') {
    const { version, license } = JSON.parse(fs.readFileSync(path.join(axyloDirectory, 'package.json'), 'utf8'));
    Object.assign(out[lib], { version, license });
  }
}
fs.writeFileSync('sizes.json', JSON.stringify(out, null, 1));
console.table(out);
