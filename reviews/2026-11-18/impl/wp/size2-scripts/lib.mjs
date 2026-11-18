// Helpers for making scratch variants of the library source. Every edit asserts that it matched.
import fs from 'node:fs';
import path from 'node:path';

export const here = import.meta.dirname;

export function variant(name, from = 'base') {
  const dir = path.join(here, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(path.join(here, from), dir, { recursive: true });
  return dir;
}

/** Exact-string replacements; `n` is the expected number of occurrences (default 1, 'all' = at least one). */
export function edit(dir, file, pairs) {
  const p = path.join(dir, file);
  let text = fs.readFileSync(p, 'utf8');
  for (const [find, replace, n = 1] of pairs) {
    const count = text.split(find).length - 1;
    if (n === 'all' ? count < 1 : count !== n) throw new Error(`${file}: expected ${n} of ${JSON.stringify(find.slice(0, 80))}, found ${count}`);
    text = text.split(find).join(replace);
  }
  fs.writeFileSync(p, text);
}

export function regex(dir, file, re, replacer, { min = 1 } = {}) {
  const p = path.join(dir, file);
  const text = fs.readFileSync(p, 'utf8');
  let count = 0;
  const out = text.replace(re, (...m) => { count++; return typeof replacer === 'function' ? replacer(...m) : replacer; });
  if (count < min) throw new Error(`${file}: ${re} matched ${count}`);
  fs.writeFileSync(p, out);
  return count;
}

export function files(dir) {
  const out = [];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, e.name); if (e.isDirectory()) walk(q); else if (q.endsWith('.ts')) out.push(path.relative(dir, q)); } };
  walk(dir);
  return out;
}

/** Index just past the brace that closes the one at `open` (skips strings, template literals and comments). */
function closing(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i); continue; }
    if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i) + 1; continue; }
    if (c === "'" || c === '"') { for (i++; text[i] !== c; i++) if (text[i] === '\\') i++; continue; }
    if (c === '`') { for (i++; text[i] !== '`'; i++) { if (text[i] === '\\') i++; else if (text[i] === '$' && text[i + 1] === '{') i = closing(text, i + 1) - 1; } continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i + 1; }
  }
  throw new Error('unbalanced');
}

/**
 * Replaces the body of the function whose declaration starts with `head`. The body is the first `{` after the
 * head that ends its line (signatures in this code base keep type-literal braces inline).
 */
export function stub(dir, file, head, body) {
  const p = path.join(dir, file);
  const text = fs.readFileSync(p, 'utf8');
  const at = text.indexOf(head);
  if (at < 0 || text.indexOf(head, at + 1) >= 0) throw new Error(`${file}: head ${JSON.stringify(head)} not found once`);
  const open = text.indexOf('{\n', at + head.length);
  if (open < 0) throw new Error(`${file}: no body after ${head}`);
  const end = closing(text, open);
  fs.writeFileSync(p, text.slice(0, open) + '{' + body + '}' + text.slice(end));
}

/** Removes a class member (or function) whose line starts with `head`, through the end of its body. `nth` picks among several. */
export function remove(dir, file, head, { all = false } = {}) {
  const p = path.join(dir, file);
  let text = fs.readFileSync(p, 'utf8');
  let count = 0;
  for (;;) {
    const at = text.indexOf('\n' + head);
    if (at < 0) break;
    const open = text.indexOf('{\n', at + 1);
    const oneLine = text.indexOf('\n', at + 1);
    let end;
    // a one-line member: `  count(bytes, name): void { bytes.add(name, this.data); }`
    const line = text.slice(at + 1, oneLine);
    if (/[};]\s*$/.test(line) && (open < 0 || open > oneLine)) end = oneLine;
    else if (open < 0) throw new Error(`${file}: ${head} has no body`);
    else end = closing(text, open);
    text = text.slice(0, at) + text.slice(end);
    count++;
    if (!all) break;
  }
  if (count === 0) throw new Error(`${file}: ${JSON.stringify(head)} not found`);
  fs.writeFileSync(p, text);
  return count;
}
