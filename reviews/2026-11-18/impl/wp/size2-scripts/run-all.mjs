// Measures a list of variants with the class (a) build settings (property mangling with the combined list,
// esbuild CSS minification), optionally with no stylesheet in the JavaScript. Prints one line per variant.
import { execFileSync } from 'node:child_process';
const list = process.argv[2];
const flags = process.argv.slice(3).filter(a => a.startsWith('--')); const variants = process.argv.slice(3).filter(a => !a.startsWith('--'));
for (const v of variants) {
  for (const cssEmpty of flags.includes('--both-css') ? [false, true] : [flags.includes('--css-empty')]) {
    const env = { ...process.env, CSS_ESBUILD: '1', ...(cssEmpty ? { CSS_EMPTY: '1' } : {}) };
    const out = JSON.parse(execFileSync('node', [new URL('measure-mangle.mjs', import.meta.url).pathname, v, list, '--json'], { env, encoding: 'utf8' }));
    console.log(`${(v + (cssEmpty ? ' +css-link' : '')).padEnd(52)} everything ${out.everything.gzip}  line ${out.line.gzip}  area ${out.area.gzip}  bar ${out.bar.gzip}  scatter ${out.scatter.gzip}  donut ${out.donut.gzip}  validate ${out.validate.gzip}`);
  }
}
