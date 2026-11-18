// The gzip delta between two variants under several module orders: the import declarations of the hub modules
// are sorted by a seeded hash of their specifier, the same way in both variants (imports are hoisted and the
// modules have no import-time effects, so the order changes bytes, not behaviour).
//   node .scratch-size/orders.mjs <A> <B> [seeds=6] [mangleListA] [mangleListB]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const here = import.meta.dirname;
const [A, B, seedsArg = '6', listA, listB] = process.argv.slice(2);
const HUBS = ['index.ts', 'core/chart.ts', 'core/controller.ts', 'dom/interaction.ts', 'kinds/line.ts', 'core/stages.ts'];
const hash = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
function permuted(src, seed) {
  const dir = path.join(here, `${src}@${seed}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(path.join(here, src), dir, { recursive: true });
  if (seed > 0) for (const f of HUBS) {
    const p = path.join(dir, f);
    const text = fs.readFileSync(p, 'utf8');
    const re = /^import [^;]*? from '([^']+)';\n/gms;
    const imports = [...text.matchAll(re)];
    if (imports.length < 2) continue;
    const start = imports[0].index, end = imports.at(-1).index + imports.at(-1)[0].length;
    const between = text.slice(start, end);
    // only reorder a contiguous block
    if (between.replace(re, '').trim() !== '') continue;
    const sorted = imports.map(m => m[0]).sort((a, b) => hash(seed + a.match(/from '([^']+)'/)[1]) - hash(seed + b.match(/from '([^']+)'/)[1]));
    fs.writeFileSync(p, text.slice(0, start) + sorted.join('') + text.slice(end));
  }
  return dir;
}
function measure(dir, list) {
  const env = { ...process.env, ROWS: 'everything,line', CSS_ESBUILD: process.env.CSS_ESBUILD ?? '' };
  if (!env.CSS_ESBUILD) delete env.CSS_ESBUILD;
  const args = list ? [path.join(here, 'measure-mangle.mjs'), path.basename(dir), list, '--json'] : [path.join(here, 'measure.mjs'), path.basename(dir), '--json'];
  return JSON.parse(execFileSync('node', args, { env, encoding: 'utf8' }));
}
const rows = [];
for (let seed = 0; seed < Number(seedsArg); seed++) {
  const a = measure(permuted(A, seed), listA), b = measure(permuted(B, seed), listB ?? listA);
  rows.push({ seed, aE: a.everything.gzip, bE: b.everything.gzip, dE: b.everything.gzip - a.everything.gzip, aL: a.line.gzip, bL: b.line.gzip, dL: b.line.gzip - a.line.gzip });
  fs.rmSync(path.join(here, `${A}@${seed}`), { recursive: true, force: true });
  fs.rmSync(path.join(here, `${B}@${seed}`), { recursive: true, force: true });
}
const stat = k => { const v = rows.map(r => r[k]).sort((x, y) => x - y); return { min: v[0], median: v[Math.floor(v.length / 2)], max: v.at(-1) }; };
console.log(JSON.stringify({ A, B, rows, everything: stat('dE'), line: stat('dL'), baseEverything: stat('aE'), baseLine: stat('aL') }));
