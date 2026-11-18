// Wraps measure.mjs: passes a mangleProps RegExp, which JSON cannot carry.
import { readFileSync } from 'node:fs';
const [variant, list] = process.argv.slice(2);
const names = JSON.parse(readFileSync(new URL(list, import.meta.url))).names;
process.env.MANGLE = `^(${names.join('|')})$`;
process.argv = [process.argv[0], new URL('measure.mjs', import.meta.url).pathname, variant, ...process.argv.slice(4)];
await import('./measure.mjs');
