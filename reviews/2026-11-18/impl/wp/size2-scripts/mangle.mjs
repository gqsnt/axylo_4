// Property mangling measurement: which property names in the production bundle are internal only, and what
// mangling them saves. Reserved: every identifier in TypeScript's lib declarations (DOM, ES), every identifier
// in public.ts, and every identifier-shaped token inside a string literal anywhere in the source (a name that
// is also a string may be looked up dynamically: dictionary tables, `in`, option keys).
//   node .scratch-size/mangle.mjs <variant> [--top N]   writes .scratch-size/mangle-<variant>.json
import fs from 'node:fs';
import path from 'node:path';
import { files } from './lib.mjs';

const here = import.meta.dirname;
const root = path.resolve(here, '..');
const variant = path.join(here, process.argv[2] ?? 'base');
const libDir = path.join(root, 'node_modules/@typescript/typescript-linux-x64/lib');
const ident = /[A-Za-z_$][\w$]*/g;

const reserved = new Set(['__renderer', '__dev', '__bench', 'default', 'prototype', 'constructor', 'then', 'toJSON', 'length', 'raw']);
for (const f of fs.readdirSync(libDir).filter(f => /^lib\..*\.d\.ts$/.test(f))) {
  for (const m of fs.readFileSync(path.join(libDir, f), 'utf8').matchAll(ident)) reserved.add(m[0]);
}
const libCount = reserved.size;
for (const m of fs.readFileSync(path.join(variant, 'public.ts'), 'utf8').matchAll(ident)) reserved.add(m[0]);
const publicCount = reserved.size - libCount;
let stringCount = 0;
for (const f of files(variant)) {
  const text = fs.readFileSync(path.join(variant, f), 'utf8');
  // String literals ('…', "…", `…` without the ${} parts); comments are not strings but are cheap to over-reserve.
  for (const s of text.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)) {
    for (const m of s[0].matchAll(ident)) if (!reserved.has(m[0])) { reserved.add(m[0]); stringCount++; }
  }
}

const out = fs.readFileSync(path.join(here, 'out', path.basename(variant), 'axylo.js'), 'utf8');
const counts = new Map();
for (const m of out.matchAll(/(?<![\w$])\.\s*([A-Za-z_$][\w$]*)|[{,]\s*([A-Za-z_$][\w$]*)\s*[:(]|\b(?:get|set|static)\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
  const n = m[1] ?? m[2] ?? m[3];
  counts.set(n, (counts.get(n) ?? 0) + 1);
}
const candidates = [...counts].filter(([n]) => !reserved.has(n) && n.length > 1).sort((a, b) => b[1] * b[0].length - a[1] * a[0].length);
const top = process.argv.includes('--top') ? Number(process.argv[process.argv.indexOf('--top') + 1]) : candidates.length;
const chosen = candidates.slice(0, top).map(([n]) => n);
fs.writeFileSync(path.join(here, `mangle-${path.basename(variant)}.json`), JSON.stringify({ names: chosen }));
console.log(`reserved: ${libCount} lib, ${publicCount} public.ts, ${stringCount} from string literals; internal candidates ${candidates.length}, bytes in output ${candidates.reduce((s, [n, c]) => s + n.length * c, 0)}`);
console.log(candidates.slice(0, 60).map(([n, c]) => `${n}:${c}`).join(' '));
