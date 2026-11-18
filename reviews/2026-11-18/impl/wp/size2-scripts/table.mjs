// One line per variant, all rows, current module order.
import { execFileSync } from 'node:child_process';
const here = new URL('.', import.meta.url).pathname;
const runs = [
  ['base', 'measure.mjs', ['base'], {}],
  ['mangle', 'measure-mangle.mjs', ['mangle-b', 'mangle-base-final.json'], {}],
  ['mangle-convention (upper bound, broken)', 'measure-mangle.mjs', ['mangle-c', 'mangle-convention.json'], {}],
  ['dead', 'measure.mjs', ['dead'], {}],
  ['dedupe', 'measure.mjs', ['dedupe'], {}],
  ['css-esbuild', 'measure.mjs', ['base'], { CSS_ESBUILD: '1' }],
  ['opt-split', 'measure.mjs', ['opt-split'], {}],
  ['reg-keys', 'measure.mjs', ['reg-keys'], {}],
  ['line-tables (line row only)', 'measure.mjs', ['line-tables'], {}],
  ['oracle-line (line row only)', 'measure.mjs', ['oracle-line'], {}],
  ['oracle-axes (line row only)', 'measure.mjs', ['oracle-axes'], {}],
  ['real-axes', 'measure.mjs', ['real-axes'], {}],
  ['donut-jump', 'measure.mjs', ['donut-jump'], {}],
  ['svg-only', 'measure.mjs', ['svg-only'], {}],
  ['canvas-only', 'measure.mjs', ['canvas-only'], {}],
  ['css-link', 'measure.mjs', ['base'], { CSS_EMPTY: '1' }],
  ['no-stream', 'measure.mjs', ['no-stream'], {}],
  ['no-table', 'measure.mjs', ['no-table'], {}],
  ['no-zoom', 'measure.mjs', ['no-zoom'], {}],
  ['no-registry-text', 'measure.mjs', ['no-registry-text'], {}],
  ['no-message-text', 'measure.mjs', ['no-message-text'], {}],
  ['combo-a (mangle+dead+dedupe+css-esbuild)', 'measure-mangle.mjs', ['combo-a', 'mangle-final.json'], { CSS_ESBUILD: '1' }],
];
const rows = ['everything', 'line', 'area', 'bar', 'scatter', 'donut', 'validate'];
let base;
for (const [name, script, args, env] of runs) {
  const r = JSON.parse(execFileSync('node', [here + script, ...args, '--json'], { env: { ...process.env, ...env }, encoding: 'utf8' }));
  if (!base) base = r;
  console.log(`| ${name} | ${rows.map(k => `${r[k].gzip} (${r[k].gzip - base[k].gzip >= 0 ? '+' : ''}${r[k].gzip - base[k].gzip})`).join(' | ')} |`);
}
