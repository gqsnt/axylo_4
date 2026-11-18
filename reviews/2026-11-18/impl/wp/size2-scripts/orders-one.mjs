// gzip of one variant under seeds 0..N-1 of the hub import order (see orders.mjs).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const here = import.meta.dirname;
const [A, n = '20', list] = process.argv.slice(2);
const src = fs.readFileSync(path.join(here, 'orders.mjs'), 'utf8');
const HUBS = ['index.ts', 'core/chart.ts', 'core/controller.ts', 'dom/interaction.ts', 'kinds/line.ts', 'core/stages.ts'];
const hash = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const out = [];
for (let seed = 0; seed < Number(n); seed++) {
  const dir = path.join(here, `${A}@${seed}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(path.join(here, A), dir, { recursive: true });
  if (seed > 0) for (const f of HUBS) {
    const p = path.join(dir, f); const text = fs.readFileSync(p, 'utf8');
    const re = /^import [^;]*? from '([^']+)';\n/gms; const imports = [...text.matchAll(re)];
    if (imports.length < 2) continue;
    const start = imports[0].index, end = imports.at(-1).index + imports.at(-1)[0].length;
    if (text.slice(start, end).replace(re, '').trim() !== '') continue;
    const sorted = imports.map(m => m[0]).sort((a, b) => hash(seed + a.match(/from '([^']+)'/)[1]) - hash(seed + b.match(/from '([^']+)'/)[1]));
    fs.writeFileSync(p, text.slice(0, start) + sorted.join('') + text.slice(end));
  }
  const env = { ...process.env, ROWS: 'everything,line' };
  const args = list ? [path.join(here, 'measure-mangle.mjs'), path.basename(dir), list, '--json'] : [path.join(here, 'measure.mjs'), path.basename(dir), '--json'];
  const r = JSON.parse(execFileSync('node', args, { env, encoding: 'utf8' }));
  out.push([seed, r.everything.gzip, r.line.gzip]);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(path.join(here, 'out', path.basename(dir) + (env.CSS_ESBUILD ? '-cssesb' : '') + (list ? '-mangled' : '')), { recursive: true, force: true });
}
const s = i => out.map(r => r[i]).sort((a, b) => a - b);
console.log(out.map(r => r.join(':')).join(' '));
console.log(`everything min ${s(1)[0]} median ${s(1)[out.length >> 1]} max ${s(1).at(-1)}; line min ${s(2)[0]} median ${s(2)[out.length >> 1]} max ${s(2).at(-1)}`);
