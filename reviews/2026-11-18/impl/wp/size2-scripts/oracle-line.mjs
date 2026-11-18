// "Line oracle": fold every inline branch on the chart kind, frame shape, datum/target kind and projection kind
// to what a line chart can be. Only the "line" row of this variant means anything (other kinds are broken).
import { files, regex, variant } from './lib.mjs';
import path from 'node:path';

const dir = variant(process.argv[2] ?? 'oracle-line', process.argv[3] ?? 'base');
const recv = String.raw`([A-Za-z_$][\w$]*(?:(?:\?\.|\.)[A-Za-z_$][\w$]*)*)`;
const rules = [
  // chart kinds that are not line
  [new RegExp(String.raw`${recv}\.kind\s*(===|!==)\s*'(donut|scatter|bar|area)'`, 'g'), (m, r, op) => (op === '===' ? 'false' : 'true')],
  [new RegExp(String.raw`\b(kind|type)\s*(===|!==)\s*'(donut|scatter|bar|area)'`, 'g'), (m, r, op) => (op === '===' ? 'false' : 'true')],
  // line itself (only without optional chaining: a null receiver would make the comparison false)
  [new RegExp(String.raw`${recv}\.kind\s*(===|!==)\s*'line'`, 'g'), (m, r, op) => (r.includes('?.') ? m : op === '===' ? 'true' : 'false')],
  // frame shapes
  [new RegExp(String.raw`${recv}\.shape\s*(===|!==)\s*'(points|donut)'`, 'g'), (m, r, op) => (op === '===' ? 'false' : 'true')],
  [new RegExp(String.raw`${recv}\.shape\s*(===|!==)\s*'aligned'`, 'g'), (m, r, op) => (r.includes('?.') ? m : op === '===' ? 'true' : 'false')],
  // datum and pick-target kinds only scatter and donut produce
  [new RegExp(String.raw`${recv}\.kind\s*(===|!==)\s*'(point|slice)'`, 'g'), (m, r, op) => (op === '===' ? 'false' : 'true')],
  // projections and layout inputs only bar and donut produce
  [new RegExp(String.raw`${recv}\.kind\s*(===|!==)\s*'(bands|ring)'`, 'g'), (m, r, op) => (op === '===' ? 'false' : 'true')],
];
let total = 0;
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
for (const f of files(dir)) {
  if (only && !only.includes(f)) continue;
  if (f === path.join('core', 'contracts.ts') || f === 'public.ts') continue;
  for (const [re, fn] of rules) {
    try { total += regex(dir, f, re, fn, { min: 0 }); } catch (e) { throw e; }
  }
}
console.log(`${dir}: ${total} comparisons folded`);
